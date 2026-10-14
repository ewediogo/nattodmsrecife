import { jsonResponse, requireUser } from '../_lib/auth.js';
import { assertRouteAccess } from '../_lib/route-access.js';
import { ensurePerformanceIndexes, performanceIndexDefinitions } from '../_lib/performance.js';

const CRITICAL_INDEXES=[
  'IDX_ROUTE_ESCALA_DATA','IDX_ROUTE_REG_DATE','IDX_ROUTE_DEPARTURE_DATE','IDX_ROUTE_MONITORING_DATE','IDX_ROUTE_RETURN_DATE',
  'IDX_ROUTE_MONITORING_STATUS_DATE_ID','IDX_ROUTE_MONITORING_DATE_ID','IDX_ROUTE_DEPARTURE_STATUS_DATE_ID','IDX_ROUTE_DEPARTURE_DATE_ID','IDX_ROUTE_RETURN_DATE_ID',
  'IDX_ROUTE_RESOURCE_EVENT_DATE_EFFECTIVE','IDX_ROUTE_GPS_RET_DATE_ACTIVE','IDX_ROUTE_GPS_OCC_DATE_TYPE','IDX_ROUTE_CAJU_MANUAL_DATE_EMPLOYEE',
];
const SCREEN_MAP=[
  {screen:'Visão Geral',endpoint:'/api/route-dashboard',weight:'alto'},
  {screen:'Resumo',endpoint:'/api/monitoring?view=summary',weight:'médio'},
  {screen:'Escala',endpoint:'/api/schedule',weight:'médio'},
  {screen:'Controle de Saída',endpoint:'/api/departures',weight:'médio'},
  {screen:'Indicadores de Saída',endpoint:'/api/departures?view=dashboard',weight:'alto'},
  {screen:'Monitoramento',endpoint:'/api/monitoring',weight:'médio'},
  {screen:'Última Localização',endpoint:'/api/protectsat',weight:'externo'},
  {screen:'Retornos',endpoint:'/api/returns?view=dashboard',weight:'alto'},
  {screen:'Indicadores',endpoint:'/api/indicators?view=dashboard',weight:'alto'},
  {screen:'Dados Gerenciais',endpoint:'/api/indicators?view=management',weight:'alto'},
  {screen:'Pendências Operacionais',endpoint:'/api/operational-pending',weight:'alto'},
];

async function explain(db,name,sql,binds=[]){
  try{
    const result=await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all();
    const details=(result.results||[]).map((row)=>String(row.detail||row.DETAIL||Object.values(row).at(-1)||'')).filter(Boolean);
    return {name,ok:true,indexed:details.some((detail)=>/USING (?:COVERING )?INDEX|USING INTEGER PRIMARY KEY/i.test(detail)),details};
  }catch(error){return {name,ok:false,indexed:false,error:error.message||String(error),details:[]};}
}

export async function onRequestGet({env,request}){
  if(!env.DB)return jsonResponse({ok:false,erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request);if(auth.response)return auth.response;
  try{
    assertRouteAccess(auth.user,'route.dashboard');
    const started=Date.now();
    const url=new URL(request.url);const repair=['1','true','yes','sim'].includes(String(url.searchParams.get('repair')||'').toLowerCase());
    let repairResult=null;if(repair){try{repairResult=await ensurePerformanceIndexes(env.DB,{force:true});}catch(error){repairResult={error:error?.message||String(error)};}}
    const pingStarted=Date.now();await env.DB.prepare('SELECT 1 AS ok').first();const pingMs=Date.now()-pingStarted;
    const schema=await env.DB.prepare("SELECT type,name,tbl_name FROM sqlite_master WHERE type IN ('table','index')").all();
    const objects=new Set((schema.results||[]).map((row)=>String(row.name||'')));
    const indexStatus=CRITICAL_INDEXES.map((name)=>({name,present:objects.has(name)}));
    const today=new Date().toISOString().slice(0,10);const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
    const plans=await Promise.all([
      explain(env.DB,'Escala legado por data','SELECT ID FROM ESCALAS_DIA WHERE DATA>=? AND DATA<? ORDER BY DATA LIMIT 100',[today,tomorrow]),
      explain(env.DB,'Escala nova por data',"SELECT ID FROM ROUTE_RECORDS WHERE MODULE='schedule' AND DATE_KEY>=? AND DATE_KEY<? ORDER BY DATE_KEY LIMIT 100",[today,tomorrow]),
      explain(env.DB,'Saídas por data','SELECT ID FROM ROUTE_DEPARTURES WHERE DATE_KEY>=? AND DATE_KEY<? ORDER BY DATE_KEY DESC,ID DESC LIMIT 100',[today,tomorrow]),
      explain(env.DB,'Monitoramento ativo','SELECT ID FROM ROUTE_MONITORING WHERE STATUS IN (\'EM ROTA\',\'PERNOITE\') AND DATE_KEY>=? ORDER BY ID DESC LIMIT 100',[today]),
      explain(env.DB,'Retornos por data','SELECT ID FROM ROUTE_RETURNS WHERE DATE_KEY>=? AND DATE_KEY<? ORDER BY DATE_KEY DESC,ID DESC LIMIT 100',[today,tomorrow]),
      explain(env.DB,'Eventos de recursos','SELECT ID FROM ROUTE_RESOURCE_EVENTS WHERE DATE_KEY>=? AND DATE_KEY<? ORDER BY EFFECTIVE_AT DESC LIMIT 100',[today,tomorrow]),
      explain(env.DB,'Retenções GPS','SELECT ID FROM ROUTE_GPS_RETENTIONS WHERE DATE_KEY=? AND ACTIVE=1 ORDER BY STARTED_AT DESC LIMIT 100',[today]),
      explain(env.DB,'CAJU manual','SELECT ID FROM ROUTE_CAJU_MANUAL WHERE DATE_KEY>=? AND DATE_KEY<? ORDER BY DATE_KEY,EMPLOYEE_ID LIMIT 100',[today,tomorrow]),
      explain(env.DB,'GPS posição compacta','SELECT PLATE,GPS_TIME FROM ROUTE_GPS_LATEST ORDER BY GPS_TIME DESC LIMIT 100',[]),
    ]);
    let lockStatus={active:0,expired:0,items:[]};
    try{
      const locks=await env.DB.prepare(`SELECT LOCK_KEY,EXPIRES_AT,UPDATED_AT FROM ROUTE_LOCKS WHERE OWNER IS NOT NULL ORDER BY UPDATED_AT DESC LIMIT 20`).all();
      const items=(locks.results||[]).map((row)=>({key:String(row.LOCK_KEY||''),expiresAt:String(row.EXPIRES_AT||''),updatedAt:String(row.UPDATED_AT||'')}));
      const now=Date.now();
      lockStatus={active:items.filter((item)=>{const ms=Date.parse(String(item.expiresAt||'').replace(' ','T')+'Z');return Number.isFinite(ms)&&ms>=now;}).length,expired:items.filter((item)=>{const ms=Date.parse(String(item.expiresAt||'').replace(' ','T')+'Z');return Number.isFinite(ms)&&ms<now;}).length,items};
    }catch{}
    const missingIndexes=indexStatus.filter((item)=>!item.present).map((item)=>item.name);
    const unindexedPlans=plans.filter((item)=>item.ok&&!item.indexed).map((item)=>item.name);
    return jsonResponse({
      ok:true,versao:'1',generatedAt:new Date().toISOString(),durationMs:Date.now()-started,d1PingMs:pingMs,
      status:missingIndexes.length||unindexedPlans.length||lockStatus.expired?'ATENÇÃO':'OK',repair,repairResult,missingIndexes,unindexedPlans,indexes:indexStatus,queryPlans:plans,locks:lockStatus,screens:SCREEN_MAP,performanceIndexDefinitions:performanceIndexDefinitions(),
      gpsAutomation:{facilityRadiusMeters:Number(env.DEPARTURE_GEOFENCE_RADIUS_METERS||120),maxGpsAgeMinutes:Number(env.DEPARTURE_GPS_MAX_AGE_MINUTES||20),outsideConfirmations:Number(env.DEPARTURE_GPS_OUTSIDE_CONFIRMATIONS||2),earlyWindowMinutes:Number(env.DEPARTURE_GPS_EARLY_WINDOW_MINUTES||60),lateWindowMinutes:Number(env.DEPARTURE_GPS_LATE_WINDOW_MINUTES||720),facilityNames:String(env.DEPARTURE_GEOFENCE_NAMES||'').split('|').filter(Boolean)},
      note:'Diagnóstico leve: não executa COUNT(*) nem varreduras completas. Use X-Natto-Request-Id e Server-Timing nas respostas para rastrear lentidão por endpoint.'
    });
  }catch(error){return jsonResponse({ok:false,erro:error.message||String(error),codigo:error.code||'DIAGNOSTIC_ERROR'},error.status||400);}
}
