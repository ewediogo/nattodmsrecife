import { APP_LABEL, jsonResponse, requireUser } from '../_lib/auth.js';
import { assertRouteAccess } from '../_lib/route-access.js';

export async function onRequestGet({env,request}){
  if(!env.DB)return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request);if(auth.response)return auth.response;
  try{
    assertRouteAccess(auth.user,'route.dashboard');
    return jsonResponse({sistema:'NATTO DMS ROTA',versao:'1',versaoNome:APP_LABEL,user:auth.user,module:'route',screens:[
      'dashboard','schedule','departures','departure-indicators','monitoring','location','returns','indicators','management','vehicles','drivers','helpers','routes','users','settings','operational-pending'
    ]});
  }catch(error){return jsonResponse({erro:error.message,codigo:error.code||'BOOTSTRAP_ERROR'},403);}
}
