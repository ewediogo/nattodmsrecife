import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');

assert.equal(pkg.version,'1.0.158');
assert.match(html,/dms-rota-v1141-login-sessao-20260924/);
assert.match(ui,/async function printSummaryRoutes\(rows=\[\],pendingRows=\[\]\)/);
assert.match(ui,/canvas\.width=W;canvas\.height=H/);
assert.match(ui,/3508,?H=2480|W=3508,H=2480/);
assert.match(ui,/VEÍCULOS EM ROTA/);
assert.match(ui,/PENDENTES DE SAÍDA/);
assert.match(ui,/Imagem única A4 paisagem/);
assert.match(ui,/Imprimir \/ Salvar PDF/);
assert.match(ui,/Baixar PNG/);
assert.match(ui,/route-summary-print-table">▣ Gerar imagem \/ imprimir/);
assert.match(ui,/button\.textContent='Gerando imagem\.\.\.'/);
assert.doesNotMatch(ui,/printZoom=totalRows<=36\?1/);

console.log('OK: v1.0.72 gera quadro operacional como imagem única A4, com preview, impressão e PNG.');
