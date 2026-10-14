import fs from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { onRequestPut } from '../functions/api/colaboradores.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const api=fs.readFileSync(new URL('../functions/api/colaboradores.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../migrations/0034_employee_phone.sql',import.meta.url),'utf8');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));

assert.equal(pkg.version,'1.0.158');
assert.match(migration,/ADD COLUMN TELEFONE TEXT/i,'migration deve adicionar TELEFONE');
assert(api.includes("telefone:'TELEFONE'"),'API deve expor telefone no FIELD_MAP');
assert(api.includes("'telefone','TELEFONE'"),'API deve persistir telefone');
assert(api.includes("['TELEFONE', `ALTER TABLE"),'API deve autorreparar a coluna TELEFONE');
assert(api.includes('record.telefone'),'busca deve considerar telefone');
assert(app.includes("['telefone','Telefone']"),'listas de motoristas/ajudantes devem exibir Telefone');
assert(app.includes('data-emp-field="telefone"'),'formulário deve permitir editar telefone');
assert(app.includes('type="tel"'),'campo deve usar input de telefone');
assert(index.includes('app.js?rev=dms-rota-v1141-login-sessao-20260924'),'cache-busting do app.js deve refletir o ajuste');

// Simula banco publicado até a v1.0.124, sem executar a migration 0034.
const sqlite=new DatabaseSync(':memory:');
const migrationFiles=(await readdir(join(root,'migrations')))
  .filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x))
  .filter((x)=>Number(String(x).slice(0,4))<=33)
  .sort();
for(const file of migrationFiles) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
let cols=sqlite.prepare('PRAGMA table_info(BASE_COLABORADORES)').all().map((x)=>String(x.name).toUpperCase());
assert.equal(cols.includes('TELEFONE'),false,'pré-condição: banco v1.0.124 ainda não possui TELEFONE');

function makeStatement(sql){
  let values=[];
  const statement={
    bind(...args){values=args;return statement;},
    async first(){return sqlite.prepare(sql).get(...values)||null;},
    async all(){return {results:sqlite.prepare(sql).all(...values)};},
    async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};},
  };
  return statement;
}
const db={prepare:makeStatement,async batch(statements){const out=[];sqlite.exec('BEGIN');try{for(const statement of statements)out.push(await statement.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};

sqlite.prepare(`INSERT INTO ROUTE_USERS (ID,NAME,EMAIL,ROLE,PASSWORD_HASH,SALT,ACTIVE,PERMISSIONS_JSON,BASES_JSON) VALUES (1,'ADMIN TESTE','admin@teste.local','ADMIN','x','y',1,'[]','["route"]')`).run();
sqlite.prepare(`INSERT INTO ROUTE_SESSIONS (TOKEN,USER_ID,EXPIRES_AT) VALUES ('token-v1125',1,'2099-12-31T23:59:59.000Z')`).run();
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES ('M1125','15001','MOTORISTA TELEFONE','MOTORISTA','PRÓPRIO','DISPONÍVEL',1)`).run();

const request=new Request('https://dms.local/api/colaboradores',{
  method:'PUT',
  headers:{'Authorization':'Bearer token-v1125','Content-Type':'application/json'},
  body:JSON.stringify({id:'M1125',matricula:'15001',nome:'MOTORISTA TELEFONE',telefone:'(81) 99999-1125',funcao:'MOTORISTA',vinculo:'PRÓPRIO',status:'DISPONÍVEL',ativo:'1'}),
});
const response=await onRequestPut({env:{DB:db},request});
const payload=await response.json();
assert.equal(response.status,200,`PUT deveria salvar telefone: ${JSON.stringify(payload)}`);
assert.equal(payload.record?.telefone,'(81) 99999-1125','API deve devolver telefone persistido');
cols=sqlite.prepare('PRAGMA table_info(BASE_COLABORADORES)').all().map((x)=>String(x.name).toUpperCase());
assert.equal(cols.includes('TELEFONE'),true,'autorreparo deve criar TELEFONE em banco já existente');
assert.equal(sqlite.prepare(`SELECT TELEFONE FROM BASE_COLABORADORES WHERE ID='M1125'`).get().TELEFONE,'(81) 99999-1125','telefone deve permanecer gravado no D1');

console.log('OK v1.0.126 - telefone persistido e exibido nas bases de Motoristas e Ajudantes.');
