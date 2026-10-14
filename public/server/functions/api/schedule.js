import { jsonResponse, requireUser } from '../_lib/auth.js';
import { assertRouteAccess } from '../_lib/route-access.js';
import { operationalScopeFromPayload, withOperationalGuard } from '../_lib/operation-guard.js';
import {
  adminCorrectScheduleResources, cancelSchedule, confirmScheduleImport, deleteSchedule, getScheduleEditor, listScheduleRecords,
  previewScheduleImport, autoPreScale, saveSchedule, saveScheduleBatch,
} from '../_lib/schedule.js';

async function payload(request) { try { return await request.json(); } catch { return {}; } }
function errorResponse(error) {
  const status = ['INTERJOURNEY_BLOCK','RESOURCE_SCHEDULE_CONFLICT','VEHICLE_SCHEDULE_CONFLICT','OPEN_MONITORING','EMPLOYEE_RESERVED','SCHEDULE_LOCKED','RESOURCE_LOCKED','DRIVER_RESTRICTION_CLOSED_LOAD_ONLY','HELPER_RESTRICTION_NETWORK_ONLY','ROUTE_HELPER_ROUTE_MISMATCH','THIRD_PARTY_DRIVER_VEHICLE_MISMATCH','EMPLOYEE_OVERNIGHT_UNAVAILABLE'].includes(error?.code) ? 422 : 400;
  return jsonResponse({ erro:error?.message || String(error), codigo:error?.code || 'SCHEDULE_ERROR', detalhes:error?.details || null, versao:'1' },status);
}

export async function onRequestGet({ env,request }) {
  if (!env.DB) return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request); if (auth.response) return auth.response;
  try {
    assertRouteAccess(auth.user,'route.schedule');
    const url=new URL(request.url); const editor=url.searchParams.get('editor') !== '0';
    if (editor) return jsonResponse(await getScheduleEditor(env.DB,auth.user,url.searchParams.get('date')));
    return jsonResponse(await listScheduleRecords(env.DB,auth.user,{date:url.searchParams.get('date')||'',start:url.searchParams.get('start')||'',end:url.searchParams.get('end')||'',status:url.searchParams.get('status')||'',region:url.searchParams.get('region')||'',q:url.searchParams.get('q')||''}));
  } catch (error) { return errorResponse(error); }
}
export async function onRequestPost({ env,request }) {
  if (!env.DB) return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request); if (auth.response) return auth.response;
  try {
    assertRouteAccess(auth.user,'route.schedule',true);
    const body=await payload(request); const action=String(body.action || 'save').toLowerCase();
    if (action === 'save_batch') return jsonResponse(await saveScheduleBatch(env.DB,auth.user,body.records,body.requestId));
    if (action === 'preview_import') return jsonResponse(await previewScheduleImport(env.DB,auth.user,body.date,body.text));
    if (action === 'auto_pre_scale') return jsonResponse(await autoPreScale(env.DB,auth.user,body.date,body.records));
    if (action === 'confirm_import') return jsonResponse(await confirmScheduleImport(env.DB,auth.user,body.date,body.rows,body.requestId));
    if (action === 'admin_correct_resources') {
      const record=await withOperationalGuard(env.DB,'schedule-admin-correction',body.requestId,()=>adminCorrectScheduleResources(env.DB,auth.user,body),operationalScopeFromPayload(body,'schedule-admin-correction'));
      return jsonResponse({versao:'1',record});
    }
    const record=body.record || body;
    const result=await withOperationalGuard(env.DB,'schedule-save',body.requestId || record.requestId,()=>saveSchedule(env.DB,auth.user,record),operationalScopeFromPayload(record,'schedule-save'));
    return jsonResponse({versao:'1',record:result},201);
  } catch (error) { return errorResponse(error); }
}
export async function onRequestPut({ env,request }) {
  if (!env.DB) return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request); if (auth.response) return auth.response;
  try { assertRouteAccess(auth.user,'route.schedule',true); const body=await payload(request); const record=body.record || body; const result=await withOperationalGuard(env.DB,'schedule-save',body.requestId || record.requestId,()=>saveSchedule(env.DB,auth.user,record),operationalScopeFromPayload(record,'schedule-save')); return jsonResponse({versao:'1',record:result}); }
  catch (error) { return errorResponse(error); }
}
export async function onRequestDelete({ env,request }) {
  if (!env.DB) return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request); if (auth.response) return auth.response;
  try {
    assertRouteAccess(auth.user,'route.schedule',true);
    const body=await payload(request); const action=String(body.action || 'cancel').toLowerCase();
    const scope=`SCHEDULE:${String(body.id || '').trim() || 'UNKNOWN'}`;
    if (action === 'delete') {
      const result=await withOperationalGuard(env.DB,'schedule-delete',body.requestId,()=>deleteSchedule(env.DB,auth.user,body.id,body.storage,body.confirmation,body.identity||{}),scope);
      return jsonResponse({versao:'1',result});
    }
    const record=await withOperationalGuard(env.DB,'schedule-cancel',body.requestId,()=>cancelSchedule(env.DB,auth.user,body.id,body.storage,body.reason,body.identity||{}),scope);
    return jsonResponse({versao:'1',record});
  } catch (error) { return errorResponse(error); }
}
