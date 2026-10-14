import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { saveSchedule } from '../functions/_lib/schedule.js';
import { createManualResourceRelease } from '../functions/_lib/core.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function makeStatement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare:makeStatement,async batch(statements){const out=[];sqlite.exec('BEGIN');try{for(const stmt of statements)out.push(await stmt.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const admin={id:'ADMIN-QA',name:'Administrador QA',email:'admin@qa.local',role:'ADMIN'};

const addRoute=(id,rota,dias=1)=>sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,TEMPO_IDA_MIN,TEMPO_ENTRE_CIDADES_MIN,TEMPO_VOLTA_MIN,TEMPO_POR_ENTREGA_MIN,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,?,?,?,?,?,1)`).run(id,rota,'AG1','VAREJO',0,0,0,0,dias);
const addVehicle=(id,placa)=>sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run(id,placa,'TRUCK','PRÓPRIO','DISPONÍVEL');
const addEmployee=(id,nome,funcao)=>sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run(id,id,nome,funcao,'PRÓPRIO','DISPONÍVEL');

addRoute('R-REL','AG1 ROTA LIBERACAO',2); addVehicle('V-REL-1','REL1A11'); addVehicle('V-REL-2','REL2A22');
addEmployee('M-REL-1','MOTORISTA LIBERACAO 1','MOTORISTA'); addEmployee('M-REL-2','MOTORISTA LIBERACAO 2','MOTORISTA'); addEmployee('H-REL','JOSE DELMO TESTE','AJUDANTE');
const first=await saveSchedule(db,admin,{data:'2026-08-28',sequencia:'1',ocs:'REL-1',peso_kg:1000,qtd_entregas:1,horario_ponto:'06:00',rota_id:'R-REL',veiculo_id:'V-REL-1',motorista_id:'M-REL-1',ajudante_1_id:'H-REL',tipo_equipe:'UM_AJUDANTE'});
let blocked=false;
try{await saveSchedule(db,admin,{data:'2026-08-28',sequencia:'2',ocs:'REL-2',peso_kg:1000,qtd_entregas:1,horario_ponto:'21:00',rota_id:'R-REL',veiculo_id:'V-REL-2',motorista_id:'M-REL-2',ajudante_1_id:'H-REL',tipo_equipe:'UM_AJUDANTE'});}catch(error){blocked=error.code==='RESOURCE_SCHEDULE_CONFLICT';}
assert.equal(blocked,true,'antes da liberação manual o ajudante deve permanecer bloqueado pela escala anterior');
await createManualResourceRelease(db,{resource_type:'AJUDANTE',resource_id:'H-REL',resource_name:'JOSE DELMO TESTE',schedule_record_id:first.id,effective_at:'2026-08-28T20:00',observacoes:'Retornou e foi liberado pela Central'},admin);
const releaseEvent=sqlite.prepare(`SELECT SCHEDULE_RECORD_ID,EFFECTIVE_AT FROM ROUTE_RESOURCE_EVENTS WHERE RESOURCE_ID='H-REL' AND SOURCE='MANUAL' ORDER BY ID DESC LIMIT 1`).get();
assert.equal(String(releaseEvent.SCHEDULE_RECORD_ID),String(first.id),'liberação manual deve preservar ID textual da escala de origem');
const afterRelease=await saveSchedule(db,admin,{data:'2026-08-28',sequencia:'2',ocs:'REL-2',peso_kg:1000,qtd_entregas:1,horario_ponto:'21:00',rota_id:'R-REL',veiculo_id:'V-REL-2',motorista_id:'M-REL-2',ajudante_1_id:'H-REL',tipo_equipe:'UM_AJUDANTE'});
assert.ok(afterRelease?.id,'após a liberação manual anterior ao novo horário o ajudante deve poder ser escalado novamente');

addRoute('R-VNZ','VENEZA',1); addEmployee('M-VNZ','MOTORISTA VENEZA MULTI','MOTORISTA');
const vz1=await saveSchedule(db,admin,{data:'2026-08-30',sequencia:'V1',ocs:'VENEZA-1',peso_kg:0,qtd_entregas:0,horario_ponto:'08:00',rota_id:'R-VNZ',motorista_id:'M-VNZ',tipo_equipe:'CARGA_FECHADA'});
const vz2=await saveSchedule(db,admin,{data:'2026-08-30',sequencia:'V2',ocs:'VENEZA-2',peso_kg:0,qtd_entregas:0,horario_ponto:'08:10',rota_id:'R-VNZ',motorista_id:'M-VNZ',tipo_equipe:'CARGA_FECHADA'});
assert.ok(vz1?.id&&vz2?.id,'VENEZA deve permitir o mesmo motorista em mais de uma linha da Escala');

addRoute('R-TH','THERMOBRASIL',1); addVehicle('V-TH-1','THM1A11'); addVehicle('V-TH-2','THM2A22'); addEmployee('M-TH','MOTORISTA THERMOBRASIL MULTI','MOTORISTA');
const th1=await saveSchedule(db,admin,{data:'2026-08-31',sequencia:'T1',ocs:'TH-1',peso_kg:1000,qtd_entregas:1,horario_ponto:'06:00',rota_id:'R-TH',veiculo_id:'V-TH-1',motorista_id:'M-TH',tipo_equipe:'CARGA_FECHADA'});
const th2=await saveSchedule(db,admin,{data:'2026-08-31',sequencia:'T2',ocs:'TH-2',peso_kg:1000,qtd_entregas:1,horario_ponto:'06:05',rota_id:'R-TH',veiculo_id:'V-TH-2',motorista_id:'M-TH',tipo_equipe:'CARGA_FECHADA'});
assert.ok(th1?.id&&th2?.id,'THERMOBRASIL deve permitir o mesmo motorista em mais de uma linha da Escala');

addRoute('R-NORMAL','AG1 ROTA NORMAL',1); addVehicle('V-N-1','NOR1A11'); addVehicle('V-N-2','NOR2A22'); addEmployee('M-N','MOTORISTA NORMAL UNICO','MOTORISTA');
await saveSchedule(db,admin,{data:'2026-09-01',sequencia:'N1',ocs:'N-1',peso_kg:1000,qtd_entregas:1,horario_ponto:'06:00',rota_id:'R-NORMAL',veiculo_id:'V-N-1',motorista_id:'M-N',tipo_equipe:'CARGA_FECHADA'});
let normalBlocked=false;
try{await saveSchedule(db,admin,{data:'2026-09-01',sequencia:'N2',ocs:'N-2',peso_kg:1000,qtd_entregas:1,horario_ponto:'06:05',rota_id:'R-NORMAL',veiculo_id:'V-N-2',motorista_id:'M-N',tipo_equipe:'CARGA_FECHADA'});}catch(error){normalBlocked=error.code==='RESOURCE_SCHEDULE_CONFLICT';}
assert.equal(normalBlocked,true,'rotas normais devem continuar bloqueando motorista duplicado');

console.log('OK: liberação manual passa a valer na Escala e VENEZA/THERMOBRASIL aceitam motorista repetido no planejamento.');
