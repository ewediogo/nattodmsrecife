import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scheduleJs=await readFile(new URL('../functions/_lib/schedule.js',import.meta.url),'utf8');
const routeJs=await readFile(new URL('../public/assets/route.js',import.meta.url),'utf8');
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));

assert.equal(pkg.version,'1.0.158');
assert.match(scheduleJs,/allowIncompleteCrew/,'importação deve ter modo interno para equipe incompleta');
assert.match(scheduleJs,/INCOMPLETE_CREW_IMPORT/,'linha importada sem equipe precisa ficar auditável');
assert.match(scheduleJs,/a pré-escala é uma ajuda, não uma condição para importar/,'pré-escala não pode bloquear lote');
assert.match(scheduleJs,/pendingManual/,'resposta precisa informar quantas linhas ficaram para preenchimento manual');
assert.doesNotMatch(scheduleJs,/Pré-escala não encontrou motorista elegível[\s\S]{0,180}continue;/,'falta de motorista não pode mais pular a linha');
assert.match(routeJs,/A falta de sugestão não bloqueia a importação/,'prévia deve explicar o novo comportamento');
assert.match(routeJs,/ficou\(aram\) com equipe pendente para preenchimento manual/,'usuário deve ser avisado sobre pendências manuais');
console.log('OK: v1.0.72 importa todas as linhas estruturalmente válidas mesmo com pré-escala incompleta.');
