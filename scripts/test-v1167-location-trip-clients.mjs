import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { onRequestGet } from '../functions/api/clients.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function makeStatement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0)}};}};return api;}
const db={prepare:makeStatement,async batch(statements){const out=[];for(const stmt of statements)out.push(await stmt.all());return out;}};
const env={DB:db};

sqlite.prepare(`INSERT INTO ROUTE_USERS (ID,NAME,EMAIL,ROLE,PASSWORD_HASH,SALT) VALUES (1,'Admin QA','a@qa.local','ADMIN','x','y')`).run();
sqlite.prepare(`INSERT INTO ROUTE_SESSIONS (TOKEN,USER_ID,EXPIRES_AT) VALUES ('tok',1,?)`).run(new Date(Date.now()+86400000).toISOString());
const today=new Date().toISOString().slice(0,10);
const client=(id,code,name,lat,lng)=>sqlite.prepare(`INSERT INTO BASE_CLIENTES (ID,CODIGO,NOME,LATITUDE,LONGITUDE,CIDADE,UF,ATIVO) VALUES (?,?,?,?,?,'CARUARU','PE',1)`).run(id,code,name,lat,lng);
client('C1','1001','MERCADO UM',-8.28,-35.97);client('C2','1002','MERCADO DOIS',-8.30,-35.99);client('C3','1003','MERCADO TRES',-8.31,-35.95);client('C4','2001','OUTRA ROTA',-8.40,-36.00);
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES ('S1',?,'EM ROTA','ABC-1D23','MOTORISTA','AG1 CARUARU','{}')`).run(today);
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES ('S2',?,'FINALIZADO','ZZZ-9Z99','MOTORISTA','AG2','{}')`).run(today);
const delivery=(schedule,code,name,seq,delivered,returned,lat=null,lng=null)=>sqlite.prepare(`INSERT INTO LINCROS_DELIVERIES (SCHEDULE_ID,LINCROS_ROUTE_CODE,DELIVERY_CODE,CLIENT_CODE,CLIENT_NAME,SEQUENCE_PLANNED,DELIVERED,RETURNED,PENDING,LATITUDE,LONGITUDE) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(schedule,'R',`${schedule}-${code}-${seq}`,code,name,seq,delivered,returned,delivered||returned?0:1,lat,lng);
delivery('S1','1001','MERCADO UM',1,1,0);
delivery('S1','1002','MERCADO DOIS',2,0,0);
delivery('S1','1003','MERCADO TRES',3,0,1);
delivery('S1','9999','SEM CADASTRO COM GPS',4,0,0,-8.5,-36.1);
delivery('S1','8888','SEM CADASTRO NEM GPS',5,0,0);
delivery('S2','2001','OUTRA ROTA',1,1,0);

const get=async(query)=>{const response=await onRequestGet({env,request:new Request(`https://rota.test/api/clients${query}`,{headers:{authorization:'Bearer tok'}})});return {status:response.status,body:await response.json()};};
const result=await get('?plate=abc1d23');
assert.equal(result.status,200);
assert.equal(result.body.trip.scheduleId,'S1');
assert.equal(result.body.trip.route,'AG1 CARUARU');
assert.deepEqual(result.body.records.map((r)=>r.code),['1001','1002','1003','9999'],'somente clientes da viagem do carro (sem a 2001 de outra rota)');
assert.deepEqual(result.body.records.map((r)=>r.tripState),['ENTREGUE','PENDENTE','DEVOLVIDO','PENDENTE']);
assert.equal(result.body.semCoordenadas,1,'cliente sem cadastro e sem GPS é contado à parte');
assert.equal(result.body.entregas,5);
assert.deepEqual(result.body.resumo,{entregues:1,pendentes:3,devolvidos:1});
assert.equal(result.body.records.find((r)=>r.code==='9999').latitude,-8.5,'sem cadastro usa a posição da própria entrega');
// IDs candidatos: entregas gravadas com schedule_record_id (diferente do SCHEDULE_ID do monitoramento).
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES ('MON-3',?,'EM ROTA','SMX-0A05','MOTORISTA','AG1 CARUARU',?)`).run(today,JSON.stringify({schedule_record_id:'REC-3'}));
delivery('REC-3','1001','MERCADO UM',1,0,0);delivery('REC-3','1003','MERCADO TRES',2,0,0);
const viaRecord=await get('?plate=SMX0A05');
assert.deepEqual(viaRecord.body.records.map((r)=>r.code),['1001','1003'],'usa schedule_record_id do monitoramento para achar as entregas Lincros');
// Sem monitoramento da placa: sincronização Lincros da placa e dica da tela.
sqlite.prepare(`INSERT INTO LINCROS_ROUTE_SYNC (SCHEDULE_ID,DATE_KEY,PLATE,DMS_ROUTE) VALUES ('SYNC-4',?,'QRS1T23','AG2 GARANHUNS')`).run(today);
delivery('SYNC-4','1002','MERCADO DOIS',1,0,0);
const viaSync=await get('?plate=QRS1T23');
assert.deepEqual(viaSync.body.records.map((r)=>r.code),['1002'],'cai para a sincronização Lincros da placa');
assert.equal(viaSync.body.trip.route,'AG2 GARANHUNS');
delivery('HINT-5','1003','MERCADO TRES',1,0,0);
const viaHint=await get('?plate=HHH1H11&schedule=NADA,HINT-5');
assert.deepEqual(viaHint.body.records.map((r)=>r.code),['1003'],'usa o ID de escala informado pela tela');
const hintNoDeliveries=await get('?plate=HHH1H11&schedule=SEM-ENTREGAS');
assert.equal(hintNoDeliveries.body.records.length,0);assert.ok(hintNoDeliveries.body.trip,'viagem conhecida sem entregas continua sendo viagem (mapa não volta a mostrar a cidade)');
// Carro sem viagem em aberto: nada a filtrar.
const idle=await get('?plate=ZZZ9Z99');assert.equal(idle.body.trip,null);assert.equal(idle.body.records.length,0);
const unknown=await get('?plate=NAOEXISTE');assert.equal(unknown.body.trip,null);
// Busca por texto continua funcionando.
assert.equal((await get('?q=MERCADO')).body.mode,'SEARCH');

// Tela: seleção/filtro do veículo mostra só os clientes da viagem.
const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
assert(route.includes('/api/clients?plate=${encodeURIComponent(plate)}'));
assert(route.includes('if(routeTripClients){renderRouteClients(routeTripClients.records,{tripMode:true});return;}'),'mapa usa só os clientes da viagem quando um veículo em rota está ativo');
assert(route.includes('focusPlate(row.plate);syncTripClients();'),'clicar no veículo ativa os clientes da viagem');
assert(route.includes('displayed.length===1'),'filtrar até sobrar um veículo também ativa');
assert(route.includes('Mostrar todos os clientes'),'há como voltar à visão normal');
assert(route.includes('sem lista de clientes da Lincros para esta placa'),'carro em rota sem lista não mostra a cidade inteira');
console.log('OK v1167 - veículo em rota selecionado/filtrado mostra no mapa somente os clientes da viagem.');
