import assert from 'node:assert/strict';
import fs from 'node:fs';

const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));

assert.equal(pkg.version,'1.0.158');
assert(route.includes('data-monitor-detail-ocs'),'Detalhamento do Monitoramento deve exibir as OCs.');
assert(route.includes('monitoringOcsText'),'Detalhamento deve aceitar OCs/carga em formatos antigos e novos.');
assert(route.includes('scheduleOcs=monitoringOcsText(payload.schedule||{})'),'OC deve ser atualizada pelo vínculo da escala ao sincronizar a Lincros.');
assert(index.includes('route.js?rev=dms-rota-v1141-login-sessao-20260924'),'Cache-busting do route.js deve refletir a versão corrente sem perder o ajuste de OCs.');
console.log('OK v1.0.126 - OCs exibidas no detalhamento da viagem do Monitoramento.');
