import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {plannedWeightFromRootDocuments} from '../functions/_lib/lincros.js';
import {buildDevolutionIndicators} from '../functions/_lib/indicators.js';

const delivery={CdEntrega:'E1',CdClienteNegocio:'C1',Pedidos:[{NotasFiscais:[{CdNotaFiscalNegocio:'15007475'}]}]};
const root={Entregas:[delivery],Documentos:[{Numero:'15007475',Itens:[{Produto:'A',PesoLiquido:'120,5'},{Produto:'B',PesoLiquido:'79,5'}]}]};
assert.equal(plannedWeightFromRootDocuments(root,delivery),200,'Peso de itens deve herdar a referência da NF do objeto pai.');

const rootWithTotal={Entregas:[delivery],Documentos:[{Numero:'15007475',PesoTotal:200,Itens:[{PesoLiquido:120.5},{PesoLiquido:79.5}]}]};
assert.equal(plannedWeightFromRootDocuments(rootWithTotal,delivery),200,'Peso total do documento deve prevalecer sem duplicar itens.');

const data=buildDevolutionIndicators([
 {id:'1',schedule_id:'1',data:'2026-09-24',rota:'AG1 CARUARU',regiao:'AG1',perfil_rota:'VAREJO',placa:'AAA1A11',motorista:'A',lincros_sync_healthy:true,lincros_deliveries_routed:10,lincros_deliveries_pointed:10,lincros_deliveries_returned:2,lincros_returned_weight_kg:35},
 {id:'2',schedule_id:'2',data:'2026-09-24',rota:'AG1 CARUARU REDES',regiao:'AG1',perfil_rota:'REDE',placa:'BBB2B22',motorista:'B',lincros_sync_healthy:true,lincros_deliveries_routed:5,lincros_deliveries_pointed:5,lincros_deliveries_returned:1,lincros_returned_weight_kg:20},
]);
assert.equal(data.returnedDeliveries,3);
assert.equal(data.returnedWeightKg,55);
assert.equal(data.byTrip.length,2);
assert.equal(data.byDriver.length,2);
assert.equal(data.byRoute.length,2);
assert.equal(data.byRegion[0].returnedDeliveries,3);
assert.equal(data.byProfile.length,2);
assert.equal(data.daily[0].returnedDeliveries,3);

const route=await readFile(new URL('../public/assets/route.js',import.meta.url),'utf8');
assert(route.includes('Devoluções · Lincros'),'Tela de devoluções ausente.');
assert(route.includes('Devoluções por motorista')&&route.includes('Varejo × Rede'),'Quebras de análise ausentes.');
assert(route.includes('route-ind-devol-export'),'Exportação CSV de devoluções ausente.');
console.log('OK v1.0.141 - peso pendente por herança documental e indicadores de devolução validados.');
