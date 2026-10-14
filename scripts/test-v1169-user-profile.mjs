import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { onRequestGet, onRequestPut } from '../functions/api/auth/profile.js';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(join(root,'migrations'))).filter((x)=>x.endsWith('.sql')&&!/import_/i.test(x)).sort()) sqlite.exec(await readFile(join(root,'migrations',file),'utf8'));
function makeStatement(sql){let values=[];const api={bind(...args){values=args;return api;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const info=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(info.changes||0)}};}};return api;}
const db={prepare:makeStatement,async batch(statements){const out=[];for(const s of statements)out.push(await s.run());return out;}};
const env={DB:db};
sqlite.prepare(`INSERT INTO ROUTE_USERS (ID,NAME,EMAIL,ROLE,CARGO,PASSWORD_HASH,SALT) VALUES (1,'Ewerton Diogo','e@natto.local','ADMIN','Analista','x','y'),(2,'Outra Pessoa','o@natto.local','OPERADOR','','x','y')`).run();
const future=new Date(Date.now()+86400000).toISOString();
sqlite.prepare(`INSERT INTO ROUTE_SESSIONS (TOKEN,USER_ID,EXPIRES_AT) VALUES ('t1',1,?),('t2',2,?)`).run(future,future);
const call=async(handler,method,body,token='t1')=>{const response=await handler({env,request:new Request('https://rota.test/api/auth/profile',{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined})});return {status:response.status,body:await response.json()};};

assert.equal((await call(onRequestGet,'GET',null,'invalido')).status,401,'sem sessão não lê perfil');
let r=await call(onRequestGet,'GET');
assert.equal(r.status,200);assert.equal(r.body.user.name,'Ewerton Diogo');assert.deepEqual(r.body.profile.workDays,[]);

const png='data:image/png;base64,'+Buffer.from('fakepng').toString('base64');
r=await call(onRequestPut,'PUT',{name:'Ewerton Diogo Martins',cargo:'Gerente de Logística',department:'Distribuição',unit:'Frigorífico Belo Jardim',phone:'(81) 99999-0000 abc',birthdate:'1990-05-17',bio:'Olá',workStart:'08:00',workEnd:'17:30',workBreakMin:'90',workDays:['seg','TER','xxx','SEG','SEX'],avatar:png});
assert.equal(r.status,200);
assert.equal(r.body.user.name,'Ewerton Diogo Martins');assert.equal(r.body.user.cargo,'Gerente de Logística');
assert.equal(r.body.profile.phone,'(81) 99999-0000','telefone só mantém dígitos e símbolos de telefone');
assert.deepEqual(r.body.profile.workDays,['SEG','TER','SEX'],'dias válidos, sem repetição');
assert.equal(r.body.profile.workBreakMin,90);assert.equal(r.body.profile.avatar,png);

// Atualização parcial preserva o restante.
r=await call(onRequestPut,'PUT',{bio:'Nova bio'});
assert.equal(r.body.profile.bio,'Nova bio');assert.equal(r.body.profile.workStart,'08:00');assert.equal(r.body.profile.avatar,png);assert.equal(r.body.user.cargo,'Gerente de Logística');

// Validações.
for(const [body,regex] of [[{name:'A'},/nome/i],[{workStart:'25:00',workEnd:'17:00'},/inválido/],[{workStart:'08:00',workEnd:''},/entrada e o de saída/],[{workBreakMin:900},/Intervalo/],[{birthdate:'2999-01-01'},/Data de nascimento/],[{avatar:'javascript:alert(1)'},/Foto inválida/],[{avatar:'data:text/html;base64,AAAA'},/Foto inválida/],[{avatar:'data:image/png;base64,'+'A'.repeat(150000)},/Foto inválida/]]){
  const bad=await call(onRequestPut,'PUT',body);assert.equal(bad.status,400,JSON.stringify(body));assert.match(bad.body.erro,regex);
}
// Remover foto e isolamento entre usuários.
r=await call(onRequestPut,'PUT',{avatar:''});assert.equal(r.body.profile.avatar,'');
const other=await call(onRequestGet,'GET',null,'t2');assert.equal(other.body.user.name,'Outra Pessoa');assert.equal(other.body.profile.bio,'','perfil de outro usuário não vaza');
await call(onRequestPut,'PUT',{bio:'Só da outra'},'t2');assert.equal((await call(onRequestGet,'GET')).body.profile.bio,'Nova bio');

// Tela.
const app=fs.readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../public/_worker.js',import.meta.url),'utf8');
assert(worker.includes("'/api/auth/profile'"));
assert(app.includes("$('#change-password-button').onclick=()=>navigate('route_profile')")&&app.includes("$('.user-compact')?.addEventListener('click',()=>navigate('route_profile'))"),'avatar e botão abrem o perfil');
assert(app.includes('async function renderProfile()')&&app.includes("route==='route_profile'"));
assert(index.includes('title="Meu perfil"'));
assert(app.includes('async function openPhotoCropper(')&&app.includes('profile-photo-adjust'),'enquadramento da foto (arrastar e zoom) e botão Enquadrar');
assert(!app.includes('profileImageToDataUrl'),'envio da foto sempre passa pelo enquadrador');
const sidebarStart=index.indexOf('<aside id="sidebar"');
const sidebar=index.slice(sidebarStart,index.indexOf('</aside>',sidebarStart));
assert(!sidebar.includes('sidebar-base'),'bloco Sistema/Rota removido');
assert(sidebar.indexOf('sidebar-profile')>sidebar.indexOf('id="main-navigation"'),'perfil do usuário fica no rodapé do menu, depois da navegação');
console.log('OK v1169 - Meu perfil: cargo, horário de trabalho, foto, senha e preferências.');
