import { ensureAuthSchema, getSessionUser, jsonResponse } from '../../_lib/auth.js';
import { ensurePerformanceIndexes } from '../../_lib/performance.js';

export async function onRequestGet({ env, request, waitUntil }) {
  if (!env.DB) return jsonResponse({ erro: "Binding D1 'DB' não encontrado." }, 500);
  try {
    await ensureAuthSchema(env.DB);
    const count = await env.DB.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN ACTIVE=1 THEN 1 ELSE 0 END) AS active FROM ROUTE_USERS').first();
    const user = await getSessionUser(env.DB, request);
    if(typeof waitUntil==='function')waitUntil(ensurePerformanceIndexes(env.DB).catch((error)=>console.warn('Index bootstrap warning',error?.message||error)));
    return jsonResponse({
      sistema:'NATTO DMS ROTA', versao:'1', versaoNome:'Versão 1 - DMS ROTA', requiresPassword:true,
      needsSetup:Number(count?.total || 0) === 0,
      totalUsers:Number(count?.total || 0), activeUsers:Number(count?.active || 0),
      user
    });
  } catch (error) {
    return jsonResponse({ erro:error.message || String(error) }, 500);
  }
}
