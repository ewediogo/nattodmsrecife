import { appJson, appWritesEnabled, requireAppService } from '../../../_lib/app-integration.js';

export async function onRequestGet(context) {
  await requireAppService(context.request,context.env);
  return appJson({
    ok:true,
    service:'DMS-Rota API para NATTO Entregas',
    database:'db-recife',
    writeEnabled:appWritesEnabled(context.env),
    timestamp:new Date().toISOString(),
  });
}
