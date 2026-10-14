import assert from 'node:assert/strict';
import fs from 'node:fs';
const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/assets/app.css',import.meta.url),'utf8');
const panel=route.slice(route.indexOf('<aside class="fleet-panel">'),route.indexOf('<aside id="fleet-drawer"'));
// Campo de cliente fica dentro do painel Frota, abaixo dos filtros e antes da lista.
assert(panel.indexOf('route-location-search')<panel.indexOf('route-location-client')&&panel.indexOf('route-location-client')<panel.indexOf('id="fleet-list"'),'busca de cliente abaixo dos filtros da frota');
assert(panel.includes('Buscar cliente por código ou nome'));
assert(route.includes("/api/clients?q=${encodeURIComponent(q)}&limit=8"),'usa a consulta de clientes existente (código/nome)');
assert(route.includes('clientFocus.plates.includes(row.plate)'),'filtra a frota pelos veículos com entrega pendente do cliente');
assert(route.includes('paintClientFocus();if(restoreView'),'marcador do cliente é repintado a cada redesenho do mapa');
assert(route.includes('if(!preserveView)state.routeLocationClientFocus=null'),'seleção não persiste ao reabrir a tela');
assert(css.includes('.fleet-client-search'));
console.log('OK v1166 - Última localização tem busca de cliente por código/nome abaixo de Frota.');
