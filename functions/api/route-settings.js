import { jsonResponse, requireUser } from '../_lib/auth.js';
import { assertRouteAccess } from '../_lib/route-access.js';
import { audit } from '../_lib/core.js';

const DEFAULTS = Object.freeze({
  JORNADA_NORMAL_MIN:528,
  HORA_EXTRA_MAX_MIN:120,
  JORNADA_TOTAL_MIN:648,
  INTERVALO_JORNADA_MIN:60,
  INTERJORNADA_MIN:660,
  TOLERANCIA_SAIDA_MIN:30,
  HORA_SAIDA_SEGUNDA:'05:00',
  HORA_SAIDA_TERCA_SABADO:'06:00',
  AUTO_REFRESH_MONITOR_MIN:5,
  SESSION_HOURS:8,
  ALERTA_JORNADA_MIN:60,
});
const DESCRIPTIONS = Object.freeze({
  JORNADA_NORMAL_MIN:'Jornada normal diária, em minutos.', HORA_EXTRA_MAX_MIN:'Limite de hora extra, em minutos.',
  JORNADA_TOTAL_MIN:'Jornada produtiva máxima (10h48 = 648 min).', INTERVALO_JORNADA_MIN:'Intervalo diário, em minutos.',
  INTERJORNADA_MIN:'Interjornada mínima (11h = 660 min).',
  TOLERANCIA_SAIDA_MIN:'Tolerância de saída, em minutos.', HORA_SAIDA_SEGUNDA:'Horário padrão de saída na segunda-feira.',
  HORA_SAIDA_TERCA_SABADO:'Horário padrão de saída de terça a sábado.', AUTO_REFRESH_MONITOR_MIN:'Atualização automática do Monitoramento, em minutos.',
  SESSION_HOURS:'Duração da sessão, em horas.', ALERTA_JORNADA_MIN:'Antecedência do alerta de limite de jornada, em minutos.',
});

const TIME_KEYS = new Set(['HORA_SAIDA_SEGUNDA','HORA_SAIDA_TERCA_SABADO']);
function validatedSetting(key,value){
  const text=String(value??'').trim();
  if(TIME_KEYS.has(key)){
    const match=text.match(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
    if(!match) throw new Error(`${key}: informe um horário válido no formato HH:MM.`);
    return text;
  }
  const number=Number(text);
  if(!Number.isFinite(number)||number<0||!Number.isInteger(number)) throw new Error(`${key}: informe um número inteiro igual ou maior que zero.`);
  if(key==='SESSION_HOURS'&&number<1) throw new Error('SESSION_HOURS deve ser pelo menos 1 hora.');
  return String(number);
}
async function tableExists(db,name){return Boolean((await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND UPPER(name)=?").bind(name.toUpperCase()).first())?.name);}
async function columns(db,name){if(!(await tableExists(db,name)))return new Set();const r=await db.prepare(`PRAGMA table_info("${name}")`).all();return new Set((r.results||[]).map(x=>String(x.name||'').toUpperCase()));}
async function readSettings(db){
  if(!(await tableExists(db,'CONFIGURACOES'))) return {storageReady:false,values:{...DEFAULTS}};
  const result=await db.prepare('SELECT * FROM CONFIGURACOES').all(); const values={...DEFAULTS};
  for(const row of result.results||[]){const key=String(row.CHAVE??row.KEY??'').trim().toUpperCase();if(key && key in DEFAULTS) values[key]=row.VALOR??row.VALUE??values[key];}
  return {storageReady:true,values};
}
export async function onRequestGet({env,request}){
  if(!env.DB)return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);const auth=await requireUser(env.DB,request);if(auth.response)return auth.response;
  try{assertRouteAccess(auth.user,'route.settings');const payload=await readSettings(env.DB);return jsonResponse({versao:'1',...payload,descriptions:DESCRIPTIONS});}
  catch(error){return jsonResponse({erro:error.message||String(error),codigo:error.code||'ROUTE_SETTINGS_ERROR',versao:'1'},400);}
}
export async function onRequestPut({env,request}){
  if(!env.DB)return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);const auth=await requireUser(env.DB,request);if(auth.response)return auth.response;
  try{
    assertRouteAccess(auth.user,'route.settings',true);
    if(!(await tableExists(env.DB,'CONFIGURACOES'))) throw new Error('A tabela CONFIGURACOES não existe no D1 atual. Aplique a migration 0001_auth_core_settings.sql antes de editar parâmetros.');
    const cols=await columns(env.DB,'CONFIGURACOES'); if(!cols.has('CHAVE')||!cols.has('VALOR')) throw new Error('CONFIGURACOES existe, mas não possui as colunas CHAVE e VALOR esperadas pela v2.0.44.');
    const body=await request.json().catch(()=>({})); const values=body.values||body; const updated=[];const statements=[];
    const actor=auth.user.email||auth.user.name||'';
    for(const [key,defaultValue] of Object.entries(DEFAULTS)){
      if(!(key in values))continue; const value=validatedSetting(key,values[key]??defaultValue);
      const insertCols=['CHAVE','VALOR'],insertValues=[key,value],placeholders=['?','?'];
      if(cols.has('DESCRICAO')){insertCols.push('DESCRICAO');insertValues.push(DESCRIPTIONS[key]||'');placeholders.push('?');}
      if(cols.has('USUARIO')){insertCols.push('USUARIO');insertValues.push(actor);placeholders.push('?');}
      const updates=['VALOR=excluded.VALOR'];
      if(cols.has('DESCRICAO'))updates.push('DESCRICAO=excluded.DESCRICAO');
      if(cols.has('USUARIO'))updates.push('USUARIO=excluded.USUARIO');
      if(cols.has('ATUALIZADO_EM'))updates.push('ATUALIZADO_EM=CURRENT_TIMESTAMP');
      statements.push(env.DB.prepare(`INSERT INTO CONFIGURACOES (${insertCols.join(',')}) VALUES (${placeholders.join(',')}) ON CONFLICT(CHAVE) DO UPDATE SET ${updates.join(',')}`).bind(...insertValues));
      updated.push(key);
    }
    if(statements.length)await env.DB.batch(statements);
    const payload=await readSettings(env.DB);await audit(env.DB,auth.user,'EDITAR','PARAMETROS','CONFIGURACOES',{updated,values:Object.fromEntries(updated.map((key)=>[key,payload.values[key]]))});return jsonResponse({ok:true,versao:'1',updated,...payload,descriptions:DESCRIPTIONS});
  }catch(error){return jsonResponse({erro:error.message||String(error),codigo:error.code||'ROUTE_SETTINGS_ERROR',versao:'1'},400);}
}
export async function onRequestPost(context){return onRequestPut(context);}
