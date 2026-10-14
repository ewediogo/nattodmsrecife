import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { autoPreScaleFromContext } from '../functions/_lib/schedule.js';

const caruaru={id:'R1',rota:'AG1 CARUARU',regiao:'AG1',perfil:'VAREJO',duracao_dias:1,ativo:true};
const garanhuns={id:'R2',rota:'AG2 GARANHUNS',regiao:'AG2',perfil:'VAREJO',duracao_dias:1,ativo:true};
const caruaruRedes={id:'R3',rota:'AG1 CARUARU REDES',regiao:'AG1',perfil:'REDE',duracao_dias:1,ativo:true};
const ownVehicle={id:'V1',placa:'AAA1A11',vinculo:'PRÓPRIO',ativo:true,status:'DISPONÍVEL'};
const thirdVehicle={id:'V2',placa:'BBB2B22',vinculo:'TERCEIRO',ativo:true,status:'DISPONÍVEL'};
const drivers=[
  {id:'D1',nome:'MOTORISTA PROPRIO',funcao:'MOTORISTA',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,restricao_motorista:false},
  {id:'D2',nome:'MOTORISTA TERCEIRO',funcao:'MOTORISTA',vinculo:'TERCEIRO',status:'DISPONÍVEL',ativo:true,restricao_motorista:false},
];
const helpers=[
  {id:'H1',nome:'AJUDANTE ROTA CARUARU',funcao:'AJUDANTE',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,ajudante_rota:true,rotas_atendidas:'AG1 CARUARU',restricao_ajudante:false},
  {id:'H2',nome:'AJUDANTE ROTA GARANHUNS',funcao:'AJUDANTE',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,ajudante_rota:true,rotas_atendidas:'AG2 GARANHUNS',restricao_ajudante:false},
  {id:'H3',nome:'AJUDANTE RESTRITO',funcao:'AJUDANTE',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,ajudante_rota:false,rotas_atendidas:'',restricao_ajudante:true},
  {id:'H4',nome:'AJUDANTE PERNOITE',funcao:'AJUDANTE',vinculo:'PRÓPRIO',status:'PERNOITE',ativo:true,ajudante_rota:false,rotas_atendidas:'',restricao_ajudante:false},
];
const employees=[...drivers,...helpers];
const context={
  settings:new Map(),schedules:[],returns:[],availability:[],reservations:[],monitoring:[],departures:[],vehicles:[ownVehicle,thirdVehicle],drivers,helpers,employees,routes:[caruaru,garanhuns,caruaruRedes],
  vehicleById:new Map([[ownVehicle.id,ownVehicle],[thirdVehicle.id,thirdVehicle]]),vehicleByPlate:new Map([[ownVehicle.placa,ownVehicle],[thirdVehicle.placa,thirdVehicle]]),
  employeeById:new Map(employees.map(x=>[x.id,x])),employeeByName:new Map(employees.map(x=>[x.nome,x])),
  routeById:new Map([[caruaru.id,caruaru],[garanhuns.id,garanhuns],[caruaruRedes.id,caruaruRedes]]),routeByName:new Map([[caruaru.rota,caruaru],[garanhuns.rota,garanhuns],[caruaruRedes.rota,caruaruRedes]]),
  returnBySchedule:new Map(),returnByVehicle:new Map(),departureBySchedule:new Map(),monitoringBySchedule:new Map(),manualReleaseMap:new Map(),workSignals:new Map(),
};

const own=autoPreScaleFromContext(context,'2026-09-01',[{rota_id:'R1',rota:caruaru.rota,veiculo_id:'V1',placa:ownVehicle.placa,tipo_equipe:'UM_AJUDANTE',horario_ponto:'06:00'}]).records[0];
assert.equal(own.motorista_id,'D1','carro próprio deve considerar motorista próprio');
assert.equal(own.ajudante_1_id,'H1','ajudante de rota deve entrar somente na rota cadastrada');
assert.notEqual(own.ajudante_1_id,'H3','ajudante restrito não pode entrar em rota fora de Redes');
assert.notEqual(own.ajudante_1_id,'H4','ajudante em PERNOITE não pode entrar na pré-escala');

const gar=autoPreScaleFromContext(context,'2026-09-01',[{rota_id:'R2',rota:garanhuns.rota,veiculo_id:'V1',placa:ownVehicle.placa,tipo_equipe:'UM_AJUDANTE',horario_ponto:'06:00'}]).records[0];
assert.equal(gar.ajudante_1_id,'H2','ajudante de rota de Caruaru não pode ser usado em Garanhuns');

const network=autoPreScaleFromContext(context,'2026-09-01',[{rota_id:'R3',rota:caruaruRedes.rota,veiculo_id:'V1',placa:ownVehicle.placa,tipo_equipe:'UM_AJUDANTE',horario_ponto:'06:00'}]).records[0];
assert.equal(network.ajudante_1_id,'H3','ajudante com restrição pode ser considerado em rota de Redes');

const third=autoPreScaleFromContext(context,'2026-09-01',[{rota_id:'R1',rota:caruaru.rota,veiculo_id:'V2',placa:thirdVehicle.placa,tipo_equipe:'UM_AJUDANTE',horario_ponto:'06:00'}]).records[0];
assert.equal(third.motorista_id,'D2','carro terceiro deve considerar somente motorista terceiro');
assert.equal(third.tipo_equipe,'TERCEIRO','carro terceiro deve assumir equipe TERCEIRO');
assert.equal(third.ajudante_1_id,'','carro terceiro não deve sugerir ajudante');

const scheduleJs=await readFile(new URL('../functions/_lib/schedule.js',import.meta.url),'utf8');
const appJs=await readFile(new URL('../public/assets/app.js',import.meta.url),'utf8');
const routeJs=await readFile(new URL('../public/assets/route.js',import.meta.url),'utf8');
const coreJs=await readFile(new URL('../functions/_lib/core.js',import.meta.url),'utf8');
assert.match(scheduleJs,/ROUTE_HELPER_ROUTE_MISMATCH/);
assert.match(scheduleJs,/HELPER_RESTRICTION_NETWORK_ONLY/);
assert.match(scheduleJs,/THIRD_PARTY_DRIVER_VEHICLE_MISMATCH/);
assert.match(scheduleJs,/EMPLOYEE_OVERNIGHT_UNAVAILABLE/);
assert.match(appJs,/Rotas atendidas/);
assert.match(appJs,/restricao_ajudante/);
assert.match(routeJs,/scheduleHelperSupportsRoute/);
assert.match(routeJs,/scheduleDriverEligible/);
assert.match(coreJs,/allRelated\.filter\(\(allocation\)=>normalizeStatus\(allocation\.status\)==='PERNOITE'\)/);
console.log('OK: pré-escala v1.0.50 respeita pernoite, rotas dos ajudantes, restrição Redes e vínculo motorista/veículo terceiro.');
