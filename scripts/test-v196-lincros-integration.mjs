import fs from 'node:fs';
import { fetchJourneys, fetchRouteDetails } from '../functions/_lib/lincros.js';
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const route=fs.readFileSync(`${root}/public/assets/route.js`,'utf8');
const worker=fs.readFileSync(`${root}/public/_worker.js`,'utf8');
const lib=fs.readFileSync(`${root}/functions/_lib/lincros.js`,'utf8');
const migration=fs.readFileSync(`${root}/migrations/0030_lincros_tracking_sync.sql`,'utf8');
const wrangler=fs.readFileSync(`${root}/wrangler.toml`,'utf8');
const assert=(c,m)=>{if(!c)throw new Error(m);};
assert(worker.includes("['/api/lincros',lincros]"),'Endpoint /api/lincros não registrado no worker.');
assert(lib.includes('/api/v1/jornada/BuscarJornadasRotas'),'Consulta Jornada por placa/data ausente.');
assert(lib.includes('/api/statusRota/v4/StatusRotaDetalhado'),'Consulta StatusRotaDetalhado v4 ausente.');
assert(lib.includes('PLATE_DATE_SINGLE_DMS_ROUTE'),'Regra de consolidação de múltiplas rotas Lincros ausente.');
assert(migration.includes('LINCROS_ROUTE_SYNC')&&migration.includes('LINCROS_DELIVERIES'),'Tabelas D1 da integração ausentes.');
assert(route.includes('Clientes entregues')&&route.includes('Clientes pendentes'),'Detalhamento de clientes Lincros ausente.');
assert(route.includes('bestRoutePosition')&&route.includes("source:'LINCROS'"),'Redundância GPS Lincros ausente.');
assert(route.includes('route-client-popup-actions')&&route.includes('shareMonitoringClient(client)'),'Popup clicável/compartilhável dos clientes ausente.');
assert(wrangler.includes('LINCROS_BASE_URL')&&!wrangler.includes('LINCROS_API_KEY ='),'Secret da API não deve ser gravada no wrangler.toml.');
const calls=[];const previous=globalThis.fetch;globalThis.fetch=async(url,opts={})=>{calls.push({url:String(url),headers:opts.headers||{}});return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});};
try{
  const env={LINCROS_BASE_URL:'https://notaro-tracking.lincros.com',LINCROS_API_KEY:'segredo-teste'};
  await fetchJourneys(env,{date:'2026-09-14',plate:'SMU6G23'});await fetchRouteDetails(env,'2516333');
  assert(calls[0].url.includes('dataRota=2026-09-14T00%3A00%3A00')&&calls[0].url.includes('placa=SMU6G23'),'Jornada não envia placa+data.');
  assert(calls[1].url.includes('CodigoRotaNegocio=2516333'),'v4 não consulta CodigoRotaNegocio.');
  assert(calls.every((c)=>c.headers.apikey==='segredo-teste'),'Header apikey não foi aplicado server-side.');
}finally{globalThis.fetch=previous;}
console.log('OK v1.0.97: Lincros Jornada→v4, cache D1, GPS redundante e clientes no mapa validados.');
