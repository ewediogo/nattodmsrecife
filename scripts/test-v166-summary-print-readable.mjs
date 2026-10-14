import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const monitoring=fs.readFileSync(new URL('../functions/_lib/monitoring.js',import.meta.url),'utf8');

assert.equal(pkg.version,'1.0.158');
assert.match(html,/dms-rota-v1141-login-sessao-20260924/);
assert.match(ui,/nenhum título ROTA\/PLACA\/MOTORISTA\/AJUDANTE/,'cards devem registrar explicitamente a regra sem títulos internos');
assert.doesNotMatch(ui,/drawText\('ROTA'/,'não deve imprimir título ROTA sobre os valores');
assert.doesNotMatch(ui,/drawText\('PLACA'/,'não deve imprimir título PLACA sobre os valores');
assert.doesNotMatch(ui,/drawText\('MOTORISTA'/,'não deve imprimir título MOTORISTA sobre os valores');
assert.doesNotMatch(ui,/drawText\('AJUDANTE\(S\)'/,'não deve imprimir título AJUDANTE(S) sobre os valores');
assert.match(ui,/const preferredCols=totalRows>60\?5:totalRows>36\?4:3/,'listas grandes devem abrir mais colunas antes de comprimir a altura');
assert.match(ui,/w\.document\.adoptNode\(canvas\)/,'preview deve usar o canvas diretamente, sem IMG bloqueada por CSP');
assert.match(ui,/printButton\.onclick=\(\)=>\{w\.focus\(\);w\.print\(\);\}/,'impressão deve usar handler JS explícito');
assert.doesNotMatch(ui,/<img src="\$\{imageUrl\}" alt="Resumo operacional da frota">/,'preview não deve depender de blob em tag IMG');
assert.match(monitoring,/ocs:clean\(row\.ocs\|\|row\.carga\|\|row\.CARGA\|\|row\.OCS\|\|''\)/,'Resumo precisa entregar OC ao quadro');

console.log('OK: v1.0.78 mantém o quadro legível em uma folha e remove títulos internos que sobrepunham os dados.');
