import fs from 'node:fs';import assert from 'node:assert/strict';
const lib=fs.readFileSync(new URL('../functions/_lib/lincros.js',import.meta.url),'utf8');
assert(lib.includes("try{journeys=await fetchJourneys(env,{date,plate});}catch(error){journeyError=error"),'Falha da Jornada deve ser não fatal.');
assert(lib.includes("ensureDailyLincrosSnapshot(db,env,date,{force:forceDaily,maxAgeMinutes:forceDaily?0:5})"),'Fallback diário deve respeitar atualização forçada.');
assert(lib.includes("dailyFallback:chosen.strategy.startsWith('DAILY_')||chosen.strategy.startsWith('NEXT_DAY_')")&&lib.includes('||Boolean(journeyError)'), 'Resultado deve sinalizar fallback quando Jornada falhar.');
console.log('OK v1.0.126: HTTP 400/erro da Jornada não bloqueia fallback diário do StatusRota.');
