import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import fs from 'node:fs';
import { join } from 'node:path';
import { onRequestPut } from '../functions/api/colaboradores.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const routeJs=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const appJs=fs.readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
const colaboradoresJs=fs.readFileSync(new URL('../functions/api/colaboradores.js',import.meta.url),'utf8');

assert.equal(pkg.version,'1.0.158');
assert.match(html,/dms-rota-v1141-login-sessao-20260924/);
assert.match(colaboradoresJs,/ensureRestrictionColumns/,'cadastro deve autorreparar colunas de restrição ausentes');
assert.match(colaboradoresJs,/ALTER TABLE .*RESTRICAO_MOTORISTA/,'autorreparo deve criar restrição de motorista');
assert.match(colaboradoresJs,/ALTER TABLE .*RESTRICAO_AJUDANTE/,'autorreparo deve criar restrição de ajudante');
assert.match(appJs,/persistedRestriction/,'front-end deve validar que a restrição foi efetivamente persistida');
assert.match(routeJs,/text:'#111111',muted:'#2a2a2a',line:'#777777'/,'quadro operacional deve usar paleta de alto contraste para P&B');
assert.match(routeJs,/drawWrapped\(safe\(item\.ajudantes\).*'700',C\.muted/,'ajudantes devem ser impressos com peso maior');
assert.match(routeJs,/drawText\(departureText.*'800',C\.text/,'horário deve sair em texto escuro e forte');
assert.match(routeJs,/drawText\(`OC \$\{ocValue\}`.*'800',C\.text/,'OC deve sair em texto escuro e forte');

// Reproduz banco antigo já publicado sem migrations 0027/0028.
const sqlite=new DatabaseSync(':memory:');
const migrationFiles=(await readdir(join(root,'migrations')))
  .filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x))
  .filter((x)=>Number(String(x).slice(0,4))<=26)
  .sort();
for(const file of migrationFiles) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
let cols=sqlite.prepare('PRAGMA table_info(BASE_COLABORADORES)').all().map((x)=>String(x.name).toUpperCase());
assert.equal(cols.includes('RESTRICAO_MOTORISTA'),false,'pré-condição: banco antigo não deve ter a coluna de motorista');
assert.equal(cols.includes('RESTRICAO_AJUDANTE'),false,'pré-condição: banco antigo não deve ter a coluna de ajudante');

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

sqlite.prepare(`INSERT INTO ROUTE_USERS (ID,NAME,EMAIL,ROLE,PASSWORD_HASH,SALT,ACTIVE,PERMISSIONS_JSON,BASES_JSON) VALUES (1,'ADMIN TESTE','admin@teste.local','ADMIN','x','y',1,'[]','["route"]')`).run();
sqlite.prepare(`INSERT INTO ROUTE_SESSIONS (TOKEN,USER_ID,EXPIRES_AT) VALUES ('token-v179',1,'2099-12-31T23:59:59.000Z')`).run();
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES ('M179','13250','MOTORISTA TESTE','MOTORISTA','PRÓPRIO','DISPONÍVEL',1)`).run();

const request=new Request('https://dms.local/api/colaboradores',{
  method:'PUT',
  headers:{'Authorization':'Bearer token-v179','Content-Type':'application/json'},
  body:JSON.stringify({id:'M179',matricula:'13250',nome:'MOTORISTA TESTE',funcao:'MOTORISTA',vinculo:'PRÓPRIO',status:'DISPONÍVEL',restricao_motorista:'1',ativo:'1'}),
});
const response=await onRequestPut({env:{DB:db},request});
const payload=await response.json();
assert.equal(response.status,200,`PUT deveria salvar restrição: ${JSON.stringify(payload)}`);
assert.equal(payload.record?.restricao_motorista,true,'API deve devolver restrição persistida como true');
cols=sqlite.prepare('PRAGMA table_info(BASE_COLABORADORES)').all().map((x)=>String(x.name).toUpperCase());
assert.equal(cols.includes('RESTRICAO_MOTORISTA'),true,'autorreparo deve criar coluna de motorista');
assert.equal(cols.includes('RESTRICAO_AJUDANTE'),true,'autorreparo deve criar coluna de ajudante');
assert.equal(Number(sqlite.prepare(`SELECT RESTRICAO_MOTORISTA FROM BASE_COLABORADORES WHERE ID='M179'`).get().RESTRICAO_MOTORISTA),1,'restrição deve permanecer gravada no D1');

console.log('OK: v1.0.80 autorrepara restrições no D1 e reforça contraste da impressão em preto e branco.');
