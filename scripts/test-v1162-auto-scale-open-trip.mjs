import assert from 'node:assert/strict';
import { autoPreScaleFromContext } from '../functions/_lib/schedule.js';

const route={id:'R1',rota:'AG1 CARUARU',regiao:'AG1',perfil:'VAREJO',duracao_dias:1,ativo:true};
const vehicle={id:'V1',placa:'AAA1A11',vinculo:'PRÓPRIO',ativo:true,status:'DISPONÍVEL'};
const mk=(id,nome)=>({id,nome,funcao:'MOTORISTA',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:true,restricao_motorista:false});
const emRota=mk('D1','MOTORISTA EM ROTA'),pernoite=mk('D2','MOTORISTA PERNOITE'),livre=mk('D3','MOTORISTA LIVRE');
const trip=(id,driver)=>({id,data:'2026-10-05',status:'EM ROTA',rota:'AG1 X',horario_ponto:'06:00',motorista_id:driver.id,motorista:driver.nome,placa:'ZZZ9Z99',veiculo_id:'V9',ajudante_1:'',ajudante_2:''});
const schedules=[trip('S1',emRota),trip('S2',pernoite)];
const monitoring=[{ESCALA_ID:'S1',STATUS_MONITORAMENTO:'EM ROTA',DATA_JSON:'{}'},{ESCALA_ID:'S2',STATUS_MONITORAMENTO:'PERNOITE',DATA_JSON:'{}'}];
const build=(drivers)=>{
  const employees=drivers;
  return {
    settings:new Map(),schedules,returns:[],availability:[],reservations:[],monitoring,departures:[],vehicles:[vehicle],drivers,helpers:[],employees,routes:[route],
    vehicleById:new Map([['V1',vehicle]]),vehicleByPlate:new Map([[vehicle.placa,vehicle]]),
    employeeById:new Map(employees.map(x=>[x.id,x])),employeeByName:new Map(employees.map(x=>[x.nome,x])),
    routeById:new Map([['R1',route]]),routeByName:new Map([[route.rota,route]]),
    returnBySchedule:new Map(),returnByVehicle:new Map(),departureBySchedule:new Map(),monitoringBySchedule:new Map(monitoring.map(r=>[r.ESCALA_ID,r])),manualReleaseMap:new Map(),workSignals:new Map(),
  };
};
const rec={rota_id:'R1',rota:route.rota,veiculo_id:'V1',placa:vehicle.placa,tipo_equipe:'CARGA_FECHADA',horario_ponto:'06:00'};
// Dias depois da previsão de retorno, sem retorno confirmado: continua bloqueado.
const only=autoPreScaleFromContext(build([emRota,pernoite]),'2026-10-09',[rec]).records[0];
assert.equal(only.motorista_id||'','','sem motorista disponível o campo deve ficar vazio');
const mixed=autoPreScaleFromContext(build([emRota,pernoite,livre]),'2026-10-09',[rec]).records[0];
assert.equal(mixed.motorista_id,'D3','somente o motorista livre pode ser sugerido');
console.log('OK v1162 - pré-escala automática não sugere quem está EM ROTA/PERNOITE sem retorno; sem elegível, deixa vazio.');
