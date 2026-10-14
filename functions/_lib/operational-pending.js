import { audit, parseData } from './core.js';
import {
  addDays,
  dateIso,
  deleteDomainRow,
  getDomainRow,
  listDomainRows,
  normalizeText,
  schedulesFor,
} from './route-phase1.js';
import { deleteSchedule } from './schedule.js';
import { isOperationallyExcludedTrip } from './operational-exclusions.js';

const FINAL_SCHEDULE = new Set(['FINALIZADO', 'CANCELADO', 'RETORNOU']);
const OPEN_MONITORING = new Set(['EM ROTA', 'PERNOITE', 'RETORNO PREVISTO', 'EM RETORNO', 'NO DESTINO', 'DESCARREGADO']);
const PENDING_DEPARTURE = new Set(['PENDENTE', 'NAO SAIU', 'NÃO SAIU', 'TRANSFERIDO']);
const ORDER = Object.freeze({ CRÍTICA: 0, ALTA: 1, MÉDIA: 2, BAIXA: 3 });
const OCCURRENCE_START_DATE='2026-08-21';
const STOP_RETAIL_MINUTES=20;
const STOP_NETWORK_MINUTES=60;
let occurrenceSchemaPromise=null;
function isNetworkRoute(route=''){const text=normalizeText(route).replace(/[^A-Z0-9]+/g,' ');return /\bREDES?\b/.test(text);}
function stopThresholdForRoute(route=''){return isNetworkRoute(route)?STOP_NETWORK_MINUTES:STOP_RETAIL_MINUTES;}
function operationalMonitor(route=''){const text=normalizeText(route).replace(/[^A-Z0-9]+/g,' '),network=isNetworkRoute(route),ag1=/\bAG1\b/.test(text),ag2=/\bAG2\b/.test(text);return (ag1||ag2)&&!network?'FERNANDA':'JOÃO VICTOR';}
function stopTypeLabel(route=''){const threshold=stopThresholdForRoute(route);return `PARADA A PARTIR DE ${threshold===60?'1 HORA':`${threshold} MIN`}`;}
function recifeTimestamp(){try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date()),get=(t)=>parts.find((x)=>x.type===t)?.value||'00';return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;}catch{return new Date(Date.now()-3*3600000).toISOString().slice(0,19).replace('T',' ');}}
function wallClockMillis(value){const raw=String(value||'').trim().replace(' ','T'),m=raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);return m?Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6]||0)):NaN;}
function responseMinutes(detectedAt,justifiedAt){const a=wallClockMillis(detectedAt),b=wallClockMillis(justifiedAt);return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?Math.max(0,Math.round((b-a)/60000)):null;}
function isoWeekInfo(dateValue=''){const raw=String(dateValue||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return {key:'',label:''};const d=new Date(`${raw}T12:00:00Z`),day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()+4-day);const year=d.getUTCFullYear(),yearStart=new Date(Date.UTC(year,0,1,12)),week=Math.ceil((((d-yearStart)/86400000)+1)/7);return {key:`${year}-W${String(week).padStart(2,'0')}`,label:`Semana ${String(week).padStart(2,'0')}/${year}`};}

function domainScheduleKeys(row={}) {
  return [row.schedule_record_id,row.schedule_id,row.escala_id,row.escala_id_legado,row.legado_id]
    .filter((value)=>value!==null&&value!==undefined&&String(value)!=='').map(String);
}
function scheduleKeys(row={}) {
  return [row.id,row.sourceKey,row.legado_id,row.escala_id]
    .filter((value)=>value!==null&&value!==undefined&&String(value)!=='').map(String);
}
function scheduleId(row) { return domainScheduleKeys(row)[0] || ''; }
function firstIndex(rows) {
  const map = new Map();
  for (const row of rows || []) for(const key of domainScheduleKeys(row)) if(key&&!map.has(key))map.set(key,row);
  return map;
}
function linkedFrom(map,schedule){return scheduleKeys(schedule).map((key)=>map.get(key)).find(Boolean)||null;}
function internalNoTrip(row={}){
  const route=normalizeText(row.rota||row.ROUTE||row.destino||'').replace(/[^A-Z0-9]+/g,' ');
  return isOperationallyExcludedTrip(row)||/\b(CAIXA|CAIXAS|ALMOXARIFADO)\b/.test(route);
}
async function occurrenceSchemaReady(db){
  try{
    const expected=['ROUTE_OPERATIONAL_JUSTIFICATIONS','ROUTE_OPERATIONAL_JUSTIFICATION_HISTORY','IDX_ROUTE_OPERATIONAL_JUST_HISTORY_KEY','ROUTE_GPS_OCCURRENCES','IDX_ROUTE_GPS_OCC_DATE','ROUTE_GPS_RETENTIONS','IDX_ROUTE_GPS_RET_DATE','ROUTE_IGNITION_OFF_NIGHT','IDX_ROUTE_IGNITION_NIGHT_DATE'];
    const placeholders=expected.map(()=>'?').join(',');
    const result=await db.prepare(`SELECT name FROM sqlite_master WHERE name IN (${placeholders})`).bind(...expected).all();
    const found=new Set((result.results||[]).map((row)=>String(row.name||'')));
    return expected.every((name)=>found.has(name));
  }catch{return false;}
}
async function ensureOccurrenceSchema(db){
  if(!occurrenceSchemaPromise)occurrenceSchemaPromise=(async()=>{
    if(await occurrenceSchemaReady(db))return;
    await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_OPERATIONAL_JUSTIFICATIONS (
      OCCURRENCE_KEY TEXT PRIMARY KEY, JUSTIFICATION TEXT NOT NULL, JUSTIFIED_BY_ID INTEGER,
      JUSTIFIED_BY_NAME TEXT, JUSTIFIED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_OPERATIONAL_JUSTIFICATION_HISTORY (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,OCCURRENCE_KEY TEXT NOT NULL,JUSTIFICATION TEXT NOT NULL,
      JUSTIFIED_BY_ID INTEGER,JUSTIFIED_BY_NAME TEXT,RECORDED_AT TEXT NOT NULL,ACTION TEXT NOT NULL DEFAULT 'REGISTRO'
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_OPERATIONAL_JUST_HISTORY_KEY ON ROUTE_OPERATIONAL_JUSTIFICATION_HISTORY(OCCURRENCE_KEY,RECORDED_AT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_GPS_OCCURRENCES (
      OCCURRENCE_KEY TEXT PRIMARY KEY,TYPE TEXT NOT NULL,PRIORITY TEXT NOT NULL DEFAULT 'MÉDIA',DATE_KEY TEXT NOT NULL,
      PLATE TEXT NOT NULL,ROUTE TEXT,DRIVER_NAME TEXT,SCHEDULE_ID TEXT,MONITORING_ID INTEGER,STARTED_AT TEXT,
      DETECTED_AT TEXT NOT NULL,LAST_SEEN_AT TEXT NOT NULL,LOCATION_TEXT TEXT,LATITUDE REAL,LONGITUDE REAL,
      STOPPED_MINUTES INTEGER NOT NULL DEFAULT 0,IGNITION INTEGER NOT NULL DEFAULT 0,DETAILS TEXT,DATA_JSON TEXT,
      CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_OCC_DATE ON ROUTE_GPS_OCCURRENCES(DATE_KEY,TYPE,PLATE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_GPS_RETENTIONS (
      RETENTION_KEY TEXT PRIMARY KEY,DATE_KEY TEXT NOT NULL,PLATE TEXT NOT NULL,ROUTE TEXT,DRIVER_NAME TEXT,
      SCHEDULE_ID TEXT,MONITORING_ID INTEGER,STARTED_AT TEXT NOT NULL,LAST_SEEN_AT TEXT NOT NULL,ENDED_AT TEXT,
      LOCATION_TEXT TEXT,LATITUDE REAL,LONGITUDE REAL,DURATION_MINUTES INTEGER NOT NULL DEFAULT 0,
      ACTIVE INTEGER NOT NULL DEFAULT 1,DATA_JSON TEXT,CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_RET_DATE ON ROUTE_GPS_RETENTIONS(DATE_KEY,PLATE,STARTED_AT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_IGNITION_OFF_NIGHT (
      SESSION_KEY TEXT PRIMARY KEY,NIGHT_KEY TEXT NOT NULL,PLATE TEXT NOT NULL,VEHICLE_TYPE TEXT NOT NULL,
      SCHEDULE_ID TEXT,MONITORING_ID INTEGER,ROUTE TEXT,DRIVER_NAME TEXT,STARTED_AT TEXT NOT NULL,LAST_SEEN_AT TEXT NOT NULL,
      ENDED_AT TEXT,DURATION_MINUTES INTEGER NOT NULL DEFAULT 0,ACTIVE INTEGER NOT NULL DEFAULT 1,LOCATION_TEXT TEXT,LATITUDE REAL,LONGITUDE REAL,
      CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_IGNITION_NIGHT_DATE ON ROUTE_IGNITION_OFF_NIGHT(NIGHT_KEY,PLATE)`),
    ]);
  })().catch((error)=>{occurrenceSchemaPromise=null;throw error;});
  return occurrenceSchemaPromise;
}

function nightIgnitionGroupToken(row={}){
  const scheduleId=String(row.scheduleId||row.SCHEDULE_ID||'').trim();
  if(scheduleId)return `S:${scheduleId}`;
  const monitoringId=Number(row.monitoringId||row.MONITORING_ID||0);
  if(monitoringId>0)return `M:${monitoringId}`;
  return 'ROTA';
}
function consolidatedIgnitionKey(row={}){
  const token=nightIgnitionGroupToken(row).replace(/[^A-Za-z0-9:_-]/g,'_');
  return `GPS_IGNITION_OFF_NIGHT|${String(row.plate||row.PLATE||'').trim()}|${String(row.date||row.NIGHT_KEY||'').trim()}|${token}`;
}
function consolidateNightIgnitionRows(rawRows=[]){
  const groups=new Map();
  for(const raw of rawRows||[]){
    if(isOperationallyExcludedTrip(raw))continue;
    const row={
      sessionKey:String(raw.SESSION_KEY||''),date:String(raw.NIGHT_KEY||''),plate:String(raw.PLATE||''),vehicleType:String(raw.VEHICLE_TYPE||''),scheduleId:String(raw.SCHEDULE_ID||''),monitoringId:raw.MONITORING_ID||null,
      route:String(raw.ROUTE||''),driver:String(raw.DRIVER_NAME||''),startedAt:String(raw.STARTED_AT||''),lastSeenAt:String(raw.LAST_SEEN_AT||''),endedAt:String(raw.ENDED_AT||''),durationMinutes:Math.max(0,Number(raw.DURATION_MINUTES||0)),active:Number(raw.ACTIVE||0)!==0,location:String(raw.LOCATION_TEXT||'')
    };
    const key=`${row.date}|${row.plate}|${nightIgnitionGroupToken(row)}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const rows=[];
  for(const sessions of groups.values()){
    sessions.sort((a,b)=>String(a.startedAt).localeCompare(String(b.startedAt)));
    const first=sessions[0],last=sessions[sessions.length-1];
    const totalMinutes=sessions.reduce((sum,row)=>sum+Math.max(0,Number(row.durationMinutes||0)),0);
    const active=sessions.some((row)=>row.active);
    // Não exibe ocorrências instantâneas de 0 minuto. Elas passam a aparecer na
    // leitura seguinte quando houver duração efetivamente observada.
    if(totalMinutes<=0)continue;
    const locations=[...new Set(sessions.map((row)=>String(row.location||'').trim()).filter(Boolean))];
    rows.push({
      key:consolidatedIgnitionKey(first),date:first.date,plate:first.plate,vehicleType:first.vehicleType,scheduleId:first.scheduleId,monitoringId:first.monitoringId,
      route:last.route||first.route,driver:last.driver||first.driver,startedAt:first.startedAt,lastSeenAt:last.lastSeenAt,endedAt:active?'':(last.endedAt||last.lastSeenAt),durationMinutes:Math.round(totalMinutes),active,
      location:locations.join(' / '),intervalCount:sessions.length,intervals:sessions.map((row)=>({startedAt:row.startedAt,endedAt:row.endedAt||row.lastSeenAt,durationMinutes:row.durationMinutes,active:row.active,location:row.location}))
    });
  }
  return rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.plate).localeCompare(String(b.plate))||String(a.startedAt).localeCompare(String(b.startedAt)));
}
async function getNightIgnitionReport(db,start,end){
  await ensureOccurrenceSchema(db);
  const {results=[]}=await db.prepare(`SELECT SESSION_KEY,NIGHT_KEY,PLATE,VEHICLE_TYPE,SCHEDULE_ID,MONITORING_ID,ROUTE,DRIVER_NAME,STARTED_AT,LAST_SEEN_AT,ENDED_AT,DURATION_MINUTES,ACTIVE,LOCATION_TEXT FROM ROUTE_IGNITION_OFF_NIGHT WHERE NIGHT_KEY>=? AND NIGHT_KEY<=? ORDER BY NIGHT_KEY DESC,STARTED_AT DESC`).bind(start,end).all();
  const rawRows=(results||[]).filter((row)=>!isOperationallyExcludedTrip(row));
  const rows=consolidateNightIgnitionRows(rawRows);
  const plates=new Set(rows.map((row)=>row.plate).filter(Boolean));
  return {rows,summary:{vehicles:plates.size,nights:rows.length,sessions:rawRows.length,totalMinutes:rows.reduce((sum,row)=>sum+row.durationMinutes,0),active:rows.filter((row)=>row.active).length}};
}
async function justifiedOccurrenceKeys(db){
  await ensureOccurrenceSchema(db);
  const result=await db.prepare('SELECT OCCURRENCE_KEY FROM ROUTE_OPERATIONAL_JUSTIFICATIONS').all();
  return new Set((result.results||[]).map((row)=>String(row.OCCURRENCE_KEY||'')));
}

function responsible(type) {
  if (type.includes('SAIDA')) return 'OPERAÇÃO';
  if (type.includes('MONITORAMENTO') || type === 'ROTA_ABERTA') return 'MONITORAMENTO';
  if (type.includes('RETORNO')) return 'RETORNO';
  if (type.includes('FOTOGRAFIA')) return 'CENTRAL DE RECURSOS';
  return 'PLANEJAMENTO';
}

function makeItem(type, priority, source, row, schedule, details, related = {}) {
  const date = dateIso(row?.data || schedule?.data);
  const sourceId = String(row?.id || schedule?.id || '');
  return {
    id: `${type}|${source}|${sourceId}`,
    key: `${type}|${source}|${sourceId}`,
    tipo: type.replaceAll('_', ' '),
    type,
    prioridade: priority,
    severity: priority,
    responsavel: responsible(type),
    status: 'PENDENTE',
    origem: source,
    sheet: source,
    source_id: sourceId,
    domain_id: row?.id || null,
    schedule_record_id: String(schedule?.id || scheduleId(row) || ''),
    data: date,
    rota: row?.rota || schedule?.rota || '',
    placa: row?.placa || schedule?.placa || '',
    motorista: row?.motorista || schedule?.motorista || '',
    carga: row?.ocs || row?.carga || schedule?.ocs || schedule?.carga || '',
    detalhes: details,
    description: details,
    related,
    canDelete: true,
    canJustify: true,
    occurrenceOrigin: 'AUTOMÁTICA',
  };
}

async function listDailyStatus(db, start, end) {
  try {
    const result = await db.prepare(`SELECT * FROM STATUS_DIARIO WHERE COALESCE(DATA,'')>=? AND COALESCE(DATA,'')<=? ORDER BY DATA,ID`).bind(start,end).all();
    return (result.results || []).map((row) => ({ ...row, id:row.ID, data:dateIso(row.DATA), status:row.STATUS, origem:row.ORIGEM, placa:row.PLACA || '', motorista:row.NOME || '' }));
  } catch { return []; }
}

async function threeQuarterPlates(db){
  try{const {results=[]}=await db.prepare(`SELECT PLACA,TIPO FROM BASE_VEICULOS WHERE COALESCE(ATIVO,1)<>0`).all();return new Set((results||[]).filter((row)=>String(row.TIPO||'').toUpperCase().replace(/[^A-Z0-9]/g,'')==='34').map((row)=>String(row.PLACA||'').toUpperCase().replace(/[^A-Z0-9]/g,'')).filter(Boolean));}catch{return new Set();}
}

export async function getOperationalPendingAudit(db, user, filters = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const explicitDate = dateIso(filters.date || filters.data);
  const requestedStart = explicitDate || dateIso(filters.start || filters.inicio) || OCCURRENCE_START_DATE;
  const end = explicitDate || dateIso(filters.end || filters.fim) || today;
  const start = requestedStart < OCCURRENCE_START_DATE ? OCCURRENCE_START_DATE : requestedStart;
  if(end < OCCURRENCE_START_DATE) return {versao:'1',start,end,date:explicitDate||'',records:[],items:[],summary:{total:0,critical:0,high:0,medium:0,low:0},counts:{total:0,critical:0,high:0,medium:0,low:0},ignitionReport:{rows:[],summary:{vehicles:0,nights:0,sessions:0,totalMinutes:0,active:0}},generatedAt:new Date().toISOString(),occurrenceStartDate:OCCURRENCE_START_DATE,automaticRules:['PARADA_VAREJO_20_MIN','PARADA_REDE_60_MIN','IGNICAO_DESLIGADA_20_05_3_4']};

  await ensureOccurrenceSchema(db);
  const result=await db.prepare(`SELECT OCCURRENCE_KEY,TYPE,PRIORITY,DATE_KEY,PLATE,ROUTE,DRIVER_NAME,SCHEDULE_ID,MONITORING_ID,STARTED_AT,DETECTED_AT,LAST_SEEN_AT,LOCATION_TEXT,STOPPED_MINUTES,IGNITION,DETAILS,DATA_JSON
    FROM ROUTE_GPS_OCCURRENCES
    WHERE DATE_KEY>=? AND DATE_KEY<=?
      AND TYPE<>'IGNICAO_DESLIGADA_20_05'
      AND NOT (TYPE IN ('PARADA_ACIMA_15_MIN','PARADA_ACIMA_20_MIN') AND COALESCE(STOPPED_MINUTES,0)<20)
    ORDER BY DATE_KEY DESC,DETECTED_AT DESC`).bind(start,end).all();
  const justified=await justifiedOccurrenceKeys(db);
  const eligibleIgnitionPlates=await threeQuarterPlates(db);
  const labels={IGNICAO_DESLIGADA_20_05:'IGNIÇÃO DESLIGADA 20H–05H · 3/4'};
  let records=(result.results||[]).filter((row)=>!internalNoTrip(row)).filter((row)=>!justified.has(String(row.OCCURRENCE_KEY||''))).filter((row)=>String(row.TYPE||'')!=='IGNICAO_DESLIGADA_20_05'||eligibleIgnitionPlates.has(String(row.PLATE||'').toUpperCase().replace(/[^A-Z0-9]/g,''))).filter((row)=>!['PARADA_ACIMA_15_MIN','PARADA_ACIMA_20_MIN'].includes(String(row.TYPE||''))||Number(row.STOPPED_MINUTES||0)>=stopThresholdForRoute(row.ROUTE||'')).map((row)=>{
    const meta=parseData(row.DATA_JSON)||{};
    const rawType=String(row.TYPE||'');
    const type=['PARADA_ACIMA_15_MIN','PARADA_ACIMA_20_MIN'].includes(rawType)?'PARADA_ACIMA_20_MIN':rawType;
    const threshold=type==='PARADA_ACIMA_20_MIN'?stopThresholdForRoute(row.ROUTE||''):null;
    return {
      id:String(row.OCCURRENCE_KEY||''),key:String(row.OCCURRENCE_KEY||''),tipo:type==='PARADA_ACIMA_20_MIN'?stopTypeLabel(row.ROUTE||''):(labels[rawType]||String(rawType||'OCORRÊNCIA GPS').replaceAll('_',' ')),type,
      prioridade:String(row.PRIORITY||'MÉDIA'),severity:String(row.PRIORITY||'MÉDIA'),responsavel:operationalMonitor(row.ROUTE||''),monitorResponsavel:operationalMonitor(row.ROUTE||''),status:'PENDENTE',origem:'gps',sheet:'gps',source_id:String(row.OCCURRENCE_KEY||''),
      domain_id:null,schedule_record_id:String(row.SCHEDULE_ID||''),data:String(row.DATE_KEY||''),rota:String(row.ROUTE||''),placa:String(row.PLATE||''),motorista:String(row.DRIVER_NAME||''),carga:'',
      detalhes:String(row.DETAILS||''),description:String(row.DETAILS||''),related:{monitoringId:row.MONITORING_ID||null,startedAt:row.STARTED_AT||'',detectedAt:row.DETECTED_AT||'',lastSeenAt:row.LAST_SEEN_AT||'',location:row.LOCATION_TEXT||'',stoppedMinutes:Number(row.STOPPED_MINUTES||0),stopThresholdMinutes:threshold,routeProfile:isNetworkRoute(row.ROUTE||'')?'REDE':'VAREJO',ignition:Number(row.IGNITION||0),active:type==='PARADA_ACIMA_20_MIN'&&Boolean(meta.active),endedAt:String(meta.endedAt||'')},
      canDelete:false,canJustify:true,occurrenceOrigin:'AUTOMÁTICA',
    };
  });
  const ignitionReport=await getNightIgnitionReport(db,start,end);
  const ignitionRecords=(ignitionReport.rows||[]).filter((row)=>!justified.has(String(row.key||''))).map((row)=>{
    const intervalText=(row.intervals||[]).map((item)=>`${String(item.startedAt||'').slice(11,16)}–${item.active?'agora':String(item.endedAt||'').slice(11,16)} (${Math.round(Number(item.durationMinutes||0))} min)`).join('; ');
    const details=`Ignição desligada no período entre 20:00 e 05:00. Tempo total desligada: ${Math.round(Number(row.durationMinutes||0))} min em ${Number(row.intervalCount||0)} intervalo(s).${intervalText?` Intervalos: ${intervalText}.`:''}`;
    return {
      id:String(row.key||''),key:String(row.key||''),tipo:'IGNIÇÃO DESLIGADA 20H–05H · 3/4',type:'IGNICAO_DESLIGADA_20_05',prioridade:'ALTA',severity:'ALTA',responsavel:operationalMonitor(row.route||''),monitorResponsavel:operationalMonitor(row.route||''),status:'PENDENTE',origem:'gps',sheet:'gps',source_id:String(row.key||''),
      domain_id:null,schedule_record_id:String(row.scheduleId||''),data:String(row.date||''),rota:String(row.route||''),placa:String(row.plate||''),motorista:String(row.driver||''),carga:'',detalhes:details,description:details,
      related:{monitoringId:row.monitoringId||null,startedAt:row.startedAt||'',detectedAt:row.startedAt||'',lastSeenAt:row.lastSeenAt||'',location:row.location||'',stoppedMinutes:Number(row.durationMinutes||0),ignition:0,active:Boolean(row.active),endedAt:String(row.endedAt||''),intervalCount:Number(row.intervalCount||0),intervals:row.intervals||[]},
      canDelete:false,canJustify:true,occurrenceOrigin:'AUTOMÁTICA',
    };
  });
  records=[...records,...ignitionRecords];
  records.sort((a,b)=>(ORDER[a.prioridade]??9)-(ORDER[b.prioridade]??9)||String(b.data).localeCompare(String(a.data))||String(a.placa).localeCompare(String(b.placa)));
  const summary={total:records.length,critical:records.filter((row)=>row.prioridade==='CRÍTICA').length,high:records.filter((row)=>row.prioridade==='ALTA').length,medium:records.filter((row)=>row.prioridade==='MÉDIA').length,low:records.filter((row)=>row.prioridade==='BAIXA').length};
  return {versao:'1',start,end,date:explicitDate||'',records,items:records,summary,counts:summary,ignitionReport,generatedAt:new Date().toISOString(),occurrenceStartDate:OCCURRENCE_START_DATE,automaticRules:['PARADA_VAREJO_20_MIN','PARADA_REDE_60_MIN','IGNICAO_DESLIGADA_20_05_3_4']};
}


function occurrenceDurationMinutes(row={}){
  const stored=Math.max(0,Number(row.STOPPED_MINUTES||0));
  if(stored>0)return Math.round(stored);
  const parse=(value)=>{
    const raw=String(value||'').trim();
    if(!raw)return NaN;
    const ms=Date.parse(raw.includes('T')?raw:raw.replace(' ','T'));
    return Number.isFinite(ms)?ms:NaN;
  };
  const start=parse(row.STARTED_AT);
  const end=parse(row.LAST_SEEN_AT||row.DETECTED_AT);
  return Number.isFinite(start)&&Number.isFinite(end)&&end>=start?Math.max(0,Math.round((end-start)/60000)):0;
}
function occurrenceGroup(records,key,labelKey='label'){
  const map=new Map();
  for(const row of records||[]){
    const raw=typeof key==='function'?key(row):row?.[key];
    const label=String(raw||'NÃO INFORMADO').trim()||'NÃO INFORMADO';
    if(!map.has(label))map.set(label,[]);
    map.get(label).push(row);
  }
  return [...map.entries()].map(([label,items])=>{
    const retentionMinutes=items.reduce((sum,row)=>sum+Math.max(0,Number(row.retentionMinutes||0)),0);
    return {
      [labelKey]:label,
      occurrences:items.length,
      retentionMinutes,
      averageRetentionMinutes:items.length?Math.round(retentionMinutes/items.length):0,
      pendingJustification:items.filter((row)=>row.hasOccurrence!==false&&!row.justification).length,
      justified:items.filter((row)=>row.hasOccurrence!==false&&Boolean(row.justification)).length,
    };
  }).sort((a,b)=>b.retentionMinutes-a.retentionMinutes||b.occurrences-a.occurrences||String(a[labelKey]).localeCompare(String(b[labelKey]),'pt-BR'));
}
function monthLabel(monthKey=''){
  const match=String(monthKey).match(/^(\d{4})-(\d{2})$/);
  return match?`${match[2]}/${match[1]}`:String(monthKey||'NÃO INFORMADO');
}

export async function getOperationalOccurrenceIndicators(db,filters={}){
  const today=new Date().toISOString().slice(0,10);
  const requestedStart=dateIso(filters.start||filters.inicio)||OCCURRENCE_START_DATE;
  const end=dateIso(filters.end||filters.fim)||today;
  const start=requestedStart<OCCURRENCE_START_DATE?OCCURRENCE_START_DATE:requestedStart;
  if(end<OCCURRENCE_START_DATE)return {start,end,records:[],retentionRecords:[],summary:{occurrences:0,retentionEvents:0,retentionMinutes:0,averageRetentionMinutes:0,pendingJustification:0,justified:0,shortRetentions:0},byRoute:[],byDriver:[],byLocation:[],byJustification:[],byMonth:[]};
  await ensureOccurrenceSchema(db);
  const [occResult,retResult]=await Promise.all([
    db.prepare(`SELECT o.OCCURRENCE_KEY,o.TYPE,o.PRIORITY,o.DATE_KEY,o.PLATE,o.ROUTE,o.DRIVER_NAME,o.STARTED_AT,o.DETECTED_AT,o.LAST_SEEN_AT,o.LOCATION_TEXT,o.STOPPED_MINUTES,o.IGNITION,o.DETAILS,o.DATA_JSON,
        j.JUSTIFICATION,j.JUSTIFIED_BY_NAME,j.JUSTIFIED_AT
      FROM ROUTE_GPS_OCCURRENCES o
      LEFT JOIN ROUTE_OPERATIONAL_JUSTIFICATIONS j ON j.OCCURRENCE_KEY=o.OCCURRENCE_KEY
      WHERE o.DATE_KEY>=? AND o.DATE_KEY<=?
        AND o.TYPE<>'IGNICAO_DESLIGADA_20_05'
        AND NOT (o.TYPE IN ('PARADA_ACIMA_15_MIN','PARADA_ACIMA_20_MIN') AND COALESCE(o.STOPPED_MINUTES,0)<20)
      ORDER BY o.DATE_KEY,o.DETECTED_AT`).bind(start,end).all(),
    db.prepare(`SELECT r.RETENTION_KEY,r.DATE_KEY,r.PLATE,r.ROUTE,r.DRIVER_NAME,r.SCHEDULE_ID,r.MONITORING_ID,r.STARTED_AT,r.LAST_SEEN_AT,r.ENDED_AT,r.LOCATION_TEXT,r.DURATION_MINUTES,r.ACTIVE,
        o.OCCURRENCE_KEY,o.TYPE AS OCC_TYPE,j.JUSTIFICATION,j.JUSTIFIED_BY_NAME,j.JUSTIFIED_AT
      FROM ROUTE_GPS_RETENTIONS r
      LEFT JOIN ROUTE_GPS_OCCURRENCES o ON o.PLATE=r.PLATE AND o.STARTED_AT=r.STARTED_AT
        AND o.TYPE IN ('PARADA_ACIMA_15_MIN','PARADA_ACIMA_20_MIN') AND COALESCE(o.STOPPED_MINUTES,0)>=20
      LEFT JOIN ROUTE_OPERATIONAL_JUSTIFICATIONS j ON j.OCCURRENCE_KEY=o.OCCURRENCE_KEY
      WHERE r.DATE_KEY>=? AND r.DATE_KEY<=? AND COALESCE(r.DURATION_MINUTES,0)>=10
      ORDER BY r.DATE_KEY,r.STARTED_AT`).bind(start,end).all(),
  ]);
  const eligibleIgnitionPlates=await threeQuarterPlates(db);
  const labels={IGNICAO_DESLIGADA_20_05:'IGNIÇÃO DESLIGADA 20H–05H · 3/4'};
  let allRecords=(occResult.results||[]).filter((row)=>!internalNoTrip(row)).filter((row)=>String(row.TYPE||'')!=='IGNICAO_DESLIGADA_20_05'||eligibleIgnitionPlates.has(String(row.PLATE||'').toUpperCase().replace(/[^A-Z0-9]/g,''))).filter((row)=>!['PARADA_ACIMA_15_MIN','PARADA_ACIMA_20_MIN'].includes(String(row.TYPE||''))||Number(row.STOPPED_MINUTES||0)>=stopThresholdForRoute(row.ROUTE||'')).map((row)=>{
    const rawType=String(row.TYPE||'');
    const type=['PARADA_ACIMA_15_MIN','PARADA_ACIMA_20_MIN'].includes(rawType)?'PARADA_ACIMA_20_MIN':rawType;
    const justification=String(row.JUSTIFICATION||'').trim();
    const month=String(row.DATE_KEY||'').slice(0,7),week=isoWeekInfo(row.DATE_KEY||'');
    const meta=parseData(row.DATA_JSON)||{},justifiedAt=String(row.JUSTIFIED_AT||''),detectedAt=String(row.DETECTED_AT||'');
    return {
      key:String(row.OCCURRENCE_KEY||''),type,typeLabel:type==='PARADA_ACIMA_20_MIN'?stopTypeLabel(row.ROUTE||''):(labels[rawType]||String(rawType||'OCORRÊNCIA GPS').replaceAll('_',' ')),priority:String(row.PRIORITY||'MÉDIA'),
      date:String(row.DATE_KEY||''),week:week.key,weekLabel:week.label,month,monthLabel:monthLabel(month),plate:String(row.PLATE||''),route:String(row.ROUTE||''),driver:String(row.DRIVER_NAME||''),location:String(row.LOCATION_TEXT||'').trim()||'LOCAL NÃO INFORMADO',monitorResponsible:operationalMonitor(row.ROUTE||''),routeProfile:isNetworkRoute(row.ROUTE||'')?'REDE':'VAREJO',stopThresholdMinutes:type==='PARADA_ACIMA_20_MIN'?stopThresholdForRoute(row.ROUTE||''):null,
      retentionMinutes:occurrenceDurationMinutes(row),justification,justificationLabel:justification||'PENDENTE DE JUSTIFICATIVA',justifiedBy:String(row.JUSTIFIED_BY_NAME||''),justifiedAt,detectedAt,responseMinutes:justification?responseMinutes(detectedAt,justifiedAt):null,details:String(row.DETAILS||''),active:type==='PARADA_ACIMA_20_MIN'&&Boolean(meta.active),startedAt:String(row.STARTED_AT||''),
    };
  });
  const ignitionReportForIndicators=await getNightIgnitionReport(db,start,end);
  let justificationRows=[];
  try{justificationRows=(await db.prepare(`SELECT OCCURRENCE_KEY,JUSTIFICATION,JUSTIFIED_BY_NAME,JUSTIFIED_AT FROM ROUTE_OPERATIONAL_JUSTIFICATIONS`).all()).results||[];}catch{}
  const justificationMap=new Map(justificationRows.map((row)=>[String(row.OCCURRENCE_KEY||''),row]));
  const ignitionIndicatorRecords=(ignitionReportForIndicators.rows||[]).map((row)=>{
    const justificationRow=justificationMap.get(String(row.key||''))||{};
    const justification=String(justificationRow.JUSTIFICATION||'').trim();
    const month=String(row.date||'').slice(0,7);
    const intervalText=(row.intervals||[]).map((item)=>`${String(item.startedAt||'').slice(11,16)}–${item.active?'agora':String(item.endedAt||'').slice(11,16)} (${Math.round(Number(item.durationMinutes||0))} min)`).join('; ');
    return {
      key:String(row.key||''),type:'IGNICAO_DESLIGADA_20_05',typeLabel:'IGNIÇÃO DESLIGADA 20H–05H · 3/4',priority:'ALTA',date:String(row.date||''),week:isoWeekInfo(row.date||'').key,weekLabel:isoWeekInfo(row.date||'').label,month,monthLabel:monthLabel(month),plate:String(row.plate||''),route:String(row.route||''),driver:String(row.driver||''),location:String(row.location||'').trim()||'LOCAL NÃO INFORMADO',monitorResponsible:operationalMonitor(row.route||''),routeProfile:isNetworkRoute(row.route||'')?'REDE':'VAREJO',stopThresholdMinutes:null,
      retentionMinutes:Math.max(0,Number(row.durationMinutes||0)),justification,justificationLabel:justification||'PENDENTE DE JUSTIFICATIVA',justifiedBy:String(justificationRow.JUSTIFIED_BY_NAME||''),justifiedAt:String(justificationRow.JUSTIFIED_AT||''),detectedAt:String(row.startedAt||''),responseMinutes:justification?responseMinutes(row.startedAt||'',justificationRow.JUSTIFIED_AT||''):null,
      details:`Ignição noturna consolidada: ${Math.round(Number(row.durationMinutes||0))} min em ${Number(row.intervalCount||0)} intervalo(s).${intervalText?` ${intervalText}`:''}`,active:Boolean(row.active),startedAt:String(row.startedAt||''),intervalCount:Number(row.intervalCount||0),
    };
  });
  allRecords=[...allRecords,...ignitionIndicatorRecords];
  const allRetentions=(retResult.results||[]).filter((row)=>!internalNoTrip(row)).map((row)=>{
    const linkedOccurrence=Boolean(String(row.OCCURRENCE_KEY||'').trim());
    const hasOccurrence=linkedOccurrence&&Math.max(0,Math.round(Number(row.DURATION_MINUTES||0)))>=stopThresholdForRoute(row.ROUTE||'');
    const justification=hasOccurrence?String(row.JUSTIFICATION||'').trim():'';
    const month=String(row.DATE_KEY||'').slice(0,7);
    const duration=Math.max(0,Math.round(Number(row.DURATION_MINUTES||0)));
    return {
      key:String(row.RETENTION_KEY||''),occurrenceKey:String(row.OCCURRENCE_KEY||''),hasOccurrence,
      type:hasOccurrence?'PARADA_ACIMA_20_MIN':'RETENCAO_SEM_OCORRENCIA',typeLabel:hasOccurrence?stopTypeLabel(row.ROUTE||''):`RETENÇÃO ABAIXO DO LIMIAR (${stopThresholdForRoute(row.ROUTE||'')} MIN)`,priority:hasOccurrence?'MÉDIA':'INFORMATIVA',
      date:String(row.DATE_KEY||''),week:isoWeekInfo(row.DATE_KEY||'').key,weekLabel:isoWeekInfo(row.DATE_KEY||'').label,month,monthLabel:monthLabel(month),plate:String(row.PLATE||''),route:String(row.ROUTE||''),driver:String(row.DRIVER_NAME||''),location:String(row.LOCATION_TEXT||'').trim()||'LOCAL NÃO INFORMADO',monitorResponsible:operationalMonitor(row.ROUTE||''),routeProfile:isNetworkRoute(row.ROUTE||'')?'REDE':'VAREJO',stopThresholdMinutes:stopThresholdForRoute(row.ROUTE||''),
      retentionMinutes:duration,justification,justificationLabel:hasOccurrence?(justification||'PENDENTE DE JUSTIFICATIVA'):`SEM OCORRÊNCIA (< ${stopThresholdForRoute(row.ROUTE||'')} MIN)`,justifiedBy:String(row.JUSTIFIED_BY_NAME||''),justifiedAt:String(row.JUSTIFIED_AT||''),active:Number(row.ACTIVE||0)===1,startedAt:String(row.STARTED_AT||''),endedAt:String(row.ENDED_AT||''),
    };
  });
  // Preserva o histórico anterior à criação da tabela de retenções: ocorrências
  // de parada já existentes entram como retenção inferida quando não há sessão GPS
  // correspondente. Retenções de 10 a 19 min entram nos indicadores sem abrir ocorrência operacional.
  const retentionKeys=new Set(allRetentions.map((row)=>`${normalizeText(row.plate)}|${row.startedAt}`));
  for(const occurrence of allRecords){
    if(occurrence.type!=='PARADA_ACIMA_20_MIN'||Number(occurrence.retentionMinutes||0)<=0)continue;
    const lookup=`${normalizeText(occurrence.plate)}|${occurrence.startedAt}`;
    if(retentionKeys.has(lookup))continue;
    allRetentions.push({...occurrence,key:`LEGACY_RETENTION|${occurrence.key}`,occurrenceKey:occurrence.key,hasOccurrence:true,type:'PARADA_ACIMA_20_MIN',typeLabel:stopTypeLabel(occurrence.route||''),justificationLabel:occurrence.justification||'PENDENTE DE JUSTIFICATIVA',endedAt:'',active:false});
    retentionKeys.add(lookup);
  }

  const routeFilter=normalizeText(filters.route||filters.rota||'');
  const driverFilter=normalizeText(filters.driver||filters.motorista||'');
  const plateFilter=normalizeText(filters.plate||filters.placa||'');
  const query=normalizeText(filters.q||filters.busca||'');
  const accept=(row)=>{
    if(routeFilter&&normalizeText(row.route)!==routeFilter)return false;
    if(driverFilter&&normalizeText(row.driver)!==driverFilter)return false;
    if(plateFilter&&normalizeText(row.plate)!==plateFilter)return false;
    if(query&&!normalizeText([row.date,row.typeLabel,row.route,row.driver,row.plate,row.location,row.justification,row.justificationLabel,row.details].join(' ')).includes(query))return false;
    return true;
  };
  const records=allRecords.filter(accept);
  const retentionRecords=allRetentions.filter(accept);
  const retentionMinutes=retentionRecords.reduce((sum,row)=>sum+row.retentionMinutes,0);
  const summary={
    occurrences:records.length,
    retentionEvents:retentionRecords.length,
    retentionMinutes,
    averageRetentionMinutes:retentionRecords.length?Math.round(retentionMinutes/retentionRecords.length):0,
    pendingJustification:records.filter((row)=>!row.justification).length,
    justified:records.filter((row)=>Boolean(row.justification)).length,
    stops:records.filter((row)=>row.type==='PARADA_ACIMA_20_MIN').length,
    nightIgnitionOff:records.filter((row)=>row.type==='IGNICAO_DESLIGADA_20_05').length,
    shortRetentions:retentionRecords.filter((row)=>!row.hasOccurrence).length,
  };
  const justifiedResponse=records.map((row)=>row.responseMinutes).filter((value)=>Number.isFinite(Number(value))&&Number(value)>=0).map(Number);
  summary.averageJustificationResponseMinutes=justifiedResponse.length?Math.round(justifiedResponse.reduce((a,b)=>a+b,0)/justifiedResponse.length):null;
  summary.justificationResponseSamples=justifiedResponse.length;
  const byMonth=occurrenceGroup(retentionRecords,(row)=>row.month,'month').map((row)=>({...row,label:monthLabel(row.month)})).sort((a,b)=>String(a.month).localeCompare(String(b.month)));
  const quantityGroup=(rows,keyFn,labelFn)=>{const map=new Map();for(const row of rows){const key=keyFn(row);if(!key)continue;if(!map.has(key))map.set(key,[]);map.get(key).push(row);}return [...map.entries()].map(([key,items])=>{const response=items.map((r)=>r.responseMinutes).filter((v)=>Number.isFinite(Number(v))).map(Number);return {key,label:labelFn(key,items),occurrences:items.length,justified:items.filter((r)=>Boolean(r.justification)).length,pending:items.filter((r)=>!r.justification).length,averageJustificationResponseMinutes:response.length?Math.round(response.reduce((a,b)=>a+b,0)/response.length):null};}).sort((a,b)=>String(a.key).localeCompare(String(b.key)));};
  const byDay=quantityGroup(records,(row)=>row.date,(key)=>key);
  const byWeek=quantityGroup(records,(row)=>row.week,(key,items)=>items[0]?.weekLabel||key);
  const byOccurrenceMonth=quantityGroup(records,(row)=>row.month,(key)=>monthLabel(key));
  const auditHistory=[...records].sort((a,b)=>String(b.detectedAt||b.date).localeCompare(String(a.detectedAt||a.date))).map((row)=>({key:row.key,date:row.date,detectedAt:row.detectedAt||row.startedAt||'',type:row.type,typeLabel:row.typeLabel,route:row.route,plate:row.plate,driver:row.driver,monitorResponsible:row.monitorResponsible,justification:row.justification||'',justifiedBy:row.justifiedBy||'',justifiedAt:row.justifiedAt||'',responseMinutes:row.responseMinutes,status:row.justification?'JUSTIFICADA':'PENDENTE'}));
  let justificationHistory=[];try{const h=await db.prepare(`SELECT h.ID,h.OCCURRENCE_KEY,h.JUSTIFICATION,h.JUSTIFIED_BY_NAME,h.RECORDED_AT,h.ACTION,o.DATE_KEY,o.ROUTE,o.PLATE,o.DRIVER_NAME,o.TYPE FROM ROUTE_OPERATIONAL_JUSTIFICATION_HISTORY h LEFT JOIN ROUTE_GPS_OCCURRENCES o ON o.OCCURRENCE_KEY=h.OCCURRENCE_KEY WHERE COALESCE(o.DATE_KEY,substr(h.RECORDED_AT,1,10))>=? AND COALESCE(o.DATE_KEY,substr(h.RECORDED_AT,1,10))<=? ORDER BY h.RECORDED_AT DESC,h.ID DESC LIMIT 1000`).bind(start,end).all();justificationHistory=(h.results||[]).map((row)=>({id:row.ID,key:String(row.OCCURRENCE_KEY||''),date:String(row.DATE_KEY||String(row.RECORDED_AT||'').slice(0,10)),route:String(row.ROUTE||''),plate:String(row.PLATE||''),driver:String(row.DRIVER_NAME||''),type:String(row.TYPE||''),monitorResponsible:operationalMonitor(row.ROUTE||''),justification:String(row.JUSTIFICATION||''),justifiedBy:String(row.JUSTIFIED_BY_NAME||''),recordedAt:String(row.RECORDED_AT||''),action:String(row.ACTION||'REGISTRO')}));}catch{}
  return {
    start,end,records,retentionRecords,summary,byDay,byWeek,byOccurrenceMonth,auditHistory,justificationHistory,
    byRoute:occurrenceGroup(retentionRecords,(row)=>row.route||'ROTA NÃO INFORMADA'),
    byDriver:occurrenceGroup(retentionRecords,(row)=>row.driver||'MOTORISTA NÃO INFORMADO'),
    byLocation:occurrenceGroup(retentionRecords,(row)=>row.location||'LOCAL NÃO INFORMADO'),
    byJustification:occurrenceGroup(retentionRecords,(row)=>row.justificationLabel||'SEM CLASSIFICAÇÃO'),
    byMonth,
    calculationNote:'Ocorrências de parada são abertas a partir de 20 minutos nas rotas de varejo e 60 minutos nas rotas de Rede. O tempo de retenção dos indicadores considera imobilizações GPS a partir de 10 minutos durante rotas ativas, mesmo antes do limiar de ocorrência. Ignição noturna é monitorada somente para veículos 3/4. Registros considerados a partir de 21/08/2026.',
  };
}


export async function justifyOperationalOccurrence(db,user,payload={}){
  const key=String(payload.key||payload.id||'').trim();
  const justification=String(payload.justification||payload.justificativa||'').trim();
  if(!key)throw new Error('Ocorrência não informada.');
  if(justification.length<8)throw new Error('Informe uma justificativa com pelo menos 8 caracteres.');
  await ensureOccurrenceSchema(db);
  const existing=await db.prepare(`SELECT JUSTIFICATION,JUSTIFIED_AT FROM ROUTE_OPERATIONAL_JUSTIFICATIONS WHERE OCCURRENCE_KEY=?`).bind(key).first().catch(()=>null);
  const actor=user?.name||user?.email||'Usuário',recordedAt=recifeTimestamp(),action=existing?'ALTERAÇÃO':'PRIMEIRO REGISTRO';
  await db.prepare(`INSERT INTO ROUTE_OPERATIONAL_JUSTIFICATIONS
    (OCCURRENCE_KEY,JUSTIFICATION,JUSTIFIED_BY_ID,JUSTIFIED_BY_NAME,JUSTIFIED_AT,UPDATED_AT)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(OCCURRENCE_KEY) DO UPDATE SET JUSTIFICATION=excluded.JUSTIFICATION,
      JUSTIFIED_BY_ID=excluded.JUSTIFIED_BY_ID,JUSTIFIED_BY_NAME=excluded.JUSTIFIED_BY_NAME,
      UPDATED_AT=excluded.UPDATED_AT`)
    .bind(key,justification,user?.id||null,actor,existing?.JUSTIFIED_AT||recordedAt,recordedAt).run();
  await db.prepare(`INSERT INTO ROUTE_OPERATIONAL_JUSTIFICATION_HISTORY (OCCURRENCE_KEY,JUSTIFICATION,JUSTIFIED_BY_ID,JUSTIFIED_BY_NAME,RECORDED_AT,ACTION) VALUES (?,?,?,?,?,?)`).bind(key,justification,user?.id||null,actor,recordedAt,action).run();
  await audit(db,user,'JUSTIFICAR_OCORRENCIA','operational_pending',0,{key,justificativa:justification,acao:action,primeira_justificativa_em:existing?.JUSTIFIED_AT||recordedAt});
  return {key,justification,recordedAt,firstJustifiedAt:existing?.JUSTIFIED_AT||recordedAt,action};
}

export async function deleteOperationalPendingRecord(db, user, payload = {}, storage = null) {
  if (normalizeText(payload.confirmation) !== 'EXCLUIR') throw new Error('Digite EXCLUIR para confirmar.');
  const justification = String(payload.justification || payload.justificativa || '').trim();
  if (justification.length < 8) throw new Error('Informe uma justificativa com pelo menos 8 caracteres.');
  const source = String(payload.origem || payload.sheet || '').trim();
  const id = Number(payload.domain_id || payload.source_id || payload.id || 0);
  let removed = { main: 0, related: 0 };

  if (source === 'schedule') {
    const result = await deleteSchedule(db, user, payload.schedule_record_id || payload.source_id, storage, 'EXCLUIR');
    removed = { main: 1, related: Number(result.deletedRelated || 0) };
  } else if (['departures', 'monitoring', 'returns'].includes(source)) {
    const record = await getDomainRow(db, source, id);
    if (!record) throw new Error('Registro não encontrado. Atualize a auditoria.');
    await deleteDomainRow(db, source, id, user);
    removed.main = 1;
    await audit(db, user, 'EXCLUIR_DIVERGENCIA', 'operational_pending', id, { origem: source, justificativa: justification, before: record });
  } else if (source === 'daily_status') {
    const result = await db.prepare('DELETE FROM STATUS_DIARIO WHERE ID=?').bind(String(payload.source_id || payload.id || '')).run();
    removed.main = Number(result.meta?.changes || 0);
    if (!removed.main) throw new Error('Registro não encontrado. Atualize a auditoria.');
    await audit(db, user, 'EXCLUIR_DIVERGENCIA', 'operational_pending', id, { origem: source, justificativa: justification });
  } else {
    throw new Error('Origem não permitida para exclusão.');
  }
  return removed;
}
