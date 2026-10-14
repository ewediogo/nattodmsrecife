import { changePassword, jsonResponse, requireUser } from '../../_lib/auth.js';

export async function onRequestPost({ env, request }) {
  if (!env.DB) return jsonResponse({ erro: "Binding D1 'DB' não encontrado." }, 500);
  const auth = await requireUser(env.DB, request);
  if (auth.response) return auth.response;
  try {
    const payload = await request.json().catch(() => ({}));
    if (String(payload.newPassword || '') !== String(payload.confirmPassword || '')) throw new Error('A confirmação da nova senha não confere.');
    await changePassword(env.DB, auth.user.id, payload.currentPassword, payload.newPassword);
    return jsonResponse({ ok:true, versao:'1', reauthenticate:true });
  } catch (error) {
    return jsonResponse({ erro:error.message || String(error) }, 400);
  }
}
