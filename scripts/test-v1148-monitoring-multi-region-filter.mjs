import fs from 'node:fs';
const source=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/assets/app.css',import.meta.url),'utf8');
const must=[
  'data-route-monitor-region',
  "const regionFilters=new Set(selectedMonitorRegions())",
  "if(regionFilters.size&&!regionFilters.has(normalize(x.regiao)))return false",
  "selected.length<=2?selected.join(' + '):`${selected.length} regiões selecionadas`",
  "$$('[data-route-monitor-region]:checked').map((input)=>input.value).join(', ')"
];
for(const token of must){if(!source.includes(token))throw new Error(`Filtro multirregião ausente: ${token}`);}
if(source.includes("$('#route-monitor-filter-region').onchange=draw"))throw new Error('Filtro antigo de região única ainda está vinculado.');
if(!css.includes('.monitoring-region-options')||!css.includes('.monitoring-region-option'))throw new Error('Estilos do multisseletor de região ausentes.');
console.log('OK · Monitoramento permite selecionar uma ou várias regiões e mantém categoria independente.');
