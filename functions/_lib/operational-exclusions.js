const EXCLUDED_OPERATIONAL_PLATES = new Set(['XYZ0000']);

export function normalizeOperationalPlate(value = '') {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function isOperationallyExcludedPlate(value = '') {
  return EXCLUDED_OPERATIONAL_PLATES.has(normalizeOperationalPlate(value));
}

export function isOperationallyExcludedTrip(row = {}) {
  return isOperationallyExcludedPlate(row.placa || row.plate || row.PLATE || row.veiculo || row.vehicle);
}

export function isMonitoringExcludedTrip(row = {}) {
  const route = String(row.rota || row.route || row.ROTA || row.destino || row.destination || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ');
  // Viagens administrativas/especiais que não pertencem ao acompanhamento
  // operacional do Monitoramento também ficam fora do Plano de Alocação,
  // que reutiliza esta mesma regra.
  return isOperationallyExcludedTrip(row)
    || /\b(CAIXA|CAIXAS|ALMOXARIFADO|VENEZA|MANOBRA|MANUTENCAO|THERMOBRASIL|RECIFE)\b/.test(route)
    || /\b(SERVICO ADM|SERVICO ADMINISTRATIVO)\b/.test(route);
}
