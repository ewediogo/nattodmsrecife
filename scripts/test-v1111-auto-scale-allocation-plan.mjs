import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { autoPreScaleFromContext } from '../functions/_lib/schedule.js';

const route={id:'R1',rota:'AG1 CARUARU',regiao:'AG1',perfil:'VAREJO',duracao_dias:1,ativo:true};
const vehicles=[
  {id:'VP',placa:'PLA1A11',tipo:'TOCO',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true},
  {id:'VM',placa:'MAN3C33',tipo:'TOCO',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true},
];
const baseDrivers=[
  {id:'DP',nome:'MOTORISTA PLANO',funcao:'MOTORISTA',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,restricao_motorista:false},
  {id:'DS',nome:'MOTORISTA SUBSTITUTO',funcao:'MOTORISTA',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,restricao_motorista:false},
  {id:'DH',nome:'MOTORISTA HISTORICO',funcao:'MOTORISTA',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,restricao_motorista:false},
];
const helpers=[{id:'H1',nome:'AJUDANTE 1',funcao:'AJUDANTE',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,ajudante_rota:false,restricao_ajudante:false}];
const plan={id:'PLAN1',route_id:'',route:'',regiao:'',veiculo_id:'VP',placa:'PLA1A11',veiculo_substituto_id:'',placa_substituta:'',motorista_id:'DP',motorista:'MOTORISTA PLANO',motorista_substituto_id:'DS',motorista_substituto:'MOTORISTA SUBSTITUTO',vigencia_inicio:'2026-09-01',vigencia_fim:'',ativo:true};

function context({principalDriverStatus='DISPONÍVEL',plans=[plan]}={}){
  const drivers=baseDrivers.map(d=>d.id==='DP'?{...d,status:principalDriverStatus}:d);
  const employees=[...drivers,...helpers];
  const historical={id:'OLD1',data:'2026-09-01',rota_id:'R1',rota:'AG1 CARUARU',regiao:'AG1',veiculo_id:'VM',placa:'MAN3C33',motorista_id:'DH',motorista:'MOTORISTA HISTORICO',status:'FINALIZADO',duracao_dias:1,horario_ponto:'06:00'};
  return {
    settings:new Map(),schedules:[historical],returns:[],availability:[],reservations:[],monitoring:[],departures:[],allocationPlans:plans,
    vehicles,drivers,helpers,employees,routes:[route],
    vehicleById:new Map(vehicles.map(x=>[x.id,x])),vehicleByPlate:new Map(vehicles.map(x=>[x.placa,x])),
    employeeById:new Map(employees.map(x=>[x.id,x])),employeeByName:new Map(employees.map(x=>[x.nome,x])),
    routeById:new Map([[route.id,route]]),routeByName:new Map([[route.rota,route]]),
    returnBySchedule:new Map(),returnByVehicle:new Map(),departureBySchedule:new Map(),monitoringBySchedule:new Map(),manualReleaseMap:new Map(),workSignals:new Map(),
  };
}

const planned=autoPreScaleFromContext(context(),'2026-09-15',[{rota_id:'R1',rota:route.rota,veiculo_id:'VP',placa:'PLA1A11',peso_kg:3500,qtd_entregas:10,horario_ponto:'06:00'}]).records[0];
assert.equal(planned.veiculo_id,'VP','a placa já definida deve ser preservada');
assert.equal(planned.motorista_id,'DP','a placa deve priorizar o motorista principal do plano');
assert.equal(planned.pre_escala_plano,'PRINCIPAL');
assert.match(planned.pre_escala_motivo,/Plano de alocação: PRINCIPAL/);

const substituted=autoPreScaleFromContext(context({principalDriverStatus:'BLOQUEADO'}),'2026-09-15',[{rota_id:'R1',rota:route.rota,veiculo_id:'VP',placa:'PLA1A11',peso_kg:3500,qtd_entregas:10,horario_ponto:'06:00'}]).records[0];
assert.equal(substituted.veiculo_id,'VP','o plano novo nunca troca a placa');
assert.equal(substituted.motorista_id,'DS','se o principal estiver indisponível, usa o motorista substituto da mesma placa');
assert.equal(substituted.pre_escala_plano,'SUBSTITUTO PREVISTO');

const routeOnly=autoPreScaleFromContext(context(),'2026-09-15',[{rota_id:'R1',rota:route.rota,peso_kg:3500,qtd_entregas:10,horario_ponto:'06:00'}]).records[0];
assert.equal(routeOnly.veiculo_id||'','','a rota não pode mais inferir placa do Plano de Alocação');
assert.equal(routeOnly.pre_escala_plano||'','','sem placa não existe plano aplicável');

const manual=autoPreScaleFromContext(context(),'2026-09-15',[{rota_id:'R1',rota:route.rota,veiculo_id:'VM',placa:'MAN3C33',motorista_id:'DH',motorista:'MOTORISTA HISTORICO',peso_kg:3500,qtd_entregas:10,horario_ponto:'06:00'}]).records[0];
assert.equal(manual.veiculo_id,'VM','pré-escala não deve sobrescrever placa já informada');
assert.equal(manual.motorista_id,'DH','pré-escala não deve sobrescrever motorista já informado');

const scheduleJs=await readFile(new URL('../functions/_lib/schedule.js',import.meta.url),'utf8');
assert.match(scheduleJs,/readAllocationPlansForDate/);
assert.match(scheduleJs,/O plano é exclusivamente por placa/);
assert.match(scheduleJs,/Plano de alocação: \$\{planClass\}/);
console.log('OK: Plano de Alocação é exclusivamente por placa, prioriza motorista principal/substituto e não infere recursos pela rota.');
