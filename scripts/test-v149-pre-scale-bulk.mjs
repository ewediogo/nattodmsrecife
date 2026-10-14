import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { autoPreScaleFromContext } from '../functions/_lib/schedule.js';

const route={id:'R1',rota:'AG1 CARUARU',regiao:'AG1',perfil:'VAREJO',duracao_dias:1,ativo:true};
const closed={id:'R2',rota:'AG1 CARUARU CARGA FECHADA',regiao:'AG1',perfil:'CARGA FECHADA',duracao_dias:1,ativo:true};
const drivers=[
  {id:'D1',nome:'ANDERSON ROBERTO DA SILVA',funcao:'MOTORISTA',status:'DISPONÍVEL',ativo:true,restricao_motorista:true},
  {id:'D2',nome:'LUCAS QUEIROZ',funcao:'MOTORISTA',status:'DISPONÍVEL',ativo:true,restricao_motorista:false},
  {id:'D3',nome:'PAULO ROBERTO DOS SANTOS',funcao:'MOTORISTA',status:'DISPONÍVEL',ativo:true,restricao_motorista:false},
];
const helpers=[
  {id:'H1',nome:'AJUDANTE UM',funcao:'AJUDANTE',status:'DISPONÍVEL',ativo:true,ajudante_rota:false},
  {id:'H2',nome:'AJUDANTE DOIS',funcao:'AJUDANTE',status:'DISPONÍVEL',ativo:true,ajudante_rota:false},
  {id:'H3',nome:'AJUDANTE TRES',funcao:'AJUDANTE',status:'DISPONÍVEL',ativo:true,ajudante_rota:false},
];
const employees=[...drivers,...helpers];
const context={
  settings:new Map(),schedules:[],returns:[],availability:[],reservations:[],monitoring:[],departures:[],vehicles:[],drivers,helpers,employees,routes:[route,closed],
  vehicleById:new Map(),vehicleByPlate:new Map(),employeeById:new Map(employees.map(x=>[x.id,x])),employeeByName:new Map(employees.map(x=>[x.nome,x])),
  routeById:new Map([[route.id,route],[closed.id,closed]]),routeByName:new Map([[route.rota,route],[closed.rota,closed]]),
  returnBySchedule:new Map(),returnByVehicle:new Map(),departureBySchedule:new Map(),monitoringBySchedule:new Map(),manualReleaseMap:new Map(),workSignals:new Map(),
};

const result=autoPreScaleFromContext(context,'2026-09-01',[
  {route_id:'R1',rota:route.rota,tipo_equipe:'UM_AJUDANTE',horario_ponto:'06:00'},
  {route_id:'R1',rota:route.rota,tipo_equipe:'UM_AJUDANTE',horario_ponto:'06:00'},
]);
assert.equal(result.records.length,2);
assert.ok(result.records.every(x=>x.motorista_id),'deve sugerir motorista em todas as linhas quando há disponibilidade');
assert.ok(result.records.every(x=>x.ajudante_1_id),'deve sugerir ajudante em todas as linhas quando há disponibilidade');
assert.equal(new Set(result.records.map(x=>x.motorista_id)).size,2,'não deve repetir motorista no mesmo lote');
assert.equal(new Set(result.records.map(x=>x.ajudante_1_id)).size,2,'não deve repetir ajudante no mesmo lote');
assert.ok(result.records.every(x=>x.motorista_id!=='D1'),'motorista com restrição não pode entrar em carga aberta');

const closedResult=autoPreScaleFromContext(context,'2026-09-01',[{route_id:'R2',rota:closed.rota,tipo_equipe:'UM_AJUDANTE',horario_ponto:'06:00'}]);
assert.equal(closedResult.records[0].tipo_equipe,'CARGA_FECHADA');
assert.equal(closedResult.records[0].motorista_id,'D1','motorista com restrição pode ser sugerido em carga fechada quando melhor aderente');
assert.equal(closedResult.records[0].ajudante_1_id,'','carga fechada não deve sugerir ajudante');

const preserved=autoPreScaleFromContext(context,'2026-09-01',[{route_id:'R1',rota:route.rota,tipo_equipe:'UM_AJUDANTE',horario_ponto:'06:00',motorista_id:'D3',motorista:'PAULO ROBERTO DOS SANTOS'}]);
assert.equal(preserved.records[0].motorista_id,'D3','pré-escala não deve sobrescrever motorista já escolhido pelo usuário');
assert.ok(preserved.records[0].ajudante_1_id,'deve completar apenas o ajudante faltante');

const routeJs=await readFile(new URL('../public/assets/route.js',import.meta.url),'utf8');
const scheduleJs=await readFile(new URL('../functions/_lib/schedule.js',import.meta.url),'utf8');
assert.match(routeJs,/route-schedule-auto/,'a tela deve oferecer pré-escala para linhas já importadas');
assert.match(routeJs,/const suggested=await autoPreScaleRecords\(valid\)/,'Importar em massa deve gerar sugestões antes de confirmar');
assert.match(scheduleJs,/const proposed=autoPreScaleFromContext\(preContext,selected,rows\)\.records/,'confirmação em massa deve gerar pré-escala no servidor');
assert.match(scheduleJs,/motorista_id:row\.motorista_id\|\|''/,'importação não pode zerar o motorista sugerido');
console.log('OK: pré-escala automática funciona no Importar em massa, completa linhas existentes e respeita restrição/carga fechada.');
