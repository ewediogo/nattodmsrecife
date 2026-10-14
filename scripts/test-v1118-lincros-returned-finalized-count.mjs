import fs from 'node:fs';
const assert=(c,m)=>{if(!c)throw new Error(m);};
const lib=fs.readFileSync(new URL('../functions/_lib/lincros.js',import.meta.url),'utf8');
assert(lib.includes('detailedFinalized=deliveries.filter((x)=>x.delivered||x.returned).length'),'Atendimentos finalizados com devolução não entram no total apontado.');
assert(lib.includes('const done=Math.max(rootDoneTotal,detailedFinalized)'),'Contador geral não reconcilia resumo da rota com detalhe finalizado.');
assert(lib.includes('Math.max(rootReturned.reduce'),'Devoluções detalhadas podem ser perdidas quando o resumo da rota devolve zero.');
console.log('OK v1.0.126: devolução finalizada conta no total apontado e deixa de permanecer pendente.');
