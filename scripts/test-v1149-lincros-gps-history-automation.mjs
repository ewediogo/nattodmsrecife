import fs from 'node:fs';
import assert from 'node:assert/strict';

const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const lincrosLib=read('functions/_lib/lincros.js');
const departureLib=read('functions/_lib/departure.js');
const returnLib=read('functions/_lib/return.js');
const departuresApi=read('functions/api/departures.js');
const lincrosApi=read('functions/api/lincros.js');
const timelineApi=read('functions/api/trip-timeline.js');
const protectsatApi=read('functions/api/protectsat.js');
const routeJs=read('public/assets/route.js');
const appJs=read('public/assets/app.js');

assert.match(lincrosLib,/export async function storeLincrosGpsPosition/,'Lincros deve gravar posição no histórico GPS comum.');
assert.match(lincrosLib,/ROUTE_GPS_POSITIONS/,'Lincros deve usar ROUTE_GPS_POSITIONS.');
assert.match(lincrosLib,/ROUTE_GPS_LATEST/,'Lincros deve atualizar ROUTE_GPS_LATEST.');
assert.match(lincrosLib,/__DMS_SOURCE:'LINCROS'/,'Histórico Lincros deve identificar a fonte.');
assert.match(lincrosLib,/export async function syncLincrosSchedulesFromDaySnapshot/,'Deve haver sincronização em lote de posições Lincros das escalas pendentes.');
assert.match(departuresApi,/syncPendingLincrosPositions/,'Controle de saída deve sincronizar Lincros antes da reconciliação GPS.');
assert.match(departuresApi,/lincrosReconcile/,'Controle de saída deve expor diagnóstico da reconciliação Lincros.');
assert.match(departureLib,/loadGpsFacilityAnchors/,'Saída automática deve conhecer âncoras geográficas da unidade.');
assert.match(departureLib,/positionInsideFacilityAnchors/,'Saída automática deve avaliar coordenadas Lincros na geofence.');
assert.match(returnLib,/loadGpsFacilityAnchors/,'Retorno automático deve conhecer âncoras geográficas da unidade.');
assert.match(returnLib,/positionInsideFacilityAnchors/,'Retorno automático deve avaliar coordenadas Lincros na geofence.');
assert.match(lincrosApi,/autoConfirmDeparturesFromGps/,'Sincronização Lincros deve disparar reconciliação de saída.');
assert.match(lincrosApi,/autoConfirmReturnsFromGps/,'Sincronização Lincros deve disparar reconciliação de retorno.');
assert.match(timelineApi,/RAW_JSON/,'Timeline GPS deve ler metadados da fonte.');
assert.match(timelineApi,/source!=='LINCROS'/,'Timeline deve marcar velocidade/ignição Lincros como não confiáveis.');
assert.match(protectsatApi,/raw\.__DMS_SOURCE\|\|'PROTECTSAT'/,'Leitura do histórico compartilhado deve preservar a fonte da posição.');
assert.match(routeJs,/id="monitor-detail-gps"/,'Detalhe do Monitoramento deve exibir registros de localização.');
assert.match(routeJs,/Registros de localização/,'Detalhe do Monitoramento deve nomear a seção de posições.');
assert.match(routeJs,/returnGpsRecordsHtml\(timeline\.gpsRecords/,'Detalhe do Monitoramento deve renderizar o histórico GPS/Lincros.');
assert.match(routeJs,/<th>Fonte<\/th>/,'Tabela de posições deve indicar ProtectSat/Lincros.');
assert.match(appJs,/Consultando ProtectSat e Lincros/,'Atualização do Controle de Saída deve indicar ambas as fontes.');

console.log('OK v1.0.149 - histórico Lincros + saída/retorno automático por geofence.');
