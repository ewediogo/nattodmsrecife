import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { saveSchedule, getScheduleEditor } from '../functions/_lib/schedule.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const routeJs=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const scheduleJs=fs.readFileSync(new URL('../functions/_lib/schedule.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/assets/app.css',import.meta.url),'utf8');

assert.equal(pkg.version,'1.0.158');
assert.match(routeJs,/data-key="temperatura_frio_c"[^>]*type="number"[^>]*step="0\.1"/,'Escala deve exibir campo numérico para frio programado');
assert.match(routeJs,/Frio programado \(°C\)/,'Cabeçalho deve identificar a temperatura de frio');
assert.match(routeJs,/temperatura_frio_c:x\.temperatura_frio_c/,'CSV deve exportar a temperatura programada');
assert.match(routeJs,/schedulePrintTemperature\(x\.temperatura_frio_c(?:\?\?x\.TEMPERATURA_FRIO_C)?\)/,'Impressão deve exibir a temperatura programada');
assert.match(scheduleJs,/ensureScheduleTemperatureColumn/,'Backend deve reconciliar automaticamente bancos legados');
assert.match(scheduleJs,/TEMPERATURA_FRIO_C:schedule\.temperatura_frio_c === '' \? null : schedule\.temperatura_frio_c/,'Persistência legada deve gravar a temperatura');
assert.match(css,/schedule-print-page th:nth-child\(11\)/,'Impressão deve estar dimensionada para a nova coluna');

const sqlite=new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function prepare(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare,async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const stmt of statements)out.push(await stmt.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const admin={id:1,email:'admin@local',name:'Administrador',role:'ADMIN',perfil:'ADMIN',permissions:['*'],bases:['route']};
sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,TEMPO_IDA_MIN,TEMPO_ENTRE_CIDADES_MIN,TEMPO_VOLTA_MIN,TEMPO_POR_ENTREGA_MIN,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,?,?,?,?,?,1)`).run('RTEMP','AG2 ROTA FRIO','AG2','VAREJO',60,0,60,30,1);
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VTEMP','TMP1A23','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MTEMP','90001','MOTORISTA FRIO','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('ATEMP','90002','AJUDANTE FRIO','AJUDANTE','PRÓPRIO','DISPONÍVEL');

const saved=await saveSchedule(db,admin,{data:'2026-09-11',sequencia:'1',ocs:'FRIO-001',peso_kg:5000,qtd_entregas:10,horario_ponto:'06:00',temperatura_frio_c:'-8,5',rota_id:'RTEMP',veiculo_id:'VTEMP',motorista_id:'MTEMP',ajudante_1_id:'ATEMP',tipo_equipe:'UM_AJUDANTE',status:'PROGRAMADO'});
assert.equal(saved.temperatura_frio_c,-8.5,'Temperatura negativa decimal deve ser normalizada');
const raw=sqlite.prepare(`SELECT TEMPERATURA_FRIO_C FROM ESCALAS_DIA WHERE ID=?`).get(String(saved.id));
assert.equal(Number(raw?.TEMPERATURA_FRIO_C),-8.5,'Temperatura deve persistir na ESCALAS_DIA');
const editor=await getScheduleEditor(db,admin,'2026-09-11');
assert.equal(editor.schedules.find((x)=>String(x.id)===String(saved.id))?.temperatura_frio_c,-8.5,'Temperatura deve voltar ao editor após recarregar');

console.log('OK: v1.0.87 permite programar, persistir, recarregar, exportar e imprimir a temperatura do frio por veículo.');
