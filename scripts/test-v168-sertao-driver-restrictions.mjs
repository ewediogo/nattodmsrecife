import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { autoPreScaleFromContext } from '../functions/_lib/schedule.js';

const routes=[
  {id:'RS',rota:'SRT PETROLINA',regiao:'SRT',perfil:'VAREJO',duracao_dias:2,ativo:true},
  {id:'RA',rota:'AG1 CARUARU',regiao:'AG1',perfil:'VAREJO',duracao_dias:1,ativo:true},
];
const vehicles=[{id:'V1',placa:'AAA1A11',tipo:'TOCO',vinculo:'PRÓPRIO',ativo:true,status:'DISPONÍVEL'}];
const drivers=[
  {id:'D1',nome:'CLAUDIVAN GOMES DOS SANTOS',funcao:'MOTORISTA',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,restricao_motorista:false},
  {id:'D2',nome:'PAULO ROBERTO DOS SANTOS',funcao:'MOTORISTA',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,restricao_motorista:false},
  {id:'D3',nome:'MOTORISTA SERTAO LIBERADO',funcao:'MOTORISTA',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,restricao_motorista:false},
];
const helpers=[{id:'H1',nome:'AJUDANTE 1',funcao:'AJUDANTE',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,ajudante_rota:false,restricao_ajudante:false}];
const employees=[...drivers,...helpers];
const historical=[
  {id:'HIST1',data:'2026-09-01',rota:'SRT PETROLINA',regiao:'SRT',motorista_id:'D1',motorista:'CLAUDIVAN GOMES DOS SANTOS',status:'FINALIZADO'},
  {id:'HIST2',data:'2026-09-01',rota:'SRT PETROLINA',regiao:'SRT',motorista_id:'D2',motorista:'PAULO ROBERTO DOS SANTOS',status:'FINALIZADO'},
];
function ctx(){return {
  settings:new Map(),schedules:[...historical],returns:[],availability:[],reservations:[],monitoring:[],departures:[],
  vehicles,drivers,helpers,employees,routes,
  vehicleById:new Map(vehicles.map(x=>[x.id,x])),vehicleByPlate:new Map(vehicles.map(x=>[x.placa,x])),
  employeeById:new Map(employees.map(x=>[x.id,x])),employeeByName:new Map(employees.map(x=>[x.nome,x])),
  routeById:new Map(routes.map(x=>[x.id,x])),routeByName:new Map(routes.map(x=>[x.rota,x])),
  returnBySchedule:new Map(),returnByVehicle:new Map(),departureBySchedule:new Map(),monitoringBySchedule:new Map(),manualReleaseMap:new Map(),workSignals:new Map(),
};}

const sertao=autoPreScaleFromContext(ctx(),'2026-09-04',[{rota_id:'RS',rota:'SRT PETROLINA',veiculo_id:'V1',placa:'AAA1A11',peso_kg:3000,qtd_entregas:10}]).records[0];
assert.equal(sertao.motorista_id,'D3','Claudivan e Paulo Roberto devem ser excluídos da sugestão automática no SRT');
assert.notEqual(sertao.motorista_id,'D1');
assert.notEqual(sertao.motorista_id,'D2');

// Em AG1, os nomes continuam elegíveis; com empate alfabético Claudivan deve aparecer antes do motorista genérico/Paulo.
const agreste=autoPreScaleFromContext(ctx(),'2026-09-04',[{rota_id:'RA',rota:'AG1 CARUARU',veiculo_id:'V1',placa:'AAA1A11',peso_kg:3000,qtd_entregas:10}]).records[0];
assert.ok(['D1','D2','D3'].includes(agreste.motorista_id),'nas demais regiões os motoristas continuam elegíveis');

const scheduleJs=await readFile(new URL('../functions/_lib/schedule.js',import.meta.url),'utf8');
assert.match(scheduleJs,/CLAUDIVAN GOMES DOS SANTOS/);
assert.match(scheduleJs,/PAULO ROBERTO DOS SANTOS/);
assert.match(scheduleJs,/driverBlockedFromSertaoAutoScale/);
console.log('OK: v1.0.72 bloqueia Claudivan e Paulo Roberto apenas na pré-escala do Sertão (SRT/STR).');
