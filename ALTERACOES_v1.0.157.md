# DMS Rota — 1.0.157 — Correção cirúrgica de Controle de Saída

## Bug 1 — identidade e transferência às 15h
- **Causa raiz:** `functions/_lib/departure.js` gravava `sequencia=0` e gerava chave `SQ|data|0`; o matcher aceitava a colisão. `schedule.js` ainda considerava sequência 0 na trava, no score e no contador de duplicidade.
- **Correção:** IDs prevalecem; fallback apenas para saída sem vínculo por ID e com um único candidato; sequência de migração usa próxima sequência numérica livre (reexecução reaproveita sequência). `public/assets/route.js` espelha o filtro.
- **Validar:** três escalas migradas; alterar somente uma e comparar ID/equipe/horário/status das demais. Executar SELECT 0042 antes de decidir pelo reparo 0043 no D1. Aplicar reparo em janela sem gravadores concorrentes e com backup.

## Bug 2 — disponibilidade
- **Causa raiz:** `listScheduleCrewOptions` usava só cadastro, sem escalas/monitoramento; férias por cadastro e eventos poderiam divergir.
- **Correção:** usa o contexto operacional e decoração de ocupação do planejamento, incluindo `rota_atual`, `escala_atual_id` e `motivo_indisponibilidade`. UI bloqueia condições duras.
- **Validar:** férias, pernoite sem retorno e pessoa livre; verificar rótulo e tentativa de salvar. Comparar seleções com status real de saída.

## Bug 3 — ajudante escalado
- **Causa raiz:** tratamento de ajudante de rota transformava `ESCALADO` em `DISPONÍVEL` e ocultava alocações programadas.
- **Correção:** prioriza ESCALADO, mantém apoio identificado apenas para EM ROTA; bloqueios cadastrais precedem o apoio; domingo conserva exceção operacional.
- **Validar:** ajudante em escala programada, em rota e de férias; comparar Escala, Saída e Visão Geral. Conferir manualmente os totais na Central de Recursos.

## Riscos remanescentes
- A regra de horário sobreposto depende da semântica já implementada de `resourceConflict`/`scheduleWindow` na validação. A indisponibilidade do seletor é conservadora e pode bloquear uma escolha que seria possível após liberar a viagem.
- Corridas de transferências em workers concorrentes podem exigir serialização por data antes de garantir unicidade global de sequências. O fluxo cron atual migra sequencialmente.
- A versão compacta original não contém os docs obrigatórios do `check-project.mjs`; a lista de arquivos exigidos foi adaptada a esse pacote.
- A paridade exata dos contadores entre telas requer validação integrada com D1; não foi inferida a partir de testes textuais.
- Não foram adicionados logs, arquivos README ou pastas docs.
