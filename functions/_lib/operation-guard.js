let guardSchemaPromise = null;

async function guardSchemaReady(db) {
  try {
    const expected = ['ROUTE_LOCKS','ROUTE_REQUESTS','IDX_ROUTE_REQUEST_CREATED'];
    const placeholders = expected.map(() => '?').join(',');
    const result = await db.prepare(`SELECT name FROM sqlite_master WHERE name IN (${placeholders})`).bind(...expected).all();
    const found = new Set((result.results || []).map((row) => String(row.name || '')));
    return expected.every((name) => found.has(name));
  } catch {
    return false;
  }
}

async function ensureGuardSchema(db) {
  if (!guardSchemaPromise) guardSchemaPromise = (async () => {
    // O schema já aplicado é o caso normal. Não execute DDL nem manutenção
    // durante um salvamento: locks vencidos são retomados atomicamente em
    // acquire(), sem depender de uma limpeza prévia.
    if (await guardSchemaReady(db)) return;
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_LOCKS (
        LOCK_KEY TEXT PRIMARY KEY,
        OWNER TEXT,
        EXPIRES_AT TEXT,
        UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`INSERT OR IGNORE INTO ROUTE_LOCKS (LOCK_KEY,OWNER,EXPIRES_AT) VALUES ('ROUTE:OPERATION',NULL,NULL)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_REQUESTS (
        REQUEST_ID TEXT PRIMARY KEY,
        DOMAIN TEXT NOT NULL,
        RESPONSE_JSON TEXT,
        CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_REQUEST_CREATED ON ROUTE_REQUESTS(CREATED_AT)`),
    ]);
  })().catch(error => { guardSchemaPromise = null; throw error; });
  return guardSchemaPromise;
}

async function acquire(db, key) {
  await ensureGuardSchema(db);
  const owner = crypto.randomUUID();
  await db.prepare('INSERT OR IGNORE INTO ROUTE_LOCKS (LOCK_KEY,OWNER,EXPIRES_AT) VALUES (?,NULL,NULL)').bind(key).run();
  // O tempo anterior de espera (~2 s) era menor que a própria lease de 15 s.
  // Em uma atualização normal de Monitoramento/Escala o usuário podia receber
  // RESOURCE_LOCKED mesmo sem existir conflito real. Esperamos por até ~8 s e
  // usamos uma lease menor; locks vencidos continuam sendo retomados pelo SQL.
  for (let attempt = 0; attempt < 28; attempt += 1) {
    const expires = new Date(Date.now() + 12000).toISOString().replace('T',' ').slice(0,19);
    const result = await db.prepare(`UPDATE ROUTE_LOCKS SET OWNER=?,EXPIRES_AT=?,UPDATED_AT=CURRENT_TIMESTAMP
      WHERE LOCK_KEY=? AND (OWNER IS NULL OR EXPIRES_AT IS NULL OR EXPIRES_AT<CURRENT_TIMESTAMP)`)
      .bind(owner,expires,key).run();
    if (Number(result.meta?.changes || 0) === 1) return owner;
    await new Promise(resolve => setTimeout(resolve, Math.min(420, 90 + attempt * 14)));
  }
  const error = new Error('Outra alteração operacional está sendo processada. Tente novamente em alguns segundos.');
  error.code = 'RESOURCE_LOCKED';
  throw error;
}

async function release(db,key,owner) {
  if (!owner) return;
  await db.prepare(`UPDATE ROUTE_LOCKS SET OWNER=NULL,EXPIRES_AT=NULL,UPDATED_AT=CURRENT_TIMESTAMP WHERE LOCK_KEY=? AND OWNER=?`).bind(key,owner).run();
}

function lockToken(value, max = 120) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9:_-]+/g,'_').slice(0,max);
}

export function operationalScopeFromPayload(payload = {}, fallback = '') {
  const nested = payload?.data;
  const source = nested && typeof nested === 'object' && !Array.isArray(nested) ? { ...payload, ...nested } : (payload || {});
  const scheduleId = source.schedule_record_id || source.schedule_id || source.escala_id || source.escala_id_legado || source.legado_id || '';
  if (scheduleId !== null && scheduleId !== undefined && String(scheduleId).trim()) return `SCHEDULE:${lockToken(scheduleId)}`;
  const recordId = source.id || source.record_id || '';
  if (recordId !== null && recordId !== undefined && String(recordId).trim()) return `RECORD:${lockToken(recordId)}`;
  const plate = lockToken(source.placa || source.plate || '', 20);
  const date = lockToken(source.data || source.date || source.date_key || '', 20);
  if (plate || date) return `CONTEXT:${plate || 'SEM_PLACA'}:${date || 'SEM_DATA'}`;
  return fallback ? `FALLBACK:${lockToken(fallback)}` : '';
}

function operationalLockKey(domain, scope = '') {
  const cleanScope = lockToken(scope, 160);
  // O mesmo SCHEDULE compartilha lock entre Saída/Monitoramento/Retorno para
  // impedir corrida no mesmo fluxo, sem bloquear viagens independentes.
  if (cleanScope.startsWith('SCHEDULE:')) return `ROUTE:TRIP:${cleanScope.slice('SCHEDULE:'.length)}`;
  return `ROUTE:${lockToken(domain || 'OPERATION',80)}:${cleanScope || 'GENERAL'}`;
}

export async function withOperationalGuard(db, domain, requestId, callback, scope = '') {
  await ensureGuardSchema(db);
  const key = operationalLockKey(domain, scope);
  const cleanRequest = String(requestId || '').trim().slice(0,120);
  if (cleanRequest) {
    const prior = await db.prepare('SELECT DOMAIN,RESPONSE_JSON FROM ROUTE_REQUESTS WHERE REQUEST_ID=?').bind(cleanRequest).first();
    if (prior) {
      if (String(prior.DOMAIN) !== String(domain)) {
        const error = new Error('requestId já utilizado por outra operação.'); error.code='REQUEST_ID_CONFLICT'; throw error;
      }
      try { return { ...JSON.parse(prior.RESPONSE_JSON || '{}'), replayed:true }; } catch { return { replayed:true }; }
    }
  }
  const owner = await acquire(db,key);
  try {
    // Releitura dentro do lock evita corrida entre o teste e a persistência.
    if (cleanRequest) {
      const prior = await db.prepare('SELECT DOMAIN,RESPONSE_JSON FROM ROUTE_REQUESTS WHERE REQUEST_ID=?').bind(cleanRequest).first();
      if (prior) {
        if (String(prior.DOMAIN) !== String(domain)) { const error=new Error('requestId já utilizado por outra operação.'); error.code='REQUEST_ID_CONFLICT'; throw error; }
        try { return { ...JSON.parse(prior.RESPONSE_JSON || '{}'), replayed:true }; } catch { return { replayed:true }; }
      }
    }
    const result = await callback();
    if (cleanRequest) {
      await db.prepare(`INSERT INTO ROUTE_REQUESTS (REQUEST_ID,DOMAIN,RESPONSE_JSON) VALUES (?,?,?)`).bind(cleanRequest,String(domain),JSON.stringify(result ?? {})).run();
    }
    return result;
  } finally {
    await release(db,key,owner).catch(()=>{});
  }
}
