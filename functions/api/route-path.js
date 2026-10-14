import { jsonResponse, requireUser } from '../_lib/auth.js';
import { assertRouteAccess } from '../_lib/route-access.js';

// Valhalla/Meili faz map matching sobre a malha do OpenStreetMap.
// O servidor público abaixo é apenas o padrão; em produção, pode ser substituído
// por VALHALLA_BASE_URL para uma instância própria/gerenciada.
const DEFAULT_VALHALLA_URL = 'https://valhalla1.openstreetmap.de';
const DEFAULT_OSRM_URL = 'https://router.project-osrm.org';
const MAX_TRACE_POINTS = 70;
const MAX_CHUNK_POINTS = 55;

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
async function externalFetch(url,options={},timeoutMs=7000){
  let lastError=null;
  for(let attempt=0;attempt<2;attempt+=1){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{...options,signal:controller.signal});
      if([429,502,503,504].includes(response.status)&&attempt===0){lastError=new Error(`HTTP ${response.status}`);await sleep(250);continue;}
      return response;
    }catch(error){lastError=error;if(attempt===0){await sleep(250);continue;}throw error;}
    finally{clearTimeout(timer);}
  }
  throw lastError||new Error('Serviço de roteamento indisponível.');
}

function parseTime(value) {
  const raw=String(value||'').trim();
  if(!raw)return Number.NaN;
  const br=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(br)return Date.parse(`${br[3]}-${br[2]}-${br[1]}T${String(br[4]||'00').padStart(2,'0')}:${br[5]||'00'}:${br[6]||'00'}-03:00`);
  const iso=raw.includes('T')?raw:raw.replace(' ','T');
  const zoned=/Z$|[+-]\d{2}:?\d{2}$/.test(iso)?iso:`${iso}${iso.length===16?':00':''}-03:00`;
  const ms=Date.parse(zoned);
  return Number.isFinite(ms)?ms:Number.NaN;
}
function finiteCoordinate(item) {
  const latitude = Number(item?.latitude);
  const longitude = Number(item?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude, updatedAt:String(item?.updatedAt || ''), timestamp:parseTime(item?.updatedAt) }
    : null;
}
function distanceApprox(a,b) {
  const lat=(a.latitude+b.latitude)/2*Math.PI/180;
  const dx=(b.longitude-a.longitude)*111320*Math.cos(lat);
  const dy=(b.latitude-a.latitude)*110540;
  return Math.hypot(dx,dy);
}
function sortAndDedup(input=[]) {
  const valid=input.map(finiteCoordinate).filter(Boolean).sort((a,b)=>{
    const ta=Number.isFinite(a.timestamp)?a.timestamp:0;
    const tb=Number.isFinite(b.timestamp)?b.timestamp:0;
    return ta-tb;
  });
  const result=[];
  for(const point of valid){
    const previous=result.at(-1);
    if(!previous){result.push(point);continue;}
    const meters=distanceApprox(previous,point);
    const dt=Number.isFinite(previous.timestamp)&&Number.isFinite(point.timestamp)?Math.abs(point.timestamp-previous.timestamp):Number.NaN;
    // elimina leituras praticamente iguais do rastreador, mas conserva curvas/retornos.
    if(meters<15 && (!Number.isFinite(dt)||dt<4*60*1000))continue;
    result.push(point);
  }
  return result;
}
function splitCoherentTrips(points=[]) {
  if(points.length<2)return points.length?[points]:[];
  const segments=[];let current=[points[0]];
  for(let i=1;i<points.length;i+=1){
    const previous=points[i-1], point=points[i];
    const meters=distanceApprox(previous,point);
    const dtMs=Number.isFinite(previous.timestamp)&&Number.isFinite(point.timestamp)?point.timestamp-previous.timestamp:Number.NaN;
    const hours=Number.isFinite(dtMs)&&dtMs>0?dtMs/3600000:Number.NaN;
    const speedKmh=Number.isFinite(hours)&&hours>0?(meters/1000)/hours:Number.NaN;
    // separa viagens/trechos quando há perda de sinal longa ou salto impossível.
    const split = (Number.isFinite(dtMs)&&dtMs>4*3600000)
      || (Number.isFinite(speedKmh)&&speedKmh>155)
      || (!Number.isFinite(dtMs)&&meters>120000)
      || (Number.isFinite(dtMs)&&dtMs<=10*60*1000&&meters>45000);
    if(split){if(current.length>=2)segments.push(current);current=[point];}
    else current.push(point);
  }
  if(current.length>=2)segments.push(current);
  return segments;
}
function compactPoints(points,max=MAX_TRACE_POINTS) {
  if(points.length<=max)return points;
  const output=[];const step=(points.length-1)/(max-1);
  for(let i=0;i<max;i+=1)output.push(points[Math.round(i*step)]);
  return output;
}
function chunks(points,size=MAX_CHUNK_POINTS) {
  const out=[];
  for(let index=0;index<points.length-1;index+=size-1){
    const part=points.slice(index,index+size);
    if(part.length>=2)out.push(part);
  }
  return out;
}

// Valhalla usa polyline com precisão 6 para as shapes de rota/map matching.
function decodePolyline6(encoded='') {
  const coordinates=[];
  let index=0,lat=0,lng=0;
  const source=String(encoded||'');
  while(index<source.length){
    let result=0,shift=0,b;
    do { b=source.charCodeAt(index++)-63; result|=(b&0x1f)<<shift; shift+=5; } while(b>=0x20&&index<=source.length);
    lat += (result&1) ? ~(result>>1) : (result>>1);
    result=0;shift=0;
    do { b=source.charCodeAt(index++)-63; result|=(b&0x1f)<<shift; shift+=5; } while(b>=0x20&&index<=source.length);
    lng += (result&1) ? ~(result>>1) : (result>>1);
    coordinates.push([lat/1e6,lng/1e6]);
  }
  return coordinates.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b));
}
function shapeFromTraceAttributes(payload) {
  const encoded=String(payload?.shape||'');
  if(!encoded)return [];
  const coords=decodePolyline6(encoded);
  return coords.length>=2?[coords]:[];
}
function shapesFromTraceRoute(payload) {
  const segments=[];
  const appendTrip=(trip)=>{
    for(const leg of trip?.legs||[]){
      const coords=decodePolyline6(leg?.shape||'');
      if(coords.length>=2)segments.push(coords);
    }
  };
  appendTrip(payload?.trip);
  for(const alternate of payload?.alternates||payload?.alternate_paths||[]) appendTrip(alternate?.trip||alternate);
  return segments;
}
function traceShape(points) {
  const firstTime=points.find((p)=>Number.isFinite(p.timestamp))?.timestamp;
  return points.map((point,index)=>{
    const item={lat:Number(point.latitude.toFixed(6)),lon:Number(point.longitude.toFixed(6))};
    if(Number.isFinite(point.timestamp)) item.time=Math.max(0,Math.round((point.timestamp-(Number.isFinite(firstTime)?firstTime:point.timestamp))/1000));
    if(index===0||index===points.length-1)item.type='break';
    return item;
  });
}
async function valhallaFetch(baseUrl,endpoint,payload) {
  const response=await externalFetch(`${baseUrl.replace(/\/+$/,'')}/${endpoint}`,{
    method:'POST',
    headers:{
      Accept:'application/json',
      'Content-Type':'application/json',
      'X-Client-Id':'natto-dms-rota',
      'User-Agent':'Natto-DMS-Rota/1',
    },
    body:JSON.stringify(payload),
  },6500);
  const text=await response.text();
  let data={};try{data=text?JSON.parse(text):{};}catch{}
  if(!response.ok)throw new Error(data?.error||data?.error_code||data?.message||`Valhalla respondeu HTTP ${response.status}.`);
  return data;
}
async function valhallaMatchChunk(baseUrl,points) {
  const shape=traceShape(points);
  const common={
    shape,
    costing:'auto',
    shape_match:'map_snap',
    trace_options:{
      gps_accuracy:20,
      search_radius:100,
      interpolation_distance:10,
      breakage_distance:10000,
      use_timestamps:shape.some((x)=>Number.isFinite(x.time)),
    },
  };

  // trace_attributes costuma ser mais fiel ao caminho realmente percorrido
  // para telemetria porque devolve a shape do map matching, não uma rota nova.
  try{
    const attributes=await valhallaFetch(baseUrl,'trace_attributes',{
      ...common,
      filters:{action:'include',attributes:['shape','matched.point','matched.type','matched.edge_index','confidence_score']},
    });
    const segments=shapeFromTraceAttributes(attributes);
    if(segments.length)return {segments,engine:'VALHALLA_TRACE_ATTRIBUTES',confidence:Number(attributes?.confidence_score||0)};
  }catch{}

  // Fallback ainda dentro do Valhalla/OSM.
  const route=await valhallaFetch(baseUrl,'trace_route',common);
  const segments=shapesFromTraceRoute(route);
  if(!segments.length)throw new Error('Valhalla não encontrou um caminho viário confiável para este trecho.');
  return {segments,engine:'VALHALLA_TRACE_ROUTE',confidence:null};
}

// Fallback final no mesmo ecossistema OSM. Só é usado quando Valhalla não
// consegue map-match um chunk específico; nunca desenhamos linha reta manual.
async function osrmMatchChunk(baseUrl,points) {
  const coordinates=points.map((p)=>`${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`).join(';');
  const radiuses=points.map(()=>100).join(';');
  const url=`${baseUrl.replace(/\/+$/,'')}/match/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false&gaps=split&tidy=true&radiuses=${radiuses}`;
  const response=await externalFetch(url,{headers:{Accept:'application/json','User-Agent':'Natto-DMS-Rota/1'}},6500);
  if(!response.ok)throw new Error(`OSRM respondeu HTTP ${response.status}.`);
  const payload=await response.json();
  if(payload?.code!=='Ok'||!Array.isArray(payload?.matchings))throw new Error(payload?.message||payload?.code||'OSRM não conseguiu ajustar o trajeto.');
  const segments=[];
  for(const matching of payload.matchings||[]){
    const raw=matching?.geometry?.coordinates;
    if(!Array.isArray(raw)||raw.length<2)continue;
    const coords=raw.map(([lng,lat])=>[Number(lat),Number(lng)]).filter(([lat,lng])=>Number.isFinite(lat)&&Number.isFinite(lng));
    if(coords.length>1)segments.push(coords);
  }
  if(!segments.length)throw new Error('OSRM não encontrou trecho compatível com a estrada.');
  return {segments,engine:'OSRM_MATCH'};
}

export async function onRequestPost({env,request}) {
  if(!env.DB)return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request);if(auth.response)return auth.response;
  try{
    assertRouteAccess(auth.user,'route.location');
    const body=await request.json().catch(()=>({}));
    const ordered=sortAndDedup(Array.isArray(body.positions)?body.positions:[]);
    const coherent=splitCoherentTrips(ordered);
    if(!coherent.length)return jsonResponse({versao:'1',routed:false,segments:[],inputPoints:ordered.length,reason:'Não há sequência de posições coerente suficiente para traçar o percurso.'});

    const valhallaUrl=String(env.VALHALLA_BASE_URL||DEFAULT_VALHALLA_URL).trim();
    const osrmUrl=String(env.ROUTING_BASE_URL||DEFAULT_OSRM_URL).trim();
    const roadSegments=[];const engines=new Set();
    let failedChunks=0,matchedChunks=0,valhallaChunks=0,osrmChunks=0;

    for(const trip of coherent){
      const points=compactPoints(trip);
      for(const part of chunks(points)){
        try{
          const result=await valhallaMatchChunk(valhallaUrl,part);
          roadSegments.push(...result.segments);engines.add(result.engine);matchedChunks+=1;valhallaChunks+=1;
          continue;
        }catch{}
        try{
          const result=await osrmMatchChunk(osrmUrl,part);
          roadSegments.push(...result.segments);engines.add(result.engine);matchedChunks+=1;osrmChunks+=1;
        }catch{failedChunks+=1;}
      }
    }

    return jsonResponse({
      versao:'1',
      routed:roadSegments.length>0,
      segments:roadSegments,
      inputPoints:ordered.length,
      tripSegments:coherent.length,
      matchedChunks,
      failedChunks,
      valhallaChunks,
      osrmChunks,
      engine:[...engines].join('+')||'',
      provider:'OpenStreetMap / Valhalla',
      reason:roadSegments.length?'':'Não foi possível encaixar as posições em estradas conhecidas do OpenStreetMap.',
    });
  }catch(error){return jsonResponse({erro:error.message||String(error),codigo:error.code||'ROUTE_PATH_ERROR'},400);}
}
