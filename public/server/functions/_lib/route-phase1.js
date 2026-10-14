import { audit, ensureCoreSchema, parseData, recordResourceEvents } from './core.js';
import { findScheduleRecordInternal, listScheduleRecordsInternal, saveSchedule } from './schedule.js';

export const VERSION = '1';
const TZ_OFFSET = '-03:00';
let schemaPromise = null;

export function normalizeText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
}
export function clean(value, max = 4000) { return String(value ?? '').trim().slice(0,max); }
export function numberValue(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const normalized = String(value ?? '').trim().replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');
  const parsed = Number(normalized); return Number.isFinite(parsed) ? parsed : fallback;
}
export function intValue(value, fallback = 0) { return Math.round(numberValue(value,fallback)); }
export function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1','TRUE','SIM','S','YES','ATIVO'].includes(normalizeText(value));
}
export function dateIso(value) {
  const raw = String(value ?? '').trim(); if (!raw) return '';
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/); if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  const parsed = new Date(raw); return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0,10) : '';
}
export function timeOnly(value) {
  const raw = String(value ?? '').trim(); if (!raw) return '';
  const match = raw.match(/(?:T|\s|^)(\d{1,2}):(\d{2})/); return match ? `${String(match[1]).padStart(2,'0')}:${match[2]}` : '';
}
export function localDateTime(date, value, fallback = '') {
  const raw = String(value ?? '').trim();
  let match = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}:\d{2})/);
  if (match) return `${match[1]}T${String(match[2]).padStart(5,'0')}`;
  // Compatibilidade com histórico e ajustes manuais em formato brasileiro.
  // Antes, "08/08/2026 10:47" perdia a própria data e herdava a data da escala.
  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})[T\s](\d{1,2}:\d{2})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}T${String(match[4]).padStart(5,'0')}`;
  const day = dateIso(date); const clock = timeOnly(raw || fallback);
  return day && clock ? `${day}T${clock}` : '';
}
export function epoch(value) {
  const raw = String(value || ''); if (!raw) return Number.NaN;
  const withZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw) ? `${raw}${raw.length===16?':00':''}${TZ_OFFSET}` : raw;
  return Date.parse(withZone);
}
export function diffMinutes(start,end) { const a=epoch(start),b=epoch(end); return Number.isFinite(a)&&Number.isFinite(b)?Math.round((b-a)/60000):Number.NaN; }
export function addMinutes(value,minutes) { const timestamp=epoch(value); if(!Number.isFinite(timestamp))return ''; const shifted=new Date(timestamp+Number(minutes||0)*60000-3*3600000); return shifted.toISOString().slice(0,16); }
export function addDays(date, amount) { const day=dateIso(date); if(!day)return ''; const parsed=new Date(`${day}T12:00:00Z`); parsed.setUTCDate(parsed.getUTCDate()+Number(amount||0)); return parsed.toISOString().slice(0,10); }
export function inPeriod(date,start,end) { const day=dateIso(date); return Boolean(day && (!start||day>=start) && (!end||day<=end)); }
export function nowIso() { return new Date().toISOString(); }
export function recifeNowIso() {
  const now=new Date();
  try {
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(now);
    const get=(type)=>parts.find((part)=>part.type===type)?.value||'';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  } catch {
    return new Date(now.getTime()-3*3600000).toISOString().slice(0,19);
  }
}
export function userName(user) { return clean(user?.name || user?.email || 'Sistema',180); }

function automaticActorName(value) {
  const actor=normalizeText(value);
  return /AUTOMACAO|SISTEMA|GPS|PROTECTSAT|NATTO ENTREGAS|SERVICE|INTEGRACAO/.test(actor);
}
function changeAuditMetadata(user,data={}) {
  const actorName=userName(user);
  const origin=normalizeText(data.origem || data.origem_saida || data.source || data.fonte || data.ultima_alteracao_origem || '');
  const hasHumanUserId=Number(user?.id||0)>0;
  const automatic=!hasHumanUserId || automaticActorName(actorName);
  let source='';
  if(automatic){
    if(origin==='GPS'||normalizeText(actorName).includes('GPS'))source='GPS';
    else if(origin==='APP'||normalizeText(actorName).includes('NATTO ENTREGAS'))source='APP NATTO ENTREGAS';
    else if(origin==='PROTECTSAT'||normalizeText(actorName).includes('PROTECTSAT'))source='PROTECTSAT';
    else source=origin||'SISTEMA';
  }else source=origin||'EDIÇÃO MANUAL';
  return {actorName,type:automatic?'AUTOMATICA':'USUARIO',source};
}
function inferStoredChangeType(data,row,actorName) {
  const explicit=normalizeText(data.ultima_alteracao_tipo||data.last_change_type||'');
  if(explicit==='AUTOMATICA'||explicit==='USUARIO'||explicit==='NAO_IDENTIFICADA')return explicit;
  if(Number(row.UPDATED_BY||0)>0)return 'USUARIO';
  const origin=normalizeText(data.ultima_alteracao_origem||data.origem||data.origem_saida||'');
  if(automaticActorName(actorName)||['GPS','APP','PROTECTSAT'].includes(origin))return 'AUTOMATICA';
  if(actorName)return 'USUARIO';
  return 'NAO_IDENTIFICADA';
}

async function routePhase1SchemaReady(db) {
  try {
    const expected = [
      'ROUTE_DEPARTURES','IDX_ROUTE_DEPARTURE_SCHEDULE','IDX_ROUTE_DEPARTURE_DATE',
      'ROUTE_MONITORING','IDX_ROUTE_MONITORING_SCHEDULE','IDX_ROUTE_MONITORING_DATE',
      'ROUTE_RETURNS','IDX_ROUTE_RETURN_SCHEDULE','IDX_ROUTE_RETURN_DATE',
      'ROUTE_AWARD_EVALUATIONS','ROUTE_AWARD_COLLECTIVE','ROUTE_REQUESTS','IDX_ROUTE_REQUEST_CREATED',
      'ROUTE_DEPARTURE_AUDITS','IDX_ROUTE_DEPARTURE_AUDIT_DATE','IDX_ROUTE_DEPARTURE_AUDIT_DEPARTURE',
      'ROUTE_DEPARTURE_AUDIT_PHOTOS','IDX_ROUTE_DEPARTURE_AUDIT_PHOTOS_AUDIT',
    ];
    const placeholders = expected.map(() => '?').join(',');
    const result = await db.prepare(`SELECT name FROM sqlite_master WHERE name IN (${placeholders})`).bind(...expected).all();
    const found = new Set((result.results || []).map((row) => String(row.name || '')));
    return expected.every((name) => found.has(name));
  } catch {
    return false;
  }
}

// O bootstrap operacional só garante tabelas e índices estruturais pequenos.
// Índices de performance de migrations (ex.: *_DATE_ID / *_STATUS_DATE_ID) não
// são criados durante Saída/Monitoramento/Retorno, pois um CREATE INDEX em tabela
// já grande pode estourar o tempo do Worker e virar HTTP 503 na operação do usuário.
export async function ensureRoutePhase1Schema(db) {
  if (!schemaPromise) schemaPromise=(async()=>{
    await ensureCoreSchema(db);
    if (await routePhase1SchemaReady(db)) return;
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_DEPARTURES (
        ID INTEGER PRIMARY KEY AUTOINCREMENT, SCHEDULE_ID TEXT, DATE_KEY TEXT NOT NULL, STATUS TEXT NOT NULL,
        PLATE TEXT, DRIVER_ID TEXT, DRIVER_NAME TEXT, ROUTE TEXT, REGION TEXT, PLANNED_AT TEXT, ACTUAL_AT TEXT,
        DELAY_MINUTES INTEGER NOT NULL DEFAULT 0, DATA_JSON TEXT NOT NULL, CREATED_BY INTEGER, UPDATED_BY INTEGER,
        CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
      db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS IDX_ROUTE_DEPARTURE_SCHEDULE ON ROUTE_DEPARTURES(SCHEDULE_ID) WHERE SCHEDULE_ID IS NOT NULL AND SCHEDULE_ID<>''`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_DEPARTURE_DATE ON ROUTE_DEPARTURES(DATE_KEY,STATUS)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_MONITORING (
        ID INTEGER PRIMARY KEY AUTOINCREMENT, SCHEDULE_ID TEXT, DEPARTURE_ID INTEGER, DATE_KEY TEXT NOT NULL, STATUS TEXT NOT NULL,
        PLATE TEXT, DRIVER_NAME TEXT, ROUTE TEXT, VERSION INTEGER NOT NULL DEFAULT 1, DATA_JSON TEXT NOT NULL,
        CREATED_BY INTEGER, UPDATED_BY INTEGER, CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
      db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS IDX_ROUTE_MONITORING_SCHEDULE ON ROUTE_MONITORING(SCHEDULE_ID) WHERE SCHEDULE_ID IS NOT NULL AND SCHEDULE_ID<>''`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_MONITORING_DATE ON ROUTE_MONITORING(DATE_KEY,STATUS)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_RETURNS (
        ID INTEGER PRIMARY KEY AUTOINCREMENT, SCHEDULE_ID TEXT, DEPARTURE_ID INTEGER, DATE_KEY TEXT NOT NULL, STATUS TEXT NOT NULL,
        PLATE TEXT, DRIVER_NAME TEXT, ROUTE TEXT, RETURN_AT TEXT, DATA_JSON TEXT NOT NULL, CREATED_BY INTEGER, UPDATED_BY INTEGER,
        CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
      db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS IDX_ROUTE_RETURN_SCHEDULE ON ROUTE_RETURNS(SCHEDULE_ID) WHERE SCHEDULE_ID IS NOT NULL AND SCHEDULE_ID<>''`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_RETURN_DATE ON ROUTE_RETURNS(DATE_KEY,STATUS)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_AWARD_EVALUATIONS (
        ID INTEGER PRIMARY KEY AUTOINCREMENT, PERIOD_START TEXT NOT NULL, PERIOD_END TEXT NOT NULL, EMPLOYEE_ID TEXT NOT NULL,
        DATA_JSON TEXT NOT NULL, CREATED_BY INTEGER, UPDATED_BY INTEGER, CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(PERIOD_START,PERIOD_END,EMPLOYEE_ID))`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_AWARD_COLLECTIVE (
        ID INTEGER PRIMARY KEY AUTOINCREMENT, PERIOD_START TEXT NOT NULL, PERIOD_END TEXT NOT NULL, DATA_JSON TEXT NOT NULL,
        CREATED_BY INTEGER, UPDATED_BY INTEGER, CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(PERIOD_START,PERIOD_END))`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_REQUESTS (
        REQUEST_ID TEXT PRIMARY KEY, DOMAIN TEXT NOT NULL, RESPONSE_JSON TEXT, CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_REQUEST_CREATED ON ROUTE_REQUESTS(CREATED_AT)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_DEPARTURE_AUDITS (
        ID INTEGER PRIMARY KEY AUTOINCREMENT, SCHEDULE_ID TEXT NOT NULL UNIQUE, DEPARTURE_ID INTEGER, DATE_KEY TEXT NOT NULL,
        PLATE TEXT, ROUTE TEXT, RESULT TEXT NOT NULL DEFAULT 'CONFORME', CHECKLIST_JSON TEXT NOT NULL, NOTES TEXT,
        AUDITOR_ID INTEGER, AUDITOR_NAME TEXT, AUDITED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_DEPARTURE_AUDIT_DATE ON ROUTE_DEPARTURE_AUDITS(DATE_KEY,RESULT)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_DEPARTURE_AUDIT_DEPARTURE ON ROUTE_DEPARTURE_AUDITS(DEPARTURE_ID)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_DEPARTURE_AUDIT_PHOTOS (
        ID INTEGER PRIMARY KEY AUTOINCREMENT, AUDIT_ID INTEGER NOT NULL, FILE_NAME TEXT, MIME_TYPE TEXT NOT NULL,
        SIZE_BYTES INTEGER NOT NULL DEFAULT 0, CAPTION TEXT, STORAGE_KIND TEXT NOT NULL DEFAULT 'D1', OBJECT_KEY TEXT,
        DATA_BASE64 TEXT, CREATED_BY INTEGER, CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_DEPARTURE_AUDIT_PHOTOS_AUDIT ON ROUTE_DEPARTURE_AUDIT_PHOTOS(AUDIT_ID,ID)`),
    ]);
  })().catch((error)=>{schemaPromise=null;throw error;});
  return schemaPromise;
}

const TABLES={departures:'ROUTE_DEPARTURES',monitoring:'ROUTE_MONITORING',returns:'ROUTE_RETURNS'};
function rowToRecord(row,module) {
  const data=parseData(row.DATA_JSON);
  const changeActor=clean(data.ultima_alteracao_por || data.ultima_edicao_por || data.last_updated_by || row.UPDATED_BY_NAME || '',180);
  const changeType=inferStoredChangeType(data,row,changeActor);
  const changeSource=clean(data.ultima_alteracao_origem || data.last_change_source || data.origem || data.origem_saida || (changeType==='AUTOMATICA'?'SISTEMA':'') || '',80);
  const changeAt=clean(data.ultima_alteracao_em || data.ultima_edicao_em || data.last_updated_at || row.UPDATED_AT || '',40);
  const manualActor=clean(data.ultima_edicao_por || data.last_manual_edit_by || (changeType==='USUARIO'?changeActor:'') || '',180);
  const manualAt=clean(data.ultima_edicao_em || data.last_manual_edit_at || (changeType==='USUARIO'?changeAt:'') || '',40);
  const automaticActor=clean(data.ultima_atualizacao_automatica_por || data.last_automatic_update_by || (changeType==='AUTOMATICA'?changeActor:'') || '',180);
  const automaticAt=clean(data.ultima_atualizacao_automatica_em || data.last_automatic_update_at || (changeType==='AUTOMATICA'?changeAt:'') || '',40);
  const automaticSource=clean(data.ultima_atualizacao_automatica_origem || data.last_automatic_update_source || (changeType==='AUTOMATICA'?changeSource:'') || '',80);
  const base={
    ...data,
    id:Number(row.ID),
    module,
    status:row.STATUS || data.status || data.status_saida || data.status_monitoramento || '',
    dateKey:row.DATE_KEY || data.data || '',
    data:dateIso(data.data || row.DATE_KEY),
    createdAt:row.CREATED_AT,
    updatedAt:row.UPDATED_AT,
    createdById:Number(row.CREATED_BY||0)||null,
    updatedById:Number(row.UPDATED_BY||0)||null,
    createdByName:clean(data.criado_por || data.created_by_name || row.CREATED_BY_NAME || '',180),
    updatedByName:changeActor,
    ultima_edicao_por:manualActor,
    ultima_edicao_em:manualAt,
    ultima_atualizacao_automatica_por:automaticActor,
    ultima_atualizacao_automatica_em:automaticAt,
    ultima_atualizacao_automatica_origem:automaticSource,
    ultima_alteracao_por:changeActor,
    ultima_alteracao_em:changeAt,
    ultima_alteracao_tipo:changeType,
    ultima_alteracao_origem:changeSource,
  };
  // Os campos estruturados das tabelas são a fonte mais confiável para
  // registros migrados/legados. DATA_JSON continua prevalecendo quando possui
  // o valor, mas os fallbacks abaixo evitam que hora real, placa, motorista ou
  // vínculo com a escala desapareçam dos indicadores por JSON antigo incompleto.
  const common={
    schedule_record_id:clean(data.schedule_record_id || data.schedule_id || data.escala_id || row.SCHEDULE_ID || '',120),
    schedule_id:clean(data.schedule_id || data.schedule_record_id || data.escala_id || row.SCHEDULE_ID || '',120),
    escala_id:clean(data.escala_id || data.schedule_record_id || data.schedule_id || row.SCHEDULE_ID || '',120),
    placa:clean(data.placa || row.PLATE || '',30).toUpperCase(),
    motorista:clean(data.motorista || row.DRIVER_NAME || '',180),
    rota:clean(data.rota || row.ROUTE || '',240),
  };
  if(module==='departures') return {
    ...base,...common,
    regiao:clean(data.regiao || row.REGION || '',80),
    hora_programada:timeOnly(data.hora_programada || data.plannedAt || data.planned_at || row.PLANNED_AT),
    hora_real:timeOnly(data.hora_real || data.actualAt || data.actual_at || row.ACTUAL_AT),
    atraso_minutos:Number.isFinite(Number(data.atraso_minutos)) ? Number(data.atraso_minutos) : Number(row.DELAY_MINUTES || 0),
    status_saida:data.status_saida || row.STATUS || data.status || '',
  };
  if(module==='monitoring') return {
    ...base,...common,
    departure_id:data.departure_id || row.DEPARTURE_ID || null,
    version:Number(data.version || row.VERSION || 1),
    status_monitoramento:data.status_monitoramento || row.STATUS || data.status || '',
  };
  if(module==='returns') return {
    ...base,...common,
    departure_id:data.departure_id || row.DEPARTURE_ID || null,
    retorno_real:data.retorno_real || data.return_at || row.RETURN_AT || '',
  };
  return {...base,...common};
}
export async function listDomainRows(db,module,filters={}) {
  await ensureRoutePhase1Schema(db); const table=TABLES[module]; if(!table)throw new Error('Domínio operacional inválido.');
  const clauses=['1=1'],binds=[];
  const start=dateIso(filters.start||filters.inicio),end=dateIso(filters.end||filters.fim),date=dateIso(filters.date||filters.data);
  if(date){clauses.push('t.DATE_KEY=?');binds.push(date);} if(start){clauses.push('t.DATE_KEY>=?');binds.push(start);} if(end){clauses.push('t.DATE_KEY<=?');binds.push(end);}
  if(filters.status){clauses.push('t.STATUS=?');binds.push(normalizeText(filters.status));}
  const limit=Math.min(Math.max(intValue(filters.limit,3000),1),10000);
  const result=await db.prepare(`SELECT t.*,cu.NAME AS CREATED_BY_NAME,uu.NAME AS UPDATED_BY_NAME FROM ${table} t LEFT JOIN ROUTE_USERS cu ON cu.ID=t.CREATED_BY LEFT JOIN ROUTE_USERS uu ON uu.ID=t.UPDATED_BY WHERE ${clauses.join(' AND ')} ORDER BY t.DATE_KEY DESC,t.ID DESC LIMIT ?`).bind(...binds,limit).all();
  let records=(result.results||[]).map((row)=>rowToRecord(row,module));
  const q=normalizeText(filters.q||filters.busca); if(q)records=records.filter((row)=>normalizeText(JSON.stringify(row)).includes(q));
  return records;
}
export async function getDomainRow(db,module,id) {
  await ensureRoutePhase1Schema(db); const table=TABLES[module]; const row=await db.prepare(`SELECT * FROM ${table} WHERE ID=?`).bind(Number(id)).first(); return row?rowToRecord(row,module):null;
}
export async function findDomainBySchedule(db,module,scheduleId) {
  await ensureRoutePhase1Schema(db); const table=TABLES[module]; const row=await db.prepare(`SELECT * FROM ${table} WHERE SCHEDULE_ID=? ORDER BY ID DESC LIMIT 1`).bind(String(scheduleId||'')).first(); return row?rowToRecord(row,module):null;
}
export async function upsertDomainRow(db,module,data,user,id=null) {
  const wasUpdate=Boolean(id);
  await ensureRoutePhase1Schema(db); const table=TABLES[module]; const scheduleId=clean(data.schedule_record_id||data.schedule_id||data.escala_id||'',120);
  const date=dateIso(data.data||data.dateKey||data.saida_real||data.retorno_real)||dateIso(new Date().toISOString());
  const status=normalizeText(data.status||data.status_saida||data.status_monitoramento||'PENDENTE');
  const plate=clean(data.placa,30).toUpperCase(),driverId=clean(data.motorista_id,120),driver=clean(data.motorista,180),route=clean(data.rota,240),region=clean(data.regiao,80);
  const actor=Number(user?.id||0)||null; const editedAt=recifeNowIso();
  const changeAudit=changeAuditMetadata(user,data); const actorName=changeAudit.actorName;
  const currentAuditRecord=id?await getDomainRow(db,module,id):(scheduleId?await findDomainBySchedule(db,module,scheduleId):null);
  const currentManualActor=clean(currentAuditRecord?.ultima_edicao_por || currentAuditRecord?.last_manual_edit_by || '',180);
  const currentManualAt=clean(currentAuditRecord?.ultima_edicao_em || currentAuditRecord?.last_manual_edit_at || '',40);
  const currentManualId=Number(currentAuditRecord?.ultima_edicao_por_id||0)||null;
  const currentAutomaticActor=clean(currentAuditRecord?.ultima_atualizacao_automatica_por || currentAuditRecord?.last_automatic_update_by || '',180);
  const currentAutomaticAt=clean(currentAuditRecord?.ultima_atualizacao_automatica_em || currentAuditRecord?.last_automatic_update_at || '',40);
  const currentAutomaticSource=clean(currentAuditRecord?.ultima_atualizacao_automatica_origem || currentAuditRecord?.last_automatic_update_source || '',80);
  const payload={...data,data:date,status,
    ultima_edicao_por:changeAudit.type==='USUARIO'?actorName:currentManualActor,
    ultima_edicao_por_id:changeAudit.type==='USUARIO'?actor:currentManualId,
    ultima_edicao_em:changeAudit.type==='USUARIO'?editedAt:currentManualAt,
    ultima_atualizacao_automatica_por:changeAudit.type==='AUTOMATICA'?actorName:currentAutomaticActor,
    ultima_atualizacao_automatica_em:changeAudit.type==='AUTOMATICA'?editedAt:currentAutomaticAt,
    ultima_atualizacao_automatica_origem:changeAudit.type==='AUTOMATICA'?changeAudit.source:currentAutomaticSource,
    ultima_alteracao_por:actorName,ultima_alteracao_em:editedAt,ultima_alteracao_tipo:changeAudit.type,ultima_alteracao_origem:changeAudit.source};
  if(module==='departures'){
    const planned=localDateTime(date,data.hora_programada),actual=localDateTime(date,data.hora_real); const delay=Math.max(0,diffMinutes(planned,actual)||0);
    if(id){await db.prepare(`UPDATE ${table} SET SCHEDULE_ID=?,DATE_KEY=?,STATUS=?,PLATE=?,DRIVER_ID=?,DRIVER_NAME=?,ROUTE=?,REGION=?,PLANNED_AT=?,ACTUAL_AT=?,DELAY_MINUTES=?,DATA_JSON=?,UPDATED_BY=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=?`).bind(scheduleId,date,status,plate,driverId,driver,route,region,planned,actual,delay,JSON.stringify(payload),actor,Number(id)).run();}
    else {const prior=scheduleId?await db.prepare(`SELECT ID FROM ${table} WHERE SCHEDULE_ID=? ORDER BY ID DESC LIMIT 1`).bind(scheduleId).first():null;if(prior?.ID){id=Number(prior.ID);await db.prepare(`UPDATE ${table} SET DATE_KEY=?,STATUS=?,PLATE=?,DRIVER_ID=?,DRIVER_NAME=?,ROUTE=?,REGION=?,PLANNED_AT=?,ACTUAL_AT=?,DELAY_MINUTES=?,DATA_JSON=?,UPDATED_BY=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=?`).bind(date,status,plate,driverId,driver,route,region,planned,actual,delay,JSON.stringify(payload),actor,id).run();}else{const result=await db.prepare(`INSERT INTO ${table}(SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_ID,DRIVER_NAME,ROUTE,REGION,PLANNED_AT,ACTUAL_AT,DELAY_MINUTES,DATA_JSON,CREATED_BY,UPDATED_BY) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(scheduleId,date,status,plate,driverId,driver,route,region,planned,actual,delay,JSON.stringify(payload),actor,actor).run();id=Number(result.meta?.last_row_id||0);}}
  } else if(module==='monitoring'){
    const current=id?await getDomainRow(db,module,id):scheduleId?await findDomainBySchedule(db,module,scheduleId):null; const version=Number(current?.version||0)+1;
    payload.version=version;
    if(id||current?.id){id=Number(id||current.id);await db.prepare(`UPDATE ${table} SET SCHEDULE_ID=?,DEPARTURE_ID=?,DATE_KEY=?,STATUS=?,PLATE=?,DRIVER_NAME=?,ROUTE=?,VERSION=?,DATA_JSON=?,UPDATED_BY=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=?`).bind(scheduleId,Number(data.departure_id||0)||null,date,status,plate,driver,route,version,JSON.stringify(payload),actor,id).run();}
    else {const result=await db.prepare(`INSERT INTO ${table}(SCHEDULE_ID,DEPARTURE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,VERSION,DATA_JSON,CREATED_BY,UPDATED_BY) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(scheduleId,Number(data.departure_id||0)||null,date,status,plate,driver,route,version,JSON.stringify(payload),actor,actor).run();id=Number(result.meta?.last_row_id||0);}
  } else {
    const returnAt=localDateTime(date,data.retorno_real||data.return_at); const current=id?await getDomainRow(db,module,id):scheduleId?await findDomainBySchedule(db,module,scheduleId):null;
    if(id||current?.id){id=Number(id||current.id);await db.prepare(`UPDATE ${table} SET SCHEDULE_ID=?,DEPARTURE_ID=?,DATE_KEY=?,STATUS=?,PLATE=?,DRIVER_NAME=?,ROUTE=?,RETURN_AT=?,DATA_JSON=?,UPDATED_BY=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=?`).bind(scheduleId,Number(data.departure_id||0)||null,date,status,plate,driver,route,returnAt,JSON.stringify(payload),actor,id).run();}
    else {const result=await db.prepare(`INSERT INTO ${table}(SCHEDULE_ID,DEPARTURE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON,CREATED_BY,UPDATED_BY) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(scheduleId,Number(data.departure_id||0)||null,date,status,plate,driver,route,returnAt,JSON.stringify(payload),actor,actor).run();id=Number(result.meta?.last_row_id||0);}
  }
  const record=await getDomainRow(db,module,id); await audit(db,user,wasUpdate?'ATUALIZAR':'CRIAR',module,id,{scheduleId,status}); return record;
}
export async function deleteDomainRow(db,module,id,user) {
  await ensureRoutePhase1Schema(db); const table=TABLES[module]; const current=await getDomainRow(db,module,id); if(!current)throw new Error('Registro não encontrado.');
  await db.prepare(`DELETE FROM ${table} WHERE ID=?`).bind(Number(id)).run(); await audit(db,user,'EXCLUIR',module,Number(id),current); return current;
}

export async function schedulesFor(db,user,filters={}) { const payload=await listScheduleRecordsInternal(db,filters); return payload.records||[]; }
export async function safeUpdateScheduleStatus(db,user,schedule,status,extra={}) {
  if (!schedule) return null;
  const desiredStatus = normalizeText(status);
  const next = { ...schedule, ...extra, id:schedule.id, status:desiredStatus };
  const sourceId = String(schedule.id || '');
  // Transições operacionais (Saída/Retorno) não precisam executar o editor
  // completo da Escala. O fluxo antigo chamava saveSchedule(), que recarregava
  // todo o contexto operacional e podia provocar timeout/HTTP 503 em um simples
  // retorno. Fazemos a atualização direta e auditada na tabela de origem.
  try {
    if (schedule.storage === 'ESCALAS_DIA' || !/^\d+$/.test(sourceId)) {
      // As transições operacionais também podem consolidar a equipe efetiva da
      // saída. Mantemos uma lista branca de colunas para não transformar este
      // helper em um editor genérico da Escala.
      const allowedExtra={
        veiculo_id:'VEICULO_ID',placa:'PLACA',motorista_id:'MOTORISTA_ID',motorista:'MOTORISTA',
        ajudante_1_id:'AJUDANTE_1_ID',ajudante_1:'AJUDANTE_1',ajudante_2_id:'AJUDANTE_2_ID',ajudante_2:'AJUDANTE_2',
        tipo_equipe:'TIPO_EQUIPE',observacoes:'OBSERVACOES',
      };
      const sets=['STATUS=?','ATUALIZADO_EM=?','USUARIO=?'];
      const binds=[desiredStatus,nowIso(),userName(user)];
      for(const [key,column] of Object.entries(allowedExtra)){
        if(!Object.prototype.hasOwnProperty.call(extra,key))continue;
        sets.push(`${column}=?`);binds.push(extra[key]??'');
      }
      binds.push(sourceId);
      const result = await db.prepare(`UPDATE ESCALAS_DIA SET ${sets.join(',')} WHERE ID=?`).bind(...binds).run();
      if (!Number(result.meta?.changes || 0)) return null;
    } else {
      const row = await db.prepare("SELECT DATA_JSON FROM ROUTE_RECORDS WHERE ID=? AND MODULE='schedule'").bind(Number(sourceId)).first();
      if (!row) return null;
      const data = { ...parseData(row.DATA_JSON), ...extra, status:desiredStatus };
      await db.prepare("UPDATE ROUTE_RECORDS SET STATUS=?,DATA_JSON=?,UPDATED_BY=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=? AND MODULE='schedule'")
        .bind(desiredStatus,JSON.stringify(data),Number(user?.id || 0) || null,Number(sourceId)).run();
    }
    await audit(db,user,'ATUALIZAR_STATUS_FLUXO','schedule',Number(sourceId) || null,{ status:desiredStatus,extra,directOperationalUpdate:true });
    return { ...next,status:desiredStatus };
  } catch { return null; }
}
export async function emitResourceStatus(db,user,schedule,status,source,details={}) {
  if(!schedule)return;
  try {
    const scheduleRecordId=schedule.schedule_record_id||schedule.schedule_id||schedule.id||null;
    await recordResourceEvents(db,{
      data:{...schedule,status},status,source,sourceModule:String(source||'SISTEMA').toLowerCase(),
      sourceRecordId:Number(details.monitoringId||details.recordId||schedule.id)||null,scheduleRecordId,
      effectiveAt:details.effectiveAt||new Date().toISOString(),user,details,
    });
  } catch {}
}
function scheduleAliases(row={}) {
  return [row.id,row.sourceKey,row.legado_id,row.escala_id,row.escala_id_legado]
    .filter((value)=>value!==null&&value!==undefined&&String(value).trim()!=='')
    .map((value)=>String(value).trim());
}
function sourceScheduleAliases(source={}) {
  return [source.schedule_record_id,source.schedule_id,source.escala_id,source.escala_id_legado,source.legado_id,source.sourceKey]
    .filter((value)=>value!==null&&value!==undefined&&String(value).trim()!=='')
    .map((value)=>String(value).trim());
}
export function scheduleMatch(schedule,source={}) {
  const scheduleIds=new Set(scheduleAliases(schedule));
  if(sourceScheduleAliases(source).some((value)=>scheduleIds.has(value)))return true;
  const sameDate=dateIso(schedule.data)===dateIso(source.data);
  if(!sameDate)return false;
  const schedulePlate=normalizeText(schedule.placa),sourcePlate=normalizeText(source.placa);
  const scheduleRoute=normalizeText(schedule.rota),sourceRoute=normalizeText(source.rota);
  if(schedulePlate&&sourcePlate&&scheduleRoute&&sourceRoute&&schedulePlate===sourcePlate&&scheduleRoute===sourceRoute)return true;
  const scheduleLoad=normalizeText(schedule.ocs||schedule.carga).replace(/[^A-Z0-9]+/g,'');
  const sourceLoad=normalizeText(source.ocs||source.carga).replace(/[^A-Z0-9]+/g,'');
  if(scheduleLoad&&sourceLoad&&scheduleLoad===sourceLoad)return true;
  const scheduleSeq=normalizeText(schedule.sequencia||schedule.sequencia_carregamento);
  const sourceSeq=normalizeText(source.sequencia||source.sequencia_carregamento);
  if(scheduleSeq&&sourceSeq&&scheduleSeq===sourceSeq)return true;
  const scheduleDriver=normalizeText(schedule.motorista),sourceDriver=normalizeText(source.motorista);
  return Boolean(schedulePlate&&sourcePlate&&scheduleDriver&&sourceDriver&&schedulePlate===sourcePlate&&scheduleDriver===sourceDriver);
}
function scheduleResolutionScore(schedule,source={}) {
  if(!schedule)return -1e9;
  let score=0;
  const sourceIds=new Set(sourceScheduleAliases(source));
  if(scheduleAliases(schedule).some((value)=>sourceIds.has(value)))score+=100;
  const preferredStorage=normalizeText(source.storage||source.schedule_storage||'');
  if(preferredStorage&&normalizeText(schedule.storage)===preferredStorage)score+=60;
  const sourceDay=dateIso(source.data||source.dateKey);
  if(sourceDay){score+=dateIso(schedule.data)===sourceDay?30:-30;}
  const compare=(left,right,hit,miss)=>{const a=normalizeText(left),b=normalizeText(right);if(a&&b)score+=a===b?hit:-miss;};
  compare(schedule.placa,source.placa,30,25);
  compare(schedule.rota,source.rota,25,20);
  compare(schedule.motorista,source.motorista,8,4);
  const scheduleLoad=normalizeText(schedule.ocs||schedule.carga).replace(/[^A-Z0-9]+/g,'');
  const sourceLoad=normalizeText(source.ocs||source.carga).replace(/[^A-Z0-9]+/g,'');
  if(scheduleLoad&&sourceLoad)score+=scheduleLoad===sourceLoad?20:-10;
  const scheduleSeq=normalizeText(schedule.sequencia||schedule.sequencia_carregamento);
  const sourceSeq=normalizeText(source.sequencia||source.sequencia_carregamento);
  if(scheduleSeq&&sourceSeq)score+=scheduleSeq===sourceSeq?12:-6;
  return score;
}
export async function resolveSchedule(db,user,source={}) {
  // Operational records created before the migration can point to numeric IDs
  // from ESCALAS_DIA. New schedules in ROUTE_RECORDS are numeric as well, so an
  // ID alone is ambiguous. Resolve explicit IDs against BOTH stores and use the
  // operational evidence (date/plate/route/load/driver) to choose the right one.
  const preferred=normalizeText(source.storage||source.schedule_storage||'');
  for(const wanted of sourceScheduleAliases(source)) {
    const stores=preferred==='ESCALAS_DIA'?['ESCALAS_DIA','ROUTE_RECORDS']
      :preferred==='ROUTE_RECORDS'?['ROUTE_RECORDS','ESCALAS_DIA']
      :['ROUTE_RECORDS','ESCALAS_DIA'];
    const candidates=[];
    for(const storage of stores){
      const direct=await findScheduleRecordInternal(db,wanted,storage).catch(()=>null);
      if(direct&&!candidates.some((row)=>String(row.id)===String(direct.id)&&normalizeText(row.storage)===normalizeText(direct.storage)))candidates.push(direct);
    }
    if(candidates.length){
      candidates.sort((a,b)=>scheduleResolutionScore(b,source)-scheduleResolutionScore(a,source));
      const best=candidates[0];
      // Exact ID is strong evidence; when two stores share the same numeric ID,
      // the score selects the one matching the route/date/plate.
      if(best)return best;
    }
  }
  const day=dateIso(source.data||source.dateKey);
  if(day){
    const nearby=await schedulesFor(db,user,{start:addDays(day,-2),end:addDays(day,2)});
    const matches=nearby.filter((row)=>scheduleMatch(row,source)).sort((a,b)=>scheduleResolutionScore(b,source)-scheduleResolutionScore(a,source));
    if(matches[0])return matches[0];
  }
  // Final fallback deliberately loads the complete schedule universe. This also
  // handles legacy ESCALAS_DIA rows whose DATA column is stored as DD/MM/YYYY and
  // therefore cannot be safely filtered in SQL with an ISO range.
  const rows=await schedulesFor(db,user,{});
  const matches=rows.filter((row)=>scheduleMatch(row,source)).sort((a,b)=>scheduleResolutionScore(b,source)-scheduleResolutionScore(a,source));
  return matches[0]||null;
}
export function departureStatus(value) { const status=normalizeText(value); return ['SAIU','NAO SAIU','NÃO SAIU','TRANSFERIDO','CANCELADO','PENDENTE'].includes(status)?status:'PENDENTE'; }
export function activeMonitoringStatus(value) { return ['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO'].includes(normalizeText(value)); }
