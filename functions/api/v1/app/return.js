import { finalizeReturnDerivedState, saveReturn } from '../../../_lib/return.js';
import { findDomainBySchedule } from '../../../_lib/route-phase1.js';
import { operationalScopeFromPayload, withOperationalGuard } from '../../../_lib/operation-guard.js';
import { APP_SERVICE_USER, appErrorResponse, appJson, nowRecifeIso, readAppJson, requireAppService, requireAppWriteEnabled, resolveAppSchedule } from '../../../_lib/app-integration.js';

const n=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;

export async function onRequestPost(context){
  try{
    await requireAppService(context.request,context.env);requireAppWriteEnabled(context.env);
    const body=await readAppJson(context.request);
    const schedule=await resolveAppSchedule(context.env.DB,body);
    const existing=await findDomainBySchedule(context.env.DB,'returns',schedule.id).catch(()=>null);
    if(existing?.retorno_real||existing?.return_at)return appJson({ok:true,record:existing,alreadyConfirmed:true});
    const counters=body.counters&&typeof body.counters==='object'?body.counters:{};
    const successful=Math.max(0,Math.round(n(counters.successfulDeliveries,0)));
    const partial=Math.max(0,Math.round(n(counters.partialReturns,0)));
    const totalReturns=Math.max(0,Math.round(n(counters.totalReturns,0)));
    const notDelivered=Math.max(0,Math.round(n(counters.notDelivered,0)));
    const finalized=Math.max(0,Math.round(n(counters.finalizedAttendances,successful+partial+totalReturns+notDelivered)));
    const occurredAt=body.occurredAt||body.occurred_at||nowRecifeIso();
    const payload={
      ...schedule,schedule_record_id:String(schedule.id),escala_id:String(schedule.sourceKey||schedule.id),
      retorno_real:occurredAt,return_at:occurredAt,origem:'APP',status:'FINALIZADO',
      entregas:successful+partial,entregas_realizadas:successful+partial,
      houve_devolucao:(partial+totalReturns+notDelivered)>0,voltou_com_devolucao:(partial+totalReturns+notDelivered)>0,
      devolucoes:partial+totalReturns+notDelivered,qtd_devolucoes:partial+totalReturns+notDelivered,
      houve_apoio:Boolean(n(body.supportCount,0)>0),apoios:Math.max(0,Math.round(n(body.supportCount,0))),
      placa:schedule.placa,motorista:schedule.motorista,rota:schedule.rota,
      app_event_key:String(body.eventKey||body.event_key||body.requestId||''),app_session_id:String(body.sessionId||body.session_id||''),
      app_atendimentos_finalizados:finalized,app_entregas_sucesso:successful,app_devolucoes_parciais:partial,app_devolucoes_totais:totalReturns,app_nao_entregues:notDelivered,
      app_finalizado_em:occurredAt,
    };
    const requestId=String(body.requestId||body.request_id||context.request.headers.get('Idempotency-Key')||context.request.headers.get('X-Request-Id')||crypto.randomUUID()).slice(0,120);
    const scope=operationalScopeFromPayload(payload,`APP:${schedule.id}`);
    const result=await withOperationalGuard(context.env.DB,'app-return',requestId,()=>saveReturn(context.env.DB,APP_SERVICE_USER,payload,null),scope);
    if(result?.record&&!result?.skipDerivedState){
      const task=finalizeReturnDerivedState(context.env.DB,APP_SERVICE_USER,result.record).catch((error)=>console.error('APP return derived-state warning',error));
      if(context.waitUntil)context.waitUntil(task);else await task;
    }
    return appJson({ok:true,...result});
  }catch(error){return appErrorResponse(error);}
}
