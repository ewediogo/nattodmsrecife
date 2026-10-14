import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { saveScheduleBatch } from '../functions/_lib/schedule.js';
import { saveDeparture } from '../functions/_lib/departure.js';
import { ensureAuthSchema } from '../functions/_lib/auth.js';
import { ensureAvailabilitySchema } from '../functions/_lib/availability.js';
import { withOperationalGuard } from '../functions/_lib/operation-guard.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) {
  sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
}

const optionalPerformanceIndexes=[
  'IDX_ROUTE_RESOURCE_EVENT_DATE_EFFECTIVE',
  'IDX_ROUTE_DEPARTURE_STATUS_DATE_ID','IDX_ROUTE_DEPARTURE_DATE_ID',
  'IDX_ROUTE_MONITORING_STATUS_DATE_ID','IDX_ROUTE_MONITORING_DATE_ID',
  'IDX_ROUTE_RETURN_DATE_ID',
];
for(const index of optionalPerformanceIndexes) sqlite.exec(`DROP INDEX IF EXISTS ${index}`);

sqlite.prepare("INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,?,1)").run('FAST-R1','AG2 FAST TESTE','AG2','VAREJO',1);
sqlite.prepare("INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,?,1)").run('FAST-R2','SRT PLANEJAMENTO RESIDUAL','SRT','VAREJO',2);
sqlite.prepare("INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)").run('FAST-V1','FST1A15','TOCO','PRÓPRIO','DISPONÍVEL');
sqlite.prepare("INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)").run('FAST-M1','1501','MOTORISTA FAST','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare("INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)").run('FAST-A1','1502','AJUDANTE FAST','AJUDANTE','PRÓPRIO','DISPONÍVEL');

const sqlLog=[];
function makeStatement(sql){
  let values=[];sqlLog.push(String(sql));
  const api={
    bind(...args){values=args;return api;},
    async first(){return sqlite.prepare(sql).get(...values)||null;},
    async all(){return {results:sqlite.prepare(sql).all(...values)};},
    async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};},
  };
  return api;
}
const db={prepare:makeStatement,async batch(statements){const out=[];sqlite.exec('BEGIN');try{for(const statement of statements)out.push(await statement.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const user={id:1,name:'Admin Fast',email:'fast@test.local',role:'ADMIN',bases:['route'],permissions:['*']};

// Em uma base já migrada, os bootstraps usados por todas as telas devem apenas
// consultar sqlite_master. DDL no clique em Salvar pode disputar o lock do D1 e
// se manifestar como HTTP 503 sem corpo de erro.
sqlLog.length=0;
await ensureAuthSchema(db);
await ensureAvailabilitySchema(db);
await withOperationalGuard(db,'fast-bootstrap','fast-bootstrap-request',async()=>({ok:true}),'SCHEDULE:FAST-BOOTSTRAP');
assert.equal(sqlLog.some((sql)=>/^\s*(CREATE|DROP|ALTER)\b/i.test(sql)),false,'schema pronto não deve executar DDL no fluxo de gravação');
assert.equal(sqlLog.some((sql)=>/DELETE FROM ROUTE_REQUESTS|UPDATE ROUTE_LOCKS SET OWNER=NULL[\s\S]*EXPIRES_AT<CURRENT_TIMESTAMP/i.test(sql)),false,'salvamento não deve executar limpeza global de locks/requisições');

const saved=await saveScheduleBatch(db,user,[{
  data:'2026-08-25',sequencia:'15',ocs:'FAST-001',peso_kg:3230.44,qtd_entregas:2,
  rota_id:'FAST-R1',veiculo_id:'FAST-V1',motorista_id:'FAST-M1',ajudante_1_id:'FAST-A1',
  tipo_equipe:'UM_AJUDANTE',horario_ponto:'06:00',status:'PROGRAMADO',
  client_id:'ESC-C-15151515-1515-4515-8515-151515151515',
}],'fast-save-request');
assert.equal(saved.total,1,'fast path deve salvar uma linha');
assert.equal(saved.failed,0,'fast path não deve rejeitar a linha válida');
assert.equal(sqlLog.some((sql)=>/ROW_NUMBER\(\) OVER[\s\S]*ROUTE_RESOURCE_EVENTS/i.test(sql)),false,'Salvar Escala não deve varrer o histórico de ROUTE_RESOURCE_EVENTS');

const record=saved.records[0];
await saveDeparture(db,user,{requestId:'fast-departure-request',data:{
  schedule_record_id:String(record.id),schedule_storage:record.storage,data:'2026-08-25',status:'PENDENTE',hora_programada:'06:00',
  placa:'FST1A15',motorista_id:'FAST-M1',motorista:'MOTORISTA FAST',ajudante_1_id:'FAST-A1',ajudante_1:'AJUDANTE FAST',
}});

const existingIndexes=new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((row)=>String(row.name||'')));
for(const index of optionalPerformanceIndexes) assert.equal(existingIndexes.has(index),false,`${index} não deve ser criado durante uma operação do usuário`);



// Regressão v1.0.30: uma escala de DIA ANTERIOR que nunca virou saída/monitoramento
// não pode prender o veículo apenas porque a previsão planejada atravessa o dia seguinte.
// Esse era o cenário em que a Escala acusava "veículo ainda está alocado", mas não
// existia viagem em Retornos para o operador encerrar.
const oldPlanning=await saveScheduleBatch(db,user,[{
  data:'2026-08-26',sequencia:'21',ocs:'STALE-001',peso_kg:4100,qtd_entregas:5,
  rota_id:'FAST-R2',veiculo_id:'FAST-V1',motorista_id:'FAST-M1',ajudante_1_id:'FAST-A1',
  tipo_equipe:'UM_AJUDANTE',horario_ponto:'06:00',status:'PROGRAMADO',
}],'stale-old-request');
assert.equal(oldPlanning.total,1,'planejamento antigo deve ser criado para o teste');
const nextDayPlanning=await saveScheduleBatch(db,user,[{
  data:'2026-08-27',sequencia:'22',ocs:'STALE-002',peso_kg:4200,qtd_entregas:6,
  rota_id:'FAST-R1',veiculo_id:'FAST-V1',motorista_id:'FAST-M1',ajudante_1_id:'FAST-A1',
  tipo_equipe:'UM_AJUDANTE',horario_ponto:'06:00',status:'PROGRAMADO',
}],'stale-next-request');
assert.equal(nextDayPlanning.total,1,'planejamento residual de dia anterior sem saída não deve bloquear o dia seguinte');
assert.equal(nextDayPlanning.failed,0,'não deve existir VEHICLE_SCHEDULE_CONFLICT fantasma');

console.log('OK: fast path da Escala sem varredura de eventos, sem CREATE INDEX pesado e sem bloqueio residual de planejamento antigo.');
