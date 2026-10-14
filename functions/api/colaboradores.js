import { assertRouteAccess } from '../_lib/route-access.js';
import { cleanText, jsonResponse, requireUser } from '../_lib/auth.js';
import { audit } from '../_lib/core.js';
import { listOperationalResourceStatus } from '../_lib/schedule.js';

const TABLE = 'BASE_COLABORADORES';
const FUNCTIONS = Object.freeze(['MOTORISTA','AJUDANTE']);
const LINKS = Object.freeze(['PRÓPRIO','TERCEIRO']);
const STATUSES = Object.freeze(['DISPONÍVEL','RESERVADO','EM ROTA','PERNOITE','FOLGA','FÉRIAS','ATESTADO','AFASTADO','TREINAMENTO','BLOQUEADO','DESLIGADO']);

const FIELD_MAP = Object.freeze({
  id:'ID', matricula:'MATRICULA', nome:'NOME', telefone:'TELEFONE', funcao:'FUNCAO', vinculo:'VINCULO', status:'STATUS',
  ajudante_rota:'AJUDANTE_ROTA', cidade_rota:'CIDADE_ROTA', rotas_atendidas:'ROTAS_ATENDIDAS',
  ferias_inicio:'FERIAS_INICIO', ferias_fim:'FERIAS_FIM', anomalia:'ANOMALIA', observacoes:'OBSERVACOES',
  unidade:'UNIDADE', data_admissao:'DATA_ADMISSAO', hora_entrada_padrao:'HORA_ENTRADA_PADRAO',
  jornada_contratual_min:'JORNADA_CONTRATUAL_MIN', restricao_motorista:'RESTRICAO_MOTORISTA', restricao_ajudante:'RESTRICAO_AJUDANTE', ativo:'ATIVO', atualizado_em:'ATUALIZADO_EM', atualizado_por:'ATUALIZADO_POR',
});

function normalizedKey(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
}
function boolInt(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value ? 1 : 0;
  return ['1','TRUE','SIM','S','ATIVO','YES'].includes(normalizedKey(value)) ? 1 : 0;
}
function enumValue(value, allowed, fallback, label) {
  const raw = value === undefined || value === null || String(value).trim() === '' ? fallback : value;
  const key = normalizedKey(raw);
  const hit = allowed.find((item)=>normalizedKey(item) === key);
  if (!hit) throw new Error(`${label} inválido. Valores aceitos: ${allowed.join(', ')}.`);
  return hit;
}
function cleanUpper(value, max = 300) {
  return cleanText(value,max).toLocaleUpperCase('pt-BR');
}
function nullableText(value, max = 300) {
  const text = cleanText(value,max);
  return text || null;
}
function canonicalEmployeeFunction(row = {}) {
  const raw = normalizedKey(row.FUNCAO || row['FUNÇÃO'] || row.CARGO || row.CARGO_FUNCAO || '');
  const helperMetadata = boolInt(row.AJUDANTE_ROTA,0) === 1 || Boolean(cleanText(row.CIDADE_ROTA || row.ROTAS_ATENDIDAS || '',2000));
  if (raw.includes('AJUDANTE')) return 'AJUDANTE';
  if (raw.includes('MOTORISTA') || raw.includes('CARRETEIRO') || raw.includes('CONDUTOR')) return 'MOTORISTA';
  if (helperMetadata && (!raw || raw.includes('AUXILIAR'))) return 'AJUDANTE';
  if (raw.includes('AUXILIAR') && (raw.includes('ENTREGA') || raw.includes('CARGA') || raw.includes('ROTA'))) return 'AJUDANTE';
  return raw;
}
async function tableExists(db) {
  return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND UPPER(name)=?").bind(TABLE).first());
}
async function columnsFor(db) {
  const { results } = await db.prepare(`PRAGMA table_info("${TABLE}")`).all();
  return new Set((results || []).map((row) => String(row.name || '').toUpperCase()));
}
export async function ensureRestrictionColumns(db) {
  let columns = await columnsFor(db);
  const additions = [
    ['RESTRICAO_MOTORISTA', `ALTER TABLE "${TABLE}" ADD COLUMN RESTRICAO_MOTORISTA INTEGER NOT NULL DEFAULT 0 CHECK (RESTRICAO_MOTORISTA IN (0,1))`],
    ['RESTRICAO_AJUDANTE', `ALTER TABLE "${TABLE}" ADD COLUMN RESTRICAO_AJUDANTE INTEGER NOT NULL DEFAULT 0 CHECK (RESTRICAO_AJUDANTE IN (0,1))`],
    ['TELEFONE', `ALTER TABLE "${TABLE}" ADD COLUMN TELEFONE TEXT`],
  ];
  for (const [column,sql] of additions) {
    if (columns.has(column)) continue;
    try {
      await db.prepare(sql).run();
    } catch (error) {
      const message=String(error?.message||error||'');
      if (!/duplicate column|already exists/i.test(message)) {
        throw new Error(`Não foi possível preparar o campo ${column} no banco D1: ${message}`);
      }
    }
    columns = await columnsFor(db);
  }
  if (!columns.has('RESTRICAO_MOTORISTA') || !columns.has('RESTRICAO_AJUDANTE') || !columns.has('TELEFONE')) {
    throw new Error('O banco D1 não possui todos os campos necessários do cadastro de colaboradores. Atualize a estrutura do banco e tente novamente.');
  }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_COLAB_DRIVER_RESTRICTION ON "${TABLE}"(FUNCAO,RESTRICAO_MOTORISTA,STATUS,ATIVO)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_COLAB_HELPER_RESTRICTION ON "${TABLE}"(FUNCAO,RESTRICAO_AJUDANTE,STATUS,ATIVO)`).run();
  } catch (error) {
    // Os índices melhoram a consulta, mas não devem impedir a gravação do cadastro.
    console.warn('Não foi possível garantir os índices de restrição em BASE_COLABORADORES:', error?.message||error);
  }
  return columns;
}
function publicRecord(row) {
  const output = { raw:row };
  Object.entries(FIELD_MAP).forEach(([field,column]) => { output[field] = row[column]; });
  // Usa a mesma classificação canônica da Escala/Central, inclusive para bases
  // históricas em que a função está em CARGO ou em descrições como CONDUTOR e
  // AJUDANTE DE MOTORISTA.
  output.funcao = canonicalEmployeeFunction(row);
  output.ativo = boolInt(row.ATIVO,1) === 1;
  output.ajudante_rota = output.funcao === 'AJUDANTE' && boolInt(row.AJUDANTE_ROTA,0) === 1;
  output.restricao_motorista = output.funcao === 'MOTORISTA' && boolInt(row.RESTRICAO_MOTORISTA,0) === 1;
  output.restricao_ajudante = output.funcao === 'AJUDANTE' && boolInt(row.RESTRICAO_AJUDANTE,0) === 1;
  return { ...row, ...output };
}
function fromPayload(payload, current, field, column, fallback = '') {
  if (payload[field] !== undefined) return payload[field];
  if (current && current[column] !== undefined && current[column] !== null) return current[column];
  return fallback;
}
function normalizeEmployee(payload, current = null) {
  const currentFunction=current?canonicalEmployeeFunction(current):'MOTORISTA';
  const funcao = enumValue(payload.funcao !== undefined ? payload.funcao : currentFunction,FUNCTIONS,'MOTORISTA','Função');
  const vinculo = enumValue(fromPayload(payload,current,'vinculo','VINCULO','PRÓPRIO'),LINKS,'PRÓPRIO','Vínculo');
  const status = enumValue(fromPayload(payload,current,'status','STATUS','DISPONÍVEL'),STATUSES,'DISPONÍVEL','Status');
  const nome = cleanUpper(fromPayload(payload,current,'nome','NOME',''),180);
  let matricula = nullableText(fromPayload(payload,current,'matricula','MATRICULA',''),80);
  const ajudanteRota = boolInt(fromPayload(payload,current,'ajudante_rota','AJUDANTE_ROTA',0),0);
  const restricaoMotorista = boolInt(fromPayload(payload,current,'restricao_motorista','RESTRICAO_MOTORISTA',0),0);
  const restricaoAjudante = boolInt(fromPayload(payload,current,'restricao_ajudante','RESTRICAO_AJUDANTE',0),0);
  const rotasAtendidas = cleanText(fromPayload(payload,current,'rotas_atendidas','ROTAS_ATENDIDAS',''),2000);

  if (!nome) throw new Error('Informe o nome do colaborador.');
  if (vinculo === 'PRÓPRIO' && !matricula) throw new Error('Informe a matrícula do colaborador próprio.');
  if (vinculo === 'TERCEIRO' && !matricula) matricula = null;
  if (status === 'RESERVADO' && funcao !== 'MOTORISTA') throw new Error('O status RESERVADO é exclusivo para motoristas em serviços administrativos.');
  if (ajudanteRota && funcao !== 'AJUDANTE') throw new Error('Somente ajudantes podem ser marcados como ajudante de rota.');
  if (ajudanteRota && !rotasAtendidas) throw new Error('Informe as Rotas atendidas para o ajudante de rota.');

  const jornadaRaw = fromPayload(payload,current,'jornada_contratual_min','JORNADA_CONTRATUAL_MIN',null);
  const jornada = jornadaRaw === '' || jornadaRaw === null || jornadaRaw === undefined ? null : Number(jornadaRaw);
  if (jornada !== null && (!Number.isFinite(jornada) || jornada < 0)) throw new Error('Jornada contratual inválida.');

  return {
    MATRICULA:matricula,
    NOME:nome,
    TELEFONE:cleanText(fromPayload(payload,current,'telefone','TELEFONE',''),40),
    FUNCAO:funcao,
    VINCULO:vinculo,
    STATUS:status,
    AJUDANTE_ROTA:funcao === 'AJUDANTE' ? ajudanteRota : 0,
    RESTRICAO_MOTORISTA:funcao === 'MOTORISTA' ? restricaoMotorista : 0,
    RESTRICAO_AJUDANTE:funcao === 'AJUDANTE' ? restricaoAjudante : 0,
    CIDADE_ROTA:cleanText(fromPayload(payload,current,'cidade_rota','CIDADE_ROTA',''),300),
    ROTAS_ATENDIDAS:rotasAtendidas,
    FERIAS_INICIO:cleanText(fromPayload(payload,current,'ferias_inicio','FERIAS_INICIO',''),20),
    FERIAS_FIM:cleanText(fromPayload(payload,current,'ferias_fim','FERIAS_FIM',''),20),
    ANOMALIA:cleanText(fromPayload(payload,current,'anomalia','ANOMALIA',''),300),
    OBSERVACOES:cleanText(fromPayload(payload,current,'observacoes','OBSERVACOES',''),2000),
    UNIDADE:cleanText(fromPayload(payload,current,'unidade','UNIDADE',''),300),
    DATA_ADMISSAO:cleanText(fromPayload(payload,current,'data_admissao','DATA_ADMISSAO',''),20),
    HORA_ENTRADA_PADRAO:cleanText(fromPayload(payload,current,'hora_entrada_padrao','HORA_ENTRADA_PADRAO',''),20),
    JORNADA_CONTRATUAL_MIN:jornada,
    ATIVO:boolInt(fromPayload(payload,current,'ativo','ATIVO',1),1),
  };
}
async function duplicateEmployee(db, employee, currentId = '') {
  if (employee.MATRICULA) {
    return db.prepare(`SELECT ID FROM "${TABLE}"
      WHERE COALESCE(ATIVO,1)=1 AND UPPER(TRIM(COALESCE(MATRICULA,'')))=UPPER(TRIM(?))
        AND (?='' OR ID<>?) LIMIT 1`)
      .bind(employee.MATRICULA,currentId,currentId).first();
  }
  return db.prepare(`SELECT ID FROM "${TABLE}"
    WHERE COALESCE(ATIVO,1)=1 AND TRIM(COALESCE(MATRICULA,''))=''
      AND UPPER(TRIM(NOME))=UPPER(TRIM(?)) AND UPPER(TRIM(FUNCAO))=UPPER(TRIM(?))
      AND (?='' OR ID<>?) LIMIT 1`)
    .bind(employee.NOME,employee.FUNCAO,currentId,currentId).first();
}
async function write({ db, request, method, user }) {
  if (!(await tableExists(db))) throw new Error(`A tabela ${TABLE} não existe no D1.`);
  const payload = await request.json().catch(() => ({}));
  const columns = await ensureRestrictionColumns(db);
  const id = method === 'POST' ? (cleanText(payload.id,120) || `COL-${crypto.randomUUID()}`) : cleanText(payload.id,120);
  if (!id) throw new Error('Registro inválido.');

  const current = method === 'PUT'
    ? await db.prepare(`SELECT * FROM "${TABLE}" WHERE ID=? LIMIT 1`).bind(id).first()
    : null;
  if (method === 'PUT' && !current) throw new Error('Colaborador não encontrado.');

  const employee = normalizeEmployee(payload,current);
  const duplicate = await duplicateEmployee(db,employee,id);
  if (duplicate) {
    if (employee.MATRICULA) throw new Error(`Já existe colaborador ativo com a matrícula ${employee.MATRICULA}.`);
    throw new Error('Já existe colaborador terceiro ativo com esse nome e função.');
  }

  const now = new Date().toISOString();
  const values = {};
  for (const [column,value] of Object.entries(employee)) if (columns.has(column)) values[column] = value;
  if (columns.has('ATUALIZADO_EM')) values.ATUALIZADO_EM = now;
  if (columns.has('ATUALIZADO_POR')) values.ATUALIZADO_POR = user.name || user.email || '';
  if (columns.has('USUARIO')) values.USUARIO = user.email || user.name || '';

  if (method === 'POST') {
    if (columns.has('ID')) values.ID = id;
    if (columns.has('CRIADO_EM')) values.CRIADO_EM = now;
    const names = Object.keys(values);
    await db.prepare(`INSERT INTO "${TABLE}" (${names.map((n)=>`"${n}"`).join(',')}) VALUES (${names.map(()=>'?').join(',')})`)
      .bind(...names.map((n)=>values[n])).run();
  } else {
    const names = Object.keys(values).filter((name)=>name !== 'ID' && name !== 'CRIADO_EM');
    const result = await db.prepare(`UPDATE "${TABLE}" SET ${names.map((n)=>`"${n}"=?`).join(',')} WHERE ID=?`)
      .bind(...names.map((n)=>values[n]),id).run();
    if (!Number(result.meta?.changes || 0)) throw new Error('Colaborador não encontrado.');
  }

  const saved = await db.prepare(`SELECT * FROM "${TABLE}" WHERE ID=? LIMIT 1`).bind(id).first();
  await audit(db,user,method === 'POST' ? 'CRIAR' : 'EDITAR','COLABORADORES',id,{before:current,after:saved});
  return publicRecord(saved);
}

export async function onRequestGet({ env, request }) {
  if (!env.DB) return jsonResponse({ erro:"Binding D1 'DB' não encontrado." },500);
  const auth = await requireUser(env.DB,request);
  if (auth.response) return auth.response;
  try {
    assertRouteAccess(auth.user,'route.catalog');
    if (!(await tableExists(env.DB))) {
      return jsonResponse({ sistema:'NATTO DMS',versao:'1',total:0,records:[],colaboradores:[],aviso:`Tabela ${TABLE} não encontrada.` });
    }
    const url = new URL(request.url);
    const includeInactive = url.searchParams.get('includeInactive') === '1';
    const functionFilter = normalizedKey(url.searchParams.get('funcao'));
    const statusFilter = normalizedKey(url.searchParams.get('status'));
    const linkFilter = normalizedKey(url.searchParams.get('vinculo'));
    const q = normalizedKey(url.searchParams.get('q') || url.searchParams.get('busca'));
    const where = includeInactive ? '' : 'WHERE COALESCE(ATIVO,1)=1';
    const { results } = await env.DB.prepare(`SELECT * FROM "${TABLE}" ${where} ORDER BY NOME COLLATE NOCASE ASC LIMIT 20000`).all();
    // O STATUS gravado no cadastro (EM ROTA/PERNOITE) é transitório e envelhece;
    // a lista exibe o status operacional de hoje (férias pelo período, rota/pernoite
    // por viagem realmente aberta). O campo `status` do cadastro não é alterado.
    const operational = new Map();
    if (url.searchParams.get('operacional') === '1') try {
      const today = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
      const live = await listOperationalResourceStatus(env.DB, today);
      for (const item of live.employees) operational.set(item.id, item.status);
    } catch (error) { /* sem contexto operacional: mantém o status do cadastro */ }
    const records = (results || []).map(publicRecord).map((record)=>{
      const live = operational.get(String(record.id));
      return live ? { ...record, status_cadastro:record.status, status_operacional:live } : record;
    }).filter((record)=>{
      if (functionFilter && normalizedKey(record.funcao) !== functionFilter) return false;
      if (statusFilter && normalizedKey(record.status_operacional || record.status) !== statusFilter) return false;
      if (linkFilter && normalizedKey(record.vinculo) !== linkFilter) return false;
      if (q && !normalizedKey([record.matricula,record.nome,record.telefone,record.vinculo,record.status_operacional || record.status,record.cidade_rota].join(' ')).includes(q)) return false;
      return true;
    });
    return jsonResponse({ sistema:'NATTO DMS',versao:'1',total:records.length,records,colaboradores:records });
  } catch (error) {
    return jsonResponse({ erro:error.message || String(error) },400);
  }
}

export async function onRequestPost({ env, request }) {
  if (!env.DB) return jsonResponse({ erro:"Binding D1 'DB' não encontrado." },500);
  const auth = await requireUser(env.DB,request);
  if (auth.response) return auth.response;
  try {
    assertRouteAccess(auth.user,'route.catalog',true);
    const record = await write({db:env.DB,request,method:'POST',user:auth.user});
    return jsonResponse({ok:true,versao:'1',id:record.id,record},201);
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
    const record = await write({db:env.DB,request,method:'PUT',user:auth.user});
    return jsonResponse({ok:true,versao:'1',id:record.id,record});
  } catch (error) {
    return jsonResponse({erro:error.message || String(error)},400);
  }
}
