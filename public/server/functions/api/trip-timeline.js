import { jsonResponse, requireUser } from '../_lib/auth.js';
import { assertRouteAccess } from '../_lib/route-access.js';
import { parseData } from '../_lib/core.js';
import { normalizeText } from '../_lib/route-phase1.js';

function clean(value,max=160){return String(value??'').trim().slice(0,max);}
async function tableExists(db,name){
  return Boolean((await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND UPPER(name)=UPPER(?)").bind(name).first())?.name);
}
function normalizeAt(value,date=''){
  const raw=String(value||'').trim();
  if(/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(raw))return raw.replace(' ','T').slice(0,19);
  const match=raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date||''))&&match?`${date}T${String(match[1]).padStart(2,'0')}:${match[2]}:${match[3]||'00'}`:'';
}
function eventOrder(a,b){return String(a.at||'').localeCompare(String(b.at||''))||String(a.type||'').localeCompare(String(b.type||''));}
function laterAt(a,b){const left=String(a||''),right=String(b||'');return left>=right?left:right;}
function dedupeTimelineEvents(events=[]){
  const merged=[],byClientArrival=new Map();
  for(const source of [...events].sort(eventOrder)){
    const event={...source};
    if(event.type!=='CLIENTE'){merged.push(event);continue;}
    // Registros antigos podem ter sido reabertos pela mesma posição Lincros já superada
    // pelo ProtectSat. Para a tela, uma chegada do mesmo cliente no mesmo instante é um
    // único marco; preservamos a saída mais recente encontrada.
    const key=`${normalizeText(event.label||'CLIENTE')}|${String(event.at||'')}`;
    const existing=byClientArrival.get(key);
    if(existing){
      existing.leftAt=laterAt(existing.leftAt,event.leftAt);
      if(!existing.clientId&&event.clientId)existing.clientId=event.clientId;
      continue;
    }
    byClientArrival.set(key,event);merged.push(event);
  }
  return merged.sort(eventOrder);
}
function timelineAccess(user){
  try{return assertRouteAccess(user,'route.monitoring');}
  catch(first){try{return assertRouteAccess(user,'route.returns');}catch{throw first;}}
}
function normalizePlate(value){return clean(value,30).toUpperCase().replace(/[^A-Z0-9]/g,'');}
function boolParam(value){return ['1','TRUE','SIM','YES'].includes(normalizeText(value));}

export async function onRequestGet({env,request}){
  if(!env.DB)return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request);if(auth.response)return auth.response;
  try{
    timelineAccess(auth.user);
    const url=new URL(request.url);
    const raw=[url.searchParams.get('scheduleId')||'',url.searchParams.get('scheduleIds')||''].filter(Boolean).join(',');
    const scheduleIds=[...new Set(raw.split(',').map((value)=>clean(value,120)).filter(Boolean))].slice(0,200);
    const timelines=Object.fromEntries(scheduleIds.map((id)=>[id,[]]));

    if(scheduleIds.length){
      const placeholders=scheduleIds.map(()=>'?').join(',');
      if(await tableExists(env.DB,'ROUTE_DEPARTURES')){
        const {results=[]}=await env.DB.prepare(`SELECT SCHEDULE_ID,DATE_KEY,ACTUAL_AT,DATA_JSON FROM ROUTE_DEPARTURES WHERE SCHEDULE_ID IN (${placeholders})`).bind(...scheduleIds).all();
        for(const row of results||[]){
          const data=parseData(row.DATA_JSON)||{};const scheduleId=clean(row.SCHEDULE_ID||data.schedule_record_id||data.schedule_id,120);if(!timelines[scheduleId])continue;
          const at=normalizeAt(row.ACTUAL_AT||data.saida_real||data.hora_real,row.DATE_KEY||data.data);
          if(!at)continue;
          const origin=clean(data.origem_saida||data.origem||'',80);
          timelines[scheduleId].push({type:'SAIDA',label:'Saída de Recife',at,origin,automatic:normalizeText(origin)==='GPS_GEOFENCE'});
        }
      }

      if(await tableExists(env.DB,'ROUTE_CLIENT_ARRIVALS')){
        const {results=[]}=await env.DB.prepare(`SELECT SCHEDULE_ID,CLIENT_ID,CLIENT_NAME,ARRIVED_AT,LEFT_AT,LATITUDE,LONGITUDE FROM ROUTE_CLIENT_ARRIVALS WHERE SCHEDULE_ID IN (${placeholders}) ORDER BY ARRIVED_AT`).bind(...scheduleIds).all();
        for(const row of results||[]){
          const scheduleId=clean(row.SCHEDULE_ID,120);if(!timelines[scheduleId])continue;
          timelines[scheduleId].push({type:'CLIENTE',label:clean(row.CLIENT_NAME||'Cliente',240),clientId:clean(row.CLIENT_ID,160),at:normalizeAt(row.ARRIVED_AT),leftAt:normalizeAt(row.LEFT_AT),latitude:row.LATITUDE,longitude:row.LONGITUDE,origin:'GPS_CLIENTE',automatic:true});
        }
      }

      if(await tableExists(env.DB,'ROUTE_RETURNS')){
        const {results=[]}=await env.DB.prepare(`SELECT SCHEDULE_ID,DATE_KEY,RETURN_AT,DATA_JSON FROM ROUTE_RETURNS WHERE SCHEDULE_ID IN (${placeholders})`).bind(...scheduleIds).all();
        for(const row of results||[]){
          const data=parseData(row.DATA_JSON)||{};const scheduleId=clean(row.SCHEDULE_ID||data.schedule_record_id||data.schedule_id,120);if(!timelines[scheduleId])continue;
          const at=normalizeAt(row.RETURN_AT||data.retorno_real||data.return_at,row.DATE_KEY||data.data);if(!at)continue;
          const origin=clean(data.origem||'',80);
          timelines[scheduleId].push({type:'RETORNO',label:'Retorno a Recife',at,origin,automatic:normalizeText(origin)==='GPS'});
        }
      }
    }

    let total=0;for(const [scheduleId,events] of Object.entries(timelines)){const compact=dedupeTimelineEvents(events);timelines[scheduleId]=compact;total+=compact.length;}

    const includeGps=boolParam(url.searchParams.get('includeGps'));
    const plate=normalizePlate(url.searchParams.get('plate'));
    const startAt=normalizeAt(url.searchParams.get('startAt')||url.searchParams.get('from'));
    const endAt=normalizeAt(url.searchParams.get('endAt')||url.searchParams.get('to'));
    const requestedLimit=Number(url.searchParams.get('gpsLimit')||1000);
    const gpsLimit=Math.min(2000,Math.max(50,Number.isFinite(requestedLimit)?Math.floor(requestedLimit):1000));
    let gpsRecords=[],gpsTruncated=false;
    if(includeGps&&plate&&startAt&&endAt&&startAt<=endAt&&await tableExists(env.DB,'ROUTE_GPS_POSITIONS')){
      const {results=[]}=await env.DB.prepare(`SELECT GPS_TIME,FETCHED_AT,LOCATION_TEXT,POINT_TEXT,LATITUDE,LONGITUDE,SPEED,IGNITION,VEHICLE_ID,VEHICLE_TYPE,RAW_JSON
        FROM ROUTE_GPS_POSITIONS
        WHERE PLATE=? AND GPS_TIME>=? AND GPS_TIME<=?
        ORDER BY GPS_TIME ASC,ID ASC LIMIT ?`).bind(plate,startAt,endAt,gpsLimit+1).all();
      gpsTruncated=(results||[]).length>gpsLimit;
      gpsRecords=(results||[]).slice(0,gpsLimit).map((row)=>{let raw={};try{raw=JSON.parse(String(row.RAW_JSON||'{}'))||{};}catch{}const source=clean(raw.__DMS_SOURCE||'PROTECTSAT',40);return {
        at:normalizeAt(row.GPS_TIME),fetchedAt:normalizeAt(row.FETCHED_AT),location:clean(row.LOCATION_TEXT,500),point:clean(row.POINT_TEXT,500),
        latitude:row.LATITUDE,longitude:row.LONGITUDE,speed:Number(row.SPEED||0),ignition:Number(row.IGNITION||0),vehicleId:clean(row.VEHICLE_ID,120),vehicleType:clean(row.VEHICLE_TYPE,120),source,
        speedReliable:source!=='LINCROS',ignitionReliable:source!=='LINCROS',
      };});
    }

    return jsonResponse({versao:'1',timelines,total,gpsRecords,gpsTotal:gpsRecords.length,gpsTruncated,gpsQuery:{plate,startAt,endAt,limit:gpsLimit}});
  }catch(error){return jsonResponse({erro:error.message||String(error),codigo:error.code||'TRIP_TIMELINE_ERROR'},error.status||400);}
}
