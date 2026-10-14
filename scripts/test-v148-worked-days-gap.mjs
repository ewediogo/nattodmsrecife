import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { getScheduleEditor } from '../functions/_lib/schedule.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function statement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare:statement,async batch(statements){const out=[];for(const stmt of statements)out.push(await stmt.run());return out;}};
const admin={role:'ADMIN',id:1,name:'Teste'};

sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('PM','58','PAULO MARCIO LIRA SILVA','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,1)`).run('R1','ROTA TESTE','AG1',2);

const insertSchedule=(id,data,status='FINALIZADO',duration=2)=>sqlite.prepare(`INSERT INTO ESCALAS_DIA (ID,DATA,SEQUENCIA_CARREGAMENTO,CARGA,HORA_SAIDA_PROGRAMADA,ROTA_ID,ROTA,REGIAO,DURACAO_DIAS,MOTORISTA_ID,MOTORISTA,TIPO_EQUIPE,STATUS) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,data,id,'OC','06:00','R1','ROTA TESTE','AG1',duration,'PM','PAULO MARCIO LIRA SILVA','CARGA_FECHADA',status);
const insertDeparture=(id,data,actual)=>sqlite.prepare(`INSERT INTO ROUTE_DEPARTURES (SCHEDULE_ID,DATE_KEY,STATUS,DRIVER_ID,DRIVER_NAME,ROUTE,ACTUAL_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?,?)`).run(id,data,'SAIU','PM','PAULO MARCIO LIRA SILVA','ROTA TESTE',actual,JSON.stringify({motorista_id:'PM',motorista:'PAULO MARCIO LIRA SILVA',saida_real:actual,rota:'ROTA TESTE'}));
const insertReturn=(id,data,ret)=>sqlite.prepare(`INSERT INTO ROUTE_RETURNS (SCHEDULE_ID,DATE_KEY,STATUS,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?)`).run(id,data,'FINALIZADO','PAULO MARCIO LIRA SILVA','ROTA TESTE',ret,JSON.stringify({motorista_id:'PM',motorista:'PAULO MARCIO LIRA SILVA',retorno_real:ret,rota:'ROTA TESTE'}));

// Caso real informado: trabalhou 28-29, folgou 30 e voltou a trabalhar em 31.
insertSchedule('S24','2026-08-24'); insertDeparture('S24','2026-08-24','2026-08-24T09:20'); insertReturn('S24','2026-08-24','2026-08-25T13:08');
insertSchedule('S26','2026-08-26'); insertDeparture('S26','2026-08-26','2026-08-26T07:52'); insertReturn('S26','2026-08-26','2026-08-27T15:03');
insertSchedule('S28','2026-08-28'); insertDeparture('S28','2026-08-28','2026-08-28T07:10'); insertReturn('S28','2026-08-28','2026-08-29T13:57');
insertSchedule('S31','2026-08-31','EM ROTA',1); insertDeparture('S31','2026-08-31','2026-08-31T06:03');

let editor=await getScheduleEditor(db,admin,'2026-08-31');
let paulo=editor.drivers.find((x)=>x.id==='PM');
assert.equal(paulo.dias_consecutivos,1,'30/08 sem viagem deve quebrar a sequência; 31/08 reinicia em 1 dia');
assert.equal(paulo.dias_consecutivos_anteriores,0,'não deve carregar sequência até 29/08 através da folga de 30/08');
assert.equal(paulo.data_quebra_sequencia,'2026-08-30','tooltip deve identificar 30/08 como a quebra da sequência');
assert.ok(paulo.dias_trabalhados_recentes.includes('2026-08-29'),'dia do retorno confirmado deve contar como trabalhado');
assert.ok(!paulo.dias_trabalhados_recentes.includes('2026-08-30'),'dia inteiro sem viagem não pode ser criado artificialmente');
assert.ok(paulo.dias_trabalhados_recentes.includes('2026-08-31'),'nova saída em 31/08 deve contar como trabalho');

// Regressão crítica: se um retorno histórico perder o vínculo, FINALIZADO não pode
// ser estendido até hoje e preencher artificialmente a folga de 30/08.
sqlite.prepare(`DELETE FROM ROUTE_RETURNS WHERE SCHEDULE_ID='S28'`).run();
editor=await getScheduleEditor(db,admin,'2026-08-31');
paulo=editor.drivers.find((x)=>x.id==='PM');
assert.equal(paulo.dias_consecutivos,1,'FINALIZADO sem vínculo de retorno não pode virar viagem aberta até 31/08');
assert.ok(!paulo.dias_trabalhados_recentes.includes('2026-08-30'),'30/08 deve continuar folga mesmo com retorno legado sem vínculo');

// Uma viagem realmente aberta continua ocupando todos os dias até a data consultada.
sqlite.exec(`DELETE FROM ESCALAS_DIA; DELETE FROM ROUTE_DEPARTURES; DELETE FROM ROUTE_RETURNS;`);
insertSchedule('OPEN29','2026-08-29','EM ROTA',3); insertDeparture('OPEN29','2026-08-29','2026-08-29T06:00');
editor=await getScheduleEditor(db,admin,'2026-08-31');
paulo=editor.drivers.find((x)=>x.id==='PM');
assert.equal(paulo.dias_consecutivos,3,'viagem aberta desde 29/08 deve contar 29, 30 e 31');

console.log('OK: dias consecutivos respeitam saída/retorno real; 30/08 sem atividade quebra a sequência de Paulo Márcio.');
