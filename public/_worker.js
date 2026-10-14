import * as authLogin from './server/functions/api/auth/login.js';
import * as authLogout from './server/functions/api/auth/logout.js';
import * as authSetup from './server/functions/api/auth/setup.js';
import * as authStatus from './server/functions/api/auth/status.js';
import * as authChangePassword from './server/functions/api/auth/change-password.js';
import * as authUsers from './server/functions/api/auth/users.js';
import * as authProfile from './server/functions/api/auth/profile.js';
import * as bootstrap from './server/functions/api/bootstrap.js';
import * as catalogo from './server/functions/api/catalogo.js';
import * as colaboradores from './server/functions/api/colaboradores.js';
import * as health from './server/functions/api/health.js';
import * as protectsat from './server/functions/api/protectsat.js';
import * as lincros from './server/functions/api/lincros.js';
import * as resources from './server/functions/api/resources.js';
import * as clients from './server/functions/api/clients.js';
import * as reverseGeocode from './server/functions/api/reverse-geocode.js';
import * as schedule from './server/functions/api/schedule.js';
import * as departures from './server/functions/api/departures.js';
import * as monitoring from './server/functions/api/monitoring.js';
import * as returns from './server/functions/api/returns.js';
import * as indicators from './server/functions/api/indicators.js';
import * as operationalPending from './server/functions/api/operational-pending.js';
import * as routeDashboard from './server/functions/api/route-dashboard.js';
import * as routeSettings from './server/functions/api/route-settings.js';
import * as routePath from './server/functions/api/route-path.js';
import * as tripTimeline from './server/functions/api/trip-timeline.js';
import * as diagnostics from './server/functions/api/diagnostics.js';
import * as integrationDiagnostics from './server/functions/api/integration-diagnostics.js';
import * as appHealth from './server/functions/api/v1/app/health.js';
import * as appRoutesActive from './server/functions/api/v1/app/routes-active.js';
import * as appDeparture from './server/functions/api/v1/app/departure.js';
import * as appMonitoring from './server/functions/api/v1/app/monitoring.js';
import * as appReturn from './server/functions/api/v1/app/return.js';
import * as appTimeClock from './server/functions/api/v1/app/time-clock.js';

const VERSION='1.0.158';
const exactRoutes=new Map([
  ['/api/auth/login',authLogin],['/api/auth/logout',authLogout],['/api/auth/setup',authSetup],
  ['/api/auth/status',authStatus],['/api/auth/change-password',authChangePassword],['/api/auth/users',authUsers],['/api/auth/profile',authProfile],
  ['/api/bootstrap',bootstrap],['/api/catalogo',catalogo],['/api/colaboradores',colaboradores],['/api/health',health],
  ['/api/protectsat',protectsat],['/api/lincros',lincros],['/api/resources',resources],['/api/clients',clients],['/api/reverse-geocode',reverseGeocode],['/api/schedule',schedule],['/api/departures',departures],
  ['/api/monitoring',monitoring],['/api/returns',returns],['/api/indicators',indicators],
  ['/api/operational-pending',operationalPending],['/api/route-dashboard',routeDashboard],['/api/route-settings',routeSettings],['/api/route-path',routePath],
  ['/api/trip-timeline',tripTimeline],['/api/diagnostics',diagnostics],['/api/integration-diagnostics',integrationDiagnostics],
  ['/api/v1/app/health',appHealth],['/api/v1/app/routes/active',appRoutesActive],['/api/v1/app/departure',appDeparture],
  ['/api/v1/app/monitoring',appMonitoring],['/api/v1/app/return',appReturn],['/api/v1/app/time-clock',appTimeClock],
]);
const json=(body,status=200,extraHeaders={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=UTF-8','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','X-Natto-Dms-Version':VERSION,...extraHeaders}});
const normalizePath=(pathname)=>!pathname||pathname==='/'?'/':pathname.replace(/\/+$/,'');
const methodName=(method)=>`onRequest${String(method||'GET').toLowerCase().replace(/^./,(letter)=>letter.toUpperCase())}`;
function corsOrigin(request,env){const origin=String(request.headers.get('Origin')||'').trim();if(!origin)return '';const own=new URL(request.url).origin;const allowed=String(env?.CORS_ALLOWED_ORIGINS||'').split(',').map((x)=>x.trim()).filter(Boolean);if(origin===own||allowed.includes(origin))return origin;if(allowed.includes('*'))return '*';return '';}
function withCors(response,request,env){const origin=corsOrigin(request,env);if(!origin)return response;const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary',[headers.get('Vary'),'Origin'].filter(Boolean).join(', '));return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}
const allowedMethods=(module)=>Object.keys(module).filter((key)=>/^onRequest(?:Get|Post|Put|Patch|Delete|Options|Head)$/.test(key)).map((key)=>key.replace('onRequest','').toUpperCase());
async function runApi(routeModule,request,env,executionContext){const started=Date.now();const requestId=request.headers.get('X-Request-Id')||crypto.randomUUID();const allow=[...new Set([...allowedMethods(routeModule),'OPTIONS'])].join(', ');if(request.method==='OPTIONS')return withCors(new Response(null,{status:204,headers:{Allow:allow,'Access-Control-Allow-Methods':allow,'Access-Control-Allow-Headers':'Authorization, Content-Type, Accept, Idempotency-Key, X-Request-Id','Access-Control-Max-Age':'86400','X-Natto-Request-Id':requestId}}),request,env);const handler=routeModule[methodName(request.method)]||routeModule.onRequest;if(typeof handler!=='function')return withCors(json({erro:`Método ${request.method} não permitido nesta rota.`,codigo:'METHOD_NOT_ALLOWED',versao:VERSION},405,{Allow:allow,'X-Natto-Request-Id':requestId}),request,env);const context={request,env,params:{},data:{},waitUntil:(promise)=>executionContext.waitUntil(promise),passThroughOnException:()=>{},next:()=>env.ASSETS.fetch(request)};const raw=await handler(context);const response=raw instanceof Response?raw:json({erro:'A API retornou uma resposta inválida.',codigo:'INVALID_API_RESPONSE'},500);const headers=new Headers(response.headers);const duration=Date.now()-started;headers.set('X-Natto-Request-Id',requestId);headers.set('X-Natto-Api-Ms',String(duration));headers.append('Server-Timing',`app;dur=${duration}`);return withCors(new Response(response.body,{status:response.status,statusText:response.statusText,headers}),request,env);}
export default {
  async fetch(request,env,executionContext){const url=new URL(request.url),pathname=normalizePath(url.pathname);if(pathname==='/server'||pathname.startsWith('/server/'))return json({erro:'Recurso não encontrado.'},404);if(pathname.startsWith('/api/')){const route=exactRoutes.get(pathname);if(!route)return withCors(json({erro:'Rota de API não encontrada.',codigo:'API_NOT_FOUND',path:pathname,versao:VERSION},404),request,env);try{return await runApi(route,request,env,executionContext);}catch(error){console.error('DMS ROTA API error',pathname,error);return withCors(json({erro:error?.message||String(error),codigo:error?.code||'UNHANDLED_API_ERROR',versao:VERSION},error?.status||500),request,env);}}return env.ASSETS.fetch(request);}
};
