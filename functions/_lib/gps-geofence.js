function clean(value,max=500){return String(value??'').trim().slice(0,max);}
function normalize(value){return clean(value,500).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function facilityTokens(name){return normalize(name).split(' ').filter((token)=>token.length>=4&&!['ALIMENTOS'].includes(token));}
function matchesFacility(value,name){const text=normalize(value);if(!text)return false;const tokens=facilityTokens(name);return tokens.length?tokens.every((token)=>text.includes(token)):text.includes('NOTARO');}
function numeric(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(String(value).replace(',','.'));return Number.isFinite(n)?n:null;}
function rawDistance(raw={}){for(const key of ['DIST_PONTO','DISTANCIA_PONTO','DISTANCIA','DISTANCE','DIST_PONTO_METROS','DISTANCIA_PONTO_METROS','DISTANCIA_METROS','__DMS_DISTANCE_TO_POINT']){const n=numeric(raw?.[key]);if(n!==null)return n;}return null;}
export function gpsDistanceMeters(aLat,aLng,bLat,bLng){
  const lat1=Number(aLat),lon1=Number(aLng),lat2=Number(bLat),lon2=Number(bLng);if(![lat1,lon1,lat2,lon2].every(Number.isFinite))return NaN;
  const rad=(value)=>value*Math.PI/180,R=6371000,dLat=rad(lat2-lat1),dLon=rad(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
export function positionInsideFacilityAnchors(position={},anchors=[],radiusMeters=120){
  const lat=Number(position?.latitude??position?.LATITUDE),lng=Number(position?.longitude??position?.LONGITUDE);if(!Number.isFinite(lat)||!Number.isFinite(lng))return false;
  return (anchors||[]).some((anchor)=>{const distance=gpsDistanceMeters(lat,lng,anchor.lat,anchor.lng);return Number.isFinite(distance)&&distance<=Number(radiusMeters||120);});
}
export async function loadGpsFacilityAnchors(db,facilityNames=[],radiusMeters=120,{limit=8000}={}){
  const names=(Array.isArray(facilityNames)?facilityNames:[facilityNames]).map((x)=>clean(x,240)).filter(Boolean);if(!db||!names.length)return [];
  let rows=[];try{const result=await db.prepare(`SELECT LATITUDE,LONGITUDE,POINT_TEXT,LOCATION_TEXT,SPEED,RAW_JSON,GPS_TIME FROM ROUTE_GPS_POSITIONS WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL ORDER BY ID DESC LIMIT ?`).bind(Math.max(200,Math.min(20000,Number(limit||8000)))).all();rows=result.results||[];}catch{return [];}
  const strong=[],weak=[];
  for(const row of rows){
    const lat=Number(row.LATITUDE),lng=Number(row.LONGITUDE);if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
    let raw={};try{raw=JSON.parse(String(row.RAW_JSON||'{}'))||{};}catch{}
    const matched=names.some((name)=>matchesFacility(row.POINT_TEXT,name)||matchesFacility(row.LOCATION_TEXT,name)||matchesFacility(raw?.PONTO,name)||matchesFacility(raw?.PONTO_PROXIMO,name)||matchesFacility(raw?.LOCALIZACAO,name)||matchesFacility(raw?.['LOCALIZAÇÃO'],name));
    if(!matched)continue;
    const distance=rawDistance(raw),item={lat,lng,time:String(row.GPS_TIME||'')};
    if(Number.isFinite(distance)&&distance<=Number(radiusMeters||120))strong.push(item);
    else if(!Number.isFinite(distance)&&Number(row.SPEED||0)<=3)weak.push(item);
  }
  const source=strong.length?strong:weak;const out=[];
  for(const item of source){if(out.some((anchor)=>gpsDistanceMeters(item.lat,item.lng,anchor.lat,anchor.lng)<=35))continue;out.push(item);if(out.length>=12)break;}
  return out;
}
