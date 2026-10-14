import { authenticateUser, createSession, jsonResponse } from '../../_lib/auth.js';
import { ensurePerformanceIndexes } from '../../_lib/performance.js';

export async function onRequestPost({ env, request, waitUntil }) {
  if (!env.DB) return jsonResponse({ erro: "Binding D1 'DB' não encontrado." }, 500);
  try {
    const payload = await request.json().catch(() => ({}));
    const result = await authenticateUser(env.DB, payload.usuario ?? payload.matricula ?? payload.email, payload.password);
    if (!result) return jsonResponse({ erro: 'Matrícula/e-mail ou senha inválidos.' }, 401);
    const session = await createSession(env.DB, result.user.id);
    if(typeof waitUntil==='function')waitUntil(ensurePerformanceIndexes(env.DB).catch((error)=>console.warn('Index bootstrap warning',error?.message||error)));
    return jsonResponse({ versao:'1', user:result.user, ...session });
  } catch (error) {
    return jsonResponse({ erro:error.message || String(error) }, 400);
  }
}
