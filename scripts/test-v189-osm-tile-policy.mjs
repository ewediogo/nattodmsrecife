import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
assert.equal(pkg.version,'1.0.158');
const headers=fs.readFileSync(new URL('../public/_headers',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');

assert.match(headers,/Referrer-Policy:\s*strict-origin-when-cross-origin/i,'_headers deve permitir Referer de origem em HTTPS cross-origin');
assert.match(headers,/img-src[^;]*https:\/\/tile\.openstreetmap\.org/i,'CSP deve autorizar domínio raiz do tile OSM');
assert.match(html,/<meta\s+name="referrer"\s+content="strict-origin-when-cross-origin"/i,'HTML deve reforçar política de referrer');
assert.match(route,/https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/,'mapa deve usar endpoint oficial sem subdomínio rotativo');
assert.doesNotMatch(route,/https:\/\/\{s\}\.tile\.openstreetmap\.org/,'endpoint antigo com {s} não deve permanecer no frontend');
assert.match(route,/openstreetmap\.org\/copyright/,'atribuição deve apontar para copyright do OpenStreetMap');
assert.match(html,/dms-rota-v1141-login-sessao-20260924/,'index deve forçar nova revisão dos assets para evitar cache da versão antiga');
console.log('v1.0.89 OpenStreetMap tile policy: ok');
