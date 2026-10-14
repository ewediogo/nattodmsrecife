import { createInitialAdmin, createSession, jsonResponse } from '../../_lib/auth.js';

export async function onRequestPost({ env, request }) {
  if (!env.DB) return jsonResponse({ erro: "Binding D1 'DB' não encontrado." }, 500);
  try {
    const payload = await request.json().catch(() => ({}));
    const user = await createInitialAdmin(env.DB, payload);
    const session = await createSession(env.DB, user.id);
    return jsonResponse({ versao:'1', user, ...session }, 201);
  } catch (error) {
    return jsonResponse({ erro:error.message || String(error) }, 400);
  }
}
