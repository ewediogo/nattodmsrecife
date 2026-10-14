import { saveMonitoring } from '../../../_lib/monitoring.js';
import { findDomainBySchedule } from '../../../_lib/route-phase1.js';
import { operationalScopeFromPayload, withOperationalGuard } from '../../../_lib/operation-guard.js';
import { APP_SERVICE_USER, appErrorResponse, appJson, nowRecifeIso, readAppJson, requireAppService, requireAppWriteEnabled, resolveAppSchedule } from '../../../_lib/app-integration.js';

const n=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
function upper(value){return String(value||'').trim().toUpperCase();}

export async function onRequestPost(context){
  try{
    await requireAppService(context.request,context.env);requireAppWriteEnabled(context.env);
    const body=await readAppJson(context.request);
    const schedule=await resolveAppSchedule(context.env.DB,body);
    const [current,departure]=await Promise.all([
      findDomainBySchedule(context.env.DB,'monitoring',schedule.id).catch(()=>null),
      findDomainBySchedule(context.env.DB,'departures',schedule.id).catch(()=>null),
    ]);
    const counters=body.counters&&typeof body.counters==='object'?body.counters:{};
    const breakInfo=body.break&&typeof body.break==='object'?body.break:{};
    const planned=Math.max(0,Math.round(n(counters.totalProgrammed,n(current?.entregas_previstas,n(schedule.qtd_entregas,0)))));
    const attended=Math.max(0,Math.min(planned,Math.round(n(counters.finalizedAttendances,n(current?.entregas_realizadas,0)))));
    let status=upper(body.status||current?.status||current?.status_monitoramento||(departure?.hora_real?'EM ROTA':'PENDENTE DE SAÍDA'));
    const breakType=upper(breakInfo.type||breakInfo.breakType);
    const breakStatus=upper(breakInfo.status);
    if(breakType==='DESCANSO_11H'&&['EM_ANDAMENTO','STARTED','ATIVO'].includes(breakStatus))status='PERNOITE';
    if(body.eventType==='ROUTE_RESUME'&&status==='PERNOITE')status='EM ROTA';
    const eventAt=body.eventAt||body.event_at||nowRecifeIso();
    const payload={
      ...schedule,...current,
      schedule_record_id:String(schedule.id),escala_id:String(schedule.sourceKey||schedule.id),departure_id:departure?.id||current?.departure_id||null,
      status,status_monitoramento:status,entregas_previstas:planned,entregas_realizadas:attended,
      placa:schedule.placa,motorista:schedule.motorista,rota:schedule.rota,regiao:schedule.regiao,
      ...(status==='PERNOITE'?{justificativa_pernoite:String(body.justification||breakInfo.justification||'Descanso de 11h registrado pelo motorista no NATTO Entregas.'),autorizado_por:'APP NATTO ENTREGAS'}:{}),
      app_ultimo_evento:String(body.lastEvent||body.eventType||'Atualização do NATTO Entregas'),app_ultimo_evento_em:eventAt,
      app_event_key:String(body.eventKey||body.event_key||body.requestId||''),app_session_id:String(body.sessionId||body.session_id||''),
      app_paradas_programadas:Math.max(0,Math.round(n(counters.totalProgrammed,planned))),
      app_atendimentos_finalizados:Math.max(0,Math.round(n(counters.finalizedAttendances,attended))),
      app_entregas_sucesso:Math.max(0,Math.round(n(counters.successfulDeliveries,0))),
      app_devolucoes_parciais:Math.max(0,Math.round(n(counters.partialReturns,0))),
      app_devolucoes_totais:Math.max(0,Math.round(n(counters.totalReturns,0))),
      app_nao_entregues:Math.max(0,Math.round(n(counters.notDelivered,0))),
      app_paradas_pendentes:Math.max(0,Math.round(n(counters.pending,Math.max(0,planned-attended)))),
      app_parada_atual:body.currentStop||null,app_intervalo:body.break||null,
    };
    delete payload.version;
    const requestId=String(body.requestId||body.request_id||context.request.headers.get('Idempotency-Key')||context.request.headers.get('X-Request-Id')||crypto.randomUUID()).slice(0,120);
    const scope=operationalScopeFromPayload(payload,`APP:${schedule.id}`);
    const result=await withOperationalGuard(context.env.DB,'app-monitoring',requestId,()=>saveMonitoring(context.env.DB,APP_SERVICE_USER,payload,current?.id||null),scope);
    return appJson({ok:true,...result});
  }catch(error){return appErrorResponse(error);}
}
