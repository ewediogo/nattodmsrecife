import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { listDomainRows, upsertDomainRow } from '../functions/_lib/route-phase1.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function makeStatement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare:makeStatement,async batch(stmts){const out=[];sqlite.exec('BEGIN');try{for(const s of stmts)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};

sqlite.prepare(`INSERT INTO ROUTE_USERS (ID,NAME,EMAIL,ROLE,PASSWORD_HASH,SALT,ACTIVE,PERMISSIONS_JSON,BASES_JSON) VALUES (7,'Usuário Teste','user@test.local','ADMIN','x','y',1,'[]','["route"]')`).run();
const gpsUser={id:0,name:'AUTOMAÇÃO GPS',email:'',role:'ADMIN',bases:['route'],permissions:['*']};
const human={id:7,name:'Usuário Teste',email:'user@test.local',role:'ADMIN',bases:['route'],permissions:['*']};

const automatic=await upsertDomainRow(db,'returns',{schedule_record_id:'ESC-V142',data:'2026-08-29',status:'FINALIZADO',placa:'ABC1D23',motorista:'MOTORISTA TESTE',rota:'ROTA TESTE',retorno_real:'2026-08-29T12:30',origem:'GPS'},gpsUser);
assert.equal(automatic.ultima_alteracao_tipo,'AUTOMATICA');
assert.equal(automatic.ultima_alteracao_por,'AUTOMAÇÃO GPS');
assert.equal(automatic.ultima_alteracao_origem,'GPS');
assert.ok(automatic.ultima_alteracao_em);
assert.equal(automatic.ultima_edicao_por,'','automação não pode ser registrada como última pessoa que editou');
assert.equal(automatic.ultima_atualizacao_automatica_por,'AUTOMAÇÃO GPS');

await upsertDomainRow(db,'returns',{...automatic,retorno_real:'2026-08-29T12:35',origem:'MANUAL'},human,automatic.id);
let rows=await listDomainRows(db,'returns',{date:'2026-08-29'});
assert.equal(rows.length,1);
assert.equal(rows[0].ultima_alteracao_tipo,'USUARIO','edição humana posterior deve substituir a marca automática');
assert.equal(rows[0].ultima_alteracao_por,'Usuário Teste');
assert.equal(rows[0].ultima_alteracao_origem,'MANUAL');
assert.equal(rows[0].updatedById,7);
assert.equal(rows[0].ultima_edicao_por,'Usuário Teste');
assert.match(rows[0].ultima_edicao_em,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,'horário da edição humana deve ser gravado em relógio local de Recife');
assert.equal(rows[0].ultima_atualizacao_automatica_por,'AUTOMAÇÃO GPS','edição humana não deve apagar a última atualização automática');

await upsertDomainRow(db,'returns',{...rows[0],retorno_real:'2026-08-29T12:36',origem:'GPS'},gpsUser,rows[0].id);
rows=await listDomainRows(db,'returns',{date:'2026-08-29'});
assert.equal(rows[0].ultima_alteracao_tipo,'AUTOMATICA');
assert.equal(rows[0].ultima_edicao_por,'Usuário Teste','GPS posterior não pode sobrescrever a última pessoa que editou');

sqlite.prepare(`INSERT INTO ROUTE_RETURNS (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?,?)`).run('ESC-GPS-LEGACY','2026-08-28','FINALIZADO','DEF4G56','MOTORISTA','ROTA','2026-08-28T10:00',JSON.stringify({data:'2026-08-28',retorno_real:'2026-08-28T10:00',origem:'GPS'}));
rows=await listDomainRows(db,'returns',{date:'2026-08-28'});
assert.equal(rows[0].ultima_alteracao_tipo,'AUTOMATICA','registro GPS legado sem usuário deve ser identificado como automático');
assert.equal(rows[0].ultima_alteracao_origem,'GPS');

const route=await readFile(join(root,'public/assets/route.js'),'utf8');
assert.match(route,/Rastreabilidade da viagem/,'modal precisa mostrar a rastreabilidade no topo');
assert.match(route,/<th>Última edição por usuário<\/th>/,'histórico precisa separar a última edição humana');
assert.match(route,/<th>Última atualização automática<\/th>/,'histórico precisa separar a atualização automática');
assert.match(route,/returnChangeBanner\(r\).*fleet-detail-grid/,'auditoria deve aparecer antes da grade de detalhes');
assert.match(route,/ultima_alteracao_tipo/,'CSV deve exportar o tipo da última alteração');

console.log('OK: última alteração diferencia usuário e automação e aparece no topo dos detalhes.');
