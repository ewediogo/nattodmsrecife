import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { autoPreScaleFromContext } from '../functions/_lib/schedule.js';

const routes=[
  {id:'R1',rota:'AG1 CARUARU',regiao:'AG1',perfil:'VAREJO',duracao_dias:1,ativo:true},
  {id:'R2',rota:'SRT PETROLINA',regiao:'SRT',perfil:'VAREJO',duracao_dias:2,ativo:true},
];
const vehicles=[
  {id:'V34',placa:'AAA1A11',tipo:'3/4',vinculo:'PRÓPRIO',ativo:true,status:'DISPONÍVEL'},
  {id:'VTR',placa:'BBB2B22',tipo:'TRUCK',vinculo:'PRÓPRIO',ativo:true,status:'DISPONÍVEL'},
  {id:'VTO',placa:'CCC3C33',tipo:'TOCO',vinculo:'PRÓPRIO',ativo:true,status:'DISPONÍVEL'},
];
const drivers=[
  {id:'D1',nome:'MOTORISTA NOVO',funcao:'MOTORISTA',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,restricao_motorista:false},
  {id:'D2',nome:'MOTORISTA REPETE',funcao:'MOTORISTA',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,restricao_motorista:false},
];
const helpers=[
  {id:'H1',nome:'AJUDANTE 1',funcao:'AJUDANTE',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,ajudante_rota:false,restricao_ajudante:false},
  {id:'H2',nome:'AJUDANTE 2',funcao:'AJUDANTE',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,ajudante_rota:false,restricao_ajudante:false},
  {id:'H3',nome:'AJUDANTE 3',funcao:'AJUDANTE',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,ajudante_rota:false,restricao_ajudante:false},
];
const employees=[...drivers,...helpers];
const historical=[
  {id:'OLD1',data:'2026-08-28',rota:'AG1 CARUARU',regiao:'AG1',motorista_id:'D2',motorista:'MOTORISTA REPETE',status:'FINALIZADO',duracao_dias:1,horario_ponto:'06:00'},
];

function makeContext(){
  const context={
    settings:new Map(),schedules:[...historical],returns:[],availability:[],reservations:[],monitoring:[],departures:[],
    vehicles,drivers,helpers,employees,routes,
    vehicleById:new Map(vehicles.map(x=>[x.id,x])),vehicleByPlate:new Map(vehicles.map(x=>[x.placa,x])),
    employeeById:new Map(employees.map(x=>[x.id,x])),employeeByName:new Map(employees.map(x=>[x.nome,x])),
    routeById:new Map(routes.map(x=>[x.id,x])),routeByName:new Map(routes.map(x=>[x.rota,x])),
    returnBySchedule:new Map(),returnByVehicle:new Map(),departureBySchedule:new Map(),monitoringBySchedule:new Map(),manualReleaseMap:new Map(),workSignals:new Map(),
  };
  return context;
}

const repeated=autoPreScaleFromContext(makeContext(),'2026-09-04',[
  {rota_id:'R1',rota:'AG1 CARUARU',veiculo_id:'VTO',placa:'CCC3C33',peso_kg:3500,qtd_entregas:10,horario_ponto:'06:00'},
]).records[0];
assert.equal(repeated.motorista_id,'D2','deve priorizar motorista que já fez a mesma rota');

const sertao=autoPreScaleFromContext(makeContext(),'2026-09-04',[
  {rota_id:'R2',rota:'SRT PETROLINA',veiculo_id:'V34',placa:'AAA1A11',peso_kg:5500,qtd_entregas:28,horario_ponto:'06:00'},
]).records[0];
assert.equal(sertao.tipo_equipe,'UM_AJUDANTE','Sertão deve ficar sempre com 1 ajudante, mesmo com peso/entregas altos');
assert.ok(sertao.ajudante_1_id);
assert.equal(sertao.ajudante_2_id,'');

const threeQuarter=autoPreScaleFromContext(makeContext(),'2026-09-04',[
  {rota_id:'R1',rota:'AG1 CARUARU',veiculo_id:'V34',placa:'AAA1A11',peso_kg:5000,qtd_entregas:10,horario_ponto:'06:00'},
]).records[0];
assert.equal(threeQuarter.tipo_equipe,'DOIS_AJUDANTES','3/4 com 5 toneladas deve receber 2 ajudantes');
assert.ok(threeQuarter.ajudante_1_id&&threeQuarter.ajudante_2_id);

const manyDeliveries=autoPreScaleFromContext(makeContext(),'2026-09-04',[
  {rota_id:'R1',rota:'AG1 CARUARU',veiculo_id:'VTO',placa:'CCC3C33',peso_kg:3500,qtd_entregas:21,horario_ponto:'06:00'},
]).records[0];
assert.equal(manyDeliveries.tipo_equipe,'DOIS_AJUDANTES','mais de 20 entregas deve receber 2 ajudantes');

const truck=autoPreScaleFromContext(makeContext(),'2026-09-04',[
  {rota_id:'R1',rota:'AG1 CARUARU',veiculo_id:'VTR',placa:'BBB2B22',peso_kg:9000,qtd_entregas:35,horario_ponto:'06:00'},
]).records[0];
assert.equal(truck.tipo_equipe,'UM_AJUDANTE','Truck nunca pode receber 2 ajudantes');
assert.ok(truck.ajudante_1_id);
assert.equal(truck.ajudante_2_id,'');

const routeJs=await readFile(new URL('../public/assets/route.js',import.meta.url),'utf8');
const scheduleJs=await readFile(new URL('../functions/_lib/schedule.js',import.meta.url),'utf8');
assert.match(scheduleJs,/Sertão: 1 ajudante/);
assert.match(scheduleJs,/Truck: máximo 1 ajudante/);
assert.match(scheduleJs,/3\/4 com carga de 5 t ou mais/);
assert.match(scheduleJs,/Mais de 20 entregas/);
assert.match(routeJs,/recalculou a quantidade de ajudantes/);
console.log('OK: v1.0.63 prioriza motorista da mesma rota e aplica regras automáticas de ajudantes.');
