import { jsonResponse, requireUser } from '../_lib/auth.js';
import { autoConfirmDeparturesFromGps, departureDashboard, listDepartures, listDepartureControlRows, removeDeparture, saveDeparture } from '../_lib/departure.js';
import { ensureRoutePhase1Schema } from '../_lib/route-phase1.js';
import { assertRouteAccess } from '../_lib/route-access.js';
import { getDepartureAudit, getDepartureAuditPhoto, saveDepartureAudit } from '../_lib/departure-audit.js';
import { syncLincrosSchedulesFromDaySnapshot } from '../_lib/lincros.js';


async function syncPendingLincrosPositions(env,rows=[]){
  if(!String(env.LINCROS_API_KEY||'').trim())return {attempted:0,ok:0,failed:0,results:[],warnings:['LINCROS_API_KEY não configurada.']};
  const pending=(rows||[]).filter((row)=>String(row.status||row.status_saida||'').trim().toUpperCase()==='PENDENTE'&&String(row.schedule_record_id||'').trim()&&String(row.placa||'').trim()).map((row)=>({
    scheduleId:String(row.schedule_record_id||''),date:row.data||'',plate:row.placa||'',placa:row.placa||'',route:row.rota||'',rota:row.rota||'',ocs:row.ocs||row.carga||'',placa_original:row.placa_original||'',placa_lincros:row.placa_lincros||''
  }));
  if(!pending.length)return {attempted:0,ok:0,failed:0,results:[],warnings:[]};
  try{return {...await syncLincrosSchedulesFromDaySnapshot(env.DB,env,pending,{maxAgeMinutes:4}),warnings:[]};}
  catch(error){return {attempted:pending.length,ok:0,failed:pending.length,results:[],warnings:[error?.message||String(error)]};}
}
const readCache=new Map();const readInflight=new Map();const READ_CACHE_MS=20000;
function normalizePlate(value=''){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/gi,'').toUpperCase();}
function parseGpsRaw(value=''){try{const parsed=JSON.parse(String(value||'{}'));return parsed&&typeof parsed==='object'?parsed:{};}catch{return {};}}
async function reconcileDeparturesFromGpsCache(env,user){
  try{
    const table=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ROUTE_GPS_LATEST'").first();if(!table?.name)return {checked:0,confirmed:[],warnings:['Cache GPS ainda não inicializado.']};
    const {results=[]}=await env.DB.prepare(`SELECT PLATE,LATITUDE,LONGITUDE,GPS_TIME,LOCATION_TEXT,POINT_TEXT,SPEED,IGNITION,VEHICLE_ID,VEHICLE_TYPE,DISTANCE_TO_POINT,RAW_JSON FROM ROUTE_GPS_LATEST ORDER BY PLATE`).all();
    const positions=(results||[]).map((row)=>{const raw=parseGpsRaw(row.RAW_JSON);return {plate:normalizePlate(row.PLATE),latitude:row.LATITUDE,longitude:row.LONGITUDE,updatedAt:String(row.GPS_TIME||''),location:String(row.LOCATION_TEXT||''),point:String(row.POINT_TEXT||''),speed:Number(row.SPEED||0),ignition:Number(row.IGNITION||0),vehicleId:String(row.VEHICLE_ID||''),vehicleType:String(row.VEHICLE_TYPE||''),distanceToPoint:row.DISTANCE_TO_POINT,source:String(raw.__DMS_SOURCE||'PROTECTSAT'),timestampReliable:raw.__DMS_TIMESTAMP_RELIABLE!==false,timestampSource:String(raw.__DMS_TIMESTAMP_SOURCE||'D1_CACHE'),raw};});
    const warnings=[];const diagnostics=[];const confirmed=await autoConfirmDeparturesFromGps(env.DB,user,positions,{facilityName:String(env.DEPARTURE_GEOFENCE_NAME||''),facilityNames:String(env.DEPARTURE_GEOFENCE_NAMES||'NOTARO ALIMENTOS LTDA. - RECIFE/PE|NOTARO ALIMENTOS - RECIFE/PE').split('|'),facilityRadiusMeters:Number(env.DEPARTURE_GEOFENCE_RADIUS_METERS||120),maxGpsAgeMinutes:Number(env.DEPARTURE_GPS_MAX_AGE_MINUTES||90),transitionLookbackMinutes:Number(env.DEPARTURE_GPS_TRANSITION_LOOKBACK_MINUTES||2160),exitBufferMeters:Number(env.DEPARTURE_GPS_EXIT_BUFFER_METERS||40),earlyWindowMinutes:Number(env.DEPARTURE_GPS_EARLY_WINDOW_MINUTES||60),lateWindowMinutes:Number(env.DEPARTURE_GPS_LATE_WINDOW_MINUTES||1440),outsideConfirmations:Number(env.DEPARTURE_GPS_OUTSIDE_CONFIRMATIONS||2),warnings,diagnostics});
    if(confirmed.length)readCache.clear();return {checked:positions.length,confirmed,warnings,diagnostics};
  }catch(error){return {checked:0,confirmed:[],warnings:[error?.message||String(error)]};}
}

function readKey(user,url){return `${user?.id||user?.email||'route'}|${url.pathname}|${url.searchParams.toString()}`;}
async function cachedRead(key,producer){const now=Date.now(),hit=readCache.get(key);if(hit&&now-hit.at<=READ_CACHE_MS)return hit.value;if(readInflight.has(key))return readInflight.get(key);const promise=Promise.resolve().then(producer).then((value)=>{readCache.set(key,{at:Date.now(),value});while(readCache.size>24)readCache.delete(readCache.keys().next().value);return value;}).finally(()=>readInflight.delete(key));readInflight.set(key,promise);return promise;}

async function saveDepartureWithTransientRetry(db,user,payload,id=null){
  let lastError=null;
  for(let attempt=0;attempt<3;attempt+=1){
    try{return await saveDeparture(db,user,payload,id);}
    catch(error){
      lastError=error;
      if(String(error?.code||'')!=='RESOURCE_LOCKED'||attempt===2)throw error;
      await new Promise((resolve)=>setTimeout(resolve,500+(attempt*700)));
    }
  }
  throw lastError||new Error('Falha ao salvar saída.');
}

async function authContext(env,request,write=false){if(!env.DB)return {response:jsonResponse({erro:"Binding D1 'DB' não encontrado."},500)};const auth=await requireUser(env.DB,request);if(auth.response)return auth;assertRouteAccess(auth.user,'route.departures',write);if(write)await ensureRoutePhase1Schema(env.DB);return auth;}
export async function onRequestGet({env,request}){const auth=await authContext(env,request);if(auth.response)return auth.response;try{const url=new URL(request.url);const filters=Object.fromEntries(url.searchParams);const view=String(url.searchParams.get('view')||'').toLowerCase();if(view==='audit-photo')return getDepartureAuditPhoto(env,url.searchParams.get('id'));if(view==='audit'){const payload=await getDepartureAudit(env,{scheduleId:url.searchParams.get('scheduleId')||'',departureId:url.searchParams.get('departureId')||null,auditId:url.searchParams.get('auditId')||null});return jsonResponse({ok:true,versao:'1',...payload});}if(view==='dashboard'){const payload=await cachedRead(readKey(auth.user,url),()=>departureDashboard(env.DB,auth.user,filters));return jsonResponse(payload);}if(view==='control'){const reconcile=['1','TRUE','SIM','S'].includes(String(url.searchParams.get('reconcileGps')||'').trim().toUpperCase());let payload=reconcile?await listDepartureControlRows(env.DB,auth.user,filters):await cachedRead(readKey(auth.user,url),()=>listDepartureControlRows(env.DB,auth.user,filters));if(!reconcile)return jsonResponse({versao:'1',...payload,gpsReconcile:null,lincrosReconcile:null});const lincrosReconcile=await syncPendingLincrosPositions(env,payload.records||[]);const gpsReconcile=await reconcileDeparturesFromGpsCache(env,auth.user);readCache.clear();if((gpsReconcile.confirmed||[]).length)payload=await listDepartureControlRows(env.DB,auth.user,filters);return jsonResponse({versao:'1',...payload,gpsReconcile,lincrosReconcile});}const records=await listDepartures(env.DB,auth.user,filters);return jsonResponse({versao:'1',records,total:records.length});}catch(error){return jsonResponse({erro:error.message,codigo:error.code||'DEPARTURE_ERROR'},400);}}
export async function onRequestPost({env,request}){const auth=await authContext(env,request,true);if(auth.response)return auth.response;try{const payload=await request.json().catch(()=>({}));if(String(payload?.operation||'').trim().toUpperCase()==='SAVE_AUDIT'){const savedAudit=await saveDepartureAudit(env,auth.user,payload);readCache.clear();return jsonResponse({ok:true,versao:'1',...savedAudit},201);}const saved=await saveDepartureWithTransientRetry(env.DB,auth.user,payload,payload.id||null);readCache.clear();return jsonResponse({ok:true,versao:'1',...saved},201);}catch(error){return jsonResponse({erro:error.message,codigo:error.code||'DEPARTURE_ERROR'},400);}}
export async function onRequestPut(context){return onRequestPost(context);}
export async function onRequestDelete({env,request}){const auth=await authContext(env,request,true);if(auth.response)return auth.response;try{const payload=await request.json().catch(()=>({}));const record=await withOperationalGuard(env.DB,'departure-delete',payload.requestId,()=>removeDeparture(env.DB,auth.user,payload.id),operationalScopeFromPayload(payload,'departure-delete'));return jsonResponse({ok:true,versao:'1',record});}catch(error){return jsonResponse({erro:error.message,codigo:error.code||'DEPARTURE_ERROR'},400);}}
