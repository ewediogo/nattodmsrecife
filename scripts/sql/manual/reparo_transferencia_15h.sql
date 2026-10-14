-- REPARO MANUAL (não é migration: NÃO colocar em migrations/).
-- Executar APENAS depois de revisar o resultado de diagnostico_transferencia_15h.sql:
--   npx wrangler d1 execute nattodms-recife-rotadb --remote --file=scripts/sql/manual/reparo_transferencia_15h.sql
-- Em seguida, rodar o diagnóstico de novo: o esperado é ZERO linhas.
--
-- Corrige somente escalas transferidas (TRANSFERIDA_DA_ESCALA) do dia corrente
-- (America/Recife) com sequência 0/vazia ou duplicada, atribuindo a próxima
-- sequência numérica livre do dia. Não exclui registros. Idempotente.
-- Rodar em horário sem programação concorrente e com backup/Time Travel do D1.
--
-- Compatível com D1: sem BEGIN/COMMIT (o D1 controla a transação) e sem
-- tabela TEMP; usa uma tabela de trabalho comum que é removida ao final.

DROP TABLE IF EXISTS _REPARO_TRANSFER_SEQ;

CREATE TABLE _REPARO_TRANSFER_SEQ AS
WITH allrows AS (
 SELECT 'ESCALAS_DIA' fonte, CAST(ID AS TEXT) id, DATA data, TRIM(COALESCE(SEQUENCIA_CARREGAMENTO,'')) seq, OBSERVACOES notes FROM ESCALAS_DIA
 UNION ALL
 SELECT 'ROUTE_RECORDS',CAST(ID AS TEXT),DATE_KEY,TRIM(COALESCE(json_extract(DATA_JSON,'$.sequencia'),'')),json_extract(DATA_JSON,'$.observacoes')
 FROM ROUTE_RECORDS WHERE MODULE='schedule'
), occupied AS (
 SELECT data,MAX(CASE WHEN seq<>'' AND seq<>'0' AND seq NOT GLOB '*[^0-9]*' THEN CAST(seq AS INTEGER) ELSE 0 END) last_seq
 FROM allrows GROUP BY data
), candidates AS (
 SELECT a.*,COUNT(*) OVER(PARTITION BY a.data,a.seq) count_seq
 FROM allrows a WHERE a.data=date('now','-3 hours')
), needs AS (
 SELECT c.*,ROW_NUMBER() OVER (PARTITION BY c.data ORDER BY c.fonte,c.id) rn FROM candidates c
 WHERE instr(COALESCE(c.notes,''),'TRANSFERIDA_DA_ESCALA')>0 AND (c.seq IN ('','0') OR c.count_seq>1)
)
SELECT n.fonte,n.id,n.data,CAST(o.last_seq+n.rn AS TEXT) new_seq FROM needs n JOIN occupied o ON o.data=n.data;

UPDATE ESCALAS_DIA SET SEQUENCIA_CARREGAMENTO=(SELECT new_seq FROM _REPARO_TRANSFER_SEQ WHERE fonte='ESCALAS_DIA' AND id=CAST(ESCALAS_DIA.ID AS TEXT))
WHERE CAST(ID AS TEXT) IN (SELECT id FROM _REPARO_TRANSFER_SEQ WHERE fonte='ESCALAS_DIA');

UPDATE ROUTE_RECORDS SET DATA_JSON=json_set(DATA_JSON,'$.sequencia',(SELECT new_seq FROM _REPARO_TRANSFER_SEQ WHERE fonte='ROUTE_RECORDS' AND id=CAST(ROUTE_RECORDS.ID AS TEXT)))
WHERE MODULE='schedule' AND CAST(ID AS TEXT) IN (SELECT id FROM _REPARO_TRANSFER_SEQ WHERE fonte='ROUTE_RECORDS');

DROP TABLE _REPARO_TRANSFER_SEQ;
