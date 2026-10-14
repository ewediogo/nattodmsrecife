import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {plannedWeightFromRootDocuments} from '../functions/_lib/lincros.js';

const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const route=await readFile(new URL('../public/assets/route.js',import.meta.url),'utf8');
const monitoring=await readFile(new URL('../functions/_lib/monitoring.js',import.meta.url),'utf8');
const index=await readFile(new URL('../public/index.html',import.meta.url),'utf8');

assert.equal(pkg.version,'1.0.158');
assert(route.includes('id="route-monitor-filter-category"'),'Monitoramento deve possuir filtro de Categoria.');
assert(route.includes('<option value="VAREJO">Varejo</option><option value="REDE">Rede</option>'),'Filtro deve separar Varejo e Rede.');
assert(route.includes("if(categoryFilter&&monitoringCategory(x)!==categoryFilter)return false;"),'Categoria deve ser aplicada independentemente da região.');
assert(route.includes('categoria:monitoringCategory(r)'),'CSV deve levar a categoria filtrada.');
assert(route.includes('category:$(\'#route-monitor-filter-category\')?.value'),'PDF de pendências deve receber a categoria da tela.');
assert(monitoring.includes("monitoringEffectiveResource(departure,'MOTORISTA'"),'Monitoramento deve reconciliar o motorista pelo histórico efetivo da Saída.');
assert(monitoring.includes("Object.prototype.hasOwnProperty.call(change,'novo')"),'Último valor novo da troca deve prevalecer sobre snapshot antigo.');

const root={
  Documentos:[
    {CdClienteNegocio:'165321',CdNotaFiscalNegocio:'1500210',PesoLiquido:'286,00'},
    {CdClienteNegocio:'118030',CdNotaFiscalNegocio:'15002137',PesoLiquido:'40,00'},
  ],
  Entregas:[
    {CdEntrega:'E1',CdClienteNegocio:'165321',NmCliente:'CLIENTE 1',Pedidos:[{NotasFiscais:[{CdNotaFiscalNegocio:'1500210'}]}]},
    {CdEntrega:'E2',CdClienteNegocio:'118030',NmCliente:'CLIENTE 2',Pedidos:[{NotasFiscais:[{CdNotaFiscalNegocio:'15002137'}]}]},
  ],
};
assert.equal(plannedWeightFromRootDocuments(root,root.Entregas[0]),286,'Peso previsto deve ser recuperado de documento/NF fora do objeto da entrega.');
assert.equal(plannedWeightFromRootDocuments(root,root.Entregas[1]),40,'Peso previsto deve ser relacionado por cliente/NF.');
assert(index.includes('dms-rota-v1141-login-sessao-20260924'),'Assets devem invalidar cache para a revisão 1.0.141.');
console.log('OK v1.0.141 - filtro categoria, recursos efetivos e peso previsto Lincros.');
