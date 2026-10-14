import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const app=await readFile(new URL('../public/assets/app.js',import.meta.url),'utf8');
const index=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const login=await readFile(new URL('../functions/api/auth/login.js',import.meta.url),'utf8');

assert.equal(pkg.version,'1.0.158');
assert(app.includes("const isCredentialEndpoint=/^\\/api\\/auth\\/(?:login|setup)"),'Login/setup precisam ser reconhecidos como endpoints de credencial.');
assert(app.includes('if(state.token&&!isCredentialEndpoint)headers.Authorization'),'Login não deve enviar token antigo/expirado.');
assert(app.includes('if(response.status===401&&!isCredentialEndpoint){clearSession();showAuth();throw new Error'), '401 protegido continua encerrando sessão expirada.');
assert(app.includes('if(response.status===401&&isCredentialEndpoint)clearSession();'),'401 do login deve limpar token antigo sem substituir a mensagem do backend.');
assert(login.includes("Matrícula/e-mail ou senha inválidos."),'Backend precisa manter mensagem específica de credencial inválida.');
assert(index.includes('dms-rota-v1141-login-sessao-20260924'),'Assets precisam invalidar o cache do navegador.');
console.log('OK v1.0.141 - login distingue credencial inválida de sessão expirada e ignora Bearer antigo.');
