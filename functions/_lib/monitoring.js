import { createAvailabilityRowsForSchedule } from './availability.js';
import { audit } from './core.js';
import {
  activeMonitoringStatus,
  addDays,
  addMinutes,
  clean,
  dateIso,
  diffMinutes,
  emitResourceStatus,
  findDomainBySchedule,
  getDomainRow,
  intValue,
  listDomainRows,
  localDateTime,
  normalizeText,
  resolveSchedule,
  schedulesFor,
  safeUpdateScheduleStatus,
  upsertDomainRow,
  deleteDomainRow,
} from './route-phase1.js';
import { isMonitoringExcludedTrip } from './operational-exclusions.js';
import { enrichRowsWithLincrosCache } from './lincros.js';




function monitoringExcludedRoute(row={}){
  return isMonitoringExcludedTrip(row);
}
function routeCatalogIndexes(rows=[]){
  const byId=new Map(),byName=new Map();
  for(const row of rows||[]){
    const id=String(row.ID||row.id||'').trim(); const name=String(row.ROTA||row.rota||'').trim();
    if(id)byId.set(id,row); if(name)byName.set(normalizeText(name),row);
  }
  return {byId,byName};
}
function calculatedReturnForecast(row={},routeIndexes={byId:new Map(),byName:new Map()}){
  const route=routeIndexes.byId.get(String(row.rota_id||row.route_id||''))||routeIndexes.byName.get(normalizeText(row.rota||row.destino||''))||{};
  const travel=Math.max(0,Number(route.TEMPO_IDA_MIN||0))+Math.max(0,Number(route.TEMPO_ENTRE_CIDADES_MIN||0))+Math.max(0,Number(route.TEMPO_VOLTA_MIN||0));
  const profile=normalizeText(route.PERFIL||row.perfil||row.perfil_rota||row.regiao||'');
  const perDelivery=profile.includes('REDE')||normalizeText(row.rota||'').includes('REDE')?180:30;
  const deliveries=Math.max(0,intValue(row.entregas_previstas||row.qtd_entregas));
  const start=row.saida_real||localDateTime(row.data,timeOnlySafe(row.hora_real||row.horario_ponto||row.hora_programada||row.hora_saida_programada));
  const total=travel+(deliveries*perDelivery);
  const routeFound=Object.keys(route).length>0;
  const forecast=start&&routeFound?addMinutes(start,total):'';
  return {previsao_retorno_calculada:forecast,tempo_deslocamento_previsto_min:travel,tempo_entregas_previsto_min:deliveries*perDelivery,tempo_total_previsto_min:total,tempo_por_entrega_previsto_min:perDelivery,perfil_rota_calculado:profile.includes('REDE')?'REDE':'VAREJO',previsao_retorno_base:row.saida_real?'SAÍDA REAL':'SAÍDA PROGRAMADA',rota_base_encontrada:routeFound};
}
function timeOnlySafe(value){const match=String(value||'').match(/(?:T|\s|^)(\d{1,2}:\d{2})/);return match?match[1]:'';}
function sqliteUtcIso(value=''){const raw=String(value||'').trim();if(!raw)return '';if(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw))return raw;if(/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?/.test(raw))return `${raw.replace(' ','T').slice(0,19)}Z`;return raw;}
async function enrichMonitoringForecasts(db,rows=[]){
  if(!rows.length)return rows;
  let routeRows=[];try{routeRows=(await db.prepare('SELECT * FROM BASE_ROTAS WHERE COALESCE(ATIVO,1)<>0').all()).results||[];}catch{}
  const indexes=routeCatalogIndexes(routeRows);
  return rows.map((row)=>{const calc=calculatedReturnForecast(row,indexes);return {...row,...calc,previsao_retorno:calc.previsao_retorno_calculada||row.previsao_retorno||''};});
}

function monitoringScheduleKeys(row={}) {
  return [row.schedule_record_id,row.schedule_id,row.escala_id,row.id]
    .filter((value)=>value!==null&&value!==undefined&&String(value)!=='')
    .map(String);
}
function departureScheduleKeys(row={}) {
  return [row.schedule_record_id,row.schedule_id,row.escala_id,row.escala_id_legado]
    .filter((value)=>value!==null&&value!==undefined&&String(value)!=='')
    .map(String);
}
function monitoringOriginalPlate(source={},fallback=''){
  const explicit=clean(source.placa_lincros||source.placa_original||'',30).toUpperCase();if(explicit)return explicit;
  const history=Array.isArray(source.trocas_recursos)?source.trocas_recursos:[];
  const first=history.find((item)=>normalizeText(item?.campo)==='VEICULO'&&clean(item?.anterior,30));
  return clean(first?.anterior||fallback||source.placa||'',30).toUpperCase();
}
function monitoringLatestResourceChange(source={},field=''){
  const target=normalizeText(field),history=Array.isArray(source.trocas_recursos)?source.trocas_recursos:[];let found=null;
  for(const item of history){if(normalizeText(item?.campo)===target)found=item;}
  return found;
}
function monitoringEffectiveResource(source={},field='',fallback='',max=180){
  const change=monitoringLatestResourceChange(source,field);
  if(change&&Object.prototype.hasOwnProperty.call(change,'novo'))return clean(change.novo,max);
  return clean(fallback,max);
}
function monitoringOriginalDriver(source={},fallback=''){
  const history=Array.isArray(source.trocas_recursos)?source.trocas_recursos:[];
  const first=history.find((item)=>normalizeText(item?.campo)==='MOTORISTA'&&clean(item?.anterior,180));
  return clean(first?.anterior||fallback||source.motorista||'',180);
}
async function enrichMonitoringWithDepartureResources(db,rows=[]){
  const ids=[...new Set((rows||[]).map((row)=>String(row.schedule_record_id||row.schedule_id||row.escala_id||'').trim()).filter(Boolean))];
  if(!ids.length)return rows;
  const bySchedule=new Map();
  try{
    for(let offset=0;offset<ids.length;offset+=80){
      const chunk=ids.slice(offset,offset+80),marks=chunk.map(()=>'?').join(',');
      const result=await db.prepare(`SELECT ID,SCHEDULE_ID,STATUS,PLATE,DRIVER_ID,DRIVER_NAME,DATA_JSON,UPDATED_AT FROM ROUTE_DEPARTURES WHERE SCHEDULE_ID IN (${marks}) AND UPPER(COALESCE(STATUS,''))='SAIU' ORDER BY ID DESC`).bind(...chunk).all();
      for(const raw of result.results||[]){
        const key=String(raw.SCHEDULE_ID||'');if(!key||bySchedule.has(key))continue;
        let data={};try{data=JSON.parse(String(raw.DATA_JSON||'{}'))||{};}catch{}
        bySchedule.set(key,{...data,id:Number(raw.ID),schedule_record_id:key,placa:data.placa||raw.PLATE||'',motorista_id:data.motorista_id||raw.DRIVER_ID||'',motorista:data.motorista||raw.DRIVER_NAME||'',updatedAt:raw.UPDATED_AT||data.updatedAt||''});
      }
    }
  }catch(error){console.warn('Monitoring departure-resource reconciliation',error?.message||error);return rows;}
  return (rows||[]).map((row)=>{
    const key=String(row.schedule_record_id||row.schedule_id||row.escala_id||'').trim(),departure=bySchedule.get(key);if(!departure)return row;
    const originalPlate=monitoringOriginalPlate(departure,row.placa_lincros||row.placa_original||row.placa);
    // A trilha de troca é a fonte de auditoria mais confiável quando um snapshot antigo
    // ficou com placa/motorista anterior. O último valor `novo` representa o recurso
    // efetivamente escolhido na Saída e prevalece na reconciliação do Monitoramento.
    const effectivePlate=monitoringEffectiveResource(departure,'VEICULO',departure.placa||row.placa||'',30).toUpperCase();
    const effectiveDriver=monitoringEffectiveResource(departure,'MOTORISTA',departure.motorista||row.motorista||'',180);
    const effectiveHelper1=monitoringEffectiveResource(departure,'AJUDANTE 1',departure.ajudante_1||row.ajudante_1||'',180);
    const effectiveHelper2=monitoringEffectiveResource(departure,'AJUDANTE 2',departure.ajudante_2||row.ajudante_2||'',180);
    return {...row,
      placa:effectivePlate||departure.placa||row.placa||'',veiculo_id:departure.veiculo_id||row.veiculo_id||'',
      motorista_id:departure.motorista_id||row.motorista_id||'',motorista:effectiveDriver||departure.motorista||row.motorista||'',
      ajudante_1_id:departure.ajudante_1_id||row.ajudante_1_id||'',ajudante_1:effectiveHelper1,
      ajudante_2_id:departure.ajudante_2_id||row.ajudante_2_id||'',ajudante_2:effectiveHelper2,
      tipo_equipe:departure.tipo_equipe||row.tipo_equipe||'',trocas_recursos:Array.isArray(departure.trocas_recursos)?departure.trocas_recursos:(row.trocas_recursos||[]),
      placa_original:originalPlate,placa_lincros:originalPlate||departure.placa||row.placa||'',
      motorista_original:monitoringOriginalDriver(departure,row.motorista_original||row.motorista||''),
    };
  });
}
async function pendingMonitoringFromSchedules(db,user,existingRows=[],filters={}) {
  if (!filters.includePending) return [];
  const date = dateIso(filters.date || filters.data || new Date().toISOString());
  const [schedules,departures] = await Promise.all([
    schedulesFor(db,user,{start:date,end:date}),
    listDomainRows(db,'departures',{start:date,end:date,limit:10000}),
  ]);
  const existingKeys = new Set();
  for (const row of existingRows || []) for (const key of monitoringScheduleKeys(row)) existingKeys.add(key);
  const departureBySchedule = new Map();
  for (const row of departures || []) for (const key of departureScheduleKeys(row)) if (!departureBySchedule.has(key)) departureBySchedule.set(key,row);
  const pending=[];
  for (const schedule of schedules || []) {
    const scheduleId=String(schedule.id || '');
    if (!scheduleId || existingKeys.has(scheduleId) || monitoringExcludedRoute(schedule)) continue;
    const scheduleStatus=normalizeText(schedule.status || 'PROGRAMADO');
    if (['CANCELADO','FINALIZADO','RETORNOU'].includes(scheduleStatus)) continue;
    const departure=monitoringScheduleKeys(schedule).map((key)=>departureBySchedule.get(key)).find(Boolean) || null;
    const departureStatus=normalizeText(departure?.status || departure?.status_saida || 'PENDENTE');
    if (['CANCELADO','NÃO SAIU','NAO SAIU','TRANSFERIDO','FINALIZADO'].includes(departureStatus)) continue;
    const status=departureStatus==='SAIU' ? 'EM ROTA' : 'PENDENTE DE SAÍDA';
    pending.push({
      ...schedule,
      ...(departure || {}),
      id:`pending:${scheduleId}`,
      synthetic_pending:true,
      schedule_record_id:scheduleId,
      escala_id:String(schedule.sourceKey || scheduleId),
      data:dateIso(schedule.data || date),
      status,
      status_monitoramento:status,
      placa:departure?.placa || schedule.placa || '',
      motorista:departure?.motorista || schedule.motorista || '',
      ajudante_1:departure?.ajudante_1 || schedule.ajudante_1 || '',
      ajudante_2:departure?.ajudante_2 || schedule.ajudante_2 || '',
      rota:departure?.rota || schedule.rota || schedule.destino || '',
      regiao:departure?.regiao || schedule.regiao || '',
      saida_real:departure?.hora_real ? localDateTime(schedule.data || date,departure.hora_real) : '',
      entregas_previstas:Math.max(0,intValue(schedule.qtd_entregas || departure?.entregas_previstas)),
      entregas_realizadas:0,
      entregas_pendentes:Math.max(0,intValue(schedule.qtd_entregas || departure?.entregas_previstas)),
      previsao_retorno:schedule.previsao_retorno || '',
      previsao_termino:schedule.previsao_termino || '',
      hora_limite_jornada:schedule.limite_jornada || '',
      observacoes:departure?.observacoes || schedule.observacoes || '',
    });
  }
  return pending;
}

const STATUS_TO_SCHEDULE = Object.freeze({
  FINALIZADO: 'FINALIZADO',
  'EM ROTA': 'EM ROTA',
  PERNOITE: 'PERNOITE',
  'RETORNO PREVISTO': 'RETORNO PREVISTO',
  'EM RETORNO': 'EM RETORNO',
  'NO DESTINO': 'EM ROTA',
  DESCARREGADO: 'EM RETORNO',
  'PENDENTE DE SAÍDA': 'PROGRAMADO',
});

export async function ensureMonitoringForDeparture(db, user, schedule, departure) {
  if(monitoringExcludedRoute(schedule)) return null;
  const existing = await findDomainBySchedule(db, 'monitoring', schedule.id);
  const departureState = normalizeText(departure.status_saida || departure.status);
  const status = departureState === 'SAIU'
    ? 'EM ROTA'
    : departureState === 'FINALIZADO' ? 'FINALIZADO' : 'PENDENTE DE SAÍDA';
  const planned = Math.max(0, intValue(existing?.entregas_previstas || schedule.qtd_entregas));
  const realized = Math.max(0, intValue(existing?.entregas_realizadas));
  const payload = {
    ...schedule,
    ...existing,
    schedule_record_id: String(schedule.id),
    departure_id: departure.id,
    data: dateIso(schedule.data),
    status,
    status_monitoramento: status,
    placa: monitoringEffectiveResource(departure,'VEICULO',departure.placa || schedule.placa,30).toUpperCase(),
    motorista_id: departure.motorista_id || schedule.motorista_id || '',
    motorista: monitoringEffectiveResource(departure,'MOTORISTA',departure.motorista || schedule.motorista,180),
    ajudante_1_id: departure.ajudante_1_id || schedule.ajudante_1_id || '',
    ajudante_1: monitoringEffectiveResource(departure,'AJUDANTE 1',departure.ajudante_1 || schedule.ajudante_1 || '',180),
    ajudante_2_id: departure.ajudante_2_id || schedule.ajudante_2_id || '',
    ajudante_2: monitoringEffectiveResource(departure,'AJUDANTE 2',departure.ajudante_2 || schedule.ajudante_2 || '',180),
    rota: schedule.rota,
    regiao: schedule.regiao,
    saida_real: localDateTime(schedule.data, departure.hora_real),
    entregas_previstas: planned,
    entregas_realizadas: realized,
    entregas_pendentes: Math.max(0, planned - realized),
    previsao_retorno: existing?.previsao_retorno || schedule.previsao_retorno,
    previsao_termino: existing?.previsao_termino || schedule.previsao_termino,
    hora_limite_jornada: existing?.hora_limite_jornada || schedule.limite_jornada,
    liberado_escala_seguinte: Boolean(existing?.liberado_escala_seguinte),
    observacoes: existing?.observacoes || '',
    trocas_recursos: Array.isArray(departure.trocas_recursos) ? departure.trocas_recursos : (existing?.trocas_recursos || []),
    placa_original: monitoringOriginalPlate(departure, existing?.placa_lincros || existing?.placa_original || schedule.placa),
    placa_lincros: monitoringOriginalPlate(departure, existing?.placa_lincros || existing?.placa_original || schedule.placa),
    motorista_original: monitoringOriginalDriver(departure, existing?.motorista_original || schedule.motorista || ''),
  };
  return upsertDomainRow(db, 'monitoring', payload, user, existing?.id || null);
}

export async function listMonitoring(db, user, filters = {}) {
  if (String(filters.operational || '') === '1') {
    const recentDays = Math.min(Math.max(intValue(filters.recentDays, 3), 0), 14);
    const cutoff = addDays(dateIso(new Date().toISOString()), -recentDays);
    const limit = Math.min(Math.max(intValue(filters.limit, 1200), 50), 3000);
    const activeOnly=['1','true','sim','yes'].includes(String(filters.activeOnly||filters.active_only||'').toLowerCase());
    let result;
    if(activeOnly){
      // A tela de Monitoramento exibe somente viagens ativas. Evitar o antigo OR + CASE
      // impede varredura de toda a ROUTE_MONITORING conforme o histórico cresce.
      const activeStatuses=['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO'];
      const marks=activeStatuses.map(()=>'?').join(',');
      result=await db.prepare(`
        SELECT * FROM ROUTE_MONITORING
        WHERE STATUS IN (${marks})
        ORDER BY DATE_KEY DESC, ID DESC
        LIMIT ?
      `).bind(...activeStatuses,limit).all();
    }else{
      result=await db.prepare(`
        SELECT * FROM ROUTE_MONITORING
        WHERE STATUS <> 'FINALIZADO' OR DATE_KEY >= ?
        ORDER BY CASE WHEN STATUS='FINALIZADO' THEN 1 ELSE 0 END, DATE_KEY DESC, ID DESC
        LIMIT ?
      `).bind(cutoff, limit).all();
    }
    const rows = (result.results || []).map((row) => {
      let data = {}; try { data = JSON.parse(String(row.DATA_JSON || '{}')) || {}; } catch {}
      return { ...data, id:Number(row.ID), status:row.STATUS, status_monitoramento:data.status_monitoramento || row.STATUS,
        dateKey:row.DATE_KEY, data:data.data || row.DATE_KEY, version:Number(row.VERSION || data.version || 1),
        createdAt:row.CREATED_AT, updatedAt:row.UPDATED_AT };
    });
    const filtered=rows.filter((row) => !monitoringExcludedRoute(row)&&(normalizeText(row.status) !== 'PENDENTE DE SAÍDA' || filters.includePending));
    const pending=await pendingMonitoringFromSchedules(db,user,filtered,filters);
    const resources=await enrichMonitoringWithDepartureResources(db,[...pending,...filtered]);
    const forecasted=await enrichMonitoringForecasts(db,resources);
    const lite=['1','true','sim'].includes(String(filters.lite||'').toLowerCase());
    // O Monitoramento faz a leitura Lincros/GPS em chamadas próprias logo após carregar.
    // No modo lite evitamos repetir aqui a consulta de cache + busca espacial de clientes,
    // reduzindo bastante o tempo de resposta da tela e evitando timeout no Cloudflare.
    if(lite)return enrichMonitoringVehicles(db,forecasted);
    return enrichMonitoringVehicles(db,await enrichRowsWithLincrosCache(db,forecasted,{nearbyClients:true}));
  }
  const rows = await listDomainRows(db, 'monitoring', filters);
  const filtered=rows.filter((row) => !monitoringExcludedRoute(row)&&(normalizeText(row.status) !== 'PENDENTE DE SAÍDA' || filters.includePending));
  const pending=await pendingMonitoringFromSchedules(db,user,filtered,filters);
  const resources=await enrichMonitoringWithDepartureResources(db,[...pending,...filtered]);
  const forecasted=await enrichMonitoringForecasts(db,resources);
  const lite=['1','true','sim'].includes(String(filters.lite||'').toLowerCase());
  if(lite)return enrichMonitoringVehicles(db,forecasted);
  return enrichMonitoringVehicles(db,await enrichRowsWithLincrosCache(db,forecasted,{nearbyClients:true}));
}



async function enrichMonitoringVehicles(db,rows=[]){
  if(!rows.length)return rows;
  const result=await db.prepare(`SELECT PLACA,TIPO,CAPACIDADE_TON FROM BASE_VEICULOS WHERE COALESCE(ATIVO,1)<>0`).all().catch(()=>({results:[]}));
  const byPlate=new Map((result.results||[]).map((row)=>[normalizeText(row.PLACA||''),row]));
  return rows.map((row)=>{const vehicle=byPlate.get(normalizeText(row.placa||row.PLATE||''))||{};return {...row,veiculo_tipo:row.veiculo_tipo||row.tipo_veiculo||vehicle.TIPO||'',veiculo_capacidade_t:Number(row.veiculo_capacidade_t||row.capacidade_t||vehicle.CAPACIDADE_TON||0)||0};});
}

const SUMMARY_ACTIVE_STATUSES=new Set(['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO']);
const SUMMARY_FINAL_STATUSES=new Set(['FINALIZADO','RETORNOU','CANCELADO']);
function summaryJson(value){try{const parsed=JSON.parse(String(value||'{}'));return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};}catch{return {};}}
function summaryScheduleKeys(value={},fallback=''){
  return [fallback,value.schedule_record_id,value.schedule_id,value.escala_id,value.escala_id_legado,value.legado_id]
    .filter((item)=>item!==null&&item!==undefined&&String(item).trim()!=='').map(String);
}
function addCompletedKeys(target,row={},data={}){for(const key of summaryScheduleKeys(data,row.SCHEDULE_ID||row.ESCALA_ID||''))target.add(key);}
async function completedMonitoringEvidence(db,monitorRows=[]){
  const active=monitorRows||[];if(!active.length)return {reasons:new Map(),start:''};
  const start=active.map((row)=>dateIso(row.DATE_KEY)).filter(Boolean).sort()[0]||'';
  const [dedicatedReturns,genericReturns,legacyReturns,legacySchedules,genericSchedules]=await Promise.all([
    db.prepare(`SELECT SCHEDULE_ID,DATE_KEY,STATUS,RETURN_AT,DATA_JSON FROM ROUTE_RETURNS WHERE DATE_KEY>=? ORDER BY ID DESC LIMIT 10000`).bind(start).all().catch(()=>({results:[]})),
    db.prepare(`SELECT ID,DATE_KEY,STATUS,DATA_JSON FROM ROUTE_RECORDS WHERE MODULE='returns' AND DATE_KEY>=? ORDER BY ID DESC LIMIT 10000`).bind(start).all().catch(()=>({results:[]})),
    db.prepare(`SELECT ID,DATA,ESCALA_ID,PLACA,DATA_HORA_RETORNO FROM RETORNOS WHERE DATA>=? ORDER BY DATA DESC LIMIT 10000`).bind(start).all().catch(()=>({results:[]})),
    db.prepare(`SELECT ID,DATA,STATUS FROM ESCALAS_DIA WHERE DATA>=? AND UPPER(COALESCE(STATUS,'')) IN ('FINALIZADO','RETORNOU','CANCELADO') ORDER BY DATA DESC LIMIT 10000`).bind(start).all().catch(()=>({results:[]})),
    db.prepare(`SELECT ID,DATE_KEY,STATUS,DATA_JSON FROM ROUTE_RECORDS WHERE MODULE='schedule' AND DATE_KEY>=? AND UPPER(COALESCE(STATUS,'')) IN ('FINALIZADO','RETORNOU','CANCELADO') ORDER BY ID DESC LIMIT 10000`).bind(start).all().catch(()=>({results:[]})),
  ]);
  const returned=new Set(),finalSchedules=new Set();
  for(const row of dedicatedReturns.results||[]){const data=summaryJson(row.DATA_JSON);if(String(row.RETURN_AT||data.retorno_real||data.return_at||'').trim()||SUMMARY_FINAL_STATUSES.has(normalizeText(row.STATUS||data.status)))addCompletedKeys(returned,row,data);}
  for(const row of genericReturns.results||[]){const data=summaryJson(row.DATA_JSON);if(String(data.retorno_real||data.return_at||'').trim()||SUMMARY_FINAL_STATUSES.has(normalizeText(row.STATUS||data.status)))addCompletedKeys(returned,row,data);}
  for(const row of legacyReturns.results||[])if(String(row.DATA_HORA_RETORNO||'').trim())addCompletedKeys(returned,row,{});
  for(const row of legacySchedules.results||[])addCompletedKeys(finalSchedules,{SCHEDULE_ID:row.ID},{});
  for(const row of genericSchedules.results||[])addCompletedKeys(finalSchedules,{SCHEDULE_ID:row.ID},summaryJson(row.DATA_JSON));
  const reasons=new Map();
  for(const row of active){const data=summaryJson(row.DATA_JSON),keys=summaryScheduleKeys(data,row.SCHEDULE_ID||'');if(keys.some((key)=>returned.has(key)))reasons.set(Number(row.ID),'RETORNO_CONFIRMADO');else if(keys.some((key)=>finalSchedules.has(key)))reasons.set(Number(row.ID),'ESCALA_FINALIZADA');}
  return {reasons,start};
}
async function reconcileCompletedMonitoring(db,user,monitorRows=[]){
  const evidence=await completedMonitoringEvidence(db,monitorRows);const stale=(monitorRows||[]).filter((row)=>evidence.reasons.has(Number(row.ID)));
  if(!stale.length)return {active:monitorRows||[],reconciled:[]};
  const reconciledAt=new Date().toISOString();
  const statements=stale.map((row)=>{const data=summaryJson(row.DATA_JSON);const next={...data,status:'FINALIZADO',status_monitoramento:'FINALIZADO',reconciliado_automaticamente:true,motivo_reconciliacao:evidence.reasons.get(Number(row.ID)),reconciliado_em:reconciledAt};return db.prepare(`UPDATE ROUTE_MONITORING SET STATUS='FINALIZADO',VERSION=COALESCE(VERSION,0)+1,DATA_JSON=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=? AND STATUS<>'FINALIZADO'`).bind(JSON.stringify(next),Number(row.ID));});
  try{
    await db.batch(statements);
    await audit(db,user,'RECONCILIAR','monitoring',null,{records:stale.map((row)=>({id:Number(row.ID),scheduleId:String(row.SCHEDULE_ID||''),previousStatus:String(row.STATUS||''),reason:evidence.reasons.get(Number(row.ID))}))});
  }catch(error){console.error('Monitoring reconciliation warning',error);}
  const staleIds=new Set(stale.map((row)=>Number(row.ID)));
  return {active:(monitorRows||[]).filter((row)=>!staleIds.has(Number(row.ID))),reconciled:stale.map((row)=>({id:Number(row.ID),scheduleId:String(row.SCHEDULE_ID||''),previousStatus:String(row.STATUS||''),reason:evidence.reasons.get(Number(row.ID))}))};
}
function recifeDateKey(){
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
  catch{return new Date().toISOString().slice(0,10);}
}
function daySpanInclusive(start,end){
  const a=dateIso(start),b=dateIso(end);if(!a||!b)return 1;
  const am=Date.parse(`${a}T00:00:00Z`),bm=Date.parse(`${b}T00:00:00Z`);
  if(!Number.isFinite(am)||!Number.isFinite(bm)||bm<am)return 1;
  return Math.floor((bm-am)/86400000)+1;
}
export async function monitoringSummary(db,user,filters={}){
  const statuses=[...SUMMARY_ACTIVE_STATUSES];
  const placeholders=statuses.map(()=>'?').join(',');
  const [monitorResult,routeResult,employeeResult]=await Promise.all([
    db.prepare(`SELECT ID,SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON,UPDATED_AT FROM ROUTE_MONITORING WHERE STATUS IN (${placeholders}) ORDER BY ID DESC LIMIT 3000`).bind(...statuses).all(),
    db.prepare(`SELECT ID,ROTA,REGIAO,PERFIL,DURACAO_DIAS FROM BASE_ROTAS WHERE COALESCE(ATIVO,1)<>0`).all().catch(()=>({results:[]})),
    db.prepare(`SELECT NOME,VINCULO,FUNCAO FROM BASE_COLABORADORES WHERE COALESCE(ATIVO,1)<>0 AND UPPER(COALESCE(FUNCAO,'')) LIKE '%MOTORISTA%'`).all().catch(()=>({results:[]})),
  ]);
  const reconciliation=await reconcileCompletedMonitoring(db,user,monitorResult.results||[]);
  monitorResult.results=reconciliation.active;
  const routeById=new Map(),routeByName=new Map();
  for(const row of routeResult.results||[]){if(row.ID)routeById.set(String(row.ID),row);if(row.ROTA)routeByName.set(normalizeText(row.ROTA),row);}
  const driverRelationByName=new Map();
  for(const row of employeeResult.results||[]){
    const name=normalizeText(row.NOME||'');if(!name)continue;
    const relation=normalizeText(row.VINCULO||'');
    driverRelationByName.set(name,relation.includes('TERCEIR')?'TERCEIRO':relation?'PRÓPRIO':'');
  }
  const bySchedule=new Map();
  for(const row of monitorResult.results||[]){
    let data={};try{data=JSON.parse(String(row.DATA_JSON||'{}'))||{};}catch{}
    const merged={...data,id:Number(row.ID),schedule_record_id:data.schedule_record_id||row.SCHEDULE_ID||'',data:data.data||row.DATE_KEY,status:row.STATUS,status_monitoramento:data.status_monitoramento||row.STATUS,placa:data.placa||row.PLATE||'',motorista:data.motorista||row.DRIVER_NAME||'',rota:data.rota||row.ROUTE||'',updatedAt:row.UPDATED_AT};
    if(monitoringExcludedRoute(merged))continue;
    const key=String(merged.schedule_record_id||merged.escala_id||merged.id);if(!bySchedule.has(key))bySchedule.set(key,merged);
  }
  const today=recifeDateKey();
  const toSummaryRow=(row={},pending=false)=>{
    const route=routeById.get(String(row.rota_id||row.route_id||''))||routeByName.get(normalizeText(row.rota||''))||{};
    const routed=Math.max(0,intValue(row.qtd_entregas||row.entregas_previstas));
    const planned=Math.max(0,intValue(row.entregas_previstas||row.qtd_entregas));
    const realized=pending?0:Math.max(0,Math.min(planned||Number.MAX_SAFE_INTEGER,intValue(row.entregas_realizadas)));
    // A base total da rota pode existir antes de a viagem estar efetivamente vinculada
    // à Lincros. Para o Resumo, separamos a base roteirizada total da base realmente
    // acompanhada pela API, evitando comparar apontamentos Lincros contra entregas que
    // ainda não possuem sincronização válida.
    const lincrosSyncHealthy=!pending&&row.lincros?.syncHealthy===true;
    const lincrosPlanned=lincrosSyncHealthy?Math.max(0,intValue(row.lincros?.deliveriesPlanned??planned)):0;
    const lincrosRealized=lincrosSyncHealthy?Math.max(0,Math.min(lincrosPlanned||Number.MAX_SAFE_INTEGER,intValue(row.lincros?.deliveriesDone??realized))):0;
    const plannedDays=Math.max(1,intValue(row.duracao_dias||route.DURACAO_DIAS||1));
    const elapsedDays=pending?0:daySpanInclusive(row.data||row.dateKey,today);
    const extra=pending?0:Math.max(0,elapsedDays-plannedDays);
    const region=clean(row.regiao||route.REGIAO||'');
    const profile=clean(row.perfil||row.perfil_rota||route.PERFIL||'');
    const driver=clean(row.motorista||'');
    const helpers=[clean(row.ajudante_1||''),clean(row.ajudante_2||'')].filter(Boolean);
    const driverRelation=driverRelationByName.get(normalizeText(driver))||(/^TERCEIR/.test(normalizeText(row.vinculo_motorista||row.driver_relation||''))?'TERCEIRO':clean(row.vinculo_motorista||row.driver_relation||''));
    const rawDeparture=String(row.saida_real||row.actual_at||row.actualAt||'').trim();
    const departureAt=pending?'':((rawDeparture&&/[T ]\d{1,2}:\d{2}/.test(rawDeparture))
      ?rawDeparture
      :localDateTime(row.data||row.dateKey,rawDeparture||row.hora_real)||row.data||row.dateKey||'');
    const scheduledTime=timeOnlySafe(row.horario_ponto||row.hora_programada||row.hora_saida_programada||row.HORA_SAIDA_PROGRAMADA||'');
    const scheduledAt=scheduledTime?localDateTime(row.data||row.dateKey||today,scheduledTime):'';
    return {id:row.id,scheduleId:String(row.schedule_record_id||row.schedule_id||row.escala_id||''),sequencia:row.sequencia||'',ocs:clean(row.ocs||row.carga||row.CARGA||row.OCS||''),rota:row.rota||'',regiao:region,perfil:profile,placa:row.placa||'',motorista:driver,ajudante1:helpers[0]||'',ajudante2:helpers[1]||'',ajudantes:helpers.join(' / '),vinculoMotorista:driverRelation,status:pending?'PENDENTE DE SAÍDA':(row.status||''),saidaEm:departureAt,saidaProgramada:scheduledAt,entregas:routed,entregasRealizadas:realized,lincrosSyncHealthy,lincrosEntregasPrevistas:lincrosPlanned,lincrosEntregasRealizadas:lincrosRealized,duracaoDias:plannedDays,diasEmRota:elapsedDays,pernoitesExtras:extra,justificativaPernoite:clean(row.justificativa_pernoite||''),atualizadoEm:sqliteUtcIso(row.updatedAt||row.atualizado_em||'')};
  };
  const cachedActive=await enrichRowsWithLincrosCache(db,[...bySchedule.values()]);
  const enriched=cachedActive.filter((row)=>SUMMARY_ACTIVE_STATUSES.has(normalizeText(row.status))).map((row)=>toSummaryRow(row,false));
  const pendingSource=await pendingMonitoringFromSchedules(db,user,[...bySchedule.values()],{includePending:true,date:today});
  const pendingEnriched=pendingSource.filter((row)=>normalizeText(row.status)==='PENDENTE DE SAÍDA').map((row)=>toSummaryRow(row,true));
  const unique=(values)=>[...new Set(values.map((v)=>clean(v)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const filterUniverse=[...enriched,...pendingEnriched];
  const filterOptions={
    regions:unique(filterUniverse.map((r)=>r.regiao)),routes:unique(filterUniverse.map((r)=>r.rota)),drivers:unique(filterUniverse.map((r)=>r.motorista)),plates:unique(filterUniverse.map((r)=>r.placa)),profiles:unique(filterUniverse.map((r)=>r.perfil)),driverRelations:unique(filterUniverse.map((r)=>r.vinculoMotorista)).length?unique(filterUniverse.map((r)=>r.vinculoMotorista)):['PRÓPRIO','TERCEIRO'],
  };
  const regionFilter=normalizeText(filters.region||filters.regiao||''),routeFilter=normalizeText(filters.route||filters.rota||''),driverFilter=normalizeText(filters.driver||filters.motorista||''),plateFilter=normalizeText(filters.plate||filters.placa||''),profileFilter=normalizeText(filters.profile||filters.perfil||''),relationFilter=normalizeText(filters.driverRelation||filters.vinculoMotorista||filters.vinculo_motorista||''),query=normalizeText(filters.q||filters.busca||'');
  const matchesSummaryFilters=(r)=>{
    if(regionFilter&&normalizeText(r.regiao)!==regionFilter)return false;
    if(routeFilter&&normalizeText(r.rota)!==routeFilter)return false;
    if(driverFilter&&normalizeText(r.motorista)!==driverFilter)return false;
    if(plateFilter&&normalizeText(r.placa)!==plateFilter)return false;
    if(profileFilter&&normalizeText(r.perfil)!==profileFilter)return false;
    if(relationFilter&&normalizeText(r.vinculoMotorista)!==relationFilter)return false;
    if(query&&!normalizeText([r.rota,r.regiao,r.perfil,r.placa,r.motorista,r.ajudantes,r.vinculoMotorista,r.status,r.sequencia,r.ocs].join(' ')).includes(query))return false;
    return true;
  };
  const detail=enriched.filter(matchesSummaryFilters);
  const pendingDetail=pendingEnriched.filter(matchesSummaryFilters);
  let totalDeliveries=0,realizedDeliveries=0,lincrosPlannedDeliveries=0,lincrosRealizedDeliveries=0,extraDays=0;const plates=new Set(),lincrosTrackedSchedules=new Set();
  for(const row of detail){
    totalDeliveries+=row.entregas;realizedDeliveries+=row.entregasRealizadas;extraDays+=row.pernoitesExtras;
    if(row.placa)plates.add(normalizeText(row.placa));
    if(row.lincrosSyncHealthy){lincrosPlannedDeliveries+=Number(row.lincrosEntregasPrevistas||0);lincrosRealizedDeliveries+=Number(row.lincrosEntregasRealizadas||0);if(row.scheduleId)lincrosTrackedSchedules.add(String(row.scheduleId));}
  }
  const lincrosDeliveryPercent=lincrosPlannedDeliveries?Math.round(lincrosRealizedDeliveries/lincrosPlannedDeliveries*1000)/10:null;
  const overnightReport=detail.filter((row)=>normalizeText(row.status)==='PERNOITE').map((row)=>({
    id:row.id,rota:row.rota,regiao:row.regiao,perfil:row.perfil,placa:row.placa,motorista:row.motorista,vinculoMotorista:row.vinculoMotorista,
    status:'PERNOITE',justificativa:row.justificativaPernoite||'',atualizadoEm:row.atualizadoEm||'',diasEmRota:row.diasEmRota,duracaoDias:row.duracaoDias,pernoitesExtras:row.pernoitesExtras,
  }));
  const overnightPlateCount=new Set(overnightReport.map((row)=>normalizeText(row.placa)).filter(Boolean)).size;
  return {versao:'1',generatedAt:new Date().toISOString(),summary:{carsInRoute:plates.size,routesInProgress:detail.length,pendingDepartures:pendingDetail.length,totalDeliveries,realizedDeliveries,deliveryPercent:totalDeliveries?Math.round(realizedDeliveries/totalDeliveries*1000)/10:0,lincrosPlannedDeliveries,lincrosRealizedDeliveries,lincrosDeliveryPercent,lincrosTrackedRoutes:lincrosTrackedSchedules.size,overnights:extraDays,monitoringOvernights:overnightPlateCount||overnightReport.length,overnightPendingJustification:overnightReport.filter((row)=>!clean(row.justificativa)).length,reconciledCompleted:reconciliation.reconciled.length},rows:detail,pendingRows:pendingDetail,overnightReport,reconciled:reconciliation.reconciled,filters:filterOptions,activeFilters:{q:filters.q||filters.busca||'',region:filters.region||filters.regiao||'',route:filters.route||filters.rota||'',driver:filters.driver||filters.motorista||'',driverRelation:filters.driverRelation||filters.vinculoMotorista||filters.vinculo_motorista||'',profile:filters.profile||filters.perfil||'',plate:filters.plate||filters.placa||''}};
}

export async function saveMonitoring(db, user, payload, id = null) {
  const nestedPayloadData=payload?.data;
  const source = { ...((nestedPayloadData&&typeof nestedPayloadData==='object'&&!Array.isArray(nestedPayloadData))?nestedPayloadData:(payload||{})) };
  const current = id ? await getDomainRow(db, 'monitoring', id) : null;
  if (!current && !source.schedule_record_id && !source.escala_id) throw new Error('Vincule o monitoramento a uma escala.');
  if (current && source.version !== undefined && Number(source.version) !== Number(current.version)) {
    const error = new Error('O monitoramento foi atualizado por outro usuário. Recarregue a tela.');
    error.code = 'MONITORING_VERSION_CONFLICT';
    throw error;
  }

  const merged = { ...current, ...source };
  merged.data = dateIso(merged.data);
  merged.status = normalizeText(merged.status || merged.status_monitoramento || 'EM ROTA');
  merged.status_monitoramento = merged.status;
  const previousStatus = normalizeText(current?.status || current?.status_monitoramento);
  if (merged.status === 'PERNOITE' && previousStatus !== 'PERNOITE') {
    const markedAt = source.pernoite_em || new Date().toISOString();
    const markedDate = (()=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(markedAt));}catch{return dateIso(markedAt);}})();
    const history = Array.isArray(current?.pernoite_datas) ? current.pernoite_datas.map(dateIso).filter(Boolean) : [];
    merged.pernoite_em = markedAt;
    merged.pernoite_datas = [...new Set([...history,markedDate].filter(Boolean))].sort();
  }
  merged.entregas_previstas = Math.max(0, intValue(merged.entregas_previstas));
  merged.entregas_realizadas = Math.max(0, intValue(merged.entregas_realizadas));
  if (merged.entregas_realizadas > merged.entregas_previstas) throw new Error('Entregas realizadas não podem superar as entregas previstas.');
  merged.entregas_pendentes = Math.max(0, merged.entregas_previstas - merged.entregas_realizadas);

  const limit = localDateTime(merged.data, merged.hora_limite_jornada);
  const now = new Date().toISOString();
  merged.alerta_jornada = Boolean(limit && diffMinutes(limit, now) >= 0 && activeMonitoringStatus(merged.status));
  if (merged.status === 'PERNOITE' && !clean(merged.justificativa_pernoite)) throw new Error('Informe a justificativa do pernoite.');
  if (merged.status === 'FINALIZADO' && merged.entregas_pendentes > 0 && !clean(merged.observacoes)) {
    throw new Error('Informe a justificativa para finalizar com entregas pendentes.');
  }

  const schedule = await resolveSchedule(db, user, merged);
  const record = await upsertDomainRow(db, 'monitoring', merged, user, id);
  const mappedStatus = STATUS_TO_SCHEDULE[record.status];
  if (schedule && mappedStatus) {
    await safeUpdateScheduleStatus(db, user, schedule, mappedStatus, {
      qtd_entregas: record.entregas_previstas,
      previsao_retorno: record.previsao_retorno || schedule.previsao_retorno,
      previsao_termino: record.previsao_termino || schedule.previsao_termino,
      limite_jornada: record.hora_limite_jornada || schedule.limite_jornada,
    });
  }
  if (record.status === 'PERNOITE') {
    await emitResourceStatus(db, user, schedule || record, 'PERNOITE', 'MONITORAMENTO', { monitoringId: record.id, effectiveAt:record.pernoite_em || record.updatedAt || new Date().toISOString(), justificativa_pernoite:record.justificativa_pernoite||'', observacoes:record.observacoes||'', autorizado_por:record.autorizado_por||'', rota:record.rota||schedule?.rota||'', regiao:record.regiao||schedule?.regiao||'', perfil:record.perfil||schedule?.perfil||'', placa:record.placa||schedule?.placa||'', motorista:record.motorista||schedule?.motorista||'' });
  }
  if (record.status === 'FINALIZADO' && previousStatus !== 'FINALIZADO') {
    await emitResourceStatus(db, user, schedule || record, 'DISPONÍVEL', 'MONITORAMENTO', { monitoringId: record.id });
  }

  return {
    record,
    schedule,
    orphan: !schedule,
    resourcesReleased: record.status === 'FINALIZADO' && previousStatus !== 'FINALIZADO',
    avisos: record.alerta_jornada ? ['A rota atingiu o limite de jornada. Avalie pernoite ou retorno.'] : [],
  };
}

export async function markOvernight(db, user, id, payload = {}) {
  const current = await getDomainRow(db, 'monitoring', id);
  if (!current) throw new Error('Monitoramento não encontrado.');
  const currentStatus = normalizeText(current.status || current.status_monitoramento || '');
  if (['FINALIZADO','RETORNOU'].includes(currentStatus)) {
    throw new Error('A viagem já foi finalizada/retornada e não pode ser marcada como pernoite.');
  }

  // Pernoite é uma ação pontual. Não reaplicamos o snapshot inteiro do card, pois
  // GPS/Lincros podem atualizar o mesmo monitoramento enquanto o modal está aberto.
  // Assim preservamos os dados mais recentes e gravamos apenas a decisão do usuário.
  const justification = clean(payload.justificativa_pernoite || payload.justification || '', 2000);
  if (!justification) throw new Error('Informe a justificativa do pernoite.');
  return saveMonitoring(db, user, {
    status: 'PERNOITE',
    status_monitoramento: 'PERNOITE',
    justificativa_pernoite: justification,
    autorizado_por: payload.autorizado_por || user?.name || user?.email,
    pernoite_em: payload.pernoite_em || undefined,
  }, id);
}

export async function releaseForNextDay(db, user, id, payload = {}) {
  const current = await getDomainRow(db, 'monitoring', id);
  if (!current) throw new Error('Monitoramento não encontrado.');
  if (current.liberado_escala_seguinte) throw new Error('Os recursos já foram liberados para a próxima data.');
  const schedule = await resolveSchedule(db, user, current);
  if (!schedule) throw new Error('Escala vinculada não encontrada.');
  const date = dateIso(payload.data_disponibilidade || addDays(schedule.data || current.data, 1));
  const result = await saveMonitoring(db, user, {
    ...current,
    liberado_escala_seguinte: true,
    data_disponibilidade: date,
    observacoes: [current.observacoes, `LIBERAÇÃO ANTECIPADA: ${clean(payload.observacoes) || 'Sem observação'}`].filter(Boolean).join(' · '),
  }, id);
  const availability = await createAvailabilityRowsForSchedule(db, schedule, date, 'LIBERAÇÃO MONITORAMENTO', payload.observacoes || 'Liberação antecipada; rota não finalizada.', user);
  await emitResourceStatus(db, user, schedule, 'DISPONÍVEL', 'LIBERAÇÃO MONITORAMENTO', { monitoringId:id,dataDisponibilidade:date,rotaPermaneceAberta:true });
  return { ...result, availability };
}

export async function processAutomaticOvernights(db, user, reference = new Date().toISOString()) {
  const rows = await listDomainRows(db, 'monitoring', { limit: 10000 });
  const changed = [];
  for (const row of rows) {
    if (!activeMonitoringStatus(row.status) || normalizeText(row.status) === 'PERNOITE') continue;
    const forecast = row.previsao_retorno || localDateTime(row.data, row.hora_limite_jornada);
    if (!forecast || diffMinutes(forecast, reference) <= 0) continue;
    const result = await saveMonitoring(db, user, {
      ...row,
      status: 'PERNOITE',
      justificativa_pernoite: 'Previsão de retorno vencida sem retorno confirmado.',
      autorizado_por: 'SISTEMA',
    }, row.id);
    changed.push(result.record);
  }
  return changed;
}

export async function deleteOrphanMonitoring(db, user, id) {
  if (normalizeText(user?.role || user?.perfil) !== 'ADMIN') throw new Error('Somente administradores podem excluir cartões órfãos.');
  const current = await getDomainRow(db, 'monitoring', id);
  if (!current) throw new Error('Monitoramento não encontrado.');
  const schedule = await resolveSchedule(db, user, current);
  if (schedule) throw new Error('Este cartão ainda possui uma escala válida e não pode ser excluído como órfão.');
  return deleteDomainRow(db, 'monitoring', id, user);
}

export async function removeMonitoring(db, user, id) {
  const current = await getDomainRow(db, 'monitoring', id);
  if (!current) throw new Error('Monitoramento não encontrado.');
  if (activeMonitoringStatus(current.status)) throw new Error('Monitoramento ativo não pode ser excluído. Finalize ou corrija o fluxo.');
  return deleteDomainRow(db, 'monitoring', id, user);
}
