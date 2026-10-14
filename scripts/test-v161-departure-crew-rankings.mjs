import assert from 'node:assert/strict';
import { buildDepartureCrewRankings } from '../functions/_lib/departure.js';

const rows=[
  {schedule:{motorista:'MOTORISTA A',ajudante_1:'AJUDANTE A',ajudante_2:'AJUDANTE B'},departure:{motorista:'MOTORISTA A',ajudante_1:'AJUDANTE A',ajudante_2:'AJUDANTE B'},delayMinutes:45},
  {schedule:{motorista:'MOTORISTA A',ajudante_1:'AJUDANTE A'},departure:{motorista:'MOTORISTA A',ajudante_1:'AJUDANTE A'},delayMinutes:15},
  {schedule:{motorista:'MOTORISTA B',ajudante_1:'AJUDANTE C'},departure:{motorista:'MOTORISTA B',ajudante_1:'AJUDANTE C'},delayMinutes:20},
];
const result=buildDepartureCrewRankings(rows,30);
const driverA=result.drivers.find((x)=>x.name==='MOTORISTA A');
const driverB=result.drivers.find((x)=>x.name==='MOTORISTA B');
const helperA=result.helpers.find((x)=>x.name==='AJUDANTE A');
assert.equal(driverA.departures,2);
assert.equal(driverA.delayOccurrences,1);
assert.equal(driverA.withinTolerance,1);
assert.equal(driverA.totalDelayMinutes,60);
assert.equal(driverA.averageDelayMinutes,30);
assert.equal(driverA.status,'ATRASO');
assert.equal(driverB.delayOccurrences,0);
assert.equal(driverB.status,'DENTRO_TOLERANCIA');
assert.equal(helperA.departures,2);
assert.equal(helperA.totalDelayMinutes,60);

const helperFiltered=buildDepartureCrewRankings(rows,30,{helperFilter:'AJUDANTE B'});
assert.deepEqual(helperFiltered.helpers.map((x)=>x.name),['AJUDANTE B']);

const routeJs=await (await import('node:fs/promises')).readFile(new URL('../public/assets/route.js',import.meta.url),'utf8');
assert.match(routeJs,/indicatorFilterSelect\(`\$\{prefix\}-helper`,'Ajudante'/);
assert.match(routeJs,/Ranking · ocorrências de atraso/);
assert.match(routeJs,/Ranking · tempo total de atraso/);
assert.match(routeJs,/Ranking · tempo médio de atraso/);
assert.match(routeJs,/departure-rank-row/);
console.log('v1.0.61 departure crew rankings: ok');
