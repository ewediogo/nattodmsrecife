import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildDeliveryPointingUsersFromRecords } from '../functions/_lib/indicators.js';

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const js=fs.readFileSync('public/assets/route.js','utf8');
const css=fs.readFileSync('public/assets/app.css','utf8');
const ind=fs.readFileSync('functions/_lib/indicators.js','utf8');
assert.equal(pkg.version,'1.0.158');
assert(js.includes('cards-grid route-indicator-kpi-grid'),'Grid compacto específico da aba Indicadores ausente.');
assert(css.includes('.route-indicator-kpi-grid')&&css.includes('grid-template-columns:repeat(7,minmax(0,1fr))'),'Indicadores não estão configurados para 7 cards por linha em telas largas.');
assert(ind.includes('const deliveryPointingUsers=buildDeliveryPointingUsersFromRecords(records);'),'Apontamentos por usuário não usam a mesma base filtrada das rotas concluídas.');
assert(!ind.includes('const deliveryPointingPromise = getDeliveryPointingUsersIndicator'),'Consulta paralela antiga ainda pode misturar rotas em andamento.');

const result=buildDeliveryPointingUsersFromRecords([
  {id:'1',schedule_id:'1',finalizada:true,lincros_sync_healthy:true,lincros_deliveries_routed:10,lincros_deliveries_pointed:8,motorista:'Motorista A',motorista_vinculo:'PRÓPRIO',rota:'Rota A',regiao:'AG1',perfil_rota:'VAREJO',placa:'AAA1A11',data:'2026-09-17',lincros_checked_at:'2026-09-17T15:00:00Z'},
  {id:'2',schedule_id:'2',finalizada:false,lincros_sync_healthy:true,lincros_deliveries_routed:20,lincros_deliveries_pointed:5,motorista:'Motorista B',motorista_vinculo:'PRÓPRIO',rota:'Rota B',regiao:'AG2',perfil_rota:'VAREJO',placa:'BBB2B22',data:'2026-09-17'},
  {id:'3',schedule_id:'3',finalizada:true,lincros_sync_healthy:false,lincros_deliveries_routed:30,lincros_deliveries_pointed:30,motorista:'Motorista C',motorista_vinculo:'PRÓPRIO',rota:'Rota C',regiao:'SRT',perfil_rota:'REDE',placa:'CCC3C33',data:'2026-09-17'}
]);
assert.equal(result.summary.totalUsers,1,'Rotas em andamento ou sem sincronização saudável entraram no total de usuários.');
assert.equal(result.summary.totalPlanned,10,'Entregas previstas de rotas em andamento entraram nos Indicadores.');
assert.equal(result.summary.totalPointed,8,'Entregas apontadas de rotas em andamento entraram nos Indicadores.');
assert.equal(result.summary.pointedDeliveriesPercent,80);
console.log('OK v1.0.126 - Indicadores com 7 cards e entregas restritas a rotas concluídas.');
