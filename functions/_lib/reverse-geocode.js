const DEFAULT_PROVIDER='https://nominatim.openstreetmap.org/reverse';
const CACHE_DAYS=90;
let reverseSchemaPromise=null;

function clean(value,max=240){return String(value??'').trim().replace(/\s+/g,' ').slice(0,max);}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function coordKey(lat,lng){return `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;}
function stateCode(address={}){
  const iso=clean(address['ISO3166-2-lvl4']||address['ISO3166-2-lvl6']||'',40).toUpperCase();
  const m=iso.match(/^BR-([A-Z]{2})$/);if(m)return m[1];
  const states={ACRE:'AC',ALAGOAS:'AL',AMAPA:'AP',AMAPÁ:'AP',AMAZONAS:'AM',BAHIA:'BA',CEARA:'CE',CEARÁ:'CE','DISTRITO FEDERAL':'DF','ESPIRITO SANTO':'ES','ESPÍRITO SANTO':'ES',GOIAS:'GO',GOIÁS:'GO',MARANHAO:'MA',MARANHÃO:'MA','MATO GROSSO':'MT','MATO GROSSO DO SUL':'MS','MINAS GERAIS':'MG',PARA:'PA',PARÁ:'PA',PARAIBA:'PB',PARAÍBA:'PB',PARANA:'PR',PARANÁ:'PR',PERNAMBUCO:'PE',PIAUI:'PI',PIAUÍ:'PI','RIO DE JANEIRO':'RJ','RIO GRANDE DO NORTE':'RN','RIO GRANDE DO SUL':'RS',RONDONIA:'RO',RONDÔNIA:'RO',RORAIMA:'RR','SANTA CATARINA':'SC','SAO PAULO':'SP','SÃO PAULO':'SP',SERGIPE:'SE',TOCANTINS:'TO'};
  return states[clean(address.state,80).toUpperCase()]||'';
}
function labelFromNominatim(data={}){
  const a=data.address||{};
  const road=clean(a.road||a.pedestrian||a.highway||a.residential||a.track||a.path||data.name||'',140);
  const locality=clean(a.neighbourhood||a.suburb||a.quarter||a.hamlet||a.village||'',120);
  const city=clean(a.city||a.town||a.municipality||a.village||a.county||'',120);
  const uf=stateCode(a);
  const area=[city,uf].filter(Boolean).join('/');
  const primary=road||locality;
  if(primary&&area&&primary.toUpperCase()!==city.toUpperCase())return `${primary} · ${area}`;
  if(area)return area;
  if(primary)return primary;
  const parts=clean(data.display_name,500).split(',').map((x)=>clean(x,120)).filter(Boolean).slice(0,3);
  return parts.join(' · ');
}

export async function ensureReverseGeocodeSchema(db){
  if(!reverseSchemaPromise)reverseSchemaPromise=db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS REVERSE_GEOCODE_CACHE (
      CACHE_KEY TEXT PRIMARY KEY,
      LATITUDE REAL NOT NULL,
      LONGITUDE REAL NOT NULL,
      LABEL TEXT NOT NULL,
      ROAD TEXT,
      LOCALITY TEXT,
      CITY TEXT,
      STATE TEXT,
      COUNTRY TEXT,
      DISPLAY_NAME TEXT,
      PROVIDER TEXT NOT NULL DEFAULT 'NOMINATIM',
      UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_REVERSE_GEOCODE_UPDATED_AT ON REVERSE_GEOCODE_CACHE(UPDATED_AT)`)
  ]).then(()=>true).catch((error)=>{reverseSchemaPromise=null;throw error;});
  return reverseSchemaPromise;
}

export async function cachedReverseGeocode(db,lat,lng){
  await ensureReverseGeocodeSchema(db);const key=coordKey(lat,lng);
  const row=await db.prepare(`SELECT CACHE_KEY,LATITUDE,LONGITUDE,LABEL,ROAD,LOCALITY,CITY,STATE,COUNTRY,DISPLAY_NAME,PROVIDER,UPDATED_AT FROM REVERSE_GEOCODE_CACHE WHERE CACHE_KEY=? AND UPDATED_AT>=datetime('now',?) LIMIT 1`).bind(key,`-${CACHE_DAYS} days`).first();
  if(!row)return null;
  return {key,label:row.LABEL||'',latitude:Number(row.LATITUDE),longitude:Number(row.LONGITUDE),road:row.ROAD||'',locality:row.LOCALITY||'',city:row.CITY||'',state:row.STATE||'',country:row.COUNTRY||'',displayName:row.DISPLAY_NAME||'',provider:row.PROVIDER||'NOMINATIM',updatedAt:row.UPDATED_AT||'',cached:true};
}

export async function reverseGeocode(db,env,latValue,lngValue){
  const lat=finite(latValue),lng=finite(lngValue);if(lat===null||lng===null||Math.abs(lat)>90||Math.abs(lng)>180){const error=new Error('Coordenadas inválidas para geocodificação reversa.');error.status=400;error.code='INVALID_COORDINATES';throw error;}
  const cached=await cachedReverseGeocode(db,lat,lng);if(cached)return cached;
  const base=clean(env?.REVERSE_GEOCODING_BASE_URL||DEFAULT_PROVIDER,500)||DEFAULT_PROVIDER;
  const url=new URL(base);url.searchParams.set('format','jsonv2');url.searchParams.set('lat',String(lat));url.searchParams.set('lon',String(lng));url.searchParams.set('zoom','16');url.searchParams.set('addressdetails','1');url.searchParams.set('accept-language','pt-BR');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);let response;
  try{response=await fetch(url,{headers:{Accept:'application/json','Accept-Language':'pt-BR,pt;q=0.9','User-Agent':'NATTO-DMS-Rota/1.0 (+https://nattodmsrecife.pages.dev)','Referer':'https://nattodmsrecife.pages.dev/'},signal:controller.signal});}catch(error){const e=new Error(error?.name==='AbortError'?'Geocodificação reversa excedeu 8 segundos.':`Falha ao consultar geocodificação reversa: ${error?.message||error}`);e.status=502;e.code='REVERSE_GEOCODE_FETCH_ERROR';throw e;}finally{clearTimeout(timer);}
  if(!response.ok){const e=new Error(`Geocodificação reversa respondeu HTTP ${response.status}.`);e.status=502;e.code='REVERSE_GEOCODE_HTTP_ERROR';throw e;}
  const data=await response.json();const label=labelFromNominatim(data);if(!label){const e=new Error('Não foi possível identificar um local para estas coordenadas.');e.status=404;e.code='REVERSE_GEOCODE_EMPTY';throw e;}
  const a=data.address||{},key=coordKey(lat,lng),road=clean(a.road||a.pedestrian||a.highway||a.residential||a.track||a.path||data.name||'',140),locality=clean(a.neighbourhood||a.suburb||a.quarter||a.hamlet||a.village||'',120),city=clean(a.city||a.town||a.municipality||a.village||a.county||'',120),state=stateCode(a)||clean(a.state,80),country=clean(a.country,80),displayName=clean(data.display_name,500);
  await db.prepare(`INSERT INTO REVERSE_GEOCODE_CACHE (CACHE_KEY,LATITUDE,LONGITUDE,LABEL,ROAD,LOCALITY,CITY,STATE,COUNTRY,DISPLAY_NAME,PROVIDER,UPDATED_AT) VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(CACHE_KEY) DO UPDATE SET LATITUDE=excluded.LATITUDE,LONGITUDE=excluded.LONGITUDE,LABEL=excluded.LABEL,ROAD=excluded.ROAD,LOCALITY=excluded.LOCALITY,CITY=excluded.CITY,STATE=excluded.STATE,COUNTRY=excluded.COUNTRY,DISPLAY_NAME=excluded.DISPLAY_NAME,PROVIDER=excluded.PROVIDER,UPDATED_AT=CURRENT_TIMESTAMP`).bind(key,lat,lng,label,road,locality,city,state,country,displayName,'NOMINATIM').run();
  return {key,label,latitude:lat,longitude:lng,road,locality,city,state,country,displayName,provider:'NOMINATIM',updatedAt:new Date().toISOString(),cached:false};
}
