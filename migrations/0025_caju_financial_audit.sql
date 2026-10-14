-- CAJU v2: cálculo financeiro automático, regras configuráveis e valor manual auditável.
INSERT OR IGNORE INTO CONFIGURACOES (CHAVE,VALOR,TIPO,DESCRICAO) VALUES
 ('CAJU_VALOR_DIARIA','50','INTEGER','Valor padrão diário do CAJU em reais.'),
 ('CAJU_VALOR_CE_MA','70','INTEGER','Valor diário especial para rotas CE/MA em reais.'),
 ('CAJU_FERIAS_SAIDA','400','INTEGER','Ajuste financeiro aplicado na saída para férias.'),
 ('CAJU_FERIAS_RETORNO','1200','INTEGER','Ajuste financeiro aplicado no retorno de férias.'),
 ('CAJU_TETO_30_DIAS','1500','INTEGER','Referência de teto do CAJU em ciclo de 30 dias.'),
 ('CAJU_TETO_31_DIAS','1550','INTEGER','Referência de teto do CAJU em ciclo de 31 dias.'),
 ('CAJU_ROTAS_VALOR_ESPECIAL','CE|CEARÁ|MA|MARANHÃO|BALSAS','TEXT','Palavras-chave de rotas/regiões com valor especial, separadas por |.');

-- A coluna MANUAL_VALUE_CENTS é criada de forma idempotente pelo schema guard da API CAJU.
-- Isso mantém compatibilidade com bancos existentes que podem receber o deploy antes da migration.
CREATE INDEX IF NOT EXISTS IDX_ROUTE_CAJU_MANUAL_DATE_EMPLOYEE ON ROUTE_CAJU_MANUAL(DATE_KEY,EMPLOYEE_ID);
