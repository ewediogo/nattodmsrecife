import { normalizeText } from './route-phase1.js';

export function assertRouteAccess(user, screen, write = false) {
  if (normalizeText(user?.role) === 'ADMIN') return true;
  const bases = Array.isArray(user?.bases) ? user.bases.map(v => String(v).toLowerCase()) : [];
  if (!bases.includes('route')) {
    const error = new Error('Você não tem acesso a este módulo.');
    error.code = 'ROUTE_ACCESS_DENIED';
    throw error;
  }
  const permissions = user?.permissions;
  if (permissions && !Array.isArray(permissions) && normalizeText(permissions.mode) === 'REPLACE') {
    const screens = Array.isArray(permissions.screens) ? permissions.screens : [];
    if (!screens.includes(screen)) {
      const error = new Error('Você não tem acesso a esta tela.');
      error.code = 'ROUTE_SCREEN_DENIED';
      throw error;
    }
  }
  if (write && normalizeText(user?.role) === 'CONSULTA') {
    const error = new Error('Seu usuário não possui permissão para alterar este módulo.');
    error.code = 'ROUTE_READ_ONLY';
    throw error;
  }
  return true;
}
