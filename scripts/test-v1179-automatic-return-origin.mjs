import fs from 'node:fs';
import assert from 'node:assert/strict';
const ret=fs.readFileSync(new URL('../functions/_lib/return.js',import.meta.url),'utf8');
const dep=fs.readFileSync(new URL('../functions/_lib/departure.js',import.meta.url),'utf8');
// Retorno/saída automáticos por GPS nunca são gravados como o usuário logado que abriu a tela.
assert.match(ret,/const systemUser=\{\.\.\.GPS_AUTOMATION_USER\};/,'retorno automático usa a identidade AUTOMAÇÃO GPS');
assert.doesNotMatch(ret,/const systemUser=user\|\|/,'não reaproveita o usuário logado');
assert.match(dep,/autoConfirmDeparturesFromGps\(db,callerUser,positions=\[\],options=\{\}\)\{[\s\S]{0,260}const user=\{\.\.\.GPS_AUTOMATION_USER\};/,'saída automática usa a identidade AUTOMAÇÃO GPS');
// Retornos antigos criados pela automação com o usuário logado deixam de aparecer como edição manual.
assert.match(ret,/createdByGpsAutomation/);assert.match(ret,/gpsOriginIds\.has\(id\)&&normalizeText\(storedManual\)===normalizeText\(creatorName/);
console.log('OK v1179 - retorno/saída automáticos aparecem como automação, não como finalização manual.');
// Funcional: retorno antigo criado pela automação com o usuário logado aparece como automático (GPS), não manual.
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { listReturns } from '../functions/_lib/return.js';
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function makeStatement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:info.changes,last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare:makeStatement};
const data=JSON.stringify({placa:'AAA1A11',motorista:'EDSON BEZERRA DE VASCONCELOS',rota:'AG2 PETROLANDIA',retorno_real:'2026-10-14T08:00:00',origem:'GPS',observacoes:'RETORNO AUTOMÁTICO GPS: veículo identificado novamente em uma referência da unidade',ultima_edicao_por:'Ewerton Diogo',ultima_edicao_em:'2026-10-14T08:01:00Z',status:'FINALIZADO'});
sqlite.prepare(`INSERT INTO ROUTE_RETURNS (ID,SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON) VALUES (1,'ESC-1','2026-10-13','FINALIZADO','AAA1A11','EDSON BEZERRA DE VASCONCELOS','AG2 PETROLANDIA','2026-10-14 08:00:00',?)`).run(data);
// Auditoria da época: a automação gravou como o usuário logado.
sqlite.prepare(`INSERT INTO ROUTE_AUDIT (USER_ID,USER_NAME,ACTION,MODULE,RECORD_ID) VALUES (7,'Ewerton Diogo','CRIAR','returns',1)`).run();
let rows=await listReturns(db,{id:7,role:'ADMIN'},{start:'2026-10-01',end:'2026-10-31'});
let row=rows.find((r)=>Number(r.id)===1);
assert.ok(row,'retorno listado');
assert.equal(row.ultima_edicao_por||'','','criação pela automação não é edição manual do usuário');
assert.match(row.ultima_atualizacao_automatica_por||'', /AUTOMA/,'consta como automação GPS');
// Uma edição manual real posterior continua aparecendo como manual.
sqlite.prepare(`INSERT INTO ROUTE_AUDIT (USER_ID,USER_NAME,ACTION,MODULE,RECORD_ID) VALUES (7,'Ewerton Diogo','EDITAR','returns',1)`).run();
rows=await listReturns(db,{id:7,role:'ADMIN'},{start:'2026-10-01',end:'2026-10-31'});
row=rows.find((r)=>Number(r.id)===1);
assert.equal(row.ultima_edicao_por,'Ewerton Diogo','edição manual real continua registrada');
console.log('OK v1179b - origem automática preservada no histórico de retornos.');
