import { appErrorResponse, appJson, auditAppRead, buildAppRoute, findActiveAppRoutesByPlate, requireAppService, resolveAppSchedule } from '../../../_lib/app-integration.js';

export async function onRequestGet(context) {
  try {
    await requireAppService(context.request,context.env);
    const url=new URL(context.request.url);
    const routeId=url.searchParams.get('routeId')||'';
    const scheduleId=url.searchParams.get('scheduleId')||'';
    const storage=url.searchParams.get('storage')||'';
    const plate=url.searchParams.get('plate')||'';
    if(routeId||scheduleId){
      const schedule=await resolveAppSchedule(context.env.DB,{routeId,scheduleId,scheduleStorage:storage});
      const route=await buildAppRoute(context.env.DB,schedule,{includeOperational:url.searchParams.get('details')==='1'});
      await auditAppRead(context.env.DB,'APP_ROUTE_READ',schedule.id,{routeId:route.id,plate:route.plate,purpose:url.searchParams.get('purpose')||''});
      return appJson({ok:true,route});
    }
    const records=await findActiveAppRoutesByPlate(context.env.DB,plate);
    await auditAppRead(context.env.DB,'APP_ROUTE_LOOKUP',null,{plate,total:records.length,purpose:url.searchParams.get('purpose')||''});
    return appJson({ok:true,total:records.length,records});
  }catch(error){return appErrorResponse(error);}
}
