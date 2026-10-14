import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const route = await read('public/assets/route.js');
const css = await read('public/assets/app.css');
const index = await read('public/index.html');
const pkg = JSON.parse(await read('package.json'));

assert.equal(pkg.version,'1.0.158','versão deve permanecer alinhada ao pacote atual');
assert.match(index,/dms-rota-v1141-login-sessao-20260924/,'assets precisam refletir a revisão atual para quebrar cache');
assert.match(route,/schedulePrintSequenceValue/,'PDF deve calcular sequência numérica');
assert.match(route,/compareSchedulePrintRows/,'PDF deve usar comparador dedicado por sequência');
assert.match(route,/const sorted=rows\.slice\(\)\.sort\(compareSchedulePrintRows\);/,'impressão deve ordenar pela função de sequência');
assert.match(route,/TRANSFERENCIA\|TRANSFERÊNCIA/,'rotas de transferência sem sequência devem ser tratadas como administrativas na impressão');
assert.doesNotMatch(route,/sem sequência no final da frota própria/,'legenda do PDF não deve mais exibir a ordenação');

assert.match(css,/tbody>tr\[data-route-schedule-row\]:not\(\.is-editing\)>td\{display:none!important;\}/,'estado recolhido deve esconder todas as células do formulário');
assert.match(css,/tbody>tr\[data-route-schedule-row\]:not\(\.is-editing\)>td:first-child\{/,'somente a primeira célula pode hospedar o resumo');
assert.match(css,/tbody>tr\[data-route-schedule-row\]:not\(\.is-editing\) \.schedule-sequence-cell[\s\S]*display:none!important;/,'controle antigo da sequência não deve aparecer no modo recolhido');
assert.match(css,/tbody>tr\[data-route-schedule-row\]:not\(\.is-editing\) \.schedule-compact-row\{[\s\S]*grid-template-columns:58px/s,'desktop deve usar barra-resumo limpa e dedicada');
assert.match(css,/@media \(max-width:920px\)[\s\S]*grid-template-areas:[\s\S]*"seq route driver action"/,'tablet deve reorganizar a barra-resumo sem reexibir o formulário');
assert.match(css,/@media \(max-width:640px\)[\s\S]*"seq route action"/,'mobile deve ter quebra compacta controlada');

console.log('OK: v1.0.39 limpa a Escala recolhida de verdade e ordena o PDF por sequência de carregamento.');
