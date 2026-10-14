import { jsonResponse, requireUser } from '../_lib/auth.js';
import { assertRouteAccess } from '../_lib/route-access.js';

function clean(value,max=500){return String(value??'').trim().slice(0,max);}
function hostOf(value,fallback='') { try{return new URL(clean(value)||fallback).host;}catch{return 'inválida';} }
async function firstSafe(db,sql){try{return await db.prepare(sql).first()||{};}catch(error){return {__error:error?.message||String(error)};}}
async function allSafe(db,sql){try{return (await db.prepare(sql).all()).results||[];}catch(error){return [{__error:error?.message||String(error)}];}}

export async function onRequestGet({env,request}){
  if(!env.DB)return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request);if(auth.response)return auth.response;
  try{try{assertRouteAccess(auth.user,'route.monitoring');}catch{assertRouteAccess(auth.user,'route.location');}
    const gps=await firstSafe(env.DB,`SELECT COUNT(*) cacheCount,MAX(GPS_TIME) latestGpsTime,MAX(FETCHED_AT) latestFetchedAt FROM ROUTE_GPS_LATEST`);
    const gpsPositions=await firstSafe(env.DB,`SELECT COUNT(*) historyCount,MAX(GPS_TIME) latestHistoryGpsTime,MAX(FETCHED_AT) latestHistoryFetchedAt FROM ROUTE_GPS_POSITIONS`);
    const li=await firstSafe(env.DB,`SELECT COUNT(*) cacheCount,SUM(CASE WHEN COALESCE(DATA_HASH,'')<>'' AND COALESCE(LAST_ERROR,'')='' THEN 1 ELSE 0 END) healthyCount,SUM(CASE WHEN COALESCE(LAST_ERROR,'')<>'' THEN 1 ELSE 0 END) errorCount,MAX(CHECKED_AT) latestCheckedAt,MAX(SYNCED_AT) latestSyncedAt FROM LINCROS_ROUTE_SYNC`);
    const liErrors=await allSafe(env.DB,`SELECT PLATE,DATE_KEY,DMS_ROUTE,LAST_ERROR,CHECKED_AT FROM LINCROS_ROUTE_SYNC WHERE COALESCE(LAST_ERROR,'')<>'' ORDER BY CHECKED_AT DESC LIMIT 5`);
    const url=new URL(request.url);
    return jsonResponse({
      version:'1.0.103',generatedAt:new Date().toISOString(),runtime:{host:url.host,protocol:url.protocol,dbBound:Boolean(env.DB)},
      protectSat:{enabled:String(env.PROTECTSAT_ENABLED||'true').toLowerCase()!=='false',keyPresent:Boolean(clean(env.PROTECTSAT_CHAVE,2000)),baseHost:hostOf(env.PROTECTSAT_BASE_URL,'https://api.protectsat.com.br/wsprotect/protect.php'),functionName:clean(env.PROTECTSAT_FUNCAO||'grid_monitoramento',100),cache:gps,history:gpsPositions},
      lincros:{apiKeyPresent:Boolean(clean(env.LINCROS_API_KEY,2000)),requiredPagesProject:'nattodmsrecife',baseVarPresent:Boolean(clean(env.LINCROS_BASE_URL,1000)),baseHost:hostOf(env.LINCROS_BASE_URL,'https://notaro-tracking.lincros.com'),wsUserPresent:Boolean(clean(env.LINCROS_WS_USER,500)),wsPasswordPresent:Boolean(clean(env.LINCROS_WS_PASSWORD,500)),cache:li,recentErrors:liErrors}
    });
  }catch(error){return jsonResponse({erro:error?.message||String(error),codigo:error?.code||'INTEGRATION_DIAGNOSTIC_ERROR'},error?.status||400);}
}
