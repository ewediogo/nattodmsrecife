import { jsonResponse, requireUser } from '../_lib/auth.js';
import { assertRouteAccess } from '../_lib/route-access.js';
import { ensureCoreSchema } from '../_lib/core.js';
import { ensureRoutePhase1Schema } from '../_lib/route-phase1.js';
import { buildRouteDashboard } from '../_lib/route-dashboard.js';

export async function onRequestGet({env,request}) {
  if(!env.DB) return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request); if(auth.response)return auth.response;
  try {
    assertRouteAccess(auth.user,'route.dashboard');
    await Promise.all([ensureCoreSchema(env.DB),ensureRoutePhase1Schema(env.DB)]);
    const filters=Object.fromEntries(new URL(request.url).searchParams);
    return jsonResponse(await buildRouteDashboard(env.DB,auth.user,filters));
  } catch(error) {
    return jsonResponse({erro:error.message||String(error),codigo:error.code||'ROUTE_DASHBOARD_ERROR',versao:'1'},400);
  }
}
