import fs from 'node:fs';
import assert from 'node:assert/strict';
const lib=fs.readFileSync(new URL('../functions/_lib/lincros.js',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../functions/api/lincros.js',import.meta.url),'utf8');
assert(lib.includes('COUNT(DISTINCT COALESCE(NULLIF(TRIM(SCHEDULE_ID)'), 'Contagem de rotas DMS deve usar SCHEDULE_ID distinto.');
assert(lib.includes("PLATE_DATE_SINGLE_DMS_ROUTE"), 'Deve preservar consolidação de múltiplos CdRotaNegocio quando houver uma única rota DMS.');
assert(api.includes('aggregate:{planned:routes.reduce'), 'Diagnóstico deve somar todas as rotas Lincros da placa/data.');
console.log('OK v1.0.126 - consolidação Lincros multi-rota');
