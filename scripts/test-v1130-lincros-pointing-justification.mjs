import fs from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { onRequestPost } from '../functions/api/indicators.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const lib=fs.readFileSync(new URL('../functions/_lib/indicators.js',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../functions/api/indicators.js',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../migrations/0035_lincros_pointing_justification.sql',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));

assert.equal(pkg.version,'1.0.158');
assert.match(migration,/ROUTE_LINCROS_POINTING_JUSTIFICATIONS/i);
assert(lib.includes("['SEM CELULAR','CELULAR QUEBRADO','MOTORISTA NÃO APONTOU']"),'backend deve limitar as três justificativas solicitadas');
assert(api.includes("POINTING_JUSTIFICATION"),'API de indicadores deve aceitar gravação da justificativa');
assert(route.includes('data-pointing-justification'),'tabela de apontamento deve permitir escolher justificativa');
for(const label of ['Sem Celular','Celular Quebrado','Motorista não apontou'])assert(route.includes(label),`frontend deve exibir a opção ${label}`);
assert(index.includes('route.js?rev=dms-rota-v1141-login-sessao-20260924'),'cache-busting do frontend deve refletir a v1.0.131');
assert(index.includes('app.css?rev=dms-rota-v1141-login-sessao-20260924'),'cache-busting do CSS deve refletir a v1.0.131');

const sqlite=new DatabaseSync(':memory:');
const migrationFiles=(await readdir(join(root,'migrations')))
  .filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x))
  .sort();
for(const file of migrationFiles){
  try{sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));}catch(error){
    // Algumas migrations antigas são defensivas e podem tentar recriar estruturas já existentes.
    if(!/duplicate column name|already exists/i.test(String(error?.message||error)))throw error;
  }
}
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
sqlite.prepare(`INSERT INTO ROUTE_SESSIONS (TOKEN,USER_ID,EXPIRES_AT) VALUES ('token-v1130',1,'2099-12-31T23:59:59.000Z')`).run();
sqlite.prepare(`INSERT OR REPLACE INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES ('S130','2026-09-20','FINALIZADO','ABC1D23','MOTORISTA TESTE','AG1 TESTE','{"motorista":"MOTORISTA TESTE","rota":"AG1 TESTE","placa":"ABC1D23"}')`).run();

const saveRequest=new Request('https://dms.local/api/indicators',{
  method:'POST',headers:{Authorization:'Bearer token-v1130','Content-Type':'application/json'},
  body:JSON.stringify({action:'POINTING_JUSTIFICATION',scheduleIds:['S130'],driver:'MOTORISTA TESTE',justification:'Sem Celular'}),
});
const saveResponse=await onRequestPost({env:{DB:db},request:saveRequest});
const savePayload=await saveResponse.json();
assert.equal(saveResponse.status,200,`deve salvar justificativa: ${JSON.stringify(savePayload)}`);
let saved=sqlite.prepare(`SELECT * FROM ROUTE_LINCROS_POINTING_JUSTIFICATIONS WHERE SCHEDULE_ID='S130'`).get();
assert.equal(saved.JUSTIFICATION,'SEM CELULAR');
assert.equal(saved.DRIVER_NAME,'MOTORISTA TESTE');
assert.equal(saved.PLATE,'ABC1D23');

const invalidRequest=new Request('https://dms.local/api/indicators',{
  method:'POST',headers:{Authorization:'Bearer token-v1130','Content-Type':'application/json'},
  body:JSON.stringify({action:'POINTING_JUSTIFICATION',scheduleIds:['S130'],justification:'Outro motivo'}),
});
const invalidResponse=await onRequestPost({env:{DB:db},request:invalidRequest});
assert.equal(invalidResponse.status,400,'motivos fora da lista devem ser recusados');

const clearRequest=new Request('https://dms.local/api/indicators',{
  method:'POST',headers:{Authorization:'Bearer token-v1130','Content-Type':'application/json'},
  body:JSON.stringify({action:'POINTING_JUSTIFICATION',scheduleIds:['S130'],justification:''}),
});
const clearResponse=await onRequestPost({env:{DB:db},request:clearRequest});
assert.equal(clearResponse.status,200,'deve permitir remover a justificativa');
saved=sqlite.prepare(`SELECT * FROM ROUTE_LINCROS_POINTING_JUSTIFICATIONS WHERE SCHEDULE_ID='S130'`).get();
assert.equal(saved,undefined);

console.log('OK v1.0.131 - justificativa de não apontamento Lincros salva, validada e removível.');
