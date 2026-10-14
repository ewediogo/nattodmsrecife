/* Versão 1 - DMS ROTA · shell exclusivo da Rota */
const APP_NAME='Natto DMS - Recife';
const LOGO_URL='/assets/logo-natto.webp';
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const esc=(value)=>String(value??'').replace(/[&<>'"]/g,(char)=>({"&":'&amp;',"<":'&lt;',">":'&gt;',"'":'&#39;',"\"":'&quot;'}[char]));
const normalize=(value)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
const today=()=>{const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10);};
const formatDate=(value)=>{if(!value)return '—';const raw=String(value).slice(0,10);const [y,m,d]=raw.split('-');return y&&m&&d?`${d}/${m}/${y}`:String(value);};
const formatTime=(value)=>{if(!value)return '—';const s=String(value);const hit=s.match(/(?:T|\s)(\d{2}:\d{2})/)||s.match(/^(\d{2}:\d{2})/);return hit?hit[1]:s;};
const formatNumber=(value,digits=0)=>Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const formatMinutes=(minutes)=>{const total=Math.round(Number(minutes||0));const sign=total<0?'-':'';const abs=Math.abs(total);return `${sign}${Math.floor(abs/60)}h ${String(abs%60).padStart(2,'0')}min`;};
const metric=(label,value,detail,tone='info')=>`<article class="metric-card is-${esc(tone)}"><div class="metric-card-head"><div class="metric-label">${esc(label)}</div><span class="metric-status-dot" aria-hidden="true"></span></div><div class="metric-value">${esc(value)}</div><div class="metric-detail">${esc(detail)}</div></article>`;
const renderBars=(items=[])=>{const safe=Array.isArray(items)?items:[];const max=Math.max(...safe.map((x)=>Number(x.value||0)),1);return `<div class="chart-bars">${safe.map((item)=>`<div class="chart-row"><strong>${esc(item.label)}</strong><div class="chart-track"><span style="width:${Math.max(4,Number(item.value||0)/max*100)}%"></span></div><span>${item.display!==undefined?esc(item.display):formatNumber(item.value)}</span></div>`).join('')}</div>`;};
const renderVerticalBars=(items=[])=>{const safe=Array.isArray(items)?items:[];if(!safe.length)return '<div class="empty-state">Sem dados disponíveis.</div>';const max=Math.max(...safe.map((x)=>Number(x.value||0)),1);const shortLabel=(value)=>{const raw=String(value??'').trim();if(/^\d{2}\/\d{2}\/\d{4}$/.test(raw))return raw.slice(0,5);if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return `${raw.slice(8,10)}/${raw.slice(5,7)}`;return raw.length>10?`${raw.slice(0,10)}…`:raw;};return `<div class="chart-columns">${safe.map((item)=>{const num=Number(item.value||0);const height=Math.max(6,num/max*100);const label=String(item.label??'');const title=String(item.title||label||'');const display=item.display!==undefined?String(item.display):formatNumber(num,Number.isInteger(num)?0:1);return `<div class="chart-column" title="${esc(title)}"><span class="chart-column-value">${esc(display)}</span><div class="chart-column-track"><span style="height:${height}%"></span></div><span class="chart-column-label">${esc(shortLabel(label))}</span></div>`;}).join('')}</div>`;};
const BADGE_TONES=Object.freeze({
  'DISPONIVEL':'success','ATIVO':'success','FINALIZADO':'success','FINALIZADA':'success','CONFIRMADO':'success','CONFIRMADA':'success','APROVADO':'success','APROVADA':'success','SAIU':'success','RETORNOU':'success','LIBERADO':'success','CONCLUIDO':'success','CONCLUIDA':'success','PRINCIPAL':'success',
  'EM ROTA':'info','ESCALADO':'info','FOLGA AGENDADA':'warning','PROGRAMADO':'info','PROGRAMADA':'info','EM ANDAMENTO':'info','RETORNO PREVISTO':'info','EM RETORNO':'info','NO DESTINO':'info','DESCARREGADO':'info','CONSULTA':'info','ADMIN':'info','OPERADOR':'info',
  'PERNOITE':'warning','PENDENTE':'warning','ALERTA':'warning','MEDIO':'warning','MEDIA':'warning','RESERVADO':'warning','TREINAMENTO':'warning','FOLGA':'warning','ANOMALIA':'warning','SUBSTITUTO PREVISTO':'warning','PARCIAL':'warning',
  'INDISPONIVEL':'danger','MANUTENCAO':'danger','BLOQUEADO':'danger','INATIVO':'danger','DESLIGADO':'danger','AFASTADO':'danger','ATESTADO':'danger','FERIAS':'danger','INSS':'danger','CANCELADO':'danger','CANCELADA':'danger','ERRO':'danger','ATRASADO':'danger','ATRASADA':'danger','CRITICO':'danger','CRITICA':'danger','FORA DO PLANO':'danger'
});
const badge=(status='')=>{const n=normalize(status);const tone=BADGE_TONES[n]||'info';return `<span class="badge badge-${tone}">${esc(status||'—')}</span>`;};
const recordAuditLine=(record={})=>{const at=record.atualizado_em||record.ATUALIZADO_EM||record.raw?.ATUALIZADO_EM||'';if(!at)return '';const actor=record.atualizado_por||record.ATUALIZADO_POR||record.raw?.ATUALIZADO_POR||record.usuario||record.USUARIO||record.raw?.USUARIO||'Sistema';const automatic=/SISTEMA|GPS|PROTECT|IMPORT|AUTOMATIC/.test(normalize(actor));const label=automatic?'ÚLTIMA ATUALIZAÇÃO':'ÚLTIMA EDIÇÃO MANUAL';return `<small class="record-audit-line"><strong>${label}:</strong> ${esc(actor)} · ${esc(formatDate(at))} ${esc(formatTime(at))}</small>`;};
const tripTimelineHtml=(events=[],{compact=false}={})=>{const rows=Array.isArray(events)?events:[];if(!rows.length)return `<div class="trip-timeline-empty">Sem eventos GPS registrados nesta viagem.</div>`;return `<div class="trip-timeline ${compact?'is-compact':''}">${rows.map((event)=>{const type=normalize(event.type||'EVENTO'),icon=type==='SAIDA'?'↗':type==='RETORNO'?'↩':'●';const left=event.leftAt?`<small>Saída do cliente ${esc(formatTime(event.leftAt))}</small>`:'';return `<div class="trip-timeline-item is-${esc(type.toLowerCase())}"><span class="trip-timeline-dot">${icon}</span><div><strong>${esc(event.label||type)}</strong><span>${esc(formatDate(event.at))} · ${esc(formatTime(event.at))}${event.automatic?' · GPS':''}</span>${left}</div></div>`;}).join('')}</div>`;};

const state={
  token:sessionStorage.getItem('natto_dms_rota_token')||'',
  user:null,currentBase:'route',route:'route_summary',catalog:new Map(),routeGpsTimer:null,departureTimer:null,pendingTimer:null,gpsBackgroundTimer:null,operationalNotificationTimer:null,apiLastGood:new Map(),apiInflight:new Map(),lastTransientNotice:0,
  navigationSeq:0,navigationAbortController:null,routeMonitoringGpsRefreshAt:0,heavyReadActive:0,
  routeDashboardStart:null,routeDashboardEnd:null,
};

function setTheme(theme){
  const value=theme==='dark'?'dark':'light';document.documentElement.dataset.theme=value;localStorage.setItem('natto_dms_rota_theme',value);
  $$('[data-theme-toggle]').forEach((button)=>{const label=$('.theme-label',button);if(label)label.textContent=value==='dark'?'Modo escuro':'Modo claro';button.title=value==='dark'?'Ativar modo claro':'Ativar modo escuro';});
}
function showLoading(title='Carregando',detail='Processando dados...'){if($('#loading-title'))$('#loading-title').textContent=title;if($('#loading-detail'))$('#loading-detail').textContent=detail;$('#global-loading')?.classList.remove('is-hidden');}
function hideLoading(){$('#global-loading')?.classList.add('is-hidden');}
const recentToasts=new Map();
function toast(message,type='success'){
  const key=`${type}|${String(message||'')}`;const now=Date.now();const previous=recentToasts.get(key)||0;
  if(now-previous<3500)return;recentToasts.set(key,now);
  const node=document.createElement('div');node.className=`toast toast-${type==='error'?'danger':type}`;node.textContent=message;$('#toast-region')?.appendChild(node);setTimeout(()=>{node.remove();if(recentToasts.get(key)===now)recentToasts.delete(key);},4500);
}
function setConnection(ok,text=ok?'Online':'Offline'){const node=$('#connection-status');if(!node)return;node.classList.toggle('is-error',!ok);node.classList.toggle('is-online',ok);const label=$('span',node);if(label)label.textContent=text;}
function clearSession(){state.token='';state.user=null;sessionStorage.removeItem('natto_dms_rota_token');}

const wait=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
const transientHttp=(status)=>[429,502,503,504].includes(Number(status));
function apiCacheKey(path,method){return `${String(method||'GET').toUpperCase()} ${path}`;}
const API_SESSION_PREFIX='natto_dms_api_cache_v2_';
function apiCacheHash(value){let h=2166136261;for(const ch of String(value||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
function apiSessionKey(cacheKey){return `${API_SESSION_PREFIX}${apiCacheHash(cacheKey)}`;}
function readApiSessionCache(cacheKey,maxAgeMs=60*60*1000){try{const hit=JSON.parse(sessionStorage.getItem(apiSessionKey(cacheKey))||'null');if(hit?.key===cacheKey&&hit?.payload&&Date.now()-Number(hit.at||0)<=maxAgeMs)return hit;}catch{}return null;}
function writeApiSessionCache(cacheKey,payload){try{const raw=JSON.stringify({key:cacheKey,at:Date.now(),payload});if(raw.length>700000)return;sessionStorage.setItem(apiSessionKey(cacheKey),raw);const keys=[];for(let i=0;i<sessionStorage.length;i+=1){const key=sessionStorage.key(i);if(key?.startsWith(API_SESSION_PREFIX))keys.push(key);}if(keys.length>8){keys.sort((a,b)=>{try{return Number(JSON.parse(sessionStorage.getItem(a)||'{}').at||0)-Number(JSON.parse(sessionStorage.getItem(b)||'{}').at||0);}catch{return 0;}});keys.slice(0,keys.length-8).forEach((key)=>sessionStorage.removeItem(key));}}catch{}}
function recordApiDiagnostic(path,method,startedAt,outcome,detail=''){try{const key='natto_dms_api_diagnostics_v1';const rows=JSON.parse(sessionStorage.getItem(key)||'[]');rows.push({at:new Date().toISOString(),path:String(path||''),method:String(method||''),ms:Math.max(0,Date.now()-startedAt),outcome:String(outcome||''),detail:String(detail||'').slice(0,240)});sessionStorage.setItem(key,JSON.stringify(rows.slice(-80)));}catch{}}
async function fetchAttempt(path,options,headers,timeoutMs=18000){
  const controller=new AbortController();
  const externalSignal=options.signal;
  let abortedByExternal=false;
  const abortFromExternal=()=>{abortedByExternal=true;controller.abort();};
  if(externalSignal){if(externalSignal.aborted)abortFromExternal();else externalSignal.addEventListener('abort',abortFromExternal,{once:true});}
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(path,{cache:'no-store',...options,headers,signal:controller.signal});}
  catch(error){if(controller.signal.aborted&&!abortedByExternal){const timeoutError=new Error('A solicitação demorou além do esperado.');timeoutError.code='REQUEST_TIMEOUT';throw timeoutError;}throw error;}
  finally{clearTimeout(timer);if(externalSignal)externalSignal.removeEventListener?.('abort',abortFromExternal);}
}
async function api(path,options={}){
  // Copia as opções e remove os parâmetros internos antes de repassá-las ao fetch.
  // Evita depender de uma variável local `navScoped`, que em builds anteriores
  // podia ficar inconsistente entre o HTML em cache e o JavaScript publicado.
  const rawOptions=options||{};
  const connectionImpact=rawOptions.connectionImpact!==false;
  const fresh=rawOptions.fresh===true;
  const quietTransient=rawOptions.quietTransient===true;
  const timeoutMs=Number(rawOptions.timeoutMs||0);
  const maxAttempts=Number(rawOptions.maxAttempts||0);
  const onRetry=typeof rawOptions.onRetry==='function'?rawOptions.onRetry:null;
  const navigationScoped=rawOptions.navigationScoped!==false&&rawOptions.navScoped!==false;
  const requestOptions={...rawOptions};
  delete requestOptions.connectionImpact;
  delete requestOptions.fresh;
  delete requestOptions.quietTransient;
  delete requestOptions.timeoutMs;
  delete requestOptions.maxAttempts;
  delete requestOptions.onRetry;
  delete requestOptions.navigationScoped;
  delete requestOptions.navScoped;
  const method=String(requestOptions.method||'GET').toUpperCase();
  const isRead=method==='GET'||method==='HEAD';
  const isWrite=['POST','PUT','PATCH','DELETE'].includes(method);
  let idempotencyRequestId='';
  if(isWrite&&typeof requestOptions.body==='string'){
    try{const parsed=JSON.parse(requestOptions.body);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))idempotencyRequestId=String(parsed.requestId||'').trim();}catch{}
  }
  // PUT representa substituição/atualização idempotente por contrato HTTP.
  // Assim, as telas de edição também se recuperam de um 503 transitório mesmo
  // quando um formulário legado ainda não envia requestId. POST/PATCH/DELETE só
  // são repetidos quando fornecem a chave explícita de idempotência.
  const isIdempotentWrite=Boolean(isWrite&&(idempotencyRequestId||method==='PUT'));
  const isGpsRead=isRead&&String(path||'').startsWith('/api/protectsat');
  const requestPath=String(path||'');const heavyRead=isRead&&(['/api/route-dashboard','/api/indicators','/api/resources','/api/operational-pending','/api/returns'].some((prefix)=>requestPath.startsWith(prefix))||requestPath.startsWith('/api/departures?view=dashboard')||requestPath.startsWith('/api/monitoring?view=summary'));
  if(isRead&&navigationScoped&&!requestOptions.signal&&state.navigationAbortController)requestOptions.signal=state.navigationAbortController.signal;
  const isForm=requestOptions.body instanceof FormData;
  const headers={Accept:'application/json',...(requestOptions.headers||{})};
  if(!isForm&&method!=='GET'&&method!=='HEAD')headers['Content-Type']='application/json';
  // Login/setup criam uma nova sessão e não devem carregar um token antigo/expirado.
  // O status continua recebendo o Bearer para restaurar uma sessão válida ao abrir o sistema.
  const isCredentialEndpoint=/^\/api\/auth\/(?:login|setup)(?:[/?]|$)/.test(requestPath);
  if(state.token&&!isCredentialEndpoint)headers.Authorization=`Bearer ${state.token}`;
  const cacheKey=apiCacheKey(path,method);
  if(isRead&&!fresh){const cached=state.apiLastGood.get(cacheKey);if(cached&&Date.now()-cached.at<=20000)return cached.payload;}
  if(isRead&&state.apiInflight.has(cacheKey))return state.apiInflight.get(cacheKey);

  const execute=async()=>{
    // A ProtectSat é uma API externa e em alguns momentos leva mais de 10 s para
    // responder. Não abortamos a leitura do GPS cedo demais nem repetimos três
    // consultas externas em sequência; as demais APIs mantêm o retry curto.
    // Em endpoints pesados, repetir o mesmo GET após um 503 aumenta a pressão no D1
    // e pode prolongar a indisponibilidade. Fazemos uma tentativa e usamos o último
    // dado válido; leituras leves mantêm uma única repetição curta.
    const attempts=isIdempotentWrite?3:(maxAttempts>0?Math.max(1,Math.min(3,Math.floor(maxAttempts))):(isRead?((isGpsRead||heavyRead)?1:2):1));
    const retryBackoff=isIdempotentWrite?[500,1500]:[300,750];
    const startedAt=Date.now();
    let lastError=null;
    const retryWait=async(error,attempt)=>{
      const delay=retryBackoff[attempt]||retryBackoff[retryBackoff.length-1]||750;
      if(isIdempotentWrite&&onRetry){try{onRetry({attempt:attempt+2,total:attempts,error,method,path,requestId:idempotencyRequestId,delay});}catch{}}
      await wait(delay);
    };
    for(let attempt=0;attempt<attempts;attempt+=1){
      let response;
      try{
        const effectiveTimeout=timeoutMs>0?timeoutMs:(isGpsRead?35000:(heavyRead?25000:(isRead?12000:22000)));
        response=await fetchAttempt(path,requestOptions,headers,effectiveTimeout);
        if(response.status===401&&!isCredentialEndpoint){clearSession();showAuth();throw new Error('Sua sessão expirou. Entre novamente.');}
        // Em /auth/login, HTTP 401 significa credencial recusada, não sessão expirada.
        // Deixamos o corpo JSON ser lido abaixo para exibir a mensagem real do backend.
        if(response.status===401&&isCredentialEndpoint)clearSession();
        if(transientHttp(response.status)&&(isRead||isIdempotentWrite)&&attempt<attempts-1){
          lastError=new Error(`Falha temporária HTTP ${response.status}`);lastError.code=`HTTP_${response.status}`;
          await retryWait(lastError,attempt);continue;
        }
        const type=response.headers.get('content-type')||'';
        const payload=type.includes('application/json')?await response.json().catch(()=>({})):{};
        if(!response.ok||payload.erro||payload.erros){
          const error=new Error((payload.erros||[payload.erro||`Falha HTTP ${response.status}`]).join('\n'));
          error.code=payload.codigo||`HTTP_${response.status}`;error.details=payload.detalhes||null;error.status=response.status;
          if(transientHttp(response.status)&&(isRead||isIdempotentWrite)&&attempt<attempts-1){lastError=error;await retryWait(error,attempt);continue;}
          throw error;
        }
        if(connectionImpact)setConnection(true,'Online');
        if(isRead){state.apiLastGood.set(cacheKey,{payload,at:Date.now()});if(!isGpsRead)writeApiSessionCache(cacheKey,payload);}
        else {state.apiLastGood.clear();state.catalog.clear();}
        const serverMs=response.headers.get('X-Natto-Api-Ms')||'';const requestId=response.headers.get('X-Natto-Request-Id')||'';recordApiDiagnostic(path,method,startedAt,'OK',`${response.status}${serverMs?` · server ${serverMs}ms`:''}${requestId?` · ${requestId}`:''}`);
        return payload;
      }catch(error){
        if(error?.name==='AbortError')throw error;
        lastError=error;
        const retryable=(isRead||isIdempotentWrite)&&(error?.code==='REQUEST_TIMEOUT'||error?.name==='TypeError'||/^HTTP_(429|502|503|504)$/.test(String(error?.code||'')));
        if(retryable&&attempt<attempts-1){await retryWait(error,attempt);continue;}
      }
    }
    if(isRead){
      const cached=state.apiLastGood.get(cacheKey);
      if(cached&&Date.now()-cached.at<=15*60*1000){
        if(connectionImpact)setConnection(false,'Instável · cache');
        if(!quietTransient&&Date.now()-state.lastTransientNotice>15000){toast('Conexão instável. Mantive os últimos dados carregados e vou tentar novamente automaticamente.','warning');state.lastTransientNotice=Date.now();}
        recordApiDiagnostic(path,method,startedAt,'CACHE_MEM',lastError?.code||lastError?.message||'');
        return cached.payload;
      }
      if(!isGpsRead){const persisted=readApiSessionCache(cacheKey,60*60*1000);if(persisted){state.apiLastGood.set(cacheKey,{payload:persisted.payload,at:Number(persisted.at||Date.now())});if(connectionImpact)setConnection(false,'Instável · último dado');if(!quietTransient&&Date.now()-state.lastTransientNotice>15000){toast('Servidor instável. Mantive o último dado válido desta aba.','warning');state.lastTransientNotice=Date.now();}recordApiDiagnostic(path,method,startedAt,'CACHE_SESSION',lastError?.code||lastError?.message||'');return persisted.payload;}}
    }
    if(connectionImpact)setConnection(false,'Instável');
    recordApiDiagnostic(path,method,startedAt,'ERROR',lastError?.code||lastError?.message||'');
    const code=String(lastError?.code||'');
    if(code==='HTTP_503'||/503/.test(String(lastError?.message||''))){
      // v1.0.12: não apaga a mensagem devolvida pelo backend. Quando existir uma
      // causa específica (D1, validação, lock etc.), ela precisa chegar até a linha
      // da Escala. Só cria a mensagem genérica quando o 503 veio sem corpo útil.
      const message=String(lastError?.message||'').trim();
      if(message && !/^Falha HTTP 503$/i.test(message) && !/^HTTP 503$/i.test(message)) throw lastError;
      const error=new Error('Falha HTTP 503: o servidor/Cloudflare não conseguiu concluir a solicitação.');
      error.code='SERVICE_TEMPORARILY_UNAVAILABLE';error.status=503;throw error;
    }
    throw lastError||new Error('Falha ao acessar o servidor.');
  };

  if(heavyRead)state.heavyReadActive=Math.max(0,Number(state.heavyReadActive||0))+1;
  const promise=execute().finally(()=>{if(isRead)state.apiInflight.delete(cacheKey);if(heavyRead)state.heavyReadActive=Math.max(0,Number(state.heavyReadActive||0)-1);});
  if(isRead)state.apiInflight.set(cacheKey,promise);
  return promise;
}

function modal({title,body,confirmText='Salvar',onOpen=null,onConfirm=async()=>{},wide=false}){
  const host=$('#modal-root');
  host.innerHTML=`<div class="modal-backdrop"><div class="modal${wide?' modal-wide':''}" role="dialog" aria-modal="true"><div class="modal-header"><h3>${esc(title)}</h3><button class="icon-button" data-close type="button">×</button></div><div class="modal-body">${body}</div><div class="modal-footer"><button class="btn btn-ghost" data-close type="button">Cancelar</button><button class="btn btn-primary" data-confirm type="button">${esc(confirmText)}</button></div></div></div>`;
  const root=$('.modal',host);const backdrop=root?.parentElement;
  const close=()=>{
    if(!root?.isConnected||!host.contains(root))return;
    root.classList.add('is-closing');backdrop?.classList.add('is-closing');
    const finish=()=>{if(root?.isConnected&&host.contains(root))host.innerHTML='';};
    root.addEventListener('animationend',finish,{once:true});
    setTimeout(finish,180);
  };
  $$('[data-close]',backdrop).forEach((button)=>button.onclick=close);
  if(typeof onOpen==='function')onOpen(root);
  $('[data-confirm]',root).onclick=async()=>{
    const button=$('[data-confirm]',root);button.disabled=true;
    try{
      await onConfirm(root);
      // Se onConfirm abriu outro modal (ex.: prévia de importação), não o apague.
      if(root.isConnected&&host.contains(root))close();
    }catch(error){
      if(button.isConnected)button.disabled=false;
      const code=String(error?.code||'');
      const transient=code==='SERVICE_TEMPORARILY_UNAVAILABLE'||code==='REQUEST_TIMEOUT'||/^HTTP_(429|502|503|504)$/.test(code)||error?.name==='TypeError';
      if(state.route==='route_schedule'&&transient){
        toast('Esta operação não foi confirmada. Corrija/tente novamente apenas a linha afetada.','warning');
        return;
      }
      toast(error.message||String(error),'error');
    }
  };
  return root;
}
function exportCsv(rows,filename='relatorio.csv'){
  if(!Array.isArray(rows)||!rows.length){toast('Não há dados para exportar.','warning');return;}
  const keys=[...new Set(rows.flatMap((row)=>Object.keys(row||{})))];const quote=(v)=>`"${String(v??'').replaceAll('"','""')}"`;const csv='\ufeff'+[keys.map(quote).join(';'),...rows.map((row)=>keys.map((key)=>quote(typeof row[key]==='object'?JSON.stringify(row[key]):row[key])).join(';'))].join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}
async function loadCatalog(type,force=false){const key=String(type);if(!force&&state.catalog.has(key))return state.catalog.get(key);const endpoint=type==='employees'||type==='collaborators'?'/api/colaboradores':`/api/catalogo?type=${encodeURIComponent(type)}`;const payload=await api(endpoint);const records=payload.records||payload.colaboradores||[];state.catalog.set(key,records);return records;}
function hasRouteAccess(){return Boolean(state.user&&(normalize(state.user.role)==='ADMIN'||(state.user.bases||[]).includes('route')));}

const NAV=[
  {group:'OPERAÇÃO',items:[
    ['route_summary','Resumo','gauge'],['route_schedule','Escala','calendar-range'],['route_departures','Controle de Saída','log-out'],['route_departure_indicators','Indicadores de Saída','chart-no-axes-combined'],['route_monitoring','Monitoramento','radar'],['route_location','Última Localização','map-pinned'],['route_clients','Consultar Clientes','map-pin'],['route_returns','Retornos','undo-2'],
  ]},
  {group:'GESTÃO',items:[['route_indicators','Indicadores','chart-column'],['route_management','Dados Gerenciais','chart-line'],['route_pending','Pendências Operacionais','triangle-alert']]},
  {group:'CADASTROS',items:[['route_vehicles','Veículos','truck'],['route_drivers','Motoristas','contact-round'],['route_helpers','Ajudantes','users'],['route_routes','Rotas','route']]},
  {group:'ADMINISTRAÇÃO',adminOnly:true,items:[['route_users','Usuários','user-cog'],['route_settings','Parâmetros','settings']]},
];
const TITLES={route_dashboard:'Visão Geral',route_summary:'Resumo',route_schedule:'Escala',route_departures:'Controle de Saída',route_departure_indicators:'Indicadores de Saída',route_monitoring:'Monitoramento',route_location:'Última Localização',route_clients:'Consultar Clientes',route_returns:'Retornos',route_indicators:'Indicadores',route_management:'Dados Gerenciais',route_pending:'Pendências Operacionais',route_vehicles:'Veículos',route_drivers:'Motoristas',route_helpers:'Ajudantes',route_routes:'Rotas',route_users:'Usuários',route_settings:'Parâmetros',route_profile:'Meu perfil'};

function refreshIcons(){try{window.lucide?.createIcons?.({attrs:{'stroke-width':1.8}});}catch{}}
function navCollapsedGroups(){try{return JSON.parse(localStorage.getItem('natto_nav_collapsed')||'[]');}catch{return [];}}
function renderNavigation(){
  const admin=normalize(state.user?.role)==='ADMIN',collapsed=navCollapsedGroups();
  $('#main-navigation').innerHTML=NAV.filter((group)=>!group.adminOnly||admin).map((group)=>{const hasActive=group.items.some(([route])=>route===state.route),closed=collapsed.includes(group.group)&&!hasActive;return `<div class="nav-group ${closed?'is-closed':''}"><button class="nav-group-title" type="button" data-nav-group="${esc(group.group)}" aria-expanded="${closed?'false':'true'}"><span>${group.group}</span><i class="nav-group-caret" aria-hidden="true"></i></button><div class="nav-group-items">${group.items.map(([route,label,icon])=>`<button class="nav-item ${state.route===route?'is-active':''}" data-route="${route}" type="button" title="${esc(label)}"><span class="nav-icon" aria-hidden="true"><i data-lucide="${icon}"></i></span><span class="nav-label">${label}</span></button>`).join('')}</div></div>`;}).join('');
  $$('[data-route]').forEach((button)=>button.onclick=()=>navigate(button.dataset.route));
  $$('[data-nav-group]').forEach((button)=>button.onclick=()=>{const name=button.dataset.navGroup,list=navCollapsedGroups(),next=list.includes(name)?list.filter((x)=>x!==name):[...list,name];try{localStorage.setItem('natto_nav_collapsed',JSON.stringify(next));}catch{}button.closest('.nav-group').classList.toggle('is-closed',next.includes(name));button.setAttribute('aria-expanded',String(!next.includes(name)));});
  refreshIcons();
}
function stopBackgroundGpsSync(){clearInterval(state.gpsBackgroundTimer);state.gpsBackgroundTimer=null;}
async function backgroundGpsSync(){
  if(!state.token||!state.user||document.visibilityState==='hidden'||Number(state.heavyReadActive||0)>0)return;
  try{
    // Camada extra de atualização enquanto o DMS está aberto. O Worker separado
    // executa o mesmo sync 24/7 a cada minuto; este heartbeat permanece para manter
    // a tela atualizada em tempo real quando há usuário conectado.
    await api('/api/protectsat?scope=route&view=latest&refresh=1',{fresh:true,connectionImpact:false,navigationScoped:false});
  }catch(error){console.warn('GPS background sync temporariamente indisponível',error?.message||error);}
}
function startBackgroundGpsSync(){
  stopBackgroundGpsSync();
  state.gpsBackgroundTimer=setInterval(backgroundGpsSync,5*60*1000);
  setTimeout(()=>{if(state.token&&state.user)backgroundGpsSync();},5000);
}

const OPERATIONAL_NOTIFICATION_ENABLED_KEY='natto_dms_operational_notifications_enabled_v2';
const OPERATIONAL_NOTIFICATION_SEEN_KEY='natto_dms_operational_notifications_seen_v2';
const OPERATIONAL_NOTIFICATION_SW='/sw.js';
let operationalNotificationRegistrationPromise=null;
function operationalNotificationsEnabled(){return localStorage.getItem(OPERATIONAL_NOTIFICATION_ENABLED_KEY)==='1'&&'Notification' in window&&Notification.permission==='granted';}
function operationalNotificationSeen(){try{return new Set(JSON.parse(localStorage.getItem(OPERATIONAL_NOTIFICATION_SEEN_KEY)||'[]').map(String));}catch{return new Set();}}
function saveOperationalNotificationSeen(seen){try{localStorage.setItem(OPERATIONAL_NOTIFICATION_SEEN_KEY,JSON.stringify([...seen].slice(-1200)));}catch{}}
function dateDaysAgo(days=1){const d=new Date();d.setDate(d.getDate()-Number(days||0));d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10);}
function stopOperationalNotificationPolling(){clearInterval(state.operationalNotificationTimer);state.operationalNotificationTimer=null;}
async function ensureOperationalNotificationServiceWorker(){
  if(!('serviceWorker' in navigator))return null;
  if(!operationalNotificationRegistrationPromise){
    operationalNotificationRegistrationPromise=(async()=>{
      try{
        const registration=await navigator.serviceWorker.register(OPERATIONAL_NOTIFICATION_SW,{scope:'/'});
        await navigator.serviceWorker.ready;
        return registration;
      }catch(error){
        operationalNotificationRegistrationPromise=null;
        console.warn('Service Worker de alertas indisponível',error?.message||error);
        return null;
      }
    })();
  }
  return operationalNotificationRegistrationPromise;
}
async function showOperationalSystemNotification(title,options={}){
  if(!('Notification' in window)||Notification.permission!=='granted')return false;
  const notificationOptions={
    ...options,
    tag:options.tag||`dms-occ-${Date.now()}`,
    renotify:options.renotify!==false,
    requireInteraction:options.requireInteraction!==false,
    icon:options.icon||'/assets/favicon-natto.png',
    badge:options.badge||'/assets/favicon-natto.png',
    data:{route:'route_pending',...(options.data||{})},
  };
  const registration=await ensureOperationalNotificationServiceWorker();
  if(registration?.showNotification){
    try{await registration.showNotification(title,notificationOptions);return true;}catch(error){console.warn('Falha no alerta via Service Worker',error?.message||error);}
  }
  try{
    const notification=new Notification(title,notificationOptions);
    notification.onclick=()=>{window.focus();notification.close();navigate('route_pending');};
    return true;
  }catch(error){console.warn('Notificação nativa indisponível',error?.message||error);return false;}
}
async function testOperationalNotifications(){
  if(!operationalNotificationsEnabled()){toast('Ative os alertas primeiro neste computador.','warning');return false;}
  const shown=await showOperationalSystemNotification('DMS Rota · Teste de alerta',{body:'Se esta mensagem apareceu no Windows, as notificações do DMS estão funcionando neste computador.',tag:`dms-occ-test-${Date.now()}`,requireInteraction:true,data:{test:true}});
  if(shown)toast('Alerta de teste enviado ao Windows. Se não aparecer, confira as notificações do navegador e o Não Perturbe do Windows.','success');
  else toast('O navegador autorizou notificações, mas não conseguiu exibir o alerta do sistema. Revise a permissão do site no Windows/navegador.','warning');
  return shown;
}
async function pollOperationalNotifications({baseline=false}={}){
  if(!state.token||!state.user||!operationalNotificationsEnabled())return;
  try{
    // Busca três dias para cobrir ocorrências que cruzam a meia-noite/pernoite.
    const payload=await api(`/api/operational-pending?start=${encodeURIComponent(dateDaysAgo(3))}&end=${encodeURIComponent(today())}`,{fresh:true,connectionImpact:false,navigationScoped:false,timeoutMs:18000,maxAttempts:1});
    const records=Array.isArray(payload.records)?payload.records:[],seen=operationalNotificationSeen();
    if(baseline||!localStorage.getItem(OPERATIONAL_NOTIFICATION_SEEN_KEY)){records.forEach((row)=>seen.add(String(row.key||row.id||'')));saveOperationalNotificationSeen(seen);return;}
    const fresh=records.filter((row)=>{const key=String(row.key||row.id||'');return key&&!seen.has(key);});
    let displayed=0;
    for(const row of fresh.slice(0,8)){
      const key=String(row.key||row.id||'');
      const title=`Nova ocorrência · ${row.rota||row.placa||'Monitoramento'}`;
      const threshold=row.related?.stopThresholdMinutes?` · limiar ${row.related.stopThresholdMinutes} min`:'';
      const body=`${row.tipo||'Ocorrência operacional'}${threshold}\nPlaca: ${row.placa||'—'} · Motorista: ${row.motorista||'—'}\nResponsável padrão: ${row.monitorResponsavel||row.responsavel||'Monitoramento'}`;
      const shown=await showOperationalSystemNotification(title,{body,tag:`dms-occ-${key}`,requireInteraction:true,data:{occurrenceKey:key}});
      if(shown){seen.add(key);displayed+=1;}
    }
    if(displayed){saveOperationalNotificationSeen(seen);toast(`${displayed} nova(s) ocorrência(s) operacional(is).`,'warning');}
  }catch(error){console.warn('Polling de notificações operacionais indisponível',error?.message||error);}
}
function startOperationalNotificationPolling(){
  stopOperationalNotificationPolling();
  if(!operationalNotificationsEnabled())return;
  void ensureOperationalNotificationServiceWorker();
  state.operationalNotificationTimer=setInterval(()=>pollOperationalNotifications(),30000);
  setTimeout(()=>pollOperationalNotifications(),2500);
}
async function enableOperationalNotifications(){
  if(!('Notification' in window)){toast('Este navegador não oferece notificações nativas do Windows.','warning');return false;}
  if(!window.isSecureContext){toast('Os alertas do Windows exigem acesso HTTPS ao DMS.','warning');return false;}
  let permission=Notification.permission;
  if(permission!=='granted')permission=await Notification.requestPermission();
  if(permission!=='granted'){localStorage.removeItem(OPERATIONAL_NOTIFICATION_ENABLED_KEY);toast('Permissão de notificações não concedida. Libere as notificações para este site no navegador.','warning');return false;}
  await ensureOperationalNotificationServiceWorker();
  localStorage.setItem(OPERATIONAL_NOTIFICATION_ENABLED_KEY,'1');
  localStorage.removeItem(OPERATIONAL_NOTIFICATION_SEEN_KEY);
  await pollOperationalNotifications({baseline:true});
  startOperationalNotificationPolling();
  const shown=await showOperationalSystemNotification('DMS Rota · Alertas ativados',{body:'Teste concluído. Novas ocorrências serão notificadas neste computador enquanto o DMS estiver aberto.',tag:`dms-occ-enabled-${Date.now()}`,requireInteraction:true,data:{test:true}});
  if(!shown){localStorage.removeItem(OPERATIONAL_NOTIFICATION_ENABLED_KEY);stopOperationalNotificationPolling();toast('Não foi possível exibir a notificação de teste. Verifique as permissões do navegador/Windows e tente novamente.','warning');return false;}
  toast('Alertas de ocorrências ativados e testados neste computador.');
  return true;
}
// Service Worker permite que o alerta use a central nativa do Windows de forma mais confiável.
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message',(event)=>{if(event?.data?.type==='DMS_OPEN_ROUTE'&&state.token){window.focus();navigate(event.data.route||'route_pending');}});
}
// Exposto ao módulo Rota para que Monitoramento e Pendências usem o mesmo canal de alerta.
window.enableOperationalNotifications=enableOperationalNotifications;
window.testOperationalNotifications=testOperationalNotifications;
window.operationalNotificationsEnabled=operationalNotificationsEnabled;
function showAuth(){state.navigationAbortController?.abort();state.navigationAbortController=null;clearInterval(state.routeGpsTimer);clearInterval(state.departureTimer);clearInterval(state.pendingTimer);stopBackgroundGpsSync();stopOperationalNotificationPolling();$('#system-view')?.classList.add('is-hidden');$('#auth-view')?.classList.remove('is-hidden');}
function showSystem(){
  if(!hasRouteAccess()){showAuth();$('#auth-message').textContent='Você não tem acesso a este módulo.';return;}
  $('#auth-view').classList.add('is-hidden');$('#system-view').classList.remove('is-hidden');
  $('#sidebar-user-name').textContent=state.user.name||'Usuário';$('#sidebar-user-profile').textContent=state.user.role||'Perfil';$('#sidebar-avatar').textContent=(state.user.name||'U').trim().charAt(0).toUpperCase();renderNavigation();startBackgroundGpsSync();startOperationalNotificationPolling();loadMyProfile();
}

// ===== Meu perfil =====
const PROFILE_DAYS=[['SEG','Seg'],['TER','Ter'],['QUA','Qua'],['QUI','Qui'],['SEX','Sex'],['SAB','Sáb'],['DOM','Dom']];
function applyProfileToSidebar(){
  const profile=state.profile||{};const avatar=profile.profile?.avatar||'';const node=$('#sidebar-avatar');
  if(profile.user?.name&&state.user)state.user.name=profile.user.name;
  if(profile.user?.cargo!==undefined&&state.user)state.user.cargo=profile.user.cargo;
  if($('#sidebar-user-name'))$('#sidebar-user-name').textContent=state.user?.name||'Usuário';
  if(!node)return;
  const initial=(state.user?.name||'U').trim().charAt(0).toUpperCase();
  if(avatar){node.style.backgroundImage=`url("${avatar}")`;node.style.backgroundSize='cover';node.style.backgroundPosition='center';node.textContent='';node.classList.add('has-photo');}
  else{node.style.backgroundImage='';node.textContent=initial;node.classList.remove('has-photo');}
}
async function loadMyProfile(){
  try{state.profile=await api('/api/auth/profile',{connectionImpact:false,navigationScoped:false});applyProfileToSidebar();}catch{}
}
function loadProfileImage(source){
  return new Promise((resolve,reject)=>{
    const image=new Image();let objectUrl='';
    image.onload=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);resolve(image);};
    image.onerror=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);reject(new Error('Não foi possível ler esta imagem. Use JPEG, PNG ou WebP.'));};
    if(typeof source==='string')image.src=source;
    else{
      if(!source||!/^image\//.test(source.type))return reject(new Error('Selecione um arquivo de imagem (JPEG, PNG ou WebP).'));
      if(source.size>12*1024*1024)return reject(new Error('Imagem muito grande. Use um arquivo de até 12 MB.'));
      objectUrl=URL.createObjectURL(source);image.src=objectUrl;
    }
  });
}
// Enquadramento da foto: arrastar para posicionar, zoom por controle ou roda do mouse.
// O resultado é sempre o recorte quadrado visível, reduzido a 256×256 (JPEG ≤ ~100 KB).
async function openPhotoCropper(source,onSave){
  const image=await loadProfileImage(source);
  const STAGE=300,OUT=256;
  const base=STAGE/Math.min(image.naturalWidth,image.naturalHeight);
  const crop={zoom:1,cx:image.naturalWidth/2,cy:image.naturalHeight/2};
  const scale=()=>base*crop.zoom;
  const clamp=()=>{const half=STAGE/2/scale();crop.cx=Math.min(image.naturalWidth-half,Math.max(half,crop.cx));crop.cy=Math.min(image.naturalHeight-half,Math.max(half,crop.cy));};
  modal({title:'Enquadrar foto',confirmText:'Salvar foto',body:`<div class="crop-wrap"><div class="crop-stage" id="crop-stage"><canvas id="crop-canvas" width="${STAGE}" height="${STAGE}"></canvas><div class="crop-mask"></div></div><label class="crop-zoom"><span>Zoom</span><input id="crop-zoom" type="range" min="1" max="4" step="0.01" value="1"></label><small class="helper-text">Arraste a imagem para posicionar. Use o zoom ou a roda do mouse para aproximar.</small></div>`,
    onOpen:(root)=>{
      const canvas=$('#crop-canvas',root),context=canvas.getContext('2d'),zoom=$('#crop-zoom',root);
      const draw=()=>{clamp();const k=scale();context.fillStyle='#000';context.fillRect(0,0,STAGE,STAGE);context.drawImage(image,STAGE/2-crop.cx*k,STAGE/2-crop.cy*k,image.naturalWidth*k,image.naturalHeight*k);};
      draw();
      zoom.oninput=()=>{crop.zoom=Number(zoom.value);draw();};
      canvas.addEventListener('wheel',(event)=>{event.preventDefault();crop.zoom=Math.min(4,Math.max(1,crop.zoom+(event.deltaY<0?.1:-.1)));zoom.value=String(crop.zoom);draw();},{passive:false});
      let drag=null;
      canvas.addEventListener('pointerdown',(event)=>{drag={x:event.clientX,y:event.clientY,cx:crop.cx,cy:crop.cy};canvas.setPointerCapture(event.pointerId);canvas.classList.add('is-dragging');});
      canvas.addEventListener('pointermove',(event)=>{if(!drag)return;const k=scale();crop.cx=drag.cx-(event.clientX-drag.x)/k;crop.cy=drag.cy-(event.clientY-drag.y)/k;draw();});
      const end=()=>{drag=null;canvas.classList.remove('is-dragging');};
      canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
    },
    onConfirm:async()=>{
      clamp();const k=scale(),region=STAGE/k;
      const out=document.createElement('canvas');out.width=OUT;out.height=OUT;
      out.getContext('2d').drawImage(image,crop.cx-region/2,crop.cy-region/2,region,region,0,0,OUT,OUT);
      let quality=.86,data=out.toDataURL('image/jpeg',quality);
      while(data.length>120000&&quality>.4){quality-=.1;data=out.toDataURL('image/jpeg',quality);}
      if(data.length>120000)throw new Error('Não foi possível reduzir a imagem o suficiente.');
      await onSave(data);
    }});
}
function profileWorkSummary({start,end,breakMin,days}){
  if(!start||!end)return 'Horário de trabalho não informado.';
  const [sh,sm]=start.split(':').map(Number),[eh,em]=end.split(':').map(Number);
  let minutes=(eh*60+em)-(sh*60+sm);if(minutes<=0)minutes+=24*60;
  minutes=Math.max(0,minutes-(Number(breakMin)||0));
  const hours=`${Math.floor(minutes/60)}h${String(minutes%60).padStart(2,'0')}`;
  const labels=PROFILE_DAYS.filter(([key])=>days.includes(key)).map(([,label])=>label);
  return `${start} às ${end}${breakMin?` · intervalo de ${breakMin} min`:''} · ${hours} por dia${labels.length?` · ${labels.join(', ')}`:''}`;
}
async function renderProfile(){
  const payload=await api('/api/auth/profile',{fresh:true});
  state.profile=payload;applyProfileToSidebar();
  const u=payload.user||{},p=payload.profile||{};
  const initial=esc((u.name||'U').trim().charAt(0).toUpperCase());
  const dateTime=(value)=>{if(!value)return '—';const raw=String(value).replace(' ','T');const d=new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)?raw:`${raw}Z`);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Recife',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(d).replace(',',''):'—';};
  const days=new Set(p.workDays||[]);
  $('#page-content').innerHTML=`<div class="page-intro"><div><span class="eyebrow">MINHA CONTA</span><h3>Meu perfil</h3><p>Seus dados profissionais, horário de trabalho, foto e segurança da conta.</p></div></div>
  <section class="panel profile-hero"><div class="profile-photo-wrap"><div class="profile-photo ${p.avatar?'has-photo':''}" id="profile-photo" ${p.avatar?`style="background-image:url('${p.avatar}')"`:''}>${p.avatar?'':initial}</div><div class="profile-photo-actions"><button class="btn btn-secondary btn-sm" id="profile-photo-pick" type="button">${p.avatar?'Trocar foto':'Adicionar foto'}</button>${p.avatar?'<button class="btn btn-secondary btn-sm" id="profile-photo-adjust" type="button">Enquadrar</button><button class="btn btn-ghost btn-sm" id="profile-photo-remove" type="button">Remover</button>':''}<input id="profile-photo-input" type="file" accept="image/jpeg,image/png,image/webp" hidden></div></div>
    <div class="profile-hero-info"><h3>${esc(u.name||'—')}</h3><p class="profile-hero-role">${esc(u.cargo||'Cargo não informado')}${p.department?` · ${esc(p.department)}`:''}</p><div class="profile-chips">${badge(u.role||'—')}${u.matricula?`<span class="profile-chip">Matrícula ${esc(u.matricula)}</span>`:''}${u.email?`<span class="profile-chip">${esc(u.email)}</span>`:''}${p.unit?`<span class="profile-chip">${esc(p.unit)}</span>`:''}</div><div class="profile-meta"><span>Membro desde <strong>${esc(formatDate(u.createdAt))}</strong></span><span>Último acesso <strong>${esc(dateTime(u.lastLogin))}</strong></span></div>${p.bio?`<p class="profile-bio">${esc(p.bio)}</p>`:''}</div></section>
  <div class="profile-grid">
    <section class="panel"><div class="panel-header"><div><h3>Dados profissionais</h3><p class="helper-text">Como você aparece para a equipe.</p></div></div><div class="panel-body"><div class="form-grid">
      <label class="field span-2"><span>Nome de exibição</span><input id="pf-name" maxlength="120" value="${esc(u.name||'')}"></label>
      <label class="field"><span>Cargo</span><input id="pf-cargo" maxlength="80" value="${esc(u.cargo||'')}" placeholder="Ex.: Analista de Logística"></label>
      <label class="field"><span>Setor / Departamento</span><input id="pf-department" maxlength="80" value="${esc(p.department||'')}" placeholder="Ex.: Distribuição"></label>
      <label class="field"><span>Unidade</span><input id="pf-unit" maxlength="80" value="${esc(p.unit||'')}" placeholder="Ex.: Notaro Alimentos - Recife/PE"></label>
      <label class="field"><span>Telefone</span><input id="pf-phone" maxlength="30" inputmode="tel" value="${esc(p.phone||'')}" placeholder="(81) 99999-9999"></label>
      <label class="field"><span>Data de nascimento</span><input id="pf-birthdate" type="date" value="${esc(p.birthdate||'')}"></label>
      <label class="field span-2"><span>Sobre mim <small id="pf-bio-count">${(p.bio||'').length}/300</small></span><textarea id="pf-bio" rows="3" maxlength="300" placeholder="Uma breve apresentação (opcional)">${esc(p.bio||'')}</textarea></label>
    </div></div></section>
    <section class="panel"><div class="panel-header"><div><h3>Horário de trabalho</h3><p class="helper-text">Jornada habitual de trabalho.</p></div></div><div class="panel-body"><div class="form-grid">
      <label class="field"><span>Entrada</span><input id="pf-start" type="time" value="${esc(p.workStart||'')}"></label>
      <label class="field"><span>Saída</span><input id="pf-end" type="time" value="${esc(p.workEnd||'')}"></label>
      <label class="field span-2"><span>Intervalo (minutos)</span><input id="pf-break" type="number" min="0" max="480" step="5" value="${esc(p.workBreakMin??'')}" placeholder="Ex.: 60"></label>
      <div class="field span-2"><span>Dias de trabalho</span><div class="profile-days" id="pf-days">${PROFILE_DAYS.map(([key,label])=>`<button type="button" class="profile-day ${days.has(key)?'is-active':''}" data-day="${key}" aria-pressed="${days.has(key)}">${label}</button>`).join('')}</div></div>
      <div class="info-box span-2" id="pf-work-summary"></div>
    </div></div></section>
    <section class="panel"><div class="panel-header"><div><h3>Segurança</h3><p class="helper-text">Alterar a senha encerra todas as sessões e exige novo login.</p></div></div><div class="panel-body"><div class="form-grid">
      <label class="field span-2"><span>Senha atual</span><input id="pf-pwd-current" type="password" autocomplete="current-password"></label>
      <label class="field"><span>Nova senha</span><input id="pf-pwd-new" type="password" autocomplete="new-password"></label>
      <label class="field"><span>Confirmar nova senha</span><input id="pf-pwd-confirm" type="password" autocomplete="new-password"></label>
      <ul class="profile-pwd-rules span-2" id="pf-pwd-rules"><li data-rule="len">Mínimo de 8 caracteres</li><li data-rule="upper">Letra maiúscula</li><li data-rule="lower">Letra minúscula</li><li data-rule="digit">Número</li><li data-rule="symbol">Símbolo</li><li data-rule="match">Confirmação igual</li></ul>
      <div class="span-2"><button class="btn btn-secondary" id="pf-pwd-save" type="button">Alterar senha</button></div>
    </div></div></section>
    <section class="panel"><div class="panel-header"><div><h3>Preferências</h3><p class="helper-text">Valem apenas neste navegador.</p></div></div><div class="panel-body"><div class="profile-prefs">
      <div class="profile-pref"><div><strong>Tema</strong><small>Alterna entre claro e escuro.</small></div><button class="btn btn-secondary btn-sm" id="pf-theme" type="button">${document.documentElement.dataset.theme==='dark'?'Usar tema claro':'Usar tema escuro'}</button></div>
      ${typeof window.enableOperationalNotifications==='function'?`<div class="profile-pref"><div><strong>Alertas do navegador</strong><small>Avisos de novas ocorrências operacionais.</small></div><button class="btn btn-secondary btn-sm" id="pf-notify" type="button">${window.operationalNotificationsEnabled?.()?'Alertas ativos':'Ativar alertas'}</button></div>`:''}
    </div></div></section>
  </div>
  <div class="profile-save-bar"><button class="btn btn-primary" id="pf-save" type="button">Salvar perfil</button></div>`;
  const refreshSummary=()=>{const activeDays=$$('.profile-day.is-active').map((b)=>b.dataset.day);$('#pf-work-summary').textContent=profileWorkSummary({start:$('#pf-start').value,end:$('#pf-end').value,breakMin:$('#pf-break').value,days:activeDays});};
  ['#pf-start','#pf-end','#pf-break'].forEach((sel)=>$(sel).addEventListener('input',refreshSummary));
  $$('.profile-day').forEach((button)=>button.onclick=()=>{button.classList.toggle('is-active');button.setAttribute('aria-pressed',button.classList.contains('is-active'));refreshSummary();});
  refreshSummary();
  $('#pf-bio').addEventListener('input',()=>{$('#pf-bio-count').textContent=`${$('#pf-bio').value.length}/300`;});
  const savePayload=(extra={})=>({name:$('#pf-name').value.trim(),cargo:$('#pf-cargo').value.trim(),department:$('#pf-department').value.trim(),unit:$('#pf-unit').value.trim(),phone:$('#pf-phone').value.trim(),birthdate:$('#pf-birthdate').value,bio:$('#pf-bio').value.trim(),workStart:$('#pf-start').value,workEnd:$('#pf-end').value,workBreakMin:$('#pf-break').value,workDays:$$('.profile-day.is-active').map((b)=>b.dataset.day),...extra});
  const persist=async(body,message)=>{const response=await api('/api/auth/profile',{method:'PUT',body:JSON.stringify(body)});state.profile=response;applyProfileToSidebar();toast(message);return response;};
  $('#pf-save').onclick=async()=>{try{await persist(savePayload(),'Perfil salvo.');await renderProfile();}catch(error){toast(error.message||String(error),'danger');}};
  // Foto: salva na hora (recortada em quadrado 256×256).
  $('#profile-photo-pick').onclick=()=>$('#profile-photo-input').click();
  $('#profile-photo').onclick=()=>$('#profile-photo-input').click();
  const savePhoto=async(avatar)=>{await persist({avatar},'Foto atualizada.');await renderProfile();};
  $('#profile-photo-input').onchange=async(event)=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;try{await openPhotoCropper(file,savePhoto);}catch(error){toast(error.message||String(error),'danger');}};
  $('#profile-photo-adjust')?.addEventListener('click',async()=>{try{await openPhotoCropper(p.avatar,savePhoto);}catch(error){toast(error.message||String(error),'danger');}});
  $('#profile-photo-remove')?.addEventListener('click',async()=>{try{await persist({avatar:''},'Foto removida.');await renderProfile();}catch(error){toast(error.message||String(error),'danger');}});
  // Senha
  const rules={len:(v)=>v.length>=8,upper:(v)=>/[A-Z]/.test(v),lower:(v)=>/[a-z]/.test(v),digit:(v)=>/[0-9]/.test(v),symbol:(v)=>/[^A-Za-z0-9]/.test(v)};
  const refreshRules=()=>{const value=$('#pf-pwd-new').value;$$('#pf-pwd-rules li').forEach((li)=>{const key=li.dataset.rule;li.classList.toggle('is-ok',key==='match'?Boolean(value)&&value===$('#pf-pwd-confirm').value:rules[key](value));});};
  $('#pf-pwd-new').addEventListener('input',refreshRules);$('#pf-pwd-confirm').addEventListener('input',refreshRules);
  $('#pf-pwd-save').onclick=async()=>{try{
    if(!$('#pf-pwd-current').value)throw new Error('Informe a senha atual.');
    await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:$('#pf-pwd-current').value,newPassword:$('#pf-pwd-new').value,confirmPassword:$('#pf-pwd-confirm').value})});
    toast('Senha alterada. Entre novamente.');clearSession();showAuth();
  }catch(error){toast(error.message||String(error),'danger');}};
  $('#pf-theme').onclick=()=>{setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');$('#pf-theme').textContent=document.documentElement.dataset.theme==='dark'?'Usar tema claro':'Usar tema escuro';};
  $('#pf-notify')?.addEventListener('click',async()=>{const ok=await window.enableOperationalNotifications();$('#pf-notify').textContent=ok?'Alertas ativos':'Ativar alertas';});
}

async function navigate(route=state.route){
  if(route==='route_dashboard')route='route_summary';
  const navSeq=++state.navigationSeq;
  state.navigationAbortController?.abort();
  state.navigationAbortController=new AbortController();
  state.apiInflight.clear();
  state.route=route;clearInterval(state.routeGpsTimer);clearInterval(state.departureTimer);clearInterval(state.pendingTimer);renderNavigation();$('#page-title').textContent=TITLES[route]||'Rota';$('#page-eyebrow').textContent=route.startsWith('route_')?'Rota':'Operação';$('#print-title').textContent=`DMS ROTA · ${TITLES[route]||'Relatório'}`;$('#print-date').textContent=new Date().toLocaleString('pt-BR');
  $('#sidebar')?.classList.remove('is-open');$('#sidebar-backdrop')?.classList.remove('is-visible');$('#page-content').innerHTML='<div class="page-load-state is-placeholder" aria-hidden="true"></div>';showLoading(`Carregando ${TITLES[route]||'Rota'}...`,'Você pode trocar de aba pelo menu enquanto os dados são carregados.');
  try{
    const rv=window.NATTO_DMS_ROTA;if(!rv)throw new Error('Módulo Rota não foi carregado.');
    if(route==='route_profile')await renderProfile();
    else if(route==='route_dashboard')await rv.renderDashboard();
    else if(route==='route_summary')await rv.renderSummary();
    else if(route==='route_schedule')await rv.renderSchedule();
    else if(route==='route_returns')await rv.renderReturns();
    else if(route==='route_monitoring')await rv.renderMonitoring();
    else if(route==='route_location')await rv.renderLocations();
    else if(route==='route_clients')await rv.renderClients();
    else if(route==='route_indicators')await rv.renderIndicators('route_indicators');
    else if(route==='route_departure_indicators')await rv.renderIndicators('departure_indicators');
    else if(route==='route_management')await rv.renderManagementData();
    else if(route==='route_settings')await rv.renderSettings();
    else if(route==='route_departures')await renderDepartures();
    else if(route==='route_pending')await renderPending();
    else if(route==='route_users')await renderUsers();
    else if(route==='route_vehicles')await renderCatalog('vehicles');
    else if(route==='route_routes')await renderCatalog('routes');
    else if(route==='route_drivers')await renderEmployees('MOTORISTA');
    else if(route==='route_helpers')await renderEmployees('AJUDANTE');
  }catch(error){
    if(navSeq!==state.navigationSeq)return;
    if(error?.name==='AbortError')return;
    const code=String(error?.code||'');
    const transient=code==='SERVICE_TEMPORARILY_UNAVAILABLE'||code==='REQUEST_TIMEOUT'||/^HTTP_(429|502|503|504)$/.test(code)||error?.name==='TypeError';
    if(route==='route_schedule'&&transient){
      $('#page-content').innerHTML=`<div class="info-box"><strong>Conexão oscilando.</strong><div>Não consegui buscar a Escala agora. O DMS tentará usar a última cópia válida assim que ela estiver disponível; nenhuma informação foi apagada.</div><div class="card-actions"><button class="btn btn-primary" id="route-schedule-retry">Tentar novamente</button></div></div>`;
      setConnection(false,'Instável · escala');
      $('#route-schedule-retry')?.addEventListener('click',()=>navigate('route_schedule'));
    }else{
      $('#page-content').innerHTML=`<div class="danger-box"><strong>Não foi possível carregar esta tela.</strong><div>${esc(error.message||String(error))}</div>${transient?`<div class="card-actions"><button class="btn btn-primary" id="route-page-retry">Tentar novamente</button><button class="btn btn-ghost" id="route-page-diagnose">Executar diagnóstico</button></div><div id="route-page-diagnostic-result" class="helper-text"></div>`:''}</div>`;
      if(transient){
        $('#route-page-retry')?.addEventListener('click',()=>navigate(route));
        $('#route-page-diagnose')?.addEventListener('click',async()=>{const host=$('#route-page-diagnostic-result');if(host)host.textContent='Verificando D1, índices e planos de consulta...';try{const d=await api('/api/diagnostics?repair=1',{fresh:true,navigationScoped:false,connectionImpact:false,timeoutMs:45000,maxAttempts:1});const missing=(d.missingIndexes||[]).length,unindexed=(d.unindexedPlans||[]).length;if(host)host.innerHTML=`<strong>Diagnóstico: ${esc(d.status||'OK')}</strong> · D1 ${formatNumber(d.d1PingMs||0)} ms · ${missing} índice(s) crítico(s) ausente(s) · ${unindexed} plano(s) sem índice.${missing?`<br>Ausentes: ${esc((d.missingIndexes||[]).join(', '))}`:''}`;}catch(diagError){if(host)host.textContent=`Diagnóstico também indisponível: ${diagError.message||String(diagError)}`;}});
      }
      toast(error.message||String(error),transient?'warning':'error');
    }
  }
  finally{if(navSeq===state.navigationSeq)hideLoading();}
}

function departureChangeHistory(row={}){
  const raw=row?.trocas_recursos;
  if(Array.isArray(raw))return raw;
  if(typeof raw==='string'&&raw.trim()){
    try{const parsed=JSON.parse(raw);return Array.isArray(parsed)?parsed:[];}catch{}
  }
  return [];
}
function departureLatestReplacement(row={},field=''){
  const target=normalize(field);let found=null;
  for(const item of departureChangeHistory(row)){
    if(normalize(item?.campo)!==target)continue;
    const previous=String(item?.anterior||'').trim();
    const next=String(item?.novo||'').trim();
    const type=normalize(item?.tipo||'');
    if(!previous||type==='ALOCAÇÃO INICIAL')continue;
    found={previous,next,type,reason:item?.justificativa||'',author:item?.autor||'',at:item?.data_hora||''};
  }
  return found;
}
function departureReplacementInfo(row={}){
  const vehicle=departureLatestReplacement(row,'VEÍCULO');
  const driver=departureLatestReplacement(row,'MOTORISTA');
  const helper1=departureLatestReplacement(row,'AJUDANTE 1');
  const helper2=departureLatestReplacement(row,'AJUDANTE 2');
  const helpers=[helper1,helper2].filter(Boolean);
  return {vehicle,driver,helper1,helper2,helpers,hasAny:Boolean(vehicle||driver||helpers.length)};
}
function departureReplacementInline(change,label='Substituiu'){
  if(!change?.previous)return '';
  const action=normalize(change.type)==='REMOÇÃO'?'Removido':'Substituiu';
  return `<div class="departure-substitution"><span class="departure-substitution-tag">TROCA</span><span>${esc(action)}: <strong>${esc(change.previous)}</strong></span></div>`;
}
function departureReplacementText(change){return change?.previous||'';}

function departureRowsForReport(rows=[],query='',status=''){
  const q=normalize(query),selectedStatus=normalize(status);
  return rows.filter((r)=>{
    const rowStatus=normalize(r.status||r.status_saida||'PENDENTE');
    const repl=departureReplacementInfo(r);
    const searchable=normalize([r.sequencia,r.rota,r.ocs,r.placa,r.regiao,r.motorista,r.ajudante_1,r.ajudante_2,repl.vehicle?.previous,repl.driver?.previous,...repl.helpers.map((item)=>item.previous),r.status,r.status_saida,r.origem_saida,r.motivo_atraso,r.responsavel_atraso].filter(Boolean).join(' '));
    return (!q||searchable.includes(q))&&(!selectedStatus||rowStatus===selectedStatus);
  });
}

function generateDepartureStatusPdf(rows=[],date='',tolerance=30,{query='',status=''}={}){
  const reportRows=departureRowsForReport(rows,query,status);
  if(!reportRows.length){toast('Nenhum veículo corresponde aos filtros para gerar o PDF.','warning');return;}
  const statusOrder=['PENDENTE','SAIU','NAO SAIU','TRANSFERIDO','CANCELADO'];
  const statusLabels={PENDENTE:'PENDENTE',SAIU:'SAIU','NAO SAIU':'NÃO SAIU',TRANSFERIDO:'TRANSFERIDO',CANCELADO:'CANCELADO'};
  const statusColors={PENDENTE:'#b54708',SAIU:'#067647','NAO SAIU':'#b42318',TRANSFERIDO:'#175cd3',CANCELADO:'#475467'};
  const grouped=new Map();
  reportRows.forEach((r)=>{const key=normalize(r.status||r.status_saida||'PENDENTE')||'PENDENTE';if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);});
  const orderedKeys=[...statusOrder.filter((key)=>grouped.has(key)),...[...grouped.keys()].filter((key)=>!statusOrder.includes(key)).sort()];
  const generated=new Date().toLocaleString('pt-BR');
  const filterText=[query?`Busca: ${query}`:'',status?`Status: ${statusLabels[normalize(status)]||status}`:''].filter(Boolean).join(' · ')||'Todos os veículos da data operacional';
  const summary=orderedKeys.map((key)=>`<span style="border-color:${statusColors[key]||'#475467'}"><b>${esc(statusLabels[key]||key)}</b> ${grouped.get(key).length}</span>`).join('');
  const sections=orderedKeys.map((key)=>{
    const items=grouped.get(key)||[];
    const color=statusColors[key]||'#475467';
    const body=items.map((r)=>{
      const departed=normalize(r.status||r.status_saida)==='SAIU',delay=Number(r.atraso_minutos||0);
      const origin=r.automatico?'GPS':r.tem_registro_saida?'Manual':'—';
      const detail=r.automatico?'Detectada automaticamente':r.tem_registro_saida?'Registro operacional':'Aguardando confirmação';
      const repl=departureReplacementInfo(r),helperPrevious=repl.helpers.map((item)=>item.previous).filter(Boolean).join(' / ');
      return `<tr><td><strong>${esc(r.sequencia||'—')}</strong></td><td><strong>${esc(r.rota||'—')}</strong><small>${esc(r.ocs||'Sem OC')}</small></td><td><strong>${esc(r.placa||'—')}</strong><small>${esc(r.regiao||'—')}</small>${repl.vehicle?.previous?`<small class="swap">Substituiu: ${esc(repl.vehicle.previous)}</small>`:''}</td><td><strong>${esc(r.motorista||'—')}</strong>${repl.driver?.previous?`<small class="swap">Motorista substituído: ${esc(repl.driver.previous)}</small>`:''}<small>${esc([r.ajudante_1,r.ajudante_2].filter(Boolean).join(' / ')||'Sem ajudante')}</small>${helperPrevious?`<small class="swap">Ajudante(s) substituído(s): ${esc(helperPrevious)}</small>`:''}</td><td>${esc(r.hora_programada||'—')}</td><td>${esc(r.hora_real||'—')}</td><td>${departed?`${formatNumber(delay)} min`:'—'}</td><td><strong>${esc(origin)}</strong><small>${esc(detail)}</small></td><td>${esc(r.motivo_atraso||'—')}<small>${esc(r.responsavel_atraso||'')}</small><small class="audit">Auditoria: ${esc(r.auditoria_realizada?departureAuditResultLabel(r.auditoria_resultado):'NÃO AUDITADO')}${Number(r.auditoria_fotos||0)>0?` · ${formatNumber(r.auditoria_fotos)} foto(s)`:''}</small></td></tr>`;
    }).join('');
    return `<section class="status-group"><div class="status-title" style="border-left-color:${color}"><h2>${esc(statusLabels[key]||key)}</h2><strong>${items.length} veículo(s)</strong></div><table><thead><tr><th>Seq.</th><th>Rota / OC</th><th>Placa / região</th><th>Motorista / ajudante(s)</th><th>Programada</th><th>Real</th><th>Desvio</th><th>Origem</th><th>Motivo / responsável</th></tr></thead><tbody>${body}</tbody></table></section>`;
  }).join('');
  const w=window.open('','_blank');
  if(!w){toast('O navegador bloqueou a janela do PDF. Libere pop-ups para este sistema e tente novamente.','warning');return;}
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Controle de Saída por status — ${esc(formatDate(date))}</title><style>@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}body{margin:0;color:#101828;font-family:Arial,Helvetica,sans-serif}.report-head{display:flex;align-items:center;gap:12px;border-bottom:2px solid #006015;padding-bottom:7px;margin-bottom:7px}.report-head img{width:72px;height:35px;object-fit:contain}.report-head div{flex:1}.report-head h1{margin:0;font-size:17px}.report-head p{margin:3px 0 0;color:#475467;font-size:9px}.report-total{font-size:10px;font-weight:700;white-space:nowrap}.summary{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 8px}.summary span{border:1px solid;border-left-width:4px;border-radius:4px;padding:3px 6px;font-size:8px}.summary b{margin-right:4px}.status-group{margin:0 0 8mm}.status-title{display:flex;justify-content:space-between;align-items:center;border-left:5px solid;padding:4px 7px;background:#f2f4f7;break-after:avoid;page-break-after:avoid}.status-title h2{margin:0;font-size:11px}.status-title strong{font-size:8.5px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #98a2b3;padding:4px;font-size:7.8px;line-height:1.18;vertical-align:middle;overflow-wrap:anywhere}th{background:#dfeee4;text-transform:uppercase;font-size:7.1px;font-weight:800}tbody tr:nth-child(even) td{background:#f7faf8}td small{display:block;margin-top:2px;color:#475467;font-size:6.9px}.audit{margin-top:4px!important;padding-top:3px;border-top:1px dotted #98a2b3;font-weight:700}.swap{color:#b54708!important;font-weight:700}th:nth-child(1){width:5%}th:nth-child(2){width:13%}th:nth-child(3){width:10%}th:nth-child(4){width:21%}th:nth-child(5),th:nth-child(6){width:7%}th:nth-child(7){width:6%}th:nth-child(8){width:10%}th:nth-child(9){width:21%}@media print{.status-group:last-child{margin-bottom:0}}</style></head><body><header class="report-head"><img src="${LOGO_URL}" alt="Natto"><div><h1>Situação dos veículos — Controle de Saída</h1><p>Data operacional: ${esc(formatDate(date))} · Gerado em ${esc(generated)} · Tolerância: ${formatNumber(tolerance)} min</p><p>${esc(filterText)}</p></div><span class="report-total">${reportRows.length} veículo(s)</span></header><div class="summary">${summary}</div>${sections}<script>window.onload=()=>setTimeout(()=>window.print(),180)<\/script></body></html>`);
  w.document.close();
}


const DEPARTURE_AUDIT_ITEMS=[
  {id:'TEMPERATURA_FRIO',label:'Temperatura do frio'},
  {id:'DIVISORIA_REDE',label:'Carro possui divisória (rota de rede)',answerType:'YES_NO'},
  {id:'PALETES_IDENTIFICADOS_REDE',label:'Paletes identificados por rede',answerType:'YES_NO'},
  {id:'TEMPERATURA_PRODUTOS',label:'Temperatura dos produtos (verificação)'},
  {id:'CARGA_TOMBADA',label:'Carga tombada',answerType:'YES_NO_NEGATIVE'}
];
function departureAuditChecklistOptions(item,current=''){
  const raw=normalize(current),status=['NAO CONFORME','NAO_CONFORME'].includes(raw)?'NAO_CONFORME':raw;
  const options=item.answerType==='YES_NO'
    ?[['','Selecione...'],['CONFORME','Sim'],['NAO_CONFORME','Não'],['NA','N/A']]
    :item.answerType==='YES_NO_NEGATIVE'
      ?[['','Selecione...'],['CONFORME','Não'],['NAO_CONFORME','Sim'],['NA','N/A']]
      :[['','Selecione...'],['CONFORME','Conforme'],['NAO_CONFORME','Não conforme'],['NA','N/A']];
  return options.map(([value,label])=>`<option value="${value}" ${value&&status===value?'selected':''}>${label}</option>`).join('');
}
function departureAuditResultLabel(value=''){const status=normalize(value);return status==='NAO CONFORME'||status==='NAO_CONFORME'?'COM NÃO CONFORMIDADE':status==='CONFORME'?'CONFORME':'AUDITADO';}
function departureAuditBadge(row={}){
  if(!row.auditoria_realizada)return '<span class="audit-badge is-none">Não auditado</span>';
  const nonconforming=['NAO CONFORME','NAO_CONFORME'].includes(normalize(row.auditoria_resultado));
  const title=[row.auditoria_por?`Por ${row.auditoria_por}`:'',row.auditoria_em?new Date(row.auditoria_em).toLocaleString('pt-BR'):''].filter(Boolean).join(' · ');
  return `<span class="audit-badge ${nonconforming?'is-warning':'is-ok'}" title="${esc(title)}">${nonconforming?'⚠':'✓'} ${esc(departureAuditResultLabel(row.auditoria_resultado))}</span>${Number(row.auditoria_fotos||0)>0?`<small class="audit-photo-count">📷 ${formatNumber(row.auditoria_fotos)} foto(s)</small>`:''}`;
}
function auditExistingValue(audit,itemId){return (audit?.checklist||[]).find((item)=>String(item.id||'')===String(itemId))?.status||'';}
function auditFilePreview(root,files=[]){
  const host=$('#dep-audit-new-preview',root);if(!host)return;
  (root._departureAuditPreviewUrls||[]).forEach((url)=>{try{URL.revokeObjectURL(url);}catch{}});
  const urls=(files||[]).map((file)=>URL.createObjectURL(file));root._departureAuditPreviewUrls=urls;
  host.innerHTML=(files||[]).map((file,index)=>`<div class="audit-photo-card is-new"><img src="${esc(urls[index])}" alt="Nova evidência ${index+1}"><small>${esc(file.name||`Foto ${index+1}`)}</small><button type="button" class="btn btn-ghost btn-sm" data-audit-remove-new="${index}">Remover</button></div>`).join('');
  $$('[data-audit-remove-new]',host).forEach((button)=>{button.onclick=()=>{const selected=departureAuditSelectedFiles(root);selected.splice(Number(button.dataset.auditRemoveNew||0),1);root._departureAuditNewFiles=selected;auditFilePreview(root,selected);};});
}
function departureAuditSelectedFiles(root){
  return Array.isArray(root?._departureAuditNewFiles)?[...root._departureAuditNewFiles]:[];
}
function departureAuditRefreshSelection(root,changedInput=null){
  let selected=departureAuditSelectedFiles(root);
  const kept=$$('[data-audit-keep-photo]',root).filter((box)=>box.checked).length;
  const isFileInput=changedInput?.matches?.('input[type="file"]');
  if(isFileInput){
    const incoming=[...(changedInput.files||[])];
    if(kept+selected.length+incoming.length>5){
      changedInput.value='';
      toast('A auditoria permite no máximo 5 fotos.','warning');
      auditFilePreview(root,selected);
      return;
    }
    selected=[...selected,...incoming];
    root._departureAuditNewFiles=selected;
    changedInput.value='';
    auditFilePreview(root,selected);
    return;
  }
  if(kept+selected.length>5){
    if(changedInput?.matches?.('[data-audit-keep-photo]'))changedInput.checked=false;
    toast('A auditoria permite no máximo 5 fotos.','warning');
  }
  auditFilePreview(root,selected);
}
async function compressDepartureAuditPhoto(file){
  if(!file||!String(file.type||'').startsWith('image/'))throw new Error('Selecione apenas arquivos de imagem.');
  const bitmap=await createImageBitmap(file);const maxSide=1280;const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,width,height);bitmap.close?.();
  let quality=.74,blob=null;for(const q of [.74,.64,.54,.46]){quality=q;blob=await new Promise((resolve)=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=650*1024)break;}
  if(!blob)throw new Error('Não foi possível processar uma das fotos.');if(blob.size>700*1024)throw new Error(`A foto ${file.name||''} continua muito grande após compactação.`);
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('Falha ao ler uma das fotos.'));reader.readAsDataURL(blob);});
  const baseName=String(file.name||'evidencia').replace(/\.[^.]+$/,'').slice(0,120)||'evidencia';return {fileName:`${baseName}.jpg`,mimeType:'image/jpeg',data,sizeBytes:blob.size};
}
async function openDepartureAudit(row){
  if(!row)return;
  showLoading('Abrindo auditoria do veículo','Carregando checklist e evidências...');
  let payload;try{payload=await api(`/api/departures?view=audit&scheduleId=${encodeURIComponent(row.schedule_record_id||'')}${row.departure_id?`&departureId=${encodeURIComponent(row.departure_id)}`:''}`,{fresh:true,navigationScoped:false});}finally{hideLoading();}
  const audit=payload?.audit||null,photos=Array.isArray(payload?.photos)?payload.photos:[];
  const checklistHtml=DEPARTURE_AUDIT_ITEMS.map((item,index)=>{const current=auditExistingValue(audit,item.id);return `<div class="audit-check-row"><div><span>${index+1}</span><strong>${esc(item.label)}</strong></div><select class="filter-control" data-audit-check="${esc(item.id)}">${departureAuditChecklistOptions(item,current)}</select></div>`;}).join('');
  const existingPhotos=photos.length?`<div class="audit-photo-grid">${photos.map((photo)=>`<div class="audit-photo-card"><a href="#" data-audit-photo-link="${esc(photo.id)}" target="_blank" rel="noopener"><img data-audit-photo-src="${esc(photo.url)}" alt="Evidência da auditoria"></a><label><input type="checkbox" data-audit-keep-photo="${esc(photo.id)}" checked> Manter</label><small>${esc(photo.fileName||'Evidência')}</small></div>`).join('')}</div>`:'<div class="helper-text">Nenhuma foto anexada nesta auditoria.</div>';
  const auditMeta=audit?`<div class="audit-meta-line"><strong>${esc(departureAuditResultLabel(audit.result))}</strong><span>Auditado por ${esc(audit.auditorName||'—')} em ${esc(audit.auditedAt?new Date(audit.auditedAt).toLocaleString('pt-BR'):'—')}</span></div>`:'<div class="audit-meta-line is-empty"><strong>Ainda não auditado</strong><span>O checklist é opcional para a saída e registra a evidência quando a auditoria for realizada.</span></div>';
  modal({
    title:`Auditoria do veículo · ${row.placa||row.rota||''}`,
    confirmText:audit?'Atualizar auditoria':'Salvar auditoria',
    wide:true,
    body:`<div class="departure-modal-summary"><div><span>Rota</span><strong>${esc(row.rota||'—')}</strong></div><div><span>Placa</span><strong>${esc(row.placa||'—')}</strong></div><div><span>Motorista</span><strong>${esc(row.motorista||'—')}</strong></div><div><span>Data</span><strong>${esc(formatDate(row.data||state.departureDate||''))}</strong></div></div>${auditMeta}<section class="audit-section"><div class="audit-section-head"><div><h4>Checklist de verificação</h4><p>Registre cada verificação. Em "Carga tombada", Sim é tratado como não conformidade.</p></div></div><div class="audit-checklist">${checklistHtml}</div></section><section class="audit-section"><div class="audit-section-head"><div><h4>Evidências fotográficas</h4><p>Até 5 fotos. Você pode tirar a foto na hora ou anexar uma imagem já salva no aparelho.</p></div></div>${existingPhotos}<div class="audit-upload-actions"><label class="audit-upload"><input id="dep-audit-camera" type="file" accept="image/*" capture="environment"><span>📷 Tirar foto</span><small>Abre a câmera do celular para registrar a evidência no momento.</small></label><label class="audit-upload"><input id="dep-audit-photos" type="file" accept="image/*" multiple><span>🖼️ Anexar foto</span><small>Escolha uma ou mais imagens da galeria ou dos arquivos do aparelho.</small></label></div><div class="helper-text">As imagens são compactadas antes do envio. Cada nova foto tirada é acrescentada às anteriores até o limite de 5 evidências.</div><div id="dep-audit-new-preview" class="audit-photo-grid"></div></section><section class="audit-section"><label class="field"><span>Observações da auditoria</span><textarea id="dep-audit-notes" rows="4" placeholder="Registre não conformidades, orientações ou detalhes relevantes.">${esc(audit?.notes||'')}</textarea></label></section>`,
    onOpen:(root)=>{
      root._departureAuditNewFiles=[];root._departureAuditPreviewUrls=[];
      $$('[data-audit-photo-src]',root).forEach(async(img)=>{try{const response=await fetch(img.dataset.auditPhotoSrc,{headers:{Authorization:`Bearer ${state.token}`}});if(!response.ok)throw new Error(`HTTP ${response.status}`);const blob=await response.blob();const objectUrl=URL.createObjectURL(blob);img.src=objectUrl;const link=img.closest('a');if(link)link.href=objectUrl;}catch(error){console.warn('Falha ao carregar evidência da auditoria',error);img.alt='Evidência indisponível';}});
      const cameraInput=$('#dep-audit-camera',root),uploadInput=$('#dep-audit-photos',root);
      [cameraInput,uploadInput].filter(Boolean).forEach((input)=>{input.onchange=()=>departureAuditRefreshSelection(root,input);});
      $$('[data-audit-keep-photo]',root).forEach((box)=>{box.onchange=()=>departureAuditRefreshSelection(root);});
    },
    onConfirm:async(root)=>{
      const checklist=DEPARTURE_AUDIT_ITEMS.map((item)=>({id:item.id,label:item.label,status:$(`[data-audit-check="${item.id}"]`,root)?.value||''}));
      if(checklist.some((item)=>!item.status))throw new Error('Preencha o resultado de todos os itens do checklist.');
      const keepPhotoIds=$$('[data-audit-keep-photo]',root).filter((box)=>box.checked).map((box)=>Number(box.dataset.auditKeepPhoto)).filter(Boolean);
      const files=departureAuditSelectedFiles(root);if(keepPhotoIds.length+files.length>5)throw new Error('A auditoria permite no máximo 5 fotos.');
      const newPhotos=[];if(files.length){showLoading('Processando evidências','Compactando as fotos antes de salvar a auditoria...');try{for(const file of files)newPhotos.push(await compressDepartureAuditPhoto(file));}finally{hideLoading();}}
      await api('/api/departures',{method:'POST',body:JSON.stringify({operation:'SAVE_AUDIT',audit:{scheduleId:row.schedule_record_id||row.escala_id||'',departureId:row.departure_id||null,date:row.data||state.departureDate||'',plate:row.placa||'',route:row.rota||'',checklist,notes:$('#dep-audit-notes',root)?.value||''},keepPhotoIds,photos:newPhotos})});
      toast('Auditoria do veículo salva com as evidências.','success');await renderDepartures({silent:true,fresh:true});
    }
  });
}

async function renderDepartures({silent=false,fresh=false,reconcileGps=false,forceGps=false}={}){
  const date=state.departureDate||today();
  let liveGps=null,gpsRefreshError=null;
  if(forceGps){
    try{liveGps=await api('/api/protectsat?view=latest&force=1',{fresh:true,navigationScoped:false,timeoutMs:45000});}
    catch(error){gpsRefreshError=error;console.warn('Atualização GPS live não concluída; usando cache local.',error);}
  }
  const payload=await api(`/api/departures?view=control&date=${date}${reconcileGps?'&reconcileGps=1':''}${forceGps?`&refreshToken=${Date.now()}`:''}`,{fresh:true,navigationScoped:false,timeoutMs:30000});
  const rows=payload.records||[],summary=payload.summary||{},tolerance=Number(payload.toleranceMinutes||30);state.departureDate=date;state.departureCrewOptions=payload.crewOptions||{drivers:[],helpers:[]};
  const repairedTransfers=payload.transferReconcile?.repaired||[];
  const transferWarnings=payload.transferReconcile?.warnings||[];
  if(repairedTransfers.length&&!silent)toast(`${repairedTransfers.length} transferência(s) anterior(es) sem cópia de escala foram recuperadas e incluídas em ${formatDate(date)}.`,'success');
  if(transferWarnings.length&&!silent)console.warn('Avisos ao reconciliar escalas transferidas:',transferWarnings);
  if(forceGps){
    const allConfirmed=[...(liveGps?.autoDepartures||[]),...(payload.gpsReconcile?.confirmed||[])];
    const confirmedMap=new Map();
    allConfirmed.forEach((item)=>{const key=String(item?.scheduleId||item?.departureId||`${item?.plate||''}|${item?.exitAt||item?.time||''}`);if(key)confirmedMap.set(key,item);});
    const pendingRows=rows.filter((row)=>normalize(row.status||row.status_saida||'PENDENTE')==='PENDENTE');
    const pendingPlates=new Set(pendingRows.map((row)=>normalize(String(row.placa||'').replace(/[^A-Z0-9]/g,''))).filter(Boolean));
    const diagnostics=(payload.gpsReconcile?.diagnostics||[]).filter((item)=>pendingPlates.has(normalize(String(item?.plate||'').replace(/[^A-Z0-9]/g,'')))&&normalize(item?.reason)!=='NO_PENDING_SCHEDULE');
    const byPlate=new Map();diagnostics.forEach((item)=>{const plate=normalize(String(item?.plate||'').replace(/[^A-Z0-9]/g,''));if(plate&&!byPlate.has(plate))byPlate.set(plate,item);});
    const reasonLabel=(item={})=>{const reason=normalize(item.reason||'');if(reason==='CURRENT_INSIDE_FACILITY')return 'GPS ainda indica o veículo dentro da unidade';if(reason==='GPS_STALE')return `posição GPS desatualizada${item.gpsAgeMinutes!==undefined?` (${item.gpsAgeMinutes} min)`:''}`;if(reason==='GPS_TIMESTAMP_UNRELIABLE')return 'horário da posição GPS não é confiável';if(reason==='GPS_TIME_INVALID')return 'horário GPS inválido';if(reason==='NO_RECENT_INSIDE_POSITION')return 'não há posição recente dentro da unidade para comprovar a saída';if(reason==='WAITING_OUTSIDE_CONFIRMATIONS')return `aguardando a ${Number(item.received||0)+1}ª posição fora da unidade`;if(reason==='NO_CLEAR_EXIT_TRANSITION')return 'não houve transição GPS clara de dentro para fora';if(reason==='OUTSIDE_SCHEDULE_WINDOW')return 'posição fora da janela automática da escala';if(reason==='TRANSITION_QUERY_FAILED')return `falha ao consultar histórico GPS${item.error?`: ${item.error}`:''}`;if(reason==='ERROR')return item.message||'erro ao processar a saída automática';return String(item.reason||'não atendeu aos critérios de saída automática').replaceAll('_',' ').toLowerCase();};
    const pendingDiagnostics=pendingRows.slice(0,8).map((row)=>{const plate=normalize(String(row.placa||'').replace(/[^A-Z0-9]/g,''));const item=byPlate.get(plate);return `${row.placa||'Sem placa'} — ${item?reasonLabel(item):'sem posição GPS recente disponível no cache'}`;});
    const warnings=[...(liveGps?.syncWarnings||[]),...(payload.gpsReconcile?.warnings||[])].filter(Boolean);
    const unavailable=Boolean(gpsRefreshError||liveGps?.refreshError||liveGps?.degraded);
    state.departureGpsFeedback={at:new Date().toISOString(),checked:Number(payload.gpsReconcile?.checked||liveGps?.total||0),confirmed:[...confirmedMap.values()].length,pending:pendingRows.length,diagnostics:pendingDiagnostics,warnings:warnings.slice(0,3),unavailable,error:gpsRefreshError?.message||liveGps?.refreshError||''};
  }
  const gpsFeedback=state.departureGpsFeedback||null;
  const gpsFeedbackHtml=gpsFeedback?`<div class="info-box departure-gps-feedback ${gpsFeedback.confirmed>0?'is-success':gpsFeedback.unavailable?'is-danger':'is-warning'}"><strong>Atualização GPS:</strong> ${formatNumber(gpsFeedback.checked)} placa(s) verificadas · <strong>${formatNumber(gpsFeedback.confirmed)} saída(s) confirmada(s)</strong> · ${formatNumber(gpsFeedback.pending)} pendente(s).${gpsFeedback.error?`<div class="helper-text">${esc(gpsFeedback.error)}</div>`:''}${gpsFeedback.diagnostics?.length?`<div class="helper-text"><strong>Diagnóstico dos pendentes:</strong> ${gpsFeedback.diagnostics.map(esc).join(' · ')}</div>`:''}${gpsFeedback.warnings?.length?`<div class="helper-text"><strong>Avisos:</strong> ${gpsFeedback.warnings.map(esc).join(' · ')}</div>`:''}</div>`:'';
  const statusDetail=(r)=>r.automatico?'Detectada automaticamente pelo GPS':r.tem_registro_saida?'Registro operacional':'Aguardando confirmação';
  $('#page-content').innerHTML=`
    <div class="page-intro departure-intro"><div><span class="eyebrow">ROTA · SAÍDAS</span><h3>Controle de Saída</h3><p>A programação da Escala aparece automaticamente aqui. A saída pode ser confirmada manualmente ou pelo GPS quando o veículo deixa uma das referências da unidade de Belo Jardim (Frigorífico Natto ou Notaro Alimentos).</p><div class="helper-text">Tolerância operacional: <strong>${tolerance} minutos</strong>.</div></div><div class="page-intro-actions"><label class="departure-date-control"><span>Data operacional</span><input id="departure-date" class="filter-control" type="date" value="${esc(date)}"></label><input id="departure-search" class="filter-control" placeholder="Rota, placa, motorista ou OC"><select id="departure-status-filter" class="filter-control"><option value="">Todos os status</option><option>PENDENTE</option><option>SAIU</option><option>NÃO SAIU</option><option>TRANSFERIDO</option><option>CANCELADO</option></select><button class="btn btn-ghost" id="departure-refresh">↻ Atualizar GPS/saídas</button><button class="btn btn-ghost" id="departure-export">Exportar CSV</button><button class="btn btn-ghost" id="departure-pdf">▣ Gerar PDF</button></div></div>
    ${gpsFeedbackHtml}
    <div class="cards-grid departure-kpis">${metric('Programados',summary.programmed??rows.length,'Escalas do dia','info')}${metric('Saíram',summary.departed||0,'Saídas confirmadas','success')}${metric('Aguardando',summary.pending||0,'Ainda sem saída real','warning')}${metric('Automáticas',summary.automatic||0,'Detectadas pelo GPS','success')}${metric('Acima da tolerância',summary.delayed||0,`Mais de ${tolerance} min`,'danger')}</div>
    <section class="panel departure-control-panel"><div class="panel-header"><div><h3>Programação de ${formatDate(date)}</h3><p>Os veículos vêm diretamente da Escala. Não é necessário criar um registro de saída antes da confirmação.</p></div><span class="badge badge-info">${rows.length} rota(s)</span></div><div class="panel-body"><div class="table-wrap">${rows.length?`<table class="data-table departure-control-table"><thead><tr><th>Seq.</th><th>Rota / OC</th><th>Veículo</th><th>Equipe</th><th>Programada</th><th>Saída real</th><th>Desvio</th><th>Status</th><th>Origem</th><th>Auditoria</th><th>Ação</th></tr></thead><tbody>${rows.map((r)=>{
      const departed=normalize(r.status)==='SAIU';const pending=normalize(r.status)==='PENDENTE';const delay=Number(r.atraso_minutos||0),repl=departureReplacementInfo(r),helperPrevious=repl.helpers.map((item)=>item.previous).filter(Boolean).join(' / ');
      return `<tr data-departure-row data-departure-status="${esc(normalize(r.status||r.status_saida||'PENDENTE'))}" class="departure-row ${departed?'is-departed':pending?'is-pending':''}"><td><strong>${esc(r.sequencia||'—')}</strong></td><td><strong>${esc(r.rota||'—')}</strong><div class="muted">${esc(r.ocs||'')}</div></td><td><strong>${esc(r.placa||'—')}</strong><div class="muted">${esc(r.regiao||'')}</div>${departureReplacementInline(repl.vehicle)}</td><td><strong>${esc(r.motorista||'—')}</strong>${repl.driver?.previous?`<div class="departure-substitution"><span class="departure-substitution-tag">TROCA</span><span>Motorista substituído: <strong>${esc(repl.driver.previous)}</strong></span></div>`:''}<div class="muted">${esc([r.ajudante_1,r.ajudante_2].filter(Boolean).join(' / ')||'Sem ajudante')}</div>${helperPrevious?`<div class="departure-substitution"><span class="departure-substitution-tag">TROCA</span><span>Ajudante(s) substituído(s): <strong>${esc(helperPrevious)}</strong></span></div>`:''}</td><td><strong>${esc(r.hora_programada||'—')}</strong></td><td><strong>${esc(r.hora_real||'—')}</strong></td><td>${departed?`<strong class="${delay>tolerance?'text-danger':''}">${formatNumber(delay)} min</strong>`:'—'}</td><td>${badge(r.status||r.status_saida||'PENDENTE')}<div class="muted">${esc(statusDetail(r))}</div></td><td>${r.automatico?'<span class="departure-auto-source">🛰 GPS</span>':r.tem_registro_saida?'<span class="departure-manual-source">Manual</span>':'—'}</td><td><div class="departure-audit-cell">${departureAuditBadge(r)}<button class="btn btn-ghost btn-sm" data-dep-audit="${esc(r.schedule_record_id)}">${r.auditoria_realizada?'Ver auditoria':'Auditar'}</button></div></td><td>${pending?`<button class="btn btn-primary btn-sm" data-dep-confirm="${esc(r.schedule_record_id)}">Confirmar saída</button>`:`<button class="btn btn-ghost btn-sm" data-dep-edit="${esc(r.schedule_record_id)}">Editar</button>`}</td></tr>`;
    }).join('')}</tbody></table>`:'<div class="empty-state"><strong>Nenhuma escala encontrada para esta data.</strong><p>Quando houver programação na tela Escala, os veículos aparecerão aqui automaticamente.</p></div>'}</div></div></section>`;
  $('#departure-date').onchange=()=>{state.departureDate=$('#departure-date').value;renderDepartures();};
  const filterDepartureTable=()=>{const q=normalize($('#departure-search')?.value||'');const st=normalize($('#departure-status-filter')?.value||'');$$('[data-departure-row]').forEach((row)=>{const matchesText=!q||normalize(row.textContent).includes(q);const matchesStatus=!st||normalize(row.dataset.departureStatus)===st;row.hidden=!(matchesText&&matchesStatus);});};
  $('#departure-search').oninput=filterDepartureTable;$('#departure-status-filter').onchange=filterDepartureTable;
  $('#departure-refresh').onclick=async()=>{
    const button=$('#departure-refresh');if(button){button.disabled=true;button.textContent='↻ Atualizando GPS...';}
    showLoading('Atualizando GPS e saídas','Consultando ProtectSat e Lincros, gravando as posições e reconciliando as viagens pendentes...');
    try{
      const result=await renderDepartures({fresh:true,reconcileGps:true,forceGps:true});
      const feedback=result?.gpsFeedback||state.departureGpsFeedback||{};
      if(Number(feedback.confirmed||0)>0)toast(`${formatNumber(feedback.confirmed)} saída(s) atualizada(s) automaticamente pelo GPS.`,'success');
      else if(feedback.unavailable)toast('A consulta GPS não foi concluída. Veja o diagnóstico exibido na tela.','warning');
      else toast('GPS consultado. Nenhuma nova saída atingiu todos os critérios automáticos; veja o diagnóstico na tela.','warning');
    }catch(error){
      console.error('Falha ao atualizar GPS/saídas',error);toast(`Não foi possível atualizar GPS/saídas: ${error?.message||error}`,'error');
    }finally{hideLoading();}
  };
  $('#departure-export').onclick=()=>exportCsv(rows.map((r)=>{const repl=departureReplacementInfo(r);return {data:r.data,sequencia:r.sequencia,rota:r.rota,ocs:r.ocs,placa:r.placa,placa_substituida:departureReplacementText(repl.vehicle),motorista:r.motorista,motorista_substituido:departureReplacementText(repl.driver),ajudante_1:r.ajudante_1,ajudante_1_substituido:departureReplacementText(repl.helper1),ajudante_2:r.ajudante_2,ajudante_2_substituido:departureReplacementText(repl.helper2),hora_programada:r.hora_programada,hora_real:r.hora_real,atraso_minutos:r.atraso_minutos,status:r.status,origem:r.automatico?'GPS':'MANUAL',auditoria:r.auditoria_realizada?departureAuditResultLabel(r.auditoria_resultado):'NÃO AUDITADO',auditoria_por:r.auditoria_por||'',auditoria_em:r.auditoria_em||'',auditoria_fotos:Number(r.auditoria_fotos||0),motivo_atraso:r.motivo_atraso,responsavel_atraso:r.responsavel_atraso};}),`controle_saida_${date}.csv`);
  $('#departure-pdf').onclick=()=>generateDepartureStatusPdf(rows,date,tolerance,{query:$('#departure-search')?.value||'',status:$('#departure-status-filter')?.value||''});
  const findRow=(scheduleId)=>rows.find((r)=>String(r.schedule_record_id)===String(scheduleId));
  $$('[data-dep-confirm]').forEach((button)=>button.onclick=()=>openDeparture(findRow(button.dataset.depConfirm),'SAIU'));
  $$('[data-dep-edit]').forEach((button)=>button.onclick=()=>openDeparture(findRow(button.dataset.depEdit)));
  $$('[data-dep-audit]').forEach((button)=>button.onclick=()=>openDepartureAudit(findRow(button.dataset.depAudit)));
  clearInterval(state.departureTimer);
  state.departureTimer=setInterval(()=>{if(state.currentBase==='route'&&state.route==='route_departures')renderDepartures({silent:true,fresh:true,reconcileGps:true}).catch((error)=>console.error(error));},5*60*1000);
  return {rows,payload,liveGps,gpsFeedback:state.departureGpsFeedback||null};
}

const DEPARTURE_DELAY_REASONS=[
  {label:'Atraso no carregamento - Expedição',owner:'EXPEDIÇÃO'},
  {label:'Atraso no faturamento',owner:'FATURAMENTO'},
  {label:'Atraso do motorista - Distribuição',owner:'DISTRIBUIÇÃO'},
  {label:'Atraso do ajudante - Distribuição',owner:'DISTRIBUIÇÃO'},
  {label:'Atraso na prestação de contas - Distribuição/Tesouraria',owner:'DISTRIBUIÇÃO/TESOURARIA'},
  {label:'Atraso na portaria',owner:'PORTARIA'},
  {label:'Problema com o Veículo/Manutenção',owner:'MANUTENÇÃO'},
  {label:'Abastecimento do veículo',owner:'ABASTECIMENTO'},
  {label:'Reunião/Treinamento',owner:'DISTRIBUIÇÃO'},
  {label:'Reorganizar carga',owner:'EXPEDIÇÃO'},
  {label:'Atraso do Motorista - Terceiro',owner:'TERCEIRO'},
  {label:'Atraso no CTe - Terceiro',owner:'TERCEIRO'},
];
const departureDelayOwner=(reason)=>DEPARTURE_DELAY_REASONS.find((item)=>normalize(item.label)===normalize(reason))?.owner||'';

function departureCrewOptionLabel(item={}){
  const parts=[item.nome||'—'];
  if(item.matricula)parts.push(item.matricula);
  if(item.ajudante_rota)parts.push(item.cidade_rota?`AJUDANTE DE ROTA (${item.cidade_rota})`:'AJUDANTE DE ROTA');
  if(item.status)parts.push(item.status);
  return parts.join(' · ');
}
function departureCrewSelectOptions(items,currentId,currentName,{allowEmpty=false}={}){
  const list=[...(items||[])];
  const currentMatch=list.find((item)=>(currentId&&String(item.id)===String(currentId))||(!currentId&&currentName&&normalize(item.nome)===normalize(currentName)));
  if(!currentMatch&&currentName)list.unshift({id:currentId||'',nome:currentName,matricula:'',status:'ATUAL',historical:true});
  const options=[];
  if(allowEmpty)options.push(`<option value="" ${!currentId&&!currentName?'selected':''}>NENHUM</option>`);
  else if(!currentId&&!currentName)options.push('<option value="" selected disabled>SELECIONE...</option>');
  for(const item of list){
    const isCurrent=(currentId&&String(item.id)===String(currentId))||(!currentId&&currentName&&normalize(item.nome)===normalize(currentName))||Boolean(item.historical&&normalize(item.nome)===normalize(currentName));
    // Ajudante de rota pode ser escalado em mais de um veículo (mesma regra do
    // backend e do editor da Escala): ESCALADO aparece no rótulo, mas não bloqueia.
    const routeHelperScheduled=Boolean(item.ajudante_rota)&&normalize(item.status||'')==='ESCALADO';
    const available=['DISPONIVEL','DISPONIVEL PARA APOIO','ATUAL'].includes(normalize(item.status||'DISPONÍVEL'))||routeHelperScheduled||isCurrent;
    const hard=['FERIAS','ATESTADO','AFASTADO','BLOQUEADO','DESLIGADO','INATIVO','RESERVADO','FOLGA AGENDADA'].includes(normalize(item.status||''));
    // ESCALADO (viagem ainda sem saída) fica selecionável, sinalizado e exige
    // justificativa de troca. EM ROTA e PERNOITE sem retorno são bloqueados.
    const occupied=!available&&!hard&&normalize(item.status||'')==='ESCALADO';
    const selectable=(available||occupied)&&!hard;
    const value=String(item.id||`NAME:${normalize(item.nome)}`);
    options.push(`<option value="${esc(value)}" data-person-id="${esc(item.id||'')}" data-person-name="${esc(item.nome||'')}" data-occupied="${occupied?'1':''}" ${isCurrent?'selected':''} ${selectable?'':'disabled'}>${esc(departureCrewOptionLabel(item)+(item.motivo_indisponibilidade?' · '+item.motivo_indisponibilidade:'')+(occupied?' · CONFIRMAR TROCA':''))}</option>`);
  }
  return options.join('');
}
function departureSelectedPerson(root,selector){
  const select=$(selector,root);if(!select||!select.value)return {id:'',name:''};
  const option=select.selectedOptions?.[0];return {id:option?.dataset?.personId||'',name:option?.dataset?.personName||option?.textContent||'',occupied:option?.dataset?.occupied==='1'};
}
function departureSamePerson(a={},b={}){
  if(a.id&&b.id)return String(a.id)===String(b.id);
  return normalize(a.name)===normalize(b.name);
}

function openDeparture(r,preferredStatus=''){
  if(!r)return;
  const departureId=r.departure_id||null;
  const selectedStatus=preferredStatus||r.status||r.status_saida||'PENDENTE';
  const nowTime=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',hour12:false});
  const realValue=preferredStatus==='SAIU'&&!r.hora_real?nowTime:(r.hora_real||'');
  const currentReason=r.motivo_atraso||'';
  const standardReason=DEPARTURE_DELAY_REASONS.some((item)=>normalize(item.label)===normalize(currentReason));
  const reasonOptions=[`<option value="">Selecione o motivo...</option>`,...DEPARTURE_DELAY_REASONS.map((item)=>`<option value="${esc(item.label)}" ${normalize(item.label)===normalize(currentReason)?'selected':''}>${esc(item.label)}</option>`),...(!standardReason&&currentReason?[`<option value="${esc(currentReason)}" selected>${esc(currentReason)} · histórico</option>`]:[])].join('');
  const crewOptions=state.departureCrewOptions||{drivers:[],helpers:[]};
  const teamType=normalize(r.tipo_equipe||'UM_AJUDANTE');
  const thirdDriver=teamType==='TRES_MOTORISTAS';
  const secondDriver=teamType==='DOIS_MOTORISTAS'||thirdDriver;
  const showHelper1=!['CARGA_FECHADA','TERCEIRO','SEM_AJUDANTE'].includes(teamType);
  const showHelper2=['DOIS_AJUDANTES','DOIS_MOTORISTAS','TRES_MOTORISTAS'].includes(teamType)||Boolean(r.ajudante_2_id||r.ajudante_2);
  const original={
    placa:String(r.placa||'').trim().toUpperCase(),
    driver:{id:String(r.motorista_id||''),name:r.motorista||''},
    helper1:{id:String(r.ajudante_1_id||''),name:r.ajudante_1||''},
    helper2:{id:String(r.ajudante_2_id||''),name:r.ajudante_2||''},
  };
  const crewSummary=[r.motorista,...[r.ajudante_1,r.ajudante_2].filter(Boolean)].filter(Boolean).join(' / ')||'—';
  modal({
    title:`Controle de Saída · ${r.rota||r.placa||''}`,
    confirmText:preferredStatus==='SAIU'?'Confirmar saída':'Salvar alteração',
    body:`<div class="departure-modal-summary"><div><span>Rota</span><strong>${esc(r.rota||'—')}</strong></div><div><span>Placa</span><strong>${esc(r.placa||'—')}</strong></div><div><span>Equipe escalada</span><strong>${esc(crewSummary)}</strong></div><div><span>Programada</span><strong>${esc(r.hora_programada||'—')}</strong></div></div><div class="form-grid"><label class="field"><span>Status</span><select id="dep-status">${['PENDENTE','SAIU','NÃO SAIU','TRANSFERIDO','CANCELADO'].map((x)=>`<option ${normalize(selectedStatus)===normalize(x)?'selected':''}>${x}</option>`).join('')}</select></label><label class="field"><span>Hora programada</span><input id="dep-planned" type="time" value="${esc(r.hora_programada||'')}"></label><label class="field"><span>Hora real</span><input id="dep-real" type="time" value="${esc(realValue)}"></label><label class="field"><span>Placa</span><input id="dep-plate" value="${esc(r.placa||'')}"></label><label class="field"><span>Motorista</span><select id="dep-driver">${departureCrewSelectOptions(crewOptions.drivers,r.motorista_id,r.motorista)}</select><small>Troque aqui se o motorista real da saída for diferente da Escala.</small></label>${showHelper1?`<label class="field"><span>${secondDriver?'Motorista 2':'Ajudante 1'}</span><select id="dep-helper-1">${departureCrewSelectOptions(secondDriver?crewOptions.drivers:crewOptions.helpers,r.ajudante_1_id,r.ajudante_1,{allowEmpty:teamType!=='UM_AJUDANTE'&&teamType!=='DOIS_AJUDANTES'&&!secondDriver})}</select></label>`:''}${showHelper2?`<label class="field"><span>${thirdDriver?'Motorista 3':secondDriver?'Ajudante':'Ajudante 2'}</span><select id="dep-helper-2">${departureCrewSelectOptions(thirdDriver?crewOptions.drivers:crewOptions.helpers,r.ajudante_2_id,r.ajudante_2,{allowEmpty:teamType!=='DOIS_AJUDANTES'})}</select></label>`:''}<label class="field"><span>Motivo do atraso</span><select id="dep-delay-reason">${reasonOptions}</select><small>Selecione um dos motivos operacionais padronizados.</small></label><label class="field"><span>Responsável pelo atraso</span><input id="dep-delay-owner" value="${esc(departureDelayOwner(currentReason)||r.responsavel_atraso||'')}" readonly><small>Preenchido automaticamente conforme o motivo.</small></label><label class="field span-2"><span>Detalhe / justificativa do atraso</span><textarea id="dep-delay-detail">${esc(r.detalhe_motivo||'')}</textarea></label><div id="dep-swap-alert" class="info-box span-2" hidden></div><label class="field span-2" id="dep-swap-field" hidden><span>Justificativa de troca/alocação</span><textarea id="dep-swap-reason" placeholder="Obrigatória somente quando houver troca de motorista, ajudante(s) ou placa.">${esc(r.justificativa_troca||'')}</textarea><small id="dep-swap-help">Se a equipe permanecer igual à Escala, este campo pode ficar vazio.</small></label></div>`,
    onOpen:(root)=>{
      const reason=$('#dep-delay-reason',root),owner=$('#dep-delay-owner',root);if(reason&&owner)reason.onchange=()=>{owner.value=departureDelayOwner(reason.value);};
      const refreshSwap=()=>{
        const driver=departureSelectedPerson(root,'#dep-driver');
        const helper1=showHelper1?departureSelectedPerson(root,'#dep-helper-1'):original.helper1;
        const helper2=showHelper2?departureSelectedPerson(root,'#dep-helper-2'):original.helper2;
        const plate=String($('#dep-plate',root)?.value||'').trim().toUpperCase();
        const changed=[];
        if(plate!==original.placa)changed.push(`Placa: ${original.placa||'—'} → ${plate||'—'}`);
        if(!departureSamePerson(driver,original.driver))changed.push(`Motorista: ${original.driver.name||'—'} → ${driver.name||'—'}`);
        if(!departureSamePerson(helper1,original.helper1))changed.push(`Ajudante 1: ${original.helper1.name||'—'} → ${helper1.name||'—'}`);
        if(!departureSamePerson(helper2,original.helper2))changed.push(`Ajudante 2: ${original.helper2.name||'—'} → ${helper2.name||'—'}`);
        const alert=$('#dep-swap-alert',root),field=$('#dep-swap-field',root),textarea=$('#dep-swap-reason',root),help=$('#dep-swap-help',root);
        if(alert){alert.hidden=!changed.length;alert.innerHTML=changed.length?`<strong>Troca detectada na saída</strong><div>${changed.map((item)=>esc(item)).join('<br>')}</div><div class="helper-text">Ao salvar, esta equipe passa a aparecer também na Escala.</div>`:'';}
        if(field)field.hidden=!changed.length;
        if(textarea)textarea.required=Boolean(changed.length);
        if(help)help.textContent=changed.length?'Informe obrigatoriamente o motivo da troca antes de salvar.':'Se a equipe permanecer igual à Escala, este campo pode ficar vazio.';
        root.dataset.departureCrewChanged=changed.length?'1':'0';
      };
      ['#dep-driver','#dep-helper-1','#dep-helper-2','#dep-plate'].forEach((selector)=>$(selector,root)?.addEventListener('change',refreshSwap));
      $('#dep-plate',root)?.addEventListener('input',refreshSwap);refreshSwap();
    },
    onConfirm:async(root)=>{
      const reason=$('#dep-delay-reason',root).value;
      const driver=departureSelectedPerson(root,'#dep-driver');
      const helper1=showHelper1?departureSelectedPerson(root,'#dep-helper-1'):{id:'',name:''};
      const helper2=showHelper2?departureSelectedPerson(root,'#dep-helper-2'):{id:'',name:''};
      const swapReason=$('#dep-swap-reason',root).value.trim();
      if(root.dataset.departureCrewChanged==='1'&&!swapReason)throw new Error('Informe a justificativa da troca de motorista/ajudante(s)/placa.');
      await api('/api/departures',{method:'PUT',body:JSON.stringify({id:departureId,requestId:crypto.randomUUID(),data:{...r,id:departureId,schedule_record_id:r.schedule_record_id,escala_id:r.escala_id,status:$('#dep-status',root).value,hora_programada:$('#dep-planned',root).value,hora_real:$('#dep-real',root).value,placa:$('#dep-plate',root).value,motorista_id:driver.id,motorista:driver.name,ajudante_1_id:helper1.id,ajudante_1:helper1.name,ajudante_2_id:helper2.id,ajudante_2:helper2.name,motivo_atraso:reason,responsavel_atraso:departureDelayOwner(reason)||$('#dep-delay-owner',root).value,detalhe_motivo:$('#dep-delay-detail',root).value,justificativa_troca:swapReason,forcar_conflito_equipe:[[driver,original.driver],[helper1,original.helper1],[helper2,original.helper2]].some(([now,was])=>now.occupied&&!departureSamePerson(now,was))}})});
      toast(root.dataset.departureCrewChanged==='1'?'Saída atualizada e troca refletida na Escala.':'Controle de saída atualizado.');
      await renderDepartures();
    }
  });
}

async function renderPending(){
  clearInterval(state.pendingTimer);
  const payload=await api('/api/operational-pending',{fresh:true});
  let rows=payload.records||[];const s=payload.summary||{},ignitionReport=payload.ignitionReport||{rows:[],summary:{}};
  const priorities=[...new Set(rows.map((r)=>r.prioridade).filter(Boolean))];const types=[...new Set(rows.map((r)=>r.tipo).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const ir=ignitionReport.summary||{};
  $('#page-content').innerHTML=`<div class="page-intro"><div><span class="eyebrow">AUDITORIA OPERACIONAL</span><h3>Pendências Operacionais</h3><p>Ocorrências automáticas de GPS. A parada abre ocorrência ao atingir <strong>20 minutos no varejo</strong> e <strong>1 hora nas rotas de Rede</strong>. <strong>Ignição desligada entre 20:00 e 05:00 é monitorada somente para veículos 3/4</strong>. Considera registros a partir de ${formatDate(payload.occurrenceStartDate||'2026-08-21')}.</p><div class="helper-text">A lista atualiza automaticamente a cada minuto. Os alertas nativos podem ser ativados nos computadores de Fernanda e João Victor; ambos recebem todas as novas ocorrências, independentemente da área responsável.</div></div><div class="page-intro-actions"><button class="btn btn-secondary" id="pending-notifications">🔔 ${operationalNotificationsEnabled()?'Alertas Windows ativos':'Ativar alertas Windows'}</button><button class="btn btn-ghost" id="pending-notification-test">🔔 Testar alerta</button><button class="btn btn-ghost" id="pending-refresh">↻ Atualizar</button><button class="btn btn-ghost" id="pending-export">Exportar CSV</button></div></div>
  <div class="cards-grid">${metric('Total',s.total||0,'Pendências sem justificativa','info')}${metric('Críticas',s.critical||0,'Ação imediata','danger')}${metric('Altas',s.high||0,'Prioridade alta','warning')}${metric('Médias',s.medium||0,'Revisar operação','warning')}</div>
  <section class="panel"><div class="panel-header"><div><h3>Ocorrências pendentes</h3><p class="helper-text">Ocorrências automáticas permanecem aqui até a justificativa. A tela apresenta somente os dados da ocorrência e a ação necessária.</p></div><div class="toolbar-group"><input id="pending-search" class="filter-control" placeholder="Rota, placa, motorista ou detalhe"><select id="pending-priority" class="filter-control"><option value="">Todas as prioridades</option>${priorities.map((v)=>`<option>${esc(v)}</option>`).join('')}</select><select id="pending-type" class="filter-control"><option value="">Todos os tipos</option>${types.map((v)=>`<option>${esc(v)}</option>`).join('')}</select></div></div><div class="panel-body"><div class="table-wrap" id="pending-table"></div></div></section>
  <section class="panel"><div class="panel-header"><div><h3>Relatório noturno de ignição · somente 3/4</h3><p class="helper-text">Uma linha por veículo/viagem/noite. O tempo total soma somente os intervalos em que a ignição ficou efetivamente desligada entre 20:00 e 05:00; períodos com a ignição ligada não entram na soma.</p></div><button class="btn btn-ghost" id="pending-ignition-export">CSV ignição 3/4</button></div><div class="panel-body"><div class="cards-grid">${metric('Veículos 3/4',ir.vehicles||0,'Com ignição desligada no período','info')}${metric('Noites consolidadas',ir.nights||ignitionReport.rows?.length||0,`${ir.sessions||0} intervalo(s) · ${ir.active||0} em andamento`,'warning')}${metric('Tempo total desligado',formatMinutes(ir.totalMinutes||0),'Soma dos intervalos noturnos','danger')}</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Noite</th><th>Placa</th><th>Rota</th><th>Motorista</th><th>1º desligamento</th><th>Fim</th><th>Tempo total</th><th>Intervalos</th><th>Situação</th><th>Local(is)</th></tr></thead><tbody>${(ignitionReport.rows||[]).map((r)=>`<tr><td>${formatDate(r.date)}</td><td><strong>${esc(r.plate||'—')}</strong></td><td>${esc(r.route||'—')}</td><td>${esc(r.driver||'—')}</td><td>${esc(formatTime(r.startedAt))}</td><td>${r.active?'—':esc(formatTime(r.endedAt))}</td><td><strong>${esc(formatMinutes(r.durationMinutes||0))}</strong></td><td><strong>${formatNumber(r.intervalCount||0)}</strong><small>${esc((r.intervals||[]).map((x)=>`${formatTime(x.startedAt)}–${x.active?'agora':formatTime(x.endedAt)} (${formatMinutes(x.durationMinutes||0)})`).join(' · ')||'—')}</small></td><td>${badge(r.active?'EM ANDAMENTO':'FINALIZADA')}</td><td>${esc(r.location||'—')}</td></tr>`).join('')||'<tr><td colspan="10" class="muted">Nenhum desligamento noturno consolidado de veículo 3/4 no período.</td></tr>'}</tbody></table></div></div></section>`;
  let visible=[...rows];
  const bindActions=()=>{
    $$('[data-pending-justify]').forEach((button)=>button.onclick=()=>{const r=visible.find((item)=>String(item.key||item.id)===String(button.dataset.pendingJustify));if(!r)return;modal({title:'Justificar ocorrência automática',confirmText:'Salvar justificativa',body:`<div class="info-box"><strong>${esc(r.tipo)}</strong><br>${esc(r.detalhes||'')}<br><strong>Responsável padrão:</strong> ${esc(r.monitorResponsavel||r.responsavel||'Monitoramento')}<br><br><strong>Tempo registrado:</strong> ${esc(formatMinutes(r.related?.stoppedMinutes||0))} · <strong>Situação:</strong> ${r.related?.active?'Em andamento':'Finalizada'}</div><label class="field"><span>Justificativa</span><textarea id="pending-justify-text" placeholder="Explique a causa e/ou tratativa realizada."></textarea><small>A ocorrência deixará de ficar pendente após a justificativa.</small></label>`,onConfirm:async(root)=>{await api('/api/operational-pending',{method:'POST',body:JSON.stringify({key:r.key||r.id,justification:$('#pending-justify-text',root).value,requestId:crypto.randomUUID()})});toast('Ocorrência justificada.');await renderPending();}});});
    $$('[data-pending-delete]').forEach((button)=>button.onclick=()=>{const r=visible.find((item)=>String(item.key||item.id)===String(button.dataset.pendingDelete));if(!r)return;modal({title:'Excluir divergência',confirmText:'Excluir',body:'<div class="danger-box">Exclusão administrativa e auditada. Digite EXCLUIR e justifique.</div><label class="field"><span>Confirmação</span><input id="pending-confirm"></label><label class="field"><span>Justificativa</span><textarea id="pending-why"></textarea></label>',onConfirm:async(root)=>{await api('/api/operational-pending',{method:'DELETE',body:JSON.stringify({...r,confirmation:$('#pending-confirm',root).value,justification:$('#pending-why',root).value})});toast('Divergência removida com auditoria.');await renderPending();}});});
  };
  const draw=()=>{const q=normalize($('#pending-search').value),priority=normalize($('#pending-priority').value),type=normalize($('#pending-type').value);visible=rows.filter((r)=>(!q||normalize(JSON.stringify(r)).includes(q))&&(!priority||normalize(r.prioridade)===priority)&&(!type||normalize(r.tipo)===type));$('#pending-table').innerHTML=visible.length?`<table class="data-table"><thead><tr><th>Prioridade</th><th>Data</th><th>Tipo</th><th>Rota</th><th>Placa</th><th>Motorista</th><th>Responsável</th><th>Situação</th><th>Tempo parado</th><th>Detalhes</th><th>Ação</th></tr></thead><tbody>${visible.map((r)=>`<tr><td>${badge(r.prioridade)}</td><td>${formatDate(r.data)}</td><td>${esc(r.tipo)}</td><td>${esc(r.rota||'—')}</td><td>${esc(r.placa||'—')}</td><td>${esc(r.motorista||'—')}</td><td><strong>${esc(r.monitorResponsavel||r.responsavel||'—')}</strong></td><td>${badge(r.related?.active?'EM ANDAMENTO':'FINALIZADA')}</td><td><strong>${esc(formatMinutes(r.related?.stoppedMinutes||0))}</strong></td><td>${esc(r.detalhes||'')}</td><td><div class="toolbar-group">${r.canJustify!==false?`<button class="btn btn-secondary btn-sm" data-pending-justify="${esc(r.key||r.id)}">Justificar</button>`:''}${normalize(state.user?.role)==='ADMIN'&&r.canDelete!==false?`<button class="btn btn-ghost btn-sm" data-pending-delete="${esc(r.key||r.id)}">Excluir divergência</button>`:''}</div></td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">Nenhuma pendência corresponde aos filtros.</div>';bindActions();};
  draw();$('#pending-search').oninput=draw;$('#pending-priority').onchange=draw;$('#pending-type').onchange=draw;
  $('#pending-notifications').onclick=async()=>{const ok=await enableOperationalNotifications();if(ok){const button=$('#pending-notifications');if(button)button.textContent='🔔 Alertas Windows ativos';}};
  $('#pending-notification-test').onclick=()=>testOperationalNotifications();
  $('#pending-refresh').onclick=renderPending;
  $('#pending-export').onclick=()=>exportCsv(visible.map((r)=>({prioridade:r.prioridade,data:r.data,tipo:r.tipo,rota:r.rota,placa:r.placa,motorista:r.motorista||'',monitor_responsavel:r.monitorResponsavel||r.responsavel||'',situacao:r.related?.active?'EM ANDAMENTO':'FINALIZADA',tempo_parado_min:r.related?.stoppedMinutes||0,detalhes:r.detalhes,status:r.status||'PENDENTE'})),`pendencias_operacionais_${today()}.csv`);
  $('#pending-ignition-export').onclick=()=>exportCsv((ignitionReport.rows||[]).map((r)=>({noite:r.date,placa:r.plate,tipo:r.vehicleType,rota:r.route,motorista:r.driver,primeiro_desligamento:r.startedAt,fim:r.endedAt||'',tempo_total_desligado_min:r.durationMinutes,quantidade_intervalos:r.intervalCount||0,intervalos:(r.intervals||[]).map((x)=>`${formatTime(x.startedAt)}-${x.active?'agora':formatTime(x.endedAt)} (${formatNumber(x.durationMinutes||0)} min)`).join(' | '),situacao:r.active?'EM ANDAMENTO':'FINALIZADA',locais:r.location})),`ignicao_noturna_3_4_${today()}.csv`);
  state.pendingTimer=setInterval(()=>{if(state.currentBase==='route'&&state.route==='route_pending')renderPending().catch((error)=>console.error(error));},60*1000);
}

const MASTER_ENUMS={
  vehicleTypes:['3/4','TOCO','TRUCK','BITRUCK','CARRETA','OUTROS'],
  links:['PRÓPRIO','TERCEIRO'],
  vehicleStatuses:['DISPONÍVEL','EM ROTA','PERNOITE','MANUTENÇÃO','RESERVADO','BLOQUEADO','ANOMALIA','INATIVO'],
  employeeStatuses:['DISPONÍVEL','RESERVADO','EM ROTA','PERNOITE','FOLGA','FÉRIAS','ATESTADO','AFASTADO','TREINAMENTO','BLOQUEADO','DESLIGADO'],
  regions:['AG1','AG2','SRT','PB','AL','RN','CE','BJ','MARANHAO','OUTRA'],
  routeProfiles:['VAREJO','REDE','MISTO','ATACADO'],
};
const masterOptions=(values,selected)=>values.map((value)=>`<option value="${esc(value)}" ${normalize(value)===normalize(selected)?'selected':''}>${esc(value)}</option>`).join('');
const CATALOG_COLUMNS={
  vehicles:[['placa','Placa'],['apelido','Nome'],['tipo','Tipo'],['vinculo','Vínculo'],['capacidade_t','Capacidade (t)'],['status','Status'],['transportadora','Transportadora']],
  routes:[['nome','Rota'],['regiao','Região'],['perfil','Perfil'],['tipo_servico','Tipo de serviço'],['tempo_ida_min','Ida (min)'],['tempo_volta_min','Volta (min)'],['duracao_dias','Duração (dias)']],
};

async function renderCatalog(type){
  const records=type==='vehicles'?((await api('/api/catalogo?type=vehicles&operacional=1')).records||[]):await loadCatalog(type,true);
  const label=type==='vehicles'?'Veículos':'Rotas';
  const columns=CATALOG_COLUMNS[type];
  const colspan=columns.length+2;
  $('#page-content').innerHTML=`<div class="page-intro"><div><span class="eyebrow">CADASTROS · ROTA</span><h3>${label}</h3><p>Cadastro mestre utilizado pela Escala e demais telas da Rota.</p></div><div class="page-intro-actions"><input id="catalog-search" class="filter-control" placeholder="Filtrar ${type==='vehicles'?'placa, tipo ou status':'rota, região ou perfil'}"><button class="btn btn-ghost" id="catalog-export">Exportar CSV</button><button class="btn btn-primary" id="catalog-new">Novo</button></div></div>
  <div class="info-box"><strong>${formatNumber(records.length)} registro(s) ativo(s).</strong> Cadastros desativados são preservados no histórico, mas não aparecem na operação.</div>
  <section class="panel"><div class="panel-body"><div class="table-wrap" id="catalog-table"></div></div></section>`;
  const draw=()=>{const q=normalize($('#catalog-search').value);const list=records.filter((record)=>!q||normalize(JSON.stringify(record)).includes(q));$('#catalog-table').innerHTML=`<table class="data-table"><thead><tr>${columns.map((field)=>`<th>${esc(field[1])}</th>`).join('')}<th>Ativo</th><th>Ações</th></tr></thead><tbody>${list.length?list.map((record)=>`<tr>${columns.map(([key],index)=>`<td>${key==='status'?badge(record.status_operacional||record[key]||'—'):esc(record[key]??'—')}${index===0?recordAuditLine(record):''}</td>`).join('')}<td>${badge(record.ativo?'ATIVO':'INATIVO')}</td><td><button class="btn btn-ghost btn-sm" data-cat-edit="${esc(record.id)}">Editar</button></td></tr>`).join(''):`<tr><td colspan="${colspan}"><div class="empty-state">Nenhum registro corresponde ao filtro.</div></td></tr>`}</tbody></table>`;$$('[data-cat-edit]').forEach((button)=>button.onclick=()=>openCatalogForm(type,records.find((record)=>String(record.id)===String(button.dataset.catEdit))));};
  draw();$('#catalog-search').oninput=draw;
  $('#catalog-export').onclick=()=>exportCsv(records.map(({raw,...record})=>record),`${type}_${today()}.csv`);
  $('#catalog-new').onclick=()=>openCatalogForm(type,null);
}

function openCatalogForm(type,record){
  const isVehicle=type==='vehicles';
  const body=isVehicle?`<div class="form-grid">
    <label class="field"><span>Placa</span><input data-cat-field="placa" required value="${esc(record?.placa||'')}" placeholder="ABC1D23"></label>
    <label class="field"><span>Tipo</span><select data-cat-field="tipo">${masterOptions(MASTER_ENUMS.vehicleTypes,record?.tipo||'3/4')}</select></label>
    <label class="field"><span>Vínculo</span><select data-cat-field="vinculo">${masterOptions(MASTER_ENUMS.links,record?.vinculo||'PRÓPRIO')}</select></label>
    <label class="field"><span>Capacidade (t)</span><input data-cat-field="capacidade_t" inputmode="decimal" value="${esc(record?.capacidade_t??'')}" placeholder="Ex.: 12"></label>
    <label class="field"><span>Status</span><select data-cat-field="status">${masterOptions(MASTER_ENUMS.vehicleStatuses,record?.status||'DISPONÍVEL')}</select></label>
    <label class="field"><span>Local atual</span><input data-cat-field="local_atual" value="${esc(record?.local_atual||'')}" placeholder="Preenchido quando necessário"><small>Com status DISPONÍVEL, o backend limpa este campo automaticamente.</small></label>
    <label class="field"><span>Nome / apelido (aparece na Escala)</span><input data-cat-field="apelido" maxlength="60" value="${esc(record?.apelido||'')}" placeholder="Ex.: T-Cross"></label>
    <label class="field"><span>Motoristas por escala</span><select data-cat-field="max_motoristas"><option value="1" ${Number(record?.max_motoristas||1)<3?'selected':''}>Padrão (1 + carona)</option><option value="3" ${Number(record?.max_motoristas||1)>=3?'selected':''}>Até 3 motoristas</option></select><small class="helper-text">Habilita a equipe com 3 motoristas na Escala para esta placa.</small></label>
    <label class="field span-2"><span>Transportadora</span><input data-cat-field="transportadora" value="${esc(record?.transportadora||'')}"></label>
    <label class="field"><span>Permite rota comercial</span><select data-cat-field="permite_rota_comercial"><option value="1" ${record?.permite_rota_comercial!==0&&record?.permite_rota_comercial!=='0'?'selected':''}>Sim</option><option value="0" ${record?.permite_rota_comercial===0||record?.permite_rota_comercial==='0'?'selected':''}>Não</option></select></label>
    <label class="field"><span>Motivo da reserva</span><input data-cat-field="motivo_reserva" value="${esc(record?.motivo_reserva||'')}"></label>
    <label class="field"><span>Data da reserva</span><input data-cat-field="data_reserva" type="date" value="${esc(String(record?.data_reserva||'').slice(0,10))}"></label>
    <label class="field"><span>Previsão pronto/manutenção</span><input data-cat-field="previsao_pronto_manutencao" type="datetime-local" value="${esc(String(record?.previsao_pronto_manutencao||'').replace(' ','T').slice(0,16))}"></label>
    <label class="field span-2"><span>Observações</span><textarea data-cat-field="observacoes">${esc(record?.observacoes||'')}</textarea></label>
    <label class="field"><span>Ativo</span><select data-cat-field="ativo"><option value="1" ${record?.ativo!==false?'selected':''}>Sim</option><option value="0" ${record?.ativo===false?'selected':''}>Não</option></select></label>
  </div>`:`<div class="info-box" style="margin-bottom:16px">O tempo por entrega é fixo. A multiplicação pela quantidade de entregas ocorre no Monitoramento.</div><div class="form-grid">
    <label class="field span-2"><span>Rota</span><input data-cat-field="nome" required value="${esc(record?.nome||record?.rota||'')}" placeholder="Ex.: AG1 CARUARU"></label>
    <label class="field" data-delivery-only><span>Região</span><select data-cat-field="regiao">${masterOptions(MASTER_ENUMS.regions,record?.regiao||'AG1')}</select></label>
    <label class="field" data-delivery-only><span>Perfil</span><select data-cat-field="perfil">${masterOptions(MASTER_ENUMS.routeProfiles,record?.perfil||'VAREJO')}</select></label>
    <label class="field span-2"><span>Tipo de serviço</span><select data-cat-field="tipo_servico">${[['ENTREGA','Entrega (padrão)'],['ADMINISTRATIVO','Serviço administrativo'],['OUTROS','Outros']].map(([value,label])=>`<option value="${value}" ${normalize(record?.tipo_servico||'ENTREGA')===value?'selected':''}>${label}</option>`).join('')}</select><small class="helper-text">Serviço administrativo e Outros não exigem placa nem ajudante na Escala e pagam CAJU pela própria escala.</small></label>
    <label class="field" data-delivery-only><span>Tempo ida (min)</span><input data-cat-field="tempo_ida_min" inputmode="text" value="${esc(record?.tempo_ida_min??0)}" placeholder="83 ou 1h23"></label>
    <label class="field" data-delivery-only><span>Entre cidades (min)</span><input data-cat-field="tempo_entre_cidades_min" inputmode="text" value="${esc(record?.tempo_entre_cidades_min??0)}" placeholder="30 ou 0h30"></label>
    <label class="field" data-delivery-only><span>Tempo volta (min)</span><input data-cat-field="tempo_volta_min" inputmode="text" value="${esc(record?.tempo_volta_min??0)}" placeholder="83 ou 1h23"></label>
    <label class="field" data-delivery-only><span>Tempo/entrega (min)</span><input data-cat-field="tempo_por_entrega_min" inputmode="text" value="${esc(record?.tempo_por_entrega_min??0)}" placeholder="30"></label>
    <label class="field" data-delivery-only><span>Duração (dias)</span><input data-cat-field="duracao_dias" type="number" min="1" value="${esc(record?.duracao_dias??1)}"></label>
    <label class="field" data-delivery-only><span>Dias da semana</span><input data-cat-field="dias_semana" value="${esc(record?.dias_semana||'SEG,TER,QUA,QUI,SEX,SAB')}"></label>
    <label class="field span-2"><span>Observações</span><textarea data-cat-field="observacoes">${esc(record?.observacoes||'')}</textarea></label>
    <label class="field"><span>Ativo</span><select data-cat-field="ativo"><option value="1" ${record?.ativo!==false?'selected':''}>Sim</option><option value="0" ${record?.ativo===false?'selected':''}>Não</option></select></label>
  </div>`;

  const syncRouteServiceFields=(scope)=>{const sel=$('[data-cat-field="tipo_servico"]',scope);if(!sel)return;const admin=sel.value!=='ENTREGA';$$('[data-delivery-only]',scope).forEach((el)=>{el.style.display=admin?'none':''});};
  const root=modal({title:`${record?'Editar':'Novo'} ${isVehicle?'veículo':'rota'}`,confirmText:'Salvar',body,onConfirm:async(modalRoot)=>{
    const payload={};
    $$('[data-cat-field]',modalRoot).forEach((input)=>payload[input.dataset.catField]=input.value);
    if(record)payload.id=record.id;
    await api(`/api/catalogo?type=${type}`,{method:record?'PUT':'POST',body:JSON.stringify(payload)});
    state.catalog.delete(type);
    toast(isVehicle?'Veículo salvo e disponibilizado no cadastro.':'Rota salva no cadastro.');
    await renderCatalog(type);
  }});
  if(!isVehicle){const sel=$('[data-cat-field="tipo_servico"]',root);if(sel){sel.addEventListener('change',()=>syncRouteServiceFields(root));syncRouteServiceFields(root);}}
  if(isVehicle){
    const status=$('[data-cat-field="status"]',root);
    const location=$('[data-cat-field="local_atual"]',root);
    const syncLocation=()=>{if(normalize(status.value)==='DISPONIVEL')location.value='';};
    status.addEventListener('change',syncLocation);syncLocation();
  }
}

async function renderEmployees(kind){
  const isDriver=kind==='MOTORISTA';
  const payload=await api(`/api/colaboradores?funcao=${encodeURIComponent(kind)}&operacional=1`);
  const records=payload.records||payload.colaboradores||[];
  const columns=isDriver
    ?[['matricula','Matrícula'],['nome','Nome'],['telefone','Telefone'],['vinculo','Vínculo'],['status','Status'],['restricao_motorista','Restrição'],['ferias_inicio','Férias início'],['ferias_fim','Férias fim']]
    :[['matricula','Matrícula'],['nome','Nome'],['telefone','Telefone'],['vinculo','Vínculo'],['status','Status'],['ajudante_rota','Ajudante de rota'],['rotas_atendidas','Rotas atendidas'],['restricao_ajudante','Restrição'],['cidade_rota','Cidade da rota']];
  $('#page-content').innerHTML=`<div class="page-intro"><div><span class="eyebrow">CADASTROS · ROTA</span><h3>${isDriver?'Motoristas':'Ajudantes'}</h3><p>Colaboradores ativos utilizados na Escala.</p></div><div class="page-intro-actions"><input id="employee-search" class="filter-control" placeholder="Nome, matrícula, telefone, vínculo ou status"><button class="btn btn-ghost" id="employee-export">Exportar CSV</button><button class="btn btn-primary" id="employee-new">Novo</button></div></div>
  <div class="info-box"><strong>${formatNumber(records.length)} registro(s) ativo(s).</strong> Para colaboradores próprios, a matrícula é obrigatória; para terceiros, é opcional.</div>
  <section class="panel"><div class="panel-body"><div class="table-wrap" id="employee-table"></div></div></section>`;
  const draw=()=>{const q=normalize($('#employee-search').value);const list=records.filter((record)=>!q||normalize(JSON.stringify(record)).includes(q));$('#employee-table').innerHTML=`<table class="data-table"><thead><tr>${columns.map(([,label])=>`<th>${esc(label)}</th>`).join('')}<th>Ações</th></tr></thead><tbody>${list.length?list.map((record)=>`<tr>${columns.map(([field],index)=>`<td>${field==='status'?badge(record.status_operacional||record[field]||'—'):field==='ajudante_rota'||field==='restricao_motorista'||field==='restricao_ajudante'?badge(record[field]?'SIM':'NÃO'):field.startsWith('ferias_')?formatDate(record[field]):esc(record[field]??'—')}${index===0?recordAuditLine(record):''}</td>`).join('')}<td><button class="btn btn-ghost btn-sm" data-emp-edit="${esc(record.id)}">Editar</button></td></tr>`).join(''):`<tr><td colspan="${columns.length+1}"><div class="empty-state">Nenhum colaborador corresponde ao filtro.</div></td></tr>`}</tbody></table>`;$$('[data-emp-edit]').forEach((button)=>button.onclick=()=>openEmployeeForm(records.find((record)=>String(record.id)===String(button.dataset.empEdit)),kind));};
  draw();$('#employee-search').oninput=draw;
  $('#employee-export').onclick=()=>exportCsv(records.map(({raw,...record})=>record),`${isDriver?'motoristas':'ajudantes'}_${today()}.csv`);
  $('#employee-new').onclick=()=>openEmployeeForm(null,kind);
}

function openEmployeeForm(record,kind){
  const isDriver=kind==='MOTORISTA';
  const allowedStatuses=isDriver?MASTER_ENUMS.employeeStatuses:MASTER_ENUMS.employeeStatuses.filter((status)=>normalize(status)!=='RESERVADO');
  const root=modal({title:`${record?'Editar':'Novo'} ${isDriver?'motorista':'ajudante'}`,confirmText:'Salvar colaborador',body:`<div class="form-grid">
    <label class="field"><span>Matrícula</span><input data-emp-field="matricula" value="${esc(record?.matricula||'')}"><small>Obrigatória para próprios; opcional para terceiros.</small></label>
    <label class="field"><span>Nome</span><input data-emp-field="nome" required value="${esc(record?.nome||'')}"></label>
    <label class="field"><span>Telefone</span><input data-emp-field="telefone" type="tel" maxlength="40" autocomplete="tel" value="${esc(record?.telefone||'')}" placeholder="Ex.: (81) 99999-9999"><small>Telefone de contato do motorista/ajudante.</small></label>
    <label class="field"><span>Função</span><input value="${esc(kind)}" disabled><small>A função é definida pela tela atual.</small></label>
    <label class="field"><span>Vínculo</span><select data-emp-field="vinculo">${masterOptions(MASTER_ENUMS.links,record?.vinculo||'PRÓPRIO')}</select></label>
    <label class="field"><span>Status</span><select data-emp-field="status">${masterOptions(allowedStatuses,record?.status||'DISPONÍVEL')}</select></label>
    ${isDriver?`<label class="field"><span>Possui restrição?</span><select data-emp-field="restricao_motorista"><option value="0" ${!record?.restricao_motorista?'selected':''}>Não</option><option value="1" ${record?.restricao_motorista?'selected':''}>Sim</option></select><small>Motorista com restrição só pode ser escalado em Carga Fechada.</small></label>`:''}
    <label class="field"><span>Férias início</span><input data-emp-field="ferias_inicio" type="date" value="${esc(String(record?.ferias_inicio||'').slice(0,10))}"></label>
    <label class="field"><span>Férias fim</span><input data-emp-field="ferias_fim" type="date" value="${esc(String(record?.ferias_fim||'').slice(0,10))}"></label>
    ${!isDriver?`<label class="field"><span>Ajudante de rota</span><select data-emp-field="ajudante_rota"><option value="0" ${!record?.ajudante_rota?'selected':''}>Não</option><option value="1" ${record?.ajudante_rota?'selected':''}>Sim</option></select><small>Quando marcado, só entra como apoio nas rotas cadastradas abaixo.</small></label><label class="field"><span>Possui restrição?</span><select data-emp-field="restricao_ajudante"><option value="0" ${!record?.restricao_ajudante?'selected':''}>Não</option><option value="1" ${record?.restricao_ajudante?'selected':''}>Sim</option></select><small>Ajudante com restrição só pode ser escalado em rotas de Redes.</small></label><label class="field"><span>Cidade da rota</span><input data-emp-field="cidade_rota" value="${esc(record?.cidade_rota||'')}"></label><label class="field span-2"><span>Rotas atendidas</span><textarea data-emp-field="rotas_atendidas" placeholder="Ex.: AG1 CARUARU; AG2 GARANHUNS">${esc(record?.rotas_atendidas||'')}</textarea><small>Obrigatório para Ajudante de rota. Separe as rotas por ponto e vírgula, vírgula ou uma rota por linha.</small></label>`:''}
    <label class="field span-2"><span>Observações</span><textarea data-emp-field="observacoes">${esc(record?.observacoes||'')}</textarea></label>
    <label class="field"><span>Ativo</span><select data-emp-field="ativo"><option value="1" ${record?.ativo!==false?'selected':''}>Sim</option><option value="0" ${record?.ativo===false?'selected':''}>Não</option></select></label>
  </div>`,onConfirm:async(modalRoot)=>{
    const payload={funcao:kind};
    $$('[data-emp-field]',modalRoot).forEach((input)=>payload[input.dataset.empField]=input.value);
    if(record)payload.id=record.id;
    const saved=await api('/api/colaboradores',{method:record?'PUT':'POST',body:JSON.stringify(payload)});
    const restrictionField=isDriver?'restricao_motorista':'restricao_ajudante';
    const expectedRestriction=String(payload[restrictionField]??'0')==='1';
    const persistedRestriction=Boolean(saved?.record?.[restrictionField]);
    if(expectedRestriction!==persistedRestriction)throw new Error('A alteração de restrição não foi persistida no banco. Atualize a página e tente novamente.');
    state.catalog.delete('employees');state.catalog.delete('collaborators');
    toast('Colaborador salvo e atualizado na operação.');
    await renderEmployees(kind);
  }});
  const registration=$('[data-emp-field="matricula"]',root);
  const link=$('[data-emp-field="vinculo"]',root);
  const syncRegistration=()=>{const own=normalize(link.value)==='PROPRIO';registration.required=own;registration.placeholder=own?'Matrícula obrigatória':'Opcional para terceiro';};
  link.addEventListener('change',syncRegistration);syncRegistration();
}

async function renderUsers(){
  if(normalize(state.user?.role)!=='ADMIN')throw new Error('Somente administradores podem gerenciar usuários.');const payload=await api('/api/auth/users');const users=payload.users||[];
  $('#page-content').innerHTML=`<div class="page-intro"><div><span class="eyebrow">ADMINISTRAÇÃO</span><h3>Usuários</h3><p>Acesso exclusivamente ao módulo Rota.</p></div><div class="page-intro-actions"><input id="user-search" class="filter-control" placeholder="Nome, matrícula, e-mail ou perfil"><button class="btn btn-primary" id="user-new">Novo usuário</button></div></div><section class="panel"><div class="panel-body"><div class="table-wrap" id="user-table"></div></div></section>`;
  const draw=()=>{const q=normalize($('#user-search').value);const list=users.filter((u)=>!q||normalize(JSON.stringify(u)).includes(q));$('#user-table').innerHTML=`<table class="data-table"><thead><tr><th>Nome</th><th>Matrícula</th><th>E-mail</th><th>Perfil</th><th>Status</th><th></th></tr></thead><tbody>${list.length?list.map((u)=>`<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.matricula||'—')}</td><td>${esc(u.email||'—')}</td><td>${badge(u.role)}</td><td>${badge(u.active?'ATIVO':'INATIVO')}</td><td><button class="btn btn-ghost btn-sm" data-user-edit="${esc(u.id)}">Editar</button></td></tr>`).join(''):'<tr><td colspan="6"><div class="empty-state">Nenhum usuário corresponde ao filtro.</div></td></tr>'}</tbody></table>`;$$('[data-user-edit]').forEach((b)=>b.onclick=()=>openUserForm(users.find((u)=>String(u.id)===String(b.dataset.userEdit))));};draw();$('#user-search').oninput=draw;
  $('#user-new').onclick=()=>openUserForm(null);
}

function openUserForm(user){modal({title:user?'Editar usuário':'Novo usuário',confirmText:'Salvar usuário',body:`<div class="form-grid"><label class="field"><span>Nome</span><input data-user-field="name" required value="${esc(user?.name||'')}"></label><label class="field"><span>Matrícula</span><input data-user-field="matricula" value="${esc(user?.matricula||'')}"><small>Informe matrícula ou e-mail.</small></label><label class="field"><span>E-mail</span><input data-user-field="email" type="email" value="${esc(user?.email||'')}"></label><label class="field"><span>Cargo</span><input data-user-field="cargo" value="${esc(user?.cargo||'')}"></label><label class="field"><span>Perfil</span><select data-user-field="role">${['ADMIN','OPERADOR','CONSULTA'].map((r)=>`<option ${normalize(user?.role||'CONSULTA')===r?'selected':''}>${r}</option>`).join('')}</select></label><label class="field"><span>Ativo</span><select data-user-field="active"><option value="1" ${user?.active!==false?'selected':''}>Sim</option><option value="0" ${user?.active===false?'selected':''}>Não</option></select></label><label class="field span-2"><span>${user?'Nova senha temporária (opcional)':'Senha temporária'}</span><input data-user-field="password" type="password" ${user?'':'required'}><small>Maiúscula, minúscula, número e símbolo.</small></label></div>`,onConfirm:async(root)=>{const body={bases:['route'],permissions:[]};$$('[data-user-field]',root).forEach((x)=>body[x.dataset.userField]=x.dataset.userField==='active'?x.value==='1':x.value);if(user)body.id=user.id;await api('/api/auth/users',{method:user?'PUT':'POST',body:JSON.stringify(body)});toast('Usuário salvo.');await renderUsers();}});}

function openChangePassword(){modal({title:'Trocar senha',confirmText:'Alterar senha',body:`<div class="form-stack"><label class="field"><span>Senha atual</span><input id="pwd-current" type="password"></label><label class="field"><span>Nova senha</span><input id="pwd-new" type="password"></label><label class="field"><span>Confirmar nova senha</span><input id="pwd-confirm" type="password"></label></div>`,onConfirm:async(root)=>{await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:$('#pwd-current',root).value,newPassword:$('#pwd-new',root).value,confirmPassword:$('#pwd-confirm',root).value})});toast('Senha alterada. Entre novamente.');clearSession();showAuth();}});}

async function start(){
  setTheme(localStorage.getItem('natto_dms_rota_theme')||'light');$$('[data-theme-toggle]').forEach((button)=>button.onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));$$('[data-password-toggle]').forEach((button)=>button.onclick=()=>{const input=document.getElementById(button.dataset.passwordToggle);if(!input)return;input.type=input.type==='password'?'text':'password';button.textContent=input.type==='password'?'Exibir':'Ocultar';});
  const applySidebarState=(collapsed)=>{
    const shell=$('#system-view');
    shell?.classList.toggle('is-sidebar-collapsed',Boolean(collapsed));
    const toggle=$('#sidebar-collapse-toggle');
    if(toggle){toggle.innerHTML=`<i data-lucide="${collapsed?'panel-left-open':'panel-left-close'}"></i>`;toggle.setAttribute('aria-label',collapsed?'Expandir menu':'Recolher menu');}
    localStorage.setItem('natto_dms_rota_sidebar_collapsed',collapsed?'1':'0');
    refreshIcons();
  };
  applySidebarState(localStorage.getItem('natto_dms_rota_sidebar_collapsed')==='1');
  $('#menu-toggle').onclick=()=>{$('#sidebar').classList.add('is-open');$('#sidebar-backdrop').classList.add('is-visible');};
  $('#sidebar-backdrop').onclick=()=>{$('#sidebar').classList.remove('is-open');$('#sidebar-backdrop').classList.remove('is-visible');};
  $('#sidebar-collapse-toggle').onclick=()=>applySidebarState(!$('#system-view')?.classList.contains('is-sidebar-collapsed'));
  $('#refresh-button').onclick=()=>navigate(state.route);$('#change-password-button').onclick=()=>navigate('route_profile');$('.user-compact')?.addEventListener('click',()=>navigate('route_profile'));
  $('#logout-button').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST'});}catch{}clearSession();showAuth();};
  $('#login-form').onsubmit=async(event)=>{event.preventDefault();$('#auth-message').textContent='';showLoading('Entrando','Validando credenciais...');try{const payload=await api('/api/auth/login',{method:'POST',body:JSON.stringify({usuario:$('#login-identity').value,password:$('#login-password').value})});state.token=payload.token;state.user=payload.user;sessionStorage.setItem('natto_dms_rota_token',state.token);if(state.user.mustChangePassword){showSystem();openChangePassword();}else{showSystem();await navigate('route_summary');}}catch(error){$('#auth-message').textContent=error.message;}finally{hideLoading();}};
  $('#setup-form').onsubmit=async(event)=>{event.preventDefault();showLoading('Criando administrador','Preparando o acesso inicial...');try{const payload=await api('/api/auth/setup',{method:'POST',body:JSON.stringify({name:$('#setup-name').value,email:$('#setup-email').value,matricula:$('#setup-matricula').value,password:$('#setup-password').value})});state.token=payload.token;state.user=payload.user;sessionStorage.setItem('natto_dms_rota_token',state.token);showSystem();await navigate('route_summary');}catch(error){$('#auth-message').textContent=error.message;}finally{hideLoading();}};
  try{const status=await api('/api/auth/status');$('#setup-form').classList.toggle('is-hidden',!status.needsSetup);$('#login-form').classList.toggle('is-hidden',status.needsSetup);if(state.token&&status.user){state.user=status.user;showSystem();await navigate(state.route);}else showAuth();}catch(error){showAuth();$('#auth-message').textContent=error.message;}
}

document.addEventListener('DOMContentLoaded',start);

window.addEventListener('load',()=>refreshIcons());
