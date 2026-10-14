import { APP_LABEL, ensureAuthSchema, jsonResponse } from '../_lib/auth.js';
import { ensureCoreSchema } from '../_lib/core.js';
import { ensureRoutePhase1Schema } from '../_lib/route-phase1.js';

async function safeCount(db,table){try{const row=await db.prepare(`SELECT COUNT(*) AS total FROM "${table}"`).first();return Number(row?.total||0);}catch{return 0;}}
export async function onRequestGet({env}){
  if(!env.DB)return jsonResponse({ok:false,erro:"Binding D1 'DB' não encontrado."},500);
  try{
    await ensureAuthSchema(env.DB);await ensureCoreSchema(env.DB);await ensureRoutePhase1Schema(env.DB);
    const [users,employees,vehicles,routes,schedules,departures,monitoring,returns]=await Promise.all([
      safeCount(env.DB,'ROUTE_USERS'),safeCount(env.DB,'BASE_COLABORADORES'),safeCount(env.DB,'BASE_VEICULOS'),safeCount(env.DB,'BASE_ROTAS'),safeCount(env.DB,'ESCALAS_DIA'),safeCount(env.DB,'ROUTE_DEPARTURES'),safeCount(env.DB,'ROUTE_MONITORING'),safeCount(env.DB,'ROUTE_RETURNS')]);
    return jsonResponse({ok:true,sistema:'NATTO DMS ROTA',versao:'1',versaoNome:APP_LABEL,d1:true,counts:{users,employees,vehicles,routes,schedules,departures,monitoring,returns},timestamp:new Date().toISOString()});
  }catch(error){return jsonResponse({ok:false,erro:error.message||String(error)},500);}
}
