import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/trip-timeline.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function makeStatement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare:makeStatement,async batch(stmts){const out=[];sqlite.exec('BEGIN');try{for(const s of stmts)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};

sqlite.prepare(`INSERT INTO ROUTE_USERS (ID,NAME,EMAIL,ROLE,PASSWORD_HASH,SALT,ACTIVE,PERMISSIONS_JSON,BASES_JSON) VALUES (1,'Teste','teste@local','ADMIN','x','y',1,'[]','["route"]')`).run();
sqlite.prepare(`INSERT INTO ROUTE_SESSIONS (TOKEN,USER_ID,EXPIRES_AT) VALUES ('token-history',1,'2099-01-01T00:00:00.000Z')`).run();
const scheduleId='ESC-HISTORY-1';
sqlite.prepare(`INSERT INTO ROUTE_DEPARTURES (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,ACTUAL_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?,?)`).run(scheduleId,'2026-08-26','SAIU','ABC1D23','MOTORISTA TESTE','SRT TESTE','2026-08-26T06:00:00',JSON.stringify({origem_saida:'GPS_GEOFENCE',saida_real:'2026-08-26T06:00:00'}));
sqlite.prepare(`INSERT INTO ROUTE_CLIENT_ARRIVALS (SCHEDULE_ID,PLATE,CLIENT_ID,CLIENT_NAME,ARRIVED_AT,LAST_SEEN_AT,LEFT_AT,LATITUDE,LONGITUDE) VALUES (?,?,?,?,?,?,?,?,?)`).run(scheduleId,'ABC1D23','C1','CLIENTE 1','2026-08-26T08:00:00','2026-08-26T08:15:00','2026-08-26T08:20:00',-8.1,-36.1);
sqlite.prepare(`INSERT INTO ROUTE_CLIENT_ARRIVALS (SCHEDULE_ID,PLATE,CLIENT_ID,CLIENT_NAME,ARRIVED_AT,LAST_SEEN_AT,LEFT_AT,LATITUDE,LONGITUDE) VALUES (?,?,?,?,?,?,?,?,?)`).run(scheduleId,'ABC1D23','C1-LEGADO','CLIENTE 1','2026-08-26T08:00:00','2026-08-26T08:18:00','2026-08-26T08:25:00',-8.1,-36.1);
sqlite.prepare(`INSERT INTO ROUTE_RETURNS (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?,?)`).run(scheduleId,'2026-08-26','FINALIZADO','ABC1D23','MOTORISTA TESTE','SRT TESTE','2026-08-26T12:00:00',JSON.stringify({origem:'GPS',retorno_real:'2026-08-26T12:00:00'}));
for(const [at,point,speed,ignition] of [
  ['2026-08-26T06:05:00','BR-232 KM 180',45,1],
  ['2026-08-26T08:00:00','CLIENTE 1',0,1],
  ['2026-08-26T11:55:00','BELO JARDIM',25,1],
]) sqlite.prepare(`INSERT INTO ROUTE_GPS_POSITIONS (PLATE,LATITUDE,LONGITUDE,GPS_TIME,FETCHED_AT,LOCATION_TEXT,POINT_TEXT,SPEED,IGNITION) VALUES (?,?,?,?,?,?,?,?,?)`).run('ABC1D23',-8.2,-36.2,at,at,point,point,speed,ignition);

const request=new Request(`http://local/api/trip-timeline?scheduleIds=${encodeURIComponent(scheduleId)}&plate=ABC1D23&startAt=2026-08-26T06:00:00&endAt=2026-08-26T12:00:00&includeGps=1&gpsLimit=2000`,{headers:{Authorization:'Bearer token-history'}});
const response=await onRequestGet({env:{DB:db},request});
assert.equal(response.status,200);
const payload=await response.json();
assert.equal(payload.timelines[scheduleId].length,3,'linha do tempo deve ter saída, cliente e retorno');
assert.equal(payload.timelines[scheduleId].find((event)=>event.type==='CLIENTE')?.leftAt,'2026-08-26T08:25:00','duplicidade histórica do mesmo cliente/chegada deve ser consolidada preservando a saída mais recente');
assert.equal(payload.gpsRecords.length,3,'deve retornar posições GPS do intervalo da viagem');
assert.equal(payload.gpsRecords[1].point,'CLIENTE 1');
assert.equal(payload.gpsTruncated,false);
console.log('OK: detalhes históricos retornam marcos da viagem e registros GPS do intervalo saída→retorno.');
