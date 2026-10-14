import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import fs from 'node:fs';
import { join } from 'node:path';
import { getScheduleEditor } from '../functions/_lib/schedule.js';
import { buildResourceCenter } from '../functions/_lib/core.js';
import { onRequestGet as colaboradoresGet } from '../functions/api/colaboradores.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
assert.equal(pkg.version,'1.0.158');

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
sqlite.prepare(`INSERT INTO ROUTE_USERS (ID,NAME,EMAIL,ROLE,PASSWORD_HASH,SALT,ACTIVE,PERMISSIONS_JSON,BASES_JSON) VALUES (1,'Admin Teste','admin@teste.local','ADMIN','x','y',1,'[]','["route"]')`).run();
sqlite.prepare(`INSERT INTO ROUTE_SESSIONS (TOKEN,USER_ID,EXPIRES_AT) VALUES ('token-v181',1,'2099-12-31T23:59:59.000Z')`).run();
sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,DURACAO_DIAS,ATIVO) VALUES ('R181','AG2 TESTE','AG2','VAREJO',1,1)`).run();
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES ('V181','AAA1A81','TOCO','PRÓPRIO','DISPONÍVEL',1)`).run();

// Casos equivalentes aos nomes reportados: mistura de legado CARGO/FUNCAO,
// "AJUDANTE DE MOTORISTA", CONDUTOR e metadados de rota indevidos em motorista.
const rows=[
  ['A1811','18101','CRISTIANO','AJUDANTE DE MOTORISTA','', 'PRÓPRIO','DISPONÍVEL',0,'',''],
  ['A1812','18102','JOSE JUNIOR','','AJUDANTE', 'PRÓPRIO','DISPONÍVEL',0,'',''],
  ['A1813','18103','JOSE PEREIRA','AJUDANTE','', 'PRÓPRIO','DISPONÍVEL',0,'',''],
  ['A1814','18104','MESSIAS SIMOES','','AUXILIAR DE ROTA', 'PRÓPRIO','DISPONÍVEL',1,'BELO JARDIM','AG2 TESTE'],
  // CIDADE_ROTA residual não pode transformar um motorista em ajudante.
  ['M1811','13250','RODRIGO RODRIGUES DE LIMA','MOTORISTA','', 'PRÓPRIO','DISPONÍVEL',0,'BELO JARDIM','AG2 TESTE'],
  ['M1812','18106','JOSE JUNIOR MOTORISTA','','CONDUTOR', 'PRÓPRIO','DISPONÍVEL',0,'',''],
];
for(const row of rows){
  sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,CARGO,VINCULO,STATUS,AJUDANTE_ROTA,CIDADE_ROTA,ROTAS_ATENDIDAS,ATIVO) VALUES (?,?,?,?,?,?,?,?,?,?,1)`).run(...row);
}

const editor=await getScheduleEditor(db,admin,'2026-09-09');
const driverNames=new Set(editor.drivers.map((x)=>x.nome));
const helperNames=new Set(editor.helpers.map((x)=>x.nome));
for(const name of ['RODRIGO RODRIGUES DE LIMA','JOSE JUNIOR MOTORISTA']) assert.ok(driverNames.has(name),`${name} deve aparecer como motorista na Escala`);
for(const name of ['CRISTIANO','JOSE JUNIOR','JOSE PEREIRA','MESSIAS SIMOES']) assert.ok(helperNames.has(name),`${name} deve aparecer como ajudante na Escala`);
assert.ok(!helperNames.has('RODRIGO RODRIGUES DE LIMA'),'metadados residuais de rota não podem reclassificar motorista como ajudante');
assert.ok(!driverNames.has('CRISTIANO'),'AJUDANTE DE MOTORISTA não pode ser classificado como motorista');

const snap=await buildResourceCenter(db,'2026-09-09');
for(const name of ['RODRIGO RODRIGUES DE LIMA','JOSE JUNIOR MOTORISTA']) assert.equal(snap.drivers.find((x)=>x.resourceName===name)?.status,'DISPONÍVEL',`${name} deve permanecer motorista disponível na Central`);
for(const name of ['CRISTIANO','JOSE JUNIOR','JOSE PEREIRA','MESSIAS SIMOES']) assert.equal(snap.helpers.find((x)=>x.resourceName===name)?.status,'DISPONÍVEL',`${name} deve permanecer ajudante disponível na Central`);

const reqM=new Request('https://dms.local/api/colaboradores?funcao=MOTORISTA',{headers:{Authorization:'Bearer token-v181'}});
const resM=await colaboradoresGet({env:{DB:db},request:reqM}); const payloadM=await resM.json();
assert.equal(resM.status,200,JSON.stringify(payloadM));
assert.ok(payloadM.records.some((x)=>x.nome==='RODRIGO RODRIGUES DE LIMA'&&x.funcao==='MOTORISTA'));
assert.ok(payloadM.records.some((x)=>x.nome==='JOSE JUNIOR MOTORISTA'&&x.funcao==='MOTORISTA'));
const reqA=new Request('https://dms.local/api/colaboradores?funcao=AJUDANTE',{headers:{Authorization:'Bearer token-v181'}});
const resA=await colaboradoresGet({env:{DB:db},request:reqA}); const payloadA=await resA.json();
assert.equal(resA.status,200,JSON.stringify(payloadA));
for(const name of ['CRISTIANO','JOSE JUNIOR','JOSE PEREIRA','MESSIAS SIMOES']) assert.ok(payloadA.records.some((x)=>x.nome===name&&x.funcao==='AJUDANTE'));

// A Escala não deve mais ocultar silenciosamente candidatos que existem no catálogo.
// Regras operacionais continuam valendo, mas o item aparece desabilitado com o motivo.
const routeJs=await readFile(join(root,'public/assets/route.js'),'utf8');
assert.ok(routeJs.includes("PERNOITE EM ANDAMENTO"));
assert.ok(routeJs.includes("ROTA FORA DO CADASTRO DO AJUDANTE"));
assert.ok(routeJs.includes("RESTRIÇÃO: SOMENTE ROTAS DE REDES"));
assert.ok(routeJs.includes("EXIGE VEÍCULO TERCEIRO"));
assert.ok(routeJs.includes("scheduleDriverOption(x,record.motorista_id,currentVehicle,"),'motoristas devem ser renderizados sem filtro silencioso');
assert.ok(routeJs.includes("const helpers=(scheduleData.helpers||[]);"),'ajudantes devem ser renderizados sem filtro silencioso');

console.log('OK: v1.0.81 unifica classificação de motoristas/ajudantes e deixa visíveis os candidatos bloqueados com o respectivo motivo.');
