import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const app=await readFile(join(root,'public/assets/app.js'),'utf8');
const dep=await readFile(join(root,'functions/_lib/departure.js'),'utf8');
for (const [name,text] of [['frontend',app],['backend',dep]]) {
  if(!text.includes("{label:'Reunião/Treinamento',owner:'DISTRIBUIÇÃO'}")) throw new Error(`${name}: motivo Reunião/Treinamento ausente`);
}
console.log('OK v1.0.95: Reunião/Treinamento disponível e validado no frontend/backend.');
