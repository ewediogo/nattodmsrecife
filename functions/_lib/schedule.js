import { applyTimeOffStatus, readActiveTimeOff, timeOffByEmployeeOn, TIME_OFF_STATUS } from './time-off.js';
import { isMonitoringExcludedTrip } from './operational-exclusions.js';
import { readCaronaReasons, saveCaronaReason } from './schedule-carona.js';
import { deleteDeviation, readDeviations, upsertDeviation } from './allocation-deviations.js';
import { bitruckDriverMayUsePlate, isBitruckDriver, isCarreteiroDriver, readCarreteirosRegistry } from './carreteiros.js';
import { audit, ensureCoreSchema, inferDate, inferStatus, inferTitle, parseData, recordResourceEvents, updateVehicleLastDriver } from './core.js';

const VERSION = '1';
const SCHEDULE_STATUSES = ['PROGRAMADO','CARREGANDO','LIBERADO','EM ROTA','PERNOITE','RETORNOU','FINALIZADO','CANCELADO'];
// SEM_AJUDANTE: serviço administrativo/outros. DOIS_MOTORISTAS: o segundo motorista
// (novato, administrativo etc.) ocupa a vaga de ajudante 1 da escala e, por isso,
// entra automaticamente em disponibilidade, conflitos e CAJU como qualquer equipe.
// TRES_MOTORISTAS: somente em placas cadastradas com "até 3 motoristas" (ex.: carro de apoio); as vagas de ajudante viram Motorista 2 e 3.
const TEAM_TYPES = ['CARGA_FECHADA','UM_AJUDANTE','DOIS_AJUDANTES','TERCEIRO','SEM_AJUDANTE','DOIS_MOTORISTAS','TRES_MOTORISTAS'];
const SERVICE_TYPES_WITHOUT_VEHICLE = new Set(['ADMINISTRATIVO','OUTROS']);
// CAJU - Carreteiros: carreteiro não aparece na Escala; motorista de bitruck aparece, mas só em placa de bitruck cadastrada.
function carreteiroDriversForSchedule(drivers=[],registry=null){
  if(!registry)return drivers;
  return drivers.filter((driver)=>!isCarreteiroDriver(registry,driver)).map((driver)=>isBitruckDriver(registry,driver)?{...driver,bitruck_motorista:true}:driver);
}
function routeIsAdministrative(route) {
  return SERVICE_TYPES_WITHOUT_VEHICLE.has(normalizeText(route?.tipo_servico||value(route?.raw||{},'TIPO_SERVICO')||'ENTREGA'));
}
const TABLE_PATTERN = /^[A-Z0-9_]+$/;
const TZ_OFFSET = '-03:00';
let schemaPromise = null;
const existingTableCache = new Set();
const columnCache = new Map();

function quote(name) {
  const value = String(name || '').toUpperCase();
  if (!TABLE_PATTERN.test(value)) throw new Error('Identificador de banco inválido.');
  return `"${value}"`;
}

function normalized(row) {
  const output = {};
  Object.entries(row || {}).forEach(([key,value]) => { output[String(key).toUpperCase()] = value; });
  return output;
}

function value(row, ...keys) {
  const data = normalized(row);
  for (const key of keys.flat()) {
    const item = data[String(key).toUpperCase()];
    if (item !== undefined && item !== null && String(item).trim() !== '') return item;
  }
  return '';
}

function text(row, ...keys) { return String(value(row, ...keys) || '').trim(); }
function numberValue(row, ...keys) {
  const raw = text(row, ...keys).replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
function optionalNumberValue(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : '';
}
function boolValue(input, fallback = false) {
  if (input === undefined || input === null || input === '') return fallback;
  if (typeof input === 'boolean') return input;
  if (typeof input === 'number') return input !== 0;
  return ['1','TRUE','SIM','S','YES','ATIVO'].includes(normalizeText(input));
}
function normalizeText(input) {
  return String(input || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
}
function plateKey(input) { return normalizeText(input).replace(/[^A-Z0-9]/g,''); }
function allocationRegionKey(input){let key=normalizeText(input);if(key==='STR')key='SRT';if(key==='MARANHAO'||key==='MA')key='MARANHAO';return key;}
function isSundayDate(input) {
  const day=dateIso(input); if(!day)return false;
  const [y,m,d]=day.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d)).getUTCDay()===0;
}
function normalizeKey(input) { return normalizeText(input).replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,''); }
function clean(input, max = 500) { return String(input ?? '').trim().slice(0,max); }
function dateIso(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 20000 && serial < 100000) {
    return new Date(Date.UTC(1899,11,30) + Math.round(serial) * 86400000).toISOString().slice(0,10);
  }
  return '';
}
function timeOnly(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const match = raw.match(/(?:T|\s|^)(\d{1,2}):(\d{2})/);
  if (match) return `${String(match[1]).padStart(2,'0')}:${match[2]}`;
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial >= 0 && serial < 1) {
    const minutes = Math.round(serial * 1440) % 1440;
    return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
  }
  return '';
}
function dateTimeLocal(input, dateHint = '') {
  const raw = String(input || '').trim();
  if (!raw) return '';
  let match = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}:\d{2})/);
  if (match) return `${match[1]}T${String(match[2]).padStart(5,'0')}`;
  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})[T\s]+(\d{1,2}:\d{2})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}T${String(match[4]).padStart(5,'0')}`;
  const time = timeOnly(raw);
  return time && dateHint ? `${dateHint}T${time}` : '';
}
function localDateTime(date, time) {
  const day = dateIso(date);
  const clock = timeOnly(time);
  if (!day || !clock) return null;
  const parsed = new Date(`${day}T${clock}:00${TZ_OFFSET}`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
function parseOperationalDateTime(date, input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const local = dateTimeLocal(raw, dateIso(date));
  if (!local) return null;
  const parsed = new Date(`${local}:00${TZ_OFFSET}`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
function formatLocalDateTime(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
  const shifted = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0,10)}T${shifted.toISOString().slice(11,16)}`;
}
function displayDateTime(date) {
  const local = formatLocalDateTime(date);
  if (!local) return '';
  const [day,time] = local.split('T');
  const [year,month,datePart] = day.split('-');
  return `${datePart}/${month}/${year} ${time}`;
}
function addDays(date, amount) {
  const day = dateIso(date);
  if (!day) return '';
  const parsed = new Date(`${day}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + Number(amount || 0));
  return parsed.toISOString().slice(0,10);
}
function endOfDay(date) {
  const day = dateIso(date);
  return day ? new Date(`${day}T23:59:59${TZ_OFFSET}`) : null;
}
function sameDate(left,right) { return dateIso(left) && dateIso(left) === dateIso(right); }
function normalizeRegion(region, route = '') {
  const direct = normalizeText(region);
  const aliases = { STR:'SRT', CEARA:'CE', MARANHAO:'MARANHAO' };
  const allowed = ['AG1','AG2','SRT','PB','AL','RN','CE','BJ','MARANHAO'];
  if (allowed.includes(aliases[direct] || direct)) return aliases[direct] || direct;
  const match = normalizeText(route).match(/^(AG1|AG2|SRT|STR|PB|AL|RN|CE|BJ|MARANHAO)\b/);
  return match ? (aliases[match[1]] || match[1]) : 'OUTRA';
}
function normalizeLoadOrders(input) {
  const parts = String(input || '').replace(/\r?\n/g,'/').split(/[\/,;+|]+/).map((item)=>item.trim()).filter(Boolean);
  const seen = new Set();
  return parts.filter((item)=>{ const key = normalizeKey(item); if (seen.has(key)) return false; seen.add(key); return true; }).join(' / ');
}
function isAdministrativeNoLoadRoute(routeName) {
  const route = normalizeText(routeName).replace(/[^A-Z0-9]+/g,' ').trim();
  return /\b(MANOBRA|VENEZA|MANUTENCAO|CAIXA|CAIXAS|ALMOXARIFADO|SERVICO ADM|SERVICO ADMINISTRATIVO)\b/.test(route);
}
function isNonDepartureSchedule(schedule) { return !normalizeLoadOrders(schedule.ocs || schedule.CARGA) || isAdministrativeNoLoadRoute(schedule.rota || schedule.ROTA); }
function isTransferredSchedule(schedule) { return String(schedule.observacoes || schedule.OBSERVACOES || '').includes('[TRANSFERIDA_DA_ESCALA:'); }
function parseKgToTon(input, fallback = null) {
  const raw = String(input ?? '').trim();
  if (!raw) return fallback;
  const normalizedValue = raw.replace(/\s/g,'').replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'');
  const kilograms = Number(normalizedValue);
  if (!Number.isFinite(kilograms)) return fallback;
  return kilograms / 1000;
}
function tonToKg(value) { return Math.round(Math.max(0, Number(value || 0)) * 100000) / 100; }
// Alguns registros históricos foram gravados com peso em kg dentro da coluna
// nominalmente em toneladas. Como um caminhão da operação não transporta
// centenas/milhares de toneladas, normalizamos valores acima de 150 como kg.
// O mesmo vale para peso_kg inflado 1000x por migrações antigas.
function normalizeWeightPair(tonsInput=0,kgInput=0) {
  let tons=Number(String(tonsInput??0).replace(',','.'))||0;
  let kg=Number(String(kgInput??0).replace(',','.'))||0;
  if(tons>150) tons=tons/1000;
  if(!tons&&kg>0){
    if(kg>150000) kg=kg/1000;
    tons=kg/1000;
  }
  tons=Math.max(0,tons);
  return {tons,kg:tonToKg(tons)};
}
function generateId(prefix = 'ESC') { return `${prefix}-${crypto.randomUUID().toUpperCase()}`; }
function nowIso() { return new Date().toISOString(); }

async function tableExists(db, table) {
  const key=String(table||'').toUpperCase();
  if (existingTableCache.has(key)) return true;
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND UPPER(name)=?").bind(key).first();
  const exists=Boolean(row?.name);
  // Só cacheamos resultados positivos: uma tabela criada por migration depois
  // de um cold start continua podendo ser descoberta sem reiniciar o Worker.
  if (exists) existingTableCache.add(key);
  return exists;
}
async function latestResourceStatusMap(db, date) {
  const map=new Map();
  if (!(await tableExists(db,'ROUTE_RESOURCE_EVENTS'))) return map;
  const selected=dateIso(date);
  if(!selected)return map;
  const start=addDays(selected,-45);
  const end=`${selected}T23:59:59`;
  // v1.0.12: não reprocessa todo o histórico de eventos em cada salvamento.
  // Estados operacionais são transitórios; 45 dias cobrem com ampla folga a
  // operação em rota, enquanto férias/afastamentos/reservas duráveis continuam
  // vindo do cadastro e das tabelas próprias. O filtro por DATE_KEY usa o índice
  // IDX_ROUTE_RES_EVENT_DATE e reduz bastante o custo do D1 em horário de pico.
  const result=await db.prepare(`SELECT RESOURCE_TYPE,RESOURCE_KEY,RESOURCE_ID,RESOURCE_NAME,STATUS,EFFECTIVE_AT,SOURCE,SCHEDULE_RECORD_ID FROM (
    SELECT RESOURCE_TYPE,RESOURCE_KEY,RESOURCE_ID,RESOURCE_NAME,STATUS,EFFECTIVE_AT,SOURCE,SCHEDULE_RECORD_ID,ID,
      ROW_NUMBER() OVER (PARTITION BY RESOURCE_TYPE,RESOURCE_KEY ORDER BY EFFECTIVE_AT DESC,ID DESC) AS RN
    FROM ROUTE_RESOURCE_EVENTS
    WHERE DATE_KEY>=? AND DATE_KEY<=? AND EFFECTIVE_AT<=?
  ) WHERE RN=1`).bind(start,selected,end).all();
  for(const row of result.results||[]){
    const type=normalizeText(row.RESOURCE_TYPE);
    const status=normalizeText(row.STATUS);
    const value={status,effectiveAt:String(row.EFFECTIVE_AT||''),source:String(row.SOURCE||'EVENTO').toUpperCase(),scheduleRecordId:String(row.SCHEDULE_RECORD_ID||'').trim()};
    const id=String(row.RESOURCE_ID||'').trim();
    const name=normalizeText(row.RESOURCE_NAME||'');
    if(id){map.set(`${type}|ID|${id}`,value);if(type==='COLABORADOR'){map.set(`MOTORISTA|ID|${id}`,value);map.set(`AJUDANTE|ID|${id}`,value);}}
    if(name){map.set(`${type}|NAME|${name}`,value);if(type==='COLABORADOR'){map.set(`MOTORISTA|NAME|${name}`,value);map.set(`AJUDANTE|NAME|${name}`,value);}}
  }
  return map;
}
async function latestManualReleaseMap(db,date){
  const map=new Map();
  if(!(await tableExists(db,'ROUTE_RESOURCE_EVENTS')))return map;
  const selected=dateIso(date);if(!selected)return map;
  const start=addDays(selected,-45);
  const result=await db.prepare(`SELECT RESOURCE_TYPE,RESOURCE_KEY,RESOURCE_ID,RESOURCE_NAME,EFFECTIVE_AT,SCHEDULE_RECORD_ID,ID
    FROM ROUTE_RESOURCE_EVENTS
    WHERE DATE_KEY>=? AND DATE_KEY<=? AND UPPER(COALESCE(SOURCE,''))='MANUAL' AND UPPER(COALESCE(STATUS,'')) IN ('DISPONÍVEL','DISPONIVEL')
    ORDER BY EFFECTIVE_AT DESC,ID DESC LIMIT 5000`).bind(start,selected).all();
  const put=(type,id,name,row)=>{
    const normType=normalizeText(type);const sid=String(id||'').trim();const sname=normType==='VEICULO'?plateKey(name):normalizeText(name);
    const value={status:'DISPONÍVEL',effectiveAt:String(row.EFFECTIVE_AT||''),scheduleRecordId:String(row.SCHEDULE_RECORD_ID||'').trim(),source:'MANUAL'};
    for(const key of [sid?`${normType}|ID|${sid}`:'',sname?`${normType}|NAME|${sname}`:''].filter(Boolean))if(!map.has(key))map.set(key,value);
    if(normType==='COLABORADOR'){
      for(const role of ['MOTORISTA','AJUDANTE'])for(const key of [sid?`${role}|ID|${sid}`:'',sname?`${role}|NAME|${sname}`:''].filter(Boolean))if(!map.has(key))map.set(key,value);
    }
  };
  for(const row of result.results||[])put(row.RESOURCE_TYPE,row.RESOURCE_ID,row.RESOURCE_NAME,row);
  return map;
}

async function latestReturnReleaseMap(db,date){
  const map=new Map();const selected=dateIso(date);if(!selected||!(await tableExists(db,'ROUTE_RETURNS')))return map;
  const start=addDays(selected,-30);
  const result=await db.prepare(`SELECT DATE_KEY,RETURN_AT,PLATE,DRIVER_NAME,DATA_JSON FROM ROUTE_RETURNS WHERE DATE_KEY>=? AND DATE_KEY<=? AND RETURN_AT IS NOT NULL AND TRIM(RETURN_AT)<>'' ORDER BY RETURN_AT DESC,ID DESC LIMIT 5000`).bind(start,selected).all();
  const put=(type,id,name,at)=>{
    const value={status:'DISPONÍVEL',effectiveAt:at,source:'RETORNO'};const normType=normalizeText(type);const sid=String(id||'').trim(),sname=normType==='VEICULO'?plateKey(name):normalizeText(name);
    for(const key of [sid?`${normType}|ID|${sid}`:'',sname?`${normType}|NAME|${sname}`:''].filter(Boolean)){const current=map.get(key);if(!current||String(at)>String(current.effectiveAt))map.set(key,value);}
  };
  for(const row of result.results||[]){
    const data=parseData(row.DATA_JSON)||{};const at=dateTimeLocal(row.RETURN_AT||data.retorno_real,row.DATE_KEY);if(!at)continue;
    put('VEICULO',data.veiculo_id||data.VEICULO_ID,row.PLATE||data.placa||data.PLACA,at);
    put('MOTORISTA',data.motorista_id||data.MOTORISTA_ID,row.DRIVER_NAME||data.motorista||data.MOTORISTA,at);
    put('AJUDANTE',data.ajudante_1_id||data.AJUDANTE_1_ID,data.ajudante_1||data.AJUDANTE_1,at);
    put('AJUDANTE',data.ajudante_2_id||data.AJUDANTE_2_ID,data.ajudante_2||data.AJUDANTE_2,at);
  }
  return map;
}

function explicitCatalogAvailability(rows,date,type,id){
  return (rows||[]).some((row)=>{
    const rowType=normalizeText(value(row,'TIPO_RECURSO')),wanted=normalizeText(type);
    const typeMatch=rowType===wanted||(['MOTORISTA','AJUDANTE'].includes(wanted)&&rowType==='COLABORADOR');
    return sameDate(value(row,'DATA_DISPONIBILIDADE'),date)&&typeMatch&&String(value(row,'RECURSO_ID'))===String(id)&&normalizeText(value(row,'STATUS'))!=='CANCELADO';
  });
}
const TRANSIENT_CATALOG_STATUSES=new Set(['EM ROTA','PERNOITE','RETORNOU','FINALIZADO','PROGRAMADO','LIBERADO','SÉTIMO','SETIMO','SÉTIMO DIA','SETIMO DIA','7º DIA','7° DIA','7O DIA','7 DIA']);
function displayCatalogStatus(status){const n=normalizeText(status);if(['SÉTIMO','SETIMO','SÉTIMO DIA','SETIMO DIA','7º DIA','7° DIA','7O DIA','7 DIA'].includes(n))return 'DISPONÍVEL';return ({DISPONIVEL:'DISPONÍVEL',FERIAS:'FÉRIAS',MANUTENCAO:'MANUTENÇÃO'})[n]||n||'DISPONÍVEL';}
const HARD_EMPLOYEE_STATUSES=new Set(['FÉRIAS','FERIAS','ATESTADO','AFASTADO','RESERVADO','BLOQUEADO','DESLIGADO','INATIVO','FOLGA AGENDADA']);
const HARD_VEHICLE_STATUSES=new Set(['MANUTENÇÃO','MANUTENCAO','RESERVADO','BLOQUEADO','ANOMALIA','INATIVO']);
function latestOperationalCandidate(...items){
  return items.filter(Boolean).sort((a,b)=>String(b.effectiveAt||'').localeCompare(String(a.effectiveAt||'')))[0]||null;
}
function catalogStatusReferences(row,type,eventMap,returnMap){
  const id=text(row,'ID') || (type==='VEICULO'?text(row,'PLACA'):text(row,'MATRICULA'));
  const name=type==='VEICULO'?text(row,'PLACA'):text(row,'NOME');
  const normalizedType=normalizeText(type);
  const keyById=`${normalizedType}|ID|${id}`;
  const keyByName=`${normalizedType}|NAME|${normalizedType==='VEICULO'?plateKey(name):normalizeText(name)}`;
  // Um evento mais novo gravado apenas por NOME precisa vencer um evento antigo
  // gravado por ID (e vice-versa). O uso anterior de `id || nome` podia manter
  // PERNOITE antigo mesmo após uma liberação mais recente.
  const event=latestOperationalCandidate(eventMap?.get(keyById),eventMap?.get(keyByName));
  const released=latestOperationalCandidate(returnMap?.get(keyById),returnMap?.get(keyByName));
  return {id,name,event,released};
}
function catalogOperationalStatus(row,type,date,eventMap,returnMap,availabilityRows){
  const raw=normalizeText(value(row,'STATUS')||'DISPONÍVEL');
  const {id,event,released}=catalogStatusReferences(row,type,eventMap,returnMap);
  if(explicitCatalogAvailability(availabilityRows,date,type,id))return 'DISPONÍVEL';
  const hard=type==='VEICULO'?HARD_VEHICLE_STATUSES:HARD_EMPLOYEE_STATUSES;
  if(hard.has(raw))return displayCatalogStatus(raw);
  if(released&&(!event?.effectiveAt||String(released.effectiveAt)>=String(event.effectiveAt)))return 'DISPONÍVEL';
  if(event?.status)return displayCatalogStatus(event.status);
  // EM ROTA/PERNOITE gravados no cadastro são estados transitórios e envelhecem.
  // Sem evidência operacional atual, não podem manter o recurso bloqueado na Escala.
  if(TRANSIENT_CATALOG_STATUSES.has(raw))return 'DISPONÍVEL';
  return displayCatalogStatus(raw);
}

async function columnsFor(db, table) {
  const key=String(table||'').toUpperCase();
  if (columnCache.has(key)) return columnCache.get(key);
  if (!(await tableExists(db, key))) return new Set();
  const result = await db.prepare(`PRAGMA table_info(${quote(key)})`).all();
  const columns=new Set((result.results || []).map((row)=>String(row.name || '').toUpperCase()));
  columnCache.set(key,columns);
  return columns;
}
async function readAll(db, table, where = '', binds = [], limit = 50000) {
  if (!(await tableExists(db, table))) return [];
  const sql = `SELECT * FROM ${quote(table)} ${where ? `WHERE ${where}` : ''} LIMIT ?`;
  const result = await db.prepare(sql).bind(...binds,limit).all();
  return result.results || [];
}
async function settingsMap(db) {
  const settings = new Map();
  for (const row of await readAll(db,'CONFIGURACOES','',[],5000)) settings.set(normalizeText(value(row,'CHAVE')), value(row,'VALOR'));
  return settings;
}
function setting(settings,key,fallback) {
  const found = settings.get(normalizeText(key));
  return found === undefined || found === null || String(found).trim() === '' ? fallback : found;
}
function defaultDepartureTime(date, settings) {
  const day = dateIso(date);
  if (!day) return String(setting(settings,'HORA_SAIDA_TERCA_SABADO','06:00'));
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday === 1 ? String(setting(settings,'HORA_SAIDA_SEGUNDA','05:00')) : String(setting(settings,'HORA_SAIDA_TERCA_SABADO','06:00'));
}
function journeyLimit(start, settings) {
  const normal = Math.max(0,Math.round(Number(setting(settings,'JORNADA_NORMAL_MIN',528)) || 528));
  const overtime = Math.max(0,Math.round(Number(setting(settings,'HORA_EXTRA_MAX_MIN',120)) || 120));
  const productive = Math.max(0,Math.round(Number(setting(settings,'JORNADA_TOTAL_MIN',normal + overtime)) || normal + overtime));
  const interval = Math.max(0,Math.round(Number(setting(settings,'INTERVALO_JORNADA_MIN',60)) || 60));
  return new Date(start.getTime() + (productive + interval) * 60000);
}

async function scheduleSchemaReady(db) {
  try {
    const expected = ['ROUTE_LOCKS','ROUTE_SCHEDULE_REQUESTS','IDX_ROUTE_SCHEDULE_REQUEST_CREATED'];
    const placeholders = expected.map(() => '?').join(',');
    const result = await db.prepare(`SELECT name FROM sqlite_master WHERE name IN (${placeholders})`).bind(...expected).all();
    const found = new Set((result.results || []).map((row) => String(row.name || '')));
    return expected.every((name) => found.has(name));
  } catch {
    return false;
  }
}

async function ensureScheduleTemperatureColumn(db) {
  if (!(await tableExists(db,'ESCALAS_DIA'))) return;
  const result = await db.prepare('PRAGMA table_info(ESCALAS_DIA)').all();
  const columns = new Set((result.results || []).map((row)=>String(row.name || '').toUpperCase()));
  if (!columns.has('TEMPERATURA_FRIO_C')) {
    await db.prepare('ALTER TABLE ESCALAS_DIA ADD COLUMN TEMPERATURA_FRIO_C REAL').run();
    columnCache.delete('ESCALAS_DIA');
  }
}

async function ensureScheduleSchema(db) {
  if (!schemaPromise) {
    schemaPromise = (async()=>{
      await ensureCoreSchema(db);
      await ensureScheduleTemperatureColumn(db);
      if (await scheduleSchemaReady(db)) return;
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_LOCKS (
          LOCK_KEY TEXT PRIMARY KEY, OWNER TEXT, EXPIRES_AT TEXT, UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`),
        db.prepare(`INSERT OR IGNORE INTO ROUTE_LOCKS (LOCK_KEY,OWNER,EXPIRES_AT) VALUES ('SCHEDULE',NULL,NULL)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_SCHEDULE_REQUESTS (
          REQUEST_ID TEXT PRIMARY KEY, RESPONSE_JSON TEXT, CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_SCHEDULE_REQUEST_CREATED ON ROUTE_SCHEDULE_REQUESTS(CREATED_AT)`),
      ]);
    })().catch((error)=>{ schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

function scheduleLockToken(value, max = 120) {
  return normalizeText(value).replace(/[^A-Z0-9:_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,max);
}
function scheduleLockKeys(rows = [], dateValue = '') {
  const date = dateIso(dateValue) || 'SEM_DATA';
  const keys = new Set();
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    if (!row || typeof row !== 'object') continue;

    // v1.0.7: duplicidade de veículo, motorista e ajudantes é bloqueante.
    // As travas continuam granulares por recurso — nunca voltam a ser um lock
    // global da Escala — para preservar concorrência entre equipes diferentes.
    const resources=[
      ['VEHICLE',row.veiculo_id ?? row.VEICULO_ID ?? row.placa ?? row.PLACA],
      ['DRIVER',row.motorista_id ?? row.MOTORISTA_ID ?? row.motorista ?? row.MOTORISTA],
      ['HELPER',row.ajudante_1_id ?? row.AJUDANTE_1_ID ?? row.ajudante_1 ?? row.AJUDANTE_1],
      ['HELPER',row.ajudante_2_id ?? row.AJUDANTE_2_ID ?? row.ajudante_2 ?? row.AJUDANTE_2],
    ];
    for(const [type,value] of resources){const token=scheduleLockToken(value,120);if(token)keys.add(`SCHEDULE:${type}:${token}`);}

    // Rotas administrativas sem qualquer recurso ainda precisam de uma trava de linha.
    if (!resources.some(([,value])=>String(value??'').trim())) {
      const id = row.id ?? row.ID;
      const storage = scheduleLockToken(row.storage || row.sourceTable || 'AUTO',40) || 'AUTO';
      if (id !== null && id !== undefined && String(id).trim()) keys.add(`SCHEDULE:ROW:${storage}:${scheduleLockToken(id)}`);
      else {const sequence=scheduleLockToken(row.sequencia ?? row.SEQUENCIA_CARREGAMENTO,60);if(sequence&&sequence!=='0')keys.add(`SCHEDULE:SEQ:${date}:${sequence}`);}
    }
  }
  if (!keys.size) keys.add(`SCHEDULE:FALLBACK:${date}`);
  return [...keys].sort();
}
const SCHEDULE_LOCK_SQL=`INSERT INTO ROUTE_LOCKS (LOCK_KEY,OWNER,EXPIRES_AT,UPDATED_AT)
  VALUES (?,?,?,CURRENT_TIMESTAMP)
  ON CONFLICT(LOCK_KEY) DO UPDATE SET
    OWNER=excluded.OWNER,
    EXPIRES_AT=excluded.EXPIRES_AT,
    UPDATED_AT=CURRENT_TIMESTAMP
  WHERE ROUTE_LOCKS.OWNER IS NULL
     OR ROUTE_LOCKS.EXPIRES_AT IS NULL
     OR ROUTE_LOCKS.EXPIRES_AT < CURRENT_TIMESTAMP`;
async function releaseLocks(db, keys, owner) {
  if (!owner || !keys.length) return;
  const statements=keys.map((key)=>db.prepare(`UPDATE ROUTE_LOCKS
    SET OWNER=NULL,EXPIRES_AT=NULL,UPDATED_AT=CURRENT_TIMESTAMP
    WHERE LOCK_KEY=? AND OWNER=?`).bind(key,owner));
  if (statements.length) await db.batch(statements);
}
async function acquireLocks(db, keys) {
  await ensureScheduleSchema(db);
  const owner=crypto.randomUUID();
  for (let attempt=0; attempt<8; attempt+=1) {
    const expires=new Date(Date.now()+30000).toISOString().replace('T',' ').slice(0,19);
    const results=await db.batch(keys.map((key)=>db.prepare(SCHEDULE_LOCK_SQL).bind(key,owner,expires)));
    if (results.length===keys.length && results.every((result)=>Number(result.meta?.changes||0)===1)) return owner;
    await releaseLocks(db,keys,owner).catch(()=>{});
    await new Promise((resolve)=>setTimeout(resolve,70 + attempt*45));
  }
  const error=new Error('Outra alteração deste mesmo veículo está sendo processada. Tente novamente em alguns segundos.');
  error.code='RESOURCE_LOCKED';
  throw error;
}
async function withScheduleLocks(db, rows, dateValue, callback) {
  const keys=scheduleLockKeys(rows,dateValue);
  const owner=await acquireLocks(db,keys);
  try { return await callback(); }
  finally { await releaseLocks(db,keys,owner).catch(()=>{}); }
}

// Compartilha exatamente as mesmas travas granulares da Escala com operações
// que alteram recursos fora do editor (ex.: troca de equipe no Controle de Saída).
// Assim, duas viagens diferentes continuam concorrentes, mas duas tentativas de
// alocar o mesmo veículo/motorista/ajudante são serializadas entre telas.
export async function withScheduleResourceLocks(db, rows, dateValue, callback) {
  return withScheduleLocks(db,rows,dateValue,callback);
}

function assertScheduleAccess(user, write = false) {
  const role = normalizeText(user?.role);
  if (role === 'ADMIN') return;
  const bases = Array.isArray(user?.bases) ? user.bases : [];
  if (!bases.includes('route')) throw new Error('Você não tem acesso a este módulo.');
  const permissions = user?.permissions;
  if (permissions && !Array.isArray(permissions) && normalizeText(permissions.mode) === 'REPLACE') {
    const screens = Array.isArray(permissions.screens) ? permissions.screens : [];
    if (!screens.includes('route.schedule')) throw new Error('Você não tem acesso a esta tela.');
  }
  if (write && role === 'CONSULTA') throw new Error('Seu usuário não possui permissão para alterar escalas.');
}

function scheduleFromLegacy(row) {
  const date = dateIso(value(row,'DATA'));
  const weight=normalizeWeightPair(numberValue(row,'PESO_CARGA_TON'),0);
  return {
    id:text(row,'ID'), storage:'ESCALAS_DIA', sourceTable:'ESCALAS_DIA', sourceKey:text(row,'ID'), legacy:true,
    data:date, sequencia:text(row,'SEQUENCIA_CARREGAMENTO'), ocs:text(row,'CARGA'), qtd_entregas:numberValue(row,'QTD_ENTREGAS'),
    peso_t:weight.tons, peso_kg:weight.kg, temperatura_frio_c:optionalNumberValue(value(row,'TEMPERATURA_FRIO_C')),
    horario_ponto:timeOnly(value(row,'HORA_SAIDA_PROGRAMADA')), rota_id:text(row,'ROTA_ID'), rota:text(row,'ROTA','DESTINO'), destino:text(row,'DESTINO'),
    regiao:normalizeRegion(value(row,'REGIAO'),value(row,'ROTA')), duracao_dias:Math.max(1,Math.round(numberValue(row,'DURACAO_DIAS') || 1)),
    veiculo_id:text(row,'VEICULO_ID'), placa:text(row,'PLACA'), motorista_id:text(row,'MOTORISTA_ID'), motorista:text(row,'MOTORISTA'),
    ajudante_1_id:text(row,'AJUDANTE_1_ID'), ajudante_1:text(row,'AJUDANTE_1'), ajudante_2_id:text(row,'AJUDANTE_2_ID'), ajudante_2:text(row,'AJUDANTE_2'),
    ajudantes:[text(row,'AJUDANTE_1'),text(row,'AJUDANTE_2')].filter(Boolean).join(' / '), tipo_equipe:text(row,'TIPO_EQUIPE') || 'UM_AJUDANTE',
    carga_fechada:boolValue(value(row,'CARGA_FECHADA')), previsao_termino:dateTimeLocal(value(row,'PREVISAO_TERMINO'),date),
    previsao_retorno:dateTimeLocal(value(row,'PREVISAO_RETORNO'),date), limite_jornada:dateTimeLocal(value(row,'LIMITE_JORNADA'),date),
    status:text(row,'STATUS') || 'PROGRAMADO', observacoes:text(row,'OBSERVACOES'), criado_em:text(row,'CRIADO_EM'), atualizado_em:text(row,'ATUALIZADO_EM'), usuario:text(row,'USUARIO'),
  };
}
function scheduleFromDms(row) {
  const data = parseData(row.DATA_JSON);
  const date = dateIso(data.data || data.DATA || row.DATE_KEY);
  const helperList = String(data.ajudantes || '').split(/\s*(?:\/|;|\||,)\s*/).filter(Boolean);
  const weight=normalizeWeightPair(data.peso_t ?? data.PESO_CARGA_TON ?? 0,data.peso_kg ?? 0);
  return {
    id:Number(row.ID), storage:'ROUTE_RECORDS',
    data:date, sequencia:clean(data.sequencia ?? data.SEQUENCIA_CARREGAMENTO), ocs:normalizeLoadOrders(data.ocs ?? data.CARGA), qtd_entregas:Number(data.qtd_entregas ?? data.QTD_ENTREGAS ?? 0) || 0,
    peso_t:weight.tons,
    peso_kg:weight.kg,
    temperatura_frio_c:optionalNumberValue(data.temperatura_frio_c ?? data.TEMPERATURA_FRIO_C),
    horario_ponto:timeOnly(data.horario_ponto ?? data.HORA_SAIDA_PROGRAMADA), rota_id:clean(data.rota_id ?? data.ROTA_ID), rota:clean(data.rota ?? data.ROTA ?? data.destino ?? data.DESTINO), destino:clean(data.destino ?? data.DESTINO),
    regiao:normalizeRegion(data.regiao ?? data.REGIAO,data.rota ?? data.ROTA), duracao_dias:Math.max(1,Math.round(Number(data.duracao_dias ?? data.DURACAO_DIAS ?? 1) || 1)),
    veiculo_id:clean(data.veiculo_id ?? data.VEICULO_ID), placa:clean(data.placa ?? data.PLACA), motorista_id:clean(data.motorista_id ?? data.MOTORISTA_ID), motorista:clean(data.motorista ?? data.MOTORISTA),
    ajudante_1_id:clean(data.ajudante_1_id ?? data.AJUDANTE_1_ID), ajudante_1:clean(data.ajudante_1 ?? data.AJUDANTE_1 ?? helperList[0]),
    ajudante_2_id:clean(data.ajudante_2_id ?? data.AJUDANTE_2_ID), ajudante_2:clean(data.ajudante_2 ?? data.AJUDANTE_2 ?? helperList[1]),
    ajudantes:[clean(data.ajudante_1 ?? data.AJUDANTE_1 ?? helperList[0]),clean(data.ajudante_2 ?? data.AJUDANTE_2 ?? helperList[1])].filter(Boolean).join(' / '),
    tipo_equipe:clean(data.tipo_equipe ?? data.TIPO_EQUIPE ?? data.equipe) || 'UM_AJUDANTE', carga_fechada:boolValue(data.carga_fechada ?? data.CARGA_FECHADA),
    previsao_termino:dateTimeLocal(data.previsao_termino ?? data.PREVISAO_TERMINO,date), previsao_retorno:dateTimeLocal(data.previsao_retorno ?? data.PREVISAO_RETORNO,date),
    limite_jornada:dateTimeLocal(data.limite_jornada ?? data.LIMITE_JORNADA,date), status:clean(data.status ?? data.STATUS ?? row.STATUS) || 'PROGRAMADO',
    observacoes:clean(data.observacoes ?? data.OBSERVACOES,4000), criado_em:row.CREATED_AT, atualizado_em:row.UPDATED_AT, usuario:clean(data.usuario ?? data.USUARIO),
    avisos:Array.isArray(data.avisos) ? data.avisos : Array.isArray(data.AVISOS) ? data.AVISOS : [], aviso_detalhes:Array.isArray(data.aviso_detalhes) ? data.aviso_detalhes : [],
  };
}
function sortSchedules(left,right) {
  return String(left.data).localeCompare(String(right.data)) || Number(isNonDepartureSchedule(left)) - Number(isNonDepartureSchedule(right)) || Number(isTransferredSchedule(right)) - Number(isTransferredSchedule(left)) ||
    (Number(left.sequencia || 999999) - Number(right.sequencia || 999999)) || String(left.rota || '').localeCompare(String(right.rota || ''),'pt-BR');
}

async function loadSchedules(db, filters = {}) {
  const records = [];
  if (await tableExists(db,'ESCALAS_DIA')) {
    const columns = await columnsFor(db,'ESCALAS_DIA');
    let rows;
    if (columns.has('DATA') && (filters.date || filters.start || filters.end)) {
      // DATA é armazenada no início do texto em formato ISO. Evite SUBSTR/CAST no
      // predicado: isso impedia o SQLite/D1 de usar IDX_ROUTE_ESCALA_DATA e fazia
      // várias telas varrerem toda a ESCALAS_DIA, principal causa dos picos de 503.
      const clauses=[]; const binds=[];
      if (filters.date) {
        const day=dateIso(filters.date),next=addDays(day,1);
        clauses.push(`${quote('DATA')}>=? AND ${quote('DATA')}<?`); binds.push(day,next);
      } else {
        if (filters.start) { clauses.push(`${quote('DATA')}>=?`); binds.push(dateIso(filters.start)); }
        if (filters.end) { clauses.push(`${quote('DATA')}<?`); binds.push(addDays(dateIso(filters.end),1)); }
      }
      rows = await readAll(db,'ESCALAS_DIA',clauses.join(' AND '),binds,12000);
    } else rows = await readAll(db,'ESCALAS_DIA','',[],12000);
    records.push(...rows.map(scheduleFromLegacy));
  }
  await ensureCoreSchema(db);
  const clauses = ["MODULE='schedule'"];
  const binds = [];
  // O editor da Escala sempre trabalha por dia. Antes, filters.date era aplicado
  // só depois do SELECT e ROUTE_RECORDS podia ler até 50 mil escalas históricas
  // para abrir um único dia, aumentando muito a chance de timeout/503.
  if (filters.date) { clauses.push('DATE_KEY=?'); binds.push(filters.date); }
  else {
    if (filters.start) { clauses.push('DATE_KEY>=?'); binds.push(filters.start); }
    if (filters.end) { clauses.push('DATE_KEY<=?'); binds.push(filters.end); }
  }
  const result = await db.prepare(`SELECT * FROM ROUTE_RECORDS WHERE ${clauses.join(' AND ')} ORDER BY DATE_KEY,ID LIMIT 50000`).bind(...binds).all();
  for (const row of result.results || []) {
    records.push(scheduleFromDms(row));
  }
  const query = normalizeText(filters.q);
  return records.filter((item)=>{
    if (filters.date && item.data !== filters.date) return false;
    if (filters.start && item.data < filters.start) return false;
    if (filters.end && item.data > filters.end) return false;
    if (filters.status && normalizeText(item.status) !== normalizeText(filters.status)) return false;
    if (filters.region && normalizeRegion(item.regiao,item.rota) !== normalizeRegion(filters.region)) return false;
    if (query && !normalizeText([item.sequencia,item.ocs,item.rota,item.placa,item.motorista,item.ajudante_1,item.ajudante_2].join(' ')).includes(query)) return false;
    return true;
  }).sort(sortSchedules);
}

function employeeRoleText(row={}) {
  // Lê primeiro a função operacional e usa CARGO apenas como compatibilidade
  // com registros históricos/importados. O retorno é sempre normalizado.
  return normalizeText(value(row,'FUNCAO','FUNÇÃO','CARGO','CARGO_FUNCAO'));
}
function helperMetadataFlag(row={}) {
  const city=clean(value(row,'CIDADE_ROTA'));
  const servedRoutes=clean(value(row,'ROTAS_ATENDIDAS'));
  return boolValue(value(row,'AJUDANTE_ROTA')) || Boolean(city || servedRoutes);
}
function employeeFunctionFromCatalog(row={}) {
  const role=employeeRoleText(row);
  // Importante: "AJUDANTE DE MOTORISTA" é AJUDANTE. A ordem anterior da
  // Central podia classificar esse cargo como MOTORISTA apenas por conter a
  // palavra "MOTORISTA". Também aceitamos CONDUTOR/CARRETEIRO como motorista.
  if(role.includes('AJUDANTE'))return 'AJUDANTE';
  if(role.includes('MOTORISTA')||role.includes('CARRETEIRO')||role.includes('CONDUTOR'))return 'MOTORISTA';
  // Metadados de ajudante de rota só inferem a função quando não existe uma
  // função explícita de motorista. Isso evita que CIDADE_ROTA/ROTAS_ATENDIDAS
  // antigos transformem um MOTORISTA disponível em AJUDANTE no seletor.
  if(helperMetadataFlag(row) && (!role || role.includes('AUXILIAR')))return 'AJUDANTE';
  if(role.includes('AUXILIAR') && (role.includes('ENTREGA')||role.includes('CARGA')||role.includes('ROTA')))return 'AJUDANTE';
  return role;
}
function routeHelperFlag(row={}) {
  if(employeeFunctionFromCatalog(row)!=='AJUDANTE')return false;
  const role=employeeRoleText(row);
  return boolValue(value(row,'AJUDANTE_ROTA'))
    || /\b(AJUDANTE|AUXILIAR).*\bROTA\b/.test(role)
    || helperMetadataFlag(row);
}
function employeeStatusFromCatalog(row,selected,eventMap,returnMap,availabilityRows) {
  const vacationStart=dateIso(value(row,'FERIAS_INICIO'));
  const vacationEnd=dateIso(value(row,'FERIAS_FIM'));
  if(selected&&vacationStart&&vacationEnd&&selected>=vacationStart&&selected<=vacationEnd)return 'FÉRIAS';
  const functionName=employeeFunctionFromCatalog(row);
  const resourceType=functionName==='AJUDANTE'?'AJUDANTE':'MOTORISTA';
  const operational=catalogOperationalStatus(row,resourceType,selected,eventMap,returnMap,availabilityRows);
  // Ajudante de rota pode apoiar outro veículo enquanto está apenas EM ROTA.
  // Aos domingos, PERNOITE da viagem anterior também não bloqueia o planejamento:
  // ajudantes de rota não trabalham no domingo, mas podem ficar escalados para a
  // programação normalmente. Nos demais dias, PERNOITE continua indisponível.
  if(routeHelperFlag(row)){
    if(normalizeText(operational)==='PERNOITE')return isSundayDate(selected)?'DISPONÍVEL':'PERNOITE';
    if(normalizeText(operational)==='EM ROTA')return 'DISPONÍVEL PARA APOIO';
    if(['ESCALADO','INDISPONÍVEL'].includes(normalizeText(operational)))return operational;
  }
  // Domingo é data de planejamento: FOLGA não impede a escolha para uma operação
  // cuja entrega começa na segunda-feira.
  if(isSundayDate(selected)&&normalizeText(operational)==='FOLGA')return 'DISPONÍVEL';
  return operational;
}
async function loadEmployeeCatalogContext(db,date='') {
  const selected=dateIso(date)||new Date().toISOString().slice(0,10);
  const [employeesRaw,eventMap,returnMap,availabilityRows,timeOffRows]=await Promise.all([
    readAll(db,'BASE_COLABORADORES','',[],20000),
    latestResourceStatusMap(db,selected),
    latestReturnReleaseMap(db,selected),
    readAll(db,'DISPONIBILIDADE_RECURSOS',`DATA_DISPONIBILIDADE>=? AND DATA_DISPONIBILIDADE<?`,[selected,addDays(selected,1)],5000),
    readActiveTimeOff(db,selected),
  ]);
  const timeOffToday=timeOffByEmployeeOn(timeOffRows,selected);
  const active=(row)=>boolValue(value(row,'ATIVO'),true);
  const employees=employeesRaw.filter(active).map((row)=>{
    const functionName=employeeFunctionFromCatalog(row);
    const resourceType=functionName==='AJUDANTE'?'AJUDANTE':'MOTORISTA';
    const refs=catalogStatusReferences(row,resourceType,eventMap,returnMap);
    return {
      id:text(row,'ID'),matricula:text(row,'MATRICULA'),nome:text(row,'NOME'),funcao:functionName,vinculo:text(row,'VINCULO'),
      status:applyTimeOffStatus(employeeStatusFromCatalog(row,selected,eventMap,returnMap,availabilityRows),timeOffToday.get(text(row,'ID'))),
      folga_agendada:timeOffToday.has(text(row,'ID')),folga_motivo:timeOffToday.get(text(row,'ID'))?.REASON||'',status_event_at:refs.event?.effectiveAt||'',status_event_source:refs.event?.source||'',status_release_at:refs.released?.effectiveAt||'',
      ajudante_rota:routeHelperFlag(row),cidade_rota:text(row,'CIDADE_ROTA'),rotas_atendidas:text(row,'ROTAS_ATENDIDAS'),
      ferias_inicio:dateIso(value(row,'FERIAS_INICIO')),ferias_fim:dateIso(value(row,'FERIAS_FIM')),restricao_motorista:boolValue(value(row,'RESTRICAO_MOTORISTA')),restricao_ajudante:boolValue(value(row,'RESTRICAO_AJUDANTE')),ativo:true,raw:row,
    };
  }).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  return {selected,employees,eventMap,returnMap,availabilityRows};
}

// Status operacional de hoje (ocupação por viagem aberta, férias, bloqueios) para as
// listas de cadastro. Usa a mesma decoração da Escala/Central de Recursos.
export async function listOperationalResourceStatus(db,date='') {
  const context=await loadOperationalContext(db,date);
  const selected=context.selected||dateIso(date);
  const pick=(items,type)=>decoratePlanningResources(items,context.schedules,type,context,selected).map((item)=>({id:String(item.id),status:item.status}));
  return {
    employees:[...pick(context.drivers,'MOTORISTA'),...pick(context.helpers,'AJUDANTE')],
    vehicles:pick(context.vehicles,'VEICULO'),
  };
}

export async function listScheduleCrewOptions(db,date='') {
  const context=await loadOperationalContext(db,date);
  const selected=context.selected||dateIso(date);
  const decorated=[
    ...decoratePlanningResources(context.drivers,context.schedules,'MOTORISTA',context,selected),
    ...decoratePlanningResources(context.helpers,context.schedules,'AJUDANTE',context,selected),
  ];
  const compact=(item)=>({
    id:item.id,matricula:item.matricula,nome:item.nome,funcao:item.funcao,vinculo:item.vinculo,
    status:item.status,rota_atual:item.rota_atual||'',escala_atual_id:item.escala_atual_id||'',
    motivo_indisponibilidade:!['DISPONÍVEL','DISPONÍVEL PARA APOIO'].includes(item.status)?`${item.status}${item.rota_atual?` · ${item.rota_atual}`:''}`:'',
    ajudante_rota:Boolean(item.ajudante_rota),cidade_rota:item.cidade_rota||'',rotas_atendidas:item.rotas_atendidas||'',
    restricao_motorista:Boolean(item.restricao_motorista),restricao_ajudante:Boolean(item.restricao_ajudante),
  });
  return {date:selected,
    drivers:decorated.filter(item=>item.funcao==='MOTORISTA').map(compact),
    helpers:decorated.filter(item=>item.funcao==='AJUDANTE').sort((a,b)=>Number(Boolean(b.ajudante_rota))-Number(Boolean(a.ajudante_rota))||a.nome.localeCompare(b.nome,'pt-BR')).map(compact),
  };
}

async function loadCatalogContext(db, date, settings) {
  const selected=dateIso(date) || new Date().toISOString().slice(0,10);
  const [vehiclesRaw,routesRaw,employeeCatalog,manualReleaseMap] = await Promise.all([
    readAll(db,'BASE_VEICULOS','',[],10000),
    readAll(db,'BASE_ROTAS','',[],10000),
    loadEmployeeCatalogContext(db,selected),
    latestManualReleaseMap(db,selected),
  ]);
  const {employees,eventMap,returnMap,availabilityRows}=employeeCatalog;
  const active = (row)=>boolValue(value(row,'ATIVO'),true);
  const vehicles = vehiclesRaw.filter(active).map((row)=>({
    id:text(row,'ID'), placa:text(row,'PLACA'), tipo:text(row,'TIPO'), vinculo:text(row,'VINCULO'), status:catalogOperationalStatus(row,'VEICULO',selected,eventMap,returnMap,availabilityRows), ativo:true,
    local_atual:text(row,'LOCAL_ATUAL'), observacoes:text(row,'OBSERVACOES'), apelido:text(row,'APELIDO'), max_motoristas:Math.max(1,Math.min(3,Math.round(numberValue(row,'MAX_MOTORISTAS')||1))), raw:row,
  })).sort((a,b)=>a.placa.localeCompare(b.placa,'pt-BR'));
  const routes = routesRaw.filter(active).map((row)=>({
    id:text(row,'ID'), rota:text(row,'ROTA'), nome:text(row,'ROTA'), regiao:normalizeRegion(value(row,'REGIAO'),value(row,'ROTA')), perfil:text(row,'PERFIL'),tipo_servico:normalizeText(value(row,'TIPO_SERVICO')||'ENTREGA'), duracao_dias:Math.max(1,Math.round(numberValue(row,'DURACAO_DIAS') || 1)), ativo:true, raw:row,
  })).sort((a,b)=>a.rota.localeCompare(b.rota,'pt-BR'));
  const carreteiros=await readCarreteirosRegistry(db);
  return {
    vehicles,employees,carreteiros,
    drivers:carreteiroDriversForSchedule(employees.filter((item)=>item.funcao === 'MOTORISTA'),carreteiros),
    helpers:employees.filter((item)=>item.funcao === 'AJUDANTE')
      .sort((a,b)=>Number(Boolean(b.ajudante_rota))-Number(Boolean(a.ajudante_rota)) || a.nome.localeCompare(b.nome,'pt-BR')),
    routes,settings,availabilityRows,manualReleaseMap,
  };
}


// Escrita da Escala usa um catálogo enxuto. O editor completo precisa consolidar
// eventos/retornos para exibir status em tempo real; o SALVAR não precisa refazer
// essas varreduras para validar identidade, vínculo, férias e conflitos de janela.
// Isso remove do caminho crítico as consultas mais caras de ROUTE_RESOURCE_EVENTS
// e ROUTE_RETURNS que, sob carga, podiam fazer o Worker estourar e devolver 503.
function writeCatalogEmployeeStatus(row,selected) {
  const vacationStart=dateIso(value(row,'FERIAS_INICIO'));
  const vacationEnd=dateIso(value(row,'FERIAS_FIM'));
  if(selected&&vacationStart&&vacationEnd&&selected>=vacationStart&&selected<=vacationEnd)return 'FÉRIAS';
  const raw=displayCatalogStatus(value(row,'STATUS')||'DISPONÍVEL');
  if(isSundayDate(selected)&&routeHelperFlag(row)&&normalizeText(raw)==='PERNOITE')return 'DISPONÍVEL';
  if(isSundayDate(selected)&&normalizeText(raw)==='FOLGA')return 'DISPONÍVEL';
  return raw;
}
async function loadWriteCatalogContext(db,date,settings) {
  const selected=dateIso(date)||new Date().toISOString().slice(0,10);
  const [vehiclesRaw,routesRaw,employeesRaw,availabilityRows,manualReleaseMap,timeOffRows]=await Promise.all([
    readAll(db,'BASE_VEICULOS','',[],10000),
    readAll(db,'BASE_ROTAS','',[],10000),
    readAll(db,'BASE_COLABORADORES','',[],20000),
    readAll(db,'DISPONIBILIDADE_RECURSOS',`DATA_DISPONIBILIDADE>=? AND DATA_DISPONIBILIDADE<?`,[selected,addDays(selected,1)],5000),
    latestManualReleaseMap(db,selected),
    readActiveTimeOff(db,selected),
  ]);
  const timeOffToday=timeOffByEmployeeOn(timeOffRows,selected);
  const active=(row)=>boolValue(value(row,'ATIVO'),true);
  const vehicles=vehiclesRaw.filter(active).map((row)=>({
    id:text(row,'ID'),placa:text(row,'PLACA'),tipo:text(row,'TIPO'),vinculo:text(row,'VINCULO'),status:displayCatalogStatus(value(row,'STATUS')||'DISPONÍVEL'),ativo:true,
    local_atual:text(row,'LOCAL_ATUAL'),observacoes:text(row,'OBSERVACOES'),apelido:text(row,'APELIDO'),max_motoristas:Math.max(1,Math.min(3,Math.round(numberValue(row,'MAX_MOTORISTAS')||1))),raw:row,
  })).sort((a,b)=>a.placa.localeCompare(b.placa,'pt-BR'));
  const employees=employeesRaw.filter(active).map((row)=>({
    id:text(row,'ID'),matricula:text(row,'MATRICULA'),nome:text(row,'NOME'),funcao:employeeFunctionFromCatalog(row),vinculo:text(row,'VINCULO'),
    status:applyTimeOffStatus(writeCatalogEmployeeStatus(row,selected),timeOffToday.get(text(row,'ID'))),folga_agendada:timeOffToday.has(text(row,'ID')),folga_motivo:timeOffToday.get(text(row,'ID'))?.REASON||'',ajudante_rota:routeHelperFlag(row),cidade_rota:text(row,'CIDADE_ROTA'),rotas_atendidas:text(row,'ROTAS_ATENDIDAS'),
    ferias_inicio:dateIso(value(row,'FERIAS_INICIO')),ferias_fim:dateIso(value(row,'FERIAS_FIM')),restricao_motorista:boolValue(value(row,'RESTRICAO_MOTORISTA')),restricao_ajudante:boolValue(value(row,'RESTRICAO_AJUDANTE')),ativo:true,raw:row,
  })).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  const routes=routesRaw.filter(active).map((row)=>({
    id:text(row,'ID'),rota:text(row,'ROTA'),nome:text(row,'ROTA'),regiao:normalizeRegion(value(row,'REGIAO'),value(row,'ROTA')),perfil:text(row,'PERFIL'),tipo_servico:normalizeText(value(row,'TIPO_SERVICO')||'ENTREGA'),
    duracao_dias:Math.max(1,Math.round(numberValue(row,'DURACAO_DIAS')||1)),ativo:true,raw:row,
  })).sort((a,b)=>a.rota.localeCompare(b.rota,'pt-BR'));
  const carreteiros=await readCarreteirosRegistry(db);
  return {
    vehicles,employees,carreteiros,
    drivers:carreteiroDriversForSchedule(employees.filter((item)=>item.funcao==='MOTORISTA'),carreteiros),
    helpers:employees.filter((item)=>item.funcao==='AJUDANTE').sort((a,b)=>Number(Boolean(b.ajudante_rota))-Number(Boolean(a.ajudante_rota))||a.nome.localeCompare(b.nome,'pt-BR')),
    routes,settings,availabilityRows,manualReleaseMap,
  };
}

async function readAllocationPlansForDate(db,date='') {
  const selected=dateIso(date)||new Date().toISOString().slice(0,10);
  try {
    if(!(await tableExists(db,'ROUTE_ALLOCATION_PLAN')))return [];
    let helperColumns='';
    try {
      const {results:columns=[]}=await db.prepare(`PRAGMA table_info(ROUTE_ALLOCATION_PLAN)`).all();
      const names=new Set(columns.map((row)=>normalizeText(row.name)));
      if(names.has('HELPER_ID'))helperColumns=',HELPER_ID,HELPER_NAME';
    } catch {}
    const [{results=[]},{results:vehicleRows=[]},{results:employeeRows=[]}]=await Promise.all([
      db.prepare(`SELECT ID,ROUTE_ID,ROUTE_NAME,REGION,VEHICLE_ID,PLATE,SUBSTITUTE_VEHICLE_ID,SUBSTITUTE_PLATE,DRIVER_ID,DRIVER_NAME,SUBSTITUTE_DRIVER_ID,SUBSTITUTE_DRIVER_NAME${helperColumns},START_DATE,END_DATE,ACTIVE,UPDATED_AT
        FROM ROUTE_ALLOCATION_PLAN
        WHERE ACTIVE=1 AND START_DATE<=? AND (END_DATE IS NULL OR TRIM(END_DATE)='' OR END_DATE>=?)
        ORDER BY UPDATED_AT DESC,START_DATE DESC,PLATE COLLATE NOCASE`).bind(selected,selected).all(),
      db.prepare(`SELECT ID,PLACA,VINCULO,ATIVO FROM BASE_VEICULOS WHERE COALESCE(ATIVO,1)<>0`).all(),
      db.prepare(`SELECT ID,NOME,VINCULO FROM BASE_COLABORADORES`).all(),
    ]);
    const ownVehicleIds=new Set(vehicleRows.filter((row)=>!isThirdPartyLink(row.VINCULO)).map((row)=>String(row.ID||'')));
    const ownVehiclePlates=new Set(vehicleRows.filter((row)=>!isThirdPartyLink(row.VINCULO)).map((row)=>plateKey(row.PLACA)).filter(Boolean));
    const employeeById=new Map(employeeRows.map((row)=>[String(row.ID||''),row])),employeeByName=new Map(employeeRows.map((row)=>[normalizeText(row.NOME),row]));
    const personThird=(id,name)=>{const employee=(id&&employeeById.get(String(id)))||employeeByName.get(normalizeText(name));return Boolean(employee&&isThirdPartyLink(employee.VINCULO));};
    const mapped=results.map((row)=>({
      id:text(row,'ID'),route_id:'',route:'',regiao:'',
      veiculo_id:text(row,'VEHICLE_ID'),placa:text(row,'PLATE'),veiculo_substituto_id:'',placa_substituta:'',
      motorista_id:personThird(text(row,'DRIVER_ID'),text(row,'DRIVER_NAME'))?'':text(row,'DRIVER_ID'),motorista:personThird(text(row,'DRIVER_ID'),text(row,'DRIVER_NAME'))?'':text(row,'DRIVER_NAME'),
      motorista_substituto_id:personThird(text(row,'SUBSTITUTE_DRIVER_ID'),text(row,'SUBSTITUTE_DRIVER_NAME'))?'':text(row,'SUBSTITUTE_DRIVER_ID'),motorista_substituto:personThird(text(row,'SUBSTITUTE_DRIVER_ID'),text(row,'SUBSTITUTE_DRIVER_NAME'))?'':text(row,'SUBSTITUTE_DRIVER_NAME'),
      ajudante_id:personThird(text(row,'HELPER_ID'),text(row,'HELPER_NAME'))?'':text(row,'HELPER_ID'),ajudante:personThird(text(row,'HELPER_ID'),text(row,'HELPER_NAME'))?'':text(row,'HELPER_NAME'),
      vigencia_inicio:dateIso(value(row,'START_DATE')),vigencia_fim:dateIso(value(row,'END_DATE')),ativo:boolValue(value(row,'ACTIVE'),true),atualizado_em:text(row,'UPDATED_AT'),
    })).filter((plan)=>ownVehicleIds.has(String(plan.veiculo_id||''))||ownVehiclePlates.has(plateKey(plan.placa)));
    const usedDrivers=new Set(),usedHelpers=new Set();
    for(const plan of mapped){
      for(const field of [['motorista_id','motorista'],['motorista_substituto_id','motorista_substituto']]){
        const key=String(plan[field[0]]||'')?`ID:${String(plan[field[0]])}`:(normalizeText(plan[field[1]])?`NM:${normalizeText(plan[field[1]])}`:'');
        if(!key)continue;if(usedDrivers.has(key)){plan[field[0]]='';plan[field[1]]='';}else usedDrivers.add(key);
      }
      const hasDriver=Boolean(String(plan.motorista_id||'')||normalizeText(plan.motorista)||String(plan.motorista_substituto_id||'')||normalizeText(plan.motorista_substituto));
      if(!hasDriver){plan.ajudante_id='';plan.ajudante='';}
      const helperKey=String(plan.ajudante_id||'')?`ID:${String(plan.ajudante_id)}`:(normalizeText(plan.ajudante)?`NM:${normalizeText(plan.ajudante)}`:'');
      if(helperKey){if(usedHelpers.has(helperKey)){plan.ajudante_id='';plan.ajudante='';}else usedHelpers.add(helperKey);}
    }
    return mapped;
  } catch { return []; }
}
async function readAllocationFloatDriversForDate(db,date='') {
  const selected=dateIso(date)||new Date().toISOString().slice(0,10);
  try {
    if(!(await tableExists(db,'ROUTE_ALLOCATION_FLOAT_DRIVERS')))return [];
    const [{results=[]},{results:employeeRows=[]}]=await Promise.all([
      db.prepare(`SELECT *
        FROM ROUTE_ALLOCATION_FLOAT_DRIVERS
        WHERE ACTIVE=1 AND START_DATE<=? AND (END_DATE IS NULL OR TRIM(END_DATE)='' OR END_DATE>=?)
        ORDER BY START_DATE DESC,UPDATED_AT DESC,DRIVER_NAME COLLATE NOCASE`).bind(selected,selected).all(),
      db.prepare(`SELECT ID,NOME,VINCULO FROM BASE_COLABORADORES`).all(),
    ]);
    const byId=new Map(employeeRows.map((row)=>[String(row.ID||''),row])),byName=new Map(employeeRows.map((row)=>[normalizeText(row.NOME),row]));
    return results.map((row)=>({id:text(row,'ID'),motorista_id:text(row,'DRIVER_ID'),motorista:text(row,'DRIVER_NAME'),regiao:text(row,'REGION'),vigencia_inicio:dateIso(value(row,'START_DATE')),vigencia_fim:dateIso(value(row,'END_DATE')),ativo:boolValue(value(row,'ACTIVE'),true),atualizado_em:text(row,'UPDATED_AT')})).filter((item)=>{const employee=(item.motorista_id&&byId.get(String(item.motorista_id)))||byName.get(normalizeText(item.motorista));return !employee||!isThirdPartyLink(employee.VINCULO);});
  } catch { return []; }
}

async function loadSchedulePlanningContext(db,date = '') {
  const selected=dateIso(date) || new Date().toISOString().slice(0,10);
  const [settings,schedules,allocationPlans,allocationFloatDrivers] = await Promise.all([
    settingsMap(db),
    loadSchedules(db,{date:selected,start:selected,end:selected}),
    readAllocationPlansForDate(db,selected),
    readAllocationFloatDriversForDate(db,selected),
  ]);
  const catalog=await loadCatalogContext(db,selected,settings);
  const context={settings,schedules,allocationPlans,allocationFloatDrivers,...catalog};
  context.vehicleById=new Map(context.vehicles.map((item)=>[String(item.id),item]));
  context.vehicleByPlate=new Map(context.vehicles.map((item)=>[plateKey(item.placa),item]));
  context.employeeById=new Map(context.employees.map((item)=>[String(item.id),item]));
  context.employeeByName=new Map(context.employees.map((item)=>[normalizeText(item.nome),item]));
  context.routeById=new Map(context.routes.map((item)=>[String(item.id),item]));
  context.routeByName=new Map(context.routes.map((item)=>[normalizeText(item.rota),item]));
  return context;
}

function planningAllocationPriority(status) {
  return { PERNOITE:5,'EM ROTA':4,ESCALADO:2 }[normalizeText(status)]||0;
}
function planningResourceUsed(schedule,item,type) {
  const id=String(item?.id||'');
  const name=type==='VEICULO'?plateKey(item?.placa):normalizeText(item?.nome);
  if(type==='VEICULO')return (id&&String(schedule.veiculo_id||'')===id)||(name&&plateKey(schedule.placa)===name);
  if(type==='MOTORISTA')return (id&&String(schedule.motorista_id||'')===id)||(name&&normalizeText(schedule.motorista)===name);
  return (id&&[schedule.ajudante_1_id,schedule.ajudante_2_id].map(String).includes(id))||(name&&[schedule.ajudante_1,schedule.ajudante_2].map(normalizeText).includes(name));
}
function planningBaseResourceStatus(item,type,selected) {
  const raw=normalizeText(value(item?.raw||{},'STATUS')||item?.status||'DISPONÍVEL');
  if(type!=='VEICULO'){
    const vacationStart=dateIso(value(item?.raw||{},'FERIAS_INICIO')||item?.ferias_inicio);
    const vacationEnd=dateIso(value(item?.raw||{},'FERIAS_FIM')||item?.ferias_fim);
    if(selected&&vacationStart&&vacationEnd&&selected>=vacationStart&&selected<=vacationEnd)return 'FÉRIAS';
  }
  if(type!=='VEICULO'&&item?.folga_agendada)return TIME_OFF_STATUS;
  const hard=type==='VEICULO'?HARD_VEHICLE_STATUSES:HARD_EMPLOYEE_STATUSES;
  if(hard.has(raw))return displayCatalogStatus(raw);
  // Estados operacionais transitórios nunca são herdados do cadastro/evento para
  // o seletor. Eles precisam estar sustentados por uma Escala/Saída/Monitoramento
  // realmente aberta. Isso elimina PERNOITE antigo que já não possui viagem aberta.
  if(TRANSIENT_CATALOG_STATUSES.has(raw)){
    // Evento do próprio dia ainda é evidência operacional válida quando não existe
    // uma linha estruturada de Saída/Monitoramento (compatibilidade histórica).
    // Eventos de dias anteriores, por outro lado, só continuam bloqueando se a
    // viagem realmente estiver aberta — isso é calculado em planningResourceAllocations.
    if(item?.status_event_at&&dateIso(item.status_event_at)===selected)return displayCatalogStatus(item.status);
    return 'DISPONÍVEL';
  }
  return displayCatalogStatus(raw);
}
// Linhas de Monitoramento são reavaliadas para cada colaborador/veículo; o JSON e o
// status de cada linha são calculados uma única vez (cache por objeto da linha).
const monitoringRowCache=new WeakMap();
function monitoringRowParsed(row){
  let cached=monitoringRowCache.get(row);
  if(!cached){cached={data:parseData(value(row,'DATA_JSON'))||{}};monitoringRowCache.set(row,cached);}
  return cached;
}
function planningMonitoringStatus(row) {
  if(!row)return '';
  const cachedParsed=monitoringRowParsed(row);
  if(cachedParsed.status!==undefined)return cachedParsed.status;
  cachedParsed.status=planningMonitoringStatusCompute(row,cachedParsed.data);
  return cachedParsed.status;
}
function planningMonitoringStatusCompute(row,data) {
  const status=normalizeText(value(row,'STATUS_MONITORAMENTO','STATUS')||data.status_monitoramento||data.status);
  if(status==='PERNOITE')return 'PERNOITE';
  if(['EM ROTA','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO'].includes(status))return 'EM ROTA';
  return '';
}
function planningDepartureStarted(row) {
  if(!row)return false;
  const data=parseData(value(row,'DATA_JSON'))||{};
  const status=normalizeText(value(row,'STATUS_SAIDA','STATUS')||data.status_saida||data.status);
  const at=clean(value(row,'DATA_HORA_SAIDA','ACTUAL_AT','SAIDA_REAL','HORA_REAL')||data.saida_real||data.hora_real,80);
  return Boolean(at&&(!status||['SAIU','EM ROTA','LIBERADO'].includes(status)));
}
function planningScheduleOperationalStatus(schedule,context,selected) {
  if(!schedule)return '';
  const status=normalizeText(schedule.status);
  if(['CANCELADO','FINALIZADO','RETORNOU'].includes(status))return '';
  const scheduleId=String(schedule.id||'');
  if(scheduleId&&context?.returnBySchedule?.has(scheduleId))return '';
  const monitoring=scheduleId?context?.monitoringBySchedule?.get(scheduleId):null;
  const monitoringStatus=planningMonitoringStatus(monitoring);
  if(monitoringStatus)return monitoringStatus;
  const departure=scheduleId?context?.departureBySchedule?.get(scheduleId):null;
  if(planningDepartureStarted(departure))return 'EM ROTA';
  // Para dias anteriores, uma simples marca residual na Escala não prova que a
  // pessoa continue viajando. Só Saída/Monitoramento aberto mantém o bloqueio.
  if(String(schedule.data||'')!==String(selected||''))return '';
  if(status==='PERNOITE')return 'PERNOITE';
  if(status==='EM ROTA')return 'EM ROTA';
  return 'ESCALADO';
}
function monitoringRowIndex(row){
  const cached=monitoringRowParsed(row);
  if(cached.index)return cached.index;
  const data=cached.data;
  const set=(items,fn=String)=>new Set(items.filter(Boolean).map(fn).filter(Boolean));
  cached.index={
    vehicleIds:set([data.veiculo_id,data.VEICULO_ID]),plate:plateKey(data.placa||data.PLACA||''),
    driverIds:set([data.motorista_id,data.MOTORISTA_ID]),driverName:normalizeText(data.motorista||data.MOTORISTA||''),
    helperIds:set([data.ajudante_1_id,data.AJUDANTE_1_ID,data.ajudante_2_id,data.AJUDANTE_2_ID]),
    helperNames:set([data.ajudante_1,data.AJUDANTE_1,data.ajudante_2,data.AJUDANTE_2],normalizeText),
  };
  return cached.index;
}
function monitoringResourceUsed(row,item,type) {
  const index=monitoringRowIndex(row);
  const id=String(item?.id||'');
  if(type==='VEICULO')return (id&&index.vehicleIds.has(id))||(index.plate&&index.plate===plateKey(item?.placa));
  const wantedName=normalizeText(item?.nome||'');
  if(type==='MOTORISTA')return (id&&index.driverIds.has(id))||(wantedName&&index.driverName===wantedName);
  return (id&&index.helperIds.has(id))||(wantedName&&index.helperNames.has(wantedName));
}
function planningResourceAllocations(item,type,context,selected) {
  const allocations=[];
  const representedMonitoring=new Set();
  for(const schedule of context?.schedules||[]){
    if(!effectiveResourceUsed(schedule,item?.id,type==='VEICULO'?'VEICULO':'COLABORADOR',context))continue;
    let status=planningScheduleOperationalStatus(schedule,context,selected);
    let priorPending=false;
    if(!status&&(type==='MOTORISTA'||type==='AJUDANTE')&&pendingPriorPlanning(schedule,{data:selected},context)){status='ESCALADO';priorPending=true;}
    if(!status)continue;
    const scheduleId=String(schedule.id||'');
    const monitoring=scheduleId?context?.monitoringBySchedule?.get(scheduleId):null;
    if(monitoring)representedMonitoring.add(monitoring);
    allocations.push({schedule,status,priorPending,route:schedule.rota||'',effectiveAt:String(schedule.atualizado_em||schedule.data||'')});
  }
  // Monitoramentos órfãos/legados também precisam bloquear quando realmente estão
  // abertos. O que não pode mais bloquear é apenas um EVENTO histórico de PERNOITE.
  for(const row of context?.monitoring||[]){
    if(representedMonitoring.has(row))continue;
    const status=planningMonitoringStatus(row);if(!status||!monitoringResourceUsed(row,item,type))continue;
    const scheduleId=text(row,'ESCALA_ID');
    if(scheduleId&&context?.returnBySchedule?.has(scheduleId))continue;
    const data=parseData(value(row,'DATA_JSON'))||{};
    allocations.push({schedule:null,status,route:data.rota||data.ROTA||'',effectiveAt:String(data.atualizado_em||value(row,'DATA')||'')});
  }
  allocations.sort((a,b)=>planningAllocationPriority(b.status)-planningAllocationPriority(a.status)||String(b.effectiveAt).localeCompare(String(a.effectiveAt)));
  return allocations;
}
function decoratePlanningResources(resources,schedules,type,context,selected) {
  return (resources||[]).map((item)=>{
    const baseStatus=planningBaseResourceStatus(item,type,selected);
    const allocations=planningResourceAllocations(item,type,context,selected);
    const routeHelperSunday=type==='AJUDANTE'&&item.ajudante_rota&&isSundayDate(selected);
    // Ajudante de rota pode apoiar outra viagem enquanto apenas EM ROTA;
    // ESCALADO (viagem sem saída) não é disponibilidade. Domingo não conta como
    // dia trabalhado de ajudante de rota, sem retirar bloqueios cadastrais duros.
    const hard=HARD_EMPLOYEE_STATUSES.has(normalizeText(baseStatus));
    const current=hard?null:(type==='AJUDANTE'&&item.ajudante_rota
      ? (routeHelperSunday?allocations.find(entry=>entry.status==='ESCALADO')||null:allocations.find(entry=>entry.status==='ESCALADO'||entry.status==='PERNOITE')||allocations[0]||null)
      : allocations[0]||null);
    if(!current)return {...item,status:baseStatus,rota_atual:'',escala_atual_id:'',rota_base:item.cidade_rota||'',ocupacao_operacional:false,disponivel_apoio:type==='AJUDANTE'&&item.ajudante_rota&&!hard};
    if(type==='AJUDANTE'&&item.ajudante_rota&&current.status==='EM ROTA')return {...item,status:'DISPONÍVEL PARA APOIO',rota_atual:current.route||'',escala_atual_id:current.schedule?.id||'',rota_base:item.cidade_rota||'',ocupacao_operacional:true,disponivel_apoio:true};
    return {
      ...item,status:current.status,rota_atual:current.route||'',escala_atual_id:current.schedule?.id||'',
      rota_base:item.cidade_rota||'',ocupacao_operacional:true,escala_anterior_pendente:Boolean(current.priorPending),disponivel_apoio:type==='AJUDANTE'&&item.ajudante_rota?false:undefined,
    };
  });
}

async function readConfirmedReturnsFresh(db,start = '',end = '') {
  const rows=[];
  const range=(column)=>{const clauses=[],binds=[];if(start){clauses.push(`${column}>=?`);binds.push(start);}if(end){clauses.push(`${column}<=?`);binds.push(end);}return {sql:clauses.length?` AND ${clauses.join(' AND ')}`:'',binds};};

  if(await tableExists(db,'ROUTE_RETURNS')){
    const r=range('DATE_KEY');
    const result=await db.prepare(`SELECT SCHEDULE_ID AS ESCALA_ID,DATE_KEY AS DATA,PLATE AS PLACA,DRIVER_NAME AS MOTORISTA,ROUTE AS ROTA,
      COALESCE(NULLIF(RETURN_AT,''),json_extract(DATA_JSON,'$.retorno_real'),json_extract(DATA_JSON,'$.DATA_HORA_RETORNO')) AS DATA_HORA_RETORNO,DATA_JSON
      FROM ROUTE_RETURNS
      WHERE COALESCE(NULLIF(RETURN_AT,''),json_extract(DATA_JSON,'$.retorno_real'),json_extract(DATA_JSON,'$.DATA_HORA_RETORNO')) IS NOT NULL${r.sql}
      ORDER BY ID DESC LIMIT 10000`).bind(...r.binds).all();
    rows.push(...(result.results||[]));
  }

  // Compatibilidade com o armazenamento genérico utilizado por versões antigas.
  if(await tableExists(db,'ROUTE_RECORDS')){
    const r=range('DATE_KEY');
    const result=await db.prepare(`SELECT
      COALESCE(json_extract(DATA_JSON,'$.schedule_record_id'),json_extract(DATA_JSON,'$.schedule_id'),json_extract(DATA_JSON,'$.escala_id'),json_extract(DATA_JSON,'$.escala_id_legado')) AS ESCALA_ID,
      DATE_KEY AS DATA,
      COALESCE(json_extract(DATA_JSON,'$.placa'),json_extract(DATA_JSON,'$.PLACA')) AS PLACA,
      COALESCE(json_extract(DATA_JSON,'$.motorista'),json_extract(DATA_JSON,'$.MOTORISTA')) AS MOTORISTA,
      COALESCE(json_extract(DATA_JSON,'$.rota'),json_extract(DATA_JSON,'$.ROTA')) AS ROTA,
      COALESCE(json_extract(DATA_JSON,'$.retorno_real'),json_extract(DATA_JSON,'$.return_at'),json_extract(DATA_JSON,'$.DATA_HORA_RETORNO')) AS DATA_HORA_RETORNO,
      DATA_JSON
      FROM ROUTE_RECORDS
      WHERE MODULE='returns' AND COALESCE(json_extract(DATA_JSON,'$.retorno_real'),json_extract(DATA_JSON,'$.return_at'),json_extract(DATA_JSON,'$.DATA_HORA_RETORNO')) IS NOT NULL${r.sql}
      ORDER BY ID DESC LIMIT 10000`).bind(...r.binds).all();
    rows.push(...(result.results||[]));
  }

  // A tabela RETORNOS ainda é usada por históricos/importações de Portaria.
  // Ela precisa liberar a Escala exatamente como a tabela operacional atual.
  if(await tableExists(db,'RETORNOS')){
    const r=range('DATA');
    const result=await db.prepare(`SELECT ESCALA_ID,DATA,PLACA,'' AS MOTORISTA,'' AS ROTA,DATA_HORA_RETORNO,'{}' AS DATA_JSON
      FROM RETORNOS WHERE NULLIF(TRIM(COALESCE(DATA_HORA_RETORNO,'')),'') IS NOT NULL${r.sql}
      ORDER BY DATA DESC LIMIT 10000`).bind(...r.binds).all();
    rows.push(...(result.results||[]));
  }
  return rows;
}

async function readMonitoringFresh(db,start = '',end = '') {
  if (!(await tableExists(db,'ROUTE_MONITORING'))) return [];
  const clauses=[]; const binds=[];
  if (start) { clauses.push('DATE_KEY>=?'); binds.push(start); }
  if (end) { clauses.push('DATE_KEY<=?'); binds.push(end); }
  const result = await db.prepare(`SELECT
    SCHEDULE_ID AS ESCALA_ID,
    DATE_KEY AS DATA,
    STATUS AS STATUS_MONITORAMENTO,
    DATA_JSON
    FROM ROUTE_MONITORING
    ${clauses.length?`WHERE ${clauses.join(' AND ')}`:''}
    ORDER BY ID DESC LIMIT 10000`).bind(...binds).all();
  return result.results || [];
}

async function readDeparturesFresh(db,start = '',end = '') {
  if (!(await tableExists(db,'ROUTE_DEPARTURES'))) return [];
  const clauses=[]; const binds=[];
  if (start) { clauses.push('DATE_KEY>=?'); binds.push(start); }
  if (end) { clauses.push('DATE_KEY<=?'); binds.push(end); }
  const result = await db.prepare(`SELECT
    SCHEDULE_ID AS ESCALA_ID,
    DATE_KEY AS DATA,
    STATUS AS STATUS_SAIDA,
    ACTUAL_AT AS DATA_HORA_SAIDA,
    DATA_JSON
    FROM ROUTE_DEPARTURES
    ${clauses.length?`WHERE ${clauses.join(' AND ')}`:''}
    ORDER BY ID DESC LIMIT 10000`).bind(...binds).all();
  return result.results || [];
}

async function readActiveDeparturesFresh(db,start = '',end = '') {
  if (!(await tableExists(db,'ROUTE_DEPARTURES'))) return [];
  const clauses=["UPPER(COALESCE(STATUS,''))='SAIU'"]; const binds=[];
  if (start) { clauses.push('DATE_KEY>=?'); binds.push(start); }
  if (end) { clauses.push('DATE_KEY<=?'); binds.push(end); }
  const result = await db.prepare(`SELECT
    SCHEDULE_ID AS ESCALA_ID,
    DATE_KEY AS DATA,
    STATUS AS STATUS_SAIDA,
    ACTUAL_AT AS DATA_HORA_SAIDA,
    DATA_JSON
    FROM ROUTE_DEPARTURES
    WHERE ${clauses.join(' AND ')}
    ORDER BY ID DESC LIMIT 5000`).bind(...binds).all();
  return result.results || [];
}

async function loadOperationalContext(db, date = '', options = {}) {
  const selectedDate=dateIso(date) || new Date().toISOString().slice(0,10);
  // A validação precisa apenas do histórico operacional recente para detectar
  // recursos ainda em rota e conflitos de janela. A regra de 7º dia foi removida.
  const contextStart=addDays(selectedDate,-14);
  const contextEnd=addDays(selectedDate,7);
  const settings = await settingsMap(db);
  const useWriteCatalog=options?.writeFast===true;
  const [schedules,catalog,returns,reservations,monitoring,departures] = await Promise.all([
    loadSchedules(db,{ start:contextStart,end:contextEnd }),
    useWriteCatalog?loadWriteCatalogContext(db,selectedDate,settings):loadCatalogContext(db,selectedDate,settings),
    readConfirmedReturnsFresh(db,contextStart,contextEnd),
    readAll(db,'RESERVAS_VEICULOS',`DATA_INICIO<? AND (DATA_FIM IS NULL OR TRIM(CAST(DATA_FIM AS TEXT))='' OR DATA_FIM>=?)`,[addDays(selectedDate,1),selectedDate],5000),
    readMonitoringFresh(db,contextStart,contextEnd),
    useWriteCatalog?readActiveDeparturesFresh(db,contextStart,contextEnd):readDeparturesFresh(db,contextStart,contextEnd),
  ]);
  const context = { settings,schedules,returns,availability:catalog.availabilityRows||[],reservations,monitoring,departures,...catalog };
  context.vehicleById = new Map(context.vehicles.map((item)=>[String(item.id),item]));
  context.vehicleByPlate = new Map(context.vehicles.map((item)=>[plateKey(item.placa),item]));
  context.employeeById = new Map(context.employees.map((item)=>[String(item.id),item]));
  context.employeeByName = new Map(context.employees.map((item)=>[normalizeText(item.nome),item]));
  context.routeById = new Map(context.routes.map((item)=>[String(item.id),item]));
  context.routeByName = new Map(context.routes.map((item)=>[normalizeText(item.rota),item]));
  context.returnBySchedule = new Map();
  context.returnByVehicle = new Map();
  for (const row of returns) {
    const id = text(row,'ESCALA_ID'); const dateTime = dateTimeLocal(value(row,'DATA_HORA_RETORNO'),dateIso(value(row,'DATA')));
    if (!dateTime) continue;
    if(id){const current=context.returnBySchedule.get(id);if(!current||dateTime>current.dateTime)context.returnBySchedule.set(id,{row,dateTime});}
    const data=parseData(value(row,'DATA_JSON'))||{};
    const vehicleId=String(data.veiculo_id||data.VEICULO_ID||'').trim();
    const plate=plateKey(value(row,'PLACA')||data.placa||data.PLACA||data.plate||data.PLATE);
    for(const key of [vehicleId?`ID|${vehicleId}`:'',plate?`PLATE|${plate}`:''].filter(Boolean)){
      const current=context.returnByVehicle.get(key);
      if(!current||dateTime>current.dateTime)context.returnByVehicle.set(key,{row,dateTime,vehicleId,plate});
    }
  }

  // Retornos históricos podem ter SCHEDULE_ID legado. A v1.0.3 já trata essa
  // identidade no módulo Retornos; a Escala agora aplica o mesmo princípio para
  // liberar veículo/motorista depois do retorno real, sem confundir placas de uma
  // mesma rota. O fallback é estrito: data + placa + rota, com sequência/OC como
  // desempate quando existem nos dois lados.
  context.departureBySchedule=new Map();
  for(const row of departures){const id=text(row,'ESCALA_ID');if(id&&!context.departureBySchedule.has(id))context.departureBySchedule.set(id,row);}
  context.monitoringBySchedule=new Map();
  for(const row of monitoring){const id=text(row,'ESCALA_ID');if(id&&!context.monitoringBySchedule.has(id))context.monitoringBySchedule.set(id,row);}

  // Índice de compatibilidade para retornos legados. Antes cada escala percorria
  // toda a lista de retornos e fazia JSON.parse repetidamente (O(escalas × retornos)).
  // Em dias carregados isso consumia CPU do Worker e podia terminar em 503. Agora
  // cada retorno é normalizado uma única vez e a busca fica restrita à mesma
  // data+placa+rota.
  const legacyReturnIndex=new Map();
  for(const row of returns){
    const data=parseData(value(row,'DATA_JSON'))||{};
    const returnDate=dateIso(value(row,'DATA')||data.data||data.DATA);
    const returnPlate=plateKey(data.placa||data.PLACA||data.plate||data.PLATE);
    const returnRoute=normalizeText(data.rota||data.ROTA||data.route||data.ROUTE);
    if(!returnDate||!returnPlate||!returnRoute)continue;
    const indexKey=`${returnDate}|${returnPlate}|${returnRoute}`;
    const item={
      row,data,
      seq:normalizeText(clean(data.sequencia??data.SEQUENCIA_CARREGAMENTO,80)),
      ocs:normalizeText(normalizeLoadOrders(data.ocs??data.CARGA??data.OCS)),
      dateTime:dateTimeLocal(value(row,'DATA_HORA_RETORNO'),returnDate),
    };
    if(!legacyReturnIndex.has(indexKey))legacyReturnIndex.set(indexKey,[]);
    legacyReturnIndex.get(indexKey).push(item);
  }
  for (const schedule of context.schedules) {
    const key=String(schedule.id || '');
    if (!key || context.returnBySchedule.has(key)) continue;
    const indexKey=`${schedule.data}|${plateKey(schedule.placa)}|${normalizeText(schedule.rota)}`;
    const scheduleSeq=normalizeText(clean(schedule.sequencia,80));
    const scheduleOcs=normalizeText(normalizeLoadOrders(schedule.ocs));
    const match=(legacyReturnIndex.get(indexKey)||[]).find((item)=>{
      if(item.seq&&scheduleSeq&&item.seq!==scheduleSeq)return false;
      if(item.ocs&&scheduleOcs&&item.ocs!==scheduleOcs)return false;
      return true;
    });
    if (match?.dateTime) context.returnBySchedule.set(key,{row:match.row,dateTime:match.dateTime,legacyMatch:true});
  }
  context.workSignals=contextEmployeeWorkSignals(context,selectedDate);
  return context;
}

function sameEmployeeReference(leftId,leftName,rightId,rightName) {
  const aId=String(leftId||'').trim(),bId=String(rightId||'').trim();
  if(aId&&bId)return aId===bId;
  return Boolean(normalizeText(leftName)&&normalizeText(leftName)===normalizeText(rightName));
}

// Fluxo operacional de troca na saída. Diferente do editor normal da Escala, esta
// rotina pode atualizar a equipe quando o caminhão está saindo/saído, mas continua
// respeitando a regra essencial: ninguém pode estar duplicado em outra escala aberta
// ou permanecer em rota sem Retorno confirmado.
export async function resolveOperationalCrewChange(db,user,schedule,source={},baseline={},options={}) {
  const administrativeCorrection=Boolean(options?.administrativeCorrection)&&normalizeText(user?.role)==='ADMIN';
  // Troca na Saída: a ocupação operacional de colaborador (EM ROTA/ESCALADO) pode
  // estar defasada. Com confirmação explícita (e justificativa exigida pela Saída)
  // ela não bloqueia; veículo e bloqueios cadastrais continuam validados.
  const overrideEmployeeConflicts=Boolean(source?.forcar_conflito_equipe);
  if(!schedule)throw new Error('Escala vinculada não encontrada.');
  const context=await loadOperationalContext(db,schedule.data);
  const current={...schedule,...baseline};
  const requested={
    veiculo_id:clean(source.veiculo_id!==undefined?source.veiculo_id:current.veiculo_id,120),
    placa:clean(source.placa!==undefined?source.placa:current.placa,30).toUpperCase(),
    motorista_id:clean(source.motorista_id!==undefined?source.motorista_id:current.motorista_id,120),
    motorista:clean(source.motorista!==undefined?source.motorista:current.motorista,180),
    ajudante_1_id:clean(source.ajudante_1_id!==undefined?source.ajudante_1_id:current.ajudante_1_id,120),
    ajudante_1:clean(source.ajudante_1!==undefined?source.ajudante_1:current.ajudante_1,180),
    ajudante_2_id:clean(source.ajudante_2_id!==undefined?source.ajudante_2_id:current.ajudante_2_id,120),
    ajudante_2:clean(source.ajudante_2!==undefined?source.ajudante_2:current.ajudante_2,180),
  };
  const teamType=normalizeText(source.tipo_equipe||current.tipo_equipe||schedule.tipo_equipe||'UM_AJUDANTE');
  if(['CARGA_FECHADA','TERCEIRO','SEM_AJUDANTE'].includes(teamType)){
    requested.ajudante_1_id='';requested.ajudante_1='';requested.ajudante_2_id='';requested.ajudante_2='';
  } else if(teamType==='UM_AJUDANTE') {
    requested.ajudante_2_id='';requested.ajudante_2='';
  }
  if(!requested.motorista_id&&!requested.motorista)throw new Error('Selecione o motorista da saída.');
  if(teamType==='UM_AJUDANTE'&&!requested.ajudante_1_id&&!requested.ajudante_1)throw new Error('Selecione o Ajudante 1 da saída.');
  if(teamType==='DOIS_MOTORISTAS'&&!requested.ajudante_1_id&&!requested.ajudante_1)throw new Error('Selecione o Motorista 2 da saída.');
  if(teamType==='DOIS_AJUDANTES'&&((!requested.ajudante_1_id&&!requested.ajudante_1)||(!requested.ajudante_2_id&&!requested.ajudante_2)))throw new Error('Selecione os dois ajudantes da saída.');

  const resolvePerson=(id,name,role,currentId,currentName)=>{
    const employee=findEmployee(id,name,context);
    const unchanged=sameEmployeeReference(id,name,currentId,currentName);
    if(!employee){
      // Registros históricos podem apontar para um colaborador removido do catálogo.
      // Manter a mesma pessoa é permitido; trocar para alguém fora da base não é.
      if(unchanged&&clean(currentName))return {id:clean(currentId||id,120),nome:clean(currentName||name,180),funcao:role,ativo:true,historical:true,ajudante_rota:false,status:'DISPONÍVEL'};
      throw new Error(`${role==='MOTORISTA'?'Motorista':'Ajudante'} não encontrado na base de colaboradores.`);
    }
    if(!employee.ativo)throw new Error(`${employee.nome} está inativo.`);
    if(employee.funcao!==role)throw new Error(`${employee.nome} não está cadastrado como ${role==='MOTORISTA'?'motorista':'ajudante'}.`);
    return employee;
  };

  let vehicle=null;
  if(requested.veiculo_id||requested.placa){
    const byId=context.vehicleById.get(String(requested.veiculo_id||''))||null;
    const byPlate=context.vehicleByPlate.get(plateKey(requested.placa))||null;
    // Na tela de Saída a placa pode ser trocada mantendo, no payload legado, o ID
    // do veículo originalmente escalado. A placa efetivamente informada é a fonte
    // operacional de verdade e deve reconciliar o VEICULO_ID antes de bloquear.
    if(byPlate&&(!byId||plateKey(byId.placa)!==plateKey(requested.placa)))vehicle=byPlate;
    else vehicle=byId||byPlate;
    if(!vehicle){
      const unchanged=plateKey(requested.placa)===plateKey(current.placa)&&String(requested.veiculo_id||'')===String(current.veiculo_id||'');
      if(unchanged&&requested.placa)vehicle={id:requested.veiculo_id||'',placa:requested.placa,ativo:true,historical:true,status:'DISPONÍVEL'};
      else throw new Error(`Veículo ${requested.placa||requested.veiculo_id} não encontrado na base de veículos.`);
    }
    if(vehicle.ativo===false)throw new Error(`Veículo ${vehicle.placa||requested.placa} está inativo.`);
  }

  const driver=resolvePerson(requested.motorista_id,requested.motorista,'MOTORISTA',current.motorista_id,current.motorista);
  const helper1=(requested.ajudante_1_id||requested.ajudante_1)?resolvePerson(requested.ajudante_1_id,requested.ajudante_1,['DOIS_MOTORISTAS','TRES_MOTORISTAS'].includes(teamType)?'MOTORISTA':'AJUDANTE',current.ajudante_1_id,current.ajudante_1):null;
  const helper2=(requested.ajudante_2_id||requested.ajudante_2)?resolvePerson(requested.ajudante_2_id,requested.ajudante_2,teamType==='TRES_MOTORISTAS'?'MOTORISTA':'AJUDANTE',current.ajudante_2_id,current.ajudante_2):null;
  if(helper1&&helper2&&sameEmployeeReference(helper1.id,helper1.nome,helper2.id,helper2.nome))throw new Error('O mesmo ajudante não pode ocupar as duas posições.');
  if([helper1,helper2].filter(Boolean).some((helper)=>sameEmployeeReference(helper.id,helper.nome,driver.id,driver.nome)))throw new Error('O motorista não pode ser ajudante na mesma carga.');
  const route=context.routeById.get(String(schedule.rota_id||''))||context.routeByName.get(normalizeText(schedule.rota))||{rota:schedule.rota||'',perfil:''};
  const vehicleThird=isThirdPartyLink(vehicle?.vinculo||'');
  // Correção administrativa pós-saída registra o que de fato aconteceu. Por isso,
  // regras de planejamento (vínculo, rota do ajudante e restrições cadastrais) não
  // podem impedir a retificação histórica/operacional. Integridade de cadastro e
  // papéis (motorista/ajudante), porém, continua obrigatória.
  if(!administrativeCorrection){
    if(context.carreteiros&&driver){
      if(isCarreteiroDriver(context.carreteiros,driver)){const error=new Error(`Motorista ${driver.nome} é carreteiro (CAJU - Carreteiros) e não pode ser escalado.`);error.code='CARRETEIRO_NOT_SCHEDULABLE';throw error;}
      if(vehicle&&!bitruckDriverMayUsePlate(context.carreteiros,driver,vehicle.placa)){const error=new Error(`Motorista de bitruck ${driver.nome} só pode ser escalado em placa de bitruck cadastrada em CAJU - Carreteiros.`);error.code='BITRUCK_DRIVER_PLATE_MISMATCH';throw error;}
    }
    if(isThirdPartyLink(driver.vinculo)&&!vehicleThird){const error=new Error(`Motorista terceiro ${driver.nome} só pode ser escalado em veículo terceiro.`);error.code='THIRD_PARTY_DRIVER_VEHICLE_MISMATCH';throw error;}
    for(const helper of [helper1,helper2].filter(Boolean)){
      if(helper.ajudante_rota&&!helperSupportsRoute(helper,route)){const allowed=helperAllowedRouteNames(helper);const error=new Error(allowed.length?`Ajudante de rota ${helper.nome} só pode apoiar as rotas cadastradas: ${allowed.join(', ')}.`:`Ajudante de rota ${helper.nome} não possui Rotas atendidas cadastradas na Base de Ajudantes.`);error.code='ROUTE_HELPER_ROUTE_MISMATCH';throw error;}
      if(helper.restricao_ajudante&&!isNetworkRoute(route)){const error=new Error(`Ajudante ${helper.nome} possui restrição e só pode ser escalado em rotas de Redes.`);error.code='HELPER_RESTRICTION_NETWORK_ONLY';throw error;}
    }
  }

  // Ao confirmar uma saída real, a nova ocupação começa na hora efetivamente
  // registrada, e não no horário originalmente planejado. Isso é essencial em
  // reaproveitamentos no dia seguinte: a escala pode estar programada antes do
  // retorno da viagem anterior, mas o caminhão só sair depois de já ter voltado.
  // Para registros ainda pendentes, preservamos a janela planejada.
  const departureStatus=normalizeText(source.status||source.status_saida);
  const actualDepartureTime=departureStatus==='SAIU'?timeOnly(source.hora_real||source.saida_real||source.actual_at):'';
  const candidate={
    ...schedule,
    data:dateIso(source.data||schedule.data)||schedule.data,
    horario_ponto:actualDepartureTime||schedule.horario_ponto,
    veiculo_id:vehicle?.id||requested.veiculo_id||'',placa:vehicle?.placa||requested.placa||'',
    motorista_id:driver.id||'',motorista:driver.nome||requested.motorista,
    ajudante_1_id:helper1?.id||'',ajudante_1:helper1?.nome||'',
    ajudante_2_id:helper2?.id||'',ajudante_2:helper2?.nome||'',
  };
  if(!administrativeCorrection){
    if(vehicle&&!vehicle.historical){
      const explicit=explicitAvailability(context,candidate.data,'VEICULO',vehicle.id);
      const conflict=resourceConflict(context,vehicle.id,'VEICULO',candidate,false,'VEICULO',true);
      if(conflict){const window=scheduleWindow(conflict,context);const error=new Error(`Veículo ${vehicle.placa} ainda está alocado${window?.end?` até ${displayDateTime(window.end)}`:''} (${conflict.rota||conflict.sequencia||conflict.id}).`);error.code='VEHICLE_SCHEDULE_CONFLICT';throw error;}
      const open=openMonitoring(context,vehicle.id,'VEICULO',candidate,'VEICULO');
      if(open&&!explicit){const error=new Error(`Veículo ${vehicle.placa} ainda está em rota sem retorno confirmado (${open.schedule.rota||open.schedule.id}).`);error.code='OPEN_MONITORING';throw error;}
    }

    for(const [employee,role] of [[driver,'MOTORISTA'],[helper1,teamType==='DOIS_MOTORISTAS'?'MOTORISTA':'AJUDANTE'],[helper2,'AJUDANTE']]){
      if(!employee||employee.historical)continue;
      const label=role==='MOTORISTA'?'Motorista':'Ajudante';
      const explicit=explicitAvailability(context,candidate.data,role,employee.id);
      const status=statusForDate(employee,candidate.data);
      if(status==='RESERVADO'&&!explicit){const error=new Error(`${label} ${employee.nome} está reservado para serviço administrativo.`);error.code='EMPLOYEE_RESERVED';throw error;}
      if(statusForDate(employee,candidate.data)===TIME_OFF_STATUS&&!timeOffUnchanged(current,employee,role)){const error=new Error(`${label} ${employee.nome} possui folga agendada${employee.folga_motivo?` (${employee.folga_motivo})`:''} e não pode ser escalado.`);error.code='EMPLOYEE_TIME_OFF';throw error;}
      if(overrideEmployeeConflicts)continue;
      const routeHelper=role==='AJUDANTE'&&employee.ajudante_rota;
      const routeHelperSunday=routeHelper&&isSundayDate(candidate.data);
      const conflict=resourceConflict(context,employee.id,'COLABORADOR',candidate,routeHelper,role);
      if(conflict){const window=scheduleWindow(conflict,context);const error=new Error(`${label} ${employee.nome} já está escalado em ${conflict.rota||conflict.sequencia||conflict.id} e ainda não foi liberado${window?.end?` (ocupação até ${displayDateTime(window.end)})`:''}.`);error.code='RESOURCE_SCHEDULE_CONFLICT';throw error;}
      const open=openMonitoring(context,employee.id,'COLABORADOR',candidate,role);
      if(open&&(!routeHelper||(normalizeText(value(open.row,'STATUS_MONITORAMENTO','STATUS'))==='PERNOITE'&&!routeHelperSunday))){const error=new Error(routeHelper?`${label} ${employee.nome} está em PERNOITE e não está disponível para nova escala.`:`${label} ${employee.nome} ainda está em rota sem retorno confirmado (${open.schedule.rota||open.schedule.id}).`);error.code=routeHelper?'EMPLOYEE_OVERNIGHT_UNAVAILABLE':'OPEN_MONITORING';throw error;}
    }
  }
  return {
    veiculo_id:candidate.veiculo_id,placa:candidate.placa,
    motorista_id:candidate.motorista_id,motorista:candidate.motorista,
    ajudante_1_id:candidate.ajudante_1_id,ajudante_1:candidate.ajudante_1,
    ajudante_2_id:candidate.ajudante_2_id,ajudante_2:candidate.ajudante_2,
    tipo_equipe:teamType,
  };
}

function findRoute(payload, context) {
  const route = context.routeById.get(String(payload.rota_id || '')) || context.routeByName.get(normalizeText(payload.rota));
  if (!route) { const error = new Error('Rota não encontrada ou não cadastrada.'); error.code='ROUTE_NOT_FOUND'; throw error; }
  if (!route.ativo) { const error = new Error('A rota selecionada está inativa.'); error.code='ROUTE_INACTIVE'; throw error; }
  return route;
}
function findVehicle(payload, context) {
  if (!payload.veiculo_id && !payload.placa) return null;
  return context.vehicleById.get(String(payload.veiculo_id || '')) || context.vehicleByPlate.get(plateKey(payload.placa)) || null;
}
function findEmployee(id,name,context) {
  return context.employeeById.get(String(id || '')) || context.employeeByName.get(normalizeText(name)) || null;
}
function statusForDate(employee,date) {
  if (date && employee.ferias_inicio && employee.ferias_fim && date >= employee.ferias_inicio && date <= employee.ferias_fim) return 'FÉRIAS';
  return normalizeText(employee.status || 'DISPONÍVEL');
}
function explicitAvailability(context,date,type,id) {
  return context.availability.some((row)=>sameDate(value(row,'DATA_DISPONIBILIDADE'),date) && normalizeText(value(row,'TIPO_RECURSO')) === normalizeText(type) && String(value(row,'RECURSO_ID')) === String(id) && normalizeText(value(row,'STATUS')) !== 'CANCELADO');
}
function manualReleaseFor(context,id,type){
  const map=context.manualReleaseMap;
  if(!map||typeof map.get!=='function')return null;
  const normType=normalizeText(type);const sid=String(id||'').trim();
  const employee=context.employeeById?.get(sid);const vehicle=context.vehicleById?.get(sid);
  const name=normType==='VEICULO'?plateKey(vehicle?.placa||''):normalizeText(employee?.nome||'');
  return map.get(`${normType}|ID|${sid}`)||(!['MOTORISTA','AJUDANTE'].includes(normType)?null:map.get(`COLABORADOR|ID|${sid}`))||
    (name?(map.get(`${normType}|NAME|${name}`)||(!['MOTORISTA','AJUDANTE'].includes(normType)?null:map.get(`COLABORADOR|NAME|${name}`))):null)||null;
}
function manualReleaseClearsConflict(release,schedule,candidate,context){
  if(!release?.effectiveAt||!schedule)return false;
  const releaseAt=parseOperationalDateTime(schedule.data,release.effectiveAt);
  const candidateWindow=scheduleWindow(candidate,context);const previousWindow=scheduleWindow(schedule,context);
  if(!releaseAt||!candidateWindow||!previousWindow||releaseAt>candidateWindow.start)return false;
  if(release.scheduleRecordId)return String(release.scheduleRecordId)===String(schedule.id||'');
  // Compatibilidade com liberações feitas antes da v1.0.40: o ID textual da
  // escala era convertido com Number() e se perdia. Nesse legado, o horário
  // efetivo da liberação prova que a ocupação anterior foi encerrada.
  return releaseAt>=previousWindow.start;
}
function allowsRepeatedDriverPlanning(schedule={}){
  const route=normalizeText([schedule.rota,schedule.destino,schedule.nome_rota,schedule.rota_nome].filter(Boolean).join(' ')).replace(/[^A-Z0-9]+/g,' ');
  return /\b(VENEZA|THERMOBRASIL)\b/.test(route);
}
function resourceUsed(schedule,id,type) {
  if (!id) return false;
  if (type === 'VEICULO') return String(schedule.veiculo_id) === String(id);
  return [schedule.motorista_id,schedule.ajudante_1_id,schedule.ajudante_2_id].map(String).includes(String(id));
}
// Resultado por escala é estável durante uma requisição: guardamos em cache no
// contexto. Sem isso, listas que cruzam todos os colaboradores com todas as escalas
// reconstruíam e reparseavam o mesmo JSON milhões de vezes (timeout na Saída).
function operationalResourceData(schedule,context){
  if(!schedule||!context||typeof context!=='object')return operationalResourceDataCompute(schedule,context);
  const cache=context.__operationalCache||(context.__operationalCache=new Map());
  if(cache.has(schedule))return cache.get(schedule);
  const result=operationalResourceDataCompute(schedule,context);
  cache.set(schedule,result);
  return result;
}
function operationalCrewIndex(schedule,context){
  const cache=context.__crewIndexCache||(context.__crewIndexCache=new Map());
  let index=cache.get(schedule);
  if(index)return index;
  const operational=operationalResourceData(schedule,context);
  index={operational,ids:new Set(),names:new Set()};
  if(operational){
    for(const id of [operational.motorista_id,operational.MOTORISTA_ID,operational.ajudante_1_id,operational.AJUDANTE_1_ID,operational.ajudante_2_id,operational.AJUDANTE_2_ID])if(id)index.ids.add(String(id));
    for(const name of [operational.motorista,operational.MOTORISTA,operational.ajudante_1,operational.AJUDANTE_1,operational.ajudante_2,operational.AJUDANTE_2]){const n=normalizeText(name);if(n)index.names.add(n);}
  }
  cache.set(schedule,index);
  return index;
}
function operationalResourceDataCompute(schedule,context){
  const scheduleId=String(schedule?.id||'');
  const departure=context.departureBySchedule?.get(scheduleId)||null;
  const monitoring=context.monitoringBySchedule?.get(scheduleId)||null;
  const departureData=parseData(value(departure,'DATA_JSON'))||{};
  const monitoringData=parseData(value(monitoring,'DATA_JSON'))||{};
  const departureStarted=Boolean(departure&&clean(value(departure,'DATA_HORA_SAIDA','ACTUAL_AT','SAIDA_REAL','HORA_REAL')||departureData.saida_real||departureData.hora_real));
  const monitoringStatus=normalizeText(value(monitoring,'STATUS_MONITORAMENTO','STATUS')||monitoringData.status_monitoramento||monitoringData.status);
  const monitoringActive=Boolean(monitoring&&['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO'].includes(monitoringStatus));
  if(!departureStarted&&!monitoringActive)return null;
  return {...schedule,...departureData,...monitoringData};
}
function effectiveResourceUsed(schedule,id,type,context){
  if(!id)return false;
  const operational=operationalResourceData(schedule,context);
  if(!operational){
    // Compatibilidade com registros gravados antes da v1.0.31: a Saída já podia
    // substituir a PLACA na Escala sem reconciliar o VEICULO_ID. Mesmo quando não
    // houver evidência operacional associada, placa e ID divergentes não podem manter
    // o veículo original preso. Quando há catálogo, a placa visível prevalece.
    if(type==='VEICULO'){
      const candidate=context.vehicleById?.get(String(id));
      const schedulePlate=plateKey(schedule?.placa||'');
      if(candidate?.placa&&schedulePlate)return schedulePlate===plateKey(candidate.placa);
    }
    return resourceUsed(schedule,id,type);
  }
  if(type==='VEICULO'){
    const candidate=context.vehicleById?.get(String(id));
    const actualPlate=plateKey(operational.placa||operational.PLACA||'');
    if(actualPlate&&candidate?.placa)return actualPlate===plateKey(candidate.placa);
    const actualId=String(operational.veiculo_id||operational.VEICULO_ID||'').trim();
    return Boolean(actualId&&actualId===String(id));
  }
  const candidate=context.employeeById?.get(String(id));
  const index=operationalCrewIndex(schedule,context);
  if(index.ids.has(String(id)))return true;
  const candidateName=normalizeText(candidate?.nome||'');
  if(!candidateName)return false;
  return index.names.has(candidateName);
}
function scheduleWindow(schedule,context) {
  const start = localDateTime(schedule.data,schedule.horario_ponto || defaultDepartureTime(schedule.data,context.settings));
  if (!start) return null;
  const confirmed = context.returnBySchedule.get(String(schedule.id));
  let end = confirmed ? parseOperationalDateTime(schedule.data,confirmed.dateTime) : null;
  if (!end) end = parseOperationalDateTime(schedule.data,schedule.previsao_retorno);
  if (!end) end = endOfDay(addDays(schedule.data,Math.max(1,Number(schedule.duracao_dias || 1)) - 1));
  if (!end || end < start) end = endOfDay(schedule.data);
  return { start,end,confirmedReturn:confirmed || null };
}
function windowsOverlap(left,right) { return Boolean(left && right && left.start < right.end && right.start < left.end); }
function scheduleClosedWithoutConfirmedReturn(schedule, context) {
  const status = normalizeText(schedule?.status);
  return ['FINALIZADO','RETORNOU'].includes(status) && !context.returnBySchedule.has(String(schedule?.id || ''));
}
function scheduleHasOperationalEvidence(schedule,context){
  const status=normalizeText(schedule?.status);
  if(['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO'].includes(status))return true;
  const id=String(schedule?.id||'');
  const monitoring=context.monitoringBySchedule?.get(id);
  if(monitoring&&['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO'].includes(normalizeText(value(monitoring,'STATUS_MONITORAMENTO','STATUS'))))return true;
  const departure=context.departureBySchedule?.get(id);
  if(departure&&clean(value(departure,'DATA_HORA_SAIDA','ACTUAL_AT','SAIDA_REAL','HORA_REAL')))return true;
  return false;
}
function todayBrt(){return new Date(Date.now()-3*3600*1000).toISOString().slice(0,10);}
// Escala de dia anterior ao novo dia, ainda não elapsada (data >= hoje) e sem Saída: o
// motorista continua comprometido (ex.: escalou 12/10 feriado e está escalando 13/10).
function pendingPriorPlanning(schedule,candidate,context){
  if(!schedule?.data||!candidate?.data)return false;
  const date=String(schedule.data);
  if(date>=String(candidate.data)||date<todayBrt())return false;
  if(['CANCELADO','FINALIZADO','RETORNOU'].includes(normalizeText(schedule.status)))return false;
  if(context?.returnBySchedule?.has(String(schedule.id||'')))return false;
  // Serviço administrativo/outros não gera Saída: nunca prende o motorista no dia seguinte.
  if(candidateIsAdministrative(schedule,context))return false;
  return !scheduleHasOperationalEvidence(schedule,context);
}
// Almoxarifado, serviços administrativos/outros e demais viagens internas não contam para o Plano de Alocação.
function excludedFromAllocationPlan(schedule,context){
  try{return isMonitoringExcludedTrip(schedule)||candidateIsAdministrative(schedule,context);}catch{return false;}
}
function candidateIsAdministrative(candidate,context){
  if(!candidate)return false;
  if(candidate.servico_administrativo)return true;
  try{return routeIsAdministrative(findRoute(candidate,context))||isAdministrativeNoLoadRoute(candidate.rota);}catch{return false;}
}
function stalePriorPlanningAllocation(schedule,candidate,context){
  // Uma escala de dia anterior que nunca virou Saída/Monitoramento não representa
  // ocupação operacional real. Ela não pode atravessar dias apenas por causa da
  // PREVISÃO_RETORNO e prender placa/motorista sem existir viagem em Retornos.
  // No mesmo dia o conflito de planejamento continua válido para evitar duplicidade.
  if(!schedule?.data||!candidate?.data||String(schedule.data)>=String(candidate.data))return false;
  if(context.returnBySchedule?.has(String(schedule.id||'')))return false;
  const status=normalizeText(schedule.status);
  if(['CANCELADO','FINALIZADO','RETORNOU'].includes(status))return true;
  return !scheduleHasOperationalEvidence(schedule,context);
}
function confirmedVehicleReturn(context,schedule,vehicleId='') {
  if(context.returnBySchedule.has(String(schedule?.id||'')))return context.returnBySchedule.get(String(schedule.id));
  const keys=[vehicleId||schedule?.veiculo_id?`ID|${String(vehicleId||schedule?.veiculo_id)}`:'',schedule?.placa?`PLATE|${plateKey(schedule.placa)}`:''].filter(Boolean);
  const confirmed=keys.map((key)=>context.returnByVehicle?.get(key)).filter(Boolean).sort((a,b)=>String(b.dateTime).localeCompare(String(a.dateTime)))[0];
  if(!confirmed)return null;
  const start=localDateTime(schedule.data,schedule.horario_ponto||defaultDepartureTime(schedule.data,context.settings));
  const returnedAt=parseOperationalDateTime(schedule.data,confirmed.dateTime);
  // Um retorno da mesma placa posterior ao início da viagem comprova que o
  // veículo voltou, mesmo quando o SCHEDULE_ID histórico está divergente.
  return start&&returnedAt&&returnedAt>=start?confirmed:null;
}
function resourceConflict(context,id,type,candidate,skip = false,availabilityType = type,confirmedReturnReleasesPlanning = false) {
  if (skip) {
    // Ajudante de rota pode apoiar viagens simultâneas, mas não com escala pendente de dia anterior.
    if (availabilityType!=='AJUDANTE') return null;
    return context.schedules.find((item)=>String(item.id)!==String(candidate.id||'')&&effectiveResourceUsed(item,id,type,context)&&pendingPriorPlanning(item,candidate,context)&&!candidateIsAdministrative(candidate,context))||null;
  }
  const candidateWindow = scheduleWindow(candidate,context);
  if (!candidateWindow) throw new Error('Data ou horário da nova escala é inválido.');
  const released = explicitAvailability(context,candidate.data,availabilityType,id);
  const manualRelease=manualReleaseFor(context,id,availabilityType);
  return context.schedules.find((item)=>{
    if (String(item.id) === String(candidate.id || '') || normalizeText(item.status) === 'CANCELADO' || !effectiveResourceUsed(item,id,type,context)) return false;
    // A confirmação de retorno encerra definitivamente a ocupação operacional da
    // viagem anterior para TODOS os recursos: veículo, motorista e ajudantes. A
    // Escala é um planejamento e pode ser cadastrada depois do retorno com horário
    // programado anterior; esse detalhe não pode reabrir uma viagem já encerrada.
    if (confirmedReturnReleasesPlanning && (context.returnBySchedule.has(String(item.id || '')) || (type==='VEICULO'&&confirmedVehicleReturn(context,item,id)))) return false;
    // Escala antiga que nunca gerou saída/monitoramento é somente planejamento
    // residual. Se ela é de um dia anterior à nova escala, não prolongamos a
    // ocupação pela previsão de retorno; caso contrário o usuário fica sem viagem
    // em Retornos para dar baixa e, ainda assim, o recurso permanece bloqueado.
    // Motorista escalado em dia anterior que ainda não saiu fica indisponível, exceto
    // para serviço administrativo/outros.
    if ((availabilityType==='MOTORISTA'||availabilityType==='AJUDANTE')&&pendingPriorPlanning(item,candidate,context)) {
      if (candidateIsAdministrative(candidate,context)||manualReleaseClearsConflict(manualRelease,item,candidate,context)||released) return false;
      return true;
    }
    if (stalePriorPlanningAllocation(item,candidate,context)) return false;
    // Um status residual FINALIZADO/RETORNOU sem retorno persistido também não
    // mantém o recurso preso pela previsão antiga.
    if (scheduleClosedWithoutConfirmedReturn(item,context)) return false;
    const current = scheduleWindow(item,context);
    if (!windowsOverlap(current,candidateWindow)) return false;
    // Liberação explícita prevalece somente sobre ocupação herdada de dia anterior.
    // Duplicidade real na mesma data continua bloqueada.
    if (manualReleaseClearsConflict(manualRelease,item,candidate,context)) return false;
    if (released && item.data < candidate.data) return false;
    return true;
  }) || null;
}
function openMonitoring(context,id,type,candidate,availabilityType = type) {
  const statuses = ['EM ROTA','PERNOITE','RETORNO PREVISTO'];
  const candidateWindow = scheduleWindow(candidate,context);
  if (!candidateWindow) return null;
  const released = explicitAvailability(context,candidate.data,availabilityType,id);
  const manualRelease=manualReleaseFor(context,id,availabilityType);
  for (const row of context.monitoring) {
    if (!statuses.includes(normalizeText(value(row,'STATUS_MONITORAMENTO')))) continue;
    const scheduleId = text(row,'ESCALA_ID');
    if (String(scheduleId) === String(candidate.id || '')) continue;
    const schedule = context.schedules.find((item)=>String(item.id) === String(scheduleId));
    if (!schedule || !effectiveResourceUsed(schedule,id,type,context)) continue;
    // Um retorno confirmado sempre vence um status residual de Monitoramento.
    // Isso evita bloquear placa/motorista que já voltou e já foi liberado.
    if (context.returnBySchedule.has(String(schedule.id || '')) || (type==='VEICULO'&&confirmedVehicleReturn(context,schedule,id))) continue;
    // Monitoramento antigo também não reabre uma rota já encerrada sem retorno persistido.
    if (scheduleClosedWithoutConfirmedReturn(schedule,context)) continue;
    const previousWindow = scheduleWindow(schedule,context);
    // Correção v2.0.44: monitoramento aberto só bloqueia se a janela REALMENTE se sobrepõe.
    if (!windowsOverlap(previousWindow,candidateWindow)) continue;
    if (manualReleaseClearsConflict(manualRelease,schedule,candidate,context)) continue;
    if (released && schedule.data < candidate.data) continue;
    return { row,schedule,window:previousWindow };
  }
  return null;
}
function vehicleReserved(context,vehicleId,date) {
  const selected = dateIso(date);
  return context.reservations.some((row)=>{
    if (String(value(row,'VEICULO_ID')) !== String(vehicleId) || ['CANCELADO','FINALIZADA'].includes(normalizeText(value(row,'STATUS')))) return false;
    const start = dateIso(value(row,'DATA_INICIO')); const end = dateIso(value(row,'DATA_FIM'));
    return selected >= start && (!end || selected <= end);
  });
}
function previousJourney(context,employeeId,start,ignoredId) {
  const candidates = [];
  for (const item of context.schedules) {
    if (String(item.id) === String(ignoredId || '') || normalizeText(item.status) === 'CANCELADO' || !resourceUsed(item,employeeId,'COLABORADOR')) continue;
    const window = scheduleWindow(item,context);
    if (window && window.start < start && window.end <= start) candidates.push({ schedule:item,end:window.end });
  }
  candidates.sort((a,b)=>b.end-a.end);
  return candidates[0] || null;
}
function warning(code,message,details = null) { return { code,message,details }; }

// v1.0.46 — jornada semanal e preferências operacionais fornecidas pela operação.
// Equipe terça–sábado da comunicação operacional. Demais colaboradores seguem segunda–sexta.
const TUE_SAT_CREW = new Set([
  'ALLAN BRITO DOS SANTOS','JOSE GENIVALDO','JOSE GENIVALDO DA SILVA',
  'ANDERSON ROBERTO DA SILVA','ELIEZER SALES','CLECIO CRISTIANO NASCIMENTO SILVA','ANTONIO BATISTA',
  'CRISTIANO ANTONIO DA SILVA','VITOR AZEVEDO','DARIO TAVARES DE SOUZA','ANDERSON GUIMARAES',
  'EDMILSON DE MELO SILVA','ADERALDO BEZERRA','JOAO KARLOS CARIAS CALUMBY','JOAO HENRIQUE',
  'PAULO MARCIO LIRA SILVA','WILSON CARLOS'
].map(normalizeText));

// Duas rotas de referência por motorista, conforme "Definição de Rotas por Motorista".
const DRIVER_ROUTE_REFERENCES = new Map(Object.entries({
  'ADEILDO SOUZA DA SILVA':['PETROLINA','ARARIPINA'],
  'ALLAN BRITO DOS SANTOS':['PESQUEIRA','ARCOVERDE'],
  'ATAGNAN BEZERRA DA SILVA':['ARCOVERDE','SAO BENTO DO UNA'],
  'ANDERSON ROBERTO DA SILVA':['CARUARU','SAO CAETANO'],
  'ANTONIO BEZERRA DA SILVA FILHO':['PETROLINA','OURICURI'],
  'AILTON SILVA SANTOS':['GARANHUNS','SAO BENTO DO UNA'],
  'AIRTON SEBASTIAO DE OLIVEIRA':['AGUAS BELAS','SANTA CRUZ DO CAPIBARIBE'],
  'BRUNO CESAR DOS SANTOS SOEIRO':['OURICURI','ARARIPINA'],
  'BRUNO CESAR CONCEICAO DOS SANTOS':['MACEIO'],
  'CLAUDIVAN GOMES DOS SANTOS':['GARANHUNS','SAO JOAO'],
  'CLECIO CRISTIANO NASCIMENTO SILVA':['LAJEDO','SAO JOAO'],
  'CRISTIANO ANTONIO DA SILVA':['BELO JARDIM','SAO CAETANO'],
  'DANIEL LOPES DA SILVA':['SERRA TALHADA','BELO JARDIM'],
  'DARIO TAVARES DE SOUZA':['SURUBIM','SANTA CRUZ DO CAPIBARIBE'],
  'DJAILSON SANTOS DE LEMOS':['SALGUEIRO','SERTANIA'],
  'DOUGLAS SILVA CALADO':['CARUARU','SAO CAETANO'],
  'EDMILSON DE MELO SILVA':['CARUARU','SAO CAETANO'],
  'EDSON JOSE DA SILVA':['MACEIO','ARAPIRACA'],
  'EDSON BEZERRA DE VASCONCELOS':['MACEIO','ARAPIRACA'],
  'EDUARDO ARAUJO DE MELO':['FLORESTA','CABROBO'],
  'EDUARDO DA SILVA LEITE':['PETROLINA','SALGUEIRO'],
  'EMERSON DE FREITAS BARROS':['ARCOVERDE','BUIQUE'],
  'EMERSON HENRIQUE BARBOSA DIAS':['SANTA CRUZ REDES','SURUBIM REDES'],
  'ERIVANIO FRANCISCO DA SILVA':['MIRANDIBA','SALGUEIRO'],
  'EUDES FEREIRA DA SILVA':['SERRA TALHADA REDES','SALGUEIRO REDES'],
  'FABIO TULIO AGRA COSTA':['SURUBIM','JATAUBA'],
  'GERMANO LEITE TEIXEIRA':['PETROLINA','DORMENTES'],
  'IVANILDO FERREIRA BATINGA':['PETROLINA','DORMENTES'],
  'JAILTON DIAS BARBOSA':['PETROLANDIA','SERTANIA'],
  'IZAIAS ARAUJO DOS SANTOS':['SERRA TALHADA','SALGUEIRO'],
  'JOAO KARLOS CARIAS CALUMBY':['GARANHUNS','BOM CONSELHO'],
  'JEAN CARLOS FERNANDES DA SILVA JUNIOR':['PETROLINA','ARARIPINA'],
  'JEFFERSON ALVES DOS SANTOS':['PETROLINA','ARARIPINA'],
  'JEFFERSON DA SILVA ALMEIDA':['PETROLANDIA','SALGUEIRO'],
  'JOSE EROMIR DE LIMA':['SERRA TALHADA','SERTANIA'],
  'JOSE ALESANDRO DE MELO':['ARARIPINA REDES','SERRA TALHADA REDES'],
  'JOSE CARLOS DA SILVA':['PETROLINA','ARARIPINA'],
  'JOSE CICERO ALVES FERREIRA':['ARARIPINA REDES','SERRA TALHADA REDES'],
  'JOSE EDUARDO PEREIRA CORDEIRO':['FLORESTA','CABROBO'],
  'JOSE FERNANDO DE ANDRADE':['PETROLINA','ARARIPINA'],
  'JOSE FLAVIO DA SILVA CALADO':['GARANHUNS','SAO BENTO DO UNA'],
  'JOSEILTON DE OLIVEIRA BARBOSA':['PESQUEIRA','VENTUROSA'],
  'JOSE MARCONE DA COSTA SILVA':['AGRESTINA','BELO JARDIM'],
  'JOSEMILTON FALCAO DE MELO':['SURUBIM REDES','SERRA TALHADA REDES'],
  'JOSE MONTEIRO DE SOUZA JUNIOR':['FLORESTA','CABROBO'],
  'JUAN HENRIQUE TORRES PIMENTEL':['INGAZEIRA','PATOS'],
  'JUCELIO CAETANO BEZERRA':['SALGUEIRO','ARARIPINA'],
  'LEANDRO DO VALE GALVAO':['PETROLINA','DORMENTES'],
  'LOURIVAL ALEXANDRE DE LIMA':['CAMPINA GRANDE','BELO JARDIM'],
  'LEONARDO FERREIRA DE ARAUJO':['ARARIPINA','SALGUEIRO'],
  'LUCAS QUEIROZ':['CARUARU','SAO CAETANO'],
  'LUIDSON DE OLIVEIRA':['INGAZEIRA','PATOS'],
  'MARCONE LOPES CORDEIRO':['MACEIO','ARAPIRACA'],
  'MARCELO JACKSON COELHO SOUZA':['ARCOVERDE','BUIQUE'],
  'OZIEL LUIZ TENORIO':['GARANHUNS','BOM CONSELHO'],
  'PAULO ROBERTO DOS SANTOS':['GARANHUNS','CARUARU'],
  'PAULO WELLINGTON MONTEIRO DA SILVA':['MACEIO','CAMPINA GRANDE'],
  'PAULO MARCIO LIRA SILVA':['ARAPIRACA','MACEIO'],
  'PEDRO ERLANDSON LIMA ESPINDULA':['MACEIO','CAMPINA GRANDE'],
  'WESLEY DE SOUZA LINS':['CAMPINA GRANDE','SALGUEIRO']
}).map(([name,routes])=>[normalizeText(name),routes.map(normalizeText)]));

function employeeRoster(employee={}) {
  return TUE_SAT_CREW.has(normalizeText(employee.nome)) ? 'TERCA_SABADO' : 'SEGUNDA_SEXTA';
}
function weekdayNumber(date){const day=dateIso(date);if(!day)return -1;return new Date(`${day}T12:00:00Z`).getUTCDay();}
function rosterAllows(employee,date){const day=weekdayNumber(date),profile=employeeRoster(employee);return profile==='TERCA_SABADO' ? day>=2&&day<=6 : day>=1&&day<=5;}
function rosterLabel(employee={}){return employeeRoster(employee)==='TERCA_SABADO'?'Terça a sábado':'Segunda a sexta';}
function routeReferenceScore(employee,route){
  const refs=DRIVER_ROUTE_REFERENCES.get(normalizeText(employee?.nome))||[];const target=normalizeText(destinationBase(route?.rota||route||''));
  if(!target)return 0;const index=refs.findIndex((ref)=>destinationBase(ref)===target||ref===target);return index===0?60:index===1?45:0;
}
function dateRangeInclusive(start,end){const out=[];let day=dateIso(start),last=dateIso(end);for(let guard=0;day&&last&&day<=last&&guard<40;guard+=1){out.push(day);day=addDays(day,1);}return out;}
function workSignalKey(employee={}){return String(employee.id||'').trim()||`NAME|${normalizeText(employee.nome)}`;}
function scheduleWorkInterval(context,schedule,selectedDate){
  const selected=dateIso(selectedDate);const scheduleDay=dateIso(schedule?.data);if(!selected||!scheduleDay)return null;
  const scheduleId=String(schedule?.id||'');const status=normalizeText(schedule?.status);
  if(status==='CANCELADO'||scheduleDay>selected)return null;
  const returned=context.returnBySchedule?.get(scheduleId)||null;
  const departed=context.departureBySchedule?.get(scheduleId)||null;
  const monitoring=context.monitoringBySchedule?.get(scheduleId)||null;
  const departureData=parseData(value(departed,'DATA_JSON'))||{};
  const monitoringData=parseData(value(monitoring,'DATA_JSON'))||{};

  // O primeiro dia trabalhado vem da saída REAL quando ela existe. A data da Escala
  // é apenas fallback para históricos antigos que já possuem outra evidência operacional.
  const departureAt=clean(value(departed,'DATA_HORA_SAIDA','ACTUAL_AT','SAIDA_REAL','HORA_REAL')||departureData.saida_real||departureData.hora_real,80);
  const departureLocal=dateTimeLocal(departureAt,scheduleDay);
  const start=dateIso(departureLocal)||scheduleDay;

  // Retorno confirmado encerra o trabalho exatamente na data real do retorno. O mapa
  // guarda data/hora como string local (YYYY-MM-DDTHH:mm), portanto dateIso() deve ser
  // usado diretamente; formatLocalDateTime() recebe Date e fazia o histórico perder o
  // dia do retorno em viagens com pernoite.
  const storedReturn=clean(
    returned?.dateTime||schedule?.retorno_real||schedule?.DATA_HORA_RETORNO||monitoringData.retorno_real||monitoringData.return_at||monitoringData.DATA_HORA_RETORNO,
    80,
  );
  let end=dateIso(storedReturn);
  const monitoringStatus=normalizeText(value(monitoring,'STATUS_MONITORAMENTO','STATUS')||monitoringData.status_monitoramento||monitoringData.status);
  const monitoringActive=['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO'].includes(monitoringStatus);
  const activeStatus=['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO'].includes(status);
  const closedStatus=['RETORNOU','FINALIZADO'].includes(status)||['RETORNOU','FINALIZADO'].includes(monitoringStatus);
  const hasEvidence=Boolean(returned||departureAt||monitoring||activeStatus||closedStatus);
  if(!hasEvidence)return null; // Escala apenas programada nunca conta como dia trabalhado.

  if(!end){
    if(activeStatus||monitoringActive||(departureAt&&!closedStatus)){
      // Sem retorno confirmado, a viagem permanece aberta e todos os dias até a data
      // selecionada contam como trabalhados, inclusive pernoites.
      end=selected;
    }else{
      // Uma viagem já FINALIZADA/RETORNOU nunca pode ser estendida artificialmente até
      // hoje só porque o vínculo legado com ROUTE_RETURNS falhou. Nesse caso usamos a
      // duração conhecida da Escala como limite conservador até o retorno ser reconciliado.
      end=addDays(start,Math.max(1,Number(schedule?.duracao_dias||1))-1)||start;
    }
  }
  if(end>selected)end=selected;if(end<start)end=start;
  return {start,end,closed:Boolean(end&&end<selected)||closedStatus,hasConfirmedReturn:Boolean(returned||storedReturn)};
}
function contextEmployeeWorkSignals(context,selectedDate){
  const selected=dateIso(selectedDate);const worked=new Map();
  const add=(employeeId,employeeName,day)=>{const employee=(employeeId&&context.employeeById.get(String(employeeId)))||context.employeeByName.get(normalizeText(employeeName));if(!employee||!day)return;if(employee.ajudante_rota&&isSundayDate(day))return;const key=workSignalKey(employee);if(!worked.has(key))worked.set(key,new Set());worked.get(key).add(day);};
  for(const schedule of context.schedules||[]){
    const interval=scheduleWorkInterval(context,schedule,selected);if(!interval)continue;
    for(const day of dateRangeInclusive(interval.start,interval.end)){
      add(schedule.motorista_id,schedule.motorista,day);add(schedule.ajudante_1_id,schedule.ajudante_1,day);add(schedule.ajudante_2_id,schedule.ajudante_2,day);
    }
  }
  const output=new Map();
  for(const employee of context.employees||[]){
    const dates=worked.get(workSignalKey(employee))||new Set();
    let before=0,cursor=addDays(selected,-1);while(dates.has(cursor)&&before<30){before+=1;cursor=addDays(cursor,-1);}
    const breakDate=before===0?addDays(selected,-1):cursor;
    let current=before;if(dates.has(selected))current+=1;
    output.set(workSignalKey(employee),{days:current,before,worksSelected:dates.has(selected),dates:[...dates].sort(),breakDate,roster:employeeRoster(employee),rosterLabel:rosterLabel(employee)});
  }
  return output;
}
function workSignalFor(context,employee){return context.workSignals?.get(workSignalKey(employee))||{days:0,before:0,worksSelected:false,roster:employeeRoster(employee),rosterLabel:rosterLabel(employee)};}
function withWorkSignals(resources,context){return (resources||[]).map((item)=>{const signal=workSignalFor(context,item);return {...item,dias_consecutivos:signal.days,dias_consecutivos_anteriores:signal.before,dias_trabalhados_recentes:(signal.dates||[]).slice(-10),data_quebra_sequencia:signal.breakDate||'',jornada_semanal:signal.roster,jornada_semanal_label:signal.rosterLabel};});}
function seventhDayProjection(context,employee,schedule){
  const signal=workSignalFor(context,employee);const routeDays=Math.max(1,Number(schedule.duracao_dias||1));const projected=signal.before+routeDays;
  if(projected<7)return null;const offset=Math.max(0,7-signal.before-1);return {projected,seventhDate:addDays(schedule.data,offset),base:signal.before,routeDays};
}


function lockedStatus(status) { return ['EM ROTA','PERNOITE','RETORNOU','FINALIZADO'].includes(normalizeText(status)); }
function destinationBase(route) {
  let tokens = normalizeText(route).replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
  const region = ['AG1','AG2','SRT','STR','PB','AL','RN','CE','BJ','MARANHAO'];
  const cargo = ['REDE','REDES','VAREJO','ATACADO','MISTO','MISTA','CARGA','FECHADA','FECHADO'];
  while (tokens.length && region.includes(tokens[0])) tokens.shift();
  tokens = tokens.filter((token)=>!cargo.includes(token));
  return tokens.join(' ');
}
function canonicalRouteName(route='') {
  const region = new Set(['AG1','AG2','SRT','STR','PB','AL','RN','CE','BJ','MARANHAO']);
  const tokens=normalizeText(route).replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
  while(tokens.length&&region.has(tokens[0]))tokens.shift();
  return tokens.join(' ');
}
function helperAllowedRouteNames(employee={}) {
  return String(employee.rotas_atendidas||'').split(/[;,|\n]+/).map((item)=>canonicalRouteName(item)).filter(Boolean);
}
function helperSupportsRoute(employee,route={}) {
  if(!employee?.ajudante_rota)return true;
  const target=canonicalRouteName(route.rota||route.nome||'');
  if(!target)return false;
  return helperAllowedRouteNames(employee).includes(target);
}
function isNetworkRoute(route={}) {
  return normalizeText([route.rota,route.nome,route.perfil].filter(Boolean).join(' ')).includes('REDE');
}
const SCHEDULE_AUTO_OBSERVATIONS=['Identificar palete','Bonanza','Baixar divisória'];
function scheduleLoadOrderCount(value='') {
  const normalized=normalizeLoadOrders(value);
  return normalized ? normalized.split(' / ').filter(Boolean).length : 0;
}
function scheduleAutomaticObservationParts(schedule={}) {
  const notes=[];
  const networkRoute=/\bREDES?\b/.test(normalizeText(schedule.rota));
  if(scheduleLoadOrderCount(schedule.ocs)>1) notes.push(networkRoute?'Identificar palete':'Bonanza');
  const temp=Number(schedule.temperatura_frio_c);
  if(networkRoute&&Number.isFinite(temp)&&Math.abs(temp-(-8))<0.0001) notes.push('Baixar divisória');
  return notes;
}
function applyScheduleAutomaticObservations(current='',schedule={}) {
  const autoKeys=new Set(SCHEDULE_AUTO_OBSERVATIONS.map((item)=>normalizeText(item)));
  const manual=String(current||'').split(/\s*(?:\||·|;|\n)\s*/).map((item)=>item.trim()).filter(Boolean).filter((item)=>!autoKeys.has(normalizeText(item)));
  return [...scheduleAutomaticObservationParts(schedule),...manual].join(' | ');
}
function isThirdPartyLink(value='') { return normalizeText(value).includes('TERCEIR'); }
function routesDerived(current,next) {
  if (!current || !next) return false;
  if (String(current.id) === String(next.id)) return true;
  return normalizeRegion(current.regiao,current.rota) === normalizeRegion(next.regiao,next.rota) && destinationBase(current.rota) && destinationBase(current.rota) === destinationBase(next.rota);
}

// Folga registrada depois de a pessoa já estar na escala não impede atualizações do
// mesmo registro (ex.: Saída); só bloqueia colocar alguém NOVO em folga.
function timeOffUnchanged(existing,employee,role){
  if(!existing)return false;
  const slots=role==='MOTORISTA'?[[existing.motorista_id,existing.motorista]]:[[existing.ajudante_1_id,existing.ajudante_1],[existing.ajudante_2_id,existing.ajudante_2]];
  return slots.some(([id,name])=>sameEmployeeReference(employee.id,employee.nome,id,name));
}
async function validateSchedule(db,payload,existing,user,context,options={}) {
  const source = { ...(existing || {}), ...(payload || {}) };
  const route = findRoute(source,context);
  if (existing && lockedStatus(existing.status)) {
    const immutable = [
      ['data','data'],['sequencia','sequência'],['ocs','carga'],['peso_kg','peso da carga'],['horario_ponto','horário programado'],['temperatura_frio_c','temperatura do frio'],
      ['veiculo_id','veículo'],['motorista_id','motorista'],['ajudante_1_id','ajudante 1'],['ajudante_2_id','ajudante 2'],['tipo_equipe','tipo de equipe'],
    ];
    for (const [field,label] of immutable) {
      if (payload[field] !== undefined && normalizeText(payload[field]) !== normalizeText(existing[field])) {
        const error = new Error(`A escala está ${normalizeText(existing.status)} e o campo ${label} não pode mais ser alterado.`); error.code='SCHEDULE_LOCKED'; throw error;
      }
    }
    const currentRoute = context.routeById.get(String(existing.rota_id || '')) || context.routeByName.get(normalizeText(existing.rota));
    if (String(route.id) !== String(existing.rota_id || '') && !routesDerived(currentRoute,route)) {
      const error = new Error(`Com a escala ${normalizeText(existing.status)}, o destino só pode ser trocado por uma variação da mesma rota-base e região, vinculada a outro tipo de carga.`); error.code='DESTINATION_GROUP_MISMATCH'; throw error;
    }
  }

  const allowIncompleteCrew = Boolean(options.allowIncompleteCrew) && !existing && normalizeText(source.status || 'PROGRAMADO') === 'PROGRAMADO';
  const schedule = {
    ...(existing || {}),
    data:dateIso(source.data), sequencia:clean(source.sequencia,80), ocs:normalizeLoadOrders(source.ocs), qtd_entregas:Math.max(0,Math.round(Number(source.qtd_entregas || 0))),
    peso_kg:Math.max(0,Number(String(source.peso_kg ?? '').replace(',','.')) || 0), horario_ponto:timeOnly(source.horario_ponto || defaultDepartureTime(source.data,context.settings)),
    temperatura_frio_c:optionalNumberValue(source.temperatura_frio_c ?? source.TEMPERATURA_FRIO_C),
    rota_id:route.id, rota:route.rota, destino:'', regiao:normalizeRegion(route.regiao,route.rota), duracao_dias:Math.max(1,Math.round(Number(route.duracao_dias || 1))),
    veiculo_id:clean(source.veiculo_id,120), placa:clean(source.placa,30), motorista_id:clean(source.motorista_id,120), motorista:clean(source.motorista,180),
    ajudante_1_id:clean(source.ajudante_1_id,120), ajudante_1:clean(source.ajudante_1,180), ajudante_2_id:clean(source.ajudante_2_id,120), ajudante_2:clean(source.ajudante_2,180),
    tipo_equipe:normalizeText(source.tipo_equipe || 'UM_AJUDANTE'), status:existing && lockedStatus(existing.status) ? existing.status : normalizeText(source.status || 'PROGRAMADO'),
    observacoes:clean(source.observacoes,4000),
  };
  schedule.observacoes=applyScheduleAutomaticObservations(schedule.observacoes,schedule);
  schedule.peso_t = schedule.peso_kg / 1000;
  schedule.carga_fechada = schedule.tipo_equipe === 'CARGA_FECHADA';
  if (!schedule.data) throw new Error('Preencha os campos obrigatórios: DATA.');
  if (!schedule.horario_ponto) throw new Error('Horário de ponto inválido.');
  if (String(source.temperatura_frio_c ?? source.TEMPERATURA_FRIO_C ?? '').trim() && schedule.temperatura_frio_c === '') throw new Error('Temperatura do frio inválida. Informe um valor numérico em °C.');
  if (!TEAM_TYPES.includes(schedule.tipo_equipe)) throw new Error(`Valor inválido para TIPO DE EQUIPE: ${schedule.tipo_equipe}.`);
  if (!SCHEDULE_STATUSES.includes(schedule.status)) throw new Error(`Valor inválido para STATUS: ${schedule.status}.`);
  const administrativeService = routeIsAdministrative(route) || isAdministrativeNoLoadRoute(schedule.rota);
  const administrativeOptional = administrativeService;
  const nonDeparture = !normalizeLoadOrders(schedule.ocs) || administrativeService;
  // Serviço administrativo/outros não exige ajudante: sem ajudante informado vira SEM_AJUDANTE.
  if (administrativeService && ['UM_AJUDANTE','DOIS_AJUDANTES'].includes(schedule.tipo_equipe) && !schedule.ajudante_1_id && !schedule.ajudante_1 && !schedule.ajudante_2_id && !schedule.ajudante_2) schedule.tipo_equipe = 'SEM_AJUDANTE';
  if (!nonDeparture && schedule.peso_kg <= 0) throw new Error('Informe um peso maior que zero para escalas com ordem de carga.');
  if (!nonDeparture && !schedule.sequencia) throw new Error('Preencha os campos obrigatórios: SEQUENCIA_CARREGAMENTO.');
  if (!allowIncompleteCrew && !schedule.motorista_id && !schedule.motorista) throw new Error('Preencha os campos obrigatórios: MOTORISTA_ID.');
  if (!administrativeOptional && !schedule.veiculo_id && !schedule.placa) throw new Error('Preencha os campos obrigatórios: VEICULO_ID.');
  if (['CARGA_FECHADA','TERCEIRO','SEM_AJUDANTE'].includes(schedule.tipo_equipe)) { schedule.ajudante_1_id=''; schedule.ajudante_1=''; schedule.ajudante_2_id=''; schedule.ajudante_2=''; }
  // DOIS_MOTORISTAS: Motorista 2 (vaga de Ajudante 1) + 1 ajudante (vaga de Ajudante 2); no máximo 3 pessoas no carro.
  // Placa que permite até 3 motoristas (ex.: T-Cross): o ajudante é opcional.
  const crewVehicle = findVehicle(schedule,context);
  const vehicleMaxDrivers = Math.max(1,Number(crewVehicle?.max_motoristas||1)||1);
  if (schedule.tipo_equipe === 'DOIS_MOTORISTAS') { if (!allowIncompleteCrew && !schedule.ajudante_1_id && !schedule.ajudante_1) throw new Error('Selecione o Motorista 2.'); if (!allowIncompleteCrew && !administrativeService && vehicleMaxDrivers < 3 && !schedule.ajudante_2_id && !schedule.ajudante_2) throw new Error('Selecione o Ajudante (equipe de 2 motoristas leva 1 ajudante).'); }
  if (schedule.tipo_equipe === 'TRES_MOTORISTAS') {
    if (vehicleMaxDrivers < 3) throw new Error(`A placa ${crewVehicle?.placa||schedule.placa||''} não permite três motoristas. Habilite "até 3 motoristas" no cadastro do veículo.`);
    if (!allowIncompleteCrew && ((!schedule.ajudante_1_id&&!schedule.ajudante_1)||(!schedule.ajudante_2_id&&!schedule.ajudante_2))) throw new Error('Selecione o Motorista 2 e o Motorista 3.');
  }
  if (schedule.tipo_equipe === 'UM_AJUDANTE') { if (!allowIncompleteCrew && !schedule.ajudante_1_id && !schedule.ajudante_1) throw new Error('Selecione o Ajudante 1.'); schedule.ajudante_2_id=''; schedule.ajudante_2=''; }
  if (!allowIncompleteCrew && schedule.tipo_equipe === 'DOIS_AJUDANTES' && ((!schedule.ajudante_1_id&&!schedule.ajudante_1)||(!schedule.ajudante_2_id&&!schedule.ajudante_2))) throw new Error('Selecione os dois ajudantes.');

  const vehicle = findVehicle(schedule,context);
  const vehicleIsThirdParty = vehicle && normalizeText(vehicle.vinculo).includes('TERCEIR');
  if (vehicleIsThirdParty) {
    schedule.tipo_equipe='TERCEIRO'; schedule.carga_fechada=false;
    schedule.ajudante_1_id=''; schedule.ajudante_1=''; schedule.ajudante_2_id=''; schedule.ajudante_2='';
  }
  const driver = schedule.motorista_id || schedule.motorista ? findEmployee(schedule.motorista_id,schedule.motorista,context) : null;
  const helper1 = schedule.ajudante_1_id || schedule.ajudante_1 ? findEmployee(schedule.ajudante_1_id,schedule.ajudante_1,context) : null;
  const helper2 = schedule.ajudante_2_id || schedule.ajudante_2 ? findEmployee(schedule.ajudante_2_id,schedule.ajudante_2,context) : null;
  if (!allowIncompleteCrew && (!driver || !driver.ativo)) throw new Error('Colaborador inexistente ou inativo.');
  if (driver && !driver.ativo) throw new Error('Colaborador inexistente ou inativo.');
  if (driver && driver.funcao !== 'MOTORISTA') throw new Error(`${driver.nome} não está cadastrado como motorista.`);
  const thirdDriverTeam = schedule.tipo_equipe === 'TRES_MOTORISTAS';
  const secondDriverTeam = schedule.tipo_equipe === 'DOIS_MOTORISTAS' || thirdDriverTeam;
  for (const helper of [helper1,helper2].filter(Boolean)) {
    if (!helper.ativo) throw new Error('Colaborador inexistente ou inativo.');
    if (thirdDriverTeam && helper === helper2) { if (helper.funcao !== 'MOTORISTA') throw new Error(`${helper.nome} não está cadastrado como motorista.`); continue; }
    if (secondDriverTeam && helper === helper1) { if (helper.funcao !== 'MOTORISTA') throw new Error(`${helper.nome} não está cadastrado como motorista.`); continue; }
    if (helper.funcao !== 'AJUDANTE') throw new Error(`${helper.nome} não está cadastrado como ajudante.`);
  }
  if (!administrativeOptional && (!vehicle || !vehicle.ativo)) throw new Error('Veículo inexistente ou inativo.');
  if (helper1 && helper2 && String(helper1.id) === String(helper2.id)) throw new Error(thirdDriverTeam ? 'Os três motoristas precisam ser pessoas diferentes.' : 'O mesmo ajudante não pode ocupar as duas posições.');
  if (driver && [helper1?.id,helper2?.id].filter(Boolean).map(String).includes(String(driver.id))) throw new Error(secondDriverTeam ? 'Os dois motoristas precisam ser pessoas diferentes.' : 'O motorista não pode ser ajudante na mesma carga.');
  if (driver && context.carreteiros) {
    if (isCarreteiroDriver(context.carreteiros,driver)) { const error=new Error(`Motorista ${driver.nome} é carreteiro (CAJU - Carreteiros) e não pode ser escalado.`); error.code='CARRETEIRO_NOT_SCHEDULABLE'; throw error; }
    if (!administrativeService && vehicle && !bitruckDriverMayUsePlate(context.carreteiros,driver,vehicle.placa)) { const error=new Error(`Motorista de bitruck ${driver.nome} só pode ser escalado em placa de bitruck cadastrada em CAJU - Carreteiros.`); error.code='BITRUCK_DRIVER_PLATE_MISMATCH'; throw error; }
  }
  if (driver && isThirdPartyLink(driver.vinculo) && !vehicleIsThirdParty) { const error=new Error(`Motorista terceiro ${driver.nome} só pode ser escalado em veículo terceiro.`); error.code='THIRD_PARTY_DRIVER_VEHICLE_MISMATCH'; throw error; }
  for (const helper of [helper1,helper2].filter(Boolean)) {
    if (secondDriverTeam && helper === helper1) continue;
    if (thirdDriverTeam && helper === helper2) continue;
    if (helper.ajudante_rota && !helperSupportsRoute(helper,route)) {
      const allowed=helperAllowedRouteNames(helper);
      const error=new Error(allowed.length?`Ajudante de rota ${helper.nome} só pode apoiar as rotas cadastradas: ${allowed.join(', ')}.`:`Ajudante de rota ${helper.nome} não possui Rotas atendidas cadastradas na Base de Ajudantes.`);
      error.code='ROUTE_HELPER_ROUTE_MISMATCH'; throw error;
    }
    if (helper.restricao_ajudante && !isNetworkRoute(route)) { const error=new Error(`Ajudante ${helper.nome} possui restrição e só pode ser escalado em rotas de Redes.`); error.code='HELPER_RESTRICTION_NETWORK_ONLY'; throw error; }
  }

  schedule.veiculo_id = vehicle?.id || '';
  schedule.placa = vehicle?.placa || schedule.placa || '';
  schedule.motorista_id = driver?.id || ''; schedule.motorista = driver?.nome || '';
  schedule.ajudante_1_id = helper1?.id || ''; schedule.ajudante_1 = helper1?.nome || '';
  schedule.ajudante_2_id = helper2?.id || ''; schedule.ajudante_2 = helper2?.nome || '';
  schedule.ajudantes = [schedule.ajudante_1,schedule.ajudante_2].filter(Boolean).join(' / ');
  const start = localDateTime(schedule.data,schedule.horario_ponto);
  if (!start) throw new Error('Não foi possível combinar a data da escala com o horário de ponto.');
  schedule.limite_jornada = formatLocalDateTime(journeyLimit(start,context.settings));
  const requestedReturn = source.previsao_retorno;
  let returnDate = requestedReturn ? parseOperationalDateTime(schedule.data,requestedReturn) : null;
  if (requestedReturn && !returnDate) throw new Error('Previsão de retorno inválida.');
  if (returnDate && returnDate < start) throw new Error('A previsão de retorno não pode ser anterior à saída.');
  if (!returnDate && schedule.duracao_dias > 1) returnDate = endOfDay(addDays(schedule.data,schedule.duracao_dias - 1));
  schedule.previsao_retorno = returnDate ? formatLocalDateTime(returnDate) : '';
  if (!existing) schedule.previsao_termino = '';

  const warnings = [];
  if (allowIncompleteCrew) {
    const missing=[];
    if (!driver) missing.push('motorista');
    if (schedule.tipo_equipe === 'UM_AJUDANTE' && !helper1) missing.push('ajudante');
    if (schedule.tipo_equipe === 'DOIS_AJUDANTES') {
      if (!helper1) missing.push('ajudante 1');
      if (!helper2) missing.push('ajudante 2');
    }
    if (missing.length) warnings.push(warning('INCOMPLETE_CREW_IMPORT',`Pré-escala incompleta: preencher manualmente ${missing.join(', ')}.`,{missing}));
  }
  if (vehicle) {
    const blocked = ['EM ROTA','PERNOITE','MANUTENÇÃO','RESERVADO','BLOQUEADO','ANOMALIA','INATIVO'];
    if (blocked.includes(normalizeText(vehicle.status)) && !explicitAvailability(context,schedule.data,'VEICULO',vehicle.id)) warnings.push(warning('VEHICLE_STATUS',`Veículo ${vehicle.placa} está com status ${vehicle.status}.`,{vehicleId:vehicle.id,status:vehicle.status}));
    if (vehicleReserved(context,vehicle.id,schedule.data)) warnings.push(warning('VEHICLE_RESERVED',`Veículo ${vehicle.placa} possui reserva para esta data.`,{vehicleId:vehicle.id}));
    const conflict = resourceConflict(context,vehicle.id,'VEICULO',schedule,false,'VEICULO',true);
    if (conflict) { const window = scheduleWindow(conflict,context); const error = new Error(`Veículo ${vehicle.placa} ainda está alocado até ${displayDateTime(window.end)} (${conflict.rota || conflict.sequencia || conflict.id}).`); error.code='VEHICLE_SCHEDULE_CONFLICT'; error.details={vehicleId:vehicle.id,conflictScheduleId:conflict.id,unavailableUntil:formatLocalDateTime(window.end)}; throw error; }
    const open = openMonitoring(context,vehicle.id,'VEICULO',schedule,'VEICULO');
    if (open) { const error = new Error(`Veículo ${vehicle.placa} consta em monitoramento aberto${open.window?.end ? ` até ${displayDateTime(open.window.end)}` : ''} (${open.schedule.rota || open.schedule.id}).`); error.code='OPEN_MONITORING'; throw error; }
  }

  for (const [employee,role] of [[driver,'MOTORISTA'],[helper1,secondDriverTeam?'MOTORISTA':'AJUDANTE'],[helper2,thirdDriverTeam?'MOTORISTA':'AJUDANTE']]) {
    if (!employee) continue;
    const label = role === 'MOTORISTA' ? 'Motorista' : 'Ajudante';
    const explicit = explicitAvailability(context,schedule.data,role,employee.id);
    const status = statusForDate(employee,schedule.data);
    if (status === TIME_OFF_STATUS && !timeOffUnchanged(existing,employee,role)) { const error = new Error(`${label} ${employee.nome} possui folga agendada em ${String(schedule.data||'').split('-').reverse().join('/')}${employee.folga_motivo?` (${employee.folga_motivo})`:''} e não pode ser escalado.`); error.code='EMPLOYEE_TIME_OFF'; throw error; }
    if (status === 'FÉRIAS' && !explicit && !timeOffUnchanged(existing,employee,role)) { const error = new Error(`${label} ${employee.nome} está de férias na data selecionada e não pode ser escalado.`); error.code='EMPLOYEE_VACATION'; throw error; }
    if (status === 'RESERVADO' && !explicit) { const error = new Error(`${label} ${employee.nome} está reservado para serviço administrativo.`); error.code='EMPLOYEE_RESERVED'; throw error; }
    if (['EM ROTA','PERNOITE','ATESTADO','AFASTADO','BLOQUEADO','DESLIGADO'].includes(status) && !explicit) warnings.push(warning('EMPLOYEE_STATUS',`${employee.nome} está com status ${status}.`,{employeeId:employee.id,status}));
    const routeHelper = role === 'AJUDANTE' && employee.ajudante_rota;
    const routeHelperSunday = routeHelper && isSundayDate(schedule.data);
    if(routeHelper&&!routeHelperSunday){
      const overnight=openMonitoring(context,employee.id,'COLABORADOR',schedule,role);
      if(overnight&&normalizeText(value(overnight.row,'STATUS_MONITORAMENTO','STATUS'))==='PERNOITE'){const error=new Error(`Ajudante ${employee.nome} está em PERNOITE e não está disponível para nova escala.`);error.code='EMPLOYEE_OVERNIGHT_UNAVAILABLE';throw error;}
    }
    const repeatedDriverPlanning = role === 'MOTORISTA' && allowsRepeatedDriverPlanning(schedule);
    if (!rosterAllows(employee,schedule.data)) warnings.push(warning('OUTSIDE_ROSTER_DAY',`${label} ${employee.nome}: ${displayDateTime(start).slice(0,10)} está fora da escala habitual (${rosterLabel(employee)}).`,{employeeId:employee.id,roster:employeeRoster(employee),date:schedule.data}));
    const seventh=seventhDayProjection(context,employee,schedule);
    if(seventh) warnings.push(warning('SEVENTH_DAY_IN_ROUTE',`${label} ${employee.nome}: pela duração padrão de ${schedule.duracao_dias} dia(s), a rota pode atingir o 7º dia consecutivo em ${seventh.seventhDate.split('-').reverse().join('/')}.`,{employeeId:employee.id,baseConsecutiveDays:seventh.base,routeDays:seventh.routeDays,seventhDay:seventh.seventhDate,projectedConsecutiveDays:seventh.projected}));
    if(role==='MOTORISTA'&&employee.restricao_motorista&&!schedule.carga_fechada&&!administrativeService){const error=new Error(`Motorista ${employee.nome} possui restrição e está disponível apenas para Carga Fechada.`);error.code='DRIVER_RESTRICTION_CLOSED_LOAD_ONLY';throw error;}

    // Domingo é permitido para qualquer colaborador na Escala. A data da programação
    // não representa, por si só, trabalho executado no domingo; a operação pode começar
    // na segunda-feira. O bloqueio continua sendo exclusivamente operacional.

    // Regra operacional simplificada: não existe mais bloqueio de 7º dia.
    // O que bloqueia a pessoa é somente estar alocada em outra escala que ainda
    // ocupa a mesma janela (sem retorno confirmado) ou permanecer em rota.
    const conflict = resourceConflict(context,employee.id,'COLABORADOR',schedule,routeHelper||repeatedDriverPlanning,role,true);
    if (conflict) {
      const window = scheduleWindow(conflict,context);
      const error = new Error(`${label} ${employee.nome} já está escalado em ${conflict.rota || conflict.sequencia || conflict.id} e ainda não foi liberado${window?.end ? ` (ocupação até ${displayDateTime(window.end)})` : ''}.`);
      error.code='RESOURCE_SCHEDULE_CONFLICT';
      error.details={employeeId:employee.id,conflictScheduleId:conflict.id,unavailableUntil:window?.end?formatLocalDateTime(window.end):''};
      throw error;
    }
    // Ajudante de rota não acompanha pernoite do veículo. Para os demais,
    // Monitoramento aberto sem Retorno confirmado continua sendo bloqueio real.
    const open = (routeHelper||repeatedDriverPlanning) ? null : openMonitoring(context,employee.id,'COLABORADOR',schedule,role);
    if (open) { const error = new Error(`${label} ${employee.nome} ainda está em rota sem retorno confirmado (${open.schedule.rota || open.schedule.id}).`); error.code='OPEN_MONITORING'; throw error; }

    // Interjornada continua somente informativa; nunca impede salvar a Escala.
    if (!explicit) {
      const previous = previousJourney(context,employee.id,start,schedule.id);
      if (previous) {
        const rest = Math.round((start - previous.end)/60000); const minimum = Number(setting(context.settings,'INTERJORNADA_MIN',660)) || 660;
        if (rest < minimum) warnings.push(warning('INTERJOURNEY_WARNING',`${label} ${employee.nome}: descanso disponível ${Math.floor(Math.max(0,rest)/60)}h${String(Math.max(0,rest)%60).padStart(2,'0')} (referência ${displayDateTime(previous.end)}), abaixo das ${Math.ceil(minimum/60)}h configuradas.`,{employeeId:employee.id,previousScheduleId:previous.schedule.id,previousEnd:formatLocalDateTime(previous.end),restMinutes:rest,minimumMinutes:minimum}));
      }
    }
  }

  const duplicate = context.schedules.filter((item)=>String(item.id) !== String(schedule.id || '') && item.data === schedule.data && clean(schedule.sequencia) !== '0' && clean(item.sequencia) && clean(item.sequencia) === clean(schedule.sequencia) && normalizeText(item.status) !== 'CANCELADO');
  if (duplicate.length) warnings.push(warning('DUPLICATE_SEQUENCE','Sequência repetida no dia.',{scheduleIds:duplicate.map((item)=>item.id)}));
  for (const helper of [helper1,helper2].filter(Boolean)) {
    if (!helper.ajudante_rota) continue;
    const sameLoad = context.schedules.find((item)=>String(item.id) !== String(schedule.id || '') && item.data === schedule.data && String(item.ocs) === String(schedule.ocs) && [item.ajudante_1_id,item.ajudante_2_id].map(String).includes(String(helper.id)) && normalizeText(item.status) !== 'CANCELADO');
    if (sameLoad) warnings.push(warning('DUPLICATE_HELPER_SAME_LOAD',`${helper.nome} já aparece na mesma carga.`,{conflictScheduleId:sameLoad.id}));
  }
  if (existing && lockedStatus(existing.status) && String(route.id) !== String(existing.rota_id || '')) {
    schedule.observacoes = [schedule.observacoes,`ALTERAÇÃO DE DESTINO: ${existing.rota || '—'} → ${route.rota || '—'} (${user.email || user.name || 'usuário'} em ${nowIso()})`].filter(Boolean).join(' | ');
  }
  schedule.avisos = warnings.map((item)=>item.message); schedule.aviso_detalhes = warnings;
  return schedule;
}

function legacyData(schedule,user) {
  return {
    ID:schedule.id, DATA:schedule.data, SEQUENCIA_CARREGAMENTO:schedule.sequencia, CARGA:schedule.ocs, QTD_ENTREGAS:schedule.qtd_entregas || 0,
    PESO_CARGA_TON:schedule.peso_t, TEMPERATURA_FRIO_C:schedule.temperatura_frio_c === '' ? null : schedule.temperatura_frio_c, HORA_SAIDA_PROGRAMADA:schedule.horario_ponto, ROTA_ID:schedule.rota_id, ROTA:schedule.rota, DESTINO:'', REGIAO:schedule.regiao,
    DURACAO_DIAS:schedule.duracao_dias, VEICULO_ID:schedule.veiculo_id, PLACA:schedule.placa, MOTORISTA_ID:schedule.motorista_id, MOTORISTA:schedule.motorista,
    AJUDANTE_1_ID:schedule.ajudante_1_id, AJUDANTE_1:schedule.ajudante_1, AJUDANTE_2_ID:schedule.ajudante_2_id, AJUDANTE_2:schedule.ajudante_2,
    TIPO_EQUIPE:schedule.tipo_equipe, CARGA_FECHADA:schedule.carga_fechada ? 1 : 0, PREVISAO_TERMINO:schedule.previsao_termino || '', PREVISAO_RETORNO:schedule.previsao_retorno || '',
    LIMITE_JORNADA:schedule.limite_jornada || '', STATUS:schedule.status, OBSERVACOES:schedule.observacoes || '', CRIADO_EM:schedule.criado_em || nowIso(), ATUALIZADO_EM:nowIso(), USUARIO:user.email || user.name || 'Sistema',
  };
}
function dmsData(schedule,user) {
  return {
    data:schedule.data, sequencia:schedule.sequencia, ocs:schedule.ocs, qtd_entregas:schedule.qtd_entregas || 0, peso_t:schedule.peso_t, peso_kg:schedule.peso_kg, temperatura_frio_c:schedule.temperatura_frio_c === '' ? null : schedule.temperatura_frio_c,
    horario_ponto:schedule.horario_ponto, rota_id:schedule.rota_id, rota:schedule.rota, destino:'', regiao:schedule.regiao, duracao_dias:schedule.duracao_dias,
    veiculo_id:schedule.veiculo_id, placa:schedule.placa, motorista_id:schedule.motorista_id, motorista:schedule.motorista, ajudante_1_id:schedule.ajudante_1_id,
    ajudante_1:schedule.ajudante_1, ajudante_2_id:schedule.ajudante_2_id, ajudante_2:schedule.ajudante_2, ajudantes:schedule.ajudantes, tipo_equipe:schedule.tipo_equipe,
    carga_fechada:schedule.carga_fechada, previsao_termino:schedule.previsao_termino || '', previsao_retorno:schedule.previsao_retorno || '', limite_jornada:schedule.limite_jornada || '',
    status:schedule.status, observacoes:schedule.observacoes || '', avisos:schedule.avisos || [], aviso_detalhes:schedule.aviso_detalhes || [], usuario:user.email || user.name || 'Sistema',
  };
}
async function writeDynamic(db,table,mode,record,keyColumn='ID') {
  const columns = await columnsFor(db,table);
  const entries = Object.entries(record).filter(([name])=>columns.has(name));
  if (!entries.length) throw new Error(`A tabela ${table} não possui as colunas esperadas.`);
  if (mode === 'insert') {
    const names = entries.map(([name])=>name);
    await db.prepare(`INSERT INTO ${quote(table)} (${names.map(quote).join(',')}) VALUES (${names.map(()=>'?').join(',')})`).bind(...entries.map(([,value])=>value)).run();
    return;
  }
  const names = entries.map(([name])=>name).filter((name)=>name !== keyColumn);
  const result = await db.prepare(`UPDATE ${quote(table)} SET ${names.map((name)=>`${quote(name)}=?`).join(',')} WHERE ${quote(keyColumn)}=?`).bind(...names.map((name)=>record[name]),record[keyColumn]).run();
  if (!Number(result.meta?.changes || 0)) throw new Error('Escala não encontrada para atualização.');
}
async function findSchedule(db,id,storage = '') {
  const wantedStorage=String(storage||'').trim().toUpperCase();
  // When the caller knows the storage, never fall through to the other table.
  // Legacy ESCALAS_DIA IDs are frequently numeric and can collide with the
  // autoincrement IDs from ROUTE_RECORDS. Falling through was the main cause of
  // returns reporting "Escala vinculada não encontrada" or resolving the wrong
  // schedule after migration.
  if (wantedStorage === 'ESCALAS_DIA') {
    if (await tableExists(db,'ESCALAS_DIA')) {
      const row = await db.prepare(`SELECT * FROM ${quote('ESCALAS_DIA')} WHERE ${quote('ID')}=? LIMIT 1`).bind(String(id)).first();
      if (row) return scheduleFromLegacy(row);
    }
    return null;
  }
  if (wantedStorage === 'ROUTE_RECORDS') {
    if (/^\d+$/.test(String(id || ''))) {
      const row = await db.prepare("SELECT * FROM ROUTE_RECORDS WHERE ID=? AND MODULE='schedule'").bind(Number(id)).first();
      if (row) return scheduleFromDms(row);
    }
    return null;
  }
  // Backward-compatible default used by the schedule editor: non-numeric IDs
  // are legacy; numeric IDs remain DMS IDs unless the operational resolver asks
  // both stores explicitly.
  if (typeof id === 'string' && !/^\d+$/.test(id)) {
    if (await tableExists(db,'ESCALAS_DIA')) {
      const row = await db.prepare(`SELECT * FROM ${quote('ESCALAS_DIA')} WHERE ${quote('ID')}=? LIMIT 1`).bind(String(id)).first();
      if (row) return scheduleFromLegacy(row);
    }
  }
  if (/^\d+$/.test(String(id || ''))) {
    const row = await db.prepare("SELECT * FROM ROUTE_RECORDS WHERE ID=? AND MODULE='schedule'").bind(Number(id)).first();
    if (row) return scheduleFromDms(row);
  }
  return null;
}

async function findScheduleInAnyStorage(db,id,preferredStorage = '') {
  const preferred=String(preferredStorage||'').trim().toUpperCase();
  const found=[];
  const add=(item)=>{ if(item&&!found.some((x)=>String(x.id)===String(item.id)&&String(x.storage)===String(item.storage))) found.push(item); };
  if(preferred) add(await findSchedule(db,id,preferred));
  if(preferred!=='ESCALAS_DIA' && await tableExists(db,'ESCALAS_DIA')) {
    const row=await db.prepare(`SELECT * FROM ${quote('ESCALAS_DIA')} WHERE ${quote('ID')}=? LIMIT 1`).bind(String(id)).first();
    if(row)add(scheduleFromLegacy(row));
  }
  if(preferred!=='ROUTE_RECORDS' && /^\d+$/.test(String(id||''))) {
    const row=await db.prepare("SELECT * FROM ROUTE_RECORDS WHERE ID=? AND MODULE='schedule' LIMIT 1").bind(Number(id)).first();
    if(row)add(scheduleFromDms(row));
  }
  return found.length===1?found[0]:null;
}
function scheduleIdentityScore(item,identity={}) {
  const data=dateIso(identity.data||identity.DATA||'');
  if(data && item.data!==data)return -1;
  let score=0;
  const sequence=clean(identity.sequencia??identity.SEQUENCIA_CARREGAMENTO);
  const plate=plateKey(identity.placa??identity.PLACA);
  const ocs=normalizeLoadOrders(identity.ocs??identity.CARGA);
  const route=normalizeText(identity.rota??identity.ROTA);
  const vehicleId=clean(identity.veiculo_id??identity.VEICULO_ID);
  if(sequence&&sequence!=='0'){ if(clean(item.sequencia)!==sequence)return -1; score+=4; }
  if(plate){ if(plateKey(item.placa)!==plate)return -1; score+=4; }
  if(vehicleId){ if(String(item.veiculo_id||'')!==String(vehicleId))return -1; score+=4; }
  if(ocs){ if(normalizeLoadOrders(item.ocs)!==ocs)return -1; score+=2; }
  if(route){ if(normalizeText(item.rota)!==route)return -1; score+=1; }
  return score;
}
async function resolveScheduleForMutation(db,id,storage='',identity={}) {
  const direct=await findSchedule(db,id,storage);
  if(direct)return direct;
  const byId=await findScheduleInAnyStorage(db,id,storage);
  if(byId)return byId;
  const data=dateIso(identity?.data||identity?.DATA||'');
  if(!data)return null;
  const candidates=(await loadSchedules(db,{date:data}))
    .map((item)=>({item,score:scheduleIdentityScore(item,identity)}))
    .filter((x)=>x.score>=6)
    .sort((a,b)=>b.score-a.score || String(b.item.atualizado_em||'').localeCompare(String(a.item.atualizado_em||'')));
  if(!candidates.length)return null;
  const bestScore=candidates[0].score;
  const best=candidates.filter((x)=>x.score===bestScore);
  if(best.length!==1)return null;
  return best[0].item;
}

function scheduleClientId(payload={}) {
  const raw=clean(payload.client_id ?? payload.CLIENT_ID,80).toUpperCase();
  return /^ESC-C-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(raw) ? raw : '';
}

// Motorista diferente do plano de alocação: guarda a justificativa informada na Escala (aparece no
// Plano de Alocação). Se a escala voltou a seguir o plano, a justificativa antiga é removida.
async function syncAllocationDeviation(db,user,schedule,context,justification=''){
  if(!schedule?.id||normalizeText(schedule.status)==='CANCELADO')return;
  if(excludedFromAllocationPlan(schedule,context)){await deleteDeviation(db,schedule.id);return;}
  if(!context.allocationPlans)context.allocationPlans=await readAllocationPlansForDate(db,schedule.data);
  const vehicle=context.vehicleById?.get(String(schedule.veiculo_id||''))||context.vehicleByPlate?.get(plateKey(schedule.placa))||null;
  const plan=schedule.placa||vehicle?allocationPlanForVehicle(context,schedule.data,vehicle,schedule.placa):null;
  const driver=findEmployee(schedule.motorista_id,schedule.motorista,context);
  const planned=plan?allocationPlanDriverEntries(plan,context,null):[];
  const vacationTriggered=plan?allocationPlanVacationTriggered(plan,context,schedule.data):false;
  const deviates=Boolean(plan&&driver&&planned.length&&!vacationTriggered&&!planned.some((entry)=>String(entry.item?.id||'')===String(driver.id||'')));
  if(!deviates){await deleteDeviation(db,schedule.id);return;}
  const text=String(justification||'').trim();if(!text)return;
  await upsertDeviation(db,{scheduleId:schedule.id,date:schedule.data,plate:schedule.placa,route:schedule.rota,driverId:driver.id,driver:driver.nome,plannedDriver:planned.find((e)=>e.kind==='PRINCIPAL')?.item?.nome||'',plannedSubstitute:planned.find((e)=>e.kind==='SUBSTITUTO')?.item?.nome||'',justification:text,user:user?.name||user?.email||''});
}
async function saveOne(db,payload,user,context,options={}) {
  const id = payload.id ?? payload.ID;
  const storage = payload.storage || '';
  const clientId=scheduleClientId(payload);
  let existing = id ? await findSchedule(db,id,storage) : null;
  // v1.0.5: linhas novas recebem um ID estável gerado no navegador. Se o POST
  // chegou ao D1 mas a resposta se perdeu, o retry encontra a mesma linha em vez
  // de criar uma segunda escala.
  if (!existing && !id && clientId) existing=await findSchedule(db,clientId,'ESCALAS_DIA');
  const schedule = await validateSchedule(db,payload,existing,user,context,options);
  const before = existing ? { ...existing } : null;
  if (existing) schedule.id = existing.id;
  else schedule.id = clientId || generateId('ESC');
  schedule.criado_em = existing?.criado_em || nowIso(); schedule.atualizado_em = nowIso(); schedule.usuario = user.email || user.name || 'Sistema';

  if ((existing?.storage === 'ESCALAS_DIA' || (!existing && await tableExists(db,'ESCALAS_DIA')))) {
    schedule.storage='ESCALAS_DIA'; schedule.sourceTable='ESCALAS_DIA'; schedule.sourceKey=String(schedule.id); schedule.legacy=true;
    await writeDynamic(db,'ESCALAS_DIA',existing ? 'update' : 'insert',legacyData(schedule,user));
  } else {
    const data = dmsData(schedule,user);
    if (existing) {
      await db.prepare(`UPDATE ROUTE_RECORDS SET TITLE=?,STATUS=?,DATE_KEY=?,DATA_JSON=?,UPDATED_BY=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=? AND MODULE='schedule'`)
        .bind(inferTitle(data,'schedule'),inferStatus(data),inferDate(data),JSON.stringify(data),user.id || null,Number(existing.id)).run();
      schedule.id=Number(existing.id); schedule.storage='ROUTE_RECORDS';
    } else {
      const result = await db.prepare(`INSERT INTO ROUTE_RECORDS (MODULE,TITLE,STATUS,DATE_KEY,DATA_JSON,CREATED_BY,UPDATED_BY) VALUES ('schedule',?,?,?,?,?,?)`)
        .bind(inferTitle(data,'schedule'),inferStatus(data),inferDate(data),JSON.stringify(data),user.id || null,user.id || null).run();
      schedule.id=Number(result.meta?.last_row_id); schedule.storage='ROUTE_RECORDS'; schedule.legacy=false;
    }
  }
  await audit(db,user,existing ? 'EDITAR' : 'CRIAR','schedule',Number(schedule.id) || null,{ before,after:schedule })
    .catch((error)=>console.error('Schedule audit warning',error));
  // Motivo da carona (segundo motorista): só existe com equipe COM 2º MOTORISTA; vazio remove.
  const withCarona = ['DOIS_MOTORISTAS','TRES_MOTORISTAS'].includes(schedule.tipo_equipe);
  if (payload.carona_motivo !== undefined || !withCarona) await saveCaronaReason(db,{scheduleId:schedule.id,date:schedule.data,reason:withCarona?payload.carona_motivo:'',user:user?.name||user?.email||''}).catch((error)=>console.error('Carona reason warning',error));
  await syncAllocationDeviation(db,user,schedule,context,payload.justificativa_plano).catch((error)=>console.error('Allocation deviation warning',error));
  if (normalizeText(schedule.status) !== 'CANCELADO' && schedule.placa && schedule.motorista) {
    await updateVehicleLastDriver(db,{
      placa:schedule.placa, vehicleId:schedule.veiculo_id, motoristaId:schedule.motorista_id, motoristaNome:schedule.motorista,
      scheduleId:schedule.id, effectiveAt:schedule.atualizado_em || nowIso(),
    }).catch((error)=>console.error('Vehicle last-driver warning',error));
  }
  return schedule;
}


function scheduleResourceCorrectionSnapshot(source={}) {
  return {
    veiculo_id:clean(source.veiculo_id,120),placa:clean(source.placa,30).toUpperCase(),
    motorista_id:clean(source.motorista_id,120),motorista:clean(source.motorista,180),
    ajudante_1_id:clean(source.ajudante_1_id,120),ajudante_1:clean(source.ajudante_1,180),
    ajudante_2_id:clean(source.ajudante_2_id,120),ajudante_2:clean(source.ajudante_2,180),
    tipo_equipe:normalizeText(source.tipo_equipe||'UM_AJUDANTE'),
  };
}
function scheduleResourceCorrectionChanges(before={},after={}) {
  const fields=[
    ['placa','VEÍCULO'],['motorista','MOTORISTA'],['ajudante_1','AJUDANTE 1'],['ajudante_2','AJUDANTE 2'],['tipo_equipe','TIPO DE EQUIPE'],
  ];
  return fields.filter(([key])=>normalizeText(before[key])!==normalizeText(after[key])).map(([key,label])=>({campo:label,anterior:before[key]||'',novo:after[key]||''}));
}
function scheduleResourceCorrectionRefs(source={}) {
  const rows=[
    {type:'VEICULO',role:'VEÍCULO',id:clean(source.veiculo_id,120),name:clean(source.placa,30).toUpperCase()},
    {type:'MOTORISTA',role:'MOTORISTA',id:clean(source.motorista_id,120),name:clean(source.motorista,180)},
    {type:'AJUDANTE',role:'AJUDANTE 1',id:clean(source.ajudante_1_id,120),name:clean(source.ajudante_1,180)},
    {type:'AJUDANTE',role:'AJUDANTE 2',id:clean(source.ajudante_2_id,120),name:clean(source.ajudante_2,180)},
  ];
  return rows.filter((item)=>item.name).map((item)=>({...item,_key:`${item.type}|${item.id||normalizeText(item.name)}`}));
}
async function syncOperationalResourcesAfterAdminCorrection(db,user,before,after,reason,changes) {
  const actor=user.email||user.name||'Administrador';
  const correctedAt=nowIso();
  const scheduleIds=[String(before.id||''),String(before.sourceKey||'')].filter(Boolean).filter((value,index,array)=>array.indexOf(value)===index);
  const crew=scheduleResourceCorrectionSnapshot(after);
  crew.ajudantes=[crew.ajudante_1,crew.ajudante_2].filter(Boolean).join(' / ');
  const correction={tipo:'CORREÇÃO ADM PÓS-SAÍDA',motivo:clean(reason,1000),autor:actor,data_hora:correctedAt,alteracoes:changes};
  let departureActualAt='';
  let departureId=null;
  for(const table of ['ROUTE_DEPARTURES','ROUTE_MONITORING','ROUTE_RETURNS']){
    if(!(await tableExists(db,table)))continue;
    const columns=await columnsFor(db,table);
    if(!columns.has('SCHEDULE_ID')||!columns.has('DATA_JSON')||!columns.has('ID'))continue;
    for(const scheduleId of scheduleIds){
      const rows=await db.prepare(`SELECT * FROM ${quote(table)} WHERE ${quote('SCHEDULE_ID')}=?`).bind(scheduleId).all();
      for(const row of rows.results||[]){
        const data=parseData(row.DATA_JSON)||{};
        const nextData={...data,...crew,correcoes_administrativas:[...(Array.isArray(data.correcoes_administrativas)?data.correcoes_administrativas:[]),correction].slice(-50),ultima_correcao_adm:correction};
        if(table==='ROUTE_DEPARTURES'){
          departureActualAt=departureActualAt||clean(row.ACTUAL_AT||data.saida_real||data.actual_at||'',80);
          departureId=departureId||Number(row.ID)||null;
          const historic=Array.isArray(data.trocas_recursos)?data.trocas_recursos:[];
          const swapRows=changes.filter((item)=>item.campo!=='TIPO DE EQUIPE').map((item)=>({campo:item.campo,anterior:item.anterior,novo:item.novo,tipo:item.anterior?(item.novo?'CORREÇÃO':'REMOÇÃO'):'ALOCAÇÃO',justificativa:clean(reason,1000),autor:actor,data_hora:correctedAt,origem:'CORREÇÃO ADM PÓS-SAÍDA'}));
          nextData.trocas_recursos=[...historic,...swapRows].slice(-100);
          nextData.justificativa_troca=clean(reason,1000);
        }
        const sets=[];const binds=[];
        if(columns.has('PLATE')){sets.push(`${quote('PLATE')}=?`);binds.push(crew.placa);}
        if(columns.has('DRIVER_ID')){sets.push(`${quote('DRIVER_ID')}=?`);binds.push(crew.motorista_id);}
        if(columns.has('DRIVER_NAME')){sets.push(`${quote('DRIVER_NAME')}=?`);binds.push(crew.motorista);}
        sets.push(`${quote('DATA_JSON')}=?`);binds.push(JSON.stringify(nextData));
        if(columns.has('UPDATED_BY')){sets.push(`${quote('UPDATED_BY')}=?`);binds.push(Number(user?.id||0)||null);}
        if(columns.has('UPDATED_AT'))sets.push(`${quote('UPDATED_AT')}=CURRENT_TIMESTAMP`);
        binds.push(row.ID);
        await db.prepare(`UPDATE ${quote(table)} SET ${sets.join(',')} WHERE ${quote('ID')}=?`).bind(...binds).run();
      }
    }
  }
  if(after.placa&&after.motorista){
    await updateVehicleLastDriver(db,{placa:after.placa,vehicleId:after.veiculo_id,motoristaId:after.motorista_id,motoristaNome:after.motorista,scheduleId:after.id,effectiveAt:departureActualAt||correctedAt})
      .catch((error)=>console.error('Vehicle last-driver admin correction warning',error));
  }
  const active=['EM ROTA','PERNOITE'].includes(normalizeText(after.status));
  if(active){
    const beforeRefs=scheduleResourceCorrectionRefs(before),afterRefs=scheduleResourceCorrectionRefs(after);
    const afterKeys=new Set(afterRefs.map((item)=>item._key)),beforeKeys=new Set(beforeRefs.map((item)=>item._key));
    const removed=beforeRefs.filter((item)=>!afterKeys.has(item._key)).map(({_key,...item})=>item);
    const added=afterRefs.filter((item)=>!beforeKeys.has(item._key)).map(({_key,...item})=>item);
    if(removed.length)await recordResourceEvents(db,{refs:removed,status:'DISPONÍVEL',effectiveAt:correctedAt,source:'CORRECAO_ADM_POS_SAIDA',sourceModule:'schedule',sourceRecordId:Number(after.id)||null,scheduleRecordId:Number(after.id)||null,details:{motivo:clean(reason,1000),correcao:true},user}).catch(()=>{});
    if(added.length)await recordResourceEvents(db,{refs:added,status:normalizeText(after.status)==='PERNOITE'?'PERNOITE':'EM ROTA',effectiveAt:correctedAt,source:'CORRECAO_ADM_POS_SAIDA',sourceModule:'schedule',sourceRecordId:Number(after.id)||null,scheduleRecordId:Number(after.id)||null,details:{motivo:clean(reason,1000),correcao:true},user}).catch(()=>{});
  }
  return {departureId,departureActualAt,correctedAt};
}

export async function adminCorrectScheduleResources(db,user,payload={}) {
  assertScheduleAccess(user,true);await ensureScheduleSchema(db);
  if(normalizeText(user?.role)!=='ADMIN'){const error=new Error('Somente administradores podem corrigir a equipe/veículo após a saída.');error.code='ADMIN_ONLY';throw error;}
  const reason=clean(payload.justificativa||payload.reason,1000);
  if(!reason)throw new Error('Informe a justificativa da correção pós-saída.');
  const id=payload.id??payload.ID;const storage=payload.storage||'';const identity=payload.identity||{};
  const beforeLock=await resolveScheduleForMutation(db,id,storage,identity);
  if(!beforeLock)throw new Error('Escala não encontrada. Atualize a tela e tente novamente.');
  const desired={...beforeLock,
    veiculo_id:payload.veiculo_id!==undefined?payload.veiculo_id:beforeLock.veiculo_id,
    placa:payload.placa!==undefined?payload.placa:beforeLock.placa,
    motorista_id:payload.motorista_id!==undefined?payload.motorista_id:beforeLock.motorista_id,
    motorista:payload.motorista!==undefined?payload.motorista:beforeLock.motorista,
    ajudante_1_id:payload.ajudante_1_id!==undefined?payload.ajudante_1_id:beforeLock.ajudante_1_id,
    ajudante_1:payload.ajudante_1!==undefined?payload.ajudante_1:beforeLock.ajudante_1,
    ajudante_2_id:payload.ajudante_2_id!==undefined?payload.ajudante_2_id:beforeLock.ajudante_2_id,
    ajudante_2:payload.ajudante_2!==undefined?payload.ajudante_2:beforeLock.ajudante_2,
    tipo_equipe:payload.tipo_equipe!==undefined?payload.tipo_equipe:beforeLock.tipo_equipe,
  };
  return withScheduleLocks(db,[beforeLock,desired],beforeLock.data,async()=>{
    const existing=await resolveScheduleForMutation(db,beforeLock.id,beforeLock.storage,beforeLock);
    if(!existing)throw new Error('Escala não encontrada após a reconciliação. Atualize a tela e tente novamente.');
    if(!['EM ROTA','PERNOITE','RETORNOU','FINALIZADO'].includes(normalizeText(existing.status))){const error=new Error('A correção administrativa pós-saída só está disponível para viagens que já iniciaram.');error.code='SCHEDULE_NOT_STARTED';throw error;}
    const crew=await resolveOperationalCrewChange(db,user,existing,{...desired,status:existing.status},existing,{administrativeCorrection:true});
    const before=scheduleResourceCorrectionSnapshot(existing);
    const afterSnapshot=scheduleResourceCorrectionSnapshot({...existing,...crew});
    const changes=scheduleResourceCorrectionChanges(before,afterSnapshot);
    if(!changes.length)throw new Error('Nenhuma alteração de veículo/equipe foi informada.');
    const correctionAt=nowIso();const actor=user.email||user.name||'Administrador';
    const note=`CORREÇÃO ADM PÓS-SAÍDA (${actor} em ${correctionAt}): ${changes.map((item)=>`${item.campo} ${item.anterior||'—'} → ${item.novo||'—'}`).join('; ')}. Motivo: ${reason}`;
    const next={...existing,...crew,carga_fechada:crew.tipo_equipe==='CARGA_FECHADA',ajudantes:[crew.ajudante_1,crew.ajudante_2].filter(Boolean).join(' / '),observacoes:[existing.observacoes,note].filter(Boolean).join(' | '),atualizado_em:correctionAt,usuario:actor};
    if(existing.storage==='ESCALAS_DIA'){
      await writeDynamic(db,'ESCALAS_DIA','update',legacyData(next,user));
    }else{
      const data=dmsData(next,user);
      await db.prepare(`UPDATE ROUTE_RECORDS SET TITLE=?,STATUS=?,DATE_KEY=?,DATA_JSON=?,UPDATED_BY=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=? AND MODULE='schedule'`)
        .bind(inferTitle(data,'schedule'),inferStatus(data),inferDate(data),JSON.stringify(data),Number(user?.id||0)||null,Number(existing.id)).run();
    }
    const operational=await syncOperationalResourcesAfterAdminCorrection(db,user,existing,next,reason,changes);
    await audit(db,user,'CORRIGIR_EQUIPE_POS_SAIDA','schedule',Number(next.id)||null,{before,after:afterSnapshot,changes,reason,operational,status:next.status});
    return {...next,correcao_adm:{changes,reason,actor,at:correctionAt,operational}};
  });
}

export async function getScheduleEditor(db,user,date) {
  assertScheduleAccess(user,false); await ensureScheduleSchema(db);
  const selected = dateIso(date) || new Date().toISOString().slice(0,10);

  // v1.0.4: abrir a tela de Escala não precisa carregar Monitoramento, Retornos,
  // Reservas, Status Diário nem 90 dias de histórico. Esses dados só são usados
  // na validação de SALVAMENTO. A leitura do editor passa a buscar apenas o dia
  // selecionado + catálogos, reduzindo bastante a chance de HTTP 503 em pico.
  const context=await loadOperationalContext(db,selected);
  const [allocationPlans,allocationFloatDrivers]=await Promise.all([readAllocationPlansForDate(db,selected),readAllocationFloatDriversForDate(db,selected)]);
  context.allocationPlans=allocationPlans;context.allocationFloatDrivers=allocationFloatDrivers;
  const deviations=await readDeviations(db,{start:selected,end:selected});
  const caronaReasons=await readCaronaReasons(db,{start:selected,end:selected});
  const schedules = context.schedules
    .filter((item)=>item.data === selected && normalizeText(item.status) !== 'CANCELADO')
    .map((item)=>({...item,observacoes:applyScheduleAutomaticObservations(item.observacoes,item),justificativa_plano:deviations.get(String(item.id))?.justification||'',justificativa_plano_motorista_id:deviations.get(String(item.id))?.driverId||'',carona_motivo:caronaReasons.get(String(item.id))||''}))
    .sort(sortSchedules);
  const counts = { total:schedules.length, duplicadas:schedules.filter((item)=>schedules.some((other)=>String(other.id)!==String(item.id) && clean(item.sequencia)!=='0' && clean(other.sequencia) && clean(other.sequencia)===clean(item.sequencia))).length };
  return {
    versao:VERSION,date:selected,schedules,
    vehicles:decoratePlanningResources(context.vehicles,schedules,'VEICULO',context,selected),
    drivers:withWorkSignals(decoratePlanningResources(context.drivers,schedules,'MOTORISTA',context,selected),context),
    helpers:withWorkSignals(decoratePlanningResources(context.helpers,schedules,'AJUDANTE',context,selected),context),
    routes:context.routes,allocationPlans,allocationFloatDrivers,bitruckPlates:[...(context.carreteiros?.bitruckPlates||[])],counts,defaults:{departureTime:defaultDepartureTime(selected,context.settings),teamType:'UM_AJUDANTE',status:'PROGRAMADO'},
  };
}
async function listScheduleRecordsCore(db,filters = {}) {
  await ensureScheduleSchema(db);
  const records = await loadSchedules(db,filters);
  return { versao:VERSION,total:records.length,records };
}
export async function listScheduleRecords(db,user,filters = {}) {
  assertScheduleAccess(user,false);
  return listScheduleRecordsCore(db,filters);
}
// Leitura interna para módulos da própria base Rota. A autorização da tela chamadora
// continua sendo feita no endpoint específico; isso evita exigir route.schedule
// apenas para calcular Dashboard, Indicadores, Saídas, Monitoramento ou Retornos.
export async function listScheduleRecordsInternal(db,filters = {}) {
  return listScheduleRecordsCore(db,filters);
}
// Internal direct lookup used by operational modules. This bypasses broad schedule
// scans and is especially important for historical/legacy schedule IDs.
export async function findScheduleRecordInternal(db,id,storage='') {
  await ensureScheduleSchema(db);
  if (id === null || id === undefined || String(id).trim() === '') return null;
  return findSchedule(db,String(id).trim(),storage||'');
}
export async function saveScheduleInternal(db,user,payload,{alreadyLocked=false}={}) {
  // Escrita interna usada por fluxos operacionais que já validaram a permissão da
  // própria tela (ex.: TRANSFERIR no Controle de Saída). Não exige route.schedule,
  // mas preserva validações e auditoria da Escala. Quando o chamador já detém a
  // trava granular dos mesmos recursos, evita tentar adquirir a mesma trava outra
  // vez com outro owner (o que geraria RESOURCE_LOCKED contra a própria operação).
  await ensureScheduleSchema(db);
  const lockDate = dateIso(payload.data) || new Date().toISOString().slice(0,10);
  const persist=async()=>{
    const context = await loadOperationalContext(db,lockDate,{writeFast:true});
    return saveOne(db,payload,user,context);
  };
  if(alreadyLocked)return persist();
  const existingForLock = (payload.id ?? payload.ID) ? await findSchedule(db,payload.id ?? payload.ID,payload.storage || '') : null;
  return withScheduleLocks(db,[payload,existingForLock].filter(Boolean),lockDate,persist);
}
export async function saveSchedule(db,user,payload) {
  assertScheduleAccess(user,true);
  return saveScheduleInternal(db,user,payload);
}
export async function saveScheduleBatch(db,user,payloads,requestId = '') {
  assertScheduleAccess(user,true); await ensureScheduleSchema(db);
  if (!Array.isArray(payloads) || !payloads.length) throw new Error('Nenhuma linha para salvar.');
  const safeRequestId = clean(requestId,180);
  if (safeRequestId) {
    const prior = await db.prepare('SELECT RESPONSE_JSON FROM ROUTE_SCHEDULE_REQUESTS WHERE REQUEST_ID=?').bind(safeRequestId).first();
    if (prior?.RESPONSE_JSON) return JSON.parse(prior.RESPONSE_JSON);
  }
  const firstDate = dateIso(payloads[0]?.data) || new Date().toISOString().slice(0,10);
  if (payloads.some((item)=>dateIso(item?.data) && dateIso(item.data)!==firstDate)) throw new Error('O salvamento em massa deve conter uma única data de escala.');

  // v1.0.11: uma linha inválida/ocupada nunca mais derruba o lote inteiro.
  // O contexto é carregado uma vez, mas cada linha adquire somente os locks dos
  // próprios recursos. Assim uma falha vira erro da linha e as demais continuam.
  const context = await loadOperationalContext(db,firstDate,{writeFast:true});
  const saved = []; const successes = []; const errors = [];
  for (let index=0; index<payloads.length; index+=1) {
    const payload = payloads[index];
    try {
      const existingForLock = (payload?.id ?? payload?.ID) ? await findSchedule(db,payload.id ?? payload.ID,payload.storage || '') : null;
      const record = await withScheduleLocks(db,[payload,existingForLock].filter(Boolean),firstDate,async()=>saveOne(db,payload,user,context));
      saved.push(record);
      successes.push({ index, record });
      const currentIndex = context.schedules.findIndex((item)=>String(item.id)===String(record.id));
      if (currentIndex >= 0) context.schedules[currentIndex]=record; else context.schedules.push(record);
    } catch (error) {
      errors.push({ index, id:payload?.id || '', code:error?.code || 'SCHEDULE_ERROR', message:error?.message || String(error), details:error?.details || null });
    }
  }
  const response = { versao:VERSION,committed:true,records:saved,successes,total:saved.length,errors,failed:errors.length,requested:payloads.length };
  if (safeRequestId) await db.prepare('INSERT OR REPLACE INTO ROUTE_SCHEDULE_REQUESTS (REQUEST_ID,RESPONSE_JSON) VALUES (?,?)').bind(safeRequestId,JSON.stringify(response)).run()
    .catch((error)=>console.error('Schedule request-id warning',error));
  return response;
}
export async function cancelSchedule(db,user,id,storage,reason,identity={}) {
  assertScheduleAccess(user,true); await ensureScheduleSchema(db);
  if (!clean(reason)) throw new Error('Informe o motivo do cancelamento.');
  const beforeLock = await resolveScheduleForMutation(db,id,storage,identity);
  if (!beforeLock) throw new Error('Escala não encontrada. Atualize a tela e tente novamente.');
  return withScheduleLocks(db,[beforeLock],beforeLock.data,async()=>{
    const existing = await resolveScheduleForMutation(db,beforeLock.id,beforeLock.storage,beforeLock);
    if (!existing) throw new Error('Escala não encontrada após a reconciliação. Atualize a tela e tente novamente.');
    if (['EM ROTA','RETORNOU','FINALIZADO'].includes(normalizeText(existing.status))) throw new Error('Esta escala não pode ser cancelada no status atual.');
    const payload = { ...existing,status:'CANCELADO',observacoes:[existing.observacoes,`CANCELAMENTO: ${clean(reason,1000)}`].filter(Boolean).join(' | ') };
    const context = await loadOperationalContext(db,existing.data);
    const saved = await saveOne(db,payload,user,context);
    await audit(db,user,'CANCELAR','schedule',Number(saved.id) || null,{ reason,before:existing,after:saved });
    return saved;
  });
}
export async function deleteSchedule(db,user,id,storage,confirmation,identity={}) {
  assertScheduleAccess(user,true); await ensureScheduleSchema(db);
  if (normalizeText(user?.role) !== 'ADMIN') throw new Error('Somente administradores podem excluir uma escala definitivamente.');
  if (normalizeText(confirmation) !== 'EXCLUIR') throw new Error('Digite EXCLUIR para confirmar a exclusão definitiva.');
  const beforeLock = await resolveScheduleForMutation(db,id,storage,identity);
  if (!beforeLock) throw new Error('Escala não encontrada. Atualize a tela e tente novamente.');
  return withScheduleLocks(db,[beforeLock],beforeLock.data,async()=>{
    const existing = await resolveScheduleForMutation(db,beforeLock.id,beforeLock.storage,beforeLock);
    if (!existing) throw new Error('Escala não encontrada após a reconciliação. Atualize a tela e tente novamente.');
    const sourceId = String(existing.id);
    const related = {};
    for (const [table,column] of [['CONTROLE_SAIDAS','ESCALA_ID'],['MONITORAMENTO_DIA','ESCALA_ID'],['RETORNOS','ESCALA_ID'],['DISPONIBILIDADE_RECURSOS','ESCALA_ORIGEM_ID']]) {
      if (!(await tableExists(db,table)) || !(await columnsFor(db,table)).has(column)) { related[table]=0; continue; }
      const result = await db.prepare(`DELETE FROM ${quote(table)} WHERE ${quote(column)}=?`).bind(sourceId).run(); related[table]=Number(result.meta?.changes || 0);
    }
    if (existing.storage === 'ESCALAS_DIA') await db.prepare(`DELETE FROM ${quote('ESCALAS_DIA')} WHERE ${quote('ID')}=?`).bind(sourceId).run();
    else await db.prepare("DELETE FROM ROUTE_RECORDS WHERE ID=? AND MODULE='schedule'").bind(Number(existing.id)).run();
    for (const module of ['departures','monitoring','returns']) {
      const rows = await db.prepare('SELECT ID,DATA_JSON FROM ROUTE_RECORDS WHERE MODULE=?').bind(module).all();
      for (const row of rows.results || []) {
        const data = parseData(row.DATA_JSON); const linked = [data.escala_id,data.schedule_record_id,data.escala_id_legado].filter(Boolean).map(String);
        if (linked.includes(sourceId)) await db.prepare('DELETE FROM ROUTE_RECORDS WHERE ID=?').bind(row.ID).run();
      }
    }
    for (const table of ['ROUTE_DEPARTURES','ROUTE_MONITORING','ROUTE_RETURNS']) {
      try {
        const result = await db.prepare(`DELETE FROM ${table} WHERE SCHEDULE_ID=?`).bind(sourceId).run();
        related[table] = Number(result.meta?.changes || 0);
      } catch { related[table] = 0; }
    }
    await recordResourceEvents(db,{ data:{ ...existing,status:'DISPONÍVEL' },status:'DISPONÍVEL',effectiveAt:nowIso(),source:'EXCLUSAO_ESCALA',sourceModule:'schedule',sourceRecordId:Number(existing.id) || null,scheduleRecordId:Number(existing.id) || null,user }).catch(()=>{});
    await audit(db,user,'EXCLUIR_DEFINITIVO','schedule',Number(existing.id) || null,{ before:existing,related });
    return { id:existing.id,deletedRelated:Object.values(related).reduce((sum,item)=>sum+item,0),related };
  });
}

const IMPORT_ALIASES = {
  SEQUENCIA_CARREGAMENTO:['SEQ','SEQUENCIA','SEQUÊNCIA','ORDEM','ORDEM DE CARREGAMENTO'],
  CARGA:['OC','OCS','OC(S)','CARGA','ORDEM DE CARGA'], PLACA:['PLACA','VEICULO','VEÍCULO'], ROTA:['ROTA'],
  QTD_ENTREGAS:['ENTREGAS','QTD ENTREGA','QTD ENTREGAS','QTD. ENTREGA','QTD. ENTREGAS','QUANTIDADE DE ENTREGA','QUANTIDADE DE ENTREGAS'],
  PESO_CARGA_TON:['PESO','PESO KG','PESO (KG)','PESO CARGA','PESO CARGA KG','PESO TON','PESO CARGA TON'],
  TEMPERATURA_FRIO_C:['TEMPERATURA','TEMPERATURA FRIO','TEMPERATURA DO FRIO','TEMP FRIO','FRIO','FRIO C','FRIO °C','TEMPERATURA °C'],
};
function identifyHeader(header) {
  const key = normalizeText(header);
  return Object.keys(IMPORT_ALIASES).find((field)=>IMPORT_ALIASES[field].map(normalizeText).includes(key)) || null;
}
function parseTabularText(input) {
  const lines = String(input || '').replace(/\r/g,'').split('\n').filter((line)=>line.trim());
  if (!lines.length) throw new Error('Cole ao menos uma linha da planilha.');
  const delimiter = lines.some((line)=>line.includes('\t')) ? '\t' : lines[0].includes(';') ? ';' : ',';
  const firstCells = lines[0].split(delimiter);
  const identified = firstCells.map(identifyHeader);
  const recognized = identified.filter(Boolean).length;
  const hasHeader = recognized >= 3 && identified.includes('ROTA') && (identified.includes('SEQUENCIA_CARREGAMENTO') || identified.includes('CARGA'));
  let fields = identified;
  let dataLines = lines.slice(1);
  let sourceOffset = 2;
  if (hasHeader) {
    for (const required of ['SEQUENCIA_CARREGAMENTO','CARGA','ROTA','PESO_CARGA_TON']) if (!fields.includes(required)) throw new Error(`Cabeçalho obrigatório ausente: ${required}.`);
  } else {
    fields = ['SEQUENCIA_CARREGAMENTO','CARGA','PLACA','ROTA','PESO_CARGA_TON','QTD_ENTREGAS'];
    dataLines = lines;
    sourceOffset = 1;
  }
  return dataLines.map((line,index)=>{
    const cells = line.split(delimiter); const row={ __sourceRow:index+sourceOffset };
    fields.forEach((field,column)=>{ if (field) row[field]=String(cells[column] || '').trim(); });
    return row;
  }).filter((row)=>row.SEQUENCIA_CARREGAMENTO || row.CARGA || row.ROTA);
}

function historicalAssignmentScore(context,employee,route,role,driver=null){
  let score=0;const target=normalizeText(destinationBase(route?.rota||''));
  for(const item of context.schedules||[]){
    if(normalizeText(item.status)==='CANCELADO')continue;
    const sameRoute=normalizeText(destinationBase(item.rota||''))===target;
    const driverUsed=resourceUsed(item,employee.id,'MOTORISTA')||normalizeText(item.motorista)===normalizeText(employee.nome);
    const helperUsed=resourceUsed(item,employee.id,'AJUDANTE')||[item.ajudante_1,item.ajudante_2].map(normalizeText).includes(normalizeText(employee.nome));
    if(role==='MOTORISTA'&&driverUsed){
      // v1.0.63: repetir o motorista na mesma rota passa a ser a principal
      // preferência da pré-escala. Uma ocorrência histórica na mesma rota já
      // deve pesar mais que apenas a rota de referência do cadastro/PDF.
      if(sameRoute)score+=80;else score+=0.2;
    }
    if(role==='AJUDANTE'&&helperUsed){if(sameRoute)score+=4;if(driver&&(resourceUsed(item,driver.id,'MOTORISTA')||normalizeText(item.motorista)===normalizeText(driver.nome)))score+=6;}
  }
  return role==='MOTORISTA'?Math.min(score,240):Math.min(score,35);
}
function vehicleTypeText(vehicle={},schedule={}){
  return normalizeText(vehicle?.tipo||schedule?.veiculo_tipo||schedule?.tipo_veiculo||schedule?.TIPO_VEICULO||'');
}
function isTruckVehicle(vehicle={},schedule={}){
  return /\bTRUCK\b/.test(vehicleTypeText(vehicle,schedule));
}
function isThreeQuarterVehicle(vehicle={},schedule={}){
  const type=vehicleTypeText(vehicle,schedule).replace(/\s+/g,' ');
  return /(^|\D)3\s*\/\s*4(\D|$)/.test(type)
    || /\b3\s*4\b/.test(type)
    || type.includes('TRES QUART');
}
function helperRuleForAutoScale(schedule={},vehicle={}){
  if(schedule.servico_administrativo)return {count:0,team:'SEM_AJUDANTE',reason:'Serviço administrativo/outros: sem ajudante'};
  const vehicleThird=isThirdPartyLink(vehicle?.vinculo||schedule.veiculo_vinculo||'');
  const inferredClosed=Boolean(schedule.carga_fechada)||normalizeText(schedule.tipo_equipe)==='CARGA_FECHADA'||normalizeText(schedule.perfil).includes('CARGA FECHADA');
  if(vehicleThird)return {count:0,team:'TERCEIRO',reason:'Veículo terceiro'};
  if(inferredClosed)return {count:0,team:'CARGA_FECHADA',reason:'Carga fechada'};
  const region=normalizeRegion(schedule.regiao,schedule.rota);
  if(region==='SRT')return {count:1,team:'UM_AJUDANTE',reason:'Sertão: 1 ajudante'};
  if(isTruckVehicle(vehicle,schedule))return {count:1,team:'UM_AJUDANTE',reason:'Truck: máximo 1 ajudante'};
  const weightKg=Math.max(0,Number(schedule.peso_kg||0)||Number(schedule.peso_t||0)*1000||0);
  if(isThreeQuarterVehicle(vehicle,schedule)&&weightKg>=5000)return {count:2,team:'DOIS_AJUDANTES',reason:'3/4 com carga de 5 t ou mais'};
  const deliveries=Math.max(0,Math.round(Number(schedule.qtd_entregas||schedule.QTD_ENTREGAS||0)||0));
  if(deliveries>20)return {count:2,team:'DOIS_AJUDANTES',reason:'Mais de 20 entregas'};
  return {count:1,team:'UM_AJUDANTE',reason:'Regra padrão: 1 ajudante'};
}
const AUTO_SERTAO_DRIVER_BLOCKLIST = new Set([
  'CLAUDIVAN GOMES DOS SANTOS',
  'PAULO ROBERTO DOS SANTOS',
].map(normalizeText));
function driverBlockedFromSertaoAutoScale(employee,schedule={}){
  return normalizeRegion(schedule.regiao,schedule.rota)==='SRT'
    && AUTO_SERTAO_DRIVER_BLOCKLIST.has(normalizeText(employee?.nome));
}
// A pré-escala automática nunca sugere quem está EM ROTA ou em PERNOITE sem retorno
// confirmado, mesmo que a previsão de retorno da viagem aberta já tenha passado
// (a janela prevista não prova que a pessoa voltou). Liberação manual/explícita e
// retorno confirmado continuam liberando. Se ninguém serve, o campo fica vazio.
function autoOpenTripBlocksEmployee(context,employee,role,schedule,routeHelper,routeHelperSunday){
  if(explicitAvailability(context,schedule.data,role,employee.id))return false;
  const manualRelease=manualReleaseFor(context,employee.id,role);
  const allocations=planningResourceAllocations(employee,role==='MOTORISTA'?'MOTORISTA':'AJUDANTE',context,dateIso(schedule.data));
  return allocations.some((entry)=>{
    if(!['EM ROTA','PERNOITE'].includes(entry.status))return false;
    if(entry.schedule&&String(entry.schedule.id||'')===String(schedule.id||''))return false;
    if(entry.schedule&&manualReleaseClearsConflict(manualRelease,entry.schedule,schedule,context))return false;
    // Ajudante de rota pode apoiar outra viagem enquanto apenas EM ROTA; PERNOITE
    // bloqueia, exceto no domingo (regra existente).
    if(routeHelper)return entry.status==='PERNOITE'&&!routeHelperSunday;
    return true;
  });
}
function autoCandidateAvailable(context,employee,role,schedule,used){
  if(!employee?.id||used.has(String(employee.id))||!employee.ativo)return false;
  if(!rosterAllows(employee,schedule.data))return false;
  const status=normalizeText(statusForDate(employee,schedule.data));
  if(['FERIAS','FÉRIAS','ATESTADO','AFASTADO','RESERVADO','BLOQUEADO','DESLIGADO','EM ROTA','PERNOITE','FOLGA AGENDADA'].includes(status))return false;
  if(!schedule.servico_administrativo&&(context.schedules||[]).some((it)=>effectiveResourceUsed(it,employee.id,'COLABORADOR',context)&&pendingPriorPlanning(it,schedule,context)))return false;
  if(role==='MOTORISTA'&&!schedule.servico_administrativo&&!bitruckDriverMayUsePlate(context.carreteiros,employee,schedule.placa))return false;
  if(role==='MOTORISTA'){
    // v1.0.72: restrição operacional da pré-escala: Claudivan Gomes dos Santos
    // e Paulo Roberto dos Santos não devem ser sugeridos em rotas do Sertão.
    // normalizeRegion trata STR como alias de SRT.
    if(driverBlockedFromSertaoAutoScale(employee,schedule))return false;
    if(employee.restricao_motorista&&!schedule.carga_fechada&&!schedule.servico_administrativo)return false;
    const employeeThird=isThirdPartyLink(employee.vinculo);const vehicleThird=isThirdPartyLink(schedule.veiculo_vinculo);
    // Pré-escala mantém frota e vínculo alinhados: terceiro só em carro terceiro;
    // carro terceiro considera apenas motoristas terceiros.
    if(employeeThird!==vehicleThird)return false;
  }
  const routeHelper=role==='AJUDANTE'&&employee.ajudante_rota;
  const routeHelperSunday=routeHelper&&isSundayDate(schedule.data);
  if(role==='AJUDANTE'){
    if(routeHelper&&!helperSupportsRoute(employee,schedule))return false;
    if(employee.restricao_ajudante&&!isNetworkRoute(schedule))return false;
  }
  if(autoOpenTripBlocksEmployee(context,employee,role,schedule,routeHelper,routeHelperSunday))return false;
  if(resourceConflict(context,employee.id,'COLABORADOR',schedule,routeHelper,role,true))return false;
  if(!routeHelper&&openMonitoring(context,employee.id,'COLABORADOR',schedule,role))return false;
  // Ajudante de rota pode apoiar outra viagem quando está apenas EM ROTA.
  // PERNOITE bloqueia de segunda a sábado; no domingo ele é ignorado para a
  // programação, pois domingo não conta como trabalho do ajudante de rota.
  if(routeHelper&&!routeHelperSunday){
    const open=openMonitoring(context,employee.id,'COLABORADOR',schedule,role);
    if(open&&normalizeText(value(open.row,'STATUS_MONITORAMENTO','STATUS'))==='PERNOITE')return false;
  }
  return true;
}
function allocationPlanMatchesRoute(plan={},route={}) {
  const routeId=String(route?.id||'').trim(),planRouteId=String(plan?.route_id||'').trim();
  if(routeId&&planRouteId&&routeId===planRouteId)return true;
  return Boolean(normalizeText(plan?.route)&&normalizeText(plan.route)===normalizeText(route?.rota));
}
function allocationPlanForRoute(context,selected,route) {
  // Compatibilidade com planos antigos, que eram cadastrados por rota.
  const plans=(context?.allocationPlans||[]).filter((plan)=>plan?.ativo!==false&&(!plan.vigencia_inicio||plan.vigencia_inicio<=selected)&&(!plan.vigencia_fim||plan.vigencia_fim>=selected)&&allocationPlanMatchesRoute(plan,route));
  plans.sort((a,b)=>String(b.vigencia_inicio||'').localeCompare(String(a.vigencia_inicio||''))||String(b.atualizado_em||'').localeCompare(String(a.atualizado_em||'')));
  return plans[0]||null;
}
function allocationPlanMatchesVehicle(plan={},vehicle=null,plate='') {
  const key=plateKey(vehicle?.placa||plate||'');
  if(!key)return false;
  return key===plateKey(plan?.placa)||Boolean(plan?.placa_substituta&&key===plateKey(plan.placa_substituta));
}
function allocationPlanForVehicle(context,selected,vehicle=null,plate='') {
  const plans=(context?.allocationPlans||[]).filter((plan)=>plan?.ativo!==false&&(!plan.vigencia_inicio||plan.vigencia_inicio<=selected)&&(!plan.vigencia_fim||plan.vigencia_fim>=selected)&&allocationPlanMatchesVehicle(plan,vehicle,plate));
  plans.sort((a,b)=>String(b.vigencia_inicio||'').localeCompare(String(a.vigencia_inicio||''))||String(b.atualizado_em||'').localeCompare(String(a.atualizado_em||'')));
  return plans[0]||null;
}
function allocationPlanVehicleEntries(plan={},context={}) {
  const resolve=(id,plate)=>context.vehicleById?.get(String(id||''))||context.vehicleByPlate?.get(plateKey(plate))||null;
  const rows=[
    {kind:'PRINCIPAL',item:resolve(plan.veiculo_id,plan.placa)},
    // Campo mantido somente para registros legados. A UI nova trabalha com uma única placa.
    {kind:'SUBSTITUTO',item:resolve(plan.veiculo_substituto_id,plan.placa_substituta)},
  ];
  const seen=new Set();return rows.filter((row)=>{const key=String(row.item?.id||'');if(!key||seen.has(key))return false;seen.add(key);return true;});
}
function allocationPlanDriverEntries(plan={},context={},vehicle=null) {
  const resolve=(id,name)=>findEmployee(id,name,context);
  const principal={kind:'PRINCIPAL',item:resolve(plan.motorista_id,plan.motorista)};
  const substitute={kind:'SUBSTITUTO',item:resolve(plan.motorista_substituto_id,plan.motorista_substituto)};
  const legacyVehiclePair=Boolean(plan.placa_substituta);
  const vehicleIsSub=Boolean(legacyVehiclePair&&vehicle&&((plan.veiculo_substituto_id&&String(vehicle.id)===String(plan.veiculo_substituto_id))||(plan.placa_substituta&&plateKey(vehicle.placa)===plateKey(plan.placa_substituta))));
  const rows=vehicleIsSub?[substitute,principal]:[principal,substitute];
  const seen=new Set();return rows.filter((row)=>{const key=String(row.item?.id||'');if(!key||seen.has(key))return false;seen.add(key);return true;});
}
function allocationPlanPairEntries(plan={},context={}) {
  // Compatibilidade com a lógica antiga, usada apenas quando a linha não possui placa.
  const vehicles=allocationPlanVehicleEntries(plan,context);
  const drivers=allocationPlanDriverEntries(plan,context,null);
  const byVehicleKind=new Map(vehicles.map((entry)=>[entry.kind,entry.item]));
  const byDriverKind=new Map(drivers.map((entry)=>[entry.kind,entry.item]));
  return ['PRINCIPAL','SUBSTITUTO'].map((kind)=>({kind,vehicle:byVehicleKind.get(kind)||null,driver:byDriverKind.get(kind)||null})).filter((entry)=>entry.vehicle&&entry.driver);
}
function allocationPlanVehicleForDriver(plan={},context={},driver=null) {
  if(!driver)return null;
  const driverId=String(driver.id||''),driverName=normalizeText(driver.nome||'');
  const principal=(driverId&&String(plan.motorista_id||'')===driverId)||(driverName&&normalizeText(plan.motorista)===driverName);
  const substitute=(driverId&&String(plan.motorista_substituto_id||'')===driverId)||(driverName&&normalizeText(plan.motorista_substituto)===driverName);
  const wanted=substitute?'SUBSTITUTO':principal?'PRINCIPAL':'';
  return wanted?allocationPlanVehicleEntries(plan,context).find((entry)=>entry.kind===wanted)||null:null;
}
function allocationPlanHelper(plan={},context={}) {
  return findEmployee(plan?.ajudante_id,plan?.ajudante,context);
}
function employeeVacationOn(employee={},date='') {
  const start=dateIso(employee?.ferias_inicio||value(employee?.raw||{},'FERIAS_INICIO'));
  const end=dateIso(employee?.ferias_fim||value(employee?.raw||{},'FERIAS_FIM'));
  if(start&&end&&date>=start&&date<=end)return true;
  return (!start&&!end)&&['FERIAS','FÉRIAS'].includes(normalizeText(statusForDate(employee,date)));
}
function allocationPlanVacationTriggered(plan={},context={},date='') {
  // Gatilho: motorista principal da placa em férias ou reservado na data.
  return allocationPlanDriverEntries(plan,context,null).filter((entry)=>entry.kind==='PRINCIPAL').some((entry)=>employeeVacationOn(entry.item,date)||normalizeText(statusForDate(entry.item,date))==='RESERVADO');
}
function allocationFloatDriverEntries(context={},date='',region='') {
  const rows=[];const seen=new Set(),wantedRegion=allocationRegionKey(region);
  for(const item of context?.allocationFloatDrivers||[]){
    if(item?.ativo===false)continue;
    if(item.vigencia_inicio&&item.vigencia_inicio>date)continue;
    if(item.vigencia_fim&&item.vigencia_fim<date)continue;
    if(!wantedRegion||allocationRegionKey(item.regiao)!==wantedRegion)continue;
    const employee=findEmployee(item.motorista_id,item.motorista,context);const key=String(employee?.id||'');
    if(!employee||!key||seen.has(key))continue;seen.add(key);rows.push({kind:'CORINGA FÉRIAS',item:employee});
  }
  return rows;
}
function allocationDriverBelongsToPlan(plan={},context={},driver=null,date='',region='') {
  if(!plan||!driver)return false;
  const id=String(driver.id||''),name=normalizeText(driver.nome||'');
  const direct=allocationPlanDriverEntries(plan,context,null).some((entry)=>String(entry.item?.id||'')===id||(name&&normalizeText(entry.item?.nome)===name));
  if(direct)return true;
  // Motorista do plano de férias: qualquer outro motorista pode ser escalado sem sair da fidelização.
  return allocationPlanVacationTriggered(plan,context,date);
}
function allocationIsActiveFloatDriver(context={},date='',driver=null) {
  if(!driver)return false;
  const id=String(driver.id||''),name=normalizeText(driver.nome||'');
  return (context?.allocationFloatDrivers||[]).some((item)=>{
    if(item?.ativo===false)return false;
    if(item.vigencia_inicio&&item.vigencia_inicio>date)return false;
    if(item.vigencia_fim&&item.vigencia_fim<date)return false;
    return (id&&String(item.motorista_id||'')===id)||(name&&normalizeText(item.motorista)===name);
  });
}
function allocationHelperBelongsToPlan(plan={},context={},helper=null) {
  const planned=allocationPlanHelper(plan,context);if(!planned)return true;if(!helper)return false;
  return String(planned.id||'')===String(helper.id||'')||normalizeText(planned.nome)===normalizeText(helper.nome);
}
function allocationWarningsForSchedule(context={},schedule={},plan=null,date='') {
  if(!plan)return [];
  const warnings=[];
  const driver=findEmployee(schedule.motorista_id,schedule.motorista,context),plannedDrivers=allocationPlanDriverEntries(plan,context,null);
  if(driver&&plannedDrivers.length&&!allocationDriverBelongsToPlan(plan,context,driver,date,schedule.regiao||''))warnings.push(`Motorista ${driver.nome} não pertence à placa ${schedule.placa||plan.placa}.`);
  const plannedHelper=allocationPlanHelper(plan,context);
  if(plannedHelper){
    const h1=findEmployee(schedule.ajudante_1_id,schedule.ajudante_1,context),h2=findEmployee(schedule.ajudante_2_id,schedule.ajudante_2,context);
    const anySelected=Boolean(h1||h2);
    const helperOk=allocationHelperBelongsToPlan(plan,context,h1)||allocationHelperBelongsToPlan(plan,context,h2);
    if(anySelected&&!helperOk)warnings.push(`Ajudante da escala não pertence à placa ${schedule.placa||plan.placa}. Previsto: ${plannedHelper.nome}.`);
  }
  return warnings;
}
function autoVehicleAvailable(context,vehicle,schedule,usedVehicles) {
  if(!vehicle?.id||usedVehicles.has(String(vehicle.id))||vehicle.ativo===false)return false;
  const status=normalizeText(vehicle.status||'DISPONÍVEL');
  if(['EM ROTA','PERNOITE','MANUTENÇÃO','MANUTENCAO','RESERVADO','BLOQUEADO','ANOMALIA','INATIVO'].includes(status))return false;
  if((context.reservations||[]).length&&vehicleReserved(context,vehicle.id,schedule.data))return false;
  if(resourceConflict(context,vehicle.id,'VEICULO',schedule,false,'VEICULO',true))return false;
  if(openMonitoring(context,vehicle.id,'VEICULO',schedule,'VEICULO'))return false;
  return true;
}
function plannedPairLabel(vehicleKind='',driverKind='') {
  if(driverKind==='CORINGA FÉRIAS')return 'CORINGA FÉRIAS';
  if(vehicleKind==='PRINCIPAL'&&driverKind==='PRINCIPAL')return 'PRINCIPAL';
  if(driverKind==='PRINCIPAL')return 'PRINCIPAL';
  if(driverKind==='SUBSTITUTO')return 'SUBSTITUTO PREVISTO';
  if(vehicleKind||driverKind)return 'SUBSTITUTO PREVISTO';
  return '';
}

export function autoPreScaleFromContext(context,date,records=[]){
  const selected=dateIso(date)||new Date().toISOString().slice(0,10);
  if(!Array.isArray(records)||!records.length)return {versao:VERSION,date:selected,records:[]};
  const usedVehicles=new Set(),usedDrivers=new Set(),usedHelpers=new Set(),output=[];
  for(const raw of records){
    const route=findRoute({...raw,data:selected},context);
    const rawVehicle=findVehicle(raw,context);
    const rawDriver=findEmployee(raw.motorista_id,raw.motorista,context);
    const hadHelper=Boolean(raw.ajudante_1_id||raw.ajudante_1),hadVehicle=Boolean(raw.veiculo_id||raw.placa),hadDriver=Boolean(raw.motorista_id||raw.motorista);
    let vehicle=rawVehicle;
    let plan=allocationPlanForVehicle(context,selected,rawVehicle,raw.placa)||null;
    // O plano é exclusivamente por placa. A rota nunca sugere placa, motorista ou
    // ajudante; quando a linha ainda não tem placa, segue apenas o fallback operacional.
    let plannedVehicleKind=vehicle&&plan?'PRINCIPAL':'';
    let plannedDriverCandidate=null;
    let plannedDriverKind='';
    if(vehicle?.id)usedVehicles.add(String(vehicle.id));
    // Se a placa só ficou conhecida agora, recarrega o plano por placa antes de
    // escolher a equipe. Este é o caminho normal do novo modelo.
    plan=allocationPlanForVehicle(context,selected,vehicle,vehicle?.placa||raw.placa)||plan;

    const inferredClosed=normalizeText(raw.tipo_equipe)==='CARGA_FECHADA'||normalizeText(route.perfil).includes('CARGA FECHADA');
    const vehicleThird=isThirdPartyLink(vehicle?.vinculo||'');
    const schedule={
      ...raw,data:selected,rota_id:route.id,rota:route.rota,regiao:route.regiao,perfil:route.perfil||'',duracao_dias:route.duracao_dias,
      veiculo_id:vehicle?.id||raw.veiculo_id||'',placa:vehicle?.placa||raw.placa||'',veiculo_vinculo:vehicle?.vinculo||'',
      veiculo_tipo:vehicle?.tipo||raw.veiculo_tipo||raw.tipo_veiculo||'',
      tipo_equipe:vehicleThird?'TERCEIRO':inferredClosed?'CARGA_FECHADA':(normalizeText(raw.tipo_equipe)||'UM_AJUDANTE'),
      carga_fechada:!vehicleThird&&inferredClosed,
      servico_administrativo:routeIsAdministrative(route),
    };
    const helperRule=helperRuleForAutoScale(schedule,vehicle);
    schedule.tipo_equipe=helperRule.team;
    schedule.regra_ajudantes=helperRule.reason;

    // Placa definida -> motorista principal -> substituto. Motoristas coringa só
    // entram automaticamente quando existe férias no par previsto para a placa.
    let chosenDriver=rawDriver,planDriverStrict=false;
    if(chosenDriver){schedule.motorista_id=chosenDriver.id;schedule.motorista=chosenDriver.nome;usedDrivers.add(String(chosenDriver.id));}
    else{
      if(plannedDriverCandidate&&autoCandidateAvailable(context,plannedDriverCandidate,'MOTORISTA',schedule,usedDrivers))chosenDriver=plannedDriverCandidate;
      if(!chosenDriver&&plan){
        const plannedDriver=allocationPlanDriverEntries(plan,context,vehicle).find((entry)=>autoCandidateAvailable(context,entry.item,'MOTORISTA',schedule,usedDrivers))||null;
        if(plannedDriver){chosenDriver=plannedDriver.item;plannedDriverKind=plannedDriver.kind;}
      }
      // Plano de alocação é exclusivo: se a placa tem motorista no plano e ele não está
      // disponível (férias, folga, em rota...), o carro fica sem motorista, sem coringa nem fallback.
      planDriverStrict=Boolean(plan&&allocationPlanDriverEntries(plan,context,vehicle).length);
      if(!chosenDriver&&plan&&!planDriverStrict&&allocationPlanVacationTriggered(plan,context,selected)){
        const floatDriver=allocationFloatDriverEntries(context,selected,schedule.regiao||route.regiao||'').find((entry)=>autoCandidateAvailable(context,entry.item,'MOTORISTA',schedule,usedDrivers))||null;
        if(floatDriver){chosenDriver=floatDriver.item;plannedDriverKind='CORINGA FÉRIAS';}
      }
      if(!chosenDriver&&!planDriverStrict){
        const drivers=(context.drivers||[])
          .filter((e)=>!allocationIsActiveFloatDriver(context,selected,e)&&autoCandidateAvailable(context,e,'MOTORISTA',schedule,usedDrivers))
          .map((e)=>({e,score:historicalAssignmentScore(context,e,route,'MOTORISTA')+routeReferenceScore(e,route)-workSignalFor(context,e).before*3}))
          .sort((a,b)=>b.score-a.score||a.e.nome.localeCompare(b.e.nome,'pt-BR'));
        chosenDriver=drivers[0]?.e||null;
      }
      if(chosenDriver){schedule.motorista_id=chosenDriver.id;schedule.motorista=chosenDriver.nome;usedDrivers.add(String(chosenDriver.id));}
    }

    if(helperRule.count>0){
      let h1=findEmployee(raw.ajudante_1_id,raw.ajudante_1,context);
      if(h1){schedule.ajudante_1_id=h1.id;schedule.ajudante_1=h1.nome;usedHelpers.add(String(h1.id));}
      const rankedHelpers=()=> (context.helpers||[])
        .filter((e)=>autoCandidateAvailable(context,e,'AJUDANTE',schedule,usedHelpers))
        .map((e)=>({e,score:historicalAssignmentScore(context,e,route,'AJUDANTE',chosenDriver)-workSignalFor(context,e).before*2+(e.ajudante_rota?8:0)}))
        .sort((a,b)=>b.score-a.score||a.e.nome.localeCompare(b.e.nome,'pt-BR'));
      if(!h1&&plan){
        const plannedHelper=allocationPlanHelper(plan,context);
        if(plannedHelper&&autoCandidateAvailable(context,plannedHelper,'AJUDANTE',schedule,usedHelpers)){
          h1=plannedHelper;schedule.ajudante_1_id=h1.id;schedule.ajudante_1=h1.nome;usedHelpers.add(String(h1.id));
        }
      }
      // Com plano de alocação na placa, ajudante só o fixado no plano; sem fixo, fica vazio para seleção manual.
      if(!h1&&!plan){
        h1=rankedHelpers()[0]?.e||null;
        if(h1){schedule.ajudante_1_id=h1.id;schedule.ajudante_1=h1.nome;usedHelpers.add(String(h1.id));}
      }
      if(helperRule.count===2){
        let h2=findEmployee(raw.ajudante_2_id,raw.ajudante_2,context);
        if(h2&&String(h2.id)!==String(h1?.id)&&!usedHelpers.has(String(h2.id))){
          schedule.ajudante_2_id=h2.id;schedule.ajudante_2=h2.nome;usedHelpers.add(String(h2.id));
        }else h2=null;
        if(!h2&&!plan){
          h2=rankedHelpers().find((x)=>String(x.e.id)!==String(h1?.id))?.e||null;
          if(h2){schedule.ajudante_2_id=h2.id;schedule.ajudante_2=h2.nome;usedHelpers.add(String(h2.id));}
        }
      }else{
        schedule.ajudante_2_id='';schedule.ajudante_2='';
      }
    }else{
      schedule.ajudante_1_id='';schedule.ajudante_1='';schedule.ajudante_2_id='';schedule.ajudante_2='';
    }

    const allocationWarnings=excludedFromAllocationPlan(schedule,context)?[]:allocationWarningsForSchedule(context,schedule,plan,selected);
    const suggestion=[];
    const planClass=plan?plannedPairLabel(plannedVehicleKind,plannedDriverKind):'';
    if(plan){
      if(helperRule.count>0&&!schedule.ajudante_1_id&&!hadHelper)suggestion.push('Plano de alocação sem ajudante fixo disponível · ajudante deixado para seleção manual');
      if(planDriverStrict&&!chosenDriver)suggestion.push('Motorista do plano indisponível · carro deixado sem motorista');
      if(planClass)suggestion.push(`Plano de alocação: ${planClass}${schedule.placa?` · ${schedule.placa}`:''}${schedule.motorista?` · ${schedule.motorista}`:''}`);
      else if(hadVehicle||hadDriver)suggestion.push('Plano de alocação por placa consultado · seleção informada preservada');
      else suggestion.push('Plano de alocação sem recurso disponível · aplicado fallback operacional');
      const fixedHelper=allocationPlanHelper(plan,context);if(fixedHelper)suggestion.push(`Ajudante da placa: ${fixedHelper.nome}`);
    }
    if(chosenDriver)suggestion.push(`Motorista: ${chosenDriver.nome}`);else suggestion.push('Sem motorista elegível para sugestão automática');
    if(helperRule.count===0)suggestion.push(`Equipe: ${helperRule.reason}`);
    else{
      const helperNames=[schedule.ajudante_1,schedule.ajudante_2].filter(Boolean);
      suggestion.push(`Ajudantes: ${helperRule.count} (${helperRule.reason})`);
      if(helperNames.length)suggestion.push(helperNames.join(' / '));
      if(helperNames.length<helperRule.count)suggestion.push(`Faltam ${helperRule.count-helperNames.length} ajudante(s) elegível(is)`);
    }
    if(allocationWarnings.length)suggestion.push(`AVISO: ${allocationWarnings.join(' ')}`);
    const existingWarnings=Array.isArray(raw.avisos)?raw.avisos:[];
    output.push({...schedule,avisos:[...existingWarnings,...allocationWarnings],pre_escala:true,pre_escala_plano_id:plan?.id||'',pre_escala_plano:planClass||'',pre_escala_motivo:suggestion.join(' · ')});
  }
  return {versao:VERSION,date:selected,records:output};
}

export async function autoPreScale(db,user,date,records=[]){
  assertScheduleAccess(user,false);await ensureScheduleSchema(db);const selected=dateIso(date)||new Date().toISOString().slice(0,10);
  if(!Array.isArray(records)||!records.length)return {versao:VERSION,date:selected,records:[]};
  const context=await loadOperationalContext(db,selected);
  const [allocationPlans,allocationFloatDrivers]=await Promise.all([readAllocationPlansForDate(db,selected),readAllocationFloatDriversForDate(db,selected)]);
  context.allocationPlans=allocationPlans;context.allocationFloatDrivers=allocationFloatDrivers;
  return autoPreScaleFromContext(context,selected,records);
}

export async function previewScheduleImport(db,user,date,input) {
  assertScheduleAccess(user,true); const selected = dateIso(date); if (!selected) throw new Error('Selecione a data da escala.');
  // Prévia de importação usa somente o dia selecionado + catálogos; não precisa
  // abrir Retornos/Monitoramento/Status Diário.
  const context = await loadSchedulePlanningContext(db,selected); const rows = parseTabularText(input); const counts={};
  rows.forEach((row)=>{ const key=clean(row.SEQUENCIA_CARREGAMENTO); if (key) counts[key]=(counts[key]||0)+1; });
  const preview = rows.map((row)=>{
    const errors=[]; const warnings=[]; const route=context.routeByName.get(normalizeText(row.ROTA)); const vehicle=row.PLACA ? context.vehicleByPlate.get(plateKey(row.PLACA)) : null; const ocs=normalizeLoadOrders(row.CARGA); const nonDeparture=isNonDepartureSchedule({ocs,rota:row.ROTA}); const weight=parseKgToTon(row.PESO_CARGA_TON,null);
    if (!row.SEQUENCIA_CARREGAMENTO && !nonDeparture) errors.push('Sequência vazia'); if (!row.ROTA) errors.push('Rota vazia');
    if (weight === null || weight < 0 || (!nonDeparture && weight <= 0)) errors.push('Peso inválido. Use kg no padrão 6.330 ou 6.330,17'); if (row.ROTA && !route) errors.push('Rota não cadastrada'); if (row.PLACA && !vehicle) errors.push('Placa não cadastrada');
    const sequence=clean(row.SEQUENCIA_CARREGAMENTO); const duplicate=Boolean(sequence && ((counts[sequence]||0)>1 || context.schedules.some((item)=>item.data===selected && clean(item.sequencia)===sequence && normalizeText(item.status)!=='CANCELADO')));
    if (duplicate) warnings.push('Sequência repetida no dia');
    return { ...row,data:selected,sequencia:sequence,ocs,veiculo_id:vehicle?.id || '',placa:vehicle?.placa || row.PLACA || '',qtd_entregas:Math.max(0,Math.round(Number(String(row.QTD_ENTREGAS || '0').replace(',','.')) || 0)),peso_t:weight || 0,peso_kg:(weight || 0)*1000,temperatura_frio_c:optionalNumberValue(row.TEMPERATURA_FRIO_C),horario_ponto:defaultDepartureTime(selected,context.settings),rota_id:route?.id || '',regiao:route?.regiao || normalizeRegion('',row.ROTA),duplicada:duplicate,avisos:warnings,valid:errors.length===0,errors };
  });
  return { versao:VERSION,rows:preview,validCount:preview.filter((row)=>row.valid).length,invalidCount:preview.filter((row)=>!row.valid).length,duplicateCount:preview.filter((row)=>row.valid && row.duplicada).length };
}
export async function confirmScheduleImport(db,user,date,rows,requestId='') {
  assertScheduleAccess(user,true); await ensureScheduleSchema(db);
  if (!Array.isArray(rows) || !rows.length) throw new Error('Nenhuma linha válida para importar.');
  const selected=dateIso(date); if (!selected) throw new Error('Selecione uma data válida para a escala.');
  const safeRequestId=clean(requestId,180);
  if (safeRequestId) {
    const prior=await db.prepare('SELECT RESPONSE_JSON FROM ROUTE_SCHEDULE_REQUESTS WHERE REQUEST_ID=?').bind(safeRequestId).first();
    if (prior?.RESPONSE_JSON) return JSON.parse(prior.RESPONSE_JSON);
  }

  // v1.0.49: "Importar em massa" também passa pela pré-escala. Na versão anterior
  // esse caminho gravava motorista/ajudantes vazios mesmo quando Colar Excel/Subir
  // planilha já usavam a sugestão automática.
  const preContext=await loadOperationalContext(db,selected,{writeFast:true});
  const [allocationPlans,allocationFloatDrivers]=await Promise.all([readAllocationPlansForDate(db,selected),readAllocationFloatDriversForDate(db,selected)]);
  preContext.allocationPlans=allocationPlans;preContext.allocationFloatDrivers=allocationFloatDrivers;
  const proposed=autoPreScaleFromContext(preContext,selected,rows).records;
  return withScheduleLocks(db,proposed,selected,async()=>{
    if (safeRequestId) {
      const prior=await db.prepare('SELECT RESPONSE_JSON FROM ROUTE_SCHEDULE_REQUESTS WHERE REQUEST_ID=?').bind(safeRequestId).first();
      if (prior?.RESPONSE_JSON) return JSON.parse(prior.RESPONSE_JSON);
    }
    const context=await loadOperationalContext(db,selected,{writeFast:true}); const imported=[]; const skipped=[]; const duplicates=[];
    for (const row of proposed) {
      if (row.valid === false) { skipped.push({row:row.__sourceRow,reason:(row.errors||[]).join(', ') || 'Linha inválida'}); continue; }
      const route=context.routeById.get(String(row.rota_id || '')) || context.routeByName.get(normalizeText(row.rota || row.ROTA));
      if (!route) { skipped.push({row:row.__sourceRow,reason:'Rota não cadastrada'}); continue; }
      const sequence=clean(row.sequencia || row.SEQUENCIA_CARREGAMENTO); const duplicate=Boolean(sequence && context.schedules.some((item)=>item.data===selected && clean(item.sequencia)===sequence && normalizeText(item.status)!=='CANCELADO'));
      const importedVehicle = row.veiculo_id ? context.vehicleById.get(String(row.veiculo_id)) : (row.placa || row.PLACA ? context.vehicleByPlate.get(plateKey(row.placa || row.PLACA)) : null);
      const thirdParty = importedVehicle && normalizeText(importedVehicle.vinculo).includes('TERCEIR');
      const inferredClosed=normalizeText(row.tipo_equipe)==='CARGA_FECHADA'||normalizeText(route.perfil).includes('CARGA FECHADA');
      const team=thirdParty?'TERCEIRO':inferredClosed?'CARGA_FECHADA':normalizeText(row.tipo_equipe||'UM_AJUDANTE');
      const schedule={
        data:selected,sequencia:sequence,ocs:normalizeLoadOrders(row.ocs || row.CARGA),qtd_entregas:Math.max(0,Math.round(Number(row.qtd_entregas || row.QTD_ENTREGAS || 0) || 0)),
        peso_kg:Number(row.peso_kg || (Number(row.peso_t || row.PESO_CARGA_TON)*1000) || 0),temperatura_frio_c:optionalNumberValue(row.temperatura_frio_c ?? row.TEMPERATURA_FRIO_C),horario_ponto:timeOnly(row.horario_ponto) || defaultDepartureTime(selected,context.settings),
        rota_id:route.id,rota:route.rota,regiao:route.regiao,duracao_dias:route.duracao_dias,veiculo_id:importedVehicle?.id || '',placa:importedVehicle?.placa || clean(row.placa || row.PLACA,30),
        motorista_id:row.motorista_id||'',motorista:row.motorista||'',ajudante_1_id:row.ajudante_1_id||'',ajudante_1:row.ajudante_1||'',ajudante_2_id:row.ajudante_2_id||'',ajudante_2:row.ajudante_2||'',
        tipo_equipe:team,status:'PROGRAMADO',observacoes:row.observacoes||'',avisos:duplicate?['Sequência repetida no dia']:[],aviso_detalhes:duplicate?[warning('DUPLICATE_SEQUENCE','Sequência repetida no dia.')]:[],
        client_id:row.client_id||`IMP-${safeRequestId||generateId('REQ')}-${row.__sourceRow||sequence||imported.length+1}`,
      };
      const missingCrew=!schedule.motorista_id&&!schedule.motorista
        || (schedule.tipo_equipe==='UM_AJUDANTE'&&!schedule.ajudante_1_id&&!schedule.ajudante_1)
        || (schedule.tipo_equipe==='DOIS_AJUDANTES'&&((!schedule.ajudante_1_id&&!schedule.ajudante_1)||(!schedule.ajudante_2_id&&!schedule.ajudante_2)));
      const saveImported=async(payload)=>{
        const saved=await saveOne(db,payload,user,context,{allowIncompleteCrew:Boolean(payload.allow_incomplete_crew)});imported.push(saved);
        const currentIndex=context.schedules.findIndex((item)=>String(item.id)===String(saved.id));if(currentIndex>=0)context.schedules[currentIndex]=saved;else context.schedules.push(saved);
        if (duplicate) duplicates.push({row:row.__sourceRow,sequence,reason:'Sequência repetida no dia'});
        return saved;
      };
      try{
        // v1.0.72: a pré-escala é uma ajuda, não uma condição para importar.
        // Se faltou motorista/ajudante, grava a linha PROGRAMADA e deixa o campo
        // pendente para preenchimento manual no editor da Escala.
        await saveImported({...schedule,allow_incomplete_crew:missingCrew});
      }catch(error){
        const code=String(error?.code||''); const message=String(error?.message||error||'');
        const crewRelated=/^(EMPLOYEE_|DRIVER_|HELPER_|ROUTE_HELPER_|THIRD_PARTY_DRIVER_|RESOURCE_SCHEDULE_CONFLICT)/.test(code)
          || (code==='OPEN_MONITORING' && /Motorista|Ajudante|Colaborador/i.test(message))
          || /motorista|ajudante|colaborador/i.test(message);
        if(!crewRelated){skipped.push({row:row.__sourceRow,reason:message,code:code||'SCHEDULE_ERROR'});continue;}
        try{
          // Uma sugestão automática inválida também não derruba a linha inteira:
          // remove a equipe sugerida e importa para ajuste manual.
          await saveImported({...schedule,motorista_id:'',motorista:'',ajudante_1_id:'',ajudante_1:'',ajudante_2_id:'',ajudante_2:'',allow_incomplete_crew:true});
        }catch(fallbackError){skipped.push({row:row.__sourceRow,reason:fallbackError?.message||String(fallbackError),code:fallbackError?.code||'SCHEDULE_ERROR'});}
      }
    }
    const pendingManual=imported.filter((item)=>!item.motorista || (item.tipo_equipe==='UM_AJUDANTE'&&!item.ajudante_1) || (item.tipo_equipe==='DOIS_AJUDANTES'&&(!item.ajudante_1||!item.ajudante_2))).length;
    const response={versao:VERSION,committed:true,imported,updated:[],skipped,duplicates,pendingManual};
    if (safeRequestId) await db.prepare('INSERT OR REPLACE INTO ROUTE_SCHEDULE_REQUESTS (REQUEST_ID,RESPONSE_JSON) VALUES (?,?)').bind(safeRequestId,JSON.stringify(response)).run()
      .catch((error)=>console.error('Schedule import request-id warning',error));
    return response;
  });
}
