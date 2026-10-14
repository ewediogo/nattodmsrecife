import { readdir, readFile, access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const required=[
  'public/index.html','public/_worker.js','public/assets/app.js','public/assets/route.js','public/assets/app.css',
  'functions/_lib/schedule.js','functions/_lib/core.js','functions/_lib/auth.js','functions/_lib/return.js',
  'functions/api/schedule.js','functions/api/departures.js','functions/api/monitoring.js','functions/api/returns.js',
  'migrations/0001_auth_core_settings.sql','migrations/0002_master_data.sql','migrations/0003_schedule_resources.sql',
  'migrations/0004_operations.sql','migrations/0005_awards.sql','migrations/0006_protectsat.sql','migrations/0007_fix_cadastros.sql',

];
for(const file of required){try{await access(join(root,file));}catch{throw new Error(`Arquivo obrigatório ausente: ${file}`);}}

async function walk(dir){const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory()){if(entry.name==='server')continue;out.push(...await walk(path));}else out.push(path);}return out;}
const js=(await walk(root)).filter((f)=>f.endsWith('.js')||f.endsWith('.mjs'));
for(const file of js){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0)throw new Error(`Falha de sintaxe em ${relative(root,file)}\n${r.stderr||r.stdout}`);}

const runtimeFiles=[...(await walk(join(root,'functions'))),join(root,'public/index.html'),join(root,'public/assets/app.js'),join(root,'public/assets/route.js'),join(root,'public/_worker.js'),...(await walk(join(root,'migrations')))].filter((f)=>!f.endsWith('.webp'));
const forbidden=[
  ['/api/transfers','API de Transferências'],['/api/point','API de Pontos'],['/api/caju','API de CAJU'],['/api/module','handler genérico'],
  ['DMS_V3_REGISTROS','tabela legada genérica'],['SOURCE_TABLE','campo de sincronização'],['SOURCE_HASH','campo de sincronização']
];
const violations=[];
for(const file of runtimeFiles){const text=await readFile(file,'utf8');for(const [needle,label] of forbidden){if(text.includes(needle))violations.push(`${relative(root,file)} contém ${label}: ${needle}`);}}
if(violations.length)throw new Error(`Conteúdo fora do escopo Rota:\n${violations.join('\n')}`);

const worker=await readFile(join(root,'public/_worker.js'),'utf8');
for(const endpoint of ['/api/schedule','/api/departures','/api/monitoring','/api/returns','/api/resources','/api/clients','/api/reverse-geocode','/api/indicators','/api/protectsat','/api/diagnostics']){
  if(!worker.includes(endpoint))throw new Error(`Worker não expõe ${endpoint}`);
}
const app=await readFile(join(root,'public/assets/app.js'),'utf8');
for(const feature of ['id="departure-pdf"','generateDepartureStatusPdf','departureRowsForReport','@page{size:A4 landscape']){
  if(!app.includes(feature))throw new Error(`Controle de Saída sem recurso esperado do PDF: ${feature}`);
}
const route=await readFile(join(root,'public/assets/route.js'),'utf8');
for(const feature of ['data-key="observacoes"','<th>Observação</th>','print-observation','observacoes:x.observacoes']){
  if(!route.includes(feature))throw new Error(`Escala sem recurso esperado de Observação: ${feature}`);
}
for(const feature of ['DISPONÍVEL PARA APOIO','AJUDANTE DE ROTA${item.cidade_rota?` · BASE','scheduleOperationalStatus(item)']){
  if(!route.includes(feature))throw new Error(`Seletor da Escala sem identificação clara do ajudante de rota: ${feature}`);
}

for(const feature of ['<h3>Histórico de viagens</h3>','id=\"route-return-filter-oc\"',"'route-return-filter-helper'","'route-return-filter-destination'",'historico_viagens_${start}_${end}.csv','return-history-table','data-route-return-details=\"${i}\"','Abrir detalhes e GPS da viagem']){
  if(!route.includes(feature))throw new Error(`Retornos sem histórico/filtro solicitado: ${feature}`);
}
const returnLib=await readFile(join(root,'functions/_lib/return.js'),'utf8');
for(const feature of ['enrichReturnHistoryFromLoaded','historical_enriched','buildConfirmedReturnHistoryFromLoaded','dias_cobertos']){
  if(!returnLib.includes(feature))throw new Error(`Backend de Retornos sem enriquecimento do histórico: ${feature}`);
}
const schedule=await readFile(join(root,'functions/_lib/schedule.js'),'utf8');
if(!schedule.includes("if (confirmedReturnReleasesPlanning && (context.returnBySchedule.has(String(item.id || ''))"))throw new Error('Escala não libera todos os recursos após Retorno confirmado');
if(!schedule.includes("resourceConflict(context,employee.id,'COLABORADOR',schedule,routeHelper||repeatedDriverPlanning,role,true)"))throw new Error('Ajudante de rota ainda pode ser bloqueado por conflito de Escala');
if(!schedule.includes('type===\'VEICULO\'&&confirmedVehicleReturn(context,item,id)'))throw new Error('Escala não possui fallback de Retorno confirmado pela placa do veículo');
for(const source of ['FROM ROUTE_RETURNS','FROM ROUTE_RECORDS','FROM RETORNOS'])if(!schedule.includes(source))throw new Error(`Escala não consulta a fonte de Retorno: ${source}`);
const availability=await readFile(join(root,'functions/_lib/availability.js'),'utf8');
if(!availability.includes("createAvailabilityRowsForSchedule(db,schedule,dateIso(returnDateTime),'RETORNO REAL'"))throw new Error('Retorno não libera recursos imediatamente na própria data');
const gps=await readFile(join(root,'functions/api/protectsat.js'),'utf8');
if(!gps.includes('NEARBY_CLIENT_RADIUS_METERS=100')||!gps.includes('.slice(0,1)'))throw new Error('Registro de chegada GPS sem restrição ao cliente mais próximo em 100 m');
if(app.includes('trip-timeline?scheduleIds')||app.includes('Histórico da viagem</span>'))throw new Error('Tela de ocorrências ainda carrega ou exibe histórico da viagem');
console.log(`OK: ${js.length} arquivos JavaScript validados; estrutura exclusiva do módulo Rota.`);
