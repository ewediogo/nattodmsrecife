import { buildResourceCenter } from './core.js';
import { buildExecutionRecordsFromData, summarizeExecutionRecords } from './indicators.js';
import { listDomainRows } from './route-phase1.js';
import { listScheduleRecordsInternal } from './schedule.js';
import { buildDepartureMatcher, departureDelayMinutes, departureRecordIsRealized, departureToleranceMinutes, matchDepartureToSchedule } from './departure.js';

const TYPES = ['3/4','TOCO','TRUCK','BITRUCK'];
const norm = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
const dateIso = (value) => /^\d{4}-\d{2}-\d{2}/.test(String(value || '')) ? String(value).slice(0,10) : '';
const scheduleAliases=(row={})=>[row.id,row.sourceKey,row.legado_id,row.escala_id].filter((v)=>v!==null&&v!==undefined&&String(v)!=='').map(String);
const domainAliases=(row={})=>[row.schedule_record_id,row.schedule_id,row.escala_id,row.escala_id_legado,row.legado_id].filter((v)=>v!==null&&v!==undefined&&String(v)!=='').map(String);
const multiIndex=(rows=[])=>{const map=new Map();for(const row of rows){for(const key of domainAliases(row)){if(!map.has(key))map.set(key,row);}}return map;};
const linkedFor=(map,schedule)=>scheduleAliases(schedule).map((key)=>map.get(key)).find(Boolean)||null;
const addDays=(date,days)=>{const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+Number(days||0));return d.toISOString().slice(0,10);};
const minDate=(a,b)=>String(a||'')&&String(b||'')?(String(a)<String(b)?String(a):String(b)):(a||b||'');
const rowDate=(row)=>dateIso(row?.data||row?.dateKey||row?.date||'');
const genericRow=(row,module)=>({id:row.id,module,date:rowDate(row),status:row.status||'',data:{...row}});

const isThird = (row) => /TERCEIR/.test(norm(row?.raw?.VINCULO || row?.raw?.PROPRIEDADE || row?.raw?.FROTA || row?.vinculo));
const vehicleType = (row) => {
  const raw=norm(row?.raw?.TIPO || row?.raw?.TIPO_VEICULO || row?.tipo).replace('3X4','3/4');
  if (raw.includes('BITRUCK')) return 'BITRUCK';
  if (raw.includes('TRUCK')) return 'TRUCK';
  if (raw.includes('TOCO')) return 'TOCO';
  if (raw.includes('3/4') || raw.includes('34')) return '3/4';
  return raw || 'OUTRO';
};
const isNonDeparture = (schedule) => {
  const route=norm(schedule?.rota).replace(/[^A-Z0-9]+/g,' ');
  const hasLoad=Boolean(String(schedule?.ocs || '').trim());
  return !hasLoad || /\b(MANOBRA|VENEZA|MANUTENCAO|CAIXA|CAIXAS|ALMOXARIFADO|SERVICO ADM|SERVICO ADMINISTRATIVO)\b/.test(route);
};
function matrix(items=[]) {
  const output={ total:items.length, proprio:0, terceiro:0, types:{} };
  for (const type of TYPES) output.types[type]={total:0,proprio:0,terceiro:0};
  for (const item of items) {
    const third=isThird(item), type=vehicleType(item); output[third?'terceiro':'proprio']+=1;
    if (!output.types[type]) output.types[type]={total:0,proprio:0,terceiro:0};
    output.types[type].total+=1; output.types[type][third?'terceiro':'proprio']+=1;
  }
  return output;
}
export function buildFleetOverview(snapshot, finalizedVehicles=[]) {
  const vehicles=snapshot?.vehicles || [];
  const activeVehicles=vehicles.filter((item)=>item.active !== false);
  const inactiveVehicles=vehicles.filter((item)=>item.active === false);
  const maintenance=vehicles.filter((item)=>/MANUTEN/.test(norm(item.baseStatus || item.raw?.STATUS)));
  const scheduled=vehicles.filter((item)=>item.origin==='ESCALA' && item.status==='INDISPONÍVEL' && !maintenance.includes(item));
  // "Em rota" representa todo veículo com operação ainda aberta. PERNOITE é
  // exibido separadamente como subconjunto, assim como no Resumo da operação.
  const inRoute=vehicles.filter((item)=>['EM ROTA','PERNOITE'].includes(item.status));
  const overnight=vehicles.filter((item)=>item.status==='PERNOITE');
  const available=vehicles.filter((item)=>item.status==='DISPONÍVEL' && !maintenance.includes(item));
  return {
    inventory:matrix(activeVehicles), inactive:matrix(inactiveVehicles), scheduled:matrix(scheduled), inRoute:matrix(inRoute), overnight:matrix(overnight),
    maintenance:matrix(maintenance), available:matrix(available), finalized:matrix(finalizedVehicles),
  };
}

const dashboardCache=new Map();
const DASHBOARD_CACHE_MS=15000;
function getCache(key){const hit=dashboardCache.get(key);if(!hit||Date.now()-hit.at>DASHBOARD_CACHE_MS){if(hit)dashboardCache.delete(key);return null;}return hit.payload;}
function putCache(key,payload){dashboardCache.set(key,{at:Date.now(),payload});while(dashboardCache.size>12)dashboardCache.delete(dashboardCache.keys().next().value);}

export async function buildRouteDashboard(db,user,filters={}) {
  const today=new Date().toISOString().slice(0,10);
  const start=dateIso(filters.start || filters.date) || today;
  const end=dateIso(filters.end || filters.date) || start;
  const includeRecords=['1','TRUE','SIM','YES'].includes(norm(filters.includeRecords||filters.records));
  const bypassCache=['1','TRUE','SIM','YES'].includes(norm(filters.refresh||filters.fresh));
  const cacheKey=`${user?.id||0}|${start}|${end}|${includeRecords?'R':'S'}`;
  if(!bypassCache){const cached=getCache(cacheKey);if(cached)return cached;}

  // Uma única janela de leitura atende tanto o período solicitado quanto a
  // situação atual da Central de Recursos. Antes, o Dashboard lia os mesmos
  // módulos novamente dentro de buildResourceCenter, duplicando o custo no D1.
  const lookbackStart=minDate(start,addDays(end,-30));
  const [schedulePayload,departuresWide,monitoringsWide,returnsWide] = await Promise.all([
    listScheduleRecordsInternal(db,{start:lookbackStart,end}),
    listDomainRows(db,'departures',{start:lookbackStart,end,limit:5000}),
    listDomainRows(db,'monitoring',{start:lookbackStart,end,limit:5000}),
    listDomainRows(db,'returns',{start:lookbackStart,end,limit:5000}),
  ]);
  const [routeResult,employeeResult,vehicleResult,toleranceMinutes] = await Promise.all([
    db.prepare('SELECT * FROM BASE_ROTAS').all().catch(()=>({results:[]})),
    db.prepare('SELECT * FROM BASE_COLABORADORES').all().catch(()=>({results:[]})),
    db.prepare('SELECT * FROM BASE_VEICULOS').all().catch(()=>({results:[]})),
    departureToleranceMinutes(db),
  ]);

  const schedulesWide=schedulePayload.records||[];
  const inPeriod=(row)=>{const d=rowDate(row);return Boolean(d&&d>=start&&d<=end);};
  const schedules=schedulesWide.filter(inPeriod).filter((row)=>norm(row.status)!=='CANCELADO');
  const departures=departuresWide.filter(inPeriod);
  const monitorings=monitoringsWide.filter(inPeriod);
  const returns=returnsWide.filter(inPeriod);

  // Reaproveita os dados já carregados. Nesta chamada a Central só executa a
  // resolução de alocação e uma leitura curta de liberações manuais; não relê
  // todos os módulos nem os catálogos e também não busca o histórico de eventos.
  const snapshot=await buildResourceCenter(db,end,{
    skipEnsure:true,includeEvents:false,
    employeeRows:employeeResult.results||[],vehicleRows:vehicleResult.results||[],
    schedules:schedulesWide.map((row)=>genericRow(row,'schedule')),
    departures:departuresWide.map((row)=>genericRow(row,'departures')),
    monitorings:monitoringsWide.map((row)=>genericRow(row,'monitoring')),
    returns:returnsWide.map((row)=>genericRow(row,'returns')),
  });

  const operational=schedules.filter((row)=>!isNonDeparture(row));
  const depMatcher=buildDepartureMatcher(departures);
  const retMap=multiIndex(returns);
  const realized=operational.filter((row)=>departureRecordIsRealized(matchDepartureToSchedule(depMatcher,row)||{}));
  const pending=operational.filter((row)=>!departureRecordIsRealized(matchDepartureToSchedule(depMatcher,row)||{}));
  const delayed=realized.filter((row)=>{const d=matchDepartureToSchedule(depMatcher,row);return departureDelayMinutes(row,d||{})>toleranceMinutes;});
  const finalizedVehicles=[];
  for (const schedule of operational) if(linkedFor(retMap,schedule)) {
    const candidate=snapshot.vehicles.find((v)=>norm(v.resourceName)===norm(schedule.placa));
    finalizedVehicles.push(candidate || {raw:{TIPO:schedule.tipo_veiculo||'',VINCULO:schedule.vinculo||''},resourceName:schedule.placa});
  }
  const fleet=buildFleetOverview(snapshot,finalizedVehicles);
  // Pernoite na Visão Geral é um status operacional explícito do Monitoramento.
  // Não inferimos pernoite pela idade da rota/escala. Se já existe retorno real,
  // o veículo também deixa imediatamente esse indicador.
  const monitoringMap=multiIndex(monitoringsWide);
  const returnWideMap=multiIndex(returnsWide);
  const overnightVehicles=[]; const overnightPlates=new Set();
  for(const schedule of schedulesWide){
    const monitoring=linkedFor(monitoringMap,schedule);
    const returned=linkedFor(returnWideMap,schedule);
    if(norm(monitoring?.status_monitoramento||monitoring?.status)!=='PERNOITE')continue;
    if(returned?.retorno_real)continue;
    if(['CANCELADO','FINALIZADO','RETORNOU'].includes(norm(schedule.status)))continue;
    const plate=norm(monitoring?.placa||schedule.placa);
    if(!plate||overnightPlates.has(plate))continue;
    overnightPlates.add(plate);
    const candidate=snapshot.vehicles.find((vehicle)=>norm(vehicle.resourceName||vehicle.placa)===plate);
    overnightVehicles.push(candidate||{resourceName:monitoring?.placa||schedule.placa,raw:{TIPO:schedule.tipo_veiculo||'',VINCULO:schedule.vinculo||''}});
  }
  fleet.overnight=matrix(overnightVehicles);
  const executionRecords=buildExecutionRecordsFromData({
    schedules,departures,monitorings,returns,routes:routeResult.results||[],employees:employeeResult.results||[],
  },{start,end});
  const productivity=summarizeExecutionRecords(executionRecords);
  const now=Date.now();
  const activeMonitoring=monitoringsWide.filter((row)=>['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO'].includes(norm(row.status_monitoramento || row.status)));
  const journeyAlerts=activeMonitoring.filter((row)=>{const limit=Date.parse(String(row.limite_jornada||'').replace(' ','T'));return Number.isFinite(limit) && limit-now <= 60*60000;});
  const payload={
    versao:'1', period:{start,end}, toleranceMinutes, generatedAt:new Date().toISOString(),
    departures:{ programmed:schedules.length, operationalProgrammed:operational.length, internalOrExempt:schedules.length-operational.length, realized:realized.length, pending:pending.length, delayed:delayed.length },
    fleetStatus:{ scheduled:fleet.scheduled.total, inRoute:fleet.inRoute.total, overnight:fleet.overnight.total, available:fleet.available.total, maintenance:fleet.maintenance.total },
    people:{ driversAvailable:snapshot.summary?.motoristasDisponiveis||0, helpersAvailable:snapshot.summary?.ajudantesDisponiveis||0, returns:returns.length, journeyAlerts:journeyAlerts.length },
    productivity, fleetOverview:fleet,
    ...(includeRecords?{records:{ schedules,departures,monitorings,returns,indicators:executionRecords }}:{}),
  };
  putCache(cacheKey,payload);
  return payload;
}
