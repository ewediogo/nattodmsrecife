# NATTO DMS — Notaro Alimentos LTDA. - RECIFE/PE

Base: DMS Rota - Belo Jardim 1.0.158. Unidade: Avenida da Recuperação, Km 56,2, S/N - Guabiraba, Recife - PE, 52291-800.
Operação 100% terceirizada: saída, retorno e posição vêm principalmente dos apontamentos do Lincros.

## O que mudou em relação a Belo Jardim
- Marca, título, menu lateral e rodapé: Recife/PE.
- Geofence de saída/retorno: `NOTARO ALIMENTOS LTDA. - RECIFE/PE` e `NOTARO ALIMENTOS - RECIFE/PE`
  (`wrangler.toml` e `workers/protectsat-cron/wrangler.toml`). **Confirmar o nome exato do ponto/cerca no Lincros.**
- Projeto Pages `nattodms-recife`, Worker de cron `natto-dms-recife-protectsat-cron`, banco D1 `nattodms-recife-rotadb`.
- Telas removidas: Plano de Alocação, Folgas, Premiação, CAJU, CAJU - Carreteiros e Central de Recursos
  (menu, telas, endpoints, parâmetros CAJU e testes correspondentes).
- Mantidos internamente (sem tela): `/api/resources` (fallback dos Indicadores de Saída) e as bibliotecas
  usadas pela Escala. As tabelas dos módulos removidos continuam nas migrations, vazias e inertes.

## Antes do primeiro deploy
1. `npx wrangler@4.137.0 d1 create nattodms-recife-rotadb` e colocar o `database_id` no lugar de
   `COLE-AQUI-O-ID-DO-D1-nattodms-recife-rotadb` nos dois `wrangler.toml`. (Nunca reutilizar o D1 de Belo Jardim.)
2. Criar o projeto Pages `nattodms-recife` apontando para este repositório (build output `public`).
3. Secrets no Pages e no Worker de cron: `LINCROS_API_KEY`, `LINCROS_WS_USER`, `LINCROS_WS_PASSWORD`,
   `DMS_ROTA_APP_SECRET` e, se usar, `PROTECTSAT_CHAVE`.
4. `npm run d1:migrate`, depois `npm run deploy:cron`; no GitHub, secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.
5. Importar cadastros (colaboradores, veículos, rotas, clientes) de Recife.
