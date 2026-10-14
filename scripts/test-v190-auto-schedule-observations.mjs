import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { saveSchedule } from '../functions/_lib/schedule.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const routeJs=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const scheduleJs=fs.readFileSync(new URL('../functions/_lib/schedule.js',import.meta.url),'utf8');
assert.equal(pkg.version,'1.0.158');
assert.match(routeJs,/SCHEDULE_AUTO_OBSERVATIONS=\['Identificar palete','Bonanza','Baixar divisória'\]/);
assert.match(routeJs,/scheduleIsNetworkRouteName/);
assert.match(routeJs,/applyScheduleAutomaticObservation\(row\)/);
assert.match(scheduleJs,/applyScheduleAutomaticObservations\(schedule\.observacoes,schedule\)/);
assert.match(scheduleJs,/observacoes:applyScheduleAutomaticObservations\(item\.observacoes,item\)/,'Editor deve derivar as observações também para escalas já existentes');

const sqlite=new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function prepare(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare,async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const stmt of statements)out.push(await stmt.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const admin={id:1,email:'admin@local',name:'Administrador',role:'ADMIN',perfil:'ADMIN',permissions:['*'],bases:['route']};

for(const [id,route,profile] of [['RNET','AG1 CARUARU REDES','REDE'],['RVAREJO','AG1 CARUARU','VAREJO']]) sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,TEMPO_IDA_MIN,TEMPO_ENTRE_CIDADES_MIN,TEMPO_VOLTA_MIN,TEMPO_POR_ENTREGA_MIN,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,?,?,?,?,?,1)`).run(id,route,'AG1',profile,60,0,60,30,1);
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('V1','ABC1D23','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('V2','DEF4G56','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('M1','100','MOTORISTA UM','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('M2','101','MOTORISTA DOIS','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('A1','200','AJUDANTE UM','AJUDANTE','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('A2','201','AJUDANTE DOIS','AJUDANTE','PRÓPRIO','DISPONÍVEL');

const common={data:'2026-09-14',peso_kg:5000,qtd_entregas:10,horario_ponto:'06:00',tipo_equipe:'UM_AJUDANTE',status:'PROGRAMADO'};
const network=await saveSchedule(db,admin,{...common,sequencia:'1',ocs:'2510001 / 2510002',temperatura_frio_c:-8,rota_id:'RNET',veiculo_id:'V1',motorista_id:'M1',ajudante_1_id:'A1',observacoes:'Conferir lacre'});
assert.equal(network.observacoes,'Identificar palete | Baixar divisória | Conferir lacre');

const retail=await saveSchedule(db,admin,{...common,sequencia:'2',ocs:'2520001 / 2520002',temperatura_frio_c:-8,rota_id:'RVAREJO',veiculo_id:'V2',motorista_id:'M2',ajudante_1_id:'A2'});
assert.equal(retail.observacoes,'Bonanza','Varejo em -8 °C não deve receber Baixar divisória');

const updated=await saveSchedule(db,admin,{id:retail.id,storage:retail.storage,data:retail.data,sequencia:retail.sequencia,ocs:'2520001',peso_kg:retail.peso_kg,qtd_entregas:retail.qtd_entregas,horario_ponto:retail.horario_ponto,temperatura_frio_c:-8,rota_id:'RVAREJO',veiculo_id:'V2',motorista_id:'M2',ajudante_1_id:'A2',tipo_equipe:'UM_AJUDANTE',status:'PROGRAMADO',observacoes:'Bonanza | Observação manual'});
assert.equal(updated.observacoes,'Observação manual','Varejo em -8 °C não deve receber Baixar divisória; ao ficar com uma OC deve remover Bonanza e preservar texto manual');

const networkSingle=await saveSchedule(db,admin,{id:network.id,storage:network.storage,data:network.data,sequencia:network.sequencia,ocs:'2510001',peso_kg:network.peso_kg,qtd_entregas:network.qtd_entregas,horario_ponto:network.horario_ponto,temperatura_frio_c:-8,rota_id:'RNET',veiculo_id:'V1',motorista_id:'M1',ajudante_1_id:'A1',tipo_equipe:'UM_AJUDANTE',status:'PROGRAMADO',observacoes:network.observacoes});
assert.equal(networkSingle.observacoes,'Baixar divisória | Conferir lacre','Em rota de rede, -8 °C deve manter Baixar divisória mesmo com uma única OC');

console.log('OK: v1.0.91 aplica Baixar divisória apenas a rotas REDE/REDES em -8 °C.');
