import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import fs from 'node:fs';
import { join } from 'node:path';
import { adminCorrectScheduleResources, saveSchedule } from '../functions/_lib/schedule.js';
import { saveDeparture } from '../functions/_lib/departure.js';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const routeJs=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const scheduleApi=fs.readFileSync(new URL('../functions/api/schedule.js',import.meta.url),'utf8');
assert.equal(pkg.version,'1.0.158');
assert.match(routeJs,/Corrigir equipe \(ADM\)/,'Escala iniciada deve oferecer correção administrativa');
assert.match(routeJs,/admin_correct_resources/,'frontend deve chamar a ação dedicada');
assert.match(scheduleApi,/adminCorrectScheduleResources/,'API deve expor a correção administrativa');

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function makeStatement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare:makeStatement,async batch(statements){const out=[];sqlite.exec('BEGIN');try{for(const st of statements)out.push(await st.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const admin={id:1,name:'Admin',email:'admin@teste.local',role:'ADMIN',bases:['route'],permissions:['*']};
const operator={id:2,name:'Saída',email:'saida@teste.local',role:'OPERADOR',bases:['route'],permissions:['route.departures']};
const nonAdmin={id:3,name:'Planejador',email:'planejador@teste.local',role:'OPERADOR',bases:['route'],permissions:['route.schedule']};

sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,DURACAO_DIAS,ATIVO) VALUES ('R183','AG2 TESTE','AG2','VAREJO',1,1)`).run();
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES ('V183A','AAA1A83','TOCO','PRÓPRIO','DISPONÍVEL',1)`).run();
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES ('V183B','BBB1B83','TOCO','PRÓPRIO','DISPONÍVEL',1)`).run();
for(const row of [
  ['M183A','18301','MOTORISTA ORIGINAL','MOTORISTA'],
  ['M183B','18302','MOTORISTA SUBSTITUTO','MOTORISTA'],
  ['H183A','18303','AJUDANTE ORIGINAL','AJUDANTE'],
  ['H183B','18304','AJUDANTE SUBSTITUTO','AJUDANTE'],
]) sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,'PRÓPRIO','DISPONÍVEL',1)`).run(...row);

const schedule=await saveSchedule(db,admin,{
  data:'2026-09-09',sequencia:'183',ocs:'OC183',peso_kg:6000,qtd_entregas:12,horario_ponto:'06:00',
  rota_id:'R183',veiculo_id:'V183A',motorista_id:'M183A',ajudante_1_id:'H183A',tipo_equipe:'UM_AJUDANTE',status:'PROGRAMADO',
});
await saveDeparture(db,operator,{data:{
  schedule_record_id:String(schedule.id),schedule_storage:schedule.storage,data:'2026-09-09',status:'SAIU',hora_programada:'06:00',hora_real:'06:10',
  veiculo_id:'V183A',placa:'AAA1A83',motorista_id:'M183A',motorista:'MOTORISTA ORIGINAL',ajudante_1_id:'H183A',ajudante_1:'AJUDANTE ORIGINAL',tipo_equipe:'UM_AJUDANTE',
}});

await assert.rejects(()=>adminCorrectScheduleResources(db,nonAdmin,{id:schedule.id,storage:schedule.storage,justificativa:'teste',veiculo_id:'V183B',placa:'BBB1B83',motorista_id:'M183B',motorista:'MOTORISTA SUBSTITUTO',ajudante_1_id:'H183B',ajudante_1:'AJUDANTE SUBSTITUTO',tipo_equipe:'UM_AJUDANTE'}),/Somente administradores/);

const corrected=await adminCorrectScheduleResources(db,admin,{
  id:schedule.id,storage:schedule.storage,identity:{data:'2026-09-09',sequencia:'183',placa:'AAA1A83',ocs:'OC183',rota:'AG2 TESTE'},
  veiculo_id:'V183B',placa:'BBB1B83',motorista_id:'M183B',motorista:'MOTORISTA SUBSTITUTO',ajudante_1_id:'H183B',ajudante_1:'AJUDANTE SUBSTITUTO',ajudante_2_id:'',ajudante_2:'',tipo_equipe:'UM_AJUDANTE',
  justificativa:'Substituição ocorreu na portaria e não foi registrada antes da saída.',
});
assert.equal(corrected.placa,'BBB1B83');
assert.equal(corrected.motorista,'MOTORISTA SUBSTITUTO');
assert.equal(corrected.ajudante_1,'AJUDANTE SUBSTITUTO');
assert.equal(corrected.status,'EM ROTA','correção não pode reabrir ou mudar o status operacional');
assert.ok(corrected.correcao_adm?.changes?.length>=3);

let stored;
if(schedule.storage==='ESCALAS_DIA'){
  stored=sqlite.prepare('SELECT * FROM ESCALAS_DIA WHERE ID=?').get(String(schedule.id));
  assert.equal(stored.PLACA,'BBB1B83');
  assert.equal(stored.MOTORISTA,'MOTORISTA SUBSTITUTO');
  assert.equal(stored.AJUDANTE_1,'AJUDANTE SUBSTITUTO');
  assert.match(String(stored.OBSERVACOES||''),/CORREÇÃO ADM PÓS-SAÍDA/);
}else{
  stored=sqlite.prepare("SELECT DATA_JSON FROM ROUTE_RECORDS WHERE ID=? AND MODULE='schedule'").get(Number(schedule.id));
  const data=JSON.parse(stored.DATA_JSON);
  assert.equal(data.placa,'BBB1B83');
  assert.equal(data.motorista,'MOTORISTA SUBSTITUTO');
  assert.equal(data.ajudante_1,'AJUDANTE SUBSTITUTO');
}

const departure=sqlite.prepare('SELECT * FROM ROUTE_DEPARTURES WHERE SCHEDULE_ID=?').get(String(schedule.id));
assert.equal(departure.PLATE,'BBB1B83');
assert.equal(departure.DRIVER_ID,'M183B');
assert.equal(departure.DRIVER_NAME,'MOTORISTA SUBSTITUTO');
const depData=JSON.parse(departure.DATA_JSON);
assert.equal(depData.ajudante_1_id,'H183B');
assert.equal(depData.ajudante_1,'AJUDANTE SUBSTITUTO');
assert.match(depData.justificativa_troca,/Substituição ocorreu/);
assert.ok(Array.isArray(depData.correcoes_administrativas)&&depData.correcoes_administrativas.length===1);

const monitoring=sqlite.prepare('SELECT * FROM ROUTE_MONITORING WHERE SCHEDULE_ID=?').get(String(schedule.id));
assert.equal(monitoring.PLATE,'BBB1B83');
assert.equal(monitoring.DRIVER_NAME,'MOTORISTA SUBSTITUTO');
const monData=JSON.parse(monitoring.DATA_JSON);
assert.equal(monData.motorista_id,'M183B');
assert.equal(monData.ajudante_1_id,'H183B');

const audits=sqlite.prepare("SELECT ACTION,DETAILS FROM ROUTE_AUDIT WHERE ACTION='CORRIGIR_EQUIPE_POS_SAIDA'").all();
assert.equal(audits.length,1,'correção deve gerar auditoria dedicada');
assert.match(String(audits[0].DETAILS),/Substituição ocorreu/);

console.log('OK: v1.0.83 permite somente ao ADM corrigir veículo/equipe após a saída e sincroniza Escala, Saída e Monitoramento com auditoria.');
