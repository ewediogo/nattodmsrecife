import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { saveSchedule, getScheduleEditor } from '../functions/_lib/schedule.js';
import * as catalog from '../functions/api/catalogo.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function makeStatement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:info.changes,last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare:makeStatement,async batch(statements){const out=[];sqlite.exec('BEGIN');try{for(const stmt of statements)out.push(await stmt.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const admin={id:'ADMIN-QA',name:'Administrador QA',email:'admin@qa.local',role:'ADMIN'};
const env={DB:db};
sqlite.prepare(`INSERT INTO ROUTE_USERS (ID,NAME,EMAIL,ROLE,PASSWORD_HASH,SALT) VALUES (1,'Admin QA','a@qa.local','ADMIN','x','y')`).run();
sqlite.prepare(`INSERT INTO ROUTE_SESSIONS (TOKEN,USER_ID,EXPIRES_AT) VALUES ('tok',1,?)`).run(new Date(Date.now()+86400000).toISOString());
const call=async(handler,method,path,body)=>{const response=await handler({env,request:new Request(`https://rota.test${path}`,{method,headers:{authorization:'Bearer tok','content-type':'application/json'},body:body?JSON.stringify(body):undefined})});return {status:response.status,body:await response.json()};};
sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,DURACAO_DIAS,ATIVO) VALUES ('R1','AG1 CARUARU','AG1','VAREJO',1,1)`).run();
sqlite.exec(`ALTER TABLE BASE_ROTAS ADD COLUMN TIPO_SERVICO TEXT`);
sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,DURACAO_DIAS,ATIVO,TIPO_SERVICO) VALUES ('RB','APOIO LOGISTICO INTERNO','AG1','VAREJO',1,1,'ADMINISTRATIVO')`).run();
for(const [id,nome,funcao] of [['M1','MOTORISTA UM','MOTORISTA'],['M2','MOTORISTA DOIS','MOTORISTA'],['M3','MOTORISTA TRES','MOTORISTA'],['H1','AJUDANTE UM','AJUDANTE']])
  sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,'PRÓPRIO','DISPONÍVEL',1)`).run(id,id,nome,funcao);

// 1) Cadastro do veículo com apelido e limite de motoristas.
let r=await call(catalog.onRequestPost,'POST','/api/catalogo?type=vehicles',{placa:'QYX9C62',tipo:'OUTROS',vinculo:'PRÓPRIO',apelido:'T-Cross',max_motoristas:3});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await call(catalog.onRequestPost,'POST','/api/catalogo?type=vehicles',{placa:'AAA1A11',tipo:'TRUCK',vinculo:'PRÓPRIO'});assert.equal(r.status,201);
const list=await call(catalog.onRequestGet,'GET','/api/catalogo?type=vehicles');
const tcross=list.body.records.find((v)=>v.placa==='QYX9C62'),truck=list.body.records.find((v)=>v.placa==='AAA1A11');
assert.equal(tcross.apelido,'T-CROSS'.replace('T-CROSS','T-Cross'),'apelido salvo');assert.equal(Number(tcross.max_motoristas),3);assert.equal(Number(truck.max_motoristas),1,'padrão: 1 motorista (+ carona)');

// 2) Escala: o editor devolve apelido e limite para a tela.
const editor=await getScheduleEditor(db,admin,'2026-10-20');
const vt=editor.vehicles.find((v)=>v.placa==='QYX9C62');
assert.equal(vt.apelido,'T-Cross');assert.equal(vt.max_motoristas,3);

// 3) Três motoristas só em placa que permite.
const base={data:'2026-10-20',horario_ponto:'06:00',rota_id:'RB',tipo_equipe:'TRES_MOTORISTAS',motorista_id:'M1',ajudante_1_id:'M2',ajudante_2_id:'M3'};
let message='';try{await saveSchedule(db,admin,{...base,veiculo_id:truck.id});}catch(error){message=error.message;}
assert.match(message,/não permite três motoristas/,'placa comum não aceita 3 motoristas');
const three=await saveSchedule(db,admin,{...base,veiculo_id:tcross.id,carona_motivo:'Buscar SMX0A05 na Veneza'});
assert.equal(three.tipo_equipe,'TRES_MOTORISTAS');assert.equal(three.ajudante_1_id,'M2');assert.equal(three.ajudante_2_id,'M3');
message='';try{await saveSchedule(db,admin,{...base,data:'2026-10-21',veiculo_id:tcross.id,ajudante_2_id:'H1'});}catch(error){message=error.message;}
assert.match(message,/motorista/i,'terceira vaga precisa ser motorista');
message='';try{await saveSchedule(db,admin,{...base,data:'2026-10-22',veiculo_id:tcross.id,ajudante_2_id:'M2'});}catch(error){message=error.message;}
assert.match(message,/pessoas diferentes/,'os três motoristas devem ser diferentes');
// 4) Placa de 3 motoristas: 2 motoristas sem ajudante é permitido.
const two=await saveSchedule(db,admin,{data:'2026-10-23',horario_ponto:'06:00',rota_id:'RB',veiculo_id:tcross.id,tipo_equipe:'DOIS_MOTORISTAS',motorista_id:'M1',ajudante_1_id:'M2'});
assert.equal(two.tipo_equipe,'DOIS_MOTORISTAS');

// 5) Front-end.
const rt=fs.readFileSync(join(root,'public/assets/route.js'),'utf8'),app=fs.readFileSync(join(root,'public/assets/app.js'),'utf8');
assert.match(rt,/data-third-driver/);assert.match(rt,/TRES_MOTORISTAS/);assert.match(rt,/item\.apelido\?`/,'apelido ao lado da placa na Escala');
assert.match(rt,/apelido:v\?\.apelido/,'apelido na impressão');
assert.match(app,/data-cat-field="apelido"/);assert.match(app,/data-cat-field="max_motoristas"/);
console.log('OK v1178 - apelido do veículo e equipe de até 3 motoristas.');
