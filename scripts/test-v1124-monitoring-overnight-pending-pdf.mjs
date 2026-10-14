import fs from 'node:fs';
import assert from 'node:assert/strict';

const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));

assert.equal(pkg.version,'1.0.158');
assert(route.includes('id="route-monitor-overnight-pdf"'),'Monitoramento deve exibir botão do PDF de pendências.');
assert(route.includes('function generateOvernightPendingClientsPdf'),'Gerador do PDF de pernoite deve existir.');
assert(route.includes("normalize(r.status||r.status_monitoramento)==='PERNOITE'"),'PDF deve restringir o relatório a rotas em PERNOITE.');
assert(route.includes('generateOvernightPendingClientsPdf(visibleRecords'),'PDF deve partir dos registros já filtrados na página.');
assert(route.includes("query:$('#route-monitor-filter-search')?.value"),'PDF deve carregar o filtro de busca atual.');
assert(route.includes("status:$('#route-monitor-filter-status')?.value"),'PDF deve carregar o filtro de etapa atual.');
assert(route.includes("region:$$('[data-route-monitor-region]:checked').map((input)=>input.value).join(', ')"),'PDF deve carregar todas as regiões selecionadas no filtro múltiplo.');
for(const field of ['Placa:','Motorista:','Entregas realizadas','Clientes pendentes','clientCode','clientName','sequencePlanned']){
  assert(route.includes(field),`PDF deve conter ${field}`);
}
assert(route.includes('lincros?.syncHealthy===true'),'Detalhamento de clientes deve usar sincronização Lincros saudável.');
assert(route.includes('Salvar como PDF'),'Relatório deve orientar a saída em PDF.');
assert(/route\.js\?rev=dms-rota-v\d+/.test(index),'route.js deve possuir cache-busting versionado.');
console.log('OK v1.0.126 - PDF de clientes pendentes das rotas em pernoite respeita filtros do Monitoramento.');
