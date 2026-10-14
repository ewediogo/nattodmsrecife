import assert from 'node:assert/strict';
import { buildExecutionRecordsFromData, buildOvernightIndicators } from '../functions/_lib/indicators.js';

// Regra principal: duração real em blocos de até 24h versus duração planejada da rota.
const overnight=buildOvernightIndicators([
  {id:'1',data:'2026-08-01',rota:'R1',regiao:'AG1',duracao_dias:1,duracao_real_dias:1,pernoites:0},
  {id:'2',data:'2026-08-02',rota:'R1',regiao:'AG1',duracao_dias:1,duracao_real_dias:3,pernoites:0},
  {id:'3',data:'2026-08-03',rota:'R2',regiao:'AG2',duracao_dias:2,duracao_real_dias:2,pernoites:1},
  {id:'4',data:'2026-08-04',rota:'R2',regiao:'AG2',duracao_dias:2,duracao_real_dias:4,pernoites:1},
]);

assert.equal(overnight.excessDays,4,'deve somar somente dias de duração acima do planejamento');
assert.equal(overnight.tripsWithExcess,2,'deve contar apenas viagens com duração acima do planejado');
assert.equal(overnight.excessRatePercent,50,'percentual de viagens com excesso deve usar todas as viagens concluídas filtradas');
assert.equal(overnight.byRoute.find((x)=>x.label==='R1')?.excessDays,2,'agrupamento por rota deve somar excesso');
assert.equal(overnight.byRegion.find((x)=>x.label==='AG2')?.excessDays,2,'agrupamento por região deve somar excesso');
assert.ok(overnight.byDay.length===4 && overnight.byWeek.length>=1 && overnight.byMonth.length===1,'deve gerar séries diária, semanal e mensal pela data real do excesso');
assert.equal(overnight.details.length,2,'detalhamento deve conter somente viagens com excesso');

function recordFor({id='S1',planned=1,startDate='2026-08-21',start='06:00',end='2026-08-22T00:30:00',overnightEvents=[]}={}){
  return buildExecutionRecordsFromData({
    schedules:[{id,data:startDate,rota:'R2',regiao:'AG2',placa:'ABC1D23',duracao_dias:planned,qtd_entregas:0,status:'PROGRAMADO'}],
    departures:[{schedule_record_id:id,status_saida:'SAIU',hora_real:start,hora_programada:start}],
    monitorings:[],
    returns:[{schedule_record_id:id,status:'FINALIZADO',retorno_real:end}],
    routes:[{ROTA:'R2',REGIAO:'AG2',DURACAO_DIAS:planned,TEMPO_IDA_MIN:0,TEMPO_VOLTA_MIN:0,TEMPO_ENTRE_CIDADES_MIN:0,TEMPO_POR_ENTREGA_MIN:0}],
    employees:[],overnightEvents,gpsRetentions:[],gpsCoverage:[],
  },{start:'2026-08-01',end:'2026-08-31'})[0];
}

const crossesMidnight=recordFor({planned:1,start:'06:00',end:'2026-08-22T00:30:00'});
assert.equal(crossesMidnight.duracao_real_dias,1,'virar a meia-noite com menos de 24h continua sendo 1 dia realizado');
assert.equal(crossesMidnight.dias_excessivos,0,'virar a meia-noite sozinho não gera excesso em rota planejada para 1 dia');

const over24h=recordFor({id:'S2',planned:1,start:'06:00',end:'2026-08-22T06:01:00'});
assert.equal(over24h.duracao_real_dias,2,'mais de 24h deve contar 2 dias realizados');
assert.equal(over24h.dias_excessivos,1,'rota de 1 dia com mais de 24h deve ter 1 dia excessivo');
const excessOn22=buildOvernightIndicators([],{
  period:{start:'2026-08-22',end:'2026-08-22'},
  eventRecords:[over24h],
});
assert.equal(excessOn22.excessDays,1,'o excesso de uma escala de 21/08 deve ser contabilizado em 22/08, quando ultrapassou 24h');
assert.equal(excessOn22.byDay[0]?.date,'2026-08-22','o gráfico diário deve usar a data real do excesso, não a data da escala');
assert.equal(excessOn22.details[0]?.data,'2026-08-21','a auditoria deve preservar separadamente a data original da escala');
assert.deepEqual(excessOn22.details[0]?.dias_excessivos_datas,['2026-08-22'],'a auditoria deve mostrar a data em que o excesso ocorreu');
const noExcessOn21=buildOvernightIndicators([over24h],{
  period:{start:'2026-08-21',end:'2026-08-21'},
  eventRecords:[over24h],
});
assert.equal(noExcessOn21.excessDays,0,'a data da escala não deve receber o excesso que só ocorreu no dia seguinte');

const within48h=recordFor({id:'S3',planned:2,start:'06:00',end:'2026-08-23T05:59:00'});
assert.equal(within48h.duracao_real_dias,2,'até 48h deve permanecer em 2 dias realizados');
assert.equal(within48h.dias_excessivos,0,'rota planejada para 2 dias até 48h não tem excesso');

const over48h=recordFor({id:'S4',planned:2,start:'06:00',end:'2026-08-23T06:01:00',overnightEvents:[{SCHEDULE_RECORD_ID:'S4',DATE_KEY:'2026-08-22',EFFECTIVE_AT:'2026-08-22T20:00:00'}]});
assert.equal(over48h.duracao_real_dias,3,'mais de 48h deve contar 3 dias realizados');
assert.equal(over48h.dias_excessivos,1,'rota planejada para 2 dias com mais de 48h deve ter 1 dia excessivo');
assert.equal(over48h.pernoites,1,'status PERNOITE explícito continua preservado para auditoria');
assert.equal(over48h.dias_excessivos,1,'status PERNOITE não substitui o cálculo de duração real');

const twoExcessDays=recordFor({id:'S5',planned:1,start:'06:00',end:'2026-08-23T06:01:00'});
const splitByOccurrence=buildOvernightIndicators([twoExcessDays],{
  period:{start:'2026-08-21',end:'2026-08-23'},
  eventRecords:[twoExcessDays],
});
assert.equal(splitByOccurrence.excessDays,2,'uma viagem com dois dias além do planejado deve gerar dois eventos de excesso');
assert.deepEqual(splitByOccurrence.byDay.map((x)=>[x.date,x.excessDays]),[['2026-08-22',1],['2026-08-23',1]],'cada dia excessivo deve cair na sua própria data de ocorrência');

console.log('OK: dias excessivos por duração real e data efetiva de ocorrência validados.');
