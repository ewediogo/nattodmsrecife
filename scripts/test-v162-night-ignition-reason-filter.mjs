import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const routeJs=await readFile(new URL('../public/assets/route.js',import.meta.url),'utf8');
const departureJs=await readFile(new URL('../functions/_lib/departure.js',import.meta.url),'utf8');
const pendingJs=await readFile(new URL('../functions/_lib/operational-pending.js',import.meta.url),'utf8');
const gpsJs=await readFile(new URL('../functions/api/protectsat.js',import.meta.url),'utf8');

assert.match(routeJs,/indicatorFilterSelect\(`\$\{prefix\}-reason`,'Motivo'/,'Indicadores de Saída deve renderizar filtro Motivo');
assert.match(routeJs,/readIndicatorFilterPanel\('route-dep-ind-filter',false,true,true\)/,'Indicadores de Saída deve ler filtro de motivo');
assert.match(departureJs,/reasons:\[\.\.\.new Set\(joinedAll\.map\(\(\{departure\}\)=>clean\(departure\?\.motivo_atraso\)\)/,'API deve expor opções de motivo');
assert.match(departureJs,/reasonFilter=normalizeText\(filters\.reason\|\|filters\.motivo\|\|filters\.motivo_atraso/,'API deve aceitar motivo no filtro');
assert.match(departureJs,/normalizeText\(departure\?\.motivo_atraso\|\|''\)!==reasonFilter/,'API deve filtrar pelo motivo selecionado');

assert.match(gpsJs,/syncNightIgnitionOccurrence/,'GPS deve sincronizar uma ocorrência noturna consolidada');
assert.match(gpsJs,/Tempo total desligada:/,'ocorrência noturna deve informar o tempo total consolidado');
assert.match(pendingJs,/consolidateNightIgnitionRows/,'Pendências deve consolidar sessões noturnas');
assert.match(pendingJs,/intervalCount:sessions\.length/,'consolidação deve preservar quantidade de intervalos');
assert.match(pendingJs,/TYPE<>'IGNICAO_DESLIGADA_20_05'/,'Pendências deve ignorar ocorrências antigas fragmentadas e reconstruir a visão consolidada');

console.log('v1.0.62 night ignition consolidation + departure reason filter: ok');
