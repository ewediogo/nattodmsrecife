import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import fs from 'node:fs';
import { join } from 'node:path';
import { getScheduleEditor } from '../functions/_lib/schedule.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
assert.equal(pkg.version,'1.0.158');

const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function makeStatement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare:makeStatement,async batch(statements){const out=[];sqlite.exec('BEGIN');try{for(const st of statements)out.push(await st.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const admin={id:1,name:'Admin',email:'admin@teste.local',role:'ADMIN',bases:['route'],permissions:['*']};
sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,DURACAO_DIAS,ATIVO) VALUES ('R182','AG2 TESTE','AG2','VAREJO',1,1)`).run();
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES ('V182','AAA1A82','TOCO','PRÓPRIO','DISPONÍVEL',1)`).run();
for(const row of [
  ['H-ST','13250','RODRIGO RODRIGUES DE LIMA'],
  ['H-OPEN','18202','AJUDANTE PERNOITE REAL'],
  ['H-RET','18203','AJUDANTE JÁ RETORNOU'],
]) sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,'AJUDANTE','PRÓPRIO','DISPONÍVEL',1)`).run(...row);

// Caso reportado: evento histórico de PERNOITE sem qualquer viagem operacional aberta.
// O cadastro está DISPONÍVEL; esse evento não pode, sozinho, bloquear a Escala.
sqlite.prepare(`INSERT INTO ROUTE_RESOURCE_EVENTS (EVENT_KEY,RESOURCE_TYPE,RESOURCE_KEY,RESOURCE_ID,RESOURCE_NAME,STATUS,EFFECTIVE_AT,DATE_KEY,SOURCE,SOURCE_MODULE,SOURCE_RECORD_ID,SCHEDULE_RECORD_ID,DETAILS_JSON,CREATED_BY_NAME) VALUES (?,?,?,?,?,'PERNOITE','2026-09-08T22:00:00','2026-09-08','MONITORAMENTO','monitoring',1,999,'{}','Sistema')`)
  .run('STALE-182','AJUDANTE','H ST','H-ST','RODRIGO RODRIGUES DE LIMA');

function insertSchedule(id,helperId,helperName,status='PERNOITE'){
  const data={id,data:'2026-09-08',sequencia:String(id),ocs:`OC${id}`,peso_kg:5000,qtd_entregas:10,horario_ponto:'06:00',rota_id:'R182',rota:'AG2 TESTE',regiao:'AG2',duracao_dias:1,veiculo_id:'V182',placa:'AAA1A82',motorista_id:'',motorista:'',ajudante_1_id:helperId,ajudante_1:helperName,ajudante_2_id:'',ajudante_2:'',tipo_equipe:'UM_AJUDANTE',status};
  const info=sqlite.prepare(`INSERT INTO ROUTE_RECORDS (MODULE,TITLE,STATUS,DATE_KEY,DATA_JSON) VALUES ('schedule',?,?,?,?)`).run(`Escala ${id}`,status,'2026-09-08',JSON.stringify(data));
  return Number(info.lastInsertRowid);
}
function insertMonitoring(scheduleId,helperId,helperName){
  const data={schedule_record_id:String(scheduleId),data:'2026-09-08',status:'PERNOITE',status_monitoramento:'PERNOITE',placa:'AAA1A82',rota:'AG2 TESTE',ajudante_1_id:helperId,ajudante_1:helperName};
  sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (?,?,?,?,?,?,?)`).run(String(scheduleId),'2026-09-08','PERNOITE','AAA1A82','','AG2 TESTE',JSON.stringify(data));
}
const openId=insertSchedule('OPEN','H-OPEN','AJUDANTE PERNOITE REAL');
insertMonitoring(openId,'H-OPEN','AJUDANTE PERNOITE REAL');
const returnedId=insertSchedule('RET','H-RET','AJUDANTE JÁ RETORNOU');
insertMonitoring(returnedId,'H-RET','AJUDANTE JÁ RETORNOU');
const returnData={schedule_record_id:String(returnedId),data:'2026-09-09',retorno_real:'2026-09-09T05:30',placa:'AAA1A82',rota:'AG2 TESTE',ajudante_1_id:'H-RET',ajudante_1:'AJUDANTE JÁ RETORNOU'};
sqlite.prepare(`INSERT INTO ROUTE_RETURNS (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?,?)`).run(String(returnedId),'2026-09-09','FINALIZADO','AAA1A82','','AG2 TESTE','2026-09-09T05:30',JSON.stringify(returnData));

const editor=await getScheduleEditor(db,admin,'2026-09-09');
const byName=(name)=>editor.helpers.find((x)=>x.nome===name);
assert.equal(byName('RODRIGO RODRIGUES DE LIMA')?.status,'DISPONÍVEL','evento histórico de pernoite sem viagem aberta não pode bloquear Rodrigo');
assert.equal(byName('AJUDANTE PERNOITE REAL')?.status,'PERNOITE','pernoite com monitoramento realmente aberto deve continuar bloqueado');
assert.equal(byName('AJUDANTE JÁ RETORNOU')?.status,'DISPONÍVEL','retorno confirmado precisa vencer monitoramento residual de pernoite');
console.log('OK: v1.0.82 reconcilia PERNOITE pela viagem operacional real; evento histórico isolado não trava a Escala e retorno confirmado libera o recurso.');
