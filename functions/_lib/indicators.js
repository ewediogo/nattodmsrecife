import { getOperationalOccurrenceIndicators } from './operational-pending.js';
import {
  addMinutes,
  addDays,
  dateIso,
  diffMinutes,
  epoch,
  inPeriod,
  listDomainRows,
  localDateTime,
  normalizeText,
  numberValue,
  schedulesFor,
  timeOnly,
} from './route-phase1.js';
import { isOperationallyExcludedTrip } from './operational-exclusions.js';
import { cachedLincrosBySchedule } from './lincros.js';

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function average(values) {
  const items = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  return items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : 0;
}

function normalizedWeightTons(row={}) {
  let tons=numberValue(row.peso_t);
  let kg=numberValue(row.peso_kg);
  if(tons>150) tons=tons/1000;
  if(!tons&&kg>0){
    if(kg>150000)kg=kg/1000;
    tons=kg/1000;
  }
  return Math.max(0,tons);
}


const DELIVERY_COST_PER_KM=Object.freeze({'3/4':5.80,TOCO:5.60,TRUCK:5.30,BITRUCK:4.80});
const DELIVERY_CAPACITY_T=Object.freeze({'3/4':5,TOCO:7,TRUCK:10,BITRUCK:16});
const DELIVERY_VIABILITY_LIMIT=Object.freeze({AG1:0.441,AG2:0.441,SRT:0.945,AL:0.91,PB:0.56});
function deliveryVehicleType(value=''){
  const text=normalizeText(value).replace('3X4','3/4');if(text.includes('BITRUCK'))return 'BITRUCK';if(text.includes('TRUCK'))return 'TRUCK';if(text.includes('TOCO'))return 'TOCO';if(text.includes('3/4')||text==='34')return '3/4';return text||'';
}
function deliveryRegionKey(value=''){const text=normalizeText(value);for(const key of ['AG1','AG2','SRT','AL','PB'])if(text===key||text.startsWith(`${key} `)||text.includes(` ${key} `))return key;return text;}
function deliveryPercent(done,total){return total?round(done/total*100,1):null;}
function lincrosExecutionStats(item={}){
  const deliveries=Array.isArray(item.deliveries)?item.deliveries:[];
  const delivered=deliveries.filter((row)=>row.delivered);
  const seqApplicable=delivered.filter((row)=>Number.isFinite(Number(row.sequencePlanned))&&Number.isFinite(Number(row.sequenceActual)));
  const seqCompliant=seqApplicable.filter((row)=>Number(row.sequencePlanned)===Number(row.sequenceActual)).length;
  const radiusApplicable=delivered.filter((row)=>row.withinRadius===true||row.withinRadius===false);
  const radiusCompliant=radiusApplicable.filter((row)=>row.withinRadius===true).length;
  return {sequenceApplicable:seqApplicable.length,sequenceCompliant:seqCompliant,sequenceCompliancePercent:deliveryPercent(seqCompliant,seqApplicable.length),radiusApplicable:radiusApplicable.length,radiusCompliant,radiusCompliancePercent:deliveryPercent(radiusCompliant,radiusApplicable.length)};
}
async function enrichDeliveryEconomics(db,records=[]){
  if(!records.length)return records;
  const [lincrosMap,vehicleRows]=await Promise.all([cachedLincrosBySchedule(db,records.map((row)=>row.schedule_id||row.id)),safeRows(db,'SELECT PLACA,TIPO,CAPACIDADE_TON FROM BASE_VEICULOS WHERE COALESCE(ATIVO,1)<>0')]);
  const vehicles=new Map(vehicleRows.map((row)=>[normalizeText(row.PLACA||''),row]));
  return records.map((row)=>{
    const li=lincrosMap.get(String(row.schedule_id||row.id||''))||null;
    const vehicle=vehicles.get(normalizeText(row.placa||''))||{};
    const vehicleType=deliveryVehicleType(vehicle.TIPO||row.veiculo_tipo||'');
    const capacityT=Math.max(0,numberValue(vehicle.CAPACIDADE_TON||row.veiculo_capacidade_t||0))||DELIVERY_CAPACITY_T[vehicleType]||0;
    const capacityKg=capacityT*1000;
    const weightKg=Math.max(0,numberValue(row.peso_kg));
    const plannedDistanceKm=li?.syncHealthy&&Number.isFinite(Number(li.distancePlanned))?Math.max(0,Number(li.distancePlanned)/1000):null;
    const actualDistanceKm=li?.syncHealthy&&Number.isFinite(Number(li.distanceActual))?Math.max(0,Number(li.distanceActual)/1000):null;
    const costPerKm=DELIVERY_COST_PER_KM[vehicleType]??null;
    const plannedTripCost=plannedDistanceKm!==null&&costPerKm!==null?round(plannedDistanceKm*costPerKm,2):null;
    const actualTripCost=actualDistanceKm!==null&&costPerKm!==null?round(actualDistanceKm*costPerKm,2):null;
    const plannedCostPerKg=plannedTripCost!==null&&weightKg>0?round(plannedTripCost/weightKg,3):null;
    const actualCostPerKg=actualTripCost!==null&&weightKg>0?round(actualTripCost/weightKg,3):null;
    const regionKey=deliveryRegionKey(row.regiao),viabilityLimit=DELIVERY_VIABILITY_LIMIT[regionKey]??null;
    const occupancy=capacityKg>0?round(weightKg/capacityKg*100,1):null;
    const exec=li?.syncHealthy?lincrosExecutionStats(li):{sequenceApplicable:0,sequenceCompliant:0,sequenceCompliancePercent:null,radiusApplicable:0,radiusCompliant:0,radiusCompliancePercent:null};
    const routedDeliveries=li?.syncHealthy?Math.max(0,Number(li.deliveriesPlanned||0)):null;
    const rawPointedDeliveries=li?.syncHealthy?Math.max(0,Number(li.deliveriesDone||0)):null;
    const pointedDeliveries=rawPointedDeliveries===null?null:(routedDeliveries>0?Math.min(routedDeliveries,rawPointedDeliveries):rawPointedDeliveries);
    const returnedDeliveries=li?.syncHealthy?Math.max(0,Number(li.deliveriesReturned||0),(li.deliveries||[]).filter((item)=>item.returned).length):null;
    const returnedWeightKg=li?.syncHealthy?(li.deliveries||[]).reduce((sum,item)=>{const value=Number(item?.weightReturned);return Number.isFinite(value)&&value>0?sum+value:sum;},0):null;
    return {...row,
      lincros_sync_healthy:Boolean(li?.syncHealthy),
      lincros_checked_at:li?.checkedAt||'',
      lincros_deliveries_routed:routedDeliveries,
      lincros_deliveries_pointed:pointedDeliveries,
      lincros_deliveries_returned:returnedDeliveries,
      lincros_returned_weight_kg:returnedWeightKg===null?null:round(returnedWeightKg,3),
      lincros_devolution_percent:pointedDeliveries>0&&returnedDeliveries!==null?deliveryPercent(returnedDeliveries,pointedDeliveries):null,
      lincros_delivery_percent:routedDeliveries>0?deliveryPercent(pointedDeliveries,routedDeliveries):null,
      lincros_distance_planned_km:plannedDistanceKm,
      lincros_distance_km:actualDistanceKm,
      lincros_distance_actual_km:actualDistanceKm,
      veiculo_tipo:vehicleType,veiculo_capacidade_t:capacityT||null,custo_km:costPerKm,
      custo_viagem_planejado:plannedTripCost,custo_por_kg_planejado:plannedCostPerKg,viagem_viavel_planejada:plannedCostPerKg!==null&&viabilityLimit!==null?plannedCostPerKg<=viabilityLimit:null,
      custo_viagem:actualTripCost,custo_viagem_realizado:actualTripCost,custo_por_kg:actualCostPerKg,custo_por_kg_realizado:actualCostPerKg,viagem_viavel:actualCostPerKg!==null&&viabilityLimit!==null?actualCostPerKg<=viabilityLimit:null,viagem_viavel_realizada:actualCostPerKg!==null&&viabilityLimit!==null?actualCostPerKg<=viabilityLimit:null,
      limite_custo_kg:viabilityLimit,ocupacao_percentual:occupancy,...exec};
  });
}
function summarizeDeliveryEconomics(records=[]){
  const valid=(value)=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
  const plannedCostRows=records.filter((r)=>valid(r.custo_viagem_planejado));
  const actualCostRows=records.filter((r)=>valid(r.custo_viagem_realizado??r.custo_viagem));
  const plannedKgRows=records.filter((r)=>valid(r.custo_viagem_planejado)&&Number(r.peso_kg)>0);
  const actualKgRows=records.filter((r)=>valid(r.custo_viagem_realizado??r.custo_viagem)&&Number(r.peso_kg)>0);
  const occRows=records.filter((r)=>valid(r.ocupacao_percentual));
  const plannedViabilityRows=records.filter((r)=>r.viagem_viavel_planejada===true||r.viagem_viavel_planejada===false);
  const actualViabilityRows=records.filter((r)=>(r.viagem_viavel_realizada??r.viagem_viavel)===true||(r.viagem_viavel_realizada??r.viagem_viavel)===false);
  const totalPlannedCost=plannedCostRows.reduce((sum,r)=>sum+Number(r.custo_viagem_planejado||0),0);
  const totalActualCost=actualCostRows.reduce((sum,r)=>sum+Number(r.custo_viagem_realizado??r.custo_viagem??0),0);
  const totalPlannedKg=plannedKgRows.reduce((sum,r)=>sum+Number(r.peso_kg||0),0);
  const totalActualKg=actualKgRows.reduce((sum,r)=>sum+Number(r.peso_kg||0),0);
  const plannedViable=plannedViabilityRows.filter((r)=>r.viagem_viavel_planejada===true).length;
  const actualViable=actualViabilityRows.filter((r)=>(r.viagem_viavel_realizada??r.viagem_viavel)===true).length;
  const seqApplicable=records.reduce((s,r)=>s+Number(r.sequenceApplicable||0),0),seqCompliant=records.reduce((s,r)=>s+Number(r.sequenceCompliant||0),0),radiusApplicable=records.reduce((s,r)=>s+Number(r.radiusApplicable||0),0),radiusCompliant=records.reduce((s,r)=>s+Number(r.radiusCompliant||0),0);
  const deliveryRows=records.filter((r)=>r.lincros_sync_healthy&&valid(r.lincros_deliveries_routed));
  const routedDeliveries=deliveryRows.reduce((sum,r)=>sum+Math.max(0,Number(r.lincros_deliveries_routed||0)),0);
  const pointedDeliveries=deliveryRows.reduce((sum,r)=>sum+Math.max(0,Number(r.lincros_deliveries_pointed||0)),0);
  return {
    totalPlannedTripCost:round(totalPlannedCost,2),plannedWeightedCostPerKg:totalPlannedKg?round(totalPlannedCost/totalPlannedKg,3):null,plannedViableTrips:plannedViable,plannedViabilityApplicable:plannedViabilityRows.length,plannedViabilityPercent:plannedViabilityRows.length?round(plannedViable/plannedViabilityRows.length*100,1):null,
    totalActualTripCost:round(totalActualCost,2),actualWeightedCostPerKg:totalActualKg?round(totalActualCost/totalActualKg,3):null,actualViableTrips:actualViable,actualViabilityApplicable:actualViabilityRows.length,actualViabilityPercent:actualViabilityRows.length?round(actualViable/actualViabilityRows.length*100,1):null,
    // aliases legados = visão realizada
    totalTripCost:round(totalActualCost,2),weightedCostPerKg:totalActualKg?round(totalActualCost/totalActualKg,3):null,viableTrips:actualViable,viabilityApplicable:actualViabilityRows.length,viabilityPercent:actualViabilityRows.length?round(actualViable/actualViabilityRows.length*100,1):null,
    averageOccupancyPercent:occRows.length?round(average(occRows.map((r)=>r.ocupacao_percentual)),1):null,
    routedDeliveries,pointedDeliveries,deliveryCompletionPercent:routedDeliveries?round(pointedDeliveries/routedDeliveries*100,1):null,
    sequenceApplicable:seqApplicable,sequenceCompliant:seqCompliant,sequenceCompliancePercent:seqApplicable?round(seqCompliant/seqApplicable*100,1):null,radiusApplicable,radiusCompliant,radiusCompliancePercent:radiusApplicable?round(radiusCompliant/radiusApplicable*100,1):null,lincrosTrips:records.filter((r)=>r.lincros_sync_healthy).length
  };
}


function devolutionRowSummary(items=[]){
  const applicable=(items||[]).filter((row)=>row.lincros_sync_healthy&&Number.isFinite(Number(row.lincros_deliveries_returned)));
  const returned=applicable.reduce((sum,row)=>sum+Math.max(0,Number(row.lincros_deliveries_returned||0)),0);
  const pointed=applicable.reduce((sum,row)=>sum+Math.max(0,Number(row.lincros_deliveries_pointed||0)),0);
  const planned=applicable.reduce((sum,row)=>sum+Math.max(0,Number(row.lincros_deliveries_routed||0)),0);
  const weightReturnedKg=applicable.reduce((sum,row)=>sum+Math.max(0,Number(row.lincros_returned_weight_kg||0)),0);
  const tripsWithReturns=applicable.filter((row)=>Number(row.lincros_deliveries_returned||0)>0).length;
  return {
    routes:applicable.length,
    tripsWithReturns,
    returnedDeliveries:returned,
    pointedDeliveries:pointed,
    plannedDeliveries:planned,
    returnedWeightKg:round(weightReturnedKg,3),
    devolutionRatePercent:pointed?round(returned/pointed*100,1):0,
    tripsWithReturnsPercent:applicable.length?round(tripsWithReturns/applicable.length*100,1):0,
  };
}
function groupDevolutionsByDimension(records=[],key=''){
  const map=new Map();
  for(const row of records||[]){const label=String(row[key]||'NÃO INFORMADA');if(!map.has(label))map.set(label,[]);map.get(label).push(row);}
  return [...map].map(([label,items])=>({label,...devolutionRowSummary(items)})).sort((a,b)=>b.returnedDeliveries-a.returnedDeliveries||b.returnedWeightKg-a.returnedWeightKg||a.label.localeCompare(b.label,'pt-BR'));
}
function groupDevolutionsByTime(records=[],grain='day'){
  const map=new Map();
  for(const row of records||[]){
    const date=dateIso(row.data);if(!date)continue;
    let key=date,meta={date};
    if(grain==='month'){key=date.slice(0,7);meta={month:key};}
    else if(grain==='week'){const w=weekRange(date);key=w.key;meta={start:w.start,end:w.end};}
    if(!map.has(key))map.set(key,{key,...meta,items:[]});map.get(key).items.push(row);
  }
  return [...map.values()].map(({items,...meta})=>({...meta,...devolutionRowSummary(items)})).sort((a,b)=>String(a.key||a.date||a.month||a.start).localeCompare(String(b.key||b.date||b.month||b.start)));
}
export function buildDevolutionIndicators(records=[]){
  const profileOf=(row={})=>{const explicit=normalizeText(row.perfil_rota||'');if(explicit.includes('REDE'))return 'REDE';if(explicit.includes('VAREJO'))return 'VAREJO';return /\bREDES?\b/.test(normalizeText(row.rota||''))?'REDE':'VAREJO';};
  const valid=(records||[]).filter((row)=>row.lincros_sync_healthy&&Number.isFinite(Number(row.lincros_deliveries_returned))).map((row)=>({...row,devolution_profile:profileOf(row)}));
  const tripRows=valid.map((row)=>({
    id:row.id,scheduleId:row.schedule_id||row.id,date:row.data,route:row.rota,region:row.regiao,profile:row.devolution_profile,plate:row.placa,driver:row.motorista,
    plannedDeliveries:Math.max(0,Number(row.lincros_deliveries_routed||0)),pointedDeliveries:Math.max(0,Number(row.lincros_deliveries_pointed||0)),returnedDeliveries:Math.max(0,Number(row.lincros_deliveries_returned||0)),returnedWeightKg:round(Math.max(0,Number(row.lincros_returned_weight_kg||0)),3),
    devolutionRatePercent:Number(row.lincros_deliveries_pointed||0)>0?round(Number(row.lincros_deliveries_returned||0)/Number(row.lincros_deliveries_pointed||0)*100,1):0,
  })).sort((a,b)=>b.returnedDeliveries-a.returnedDeliveries||b.returnedWeightKg-a.returnedWeightKg||String(b.date||'').localeCompare(String(a.date||'')));
  return {
    ...devolutionRowSummary(valid),
    byTrip:tripRows,
    byDriver:groupDevolutionsByDimension(valid,'motorista'),
    byRoute:groupDevolutionsByDimension(valid,'rota'),
    byRegion:groupDevolutionsByDimension(valid,'regiao'),
    byProfile:groupDevolutionsByDimension(valid,'devolution_profile'),
    daily:groupDevolutionsByTime(valid,'day'),weekly:groupDevolutionsByTime(valid,'week'),monthly:groupDevolutionsByTime(valid,'month'),
    calculationNote:'Devoluções usam os atendimentos marcados como devolvidos na Lincros das viagens concluídas. O percentual é devoluções ÷ atendimentos apontados. O peso devolvido soma PesoDevolvido quando informado pela Lincros.',
  };
}

const executionCache=new Map();
const executionInflight=new Map();
const EXECUTION_CACHE_MS=30000;
function executionCacheKey(user,period,options={}){const gpsStart=dateIso(options.gpsStart)||period.start||'',gpsEnd=dateIso(options.gpsEnd)||period.end||'',gpsMode=options.includeGps===false?'NO_GPS':'GPS';return `${user?.id||user?.email||'route'}|${period.start||''}|${period.end||''}|${gpsMode}|${gpsStart}|${gpsEnd}`;}

function currentPeriod(filters = {}) {
  const now = new Date();
  const start = dateIso(filters.start || filters.inicio)
    || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const end = dateIso(filters.end || filters.fim)
    || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { start, end };
}

async function safeRows(db, sql, ...binds) {
  try {
    return (await db.prepare(sql).bind(...binds).all()).results || [];
  } catch {
    return [];
  }
}

function domainScheduleKeys(row={}) {
  return [row.schedule_record_id,row.schedule_id,row.escala_id,row.escala_id_legado,row.legado_id]
    .filter((value)=>value!==null&&value!==undefined&&String(value)!=='').map(String);
}
function scheduleKeys(row={}) {
  return [row.id,row.sourceKey,row.legado_id,row.escala_id]
    .filter((value)=>value!==null&&value!==undefined&&String(value)!=='').map(String);
}
function latestBySchedule(rows) {
  const map = new Map();
  rows.forEach((row) => {
    for(const key of domainScheduleKeys(row)){
      const previous = map.get(key);
      if (!previous || String(row.updatedAt || row.updated_at || '').localeCompare(String(previous.updatedAt || previous.updated_at || '')) >= 0) map.set(key,row);
    }
  });
  return map;
}
function linkedRecord(map,schedule){return scheduleKeys(schedule).map((key)=>map.get(key)).find(Boolean)||{};}

function routeIndexes(rows) {
  const byId = new Map();
  const byName = new Map();
  rows.forEach((row) => {
    const id = String(row.ID || row.id || '').trim();
    const name = String(row.ROTA || row.NOME || row.rota || row.nome || '').trim();
    if (id) byId.set(id, row);
    if (name) byName.set(normalizeText(name), row);
  });
  return { byId, byName };
}

function driverRelationLabel(value = '') {
  const normalized = normalizeText(value);
  if (normalized.includes('TERCEIR')) return 'TERCEIRO';
  if (normalized.includes('PROPRI')) return 'PRÓPRIO';
  return String(value || '').trim();
}

function driverIndexes(rows = []) {
  const byName = new Map();
  const byRegistration = new Map();
  rows.forEach((row) => {
    const role = normalizeText(row.FUNCAO || row.CARGO || '');
    if (!role.includes('MOTORISTA') && !role.includes('CARRETEIRO')) return;
    const name = normalizeText(row.NOME || row.nome || '');
    const registration = normalizeText(row.MATRICULA || row.matricula || '');
    if (name) byName.set(name, row);
    if (registration) byRegistration.set(registration, row);
  });
  return { byName, byRegistration };
}

function driverRelationFor(driverName, indexes) {
  const key = normalizeText(driverName || '');
  const row = indexes.byName.get(key) || indexes.byRegistration.get(key);
  return driverRelationLabel(row?.VINCULO || row?.vinculo || '');
}

function routeMinutes(route, plannedDeliveries) {
  const go = Math.max(0, numberValue(route.TEMPO_IDA_MIN ?? route.tempo_ida_min ?? route.TEMPO_IDA));
  const between = Math.max(0, numberValue(route.TEMPO_ENTRE_CIDADES_MIN ?? route.tempo_entre_cidades_min ?? route.TEMPO_ENTRE_CIDADES));
  const back = Math.max(0, numberValue(route.TEMPO_VOLTA_MIN ?? route.tempo_volta_min ?? route.TEMPO_VOLTA));
  const perDelivery = Math.max(0, numberValue(route.TEMPO_POR_ENTREGA_MIN ?? route.tempo_por_entrega_min ?? route.TEMPO_POR_ENTREGA));
  const delivery = perDelivery * Math.max(0, Math.round(numberValue(plannedDeliveries)));
  return {
    go,
    between,
    back,
    delivery,
    travel: go + between + back,
    total: go + between + back + delivery,
  };
}


function normalizePlateKey(value='') {
  return normalizeText(value).replace(/[^A-Z0-9]/g,'');
}

function dateRangeInclusive(startValue,endValue,maxDays=60) {
  const start=dateIso(startValue),end=dateIso(endValue);
  if(!start||!end||end<start)return [];
  const rows=[];let cursor=start;
  for(let i=0;i<=maxDays&&cursor<=end;i+=1){rows.push(cursor);cursor=addDaysIso(cursor,1);}
  return rows;
}

function overnightEventIndex(rows=[]) {
  const map=new Map();
  for(const row of rows||[]){
    const scheduleId=String(row.SCHEDULE_RECORD_ID||row.schedule_record_id||row.scheduleId||'').trim();
    const day=dateIso(row.DATE_KEY||row.EFFECTIVE_AT||row.date||'');
    if(!scheduleId||!day)continue;
    if(!map.has(scheduleId))map.set(scheduleId,new Set());
    map.get(scheduleId).add(day);
  }
  return map;
}

function explicitOvernightDates(schedule={},monitoring={},eventIndex=new Map()) {
  const dates=new Set();
  for(const key of scheduleKeys(schedule)) for(const day of (eventIndex.get(String(key))||[])) if(day)dates.add(day);
  const history=Array.isArray(monitoring?.pernoite_datas)?monitoring.pernoite_datas:[];
  for(const value of history){const day=dateIso(value);if(day)dates.add(day);}
  const status=normalizeText(monitoring?.status_monitoramento||monitoring?.status||'');
  if(status==='PERNOITE'){
    const legacy=dateIso(monitoring?.pernoite_em||monitoring?.updatedAt||monitoring?.atualizado_em||'');
    if(legacy)dates.add(legacy);
  }
  return [...dates].sort();
}

function gpsRetentionIndexes(rows=[]) {
  const bySchedule=new Map(),byPlate=new Map();
  const push=(map,key,row)=>{if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(row);};
  for(const row of rows||[]){
    const scheduleId=String(row.SCHEDULE_ID||row.schedule_id||'').trim();
    const plate=normalizePlateKey(row.PLATE||row.placa||'');
    push(bySchedule,scheduleId,row);push(byPlate,plate,row);
  }
  return {bySchedule,byPlate};
}

function gpsCoverageIndex(rows=[]) {
  const set=new Set();
  for(const row of rows||[]){
    const plate=normalizePlateKey(row.PLATE||row.placa||'');
    const day=dateIso(row.DATE_KEY||row.GPS_DATE||row.date||'');
    if(plate&&day)set.add(`${plate}|${day}`);
  }
  return set;
}

function gpsRetentionSummary(schedule={},plate='',route='',departureAt='',returnAt='',indexes={bySchedule:new Map(),byPlate:new Map()}) {
  const seen=new Set(),rows=[];
  for(const key of scheduleKeys(schedule)) for(const row of (indexes.bySchedule.get(String(key))||[])){
    const token=String(row.RETENTION_KEY||`${row.PLATE}|${row.STARTED_AT}|${row.DURATION_MINUTES}`);if(seen.has(token))continue;seen.add(token);rows.push(row);
  }
  if(!rows.length){
    const plateRows=indexes.byPlate.get(normalizePlateKey(plate))||[];
    for(const row of plateRows){
      const started=String(row.STARTED_AT||row.started_at||'').replace(' ','T').slice(0,19);
      if(started&&departureAt&&started<departureAt)continue;
      if(started&&returnAt&&started>returnAt)continue;
      if(route&&row.ROUTE&&normalizeText(row.ROUTE)!==normalizeText(route))continue;
      const token=String(row.RETENTION_KEY||`${row.PLATE}|${row.STARTED_AT}|${row.DURATION_MINUTES}`);if(seen.has(token))continue;seen.add(token);rows.push(row);
    }
  }
  return {minutes:Math.max(0,Math.round(rows.reduce((sum,row)=>sum+Math.max(0,numberValue(row.DURATION_MINUTES||row.duration_minutes)),0))),stops:rows.length};
}

function tripHasGpsCoverage(plate='',departureAt='',returnAt='',coverage=new Set()) {
  const key=normalizePlateKey(plate);if(!key)return false;
  const days=dateRangeInclusive(departureAt,returnAt,60);
  return days.some((day)=>coverage.has(`${key}|${day}`));
}

/**
 * Espelha calculateIndicatorRealizedRouteMinutes_() da v2.0.40:
 * - cada dia completo anterior ao retorno vale 10 horas;
 * - no último dia, conta do horário-base da saída até o retorno;
 * - soma 60 minutos de intervalo no fechamento.
 */
function realizedRouteMinutes(departureValue, returnValue) {
  const departureEpoch = epoch(departureValue);
  const returnEpoch = epoch(returnValue);
  if (!Number.isFinite(departureEpoch) || !Number.isFinite(returnEpoch) || returnEpoch < departureEpoch) return null;

  const departureDate = dateIso(departureValue);
  const returnDate = dateIso(returnValue);
  if (!departureDate || !returnDate) return null;

  const departureOrdinal = Math.floor(Date.parse(`${departureDate}T00:00:00Z`) / 86400000);
  const returnOrdinal = Math.floor(Date.parse(`${returnDate}T00:00:00Z`) / 86400000);
  const fullJourneyDays = Math.max(0, returnOrdinal - departureOrdinal);
  const baseTime = timeOnly(departureValue);
  const lastDayStart = baseTime ? `${returnDate}T${baseTime}` : departureValue;
  const lastDayWorkedMinutes = Math.max(0, Number(diffMinutes(lastDayStart, returnValue) || 0));
  const journeyMinutes = 10 * 60;
  const finalDayBreakMinutes = 60;
  const totalMinutes = fullJourneyDays * journeyMinutes + lastDayWorkedMinutes + finalDayBreakMinutes;

  return {
    totalMinutes: Math.round(totalMinutes),
    fullJourneyDays,
    journeyMinutes,
    lastDayWorkedMinutes: Math.round(lastDayWorkedMinutes),
    finalDayBreakMinutes,
    elapsedClockMinutes: Math.max(0, Number(diffMinutes(departureValue, returnValue) || 0)),
    lastDayStart,
  };
}

function realizedTripDays(departureValue, returnValue) {
  const minutes = diffMinutes(departureValue, returnValue);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  // DURAÇÃO_DIAS representa a quantidade de períodos de até 24h planejados para a rota.
  // Assim, apenas atravessar a meia-noite não cria um novo dia realizado.
  return Math.max(1, Math.ceil(minutes / (24 * 60)));
}

export function buildExecutionRecordsFromData({ schedules = [], departures = [], monitorings = [], returns = [], routes = [], employees = [], overnightEvents = [], gpsRetentions = [], gpsCoverage = [] } = {}, period = {}) {
  const departureBy = latestBySchedule(departures.filter((row) => normalizeText(row.status_saida || row.status) === 'SAIU'));
  const monitoringBy = latestBySchedule(monitorings);
  const returnBy = latestBySchedule(returns);
  const routeCatalog = routeIndexes(routes);
  const driverCatalog = driverIndexes(employees);
  const overnightEventsBySchedule=overnightEventIndex(overnightEvents);
  const retentionIndexes=gpsRetentionIndexes(gpsRetentions);
  const gpsCoverageDays=gpsCoverageIndex(gpsCoverage);

  return schedules
    .filter((schedule) => normalizeText(schedule.status) !== 'CANCELADO' && !isOperationallyExcludedTrip(schedule))
    .map((schedule) => {
      const scheduleId=String(schedule.id||'');
      const departure = linkedRecord(departureBy,schedule);
      const monitoring = linkedRecord(monitoringBy,schedule);
      const returned = linkedRecord(returnBy,schedule);
      if (!departure.hora_real || !returned.retorno_real) return null;

      const departureAt = localDateTime(schedule.data, departure.hora_real);
      const returnAt = returned.retorno_real;
      const realized = realizedRouteMinutes(departureAt, returnAt);
      if (!realized) return null;
      const explicitOvernights=explicitOvernightDates(schedule,monitoring,overnightEventsBySchedule);
      const realizedOvernights=explicitOvernights.length;
      const actualDays=realizedTripDays(departureAt,returnAt);
      const retention=gpsRetentionSummary(schedule,departure.placa||schedule.placa,schedule.rota,departureAt,returnAt,retentionIndexes);
      const gpsAvailable=tripHasGpsCoverage(departure.placa||schedule.placa,departureAt,returnAt,gpsCoverageDays);
      const gpsStoppedMinutes=Math.min(realized.elapsedClockMinutes,retention.minutes);
      const gpsTransitMinutes=gpsAvailable?Math.max(0,realized.elapsedClockMinutes-gpsStoppedMinutes):0;

      const route = routeCatalog.byId.get(String(schedule.rota_id || schedule.route_id || ''))
        || routeCatalog.byName.get(normalizeText(schedule.rota))
        || {};
      // Para manter o histórico fiel, a duração gravada na escala (snapshot do planejamento)
      // tem prioridade. A Base de Rotas é usada somente como fallback para registros antigos.
      const plannedDays = Math.max(1, Math.round(numberValue(schedule.duracao_dias || route.DURACAO_DIAS || 1)));
      const excessDays = Math.max(0, Number(actualDays || 1) - plannedDays);
      const plannedDeliveries = Math.max(0, Math.round(numberValue(schedule.qtd_entregas)));
      const hasReturnDeliveries = returned.entregas !== '' && returned.entregas !== null && returned.entregas !== undefined;
      const hasMonitoringDeliveries = monitoring.entregas_realizadas !== '' && monitoring.entregas_realizadas !== null && monitoring.entregas_realizadas !== undefined;
      const deliveries = hasReturnDeliveries
        ? Math.max(0, Math.round(numberValue(returned.entregas)))
        : hasMonitoringDeliveries
          ? Math.max(0, Math.round(numberValue(monitoring.entregas_realizadas)))
          : plannedDeliveries;
      const deliverySource = hasReturnDeliveries ? 'RETORNO' : hasMonitoringDeliveries ? 'MONITORAMENTO' : 'ESCALA_PLANEJADA';
      const planned = routeMinutes(route, plannedDeliveries);
      const routeTimeWithTravelMinutes = realized.totalMinutes;
      const routeTimeWithoutTravelMinutes = Math.max(0, Math.round(
        routeTimeWithTravelMinutes - planned.travel - realized.finalDayBreakMinutes,
      ));
      const productiveHours = routeTimeWithoutTravelMinutes / 60;
      const tons = normalizedWeightTons(schedule);
      const assists = Math.max(0, Math.round(numberValue(returned.apoios)));
      const devolutions = Math.max(0, Math.round(numberValue(returned.devolucoes)));
      const plannedDepartureAt = localDateTime(schedule.data, departure.hora_programada || schedule.horario_ponto);
      const departureDeviation = Number.isFinite(diffMinutes(plannedDepartureAt, departureAt))
        ? diffMinutes(plannedDepartureAt, departureAt)
        : null;
      const expectedReturnAt = monitoring.previsao_retorno || schedule.previsao_retorno || '';
      const returnDeviation = Number.isFinite(diffMinutes(expectedReturnAt, returnAt))
        ? diffMinutes(expectedReturnAt, returnAt)
        : null;
      const planningAdherence = planned.total > 0
        ? Math.max(0, Math.min(100, 100 - (Math.abs(routeTimeWithTravelMinutes - planned.total) / planned.total * 100)))
        : 0;
      const deliveryAdherence = plannedDeliveries > 0
        ? Math.max(0, Math.min(100, deliveries / plannedDeliveries * 100))
        : deliveries > 0 ? 100 : 0;

      return {
        id: scheduleId,
        schedule_id: scheduleId,
        data: schedule.data,
        status: returned.status || monitoring.status || departure.status || schedule.status,
        sequencia: schedule.sequencia,
        ocs: schedule.ocs,
        rota: schedule.rota,
        regiao: schedule.regiao,
        perfil_rota: schedule.perfil || schedule.perfil_rota || route.PERFIL || route.perfil || '',
        placa: departure.placa || schedule.placa,
        motorista: departure.motorista || schedule.motorista,
        motorista_vinculo: driverRelationFor(departure.motorista || schedule.motorista, driverCatalog),
        ajudantes: departure.ajudantes || schedule.ajudantes,
        peso_t: round(tons, 5),
        peso_kg: round(tons * 1000, 2),
        entregas: deliveries,
        entregas_planejadas: plannedDeliveries,
        fonte_entregas: deliverySource,
        apoios: assists,
        devolucoes: devolutions,
        saida_programada: departure.hora_programada || schedule.horario_ponto,
        saida_real: departure.hora_real,
        retorno_previsto: expectedReturnAt,
        retorno_real: returnAt,
        atraso_minutos: departureDeviation,
        dentro_tolerancia_saida: departureDeviation === null ? null : departureDeviation <= 30,
        desvio_retorno_minutos: returnDeviation,
        tempo_real_min: routeTimeWithTravelMinutes,
        tempo_real_h: round(routeTimeWithTravelMinutes / 60, 2),
        tempo_com_deslocamento_min: routeTimeWithTravelMinutes,
        tempo_com_deslocamento_h: round(routeTimeWithTravelMinutes / 60, 2),
        tempo_deslocamento_min: Math.round(planned.travel),
        tempo_entregas_planejado_min: Math.round(planned.delivery),
        tempo_planejado_min: Math.round(planned.total),
        tempo_sem_deslocamento_min: routeTimeWithoutTravelMinutes,
        tempo_sem_deslocamento_h: round(productiveHours, 2),
        horas_tonelada: tons ? round(productiveHours / tons, 3) : 0,
        toneladas_hora: productiveHours ? round(tons / productiveHours, 2) : 0,
        entregas_hora: productiveHours ? round(deliveries / productiveHours, 2) : 0,
        aderencia_planejamento: round(planningAdherence, 1),
        aderencia_entregas: round(deliveryAdherence, 1),
        jornada_dias_completos: realized.fullJourneyDays,
        jornada_ultimo_dia_min: realized.lastDayWorkedMinutes,
        intervalo_final_min: realized.finalDayBreakMinutes,
        pernoites: realizedOvernights,
        pernoite_datas: explicitOvernights,
        duracao_dias: plannedDays,
        duracao_real_dias: Number(actualDays || 1),
        dias_excessivos: excessDays,
        // Campos legados preservados para compatibilidade com telas/consumidores antigos.
        // A partir da v1.0.44, 'pernoites_excedentes' significa dias de duração acima do planejado,
        // e NÃO quantidade de status PERNOITE acima do previsto.
        pernoites_planejados: Math.max(0, plannedDays - 1),
        pernoites_excedentes: excessDays,
        tempo_total_relogio_min: realized.elapsedClockMinutes,
        gps_data_available: gpsAvailable,
        gps_stop_count: retention.stops,
        tempo_parado_gps_min: gpsAvailable?gpsStoppedMinutes:0,
        tempo_transito_gps_min: gpsTransitMinutes,
        finalizada: normalizeText(returned.status) === 'FINALIZADO' || Boolean(returned.retorno_real),
      };
    })
    .filter((row) => row && inPeriod(row.data, period.start, period.end));
}

export async function buildExecutionRecords(db, user, filters = {}, options = {}) {
  const period = currentPeriod(filters);
  const includeGps=options.includeGps!==false;
  const gpsStart=dateIso(options.gpsStart)||period.start;
  const gpsEnd=dateIso(options.gpsEnd)||period.end;
  const key=executionCacheKey(user,period,{includeGps,gpsStart,gpsEnd}); const now=Date.now();
  const cached=executionCache.get(key);
  if(cached&&now-cached.at<=EXECUTION_CACHE_MS)return cached.records;
  if(executionInflight.has(key))return executionInflight.get(key);
  const promise=(async()=>{
    const gpsExclusiveEnd=addDaysIso(gpsEnd,1)||gpsEnd;
    const [schedules,departures,monitorings,returns,routes,employees,overnightEvents,gpsRetentions,gpsCoverage] = await Promise.all([
      schedulesFor(db, user, { start: period.start, end: period.end }),
      listDomainRows(db, 'departures', { start: period.start, end: period.end, limit: 5000 }),
      listDomainRows(db, 'monitoring', { start: period.start, end: period.end, limit: 5000 }),
      listDomainRows(db, 'returns', { start: period.start, end: period.end, limit: 5000 }),
      safeRows(db, 'SELECT * FROM BASE_ROTAS'),
      safeRows(db, "SELECT NOME,MATRICULA,FUNCAO,VINCULO FROM BASE_COLABORADORES WHERE ATIVO=1"),
      safeRows(db, "SELECT SCHEDULE_RECORD_ID,DATE_KEY,EFFECTIVE_AT FROM ROUTE_RESOURCE_EVENTS WHERE STATUS='PERNOITE' AND UPPER(COALESCE(SOURCE,''))='MONITORAMENTO' AND DATE_KEY>=? AND DATE_KEY<=?", period.start, period.end),
      includeGps?safeRows(db, "SELECT RETENTION_KEY,DATE_KEY,PLATE,ROUTE,DRIVER_NAME,SCHEDULE_ID,STARTED_AT,LAST_SEEN_AT,ENDED_AT,DURATION_MINUTES,ACTIVE FROM ROUTE_GPS_RETENTIONS WHERE DATE_KEY>=? AND DATE_KEY<=?", gpsStart, gpsEnd):Promise.resolve([]),
      includeGps?safeRows(db, "SELECT PLATE,SUBSTR(GPS_TIME,1,10) AS DATE_KEY,COUNT(*) AS POINTS,MIN(GPS_TIME) AS FIRST_GPS_AT,MAX(GPS_TIME) AS LAST_GPS_AT FROM ROUTE_GPS_POSITIONS WHERE GPS_TIME>=? AND GPS_TIME<? GROUP BY PLATE,SUBSTR(GPS_TIME,1,10)", `${gpsStart}T00:00:00`, `${gpsExclusiveEnd}T00:00:00`):Promise.resolve([]),
    ]);
    const records=buildExecutionRecordsFromData({ schedules, departures, monitorings, returns, routes, employees, overnightEvents, gpsRetentions, gpsCoverage }, period);
    executionCache.set(key,{at:Date.now(),records});
    while(executionCache.size>12)executionCache.delete(executionCache.keys().next().value);
    return records;
  })().finally(()=>executionInflight.delete(key));
  executionInflight.set(key,promise);
  return promise;
}

export function summarizeExecutionRecords(records) {
  const totalHours = records.reduce((sum, row) => sum + numberValue(row.tempo_sem_deslocamento_h), 0);
  const totalHoursWithTravel = records.reduce((sum, row) => sum + numberValue(row.tempo_com_deslocamento_h), 0);
  const totalTons = records.reduce((sum, row) => sum + numberValue(row.peso_t), 0);
  const deliveries = records.reduce((sum, row) => sum + numberValue(row.entregas), 0);
  const assists = records.reduce((sum, row) => sum + numberValue(row.apoios), 0);
  const devolutions = records.reduce((sum, row) => sum + numberValue(row.devolucoes), 0);
  const departures = records.filter((row) => row.saida_real);
  const punctual = departures.filter((row) => row.dentro_tolerancia_saida === true);

  return {
    routes: records.length,
    completedRoutes: records.filter((row) => row.finalizada).length,
    totalTons: round(totalTons, 2),
    totalDeliveries: deliveries,
    totalAssists: assists,
    totalDevolutions: devolutions,
    routeHoursWithTravel: round(totalHoursWithTravel, 2),
    productiveHours: round(totalHours, 2),
    hoursPerTon: totalTons ? round(totalHours / totalTons, 3) : 0,
    tonsPerHour: totalHours ? round(totalTons / totalHours, 2) : 0,
    deliveriesPerHour: totalHours ? round(deliveries / totalHours, 2) : 0,
    averageDelayMinutes: round(average(departures.map((row) => numberValue(row.atraso_minutos))), 1),
    punctualityPercent: departures.length ? round(punctual.length / departures.length * 100, 1) : 0,
    planningAdherencePercent: round(average(records.map((row) => row.aderencia_planejamento)), 1),
    deliveryAdherencePercent: round(average(records.map((row) => row.aderencia_entregas)), 1),
    accumulatedOvernights: records.reduce((sum, row) => sum + numberValue(row.pernoites), 0),
  };
}

function group(records, key) {
  const map = new Map();
  records.forEach((row) => {
    const label = String(row[key] || 'NÃO INFORMADA');
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(row);
  });
  return [...map]
    .map(([label, items]) => ({ label, ...summarizeExecutionRecords(items) }))
    .sort((a, b) => b.routes - a.routes || a.label.localeCompare(b.label, 'pt-BR'));
}

function groupOccupancy(records, key) {
  const map = new Map();
  for (const row of records || []) {
    const occupancy = Number(row.ocupacao_percentual);
    const capacityT = Number(row.veiculo_capacidade_t);
    const weightKg = Number(row.peso_kg);
    if (!Number.isFinite(occupancy) || !Number.isFinite(capacityT) || capacityT <= 0 || !Number.isFinite(weightKg) || weightKg < 0) continue;
    const label = String(row[key] || 'NÃO INFORMADO');
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(row);
  }
  return [...map].map(([label, items]) => {
    const totalWeightKg = items.reduce((sum, row) => sum + Math.max(0, Number(row.peso_kg) || 0), 0);
    const totalCapacityKg = items.reduce((sum, row) => sum + Math.max(0, Number(row.veiculo_capacidade_t) || 0) * 1000, 0);
    return {
      label,
      trips: items.length,
      totalWeightKg: round(totalWeightKg, 1),
      totalCapacityKg: round(totalCapacityKg, 1),
      averageOccupancyPercent: round(average(items.map((row) => row.ocupacao_percentual)), 1),
      weightedOccupancyPercent: totalCapacityKg ? round(totalWeightKg / totalCapacityKg * 100, 1) : null,
    };
  }).sort((a, b) => (b.weightedOccupancyPercent ?? -1) - (a.weightedOccupancyPercent ?? -1) || b.trips - a.trips || a.label.localeCompare(b.label, 'pt-BR'));
}

function addDaysIso(value, days = 0) {
  const date = dateIso(value);
  if (!date) return '';
  const epochMs = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(epochMs)) return '';
  return new Date(epochMs + Math.round(numberValue(days)) * 86400000).toISOString().slice(0, 10);
}

function weekRange(value) {
  const date = dateIso(value);
  if (!date) return { key: '', start: '', end: '' };
  const epochMs = Date.parse(`${date}T00:00:00Z`);
  const weekday = new Date(epochMs).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  const start = addDaysIso(date, -mondayOffset);
  return { key: start, start, end: addDaysIso(start, 6) };
}

function overnightRowSummary(items = []) {
  const totalRoutes = items.length;
  const tripsWithExcess = items.filter((row) => numberValue(row.dias_excessivos ?? row.pernoites_excedentes) > 0).length;
  const excessDays = items.reduce((sum, row) => sum + Math.max(0, numberValue(row.dias_excessivos ?? row.pernoites_excedentes)), 0);
  const plannedDays = items.reduce((sum, row) => sum + Math.max(1, numberValue(row.duracao_dias || 1)), 0);
  const actualDays = items.reduce((sum, row) => sum + Math.max(1, numberValue(row.duracao_real_dias || row.duracao_dias || 1)), 0);
  const explicitOvernights = items.reduce((sum, row) => sum + Math.max(0, numberValue(row.pernoites)), 0);
  return {
    routes: totalRoutes,
    tripsWithExcess,
    excessDays,
    plannedDays,
    actualDays,
    // Compatibilidade com versões anteriores da API.
    plannedOvernights: Math.max(0, plannedDays - totalRoutes),
    realizedOvernights: explicitOvernights,
    excessRatePercent: totalRoutes ? round(tripsWithExcess / totalRoutes * 100, 1) : 0,
    averageExcessDays: tripsWithExcess ? round(excessDays / tripsWithExcess, 2) : 0,
  };
}

function groupOvernightsByDimension(records = [], key = '') {
  const map = new Map();
  records.forEach((row) => {
    const label = String(row[key] || 'NÃO INFORMADA');
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(row);
  });
  return [...map].map(([label, items]) => ({ label, ...overnightRowSummary(items) }))
    .sort((a, b) => b.excessDays - a.excessDays || b.tripsWithExcess - a.tripsWithExcess || a.label.localeCompare(b.label, 'pt-BR'));
}

function excessEventSummary(items = []) {
  const tripIds = new Set(items.map((row) => String(row.id || row.schedule_id || '')).filter(Boolean));
  const tripsWithExcess = tripIds.size || items.length;
  return {
    routes: tripsWithExcess,
    tripsWithExcess,
    excessDays: items.length,
    excessRatePercent: tripsWithExcess ? 100 : 0,
    averageExcessDays: tripsWithExcess ? round(items.length / tripsWithExcess, 2) : 0,
  };
}

function groupExcessEventsByTime(events = [], grain = 'day') {
  const map = new Map();
  events.forEach((row) => {
    const date = dateIso(row.data_excesso || row.data);
    if (!date) return;
    let key = date;
    let meta = { date };
    if (grain === 'month') {
      key = date.slice(0, 7);
      meta = { month: key };
    } else if (grain === 'week') {
      const week = weekRange(date);
      key = week.key;
      meta = { start: week.start, end: week.end };
    }
    if (!map.has(key)) map.set(key, { key, ...meta, items: [] });
    map.get(key).items.push(row);
  });
  return [...map.values()].map(({ items, ...meta }) => ({ ...meta, ...excessEventSummary(items) }))
    .sort((a, b) => String(a.key || a.date || a.month || a.start).localeCompare(String(b.key || b.date || b.month || b.start)));
}

function excessDatesForRow(row = {}, plannedDays = 1, excessDays = 0) {
  const count = Math.max(0, Math.round(numberValue(excessDays)));
  if (!count) return [];
  const departureAt = localDateTime(row.data, row.saida_real_em || row.saida_real || '');
  const fallbackDate = dateIso(row.data);
  const dates = [];
  for (let index = 0; index < count; index += 1) {
    const thresholdDays = plannedDays + index;
    const thresholdAt = departureAt ? addMinutes(departureAt, thresholdDays * 24 * 60) : '';
    const eventDate = dateIso(thresholdAt) || addDaysIso(fallbackDate, thresholdDays);
    if (eventDate) dates.push(eventDate);
  }
  return dates;
}

function normalizeOvernightRecord(row = {}) {
    const plannedDays = Math.max(1, Math.round(numberValue(row.duracao_dias || 1)));
    const elapsedMinutes = numberValue(row.tempo_total_relogio_min, Number.NaN);
    const calculatedActualDays = Number.isFinite(elapsedMinutes) && elapsedMinutes >= 0
      ? Math.max(1, Math.ceil(elapsedMinutes / (24 * 60)))
      : Math.max(1, Math.round(numberValue(row.duracao_real_dias || plannedDays)));
    const actualDays = Math.max(1, Math.round(numberValue(row.duracao_real_dias || calculatedActualDays)));
    const excessDays = Math.max(0, actualDays - plannedDays);
    const realizedOvernights = Math.max(0, Math.round(numberValue(row.pernoites)));
    return {
      ...row,
      duracao_dias: plannedDays,
      duracao_real_dias: actualDays,
      dias_excessivos: excessDays,
      pernoites: realizedOvernights,
      pernoites_planejados: Math.max(0, plannedDays - 1),
      pernoites_excedentes: excessDays,
      dias_excessivos_datas: excessDatesForRow(row, plannedDays, excessDays),
    };
}

function dedupeOvernightRows(records = []) {
  const map = new Map();
  records.forEach((row, index) => {
    const key = String(row.id || row.schedule_id || `${row.data || ''}|${row.rota || ''}|${row.placa || ''}|${index}`);
    map.set(key, row);
  });
  return [...map.values()];
}

export function buildOvernightIndicators(records = [], options = {}) {
  const period = options?.period || {};
  const sourceRecords = Array.isArray(options?.eventRecords) ? options.eventRecords : records;
  const baseNormalized = dedupeOvernightRows((records || []).map(normalizeOvernightRecord));
  const sourceNormalized = dedupeOvernightRows((sourceRecords || []).map(normalizeOvernightRecord));
  const eventRows = [];
  const sourceById = new Map();
  sourceNormalized.forEach((row, rowIndex) => {
    const rowKey = String(row.id || row.schedule_id || `${row.data || ''}|${row.rota || ''}|${row.placa || ''}|${rowIndex}`);
    const dates = (row.dias_excessivos_datas || []).filter((date) => inPeriod(date, period.start, period.end));
    sourceById.set(rowKey, { ...row, dias_excessivos_periodo: dates.length, dias_excessivos_datas_periodo: dates });
    dates.forEach((date, index) => eventRows.push({
      ...row,
      data_excesso: date,
      numero_dia_excessivo: index + 1,
      dias_excessivos: 1,
      pernoites_excedentes: 1,
    }));
  });

  const summaryRowsById = new Map();
  baseNormalized.forEach((row, index) => {
    const rowKey = String(row.id || row.schedule_id || `${row.data || ''}|${row.rota || ''}|${row.placa || ''}|${index}`);
    const source = sourceById.get(rowKey) || row;
    const dates = (source.dias_excessivos_datas || []).filter((date) => inPeriod(date, period.start, period.end));
    summaryRowsById.set(rowKey, { ...source, dias_excessivos: dates.length, pernoites_excedentes: dates.length, dias_excessivos_datas_periodo: dates });
  });
  sourceById.forEach((row, rowKey) => {
    if (!row.dias_excessivos_periodo || summaryRowsById.has(rowKey)) return;
    summaryRowsById.set(rowKey, {
      ...row,
      dias_excessivos: row.dias_excessivos_periodo,
      pernoites_excedentes: row.dias_excessivos_periodo,
    });
  });
  const normalized = [...summaryRowsById.values()];
  const summary = overnightRowSummary(normalized);
  const details = normalized.filter((row) => row.dias_excessivos > 0).map((row) => ({
    id: row.id,
    data: row.data,
    rota: row.rota,
    regiao: row.regiao,
    placa: row.placa,
    motorista: row.motorista,
    duracao_dias: row.duracao_dias,
    duracao_real_dias: row.duracao_real_dias,
    dias_excessivos: row.dias_excessivos,
    dias_excessivos_total_viagem: (row.dias_excessivos_datas || []).length,
    dias_excessivos_datas: row.dias_excessivos_datas_periodo || [],
    pernoites_realizados: row.pernoites,
    pernoite_datas: Array.isArray(row.pernoite_datas)?row.pernoite_datas:[],
    // Compatibilidade do payload com a tela antiga.
    pernoites_planejados: Math.max(0,row.duracao_dias-1),
    pernoites_excedentes: row.dias_excessivos,
    saida_real: row.saida_real,
    retorno_real: row.retorno_real,
    tempo_total_relogio_min: row.tempo_total_relogio_min,
  })).sort((a, b) => String(b.dias_excessivos_datas?.[0] || b.data || '').localeCompare(String(a.dias_excessivos_datas?.[0] || a.data || '')) || b.dias_excessivos - a.dias_excessivos);
  return {
    ...summary,
    byDay: groupExcessEventsByTime(eventRows, 'day'),
    byWeek: groupExcessEventsByTime(eventRows, 'week'),
    byMonth: groupExcessEventsByTime(eventRows, 'month'),
    byRegion: groupOvernightsByDimension(normalized, 'regiao'),
    byRoute: groupOvernightsByDimension(normalized, 'rota'),
    details,
    calculationNote: 'Dias excessivos = duração realizada da viagem - duração planejada da rota, limitado a zero. Cada dia excessivo é lançado na data em que o limite planejado foi efetivamente ultrapassado: em uma rota de 1 dia, o primeiro excesso ocorre após 24h da saída; o segundo, após 48h; e assim por diante. Por isso, o gráfico diário, semanal e mensal usa a data de ocorrência do excesso, e não a data da escala. A simples virada da meia-noite não cria excesso.',
  };
}

function gpsMotionRowSummary(items=[]) {
  const covered=(items||[]).filter((row)=>row.gps_data_available);
  const transit=covered.reduce((sum,row)=>sum+Math.max(0,numberValue(row.tempo_transito_gps_min)),0);
  const stopped=covered.reduce((sum,row)=>sum+Math.max(0,numberValue(row.tempo_parado_gps_min)),0);
  const total=transit+stopped;
  return {
    routes:items.length,
    routesWithGps:covered.length,
    routesWithoutGps:Math.max(0,items.length-covered.length),
    transitMinutes:Math.round(transit),
    stoppedMinutes:Math.round(stopped),
    totalMinutes:Math.round(total),
    transitPercent:total?round(transit/total*100,1):0,
    stoppedPercent:total?round(stopped/total*100,1):0,
    gpsCoveragePercent:items.length?round(covered.length/items.length*100,1):0,
    stopEvents:covered.reduce((sum,row)=>sum+Math.max(0,numberValue(row.gps_stop_count)),0),
  };
}

function groupGpsMotion(records=[],key='') {
  const map=new Map();
  for(const row of records||[]){const label=String(row[key]||'NÃO INFORMADA');if(!map.has(label))map.set(label,[]);map.get(label).push(row);}
  return [...map].map(([label,items])=>({label,...gpsMotionRowSummary(items)})).sort((a,b)=>b.totalMinutes-a.totalMinutes||a.label.localeCompare(b.label,'pt-BR'));
}

export function buildGpsMotionIndicators(records=[]) {
  const summary=gpsMotionRowSummary(records);
  return {
    ...summary,
    byRegion:groupGpsMotion(records,'regiao'),
    byRoute:groupGpsMotion(records,'rota'),
    byDriver:groupGpsMotion(records,'motorista'),
    calculationNote:'Tempo parado usa as imobilizações registradas pelo GPS a partir de 10 minutos durante uma viagem ativa. Tempo em trânsito é estimado pelo tempo corrido entre saída e retorno menos essas imobilizações. Viagens sem histórico GPS no período ficam fora da proporção, em vez de serem consideradas 100% em trânsito.',
  };
}


export function applyExecutionFilters(records=[],filters={}) {
  const region=normalizeText(filters.region||filters.regiao||'');
  const route=normalizeText(filters.route||filters.rota||'');
  const driver=normalizeText(filters.driver||filters.motorista||'');
  const profile=normalizeText(filters.profile||filters.perfil||'');
  const driverRelation=normalizeText(filters.driverRelation||filters.driver_relation||filters.vinculoMotorista||filters.vinculo_motorista||'');
  const plate=normalizeText(filters.plate||filters.placa||'');
  const query=normalizeText(filters.q||filters.busca||'');
  return (records||[]).filter((row)=>{
    if(region&&normalizeText(row.regiao)!==region)return false;
    if(route&&normalizeText(row.rota)!==route)return false;
    if(driver&&normalizeText(row.motorista)!==driver)return false;
    if(profile&&normalizeText(row.perfil_rota)!==profile)return false;
    if(driverRelation&&normalizeText(row.motorista_vinculo)!==driverRelation)return false;
    if(plate&&normalizeText(row.placa)!==plate)return false;
    if(query&&!normalizeText([row.data,row.ocs,row.rota,row.regiao,row.perfil_rota,row.placa,row.motorista,row.motorista_vinculo,row.status].join(' ')).includes(query))return false;
    return true;
  });
}
function executionFilterOptions(records=[]) {
  const values=(key)=>[...new Set((records||[]).map((row)=>String(row[key]||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  return {regions:values('regiao'),routes:values('rota'),drivers:values('motorista'),driverRelations:values('motorista_vinculo'),profiles:values('perfil_rota'),plates:values('placa')};
}


function fleetBool(value,fallback=true){
  if(value===undefined||value===null||value==='')return fallback;
  if(typeof value==='boolean')return value;
  if(typeof value==='number')return value!==0;
  return !['0','FALSE','NAO','NÃO','INATIVO'].includes(normalizeText(value));
}
function fleetVehicleState(raw={},exists=true){
  return {
    exists:Boolean(exists),
    id:String(raw.ID??raw.id??''),
    plate:normalizeText(raw.PLACA??raw.placa??'').replace(/[^A-Z0-9]/g,''),
    type:String(raw.TIPO??raw.tipo??'').trim(),
    link:String(raw.VINCULO??raw.vinculo??'').trim(),
    carrier:String(raw.TRANSPORTADORA??raw.transportadora??'').trim(),
    currentLocation:String(raw.LOCAL_ATUAL??raw.local_atual??'').trim(),
    maintenanceForecast:String(raw.PREVISAO_PRONTO_MANUTENCAO??raw.previsao_pronto_manutencao??'').trim(),
    observations:String(raw.OBSERVACOES??raw.observacoes??'').trim(),
    active:fleetBool(raw.ATIVO??raw.ativo,true),
    status:normalizeText(raw.STATUS??raw.status??'DISPONÍVEL'),
  };
}
function fleetAuditEpoch(value=''){
  const iso=utcStoredIso(value);const n=Date.parse(iso);return Number.isFinite(n)?n:0;
}
function fleetDayCutoffUtc(date=''){const day=dateIso(date);return day?Date.parse(`${day}T03:00:00Z`):NaN;}
function fleetVehicleStateAt(current={},audits=[],day=''){
  const cutoff=fleetDayCutoffUtc(day);let state=fleetVehicleState(current,true);
  const desc=[...(audits||[])].sort((a,b)=>fleetAuditEpoch(b.CREATED_AT)-fleetAuditEpoch(a.CREATED_AT));
  for(const audit of desc){
    const at=fleetAuditEpoch(audit.CREATED_AT);if(!at||!Number.isFinite(cutoff)||at<=cutoff)continue;
    const details=parseJsonSafe(audit.DETAILS,{});const action=normalizeText(audit.ACTION||'');
    if(action==='CRIAR'){state={...state,exists:false,active:false};continue;}
    if(details.before&&typeof details.before==='object')state=fleetVehicleState(details.before,true);
  }
  return state;
}
function fleetDayList(start='',end=''){
  const out=[];let cursor=dateIso(start),last=dateIso(end);if(!cursor||!last)return out;
  for(let guard=0;cursor&&cursor<=last&&guard<370;guard+=1){out.push(cursor);cursor=addDaysIso(cursor,1);}
  return out;
}
function fleetLocalMoment(value='',fallbackDate=''){
  const raw=String(value||'').trim();if(!raw)return '';
  const hasZone=/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
  if(hasZone){
    const d=new Date(raw);if(Number.isFinite(d.getTime())){
      try{
        const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d);
        const get=(type)=>parts.find((p)=>p.type===type)?.value||'';return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
      }catch{}
    }
  }
  const day=dateIso(raw)||dateIso(fallbackDate);const time=timeOnly(raw)||(/^(\d{1,2}):(\d{2})/.test(raw)?`${raw.slice(0,5)}:00`:'');
  return day?`${day}T${time||'00:00:00'}`:'';
}
async function fleetTripIntervals(db,user,period={}){
  const start=addDaysIso(period.start,-90)||period.start,end=addDaysIso(period.end,90)||period.end;
  const [schedules,departures,returns]=await Promise.all([
    schedulesFor(db,user,{start,end:period.end}),
    listDomainRows(db,'departures',{start,end:period.end,limit:10000}),
    listDomainRows(db,'returns',{start,end,limit:10000}),
  ]);
  const departureBy=latestBySchedule((departures||[]).filter((row)=>normalizeText(row.status_saida||row.status)==='SAIU'));
  const returnBy=latestBySchedule(returns||[]);const intervals=[];
  for(const schedule of schedules||[]){
    if(normalizeText(schedule.status)==='CANCELADO')continue;
    const departure=linkedRecord(departureBy,schedule);if(!departure?.hora_real)continue;
    const returned=linkedRecord(returnBy,schedule);const plate=normalizeText(departure.placa||schedule.placa||'').replace(/[^A-Z0-9]/g,'');if(!plate)continue;
    const departedAt=fleetLocalMoment(localDateTime(schedule.data,departure.hora_real),schedule.data);if(!departedAt)continue;
    const returnedAt=fleetLocalMoment(returned?.retorno_real||'',schedule.data);
    intervals.push({plate,departedAt,returnedAt,scheduleId:String(schedule.id||''),route:String(schedule.rota||'')});
  }
  return intervals;
}
export function buildFleetAvailabilityFromData({vehicleRows=[],auditRows=[],intervals=[]}={},period={}){
  const auditsById=new Map();for(const row of auditRows||[]){const key=String(row.RECORD_ID??'');if(!auditsById.has(key))auditsById.set(key,[]);auditsById.get(key).push(row);}
  const days=[];
  for(const day of fleetDayList(period.start,period.end)){
    const activeStates=(vehicleRows||[]).map((row)=>fleetVehicleStateAt(row,auditsById.get(String(row.ID??row.id??''))||[],day)).filter((row)=>row.exists&&row.active&&row.plate);
    const activePlates=new Set(activeStates.map((row)=>row.plate));const cutoff=`${day}T00:00:00`;
    const activeTrips=(intervals||[]).filter((trip)=>trip.departedAt<cutoff&&(!trip.returnedAt||trip.returnedAt>cutoff)&&activePlates.has(trip.plate));
    const tripByPlate=new Map();
    for(const trip of activeTrips){
      const previous=tripByPlate.get(trip.plate);
      if(!previous||String(trip.departedAt||'')>String(previous.departedAt||''))tripByPlate.set(trip.plate,trip);
    }
    const inRouteSet=new Set(activeTrips.map((trip)=>trip.plate));
    const possibleStates=activeStates.filter((row)=>!inRouteSet.has(row.plate));
    const maintenanceStates=possibleStates.filter((row)=>/MANUTEN/.test(row.status));
    const maintenanceSet=new Set(maintenanceStates.map((row)=>row.plate));
    const availableStates=possibleStates.filter((row)=>!maintenanceSet.has(row.plate));
    const possible=possibleStates.length,available=availableStates.length;
    const vehicleDetails=activeStates.map((row)=>{
      const trip=tripByPlate.get(row.plate)||null;
      const indicatorStatus=trip?'EM ROTA NO INÍCIO':maintenanceSet.has(row.plate)?'MANUTENÇÃO':'DISPONÍVEL';
      return {
        plate:row.plate,
        type:row.type||'',
        link:row.link||'',
        carrier:row.carrier||'',
        indicatorStatus,
        registrationStatus:row.status||'DISPONÍVEL',
        route:trip?.route||'',
        departedAt:trip?.departedAt||'',
        returnedAt:trip?.returnedAt||'',
        maintenanceForecast:row.maintenanceForecast||'',
        currentLocation:row.currentLocation||'',
      };
    }).sort((a,b)=>{
      const order={'EM ROTA NO INÍCIO':0,'MANUTENÇÃO':1,'DISPONÍVEL':2};
      return (order[a.indicatorStatus]??9)-(order[b.indicatorStatus]??9)||a.plate.localeCompare(b.plate,'pt-BR');
    });
    days.push({date:day,totalFleet:activeStates.length,inRouteAtStart:inRouteSet.size,possibleFleet:possible,maintenance:maintenanceStates.length,available,availabilityPercent:possible?round(available/possible*100,2):null,inRoutePlates:[...inRouteSet].sort(),maintenancePlates:maintenanceStates.map((row)=>row.plate).sort(),availablePlates:availableStates.map((row)=>row.plate).sort(),vehicleDetails});
  }
  const validDays=days.filter((row)=>row.availabilityPercent!==null&&row.availabilityPercent!==undefined),latest=days[days.length-1]||null;
  return {daily:days,averagePercent:validDays.length?round(average(validDays.map((row)=>row.availabilityPercent)),2):null,latestPercent:latest?.availabilityPercent??null,latestDate:latest?.date||'',calculation:'Disponíveis = frota ativa − veículos que já iniciaram o dia em rota − veículos em manutenção. Disponibilidade = disponíveis ÷ frota possível, onde frota possível = frota ativa − veículos que já iniciaram o dia em rota.',maintenanceHistorySource:auditRows.length?'ROUTE_AUDIT + cadastro atual':'cadastro atual (sem histórico de edição disponível)'};
}
export async function getFleetAvailabilityIndicators(db,user,period={}){
  const [vehicleRows,auditRows,intervals]=await Promise.all([safeRows(db,'SELECT * FROM BASE_VEICULOS'),safeRows(db,"SELECT ID,ACTION,MODULE,RECORD_ID,DETAILS,CREATED_AT FROM ROUTE_AUDIT WHERE UPPER(COALESCE(MODULE,''))='VEICULOS' ORDER BY CREATED_AT,ID"),fleetTripIntervals(db,user,period)]);
  return buildFleetAvailabilityFromData({vehicleRows,auditRows,intervals},period);
}


export const DELIVERY_POINTING_JUSTIFICATIONS=Object.freeze(['SEM CELULAR','CELULAR QUEBRADO','MOTORISTA NÃO APONTOU']);

export async function ensureDeliveryPointingJustificationSchema(db){
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_LINCROS_POINTING_JUSTIFICATIONS (
      SCHEDULE_ID TEXT PRIMARY KEY,
      DATE_KEY TEXT,
      DRIVER_NAME TEXT,
      ROUTE TEXT,
      PLATE TEXT,
      JUSTIFICATION TEXT NOT NULL,
      UPDATED_BY INTEGER,
      UPDATED_BY_NAME TEXT,
      CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_LINCROS_POINTING_JUST_DATE ON ROUTE_LINCROS_POINTING_JUSTIFICATIONS(DATE_KEY)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_LINCROS_POINTING_JUST_DRIVER ON ROUTE_LINCROS_POINTING_JUSTIFICATIONS(DRIVER_NAME)`),
  ]);
}
function normalizedPointingJustification(value=''){
  const normalized=normalizeText(value);
  if(!normalized)return '';
  const match=DELIVERY_POINTING_JUSTIFICATIONS.find((item)=>normalizeText(item)===normalized);
  if(!match)throw new Error('Justificativa inválida. Escolha: Sem Celular, Celular Quebrado ou Motorista não apontou.');
  return match;
}
export async function saveDeliveryPointingJustification(db,user,payload={}){
  await ensureDeliveryPointingJustificationSchema(db);
  const rawIds=Array.isArray(payload.scheduleIds)?payload.scheduleIds:[payload.scheduleId];
  const scheduleIds=[...new Set(rawIds.map((value)=>String(value??'').trim()).filter(Boolean))].slice(0,100);
  if(!scheduleIds.length)throw new Error('Nenhuma viagem foi informada para registrar a justificativa.');
  const justification=normalizedPointingJustification(payload.justification);
  const actorId=Number(user?.id||0)||null,actorName=String(user?.name||user?.email||'Usuário').trim().slice(0,180);
  if(!justification){
    await db.batch(scheduleIds.map((id)=>db.prepare('DELETE FROM ROUTE_LINCROS_POINTING_JUSTIFICATIONS WHERE SCHEDULE_ID=?').bind(id)));
    return {scheduleIds,justification:'',cleared:true};
  }
  const statements=[];
  for(const scheduleId of scheduleIds){
    let source=null;
    try{
      source=await db.prepare(`SELECT M.DATE_KEY,M.DRIVER_NAME,M.ROUTE,M.PLATE,M.DATA_JSON,
        L.DATE_KEY AS L_DATE_KEY,L.DRIVER AS L_DRIVER,L.DMS_ROUTE AS L_ROUTE,L.PLATE AS L_PLATE
        FROM ROUTE_MONITORING M
        LEFT JOIN LINCROS_ROUTE_SYNC L ON CAST(L.SCHEDULE_ID AS TEXT)=CAST(M.SCHEDULE_ID AS TEXT)
        WHERE CAST(M.SCHEDULE_ID AS TEXT)=? ORDER BY M.ID DESC LIMIT 1`).bind(scheduleId).first();
    }catch{}
    if(!source){
      try{source=await db.prepare(`SELECT DATE_KEY AS L_DATE_KEY,DRIVER AS L_DRIVER,DMS_ROUTE AS L_ROUTE,PLATE AS L_PLATE FROM LINCROS_ROUTE_SYNC WHERE CAST(SCHEDULE_ID AS TEXT)=? ORDER BY CHECKED_AT DESC LIMIT 1`).bind(scheduleId).first();}catch{}
    }
    let data={};try{data=JSON.parse(String(source?.DATA_JSON||'{}'))||{};}catch{}
    const date=String(source?.DATE_KEY||source?.L_DATE_KEY||data.data||'').trim().slice(0,10);
    const driver=String(source?.DRIVER_NAME||source?.L_DRIVER||data.motorista||payload.driver||'').trim().slice(0,180);
    const route=String(source?.ROUTE||source?.L_ROUTE||data.rota||'').trim().slice(0,240);
    const plate=String(source?.PLATE||source?.L_PLATE||data.placa||'').trim().toUpperCase().slice(0,30);
    statements.push(db.prepare(`INSERT INTO ROUTE_LINCROS_POINTING_JUSTIFICATIONS
      (SCHEDULE_ID,DATE_KEY,DRIVER_NAME,ROUTE,PLATE,JUSTIFICATION,UPDATED_BY,UPDATED_BY_NAME,UPDATED_AT)
      VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(SCHEDULE_ID) DO UPDATE SET
        DATE_KEY=excluded.DATE_KEY,DRIVER_NAME=excluded.DRIVER_NAME,ROUTE=excluded.ROUTE,PLATE=excluded.PLATE,
        JUSTIFICATION=excluded.JUSTIFICATION,UPDATED_BY=excluded.UPDATED_BY,UPDATED_BY_NAME=excluded.UPDATED_BY_NAME,
        UPDATED_AT=CURRENT_TIMESTAMP`)
      .bind(scheduleId,date,driver,route,plate,justification,actorId,actorName));
  }
  if(statements.length)await db.batch(statements);
  return {scheduleIds,justification,updated:statements.length,updatedBy:actorName};
}
async function attachDeliveryPointingJustifications(db,indicator,period={}){
  const target=indicator||{summary:{},users:[],notPointing:[],routes:[]};
  try{
    await ensureDeliveryPointingJustificationSchema(db);
    const rows=await safeRows(db,`SELECT SCHEDULE_ID,JUSTIFICATION,UPDATED_BY_NAME,UPDATED_AT
      FROM ROUTE_LINCROS_POINTING_JUSTIFICATIONS
      WHERE COALESCE(DATE_KEY,'')='' OR (DATE_KEY>=? AND DATE_KEY<=?)`,period.start||'',period.end||'');
    const bySchedule=new Map(rows.map((row)=>[String(row.SCHEDULE_ID||''),row]));
    for(const route of target.routes||[]){
      const saved=bySchedule.get(String(route.scheduleId||''))||{};
      route.justification=String(saved.JUSTIFICATION||'');
      route.justificationUpdatedBy=String(saved.UPDATED_BY_NAME||'');
      route.justificationUpdatedAt=String(saved.UPDATED_AT||'');
    }
    for(const user of target.users||[]){
      const routeItems=(target.routes||[]).filter((row)=>normalizeText(row.driver)===normalizeText(user.driver));
      user.scheduleIds=[...new Set(routeItems.map((row)=>String(row.scheduleId||'')).filter(Boolean))];
      const saved=routeItems.map((row)=>row.justification).filter(Boolean);
      const unique=[...new Set(saved.map((value)=>normalizedPointingJustification(value)).filter(Boolean))];
      user.justification=unique.length===1?unique[0]:'';
      user.justificationMixed=unique.length>1;
      const latest=routeItems.filter((row)=>row.justificationUpdatedAt).sort((a,b)=>String(b.justificationUpdatedAt).localeCompare(String(a.justificationUpdatedAt)))[0];
      user.justificationUpdatedBy=latest?.justificationUpdatedBy||'';
      user.justificationUpdatedAt=latest?.justificationUpdatedAt||'';
    }
    target.notPointing=(target.users||[]).filter((row)=>row.pointed===0);
    target.summary=target.summary||{};
    target.summary.justifiedNotPointing=target.notPointing.filter((row)=>Boolean(row.justification)||row.justificationMixed).length;
    target.summary.pendingJustification=Math.max(0,target.notPointing.length-target.summary.justifiedNotPointing);
  }catch{
    for(const user of target.users||[]){user.scheduleIds=user.scheduleIds||[];user.justification=user.justification||'';user.justificationMixed=false;}
  }
  return target;
}


export function buildDeliveryPointingUsersFromRecords(records=[]){
  const routeRows=[];
  for(const row of records||[]){
    // A aba Indicadores é histórica: apontamentos Lincros só entram quando a viagem
    // possui saída + retorno confirmados (finalizada) e sincronização Lincros válida.
    if(!row?.finalizada||!row?.lincros_sync_healthy)continue;
    const planned=Math.max(0,Math.round(numberValue(row.lincros_deliveries_routed)));
    if(planned<=0)continue;
    const pointed=Math.min(planned,Math.max(0,Math.round(numberValue(row.lincros_deliveries_pointed))));
    const driver=String(row.motorista||'').trim();
    if(!driver)continue;
    routeRows.push({
      scheduleId:String(row.schedule_id||row.id||''),date:row.data||'',route:String(row.rota||'').trim(),
      region:String(row.regiao||'').trim(),profile:String(row.perfil_rota||'').trim(),plate:String(row.placa||'').trim().toUpperCase(),
      driver,driverRelation:String(row.motorista_vinculo||'').trim(),planned,pointed,
      percent:planned?round(pointed/planned*100,1):null,status:pointed>0?'APONTANDO':'NÃO APONTANDO',checkedAt:row.lincros_checked_at||''
    });
  }
  const grouped=new Map();
  for(const row of routeRows){
    const key=normalizeText(row.driver);let item=grouped.get(key);
    if(!item){item={driver:row.driver,driverRelation:row.driverRelation,routes:0,planned:0,pointed:0,plates:new Set(),routeNames:new Set(),dates:new Set(),scheduleIds:new Set(),lastCheckedAt:''};grouped.set(key,item);}
    item.routes+=1;item.planned+=row.planned;item.pointed+=row.pointed;if(row.plate)item.plates.add(row.plate);if(row.route)item.routeNames.add(row.route);if(row.date)item.dates.add(row.date);if(row.scheduleId)item.scheduleIds.add(String(row.scheduleId));if(String(row.checkedAt||'')>String(item.lastCheckedAt||''))item.lastCheckedAt=row.checkedAt||'';
  }
  const users=[...grouped.values()].map((item)=>({driver:item.driver,driverRelation:item.driverRelation,routes:item.routes,planned:item.planned,pointed:item.pointed,percent:item.planned?round(item.pointed/item.planned*100,1):null,status:item.pointed>0?'APONTANDO':'NÃO APONTANDO',plates:[...item.plates].sort(),routeNames:[...item.routeNames].sort(),dates:[...item.dates].sort(),scheduleIds:[...item.scheduleIds].sort(),lastCheckedAt:item.lastCheckedAt})).sort((a,b)=>(a.pointed>0)-(b.pointed>0)||(a.percent??0)-(b.percent??0)||a.driver.localeCompare(b.driver,'pt-BR'));
  const pointingUsers=users.filter((row)=>row.pointed>0).length,totalUsers=users.length;
  const totalPlanned=users.reduce((sum,row)=>sum+row.planned,0),totalPointed=users.reduce((sum,row)=>sum+row.pointed,0);
  return {summary:{totalUsers,pointingUsers,notPointingUsers:Math.max(0,totalUsers-pointingUsers),pointingUsersPercent:totalUsers?round(pointingUsers/totalUsers*100,1):null,totalPlanned,totalPointed,pointedDeliveriesPercent:totalPlanned?round(totalPointed/totalPlanned*100,1):null},users,notPointing:users.filter((row)=>row.pointed===0),routes:routeRows};
}

async function getDeliveryPointingUsersIndicator(db,period={},filters={}){
  const [syncRows,monitorRows,employees]=await Promise.all([
    safeRows(db,`SELECT SCHEDULE_ID,DATE_KEY,PLATE,DMS_ROUTE,DRIVER,DELIVERIES_PLANNED,DELIVERIES_DONE,DELIVERIES_RETURNED,CHECKED_AT,DATA_HASH,LAST_ERROR
      FROM LINCROS_ROUTE_SYNC
      WHERE DATE_KEY>=? AND DATE_KEY<=? AND COALESCE(DELIVERIES_PLANNED,0)>0
        AND COALESCE(TRIM(DATA_HASH),'')<>'' AND COALESCE(TRIM(LAST_ERROR),'')=''
      ORDER BY DATE_KEY,SCHEDULE_ID`,period.start,period.end),
    safeRows(db,`SELECT ID,SCHEDULE_ID,DATE_KEY,PLATE,DRIVER_NAME,ROUTE,STATUS,DATA_JSON
      FROM ROUTE_MONITORING WHERE DATE_KEY>=? AND DATE_KEY<=? ORDER BY ID DESC LIMIT 6000`,period.start,period.end),
    safeRows(db,`SELECT NOME,MATRICULA,FUNCAO,VINCULO FROM BASE_COLABORADORES WHERE COALESCE(ATIVO,1)<>0`),
  ]);
  const monitorBySchedule=new Map();
  for(const row of monitorRows){const key=String(row.SCHEDULE_ID||'').trim();if(key&&!monitorBySchedule.has(key))monitorBySchedule.set(key,row);}
  const driverCatalog=driverIndexes(employees);
  const regionFilter=normalizeText(filters.region||filters.regiao||''),routeFilter=normalizeText(filters.route||filters.rota||''),driverFilter=normalizeText(filters.driver||filters.motorista||''),relationFilter=normalizeText(filters.driverRelation||filters.driver_relation||filters.vinculoMotorista||filters.vinculo_motorista||''),plateFilter=normalizeText(filters.plate||filters.placa||''),profileFilter=normalizeText(filters.profile||filters.perfil||''),query=normalizeText(filters.q||filters.busca||'');
  const routeRows=[];
  for(const sync of syncRows){
    const scheduleId=String(sync.SCHEDULE_ID||'').trim(),monitor=monitorBySchedule.get(scheduleId)||{};
    let data={};try{data=JSON.parse(String(monitor.DATA_JSON||'{}'))||{};}catch{}
    const driver=String(data.motorista||monitor.DRIVER_NAME||sync.DRIVER||'').trim();
    if(!driver)continue;
    const route=String(data.rota||monitor.ROUTE||sync.DMS_ROUTE||'').trim(),region=String(data.regiao||'').trim(),profile=String(data.perfil||data.perfil_rota||'').trim(),plate=String(data.placa||monitor.PLATE||sync.PLATE||'').trim().toUpperCase();
    const relation=driverRelationFor(driver,driverCatalog);
    if(regionFilter&&normalizeText(region)!==regionFilter)continue;
    if(routeFilter&&normalizeText(route)!==routeFilter)continue;
    if(driverFilter&&normalizeText(driver)!==driverFilter)continue;
    if(relationFilter&&normalizeText(relation)!==relationFilter)continue;
    if(plateFilter&&normalizeText(plate)!==plateFilter)continue;
    if(profileFilter&&normalizeText(profile)!==profileFilter)continue;
    if(query&&!normalizeText([sync.DATE_KEY,route,region,profile,plate,driver,relation,data.ocs||data.carga||''].join(' ')).includes(query))continue;
    const planned=Math.max(0,Math.round(numberValue(sync.DELIVERIES_PLANNED)));
    const pointed=Math.min(planned||Number.MAX_SAFE_INTEGER,Math.max(0,Math.round(numberValue(sync.DELIVERIES_DONE))));
    routeRows.push({scheduleId,date:sync.DATE_KEY||monitor.DATE_KEY||'',route,region,profile,plate,driver,driverRelation:relation,planned,pointed,percent:planned?round(pointed/planned*100,1):null,status:pointed>0?'APONTANDO':'NÃO APONTANDO',checkedAt:sync.CHECKED_AT||''});
  }
  const grouped=new Map();
  for(const row of routeRows){
    const key=normalizeText(row.driver);let item=grouped.get(key);
    if(!item){item={driver:row.driver,driverRelation:row.driverRelation,routes:0,planned:0,pointed:0,plates:new Set(),routeNames:new Set(),dates:new Set(),scheduleIds:new Set(),lastCheckedAt:''};grouped.set(key,item);}
    item.routes+=1;item.planned+=row.planned;item.pointed+=row.pointed;if(row.plate)item.plates.add(row.plate);if(row.route)item.routeNames.add(row.route);if(row.date)item.dates.add(row.date);if(row.scheduleId)item.scheduleIds.add(String(row.scheduleId));if(String(row.checkedAt||'')>String(item.lastCheckedAt||''))item.lastCheckedAt=row.checkedAt||'';
  }
  const users=[...grouped.values()].map((item)=>({driver:item.driver,driverRelation:item.driverRelation,routes:item.routes,planned:item.planned,pointed:item.pointed,percent:item.planned?round(item.pointed/item.planned*100,1):null,status:item.pointed>0?'APONTANDO':'NÃO APONTANDO',plates:[...item.plates].sort(),routeNames:[...item.routeNames].sort(),dates:[...item.dates].sort(),scheduleIds:[...item.scheduleIds].sort(),lastCheckedAt:item.lastCheckedAt})).sort((a,b)=>(a.pointed>0)-(b.pointed>0)||(a.percent??0)-(b.percent??0)||a.driver.localeCompare(b.driver,'pt-BR'));
  const pointingUsers=users.filter((row)=>row.pointed>0).length,totalUsers=users.length;
  const totalPlanned=users.reduce((sum,row)=>sum+row.planned,0),totalPointed=users.reduce((sum,row)=>sum+row.pointed,0);
  return {summary:{totalUsers,pointingUsers,notPointingUsers:Math.max(0,totalUsers-pointingUsers),pointingUsersPercent:totalUsers?round(pointingUsers/totalUsers*100,1):null,totalPlanned,totalPointed,pointedDeliveriesPercent:totalPlanned?round(totalPointed/totalPlanned*100,1):null},users,notPointing:users.filter((row)=>row.pointed===0),routes:routeRows};
}

export async function getManagementIndicators(db, user, filters = {}) {
  const period = currentPeriod(filters);
  const fastMode = filters.__fastMode===true || String(filters.fast||'')==='1';
  const skipOccurrences = fastMode || filters.__skipOccurrences === true;
  // O indicador de dias excessivos é acompanhado pela DATA EM QUE O EXCESSO
  // ACONTECEU, e não pela data da escala. Por isso precisamos carregar também
  // viagens iniciadas antes do começo do filtro: uma escala de 21/08 pode gerar
  // o primeiro excesso em 22/08 e deve aparecer quando o usuário filtrar 22/08.
  // 31 dias cobrem com ampla margem as rotas multi-dia da operação sem levar as
  // consultas operacionais além dos limites já usados pelos endpoints de domínio.
  const overnightSourcePeriod = { start: addDaysIso(period.start, -31) || period.start, end: period.end };
  // A janela extra de 31 dias existe apenas para localizar excessos iniciados antes
  // do filtro. GPS, porém, só é necessário para as viagens visíveis no período.
  // Isso evita agrupar dezenas de dias adicionais de ROUTE_GPS_POSITIONS a cada abertura.
  const recordsPromise = buildExecutionRecords(db, user, overnightSourcePeriod,{includeGps:!fastMode,gpsStart:period.start,gpsEnd:period.end});
  const occurrencePromise = skipOccurrences ? Promise.resolve(null) : getOperationalOccurrenceIndicators(db, {...period,...filters});
  const fleetAvailabilityPromise = fastMode ? Promise.resolve(null) : getFleetAvailabilityIndicators(db,user,period);
  const [sourceRecords, occurrenceIndicators, fleetAvailability] = await Promise.all([recordsPromise, occurrencePromise, fleetAvailabilityPromise]);
  const basePeriodRecords = sourceRecords.filter((row) => inPeriod(row.data, period.start, period.end));
  const allRecords = await enrichDeliveryEconomics(db,basePeriodRecords);
  const filterOptions=executionFilterOptions(allRecords);
  const records=applyExecutionFilters(allRecords,filters);
  // Mesma base dos demais KPIs: somente viagens concluídas e já filtradas.
  const deliveryPointingUsers=buildDeliveryPointingUsersFromRecords(records);
  await attachDeliveryPointingJustifications(db,deliveryPointingUsers,period);
  const overnightSourceRecords=applyExecutionFilters(sourceRecords,filters);
  return {
    versao: '1',
    period,
    summary: summarizeExecutionRecords(records),
    deliveryEconomics: summarizeDeliveryEconomics(records),
    deliveryPointingUsers:deliveryPointingUsers||{summary:{},users:[],notPointing:[],routes:[]},
    fleetAvailability:fleetAvailability||{},
    degraded:fastMode,
    degradedReason:fastMode?'Modo rápido acionado após lentidão da consulta completa. GPS, ocorrências e disponibilidade detalhada podem exigir nova tentativa.':'',
    records,
    byStatus: group(records, 'status'),
    byRegion: group(records, 'regiao'),
    byRoute: group(records, 'rota'),
    byDriver: group(records, 'motorista'),
    byProfile: group(records, 'perfil_rota'),
    occupancyByVehicleType: groupOccupancy(records, 'veiculo_tipo'),
    occupancyByRoute: groupOccupancy(records, 'rota'),
    daily: group(records, 'data'),
    overnightIndicators: buildOvernightIndicators(records,{period,eventRecords:overnightSourceRecords}),
    gpsMotionIndicators: buildGpsMotionIndicators(records),
    devolutionIndicators: buildDevolutionIndicators(records),
    balance: records.map((row)=>({
      id:row.id,data:row.data,rota:row.rota,regiao:row.regiao,motorista:row.motorista,
      planejado_min:row.tempo_planejado_min,realizado_min:row.tempo_com_deslocamento_min,
      desvio_min:round(numberValue(row.tempo_com_deslocamento_min)-numberValue(row.tempo_planejado_min),1),
      aderencia_planejamento:row.aderencia_planejamento,
    })),
    scatter: records.map((row)=>({
      id:row.id,rota:row.rota,regiao:row.regiao,planejado_min:row.tempo_planejado_min,realizado_min:row.tempo_com_deslocamento_min,
      peso_kg:row.peso_kg,entregas:row.entregas,
    })),
    filters: filterOptions,
    activeFilters:{region:filters.region||filters.regiao||'',route:filters.route||filters.rota||'',driver:filters.driver||filters.motorista||'',driverRelation:filters.driverRelation||filters.driver_relation||filters.vinculoMotorista||filters.vinculo_motorista||'',profile:filters.profile||filters.perfil||'',plate:filters.plate||filters.placa||'',q:filters.q||filters.busca||''},
    ...(occurrenceIndicators ? { occurrenceIndicators } : {}),
    calculationNote: 'Entregas/h e t/h usam o tempo realizado sem os tempos de ida, entre cidades, volta e o intervalo final.',
  };
}


function parseJsonSafe(value,fallback={}){try{const parsed=JSON.parse(String(value||''));return parsed&&typeof parsed==='object'?parsed:fallback;}catch{return fallback;}}
function utcStoredIso(value=''){
  const raw=String(value||'').trim();if(!raw)return '';
  if(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw))return raw;
  if(/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?/.test(raw))return `${raw.replace(' ','T').slice(0,19)}Z`;
  return raw;
}
function recifeDateFromUtcStored(value=''){
  const iso=utcStoredIso(value);const date=new Date(iso);if(!Number.isFinite(date.getTime()))return dateIso(value);
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}catch{return date.toISOString().slice(0,10);}
}
function inclusiveDayCount(startValue,endValue){
  const start=dateIso(startValue),end=dateIso(endValue);if(!start||!end||end<start)return 1;
  const a=Date.parse(`${start}T12:00:00Z`),b=Date.parse(`${end}T12:00:00Z`);return Number.isFinite(a)&&Number.isFinite(b)?Math.max(1,Math.floor((b-a)/86400000)+1):1;
}
async function managementOvernightHistory(db,period,filters={}){
  const queryStart=addDays(period.start,-1)||period.start,queryEnd=addDays(period.end,1)||period.end;
  const events=await safeRows(db,`SELECT E.ID,E.RESOURCE_TYPE,E.RESOURCE_NAME,E.EFFECTIVE_AT,E.DATE_KEY,E.SCHEDULE_RECORD_ID,E.DETAILS_JSON,E.CREATED_BY_NAME,
    M.PLATE AS M_PLATE,M.DRIVER_NAME AS M_DRIVER,M.ROUTE AS M_ROUTE,M.DATA_JSON AS M_DATA_JSON,M.UPDATED_AT AS M_UPDATED_AT,
    S.DATA_JSON AS S_DATA_JSON
    FROM ROUTE_RESOURCE_EVENTS E
    LEFT JOIN ROUTE_MONITORING M ON CAST(M.SCHEDULE_ID AS TEXT)=CAST(E.SCHEDULE_RECORD_ID AS TEXT)
    LEFT JOIN ROUTE_RECORDS S ON S.ID=E.SCHEDULE_RECORD_ID AND S.MODULE='schedule'
    WHERE E.STATUS='PERNOITE' AND UPPER(COALESCE(E.SOURCE,''))='MONITORAMENTO' AND E.DATE_KEY>=? AND E.DATE_KEY<=?
    ORDER BY E.EFFECTIVE_AT DESC,E.ID DESC`,queryStart,queryEnd);
  const employees=await safeRows(db,"SELECT NOME,MATRICULA,FUNCAO,VINCULO FROM BASE_COLABORADORES");const driverCatalog=driverIndexes(employees);
  const grouped=new Map();
  for(const event of events){
    const localDay=recifeDateFromUtcStored(event.EFFECTIVE_AT);if(!localDay||localDay<period.start||localDay>period.end)continue;
    const scheduleId=String(event.SCHEDULE_RECORD_ID||'').trim(),key=`${scheduleId}|${String(event.EFFECTIVE_AT||'').trim()}`;
    const previous=grouped.get(key);if(!previous||normalizeText(event.RESOURCE_TYPE)==='VEICULO')grouped.set(key,event);
  }
  const rows=[];
  for(const event of grouped.values()){
    const details=parseJsonSafe(event.DETAILS_JSON,{}),monitoring=parseJsonSafe(event.M_DATA_JSON,{}),schedule=parseJsonSafe(event.S_DATA_JSON,{});
    const pointedAt=utcStoredIso(event.EFFECTIVE_AT),day=recifeDateFromUtcStored(event.EFFECTIVE_AT);
    const route=String(details.rota||monitoring.rota||schedule.rota||event.M_ROUTE||'').trim();
    const region=String(details.regiao||monitoring.regiao||schedule.regiao||'').trim();
    const profile=String(details.perfil||monitoring.perfil||schedule.perfil||schedule.perfil_rota||'').trim();
    const plate=String(details.placa||monitoring.placa||schedule.placa||(normalizeText(event.RESOURCE_TYPE)==='VEICULO'?event.RESOURCE_NAME:'')||event.M_PLATE||'').trim();
    const driver=String(details.motorista||monitoring.motorista||schedule.motorista||event.M_DRIVER||'').trim();
    const reason=String(details.justificativa_pernoite||details.justificativa||details.observacoes||monitoring.justificativa_pernoite||monitoring.observacoes||schedule.observacao||schedule.observacoes||'').trim();
    const relation=driverRelationFor(driver,driverCatalog);const startDate=dateIso(schedule.data||monitoring.data||'');
    rows.push({id:Number(event.ID||0),schedule_id:String(event.SCHEDULE_RECORD_ID||''),data:day,status:'PERNOITE',data_pernoite:day,apontado_em:pointedAt,rota:route,regiao:region,perfil_rota:profile,placa:plate,motorista:driver,motorista_vinculo:relation,dias_em_rota:inclusiveDayCount(startDate,day),justificativa:reason,pernoite_vazio:normalizeText(reason).includes('VAZIO'),apontado_por:String(event.CREATED_BY_NAME||details.autorizado_por||monitoring.autorizado_por||'Sistema').trim()});
  }
  const filtered=applyExecutionFilters(rows,filters).sort((a,b)=>String(b.apontado_em||'').localeCompare(String(a.apontado_em||''))||Number(b.id||0)-Number(a.id||0));
  const empty=filtered.filter((row)=>row.pernoite_vazio),emptyVehicles=new Set(empty.map((row)=>normalizeText(row.placa)).filter(Boolean));
  return {records:filtered,summary:{overnightEvents:filtered.length,emptyOvernightEvents:empty.length,emptyOvernightVehicles:emptyVehicles.size}};
}

export async function getRouteManagementReport(db, user, filters = {}) {
  const period=currentPeriod(filters);
  const allRecords=await buildExecutionRecords(db,user,period);
  const records=applyExecutionFilters(allRecords,filters);
  const overnightHistory=await managementOvernightHistory(db,period,filters);
  const baseFilterOptions=executionFilterOptions(allRecords),overnightFilterOptions=executionFilterOptions(overnightHistory.records);
  const mergeValues=(left=[],right=[])=>[...new Set([...(left||[]),...(right||[])])].filter(Boolean).sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));
  const filterOptions={regions:mergeValues(baseFilterOptions.regions,overnightFilterOptions.regions),routes:mergeValues(baseFilterOptions.routes,overnightFilterOptions.routes),drivers:mergeValues(baseFilterOptions.drivers,overnightFilterOptions.drivers),driverRelations:mergeValues(baseFilterOptions.driverRelations,overnightFilterOptions.driverRelations),profiles:mergeValues(baseFilterOptions.profiles,overnightFilterOptions.profiles),plates:mergeValues(baseFilterOptions.plates,overnightFilterOptions.plates)};
  return {
    versao:'1',period,summary:{...summarizeExecutionRecords(records),...overnightHistory.summary},records,overnightHistory:overnightHistory.records,
    byDriver:group(records,'motorista'),byRegion:group(records,'regiao'),
    filters:filterOptions,
    activeFilters:{region:filters.region||filters.regiao||'',route:filters.route||filters.rota||'',driver:filters.driver||filters.motorista||'',driverRelation:filters.driverRelation||filters.driver_relation||filters.vinculoMotorista||filters.vinculo_motorista||'',profile:filters.profile||filters.perfil||'',plate:filters.plate||filters.placa||'',q:filters.q||filters.busca||''},
    calculationNote:'Entregas/h e t/h usam o tempo realizado sem os tempos de ida, entre cidades, volta e o intervalo final.',
  };
}
