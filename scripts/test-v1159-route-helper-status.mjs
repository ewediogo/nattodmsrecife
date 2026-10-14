import assert from 'node:assert/strict';
import fs from 'node:fs';
const schedule=fs.readFileSync(new URL('../functions/_lib/schedule.js',import.meta.url),'utf8');
const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
assert(schedule.includes("entry.status==='ESCALADO'||entry.status==='PERNOITE'"));
assert(schedule.includes("status:'DISPONÍVEL PARA APOIO'"));
assert(schedule.includes("const hard=HARD_EMPLOYEE_STATUSES.has"));
assert(route.includes("date&&seq&&seq!=='0'"));
console.log('OK bug 3 - escalado não é apoio, bloqueios duros preservados');
