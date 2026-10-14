-- Diagnóstico SOMENTE LEITURA (não é migration: NÃO colocar em migrations/).
-- Escopo: dia corrente em America/Recife. Executar antes e depois do reparo:
--   npx wrangler d1 execute db-recife --remote --file=scripts/sql/manual/diagnostico_transferencia_15h.sql
-- Depois do reparo, o resultado esperado é ZERO linhas. Não exclui nem altera dados.
WITH escalas AS (
 SELECT 'ESCALAS_DIA' fonte, ID id, DATA data, SEQUENCIA_CARREGAMENTO sequencia, ROTA rota, PLACA placa, OBSERVACOES observacoes FROM ESCALAS_DIA
 UNION ALL
 SELECT 'ROUTE_RECORDS' fonte, CAST(ID AS TEXT) id, DATE_KEY data, json_extract(DATA_JSON,'$.sequencia') sequencia,
 json_extract(DATA_JSON,'$.rota') rota, json_extract(DATA_JSON,'$.placa') placa, json_extract(DATA_JSON,'$.observacoes') observacoes
 FROM ROUTE_RECORDS WHERE MODULE='schedule'
), dup AS (
 SELECT data, TRIM(COALESCE(sequencia,'')) seq, COUNT(*) total FROM escalas WHERE data=date('now','-3 hours')
 AND TRIM(COALESCE(sequencia,''))<>'' GROUP BY data,TRIM(COALESCE(sequencia,''))
)
SELECT e.*,COALESCE(d.total,0) total_mesma_sequencia FROM escalas e LEFT JOIN dup d ON d.data=e.data AND d.seq=TRIM(COALESCE(e.sequencia,''))
WHERE e.data=date('now','-3 hours') AND instr(COALESCE(e.observacoes,''),'TRANSFERIDA_DA_ESCALA')>0
 AND (TRIM(COALESCE(e.sequencia,'')) IN ('','0') OR COALESCE(d.total,0)>1)
ORDER BY e.fonte,e.id;
