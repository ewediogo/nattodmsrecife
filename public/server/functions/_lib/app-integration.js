import { audit } from './core.js';
import { addDays, dateIso, findDomainBySchedule, normalizeText } from './route-phase1.js';
import { findScheduleRecordInternal, listScheduleRecordsInternal } from './schedule.js';

export const APP_SERVICE_USER = Object.freeze({
  id: null,
  name: 'NATTO Entregas',
  email: 'natto-entregas@service.internal',
  role: 'ADMIN',
  bases: ['route'],
  permissions: [],
});

function appError(message, code = 'APP_INTEGRATION_ERROR', status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function enabled(value) {
  return ['1','TRUE','SIM','YES','ON'].includes(String(value ?? '').trim().toUpperCase());
}

async function digest(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(hash);
}

async function sameSecret(left, right) {
  const [a,b] = await Promise.all([digest(left), digest(right)]);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i=0;i<a.length;i+=1) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

export async function requireAppService(request, env) {
  const configured = String(env?.DMS_ROTA_APP_SECRET || '').trim();
  if (!configured) throw appError('A integração NATTO Entregas ainda não possui Secret configurado no Cloudflare.', 'APP_SECRET_NOT_CONFIGURED', 503);
  const authorization = String(request?.headers?.get('Authorization') || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const supplied = match?.[1]?.trim() || '';
  if (!supplied || !(await sameSecret(configured, supplied))) throw appError('Integração não autorizada.', 'APP_UNAUTHORIZED', 401);
  return APP_SERVICE_USER;
}

export function appWritesEnabled(env) {
  return enabled(env?.DMS_APP_WRITE_ENABLED);
}

export function requireAppWriteEnabled(env) {
  if (!appWritesEnabled(env)) throw appError('As escritas do NATTO Entregas estão bloqueadas para testes. Altere DMS_APP_WRITE_ENABLED para true somente após validar a leitura.', 'APP_WRITES_DISABLED', 423);
}

export function appJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type':'application/json; charset=UTF-8',
      'Cache-Control':'no-store, max-age=0',
      'X-Content-Type-Options':'nosniff',
    },
  });
}

export async function readAppJson(request) {
  const text = await request.text();
  if (!text.trim()) return {};
  try { return JSON.parse(text); }
  catch { throw appError('JSON inválido.', 'INVALID_JSON', 400); }
}

export function normalizePlate(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
}

function recifeParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'America/Recife', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
  }).formatToParts(Number.isNaN(date.getTime()) ? new Date() : date);
  const get = (type) => parts.find((part)=>part.type===type)?.value || '';
  return { date:`${get('year')}-${get('month')}-${get('day')}`, time:`${get('hour')}:${get('minute')}:${get('second')}` };
}

export function nowRecifeIso() {
  const parts = recifeParts();
  return `${parts.date}T${parts.time}-03:00`;
}

export function todayRecife() {
  return recifeParts().date;
}

export function routeKey(schedule = {}) {
  const storage = String(schedule.storage || schedule.sourceTable || 'ESCALAS_DIA').trim().toUpperCase();
  return `${storage}:${String(schedule.id ?? '')}`;
}

function splitRouteKey(value = '') {
  const text = String(value || '').trim();
  const colon = text.indexOf(':');
  if (colon < 1) return { storage:'', id:text };
  return { storage:text.slice(0,colon).toUpperCase(), id:text.slice(colon+1) };
}

const TERMINAL_SCHEDULE = new Set(['FINALIZADO','FINALIZADA','CANCELADO','CANCELADA','RETORNOU','ENCERRADO','ENCERRADA']);

function localDateTime(date, time) {
  const d = dateIso(date);
  const raw = String(time || '').trim();
  if (!d || !raw) return '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.includes('Z') || /[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw.slice(0,19)}-03:00`;
  const match = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return '';
  return `${d}T${String(match[1]).padStart(2,'0')}:${match[2]}:${match[3] || '00'}-03:00`;
}

export async function resolveAppSchedule(db, payload = {}) {
  const routeRef = payload.routeId || payload.route_id || payload.routeKey || '';
  let {storage,id} = splitRouteKey(routeRef);
  const explicitStorage = String(payload.scheduleStorage || payload.schedule_storage || payload.storage || '').trim().toUpperCase();
  const explicitId = String(payload.scheduleId || payload.schedule_id || payload.schedule_record_id || payload.escala_id || '').trim();
  if (explicitStorage) storage = explicitStorage;
  if (explicitId) id = explicitId;
  if (!id) throw appError('Informe routeId ou scheduleId.', 'APP_ROUTE_REFERENCE_REQUIRED', 400);
  let schedule = null;
  if (storage) schedule = await findScheduleRecordInternal(db,id,storage).catch(()=>null);
  if (!schedule) schedule = await findScheduleRecordInternal(db,id,'').catch(()=>null);
  if (!schedule) throw appError('Escala não encontrada no DMS-Rota.', 'APP_ROUTE_NOT_FOUND', 404, {routeId:routeRef,scheduleId:id,storage});
  return schedule;
}

export async function buildAppRoute(db, schedule, options = {}) {
  if (!schedule) return null;
  const [departure, monitoring, returned] = await Promise.all([
    findDomainBySchedule(db,'departures',schedule.id).catch(()=>null),
    findDomainBySchedule(db,'monitoring',schedule.id).catch(()=>null),
    findDomainBySchedule(db,'returns',schedule.id).catch(()=>null),
  ]);
  const terminal = TERMINAL_SCHEDULE.has(normalizeText(schedule.status));
  const returnedFinal = Boolean(returned?.retorno_real || returned?.return_at || normalizeText(returned?.status)==='FINALIZADO');
  const active = !terminal && !returnedFinal;
  const planned = localDateTime(schedule.data, schedule.horario_ponto);
  const effective = localDateTime(departure?.data || schedule.data, departure?.hora_real || departure?.actualAt || departure?.actual_at);
  const helpers = [schedule.ajudante_1, schedule.ajudante_2].filter(Boolean);
  return {
    id: routeKey(schedule),
    routeId: routeKey(schedule),
    scheduleId: String(schedule.id),
    scheduleStorage: String(schedule.storage || schedule.sourceTable || ''),
    date: dateIso(schedule.data),
    sequence: String(schedule.sequencia || ''),
    loadOrder: String(schedule.ocs || ''),
    routeName: String(schedule.rota || schedule.destino || ''),
    route: String(schedule.rota || schedule.destino || ''),
    region: String(schedule.regiao || ''),
    plate: normalizePlate(schedule.placa),
    plateDisplay: String(schedule.placa || '').toUpperCase(),
    vehicleId: String(schedule.veiculo_id || ''),
    driverId: String(schedule.motorista_id || ''),
    driver: String(schedule.motorista || ''),
    helper1Id: String(schedule.ajudante_1_id || ''),
    helper1: String(schedule.ajudante_1 || ''),
    helper2Id: String(schedule.ajudante_2_id || ''),
    helper2: String(schedule.ajudante_2 || ''),
    helpers,
    teamType: String(schedule.tipo_equipe || ''),
    closedLoad: Boolean(schedule.carga_fechada),
    totalDeliveries: Math.max(0, Number(schedule.qtd_entregas || 0)),
    totalWeightTons: Math.max(0, Number(schedule.peso_t || 0)),
    totalWeightKg: Math.max(0, Number(schedule.peso_kg || 0)),
    plannedDepartureAt: planned,
    effectiveDepartureAt: effective,
    forecastReturnAt: String(schedule.previsao_retorno || ''),
    journeyLimitAt: String(schedule.limite_jornada || ''),
    durationDays: Math.max(1, Number(schedule.duracao_dias || 1)),
    status: String(schedule.status || 'PROGRAMADO'),
    departureStatus: String(departure?.status || departure?.status_saida || 'PENDENTE'),
    monitoringStatus: String(monitoring?.status || monitoring?.status_monitoramento || (effective ? 'EM ROTA' : 'PENDENTE DE SAÍDA')),
    returnStatus: String(returned?.status || ''),
    active,
    finalized: !active,
    source: 'DMS_ROTA_REAL',
    fetchedAt: nowRecifeIso(),
    ...(options.includeOperational ? {departure,monitoring,return:returned} : {}),
  };
}

export async function findActiveAppRoutesByPlate(db, plate) {
  const normalized = normalizePlate(plate);
  if (!normalized) throw appError('Informe a placa.', 'PLATE_REQUIRED', 400);
  const today = todayRecife();
  const start = addDays(today,-45);
  const {records=[]} = await listScheduleRecordsInternal(db,{start,end:today});
  const allCandidates = records.filter((row)=>normalizePlate(row.placa)===normalized);
  // O banco real usa ESCALAS_DIA como fonte operacional diária. Se existir a
  // mesma viagem também em ROUTE_RECORDS por histórico de migração, preferimos
  // exclusivamente ESCALAS_DIA para não criar uma falsa duplicidade no login.
  const legacyLive = allCandidates.filter((row)=>String(row.storage||'').toUpperCase()==='ESCALAS_DIA');
  const candidates = legacyLive.length ? legacyLive : allCandidates;
  const routes=[];
  for (const schedule of candidates) {
    const route=await buildAppRoute(db,schedule);
    if (route?.active) routes.push(route);
  }
  routes.sort((a,b)=>String(b.date).localeCompare(String(a.date)) || Number(a.sequence||999999)-Number(b.sequence||999999));
  return routes;
}

export async function auditAppRead(db, action, recordId, details = {}) {
  try { await audit(db,APP_SERVICE_USER,action,'APP_ENTREGAS',Number(recordId)||null,details); } catch (error) { console.warn('APP audit warning',error); }
}

export function appErrorResponse(error) {
  return appJson({
    ok:false,
    erro:error?.message || String(error),
    codigo:error?.code || 'APP_INTEGRATION_ERROR',
    ...(error?.details !== undefined ? {detalhes:error.details} : {}),
  }, Number(error?.status || 500));
}
