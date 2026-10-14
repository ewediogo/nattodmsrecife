-- Motoristas coringa por região - 2026-10-05
-- A pré-escala usa o coringa somente quando a região do coringa coincide
-- com a região da rota/escala que está sendo montada.
ALTER TABLE ROUTE_ALLOCATION_FLOAT_DRIVERS ADD COLUMN REGION TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS IDX_ROUTE_ALLOC_FLOAT_REGION_DATE
  ON ROUTE_ALLOCATION_FLOAT_DRIVERS(REGION,START_DATE,END_DATE,ACTIVE);
