import { assertRouteAccess } from '../_lib/route-access.js';
import { cleanText, jsonResponse, requireUser } from '../_lib/auth.js';
import { audit } from '../_lib/core.js';
import { listOperationalResourceStatus } from '../_lib/schedule.js';

const VEHICLE_TYPES = Object.freeze(['3/4','TOCO','TRUCK','BITRUCK','CARRETA','OUTROS']);
const LINKS = Object.freeze(['PRÓPRIO','TERCEIRO']);
const VEHICLE_STATUSES = Object.freeze(['DISPONÍVEL','EM ROTA','PERNOITE','MANUTENÇÃO','RESERVADO','BLOQUEADO','ANOMALIA','INATIVO']);
const REGIONS = Object.freeze(['AG1','AG2','SRT','PB','AL','RN','CE','BJ','MARANHAO','OUTRA']);
const ROUTE_PROFILES = Object.freeze(['VAREJO','REDE','MISTO','ATACADO']);
// Tipo de serviço da rota: ENTREGA (padrão) ou serviço administrativo/outros, que não
// exige placa nem ajudante na Escala e paga CAJU pela própria escala.
const ROUTE_SERVICE_TYPES = Object.freeze(['ENTREGA','ADMINISTRATIVO','OUTROS']);
let routeServiceColumnPromise = null;
async function ensureRouteServiceColumn(db) {
  if (!routeServiceColumnPromise) routeServiceColumnPromise = (async () => {
    const { results = [] } = await db.prepare('PRAGMA table_info(BASE_ROTAS)').all();
    if (!results.length || results.some((row)=>String(row.name).toUpperCase()==='TIPO_SERVICO')) return;
    await db.prepare("ALTER TABLE BASE_ROTAS ADD COLUMN TIPO_SERVICO TEXT DEFAULT 'ENTREGA'").run();
  })().catch((error)=>{ routeServiceColumnPromise = null; throw error; });
  return routeServiceColumnPromise;
}

// Veículos: apelido (ex.: T-Cross, aparece ao lado da placa na Escala) e limite de motoristas por escala (1 a 3).
let vehicleExtraColumnsPromise = null;
async function ensureVehicleExtraColumns(db) {
  if (!vehicleExtraColumnsPromise) vehicleExtraColumnsPromise = (async () => {
    const { results = [] } = await db.prepare('PRAGMA table_info(BASE_VEICULOS)').all();
    if (!results.length) return;
    const names = new Set(results.map((row)=>String(row.name).toUpperCase()));
    if (!names.has('APELIDO')) await db.prepare('ALTER TABLE BASE_VEICULOS ADD COLUMN APELIDO TEXT').run();
    if (!names.has('MAX_MOTORISTAS')) await db.prepare('ALTER TABLE BASE_VEICULOS ADD COLUMN MAX_MOTORISTAS INTEGER DEFAULT 1').run();
  })().catch((error)=>{ vehicleExtraColumnsPromise = null; throw error; });
  return vehicleExtraColumnsPromise;
}

const CATALOGS = Object.freeze({
  vehicles: {
    table:'BASE_VEICULOS', key:'ID', order:'PLACA COLLATE NOCASE', idPrefix:'VEI', module:'VEICULOS',
    fields:{
      id:'ID', placa:'PLACA', tipo:'TIPO', vinculo:'VINCULO', capacidade_t:'CAPACIDADE_TON',
      status:'STATUS', local_atual:'LOCAL_ATUAL', transportadora:'TRANSPORTADORA',
      permite_rota_comercial:'PERMITE_ROTA_COMERCIAL', motivo_reserva:'MOTIVO_RESERVA',
      data_reserva:'DATA_RESERVA', previsao_pronto_manutencao:'PREVISAO_PRONTO_MANUTENCAO',
      observacoes:'OBSERVACOES', ativo:'ATIVO', atualizado_em:'ATUALIZADO_EM', atualizado_por:'ATUALIZADO_POR',
      apelido:'APELIDO', max_motoristas:'MAX_MOTORISTAS',
    },
  },
  routes: {
    table:'BASE_ROTAS', key:'ID', order:'ROTA COLLATE NOCASE', idPrefix:'ROT', module:'ROTAS',
    fields:{
      id:'ID', nome:'ROTA', rota:'ROTA', regiao:'REGIAO', perfil:'PERFIL',
      tempo_ida_min:'TEMPO_IDA_MIN', tempo_entre_cidades_min:'TEMPO_ENTRE_CIDADES_MIN',
      tempo_volta_min:'TEMPO_VOLTA_MIN', tempo_por_entrega_min:'TEMPO_POR_ENTREGA_MIN',
      duracao_dias:'DURACAO_DIAS', dias_semana:'DIAS_SEMANA', tipo_servico:'TIPO_SERVICO', observacoes:'OBSERVACOES', ativo:'ATIVO',
    },
  },
});

const TABLE_NAME = /^[A-Z0-9_]+$/;
function quoteIdentifier(value) {
  const text = String(value || '').toUpperCase();
  if (!TABLE_NAME.test(text)) throw new Error('Identificador inválido.');
  return `"${text}"`;
}
function key(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
}
function toBooleanInt(value, fallback = 1) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value ? 1 : 0;
  return ['1','TRUE','SIM','S','ATIVO','YES'].includes(key(value)) ? 1 : 0;
}
function enumValue(value, allowed, fallback, label) {
  const raw = value === undefined || value === null || String(value).trim() === '' ? fallback : value;
  const normalized = key(raw);
  const hit = allowed.find((item)=>key(item) === normalized);
  if (!hit) throw new Error(`${label} inválido. Valores aceitos: ${allowed.join(', ')}.`);
  return hit;
}
function plate(value) {
  return key(value).replace(/[^A-Z0-9]/g,'');
}
function cleanUpper(value,max=300) {
  return cleanText(value,max).toLocaleUpperCase('pt-BR');
}
function numberValue(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(String(value).trim().replace(',','.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}
function durationMinutes(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return Math.max(0,Number(fallback||0));
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0,Math.round(Math.abs(value)<1 ? value*1440 : value));
  const text = String(value).trim();
  if (!text) return Math.max(0,Number(fallback||0));
  const clock = text.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (clock) return Math.max(0,Number(clock[1])*60+Number(clock[2])+Math.round(Number(clock[3]||0)/60));
  const normalized = key(text).replace(',','.');
  const compact = normalized.match(/^(\d+(?:\.\d+)?)\s*H\s*(\d{1,2})?\s*(?:M(?:IN)?)?$/);
  if (compact) return Math.max(0,Math.round(Number(compact[1])*60+Number(compact[2]||0)));
  const days = normalized.match(/(\d+(?:\.\d+)?)\s*D/);
  const hours = normalized.match(/(\d+(?:\.\d+)?)\s*H/);
  const minutes = normalized.match(/(\d+(?:\.\d+)?)\s*M(?:IN)?/);
  if (days || hours || minutes) return Math.max(0,Math.round(Number(days?.[1]||0)*1440+Number(hours?.[1]||0)*60+Number(minutes?.[1]||0)));
  const numeric = Number(normalized.replace(/\s*(?:MIN|MINUTOS?)$/,''));
  if (!Number.isFinite(numeric)) throw new Error(`Tempo inválido: ${text}. Use minutos (ex.: 83) ou duração (ex.: 1h23).`);
  return Math.max(0,Math.round(numeric));
}
function normalizeRegion(value) {
  let normalized = key(value);
  if (normalized === 'STR') normalized = 'SRT';
  if (normalized === 'MARANHÃO' || normalized === 'MA') normalized = 'MARANHAO';
  return REGIONS.includes(normalized) ? normalized : 'OUTRA';
}
function resolveRegion(regionValue, routeName) {
  const route = key(routeName);
  if (/\b(CAIXA|CAIXAS|MANOBRA|ALMOXARIFADO)\b/.test(route)) return 'BJ';
  if (/^MARANHAO\b/.test(route)) return 'MARANHAO';
  const direct = normalizeRegion(regionValue);
  if (direct !== 'OUTRA') return direct;
  const match = route.match(/^(AG1|AG2|SRT|STR|PB|AL|RN|CE|BJ)\b/);
  return match ? normalizeRegion(match[1]) : 'OUTRA';
}
async function tableExists(db, table) {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND UPPER(name)=?")
    .bind(String(table).toUpperCase()).first();
  return Boolean(row?.name);
}
async function columnsFor(db, table) {
  const { results } = await db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
  return new Set((results || []).map((row) => String(row.name || '').toUpperCase()));
}
function publicRecord(row, type) {
  const entry = CATALOGS[type];
  const output = { raw:row };
  Object.entries(entry.fields).forEach(([field,column]) => { output[field] = row[column]; });
  output.id = row[entry.key] || output.id;
  output.ativo = toBooleanInt(row.ATIVO,1) === 1;
  if (type === 'routes') {
    output.nome = row.ROTA;
    output.rota = row.ROTA;
  }
  return { ...row, ...output };
}
function resolveCatalog(request) {
  const url = new URL(request.url);
  const type = String(url.searchParams.get('type') || '').toLowerCase();
  const catalog = CATALOGS[type];
  if (!catalog) throw new Error('Catálogo inválido.');
  return { type, catalog, url };
}
function fromPayload(payload,current,field,column,fallback='') {
  if (payload[field] !== undefined) return payload[field];
  if (current && current[column] !== undefined && current[column] !== null) return current[column];
  return fallback;
}
function normalizeVehicle(payload,current) {
  const placa = plate(fromPayload(payload,current,'placa','PLACA',''));
  if (!placa) throw new Error('Informe a placa.');
  const tipo = enumValue(fromPayload(payload,current,'tipo','TIPO','OUTROS'),VEHICLE_TYPES,'OUTROS','Tipo de veículo');
  const vinculo = enumValue(fromPayload(payload,current,'vinculo','VINCULO','PRÓPRIO'),LINKS,'PRÓPRIO','Vínculo');
  const status = enumValue(fromPayload(payload,current,'status','STATUS','DISPONÍVEL'),VEHICLE_STATUSES,'DISPONÍVEL','Status');
  const capacidade = numberValue(fromPayload(payload,current,'capacidade_t','CAPACIDADE_TON',null),null);
  if (capacidade !== null && capacidade < 0) throw new Error('A capacidade do veículo não pode ser negativa.');
  let localAtual = cleanText(fromPayload(payload,current,'local_atual','LOCAL_ATUAL',''),300);
  if (status === 'DISPONÍVEL') localAtual = '';
  return {
    PLACA:placa, TIPO:tipo, VINCULO:vinculo, CAPACIDADE_TON:capacidade, STATUS:status,
    LOCAL_ATUAL:localAtual,
    TRANSPORTADORA:cleanUpper(fromPayload(payload,current,'transportadora','TRANSPORTADORA',''),300),
    APELIDO:cleanText(fromPayload(payload,current,'apelido','APELIDO',''),60),
    MAX_MOTORISTAS:Math.max(1,Math.min(3,Math.round(numberValue(fromPayload(payload,current,'max_motoristas','MAX_MOTORISTAS',1),1)||1))),
    PERMITE_ROTA_COMERCIAL:toBooleanInt(fromPayload(payload,current,'permite_rota_comercial','PERMITE_ROTA_COMERCIAL',1),1),
    MOTIVO_RESERVA:cleanText(fromPayload(payload,current,'motivo_reserva','MOTIVO_RESERVA',''),300),
    DATA_RESERVA:cleanText(fromPayload(payload,current,'data_reserva','DATA_RESERVA',''),20),
    PREVISAO_PRONTO_MANUTENCAO:cleanText(fromPayload(payload,current,'previsao_pronto_manutencao','PREVISAO_PRONTO_MANUTENCAO',''),40),
    OBSERVACOES:cleanText(fromPayload(payload,current,'observacoes','OBSERVACOES',''),2000),
    ATIVO:toBooleanInt(fromPayload(payload,current,'ativo','ATIVO',1),1),
  };
}
function normalizeRoute(payload,current) {
  const nome = cleanUpper(fromPayload(payload,current,'nome','ROTA',fromPayload(payload,current,'rota','ROTA','')),300);
  if (!nome) throw new Error('Informe a rota.');
  const regiao = resolveRegion(fromPayload(payload,current,'regiao','REGIAO','OUTRA'),nome);
  let perfilRaw = fromPayload(payload,current,'perfil','PERFIL','VAREJO');
  if (key(perfilRaw) === 'REDES') perfilRaw = 'REDE';
  const perfil = ROUTE_PROFILES.find((item)=>key(item)===key(perfilRaw)) || 'VAREJO';
  const duracao = Math.max(1,Math.round(numberValue(fromPayload(payload,current,'duracao_dias','DURACAO_DIAS',1),1)));
  let serviceRaw = key(fromPayload(payload,current,'tipo_servico','TIPO_SERVICO','ENTREGA'));
  if (serviceRaw === 'SERVICO ADMINISTRATIVO' || serviceRaw === 'ADMINISTRATIVO / OUTROS') serviceRaw = 'ADMINISTRATIVO';
  const tipoServico = ROUTE_SERVICE_TYPES.includes(serviceRaw) ? serviceRaw : 'ENTREGA';
  return {
    ROTA:nome, REGIAO:regiao, PERFIL:perfil, TIPO_SERVICO:tipoServico,
    TEMPO_IDA_MIN:durationMinutes(fromPayload(payload,current,'tempo_ida_min','TEMPO_IDA_MIN',0),0),
    TEMPO_ENTRE_CIDADES_MIN:durationMinutes(fromPayload(payload,current,'tempo_entre_cidades_min','TEMPO_ENTRE_CIDADES_MIN',0),0),
    TEMPO_VOLTA_MIN:durationMinutes(fromPayload(payload,current,'tempo_volta_min','TEMPO_VOLTA_MIN',0),0),
    TEMPO_POR_ENTREGA_MIN:durationMinutes(fromPayload(payload,current,'tempo_por_entrega_min','TEMPO_POR_ENTREGA_MIN',0),0),
    DURACAO_DIAS:duracao,
    DIAS_SEMANA:cleanUpper(fromPayload(payload,current,'dias_semana','DIAS_SEMANA','SEG,TER,QUA,QUI,SEX,SAB'),300),
    OBSERVACOES:cleanText(fromPayload(payload,current,'observacoes','OBSERVACOES',''),2000),
    ATIVO:toBooleanInt(fromPayload(payload,current,'ativo','ATIVO',1),1),
  };
}
async function readRows(db,type,catalog,url) {
  if (!(await tableExists(db,catalog.table))) return [];
  const includeInactive = url.searchParams.get('includeInactive') === '1';
  const where = includeInactive ? '' : 'WHERE COALESCE(ATIVO,1)=1';
  const { results } = await db.prepare(`SELECT * FROM ${quoteIdentifier(catalog.table)} ${where} ORDER BY ${catalog.order} LIMIT 10000`).all();
  const q = key(url.searchParams.get('q') || url.searchParams.get('busca'));
  return (results || []).map((row)=>publicRecord(row,type)).filter((record)=>{
    if (!q) return true;
    const haystack = type === 'vehicles'
      ? [record.placa,record.tipo,record.transportadora,record.local_atual,record.status]
      : [record.rota,record.regiao,record.perfil];
    return key(haystack.join(' ')).includes(q);
  });
}
async function duplicateCatalog(db,type,record,currentId) {
  if (type === 'vehicles') {
    return db.prepare(`SELECT ID FROM BASE_VEICULOS
      WHERE COALESCE(ATIVO,1)=1 AND UPPER(TRIM(PLACA))=UPPER(TRIM(?)) AND (?='' OR ID<>?) LIMIT 1`)
      .bind(record.PLACA,currentId,currentId).first();
  }
  return db.prepare(`SELECT ID FROM BASE_ROTAS
    WHERE COALESCE(ATIVO,1)=1 AND UPPER(TRIM(ROTA))=UPPER(TRIM(?)) AND (?='' OR ID<>?) LIMIT 1`)
    .bind(record.ROTA,currentId,currentId).first();
}
async function writeCatalog({ db, request, method, user }) {
  const { type, catalog } = resolveCatalog(request);
  if (!(await tableExists(db,catalog.table))) throw new Error(`A tabela ${catalog.table} não existe no D1.`);
  if (type === 'routes') await ensureRouteServiceColumn(db);
  if (type === 'vehicles') await ensureVehicleExtraColumns(db);
  const payload = await request.json().catch(() => ({}));
  const id = method === 'POST' ? (cleanText(payload.id,120) || `${catalog.idPrefix}-${crypto.randomUUID()}`) : cleanText(payload.id,120);
  if (!id) throw new Error('Registro inválido.');
  const current = method === 'PUT'
    ? await db.prepare(`SELECT * FROM ${quoteIdentifier(catalog.table)} WHERE ${quoteIdentifier(catalog.key)}=? LIMIT 1`).bind(id).first()
    : null;
  if (method === 'PUT' && !current) throw new Error('Registro não encontrado para atualização.');

  const record = type === 'vehicles' ? normalizeVehicle(payload,current) : normalizeRoute(payload,current);
  const duplicate = await duplicateCatalog(db,type,record,id);
  if (duplicate) throw new Error(type === 'vehicles'
    ? `Já existe um veículo ativo com a placa ${record.PLACA}.`
    : 'Já existe uma rota ativa com esse nome.');

  const columns = await columnsFor(db,catalog.table);
  const now = new Date().toISOString();
  const values = {};
  for (const [column,value] of Object.entries(record)) if (columns.has(column)) values[column] = value;
  if (columns.has('ATUALIZADO_EM')) values.ATUALIZADO_EM = now;
  if (columns.has('ATUALIZADO_POR')) values.ATUALIZADO_POR = user.name || user.email || '';
  if (columns.has('USUARIO')) values.USUARIO = user.email || user.name || '';

  if (method === 'POST') {
    values[catalog.key] = id;
    if (columns.has('CRIADO_EM')) values.CRIADO_EM = now;
    const names = Object.keys(values);
    await db.prepare(`INSERT INTO ${quoteIdentifier(catalog.table)} (${names.map(quoteIdentifier).join(',')}) VALUES (${names.map(()=>'?').join(',')})`)
      .bind(...names.map((name)=>values[name])).run();
  } else {
    const names = Object.keys(values).filter((name)=>name !== catalog.key && name !== 'CRIADO_EM');
    const result = await db.prepare(`UPDATE ${quoteIdentifier(catalog.table)} SET ${names.map((name)=>`${quoteIdentifier(name)}=?`).join(',')} WHERE ${quoteIdentifier(catalog.key)}=?`)
      .bind(...names.map((name)=>values[name]),id).run();
    if (!Number(result.meta?.changes || 0)) throw new Error('Registro não encontrado para atualização.');
  }

  const saved = await db.prepare(`SELECT * FROM ${quoteIdentifier(catalog.table)} WHERE ${quoteIdentifier(catalog.key)}=? LIMIT 1`).bind(id).first();
  await audit(db,user,method === 'POST' ? 'CRIAR' : 'EDITAR',catalog.module,id,{before:current,after:saved});
  return { type, id, record:publicRecord(saved,type) };
}

export async function onRequestGet({ env, request }) {
  if (!env.DB) return jsonResponse({ erro:"Binding D1 'DB' não encontrado." },500);
  const auth = await requireUser(env.DB,request);
  if (auth.response) return auth.response;
  try {
    assertRouteAccess(auth.user,'route.catalog');
    const { type, catalog, url } = resolveCatalog(request);
    if (type === 'routes') await ensureRouteServiceColumn(env.DB).catch(()=>{});
    if (type === 'vehicles') await ensureVehicleExtraColumns(env.DB).catch(()=>{});
    let records = await readRows(env.DB,type,catalog,url);
    // Veículos: STATUS gravado (EM ROTA/PERNOITE) é transitório; com ?operacional=1 a
    // lista recebe o status de hoje calculado pela mesma regra da Escala/Central.
    if (type === 'vehicles' && url.searchParams.get('operacional') === '1') try {
      const today = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
      const live = new Map((await listOperationalResourceStatus(env.DB, today)).vehicles.map((item)=>[item.id,item.status]));
      records = records.map((record)=>live.has(String(record.id)) ? { ...record, status_cadastro:record.status, status_operacional:live.get(String(record.id)) } : record);
    } catch (error) { /* mantém o status do cadastro */ }
    return jsonResponse({sistema:'NATTO DMS',versao:'1',type,table:catalog.table,total:records.length,records});
  } catch (error) {
    return jsonResponse({erro:error.message || String(error)},400);
  }
}
export async function onRequestPost({ env, request }) {
  if (!env.DB) return jsonResponse({ erro:"Binding D1 'DB' não encontrado." },500);
  const auth = await requireUser(env.DB,request);
  if (auth.response) return auth.response;
  try {
    assertRouteAccess(auth.user,'route.catalog',true);
    const saved = await writeCatalog({db:env.DB,request,method:'POST',user:auth.user});
    return jsonResponse({ok:true,versao:'1',...saved},201);
  } catch (error) {
    return jsonResponse({erro:error.message || String(error)},400);
  }
}
export async function onRequestPut({ env, request }) {
  if (!env.DB) return jsonResponse({ erro:"Binding D1 'DB' não encontrado." },500);
  const auth = await requireUser(env.DB,request);
  if (auth.response) return auth.response;
  try {
    assertRouteAccess(auth.user,'route.catalog',true);
    const saved = await writeCatalog({db:env.DB,request,method:'PUT',user:auth.user});
    return jsonResponse({ok:true,versao:'1',...saved});
  } catch (error) {
    return jsonResponse({erro:error.message || String(error)},400);
  }
}
