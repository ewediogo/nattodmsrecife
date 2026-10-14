import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const route = await read('public/assets/route.js');
const css = await read('public/assets/app.css');
const index = await read('public/index.html');
const pkg = JSON.parse(await read('package.json'));

assert.equal(pkg.version,'1.0.158','pacote atual deve refletir a versão consolidada 1.0.126');
assert.match(index,/dms-rota-v1141-login-sessao-20260924/,'assets precisam refletir a revisão atual para quebrar cache');
assert.match(route,/class="schedule-compact-row" data-route-schedule-summary/,'linha recolhida deve usar barra compacta dedicada');
for(const key of ['sequencia','rota','regiao','placa','motorista','horario','status']){
  assert.match(route,new RegExp(`data-route-summary="${key}"`),`resumo compacto deve expor ${key}`);
}
assert.match(route,/data-route-schedule-summary-toggle/,'resumo compacto deve possuir botão próprio de Editar\/Detalhes');
assert.match(route,/\$\$\('\[data-route-schedule-toggle\],\[data-route-schedule-summary-toggle\]'/,'os dois controles precisam abrir e recolher a mesma linha');
assert.match(route,/compactStatus\.innerHTML=badge\(current\.status\|\|'PROGRAMADO'\)/,'status do resumo precisa acompanhar alterações da linha');

assert.match(css,/tr\[data-route-schedule-row\]:not\(\.is-editing\)>td\{display:none!important;\}/,'modo recolhido deve esconder todos os campos do formulário');
assert.match(css,/tr\[data-route-schedule-row\]:not\(\.is-editing\)>td:nth-child\(1\)\{\s*display:block!important/s,'somente a célula hospedeira do resumo deve permanecer visível');
assert.match(css,/not\(\.is-editing\)>td::before\{display:none!important;content:none!important;\}/,'rótulos antigos não podem flutuar na linha compacta');
assert.match(css,/\.schedule-compact-row\{\s*display:grid;grid-template-columns:54px/s,'desktop deve ser uma barra horizontal compacta');
assert.match(css,/\.schedule-page-panel \.schedule-editor-table tr\[data-route-schedule-row\] td:nth-child\(16\)\{grid-area:observation!important;\}/,'célula 16 deve ser Observação');
assert.match(css,/\.schedule-page-panel \.schedule-editor-table tr\[data-route-schedule-row\] td:nth-child\(17\)\{grid-area:actions!important;\}/,'célula 17 deve ser Ações');
assert.match(css,/"seq helper1 helper2 team time cold return status"\s*\n\s*"seq observation observation observation actions actions actions actions"!important;/,'editor expandido deve mapear as 17 células sem sobreposição');

console.log('OK: v1.0.38 corrige a Escala recolhida para uma barra compacta e realinha as 17 células do editor.');
