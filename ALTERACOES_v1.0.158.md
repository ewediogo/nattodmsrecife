# DMS Rota — 1.0.158 — Correções de implantação da 1.0.157

Mantém todas as correções da 1.0.157 (ver ALTERACOES_v1.0.157.md) e corrige o que
impedia a versão de funcionar corretamente no Cloudflare/GitHub.

## 1. Reparo da transferência das 15h saiu de `migrations/`
- **Problema:** `0042` (diagnóstico) e `0043` (reparo manual) estavam em `migrations/`.
  O `wrangler d1 migrations apply` executaria o reparo sem revisão, e o 0043 falha no D1
  (`not authorized: SQLITE_AUTH`, por usar `BEGIN TRANSACTION` e tabela `TEMP`),
  travando todas as migrations seguintes.
- **Correção:** movidos para `scripts/sql/manual/`. O reparo foi reescrito sem
  `BEGIN/COMMIT` e sem `TEMP` (tabela de trabalho comum, removida ao final), com a
  mesma lógica. Validado no D1 local (wrangler 4.137.0): corrige sequência 0/duplicada,
  é idempotente e o diagnóstico volta com zero linhas.
- **Se o `migrations apply` já foi executado e falhou no 0043:** basta publicar esta
  versão; o arquivo não existe mais em `migrations/` e a fila volta a andar.

## 2. Worker de cron passa a ser publicado
- **Problema:** a transferência das 15h roda no Worker `workers/protectsat-cron`, que a
  integração GitHub → Pages não publica. Sem deploy próprio ele seguia com o código antigo
  (sequência 0).
- **Correção:** `npm run deploy:cron` e workflow `.github/workflows/deploy-cron.yml`
  (roda build, check e testes a cada push na `main` e publica o cron se os secrets
  `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` existirem; sem eles, só avisa).

## 3. Ajudante de rota ESCALADO — mesma regra em todas as telas
- Backend e editor da Escala já permitiam escalar o ajudante de rota em outro veículo,
  exibindo "ESCALADO EM <rota>". O seletor do Controle de Saída bloqueava. Agora o
  seletor da Saída também permite, mantendo o rótulo. Demais colaboradores ESCALADO
  continuam bloqueados na Saída.
- A Central de Recursos continua mostrando ocupação operacional (DISPONÍVEL até a saída,
  com o selo ESCALADO calculado na tela) — comportamento já existente e coerente.

## 4. Testes
- `smoke-test.mjs`: atualizado para a regra da 1.0.157 (ESCALADO visível, sem apoio) e
  corrigida a dependência do calendário (fixtures de GPS de ago/2026 expiravam na janela
  de 45 dias e o `npm test` falhava desde outubro).
- `npm test` agora inclui v1157, v1158, v1159 e o novo v1160 (segurança de implantação).
- Removido `test-v193` (obsoleto; contradizia o v194/OpenFreeMap).

## 5. Versão e dependências
- Versão unificada 1.0.158 (`package.json`, header `X-Natto-Dms-Version`, Lincros, `sw.js`)
  e nova revisão de cache dos assets no `index.html`.
- MapLibre fixado em `maplibre-gl@5.24.0` e `@maplibre/maplibre-gl-leaflet@0.1.4`
  (as mesmas versões que já eram carregadas, agora sem atualização automática).

## Ordem de implantação
1. Commit/push na `main` (Pages publica o site).
2. `npm run deploy:cron` (ou deixar o workflow publicar, com os secrets configurados).
3. `npm run d1:migrate` — não há migration nova nesta versão; confirma a fila limpa.
4. Se houver escalas transferidas com sequência 0 **hoje**: `npm run d1:diagnostico-transferencia`,
   revisar, fazer backup, `npm run d1:reparo-transferencia` e rodar o diagnóstico de novo.
