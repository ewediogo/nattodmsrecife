import { jsonResponse, requireUser } from '../_lib/auth.js';
import { assertRouteAccess } from '../_lib/route-access.js';
import { autoConfirmDeparturesFromGps } from '../_lib/departure.js';
import { autoConfirmReturnsFromGps } from '../_lib/return.js';
import { isOperationallyExcludedPlate } from '../_lib/operational-exclusions.js';

const DEFAULT_URL = 'https://api.protectsat.com.br/wsprotect/protect.php';
const PLATE_KEYS = ['PLACA','NRPLACA','VEICULOPLACA','PLACAVEICULO','PREFIXO','IDENTIFICADORVEICULO'];

function norm(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
}
function textNorm(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}
function field(row, aliases) {
  const map = {};
  Object.entries(row || {}).forEach(([key, value]) => { const normalized = norm(key); if (!(normalized in map)) map[normalized] = value; });
  for (const alias of aliases) { const value = map[norm(alias)]; if (value !== undefined && value !== null && String(value).trim()) return value; }
  return '';
}
function plateFrom(row) { return norm(field(row, PLATE_KEYS)); }
function collectRows(value) {
  const rows = []; const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach(visit);
    if (plateFrom(node)) rows.push(node);
    Object.values(node).forEach(visit);
  };
  visit(value); return rows;
}
function decodeXml(value='') {
  return String(value).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
}
function escapeXml(value='') {
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function extractSoapReturn(text='') {
  const source=String(text||'');
  const match=source.match(/<(?:\w+:)?return\b[^>]*>([\s\S]*?)<\/(?:\w+:)?return>/i);
  return match ? decodeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').trim()) : '';
}
function soapEnvelope(functionName,key){
  const fn=String(functionName||'grid_monitoramento').replace(/[^A-Za-z0-9_]/g,'')||'grid_monitoramento';
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><SOAP-ENV:Body><ns1:${fn} xmlns:ns1="urn:server.${fn}"><CHAVE xsi:type="xsd:string">${escapeXml(key)}</CHAVE></ns1:${fn}></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}
async function fetchProtectSat(baseUrl,key,functionName){
  const attempts=[];
  const url=new URL(baseUrl);
  url.searchParams.set('CHAVE',key);
  url.searchParams.set('FUNCAO',functionName);
  try{
    const response=await fetch(url.toString(),{method:'GET',redirect:'follow',headers:{Accept:'application/xml,text/xml,application/json,text/plain,*/*'}});
    const body=await response.text();
    attempts.push({mode:'GET',status:response.status});
    if(response.ok){
      try{const parsed=parsePayload(body);if(parsed.rows.length)return {parsed,body,mode:'GET',attempts};}catch{}
      const soapReturn=extractSoapReturn(body);if(soapReturn){try{const parsed=parsePayload(soapReturn);if(parsed.rows.length)return {parsed,body,mode:'GET_SOAP_RETURN',attempts};}catch{}}
    }
  }catch(error){attempts.push({mode:'GET',error:error?.message||String(error)});}
  try{
    const soapAction=`urn:server.${functionName}#${functionName}`;
    const response=await fetch(baseUrl,{method:'POST',redirect:'follow',headers:{Accept:'text/xml,application/xml,text/plain,*/*','Content-Type':'text/xml; charset=utf-8',SOAPAction:soapAction},body:soapEnvelope(functionName,key)});
    const body=await response.text();
    attempts.push({mode:'SOAP',status:response.status});
    if(!response.ok)throw new Error(`Protect Sat respondeu HTTP ${response.status}.`);
    const returned=extractSoapReturn(body)||body;
    const parsed=parsePayload(returned);
    return {parsed,body,mode:'SOAP',attempts};
  }catch(error){attempts.push({mode:'SOAP',error:error?.message||String(error)});const detail=attempts.map((a)=>a.error?`${a.mode}: ${a.error}`:`${a.mode}: HTTP ${a.status}`).join(' | ');throw new Error(`Falha ao consultar Protect Sat. ${detail}`);}
}
function parseXml(text) {
  const rows=[]; const source=String(text||'');
  const regex=/<registro\b([^>]*)\/?\s*>/gi; let match;
  while((match=regex.exec(source))){
    const row={}; const attrs=match[1]||''; const attr=/([A-Za-z_][\w.-]*)\s*=\s*(["'])(.*?)\2/g; let a;
    while((a=attr.exec(attrs))) row[a[1]]=decodeXml(a[3]);
    if(plateFrom(row)) rows.push(row);
  }
  return rows;
}
function parseDelimited(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = ['\t',';','|',','].map((d) => ({ d, c:lines[0].split(d).length - 1 })).sort((a,b) => b.c-a.c)[0];
  if (!delimiter || delimiter.c < 1) return [];
  const headers = lines[0].split(delimiter.d).map((v) => v.replace(/^"|"$/g,'').trim());
  if (!headers.some((h) => PLATE_KEYS.includes(norm(h)))) return [];
  return lines.slice(1).map((line) => {
    const values = line.split(delimiter.d).map((v) => v.replace(/^"|"$/g,'').trim());
    return Object.fromEntries(headers.map((h,i) => [h, values[i] || '']));
  }).filter((row) => plateFrom(row));
}
function parseKeyValue(text) {
  return String(text || '').split(/(?:\r?\n){2,}|\|\|+/).map((block) => {
    const row = {};
    block.split(/[;&\r\n]+/).forEach((part) => { const m = part.match(/^\s*([^:=]+)\s*[:=]\s*(.*?)\s*$/); if (m) row[m[1].trim()] = m[2].trim(); });
    return row;
  }).filter((row) => plateFrom(row));
}
function parsePayload(text) {
  const clean = String(text || '').replace(/^\uFEFF/,'').trim();
  if (!clean) return { mode:'EMPTY', rows:[] };
  if(/^<\?xml\b|^<[^>]+>/i.test(clean)) { const rows=parseXml(clean); if(rows.length) return {mode:'XML',rows}; const returned=extractSoapReturn(clean); if(returned&&returned!==clean){const soapRows=parseXml(returned);if(soapRows.length)return {mode:'SOAP_XML',rows:soapRows};} }
  const jsonp = clean.match(/^[A-Za-z_$][\w$]*\s*\(([\s\S]*)\)\s*;?$/);
  try { const value = JSON.parse(jsonp ? jsonp[1] : clean); return { mode:'JSON', rows:collectRows(value) }; } catch {}
  const keyValue = parseKeyValue(clean); if (keyValue.length) return { mode:'KEY_VALUE_TEXT', rows:keyValue };
  const delimited = parseDelimited(clean); if (delimited.length) return { mode:'DELIMITED_TEXT', rows:delimited };
  throw new Error('Formato de resposta da Protect Sat não reconhecido.');
}
function protectsatNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text=String(value ?? '').trim(); if(!text)return null;
  if (/^-?\d+,\d+$/.test(text)) text=text.replace(',','.');
  text=text.replace(/[^0-9.\-]/g,'');
  const number=Number(text); return Number.isFinite(number)?number:null;
}
function ignitionValue(value) {
  const text=textNorm(value);
  if(['1','SIM','LIGADA','LIGADO','ON','IGNICAO_LIGADA'].includes(text))return 1;
  if(['0','NAO','DESLIGADA','DESLIGADO','OFF','IGNICAO_DESLIGADA'].includes(text))return 0;
  return protectsatNumber(value)||0;
}
function position(row) {
  const plate = plateFrom(row);
  const latitude = protectsatNumber(field(row,['LATITUDE','LAT','VL_LATITUDE','COORDENADA_Y']));
  const longitude = protectsatNumber(field(row,['LONGITUDE','LON','LNG','VL_LONGITUDE','COORDENADA_X']));
  const point=field(row,['PONTO','PONTO_PROXIMO','DESCRICAO_PONTO']);
  const location = point || field(row,['LOCALIZACAO','LOCALIZAÇÃO','ENDERECO','ENDEREÇO','POSICAO','POSIÇÃO','LOCAL','CIDADE','MUNICIPIO','MUNICÍPIO']);
  // Para automações operacionais, prioriza o timestamp da POSIÇÃO GPS. Campos
  // genéricos de atualização da grade ficam apenas como fallback, pois podem indicar
  // quando a API/tela foi atualizada e não quando o veículo efetivamente mudou de posição.
  const positionDate=field(row,['DT_POSICAO','DATA_POSICAO','DATA_HORA_POSICAO','DATAHORA_POSICAO','DT_ULTIMA_POSICAO','DATA_POSICAO_GPS','DH_POSICAO','DATA_GPS','DATAHORA','DATA_HORA','DATA_EVENTO','DATA']);
  const genericUpdate=field(row,['ULTIMA_ATUALIZACAO','HORARIO']);
  const positionHour=field(row,['HORA_POSICAO','HR_POSICAO']);
  const genericHour=field(row,['HORA']);
  const hour=positionHour||genericHour;
  const directDate=positionDate||genericUpdate;
  const detectedAt=recifeNowIso();
  const rawUpdatedAt=String(directDate&&hour&&!/[T ]\d{1,2}:\d{2}/.test(String(directDate))?`${directDate} ${hour}`:(directDate||hour||'')).trim();
  const updatedAt=rawUpdatedAt||detectedAt;
  const genericUpdateLooksTimed=Boolean(genericUpdate&&(/\d{1,2}:\d{2}/.test(String(genericUpdate))||hour)&&latitude!==null&&longitude!==null);
  const timestampReliable=Boolean(positionDate||positionHour||genericUpdateLooksTimed);
  const timestampSource=positionDate?'GPS_POSITION_DATE':positionHour?'GPS_POSITION_HOUR':genericUpdate?'GENERIC_API_UPDATE':genericHour?'GENERIC_API_HOUR':'DMS_DETECTION';
  const speed=protectsatNumber(field(row,['VELOCIDADE','VELOC','VEL','SPEED']))||0;
  return {
    plate, location:String(location || (latitude !== null && longitude !== null ? `${latitude}, ${longitude}` : '')).trim(), point:String(point||location||'').trim(),
    latitude, longitude, updatedAt, detectedAt, timestampSource, timestampReliable, speed, vehicleId:String(field(row,['VEI_ID','VEIID','ID_VEICULO'])||''),
    distanceToPoint:protectsatNumber(field(row,['DIST_PONTO','DISTANCIA_PONTO','DISTANCIA','DISTANCE','DIST_PONTO_METROS','DISTANCIA_PONTO_METROS','DISTANCIA_METROS'])), ignition:ignitionValue(field(row,['IGNICAO','IGNIÇÃO','IGNITION','STATUS_IGNICAO'])),
    vehicleType:String(field(row,['TIPO_VEICULO','TIPOVEICULO'])||''), odometer:protectsatNumber(field(row,['HODOMETRO','HODÔMETRO']))||0, raw:row
  };
}

function positionFreshnessScore(item) {
  const iso=gpsTimeIso(item?.updatedAt,'');
  const ms=wallClockMs(iso);
  const reliable=item?.timestampReliable===false?0:1;
  const hasCoordinates=Number.isFinite(Number(item?.latitude))&&Number.isFinite(Number(item?.longitude))?1:0;
  return {ms:Number.isFinite(ms)?ms:-1,reliable,hasCoordinates};
}
function freshestPositionsByPlate(items=[]) {
  const byPlate=new Map();
  for(const item of items||[]){
    const plate=norm(item?.plate||'');if(!plate)continue;
    const previous=byPlate.get(plate);
    if(!previous){byPlate.set(plate,item);continue;}
    const a=positionFreshnessScore(previous),b=positionFreshnessScore(item);
    // ProtectSat pode devolver mais de uma linha para a mesma placa. A ordem da grade
    // não é garantia de recência; sempre preservamos a posição GPS mais nova.
    if(b.ms>a.ms||(b.ms===a.ms&&b.reliable>a.reliable)||(b.ms===a.ms&&b.reliable===a.reliable&&b.hasCoordinates>=a.hasCoordinates))byPlate.set(plate,item);
  }
  return [...byPlate.values()];
}

async function tableExists(db, name) {
  try {
    const row = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(String(name)).first();
    return Boolean(row?.name);
  } catch { return false; }
}

let schemaPromise = null;
async function ensureProtectSatSchema(db) {
  if (!schemaPromise) schemaPromise = (async()=>{
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_GPS_POSITIONS (
        ID INTEGER PRIMARY KEY AUTOINCREMENT,
        PLATE TEXT NOT NULL,
        LATITUDE REAL,
        LONGITUDE REAL,
        GPS_TIME TEXT NOT NULL,
        FETCHED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        LOCATION_TEXT TEXT,
        POINT_TEXT TEXT,
        SPEED REAL NOT NULL DEFAULT 0,
        IGNITION INTEGER NOT NULL DEFAULT 0,
        VEHICLE_ID TEXT,
        VEHICLE_TYPE TEXT,
        RAW_JSON TEXT,
        CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(PLATE,GPS_TIME,LATITUDE,LONGITUDE)
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_PLATE_TIME ON ROUTE_GPS_POSITIONS(PLATE,GPS_TIME DESC)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_POSITIONS_TIME ON ROUTE_GPS_POSITIONS(GPS_TIME DESC)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_GPS_LATEST (
        PLATE TEXT PRIMARY KEY,
        LATITUDE REAL, LONGITUDE REAL, GPS_TIME TEXT NOT NULL, FETCHED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        LOCATION_TEXT TEXT, POINT_TEXT TEXT, SPEED REAL NOT NULL DEFAULT 0, IGNITION INTEGER NOT NULL DEFAULT 0,
        VEHICLE_ID TEXT, VEHICLE_TYPE TEXT, DISTANCE_TO_POINT REAL, RAW_JSON TEXT, UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_LATEST_GPS_TIME ON ROUTE_GPS_LATEST(GPS_TIME DESC)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_GPS_STATE (
        PLATE TEXT PRIMARY KEY,
        LAST_LATITUDE REAL,
        LAST_LONGITUDE REAL,
        LAST_GPS_AT TEXT,
        STATIONARY_SINCE TEXT,
        LAST_MOVEMENT_AT TEXT,
        LAST_SPEED REAL NOT NULL DEFAULT 0,
        LAST_IGNITION INTEGER NOT NULL DEFAULT 0,
        UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_STATE_LAST_GPS ON ROUTE_GPS_STATE(LAST_GPS_AT)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_GPS_OCCURRENCES (
        OCCURRENCE_KEY TEXT PRIMARY KEY,
        TYPE TEXT NOT NULL,
        PRIORITY TEXT NOT NULL DEFAULT 'MÉDIA',
        DATE_KEY TEXT NOT NULL,
        PLATE TEXT NOT NULL,
        ROUTE TEXT,
        DRIVER_NAME TEXT,
        SCHEDULE_ID TEXT,
        MONITORING_ID INTEGER,
        STARTED_AT TEXT,
        DETECTED_AT TEXT NOT NULL,
        LAST_SEEN_AT TEXT NOT NULL,
        LOCATION_TEXT TEXT,
        LATITUDE REAL,
        LONGITUDE REAL,
        STOPPED_MINUTES INTEGER NOT NULL DEFAULT 0,
        IGNITION INTEGER NOT NULL DEFAULT 0,
        DETAILS TEXT,
        DATA_JSON TEXT,
        CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_OCC_DATE ON ROUTE_GPS_OCCURRENCES(DATE_KEY,TYPE,PLATE)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_GPS_RETENTIONS (
        RETENTION_KEY TEXT PRIMARY KEY,
        DATE_KEY TEXT NOT NULL,
        PLATE TEXT NOT NULL,
        ROUTE TEXT,
        DRIVER_NAME TEXT,
        SCHEDULE_ID TEXT,
        MONITORING_ID INTEGER,
        STARTED_AT TEXT NOT NULL,
        LAST_SEEN_AT TEXT NOT NULL,
        ENDED_AT TEXT,
        LOCATION_TEXT TEXT,
        LATITUDE REAL,
        LONGITUDE REAL,
        DURATION_MINUTES INTEGER NOT NULL DEFAULT 0,
        ACTIVE INTEGER NOT NULL DEFAULT 1,
        DATA_JSON TEXT,
        CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_RET_DATE ON ROUTE_GPS_RETENTIONS(DATE_KEY,PLATE,STARTED_AT)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_RET_ACTIVE ON ROUTE_GPS_RETENTIONS(ACTIVE,PLATE)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS BASE_CLIENTES (
        ID TEXT PRIMARY KEY,
        CODIGO TEXT,
        NOME TEXT NOT NULL,
        LATITUDE REAL NOT NULL,
        LONGITUDE REAL NOT NULL,
        RAIO_METROS REAL NOT NULL DEFAULT 100,
        CIDADE TEXT,
        UF TEXT,
        ENDERECO TEXT,
        OBSERVACOES TEXT,
        ATIVO INTEGER NOT NULL DEFAULT 1,
        CRIADO_EM TEXT,
        ATUALIZADO_EM TEXT,
        USUARIO TEXT
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_BASE_CLIENTES_ATIVO ON BASE_CLIENTES(ATIVO,NOME)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_BASE_CLIENTES_LAT_LNG ON BASE_CLIENTES(ATIVO,LATITUDE,LONGITUDE)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_CLIENT_ARRIVALS (
        ID INTEGER PRIMARY KEY AUTOINCREMENT,
        SCHEDULE_ID TEXT NOT NULL,
        PLATE TEXT NOT NULL,
        CLIENT_ID TEXT NOT NULL,
        CLIENT_NAME TEXT NOT NULL,
        ARRIVED_AT TEXT NOT NULL,
        LAST_SEEN_AT TEXT NOT NULL,
        LEFT_AT TEXT,
        LATITUDE REAL,
        LONGITUDE REAL,
        ARRIVAL_DISTANCE_METERS INTEGER,
        CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS IDX_ROUTE_CLIENT_ARRIVAL_OPEN ON ROUTE_CLIENT_ARRIVALS(SCHEDULE_ID,PLATE,CLIENT_ID) WHERE LEFT_AT IS NULL`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_CLIENT_ARRIVAL_SCHEDULE ON ROUTE_CLIENT_ARRIVALS(SCHEDULE_ID,ARRIVED_AT)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_IGNITION_OFF_NIGHT (
        SESSION_KEY TEXT PRIMARY KEY,
        NIGHT_KEY TEXT NOT NULL,
        PLATE TEXT NOT NULL,
        VEHICLE_TYPE TEXT NOT NULL DEFAULT '3/4',
        SCHEDULE_ID TEXT,
        MONITORING_ID INTEGER,
        ROUTE TEXT,
        DRIVER_NAME TEXT,
        STARTED_AT TEXT NOT NULL,
        LAST_SEEN_AT TEXT NOT NULL,
        ENDED_AT TEXT,
        DURATION_MINUTES INTEGER NOT NULL DEFAULT 0,
        ACTIVE INTEGER NOT NULL DEFAULT 1,
        LOCATION_TEXT TEXT,
        LATITUDE REAL,
        LONGITUDE REAL,
        CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_IGNITION_NIGHT_DATE ON ROUTE_IGNITION_OFF_NIGHT(NIGHT_KEY,PLATE)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_IGNITION_NIGHT_ACTIVE ON ROUTE_IGNITION_OFF_NIGHT(ACTIVE,PLATE)`),
    ]);
  })().catch((error)=>{schemaPromise=null;throw error;});
  return schemaPromise;
}

function gpsTimeIso(value, fallback = new Date().toISOString()) {
  const raw = String(value || '').trim();
  if (!raw) return String(fallback).replace(' ','T').slice(0,19);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}T${String(br[4]||'00').padStart(2,'0')}:${br[5]||'00'}:${br[6]||'00'}`;
  const iso = raw.replace(' ','T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(iso)) return iso;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) return `${iso}:00`;
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0,19);
  return String(fallback).replace(' ','T').slice(0,19);
}
function isoHoursAgo(hours) { return new Date(Date.now() - Number(hours || 24) * 3600000).toISOString().slice(0,19); }

function recifeNowIso() {
  try {
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date());
    const get=(type)=>parts.find((part)=>part.type===type)?.value||'00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  } catch { return new Date(Date.now()-3*3600000).toISOString().slice(0,19); }
}
function wallClockMs(value) {
  const raw=String(value||'').trim().replace(' ','T');
  const match=raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if(!match)return NaN;
  return Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),Number(match[4]),Number(match[5]),Number(match[6]||0));
}
function minutesSinceIso(value, nowIso = recifeNowIso()) {
  const start=wallClockMs(value),end=wallClockMs(nowIso);
  return !Number.isFinite(start)||!Number.isFinite(end)?0:Math.max(0,Math.round((end-start)/60000));
}

function movementMeters(aLat,aLng,bLat,bLng) {
  const lat1=Number(aLat),lon1=Number(aLng),lat2=Number(bLat),lon2=Number(bLng);
  if(![lat1,lon1,lat2,lon2].every(Number.isFinite))return 0;
  return distanceMeters(lat1,lon1,lat2,lon2);
}

export async function updateGpsMotionState(db, positions=[]) {
  await ensureProtectSatSchema(db);
  if(!positions.length)return;
  const {results=[]}=await db.prepare(`SELECT PLATE,LAST_LATITUDE,LAST_LONGITUDE,LAST_GPS_AT,STATIONARY_SINCE,LAST_MOVEMENT_AT,LAST_SPEED,LAST_IGNITION FROM ROUTE_GPS_STATE`).all();
  const currentByPlate=new Map((results||[]).map((row)=>[norm(row.PLATE),row]));
  const active=await activeMonitoringByPlate(db);
  const statements=[];
  for(const item of positions){
    const plate=norm(item?.plate||''); if(!plate)continue;
    const previous=currentByPlate.get(plate)||null;
    const monitor=active.get(plate)||null;
    const gpsAt=gpsTimeIso(item.updatedAt);
    const speed=Math.max(0,Number(item.speed||0));
    const movedDistance=previous?movementMeters(previous.LAST_LATITUDE,previous.LAST_LONGITUDE,item.latitude,item.longitude):0;
    // Regra operacional: qualquer deslocamento real reinicia a parada.
    // 5 m evita que o ruído normal do GPS seja interpretado como movimento.
    const moved=speed>0 || movedDistance>=5;
    const previousStationarySince=String(previous?.STATIONARY_SINCE||previous?.LAST_GPS_AT||'');
    const previousWasStopped=Boolean(previous&&previousStationarySince&&Number(previous.LAST_SPEED||0)<=0);
    const stationarySince=!previous
      ? gpsAt
      : moved
        ? gpsAt
        : (previousStationarySince||gpsAt);
    const lastMovementAt=moved
      ? gpsAt
      : String(previous?.LAST_MOVEMENT_AT||'');
    const location=String(item.point||item.location||'').trim();

    // Registra retenção GPS somente a partir de 10 minutos durante rota ativa.
    // A ocorrência operacional continua sendo aberta apenas a partir de 20 minutos.
    if(!moved&&monitor){
      const duration=Math.max(0,minutesSinceIso(stationarySince,gpsAt));
      if(duration>=GPS_RETENTION_MINUTES){
      const retentionKey=`GPS_RETENTION|${plate}|${stationarySince}`;
      statements.push(db.prepare(`INSERT INTO ROUTE_GPS_RETENTIONS
        (RETENTION_KEY,DATE_KEY,PLATE,ROUTE,DRIVER_NAME,SCHEDULE_ID,MONITORING_ID,STARTED_AT,LAST_SEEN_AT,ENDED_AT,LOCATION_TEXT,LATITUDE,LONGITUDE,DURATION_MINUTES,ACTIVE,DATA_JSON,UPDATED_AT)
        VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,1,?,CURRENT_TIMESTAMP)
        ON CONFLICT(RETENTION_KEY) DO UPDATE SET
          LAST_SEEN_AT=excluded.LAST_SEEN_AT,ENDED_AT=NULL,LOCATION_TEXT=excluded.LOCATION_TEXT,
          LATITUDE=excluded.LATITUDE,LONGITUDE=excluded.LONGITUDE,DURATION_MINUTES=excluded.DURATION_MINUTES,
          ACTIVE=1,ROUTE=excluded.ROUTE,DRIVER_NAME=excluded.DRIVER_NAME,SCHEDULE_ID=excluded.SCHEDULE_ID,
          MONITORING_ID=excluded.MONITORING_ID,DATA_JSON=excluded.DATA_JSON,UPDATED_AT=CURRENT_TIMESTAMP`)
        .bind(retentionKey,gpsAt.slice(0,10),plate,monitor.route,monitor.driver,monitor.scheduleId,monitor.id,stationarySince,gpsAt,location,item.latitude??null,item.longitude??null,duration,JSON.stringify({monitoringStatus:monitor.status,active:true}))); 
      }
    }

    // Ao voltar a se movimentar, fecha a retenção e grava o tempo final no alerta
    // já aberto. Isso permite justificar a ocorrência enquanto o veículo ainda está
    // parado sem perder o tempo total quando a parada termina.
    if(moved&&previousWasStopped){
      const duration=Math.max(0,minutesSinceIso(previousStationarySince,gpsAt));
      if(duration>=GPS_RETENTION_MINUTES){
      const retentionKey=`GPS_RETENTION|${plate}|${previousStationarySince}`;
      if(monitor){
        statements.push(db.prepare(`INSERT INTO ROUTE_GPS_RETENTIONS
          (RETENTION_KEY,DATE_KEY,PLATE,ROUTE,DRIVER_NAME,SCHEDULE_ID,MONITORING_ID,STARTED_AT,LAST_SEEN_AT,ENDED_AT,LOCATION_TEXT,LATITUDE,LONGITUDE,DURATION_MINUTES,ACTIVE,DATA_JSON,UPDATED_AT)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,CURRENT_TIMESTAMP)
          ON CONFLICT(RETENTION_KEY) DO UPDATE SET
            LAST_SEEN_AT=excluded.LAST_SEEN_AT,ENDED_AT=excluded.ENDED_AT,LOCATION_TEXT=excluded.LOCATION_TEXT,
            LATITUDE=excluded.LATITUDE,LONGITUDE=excluded.LONGITUDE,DURATION_MINUTES=excluded.DURATION_MINUTES,
            ACTIVE=0,DATA_JSON=excluded.DATA_JSON,UPDATED_AT=CURRENT_TIMESTAMP`)
          .bind(retentionKey,previousStationarySince.slice(0,10),plate,monitor.route,monitor.driver,monitor.scheduleId,monitor.id,previousStationarySince,gpsAt,gpsAt,location,item.latitude??null,item.longitude??null,duration,JSON.stringify({monitoringStatus:monitor.status,active:false,endedAt:gpsAt})));
      }else{
        statements.push(db.prepare(`UPDATE ROUTE_GPS_RETENTIONS SET LAST_SEEN_AT=?,ENDED_AT=?,DURATION_MINUTES=?,ACTIVE=0,DATA_JSON=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE RETENTION_KEY=?`)
          .bind(gpsAt,gpsAt,duration,JSON.stringify({active:false,endedAt:gpsAt}),retentionKey));
      }
      const threshold=stopOccurrenceThreshold(monitor||{}),profile=routeProfileFromMonitoring(monitor||{});
      const finalDetails=`Parada a partir de ${threshold} minutos (${profile}): veículo ficou parado por ${duration} min. Local: ${location||'Localização não informada'}.`;
      statements.push(db.prepare(`UPDATE ROUTE_GPS_OCCURRENCES SET LAST_SEEN_AT=?,STOPPED_MINUTES=?,LOCATION_TEXT=?,LATITUDE=?,LONGITUDE=?,DETAILS=?,DATA_JSON=?,UPDATED_AT=CURRENT_TIMESTAMP
        WHERE PLATE=? AND STARTED_AT=? AND TYPE IN ('PARADA_ACIMA_15_MIN','PARADA_ACIMA_20_MIN')`)
        .bind(gpsAt,duration,location,item.latitude??null,item.longitude??null,finalDetails,JSON.stringify({active:false,endedAt:gpsAt}),plate,previousStationarySince));
      }
    }

    statements.push(db.prepare(`
      INSERT INTO ROUTE_GPS_STATE
        (PLATE,LAST_LATITUDE,LAST_LONGITUDE,LAST_GPS_AT,STATIONARY_SINCE,LAST_MOVEMENT_AT,LAST_SPEED,LAST_IGNITION,UPDATED_AT)
      VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(PLATE) DO UPDATE SET
        LAST_LATITUDE=excluded.LAST_LATITUDE,
        LAST_LONGITUDE=excluded.LAST_LONGITUDE,
        LAST_GPS_AT=CASE WHEN excluded.LAST_GPS_AT>=COALESCE(ROUTE_GPS_STATE.LAST_GPS_AT,'') THEN excluded.LAST_GPS_AT ELSE ROUTE_GPS_STATE.LAST_GPS_AT END,
        STATIONARY_SINCE=CASE WHEN excluded.LAST_GPS_AT>=COALESCE(ROUTE_GPS_STATE.LAST_GPS_AT,'') THEN excluded.STATIONARY_SINCE ELSE ROUTE_GPS_STATE.STATIONARY_SINCE END,
        LAST_MOVEMENT_AT=CASE WHEN excluded.LAST_GPS_AT>=COALESCE(ROUTE_GPS_STATE.LAST_GPS_AT,'') THEN excluded.LAST_MOVEMENT_AT ELSE ROUTE_GPS_STATE.LAST_MOVEMENT_AT END,
        LAST_SPEED=CASE WHEN excluded.LAST_GPS_AT>=COALESCE(ROUTE_GPS_STATE.LAST_GPS_AT,'') THEN excluded.LAST_SPEED ELSE ROUTE_GPS_STATE.LAST_SPEED END,
        LAST_IGNITION=CASE WHEN excluded.LAST_GPS_AT>=COALESCE(ROUTE_GPS_STATE.LAST_GPS_AT,'') THEN excluded.LAST_IGNITION ELSE ROUTE_GPS_STATE.LAST_IGNITION END,
        UPDATED_AT=CURRENT_TIMESTAMP
    `).bind(plate,item.latitude??null,item.longitude??null,gpsAt,stationarySince,lastMovementAt||null,speed,Number(item.ignition||0)));
  }
  for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));
}

async function attachGpsMotionState(db, positions=[]) {
  if(!positions.length)return positions;
  await ensureProtectSatSchema(db);
  const {results=[]}=await db.prepare(`SELECT PLATE,LAST_GPS_AT,STATIONARY_SINCE,LAST_MOVEMENT_AT,LAST_SPEED,LAST_IGNITION FROM ROUTE_GPS_STATE`).all();
  const byPlate=new Map((results||[]).map((row)=>[norm(row.PLATE),row]));
  const now=recifeNowIso();
  return positions.map((item)=>{
    const state=byPlate.get(norm(item.plate))||{};
    const gpsAt=String(item.updatedAt||state.LAST_GPS_AT||'');
    const stationarySince=String(state.STATIONARY_SINCE||gpsAt||'');
    return {
      ...item,
      stationarySince,
      lastMovementAt:String(state.LAST_MOVEMENT_AT||''),
      stoppedMinutes:stationarySince?minutesSinceIso(stationarySince,now):0,
      gpsAgeMinutes:gpsAt?minutesSinceIso(gpsAt,now):Number.POSITIVE_INFINITY,
    };
  });
}

const GPS_OCCURRENCE_START_DATE='2026-08-21';
const GPS_RETENTION_MINUTES=10;
const GPS_STOP_OCCURRENCE_RETAIL_MINUTES=20;
const GPS_STOP_OCCURRENCE_NETWORK_MINUTES=60;
function safeJsonObject(value){try{const parsed=JSON.parse(String(value||'{}'));return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};}catch{return {};}}
function routeProfileFromMonitoring(row={}){
  const data=safeJsonObject(row.DATA_JSON||row.dataJson||'{}');
  const explicit=textNorm(data.perfil_rota_calculado||data.perfil_rota||data.perfil||data.profile||row.profile||'');
  const route=textNorm(row.ROUTE||row.route||data.rota||data.ROTA||'');
  return explicit.includes('REDE')||/(^|_)REDES?(_|$)/.test(route)?'REDE':'VAREJO';
}
function stopOccurrenceThreshold(row={}){return routeProfileFromMonitoring(row)==='REDE'?GPS_STOP_OCCURRENCE_NETWORK_MINUTES:GPS_STOP_OCCURRENCE_RETAIL_MINUTES;}
const GPS_ACTIVE_MONITORING_STATUSES=new Set(['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO']);
function previousIsoDate(date){
  const raw=String(date||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '';
  const d=new Date(`${raw}T12:00:00Z`); d.setUTCDate(d.getUTCDate()-1); return d.toISOString().slice(0,10);
}
function nightWindowKey(gpsAt){
  const raw=gpsTimeIso(gpsAt); const date=raw.slice(0,10),hour=Number(raw.slice(11,13)),minute=Number(raw.slice(14,16));
  if(!Number.isFinite(hour)||!Number.isFinite(minute))return '';
  const total=hour*60+minute;
  if(total>=20*60)return date;
  if(total<=5*60)return previousIsoDate(date);
  return '';
}
function internalMonitoringRoute(route=''){
  const text=textNorm(route).replace(/_/g,' ');
  return /\b(CAIXA|CAIXAS|ALMOXARIFADO)\b/.test(text);
}
function isThreeQuarterType(value=''){
  return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'')==='34';
}
function nightWindowEndIso(nightKey=''){
  const raw=String(nightKey||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '';
  const d=new Date(`${raw}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+1);
  return `${d.toISOString().slice(0,10)}T05:00:00`;
}
function minWallClockIso(a,b){
  const am=wallClockMs(a),bm=wallClockMs(b);
  if(!Number.isFinite(am))return b;if(!Number.isFinite(b))return a;
  return am<=bm?a:b;
}

function nightSessionToken(row={}){
  const scheduleId=String(row.SCHEDULE_ID||row.scheduleId||'').trim();
  if(scheduleId)return `S:${scheduleId}`;
  const monitoringId=Number(row.MONITORING_ID||row.monitoringId||0);
  if(monitoringId>0)return `M:${monitoringId}`;
  return 'ROTA';
}
function hmFromIso(value=''){
  const raw=String(value||'');
  const match=raw.match(/(?:T|\s)(\d{2}:\d{2})/);
  return match?match[1]:'—';
}
function durationLabel(minutes=0){
  const total=Math.max(0,Math.round(Number(minutes||0))),h=Math.floor(total/60),m=total%60;
  return h?`${h}h ${String(m).padStart(2,'0')}min`:`${m}min`;
}
async function syncNightIgnitionOccurrence(db,{plate='',night='',scheduleId='',monitoringId=0}={}){
  const normalizedPlate=norm(plate);
  if(!normalizedPlate||!night)return null;
  const {results=[]}=await db.prepare(`SELECT * FROM ROUTE_IGNITION_OFF_NIGHT WHERE NIGHT_KEY=? AND PLATE=? ORDER BY STARTED_AT`).bind(night,normalizedPlate).all();
  const targetToken=scheduleId?`S:${String(scheduleId)}`:(Number(monitoringId||0)>0?`M:${Number(monitoringId)}`:'ROTA');
  const sessions=(results||[]).filter((row)=>nightSessionToken(row)===targetToken);
  if(!sessions.length)return null;
  const totalMinutes=sessions.reduce((sum,row)=>sum+Math.max(0,Number(row.DURATION_MINUTES||0)),0);
  const active=sessions.some((row)=>Number(row.ACTIVE||0)!==0);
  // Evita a linha de 0h00 causada pela primeira leitura no instante em que a
  // ignição é desligada. A ocorrência aparecerá assim que houver tempo observado.
  if(totalMinutes<=0)return null;
  const first=sessions[0],last=sessions[sessions.length-1];
  const occurrenceKey=`GPS_IGNITION_OFF_NIGHT|${normalizedPlate}|${night}|${targetToken.replace(/[^A-Za-z0-9:_-]/g,'_')}`;
  const intervals=sessions.map((row)=>({
    startedAt:String(row.STARTED_AT||''),
    endedAt:String(row.ENDED_AT||row.LAST_SEEN_AT||''),
    durationMinutes:Math.max(0,Number(row.DURATION_MINUTES||0)),
    location:String(row.LOCATION_TEXT||''),
    active:Number(row.ACTIVE||0)!==0,
  }));
  const intervalText=intervals.map((row)=>`${hmFromIso(row.startedAt)}–${row.active?'agora':hmFromIso(row.endedAt)} (${durationLabel(row.durationMinutes)})`).join('; ');
  const locations=[...new Set(intervals.map((row)=>row.location.trim()).filter(Boolean))];
  const details=`Ignição desligada no período entre 20:00 e 05:00. Tempo total desligada: ${durationLabel(totalMinutes)} em ${sessions.length} intervalo(s).${intervalText?` Intervalos: ${intervalText}.`:''}${locations.length?` Local(is): ${locations.join(' / ')}.`:''}`;
  const endedAt=active?'':String(last.ENDED_AT||last.LAST_SEEN_AT||'');
  const payload={active,endedAt,intervalCount:sessions.length,intervals};
  await db.prepare(`INSERT INTO ROUTE_GPS_OCCURRENCES
    (OCCURRENCE_KEY,TYPE,PRIORITY,DATE_KEY,PLATE,ROUTE,DRIVER_NAME,SCHEDULE_ID,MONITORING_ID,STARTED_AT,DETECTED_AT,LAST_SEEN_AT,LOCATION_TEXT,LATITUDE,LONGITUDE,STOPPED_MINUTES,IGNITION,DETAILS,DATA_JSON,UPDATED_AT)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(OCCURRENCE_KEY) DO UPDATE SET ROUTE=excluded.ROUTE,DRIVER_NAME=excluded.DRIVER_NAME,SCHEDULE_ID=excluded.SCHEDULE_ID,MONITORING_ID=excluded.MONITORING_ID,STARTED_AT=excluded.STARTED_AT,LAST_SEEN_AT=excluded.LAST_SEEN_AT,LOCATION_TEXT=excluded.LOCATION_TEXT,STOPPED_MINUTES=excluded.STOPPED_MINUTES,IGNITION=excluded.IGNITION,DETAILS=excluded.DETAILS,DATA_JSON=excluded.DATA_JSON,UPDATED_AT=CURRENT_TIMESTAMP`).bind(
      occurrenceKey,'IGNICAO_DESLIGADA_20_05','ALTA',night,normalizedPlate,String(last.ROUTE||first.ROUTE||''),String(last.DRIVER_NAME||first.DRIVER_NAME||''),String(last.SCHEDULE_ID||first.SCHEDULE_ID||''),Number(last.MONITORING_ID||first.MONITORING_ID||0)||null,String(first.STARTED_AT||''),String(first.STARTED_AT||''),String(last.LAST_SEEN_AT||last.ENDED_AT||''),String(last.LOCATION_TEXT||first.LOCATION_TEXT||''),last.LATITUDE??first.LATITUDE??null,last.LONGITUDE??first.LONGITUDE??null,Math.round(totalMinutes),active?0:1,details,JSON.stringify(payload)
    ).run();
  // Limpa ocorrências antigas fragmentadas da mesma viagem/noite. As sessões
  // continuam preservadas em ROUTE_IGNITION_OFF_NIGHT para auditoria dos intervalos.
  const stale=(await db.prepare(`SELECT OCCURRENCE_KEY,SCHEDULE_ID,MONITORING_ID FROM ROUTE_GPS_OCCURRENCES WHERE TYPE='IGNICAO_DESLIGADA_20_05' AND DATE_KEY=? AND PLATE=? AND OCCURRENCE_KEY<>?`).bind(night,normalizedPlate,occurrenceKey).all()).results||[];
  const staleKeys=stale.filter((row)=>nightSessionToken(row)===targetToken).map((row)=>String(row.OCCURRENCE_KEY||'')).filter(Boolean);
  for(const key of staleKeys)await db.prepare(`DELETE FROM ROUTE_GPS_OCCURRENCES WHERE OCCURRENCE_KEY=?`).bind(key).run();
  return {occurrenceKey,plate:normalizedPlate,night,totalMinutes,intervalCount:sessions.length,active};
}
const gpsLookupCache={activeAt:0,active:null,vehiclesAt:0,vehicles:null};
async function activeMonitoringByPlate(db){
  try{
    if(gpsLookupCache.active&&Date.now()-gpsLookupCache.activeAt<8000)return gpsLookupCache.active;
    const placeholders=[...GPS_ACTIVE_MONITORING_STATUSES].map(()=>'?').join(',');
    const since=new Date(Date.now()-45*86400000).toISOString().slice(0,10);
    const {results=[]}=await db.prepare(`SELECT ID,SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON FROM ROUTE_MONITORING WHERE STATUS IN (${placeholders}) AND DATE_KEY>=? ORDER BY ID DESC LIMIT 1000`).bind(...GPS_ACTIVE_MONITORING_STATUSES,since).all();
    const map=new Map();
    for(const row of results||[]){
      const plate=norm(row.PLATE||'');
      if(!plate||map.has(plate)||isOperationallyExcludedPlate(plate)||internalMonitoringRoute(row.ROUTE||''))continue;
      const profile=routeProfileFromMonitoring(row);
      map.set(plate,{id:Number(row.ID||0)||null,scheduleId:String(row.SCHEDULE_ID||''),date:String(row.DATE_KEY||''),status:String(row.STATUS||''),plate,driver:String(row.DRIVER_NAME||''),route:String(row.ROUTE||''),profile,data:safeJsonObject(row.DATA_JSON||'{}')});
    }
    gpsLookupCache.active=map;gpsLookupCache.activeAt=Date.now();return map;
  }catch{return new Map();}
}
function occurrenceDetails(type,item,monitor){
  const location=String(item.point||item.location||'Localização não informada').trim();
  if(type==='PARADA_ACIMA_20_MIN'){
    const threshold=stopOccurrenceThreshold(monitor||{}),profile=routeProfileFromMonitoring(monitor||{});
    return `Parada a partir de ${threshold} minutos (${profile}): veículo parado há ${Math.max(0,Math.round(Number(item.stoppedMinutes||0)))} min. Local: ${location}.`;
  }
  return `Ignição desligada no período entre 20:00 e 05:00. Horário GPS: ${gpsTimeIso(item.updatedAt).slice(11,16)}. Local: ${location}.`;
}
export async function recordGpsOperationalOccurrences(db,positions=[]){
  await ensureProtectSatSchema(db);
  if(!Array.isArray(positions)||!positions.length)return [];
  const active=await activeMonitoringByPlate(db);
  if(!active.size)return [];
  const vehicles=await readRegisteredVehicles(db);
  const inserted=[];
  for(const item of positions){
    const plate=norm(item?.plate||''); const monitor=active.get(plate); if(!monitor)continue;
    const gpsAt=gpsTimeIso(item.updatedAt); const date=gpsAt.slice(0,10);
    if(date<GPS_OCCURRENCE_START_DATE)continue;
    const age=Number(item.gpsAgeMinutes); if(Number.isFinite(age)&&age>20)continue;
    const candidates=[];
    const started=gpsTimeIso(item.stationarySince||gpsAt);
    // O limiar da ocorrência usa o tempo efetivamente observado pelos timestamps
    // do GPS. Retenções menores continuam sendo registradas em ROUTE_GPS_RETENTIONS
    // para os indicadores, mas não abrem pendência operacional.
    const stopped=Math.max(0,minutesSinceIso(started,gpsAt));
    const occurrenceItem={...item,stoppedMinutes:stopped};
    const stopThreshold=stopOccurrenceThreshold(monitor),routeProfile=routeProfileFromMonitoring(monitor);
    if(stopped>=stopThreshold){
      candidates.push({type:'PARADA_ACIMA_20_MIN',priority:'MÉDIA',started,key:`GPS_STOP_${stopThreshold}|${plate}|${started}`,details:occurrenceDetails('PARADA_ACIMA_20_MIN',occurrenceItem,monitor),stopThreshold,routeProfile});
    }
    // A ignição noturna é consolidada em recordNightIgnitionSessions().
    // Mantemos aqui apenas ocorrências de parada. Isso evita criar uma ocorrência
    // a cada leitura GPS com ignição desligada durante a mesma noite.
    for(const event of candidates){
      const result=await db.prepare(`INSERT INTO ROUTE_GPS_OCCURRENCES
        (OCCURRENCE_KEY,TYPE,PRIORITY,DATE_KEY,PLATE,ROUTE,DRIVER_NAME,SCHEDULE_ID,MONITORING_ID,STARTED_AT,DETECTED_AT,LAST_SEEN_AT,LOCATION_TEXT,LATITUDE,LONGITUDE,STOPPED_MINUTES,IGNITION,DETAILS,DATA_JSON,UPDATED_AT)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(OCCURRENCE_KEY) DO UPDATE SET LAST_SEEN_AT=excluded.LAST_SEEN_AT,LOCATION_TEXT=excluded.LOCATION_TEXT,LATITUDE=excluded.LATITUDE,LONGITUDE=excluded.LONGITUDE,STOPPED_MINUTES=excluded.STOPPED_MINUTES,IGNITION=excluded.IGNITION,DETAILS=excluded.DETAILS,UPDATED_AT=CURRENT_TIMESTAMP`).bind(
          event.key,event.type,event.priority,date,plate,monitor.route,monitor.driver,monitor.scheduleId,monitor.id,event.started,gpsAt,gpsAt,String(item.point||item.location||''),item.latitude??null,item.longitude??null,stopped,Number(item.ignition||0),event.details,JSON.stringify({nearbyClients:item.nearbyClients||[],monitoringStatus:monitor.status,active:true,routeProfile:event.routeProfile||routeProfileFromMonitoring(monitor),stopThresholdMinutes:Number(event.stopThreshold||stopOccurrenceThreshold(monitor))})
        ).run();
      inserted.push({key:event.key,type:event.type,plate,created:Number(result.meta?.changes||0)>0});
    }
  }
  return inserted;
}

export async function recordRouteClientArrivals(db,positions=[]){
  await ensureProtectSatSchema(db);
  if(!Array.isArray(positions)||!positions.length)return {arrivals:0,departures:0};
  const active=await activeMonitoringByPlate(db);
  const {results:openRows=[]}=await db.prepare(`SELECT ID,SCHEDULE_ID,PLATE,CLIENT_ID,CLIENT_NAME,ARRIVED_AT,LAST_SEEN_AT FROM ROUTE_CLIENT_ARRIVALS WHERE LEFT_AT IS NULL`).all();
  const openByPlate=new Map();
  for(const row of openRows||[]){const plate=norm(row.PLATE||'');if(!openByPlate.has(plate))openByPlate.set(plate,[]);openByPlate.get(plate).push(row);}
  const latestByTripPlate=new Map();
  const activeSchedules=[...new Set([...active.values()].map((row)=>String(row?.scheduleId||'').trim()).filter(Boolean))];
  if(activeSchedules.length){
    const placeholders=activeSchedules.map(()=>'?').join(',');
    const {results:latestRows=[]}=await db.prepare(`SELECT SCHEDULE_ID,PLATE,MAX(CASE WHEN COALESCE(LEFT_AT,'')>COALESCE(LAST_SEEN_AT,'') THEN LEFT_AT ELSE LAST_SEEN_AT END) LATEST_AT FROM ROUTE_CLIENT_ARRIVALS WHERE SCHEDULE_ID IN (${placeholders}) GROUP BY SCHEDULE_ID,PLATE`).bind(...activeSchedules).all();
    for(const row of latestRows||[])latestByTripPlate.set(`${String(row.SCHEDULE_ID||'')}|${norm(row.PLATE||'')}`,String(row.LATEST_AT||''));
  }
  let arrivals=0,departures=0,ignoredOutOfOrder=0;
  for(const item of positions){
    const plate=norm(item?.plate||''); if(!plate)continue;
    const gpsAt=gpsTimeIso(item.updatedAt),monitor=active.get(plate)||null;
    const tripKey=monitor?`${String(monitor.scheduleId||'')}|${plate}`:'';
    const latestAt=tripKey?(latestByTripPlate.get(tripKey)||''):'';
    if(latestAt&&gpsAt<latestAt){ignoredOutOfOrder+=1;continue;}
    const currentClients=monitor?(Array.isArray(item.nearbyClients)?item.nearbyClients:[]).filter((client)=>Number(client.distanceMeters??client.distance)<=NEARBY_CLIENT_RADIUS_METERS).sort((a,b)=>Number(a.distanceMeters??a.distance??0)-Number(b.distanceMeters??b.distance??0)).slice(0,1):[];
    const currentIds=new Set(currentClients.map((client)=>String(client.id||client.code||client.name||'').trim()).filter(Boolean));
    const openForPlate=openByPlate.get(plate)||[];
    for(const row of openForPlate){
      const sameSchedule=monitor&&String(row.SCHEDULE_ID||'')===String(monitor.scheduleId||'');
      if(!sameSchedule||!currentIds.has(String(row.CLIENT_ID||''))){
        await db.prepare(`UPDATE ROUTE_CLIENT_ARRIVALS SET LEFT_AT=?,LAST_SEEN_AT=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=? AND LEFT_AT IS NULL`).bind(gpsAt,gpsAt,row.ID).run();
        departures+=1;
      }
    }
    if(!monitor)continue;
    for(const client of currentClients){
      const clientId=String(client.id||client.code||client.name||'').trim(); if(!clientId)continue;
      const existing=openForPlate.find((row)=>String(row.SCHEDULE_ID||'')===String(monitor.scheduleId||'')&&String(row.CLIENT_ID||'')===clientId);
      if(existing){
        await db.prepare(`UPDATE ROUTE_CLIENT_ARRIVALS SET LAST_SEEN_AT=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=? AND LEFT_AT IS NULL`).bind(gpsAt,existing.ID).run();
        continue;
      }
      try{
        const result=await db.prepare(`INSERT INTO ROUTE_CLIENT_ARRIVALS (SCHEDULE_ID,PLATE,CLIENT_ID,CLIENT_NAME,ARRIVED_AT,LAST_SEEN_AT,LATITUDE,LONGITUDE,ARRIVAL_DISTANCE_METERS,UPDATED_AT) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(
          monitor.scheduleId,plate,clientId,String(client.name||client.nome||client.code||'Cliente'),gpsAt,gpsAt,item.latitude??null,item.longitude??null,Math.max(0,Math.round(Number(client.distanceMeters||0)))
        ).run();
        if(Number(result.meta?.changes||0)>0)arrivals+=1;
      }catch(error){
        if(!String(error?.message||error).toLowerCase().includes('unique'))throw error;
      }
    }
    if(tripKey)latestByTripPlate.set(tripKey,gpsAt);
  }
  return {arrivals,departures,ignoredOutOfOrder};
}

export async function recordNightIgnitionSessions(db,positions=[]){
  await ensureProtectSatSchema(db);
  if(!Array.isArray(positions)||!positions.length)return [];
  const active=await activeMonitoringByPlate(db),vehicles=await readRegisteredVehicles(db);
  const {results:openRows=[]}=await db.prepare(`SELECT * FROM ROUTE_IGNITION_OFF_NIGHT WHERE ACTIVE=1`).all();
  const openByPlate=new Map();for(const row of openRows||[]){const plate=norm(row.PLATE||'');if(!openByPlate.has(plate))openByPlate.set(plate,[]);openByPlate.get(plate).push(row);}
  const changed=[];
  const occurrenceGroups=new Map();
  const rememberGroup=(row={})=>{
    const groupNight=String(row.NIGHT_KEY||row.night||'').trim(),groupPlate=norm(row.PLATE||row.plate||'');
    if(!groupNight||!groupPlate)return;
    const schedule=String(row.SCHEDULE_ID||row.scheduleId||'').trim(),monitorId=Number(row.MONITORING_ID||row.monitoringId||0)||0;
    const token=schedule?`S:${schedule}`:(monitorId?`M:${monitorId}`:'ROTA');
    occurrenceGroups.set(`${groupNight}|${groupPlate}|${token}`,{night:groupNight,plate:groupPlate,scheduleId:schedule,monitoringId:monitorId});
  };
  for(const item of positions){
    const plate=norm(item?.plate||'');if(!plate)continue;
    const gpsAt=gpsTimeIso(item.updatedAt),monitor=active.get(plate)||null,vehicle=vehicles.get(plate)||null;
    const night=nightWindowKey(gpsAt),eligible=isThreeQuarterType(vehicle?.type),ignitionOff=Number(item.ignition)===0;
    const scheduleId=String(monitor?.scheduleId||'');
    const monitoringId=Number(monitor?.id||0);
    const openForPlate=openByPlate.get(plate)||[];
    const existing=openForPlate.find((row)=>{
      if(!monitor||!eligible||!night||!ignitionOff||String(row.NIGHT_KEY||'')!==night)return false;
      const rowScheduleId=String(row.SCHEDULE_ID||'');
      if(scheduleId&&rowScheduleId)return rowScheduleId===scheduleId;
      return Number(row.MONITORING_ID||0)===monitoringId;
    })||null;
    for(const row of openForPlate){
      if(existing&&String(row.SESSION_KEY||'')===String(existing.SESSION_KEY||''))continue;
      const end=minWallClockIso(gpsAt,nightWindowEndIso(row.NIGHT_KEY)||gpsAt);
      const duration=minutesSinceIso(row.STARTED_AT,end);
      await db.prepare(`UPDATE ROUTE_IGNITION_OFF_NIGHT SET ENDED_AT=?,LAST_SEEN_AT=?,DURATION_MINUTES=?,ACTIVE=0,UPDATED_AT=CURRENT_TIMESTAMP WHERE SESSION_KEY=?`).bind(end,end,duration,row.SESSION_KEY).run();
      changed.push({sessionKey:row.SESSION_KEY,plate,active:false,durationMinutes:duration});
      rememberGroup(row);
      const remaining=(openByPlate.get(plate)||[]).filter((candidate)=>String(candidate.SESSION_KEY||'')!==String(row.SESSION_KEY||''));
      openByPlate.set(plate,remaining);
    }
    if(!monitor||!eligible||!night||!ignitionOff)continue;
    const started=existing?.STARTED_AT||gpsAt;
    const scheduleToken=monitor.scheduleId||monitor.id||'ROTA';
    // Cada novo desligamento ganha uma chave própria. Assim, se a ignição ligar e
    // desligar novamente na mesma noite, o intervalo ligado não entra na duração.
    const sessionKey=existing?.SESSION_KEY||`GPS_IGNITION_NIGHT|${plate}|${night}|${scheduleToken}|${gpsAt}`;
    const duration=minutesSinceIso(started,gpsAt),location=String(item.point||item.location||'');
    await db.prepare(`INSERT INTO ROUTE_IGNITION_OFF_NIGHT (SESSION_KEY,NIGHT_KEY,PLATE,VEHICLE_TYPE,SCHEDULE_ID,MONITORING_ID,ROUTE,DRIVER_NAME,STARTED_AT,LAST_SEEN_AT,DURATION_MINUTES,ACTIVE,LOCATION_TEXT,LATITUDE,LONGITUDE,UPDATED_AT) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(SESSION_KEY) DO UPDATE SET LAST_SEEN_AT=excluded.LAST_SEEN_AT,DURATION_MINUTES=excluded.DURATION_MINUTES,ACTIVE=1,ENDED_AT=NULL,LOCATION_TEXT=excluded.LOCATION_TEXT,LATITUDE=excluded.LATITUDE,LONGITUDE=excluded.LONGITUDE,UPDATED_AT=CURRENT_TIMESTAMP`).bind(
        sessionKey,night,plate,String(vehicle?.type||'3/4'),monitor.scheduleId,monitor.id,monitor.route,monitor.driver,started,gpsAt,duration,1,location,item.latitude??null,item.longitude??null
      ).run();
    const trackedRow={
      ...(existing||{}),SESSION_KEY:sessionKey,NIGHT_KEY:night,PLATE:plate,VEHICLE_TYPE:String(vehicle?.type||'3/4'),
      SCHEDULE_ID:monitor.scheduleId,MONITORING_ID:monitor.id,ROUTE:monitor.route,DRIVER_NAME:monitor.driver,
      STARTED_AT:started,LAST_SEEN_AT:gpsAt,ENDED_AT:null,DURATION_MINUTES:duration,ACTIVE:1,
      LOCATION_TEXT:location,LATITUDE:item.latitude??null,LONGITUDE:item.longitude??null,
    };
    const tracked=(openByPlate.get(plate)||[]).filter((row)=>String(row.SESSION_KEY||'')!==String(sessionKey));
    tracked.push(trackedRow);openByPlate.set(plate,tracked);
    changed.push({sessionKey,plate,active:true,durationMinutes:duration});
    rememberGroup(trackedRow);
  }
  for(const group of occurrenceGroups.values()){
    try{const occurrence=await syncNightIgnitionOccurrence(db,group);if(occurrence)changed.push({...occurrence,consolidated:true});}
    catch(error){console.error('night ignition consolidated occurrence warning',error);}
  }
  return changed;
}

const NEARBY_CLIENT_RADIUS_METERS=100;

async function readRegisteredVehicles(db) {
  if(gpsLookupCache.vehicles&&Date.now()-gpsLookupCache.vehiclesAt<30000)return gpsLookupCache.vehicles;
  if (!(await tableExists(db,'BASE_VEICULOS'))) return new Map();
  const { results } = await db.prepare(`SELECT ID,PLACA,TIPO,VINCULO,STATUS,ATIVO FROM BASE_VEICULOS`).all();
  const map = new Map();
  for (const row of results || []) {
    const plate = norm(row.PLACA || '');
    const active = Number(row.ATIVO ?? 1) !== 0 && !['INATIVO','DESLIGADO'].includes(textNorm(row.STATUS || ''));
    if (!plate || !active) continue;
    map.set(plate, { id:String(row.ID || ''), plate, type:String(row.TIPO || ''), status:String(row.STATUS || ''), vinculo:String(row.VINCULO || '') });
  }
  gpsLookupCache.vehicles=map;gpsLookupCache.vehiclesAt=Date.now();return map;
}

async function readClients(db) {
  if (!(await tableExists(db,'BASE_CLIENTES'))) return [];
  const { results } = await db.prepare(`SELECT ID,CODIGO,NOME,LATITUDE,LONGITUDE,RAIO_METROS,CIDADE,UF,ENDERECO,OBSERVACOES FROM BASE_CLIENTES WHERE ATIVO=1 ORDER BY NOME`).all();
  return (results || []).map((row) => ({
    id:String(row.ID || ''), code:String(row.CODIGO || ''), name:String(row.NOME || ''),
    latitude:Number(row.LATITUDE), longitude:Number(row.LONGITUDE), radiusMeters:NEARBY_CLIENT_RADIUS_METERS,
    city:String(row.CIDADE || ''), state:String(row.UF || ''), address:String(row.ENDERECO || ''), notes:String(row.OBSERVACOES || ''),
  })).filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (value) => value * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function nearbyClientsFor(positionRow, clients) {
  const lat = Number(positionRow?.latitude); const lng = Number(positionRow?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Array.isArray(clients) || !clients.length) return [];
  return clients.map((client) => {
    const meters = distanceMeters(lat, lng, Number(client.latitude), Number(client.longitude));
    return { ...client, distanceMeters: Math.round(meters) };
  }).filter((client) => client.distanceMeters <= NEARBY_CLIENT_RADIUS_METERS).sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,1);
}
function enrichWithClients(positions, clients) {
  return (positions || []).map((item) => ({ ...item, nearbyClients: nearbyClientsFor(item, clients) }));
}

function clientFromRow(row) {
  return {
    id:String(row.ID || ''), code:String(row.CODIGO || ''), name:String(row.NOME || ''),
    latitude:Number(row.LATITUDE), longitude:Number(row.LONGITUDE), radiusMeters:NEARBY_CLIENT_RADIUS_METERS,
    city:String(row.CIDADE || ''), state:String(row.UF || ''), address:String(row.ENDERECO || ''),
    businessUnit:String(row.UNIDADE_NEGOCIO || ''),
  };
}

const nearbyClientCache=new Map();const NEARBY_CLIENT_CACHE_MS=120000;
let tripClientScopeCache={at:0,map:new Map()};
async function activeTripClientScopeByPlate(db){
  if(tripClientScopeCache.map.size&&Date.now()-tripClientScopeCache.at<30000)return tripClientScopeCache.map;
  const active=await activeMonitoringByPlate(db);
  const result=new Map();
  if(!active.size||!(await tableExists(db,'LINCROS_DELIVERIES'))){tripClientScopeCache={at:Date.now(),map:result};return result;}
  const schedules=[...new Set([...active.values()].map((row)=>String(row.scheduleId||'').trim()).filter(Boolean))];
  if(!schedules.length){tripClientScopeCache={at:Date.now(),map:result};return result;}
  const bySchedule=new Map();
  for(let i=0;i<schedules.length;i+=80){
    const chunk=schedules.slice(i,i+80),placeholders=chunk.map(()=>'?').join(',');
    const query=await db.prepare(`SELECT SCHEDULE_ID,CLIENT_CODE,CLIENT_NAME FROM LINCROS_DELIVERIES WHERE SCHEDULE_ID IN (${placeholders})`).bind(...chunk).all();
    for(const row of query.results||[]){
      const scheduleId=String(row.SCHEDULE_ID||'').trim();if(!scheduleId)continue;
      if(!bySchedule.has(scheduleId))bySchedule.set(scheduleId,{codes:new Set(),names:new Set()});
      const scope=bySchedule.get(scheduleId),code=norm(row.CLIENT_CODE||''),name=textNorm(row.CLIENT_NAME||'');
      if(code)scope.codes.add(code);if(name)scope.names.add(name);
    }
  }
  for(const [plate,monitor] of active){
    const scope=bySchedule.get(String(monitor.scheduleId||''))||{codes:new Set(),names:new Set()};
    result.set(plate,{...scope,scheduleId:String(monitor.scheduleId||''),route:String(monitor.route||'')});
  }
  tripClientScopeCache={at:Date.now(),map:result};return result;
}
function clientBelongsToTrip(client,scope){
  if(!scope)return false;
  const code=norm(client?.code||client?.id||''),name=textNorm(client?.name||'');
  return Boolean((code&&scope.codes?.has(code))||(name&&scope.names?.has(name)));
}
export async function enrichWithNearbyClients(db, positions) {
  const source=(positions||[]).map((item)=>({ ...item, nearbyClients:[] }));
  const now=Date.now(),tripScopes=await activeTripClientScopeByPlate(db);
  const valid=source.map((item,index)=>{const plate=norm(item.plate||''),scope=tripScopes.get(plate)||null;return {item,index,plate,scope,lat:Number(item.latitude),lng:Number(item.longitude),key:`${plate}|${scope?.scheduleId||'SEM_VIAGEM'}|${String(item.updatedAt||'')}|${Number(item.latitude).toFixed(5)}|${Number(item.longitude).toFixed(5)}`};})
    .filter((entry)=>Number.isFinite(entry.lat)&&Number.isFinite(entry.lng)&&entry.scope&&(entry.scope.codes?.size||entry.scope.names?.size));
  if(!valid.length || !(await tableExists(db,'BASE_CLIENTES'))) return source;
  const pending=[];
  for(const entry of valid){
    const cached=nearbyClientCache.get(entry.key);
    if(cached&&now-cached.at<=NEARBY_CLIENT_CACHE_MS){source[entry.index].nearbyClients=cached.clients;continue;}
    pending.push(entry);
  }
  if(!pending.length)return source;
  const statements=pending.map((entry)=>{
    const latMargin=NEARBY_CLIENT_RADIUS_METERS/110540;
    const lngMargin=NEARBY_CLIENT_RADIUS_METERS/Math.max(27830,111320*Math.cos(entry.lat*Math.PI/180));
    return db.prepare(`
      SELECT ID,CODIGO,NOME,LATITUDE,LONGITUDE,RAIO_METROS,CIDADE,UF,ENDERECO,UNIDADE_NEGOCIO
      FROM BASE_CLIENTES
      WHERE ATIVO=1
        AND LATITUDE BETWEEN ? AND ?
        AND LONGITUDE BETWEEN ? AND ?
      LIMIT 80
    `).bind(entry.lat-latMargin,entry.lat+latMargin,entry.lng-lngMargin,entry.lng+lngMargin);
  });
  const batches=[];for(let i=0;i<statements.length;i+=40)batches.push(...await db.batch(statements.slice(i,i+40)));
  pending.forEach((entry,i)=>{
    const candidates=(batches[i]?.results||[]).map(clientFromRow).filter((client)=>clientBelongsToTrip(client,entry.scope));
    const clients=nearbyClientsFor(entry.item,candidates);source[entry.index].nearbyClients=clients;
    nearbyClientCache.set(entry.key,{at:now,clients});
  });
  while(nearbyClientCache.size>500)nearbyClientCache.delete(nearbyClientCache.keys().next().value);
  return source;
}

async function storeHistory(db, positions) {
  await ensureProtectSatSchema(db);
  const valid=(positions||[]).filter((item)=>item?.plate);
  if(!valid.length)return;
  const statements=[];
  for(const item of valid){
    const plate=norm(item.plate),gpsAt=gpsTimeIso(item.updatedAt);
    const rawJson=JSON.stringify({...(item.raw || {}),__DMS_TIMESTAMP_SOURCE:item.timestampSource||'',__DMS_TIMESTAMP_RELIABLE:item.timestampReliable!==false,__DMS_DETECTED_AT:item.detectedAt||recifeNowIso(),__DMS_DISTANCE_TO_POINT:item.distanceToPoint??null});
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO ROUTE_GPS_POSITIONS
        (PLATE,LATITUDE,LONGITUDE,GPS_TIME,FETCHED_AT,LOCATION_TEXT,POINT_TEXT,SPEED,IGNITION,VEHICLE_ID,VEHICLE_TYPE,RAW_JSON)
      VALUES (?,?,?,?,CURRENT_TIMESTAMP,?,?,?,?,?,?,?)
    `).bind(plate,item.latitude??null,item.longitude??null,gpsAt,item.location||'',item.point||'',Number(item.speed||0),Number(item.ignition||0),item.vehicleId||null,item.vehicleType||null,rawJson));
    statements.push(db.prepare(`
      INSERT INTO ROUTE_GPS_LATEST
        (PLATE,LATITUDE,LONGITUDE,GPS_TIME,FETCHED_AT,LOCATION_TEXT,POINT_TEXT,SPEED,IGNITION,VEHICLE_ID,VEHICLE_TYPE,DISTANCE_TO_POINT,RAW_JSON,UPDATED_AT)
      VALUES (?,?,?,?,CURRENT_TIMESTAMP,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(PLATE) DO UPDATE SET
        LATITUDE=excluded.LATITUDE,LONGITUDE=excluded.LONGITUDE,GPS_TIME=excluded.GPS_TIME,FETCHED_AT=CURRENT_TIMESTAMP,
        LOCATION_TEXT=excluded.LOCATION_TEXT,POINT_TEXT=excluded.POINT_TEXT,SPEED=excluded.SPEED,IGNITION=excluded.IGNITION,
        VEHICLE_ID=excluded.VEHICLE_ID,VEHICLE_TYPE=excluded.VEHICLE_TYPE,DISTANCE_TO_POINT=excluded.DISTANCE_TO_POINT,
        RAW_JSON=excluded.RAW_JSON,UPDATED_AT=CURRENT_TIMESTAMP
      WHERE excluded.GPS_TIME>=ROUTE_GPS_LATEST.GPS_TIME
    `).bind(plate,item.latitude??null,item.longitude??null,gpsAt,item.location||'',item.point||'',Number(item.speed||0),Number(item.ignition||0),item.vehicleId||null,item.vehicleType||null,item.distanceToPoint??null,rawJson));
  }
  for(let i=0;i<statements.length;i+=40)await db.batch(statements.slice(i,i+40));
}

async function readHistory(db, plate, hours) {
  await ensureProtectSatSchema(db);
  const { results } = await db.prepare(`
    SELECT PLATE,LATITUDE,LONGITUDE,GPS_TIME,LOCATION_TEXT,POINT_TEXT,SPEED,IGNITION,VEHICLE_ID,VEHICLE_TYPE,RAW_JSON
    FROM ROUTE_GPS_POSITIONS
    WHERE PLATE=? AND GPS_TIME>=?
    ORDER BY GPS_TIME DESC, ID DESC
  `).bind(norm(plate), isoHoursAgo(hours)).all();
  const positions = (results || []).map((row) => {let raw={};try{raw=JSON.parse(String(row.RAW_JSON||'{}'))||{};}catch{}return {
    plate:String(row.PLATE || ''), latitude:row.LATITUDE, longitude:row.LONGITUDE, updatedAt:String(row.GPS_TIME || ''),
    location:String(row.LOCATION_TEXT || ''), point:String(row.POINT_TEXT || ''), speed:Number(row.SPEED || 0), ignition:Number(row.IGNITION || 0),
    vehicleId:String(row.VEHICLE_ID || ''), vehicleType:String(row.VEHICLE_TYPE || ''),source:String(raw.__DMS_SOURCE||'PROTECTSAT'),speedReliable:String(raw.__DMS_SOURCE||'PROTECTSAT')!=='LINCROS',ignitionReliable:String(raw.__DMS_SOURCE||'PROTECTSAT')!=='LINCROS',
  };});
  return positions;
}

async function readLatestStoredPositions(db, registeredVehiclesOrPlates) {
  await ensureProtectSatSchema(db);
  let results=[];
  try{
    const latest=await db.prepare(`SELECT PLATE,LATITUDE,LONGITUDE,GPS_TIME,FETCHED_AT,LOCATION_TEXT,POINT_TEXT,SPEED,IGNITION,VEHICLE_ID,VEHICLE_TYPE,DISTANCE_TO_POINT,RAW_JSON,
      CASE WHEN FETCHED_AT IS NULL THEN NULL ELSE CAST((julianday('now')-julianday(FETCHED_AT))*1440 AS INTEGER) END AS API_FETCH_AGE_MINUTES
      FROM ROUTE_GPS_LATEST ORDER BY PLATE`).all();
    results=latest.results||[];
  }catch{}
  // Compatibilidade e contingência: completa ROUTE_GPS_LATEST com a última posição
  // histórica das placas que ainda não entraram na tabela compacta. Isso garante que uma
  // placa com rastreador continue aparecendo na última posição ProtectSat conhecida,
  // mesmo quando ela não veio na leitura atual ou houve desencontro com BASE_VEICULOS.
  try{
    const legacyMissing=await db.prepare(`
      SELECT p.PLATE,p.LATITUDE,p.LONGITUDE,p.GPS_TIME,p.FETCHED_AT,p.LOCATION_TEXT,p.POINT_TEXT,p.SPEED,p.IGNITION,p.VEHICLE_ID,p.VEHICLE_TYPE,NULL AS DISTANCE_TO_POINT,p.RAW_JSON,
             CASE WHEN p.FETCHED_AT IS NULL THEN NULL ELSE CAST((julianday('now')-julianday(p.FETCHED_AT))*1440 AS INTEGER) END AS API_FETCH_AGE_MINUTES
      FROM ROUTE_GPS_POSITIONS p
      INNER JOIN (SELECT PLATE,MAX(ID) AS MAX_ID FROM ROUTE_GPS_POSITIONS GROUP BY PLATE) h ON h.MAX_ID=p.ID
      LEFT JOIN ROUTE_GPS_LATEST l ON l.PLATE=p.PLATE
      WHERE l.PLATE IS NULL
      ORDER BY p.PLATE
    `).all();
    if((legacyMissing.results||[]).length)results=[...results,...legacyMissing.results];
  }catch{}
  const vehicleMap=registeredVehiclesOrPlates instanceof Map?registeredVehiclesOrPlates:new Map();
  const positions=(results||[]).map((row)=>{
    let raw={};try{raw=JSON.parse(row.RAW_JSON||'{}');}catch{}
    const updatedAt=String(row.GPS_TIME||'');
    const gpsAgeMinutes=updatedAt?minutesSinceIso(updatedAt):null;
    const apiFetchAgeMinutes=row.API_FETCH_AGE_MINUTES===null||row.API_FETCH_AGE_MINUTES===undefined?null:Math.max(0,Number(row.API_FETCH_AGE_MINUTES));
    return {
      plate:String(row.PLATE||''),latitude:row.LATITUDE,longitude:row.LONGITUDE,updatedAt,
      fetchedAt:String(row.FETCHED_AT||''),apiFetchAgeMinutes,gpsAgeMinutes,
      apiStatus:apiFetchAgeMinutes!==null&&apiFetchAgeMinutes>15?'STALE_API':gpsAgeMinutes!==null&&gpsAgeMinutes>20?'STALE_GPS':'OK',
      source:String(raw.__DMS_SOURCE||'PROTECTSAT'),timestampSource:String(raw.__DMS_TIMESTAMP_SOURCE||''),timestampReliable:raw.__DMS_TIMESTAMP_RELIABLE!==false,
      location:String(row.LOCATION_TEXT||''),point:String(row.POINT_TEXT||''),speed:Number(row.SPEED||0),ignition:Number(row.IGNITION||0),
      vehicleId:String(row.VEHICLE_ID||''),vehicleType:String(row.VEHICLE_TYPE||''),distanceToPoint:row.DISTANCE_TO_POINT===null||row.DISTANCE_TO_POINT===undefined?null:Number(row.DISTANCE_TO_POINT),
      registeredVehicleType:String(vehicleMap.get(norm(row.PLATE||''))?.type||''),raw,
    };
  }).filter((item)=>item.plate);
  return attachGpsMotionState(db,await enrichWithNearbyClients(db,positions));
}

let latestAssignmentCache={at:0,map:new Map()};
function assignmentJson(value){try{const parsed=JSON.parse(String(value||'{}'));return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};}catch{return {};}}
function assignmentStatusFinal(value){return ['CANCELADO'].includes(textNorm(value));}
export async function latestScheduleAssignments(db){
  if(latestAssignmentCache.map.size&&Date.now()-latestAssignmentCache.at<30000)return latestAssignmentCache.map;
  const [legacy,generic,lastDrivers]=await Promise.all([
    db.prepare(`SELECT * FROM ESCALAS_DIA WHERE TRIM(COALESCE(PLACA,''))<>'' ORDER BY DATA DESC,ID DESC LIMIT 20000`).all().catch(()=>({results:[]})),
    db.prepare(`SELECT ID,DATE_KEY,STATUS,DATA_JSON,CREATED_AT,UPDATED_AT FROM ROUTE_RECORDS WHERE MODULE='schedule' ORDER BY DATE_KEY DESC,ID DESC LIMIT 20000`).all().catch(()=>({results:[]})),
    db.prepare(`SELECT PLATE,DRIVER_ID,DRIVER_NAME,SCHEDULE_ID,EFFECTIVE_AT FROM ROUTE_VEHICLE_LAST_DRIVER`).all().catch(()=>({results:[]})),
  ]);
  const candidates=[];
  for(const row of legacy.results||[]){
    if(assignmentStatusFinal(row.STATUS))continue;const plate=norm(row.PLACA);if(!plate)continue;
    candidates.push({plate,scheduleId:String(row.ID||''),date:String(row.DATA||'').slice(0,10),updatedAt:String(row.ATUALIZADO_EM||row.CRIADO_EM||''),motoristaId:String(row.MOTORISTA_ID||''),motorista:String(row.MOTORISTA||''),rota:String(row.ROTA||row.DESTINO||''),regiao:String(row.REGIAO||''),status:String(row.STATUS||''),source:'ESCALAS_DIA'});
  }
  for(const row of generic.results||[]){
    const data=assignmentJson(row.DATA_JSON);if(assignmentStatusFinal(row.STATUS||data.status))continue;const plate=norm(data.placa||data.PLACA);if(!plate)continue;
    candidates.push({plate,scheduleId:String(data.schedule_record_id||data.escala_id||row.ID||''),date:String(data.data||row.DATE_KEY||'').slice(0,10),updatedAt:String(row.UPDATED_AT||row.CREATED_AT||''),motoristaId:String(data.motorista_id||data.MOTORISTA_ID||''),motorista:String(data.motorista||data.MOTORISTA||''),rota:String(data.rota||data.ROTA||data.destino||data.DESTINO||''),regiao:String(data.regiao||data.REGIAO||''),status:String(row.STATUS||data.status||''),source:'ROUTE_RECORDS'});
  }
  candidates.sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.updatedAt).localeCompare(String(a.updatedAt))||String(b.scheduleId).localeCompare(String(a.scheduleId),undefined,{numeric:true}));
  const map=new Map();for(const item of candidates)if(!map.has(item.plate))map.set(item.plate,item);
  for(const row of lastDrivers.results||[]){const plate=norm(row.PLATE);if(!plate)continue;const current=map.get(plate);if(current&&!current.motorista)map.set(plate,{...current,motoristaId:String(row.DRIVER_ID||''),motorista:String(row.DRIVER_NAME||'')});else if(!current&&String(row.DRIVER_NAME||'').trim())map.set(plate,{plate,scheduleId:String(row.SCHEDULE_ID||''),date:String(row.EFFECTIVE_AT||'').slice(0,10),updatedAt:String(row.EFFECTIVE_AT||''),motoristaId:String(row.DRIVER_ID||''),motorista:String(row.DRIVER_NAME||''),rota:'',regiao:'',status:'',source:'ROUTE_VEHICLE_LAST_DRIVER'});}
  latestAssignmentCache={at:Date.now(),map};return map;
}
async function attachLatestAssignments(db,payload,requested=[]){
  try{
    const map=await latestScheduleAssignments(db),allow=new Set((requested||[]).map(norm).filter(Boolean));const assignments={};
    for(const [plate,item] of map)if(!allow.size||allow.has(plate))assignments[plate]=item;
    return {...payload,assignments,positions:(payload.positions||[]).map((item)=>({...item,assignment:assignments[norm(item.plate)]||null}))};
  }catch(error){console.error('GPS latest assignment warning',error);return {...payload,assignments:payload.assignments||{}};}
}

async function readGpsCacheMeta(db){
  try{
    await ensureProtectSatSchema(db);
    let row=await db.prepare(`
      SELECT COUNT(*) AS PLATE_COUNT,MAX(FETCHED_AT) AS LAST_FETCHED_AT,MAX(GPS_TIME) AS LAST_GPS_AT,
             CASE WHEN MAX(FETCHED_AT) IS NULL THEN NULL ELSE CAST((julianday('now')-julianday(MAX(FETCHED_AT)))*1440 AS INTEGER) END AS FETCH_AGE_MINUTES
      FROM ROUTE_GPS_LATEST
    `).first();
    if(!Number(row?.PLATE_COUNT||0))row=await db.prepare(`SELECT 0 AS PLATE_COUNT,NULL AS LAST_FETCHED_AT,NULL AS LAST_GPS_AT,NULL AS FETCH_AGE_MINUTES`).first();
    return {plateCount:Number(row?.PLATE_COUNT||0),lastFetchedAt:String(row?.LAST_FETCHED_AT||''),lastGpsAt:String(row?.LAST_GPS_AT||''),fetchAgeMinutes:row?.FETCH_AGE_MINUTES===null||row?.FETCH_AGE_MINUTES===undefined?null:Number(row.FETCH_AGE_MINUTES)};
  }catch(error){return {plateCount:0,lastFetchedAt:'',lastGpsAt:'',fetchAgeMinutes:null,error:error?.message||String(error)};}
}

async function cachedGpsPayload(env,registeredVehicles,requested=[],extra={}){
  let positions=[];
  try{positions=await readLatestStoredPositions(env.DB,registeredVehicles);}catch(error){extra.cacheError=error?.message||String(error);}
  const requestedSet=new Set((requested||[]).map(norm).filter(Boolean));
  if(requestedSet.size)positions=positions.filter((item)=>requestedSet.has(norm(item.plate)));
  const meta=await readGpsCacheMeta(env.DB);
  return {versao:'1',enabled:String(env.PROTECTSAT_ENABLED||'true').toLowerCase()!=='false',configured:Boolean(String(env.PROTECTSAT_CHAVE||'').trim()),readOnly:true,mode:'D1_CACHE',positions,total:positions.length,clients:[],trackedVehicles:registeredVehicles?.size||0,fetchedAt:new Date().toISOString(),cacheMeta:meta,autoDepartures:[],autoReturns:[],...extra};
}

const SYSTEM_GPS_USER={id:0,name:'AUTOMAÇÃO GPS',email:'',role:'ADMIN',perfil:'ADMIN',permissions:['*'],bases:['route']};

// Caminho leve para as telas: consulta a ProtectSat e devolve a posição antes de
// executar cálculos de retenção, ocorrências, geofence e demais gravações D1.
// Isso impede que uma rotina operacional secundária faça o GPS inteiro parecer offline.
async function readProtectSatLive(env,{requestedPlates=[]}={}){
  const enabled=String(env.PROTECTSAT_ENABLED||'true').toLowerCase()!=='false';
  const key=String(env.PROTECTSAT_CHAVE||'').trim();
  if(!enabled)return {versao:'1',enabled:false,configured:Boolean(key),readOnly:true,mode:'LIVE_DISABLED',positions:[],total:0,fetchedAt:new Date().toISOString()};
  if(!key)return {versao:'1',enabled:true,configured:false,readOnly:true,mode:'LIVE_NO_KEY',positions:[],total:0,aviso:'PROTECTSAT_CHAVE não está configurada neste ambiente do Cloudflare.',fetchedAt:new Date().toISOString()};
  const baseUrl=String(env.PROTECTSAT_BASE_URL||DEFAULT_URL).trim();
  const functionName=String(env.PROTECTSAT_FUNCAO||'grid_monitoramento').trim();
  const requested=new Set((requestedPlates||[]).map(norm).filter(Boolean));
  const response=await fetchProtectSat(baseUrl,key,functionName);
  let positions=freshestPositionsByPlate((response.parsed.rows||[]).map(position).filter((item)=>item.plate));
  if(requested.size)positions=positions.filter((item)=>requested.has(norm(item.plate)));
  positions=positions.map((item)=>({...item,updatedAt:gpsTimeIso(item.updatedAt)}));
  return {versao:'1',enabled:true,configured:true,readOnly:true,mode:`LIVE_${response.mode}`,positions,total:positions.length,liveTotal:positions.length,sourceTotal:(response.parsed.rows||[]).length,fetchedAt:new Date().toISOString(),autoDepartures:[],autoReturns:[],syncWarnings:[],live:true};
}

export async function syncProtectSatRoute(env,user=SYSTEM_GPS_USER,{requestedPlates=[],scheduled=false}={}) {
  if (!env?.DB) throw new Error("Binding D1 'DB' não encontrado.");
  const warnings=[];
  let schemaReady=true;
  try{await ensureProtectSatSchema(env.DB);}catch(error){schemaReady=false;warnings.push(`Schema GPS: ${error?.message||String(error)}`);console.error('GPS schema warning',error);}
  const enabled = String(env.PROTECTSAT_ENABLED || 'true').toLowerCase() !== 'false';
  const key = String(env.PROTECTSAT_CHAVE || '').trim();
  const baseUrl = String(env.PROTECTSAT_BASE_URL || DEFAULT_URL).trim();
  const functionName = String(env.PROTECTSAT_FUNCAO || 'grid_monitoramento').trim();
  let registeredVehicles=new Map();
  try{registeredVehicles=await readRegisteredVehicles(env.DB);}catch(error){warnings.push(`Cadastro de veículos: ${error?.message||String(error)}`);console.error('GPS registered vehicles warning',error);}
  const registeredPlates = new Set(registeredVehicles.keys());
  const requested = new Set((requestedPlates||[]).map(norm).filter(Boolean));
  const cachedPositions=async()=>{
    try{return await readLatestStoredPositions(env.DB,registeredVehicles);}catch(error){warnings.push(`Cache GPS: ${error?.message||String(error)}`);console.error('GPS cache warning',error);return [];}
  };
  if (!enabled) return {versao:'1',enabled:false,configured:Boolean(key),readOnly:true,positions:await cachedPositions(),clients:[],trackedVehicles:registeredPlates.size,fetchedAt:new Date().toISOString(),autoDepartures:[],autoReturns:[],syncWarnings:warnings};
  if (!key) return {versao:'1',enabled:true,configured:false,readOnly:true,positions:await cachedPositions(),clients:[],trackedVehicles:registeredPlates.size,aviso:'PROTECTSAT_CHAVE não está configurada neste ambiente do Cloudflare.',fetchedAt:new Date().toISOString(),autoDepartures:[],autoReturns:[],syncWarnings:warnings};

  // A consulta externa é a etapa prioritária. As rotinas D1/indicadores abaixo são
  // best-effort: uma falha nelas não pode esconder uma posição que a ProtectSat entregou.
  const response = await fetchProtectSat(baseUrl,key,functionName);
  let sourcePositions = response.parsed.rows.map(position).filter(item=>item.plate);
  const sourceTotal=sourcePositions.length;
  const sourceUniqueTotal=freshestPositionsByPlate(sourcePositions).length;
  sourcePositions=freshestPositionsByPlate(sourcePositions);
  if(requested.size)sourcePositions=sourcePositions.filter((item)=>requested.has(norm(item.plate)));
  let positions=sourcePositions;
  let registrationFilterFallback=false;
  if(!requested.size&&registeredPlates.size){
    const registeredOnly=sourcePositions.filter((item)=>registeredPlates.has(norm(item.plate)));
    // Se o cadastro não cruzar com nenhuma placa recebida, não zera o GPS da tela.
    // Entrega a resposta live e sinaliza o desencontro para diagnóstico posterior.
    if(registeredOnly.length)positions=registeredOnly;
    else if(sourcePositions.length){registrationFilterFallback=true;warnings.push('Nenhuma placa recebida da ProtectSat cruzou com BASE_VEICULOS; exibindo a resposta live sem esse filtro.');}
  }
  const byPlate = new Map(); for (const item of positions) byPlate.set(norm(item.plate),item);
  positions = [...byPlate.values()];
  const normalizedPositions=positions.map((item)=>({...item,updatedAt:gpsTimeIso(item.updatedAt)}));

  let autoDepartures=[],autoReturns=[];
  if(schemaReady){
    // Primeiro persiste a leitura atual. A confirmação de saída precisa enxergar no
    // histórico a sequência real dentro -> fora; antes as duas rotinas rodavam em
    // paralelo e a primeira posição externa podia não estar disponível na análise.
    try{await storeHistory(env.DB,normalizedPositions);}catch(error){warnings.push(`Histórico GPS: ${error?.message||String(error)}`);console.error('GPS history warning',error);}
    const sideEffects=await Promise.allSettled([
      autoConfirmDeparturesFromGps(env.DB,user||SYSTEM_GPS_USER,normalizedPositions,{
        facilityName:String(env.DEPARTURE_GEOFENCE_NAME||''),
        facilityNames:String(env.DEPARTURE_GEOFENCE_NAMES||'NOTARO ALIMENTOS LTDA. - RECIFE/PE|NOTARO ALIMENTOS - RECIFE/PE').split('|'),
        facilityRadiusMeters:Number(env.DEPARTURE_GEOFENCE_RADIUS_METERS||120),
        maxGpsAgeMinutes:Number(env.DEPARTURE_GPS_MAX_AGE_MINUTES||90),
        transitionLookbackMinutes:Number(env.DEPARTURE_GPS_TRANSITION_LOOKBACK_MINUTES||2160),
        exitBufferMeters:Number(env.DEPARTURE_GPS_EXIT_BUFFER_METERS||40),
        earlyWindowMinutes:Number(env.DEPARTURE_GPS_EARLY_WINDOW_MINUTES||60),
        lateWindowMinutes:Number(env.DEPARTURE_GPS_LATE_WINDOW_MINUTES||1440),
        outsideConfirmations:Number(env.DEPARTURE_GPS_OUTSIDE_CONFIRMATIONS||2),
        warnings,
      }),
      updateGpsMotionState(env.DB,normalizedPositions),
    ]);
    if(sideEffects[0].status==='fulfilled')autoDepartures=sideEffects[0].value||[];else warnings.push(`Saída automática: ${sideEffects[0].reason?.message||sideEffects[0].reason}`);
    if(sideEffects[1].status==='rejected')warnings.push(`Estado/retenção GPS: ${sideEffects[1].reason?.message||sideEffects[1].reason}`);
  }

  // Enriquecimentos não podem derrubar a leitura principal.
  let refreshedWithState=normalizedPositions;
  if(schemaReady){
    try{refreshedWithState=await enrichWithNearbyClients(env.DB,refreshedWithState);}catch(error){warnings.push(`Clientes próximos: ${error?.message||String(error)}`);console.error('GPS nearby clients warning',error);}
    try{refreshedWithState=await attachGpsMotionState(env.DB,refreshedWithState);}catch(error){warnings.push(`Estado de movimento: ${error?.message||String(error)}`);console.error('GPS motion state warning',error);}
    await Promise.allSettled([
      recordGpsOperationalOccurrences(env.DB,refreshedWithState),
      recordRouteClientArrivals(env.DB,refreshedWithState),
      recordNightIgnitionSessions(env.DB,refreshedWithState),
    ]).then((results)=>results.forEach((result,index)=>{if(result.status==='rejected')warnings.push(`${['Ocorrências GPS','Histórico de clientes','Ignição noturna'][index]}: ${result.reason?.message||result.reason}`);}));
    try{
      autoReturns = await autoConfirmReturnsFromGps(env.DB,SYSTEM_GPS_USER,normalizedPositions,{
        facilityNames:String(env.RETURN_GEOFENCE_NAMES||env.DEPARTURE_GEOFENCE_NAMES||'NOTARO ALIMENTOS LTDA. - RECIFE/PE|NOTARO ALIMENTOS - RECIFE/PE').split('|'),
        facilityRadiusMeters:Number(env.RETURN_GEOFENCE_RADIUS_METERS||env.DEPARTURE_GEOFENCE_RADIUS_METERS||120),
      });
    }catch(error){warnings.push(`Retorno automático: ${error?.message||String(error)}`);console.error('GPS auto return warning',error);}
  }

  if(scheduled){
    return {versao:'1',enabled:true,configured:true,readOnly:true,mode:response.mode,positions:refreshedWithState,total:refreshedWithState.length,sourceTotal,sourceUniqueTotal,clients:[],trackedVehicles:registeredPlates.size,fetchedAt:new Date().toISOString(),autoDepartures,autoReturns,registrationFilterFallback,syncWarnings:warnings};
  }

  // Mescla o cache para manter placas que não vieram nesta resposta, mas a posição
  // recém recebida sempre vence. Se o D1 estiver com problema, a resposta live ainda chega.
  let latest=[];
  if(schemaReady)latest=await cachedPositions();
  const merged=new Map((latest||[]).map((item)=>[norm(item.plate),item]));
  for(const item of refreshedWithState)merged.set(norm(item.plate),item);
  let display=[...merged.values()];
  if(requested.size)display=display.filter((item)=>requested.has(norm(item.plate)));
  return {versao:'1',enabled:true,configured:true,readOnly:true,mode:response.mode,positions:display,total:display.length,liveTotal:refreshedWithState.length,sourceTotal,sourceUniqueTotal,clients:[],trackedVehicles:registeredPlates.size,fetchedAt:new Date().toISOString(),autoDepartures,autoReturns,registrationFilterFallback,syncWarnings:warnings};
}

async function reconcileStoredGpsAutomation(env,user=SYSTEM_GPS_USER){
  const warnings=[];let registeredVehicles=new Map();
  try{registeredVehicles=await readRegisteredVehicles(env.DB);}catch(error){warnings.push(`Cadastro de veículos: ${error?.message||String(error)}`);}
  let positions=[];try{positions=await readLatestStoredPositions(env.DB,registeredVehicles);}catch(error){warnings.push(`Cache GPS: ${error?.message||String(error)}`);}
  let autoDepartures=[],autoReturns=[];
  if(positions.length){
    try{autoDepartures=await autoConfirmDeparturesFromGps(env.DB,user||SYSTEM_GPS_USER,positions,{
      facilityName:String(env.DEPARTURE_GEOFENCE_NAME||''),
      facilityNames:String(env.DEPARTURE_GEOFENCE_NAMES||'NOTARO ALIMENTOS LTDA. - RECIFE/PE|NOTARO ALIMENTOS - RECIFE/PE').split('|'),
      facilityRadiusMeters:Number(env.DEPARTURE_GEOFENCE_RADIUS_METERS||120),
      maxGpsAgeMinutes:Number(env.DEPARTURE_GPS_MAX_AGE_MINUTES||90),
      transitionLookbackMinutes:Number(env.DEPARTURE_GPS_TRANSITION_LOOKBACK_MINUTES||2160),
      exitBufferMeters:Number(env.DEPARTURE_GPS_EXIT_BUFFER_METERS||40),
      earlyWindowMinutes:Number(env.DEPARTURE_GPS_EARLY_WINDOW_MINUTES||60),
      lateWindowMinutes:Number(env.DEPARTURE_GPS_LATE_WINDOW_MINUTES||1440),
      outsideConfirmations:Number(env.DEPARTURE_GPS_OUTSIDE_CONFIRMATIONS||2),warnings,
    });}catch(error){warnings.push(`Saída automática: ${error?.message||String(error)}`);}
    try{autoReturns=await autoConfirmReturnsFromGps(env.DB,SYSTEM_GPS_USER,positions,{facilityNames:String(env.RETURN_GEOFENCE_NAMES||env.DEPARTURE_GEOFENCE_NAMES||'NOTARO ALIMENTOS LTDA. - RECIFE/PE|NOTARO ALIMENTOS - RECIFE/PE').split('|'),facilityRadiusMeters:Number(env.RETURN_GEOFENCE_RADIUS_METERS||env.DEPARTURE_GEOFENCE_RADIUS_METERS||120)});}catch(error){warnings.push(`Retorno automático: ${error?.message||String(error)}`);}
  }
  return {positions,total:positions.length,autoDepartures,autoReturns,syncWarnings:warnings};
}

export async function runScheduledProtectSatSync(env){
  // Mesmo quando o cache acabou de ser atualizado por outra execução, reprocessamos
  // as automações usando a última posição armazenada. Isso recupera uma saída que
  // falhou por lock/timeout sem esperar uma nova posição da ProtectSat.
  const meta=await readGpsCacheMeta(env.DB);
  if(meta.fetchAgeMinutes!==null&&meta.fetchAgeMinutes<3){
    const replay=await reconcileStoredGpsAutomation(env,SYSTEM_GPS_USER);
    return {versao:'1',enabled:true,configured:Boolean(String(env.PROTECTSAT_CHAVE||'').trim()),readOnly:true,mode:'D1_CACHE_CRON_RECONCILED',positions:[],total:Number(meta.plateCount||0),sourceTotal:0,clients:[],trackedVehicles:0,fetchedAt:new Date().toISOString(),cacheMeta:meta,autoDepartures:replay.autoDepartures||[],autoReturns:replay.autoReturns||[],syncWarnings:replay.syncWarnings||[]};
  }
  return syncProtectSatRoute(env,SYSTEM_GPS_USER,{scheduled:true});
}

export async function onRequestGet({ env, request, waitUntil }) {
  if (!env.DB) return jsonResponse({ erro:"Binding D1 'DB' não encontrado." },500);
  const auth = await requireUser(env.DB,request); if (auth.response) return auth.response;
  try {
    assertRouteAccess(auth.user,'route.location');
    const url = new URL(request.url);
    const view = String(url.searchParams.get('view') || '').toLowerCase();
    const hours = Math.min(Math.max(Number(url.searchParams.get('hours') || 24),1),168);
    let registeredVehicles=new Map();
    try{registeredVehicles=await readRegisteredVehicles(env.DB);}catch(error){console.error('GPS vehicle catalog warning',error);}
    const registeredPlates = new Set(registeredVehicles.keys());

    if (view === 'history') {
      try{await ensureProtectSatSchema(env.DB);}catch(error){return jsonResponse({erro:`Histórico GPS indisponível: ${error?.message||error}`,codigo:'GPS_HISTORY_SCHEMA_ERROR'},503);}
      const plate = norm(url.searchParams.get('plate') || '');
      if (!plate) return jsonResponse({ erro:'Informe a placa para consultar o histórico de posições.' },400);
      if (registeredPlates.size && !registeredPlates.has(plate)) return jsonResponse({ versao:'1', positions:[], total:0, plate, hours, clients:[] },200);
      const positions = await readHistory(env.DB, plate, hours);
      return jsonResponse({ versao:'1', enabled:true, configured:Boolean(env.PROTECTSAT_CHAVE), readOnly:true, plate, hours, positions, total:positions.length, clients:[], fetchedAt:new Date().toISOString() });
    }

    const requested = (url.searchParams.get('plates') || '').split(',').map(norm).filter(Boolean);
    const refresh = ['1','true','yes','sim'].includes(String(url.searchParams.get('refresh')||'').toLowerCase());
    const force = ['1','true','yes','sim'].includes(String(url.searchParams.get('force')||'').toLowerCase());
    const meta=await readGpsCacheMeta(env.DB);
    const cacheFresh=meta.fetchAgeMinutes!==null&&meta.fetchAgeMinutes<3;

    // Diagnóstico seguro: não expõe chave nem payload bruto da ProtectSat.
    if(view==='diagnostic'){
      const cached=await cachedGpsPayload(env,registeredVehicles,requested,{mode:'GPS_DIAGNOSTIC',cacheMeta:meta});
      const plateDiagnostics=(cached.positions||[]).map((item)=>({plate:item.plate,gpsAt:item.updatedAt||'',fetchedAt:item.fetchedAt||'',gpsAgeMinutes:item.gpsAgeMinutes??null,apiFetchAgeMinutes:item.apiFetchAgeMinutes??null,apiStatus:item.apiStatus||'',timestampSource:item.timestampSource||'',timestampReliable:item.timestampReliable!==false,location:item.point||item.location||'',latitude:item.latitude??null,longitude:item.longitude??null}));
      let liveProbe=null;
      if(force||refresh){
        try{
          const live=await readProtectSatLive(env,{requestedPlates:[...requested]});
          liveProbe={ok:true,mode:live.mode||'',sourceTotal:Number(live.sourceTotal||0),received:(live.positions||[]).map((item)=>({plate:item.plate,gpsAt:item.updatedAt||'',timestampSource:item.timestampSource||'',timestampReliable:item.timestampReliable!==false,location:item.point||item.location||'',latitude:item.latitude??null,longitude:item.longitude??null}))};
        }catch(error){liveProbe={ok:false,error:error?.message||String(error)};}
      }
      return jsonResponse({...cached,diagnostic:{enabled:cached.enabled,configured:cached.configured,registeredVehicles:registeredVehicles.size,cachePositions:cached.positions.length,lastFetchedAt:meta.lastFetchedAt,lastGpsAt:meta.lastGpsAt,fetchAgeMinutes:meta.fetchAgeMinutes,baseUrl:String(env.PROTECTSAT_BASE_URL||DEFAULT_URL),functionName:String(env.PROTECTSAT_FUNCAO||'grid_monitoramento'),plates:plateDiagnostics,liveProbe}},200);
    }

    if(view==='latest'){
      const cached=await cachedGpsPayload(env,registeredVehicles,requested,{cacheMeta:meta});
      // A tela nunca deve bloquear esperando a API externa se já houver posição válida armazenada.
      // Se estiver desatualizado, devolve o cache imediatamente e atualiza em segundo plano.
      if(cached.positions.length&&!force){
        if(!cacheFresh&&typeof waitUntil==='function'){
          waitUntil(syncProtectSatRoute(env,auth.user,{requestedPlates:requested}).catch((error)=>console.error('GPS background refresh warning',error)));
          cached.degraded=true;cached.mode='D1_CACHE_REFRESHING';cached.aviso='Atualizando ProtectSat em segundo plano; exibindo a última posição disponível.';
        }
        return jsonResponse(await attachLatestAssignments(env.DB,cached,requested),200);
      }

      // Sem cache (ou atualização manual forçada): faz UMA única chamada à ProtectSat.
      // Falha externa não vira erro global do sistema; devolve diagnóstico HTTP 200.
      try{
        const live=await syncProtectSatRoute(env,auth.user,{requestedPlates:requested});
        return jsonResponse(await attachLatestAssignments(env.DB,{...live,cacheMeta:await readGpsCacheMeta(env.DB)},requested),200);
      }catch(error){
        console.error('ProtectSat refresh error',error);
        const fallback=await cachedGpsPayload(env,registeredVehicles,requested,{mode:'GPS_UNAVAILABLE',degraded:true,aviso:'ProtectSat não respondeu. A operação do DMS continua disponível.',refreshError:error?.message||String(error),errorCode:error?.code||'PROTECTSAT_ERROR',cacheMeta:await readGpsCacheMeta(env.DB)});
        return jsonResponse(await attachLatestAssignments(env.DB,fallback,requested),200);
      }
    }

    // Compatibilidade com chamadas antigas sem view.
    try{return jsonResponse(await syncProtectSatRoute(env,auth.user,{requestedPlates:requested}),200);}
    catch(error){
      const fallback=await cachedGpsPayload(env,registeredVehicles,requested,{mode:'GPS_UNAVAILABLE',degraded:true,aviso:'ProtectSat não respondeu. Exibindo o último dado disponível.',refreshError:error?.message||String(error),errorCode:error?.code||'PROTECTSAT_ERROR'});
      return jsonResponse(fallback,200);
    }
  } catch (error) {
    return jsonResponse({erro:error.message||String(error),codigo:error.code||'PROTECTSAT_ERROR'},error.status||400);
  }
}

export async function onRequestPost() {
  return jsonResponse({erro:'Última Localização é somente leitura nesta versão.'},405);
}
