import { jsonResponse, requireUser } from '../_lib/auth.js';
import { deleteOperationalPendingRecord, getOperationalPendingAudit, justifyOperationalOccurrence } from '../_lib/operational-pending.js';
import { assertRouteAccess } from '../_lib/route-access.js';
import { withOperationalGuard } from '../_lib/operation-guard.js';
const pendingCache=new Map();const PENDING_CACHE_MS=15000;function pendingGet(k){const h=pendingCache.get(k);if(!h||Date.now()-h.at>PENDING_CACHE_MS){if(h)pendingCache.delete(k);return null;}return h.payload;}function pendingPut(k,p){pendingCache.set(k,{at:Date.now(),payload:p});while(pendingCache.size>8)pendingCache.delete(pendingCache.keys().next().value);}function pendingClear(){pendingCache.clear();}

async function context(env, request, write = false) {
  if (!env.DB) return { response: jsonResponse({ erro: "Binding D1 'DB' não encontrado." }, 500) };
  const auth = await requireUser(env.DB, request);
  if (auth.response) return auth;
  assertRouteAccess(auth.user, 'route.pending', write);
  return auth;
}

export async function onRequestGet({ env, request }) {
  const auth = await context(env, request);
  if (auth.response) return auth.response;
  try {
    const filters=Object.fromEntries(new URL(request.url).searchParams);const key=`${auth.user?.id||0}|${JSON.stringify(filters)}`;const cached=pendingGet(key);if(cached)return jsonResponse(cached);
    const result = await getOperationalPendingAudit(env.DB, auth.user, filters);const payload={ ...result, total: result.records.length };pendingPut(key,payload);
    return jsonResponse(payload);
  } catch (error) {
    return jsonResponse({ erro: error.message, codigo: error.code || 'PENDING_ERROR' }, 400);
  }
}


export async function onRequestPost({ env, request }) {
  const auth = await context(env, request, true);
  if (auth.response) return auth.response;
  try {
    const payload = await request.json().catch(() => ({}));
    const key=String(payload.key||payload.id||'').slice(0,180);
    const result = await withOperationalGuard(env.DB,'pending-justify',payload.requestId,()=>justifyOperationalOccurrence(env.DB,auth.user,payload),`PENDING:${key}`);pendingClear();
    return jsonResponse({ ok:true, versao:'1', result });
  } catch (error) {
    return jsonResponse({ erro:error.message, codigo:error.code || 'PENDING_JUSTIFY_ERROR' }, 400);
  }
}

export async function onRequestDelete({ env, request }) {
  const auth = await context(env, request, true);
  if (auth.response) return auth.response;
  try {
    const payload = await request.json().catch(() => ({}));
    pendingClear();const removed = await deleteOperationalPendingRecord(env.DB, auth.user, payload, env.EVIDENCE_BUCKET || env.POINT_EVIDENCE || null);
    return jsonResponse({ ok: true, versao: '1', removed });
  } catch (error) {
    return jsonResponse({ erro: error.message, codigo: error.code || 'PENDING_DELETE_ERROR' }, 400);
  }
}
