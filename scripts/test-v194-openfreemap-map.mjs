import fs from 'node:fs';

const route = fs.readFileSync(new URL('../public/assets/route.js', import.meta.url), 'utf8');
const headers = fs.readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
assert(route.includes('minZoom:4,maxZoom:19'), 'O Leaflet deve ter maxZoom explícito para o MarkerCluster.');
assert(route.includes("https://tiles.openfreemap.org/styles/liberty"), 'OpenFreeMap Liberty precisa ser o mapa principal.');
assert(route.includes("typeof L.maplibreGL==='function'"), 'Integração Leaflet/MapLibre ausente.');
assert(route.includes("https://tile.openstreetmap.org/{z}/{x}/{y}.png"), 'Fallback OSM deve usar o endpoint oficial atual.');
assert(!route.includes("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"), 'Endpoint OSM legado com subdomínios não deve permanecer.');
assert(index.includes('maplibre-gl@5.24.0/dist/maplibre-gl.js'), 'MapLibre JS não foi incluído.');
assert(index.includes('@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js'), 'Binding Leaflet/MapLibre não foi incluído.');
assert(headers.includes('https://tiles.openfreemap.org'), 'CSP não permite OpenFreeMap.');
assert(headers.includes("worker-src 'self' blob:"), 'CSP precisa permitir Web Worker do MapLibre.');
assert(headers.includes('Referrer-Policy: strict-origin-when-cross-origin'), 'Referrer-Policy deve permitir recursos HTTPS externos de forma segura.');
assert(route.includes('scheduleAutoObservationParts'), 'Automação de observações da Escala deve ser preservada.');
assert(route.includes('networkRoute&&Number.isFinite(temp)'), 'Regra Baixar divisória apenas Redes deve ser preservada.');
console.log('OK v1.0.94: OpenFreeMap configurado com maxZoom explícito e fallback OSM compatível.');
