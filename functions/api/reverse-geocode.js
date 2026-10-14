import { jsonResponse, requireUser } from '../_lib/auth.js';
import { assertRouteAccess } from '../_lib/route-access.js';
import { reverseGeocode } from '../_lib/reverse-geocode.js';

export async function onRequestGet({env,request}){
  if(!env.DB)return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request);if(auth.response)return auth.response;
  try{try{assertRouteAccess(auth.user,'route.monitoring');}catch{assertRouteAccess(auth.user,'route.location');}
    const url=new URL(request.url),lat=url.searchParams.get('lat'),lng=url.searchParams.get('lng');
    const result=await reverseGeocode(env.DB,env,lat,lng);
    return jsonResponse({ok:true,...result,attribution:'© OpenStreetMap contributors'});
  }catch(error){return jsonResponse({ok:false,erro:error.message||String(error),codigo:error.code||'REVERSE_GEOCODE_ERROR'},error.status||500);}
}
