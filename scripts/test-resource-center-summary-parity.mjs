import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { buildResourceCenter } from '../functions/_lib/core.js';
import { buildFleetOverview } from '../functions/_lib/route-dashboard.js';
import { monitoringSummary } from '../functions/_lib/monitoring.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function makeStatement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare:makeStatement,async batch(stmts){const out=[];sqlite.exec('BEGIN');try{for(const s of stmts)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const user={id:1,name:'Teste Paridade',email:'paridade@test.local',role:'ADMIN',bases:['route'],permissions:['*']};

// Cenário equivalente ao problema observado: 48 placas em Monitoramento ativo,
// 3 delas explicitamente em PERNOITE. Oito placas não estão no cadastro mestre e
// parte da frota cadastrada é terceira.
for(let i=1;i<=40;i+=1){
  const plate=`T${String(i).padStart(2,'0')}X${String(100+i).slice(-3)}`;
  sqlite.prepare("INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)")
    .run(`V${i}`,plate,'TRUCK',i%5===0?'TERCEIRO':'PRÓPRIO','DISPONÍVEL');
}
for(let i=1;i<=48;i+=1){
  const plate=i<=40?`T${String(i).padStart(2,'0')}X${String(100+i).slice(-3)}`:`H${String(i).padStart(2,'0')}Z${String(200+i).slice(-3)}`;
  const status=i<=3?'PERNOITE':'EM ROTA';
  const data={data:'2026-08-26',status,status_monitoramento:status,placa:plate,rota:`ROTA ${i}`,hora_real:'06:00'};
  sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (NULL,?,?,?,?,?,?)`)
    .run('2026-08-26',status,plate,'',`ROTA ${i}`,JSON.stringify(data));
}

const resumo=await monitoringSummary(db,user,{});
const center=await buildResourceCenter(db);
const fleet=buildFleetOverview(center);
const activeVehicles=center.vehicles.filter((item)=>['EM ROTA','PERNOITE'].includes(item.status));

assert.equal(resumo.summary.carsInRoute,48,'Resumo deve enxergar as 48 placas ativas');
assert.equal(resumo.summary.monitoringOvernights,3,'Resumo deve enxergar 3 pernoites explícitos');
assert.equal(activeVehicles.length,48,'Central deve bloquear as mesmas 48 placas do Monitoramento');
assert.equal(fleet.inRoute.total,48,'Card Em rota da Central deve usar o mesmo total operacional do Resumo');
assert.equal(fleet.overnight.total,3,'Pernoite da Central deve ser subconjunto explícito e igual ao Resumo');
assert.equal(center.vehicles.filter((item)=>item.status==='DISPONÍVEL').length,0,'nenhuma das 48 placas ativas pode aparecer disponível');
assert.ok(center.vehicles.some((item)=>item.resourceName.startsWith('H41Z')),'placas operacionais ausentes do cadastro também devem ser materializadas');

console.log('OK: paridade Resumo x Central validada com 48 carros em rota, 3 pernoites, terceiros e placas históricas fora do cadastro.');
