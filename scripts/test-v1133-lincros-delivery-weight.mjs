import assert from 'node:assert/strict';
import fs from 'node:fs';

const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const lincros=fs.readFileSync(new URL('../functions/_lib/lincros.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));

assert.equal(pkg.version,'1.0.158');
assert(lincros.includes('row.PesoEntregue??row.pesoEntregue'),'Integração deve capturar PesoEntregue da Lincros.');
assert(lincros.includes('row.PesoDevolvido??row.pesoDevolvido'),'Integração deve capturar PesoDevolvido da Lincros.');
assert(lincros.includes('WEIGHT_PLANNED REAL,WEIGHT_DELIVERED REAL,WEIGHT_RETURNED REAL'),'Cache D1 deve manter os pesos por entrega.');
assert(route.includes('lincrosWeightText(item.weightDelivered)'),'Detalhe deve exibir peso entregue por cliente.');
assert(route.includes('lincrosWeightText(item.weightReturned)'),'Detalhe deve exibir peso devolvido por cliente.');
assert(route.includes('Peso entregue · Lincros'),'Detalhe deve consolidar o peso entregue da viagem.');
assert(route.includes('Peso devolvido · Lincros'),'Detalhe deve consolidar o peso devolvido da viagem.');
assert(route.includes('<th>Peso previsto</th><th>Peso entregue</th><th>Peso devolvido</th>'),'Tabela de entregas deve manter os pesos realizados e acrescentar o previsto.');
assert(index.includes('route.js?rev=dms-rota-v1141-login-sessao-20260924'),'Frontend deve usar cache-busting da v1.0.135.');
console.log('OK v1.0.135 - pesos da Lincros exibidos no detalhamento da viagem.');
