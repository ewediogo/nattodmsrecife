import { clean, dateIso, ensureRoutePhase1Schema, userName } from './route-phase1.js';

const MAX_AUDIT_PHOTOS=5;
const MAX_AUDIT_PHOTO_BYTES=700*1024;
const ALLOWED_MIME=new Set(['image/jpeg','image/png','image/webp']);

function parseJson(value,fallback=null){try{const parsed=JSON.parse(String(value??''));return parsed??fallback;}catch{return fallback;}}
function normalizeStatus(value=''){const status=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,'_');return status==='NAO_CONFORME'?'NAO_CONFORME':status==='CONFORME'?'CONFORME':status==='N/A'||status==='NA'?'NA':'';}
function safeBase64(value=''){return String(value||'').replace(/^data:[^;]+;base64,/i,'').replace(/\s+/g,'');}
function base64ByteLength(value=''){const cleanValue=safeBase64(value);if(!cleanValue)return 0;const padding=cleanValue.endsWith('==')?2:cleanValue.endsWith('=')?1:0;return Math.max(0,Math.floor(cleanValue.length*3/4)-padding);}
function bytesFromBase64(value=''){const raw=safeBase64(value);const binary=atob(raw);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);return bytes;}
function auditResult(checklist=[]){return checklist.some((item)=>item.status==='NAO_CONFORME')?'NAO_CONFORME':'CONFORME';}
function objectKey(auditId,fileName='evidencia.jpg'){const ext=(String(fileName||'').toLowerCase().match(/\.(jpe?g|png|webp)$/)?.[1]||'jpg').replace('jpeg','jpg');return `departure-audits/${auditId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;}

export async function listDepartureAuditSummaries(db,date){
  await ensureRoutePhase1Schema(db);
  const dateKey=dateIso(date)||dateIso(new Date().toISOString());
  const {results=[]}=await db.prepare(`SELECT a.ID,a.SCHEDULE_ID,a.DEPARTURE_ID,a.DATE_KEY,a.PLATE,a.RESULT,a.AUDITOR_NAME,a.AUDITED_AT,a.NOTES,COUNT(p.ID) AS PHOTO_COUNT FROM ROUTE_DEPARTURE_AUDITS a LEFT JOIN ROUTE_DEPARTURE_AUDIT_PHOTOS p ON p.AUDIT_ID=a.ID WHERE a.DATE_KEY=? GROUP BY a.ID ORDER BY a.AUDITED_AT DESC`).bind(dateKey).all();
  const bySchedule=new Map(),byDeparture=new Map();
  for(const row of results||[]){
    const summary={id:Number(row.ID||0),scheduleId:String(row.SCHEDULE_ID||''),departureId:Number(row.DEPARTURE_ID||0)||null,date:String(row.DATE_KEY||''),plate:String(row.PLATE||''),result:String(row.RESULT||''),auditorName:String(row.AUDITOR_NAME||''),auditedAt:String(row.AUDITED_AT||''),notes:String(row.NOTES||''),photoCount:Number(row.PHOTO_COUNT||0)};
    if(summary.scheduleId&&!bySchedule.has(summary.scheduleId))bySchedule.set(summary.scheduleId,summary);
    if(summary.departureId&&!byDeparture.has(String(summary.departureId)))byDeparture.set(String(summary.departureId),summary);
  }
  return {bySchedule,byDeparture};
}

async function auditRow(db,{scheduleId='',departureId=null,auditId=null}={}){
  await ensureRoutePhase1Schema(db);
  if(auditId)return db.prepare(`SELECT * FROM ROUTE_DEPARTURE_AUDITS WHERE ID=?`).bind(Number(auditId)).first();
  const sid=clean(scheduleId,120);if(sid){const row=await db.prepare(`SELECT * FROM ROUTE_DEPARTURE_AUDITS WHERE SCHEDULE_ID=? ORDER BY ID DESC LIMIT 1`).bind(sid).first();if(row)return row;}
  if(departureId)return db.prepare(`SELECT * FROM ROUTE_DEPARTURE_AUDITS WHERE DEPARTURE_ID=? ORDER BY ID DESC LIMIT 1`).bind(Number(departureId)).first();
  return null;
}

function auditRecord(row){
  if(!row)return null;
  return {id:Number(row.ID||0),scheduleId:String(row.SCHEDULE_ID||''),departureId:Number(row.DEPARTURE_ID||0)||null,date:String(row.DATE_KEY||''),plate:String(row.PLATE||''),route:String(row.ROUTE||''),result:String(row.RESULT||''),checklist:parseJson(row.CHECKLIST_JSON,[])||[],notes:String(row.NOTES||''),auditorId:Number(row.AUDITOR_ID||0)||null,auditorName:String(row.AUDITOR_NAME||''),auditedAt:String(row.AUDITED_AT||''),createdAt:String(row.CREATED_AT||''),updatedAt:String(row.UPDATED_AT||'')};
}

export async function getDepartureAudit(env,{scheduleId='',departureId=null,auditId=null}={}){
  const row=await auditRow(env.DB,{scheduleId,departureId,auditId});
  if(!row)return {audit:null,photos:[]};
  const {results=[]}=await env.DB.prepare(`SELECT ID,FILE_NAME,MIME_TYPE,SIZE_BYTES,CAPTION,STORAGE_KIND,CREATED_AT FROM ROUTE_DEPARTURE_AUDIT_PHOTOS WHERE AUDIT_ID=? ORDER BY ID`).bind(Number(row.ID)).all();
  const photos=(results||[]).map((photo)=>({id:Number(photo.ID),fileName:String(photo.FILE_NAME||''),mimeType:String(photo.MIME_TYPE||'image/jpeg'),sizeBytes:Number(photo.SIZE_BYTES||0),caption:String(photo.CAPTION||''),storageKind:String(photo.STORAGE_KIND||'D1'),createdAt:String(photo.CREATED_AT||''),url:`/api/departures?view=audit-photo&id=${Number(photo.ID)}`}));
  return {audit:auditRecord(row),photos};
}

async function removePhotoStorage(env,row){
  if(String(row?.STORAGE_KIND||'').toUpperCase()==='R2'&&row?.OBJECT_KEY&&env.AUDIT_PHOTOS?.delete){try{await env.AUDIT_PHOTOS.delete(String(row.OBJECT_KEY));}catch(error){console.warn('Falha ao remover evidência R2',error);}}
}

export async function saveDepartureAudit(env,user,payload={}){
  await ensureRoutePhase1Schema(env.DB);
  const source=payload?.audit&&typeof payload.audit==='object'?payload.audit:payload;
  const scheduleId=clean(source.scheduleId||source.schedule_id||source.schedule_record_id||source.escala_id,120);
  if(!scheduleId)throw new Error('Escala da auditoria não identificada.');
  const date=dateIso(source.date||source.data)||dateIso(new Date().toISOString());
  const plate=clean(source.plate||source.placa,30).toUpperCase();
  const route=clean(source.route||source.rota,240);
  const checklistRaw=Array.isArray(source.checklist)?source.checklist:[];
  if(!checklistRaw.length)throw new Error('Preencha o checklist da auditoria.');
  const checklist=checklistRaw.slice(0,30).map((item,index)=>({id:clean(item?.id||`ITEM_${index+1}`,80),label:clean(item?.label||`Item ${index+1}`,240),status:normalizeStatus(item?.status)}));
  const missing=checklist.filter((item)=>!item.status);if(missing.length)throw new Error(`Informe o resultado de todos os itens do checklist (${missing.length} pendente(s)).`);
  const result=auditResult(checklist),notes=clean(source.notes||source.observacoes,3000),auditorId=Number(user?.id||0)||null,auditorName=clean(userName(user),180)||'Usuário DMS',auditedAt=new Date().toISOString();
  const departureId=Number(source.departureId||source.departure_id||0)||null;
  const existing=await auditRow(env.DB,{scheduleId,departureId});
  let auditId=Number(existing?.ID||0);
  if(auditId){
    await env.DB.prepare(`UPDATE ROUTE_DEPARTURE_AUDITS SET DEPARTURE_ID=?,DATE_KEY=?,PLATE=?,ROUTE=?,RESULT=?,CHECKLIST_JSON=?,NOTES=?,AUDITOR_ID=?,AUDITOR_NAME=?,AUDITED_AT=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=?`).bind(departureId,date,plate,route,result,JSON.stringify(checklist),notes,auditorId,auditorName,auditedAt,auditId).run();
  }else{
    const inserted=await env.DB.prepare(`INSERT INTO ROUTE_DEPARTURE_AUDITS(SCHEDULE_ID,DEPARTURE_ID,DATE_KEY,PLATE,ROUTE,RESULT,CHECKLIST_JSON,NOTES,AUDITOR_ID,AUDITOR_NAME,AUDITED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(scheduleId,departureId,date,plate,route,result,JSON.stringify(checklist),notes,auditorId,auditorName,auditedAt).run();
    auditId=Number(inserted.meta?.last_row_id||0);if(!auditId)throw new Error('Não foi possível gravar a auditoria.');
  }

  const keepIds=new Set((Array.isArray(payload.keepPhotoIds)?payload.keepPhotoIds:[]).map((value)=>Number(value)).filter(Boolean));
  const {results:existingPhotos=[]}=await env.DB.prepare(`SELECT * FROM ROUTE_DEPARTURE_AUDIT_PHOTOS WHERE AUDIT_ID=? ORDER BY ID`).bind(auditId).all();
  for(const photo of existingPhotos||[]){if(!keepIds.has(Number(photo.ID))){await removePhotoStorage(env,photo);await env.DB.prepare(`DELETE FROM ROUTE_DEPARTURE_AUDIT_PHOTOS WHERE ID=? AND AUDIT_ID=?`).bind(Number(photo.ID),auditId).run();}}
  const keptCount=(existingPhotos||[]).filter((photo)=>keepIds.has(Number(photo.ID))).length;
  const incoming=Array.isArray(payload.photos)?payload.photos:[];
  if(keptCount+incoming.length>MAX_AUDIT_PHOTOS)throw new Error(`A auditoria permite no máximo ${MAX_AUDIT_PHOTOS} fotos.`);
  for(const photo of incoming){
    const mime=clean(photo?.mimeType||photo?.type||'',80).toLowerCase();if(!ALLOWED_MIME.has(mime))throw new Error('Formato de foto não suportado. Use JPG, PNG ou WEBP.');
    const base64=safeBase64(photo?.data||photo?.base64||'');const size=base64ByteLength(base64);if(!base64||!size)throw new Error('Uma das fotos está vazia.');if(size>MAX_AUDIT_PHOTO_BYTES)throw new Error('Uma das fotos ficou acima do limite após compactação. Tente outra imagem.');
    const fileName=clean(photo?.fileName||photo?.name||'evidencia.jpg',180),caption=clean(photo?.caption||'',500);
    let storageKind='D1',objectKeyValue='',dataBase64=base64;
    if(env.AUDIT_PHOTOS?.put){objectKeyValue=objectKey(auditId,fileName);await env.AUDIT_PHOTOS.put(objectKeyValue,bytesFromBase64(base64),{httpMetadata:{contentType:mime}});storageKind='R2';dataBase64='';}
    await env.DB.prepare(`INSERT INTO ROUTE_DEPARTURE_AUDIT_PHOTOS(AUDIT_ID,FILE_NAME,MIME_TYPE,SIZE_BYTES,CAPTION,STORAGE_KIND,OBJECT_KEY,DATA_BASE64,CREATED_BY) VALUES(?,?,?,?,?,?,?,?,?)`).bind(auditId,fileName,mime,size,caption,storageKind,objectKeyValue,dataBase64,auditorId).run();
  }
  return getDepartureAudit(env,{auditId});
}

export async function getDepartureAuditPhoto(env,id){
  await ensureRoutePhase1Schema(env.DB);
  const row=await env.DB.prepare(`SELECT * FROM ROUTE_DEPARTURE_AUDIT_PHOTOS WHERE ID=?`).bind(Number(id)).first();
  if(!row)return new Response('Evidência não encontrada.',{status:404});
  const mime=String(row.MIME_TYPE||'image/jpeg');
  if(String(row.STORAGE_KIND||'').toUpperCase()==='R2'&&row.OBJECT_KEY&&env.AUDIT_PHOTOS?.get){const object=await env.AUDIT_PHOTOS.get(String(row.OBJECT_KEY));if(object)return new Response(object.body,{headers:{'content-type':object.httpMetadata?.contentType||mime,'cache-control':'private, max-age=300'}});}
  if(!row.DATA_BASE64)return new Response('Evidência indisponível.',{status:404});
  return new Response(bytesFromBase64(String(row.DATA_BASE64)),{headers:{'content-type':mime,'cache-control':'private, max-age=300'}});
}
