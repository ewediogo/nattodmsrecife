-- Recuperação de desempenho do Monitoramento - 28/09/2026
-- Garante os índices compostos reportados pelo diagnóstico em bancos D1 onde
-- a migration 0022 não foi aplicada manualmente durante deploy do Pages.

CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_RET_DATE_ACTIVE
  ON ROUTE_GPS_RETENTIONS(DATE_KEY, ACTIVE, PLATE, STARTED_AT);

CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_OCC_DATE_TYPE
  ON ROUTE_GPS_OCCURRENCES(DATE_KEY, TYPE, PLATE);
