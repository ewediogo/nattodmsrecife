import {
  cleanText, ensureAuthSchema, hashPassword, inferBases, internalEmailForMatricula, jsonResponse, normalizeEmail, normalizeMatricula,
  publicUser, randomHex, requireUser, validatePasswordStrength,
} from '../../_lib/auth.js';
import { audit } from '../../_lib/core.js';

const ALLOWED_ROLES = new Set(['ADMIN','OPERADOR','CONSULTA']);
function normalizeRole(value) {
  const role = cleanText(value || 'CONSULTA',30).toUpperCase();
  if (!ALLOWED_ROLES.has(role)) throw new Error('Perfil inválido. Use ADMIN, OPERADOR ou CONSULTA.');
  return role;
}

async function ensureAdmin(db, request) {
  const auth = await requireUser(db, request);
  if (auth.response) return auth;
  if (String(auth.user.role || '').toUpperCase() !== 'ADMIN') {
    return { response:jsonResponse({ erro:'Somente administradores podem gerenciar usuários.' },403), user:auth.user };
  }
  return auth;
}

function normalizeBases(value, role, permissions) {
  const allowed = new Set(['route']);
  const supplied = Array.isArray(value) ? value : String(value || '').split(/[;,|]/);
  const bases = supplied.map((item)=>String(item||'').trim().toLowerCase()).filter((item)=>allowed.has(item));
  return [...new Set(bases.length ? bases : inferBases(role, permissions))];
}

export async function onRequestGet({ env, request }) {
  if (!env.DB) return jsonResponse({ erro:"Binding D1 'DB' não encontrado." },500);
  const auth = await ensureAdmin(env.DB, request);
  if (auth.response) return auth.response;
  try {
    await ensureAuthSchema(env.DB);
    const { results } = await env.DB.prepare('SELECT * FROM ROUTE_USERS ORDER BY ACTIVE DESC, NAME COLLATE NOCASE').all();
    return jsonResponse({ versao:'1', users:(results || []).map(publicUser) });
  } catch (error) {
    return jsonResponse({ erro:error.message || String(error) },500);
  }
}

export async function onRequestPost({ env, request }) {
  if (!env.DB) return jsonResponse({ erro:"Binding D1 'DB' não encontrado." },500);
  const auth = await ensureAdmin(env.DB, request);
  if (auth.response) return auth.response;
  try {
    await ensureAuthSchema(env.DB);
    const payload = await request.json().catch(() => ({}));
    const name = cleanText(payload.name || payload.nome,120);
    const matricula = normalizeMatricula(payload.matricula || payload.usuario);
    const email = normalizeEmail(payload.email);
    const role = normalizeRole(payload.role || payload.perfil || 'CONSULTA');
    const cargo = cleanText(payload.cargo,100);
    const password = validatePasswordStrength(payload.password || payload.senhaTemporaria || '');
    const permissions = JSON.stringify(payload.permissions || []);
    const bases = JSON.stringify(normalizeBases(payload.bases,role,permissions));
    if (!name) throw new Error('Informe o nome.');
    if (!matricula && !email) throw new Error('Informe pelo menos o e-mail ou a matrícula.');
    if (matricula) {
      const duplicateMatricula = await env.DB.prepare('SELECT ID FROM ROUTE_USERS WHERE MATRICULA=? LIMIT 1').bind(matricula).first();
      if (duplicateMatricula) throw new Error('Já existe um usuário com esta matrícula.');
    }
    if (email) {
      const duplicateEmail = await env.DB.prepare('SELECT ID FROM ROUTE_USERS WHERE LOWER(EMAIL)=? LIMIT 1').bind(email).first();
      if (duplicateEmail) throw new Error('Já existe um usuário com este e-mail.');
    }
    const salt = randomHex(16);
    const hash = await hashPassword(password,salt);
    const storedEmail = email || internalEmailForMatricula(matricula);
    const result = await env.DB.prepare(`INSERT INTO ROUTE_USERS
      (NAME,EMAIL,MATRICULA,ROLE,CARGO,PASSWORD_HASH,SALT,ACTIVE,PERMISSIONS_JSON,BASES_JSON,MUST_CHANGE_PASSWORD)
      VALUES (?,?,?,?,?,?,?,1,?,?,1)`)
      .bind(name,storedEmail,matricula || null,role,cargo,hash,salt,permissions,bases).run();
    const id = Number(result.meta.last_row_id || 0);
    const saved = await env.DB.prepare('SELECT * FROM ROUTE_USERS WHERE ID=? LIMIT 1').bind(id).first();
    await audit(env.DB,auth.user,'CRIAR','USUARIOS',id,{after:publicUser(saved)});
    return jsonResponse({ ok:true, id, user:publicUser(saved), mustChangePassword:true },201);
  } catch (error) {
    return jsonResponse({ erro:error.message || String(error) },400);
  }
}

export async function onRequestPut({ env, request }) {
  if (!env.DB) return jsonResponse({ erro:"Binding D1 'DB' não encontrado." },500);
  const auth = await ensureAdmin(env.DB, request);
  if (auth.response) return auth.response;
  try {
    await ensureAuthSchema(env.DB);
    const payload = await request.json().catch(() => ({}));
    const id = Number(payload.id);
    const name = cleanText(payload.name || payload.nome,120);
    const matricula = normalizeMatricula(payload.matricula || payload.usuario);
    const requestedEmail = normalizeEmail(payload.email);
    const role = normalizeRole(payload.role || payload.perfil || 'CONSULTA');
    const cargo = cleanText(payload.cargo,100);
    const active = payload.active === false || payload.active === 0 || payload.active === '0' ? 0 : 1;
    const permissions = JSON.stringify(payload.permissions || []);
    const bases = JSON.stringify(normalizeBases(payload.bases,role,permissions));
    if (!id || !name) throw new Error('Informe o nome do usuário.');
    const current = await env.DB.prepare('SELECT * FROM ROUTE_USERS WHERE ID=? LIMIT 1').bind(id).first();
    if (!current) throw new Error('Usuário não encontrado.');
    const currentEmail = normalizeEmail(current.EMAIL);
    const currentIsInternal = /@matricula\.natto\.local$/i.test(currentEmail);
    const email = requestedEmail || (!currentIsInternal ? currentEmail : '');
    if (!matricula && !email) throw new Error('Informe pelo menos o e-mail ou a matrícula.');
    if (matricula) {
      const duplicateMatricula = await env.DB.prepare('SELECT ID FROM ROUTE_USERS WHERE MATRICULA=? AND ID<>? LIMIT 1').bind(matricula,id).first();
      if (duplicateMatricula) throw new Error('Já existe outro usuário com esta matrícula.');
    }
    if (email) {
      const duplicateEmail = await env.DB.prepare('SELECT ID FROM ROUTE_USERS WHERE LOWER(EMAIL)=? AND ID<>? LIMIT 1').bind(email,id).first();
      if (duplicateEmail) throw new Error('Já existe outro usuário com este e-mail.');
    }
    const storedEmail = email || (currentIsInternal && currentEmail ? currentEmail : internalEmailForMatricula(matricula));
    if (payload.password || payload.senhaTemporaria) {
      const password = validatePasswordStrength(payload.password || payload.senhaTemporaria);
      const salt = randomHex(16);
      const hash = await hashPassword(password,salt);
      await env.DB.prepare(`UPDATE ROUTE_USERS SET NAME=?,EMAIL=?,MATRICULA=?,ROLE=?,CARGO=?,ACTIVE=?,PERMISSIONS_JSON=?,BASES_JSON=?,PASSWORD_HASH=?,SALT=?,MUST_CHANGE_PASSWORD=1,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=?`)
        .bind(name,storedEmail,matricula || null,role,cargo,active,permissions,bases,hash,salt,id).run();
      await env.DB.prepare('DELETE FROM ROUTE_SESSIONS WHERE USER_ID=?').bind(id).run();
    } else {
      await env.DB.prepare(`UPDATE ROUTE_USERS SET NAME=?,EMAIL=?,MATRICULA=?,ROLE=?,CARGO=?,ACTIVE=?,PERMISSIONS_JSON=?,BASES_JSON=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=?`)
        .bind(name,storedEmail,matricula || null,role,cargo,active,permissions,bases,id).run();
      if (!active) await env.DB.prepare('DELETE FROM ROUTE_SESSIONS WHERE USER_ID=?').bind(id).run();
    }
    const saved = await env.DB.prepare('SELECT * FROM ROUTE_USERS WHERE ID=? LIMIT 1').bind(id).first();
    await audit(env.DB,auth.user,'EDITAR','USUARIOS',id,{before:publicUser(current),after:publicUser(saved)});
    return jsonResponse({ ok:true, user:publicUser(saved) });
  } catch (error) {
    return jsonResponse({ erro:error.message || String(error) },400);
  }
}
