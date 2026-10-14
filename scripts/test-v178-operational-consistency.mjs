import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import fs from 'node:fs';
import { join } from 'node:path';
import { getScheduleEditor, saveSchedule } from '../functions/_lib/schedule.js';
import { saveDeparture, listDepartureControlRows } from '../functions/_lib/departure.js';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const scheduleJs=fs.readFileSync(new URL('../functions/_lib/schedule.js',import.meta.url),'utf8');
const departureJs=fs.readFileSync(new URL('../functions/_lib/departure.js',import.meta.url),'utf8');
const routeJs=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const appJs=fs.readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');

assert.equal(pkg.version,'1.0.158');
assert.match(html,/dms-rota-v1141-login-sessao-20260924/);
assert.match(scheduleJs,/value\(row,'FUNCAO','FUNÇÃO','CARGO','CARGO_FUNCAO'\)/,'Escala deve aceitar FUNCAO ou CARGO como a Central de Recursos');
assert.match(scheduleJs,/export async function saveScheduleInternal/,'fluxos operacionais precisam de gravação interna auditada da Escala');
assert.match(departureJs,/reconcileTransferredSchedulesForDate/,'Controle de Saída deve reparar transferências antigas sem cópia');
assert.match(departureJs,/saveScheduleInternal\(db,user,payload,\{alreadyLocked\}\)/,'transferência não deve depender da permissão route.schedule');
assert.match(routeJs,/\.filter\(\(x\)=>Boolean\(x\.motorista_id\|\|String\(x\.motorista\|\|''\)\.trim\(\)\)\)/,'impressão deve considerar somente viagens com motorista atribuído');
assert.match(routeJs,/print_observacoes:\[transferida\?'TRANSFERIDA'/,'viagem transferida deve ser sinalizada na impressão');
assert.match(appJs,/transferReconcile\?\.repaired/,'UI deve informar recuperação automática de transferências');

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()){
  sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
}
const employeeColumns=sqlite.prepare('PRAGMA table_info(BASE_COLABORADORES)').all().map((x)=>String(x.name).toUpperCase());
if(!employeeColumns.includes('CARGO'))sqlite.exec('ALTER TABLE BASE_COLABORADORES ADD COLUMN CARGO TEXT');

function makeStatement(sql){
  let values=[];
  const api={
    bind(...args){values=args;return api;},
    async first(){return sqlite.prepare(sql).get(...values)||null;},
    async all(){return {results:sqlite.prepare(sql).all(...values)};},
    async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};},
  };
  return api;
}
const db={prepare:makeStatement,async batch(statements){const out=[];sqlite.exec('BEGIN');try{for(const statement of statements)out.push(await statement.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const admin={id:1,name:'Admin Teste',email:'admin@teste.local',role:'ADMIN',bases:['route'],permissions:['*']};
const departureUser={id:2,name:'Operador Saída',email:'saida@teste.local',role:'OPERADOR',bases:['route'],permissions:['route.departures']};

sqlite.prepare("INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,?,1)").run('R178','AG2 GARANHUNS REDES','AG2','REDE',1);
sqlite.prepare("INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)").run('V178','PDD1054','TOCO','PRÓPRIO','DISPONÍVEL');
// Reproduz o caso em que a Central via CARGO=MOTORISTA, mas a Escala perdia o colaborador porque FUNCAO vinha vazia.
sqlite.prepare("INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,CARGO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,?,1)").run('M178','13250','RODRIGO RODRIGUES DE LIMA','','MOTORISTA','PRÓPRIO','DISPONÍVEL');

const editor=await getScheduleEditor(db,admin,'2026-09-08');
assert.ok(editor.drivers.some((x)=>String(x.id)==='M178'),'motorista com CARGO=MOTORISTA deve aparecer no seletor da Escala');

const original=await saveSchedule(db,admin,{
  data:'2026-09-08',sequencia:'10',ocs:'OC-178',peso_kg:5000,qtd_entregas:10,
  rota_id:'R178',rota:'AG2 GARANHUNS REDES',regiao:'AG2',veiculo_id:'V178',placa:'PDD1054',
  motorista_id:'M178',motorista:'RODRIGO RODRIGUES DE LIMA',tipo_equipe:'CARGA_FECHADA',
  horario_ponto:'06:00',status:'PROGRAMADO',
});

await saveDeparture(db,departureUser,{data:{
  schedule_record_id:String(original.id),schedule_storage:original.storage,data:'2026-09-08',status:'TRANSFERIDO',
  hora_programada:'06:00',placa:'PDD1054',veiculo_id:'V178',motorista_id:'M178',motorista:'RODRIGO RODRIGUES DE LIMA',tipo_equipe:'CARGA_FECHADA',
}});

let targetRows=sqlite.prepare("SELECT * FROM ESCALAS_DIA WHERE DATA='2026-09-09'").all();
assert.equal(targetRows.length,1,'TRANSFERIR deve criar a Escala do dia seguinte mesmo para usuário da tela de Saída');
assert.match(String(targetRows[0].OBSERVACOES||''),/\[TRANSFERIDA_DA_ESCALA:/,'cópia deve receber marcador canônico');
assert.equal(String(targetRows[0].MOTORISTA_ID),'M178','cópia transferida deve preservar motorista');

// Simula o estado parcial já observado em produção: registro de Saída ficou TRANSFERIDO,
// mas a cópia do dia seguinte não existia. Ao abrir o Controle do destino, ele deve se recuperar.
sqlite.prepare("DELETE FROM ESCALAS_DIA WHERE DATA='2026-09-09'").run();
const control=await listDepartureControlRows(db,departureUser,{date:'2026-09-09'});
assert.equal(control.transferReconcile?.repaired?.length,1,'Controle de Saída deve reparar a cópia faltante de uma transferência anterior');
const pdd=control.records.find((x)=>String(x.placa)==='PDD1054');
assert.ok(pdd,'veículo transferido deve aparecer no Controle de Saída da data de destino');
assert.equal(String(pdd.status),'PENDENTE','cópia transferida deve chegar ao Controle de Saída como pendente');

console.log('OK: v1.0.78 alinha CARGO/FUNCAO, cria e repara transferências e mantém veículo transferido no fluxo do dia de destino.');
