import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { saveSchedule, resolveOperationalCrewChange, autoPreScale, getScheduleEditor } from '../functions/_lib/schedule.js';
import { onRequestPost as catalogPost, onRequestGet as catalogGet } from '../functions/api/catalogo.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function makeStatement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare:makeStatement,async batch(statements){const out=[];sqlite.exec('BEGIN');try{for(const stmt of statements)out.push(await stmt.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const admin={id:'ADMIN-QA',name:'Administrador QA',email:'admin@qa.local',role:'ADMIN'};
const env={DB:db};
sqlite.prepare(`INSERT INTO ROUTE_USERS (ID,NAME,EMAIL,ROLE,PASSWORD_HASH,SALT) VALUES (1,'Admin QA','a@qa.local','ADMIN','x','y')`).run();
sqlite.prepare(`INSERT INTO ROUTE_SESSIONS (TOKEN,USER_ID,EXPIRES_AT) VALUES ('tok',1,?)`).run(new Date(Date.now()+86400000).toISOString());

// --- cadastro da rota (coluna criada sob demanda) ---
const call=async(handler,method,body,query='?type=routes')=>{const response=await handler({env,request:new Request(`https://rota.test/api/catalogo${query}`,{method,headers:{authorization:'Bearer tok','content-type':'application/json'},body:body?JSON.stringify(body):undefined})});return {status:response.status,body:await response.json()};};
const baseRoute={regiao:'AG1',perfil:'VAREJO',tempo_ida_min:0,tempo_entre_cidades_min:0,tempo_volta_min:0,tempo_por_entrega_min:0,duracao_dias:1,ativo:1};
const created=await call(catalogPost,'POST',{...baseRoute,id:'ROT-ADM',nome:'APOIO LOGISTICO INTERNO',tipo_servico:'ADMINISTRATIVO'});
assert.equal(created.status,201,JSON.stringify(created.body));
const other=await call(catalogPost,'POST',{...baseRoute,id:'ROT-OUT',nome:'TREINAMENTO NOVATO',tipo_servico:'outros'});assert.equal(other.status,201);
const normal=await call(catalogPost,'POST',{...baseRoute,id:'ROT-ENT',nome:'AG1 CARUARU'});assert.equal(normal.status,201);
const invalid=await call(catalogPost,'POST',{...baseRoute,id:'ROT-X',nome:'ROTA X',tipo_servico:'QUALQUER'});assert.equal(invalid.body.record?.tipo_servico||'ENTREGA','ENTREGA','tipo inválido volta ao padrão');
const listed=await call(catalogGet,'GET',null,'?type=routes');
assert.equal(listed.body.records.find((r)=>r.id==='ROT-ADM').tipo_servico,'ADMINISTRATIVO');
assert.equal(listed.body.records.find((r)=>r.id==='ROT-OUT').tipo_servico,'OUTROS');
assert.equal(listed.body.records.find((r)=>r.id==='ROT-ENT').tipo_servico,'ENTREGA');

for(const [id,placa] of [['V1','AAA1A11']])sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,'TRUCK','PRÓPRIO','DISPONÍVEL',1)`).run(id,placa);
for(const [id,nome,funcao] of [['M1','MOTORISTA UM','MOTORISTA'],['M2','MOTORISTA DOIS','MOTORISTA'],['M3','MOTORISTA TRES','MOTORISTA'],['H1','AJUDANTE UM','AJUDANTE']])
  sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,'PRÓPRIO','DISPONÍVEL',1)`).run(id,id,nome,funcao);

const base={data:'2026-11-20',horario_ponto:'06:00'};
// 1) Serviço administrativo: sem placa, sem ajudante, sem OC/peso/sequência.
const adm=await saveSchedule(db,admin,{...base,rota_id:'ROT-ADM',motorista_id:'M1',tipo_equipe:'UM_AJUDANTE'});
assert.ok(adm?.id,'administrativo salva sem placa nem ajudante');
assert.equal(adm.tipo_equipe,'SEM_AJUDANTE');assert.equal(adm.placa,'');assert.equal(adm.ajudante_1_id,'');
// 2) Rota "Outros" também.
const out=await saveSchedule(db,admin,{...base,rota_id:'ROT-OUT',motorista_id:'M3',tipo_equipe:'SEM_AJUDANTE'});assert.ok(out?.id);
// 3) Entrega comum continua exigindo placa e ajudante.
let message='';try{await saveSchedule(db,admin,{...base,sequencia:'1',ocs:'OC1',peso_kg:1000,qtd_entregas:1,rota_id:'ROT-ENT',motorista_id:'M2',tipo_equipe:'UM_AJUDANTE'});}catch(error){message=error.message;}
assert.match(message,/VEICULO_ID|Ajudante/i,'entrega continua exigindo placa/ajudante');
// 4) Dois motoristas: o segundo ocupa a vaga de ajudante 1 e deve ser motorista.
const two=await saveSchedule(db,admin,{...base,data:'2026-11-21',sequencia:'1',ocs:'OC2',peso_kg:1000,qtd_entregas:1,rota_id:'ROT-ENT',veiculo_id:'V1',motorista_id:'M1',ajudante_1_id:'M2',ajudante_2_id:'H1',tipo_equipe:'DOIS_MOTORISTAS'});
assert.equal(two.tipo_equipe,'DOIS_MOTORISTAS');assert.equal(two.ajudante_1_id,'M2');assert.equal(two.ajudante_1,'MOTORISTA DOIS');assert.equal(two.ajudante_2_id,'H1','2 motoristas + 1 ajudante (máx. 3 pessoas no carro)');
message='';try{await saveSchedule(db,admin,{...base,data:'2026-11-23',sequencia:'1',ocs:'OC9',peso_kg:1000,qtd_entregas:1,rota_id:'ROT-ENT',veiculo_id:'V1',motorista_id:'M1',ajudante_1_id:'M2',tipo_equipe:'DOIS_MOTORISTAS'});}catch(error){message=error.message;}
assert.match(message,/Ajudante/,'equipe de 2 motoristas exige 1 ajudante em rota de entrega');
message='';try{await saveSchedule(db,admin,{...base,data:'2026-11-22',sequencia:'1',ocs:'OC3',peso_kg:1000,qtd_entregas:1,rota_id:'ROT-ENT',veiculo_id:'V1',motorista_id:'M1',ajudante_1_id:'H1',ajudante_2_id:'H1',tipo_equipe:'DOIS_MOTORISTAS'});}catch(error){message=error.message;}
assert.match(message,/motorista/i,'o segundo da equipe de dois motoristas precisa ser motorista');
message='';try{await saveSchedule(db,admin,{...base,data:'2026-11-22',sequencia:'1',ocs:'OC3',peso_kg:1000,qtd_entregas:1,rota_id:'ROT-ENT',veiculo_id:'V1',motorista_id:'M1',ajudante_1_id:'M1',ajudante_2_id:'H1',tipo_equipe:'DOIS_MOTORISTAS'});}catch(error){message=error.message;}
assert.match(message,/diferentes/,'os dois motoristas devem ser pessoas diferentes');
// 5) O segundo motorista entra no controle de disponibilidade como qualquer equipe.
message='';let code='';try{await saveSchedule(db,admin,{...base,data:'2026-11-21',sequencia:'2',ocs:'OC4',peso_kg:1000,qtd_entregas:1,horario_ponto:'06:30',rota_id:'ROT-ENT',veiculo_id:'V1',motorista_id:'M2',ajudante_1_id:'H1',tipo_equipe:'UM_AJUDANTE'});}catch(error){code=error.code||error.message;}
assert.ok(code,'o segundo motorista já escalado não pode ser escalado de novo no mesmo período');
// 6) Troca na Saída aceita o segundo motorista.
const crew=await resolveOperationalCrewChange(db,admin,two,{status:'PENDENTE',ajudante_1_id:'M2',tipo_equipe:'DOIS_MOTORISTAS'},two);
assert.equal(crew.ajudante_1_id,'M2');
// 7) Pré-escala automática não pede placa/ajudante para serviço administrativo.
const auto=await autoPreScale(db,admin,'2026-11-23',[{rota_id:'ROT-ADM',rota:'APOIO LOGISTICO INTERNO',horario_ponto:'06:00'}]);
assert.equal(auto.records[0].tipo_equipe,'SEM_AJUDANTE');assert.equal(auto.records[0].ajudante_1_id||'','');
// 8) O editor entrega o tipo de serviço das rotas à tela.
const editor=await getScheduleEditor(db,admin,'2026-11-20');
assert.equal(editor.routes.find((r)=>r.id==='ROT-ADM').tipo_servico,'ADMINISTRATIVO');

// 9) Telas: cadastro, Escala, Saída e CAJU.
const app=fs.readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
assert(app.includes('data-cat-field="tipo_servico"')&&app.includes('Serviço administrativo'),'cadastro de rota com tipo de serviço');
assert(route.includes("DOIS_MOTORISTAS:'COM 2º MOTORISTA'")&&route.includes("SEM_AJUDANTE:'SEM AJUDANTE'"),'Escala com segundo motorista (carona) e sem ajudante');assert(route.includes('data-extra-driver'),'caixinha de segundo motorista');
assert(route.includes('is-second-driver')&&route.includes('Placa / veículo (opcional)')||fs.readFileSync(new URL('../public/assets/app.css',import.meta.url),'utf8').includes('Placa / veículo (opcional)'),'placa opcional e Motorista 2 sinalizados');
assert(app.includes("secondDriver?'Motorista 2':'Ajudante 1'"),'Saída exibe Motorista 2');
console.log('OK v1172 - rotas de serviço administrativo/outros (sem placa e sem ajudante) e equipe de dois motoristas.');
