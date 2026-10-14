import { ensureAuthSchema, jsonResponse, readBearer } from '../../_lib/auth.js';

export async function onRequestPost({ env, request }) {
  if (!env.DB) return jsonResponse({ erro: "Binding D1 'DB' não encontrado." }, 500);
  try {
    await ensureAuthSchema(env.DB);
    const token = readBearer(request);
    if (token) await env.DB.prepare('DELETE FROM ROUTE_SESSIONS WHERE TOKEN = ?').bind(token).run();
    return jsonResponse({ ok: true, versao: '1' });
  } catch (error) {
    return jsonResponse({ erro: error.message || String(error) }, 500);
  }
}
