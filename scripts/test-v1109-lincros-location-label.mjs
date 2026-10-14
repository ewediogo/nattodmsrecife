import fs from 'node:fs';
const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const lincros=fs.readFileSync(new URL('../public/server/functions/_lib/lincros.js',import.meta.url),'utf8');
const monitoring=fs.readFileSync(new URL('../public/server/functions/_lib/monitoring.js',import.meta.url),'utf8');
for(const [label,ok] of [
  ['coordenadas Lincros no label',route.includes('`Lincros · ${coords}`')],
  ['cliente próximo propagado',route.includes('nearbyClients:nearby')],
  ['não força texto genérico',route.includes("best.point||best.location||'Posição Lincros'")],
  ['consulta espacial clientes',lincros.includes('LATITUDE BETWEEN ? AND ?')&&lincros.includes('distanceMeters<=100')],
  ['monitoramento solicita clientes próximos',monitoring.includes('{nearbyClients:true}')],
]){if(!ok)throw new Error(`Falha: ${label}`);console.log(`OK ${label}`)}
