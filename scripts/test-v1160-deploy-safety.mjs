import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

// 1) migrations/ só pode conter migrations de esquema compatíveis com o D1.
//    Scripts de diagnóstico/reparo manual ficam em scripts/sql/manual/, senão o
//    `wrangler d1 migrations apply` executa o reparo sem revisão.
for (const file of fs.readdirSync(new URL('migrations/', root)).filter((f) => f.endsWith('.sql'))) {
  const sql = read(`migrations/${file}`).replace(/--.*$/gm, '');
  assert(!/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/im.test(sql), `${file}: D1 não aceita BEGIN/COMMIT/SAVEPOINT em migrations`);
  assert(!/CREATE\s+TEMP/i.test(sql), `${file}: D1 não autoriza tabela TEMP`);
  assert(!/REPARO MANUAL|Diagnóstico SOMENTE LEITURA|TRANSFERIDA_DA_ESCALA/.test(read(`migrations/${file}`)), `${file}: script manual não pode ficar em migrations/`);
}
assert(fs.existsSync(new URL('scripts/sql/manual/diagnostico_transferencia_15h.sql', root)));
assert(fs.existsSync(new URL('scripts/sql/manual/reparo_transferencia_15h.sql', root)));

// 2) O Worker de cron (transferência das 15h) precisa de deploy próprio.
const pkg = JSON.parse(read('package.json'));
assert(pkg.scripts['deploy:cron']?.includes('workers/protectsat-cron'), 'falta o atalho npm run deploy:cron');
assert(read('.github/workflows/deploy-cron.yml').includes('npm run deploy:cron'), 'workflow do GitHub deve publicar o cron');
assert(read('workers/protectsat-cron/src/index.js').includes('public/server/functions/_lib/departure.js'));

// 3) Versão única em pacote, Worker e cache dos assets.
assert.equal(pkg.version, '1.0.158');
assert(read('public/_worker.js').includes(`const VERSION='${pkg.version}';`));
assert(read('public/index.html').includes('dms-rota-v1158-'));

// 4) Dependências de CDN com versão exata (sem @5 ou sem versão).
const index = read('public/index.html');
for (const url of index.match(/https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net\/npm)\/[^"']+/g) || []) {
  assert(/@\d+\.\d+\.\d+\//.test(url), `dependência de CDN sem versão exata: ${url}`);
}

// 5) Ajudante de rota ESCALADO segue a mesma regra no backend, Escala e Saída.
const app = read('public/assets/app.js');
assert(app.includes("const routeHelperScheduled=Boolean(item.ajudante_rota)&&normalize(item.status||'')==='ESCALADO';"));
assert(app.includes('||routeHelperScheduled||isCurrent;'));

console.log('OK v1.0.158 - migrations seguras para D1, cron com deploy próprio, versões e CDNs fixadas.');
