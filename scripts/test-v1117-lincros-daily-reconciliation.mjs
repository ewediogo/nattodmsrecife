import fs from 'node:fs';
const lib=fs.readFileSync(new URL('../functions/_lib/lincros.js',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../functions/api/lincros.js',import.meta.url),'utf8');
function assert(ok,msg){if(!ok)throw new Error(msg);}
assert(lib.includes("strategy:'RECONCILED_DAILY_PLATE_DATE'"),'Sincronização deve reconciliar Jornada com snapshot diário.');
assert(lib.includes('forceDaily=Boolean(options?.forceDaily)'),'Atualização manual deve poder forçar snapshot diário.');
assert(lib.includes('dailyDeliveryCount>directDeliveryCount'),'Reconciliação deve preferir snapshot diário quando houver mais entregas.');
assert(lib.includes('source.length>1&&singleDmsSchedule'),'Snapshot com uma única escala DMS deve consolidar todas as rotas da placa/data.');
assert(api.includes('dailyReconciliation'),'Diagnóstico deve comparar resultado diário mesmo quando Jornada encontra a placa.');
assert(api.includes('{forceDaily:true}'),'Atualização manual deve forçar a reconciliação diária.');
console.log('OK v1.0.126 - reconciliação Lincros Jornada x snapshot diário');
