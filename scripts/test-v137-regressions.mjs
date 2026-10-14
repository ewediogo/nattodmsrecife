import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildFleetOverview } from '../functions/_lib/route-dashboard.js';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const overview=buildFleetOverview({
  vehicles:[
    {id:'A',name:'AAA1A11',status:'DISPONÍVEL',active:true,raw:{PLACA:'AAA1A11',TIPO:'TRUCK',VINCULO:'PRÓPRIO'}},
    {id:'B',name:'BBB2B22',status:'DISPONÍVEL',active:true,raw:{PLACA:'BBB2B22',TIPO:'TOCO',VINCULO:'TERCEIRO'}},
    {id:'C',name:'CCC3C33',status:'INDISPONÍVEL',active:false,raw:{PLACA:'CCC3C33',TIPO:'3/4',VINCULO:'PRÓPRIO'}},
  ],
  employees:[],
});
assert.equal(overview.inventory.total,2,'Inventário deve contar apenas veículos ativos');
assert.equal(overview.inventory.terceiro,1,'Veículo terceiro ativo deve continuar no inventário');
assert.equal(overview.inactive.total,1,'Veículos inativos devem aparecer em contador separado');

const app=await read('public/assets/app.js');
assert.match(app,/const BADGE_TONES=/,'badge deve usar mapa explícito de status');
assert.match(app,/['\"]INDISPONIVEL['\"]\s*:\s*['\"]danger['\"]/,'INDISPONÍVEL deve ser vermelho');
assert.match(app,/['\"]DISPONIVEL['\"]\s*:\s*['\"]success['\"]/,'DISPONÍVEL deve ser verde');
assert.doesNotMatch(app,/includes\(['"]DISPON/,'badge não pode mais decidir DISPONÍVEL por substring');
assert.match(app,/ÚLTIMA EDIÇÃO MANUAL/,'cadastros devem exibir trilha de edição');

const route=await read('public/assets/route.js');
assert.match(route,/fleet-matrix-secondary/,'Inventário deve exibir contador secundário de inativos');
assert.match(route,/data-route-schedule-toggle/,'Escala deve ter controle de expandir/recolher');
assert.match(route,/schedule-summary-sequence/,'Escala recolhida deve manter a sequência visível');

const css=await read('public/assets/app.css');
assert.match(css,/\.system-view\.is-sidebar-collapsed \.sidebar\{overflow:visible\}/,'sidebar colapsado não deve cortar o botão de expansão');
assert.match(css,/\.system-view\.is-sidebar-collapsed \.sidebar-logo\{[^}]*max-width:calc\(var\(--sidebar-collapsed\) - 16px\)/s,'logo colapsado deve respeitar a largura disponível');
assert.match(css,/\.schedule-editor-table tr\[data-route-schedule-row\]:not\(\.is-editing\)/,'Escala deve possuir apresentação recolhida');
assert.match(css,/@media screen and \(max-width:760px\)[\s\S]*schedule-editor-table tr\[data-route-schedule-row\]:not\(\.is-editing\)/,'modo compacto da Escala deve possuir regra específica para tela menor');

const migration=await read('migrations/0026_catalog_update_actor.sql');
assert.match(migration,/BASE_COLABORADORES ADD COLUMN ATUALIZADO_POR/i);
assert.match(migration,/BASE_VEICULOS ADD COLUMN ATUALIZADO_POR/i);

const employeesApi=await read('functions/api/colaboradores.js');
const catalogApi=await read('functions/api/catalogo.js');
assert.match(employeesApi,/ATUALIZADO_POR/,'API de colaboradores deve persistir autor da edição');
assert.match(catalogApi,/ATUALIZADO_POR/,'API de veículos deve persistir autor da edição');


const monitoring=await read('functions/_lib/monitoring.js');
assert.match(monitoring,/pernoite_datas/,'Monitoramento deve preservar histórico explícito de datas de pernoite');

const phase1=await read('functions/_lib/route-phase1.js');
assert.match(phase1,/recordResourceEvents\(db,\{\s*data:/s,'eventos de recursos devem receber os dados da escala para resolver referências');

console.log('OK: regressões v1.0.37 (badge, inventário, sidebar, CAJU, auditoria e Escala) validadas.');
