import { setManualAvailability } from './availability.js';
import { cleanText } from './auth.js';

export const ALLOWED_MODULES = new Set([
  'dashboard','schedule','departures','departure_indicators','monitoring','returns','resources','indicators',
  'route_management_data','awards','vehicles','drivers','helpers','routes','users','settings','operational_pending'
]);

const RESOURCE_TYPES = new Set(['VEICULO','MOTORISTA','AJUDANTE']);
let coreSchemaPromise = null;

const HARD_BLOCKED_STATUSES = new Set([
  'INATIVO','BLOQUEADO','MANUTENCAO','MANUTENÇÃO','RESERVADO','AFASTADO','ATESTADO','FERIAS','FÉRIAS','INSS','DESLIGADO'
]);

async function coreSchemaReady(db) {
  try {
    const expected = [
      'ROUTE_RECORDS','IDX_ROUTE_REG_MODULE','IDX_ROUTE_REG_DATE','IDX_ROUTE_REG_STATUS',
      'ROUTE_AUDIT','IDX_ROUTE_AUDIT_MODULE','ROUTE_RESOURCE_EVENTS',
      'IDX_ROUTE_RES_EVENT_RESOURCE','IDX_ROUTE_RES_EVENT_DATE','IDX_ROUTE_RES_EVENT_SOURCE',
    ];
    const placeholders = expected.map(() => '?').join(',');
    const result = await db.prepare(`SELECT name FROM sqlite_master WHERE name IN (${placeholders})`).bind(...expected).all();
    const found = new Set((result.results || []).map((row) => String(row.name || '')));
    return expected.every((name) => found.has(name));
  } catch {
    return false;
  }
}

// Índices de performance criados por migrations não fazem parte do bootstrap
// síncrono da API. Criar/recriar índice grande durante uma requisição operacional
// pode consumir o tempo do Worker e devolver HTTP 503 sem JSON. A API garante aqui
// apenas o esquema estrutural mínimo; migrations de performance continuam opcionais
// e podem ser aplicadas fora do fluxo de Salvar.
export async function ensureCoreSchema(db) {
  if (!coreSchemaPromise) {
    coreSchemaPromise = (async () => {
      if (await coreSchemaReady(db)) return;
      await db.batch([
          db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_RECORDS (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            MODULE TEXT NOT NULL,
            TITLE TEXT,
            STATUS TEXT,
            DATE_KEY TEXT,
            DATA_JSON TEXT NOT NULL,
            CREATED_BY INTEGER,
            UPDATED_BY INTEGER,
            CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`),
          db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_REG_MODULE ON ROUTE_RECORDS(MODULE)`),
          db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_REG_DATE ON ROUTE_RECORDS(MODULE, DATE_KEY)`),
          db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_REG_STATUS ON ROUTE_RECORDS(MODULE, STATUS)`),
          db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_AUDIT (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            USER_ID INTEGER,
            USER_NAME TEXT,
            ACTION TEXT NOT NULL,
            MODULE TEXT,
            RECORD_ID INTEGER,
            DETAILS TEXT,
            CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`),
          db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_AUDIT_MODULE ON ROUTE_AUDIT(MODULE, CREATED_AT)`),
          db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_RESOURCE_EVENTS (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            EVENT_KEY TEXT NOT NULL UNIQUE,
            RESOURCE_TYPE TEXT NOT NULL,
            RESOURCE_KEY TEXT NOT NULL,
            RESOURCE_ID TEXT,
            RESOURCE_NAME TEXT,
            STATUS TEXT NOT NULL,
            EFFECTIVE_AT TEXT NOT NULL,
            DATE_KEY TEXT NOT NULL,
            SOURCE TEXT NOT NULL,
            SOURCE_MODULE TEXT,
            SOURCE_RECORD_ID INTEGER,
            SCHEDULE_RECORD_ID INTEGER,
            DETAILS_JSON TEXT NOT NULL DEFAULT '{}',
            CREATED_BY INTEGER,
            CREATED_BY_NAME TEXT,
            CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`),
          db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_RES_EVENT_RESOURCE ON ROUTE_RESOURCE_EVENTS(RESOURCE_TYPE, RESOURCE_KEY, EFFECTIVE_AT)`),
          db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_RES_EVENT_DATE ON ROUTE_RESOURCE_EVENTS(DATE_KEY, STATUS)`),
          db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_RES_EVENT_SOURCE ON ROUTE_RESOURCE_EVENTS(SOURCE_MODULE, SOURCE_RECORD_ID)`),
        ]);
    })().catch((error) => { coreSchemaPromise = null; throw error; });
  }
  return coreSchemaPromise;
}

export function normalizeModule(value) {
  const module = String(value || '').trim().toLowerCase();
  if (!ALLOWED_MODULES.has(module)) throw new Error('Módulo inválido.');
  return module;
}

export function parseData(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function updateVehicleLastDriver(db, { placa='', vehicleId='', motoristaId='', motoristaNome='', scheduleId='', effectiveAt='' } = {}) {
  const plateKey = String(placa || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);
  const driverName = cleanText(motoristaNome || '').slice(0,180);
  if (!plateKey || !driverName) return { updated:false, reason:'missing-data' };
  const when = String(effectiveAt || new Date().toISOString()).replace('T',' ').replace('Z','').slice(0,19);
  try {
    await db.prepare(`INSERT INTO ROUTE_VEHICLE_LAST_DRIVER (PLATE,VEHICLE_ID,DRIVER_ID,DRIVER_NAME,SCHEDULE_ID,EFFECTIVE_AT,UPDATED_AT)
      VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(PLATE) DO UPDATE SET VEHICLE_ID=excluded.VEHICLE_ID,DRIVER_ID=excluded.DRIVER_ID,DRIVER_NAME=excluded.DRIVER_NAME,SCHEDULE_ID=excluded.SCHEDULE_ID,EFFECTIVE_AT=excluded.EFFECTIVE_AT,UPDATED_AT=CURRENT_TIMESTAMP`)
      .bind(plateKey,String(vehicleId || '').trim() || null,String(motoristaId || '').trim() || null,driverName,String(scheduleId || '').trim() || null,when).run();
    return { updated:true };
  } catch (error) {
    // Deploy seguro: se o código chegar antes da migration 0021, o fluxo operacional
    // continua salvando; apenas a informação auxiliar aguarda a aplicação do SQL.
    if (/no such table/i.test(String(error?.message || error))) return { updated:false, reason:'migration-pending' };
    throw error;
  }
}

async function vehicleLastDriverMap(db) {
  try {
    const {results=[]}=await db.prepare(`SELECT PLATE,VEHICLE_ID,DRIVER_ID,DRIVER_NAME,SCHEDULE_ID,EFFECTIVE_AT FROM ROUTE_VEHICLE_LAST_DRIVER`).all();
    return new Map((results||[]).map((row)=>[String(row.PLATE||'').toUpperCase().replace(/[^A-Z0-9]/g,''),row]));
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) return new Map();
    throw error;
  }
}

function parseArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object');
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
}

export function inferStatus(data) {
  return cleanText(data.status || data.STATUS || data.situacao || data.SITUACAO || 'ATIVO', 60).toUpperCase();
}

export function inferDate(data) {
  const candidates = [
    data.data_operacao, data.data, data.DATA, data.date, data.data_saida, data.DATA_SAIDA,
    data.periodo_inicio, data.inicio, data.created_at,
  ];
  const found = candidates.find((value) => /^\d{4}-\d{2}-\d{2}/.test(String(value || '')));
  return found ? String(found).slice(0, 10) : '';
}

export function inferTitle(data, module) {
  const candidates = [
    data.titulo, data.title, data.rota, data.ROTA, data.nome, data.NOME, data.placa, data.PLACA,
    data.motorista, data.MOTORISTA, data.colaborador, data.COLABORADOR, data.destino, data.DESTINO,
  ];
  const found = candidates.find((value) => String(value || '').trim());
  return cleanText(found || module, 160);
}

function normalizeComparable(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
}

function normalizeStatus(value) {
  return normalizeComparable(value).replace(/\s+/g, ' ');
}

function canonicalResourceStatus(value) {
  const key = normalizeStatus(value);
  return ({
    'DISPONIVEL':'DISPONÍVEL',
    'EM ROTA':'EM ROTA',
    'PERNOITE':'PERNOITE',
    'INDISPONIVEL':'INDISPONÍVEL',
    'SETIMO':'DISPONÍVEL',
    'SETIMO DIA':'DISPONÍVEL',
    '7 DIA':'DISPONÍVEL',
    '7O DIA':'DISPONÍVEL',
  })[key] || String(value || '').trim().toUpperCase();
}

function normalizeResourceType(value) {
  const normalized = normalizeComparable(value).replace(/Í/g, 'I');
  if (normalized === 'VEICULO' || normalized === 'VEÍCULO') return 'VEICULO';
  if (normalized === 'MOTORISTA' || normalized === 'CARRETEIRO' || normalized === 'MOTORISTA CARRETEIRO') return 'MOTORISTA';
  if (normalized === 'AJUDANTE' || normalized.startsWith('AJUDANTE ')) return 'AJUDANTE';
  throw new Error('Tipo de recurso inválido.');
}

function splitHelpers(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 2);
  return String(value || '').split(/\s*(?:\/|;|\||,)\s*/).map((item) => item.trim()).filter(Boolean).slice(0, 2);
}

export function normalizeResourceFields(source) {
  const data = { ...parseData(source) };
  const helpers = [
    data.ajudante_1 ?? data.ajudante1 ?? data.AJUDANTE_1 ?? data.AJUDANTE1,
    data.ajudante_2 ?? data.ajudante2 ?? data.AJUDANTE_2 ?? data.AJUDANTE2,
  ].map((item) => String(item || '').trim()).filter(Boolean);
  if (!helpers.length) helpers.push(...splitHelpers(data.ajudantes ?? data.AJUDANTES));
  data.ajudante_1 = helpers[0] || '';
  data.ajudante_2 = helpers[1] || '';
  data.ajudantes = helpers.join(' / ');
  data.placa = String(data.placa ?? data.PLACA ?? data.veiculo ?? data.VEICULO ?? '').trim().toUpperCase();
  data.motorista = String(data.motorista ?? data.MOTORISTA ?? '').trim();
  return data;
}

function resourceKey(type, id, name) {
  return normalizeComparable(id || name).replace(/[^A-Z0-9]+/g, ' ').trim();
}

export function resourceRefsFromData(source) {
  const data = normalizeResourceFields(source);
  const definitions = [
    { type:'VEICULO', role:'VEÍCULO', id:data.veiculo_id || data.VEICULO_ID || '', name:data.placa },
    { type:'MOTORISTA', role:'MOTORISTA', id:data.motorista_id || data.MOTORISTA_ID || '', name:data.motorista },
    { type:'AJUDANTE', role:'AJUDANTE 1', id:data.ajudante_1_id || data.ajudante1_id || data.AJUDANTE_1_ID || '', name:data.ajudante_1 },
    { type:'AJUDANTE', role:'AJUDANTE 2', id:data.ajudante_2_id || data.ajudante2_id || data.AJUDANTE_2_ID || '', name:data.ajudante_2 },
  ];
  return definitions.map((item) => ({ ...item, key:resourceKey(item.type, item.id, item.name) })).filter((item) => item.key && item.name);
}

function minutesFromTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

function toLocalIso(dateValue, timeOrDateValue, fallbackTime = '') {
  const date = String(dateValue || '').slice(0, 10);
  const source = String(timeOrDateValue || '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(source)) return source.slice(0, 19);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(source)) return source.replace(' ', 'T').slice(0, 19);
  const time = source || fallbackTime;
  if (date && /^\d{1,2}:\d{2}/.test(time)) {
    const [hour, minute] = time.split(':');
    return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  }
  return '';
}

function dateDiffMinutes(start, end) {
  const a = Date.parse(String(start || '').length === 16 ? `${start}:00` : String(start || ''));
  const b = Date.parse(String(end || '').length === 16 ? `${end}:00` : String(end || ''));
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 60000) : Number.NaN;
}

function addMinutesIso(value, minutes) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp + minutes * 60000).toISOString().slice(0, 19) : '';
}

function addDaysIso(date, amount) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function dayStart(date) { return `${date}T00:00:00`; }
function dayEnd(date) { return `${date}T23:59:59`; }
function currentOperationalDate() {
  try {
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get=(type)=>parts.find((part)=>part.type===type)?.value||'';
    const year=get('year'),month=get('month'),day=get('day');
    if(year&&month&&day)return `${year}-${month}-${day}`;
  } catch {}
  return new Date().toISOString().slice(0,10);
}

function operationalStart(data) {
  const normalized = normalizeResourceFields(data);
  return toLocalIso(normalized.data, normalized.horario_ponto || normalized.hora_programada || normalized.hora_real, '00:00');
}

function plannedOperationalEnd(data) {
  const normalized = normalizeResourceFields(data);
  const internalRoute=normalizeStatus(normalized.rota||normalized.destino||'').replace(/[^A-Z0-9]+/g,' ');
  if(/\b(CAIXA|CAIXAS|ALMOXARIFADO)\b/.test(internalRoute)) return dayEnd(normalized.data);

  const explicit = toLocalIso(normalized.data, normalized.previsao_retorno || normalized.retorno_previsto);
  if (explicit) {
    if (explicit <= operationalStart(normalized) && !String(normalized.previsao_retorno || normalized.retorno_previsto).includes('T')) {
      return toLocalIso(addDaysIso(normalized.data, 1), normalized.previsao_retorno || normalized.retorno_previsto);
    }
    return explicit;
  }
  const start = operationalStart(normalized);
  return start ? addMinutesIso(start, normalized.pernoite ? 24 * 60 : 648) : '';
}

function resourceRefMap(source) {
  const map = new Map();
  resourceRefsFromData(source).forEach((item) => map.set(`${item.type}|${item.role}`, item));
  return map;
}

function normalizeChangeHistory(value) {
  return parseArray(value).map((item) => ({
    tipo: String(item.tipo || '').toUpperCase(),
    recurso: String(item.recurso || item.campo || ''),
    campo: String(item.campo || item.recurso || ''),
    valor_anterior: String(item.valor_anterior ?? item.anterior ?? ''),
    valor_novo: String(item.valor_novo ?? item.novo ?? ''),
    anterior: String(item.anterior ?? item.valor_anterior ?? ''),
    novo: String(item.novo ?? item.valor_novo ?? ''),
    justificativa: String(item.justificativa || ''),
    autor: String(item.autor || item.usuario || ''),
    usuario: String(item.usuario || item.autor || ''),
    data_hora: String(item.data_hora || item.dataHora || ''),
    dataHora: String(item.dataHora || item.data_hora || ''),
  }));
}

export async function prepareRecordData(db, module, source, context = {}) {
  const rawSource = parseData(source);
  let data = normalizeResourceFields(rawSource);
  const currentData = normalizeResourceFields(context.currentData || {});
  const user = context.user || null;
  const warnings = [];
  const changes = [];

  if (module === 'departures') {
    const linkedSchedule = await findLinkedSchedule(db, data);
    const hasCurrent = context.currentData && Object.keys(parseData(context.currentData)).length > 0;
    const baseline = hasCurrent ? currentData : normalizeResourceFields(linkedSchedule?.data || {});
    if (linkedSchedule && !data.schedule_record_id) data.schedule_record_id = linkedSchedule.id;
    if (linkedSchedule && !data.escala_id) data.escala_id = linkedSchedule.data.escala_id_legado || linkedSchedule.data.legado_id || linkedSchedule.id;
    const aliases = {
      placa:['placa','PLACA','veiculo','VEICULO'],
      motorista:['motorista','MOTORISTA'],
      ajudante_1:['ajudante_1','ajudante1','AJUDANTE_1','AJUDANTE1'],
      ajudante_2:['ajudante_2','ajudante2','AJUDANTE_2','AJUDANTE2'],
      veiculo_id:['veiculo_id','VEICULO_ID'],
      motorista_id:['motorista_id','MOTORISTA_ID'],
      ajudante_1_id:['ajudante_1_id','ajudante1_id','AJUDANTE_1_ID'],
      ajudante_2_id:['ajudante_2_id','ajudante2_id','AJUDANTE_2_ID'],
    };
    for (const [field, names] of Object.entries(aliases)) {
      const explicitlySent = names.some((name) => Object.prototype.hasOwnProperty.call(rawSource, name));
      if (!explicitlySent && baseline[field]) data[field] = baseline[field];
    }
    data = normalizeResourceFields(data);
    const before = resourceRefMap(baseline);
    const after = resourceRefMap(data);
    const allKeys = new Set([...before.keys(), ...after.keys()]);
    allKeys.forEach((key) => {
      const previous = before.get(key);
      const next = after.get(key);
      if (normalizeComparable(previous?.id || previous?.name) === normalizeComparable(next?.id || next?.name)) return;
      const type = previous && next ? 'TROCA' : previous ? 'REMOÇÃO' : 'ALOCAÇÃO INICIAL';
      changes.push({
        tipo:type,
        recurso:(next || previous)?.role || '',
        campo:(next || previous)?.role || '',
        valor_anterior:previous?.name || '',
        anterior:previous?.name || '',
        valor_novo:next?.name || '',
        novo:next?.name || '',
      });
    });
    const reason = String(data.justificativa_troca || '').trim();
    if (changes.some((item) => item.tipo !== 'REMOÇÃO') && !reason) {
      throw new Error('Informe a justificativa para a alocação ou troca de recursos.');
    }
    const stamp = new Date().toISOString();
    const actor = String(user?.name || user?.email || 'Sistema');
    const history = normalizeChangeHistory(currentData.trocas_recursos || baseline.trocas_recursos);
    changes.forEach((item) => history.push({
      ...item,
      justificativa:item.tipo === 'REMOÇÃO' ? reason : reason,
      autor:actor,
      usuario:actor,
      data_hora:stamp,
      dataHora:stamp,
    }));
    data.trocas_recursos = history;
    data.hora_saida_real = toLocalIso(data.data, data.hora_real);
    if (linkedSchedule) data.vinculo_escala_confirmado = true;
    else warnings.push('Saída sem vínculo confirmado com uma escala da Versão 1.');
  }

  if (module === 'returns') {
    const linkedSchedule = await findLinkedSchedule(db, data);
    const linkedDeparture = await findLinkedDeparture(db, data, linkedSchedule?.id);
    if (linkedSchedule && !data.schedule_record_id) data.schedule_record_id = linkedSchedule.id;
    if (linkedSchedule && !data.escala_id) data.escala_id = linkedSchedule.data.escala_id_legado || linkedSchedule.data.legado_id || linkedSchedule.id;
    const sourceResources = normalizeResourceFields(linkedDeparture?.data || linkedSchedule?.data || {});
    ['placa','motorista','ajudante_1','ajudante_2','ajudantes','veiculo_id','motorista_id','ajudante_1_id','ajudante_2_id','rota','regiao'].forEach((field) => {
      if (!data[field] && sourceResources[field]) data[field] = sourceResources[field];
    });
    if (!data.saida_real && linkedDeparture?.data) data.saida_real = toLocalIso(linkedDeparture.data.data, linkedDeparture.data.hora_real || linkedDeparture.data.hora_saida_real);
    data.retorno_real = toLocalIso(data.data, data.retorno_real);
    if (data.retorno_real) data.status = 'FINALIZADO';
    if (!linkedSchedule) warnings.push('Retorno sem vínculo confirmado com uma escala da Versão 1.');
  }

  return { data, warnings, changes };
}

export function validateBusinessRules(module, data, user = null) {
  const errors = [];
  const warnings = [];
  const text = (key) => String(data[key] ?? '').trim();

  if (module === 'schedule') {
    if (!text('data')) errors.push('Informe a data da escala.');
    if (!text('rota')) errors.push('Informe a rota.');
    if (!text('motorista')) errors.push('Informe o motorista.');
    if (!text('horario_ponto')) warnings.push('Horário de ponto não informado.');
    if (!text('previsao_retorno')) warnings.push('Previsão de retorno não informada.');
    if (text('horario_ponto') && text('previsao_retorno')) {
      const start = Date.parse(`${text('data')}T${text('horario_ponto')}:00`);
      const endRaw = text('previsao_retorno');
      const end = Date.parse(endRaw.includes('T') ? `${endRaw}:00` : `${text('data')}T${endRaw}:00`);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        let minutes = Math.round((end - start) / 60000);
        if (minutes < 0) minutes += 1440;
        if (minutes > 648 && !data.pernoite) warnings.push('A previsão ultrapassa 10h48; confirme a necessidade de pernoite.');
      }
    }
  }

  if (module === 'departures') {
    if (!text('data')) errors.push('Informe a data da saída.');
    if (!text('rota')) errors.push('Informe a rota.');
    if (!text('hora_programada')) warnings.push('Horário programado não informado.');
    const status = normalizeStatus(text('status') || 'PENDENTE');
    if (status === 'SAIU' && !text('hora_real')) errors.push('Informe o horário real da saída.');
    const planned = minutesFromTime(text('hora_programada'));
    const actual = minutesFromTime(text('hora_real'));
    if (status === 'SAIU' && Number.isFinite(planned) && Number.isFinite(actual)) {
      let delay = actual - planned;
      if (delay < -720) delay += 1440;
      if (delay > 30 && (!text('motivo_atraso') || !text('responsavel_atraso'))) {
        errors.push('Saídas com atraso superior a 30 minutos exigem motivo e responsável.');
      }
    }
    if (['NAO SAIU','NÃO SAIU','TRANSFERIDO','CANCELADO'].includes(status) && !text('motivo_atraso')) {
      errors.push('Informe o motivo da pendência, transferência ou cancelamento.');
    }
  }

  if (module === 'returns') {
    if (!text('data')) errors.push('Informe a data do retorno.');
    if (!text('rota')) errors.push('Informe a rota.');
    if (!text('retorno_real')) errors.push('Informe a data e a hora do retorno.');
    if (Number(data.entregas || 0) < 0 || Number(data.apoios || 0) < 0 || Number(data.devolucoes || 0) < 0) errors.push('Entregas, apoios e devoluções não podem ser negativos.');
    for (const [field,label] of [['entregas','Entregas'],['apoios','Apoios'],['devolucoes','Devoluções']]) {
      const value = data[field];
      if (value !== '' && value !== null && value !== undefined && !Number.isInteger(Number(value))) errors.push(`${label} deve ser um número inteiro.`);
    }
  }

  return { errors, warnings };
}

export async function audit(db, user, action, module, recordId, details = {}) {
  await ensureCoreSchema(db);
  await db.prepare(`
    INSERT INTO ROUTE_AUDIT (USER_ID, USER_NAME, ACTION, MODULE, RECORD_ID, DETAILS)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(user?.id || null, user?.name || user?.email || 'Sistema', action, module || null, recordId || null, JSON.stringify(details)).run();
}

async function tableExists(db, name) {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND UPPER(name)=UPPER(?)").bind(name).first();
  return Boolean(row);
}

export async function importLegacyScheduleIfNeeded(db, userId = null) {
  await ensureCoreSchema(db);
  const existing = await db.prepare("SELECT COUNT(*) AS total FROM ROUTE_RECORDS WHERE MODULE = 'schedule'").first();
  if (Number(existing?.total || 0) > 0) return 0;
  if (!(await tableExists(db, 'DMS_ESCALAS_V3'))) return 0;

  const { results } = await db.prepare('SELECT * FROM DMS_ESCALAS_V3 ORDER BY DATA_OPERACAO, HORA_SAIDA').all();
  let imported = 0;
  for (const item of results || []) {
    const data = normalizeResourceFields({
      data: item.DATA_OPERACAO || '', sequencia: '', ocs: '', peso_kg: '', rota: item.ROTA || '',
      regiao: item.REGIAO || '', placa: item.VEICULO || '', motorista: item.MOTORISTA_NOME || '',
      ajudante_1:item.AJUDANTE1_NOME || '', ajudante_2:item.AJUDANTE2_NOME || '', equipe: '',
      horario_ponto: item.HORA_SAIDA || '', previsao_retorno: item.RETORNO_PREVISTO || '',
      status: item.STATUS || 'PROGRAMADO', observacoes: item.OBSERVACAO || '', pernoite: Number(item.PERNOITE || 0) === 1,
      legado_id: item.ID,
    });
    await db.prepare(`
      INSERT INTO ROUTE_RECORDS (MODULE, TITLE, STATUS, DATE_KEY, DATA_JSON, CREATED_BY, UPDATED_BY)
      VALUES ('schedule', ?, ?, ?, ?, ?, ?)
    `).bind(inferTitle(data, 'schedule'), inferStatus(data), inferDate(data), JSON.stringify(data), userId, userId).run();
    imported += 1;
  }
  return imported;
}

export function applyDerivedFields(module, source) {
  const data = normalizeResourceFields(source);
  if (module === 'departures') {
    const planned = minutesFromTime(data.hora_programada);
    const actual = minutesFromTime(data.hora_real);
    if (Number.isFinite(planned) && Number.isFinite(actual)) {
      let delay = actual - planned;
      if (delay < -720) delay += 1440;
      data.atraso_min = Math.max(0, delay);
      data.pontual = delay <= 15;
      if (!data.status || data.status === 'PENDENTE') data.status = data.hora_real ? 'SAIU' : 'PENDENTE';
    }
    data.hora_saida_real = toLocalIso(data.data, data.hora_real);
  }
  if (module === 'returns' && data.saida_real && data.retorno_real) {
    const minutes = dateDiffMinutes(data.saida_real, data.retorno_real);
    if (Number.isFinite(minutes)) {
      data.jornada_min = minutes;
      data.jornada_horas = Math.round((minutes / 60) * 100) / 100;
      data.alerta_jornada = minutes > 648;
    }
  }
  if (module === 'route_management_data') {
    const hours = Number(data.tempo_real_h || 0);
    const weight = Number(data.peso_t || 0);
    const deliveries = Number(data.entregas || 0);
    data.horas_por_tonelada = weight > 0 ? Math.round((hours / weight) * 100) / 100 : 0;
    data.toneladas_por_hora = hours > 0 ? Math.round((weight / hours) * 100) / 100 : 0;
    data.entregas_por_hora = hours > 0 ? Math.round((deliveries / hours) * 100) / 100 : 0;
    data.desvio_h = Math.round((hours - Number(data.tempo_planejado_h || 0)) * 100) / 100;
  }
  return data;
}

function serializeRow(row) {
  if (!row) return null;
  return { id:Number(row.ID), module:row.MODULE, date:row.DATE_KEY, status:row.STATUS, data:normalizeResourceFields(parseData(row.DATA_JSON)) };
}

async function findModuleRows(db, module, startDate = '', endDate = '') {
  const clauses = ['MODULE = ?'];
  const binds = [module];
  if (startDate) { clauses.push("DATE_KEY >= ?"); binds.push(startDate); }
  if (endDate) { clauses.push("DATE_KEY <= ?"); binds.push(endDate); }
  const { results } = await db.prepare(`SELECT ID,MODULE,STATUS,DATE_KEY,DATA_JSON,CREATED_AT,UPDATED_AT FROM ROUTE_RECORDS WHERE ${clauses.join(' AND ')} ORDER BY ID`).bind(...binds).all();
  const genericRows = (results || []).map(serializeRow);

  if (module === 'schedule') {
    try {
      const legacyClauses = [];
      const legacyBinds = [];
      // Mantém DATA sem função no WHERE para permitir o uso de IDX_ROUTE_ESCALA_DATA.
      // O limite superior exclusivo inclui tanto YYYY-MM-DD quanto timestamps ISO.
      if (startDate) { legacyClauses.push("DATA >= ?"); legacyBinds.push(startDate); }
      if (endDate) { legacyClauses.push("DATA < ?"); legacyBinds.push(addDaysIso(endDate,1)); }
      const where = legacyClauses.length ? `WHERE ${legacyClauses.join(' AND ')}` : '';
      const legacyResult = await db.prepare(`SELECT * FROM ESCALAS_DIA ${where} ORDER BY DATA,SEQUENCIA_CARREGAMENTO`).bind(...legacyBinds).all();
      const legacyRows = (legacyResult.results || []).map((row) => {
        const date = String(row.DATA || '').slice(0,10);
        const data = normalizeResourceFields({
          data:date, sequencia:row.SEQUENCIA_CARREGAMENTO || '', ocs:row.CARGA || '', qtd_entregas:Number(row.QTD_ENTREGAS || 0),
          peso_t:Number(row.PESO_CARGA_TON || 0), peso_kg:Number(row.PESO_CARGA_TON || 0) * 1000,
          horario_ponto:String(row.HORA_SAIDA_PROGRAMADA || '').slice(0,16), rota_id:row.ROTA_ID || '', rota:row.ROTA || row.DESTINO || '', destino:row.DESTINO || '',
          regiao:row.REGIAO || '', duracao_dias:Number(row.DURACAO_DIAS || 1), veiculo_id:row.VEICULO_ID || '', placa:row.PLACA || '',
          motorista_id:row.MOTORISTA_ID || '', motorista:row.MOTORISTA || '', ajudante_1_id:row.AJUDANTE_1_ID || '', ajudante_1:row.AJUDANTE_1 || '',
          ajudante_2_id:row.AJUDANTE_2_ID || '', ajudante_2:row.AJUDANTE_2 || '', ajudantes:[row.AJUDANTE_1,row.AJUDANTE_2].filter(Boolean).join(' / '),
          tipo_equipe:row.TIPO_EQUIPE || '', previsao_termino:row.PREVISAO_TERMINO || '', previsao_retorno:row.PREVISAO_RETORNO || '',
          limite_jornada:row.LIMITE_JORNADA || '', status:row.STATUS || 'PROGRAMADO', observacoes:row.OBSERVACOES || '',
        });
        return { id:String(row.ID), module:'schedule', date, status:String(row.STATUS || 'PROGRAMADO'), data };
      });
      return [...genericRows, ...legacyRows];
    } catch {
      return genericRows;
    }
  }

  // A Fase 1 grava estes domínios em tabelas próprias. A Central de Recursos e
  // as validações antigas do core precisam enxergar os registros dedicados sem
  // obrigar que eles voltem a passar pelo handler genérico.
  const dedicatedTables = {
    departures:'ROUTE_DEPARTURES',
    monitoring:'ROUTE_MONITORING',
    returns:'ROUTE_RETURNS',
  };
  const table = dedicatedTables[module];
  if (!table) return genericRows;
  try {
    const dedicatedClauses = [];
    const dedicatedBinds = [];
    if (startDate) { dedicatedClauses.push("DATE_KEY >= ?"); dedicatedBinds.push(startDate); }
    if (endDate) { dedicatedClauses.push("DATE_KEY <= ?"); dedicatedBinds.push(endDate); }
    const where = dedicatedClauses.length ? `WHERE ${dedicatedClauses.join(' AND ')}` : '';
    const dedicatedResult = await db.prepare(`SELECT * FROM ${table} ${where} ORDER BY ID`).bind(...dedicatedBinds).all();
    const dedicatedRows = (dedicatedResult.results || []).map((row) => {
      const stored=parseData(row.DATA_JSON);
      return { id:Number(row.ID), module, date:row.DATE_KEY, status:row.STATUS,
      // Os campos estruturados são a fonte de verdade. Registros históricos nem
      // sempre repetem SCHEDULE_ID/RETURN_AT no JSON; descartá-los fazia a Central
      // ignorar um Retorno confirmado e manter recursos como ocupados.
      data:normalizeResourceFields({
        ...stored,
        schedule_record_id:row.SCHEDULE_ID || stored.schedule_record_id || '',
        data:row.DATE_KEY || stored.data || '',
        status:row.STATUS || stored.status || '',
        placa:row.PLATE || stored.placa || '',
        motorista:row.DRIVER_NAME || stored.motorista || '',
        rota:row.ROUTE || stored.rota || '',
        retorno_real:module==='returns' ? (row.RETURN_AT || stored.retorno_real || '') : stored.retorno_real,
        hora_real:module==='departures' ? (row.ACTUAL_AT || stored.hora_real || '') : stored.hora_real,
        status_monitoramento:module==='monitoring' ? (row.STATUS || stored.status_monitoramento || '') : stored.status_monitoramento,
      }),
    };});
    const dedicatedScheduleIds = new Set(dedicatedRows.map((row) => linkedIds(row.data)[0]).filter(Boolean));
    const preservedGeneric = genericRows.filter((row) => {
      const scheduleId = linkedIds(row.data)[0];
      return !scheduleId || !dedicatedScheduleIds.has(scheduleId);
    });
    return [...preservedGeneric, ...dedicatedRows];
  } catch {
    return genericRows;
  }
}

const OPEN_MONITORING_STATUSES = ['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO'];

async function findOpenMonitoringRows(db, endDate = '') {
  const placeholders=OPEN_MONITORING_STATUSES.map(()=>'?').join(',');
  const genericBinds=['monitoring',...OPEN_MONITORING_STATUSES,...OPEN_MONITORING_STATUSES];
  let genericDate='';
  if(endDate){genericDate=' AND DATE_KEY<=?';genericBinds.push(endDate);}
  let genericRows=[];
  try{
    const {results=[]}=await db.prepare(`SELECT ID,MODULE,STATUS,DATE_KEY,DATA_JSON,CREATED_AT,UPDATED_AT FROM ROUTE_RECORDS
      WHERE MODULE=? AND (UPPER(COALESCE(STATUS,'')) IN (${placeholders}) OR UPPER(COALESCE(json_extract(DATA_JSON,'$.status_monitoramento'),json_extract(DATA_JSON,'$.status'),'')) IN (${placeholders}))${genericDate}
      ORDER BY ID DESC LIMIT 10000`).bind(...genericBinds).all();
    genericRows=(results||[]).map(serializeRow);
  }catch{}

  let dedicatedRows=[];
  try{
    const binds=[...OPEN_MONITORING_STATUSES];
    const dateClause=endDate?' AND DATE_KEY<=?':'';if(endDate)binds.push(endDate);
    const {results=[]}=await db.prepare(`SELECT * FROM ROUTE_MONITORING WHERE UPPER(COALESCE(STATUS,'')) IN (${placeholders})${dateClause} ORDER BY ID DESC LIMIT 10000`).bind(...binds).all();
    dedicatedRows=(results||[]).map((row)=>{
      const stored=parseData(row.DATA_JSON);
      return {id:Number(row.ID),module:'monitoring',date:row.DATE_KEY,status:row.STATUS,data:normalizeResourceFields({
        ...stored,schedule_record_id:row.SCHEDULE_ID||stored.schedule_record_id||'',data:row.DATE_KEY||stored.data||'',status:row.STATUS||stored.status||'',
        placa:row.PLATE||stored.placa||'',motorista:row.DRIVER_NAME||stored.motorista||'',rota:row.ROUTE||stored.rota||'',
        status_monitoramento:row.STATUS||stored.status_monitoramento||'',
      })};
    });
  }catch{}
  const dedicatedKeys=new Set(dedicatedRows.map((row)=>linkedIds(row.data)[0]).filter(Boolean));
  return [...genericRows.filter((row)=>{const key=linkedIds(row.data)[0];return !key||!dedicatedKeys.has(key);}),...dedicatedRows];
}

function linkedIds(data) {
  return [data.schedule_record_id, data.escala_id, data.escala_id_legado, data.legado_id].filter((value) => value !== '' && value !== null && value !== undefined).map(String);
}

export async function findLinkedSchedule(db, source) {
  const data = parseData(source);
  const direct = Number(data.schedule_record_id);
  if (Number.isInteger(direct) && direct > 0) {
    const row = await db.prepare("SELECT ID,MODULE,STATUS,DATE_KEY,DATA_JSON FROM ROUTE_RECORDS WHERE ID=? AND MODULE='schedule'").bind(direct).first();
    if (row) return serializeRow(row);
  }
  const date = inferDate(data);
  const rows = await findModuleRows(db, 'schedule', date ? addDaysIso(date, -2) : '', date ? addDaysIso(date, 2) : '');
  const ids = linkedIds(data);
  const exact = rows.find((row) => linkedIds({ ...row.data, schedule_record_id:row.id }).some((id) => ids.includes(id)));
  if (exact) return exact;
  return rows.find((row) => (!date || row.date === date) && normalizeComparable(row.data.placa) === normalizeComparable(data.placa) && normalizeComparable(row.data.rota) === normalizeComparable(data.rota)) || null;
}

export async function findLinkedDeparture(db, source, scheduleId = null) {
  const data = parseData(source);
  const targetIds = linkedIds({ ...data, schedule_record_id:scheduleId || data.schedule_record_id });
  const date = inferDate(data);
  const rows = await findModuleRows(db, 'departures', date ? addDaysIso(date, -7) : '', date ? addDaysIso(date, 7) : '');
  return rows.find((row) => linkedIds(row.data).some((id) => targetIds.includes(id))) || rows.find((row) => (!date || row.date === date) && normalizeComparable(row.data.placa) === normalizeComparable(data.placa) && normalizeComparable(row.data.rota) === normalizeComparable(data.rota)) || null;
}

function returnReferenceMap(returns) {
  const map = new Map();
  returns.forEach((row) => {
    const value = toLocalIso(row.data.data || row.date, row.data.retorno_real || row.data.DATA_HORA_RETORNO);
    if (!value) return;
    linkedIds(row.data).forEach((id) => {
      const current = map.get(id);
      if (!current || value > current) map.set(id, value);
    });
  });
  return map;
}

async function latestManualReleaseMap(db, beforeDateTime) {
  await ensureCoreSchema(db);
  const { results } = await db.prepare(`
    SELECT * FROM ROUTE_RESOURCE_EVENTS
    WHERE SOURCE='MANUAL' AND STATUS IN ('DISPONÍVEL','DISPONIVEL') AND EFFECTIVE_AT <= ?
    ORDER BY EFFECTIVE_AT DESC, ID DESC
  `).bind(beforeDateTime || new Date().toISOString()).all();
  const map = new Map();
  for (const row of results || []) {
    const keys = [
      `${row.RESOURCE_TYPE}|${row.RESOURCE_KEY}`,
      `${row.RESOURCE_TYPE}|${resourceKey(row.RESOURCE_TYPE, '', row.RESOURCE_NAME || '')}`,
      `${row.RESOURCE_TYPE}|${resourceKey(row.RESOURCE_TYPE, row.RESOURCE_ID || '', '')}`,
    ].filter((key) => !key.endsWith('|'));
    keys.forEach((key) => { if (!map.has(key)) map.set(key, row); });
  }
  return map;
}

function resourceEndForSchedule(row, ref, returnsBySchedule, manualMap) {
  const ids = linkedIds({ ...row.data, schedule_record_id:row.id });
  const realReturn = ids.map((id) => returnsBySchedule.get(id)).filter(Boolean).sort().at(-1) || '';
  const planned = plannedOperationalEnd(row.data);
  const start = operationalStart(row.data);
  const manual = manualMap.get(`${ref.type}|${ref.key}`);
  const manualTime = manual && (!manual.SCHEDULE_RECORD_ID || Number(manual.SCHEDULE_RECORD_ID) === Number(row.id)) && manual.EFFECTIVE_AT >= start ? manual.EFFECTIVE_AT : '';
  return realReturn || manualTime || planned;
}

function intervalsOverlap(startA, endA, startB, endB) {
  if (!startA || !startB) return false;
  const a0 = Date.parse(startA); const a1 = Date.parse(endA || addMinutesIso(startA, 648));
  const b0 = Date.parse(startB); const b1 = Date.parse(endB || addMinutesIso(startB, 648));
  if (![a0,a1,b0,b1].every(Number.isFinite)) return false;
  return a0 < b1 && b0 < a1;
}

export async function validateDatabaseRules(db, module, source, excludeId = null) {
  const data = normalizeResourceFields(source);
  const errors = [];
  const warnings = [];

  if (module === 'departures') {
    const linked = await findLinkedSchedule(db, data);
    const rows = await findModuleRows(db, 'departures', data.data ? addDaysIso(data.data, -2) : '', data.data ? addDaysIso(data.data, 2) : '');
    const status = normalizeStatus(data.status || 'PENDENTE');
    if (status === 'SAIU' && !linked) {
      errors.push('A saída real deve estar vinculada a uma escala existente. Abra a saída a partir da Escala do dia.');
    }
    if (linked) {
      const duplicate = rows.find((row) => Number(row.id) !== Number(excludeId) && linkedIds(row.data).includes(String(linked.id)));
      if (duplicate) errors.push('Esta escala já possui um registro de saída. Edite o registro existente.');
    }
    return { errors, warnings };
  }

  if (module === 'returns') {
    const linked = await findLinkedSchedule(db, data);
    const departure = await findLinkedDeparture(db, data, linked?.id);
    const rows = await findModuleRows(db, 'returns', data.data ? addDaysIso(data.data, -30) : '', data.data ? addDaysIso(data.data, 30) : '');
    if (linked) {
      const duplicate = rows.find((row) => Number(row.id) !== Number(excludeId) && linkedIds(row.data).includes(String(linked.id)));
      if (duplicate) errors.push('Esta escala já possui retorno confirmado. Edite o retorno existente.');
    }
    if (!departure || !['SAIU','EM ROTA','LIBERADO'].includes(normalizeStatus(departure.data.status)) || !departure.data.hora_real) errors.push('O retorno só pode ser registrado para uma escala com saída real confirmada.');
    const departureAt = departure ? toLocalIso(departure.data.data, departure.data.hora_real || departure.data.hora_saida_real) : '';
    const returnAt = toLocalIso(data.data, data.retorno_real);
    if (departureAt && returnAt && Date.parse(returnAt) < Date.parse(departureAt)) errors.push('O retorno não pode ser anterior à saída real.');
    return { errors, warnings };
  }

  if (module !== 'schedule') return { errors, warnings };

  const date = String(data.data || '').slice(0, 10);
  const refs = resourceRefsFromData(data);
  if (!date || !refs.length) return { errors, warnings };
  const newStart = operationalStart(data);
  const newEnd = plannedOperationalEnd(data);
  const rows = (await findModuleRows(db, 'schedule', addDaysIso(date, -45), addDaysIso(date, 7))).filter((row) => Number(row.id) !== Number(excludeId) && normalizeStatus(row.data.status) !== 'CANCELADO');
  const returns = await findModuleRows(db, 'returns', addDaysIso(date, -60), addDaysIso(date, 15));
  const returnsBySchedule = returnReferenceMap(returns);
  const manualMap = await latestManualReleaseMap(db, newStart || dayEnd(date));

  for (const ref of refs) {
    const conflict = rows.find((row) => {
      const rowRef = resourceRefsFromData(row.data).find((item) => item.type === ref.type && item.key === ref.key);
      if (!rowRef) return false;
      const rowStart = operationalStart(row.data);
      const rowEnd = resourceEndForSchedule(row, rowRef, returnsBySchedule, manualMap);
      return intervalsOverlap(rowStart, rowEnd, newStart, newEnd);
    });
    if (conflict) {
      errors.push(`${ref.role} já está alocado em outra escala que ainda ocupa esta janela operacional.`);
    }
  }

  const sequence = String(data.sequencia || '').trim();
  if (sequence && rows.some((row) => row.date === date && String(row.data.sequencia || '').trim() === sequence)) warnings.push('Sequência de carregamento repetida no dia.');

  const employeeRefs = refs.filter((ref) => ref.type !== 'VEICULO');
  for (const ref of employeeRefs) {
    const previousCandidates = rows.map((row) => {
      const rowRef = resourceRefsFromData(row.data).find((item) => item.type === ref.type && item.key === ref.key);
      if (!rowRef) return null;
      const end = resourceEndForSchedule(row, rowRef, returnsBySchedule, manualMap);
      return end && (!newStart || end <= newStart) ? { row, end } : null;
    }).filter(Boolean).sort((a,b) => b.end.localeCompare(a.end));
    const previous = previousCandidates[0];
    if (previous && newStart) {
      const rest = dateDiffMinutes(previous.end, newStart);
      if (Number.isFinite(rest) && rest < 660) warnings.push(`Interjornada abaixo de 11 horas para ${ref.role.toLowerCase()} (${Math.max(0, rest)} minutos), mas a escala foi permitida.`);
    }
  }


  if (!data.previsao_retorno) warnings.push('Sem previsão de retorno não é possível validar integralmente a interjornada.');
  return { errors, warnings };
}

function eventKey({ source, sourceModule, sourceRecordId, scheduleRecordId, status, effectiveAt, ref }) {
  return [source,sourceModule || '',sourceRecordId || '',scheduleRecordId || '',status,effectiveAt,ref.type,ref.key].map((item) => String(item || '')).join('|');
}

async function insertResourceEvent(db, payload) {
  const type = normalizeResourceType(payload.resourceType);
  const name = String(payload.resourceName || '').trim();
  const id = String(payload.resourceId || '').trim();
  const key = resourceKey(type, id, name);
  if (!key) throw new Error('Informe o recurso que será atualizado.');
  const effectiveAt = String(payload.effectiveAt || new Date().toISOString()).replace(' ', 'T').slice(0, 19);
  const status = canonicalResourceStatus(payload.status || 'DISPONÍVEL');
  const ref = { type, key };
  const keyValue = payload.eventKey || eventKey({ ...payload, status, effectiveAt, ref });
  await db.prepare(`
    INSERT OR IGNORE INTO ROUTE_RESOURCE_EVENTS
      (EVENT_KEY,RESOURCE_TYPE,RESOURCE_KEY,RESOURCE_ID,RESOURCE_NAME,STATUS,EFFECTIVE_AT,DATE_KEY,SOURCE,SOURCE_MODULE,SOURCE_RECORD_ID,SCHEDULE_RECORD_ID,DETAILS_JSON,CREATED_BY,CREATED_BY_NAME)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    keyValue,type,key,id || null,name || id,status,effectiveAt,effectiveAt.slice(0,10),
    String(payload.source || 'SISTEMA').toUpperCase(),payload.sourceModule || null,payload.sourceRecordId || null,payload.scheduleRecordId || null,
    JSON.stringify(payload.details || {}),payload.user?.id || null,payload.user?.name || payload.user?.email || 'Sistema'
  ).run();
  return { type, key, id, name:name || id, status, effectiveAt };
}

export async function recordResourceEvents(db, payload) {
  await ensureCoreSchema(db);
  const refs = payload.refs || resourceRefsFromData(payload.data);
  const recorded = [];
  for (const ref of refs) {
    recorded.push(await insertResourceEvent(db, {
      resourceType:ref.type, resourceId:ref.id, resourceName:ref.name, status:payload.status,
      effectiveAt:payload.effectiveAt, source:payload.source, sourceModule:payload.sourceModule,
      sourceRecordId:payload.sourceRecordId, scheduleRecordId:payload.scheduleRecordId,
      details:{ ...(payload.details || {}), role:ref.role }, user:payload.user,
    }));
  }
  return recorded;
}

export async function createManualResourceRelease(db, payload, user) {
  await ensureCoreSchema(db);
  const type = normalizeResourceType(payload.resource_type || payload.resourceType || payload.tipo);
  const resourceId = String(payload.resource_id || payload.resourceId || payload.id || '').trim();
  const resourceName = String(payload.resource_name || payload.resourceName || payload.nome || '').trim();
  const effectiveAt = toLocalIso(payload.data || String(payload.effective_at || payload.effectiveAt).slice(0,10), payload.effective_at || payload.effectiveAt || payload.hora) || new Date().toISOString().slice(0,19);
  const reason = String(payload.observacoes || payload.justificativa || '').trim();
  if (!resourceId && !resourceName) throw new Error('Informe o recurso que será liberado.');
  if (!reason) throw new Error('Informe a justificativa da liberação antecipada.');
  if (!(await resourceExistsInCatalog(db, type, resourceId, resourceName))) throw new Error('O recurso informado não foi encontrado no cadastro oficial.');
  const scheduleRecordId=String(payload.schedule_record_id || payload.scheduleRecordId || '').trim();
  const event = await insertResourceEvent(db, {
    resourceType:type, resourceId, resourceName, status:'DISPONÍVEL', effectiveAt,
    source:'MANUAL', sourceModule:'resources', sourceRecordId:null,
    scheduleRecordId:scheduleRecordId||null,
    details:{ observacoes:reason, origem:'manual' }, user,
    eventKey:`MANUAL|${crypto.randomUUID()}`,
  });
  const availability = await setManualAvailability(db, { data_disponibilidade:String(effectiveAt).slice(0,10), tipo_recurso:type, recurso_id:resourceId, nome:resourceName, escala_origem_id:scheduleRecordId, observacoes:reason }, user);
  await audit(db, user, 'LIBERACAO_MANUAL', 'resources', null, { ...event, availabilityId:availability.ID, justificativa:reason, scheduleRecordId:scheduleRecordId||null });
  return { ...event, availability };
}

function refsRemoved(previousData, nextData) {
  const nextKeys = new Set(resourceRefsFromData(nextData).map((ref) => `${ref.type}|${ref.key}`));
  return resourceRefsFromData(previousData).filter((ref) => !nextKeys.has(`${ref.type}|${ref.key}`));
}

async function updateLinkedSchedule(db, data, status, user) {
  const linked = await findLinkedSchedule(db, data);
  if (!linked) return null;
  const scheduleData = normalizeResourceFields({ ...linked.data });
  const actual = normalizeResourceFields(data);
  ['placa','motorista','ajudante_1','ajudante_2','ajudantes','veiculo_id','motorista_id','ajudante_1_id','ajudante_2_id'].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(actual, field)) scheduleData[field] = actual[field];
  });
  if (status) scheduleData.status = status;
  if (actual.retorno_real) scheduleData.retorno_real_confirmado = actual.retorno_real;
  scheduleData.atualizado_por_fluxo = user?.name || user?.email || 'Sistema';
  await db.prepare(`UPDATE ROUTE_RECORDS SET TITLE=?,STATUS=?,DATA_JSON=?,UPDATED_BY=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=? AND MODULE='schedule'`)
    .bind(inferTitle(scheduleData,'schedule'),inferStatus(scheduleData),JSON.stringify(scheduleData),user?.id || null,linked.id).run();
  return { ...linked, data:scheduleData };
}

async function finalizeLinkedMonitoring(db, data, user) {
  const ids = linkedIds(data);
  if (!ids.length) return 0;
  const rows = await findModuleRows(db, 'monitoring', data.data ? addDaysIso(data.data,-30) : '', data.data ? addDaysIso(data.data,30) : '');
  let changed = 0;
  for (const row of rows) {
    if (!linkedIds(row.data).some((id) => ids.includes(id))) continue;
    const next = { ...row.data, status:'FINALIZADO', entregas_realizadas:Number(data.entregas || row.data.entregas_realizadas || 0), atualizado_por_fluxo:user?.name || user?.email || 'Sistema' };
    await db.prepare(`UPDATE ROUTE_RECORDS SET STATUS='FINALIZADO',DATA_JSON=?,UPDATED_BY=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=? AND MODULE='monitoring'`)
      .bind(JSON.stringify(next),user?.id || null,row.id).run();
    changed += 1;
  }
  return changed;
}

export async function applyModuleSideEffects(db, module, context) {
  await ensureCoreSchema(db);
  const data = normalizeResourceFields(context.data);
  const previousData = normalizeResourceFields(context.previousData || {});
  const user = context.user || null;
  const recordId = Number(context.recordId);
  const results = { events:[], scheduleUpdated:false, monitoringUpdated:0 };

  if (module === 'departures') {
    const status = normalizeStatus(data.status);
    const schedule = await findLinkedSchedule(db, data);
    const scheduleId = schedule?.id || Number(data.schedule_record_id) || null;
    if (normalizeStatus(previousData.status) === 'SAIU') {
      const removed = status === 'SAIU' ? refsRemoved(previousData, data) : resourceRefsFromData(previousData);
      if (removed.length) results.events.push(...await recordResourceEvents(db, {
        refs:removed,status:'DISPONÍVEL',effectiveAt:new Date().toISOString().slice(0,19),source:status === 'SAIU' ? 'TROCA_SAIDA' : 'REVERSAO_SAIDA',sourceModule:'departures',sourceRecordId:recordId,scheduleRecordId:scheduleId,
        details:{ justificativa:data.justificativa_troca || data.motivo_atraso || '', motivo:status === 'SAIU' ? 'Recurso removido de saída já confirmada' : 'Saída real revertida' },user,
      }));
    }
    if (status === 'SAIU') {
      const departureAt = toLocalIso(data.data, data.hora_real || data.hora_saida_real);
      results.events.push(...await recordResourceEvents(db, {
        data,status:'EM ROTA',effectiveAt:departureAt,source:'SAIDA',sourceModule:'departures',sourceRecordId:recordId,scheduleRecordId:scheduleId,
        details:{ rota:data.rota || '', justificativa_troca:data.justificativa_troca || '' },user,
      }));
      results.scheduleUpdated = Boolean(await updateLinkedSchedule(db, data, 'EM ROTA', user));
    } else if (normalizeStatus(previousData.status) === 'SAIU') {
      results.scheduleUpdated = Boolean(await updateLinkedSchedule(db, data, status === 'CANCELADO' ? 'CANCELADO' : 'PROGRAMADO', user));
    }
    if (context.changes?.length) await audit(db,user,'TROCA_RECURSOS','departures',recordId,{ changes:context.changes, justificativa:data.justificativa_troca || '' });
  }

  if (module === 'returns') {
    const schedule = await findLinkedSchedule(db, data);
    const scheduleId = schedule?.id || Number(data.schedule_record_id) || null;
    const returnAt = toLocalIso(data.data, data.retorno_real);
    results.events.push(...await recordResourceEvents(db, {
      data,status:'DISPONÍVEL',effectiveAt:returnAt,source:'RETORNO',sourceModule:'returns',sourceRecordId:recordId,scheduleRecordId:scheduleId,
      details:{ rota:data.rota || '', origem:data.origem || 'MANUAL', entregas:Number(data.entregas || 0), apoios:Number(data.apoios || 0), devolucoes:Number(data.devolucoes || 0) },user,
    }));
    results.scheduleUpdated = Boolean(await updateLinkedSchedule(db, data, 'FINALIZADO', user));
    results.monitoringUpdated = await finalizeLinkedMonitoring(db, data, user);
  }

  return results;
}

async function readCatalogRows(db, table, orderBy) {
  if (!(await tableExists(db, table))) return [];
  const { results } = await db.prepare(`SELECT * FROM "${table}" ORDER BY ${orderBy}`).all();
  return results || [];
}

function activeFlag(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1','TRUE','SIM','S','ATIVO','YES'].includes(normalizeStatus(value));
}

async function resourceExistsInCatalog(db, type, id, name) {
  const table = type === 'VEICULO' ? 'BASE_VEICULOS' : 'BASE_COLABORADORES';
  if (!(await tableExists(db, table))) return true;
  const rows = await readCatalogRows(db, table, type === 'VEICULO' ? 'PLACA COLLATE NOCASE' : 'NOME COLLATE NOCASE');
  const idKey = normalizeComparable(id);
  const nameKey = normalizeComparable(name);
  return rows.some((row) => {
    const rowId = normalizeComparable(row.ID || row.MATRICULA || row.PLACA || '');
    const rowName = normalizeComparable(type === 'VEICULO' ? row.PLACA : row.NOME);
    return (idKey && rowId === idKey) || (nameKey && rowName === nameKey);
  });
}

function employeeCatalogFunction(row={}) {
  const functionName=normalizeStatus(row.FUNCAO || row['FUNÇÃO'] || row.CARGO || row.CARGO_FUNCAO || '');
  const helperMetadata=activeFlag(row.AJUDANTE_ROTA,false)||Boolean(String(row.CIDADE_ROTA||row.ROTAS_ATENDIDAS||'').trim());
  // A Central e a Escala precisam classificar a mesma pessoa da mesma forma.
  // "AJUDANTE DE MOTORISTA" deve ser AJUDANTE, apesar de conter MOTORISTA.
  if(functionName.includes('AJUDANTE'))return 'AJUDANTE';
  if(/MOTORISTA|CARRETEIRO|CONDUTOR/.test(functionName))return 'MOTORISTA';
  if(helperMetadata&&(!functionName||functionName.includes('AUXILIAR')))return 'AJUDANTE';
  if(functionName.includes('AUXILIAR')&&(functionName.includes('ENTREGA')||functionName.includes('CARGA')||functionName.includes('ROTA')))return 'AJUDANTE';
  return '';
}
function employeeCatalogRef(row) {
  const functionName = normalizeStatus(row.FUNCAO || row['FUNÇÃO'] || row.CARGO || row.CARGO_FUNCAO || '');
  const type = employeeCatalogFunction(row);
  if (!type) return null;
  const id = String(row.ID || row.MATRICULA || '').trim();
  const name = String(row.NOME || '').trim();
  const active = activeFlag(row.ATIVO, true);
  const routeHelper=type==='AJUDANTE'&&(activeFlag(row.AJUDANTE_ROTA,false)||/\b(AJUDANTE|AUXILIAR).*\bROTA\b/.test(functionName)||Boolean(String(row.CIDADE_ROTA||row.ROTAS_ATENDIDAS||'').trim()));
  const restrictedDriver=type==='MOTORISTA'&&activeFlag(row.RESTRICAO_MOTORISTA,false);
  const restrictedHelper=type==='AJUDANTE'&&activeFlag(row.RESTRICAO_AJUDANTE,false);
  const thirdPartyDriver=type==='MOTORISTA'&&/TERCEIR/.test(normalizeStatus(row.VINCULO||''));
  return { type, id, name, key:resourceKey(type,id,name), baseStatus:normalizeStatus(row.STATUS || (active ? 'DISPONÍVEL' : 'INATIVO')), active, routeHelper, restrictedDriver, restrictedHelper, thirdPartyDriver, raw:row };
}

function vehicleCatalogRef(row) {
  const id = String(row.ID || row.PLACA || '').trim();
  const name = String(row.PLACA || '').trim().toUpperCase();
  const active = activeFlag(row.ATIVO, true);
  return { type:'VEICULO', id, name, key:resourceKey('VEICULO',id,name), baseStatus:normalizeStatus(row.STATUS || (active ? 'DISPONÍVEL' : 'INATIVO')), active, raw:row };
}

function assignmentStatus(schedule, departure, monitoring, returnRow, manualEvent, targetDate, ref) {
  const departed=Boolean(departure&&normalizeStatus(departure.data.status)==='SAIU');
  const start = departed
    ? toLocalIso(departure.data.data, departure.data.hora_real || departure.data.hora_saida_real)
    : operationalStart(schedule.data);
  const plannedEnd = plannedOperationalEnd(schedule.data);
  const realEnd = returnRow ? toLocalIso(returnRow.data.data, returnRow.data.retorno_real) : '';
  const manualEnd = manualEvent && (!manualEvent.SCHEDULE_RECORD_ID || Number(manualEvent.SCHEDULE_RECORD_ID) === Number(schedule.id)) && manualEvent.EFFECTIVE_AT >= start ? manualEvent.EFFECTIVE_AT : '';
  const targetStart = dayStart(targetDate); const targetEnd = dayEnd(targetDate);
  if (!start || start > targetEnd) return null;
  // Uma viagem com saída real e sem retorno continua ocupando os recursos mesmo
  // depois de ultrapassar a PREVISÃO_RETORNO. A Central de Recursos é operacional,
  // não uma fotografia limitada à data planejada da Escala.
  if (realEnd && realEnd < targetStart) return null;
  if (manualEnd && manualEnd < targetStart) return null;
  if (!departed && plannedEnd && plannedEnd < targetStart) return null;
  if (manualEnd && manualEnd <= targetEnd) return { status:'DISPONÍVEL', origin:'MANUAL', detail:`Liberação antecipada por ${manualEvent.CREATED_BY_NAME || 'usuário'}`, effectiveAt:manualEnd, updatedBy:manualEvent.CREATED_BY_NAME || 'usuário' };
  if (realEnd && realEnd <= targetEnd) return { status:'DISPONÍVEL', origin:'RETORNO', detail:'Retorno real confirmado', effectiveAt:realEnd };
  if (departed) {
    const monitoringStatus = normalizeStatus(monitoring?.data?.status || monitoring?.data?.status_monitoramento || monitoring?.status || '');
    const monitoringFinished = monitoringStatus === 'FINALIZADO';
    if (monitoringFinished && !realEnd) {
      return { status:'DISPONÍVEL', origin:'MONITORAMENTO', detail:'Monitoramento finalizado', effectiveAt:monitoring?.updatedAt || start };
    }
    // PERNOITE é um status operacional explícito. Não inferimos pernoite apenas
    // porque a viagem atravessou a meia-noite ou porque a escala foi planejada
    // como pernoite; enquanto o Monitoramento estiver EM ROTA, o recurso segue
    // classificado como EM ROTA. Isso mantém a Central alinhada ao Resumo.
    const pernoite = monitoring ? monitoringStatus === 'PERNOITE' : normalizeStatus(schedule.data.status) === 'PERNOITE';
    const origin = monitoring ? 'MONITORAMENTO' : 'SAÍDA';
    return { status:pernoite ? 'PERNOITE' : 'EM ROTA', origin, detail:`${schedule.data.rota || 'Rota'} · ${ref.role}`, effectiveAt:monitoring?.updatedAt || start };
  }
  return { status:'INDISPONÍVEL', origin:'ESCALA', detail:`Escalado para ${schedule.data.rota || 'rota não informada'}`, effectiveAt:start };
}

function statePriority(status) {
  return { 'EM ROTA':5, 'PERNOITE':5, 'INDISPONÍVEL':3, 'DISPONÍVEL':1 }[status] || 0;
}

function canonicalOperationalResourceSource(source, vehicles, employees) {
  const data=normalizeResourceFields(source||{});
  const vehicleByPlate=new Map((vehicles||[]).map((item)=>[normalizeComparable(item.name||item.raw?.PLACA||'').replace(/[^A-Z0-9]/g,''),item]));
  const employeeByName=new Map((employees||[]).map((item)=>[normalizeComparable(item.name||item.raw?.NOME||''),item]));
  const plate=normalizeComparable(data.placa||'').replace(/[^A-Z0-9]/g,'');
  const vehicle=plate?vehicleByPlate.get(plate):null;
  if(vehicle)data.veiculo_id=vehicle.id||data.veiculo_id||'';
  const driver=employeeByName.get(normalizeComparable(data.motorista||''));
  if(driver)data.motorista_id=driver.id||data.motorista_id||'';
  const helper1=employeeByName.get(normalizeComparable(data.ajudante_1||''));
  if(helper1)data.ajudante_1_id=helper1.id||data.ajudante_1_id||'';
  const helper2=employeeByName.get(normalizeComparable(data.ajudante_2||''));
  if(helper2)data.ajudante_2_id=helper2.id||data.ajudante_2_id||'';
  return data;
}

export async function buildResourceCenter(db, dateValue, options = {}) {
  if (!options.skipEnsure) await ensureCoreSchema(db);
  const requestedDate=/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || '')) ? String(dateValue) : '';
  const globalOperationalView=!requestedDate;
  const targetDate=requestedDate||currentOperationalDate();
  // Quando o Dashboard já carregou estes conjuntos, reaproveita-os. Isso evita
  // reler Escala/Saída/Monitoramento/Retorno e os catálogos na mesma requisição,
  // reduzindo bastante o custo no D1 e a chance de timeout/HTTP 503.
  const employeeRows = options.employeeRows || await readCatalogRows(db,'BASE_COLABORADORES','NOME COLLATE NOCASE');
  const vehicleRows = options.vehicleRows || await readCatalogRows(db,'BASE_VEICULOS','PLACA COLLATE NOCASE');
  const lastDrivers = options.vehicleLastDriverMap || await vehicleLastDriverMap(db);
  const vehicleRowsWithLastDriver = vehicleRows.map((row)=>{
    const plateKey=String(row.PLACA||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const last=lastDrivers.get(plateKey);
    return last ? { ...row,ULTIMO_MOTORISTA_ID:last.DRIVER_ID||'',ULTIMO_MOTORISTA_NOME:last.DRIVER_NAME||'',ULTIMO_MOTORISTA_EM:last.EFFECTIVE_AT||'',ULTIMA_ESCALA_ID:last.SCHEDULE_ID||'' } : row;
  });
  const planningStart=addDaysIso(targetDate,-15);
  // Programações continuam usando a data de referência, porém qualquer viagem
  // operacional ainda aberta é incorporada independentemente do dia em que saiu.
  // O início da leitura se expande somente até a viagem aberta mais antiga, evitando
  // transformar a Central em uma varredura irrestrita de todo o histórico.
  const openMonitorings=options.openMonitorings || await findOpenMonitoringRows(db,globalOperationalView?'':targetDate);
  const oldestOpenDate=(openMonitorings||[]).map((row)=>String(row.date||row.data?.data||'').slice(0,10)).filter(Boolean).sort()[0]||'';
  const operationalStartDate=oldestOpenDate&&oldestOpenDate<planningStart?oldestOpenDate:planningStart;
  const schedules = options.schedules || await findModuleRows(db,'schedule',operationalStartDate,targetDate);
  const departures = options.departures || await findModuleRows(db,'departures',operationalStartDate,targetDate);
  const recentMonitorings = options.monitorings || await findModuleRows(db,'monitoring',planningStart,targetDate);
  const monitoringMap=new Map();
  for(const row of [...(recentMonitorings||[]),...(openMonitorings||[])])monitoringMap.set(`${row.module||'monitoring'}|${row.id}|${linkedIds(row.data)[0]||''}`,row);
  const monitorings=[...monitoringMap.values()];
  const returns = options.returns || await findModuleRows(db,'returns',operationalStartDate,targetDate);
  const manualMap = options.manualMap || await latestManualReleaseMap(db,dayEnd(targetDate));
  const employees = employeeRows.map(employeeCatalogRef).filter(Boolean);
  const vehicles = vehicleRowsWithLastDriver.map(vehicleCatalogRef).filter(Boolean);
  const catalog = [...employees,...vehicles];
  const departuresBySchedule = new Map();
  departures.forEach((row) => linkedIds(row.data).forEach((id) => departuresBySchedule.set(id,row)));
  const monitoringBySchedule = new Map();
  monitorings.forEach((row) => linkedIds(row.data).forEach((id) => monitoringBySchedule.set(id,row)));
  const returnsBySchedule = new Map();
  returns.forEach((row) => linkedIds(row.data).forEach((id) => returnsBySchedule.set(id,row)));
  const allocations = [];
  const representedMonitoringIds = new Set();
  const returnsByMonitoring = new Map();
  returns.forEach((row) => {
    const monitoringId=String(row.data?.monitoring_id || row.data?.monitoringId || '').trim();
    if(monitoringId)returnsByMonitoring.set(monitoringId,row);
  });

  for (const schedule of schedules.filter((row) => normalizeStatus(row.data.status) !== 'CANCELADO')) {
    const ids = linkedIds({ ...schedule.data, schedule_record_id:schedule.id });
    const departure = ids.map((id) => departuresBySchedule.get(id)).find(Boolean) || null;
    const monitoring = ids.map((id) => monitoringBySchedule.get(id)).find(Boolean) || null;
    const returnRow = ids.map((id) => returnsBySchedule.get(id)).find(Boolean) || null;
    if(monitoring?.id)representedMonitoringIds.add(String(monitoring.id));
    // Depois da saída, os recursos efetivamente utilizados são os registrados na
    // Saída. O Monitoramento define o estado da viagem, mas não deve reativar os
    // recursos originais da Escala caso seu payload histórico ainda esteja antigo.
    const resourceSource = canonicalOperationalResourceSource(departure?.data || monitoring?.data || schedule.data,vehicles,employees);
    for (const ref of resourceRefsFromData(resourceSource)) {
      const state = assignmentStatus(schedule,departure,monitoring,returnRow,manualMap.get(`${ref.type}|${ref.key}`),targetDate,ref);
      if (state) allocations.push({ ...state, resourceType:ref.type, resourceKey:ref.key, resourceName:ref.name, resourceId:ref.id, role:ref.role, scheduleRecordId:schedule.id, route:schedule.data.rota || '', departureRecordId:departure?.id || null, monitoringRecordId:monitoring?.id || null, returnRecordId:returnRow?.id || null });
    }
  }

  // Monitoramento ativo é evidência operacional suficiente por si só. Registros
  // antigos/orfãos podem não possuir uma Escala carregável, mas nem por isso o
  // veículo, motorista ou ajudantes podem aparecer como disponíveis. Incorporamos
  // todo Monitoramento ativo que ainda não foi representado pelo laço de Escalas.
  for (const monitoring of openMonitorings || []) {
    if (representedMonitoringIds.has(String(monitoring.id))) continue;
    const ids=linkedIds(monitoring.data || {});
    const linkedReturn=ids.map((id)=>returnsBySchedule.get(id)).find(Boolean) || returnsByMonitoring.get(String(monitoring.id));
    const returnAt=linkedReturn ? toLocalIso(linkedReturn.data?.data || linkedReturn.date, linkedReturn.data?.retorno_real || linkedReturn.data?.RETURN_AT) : '';
    if(returnAt) continue;
    const linkedDeparture=ids.map((id)=>departuresBySchedule.get(id)).find(Boolean) || null;
    const resourceSource=canonicalOperationalResourceSource(linkedDeparture?.data || monitoring.data || {},vehicles,employees);
    const monitoringStatus=normalizeStatus(monitoring.data?.status_monitoramento || monitoring.data?.status || monitoring.status || 'EM ROTA');
    const status=monitoringStatus === 'PERNOITE' ? 'PERNOITE' : 'EM ROTA';
    const start=toLocalIso(resourceSource.data || monitoring.date, resourceSource.saida_real || resourceSource.hora_real || resourceSource.hora_saida_real || resourceSource.horario_ponto, '00:00') || dayStart(String(monitoring.date || targetDate).slice(0,10));
    for(const ref of resourceRefsFromData(resourceSource)){
      const manualEvent=manualMap.get(`${ref.type}|${ref.key}`);
      const manualEnd=manualEvent && manualEvent.EFFECTIVE_AT >= start ? manualEvent.EFFECTIVE_AT : '';
      if(manualEnd){
        allocations.push({status:'DISPONÍVEL',origin:'MANUAL',detail:`Liberação antecipada por ${manualEvent.CREATED_BY_NAME || 'usuário'}`,effectiveAt:manualEnd,resourceType:ref.type,resourceKey:ref.key,resourceName:ref.name,resourceId:ref.id,role:ref.role,scheduleRecordId:Number(resourceSource.schedule_record_id||0)||null,route:resourceSource.rota||monitoring.data?.rota||'',departureRecordId:linkedDeparture?.id||null,monitoringRecordId:monitoring.id,returnRecordId:linkedReturn?.id||null});
        continue;
      }
      allocations.push({status,origin:'MONITORAMENTO',detail:`${resourceSource.rota || monitoring.data?.rota || 'Rota'} · ${ref.role} · monitoramento ativo`,effectiveAt:start,resourceType:ref.type,resourceKey:ref.key,resourceName:ref.name,resourceId:ref.id,role:ref.role,scheduleRecordId:Number(resourceSource.schedule_record_id||0)||null,route:resourceSource.rota||monitoring.data?.rota||'',departureRecordId:linkedDeparture?.id||null,monitoringRecordId:monitoring.id,returnRecordId:null});
    }
  }

  // Se um recurso existe operacionalmente em uma viagem aberta, mas ainda não
  // consta no cadastro mestre (situação possível em históricos/importações), ele
  // também precisa aparecer na Central como ocupado. Isso evita diferença entre
  // o total de placas do Resumo e a Central e, principalmente, evita falsa
  // disponibilidade por ausência de cadastro.
  const effectiveCatalog=[...catalog];
  for(const allocation of allocations){
    const exists=effectiveCatalog.some((item)=>item.type===allocation.resourceType && (item.key===allocation.resourceKey || normalizeComparable(item.name)===normalizeComparable(allocation.resourceName)));
    if(exists)continue;
    effectiveCatalog.push({type:allocation.resourceType,id:allocation.resourceId||'',name:allocation.resourceName||'',key:allocation.resourceKey,baseStatus:'DISPONÍVEL',active:true,routeHelper:false,restrictedDriver:false,restrictedHelper:false,thirdPartyDriver:false,raw:{ORIGEM_CADASTRO:'MONITORAMENTO'}});
  }

  const items = effectiveCatalog.map((item) => {
    // O ajudante de rota pode apoiar outro veículo quando está somente EM ROTA,
    // mas PERNOITE é indisponibilidade real e precisa prevalecer na Central.
    const allRelated=allocations.filter((allocation) => allocation.resourceType === item.type && (allocation.resourceKey === item.key || normalizeComparable(allocation.resourceName) === normalizeComparable(item.name)));
    const related = item.routeHelper ? allRelated.filter((allocation)=>normalizeStatus(allocation.status)==='PERNOITE') : allRelated;
    related.sort((a,b) => statePriority(b.status) - statePriority(a.status) || String(b.effectiveAt).localeCompare(String(a.effectiveAt)));
    let selected = related[0] || null;
    const blocked = !item.active || HARD_BLOCKED_STATUSES.has(item.baseStatus);
    if (blocked && (!selected || selected.status === 'DISPONÍVEL')) selected = { status:'INDISPONÍVEL', origin:'CADASTRO', detail:item.baseStatus || 'Cadastro inativo', effectiveAt:selected?.effectiveAt || '' };
    if (!selected) selected = { status:'DISPONÍVEL', origin:'CALCULADO', detail:'Sem ocupação operacional em aberto', effectiveAt:'' };
    return {
      resourceType:item.type, resourceId:item.id, resourceKey:item.key, resourceName:item.name,
      status:selected.status, origin:selected.origin, detail:selected.detail, effectiveAt:selected.effectiveAt, updatedBy:selected.updatedBy||'',
      scheduleRecordId:selected.scheduleRecordId || null, route:selected.route || '', baseStatus:item.baseStatus,
      active:item.active, routeHelper:Boolean(item.routeHelper), restrictedDriver:Boolean(item.restrictedDriver), restrictedHelper:Boolean(item.restrictedHelper), thirdPartyDriver:Boolean(item.thirdPartyDriver), raw:item.raw,
    };
  });

  const summary = {
    total:items.length,
    disponiveis:items.filter((item) => item.status === 'DISPONÍVEL').length,
    emRota:items.filter((item) => item.status === 'EM ROTA').length,
    pernoite:items.filter((item) => item.status === 'PERNOITE').length,
    indisponiveis:items.filter((item) => item.status === 'INDISPONÍVEL').length,
    // Para a operação própria, motoristas terceiros não entram como disponibilidade
    // da Central. Eles continuam preservados no detalhamento quando estão em rota.
    motoristasDisponiveis:items.filter((item) => item.resourceType === 'MOTORISTA' && item.status === 'DISPONÍVEL' && !item.thirdPartyDriver).length,
    motoristasDisponiveisSemRestricao:items.filter((item) => item.resourceType === 'MOTORISTA' && item.status === 'DISPONÍVEL' && !item.thirdPartyDriver && !item.restrictedDriver).length,
    motoristasDisponiveisComRestricao:items.filter((item) => item.resourceType === 'MOTORISTA' && item.status === 'DISPONÍVEL' && !item.thirdPartyDriver && item.restrictedDriver).length,
    motoristasTerceirosDisponiveis:items.filter((item) => item.resourceType === 'MOTORISTA' && item.status === 'DISPONÍVEL' && item.thirdPartyDriver).length,
    ajudantesDisponiveis:items.filter((item) => item.resourceType === 'AJUDANTE' && item.status === 'DISPONÍVEL').length,
    veiculosDisponiveis:items.filter((item) => item.resourceType === 'VEICULO' && item.status === 'DISPONÍVEL').length,
  };
  let eventRows=[];
  if (options.includeEvents !== false) {
    const eventResult = await db.prepare(`SELECT * FROM ROUTE_RESOURCE_EVENTS WHERE DATE_KEY=? ORDER BY EFFECTIVE_AT DESC,ID DESC LIMIT 500`).bind(targetDate).all();
    eventRows = eventResult.results || [];
  }
  return {
    versao:'1', date:targetDate, globalOperationalView, generatedAt:new Date().toISOString(), summary,
    resources:items,
    drivers:items.filter((item) => item.resourceType === 'MOTORISTA'),
    helpers:items.filter((item) => item.resourceType === 'AJUDANTE'),
    vehicles:items.filter((item) => item.resourceType === 'VEICULO'),
    allocations,
    events:(eventRows || []).map((row) => ({ id:row.ID,resourceType:row.RESOURCE_TYPE,resourceId:row.RESOURCE_ID,resourceName:row.RESOURCE_NAME,status:row.STATUS,effectiveAt:row.EFFECTIVE_AT,source:row.SOURCE,author:row.CREATED_BY_NAME,details:parseData(row.DETAILS_JSON) })),
  };
}
