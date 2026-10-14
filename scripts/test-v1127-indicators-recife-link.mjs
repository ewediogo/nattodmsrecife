import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const route=await readFile(new URL('../public/assets/route.js',import.meta.url),'utf8');
const index=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));

assert.equal(pkg.version,'1.0.158');
assert(route.includes('id="route-ind-recife"'),'A aba Indicadores deve possuir o botão do Portal de Roteirização - Recife.');
assert(route.includes('href="https://roteirizacao-recife.roteirizacao-natto-recife.workers.dev/"'),'O botão deve apontar para o Portal de Roteirização - Recife informado.');
assert(route.includes('target="_blank" rel="noopener noreferrer"'),'O portal externo deve abrir em nova aba com proteção de opener/referrer.');
assert(route.includes('↗ Roteirização Recife'),'O botão deve ter identificação clara.');
assert(index.includes('route.js?rev=dms-rota-v1141-login-sessao-20260924'),'Cache-busting do route.js deve refletir a v1.0.128.');
console.log('OK v1.0.128 - botão do Portal de Roteirização - Recife na aba Indicadores.');
