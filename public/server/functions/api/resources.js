import { jsonResponse, requireUser } from '../_lib/auth.js';
import { buildResourceCenter, createManualResourceRelease, ensureCoreSchema } from '../_lib/core.js';
import { assertRouteAccess } from '../_lib/route-access.js';
import { buildFleetOverview } from '../_lib/route-dashboard.js';
import { withOperationalGuard } from '../_lib/operation-guard.js';


const resourceCache=new Map();const RESOURCE_CACHE_MS=15000;
function resourceCacheGet(key){const hit=resourceCache.get(key);if(!hit||Date.now()-hit.at>RESOURCE_CACHE_MS){if(hit)resourceCache.delete(key);return null;}return hit.payload;}
function resourceCachePut(key,payload){resourceCache.set(key,{at:Date.now(),payload});while(resourceCache.size>8)resourceCache.delete(resourceCache.keys().next().value);}
function clearResourceCache(){resourceCache.clear();}

function enrich(snapshot) {
  // A Central precisa refletir a mesma frota operacional do Resumo. Não filtramos
  // terceiros aqui: qualquer veículo/pessoa em viagem aberta deve permanecer
  // ocupado até o retorno, independentemente do vínculo cadastral.
  return { ...snapshot, fleetOverview:buildFleetOverview(snapshot) };
}

export async function onRequestGet({ env, request }) {
  if (!env.DB) return jsonResponse({ erro:"Binding D1 'DB' não encontrado." },500);
  const auth = await requireUser(env.DB,request);
  if (auth.response) return auth.response;
  try {
    assertRouteAccess(auth.user,'route.resources');
    await ensureCoreSchema(env.DB);
    // A Central de Recursos é um retrato operacional global. Parâmetros de data
    // enviados por versões antigas do front-end são deliberadamente ignorados.
    const key=`${auth.user?.id||0}|GLOBAL`;
    const cached=resourceCacheGet(key);if(cached)return jsonResponse(cached);
    const snapshot = await buildResourceCenter(env.DB,'');const payload=enrich(snapshot);resourceCachePut(key,payload);
    return jsonResponse(payload);
  } catch (error) {
    return jsonResponse({ erro:error.message || String(error), codigo:error.code || 'RESOURCE_ERROR', versao:'1' },400);
  }
}

export async function onRequestPost({ env, request }) {
  if (!env.DB) return jsonResponse({ erro:"Binding D1 'DB' não encontrado." },500);
  const auth = await requireUser(env.DB,request);
  if (auth.response) return auth.response;
  try {
    // A mesma infraestrutura central agora também bloqueia escrita para perfil CONSULTA.
    assertRouteAccess(auth.user,'route.resources',true);
    await ensureCoreSchema(env.DB);
    const payload = await request.json().catch(() => ({}));
    const scope=`RESOURCE:${String(payload.resource_type || payload.resourceType || payload.tipo || '').trim()}:${String(payload.resource_id || payload.resourceId || payload.id || payload.resource_name || payload.resourceName || '').trim()}`;
    const guarded=await withOperationalGuard(env.DB,'resource-release',payload.requestId,async()=>({event:await createManualResourceRelease(env.DB,payload,auth.user)}),scope);clearResourceCache();
    // A interface já recarrega o painel após o sucesso. Reconstruí-lo aqui fazia
    // a gravação esperar várias leituras sem alterar o resultado persistido.
    return jsonResponse({ ok:true, versao:'1', event:guarded.event, replayed:Boolean(guarded.replayed) },201);
  } catch (error) {
    return jsonResponse({ erro:error.message || String(error), codigo:error.code || 'RESOURCE_ERROR', versao:'1' },400);
  }
}
