import { saveDeparture } from '../../../_lib/departure.js';
import { findDomainBySchedule } from '../../../_lib/route-phase1.js';
import { operationalScopeFromPayload, withOperationalGuard } from '../../../_lib/operation-guard.js';
import { APP_SERVICE_USER, appErrorResponse, appJson, nowRecifeIso, readAppJson, requireAppService, requireAppWriteEnabled, resolveAppSchedule } from '../../../_lib/app-integration.js';

function timeFrom(value=''){
  const raw=String(value||'').trim();
  const match=raw.match(/(?:T|\s)(\d{2}):(\d{2})/)||raw.match(/^(\d{1,2}):(\d{2})/);
  return match?`${String(match[1]).padStart(2,'0')}:${match[2]}`:'';
}

export async function onRequestPost(context){
  try{
    await requireAppService(context.request,context.env);requireAppWriteEnabled(context.env);
    const body=await readAppJson(context.request);
    const schedule=await resolveAppSchedule(context.env.DB,body);
    const existing=await findDomainBySchedule(context.env.DB,'departures',schedule.id).catch(()=>null);
    if(existing && String(existing.status||existing.status_saida||'').toUpperCase()==='SAIU' && (existing.hora_real||existing.actualAt||existing.actual_at)){
      return appJson({ok:true,record:existing,alreadyConfirmed:true});
    }
    const occurredAt=body.occurredAt||body.occurred_at||nowRecifeIso();
    const payload={
      ...schedule,
      schedule_record_id:String(schedule.id),escala_id:String(schedule.sourceKey||schedule.id),
      status:'SAIU',status_saida:'SAIU',hora_real:timeFrom(occurredAt)||timeFrom(body.hora_real)||'',
      placa:schedule.placa,motorista_id:schedule.motorista_id,motorista:schedule.motorista,
      ajudante_1_id:schedule.ajudante_1_id,ajudante_1:schedule.ajudante_1,ajudante_2_id:schedule.ajudante_2_id,ajudante_2:schedule.ajudante_2,
      motivo_atraso:'SAIDA AUTOMATICA APP',responsavel_atraso:'NATTO ENTREGAS',detalhe_motivo:'Saída confirmada pelo motorista no aplicativo NATTO Entregas.',
      origem_saida:'APP_ENTREGAS',origem:'APP_ENTREGAS',automatico:true,app_event_key:String(body.eventKey||body.event_key||body.requestId||''),app_session_id:String(body.sessionId||body.session_id||''),
      app_confirmed_at:occurredAt,
    };
    const requestId=String(body.requestId||body.request_id||context.request.headers.get('Idempotency-Key')||context.request.headers.get('X-Request-Id')||crypto.randomUUID()).slice(0,120);
    const scope=`APP_DEPARTURE:${operationalScopeFromPayload(payload,`APP:${schedule.id}`)}`;
    const result=await withOperationalGuard(context.env.DB,'app-departure',requestId,()=>saveDeparture(context.env.DB,APP_SERVICE_USER,payload,existing?.id||null),scope);
    return appJson({ok:true,...result});
  }catch(error){return appErrorResponse(error);}
}
