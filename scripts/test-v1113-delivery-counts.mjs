import fs from 'node:fs';
const assert=(c,m)=>{if(!c)throw new Error(m);};
const indicators=fs.readFileSync(new URL('../functions/_lib/indicators.js',import.meta.url),'utf8');
const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
assert(indicators.includes('lincros_deliveries_routed')&&indicators.includes('lincros_deliveries_pointed')&&indicators.includes('lincros_delivery_percent'),'Campos por viagem de entregas Lincros ausentes.');
assert(indicators.includes('routedDeliveries')&&indicators.includes('pointedDeliveries')&&indicators.includes('deliveryCompletionPercent'),'Resumo de entregas roteirizadas/apontadas ausente.');
assert(route.includes("metric('Entregas roteirizadas'")&&route.includes("metric('Entregas apontadas'")&&route.includes("metric('% de entrega'"),'Cards de entregas na aba Indicadores ausentes.');
assert(route.includes('Apontadas ÷ roteirizadas'),'Fórmula/legenda do percentual de entrega ausente.');
console.log('OK v1.0.126: entregas roteirizadas, apontadas e percentual na aba Indicadores validados.');
