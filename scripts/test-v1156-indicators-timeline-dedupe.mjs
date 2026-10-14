import fs from 'node:fs';
import assert from 'node:assert/strict';

const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const route=read('public/assets/route.js');
const index=read('public/index.html');
const lincros=read('functions/api/lincros.js');
const protectsat=read('functions/api/protectsat.js');
const timeline=read('functions/api/trip-timeline.js');
const migration=read('migrations/0041_route_client_arrivals_dedupe.sql');

const indicatorStart=route.indexOf('async function renderIndicators');
const indicatorEnd=route.indexOf('let routeLocationMap',indicatorStart);
assert(indicatorStart>=0&&indicatorEnd>indicatorStart,'Não foi possível isolar renderIndicators.');
const indicatorBlock=route.slice(indicatorStart,indicatorEnd);
for(const label of ['Custo planejado','Custo realizado','R$/kg planejado','R$/kg realizado']){
  assert(!indicatorBlock.includes(`metric('${label}'`),`A aba Indicadores ainda renderiza o card ${label}.`);
}
assert(index.includes('dms-rota-v1156-indicadores-historico-20261006'),'Assets precisam de revisão nova para evitar JS antigo em cache.');
assert(!lincros.includes('Math.abs(liMs-psMs)>threshold'),'Fallback Lincros não pode aceitar posição antiga só pela diferença absoluta.');
assert(lincros.includes('return liMs-psMs>threshold'),'Lincros deve ser fallback apenas quando estiver mais novo que ProtectSat pela tolerância.');
assert(protectsat.includes('ignoredOutOfOrder'),'Histórico de cliente deve rastrear e ignorar posições fora de ordem.');
assert(protectsat.includes('if(latestAt&&gpsAt<latestAt)'),'Posição anterior ao último marco não pode reabrir cliente.');
assert(timeline.includes('dedupeTimelineEvents'),'Timeline deve consolidar duplicidades históricas antes de responder.');
assert(timeline.includes("normalizeText(event.label||'CLIENTE')"),'Deduplicação deve considerar o cliente exibido.');
assert(migration.includes('IDX_ROUTE_CLIENT_ARRIVAL_EVENT'),'Migration deve impedir evento idêntico de ser gravado novamente.');

console.log('OK v1.0.156 - cards de custo fora de Indicadores e histórico de cliente protegido contra repetição/stale Lincros.');
