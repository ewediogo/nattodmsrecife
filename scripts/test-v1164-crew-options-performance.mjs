import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../functions/_lib/schedule.js',import.meta.url),'utf8');
// Controle de Saída estourava o tempo (≈30 s com ~800 pessoas e ~2.600 escalas) porque
// cada colaborador reparseava JSON e reconstruía objetos para cada escala/monitoramento.
assert(src.includes('context.__operationalCache'),'resultado operacional por escala deve ser cacheado');
assert(src.includes('function operationalCrewIndex('),'equipe por escala deve ser indexada uma vez');
assert(src.includes('const monitoringRowCache=new WeakMap()'),'JSON de monitoramento deve ser parseado uma vez por linha');
assert(src.includes('function monitoringRowIndex('),'ids/nomes do monitoramento devem ser indexados uma vez');
console.log('OK v1164 - lista de equipe da Saída usa caches por escala/monitoramento (sem reparse por colaborador).');
