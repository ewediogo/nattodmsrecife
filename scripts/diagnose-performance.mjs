import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory()){if(e.name==='server')continue;out.push(...await walk(p));}else out.push(p);}return out;}
const files=(await walk(join(root,'functions'))).filter((f)=>f.endsWith('.js'));
const findings=[];
const rules=[
  {id:'date-function',severity:'HIGH',regex:/SUBSTR\s*\(\s*CAST\s*\([^\n]*DATE|COALESCE\s*\(\s*DATE_KEY/gi,why:'Função na coluna de data pode impedir uso de índice no D1.'},
  {id:'very-high-limit',severity:'MEDIUM',regex:/LIMIT\s+(?:50000|10000)|limit\s*:\s*10000/gi,why:'Limite muito alto pode aumentar CPU, rows_read e payload.'},
  {id:'count-star',severity:'LOW',regex:/COUNT\s*\(\s*\*\s*\)/gi,why:'COUNT(*) em tabelas grandes é inadequado para carregamento de tela.'},
];
for(const file of files){const text=await readFile(file,'utf8');for(const rule of rules){for(const match of text.matchAll(rule.regex)){const line=text.slice(0,match.index).split('\n').length;findings.push({file:relative(root,file),line,rule:rule.id,severity:rule.severity,why:rule.why,sample:String(match[0]).slice(0,100)});}}}
const high=findings.filter((f)=>f.severity==='HIGH');
const report=`# Diagnóstico global de desempenho / HTTP 503 — 24/08/2026

## Escopo
Revisão estática das consultas e endpoints que alimentam todas as abas do DMS ROTA. O diagnóstico em produção também está disponível em \`/api/diagnostics\`, sem varreduras completas de tabela.

## Causa principal encontrada
As consultas históricas da Escala e da Central de Recursos aplicavam funções como \`SUBSTR(CAST(...))\` e \`COALESCE(DATE_KEY,'')\` diretamente nas colunas usadas no filtro de data. Em SQLite/D1 isso pode impedir o uso dos índices e provocar varredura de histórico em telas que consolidam Escala → Saída → Monitoramento → Retorno. Quanto maior o histórico, maior a chance de exceder o tempo do Worker e resultar em HTTP 503.

## Correções aplicadas
- filtros de data reescritos como intervalos indexáveis (\`>= início\` e \`< dia seguinte\`);
- índices compostos para Monitoramento, Saídas, Retornos, eventos de recursos, retenções GPS, ocorrências e CAJU;
- CAJU com cache curto e sem leituras duplicadas desnecessárias;
- Premiação deixa de calcular ocorrências quando essa informação não é usada;
- endpoints pesados não são repetidos automaticamente após 503, evitando ampliar a sobrecarga;
- último dado válido por aba é mantido em sessionStorage para contingência;
- cada resposta API passa a expor \`X-Natto-Request-Id\`, \`X-Natto-Api-Ms\` e \`Server-Timing\`;
- endpoint leve \`/api/diagnostics\` verifica D1, índices críticos e planos de consulta.

## Abas auditadas
Visão Geral; Resumo; Escala; Controle de Saída; Indicadores de Saída; Monitoramento; Última Localização; Retornos; Central de Recursos; Indicadores; Dados Gerenciais; Premiação; CAJU; Pendências Operacionais; Cadastros/Configurações.

## Resultado da varredura estática após correções
- Achados HIGH remanescentes: **${high.length}**
- Achados MEDIUM/LOW remanescentes: **${findings.length-high.length}** (alguns limites altos continuam em rotinas pontuais/legadas, mas não representam automaticamente um problema quando há filtro indexado).

${findings.length?`### Pontos ainda monitorados\n${findings.slice(0,30).map((f)=>`- ${f.severity} — \`${f.file}:${f.line}\` — ${f.rule}: ${f.why}`).join('\n')}`:'Nenhum padrão de risco encontrado.'}

## Validação em produção
Após publicar e aplicar todas as migrations pendentes, incluindo \`0024_global_performance_gps_departure.sql\`, consultar \`/api/diagnostics\`. O status esperado é \`OK\`, sem índices críticos ausentes e com os planos de Escala/Saída/Monitoramento/Retorno usando índices.
`;
await writeFile(join(root,'docs/DIAGNOSTICO_GLOBAL_HTTP503_2026-08-24.md'),report);
console.log(JSON.stringify({filesScanned:files.length,findings:findings.length,high:high.length,report:'docs/DIAGNOSTICO_GLOBAL_HTTP503_2026-08-24.md'},null,2));
