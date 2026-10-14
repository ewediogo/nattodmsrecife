import fs from 'node:fs';

const route = fs.readFileSync(new URL('../public/assets/route.js', import.meta.url), 'utf8');
const headers = fs.readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
assert(route.includes("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"), 'Mapa não voltou ao endpoint OSM anterior.');
assert(route.includes("maxZoom:19"), 'Camada de mapa precisa manter maxZoom:19.');
assert(!route.includes('openfreemap'), 'Configuração OpenFreeMap não deve permanecer.');
assert(headers.includes('Referrer-Policy: same-origin'), 'Referrer-Policy precisa voltar ao estado anterior.');
assert(headers.includes('https://*.tile.openstreetmap.org'), 'CSP precisa permitir os tiles OSM anteriores.');
assert(!index.includes('meta name="referrer"'), 'Meta referrer adicionada na alteração da VPN deve ser removida.');
assert(route.includes("scheduleAutoObservationParts"), 'Automação de observações da Escala deve ser preservada.');
assert(route.includes("networkRoute&&Number.isFinite(temp)"), 'Baixar divisória deve continuar somente para Redes.');
console.log('OK v1.0.93: mapa restaurado ao estado pré-VPN e melhorias posteriores preservadas.');
