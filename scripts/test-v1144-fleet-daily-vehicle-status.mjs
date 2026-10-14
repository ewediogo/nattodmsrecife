import fs from 'node:fs';
import { buildFleetAvailabilityFromData } from '../functions/_lib/indicators.js';
const assert=(c,m)=>{if(!c)throw new Error(m);};
const vehicleRows=[
  {ID:'V1',PLACA:'AAA1A11',TIPO:'TRUCK',VINCULO:'PRÓPRIO',ATIVO:1,STATUS:'DISPONÍVEL'},
  {ID:'V2',PLACA:'BBB2B22',TIPO:'TOCO',VINCULO:'PRÓPRIO',ATIVO:1,STATUS:'MANUTENÇÃO',PREVISAO_PRONTO_MANUTENCAO:'2026-10-01'},
  {ID:'V3',PLACA:'CCC3C33',TIPO:'3/4',VINCULO:'TERCEIRO',ATIVO:1,STATUS:'RESERVADO'},
];
const intervals=[{plate:'AAA1A11',departedAt:'2026-09-29T18:00:00',returnedAt:'2026-09-30T08:00:00',route:'AG1 CARUARU'}];
const result=buildFleetAvailabilityFromData({vehicleRows,auditRows:[],intervals},{start:'2026-09-30',end:'2026-09-30'});
const day=result.daily[0];
assert(day.vehicleDetails?.length===3,'O detalhamento deve trazer cada veículo ativo da data.');
const inRoute=day.vehicleDetails.find((x)=>x.plate==='AAA1A11');
const maintenance=day.vehicleDetails.find((x)=>x.plate==='BBB2B22');
const available=day.vehicleDetails.find((x)=>x.plate==='CCC3C33');
assert(inRoute?.indicatorStatus==='EM ROTA NO INÍCIO'&&inRoute.route==='AG1 CARUARU','Veículo em rota deve exibir situação e rota na data.');
assert(maintenance?.indicatorStatus==='MANUTENÇÃO'&&maintenance.maintenanceForecast==='2026-10-01','Veículo em manutenção deve exibir previsão.');
assert(available?.indicatorStatus==='DISPONÍVEL'&&available.registrationStatus==='RESERVADO','Status do indicador e status cadastral devem ser exibidos separadamente.');
const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
assert(route.includes('Ver situação dos')&&route.includes('CSV situação dos carros')&&route.includes('situacao_frota_detalhada_'),'Visão detalhada/CSV da situação diária da frota ausentes.');
console.log('OK v1.0.144: situação individual dos veículos por data validada.');
