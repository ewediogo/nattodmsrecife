import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const monitoring=fs.readFileSync(new URL('../functions/_lib/monitoring.js',import.meta.url),'utf8');

assert.equal(pkg.version,'1.0.158');
assert.match(html,/dms-rota-v1141-login-sessao-20260924/);
assert.match(monitoring,/pendingSource=await pendingMonitoringFromSchedules/);
assert.match(monitoring,/pendingRows:pendingDetail/);
assert.match(monitoring,/pendingDepartures:pendingDetail\.length/);
assert.match(ui,/async function printSummaryRoutes\(rows=\[\],pendingRows=\[\]\)/);
assert.match(ui,/PENDENTES DE SAÍDA/);
assert.match(ui,/Imagem única A4 paisagem/);
assert.match(ui,/printSummaryRoutes\(rows,pendingRows\)/);
assert.match(ui,/route-summary-print-table">▣ Gerar imagem \/ imprimir/);
assert.match(ui,/canvas\.width=W;canvas\.height=H/);

console.log('OK: v1.0.72 mantém veículos em rota e pendentes separados no quadro operacional.');
