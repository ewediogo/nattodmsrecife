import { jsonResponse, requireUser } from '../_lib/auth.js';
import { getManagementIndicators, getRouteManagementReport, saveDeliveryPointingJustification } from '../_lib/indicators.js';
import { ensureRoutePhase1Schema } from '../_lib/route-phase1.js';
import { assertRouteAccess } from '../_lib/route-access.js';

const indicatorCache=new Map();const indicatorInflight=new Map();const INDICATOR_CACHE_MS=30000;
function indicatorKey(user,url){return `${user?.id||user?.email||'route'}|${url.pathname}|${url.searchParams.toString()}`;}
async function cachedIndicator(key,producer){const now=Date.now(),hit=indicatorCache.get(key);if(hit&&now-hit.at<=INDICATOR_CACHE_MS)return hit.value;if(indicatorInflight.has(key))return indicatorInflight.get(key);const promise=Promise.resolve().then(producer).then((value)=>{indicatorCache.set(key,{at:Date.now(),value});while(indicatorCache.size>20)indicatorCache.delete(indicatorCache.keys().next().value);return value;}).finally(()=>indicatorInflight.delete(key));indicatorInflight.set(key,promise);return promise;}
export async function onRequestGet({env,request}){if(!env.DB)return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);const auth=await requireUser(env.DB,request);if(auth.response)return auth.response;try{const url=new URL(request.url);const view=url.searchParams.get('view')||'dashboard';assertRouteAccess(auth.user,view==='management'?'route.management':'route.indicators');await ensureRoutePhase1Schema(env.DB);const filters=Object.fromEntries(url.searchParams);const key=indicatorKey(auth.user,url);const payload=await cachedIndicator(key,()=>view==='management'||view==='records'?getRouteManagementReport(env.DB,auth.user,filters):getManagementIndicators(env.DB,auth.user,filters));if(view==='records')return jsonResponse({versao:'1',records:payload.records,total:payload.records.length,summary:payload.summary,period:payload.period});return jsonResponse(payload);}catch(error){return jsonResponse({erro:error.message,codigo:error.code||'INDICATOR_ERROR'},400);}}

export async function onRequestPost({env,request}){
  if(!env.DB)return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request);if(auth.response)return auth.response;
  try{
    assertRouteAccess(auth.user,'route.indicators',true);
    await ensureRoutePhase1Schema(env.DB);
    const payload=await request.json().catch(()=>({}));
    if(String(payload.action||'').trim().toUpperCase()!=='POINTING_JUSTIFICATION')throw new Error('Ação de indicadores inválida.');
    const result=await saveDeliveryPointingJustification(env.DB,auth.user,payload);
    indicatorCache.clear();
    return jsonResponse({ok:true,versao:'1',result});
  }catch(error){return jsonResponse({erro:error.message,codigo:error.code||'INDICATOR_JUSTIFICATION_ERROR'},400);}
}
