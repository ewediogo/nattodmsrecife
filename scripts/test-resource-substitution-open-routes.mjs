import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { saveScheduleBatch } from '../functions/_lib/schedule.js';
import { saveDeparture } from '../functions/_lib/departure.js';
import { buildResourceCenter } from '../functions/_lib/core.js';
import { buildFleetOverview } from '../functions/_lib/route-dashboard.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function makeStatement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};}};return api;}
const db={prepare:makeStatement,async batch(stmts){const out=[];sqlite.exec('BEGIN');try{for(const s of stmts)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const user={id:1,name:'Admin Recurso',email:'recurso@test.local',role:'ADMIN',bases:['route'],permissions:['*']};

for(const [id,rota,dias] of [['R1','SRT SALGUEIRO',2],['R2','AG1 CARUARU',1],['R3','SRT ROTA ANTIGA',1]]) sqlite.prepare("INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,?,1)").run(id,rota,rota.startsWith('SRT')?'SRT':'AG1','VAREJO',dias);
for(const [id,placa] of [['V-ORIG','SMX0A17'],['V-SUB','ROC8D77'],['V-OLD','OLD1A23']]) sqlite.prepare("INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)").run(id,placa,'3/4','PRÓPRIO','DISPONÍVEL');
for(const row of [
  ['M-ORIG','1001','MOTORISTA ORIGINAL','MOTORISTA'],['M-SUB','1002','JUAN HENRIQUE TORRES PIMENTEL','MOTORISTA'],['M-OLD','1003','MOTORISTA ROTA ANTIGA','MOTORISTA'],
  ['A-ORIG','2001','AJUDANTE ORIGINAL','AJUDANTE'],['A-SUB','2002','BRUNO CICERO DE OLIVEIRA SILVA','AJUDANTE'],['A-OLD','2003','AJUDANTE ROTA ANTIGA','AJUDANTE'],
]) sqlite.prepare("INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)").run(...row,'PRÓPRIO','DISPONÍVEL');

const first=await saveScheduleBatch(db,user,[{data:'2026-08-26',sequencia:'13',ocs:'2512161',peso_kg:4000,qtd_entregas:10,rota_id:'R1',veiculo_id:'V-ORIG',motorista_id:'M-ORIG',ajudante_1_id:'A-ORIG',tipo_equipe:'UM_AJUDANTE',horario_ponto:'07:00',status:'PROGRAMADO'}],'resource-schedule-1');
assert.equal(first.failed,0);
const schedule=first.records[0];

// Simula exatamente o payload legado da tela: o usuário troca a PLACA, mas o
// veiculo_id ainda vem da escala original. O backend deve reconciliar pela placa.
const departure=await saveDeparture(db,user,{requestId:'resource-departure-1',data:{
  schedule_record_id:String(schedule.id),schedule_storage:schedule.storage,data:'2026-08-26',status:'SAIU',hora_programada:'07:00',hora_real:'07:00',
  veiculo_id:'V-ORIG',placa:'ROC8D77',motorista_id:'M-SUB',motorista:'JUAN HENRIQUE TORRES PIMENTEL',ajudante_1_id:'A-SUB',ajudante_1:'BRUNO CICERO DE OLIVEIRA SILVA',
  justificativa_troca:'Substituição operacional na saída',
}});
assert.equal(departure.record.placa,'ROC8D77');
assert.equal(departure.record.veiculo_id,'V-SUB','placa substituta deve reconciliar o ID do veículo efetivo');

const persisted=sqlite.prepare('SELECT VEICULO_ID,PLACA,MOTORISTA_ID,AJUDANTE_1_ID,STATUS FROM ESCALAS_DIA WHERE ID=?').get(String(schedule.id));
assert.equal(persisted.VEICULO_ID,'V-SUB','Escala deve guardar o veículo efetivamente usado na saída');
assert.equal(persisted.PLACA,'ROC8D77');
assert.equal(persisted.MOTORISTA_ID,'M-SUB');
assert.equal(persisted.AJUDANTE_1_ID,'A-SUB');
assert.equal(persisted.STATUS,'EM ROTA');

// Simula um registro legado em que a Escala permaneceu com os recursos originais,
// apesar de a Saída/Monitoramento terem os recursos substitutos efetivamente usados.
// A v1.0.31 deve resolver a ocupação pela evidência operacional, sem exigir editar
// retroativamente a Escala antiga.
sqlite.prepare('UPDATE ESCALAS_DIA SET VEICULO_ID=?,PLACA=?,MOTORISTA_ID=?,MOTORISTA=?,AJUDANTE_1_ID=?,AJUDANTE_1=? WHERE ID=?')
  .run('V-ORIG','SMX0A17','M-ORIG','MOTORISTA ORIGINAL','A-ORIG','AJUDANTE ORIGINAL',String(schedule.id));

const center=await buildResourceCenter(db,'2026-08-27');
const byId=(id)=>center.resources.find((item)=>String(item.resourceId)===String(id));
assert.equal(byId('V-ORIG')?.status,'DISPONÍVEL','veículo original da Escala deve ser liberado após substituição na saída');
assert.equal(byId('M-ORIG')?.status,'DISPONÍVEL','motorista original deve ser liberado após substituição na saída');
assert.equal(byId('A-ORIG')?.status,'DISPONÍVEL','ajudante original deve ser liberado após substituição na saída');
assert.equal(byId('V-SUB')?.status,'EM ROTA','veículo que realmente saiu deve continuar ocupado; pernoite só pode ser explícito');
assert.equal(byId('M-SUB')?.status,'EM ROTA','motorista que realmente saiu deve continuar ocupado; pernoite só pode ser explícito');
assert.equal(byId('A-SUB')?.status,'EM ROTA','ajudante que realmente saiu deve continuar ocupado; pernoite só pode ser explícito');

const reuseOriginal=await saveScheduleBatch(db,user,[{data:'2026-08-27',sequencia:'14',ocs:'2513000',peso_kg:3000,qtd_entregas:8,rota_id:'R2',veiculo_id:'V-ORIG',motorista_id:'M-ORIG',ajudante_1_id:'A-ORIG',tipo_equipe:'UM_AJUDANTE',horario_ponto:'06:00',status:'PROGRAMADO'}],'resource-reuse-original');
assert.equal(reuseOriginal.failed,0,'recursos substituídos na saída anterior precisam estar livres para nova escala');

const blockEffective=await saveScheduleBatch(db,user,[{data:'2026-08-27',sequencia:'15',ocs:'2513001',peso_kg:3000,qtd_entregas:8,rota_id:'R2',veiculo_id:'V-SUB',motorista_id:'M-SUB',ajudante_1_id:'A-SUB',tipo_equipe:'UM_AJUDANTE',horario_ponto:'06:00',status:'PROGRAMADO'}],'resource-block-effective');
assert.equal(blockEffective.failed,1,'recursos que efetivamente saíram devem permanecer bloqueados enquanto a viagem estiver aberta');

// Regressão da Central: rota antiga ainda aberta deve aparecer mesmo muito além
// da janela normal de 15/30 dias do painel.
const ancient=await saveScheduleBatch(db,user,[{data:'2026-07-01',sequencia:'1',ocs:'OLD-OPEN',peso_kg:2000,qtd_entregas:4,rota_id:'R3',veiculo_id:'V-OLD',motorista_id:'M-OLD',ajudante_1_id:'A-OLD',tipo_equipe:'UM_AJUDANTE',horario_ponto:'05:30',status:'PROGRAMADO'}],'ancient-open-schedule');
assert.equal(ancient.failed,0);
await saveDeparture(db,user,{requestId:'ancient-open-departure',data:{schedule_record_id:String(ancient.records[0].id),schedule_storage:ancient.records[0].storage,data:'2026-07-01',status:'SAIU',hora_programada:'05:30',hora_real:'05:30',veiculo_id:'V-OLD',placa:'OLD1A23',motorista_id:'M-OLD',motorista:'MOTORISTA ROTA ANTIGA',ajudante_1_id:'A-OLD',ajudante_1:'AJUDANTE ROTA ANTIGA'}});
const centerWithAncient=await buildResourceCenter(db,'2026-08-27');
const ancientVehicle=centerWithAncient.resources.find((item)=>item.resourceId==='V-OLD');
assert.equal(ancientVehicle?.status,'EM ROTA','Central deve considerar toda viagem aberta, sem inferir pernoite apenas pela idade');
assert.equal(ancientVehicle?.route,'SRT ROTA ANTIGA');

// A Central usada pela tela não recebe mais uma data de referência. Mesmo sem
// parâmetro, a viagem antiga continua ocupando o recurso até o retorno real.
const globalCenter=await buildResourceCenter(db);
const globalAncientVehicle=globalCenter.resources.find((item)=>item.resourceId==='V-OLD');
assert.equal(globalCenter.globalOperationalView,true,'Central sem data deve operar em visão global');
assert.equal(globalAncientVehicle?.status,'EM ROTA','visão global deve manter rota antiga em aberto ocupando o veículo');


// Regressão crítica: o Resumo contabiliza Monitoramentos ativos mesmo quando não
// existe uma Escala vinculada. A Central deve fazer o mesmo para nunca exibir como
// disponível um veículo/pessoa que efetivamente está em rota.
sqlite.prepare("INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)").run('V-ORPH','ORP1A23','TRUCK','TERCEIRO','DISPONÍVEL');
sqlite.prepare("INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)").run('M-ORPH','3001','MOTORISTA ORFAO','MOTORISTA','TERCEIRO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (NULL,?,?,?,?,?,?)`)
  .run('2026-08-20','PERNOITE','ORP1A23','MOTORISTA ORFAO','ROTA ORFA',JSON.stringify({data:'2026-08-20',status:'PERNOITE',status_monitoramento:'PERNOITE',placa:'ORP1A23',motorista:'MOTORISTA ORFAO',rota:'ROTA ORFA',hora_real:'08:00'}));
// Também cobre uma placa histórica ainda não presente na BASE_VEICULOS.
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (NULL,?,?,?,?,?,?)`)
  .run('2026-08-21','EM ROTA','HIS9Z99','MOTORISTA HISTORICO','ROTA HISTORICA',JSON.stringify({data:'2026-08-21',status:'EM ROTA',status_monitoramento:'EM ROTA',placa:'HIS9Z99',motorista:'MOTORISTA HISTORICO',rota:'ROTA HISTORICA',hora_real:'09:00'}));
const centerWithOrphans=await buildResourceCenter(db);
const orphanVehicle=centerWithOrphans.resources.find((item)=>item.resourceName==='ORP1A23');
const historicalVehicle=centerWithOrphans.resources.find((item)=>item.resourceName==='HIS9Z99');
assert.equal(orphanVehicle?.status,'PERNOITE','monitoramento órfão precisa bloquear veículo terceiro');
assert.equal(historicalVehicle?.status,'EM ROTA','placa operacional fora do cadastro precisa aparecer ocupada na Central');
const fleetWithOrphans=buildFleetOverview(centerWithOrphans);
assert.ok(fleetWithOrphans.inRoute.total>=fleetWithOrphans.overnight.total,'Em rota deve incluir o subconjunto de pernoites');
assert.ok(fleetWithOrphans.inRoute.total>=2,'monitoramentos órfãos precisam entrar no total de operações abertas');

// Regressão visual/API: o front não pode reintroduzir o seletor nem enviar date.
const routeSource=await readFile(join(root,'public/assets/route.js'),'utf8');
const apiSource=await readFile(join(root,'functions/api/resources.js'),'utf8');
assert.equal(routeSource.includes('id="route-resource-date"'),false,'Central não deve renderizar filtro de data');
assert.equal(routeSource.includes('/api/resources?date='),false,'Central não deve consultar recursos por data');
assert.equal(apiSource.includes("searchParams.get('date')"),false,'API da Central deve ignorar data e sempre retornar estado global');
assert.equal(apiSource.includes('ownResourceSnapshot'),false,'API não pode eliminar terceiros da fotografia operacional');

console.log('OK: Central global usa todos os monitoramentos ativos, inclusive órfãos/terceiros, sem falsa disponibilidade e com pernoite explícito.');
