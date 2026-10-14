import { APP_SERVICE_USER, appErrorResponse, appJson, nowRecifeIso, readAppJson, requireAppService, requireAppWriteEnabled, resolveAppSchedule } from '../../../_lib/app-integration.js';
import { audit } from '../../../_lib/core.js';
import { operationalScopeFromPayload, withOperationalGuard } from '../../../_lib/operation-guard.js';

const ALLOWED=new Set(['INICIO','REFEICAO_INICIO','REFEICAO_FIM','FIM','PONTO']);
async function ensureSchema(db){
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_TIME_CLOCK (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      EVENT_KEY TEXT NOT NULL UNIQUE,
      SCHEDULE_ID TEXT NOT NULL,
      ROUTE_KEY TEXT,
      PLATE TEXT NOT NULL,
      EMPLOYEE_REGISTRATION TEXT,
      DRIVER_NAME TEXT,
      RECORD_TYPE TEXT NOT NULL,
      RECORDED_AT TEXT NOT NULL,
      APP_PHOTO_ID TEXT,
      APP_SESSION_ID TEXT,
      DETAILS_JSON TEXT NOT NULL DEFAULT '{}',
      CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_TIME_CLOCK_SCHEDULE ON ROUTE_TIME_CLOCK(SCHEDULE_ID,RECORDED_AT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_TIME_CLOCK_DRIVER ON ROUTE_TIME_CLOCK(EMPLOYEE_REGISTRATION,RECORDED_AT)`),
  ]);
}
export async function onRequestPost(context){
  try{
    await requireAppService(context.request,context.env);requireAppWriteEnabled(context.env);
    const body=await readAppJson(context.request);const schedule=await resolveAppSchedule(context.env.DB,body);await ensureSchema(context.env.DB);
    const type=String(body.recordType||body.record_type||body.type||'PONTO').trim().toUpperCase();
    if(!ALLOWED.has(type)){const e=new Error('Tipo de ponto inválido.');e.code='INVALID_TIME_CLOCK_TYPE';e.status=400;throw e;}
    const eventKey=String(body.eventKey||body.event_key||body.requestId||crypto.randomUUID()).slice(0,160);
    const recordedAt=String(body.recordedAt||body.recorded_at||body.occurredAt||nowRecifeIso());
    const requestId=String(body.requestId||body.request_id||eventKey).slice(0,120);
    const op={schedule_record_id:String(schedule.id),placa:schedule.placa,data:schedule.data};
    const scope=operationalScopeFromPayload(op,`APP:${schedule.id}`);
    const result=await withOperationalGuard(context.env.DB,'app-time-clock',requestId,async()=>{
      const prior=await context.env.DB.prepare(`SELECT * FROM ROUTE_TIME_CLOCK WHERE EVENT_KEY=?`).bind(eventKey).first();
      if(prior)return {record:prior,alreadyConfirmed:true};
      const details={source:'NATTO_ENTREGAS',latitude:body.latitude??null,longitude:body.longitude??null,note:body.note||'',offline:Boolean(body.offline),deviceTimestamp:body.deviceTimestamp||body.device_timestamp||''};
      const insert=await context.env.DB.prepare(`INSERT INTO ROUTE_TIME_CLOCK(EVENT_KEY,SCHEDULE_ID,ROUTE_KEY,PLATE,EMPLOYEE_REGISTRATION,DRIVER_NAME,RECORD_TYPE,RECORDED_AT,APP_PHOTO_ID,APP_SESSION_ID,DETAILS_JSON) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(eventKey,String(schedule.id),String(body.routeId||body.route_id||''),String(schedule.placa||'').toUpperCase(),String(body.employeeRegistration||body.employee_registration||schedule.motorista_id||''),String(schedule.motorista||''),type,recordedAt,String(body.photoId||body.photo_id||''),String(body.sessionId||body.session_id||''),JSON.stringify(details)).run();
      const row=await context.env.DB.prepare(`SELECT * FROM ROUTE_TIME_CLOCK WHERE ID=?`).bind(Number(insert.meta?.last_row_id||0)).first();
      await audit(context.env.DB,APP_SERVICE_USER,'APP_TIME_CLOCK','ROUTE_TIME_CLOCK',Number(row?.ID||0),{eventKey,type,scheduleId:String(schedule.id)}).catch(()=>{});
      return {record:row};
    },scope);
    return appJson({ok:true,...result});
  }catch(error){return appErrorResponse(error);}
}
