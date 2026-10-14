import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { saveSchedule, saveScheduleBatch, listScheduleRecordsInternal, getScheduleEditor, previewScheduleImport, confirmScheduleImport } from '../functions/_lib/schedule.js';
import { listDepartureControlRows, autoConfirmDeparturesFromGps, departureToleranceMinutes, departureDashboard, saveDeparture } from '../functions/_lib/departure.js';
import { withOperationalGuard } from '../functions/_lib/operation-guard.js';
import { listMonitoring, monitoringSummary, saveMonitoring } from '../functions/_lib/monitoring.js';
import { listReturnCandidates, saveReturn } from '../functions/_lib/return.js';
import { buildResourceCenter } from '../functions/_lib/core.js';
import { getOperationalPendingAudit, getOperationalOccurrenceIndicators, justifyOperationalOccurrence } from '../functions/_lib/operational-pending.js';
import { createInitialAdmin, authenticateUser, createSession } from '../functions/_lib/auth.js';
import { onRequestGet as getEmployees, onRequestPost as postEmployee } from '../functions/api/colaboradores.js';
import { onRequestGet as getCatalog, onRequestPost as postCatalog } from '../functions/api/catalogo.js';
import { onRequestGet as getUsers, onRequestPost as postUser } from '../functions/api/auth/users.js';
import { onRequestGet as getSettings, onRequestPut as putSettings } from '../functions/api/route-settings.js';
import { onRequestGet as getTripTimeline } from '../functions/api/trip-timeline.js';
import { latestScheduleAssignments, recordGpsOperationalOccurrences, recordNightIgnitionSessions, recordRouteClientArrivals, updateGpsMotionState } from '../functions/api/protectsat.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql') && !/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));

function makeStatement(sql){
  let values=[];
  const api={
    bind(...args){values=args;return api;},
    async first(){const stmt=sqlite.prepare(sql);return stmt.get(...values)||null;},
    async all(){const stmt=sqlite.prepare(sql);return {results:stmt.all(...values)};},
    async run(){const stmt=sqlite.prepare(sql);const info=stmt.run(...values);return {success:true,meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};},
  };
  return api;
}
const db={prepare:makeStatement,async batch(statements){const result=[];sqlite.exec('BEGIN');try{for(const stmt of statements)result.push(await stmt.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};

// Concorrência: viagens diferentes devem poder gravar em paralelo; a mesma viagem permanece serializada.
let concurrentActive=0, concurrentMax=0;
const concurrentJob=(requestId,scope,delay=90)=>withOperationalGuard(db,'smoke-concurrency',requestId,async()=>{
  concurrentActive+=1; concurrentMax=Math.max(concurrentMax,concurrentActive);
  await new Promise((resolve)=>setTimeout(resolve,delay));
  concurrentActive-=1; return {ok:true,scope};
},scope);
await Promise.all([concurrentJob('concurrent-a','SCHEDULE:A'),concurrentJob('concurrent-b','SCHEDULE:B')]);
assert.equal(concurrentMax,2,'locks de viagens diferentes não devem serializar toda a operação');
concurrentActive=0; concurrentMax=0;
await Promise.all([concurrentJob('same-trip-a','SCHEDULE:SAME',70),concurrentJob('same-trip-b','SCHEDULE:SAME',20)]);
assert.equal(concurrentMax,1,'duas gravações da mesma viagem devem continuar serializadas');


const createdAdmin=await createInitialAdmin(db,{name:'Administrador Teste',email:'admin@teste.local',matricula:'9999',password:'Teste@123'});
assert.equal(createdAdmin.role,'ADMIN','setup deve criar o primeiro ADMIN');
const authenticated=await authenticateUser(db,'9999','Teste@123');
assert.ok(authenticated?.user?.id,'PBKDF2 deve autenticar a senha correta');
const session=await createSession(db,authenticated.user.id);
assert.ok(session.token && session.expiresAt,'sessão de autenticação deve ser criada');


async function callApi(handler,path,{method='GET',body}={}){
  const headers={Authorization:`Bearer ${session.token}`};
  if(body!==undefined)headers['Content-Type']='application/json';
  const request=new Request(`https://local.test${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const response=await handler({env:{DB:db},request});
  const payload=await response.json();
  return {response,payload};
}

// Cadastros: valida contrato API -> frontend e normalização dos dados mestre.
let apiResult=await callApi(postEmployee,'/api/colaboradores',{method:'POST',body:{
  matricula:'200',nome:'cadastro teste',funcao:'MOTORISTA',vinculo:'PROPRIO',status:'DISPONIVEL',ativo:true,
}});
assert.equal(apiResult.response.status,201,'cadastro de motorista próprio deve salvar');
assert.equal(apiResult.payload.record.nome,'CADASTRO TESTE','nome deve ser normalizado');
assert.match(String(apiResult.payload.record.atualizado_por||''),/Administrador/i,'cadastro de colaborador deve registrar o autor da última edição');
apiResult=await callApi(getEmployees,'/api/colaboradores?funcao=MOTORISTA');
assert.ok(apiResult.payload.records.some((x)=>x.matricula==='200'),'GET de colaboradores deve devolver records para a tela');
assert.ok(apiResult.payload.colaboradores.some((x)=>x.matricula==='200'),'GET deve manter alias colaboradores por compatibilidade');

apiResult=await callApi(postEmployee,'/api/colaboradores',{method:'POST',body:{
  matricula:'',nome:'ajudante terceiro teste',funcao:'AJUDANTE',vinculo:'TERCEIRO',status:'DISPONÍVEL',ajudante_rota:true,rotas_atendidas:'ROTA TESTE; AG2 TESTE CADASTRO',ativo:true,
}});
assert.equal(apiResult.response.status,201,'terceiro deve poder ser cadastrado sem matrícula');
assert.equal(apiResult.payload.record.matricula,null,'matrícula vazia de terceiro deve persistir como NULL');

apiResult=await callApi(postCatalog,'/api/catalogo?type=vehicles',{method:'POST',body:{
  placa:'def-2e34',tipo:'TRUCK',vinculo:'PROPRIO',capacidade_t:12,status:'DISPONIVEL',ativo:true,
}});
assert.equal(apiResult.response.status,201,'cadastro de veículo deve salvar');
assert.equal(apiResult.payload.record.placa,'DEF2E34','placa deve ser normalizada');
assert.match(String(apiResult.payload.record.atualizado_por||''),/Administrador/i,'cadastro de veículo deve registrar o autor da última edição');
apiResult=await callApi(getCatalog,'/api/catalogo?type=vehicles');
assert.ok(apiResult.payload.records.some((x)=>x.placa==='DEF2E34'),'veículo salvo deve aparecer imediatamente na listagem');

apiResult=await callApi(postCatalog,'/api/catalogo?type=routes',{method:'POST',body:{
  nome:'ag2 teste cadastro',regiao:'AG2',perfil:'REDES',tempo_ida_min:'1h23',duracao_dias:1,ativo:true,
}});
assert.equal(apiResult.response.status,201,'cadastro de rota deve salvar');
assert.equal(apiResult.payload.record.nome,'AG2 TESTE CADASTRO','rota deve ser normalizada em maiúsculas');
assert.equal(apiResult.payload.record.perfil,'REDE','perfil REDES deve normalizar para REDE');
assert.equal(apiResult.payload.record.tempo_ida_min,83,'duração 1h23 deve converter para 83 minutos');
apiResult=await callApi(getCatalog,'/api/catalogo?type=routes');
assert.ok(apiResult.payload.records.some((x)=>x.nome==='AG2 TESTE CADASTRO'),'rota salva deve aparecer imediatamente na listagem');

apiResult=await callApi(postCatalog,'/api/catalogo?type=vehicles',{method:'POST',body:{
  placa:'ZZZ9Z99',tipo:'TRUCK',vinculo:'PRÓPRIO',status:'STATUS INVÁLIDO',ativo:true,
}});
assert.equal(apiResult.response.status,400,'backend deve rejeitar status fora da lista válida');


apiResult=await callApi(postUser,'/api/auth/users',{method:'POST',body:{
  name:'Operador Cadastro',matricula:'300',email:'',cargo:'Logística',role:'OPERADOR',password:'Operador@123',active:true,bases:['route'],permissions:[],
}});
assert.equal(apiResult.response.status,201,'cadastro de usuário deve salvar');
apiResult=await callApi(getUsers,'/api/auth/users');
assert.ok(apiResult.payload.users.some((x)=>x.matricula==='300'),'usuário salvo deve aparecer imediatamente na listagem');

apiResult=await callApi(putSettings,'/api/route-settings',{method:'PUT',body:{values:{TOLERANCIA_SAIDA_MIN:'30',HORA_SAIDA_SEGUNDA:'05:00'}}});
assert.equal(apiResult.response.status,200,'parâmetros válidos devem salvar');
apiResult=await callApi(getSettings,'/api/route-settings');
assert.equal(String(apiResult.payload.values.TOLERANCIA_SAIDA_MIN),'30','parâmetro salvo deve ser relido');
apiResult=await callApi(putSettings,'/api/route-settings',{method:'PUT',body:{values:{HORA_SAIDA_SEGUNDA:'99:99'}}});
assert.equal(apiResult.response.status,400,'horário inválido de parâmetro deve ser rejeitado');


// Importação em massa: prévia -> confirmação -> releitura na data selecionada.
const importAdmin={id:createdAdmin.id,email:createdAdmin.email,name:createdAdmin.name,role:'ADMIN',perfil:'ADMIN',permissions:['*'],bases:['route']};
const importPreview=await previewScheduleImport(db,importAdmin,'2026-08-21','SEQ\tOC\tPLACA\tROTA\tPESO\n1\t990001\tDEF2E34\tAG2 TESTE CADASTRO\t5.500');
assert.equal(importPreview.validCount,1,'prévia da importação em massa deve reconhecer a linha válida');
const importDone=await confirmScheduleImport(db,importAdmin,'2026-08-21',importPreview.rows.filter((x)=>x.valid),'smoke-import-20260821');
assert.equal(importDone.imported.length,1,'confirmação da importação em massa deve gravar a escala');
assert.equal(importDone.committed,true,'importação em massa deve declarar confirmação durável');
const importRetry=await confirmScheduleImport(db,importAdmin,'2026-08-21',importPreview.rows.filter((x)=>x.valid),'smoke-import-20260821');
assert.equal(String(importRetry.imported[0]?.id),String(importDone.imported[0]?.id),'retry da mesma importação deve devolver a resposta anterior, sem duplicar');
assert.equal(importDone.imported[0]?.observacoes||'','', 'importação em massa não deve gerar observação operacional automática');
const importEditor=await getScheduleEditor(db,importAdmin,'2026-08-21');
assert.ok(importEditor.schedules.some((x)=>x.ocs==='990001' && x.rota==='AG2 TESTE CADASTRO'),'escala importada deve aparecer imediatamente na data selecionada');

const editorAfterMasterData=await getScheduleEditor(db,{id:createdAdmin.id,email:createdAdmin.email,name:createdAdmin.name,role:'ADMIN',perfil:'ADMIN',permissions:['*'],bases:['route']},'2026-08-18');
assert.ok(editorAfterMasterData.vehicles.some((x)=>x.placa==='DEF2E34'),'veículo cadastrado deve aparecer na Escala');
assert.ok(editorAfterMasterData.drivers.some((x)=>x.matricula==='200'),'motorista cadastrado deve aparecer na Escala');
assert.ok(editorAfterMasterData.routes.some((x)=>x.nome==='AG2 TESTE CADASTRO'),'rota cadastrada deve aparecer na Escala');

const admin={id:1,email:'admin@local',name:'Administrador',role:'ADMIN',perfil:'ADMIN',permissions:['*'],bases:['route']};
sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,TEMPO_IDA_MIN,TEMPO_ENTRE_CIDADES_MIN,TEMPO_VOLTA_MIN,TEMPO_POR_ENTREGA_MIN,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,?,?,?,?,?,1)`).run('R1','QA ROTA SMOKE','AG1','VAREJO',60,0,60,30,1);
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('V1','ABC1D23','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('V2','DEF4G56','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('M1','100','MOTORISTA TESTE','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('A1','101','AJUDANTE TESTE','AJUDANTE','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('M2','102','MOTORISTA DOIS','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('A2','103','AJUDANTE DOIS','AJUDANTE','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,AJUDANTE_ROTA,ROTAS_ATENDIDAS,ATIVO) VALUES (?,?,?,?,?,?,1,?,1)`).run('AR1','9109','AJUDANTE ROTA TESTE','AJUDANTE','PRÓPRIO','DISPONÍVEL','QA ROTA SMOKE');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,AJUDANTE_ROTA,ATIVO) VALUES (?,?,?,?,?,?,1,1)`).run('ARLEG','9113','AJUDANTE ROTA LEGADO','AJUDANTE DE ROTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,AJUDANTE_ROTA,CIDADE_ROTA,ATIVO) VALUES (?,?,?,?,?,?,0,?,1)`).run('ARCITY','9114','AUXILIAR ROTA CIDADE','AUXILIAR DE ROTA','PRÓPRIO','DISPONÍVEL','PETROLINA');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MSTALE','9110','MOTORISTA STATUS ANTIGO','MOTORISTA','PRÓPRIO','EM ROTA');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MSEVEN','9112','MOTORISTA STATUS SETIMO','MOTORISTA','PRÓPRIO','SÉTIMO');

// Status transitório gravado na base não pode manter pessoa falsamente em rota.
let statusEditor=await getScheduleEditor(db,admin,'2026-08-23');
assert.equal(statusEditor.drivers.find((x)=>x.id==='MSTALE')?.status,'DISPONÍVEL','EM ROTA antigo no cadastro deve cair para DISPONÍVEL sem evidência operacional');
sqlite.prepare(`INSERT INTO ROUTE_RESOURCE_EVENTS (EVENT_KEY,RESOURCE_TYPE,RESOURCE_KEY,RESOURCE_ID,RESOURCE_NAME,STATUS,EFFECTIVE_AT,DATE_KEY,SOURCE,DETAILS_JSON) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('SMOKE-STALE-OUT','MOTORISTA','MOTORISTA|MSTALE','MSTALE','MOTORISTA STATUS ANTIGO','EM ROTA','2026-08-23T08:00:00','2026-08-23','SAIDA','{}');
statusEditor=await getScheduleEditor(db,admin,'2026-08-23');
assert.equal(statusEditor.drivers.find((x)=>x.id==='MSTALE')?.status,'EM ROTA','evento operacional atual deve marcar EM ROTA');
sqlite.prepare(`INSERT INTO ROUTE_RESOURCE_EVENTS (EVENT_KEY,RESOURCE_TYPE,RESOURCE_KEY,RESOURCE_ID,RESOURCE_NAME,STATUS,EFFECTIVE_AT,DATE_KEY,SOURCE,DETAILS_JSON) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('SMOKE-STALE-RETURN','MOTORISTA','MOTORISTA|MSTALE','MSTALE','MOTORISTA STATUS ANTIGO','DISPONÍVEL','2026-08-23T12:00:00','2026-08-23','RETORNO','{}');
statusEditor=await getScheduleEditor(db,admin,'2026-08-23');
assert.equal(statusEditor.drivers.find((x)=>x.id==='MSTALE')?.status,'DISPONÍVEL','retorno/liberação posterior deve prevalecer sobre EM ROTA');
assert.equal(statusEditor.drivers.find((x)=>x.id==='MSEVEN')?.status,'DISPONÍVEL','status legado SÉTIMO não pode bloquear nem aparecer como condição operacional na Escala');
assert.equal(statusEditor.helpers.find((x)=>x.id==='AR1')?.status,'DISPONÍVEL','ajudante de rota deve permanecer selecionável no domingo porque a Escala é planejamento da segunda');
assert.equal(statusEditor.helpers.find((x)=>x.id==='ARLEG')?.status,'DISPONÍVEL','cadastro legado com FUNCAO AJUDANTE DE ROTA também deve ficar selecionável no domingo');
const recoveredRouteHelper=statusEditor.helpers.find((x)=>x.id==='ARCITY');
assert.equal(recoveredRouteHelper?.status,'DISPONÍVEL','cadastro de ajudante de rota com FUNCAO histórica diferente deve aparecer na Escala');
assert.equal(recoveredRouteHelper?.ajudante_rota,true,'CIDADE_ROTA/descrição de função devem recuperar a classificação AJUDANTE DE ROTA quando o flag antigo estiver ausente');
assert.equal(statusEditor.helpers[0]?.ajudante_rota,true,'ajudantes de rota devem ser ordenados antes dos demais no seletor');

const base={data:'2026-08-18',sequencia:'1',ocs:'2500001',peso_kg:5000,qtd_entregas:5,horario_ponto:'06:00',rota_id:'R1',veiculo_id:'V1',motorista_id:'M1',ajudante_1_id:'A1',tipo_equipe:'UM_AJUDANTE',status:'PROGRAMADO'};
// v1.0.5: retry de uma linha NOVA com resposta perdida deve atualizar a mesma
// escala pelo client_id estável, e nunca criar duplicidade.
const stableClientId='ESC-C-123E4567-E89B-42D3-A456-426614174000';
const stablePayload={...base,data:'2026-08-17',sequencia:'IDEMP1',ocs:'IDEMP-001',veiculo_id:'V2',motorista_id:'M2',ajudante_1_id:'A2',client_id:stableClientId};
const stableFirst=await saveScheduleBatch(db,admin,[stablePayload],'smoke-client-first');
const stableRetry=await saveScheduleBatch(db,admin,[stablePayload],'smoke-client-retry');
assert.equal(stableFirst.committed,true,'batch deve declarar confirmação durável da Escala');
assert.equal(String(stableFirst.records[0]?.id),stableClientId,'linha nova deve usar client_id estável no armazenamento legado');
assert.equal(String(stableRetry.records[0]?.id),stableClientId,'retry deve resolver a mesma linha pelo client_id');
const stableCount=sqlite.prepare(`SELECT COUNT(*) AS total FROM ESCALAS_DIA WHERE ID=?`).get(stableClientId)?.total||0;
assert.equal(Number(stableCount),1,'retry após perda de resposta não pode duplicar a escala');

// v1.0.11: uma linha inválida não pode derrubar todo o save_batch. A válida deve
// ser persistida e a inválida deve voltar em errors para o frontend pintá-la de vermelho.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VPART1','PAR1A11','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VPART2','PAR2B22','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MPART1','99201','MOTORISTA PARCIAL UM','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('APART1','99202','AJUDANTE PARCIAL UM','AJUDANTE','PRÓPRIO','DISPONÍVEL');
const partialBatch=await saveScheduleBatch(db,admin,[
  {...base,data:'2026-08-27',sequencia:'PB1',ocs:'PB-001',veiculo_id:'VPART1',placa:'PAR1A11',motorista_id:'MPART1',motorista:'MOTORISTA PARCIAL UM',ajudante_1_id:'APART1',ajudante_1:'AJUDANTE PARCIAL UM'},
  {...base,data:'2026-08-27',sequencia:'PB2',ocs:'PB-002',veiculo_id:'VPART2',placa:'PAR2B22',motorista_id:'INEXISTENTE',motorista:'MOTORISTA INEXISTENTE',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'},
],'smoke-partial-batch');
assert.equal(partialBatch.committed,true,'save_batch parcial deve responder normalmente');
assert.equal(partialBatch.successes.length,1,'linha válida deve ser salva mesmo quando outra falha');
assert.equal(partialBatch.errors.length,1,'linha inválida deve voltar como erro isolado');
assert.equal(partialBatch.errors[0].index,1,'erro deve apontar exatamente a linha inválida');
assert.ok(String(partialBatch.errors[0].message||'').includes('Colaborador inexistente ou inativo'),'erro isolado deve devolver o motivo real da rejeição, não uma mensagem genérica');
assert.equal(Number(sqlite.prepare(`SELECT COUNT(*) AS C FROM ESCALAS_DIA WHERE DATA='2026-08-27' AND CARGA='PB-001'`).get()?.C||0),1,'linha válida do lote parcial deve permanecer gravada');
const first=await saveSchedule(db,admin,base);
assert.ok(first.id,'primeira escala deve ser criada');
const lastDriverVehicle=sqlite.prepare(`SELECT DRIVER_ID,DRIVER_NAME,SCHEDULE_ID FROM ROUTE_VEHICLE_LAST_DRIVER WHERE PLATE='ABC1D23'`).get();
assert.equal(String(lastDriverVehicle?.DRIVER_ID),'M1','placa deve guardar o último motorista escalado');
assert.equal(String(lastDriverVehicle?.DRIVER_NAME),'MOTORISTA TESTE','persistência deve guardar o nome do último motorista por placa');
assert.equal(String(lastDriverVehicle?.SCHEDULE_ID),String(first.id),'vínculo do último motorista deve guardar a escala de origem');
const resourceWithLastDriver=(await buildResourceCenter(db,'2026-08-18')).vehicles.find((row)=>row.resourceName==='ABC1D23');
assert.equal(String(resourceWithLastDriver?.raw?.ULTIMO_MOTORISTA_NOME),'MOTORISTA TESTE','Central de Recursos deve expor o último motorista por placa');
assert.equal(resourceWithLastDriver?.origin,'ESCALA','recurso escalado sem saída deve ser identificado separadamente na Central');
assert.equal(resourceWithLastDriver?.status,'INDISPONÍVEL','backend deve diferenciar recurso escalado de recurso livre, permitindo selo ESCALADO na interface');
const editorWithAllocation=await getScheduleEditor(db,admin,'2026-08-18');
assert.equal(editorWithAllocation.vehicles.find((x)=>x.id==='V1')?.status,'ESCALADO','veículo programado deve ser sinalizado como ESCALADO no seletor');
assert.equal(editorWithAllocation.drivers.find((x)=>x.id==='M1')?.rota_atual,'QA ROTA SMOKE','motorista escalado deve informar a rota operacional atual');
assert.equal(editorWithAllocation.helpers.find((x)=>x.id==='A1')?.status,'ESCALADO','ajudante comum programado deve ser sinalizado como ESCALADO');
const toleranceNow=await departureToleranceMinutes(db);
assert.equal(toleranceNow,30,'tolerância operacional de saída deve ser 30 minutos');
const controlBeforeDeparture=await listDepartureControlRows(db,admin,{date:'2026-08-18'});
assert.ok(controlBeforeDeparture.records.some((row)=>String(row.schedule_record_id)===String(first.id)&&row.status==='PENDENTE'),'Controle de Saída deve listar a escala mesmo antes de existir registro de saída');
const monitoringBeforeDeparture=await listMonitoring(db,admin,{includePending:'1',operational:'1',date:'2026-08-18',recentDays:'3'});
assert.ok(monitoringBeforeDeparture.some((row)=>String(row.schedule_record_id)===String(first.id)&&row.status==='PENDENTE DE SAÍDA'),'Monitoramento deve listar a escala como PENDENTE DE SAÍDA imediatamente após a programação');
let blocked=false;
try{await saveSchedule(db,admin,{...base,data:'2026-08-18',sequencia:'2',ocs:'2500002',horario_ponto:'07:00'});}catch(error){blocked=['VEHICLE_SCHEDULE_CONFLICT','RESOURCE_SCHEDULE_CONFLICT','OPEN_MONITORING'].includes(error.code)||/alocado|monitoramento/i.test(error.message);}
assert.equal(blocked,true,'duplicidade real deve bloquear');

// Simula saída/monitoramento antigos ainda abertos, mas com Retorno real antes da nova escala.
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (?,?,?,?,?,?,?)`).run(String(first.id),'2026-08-18','EM ROTA','ABC1D23','MOTORISTA TESTE','QA ROTA SMOKE',JSON.stringify({schedule_record_id:String(first.id),status:'EM ROTA',previsao_retorno:'2026-08-18 10:00'}));
sqlite.prepare(`INSERT INTO ROUTE_RETURNS (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?,?)`).run(String(first.id),'2026-08-18','FINALIZADO','ABC1D23','MOTORISTA TESTE','QA ROTA SMOKE','2026-08-18 10:00',JSON.stringify({schedule_record_id:String(first.id),retorno_real:'2026-08-18 10:00',status:'FINALIZADO'}));

// Marca a escala anterior operacionalmente finalizada; o monitoramento residual não deve reabrir a janela.
sqlite.prepare(`UPDATE ESCALAS_DIA SET STATUS='FINALIZADO',PREVISAO_RETORNO='2026-08-18 10:00',ATUALIZADO_EM=CURRENT_TIMESTAMP WHERE ID=?`).run(String(first.id));
// Depois que o Retorno foi confirmado, o planejamento não pode reabrir a viagem
// anterior nem bloquear placa, motorista ou ajudante por causa do horário digitado.
const resourcesReleasedByConfirmedReturn=await saveSchedule(db,admin,{...base,data:'2026-08-18',sequencia:'2H',ocs:'2500002H',horario_ponto:'09:15'});
assert.ok(resourcesReleasedByConfirmedReturn.id,'Retorno confirmado deve liberar imediatamente veículo, motorista e ajudante para nova Escala');
sqlite.prepare(`UPDATE ESCALAS_DIA SET STATUS='CANCELADO' WHERE ID=?`).run(String(resourcesReleasedByConfirmedReturn.id));
const resourceCenterAfterReturn=await buildResourceCenter(db,'2026-08-18');
for(const [type,name] of [['VEICULO','ABC1D23'],['MOTORISTA','MOTORISTA TESTE'],['AJUDANTE','AJUDANTE TESTE']]){
  const resource=resourceCenterAfterReturn.resources.find((row)=>row.resourceType===type&&row.resourceName===name);
  assert.equal(resource?.status,'DISPONÍVEL',`${type.toLowerCase()} com Retorno confirmado deve ficar disponível na Central de Recursos`);
}
const afterReturn=await saveSchedule(db,admin,{...base,data:'2026-08-18',sequencia:'2C',ocs:'2500002C',horario_ponto:'11:00',motorista_id:'M2',ajudante_1_id:'A2'});
assert.ok(afterReturn.id,'veículo deve ser liberado para saída posterior ao Retorno real');
const next=await saveSchedule(db,admin,{...base,data:'2026-08-19',sequencia:'3',ocs:'2500003',horario_ponto:'06:00'});
assert.ok(next.id,'retorno real deve liberar recursos para saída posterior');

// Regressão v1.0.26: bases históricas podem ter Retorno confirmado com um
// SCHEDULE_ID divergente. A placa física + horário real também comprovam que a
// viagem terminou e devem liberar o veículo no planejamento.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VPLATERET','PLT1A26','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MPLATERET1','9126','MOTORISTA PLACA RETORNO UM','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MPLATERET2','9127','MOTORISTA PLACA RETORNO DOIS','MOTORISTA','PRÓPRIO','DISPONÍVEL');
const plateLegacyTrip=await saveSchedule(db,admin,{...base,data:'2026-08-27',sequencia:'PLT-OLD',ocs:'PLT-OLD',horario_ponto:'05:00',veiculo_id:'VPLATERET',placa:'PLT1A26',motorista_id:'MPLATERET1',motorista:'MOTORISTA PLACA RETORNO UM',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'});
sqlite.prepare(`INSERT INTO ROUTE_RETURNS (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?,?)`).run(
  'ID-HISTORICO-DIVERGENTE','2026-08-27','FINALIZADO','PLT1A26','MOTORISTA PLACA RETORNO UM','ROTA HISTORICA DIVERGENTE','2026-08-27T08:00',
  JSON.stringify({data:'2026-08-27',retorno_real:'2026-08-27T08:00',status:'FINALIZADO'})
);
const plateReleasedWithoutScheduleLink=await saveSchedule(db,admin,{...base,data:'2026-08-27',sequencia:'PLT-NEW',ocs:'PLT-NEW',horario_ponto:'06:00',veiculo_id:'VPLATERET',placa:'PLT1A26',motorista_id:'MPLATERET2',motorista:'MOTORISTA PLACA RETORNO DOIS',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'});
assert.ok(plateReleasedWithoutScheduleLink.id,'Retorno confirmado da mesma placa deve liberar o veículo mesmo com ID histórico divergente');
sqlite.prepare(`UPDATE ESCALAS_DIA SET STATUS='CANCELADO' WHERE ID IN (?,?)`).run(String(plateLegacyTrip.id),String(plateReleasedWithoutScheduleLink.id));

// Regressão v1.0.27: Retornos importados/históricos podem existir apenas na
// tabela RETORNOS. A Escala precisa consultar essa fonte também.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VRETOLD','OLD1R27','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MRETOLD1','9128','MOTORISTA RETORNO LEGADO UM','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MRETOLD2','9129','MOTORISTA RETORNO LEGADO DOIS','MOTORISTA','PRÓPRIO','DISPONÍVEL');
const legacyTableTrip=await saveSchedule(db,admin,{...base,data:'2026-08-27',sequencia:'OLD-RET-1',ocs:'OLD-RET-1',horario_ponto:'05:00',veiculo_id:'VRETOLD',placa:'OLD1R27',motorista_id:'MRETOLD1',motorista:'MOTORISTA RETORNO LEGADO UM',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'});
sqlite.prepare(`INSERT INTO RETORNOS (ID,DATA,ESCALA_ID,PLACA,DATA_HORA_RETORNO,ORIGEM) VALUES (?,?,?,?,?,?)`).run('RET-LEGACY-TABLE-27','2026-08-27','ESCALA-ID-ANTIGO','OLD-1R27','2026-08-27T08:00','PORTARIA');
const releasedByLegacyReturnsTable=await saveSchedule(db,admin,{...base,data:'2026-08-27',sequencia:'OLD-RET-2',ocs:'OLD-RET-2',horario_ponto:'06:00',veiculo_id:'VRETOLD',placa:'OLD1R27',motorista_id:'MRETOLD2',motorista:'MOTORISTA RETORNO LEGADO DOIS',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'});
assert.ok(releasedByLegacyReturnsTable.id,'Retorno da tabela histórica RETORNOS deve liberar a mesma placa na Escala');
sqlite.prepare(`UPDATE ESCALAS_DIA SET STATUS='CANCELADO' WHERE ID IN (?,?)`).run(String(legacyTableTrip.id),String(releasedByLegacyReturnsTable.id));

// A terceira fonte histórica (ROUTE_RECORDS/module=returns) também deve liberar.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VRETGEN','GEN1R27','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MRETGEN1','9130','MOTORISTA RETORNO GENERICO UM','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MRETGEN2','9131','MOTORISTA RETORNO GENERICO DOIS','MOTORISTA','PRÓPRIO','DISPONÍVEL');
const genericReturnTrip=await saveSchedule(db,admin,{...base,data:'2026-08-27',sequencia:'GEN-RET-1',ocs:'GEN-RET-1',horario_ponto:'05:00',veiculo_id:'VRETGEN',placa:'GEN1R27',motorista_id:'MRETGEN1',motorista:'MOTORISTA RETORNO GENERICO UM',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'});
sqlite.prepare(`INSERT INTO ROUTE_RECORDS (MODULE,TITLE,STATUS,DATE_KEY,DATA_JSON) VALUES ('returns',?,?,?,?)`).run('RETORNO GENERICO','FINALIZADO','2026-08-27',JSON.stringify({schedule_record_id:'OUTRO-ID-GENERICO',data:'2026-08-27',placa:'GEN-1R27',retorno_real:'2026-08-27T08:00'}));
const releasedByGenericReturn=await saveSchedule(db,admin,{...base,data:'2026-08-27',sequencia:'GEN-RET-2',ocs:'GEN-RET-2',horario_ponto:'06:00',veiculo_id:'VRETGEN',placa:'GEN1R27',motorista_id:'MRETGEN2',motorista:'MOTORISTA RETORNO GENERICO DOIS',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'});
assert.ok(releasedByGenericReturn.id,'Retorno do armazenamento genérico deve liberar a mesma placa na Escala');
sqlite.prepare(`UPDATE ESCALAS_DIA SET STATUS='CANCELADO' WHERE ID IN (?,?)`).run(String(genericReturnTrip.id),String(releasedByGenericReturn.id));

// Regressão v1.0.28: um Monitoramento aberto pode sobreviver sem a Escala/Saída
// original. Ele deve aparecer em Retornos e poder ser concluído com segurança.
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (?,?,?,?,?,?,?)`).run(
  'ESCALA-ORFA-SMX0A17','2026-08-26','PERNOITE','SMX0A17','JUAN HENRIQUE TORRES PIMENTEL','SRT SALGUEIRO',
  JSON.stringify({schedule_record_id:'ESCALA-ORFA-SMX0A17',data:'2026-08-26',status:'PERNOITE',status_monitoramento:'PERNOITE',placa:'SMX0A17',motorista:'JUAN HENRIQUE TORRES PIMENTEL',rota:'SRT SALGUEIRO',saida_real:'2026-08-26T00:39'})
);
const orphanMonitoringId=Number(sqlite.prepare(`SELECT ID FROM ROUTE_MONITORING WHERE SCHEDULE_ID='ESCALA-ORFA-SMX0A17'`).get()?.ID||0);
let orphanCandidates=await listReturnCandidates(db,admin,{start:'2026-08-26',end:'2026-08-27',q:'SMX0A17'});
const orphanCandidate=orphanCandidates.find((item)=>item.orphanMonitoring&&item.schedule?.placa==='SMX0A17');
assert.ok(orphanCandidate,'monitoramento sem Escala/Saída deve aparecer como viagem aguardando retorno');
assert.equal(orphanCandidate.schedule.rota,'SRT SALGUEIRO','candidato órfão deve conservar a rota do Monitoramento');
assert.equal(orphanCandidate.departure.saida_real,'2026-08-26T00:39','candidato órfão deve conservar a hora real disponível no Monitoramento');
const orphanReturn=await saveReturn(db,admin,{schedule_record_id:orphanCandidate.schedule.id,storage:'ROUTE_MONITORING',monitoring_id:orphanMonitoringId,orphan_monitoring:true,data:'2026-08-26',placa:'SMX0A17',rota:'SRT SALGUEIRO',motorista:'JUAN HENRIQUE TORRES PIMENTEL',saida_real:'2026-08-26T00:39',retorno_real:'2026-08-27T08:15',origem:'MANUAL',voltou_com_devolucao:false,apoiou_alguem:false});
assert.ok(orphanReturn.record?.id,'retorno de monitoramento órfão deve ser gravado');
assert.equal(orphanReturn.skipDerivedState,false,'retorno órfão deve liberar recursos após a confirmação');
assert.equal(sqlite.prepare(`SELECT STATUS FROM ROUTE_MONITORING WHERE ID=?`).get(orphanMonitoringId)?.STATUS,'FINALIZADO','confirmação deve finalizar o Monitoramento órfão');
orphanCandidates=await listReturnCandidates(db,admin,{start:'2026-08-26',end:'2026-08-27',q:'SMX0A17'});
assert.ok(!orphanCandidates.some((item)=>item.schedule?.placa==='SMX0A17'),'viagem concluída não pode continuar na lista de retornos pendentes');

// v1.0.7: não existe mais regra de 7º dia. O bloqueio de pessoas é apenas
// duplicidade operacional: recurso já usado em outra escala ainda aberta.
const employeeOverlapA=await saveSchedule(db,admin,{...base,data:'2026-08-20',sequencia:'OV1',ocs:'OV0001',horario_ponto:'06:00',veiculo_id:'V1',motorista_id:'M1',ajudante_1_id:'A1'});
assert.ok(employeeOverlapA.id,'primeira escala de teste de duplicidade deve salvar');
let employeeOverlapBlocked=false;
try{await saveSchedule(db,admin,{...base,data:'2026-08-20',sequencia:'OV2',ocs:'OV0002',horario_ponto:'07:00',veiculo_id:'V2',motorista_id:'M1',ajudante_1_id:'A1'});}catch(error){employeeOverlapBlocked=error.code==='RESOURCE_SCHEDULE_CONFLICT';}
assert.equal(employeeOverlapBlocked,true,'motorista/ajudante não podem aparecer duplicados em outra escala ainda aberta');


// v1.0.8: domingo é data válida de planejamento para qualquer pessoa, inclusive ajudante de rota.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VHELP','HLP1A23','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VHELP2','HLP2B34','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MHELP','9111','MOTORISTA AJUDANTE ROTA','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MHELP2','9115','MOTORISTA AJUDANTE ROTA DOIS','MOTORISTA','PRÓPRIO','DISPONÍVEL');
const helperSaturday=await saveSchedule(db,admin,{...base,data:'2026-08-22',sequencia:'HELP-SAT',ocs:'HELP-SAT',veiculo_id:'VHELP',placa:'HLP1A23',motorista_id:'MHELP',motorista:'MOTORISTA AJUDANTE ROTA',ajudante_1_id:'AR1',ajudante_1:'AJUDANTE ROTA TESTE'});
assert.ok(helperSaturday.id,'ajudante de rota deve poder ser escalado normalmente no sábado');
const helperSameDay=await saveSchedule(db,admin,{...base,data:'2026-08-22',sequencia:'HELP-SAT-2',ocs:'HELP-SAT-2',horario_ponto:'07:00',veiculo_id:'VHELP2',placa:'HLP2B34',motorista_id:'MHELP2',motorista:'MOTORISTA AJUDANTE ROTA DOIS',ajudante_1_id:'AR1',ajudante_1:'AJUDANTE ROTA TESTE'});
assert.ok(helperSameDay.id,'ajudante de rota pode ser escalado em outro carro na mesma data porque permanece disponível na região');
const routeHelperEditor=await getScheduleEditor(db,admin,'2026-08-22');
const routeHelperOption=routeHelperEditor.helpers.find((x)=>x.id==='AR1');
// v1.0.157: a alocação programada do ajudante de rota fica visível no seletor
// (ESCALADO + rota), sem impedir a escolha: a escala HELP-SAT-2 acima foi salva.
// "Disponível para apoio" fica reservado a quem está EM ROTA.
assert.equal(routeHelperOption?.status,'ESCALADO','seletor da Escala deve exibir a alocação programada do ajudante de rota');
assert.ok(routeHelperOption?.rota_atual,'seletor deve informar a rota em que o ajudante de rota está escalado');
assert.equal(routeHelperOption?.disponivel_apoio,false,'ESCALADO não é sinalizado como disponível para apoio');
const routeHelperResource=(await buildResourceCenter(db,'2026-08-22')).helpers.find((row)=>row.resourceId==='AR1');
assert.equal(routeHelperResource?.status,'DISPONÍVEL','Central de Recursos deve manter ajudante de rota disponível para outro veículo');
sqlite.prepare(`UPDATE ESCALAS_DIA SET STATUS='CANCELADO' WHERE ID=?`).run(String(helperSameDay.id));
sqlite.prepare(`UPDATE ESCALAS_DIA SET STATUS='FINALIZADO' WHERE ID=?`).run(String(helperSaturday.id));
const helperSunday=await saveSchedule(db,admin,{...base,data:'2026-08-23',sequencia:'HELP-SUN',ocs:'HELP-SUN',veiculo_id:'VHELP',placa:'HLP1A23',motorista_id:'MHELP',motorista:'MOTORISTA AJUDANTE ROTA',ajudante_1_id:'AR1',ajudante_1:'AJUDANTE ROTA TESTE'});
assert.ok(helperSunday.id,'ajudante de rota deve poder ser escalado no domingo quando a escala é planejamento da segunda');
sqlite.prepare(`UPDATE ESCALAS_DIA SET STATUS='FINALIZADO' WHERE ID=?`).run(String(helperSunday.id));


// v1.0.10: a equipe real pode ser trocada no Controle de Saída. A troca exige
// justificativa, usa colaboradores da base, respeita duplicidade operacional e
// passa a ser a equipe oficial da Escala/Monitoramento.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VSWAP','SWP1A23','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MSW1','9201','MOTORISTA TROCA UM','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MSW2','9202','MOTORISTA TROCA DOIS','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('ASW1','9203','AJUDANTE TROCA UM','AJUDANTE','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,AJUDANTE_ROTA,ROTAS_ATENDIDAS,ATIVO) VALUES (?,?,?,?,?,?,1,?,1)`).run('ASW2','9204','AJUDANTE TROCA DOIS','AJUDANTE DE ROTA','PRÓPRIO','DISPONÍVEL','QA ROTA SMOKE');
const swapSchedule=await saveSchedule(db,admin,{...base,data:'2026-08-25',sequencia:'SW1',ocs:'SWAP-001',veiculo_id:'VSWAP',placa:'SWP1A23',motorista_id:'MSW1',motorista:'MOTORISTA TROCA UM',ajudante_1_id:'ASW1',ajudante_1:'AJUDANTE TROCA UM'});
const swapControl=await listDepartureControlRows(db,admin,{date:'2026-08-25'});
const swapControlRow=swapControl.records.find((row)=>String(row.schedule_record_id)===String(swapSchedule.id));
assert.equal(String(swapControlRow?.motorista_id),'MSW1','Controle de Saída deve receber o ID do motorista atualmente escalado');
assert.equal(String(swapControlRow?.ajudante_1_id),'ASW1','Controle de Saída deve receber o ID do ajudante atualmente escalado');
assert.ok(swapControl.crewOptions?.drivers?.some((x)=>x.id==='MSW2'),'Controle de Saída deve receber catálogo de motoristas para troca');
assert.ok(swapControl.crewOptions?.helpers?.some((x)=>x.id==='ASW2'&&x.ajudante_rota),'Controle de Saída deve receber ajudantes de rota no seletor de troca');
const notDeparted=await saveDeparture(db,admin,{requestId:'nao-saiu-fastpath',data:{schedule_record_id:String(swapSchedule.id),data:'2026-08-25',status:'NÃO SAIU',hora_programada:'06:00',hora_real:'',placa:'SWP1A23',motorista_id:'MSW1',motorista:'MOTORISTA TROCA UM',ajudante_1_id:'ASW1',ajudante_1:'AJUDANTE TROCA UM',tipo_equipe:'UM_AJUDANTE'}});
assert.equal(notDeparted.record?.status,'NAO SAIU','NÃO SAIU sem troca de equipe deve salvar pelo caminho rápido');
let swapWithoutReasonBlocked=false;
try{
  await saveDeparture(db,admin,{requestId:'swap-sem-justificativa',data:{schedule_record_id:String(swapSchedule.id),data:'2026-08-25',status:'SAIU',hora_programada:'06:00',hora_real:'06:00',placa:'SWP1A23',motorista_id:'MSW2',motorista:'MOTORISTA TROCA DOIS',ajudante_1_id:'ASW2',ajudante_1:'AJUDANTE TROCA DOIS'}});
}catch(error){swapWithoutReasonBlocked=/justificativa/i.test(error.message);}
assert.equal(swapWithoutReasonBlocked,true,'troca de motorista/ajudante na saída deve exigir justificativa');
const swapDeparture=await saveDeparture(db,admin,{requestId:'swap-com-justificativa',data:{schedule_record_id:String(swapSchedule.id),data:'2026-08-25',status:'SAIU',hora_programada:'06:00',hora_real:'06:00',placa:'SWP1A23',motorista_id:'MSW2',motorista:'MOTORISTA TROCA DOIS',ajudante_1_id:'ASW2',ajudante_1:'AJUDANTE TROCA DOIS',justificativa_troca:'Troca operacional antes da saída'}});
assert.equal(swapDeparture.record?.motorista_id,'MSW2','Saída deve gravar o motorista real selecionado');
assert.equal(swapDeparture.record?.ajudante_1_id,'ASW2','Saída deve gravar o ajudante real selecionado');
const persistedSwap=sqlite.prepare(`SELECT MOTORISTA_ID,MOTORISTA,AJUDANTE_1_ID,AJUDANTE_1,STATUS FROM ESCALAS_DIA WHERE ID=?`).get(String(swapSchedule.id));
assert.equal(String(persistedSwap?.MOTORISTA_ID),'MSW2','troca na Saída deve atualizar o motorista da Escala');
assert.equal(String(persistedSwap?.AJUDANTE_1_ID),'ASW2','troca na Saída deve atualizar o ajudante da Escala');
assert.equal(String(persistedSwap?.STATUS),'EM ROTA','confirmação da Saída deve manter a Escala em EM ROTA');
const swapMonitoring=(await listMonitoring(db,admin,{operational:'1',date:'2026-08-25',recentDays:'3'})).find((row)=>String(row.schedule_record_id)===String(swapSchedule.id));
assert.equal(String(swapMonitoring?.motorista),'MOTORISTA TROCA DOIS','Monitoramento deve usar o motorista real trocado na Saída');
assert.equal(String(swapMonitoring?.ajudante_1),'AJUDANTE TROCA DOIS','Monitoramento deve usar o ajudante real trocado na Saída');

// Regressão v1.0.10: duas viagens diferentes não podem trocar simultaneamente para
// o mesmo motorista. A Saída compartilha a mesma trava granular da Escala e a segunda
// tentativa precisa reler a ocupação depois que a primeira concluir.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VSWC1','SWC1A23','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VSWC2','SWC2B34','TRUCK','PRÓPRIO','DISPONÍVEL');
for(const [id,matricula,nome] of [['MCV1101','191','MOTORISTA CONCORRENTE UM'],['MCV1102','192','MOTORISTA CONCORRENTE DOIS'],['MCV110X','193','MOTORISTA CONCORRENTE ALVO']]){
  sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run(id,matricula,nome,'MOTORISTA','PRÓPRIO','DISPONÍVEL');
}
const concurrentScheduleA=await saveSchedule(db,admin,{...base,data:'2026-08-26',sequencia:'SWC1',ocs:'SWC-1',horario_ponto:'06:00',veiculo_id:'VSWC1',placa:'SWC1A23',motorista_id:'MCV1101',motorista:'MOTORISTA CONCORRENTE UM',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'});
const concurrentScheduleB=await saveSchedule(db,admin,{...base,data:'2026-08-26',sequencia:'SWC2',ocs:'SWC-2',horario_ponto:'06:05',veiculo_id:'VSWC2',placa:'SWC2B34',motorista_id:'MCV1102',motorista:'MOTORISTA CONCORRENTE DOIS',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'});
const concurrentSwapResults=await Promise.allSettled([
  saveDeparture(db,admin,{data:{schedule_record_id:String(concurrentScheduleA.id),data:'2026-08-26',status:'PENDENTE',hora_programada:'06:00',placa:'SWC1A23',motorista_id:'MCV110X',motorista:'MOTORISTA CONCORRENTE ALVO',justificativa_troca:'Teste concorrente A'}}),
  saveDeparture(db,admin,{data:{schedule_record_id:String(concurrentScheduleB.id),data:'2026-08-26',status:'PENDENTE',hora_programada:'06:05',placa:'SWC2B34',motorista_id:'MCV110X',motorista:'MOTORISTA CONCORRENTE ALVO',justificativa_troca:'Teste concorrente B'}}),
]);
assert.equal(concurrentSwapResults.filter((item)=>item.status==='fulfilled').length,1,'somente uma troca concorrente pode alocar o mesmo motorista');
assert.equal(concurrentSwapResults.filter((item)=>item.status==='rejected').length,1,'a segunda troca concorrente deve ser bloqueada como duplicidade');
const concurrentAssigned=sqlite.prepare(`SELECT COUNT(*) AS C FROM ESCALAS_DIA WHERE DATA='2026-08-26' AND MOTORISTA_ID='MCV110X'`).get();
assert.equal(Number(concurrentAssigned?.C),1,'o mesmo motorista não pode terminar persistido em duas escalas abertas');

// Saída automática por GPS ao deixar a unidade Notaro Alimentos - Recife/PE.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VGPS','GPS1A23','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('M3','104','MOTORISTA GPS','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('A3','105','AJUDANTE GPS','AJUDANTE','PRÓPRIO','DISPONÍVEL');
const gpsSchedule=await saveSchedule(db,admin,{...base,data:'2026-08-20',sequencia:'90',ocs:'GPS-TESTE',horario_ponto:'06:00',veiculo_id:'VGPS',placa:'GPS1A23',motorista_id:'M3',motorista:'MOTORISTA GPS',ajudante_1_id:'A3',ajudante_1:'AJUDANTE GPS'});
sqlite.prepare(`INSERT INTO ROUTE_GPS_POSITIONS (PLATE,LATITUDE,LONGITUDE,GPS_TIME,LOCATION_TEXT,POINT_TEXT,SPEED,IGNITION,RAW_JSON) VALUES (?,?,?,?,?,?,?,?,?)`).run('GPS1A23',-8.333,-36.421,'2026-08-20T05:55:00','NOTARO ALIMENTOS - RECIFE/PE','NOTARO ALIMENTOS - RECIFE/PE',0,1,'{}');
sqlite.prepare(`INSERT INTO ROUTE_GPS_POSITIONS (PLATE,LATITUDE,LONGITUDE,GPS_TIME,LOCATION_TEXT,POINT_TEXT,SPEED,IGNITION,RAW_JSON) VALUES (?,?,?,?,?,?,?,?,?)`).run('GPS1A23',-8.340,-36.400,'2026-08-20T06:20:00','BR-232 - RECIFE/PE','BR-232 - RECIFE/PE',35,1,JSON.stringify({DATAHORA:'2026-08-20 06:20:00'}));
const autoGps=await autoConfirmDeparturesFromGps(db,admin,[{plate:'GPS1A23',updatedAt:'2026-08-20 06:25',timestampReliable:true,timestampSource:'GPS_POSITION_DATE',point:'BR-232 - RECIFE/PE',location:'BR-232 - RECIFE/PE',distanceToPoint:1200,latitude:-8.345,longitude:-36.390,speed:42,ignition:1,raw:{DATAHORA:'2026-08-20 06:25:00'}}],{maxGpsAgeMinutes:9999999});
assert.equal(autoGps.length,1,'GPS deve confirmar automaticamente a saída após duas posições GPS distintas fora da unidade');
assert.equal(autoGps[0]?.time,'06:20','saída automática deve registrar a primeira posição GPS fora, e não o horário em que o DMS processou/confirmou');
const gpsControl=await listDepartureControlRows(db,admin,{date:'2026-08-20'});
const gpsRow=gpsControl.records.find((row)=>String(row.schedule_record_id)===String(gpsSchedule.id));
assert.equal(gpsRow?.status,'SAIU','saída automática deve aparecer como SAIU no Controle de Saída');
assert.equal(Boolean(gpsRow?.automatico),true,'saída automática deve ser identificada como GPS');
const monitoringAfterGps=await listMonitoring(db,admin,{includePending:'1',operational:'1',date:'2026-08-20',recentDays:'3'});
const gpsMonitoring=monitoringAfterGps.find((row)=>String(row.schedule_record_id)===String(gpsSchedule.id));
assert.equal(gpsMonitoring?.status,'EM ROTA','ao detectar a saída por GPS, o Monitoramento deve mover a viagem de PENDENTE DE SAÍDA para EM ROTA');
assert.equal(String(gpsMonitoring?.previsao_retorno_calculada||'').slice(11,16),'10:50','previsão de retorno deve somar deslocamento da rota + 30 min por entrega no VAREJO a partir da saída real');
assert.equal(gpsMonitoring?.tempo_deslocamento_previsto_min,120,'previsão deve considerar ida + entre cidades + volta da BASE_ROTAS');
assert.equal(gpsMonitoring?.tempo_entregas_previsto_min,150,'VAREJO deve considerar 30 minutos por entrega');

// Regressão 2026-08-24: alteração do nome do ponto/localização sem deslocamento real não pode
// confirmar saída. A posição atual está a poucos metros da última posição conhecida dentro da unidade.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VGPSFALSE','GPSF1A2','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MGPSFALSE','99106','MOTORISTA GPS FALSO','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('AGPSFALSE','99109','AJUDANTE GPS FALSO','AJUDANTE','PRÓPRIO','DISPONÍVEL');
const gpsFalseSchedule=await saveSchedule(db,admin,{...base,data:'2026-08-20',sequencia:'91',ocs:'GPS-FALSO',horario_ponto:'06:00',veiculo_id:'VGPSFALSE',placa:'GPSF1A2',motorista_id:'MGPSFALSE',motorista:'MOTORISTA GPS FALSO',ajudante_1_id:'AGPSFALSE',ajudante_1:'AJUDANTE GPS FALSO'});
sqlite.prepare(`INSERT INTO ROUTE_GPS_POSITIONS (PLATE,LATITUDE,LONGITUDE,GPS_TIME,LOCATION_TEXT,POINT_TEXT,SPEED,IGNITION,RAW_JSON) VALUES (?,?,?,?,?,?,?,?,?)`).run('GPSF1A2',-8.333000,-36.421000,'2026-08-20T06:10:00','NOTARO ALIMENTOS - RECIFE/PE','NOTARO ALIMENTOS - RECIFE/PE',0,1,'{}');
const falseGps=await autoConfirmDeparturesFromGps(db,admin,[{plate:'GPSF1A2',updatedAt:'2026-08-20 06:15',timestampReliable:true,timestampSource:'GPS_POSITION_DATE',point:'RUA AO LADO DA UNIDADE',location:'RUA AO LADO DA UNIDADE',latitude:-8.333050,longitude:-36.421050,speed:0,ignition:1}],{maxGpsAgeMinutes:9999999});
assert.equal(falseGps.length,0,'mudança apenas do texto do ponto, sem saída física da geofence, não pode gerar saída automática');
const falseGpsControl=await listDepartureControlRows(db,admin,{date:'2026-08-20'});
assert.notEqual(falseGpsControl.records.find((row)=>String(row.schedule_record_id)===String(gpsFalseSchedule.id))?.status,'SAIU','veículo ainda dentro da unidade deve permanecer sem saída automática');
const departureKpi=await departureDashboard(db,admin,{start:'2026-08-20',end:'2026-08-20'});
assert.ok(departureKpi.summary.departed>=1,'Indicadores de Saída devem reconhecer saídas ligadas à escala pelos aliases de ID');

// Regressão: saídas migradas podem estar vinculadas somente pelo legado_id.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VLEG','LEG1A23','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MLEG','107','MOTORISTA LEGADO','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('ALEG','108','AJUDANTE LEGADO','AJUDANTE','PRÓPRIO','DISPONÍVEL');
const legacySchedule=await saveSchedule(db,admin,{...base,data:'2026-08-20',sequencia:'LG1',ocs:'LEG-0001',horario_ponto:'08:00',veiculo_id:'VLEG',placa:'LEG1A23',motorista_id:'MLEG',motorista:'MOTORISTA LEGADO',ajudante_1_id:'ALEG',ajudante_1:'AJUDANTE LEGADO'});
sqlite.prepare(`INSERT INTO ROUTE_DEPARTURES (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,PLANNED_AT,ACTUAL_AT,DELAY_MINUTES,DATA_JSON) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
  `LEGACY-${legacySchedule.id}`,'2026-08-20','SAIU','LEG1A23','MOTORISTA LEGADO','QA ROTA SMOKE','2026-08-20T08:00','2026-08-20T08:10',10,
  JSON.stringify({legado_id:String(legacySchedule.id),data:'2026-08-20',status:'SAIU',status_saida:'SAIU',hora_programada:'08:00',hora_real:'08:10',placa:'LEG1A23',motorista:'MOTORISTA LEGADO',rota:'QA ROTA SMOKE',regiao:'AG1'})
);
const departureKpiLegacy=await departureDashboard(db,admin,{start:'2026-08-20',end:'2026-08-20'});
assert.ok(departureKpiLegacy.rows.some((item)=>String(item.schedule?.id)===String(legacySchedule.id)&&String(item.departure?.hora_real)==='08:10'),'Indicadores de Saída devem vincular saída migrada pelo legado_id');
assert.ok(departureKpiLegacy.loadingSequence.some((item)=>String(item.schedule?.id)===String(legacySchedule.id)),'Saída migrada pelo legado_id deve entrar na sequência real e nos KPIs de saída');
assert.ok((departureKpiLegacy.averageDelayByDay||[]).some((item)=>item.date==='2026-08-20'&&Number.isFinite(Number(item.averageDelayMinutes))),'Indicadores de Saída devem devolver média de atraso por dia para o gráfico');

// Regressão: retorno confirmado com vínculo legado/incompatível não pode reaparecer como candidato.
// O salvamento já reconhecia esse retorno por dia + placa + rota; a listagem precisa usar a
// mesma identidade operacional para não oferecer "Registrar retorno" de uma viagem finalizada.
sqlite.prepare(`INSERT INTO ROUTE_RETURNS (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?,?)`).run(
  `RETURN-LEGACY-${legacySchedule.id}`,'2026-08-20','FINALIZADO','LEG1A23','MOTORISTA LEGADO','QA ROTA SMOKE','2026-08-20 12:00',
  JSON.stringify({data:'2026-08-20',retorno_real:'2026-08-20 12:00',status:'FINALIZADO',placa:'LEG1A23',motorista:'MOTORISTA LEGADO',rota:'QA ROTA SMOKE'})
);
const returnCandidatesAfterLegacyConfirmed=await listReturnCandidates(db,admin,{start:'2026-08-20',end:'2026-08-20'});
assert.ok(!returnCandidatesAfterLegacyConfirmed.some((item)=>String(item.schedule?.id)===String(legacySchedule.id)),'rota com retorno já confirmado não deve reaparecer na lista de candidatos mesmo quando o SCHEDULE_ID do retorno é legado/incompatível');

// Regressão v1.0.3: duas viagens da MESMA rota no MESMO dia, mas em placas diferentes.
// O fallback antigo somava 30 pontos pela data + 20 pela rota e aceitava score 50,
// confundindo o retorno de uma placa com a outra. A segunda viagem aparecia como
// candidata, mas o POST respondia falsamente "já possui retorno confirmado".
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VRET1','RET1A23','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VRET2','RET2B34','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MRET1','170','MOTORISTA RETORNO UM','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MRET2','171','MOTORISTA RETORNO DOIS','MOTORISTA','PRÓPRIO','DISPONÍVEL');
const sameRouteTripA=await saveSchedule(db,admin,{...base,data:'2026-08-22',sequencia:'RT1',ocs:'RET-1001',horario_ponto:'06:00',veiculo_id:'VRET1',placa:'RET1A23',motorista_id:'MRET1',motorista:'MOTORISTA RETORNO UM',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'});
const sameRouteTripB=await saveSchedule(db,admin,{...base,data:'2026-08-22',sequencia:'RT2',ocs:'RET-1002',horario_ponto:'06:10',veiculo_id:'VRET2',placa:'RET2B34',motorista_id:'MRET2',motorista:'MOTORISTA RETORNO DOIS',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'});
for(const [schedule,plate,driver,time] of [[sameRouteTripA,'RET1A23','MOTORISTA RETORNO UM','06:05'],[sameRouteTripB,'RET2B34','MOTORISTA RETORNO DOIS','06:15']]){
  sqlite.prepare(`INSERT INTO ROUTE_DEPARTURES (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,PLANNED_AT,ACTUAL_AT,DELAY_MINUTES,DATA_JSON) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    String(schedule.id),'2026-08-22','SAIU',plate,driver,'QA ROTA SMOKE',`2026-08-22T${time}`,`2026-08-22T${time}`,0,
    JSON.stringify({schedule_record_id:String(schedule.id),data:'2026-08-22',status:'SAIU',status_saida:'SAIU',hora_real:time,placa:plate,motorista:driver,rota:'QA ROTA SMOKE',regiao:'AG1'})
  );
}
sqlite.prepare(`INSERT INTO ROUTE_RETURNS (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?,?)`).run(
  String(sameRouteTripA.id),'2026-08-22','FINALIZADO','RET1A23','MOTORISTA RETORNO UM','QA ROTA SMOKE','2026-08-22T12:00',
  JSON.stringify({schedule_record_id:String(sameRouteTripA.id),data:'2026-08-22',sequencia:'RT1',ocs:'RET-1001',retorno_real:'2026-08-22T12:00',status:'FINALIZADO',placa:'RET1A23',motorista:'MOTORISTA RETORNO UM',rota:'QA ROTA SMOKE'})
);
const sameRouteCandidates=await listReturnCandidates(db,admin,{start:'2026-08-22',end:'2026-08-22'});
assert.ok(!sameRouteCandidates.some((item)=>String(item.schedule?.id)===String(sameRouteTripA.id)),'viagem da placa RET1A23 já retornada deve sair dos candidatos');
assert.ok(sameRouteCandidates.some((item)=>String(item.schedule?.id)===String(sameRouteTripB.id)),'outra placa da mesma rota/data deve continuar aguardando retorno');
const sameRouteReturnB=await saveReturn(db,admin,{schedule_record_id:String(sameRouteTripB.id),storage:sameRouteTripB.storage||'',schedule_storage:sameRouteTripB.storage||'',data:'2026-08-22',placa:'RET2B34',rota:'QA ROTA SMOKE',motorista:'MOTORISTA RETORNO DOIS',retorno_real:'2026-08-22T12:20',origem:'MANUAL',voltou_com_devolucao:false,apoiou_alguem:false},null);
assert.equal(String(sameRouteReturnB.record?.schedule_record_id),String(sameRouteTripB.id),'retorno da segunda placa deve salvar sem herdar o retorno da primeira');


// Regressão v1.0.4: recurso com retorno confirmado precisa ser reutilizável na
// mesma data. A previsão/horário da viagem encerrada e um Monitoramento residual
// não podem manter placa/motorista presos depois do Retorno real.
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (?,?,?,?,?,?,?)`).run(
  String(sameRouteTripA.id),'2026-08-22','EM ROTA','RET1A23','MOTORISTA RETORNO UM','QA ROTA SMOKE',
  JSON.stringify({schedule_record_id:String(sameRouteTripA.id),data:'2026-08-22',status:'EM ROTA',placa:'RET1A23',motorista:'MOTORISTA RETORNO UM',rota:'QA ROTA SMOKE'})
);
const reusedAfterReturn=await saveSchedule(db,admin,{...base,data:'2026-08-22',sequencia:'RT3',ocs:'RET-1003',horario_ponto:'13:00',veiculo_id:'VRET1',placa:'RET1A23',motorista_id:'MRET1',motorista:'MOTORISTA RETORNO UM',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'});
assert.ok(reusedAfterReturn?.id,'placa/motorista com retorno confirmado devem poder ser escalados novamente no mesmo dia');

// Regressão v1.0.16: quando a programação da viagem seguinte antecede o retorno
// confirmado, mas a saída REAL acontece depois dele, o Controle de Saída deve
// considerar a hora real. A janela planejada não pode manter motorista/veículo
// falsamente bloqueados depois que eles já retornaram.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VRETREAL','RTR1A23','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MRETREAL','9070','MOTORISTA RETORNO REAL','MOTORISTA','PRÓPRIO','DISPONÍVEL');
const overnightBeforeRealDeparture=await saveSchedule(db,admin,{...base,data:'2026-08-24',sequencia:'RR1',ocs:'RET-REAL-1',horario_ponto:'18:00',previsao_retorno:'2026-08-25T07:22',duracao_dias:2,veiculo_id:'VRETREAL',placa:'RTR1A23',motorista_id:'MRETREAL',motorista:'MOTORISTA RETORNO REAL',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'});
sqlite.prepare(`INSERT INTO ROUTE_RETURNS (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?,?)`).run(
  String(overnightBeforeRealDeparture.id),'2026-08-25','FINALIZADO','RTR1A23','MOTORISTA RETORNO REAL','QA ROTA SMOKE','2026-08-25T07:22',
  JSON.stringify({schedule_record_id:String(overnightBeforeRealDeparture.id),data:'2026-08-24',retorno_real:'2026-08-25T07:22',status:'FINALIZADO',placa:'RTR1A23',motorista:'MOTORISTA RETORNO REAL',rota:'QA ROTA SMOKE'})
);
// Simula uma escala já importada/programada para 06:19, antes da confirmação do
// retorno. Esse é o cenário real que precisa ser corrigido no Controle de Saída.
sqlite.prepare(`INSERT INTO ESCALAS_DIA (ID,DATA,SEQUENCIA_CARREGAMENTO,CARGA,QTD_ENTREGAS,PESO_CARGA_TON,HORA_SAIDA_PROGRAMADA,ROTA_ID,ROTA,DESTINO,REGIAO,DURACAO_DIAS,VEICULO_ID,PLACA,MOTORISTA_ID,MOTORISTA,TIPO_EQUIPE,STATUS) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  'ESC-RET-REAL-2','2026-08-25','RR2','RET-REAL-2',1,1,'06:19','R1','QA ROTA SMOKE','QA ROTA SMOKE','QA',1,'VRETREAL','RTR1A23','MRETREAL','MOTORISTA RETORNO REAL','CARGA_FECHADA','PROGRAMADO'
);
let beforeConfirmedReturnStillBlocked=false;
try{
  await saveDeparture(db,admin,{data:{schedule_record_id:'ESC-RET-REAL-2',data:'2026-08-25',status:'SAIU',hora_programada:'06:19',hora_real:'06:50',placa:'RTR1A23',motorista_id:'MRETREAL',motorista:'MOTORISTA RETORNO REAL',tipo_equipe:'CARGA_FECHADA'}});
}catch(error){beforeConfirmedReturnStillBlocked=error.code==='RESOURCE_SCHEDULE_CONFLICT';}
assert.equal(beforeConfirmedReturnStillBlocked,true,'saída real anterior ao retorno confirmado deve continuar bloqueada');
const departureAfterConfirmedReturn=await saveDeparture(db,admin,{data:{schedule_record_id:'ESC-RET-REAL-2',data:'2026-08-25',status:'SAIU',hora_programada:'06:19',hora_real:'09:19',placa:'RTR1A23',motorista_id:'MRETREAL',motorista:'MOTORISTA RETORNO REAL',tipo_equipe:'CARGA_FECHADA',motivo_atraso:'Atraso do motorista - Distribuição',responsavel_atraso:'DISTRIBUIÇÃO',detalhe_motivo:'Motorista voltando de rota'}});
assert.equal(departureAfterConfirmedReturn.record?.hora_real,'09:19','saída real posterior ao retorno confirmado deve ser aceita');


// CAIXAS/ALMOXARIFADO: ocupam o recurso durante o dia, mas não exigem Saída/Retorno e não entram no Monitoramento.
sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,TEMPO_IDA_MIN,TEMPO_ENTRE_CIDADES_MIN,TEMPO_VOLTA_MIN,TEMPO_POR_ENTREGA_MIN,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,?,?,?,?,?,1)`).run('RCX','CAIXAS','INTERNO','VAREJO',0,0,0,0,1);
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VCX','CXA1A23','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MCX','106','MOTORISTA CAIXAS','MOTORISTA','PRÓPRIO','DISPONÍVEL');
const caixasSchedule=await saveSchedule(db,admin,{data:'2026-08-21',sequencia:'CX1',ocs:'INTERNO-CX',peso_kg:0,qtd_entregas:0,horario_ponto:'08:00',rota_id:'RCX',veiculo_id:'VCX',motorista_id:'MCX',tipo_equipe:'CARGA_FECHADA',status:'PROGRAMADO'});
const caixasDeparture=await listDepartureControlRows(db,admin,{date:'2026-08-21'});
assert.ok(!caixasDeparture.records.some((row)=>String(row.schedule_record_id)===String(caixasSchedule.id)),'CAIXAS não deve exigir apontamento no Controle de Saída');
const caixasKpi=await departureDashboard(db,admin,{start:'2026-08-21',end:'2026-08-21'});
assert.ok(!caixasKpi.rows.some((item)=>String(item.schedule?.id)===String(caixasSchedule.id)),'CAIXAS não deve entrar nos Indicadores de Saída');
assert.ok(!(caixasKpi.filters?.routes||[]).some((route)=>/CAIXAS|ALMOXARIFADO/i.test(String(route))),'CAIXAS/ALMOXARIFADO não devem aparecer nos filtros dos Indicadores de Saída');
const caixasMonitoring=await listMonitoring(db,admin,{includePending:'1',operational:'1',date:'2026-08-21',recentDays:'3'});
assert.ok(!caixasMonitoring.some((row)=>String(row.schedule_record_id)===String(caixasSchedule.id)),'CAIXAS não deve aparecer no Monitoramento');
const resourcesNextDay=await buildResourceCenter(db,'2026-08-22');
const caixasVehicleNextDay=resourcesNextDay.vehicles.find((row)=>row.resourceKey==='CXA1A23'||row.resourceName==='CXA1A23');
assert.equal(caixasVehicleNextDay?.status,'DISPONÍVEL','veículo de CAIXAS deve voltar a ficar disponível no dia seguinte sem Retorno manual');

// Rotas fixas: VENEZA não entra em Saídas/Monitoramento; órfão legado de Almoxarifado também não reaparece.
sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,TEMPO_IDA_MIN,TEMPO_ENTRE_CIDADES_MIN,TEMPO_VOLTA_MIN,TEMPO_POR_ENTREGA_MIN,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,?,?,?,?,?,1)`).run('RVNZ','VENEZA','INTERNO','VAREJO',0,0,0,0,1);
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VVNZ','VNZ1A23','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MVNZ','109','MOTORISTA VENEZA','MOTORISTA','PRÓPRIO','DISPONÍVEL');
const venezaSchedule=await saveSchedule(db,admin,{data:'2026-08-22',sequencia:'VNZ1',ocs:'FIXO-VNZ',peso_kg:1000,qtd_entregas:1,horario_ponto:'08:00',rota_id:'RVNZ',veiculo_id:'VVNZ',motorista_id:'MVNZ',tipo_equipe:'CARGA_FECHADA',status:'PROGRAMADO'});
const venezaDeparture=await listDepartureControlRows(db,admin,{date:'2026-08-22'});
assert.ok(!venezaDeparture.records.some((row)=>String(row.schedule_record_id)===String(venezaSchedule.id)),'VENEZA não deve aparecer no Controle de Saída');
const venezaMonitoring=await listMonitoring(db,admin,{includePending:'1',operational:'1',date:'2026-08-22',recentDays:'3'});
assert.ok(!venezaMonitoring.some((row)=>String(row.schedule_record_id)===String(venezaSchedule.id)),'VENEZA não deve aparecer no Monitoramento');
sqlite.prepare(`INSERT INTO ROUTE_DEPARTURES (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,PLANNED_AT,ACTUAL_AT,DELAY_MINUTES,DATA_JSON) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('ORPHAN-ALMOX','2026-08-22','SAIU','ALM1A23','MOTORISTA LEGADO','ALMOXARIFADO PESQUEIRA','2026-08-22T06:00','2026-08-22T06:00',0,JSON.stringify({schedule_record_id:'ORPHAN-ALMOX',data:'2026-08-22',status:'SAIU',rota:'ALMOXARIFADO PESQUEIRA',placa:'ALM1A23'}));
const fixedDepartureAfterOrphan=await listDepartureControlRows(db,admin,{date:'2026-08-22'});
assert.ok(!fixedDepartureAfterOrphan.records.some((row)=>String(row.schedule_record_id)==='ORPHAN-ALMOX'),'registro legado/órfão de ALMOXARIFADO PESQUEIRA não deve reaparecer em Saídas');

// XYZ0000 é uma placa operacional fictícia: pode existir na Escala para referência,
// mas não gera obrigação de Saída, Monitoramento, Retorno ou indicador.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VXYZ','XYZ0000','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MXYZ','9990','MOTORISTA PLACA FICTÍCIA','MOTORISTA','PRÓPRIO','DISPONÍVEL');
const xyzSchedule=await saveSchedule(db,admin,{...base,data:'2026-08-23',sequencia:'XYZ1',ocs:'XYZ-OPERACIONAL',horario_ponto:'06:00',veiculo_id:'VXYZ',placa:'XYZ0000',motorista_id:'MXYZ',motorista:'MOTORISTA PLACA FICTÍCIA',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA'});
const xyzDepartureControl=await listDepartureControlRows(db,admin,{date:'2026-08-23'});
assert.ok(!xyzDepartureControl.records.some((row)=>String(row.schedule_record_id)===String(xyzSchedule.id)),'XYZ0000 não deve exigir registro no Controle de Saída');
sqlite.prepare(`INSERT INTO ROUTE_DEPARTURES (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,PLANNED_AT,ACTUAL_AT,DELAY_MINUTES,DATA_JSON) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(String(xyzSchedule.id),'2026-08-23','SAIU','XYZ0000','MOTORISTA PLACA FICTÍCIA','QA ROTA SMOKE','2026-08-23T06:00','2026-08-23T06:10',10,JSON.stringify({schedule_record_id:String(xyzSchedule.id),data:'2026-08-23',status:'SAIU',hora_real:'06:10',placa:'XYZ0000',rota:'QA ROTA SMOKE'}));
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (?,?,?,?,?,?,?)`).run(String(xyzSchedule.id),'2026-08-23','EM ROTA','XYZ0000','MOTORISTA PLACA FICTÍCIA','QA ROTA SMOKE',JSON.stringify({schedule_record_id:String(xyzSchedule.id),data:'2026-08-23',status:'EM ROTA',status_monitoramento:'EM ROTA',saida_real:'2026-08-23T06:10',placa:'XYZ0000',motorista:'MOTORISTA PLACA FICTÍCIA',rota:'QA ROTA SMOKE'}));
const xyzMonitoring=await listMonitoring(db,admin,{includePending:'1',start:'2026-08-23',end:'2026-08-23'});
assert.ok(!xyzMonitoring.some((row)=>row.placa==='XYZ0000'),'XYZ0000 não deve aparecer no Monitoramento mesmo se houver registro legado');
const xyzReturnCandidates=await listReturnCandidates(db,admin,{start:'2026-08-23',end:'2026-08-23'});
assert.ok(!xyzReturnCandidates.some((item)=>item.schedule?.placa==='XYZ0000'),'XYZ0000 não deve exigir registro de Retorno');

// CAJU v2: ocorrências administrativas, férias e valor especial devem ser derivados sem preenchimento diário.
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,FERIAS_INICIO,FERIAS_FIM,ATIVO) VALUES (?,?,?,?,?,?,?,?,1)`).run('MFV','9301','MOTORISTA FERIAS CAJU','MOTORISTA','PRÓPRIO','DISPONÍVEL','2026-08-03','2026-09-01');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MINSS','9302','MOTORISTA INSS CAJU','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO STATUS_DIARIO (ID,DATA,TIPO_RECURSO,RECURSO_ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,JUSTIFICATIVA,ORIGEM) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('CAJU-INSS-1','2026-08-20','MOTORISTA','MINSS','9302','MOTORISTA INSS CAJU','MOTORISTA','PRÓPRIO','INSS','Afastamento previdenciário','TESTE');
sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,TEMPO_IDA_MIN,TEMPO_ENTRE_CIDADES_MIN,TEMPO_VOLTA_MIN,TEMPO_POR_ENTREGA_MIN,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,?,?,?,?,?,1)`).run('RBAL','BALSAS','MA','VAREJO',60,0,60,30,1);
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VBAL','BAL1A26','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MBAL','9303','MOTORISTA BALSAS CAJU','MOTORISTA','PRÓPRIO','DISPONÍVEL');
const balsasSchedule=await saveSchedule(db,admin,{...base,data:'2026-08-20',sequencia:'BAL1',ocs:'BAL-001',rota_id:'RBAL',rota:'BALSAS',veiculo_id:'VBAL',placa:'BAL1A26',motorista_id:'MBAL',motorista:'MOTORISTA BALSAS CAJU',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA',status:'PROGRAMADO'});
sqlite.prepare(`INSERT INTO ROUTE_DEPARTURES (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,PLANNED_AT,ACTUAL_AT,DELAY_MINUTES,DATA_JSON) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(String(balsasSchedule.id),'2026-08-20','SAIU','BAL1A26','MOTORISTA BALSAS CAJU','BALSAS','2026-08-20T06:00','2026-08-20T06:00',0,JSON.stringify({schedule_record_id:String(balsasSchedule.id),data:'2026-08-20',status:'SAIU',saida_real:'2026-08-20T06:00',rota:'BALSAS',placa:'BAL1A26'}));
sqlite.prepare(`INSERT INTO ROUTE_RETURNS (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?,?)`).run(String(balsasSchedule.id),'2026-08-20','FINALIZADO','BAL1A26','MOTORISTA BALSAS CAJU','BALSAS','2026-08-20T18:00',JSON.stringify({schedule_record_id:String(balsasSchedule.id),data:'2026-08-20',retorno_real:'2026-08-20T18:00',status:'FINALIZADO'}));

// v1.0.37: CAJU não pode inferir PERNOITE apenas pela passagem dos dias.
// Viagem aberta conserva somente os pernoites explicitamente registrados no Monitoramento;
// os demais dias após a saída ficam pendentes de conferência.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VCAOPEN','OPN1A26','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MCAOPEN','9371','MOTORISTA CAJU ABERTO','MOTORISTA','PRÓPRIO','DISPONÍVEL');
const cajuOpenSchedule=await saveSchedule(db,admin,{...base,data:'2026-08-21',sequencia:'CAO1',ocs:'CAJU-OPEN-001',horario_ponto:'06:00',veiculo_id:'VCAOPEN',placa:'OPN1A26',motorista_id:'MCAOPEN',motorista:'MOTORISTA CAJU ABERTO',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA',status:'PROGRAMADO'});
sqlite.prepare(`INSERT INTO ROUTE_DEPARTURES (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,PLANNED_AT,ACTUAL_AT,DELAY_MINUTES,DATA_JSON) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(String(cajuOpenSchedule.id),'2026-08-21','SAIU','OPN1A26','MOTORISTA CAJU ABERTO','QA ROTA SMOKE','2026-08-21T06:00','2026-08-21T06:00',0,JSON.stringify({schedule_record_id:String(cajuOpenSchedule.id),data:'2026-08-21',status:'SAIU',saida_real:'2026-08-21T06:00',rota:'QA ROTA SMOKE',placa:'OPN1A26'}));
const cajuOpenMonitoringStart=await saveMonitoring(db,admin,{schedule_record_id:String(cajuOpenSchedule.id),data:'2026-08-21',status:'EM ROTA',status_monitoramento:'EM ROTA',placa:'OPN1A26',motorista:'MOTORISTA CAJU ABERTO',rota:'QA ROTA SMOKE',entregas_previstas:0,entregas_realizadas:0});
const cajuOpenMonitoringNight=await saveMonitoring(db,admin,{...cajuOpenMonitoringStart.record,status:'PERNOITE',status_monitoramento:'PERNOITE',pernoite_em:'2026-08-22T22:00:00-03:00',justificativa_pernoite:'Pernoite confirmado no smoke',version:cajuOpenMonitoringStart.record.version},cajuOpenMonitoringStart.record.id);
const cajuOpenMonitoringBack=await saveMonitoring(db,admin,{...cajuOpenMonitoringNight.record,status:'EM ROTA',status_monitoramento:'EM ROTA',version:cajuOpenMonitoringNight.record.version},cajuOpenMonitoringNight.record.id);
assert.ok((cajuOpenMonitoringBack.record.pernoite_datas||[]).includes('2026-08-22'),'Monitoramento deve preservar a data explícita de pernoite após voltar para EM ROTA');
const overnightEventCount=Number(sqlite.prepare(`SELECT COUNT(*) AS total FROM ROUTE_RESOURCE_EVENTS WHERE CAST(SCHEDULE_RECORD_ID AS TEXT)=? AND STATUS='PERNOITE' AND UPPER(SOURCE)='MONITORAMENTO'`).get(String(cajuOpenSchedule.id))?.total||0);
assert.ok(overnightEventCount>0,'transição para PERNOITE deve registrar evento de recurso para auditoria/CAJU');

// v1.0.53: viagem já encerrada deve contabilizar todos os dias civis cobertos
// entre saída e retorno confirmado. PERNOITE explícito continua identificado como tal,
// mas os demais dias são confirmados pelo próprio intervalo saída -> retorno.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VCACLS','CLS1A26','TRUCK','TERCEIRO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MCACLS','9372','MOTORISTA CAJU FECHADO','MOTORISTA','PRÓPRIO','DISPONÍVEL');
const cajuClosedSchedule=await saveSchedule(db,admin,{...base,data:'2026-08-21',sequencia:'CAC1',ocs:'CAJU-CLOSED-001',horario_ponto:'07:00',veiculo_id:'VCACLS',placa:'CLS1A26',motorista_id:'MCACLS',motorista:'MOTORISTA CAJU FECHADO',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA',status:'PROGRAMADO'});
sqlite.prepare(`INSERT INTO ROUTE_DEPARTURES (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,PLANNED_AT,ACTUAL_AT,DELAY_MINUTES,DATA_JSON) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(String(cajuClosedSchedule.id),'2026-08-21','SAIU','CLS1A26','MOTORISTA CAJU FECHADO','QA ROTA SMOKE','2026-08-21T07:00','2026-08-21T07:00',0,JSON.stringify({schedule_record_id:String(cajuClosedSchedule.id),data:'2026-08-21',status:'SAIU',saida_real:'2026-08-21T07:00',rota:'QA ROTA SMOKE',placa:'CLS1A26'}));
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (?,?,?,?,?,?,?)`).run(String(cajuClosedSchedule.id),'2026-08-21','FINALIZADO','CLS1A26','MOTORISTA CAJU FECHADO','QA ROTA SMOKE',JSON.stringify({schedule_record_id:String(cajuClosedSchedule.id),data:'2026-08-21',status:'FINALIZADO',status_monitoramento:'FINALIZADO',placa:'CLS1A26',motorista:'MOTORISTA CAJU FECHADO',rota:'QA ROTA SMOKE',pernoite_datas:['2026-08-22']}));
sqlite.prepare(`INSERT INTO ROUTE_RETURNS (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?,?)`).run(String(cajuClosedSchedule.id),'2026-08-24','FINALIZADO','CLS1A26','MOTORISTA CAJU FECHADO','QA ROTA SMOKE','2026-08-24T09:00',JSON.stringify({schedule_record_id:String(cajuClosedSchedule.id),data:'2026-08-24',retorno_real:'2026-08-24T09:00',status:'FINALIZADO'}));

// Ajudante de apoio trabalha de segunda a sábado por padrão. Domingo só gera CAJU
// quando há uma exceção manual explícita em STATUS_DIARIO.
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,AJUDANTE_ROTA,ATIVO) VALUES (?,?,?,?,?,?,0,1)`).run('ASUP1','9373','AJUDANTE APOIO FOLGA','AJUDANTE','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,AJUDANTE_ROTA,ATIVO) VALUES (?,?,?,?,?,?,0,1)`).run('ASUP2','9374','AJUDANTE APOIO DOMINGO','AJUDANTE','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO STATUS_DIARIO (ID,DATA,TIPO_RECURSO,RECURSO_ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,JUSTIFICATIVA,ORIGEM) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('CAJU-SUP-SUN','2026-08-23','AJUDANTE','ASUP2','9374','AJUDANTE APOIO DOMINGO','AJUDANTE','PRÓPRIO','BELO JARDIM','Trabalho excepcional no domingo','MANUAL');

// v1.0.51: status atual do cadastro não pode contaminar retroativamente todo o ciclo.
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MRETRO','9381','MOTORISTA STATUS ATUAL','MOTORISTA','PRÓPRIO','EM ROTA');
// RESERVADO representa outra atividade no dia e deve gerar diária quando registrado naquele dia.
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MRES','9382','MOTORISTA RESERVADO CAJU','MOTORISTA','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO STATUS_DIARIO (ID,DATA,TIPO_RECURSO,RECURSO_ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,JUSTIFICATIVA,ORIGEM) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('CAJU-RES-1','2026-08-19','MOTORISTA','MRES','9382','MOTORISTA RESERVADO CAJU','MOTORISTA','PRÓPRIO','RESERVADO','Reservado para outra atividade','MANUAL');
// Escalas fora das regiões AG1/AG2/AL/PB/SRT geram diária pela própria escala, sem saída/retorno.
sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,TEMPO_IDA_MIN,TEMPO_ENTRE_CIDADES_MIN,TEMPO_VOLTA_MIN,TEMPO_POR_ENTREGA_MIN,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,?,?,?,?,?,1)`).run('RDIR','ROTA DIRETA TESTE','RN','VAREJO',60,0,60,30,1);
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VDIR','DIR1A26','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MDIR','9383','MOTORISTA ESCALA DIRETA','MOTORISTA','PRÓPRIO','DISPONÍVEL');
await saveSchedule(db,admin,{...base,data:'2026-08-19',sequencia:'DIR1',ocs:'DIR-001',rota_id:'RDIR',rota:'ROTA DIRETA TESTE',veiculo_id:'VDIR',placa:'DIR1A26',motorista_id:'MDIR',motorista:'MOTORISTA ESCALA DIRETA',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA',status:'PROGRAMADO'});
// Já uma escala AG1 continua dependendo da confirmação operacional.
sqlite.prepare(`INSERT INTO BASE_ROTAS (ID,ROTA,REGIAO,PERFIL,TEMPO_IDA_MIN,TEMPO_ENTRE_CIDADES_MIN,TEMPO_VOLTA_MIN,TEMPO_POR_ENTREGA_MIN,DURACAO_DIAS,ATIVO) VALUES (?,?,?,?,?,?,?,?,?,1)`).run('RAG1C','AG1 CAJU CONFIRMACAO','AG1','VAREJO',60,0,60,30,1);
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('VAG1C','AGC1A26','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO BASE_COLABORADORES (ID,MATRICULA,NOME,FUNCAO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,?,1)`).run('MAG1C','9384','MOTORISTA AG1 SEM SAIDA','MOTORISTA','PRÓPRIO','DISPONÍVEL');
await saveSchedule(db,admin,{...base,data:'2026-08-19',sequencia:'AGC1',ocs:'AGC-001',rota_id:'RAG1C',rota:'AG1 CAJU CONFIRMACAO',veiculo_id:'VAG1C',placa:'AGC1A26',motorista_id:'MAG1C',motorista:'MOTORISTA AG1 SEM SAIDA',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA',status:'PROGRAMADO'});
// Retorno de férias: a parcela financeira de férias deve completar o valor do
// ciclo até R$ 1.100,00, e nunca somar o valor de férias por cima das diárias além desse teto.
const vacationReturnSchedule=await saveSchedule(db,admin,{...base,data:'2026-09-02',sequencia:'FVR1',ocs:'FERIAS-RET-001',rota_id:'RBAL',rota:'BALSAS',veiculo_id:'VBAL',placa:'BAL1A26',motorista_id:'MFV',motorista:'MOTORISTA FERIAS CAJU',ajudante_1_id:'',ajudante_1:'',tipo_equipe:'CARGA_FECHADA',status:'PROGRAMADO'});
sqlite.prepare(`INSERT INTO ROUTE_DEPARTURES (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,PLANNED_AT,ACTUAL_AT,DELAY_MINUTES,DATA_JSON) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(String(vacationReturnSchedule.id),'2026-09-02','SAIU','BAL1A26','MOTORISTA FERIAS CAJU','BALSAS','2026-09-02T06:00','2026-09-02T06:00',0,JSON.stringify({schedule_record_id:String(vacationReturnSchedule.id),data:'2026-09-02',status:'SAIU',saida_real:'2026-09-02T06:00',rota:'BALSAS',placa:'BAL1A26'}));
sqlite.prepare(`INSERT INTO ROUTE_RETURNS (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,RETURN_AT,DATA_JSON) VALUES (?,?,?,?,?,?,?,?)`).run(String(vacationReturnSchedule.id),'2026-09-02','FINALIZADO','BAL1A26','MOTORISTA FERIAS CAJU','BALSAS','2026-09-02T18:00',JSON.stringify({schedule_record_id:String(vacationReturnSchedule.id),data:'2026-09-02',retorno_real:'2026-09-02T18:00',status:'FINALIZADO'}));


const beforeOccurrenceCutoff=await getOperationalPendingAudit(db,admin,{start:'2026-08-01',end:'2026-08-20'});
assert.equal(beforeOccurrenceCutoff.summary.total,0,'Ocorrências Operacionais devem ser contadas somente a partir de 21/08/2026');

// Ocorrências automáticas: parada a partir de 20 min para a frota em rota; ignição noturna exclusivamente em 3/4.
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (?,?,?,?,?,?,?)`).run('GPS-OCC-1','2026-08-21','EM ROTA','ABC1D23','MOTORISTA TESTE','QA ROTA SMOKE','{}');
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('V34','QTR3A34','3/4','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (?,?,?,?,?,?,?)`).run('GPS-OCC-34','2026-08-21','EM ROTA','QTR3A34','MOTORISTA 3/4','QA ROTA 3/4','{}');

// Última Localização: motorista e rota devem vir sempre da escala mais recente
// da placa, mesmo quando não existe Monitoramento ativo.
sqlite.prepare(`INSERT INTO BASE_VEICULOS (ID,PLACA,TIPO,VINCULO,STATUS,ATIVO) VALUES (?,?,?,?,?,1)`).run('V-LAST-ASSIGN','LST1A26','TRUCK','PRÓPRIO','DISPONÍVEL');
sqlite.prepare(`INSERT INTO ESCALAS_DIA (ID,DATA,SEQUENCIA_CARREGAMENTO,CARGA,QTD_ENTREGAS,PESO_CARGA_TON,HORA_SAIDA_PROGRAMADA,ROTA_ID,ROTA,REGIAO,DURACAO_DIAS,VEICULO_ID,PLACA,MOTORISTA_ID,MOTORISTA,TIPO_EQUIPE,STATUS) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('LAST-ASSIGN-OLD','2026-08-24','LA1','LAST-A',1,1,'06:00','R1','ROTA ANTERIOR','AG1',1,'V-LAST-ASSIGN','LST1A26','M1','MOTORISTA ANTERIOR','CARGA_FECHADA','FINALIZADO');
sqlite.prepare(`INSERT INTO ESCALAS_DIA (ID,DATA,SEQUENCIA_CARREGAMENTO,CARGA,QTD_ENTREGAS,PESO_CARGA_TON,HORA_SAIDA_PROGRAMADA,ROTA_ID,ROTA,REGIAO,DURACAO_DIAS,VEICULO_ID,PLACA,MOTORISTA_ID,MOTORISTA,TIPO_EQUIPE,STATUS) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('LAST-ASSIGN-NEW','2026-08-25','LA2','LAST-B',1,1,'07:00','R1','ROTA MAIS RECENTE','AG2',1,'V-LAST-ASSIGN','LST1A26','M2','MOTORISTA MAIS RECENTE','CARGA_FECHADA','PROGRAMADO');
const latestAssignments=await latestScheduleAssignments(db);
assert.equal(latestAssignments.get('LST1A26')?.motorista,'MOTORISTA MAIS RECENTE','Última Localização deve usar o motorista da escala mais recente da placa');
assert.equal(latestAssignments.get('LST1A26')?.rota,'ROTA MAIS RECENTE','Última Localização deve usar a rota da escala mais recente da placa');

// Resumo: monitoramentos antigos são reconciliados quando a Escala já está
// finalizada ou existe Retorno histórico confirmado em outra estrutura.
sqlite.prepare(`INSERT INTO ESCALAS_DIA (ID,DATA,SEQUENCIA_CARREGAMENTO,CARGA,QTD_ENTREGAS,PESO_CARGA_TON,HORA_SAIDA_PROGRAMADA,ROTA_ID,ROTA,REGIAO,DURACAO_DIAS,VEICULO_ID,PLACA,MOTORISTA_ID,MOTORISTA,TIPO_EQUIPE,STATUS) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('SUMMARY-FINAL-SCHEDULE','2026-08-20','SF1','SUMMARY-F1',1,1,'06:00','R1','ROTA JÁ FINALIZADA','AG1',1,'V1','SUM1A26','M1','MOTORISTA FINALIZADO','CARGA_FECHADA','FINALIZADO');
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (?,?,?,?,?,?,?)`).run('SUMMARY-FINAL-SCHEDULE','2026-08-20','PERNOITE','SUM1A26','MOTORISTA FINALIZADO','ROTA JÁ FINALIZADA',JSON.stringify({schedule_record_id:'SUMMARY-FINAL-SCHEDULE',data:'2026-08-20',status:'PERNOITE',status_monitoramento:'PERNOITE',placa:'SUM1A26',motorista:'MOTORISTA FINALIZADO',rota:'ROTA JÁ FINALIZADA'}));
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (?,?,?,?,?,?,?)`).run('SUMMARY-LEGACY-RETURN','2026-08-20','EM ROTA','SUM2A26','MOTORISTA RETORNADO','ROTA RETORNADA',JSON.stringify({schedule_record_id:'SUMMARY-LEGACY-RETURN',data:'2026-08-20',status:'EM ROTA',status_monitoramento:'EM ROTA',placa:'SUM2A26',motorista:'MOTORISTA RETORNADO',rota:'ROTA RETORNADA'}));
sqlite.prepare(`INSERT INTO RETORNOS (ID,DATA,ESCALA_ID,PLACA,DATA_HORA_RETORNO) VALUES (?,?,?,?,?)`).run('RETURN-SUMMARY-LEGACY','2026-08-21','SUMMARY-LEGACY-RETURN','SUM2A26','2026-08-21T08:00:00');
sqlite.prepare(`INSERT INTO ROUTE_MONITORING (SCHEDULE_ID,DATE_KEY,STATUS,PLATE,DRIVER_NAME,ROUTE,DATA_JSON) VALUES (?,?,?,?,?,?,?)`).run('SUMMARY-ACTIVE-DATE','2026-08-25','EM ROTA','DAT1A26','MOTORISTA DATA SAÍDA','QA ROTA SMOKE',JSON.stringify({schedule_record_id:'SUMMARY-ACTIVE-DATE',data:'2026-08-25',status:'EM ROTA',status_monitoramento:'EM ROTA',saida_real:'2026-08-25T06:37',placa:'DAT1A26',motorista:'MOTORISTA DATA SAÍDA',ajudante_1:'AJUDANTE RESUMO UM',ajudante_2:'AJUDANTE RESUMO DOIS',rota:'QA ROTA SMOKE'}));
const liveSummary=await monitoringSummary(db,admin);
assert.ok(Number(liveSummary.summary.carsInRoute)>=2,'Resumo deve contar veículos únicos em rota');
assert.ok('overnights' in liveSummary.summary,'Resumo deve expor pernoites como dias extras além da duração base');
assert.ok(!liveSummary.rows.some((row)=>['SUM1A26','SUM2A26'].includes(row.placa)),'Resumo não deve contar viagem já finalizada ou retornada');
assert.ok(!liveSummary.rows.some((row)=>row.placa==='XYZ0000'),'XYZ0000 não deve compor o total nem a tabela do Resumo');
assert.equal(liveSummary.rows.find((row)=>row.placa==='DAT1A26')?.saidaEm,'2026-08-25T06:37','Resumo deve expor a data/hora real de saída da viagem em andamento');
assert.equal(liveSummary.rows.find((row)=>row.placa==='DAT1A26')?.ajudantes,'AJUDANTE RESUMO UM / AJUDANTE RESUMO DOIS','Resumo deve expor os dois ajudantes vinculados à viagem');
assert.ok(Number(liveSummary.summary.reconciledCompleted)>=2,'Resumo deve informar quantos monitoramentos inconsistentes foram reconciliados');
assert.equal(sqlite.prepare(`SELECT STATUS FROM ROUTE_MONITORING WHERE SCHEDULE_ID='SUMMARY-FINAL-SCHEDULE'`).get()?.STATUS,'FINALIZADO','Monitoramento de escala finalizada deve ser corrigido na base');
assert.equal(sqlite.prepare(`SELECT STATUS FROM ROUTE_MONITORING WHERE SCHEDULE_ID='SUMMARY-LEGACY-RETURN'`).get()?.STATUS,'FINALIZADO','Monitoramento com retorno histórico deve ser corrigido na base');
// Os fixtures de GPS abaixo usam datas fixas (ago/2026), mas o ProtectSat só
// considera Monitoramentos abertos dos últimos 45 dias. Para o teste não
// expirar com o calendário, o relógio é deslocado para a data dos fixtures
// (mantendo o avanço real do tempo, necessário para os caches internos).
const realDateNow=Date.now;
const fixtureClockOffset=Date.parse('2026-08-21T23:00:00-03:00')-realDateNow();
Date.now=()=>realDateNow()+fixtureClockOffset;
await recordGpsOperationalOccurrences(db,[{plate:'ABC1D23',updatedAt:'2026-08-21T14:35:00',stationarySince:'2026-08-21T14:14:00',stoppedMinutes:21,gpsAgeMinutes:0,ignition:1,location:'BR-232',point:'BR-232',latitude:-8.3,longitude:-36.4}]);
await recordGpsOperationalOccurrences(db,[{plate:'ABC1D23',updatedAt:'2026-08-21T21:10:00',stationarySince:'2026-08-21T21:08:00',stoppedMinutes:2,gpsAgeMinutes:0,ignition:0,location:'CLIENTE TESTE',point:'CLIENTE TESTE',latitude:-8.3,longitude:-36.4}]);
await recordGpsOperationalOccurrences(db,[{plate:'QTR3A34',updatedAt:'2026-08-21T21:10:00',stationarySince:'2026-08-21T21:08:00',stoppedMinutes:2,gpsAgeMinutes:0,ignition:0,location:'CLIENTE 3/4',point:'CLIENTE 3/4',latitude:-8.3,longitude:-36.4}]);
await recordGpsOperationalOccurrences(db,[{plate:'ABC1D23',updatedAt:'2026-08-21T14:40:00',stationarySince:'2026-08-21T14:30:00',stoppedMinutes:10,gpsAgeMinutes:0,ignition:1,location:'BR-232',point:'BR-232',latitude:-8.3,longitude:-36.4}]);
const gpsOccurrences=await getOperationalPendingAudit(db,admin,{start:'2026-08-21',end:'2026-08-21'});
assert.ok(gpsOccurrences.records.some((row)=>row.type==='PARADA_ACIMA_20_MIN'),'parada a partir de 20 min deve gerar ocorrência automática');
assert.ok(!gpsOccurrences.records.some((row)=>row.type==='IGNICAO_DESLIGADA_20_05'),'ignição noturna só deve virar ocorrência após a sessão consolidada registrar tempo efetivo');
assert.ok(!gpsOccurrences.records.some((row)=>row.type==='IGNICAO_DESLIGADA_20_05'&&row.placa==='ABC1D23'),'TRUCK não deve gerar ocorrência de ignição noturna');
assert.ok(gpsOccurrences.records.every((row)=>['PARADA_ACIMA_20_MIN','IGNICAO_DESLIGADA_20_05'].includes(row.type)),'por enquanto, nenhuma outra ocorrência automática deve entrar na tela');
await recordNightIgnitionSessions(db,[{plate:'QTR3A34',updatedAt:'2026-08-21T21:00:00',ignition:0,location:'CLIENTE 3/4',point:'CLIENTE 3/4',latitude:-8.3,longitude:-36.4},{plate:'ABC1D23',updatedAt:'2026-08-21T21:00:00',ignition:0,location:'CLIENTE TESTE',point:'CLIENTE TESTE',latitude:-8.3,longitude:-36.4}]);
await recordNightIgnitionSessions(db,[{plate:'QTR3A34',updatedAt:'2026-08-21T21:35:00',ignition:1,location:'BR-232',point:'BR-232',latitude:-8.3,longitude:-36.4}]);
await recordNightIgnitionSessions(db,[{plate:'QTR3A34',updatedAt:'2026-08-21T22:00:00',ignition:0,location:'CLIENTE 3/4',point:'CLIENTE 3/4',latitude:-8.3,longitude:-36.4}]);
await recordNightIgnitionSessions(db,[{plate:'QTR3A34',updatedAt:'2026-08-21T22:10:00',ignition:1,location:'BR-232',point:'BR-232',latitude:-8.3,longitude:-36.4}]);
const ignition34Rows=sqlite.prepare(`SELECT * FROM ROUTE_IGNITION_OFF_NIGHT WHERE PLATE='QTR3A34' ORDER BY STARTED_AT`).all();
const ignitionTruck=sqlite.prepare(`SELECT * FROM ROUTE_IGNITION_OFF_NIGHT WHERE PLATE='ABC1D23'`).get();
assert.equal(ignition34Rows.length,2,'dois desligamentos na mesma noite devem gerar duas sessões independentes');
assert.ok(ignition34Rows.every((row)=>Number(row.ACTIVE)===0),'sessões encerradas ao religar a ignição não podem permanecer ativas');
const ignition34Total=ignition34Rows.reduce((sum,row)=>sum+Number(row.DURATION_MINUTES||0),0);
assert.equal(ignition34Total,45,'tempo noturno deve somar apenas os períodos realmente desligados, sem contar o intervalo com ignição ligada');
assert.equal(ignitionTruck,undefined,'veículo TRUCK não deve criar sessão noturna de ignição');
const gpsOccurrencesWithReport=await getOperationalPendingAudit(db,admin,{start:'2026-08-21',end:'2026-08-21'});
assert.equal(gpsOccurrencesWithReport.ignitionReport.rows.filter((row)=>row.plate==='QTR3A34').length,1,'pendências devem consolidar a mesma noite do 3/4 em uma única linha');
assert.equal(gpsOccurrencesWithReport.records.filter((row)=>row.type==='IGNICAO_DESLIGADA_20_05'&&row.placa==='QTR3A34').length,1,'a mesma noite deve gerar uma única ocorrência de ignição');
assert.equal(Number(gpsOccurrencesWithReport.records.find((row)=>row.type==='IGNICAO_DESLIGADA_20_05'&&row.placa==='QTR3A34')?.related?.stoppedMinutes),45,'a ocorrência consolidada deve somar todos os intervalos com ignição desligada');
assert.equal(Number(gpsOccurrencesWithReport.ignitionReport.rows.find((row)=>row.plate==='QTR3A34')?.intervalCount),2,'relatório consolidado deve preservar a quantidade de intervalos da noite');
assert.equal(Number(gpsOccurrencesWithReport.ignitionReport.summary.totalMinutes),45,'resumo de ignição deve somar somente o tempo efetivamente desligado');
await recordRouteClientArrivals(db,[{plate:'QTR3A34',updatedAt:'2026-08-21T21:10:00',latitude:-8.3,longitude:-36.4,nearbyClients:[{id:'CLI-34',name:'CLIENTE 3/4',distanceMeters:20},{id:'CLI-OUTRO',name:'CLIENTE MAIS DISTANTE',distanceMeters:35}]}]);
await recordRouteClientArrivals(db,[{plate:'QTR3A34',updatedAt:'2026-08-21T21:15:00',latitude:-8.3,longitude:-36.4,nearbyClients:[{id:'CLI-34',name:'CLIENTE 3/4',distanceMeters:12},{id:'CLI-OUTRO',name:'CLIENTE MAIS DISTANTE',distanceMeters:30}]}]);
let clientArrivalRows=sqlite.prepare(`SELECT * FROM ROUTE_CLIENT_ARRIVALS WHERE SCHEDULE_ID='GPS-OCC-34' AND CLIENT_ID='CLI-34'`).all();
assert.equal(clientArrivalRows.length,1,'permanecer no mesmo cliente não deve duplicar a chegada GPS');
assert.equal(sqlite.prepare(`SELECT COUNT(*) AS total FROM ROUTE_CLIENT_ARRIVALS WHERE SCHEDULE_ID='GPS-OCC-34'`).get()?.total,1,'a viagem deve registrar somente o cliente mais próximo dentro de 100 m');
assert.equal(clientArrivalRows[0].LEFT_AT,null,'chegada deve permanecer aberta enquanto o veículo estiver no raio do cliente');
await recordRouteClientArrivals(db,[{plate:'QTR3A34',updatedAt:'2026-08-21T21:25:00',latitude:-8.29,longitude:-36.39,nearbyClients:[]}]);
clientArrivalRows=sqlite.prepare(`SELECT * FROM ROUTE_CLIENT_ARRIVALS WHERE SCHEDULE_ID='GPS-OCC-34' AND CLIENT_ID='CLI-34'`).all();
assert.equal(String(clientArrivalRows[0].LEFT_AT),'2026-08-21T21:25:00','saída do raio deve fechar o histórico do cliente no horário GPS');
apiResult=await callApi(getTripTimeline,'/api/trip-timeline?scheduleId=GPS-OCC-34');
assert.ok((apiResult.payload.timelines?.['GPS-OCC-34']||[]).some((event)=>event.type==='CLIENTE'&&event.label==='CLIENTE 3/4'),'linha do tempo deve expor chegada ao cliente');
const stopOccurrence=gpsOccurrences.records.find((row)=>row.type==='PARADA_ACIMA_20_MIN');
await justifyOperationalOccurrence(db,admin,{key:stopOccurrence.key,justification:'PARADA OPERACIONAL JUSTIFICADA'});
// Retenções GPS: uma acima de 20 min, uma de 10 min e uma abaixo de 10 min.
// Apenas retenções a partir de 10 min entram nos indicadores; ocorrência continua em 20 min.
sqlite.prepare(`INSERT INTO ROUTE_GPS_RETENTIONS (RETENTION_KEY,DATE_KEY,PLATE,ROUTE,DRIVER_NAME,SCHEDULE_ID,MONITORING_ID,STARTED_AT,LAST_SEEN_AT,ENDED_AT,LOCATION_TEXT,DURATION_MINUTES,ACTIVE) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('GPS_RETENTION|ABC1D23|2026-08-21T14:14:00','2026-08-21','ABC1D23','QA ROTA SMOKE','MOTORISTA TESTE','GPS-OCC-1',1,'2026-08-21T14:14:00','2026-08-21T14:35:00','2026-08-21T14:35:00','BR-232',21,0);
sqlite.prepare(`INSERT INTO ROUTE_GPS_RETENTIONS (RETENTION_KEY,DATE_KEY,PLATE,ROUTE,DRIVER_NAME,SCHEDULE_ID,MONITORING_ID,STARTED_AT,LAST_SEEN_AT,ENDED_AT,LOCATION_TEXT,DURATION_MINUTES,ACTIVE) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('GPS_RETENTION|ABC1D23|2026-08-21T21:08:00','2026-08-21','ABC1D23','QA ROTA SMOKE','MOTORISTA TESTE','GPS-OCC-1',1,'2026-08-21T21:08:00','2026-08-21T21:10:00','2026-08-21T21:10:00','CLIENTE TESTE',2,0);
sqlite.prepare(`INSERT INTO ROUTE_GPS_RETENTIONS (RETENTION_KEY,DATE_KEY,PLATE,ROUTE,DRIVER_NAME,SCHEDULE_ID,MONITORING_ID,STARTED_AT,LAST_SEEN_AT,ENDED_AT,LOCATION_TEXT,DURATION_MINUTES,ACTIVE) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('GPS_RETENTION|ABC1D23|2026-08-21T14:30:00','2026-08-21','ABC1D23','QA ROTA SMOKE','MOTORISTA TESTE','GPS-OCC-1',1,'2026-08-21T14:30:00','2026-08-21T14:40:00','2026-08-21T14:40:00','BR-232',10,0);
const occurrenceIndicators=await getOperationalOccurrenceIndicators(db,{start:'2026-08-21',end:'2026-08-21'});
assert.equal(occurrenceIndicators.summary.occurrences,2,'Indicadores devem considerar ocorrências pendentes e já justificadas');
assert.ok(occurrenceIndicators.summary.retentionMinutes>=31,'Indicadores devem acumular retenções GPS a partir de 10 min e ignorar as menores');
assert.ok(occurrenceIndicators.summary.shortRetentions>=1,'retenções entre 10 e 19 min devem entrar no indicador sem gerar ocorrência');
assert.ok(occurrenceIndicators.byRoute.some((row)=>row.label==='QA ROTA SMOKE'),'Indicadores devem consolidar tempo de retenção por rota');
assert.ok(occurrenceIndicators.byDriver.some((row)=>row.label==='MOTORISTA TESTE'),'Indicadores devem consolidar tempo de retenção por motorista');
assert.ok(occurrenceIndicators.byLocation.some((row)=>/BR-232|CLIENTE TESTE/.test(row.label)),'Indicadores devem consolidar tempo de retenção por local');
assert.ok(occurrenceIndicators.byJustification.some((row)=>row.label==='PARADA OPERACIONAL JUSTIFICADA'),'Indicadores devem consolidar tempo de retenção por justificativa');
assert.ok(occurrenceIndicators.byMonth.some((row)=>row.label==='08/2026'),'Indicadores devem consolidar tempo de retenção por mês');

// A retenção passa a ser persistida a partir de 10 min, a ocorrência abre com 20 min e o primeiro movimento
// atualiza o tempo final tanto na sessão de retenção quanto na ocorrência já justificável.
await updateGpsMotionState(db,[{plate:'ABC1D23',updatedAt:'2026-08-21T12:00:00',speed:0,ignition:1,location:'PONTO TESTE',point:'PONTO TESTE',latitude:-8.3000,longitude:-36.4000}]);
await updateGpsMotionState(db,[{plate:'ABC1D23',updatedAt:'2026-08-21T12:09:00',speed:0,ignition:1,location:'PONTO TESTE',point:'PONTO TESTE',latitude:-8.3000,longitude:-36.4000}]);
assert.equal(sqlite.prepare(`SELECT COUNT(*) AS C FROM ROUTE_GPS_RETENTIONS WHERE RETENTION_KEY=?`).get('GPS_RETENTION|ABC1D23|2026-08-21T12:00:00').C,0,'parada abaixo de 10 min não deve ser persistida como retenção');
await updateGpsMotionState(db,[{plate:'ABC1D23',updatedAt:'2026-08-21T12:11:00',speed:0,ignition:1,location:'PONTO TESTE',point:'PONTO TESTE',latitude:-8.3000,longitude:-36.4000}]);
assert.equal(Number(sqlite.prepare(`SELECT DURATION_MINUTES FROM ROUTE_GPS_RETENTIONS WHERE RETENTION_KEY=?`).get('GPS_RETENTION|ABC1D23|2026-08-21T12:00:00')?.DURATION_MINUTES),11,'retenção deve ser persistida ao ultrapassar o limiar de 10 min');
await updateGpsMotionState(db,[{plate:'ABC1D23',updatedAt:'2026-08-21T12:21:00',speed:0,ignition:1,location:'PONTO TESTE',point:'PONTO TESTE',latitude:-8.3000,longitude:-36.4000}]);
await recordGpsOperationalOccurrences(db,[{plate:'ABC1D23',updatedAt:'2026-08-21T12:21:00',stationarySince:'2026-08-21T12:00:00',gpsAgeMinutes:0,ignition:1,location:'PONTO TESTE',point:'PONTO TESTE',latitude:-8.3000,longitude:-36.4000}]);
await updateGpsMotionState(db,[{plate:'ABC1D23',updatedAt:'2026-08-21T12:25:00',speed:15,ignition:1,location:'PONTO SEGUINTE',point:'PONTO SEGUINTE',latitude:-8.2990,longitude:-36.3990}]);
const finalizedRetention=sqlite.prepare(`SELECT DURATION_MINUTES,ACTIVE FROM ROUTE_GPS_RETENTIONS WHERE RETENTION_KEY=?`).get('GPS_RETENTION|ABC1D23|2026-08-21T12:00:00');
assert.equal(Number(finalizedRetention?.DURATION_MINUTES),25,'retenção deve ser fechada com o tempo total ao voltar a movimentar');
assert.equal(Number(finalizedRetention?.ACTIVE),0,'retenção deve ser marcada como encerrada no primeiro movimento');
const finalizedOccurrence=sqlite.prepare(`SELECT STOPPED_MINUTES,DATA_JSON FROM ROUTE_GPS_OCCURRENCES WHERE OCCURRENCE_KEY=?`).get('GPS_STOP_20|ABC1D23|2026-08-21T12:00:00');
assert.equal(Number(finalizedOccurrence?.STOPPED_MINUTES),25,'ocorrência aberta aos 20 min deve receber o tempo final da parada');
assert.equal(Boolean(JSON.parse(finalizedOccurrence?.DATA_JSON||'{}').active),false,'ocorrência finalizada deve deixar de ser marcada como em andamento');

const all=await listScheduleRecordsInternal(db,{start:'2026-08-18',end:'2026-08-19'});
assert.equal(all.records.filter((row)=>!String(row.id||'').startsWith('HELP-')&&!['DIR1','AGC1'].includes(String(row.sequencia||''))).length,4,'quatro escalas válidas principais, incluindo a reutilização do ajudante após Retorno, devem permanecer');
Date.now=realDateNow;
console.log('OK: autenticação, cadastros/listagens, migrations, bloqueio de duplicidade e liberação por Retorno real validados.');
