import fs from 'node:fs';
const css=fs.readFileSync(new URL('../public/assets/app.css',import.meta.url),'utf8');
const must=[
  '.monitoring-filter-panel{\n  position:relative;\n  z-index:300;\n  overflow:visible;',
  '.monitoring-region-field{position:relative;z-index:2;}',
  'position:absolute;z-index:1200;left:0;right:0;top:calc(100% + 6px);',
  '#route-monitor-metrics,#route-monitor-grid{position:relative;z-index:1;}'
];
for(const token of must){if(!css.includes(token)) throw new Error(`Regra ausente: ${token}`);}
console.log('OK v1151 monitoring region dropdown layer');
