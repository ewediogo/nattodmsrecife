import {
  addDays, clean, dateIso, departureStatus, diffMinutes, emitResourceStatus, findDomainBySchedule, intValue,
  localDateTime, normalizeText, resolveSchedule, safeUpdateScheduleStatus, schedulesFor, timeOnly, upsertDomainRow,
  listDomainRows, getDomainRow, deleteDomainRow, userName, numberValue,
} from './route-phase1.js';
import { listScheduleCrewOptions, resolveOperationalCrewChange, saveScheduleInternal, withScheduleResourceLocks } from './schedule.js';
import { updateVehicleLastDriver } from './core.js';
import { ensureMonitoringForDeparture } from './monitoring.js';
import { isOperationallyExcludedTrip } from './operational-exclusions.js';
import { listDepartureAuditSummaries } from './departure-audit.js';
import { loadGpsFacilityAnchors, positionInsideFacilityAnchors } from './gps-geofence.js';

const DEFAULT_TOLERANCE_MINUTES=30;
const DEFAULT_FACILITY_NAMES=Object.freeze([
  'NOTARO ALIMENTOS LTDA. - RECIFE/PE',
  'NOTARO ALIMENTOS - RECIFE/PE',
]);
const DEFAULT_FACILITY_NAME=DEFAULT_FACILITY_NAMES[1];
const DEFAULT_FACILITY_RADIUS_METERS=120;
const STANDARD_DELAY_REASONS=Object.freeze([
  {label:'Atraso no carregamento - Expedição',owner:'EXPEDIÇÃO'},
  {label:'Atraso no faturamento',owner:'FATURAMENTO'},
  {label:'Atraso do motorista - Distribuição',owner:'DISTRIBUIÇÃO'},
  {label:'Atraso do ajudante - Distribuição',owner:'DISTRIBUIÇÃO'},
  {label:'Atraso na prestação de contas - Distribuição/Tesouraria',owner:'DISTRIBUIÇÃO/TESOURARIA'},
  {label:'Atraso na portaria',owner:'PORTARIA'},
  {label:'Problema com o Veículo/Manutenção',owner:'MANUTENÇÃO'},
  {label:'Abastecimento do veículo',owner:'ABASTECIMENTO'},
  {label:'Reunião/Treinamento',owner:'DISTRIBUIÇÃO'},
  {label:'Reorganizar carga',owner:'EXPEDIÇÃO'},
  {label:'Atraso do Motorista - Terceiro',owner:'TERCEIRO'},
  {label:'Atraso no CTe - Terceiro',owner:'TERCEIRO'},
]);
function standardDelayReason(value){return STANDARD_DELAY_REASONS.find((item)=>normalizeText(item.label)===normalizeText(value))||null;}

function helpers(source={}) { return [source.ajudante_1,source.ajudante_2].filter(Boolean).join(' / ') || clean(source.ajudantes,360); }
function resourceSnapshot(source={}) { return {placa:clean(source.placa,30).toUpperCase(),motorista:clean(source.motorista,180),ajudante_1:clean(source.ajudante_1,180),ajudante_2:clean(source.ajudante_2,180)}; }
function originalPlateFromResourceHistory(source={},fallback='') {
  const explicit=clean(source.placa_lincros||source.placa_original||'',30).toUpperCase();if(explicit)return explicit;
  const history=Array.isArray(source.trocas_recursos)?source.trocas_recursos:[];
  const first=history.find((item)=>normalizeText(item?.campo)==='VEICULO'&&clean(item?.anterior,30));
  return clean(first?.anterior||fallback||source.placa||'',30).toUpperCase();
}
function changes(before={},after={}) {
  const labels={placa:'VEÍCULO',motorista:'MOTORISTA',ajudante_1:'AJUDANTE 1',ajudante_2:'AJUDANTE 2'};
  return Object.keys(labels).filter((key)=>normalizeText(before[key])!==normalizeText(after[key])).map((key)=>({campo:labels[key],anterior:before[key]||'',novo:after[key]||'',tipo:before[key]?(after[key]?'TROCA':'REMOÇÃO'):'ALOCAÇÃO INICIAL'}));
}
function sameCrewSelection(schedule={},source={}){
  const samePerson=(sourceId,sourceName,currentId,currentName)=>{
    const wantedId=String(sourceId??'').trim(),currentKey=String(currentId??'').trim();
    if(wantedId&&currentKey)return wantedId===currentKey;
    const wantedName=normalizeText(sourceName??''),currentLabel=normalizeText(currentName??'');
    return !wantedId&&!wantedName||Boolean(wantedName&&wantedName===currentLabel);
  };
  return samePerson(source.motorista_id,source.motorista,schedule.motorista_id,schedule.motorista)
    && samePerson(source.ajudante_1_id,source.ajudante_1,schedule.ajudante_1_id,schedule.ajudante_1)
    && samePerson(source.ajudante_2_id,source.ajudante_2,schedule.ajudante_2_id,schedule.ajudante_2);
}
function sameVehicleSelection(schedule={},source={}){
  const sourcePlate=normalizeText(source.placa??'').replace(/[^A-Z0-9]/g,''),schedulePlate=normalizeText(schedule.placa??'').replace(/[^A-Z0-9]/g,'');
  const sourceId=String(source.veiculo_id??'').trim(),scheduleId=String(schedule.veiculo_id??'').trim();
  const plateSame=!sourcePlate||sourcePlate===schedulePlate;
  const idSame=!sourceId||!scheduleId||sourceId===scheduleId;
  return plateSame&&idSame;
}
function existingCrew(schedule={}){
  return {
    veiculo_id:schedule.veiculo_id||'',placa:schedule.placa||'',
    motorista_id:schedule.motorista_id||'',motorista:schedule.motorista||'',
    ajudante_1_id:schedule.ajudante_1_id||'',ajudante_1:schedule.ajudante_1||'',
    ajudante_2_id:schedule.ajudante_2_id||'',ajudante_2:schedule.ajudante_2||'',
    tipo_equipe:normalizeText(schedule.tipo_equipe||'UM_AJUDANTE'),
  };
}

export async function departureToleranceMinutes(db){
  try{
    const row=await db.prepare("SELECT VALOR FROM CONFIGURACOES WHERE UPPER(CHAVE)='TOLERANCIA_SAIDA_MIN' LIMIT 1").first();
    const value=Number(row?.VALOR);
    return Number.isFinite(value)&&value>=0?Math.round(value):DEFAULT_TOLERANCE_MINUTES;
  }catch{return DEFAULT_TOLERANCE_MINUTES;}
}

function driverRelationLabel(value=''){
  const normalized=normalizeText(value);
  if(normalized.includes('TERCEIR'))return 'TERCEIRO';
  if(normalized.includes('PROPRI'))return 'PRÓPRIO';
  return clean(value,80);
}
let driverRelationCache={at:0,value:null};
async function driverRelationMap(db){
  try{
    if(driverRelationCache.value&&Date.now()-driverRelationCache.at<60000)return driverRelationCache.value;
    const {results=[]}=await db.prepare("SELECT NOME,MATRICULA,FUNCAO,VINCULO FROM BASE_COLABORADORES WHERE ATIVO=1").all();
    const map=new Map();
    for(const row of results){
      const role=normalizeText(row.FUNCAO||'');
      if(!role.includes('MOTORISTA')&&!role.includes('CARRETEIRO'))continue;
      const relation=driverRelationLabel(row.VINCULO||'');
      const name=normalizeText(row.NOME||''),registration=normalizeText(row.MATRICULA||'');
      if(name)map.set(name,relation);if(registration)map.set(registration,relation);
    }
    driverRelationCache={at:Date.now(),value:map};return map;
  }catch{return driverRelationCache.value||new Map();}
}
function driverRelationFor(name,map){return map.get(normalizeText(name||''))||'';}

function validateDelay(data,toleranceMinutes=DEFAULT_TOLERANCE_MINUTES) {
  const planned=localDateTime(data.data,data.hora_programada),actual=localDateTime(data.data,data.hora_real);
  if(!actual)throw new Error('Informe a hora real da saída.');
  const delay=Math.max(0,diffMinutes(planned,actual)||0); data.atraso_minutos=delay; data.dentro_tolerancia=delay<=toleranceMinutes;
  if(delay>toleranceMinutes){
    if(!clean(data.motivo_atraso))throw new Error(`Informe o motivo do atraso acima de ${toleranceMinutes} minutos.`);
    const automatic=['SAIDA AUTOMATICA GPS','SAIDA AUTOMATICA APP'].includes(normalizeText(data.motivo_atraso));
    const standard=automatic?null:standardDelayReason(data.motivo_atraso);
    if(!automatic&&!standard)throw new Error('Selecione um motivo de atraso padronizado.');
    if(standard){data.motivo_atraso=standard.label;data.responsavel_atraso=standard.owner;}
    if(!clean(data.responsavel_atraso))throw new Error('Informe o responsável pelo atraso.');
    if(!clean(data.detalhe_motivo))throw new Error('Detalhe o motivo do atraso.');
    data.ocorrencia_origem=automatic?'AUTOMÁTICA':'MANUAL';
    if(!automatic){
      data.justificativa_ocorrencia=clean(data.justificativa_ocorrencia||data.detalhe_motivo,1000);
      if(!clean(data.justificativa_ocorrencia))throw new Error('Informe a justificativa da ocorrência manual.');
      data.ocorrencia_justificada=true;
    } else {
      data.ocorrencia_justificada=Boolean(clean(data.justificativa_ocorrencia));
    }
  }
  const motive=normalizeText(data.motivo_atraso);
  if(motive==='HORARIO DO MOTORISTA'&&!timeOnly(data.horario_disponivel_motorista))data.horario_disponivel_motorista=data.hora_real;
  if(motive==='HORARIO DO AJUDANTE'&&!timeOnly(data.horario_disponivel_ajudante))data.horario_disponivel_ajudante=data.hora_real;
}
function transferMarker(scheduleId=''){return `[TRANSFERIDA_DA_ESCALA:${String(scheduleId||'').trim()}]`;}
function legacyTransferMarker(scheduleId=''){return `TRANSFERIDA_DA_ESCALA=${String(scheduleId||'').trim()}`;}
function transferredFromSchedule(row={},scheduleId=''){
  const notes=String(row.observacoes||row.OBSERVACOES||'');
  return Boolean(scheduleId)&&(notes.includes(transferMarker(scheduleId))||notes.includes(legacyTransferMarker(scheduleId)));
}
function transferTargetDate(row={}){return dateIso(row.data_transferencia||row.DATA_TRANSFERENCIA||addDays(row.data||row.DATA,1));}
function nextTransferSequence(all,existing,schedule,data){
  // A sequência 0 é prioridade visual, nunca identidade. Cada transferência recebe
  // sequência numérica exclusiva; reexecução mantém a sequência já atribuída.
  if(existing && clean(existing.sequencia) && clean(existing.sequencia)!=='0')return clean(existing.sequencia,80);
  const occupied=new Set((all||[]).filter(row=>String(row.id)!==String(existing?.id||'')&&normalizeText(row.status)!=='CANCELADO').map(row=>clean(row.sequencia)).filter(v=>v&&v!=='0'));
  const original=clean(data.sequencia_transferencia||schedule.sequencia);
  if(original && original!=='0' && !occupied.has(original))return original;
  const numeric=(all||[]).map(row=>Number(clean(row.sequencia))).filter(v=>Number.isSafeInteger(v)&&v>0);
  let candidate=Math.max(0,...numeric)+1;
  while(occupied.has(String(candidate)))candidate++;
  return String(candidate);
}
async function createTransferredSchedule(db,user,schedule,data,{alreadyLocked=false}={}) {
  const nextDate=transferTargetDate({...data,data:data.data||schedule.data});
  if(!nextDate)throw new Error('Não foi possível determinar a data da escala transferida.');
  const all=await schedulesFor(db,user,{start:nextDate,end:nextDate});
  const existing=all.find((row)=>transferredFromSchedule(row,schedule.id));
  const marker=transferMarker(schedule.id);
  const priorNotes=clean(schedule.observacoes,3200)
    .replace(new RegExp(`\\s*[·|]?\\s*${legacyTransferMarker(schedule.id).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`,'g'),'')
    .replace(new RegExp(`\\s*[·|]?\\s*${marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`,'g'),'')
    .trim();
  const transferNote=`Transferida de ${dateIso(schedule.data)?.split('-').reverse().join('/')||schedule.data||'data anterior'}`;
  const payload={
    ...schedule,id:existing?.id,storage:existing?.storage||'',client_id:'',sourceKey:'',sourceTable:'',legacy:false,
    data:nextDate,status:'PROGRAMADO',sequencia:nextTransferSequence(all,existing,schedule,data),
    horario_ponto:timeOnly(data.hora_programada_transferencia||data.hora_programada||schedule.horario_ponto),
    observacoes:[priorNotes,marker,transferNote,clean(data.motivo_transferencia||data.detalhe_motivo)].filter(Boolean).join(' · '),
  };
  return saveScheduleInternal(db,user,payload,{alreadyLocked});
}

async function reconcileTransferredSchedulesForDate(db,user,targetDate){
  const date=dateIso(targetDate);if(!date)return {checked:0,repaired:[],warnings:[]};
  const start=addDays(date,-7),end=addDays(date,-1);
  const priorDepartures=await listDepartures(db,user,{start,end,limit:10000});
  const transferred=(priorDepartures||[]).filter((row)=>normalizeText(row.status||row.status_saida)==='TRANSFERIDO'&&transferTargetDate(row)===date);
  if(!transferred.length)return {checked:0,repaired:[],warnings:[]};
  let todaySchedules=await schedulesFor(db,user,{start:date,end:date});
  const repaired=[],warnings=[];
  for(const departure of transferred){
    try{
      const original=await resolveSchedule(db,user,departure);
      if(!original){warnings.push(`Transferência ${departure.placa||departure.rota||departure.id||''}: escala de origem não encontrada.`);continue;}
      if(todaySchedules.some((row)=>transferredFromSchedule(row,original.id)))continue;
      const created=await createTransferredSchedule(db,user,{...original,status:'FINALIZADO'}, {...departure,data_transferencia:date});
      if(created){todaySchedules=[...todaySchedules,created];repaired.push({sourceScheduleId:String(original.id||''),scheduleId:String(created.id||''),plate:created.placa||departure.placa||'',date});}
    }catch(error){warnings.push(`Transferência ${departure.placa||departure.rota||departure.id||''}: ${error?.message||error}`);}
  }
  return {checked:transferred.length,repaired,warnings};
}

export async function listDepartures(db,user,filters={}) { return listDomainRows(db,'departures',filters); }

function scheduleKeys(schedule={}){
  return [schedule.id,schedule.sourceKey,schedule.legado_id,schedule.escala_id,schedule.escala_id_legado].filter((value)=>value!==null&&value!==undefined&&String(value)!=='').map(String);
}
function departureScheduleKeys(row={}){
  return [row.schedule_record_id,row.schedule_id,row.escala_id,row.escala_id_legado,row.legado_id].filter((value)=>value!==null&&value!==undefined&&String(value)!=='').map(String);
}
export function departureRecordIsRealized(row={}){
  return Boolean(timeOnly(row.hora_real||row.actualAt||row.actual_at)) && normalizeText(row.status||row.status_saida)==='SAIU';
}
export function departureDelayMinutes(schedule={},departure={}){
  const planned=timeOnly(schedule.horario_ponto||schedule.hora_saida_programada||departure.hora_programada);
  const actual=timeOnly(departure.hora_real||departure.actualAt||departure.actual_at);
  const plannedHit=String(planned||'').match(/^(\d{1,2}):(\d{2})/);
  const actualHit=String(actual||'').match(/^(\d{1,2}):(\d{2})/);
  if(!plannedHit||!actualHit)return 0;
  const a=Number(plannedHit[1])*60+Number(plannedHit[2]);
  const b=Number(actualHit[1])*60+Number(actualHit[2]);
  let diff=b-a;
  if(diff < -720) diff += 1440;
  return Math.max(0,diff);
}
function departureRecordScore(row={}){
  let score=0;
  if(departureRecordIsRealized(row))score+=1000000;
  if(timeOnly(row.hora_real||row.actualAt||row.actual_at))score+=100000;
  if(normalizeText(row.status||row.status_saida)==='SAIU')score+=10000;
  const updated=Date.parse(String(row.updatedAt||row.updated_at||row.atualizado_em||''));
  if(Number.isFinite(updated))score+=Math.floor(updated/100000000);
  score+=Math.max(0,Number(row.id||0));
  return score;
}
function bestDeparture(left,right){
  if(!left)return right||null;
  if(!right)return left;
  return departureRecordScore(right)>departureRecordScore(left)?right:left;
}
function normalizedLoad(value){return normalizeText(value).replace(/[^A-Z0-9]+/g,'|').replace(/^\|+|\|+$/g,'');}
function compositeKeysForDeparture(row={}){
  const date=dateIso(row.data||row.dateKey||row.hora_real||row.actualAt||row.actual_at);
  const route=normalizeText(row.rota||row.destino||'');
  const plate=normalizeText(row.placa||'');
  const driver=normalizeText(row.motorista||'');
  const ocs=normalizedLoad(row.ocs||row.carga||'');
  const sequence=normalizeText(row.sequencia||row.sequencia_carregamento||'');
  return [
    ocs&&date?`OC|${date}|${ocs}`:'',
    date&&route&&plate?`RP|${date}|${route}|${plate}`:'',
    date&&sequence&&sequence!=='0'?`SQ|${date}|${sequence}`:'',
    date&&route&&driver?`RD|${date}|${route}|${driver}`:'',
  ].filter(Boolean);
}
function compositeKeysForSchedule(row={}){
  const date=dateIso(row.data);
  const route=normalizeText(row.rota||row.destino||'');
  const plate=normalizeText(row.placa||'');
  const driver=normalizeText(row.motorista||'');
  const ocs=normalizedLoad(row.ocs||row.carga||'');
  const sequence=normalizeText(row.sequencia||row.sequencia_carregamento||'');
  return [
    ocs&&date?`OC|${date}|${ocs}`:'',
    date&&route&&plate?`RP|${date}|${route}|${plate}`:'',
    date&&sequence&&sequence!=='0'?`SQ|${date}|${sequence}`:'',
    date&&route&&driver?`RD|${date}|${route}|${driver}`:'',
  ].filter(Boolean);
}
export function buildDepartureMatcher(rows=[]){
  const aliases=new Map(),composites=new Map();
  for(const row of rows||[]){
    for(const key of departureScheduleKeys(row))aliases.set(key,bestDeparture(aliases.get(key),row));
    for(const key of compositeKeysForDeparture(row)){const matches=composites.get(key)||[];matches.push(row);composites.set(key,matches);}
  }
  return {aliases,composites};
}
export function matchDepartureToSchedule(matcher,schedule={}){
  let match=null;
  for(const key of scheduleKeys(schedule))match=bestDeparture(match,matcher?.aliases?.get(key));
  if(match)return match;
  // Somente registros sem identidade de escala admitem fallback; candidatos
  // ambíguos ou com ID divergente nunca podem ser associados a outra escala.
  const matches=new Map();
  for(const key of compositeKeysForSchedule(schedule)){
    for(const row of matcher?.composites?.get(key)||[]){
      if(departureScheduleKeys(row).length)continue;
      matches.set(String(row.id||JSON.stringify(row)),row);
    }
  }
  return matches.size===1?[...matches.values()][0]:null;
}

function departureFixedRouteExcluded(row={}){
  const route=normalizeText([row.rota,row.destino,row.nome_rota,row.rota_nome].filter(Boolean).join(' ')).replace(/[^A-Z0-9]+/g,' ');
  // Rotas com horário/fluxo fixo não usam o Controle de Saída. A palavra inteira
  // ALMOXARIFADO cobre também "ALMOXARIFADO PESQUEIRA", sem esconder AG2/NATTO PESQUEIRA.
  return /\b(CAIXA|CAIXAS|ALMOXARIFADO|VENEZA|MANOBRA|MANUTENCAO)\b/.test(route)
    || /\b(SERVICO ADM|SERVICO ADMINISTRATIVO)\b/.test(route);
}
function departureExemptSchedule(schedule={}){
  const hasLoad=Boolean(String(schedule.ocs||schedule.carga||'').trim());
  return !hasLoad || departureFixedRouteExcluded(schedule) || isOperationallyExcludedTrip(schedule);
}

function controlStatus(schedule,departure){
  if(departure) return departure.status||departure.status_saida||'PENDENTE';
  const status=normalizeText(schedule?.status||'PROGRAMADO');
  if(status==='CANCELADO')return 'CANCELADO';
  if(['FINALIZADO','RETORNOU'].includes(status))return 'FINALIZADO';
  return 'PENDENTE';
}

export async function listDepartureControlRows(db,user,filters={}){
  const date=dateIso(filters.date||filters.data||filters.start||filters.inicio)||dateIso(new Date().toISOString());
  // Repara automaticamente transferências antigas que chegaram a gravar o status
  // TRANSFERIDO, mas falharam antes de criar a cópia da Escala do dia seguinte.
  // O processo é idempotente pelo marcador da escala de origem.
  const transferReconcile=await reconcileTransferredSchedulesForDate(db,user,date).catch((error)=>({checked:0,repaired:[],warnings:[error?.message||String(error)]}));
  const [schedules,departures,toleranceMinutes,crewOptions,auditSummaries]=await Promise.all([
    schedulesFor(db,user,{start:date,end:date}),
    listDepartures(db,user,{start:date,end:date,limit:10000}),
    departureToleranceMinutes(db),
    listScheduleCrewOptions(db,date),
    listDepartureAuditSummaries(db,date),
  ]);
  const departureMatcher=buildDepartureMatcher(departures);
  const usedDepartureIds=new Set();
  const rows=[];
  for(const schedule of schedules){
    if(normalizeText(schedule.status)==='CANCELADO'||departureExemptSchedule(schedule))continue;
    const departure=matchDepartureToSchedule(departureMatcher,schedule);
    if(departure?.id)usedDepartureIds.add(String(departure.id));
    const audit=auditSummaries.bySchedule.get(String(schedule.id||''))||(departure?.id?auditSummaries.byDeparture.get(String(departure.id)):null)||null;
    const merged={
      ...schedule,
      ...(departure||{}),
      departure_id:departure?.id||null,
      schedule_record_id:String(schedule.id||''),
      escala_id:String(schedule.sourceKey||schedule.id||''),
      data:dateIso(schedule.data||departure?.data||date),
      rota:departure?.rota||schedule.rota||schedule.destino||'',
      regiao:departure?.regiao||schedule.regiao||'',
      placa:departure?.placa||schedule.placa||'',
      motorista_id:departure?.motorista_id||schedule.motorista_id||'',
      motorista:departure?.motorista||schedule.motorista||'',
      ajudante_1_id:departure?.ajudante_1_id||schedule.ajudante_1_id||'',
      ajudante_1:departure?.ajudante_1||schedule.ajudante_1||'',
      ajudante_2_id:departure?.ajudante_2_id||schedule.ajudante_2_id||'',
      ajudante_2:departure?.ajudante_2||schedule.ajudante_2||'',
      tipo_equipe:departure?.tipo_equipe||schedule.tipo_equipe||'',
      ocs:departure?.ocs||schedule.ocs||schedule.carga||'',
      hora_programada:timeOnly(departure?.hora_programada||schedule.horario_ponto||schedule.hora_saida_programada),
      hora_real:timeOnly(departure?.hora_real),
      atraso_minutos:Number(departure?.atraso_minutos||0),
      status:controlStatus(schedule,departure),
      status_saida:controlStatus(schedule,departure),
      origem_saida:departure?.origem_saida||departure?.origem||'',
      automatico:Boolean(departure?.automatico||normalizeText(departure?.origem_saida||departure?.origem).includes('GPS')),
      tem_registro_saida:Boolean(departure),
      sequencia:schedule.sequencia||schedule.sequencia_carregamento||'',
      auditoria_realizada:Boolean(audit),
      auditoria_id:audit?.id||null,
      auditoria_resultado:audit?.result||'',
      auditoria_por:audit?.auditorName||'',
      auditoria_em:audit?.auditedAt||'',
      auditoria_fotos:Number(audit?.photoCount||0),
    };
    rows.push(merged);
  }
  for(const departure of departures){
    if(departure?.id&&usedDepartureIds.has(String(departure.id)))continue;
    if(departureFixedRouteExcluded(departure)||isOperationallyExcludedTrip(departure))continue;
    const scheduleKey=String(departure.schedule_record_id||departure.escala_id||departure.schedule_id||'');
    const audit=auditSummaries.bySchedule.get(scheduleKey)||(departure?.id?auditSummaries.byDeparture.get(String(departure.id)):null)||null;
    rows.push({...departure,departure_id:departure.id,schedule_record_id:scheduleKey,tem_registro_saida:true,automatico:Boolean(departure.automatico||normalizeText(departure.origem_saida||departure.origem).includes('GPS')),auditoria_realizada:Boolean(audit),auditoria_id:audit?.id||null,auditoria_resultado:audit?.result||'',auditoria_por:audit?.auditorName||'',auditoria_em:audit?.auditedAt||'',auditoria_fotos:Number(audit?.photoCount||0)});
  }
  rows.sort((a,b)=>{
    const sa=Number(a.sequencia||9999),sb=Number(b.sequencia||9999);
    if(Number.isFinite(sa)&&Number.isFinite(sb)&&sa!==sb)return sa-sb;
    return String(a.hora_programada||'99:99').localeCompare(String(b.hora_programada||'99:99'))||String(a.rota||'').localeCompare(String(b.rota||''));
  });
  const departed=rows.filter((row)=>normalizeText(row.status)==='SAIU');
  const pending=rows.filter((row)=>normalizeText(row.status)==='PENDENTE');
  const delayed=departed.filter((row)=>Number(row.atraso_minutos||0)>toleranceMinutes);
  const automatic=departed.filter((row)=>row.automatico);
  return {records:rows,total:rows.length,toleranceMinutes,crewOptions,transferReconcile,summary:{programmed:rows.length,departed:departed.length,pending:pending.length,delayed:delayed.length,automatic:automatic.length}};
}

export async function saveDeparture(db,user,payload,id=null) {
  const nestedPayloadData=payload?.data;
  const source={...((nestedPayloadData&&typeof nestedPayloadData==='object'&&!Array.isArray(nestedPayloadData))?nestedPayloadData:(payload||{}))};
  const current=id?await getDomainRow(db,'departures',id):null;
  const initialSchedule=await resolveSchedule(db,user,{...current,...source});
  if(!initialSchedule)throw new Error('Escala vinculada não encontrada.');

  // A troca na Saída usa a MESMA trava granular por recurso da Escala. Travamos
  // tanto a equipe atual quanto a pretendida e relemos a Escala já dentro do lock.
  // Isso fecha a corrida em que dois operadores, em viagens diferentes, poderiam
  // escolher simultaneamente o mesmo motorista/ajudante antes de um deles gravar.
  const requestedLockRow={...initialSchedule,...source};
  return withScheduleResourceLocks(db,[initialSchedule,requestedLockRow],initialSchedule.data,async()=>{
    const schedule=await resolveSchedule(db,user,{...current,...source});
    if(!schedule)throw new Error('Escala vinculada não encontrada.');
    const toleranceMinutes=await departureToleranceMinutes(db);
    const status=departureStatus(source.status||source.status_saida);
    const merged={...schedule,...current,...source,status,data:dateIso(source.data||schedule.data),schedule_record_id:String(schedule.id),escala_id:String(schedule.sourceKey||schedule.id)};
    merged.hora_programada=timeOnly(source.hora_programada||schedule.horario_ponto);
    merged.hora_real=timeOnly(source.hora_real);
    merged.placa=clean(source.placa||schedule.placa,30).toUpperCase();
    // Motorista/ajudantes da Saída são resolvidos contra a mesma base usada pela
    // Escala. Troca operacional não aceita texto livre: grava ID + nome canônicos e
    // bloqueia recurso duplicado/em rota sem Retorno confirmado.
    // PENDENTE/NÃO SAIU/CANCELADO sem troca de equipe não precisam carregar
    // Escala + Retornos + Monitoramento de três semanas apenas para preservar a
    // equipe que já está na própria escala. Esse caminho pesado era a principal
    // fonte de HTTP 503 ao marcar "NÃO SAIU" em bases com histórico grande.
    // Saídas realizadas continuam passando por toda a validação de conflito.
    const nonMovementStatus=['PENDENTE','NAO SAIU','NÃO SAIU','CANCELADO'].includes(status);
    const crew=nonMovementStatus&&sameCrewSelection(schedule,source)&&sameVehicleSelection(schedule,source)
      ?existingCrew(schedule)
      :await resolveOperationalCrewChange(db,user,schedule,source,current||schedule);
    merged.veiculo_id=crew.veiculo_id||merged.veiculo_id||schedule.veiculo_id||'';
    merged.placa=clean(crew.placa||merged.placa||schedule.placa,30).toUpperCase();
    merged.motorista_id=crew.motorista_id;merged.motorista=crew.motorista;
    merged.ajudante_1_id=crew.ajudante_1_id;merged.ajudante_1=crew.ajudante_1;
    merged.ajudante_2_id=crew.ajudante_2_id;merged.ajudante_2=crew.ajudante_2;
    merged.tipo_equipe=crew.tipo_equipe||merged.tipo_equipe||schedule.tipo_equipe;
    merged.ajudantes=helpers(merged);
    merged.regiao=clean(source.regiao||schedule.regiao,80); merged.rota=clean(source.rota||schedule.rota,240); merged.ocs=clean(source.ocs||schedule.ocs,500);
    const changeList=changes(resourceSnapshot(current||schedule),resourceSnapshot(merged));
    if(changeList.length&&!clean(source.justificativa_troca))throw new Error('Informe a justificativa para a alocação ou troca de recursos.');
    merged.trocas_recursos=[...(Array.isArray(current?.trocas_recursos)?current.trocas_recursos:[]),...changeList.map((item)=>({...item,justificativa:clean(source.justificativa_troca),autor:userName(user),data_hora:new Date().toISOString()}))];
    // A placa operacional pode mudar na saída, mas a Lincros continua vinculada à
    // placa que recebeu a roteirização original. Preservamos essa referência separada
    // para não deixar a troca operacional quebrar o vínculo das entregas.
    merged.placa_original=originalPlateFromResourceHistory(merged,schedule.placa);
    merged.placa_lincros=merged.placa_original||merged.placa;
    const resourceExtra={
      veiculo_id:merged.veiculo_id||'',placa:merged.placa||'',
      motorista_id:merged.motorista_id,motorista:merged.motorista,
      ajudante_1_id:merged.ajudante_1_id,ajudante_1:merged.ajudante_1,
      ajudante_2_id:merged.ajudante_2_id,ajudante_2:merged.ajudante_2,
      tipo_equipe:merged.tipo_equipe,
    };
    if(status==='SAIU')validateDelay(merged,toleranceMinutes);
    else {merged.hora_real=timeOnly(source.hora_real);merged.atraso_minutos=0;merged.dentro_tolerancia=false;}
    merged.status_saida=status; merged.status=status; merged.usuario=userName(user);
    const record=await upsertDomainRow(db,'departures',merged,user,id);
    if(status==='SAIU'){
      await updateVehicleLastDriver(db,{placa:merged.placa,vehicleId:merged.veiculo_id||source.veiculo_id||schedule.veiculo_id,motoristaId:merged.motorista_id||schedule.motorista_id,motoristaNome:merged.motorista,scheduleId:schedule.id,effectiveAt:merged.saida_real||localDateTime(merged.data,merged.hora_real)||new Date().toISOString()}).catch((error)=>console.error('Vehicle last-driver warning',error));
      const currentScheduleStatus=normalizeText(schedule.status);
      const nextScheduleStatus=['FINALIZADO','RETORNOU'].includes(currentScheduleStatus)?currentScheduleStatus:'EM ROTA';
      await safeUpdateScheduleStatus(db,user,schedule,nextScheduleStatus,resourceExtra);
      await ensureMonitoringForDeparture(db,user,{...schedule,...resourceExtra,status:nextScheduleStatus},record);
      await emitResourceStatus(db,user,{...schedule,...merged},'EM ROTA','SAIDA',{departureId:record.id,automatico:Boolean(merged.automatico),origem:merged.origem_saida||merged.origem||''});
    } else if(status==='TRANSFERIDO'){
      await safeUpdateScheduleStatus(db,user,schedule,'FINALIZADO',{...resourceExtra,observacoes:[schedule.observacoes,'Transferência operacional registrada'].filter(Boolean).join(' · ')});
      const transferred=await createTransferredSchedule(db,user,{...schedule,...resourceExtra,status:'FINALIZADO'},merged,{alreadyLocked:true});
      await safeUpdateScheduleStatus(db,user,schedule,'FINALIZADO',{...resourceExtra,observacoes:[schedule.observacoes,`Transferida para ${transferred?.data||addDays(schedule.data,1)}`].filter(Boolean).join(' · ')});
      const monitoring=await findDomainBySchedule(db,'monitoring',schedule.id); if(monitoring)await ensureMonitoringForDeparture(db,user,{...schedule,...resourceExtra},{...record,status:'FINALIZADO',status_saida:'TRANSFERIDO'});
      await emitResourceStatus(db,user,{...schedule,...merged},'DISPONÍVEL','TRANSFERENCIA',{departureId:record.id});
    } else if(['NÃO SAIU','NAO SAIU','CANCELADO'].includes(status)) {
      await safeUpdateScheduleStatus(db,user,schedule,status==='CANCELADO'?'CANCELADO':'PROGRAMADO',resourceExtra);
      await emitResourceStatus(db,user,{...schedule,...merged},'DISPONÍVEL','SAIDA_NAO_REALIZADA',{departureId:record.id});
    } else if(changeList.length) {
      // Mesmo antes da confirmação da saída, uma troca feita nesta tela passa a ser a
      // equipe oficial da Escala e reaparece ao voltar para o planejamento/impressão.
      await safeUpdateScheduleStatus(db,user,schedule,schedule.status||'PROGRAMADO',resourceExtra);
    }
    return {record,toleranceMinutes,avisos:merged.atraso_minutos>toleranceMinutes?[`Saída com ${merged.atraso_minutos} minutos de atraso.`]:[]};
  });
}
export async function removeDeparture(db,user,id) { const current=await getDomainRow(db,'departures',id); if(!current)throw new Error('Saída não encontrada.'); if(normalizeText(current.status)==='SAIU')throw new Error('Uma saída realizada não pode ser excluída; ajuste o registro ou finalize o fluxo.'); return deleteDomainRow(db,'departures',id,user); }

function localPartsRecife(value){
  const raw=String(value||'').trim();
  if(raw){
    let match=raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})/);
    if(match)return {date:`${match[1]}-${match[2]}-${match[3]}`,time:`${String(match[4]).padStart(2,'0')}:${match[5]}`,iso:`${match[1]}-${match[2]}-${match[3]}T${String(match[4]).padStart(2,'0')}:${match[5]}:00`};
    match=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if(match)return {date:`${match[3]}-${match[2]}-${match[1]}`,time:`${String(match[4]||'00').padStart(2,'0')}:${match[5]||'00'}`,iso:`${match[3]}-${match[2]}-${match[1]}T${String(match[4]||'00').padStart(2,'0')}:${match[5]||'00'}:00`};
  }
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  const get=(type)=>parts.find((item)=>item.type===type)?.value||'';
  return {date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`,iso:`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00`};
}
function normalizeFacility(value){return normalizeText(value).replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function normalizePlate(value){return normalizeText(value).replace(/[^A-Z0-9]/g,'');}
function facilityTokens(name){return normalizeFacility(name).split(' ').filter((token)=>token.length>=4&&!['ALIMENTOS'].includes(token));}
function textMatchesFacility(value,facilityName){
  const normalized=normalizeFacility(value); if(!normalized)return false;
  const tokens=facilityTokens(facilityName); return tokens.length?tokens.every((token)=>normalized.includes(token)):normalized.includes('NOTARO');
}
function explicitDistanceToPoint(position={}){
  const direct=position?.distanceToPoint;
  if(direct!==null&&direct!==undefined&&String(direct).trim()!==''){
    const n=Number(direct);if(Number.isFinite(n))return n;
  }
  const raw=position?.raw||{};
  for(const key of ['DIST_PONTO','DISTANCIA_PONTO','DISTANCIA','DISTANCE','DIST_PONTO_METROS','DISTANCIA_PONTO_METROS','DISTANCIA_METROS','__DMS_DISTANCE_TO_POINT']){
    const value=raw?.[key];if(value===null||value===undefined||String(value).trim()==='')continue;
    const n=Number(String(value).replace(',','.'));if(Number.isFinite(n))return n;
  }
  return null;
}
function isInsideFacilityPosition(position,facilityName,radiusMeters=DEFAULT_FACILITY_RADIUS_METERS){
  const point=String(position?.point||position?.raw?.PONTO||position?.raw?.PONTO_PROXIMO||'');
  const location=String(position?.location||position?.raw?.LOCALIZACAO||position?.raw?.LOCALIZAÇÃO||'');
  const matched=textMatchesFacility(point,facilityName)||textMatchesFacility(location,facilityName);
  if(!matched)return false;
  // O nome do ponto pode continuar sendo "Natto/Notaro" mesmo depois que o veículo
  // já saiu. Só tratamos como dentro quando a API fornece distância explícita.
  const distance=explicitDistanceToPoint(position);
  return Number.isFinite(distance)&&distance<=Number(radiusMeters||DEFAULT_FACILITY_RADIUS_METERS);
}

function gpsWallClockMs(value){
  const raw=String(value||'').trim().replace(' ','T');
  const match=raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if(!match)return NaN;
  return Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),Number(match[4]),Number(match[5]),Number(match[6]||0));
}
function gpsDistanceMeters(aLat,aLng,bLat,bLng){
  const lat1=Number(aLat),lon1=Number(aLng),lat2=Number(bLat),lon2=Number(bLng);
  if(![lat1,lon1,lat2,lon2].every(Number.isFinite))return NaN;
  const rad=(value)=>value*Math.PI/180,R=6371000;
  const dLat=rad(lat2-lat1),dLon=rad(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function rawFacilityMatch(raw,names=[]){
  return names.some((facilityName)=>textMatchesFacility(raw?.PONTO,facilityName)||textMatchesFacility(raw?.PONTO_PROXIMO,facilityName)||textMatchesFacility(raw?.LOCALIZACAO,facilityName)||textMatchesFacility(raw?.['LOCALIZAÇÃO'],facilityName));
}
function rawGpsTimestampReliable(raw={}){
  if(Object.prototype.hasOwnProperty.call(raw,'__DMS_TIMESTAMP_RELIABLE'))return raw.__DMS_TIMESTAMP_RELIABLE!==false&&String(raw.__DMS_TIMESTAMP_RELIABLE)!=='false';
  return Boolean(raw?.DT_POSICAO||raw?.DATA_POSICAO||raw?.DATA_HORA_POSICAO||raw?.DATAHORA_POSICAO||raw?.DT_ULTIMA_POSICAO||raw?.DATA_POSICAO_GPS||raw?.DH_POSICAO||raw?.DATA_GPS||raw?.DATAHORA||raw?.DATA_HORA||raw?.DATA_EVENTO||raw?.HORA_POSICAO||raw?.HR_POSICAO||raw?.ULTIMA_ATUALIZACAO);
}
function historyRowGpsTimestampReliable(row={}){
  let raw={};try{raw=JSON.parse(row?.RAW_JSON||'{}');}catch{}
  return rawGpsTimestampReliable(raw);
}
function historyRowDistanceToPoint(row={},raw={}){
  for(const value of [raw?.DIST_PONTO,raw?.DISTANCIA_PONTO,raw?.DISTANCIA,raw?.DISTANCE,raw?.DIST_PONTO_METROS,raw?.DISTANCIA_PONTO_METROS,raw?.DISTANCIA_METROS,raw?.__DMS_DISTANCE_TO_POINT]){
    if(value===null||value===undefined||String(value).trim()==='')continue;
    const n=Number(String(value).replace(',','.'));if(Number.isFinite(n))return n;
  }
  return null;
}
function historyRowInsideFacility(row,names=[],anchors=[],radiusMeters=DEFAULT_FACILITY_RADIUS_METERS){
  let raw={};try{raw=JSON.parse(row?.RAW_JSON||'{}');}catch{}
  const textMatched=names.some((facilityName)=>textMatchesFacility(row?.POINT_TEXT,facilityName)||textMatchesFacility(row?.LOCATION_TEXT,facilityName))||rawFacilityMatch(raw,names);
  const explicitDistance=historyRowDistanceToPoint(row,raw);
  if(textMatched&&Number.isFinite(explicitDistance))return explicitDistance<=Number(radiusMeters||DEFAULT_FACILITY_RADIUS_METERS);
  const lat=Number(row?.LATITUDE),lng=Number(row?.LONGITUDE);
  if(Number.isFinite(lat)&&Number.isFinite(lng)&&anchors.length){
    return anchors.some((anchor)=>{const distance=gpsDistanceMeters(lat,lng,anchor.lat,anchor.lng);return Number.isFinite(distance)&&distance<=Number(radiusMeters||DEFAULT_FACILITY_RADIUS_METERS);});
  }
  return false;
}
async function departureTransitionEvidence(db,plate,currentPosition,currentParts,facilityNames,radiusMeters,options={}){
  const names=(Array.isArray(facilityNames)?facilityNames:[facilityNames]).filter(Boolean);
  const maxLookbackMinutes=Math.max(30,Number(options.maxLookbackMinutes||2160));
  const exitBufferMeters=Math.max(20,Number(options.exitBufferMeters||40));
  const currentMs=gpsWallClockMs(currentParts?.iso||currentPosition?.updatedAt);
  if(!Number.isFinite(currentMs))return {confirmed:false,reason:'GPS_TIME_INVALID'};
  try{
    const fromIso=new Date(currentMs-maxLookbackMinutes*60000).toISOString().slice(0,19);
    const {results=[]}=await db.prepare(`SELECT GPS_TIME,LATITUDE,LONGITUDE,POINT_TEXT,LOCATION_TEXT,SPEED,RAW_JSON FROM ROUTE_GPS_POSITIONS WHERE PLATE=? AND GPS_TIME>=? AND GPS_TIME<=? ORDER BY GPS_TIME ASC LIMIT 720`).bind(normalizePlate(plate),fromIso,currentParts.iso).all();
    const anchors=[...(Array.isArray(options.facilityAnchors)?options.facilityAnchors:[])],weakSamples=[];
    for(const row of results){
      let raw={};try{raw=JSON.parse(row.RAW_JSON||'{}');}catch{}
      const matched=names.some((facilityName)=>textMatchesFacility(row.POINT_TEXT,facilityName)||textMatchesFacility(row.LOCATION_TEXT,facilityName))||rawFacilityMatch(raw,names);
      const lat=Number(row.LATITUDE),lng=Number(row.LONGITUDE),distance=historyRowDistanceToPoint(row,raw);
      if(!matched||!Number.isFinite(lat)||!Number.isFinite(lng))continue;
      if(Number.isFinite(distance)&&distance<=Number(radiusMeters||DEFAULT_FACILITY_RADIUS_METERS))anchors.push({lat,lng,time:row.GPS_TIME,strong:true});
      else if(!Number.isFinite(distance)&&Number(row.SPEED||0)<=3)weakSamples.push({lat,lng,time:row.GPS_TIME});
    }
    // Alguns retornos da ProtectSat não trazem DIST_PONTO. Nessa situação só
    // aceitamos o texto da unidade como âncora quando existem pelo menos duas
    // posições estacionárias coerentes no mesmo agrupamento físico.
    if(!anchors.length&&weakSamples.length){
      const clusterRadius=Number(radiusMeters||DEFAULT_FACILITY_RADIUS_METERS)+60;
      if(weakSamples.length===1){
        // Uma única leitura estacionária identificada explicitamente como a unidade
        // pode servir de âncora provisória. A saída continua exigindo DUAS posições
        // GPS externas distintas e deslocamento acima do raio+buffer, evitando salto isolado.
        anchors.push(weakSamples[0]);
      }else{
        for(const sample of weakSamples){
          const peers=weakSamples.filter((other)=>other!==sample&&Number.isFinite(gpsDistanceMeters(sample.lat,sample.lng,other.lat,other.lng))&&gpsDistanceMeters(sample.lat,sample.lng,other.lat,other.lng)<=clusterRadius);
          if(peers.length){anchors.push(sample,...peers);break;}
        }
        if(!anchors.length)anchors.push(weakSamples[0]);
      }
    }
    const currentLat=Number(currentPosition?.latitude),currentLng=Number(currentPosition?.longitude);
    const currentByAnchor=Number.isFinite(currentLat)&&Number.isFinite(currentLng)&&anchors.some((anchor)=>{
      const distance=gpsDistanceMeters(currentLat,currentLng,anchor.lat,anchor.lng);
      return Number.isFinite(distance)&&distance<=Number(radiusMeters||DEFAULT_FACILITY_RADIUS_METERS);
    });
    if(currentByAnchor)return {confirmed:false,reason:'CURRENT_STILL_INSIDE_BY_COORDINATES'};

    let lastInsideIndex=-1;
    for(let i=0;i<results.length;i+=1){if(historyRowInsideFacility(results[i],names,anchors,radiusMeters))lastInsideIndex=i;}
    if(lastInsideIndex<0)return {confirmed:false,reason:'NO_RECENT_INSIDE_POSITION'};
    const insideRow=results[lastInsideIndex];
    const insideMs=gpsWallClockMs(insideRow.GPS_TIME);
    if(!Number.isFinite(insideMs)||insideMs>=currentMs)return {confirmed:false,reason:'INSIDE_NOT_BEFORE_CURRENT'};

    const exitRadius=Number(radiusMeters||DEFAULT_FACILITY_RADIUS_METERS)+exitBufferMeters;
    const insideLat=Number(insideRow.LATITUDE),insideLng=Number(insideRow.LONGITUDE);
    const outsideEnough=(row)=>{
      if(historyRowInsideFacility(row,names,anchors,radiusMeters))return false;
      const lat=Number(row?.LATITUDE),lng=Number(row?.LONGITUDE);
      if(Number.isFinite(insideLat)&&Number.isFinite(insideLng)&&Number.isFinite(lat)&&Number.isFinite(lng)){
        const moved=gpsDistanceMeters(insideLat,insideLng,lat,lng);
        return Number.isFinite(moved)&&moved>exitRadius;
      }
      return Number(row?.SPEED||0)>=3;
    };
    const outsideCandidates=[];
    const requiredOutsideConfirmations=Math.max(2,Math.round(Number(options.outsideConfirmations||2)));
    const pushOutside=(row)=>{
      if(!row||!outsideEnough(row)||!historyRowGpsTimestampReliable(row))return;
      const time=String(row.GPS_TIME||'').replace(' ','T').slice(0,19);
      if(!time||outsideCandidates.some((item)=>String(item.GPS_TIME||'').replace(' ','T').slice(0,19)===time))return;
      outsideCandidates.push(row);
    };
    for(let i=lastInsideIndex+1;i<results.length;i+=1)pushOutside(results[i]);
    const currentRow={GPS_TIME:currentParts.iso,LATITUDE:currentPosition?.latitude,LONGITUDE:currentPosition?.longitude,POINT_TEXT:currentPosition?.point,LOCATION_TEXT:currentPosition?.location,SPEED:currentPosition?.speed,RAW_JSON:JSON.stringify({...(currentPosition?.raw||{}),__DMS_TIMESTAMP_RELIABLE:currentPosition?.timestampReliable!==false,__DMS_TIMESTAMP_SOURCE:currentPosition?.timestampSource||''})};
    pushOutside(currentRow);
    if(!outsideCandidates.length)return {confirmed:false,reason:'NO_CLEAR_EXIT_TRANSITION'};
    // Uma leitura isolada fora pode ser salto de GPS ou mudança de ponto/localização na API.
    // Exigimos leituras GPS distintas fora da geofence; ao confirmar, salvamos a PRIMEIRA.
    if(outsideCandidates.length<requiredOutsideConfirmations)return {confirmed:false,reason:'WAITING_OUTSIDE_CONFIRMATIONS',required:requiredOutsideConfirmations,received:outsideCandidates.length,firstOutsideAt:String(outsideCandidates[0]?.GPS_TIME||'')};
    const firstOutside=outsideCandidates[0],secondOutside=outsideCandidates[requiredOutsideConfirmations-1];
    const exitMs=gpsWallClockMs(firstOutside.GPS_TIME),confirmMs=gpsWallClockMs(secondOutside.GPS_TIME);
    if(!Number.isFinite(exitMs)||exitMs<=insideMs)return {confirmed:false,reason:'EXIT_TIME_INVALID'};
    if(!Number.isFinite(confirmMs)||confirmMs<=exitMs)return {confirmed:false,reason:'OUTSIDE_CONFIRMATION_TIME_INVALID'};
    return {confirmed:true,exitAt:String(firstOutside.GPS_TIME).replace(' ','T').slice(0,19),confirmedOutsideAt:String(secondOutside.GPS_TIME).replace(' ','T').slice(0,19),insideAt:String(insideRow.GPS_TIME).replace(' ','T').slice(0,19),anchors:anchors.length};
  }catch(error){return {confirmed:false,reason:'TRANSITION_QUERY_FAILED',error:error?.message||String(error)};}
}


async function saveAutomaticDepartureWithRetry(db,user,payload,id=null){
  let lastError=null;
  for(let attempt=0;attempt<3;attempt+=1){
    try{return await saveDeparture(db,user,payload,id);}
    catch(error){
      lastError=error;
      if(String(error?.code||'')!=='RESOURCE_LOCKED'||attempt===2)throw error;
      await new Promise((resolve)=>setTimeout(resolve,450+(attempt*650)));
    }
  }
  throw lastError||new Error('Falha ao registrar saída automática.');
}

const GPS_AUTOMATION_USER=Object.freeze({id:0,name:'AUTOMAÇÃO GPS',email:'',role:'ADMIN',perfil:'ADMIN',permissions:['*'],bases:['route']});
export async function autoConfirmDeparturesFromGps(db,callerUser,positions=[],options={}){
  // Saída automática por GPS é da automação, nunca do usuário logado que abriu a tela.
  const user={...GPS_AUTOMATION_USER};
  const configured=Array.isArray(options.facilityNames)?options.facilityNames:String(options.facilityNames||'').split('|');
  const diagnostics=Array.isArray(options.diagnostics)?options.diagnostics:null;
  const legacy=clean(options.facilityName||'',240);
  const facilityNames=[...new Set([...(legacy?[legacy]:[]),...configured,...DEFAULT_FACILITY_NAMES].map((value)=>clean(value,240)).filter(Boolean))];
  const facilityLabel=facilityNames.join(' / ');
  const facilityRadiusMeters=Math.max(20,Number(options.facilityRadiusMeters||DEFAULT_FACILITY_RADIUS_METERS));
  const byDate=new Map();
  const results=[];
  const systemUser=user||{id:0,name:'AUTOMAÇÃO GPS',email:'',role:'ADMIN',perfil:'ADMIN',permissions:['*'],bases:['route']};
  const facilityAnchors=Array.isArray(options.facilityAnchors)?options.facilityAnchors:await loadGpsFacilityAnchors(db,facilityNames,facilityRadiusMeters).catch(()=>[]);
  for(const position of positions||[]){
    const plate=normalizePlate(position?.plate); if(!plate)continue;
    const diagnostic=(reason,extra={})=>{if(diagnostics)diagnostics.push({plate,reason,...extra});};
    try{
    if(facilityNames.some((facilityName)=>isInsideFacilityPosition(position,facilityName,facilityRadiusMeters))||positionInsideFacilityAnchors(position,facilityAnchors,facilityRadiusMeters)){diagnostic('CURRENT_INSIDE_FACILITY',{gpsAt:String(position?.updatedAt||''),anchorBased:positionInsideFacilityAnchors(position,facilityAnchors,facilityRadiusMeters)});continue;}
    // Para saída automática, não aceitamos timestamp genérico da API: isso poderia
    // gravar o horário em que a grade/API foi atualizada, e não o horário da posição GPS.
    if(position?.timestampReliable===false){diagnostic('GPS_TIMESTAMP_UNRELIABLE',{gpsAt:String(position?.updatedAt||'')});continue;}
    const parts=localPartsRecife(position?.updatedAt);
    if(!parts.date||!parts.time){diagnostic('GPS_TIME_INVALID',{gpsAt:String(position?.updatedAt||'')});continue;}
    if(!byDate.has(parts.date)){
      const [schedules,departures]=await Promise.all([schedulesFor(db,systemUser,{start:parts.date,end:parts.date}),listDepartures(db,systemUser,{start:parts.date,end:parts.date,limit:10000})]);
      byDate.set(parts.date,{schedules,departures,departureMatcher:buildDepartureMatcher(departures)});
    }
    const context=byDate.get(parts.date);
    const candidates=(context.schedules||[]).filter((schedule)=>!departureExemptSchedule(schedule)&&normalizePlate(schedule.placa)===normalizePlate(plate)&&!['CANCELADO','FINALIZADO','RETORNOU'].includes(normalizeText(schedule.status)));
    const pendingCandidates=candidates.filter((item)=>{
      const departure=matchDepartureToSchedule(context.departureMatcher,item);
      const status=normalizeText(departure?.status||departure?.status_saida||'PENDENTE');
      return !departure||status==='PENDENTE';
    });
    if(!pendingCandidates.length){diagnostic('NO_PENDING_SCHEDULE',{gpsAt:parts.iso,date:parts.date});continue;}
    const nowParts=localPartsRecife();
    const gpsAge=Math.max(0,diffMinutes(parts.iso,nowParts.iso)||0);
    const maxGpsAgeMinutes=Math.max(5,Number(options.maxGpsAgeMinutes||90));
    if(gpsAge>maxGpsAgeMinutes){diagnostic('GPS_STALE',{gpsAt:parts.iso,gpsAgeMinutes:Math.round(gpsAge),maxGpsAgeMinutes});continue;}
    const transition=await departureTransitionEvidence(db,plate,position,parts,facilityNames,facilityRadiusMeters,{
      maxLookbackMinutes:Number(options.transitionLookbackMinutes||2160),
      exitBufferMeters:Number(options.exitBufferMeters||40),
      outsideConfirmations:Number(options.outsideConfirmations||2),
      facilityAnchors,
    });
    if(!transition.confirmed){diagnostic(transition.reason||'TRANSITION_NOT_CONFIRMED',{gpsAt:parts.iso,...transition});continue;}
    const exitParts=localPartsRecife(transition.exitAt);
    const actualAt=localDateTime(exitParts.date,exitParts.time);
    const earlyWindowMinutes=Math.max(0,Number(options.earlyWindowMinutes||60));
    const lateWindowMinutes=Math.max(60,Number(options.lateWindowMinutes||1440));
    const eligible=pendingCandidates.map((item)=>{
      const planned=timeOnly(item.horario_ponto||item.hora_saida_programada);
      const plannedAt=localDateTime(item.data||exitParts.date,planned);
      const minutesAfterPlan=diffMinutes(plannedAt,actualAt);
      const minutesBeforePlan=diffMinutes(actualAt,plannedAt);
      const validEarly=!Number.isFinite(minutesBeforePlan)||minutesBeforePlan<=earlyWindowMinutes;
      const validLate=!Number.isFinite(minutesAfterPlan)||minutesAfterPlan<=lateWindowMinutes;
      const distance=Math.abs(Number(minutesAfterPlan||0));
      return {item,planned,plannedAt,valid:validEarly&&validLate,distance};
    }).filter((entry)=>entry.valid).sort((a,b)=>a.distance-b.distance);
    if(!eligible.length){diagnostic('OUTSIDE_SCHEDULE_WINDOW',{gpsAt:parts.iso,earlyWindowMinutes,lateWindowMinutes});continue;}
    const schedule=eligible[0].item;
    const planned=eligible[0].planned;
    const plannedAt=eligible[0].plannedAt;
    const existing=matchDepartureToSchedule(context.departureMatcher,schedule);
    const toleranceMinutes=await departureToleranceMinutes(db);
    const delay=Math.max(0,diffMinutes(plannedAt,actualAt)||0);
    const automaticReason=delay>toleranceMinutes?{
      motivo_atraso:'SAÍDA AUTOMÁTICA GPS',responsavel_atraso:'AUTOMAÇÃO GPS',detalhe_motivo:`Saída detectada automaticamente após o veículo deixar uma referência da unidade de Recife (${facilityLabel}).`,justificativa_ocorrencia:'',ocorrencia_justificada:false,ocorrencia_origem:'AUTOMÁTICA',
    }:{};
    const saved=await saveAutomaticDepartureWithRetry(db,systemUser,{id:existing?.id||null,requestId:`GPS:${parts.date}:${plate}:${schedule.id}`,data:{
      ...schedule,...(existing||{}),schedule_record_id:String(schedule.id),escala_id:String(schedule.sourceKey||schedule.id),data:exitParts.date,status:'SAIU',status_saida:'SAIU',hora_programada:planned,hora_real:exitParts.time,
      placa:plate,motorista:schedule.motorista,ajudante_1:schedule.ajudante_1,ajudante_2:schedule.ajudante_2,origem_saida:'GPS_GEOFENCE',automatico:true,
      gps_saida_detectada_em:nowParts.iso,gps_saida_primeira_posicao_fora:transition.exitAt,gps_saida_confirmacao_posicao_fora:transition.confirmedOutsideAt,gps_saida_ultima_posicao_dentro:transition.insideAt,
      observacoes:[clean(existing?.observacoes),`SAÍDA AUTOMÁTICA: duas posições GPS consecutivas confirmaram a saída. Horário registrado = primeira posição fora às ${exitParts.time}; confirmação externa às ${localPartsRecife(transition.confirmedOutsideAt).time}; última posição dentro às ${localPartsRecife(transition.insideAt).time}.`].filter(Boolean).join(' · '),...automaticReason,
    }},existing?.id||null);
    context.departures.push(saved.record);context.departureMatcher=buildDepartureMatcher(context.departures);
    results.push({plate,scheduleId:String(schedule.id),departureId:saved.record?.id||null,time:exitParts.time,exitAt:transition.exitAt,insideAt:transition.insideAt,facilityNames});
    diagnostic('CONFIRMED',{scheduleId:String(schedule.id),departureId:saved.record?.id||null,exitAt:transition.exitAt});
    }catch(error){
      // Uma placa com conflito/registro inconsistente não pode cancelar a varredura
      // inteira. As demais viagens continuam sendo avaliadas e esta placa será
      // tentada novamente na próxima sincronização GPS.
      const warning=`Saída automática ${plate}: ${error?.message||String(error)}`;
      diagnostic('ERROR',{message:error?.message||String(error),code:error?.code||''});
      if(Array.isArray(options.warnings))options.warnings.push(warning);
      console.error('GPS auto departure warning',plate,error?.code||'',error?.message||error);
      continue;
    }
  }
  return results;
}


function departureHelperNames(schedule={},departure={}){
  schedule=schedule||{};departure=departure||{};
  const names=[];
  const add=(value)=>{const label=clean(value,180);if(!label)return;const key=normalizeText(label);if(!key||names.some((item)=>normalizeText(item)===key))return;names.push(label);};
  add(departure.ajudante_1||schedule.ajudante_1);
  add(departure.ajudante_2||schedule.ajudante_2);
  if(!names.length){
    const combined=clean(departure.ajudantes||schedule.ajudantes,360);
    for(const part of String(combined||'').split(/\s*(?:\/|;|\||,)\s*/))add(part);
  }
  return names;
}

export function buildDepartureCrewRankings(items=[],toleranceMinutes=DEFAULT_TOLERANCE_MINUTES,options={}){
  const driverMap=new Map(),helperMap=new Map();
  const helperFilter=normalizeText(options.helperFilter||'');
  const add=(map,name,delayMinutes)=>{
    const label=clean(name,180);if(!label)return;const key=normalizeText(label);if(!key)return;
    const row=map.get(key)||{name:label,departures:0,delayOccurrences:0,withinTolerance:0,totalDelayMinutes:0,averageDelayMinutes:0,status:'DENTRO_TOLERANCIA'};
    const delay=Math.max(0,Number(delayMinutes||0));row.departures+=1;row.totalDelayMinutes+=delay;
    if(delay>Number(toleranceMinutes||0))row.delayOccurrences+=1;else row.withinTolerance+=1;
    row.averageDelayMinutes=row.departures?Math.round((row.totalDelayMinutes/row.departures)*10)/10:0;
    row.totalDelayMinutes=Math.round(row.totalDelayMinutes*10)/10;
    row.status=row.delayOccurrences>0?'ATRASO':'DENTRO_TOLERANCIA';map.set(key,row);
  };
  for(const item of items||[]){
    const schedule=item?.schedule||{},departure=item?.departure||{},delay=Number(item?.delayMinutes||0);
    add(driverMap,departure.motorista||schedule.motorista,delay);
    for(const helper of departureHelperNames(schedule,departure)){if(!helperFilter||normalizeText(helper)===helperFilter)add(helperMap,helper,delay);}
  }
  const finalize=(map)=>[...map.values()].map((row)=>({...row,totalDelayMinutes:Math.round(Number(row.totalDelayMinutes||0)*10)/10,averageDelayMinutes:Math.round(Number(row.averageDelayMinutes||0)*10)/10})).sort((a,b)=>b.delayOccurrences-a.delayOccurrences||b.totalDelayMinutes-a.totalDelayMinutes||a.name.localeCompare(b.name,'pt-BR'));
  return {drivers:finalize(driverMap),helpers:finalize(helperMap)};
}

export async function departureDashboard(db,user,filters={}) {
  // Carrega tolerância, saídas e escalas em paralelo. O endpoint de indicadores era
  // um dos poucos que fazia essas leituras sequencialmente; em conexão lenta/D1
  // congestionado isso aumentava a janela para HTTP 503 sem trazer benefício.
  // Mantemos o universo do período sem aplicar busca/filtros antes do vínculo para
  // não transformar uma saída existente em pendente apenas por causa do filtro.
  const dataFilters={start:dateIso(filters.start||filters.inicio),end:dateIso(filters.end||filters.fim),date:dateIso(filters.date||filters.data)};
  const [toleranceMinutes,rows,schedules,driverRelations]=await Promise.all([
    departureToleranceMinutes(db),
    listDepartures(db,user,{...dataFilters,limit:5000}),
    schedulesFor(db,user,dataFilters),
    driverRelationMap(db),
  ]);
  const matcher=buildDepartureMatcher(rows);
  const operational=schedules.filter((row)=>normalizeText(row.status)!=='CANCELADO'&&!departureExemptSchedule(row));
  const joinedAll=operational.map((schedule)=>{const departure=matchDepartureToSchedule(matcher,schedule);const driver=departure?.motorista||schedule.motorista;return {schedule,departure,driverRelation:driverRelationFor(driver,driverRelations),helpers:departureHelperNames(schedule,departure)};});
  const filterOptions={
    regions:[...new Set(joinedAll.map(({schedule,departure})=>clean(schedule.regiao||departure?.regiao)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')),
    routes:[...new Set(joinedAll.map(({schedule,departure})=>clean(schedule.rota||departure?.rota)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')),
    drivers:[...new Set(joinedAll.map(({schedule,departure})=>clean(departure?.motorista||schedule.motorista)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')),
    helpers:[...new Set(joinedAll.flatMap(({helpers})=>helpers||[]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')),
    reasons:[...new Set(joinedAll.map(({departure})=>clean(departure?.motivo_atraso)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')),
    driverRelations:[...new Set(joinedAll.map(({driverRelation})=>driverRelation).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')),
    plates:[...new Set(joinedAll.map(({schedule,departure})=>clean(departure?.placa||schedule.placa).toUpperCase()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')),
  };
  const regionFilter=normalizeText(filters.region||filters.regiao||'');
  const routeFilter=normalizeText(filters.route||filters.rota||'');
  const driverFilter=normalizeText(filters.driver||filters.motorista||'');
  const driverRelationFilter=normalizeText(filters.driverRelation||filters.driver_relation||filters.vinculoMotorista||filters.vinculo_motorista||'');
  const helperFilter=normalizeText(filters.helper||filters.ajudante||'');
  const reasonFilter=normalizeText(filters.reason||filters.motivo||filters.motivo_atraso||'');
  const plateFilter=normalizeText(filters.plate||filters.placa||'');
  const query=normalizeText(filters.q||filters.busca||'');
  const joined=joinedAll.filter(({schedule,departure,driverRelation,helpers})=>{
    const region=normalizeText(schedule.regiao||departure?.regiao||'');
    const route=normalizeText(schedule.rota||departure?.rota||'');
    const driver=normalizeText(departure?.motorista||schedule.motorista||'');
    const plate=normalizeText(departure?.placa||schedule.placa||'');
    if(regionFilter&&region!==regionFilter)return false;
    if(routeFilter&&route!==routeFilter)return false;
    if(driverFilter&&driver!==driverFilter)return false;
    if(driverRelationFilter&&normalizeText(driverRelation)!==driverRelationFilter)return false;
    if(helperFilter&&!(helpers||[]).some((name)=>normalizeText(name)===helperFilter))return false;
    if(reasonFilter&&normalizeText(departure?.motivo_atraso||'')!==reasonFilter)return false;
    if(plateFilter&&plate!==plateFilter)return false;
    if(query&&!normalizeText([schedule.data,schedule.ocs,schedule.rota,schedule.regiao,schedule.placa,schedule.motorista,(helpers||[]).join(' '),departure?.placa,departure?.motorista,departure?.motivo_atraso].join(' ')).includes(query))return false;
    return true;
  });
  // Regra única compartilhada com a Visão Geral: saída realizada exige status
  // SAIU e hora real. O matcher prioriza registros efetivamente realizados e
  // aceita aliases legados e, como fallback, OC/data, rota+placa e sequência.
  const isRealized=({departure}={})=>departureRecordIsRealized(departure||{});
  // A Visão Geral calcula atraso pela diferença entre o horário programado da Escala
  // e a hora real da saída. Não usamos atraso_minutos persistido como fonte do KPI,
  // pois registros históricos podem ter esse campo zerado/desatualizado.
  const withDelay=joined.map((item)=>({...item,delayMinutes:departureDelayMinutes(item.schedule,item.departure||{})}));
  const realized=withDelay.filter(isRealized);
  const delayed=realized.filter((item)=>item.delayMinutes>toleranceMinutes);
  const crewRankings=buildDepartureCrewRankings(realized,toleranceMinutes,{helperFilter});
  const average=realized.length?realized.reduce((sum,item)=>sum+item.delayMinutes,0)/realized.length:0;
  const byRegion={}; const byDay={}; const punctualityByDay={}; const reasons={};
  withDelay.forEach(({schedule,departure,delayMinutes})=>{const region=clean(schedule.regiao||departure?.regiao||'NÃO INFORMADA');byRegion[region]??={programmed:0,departed:0,delayed:0};byRegion[region].programmed++;if(isRealized({departure})){byRegion[region].departed++;const isDelayed=delayMinutes>toleranceMinutes;if(isDelayed)byRegion[region].delayed++;const day=dateIso(departure.data||schedule.data);if(day){byDay[day]??=[];byDay[day].push(delayMinutes);punctualityByDay[day]??={departed:0,delayed:0};punctualityByDay[day].departed++;if(isDelayed)punctualityByDay[day].delayed++;}}const reason=clean(departure?.motivo_atraso);if(reason)reasons[reason]=(reasons[reason]||0)+1;});
  return {versao:'1',toleranceMinutes,period:{start:filters.start||filters.inicio||'',end:filters.end||filters.fim||''},summary:{programmed:withDelay.length,departed:realized.length,pending:withDelay.length-realized.length,delayed:delayed.length,punctualityPercent:realized.length?Math.round((realized.length-delayed.length)/realized.length*1000)/10:0,averageDelayMinutes:Math.round(average*10)/10},rows:withDelay,filters:filterOptions,activeFilters:{region:filters.region||filters.regiao||'',route:filters.route||filters.rota||'',driver:filters.driver||filters.motorista||'',helper:filters.helper||filters.ajudante||'',reason:filters.reason||filters.motivo||filters.motivo_atraso||'',driverRelation:filters.driverRelation||filters.driver_relation||filters.vinculoMotorista||filters.vinculo_motorista||'',plate:filters.plate||filters.placa||'',q:filters.q||filters.busca||''},crewRankings,regionPerformance:Object.entries(byRegion).map(([region,value])=>({region,...value,punctualityPercent:value.departed?Math.round((value.departed-value.delayed)/value.departed*1000)/10:0})),averageDelayByDay:Object.entries(byDay).sort(([a],[b])=>String(a).localeCompare(String(b))).map(([date,values])=>({date,averageDelayMinutes:Math.round(values.reduce((a,b)=>a+b,0)/values.length*10)/10,departures:values.length})),punctualityByDay:Object.entries(punctualityByDay).sort(([a],[b])=>String(a).localeCompare(String(b))).map(([date,value])=>({date,departures:value.departed,delayed:value.delayed,punctualityPercent:value.departed?Math.round((value.departed-value.delayed)/value.departed*1000)/10:0})),reasons:Object.entries(reasons).map(([reason,total])=>({reason,total})).sort((a,b)=>b.total-a.total),loadingSequence:[...realized].sort((a,b)=>String(a.departure.hora_real).localeCompare(String(b.departure.hora_real))).map((item,index)=>({position:index+1,...item}))};
}


/** Reprograma pendências às 15h (America/Recife), mantendo equipe e placa. */
export async function autoTransferUndepartedAt15(db,user,now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now);
  const piece=(type)=>parts.find((part)=>part.type===type)?.value||'';
  const date=`${piece('year')}-${piece('month')}-${piece('day')}`;
  const minutes=Number(piece('hour'))*60+Number(piece('minute'));
  if(minutes<900)return {date,executed:false,transferred:[],errors:[]};
  const control=await listDepartureControlRows(db,user,{date});
  const schedules=await schedulesFor(db,user,{start:date,end:date});
  const activeIds=new Set(schedules.filter((s)=>['EM ROTA','PERNOITE','RETORNOU','FINALIZADO','CANCELADO'].includes(normalizeText(s.status))).map((s)=>String(s.id)));
  const transferred=[],errors=[];
  for(const row of control.records||[]){
    const status=normalizeText(row.status||row.status_saida);
    if(status!=='PENDENTE' || !row.schedule_record_id || !row.placa || activeIds.has(String(row.schedule_record_id)))continue;
    // Reconsulta a linha sob a trava de saveDeparture. Se GPS confirmou saída,
    // saveDeparture deve impedir a transferência (checagem adicional abaixo).
    try {
      const latest=await listDepartures(db,user,{start:date,end:date,limit:10000});
      const actual=latest.find((d)=>String(d.schedule_record_id||d.escala_id||d.schedule_id||'')===String(row.schedule_record_id));
      if(actual&&(departureRecordIsRealized(actual)||['TRANSFERIDO','CANCELADO'].includes(normalizeText(actual.status||actual.status_saida))))continue;
      const result=await saveDeparture(db,user,{
        schedule_record_id:String(row.schedule_record_id),escala_id:String(row.escala_id||row.schedule_record_id),
        data:date,status:'TRANSFERIDO',status_saida:'TRANSFERIDO',
        data_transferencia:addDays(date,1),sequencia_transferencia:'0',
        motivo_transferencia:'Reprogramação automática às 15:00: veículo sem saída registrada',
        hora_programada:row.hora_programada,placa:row.placa,veiculo_id:row.veiculo_id,
        motorista_id:row.motorista_id,motorista:row.motorista,
        ajudante_1_id:row.ajudante_1_id,ajudante_1:row.ajudante_1,
        ajudante_2_id:row.ajudante_2_id,ajudante_2:row.ajudante_2,
        tipo_equipe:row.tipo_equipe,rota:row.rota,regiao:row.regiao,ocs:row.ocs,
      },actual?.id||null);
      transferred.push({scheduleId:row.schedule_record_id,plate:row.placa,resultId:result?.record?.id||null});
    } catch(error){errors.push({scheduleId:row.schedule_record_id,plate:row.placa,message:error?.message||String(error)});}
  }
  return {date,executed:true,transferred,errors};
}
