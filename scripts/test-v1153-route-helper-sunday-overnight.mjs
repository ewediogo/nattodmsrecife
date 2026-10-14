import assert from 'node:assert/strict';
import fs from 'node:fs';

const api=fs.readFileSync(new URL('../functions/_lib/schedule.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');

assert.match(api,/if\(normalizeText\(operational\)==='PERNOITE'\)return isSundayDate\(selected\)\?'DISPONÍVEL':'PERNOITE'/,'catálogo deve liberar pernoite de ajudante de rota no domingo');
assert.match(api,/const routeHelperSunday=type==='AJUDANTE'&&item\.ajudante_rota&&isSundayDate\(selected\)/,'editor deve identificar ajudante de rota no domingo');
assert.match(api,/routeHelperSunday\?allocations\.find\(entry=>entry\.status==='ESCALADO'\)\|\|null/,'editor deve ignorar alocação PERNOITE do ajudante de rota no domingo');
assert.match(api,/const routeHelperSunday = routeHelper && isSundayDate\(schedule\.data\)/,'validação deve aplicar exceção de domingo');
assert.match(api,/if\(routeHelper&&!routeHelperSunday\)\{/,'PERNOITE só deve bloquear ajudante de rota fora do domingo');
assert.match(api,/if\(employee\.ajudante_rota&&isSundayDate\(day\)\)return;/,'domingo não deve contar como dia trabalhado do ajudante de rota');
assert.match(ui,/scheduleRouteHelperSundayIgnoresOvernight/,'interface deve conhecer a exceção de domingo');
assert.match(ui,/schedulePersonIsOvernight\(item\)&&!scheduleRouteHelperSundayIgnoresOvernight\(item\)/,'interface não deve desabilitar ajudante de rota em pernoite no domingo');

console.log('OK: pernoite de ajudante de rota não bloqueia a Escala de domingo e domingo não conta como dia trabalhado.');
