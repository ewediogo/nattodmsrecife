const encoder = new TextEncoder();
let authSchemaPromise = null;

export const APP_VERSION = '1';
export const APP_LABEL = 'Versão 1 - DMS ROTA';
export const SESSION_HOURS = 8;
export const PASSWORD_MIN_LENGTH = 8;

export const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Natto-Dms-Version': APP_VERSION,
  },
});

export function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
export function normalizeMatricula(value) { return String(value || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40); }
export function cleanText(value, max = 250) { return String(value ?? '').trim().slice(0, max); }
export function internalEmailForMatricula(value, prefix = 'user') {
  const matricula = normalizeMatricula(value);
  const safe = matricula.replace(/[^A-Z0-9._-]/g, '_').toLowerCase() || randomHex(4);
  return `${prefix}-${safe}-${randomHex(3)}@matricula.natto.local`;
}

function bytesToHex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
function constantTimeEqual(left, right) {
  const a = String(left || ''), b = String(right || '');
  let mismatch = a.length ^ b.length;
  const size = Math.max(a.length, b.length, 1);
  for (let i = 0; i < size; i += 1) mismatch |= (a.charCodeAt(i % Math.max(a.length, 1)) || 0) ^ (b.charCodeAt(i % Math.max(b.length, 1)) || 0);
  return mismatch === 0;
}
function safeJson(value, fallback) { try { const parsed = JSON.parse(String(value || '')); return parsed ?? fallback; } catch { return fallback; } }
function inferBases(role, permissionsValue) {
  if (String(role || '').toUpperCase() === 'ADMIN') return ['route'];
  const permissions = typeof permissionsValue === 'string' ? safeJson(permissionsValue, []) : permissionsValue;
  if (permissions && !Array.isArray(permissions) && permissions.route === false) return [];
  return ['route'];
}
function publicUser(row) {
  if (!row) return null;
  const rawEmail = row.EMAIL ?? row.email ?? '';
  const visibleEmail = /@matricula\.natto\.local$/i.test(String(rawEmail)) ? '' : rawEmail;
  return {
    id: row.ID ?? row.id,
    name: row.NAME ?? row.name,
    email: visibleEmail,
    matricula: row.MATRICULA ?? row.matricula ?? '',
    role: row.ROLE ?? row.role,
    cargo: row.CARGO ?? row.cargo ?? '',
    active: Number(row.ACTIVE ?? row.active ?? 1) === 1,
    mustChangePassword: Number(row.MUST_CHANGE_PASSWORD ?? row.mustChangePassword ?? 0) === 1,
    permissions: safeJson(row.PERMISSIONS_JSON ?? row.permissions, []),
    bases: safeJson(row.BASES_JSON ?? row.bases, inferBases(row.ROLE ?? row.role, row.PERMISSIONS_JSON ?? row.permissions)),
    lastLogin: row.LAST_LOGIN ?? row.lastLogin ?? null,
  };
}
function randomHex(size = 32) { const bytes = new Uint8Array(size); crypto.getRandomValues(bytes); return bytesToHex(bytes); }

async function authSchemaReady(db) {
  try {
    const expected = [
      'ROUTE_USERS','IDX_ROUTE_USERS_MATRICULA','IDX_ROUTE_USERS_EMAIL',
      'ROUTE_SESSIONS','IDX_ROUTE_SESSION_EXPIRY',
    ];
    const placeholders = expected.map(() => '?').join(',');
    const result = await db.prepare(`SELECT name FROM sqlite_master WHERE name IN (${placeholders})`).bind(...expected).all();
    const found = new Set((result.results || []).map((row) => String(row.name || '')));
    return expected.every((name) => found.has(name));
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password) {
  const text = String(password || '');
  if (text.length < PASSWORD_MIN_LENGTH || !/[A-Z]/.test(text) || !/[a-z]/.test(text) || !/[0-9]/.test(text) || !/[^A-Za-z0-9]/.test(text)) {
    throw new Error(`A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres, com maiúscula, minúscula, número e símbolo.`);
  }
  return text;
}
export async function hashPassword(password, salt) {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', salt:encoder.encode(String(salt)), iterations:100000, hash:'SHA-256' }, keyMaterial, 256);
  return bytesToHex(new Uint8Array(bits));
}
export async function ensureAuthSchema(db) {
  if (!authSchemaPromise) authSchemaPromise = (async () => {
    // Evita executar DDL em toda nova instância do Worker. Em banco já migrado,
    // uma consulta curta ao catálogo substitui cinco CREATE TABLE/INDEX que
    // disputavam o lock do D1 com qualquer operação de Salvar.
    if (await authSchemaReady(db)) return;
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_USERS (
        ID INTEGER PRIMARY KEY AUTOINCREMENT,
        NAME TEXT NOT NULL,
        EMAIL TEXT NOT NULL UNIQUE,
        MATRICULA TEXT,
        ROLE TEXT NOT NULL DEFAULT 'CONSULTA',
        CARGO TEXT,
        PASSWORD_HASH TEXT NOT NULL,
        SALT TEXT NOT NULL,
        ACTIVE INTEGER NOT NULL DEFAULT 1,
        PERMISSIONS_JSON TEXT NOT NULL DEFAULT '[]',
        BASES_JSON TEXT NOT NULL DEFAULT '["route"]',
        MUST_CHANGE_PASSWORD INTEGER NOT NULL DEFAULT 0,
        CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        LAST_LOGIN TEXT
      )`),
      db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS IDX_ROUTE_USERS_MATRICULA ON ROUTE_USERS(MATRICULA) WHERE MATRICULA IS NOT NULL AND TRIM(MATRICULA)<>''`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_USERS_EMAIL ON ROUTE_USERS(EMAIL)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ROUTE_SESSIONS (
        TOKEN TEXT PRIMARY KEY,
        USER_ID INTEGER NOT NULL,
        EXPIRES_AT TEXT NOT NULL,
        CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(USER_ID) REFERENCES ROUTE_USERS(ID) ON DELETE CASCADE
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_SESSION_EXPIRY ON ROUTE_SESSIONS(EXPIRES_AT)`),
    ]);
  })().catch(error => { authSchemaPromise = null; throw error; });
  return authSchemaPromise;
}

export async function createInitialAdmin(db, { name, email, matricula, password }) {
  await ensureAuthSchema(db);
  const existing = await db.prepare('SELECT COUNT(*) AS total FROM ROUTE_USERS').first();
  if (Number(existing?.total || 0) > 0) throw new Error('Já existem usuários cadastrados. Entre com uma conta existente.');
  const safeName = cleanText(name,120), safeEmail = normalizeEmail(email), safeMatricula = normalizeMatricula(matricula);
  if (!safeName) throw new Error('Informe o nome do administrador.');
  if (!safeEmail && !safeMatricula) throw new Error('Informe o e-mail ou a matrícula do administrador.');
  validatePasswordStrength(password);
  const salt = randomHex(16), hash = await hashPassword(password,salt), storedEmail = safeEmail || internalEmailForMatricula(safeMatricula,'admin');
  const result = await db.prepare(`INSERT INTO ROUTE_USERS (NAME,EMAIL,MATRICULA,ROLE,PASSWORD_HASH,SALT,ACTIVE,BASES_JSON,MUST_CHANGE_PASSWORD)
    VALUES (?,?,?,'ADMIN',?,?,1,'["route"]',0)`).bind(safeName,storedEmail,safeMatricula || null,hash,salt).run();
  return publicUser({ ID:result.meta.last_row_id, NAME:safeName, EMAIL:storedEmail, MATRICULA:safeMatricula, ROLE:'ADMIN', ACTIVE:1, BASES_JSON:'["route"]' });
}

export async function createSession(db, userId) {
  await ensureAuthSchema(db);
  const now = new Date().toISOString();
  await db.prepare('DELETE FROM ROUTE_SESSIONS WHERE EXPIRES_AT <= ?').bind(now).run();
  const token = randomHex(32), expiresAt = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
  await db.prepare('INSERT INTO ROUTE_SESSIONS (TOKEN,USER_ID,EXPIRES_AT) VALUES (?,?,?)').bind(token,Number(userId),expiresAt).run();
  return { token, expiresAt };
}
export function readBearer(request) { const value = request.headers.get('Authorization') || ''; return value.startsWith('Bearer ') ? value.slice(7).trim() : ''; }
export async function getSessionUser(db, request) {
  await ensureAuthSchema(db);
  const token = readBearer(request); if (!token) return null;
  const row = await db.prepare(`SELECT u.*,s.EXPIRES_AT AS SESSION_EXPIRES_AT FROM ROUTE_SESSIONS s JOIN ROUTE_USERS u ON u.ID=s.USER_ID
    WHERE s.TOKEN=? AND s.EXPIRES_AT>? AND u.ACTIVE=1`).bind(token,new Date().toISOString()).first();
  return row ? { ...publicUser(row), expiresAt:row.SESSION_EXPIRES_AT } : null;
}
export async function requireUser(db, request) { const user = await getSessionUser(db,request); return user ? { response:null,user } : { response:jsonResponse({erro:'Sessão inválida ou expirada.'},401),user:null }; }
export async function cleanupSessions(db) { await ensureAuthSchema(db); await db.prepare('DELETE FROM ROUTE_SESSIONS WHERE EXPIRES_AT<=?').bind(new Date().toISOString()).run(); }

export async function authenticateUser(db, identifierValue, passwordValue) {
  await ensureAuthSchema(db);
  const identifier = String(identifierValue || '').trim(), password = String(passwordValue || '');
  if (!identifier || !password) throw new Error('Informe matrícula ou e-mail e senha.');
  const row = identifier.includes('@')
    ? await db.prepare('SELECT * FROM ROUTE_USERS WHERE LOWER(EMAIL)=? LIMIT 1').bind(normalizeEmail(identifier)).first()
    : await db.prepare('SELECT * FROM ROUTE_USERS WHERE MATRICULA=? LIMIT 1').bind(normalizeMatricula(identifier)).first();
  if (!row || Number(row.ACTIVE) !== 1) return null;
  const valid = Boolean(row.SALT) && constantTimeEqual(await hashPassword(password,row.SALT),row.PASSWORD_HASH);
  if (!valid) return null;
  await db.prepare('UPDATE ROUTE_USERS SET LAST_LOGIN=CURRENT_TIMESTAMP WHERE ID=?').bind(row.ID).run();
  return { user:publicUser(row) };
}

export async function changePassword(db,userId,currentPassword,newPassword) {
  await ensureAuthSchema(db); validatePasswordStrength(newPassword);
  const row = await db.prepare('SELECT * FROM ROUTE_USERS WHERE ID=? AND ACTIVE=1').bind(Number(userId)).first();
  if (!row) throw new Error('Usuário não encontrado.');
  if (!constantTimeEqual(await hashPassword(currentPassword,row.SALT),row.PASSWORD_HASH)) throw new Error('A senha atual não confere.');
  const salt = randomHex(16), hash = await hashPassword(newPassword,salt);
  await db.prepare(`UPDATE ROUTE_USERS SET PASSWORD_HASH=?,SALT=?,MUST_CHANGE_PASSWORD=0,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=?`).bind(hash,salt,Number(userId)).run();
  await db.prepare('DELETE FROM ROUTE_SESSIONS WHERE USER_ID=?').bind(Number(userId)).run();
  return true;
}

export { publicUser, randomHex, inferBases, safeJson };
