import fs from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getOperationalPendingAudit,
  getOperationalOccurrenceIndicators,
  justifyOperationalOccurrence,
} from '../functions/_lib/operational-pending.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const protect=fs.readFileSync(new URL('../functions/api/protectsat.js',import.meta.url),'utf8');
const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../migrations/0036_operational_occurrence_monitoring_audit.sql',import.meta.url),'utf8');

assert.equal(pkg.version,'1.0.158');
assert.match(migration,/ROUTE_OPERATIONAL_JUSTIFICATION_HISTORY/i);
assert(protect.includes('GPS_STOP_OCCURRENCE_RETAIL_MINUTES=20'),'varejo deve abrir ocorrência em 20 min');
assert(protect.includes('GPS_STOP_OCCURRENCE_NETWORK_MINUTES=60'),'Rede deve abrir ocorrência em 60 min');
assert(protect.includes("FROM LINCROS_DELIVERIES"),'escopo de clientes deve vir das entregas Lincros da viagem');
assert(protect.includes('clientBelongsToTrip(client,entry.scope)'),'cliente próximo deve ser filtrado pela viagem ativa');
assert(route.includes('Nenhum cliente desta viagem em até 100 m'),'Monitoramento deve deixar explícito o escopo da viagem');
assert(route.includes('Quantidade de ocorrências por período'),'Indicadores devem exibir quantidade por período');
for(const label of ['Diária','Semanal','Mensal','Desempenho por monitor responsável','Histórico para auditoria','Histórico de alterações das justificativas'])assert(route.includes(label),`Indicadores devem exibir ${label}`);
assert(app.includes('setInterval(()=>pollOperationalNotifications(),30000)'),'alertas devem verificar novas ocorrências a cada 30 s');
assert(app.includes('ambos recebem todas as novas ocorrências'),'tela deve orientar que Fernanda e João Victor recebem todos os alertas');
assert(app.includes('window.enableOperationalNotifications=enableOperationalNotifications'),'módulo Rota deve poder ativar alertas nativos');
assert(app.includes('window.operationalNotificationsEnabled=operationalNotificationsEnabled'),'módulo Rota deve ler o estado dos alertas nativos');
assert(index.includes('route.js?rev=dms-rota-v1141-login-sessao-20260924'));
assert(index.includes('app.js?rev=dms-rota-v1141-login-sessao-20260924'));
assert(index.includes('app.css?rev=dms-rota-v1141-login-sessao-20260924'));

const sqlite=new DatabaseSync(':memory:');
const migrationFiles=(await readdir(join(root,'migrations'))
  .then((files)=>files.filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()));
for(const file of migrationFiles){
  try{sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));}catch(error){
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

function insertOccurrence({key,route,plate,driver,minutes,detected='2026-09-22 08:00:00'}){
  sqlite.prepare(`INSERT INTO ROUTE_GPS_OCCURRENCES
    (OCCURRENCE_KEY,TYPE,PRIORITY,DATE_KEY,PLATE,ROUTE,DRIVER_NAME,SCHEDULE_ID,STARTED_AT,DETECTED_AT,LAST_SEEN_AT,LOCATION_TEXT,STOPPED_MINUTES,IGNITION,DETAILS,DATA_JSON)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      key,'PARADA_ACIMA_20_MIN','MÉDIA','2026-09-22',plate,route,driver,`S-${key}`,'2026-09-22 07:40:00',detected,'2026-09-22 08:10:00','LOCAL TESTE',minutes,0,'Teste de parada',JSON.stringify({active:true}),
    );
}
insertOccurrence({key:'VAREJO_AG1',route:'AG1 CARUARU',plate:'AAA1A11',driver:'MOTORISTA A',minutes:25});
insertOccurrence({key:'REDE_AG1_CURTA',route:'AG1 CARUARU REDES',plate:'BBB2B22',driver:'MOTORISTA B',minutes:30});
insertOccurrence({key:'REDE_AG1_1H',route:'AG1 CARUARU REDES',plate:'CCC3C33',driver:'MOTORISTA C',minutes:65});
insertOccurrence({key:'VAREJO_AG2',route:'AG2 GARANHUNS',plate:'DDD4D44',driver:'MOTORISTA D',minutes:22});
insertOccurrence({key:'VAREJO_SRT',route:'SRT ARCOVERDE',plate:'EEE5E55',driver:'MOTORISTA E',minutes:25});

const pending=await getOperationalPendingAudit(db,{id:1,name:'TESTE'},{start:'2026-09-22',end:'2026-09-22'});
const pendingByKey=new Map(pending.records.map((row)=>[row.key,row]));
assert.equal(pendingByKey.has('VAREJO_AG1'),true,'AG1 varejo deve abrir em 20 min');
assert.equal(pendingByKey.has('REDE_AG1_CURTA'),false,'Rede com 30 min não deve abrir ocorrência');
assert.equal(pendingByKey.has('REDE_AG1_1H'),true,'Rede com 65 min deve abrir ocorrência');
assert.equal(pendingByKey.get('VAREJO_AG1').monitorResponsavel,'FERNANDA');
assert.equal(pendingByKey.get('VAREJO_AG2').monitorResponsavel,'FERNANDA');
assert.equal(pendingByKey.get('REDE_AG1_1H').monitorResponsavel,'JOÃO VICTOR');
assert.equal(pendingByKey.get('VAREJO_SRT').monitorResponsavel,'JOÃO VICTOR');
assert.equal(pendingByKey.get('REDE_AG1_1H').related.stopThresholdMinutes,60);
assert.equal(pendingByKey.get('VAREJO_AG1').related.stopThresholdMinutes,20);

const user={id:7,name:'FERNANDA'};
const first=await justifyOperationalOccurrence(db,user,{key:'VAREJO_AG1',justification:'Cliente em processo de recebimento'});
await new Promise((resolve)=>setTimeout(resolve,5));
const second=await justifyOperationalOccurrence(db,{id:8,name:'JOÃO VICTOR'},{key:'VAREJO_AG1',justification:'Recebimento concluído e veículo liberado'});
assert.equal(second.firstJustifiedAt,first.firstJustifiedAt,'alteração não deve substituir horário da primeira justificativa');
const main=sqlite.prepare(`SELECT JUSTIFIED_AT,JUSTIFIED_BY_NAME,JUSTIFICATION FROM ROUTE_OPERATIONAL_JUSTIFICATIONS WHERE OCCURRENCE_KEY='VAREJO_AG1'`).get();
assert.equal(main.JUSTIFIED_AT,first.firstJustifiedAt);
assert.equal(main.JUSTIFIED_BY_NAME,'JOÃO VICTOR','último usuário pode alterar justificativa sem apagar o primeiro horário');
const history=sqlite.prepare(`SELECT ACTION,JUSTIFIED_BY_NAME FROM ROUTE_OPERATIONAL_JUSTIFICATION_HISTORY WHERE OCCURRENCE_KEY='VAREJO_AG1' ORDER BY ID`).all();
assert.deepEqual(history.map((x)=>x.ACTION),['PRIMEIRO REGISTRO','ALTERAÇÃO']);
assert.deepEqual(history.map((x)=>x.JUSTIFIED_BY_NAME),['FERNANDA','JOÃO VICTOR']);

const indicators=await getOperationalOccurrenceIndicators(db,{start:'2026-09-22',end:'2026-09-22'});
const indicatorByKey=new Map(indicators.records.map((row)=>[row.key,row]));
assert.equal(indicatorByKey.has('REDE_AG1_CURTA'),false,'Indicadores também devem excluir parada de Rede abaixo de 1h');
assert.equal(indicatorByKey.get('VAREJO_AG1').monitorResponsible,'FERNANDA');
assert.equal(indicatorByKey.get('REDE_AG1_1H').monitorResponsible,'JOÃO VICTOR');
assert.equal(indicators.byDay.length,1,'deve consolidar quantidade diária');
assert.equal(indicators.byWeek.length,1,'deve consolidar quantidade semanal');
assert.equal(indicators.byOccurrenceMonth.length,1,'deve consolidar quantidade mensal');
assert.equal(indicators.auditHistory.some((row)=>row.key==='VAREJO_AG1'&&row.justifiedBy==='JOÃO VICTOR'),true,'auditoria deve conter a ocorrência justificada');
assert.equal(indicators.justificationHistory.filter((row)=>row.key==='VAREJO_AG1').length,2,'histórico deve preservar as duas gravações');

console.log('OK v1.0.131 - clientes por viagem, limiares 20/60, responsáveis, auditoria e alertas validados.');
