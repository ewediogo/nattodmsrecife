import { createAvailabilityAfterReturn, ensureAvailabilitySchema } from './availability.js';
import { audit } from './core.js';
import { findScheduleRecordInternal } from './schedule.js';
import {
  clean,
  addDays,
  dateIso,
  diffMinutes,
  emitResourceStatus,
  getDomainRow,
  intValue,
  listDomainRows,
  localDateTime,
  normalizeText,
  numberValue,
  resolveSchedule,
  schedulesFor,
  safeUpdateScheduleStatus,
  upsertDomainRow,
  deleteDomainRow,
  findDomainBySchedule,
} from './route-phase1.js';
import { isOperationallyExcludedTrip } from './operational-exclusions.js';
import { enrichRowsWithLincrosCache } from './lincros.js';
import { loadGpsFacilityAnchors, positionInsideFacilityAnchors } from './gps-geofence.js';

const RETURN_ORIGINS = new Set(['MONITORAMENTO', 'PORTARIA', 'SANKHYA', 'MANUAL', 'GPS', 'APP']);

const DEFAULT_RETURN_FACILITY_NAMES = Object.freeze([
  'NOTARO ALIMENTOS LTDA. - RECIFE/PE',
  'NOTARO ALIMENTOS - RECIFE/PE',
]);
const DEFAULT_RETURN_FACILITY_RADIUS_METERS = 120;
function normalizeFacility(value){return normalizeText(value).replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function facilityTokens(name){return normalizeFacility(name).split(' ').filter((token)=>token.length>=4&&!['ALIMENTOS'].includes(token));}
function textMatchesFacility(value,facilityName){const normalized=normalizeFacility(value);if(!normalized)return false;const tokens=facilityTokens(facilityName);return tokens.length?tokens.every((token)=>normalized.includes(token)):normalized.includes('NOTARO');}
function gpsPositionInsideFacility(position,facilityNames=[],radiusMeters=DEFAULT_RETURN_FACILITY_RADIUS_METERS){
  const names=(Array.isArray(facilityNames)?facilityNames:[facilityNames]).filter(Boolean);
  const point=String(position?.point||position?.raw?.PONTO||position?.raw?.PONTO_PROXIMO||'');
  const location=String(position?.location||position?.raw?.LOCALIZACAO||position?.raw?.LOCALIZAÇÃO||'');
  const matched=names.some((facilityName)=>textMatchesFacility(point,facilityName)||textMatchesFacility(location,facilityName));
  if(!matched)return false;
  const distance=Number(position?.distanceToPoint);
  return !Number.isFinite(distance)||distance<=Number(radiusMeters||DEFAULT_RETURN_FACILITY_RADIUS_METERS);
}
async function outsideFacilitySeenAfterDeparture(db,plate,departureAt,facilityNames=[],facilityAnchors=[],radiusMeters=DEFAULT_RETURN_FACILITY_RADIUS_METERS){
  try{
    const {results=[]}=await db.prepare(`SELECT GPS_TIME,POINT_TEXT,LOCATION_TEXT,LATITUDE,LONGITUDE,RAW_JSON FROM ROUTE_GPS_POSITIONS WHERE PLATE=? AND GPS_TIME>=? ORDER BY GPS_TIME ASC LIMIT 2000`).bind(clean(plate,30).toUpperCase(),String(departureAt||'')).all();
    return (results||[]).some((row)=>{
      let raw={};try{raw=JSON.parse(row.RAW_JSON||'{}');}catch{}
      if(positionInsideFacilityAnchors({latitude:row.LATITUDE,longitude:row.LONGITUDE},facilityAnchors,radiusMeters))return false;
      const point=String(row.POINT_TEXT||raw?.PONTO||raw?.PONTO_PROXIMO||'');
      const location=String(row.LOCATION_TEXT||raw?.LOCALIZACAO||raw?.LOCALIZAÇÃO||'');
      if(point||location)return !facilityNames.some((facilityName)=>textMatchesFacility(point,facilityName)||textMatchesFacility(location,facilityName));
      return Number.isFinite(Number(row.LATITUDE))&&Number.isFinite(Number(row.LONGITUDE))&&facilityAnchors.length>0;
    });
  }catch{return false;}
}

function integerMetric(value, label, fallback = 0) {
  const source = value === '' || value === null || value === undefined ? fallback : value;
  const parsed = Number(source || 0);
  if (!Number.isFinite(parsed) || parsed < 0 || Math.floor(parsed) !== parsed) {
    throw new Error(`${label} deve ser um número inteiro igual ou maior que zero.`);
  }
  return parsed;
}


function booleanAnswer(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = normalizeText(value);
  if (['SIM','S','TRUE','1','YES'].includes(normalized)) return true;
  if (['NAO','N','FALSE','0','NO'].includes(normalized)) return false;
  return fallback;
}

function conditionalIntegerMetric(answer, value, label, fallback = 0) {
  const yesNo = booleanAnswer(answer, fallback > 0);
  if (yesNo === false) return 0;
  const parsed = integerMetric(value, label, fallback);
  if (yesNo === true && parsed < 1) throw new Error(`${label} deve ser informado quando a resposta for Sim.`);
  return parsed;
}

function automaticAuditActor(value='') {
  return /AUTOMACAO|SISTEMA|GPS|PROTECTSAT|NATTO ENTREGAS|SERVICE|INTEGRACAO/.test(normalizeText(value));
}
function auditTimestampIso(value='') {
  const raw=String(value||'').trim();if(!raw)return '';
  if(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw))return raw.replace(' ','T');
  if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw))return `${raw.replace(' ','T').slice(0,19)}Z`;
  return raw;
}
async function enrichReturnEditAudit(db,rows=[]) {
  const ids=[...new Set((rows||[]).map((row)=>Number(row.id||0)).filter((id)=>id>0))];
  if(!ids.length)return rows||[];
  const human=new Map(),automatic=new Map(),creatorName=new Map();
  const gpsOriginIds=new Set((rows||[]).filter((row)=>normalizeText(row.origem||row.origem_retorno||'')==='GPS'||/RETORNO AUTOM[ÁA]TICO/i.test(String(row.observacoes||''))).map((row)=>Number(row.id||0)));
  for(let start=0;start<ids.length;start+=200){
    const chunk=ids.slice(start,start+200),placeholders=chunk.map(()=>'?').join(',');
    let result;
    try{result=await db.prepare(`SELECT ID,RECORD_ID,USER_ID,USER_NAME,ACTION,CREATED_AT FROM ROUTE_AUDIT WHERE MODULE='returns' AND RECORD_ID IN (${placeholders}) ORDER BY ID DESC`).bind(...chunk).all();}
    catch{return rows||[];}
    const oldestAuditId=new Map();for(const auditRow of result.results||[]){const id=Number(auditRow.RECORD_ID||0);if(!id)continue;const current=oldestAuditId.get(id);if(current===undefined||Number(auditRow.ID)<current){oldestAuditId.set(id,Number(auditRow.ID));creatorName.set(id,clean(auditRow.USER_NAME||'',180));}}
    for(const auditRow of result.results||[]){
      const id=Number(auditRow.RECORD_ID||0);if(!id)continue;
      // Retornos antigos criados pela automação com o usuário logado: a criação (1ª auditoria) é automática.
      const createdByGpsAutomation=gpsOriginIds.has(id)&&Number(auditRow.ID)===oldestAuditId.get(id);
      const actor=createdByGpsAutomation?'AUTOMAÇÃO GPS':clean(auditRow.USER_NAME||'',180),isAutomatic=createdByGpsAutomation||!Number(auditRow.USER_ID||0)||automaticAuditActor(actor);
      const target=isAutomatic?automatic:human;if(target.has(id))continue;
      target.set(id,{actor,at:auditTimestampIso(auditRow.CREATED_AT),source:isAutomatic?(normalizeText(actor).includes('GPS')?'GPS':'SISTEMA'):'EDIÇÃO MANUAL'});
    }
  }
  return (rows||[]).map((row)=>{
    const id=Number(row.id||0),manual=human.get(id),auto=automatic.get(id);
    const storedManual=clean(row.ultima_edicao_por||'',180),storedManualValid=storedManual&&!automaticAuditActor(storedManual)&&!(gpsOriginIds.has(id)&&normalizeText(storedManual)===normalizeText(creatorName.get(id)||'')&&!manual);
    // Retorno criado pela automação GPS com o usuário logado (versões antigas): sem edição manual posterior,
    // a autoria exibida é a da automação, nunca a de uma pessoa.
    const fromGpsCreator=(name)=>gpsOriginIds.has(id)&&!manual&&Boolean(name)&&normalizeText(name)===normalizeText(creatorName.get(id)||'');
    const relabel=(fromGpsCreator(row.ultima_alteracao_por)||fromGpsCreator(row.updatedByName)||fromGpsCreator(row.ultima_atualizacao_automatica_por))?{ultima_alteracao_por:'AUTOMAÇÃO GPS',ultima_alteracao_tipo:'AUTOMATICA',updatedByName:'AUTOMAÇÃO GPS'}:{};
    const automaticActorFixed=fromGpsCreator(row.ultima_atualizacao_automatica_por)?'AUTOMAÇÃO GPS':row.ultima_atualizacao_automatica_por;
    return {
      ...row,
      ...relabel,
      ultima_edicao_por:storedManualValid?storedManual:(manual?.actor||''),
      ultima_edicao_em:storedManualValid?(row.ultima_edicao_em||''):(manual?.at||''),
      ultima_atualizacao_automatica_por:automaticActorFixed||(auto?.actor||''),
      ultima_atualizacao_automatica_em:row.ultima_atualizacao_automatica_em||(auto?.at||''),
      ultima_atualizacao_automatica_origem:row.ultima_atualizacao_automatica_origem||(auto?.source||''),
    };
  });
}

export async function listReturns(db, user, filters = {}) {
  const rows=await listDomainRows(db, 'returns', { ...filters, limit: Math.min(Number(filters.limit || 3000), 5000) });
  return enrichReturnEditAudit(db,rows);
}

function returnScheduleAliases(row = {}) {
  return [row.id,row.sourceKey,row.legado_id,row.escala_id,row.escala_id_legado]
    .filter((value)=>value!==null&&value!==undefined&&String(value)!=='')
    .map((value)=>String(value));
}
function returnDomainAliases(row = {}) {
  return [row.schedule_record_id,row.schedule_id,row.escala_id,row.escala_id_legado,row.legado_id]
    .filter((value)=>value!==null&&value!==undefined&&String(value)!=='')
    .map((value)=>String(value));
}
function buildReturnDomainIndex(rows = []) {
  const map=new Map();
  for(const row of rows||[]) for(const key of returnDomainAliases(row)) if(!map.has(key)) map.set(key,row);
  return map;
}
function matchReturnDomain(index,schedule){
  for(const key of returnScheduleAliases(schedule)) if(index.has(key)) return index.get(key);
  return null;
}
function normalizedOperationalRoute(value=''){
  return normalizeText(value).replace(/\bSTR\b/g,'SRT').replace(/^(?:AG1|AG2|AL|PB|SRT)\s+/,'').replace(/\s+/g,' ').trim();
}
function operationalTripBaseKey(row={}){
  const day=dateIso(row.data||row.saida_real||row.hora_real||row.retorno_real||row.return_at);
  const plate=normalizeText(row.placa);
  const route=normalizedOperationalRoute(row.rota||row.destino);
  return day&&plate&&route?`${day}|${plate}|${route}`:'';
}
function normalizedLoadKey(row={}){
  return normalizeText(row.ocs||row.carga||'').replace(/[^A-Z0-9]+/g,'');
}
function normalizedSequenceKey(row={}){
  return normalizeText(row.sequencia||row.sequencia_carregamento||row.ordem_carregamento||'');
}
function scheduleStorageKey(row={}){
  return normalizeText(row.schedule_storage||row.storage||'');
}
function operationalTripMatches(row={},schedule={}){
  if(!row||!schedule)return false;
  const rowAliases=new Set(returnDomainAliases(row));
  const scheduleAliases=returnScheduleAliases(schedule);
  const aliasMatched=scheduleAliases.some((id)=>rowAliases.has(id));
  if(aliasMatched){
    // IDs numéricos podem existir simultaneamente em ROUTE_RECORDS e ESCALAS_DIA.
    // Quando os dois lados conhecem a origem, não aceite um ID igual vindo de stores diferentes.
    const rowStorage=scheduleStorageKey(row), scheduleStorage=scheduleStorageKey(schedule);
    if(rowStorage&&scheduleStorage&&rowStorage!==scheduleStorage)return false;
    return true;
  }

  // Compatibilidade para registros migrados cujo SCHEDULE_ID mudou: o fallback
  // precisa identificar a MESMA viagem, não apenas "mesma rota no mesmo dia".
  // Data + placa + rota são obrigatórios; sequência/carga, quando presentes nos
  // dois lados, funcionam como desempate e não podem se contradizer.
  if(operationalTripBaseKey(row)!==operationalTripBaseKey(schedule))return false;
  const rowSeq=normalizedSequenceKey(row), scheduleSeq=normalizedSequenceKey(schedule);
  if(rowSeq&&scheduleSeq&&rowSeq!==scheduleSeq)return false;
  const rowLoad=normalizedLoadKey(row), scheduleLoad=normalizedLoadKey(schedule);
  if(rowLoad&&scheduleLoad&&rowLoad!==scheduleLoad)return false;
  return true;
}
function buildConfirmedReturnTripIndex(rows=[]){
  const map=new Map();
  for(const row of rows||[]){
    const key=operationalTripBaseKey(row);
    if(!key)continue;
    const bucket=map.get(key)||[];
    bucket.push(row);
    map.set(key,bucket);
  }
  return map;
}
function hasConfirmedReturnForSchedule(index,schedule){
  const key=operationalTripBaseKey(schedule);
  if(!key)return false;
  return (index.get(key)||[]).some((row)=>operationalTripMatches(row,schedule));
}
async function findReturnOperationalBySchedule(db,module,schedule){
  if(!schedule)return null;
  // Structured SCHEDULE_ID may contain either the current schedule ID or a legacy alias.
  for(const alias of returnScheduleAliases(schedule)){
    const direct=await findDomainBySchedule(db,module,alias).catch(()=>null);
    if(direct)return direct;
  }
  // Last-resort compatibility for migrated rows whose structured ID and JSON differ.
  const day=dateIso(schedule.data);
  const rows=await listDomainRows(db,module,{start:day?addDays(day,-2):'',end:day?addDays(day,2):'',limit:10000});
  const scheduleIds=new Set(returnScheduleAliases(schedule));
  return (rows||[]).find((row)=>{
    if(returnDomainAliases(row).some((id)=>scheduleIds.has(id)))return true;
    if(day&&dateIso(row.data)!==day)return false;
    const samePlate=normalizeText(row.placa)&&normalizeText(row.placa)===normalizeText(schedule.placa);
    const sameRoute=normalizeText(row.rota)&&normalizeText(row.rota)===normalizeText(schedule.rota);
    return samePlate&&sameRoute;
  })||null;
}

function matchLoadedOperational(rows=[],schedule){
  if(!schedule)return null;
  // v1.0.2 ainda aceitava score 50 = mesma data (30) + mesma rota (20).
  // Em dias com várias AG1 CARUARU isso fazia o Retorno de OUTRA placa ser
  // tratado como se fosse desta viagem, gerando o falso "já possui retorno".
  // A partir daqui o fallback só aceita identidade operacional forte.
  const matches=(rows||[]).filter((row)=>operationalTripMatches(row,schedule));
  matches.sort((a,b)=>Number(b?.id||0)-Number(a?.id||0));
  return matches[0]||null;
}
async function resolveScheduleForReturn(db,user,source={}){
  const wanted=clean(source.schedule_record_id||source.schedule_id||source.escala_id||source.escala_id_legado||source.legado_id||'',120);
  const preferred=normalizeText(source.storage||source.schedule_storage||'');
  const unique=[];
  const add=(row)=>{if(row&&!unique.some((x)=>String(x.id)===String(row.id)&&normalizeText(x.storage)===normalizeText(row.storage)))unique.push(row);};
  if(wanted){
    const stores=preferred==='ESCALAS_DIA'?['ESCALAS_DIA','ROUTE_RECORDS']
      :preferred==='ROUTE_RECORDS'?['ROUTE_RECORDS','ESCALAS_DIA']
      :['ROUTE_RECORDS','ESCALAS_DIA'];
    for(const storage of stores)add(await findScheduleRecordInternal(db,wanted,storage).catch(()=>null));
    if(unique.length){
      unique.sort((a,b)=>{
        const score=(row)=>{
          let value=0;
          if(dateIso(row.data)&&dateIso(row.data)===dateIso(source.data))value+=30;
          if(normalizeText(row.placa)&&normalizeText(row.placa)===normalizeText(source.placa))value+=30;
          if(normalizeText(row.rota)&&normalizeText(row.rota)===normalizeText(source.rota))value+=25;
          if(normalizeText(row.motorista)&&normalizeText(row.motorista)===normalizeText(source.motorista))value+=8;
          const a=normalizeText(row.ocs||row.carga).replace(/[^A-Z0-9]+/g,'');
          const b=normalizeText(source.ocs||source.carga).replace(/[^A-Z0-9]+/g,'');
          if(a&&b&&a===b)value+=20;
          return value;
        };
        return score(b)-score(a);
      });
      return unique[0];
    }
  }
  // Fallback operacional deliberadamente limitado ao dia (ou +-1 dia). Nunca
  // varre o histórico completo durante POST/PUT de Retornos.
  const day=dateIso(source.data||source.dateKey||source.retorno_real);
  if(!day)return null;
  return resolveSchedule(db,user,source).catch(()=>null);
}

async function findOperationalFast(db,module,schedule){
  if(!schedule)return null;
  const aliases=[...new Set(returnScheduleAliases(schedule))];
  if(aliases.length){
    const direct=(await Promise.all(aliases.map((alias)=>findDomainBySchedule(db,module,alias).catch(()=>null)))).filter(Boolean);
    if(direct.length)return matchLoadedOperational(direct,schedule)||direct[0];
  }
  // Fallback pequeno e indexado apenas no dia da escala. O caminho anterior
  // carregava até 1.200 linhas de cada domínio (3.600 JSONs) em todo POST.
  const day=dateIso(schedule.data);
  if(!day)return null;
  const rows=await listDomainRows(db,module,{date:day,limit:250});
  return matchLoadedOperational(rows,schedule);
}

async function loadReturnOperationalContext(db,schedule){
  const [departure,monitoring,existing]=await Promise.all([
    findOperationalFast(db,'departures',schedule),
    findOperationalFast(db,'monitoring',schedule),
    findOperationalFast(db,'returns',schedule),
  ]);
  return {departure,monitoring,existing};
}
const RETURNABLE_MONITORING_STATUSES=new Set(['EM ROTA','EM_ROTA','PERNOITE','RETORNO PREVISTO','RETORNO_PREVISTO']);
function monitoringAwaitsReturn(row={}){
  const status=normalizeText(row.status_monitoramento||row.status);
  return Boolean(row.id&&normalizeText(row.placa)&&normalizeText(row.rota)&&RETURNABLE_MONITORING_STATUSES.has(status));
}
function syntheticScheduleFromMonitoring(monitoring={}){
  const scheduleId=clean(monitoring.schedule_record_id||monitoring.schedule_id||monitoring.escala_id||'',120)||`MONITORING:${Number(monitoring.id)}`;
  return {
    ...monitoring,
    id:scheduleId,
    storage:'ROUTE_MONITORING',
    data:dateIso(monitoring.data||monitoring.dateKey),
    status:'EM ROTA',
    syntheticReturnSnapshot:true,
    orphanMonitoring:true,
    monitoring_id:Number(monitoring.id),
  };
}
function departureSnapshotFromMonitoring(monitoring={},departure=null){
  const scheduleId=clean(monitoring.schedule_record_id||monitoring.schedule_id||monitoring.escala_id||'',120)||`MONITORING:${Number(monitoring.id)}`;
  return {
    ...monitoring,
    ...(departure||{}),
    id:departure?.id||monitoring.departure_id||null,
    schedule_record_id:scheduleId,
    schedule_id:scheduleId,
    data:dateIso(departure?.data||monitoring.data||monitoring.dateKey),
    status:'SAIU',
    status_saida:'SAIU',
    hora_real:departure?.hora_real||departure?.saida_real||monitoring.hora_real||monitoring.saida_real||'',
    saida_real:departure?.saida_real||departure?.hora_real||monitoring.saida_real||monitoring.hora_real||'',
  };
}
function buildReturnCandidatesFromLoaded({schedules=[],departures=[],monitorings=[],returns=[]},filters={}) {
  const depBySchedule=buildReturnDomainIndex(departures);
  const monBySchedule=buildReturnDomainIndex(monitorings);
  const retBySchedule=buildReturnDomainIndex(returns);
  // Retornos migrados/históricos nem sempre conservam o mesmo SCHEDULE_ID da
  // escala atual. O POST já conseguia reconhecê-los pelo contexto operacional
  // (dia + placa + rota), mas a lista de candidatos usava apenas aliases de ID.
  // Isso fazia uma rota já finalizada reaparecer e, ao clicar em Registrar,
  // o backend corretamente responder "já possui retorno confirmado".
  // Mantemos o lookup por ID como primeira opção e acrescentamos o fingerprint
  // estável da viagem somente para esconder retornos efetivamente confirmados.
  const confirmedTrips=buildConfirmedReturnTripIndex(returns);
  const query=normalizeText(filters.q||filters.busca||'');
  const scheduled=(schedules||[])
    .filter((schedule)=>{
      if(isOperationallyExcludedTrip(schedule))return false;
      const departure=matchReturnDomain(depBySchedule,schedule);
      if(!departure||normalizeText(departure.status)!=='SAIU'||!departure.hora_real)return false;
      if(matchReturnDomain(retBySchedule,schedule)||hasConfirmedReturnForSchedule(confirmedTrips,schedule)||normalizeText(schedule.status)==='CANCELADO')return false;
      return !query||normalizeText([schedule.sequencia,schedule.ocs,schedule.placa,schedule.rota,schedule.regiao,schedule.motorista,schedule.ajudante_1,schedule.ajudante_2].join(' ')).includes(query);
    })
    .map((schedule)=>({schedule,departure:matchReturnDomain(depBySchedule,schedule)||null,monitoring:matchReturnDomain(monBySchedule,schedule)||matchLoadedOperational(monitorings,schedule)||null}));

  // Bases migradas podem conservar uma viagem aberta somente em ROUTE_MONITORING.
  // Ela precisa continuar visível em Retornos para que o operador consiga encerrá-la,
  // mesmo quando a Escala/Saída original foi removida ou perdeu o vínculo de ID.
  const representedMonitoringIds=new Set(scheduled.map((item)=>Number(item.monitoring?.id||0)).filter(Boolean));
  const representedTrips=new Set(scheduled.map((item)=>operationalTripBaseKey(item.schedule)).filter(Boolean));
  const orphaned=(monitorings||[]).filter((monitoring)=>{
    if(!monitoringAwaitsReturn(monitoring)||isOperationallyExcludedTrip(monitoring))return false;
    if(representedMonitoringIds.has(Number(monitoring.id)))return false;
    const tripKey=operationalTripBaseKey(monitoring);if(tripKey&&representedTrips.has(tripKey))return false;
    if(matchReturnDomain(retBySchedule,monitoring)||hasConfirmedReturnForSchedule(confirmedTrips,monitoring))return false;
    return !query||normalizeText([monitoring.sequencia,monitoring.ocs,monitoring.placa,monitoring.rota,monitoring.regiao,monitoring.motorista,monitoring.ajudante_1,monitoring.ajudante_2].join(' ')).includes(query);
  }).map((monitoring)=>{
    const schedule=syntheticScheduleFromMonitoring(monitoring);
    const departure=matchLoadedOperational(departures,monitoring)||null;
    return {schedule,departure:departureSnapshotFromMonitoring(monitoring,departure),monitoring,orphanMonitoring:true};
  });
  return [...scheduled,...orphaned]
    .sort((a,b)=>String(a.departure?.saida_real||a.departure?.hora_real||a.schedule.data||'').localeCompare(String(b.departure?.saida_real||b.departure?.hora_real||b.schedule.data||''))||Number(a.schedule.sequencia||999999)-Number(b.schedule.sequencia||999999));
}

export function calendarDaysCovered(startAt='',finishAt=''){
  const start=dateIso(startAt),finish=dateIso(finishAt);
  if(!start&&!finish)return 0;if(!start||!finish)return 1;if(finish<start)return 0;
  let cursor=start,count=1;for(let guard=0;cursor<finish&&guard<399;guard+=1){cursor=addDays(cursor,1);count+=1;}return count;
}

function enrichReturnHistoryFromLoaded(returns=[],schedules=[],departures=[],monitorings=[]){
  const depBySchedule=buildReturnDomainIndex(departures);
  const monBySchedule=buildReturnDomainIndex(monitorings);
  return (returns||[]).map((record)=>{
    const schedule=(schedules||[]).find((item)=>operationalTripMatches(record,item))||null;
    const departure=schedule?(matchReturnDomain(depBySchedule,schedule)||matchLoadedOperational(departures,schedule)):matchLoadedOperational(departures,record);
    const monitoring=schedule?(matchReturnDomain(monBySchedule,schedule)||matchLoadedOperational(monitorings,schedule)):matchLoadedOperational(monitorings,record);
    const source=schedule||monitoring||departure||{};
    const tripDate=dateIso(record.data||source.data||record.retorno_real);
    const departureAt=localDateTime(departure?.data||tripDate,record.saida_real||record.hora_real||departure?.saida_real||departure?.hora_real);
    const returnAt=localDateTime(record.data||tripDate,record.retorno_real||record.return_at);
    const routeMinutes=Number(record.tempo_rota_min);
    const canonicalScheduleId=clean(record.schedule_record_id||record.schedule_id||record.escala_id||schedule?.id||monitoring?.schedule_record_id||monitoring?.schedule_id||departure?.schedule_record_id||departure?.schedule_id||'',120);
    return {
      ...record,
      data:tripDate,
      schedule_record_id:canonicalScheduleId,
      schedule_id:canonicalScheduleId,
      schedule_storage:record.schedule_storage||schedule?.storage||'',
      departure_id:record.departure_id||departure?.id||'',
      monitoring_id:record.monitoring_id||monitoring?.id||'',
      return_id:record.return_id||record.id||'',
      sequencia:record.sequencia||source.sequencia||source.sequencia_carregamento||'',
      ocs:record.ocs||record.carga||source.ocs||source.carga||'',
      regiao:record.regiao||source.regiao||'',
      rota:record.rota||source.rota||'',
      destino:record.destino||record.cidade_destino||source.destino||source.cidade_destino||source.cidade||'',
      placa:record.placa||source.placa||'',
      motorista:record.motorista||source.motorista||'',
      motorista_id:record.motorista_id||source.motorista_id||'',
      ajudante_1:record.ajudante_1||source.ajudante_1||'',
      ajudante_1_id:record.ajudante_1_id||source.ajudante_1_id||'',
      ajudante_2:record.ajudante_2||source.ajudante_2||'',
      ajudante_2_id:record.ajudante_2_id||source.ajudante_2_id||'',
      saida_real:departureAt||record.saida_real||record.hora_real||departure?.saida_real||departure?.hora_real||'',
      hora_real:departureAt||record.hora_real||record.saida_real||departure?.hora_real||departure?.saida_real||'',
      tempo_rota_min:Number.isFinite(routeMinutes)&&routeMinutes>0?routeMinutes:Math.max(0,diffMinutes(departureAt,returnAt)||0),
      dias_cobertos:calendarDaysCovered(departureAt||record.data,returnAt||record.data),
      qtd_entregas:record.qtd_entregas ?? source.qtd_entregas ?? 0,
      historical_enriched:Boolean(schedule||departure||monitoring),
    };
  });
}

function syntheticConfirmedHistoryRecord(source={},departure=null,monitoring=null,origin='HISTORICO_CONSOLIDADO'){
  const tripDate=dateIso(source.data||departure?.data||monitoring?.data||source.saida_real||source.hora_real||source.retorno_real||monitoring?.retorno_real);
  const returnRaw=source.retorno_real||source.return_at||monitoring?.retorno_real||monitoring?.return_at||'';
  const returnAt=localDateTime(tripDate,returnRaw);if(!tripDate||!returnAt)return null;
  const departureAt=localDateTime(departure?.data||tripDate,departure?.saida_real||departure?.hora_real||source.saida_real||source.hora_real||monitoring?.saida_real||monitoring?.hora_real);
  if(departureAt&&diffMinutes(departureAt,returnAt)<0)return null;
  const base={...source,...(monitoring||{}),...(departure||{})};
  const scheduleId=clean(source.id||source.schedule_record_id||source.schedule_id||monitoring?.schedule_record_id||monitoring?.schedule_id||departure?.schedule_record_id||departure?.schedule_id||'',120);
  return {
    ...base,id:0,return_id:0,synthetic_history:true,historical_enriched:true,data:tripDate,status:'FINALIZADO',
    schedule_record_id:scheduleId,schedule_id:scheduleId,schedule_storage:source.storage||source.schedule_storage||'',
    departure_id:departure?.id||monitoring?.departure_id||'',monitoring_id:monitoring?.id||'',
    sequencia:source.sequencia||source.sequencia_carregamento||monitoring?.sequencia||departure?.sequencia||'',
    ocs:source.ocs||source.carga||monitoring?.ocs||departure?.ocs||'',regiao:source.regiao||monitoring?.regiao||departure?.regiao||'',
    rota:source.rota||monitoring?.rota||departure?.rota||'',destino:source.destino||source.cidade_destino||monitoring?.destino||source.rota||'',
    placa:source.placa||departure?.placa||monitoring?.placa||'',motorista:source.motorista||departure?.motorista||monitoring?.motorista||'',
    motorista_id:source.motorista_id||departure?.motorista_id||monitoring?.motorista_id||'',
    ajudante_1:source.ajudante_1||departure?.ajudante_1||monitoring?.ajudante_1||'',ajudante_1_id:source.ajudante_1_id||departure?.ajudante_1_id||monitoring?.ajudante_1_id||'',
    ajudante_2:source.ajudante_2||departure?.ajudante_2||monitoring?.ajudante_2||'',ajudante_2_id:source.ajudante_2_id||departure?.ajudante_2_id||monitoring?.ajudante_2_id||'',
    saida_real:departureAt||'',hora_real:departureAt||'',retorno_real:returnAt,return_at:returnAt,
    tempo_rota_min:Math.max(0,diffMinutes(departureAt,returnAt)||0),dias_cobertos:calendarDaysCovered(departureAt||tripDate,returnAt),
    qtd_entregas:source.qtd_entregas ?? monitoring?.qtd_entregas ?? monitoring?.entregas_realizadas ?? 0,
    entregas:source.entregas ?? monitoring?.entregas_realizadas ?? source.qtd_entregas ?? 0,
    apoios:source.apoios??0,devolucoes:source.devolucoes??0,origem:source.origem||origin,
    observacoes:source.observacoes||`Histórico consolidado a partir de ${origin==='ESCALA_FINALIZADA'?'Escala finalizada':'Monitoramento finalizado'}.`,
  };
}

export function buildConfirmedReturnHistoryFromLoaded({returns=[],schedules=[],departures=[],monitorings=[]}={}){
  const base=enrichReturnHistoryFromLoaded(returns,schedules,departures,monitorings);
  const out=[...base],retBySchedule=buildReturnDomainIndex(base),confirmedTrips=buildConfirmedReturnTripIndex(base);
  const depBySchedule=buildReturnDomainIndex(departures),monBySchedule=buildReturnDomainIndex(monitorings);
  const representedDepartureIds=new Set(base.map((row)=>String(row.departure_id||'').trim()).filter(Boolean));
  const appendIfMissing=(record,reference,departure)=>{
    if(!record)return;
    if(reference){const directReturn=matchReturnDomain(retBySchedule,reference);if((directReturn&&operationalTripMatches(directReturn,reference))||hasConfirmedReturnForSchedule(confirmedTrips,reference))return;}
    const depId=String(departure?.id||record.departure_id||'').trim();if(depId&&representedDepartureIds.has(depId))return;
    if(out.some((row)=>operationalTripMatches(row,record)))return;
    out.push(record);if(depId)representedDepartureIds.add(depId);
    for(const key of returnDomainAliases(record))if(!retBySchedule.has(key))retBySchedule.set(key,record);
    const tripKey=operationalTripBaseKey(record);if(tripKey){const bucket=confirmedTrips.get(tripKey)||[];bucket.push(record);confirmedTrips.set(tripKey,bucket);}
  };
  for(const schedule of schedules||[]){
    if(isOperationallyExcludedTrip(schedule))continue;
    const directDeparture=matchReturnDomain(depBySchedule,schedule);
    const departure=(directDeparture&&operationalTripMatches(directDeparture,schedule)?directDeparture:null)||matchLoadedOperational(departures,schedule)||null;
    const directMonitoring=matchReturnDomain(monBySchedule,schedule);
    const monitoring=(directMonitoring&&operationalTripMatches(directMonitoring,schedule)?directMonitoring:null)||matchLoadedOperational(monitorings,schedule)||null;
    const returnRaw=schedule.retorno_real||schedule.return_at||monitoring?.retorno_real||monitoring?.return_at||'';
    if(!returnRaw)continue;
    appendIfMissing(syntheticConfirmedHistoryRecord({...schedule,retorno_real:returnRaw},departure,monitoring,'ESCALA_FINALIZADA'),schedule,departure);
  }
  for(const monitoring of monitorings||[]){
    const status=normalizeText(monitoring.status_monitoramento||monitoring.status);
    if(!['FINALIZADO','RETORNOU'].includes(status)||!(monitoring.retorno_real||monitoring.return_at))continue;
    const departure=matchLoadedOperational(departures,monitoring)||null;
    appendIfMissing(syntheticConfirmedHistoryRecord(monitoring,departure,monitoring,'MONITORAMENTO_FINALIZADO'),monitoring,departure);
  }
  return out.sort((a,b)=>String(b.saida_real||b.data||b.retorno_real||'').localeCompare(String(a.saida_real||a.data||a.retorno_real||''))||Number(b.return_id||b.id||0)-Number(a.return_id||a.id||0));
}

export async function listReturnsDashboard(db,user,filters={}){
  const today=dateIso(new Date().toISOString());
  const start=dateIso(filters.start||filters.inicio)||addDays(today,-60);
  const end=dateIso(filters.end||filters.fim)||addDays(today,1);
  // Uma única carga operacional alimenta candidatos e histórico. Antes, a tela
  // fazia duas requisições e relia RETURNS enquanto a consulta de candidatos
  // também lia Escala/Saída/Monitoramento/Retorno, aumentando a chance de 503.
  const [schedules,departures,monitorings,returns]=await Promise.all([
    schedulesFor(db,user,{...filters,start,end}),
    listDomainRows(db,'departures',{start,end,limit:4000}),
    listDomainRows(db,'monitoring',{start,end,limit:4000}),
    listDomainRows(db,'returns',{start,end,limit:4000}),
  ]);
  const candidates=buildReturnCandidatesFromLoaded({schedules,departures,monitorings,returns},filters);
  const history=buildConfirmedReturnHistoryFromLoaded({returns,schedules,departures,monitorings});
  const auditedHistory=await enrichReturnEditAudit(db,history);
  // O histórico não congela mais a fotografia das entregas no instante do Retorno.
  // Sempre que houver um cache Lincros válido para a escala, expomos o último estado
  // sincronizado também nas viagens FINALIZADAS/RETORNADAS. Isso permite corrigir
  // apontamentos feitos na Lincros depois da conclusão operacional da viagem.
  const lincrosHistory=await enrichRowsWithLincrosCache(db,auditedHistory);
  const records=lincrosHistory.map((row)=>row?.lincros?.syncHealthy===true?{
    ...row,
    entregas:Number(row.entregas_realizadas??row.entregas??0)||0,
    qtd_entregas:Number(row.entregas_previstas??row.qtd_entregas??0)||0,
    fonte_entregas:'LINCROS',
  }:row);
  return {start,end,candidates,records,summary:{candidates:candidates.length,returns:records.length}};
}

export async function listReturnCandidates(db,user,filters={}){
  const today=dateIso(new Date().toISOString());
  const start=dateIso(filters.start||filters.inicio)||addDays(today,-60);
  const end=dateIso(filters.end||filters.fim)||addDays(today,2);
  // Mantém o fluxo usado pela automação GPS conservador: uma leitura por vez.
  // A tela usa listReturnsDashboard() e faz somente uma requisição HTTP.
  const schedules=await schedulesFor(db,user,{...filters,start,end});
  const departures=await listDomainRows(db,'departures',{start,end,limit:4000});
  const monitorings=await listDomainRows(db,'monitoring',{start,end,limit:4000});
  const returns=await listDomainRows(db,'returns',{start,end,limit:4000});
  return buildReturnCandidatesFromLoaded({schedules,departures,monitorings,returns},filters);
}


// Automação (GPS/Lincros) nunca grava como o usuário logado que abriu a tela: o retorno automático
// deve constar como AUTOMAÇÃO GPS e não como finalização/edição manual de uma pessoa.
const GPS_AUTOMATION_USER=Object.freeze({id:0,name:'AUTOMAÇÃO GPS',email:'',role:'ADMIN',perfil:'ADMIN',permissions:['*'],bases:['route']});
export async function autoConfirmReturnsFromGps(db,user,positions=[],options={}) {
  const configured=Array.isArray(options.facilityNames)?options.facilityNames:String(options.facilityNames||'').split('|');
  const facilityNames=[...new Set([...configured,...DEFAULT_RETURN_FACILITY_NAMES].map((value)=>clean(value,240)).filter(Boolean))];
  const facilityRadiusMeters=Math.max(20,Number(options.facilityRadiusMeters||DEFAULT_RETURN_FACILITY_RADIUS_METERS));
  const systemUser={...GPS_AUTOMATION_USER};
  const facilityAnchors=Array.isArray(options.facilityAnchors)?options.facilityAnchors:await loadGpsFacilityAnchors(db,facilityNames,facilityRadiusMeters).catch(()=>[]);
  const today=dateIso(new Date().toISOString());
  const candidates=await listReturnCandidates(db,systemUser,{start:addDays(today,-30),end:addDays(today,1)});
  const byPlate=new Map();
  for(const item of candidates){
    const plate=clean(item?.schedule?.placa||item?.departure?.placa,30).toUpperCase();if(!plate)continue;
    if(!byPlate.has(plate))byPlate.set(plate,[]);byPlate.get(plate).push(item);
  }
  for(const values of byPlate.values())values.sort((a,b)=>String(localDateTime(b.schedule?.data,b.departure?.hora_real||b.departure?.saida_real)||b.schedule?.data||'').localeCompare(String(localDateTime(a.schedule?.data,a.departure?.hora_real||a.departure?.saida_real)||a.schedule?.data||'')));
  const results=[];
  for(const position of positions||[]){
    const plate=clean(position?.plate,30).toUpperCase();const insideByName=gpsPositionInsideFacility(position,facilityNames,facilityRadiusMeters),insideByAnchor=positionInsideFacilityAnchors(position,facilityAnchors,facilityRadiusMeters);if(!plate||(!insideByName&&!insideByAnchor))continue;
    const gpsAt=String(position?.updatedAt||'').replace(' ','T').slice(0,19);if(!gpsAt)continue;
    const optionsForPlate=byPlate.get(plate)||[];
    let candidate=null;
    for(const item of optionsForPlate){
      const departureAt=localDateTime(item.schedule?.data,item.departure?.hora_real||item.departure?.saida_real);
      if(!departureAt)continue;
      const elapsed=diffMinutes(departureAt,gpsAt);
      if(!Number.isFinite(elapsed)||elapsed<1)continue;
      const gpsDeparture=normalizeText(item.departure?.origem_saida)==='GPS_GEOFENCE';
      const leftFacility=gpsDeparture||await outsideFacilitySeenAfterDeparture(db,plate,departureAt,facilityNames,facilityAnchors,facilityRadiusMeters);
      if(!leftFacility)continue;
      candidate={...item,departureAt};break;
    }
    if(!candidate)continue;
    try{
      const saved=await saveReturn(db,systemUser,{
        schedule_record_id:String(candidate.schedule.id),
        storage:candidate.schedule.storage||'',
        schedule_storage:candidate.schedule.storage||'',
        data:candidate.schedule.data,
        placa:plate,
        motorista:candidate.departure?.motorista||candidate.schedule?.motorista,
        retorno_real:gpsAt,
        origem:'GPS',
        observacoes:`RETORNO AUTOMÁTICO GPS: veículo identificado novamente em uma referência da unidade de Recife (${facilityNames.join(' / ')}).`,
      });
      results.push({plate,scheduleId:String(candidate.schedule.id),returnId:saved.record?.id||null,time:gpsAt,facilityNames});
      byPlate.set(plate,optionsForPlate.filter((item)=>String(item.schedule?.id)!==String(candidate.schedule.id)));
    }catch(error){
      if(!/já possui retorno confirmado/i.test(String(error?.message||'')))console.error('GPS auto return save error',plate,error);
    }
  }
  return results;
}

function scheduleSnapshotFromConfirmedReturn(current={},source={}) {
  const scheduleId=clean(current.schedule_record_id||current.schedule_id||current.escala_id||current.escala_id_legado||current.legado_id||source.schedule_record_id||source.schedule_id||source.escala_id||'',120);
  const weightTon=numberValue(current.peso_t ?? source.peso_t ?? 0);
  const weightKg=numberValue(current.peso_kg ?? source.peso_kg ?? (weightTon*1000));
  return {
    id:scheduleId,
    storage:clean(current.schedule_storage||current.storage||source.schedule_storage||source.storage||'',40),
    data:dateIso(current.data||source.data||current.retorno_real||source.retorno_real),
    sequencia:clean(current.sequencia||current.sequencia_carregamento||source.sequencia||source.sequencia_carregamento,80),
    ocs:clean(current.ocs||current.carga||source.ocs||source.carga,1000),
    qtd_entregas:Math.max(0,Math.round(numberValue(current.qtd_entregas ?? current.entregas ?? source.qtd_entregas ?? source.entregas ?? 0))),
    peso_t:weightTon,
    peso_kg:weightKg,
    rota:clean(current.rota||source.rota,240),
    regiao:clean(current.regiao||source.regiao,80),
    placa:clean(current.placa||source.placa,30).toUpperCase(),
    motorista:clean(current.motorista||source.motorista,180),
    motorista_id:clean(current.motorista_id||source.motorista_id,120),
    ajudante_1:clean(current.ajudante_1||source.ajudante_1,180),
    ajudante_1_id:clean(current.ajudante_1_id||source.ajudante_1_id,120),
    ajudante_2:clean(current.ajudante_2||source.ajudante_2,180),
    ajudante_2_id:clean(current.ajudante_2_id||source.ajudante_2_id,120),
    status:'FINALIZADO',
    syntheticReturnSnapshot:true,
  };
}

export async function saveReturn(db, user, payload, id = null) {
  const nestedPayloadData=payload?.data;
  const source = { ...((nestedPayloadData&&typeof nestedPayloadData==='object'&&!Array.isArray(nestedPayloadData))?nestedPayloadData:(payload||{})) };
  const current = id ? await getDomainRow(db, 'returns', id) : null;
  const historicalAdjustment=Boolean(current);
  const scheduleSource={ ...current, ...source };

  // AJUSTE DE RETORNO EXISTENTE: caminho curto e independente do histórico.
  // Não procura Saída, Monitoramento nem varre Escalas. O retorno já confirmado é
  // a fonte de verdade para a edição; no máximo tentamos um vínculo curto/direto
  // para enriquecer peso/entregas, sem tornar isso obrigatório.
  let schedule=null, departure=null, monitoring=null, existing=current;
  if(historicalAdjustment){
    schedule=await resolveScheduleForReturn(db,user,scheduleSource).catch(()=>null);
    if(!schedule)schedule=scheduleSnapshotFromConfirmedReturn(current,source);
    departure={
      ...current,
      id:current?.departure_id||null,
      status:'SAIU',
      status_saida:'SAIU',
      data:dateIso(current?.data||source.data||schedule.data),
      hora_real:current?.hora_real||current?.saida_real||source.saida_real||'',
      saida_real:current?.saida_real||source.saida_real||current?.hora_real||'',
      placa:current?.placa||schedule.placa,
      motorista:current?.motorista||schedule.motorista,
    };
  }else{
    schedule=await resolveScheduleForReturn(db,user,scheduleSource);
    if(!schedule&&(source.orphan_monitoring||source.monitoring_id)){
      const monitoringId=Number(source.monitoring_id||0);
      const orphan=monitoringId?await getDomainRow(db,'monitoring',monitoringId):null;
      const samePlate=!normalizeText(source.placa)||normalizeText(source.placa)===normalizeText(orphan?.placa);
      const sameRoute=!normalizeText(source.rota)||normalizeText(source.rota)===normalizeText(orphan?.rota);
      if(!orphan||!monitoringAwaitsReturn(orphan)||!samePlate||!sameRoute)throw new Error('Monitoramento aberto não encontrado ou não corresponde à placa/rota informada.');
      monitoring=orphan;
      schedule=syntheticScheduleFromMonitoring(orphan);
      departure=orphan.departure_id?await getDomainRow(db,'departures',orphan.departure_id).catch(()=>null):null;
      if(!departure)departure=await findOperationalFast(db,'departures',orphan).catch(()=>null);
      departure=departureSnapshotFromMonitoring(orphan,departure);
      existing=await findOperationalFast(db,'returns',orphan).catch(()=>null);
    }
    if(!schedule){
      const ref=clean(scheduleSource.schedule_record_id||scheduleSource.schedule_id||scheduleSource.escala_id||'',120);
      const context=[ref?`ID ${ref}`:'',dateIso(scheduleSource.data)?`data ${dateIso(scheduleSource.data)}`:'',clean(scheduleSource.placa,30)?`placa ${clean(scheduleSource.placa,30).toUpperCase()}`:'',clean(scheduleSource.rota,80)?`rota ${clean(scheduleSource.rota,80)}`:''].filter(Boolean).join(' · ');
      throw new Error(`Escala vinculada não encontrada${context?` (${context})`:''}.`);
    }
    if(!monitoring){
      const operational=await loadReturnOperationalContext(db,schedule);
      departure=operational.departure;
      monitoring=operational.monitoring;
      existing=operational.existing;
    }
    if(!departure||normalizeText(departure.status||departure.status_saida)!=='SAIU')throw new Error('O retorno só pode ser registrado após uma saída realizada.');
  }
  if (!id && existing) {
    // Se o navegador perdeu a resposta após a gravação (timeout/503 no refresh),
    // um novo clique não deve tentar criar o mesmo retorno de novo.
    const requestedAt=localDateTime(dateIso(source.data||schedule.data),source.retorno_real||source.return_at);
    const existingAt=localDateTime(existing.data||schedule.data,existing.retorno_real||existing.return_at);
    const sameTrip=normalizeText(existing.placa||schedule.placa)===normalizeText(source.placa||schedule.placa)
      && normalizeText(existing.rota||schedule.rota)===normalizeText(source.rota||schedule.rota);
    const closeTime=requestedAt&&existingAt?Math.abs(diffMinutes(existingAt,requestedAt)||0)<=5:false;
    if(sameTrip&&closeTime)return {record:existing,availability:[],alreadyConfirmed:true,avisos:['Retorno já estava confirmado; mantido o registro existente.']};
    throw new Error('Esta rota já possui retorno confirmado. Edite o retorno existente.');
  }

  const origin = normalizeText(source.origem || current?.origem || 'MANUAL');
  if (!RETURN_ORIGINS.has(origin)) throw new Error('Origem do retorno inválida. Use MONITORAMENTO, PORTARIA, SANKHYA, MANUAL, GPS ou APP.');

  const merged = {
    ...schedule,
    ...departure,
    ...current,
    ...source,
    schedule_record_id: String(schedule.id||current?.schedule_record_id||current?.schedule_id||current?.escala_id||''),
    departure_id: departure.id,
    data: dateIso(source.data || current?.data || schedule.data),
    status: 'FINALIZADO',
    origem: origin,
    placa: clean(source.placa || departure.placa || schedule.placa, 30).toUpperCase(),
    motorista: clean(source.motorista || departure.motorista || schedule.motorista, 180),
    rota: clean(source.rota || schedule.rota, 240),
  };

  merged.retorno_real = localDateTime(merged.data, source.retorno_real || source.return_at || current?.retorno_real);
  if (!merged.retorno_real) throw new Error('Informe a data e hora real do retorno.');
  merged.saida_real = localDateTime(departure.data || schedule.data, source.saida_real || departure.saida_real || departure.hora_real);
  if (merged.saida_real && diffMinutes(merged.saida_real, merged.retorno_real) < 0) {
    throw new Error('O retorno não pode ocorrer antes da saída.');
  }

  const plannedDeliveries = Math.max(0, Math.round(numberValue(schedule.qtd_entregas)));
  const monitoredDeliveries = monitoring?.entregas_realizadas;
  const deliveryFallback = monitoredDeliveries !== '' && monitoredDeliveries !== null && monitoredDeliveries !== undefined
    ? Math.max(0, Math.round(numberValue(monitoredDeliveries)))
    : plannedDeliveries;
  // v2.0.44: a tela não oferece edição de Entregas. Quando o campo não vem no payload,
  // mantém o fallback operacional (Monitoramento, quando houver, ou planejado da Escala).
  // O backend continua aceitando um valor explícito para compatibilidade com integrações e histórico.
  merged.entregas = integerMetric(source.entregas ?? source.entregas_realizadas, 'Entregas realizadas', deliveryFallback);
  const apoioAnswer = source.apoiou_alguem ?? source.apoiou_rota ?? source.houve_apoio
    ?? ((source.qtd_apoios_rota ?? source.apoios) !== undefined ? Number(source.qtd_apoios_rota ?? source.apoios) > 0 : undefined)
    ?? current?.apoiou_alguem ?? (Number(current?.apoios || 0) > 0);
  const devolucaoAnswer = source.voltou_com_devolucao ?? source.houve_devolucao
    ?? ((source.qtd_devolucoes ?? source.devolucoes) !== undefined ? Number(source.qtd_devolucoes ?? source.devolucoes) > 0 : undefined)
    ?? current?.voltou_com_devolucao ?? (Number(current?.devolucoes || 0) > 0);
  merged.apoios = conditionalIntegerMetric(apoioAnswer, source.qtd_apoios_rota ?? source.apoios, 'Quantidade de apoios em rota', current?.apoios ?? 0);
  merged.devolucoes = conditionalIntegerMetric(devolucaoAnswer, source.qtd_devolucoes ?? source.devolucoes, 'Quantidade de devoluções', current?.devolucoes ?? 0);
  merged.apoiou_alguem = merged.apoios > 0;
  merged.voltou_com_devolucao = merged.devolucoes > 0;

  merged.km_inicial = Math.max(0, numberValue(source.km_inicial ?? current?.km_inicial ?? departure.km_inicial));
  merged.km_final = Math.max(0, numberValue(source.km_final ?? current?.km_final));
  if (merged.km_final && merged.km_inicial && merged.km_final < merged.km_inicial) {
    throw new Error('KM final não pode ser menor que o KM inicial.');
  }
  merged.km_rodados = Math.max(0, merged.km_final - merged.km_inicial);
  merged.tempo_rota_min = Math.max(0, diffMinutes(merged.saida_real, merged.retorno_real) || 0);
  merged.tempo_real_h = merged.tempo_rota_min / 60;
  merged.jornada_min = merged.tempo_rota_min;
  merged.peso_t = numberValue(schedule.peso_t || numberValue(schedule.peso_kg) / 1000);
  merged.entregas_hora = merged.tempo_real_h ? merged.entregas / merged.tempo_real_h : 0;
  merged.toneladas_hora = merged.tempo_real_h ? merged.peso_t / merged.tempo_real_h : 0;
  merged.horas_tonelada = merged.peso_t ? merged.tempo_real_h / merged.peso_t : 0;
  merged.performance_score = `${merged.entregas} / ${merged.apoios} / ${merged.devolucoes}`;
  // `legacy` pertence à origem da Escala, não ao registro de Retorno. Copiá-lo
  // para ROUTE_RETURNS fazia o Histórico esconder o botão Ajustar após uma edição
  // de viagem migrada, embora o retorno estruturado continuasse editável.
  delete merged.legacy;

  // As três escritas que definem o estado operacional são mantidas como núcleo
  // da confirmação. Depois delas, o retorno já está efetivamente finalizado.
  const record = await upsertDomainRow(db, 'returns', merged, user, id || current?.id || null);
  if (!historicalAdjustment && monitoring) {
    // Quando o retorno vem do NATTO Entregas, o Monitoramento continua contando
    // atendimentos finalizados (inclui devolução/insucesso) enquanto ROUTE_RETURNS
    // preserva entregas bem-sucedidas e devoluções separadamente para Indicadores.
    const appFinalized = Number(monitoring.app_atendimentos_finalizados ?? source.app_atendimentos_finalizados);
    const monitoringCompleted = Number.isFinite(appFinalized) ? Math.max(0,Math.round(appFinalized)) : merged.entregas;
    await upsertDomainRow(db, 'monitoring', {
      ...monitoring,
      status: 'FINALIZADO',
      status_monitoramento: 'FINALIZADO',
      entregas_realizadas: monitoringCompleted,
      entregas_pendentes: Math.max(0, Number(monitoring.entregas_previstas || schedule.qtd_entregas || 0) - monitoringCompleted),
      retorno_real: merged.retorno_real,
    }, user, monitoring.id);
  }
  if (!schedule.syntheticReturnSnapshot) {
    // O retorno corrigido precisa ser refletido também na Escala. Antes, ajustes de
    // um retorno já existente atualizavam apenas ROUTE_RETURNS; se o vínculo histórico
    // da viagem estivesse migrado, o CAJU continuava lendo a data antiga/ausente da
    // Escala e o dia seguinte permanecia como DISP. Sincronizar status+retorno não
    // reexecuta disponibilidade nem eventos de recurso; apenas mantém a fonte histórica
    // principal coerente com o retorno que o usuário acabou de corrigir.
    await safeUpdateScheduleStatus(db, user, schedule, 'FINALIZADO', { retorno_real: merged.retorno_real });
  }

  // Ajustes de retorno existente nunca reexecutam efeitos operacionais derivados.
  // Isso transforma a edição em uma atualização simples do registro ROUTE_RETURNS.
  return {
    record,
    availability:[],
    // Monitoramento órfão não atualiza uma Escala inexistente, mas ainda precisa
    // executar a liberação de veículo/equipe após o POST concluir.
    skipDerivedState:Boolean(historicalAdjustment||(schedule.syntheticReturnSnapshot&&!schedule.orphanMonitoring)),
    avisos: merged.tempo_rota_min > 648 ? ['A jornada registrada ultrapassou 10h48. Verifique apontamentos e pernoite.'] : [],
  };
}

export async function finalizeReturnDerivedState(db,user,record={}) {
  if(!record?.id)return {availability:[],warnings:[]};
  let availability=[];const warnings=[];
  const results=await Promise.allSettled([
    emitResourceStatus(db,user,record,'DISPONÍVEL','RETORNO',{returnId:record.id}),
    createAvailabilityAfterReturn(db,record,record.retorno_real,user),
  ]);
  if(results[1].status==='fulfilled')availability=results[1].value||[];
  if(results[0].status==='rejected')warnings.push('Atualização de status dos recursos pendente.');
  if(results[1].status==='rejected')warnings.push('Disponibilidade do dia seguinte pendente.');
  return {availability,warnings};
}


const PORTARIA_ALIASES = Object.freeze({
  PLACA:['PLACA','VEICULO','VEÍCULO'],
  DATA:['DATA','DATA ENTRADA'],
  HORA:['HORA','HORARIO','HORÁRIO','HORA ENTRADA'],
  DATA_HORA_RETORNO:['DATA/HORA ENTRADA','DATA HORA ENTRADA','DATAHORA','ENTRADA'],
});
function stripAccents(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();}
function portariaHeader(value){const key=stripAccents(value);for(const [field,aliases] of Object.entries(PORTARIA_ALIASES)){if(aliases.some(a=>stripAccents(a)===key))return field;}return '';}
function normalizePlate(value){return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);}
function portariaDateTime(combined,date,time){
  const raw=String(combined||'').trim();
  let m=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T]+(\d{1,2}):(\d{2})/);if(m)return `${m[3]}-${m[2]}-${m[1]}T${String(m[4]).padStart(2,'0')}:${m[5]}`;
  m=raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T]+(\d{1,2}):(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}T${String(m[4]).padStart(2,'0')}:${m[5]}`;
  const day=dateIso(date), clock=String(time||'').trim().match(/(\d{1,2}):(\d{2})/);return day&&clock?`${day}T${String(clock[1]).padStart(2,'0')}:${clock[2]}`:'';
}
export async function previewPortariaImport(db,user,text) {
  const lines=String(text||'').replace(/\r/g,'').split('\n').filter(line=>line.trim());
  if(lines.length<2){const e=new Error('Cole a base com cabeçalho e dados.');e.code='IMPORT_NO_HEADER';throw e;}
  const delimiter=lines[0].includes('\t')?'\t':lines[0].includes(';')?';':',';
  const headers=lines[0].split(delimiter).map(portariaHeader);
  if(!headers.includes('PLACA')){const e=new Error('Cabeçalho PLACA não encontrado.');e.code='IMPORT_MISSING_HEADER';throw e;}
  const candidates=await listReturnCandidates(db,user,{});
  const rows=lines.slice(1).map((line,index)=>{
    const cells=line.split(delimiter),item={__sourceRow:index+2};headers.forEach((field,i)=>{if(field)item[field]=String(cells[i]||'').trim();});
    const plate=normalizePlate(item.PLACA),dt=portariaDateTime(item.DATA_HORA_RETORNO,item.DATA,item.HORA);
    const eligible=candidates.filter(c=>normalizePlate(c.schedule?.placa||c.departure?.placa)===plate).filter(c=>{
      const dep=localDateTime(c.departure?.data||c.schedule?.data,c.departure?.saida_real||c.departure?.hora_real);return !dep||!dt||new Date(`${dep}:00-03:00`).getTime()<=new Date(`${dt}:00-03:00`).getTime();
    }).sort((a,b)=>String(b.departure?.saida_real||b.departure?.hora_real||'').localeCompare(String(a.departure?.saida_real||a.departure?.hora_real||'')));
    const found=eligible[0]||null,errors=[];
    if(!plate)errors.push('Placa inválida');if(!dt)errors.push('Data/hora inválida');if(!found)errors.push('Rota aberta não encontrada');
    return {...item,PLACA:plate,DATA_HORA_RETORNO:dt,ESCALA_ID:found?String(found.schedule.id):'',ESCALA_STORAGE:found?.schedule?.storage||'',valid:errors.length===0,errors};
  });
  return {rows,validCount:rows.filter(r=>r.valid).length,invalidCount:rows.filter(r=>!r.valid).length};
}
export async function confirmPortariaImport(db,user,rows) {
  if(!Array.isArray(rows)||!rows.length)throw new Error('Nenhuma entrada para processar.');
  const processed=[],errors=[];
  for(const row of rows){
    if(row.valid===false){errors.push({row:row.__sourceRow,error:(row.errors||[]).join(', ')});continue;}
    try{
      const dt=String(row.DATA_HORA_RETORNO||''), result=await saveReturn(db,user,{schedule_record_id:row.ESCALA_ID,storage:row.ESCALA_STORAGE||'',schedule_storage:row.ESCALA_STORAGE||'',placa:row.PLACA,data:dateIso(dt),retorno_real:dt,origem:'PORTARIA',observacoes:'Importado da base de portaria.'});
      processed.push(result.record||result);
    }catch(error){errors.push({row:row.__sourceRow,error:error.message||String(error)});}
  }
  return {processed,errors};
}


async function cancelAvailabilityCreatedByReturn(db,schedule={},returnRecord={},user={},reason='') {
  await ensureAvailabilitySchema(db);
  const aliases=[...new Set([...returnScheduleAliases(schedule),...returnDomainAliases(returnRecord)].map(String).filter(Boolean))];
  if(!aliases.length)return 0;
  const placeholders=aliases.map(()=>'?').join(',');
  const {results=[]}=await db.prepare(`SELECT ID,OBSERVACOES FROM DISPONIBILIDADE_RECURSOS WHERE ESCALA_ORIGEM_ID IN (${placeholders}) AND UPPER(COALESCE(ORIGEM,''))='RETORNO REAL' AND UPPER(COALESCE(STATUS,''))<>'CANCELADO'`).bind(...aliases).all();
  let changed=0;
  for(const row of results||[]){
    const prior=clean(row.OBSERVACOES||'',500),suffix=`Reabertura da viagem: ${clean(reason,300)}`;
    const notes=clean([prior,suffix].filter(Boolean).join(' | '),500);
    const result=await db.prepare(`UPDATE DISPONIBILIDADE_RECURSOS SET STATUS='CANCELADO',OBSERVACOES=?,ATUALIZADO_EM=CURRENT_TIMESTAMP,USUARIO=? WHERE ID=?`).bind(notes,clean(user?.email||user?.name||'Sistema',180),row.ID).run();
    changed+=Number(result.meta?.changes||0);
  }
  return changed;
}

export async function reopenReturn(db,user,payload={}) {
  const id=Number(payload.id||payload.return_id||0);
  if(!id)throw new Error('Retorno não encontrado para reabertura.');
  if(normalizeText(user?.role)!=='ADMIN')throw new Error('Somente ADMIN pode reabrir uma viagem finalizada.');
  const reason=clean(payload.justificativa||payload.reason||payload.motivo||'',500);
  if(reason.length<5)throw new Error('Informe a justificativa da reabertura.');
  const current=await getDomainRow(db,'returns',id);
  if(!current)throw new Error('Retorno não encontrado para reabertura. Atualize a tela e tente novamente.');

  const source={...current,...payload,schedule_record_id:payload.schedule_record_id||current.schedule_record_id||current.schedule_id||current.escala_id||'',schedule_storage:payload.schedule_storage||payload.storage||current.schedule_storage||current.storage||''};
  const schedule=await resolveSchedule(db,user,source);
  if(!schedule)throw new Error('A escala vinculada a este retorno não foi encontrada. Não foi possível reabrir a viagem com segurança.');

  let departure=current.departure_id?await getDomainRow(db,'departures',current.departure_id).catch(()=>null):null;
  if(!departure)departure=await findOperationalFast(db,'departures',schedule).catch(()=>null);
  if(!departure||normalizeText(departure.status||departure.status_saida)!=='SAIU')throw new Error('A saída confirmada desta viagem não foi localizada. Não foi possível reabrir com segurança.');

  let monitoring=current.monitoring_id?await getDomainRow(db,'monitoring',current.monitoring_id).catch(()=>null):null;
  if(!monitoring)monitoring=await findOperationalFast(db,'monitoring',schedule).catch(()=>null);
  const effectiveAt=new Date().toISOString();
  const scheduleId=String(schedule.id||current.schedule_record_id||current.schedule_id||'');
  const monitoringBase={...schedule,...departure,...(monitoring||{}),schedule_record_id:scheduleId,schedule_id:scheduleId,departure_id:departure.id,data:dateIso(schedule.data||departure.data||current.data),placa:schedule.placa||departure.placa||current.placa,motorista:schedule.motorista||departure.motorista||current.motorista,rota:schedule.rota||current.rota,status:'EM ROTA',status_monitoramento:'EM ROTA',retorno_real:'',return_at:'',reaberto_em:effectiveAt,reaberto_por:clean(user?.name||user?.email||'ADMIN',180),reabertura_justificativa:reason};
  const monitoringRecord=await upsertDomainRow(db,'monitoring',monitoringBase,user,monitoring?.id||null);
  const scheduleUpdated=await safeUpdateScheduleStatus(db,user,schedule,'EM ROTA',{retorno_real:'',retorno_real_confirmado:'',reaberto_em:effectiveAt,reabertura_justificativa:reason});
  if(!scheduleUpdated)throw new Error('Não foi possível retornar a Escala para EM ROTA. Nenhum retorno foi removido.');

  const availabilityCancelled=await cancelAvailabilityCreatedByReturn(db,schedule,current,user,reason);
  await emitResourceStatus(db,user,{...schedule,...departure,...monitoringRecord},'EM ROTA','REABERTURA_RETORNO',{monitoringId:monitoringRecord.id,returnId:id,effectiveAt,justificativa:reason});
  await deleteDomainRow(db,'returns',id,user);
  await audit(db,user,'REABRIR_VIAGEM','returns',id,{schedule_record_id:scheduleId,departure_id:departure.id,monitoring_id:monitoringRecord.id,placa:schedule.placa||current.placa,rota:schedule.rota||current.rota,justificativa:reason,status_destino:'EM ROTA',availabilityCancelled});
  return {reopened:true,status:'EM ROTA',schedule_record_id:scheduleId,monitoring:monitoringRecord,availabilityCancelled,justificativa:reason};
}

export async function removeReturn(db, user, id) {
  const current = await getDomainRow(db, 'returns', id);
  if (!current) throw new Error('Retorno não encontrado.');
  if (normalizeText(user?.role) !== 'ADMIN') throw new Error('Somente ADMIN pode excluir um retorno finalizado.');
  return deleteDomainRow(db, 'returns', id, user);
}
