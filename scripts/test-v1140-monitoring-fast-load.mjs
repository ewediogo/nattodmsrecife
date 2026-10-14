import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const route=await readFile(new URL('../public/assets/route.js',import.meta.url),'utf8');
const monitoring=await readFile(new URL('../functions/_lib/monitoring.js',import.meta.url),'utf8');
const index=await readFile(new URL('../public/index.html',import.meta.url),'utf8');

assert.equal(pkg.version,'1.0.158');
assert(route.includes("/api/monitoring?operational=1&recentDays=3&lite=1"),'Monitoramento deve carregar a base operacional pelo modo leve.');
assert(route.includes('timeoutMs:30000,maxAttempts:1'),'Carga inicial do Monitoramento deve tolerar D1 mais lento sem repetir consulta pesada.');
assert(monitoring.includes("if(lite)return enrichMonitoringVehicles(db,forecasted);"),'Backend deve evitar enriquecimento Lincros/espacial duplicado no modo lite.');
assert(route.includes('monitoringTripNearbyClients'),'Proximidade deve ser recomposta no cliente usando as entregas da viagem.');
assert(route.includes('records=records.map(attachMonitoringTripNearbyClients);'),'Clientes próximos devem ser anexados após a melhor posição GPS/Lincros ser definida.');
assert(index.includes('dms-rota-v1141-login-sessao-20260924'),'Assets precisam invalidar cache para a revisão 1.0.141.');
console.log('OK v1.0.141 - Monitoramento usa carga leve e proximidade restrita aos clientes da viagem.');
