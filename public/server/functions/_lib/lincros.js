import { reverseGeocode } from './reverse-geocode.js';
function clean(value,max=500){return String(value??'').trim().slice(0,max);}
function norm(value){return clean(value,500).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'');}
function normalizePlate(value){return norm(value).slice(0,12);}
function dateIso(value){
  const raw=clean(value,80);if(!raw)return '';
  let m=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  m=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);if(m)return `${m[3]}-${m[2]}-${m[1]}`;
  return '';
}
function addDaysIso(value,days=1){
  const base=dateIso(value);if(!base)return '';
  const [year,month,day]=base.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day+Number(days||0)));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
}
function lincrosDate(value){
  const raw=clean(value,80);if(!raw)return '';
  let m=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m)return `${m[3]}-${m[2]}-${m[1]}T${String(m[4]||'00').padStart(2,'0')}:${m[5]||'00'}:${m[6]||'00'}-03:00`;
  m=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m)return `${m[1]}-${m[2]}-${m[3]}T${String(m[4]||'00').padStart(2,'0')}:${m[5]||'00'}:${m[6]||'00'}-03:00`;
  return raw;
}
function num(value){if(value===null||value===undefined||value==='')return null;const n=Number(String(value).replace(',','.'));return Number.isFinite(n)?n:null;}
function truthy(value){return value===true||value===1||['1','TRUE','SIM','YES'].includes(norm(value));}
function optionalBool(value){if(value===null||value===undefined||value==='')return null;if(value===false||value===0)return false;const n=norm(value);if(['0','FALSE','NAO','NO'].includes(n))return false;if(value===true||value===1||['1','TRUE','SIM','YES'].includes(n))return true;return null;}
function normalizeStatus(value){return clean(value,80).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,'');}
function parseDurationMinutes(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value==='string'){
    const raw=value.trim();const m=raw.match(/^(?:(\d+)\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if(m){const days=Number(m[1]||0),a=Number(m[2]||0),b=Number(m[3]||0),c=Number(m[4]||0);return m[4]!==undefined?days*1440+a*60+b+c/60:days*1440+a*60+b;}
  }
  return null;
}
function diffMinutes(start,end){const a=Date.parse(lincrosDate(start)),b=Date.parse(lincrosDate(end));return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?Math.round((b-a)/6000)/10:null;}
function routeCodeOf(row={}){return clean(row.rota??row.Rota??row.CdRotaNegocio??row.cdRotaNegocio??row.CodigoRotaNegocio??'',80);}
function rowPlate(row={}){return normalizePlate(row.placa??row.Placa??row.CdPlacaVeiculo??row.cdPlacaVeiculo??'');}
export function lincrosReferencePlateFromTrip(row={}){
  const explicit=normalizePlate(row.lincrosPlate??row.placa_lincros??row.placa_original??'');if(explicit)return explicit;
  const history=Array.isArray(row.trocas_recursos)?row.trocas_recursos:[];
  const first=history.find((item)=>normalizeStatus(item?.campo)==='VEICULO'&&normalizePlate(item?.anterior));
  return normalizePlate(first?.anterior||row.plate||row.placa||'');
}
function rowDate(row={}){return dateIso(row.dataRota??row.DataRota??row.DtRota??row.dtRota??'');}
function parseOcs(value){return [...new Set(clean(value,1000).split(/[^A-Za-z0-9]+/).map(norm).filter(Boolean))];}
function arrayOf(value){if(Array.isArray(value))return value;return value&&typeof value==='object'?[value]:[];}
function deliveryKey(row={}){return clean(row.CdEntrega??row.cdEntrega??'',120)||`${clean(row.CdClienteNegocio??row.cdClienteNegocio??'',120)}|${clean(row.IdSequencia??row.idSequencia??'',40)}|${clean(row.NmCliente??row.nmCliente??'',180)}`;}
function notesFromDelivery(row={}){
  const notes=[];
  for(const pedido of arrayOf(row.Pedidos??row.pedidos)){
    const order=clean(pedido.CdPedidoNegocio??pedido.cdPedidoNegocio??pedido.CodigoPedidoNegocio??pedido.codigoPedidoNegocio??'',100);if(order)notes.push(order);
    for(const nf of arrayOf(pedido.NotasFiscais??pedido.notasFiscais)){
      const code=clean(nf.CdNotaFiscalNegocio??nf.cdNotaFiscalNegocio??nf.CdNotaFiscal??nf.cdNotaFiscal??'',100);if(code)notes.push(code);
    }
  }
  return [...new Set(notes)];
}
function plannedWeightNumber(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  let raw=String(value).trim().replace(/\s+/g,'').replace(/[^0-9,.-]/g,'');if(!raw)return null;
  // Aceita tanto 1234.56 quanto formatos pt-BR como 1.234,56.
  if(raw.includes(',')&&raw.includes('.')){
    if(raw.lastIndexOf(',')>raw.lastIndexOf('.'))raw=raw.replace(/\./g,'').replace(',','.');
    else raw=raw.replace(/,/g,'');
  }else if(raw.includes(',')){raw=raw.replace(',','.');}
  const n=Number(raw);return Number.isFinite(n)?n:null;
}
function plannedWeightScalar(row={}){
  if(!row||typeof row!=='object')return null;
  // StatusRotaDetalhado usa nomenclaturas diferentes conforme a origem da carga.
  // PesoEntrega é peso PLANEJADO da entrega e não deve ser confundido com PesoEntregue.
  const preferred=['PesoPrevisto','pesoPrevisto','PesoPlanejado','pesoPlanejado','PesoPrevistoEntrega','pesoPrevistoEntrega','PesoEntrega','pesoEntrega','VlPesoEntrega','vlPesoEntrega','QtPesoEntrega','qtPesoEntrega','PesoCarga','pesoCarga','VlPesoCarga','vlPesoCarga','QtPesoCarga','qtPesoCarga','PesoPedido','pesoPedido','PesoNotaFiscal','pesoNotaFiscal','PesoNF','pesoNF','PesoMercadoria','pesoMercadoria','PesoTotal','pesoTotal','VlPesoTotal','vlPesoTotal','QtPesoTotal','qtPesoTotal','PesoLiquido','pesoLiquido','PesoLíquido','pesoLíquido','PesoBruto','pesoBruto','Peso','peso'];
  for(const key of preferred){const value=plannedWeightNumber(row[key]);if(value!==null&&value>=0)return value;}
  // Fallback defensivo para variações de nomenclatura do payload Lincros.
  // Importante: excluir PesoENTREGUE, mas NÃO PesoENTREGA. A versão anterior
  // filtrava qualquer chave contendo ENTREG e por isso descartava PesoEntrega.
  const candidates=[];
  for(const [key,value] of Object.entries(row)){
    if(value&&typeof value==='object')continue;
    const nk=norm(key);if(!nk.includes('PESO'))continue;
    if(/ENTREGUE|DEVOLVID|REALIZ|RETORN|REJEIT|RECUS/.test(nk))continue;
    const n=plannedWeightNumber(value);if(n===null||n<0)continue;
    const score=(/PREV|PLAN/.test(nk)?40:0)+(/ENTREGA/.test(nk)?35:0)+(/CARGA|PEDIDO|NOTA|NF|TOTAL/.test(nk)?25:0)+(/LIQ|BRUT|MERCADOR/.test(nk)?10:0);
    candidates.push({n,score});
  }
  candidates.sort((a,b)=>b.score-a.score);return candidates.length?candidates[0].n:null;
}
function plannedWeightDeepScalar(row={},depth=0){
  const direct=plannedWeightScalar(row);if(direct!==null)return direct;
  if(!row||typeof row!=='object'||depth>=4)return null;
  const nested=[];
  for(const [key,value] of Object.entries(row)){
    if(!value||typeof value!=='object')continue;
    const container=norm(key);
    // Restringe a busca a estruturas semanticamente ligadas à entrega para não
    // capturar pesos de metadados sem relação com o cliente.
    if(!/(PEDID|NOTA|FISC|ITEM|PRODUT|MERCADOR|CARGA|ENTREGA|VOLUME|DOCUMENT|DADO)/.test(container))continue;
    const values=Array.isArray(value)?value:[value];
    for(const child of values){const weight=plannedWeightDeepScalar(child,depth+1);if(weight!==null)nested.push(weight);}
  }
  if(!nested.length)return null;
  // Em coleções (NFs/itens) cada objeto representa uma parcela da entrega.
  return Math.round(nested.reduce((sum,value)=>sum+value,0)*1000)/1000;
}
export function plannedWeightFromDelivery(row={}){
  const direct=plannedWeightScalar(row);if(direct!==null)return direct;
  let orderTotal=0,orderFound=false;
  for(const pedido of arrayOf(row.Pedidos??row.pedidos)){
    let invoiceTotal=0,invoiceFound=false;
    for(const nf of arrayOf(pedido.NotasFiscais??pedido.notasFiscais)){const weight=plannedWeightDeepScalar(nf);if(weight!==null){invoiceTotal+=weight;invoiceFound=true;}}
    if(invoiceFound){orderTotal+=invoiceTotal;orderFound=true;continue;}
    const orderWeight=plannedWeightDeepScalar(pedido);if(orderWeight!==null){orderTotal+=orderWeight;orderFound=true;}
  }
  if(orderFound)return Math.round(orderTotal*1000)/1000;
  return plannedWeightDeepScalar(row);
}
function plannedWeightReferenceTokens(row={}){
  const tokens=new Set();if(!row||typeof row!=='object')return tokens;
  const add=(value)=>{if(value===null||value===undefined||typeof value==='object')return;const token=norm(value);if(token&&token.length>=2)tokens.add(token);};
  for(const [key,value] of Object.entries(row)){
    if(value&&typeof value==='object')continue;
    const nk=norm(key);
    if(/CLIENTE|ENTREGA|PEDIDO|NOTA|NF|DOCUMENTO|DOC/.test(nk)&&/COD|CD|ID|NUM|NR|NEGOCIO|CHAVE|REF|CLIENTE|ENTREGA|PEDIDO|NOTA|NF/.test(nk))add(value);
    // Dentro de objetos de NF/pedido a Lincros também pode usar nomes genéricos
    // como Numero/Codigo/Oid. Guardamos esses tokens; eles só serão usados se
    // coincidirem com uma referência real já conhecida da entrega.
    if(/^(NUMERO|NUM|NR|CODIGO|COD|CD|ID|OID|CHAVE|REFERENCIA|REF)$/.test(nk))add(value);
  }
  add(row.CdEntrega??row.cdEntrega);add(row.CdClienteNegocio??row.cdClienteNegocio);
  for(const ref of notesFromDelivery(row))add(ref);
  return tokens;
}
function plannedWeightDocumentRecords(root={}){
  const records=[];const seen=new Set();
  // Alguns payloads mantêm o número da NF/pedido no objeto pai e o peso apenas
  // nos itens filhos. A versão anterior perdia essa associação porque cada nó era
  // analisado isoladamente. Herdamos as referências dos ancestrais para que o peso
  // do item continue vinculado à NF/cliente/entrega correta.
  const walk=(value,path='root',depth=0,inheritedRefs=new Set())=>{
    if(!value||typeof value!=='object'||depth>7)return;
    if(Array.isArray(value)){value.forEach((item,index)=>walk(item,`${path}[${index}]`,depth+1,new Set(inheritedRefs)));return;}
    const ownRefs=plannedWeightReferenceTokens(value),refs=new Set([...inheritedRefs,...ownRefs]);
    const weight=plannedWeightScalar(value);
    if(weight!==null&&refs.size){const key=`${path}|${weight}|${[...refs].sort().join(',')}`;if(!seen.has(key)){seen.add(key);records.push({weight,refs,ownRefs,path,depth});}}
    for(const [key,child] of Object.entries(value))if(child&&typeof child==='object')walk(child,`${path}.${key}`,depth+1,refs);
  };
  walk(root);return records;
}
export function plannedWeightFromRootDocuments(root={},delivery={}){
  const direct=plannedWeightFromDelivery(delivery);if(direct!==null)return direct;
  const refs=plannedWeightReferenceTokens(delivery);if(!refs.size)return null;
  const deliveryCode=norm(delivery.CdEntrega??delivery.cdEntrega??''),clientCode=norm(delivery.CdClienteNegocio??delivery.cdClienteNegocio??''),docRefs=new Set(notesFromDelivery(delivery).map(norm).filter(Boolean));
  const matches=plannedWeightDocumentRecords(root).map((record)=>{
    const overlap=[...record.refs].filter((ref)=>refs.has(ref));
    if(!overlap.length)return null;
    let score=0;if(deliveryCode&&record.refs.has(deliveryCode))score=100;else if([...docRefs].some((ref)=>record.refs.has(ref)))score=80;else if(clientCode&&record.refs.has(clientCode))score=60;
    return score?{...record,score}:null;
  }).filter(Boolean);
  if(!matches.length)return null;
  const best=Math.max(...matches.map((item)=>item.score)),bestRows=matches.filter((item)=>item.score===best);
  // Se existir peso total no próprio documento/NF e também pesos nos itens filhos,
  // não podemos somar os dois. Preferimos o nível mais raso que já contém peso; se o
  // peso existir somente nos itens, todos os irmãos desse mesmo nível são somados.
  const minDepth=Math.min(...bestRows.map((item)=>Number(item.depth??99))),depthRows=bestRows.filter((item)=>Number(item.depth??99)===minDepth);
  const unique=new Map(depthRows.map((item)=>[`${item.path}|${item.weight}`,item]));
  const total=[...unique.values()].reduce((sum,item)=>sum+Number(item.weight||0),0);
  return Number.isFinite(total)&&total>=0?Math.round(total*1000)/1000:null;
}
function deliveredState(row={}){
  const rawStatus=clean(row.Situacao??row.situacao??row.Status??row.status??'',80),status=normalizeStatus(rawStatus);
  const explicitlyNotDelivered=status.includes('NAO_ENTREGUE')||status.includes('NAOENTREGUE')||status.includes('PENDENTE');
  const returned=truthy(row.IdDevolvida??row.idDevolvida)||status.includes('DEVOLV');
  const hasActualSequence=num(row.IdSequenciaRealizada??row.idSequenciaRealizada)!==null;
  const hasActualTime=Boolean(clean(row.DtRealizada??row.dtRealizada??row.DtPartidaRealizada??row.dtPartidaRealizada??'',80));
  const delivered=!explicitlyNotDelivered&&!returned&&(truthy(row.IdEntregaRealizada??row.idEntregaRealizada)||hasActualSequence||hasActualTime||status==='ENTREGUE'||status.includes('ENTREGA_REALIZADA')||status.includes('REALIZAD'));
  return {delivered,returned,pending:!delivered&&!returned,status:rawStatus||'Pendente'};
}
function retentionMinutes(row={}){
  const inRadius=parseDurationMinutes(row.TempoTotalNoRaio??row.tempoTotalNoRaio);if(inRadius!==null)return {minutes:inRadius,source:'TEMPO_TOTAL_NO_RAIO'};
  const byTimes=diffMinutes(row.DtChegadaRealizada??row.dtChegadaRealizada,row.DtPartidaRealizada??row.dtPartidaRealizada);if(byTimes!==null)return {minutes:byTimes,source:'CHEGADA_PARTIDA'};
  const service=parseDurationMinutes(row.QtTempoAtendimentoRealizado??row.qtTempoAtendimentoRealizado);if(service!==null)return {minutes:service,source:'TEMPO_ATENDIMENTO'};
  return {minutes:null,source:''};
}
function publicDelivery(row={},context={}){
  const state=deliveredState(row),ret=retentionMinutes(row),planned=plannedWeightFromDelivery(row);
  return {
    deliveryCode:clean(row.CdEntrega??row.cdEntrega??'',120),clientCode:clean(row.CdClienteNegocio??row.cdClienteNegocio??'',120),clientName:clean(row.NmCliente??row.nmCliente??'',220),
    sequencePlanned:num(row.IdSequencia??row.idSequencia),sequenceActual:num(row.IdSequenciaRealizada??row.idSequenciaRealizada),status:state.status,delivered:state.delivered,returned:state.returned,pending:state.pending,
    arrivedAt:lincrosDate(row.DtChegadaRealizada??row.dtChegadaRealizada),leftAt:lincrosDate(row.DtPartidaRealizada??row.dtPartidaRealizada),retentionMinutes:ret.minutes,retentionSource:ret.source,
    distancePlanned:num(row.VlDistanciaPrevista??row.vlDistanciaPrevista),distanceActual:num(row.VlDistanciaRealizada??row.vlDistanciaRealizada),weightPlanned:planned!==null?planned:(context.weightPlanned??null),weightDelivered:num(row.PesoEntregue??row.pesoEntregue),weightReturned:num(row.PesoDevolvido??row.pesoDevolvido),
    withinRadius:optionalBool(row.ApontamentoDentroDoRaio??row.apontamentoDentroDoRaio),
    latitude:num(row.NrLatitudeDispersao??row.nrLatitudeDispersao??row.NrLatitudeOcorrencia??row.nrLatitudeOcorrencia),longitude:num(row.NrLongitudeDispersao??row.nrLongitudeDispersao??row.NrLongitudeOcorrencia??row.nrLongitudeOcorrencia),
    notes:notesFromDelivery(row),proofUrl:clean(row.LinkComprovante??row.linkComprovante??'',1000)
  };
}
function sumFinite(rows,key){let total=0,found=false;for(const row of rows){const n=num(row?.[key]);if(n!==null){total+=n;found=true;}}return found?Math.round(total*1000)/1000:null;}
function latestRootPosition(roots=[]){
  const positions=roots.map((root)=>({latitude:num(root.NrUltimaLatitude??root.nrUltimaLatitude),longitude:num(root.NrUltimaLongitude??root.nrUltimaLongitude),positionAt:lincrosDate(root.DtUltimaAtividade??root.dtUltimaAtividade),driver:clean(root.NmMotorista??root.nmMotorista??'',220),status:clean(root.Situacao??root.situacao??'',80)})).filter((x)=>x.latitude!==null&&x.longitude!==null);
  positions.sort((a,b)=>(Date.parse(b.positionAt)||0)-(Date.parse(a.positionAt)||0));return positions[0]||{};
}
function stableObject(value){if(Array.isArray(value))return value.map(stableObject);if(value&&typeof value==='object'){return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stableObject(value[key])]));}return value;}
async function dataHash(value){const text=JSON.stringify(stableObject(value));const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');}

let schemaPromise=null;
export async function ensureLincrosSchema(db){
  if(!schemaPromise)schemaPromise=db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS LINCROS_ROUTE_SYNC (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,SCHEDULE_ID TEXT NOT NULL UNIQUE,DATE_KEY TEXT,PLATE TEXT,DMS_ROUTE TEXT,LINCROS_ROUTE_CODES TEXT NOT NULL DEFAULT '[]',
      DELIVERIES_PLANNED INTEGER NOT NULL DEFAULT 0,DELIVERIES_DONE INTEGER NOT NULL DEFAULT 0,DELIVERIES_RETURNED INTEGER NOT NULL DEFAULT 0,
      LATITUDE REAL,LONGITUDE REAL,POSITION_AT TEXT,DRIVER TEXT,STATUS TEXT,DISTANCE_PLANNED REAL,DISTANCE_ACTUAL REAL,RETENTION_MINUTES REAL,
      SOURCE_UPDATED_AT TEXT,CHECKED_AT TEXT,SYNCED_AT TEXT,DATA_HASH TEXT,LAST_ERROR TEXT,RAW_SUMMARY_JSON TEXT NOT NULL DEFAULT '{}'
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_LINCROS_SYNC_PLATE_DATE ON LINCROS_ROUTE_SYNC(PLATE,DATE_KEY)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_LINCROS_SYNC_CHECKED ON LINCROS_ROUTE_SYNC(CHECKED_AT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS LINCROS_DELIVERIES (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,SCHEDULE_ID TEXT NOT NULL,LINCROS_ROUTE_CODE TEXT,DELIVERY_CODE TEXT,CLIENT_CODE TEXT,CLIENT_NAME TEXT,
      SEQUENCE_PLANNED REAL,SEQUENCE_ACTUAL REAL,STATUS TEXT,DELIVERED INTEGER NOT NULL DEFAULT 0,RETURNED INTEGER NOT NULL DEFAULT 0,PENDING INTEGER NOT NULL DEFAULT 1,
      ARRIVED_AT TEXT,LEFT_AT TEXT,RETENTION_MINUTES REAL,RETENTION_SOURCE TEXT,DISTANCE_PLANNED REAL,DISTANCE_ACTUAL REAL,WEIGHT_PLANNED REAL,WEIGHT_DELIVERED REAL,WEIGHT_RETURNED REAL,
      LATITUDE REAL,LONGITUDE REAL,WITHIN_RADIUS INTEGER,NOTES_JSON TEXT NOT NULL DEFAULT '[]',PROOF_URL TEXT,UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(SCHEDULE_ID,LINCROS_ROUTE_CODE,DELIVERY_CODE)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_LINCROS_DELIVERIES_SCHEDULE ON LINCROS_DELIVERIES(SCHEDULE_ID,DELIVERED,PENDING)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_LINCROS_DELIVERIES_CLIENT_STATE ON LINCROS_DELIVERIES(CLIENT_CODE,PENDING,DELIVERED)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS LINCROS_DAY_SYNC (
      DATE_KEY TEXT PRIMARY KEY, ROUTE_COUNT INTEGER NOT NULL DEFAULT 0, CHECKED_AT TEXT, SYNCED_AT TEXT, DATA_HASH TEXT, LAST_ERROR TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS LINCROS_DAY_ROUTES (
      DATE_KEY TEXT NOT NULL, ROUTE_CODE TEXT NOT NULL, PLATE TEXT, SOURCE_UPDATED_AT TEXT, ROUTE_JSON TEXT NOT NULL,
      PRIMARY KEY(DATE_KEY,ROUTE_CODE)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS IDX_LINCROS_DAY_ROUTES_PLATE ON LINCROS_DAY_ROUTES(DATE_KEY,PLATE)`),
  ]).then(async(result)=>{const info=await db.prepare(`PRAGMA table_info(LINCROS_DELIVERIES)`).all().catch(()=>({results:[]}));const names=new Set((info.results||[]).map((row)=>String(row.name||row.NAME||'').toUpperCase()));if(!names.has('WITHIN_RADIUS'))await db.prepare(`ALTER TABLE LINCROS_DELIVERIES ADD COLUMN WITHIN_RADIUS INTEGER`).run();if(!names.has('WEIGHT_PLANNED'))await db.prepare(`ALTER TABLE LINCROS_DELIVERIES ADD COLUMN WEIGHT_PLANNED REAL`).run();return result;}).catch((error)=>{schemaPromise=null;throw error;});
  return schemaPromise;
}


let sharedGpsSchemaPromise=null;
async function ensureSharedGpsSchema(db){
  if(!sharedGpsSchemaPromise)sharedGpsSchemaPromise=db.batch([
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
  ]).catch((error)=>{sharedGpsSchemaPromise=null;throw error;});
  return sharedGpsSchemaPromise;
}
function lincrosGpsTime(value){
  const raw=clean(value,100);if(!raw)return '';
  let m=raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if(m)return `${m[1]}-${m[2]}-${m[3]}T${String(m[4]).padStart(2,'0')}:${m[5]}:${m[6]||'00'}`;
  m=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m)return `${m[3]}-${m[2]}-${m[1]}T${String(m[4]||'00').padStart(2,'0')}:${m[5]||'00'}:${m[6]||'00'}`;
  return '';
}
export async function storeLincrosGpsPosition(db,env,schedule={},aggregate={}){
  const plate=normalizePlate(schedule.plate||schedule.placa),lat=num(aggregate.latitude),lng=num(aggregate.longitude),gpsAt=lincrosGpsTime(aggregate.positionAt||aggregate.sourceUpdatedAt);
  if(!plate||lat===null||lng===null||!gpsAt)return {stored:false,reason:'POSITION_INCOMPLETE'};
  await ensureSharedGpsSchema(db);
  const scheduleId=clean(schedule.scheduleId||schedule.id||schedule.schedule_record_id,120),route=clean(schedule.route||schedule.rota,220);
  const routeCodes=Array.isArray(aggregate.routeCodes)?aggregate.routeCodes:[];
  const raw={
    __DMS_SOURCE:'LINCROS',
    __DMS_TIMESTAMP_SOURCE:'LINCROS_STATUS_ROTA',
    __DMS_TIMESTAMP_RELIABLE:true,
    __DMS_LINCROS_SCHEDULE_ID:scheduleId,
    __DMS_LINCROS_ROUTE_CODES:routeCodes,
    __DMS_LINCROS_PLATES:Array.isArray(aggregate.lincrosPlates)?aggregate.lincrosPlates:[],
    __DMS_LINCROS_STATUS:clean(aggregate.status||'',80),
  };
  let label=`Lincros · ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  try{
    const geocoded=await reverseGeocode(db,env,lat,lng);
    if(clean(geocoded?.label,500)){label=clean(geocoded.label,500);raw.__DMS_REVERSE_GEOCODE_LABEL=label;raw.__DMS_REVERSE_GEOCODE_PROVIDER=clean(geocoded.provider||'NOMINATIM',80);}
  }catch(error){
    // A geocodificação é complementar: se o provedor estiver indisponível, a posição
    // continua válida e fica com coordenadas até uma próxima sincronização.
    raw.__DMS_REVERSE_GEOCODE_ERROR=clean(error?.message||String(error),240);
  }
  const rawJson=JSON.stringify(raw);
  const statements=[
    db.prepare(`INSERT INTO ROUTE_GPS_POSITIONS
      (PLATE,LATITUDE,LONGITUDE,GPS_TIME,FETCHED_AT,LOCATION_TEXT,POINT_TEXT,SPEED,IGNITION,VEHICLE_ID,VEHICLE_TYPE,RAW_JSON)
      VALUES (?,?,?,?,CURRENT_TIMESTAMP,?,?,?,?,?,?,?)
      ON CONFLICT(PLATE,GPS_TIME,LATITUDE,LONGITUDE) DO UPDATE SET
        FETCHED_AT=CURRENT_TIMESTAMP,LOCATION_TEXT=excluded.LOCATION_TEXT,POINT_TEXT=excluded.POINT_TEXT,
        VEHICLE_ID=excluded.VEHICLE_ID,VEHICLE_TYPE=excluded.VEHICLE_TYPE,RAW_JSON=excluded.RAW_JSON`)
      .bind(plate,lat,lng,gpsAt,label,label,0,0,scheduleId||null,'LINCROS',rawJson),
    db.prepare(`INSERT INTO ROUTE_GPS_LATEST
      (PLATE,LATITUDE,LONGITUDE,GPS_TIME,FETCHED_AT,LOCATION_TEXT,POINT_TEXT,SPEED,IGNITION,VEHICLE_ID,VEHICLE_TYPE,DISTANCE_TO_POINT,RAW_JSON,UPDATED_AT)
      VALUES (?,?,?,?,CURRENT_TIMESTAMP,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(PLATE) DO UPDATE SET
        LATITUDE=excluded.LATITUDE,LONGITUDE=excluded.LONGITUDE,GPS_TIME=excluded.GPS_TIME,FETCHED_AT=CURRENT_TIMESTAMP,
        LOCATION_TEXT=excluded.LOCATION_TEXT,POINT_TEXT=excluded.POINT_TEXT,SPEED=excluded.SPEED,IGNITION=excluded.IGNITION,
        VEHICLE_ID=excluded.VEHICLE_ID,VEHICLE_TYPE=excluded.VEHICLE_TYPE,DISTANCE_TO_POINT=excluded.DISTANCE_TO_POINT,
        RAW_JSON=excluded.RAW_JSON,UPDATED_AT=CURRENT_TIMESTAMP
      WHERE excluded.GPS_TIME>=ROUTE_GPS_LATEST.GPS_TIME`)
      .bind(plate,lat,lng,gpsAt,label,label,0,0,scheduleId||null,'LINCROS',null,rawJson),
  ];
  await db.batch(statements);
  return {stored:true,plate,gpsAt,latitude:lat,longitude:lng,location:label,point:label,source:'LINCROS',scheduleId,route};
}
function config(env){
  let base=clean(env?.LINCROS_BASE_URL||'https://notaro-tracking.lincros.com',500).replace(/\/+$/,'');
  try{const parsed=new URL(base);if(parsed.pathname&&parsed.pathname!=='/'&&/\/swagger(?:\/|$)/i.test(parsed.pathname))base=parsed.origin;}catch{}
  const apiKey=clean(env?.LINCROS_API_KEY||'',2000);
  if(!apiKey){const e=new Error('LINCROS_API_KEY não configurada no Worker/Pages que atende o DMS.');e.code='LINCROS_NOT_CONFIGURED';e.status=503;throw e;}
  return {base,apiKey};
}
async function fetchJson(url,apiKey,timeoutMs=30000,step='consulta'){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{headers:{Accept:'application/json',apikey:apiKey},signal:controller.signal,redirect:'follow'});
    const text=await response.text();
    if(!response.ok){const excerpt=clean(text.replace(/\s+/g,' '),260);const e=new Error(`Lincros (${step}) respondeu HTTP ${response.status}${excerpt?`: ${excerpt}`:''}.`);e.code='LINCROS_HTTP_ERROR';e.status=502;e.upstreamStatus=response.status;e.step=step;throw e;}
    try{return JSON.parse(text||'[]');}catch{const e=new Error(`A Lincros retornou JSON inválido na etapa ${step}.`);e.code='LINCROS_INVALID_JSON';e.status=502;e.step=step;throw e;}
  }catch(error){if(controller.signal.aborted){const e=new Error(`A consulta à Lincros excedeu o tempo limite na etapa ${step}.`);e.code='LINCROS_TIMEOUT';e.status=504;e.step=step;throw e;}throw error;}finally{clearTimeout(timer);}
}
export async function fetchJourneys(env,{date,plate}){
  const {base,apiKey}=config(env);const url=new URL(`${base}/api/v1/jornada/BuscarJornadasRotas`);url.searchParams.set('dataRota',`${dateIso(date)}T00:00:00`);url.searchParams.set('placa',normalizePlate(plate));
  const payload=await fetchJson(url.toString(),apiKey,30000,'Jornada por placa/data');return arrayOf(payload);
}
export async function fetchRouteDetails(env,routeCode){
  const {base,apiKey}=config(env),code=clean(routeCode,100);const url=new URL(`${base}/api/statusRota/v4/StatusRotaDetalhado`);url.searchParams.set('CodigoRotaNegocio',code);
  const payload=await fetchJson(url.toString(),apiKey,30000,`StatusRota ${clean(routeCode,80)}`),rows=arrayOf(payload);
  const exact=rows.filter((row)=>norm(routeCodeOf(row))===norm(code));
  return exact.length?exact:rows.filter((row)=>!routeCodeOf(row));
}

export async function fetchRoutesByDate(env,date){
  const {base,apiKey}=config(env),dateKey=dateIso(date);if(!dateKey)throw new Error('Data inválida para snapshot diário da Lincros.');
  const url=new URL(`${base}/api/statusRota/v4/StatusRotaDetalhado`);url.searchParams.set('DataRota',`${dateKey}T00:00:00`);
  const payload=await fetchJson(url.toString(),apiKey,90000,`StatusRota diário ${dateKey}`);return arrayOf(payload);
}

const daySnapshotPromises=new Map();
function snapshotFresh(row,maxAgeMinutes=5){const checked=Date.parse(String(row?.CHECKED_AT||''));return Boolean(row&&!row.LAST_ERROR&&Number(row.ROUTE_COUNT||0)>0&&Number.isFinite(checked)&&Date.now()-checked<=maxAgeMinutes*60000);}
async function daySnapshotMeta(db,date){return db.prepare(`SELECT DATE_KEY,ROUTE_COUNT,CHECKED_AT,SYNCED_AT,DATA_HASH,LAST_ERROR FROM LINCROS_DAY_SYNC WHERE DATE_KEY=?`).bind(dateIso(date)).first().catch(()=>null);}
export async function dayRoutesByPlate(db,date,plate){
  const dateKey=dateIso(date),p=normalizePlate(plate);if(!dateKey||!p)return [];
  const {results=[]}=await db.prepare(`SELECT ROUTE_CODE,PLATE,ROUTE_JSON FROM LINCROS_DAY_ROUTES WHERE DATE_KEY=? AND PLATE=? ORDER BY ROUTE_CODE`).bind(dateKey,p).all();
  return results.map((row)=>{try{return JSON.parse(String(row.ROUTE_JSON||'{}'))||{};}catch{return {};}}).filter((row)=>routeCodeOf(row)||rowPlate(row));
}
async function dayRoutesByDate(db,date){
  const dateKey=dateIso(date);if(!dateKey)return [];
  const {results=[]}=await db.prepare(`SELECT ROUTE_CODE,PLATE,ROUTE_JSON FROM LINCROS_DAY_ROUTES WHERE DATE_KEY=? ORDER BY ROUTE_CODE`).bind(dateKey).all();
  return results.map((row)=>{try{return JSON.parse(String(row.ROUTE_JSON||'{}'))||{};}catch{return {};}}).filter((row)=>routeCodeOf(row)||rowPlate(row));
}
export async function ensureDailyLincrosSnapshot(db,env,date,{force=false,maxAgeMinutes=5}={}){
  await ensureLincrosSchema(db);const dateKey=dateIso(date);if(!dateKey)throw new Error('Data inválida para snapshot diário da Lincros.');
  const meta=await daySnapshotMeta(db,dateKey);if(!force&&snapshotFresh(meta,maxAgeMinutes))return {ok:true,changed:false,cached:true,date:dateKey,routeCount:Number(meta.ROUTE_COUNT||0),checkedAt:meta.CHECKED_AT||'',syncedAt:meta.SYNCED_AT||''};
  if(daySnapshotPromises.has(dateKey))return daySnapshotPromises.get(dateKey);
  const task=(async()=>{const checkedAt=new Date().toISOString();try{
    const roots=(await fetchRoutesByDate(env,dateKey)).filter((row)=>routeCodeOf(row)&&rowDate(row)===dateKey);if(!roots.length)throw new Error(`StatusRota por data não retornou rotas para ${dateKey}.`);
    const hash=await dataHash(roots),previous=await daySnapshotMeta(db,dateKey);
    if(previous?.DATA_HASH===hash){await db.prepare(`UPDATE LINCROS_DAY_SYNC SET ROUTE_COUNT=?,CHECKED_AT=?,LAST_ERROR=NULL WHERE DATE_KEY=?`).bind(roots.length,checkedAt,dateKey).run();return {ok:true,changed:false,cached:false,date:dateKey,routeCount:roots.length,checkedAt,syncedAt:previous.SYNCED_AT||checkedAt};}
    const statements=[db.prepare(`DELETE FROM LINCROS_DAY_ROUTES WHERE DATE_KEY=?`).bind(dateKey)];
    for(const root of roots){statements.push(db.prepare(`INSERT OR REPLACE INTO LINCROS_DAY_ROUTES (DATE_KEY,ROUTE_CODE,PLATE,SOURCE_UPDATED_AT,ROUTE_JSON) VALUES (?,?,?,?,?)`).bind(dateKey,routeCodeOf(root),rowPlate(root),lincrosDate(root.DtUltimaAtividade??root.dtUltimaAtividade)||null,JSON.stringify(root)));}
    statements.push(db.prepare(`INSERT INTO LINCROS_DAY_SYNC (DATE_KEY,ROUTE_COUNT,CHECKED_AT,SYNCED_AT,DATA_HASH,LAST_ERROR) VALUES (?,?,?,?,?,NULL) ON CONFLICT(DATE_KEY) DO UPDATE SET ROUTE_COUNT=excluded.ROUTE_COUNT,CHECKED_AT=excluded.CHECKED_AT,SYNCED_AT=excluded.SYNCED_AT,DATA_HASH=excluded.DATA_HASH,LAST_ERROR=NULL`).bind(dateKey,roots.length,checkedAt,checkedAt,hash));
    for(let i=0;i<statements.length;i+=35)await db.batch(statements.slice(i,i+35));return {ok:true,changed:true,cached:false,date:dateKey,routeCount:roots.length,checkedAt,syncedAt:checkedAt};
  }catch(error){await db.prepare(`INSERT INTO LINCROS_DAY_SYNC (DATE_KEY,ROUTE_COUNT,CHECKED_AT,SYNCED_AT,DATA_HASH,LAST_ERROR) VALUES (?,0,?,NULL,NULL,?) ON CONFLICT(DATE_KEY) DO UPDATE SET CHECKED_AT=excluded.CHECKED_AT,LAST_ERROR=excluded.LAST_ERROR`).bind(dateKey,checkedAt,clean(error?.message||String(error),1000)).run().catch(()=>{});throw error;}finally{daySnapshotPromises.delete(dateKey);}})();daySnapshotPromises.set(dateKey,task);return task;
}
async function activeScheduleCount(db,date,plate){
  // ROUTE_MONITORING pode possuir mais de uma linha para a mesma escala. Contar linhas
  // fazia uma única rota operacional parecer várias rotas DMS e impedia a consolidação
  // de múltiplos CdRotaNegocio da Lincros (ex.: OCs separadas em viagens diferentes).
  const result=await db.prepare(`SELECT COUNT(DISTINCT COALESCE(NULLIF(TRIM(SCHEDULE_ID),''),CAST(ID AS TEXT))) QTD FROM ROUTE_MONITORING WHERE DATE_KEY=? AND REPLACE(REPLACE(UPPER(PLATE),'-',''),' ','')=?`).bind(dateIso(date),normalizePlate(plate)).first().catch(()=>null);
  return Number(result?.QTD||0);
}
function chooseRouteCodes(journeys,{date,plate,ocs,singleDmsSchedule=false}){
  const d=dateIso(date),p=normalizePlate(plate),ocTokens=parseOcs(ocs);const rows=arrayOf(journeys).filter((row)=>rowPlate(row)===p&&(!rowDate(row)||rowDate(row)===d));
  const codes=[...new Set(rows.map(routeCodeOf).filter(Boolean))];const ocSet=new Set(ocTokens);const matches=codes.filter((code)=>ocSet.has(norm(code)));
  // Quando há apenas uma escala DMS para a placa/data, todas as viagens Lincros dessa
  // placa/data pertencem à mesma rota operacional, mesmo quando somente um dos códigos
  // coincide diretamente com uma OC. Isso evita perder entregas quando a Lincros divide
  // as OCs/NFs em CdRotaNegocio diferentes.
  if(codes.length>1&&singleDmsSchedule)return {codes,strategy:'PLATE_DATE_SINGLE_DMS_ROUTE',candidates:codes};
  if(matches.length)return {codes:matches,strategy:'OC_ROUTE_CODE',candidates:codes};
  if(codes.length===1)return {codes,strategy:'UNIQUE_PLATE_DATE',candidates:codes};
  return {codes:[],strategy:codes.length?'AMBIGUOUS_PLATE_DATE':'NO_ROUTE_FOUND',candidates:codes};
}
function aggregateDetails(routeCodes,responses=[]){
  const roots=responses.flatMap(arrayOf);const deliveryMap=new Map();
  roots.forEach((root,rootIndex)=>{const code=routeCodeOf(root)||routeCodes[rootIndex]||'';for(const raw of arrayOf(root.Entregas??root.entregas)){const key=deliveryKey(raw);if(!key)continue;const weightPlanned=plannedWeightFromRootDocuments(root,raw);const item={...publicDelivery(raw,{weightPlanned}),lincrosRouteCode:code};const prev=deliveryMap.get(key);if(!prev||item.delivered||item.returned)deliveryMap.set(key,item);}});
  const deliveries=[...deliveryMap.values()].sort((a,b)=>(Number(a.sequencePlanned)||99999)-(Number(b.sequencePlanned)||99999)||a.clientName.localeCompare(b.clientName,'pt-BR'));
  const rootPlanned=roots.map((row)=>num(row.QtEntregaPrevista??row.qtEntregaPrevista)).filter((x)=>x!==null);
  const rootDone=roots.map((row)=>num(row.QtEntregaRealizada??row.qtEntregaRealizada)).filter((x)=>x!==null);
  const rootReturned=roots.map((row)=>num(row.QtEntregaDevolvida??row.qtEntregaDevolvida)).filter((x)=>x!==null);
  const planned=rootPlanned.length?rootPlanned.reduce((sum,x)=>sum+Math.max(0,x),0):deliveries.length;
  // O total operacional apontado deve considerar todo atendimento finalizado.
  // A Lincros pode manter QtEntregaRealizada=0 quando o cliente foi finalizado com
  // devolução; nesses casos o detalhe da entrega já possui o apontamento real.
  // Usamos o maior valor entre o resumo da rota e os detalhes finalizados para
  // que o card/pendências não voltem a contar um cliente já atendido como pendente.
  const detailedFinalized=deliveries.filter((x)=>x.delivered||x.returned).length;
  const rootDoneTotal=rootDone.length?rootDone.reduce((sum,x)=>sum+Math.max(0,x),0):0;
  const done=Math.max(rootDoneTotal,detailedFinalized);
  const returned=rootReturned.length?Math.max(rootReturned.reduce((sum,x)=>sum+Math.max(0,x),0),deliveries.filter((x)=>x.returned).length):deliveries.filter((x)=>x.returned).length;
  const pos=latestRootPosition(roots);const distancePlanned=sumFinite(deliveries,'distancePlanned'),distanceActual=sumFinite(deliveries,'distanceActual');
  const retentionValues=deliveries.map((x)=>num(x.retentionMinutes)).filter((x)=>x!==null);const retentionMinutes=retentionValues.length?Math.round(retentionValues.reduce((a,b)=>a+b,0)*10)/10:null;
  const statuses=roots.map((x)=>clean(x.Situacao??x.situacao??'',80)).filter(Boolean);const sourceUpdated=[...roots.map((x)=>lincrosDate(x.DtUltimaAtividade??x.dtUltimaAtividade)).filter(Boolean)].sort().at(-1)||pos.positionAt||'';
  return {routeCodes:[...new Set(routeCodes)].sort(),deliveries,deliveriesPlanned:planned,deliveriesDone:done,deliveriesReturned:returned,latitude:pos.latitude??null,longitude:pos.longitude??null,positionAt:pos.positionAt||'',driver:pos.driver||clean(roots[0]?.NmMotorista??'',220),status:statuses.find((x)=>normalizeStatus(x).includes('ANDAMENTO'))||statuses[0]||'',distancePlanned,distanceActual,retentionMinutes,sourceUpdatedAt:sourceUpdated};
}

async function advanceMonitoringAfterLastDelivery(db,scheduleId,aggregate={}){
  const planned=Math.max(0,Number(aggregate.deliveriesPlanned||0));
  const done=Math.max(0,Number(aggregate.deliveriesDone||0));
  if(!scheduleId||planned<=0||done<planned)return {changed:false};
  const row=await db.prepare(`SELECT ID,STATUS,DATA_JSON FROM ROUTE_MONITORING WHERE SCHEDULE_ID=? ORDER BY ID DESC LIMIT 1`).bind(clean(scheduleId,120)).first().catch(()=>null);
  if(!row)return {changed:false};
  const current=normalizeStatus(row.STATUS||'');
  if(!['EM ROTA','NO DESTINO','DESCARREGADO','RETORNO PREVISTO','PERNOITE'].includes(current))return {changed:false,status:current};
  let data={};try{data=JSON.parse(String(row.DATA_JSON||'{}'))||{};}catch{}
  const changedAt=new Date().toISOString();
  const next={...data,status:'EM RETORNO',status_monitoramento:'EM RETORNO',
    entregas_previstas:planned,entregas_realizadas:done,entregas_pendentes:0,
    transicao_automatica_lincros:true,motivo_transicao_automatica:'ULTIMA_ENTREGA_APONTADA',
    transicao_automatica_em:changedAt};
  await db.prepare(`UPDATE ROUTE_MONITORING SET STATUS='EM RETORNO',VERSION=COALESCE(VERSION,0)+1,DATA_JSON=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=? AND STATUS<>'FINALIZADO'`).bind(JSON.stringify(next),Number(row.ID)).run().catch(()=>{});
  return {changed:true,status:'EM RETORNO'};
}

async function upsertAggregate(db,env,schedule,aggregate,hash){
  await ensureLincrosSchema(db);
  // A posição da Lincros também passa a alimentar o histórico GPS comum do DMS.
  // Isso permite auditar a viagem e reaproveitar a mesma automação de geofence usada
  // pela ProtectSat para placas cuja fonte de localização é a Lincros.
  const gpsStored=await storeLincrosGpsPosition(db,env,schedule,aggregate).catch((error)=>{console.error('Lincros GPS history warning',error);return null;});
  if(clean(gpsStored?.location,500))aggregate.locationLabel=clean(gpsStored.location,500);
  const scheduleId=clean(schedule.scheduleId||schedule.id,120),checkedAt=new Date().toISOString();
  const existing=await db.prepare(`SELECT DATA_HASH FROM LINCROS_ROUTE_SYNC WHERE SCHEDULE_ID=?`).bind(scheduleId).first();
  const summary={routeCodes:aggregate.routeCodes,deliveriesPlanned:aggregate.deliveriesPlanned,deliveriesDone:aggregate.deliveriesDone,deliveriesReturned:aggregate.deliveriesReturned,latitude:aggregate.latitude,longitude:aggregate.longitude,positionAt:aggregate.positionAt,locationLabel:clean(aggregate.locationLabel||'',500),driver:aggregate.driver,status:aggregate.status,distancePlanned:aggregate.distancePlanned,distanceActual:aggregate.distanceActual,retentionMinutes:aggregate.retentionMinutes,sourceUpdatedAt:aggregate.sourceUpdatedAt,referenceDate:aggregate.referenceDate||dateIso(schedule.date||schedule.data),referenceDates:Array.isArray(aggregate.referenceDates)?aggregate.referenceDates:[],dateShiftDays:Number(aggregate.dateShiftDays||0),matchStrategy:clean(aggregate.matchStrategy||'',80),lincrosPlates:Array.isArray(aggregate.lincrosPlates)?aggregate.lincrosPlates:[]};
  if(existing?.DATA_HASH===hash){await db.prepare(`UPDATE LINCROS_ROUTE_SYNC SET CHECKED_AT=?,LAST_ERROR=NULL WHERE SCHEDULE_ID=?`).bind(checkedAt,scheduleId).run();const stage=await advanceMonitoringAfterLastDelivery(db,scheduleId,aggregate);return {changed:false,stageChanged:Boolean(stage?.changed)};}
  const statements=[
    db.prepare(`INSERT INTO LINCROS_ROUTE_SYNC (SCHEDULE_ID,DATE_KEY,PLATE,DMS_ROUTE,LINCROS_ROUTE_CODES,DELIVERIES_PLANNED,DELIVERIES_DONE,DELIVERIES_RETURNED,LATITUDE,LONGITUDE,POSITION_AT,DRIVER,STATUS,DISTANCE_PLANNED,DISTANCE_ACTUAL,RETENTION_MINUTES,SOURCE_UPDATED_AT,CHECKED_AT,SYNCED_AT,DATA_HASH,LAST_ERROR,RAW_SUMMARY_JSON)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?) ON CONFLICT(SCHEDULE_ID) DO UPDATE SET DATE_KEY=excluded.DATE_KEY,PLATE=excluded.PLATE,DMS_ROUTE=excluded.DMS_ROUTE,LINCROS_ROUTE_CODES=excluded.LINCROS_ROUTE_CODES,DELIVERIES_PLANNED=excluded.DELIVERIES_PLANNED,DELIVERIES_DONE=excluded.DELIVERIES_DONE,DELIVERIES_RETURNED=excluded.DELIVERIES_RETURNED,LATITUDE=excluded.LATITUDE,LONGITUDE=excluded.LONGITUDE,POSITION_AT=excluded.POSITION_AT,DRIVER=excluded.DRIVER,STATUS=excluded.STATUS,DISTANCE_PLANNED=excluded.DISTANCE_PLANNED,DISTANCE_ACTUAL=excluded.DISTANCE_ACTUAL,RETENTION_MINUTES=excluded.RETENTION_MINUTES,SOURCE_UPDATED_AT=excluded.SOURCE_UPDATED_AT,CHECKED_AT=excluded.CHECKED_AT,SYNCED_AT=excluded.SYNCED_AT,DATA_HASH=excluded.DATA_HASH,LAST_ERROR=NULL,RAW_SUMMARY_JSON=excluded.RAW_SUMMARY_JSON`)
      .bind(scheduleId,dateIso(schedule.date||schedule.data),normalizePlate(schedule.plate||schedule.placa),clean(schedule.route||schedule.rota,220),JSON.stringify(aggregate.routeCodes),aggregate.deliveriesPlanned,aggregate.deliveriesDone,aggregate.deliveriesReturned,aggregate.latitude,aggregate.longitude,aggregate.positionAt||null,aggregate.driver||null,aggregate.status||null,aggregate.distancePlanned,aggregate.distanceActual,aggregate.retentionMinutes,aggregate.sourceUpdatedAt||null,checkedAt,checkedAt,hash,JSON.stringify(summary)),
    db.prepare(`DELETE FROM LINCROS_DELIVERIES WHERE SCHEDULE_ID=?`).bind(scheduleId),
  ];
  for(const item of aggregate.deliveries){statements.push(db.prepare(`INSERT INTO LINCROS_DELIVERIES (SCHEDULE_ID,LINCROS_ROUTE_CODE,DELIVERY_CODE,CLIENT_CODE,CLIENT_NAME,SEQUENCE_PLANNED,SEQUENCE_ACTUAL,STATUS,DELIVERED,RETURNED,PENDING,ARRIVED_AT,LEFT_AT,RETENTION_MINUTES,RETENTION_SOURCE,DISTANCE_PLANNED,DISTANCE_ACTUAL,WEIGHT_PLANNED,WEIGHT_DELIVERED,WEIGHT_RETURNED,LATITUDE,LONGITUDE,WITHIN_RADIUS,NOTES_JSON,PROOF_URL) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(scheduleId,item.lincrosRouteCode||'',item.deliveryCode||deliveryKey(item),item.clientCode||'',item.clientName||'',item.sequencePlanned,item.sequenceActual,item.status||'',item.delivered?1:0,item.returned?1:0,item.pending?1:0,item.arrivedAt||null,item.leftAt||null,item.retentionMinutes,item.retentionSource||'',item.distancePlanned,item.distanceActual,item.weightPlanned,item.weightDelivered,item.weightReturned,item.latitude,item.longitude,item.withinRadius===null?null:(item.withinRadius?1:0),JSON.stringify(item.notes||[]),item.proofUrl||null));}
  await db.batch(statements);const stage=await advanceMonitoringAfterLastDelivery(db,scheduleId,aggregate);return {changed:true,stageChanged:Boolean(stage?.changed)};
}
async function markError(db,scheduleId,message){await ensureLincrosSchema(db);const checkedAt=new Date().toISOString();await db.prepare(`INSERT INTO LINCROS_ROUTE_SYNC (SCHEDULE_ID,CHECKED_AT,LAST_ERROR) VALUES (?,?,?) ON CONFLICT(SCHEDULE_ID) DO UPDATE SET CHECKED_AT=excluded.CHECKED_AT,LAST_ERROR=excluded.LAST_ERROR`).bind(clean(scheduleId,120),checkedAt,clean(message,1000)).run().catch(()=>{});}
function detailReferenceSet(responses=[]){const refs=new Set();for(const root of responses.flatMap(arrayOf))for(const raw of arrayOf(root.Entregas??root.entregas))for(const ref of notesFromDelivery(raw))refs.add(norm(ref));return refs;}
function selectSnapshotRoots(roots,{ocs,singleDmsSchedule=false}={}){
  const source=arrayOf(roots),ocSet=new Set(parseOcs(ocs));if(!source.length)return {roots:[],strategy:'DAILY_NO_PLATE'};
  const matched=source.filter((root)=>{const refs=detailReferenceSet([root]);return [...ocSet].some((oc)=>refs.has(oc));});
  if(source.length>1&&singleDmsSchedule)return {roots:source,strategy:'DAILY_PLATE_DATE_SINGLE_DMS_ROUTE'};
  if(matched.length)return {roots:matched,strategy:'DAILY_OC_NF_MATCH'};
  if(source.length===1)return {roots:source,strategy:'DAILY_UNIQUE_PLATE_DATE'};
  return {roots:[],strategy:'DAILY_AMBIGUOUS_PLATE_DATE'};
}
function selectShiftedDateRoots(roots,{ocs,shiftDays=1}={}){
  const source=arrayOf(roots),ocSet=new Set(parseOcs(ocs)),prefix=Number(shiftDays||1)===1?'NEXT_DAY':`D_PLUS_${Number(shiftDays||0)}`;
  if(!source.length)return {roots:[],strategy:`${prefix}_NO_PLATE`};
  const matched=source.filter((root)=>{
    if(ocSet.has(norm(routeCodeOf(root))))return true;
    const refs=detailReferenceSet([root]);return [...ocSet].some((oc)=>refs.has(oc));
  });
  // Em datas posteriores a placa pode já ter iniciado uma nova rota. Por segurança,
  // somente aceitamos automaticamente registros cuja OC/NF/código de rota também
  // pertença à escala original. A exceção legada de rota única sem OC continua
  // restrita a D+1; D+2/D+3 só são usados para escalas com referências explícitas.
  if(matched.length)return {roots:matched,strategy:`${prefix}_OC_NF_MATCH`};
  if(Number(shiftDays||1)===1&&!ocSet.size&&source.length===1)return {roots:source,strategy:'NEXT_DAY_UNIQUE_PLATE'};
  return {roots:[],strategy:source.length>1?`${prefix}_AMBIGUOUS`:`${prefix}_NO_REFERENCE_MATCH`};
}
function matchedOcReferences(roots,ocs){
  const ocSet=new Set(parseOcs(ocs)),matched=new Set();if(!ocSet.size)return matched;
  for(const root of arrayOf(roots)){
    const routeRef=norm(routeCodeOf(root)),refs=detailReferenceSet([root]);
    for(const oc of ocSet)if((routeRef&&routeRef===oc)||refs.has(oc))matched.add(oc);
  }
  return matched;
}
function loadReferenceSet(root={}){
  const refs=new Set();const add=(value)=>{if(value===null||value===undefined||typeof value==='object')return;const token=norm(value);if(token)refs.add(token);};
  add(routeCodeOf(root));
  const visit=(value,depth=0)=>{
    if(!value||typeof value!=='object'||depth>4)return;
    for(const [key,child] of Object.entries(value)){
      const nk=norm(key);
      if(child!==null&&child!==undefined&&typeof child!=='object'){
        const explicit=nk==='OC'||nk==='OCS'||/ORDEMCARGA|ORDEMCARREGAMENTO/.test(nk)||((/CARGA|CARREGAMENTO/.test(nk))&&(/COD|CD|ID|NUM|NR|NEGOCIO|ORDEM|REF/.test(nk)||nk==='CARGA'));
        if(explicit)add(child);
      }
      if(child&&typeof child==='object')visit(child,depth+1);
    }
  };
  visit(root);
  for(const delivery of arrayOf(root.Entregas??root.entregas)){
    for(const pedido of arrayOf(delivery.Pedidos??delivery.pedidos)){
      add(pedido.CdPedidoNegocio??pedido.cdPedidoNegocio??pedido.CodigoPedidoNegocio??pedido.codigoPedidoNegocio??'');
    }
  }
  return refs;
}
function selectOcOnlyRoots(roots,{ocs}={}){
  const source=arrayOf(roots),ocTokens=parseOcs(ocs),ocSet=new Set(ocTokens);if(!source.length||!ocSet.size)return {roots:[],matchedOcs:[],strategy:'OC_ONLY_NO_REFERENCE'};
  const matchedOcs=new Set(),matched=source.filter((root)=>{const refs=loadReferenceSet(root),hits=ocTokens.filter((oc)=>refs.has(oc));for(const hit of hits)matchedOcs.add(hit);return hits.length>0;});
  return {roots:matched,matchedOcs:[...matchedOcs],strategy:matched.length?'OC_ONLY_REFERENCE_MATCH':'OC_ONLY_NO_REFERENCE_MATCH'};
}
async function collectOcOnlyRoots(db,env,{date,ocs,forceDaily=false,maxShiftDays=5}={}){
  const ocTokens=parseOcs(ocs);if(!ocTokens.length)return {roots:[],dates:[],matchedOcs:[],maxShiftDays:0,matchedShiftDays:0,checkedDates:[],errors:[]};
  const window=Math.max(0,Number(maxShiftDays||5));
  // Prioriza a data da escala e depois alterna dias anteriores/posteriores pela menor
  // distância: D0, D-1, D+1, D-2, D+2 ... D-5, D+5. O vínculo continua exigindo
  // referência explícita da OC/carga, portanto a janela maior não cria associação cega.
  const shifts=[0];for(let distance=1;distance<=window;distance+=1)shifts.push(-distance,distance);
  const matched=new Set(),seen=new Set(),added=[],dates=[],checkedDates=[],errors=[];let maxMatchedShift=0,matchedShiftDays=0,firstMatch=true;
  for(const shift of shifts){
    if(matched.size>=ocTokens.length)break;
    const shiftedDate=addDaysIso(date,shift);if(!shiftedDate)continue;
    checkedDates.push(shiftedDate);
    try{
      await ensureDailyLincrosSnapshot(db,env,shiftedDate,{force:forceDaily,maxAgeMinutes:forceDaily?0:5});
      const allRoots=await dayRoutesByDate(db,shiftedDate),selected=selectOcOnlyRoots(allRoots,{ocs:ocTokens.filter((oc)=>!matched.has(oc)).join(' / ')});
      const fresh=selected.roots.filter((root)=>{const key=`${shiftedDate}|${norm(routeCodeOf(root))}|${rowPlate(root)}`;if(seen.has(key))return false;seen.add(key);return true;});
      if(fresh.length){added.push(...fresh);dates.push(shiftedDate);maxMatchedShift=Math.max(maxMatchedShift,Math.abs(shift));if(firstMatch){matchedShiftDays=shift;firstMatch=false;}const found=selectOcOnlyRoots(fresh,{ocs});for(const oc of found.matchedOcs)matched.add(oc);}
    }catch(error){errors.push({date:shiftedDate,shiftDays:shift,error:clean(error?.message||String(error),500)});console.warn('Lincros OC-only reconciliation',date,'->',shiftedDate,error?.message||error);}
  }
  return {roots:added,dates:[...new Set(dates)],matchedOcs:[...matched],maxShiftDays:maxMatchedShift,matchedShiftDays,checkedDates:[...new Set(checkedDates)],errors};
}
async function collectFutureOcRoots(db,env,{date,plate,ocs,existingRoots=[],forceDaily=false,maxShiftDays=3}={}){
  const ocTokens=parseOcs(ocs);
  // A busca ampliada existe especificamente para viagens com mais de uma OC.
  // Assim, uma OC que a Lincros gravou em D+1, D+2 ou D+3 continua pertencendo
  // à mesma viagem operacional do DMS sem ampliar o vínculo por placa de forma cega.
  if(ocTokens.length<=1)return {roots:[],dates:[],maxShiftDays:0,matchedOcs:[...matchedOcReferences(existingRoots,ocs)],errors:[]};
  const matched=matchedOcReferences(existingRoots,ocs),seenCodes=new Set(arrayOf(existingRoots).map((root)=>norm(routeCodeOf(root))).filter(Boolean));
  const added=[],dates=[],errors=[];let maxMatchedShift=0;
  for(let shift=1;shift<=Math.max(1,Number(maxShiftDays||3));shift+=1){
    if(matched.size>=ocTokens.length)break;
    const shiftedDate=addDaysIso(date,shift);if(!shiftedDate)break;
    const missing=ocTokens.filter((oc)=>!matched.has(oc));
    try{
      await ensureDailyLincrosSnapshot(db,env,shiftedDate,{force:forceDaily,maxAgeMinutes:forceDaily?0:5});
      const roots=await dayRoutesByPlate(db,shiftedDate,plate),selected=selectShiftedDateRoots(roots,{ocs:missing.join(' / '),shiftDays:shift});
      const fresh=selected.roots.filter((root)=>{const code=norm(routeCodeOf(root));if(!code||seenCodes.has(code))return false;seenCodes.add(code);return true;});
      if(fresh.length){
        added.push(...fresh);dates.push(shiftedDate);maxMatchedShift=Math.max(maxMatchedShift,shift);
        const newlyMatched=matchedOcReferences(fresh,missing.join(' / '));for(const oc of newlyMatched)matched.add(oc);
      }
    }catch(error){errors.push({date:shiftedDate,shiftDays:shift,error:clean(error?.message||String(error),500)});console.warn('Lincros multi-OC future-date reconciliation',plate,date,'->',shiftedDate,error?.message||error);}
  }
  return {roots:added,dates,maxShiftDays:maxMatchedShift,matchedOcs:[...matched],errors};
}
export async function syncLincrosSchedule(db,env,schedule={},options={}){
  await ensureLincrosSchema(db);const scheduleId=clean(schedule.scheduleId||schedule.id||schedule.schedule_record_id,120),date=dateIso(schedule.date||schedule.data),plate=lincrosReferencePlateFromTrip(schedule),ocs=clean(schedule.ocs||schedule.carga||'',1000),forceDaily=Boolean(options?.forceDaily);
  if(!scheduleId||!date||!plate)throw new Error('Escala sem ID, data ou placa para sincronizar com a Lincros.');
  try{
    // Jornada é a consulta preferencial, mas um HTTP 400 "Nenhuma rota encontrada"
    // não pode encerrar a sincronização. O StatusRota diário é uma fonte independente
    // e frequentemente ainda contém a rota/entregas da placa (especialmente em viagens
    // longas/pernoites). Portanto, qualquer falha da Jornada vira apenas diagnóstico e
    // seguimos para o snapshot diário por placa + data.
    const sameDmsCount=await activeScheduleCount(db,date,plate);let journeys=[],journeyError=null,matchedDate=date,dateShiftDays=0,futureDates=[],futureDateErrors=[],multiOcReconciled=false;
    try{journeys=await fetchJourneys(env,{date,plate});}catch(error){journeyError=error;console.warn('Lincros Jornada indisponível; tentando snapshot diário',plate,date,error?.message||error);}
    let chosen=chooseRouteCodes(journeys,{date,plate,ocs,singleDmsSchedule:sameDmsCount<=1});
    let responses=[];
    if(!chosen.codes.length&&chosen.strategy==='AMBIGUOUS_PLATE_DATE'&&chosen.candidates.length){
      const candidateResponses=await Promise.all(chosen.candidates.map((code)=>fetchRouteDetails(env,code)));const ocSet=new Set(parseOcs(ocs));const matched=[];
      candidateResponses.forEach((response,index)=>{const refs=detailReferenceSet(response);if([...ocSet].some((oc)=>refs.has(oc)))matched.push(index);});
      if(matched.length){chosen={...chosen,codes:matched.map((index)=>chosen.candidates[index]),strategy:'OC_NF_DETAIL_MATCH'};responses=matched.map((index)=>candidateResponses[index]);}
    }
    // Mesmo quando Jornada encontra uma rota, ela pode devolver apenas parte das viagens
    // da placa/data. Para uma única escala DMS, reconciliamos com o snapshot diário do
    // StatusRota v4 e usamos TODAS as rotas da placa naquele dia. Esse é o cenário em que
    // uma rota operacional do DMS foi dividida em vários CdRotaNegocio pela Lincros.
    if(chosen.codes.length&&sameDmsCount<=1){
      try{
        await ensureDailyLincrosSnapshot(db,env,date,{force:forceDaily,maxAgeMinutes:forceDaily?0:5});
        const dayRoots=await dayRoutesByPlate(db,date,plate);const selected=selectSnapshotRoots(dayRoots,{ocs,singleDmsSchedule:true});
        const dayCodes=[...new Set(selected.roots.map(routeCodeOf).filter(Boolean))];
        if(selected.roots.length&&dayCodes.length>=chosen.codes.length){
          const directSet=new Set(chosen.codes.map(norm)),daySet=new Set(dayCodes.map(norm));
          const hasAdditional=dayCodes.some((code)=>!directSet.has(norm(code)));
          const directDeliveryCount=responses.flatMap(arrayOf).reduce((sum,root)=>sum+arrayOf(root.Entregas??root.entregas).length,0);
          const dailyDeliveryCount=selected.roots.reduce((sum,root)=>sum+arrayOf(root.Entregas??root.entregas).length,0);
          if(hasAdditional||dailyDeliveryCount>directDeliveryCount){responses=selected.roots.map((root)=>[root]);chosen={codes:dayCodes,candidates:[...new Set(dayRoots.map(routeCodeOf).filter(Boolean))],strategy:'RECONCILED_DAILY_PLATE_DATE'};}
        }
      }catch(error){console.warn('Lincros daily reconciliation',plate,date,error?.message||error);}
    }
    // O endpoint Jornada pode ignorar o filtro de placa. Quando ele não traz a placa exata,
    // consulta-se o StatusRota v4 por data UMA vez, armazena-se o snapshot diário no D1 e
    // a partir daí o vínculo é feito localmente por placa + OC/NF.
    if(!chosen.codes.length){
      await ensureDailyLincrosSnapshot(db,env,date,{force:forceDaily,maxAgeMinutes:forceDaily?0:5});const dayRoots=await dayRoutesByPlate(db,date,plate);const selected=selectSnapshotRoots(dayRoots,{ocs,singleDmsSchedule:sameDmsCount<=1});
      if(selected.roots.length){responses=selected.roots.map((root)=>[root]);chosen={codes:[...new Set(selected.roots.map(routeCodeOf).filter(Boolean))],candidates:[...new Set(dayRoots.map(routeCodeOf).filter(Boolean))],strategy:selected.strategy};}
      else{
        // A escala pode possuir várias ordens de carga e a Lincros pode gravar cada
        // CdRotaNegocio em uma DataRota diferente. Quando houver mais de uma OC,
        // procuramos correspondências explícitas de OC/NF/código até D+3 e consolidamos
        // tudo na mesma viagem DMS. Sem múltiplas OCs, preservamos o fallback seguro D+1.
        const ocTokens=parseOcs(ocs);
        if(ocTokens.length>1){
          const future=await collectFutureOcRoots(db,env,{date,plate,ocs,existingRoots:[],forceDaily,maxShiftDays:3});
          futureDates=future.dates;futureDateErrors=future.errors;dateShiftDays=future.maxShiftDays;
          if(future.roots.length){
            responses=future.roots.map((root)=>[root]);chosen={codes:[...new Set(future.roots.map(routeCodeOf).filter(Boolean))],candidates:[...new Set(future.roots.map(routeCodeOf).filter(Boolean))],strategy:'MULTI_OC_FUTURE_DATE_MATCH'};
            matchedDate=future.dates[0]||addDaysIso(date,1);multiOcReconciled=true;
          }
        }
        if(!chosen.codes.length){
          const nextDate=addDaysIso(date,1);let nextRoots=[],nextSelected={roots:[],strategy:'NEXT_DAY_NO_PLATE'},nextDayError=null;
          try{
            await ensureDailyLincrosSnapshot(db,env,nextDate,{force:forceDaily,maxAgeMinutes:forceDaily?0:5});
            nextRoots=await dayRoutesByPlate(db,nextDate,plate);nextSelected=selectShiftedDateRoots(nextRoots,{ocs,shiftDays:1});
          }catch(error){nextDayError=error;console.warn('Lincros next-day fallback',plate,date,'->',nextDate,error?.message||error);}
          if(nextSelected.roots.length){responses=nextSelected.roots.map((root)=>[root]);chosen={codes:[...new Set(nextSelected.roots.map(routeCodeOf).filter(Boolean))],candidates:[...new Set(nextRoots.map(routeCodeOf).filter(Boolean))],strategy:nextSelected.strategy};matchedDate=nextDate;dateShiftDays=1;}
          else{
            // Último fallback: se a placa não produziu correspondência, procurar a OC da
            // escala em TODAS as rotas Lincros de D-5 a D+5. O vínculo só é aceito quando
            // existe referência explícita da ordem de carga/código, portanto não depende
            // da placa cadastrada na Lincros. Isso cobre troca/divergência de placa sem
            // abrir uma associação cega por data ou por rota.
            const ocOnly=await collectOcOnlyRoots(db,env,{date,ocs,forceDaily,maxShiftDays:5});
            futureDateErrors=[...futureDateErrors,...ocOnly.errors];
            if(ocOnly.roots.length){
              responses=ocOnly.roots.map((root)=>[root]);chosen={codes:[...new Set(ocOnly.roots.map(routeCodeOf).filter(Boolean))],candidates:[...new Set(ocOnly.roots.map(routeCodeOf).filter(Boolean))],strategy:'OC_ONLY_REFERENCE_MATCH'};
              matchedDate=ocOnly.dates[0]||date;futureDates=[...new Set([...futureDates,...ocOnly.dates.filter((x)=>x!==matchedDate)])];dateShiftDays=Number(ocOnly.matchedShiftDays||0);
            }else{
              const journeyNote=journeyError?` A Jornada também não localizou a placa (${clean(journeyError?.message||String(journeyError),260)}).`:'';
              const futureWindow=ocTokens.length>1?' nem até D+3':'';
              const nextDayNote=nextDayError?` A consulta do dia seguinte ${nextDate} falhou (${clean(nextDayError?.message||String(nextDayError),260)}).`:` Também não foi encontrado no dia seguinte ${nextDate}${futureWindow} um registro da placa que correspondesse às OCs/NFs da escala.`;
              const ocOnlyNote=ocTokens.length?` A busca final somente pela OC também não encontrou correspondência entre ${addDaysIso(date,-5)} e ${addDaysIso(date,5)}.`:' A escala não possui OC para executar o fallback sem placa.';
              const reason=(selected.strategy==='DAILY_AMBIGUOUS_PLATE_DATE'?`Snapshot diário encontrou mais de uma rota Lincros para ${plate} em ${date}, mas não foi possível relacioná-las com as OCs/NFs desta escala.`:`Nenhuma rota Lincros encontrada para ${plate} em ${date}, inclusive no snapshot diário do StatusRota.`)+journeyNote+nextDayNote+ocOnlyNote;
              await markError(db,scheduleId,reason);return {ok:false,reason,strategy:nextSelected.strategy||selected.strategy,candidates:[...new Set([...dayRoots,...nextRoots].map(routeCodeOf).filter(Boolean))],journeysFound:arrayOf(journeys).length,journeyError:journeyError?clean(journeyError?.message||String(journeyError),500):'',dailyFallback:true,nextDayChecked:true,nextDay:nextDate,futureDatesChecked:Array.from({length:11},(_,index)=>addDaysIso(date,index-5)).filter(Boolean),futureDateErrors};
            }
          }
        }
      }
    }
    if(!responses.length)responses=await Promise.all(chosen.codes.map((code)=>fetchRouteDetails(env,code)));
    // Mesmo quando parte da viagem já foi encontrada na data de referência, uma segunda
    // ou terceira OC pode ter sido criada pela Lincros em D+1/D+2/D+3. Reconciliamos
    // somente por referência explícita da OC/NF/código, nunca apenas pela placa.
    if(parseOcs(ocs).length>1&&!String(chosen.strategy||'').startsWith('OC_ONLY_')){
      const currentRoots=responses.flatMap(arrayOf),future=await collectFutureOcRoots(db,env,{date,plate,ocs,existingRoots:currentRoots,forceDaily,maxShiftDays:3});
      futureDateErrors=[...futureDateErrors,...future.errors];
      futureDates=[...new Set([...futureDates,...future.dates])];
      dateShiftDays=Math.max(dateShiftDays,Number(future.maxShiftDays||0));
      if(future.roots.length){
        responses.push(...future.roots.map((root)=>[root]));
        chosen={...chosen,codes:[...new Set([...chosen.codes,...future.roots.map(routeCodeOf).filter(Boolean)])],candidates:[...new Set([...(chosen.candidates||[]),...future.roots.map(routeCodeOf).filter(Boolean)])],strategy:'MULTI_OC_MULTI_DATE_RECONCILIATION'};
        multiOcReconciled=true;
      }
    }
    const roots=responses.flatMap(arrayOf);
    if(!roots.length){const reason=`A Lincros encontrou rota(s) ${chosen.codes.join(' / ')}, mas o StatusRota v4 não devolveu dados.`;await markError(db,scheduleId,reason);return {ok:false,reason,strategy:'STATUS_ROTA_EMPTY',candidates:chosen.candidates,routeCodes:chosen.codes,journeysFound:arrayOf(journeys).length};}
    const ocOnlyMatch=String(chosen.strategy||'').startsWith('OC_ONLY_');const wrongPlate=roots.find((row)=>rowPlate(row)&&rowPlate(row)!==plate);if(wrongPlate&&!ocOnlyMatch){const reason=`O StatusRota retornou a placa ${rowPlate(wrongPlate)} para uma escala ${plate}; vínculo descartado por segurança.`;await markError(db,scheduleId,reason);return {ok:false,reason,strategy:'STATUS_ROTA_PLATE_MISMATCH',routeCodes:chosen.codes,journeysFound:arrayOf(journeys).length};}
    const aggregate=aggregateDetails(chosen.codes,responses);aggregate.referenceDate=matchedDate;aggregate.referenceDates=[...new Set([matchedDate,...futureDates].filter(Boolean))];aggregate.dateShiftDays=dateShiftDays;aggregate.matchStrategy=chosen.strategy;aggregate.lincrosPlates=[...new Set(roots.map(rowPlate).filter(Boolean))];if(!(aggregate.deliveriesPlanned>0||aggregate.deliveries.length>0)){const reason=`A Lincros respondeu a rota, mas não trouxe entregas previstas/detalhadas para ${plate} em ${matchedDate}.`;await markError(db,scheduleId,reason);return {ok:false,reason,strategy:'STATUS_ROTA_WITHOUT_DELIVERIES',routeCodes:chosen.codes,journeysFound:arrayOf(journeys).length,referenceDate:matchedDate,referenceDates:aggregate.referenceDates,dateShiftDays};}
    const hash=await dataHash({scheduleId,date,plate,ocs,...aggregate});const result=await upsertAggregate(db,env,{scheduleId,date,plate,route:schedule.route||schedule.rota},aggregate,hash);
    return {ok:true,changed:result.changed,stageChanged:Boolean(result.stageChanged),strategy:chosen.strategy,journeysFound:arrayOf(journeys).length,journeyError:journeyError?clean(journeyError?.message||String(journeyError),500):'',candidates:chosen.candidates,dailyFallback:chosen.strategy.startsWith('DAILY_')||chosen.strategy.startsWith('NEXT_DAY_')||chosen.strategy.startsWith('MULTI_OC_')||chosen.strategy.startsWith('OC_ONLY_')||Boolean(journeyError),nextDayFallback:dateShiftDays===1,futureDateFallback:dateShiftDays>0,pastDateFallback:dateShiftDays<0,multiOcReconciled,referenceDate:matchedDate,referenceDates:aggregate.referenceDates,dateShiftDays,futureDateErrors,...aggregate};
  }catch(error){await markError(db,scheduleId,error?.message||String(error));throw error;}
}


export async function syncLincrosSchedulesFromDaySnapshot(db,env,schedules=[],options={}){
  await ensureLincrosSchema(db);
  const source=Array.isArray(schedules)?schedules.filter(Boolean):[];
  if(!source.length)return {attempted:0,ok:0,failed:0,results:[]};
  const force=Boolean(options.force),maxAgeMinutes=Math.max(0,Number(options.maxAgeMinutes??4));
  const dates=[...new Set(source.map((row)=>dateIso(row.date||row.data)).filter(Boolean))];
  const snapshotErrors=new Map();
  for(const date of dates){
    try{await ensureDailyLincrosSnapshot(db,env,date,{force,maxAgeMinutes:force?0:maxAgeMinutes});}
    catch(error){snapshotErrors.set(date,error);}
  }
  const plateCounts=new Map();
  for(const schedule of source){
    const date=dateIso(schedule.date||schedule.data);
    const plate=lincrosReferencePlateFromTrip(schedule)||normalizePlate(schedule.plate||schedule.placa);
    if(!date||!plate)continue;
    const key=`${date}|${plate}`;plateCounts.set(key,(plateCounts.get(key)||0)+1);
  }
  const results=[];
  for(const schedule of source){
    const scheduleId=clean(schedule.scheduleId||schedule.id||schedule.schedule_record_id,120);
    const date=dateIso(schedule.date||schedule.data);
    const operationalPlate=normalizePlate(schedule.plate||schedule.placa);
    const referencePlate=lincrosReferencePlateFromTrip(schedule)||operationalPlate;
    const ocs=clean(schedule.ocs||schedule.carga||'',1000);
    if(!scheduleId||!date||!operationalPlate||!referencePlate){
      results.push({ok:false,scheduleId,date,plate:operationalPlate,reason:'Escala sem ID, data ou placa para sincronização Lincros.'});continue;
    }
    if(snapshotErrors.has(date)){
      const error=snapshotErrors.get(date);results.push({ok:false,scheduleId,date,plate:operationalPlate,reason:error?.message||String(error),stage:'DAY_SNAPSHOT'});continue;
    }
    try{
      const roots=await dayRoutesByPlate(db,date,referencePlate);
      const selected=selectSnapshotRoots(roots,{ocs,singleDmsSchedule:(plateCounts.get(`${date}|${referencePlate}`)||0)<=1});
      if(!selected.roots.length){
        results.push({ok:false,scheduleId,date,plate:operationalPlate,referencePlate,strategy:selected.strategy,reason:'Snapshot diário não encontrou correspondência segura para a placa/OC da escala.'});continue;
      }
      const codes=[...new Set(selected.roots.map(routeCodeOf).filter(Boolean))];
      const aggregate=aggregateDetails(codes,[selected.roots]);
      aggregate.referenceDate=date;aggregate.referenceDates=[date];aggregate.dateShiftDays=0;aggregate.matchStrategy=`PRE_DEPARTURE_${selected.strategy}`;
      aggregate.lincrosPlates=[...new Set(selected.roots.map(rowPlate).filter(Boolean))];
      if(!(aggregate.deliveriesPlanned>0||aggregate.deliveries.length>0)){
        results.push({ok:false,scheduleId,date,plate:operationalPlate,referencePlate,strategy:selected.strategy,reason:'Rota Lincros sem entregas previstas/detalhadas.'});continue;
      }
      const hash=await dataHash({scheduleId,date,plate:operationalPlate,ocs,...aggregate});
      const saved=await upsertAggregate(db,env,{...schedule,scheduleId,date,plate:operationalPlate,route:schedule.route||schedule.rota},aggregate,hash);
      results.push({ok:true,scheduleId,date,plate:operationalPlate,referencePlate,strategy:aggregate.matchStrategy,changed:Boolean(saved.changed),stageChanged:Boolean(saved.stageChanged),...aggregate});
    }catch(error){
      await markError(db,scheduleId,error?.message||String(error));
      results.push({ok:false,scheduleId,date,plate:operationalPlate,referencePlate,reason:error?.message||String(error)});
    }
  }
  return {attempted:results.length,ok:results.filter((row)=>row.ok).length,failed:results.filter((row)=>!row.ok).length,results};
}

function parseJson(value,fallback){try{const v=JSON.parse(String(value||''));return v??fallback;}catch{return fallback;}}
export async function cachedLincrosBySchedule(db,scheduleIds=[]){
  await ensureLincrosSchema(db);const ids=[...new Set(scheduleIds.map((x)=>clean(x,120)).filter(Boolean))];if(!ids.length)return new Map();
  // Cloudflare D1/SQLite limita a quantidade de parâmetros vinculados por instrução.
  // A aba Indicadores pode reunir centenas de escalas no período; portanto, nunca
  // montamos um único IN (?, ?, ...) com todos os IDs. Consultamos em blocos pequenos
  // e consolidamos o resultado em memória.
  const results=[],deliveries=[],D1_BIND_CHUNK=80;
  for(let offset=0;offset<ids.length;offset+=D1_BIND_CHUNK){
    const chunk=ids.slice(offset,offset+D1_BIND_CHUNK),placeholders=chunk.map(()=>'?').join(',');
    const [routeResult,deliveryResult]=await Promise.all([
      db.prepare(`SELECT * FROM LINCROS_ROUTE_SYNC WHERE SCHEDULE_ID IN (${placeholders})`).bind(...chunk).all(),
      db.prepare(`SELECT * FROM LINCROS_DELIVERIES WHERE SCHEDULE_ID IN (${placeholders}) ORDER BY SCHEDULE_ID,COALESCE(SEQUENCE_PLANNED,99999),CLIENT_NAME`).bind(...chunk).all(),
    ]);
    results.push(...(routeResult.results||[]));deliveries.push(...(deliveryResult.results||[]));
  }
  const deliveryBy=new Map();for(const row of deliveries){const key=String(row.SCHEDULE_ID||'');if(!deliveryBy.has(key))deliveryBy.set(key,[]);deliveryBy.get(key).push({lincrosRouteCode:row.LINCROS_ROUTE_CODE||'',deliveryCode:row.DELIVERY_CODE||'',clientCode:row.CLIENT_CODE||'',clientName:row.CLIENT_NAME||'',sequencePlanned:row.SEQUENCE_PLANNED,sequenceActual:row.SEQUENCE_ACTUAL,status:row.STATUS||'',delivered:Boolean(row.DELIVERED),returned:Boolean(row.RETURNED),pending:Boolean(row.PENDING),arrivedAt:row.ARRIVED_AT||'',leftAt:row.LEFT_AT||'',retentionMinutes:row.RETENTION_MINUTES,retentionSource:row.RETENTION_SOURCE||'',distancePlanned:row.DISTANCE_PLANNED,distanceActual:row.DISTANCE_ACTUAL,weightPlanned:row.WEIGHT_PLANNED,weightDelivered:row.WEIGHT_DELIVERED,weightReturned:row.WEIGHT_RETURNED,latitude:row.LATITUDE,longitude:row.LONGITUDE,withinRadius:row.WITHIN_RADIUS===null||row.WITHIN_RADIUS===undefined?null:Boolean(row.WITHIN_RADIUS),notes:parseJson(row.NOTES_JSON,[]),proofUrl:row.PROOF_URL||''});}
  return new Map(results.map((row)=>{const routeCodes=parseJson(row.LINCROS_ROUTE_CODES,[]),deliveryRows=deliveryBy.get(String(row.SCHEDULE_ID))||[],lastError=row.LAST_ERROR||'',deliveriesPlanned=Number(row.DELIVERIES_PLANNED||0),rawSummary=parseJson(row.RAW_SUMMARY_JSON,{});const hasSuccessfulSync=Boolean(String(row.DATA_HASH||'').trim()&&routeCodes.length&&(deliveriesPlanned>0||deliveryRows.length));const syncHealthy=hasSuccessfulSync&&!lastError;return [String(row.SCHEDULE_ID),{scheduleId:String(row.SCHEDULE_ID),date:row.DATE_KEY||'',referenceDate:rawSummary.referenceDate||row.DATE_KEY||'',dateShiftDays:Number(rawSummary.dateShiftDays||0),matchStrategy:rawSummary.matchStrategy||'',lincrosPlates:Array.isArray(rawSummary.lincrosPlates)?rawSummary.lincrosPlates:[],plate:row.PLATE||'',dmsRoute:row.DMS_ROUTE||'',routeCodes,deliveriesPlanned,deliveriesDone:Number(row.DELIVERIES_DONE||0),deliveriesReturned:Number(row.DELIVERIES_RETURNED||0),latitude:row.LATITUDE===null?null:Number(row.LATITUDE),longitude:row.LONGITUDE===null?null:Number(row.LONGITUDE),positionAt:row.POSITION_AT||'',locationLabel:clean(rawSummary.locationLabel||'',500),driver:row.DRIVER||'',status:row.STATUS||'',distancePlanned:row.DISTANCE_PLANNED===null?null:Number(row.DISTANCE_PLANNED),distanceActual:row.DISTANCE_ACTUAL===null?null:Number(row.DISTANCE_ACTUAL),retentionMinutes:row.RETENTION_MINUTES===null?null:Number(row.RETENTION_MINUTES),sourceUpdatedAt:row.SOURCE_UPDATED_AT||'',checkedAt:row.CHECKED_AT||'',syncedAt:row.SYNCED_AT||'',lastError,hasSuccessfulSync,syncHealthy,deliveries:deliveryRows}];})) ;
}
function lincrosDistanceMeters(lat1,lon1,lat2,lon2){
  const toRad=(value)=>Number(value)*Math.PI/180,R=6371000;const a1=Number(lat1),o1=Number(lon1),a2=Number(lat2),o2=Number(lon2);
  if(![a1,o1,a2,o2].every(Number.isFinite))return Number.POSITIVE_INFINITY;
  const dLat=toRad(a2-a1),dLon=toRad(o2-o1);const h=Math.sin(dLat/2)**2+Math.cos(toRad(a1))*Math.cos(toRad(a2))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
async function enrichLincrosNearbyClients(db,map){
  const entries=[...map.entries()].filter(([,item])=>item?.syncHealthy&&Number.isFinite(Number(item.latitude))&&Number.isFinite(Number(item.longitude)));
  if(!entries.length)return map;
  const statements=entries.map(([,item])=>{const lat=Number(item.latitude),lng=Number(item.longitude),radius=120,latMargin=radius/110540,lngMargin=radius/Math.max(27830,111320*Math.cos(lat*Math.PI/180));return db.prepare(`SELECT ID,CODIGO,NOME,LATITUDE,LONGITUDE,CIDADE,UF,ENDERECO,UNIDADE_NEGOCIO FROM BASE_CLIENTES WHERE ATIVO=1 AND LATITUDE BETWEEN ? AND ? AND LONGITUDE BETWEEN ? AND ? LIMIT 80`).bind(lat-latMargin,lat+latMargin,lng-lngMargin,lng+lngMargin);});
  const result=[];try{for(let i=0;i<statements.length;i+=40)result.push(...await db.batch(statements.slice(i,i+40)));}catch{return map;}
  entries.forEach(([key,item],index)=>{const lat=Number(item.latitude),lng=Number(item.longitude);const nearby=(result[index]?.results||[]).map((row)=>({id:String(row.ID||''),code:String(row.CODIGO||''),name:String(row.NOME||''),latitude:Number(row.LATITUDE),longitude:Number(row.LONGITUDE),city:String(row.CIDADE||''),state:String(row.UF||''),address:String(row.ENDERECO||''),businessUnit:String(row.UNIDADE_NEGOCIO||''),distanceMeters:Math.round(lincrosDistanceMeters(lat,lng,Number(row.LATITUDE),Number(row.LONGITUDE)))})).filter((row)=>row.distanceMeters<=100).sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,3);map.set(key,{...item,nearbyClients:nearby});});
  return map;
}
export async function enrichRowsWithLincrosCache(db,rows=[],options={}){
  const ids=rows.map((r)=>r.schedule_record_id||r.schedule_id||r.escala_id||'').filter(Boolean);if(!ids.length)return rows;const map=await cachedLincrosBySchedule(db,ids);
  if(options?.nearbyClients)await enrichLincrosNearbyClients(db,map);
  return rows.map((row)=>{const id=String(row.schedule_record_id||row.schedule_id||row.escala_id||'');const lincros=map.get(id);if(!lincros)return row;if(!lincros.syncHealthy)return {...row,lincros};const planned=lincros.deliveriesPlanned||Math.max(0,Number(row.entregas_previstas||row.qtd_entregas||0));const done=Math.min(planned||Number.MAX_SAFE_INTEGER,Math.max(0,lincros.deliveriesDone));const originalStatus=normalizeStatus(row.status||row.status_monitoramento||'');const autoReturn=planned>0&&done>=planned&&['EM ROTA','NO DESTINO','DESCARREGADO','RETORNO PREVISTO','PERNOITE'].includes(originalStatus);return {...row,lincros,entregas_previstas:planned,entregas_realizadas:done,entregas_pendentes:Math.max(0,planned-done),fonte_entregas:'LINCROS',...(autoReturn?{status:'EM RETORNO',status_monitoramento:'EM RETORNO',status_automatico_lincros:true}:{})};});
}

function clientLookupKey(value){return clean(value,160).toUpperCase();}
function monitorOcs(data={}){const value=data.ocs??data.OCS??data.oc??data.OC??data.carga??data.CARGA??'';return Array.isArray(value)?value.map((x)=>clean(x,120)).filter(Boolean).join(' / '):clean(value,500);}
async function monitoringMetaBySchedule(db,scheduleIds=[]){
  const ids=[...new Set(scheduleIds.map((x)=>clean(x,120)).filter(Boolean))];if(!ids.length)return new Map();
  const placeholders=ids.map(()=>'?').join(',');const {results=[]}=await db.prepare(`SELECT SCHEDULE_ID,STATUS,DATE_KEY,PLATE,ROUTE,DATA_JSON,ID FROM ROUTE_MONITORING WHERE SCHEDULE_ID IN (${placeholders}) ORDER BY ID DESC`).bind(...ids).all();
  const map=new Map();for(const row of results){const id=String(row.SCHEDULE_ID||'');if(!id||map.has(id))continue;let data={};try{data=JSON.parse(String(row.DATA_JSON||'{}'))||{};}catch{}const status=clean(row.STATUS||data.status||data.status_monitoramento||'',80);map.set(id,{status,date:data.data||row.DATE_KEY||'',plate:data.placa||row.PLATE||'',route:data.rota||row.ROUTE||'',ocs:monitorOcs(data),active:['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO'].includes(normalizeStatus(status))});}
  return map;
}
function clientHistoryRow(row,monitor={}){return {scheduleId:String(row.SCHEDULE_ID||''),lincrosRouteCode:row.LINCROS_ROUTE_CODE||'',deliveryCode:row.DELIVERY_CODE||'',clientCode:row.CLIENT_CODE||'',clientName:row.CLIENT_NAME||'',date:monitor.date||row.DATE_KEY||'',plate:monitor.plate||row.PLATE||'',route:monitor.route||row.DMS_ROUTE||'',driver:row.DRIVER||'',routeStatus:monitor.status||row.ROUTE_STATUS||'',isCurrentRoute:Boolean(monitor.active),ocs:monitor.ocs||'',invoices:parseJson(row.NOTES_JSON,[]),sequencePlanned:row.SEQUENCE_PLANNED,sequenceActual:row.SEQUENCE_ACTUAL,status:row.STATUS||'',delivered:Boolean(row.DELIVERED),returned:Boolean(row.RETURNED),pending:Boolean(row.PENDING),arrivedAt:row.ARRIVED_AT||'',leftAt:row.LEFT_AT||'',retentionMinutes:row.RETENTION_MINUTES===null?null:Number(row.RETENTION_MINUTES),distancePlanned:row.DISTANCE_PLANNED===null?null:Number(row.DISTANCE_PLANNED),distanceActual:row.DISTANCE_ACTUAL===null?null:Number(row.DISTANCE_ACTUAL),weightPlanned:row.WEIGHT_PLANNED===null?null:Number(row.WEIGHT_PLANNED),weightDelivered:row.WEIGHT_DELIVERED===null?null:Number(row.WEIGHT_DELIVERED),weightReturned:row.WEIGHT_RETURNED===null?null:Number(row.WEIGHT_RETURNED),withinRadius:row.WITHIN_RADIUS===null||row.WITHIN_RADIUS===undefined?null:Boolean(row.WITHIN_RADIUS),proofUrl:row.PROOF_URL||''};}
export async function clientLincrosHistoryByCodes(db,codes=[]){
  await ensureLincrosSchema(db);const keys=[...new Set(codes.map(clientLookupKey).filter(Boolean))].slice(0,500);if(!keys.length)return new Map();const placeholders=keys.map(()=>'?').join(',');
  const activeStatuses=['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO'];const activeSql=activeStatuses.map(()=>'?').join(',');
  const {results:pending=[]}=await db.prepare(`SELECT D.*,S.DATE_KEY,S.PLATE,S.DMS_ROUTE,S.DRIVER,S.STATUS ROUTE_STATUS FROM LINCROS_DELIVERIES D JOIN LINCROS_ROUTE_SYNC S ON S.SCHEDULE_ID=D.SCHEDULE_ID WHERE D.CLIENT_CODE IN (${placeholders}) AND D.PENDING=1 AND EXISTS (SELECT 1 FROM ROUTE_MONITORING M WHERE M.SCHEDULE_ID=D.SCHEDULE_ID AND UPPER(TRIM(COALESCE(M.STATUS,''))) IN (${activeSql})) ORDER BY S.DATE_KEY DESC,D.SEQUENCE_PLANNED,D.ID DESC`).bind(...keys,...activeStatuses).all();
  const {results:delivered=[]}=await db.prepare(`WITH RANKED AS (SELECT D.*,S.DATE_KEY,S.PLATE,S.DMS_ROUTE,S.DRIVER,S.STATUS ROUTE_STATUS,ROW_NUMBER() OVER (PARTITION BY D.CLIENT_CODE ORDER BY COALESCE(NULLIF(D.LEFT_AT,''),NULLIF(D.ARRIVED_AT,''),S.DATE_KEY) DESC,D.ID DESC) RN FROM LINCROS_DELIVERIES D JOIN LINCROS_ROUTE_SYNC S ON S.SCHEDULE_ID=D.SCHEDULE_ID WHERE D.CLIENT_CODE IN (${placeholders}) AND D.DELIVERED=1) SELECT * FROM RANKED WHERE RN<=5 ORDER BY CLIENT_CODE,RN`).bind(...keys).all();
  const scheduleIds=[...new Set([...pending,...delivered].map((row)=>String(row.SCHEDULE_ID||'')).filter(Boolean))];const monitorMap=await monitoringMetaBySchedule(db,scheduleIds);const out=new Map();
  const ensure=(key)=>{if(!out.has(key))out.set(key,{currentPending:[],lastDelivered:null,recentDelivered:[]});return out.get(key);};
  for(const row of pending){const key=clientLookupKey(row.CLIENT_CODE);if(!key)continue;ensure(key).currentPending.push(clientHistoryRow(row,monitorMap.get(String(row.SCHEDULE_ID||''))||{}));}
  for(const row of delivered){const key=clientLookupKey(row.CLIENT_CODE);if(!key)continue;const bucket=ensure(key),item=clientHistoryRow(row,monitorMap.get(String(row.SCHEDULE_ID||''))||{});bucket.recentDelivered.push(item);if(!bucket.lastDelivered)bucket.lastDelivered=item;}
  return out;
}

export async function activeLincrosCache(db){
  await ensureLincrosSchema(db);const {results=[]}=await db.prepare(`SELECT SCHEDULE_ID,DATE_KEY,PLATE,ROUTE,DATA_JSON FROM ROUTE_MONITORING WHERE STATUS IN ('EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO') ORDER BY ID DESC LIMIT 3000`).all();
  const schedules=[];for(const row of results){let data={};try{data=JSON.parse(String(row.DATA_JSON||'{}'))||{};}catch{}schedules.push({scheduleId:String(data.schedule_record_id||row.SCHEDULE_ID||''),date:data.data||row.DATE_KEY||'',plate:data.placa||row.PLATE||'',lincrosPlate:lincrosReferencePlateFromTrip(data),route:data.rota||row.ROUTE||'',ocs:data.ocs||data.carga||''});}
  // Compatibilidade com viagens já abertas antes desta versão: quando a placa original
  // ainda não existe no Monitoramento, recupera a primeira troca de veículo registrada
  // na Saída e usa essa placa exclusivamente na consulta Lincros.
  const unresolved=schedules.filter((item)=>!item.lincrosPlate||item.lincrosPlate===normalizePlate(item.plate)).map((item)=>item.scheduleId).filter(Boolean);
  if(unresolved.length){
    const departureBySchedule=new Map();
    for(let offset=0;offset<unresolved.length;offset+=80){const chunk=unresolved.slice(offset,offset+80),marks=chunk.map(()=>'?').join(',');const dep=await db.prepare(`SELECT SCHEDULE_ID,PLATE,DATA_JSON,ID FROM ROUTE_DEPARTURES WHERE SCHEDULE_ID IN (${marks}) AND UPPER(COALESCE(STATUS,''))='SAIU' ORDER BY ID DESC`).bind(...chunk).all().catch(()=>({results:[]}));for(const raw of dep.results||[]){const key=String(raw.SCHEDULE_ID||'');if(!key||departureBySchedule.has(key))continue;let data={};try{data=JSON.parse(String(raw.DATA_JSON||'{}'))||{};}catch{}departureBySchedule.set(key,{...data,placa:data.placa||raw.PLATE||''});}}
    for(const item of schedules){const departure=departureBySchedule.get(item.scheduleId);if(!departure)continue;const ref=lincrosReferencePlateFromTrip(departure);if(ref)item.lincrosPlate=ref;}
  }
  for(const item of schedules)if(!item.lincrosPlate)item.lincrosPlate=normalizePlate(item.plate);
  const map=await cachedLincrosBySchedule(db,schedules.map((x)=>x.scheduleId));return schedules.map((s)=>({...s,lincros:map.get(s.scheduleId)||null}));
}
export async function refreshStaleActiveLincros(db,env,{limit=8,maxAgeMinutes=5}={}){
  const active=await activeLincrosCache(db),now=Date.now();const stale=active.filter((row)=>{const checked=Date.parse(row.lincros?.checkedAt||'');return !Number.isFinite(checked)||now-checked>maxAgeMinutes*60000;}).slice(0,Math.max(1,Math.min(20,limit)));
  const results=await Promise.allSettled(stale.map((row)=>syncLincrosSchedule(db,env,row)));return {attempted:stale.length,ok:results.filter((r)=>r.status==='fulfilled'&&r.value?.ok).length,failed:results.filter((r)=>r.status==='rejected'||!r.value?.ok).length};
}
