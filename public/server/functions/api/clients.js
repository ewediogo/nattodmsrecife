import { jsonResponse, requireUser } from '../_lib/auth.js';
import { assertRouteAccess } from '../_lib/route-access.js';
import { clientLincrosHistoryByCodes } from '../_lib/lincros.js';

const ACTIVE_TRIP_STATUSES=['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO'];
const codeKey=(value)=>String(value??'').trim().toUpperCase();
const coordOrNull=(value)=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);

// Clientes da viagem em aberto de uma placa (Última localização). A lista vem das
// entregas Lincros da viagem; as entregas são gravadas com o ID da escala
// (schedule_record_id do Monitoramento quando existe), então testamos todos os IDs
// candidatos: dicas da tela, Monitoramento ativo da placa e a sincronização Lincros
// da própria placa. Coordenadas do cadastro de clientes, com a posição da entrega
// como alternativa.
function parseJsonObject(text){try{const value=JSON.parse(String(text||'{}'));return value&&typeof value==='object'?value:{};}catch{return {};}}
async function tripClientsByPlate(db,plate,hintIds=[]){
  const since=new Date(Date.now()-45*86400000).toISOString().slice(0,10);
  const recentSince=new Date(Date.now()-3*86400000).toISOString().slice(0,10);
  const marks=ACTIVE_TRIP_STATUSES.map(()=>'?').join(',');
  const plateSql=`REPLACE(REPLACE(UPPER(TRIM(COALESCE(PLATE,''))),'-',''),' ','')=?`;
  const candidates=[];const push=(id)=>{const key=String(id??'').trim();if(key&&!candidates.includes(key))candidates.push(key);};
  hintIds.forEach(push);
  let monitoring=null;
  const {results:monitoringRows=[]}=await db.prepare(`SELECT SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON FROM ROUTE_MONITORING
    WHERE ${plateSql} AND STATUS IN (${marks}) AND DATE_KEY>=? ORDER BY ID DESC LIMIT 5`).bind(plate,...ACTIVE_TRIP_STATUSES,since).all();
  for(const row of monitoringRows){
    const data=parseJsonObject(row.DATA_JSON);
    push(data.schedule_record_id);push(row.SCHEDULE_ID);push(data.escala_id);
    if(!monitoring)monitoring=row;
  }
  let syncRows=[];
  try{
    const result=await db.prepare(`SELECT SCHEDULE_ID,DATE_KEY,DMS_ROUTE,DRIVER FROM LINCROS_ROUTE_SYNC WHERE ${plateSql} AND DATE_KEY>=? ORDER BY DATE_KEY DESC,ID DESC LIMIT 6`).bind(plate,recentSince).all();
    syncRows=result.results||[];
  }catch{syncRows=[];}
  syncRows.forEach((row)=>push(row.SCHEDULE_ID));
  if(!candidates.length)return {records:[],total:0,trip:null,mode:'TRIP'};
  let deliveries=[],resolvedId=candidates[0];
  for(const id of candidates){
    try{
      const result=await db.prepare(`SELECT CLIENT_CODE,CLIENT_NAME,SEQUENCE_PLANNED,SEQUENCE_ACTUAL,STATUS,DELIVERED,RETURNED,PENDING,ARRIVED_AT,LEFT_AT,LATITUDE,LONGITUDE
        FROM LINCROS_DELIVERIES WHERE SCHEDULE_ID=? ORDER BY COALESCE(SEQUENCE_ACTUAL,SEQUENCE_PLANNED),ID LIMIT 600`).bind(id).all();
      if((result.results||[]).length){deliveries=result.results;resolvedId=id;break;}
    }catch{break;}
  }
  const syncMatch=syncRows.find((row)=>String(row.SCHEDULE_ID)===resolvedId)||syncRows[0]||null;
  const trip=monitoring||syncMatch?{}:null;
  const tripInfo={scheduleId:resolvedId,route:String(monitoring?.ROUTE||syncMatch?.DMS_ROUTE||''),date:String(monitoring?.DATE_KEY||syncMatch?.DATE_KEY||''),driver:String(monitoring?.DRIVER_NAME||syncMatch?.DRIVER||''),status:String(monitoring?.STATUS||''),plate};
  const codes=[...new Set(deliveries.map((row)=>codeKey(row.CLIENT_CODE)).filter(Boolean))];
  const base=new Map();
  for(let i=0;i<codes.length;i+=60){
    const chunk=codes.slice(i,i+60),ph=chunk.map(()=>'?').join(',');
    const {results=[]}=await db.prepare(`SELECT ID,CODIGO,CODIGO_NEGOCIO,NOME,LATITUDE,LONGITUDE,RAIO_METROS,CIDADE,UF,ENDERECO,BAIRRO,UNIDADE_NEGOCIO FROM BASE_CLIENTES
      WHERE COALESCE(ATIVO,1)<>0 AND (UPPER(TRIM(CODIGO)) IN (${ph}) OR UPPER(TRIM(COALESCE(CODIGO_NEGOCIO,''))) IN (${ph}))`).bind(...chunk,...chunk).all();
    for(const row of results){for(const key of [codeKey(row.CODIGO),codeKey(row.CODIGO_NEGOCIO)])if(key&&!base.has(key))base.set(key,row);}
  }
  const records=deliveries.map((delivery)=>{
    const code=codeKey(delivery.CLIENT_CODE),row=base.get(code)||null;
    const latitude=coordOrNull(row?.LATITUDE)??coordOrNull(delivery.LATITUDE),longitude=coordOrNull(row?.LONGITUDE)??coordOrNull(delivery.LONGITUDE);
    const returned=Number(delivery.RETURNED)===1,delivered=Number(delivery.DELIVERED)===1&&!returned,pending=!delivered&&!returned;
    return {
      id:String(row?.ID||''),code:String(row?.CODIGO||delivery.CLIENT_CODE||''),businessCode:String(row?.CODIGO_NEGOCIO||''),name:String(row?.NOME||delivery.CLIENT_NAME||''),
      latitude:latitude,longitude:longitude,radiusMeters:100,city:String(row?.CIDADE||''),state:String(row?.UF||''),address:String(row?.ENDERECO||''),neighborhood:String(row?.BAIRRO||''),businessUnit:String(row?.UNIDADE_NEGOCIO||''),
      tripState:returned?'DEVOLVIDO':delivered?'ENTREGUE':'PENDENTE',sequence:delivery.SEQUENCE_ACTUAL??delivery.SEQUENCE_PLANNED??null,
      arrivedAt:delivery.ARRIVED_AT||'',leftAt:delivery.LEFT_AT||'',
    };
  });
  const withCoords=records.filter((record)=>record.latitude!==null&&record.longitude!==null);
  return {records:withCoords,total:withCoords.length,semCoordenadas:records.length-withCoords.length,entregas:records.length,
    resumo:{entregues:records.filter((r)=>r.tripState==='ENTREGUE').length,pendentes:records.filter((r)=>r.tripState==='PENDENTE').length,devolvidos:records.filter((r)=>r.tripState==='DEVOLVIDO').length},trip:(trip||hintIds.length)?tripInfo:null,mode:'TRIP'};
}

function numberParam(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function onRequestGet({ env, request }) {
  if (!env.DB) return jsonResponse({ erro:"Binding D1 'DB' não encontrado." },500);
  const auth = await requireUser(env.DB,request); if (auth.response) return auth.response;
  try {
    assertRouteAccess(auth.user,'route.location');
    const url = new URL(request.url);
    const q = String(url.searchParams.get('q') || url.searchParams.get('busca') || '').trim();
    const tripPlate = String(url.searchParams.get('plate') || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if (tripPlate) return jsonResponse(await tripClientsByPlate(env.DB,tripPlate,String(url.searchParams.get('schedule') || '').split(',').map((x)=>x.trim()).filter(Boolean).slice(0,8)));
    const bbox = String(url.searchParams.get('bbox') || '').split(',').map(Number);
    const zoom = numberParam(url.searchParams.get('zoom'), 0);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || (q ? 100 : 1200)),20),1500);
    const mapRow=(row)=>({
      id:String(row.ID||''), code:String(row.CODIGO||''), businessCode:String(row.CODIGO_NEGOCIO||''), name:String(row.NOME||''),
      latitude:row.LATITUDE===null||row.LATITUDE===undefined||row.LATITUDE===''?null:Number(row.LATITUDE),
      longitude:row.LONGITUDE===null||row.LONGITUDE===undefined||row.LONGITUDE===''?null:Number(row.LONGITUDE), radiusMeters:100,
      city:String(row.CIDADE||''), state:String(row.UF||''), address:String(row.ENDERECO||''), neighborhood:String(row.BAIRRO||''), businessUnit:String(row.UNIDADE_NEGOCIO||''),
    });
    if(q){
      const term=`%${q.replace(/%/g,'').replace(/_/g,' ')}%`;
      const {results}=await env.DB.prepare(`
        SELECT ID,CODIGO,CODIGO_NEGOCIO,NOME,LATITUDE,LONGITUDE,RAIO_METROS,CIDADE,UF,ENDERECO,BAIRRO,UNIDADE_NEGOCIO
        FROM BASE_CLIENTES
        WHERE COALESCE(ATIVO,1)<>0 AND (
          UPPER(COALESCE(CODIGO,'')) LIKE UPPER(?) OR
          UPPER(COALESCE(CODIGO_NEGOCIO,'')) LIKE UPPER(?) OR
          UPPER(COALESCE(NOME,'')) LIKE UPPER(?) OR
          UPPER(COALESCE(CIDADE,'')) LIKE UPPER(?) OR
          UPPER(COALESCE(ENDERECO,'')) LIKE UPPER(?)
        )
        ORDER BY CASE WHEN UPPER(COALESCE(CODIGO,''))=UPPER(?) THEN 0 WHEN UPPER(COALESCE(CODIGO_NEGOCIO,''))=UPPER(?) THEN 1 ELSE 2 END, NOME COLLATE NOCASE
        LIMIT ?
      `).bind(term,term,term,term,term,q,q,limit).all();
      const records=(results||[]).map(mapRow);
      const history=await clientLincrosHistoryByCodes(env.DB,records.flatMap((row)=>[row.businessCode,row.code]));
      const clientKey=(value)=>String(value||'').trim().toUpperCase();
      for(const record of records){record.deliveryInfo=history.get(clientKey(record.businessCode))||history.get(clientKey(record.code))||null;}
      return jsonResponse({records,total:records.length,limit,query:q,truncated:records.length>=limit,mode:'SEARCH'});
    }
    if (zoom < 13 || bbox.length !== 4 || !bbox.every(Number.isFinite)) {
      return jsonResponse({ records:[], total:0, zoom, reason:'ZOOM_OR_BBOX' });
    }
    const [minLat,minLng,maxLat,maxLng] = bbox;
    const { results } = await env.DB.prepare(`
      SELECT ID,CODIGO,CODIGO_NEGOCIO,NOME,LATITUDE,LONGITUDE,RAIO_METROS,CIDADE,UF,ENDERECO,BAIRRO,UNIDADE_NEGOCIO
      FROM BASE_CLIENTES
      WHERE COALESCE(ATIVO,1)<>0
        AND LATITUDE BETWEEN ? AND ?
        AND LONGITUDE BETWEEN ? AND ?
      ORDER BY NOME COLLATE NOCASE
      LIMIT ?
    `).bind(minLat,maxLat,minLng,maxLng,limit).all();
    const records=(results||[]).map(mapRow).filter((row)=>Number.isFinite(row.latitude)&&Number.isFinite(row.longitude));
    return jsonResponse({ records,total:records.length,limit,zoom,truncated:records.length>=limit,mode:'MAP' });
  } catch (error) {
    return jsonResponse({ erro:error.message||String(error),codigo:error.code||'CLIENTS_ERROR' },error.status||400);
  }
}
