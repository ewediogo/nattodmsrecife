import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { buildResourceCenter } from '../functions/_lib/core.js';
import { listDomainRows, upsertDomainRow } from '../functions/_lib/route-phase1.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function makeStatement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare:makeStatement,async batch(stmts){const out=[];sqlite.exec('BEGIN');try{for(const s of stmts)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};

sqlite.prepare(`INSERT INTO ROUTE_USERS (ID,NAME,EMAIL,ROLE,PASSWORD_HASH,SALT,ACTIVE,PERMISSIONS_JSON,BASES_JSON) VALUES (1,'Silas Operação','silas@test.local','ADMIN','x','y',1,'[]','["route"]')`).run();
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,RESTRICAO_MOTORISTA,ATIVO) VALUES (?,?,?,?,?,?,?,1)`).run('D1','1001','MOTORISTA LIVRE','MOTORISTA','PRÓPRIO','DISPONÍVEL',0);
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,RESTRICAO_MOTORISTA,ATIVO) VALUES (?,?,?,?,?,?,?,1)`).run('D2','1002','MOTORISTA RESTRITO','MOTORISTA','PRÓPRIO','DISPONÍVEL',1);

const center=await buildResourceCenter(db,'',{includeEvents:false});
const free=center.drivers.find((x)=>x.resourceId==='D1');
const restricted=center.drivers.find((x)=>x.resourceId==='D2');
assert.equal(free.restrictedDriver,false,'motorista sem restrição deve permanecer no grupo normal');
assert.equal(restricted.restrictedDriver,true,'motorista sinalizado deve chegar à Central com restrição');
assert.equal(center.summary.motoristasDisponiveisSemRestricao,1);
assert.equal(center.summary.motoristasDisponiveisComRestricao,1);

const user={id:1,name:'Silas Operação',email:'silas@test.local',role:'ADMIN',bases:['route'],permissions:['*']};
await upsertDomainRow(db,'returns',{schedule_record_id:'ESC-V141',data:'2026-08-29',status:'FINALIZADO',placa:'ABC1D23',motorista:'MOTORISTA LIVRE',rota:'TESTE',retorno_real:'2026-08-29T12:00'},user);
let rows=await listDomainRows(db,'returns',{date:'2026-08-29'});
assert.equal(rows.length,1);
assert.equal(rows[0].ultima_edicao_por,'Silas Operação','nova gravação deve persistir o nome do último editor');
assert.equal(rows[0].updatedByName,'Silas Operação','join com ROUTE_USERS deve expor o responsável');
assert.ok(rows[0].ultima_edicao_em,'data/hora da última edição deve estar presente');

// Compatibilidade com registro anterior sem metadado dentro do JSON: UPDATED_BY resolve o nome.
sqlite.prepare(`INSERT INTO ROUTE_RETURNS (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON,UPDATED_BY) VALUES (?,?,?,?,?,?,?,?,?)`).run('ESC-LEGACY-V141','2026-08-28','FINALIZADO','DEF4G56','MOTORISTA RESTRITO','TESTE 2','2026-08-28T13:00',JSON.stringify({data:'2026-08-28',retorno_real:'2026-08-28T13:00'}),1);
rows=await listDomainRows(db,'returns',{date:'2026-08-28'});
assert.equal(rows[0].ultima_edicao_por,'Silas Operação','histórico anterior deve resolver o editor pelo UPDATED_BY');

console.log('OK: restrição de motorista e rastreabilidade da última edição validadas.');
