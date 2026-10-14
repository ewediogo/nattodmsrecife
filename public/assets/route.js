/* NATTO DMS · Versão 1 - DMS ROTA
 * Port funcional da base Rota auditada contra a v2.0.44.
 * Frontend exclusivo do módulo Rota.
 */
window.NATTO_DMS_ROTA = (() => {
  const canWrite = () => normalize(state.user?.role) !== 'CONSULTA';
  const isAdmin = () => normalize(state.user?.role) === 'ADMIN';
  const dt = (value) => value ? `${formatDate(value)} ${formatTime(value)}` : '—';
  const dateTimeLocalValue = (value) => {
    const raw=String(value||'').trim();if(!raw)return '';
    let match=raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}:\d{2})/);
    if(match)return `${match[1]}T${String(match[2]).padStart(5,'0')}`;
    match=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})[T\s](\d{1,2}:\d{2})/);
    if(match)return `${match[3]}-${match[2]}-${match[1]}T${String(match[4]).padStart(5,'0')}`;
    const parsed=new Date(raw);if(Number.isFinite(parsed.getTime())){const local=new Date(parsed.getTime()-parsed.getTimezoneOffset()*60000);return local.toISOString().slice(0,16);}
    return '';
  };
  const auditDt = (value) => {
    const raw=String(value||'').trim();if(!raw)return '—';
    if(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)){
      const parsed=new Date(raw);
      if(Number.isFinite(parsed.getTime())){
        try{return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Recife',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(parsed).replace(',','');}catch{}
      }
    }
    return dt(raw);
  };
  const statusDisplay = (item={}) => {
    if (/MANUTEN/.test(normalize(item.baseStatus || item.raw?.STATUS))) return 'MANUTENÇÃO';
    if (item.origin === 'ESCALA' && normalize(item.status) === 'INDISPONÍVEL') return 'ESCALADO';
    return item.status || 'DISPONÍVEL';
  };
  const resourceTraceLine = (item={}) => {
    const catalogAt=item.raw?.ATUALIZADO_EM||'';
    const operationalAt=item.effectiveAt||'';
    const catalogMs=Date.parse(catalogAt||''), operationalMs=Date.parse(operationalAt||'');
    const hasOperational=operationalAt&&item.origin&&item.origin!=='CADASTRO'&&item.origin!=='CALCULADO'&&(!Number.isFinite(catalogMs)||!Number.isFinite(operationalMs)||operationalMs>=catalogMs);
    if(hasOperational){
      if(item.origin==='MANUAL')return `<small class="record-audit-line"><strong>ÚLTIMA EDIÇÃO MANUAL:</strong> ${esc(item.updatedBy||item.detail||'Operação')} · ${esc(dt(operationalAt))}</small>`;
      return `<small class="record-audit-line"><strong>ÚLTIMA ATUALIZAÇÃO:</strong> ${esc(item.origin||'SISTEMA')} · ${esc(dt(operationalAt))}</small>`;
    }
    if(catalogAt){const actor=item.raw?.ATUALIZADO_POR||item.raw?.USUARIO||'Sistema';const automatic=/SISTEMA|GPS|PROTECT|IMPORT|AUTOMATIC/.test(normalize(actor));return `<small class="record-audit-line"><strong>${automatic?'ÚLTIMA ATUALIZAÇÃO':'ÚLTIMA EDIÇÃO MANUAL'}:</strong> ${esc(actor)} · ${esc(dt(catalogAt))}</small>`;}
    return '';
  };
  const returnChangeAudit=(record={})=>{
    const actor=String(record.ultima_alteracao_por||record.ultima_edicao_por||record.updatedByName||'').trim();
    const at=record.ultima_alteracao_em||record.ultima_edicao_em||record.updatedAt||'';
    const source=String(record.ultima_alteracao_origem||record.origem||'').trim();
    const explicit=normalize(record.ultima_alteracao_tipo||'');
    const actorKey=normalize(actor);
    let type=explicit;
    if(!['AUTOMATICA','USUARIO','NAO_IDENTIFICADA'].includes(type)){
      if(Number(record.updatedById||0)>0)type='USUARIO';
      else if(/AUTOMACAO|SISTEMA|GPS|PROTECTSAT|NATTO ENTREGAS|SERVICE|INTEGRACAO/.test(actorKey)||['GPS','APP','PROTECTSAT'].includes(normalize(source)))type='AUTOMATICA';
      else if(actor)type='USUARIO';
      else type='NAO_IDENTIFICADA';
    }
    const automatic=type==='AUTOMATICA';
    const user=type==='USUARIO';
    const label=automatic?'AUTOMÁTICA':user?'USUÁRIO':'NÃO IDENTIFICADA';
    const displayActor=actor||(automatic?'Sistema':'Responsável não identificado');
    const displaySource=source||(automatic?'SISTEMA':user?'EDIÇÃO MANUAL':'REGISTRO LEGADO');
    return {type,label,automatic,user,actor:displayActor,source:displaySource,at};
  };
  const returnChangeBadge=(audit)=>`<span class="badge ${audit.automatic?'badge-warning':audit.user?'badge-success':'badge-info'}">${esc(audit.label)}</span>`;
  const returnChangeCell=(record={})=>{const a=returnChangeAudit(record);return `<div class="return-change-cell">${returnChangeBadge(a)}<strong>${esc(a.actor)}</strong><small class="muted">${esc(a.source)}${a.at?` · ${esc(auditDt(a.at))}`:''}</small></div>`;};
  const returnManualEditAudit=(record={})=>{
    const actor=String(record.ultima_edicao_por||'').trim();const actorKey=normalize(actor);
    const valid=Boolean(actor)&&!/AUTOMACAO|SISTEMA|GPS|PROTECTSAT|NATTO ENTREGAS|SERVICE|INTEGRACAO/.test(actorKey);
    return {valid,actor:valid?actor:'Nenhuma edição manual identificada',at:valid?(record.ultima_edicao_em||''):''};
  };
  const returnAutomaticEditAudit=(record={})=>{
    const latest=returnChangeAudit(record);
    const actor=String(record.ultima_atualizacao_automatica_por||(latest.automatic?latest.actor:'')).trim();
    const at=record.ultima_atualizacao_automatica_em||(latest.automatic?latest.at:'');
    const source=String(record.ultima_atualizacao_automatica_origem||(latest.automatic?latest.source:'')).trim();
    return {valid:Boolean(actor||at),actor:actor||'Sistema',at,source:source||'SISTEMA'};
  };
  const returnManualCell=(record={})=>{const a=returnManualEditAudit(record);return a.valid?`<div class="return-change-cell"><span class="badge badge-success">USUÁRIO</span><strong>${esc(a.actor)}</strong><small class="muted">${esc(auditDt(a.at))}</small></div>`:'<span class="muted">Sem edição manual identificada</span>';};
  const returnAutomaticCell=(record={})=>{const a=returnAutomaticEditAudit(record);return a.valid?`<div class="return-change-cell"><span class="badge badge-warning">AUTOMÁTICA</span><strong>${esc(a.source)}</strong><small class="muted">${esc(a.actor)}${a.at?` · ${esc(auditDt(a.at))}`:''}</small></div>`:'<span class="muted">Sem atualização automática</span>';};
  const returnHistoryDeliveryStats=(record={})=>{const l=record?.lincros||null,healthy=l?.syncHealthy===true;const planned=Math.max(0,Number(healthy?l.deliveriesPlanned:(record.entregas_previstas??record.qtd_entregas??0))||0),done=Math.max(0,Number(healthy?l.deliveriesDone:(record.entregas_realizadas??record.entregas??0))||0);return {healthy,planned,done,pending:Math.max(0,planned-done)};};
  const returnHistoryDeliveryText=(record={})=>{const x=returnHistoryDeliveryStats(record);return x.planned>0?`${formatNumber(x.done)} / ${formatNumber(x.planned)}`:formatNumber(x.done);};
  const applyReturnHistoryLincrosResult=(record,item,root=null)=>{if(!record||!item||item.syncHealthy!==true)return false;record.lincros=item;record.entregas_previstas=Math.max(0,Number(item.deliveriesPlanned||0)||0);record.entregas_realizadas=Math.max(0,Number(item.deliveriesDone||0)||0);record.entregas_pendentes=Math.max(0,record.entregas_previstas-record.entregas_realizadas);record.qtd_entregas=record.entregas_previstas;record.entregas=record.entregas_realizadas;record.fonte_entregas='LINCROS';const stats=returnHistoryDeliveryStats(record),delivery=root? $('[data-return-history-detail-deliveries]',root):null,pending=root? $('[data-return-history-detail-pending]',root):null,source=root? $('[data-return-history-detail-source]',root):null;if(delivery?.isConnected)delivery.textContent=`${formatNumber(stats.done)} / ${formatNumber(stats.planned)}`;if(pending?.isConnected)pending.textContent=formatNumber(stats.pending);if(source?.isConnected)source.textContent=`Lincros${item.checkedAt?` · ${auditDt(item.checkedAt)}`:''}`;return true;};
  const returnChangeBanner=(record={})=>{const latest=returnChangeAudit(record),manual=returnManualEditAudit(record),auto=returnAutomaticEditAudit(record);return `<div class="return-change-banner ${latest.automatic?'is-automatic':latest.user?'is-user':'is-unknown'}"><span class="return-change-banner-label">Rastreabilidade da viagem</span><div class="return-change-banner-main">${returnChangeBadge(latest)}<strong>Última alteração: ${esc(latest.actor)}</strong></div><small>${esc(latest.source)}${latest.at?` · ${esc(auditDt(latest.at))}`:''}</small><div class="return-change-trace"><div><span>Última edição por usuário</span><strong>${esc(manual.actor)}</strong>${manual.at?`<small>${esc(auditDt(manual.at))}</small>`:''}</div><div><span>Última atualização automática</span><strong>${auto.valid?esc(auto.source):'Nenhuma'}</strong>${auto.valid?`<small>${esc(auto.actor)}${auto.at?` · ${esc(auditDt(auto.at))}`:''}</small>`:''}</div></div></div>`;};
  const option = (value,label,selected) => `<option value="${esc(value ?? '')}" ${String(value ?? '')===String(selected ?? '')?'selected':''}>${esc(label ?? value ?? '')}</option>`;
  const teamLabel = (value) => ({TERCEIRO:'TERCEIRO',CARGA_FECHADA:'CARGA FECHADA',UM_AJUDANTE:'1 AJUDANTE',DOIS_AJUDANTES:'2 AJUDANTES',SEM_AJUDANTE:'SEM AJUDANTE',DOIS_MOTORISTAS:'COM 2º MOTORISTA',TRES_MOTORISTAS:'3 MOTORISTAS'})[value] || String(value||'').replaceAll('_',' ');
  const matrixTypes = ['3/4','TOCO','TRUCK','BITRUCK'];
  const matrixCard = (label,data,tone='info',secondary=null) => {
    data=data||{total:0,proprio:0,terceiro:0,types:{}};
    const rows=matrixTypes.filter((type)=>Number(data.types?.[type]?.total||0)>0).map((type)=>{
      const row=data.types[type]||{};
      return `<tr><td><strong>${esc(type)}</strong></td><td>${formatNumber(row.total||0)}</td><td class="muted">${formatNumber(row.proprio||0)} P · ${formatNumber(row.terceiro||0)} T</td></tr>`;
    }).join('');
    return `<article class="panel"><div class="panel-header"><div><span class="eyebrow">${esc(label)}</span><h3>${formatNumber(data.total||0)}</h3>${secondary?`<small class="fleet-matrix-secondary">${esc(secondary.label)}: <strong>${formatNumber(secondary.value||0)}</strong></small>`:''}</div><div><strong>${formatNumber(data.proprio||0)}</strong><small class="muted"> Próprio</small><br><strong>${formatNumber(data.terceiro||0)}</strong><small class="muted"> Terceiro</small></div></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><tbody>${rows||'<tr><td class="muted">Sem veículos nesta situação.</td></tr>'}</tbody></table></div></div></article>`;
  };

  async function renderDashboard(start=null,end=null,{fresh=false}={}) {
    const selectedStart=start || state.routeDashboardStart || today();
    const selectedEnd=end || state.routeDashboardEnd || selectedStart;
    state.routeDashboardStart=selectedStart; state.routeDashboardEnd=selectedEnd;
    const dashboardUrl=`/api/route-dashboard?start=${encodeURIComponent(selectedStart)}&end=${encodeURIComponent(selectedEnd)}${fresh?'&refresh=1':''}`;
    const persistentKey=`natto_route_dashboard_cache_${selectedStart}_${selectedEnd}`;
    let data=null,degraded=false,degradedAt='';
    try {
      data=await api(dashboardUrl,{fresh});
      const compact={...data};delete compact.records;
      try{localStorage.setItem(persistentKey,JSON.stringify({at:Date.now(),data:compact}));}catch{}
    } catch(error) {
      try {
        const cached=JSON.parse(localStorage.getItem(persistentKey)||'null');
        if(cached?.data && Date.now()-Number(cached.at||0)<=6*60*60*1000){data=cached.data;degraded=true;degradedAt=new Date(Number(cached.at||0)).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});setConnection(false,'Instável · último dado');}
      } catch {}
      if(!data)throw error;
    }
    const dep=data.departures||{}, fleet=data.fleetStatus||{}, people=data.people||{}, prod=data.productivity||{}, overview=data.fleetOverview||{};
    $('#page-content').innerHTML=`
      <div class="page-intro"><div><span class="eyebrow">OPERAÇÃO · VERSÃO 1 - DMS ROTA</span><h3>Visão Geral</h3><p>Consolidação real de Escala → Saídas → Monitoramento → Retornos.</p></div><div class="page-intro-actions"><label class="toolbar-field"><span>Início</span><input id="route-dashboard-start" class="filter-control" type="date" value="${esc(selectedStart)}"></label><label class="toolbar-field"><span>Fim</span><input id="route-dashboard-end" class="filter-control" type="date" value="${esc(selectedEnd)}"></label><button class="btn btn-ghost" id="route-dashboard-export">CSV</button><button class="btn btn-ghost" id="route-dashboard-refresh">↻ Atualizar</button></div></div>${degraded?`<div class="info-box"><strong>Modo contingência:</strong> o servidor ficou temporariamente indisponível. Mantive o último resumo válido${degradedAt?` carregado às ${esc(degradedAt)}`:''}. Use Atualizar para tentar sincronizar novamente.</div>`:''}
      <section><div class="panel-header"><div><h3>Saídas do período</h3><p class="helper-text">Programação, realização e pontualidade.</p></div></div><div class="cards-grid">${metric('Rotas programadas',dep.programmed||0,'No período selecionado','info')}${metric('Saídas realizadas',dep.realized||0,'Veículos que deixaram a empresa','success')}${metric('Saídas pendentes',dep.pending||0,'Aguardando confirmação','success')}${metric('Saídas atrasadas',dep.delayed||0,`Acima da tolerância de ${data.toleranceMinutes||30} min`,'danger')}</div></section>
      <section><div class="panel-header"><div><h3>Situação atual da frota</h3><p class="helper-text">Posição consolidada da frota terceirizada.</p></div></div><div class="cards-grid">${metric('Escalados',fleet.scheduled||0,'Aguardando ou ocupando escala','info')}${metric('Em rota',fleet.inRoute||0,'Operação em andamento','info')}${metric('Pernoite',fleet.overnight||0,'Rotas ainda não encerradas','warning')}${metric('Disponíveis',fleet.available||0,'Liberados para operação','success')}${metric('Manutenção',fleet.maintenance||0,'Temporariamente indisponíveis','warning')}</div></section>
      <section><div class="panel-header"><div><h3>Equipe e retornos</h3><p class="helper-text">Disponibilidade de pessoas e acompanhamento de jornada.</p></div></div><div class="cards-grid">${metric('Motoristas disponíveis',people.driversAvailable||0,'Disponíveis para escala','success')}${metric('Ajudantes disponíveis',people.helpersAvailable||0,'Disponíveis para escala','success')}${metric('Retornos no período',people.returns||0,'Confirmados','info')}${metric('Alertas de jornada',people.journeyAlerts||0,'Próximos ou acima do limite','danger')}</div></section>
      <section><div class="panel-header"><div><h3>Produtividade das rotas finalizadas</h3><p class="helper-text">Calculada somente com saída e retorno confirmados.</p></div></div><div class="cards-grid">${metric('Horas por tonelada',`${formatNumber(prod.hoursPerTon||0,2)} h/t`,'Tempo útil ÷ toneladas','info')}${metric('Toneladas por hora',`${formatNumber(prod.tonsPerHour||0,2)} t/h`,'Produtividade da carga','success')}${metric('Entregas por hora',formatNumber(prod.deliveriesPerHour||0,2),'Produtividade das entregas','success')}${metric('Rotas finalizadas',prod.completedRoutes||0,'Com saída e retorno','info')}${metric('Peso transportado',`${formatNumber((prod.totalTons||0)*1000,0)} kg`,'Exibição em quilogramas','success')}</div></section>
      <section><div class="panel-header"><div><h3>Resumo gerencial da frota</h3><p class="helper-text">Total, frota própria, terceiros e composição por tipo.</p></div></div><div class="cards-grid">${matrixCard('Inventário',overview.inventory,'info',{label:'Inativos',value:overview.inactive?.total||0})}${matrixCard('Escalados',overview.scheduled)}${matrixCard('Em rota',overview.inRoute)}${matrixCard('Pernoite',overview.overnight)}${matrixCard('Finalizados no período',overview.finalized)}${matrixCard('Manutenção',overview.maintenance)}${matrixCard('Disponíveis / não escalados',overview.available)}</div></section>`;
    $('#route-dashboard-start').onchange=()=>renderDashboard($('#route-dashboard-start').value,$('#route-dashboard-end').value);
    $('#route-dashboard-end').onchange=()=>renderDashboard($('#route-dashboard-start').value,$('#route-dashboard-end').value);
    $('#route-dashboard-export').onclick=()=>exportCsv([
      {grupo:'Saídas',indicador:'Rotas programadas',valor:dep.programmed||0},{grupo:'Saídas',indicador:'Saídas realizadas',valor:dep.realized||0},{grupo:'Saídas',indicador:'Saídas pendentes',valor:dep.pending||0},{grupo:'Saídas',indicador:'Saídas atrasadas',valor:dep.delayed||0},
      {grupo:'Frota',indicador:'Escalados',valor:fleet.scheduled||0},{grupo:'Frota',indicador:'Em rota',valor:fleet.inRoute||0},{grupo:'Frota',indicador:'Pernoite',valor:fleet.overnight||0},{grupo:'Frota',indicador:'Disponíveis',valor:fleet.available||0},{grupo:'Frota',indicador:'Manutenção',valor:fleet.maintenance||0},
      {grupo:'Equipe',indicador:'Motoristas disponíveis',valor:people.driversAvailable||0},{grupo:'Equipe',indicador:'Ajudantes disponíveis',valor:people.helpersAvailable||0},{grupo:'Equipe',indicador:'Retornos',valor:people.returns||0},{grupo:'Equipe',indicador:'Alertas de jornada',valor:people.journeyAlerts||0},
      {grupo:'Produtividade',indicador:'Horas por tonelada',valor:prod.hoursPerTon||0},{grupo:'Produtividade',indicador:'Toneladas por hora',valor:prod.tonsPerHour||0},{grupo:'Produtividade',indicador:'Entregas por hora',valor:prod.deliveriesPerHour||0},{grupo:'Produtividade',indicador:'Rotas finalizadas',valor:prod.completedRoutes||0},{grupo:'Produtividade',indicador:'Peso transportado kg',valor:(prod.totalTons||0)*1000},
    ],`visao_geral_${selectedStart}_${selectedEnd}.csv`);
    $('#route-dashboard-refresh').onclick=()=>renderDashboard($('#route-dashboard-start').value,$('#route-dashboard-end').value,{fresh:true});
  }

  async function printSummaryRoutes(rows=[],pendingRows=[]){
    const w=window.open('','_blank');
    if(!w){toast('O navegador bloqueou a janela da imagem. Permita pop-ups para gerar o quadro operacional.','warning');return;}
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Gerando quadro da operação...</title><style>body{margin:0;background:#0b1f15;color:#fff;font-family:Arial,Helvetica,sans-serif;display:grid;place-items:center;min-height:100vh}.loading{padding:28px 34px;border:1px solid #315846;border-radius:14px;background:#10291c;font-size:18px}.loading small{display:block;margin-top:8px;color:#b7c9bd;font-size:13px}</style></head><body><div class="loading">Gerando quadro da operação...<small>Ajustando todos os veículos em uma única folha, sem títulos sobre os dados.</small></div></body></html>');
    w.document.close();
    try{
      const generated=new Date().toLocaleString('pt-BR');
      const totalRows=rows.length+pendingRows.length;
      const canvas=document.createElement('canvas');
      // v1.0.79: sem cabeçalho alto na impressão. O espaço fica reservado aos
      // veículos e aos dois separadores de situação, evitando sobreposição.
      const W=3508,H=2480,M=48,FOOTER_H=34,SECTION_H=46,SECTION_GAP=14,CARD_GAP=7,COL_GAP=14;
      canvas.width=W;canvas.height=H;
      const ctx=canvas.getContext('2d',{alpha:false});
      if(!ctx)throw new Error('Canvas indisponível neste navegador.');
      const C={green:'#004812',greenLight:'#edf3ee',text:'#111111',muted:'#2a2a2a',line:'#777777',orange:'#744000',orangeLight:'#f7f1e7',white:'#ffffff',meta:'#aaaaaa'};
      const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
      const safe=(value,fallback='—')=>{const valueText=String(value??'').trim();return valueText||fallback;};
      const roundRect=(x,y,width,height,r,fill,stroke=null,lineWidth=1)=>{ctx.beginPath();ctx.roundRect(x,y,width,height,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.lineWidth=lineWidth;ctx.strokeStyle=stroke;ctx.stroke();}};
      const setFont=(size,weight='400')=>{ctx.font=`${weight} ${size}px Arial,Helvetica,sans-serif`;};
      const ellipsize=(text,maxWidth)=>{const raw=safe(text);if(ctx.measureText(raw).width<=maxWidth)return raw;let lo=0,hi=raw.length,best='…';while(lo<=hi){const mid=(lo+hi)>>1;const candidate=`${raw.slice(0,mid).trim()}…`;if(ctx.measureText(candidate).width<=maxWidth){best=candidate;lo=mid+1;}else hi=mid-1;}return best;};
      const drawText=(text,x,y,maxWidth,size,weight='400',color=C.text,align='left')=>{ctx.save();setFont(size,weight);ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillText(ellipsize(text,maxWidth),x,y);ctx.restore();};
      const wrapLines=(text,maxWidth,maxLines=2)=>{ctx.save();const raw=safe(text);const words=raw.split(/\s+/).filter(Boolean);const lines=[];let line='';for(const word of words){const probe=line?`${line} ${word}`:word;if(ctx.measureText(probe).width<=maxWidth||!line){line=probe;}else{lines.push(line);line=word;if(lines.length===maxLines-1)break;}}if(lines.length<maxLines&&line)lines.push(line);if(lines.length){const consumed=lines.join(' ').length;if(consumed<raw.length)lines[lines.length-1]=ellipsize(`${lines[lines.length-1]} ${raw.slice(consumed).trim()}`,maxWidth);}ctx.restore();return lines.slice(0,maxLines);};
      const drawWrapped=(text,x,y,maxWidth,size,weight,color,lineHeight,maxLines=2)=>{ctx.save();setFont(size,weight);ctx.fillStyle=color;ctx.textAlign='left';ctx.textBaseline='alphabetic';const lines=wrapLines(text,maxWidth,maxLines);lines.forEach((line,index)=>ctx.fillText(line,x,y+index*lineHeight));ctx.restore();return lines.length;};
      const formatShortDt=(value)=>value?`${formatDate(value)} ${formatTime(value)}`:'—';
      ctx.fillStyle=C.white;ctx.fillRect(0,0,W,H);ctx.fillStyle=C.green;ctx.fillRect(0,0,12,H);

      const sectionCount=(rows.length?1:0)+(pendingRows.length?1:0);
      const preferredCols=totalRows>60?5:totalRows>36?4:3;
      const computeLayout=(cols)=>{
        const activeGrid=Math.ceil(rows.length/cols),pendingGrid=Math.ceil(pendingRows.length/cols),gridRows=activeGrid+pendingGrid;
        const internalGaps=Math.max(0,activeGrid-1)+Math.max(0,pendingGrid-1);
        const fixed=M+FOOTER_H+sectionCount*SECTION_H+(sectionCount>1?SECTION_GAP:0)+internalGaps*CARD_GAP+(sectionCount?16:0);
        const available=H-fixed;
        return {cols,gridRows,cardH:gridRows?Math.floor(available/gridRows):150};
      };
      let layout=computeLayout(preferredCols);
      if(layout.cardH<90&&layout.cols<5)layout=computeLayout(layout.cols+1);
      const cols=layout.cols,cardH=clamp(layout.cardH,82,164),cardW=Math.floor((W-M*2-(cols-1)*COL_GAP)/cols);
      const drawSectionHeader=(y,title,count,pending=false)=>{
        roundRect(M,y,W-M*2,SECTION_H,8,pending?C.orangeLight:C.greenLight,null);
        ctx.fillStyle=pending?C.orange:C.green;ctx.fillRect(M,y,8,SECTION_H);
        drawText(title,M+24,y+31,1700,24,'800',pending?C.orange:C.green);
        drawText(`${count} veículo(s)`,W-M-20,y+31,320,20,'700',pending?C.orange:C.green,'right');
        return y+SECTION_H;
      };
      const drawCard=(item,x,y,pending=false)=>{
        const status=safe(item.status,pending?'PENDENTE':'EM ROTA').toUpperCase();
        const overnight=/PERNOITE/.test(status),accent=pending||overnight?C.orange:C.green,fill=pending?'#fffaf1':overnight?'#fffaf4':C.white;
        roundRect(x,y,cardW,cardH,9,fill,C.line,1.3);ctx.fillStyle=accent;ctx.fillRect(x,y,6,cardH);
        const pad=16,innerX=x+pad+6,right=x+cardW-pad,metaH=clamp(Math.round(cardH*.24),30,38),bodyBottom=y+cardH-metaH;
        const leftW=Math.round((cardW-pad*2-12)*.36),dividerX=innerX+leftW+9,rightX=dividerX+16,rightW=right-rightX;
        ctx.strokeStyle='#d7e1db';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(dividerX,y+9);ctx.lineTo(dividerX,bodyBottom-7);ctx.stroke();
        ctx.fillStyle=C.meta;ctx.fillRect(x+7,bodyBottom,cardW-14,1);

        // v1.0.79: nenhum título ROTA/PLACA/MOTORISTA/AJUDANTE fica dentro do
        // cartão. Só os valores são impressos, com posições fixas e independentes.
        const routeFont=clamp(Math.floor(cardH*.19),19,27),plateFont=clamp(Math.floor(cardH*.19),19,27);
        setFont(routeFont,'800');
        const routeLines=wrapLines(safe(item.rota),leftW,2);
        ctx.save();setFont(routeFont,'800');ctx.fillStyle=C.text;routeLines.forEach((line,index)=>ctx.fillText(line,innerX,y+routeFont+9+index*(routeFont+1)));ctx.restore();
        drawText(safe(item.placa),innerX,bodyBottom-9,leftW,plateFont,'800',accent);

        const driverFont=clamp(Math.floor(cardH*.155),16,22),helperFont=clamp(Math.floor(cardH*.13),14,19);
        setFont(driverFont,'800');
        const driverLines=wrapLines(safe(item.motorista),rightW,2);
        ctx.save();setFont(driverFont,'800');ctx.fillStyle=C.text;driverLines.forEach((line,index)=>ctx.fillText(line,rightX,y+driverFont+9+index*(driverFont+1)));ctx.restore();
        const helperTop=y+Math.max(driverFont*2+18,Math.round((bodyBottom-y)*.58));
        drawWrapped(safe(item.ajudantes),rightX,helperTop,rightW,helperFont,'700',C.muted,helperFont+1,2);

        const departureValue=pending?item.saidaProgramada:item.saidaEm;
        const departureText=pending?`Prog. ${formatShortDt(departureValue)}`:formatShortDt(departureValue);
        const ocValue=safe(item.ocs||item.carga||item.oc);
        const metaFont=clamp(Math.floor(cardH*.115),12,17),metaY=y+cardH-9;
        drawText(departureText,innerX,metaY,leftW,metaFont,'800',C.text);
        drawText(`OC ${ocValue}`,rightX,metaY,rightW,metaFont,'800',C.text);
      };
      const drawGrid=(items,startY,pending=false)=>{
        for(let i=0;i<items.length;i++){const col=i%cols,row=Math.floor(i/cols),x=M+col*(cardW+COL_GAP),yy=startY+row*(cardH+CARD_GAP);drawCard(items[i],x,yy,pending);}
        const countRows=Math.ceil(items.length/cols);return startY+countRows*cardH+Math.max(0,countRows-1)*CARD_GAP;
      };
      let y=M;
      if(rows.length){y=drawSectionHeader(y,'VEÍCULOS EM ROTA',rows.length,false)+7;y=drawGrid(rows,y,false);}
      if(pendingRows.length){if(rows.length)y+=SECTION_GAP;y=drawSectionHeader(y,'PENDENTES DE SAÍDA',pendingRows.length,true)+7;y=drawGrid(pendingRows,y,true);}
      drawText(`NATTO DMS Rota · ${totalRows} veículo(s) · gerado em ${generated}`,W-M,H-16,W-M*2,15,'700',C.muted,'right');

      const blob=await new Promise((resolve,reject)=>{try{canvas.toBlob((value)=>value?resolve(value):reject(new Error('Falha ao gerar PNG.')),'image/png',0.96);}catch(error){reject(error);}});
      const imageUrl=URL.createObjectURL(blob),fileName=`operacao_frota_${today()}.png`;
      w.document.open();
      w.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quadro operacional da frota</title><style>@page{size:A4 landscape;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#0b1f15;font-family:Arial,Helvetica,sans-serif}.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:center;gap:12px;align-items:center;padding:12px;background:#10291c;border-bottom:1px solid #315846;color:#fff}.toolbar button,.toolbar a{appearance:none;border:1px solid #3b6b51;border-radius:8px;padding:10px 16px;background:#0f6d35;color:#fff;font-weight:700;text-decoration:none;cursor:pointer}.toolbar a{background:#173c28}.toolbar span{font-size:13px;color:#c7d8ce}.stage{padding:18px;display:flex;justify-content:center}.sheet{width:min(96vw,1400px);aspect-ratio:3508/2480;background:#fff;box-shadow:0 12px 36px rgba(0,0,0,.34)}.sheet canvas{display:block;width:100%;height:100%}@media print{html,body{width:297mm;height:210mm;background:#fff;overflow:hidden}.toolbar{display:none!important}.stage{padding:0;width:297mm;height:210mm}.sheet{width:297mm;height:210mm;max-width:none;box-shadow:none}.sheet canvas{width:297mm!important;height:210mm!important}}</style></head><body><div class="toolbar"><span>Imagem única A4 paisagem · todos os veículos em uma folha</span><button id="print-operation">Imprimir / Salvar PDF</button><a id="download-operation">Baixar PNG</a></div><div class="stage"><div class="sheet" id="operation-sheet"></div></div></body></html>');
      w.document.close();
      const sheet=w.document.getElementById('operation-sheet');
      const adoptedCanvas=w.document.adoptNode(canvas);adoptedCanvas.setAttribute('aria-label','Resumo operacional da frota');sheet.appendChild(adoptedCanvas);
      const download=w.document.getElementById('download-operation');download.href=imageUrl;download.download=fileName;
      const printButton=w.document.getElementById('print-operation');printButton.onclick=()=>{w.focus();w.print();};
      w.addEventListener('beforeunload',()=>{try{URL.revokeObjectURL(imageUrl);}catch{}});
      w.focus();
      toast(`Quadro operacional gerado com ${totalRows} veículo(s) em uma única folha, sem títulos sobrepostos.`, 'success');
    }catch(error){
      try{w.close();}catch{}
      toast(`Não foi possível gerar o quadro da operação: ${error?.message||error}`,'danger');
    }
  }

  async function renderSummary({fresh=false}={}) {
    const active=state.routeSummaryFilters||{};
    const payload=await api(routeIndicatorQuery('/api/monitoring?view=summary',active),{fresh});
    const s=payload.summary||{},rows=payload.rows||[],pendingRows=payload.pendingRows||[],fo=payload.filters||{},overnightReport=payload.overnightReport||[];
    $('#page-content').innerHTML=`<div class="page-intro"><div><span class="eyebrow">OPERAÇÃO · RESUMO</span><h3>Resumo da operação em rota</h3><p>Consolidação leve das rotas que já saíram e ainda não retornaram à empresa.</p></div><div class="page-intro-actions"><button class="btn btn-ghost" id="route-summary-export">CSV</button><button class="btn btn-primary" id="route-summary-refresh">↻ Atualizar</button></div></div>
      ${Number(s.reconciledCompleted||0)>0?`<div class="info-box"><strong>Base reconciliada:</strong> ${formatNumber(s.reconciledCompleted)} monitoramento(s) antigo(s) já possuíam retorno ou escala finalizada e foram retirados do total de carros em rota.</div>`:''}
      ${indicatorFilterPanel('route-summary-filter',fo,active,true)}
      <div class="cards-grid summary-overview-cards">${metric('Carros em rota',s.carsInRoute||0,'Veículos únicos ainda fora da empresa','info')}${metric('Pernoites (status)',s.monitoringOvernights||0,`${s.overnightPendingJustification||0} sem justificativa`,'warning')}${metric('Entregas totais',s.totalDeliveries||0,'Roteirizadas nas rotas abertas','info')}${metric('Entregas previstas (Lincros)',s.lincrosPlannedDeliveries||0,`${s.lincrosTrackedRoutes||0} rota(s) com sincronização válida`,'info')}${metric('Entregas apontadas',s.lincrosRealizedDeliveries||0,'Finalizadas dentro da base Lincros','success')}${metric('% das previstas',s.lincrosDeliveryPercent===null||s.lincrosDeliveryPercent===undefined?'—':`${formatNumber(s.lincrosDeliveryPercent,1)}%`,'Apontadas ÷ previstas Lincros','success')}${metric('Dias excedentes',s.overnights||0,'Dias acima da duração definida na Base de Rotas','warning')}</div>
      <section class="panel"><div class="panel-header"><div><h3>Pernoites para reporte do fim do dia</h3><p class="helper-text">Somente veículos com status PERNOITE no Monitoramento e ainda sem retorno registrado. A justificativa é a mesma informada no card de Monitoramento.</p></div><button class="btn btn-ghost" id="route-summary-overnight-export">CSV pernoites</button></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Rota</th><th>Região</th><th>Placa</th><th>Motorista</th><th>Vínculo</th><th>Dias em rota</th><th>Justificativa</th><th>Atualizado</th></tr></thead><tbody>${overnightReport.map((r)=>`<tr><td><strong>${esc(r.rota||'—')}</strong></td><td>${esc(r.regiao||'—')}</td><td>${esc(r.placa||'—')}</td><td>${esc(r.motorista||'—')}</td><td>${esc(r.vinculoMotorista||'—')}</td><td>${formatNumber(r.diasEmRota||1)}</td><td>${r.justificativa?esc(r.justificativa):'<span class="badge badge-warning">PENDENTE DE JUSTIFICATIVA</span>'}</td><td>${auditDt(r.atualizadoEm)}</td></tr>`).join('')||'<tr><td colspan="8" class="muted">Nenhum veículo está com status PERNOITE nos filtros selecionados.</td></tr>'}</tbody></table></div></div></section>
      <section class="panel"><div class="panel-header"><div><h3>Rotas em andamento</h3><p class="helper-text">A data/hora de saída ajuda a localizar viagens antigas ainda sem baixa de Retorno. Dias excedentes considera a diferença entre os dias em rota e a duração padrão cadastrada. A imagem para impressão inclui também ${formatNumber(pendingRows.length)} veículo(s) pendente(s) de saída em uma seção separada e é montada para uma única folha A4 paisagem.</p></div><button class="btn btn-ghost" id="route-summary-print-table">▣ Gerar imagem / imprimir</button></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Rota</th><th>Região</th><th>Perfil</th><th>Placa</th><th>Motorista</th><th>Ajudantes</th><th>Vínculo</th><th>Etapa</th><th>Data/hora de saída</th><th>Entregas</th><th>Realizadas</th><th>Dias base</th><th>Dias em rota</th><th>Dias excedentes</th></tr></thead><tbody>${rows.map((r)=>`<tr><td><strong>${esc(r.rota||'—')}</strong></td><td>${esc(r.regiao||'—')}</td><td>${esc(r.perfil||'—')}</td><td>${esc(r.placa||'—')}</td><td>${esc(r.motorista||'—')}</td><td>${esc(r.ajudantes||'—')}</td><td>${esc(r.vinculoMotorista||'—')}</td><td>${badge(r.status||'EM ROTA')}</td><td>${dt(r.saidaEm)}</td><td>${formatNumber(r.entregas||0)}</td><td>${formatNumber(r.entregasRealizadas||0)}</td><td>${formatNumber(r.duracaoDias||1)}</td><td>${formatNumber(r.diasEmRota||1)}</td><td><strong>${formatNumber(r.pernoitesExtras||0)}</strong></td></tr>`).join('')||'<tr><td colspan="14" class="muted">Nenhum veículo em rota corresponde aos filtros selecionados.</td></tr>'}</tbody></table></div></div></section>`;
    const applySummaryFilters=()=>{state.routeSummaryFilters=readIndicatorFilterPanel('route-summary-filter',true);renderSummary();};
    $('#route-summary-filter-apply').onclick=applySummaryFilters;
    bindIndicatorAutoApply('route-summary-filter',applySummaryFilters);
    $('#route-summary-filter-clear').onclick=()=>{state.routeSummaryFilters={};renderSummary();};
    $('#route-summary-filter-q').onkeydown=(event)=>{if(event.key==='Enter')applySummaryFilters();};
    $('#route-summary-refresh').onclick=()=>renderSummary({fresh:true});
    $('#route-summary-print-table').onclick=async()=>{const button=$('#route-summary-print-table');if(button){button.disabled=true;button.textContent='Gerando imagem...';}try{await printSummaryRoutes(rows,pendingRows);}finally{if(button){button.disabled=false;button.textContent='▣ Gerar imagem / imprimir';}}};
    $('#route-summary-export').onclick=()=>exportCsv(rows.map((r)=>({rota:r.rota,regiao:r.regiao,perfil:r.perfil,placa:r.placa,motorista:r.motorista,ajudante_1:r.ajudante1||'',ajudante_2:r.ajudante2||'',ajudantes:r.ajudantes||'',vinculo_motorista:r.vinculoMotorista,etapa:r.status,data_hora_saida:r.saidaEm||'',entregas:r.entregas,entregas_realizadas:r.entregasRealizadas,lincros_sincronizado:r.lincrosSyncHealthy?'SIM':'NÃO',entregas_previstas_lincros:r.lincrosEntregasPrevistas||0,entregas_apontadas_lincros:r.lincrosEntregasRealizadas||0,duracao_base_dias:r.duracaoDias,dias_em_rota:r.diasEmRota,dias_excedentes:r.pernoitesExtras})),`resumo_operacao_${today()}.csv`);
    $('#route-summary-overnight-export').onclick=()=>exportCsv(overnightReport.map((r)=>({rota:r.rota,regiao:r.regiao,placa:r.placa,motorista:r.motorista,vinculo_motorista:r.vinculoMotorista,status:r.status,dias_em_rota:r.diasEmRota,duracao_base_dias:r.duracaoDias,dias_excedentes:r.pernoitesExtras,justificativa:r.justificativa||'PENDENTE DE JUSTIFICATIVA',atualizado_em:auditDt(r.atualizadoEm)})),`pernoites_reporte_${today()}.csv`);
  }

  let scheduleData=null;
  const schedulePersistentKey=(date)=>`natto_route_schedule_cache_${date}`;
  const scheduleErrorReason=(error)=>{
    const code=String(error?.code||'').trim();
    const raw=String(error?.message||error||'').trim();
    if(code==='REQUEST_TIMEOUT')return 'Motivo: o servidor não respondeu dentro do tempo limite. A linha não foi confirmada; os dados continuam preservados.';
    if(code==='SERVICE_TEMPORARILY_UNAVAILABLE'||/^HTTP_(502|503|504)$/.test(code)){
      const http=code.match(/HTTP_(\d+)/)?.[1]||'503';
      const detail=raw&&!/servidor temporariamente indisponível|falha http/i.test(raw)?` Detalhe: ${raw}`:'';
      return `Motivo: falha temporária do servidor/Cloudflare (HTTP ${http}). A linha não foi confirmada.${detail}`;
    }
    if(code==='HTTP_429')return 'Motivo: o servidor limitou temporariamente o volume de gravações (HTTP 429). A linha foi mantida para nova tentativa.';
    if(error?.name==='TypeError')return `Motivo: falha de comunicação/rede ao enviar a linha.${raw?` Detalhe: ${raw}`:''}`;
    const suffix=code&&code!=='SCHEDULE_ERROR'?` [${code}]`:'';
    return `Motivo: ${raw||'o servidor rejeitou esta linha sem informar uma mensagem específica.'}${suffix}`;
  };
  function persistScheduleSnapshot(date,data){
    if(!date||!data)return;
    try{localStorage.setItem(schedulePersistentKey(date),JSON.stringify({at:Date.now(),data}));}catch{}
  }
  function readScheduleSnapshot(date,maxAgeMs=12*60*60*1000){
    try{const cached=JSON.parse(localStorage.getItem(schedulePersistentKey(date))||'null');if(cached?.data&&Date.now()-Number(cached.at||0)<=maxAgeMs)return cached;}catch{}
    return null;
  }
  const scheduleDraftKey=(date)=>`natto_route_schedule_draft_${date}`;
  let scheduleDraftTimer=null;
  const scheduleComparableKeys=['sequencia','ocs','peso_kg','qtd_entregas','rota_id','veiculo_id','motorista_id','ajudante_1_id','ajudante_2_id','tipo_equipe','horario_ponto','temperatura_frio_c','status'];
  function readScheduleDraft(date,maxAgeMs=48*60*60*1000){
    try{const draft=JSON.parse(localStorage.getItem(scheduleDraftKey(date))||'null');if(draft?.records&&Date.now()-Number(draft.at||0)<=maxAgeMs)return draft;}catch{}
    return null;
  }
  function clearScheduleDraft(date){try{localStorage.removeItem(scheduleDraftKey(date));}catch{}}
  function scheduleRecordsEquivalent(left={},right={}){return scheduleComparableKeys.every((key)=>String(left?.[key]??'')===String(right?.[key]??''));}
  function scheduleDraftIdentityScore(server={},draft={}){
    let score=0;
    const same=(a,b)=>String(a??'').trim()&&String(a??'').trim()===String(b??'').trim();
    if(same(server.sequencia,draft.sequencia))score+=5;
    if(same(server.veiculo_id,draft.veiculo_id))score+=5;
    if(same(server.placa,draft.placa))score+=4;
    if(same(server.ocs,draft.ocs))score+=3;
    if(same(server.rota_id,draft.rota_id))score+=3;
    if(same(server.rota,draft.rota))score+=2;
    return score;
  }
  function scheduleDraftCanonicalIndex(schedules,record){
    const id=String(record.id||'').trim(),clientId=String(record.client_id||'').trim();
    let index=schedules.findIndex((item)=>id&&String(item.id)===id);
    if(index>=0)return index;
    if(clientId){index=schedules.findIndex((item)=>String(item.client_id||'')===clientId||String(item.id||'')===clientId);if(index>=0)return index;}
    const ranked=schedules.map((item,index)=>({index,score:scheduleDraftIdentityScore(item,record)})).filter((x)=>x.score>=8).sort((a,b)=>b.score-a.score);
    if(!ranked.length)return -1;
    if(ranked[1]&&ranked[1].score===ranked[0].score)return -1;
    return ranked[0].index;
  }
  function reconcileScheduleDraft(serverData,date){
    const draft=readScheduleDraft(date);if(!draft?.records?.length)return {data:serverData,restored:0};
    const data={...serverData,schedules:[...(serverData.schedules||[])]};const unresolved=[];
    for(const record of draft.records){
      const index=scheduleDraftCanonicalIndex(data.schedules,record);
      if(index>=0){
        const server=data.schedules[index];
        if(scheduleRecordsEquivalent(server,record))continue;
        // Nunca deixe um rascunho/localStorage sobrescrever o identificador canônico
        // retornado pelo servidor. Isso era a causa da linha aparecer na tela e o
        // botão Excluir/Cancelar responder "Escala não encontrada".
        const merged={...server,...record,id:server.id,storage:server.storage||'',sourceTable:server.sourceTable,sourceKey:server.sourceKey,legacy:server.legacy,client_id:server.client_id||'',__draft:true};
        data.schedules[index]=merged;
        unresolved.push({...record,id:server.id,storage:server.storage||'',client_id:server.client_id||''});
        continue;
      }
      data.schedules.push({...record,__draft:true});unresolved.push(record);
    }
    if(unresolved.length){try{localStorage.setItem(scheduleDraftKey(date),JSON.stringify({at:Date.now(),records:unresolved}));}catch{}}
    else clearScheduleDraft(date);
    return {data,restored:unresolved.length};
  }
  function updateScheduleSyncState(){
    const node=$('#route-schedule-sync-status');if(!node)return;
    const rows=$$('[data-route-schedule-row]');
    const failed=rows.filter((row)=>Boolean(row.dataset.syncError)).length;
    const pending=rows.filter((row)=>row.dataset.dirty==='1').length;
    if(failed){node.className='badge badge-danger';node.textContent=`${failed} linha(s) para corrigir`;return;}
    if(pending){node.className='badge badge-warning';node.textContent=`${pending} pendente(s) de salvar`;return;}
    if(scheduleData?.__degraded){node.className='badge badge-warning';node.textContent='Atualização pendente';return;}
    node.className='badge badge-success';node.textContent='Sincronizado no servidor';
  }
  function persistScheduleDraftFromDom(date){
    const records=$$('[data-route-schedule-row]').filter((row)=>row.dataset.dirty==='1').map((row)=>({ ...readScheduleRow(row,date),__sync_error:row.dataset.syncError||'' })).filter((record)=>record.rota_id||record.motorista_id||record.veiculo_id||record.ocs||record.sequencia);
    try{if(records.length)localStorage.setItem(scheduleDraftKey(date),JSON.stringify({at:Date.now(),records}));else clearScheduleDraft(date);}catch{}
    updateScheduleSyncState();return records;
  }
  function scheduleDraftSoon(){clearTimeout(scheduleDraftTimer);scheduleDraftTimer=setTimeout(()=>{const date=$('#route-schedule-date')?.value||scheduleData?.date;if(date)persistScheduleDraftFromDom(date);},120);}
  // Última barreira contra perda por F5/fechamento da aba: grava o rascunho
  // sincronicamente antes de o navegador descarregar a página.
  if(!window.__nattoScheduleDraftUnloadBound){
    window.__nattoScheduleDraftUnloadBound=true;
    window.addEventListener('beforeunload',()=>{try{const date=$('#route-schedule-date')?.value||scheduleData?.date;if(date&&$('[data-route-schedule-row]'))persistScheduleDraftFromDom(date);}catch{}});
  }
  function markScheduleRowError(row,message){
    if(!row)return;
    row.dataset.dirty='1';row.dataset.syncError=String(message||'Linha não confirmada no servidor.');row.classList.add('row-danger','is-editing');
    const node=$('[data-route-schedule-error]',row);if(node){node.textContent=row.dataset.syncError;node.classList.remove('is-hidden');}
  }
  function clearScheduleRowError(row){
    if(!row)return;
    row.dataset.syncError='';row.classList.remove('row-danger');
    const node=$('[data-route-schedule-error]',row);if(node){node.textContent='';node.classList.add('is-hidden');}
  }
  function showScheduleRowRetry(row,attempt,total){
    if(!row)return;
    const node=$('[data-route-schedule-error]',row);
    if(node){node.textContent=`Salvando automaticamente… tentativa ${attempt}/${total}`;node.classList.remove('is-hidden');}
  }
  const schedulePasteAliases={
    data:['DATA','DATA DA ESCALA','DIA'],
    sequencia:['SEQ','SEQUENCIA','SEQUÊNCIA','ORDEM','ORDEM DE CARREGAMENTO'],
    ocs:['OC','OCS','OC(S)','CARGA','ORDEM DE CARGA'],
    placa:['PLACA','VEICULO','VEÍCULO'],
    rota:['ROTA','DESTINO'],
    motorista:['MOTORISTA','CONDUTOR'],
    ajudante:['AJUDANTE','AJUDANTE 1','AJUDANTE1','AJUDANTES'],
    ajudante_2:['AJUDANTE 2','AJUDANTE2','SEGUNDO AJUDANTE'],
    horario_ponto:['PONTO','HORARIO','HORÁRIO','HORARIO DE SAIDA','HORÁRIO DE SAÍDA','HORA SAIDA','HORA DE SAIDA'],
    peso_kg:['PESO','PESO KG','PESO (KG)','PESO CARGA','PESO CARGA KG'],
    temperatura_frio_c:['TEMPERATURA','TEMPERATURA FRIO','TEMPERATURA DO FRIO','TEMP FRIO','FRIO','FRIO C','FRIO °C','TEMPERATURA °C'],
    qtd_entregas:['ENTREGAS','QTD ENTREGA','QTD ENTREGAS','QTD. ENTREGA','QTD. ENTREGAS','QUANTIDADE DE ENTREGA','QUANTIDADE DE ENTREGAS'],
  };
  const schedulePasteHeaderKey=(value)=>{const key=normalize(value).replace(/\s+/g,' ');return Object.entries(schedulePasteAliases).find(([,aliases])=>aliases.some((alias)=>normalize(alias)===key))?.[0]||'';};
  function scheduleDetectedFields(cells){
    let helperCount=0;
    return (cells||[]).map((cell)=>{
      const key=schedulePasteHeaderKey(cell);
      if(key==='ajudante'){helperCount+=1;return helperCount===1?'ajudante_1':'ajudante_2';}
      return key;
    });
  }
  const schedulePasteNumber=(value)=>{
    let raw=String(value??'').trim().replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
    if(!raw)return 0;
    if(raw.includes(',')&&raw.includes('.'))raw=raw.replace(/\./g,'').replace(',','.');
    else if(raw.includes(','))raw=raw.replace(',','.');
    else if(/^[-+]?\d{1,3}(?:\.\d{3})+$/.test(raw))raw=raw.replace(/\./g,'');
    const number=Number(raw);return Number.isFinite(number)?number:0;
  };
  function scheduleSpreadsheetDate(value){
    const raw=String(value??'').trim();if(!raw)return '';
    let m=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    m=raw.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);if(m)return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    const serial=Number(raw);if(Number.isFinite(serial)&&serial>20000&&serial<100000)return new Date(Date.UTC(1899,11,30)+Math.round(serial)*86400000).toISOString().slice(0,10);
    return '';
  }
  function scheduleSpreadsheetTime(value){
    const raw=String(value??'').trim();if(!raw)return '';
    const m=raw.match(/(?:^|\s)(\d{1,2}):(\d{2})/);if(m)return `${String(m[1]).padStart(2,'0')}:${m[2]}`;
    const serial=Number(raw);if(Number.isFinite(serial)&&serial>=0&&serial<1){const minutes=Math.round(serial*1440)%1440;return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}
    return '';
  }
  function scheduleHeaderScore(cells){const fields=scheduleDetectedFields(cells);return {fields,score:fields.filter(Boolean).length,hasRoute:fields.includes('rota'),hasLoad:fields.includes('sequencia')||fields.includes('ocs')};}
  function parseScheduleMatrix(matrix){
    const rows=(matrix||[]).map((row)=>Array.isArray(row)?row.map((cell)=>String(cell??'').trim()):[]);
    if(!rows.length)return [];
    let headerIndex=-1,fields=[];
    for(let i=0;i<Math.min(rows.length,30);i+=1){const test=scheduleHeaderScore(rows[i]);if(test.score>=5&&test.hasRoute&&test.hasLoad){headerIndex=i;fields=test.fields;break;}}
    if(headerIndex<0){fields=['sequencia','ocs','placa','rota','peso_kg','qtd_entregas'];headerIndex=-1;}
    let inheritedDate='';const result=[];
    for(let i=headerIndex+1;i<rows.length;i+=1){
      const cells=rows[i];if(!cells.some((cell)=>String(cell).trim()))continue;
      const standaloneDate=cells.map(scheduleSpreadsheetDate).find(Boolean)||'';
      const nonEmpty=cells.filter((cell)=>String(cell).trim()).length;
      if(standaloneDate&&nonEmpty<=2){inheritedDate=standaloneDate;continue;}
      const row={__sourceRow:i+1};fields.forEach((field,column)=>{if(field)row[field]=cells[column]??'';});
      row.data=scheduleSpreadsheetDate(row.data)||inheritedDate; if(row.data)inheritedDate=row.data;
      if(['sequencia','ocs','placa','rota','motorista','ajudante_1','ajudante_2','peso_kg','qtd_entregas'].some((key)=>String(row[key]??'').trim()))result.push(row);
    }
    return result;
  }
  function parseScheduleClipboard(text){
    const lines=String(text||'').replace(/\r/g,'').split('\n').filter((line)=>line.trim());if(!lines.length)return [];
    const delimiter=lines.some((line)=>line.includes('\t'))?'\t':lines.some((line)=>line.includes(';'))?';':',';
    return parseScheduleMatrix(lines.map((line)=>line.split(delimiter)));
  }
  function scheduleFuzzyText(value){return normalize(value).replace(/[^A-Z0-9]+/g,' ').split(' ').filter((token)=>token&&!['DA','DE','DO','DAS','DOS','E'].includes(token)).join(' ').trim();}
  function scheduleEditDistance(a,b){
    a=String(a||'');b=String(b||'');if(!a)return b.length;if(!b)return a.length;
    const prev=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i+=1){let last=prev[0];prev[0]=i;for(let j=1;j<=b.length;j+=1){const temp=prev[j];prev[j]=Math.min(prev[j]+1,prev[j-1]+1,last+(a[i-1]===b[j-1]?0:1));last=temp;}}
    return prev[b.length];
  }
  function scheduleTokenScore(a,b){
    if(a===b)return 1;if(!a||!b)return 0;
    if((a.length>=4&&b.startsWith(a))||(b.length>=4&&a.startsWith(b)))return .94;
    if((a.length<=2||b.length<=2)&&a[0]===b[0])return .78;
    return 1-(scheduleEditDistance(a,b)/Math.max(a.length,b.length));
  }
  function scheduleFuzzyScore(query,candidate){
    const q=scheduleFuzzyText(query),c=scheduleFuzzyText(candidate);if(!q||!c)return 0;if(q===c)return 1;
    if((q.length>=5&&c.includes(q))||(c.length>=5&&q.includes(c)))return .96;
    const qt=q.split(' '),ct=c.split(' ');
    const forward=qt.reduce((sum,token)=>sum+Math.max(0,...ct.map((other)=>scheduleTokenScore(token,other))),0)/qt.length;
    const coverage=Math.min(1,qt.length/Math.max(1,ct.length));
    return Math.min(1,forward*.9+coverage*.1);
  }
  function scheduleBestMatch(raw,list,labelGetter,threshold=.72){
    const value=String(raw??'').trim();if(!value)return {item:null,score:0,ambiguous:false};
    const ranked=(list||[]).map((item)=>({item,score:scheduleFuzzyScore(value,labelGetter(item))})).sort((a,b)=>b.score-a.score);
    const best=ranked[0],second=ranked[1];
    if(!best||best.score<threshold)return {item:null,score:best?.score||0,ambiguous:false};
    const ambiguous=Boolean(second&&second.score>=threshold&&best.score-second.score<.055);
    return {item:ambiguous?null:best.item,score:best.score,ambiguous,bestLabel:labelGetter(best.item),secondLabel:second?labelGetter(second.item):''};
  }
  function schedulePasteMatchRoute(name){return scheduleBestMatch(name,scheduleData.routes||[],(route)=>route.rota,.69);}
  function schedulePasteMatchVehicle(plate){
    const target=normalize(plate).replace(/[^A-Z0-9]/g,'');if(!target||target==='0'||target==='-')return {item:null,score:0,ambiguous:false};
    const exact=(scheduleData.vehicles||[]).find((vehicle)=>normalize(vehicle.placa).replace(/[^A-Z0-9]/g,'')===target);
    return {item:exact||null,score:exact?1:0,ambiguous:false};
  }
  function schedulePasteMatchPerson(name,kind='driver'){
    const list=kind==='helper'?(scheduleData.helpers||[]):(scheduleData.drivers||[]);
    return scheduleBestMatch(name,list,(person)=>person.nome,.68);
  }
  function updateScheduleCount(){const badge=$('#route-schedule-count');if(badge)badge.textContent=`${$$('[data-route-schedule-row]').length} rota(s)`;}
  function showSchedulePasteResult(validCount,errors=[]){
    const node=$('#route-schedule-paste-result');if(!node)return;
    if(!validCount&&!errors.length){node.classList.add('is-hidden');node.innerHTML='';return;}
    node.classList.remove('is-hidden');
    const errorText=errors.length?` <strong>${errors.length} linha(s) não foram incluídas:</strong> ${errors.slice(0,4).map((item)=>`linha ${item.line}: ${esc(item.reason)}`).join(' · ')}${errors.length>4?' · …':''}`:'';
    node.innerHTML=`<strong>${validCount} linha(s) adicionada(s) à grade.</strong> Revise os dados reconhecidos na base e clique em Salvar alteradas.${errorText}`;
  }
  function scheduleSpecialTeam(value){
    const n=normalize(value);if(!n||['NENHUM','-','—'].includes(n))return '';
    if(n.includes('CARGA FECHADA'))return 'CARGA_FECHADA';
    if(n.includes('TERCEIR'))return 'TERCEIRO';
    return '';
  }
  const SCHEDULE_AUTO_OBSERVATIONS=['Identificar palete','Bonanza','Baixar divisória'];
  function scheduleLoadOrderCount(value){
    const parts=String(value||'').replace(/\r?\n/g,'/').split(/[\/,;+|]+/).map((item)=>item.trim()).filter(Boolean);
    return new Set(parts.map((item)=>normalize(item))).size;
  }
  function scheduleIsNetworkRouteName(value){return /\bREDES?\b/.test(normalize(value));}
  function scheduleAutoObservationParts({ocs='',rota='',temperatura_frio_c=''}={}){
    const notes=[];
    const networkRoute=scheduleIsNetworkRouteName(rota);
    if(scheduleLoadOrderCount(ocs)>1)notes.push(networkRoute?'Identificar palete':'Bonanza');
    const temp=Number(String(temperatura_frio_c??'').trim().replace(',','.'));
    if(networkRoute&&Number.isFinite(temp)&&Math.abs(temp-(-8))<0.0001)notes.push('Baixar divisória');
    return notes;
  }
  function scheduleMergeAutomaticObservations(current='',record={}){
    const automatic=scheduleAutoObservationParts(record);
    const autoKeys=new Set(SCHEDULE_AUTO_OBSERVATIONS.map((item)=>normalize(item)));
    const manual=String(current||'').split(/\s*(?:\||·|;|\n)\s*/).map((item)=>item.trim()).filter(Boolean).filter((item)=>!autoKeys.has(normalize(item)));
    return [...automatic,...manual].join(' | ');
  }
  function applyScheduleAutomaticObservation(row){
    if(!row)return false;
    const field=$('[data-key="observacoes"]',row);if(!field)return false;
    const routeId=$('[data-key="rota_id"]',row)?.value||'';
    const route=scheduleData.routes?.find((item)=>String(item.id)===String(routeId));
    const next=scheduleMergeAutomaticObservations(field.value,{ocs:$('[data-key="ocs"]',row)?.value||'',rota:route?.rota||'',temperatura_frio_c:$('[data-key="temperatura_frio_c"]',row)?.value||''});
    if(next===field.value)return false;field.value=next;return true;
  }
  function scheduleImportedRecord(row,selectedDate){
    const errors=[],warnings=[];
    const rowDate=scheduleSpreadsheetDate(row.data)||selectedDate;
    if(rowDate&&rowDate!==selectedDate)return {skip:true,reason:`outra data (${rowDate.split('-').reverse().join('/')})`,rowDate};
    const routeMatch=schedulePasteMatchRoute(row.rota);const route=routeMatch.item;
    const rawPlate=String(row.placa||'').trim();const vehicleMatch=schedulePasteMatchVehicle(rawPlate);const vehicle=vehicleMatch.item;
    const rawDriver=String(row.motorista||'').trim();const driverMatch=rawDriver?schedulePasteMatchPerson(rawDriver,'driver'):{item:null,score:0,ambiguous:false};const driver=driverMatch.item;
    const rawH1=String(row.ajudante_1||'').trim(),rawH2=String(row.ajudante_2||'').trim();
    const special1=scheduleSpecialTeam(rawH1),special2=scheduleSpecialTeam(rawH2);
    const h1Match=rawH1&&!special1?schedulePasteMatchPerson(rawH1,'helper'):{item:null,score:0,ambiguous:false};
    const h2Match=rawH2&&!special2?schedulePasteMatchPerson(rawH2,'helper'):{item:null,score:0,ambiguous:false};
    const h1=h1Match.item,h2=h2Match.item;
    if(!String(row.rota||'').trim())errors.push('rota/destino vazio');
    else if(!route)errors.push(routeMatch.ambiguous?`rota "${row.rota}" ambígua na base`:`rota "${row.rota}" não encontrada na base`);
    if(rawPlate&&rawPlate!=='0'&&rawPlate!=='-'&&rawPlate!=='—'&&!vehicle)errors.push(`veículo/placa "${rawPlate}" não encontrado na base`);
    if(rawDriver&&!driver)errors.push(driverMatch.ambiguous?`motorista "${rawDriver}" tem mais de um nome semelhante`:`motorista "${rawDriver}" não encontrado na base`);
    if(rawH1&&!special1&&!h1)errors.push(h1Match.ambiguous?`ajudante "${rawH1}" tem mais de um nome semelhante`:`ajudante "${rawH1}" não encontrado na base`);
    if(rawH2&&!special2&&!h2)errors.push(h2Match.ambiguous?`2º ajudante "${rawH2}" tem mais de um nome semelhante`:`2º ajudante "${rawH2}" não encontrado na base`);
    const addApprox=(label,raw,match)=>{if(match.item&&match.score<.93&&scheduleFuzzyText(raw)!==scheduleFuzzyText(match.item.nome||match.item.rota||''))warnings.push(`${label}: ${raw} → ${match.item.nome||match.item.rota}`);};
    addApprox('Rota',row.rota,routeMatch);addApprox('Motorista',rawDriver,driverMatch);addApprox('Ajudante 1',rawH1,h1Match);addApprox('Ajudante 2',rawH2,h2Match);
    const third=Boolean(vehicle&&/TERCEIR/.test(normalize(vehicle.vinculo)))||special1==='TERCEIRO'||special2==='TERCEIRO';
    let team=third?'TERCEIRO':(special1==='CARGA_FECHADA'||special2==='CARGA_FECHADA')?'CARGA_FECHADA':h2?'DOIS_AJUDANTES':h1?'UM_AJUDANTE':'UM_AJUDANTE';
    const record={
      status:'PROGRAMADO',sequencia:String(row.sequencia||'').trim(),ocs:String(row.ocs||'').trim(),
      peso_kg:schedulePasteNumber(row.peso_kg),temperatura_frio_c:String(row.temperatura_frio_c??'').trim()?schedulePasteNumber(row.temperatura_frio_c):'',qtd_entregas:Math.max(0,Math.round(schedulePasteNumber(row.qtd_entregas))),
      rota_id:route?.id||'',rota:route?.rota||'',regiao:route?.regiao||'',veiculo_id:vehicle?.id||'',placa:vehicle?.placa||'',
      motorista_id:driver?.id||'',motorista:driver?.nome||'',
      ajudante_1_id:third||team==='CARGA_FECHADA'?'':(h1?.id||''),ajudante_1:third||team==='CARGA_FECHADA'?'':(h1?.nome||''),
      ajudante_2_id:third||team!=='DOIS_AJUDANTES'?'':(h2?.id||''),ajudante_2:third||team!=='DOIS_AJUDANTES'?'':(h2?.nome||''),
      tipo_equipe:team,horario_ponto:scheduleSpreadsheetTime(row.horario_ponto)||scheduleData.defaults?.departureTime||'06:00',observacoes:'',
      __sourceRow:row.__sourceRow,__importWarnings:warnings,
    };
    record.observacoes=scheduleMergeAutomaticObservations(record.observacoes,record);
    return {record,errors,warnings,skip:false,rowDate};
  }
  async function autoPreScaleRecords(records){
    if(!records?.length)return records||[];try{const selected=$('#route-schedule-date')?.value||scheduleData.date;const result=await api('/api/schedule',{method:'POST',timeoutMs:60000,connectionImpact:false,body:JSON.stringify({action:'auto_pre_scale',date:selected,records})});return result?.records?.length?result.records:records;}catch(error){toast(`Pré-escala automática indisponível: ${error.message||error}. As linhas foram mantidas para preenchimento manual.`,'warning');return records;}
  }
  function addImportedScheduleRecords(records,sourceLabel='planilha'){
    const body=$('#route-schedule-body');if(!body||!records.length)return 0;
    records.forEach((record)=>body.insertAdjacentHTML('beforeend',scheduleRow(record)));
    bindScheduleRows();updateScheduleCount();$('#route-schedule-empty')?.remove();scheduleDraftSoon();
    toast(`${records.length} linha(s) adicionada(s) da ${sourceLabel}. Revise e clique em Salvar alteradas.`,'success');
    return records.length;
  }
  async function applyScheduleClipboard(text){
    const parsed=parseScheduleClipboard(text);
    if(!parsed.length){toast('Não encontrei linhas da planilha para colar.','warning');return 0;}
    const selected=$('#route-schedule-date')?.value||scheduleData.date;const records=[],errors=[];let otherDates=0;
    parsed.forEach((row)=>{const mapped=scheduleImportedRecord(row,selected);if(mapped.skip){otherDates+=1;return;}if(mapped.errors.length){errors.push({line:row.__sourceRow,reason:mapped.errors.join('; ')});return;}records.push(mapped.record);});
    const suggested=await autoPreScaleRecords(records);
    addImportedScheduleRecords(suggested,'planilha colada · pré-escala sugerida');
    showSchedulePasteResult(suggested.length,errors);
    if(otherDates)toast(`${otherDates} linha(s) de outras datas foram ignoradas. A grade está em ${formatDate(selected)}.`,'warning');
    if(!records.length&&errors.length)toast(`Não consegui incluir as linhas. ${errors[0].reason}.`,'warning');
    return records.length;
  }
  function scheduleCsvMatrix(text){
    const lines=String(text||'').replace(/\r/g,'').split('\n').filter((line)=>line.trim());if(!lines.length)return [];
    const delimiter=lines.some((line)=>line.includes('\t'))?'\t':lines.some((line)=>line.includes(';'))?';':',';
    return lines.map((line)=>line.split(delimiter));
  }
  function loadScheduleXlsx(){
    if(window.XLSX)return Promise.resolve(window.XLSX);
    if(window.__nattoXlsxPromise)return window.__nattoXlsxPromise;
    window.__nattoXlsxPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';script.async=true;
      script.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('Leitor Excel não inicializou.'));
      script.onerror=()=>reject(new Error('Não foi possível carregar o leitor de Excel. Tente CSV ou use Colar Excel.'));document.head.appendChild(script);
    }).catch((error)=>{window.__nattoXlsxPromise=null;throw error;});
    return window.__nattoXlsxPromise;
  }
  async function readScheduleSpreadsheetFile(file){
    if(!file)throw new Error('Selecione uma planilha.');if(file.size>12*1024*1024)throw new Error('A planilha ultrapassa 12 MB.');
    const ext=String(file.name||'').split('.').pop().toLowerCase();
    if(['csv','txt','tsv'].includes(ext))return {matrix:scheduleCsvMatrix(await file.text()),sheet:file.name};
    if(!['xlsx','xls','xlsm'].includes(ext))throw new Error('Use um arquivo Excel (.xlsx/.xls/.xlsm) ou CSV.');
    const XLSX=await loadScheduleXlsx();const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
    let best=null;
    for(const name of workbook.SheetNames||[]){
      const matrix=XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:'',raw:false,blankrows:false});
      let score=0;for(let i=0;i<Math.min(matrix.length,30);i+=1){const test=scheduleHeaderScore(matrix[i]);score=Math.max(score,test.score+(test.hasRoute?2:0)+(test.hasLoad?2:0));}
      if(!best||score>best.score)best={matrix,sheet:name,score};
    }
    if(!best?.matrix?.length)throw new Error('Nenhuma aba com dados foi encontrada na planilha.');return best;
  }
  async function openScheduleSpreadsheetFile(file){
    try{
      const {matrix,sheet}=await readScheduleSpreadsheetFile(file);const parsed=parseScheduleMatrix(matrix);if(!parsed.length)throw new Error('Não encontrei linhas reconhecíveis na planilha.');
      const selected=$('#route-schedule-date')?.value||scheduleData.date;const mapped=parsed.map((row)=>({row,...scheduleImportedRecord(row,selected)}));
      const valid=mapped.filter((item)=>!item.skip&&!item.errors.length);const invalid=mapped.filter((item)=>!item.skip&&item.errors.length);const other=mapped.filter((item)=>item.skip);
      const suggestedRecords=await autoPreScaleRecords(valid.map((item)=>item.record));suggestedRecords.forEach((rec,index)=>{if(valid[index])valid[index].record=rec;});
      const body=`<div class="info-box"><strong>Leitura inteligente da base.</strong><span>O DMS cruza Plano de Alocação, rota, histórico, disponibilidade, dias consecutivos, jornada semanal e restrições para sugerir uma pré-escala. Quando houver plano vigente, prioriza o casamento do motorista com sua placa principal; se o par não estiver disponível, tenta o par substituto previsto. A sugestão não bloqueia escolhas fora do plano e não salva automaticamente: revise antes de confirmar.</span></div><div class="warning-box">Aba: ${esc(sheet||'—')} · Data da grade: ${esc(formatDate(selected))} · Prontas: ${valid.length} · Revisar: ${invalid.length} · Outras datas: ${other.length}</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Linha</th><th>Seq.</th><th>Carga</th><th>Destino → base</th><th>Veículo</th><th>Motorista → base</th><th>Ajudantes → base</th><th>Situação</th></tr></thead><tbody>${mapped.slice(0,120).map((item)=>{const r=item.row,rec=item.record||{};const helpers=[rec.ajudante_1,rec.ajudante_2].filter(Boolean).join(' / ')||(rec.tipo_equipe==='CARGA_FECHADA'?'CARGA FECHADA':rec.tipo_equipe==='TERCEIRO'?'TERCEIRO':'—');const situation=item.skip?`Ignorada: ${item.reason}`:item.errors.length?item.errors.join(' · '):(item.warnings.length?`OK · ${item.warnings.join(' · ')}`:'OK');return `<tr class="${item.skip?'':item.errors.length?'row-danger':item.warnings.length?'row-warning':'row-success'}"><td>${r.__sourceRow||'—'}</td><td>${esc(r.sequencia||'')}</td><td>${esc(r.ocs||'')}</td><td>${esc(r.rota||'—')} → <strong>${esc(rec.rota||'—')}</strong></td><td>${esc(rec.placa||r.placa||'—')}</td><td>${esc(r.motorista||'—')} → <strong>${esc(rec.motorista||'—')}</strong></td><td>${esc(helpers)}</td><td>${esc(situation)}</td></tr>`;}).join('')}</tbody></table></div>${mapped.length>120?`<div class="helper-text">Mostrando as primeiras 120 de ${mapped.length} linhas.</div>`:''}`;
      modal({title:`Importar planilha para a Escala · ${formatDate(selected)}`,body,confirmText:`Adicionar ${valid.length} linha(s) à grade`,onConfirm:()=>{if(!valid.length)throw new Error('Não há linhas válidas para adicionar.');addImportedScheduleRecords(valid.map((item)=>item.record),'planilha enviada');showSchedulePasteResult(valid.length,invalid.map((item)=>({line:item.row.__sourceRow,reason:item.errors.join('; ')})));}});
    }catch(error){toast(error.message||String(error),'danger');}
  }
  async function pasteScheduleFromClipboard(){
    try{
      if(!navigator.clipboard?.readText)throw new Error('Leitura direta da área de transferência indisponível');
      const text=await navigator.clipboard.readText();
      if(!text.trim())throw new Error('A área de transferência está vazia');
      applyScheduleClipboard(text);
    }catch(error){
      toast('Clique dentro da tabela e pressione Ctrl+V para colar a planilha do Excel.','warning');
      $('#route-schedule-paste-zone')?.focus();
    }
  }
  function bindSchedulePaste(){
    const zone=$('#route-schedule-paste-zone');if(!zone)return;
    zone.addEventListener('paste',(event)=>{
      const text=event.clipboardData?.getData('text/plain')||'';
      if(!text||(!text.includes('\t')&&!text.includes('\n')&&!text.includes(';')))return;
      event.preventDefault();applyScheduleClipboard(text);
    });
    zone.addEventListener('click',(event)=>{
      if(event.target.closest('input,select,button,textarea,a'))return;
      try{zone.focus({preventScroll:true});}catch{zone.focus();}
    });
  }
  function scheduleOperationalStatus(item){if(item.disponivel_apoio)return 'DISPONÍVEL PARA APOIO';const status=item.status||'DISPONÍVEL';return item.rota_atual?`${status} EM ${item.rota_atual}`:status;}
  function scheduleVehicleLabel(item){return `${item.placa||'Sem placa'}${item.apelido?` (${item.apelido})`:''} · ${item.tipo||'Sem tipo'} · ${item.vinculo||'PRÓPRIO'} · ${scheduleOperationalStatus(item)}`;}
  function schedulePersonLabel(item){return `${item.nome||'Sem nome'} · ${item.matricula||'Sem matrícula'} · ${scheduleOperationalStatus(item)}`;}
  function scheduleWorkSignalMeta(item,routeDays=1,started=false){
    if(!item)return {tone:'is-neutral',days:0,before:0,projected:0,label:'Sem histórico',title:'Sem histórico de dias trabalhados'};
    const before=Math.max(0,Number(item.dias_consecutivos_anteriores??0)||0);
    const current=Math.max(0,Number(item.dias_consecutivos??before)||0);
    const days=started?current:before;
    const projected=before+Math.max(1,Number(routeDays||1));
    const tone=projected>=7?'is-danger':projected>=6?'is-warning':'is-success';
    const label=days===1?'1 dia seguido':`${days} dias seguidos`;
    const projection=projected>=7?` · rota pode atingir ${projected} dia(s) consecutivos`:'';
    const recent=(item.dias_trabalhados_recentes||[]).slice(-7).map((day)=>formatDate(day)).join(', ');
    const gap=item.data_quebra_sequencia?` · última quebra da sequência: ${formatDate(item.data_quebra_sequencia)}`:'';
    const title=`${label}. Jornada habitual: ${item.jornada_semanal_label||'Segunda a sexta'}${recent?` · dias trabalhados recentes: ${recent}`:''}${gap}${projection}`;
    return {tone,days,before,projected,label,title};
  }
  function scheduleWorkLight(item,routeDays=1,started=false){
    const meta=scheduleWorkSignalMeta(item,routeDays,started);
    return `<span class="schedule-work-light ${meta.tone}" title="${esc(meta.title)}"><i></i>${esc(meta.label)}${meta.projected>=7?`<b> · risco 7º dia</b>`:''}</span>`;
  }
  function scheduleCompactWorkLight(item,routeDays=1,started=false){
    const meta=scheduleWorkSignalMeta(item,routeDays,started);
    return `<span class="schedule-work-light schedule-work-light-compact ${meta.tone}" title="${esc(meta.title)}"><i></i>${esc(meta.days===1?'1 dia':`${meta.days||0} dias`)}${meta.projected>=7?'<b> · 7º</b>':''}</span>`;
  }
  function scheduleSelectedPersonItem(record,kind){
    const id=kind==='driver'?record.motorista_id:kind==='h1'?record.ajudante_1_id:record.ajudante_2_id;
    const teamKey=normalize(record.tipo_equipe);const secondDriver=(kind==='h1'&&['DOIS_MOTORISTAS','TRES_MOTORISTAS'].includes(teamKey))||(kind==='h2'&&teamKey==='TRES_MOTORISTAS');
    const list=kind==='driver'||secondDriver?(scheduleData.drivers||[]):(scheduleData.helpers||[]);
    return list.find((x)=>String(x.id)===String(id));
  }
  function scheduleRecordStarted(record={}){return ['EM ROTA','PERNOITE','RETORNOU','FINALIZADO'].includes(normalize(record.status));}
  function scheduleSelectedPersonSignal(record,kind,compact=false){
    const route=scheduleData.routes?.find((x)=>String(x.id)===String(record.rota_id));const days=Math.max(1,Number(route?.duracao_dias||record.duracao_dias||1));
    const item=scheduleSelectedPersonItem(record,kind);const started=scheduleRecordStarted(record);
    return compact?scheduleCompactWorkLight(item,days,started):scheduleWorkLight(item,days,started);
  }
  function scheduleCompactHelpers(record={}){
    const people=[['h1',record.ajudante_1||''],['h2',record.ajudante_2||'']].filter(([,name])=>name);
    if(!people.length){const team=normalize(record.tipo_equipe||'');return `<small class="schedule-compact-empty">${team==='CARGA_FECHADA'?'Carga fechada':team==='TERCEIRO'?'Terceiro':'Sem ajudante'}</small>`;}
    const secondDriverLabel=normalize(record.tipo_equipe||'')==='DOIS_MOTORISTAS'?'<small class="schedule-compact-empty">2º MOTORISTA</small>':(normalize(record.tipo_equipe||'')==='TRES_MOTORISTAS'?'<small class="schedule-compact-empty">2º E 3º MOTORISTAS</small>':'');
    return secondDriverLabel+people.map(([kind,name])=>`<div class="schedule-compact-helper-person"><strong title="${esc(name)}">${esc(name)}</strong>${scheduleSelectedPersonSignal(record,kind,true)}</div>`).join('');
  }
  function scheduleCanonicalRoute(value=''){
    const regions=new Set(['AG1','AG2','SRT','STR','PB','AL','RN','CE','BJ','MARANHAO']);
    const tokens=normalize(value).replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);while(tokens.length&&regions.has(tokens[0]))tokens.shift();return tokens.join(' ');
  }
  function scheduleRouteIsNetworks(route){return normalize([route?.rota,route?.perfil].filter(Boolean).join(' ')).includes('REDE');}
  function scheduleHelperSupportsRoute(item,route){
    if(!item?.ajudante_rota)return true;const target=scheduleCanonicalRoute(route?.rota||'');if(!target)return false;
    const allowed=String(item.rotas_atendidas||'').split(/[;,|\n]+/).map(scheduleCanonicalRoute).filter(Boolean);return allowed.includes(target);
  }
  function schedulePersonIsOvernight(item){return normalize(item?.status)==='PERNOITE'||normalize(scheduleOperationalStatus(item)).startsWith('PERNOITE');}
  function scheduleSelectedDateIsSunday(){const day=String(scheduleData?.date||$('#route-schedule-date')?.value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;return new Date(`${day}T12:00:00Z`).getUTCDay()===0;}
  function scheduleRouteHelperSundayIgnoresOvernight(item){return Boolean(item?.ajudante_rota&&scheduleSelectedDateIsSunday());}
  // Quem já está EM ROTA (sem retorno) não pode ser selecionado; ajudante de rota em
  // apoio (DISPONÍVEL PARA APOIO) segue a regra própria e não passa por aqui.
  function schedulePersonOnVacation(item){return ['FERIAS','FÉRIAS'].includes(normalize(item?.status));}
  function schedulePersonOnTimeOff(item){return normalize(item?.status)==='FOLGA AGENDADA'||Boolean(item?.folga_agendada);}
  function schedulePersonInRoute(item){return normalize(item?.status)==='EM ROTA'&&!item?.disponivel_apoio;}
  function scheduleBusyBlock(item,route){
    if(scheduleRouteIsAdministrative(route)||normalize(item?.status)!=='ESCALADO')return null;
    if(item?.ajudante_rota&&!item.escala_anterior_pendente)return null;
    return {eligible:false,reason:'JÁ ESCALADO'};
  }
  function scheduleBitruckBlock(item,vehicle,route){
    if(!item?.bitruck_motorista||scheduleRouteIsAdministrative(route))return null;
    const plate=normalize(String(vehicle?.placa||'').replace(/[^A-Z0-9]/g,''));
    const allowed=(scheduleData.bitruckPlates||[]).map((x)=>normalize(String(x)));
    return plate&&allowed.includes(plate)?null:{eligible:false,reason:'SÓ EM PLACA DE BITRUCK CADASTRADA'};
  }
  function scheduleDriverEligibility(item,vehicle,route){
    if(schedulePersonIsOvernight(item))return {eligible:false,reason:'PERNOITE EM ANDAMENTO'};
    if(schedulePersonOnTimeOff(item))return {eligible:false,reason:'FOLGA AGENDADA'};
    if(schedulePersonOnVacation(item))return {eligible:false,reason:'DE FÉRIAS'};
    if(schedulePersonInRoute(item))return {eligible:false,reason:'EM ROTA SEM RETORNO'};
    const busy=scheduleBusyBlock(item,route);if(busy)return busy;
    const bitruck=scheduleBitruckBlock(item,vehicle,route);if(bitruck)return bitruck;
    const driverThird=normalize(item?.vinculo).includes('TERCEIR');
    const vehicleThird=normalize(vehicle?.vinculo).includes('TERCEIR');
    if(!vehicle&&driverThird)return {eligible:false,reason:'SELECIONE UM VEÍCULO TERCEIRO'};
    if(vehicle&&driverThird!==vehicleThird){
      return {eligible:false,reason:driverThird?'EXIGE VEÍCULO TERCEIRO':'VEÍCULO TERCEIRO EXIGE MOTORISTA TERCEIRO'};
    }
    return {eligible:true,reason:''};
  }
  function scheduleDriverEligible(item,vehicle,selected=''){
    if(String(item?.id||'')===String(selected||''))return true;
    return scheduleDriverEligibility(item,vehicle).eligible;
  }
  function scheduleHelperEligibility(item,route){
    if(schedulePersonIsOvernight(item)&&!scheduleRouteHelperSundayIgnoresOvernight(item))return {eligible:false,reason:'PERNOITE EM ANDAMENTO'};
    if(schedulePersonOnTimeOff(item))return {eligible:false,reason:'FOLGA AGENDADA'};
    if(schedulePersonOnVacation(item))return {eligible:false,reason:'DE FÉRIAS'};
    if(schedulePersonInRoute(item))return {eligible:false,reason:'EM ROTA SEM RETORNO'};
    const busy=scheduleBusyBlock(item,route);if(busy)return busy;
    if(item?.ajudante_rota&&!scheduleHelperSupportsRoute(item,route))return {eligible:false,reason:'ROTA FORA DO CADASTRO DO AJUDANTE'};
    if(item?.restricao_ajudante&&!scheduleRouteIsNetworks(route))return {eligible:false,reason:'RESTRIÇÃO: SOMENTE ROTAS DE REDES'};
    return {eligible:true,reason:''};
  }
  function scheduleHelperEligible(item,route,selected=''){
    if(String(item?.id||'')===String(selected||''))return true;
    return scheduleHelperEligibility(item,route).eligible;
  }
  function scheduleHelperLabel(item){
    // CIDADE_ROTA é o vínculo/base do cadastro, não significa que o ajudante
    // esteja viajando. A rota atual só aparece quando existe ocupação na Escala.
    const routes=item.ajudante_rota&&item.rotas_atendidas?` · ROTAS ${item.rotas_atendidas}`:'';
    const restriction=item.restricao_ajudante?' · RESTRIÇÃO: SOMENTE REDES':'';
    const routeInfo=item.ajudante_rota?` · AJUDANTE DE ROTA${item.cidade_rota?` · BASE ${item.cidade_rota}`:''}${routes}`:'';
    return `${item.nome||'Sem nome'} · ${item.matricula||'Sem matrícula'}${routeInfo}${restriction} · ${scheduleOperationalStatus(item)}`;
  }
  function scheduleDriverOption(item,selected,vehicle,route){
    const same=String(item.id??'')===String(selected??'');
    const check=scheduleDriverEligibility(item,vehicle,route);
    const blocked=!check.eligible&&!same;
    const warning=!check.eligible?` · ⚠ ${check.reason}`:'';
    return `<option value="${esc(item.id??'')}" ${same?'selected':''} ${blocked?'disabled':''}>${esc(schedulePersonLabel(item)+warning)}</option>`;
  }
  function scheduleHelperOption(item,selected,route){
    const same=String(item.id??'')===String(selected??'');
    const check=scheduleHelperEligibility(item,route);
    const blocked=!check.eligible&&!same;
    const warning=!check.eligible?` · ⚠ ${check.reason}`:'';
    return `<option value="${esc(item.id??'')}" ${same?'selected':''} ${blocked?'disabled':''}>${esc(scheduleHelperLabel(item)+warning)}</option>`;
  }
  function scheduleHelperOptions(selected,routeId=''){
    const route=scheduleData.routes?.find((item)=>String(item.id)===String(routeId));
    const helpers=(scheduleData.helpers||[]);
    const routeHelpers=helpers.filter((item)=>item.ajudante_rota);
    const regularHelpers=helpers.filter((item)=>!item.ajudante_rota);
    const group=(label,list)=>list.length?`<optgroup label="${esc(label)}">${list.map((item)=>scheduleHelperOption(item,selected,route)).join('')}</optgroup>`:'';
    return [option('','Nenhum',selected),group(`AJUDANTES DE ROTA (${routeHelpers.length})`,routeHelpers),group(`DEMAIS AJUDANTES (${regularHelpers.length})`,regularHelpers)].join('');
  }
  function scheduleAllocationPlanForVehicle(vehicleId=''){
    const vehicle=(scheduleData.vehicles||[]).find((item)=>String(item.id)===String(vehicleId));
    const plate=normalize(String(vehicle?.placa||'').replace(/[^A-Z0-9]/g,''));if(!plate)return null;
    return (scheduleData.allocationPlans||[]).find((plan)=>{const p=normalize(String(plan.placa||'').replace(/[^A-Z0-9]/g,'')),legacy=normalize(String(plan.placa_substituta||'').replace(/[^A-Z0-9]/g,''));return plate===p||Boolean(legacy&&plate===legacy);})||null;
  }
  function scheduleAllocationVacationTriggered(plan={}){
    const id=String(plan.motorista_id||'');if(!id)return false;
    return (scheduleData.drivers||[]).some((driver)=>String(driver.id||'')===id&&['FERIAS','FÉRIAS','RESERVADO'].includes(normalize(driver.status||'')));
  }
  function scheduleAllocationDriverAllowed(plan={},driverId=''){
    const id=String(driverId||'');if(!id)return true;
    if([plan.motorista_id,plan.motorista_substituto_id].filter(Boolean).map(String).includes(id))return true;
    return scheduleAllocationVacationTriggered(plan);
  }
  function scheduleAllocationHelperAllowed(plan={},helperIds=[]){
    const planned=String(plan.ajudante_id||'');if(!planned)return true;
    return helperIds.filter(Boolean).map(String).includes(planned);
  }
  // Almoxarifado, serviço administrativo/outros e demais viagens internas não entram no plano de alocação.
  function scheduleOutsideAllocationPlan(route){return scheduleRouteIsAdministrative(route)||/\b(CAIXAS?|ALMOXARIFADO|VENEZA|MANOBRA|MANUTENCAO|THERMOBRASIL|SERVICO ADM|SERVICO ADMINISTRATIVO)\b/.test(normalize(String(route?.rota||route?.nome||'')).replace(/[^A-Z0-9]+/g,' '));}
  function refreshScheduleAllocationWarnings(row){
    if(!row)return;const vehicleId=$('[data-key="veiculo_id"]',row)?.value||'';const outside=scheduleOutsideAllocationPlan(scheduleRouteOfRow(row));const plan=outside?null:scheduleAllocationPlanForVehicle(vehicleId);
    const driverId=$('[data-key="motorista_id"]',row)?.value||'',h1=$('[data-key="ajudante_1_id"]',row)?.value||'',h2=$('[data-key="ajudante_2_id"]',row)?.value||'';
    const driverNode=$('[data-allocation-warning="driver"]',row),helperNode=$('[data-allocation-warning="helper"]',row);
    const set=(node,message)=>{if(!node)return;node.textContent=message||'';node.classList.toggle('is-hidden',!message);};
    const principalNode=$('[data-plan-principal]',row);
    if(principalNode){
      const principal=plan?(scheduleData.drivers||[]).find((d)=>String(d.id||'')===String(plan.motorista_id||'')):null;
      const st=principal?normalize(principal.status||''):'';
      principalNode.textContent=plan&&(plan.motorista||principal)?`Principal da placa: ${principal?.nome||plan.motorista}${['FERIAS','FÉRIAS','RESERVADO'].includes(st)?` · ${st==='RESERVADO'?'RESERVADO':'FÉRIAS'} (qualquer motorista valida o plano)`:''}`:'';
      principalNode.classList.toggle('is-hidden',!principalNode.textContent);
    }
    if(!plan){set(driverNode,'');set(helperNode,'');return;}
    const vehicle=(scheduleData.vehicles||[]).find((item)=>String(item.id)===String(vehicleId));const plate=vehicle?.placa||plan.placa||'';
    set(driverNode,driverId&&!scheduleAllocationDriverAllowed(plan,driverId)?`⚠ Motorista não previsto para a placa ${plate}. Aviso apenas; a escala pode ser salva.`:'');
    const anyHelper=Boolean(h1||h2);const helperName=plan.ajudante||'ajudante cadastrado';
    set(helperNode,anyHelper&&!scheduleAllocationHelperAllowed(plan,[h1,h2])?`⚠ Ajudante não previsto para a placa ${plate}. Previsto: ${helperName}. Aviso apenas; a escala pode ser salva.`:'');
  }
  function scheduleRow(record={}) {
    const temp=!record.id;
    const clientId=record.client_id || (temp?`ESC-C-${crypto.randomUUID().toUpperCase()}`:'');
    const id=record.id || `new-${clientId}`;
    const locked=['EM ROTA','PERNOITE','RETORNOU','FINALIZADO'].includes(normalize(record.status));
    const disabled=(!canWrite()||locked)?'disabled':'';
    const routeOptions=[option('','Selecione...',record.rota_id),...(scheduleData.routes||[]).map((x)=>option(x.id,x.rota,record.rota_id))].join('');
    const vehicleOptions=[option('','Selecione...',record.veiculo_id),...(scheduleData.vehicles||[]).map((x)=>option(x.id,scheduleVehicleLabel(x),record.veiculo_id))].join('');
    const currentVehicle=scheduleData.vehicles?.find((x)=>String(x.id)===String(record.veiculo_id));
    const driverOptions=[option('','Selecione...',record.motorista_id),...(scheduleData.drivers||[]).map((x)=>scheduleDriverOption(x,record.motorista_id,currentVehicle,(scheduleData.routes||[]).find((r)=>String(r.id)===String(record.rota_id))))].join('');
    const helperOptions=(selected)=>scheduleHelperOptions(selected,record.rota_id);
    const team=record.tipo_equipe || 'UM_AJUDANTE';
    // Com segundo motorista (carona), a vaga de "Ajudante 1" guarda um motorista: a lista inicial precisa ser de motoristas.
    const slot1Options=(selected)=>['DOIS_MOTORISTAS','TRES_MOTORISTAS'].includes(team)?[option('','Selecione...',selected),...(scheduleData.drivers||[]).map((x)=>scheduleDriverOption(x,selected,currentVehicle,(scheduleData.routes||[]).find((r)=>String(r.id)===String(record.rota_id))))].join(''):helperOptions(selected);
    const slot2Options=(selected)=>team==='TRES_MOTORISTAS'?[option('','Selecione...',selected),...(scheduleData.drivers||[]).map((x)=>scheduleDriverOption(x,selected,currentVehicle,(scheduleData.routes||[]).find((r)=>String(r.id)===String(record.rota_id))))].join(''):helperOptions(selected);
    const warnings=record.avisos||[];
    const forecast=record.previsao_retorno ? formatDate(record.previsao_retorno) : '—';
    const syncError=String(record.__sync_error||'');
    const routeSummary=record.rota||scheduleData.routes?.find((x)=>String(x.id)===String(record.rota_id))?.rota||'Rota não definida';
    const summaryVehicle=scheduleData.vehicles?.find((x)=>String(x.id)===String(record.veiculo_id));
    const plateSummary=`${record.placa||summaryVehicle?.placa||'Sem placa'}${summaryVehicle?.apelido?` (${summaryVehicle.apelido})`:''}`;
    const driverSummary=record.motorista||scheduleData.drivers?.find((x)=>String(x.id)===String(record.motorista_id))?.nome||'Sem motorista';
    const editing=temp||record.__draft||Boolean(syncError);
    const compactActionLabel=locked||!canWrite()?'Detalhes':'Editar';
    return `<tr data-route-schedule-row data-status="${esc(normalize(record.status||'PROGRAMADO'))}" data-plan-just-saved="${esc(record.justificativa_plano||'')}" data-plan-just-saved-driver="${esc(record.justificativa_plano_motorista_id||'')}" data-id="${esc(id)}" data-client-id="${esc(clientId)}" data-storage="${esc(record.storage||'')}" data-locked="${locked?'1':'0'}" data-dirty="${temp||record.__draft?'1':'0'}" data-sync-error="${esc(syncError)}" data-forecast="${esc(record.previsao_retorno||'')}" class="${editing?'is-editing ':''}${syncError?'row-danger':warnings.length?'row-warning':''}">
      <td class="schedule-sticky-sequence" data-label="Seq." data-summary="${esc(record.sequencia||'—')}">
        <div class="schedule-sequence-cell"><input data-key="sequencia" value="${esc(record.sequencia||'')}" ${disabled}><span class="schedule-summary-sequence">${esc(record.sequencia||'—')}</span>${warnings.length?`<button class="schedule-warning-badge" type="button" title="${esc(warnings.join(' • '))}">!</button>`:''}<button class="btn btn-ghost btn-xs schedule-edit-toggle" type="button" data-route-schedule-toggle aria-expanded="${editing?'true':'false'}">${editing?'Recolher':compactActionLabel}</button></div>
        <div class="schedule-compact-row" data-route-schedule-summary data-status="${esc(normalize(record.status||'PROGRAMADO'))}">
          <div class="schedule-compact-seq"><span>SEQ</span><strong data-route-summary="sequencia">${esc(record.sequencia||'—')}</strong></div>
          <div class="schedule-compact-route"><span>Rota</span><strong data-route-summary="rota">${esc(routeSummary)}</strong><small data-route-summary="regiao">${esc(record.regiao||'—')}</small></div>
          <div class="schedule-compact-field"><span>Placa</span><strong data-route-summary="placa">${esc(plateSummary)}</strong></div>
          <div class="schedule-compact-field schedule-compact-driver"><span>Motorista</span><strong data-route-summary="motorista" title="${esc(driverSummary)}">${esc(driverSummary)}</strong><div data-route-summary-work="driver">${scheduleSelectedPersonSignal(record,'driver',true)}</div></div>
          <div class="schedule-compact-field schedule-compact-helpers"><span>Ajudante(s)</span><div data-route-summary-helpers>${scheduleCompactHelpers(record)}</div></div>
          <div class="schedule-compact-field schedule-compact-time"><span>Saída</span><strong data-route-summary="horario">${esc(record.horario_ponto||scheduleData.defaults?.departureTime||'06:00')}</strong></div>
          <div class="schedule-compact-status"><span>Status</span><div data-route-summary="status">${badge(record.status||'PROGRAMADO')}</div></div>
          <button class="btn btn-ghost btn-sm schedule-compact-action" type="button" data-route-schedule-summary-toggle aria-expanded="false">${compactActionLabel}</button>
        </div>
      </td>
      <td data-label="OC(s)"><input data-key="ocs" value="${esc(record.ocs||'')}" ${disabled}></td>
      <td data-label="Peso (kg)"><input data-key="peso_kg" inputmode="decimal" value="${esc(record.peso_kg??'')}" ${disabled}></td>
      <td data-label="Entregas"><input data-key="qtd_entregas" type="number" min="0" step="1" value="${esc(record.qtd_entregas??0)}" ${disabled}></td>
      <td data-label="Rota" data-summary="${esc(routeSummary)}"><select data-key="rota_id" ${!canWrite()?'disabled':''}>${routeOptions}</select></td>
      <td data-label="Região" data-route-region>${esc(record.regiao||'—')}</td>
      <td data-label="Placa / veículo" data-summary="${esc(plateSummary)}"><select data-key="veiculo_id" ${disabled}>${vehicleOptions}</select><small class="schedule-plan-principal is-hidden" data-plan-principal></small></td>
      <td data-label="Motorista" data-summary="${esc(driverSummary)}"><select data-key="motorista_id" ${disabled}>${driverOptions}</select><div data-work-signal="driver">${scheduleSelectedPersonSignal(record,'driver')}</div><small class="schedule-allocation-warning is-hidden" data-allocation-warning="driver"></small></td>
      <td data-label="Ajudante 1"><select data-key="ajudante_1_id" ${disabled}>${slot1Options(record.ajudante_1_id)}</select><div data-work-signal="h1">${scheduleSelectedPersonSignal(record,'h1')}</div><small class="schedule-allocation-warning is-hidden" data-allocation-warning="helper"></small></td>
      <td data-label="Ajudante 2"><select data-key="ajudante_2_id" ${disabled}>${slot2Options(record.ajudante_2_id)}</select><div data-work-signal="h2">${scheduleSelectedPersonSignal(record,'h2')}</div></td>
      <td data-label="Equipe"><select data-key="tipo_equipe" ${disabled}>${['TERCEIRO','CARGA_FECHADA','UM_AJUDANTE','DOIS_AJUDANTES','SEM_AJUDANTE'].map((x)=>option(x,teamLabel(x),team)).join('')}<option value="DOIS_MOTORISTAS" hidden ${team==='DOIS_MOTORISTAS'?'selected':''}>${esc(teamLabel('DOIS_MOTORISTAS'))}</option><option value="TRES_MOTORISTAS" hidden ${team==='TRES_MOTORISTAS'?'selected':''}>${esc(teamLabel('TRES_MOTORISTAS'))}</option></select><label class="schedule-extra-driver" title="Adiciona um segundo motorista para ir de carona (máximo de 3 pessoas no carro: 1 ajudante)"><input type="checkbox" style="width:16px!important;min-width:16px!important;max-width:16px!important;height:16px!important;min-height:0!important;padding:0!important;margin:0!important;border:0!important;flex:none" data-extra-driver ${['DOIS_MOTORISTAS','TRES_MOTORISTAS'].includes(team)?'checked':''} ${disabled}><span>Segundo motorista (carona)</span></label><label class="schedule-extra-driver" data-third-driver-label title="Esta placa permite até 3 motoristas" hidden><input type="checkbox" style="width:16px!important;min-width:16px!important;max-width:16px!important;height:16px!important;min-height:0!important;padding:0!important;margin:0!important;border:0!important;flex:none" data-third-driver ${team==='TRES_MOTORISTAS'?'checked':''} ${disabled}><span>Terceiro motorista</span></label><input type="text" class="schedule-carona-motivo" data-carona-motivo maxlength="200" placeholder="O que ele vai fazer? Ex.: Buscar SMX0A05 na Veneza" value="${esc(record.carona_motivo||'')}" ${['DOIS_MOTORISTAS','TRES_MOTORISTAS'].includes(team)?'':'hidden'} ${disabled}></td>
      <td data-label="Horário de saída" data-summary="${esc(record.horario_ponto||scheduleData.defaults?.departureTime||'06:00')}"><input data-key="horario_ponto" type="time" value="${esc(record.horario_ponto||scheduleData.defaults?.departureTime||'06:00')}" ${disabled}></td>
      <td data-label="Frio programado (°C)"><input data-key="temperatura_frio_c" type="number" step="0.1" inputmode="decimal" placeholder="Ex.: -8" value="${esc(record.temperatura_frio_c??record.TEMPERATURA_FRIO_C??'')}" ${disabled}></td>
      <td data-label="Previsão de retorno"><strong>${esc(forecast)}</strong></td>
      <td data-label="Status" data-summary="${esc(record.status||'PROGRAMADO')}">${badge(record.status||'PROGRAMADO')}<input data-key="status" type="hidden" value="${esc(record.status||'PROGRAMADO')}"></td>
      <td data-label="Observação"><textarea class="schedule-observation-input" data-key="observacoes" rows="2" maxlength="4000" placeholder="Informação operacional da escala" ${disabled}>${esc(record.observacoes||'')}</textarea></td>
      <td data-label="Ações"><div class="schedule-actions">${canWrite()?`<button class="btn btn-secondary btn-xs" data-route-schedule-save>Salvar</button>${locked&&isAdmin()?'<button class="btn btn-primary btn-xs" data-route-schedule-admin-correct>Corrigir equipe (ADM)</button>':''}${temp?'<button class="btn btn-danger btn-xs" data-route-schedule-remove>Remover</button>':`<button class="btn btn-ghost btn-xs" data-route-schedule-cancel>Cancelar</button>${isAdmin()?'<button class="btn btn-danger btn-xs" data-route-schedule-delete>Excluir definitivamente</button>':''}`}`:'<span class="badge badge-info">Consulta</span>'}<small data-route-schedule-error class="schedule-save-error ${syncError?'':'is-hidden'}">${esc(syncError)}</small></div></td>
    </tr>`;
  }
  function readScheduleRow(row,date) {
    const out={id:row.dataset.id,client_id:row.dataset.clientId||'',storage:row.dataset.storage||'',data:date};
    $$('[data-key]',row).forEach((input)=>out[input.dataset.key]=input.value);
    if(String(out.id).startsWith('new-'))delete out.id;
    if(row.dataset.planJust&&String(row.dataset.planJustDriver||'')===String(out.motorista_id||''))out.justificativa_plano=row.dataset.planJust;
    const route=scheduleData.routes.find((x)=>String(x.id)===String(out.rota_id));
    const vehicle=scheduleData.vehicles.find((x)=>String(x.id)===String(out.veiculo_id));
    const driver=scheduleData.drivers.find((x)=>String(x.id)===String(out.motorista_id));
    const h1=(['DOIS_MOTORISTAS','TRES_MOTORISTAS'].includes(out.tipo_equipe)?scheduleData.drivers:scheduleData.helpers).find((x)=>String(x.id)===String(out.ajudante_1_id)); const h2=(out.tipo_equipe==='TRES_MOTORISTAS'?scheduleData.drivers:scheduleData.helpers).find((x)=>String(x.id)===String(out.ajudante_2_id));
    out.rota=route?.rota||'';out.regiao=route?.regiao||'';out.placa=vehicle?.placa||'';out.motorista=driver?.nome||'';out.ajudante_1=h1?.nome||'';out.ajudante_2=h2?.nome||'';
    out.qtd_entregas=Math.max(0,Math.round(Number(out.qtd_entregas||0)||0));
    out.carona_motivo=['DOIS_MOTORISTAS','TRES_MOTORISTAS'].includes(out.tipo_equipe)?String($('[data-carona-motivo]',row)?.value||'').trim():'';
    out.previsao_retorno=row.dataset.forecast||'';
    return out;
  }
  function adminCorrectDepartedSchedule(row){
    if(!row||!isAdmin())return;
    const date=$('#route-schedule-date')?.value||scheduleData.date||today();
    const current=readScheduleRow(row,date);
    const identity=scheduleMutationIdentity(row);
    const vehicleOptions=[option('','Selecione...',current.veiculo_id),...(scheduleData.vehicles||[]).map((item)=>option(String(item.id||''),scheduleVehicleLabel(item),current.veiculo_id))].join('');
    const driverOptions=[option('','Selecione...',current.motorista_id),...(scheduleData.drivers||[]).map((item)=>option(String(item.id||''),schedulePersonLabel(item),current.motorista_id))].join('');
    const helperSimpleOptions=(selected)=>[option('','Nenhum',selected),...(scheduleData.helpers||[]).map((item)=>option(String(item.id||''),scheduleHelperLabel(item),selected))].join('');
    modal({
      title:'Corrigir equipe/veículo após a saída',
      confirmText:'Salvar correção ADM',
      body:`<div class="warning-box"><strong>Correção administrativa:</strong> use somente quando a substituição ocorreu de fato e não foi registrada antes da saída. A alteração será sincronizada com Escala, Controle de Saída, Monitoramento e Retorno, mantendo auditoria do valor anterior, novo valor, usuário e justificativa.</div>
        <div class="form-grid">
          <label class="field span-2"><span>Escala</span><input value="${esc(`${current.rota||'—'} · ${current.placa||'—'} · ${current.motorista||'—'}`)}" disabled></label>
          <label class="field"><span>Veículo efetivo</span><select id="schedule-admin-vehicle">${vehicleOptions}</select></label>
          <label class="field"><span>Motorista efetivo</span><select id="schedule-admin-driver">${driverOptions}</select></label>
          <label class="field"><span>Ajudante 1 efetivo</span><select id="schedule-admin-helper1">${helperSimpleOptions(current.ajudante_1_id)}</select></label>
          <label class="field"><span>Ajudante 2 efetivo</span><select id="schedule-admin-helper2">${helperSimpleOptions(current.ajudante_2_id)}</select></label>
          <label class="field"><span>Tipo de equipe</span><select id="schedule-admin-team">${['TERCEIRO','CARGA_FECHADA','UM_AJUDANTE','DOIS_AJUDANTES','SEM_AJUDANTE','DOIS_MOTORISTAS'].map((item)=>option(item,teamLabel(item),current.tipo_equipe||'UM_AJUDANTE')).join('')}</select></label>
          <label class="field span-2"><span>Justificativa obrigatória</span><textarea id="schedule-admin-reason" maxlength="1000" placeholder="Ex.: ajudante substituído na portaria e a troca não foi registrada antes da saída"></textarea></label>
        </div>`,
      onConfirm:async(root)=>{
        const vehicleId=$('#schedule-admin-vehicle',root).value;
        const driverId=$('#schedule-admin-driver',root).value;
        const helper1Id=$('#schedule-admin-helper1',root).value;
        const helper2Id=$('#schedule-admin-helper2',root).value;
        const vehicle=(scheduleData.vehicles||[]).find((item)=>String(item.id)===String(vehicleId));
        const driver=(scheduleData.drivers||[]).find((item)=>String(item.id)===String(driverId));
        const helper1=(scheduleData.helpers||[]).find((item)=>String(item.id)===String(helper1Id));
        const helper2=(scheduleData.helpers||[]).find((item)=>String(item.id)===String(helper2Id));
        const reason=$('#schedule-admin-reason',root).value.trim();
        if(!reason)throw new Error('Informe a justificativa da correção.');
        if(!vehicleId)throw new Error('Selecione o veículo efetivo.');
        if(!driverId)throw new Error('Selecione o motorista efetivo.');
        const result=await api('/api/schedule',{method:'POST',body:JSON.stringify({
          action:'admin_correct_resources',id:row.dataset.id,storage:row.dataset.storage,identity,requestId:crypto.randomUUID(),
          veiculo_id:vehicleId,placa:vehicle?.placa||'',motorista_id:driverId,motorista:driver?.nome||'',
          ajudante_1_id:helper1Id,ajudante_1:helper1?.nome||'',ajudante_2_id:helper2Id,ajudante_2:helper2?.nome||'',
          tipo_equipe:$('#schedule-admin-team',root).value,justificativa:reason,
        })});
        const changed=result?.record?.correcao_adm?.changes?.map((item)=>item.campo).join(', ')||'recursos';
        toast(`Correção administrativa salva e sincronizada: ${changed}.`,'success');
        await renderSchedule(date);
      },
    });
  }
  function updateScheduleWorkSignals(row){
    if(!row)return;const routeId=$('[data-key="rota_id"]',row)?.value;const route=scheduleData.routes?.find((x)=>String(x.id)===String(routeId));const days=Math.max(1,Number(route?.duracao_dias||1));
    const started=['EM ROTA','PERNOITE','RETORNOU','FINALIZADO'].includes(normalize($('[data-key="status"]',row)?.value||''));
    const teamValue=normalize($('[data-key="tipo_equipe"]',row)?.value);const thirdDriverRow=teamValue==='TRES_MOTORISTAS';const secondDriverRow=teamValue==='DOIS_MOTORISTAS'||thirdDriverRow;
    const pairs=[['driver','motorista_id',scheduleData.drivers||[]],['h1','ajudante_1_id',(secondDriverRow?scheduleData.drivers:scheduleData.helpers)||[]],['h2','ajudante_2_id',(thirdDriverRow?scheduleData.drivers:scheduleData.helpers)||[]]];
    pairs.forEach(([slot,key,list])=>{const id=$(`[data-key="${key}"]`,row)?.value;const item=list.find((x)=>String(x.id)===String(id));const node=$(`[data-work-signal="${slot}"]`,row);if(node)node.innerHTML=scheduleWorkLight(item,days,started);});
    const driverId=$('[data-key="motorista_id"]',row)?.value;const driver=(scheduleData.drivers||[]).find((x)=>String(x.id)===String(driverId));const compactDriver=$('[data-route-summary-work="driver"]',row);if(compactDriver)compactDriver.innerHTML=scheduleCompactWorkLight(driver,days,started);
    const h1id=$('[data-key="ajudante_1_id"]',row)?.value,h2id=$('[data-key="ajudante_2_id"]',row)?.value;const h1=((secondDriverRow?scheduleData.drivers:scheduleData.helpers)||[]).find((x)=>String(x.id)===String(h1id)),h2=((thirdDriverRow?scheduleData.drivers:scheduleData.helpers)||[]).find((x)=>String(x.id)===String(h2id));
    const compactHelpers=$('[data-route-summary-helpers]',row);if(compactHelpers){const helperParts=[[h1,$('[data-key="ajudante_1_id"]',row)?.selectedOptions?.[0]?.textContent?.split(' · ')[0]||''],[h2,$('[data-key="ajudante_2_id"]',row)?.selectedOptions?.[0]?.textContent?.split(' · ')[0]||'']].filter(([item,name])=>item&&name);const team=normalize($('[data-key="tipo_equipe"]',row)?.value||'');compactHelpers.innerHTML=helperParts.length?(team==='DOIS_MOTORISTAS'?'<small class="schedule-compact-empty">2º MOTORISTA</small>':team==='TRES_MOTORISTAS'?'<small class="schedule-compact-empty">2º E 3º MOTORISTAS</small>':'')+helperParts.map(([item,name])=>`<div class="schedule-compact-helper-person"><strong>${esc(name)}</strong>${scheduleCompactWorkLight(item,days,started)}</div>`).join(''):`<small class="schedule-compact-empty">${team==='CARGA_FECHADA'?'Carga fechada':team==='TERCEIRO'?'Terceiro':'Sem ajudante'}</small>`;}
  }
  function refreshScheduleCandidateOptions(row){
    if(!row)return;const routeId=$('[data-key="rota_id"]',row)?.value||'';const vehicleId=$('[data-key="veiculo_id"]',row)?.value||'';
    const route=scheduleData.routes?.find((x)=>String(x.id)===String(routeId));const vehicle=scheduleData.vehicles?.find((x)=>String(x.id)===String(vehicleId));
    const driver=$('[data-key="motorista_id"]',row);if(driver){const selected=driver.value;const list=(scheduleData.drivers||[]);driver.innerHTML=[option('','Selecione...',selected),...list.map((x)=>scheduleDriverOption(x,selected,vehicle,route))].join('');}
    const teamNow=normalize($('[data-key="tipo_equipe"]',row)?.value);const thirdDriverTeam=teamNow==='TRES_MOTORISTAS',secondDriverTeam=teamNow==='DOIS_MOTORISTAS'||thirdDriverTeam;
    for(const key of ['ajudante_1_id','ajudante_2_id']){const select=$(`[data-key="${key}"]`,row);if(!select)continue;const selected=select.value;select.innerHTML=((secondDriverTeam&&key==='ajudante_1_id')||(thirdDriverTeam&&key==='ajudante_2_id'))?[option('','Selecione...',selected),...(scheduleData.drivers||[]).map((x)=>scheduleDriverOption(x,selected,vehicle,route))].join(''):scheduleHelperOptions(selected,routeId);}
  }
  function scheduleRouteOfRow(row){return scheduleData.routes?.find((x)=>String(x.id)===String($('[data-key="rota_id"]',row)?.value));}
  function scheduleRouteIsAdministrative(route){return ['ADMINISTRATIVO','OUTROS'].includes(normalize(route?.tipo_servico||''));}
  function applyTeam(row) {
    const vehicle=$('[data-key="veiculo_id"]',row); const team=$('[data-key="tipo_equipe"]',row); const h1=$('[data-key="ajudante_1_id"]',row); const h2=$('[data-key="ajudante_2_id"]',row);
    const selected=scheduleData.vehicles.find((v)=>String(v.id)===String(vehicle?.value));
    const route=scheduleRouteOfRow(row),administrative=scheduleRouteIsAdministrative(route);
    const third=/TERCEIR/.test(normalize(selected?.vinculo));
    if(third)team.value='TERCEIRO'; else if(team.value==='TERCEIRO')team.value=administrative?'SEM_AJUDANTE':'UM_AJUDANTE';
    // Serviço administrativo/outros: placa e ajudante opcionais (sem ajudante vira SEM AJUDANTE).
    if(administrative&&!third&&['UM_AJUDANTE','DOIS_AJUDANTES'].includes(team.value)&&!h1?.value&&!h2?.value)team.value='SEM_AJUDANTE';
    // Placa que permite até 3 motoristas (ex.: T-Cross) habilita a equipe com 3 motoristas; fora dela volta para 2.
    const maxDrivers=Math.max(1,Number(selected?.max_motoristas||1)||1);
    if(team.value==='TRES_MOTORISTAS'&&maxDrivers<3)team.value='DOIS_MOTORISTAS';
    const thirdDriver=team.value==='TRES_MOTORISTAS';
    const secondDriver=team.value==='DOIS_MOTORISTAS'||thirdDriver;
    const noHelpers=['TERCEIRO','CARGA_FECHADA','SEM_AJUDANTE'].includes(team.value);
    h1.disabled=noHelpers||row.dataset.locked==='1'||!canWrite(); h2.disabled=!['DOIS_AJUDANTES','DOIS_MOTORISTAS','TRES_MOTORISTAS'].includes(team.value)||row.dataset.locked==='1'||!canWrite();
    if(noHelpers){h1.value='';h2.value='';} if(team.value==='UM_AJUDANTE')h2.value='';
    // A vaga de "Ajudante 1" vira "Motorista 2" quando a equipe é de dois motoristas.
    const h1cell=h1?.closest('td');if(h1cell)h1cell.classList.toggle('is-second-driver',secondDriver);
    const extraBox=$('[data-extra-driver]',row);if(extraBox)extraBox.checked=secondDriver;
    const caronaInput=$('[data-carona-motivo]',row);if(caronaInput)caronaInput.hidden=!secondDriver;
    const thirdLabel=$('[data-third-driver-label]',row);if(thirdLabel)thirdLabel.hidden=!(secondDriver&&maxDrivers>=3);const thirdBox=$('[data-third-driver]',row);if(thirdBox)thirdBox.checked=thirdDriver;
    const h2cell=h2?.closest('td');if(h2cell){h2cell.classList.toggle('is-second-driver-helper',secondDriver&&!thirdDriver);h2cell.classList.toggle('is-third-driver',thirdDriver);}
    const regionCell=$('[data-route-region]',row);if(regionCell&&route)regionCell.textContent=`${route.regiao||'—'}${administrative?` · ${normalize(route.tipo_servico)==='OUTROS'?'OUTROS':'SERVIÇO ADM.'}`:''}`;
    const vehicleCell=vehicle?.closest('td');if(vehicleCell)vehicleCell.classList.toggle('is-optional-field',administrative);
  }
  function syncScheduleSummary(row){
    if(!row)return;const date=$('#route-schedule-date')?.value||scheduleData.date||today();const current=readScheduleRow(row,date);
    const values={1:current.sequencia||'—',5:current.rota||'Rota não definida',7:current.placa||'Sem placa',8:current.motorista||'Sem motorista',12:current.horario_ponto||'—',15:current.status||'PROGRAMADO'};
    Object.entries(values).forEach(([index,value])=>{const cell=row.children[Number(index)-1];if(cell)cell.dataset.summary=value;});
    const sequenceSummary=$('.schedule-summary-sequence',row);if(sequenceSummary)sequenceSummary.textContent=current.sequencia||'—';
    const compactValues={sequencia:current.sequencia||'—',rota:current.rota||'Rota não definida',regiao:current.regiao||'—',placa:`${current.placa||'Sem placa'}${scheduleData.vehicles?.find((v)=>String(v.id)===String(current.veiculo_id))?.apelido?` (${scheduleData.vehicles.find((v)=>String(v.id)===String(current.veiculo_id)).apelido})`:''}`,motorista:current.motorista||'Sem motorista',horario:current.horario_ponto||'—'};
    Object.entries(compactValues).forEach(([key,value])=>{const node=$(`[data-route-summary="${key}"]`,row);if(node)node.textContent=value;});
    const compactStatus=$('[data-route-summary="status"]',row);if(compactStatus)compactStatus.innerHTML=badge(current.status||'PROGRAMADO');const compactRowEl=$('.schedule-compact-row',row);if(compactRowEl)compactRowEl.dataset.status=normalize(current.status||'PROGRAMADO');row.dataset.status=normalize(current.status||'PROGRAMADO');
  }
  function setScheduleEditing(row,editing){
    if(!row)return;row.classList.toggle('is-editing',Boolean(editing));const label=editing?'Recolher':row.dataset.locked==='1'||!canWrite()?'Detalhes':'Editar';$$('[data-route-schedule-toggle],[data-route-schedule-summary-toggle]',row).forEach((button)=>{button.setAttribute('aria-expanded',editing?'true':'false');button.textContent=label;});
  }
  function bindScheduleRows() {
    $$('[data-route-schedule-row]').forEach((row)=>{
      if(row.dataset.scheduleBound==='1')return;
      row.dataset.scheduleBound='1';
      const route=$('[data-key="rota_id"]',row);
      const markDirty=()=>{syncScheduleSummary(row);if(row.dataset.locked==='1')return;row.dataset.dirty='1';scheduleDraftSoon();updateScheduleSyncState();};
      if(route) route.onchange=()=>{const r=scheduleData.routes.find((x)=>String(x.id)===String(route.value));$('[data-route-region]',row).textContent=r?.regiao||'—';applyTeam(row);refreshScheduleCandidateOptions(row);applyScheduleAutomaticObservation(row);markDirty();updateScheduleWorkSignals(row);};
      $$('[data-route-schedule-toggle],[data-route-schedule-summary-toggle]',row).forEach((button)=>button.addEventListener('click',()=>setScheduleEditing(row,!row.classList.contains('is-editing'))));
      const vehicle=$('[data-key="veiculo_id"]',row), team=$('[data-key="tipo_equipe"]',row); if(vehicle)vehicle.onchange=()=>{applyTeam(row);refreshScheduleCandidateOptions(row);refreshScheduleAllocationWarnings(row);markDirty();};if(team)team.onchange=()=>{applyTeam(row);refreshScheduleCandidateOptions(row);refreshScheduleAllocationWarnings(row);markDirty();};$('[data-carona-motivo]',row)?.addEventListener('input',markDirty);const thirdDriver=$('[data-third-driver]',row);if(thirdDriver&&team)thirdDriver.onchange=()=>{team.value=thirdDriver.checked?'TRES_MOTORISTAS':'DOIS_MOTORISTAS';applyTeam(row);refreshScheduleCandidateOptions(row);refreshScheduleAllocationWarnings(row);markDirty();};const extraDriver=$('[data-extra-driver]',row);if(extraDriver&&team)extraDriver.onchange=()=>{if(extraDriver.checked){if(team.value!=='TRES_MOTORISTAS')team.value='DOIS_MOTORISTAS';}else if(['DOIS_MOTORISTAS','TRES_MOTORISTAS'].includes(team.value))team.value=scheduleRouteIsAdministrative(scheduleRouteOfRow(row))?'SEM_AJUDANTE':'UM_AJUDANTE';applyTeam(row);refreshScheduleCandidateOptions(row);refreshScheduleAllocationWarnings(row);markDirty();};applyTeam(row);refreshScheduleCandidateOptions(row);updateScheduleWorkSignals(row);refreshScheduleAllocationWarnings(row);
      $$('[data-key]',row).forEach((input)=>{
        const updateAuto=()=>{if(['ocs','temperatura_frio_c'].includes(input.dataset.key))applyScheduleAutomaticObservation(row);};
        input.addEventListener('input',()=>{updateAuto();markDirty();});
        input.addEventListener('change',()=>{updateAuto();markDirty();if(['motorista_id','ajudante_1_id','ajudante_2_id'].includes(input.dataset.key)){updateScheduleWorkSignals(row);refreshScheduleAllocationWarnings(row);}});
      });
      $('[data-route-schedule-remove]',row)?.addEventListener('click',()=>{row.remove();updateScheduleCount();scheduleDraftSoon();});
      $('[data-route-schedule-save]',row)?.addEventListener('click',()=>saveScheduleRows([row]));
      $('[data-route-schedule-admin-correct]',row)?.addEventListener('click',()=>adminCorrectDepartedSchedule(row));
      $('[data-route-schedule-cancel]',row)?.addEventListener('click',()=>cancelSchedule(row));
      $('[data-route-schedule-delete]',row)?.addEventListener('click',()=>deleteSchedule(row));
    });
    updateScheduleSyncState();
  }
  // Detecta motorista fora do plano de alocação da placa (exceto quando o principal está de férias/reservado)
  // e que ainda não tem justificativa registrada para este motorista.
  function scheduleAllocationDeviation(row,record){
    if(!record?.veiculo_id||!record?.motorista_id||scheduleOutsideAllocationPlan(scheduleData.routes?.find((x)=>String(x.id)===String(record.rota_id))||{rota:record.rota}))return null;
    const plan=scheduleAllocationPlanForVehicle(record.veiculo_id);if(!plan)return null;
    const plannedIds=[plan.motorista_id,plan.motorista_substituto_id].filter(Boolean).map(String);
    if(!plannedIds.length||scheduleAllocationDriverAllowed(plan,record.motorista_id))return null;
    const existing=row.dataset.planJust&&String(row.dataset.planJustDriver||'')===String(record.motorista_id)?row.dataset.planJust:(String(row.dataset.planJustSavedDriver||'')===String(record.motorista_id)?row.dataset.planJustSaved:'');
    if(existing){record.justificativa_plano=existing;return null;}
    const driver=(scheduleData.drivers||[]).find((x)=>String(x.id)===String(record.motorista_id));
    const vehicle=(scheduleData.vehicles||[]).find((x)=>String(x.id)===String(record.veiculo_id));
    return {plate:vehicle?.placa||plan.placa||'',route:record.rota||'',driver:driver?.nome||record.motorista||'',planned:plan.motorista||'',substitute:plan.motorista_substituto||''};
  }
  function askAllocationJustifications(items){
    return new Promise((resolve)=>{
      let settled=false;const finish=(value)=>{if(settled)return;settled=true;observer.disconnect();resolve(value);};
      const body=`<div class="warning-box"><strong>Motorista diferente do plano de alocação.</strong> Informe por que o motorista original não será usado e qual a ação prevista. Essa justificativa aparece no Plano de Alocação para montar o plano de ação.</div>${items.map(({info},index)=>`<div class="allocation-justify-item"><div class="allocation-justify-head"><strong>${esc(info.plate||'—')}</strong><span>${esc(info.route||'')}</span></div><div class="allocation-justify-drivers"><span>Plano: <b>${esc(info.planned||'—')}</b>${info.substitute?` / ${esc(info.substitute)}`:''}</span><span>Escalado: <b>${esc(info.driver||'—')}</b></span></div><label class="field"><span>Justificativa (obrigatória)</span><textarea data-allocation-justification="${index}" placeholder="Ex.: motorista original em atendimento médico; retorno previsto para ..."></textarea></label></div>`).join('')}`;
      const observer=new MutationObserver(()=>{if(!$('[data-allocation-justification]'))finish(null);});
      modal({title:'Justificar motorista diferente do plano',confirmText:'Confirmar e salvar',body,
        onOpen:()=>{observer.observe($('#modal-root'),{childList:true,subtree:true});$('[data-allocation-justification]')?.focus();},
        onConfirm:async(root)=>{
          const answers=$$('[data-allocation-justification]',root).map((input)=>input.value.trim());
          if(answers.some((text)=>text.length<5))throw new Error('Informe a justificativa de cada motorista diferente do plano.');
          finish(answers);
        }});
    });
  }
  async function saveScheduleRows(rows) {
    const date=$('#route-schedule-date').value;
    const active=rows.filter((r)=>!r.hidden&&r.dataset.locked!=='1');
    active.forEach((row)=>applyScheduleAutomaticObservation(row));
    const pairs=active.map((row)=>({row,record:readScheduleRow(row,date)})).filter(({record})=>record.rota_id||record.motorista_id||record.veiculo_id||record.ocs||record.sequencia);
    if(!pairs.length)return toast('Nenhuma linha preenchida para salvar.','warning');
    // Motorista diferente do plano de alocação: pede a justificativa (plano de ação) antes de gravar.
    const deviations=pairs.map((pair)=>({pair,info:scheduleAllocationDeviation(pair.row,pair.record)})).filter((item)=>item.info);
    if(deviations.length){
      const answers=await askAllocationJustifications(deviations);
      if(!answers)return toast('Salvamento cancelado: a justificativa do motorista diferente do plano é obrigatória.','warning');
      deviations.forEach(({pair},index)=>{pair.row.dataset.planJust=answers[index];pair.row.dataset.planJustDriver=String(pair.record.motorista_id||'');pair.record.justificativa_plano=answers[index];});
    }
    // Nova tentativa nunca mantém a linha vermelha da falha anterior. O vermelho
    // só volta se TODAS as tentativas desta ação falharem novamente.
    active.forEach((r)=>clearScheduleRowError(r));

    // Antes de qualquer chamada ao servidor, grava o rascunho no navegador.
    // Atualizar a página, fechar a aba ou receber 503 não pode apagar o trabalho.
    persistScheduleDraftFromDom(date);

    // v1.0.12: lotes menores reduzem a duração de cada request no Cloudflare/D1.
    // Cada lote usa um único requestId. Se houver timeout/429/502/503/504 ou falha
    // de rede, api() refaz a mesma escrita até 3 tentativas sem trocar o body.
    const chunkSize=4;
    let savedCount=0,failedCount=0;
    const warnings=[];
    const applySuccess=(pair,record)=>{
      const row=pair?.row;if(!row||!record)return false;
      const previousId=pair.record?.id,clientId=pair.record?.client_id;
      if(row.dataset.planJust){row.dataset.planJustSaved=row.dataset.planJust;row.dataset.planJustSavedDriver=row.dataset.planJustDriver||'';}
      row.dataset.id=String(record.id||row.dataset.id);row.dataset.clientId='';row.dataset.storage=record.storage||row.dataset.storage||'';row.dataset.dirty='0';row.dataset.forecast=record.previsao_retorno||row.dataset.forecast||'';clearScheduleRowError(row);
      const forecastNode=$('td[data-label="Previsão de retorno"] strong',row);if(forecastNode)forecastNode.textContent=record.previsao_retorno?formatDate(record.previsao_retorno):'—';syncScheduleSummary(row);setScheduleEditing(row,false);
      const currentIndex=(scheduleData.schedules||[]).findIndex((item)=>String(item.id)===String(previousId||record.id)||(clientId&&String(item.client_id||'')===String(clientId)));
      if(currentIndex>=0)scheduleData.schedules[currentIndex]=record;else scheduleData.schedules.push(record);
      warnings.push(...(record.avisos||[]));
      savedCount+=1;
      return true;
    };
    const applyResult=(chunkPairs,result)=>{
      if(result?.committed!==true)return false;
      const resolvedIndexes=new Set();
      (result.errors||[]).forEach((err)=>{
        const index=Number(err.index),pair=chunkPairs[index],row=pair?.row;if(!row)return;
        const reason=scheduleErrorReason({message:err.message||'Linha rejeitada pelo servidor.',code:err.code||'SCHEDULE_ERROR',details:err.details||null});
        markScheduleRowError(row,reason);resolvedIndexes.add(index);failedCount+=1;
      });
      (result.successes||[]).forEach(({index,record})=>{
        const numericIndex=Number(index);if(resolvedIndexes.has(numericIndex))return;
        const pair=chunkPairs[numericIndex];
        if(applySuccess(pair,record))resolvedIndexes.add(numericIndex);
      });
      chunkPairs.forEach((pair,index)=>{
        if(resolvedIndexes.has(index))return;
        markScheduleRowError(pair.row,scheduleErrorReason({code:'SCHEDULE_EMPTY_RESPONSE',message:'o servidor respondeu ao lote, mas não informou o resultado desta linha.'}));
        failedCount+=1;
      });
      return true;
    };
    showLoading('Salvando escalas',`Confirmando 0 de ${pairs.length} linha(s) no servidor...`);
    try{
      for(let offset=0;offset<pairs.length;offset+=chunkSize){
        const chunkPairs=pairs.slice(offset,offset+chunkSize);
        const records=chunkPairs.map(({record})=>record);
        showLoading('Salvando escalas',`Confirmando ${Math.min(offset+records.length,pairs.length)} de ${pairs.length} linha(s) no servidor...`);
        let result=null;
        let batchError=null;
        try{
          const requestId=crypto.randomUUID();
          result=await api('/api/schedule',{
            method:'POST',timeoutMs:40000,connectionImpact:false,
            body:JSON.stringify({action:'save_batch',records,requestId}),
            onRetry:({attempt,total})=>chunkPairs.forEach(({row})=>showScheduleRowRetry(row,attempt,total))
          });
        }catch(error){batchError=error;}

        if(batchError){
          // api() já esgotou as 3 tentativas idempotentes usando o mesmo requestId.
          // Só agora a linha é marcada como não confirmada; não criamos uma quarta
          // operação com outro requestId para evitar reenvio ambíguo após timeout/503.
          const reason=scheduleErrorReason(batchError);
          chunkPairs.forEach(({row})=>{markScheduleRowError(row,reason);failedCount+=1;});
          persistScheduleDraftFromDom(date);
          continue;
        }

        scheduleData.__degraded=false;
        if(!applyResult(chunkPairs,result)){
          const reason=scheduleErrorReason({code:'SCHEDULE_NOT_COMMITTED',message:'o servidor respondeu, mas não confirmou o lote.'});
          chunkPairs.forEach(({row})=>{markScheduleRowError(row,reason);failedCount+=1;});
          persistScheduleDraftFromDom(date);
          continue;
        }

        persistScheduleDraftFromDom(date);
        await new Promise((resolve)=>setTimeout(resolve,60));
      }

      // Snapshot de contingência contém somente o que o servidor confirmou.
      const serverSchedules=(scheduleData.schedules||[]).filter((item)=>!item.__draft);
      persistScheduleSnapshot(date,{...scheduleData,schedules:serverSchedules});
      updateScheduleCount();updateScheduleSyncState();

      if(failedCount)toast(`${savedCount} linha(s) confirmada(s); ${failedCount} linha(s) ficaram em vermelho com o motivo da falha.`, 'warning');
      else toast(warnings.length?`${savedCount} escala(s) confirmada(s) no servidor com avisos.`:`${savedCount} escala(s) confirmada(s) no servidor.`,warnings.length?'warning':'success');
    } catch(error) {
      persistScheduleDraftFromDom(date);
      const reason=scheduleErrorReason(error);
      pairs.filter(({row})=>row.dataset.dirty==='1').forEach(({row})=>markScheduleRowError(row,reason));
      toast('Algumas linhas não foram confirmadas. O motivo está exibido dentro de cada linha vermelha.','warning');
    } finally {hideLoading();updateScheduleSyncState();}
  }
  function scheduleMutationIdentity(row){
    const date=$('#route-schedule-date')?.value||scheduleData.date||'';
    const record=readScheduleRow(row,date);
    return {data:record.data,sequencia:record.sequencia,ocs:record.ocs,rota:record.rota,rota_id:record.rota_id,placa:record.placa,veiculo_id:record.veiculo_id};
  }
  function cancelSchedule(row){const identity=scheduleMutationIdentity(row);modal({title:'Cancelar escala',body:'<label class="field"><span>Motivo do cancelamento</span><textarea id="route-cancel-reason"></textarea></label>',confirmText:'Cancelar escala',onConfirm:async(root)=>{await api('/api/schedule',{method:'DELETE',body:JSON.stringify({action:'cancel',id:row.dataset.id,storage:row.dataset.storage,identity,reason:$('#route-cancel-reason',root).value,requestId:crypto.randomUUID()})});toast('Escala cancelada sem excluir o histórico.');await renderSchedule($('#route-schedule-date').value);}});}
  function deleteSchedule(row){const identity=scheduleMutationIdentity(row);modal({title:'Excluir escala definitivamente',body:'<div class="danger-box">Esta ação remove a escala e registros operacionais vinculados.</div><label class="field"><span>Digite EXCLUIR</span><input id="route-delete-confirm"></label>',confirmText:'Excluir definitivamente',onConfirm:async(root)=>{await api('/api/schedule',{method:'DELETE',body:JSON.stringify({action:'delete',id:row.dataset.id,storage:row.dataset.storage,identity,confirmation:$('#route-delete-confirm',root).value,requestId:crypto.randomUUID()})});toast('Escala excluída definitivamente.');await renderSchedule($('#route-schedule-date').value);}});}
  function scheduleTransferPrintInfo(observacoes=''){
    const raw=String(observacoes||'');
    const transferida=/TRANSFERIDA_DA_ESCALA(?::|=)/i.test(raw);
    const cleaned=raw
      .replace(/\[TRANSFERIDA_DA_ESCALA:[^\]]+\]/gi,'')
      .replace(/TRANSFERIDA_DA_ESCALA=[^·|]+/gi,'')
      .replace(/\s*[·|]\s*[·|]\s*/g,' · ')
      .replace(/^\s*[·|]\s*|\s*[·|]\s*$/g,'')
      .trim();
    return {transferida,print_observacoes:[transferida?'TRANSFERIDA':'',cleaned].filter(Boolean).join(' · ')};
  }
  // Dois primeiros nomes; se o segundo termina em partícula (DE, DA, DO, DOS, DAS, E...), inclui o próximo nome.
  function scheduleShortName(name=''){
    const words=String(name||'').trim().split(/\s+/).filter(Boolean);if(words.length<=2)return words.join(' ');
    const particles=new Set(['DE','DA','DO','DAS','DOS','E','DEL','DI','DU','LA','LE']);
    let end=2;while(end<words.length&&particles.has(normalize(words[end-1])))end+=1;
    return words.slice(0,end).join(' ');
  }
  function schedulePrintRows(){return $$('[data-route-schedule-row]')
    .map((r)=>readScheduleRow(r,$('#route-schedule-date').value))
    // A impressão da escala deve conter somente viagens efetivamente escaladas.
    // A cópia criada por TRANSFERIR preserva o motorista e, portanto, entra aqui.
    .filter((x)=>Boolean(x.motorista_id||String(x.motorista||'').trim()))
    .map((x)=>{const v=scheduleData.vehicles.find((y)=>String(y.id)===String(x.veiculo_id));const transfer=scheduleTransferPrintInfo(x.observacoes);const firstNames=scheduleShortName;return {...x,...transfer,vinculo:v?.vinculo||'PRÓPRIO',apelido:v?.apelido||'',equipe:x.tipo_equipe==='TRES_MOTORISTAS'?[x.ajudante_1,x.ajudante_2].filter(Boolean).map((name)=>`${firstNames(name)} (Carona)`).join(' / ')||'—':x.tipo_equipe==='TERCEIRO'?'TERCEIRO':(x.tipo_equipe==='DOIS_MOTORISTAS'?[x.ajudante_1?`${scheduleShortName(x.ajudante_1)} (Carona)`:'',x.ajudante_2].filter(Boolean).join(' / '):[x.ajudante_1,x.ajudante_2].filter(Boolean).join(' / '))||(x.tipo_equipe==='CARGA_FECHADA'?'CARGA FECHADA':'—')};});}
  const schedulePrintAdminRoute=(routeName='')=>/\b(MANOBRA|VENEZA|MANUTENCAO|MANUTENÇÃO|CAIXA|CAIXAS|ALMOXARIFADO|SERVICO ADM|SERVICO ADMINISTRATIVO|SERVIÇO ADM|SERVIÇO ADMINISTRATIVO|TRANSFERENCIA|TRANSFERÊNCIA)\b/.test(normalize(routeName).replace(/[^A-Z0-9]+/g,' ').trim());
  const schedulePrintSequenceValue=(row={})=>{
    const raw=String(row?.sequencia??'').trim();
    if(!raw)return null;
    const match=raw.match(/\d+/);
    if(!match)return null;
    const value=Number(match[0]);
    return Number.isFinite(value)?value:null;
  };
  const schedulePrintNoDeparture=(row={})=>!String(row.ocs??'').trim()||schedulePrintAdminRoute(row.rota||'');
  const schedulePrintWeight=(value)=>`${Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:2})} kg`;
  const schedulePrintTemperature=(value)=>value===null||value===undefined||String(value).trim()===''?'—':`${Number(value).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:1})} °C`;
  const compareSchedulePrintRows=(a,b)=>{
    const aNoSeq=schedulePrintNoDeparture(a)||schedulePrintSequenceValue(a)==null;
    const bNoSeq=schedulePrintNoDeparture(b)||schedulePrintSequenceValue(b)==null;
    if(aNoSeq!==bNoSeq)return Number(aNoSeq)-Number(bNoSeq);
    const aSeq=schedulePrintSequenceValue(a);
    const bSeq=schedulePrintSequenceValue(b);
    if(aSeq!=null&&bSeq!=null&&aSeq!==bSeq)return aSeq-bSeq;
    const routeCompare=String(a.rota||'').localeCompare(String(b.rota||''),'pt-BR',{sensitivity:'base',numeric:true});
    if(routeCompare)return routeCompare;
    const plateCompare=String(a.placa||'').localeCompare(String(b.placa||''),'pt-BR',{sensitivity:'base',numeric:true});
    if(plateCompare)return plateCompare;
    return String(a.ocs||'').localeCompare(String(b.ocs||''),'pt-BR',{sensitivity:'base',numeric:true});
  };
  function printSchedule(rows,date){
    const pending=$$('[data-route-schedule-row]').filter((row)=>row.dataset.dirty==='1').length;
    const draftWarning=pending?`<div class="schedule-print-draft-warning"><strong>RASCUNHO LOCAL — NÃO CONFIRMADO NO SERVIDOR</strong><span>${pending} alteração(ões) ainda estão pendentes de sincronização. Este PDF registra o que está na tela, não comprova gravação no D1.</span></div>`:'';
    const sorted=rows.slice().sort(compareSchedulePrintRows);
    const groups=[
      ['Frota própria',sorted.filter((x)=>!/TERCEIR/.test(normalize(x.vinculo)) && x.tipo_equipe!=='TERCEIRO')],
      ['Frota terceira',sorted.filter((x)=>/TERCEIR/.test(normalize(x.vinculo)) || x.tipo_equipe==='TERCEIRO')],
    ].filter(([,items])=>items.length);
    const html=draftWarning+groups.map(([title,items],index)=>{
      const density=items.length>34?'ultra':items.length>22?'dense':'normal';
      return `<section class="schedule-print-page schedule-print-${density} ${index?'schedule-print-page-break':''}"><div class="schedule-print-head"><img src="${LOGO_URL}" alt="Natto"><div><h1>Escala diária de distribuição — ${title}</h1><p>${formatDate(date)} · ${items.length} veículo(s)</p></div></div><table><thead><tr><th>Data</th><th>OC(s)</th><th>Peso (kg)</th><th>Rota</th><th>Placa</th><th class="print-temperature-head">Temperatura do frio (°C)</th><th>Motorista</th><th>Ajudante(s) / Equipe</th><th>Horário de saída</th><th>Previsão de retorno</th><th>Observação</th></tr></thead><tbody>${items.map((x)=>`<tr><td>${formatDate(date)}</td><td>${esc(x.ocs||'0')}</td><td>${schedulePrintWeight(x.peso_kg)}</td><td>${esc(x.rota||'—')}</td><td>${esc(x.placa||'—')}${x.apelido?`<br><small>${esc(x.apelido)}</small>`:''}</td><td class="print-temperature">${schedulePrintTemperature(x.temperatura_frio_c??x.TEMPERATURA_FRIO_C)}</td><td class="print-person">${esc(x.motorista||'—')}</td><td class="print-person">${esc(x.equipe||'—')}</td><td>${formatTime(x.horario_ponto)}</td><td>${x.previsao_retorno?formatDate(x.previsao_retorno):'—'}</td><td><div class="print-observation">${esc(x.print_observacoes||x.observacoes||'—')}</div></td></tr>${['DOIS_MOTORISTAS','TRES_MOTORISTAS'].includes(x.tipo_equipe)&&x.carona_motivo?`<tr class="print-carona-row"><td colspan="11"><strong>CARONA · ${esc((x.tipo_equipe==='TRES_MOTORISTAS'?[x.ajudante_1,x.ajudante_2]:[x.ajudante_1]).filter(Boolean).map((name)=>scheduleShortName(name)).join(' e ')||'2º motorista')}:</strong> ${esc(x.carona_motivo)}</td></tr>`:''}`).join('')}</tbody></table></section>`;
    }).join('');
    const w=window.open('','_blank');
    if(!w){toast('O navegador bloqueou a janela de impressão. Permita pop-ups para imprimir a escala.','warning');return;}
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Escala ${formatDate(date)}</title><link rel="stylesheet" href="/assets/app.css?rev=dms-rota-v193-mapa-restaurado-20260914"></head><body class="schedule-print-document">${html||'<div class="schedule-print-empty">Nenhuma escala cadastrada.</div>'}<script>window.onload=()=>setTimeout(()=>window.print(),180)<\/script></body></html>`);w.document.close();
  }
  function openImport() {
    const importDate=$('#route-schedule-date').value;
    modal({title:`Importar escala · ${formatDate(importDate)}`,body:`<p class="helper-text">Cole as colunas <strong>SEQ, OC, PLACA, ROTA e PESO</strong>. PLACA pode ficar vazia. ENTREGAS é uma sexta coluna opcional e TEMPERATURA DO FRIO (°C) também pode ser informada quando houver cabeçalho. Ao gerar a prévia, o DMS também sugere motorista e ajudante automaticamente.</p><label class="field"><span>Dados tabulares</span><textarea id="route-import-text" style="min-height:260px" placeholder="SEQ\tOC\tPLACA\tROTA\tPESO\tENTREGAS"></textarea></label><div id="route-import-preview"></div>`,confirmText:'Gerar prévia',onConfirm:async(root)=>{
      const result=await api('/api/schedule',{method:'POST',body:JSON.stringify({action:'preview_import',date:importDate,text:$('#route-import-text',root).value})});
      const valid=result.rows.filter((x)=>x.valid);
      const suggested=await autoPreScaleRecords(valid);
      const suggestionByRow=new Map(suggested.map((x,index)=>[String(x.__sourceRow??valid[index]?.__sourceRow??index),x]));
      const previewRows=result.rows.map((x,index)=>x.valid?(suggestionByRow.get(String(x.__sourceRow??index))||x):x);
      $('#modal-root').innerHTML='';
      modal({title:`Prévia da importação · ${formatDate(importDate)}`,body:`<div class="warning-box">Válidas: ${result.validCount} · Sequências repetidas: ${result.duplicateCount||0} · Inválidas: ${result.invalidCount}</div><div class="info-box"><strong>Pré-escala automática:</strong> o DMS sugere motorista e ajudante quando encontra pessoas elegíveis. <strong>A falta de sugestão não bloqueia a importação:</strong> a linha entra PROGRAMADA e fica disponível para preenchimento manual na Escala. O DMS prioriza primeiro o casamento motorista × placa do Plano de Alocação vigente; depois usa o histórico da mesma rota como fallback e dimensiona os ajudantes por região, tipo de veículo, peso e entregas.</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Linha</th><th>Seq.</th><th>OC(s)</th><th>Placa</th><th>Rota</th><th>Motorista sugerido</th><th>Ajudante sugerido</th><th>Peso (kg)</th><th>Entregas</th><th>Situação</th></tr></thead><tbody>${previewRows.map((x)=>`<tr class="${x.valid?(x.duplicada?'row-warning':'row-success'):'row-danger'}"><td>${x.__sourceRow}</td><td>${esc(x.sequencia||'')}</td><td>${esc(x.ocs||'')}</td><td>${esc(x.placa||x.PLACA||'')}</td><td>${esc(x.rota||x.ROTA||'')}</td><td>${esc(x.motorista||'—')}</td><td>${esc([x.ajudante_1,x.ajudante_2].filter(Boolean).join(' / ')||(['CARGA_FECHADA','TERCEIRO'].includes(normalize(x.tipo_equipe))?'—':'Sem sugestão'))}</td><td>${formatNumber(x.peso_kg||0,2)}</td><td>${formatNumber(x.qtd_entregas||0)}</td><td>${x.valid?esc(x.pre_escala_motivo||(x.duplicada?'Válida com aviso':'Válida')):esc((x.errors||[]).join(', '))}</td></tr>`).join('')}</tbody></table></div>`,confirmText:`Importar ${suggested.length} linha(s)`,onConfirm:async()=>{
        if(!suggested.length)throw new Error('Não há linhas válidas. Corrija as linhas destacadas na prévia.');
        const requestId=crypto.randomUUID();const done=await api('/api/schedule',{method:'POST',timeoutMs:60000,body:JSON.stringify({action:'confirm_import',date:importDate,rows:suggested,requestId})});
        if(done.committed!==true)throw new Error('O servidor não confirmou a importação da Escala.');
        const imported=done.imported?.length||0, skipped=done.skipped||[];
        if(!imported&&skipped.length)throw new Error(`Nenhuma linha foi importada. ${skipped.slice(0,3).map((x)=>`Linha ${x.row||'?'}: ${x.reason||'não importada'}`).join(' · ')}`);
        const pendingManual=Number(done.pendingManual||0);
        toast(`${imported} linha(s) importada(s) para ${formatDate(importDate)}.${pendingManual?` ${pendingManual} ficou(aram) com equipe pendente para preenchimento manual.`:''}${skipped.length?` ${skipped.length} linha(s) estruturalmente inválida(s) não foi(ram) importada(s).`:''}`,pendingManual||skipped.length?'warning':'success');
        // Recarrega do servidor para usar IDs/storage canônicos. Isso evita que uma
        // linha recém-importada fique visível com referência local e depois não seja
        // encontrada ao editar/cancelar/excluir.
        await renderSchedule(importDate);
      }});
    }});
  }
  async function runAutomaticPreScaleExisting(){
    const date=$('#route-schedule-date')?.value||scheduleData.date;
    const rows=$$('[data-route-schedule-row]').filter((row)=>row.dataset.locked!=='1'&&!row.hidden);
    const targets=[];
    for(const row of rows){
      const record=readScheduleRow(row,date);
      if(normalize(record.status||'PROGRAMADO')!=='PROGRAMADO')continue;
      // v1.0.63: toda linha PROGRAMADA pode ser reavaliada. Assim o botão não
      // serve só para preencher nomes vazios; ele também aplica a regra automática
      // de 1/2 ajudantes quando peso, entregas, região ou tipo do veículo mudarem.
      targets.push({row,record});
    }
    if(!targets.length)return toast('Não há linhas PROGRAMADAS visíveis para revisar na pré-escala.','info');
    const suggested=await autoPreScaleRecords(targets.map((item)=>item.record));let changed=0,withoutDriver=0,missingHelpers=0;
    suggested.forEach((rec,index)=>{
      const target=targets[index];if(!target)return;const row=target.row,current=readScheduleRow(row,date);
      const setIfBlank=(key,value)=>{const input=$(`[data-key="${key}"]`,row);if(input&&!input.value&&value){input.value=String(value);changed+=1;}};
      const setExact=(key,value)=>{const input=$(`[data-key="${key}"]`,row);if(input&&String(input.value||'')!==String(value||'')){input.value=String(value||'');changed+=1;}};
      setIfBlank('motorista_id',rec.motorista_id);
      const team=$('[data-key="tipo_equipe"]',row);
      if(team&&rec.tipo_equipe&&normalize(team.value)!==normalize(rec.tipo_equipe)){team.value=rec.tipo_equipe;changed+=1;}
      if(['CARGA_FECHADA','TERCEIRO','SEM_AJUDANTE'].includes(normalize(rec.tipo_equipe))){
        setExact('ajudante_1_id','');setExact('ajudante_2_id','');
      }else{
        setIfBlank('ajudante_1_id',rec.ajudante_1_id);
        if(normalize(rec.tipo_equipe)==='DOIS_AJUDANTES')setIfBlank('ajudante_2_id',rec.ajudante_2_id);
        else setExact('ajudante_2_id','');
      }
      if(!rec.motorista_id&&!current.motorista_id)withoutDriver+=1;
      const required=normalize(rec.tipo_equipe)==='DOIS_AJUDANTES'?2:['CARGA_FECHADA','TERCEIRO','SEM_AJUDANTE'].includes(normalize(rec.tipo_equipe))?0:1;
      const found=[rec.ajudante_1_id,rec.ajudante_2_id].filter(Boolean).length;
      if(found<required)missingHelpers+=1;
      applyTeam(row);syncScheduleSummary(row);updateScheduleWorkSignals(row);row.dataset.dirty='1';row.classList.add('is-editing');setScheduleEditing(row,true);
    });
    if(changed){
      scheduleDraftSoon();updateScheduleSyncState();
      toast(`Pré-escala revisada em ${targets.length} linha(s). O DMS priorizou histórico da rota e recalculou a quantidade de ajudantes.${withoutDriver?` ${withoutDriver} linha(s) ficaram sem motorista elegível.`:''}${missingHelpers?` ${missingHelpers} linha(s) ainda precisam de ajudante.`:''}`,withoutDriver||missingHelpers?'warning':'success');
    }else toast('A pré-escala já está coerente com as regras atuais e não encontrou alterações para aplicar.','info');
  }
  function scheduleNewDepartureTime(date){
    const base=String(scheduleData?.defaults?.departureTime||'06:00').slice(0,5);
    if(String(date||'')!==today())return base;
    const now=new Date();
    const current=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    return current>base?current:base;
  }
  async function renderSchedule(date=null) {
    const selected=date || state.routeScheduleDate || today(); state.routeScheduleDate=selected;
    let degraded=false,degradedAt='';
    // A tela de Escala precisa de uma única chamada. O GET de Saídas era usado
    // apenas para decidir se mostrava a previsão e dobrava o tráfego no pico.
    const scheduleResult=await api(`/api/schedule?editor=1&date=${encodeURIComponent(selected)}`,{quietTransient:true,timeoutMs:12000,maxAttempts:2,connectionImpact:false})
      .then((value)=>({status:'fulfilled',value}), (reason)=>({status:'rejected',reason}));
    let serverData=null;
    if(scheduleResult.status==='fulfilled'){
      serverData=scheduleResult.value;
      persistScheduleSnapshot(selected,serverData);
    }else{
      const cached=readScheduleSnapshot(selected);
      if(!cached)throw scheduleResult.reason;
      serverData=cached.data;degraded=true;
      degradedAt=new Date(Number(cached.at||0)).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    }
    const reconciled=reconcileScheduleDraft(serverData,selected);
    scheduleData=reconciled.data;scheduleData.__degraded=degraded;
    const restoredDrafts=reconciled.restored;
    $('#page-content').innerHTML=`<section class="panel schedule-page-panel"><div class="schedule-toolbar"><div class="toolbar-group"><label class="toolbar-field"><span>Data da escala</span><input id="route-schedule-date" class="filter-control" type="date" value="${esc(scheduleData.date)}"></label><label class="toolbar-field"><span>Buscar</span><input id="route-schedule-search" class="filter-control" placeholder="OC, placa, rota..."></label></div><div class="toolbar-group">${canWrite()?'<button class="btn btn-ghost" id="route-schedule-paste">⎘ Colar Excel</button><button class="btn btn-ghost" id="route-schedule-upload">⬆ Subir planilha</button><input id="route-schedule-upload-file" type="file" accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt" hidden><button class="btn btn-ghost" id="route-schedule-import">⇩ Importar em massa</button><button class="btn btn-secondary" id="route-schedule-auto">⚡ Pré-escala automática</button><button class="btn btn-secondary" id="route-schedule-add">＋ Adicionar linha</button><button class="btn btn-primary" id="route-schedule-save-all">✓ Salvar alteradas</button>':''}<button class="btn btn-ghost" id="route-schedule-export">CSV</button><button class="btn btn-ghost" id="route-schedule-print">▣ Imprimir escala completa</button></div></div></section>
      <section class="panel schedule-page-panel"><div class="panel-header"><div><h3>Planejamento de ${formatDate(scheduleData.date)}</h3></div><div class="toolbar-group"><span class="badge badge-info" id="route-schedule-count">${scheduleData.schedules.length} rota(s)</span><span class="badge ${(degraded||restoredDrafts)?'badge-warning':'badge-success'}" id="route-schedule-sync-status">${restoredDrafts?`${restoredDrafts} pendente(s) de salvar`:degraded?'Atualização pendente':'Sincronizado no servidor'}</span></div></div><div id="route-schedule-paste-result" class="info-box is-hidden"></div><div id="route-schedule-paste-zone" class="table-wrap schedule-editor-wrap" tabindex="0" aria-label="Grade da escala. Aceita colagem do Excel com Ctrl+V"><table class="data-table schedule-editor-table"><thead><tr><th>Seq.</th><th>OC(s)</th><th>Peso (kg)</th><th>Entregas</th><th>Rota</th><th>Região</th><th>Placa</th><th>Motorista</th><th>Ajudante 1</th><th>Ajudante 2</th><th>Equipe</th><th>Horário de saída</th><th>Frio programado (°C)</th><th>Previsão de retorno</th><th>Status</th><th>Observação</th><th>Ações</th></tr></thead><tbody id="route-schedule-body">${scheduleData.schedules.map(scheduleRow).join('')}</tbody></table></div>${scheduleData.schedules.length?'':'<div class="empty-state" id="route-schedule-empty"><strong>Nenhuma escala nesta data.</strong><span>Você pode colar diretamente do Excel com Ctrl+V.</span></div>'}</section>`;
    bindScheduleRows();
    bindSchedulePaste();
    $('#route-schedule-date').onchange=(e)=>renderSchedule(e.target.value);
    $('#route-schedule-search').oninput=(e)=>{const q=normalize(e.target.value);$$('[data-route-schedule-row]').forEach((r)=>r.hidden=Boolean(q&&!normalize(JSON.stringify(readScheduleRow(r,scheduleData.date))).includes(q)));};
    $('#route-schedule-add')?.addEventListener('click',()=>{$('#route-schedule-body').insertAdjacentHTML('beforeend',scheduleRow({status:'PROGRAMADO',tipo_equipe:'UM_AJUDANTE',horario_ponto:scheduleNewDepartureTime(scheduleData.date),qtd_entregas:0}));bindScheduleRows();updateScheduleCount();scheduleDraftSoon();});
    $('#route-schedule-save-all')?.addEventListener('click',()=>saveScheduleRows($$('[data-route-schedule-row]').filter((row)=>row.dataset.dirty==='1')));
    $('#route-schedule-paste')?.addEventListener('click',pasteScheduleFromClipboard);
    $('#route-schedule-upload')?.addEventListener('click',()=>$('#route-schedule-upload-file')?.click());
    $('#route-schedule-upload-file')?.addEventListener('change',async(e)=>{const file=e.target.files?.[0];e.target.value='';if(file)await openScheduleSpreadsheetFile(file);});
    $('#route-schedule-import')?.addEventListener('click',openImport);
    $('#route-schedule-auto')?.addEventListener('click',runAutomaticPreScaleExisting);
    $('#route-schedule-export').onclick=()=>exportCsv(schedulePrintRows().map((x)=>({data:scheduleData.date,sequencia:x.sequencia,ocs:x.ocs,peso_kg:x.peso_kg,qtd_entregas:x.qtd_entregas,rota:x.rota,regiao:x.regiao,placa:x.placa,motorista:x.motorista,ajudante_1:x.ajudante_1,ajudante_2:x.ajudante_2,equipe:x.equipe,carona_motivo:x.carona_motivo||'',horario_saida:x.horario_ponto,temperatura_frio_c:x.temperatura_frio_c,previsao_retorno:x.previsao_retorno,status:x.status,observacoes:x.observacoes})),`escala_${scheduleData.date}.csv`);
    $('#route-schedule-print').onclick=()=>printSchedule(schedulePrintRows(),scheduleData.date);
    updateScheduleSyncState();
  }

  async function renderReturns({forceFresh=false}={}) {
    const end=state.routeReturnEnd||today(); const d=new Date(`${end}T12:00:00`);d.setDate(d.getDate()-60);const start=state.routeReturnStart||d.toISOString().slice(0,10);
    let returnPayload=null,degraded=false,degradedAt='';
    const cacheKey=`natto_route_returns_${start}_${end}`;
    try{
      returnPayload=await api(`/api/returns?view=dashboard&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}${forceFresh?'&fresh=1':''}`,{fresh:true});
      try{sessionStorage.setItem(cacheKey,JSON.stringify({at:Date.now(),payload:returnPayload}));}catch{}
    }catch(error){
      let cached=null;try{cached=JSON.parse(sessionStorage.getItem(cacheKey)||'null');}catch{}
      if(!cached?.payload)throw error;
      returnPayload=cached.payload;degraded=true;degradedAt=new Date(Number(cached.at||0)).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      setConnection(false,'Instável · retornos preservados');
    }
    const candidates=returnPayload.candidates||[], returns=returnPayload.records||[];
    const activeFilters=state.routeReturnFilters||{};
    const helperNames=(row={})=>[row.ajudante_1,row.ajudante_2].filter(Boolean);
    const destinationOf=(row={})=>row.destino||row.cidade_destino||row.cidade||row.rota||'';
    const candidateFilterRow=(item)=>{const s=item.schedule||{},d=item.departure||{},m=item.monitoring||{};const helpers=[...helperNames(s),...helperNames(d),...helperNames(m)].filter(Boolean);return {kind:'AGUARDANDO',region:s.regiao||d.regiao||m.regiao||'',route:s.rota||d.rota||m.rota||'',destination:destinationOf(s)||destinationOf(d)||destinationOf(m),driver:d.motorista||s.motorista||m.motorista||'',helper:helpers.join(' / '),helpers,plate:(d.placa||s.placa||m.placa||'').toUpperCase(),oc:s.ocs||d.ocs||m.ocs||'',origin:'',search:[s.data,s.sequencia,s.ocs,s.regiao,s.rota,s.destino,s.placa,s.motorista,s.ajudante_1,s.ajudante_2,d.placa,d.motorista,d.ajudante_1,d.ajudante_2,m.ajudante_1,m.ajudante_2].join(' ')};};
    const confirmedFilterRow=(r)=>{const helpers=helperNames(r);return {kind:'CONFIRMADO',region:r.regiao||'',route:r.rota||'',destination:destinationOf(r),driver:r.motorista||'',helper:helpers.join(' / '),helpers,plate:String(r.placa||'').toUpperCase(),oc:r.ocs||r.carga||'',origin:r.origem||'MANUAL',search:[r.data,r.saida_real,r.retorno_real,r.sequencia,r.ocs,r.carga,r.regiao,r.rota,r.destino,r.cidade_destino,r.placa,r.motorista,r.ajudante_1,r.ajudante_2,r.origem,r.observacoes].join(' ')}};
    const allFilterRows=[...candidates.map(candidateFilterRow),...returns.map(confirmedFilterRow)];
    const filterValues=(key)=>[...new Set(allFilterRows.flatMap((row)=>key==='helper'?(row.helpers||[]):[String(row[key]||'').trim()]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const returnFilterSelect=(id,label,values,selected)=>`<label class="toolbar-field"><span>${esc(label)}</span><select id="${id}" class="filter-control"><option value="">Todos</option>${values.map((value)=>option(value,value,selected)).join('')}</select></label>`;
    $('#page-content').innerHTML=`<div class="page-intro"><div><span class="eyebrow">RETORNOS · VERSÃO 1 - DMS ROTA</span><h3>Retornos e histórico de viagens</h3><p>Viagens sem retorno permanecem destacadas. O histórico permite auditar saída, retorno, OC, veículo, equipe, rota e destino.</p></div><div class="page-intro-actions"><button class="btn btn-secondary" id="route-return-portaria">Importar Portaria</button><button class="btn btn-ghost" id="route-return-export">CSV</button><button class="btn btn-ghost" id="route-return-print">▣ Imprimir</button><button class="btn btn-ghost" id="route-return-refresh">↻ Atualizar</button></div></div>${degraded?`<div class="info-box"><strong>Modo contingência:</strong> o servidor oscilou. Mantive a última tela de Retornos válida${degradedAt?` carregada às ${esc(degradedAt)}`:''}.</div>`:''}
      <section class="panel indicator-filter-panel"><div class="panel-header"><div><h3>Consulta</h3><p class="helper-text">Período, placa, OC, motorista, ajudante, rota, destino e demais filtros são aplicados ao histórico. Situação também pode separar viagens aguardando retorno das confirmadas.</p></div><div class="toolbar-group"><label class="toolbar-field"><span>Início</span><input id="route-return-start" class="filter-control" type="date" value="${esc(start)}"></label><label class="toolbar-field"><span>Fim</span><input id="route-return-end" class="filter-control" type="date" value="${esc(end)}"></label><label class="toolbar-field"><span>Busca</span><input id="route-return-filter-q" class="filter-control" value="${esc(activeFilters.q||'')}" placeholder="Qualquer campo"></label><label class="toolbar-field"><span>OC</span><input id="route-return-filter-oc" class="filter-control" value="${esc(activeFilters.oc||'')}" placeholder="Número da OC"></label>${returnFilterSelect('route-return-filter-kind','Situação',['AGUARDANDO','CONFIRMADO'],activeFilters.kind||'')}${returnFilterSelect('route-return-filter-plate','Placa',filterValues('plate'),activeFilters.plate||'')}${returnFilterSelect('route-return-filter-driver','Motorista',filterValues('driver'),activeFilters.driver||'')}${returnFilterSelect('route-return-filter-helper','Ajudante',filterValues('helper'),activeFilters.helper||'')}${returnFilterSelect('route-return-filter-route','Rota',filterValues('route'),activeFilters.route||'')}${returnFilterSelect('route-return-filter-destination','Destino',filterValues('destination'),activeFilters.destination||'')}${returnFilterSelect('route-return-filter-region','Região',filterValues('region'),activeFilters.region||'')}${returnFilterSelect('route-return-filter-origin','Origem registro',filterValues('origin'),activeFilters.origin||'')}<button class="btn btn-ghost" id="route-return-filter-clear">Limpar</button></div></div></section>
      <div class="cards-grid" id="route-return-metrics"></div>
      <section class="panel"><div class="panel-header"><div><h3>Viagens aguardando retorno</h3><p class="helper-text">Inclui viagens com saída real e monitoramentos ainda abertos, mesmo quando a escala original não está mais disponível.</p></div></div><div class="return-scale-grid" id="route-return-candidates"></div></section>
      <section class="panel"><div class="panel-header"><div><h3>Histórico de viagens</h3><p class="helper-text">Viagens com retorno confirmado, incluindo registros consolidados de Escala/Monitoramento quando o retorno estruturado antigo não existe. Uma viagem de vários dias pode representar várias diárias no CAJU. Use <strong>Detalhes</strong> para auditar a viagem e o GPS.</p></div></div><div class="panel-body"><div class="table-wrap" id="route-return-history"></div></div></section>`;
    let visibleCandidates=[],visibleReturns=[];
    const readFilters=()=>({q:$('#route-return-filter-q')?.value||'',oc:$('#route-return-filter-oc')?.value||'',kind:$('#route-return-filter-kind')?.value||'',region:$('#route-return-filter-region')?.value||'',route:$('#route-return-filter-route')?.value||'',destination:$('#route-return-filter-destination')?.value||'',driver:$('#route-return-filter-driver')?.value||'',helper:$('#route-return-filter-helper')?.value||'',plate:$('#route-return-filter-plate')?.value||'',origin:$('#route-return-filter-origin')?.value||''});
    const matches=(row,filters)=>{if(filters.kind&&normalize(row.kind)!==normalize(filters.kind))return false;if(filters.region&&normalize(row.region)!==normalize(filters.region))return false;if(filters.route&&normalize(row.route)!==normalize(filters.route))return false;if(filters.destination&&normalize(row.destination)!==normalize(filters.destination))return false;if(filters.driver&&normalize(row.driver)!==normalize(filters.driver))return false;if(filters.helper&&!row.helpers.some((name)=>normalize(name)===normalize(filters.helper)))return false;if(filters.plate&&normalize(row.plate)!==normalize(filters.plate))return false;if(filters.origin&&normalize(row.origin)!==normalize(filters.origin))return false;if(filters.oc&&!normalize(row.oc).includes(normalize(filters.oc)))return false;return !filters.q||normalize(row.search).includes(normalize(filters.q));};
    const draw=()=>{
      const filters=readFilters();state.routeReturnFilters=filters;
      visibleCandidates=candidates.filter((item)=>matches(candidateFilterRow(item),filters));
      visibleReturns=returns.filter((item)=>matches(confirmedFilterRow(item),filters));
      $('#route-return-metrics').innerHTML=`${metric('Aguardando retorno',visibleCandidates.length,'Saída realizada sem retorno','warning')}${metric('Viagens no histórico',visibleReturns.length,'Retornos consolidados','success')}${metric('Dias cobertos',visibleReturns.reduce((sum,x)=>sum+Number(x.dias_cobertos||1),0),'Dias civis entre saída e retorno','info')}${metric('Com devolução',visibleReturns.filter((x)=>Number(x.devolucoes)>0).length,'Resposta Sim','warning')}${metric('Com apoio em rota',visibleReturns.filter((x)=>Number(x.apoios)>0).length,'Resposta Sim','info')}`;
      $('#route-return-candidates').innerHTML=visibleCandidates.length?visibleCandidates.map((x,i)=>{const s=x.schedule||{},d=x.departure||{},m=x.monitoring||{};const deliveries=m.entregas_realizadas ?? s.qtd_entregas ?? 0;const helpers=[s.ajudante_1,s.ajudante_2].filter(Boolean).join(' / ')||'—';return `<article class="return-scale-card"><div class="return-scale-head"><div><span class="return-sequence">SEQ ${esc(s.sequencia||'—')}</span><h4>${esc(d.placa||s.placa||'Sem placa')} · ${esc(s.rota||'Rota')}</h4></div>${badge(m.status_monitoramento||m.status||'EM ROTA')}</div>${x.orphanMonitoring?'<div class="info-box"><strong>Monitoramento sem escala vinculada.</strong> Confirme o retorno para encerrar esta viagem e liberar os recursos.</div>':''}<dl><dt>OC(s)</dt><dd>${esc(s.ocs||'—')}</dd><dt>Região</dt><dd>${esc(s.regiao||'—')}</dd><dt>Motorista</dt><dd>${esc(d.motorista||s.motorista||'—')}</dd><dt>Ajudante(s)</dt><dd>${esc(helpers)}</dd><dt>Saída real</dt><dd>${formatTime(d.saida_real||d.hora_real)}</dd><dt>Entregas</dt><dd>${formatNumber(deliveries)}</dd><dt>Previsão</dt><dd>${dt(m.previsao_retorno||s.previsao_retorno)}</dd></dl><div class="card-actions">${canWrite()?`<button class="btn btn-primary" data-route-return-candidate="${i}">Registrar retorno</button>`:''}</div></article>`;}).join(''):'<div class="empty-state">Nenhuma viagem aguardando retorno corresponde aos filtros.</div>';
      $('#route-return-history').innerHTML=visibleReturns.length?`<table class="data-table return-history-table"><thead><tr><th>Ações</th><th>Data</th><th>Saída real</th><th>Retorno real</th><th>OC(s)</th><th>Placa</th><th>Motorista</th><th>Ajudante(s)</th><th>Rota</th><th>Destino</th><th>Tempo rota</th><th>Dias cobertos</th><th>Entregas</th><th>A/D</th><th>Origem</th><th>Última edição por usuário</th><th>Última atualização automática</th></tr></thead><tbody>${visibleReturns.map((r,i)=>`<tr><td><div class="return-history-actions"><button class="btn btn-secondary btn-sm return-history-details-button" data-route-return-details="${i}" title="Abrir detalhes e GPS da viagem"><i data-lucide="panel-top-open" aria-hidden="true"></i><span>Detalhes</span></button>${canWrite()&&Number(r.return_id||r.id||0)>0?`<button class="btn btn-ghost btn-sm" data-route-return-edit="${i}" title="Ajustar retorno">Ajustar</button>`:''}</div></td><td><strong>${formatDate(r.data||r.retorno_real)}</strong></td><td>${dt(r.saida_real||r.hora_real||r.actual_at)}</td><td><strong>${dt(r.retorno_real||r.return_at||r.data)}</strong></td><td>${esc(r.ocs||r.carga||'—')}</td><td>${esc(r.placa||'—')}</td><td>${esc(r.motorista||'—')}</td><td>${esc([r.ajudante_1,r.ajudante_2].filter(Boolean).join(' / ')||'—')}</td><td>${esc(r.rota||'—')}</td><td>${esc(destinationOf(r)||'—')}</td><td>${esc(formatMinutes(r.tempo_rota_min||0))}</td><td><strong>${formatNumber(r.dias_cobertos||1)}</strong></td><td><strong data-route-return-deliveries="${i}">${returnHistoryDeliveryText(r)}</strong>${r.lincros?.syncHealthy?`<small class="muted">Lincros · ${r.lincros.checkedAt?esc(auditDt(r.lincros.checkedAt)):'sincronizado'}</small>`:''}</td><td><span class="performance-score">${formatNumber(r.apoios||0)} / ${formatNumber(r.devolucoes||0)}</span></td><td>${badge(r.origem||'MANUAL')}</td><td>${returnManualCell(r)}</td><td>${returnAutomaticCell(r)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">Nenhuma viagem com retorno confirmado corresponde aos filtros.</div>';
      $$('[data-route-return-candidate]').forEach((button)=>button.onclick=()=>openReturnForm(visibleCandidates[Number(button.dataset.routeReturnCandidate)]));
      $$('[data-route-return-details]').forEach((button)=>button.onclick=()=>openReturnHistoryDetails(visibleReturns[Number(button.dataset.routeReturnDetails)]));
      $$('[data-route-return-edit]').forEach((button)=>button.onclick=()=>openReturnForm({returnRecord:visibleReturns[Number(button.dataset.routeReturnEdit)]}));
      refreshIcons();
    };
    draw();
    $('#route-return-filter-q').oninput=draw;$('#route-return-filter-oc').oninput=draw;
    ['kind','region','route','destination','driver','helper','plate','origin'].forEach((key)=>{$(`#route-return-filter-${key}`).onchange=draw;});
    $('#route-return-filter-clear').onclick=()=>{state.routeReturnFilters={};['q','oc','kind','region','route','destination','driver','helper','plate','origin'].forEach((key)=>{const node=$(`#route-return-filter-${key}`);if(node)node.value='';});draw();};
    $('#route-return-start').onchange=()=>{state.routeReturnStart=$('#route-return-start').value;state.routeReturnEnd=$('#route-return-end').value;renderReturns();};$('#route-return-end').onchange=$('#route-return-start').onchange;
    $('#route-return-portaria')?.addEventListener('click',openPortariaImport);
    $('#route-return-refresh')?.addEventListener('click',async()=>{const ids=[...new Set(visibleReturns.map((r)=>String(r.schedule_record_id||r.schedule_id||r.escala_id||'').trim()).filter(Boolean))].slice(0,8);let ok=0,failed=0;if(ids.length){showLoading('Atualizando histórico','Reconsultando a Lincros nas viagens concluídas mais recentes exibidas...');try{for(let offset=0;offset<ids.length;offset+=3){const batch=ids.slice(offset,offset+3),result=await Promise.allSettled(batch.map((id)=>api(`/api/lincros?scheduleId=${encodeURIComponent(id)}&sync=1&force=1`,{fresh:true,connectionImpact:false,navigationScoped:false,timeoutMs:65000})));ok+=result.filter((x)=>x.status==='fulfilled'&&x.value?.syncResult?.ok!==false).length;failed+=result.filter((x)=>x.status==='rejected'||x.value?.syncResult?.ok===false).length;}}finally{hideLoading();}}await renderReturns({forceFresh:true});if(ids.length)toast(`Histórico atualizado. Lincros reconsultado em ${ok} viagem(ns)${failed?` · ${failed} sem atualização válida`:''}.`,failed?'warning':'success');});
    $('#route-return-export').onclick=()=>exportCsv(visibleReturns.map((r)=>({data:r.data||'',saida_real:r.saida_real||r.hora_real||'',retorno_real:r.retorno_real||r.return_at||'',sequencia:r.sequencia||'',ocs:r.ocs||r.carga||'',placa:r.placa||'',motorista:r.motorista||'',ajudante_1:r.ajudante_1||'',ajudante_2:r.ajudante_2||'',rota:r.rota||'',destino:destinationOf(r),regiao:r.regiao||'',tempo_rota_min:r.tempo_rota_min||0,dias_cobertos:r.dias_cobertos||1,historico_consolidado:r.synthetic_history?'SIM':'NÃO',entregas:r.entregas||0,apoios:r.apoios||0,devolucoes:r.devolucoes||0,origem:r.origem||'',km_inicial:r.km_inicial||'',km_final:r.km_final||'',observacoes:r.observacoes||'',ultima_alteracao_tipo:returnChangeAudit(r).label,ultima_alteracao_por:returnChangeAudit(r).actor,ultima_alteracao_origem:returnChangeAudit(r).source,ultima_alteracao_em:returnChangeAudit(r).at||'',ultima_edicao_por:r.ultima_edicao_por||'',ultima_edicao_em:r.ultima_edicao_em||'',ultima_atualizacao_automatica_por:r.ultima_atualizacao_automatica_por||'',ultima_atualizacao_automatica_origem:r.ultima_atualizacao_automatica_origem||'',ultima_atualizacao_automatica_em:r.ultima_atualizacao_automatica_em||''})),`historico_viagens_${start}_${end}.csv`);
    $('#route-return-print').onclick=()=>window.print();
  }

  function returnGpsRecordsHtml(records=[],truncated=false){
    const rows=Array.isArray(records)?records:[];
    if(!rows.length)return '<div class="empty-state">Nenhum registro GPS foi armazenado para o intervalo desta viagem.</div>';
    const note=truncated?`<div class="info-box"><strong>Histórico extenso:</strong> exibindo os primeiros ${formatNumber(rows.length)} registros GPS do intervalo.</div>`:'';
    return `${note}<div class="table-wrap return-history-gps-wrap"><table class="data-table return-history-gps-table"><thead><tr><th>Data / hora</th><th>Fonte</th><th>Ponto / localização</th><th>Velocidade</th><th>Ignição</th><th>Latitude</th><th>Longitude</th></tr></thead><tbody>${rows.map((x)=>{const source=String(x.source||'PROTECTSAT').toUpperCase(),lincros=source==='LINCROS';return `<tr><td><strong>${dt(x.at)}</strong></td><td><strong>${esc(lincros?'Lincros':'ProtectSat')}</strong></td><td><strong>${esc(x.point||x.location||'—')}</strong>${x.point&&x.location&&normalize(x.point)!==normalize(x.location)?`<small class="muted">${esc(x.location)}</small>`:''}</td><td>${lincros||x.speedReliable===false?'—':`${formatNumber(x.speed||0,0)} km/h`}</td><td>${lincros||x.ignitionReliable===false?'—':Number(x.ignition)===1?'Ligada':'Desligada'}</td><td>${Number.isFinite(Number(x.latitude))?esc(Number(x.latitude).toFixed(6)):'—'}</td><td>${Number.isFinite(Number(x.longitude))?esc(Number(x.longitude).toFixed(6)):'—'}</td></tr>`;}).join('')}</tbody></table></div>`;
  }
  function openReturnHistoryDetails(r){
    if(!r)return;
    const scheduleId=String(r.schedule_record_id||r.schedule_id||r.escala_id||r.escala_id_legado||'').trim();
    const departureAt=String(r.saida_real||r.hora_real||r.actual_at||'').replace(' ','T').slice(0,19);
    const returnAt=String(r.retorno_real||r.return_at||'').replace(' ','T').slice(0,19);
    const helpers=[r.ajudante_1,r.ajudante_2].filter(Boolean).join(' / ')||'—';
    const destination=r.destino||r.cidade_destino||r.cidade||r.rota||'—';
    const deliveryStats=returnHistoryDeliveryStats(r);
    const body=`${returnChangeBanner(r)}<div class="fleet-detail-grid"><div class="fleet-detail-stat"><span>Rota</span><strong>${esc(r.rota||'—')}</strong></div><div class="fleet-detail-stat"><span>Destino</span><strong>${esc(destination)}</strong></div><div class="fleet-detail-stat"><span>Placa</span><strong>${esc(r.placa||'—')}</strong></div><div class="fleet-detail-stat"><span>Motorista</span><strong>${esc(r.motorista||'—')}</strong></div><div class="fleet-detail-stat"><span>Ajudante(s)</span><strong>${esc(helpers)}</strong></div><div class="fleet-detail-stat"><span>OC(s)</span><strong data-return-history-detail-ocs>${esc(r.ocs||r.carga||'—')}</strong></div><div class="fleet-detail-stat"><span>Saída real</span><strong>${dt(departureAt)}</strong></div><div class="fleet-detail-stat"><span>Retorno real</span><strong>${dt(returnAt)}</strong></div><div class="fleet-detail-stat"><span>Tempo de rota</span><strong>${formatMinutes(r.tempo_rota_min||0)}</strong></div><div class="fleet-detail-stat"><span>Entregas</span><strong data-return-history-detail-deliveries>${deliveryStats.planned>0?`${formatNumber(deliveryStats.done)} / ${formatNumber(deliveryStats.planned)}`:formatNumber(deliveryStats.done)}</strong><small class="muted" data-return-history-detail-source>${deliveryStats.healthy?`Lincros${r.lincros?.checkedAt?` · ${esc(auditDt(r.lincros.checkedAt))}`:''}`:'Histórico do retorno'}</small></div><div class="fleet-detail-stat"><span>Pendentes</span><strong data-return-history-detail-pending>${formatNumber(deliveryStats.pending)}</strong></div><div class="fleet-detail-stat"><span>Apoios</span><strong>${formatNumber(r.apoios||0)}</strong></div><div class="fleet-detail-stat"><span>Devoluções</span><strong>${formatNumber(r.devolucoes||0)}</strong></div><div class="fleet-detail-stat"><span>KM inicial</span><strong>${r.km_inicial!==undefined&&r.km_inicial!==''?formatNumber(r.km_inicial,0):'—'}</strong></div><div class="fleet-detail-stat"><span>KM final</span><strong>${r.km_final!==undefined&&r.km_final!==''?formatNumber(r.km_final,0):'—'}</strong></div><div class="fleet-detail-stat"><span>Origem do retorno</span><strong>${esc(r.origem||'MANUAL')}</strong></div><div class="fleet-detail-stat"><span>Situação</span><strong>FINALIZADO</strong></div></div>${r.observacoes?`<div class="info-box"><strong>Observações:</strong> ${esc(r.observacoes)}</div>`:''}<div class="fleet-detail-section"><span>Dados das entregas · Lincros</span><div id="return-history-lincros">${lincrosDetailsHtml(r.lincros||null,r)}</div></div><div class="fleet-detail-section"><span>Histórico da viagem</span><div id="return-history-timeline"><div class="helper-text">Carregando marcos da viagem...</div></div></div><div class="fleet-detail-section"><span>Registros GPS da viagem</span><div id="return-history-gps"><div class="helper-text">Carregando posições GPS registradas entre a saída e o retorno...</div></div></div>`;
    modal({title:`Detalhes da viagem · ${r.rota||r.placa||'Histórico'}`,confirmText:'Fechar',wide:true,body,onOpen:(root)=>{
      refreshIcons();
      const timelineHost=$('#return-history-timeline',root),gpsHost=$('#return-history-gps',root),lincrosHost=$('#return-history-lincros',root);
      // Mesmo após o Retorno confirmado, sempre reconsulta a Lincros ao abrir o detalhe.
      // Assim, correções/apontamentos feitos posteriormente na Lincros substituem a
      // fotografia antiga do DMS sem reabrir a viagem operacional.
      if(scheduleId){api(`/api/lincros?scheduleId=${encodeURIComponent(scheduleId)}&sync=1&force=1`,{fresh:true,connectionImpact:false,navigationScoped:false,timeoutMs:65000}).then((payload)=>{const ocHost=$('[data-return-history-detail-ocs]',root),scheduleOcs=monitoringOcsText(payload.schedule||{});if(ocHost?.isConnected&&scheduleOcs)ocHost.textContent=scheduleOcs;const item=payload.cached||null;if(payload.syncResult?.ok===false){const detail={...(item||{}),lastError:payload.syncResult.reason||item?.lastError||'Sincronização Lincros não encontrou vínculo.',checkedAt:item?.checkedAt||new Date().toISOString()};if(lincrosHost?.isConnected)lincrosHost.innerHTML=lincrosDetailsHtml(detail,r);return;}const resolved=item||payload.syncResult||null;if(lincrosHost?.isConnected)lincrosHost.innerHTML=lincrosDetailsHtml(resolved,r);applyReturnHistoryLincrosResult(r,resolved,root);}).catch((error)=>{if(lincrosHost?.isConnected)lincrosHost.innerHTML=`<div class="muted">Não foi possível sincronizar a Lincros agora: ${esc(error.message||String(error))}</div>${lincrosDetailsHtml(r.lincros||null,r)}`;});}
      else if(lincrosHost?.isConnected)lincrosHost.innerHTML='<div class="muted">Integração Lincros indisponível: escala da viagem não identificada.</div>';
      if(!r.placa||!departureAt||!returnAt){if(gpsHost)gpsHost.innerHTML='<div class="muted">Histórico GPS indisponível: placa, saída real ou retorno real não identificado.</div>';}
      const params=new URLSearchParams();
      if(scheduleId)params.set('scheduleIds',scheduleId);
      if(r.placa)params.set('plate',String(r.placa));
      if(departureAt)params.set('startAt',departureAt);
      if(returnAt)params.set('endAt',returnAt);
      params.set('includeGps','1');params.set('gpsLimit','2000');
      api(`/api/trip-timeline?${params.toString()}`,{connectionImpact:false,navigationScoped:false,timeoutMs:30000}).then((payload)=>{
        const fallback=[];if(departureAt)fallback.push({type:'SAIDA',label:'Saída de Recife',at:departureAt});if(returnAt)fallback.push({type:'RETORNO',label:'Retorno a Recife',at:returnAt});
        const events=scheduleId?(payload.timelines?.[scheduleId]||[]):[];
        if(timelineHost?.isConnected)timelineHost.innerHTML=tripTimelineHtml(events.length?events:fallback);
        if(gpsHost?.isConnected)gpsHost.innerHTML=returnGpsRecordsHtml(payload.gpsRecords||[],Boolean(payload.gpsTruncated));
      }).catch((error)=>{
        if(timelineHost?.isConnected)timelineHost.innerHTML=`<div class="muted">Não foi possível carregar o histórico: ${esc(error.message||String(error))}</div>`;
        if(gpsHost?.isConnected)gpsHost.innerHTML=`<div class="muted">Não foi possível carregar os registros GPS: ${esc(error.message||String(error))}</div>`;
      });
    },onConfirm:async()=>{}});
  }

  function openPortariaImport(){
    modal({title:'Importar retornos da Portaria',confirmText:'Gerar prévia',body:`<p class="helper-text">Cole a base com cabeçalho. Campos aceitos: PLACA e DATA/HORA (ou DATA + HORA).</p><label class="field"><span>Base da Portaria</span><textarea id="route-portaria-text" style="min-height:260px" placeholder="PLACA\tDATA\tHORA"></textarea></label>`,onConfirm:async(root)=>{
      const preview=await api('/api/returns',{method:'POST',body:JSON.stringify({action:'portaria-preview',text:$('#route-portaria-text',root).value})});
      const rows=preview.rows||[];const valid=rows.filter((r)=>r.valid);
      modal({title:'Prévia da Portaria',confirmText:`Confirmar ${valid.length} retorno(s)`,body:`<div class="warning-box">Válidos: ${preview.validCount||0} · Inválidos: ${preview.invalidCount||0}</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Linha</th><th>Placa</th><th>Retorno</th><th>Escala</th><th>Situação</th></tr></thead><tbody>${rows.map((r)=>`<tr class="${r.valid?'row-success':'row-danger'}"><td>${r.__sourceRow}</td><td>${esc(r.PLACA||'')}</td><td>${dt(r.DATA_HORA_RETORNO)}</td><td>${esc(r.ESCALA_ID||'—')}</td><td>${r.valid?'Válida':esc((r.errors||[]).join(', '))}</td></tr>`).join('')}</tbody></table></div>`,onConfirm:async()=>{if(!valid.length)throw new Error('Não há retornos válidos para importar.');const requestId=crypto.randomUUID();const result=await api('/api/returns',{method:'POST',body:JSON.stringify({action:'portaria-confirm',requestId,rows:valid})});toast(`${result.processed?.length||0} retorno(s) importado(s).`,result.errors?.length?'warning':'success');await renderReturns();}});
    }});
  }
  function openReturnForm(item={}) {
    const s=item.schedule||item.returnRecord||{}, d=item.departure||item.returnRecord||{}, m=item.monitoring||{}, r=item.returnRecord||{};
    const deliveries=r.entregas ?? m.entregas_realizadas ?? s.qtd_entregas ?? 0;
    const apoioYes=Number(r.apoios||0)>0, devolYes=Number(r.devolucoes||0)>0;
    const now=new Date();now.setMinutes(now.getMinutes()-now.getTimezoneOffset());const defaultReturn=dateTimeLocalValue(r.retorno_real||r.return_at)||now.toISOString().slice(0,16);
    const departureForValidation=dateTimeLocalValue(item.departure?.saida_real||item.departure?.hora_real||r.saida_real||r.hora_real||'');
    const root=modal({title:`Retorno · ${s.rota||r.rota||'Rota'}`,body:`<div class="info-box"><strong>Entregas realizadas:</strong> ${formatNumber(deliveries)} · valor calculado automaticamente e não editável.</div><div class="form-grid"><label class="field"><span>Data e hora real do retorno</span><input id="route-ret-real" type="datetime-local" value="${esc(defaultReturn)}" ${departureForValidation?`min="${esc(departureForValidation)}"`:''}><small>${departureForValidation?`Não pode ser anterior à saída (${esc(dt(departureForValidation))}).`:''}</small></label><label class="field"><span>Origem</span><select id="route-ret-origin">${['MANUAL','MONITORAMENTO','PORTARIA','SANKHYA'].map((x)=>option(x,x,r.origem||'MANUAL')).join('')}</select></label><label class="field"><span>O motorista voltou com devolução?</span><select id="route-ret-devol">${option('NAO','Não',devolYes?'SIM':'NAO')}${option('SIM','Sim',devolYes?'SIM':'NAO')}</select></label><label class="field" id="route-ret-devol-qty-wrap"><span>Quantidade de devoluções</span><input id="route-ret-devol-qty" type="number" min="1" step="1" value="${esc(r.devolucoes||1)}"></label><label class="field"><span>Ele apoiou algum colega em rota?</span><select id="route-ret-apoio">${option('NAO','Não',apoioYes?'SIM':'NAO')}${option('SIM','Sim',apoioYes?'SIM':'NAO')}</select></label><label class="field" id="route-ret-apoio-qty-wrap"><span>Quantidade de apoios</span><input id="route-ret-apoio-qty" type="number" min="1" step="1" value="${esc(r.apoios||1)}"></label><label class="field"><span>KM inicial</span><input id="route-ret-km-i" type="number" value="${esc(r.km_inicial??d.km_inicial??'')}"></label><label class="field"><span>KM final</span><input id="route-ret-km-f" type="number" value="${esc(r.km_final??'')}"></label><label class="field span-2"><span>Observações</span><textarea id="route-ret-obs">${esc(r.observacoes||'')}</textarea></label></div>`,confirmText:r.id?'Salvar ajuste':'Confirmar retorno',onConfirm:async(modalRoot)=>{
      const devol=$('#route-ret-devol',modalRoot).value==='SIM', apoio=$('#route-ret-apoio',modalRoot).value==='SIM';
      const returnValue=$('#route-ret-real',modalRoot).value;if(departureForValidation&&returnValue&&returnValue<departureForValidation)throw new Error(`O retorno não pode ocorrer antes da saída (${dt(departureForValidation)}). Revise dia e mês.`);
      const linkedScheduleId=item.schedule?.id||r.schedule_record_id||r.schedule_id||r.escala_id||r.escala_id_legado||'';
      const linkedStorage=item.schedule?.storage||r.schedule_storage||r.storage||s.storage||'';
      const body={id:r.id||undefined,schedule_record_id:String(linkedScheduleId),storage:linkedStorage,schedule_storage:linkedStorage,monitoring_id:item.monitoring?.id||s.monitoring_id||undefined,orphan_monitoring:Boolean(item.orphanMonitoring||s.orphanMonitoring),departure_id:item.departure?.id||undefined,saida_real:item.departure?.saida_real||item.departure?.hora_real||'',data:item.schedule?.data||r.data||s.data||today(),placa:item.schedule?.placa||r.placa||s.placa||'',rota:item.schedule?.rota||r.rota||s.rota||'',motorista:item.schedule?.motorista||r.motorista||s.motorista||'',ocs:item.schedule?.ocs||r.ocs||s.ocs||'',sequencia:item.schedule?.sequencia||r.sequencia||s.sequencia||'',retorno_real:returnValue,origem:$('#route-ret-origin',modalRoot).value,voltou_com_devolucao:devol,qtd_devolucoes:devol?Number($('#route-ret-devol-qty',modalRoot).value):0,apoiou_alguem:apoio,qtd_apoios_rota:apoio?Number($('#route-ret-apoio-qty',modalRoot).value):0,km_inicial:$('#route-ret-km-i',modalRoot).value,km_final:$('#route-ret-km-f',modalRoot).value,observacoes:$('#route-ret-obs',modalRoot).value,requestId:crypto.randomUUID()};
      const result=await api('/api/returns',{method:r.id?'PUT':'POST',body:JSON.stringify(body),timeoutMs:45000});
      toast(result?.alreadyConfirmed?'Retorno já estava confirmado.':'Retorno confirmado com sucesso.','success');
      state.routeCajuNeedsRefresh=true;
      // O salvamento não depende mais do recarregamento da tela. Se o GET do
      // dashboard oscilar logo após a gravação, não transforme uma confirmação
      // bem-sucedida em erro para o usuário.
      setTimeout(()=>{renderReturns().catch(()=>toast('Retorno confirmado. A atualização automática da lista ficou pendente; use o botão Atualizar.','warning'));},250);
    }});
    const apply=()=>{$('#route-ret-devol-qty-wrap',root).hidden=$('#route-ret-devol',root).value!=='SIM';$('#route-ret-apoio-qty-wrap',root).hidden=$('#route-ret-apoio',root).value!=='SIM';};$('#route-ret-devol',root).onchange=apply;$('#route-ret-apoio',root).onchange=apply;apply();
    if(r.id&&isAdmin()){
      const footer=$('.modal-footer',root),button=document.createElement('button');button.type='button';button.className='btn btn-danger';button.textContent='↩ Reabrir viagem';button.title='Remove o retorno informado por engano e devolve a viagem para EM ROTA.';
      footer?.insertBefore(button,footer.firstChild);
      button.onclick=()=>{
        const linkedScheduleId=item.schedule?.id||r.schedule_record_id||r.schedule_id||r.escala_id||r.escala_id_legado||'';
        const linkedStorage=item.schedule?.storage||r.schedule_storage||r.storage||s.storage||'';
        modal({title:`Reabrir viagem · ${s.rota||r.rota||'Rota'}`,confirmText:'Reabrir como EM ROTA',body:`<div class="warning-box"><strong>Atenção:</strong> use somente quando a viagem foi finalizada por engano. O retorno confirmado será removido, a viagem voltará para <strong>EM ROTA</strong> e veículo/equipe voltarão a ficar ocupados.</div><label class="field"><span>Justificativa da reabertura</span><textarea id="route-return-reopen-reason" placeholder="Ex.: retorno confirmado no veículo errado"></textarea></label>`,onConfirm:async(reopenRoot)=>{
          const reason=$('#route-return-reopen-reason',reopenRoot).value.trim();if(reason.length<5)throw new Error('Informe a justificativa da reabertura.');
          const reopenResult=await api('/api/returns',{method:'POST',body:JSON.stringify({action:'reopen',id:r.id,requestId:crypto.randomUUID(),justificativa:reason,schedule_record_id:String(linkedScheduleId),schedule_storage:linkedStorage,storage:linkedStorage,departure_id:item.departure?.id||r.departure_id||undefined,monitoring_id:item.monitoring?.id||r.monitoring_id||undefined,data:item.schedule?.data||r.data||s.data||'',placa:item.schedule?.placa||r.placa||s.placa||'',rota:item.schedule?.rota||r.rota||s.rota||'',motorista:item.schedule?.motorista||r.motorista||s.motorista||'',ocs:item.schedule?.ocs||r.ocs||s.ocs||'',sequencia:item.schedule?.sequencia||r.sequencia||s.sequencia||''}),timeoutMs:45000});
          if(!reopenResult?.reopened||normalize(reopenResult?.status)!=='EM ROTA')throw new Error('O servidor não confirmou a reabertura da viagem. Nenhuma alteração foi considerada concluída.');
          state.routeCajuNeedsRefresh=true;toast('Viagem reaberta e retornada para EM ROTA.','success');await renderReturns();
        }});
      };
    }
  }

  const monitoringMetric=(label,value,detail,tone='info',icon='activity')=>`<article class="metric-card monitoring-metric is-${esc(tone)}"><div class="metric-card-head"><span class="monitoring-metric-icon" aria-hidden="true"><i data-lucide="${esc(icon)}"></i></span><div class="metric-label">${esc(label)}</div></div><div class="metric-value">${esc(value)}</div><div class="metric-detail">${esc(detail)}</div></article>`;
  const monitoringEmpty=(label)=>`<div class="monitoring-empty" role="status"><span class="monitoring-empty-icon" aria-hidden="true"><i data-lucide="inbox"></i></span><strong>Nenhum registro</strong><span>${esc(label)}</span></div>`;
  const monitoringSkeleton=()=>`<div class="monitoring-view monitoring-skeleton" aria-busy="true" aria-label="Carregando monitoramento"><div class="monitoring-skeleton-header"><span></span><span></span><span></span></div><div class="cards-grid monitoring-skeleton-metrics">${Array.from({length:4},()=>'<article class="monitoring-skeleton-card"><span></span><strong></strong><small></small></article>').join('')}</div><div class="monitoring-skeleton-grid">${Array.from({length:6},()=>'<section class="monitoring-skeleton-column"><span></span><div></div><div></div></section>').join('')}</div></div>`;
  const lincrosPosition=(item={})=>{if(item.syncHealthy!==true)return null;const lat=Number(item.latitude),lng=Number(item.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;const nearby=Array.isArray(item.nearbyClients)?item.nearbyClients:[],nearest=nearby[0]||null,code=String(nearest?.code||nearest?.codigo||'').trim(),name=String(nearest?.name||nearest?.nome||'').trim(),city=String(nearest?.city||'').trim(),stateName=String(nearest?.state||'').trim(),clientLabel=name?`${code?`[${code}] `:''}${name}${city?` · ${city}${stateName?`/${stateName}`:''}`:''}`:'',coords=`${lat.toFixed(5)}, ${lng.toFixed(5)}`,label=clientLabel||String(item.locationLabel||'').trim()||`Lincros · ${coords}`;return {plate:routePlate(item.plate||''),latitude:lat,longitude:lng,updatedAt:item.positionAt||item.sourceUpdatedAt||item.checkedAt||'',point:label,location:label,nearbyClients:nearby,source:'LINCROS',timestampSource:'LINCROS_STATUS_ROTA',speed:null,ignition:null,speedReliable:false,ignitionReliable:false,stoppedMinutes:0,gpsAgeMinutes:routeGpsAgeMinutes(item.positionAt||item.sourceUpdatedAt||item.checkedAt||'')};};
  const monitoringDistanceMeters=(lat1,lng1,lat2,lng2)=>{const values=[lat1,lng1,lat2,lng2].map(Number);if(!values.every(Number.isFinite))return Number.POSITIVE_INFINITY;const [a1,o1,a2,o2]=values,toRad=(value)=>value*Math.PI/180,R=6371000,dLat=toRad(a2-a1),dLng=toRad(o2-o1),h=Math.sin(dLat/2)**2+Math.cos(toRad(a1))*Math.cos(toRad(a2))*Math.sin(dLng/2)**2;return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));};
  const monitoringTripNearbyClients=(position={},lincros={})=>{const lat=Number(position?.latitude),lng=Number(position?.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng)||lincros?.syncHealthy!==true)return [];const seen=new Set();return (Array.isArray(lincros?.deliveries)?lincros.deliveries:[]).map((delivery)=>{const dLat=Number(delivery?.latitude),dLng=Number(delivery?.longitude),distance=monitoringDistanceMeters(lat,lng,dLat,dLng);return {...delivery,distanceMeters:Math.round(distance)};}).filter((delivery)=>Number.isFinite(delivery.distanceMeters)&&delivery.distanceMeters<=100).filter((delivery)=>{const key=String(delivery.clientCode||delivery.deliveryCode||`${delivery.latitude}|${delivery.longitude}|${delivery.clientName||''}`);if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,3).map((delivery)=>({code:delivery.clientCode||'',name:delivery.clientName||'Cliente',latitude:Number(delivery.latitude),longitude:Number(delivery.longitude),distanceMeters:delivery.distanceMeters}));};
  const attachMonitoringTripNearbyClients=(record={})=>{const pos=record?.gps_position;if(!pos)return record;const nearbyClients=monitoringTripNearbyClients(pos,record.lincros||{});return {...record,gps_position:{...pos,nearbyClients}};};
  const lincrosReverseGeocodeCache=new Map(),lincrosReverseGeocodePending=new Map();
  const lincrosReverseGeocodeKey=(lat,lng)=>`${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
  const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
  async function reverseGeocodeLincrosPosition(lat,lng){
    if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng)))return null;
    const key=lincrosReverseGeocodeKey(lat,lng);if(lincrosReverseGeocodeCache.has(key))return lincrosReverseGeocodeCache.get(key);if(lincrosReverseGeocodePending.has(key))return lincrosReverseGeocodePending.get(key);
    const pending=api(`/api/reverse-geocode?lat=${encodeURIComponent(Number(lat))}&lng=${encodeURIComponent(Number(lng))}`,{timeoutMs:12000}).then((result)=>{const value=result?.ok&&result?.label?result:null;if(value)lincrosReverseGeocodeCache.set(key,value);return value;}).catch(()=>null).finally(()=>lincrosReverseGeocodePending.delete(key));
    lincrosReverseGeocodePending.set(key,pending);return pending;
  }
  async function hydrateLincrosLocationNames(records=[]){
    let freshLookups=0;
    for(const record of records){
      const pos=record?.gps_position||{};if(pos.source!=='LINCROS'||routeNearbyClients(pos).length)continue;
      const lat=Number(pos.latitude),lng=Number(pos.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
      if(pos.reverseGeocodeLabel){record.localizacao=pos.reverseGeocodeLabel;continue;}
      const result=await reverseGeocodeLincrosPosition(lat,lng);if(!result?.label)continue;
      const label=String(result.label||'').trim();if(!label)continue;
      pos.reverseGeocodeLabel=label;pos.reverseGeocodeProvider=result.provider||'NOMINATIM';pos.reverseGeocodeAt=result.updatedAt||'';pos.point=label;pos.location=label;record.localizacao=label;
      const locationEl=document.querySelector(`[data-route-monitor-location="${String(record.id||'').replace(/"/g,'\\"')}"]`);if(locationEl)locationEl.textContent=label;
      if(result.cached===false){freshLookups+=1;if(freshLookups>=4)break;await sleep(1100);}
    }
  }
  const routePositionMs=(pos)=>{const d=routeGpsDate(pos?.updatedAt);return d?d.getTime():0;};
  const normalizeProtectPosition=(pos,source='PROTECTSAT')=>pos?{...pos,source:pos.source||source,speedReliable:true,ignitionReliable:true}:null;
  // ProtectSat é a fonte primária. Como /api/protectsat?view=latest já devolve a última
  // posição persistida no D1 quando a API externa não responde, nunca substituímos uma
  // posição ProtectSat existente por Lincros apenas por ela ser mais recente.
  // Lincros entra somente quando não há nenhuma posição ProtectSat conhecida para a placa.
  const bestRoutePosition=(protectPos,lincrosPos)=>{const primary=normalizeProtectPosition(protectPos,protectPos?.source||'PROTECTSAT');return primary||lincrosPos||null;};
  const lincrosDistanceKm=(value)=>Number.isFinite(Number(value))?Number(value)/1000:null;
  const lincrosDistanceText=(value)=>{const km=lincrosDistanceKm(value);return km===null?'—':`${formatNumber(km,2)} km`;};
  const lincrosWeightNumber=(value)=>{if(value===null||value===undefined||value==='')return null;const weight=Number(value);return Number.isFinite(weight)?weight:null;};
  const lincrosWeightText=(value)=>{const weight=lincrosWeightNumber(value);return weight===null?'—':`${formatNumber(weight,2)} kg`;};
  const lincrosWeightTotal=(rows=[],key='weightDelivered')=>{let total=0,found=false;for(const row of rows){const weight=lincrosWeightNumber(row?.[key]);if(weight===null)continue;total+=weight;found=true;}return found?total:null;};
  const monitoringLincrosTime=(item={})=>{const parsed=routeGpsDate(item.checkedAt||item.syncedAt||item.sourceUpdatedAt||'');return parsed?parsed.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',hour12:false}):'';};
  const monitoringDeliveryProgress=(doneValue,plannedValue)=>{const planned=Math.max(0,Number(plannedValue||0)||0),done=Math.max(0,Math.min(planned||Number.MAX_SAFE_INTEGER,Number(doneValue||0)||0)),percent=planned?Math.max(0,Math.min(100,done/planned*100)):0;return {planned,done,percent,pointedLabel:`${formatNumber(done)} apontada${done===1?'':'s'}`,plannedLabel:`${formatNumber(planned)} prevista${planned===1?'':'s'} · ${formatNumber(percent,1)}%`};};
  const applyLincrosMonitoringResult=(record,item)=>{
    if(!record||!item||item.syncHealthy!==true)return false;
    const planned=Math.max(0,Number(item.deliveriesPlanned??record.entregas_previstas??0)||0),done=Math.max(0,Number(item.deliveriesDone??0)||0),progress=monitoringDeliveryProgress(done,planned);
    record.lincros=item;record.entregas_previstas=planned;record.entregas_realizadas=done;record.entregas_pendentes=Math.max(0,planned-done);
    if(planned>0&&done>=planned&&!['FINALIZADO','RETORNOU','CANCELADO'].includes(normalize(record.status||record.status_monitoramento||''))){record.status='EM RETORNO';record.status_monitoramento='EM RETORNO';record.status_automatico_lincros=true;}
    const deliveryNode=$$('[data-route-monitor-deliveries]').find((node)=>String(node.dataset.routeMonitorDeliveries||'')===String(record.id||''));
    const sourceNode=$$('[data-route-monitor-delivery-source]').find((node)=>String(node.dataset.routeMonitorDeliverySource||'')===String(record.id||''));
    const statusNode=$$('[data-route-monitor-status]').find((node)=>String(node.dataset.routeMonitorStatus||'')===String(record.id||''));
    if(deliveryNode)deliveryNode.textContent=`${formatNumber(done)} / ${formatNumber(planned)}`;
    if(sourceNode){const time=monitoringLincrosTime(item);sourceNode.textContent=`Lincros${time?` · ${time}`:''}`;}
    if(statusNode&&record.status_automatico_lincros)statusNode.innerHTML=badge('EM RETORNO');
    const detailDelivery=$('[data-monitor-detail-deliveries]'),detailPending=$('[data-monitor-detail-pending]'),detailStatus=$('[data-monitor-detail-status]');
    if(detailDelivery?.isConnected)detailDelivery.textContent=`${formatNumber(done)} / ${formatNumber(planned)}`;
    if(detailPending?.isConnected)detailPending.textContent=formatNumber(Math.max(0,planned-done));
    if(detailStatus?.isConnected&&record.status_automatico_lincros)detailStatus.textContent='EM RETORNO';
    return true;
  };
  const deliveryVehicleType=(value='')=>{const text=normalize(value).replace('3X4','3/4');if(text.includes('BITRUCK'))return 'BITRUCK';if(text.includes('TRUCK'))return 'TRUCK';if(text.includes('TOCO'))return 'TOCO';if(text.includes('3/4')||text==='34')return '3/4';return text||'';};
  const deliveryCostPerKm=(type)=>({'3/4':5.80,TOCO:5.60,TRUCK:5.30,BITRUCK:4.80})[deliveryVehicleType(type)]??null;
  const deliveryViabilityLimit=(region='')=>{const key=['AG1','AG2','SRT','AL','PB'].find((x)=>normalize(region)===x||normalize(region).startsWith(`${x} `));return ({AG1:.441,AG2:.441,SRT:.945,AL:.91,PB:.56})[key]??null;};
  const lincrosExecutionStats=(item={})=>{const delivered=(Array.isArray(item.deliveries)?item.deliveries:[]).filter((x)=>x.delivered),seq=delivered.filter((x)=>Number.isFinite(Number(x.sequencePlanned))&&Number.isFinite(Number(x.sequenceActual))),seqOk=seq.filter((x)=>Number(x.sequencePlanned)===Number(x.sequenceActual)).length,radius=delivered.filter((x)=>x.withinRadius===true||x.withinRadius===false),radiusOk=radius.filter((x)=>x.withinRadius===true).length;return {seqApplicable:seq.length,seqOk,seqPct:seq.length?seqOk/seq.length*100:null,radiusApplicable:radius.length,radiusOk,radiusPct:radius.length?radiusOk/radius.length*100:null};};
  const monitoringOcsText=(source={})=>{const value=source?.ocs??source?.OCS??source?.oc??source?.OC??source?.carga??source?.CARGA??'';return Array.isArray(value)?value.map((item)=>String(item??'').trim()).filter(Boolean).join(' / '):String(value??'').trim();};
  const monitoringTripEconomics=(record={},item={})=>{const type=deliveryVehicleType(record.veiculo_tipo||record.tipo_veiculo||''),capacityT=Number(record.veiculo_capacidade_t||record.capacidade_t||0)||0,weightKg=Number(record.peso_kg||0)||Number(record.peso_t||0)*1000||0,distanceKm=lincrosDistanceKm(item.distanceActual),costKm=deliveryCostPerKm(type),tripCost=distanceKm!==null&&costKm!==null?distanceKm*costKm:null,costKg=tripCost!==null&&weightKg>0?tripCost/weightKg:null,limit=deliveryViabilityLimit(record.regiao||''),occupancy=capacityT>0?weightKg/(capacityT*1000)*100:null;return {type,capacityT,weightKg,distanceKm,costKm,tripCost,costKg,limit,occupancy,viable:costKg!==null&&limit!==null?costKg<=limit:null};};
  const lincrosClientRow=(item={})=>`<tr><td><strong>${esc(item.clientName||'Cliente')}</strong><div class="muted">${item.clientCode?`Cód. ${esc(item.clientCode)}`:'Código não informado'}${item.notes?.length?` · NF ${esc(item.notes.join(' / '))}`:''}</div></td><td>${item.sequencePlanned??'—'}${item.sequenceActual!==null&&item.sequenceActual!==undefined?` → ${esc(item.sequenceActual)}`:''}</td><td>${item.withinRadius===true?'<span class="badge badge-success">SIM</span>':item.withinRadius===false?'<span class="badge badge-warning">NÃO</span>':'—'}</td><td>${item.arrivedAt?dt(item.arrivedAt):'—'}</td><td>${item.leftAt?dt(item.leftAt):'—'}</td><td>${Number.isFinite(Number(item.retentionMinutes))?formatMinutes(Number(item.retentionMinutes)):'—'}</td><td><strong>${lincrosWeightText(item.weightPlanned)}</strong></td><td>${lincrosWeightText(item.weightDelivered)}</td><td>${lincrosWeightText(item.weightReturned)}</td><td>${lincrosDistanceText(item.distancePlanned)}</td><td>${lincrosDistanceText(item.distanceActual)}</td>${item.proofUrl?`<td><a class="btn btn-ghost btn-sm" href="${esc(item.proofUrl)}" target="_blank" rel="noopener">Comprovante</a></td>`:'<td>—</td>'}</tr>`;
  const lincrosDeliveryTable=(title,rows=[],tone='info')=>`<div class="fleet-detail-section"><span>${esc(title)} · ${rows.length}</span>${rows.length?`<div class="table-wrap"><table class="data-table lincros-delivery-table"><thead><tr><th>Cliente</th><th>Seq.</th><th>No raio?</th><th>Chegada</th><th>Saída</th><th>Retenção</th><th>Peso previsto</th><th>Peso entregue</th><th>Peso devolvido</th><th>Dist. planejada</th><th>Dist. real</th><th>Comprovante</th></tr></thead><tbody>${rows.map(lincrosClientRow).join('')}</tbody></table></div>`:`<div class="muted">Nenhum cliente nesta situação.</div>`}</div>`;
  const lincrosDetailsHtml=(item={},record={})=>{if(!item)return '<div class="muted">Ainda não há dados Lincros armazenados para esta viagem.</div>';if(item.syncHealthy!==true){return `<div class="info-box"><strong>Integração Lincros ainda não confirmada.</strong>${item.lastError?`<br><span class="muted">${esc(item.lastError)}</span>`:'<br><span class="muted">Aguardando uma sincronização válida de Jornada + StatusRota.</span>'}${item.checkedAt?`<br><small>Última tentativa: ${esc(auditDt(item.checkedAt))}</small>`:''}</div>`;}const deliveries=Array.isArray(item.deliveries)?item.deliveries:[],done=deliveries.filter((x)=>x.delivered),returned=deliveries.filter((x)=>x.returned&&!x.delivered),pending=deliveries.filter((x)=>x.pending),weightPending=lincrosWeightTotal(pending,'weightPlanned'),weightDelivered=lincrosWeightTotal(deliveries,'weightDelivered'),weightReturned=lincrosWeightTotal(deliveries,'weightReturned'),exec=lincrosExecutionStats(item),eco=monitoringTripEconomics(record,item);const pct=(value)=>value===null?'—':`${formatNumber(value,1)}%`,money=(value)=>value===null?'—':`R$ ${formatNumber(value,2)}`,moneyKg=(value)=>value===null?'—':`R$ ${formatNumber(value,3)}/kg`;return `<div class="info-box"><strong>Integração Lincros:</strong> ${item.routeCodes?.length?`rota(s) ${esc(item.routeCodes.join(' / '))}`:'rota ainda não vinculada'} · última consulta ${item.checkedAt?esc(auditDt(item.checkedAt)):'—'}</div><div class="fleet-detail-grid"><div class="fleet-detail-stat"><span>Entregas</span><strong>${formatNumber(item.deliveriesDone||0)} / ${formatNumber(item.deliveriesPlanned||0)}</strong></div><div class="fleet-detail-stat"><span>Peso pendente · Lincros</span><strong>${lincrosWeightText(weightPending)}</strong><small>Soma do peso previsto dos clientes pendentes</small></div><div class="fleet-detail-stat"><span>Peso entregue · Lincros</span><strong>${lincrosWeightText(weightDelivered)}</strong><small>Soma dos clientes com peso informado</small></div><div class="fleet-detail-stat"><span>Peso devolvido · Lincros</span><strong>${lincrosWeightText(weightReturned)}</strong><small>Soma dos clientes com devolução informada</small></div><div class="fleet-detail-stat"><span>Cumprimento da sequência</span><strong>${pct(exec.seqPct)}</strong><small>${exec.seqOk}/${exec.seqApplicable} entrega(s) aplicável(is)</small></div><div class="fleet-detail-stat"><span>Apontamentos dentro do raio</span><strong>${pct(exec.radiusPct)}</strong><small>${exec.radiusOk}/${exec.radiusApplicable} entrega(s) aplicável(is)</small></div><div class="fleet-detail-stat"><span>Retenção acumulada</span><strong>${Number.isFinite(Number(item.retentionMinutes))?formatMinutes(Number(item.retentionMinutes)):'—'}</strong></div><div class="fleet-detail-stat"><span>Distância planejada</span><strong>${lincrosDistanceText(item.distancePlanned)}</strong></div><div class="fleet-detail-stat"><span>Distância real</span><strong>${lincrosDistanceText(item.distanceActual)}</strong></div><div class="fleet-detail-stat"><span>Tipo / capacidade</span><strong>${esc(eco.type||'—')}</strong><small>${eco.capacityT?`${formatNumber(eco.capacityT,1)} t`:'Capacidade não cadastrada'}</small></div><div class="fleet-detail-stat"><span>Ocupação</span><strong>${eco.occupancy===null?'—':`${formatNumber(eco.occupancy,1)}%`}</strong><small>${eco.weightKg?`${formatNumber(eco.weightKg,0)} kg roteirizados`:''}</small></div><div class="fleet-detail-stat"><span>Custo por km</span><strong>${eco.costKm===null?'—':`R$ ${formatNumber(eco.costKm,2)}/km`}</strong></div><div class="fleet-detail-stat"><span>Custo acumulado da viagem</span><strong>${money(eco.tripCost)}</strong><small>Distância real × custo/km</small></div><div class="fleet-detail-stat"><span>Custo por kg</span><strong>${moneyKg(eco.costKg)}</strong><small>${eco.limit!==null?`Limite ${moneyKg(eco.limit)}`:'Área sem limite configurada'}</small></div><div class="fleet-detail-stat"><span>Viabilidade</span><strong>${eco.viable===null?'—':eco.viable?'<span class="badge badge-success">VIÁVEL</span>':'<span class="badge badge-danger">ACIMA DO LIMITE</span>'}</strong></div><div class="fleet-detail-stat"><span>Última posição Lincros</span><strong>${item.positionAt?esc(dt(item.positionAt)):'—'}</strong></div><div class="fleet-detail-stat"><span>Fonte</span><strong>Lincros Tracking</strong></div></div><div class="helper-text">O DMS também procura o peso previsto da entrega no atendimento, pedido ou nota fiscal da Lincros. Assim, clientes ainda pendentes podem exibir o peso planejado antes do apontamento. PesoEntregue e PesoDevolvido continuam representando os valores realizados quando informados. Distâncias Lincros são convertidas de metros para quilômetros.</div>${lincrosDeliveryTable('Clientes entregues',done,'success')}${returned.length?lincrosDeliveryTable('Finalizados com devolução',returned,'warning'):''}${lincrosDeliveryTable('Clientes pendentes',pending,'info')}`;};


  async function openIntegrationDiagnostics(records=[]){
    const sample=(records||[]).find((r)=>r?.placa&&r?.data)||(records||[]).find((r)=>r?.placa)||{};
    modal({title:'Diagnóstico das integrações',confirmText:'Fechar',body:'<div id="integration-diag-host" class="page-load-state"><div class="spinner"></div><strong>Executando diagnóstico seguro...</strong><span>Os valores das chaves não são exibidos.</span></div>',onOpen:async(root)=>{
      const host=$('#integration-diag-host',root);const yes=(v)=>v?'<span class="badge badge-success">OK</span>':'<span class="badge badge-danger">AUSENTE</span>';
      try{
        const [runtime,protect,lincros]=await Promise.all([
          api('/api/integration-diagnostics',{fresh:true,connectionImpact:false,timeoutMs:20000}),
          api(`/api/protectsat?scope=route&view=diagnostic&force=1${sample.placa?`&plates=${encodeURIComponent(sample.placa)}`:''}`,{fresh:true,connectionImpact:false,timeoutMs:45000}).catch((error)=>({diagnostic:{liveProbe:{ok:false,error:error.message||String(error)}},erro:error.message||String(error)})),
          api(`/api/lincros?view=diagnostic${sample.placa?`&plate=${encodeURIComponent(sample.placa)}`:''}${sample.data?`&date=${encodeURIComponent(sample.data)}`:''}`,{fresh:true,connectionImpact:false,timeoutMs:65000}).catch((error)=>({probe:{ok:false,error:error.message||String(error)},erro:error.message||String(error)}))
        ]);
        const ps=runtime.protectSat||{},li=runtime.lincros||{},live=protect?.diagnostic?.liveProbe||null,probe=lincros?.probe||null;
        host.className='';host.innerHTML=`<div class="info-box"><strong>Ambiente que respondeu:</strong> ${esc(runtime.runtime?.host||'—')} · versão ${esc(runtime.version||'—')}<br><span class="muted">Se as variáveis existem em outro Worker/Pages, mas aparecem AUSENTE aqui, elas estão configuradas no projeto/ambiente errado.</span></div>
          <div class="fleet-detail-grid"><div class="fleet-detail-stat"><span>ProtectSat · chave</span><strong>${yes(ps.keyPresent)}</strong></div><div class="fleet-detail-stat"><span>ProtectSat · cache D1</span><strong>${esc(String(ps.cache?.cacheCount??0))}</strong><small>${esc(ps.cache?.latestGpsTime||'sem posição')}</small></div><div class="fleet-detail-stat"><span>ProtectSat · teste ao vivo</span><strong>${live?.ok?'<span class="badge badge-success">OK</span>':'<span class="badge badge-danger">FALHOU</span>'}</strong><small>${esc(live?.error||`${live?.sourceTotal??0} registro(s)`)}</small></div><div class="fleet-detail-stat"><span>Lincros · API key</span><strong>${yes(li.apiKeyPresent)}</strong></div><div class="fleet-detail-stat"><span>Lincros · base</span><strong>${esc(li.baseHost||'—')}</strong><small>variável ${li.baseVarPresent?'presente':'usando padrão'}</small></div><div class="fleet-detail-stat"><span>Lincros · cache saudável</span><strong>${esc(String(li.cache?.healthyCount??0))}</strong><small>${esc(String(li.cache?.errorCount??0))} com erro</small></div></div>
          <section class="panel"><div class="panel-header"><h3>Teste Lincros ${sample.placa?`· ${esc(sample.placa)}`:''}</h3></div><div class="panel-body"><pre class="diagnostic-pre">${esc(JSON.stringify(probe||{info:'Sem placa/data para teste.'},null,2))}</pre></div></section>
          <section class="panel"><div class="panel-header"><h3>Últimos erros Lincros armazenados</h3></div><div class="panel-body"><pre class="diagnostic-pre">${esc(JSON.stringify(li.recentErrors||[],null,2))}</pre></div></section>`;refreshIcons();
      }catch(error){host.className='danger-box';host.textContent=`Falha ao executar diagnóstico: ${error.message||String(error)}`;}
    }});refreshIcons();
  }

  function generateOvernightPendingClientsPdf(rows=[],filters={}){
    const overnight=(rows||[]).filter((r)=>normalize(r.status||r.status_monitoramento)==='PERNOITE');
    const reportRows=overnight.map((r)=>{
      const lincros=r.lincros||null;
      const syncHealthy=lincros?.syncHealthy===true;
      const deliveries=syncHealthy&&Array.isArray(lincros?.deliveries)?lincros.deliveries:[];
      const pending=deliveries.filter((item)=>item?.pending===true).sort((a,b)=>(Number(a.sequencePlanned)||99999)-(Number(b.sequencePlanned)||99999)||String(a.clientName||'').localeCompare(String(b.clientName||''),'pt-BR'));
      const planned=Math.max(0,Number(syncHealthy?(lincros?.deliveriesPlanned??r.entregas_previstas??0):(r.entregas_previstas??0))||0);
      const done=Math.max(0,Number(syncHealthy?(lincros?.deliveriesDone??r.entregas_realizadas??0):(r.entregas_realizadas??0))||0);
      const pendingCount=Math.max(0,Number(r.entregas_pendentes??(planned-done))||0,pending.length);
      return {...r,lincros,deliveriesPending:pending,planned,done,pendingCount};
    }).filter((r)=>r.pendingCount>0);
    if(!reportRows.length){toast('Nenhuma rota em PERNOITE com clientes pendentes corresponde aos filtros atuais.','warning');return;}
    const generated=new Date().toLocaleString('pt-BR');
    const statusLabel=filters.status?String(filters.status):'Todas as etapas';
    const filterText=[filters.query?`Busca: ${filters.query}`:'',`Etapa da tela: ${statusLabel}`,filters.region?`Região: ${filters.region}`:'Região: Todas',filters.category?`Categoria: ${filters.category}`:'Categoria: Todas'].filter(Boolean).join(' · ');
    const totalPlanned=reportRows.reduce((sum,r)=>sum+r.planned,0);
    const totalDone=reportRows.reduce((sum,r)=>sum+r.done,0);
    const totalPending=reportRows.reduce((sum,r)=>sum+r.pendingCount,0);
    const unsynced=reportRows.filter((r)=>r.lincros?.syncHealthy!==true||!r.deliveriesPending.length).length;
    const sections=reportRows.sort((a,b)=>String(a.rota||'').localeCompare(String(b.rota||''),'pt-BR')||String(a.placa||'').localeCompare(String(b.placa||''),'pt-BR')).map((r)=>{
      const clientRows=r.deliveriesPending.map((item)=>`<tr><td>${item.sequencePlanned??'—'}</td><td>${esc(item.clientCode||'—')}</td><td><strong>${esc(item.clientName||'Cliente não identificado')}</strong></td><td>${item.notes?.length?esc(item.notes.join(' / ')):'—'}</td><td><span class="pending-badge">PENDENTE</span></td></tr>`).join('');
      const detailAvailable=Boolean(clientRows);
      const warning=!detailAvailable?`<div class="route-warning"><strong>Atenção:</strong> esta rota possui ${formatNumber(r.pendingCount)} entrega(s) pendente(s), porém o detalhamento dos clientes ainda não está disponível na sincronização Lincros. Atualize o Monitoramento antes de enviar o relatório, se necessário.</div>`:'';
      return `<section class="route-section"><div class="route-head"><div><h2>${esc(r.rota||'Rota')}</h2><p><strong>Placa:</strong> ${esc(r.placa||'—')} · <strong>Motorista:</strong> ${esc(r.motorista||'—')}</p></div><div class="route-progress"><span>Entregas realizadas</span><strong>${formatNumber(r.done)} de ${formatNumber(r.planned)}</strong><small>${formatNumber(r.pendingCount)} pendente(s)</small></div></div>${warning}${detailAvailable?`<table><thead><tr><th>Seq.</th><th>Código</th><th>Cliente</th><th>NF / referência</th><th>Status</th></tr></thead><tbody>${clientRows}</tbody></table>`:''}</section>`;
    }).join('');
    const w=window.open('','_blank');
    if(!w){toast('O navegador bloqueou a janela do PDF. Libere pop-ups para este sistema e tente novamente.','warning');return;}
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Clientes pendentes · Pernoites</title><style>@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;color:#10231a;font-family:Arial,Helvetica,sans-serif}.report-head{display:flex;align-items:center;gap:12px;border-bottom:3px solid #006015;padding-bottom:8px;margin-bottom:8px}.report-head img{width:76px;height:38px;object-fit:contain}.report-head div{flex:1}.report-head h1{margin:0;font-size:18px;color:#006015}.report-head p{margin:3px 0 0;font-size:8.5px;color:#475467}.filters{border:1px solid #b7c9bd;background:#f4faf6;padding:6px 8px;margin-bottom:8px;font-size:8px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}.kpi{border:1px solid #aabbb0;border-radius:6px;padding:6px}.kpi span{display:block;font-size:6.8px;text-transform:uppercase;color:#667085;font-weight:700}.kpi strong{display:block;margin-top:2px;font-size:13px}.report-note{font-size:7.5px;color:#475467;margin:0 0 10px}.route-section{margin:0 0 8mm;break-inside:auto}.route-head{display:flex;justify-content:space-between;align-items:center;gap:10px;border-left:5px solid #d97706;background:#fff7ed;padding:6px 8px;break-after:avoid;page-break-after:avoid}.route-head h2{margin:0;font-size:12px;color:#7c2d12}.route-head p{margin:3px 0 0;font-size:8px;color:#475467}.route-progress{text-align:right;white-space:nowrap}.route-progress span,.route-progress small{display:block;font-size:7px;color:#667085}.route-progress strong{display:block;font-size:12px}.route-warning{padding:6px 8px;border:1px solid #f3c98b;background:#fffaf0;font-size:8px;margin-top:4px}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:4px}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #aabbb0;padding:4px;font-size:7.6px;line-height:1.2;vertical-align:middle;overflow-wrap:anywhere}th{background:#dfeee4;text-transform:uppercase;font-size:6.9px}tbody tr:nth-child(even) td{background:#f7faf8}th:nth-child(1){width:8%}th:nth-child(2){width:14%}th:nth-child(3){width:36%}th:nth-child(4){width:27%}th:nth-child(5){width:15%}.pending-badge{display:inline-block;border:1px solid #d97706;background:#fff7ed;color:#9a3412;border-radius:999px;padding:2px 5px;font-size:6.5px;font-weight:800}.footer{margin-top:8px;border-top:1px solid #d0d5dd;padding-top:5px;font-size:7px;color:#667085}@media print{.route-section:last-child{margin-bottom:0}}</style></head><body><header class="report-head"><img src="${LOGO_URL}" alt="Natto"><div><h1>Clientes pendentes · Rotas em Pernoite</h1><p>Relatório para acompanhamento com o time Comercial · gerado em ${esc(generated)}</p></div></header><div class="filters"><strong>Filtros aplicados na tela:</strong> ${esc(filterText)}. O relatório considera somente rotas com status <strong>PERNOITE</strong> dentro do resultado filtrado.</div><div class="kpis"><div class="kpi"><span>Rotas com pendência</span><strong>${formatNumber(reportRows.length)}</strong></div><div class="kpi"><span>Entregas previstas</span><strong>${formatNumber(totalPlanned)}</strong></div><div class="kpi"><span>Entregas realizadas</span><strong>${formatNumber(totalDone)}</strong></div><div class="kpi"><span>Clientes pendentes</span><strong>${formatNumber(totalPending)}</strong></div></div>${unsynced?`<p class="report-note"><strong>Atenção:</strong> ${formatNumber(unsynced)} rota(s) possui(em) pendência sem detalhamento completo de clientes na Lincros. Essas rotas são sinalizadas abaixo.</p>`:''}${sections}<div class="footer">NATTO DMS Rota · Monitoramento. Para gerar o arquivo PDF, escolha “Salvar como PDF” na janela de impressão do navegador.</div><script>window.onload=()=>setTimeout(()=>window.print(),220)<\/script></body></html>`);
    w.document.close();
  }

  function monitoringOccurrenceListFor(record={},occurrences=[]){
    const recordId=String(record.id||'').trim();
    const scheduleId=String(record.schedule_record_id||record.schedule_id||record.escala_id||'').trim();
    const plate=normalize(record.placa||''),route=normalize(record.rota||'');
    return (occurrences||[]).filter((occurrence)=>{
      const monitoringId=String(occurrence.related?.monitoringId||'').trim();
      const occurrenceSchedule=String(occurrence.schedule_record_id||'').trim();
      if(recordId&&monitoringId)return recordId===monitoringId;
      if(scheduleId&&occurrenceSchedule)return scheduleId===occurrenceSchedule;
      if(monitoringId||occurrenceSchedule)return false;
      return Boolean(plate&&route&&normalize(occurrence.placa||'')===plate&&normalize(occurrence.rota||'')===route);
    }).sort((a,b)=>String(b.related?.detectedAt||b.data||'').localeCompare(String(a.related?.detectedAt||a.data||'')));
  }

  function openMonitoringOccurrenceJustification(record={}){
    const occurrences=Array.isArray(record.operational_occurrences)?record.operational_occurrences:[];
    if(!occurrences.length){toast('Não há ocorrência pendente para esta viagem.','warning');return;}
    const initial=occurrences[0];
    const options=occurrences.map((row)=>`<option value="${esc(row.key||row.id)}">${esc(row.tipo||'Ocorrência')} · ${esc(row.related?.stoppedMinutes?formatMinutes(row.related.stoppedMinutes):row.data||'')}</option>`).join('');
    const list=occurrences.map((row)=>`<div class="monitor-occurrence-summary"><strong>${esc(row.tipo||'Ocorrência operacional')}</strong><span>${esc(row.detalhes||row.description||'Sem detalhe')}</span><small>${esc(row.related?.active?'Em andamento':'Finalizada')} · ${esc(row.monitorResponsavel||row.responsavel||'Monitoramento')} · ${esc(row.related?.stoppedMinutes?formatMinutes(row.related.stoppedMinutes):'')}</small></div>`).join('');
    modal({title:`Justificar ocorrência · ${record.rota||record.placa||'Monitoramento'}`,confirmText:'Salvar justificativa',body:`<div class="info-box"><strong>${esc(record.rota||'Rota')}</strong> · ${esc(record.placa||'—')}<br>Motorista: ${esc(record.motorista||'—')}<br>${occurrences.length>1?`<strong>${occurrences.length} ocorrências pendentes nesta viagem.</strong> Selecione abaixo qual deseja tratar.`:`<strong>${esc(initial.tipo||'Ocorrência operacional')}</strong>`}</div>${occurrences.length>1?`<label class="field"><span>Ocorrência</span><select id="monitor-occurrence-key">${options}</select></label>`:`<input type="hidden" id="monitor-occurrence-key" value="${esc(initial.key||initial.id)}">`}<div class="monitor-occurrence-list">${list}</div><label class="field"><span>Justificativa</span><textarea id="monitor-occurrence-justification" placeholder="Explique a causa e/ou tratativa realizada."></textarea><small>Mínimo de 8 caracteres. O registro entra no mesmo histórico de auditoria da aba Ocorrências.</small></label>`,onConfirm:async(root)=>{
      const key=$('#monitor-occurrence-key',root)?.value||'';
      const justification=$('#monitor-occurrence-justification',root)?.value||'';
      await api('/api/operational-pending',{method:'POST',body:JSON.stringify({key,justification,requestId:crypto.randomUUID()})});
      toast('Ocorrência justificada pelo Monitoramento.','success');
      await renderMonitoring({fresh:true});
    }});
  }

  async function renderMonitoring({fresh=false,refreshGps=false}={}) {
    clearInterval(state.routeGpsTimer);
    $('#page-content').innerHTML=monitoringSkeleton();

    const activeStatuses=new Set(['EM ROTA','PERNOITE','RETORNO PREVISTO','EM RETORNO','NO DESTINO','DESCARREGADO']);
    const onlyActive=(rows=[])=>(rows||[]).filter((x)=>activeStatuses.has(normalize(x.status||x.status_monitoramento)));
    let {records=[]}=await api('/api/monitoring?operational=1&recentDays=3&lite=1&activeOnly=1',{fresh,timeoutMs:30000,maxAttempts:1});
    records=onlyActive(records);
    let pendingOccurrencePayload={records:[]};
    try{pendingOccurrencePayload=await api('/api/operational-pending',{fresh:true,connectionImpact:false,navigationScoped:false,timeoutMs:18000,maxAttempts:1});}catch(error){console.warn('Ocorrências pendentes indisponíveis no Monitoramento',error?.message||error);}
    const pendingOccurrences=Array.isArray(pendingOccurrencePayload.records)?pendingOccurrencePayload.records:[];
    let lincrosPayload={records:[],runtimeConfigured:false};try{lincrosPayload=await api(`/api/lincros?view=active&sync=1${refreshGps?'&force=1':''}`,{fresh:true,connectionImpact:false,navigationScoped:false,timeoutMs:12000});}catch(error){console.warn('Lincros cache indisponível',error?.message||error);}
    const lincrosRuntimeReady=lincrosPayload.runtimeConfigured===true;
    const lincrosBySchedule=new Map((lincrosRuntimeReady?(lincrosPayload.records||[]):[]).map((item)=>[String(item.scheduleId||''),item]));
    records=records.map((row)=>{const sid=String(row.schedule_record_id||row.schedule_id||row.escala_id||'');const li=lincrosBySchedule.get(sid)||row.lincros||null;if(!li)return row;if(li.syncHealthy!==true)return {...row,lincros:li};return {...row,lincros:li,entregas_previstas:li.deliveriesPlanned||row.entregas_previstas||0,entregas_realizadas:li.deliveriesDone??row.entregas_realizadas??0,entregas_pendentes:Math.max(0,(li.deliveriesPlanned||row.entregas_previstas||0)-(li.deliveriesDone||0))};});
    let gpsMessage='Protect Sat em standby.';
    const plates=[...new Set(records.map((x)=>x.placa).filter(Boolean))];
    if(plates.length){
      try{
        // Usa a mesma fonte da tela Última Localização. Buscar a frota completa evita
        // perda de posição quando houver diferença de cadastro/normalização da placa
        // no filtro enviado ao endpoint.
        const gps=await api(`/api/protectsat?scope=route&view=latest${refreshGps?'&refresh=1&force=1':''}`,{fresh:refreshGps,connectionImpact:false});
        gpsMessage=gps.aviso||gps.message||`GPS atualizado: ${gps.total||0} veículo(s).`;
        if((Array.isArray(gps.autoDepartures)&&gps.autoDepartures.length)||(Array.isArray(gps.autoReturns)&&gps.autoReturns.length)){
          const refreshed=await api('/api/monitoring?operational=1&recentDays=3&lite=1&activeOnly=1',{fresh:true,timeoutMs:30000,maxAttempts:1});
          records=onlyActive(refreshed.records||[]);
        }
        const protectSource=(gps.degraded||/D1_CACHE|UNAVAILABLE/i.test(String(gps.mode||'')))?'PROTECTSAT_CACHE':'PROTECTSAT';
        const idx=new Map((gps.positions||[]).map((x)=>[normalize(x.plate),{...x,source:protectSource,speedReliable:true,ignitionReliable:true}]));
        records=records.map((x)=>{
          const p=idx.get(normalize(x.placa));
          if(!p)return x;
          const gpsLocation=p.point||p.location||x.localizacao||'';
          const merged={...x,localizacao:gpsLocation,gps_atualizado_em:p.updatedAt||gps.fetchedAt,gps_position:p,gps_speed:p.speed,gps_ignition:p.ignition,gps_stopped_minutes:p.stoppedMinutes,gps_age_minutes:p.gpsAgeMinutes,gps_source:p.source};
          return {...merged,gps_alert:routeFleetAlert({pos:p,monitoring:merged,status:merged.status||merged.status_monitoramento})};
        });
      }catch(e){gpsMessage=`GPS indisponível: ${e.message}`;}
    }
    records=records.map((row)=>{const li=row.lincros||lincrosBySchedule.get(String(row.schedule_record_id||row.schedule_id||row.escala_id||''));const backup=lincrosPosition(li||{}),best=bestRoutePosition(row.gps_position||null,backup);if(!best)return row;const merged={...row,gps_position:best,gps_atualizado_em:best.updatedAt||row.gps_atualizado_em,localizacao:best.source==='LINCROS'?(best.point||best.location||'Posição Lincros'):(row.localizacao||best.point||best.location||''),gps_source:best.source||'PROTECTSAT'};return {...merged,gps_alert:routeFleetAlert({pos:best,monitoring:merged,status:merged.status||merged.status_monitoramento})};});
    // A proximidade agora é calculada somente contra os clientes desta viagem
    // que vieram da Lincros. Além de cumprir a regra operacional, isso elimina a
    // busca espacial pesada da carga inicial do Monitoramento.
    records=records.map(attachMonitoringTripNearbyClients);
    records=records.map((row)=>({...row,operational_occurrences:monitoringOccurrenceListFor(row,pendingOccurrences)}));
    const statuses=[
      {value:'EM ROTA',label:'Em rota'},
      {value:'NO DESTINO',label:'No destino'},
      {value:'DESCARREGADO',label:'Descarregado'},
      {value:'EM RETORNO',label:'Em retorno'},
      {value:'RETORNO PREVISTO',label:'Retorno previsto'},
      {value:'PERNOITE',label:'Pernoite'},
    ];
    const regions=[...new Set(records.map((x)=>String(x.regiao||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));

    $('#page-content').innerHTML=`<div class="monitoring-view"><div class="page-intro"><div><span class="eyebrow">Monitoramento · Versão 1 - DMS ROTA</span><h3>Monitoramento</h3><p>Somente veículos que já saíram e ainda não retornaram à empresa. A etapa atual é exibida dentro de cada card.</p><div class="helper-text">${esc(gpsMessage)} · Geocodificação de fallback: © OpenStreetMap contributors.</div></div><div class="page-intro-actions monitoring-actions"><button class="btn btn-ghost" id="route-monitor-filter-toggle"><i data-lucide="sliders-horizontal" aria-hidden="true"></i><span>Filtrar</span></button><button class="btn btn-secondary" id="route-monitor-notifications"><i data-lucide="bell-ring" aria-hidden="true"></i><span>${window.operationalNotificationsEnabled?.()?'Alertas ativos':'Ativar alertas'}</span></button><button class="btn btn-ghost" id="route-monitor-notification-test" title="Envia uma notificação de teste para este computador"><i data-lucide="bell" aria-hidden="true"></i><span>Testar alerta</span></button><button class="btn btn-ghost" id="route-monitor-export"><i data-lucide="download" aria-hidden="true"></i><span>CSV</span></button><button class="btn btn-ghost" id="route-monitor-overnight-pdf"><i data-lucide="file-text" aria-hidden="true"></i><span>PDF pendências</span></button><button class="btn btn-ghost" id="route-monitor-refresh"><i data-lucide="refresh-cw" aria-hidden="true"></i><span>Atualizar</span></button><button class="btn btn-ghost" id="route-monitor-diagnostic"><i data-lucide="stethoscope" aria-hidden="true"></i><span>Diagnóstico APIs</span></button><button class="btn btn-ghost" id="route-monitor-print"><i data-lucide="printer" aria-hidden="true"></i><span>Imprimir</span></button></div></div>
      <div class="monitoring-filter-panel is-hidden" id="route-monitor-filter-panel"><label class="field monitoring-filter-search"><span>Buscar</span><input id="route-monitor-filter-search" class="filter-control" placeholder="Rota, placa, motorista ou localização"></label><label class="field"><span>Etapa</span><select id="route-monitor-filter-status" class="filter-control"><option value="">Todas as etapas</option>${statuses.map((s)=>`<option value="${esc(s.value)}">${esc(s.label)}</option>`).join('')}</select></label><div class="field monitoring-region-field"><span>Região</span><div class="monitoring-region-multiselect" id="route-monitor-filter-region"><button class="filter-control monitoring-region-toggle" id="route-monitor-filter-region-toggle" type="button" aria-haspopup="true" aria-expanded="false"><span id="route-monitor-filter-region-label">Todas as regiões</span><i data-lucide="chevron-down" aria-hidden="true"></i></button><div class="monitoring-region-options is-hidden" id="route-monitor-filter-region-options"><div class="monitoring-region-options-head"><span>Selecione uma ou mais regiões</span><button type="button" class="monitoring-region-clear" id="route-monitor-filter-region-clear">Todas</button></div>${regions.map((r)=>`<label class="monitoring-region-option"><input type="checkbox" data-route-monitor-region value="${esc(r)}"><span>${esc(r)}</span></label>`).join('')}</div></div></div><label class="field"><span>Categoria</span><select id="route-monitor-filter-category" class="filter-control"><option value="">Todas as categorias</option><option value="VAREJO">Varejo</option><option value="REDE">Rede</option></select></label><div class="monitoring-filter-actions"><button class="btn btn-secondary" id="route-monitor-filter-clear" type="button"><i data-lucide="rotate-ccw" aria-hidden="true"></i><span>Limpar</span></button></div></div>
      <div class="cards-grid monitoring-metrics" id="route-monitor-metrics"></div><div class="monitoring-route-grid" id="route-monitor-grid"></div></div>`;

    let visibleRecords=[...records];
    const bindCardActions=()=>{
      $$('[data-route-monitor-details]').forEach((b)=>b.onclick=()=>openMonitoringDetails(records.find((x)=>String(x.id)===String(b.dataset.routeMonitorDetails))));
      $$('[data-route-monitor-edit]').forEach((b)=>b.onclick=()=>openMonitoring(records.find((x)=>String(x.id)===String(b.dataset.routeMonitorEdit))));
      $$('[data-route-monitor-overnight]').forEach((b)=>b.onclick=()=>openOvernight(records.find((x)=>String(x.id)===String(b.dataset.routeMonitorOvernight))));
      $$('[data-route-monitor-justify]').forEach((b)=>b.onclick=()=>openMonitoringOccurrenceJustification(records.find((x)=>String(x.id)===String(b.dataset.routeMonitorJustify))||{}));
    };
    const card=(r)=>{
      const nearest=routeNearbyClients(r.gps_position||{})[0]||null;
      const nearestText=nearest?`${routeClientLabel(nearest)}${Number(nearest.distanceMeters??nearest.distance)>0?` · ${formatNumber(Number(nearest.distanceMeters??nearest.distance),0)} m`:''}`:'Nenhum cliente desta viagem em até 100 m';
      const stopped=Math.max(0,Number(r.gps_position?.stoppedMinutes??r.gps_stopped_minutes??0)),stopThreshold=routeIsNetworks({monitoring:r})?60:20;
      const retentionText=stopped>=10?`${formatNumber(stopped,0)} min${stopped>=stopThreshold?' · ocorrência':''}`:'Sem retenção ≥ 10 min';
      const occurrences=Array.isArray(r.operational_occurrences)?r.operational_occurrences:[];
      const occurrenceRow=occurrences.length?`<dt>Ocorrência</dt><dd><span class="badge badge-warning">${formatNumber(occurrences.length)} pendente${occurrences.length===1?'':'s'}</span></dd>`:'';
      const justifyButton=canWrite()&&occurrences.length?`<button class="btn btn-warning btn-sm" data-route-monitor-justify="${esc(r.id)}"><i data-lucide="message-square-warning" aria-hidden="true"></i><span>Justificar${occurrences.length>1?` (${formatNumber(occurrences.length)})`:''}</span></button>`:'';
      return `<article class="route-card monitoring-route-card ${r.gps_alert?`has-gps-alert is-${r.gps_alert.level}`:''}"><div class="monitoring-route-card-head"><div><h4>${esc(r.rota||'Rota')}</h4><span>${esc(r.placa||'—')}</span></div></div><dl><dt>Motorista</dt><dd>${esc(r.motorista||'—')}</dd><dt>Etapa</dt><dd data-route-monitor-status="${esc(r.id)}">${badge(r.status||r.status_monitoramento||'EM ROTA')}</dd><dt>Entregas</dt><dd><strong data-route-monitor-deliveries="${esc(r.id)}">${formatNumber(r.entregas_realizadas||0)} / ${formatNumber(r.entregas_previstas||0)}</strong><small class="muted" data-route-monitor-delivery-source="${esc(r.id)}">${r.lincros?.syncHealthy?` Lincros${monitoringLincrosTime(r.lincros)?` · ${monitoringLincrosTime(r.lincros)}`:''}`:''}</small></dd><dt>Localização</dt><dd data-route-monitor-location="${esc(r.id)}">${esc(r.localizacao||r.gps_position?.point||r.gps_position?.location||'—')}</dd><dt>Cliente próximo</dt><dd>${esc(nearestText)}</dd><dt>Tempo de retenção</dt><dd><strong>${esc(retentionText)}</strong></dd>${occurrenceRow}</dl><div class="card-actions"><button class="btn btn-ghost btn-sm" data-route-monitor-details="${esc(r.id)}"><i data-lucide="panel-top-open" aria-hidden="true"></i><span>Detalhes</span></button>${justifyButton}${canWrite()?`<button class="btn btn-ghost btn-sm" data-route-monitor-edit="${esc(r.id)}"><i data-lucide="pencil" aria-hidden="true"></i><span>Atualizar</span></button>${normalize(r.status||r.status_monitoramento)!=='PERNOITE'?`<button class="btn btn-secondary btn-sm" data-route-monitor-overnight="${esc(r.id)}"><i data-lucide="moon" aria-hidden="true"></i><span>Pernoite</span></button>`:''}`:''}</div></article>`;
    };
    const selectedMonitorRegions=()=>$$('[data-route-monitor-region]:checked').map((input)=>normalize(input.value)).filter(Boolean);
    const updateMonitorRegionLabel=()=>{
      const selected=$$('[data-route-monitor-region]:checked').map((input)=>String(input.value||'').trim()).filter(Boolean);
      const label=$('#route-monitor-filter-region-label');
      if(label)label.textContent=!selected.length?'Todas as regiões':selected.length<=2?selected.join(' + '):`${selected.length} regiões selecionadas`;
      const toggle=$('#route-monitor-filter-region-toggle');
      if(toggle)toggle.classList.toggle('has-selection',selected.length>0);
    };
    const draw=()=>{
      const q=normalize($('#route-monitor-filter-search').value);
      const statusFilter=normalize($('#route-monitor-filter-status').value);
      const regionFilters=new Set(selectedMonitorRegions());
      const categoryFilter=normalize($('#route-monitor-filter-category').value);
      visibleRecords=records.filter((x)=>{
        const status=normalize(x.status||x.status_monitoramento);
        if(statusFilter&&status!==statusFilter)return false;
        if(regionFilters.size&&!regionFilters.has(normalize(x.regiao)))return false;
        if(categoryFilter&&monitoringCategory(x)!==categoryFilter)return false;
        const nearbyText=routeNearbyClientText(x.gps_position||{});
        const hay=normalize(`${x.rota||''} ${x.placa||''} ${x.motorista||''} ${x.localizacao||''} ${x.regiao||''} ${monitoringCategory(x)} ${status} ${nearbyText}`);
        return !q||hay.includes(q);
      });
      const gpsAlerts=visibleRecords.filter((x)=>x.gps_alert).length;
      $('#route-monitor-metrics').innerHTML=`${monitoringMetric('Veículos em rota',visibleRecords.length,'Ainda não retornaram à empresa','info','truck')}${monitoringMetric('Alertas GPS',gpsAlerts,'Paradas acima do limiar da rota, ignição noturna dos 3/4 ou sem posição',gpsAlerts?'warning':'success','triangle-alert')}${monitoringMetric('Pernoite',visibleRecords.filter((x)=>normalize(x.status||x.status_monitoramento)==='PERNOITE').length,'Operação entre dias','warning','moon')}${monitoringMetric('Em retorno',visibleRecords.filter((x)=>['EM RETORNO','RETORNO PREVISTO'].includes(normalize(x.status||x.status_monitoramento))).length,'Retorno em andamento ou previsto','info','route')}${monitoringMetric('Entregas pendentes',visibleRecords.reduce((s,x)=>s+Number(x.entregas_pendentes||0),0),'Saldo das rotas abertas','warning','package')}`;
      $('#route-monitor-grid').innerHTML=visibleRecords.length?visibleRecords.map(card).join(''):monitoringEmpty('Nenhum veículo em rota corresponde aos filtros.');
      refreshIcons();
      bindCardActions();
      void hydrateLincrosLocationNames(visibleRecords);
    };
    draw();
    $('#route-monitor-filter-toggle').onclick=()=>{$('#route-monitor-filter-panel').classList.toggle('is-hidden');$('#route-monitor-filter-toggle').classList.toggle('is-active',!$('#route-monitor-filter-panel').classList.contains('is-hidden'));};
    $('#route-monitor-notifications').onclick=async()=>{const ok=await window.enableOperationalNotifications?.();if(ok){const label=$('#route-monitor-notifications span');if(label)label.textContent='Alertas ativos';}};
    $('#route-monitor-notification-test').onclick=()=>window.testOperationalNotifications?.();
    $('#route-monitor-filter-search').oninput=draw;
    $('#route-monitor-filter-status').onchange=draw;
    $('#route-monitor-filter-region-toggle').onclick=()=>{const options=$('#route-monitor-filter-region-options'),toggle=$('#route-monitor-filter-region-toggle');const open=options.classList.toggle('is-hidden')===false;toggle.setAttribute('aria-expanded',open?'true':'false');};
    $$('[data-route-monitor-region]').forEach((input)=>input.onchange=()=>{updateMonitorRegionLabel();draw();});
    $('#route-monitor-filter-region-clear').onclick=()=>{$$('[data-route-monitor-region]').forEach((input)=>{input.checked=false;});updateMonitorRegionLabel();draw();};
    $('#route-monitor-filter-category').onchange=draw;
    $('#route-monitor-filter-clear').onclick=()=>{$('#route-monitor-filter-search').value='';$('#route-monitor-filter-status').value='';$$('[data-route-monitor-region]').forEach((input)=>{input.checked=false;});$('#route-monitor-filter-category').value='';updateMonitorRegionLabel();draw();};
    $('#route-monitor-export').onclick=()=>exportCsv(visibleRecords.map((r)=>({data:r.data,rota:r.rota,regiao:r.regiao,categoria:monitoringCategory(r),placa:r.placa,motorista:r.motorista,etapa:r.status||r.status_monitoramento,entregas_previstas:r.entregas_previstas,entregas_realizadas:r.entregas_realizadas,entregas_pendentes:r.entregas_pendentes,saida_real:r.saida_real,previsao_retorno:r.previsao_retorno,limite_jornada:r.hora_limite_jornada||r.limite_jornada,localizacao:r.localizacao,pernoites:r.pernoites,observacoes:r.observacoes})),`monitoramento_${today()}.csv`);
    $('#route-monitor-overnight-pdf').onclick=()=>generateOvernightPendingClientsPdf(visibleRecords,{query:$('#route-monitor-filter-search')?.value||'',status:$('#route-monitor-filter-status')?.value||'',region:$$('[data-route-monitor-region]:checked').map((input)=>input.value).join(', ')||'',category:$('#route-monitor-filter-category')?.value||''});
    $('#route-monitor-refresh').onclick=()=>renderMonitoring({fresh:true,refreshGps:true});
    $('#route-monitor-diagnostic').onclick=()=>openIntegrationDiagnostics(records);
    $('#route-monitor-print').onclick=()=>window.print();
    state.routeGpsTimer=setInterval(()=>{if(state.currentBase==='route'&&state.route==='route_monitoring')renderMonitoring({fresh:true}).catch((error)=>console.error(error));},5*60*1000);
    refreshIcons();
  }

  function clientMapsUrl(client={}){
    const lat=Number(client.latitude),lng=Number(client.longitude);
    const address=[client.address,client.neighborhood,client.city,client.state].filter(Boolean).join(' · ');
    const query=Number.isFinite(lat)&&Number.isFinite(lng)?`${lat},${lng}`:[address,routeClientLabel(client)].filter(Boolean).join(' ');
    return query?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`:'';
  }
  async function shareMonitoringClient(client={}){
    const label=routeClientLabel(client);
    const address=[client.address,client.neighborhood,client.city,client.state].filter(Boolean).join(' · ');
    const maps=clientMapsUrl(client);
    const text=[label,address,maps].filter(Boolean).join('\n');
    if(navigator.share){try{await navigator.share({title:`Localização · ${label}`,text,url:maps||undefined});return;}catch(error){if(error?.name==='AbortError')return;}}
    try{await navigator.clipboard.writeText(text);toast('Localização do cliente copiada para compartilhar.','success');}
    catch{window.prompt('Copie a localização do cliente:',text);}
  }
  function openMonitoringDetails(r){
    if(!r)return;
    const pos=r.gps_position||{}; const clients=routeNearbyClients(pos);
    const calcDetail=r.tempo_total_previsto_min!==undefined?`<div class="info-box"><strong>Previsão calculada:</strong> ${dt(r.previsao_retorno)} · deslocamento ${formatMinutes(r.tempo_deslocamento_previsto_min||0)} + entregas ${formatMinutes(r.tempo_entregas_previsto_min||0)} (${formatNumber(r.tempo_por_entrega_previsto_min||0)} min/entrega · ${esc(r.perfil_rota_calculado||'')}). Base: ${esc(r.previsao_retorno_base||'')}. </div>`:'';
    const nearbyHtml=clients.length?`<div class="fleet-detail-section fleet-detail-nearby"><span>${clients.length>1?'Clientes em até 100 m':'Cliente em até 100 m'}</span><div class="monitoring-share-client-list">${clients.map((client,i)=>`<div class="monitoring-share-client"><div>${routeNearbyClientListHtml({nearbyClients:[client]},{compact:true})}<small>${esc([client.address,client.city,client.state].filter(Boolean).join(' · ')||'Endereço não informado')}</small></div><button class="btn btn-secondary btn-sm" data-share-monitor-client="${i}" type="button"><i data-lucide="share-2" aria-hidden="true"></i><span>Compartilhar localização</span></button></div>`).join('')}</div></div>`:'<div class="info-box">Nenhum cliente desta viagem foi localizado no raio de 100 metros da posição atual do veículo.</div>';
    const body=`${calcDetail}<div class="fleet-detail-grid"><div class="fleet-detail-stat"><span>Rota</span><strong>${esc(r.rota||'—')}</strong></div><div class="fleet-detail-stat"><span>OC(s)</span><strong data-monitor-detail-ocs>${esc(monitoringOcsText(r)||'—')}</strong></div><div class="fleet-detail-stat"><span>Placa</span><strong>${esc(r.placa||'—')}</strong></div><div class="fleet-detail-stat"><span>Motorista</span><strong>${esc(r.motorista||'—')}</strong></div><div class="fleet-detail-stat"><span>Etapa</span><strong data-monitor-detail-status>${esc(r.status||r.status_monitoramento||'EM ROTA')}</strong></div><div class="fleet-detail-stat"><span>Entregas</span><strong data-monitor-detail-deliveries>${formatNumber(r.entregas_realizadas||0)} / ${formatNumber(r.entregas_previstas||0)}</strong></div><div class="fleet-detail-stat"><span>Pendentes</span><strong data-monitor-detail-pending>${formatNumber(r.entregas_pendentes||0)}</strong></div><div class="fleet-detail-stat"><span>Saída real</span><strong>${dt(r.saida_real)}</strong></div><div class="fleet-detail-stat"><span>Previsão retorno</span><strong>${dt(r.previsao_retorno)}</strong></div><div class="fleet-detail-stat"><span>Limite jornada</span><strong>${dt(r.hora_limite_jornada||r.limite_jornada)}</strong></div><div class="fleet-detail-stat"><span>Localização</span><strong>${esc(r.localizacao||pos.point||pos.location||'—')}</strong></div><div class="fleet-detail-stat"><span>GPS</span><strong>${esc(pos.updatedAt||r.gps_atualizado_em||'—')}</strong><small class="muted">${esc((pos.source||r.gps_source)==='PROTECTSAT_CACHE'?'ProtectSat · última posição salva':pos.source||r.gps_source||'ProtectSat')}</small></div><div class="fleet-detail-stat"><span>Velocidade</span><strong>${pos&&Object.keys(pos).length&&pos.speedReliable!==false?`${formatNumber(pos.speed||0)} km/h`:'—'}</strong></div><div class="fleet-detail-stat"><span>Ignição</span><strong>${pos&&Object.keys(pos).length&&pos.ignitionReliable!==false?(Number(pos.ignition)===1?'Ligada':'Desligada'):'—'}</strong></div><div class="fleet-detail-stat"><span>Tempo de retenção atual</span><strong>${pos&&Object.keys(pos).length&&Number(pos.stoppedMinutes||0)>=10?`${formatNumber(pos.stoppedMinutes||0)} min`:'Sem retenção ≥ 10 min'}</strong></div></div>${r.gps_alert?`<div class="info-box"><strong>Alerta GPS:</strong> ${esc(r.gps_alert.label)} · ${esc(r.gps_alert.detail)}</div>`:''}${nearbyHtml}<div class="fleet-detail-section"><span>Dados da Lincros</span><div id="monitor-detail-lincros">${lincrosDetailsHtml(r.lincros||null,r)}</div></div><div class="fleet-detail-section"><span>Histórico da viagem</span><div id="monitor-detail-timeline"><div class="helper-text">Carregando histórico somente agora, ao abrir os detalhes...</div></div></div><div class="fleet-detail-section"><span>Registros de localização</span><div id="monitor-detail-gps"><div class="helper-text">Carregando posições registradas por ProtectSat e Lincros durante a viagem...</div></div></div>`;
    modal({title:`Detalhes · ${r.rota||r.placa||'Monitoramento'}`,confirmText:'Fechar',wide:true,body,onOpen:(root)=>{
      $$('[data-share-monitor-client]',root).forEach((button)=>button.onclick=()=>shareMonitoringClient(clients[Number(button.dataset.shareMonitorClient)]));refreshIcons();
      const scheduleId=String(r.schedule_record_id||r.schedule_id||r.escala_id||'').trim(),host=$('#monitor-detail-timeline',root),gpsHost=$('#monitor-detail-gps',root),lincrosHost=$('#monitor-detail-lincros',root);
      const loadTimelineAndGps=()=>{
        if(!scheduleId){if(host)host.innerHTML='<div class="muted">Histórico indisponível: escala não identificada.</div>';if(gpsHost)gpsHost.innerHTML='<div class="muted">Registros de localização indisponíveis: escala não identificada.</div>';return Promise.resolve();}
        const params=new URLSearchParams({scheduleIds:scheduleId});
        const plate=String(r.placa||'').trim(),startAt=dateTimeLocalValue(r.saida_real||r.actual_at||`${r.data||today()}T00:00`),endAt=dateTimeLocalValue(new Date());
        if(plate&&startAt&&endAt){params.set('includeGps','1');params.set('plate',plate);params.set('startAt',startAt);params.set('endAt',endAt);params.set('gpsLimit','1000');}
        return api(`/api/trip-timeline?${params.toString()}`,{connectionImpact:false,navigationScoped:false,fresh:true}).then((timeline)=>{if(host?.isConnected)host.innerHTML=tripTimelineHtml(timeline.timelines?.[scheduleId]||[]);if(gpsHost?.isConnected)gpsHost.innerHTML=plate&&startAt?returnGpsRecordsHtml(timeline.gpsRecords||[],Boolean(timeline.gpsTruncated)):'<div class="muted">Não foi possível definir o intervalo/placa desta viagem para consultar as posições.</div>';}).catch((error)=>{if(host?.isConnected)host.innerHTML=`<div class="muted">Não foi possível carregar o histórico: ${esc(error.message||String(error))}</div>`;if(gpsHost?.isConnected)gpsHost.innerHTML=`<div class="muted">Não foi possível carregar os registros de localização: ${esc(error.message||String(error))}</div>`;});
      };
      loadTimelineAndGps();
      if(scheduleId){api(`/api/lincros?scheduleId=${encodeURIComponent(scheduleId)}&sync=1&force=1`,{fresh:true,connectionImpact:false,navigationScoped:false,timeoutMs:65000}).then((payload)=>{const ocHost=$('[data-monitor-detail-ocs]',root),scheduleOcs=monitoringOcsText(payload.schedule||{});if(ocHost?.isConnected&&scheduleOcs)ocHost.textContent=scheduleOcs;const item=payload.cached||null;if(payload.syncResult?.ok===false){if(lincrosHost?.isConnected){const detail={...(item||{}),lastError:payload.syncResult.reason||item?.lastError||'Sincronização Lincros não encontrou vínculo.',checkedAt:item?.checkedAt||new Date().toISOString()};lincrosHost.innerHTML=lincrosDetailsHtml(detail,r);}return loadTimelineAndGps();}const resolved=item||payload.syncResult||null;if(lincrosHost?.isConnected)lincrosHost.innerHTML=lincrosDetailsHtml(resolved,r);applyLincrosMonitoringResult(r,resolved);return loadTimelineAndGps();}).catch((error)=>{if(lincrosHost?.isConnected)lincrosHost.innerHTML=`<div class="muted">Não foi possível sincronizar a Lincros agora: ${esc(error.message||String(error))}</div>${lincrosDetailsHtml(r.lincros||null,r)}`;});}
    },onConfirm:async()=>{}});
  }
  function openMonitoring(r){modal({title:`Monitoramento · ${r.rota||r.placa}`,body:`<div class="form-grid"><label class="field"><span>Status</span><select id="route-mon-status">${['EM ROTA','RETORNO PREVISTO','PERNOITE'].map((x)=>option(x,x,r.status)).join('')}</select></label><label class="field"><span>Entregas realizadas</span><input id="route-mon-del" type="number" min="0" value="${esc(r.entregas_realizadas||0)}"></label><label class="field"><span>Previsão de retorno</span><input id="route-mon-ret" type="datetime-local" readonly value="${esc(String(r.previsao_retorno||'').replace(' ','T').slice(0,16))}"><small>Calculada automaticamente pelo tempo de deslocamento + quantidade/perfil de entregas.</small></label><label class="field"><span>Localização</span><input id="route-mon-loc" value="${esc(r.localizacao||'')}"></label><label class="field span-2"><span>Justificativa do pernoite</span><textarea id="route-mon-overnight">${esc(r.justificativa_pernoite||'')}</textarea></label><label class="field span-2"><span>Observações</span><textarea id="route-mon-obs">${esc(r.observacoes||'')}</textarea></label></div>`,onConfirm:async(root)=>{await api('/api/monitoring',{method:'PUT',body:JSON.stringify({id:r.id,requestId:crypto.randomUUID(),data:{...r,status:$('#route-mon-status',root).value,entregas_realizadas:Number($('#route-mon-del',root).value),previsao_retorno:$('#route-mon-ret',root).value,localizacao:$('#route-mon-loc',root).value,justificativa_pernoite:$('#route-mon-overnight',root).value,observacoes:$('#route-mon-obs',root).value,version:r.version}})});toast('Monitoramento atualizado.');await renderMonitoring();}});}
  function openOvernight(r){modal({title:`Registrar pernoite · ${r.rota||r.placa}`,body:'<label class="field"><span>Justificativa obrigatória</span><textarea id="route-overnight-reason"></textarea><small>A confirmação usa sempre a versão mais recente do monitoramento, mesmo que GPS ou Lincros atualizem a viagem enquanto esta janela estiver aberta.</small></label>',confirmText:'Confirmar pernoite',onConfirm:async(root)=>{const justificativa=$('#route-overnight-reason',root).value.trim();if(!justificativa)throw new Error('Informe a justificativa do pernoite.');await api('/api/monitoring',{method:'POST',body:JSON.stringify({action:'overnight',id:r.id,requestId:crypto.randomUUID(),data:{justificativa_pernoite:justificativa}})});toast('Pernoite registrado.');await renderMonitoring();}});}

  function occurrenceGroupRows(rows,keyFn){
    const map=new Map();
    (rows||[]).forEach((row)=>{const label=String(keyFn(row)||'NÃO INFORMADO').trim()||'NÃO INFORMADO';if(!map.has(label))map.set(label,[]);map.get(label).push(row);});
    return [...map.entries()].map(([label,items])=>{const retentionMinutes=items.reduce((sum,row)=>sum+Math.max(0,Number(row.retentionMinutes||0)),0);return{label,occurrences:items.length,retentionMinutes,averageRetentionMinutes:items.length?Math.round(retentionMinutes/items.length):0,pendingJustification:items.filter((row)=>row.hasOccurrence!==false&&!row.justification).length};}).sort((a,b)=>b.retentionMinutes-a.retentionMinutes||b.occurrences-a.occurrences||a.label.localeCompare(b.label,'pt-BR'));
  }
  function occurrenceRetentionTable(rows,labelTitle='Grupo',{limit=20}={}){
    const visible=(rows||[]).slice(0,limit||rows.length);
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>${esc(labelTitle)}</th><th>Retenções</th><th>Tempo de retenção</th><th>Tempo médio</th><th>Pend. justificativa</th></tr></thead><tbody>${visible.map((x)=>`<tr><td><strong>${esc(x.label||'—')}</strong></td><td>${formatNumber(x.occurrences||0)}</td><td>${formatMinutes(x.retentionMinutes||0)}</td><td>${formatMinutes(x.averageRetentionMinutes||0)}</td><td>${formatNumber(x.pendingJustification||0)}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Sem ocorrências no período selecionado.</td></tr>'}</tbody></table></div>`;
  }
  function occurrencePeriodGroup(rows=[],mode='day'){
    const map=new Map();
    for(const row of rows||[]){
      const key=mode==='week'?(row.week||''):mode==='month'?(row.month||''):(row.date||'');
      if(!key)continue;if(!map.has(key))map.set(key,[]);map.get(key).push(row);
    }
    return [...map.entries()].map(([key,items])=>{const times=items.map((x)=>Number(x.responseMinutes)).filter(Number.isFinite);const label=mode==='week'?(items[0]?.weekLabel||key):mode==='month'?(items[0]?.monthLabel||key):formatDate(key);return {key,label,occurrences:items.length,justified:items.filter((x)=>Boolean(x.justification)).length,pending:items.filter((x)=>!x.justification).length,averageResponseMinutes:times.length?Math.round(times.reduce((a,b)=>a+b,0)/times.length):null};}).sort((a,b)=>String(b.key).localeCompare(String(a.key)));
  }
  function occurrencePeriodTable(rows=[],mode='day'){
    const grouped=occurrencePeriodGroup(rows,mode);
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Período</th><th>Ocorrências</th><th>Justificadas</th><th>Pendentes</th><th>Tempo médio até justificativa</th></tr></thead><tbody>${grouped.map((x)=>`<tr><td><strong>${esc(x.label)}</strong></td><td>${formatNumber(x.occurrences)}</td><td>${formatNumber(x.justified)}</td><td>${formatNumber(x.pending)}</td><td>${x.averageResponseMinutes===null?'—':formatMinutes(x.averageResponseMinutes)}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Sem ocorrências no período selecionado.</td></tr>'}</tbody></table></div>`;
  }
  function occurrenceMonitorTable(rows=[]){
    const map=new Map();for(const row of rows||[]){const key=row.monitorResponsible||'NÃO DEFINIDO';if(!map.has(key))map.set(key,[]);map.get(key).push(row);}
    const grouped=[...map.entries()].map(([label,items])=>{const times=items.map((x)=>Number(x.responseMinutes)).filter(Number.isFinite);return {label,occurrences:items.length,justified:items.filter((x)=>Boolean(x.justification)).length,pending:items.filter((x)=>!x.justification).length,averageResponseMinutes:times.length?Math.round(times.reduce((a,b)=>a+b,0)/times.length):null};}).sort((a,b)=>b.occurrences-a.occurrences);
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Monitor responsável</th><th>Ocorrências</th><th>Justificadas</th><th>Pendentes</th><th>Tempo médio até justificativa</th></tr></thead><tbody>${grouped.map((x)=>`<tr><td><strong>${esc(x.label)}</strong></td><td>${formatNumber(x.occurrences)}</td><td>${formatNumber(x.justified)}</td><td>${formatNumber(x.pending)}</td><td>${x.averageResponseMinutes===null?'—':formatMinutes(x.averageResponseMinutes)}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Sem ocorrências para os filtros selecionados.</td></tr>'}</tbody></table></div>`;
  }
  function occurrenceAuditTable(rows=[]){
    const visible=[...(rows||[])].sort((a,b)=>String(b.detectedAt||b.date||'').localeCompare(String(a.detectedAt||a.date||''))).slice(0,250);
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Ocorrência</th><th>Rota / veículo</th><th>Responsável</th><th>Situação</th><th>1ª justificativa</th><th>Tempo até registro</th><th>Registrado por</th><th>Justificativa</th></tr></thead><tbody>${visible.map((row)=>`<tr><td><strong>${esc(row.typeLabel||row.type||'—')}</strong><small class="muted">${esc(formatDate(row.date))} · ${esc(formatTime(row.detectedAt||row.startedAt||''))}</small></td><td><strong>${esc(row.route||'—')}</strong><small class="muted">${esc(row.plate||'—')} · ${esc(row.driver||'—')}</small></td><td>${esc(row.monitorResponsible||'—')}</td><td>${row.justification?'<span class="badge badge-success">JUSTIFICADA</span>':'<span class="badge badge-warning">PENDENTE</span>'}</td><td>${row.justifiedAt?`${esc(formatDate(row.justifiedAt))} ${esc(formatTime(row.justifiedAt))}`:'—'}</td><td><strong>${row.responseMinutes===null||row.responseMinutes===undefined?'—':esc(formatMinutes(row.responseMinutes))}</strong></td><td>${esc(row.justifiedBy||'—')}</td><td>${esc(row.justification||'—')}</td></tr>`).join('')||'<tr><td colspan="8" class="muted">Sem ocorrências para auditoria.</td></tr>'}</tbody></table></div>${(rows||[]).length>250?'<p class="helper-text">Exibindo as 250 ocorrências mais recentes. O CSV mantém o conjunto filtrado completo.</p>':''}`;
  }
  function occurrenceJustificationHistoryTable(rows=[]){
    const visible=(rows||[]).slice(0,200);if(!visible.length)return '<div class="muted">Ainda não há alterações de justificativa registradas nesta versão.</div>';
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Data/hora</th><th>Rota / placa</th><th>Responsável da área</th><th>Ação</th><th>Usuário</th><th>Justificativa registrada</th></tr></thead><tbody>${visible.map((row)=>`<tr><td>${esc(formatDate(row.recordedAt))} ${esc(formatTime(row.recordedAt))}</td><td><strong>${esc(row.route||'—')}</strong><small class="muted">${esc(row.plate||'—')}</small></td><td>${esc(row.monitorResponsible||'—')}</td><td>${esc(row.action||'REGISTRO')}</td><td>${esc(row.justifiedBy||'—')}</td><td>${esc(row.justification||'—')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function occurrenceIndicatorsShell(data={}){
    const types=[...new Set((data.records||[]).map((row)=>row.type).filter(Boolean))].sort();
    const typeLabel=(value)=>value==='PARADA_ACIMA_20_MIN'?'Paradas acima do limiar (20 min varejo / 1h Rede)':value==='IGNICAO_DESLIGADA_20_05'?'Ignição desligada 20h–05h · 3/4':value;
    return `<section class="panel" id="route-occurrence-indicators"><div class="panel-header"><div><h3>Ocorrências operacionais e retenções</h3><p class="helper-text">Ocorrências de parada são abertas a partir de <strong>20 minutos no varejo</strong> e <strong>1 hora nas rotas de Rede</strong>. O tempo de retenção continua considerando imobilizações GPS a partir de 10 minutos. O responsável padrão é Fernanda para AG1/AG2 varejo e João Victor para as demais áreas e todas as rotas de Rede; as notificações podem ser recebidas pelos dois.</p></div><div class="toolbar-group"><select id="route-occ-type" class="filter-control"><option value="">Todos os tipos de ocorrência</option>${types.map((value)=>`<option value="${esc(value)}">${esc(typeLabel(value))}</option>`).join('')}</select><select id="route-occ-status" class="filter-control"><option value="">Todas as situações</option><option value="PENDENTE">Pendente de justificativa</option><option value="JUSTIFICADA">Justificada</option></select><button class="btn btn-ghost" id="route-occ-export">CSV ocorrências</button></div></div><div class="panel-body"><div class="cards-grid" id="route-occ-metrics"></div><section class="panel"><div class="panel-header"><div><h3>Quantidade de ocorrências por período</h3><p class="helper-text">Visão diária, semanal e mensal, respeitando os filtros de tipo e situação acima.</p></div></div><div class="panel-body occurrence-period-grid"><div><h4>Diária</h4><div id="route-occ-by-day"></div></div><div><h4>Semanal</h4><div id="route-occ-by-week"></div></div><div><h4>Mensal</h4><div id="route-occ-by-occ-month"></div></div></div></section><div class="split-grid"><section class="panel"><div class="panel-header"><h3>Desempenho por monitor responsável</h3></div><div class="panel-body" id="route-occ-by-monitor"></div></section><section class="panel"><div class="panel-header"><h3>Tempo de retenção por rota</h3></div><div class="panel-body" id="route-occ-by-route"></div></section></div><div class="split-grid"><section class="panel"><div class="panel-header"><h3>Tempo de retenção por motorista</h3></div><div class="panel-body" id="route-occ-by-driver"></div></section><section class="panel"><div class="panel-header"><h3>Tempo de retenção por local</h3></div><div class="panel-body" id="route-occ-by-location"></div></section></div><div class="split-grid"><section class="panel"><div class="panel-header"><h3>Tempo de retenção por justificativa</h3></div><div class="panel-body" id="route-occ-by-justification"></div></section><section class="panel"><div class="panel-header"><h3>Tempo de retenção por mês</h3></div><div class="panel-body" id="route-occ-by-month"></div></section></div><section class="panel"><div class="panel-header"><div><h3>Histórico para auditoria</h3><p class="helper-text">O tempo de resposta vai da detecção da ocorrência até o primeiro registro da justificativa. Alterações posteriores não substituem esse primeiro horário.</p></div></div><div class="panel-body" id="route-occ-audit"></div></section><section class="panel"><div class="panel-header"><h3>Histórico de alterações das justificativas</h3></div><div class="panel-body" id="route-occ-just-history">${occurrenceJustificationHistoryTable(data.justificationHistory||[])}</div></section></div></section>`;
  }
  function bindOccurrenceIndicators(data={}){
    const occurrenceBase=data.records||[];
    const retentionBase=data.retentionRecords||occurrenceBase;
    const type=$('#route-occ-type'),status=$('#route-occ-status');
    let visibleOccurrences=occurrenceBase,visibleRetentions=retentionBase;
    const draw=()=>{
      visibleOccurrences=occurrenceBase.filter((row)=>{if(type?.value&&String(row.type)!==String(type.value))return false;if(status?.value==='PENDENTE'&&row.justification)return false;if(status?.value==='JUSTIFICADA'&&!row.justification)return false;return true;});
      visibleRetentions=retentionBase.filter((row)=>{
        if(type?.value==='PARADA_ACIMA_20_MIN'&&!row.hasOccurrence)return false;
        if(type?.value==='IGNICAO_DESLIGADA_20_05')return false;
        if(status?.value==='PENDENTE'&&(!row.hasOccurrence||row.justification))return false;
        if(status?.value==='JUSTIFICADA'&&(!row.hasOccurrence||!row.justification))return false;
        return true;
      });
      const retention=visibleRetentions.reduce((sum,row)=>sum+Math.max(0,Number(row.retentionMinutes||0)),0),avg=visibleRetentions.length?Math.round(retention/visibleRetentions.length):0,pending=visibleOccurrences.filter((row)=>!row.justification).length,stops=visibleOccurrences.filter((row)=>row.type==='PARADA_ACIMA_20_MIN').length,night=visibleOccurrences.filter((row)=>row.type==='IGNICAO_DESLIGADA_20_05').length,belowThreshold=visibleRetentions.filter((row)=>!row.hasOccurrence).length,responseTimes=visibleOccurrences.map((row)=>Number(row.responseMinutes)).filter(Number.isFinite),avgResponse=responseTimes.length?Math.round(responseTimes.reduce((a,b)=>a+b,0)/responseTimes.length):null;
      $('#route-occ-metrics').innerHTML=`${metric('Ocorrências',visibleOccurrences.length,'Abertas conforme limiar da rota','info')}${metric('Tempo médio até justificativa',avgResponse===null?'—':formatMinutes(avgResponse),`${responseTimes.length} ocorrência(s) com justificativa`,'success')}${metric('Pendentes de justificativa',pending,`${visibleOccurrences.length-pending} justificadas`,pending?'warning':'success')}${metric('Tempo total de retenção',formatMinutes(retention),'Retenções GPS a partir de 10 min','warning')}${metric('Tempo médio de retenção',formatMinutes(avg),'Por imobilização GPS','warning')}${metric('Paradas com ocorrência',stops,'Varejo ≥20 min · Rede ≥1h','warning')}${metric('Retenções sem ocorrência',belowThreshold,'Abaixo do limiar da rota','info')}${metric('Ignição 20h–05h · 3/4',night,'Somente veículos 3/4','danger')}`;
      const byRoute=occurrenceGroupRows(visibleRetentions,(row)=>row.route||'ROTA NÃO INFORMADA');
      const byDriver=occurrenceGroupRows(visibleRetentions,(row)=>row.driver||'MOTORISTA NÃO INFORMADO');
      const byLocation=occurrenceGroupRows(visibleRetentions,(row)=>row.location||'LOCAL NÃO INFORMADO');
      const byJust=occurrenceGroupRows(visibleRetentions,(row)=>row.justificationLabel||row.justification||'SEM OCORRÊNCIA');
      const byMonth=occurrenceGroupRows(visibleRetentions,(row)=>row.monthLabel||row.month||'MÊS NÃO INFORMADO').sort((a,b)=>{const toKey=(label)=>{const m=String(label).match(/^(\d{2})\/(\d{4})$/);return m?`${m[2]}-${m[1]}`:String(label)};return toKey(a.label).localeCompare(toKey(b.label));});
      $('#route-occ-by-day').innerHTML=occurrencePeriodTable(visibleOccurrences,'day');
      $('#route-occ-by-week').innerHTML=occurrencePeriodTable(visibleOccurrences,'week');
      $('#route-occ-by-occ-month').innerHTML=occurrencePeriodTable(visibleOccurrences,'month');
      $('#route-occ-by-monitor').innerHTML=occurrenceMonitorTable(visibleOccurrences);
      $('#route-occ-by-route').innerHTML=occurrenceRetentionTable(byRoute,'Rota');
      $('#route-occ-by-driver').innerHTML=occurrenceRetentionTable(byDriver,'Motorista');
      $('#route-occ-by-location').innerHTML=occurrenceRetentionTable(byLocation,'Local');
      $('#route-occ-by-justification').innerHTML=occurrenceRetentionTable(byJust,'Justificativa / classificação');
      $('#route-occ-by-month').innerHTML=occurrenceRetentionTable(byMonth,'Mês',{limit:0});
      $('#route-occ-audit').innerHTML=occurrenceAuditTable(visibleOccurrences);
    };
    if(type)type.onchange=draw;if(status)status.onchange=draw;
    $('#route-occ-export').onclick=()=>exportCsv(visibleOccurrences.map((row)=>({data:row.date,detectada_em:row.detectedAt||'',mes:row.monthLabel,semana:row.weekLabel,tipo:row.typeLabel,prioridade:row.priority,rota:row.route,perfil_rota:row.routeProfile||'',limiar_parada_min:row.stopThresholdMinutes??'',placa:row.plate,motorista:row.driver,monitor_responsavel:row.monitorResponsible||'',local:row.location,tempo_retencao_min:row.retentionMinutes,em_andamento:row.active?'SIM':'NÃO',justificativa:row.justification||'',situacao:row.justification?'JUSTIFICADA':'PENDENTE',justificado_por:row.justifiedBy||'',justificado_em:row.justifiedAt||'',tempo_ate_justificativa_min:row.responseMinutes??'',detalhes:row.details||''})),`ocorrencias_operacionais_${state.routeIndicatorStart||today()}_${state.routeIndicatorEnd||today()}.csv`);
    draw();
  }



  function routeIndicatorQuery(base,filters={}){
    const params=new URLSearchParams();
    Object.entries(filters||{}).forEach(([key,value])=>{if(String(value||'').trim())params.set(key,String(value).trim());});
    const query=params.toString();return `${base}${base.includes('?')?'&':'?'}${query}`.replace(/[?&]$/,'');
  }
  function indicatorFilterSelect(id,label,values=[],selected=''){
    return `<label class="toolbar-field"><span>${esc(label)}</span><select id="${esc(id)}" class="filter-control"><option value="">Todos</option>${(values||[]).map((value)=>option(value,value,selected)).join('')}</select></label>`;
  }
  function indicatorFilterPanel(prefix,filterOptions={},selected={},includeProfile=false,includeHelper=false,includeReason=false){
    const driverRelations=(filterOptions.driverRelations||['PRÓPRIO','TERCEIRO']).filter(Boolean);
    return `<section class="panel indicator-filter-panel"><div class="panel-header"><div><h3>Filtros</h3><p class="helper-text">Os cards, gráficos, tabelas e CSV respeitam os filtros aplicados. Alterar uma seleção aplica o filtro automaticamente.</p></div><div class="toolbar-group"><label class="toolbar-field"><span>Busca</span><input id="${prefix}-q" class="filter-control" value="${esc(selected.q||'')}" placeholder="OC, rota, placa, motorista, ajudante ou motivo"></label>${indicatorFilterSelect(`${prefix}-region`,'Região',filterOptions.regions||[],selected.region||'')}${indicatorFilterSelect(`${prefix}-route`,'Rota',filterOptions.routes||[],selected.route||'')}${indicatorFilterSelect(`${prefix}-driver`,'Motorista',filterOptions.drivers||[],selected.driver||'')}${includeHelper?indicatorFilterSelect(`${prefix}-helper`,'Ajudante',filterOptions.helpers||[],selected.helper||''):''}${includeReason?indicatorFilterSelect(`${prefix}-reason`,'Motivo',filterOptions.reasons||[],selected.reason||''):''}${indicatorFilterSelect(`${prefix}-driver-relation`,'Vínculo motorista',driverRelations,selected.driverRelation||'')}${includeProfile?indicatorFilterSelect(`${prefix}-profile`,'Perfil',filterOptions.profiles||[],selected.profile||''):''}${indicatorFilterSelect(`${prefix}-plate`,'Placa',filterOptions.plates||[],selected.plate||'')}<button class="btn btn-secondary" id="${prefix}-apply">Aplicar filtros</button><button class="btn btn-ghost" id="${prefix}-clear">Limpar</button></div></div></section>`;
  }
  function readIndicatorFilterPanel(prefix,includeProfile=false,includeHelper=false,includeReason=false){
    return {q:$(`#${prefix}-q`)?.value||'',region:$(`#${prefix}-region`)?.value||'',route:$(`#${prefix}-route`)?.value||'',driver:$(`#${prefix}-driver`)?.value||'',...(includeHelper?{helper:$(`#${prefix}-helper`)?.value||''}:{}),...(includeReason?{reason:$(`#${prefix}-reason`)?.value||''}:{}),driverRelation:$(`#${prefix}-driver-relation`)?.value||'',plate:$(`#${prefix}-plate`)?.value||'',...(includeProfile?{profile:$(`#${prefix}-profile`)?.value||''}:{})};
  }
  function bindIndicatorAutoApply(prefix,apply){
    [`${prefix}-region`,`${prefix}-route`,`${prefix}-driver`,`${prefix}-helper`,`${prefix}-reason`,`${prefix}-driver-relation`,`${prefix}-profile`,`${prefix}-plate`].forEach((id)=>{const node=$(`#${id}`);if(node)node.onchange=apply;});
  }


  function indicatorAnalysisTopic(scope,title='',panel=null){
    const text=normalize(title||'');
    const item=(key,label)=>({key,label});
    if(scope==='route-indicators'){
      if(panel?.closest?.('#route-occurrence-indicators')||/OCORRENCIA|RETENCAO|JUSTIFICATIVA/.test(text))return item('occurrences','Ocorrências e retenções');
      if(/DISPONIBILIDADE/.test(text))return item('availability','Disponibilidade da frota');
      if(/APONTAMENTO.*USUARIO|USUARIO.*APONTAMENTO|NAO APONTANDO|NÃO APONTANDO/.test(text))return item('pointing','Apontamento das entregas');
      if(/CUSTO|OCUPACAO|EXECUCAO DAS ENTREGAS|VIABILIDADE/.test(text))return item('costs','Custos, ocupação e entregas');
      if(/PERNOITE|DIAS EXCESSIVOS|DURACAO ACIMA/.test(text))return item('overnights','Pernoites e dias excessivos');
      if(/GPS|MOVIMENTO|IMOBILIZ|IGNICAO|PARADA/.test(text))return item('gps','GPS e movimento');
      if(/POR REGIAO|POR PERFIL|DESEMPENHO POR ROTA/.test(text))return item('routes','Desempenho por rota');
      return item('other','Outros indicadores');
    }
    if(scope==='departure-indicators'){
      if(/RANKING/.test(text))return item('ranking','Ranking de motoristas e ajudantes');
      if(/SEQUENCIA/.test(text))return item('sequence','Sequência de saída');
      if(/MOTIVO/.test(text))return item('reasons','Motivos de atraso');
      if(/REGIAO/.test(text))return item('region','Desempenho por região');
      if(/ATRASO|PONTUALIDADE/.test(text))return item('punctuality','Atraso e pontualidade');
      return item('other','Outros indicadores');
    }
    if(scope==='management-indicators'){
      if(/PERNOITE/.test(text))return item('overnights','Pernoites');
      if(/MOTORISTA|PRODUTIVIDADE/.test(text))return item('drivers','Produtividade por motorista');
      if(/REGIAO/.test(text))return item('region','Resultados por região');
      return item('other','Outros indicadores');
    }
    if(scope==='award-indicators'){
      if(/RANKING|INDIVIDUAL/.test(text))return item('individual','Indicadores individuais');
      if(/COLETIV/.test(text))return item('collective','Indicadores coletivos');
      return item('other','Outros indicadores');
    }
    return item('other','Outros indicadores');
  }
  function indicatorAnalysisExportRows(panel,title=''){
    const tables=[...panel.querySelectorAll('table.data-table')];
    const rows=[];
    tables.forEach((table,index)=>{
      const headers=[...(table.querySelector('thead tr')?.querySelectorAll('th')||[])].map((th,i)=>String(th.textContent||`Coluna ${i+1}`).replace(/↕/g,'').trim()||`Coluna ${i+1}`);
      [...table.querySelectorAll('tbody tr')].forEach((tr)=>{
        const cells=[...tr.querySelectorAll(':scope > td')];
        if(!cells.length)return;
        const row={};
        if(tables.length>1)row.secao=`${title||'Indicador'}${tables.length>1?` · tabela ${index+1}`:''}`;
        cells.forEach((td,i)=>{const select=td.querySelector('select');const value=select?String(select.options[select.selectedIndex]?.textContent||'').trim():String(td.innerText||td.textContent||'').replace(/\s+/g,' ').trim();row[headers[i]||`Coluna ${i+1}`]=value;});
        rows.push(row);
      });
    });
    return rows;
  }
  function enhanceIndicatorAnalysis(scope){
    const root=$('#page-content');if(!root)return;
    const storageKey=`natto_dms_indicator_ui_${scope}`;
    let stored={topic:'',collapsed:{}};try{stored={...stored,...JSON.parse(localStorage.getItem(storageKey)||'{}')};}catch{}
    const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify(stored));}catch{}};
    const allPanels=[...root.querySelectorAll('section.panel')].filter((panel)=>!panel.classList.contains('indicator-filter-panel')&&!panel.closest('.cards-grid'));
    const panels=[];
    allPanels.forEach((panel)=>{
      if(panel.parentElement?.closest('section.panel')&&panel.closest('section.panel')!==panel){
        const outer=panel.parentElement.closest('section.panel');
        if(outer?.id==='route-occurrence-indicators')return;
      }
      const header=[...panel.children].find((node)=>node.classList?.contains('panel-header'));
      const title=header?.querySelector('h3')?.textContent?.trim()||'';
      if(!header||!title)return;
      const topic=indicatorAnalysisTopic(scope,title,panel);
      panel.dataset.indicatorTopic=topic.key;panel.dataset.indicatorTopicLabel=topic.label;
      panels.push({panel,header,title,topic});
      let actions=header.querySelector(':scope > .indicator-analysis-actions');
      if(!actions){actions=document.createElement('div');actions.className='toolbar-group indicator-analysis-actions';header.appendChild(actions);}
      const hasTable=Boolean(panel.querySelector('table.data-table'));
      const existingExport=[...header.querySelectorAll('button')].some((button)=>/EXPORT|CSV/i.test(`${button.id||''} ${button.textContent||''}`));
      if(hasTable&&!existingExport){
        const exportButton=document.createElement('button');exportButton.type='button';exportButton.className='btn btn-ghost btn-sm';exportButton.textContent='Exportar dados';exportButton.dataset.indicatorTableExport='1';
        exportButton.onclick=()=>{const rows=indicatorAnalysisExportRows(panel,title);if(!rows.length){toast('Não há linhas para exportar neste indicador.','warning');return;}const slug=normalize(title).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'indicador';exportCsv(rows,`${slug}_${today()}.csv`);};actions.appendChild(exportButton);
      }
      const body=[...panel.children].find((node)=>node.classList?.contains('panel-body'));
      if(body){
        const collapseButton=document.createElement('button');collapseButton.type='button';collapseButton.className='btn btn-ghost btn-sm';collapseButton.dataset.indicatorCollapse='1';
        const key=normalize(title).replace(/[^A-Z0-9]+/g,'_');
        const applyCollapsed=(collapsed)=>{body.hidden=Boolean(collapsed);panel.classList.toggle('indicator-panel-collapsed',Boolean(collapsed));collapseButton.textContent=collapsed?'+ Expandir':'− Minimizar';collapseButton.setAttribute('aria-expanded',collapsed?'false':'true');};
        applyCollapsed(Boolean(stored.collapsed?.[key]));
        collapseButton.onclick=()=>{stored.collapsed=stored.collapsed||{};stored.collapsed[key]=!body.hidden;applyCollapsed(stored.collapsed[key]);save();};actions.appendChild(collapseButton);
      }
    });
    const unique=[];const seen=new Set();panels.forEach(({topic})=>{if(!seen.has(topic.key)){seen.add(topic.key);unique.push(topic);}});
    if(!unique.length)return;
    const filter=document.createElement('section');filter.className='panel indicator-analysis-filter';filter.dataset.indicatorAnalysisFilter=scope;
    filter.innerHTML=`<div class="panel-header"><div><h3>Visualização dos indicadores</h3><p class="helper-text">Os cards acima permanecem como visão geral. Selecione um indicador para exibir somente as análises relacionadas.</p></div><div class="toolbar-group"><label class="toolbar-field"><span>Indicador</span><select class="filter-control" data-indicator-topic-select><option value="">Todos os indicadores</option>${unique.map((topic)=>`<option value="${esc(topic.key)}">${esc(topic.label)}</option>`).join('')}</select></label></div></div>`;
    const anchor=root.querySelector('.indicator-filter-panel')||root.querySelector('.page-toolbar')||root.querySelector('.page-intro');
    if(anchor)anchor.insertAdjacentElement('afterend',filter);else root.prepend(filter);
    const select=filter.querySelector('[data-indicator-topic-select]');
    const valid=unique.some((topic)=>topic.key===stored.topic);select.value=valid?stored.topic:'';
    const applyTopic=()=>{const selected=select.value||'';stored.topic=selected;save();panels.forEach(({panel,topic})=>{panel.classList.toggle('indicator-topic-hidden',Boolean(selected&&topic.key!==selected));});};
    select.onchange=applyTopic;applyTopic();
  }

  function monthIndicatorLabel(value=''){
    const [year,month]=String(value||'').split('-').map(Number);
    const names=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    return year&&month>=1&&month<=12?`${names[month-1]}/${year}`:String(value||'—');
  }
  function overnightIndicatorsShell(data={}){
    const day=(data.byDay||[]).filter((x)=>Number(x.excessDays||0)>0);
    const week=(data.byWeek||[]).filter((x)=>Number(x.excessDays||0)>0);
    const month=(data.byMonth||[]).filter((x)=>Number(x.excessDays||0)>0);
    const region=data.byRegion||[],route=data.byRoute||[],details=data.details||[];
    const noExcess='<div class="empty-state">Nenhum dia excessivo nos filtros selecionados.</div>';
    const timeChart=(items,labelOf,titleOf)=>items.length?renderVerticalBars(items.map((x)=>({label:labelOf(x),title:titleOf(x),value:Number(x.excessDays||0),display:`${formatNumber(x.excessDays||0)} dia(s)`}))):noExcess;
    const dimensionRows=(items)=>items.map((x)=>`<tr><td><strong>${esc(x.label||'—')}</strong></td><td>${formatNumber(x.routes||0)}</td><td>${formatNumber(x.tripsWithExcess||0)}</td><td><strong>${formatNumber(x.excessDays||0)}</strong></td><td>${formatNumber(x.excessRatePercent||0,1)}%</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Sem viagens concluídas para os filtros selecionados.</td></tr>';
    return `<section class="panel"><div class="panel-header"><div><h3>Pernoite excessivo</h3><p class="helper-text">Dias de duração real além da quantidade de dias planejados para a rota, contabilizados na data em que cada excesso efetivamente ocorreu. Todos os números abaixo respeitam período, região, rota, motorista, vínculo, perfil, placa e busca aplicados acima.</p></div></div><div class="panel-body"><div class="cards-grid">${metric('Dias excessivos',data.excessDays||0,'Na data real da ocorrência','warning')}${metric('Viagens com excesso',data.tripsWithExcess||0,`${data.routes||0} viagem(ns) considerada(s)`,'warning')}${metric('% com excesso',`${formatNumber(data.excessRatePercent||0,1)}%`,'No período selecionado','warning')}${metric('Média do excesso',`${formatNumber(data.averageExcessDays||0,2)} dia(s)`,'Somente viagens com excesso','info')}</div>${data.calculationNote?`<div class="info-box"><strong>Regra:</strong> ${esc(data.calculationNote)}</div>`:''}</div></section>
      <div class="split-grid"><section class="panel"><div class="panel-header"><div><h3>Dias excessivos por dia</h3><p class="helper-text">Agrupado pelo dia em que o limite planejado da viagem foi ultrapassado, e não pela data da escala.</p></div></div><div class="panel-body">${timeChart(day,(x)=>formatDate(x.date),(x)=>`${formatDate(x.date)} · ${formatNumber(x.excessDays||0)} dia(s) excessivo(s) · ${formatNumber(x.tripsWithExcess||0)} viagem(ns)`)}</div></section><section class="panel"><div class="panel-header"><div><h3>Dias excessivos por semana</h3><p class="helper-text">Semanas de segunda a domingo pela data real de ocorrência do excesso.</p></div></div><div class="panel-body">${timeChart(week,(x)=>`${formatDate(x.start).slice(0,5)}–${formatDate(x.end).slice(0,5)}`,(x)=>`${formatDate(x.start)} a ${formatDate(x.end)} · ${formatNumber(x.excessDays||0)} dia(s) excessivo(s) · ${formatNumber(x.tripsWithExcess||0)} viagem(ns)`)}</div></section></div>
      <section class="panel"><div class="panel-header"><div><h3>Dias excessivos por mês</h3><p class="helper-text">Consolidação mensal pela data real de ocorrência do excesso.</p></div></div><div class="panel-body">${timeChart(month,(x)=>monthIndicatorLabel(x.month),(x)=>`${monthIndicatorLabel(x.month)} · ${formatNumber(x.excessDays||0)} dia(s) excessivo(s) · ${formatNumber(x.tripsWithExcess||0)} viagem(ns)`)}</div></section>
      <div class="split-grid"><section class="panel"><div class="panel-header"><h3>Dias excessivos por região</h3></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Região</th><th>Viagens</th><th>Com excesso</th><th>Dias excessivos</th><th>% com excesso</th></tr></thead><tbody>${dimensionRows(region)}</tbody></table></div></div></section><section class="panel"><div class="panel-header"><h3>Dias excessivos por rota</h3></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Rota</th><th>Viagens</th><th>Com excesso</th><th>Dias excessivos</th><th>% com excesso</th></tr></thead><tbody>${dimensionRows(route)}</tbody></table></div></div></section></div>
      <section class="panel"><div class="panel-header"><div><h3>Viagens com duração acima do planejado</h3><p class="helper-text">Auditoria pela duração real entre saída e retorno. A coluna Data(s) do excesso mostra exatamente em qual dia cada excesso foi contabilizado no indicador.</p></div></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Data da escala</th><th>Data(s) do excesso</th><th>Saída real</th><th>Retorno real</th><th>Região</th><th>Rota</th><th>Placa</th><th>Motorista</th><th>Duração planejada</th><th>Duração realizada</th><th>Dias excessivos no período</th><th>Pernoite(s) registrado(s)</th></tr></thead><tbody>${details.map((x)=>`<tr><td>${formatDate(x.data)}</td><td><strong>${esc((x.dias_excessivos_datas||[]).map(formatDate).join(' / ')||'—')}</strong></td><td>${dt(x.saida_real)}</td><td>${dt(x.retorno_real)}</td><td>${esc(x.regiao||'—')}</td><td><strong>${esc(x.rota||'—')}</strong></td><td>${esc(x.placa||'—')}</td><td>${esc(x.motorista||'—')}</td><td>${formatNumber(x.duracao_dias||1)} dia(s)</td><td>${formatNumber(x.duracao_real_dias||1)} dia(s)</td><td><strong>${formatNumber(x.dias_excessivos??x.pernoites_excedentes??0)}</strong></td><td>${esc((x.pernoite_datas||[]).map(formatDate).join(' / ')||'—')}</td></tr>`).join('')||'<tr><td colspan="12" class="muted">Nenhuma viagem gerou dia excessivo dentro do período selecionado.</td></tr>'}</tbody></table></div></div></section>`;
  }

  function devolutionIndicatorsShell(data={}){
    const summary=data||{},byTrip=data.byTrip||[],byDriver=data.byDriver||[],byRoute=data.byRoute||[],byRegion=data.byRegion||[],byProfile=data.byProfile||[],daily=data.daily||[],weekly=data.weekly||[],monthly=data.monthly||[];
    const dimRows=(items)=>items.map((x)=>`<tr><td><strong>${esc(x.label||'—')}</strong></td><td>${formatNumber(x.routes||0)}</td><td>${formatNumber(x.tripsWithReturns||0)}</td><td><strong>${formatNumber(x.returnedDeliveries||0)}</strong></td><td>${formatNumber(x.returnedWeightKg||0,1)} kg</td><td>${formatNumber(x.devolutionRatePercent||0,1)}%</td></tr>`).join('')||'<tr><td colspan="6" class="muted">Sem devoluções Lincros para os filtros selecionados.</td></tr>';
    const timeChart=(items,labelOf)=>items.length?renderVerticalBars(items.map((x)=>({label:labelOf(x),title:`${labelOf(x)} · ${formatNumber(x.returnedDeliveries||0)} devolução(ões) · ${formatNumber(x.returnedWeightKg||0,1)} kg`,value:Number(x.returnedDeliveries||0),display:`${formatNumber(x.returnedDeliveries||0)}`}))):'<div class="empty-state">Sem devoluções no período selecionado.</div>';
    return `<section class="panel" id="route-ind-devolutions"><div class="panel-header"><div><h3>Devoluções · Lincros</h3><p class="helper-text">Consolidação das viagens concluídas e dos filtros aplicados acima. Permite analisar devoluções por viagem, motorista, rota, região e perfil Varejo/Rede.</p></div><div class="toolbar-group"><button class="btn btn-ghost" id="route-ind-devol-export">CSV devoluções</button></div></div><div class="panel-body"><div class="cards-grid route-indicator-kpi-grid">${metric('Entregas devolvidas',summary.returnedDeliveries||0,`${formatNumber(summary.pointedDeliveries||0)} atendimento(s) apontado(s)`,'warning')}${metric('Peso devolvido',`${formatNumber(summary.returnedWeightKg||0,1)} kg`,'PesoDevolvido informado pela Lincros','warning')}${metric('Viagens com devolução',summary.tripsWithReturns||0,`${formatNumber(summary.routes||0)} viagem(ns) com Lincros`,'warning')}${metric('% de devolução',`${formatNumber(summary.devolutionRatePercent||0,1)}%`,'Devoluções ÷ atendimentos apontados','warning')}${metric('% viagens com devolução',`${formatNumber(summary.tripsWithReturnsPercent||0,1)}%`,'Viagens com ao menos 1 devolução','info')}</div>${summary.calculationNote?`<div class="info-box"><strong>Regra:</strong> ${esc(summary.calculationNote)}</div>`:''}</div></section>
      <section class="panel"><div class="panel-header"><div><h3>Devoluções por viagem</h3><p class="helper-text">Mostra inclusive viagens sem devolução para permitir auditoria da taxa dentro do conjunto filtrado.</p></div></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Região</th><th>Perfil</th><th>Rota</th><th>Placa</th><th>Motorista</th><th>Apontadas</th><th>Devolvidas</th><th>Peso devolvido</th><th>% devolução</th></tr></thead><tbody>${byTrip.map((x)=>`<tr class="${Number(x.returnedDeliveries||0)>0?'row-warning':''}"><td>${formatDate(x.date)}</td><td>${esc(x.region||'—')}</td><td>${esc(x.profile||'—')}</td><td><strong>${esc(x.route||'—')}</strong></td><td>${esc(x.plate||'—')}</td><td>${esc(x.driver||'—')}</td><td>${formatNumber(x.pointedDeliveries||0)}</td><td><strong>${formatNumber(x.returnedDeliveries||0)}</strong></td><td>${formatNumber(x.returnedWeightKg||0,1)} kg</td><td>${formatNumber(x.devolutionRatePercent||0,1)}%</td></tr>`).join('')||'<tr><td colspan="10" class="muted">Sem viagens Lincros concluídas para os filtros selecionados.</td></tr>'}</tbody></table></div></div></section>
      <div class="split-grid"><section class="panel"><div class="panel-header"><h3>Devoluções por motorista</h3></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Motorista</th><th>Viagens</th><th>Com devolução</th><th>Devolvidas</th><th>Peso</th><th>%</th></tr></thead><tbody>${dimRows(byDriver)}</tbody></table></div></div></section><section class="panel"><div class="panel-header"><h3>Devoluções por rota</h3></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Rota</th><th>Viagens</th><th>Com devolução</th><th>Devolvidas</th><th>Peso</th><th>%</th></tr></thead><tbody>${dimRows(byRoute)}</tbody></table></div></div></section></div>
      <div class="split-grid"><section class="panel"><div class="panel-header"><h3>Devoluções por região</h3></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Região</th><th>Viagens</th><th>Com devolução</th><th>Devolvidas</th><th>Peso</th><th>%</th></tr></thead><tbody>${dimRows(byRegion)}</tbody></table></div></div></section><section class="panel"><div class="panel-header"><h3>Varejo × Rede</h3></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Perfil</th><th>Viagens</th><th>Com devolução</th><th>Devolvidas</th><th>Peso</th><th>%</th></tr></thead><tbody>${dimRows(byProfile)}</tbody></table></div></div></section></div>
      <div class="split-grid"><section class="panel"><div class="panel-header"><h3>Devoluções por dia</h3></div><div class="panel-body">${timeChart(daily,(x)=>formatDate(x.date))}</div></section><section class="panel"><div class="panel-header"><h3>Devoluções por semana</h3></div><div class="panel-body">${timeChart(weekly,(x)=>`${formatDate(x.start).slice(0,5)}–${formatDate(x.end).slice(0,5)}`)}</div></section></div><section class="panel"><div class="panel-header"><h3>Devoluções por mês</h3></div><div class="panel-body">${timeChart(monthly,(x)=>monthIndicatorLabel(x.month))}</div></section>`;
  }

  function gpsMotionIndicatorsShell(data={}){
    const byRegion=data.byRegion||[],byRoute=data.byRoute||[];
    const rows=(items)=>items.map((x)=>`<tr><td><strong>${esc(x.label||'—')}</strong></td><td>${formatNumber(x.routesWithGps||0)} / ${formatNumber(x.routes||0)}</td><td>${formatMinutes(x.transitMinutes||0)}</td><td>${formatMinutes(x.stoppedMinutes||0)}</td><td>${formatNumber(x.transitPercent||0,1)}%</td><td><strong>${formatNumber(x.stoppedPercent||0,1)}%</strong></td></tr>`).join('')||'<tr><td colspan="6" class="muted">Sem histórico GPS suficiente para os filtros selecionados.</td></tr>';
    return `<section class="panel"><div class="panel-header"><div><h3>Tempo em trânsito × tempo parado · GPS</h3><p class="helper-text">Leitura operacional das viagens concluídas com histórico GPS disponível. Viagens sem cobertura GPS ficam fora da proporção.</p></div></div><div class="panel-body"><div class="cards-grid">${metric('Tempo em trânsito',formatMinutes(data.transitMinutes||0),`${formatNumber(data.transitPercent||0,1)}% do tempo com GPS`,'success')}${metric('Tempo parado',formatMinutes(data.stoppedMinutes||0),`${formatNumber(data.stoppedPercent||0,1)}% do tempo com GPS`,'warning')}${metric('Proporção em trânsito',`${formatNumber(data.transitPercent||0,1)}%`,'Tempo não classificado como parada ≥ 10 min','success')}${metric('Proporção parado',`${formatNumber(data.stoppedPercent||0,1)}%`,`${formatNumber(data.stopEvents||0)} imobilização(ões) GPS`,'warning')}${metric('Cobertura GPS',`${formatNumber(data.gpsCoveragePercent||0,1)}%`,`${formatNumber(data.routesWithGps||0)} de ${formatNumber(data.routes||0)} viagem(ns)`,'info')}</div>${data.calculationNote?`<div class="info-box"><strong>Regra:</strong> ${esc(data.calculationNote)}</div>`:''}</div></section><div class="split-grid"><section class="panel"><div class="panel-header"><h3>Trânsito × parado por região</h3></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Região</th><th>Viagens c/ GPS</th><th>Em trânsito</th><th>Parado</th><th>% trânsito</th><th>% parado</th></tr></thead><tbody>${rows(byRegion)}</tbody></table></div></div></section><section class="panel"><div class="panel-header"><h3>Trânsito × parado por rota</h3></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Rota</th><th>Viagens c/ GPS</th><th>Em trânsito</th><th>Parado</th><th>% trânsito</th><th>% parado</th></tr></thead><tbody>${rows(byRoute)}</tbody></table></div></div></section></div>`;
  }



  function departureRankingMetric(rows=[],metricKey='delayOccurrences'){
    const safe=[...(rows||[])];
    safe.sort((a,b)=>Number(b?.[metricKey]||0)-Number(a?.[metricKey]||0)||Number(b?.delayOccurrences||0)-Number(a?.delayOccurrences||0)||String(a?.name||'').localeCompare(String(b?.name||''),'pt-BR'));
    const max=Math.max(1,...safe.map((row)=>Number(row?.[metricKey]||0)));
    const metricDisplay=(row)=>metricKey==='delayOccurrences'?`${formatNumber(row.delayOccurrences||0)} atraso(s)`:metricKey==='totalDelayMinutes'?`${formatNumber(row.totalDelayMinutes||0,1)} min`:`${formatNumber(row.averageDelayMinutes||0,1)} min`;
    if(!safe.length)return '<div class="empty-state">Sem saídas realizadas para compor o ranking.</div>';
    return `<div class="departure-rank-chart"><div class="departure-rank-legend"><span><i class="is-delay"></i>Com atraso acima da tolerância</span><span><i class="is-tolerance"></i>Somente dentro da tolerância</span></div><div class="departure-rank-scroll">${safe.map((row,index)=>{const value=Number(row?.[metricKey]||0);const delayed=Number(row?.delayOccurrences||0)>0;const width=value>0?Math.max(4,value/max*100):2;return `<div class="departure-rank-row ${delayed?'is-delay':'is-tolerance'}"><span class="departure-rank-position">${index+1}</span><div class="departure-rank-person"><strong>${esc(row.name||'—')}</strong><small>${formatNumber(row.departures||0)} saída(s) · ${formatNumber(row.delayOccurrences||0)} atraso(s) · ${formatNumber(row.withinTolerance||0)} dentro</small></div><div class="departure-rank-track"><span style="width:${width}%"></span></div><b>${esc(metricDisplay(row))}</b></div>`;}).join('')}</div></div>`;
  }
  function departureCrewRankingShell(rankings={},tolerance=30){
    const drivers=rankings.drivers||[],helpers=rankings.helpers||[];
    const pair=(title,description,key)=>`<section class="panel"><div class="panel-header"><div><h3>${esc(title)}</h3><p class="helper-text">${esc(description)}</p></div></div><div class="panel-body"><div class="split-grid"><div><h4 class="departure-rank-subtitle">Motoristas</h4>${departureRankingMetric(drivers,key)}</div><div><h4 class="departure-rank-subtitle">Ajudantes</h4>${departureRankingMetric(helpers,key)}</div></div></div></section>`;
    return `<div class="info-box departure-rank-note"><strong>Leitura do ranking:</strong> atraso = saída acima de ${formatNumber(tolerance)} min de tolerância. Quem teve somente saídas dentro da tolerância permanece no ranking em destaque diferente.</div>${pair('Ranking · ocorrências de atraso','Quantidade de saídas acima da tolerância por colaborador.','delayOccurrences')}${pair('Ranking · tempo total de atraso','Soma dos minutos entre horário programado e saída real em todas as saídas realizadas.','totalDelayMinutes')}${pair('Ranking · tempo médio de atraso','Média dos minutos entre horário programado e saída real por saída realizada.','averageDelayMinutes')}`;
  }

  function departureDashboardFallback(snapshot={},filters={}){
    const schedules=(snapshot?.records?.schedules||[]).filter((row)=>normalize(row.status)!=='CANCELADO');
    const departures=snapshot?.records?.departures||[];
    const tolerance=Number(snapshot.toleranceMinutes||30);
    const dateOf=(row)=>String(row?.data||row?.dateKey||'').slice(0,10);
    const loadKey=(value)=>normalize(value).replace(/[^A-Z0-9]+/g,'|').replace(/^\|+|\|+$/g,'');
    const scheduleAliases=(row)=>[row?.id,row?.sourceKey,row?.legado_id,row?.escala_id,row?.escala_id_legado].filter((v)=>v!==null&&v!==undefined&&String(v)!=='').map(String);
    const departureAliases=(row)=>[row?.schedule_record_id,row?.schedule_id,row?.escala_id,row?.escala_id_legado,row?.legado_id].filter((v)=>v!==null&&v!==undefined&&String(v)!=='').map(String);
    const composite=(row,isSchedule=false)=>{const date=dateOf(row),route=normalize(row?.rota||row?.destino||''),plate=normalize(row?.placa||''),driver=normalize(row?.motorista||''),ocs=loadKey(row?.ocs||row?.carga||''),seq=normalize(row?.sequencia||row?.sequencia_carregamento||'');return [ocs&&date?`OC|${date}|${ocs}`:'',date&&route&&plate?`RP|${date}|${route}|${plate}`:'',date&&seq&&seq!=='0'?`SQ|${date}|${seq}`:'',date&&route&&driver?`RD|${date}|${route}|${driver}`:''].filter(Boolean);};
    const realized=(row)=>normalize(row?.status||row?.status_saida)==='SAIU'&&Boolean(formatTime(row?.hora_real||row?.actualAt||row?.actual_at)!=='—');
    const score=(row)=>{if(!row)return -1;let value=Number(row.id||0);if(realized(row))value+=1e9;if(formatTime(row.hora_real||row.actualAt||row.actual_at)!=='—')value+=1e8;if(normalize(row.status||row.status_saida)==='SAIU')value+=1e7;const updated=Date.parse(String(row.updatedAt||row.updated_at||row.atualizado_em||''));if(Number.isFinite(updated))value+=Math.floor(updated/1e8);return value;};
    const aliasMap=new Map(),compositeMap=new Map();
    departures.forEach((row)=>{departureAliases(row).forEach((key)=>{const prev=aliasMap.get(key);if(!prev||score(row)>score(prev))aliasMap.set(key,row);});composite(row).forEach((key)=>compositeMap.set(key,[...(compositeMap.get(key)||[]),row]));});
    const match=(schedule)=>{let found=null;scheduleAliases(schedule).forEach((key)=>{const row=aliasMap.get(key);if(row&&(!found||score(row)>score(found)))found=row;});if(found)return found;const candidates=new Map();composite(schedule,true).forEach((key)=>(compositeMap.get(key)||[]).forEach((row)=>{if(!departureAliases(row).length)candidates.set(String(row.id||JSON.stringify(row)),row);}));return candidates.size===1?[...candidates.values()][0]:null;};
    const exempt=(schedule)=>{const route=normalize([schedule?.rota,schedule?.destino,schedule?.nome_rota,schedule?.rota_nome].filter(Boolean).join(' ')).replace(/[^A-Z0-9]+/g,' '),hasLoad=Boolean(String(schedule?.ocs||schedule?.carga||'').trim());const internalSupport=/\b(CAIXA|CAIXAS|ALMOXARIFADO)\b/.test(route),otherExempt=/\b(MANOBRA|VENEZA|MANUTENCAO|SERVICO ADM|SERVICO ADMINISTRATIVO)\b/.test(route);return !hasLoad||internalSupport||otherExempt;};
    const driverRelationByName=new Map();
    (snapshot?.records?.resourceCenter||[]).filter((row)=>row.resourceType==='MOTORISTA').forEach((row)=>driverRelationByName.set(normalize(row.resourceName||''),String(row.raw?.VINCULO||'').trim()));
    (snapshot?.records?.indicators||[]).forEach((row)=>{const key=normalize(row.motorista||'');if(key&&!driverRelationByName.has(key))driverRelationByName.set(key,String(row.motorista_vinculo||'').trim());});
    const helperNames=(schedule={},departure={})=>{const names=[];const add=(value)=>{const label=String(value||'').trim();if(label&&!names.some((item)=>normalize(item)===normalize(label)))names.push(label);};add(departure?.ajudante_1||schedule?.ajudante_1);add(departure?.ajudante_2||schedule?.ajudante_2);if(!names.length)String(departure?.ajudantes||schedule?.ajudantes||'').split(/\s*(?:\/|;|\||,)\s*/).forEach(add);return names;};
    const joinedAll=schedules.filter((row)=>!exempt(row)).map((schedule)=>{const departure=match(schedule);const driver=departure?.motorista||schedule.motorista;return {schedule,departure,driverRelation:driverRelationByName.get(normalize(driver||''))||'',helpers:helperNames(schedule,departure)};});
    const values=(getter)=>[...new Set(joinedAll.map(getter).map((v)=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const filterOptions={regions:values(({schedule,departure})=>schedule.regiao||departure?.regiao),routes:values(({schedule,departure})=>schedule.rota||departure?.rota),drivers:values(({schedule,departure})=>departure?.motorista||schedule.motorista),helpers:[...new Set(joinedAll.flatMap((item)=>item.helpers||[]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')),reasons:values(({departure})=>departure?.motivo_atraso),driverRelations:values(({driverRelation})=>driverRelation),plates:values(({schedule,departure})=>(departure?.placa||schedule.placa||'').toUpperCase())};
    const regionFilter=normalize(filters.region||filters.regiao||''),routeFilter=normalize(filters.route||filters.rota||''),driverFilter=normalize(filters.driver||filters.motorista||''),helperFilter=normalize(filters.helper||filters.ajudante||''),reasonFilter=normalize(filters.reason||filters.motivo||filters.motivo_atraso||''),driverRelationFilter=normalize(filters.driverRelation||filters.driver_relation||''),plateFilter=normalize(filters.plate||filters.placa||''),query=normalize(filters.q||filters.busca||'');
    const joined=joinedAll.filter(({schedule,departure,driverRelation,helpers})=>{const region=normalize(schedule.regiao||departure?.regiao||''),route=normalize(schedule.rota||departure?.rota||''),driver=normalize(departure?.motorista||schedule.motorista||''),plate=normalize(departure?.placa||schedule.placa||'');if(regionFilter&&region!==regionFilter)return false;if(routeFilter&&route!==routeFilter)return false;if(driverFilter&&driver!==driverFilter)return false;if(helperFilter&&!(helpers||[]).some((name)=>normalize(name)===helperFilter))return false;if(reasonFilter&&normalize(departure?.motivo_atraso||'')!==reasonFilter)return false;if(driverRelationFilter&&normalize(driverRelation)!==driverRelationFilter)return false;if(plateFilter&&plate!==plateFilter)return false;if(query&&!normalize([schedule.data,schedule.ocs,schedule.rota,schedule.regiao,schedule.placa,schedule.motorista,(helpers||[]).join(' '),driverRelation,departure?.placa,departure?.motorista,departure?.motivo_atraso].join(' ')).includes(query))return false;return true;});
    const minuteValue=(value)=>{const hit=String(value||'').match(/(?:T|\s|^)(\d{1,2}):(\d{2})/);return hit?Number(hit[1])*60+Number(hit[2]):null;};
    const delayOf=(schedule,departure)=>{const a=minuteValue(schedule?.horario_ponto||schedule?.hora_saida_programada||departure?.hora_programada),b=minuteValue(departure?.hora_real);if(a===null||b===null)return 0;let diff=b-a;if(diff<-720)diff+=1440;return Math.max(0,diff);};
    const joinedWithDelay=joined.map((item)=>({...item,delayMinutes:delayOf(item.schedule,item.departure||{})}));
    const realizedRows=joinedWithDelay.filter(({departure})=>realized(departure));
    const delayed=realizedRows.filter(({delayMinutes})=>delayMinutes>tolerance);
    const rankMap=(role)=>{const map=new Map();const add=(name,delay)=>{const label=String(name||'').trim();if(!label)return;const key=normalize(label),row=map.get(key)||{name:label,departures:0,delayOccurrences:0,withinTolerance:0,totalDelayMinutes:0,averageDelayMinutes:0,status:'DENTRO_TOLERANCIA'};row.departures+=1;row.totalDelayMinutes+=Math.max(0,Number(delay||0));if(Number(delay||0)>tolerance)row.delayOccurrences+=1;else row.withinTolerance+=1;row.averageDelayMinutes=Math.round(row.totalDelayMinutes/row.departures*10)/10;row.totalDelayMinutes=Math.round(row.totalDelayMinutes*10)/10;row.status=row.delayOccurrences>0?'ATRASO':'DENTRO_TOLERANCIA';map.set(key,row);};realizedRows.forEach((item)=>{if(role==='driver')add(item.departure?.motorista||item.schedule?.motorista,item.delayMinutes);else (item.helpers||[]).forEach((name)=>{if(!helperFilter||normalize(name)===helperFilter)add(name,item.delayMinutes);});});return [...map.values()];};
    const crewRankings={drivers:rankMap('driver'),helpers:rankMap('helper')};
    const average=realizedRows.length?realizedRows.reduce((sum,{delayMinutes})=>sum+delayMinutes,0)/realizedRows.length:0;
    const byRegion={},byDay={},punctualityByDay={},reasons={};
    joinedWithDelay.forEach(({schedule,departure,delayMinutes})=>{const region=String(schedule.regiao||departure?.regiao||'NÃO INFORMADA').trim()||'NÃO INFORMADA';byRegion[region]??={programmed:0,departed:0,delayed:0};byRegion[region].programmed+=1;if(realized(departure)){byRegion[region].departed+=1;const isDelayed=delayMinutes>tolerance;if(isDelayed)byRegion[region].delayed+=1;const day=String(departure?.data||schedule?.data||'').slice(0,10);if(day){byDay[day]??=[];byDay[day].push(delayMinutes);punctualityByDay[day]??={departed:0,delayed:0};punctualityByDay[day].departed+=1;if(isDelayed)punctualityByDay[day].delayed+=1;}}const reason=String(departure?.motivo_atraso||'').trim();if(reason)reasons[reason]=(reasons[reason]||0)+1;});
    const regionPerformance=Object.entries(byRegion).map(([region,value])=>({region,...value,punctualityPercent:value.departed?Math.round((value.departed-value.delayed)/value.departed*1000)/10:0}));
    const averageDelayByDay=Object.entries(byDay).sort(([a],[b])=>String(a).localeCompare(String(b))).map(([date,values])=>({date,averageDelayMinutes:Math.round(values.reduce((a,b)=>a+b,0)/values.length*10)/10,departures:values.length}));
    const punctualityDaily=Object.entries(punctualityByDay).sort(([a],[b])=>String(a).localeCompare(String(b))).map(([date,value])=>({date,departures:value.departed,delayed:value.delayed,punctualityPercent:value.departed?Math.round((value.departed-value.delayed)/value.departed*1000)/10:0}));
    const loadingSequence=[...realizedRows].sort((a,b)=>String(a.departure?.hora_real||'').localeCompare(String(b.departure?.hora_real||''))).map((item,index)=>({position:index+1,...item}));
    return {versao:'1',degraded:true,degradedReason:'A API específica de Indicadores de Saída ficou temporariamente indisponível; os dados foram reconstruídos a partir da mesma consolidação da Visão Geral.',toleranceMinutes:tolerance,period:snapshot.period||{},summary:{programmed:joinedWithDelay.length,departed:realizedRows.length,pending:joinedWithDelay.length-realizedRows.length,delayed:delayed.length,punctualityPercent:realizedRows.length?Math.round((realizedRows.length-delayed.length)/realizedRows.length*1000)/10:0,averageDelayMinutes:Math.round(average*10)/10},rows:joinedWithDelay,filters:filterOptions,activeFilters:filters,crewRankings,regionPerformance,averageDelayByDay,punctualityByDay:punctualityDaily,reasons:Object.entries(reasons).map(([reason,total])=>({reason,total})).sort((a,b)=>b.total-a.total),loadingSequence};
  }
  async function loadDepartureIndicatorPayload(start,end,active={}){
    const primary=routeIndicatorQuery(`/api/departures?view=dashboard&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,active);
    try{return await api(primary,{fresh:true});}
    catch(error){
      const code=String(error?.code||'');
      const transient=code==='SERVICE_TEMPORARILY_UNAVAILABLE'||code==='REQUEST_TIMEOUT'||/^HTTP_(429|502|503|504)$/.test(code)||error?.name==='TypeError';
      if(!transient)throw error;
      const [snapshot,resourceSnapshot]=await Promise.all([
        api(`/api/route-dashboard?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&includeRecords=1`,{fresh:true}),
        api('/api/resources',{fresh:true,connectionImpact:false}).catch(()=>({resources:[]})),
      ]);
      snapshot.records=snapshot.records||{};snapshot.records.resourceCenter=resourceSnapshot.resources||[];
      return departureDashboardFallback(snapshot,active);
    }
  }

  async function renderIndicators(route) {
    const endDefault=route==='departure_indicators'?(state.routeDepartureIndicatorEnd||today()):(state.routeIndicatorEnd||today());
    const d=new Date(`${endDefault}T12:00:00`); d.setDate(d.getDate()-30);
    const startDefault=route==='departure_indicators'?(state.routeDepartureIndicatorStart||d.toISOString().slice(0,10)):(state.routeIndicatorStart||d.toISOString().slice(0,10));
    if(route==='departure_indicators'){
      const start=startDefault,end=endDefault;state.routeDepartureIndicatorStart=start;state.routeDepartureIndicatorEnd=end;
      const active=state.routeDepartureIndicatorFilters||{};
      const p=await loadDepartureIndicatorPayload(start,end,active);const s=p.summary||{},fo=p.filters||{};
      $('#page-content').innerHTML=`<div class="page-intro"><div><span class="eyebrow">INDICADORES DE SAÍDA · VERSÃO 1 - DMS ROTA</span><h3>Indicadores de saída</h3><p>Pontualidade, motivos, região e sequência real de carregamento. Usa a mesma regra de saída realizada da Visão Geral.</p></div><div class="page-intro-actions"><label class="toolbar-field"><span>Início</span><input id="route-dep-ind-start" class="filter-control" type="date" value="${esc(start)}"></label><label class="toolbar-field"><span>Fim</span><input id="route-dep-ind-end" class="filter-control" type="date" value="${esc(end)}"></label><button class="btn btn-ghost" id="route-dep-ind-export">CSV</button><button class="btn btn-ghost" id="route-dep-ind-print">▣ Imprimir</button></div></div>${indicatorFilterPanel('route-dep-ind-filter',fo,active,false,true,true)}${p.degraded?`<div class="info-box"><strong>Modo contingência:</strong> ${esc(p.degradedReason||'Dados reconstruídos pela consolidação da Visão Geral.')}</div>`:''}<div class="cards-grid">${metric('Programadas',s.programmed||0,'Base operacional filtrada · sem Caixas/Almoxarifado','info')}${metric('Saíram',s.departed||0,'Saída real confirmada','success')}${metric('Pendentes',s.pending||0,'Aguardando saída','warning')}${metric('Atrasadas',s.delayed||0,`Acima de ${p.toleranceMinutes||30} min`,'danger')}${metric('Pontualidade',`${formatNumber(s.punctualityPercent||0,1)}%`,'Dentro da tolerância','success')}${metric('Atraso médio',`${formatNumber(s.averageDelayMinutes||0,1)} min`,'Saídas realizadas','warning')}</div><section class="panel"><div class="panel-header"><div><h3>Média de atraso por dia</h3><p class="helper-text">Média dos minutos de atraso das saídas realizadas em cada dia. Caixas e Almoxarifado não entram no cálculo.</p></div></div><div class="panel-body">${(p.averageDelayByDay||[]).length?renderVerticalBars((p.averageDelayByDay||[]).map((x)=>({label:formatDate(x.date),title:`${formatDate(x.date)} · ${formatNumber(Number(x.averageDelayMinutes||0),1)} min`,value:Number(x.averageDelayMinutes||0),display:`${formatNumber(Number(x.averageDelayMinutes||0),1)} min`}))):'<div class="empty-state">Sem saídas realizadas no período selecionado.</div>'}</div></section><section class="panel"><div class="panel-header"><div><h3>Pontualidade por dia</h3><p class="helper-text">Percentual diário de saídas dentro da tolerância operacional vigente.</p></div></div><div class="panel-body">${(p.punctualityByDay||[]).length?renderVerticalBars((p.punctualityByDay||[]).map((x)=>({label:formatDate(x.date),title:`${formatDate(x.date)} · ${formatNumber(Number(x.punctualityPercent||0),1)}%`,value:Number(x.punctualityPercent||0),display:`${formatNumber(Number(x.punctualityPercent||0),1)}%`}))):'<div class="empty-state">Sem saídas realizadas no período selecionado.</div>'}</div></section><div class="split-grid"><section class="panel"><div class="panel-header"><h3>Desempenho por região</h3></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Região</th><th>Programadas</th><th>Saíram</th><th>Atrasadas</th><th>Pontualidade</th></tr></thead><tbody>${(p.regionPerformance||[]).map((x)=>`<tr><td><strong>${esc(x.region)}</strong></td><td>${x.programmed}</td><td>${x.departed}</td><td>${x.delayed}</td><td>${formatNumber(x.punctualityPercent||0,1)}%</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Sem dados para os filtros selecionados.</td></tr>'}</tbody></table></div></div></section><section class="panel"><div class="panel-header"><h3>Motivos de atraso</h3></div><div class="panel-body">${renderBars((p.reasons||[]).map((x)=>({label:x.reason,value:x.total})))}</div></section></div>${departureCrewRankingShell(p.crewRankings||{},p.toleranceMinutes||30)}<section class="panel"><div class="panel-header"><h3>Sequência real de saída</h3></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Rota</th><th>Placa</th><th>Motorista</th><th>Programado</th><th>Real</th><th>Atraso</th></tr></thead><tbody>${(p.loadingSequence||[]).map((x)=>`<tr><td>${x.position}</td><td>${esc(x.schedule?.rota||'—')}</td><td>${esc(x.departure?.placa||x.schedule?.placa||'—')}</td><td>${esc(x.departure?.motorista||x.schedule?.motorista||'—')}</td><td>${formatTime(x.departure?.hora_programada||x.schedule?.horario_ponto)}</td><td>${formatTime(x.departure?.hora_real)}</td><td>${formatNumber(x.delayMinutes??x.departure?.atraso_minutos??0)} min</td></tr>`).join('')||'<tr><td colspan="7" class="muted">Nenhuma saída realizada no filtro selecionado.</td></tr>'}</tbody></table></div></div></section>`;
      enhanceIndicatorAnalysis('departure-indicators');
      const refresh=()=>{state.routeDepartureIndicatorStart=$('#route-dep-ind-start').value;state.routeDepartureIndicatorEnd=$('#route-dep-ind-end').value;renderIndicators('departure_indicators');};$('#route-dep-ind-start').onchange=refresh;$('#route-dep-ind-end').onchange=refresh;
      const applyDepartureFilters=()=>{state.routeDepartureIndicatorFilters=readIndicatorFilterPanel('route-dep-ind-filter',false,true,true);renderIndicators('departure_indicators');};
      $('#route-dep-ind-filter-apply').onclick=applyDepartureFilters;
      bindIndicatorAutoApply('route-dep-ind-filter',applyDepartureFilters);
      $('#route-dep-ind-filter-clear').onclick=()=>{state.routeDepartureIndicatorFilters={};renderIndicators('departure_indicators');};
      $('#route-dep-ind-filter-q').onkeydown=(event)=>{if(event.key==='Enter')applyDepartureFilters();};
      $('#route-dep-ind-export').onclick=()=>exportCsv((p.rows||[]).map(({schedule={},departure={},driverRelation='',delayMinutes})=>({data:schedule.data,rota:schedule.rota,regiao:schedule.regiao,placa:departure.placa||schedule.placa,motorista:departure.motorista||schedule.motorista,ajudantes:[departure.ajudante_1||schedule.ajudante_1,departure.ajudante_2||schedule.ajudante_2].filter(Boolean).join(' / ')||departure.ajudantes||schedule.ajudantes||'',vinculo_motorista:driverRelation,programado:departure.hora_programada||schedule.horario_ponto,real:departure.hora_real||'',atraso_minutos:delayMinutes??departure.atraso_minutos??0,status:departure.status||'PENDENTE',motivo_atraso:departure.motivo_atraso||'',responsavel_atraso:departure.responsavel_atraso||''})),`indicadores_saida_${start}_${end}.csv`);$('#route-dep-ind-print').onclick=()=>window.print();return;
    }
    const start=startDefault,end=endDefault;state.routeIndicatorStart=start;state.routeIndicatorEnd=end;
    const active=state.routeIndicatorFilters||{};
    const fullIndicatorPath=routeIndicatorQuery(`/api/indicators?view=dashboard&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,active);
    let p;
    try{
      // Indicadores consolida várias fontes (D1 + histórico GPS + Lincros). O limite
      // padrão de 25 s era menor que algumas consultas reais e abortava o navegador
      // mesmo com o Worker ainda processando a resposta.
      p=await api(fullIndicatorPath,{timeoutMs:45000,maxAttempts:1});
    }catch(error){
      const code=String(error?.code||'');
      const transient=code==='REQUEST_TIMEOUT'||code==='SERVICE_TEMPORARILY_UNAVAILABLE'||/^HTTP_(429|502|503|504)$/.test(code)||error?.name==='TypeError';
      if(!transient)throw error;
      const sep=fullIndicatorPath.includes('?')?'&':'?';
      p=await api(`${fullIndicatorPath}${sep}fast=1`,{fresh:true,timeoutMs:30000,maxAttempts:1});
      p={...p,degraded:true,degradedReason:p.degradedReason||'A consulta completa excedeu o tempo esperado. O DMS carregou os indicadores principais em modo rápido; tente atualizar para recuperar GPS, ocorrências e disponibilidade detalhada.'};
    }
    const s=p.summary||{},fo=p.filters||{},oi=p.overnightIndicators||{},de=p.deliveryEconomics||{},dp=p.deliveryPointingUsers||{},dps=dp.summary||{},fa=p.fleetAvailability||{},fleetDays=fa.daily||[];const fleetAudit=(items=[])=>items.length?`<details class="fleet-audit-details"><summary>${items.length}</summary><div class="muted">${items.map((x)=>esc(x)).join(' · ')}</div></details>`:'0';
    const fleetSituationBadge=(value='')=>{const status=normalize(value);if(status==='EM ROTA NO INÍCIO')return '<span class="badge badge-info">EM ROTA NO INÍCIO</span>';if(status==='MANUTENÇÃO')return '<span class="badge badge-warning">MANUTENÇÃO</span>';return '<span class="badge badge-success">DISPONÍVEL</span>';};
    const fleetDayDetails=(r={})=>{const items=r.vehicleDetails||[];return `<details class="fleet-day-details"><summary>Ver situação dos ${formatNumber(items.length||r.totalFleet||0)} veículo(s) em ${esc(formatDate(r.date))}</summary><div class="table-wrap fleet-day-detail-wrap"><table class="data-table fleet-day-detail-table"><thead><tr><th>Placa</th><th>Tipo</th><th>Vínculo</th><th>Situação no indicador</th><th>Status do cadastro</th><th>Rota às 00:00</th><th>Saída</th><th>Retorno</th><th>Previsão manutenção</th></tr></thead><tbody>${items.map((v)=>`<tr><td><strong>${esc(v.plate||'—')}</strong></td><td>${esc(v.type||'—')}</td><td>${esc(v.link||'—')}</td><td>${fleetSituationBadge(v.indicatorStatus)}</td><td>${esc(v.registrationStatus||'—')}</td><td>${esc(v.route||'—')}</td><td>${v.departedAt?esc(auditDt(v.departedAt)):'—'}</td><td>${v.returnedAt?esc(auditDt(v.returnedAt)):'—'}</td><td>${v.maintenanceForecast?esc(v.maintenanceForecast):'—'}</td></tr>`).join('')||'<tr><td colspan="9" class="muted">Sem veículos ativos nesta data.</td></tr>'}</tbody></table></div></details>`;};
    const fleetDayRows=(r={})=>`<tr><td><strong>${formatDate(r.date)}</strong></td><td>${formatNumber(r.totalFleet||0)}</td><td>${fleetAudit(r.inRoutePlates||[])}</td><td>${formatNumber(r.possibleFleet||0)}</td><td>${fleetAudit(r.maintenancePlates||[])}</td><td>${formatNumber(r.available||0)}</td><td><strong>${r.availabilityPercent===null||r.availabilityPercent===undefined?'—':`${formatNumber(r.availabilityPercent,2)}%`}</strong></td></tr><tr class="fleet-day-detail-row"><td colspan="7">${fleetDayDetails(r)}</td></tr>`;
    const occupancyDetailTable=(rows=[],label='Grupo')=>`<div class="table-wrap"><table class="data-table"><thead><tr><th>${esc(label)}</th><th>Viagens</th><th>Peso</th><th>Capacidade somada</th><th>Ocupação ponderada</th><th>Ocupação média</th></tr></thead><tbody>${rows.length?rows.map((x)=>`<tr><td><strong>${esc(x.label||'—')}</strong></td><td>${formatNumber(x.trips||0)}</td><td>${formatNumber(x.totalWeightKg||0,0)} kg</td><td>${formatNumber((x.totalCapacityKg||0)/1000,1)} t</td><td><strong>${x.weightedOccupancyPercent===null||x.weightedOccupancyPercent===undefined?'—':`${formatNumber(x.weightedOccupancyPercent,1)}%`}</strong></td><td>${x.averageOccupancyPercent===null||x.averageOccupancyPercent===undefined?'—':`${formatNumber(x.averageOccupancyPercent,1)}%`}</td></tr>`).join(''):'<tr><td colspan="6" class="muted">Sem viagens com peso e capacidade para calcular ocupação.</td></tr>'}</tbody></table></div>`;
    $('#page-content').innerHTML=`<div class="page-intro"><div><span class="eyebrow">INDICADORES · VERSÃO 1 - DMS ROTA</span><h3>Indicadores</h3><p>Somente rotas com saída e retorno confirmados. Tempo produtivo exclui deslocamentos e intervalo final.</p></div><div class="page-intro-actions"><label class="toolbar-field"><span>Início</span><input id="route-ind-start" class="filter-control" type="date" value="${esc(start)}"></label><label class="toolbar-field"><span>Fim</span><input id="route-ind-end" class="filter-control" type="date" value="${esc(end)}"></label><a class="btn btn-ghost" id="route-ind-recife" href="https://roteirizacao-recife.roteirizacao-natto-recife.workers.dev/" target="_blank" rel="noopener noreferrer" title="Abrir Portal de Roteirização - Recife em uma nova aba">↗ Roteirização Recife</a><button class="btn btn-ghost" id="route-ind-export">CSV</button><button class="btn btn-ghost" id="route-ind-print">▣ Imprimir</button></div></div>${p.degraded?`<div class="info-box"><strong>Modo rápido:</strong> ${esc(p.degradedReason||'Consulta parcial para manter a tela disponível.')}</div>`:''}${indicatorFilterPanel('route-ind-filter',fo,active,true)}<div class="cards-grid route-indicator-kpi-grid">${metric('Horas por tonelada',`${formatNumber(s.hoursPerTon||0,3)} h/t`,'Tempo útil ÷ toneladas','info')}${metric('Toneladas por hora',`${formatNumber(s.tonsPerHour||0,2)} t/h`,'Toneladas ÷ tempo útil','success')}${metric('Entregas por hora',formatNumber(s.deliveriesPerHour||0,2),'Entregas ÷ tempo útil','success')}${metric('Rotas finalizadas',s.completedRoutes||0,`${s.routes||0} analisadas`,'info')}${metric('Peso transportado',`${formatNumber((s.totalTons||0)*1000,0)} kg`,'Quilogramas','success')}${metric('Entregas roteirizadas',formatNumber(de.routedDeliveries||0,0),'Lincros · somente rotas concluídas','info')}${metric('Entregas apontadas',formatNumber(de.pointedDeliveries||0,0),'Lincros · somente rotas concluídas','success')}${metric('% de entrega',de.deliveryCompletionPercent===null||de.deliveryCompletionPercent===undefined?'—':`${formatNumber(de.deliveryCompletionPercent,1)}%`,'Apontadas ÷ roteirizadas','success')}${metric('Usuários com entregas',formatNumber(dps.totalUsers||0,0),'Motoristas de rotas concluídas com entregas Lincros','info')}${metric('Usuários apontando',formatNumber(dps.pointingUsers||0,0),`${formatNumber(dps.notPointingUsers||0,0)} sem apontamento`,'success')}${metric('% usuários apontando',dps.pointingUsersPercent===null||dps.pointingUsersPercent===undefined?'—':`${formatNumber(dps.pointingUsersPercent,1)}%`,'Com ao menos 1 atendimento finalizado','success')}${metric('Pontualidade',`${formatNumber(s.punctualityPercent||0,1)}%`,'Tolerância operacional vigente','success')}${metric('Aderência ao planejamento',`${formatNumber(s.planningAdherencePercent||0,1)}%`,'Planejado × realizado','info')}${metric('Pernoites realizados',s.accumulatedOvernights||0,'Confirmados no Monitoramento/histórico','warning')}${metric('Dias excessivos',oi.excessDays||0,'Duração real acima dos dias planejados','warning')}${metric('Cumprimento sequência',p.deliveryEconomics?.sequenceCompliancePercent===null||p.deliveryEconomics?.sequenceCompliancePercent===undefined?'—':`${formatNumber(p.deliveryEconomics.sequenceCompliancePercent,1)}%`,`${p.deliveryEconomics?.sequenceCompliant||0}/${p.deliveryEconomics?.sequenceApplicable||0} entregas com sequência realizada`,'success')}${metric('Apontamentos no raio',p.deliveryEconomics?.radiusCompliancePercent===null||p.deliveryEconomics?.radiusCompliancePercent===undefined?'—':`${formatNumber(p.deliveryEconomics.radiusCompliancePercent,1)}%`,`${p.deliveryEconomics?.radiusCompliant||0}/${p.deliveryEconomics?.radiusApplicable||0} entregas aplicáveis`,'success')}${metric('Ocupação média',p.deliveryEconomics?.averageOccupancyPercent===null||p.deliveryEconomics?.averageOccupancyPercent===undefined?'—':`${formatNumber(p.deliveryEconomics.averageOccupancyPercent,1)}%`,'Peso roteirizado ÷ capacidade cadastrada','info')}${metric('Disponibilidade média da frota',fa.averagePercent===null||fa.averagePercent===undefined?'—':`${formatNumber(fa.averagePercent,2)}%`,fa.latestDate?`Média diária · ${formatDate(fa.latestDate)}: ${fa.latestPercent===null||fa.latestPercent===undefined?'—':`${formatNumber(fa.latestPercent,2)}%`}`:'Frota possível x disponível','info')}${metric('Viabilidade planejada',de.plannedViabilityPercent===null||de.plannedViabilityPercent===undefined?'—':`${formatNumber(de.plannedViabilityPercent,1)}%`,`${de.plannedViableTrips||0}/${de.plannedViabilityApplicable||0} viagens calculáveis`,'success')}${metric('Viabilidade realizada',de.actualViabilityPercent===null||de.actualViabilityPercent===undefined?'—':`${formatNumber(de.actualViabilityPercent,1)}%`,`${de.actualViableTrips||0}/${de.actualViabilityApplicable||0} viagens calculáveis`,'success')}</div><section class="panel"><div class="panel-header"><div><h3>Acompanhamento de apontamento por usuário</h3><p class="helper-text">Considera somente viagens com saída e retorno confirmados. Usuário/motorista conta como apontando quando possui ao menos um atendimento finalizado no período. Finalização com devolução também conta. A tabela destaca primeiro quem ainda não apontou e separa previstas, apontadas e % das previstas. Para usuários sem nenhum apontamento, registre a justificativa correspondente às viagens exibidas no período.</p></div></div><div class="panel-body"><div class="cards-grid route-indicator-kpi-grid">${metric('Total de usuários',formatNumber(dps.totalUsers||0,0),'Rotas concluídas com entregas previstas','info')}${metric('Apontando',formatNumber(dps.pointingUsers||0,0),'Ao menos 1 atendimento finalizado','success')}${metric('Não apontando',formatNumber(dps.notPointingUsers||0,0),'Prioridade para acompanhamento','warning')}${metric('% usuários apontando',dps.pointingUsersPercent===null||dps.pointingUsersPercent===undefined?'—':`${formatNumber(dps.pointingUsersPercent,1)}%`,'Apontando ÷ total','success')}${metric('Entregas previstas',formatNumber(dps.totalPlanned||0,0),'Total das rotas desses usuários','info')}${metric('Entregas apontadas',formatNumber(dps.totalPointed||0,0),dps.pointedDeliveriesPercent===null||dps.pointedDeliveriesPercent===undefined?'Sem base prevista':`${formatNumber(dps.pointedDeliveriesPercent,1)}% das previstas`,'success')}</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Motorista / usuário</th><th>Vínculo</th><th>Rotas</th><th>Placas</th><th>Entregas previstas</th><th>Entregas apontadas</th><th>% das previstas</th><th>Situação</th><th>Justificativa</th><th>Última consulta</th></tr></thead><tbody>${(dp.users||[]).map((u,i)=>`<tr class="${u.pointed>0?'':'row-warning'}"><td><strong>${esc(u.driver||'—')}</strong><small class="muted">${esc((u.routeNames||[]).join(' / ')||'—')}</small></td><td>${esc(u.driverRelation||'—')}</td><td>${formatNumber(u.routes||0)}</td><td>${esc((u.plates||[]).join(' / ')||'—')}</td><td>${formatNumber(u.planned||0)}</td><td>${formatNumber(u.pointed||0)}</td><td><strong>${u.percent===null||u.percent===undefined?'—':`${formatNumber(u.percent,1)}%`}</strong></td><td>${u.pointed>0?'<span class="badge badge-success">APONTANDO</span>':'<span class="badge badge-warning">NÃO APONTANDO</span>'}</td><td>${u.pointed>0?'—':`<select class="filter-control pointing-justification-select" data-pointing-justification="${i}" ${canWrite()?'':'disabled'} aria-label="Justificativa de ${esc(u.driver||'motorista')}"><option value="">Selecionar...</option>${u.justificationMixed?'<option value="__MIXED__" selected disabled>Múltiplas justificativas</option>':''}${option('SEM CELULAR','Sem Celular',u.justification||'')}${option('CELULAR QUEBRADO','Celular Quebrado',u.justification||'')}${option('MOTORISTA NÃO APONTOU','Motorista não apontou',u.justification||'')}</select>${u.justificationUpdatedAt?`<small class="muted">Atualizado ${esc(auditDt(u.justificationUpdatedAt))}${u.justificationUpdatedBy?` · ${esc(u.justificationUpdatedBy)}`:''}</small>`:''}`}</td><td>${u.lastCheckedAt?esc(auditDt(u.lastCheckedAt)):'—'}</td></tr>`).join('')||'<tr><td colspan="10" class="muted">Sem usuários com entregas Lincros previstas nos filtros selecionados.</td></tr>'}</tbody></table></div></div></section><section class="panel"><div class="panel-header"><div><h3>Disponibilidade diária da frota</h3><p class="helper-text">Frota possível = frota ativa − veículos que já iniciaram o dia em rota. Disponíveis = frota possível − manutenção. O cálculo usa a situação às 00:00 de cada dia. Abaixo de cada data, expanda a visão para conferir a situação individual de cada veículo.</p></div><div class="toolbar-group"><button class="btn btn-ghost" id="route-ind-fleet-detail-export">CSV situação dos carros</button><button class="btn btn-ghost" id="route-ind-fleet-export">CSV disponibilidade</button></div></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Frota ativa</th><th>Em rota no início</th><th>Frota possível</th><th>Manutenção</th><th>Disponíveis</th><th>Disponibilidade</th></tr></thead><tbody>${fleetDays.map(fleetDayRows).join('')||'<tr><td colspan="7" class="muted">Sem dados de frota para o período.</td></tr>'}</tbody></table></div><p class="helper-text">Fonte do histórico de manutenção: ${esc(fa.maintenanceHistorySource||'cadastro de veículos')}. A situação individual mostra a classificação usada pelo indicador e, separadamente, o status cadastrado do veículo naquela data.</p></div></section><section class="panel"><div class="panel-header"><div><h3>Custos, ocupação e execução das entregas</h3><p class="helper-text">Planejado e realizado usam as distâncias da Lincros convertidas para km. Viabilidade: AG1/AG2 ≤ R$ 0,441/kg; SRT ≤ R$ 0,945/kg; AL ≤ R$ 0,910/kg; PB ≤ R$ 0,560/kg.</p></div></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Rota</th><th>Placa</th><th>Tipo</th><th>Peso</th><th>Capacidade</th><th>Ocupação</th><th>Km planejado</th><th>Km real</th><th>R$/km</th><th>Custo planejado</th><th>Custo realizado</th><th>R$/kg plan.</th><th>R$/kg real</th><th>Limite</th><th>Viável plan.?</th><th>Viável real?</th><th>Sequência</th><th>No raio</th></tr></thead><tbody>${(p.records||[]).map((r)=>`<tr><td>${formatDate(r.data)}</td><td><strong>${esc(r.rota||'—')}</strong><div class="muted">${esc(r.regiao||'—')}</div></td><td>${esc(r.placa||'—')}</td><td>${esc(r.veiculo_tipo||'—')}</td><td>${formatNumber(r.peso_kg||0,0)} kg</td><td>${r.veiculo_capacidade_t?`${formatNumber(r.veiculo_capacidade_t,1)} t`:'—'}</td><td>${r.ocupacao_percentual!==null&&r.ocupacao_percentual!==undefined&&Number.isFinite(Number(r.ocupacao_percentual))?`${formatNumber(r.ocupacao_percentual,1)}%`:'—'}</td><td>${r.lincros_distance_planned_km!==null&&r.lincros_distance_planned_km!==undefined&&Number.isFinite(Number(r.lincros_distance_planned_km))?`${formatNumber(r.lincros_distance_planned_km,2)} km`:'—'}</td><td>${r.lincros_distance_actual_km!==null&&r.lincros_distance_actual_km!==undefined&&Number.isFinite(Number(r.lincros_distance_actual_km))?`${formatNumber(r.lincros_distance_actual_km,2)} km`:'—'}</td><td>${r.custo_km!==null&&r.custo_km!==undefined&&Number.isFinite(Number(r.custo_km))?`R$ ${formatNumber(r.custo_km,2)}`:'—'}</td><td>${r.custo_viagem_planejado!==null&&r.custo_viagem_planejado!==undefined&&Number.isFinite(Number(r.custo_viagem_planejado))?`R$ ${formatNumber(r.custo_viagem_planejado,2)}`:'—'}</td><td>${r.custo_viagem_realizado!==null&&r.custo_viagem_realizado!==undefined&&Number.isFinite(Number(r.custo_viagem_realizado))?`R$ ${formatNumber(r.custo_viagem_realizado,2)}`:'—'}</td><td>${r.custo_por_kg_planejado!==null&&r.custo_por_kg_planejado!==undefined&&Number.isFinite(Number(r.custo_por_kg_planejado))?`R$ ${formatNumber(r.custo_por_kg_planejado,3)}`:'—'}</td><td>${r.custo_por_kg_realizado!==null&&r.custo_por_kg_realizado!==undefined&&Number.isFinite(Number(r.custo_por_kg_realizado))?`R$ ${formatNumber(r.custo_por_kg_realizado,3)}`:'—'}</td><td>${r.limite_custo_kg!==null&&r.limite_custo_kg!==undefined&&Number.isFinite(Number(r.limite_custo_kg))?`R$ ${formatNumber(r.limite_custo_kg,3)}`:'—'}</td><td>${r.viagem_viavel_planejada===true?'<span class="badge badge-success">SIM</span>':r.viagem_viavel_planejada===false?'<span class="badge badge-danger">NÃO</span>':'—'}</td><td>${r.viagem_viavel_realizada===true?'<span class="badge badge-success">SIM</span>':r.viagem_viavel_realizada===false?'<span class="badge badge-danger">NÃO</span>':'—'}</td><td>${Number(r.sequenceApplicable||0)?`${formatNumber(r.sequenceCompliancePercent||0,1)}% <small>${r.sequenceCompliant}/${r.sequenceApplicable}</small>`:'—'}</td><td>${Number(r.radiusApplicable||0)?`${formatNumber(r.radiusCompliancePercent||0,1)}% <small>${r.radiusCompliant}/${r.radiusApplicable}</small>`:'—'}</td></tr>`).join('')||'<tr><td colspan="19" class="muted">Sem viagens com dados para o período/filtros selecionados.</td></tr>'}</tbody></table></div></div></section><div class="split-grid"><section class="panel"><div class="panel-header"><div><h3>Ocupação por perfil do veículo</h3><p class="helper-text">Detalhamento por 3/4, Toco, Truck, Bitruck e demais perfis cadastrados.</p></div></div><div class="panel-body">${occupancyDetailTable(p.occupancyByVehicleType||[],'Perfil')}</div></section><section class="panel"><div class="panel-header"><div><h3>Ocupação por rota</h3><p class="helper-text">Ocupação ponderada = peso total roteirizado ÷ capacidade total das viagens do grupo.</p></div></div><div class="panel-body">${occupancyDetailTable(p.occupancyByRoute||[],'Rota')}</div></section></div><div class="split-grid"><section class="panel"><div class="panel-header"><h3>Por região</h3></div><div class="panel-body">${renderBars((p.byRegion||[]).map((x)=>({label:x.label,value:x.routes})))}</div></section><section class="panel"><div class="panel-header"><h3>Por perfil de rota</h3></div><div class="panel-body">${renderBars((p.byProfile||[]).map((x)=>({label:x.label,value:x.routes})))}</div></section></div><section class="panel"><div class="panel-header"><h3>Desempenho por rota</h3></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Rota</th><th>Rotas</th><th>Peso (kg)</th><th>h/t</th><th>t/h</th><th>Entregas/h</th><th>Aderência</th><th>Pontualidade</th></tr></thead><tbody>${(p.byRoute||[]).map((x)=>`<tr><td><strong>${esc(x.label)}</strong></td><td>${x.routes}</td><td>${formatNumber((x.totalTons||0)*1000,0)}</td><td>${formatNumber(x.hoursPerTon||0,3)}</td><td>${formatNumber(x.tonsPerHour||0,2)}</td><td>${formatNumber(x.deliveriesPerHour||0,2)}</td><td>${formatNumber(x.planningAdherencePercent||0,1)}%</td><td>${formatNumber(x.punctualityPercent||0,1)}%</td></tr>`).join('')||'<tr><td colspan="8" class="muted">Sem rotas finalizadas para os filtros selecionados.</td></tr>'}</tbody></table></div></div></section>${devolutionIndicatorsShell(p.devolutionIndicators||{})}${gpsMotionIndicatorsShell(p.gpsMotionIndicators||{})}${overnightIndicatorsShell(oi)}${occurrenceIndicatorsShell(p.occurrenceIndicators||{})}`;
    bindOccurrenceIndicators(p.occurrenceIndicators||{});
    enhanceIndicatorAnalysis('route-indicators');
    $$('[data-pointing-justification]').forEach((select)=>{
      select.onchange=async()=>{
        const index=Number(select.dataset.pointingJustification),user=(dp.users||[])[index];
        if(!user)return;
        const previous=user.justificationMixed?'__MIXED__':(user.justification||''),value=select.value;
        select.disabled=true;
        try{
          await api('/api/indicators',{method:'POST',body:JSON.stringify({action:'POINTING_JUSTIFICATION',scheduleIds:user.scheduleIds||[],driver:user.driver||'',justification:value,requestId:crypto.randomUUID()})});
          user.justification=value;user.justificationMixed=false;user.justificationUpdatedAt=new Date().toISOString();user.justificationUpdatedBy=state.user?.name||state.user?.email||'';
          toast(value?'Justificativa salva no acompanhamento Lincros.':'Justificativa removida.');
        }catch(error){
          select.value=previous;
          toast(error?.message||'Não foi possível salvar a justificativa.','danger');
        }finally{select.disabled=!canWrite();}
      };
    });
    const refresh=()=>{state.routeIndicatorStart=$('#route-ind-start').value;state.routeIndicatorEnd=$('#route-ind-end').value;renderIndicators('route_indicators');};$('#route-ind-start').onchange=refresh;$('#route-ind-end').onchange=refresh;
    const applyIndicatorFilters=()=>{state.routeIndicatorFilters=readIndicatorFilterPanel('route-ind-filter',true);renderIndicators('route_indicators');};
    $('#route-ind-filter-apply').onclick=applyIndicatorFilters;
    bindIndicatorAutoApply('route-ind-filter',applyIndicatorFilters);
    $('#route-ind-filter-clear').onclick=()=>{state.routeIndicatorFilters={};renderIndicators('route_indicators');};
    $('#route-ind-filter-q').onkeydown=(event)=>{if(event.key==='Enter')applyIndicatorFilters();};
    if($('#route-ind-fleet-detail-export'))$('#route-ind-fleet-detail-export').onclick=()=>exportCsv(fleetDays.flatMap((r)=>(r.vehicleDetails||[]).map((v)=>({data:r.date,placa:v.plate,tipo:v.type,vinculo:v.link,transportadora:v.carrier,situacao_indicador:v.indicatorStatus,status_cadastro:v.registrationStatus,rota_00h:v.route,saida:v.departedAt,retorno:v.returnedAt,previsao_manutencao:v.maintenanceForecast,local_cadastro:v.currentLocation}))),`situacao_frota_detalhada_${start}_${end}.csv`);
    if($('#route-ind-fleet-export'))$('#route-ind-fleet-export').onclick=()=>exportCsv(fleetDays.map((r)=>({data:r.date,frota_ativa:r.totalFleet,em_rota_inicio:r.inRouteAtStart,placas_em_rota:(r.inRoutePlates||[]).join(' / '),frota_possivel:r.possibleFleet,manutencao:r.maintenance,placas_manutencao:(r.maintenancePlates||[]).join(' / '),disponiveis:r.available,disponibilidade_percent:r.availabilityPercent})),`disponibilidade_frota_${start}_${end}.csv`);
    if($('#route-ind-devol-export'))$('#route-ind-devol-export').onclick=()=>exportCsv((p.devolutionIndicators?.byTrip||[]).map((x)=>({data:x.date,regiao:x.region,perfil:x.profile,rota:x.route,placa:x.plate,motorista:x.driver,entregas_previstas:x.plannedDeliveries,entregas_apontadas:x.pointedDeliveries,entregas_devolvidas:x.returnedDeliveries,peso_devolvido_kg:x.returnedWeightKg,percentual_devolucao:x.devolutionRatePercent})),`devolucoes_${start}_${end}.csv`);
    $('#route-ind-export').onclick=()=>exportCsv(p.records||[],`indicadores_${start}_${end}.csv`);$('#route-ind-print').onclick=()=>window.print();
  }


  async function renderManagementData() {
    const end=state.routeManagementEnd||today();const d=new Date(`${end}T12:00:00`);d.setDate(d.getDate()-30);const start=state.routeManagementStart||d.toISOString().slice(0,10);
    const active=state.routeManagementFilters||{};
    const p=await api(routeIndicatorQuery(`/api/indicators?view=management&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,active),{timeoutMs:25000,maxAttempts:1}),rows=(p.records||[]).map((row,index)=>({...row,__rowNumber:index+1})),overnightHistory=p.overnightHistory||[],s=p.summary||{},fo=p.filters||{};
    $('#page-content').innerHTML=`<div class="page-intro"><div><span class="eyebrow">GESTÃO · VERSÃO 1 - DMS ROTA</span><h3>Dados Gerenciais</h3><p>Tempo com/sem deslocamento, produtividade, aderência, dispersão, histórico de pernoites e detalhamento por motorista.</p></div><div class="page-intro-actions"><label class="toolbar-field"><span>Início</span><input id="route-mgt-start" class="filter-control" type="date" value="${esc(start)}"></label><label class="toolbar-field"><span>Fim</span><input id="route-mgt-end" class="filter-control" type="date" value="${esc(end)}"></label><button class="btn btn-ghost" id="route-mgt-export">CSV geral</button><button class="btn btn-ghost" id="route-mgt-print">▣ Imprimir</button></div></div>${indicatorFilterPanel('route-mgt-filter',fo,active,true)}<div class="cards-grid">${metric('Rotas concluídas',s.completedRoutes||0,`${s.routes||0} no período`,'success')}${metric('Peso transportado',`${formatNumber((s.totalTons||0)*1000,0)} kg`,'Total finalizado','info')}${metric('Horas por tonelada',formatNumber(s.hoursPerTon||0,3),'Sem deslocamento','info')}${metric('Toneladas/hora',formatNumber(s.tonsPerHour||0,2),'Sem deslocamento','success')}${metric('Entregas/hora',formatNumber(s.deliveriesPerHour||0,2),'Sem deslocamento','success')}${metric('Aderência',`${formatNumber(s.planningAdherencePercent||0,1)}%`,'Planejado × realizado','info')}${metric('Pernoites apontados',s.overnightEvents||0,'Histórico no período','warning')}${metric('Carros com pernoite vazio',s.emptyOvernightVehicles||0,`${s.emptyOvernightEvents||0} apontamento(s) com a palavra “vazio”`,'warning')}</div>
      <section class="panel"><div class="panel-header"><div><h3>Histórico de pernoites apontados</h3><p class="helper-text">Eventos de PERNOITE registrados no Monitoramento. “Pernoite vazio” é identificado quando a justificativa/observação contém a palavra vazio.</p></div><div class="toolbar-group"><span class="badge badge-warning">${overnightHistory.length} apontamento(s)</span><button class="btn btn-ghost" id="route-mgt-overnight-export">CSV pernoites</button></div></div><div class="panel-body"><div class="table-wrap management-overnight-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Rota</th><th>Região</th><th>Placa</th><th>Motorista</th><th>Vínculo</th><th>Dias em rota</th><th>Justificativa / observação</th><th>Vazio?</th><th>Apontado em</th><th>Apontado por</th></tr></thead><tbody>${overnightHistory.map((r)=>`<tr><td>${esc(formatDate(r.data_pernoite))}</td><td><strong>${esc(r.rota||'—')}</strong></td><td>${esc(r.regiao||'—')}</td><td>${esc(r.placa||'—')}</td><td>${esc(r.motorista||'—')}</td><td>${esc(r.motorista_vinculo||'—')}</td><td>${formatNumber(r.dias_em_rota||1)}</td><td>${r.justificativa?esc(r.justificativa):'<span class="badge badge-warning">SEM JUSTIFICATIVA HISTÓRICA</span>'}</td><td>${r.pernoite_vazio?'<span class="badge badge-warning">SIM</span>':'Não'}</td><td>${auditDt(r.apontado_em)}</td><td>${esc(r.apontado_por||'Sistema')}</td></tr>`).join('')||'<tr><td colspan="11" class="muted">Nenhum pernoite apontado no período/filtros selecionados.</td></tr>'}</tbody></table></div></div></section>
      <div class="split-grid"><section class="panel"><div class="panel-header"><h3>Por motorista</h3></div><div class="panel-body">${renderBars((p.byDriver||[]).slice(0,15).map((x)=>({label:x.label,value:x.routes})))}</div></section><section class="panel"><div class="panel-header"><h3>Por região</h3></div><div class="panel-body">${renderBars((p.byRegion||[]).map((x)=>({label:x.label,value:x.routes})))}</div></section></div>
      <section class="panel"><div class="panel-header"><div><h3>Detalhado — Produtividade Motorista</h3><p class="helper-text">Inclui OC, tempo previsto, entregas, apoios, devoluções e os dois conceitos de tempo de rota.</p></div><div class="toolbar-group"><span class="badge badge-info" id="route-mgt-detail-count">${rows.length} viagem(ns)</span><button class="btn btn-ghost" id="route-mgt-detail-clear">Limpar filtros</button><button class="btn btn-ghost" id="route-mgt-detail-export">CSV detalhado</button></div></div><div class="panel-body"><div class="table-wrap management-detail-wrap"><table class="data-table management-detail-table" id="route-mgt-detail-table"><thead id="route-mgt-detail-head"></thead><tbody id="route-mgt-detail-body"></tbody></table></div></div></section>`;

    const signedMinutes=(value)=>{const n=Math.round(Number(value||0));return `${n>=0?'+':'−'}${formatMinutes(Math.abs(n))}`;};
    enhanceIndicatorAnalysis('management-indicators');
    const cols=[
      {key:'n',label:'Nº',raw:(x)=>x.__rowNumber,text:(x)=>String(x.__rowNumber),html:(x)=>`<strong>${x.__rowNumber}</strong>`},
      {key:'data',label:'Data',raw:(x)=>x.data,text:(x)=>formatDate(x.data)},
      {key:'ocs',label:'OC',raw:(x)=>x.ocs||'',text:(x)=>x.ocs||'—',html:(x)=>`<strong>${esc(x.ocs||'—')}</strong>`},
      {key:'perfil',label:'Região / Perfil',raw:(x)=>`${x.regiao||''} ${x.perfil_rota||''}`,text:(x)=>`${x.regiao||'—'}${x.perfil_rota?` ${x.perfil_rota}`:''}`},
      {key:'rota',label:'Rota / Destino',raw:(x)=>x.rota||'',text:(x)=>x.rota||'—',html:(x)=>`<strong>${esc(x.rota||'—')}</strong><div class="muted">${esc(x.regiao||'—')}</div>`},
      {key:'placa',label:'Placa',raw:(x)=>x.placa||'',text:(x)=>x.placa||'—',html:(x)=>`<strong>${esc(x.placa||'—')}</strong>`},
      {key:'motorista',label:'Motorista',raw:(x)=>x.motorista||'',text:(x)=>x.motorista||'—'},
      {key:'peso',label:'Peso Final',raw:(x)=>Number(x.peso_kg||0),text:(x)=>`${formatNumber(x.peso_kg||0,0)} kg`},
      {key:'ent_prev',label:'Entregas Previstas',raw:(x)=>Number(x.entregas_planejadas||0),text:(x)=>formatNumber(x.entregas_planejadas||0)},
      {key:'ent_real',label:'Entregas Realizadas',raw:(x)=>Number(x.entregas||0),text:(x)=>formatNumber(x.entregas||0)},
      {key:'origem_ent',label:'Origem Entregas',raw:(x)=>x.fonte_entregas||'',text:(x)=>String(x.fonte_entregas||'—').replaceAll('_',' ')},
      {key:'apoios',label:'Apoios',raw:(x)=>Number(x.apoios||0),text:(x)=>formatNumber(x.apoios||0)},
      {key:'devolucoes',label:'Devoluções',raw:(x)=>Number(x.devolucoes||0),text:(x)=>formatNumber(x.devolucoes||0)},
      {key:'ead',label:'E/A/D',raw:(x)=>`${x.entregas||0}/${x.apoios||0}/${x.devolucoes||0}`,text:(x)=>`${formatNumber(x.entregas||0)} / ${formatNumber(x.apoios||0)} / ${formatNumber(x.devolucoes||0)}`,html:(x)=>`<strong>${formatNumber(x.entregas||0)} / ${formatNumber(x.apoios||0)} / ${formatNumber(x.devolucoes||0)}</strong>`},
      {key:'saida_prev',label:'Saída Prevista',raw:(x)=>x.saida_programada||'',text:(x)=>formatTime(x.saida_programada)},
      {key:'saida_real',label:'Saída Realizada',raw:(x)=>x.saida_real||'',text:(x)=>`${formatTime(x.saida_real)} ${signedMinutes(x.atraso_minutos||0)}`,html:(x)=>`${esc(formatTime(x.saida_real))}<div class="muted">${esc(signedMinutes(x.atraso_minutos||0))}</div>`},
      {key:'ret_prev',label:'Previsão de Retorno',raw:(x)=>x.retorno_previsto||'',text:(x)=>dt(x.retorno_previsto)},
      {key:'ret_real',label:'Retorno Realizado',raw:(x)=>x.retorno_real||'',text:(x)=>dt(x.retorno_real)},
      {key:'tempo_prev',label:'Tempo Previsto',raw:(x)=>Number(x.tempo_planejado_min||0),text:(x)=>formatMinutes(x.tempo_planejado_min||0)},
      {key:'tempo_com',label:'Tempo com Deslocamento',raw:(x)=>Number(x.tempo_com_deslocamento_min||0),text:(x)=>formatMinutes(x.tempo_com_deslocamento_min||0)},
      {key:'tempo_sem',label:'Tempo sem Deslocamento',raw:(x)=>Number(x.tempo_sem_deslocamento_min||0),text:(x)=>formatMinutes(x.tempo_sem_deslocamento_min||0)},
      {key:'aderencia',label:'Aderência',raw:(x)=>Number(x.aderencia_planejamento||0),text:(x)=>`${formatNumber(x.aderencia_planejamento||0,1)}%`},
      {key:'ader_ent',label:'Aderência Entregas',raw:(x)=>Number(x.aderencia_entregas||0),text:(x)=>`${formatNumber(x.aderencia_entregas||0,1)}%`},
      {key:'desvio_ret',label:'Desvio Retorno',raw:(x)=>Number(x.desvio_retorno_minutos||0),text:(x)=>signedMinutes(x.desvio_retorno_minutos||0)},
      {key:'pernoites',label:'Pernoites',raw:(x)=>Number(x.pernoites||0),text:(x)=>formatNumber(x.pernoites||0)},
      {key:'th',label:'T/H',raw:(x)=>Number(x.toneladas_hora||0),text:(x)=>formatNumber(x.toneladas_hora||0,2)},
      {key:'enth',label:'Entregas/H',raw:(x)=>Number(x.entregas_hora||0),text:(x)=>formatNumber(x.entregas_hora||0,2)},
    ];
    const filters={};let sortKey='data',sortDir=-1;let visible=[...rows];
    $('#route-mgt-detail-head').innerHTML=`<tr>${cols.map((col)=>`<th><button class="management-sort-button" type="button" data-mgt-sort="${esc(col.key)}">${esc(col.label)} <span>↕</span></button></th>`).join('')}</tr><tr class="management-filter-row">${cols.map((col)=>`<th><input class="management-column-filter" data-mgt-filter="${esc(col.key)}" placeholder="Filtrar..."></th>`).join('')}</tr>`;
    const colByKey=new Map(cols.map((col)=>[col.key,col]));
    const drawDetail=()=>{visible=rows.filter((row)=>cols.every((col)=>{const q=normalize(filters[col.key]||'');return !q||normalize(col.text(row)).includes(q);}));const sortCol=colByKey.get(sortKey);if(sortCol)visible.sort((a,b)=>{const av=sortCol.raw(a),bv=sortCol.raw(b);if(typeof av==='number'&&typeof bv==='number')return (av-bv)*sortDir;return String(av??'').localeCompare(String(bv??''),'pt-BR',{numeric:true})*sortDir;});$('#route-mgt-detail-count').textContent=`${visible.length} viagem(ns)`;$('#route-mgt-detail-body').innerHTML=visible.length?visible.map((row)=>`<tr>${cols.map((col)=>`<td>${col.html?col.html(row):esc(col.text(row))}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${cols.length}"><div class="empty-state">Nenhuma viagem corresponde aos filtros.</div></td></tr>`;};
    $$('[data-mgt-filter]').forEach((input)=>input.oninput=()=>{filters[input.dataset.mgtFilter]=input.value;drawDetail();});
    $$('[data-mgt-sort]').forEach((button)=>button.onclick=()=>{const key=button.dataset.mgtSort;if(sortKey===key)sortDir*=-1;else{sortKey=key;sortDir=1;}drawDetail();});
    $('#route-mgt-detail-clear').onclick=()=>{$$('[data-mgt-filter]').forEach((input)=>input.value='');Object.keys(filters).forEach((key)=>delete filters[key]);drawDetail();};
    drawDetail();
    const refresh=()=>{state.routeManagementStart=$('#route-mgt-start').value;state.routeManagementEnd=$('#route-mgt-end').value;renderManagementData();};$('#route-mgt-start').onchange=refresh;$('#route-mgt-end').onchange=refresh;
    const applyManagementFilters=()=>{state.routeManagementFilters=readIndicatorFilterPanel('route-mgt-filter',true);renderManagementData();};
    $('#route-mgt-filter-apply').onclick=applyManagementFilters;
    bindIndicatorAutoApply('route-mgt-filter',applyManagementFilters);
    $('#route-mgt-filter-clear').onclick=()=>{state.routeManagementFilters={};renderManagementData();};
    $('#route-mgt-filter-q').onkeydown=(event)=>{if(event.key==='Enter')applyManagementFilters();};
    const detailExport=()=>visible.map((x)=>Object.fromEntries(cols.map((col)=>[col.label,col.text(x)])));
    $('#route-mgt-detail-export').onclick=()=>exportCsv(detailExport(),`produtividade_motorista_${start}_${end}.csv`);
    $('#route-mgt-overnight-export').onclick=()=>exportCsv(overnightHistory.map((r)=>({data_pernoite:formatDate(r.data_pernoite),rota:r.rota||'',regiao:r.regiao||'',placa:r.placa||'',motorista:r.motorista||'',vinculo_motorista:r.motorista_vinculo||'',dias_em_rota:r.dias_em_rota||1,justificativa_observacao:r.justificativa||'',pernoite_vazio:r.pernoite_vazio?'SIM':'NÃO',apontado_em:auditDt(r.apontado_em),apontado_por:r.apontado_por||''})),`historico_pernoites_${start}_${end}.csv`);
    $('#route-mgt-export').onclick=()=>exportCsv(rows.map(({__rowNumber,...row})=>row),`dados_gerenciais_${start}_${end}.csv`);$('#route-mgt-print').onclick=()=>window.print();
  }



  let routeLocationMap=null;
  let routeLocationCluster=null;
  let routeLocationMarkers=new Map();
  let routeClientMarkerLayer=null;
  let routeTripClients=null; // {records,trip,...} quando um veículo em rota está selecionado
  let routeClientRadiusLayer=null;
  let routeClientLoadTimer=null;
  let routeClientRequestId=0;
  const routePlate=(value='')=>normalize(value).replace(/[^A-Z0-9]/g,'');
  const routeOwnVehicle=(vehicle={})=>{
    const link=normalize(vehicle.vinculo||vehicle.raw?.VINCULO||'PRÓPRIO');
    const own=link==='PRÓPRIO'||link==='PROPRIO';
    const active=vehicle.ativo!==false&&Number(vehicle.ativo??vehicle.raw?.ATIVO??1)!==0&&!['INATIVO','DESLIGADO'].includes(normalize(vehicle.status||vehicle.raw?.STATUS));
    return own&&active&&Boolean(routePlate(vehicle.placa||vehicle.raw?.PLACA));
  };
  const routeGpsDate=(value)=>{
    const text=String(value||'').trim(); if(!text)return null;
    const br=text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if(br)return new Date(`${br[3]}-${br[2]}-${br[1]}T${String(br[4]||'00').padStart(2,'0')}:${br[5]||'00'}:${br[6]||'00'}`);
    const iso=new Date(text.replace(' ','T')); return Number.isNaN(iso.getTime())?null:iso;
  };
  const routeGpsAgeMinutes=(value)=>{const date=routeGpsDate(value);return date?Math.max(0,Math.round((Date.now()-date.getTime())/60000)):Number.POSITIVE_INFINITY;};
  const routeGpsAge=(value)=>{const minutes=routeGpsAgeMinutes(value);if(!Number.isFinite(minutes))return 'Sem horário GPS';if(minutes<60)return `${minutes} min atrás`;const hours=Math.floor(minutes/60),rest=minutes%60;return rest?`${hours}h${String(rest).padStart(2,'0')} atrás`:`${hours}h atrás`;};
  const routeGpsCoordinates=(pos)=>{if(!pos||typeof pos!=='object')return null;if(pos.latitude===null||pos.latitude===undefined||pos.latitude===''||pos.longitude===null||pos.longitude===undefined||pos.longitude==='')return null;const lat=Number(pos.latitude),lng=Number(pos.longitude);return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?[lat,lng]:null;};
  const routeLocationStatus=(monitoring,vehicle)=>monitoring?.status_monitoramento||monitoring?.status||vehicle?.status||vehicle?.raw?.STATUS||'SEM VIAGEM ATIVA';
  const routeNearbyClients=(item)=>Array.isArray(item?.nearbyClients)?item.nearbyClients:[];
  const routeClientLabel=(client={})=>{const code=String(client.code||client.codigo||'').trim(),name=String(client.name||client.nome||'Cliente').trim();return code?`[${code}] ${name}`:name;};
  const routeNearbyClientItems=(item)=>routeNearbyClients(item).map((client)=>({code:String(client.code||client.codigo||'').trim(),name:String(client.name||client.nome||'Cliente').trim(),distance:Number(client.distanceMeters??client.distance??0)}));
  const routeNearbyClientText=(item)=>routeNearbyClientItems(item).map((client)=>`${client.code?`[${client.code}] `:''}${client.name}${client.distance>0?` (${formatNumber(client.distance,0)} m)`:''}`).join(', ');
  const routeNearbyClientListHtml=(item,{compact=false}={})=>{const items=routeNearbyClientItems(item);if(!items.length)return '';return `<ul class="route-nearby-client-list ${compact?'is-compact':''}">${items.map((client)=>`<li class="route-nearby-client-item"><span class="route-nearby-client-name">${client.code?`<b>[${esc(client.code)}]</b> `:''}${esc(client.name)}</span>${client.distance>0?`<span class="route-nearby-client-distance">${esc(formatNumber(client.distance,0))} m</span>`:''}</li>`).join('')}</ul>`;};
  const routeRecifeMinutes=()=>{try{const parts=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Recife',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());const get=(type)=>Number(parts.find((part)=>part.type===type)?.value||0);return get('hour')*60+get('minute');}catch{const d=new Date();return d.getHours()*60+d.getMinutes();}};
  const routeIsNetworks=(row)=>{const route=normalize(row?.monitoring?.rota||row?.rota||row?.vehicle?.local_atual||''),profile=normalize(row?.monitoring?.perfil||row?.monitoring?.perfil_rota||row?.perfil||row?.perfil_rota||row?.perfil_rota_calculado||'');return profile.includes('REDE')||route.includes('REDES')||route.includes(' REDE')||route.endsWith('REDE');};
  const monitoringCategory=(row={})=>routeIsNetworks({monitoring:row})?'REDE':'VAREJO';
  const routeFleetAlert=(row)=>{
    const pos=row?.pos;
    if(!pos||!routeGpsCoordinates(pos))return {kind:'no-position',level:'danger',label:'Sem posição GPS',detail:'Nenhuma posição disponível para o veículo.',blink:true};
    const apiAge=Number(pos.apiFetchAgeMinutes);
    if(pos.source!=='LINCROS'&&Number.isFinite(apiAge)&&apiAge>15)return {kind:'api-stale',level:'danger',label:'ProtectSat sem atualizar a placa',detail:`A placa não veio com nova leitura da API há ${formatNumber(apiAge,0)} min. A última posição foi mantida em contingência.`,blink:true};
    const age=Number.isFinite(Number(pos.gpsAgeMinutes))?Number(pos.gpsAgeMinutes):routeGpsAgeMinutes(pos.updatedAt);
    if(age>=60)return {kind:'no-position',level:'danger',label:'Sem posição há 1h+',detail:`Última atualização há ${routeGpsAge(pos.updatedAt)}.`,blink:true};
    const stopped=Math.max(0,Number(pos.stoppedMinutes||0));
    const currentMinutes=routeRecifeMinutes();
    const vehicleType=normalize(pos.registeredVehicleType||row?.vehicle?.tipo||row?.vehicle?.type||'').replace(/[^A-Z0-9]/g,'');
    if(pos.ignitionReliable!==false&&vehicleType==='34'&&Number(pos.ignition)===0&&(currentMinutes>=20*60||currentMinutes<=5*60))return {kind:'night-ignition-off',level:'warning',label:'Ignição desligada 20h–05h · 3/4',detail:'Veículo 3/4 com ignição desligada no período noturno monitorado.',blink:true};
    const stopThreshold=routeIsNetworks(row)?60:20;
    if(stopped>=stopThreshold)return {kind:`stop-${stopThreshold}`,level:'warning',label:stopThreshold===60?'Parado há 1 hora ou mais · Rede':'Parado há 20 min ou mais · Varejo',detail:`Parado há ${formatNumber(stopped,0)} min. Limiar desta rota: ${formatNumber(stopThreshold,0)} min.`,blink:true};
    return null;
  };
  const routeFleetState=(row)=>{
    const alert=routeFleetAlert(row);
    if(alert?.level==='danger')return 'offline';
    if(alert)return 'alert';
    if(!row?.pos||!routeGpsCoordinates(row.pos))return 'offline';
    const operational=normalize(row.status||'');
    if(operational.includes('ALERTA')||operational.includes('ATRAS')||operational.includes('BLOQ'))return 'alert';
    if(row.pos.source==='LINCROS')return 'backup';
    const speed=Number(row.pos.speed||0);
    if(speed>0)return 'moving';
    return 'stopped';
  };
  const routeFleetStateLabel=(state)=>({moving:'Em movimento',stopped:'Parado',alert:'Alerta de parada',offline:'Sem posição',backup:'Posição Lincros'})[state]||'Sem status';
  const routeFleetPinHtml=(state,{ignition=0,blink=false,alertKind=''}={})=>`<div class="fleet-vehicle-pin is-${state} ${Number(ignition)===1?'is-ignition-on':'is-ignition-off'} ${blink?'is-blinking':''} ${alertKind?`is-${esc(alertKind)}`:''}" aria-hidden="true"><span class="fleet-vehicle-pin-core"><svg viewBox="0 0 24 24"><path d="M3 6h11v9H3zM14 9h3l4 4v2h-7zM6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg></span></div>`;
  const routeHistoryPopup=(plate,pos,label='Posição')=>`<div class="route-map-popup"><strong>${esc(plate)}</strong><span>${esc(label)}</span><b>${esc(pos.updatedAt||'Sem horário')}</b><small>${esc(pos.point||pos.location||'Posição sem descrição')}</small><small>${esc(`${pos.latitude??'—'}, ${pos.longitude??'—'}`)}</small>${routeNearbyClients(pos).length?`<div class="route-popup-nearby"><small>Cliente(s) próximo(s)</small>${routeNearbyClientListHtml(pos,{compact:true})}</div>`:''}</div>`;
  const routeHistoryDisplayPoints=(positions=[])=>{
    const ordered=[...(positions||[])].filter((pos)=>routeGpsCoordinates(pos)).sort((a,b)=>(routeGpsDate(a.updatedAt)?.getTime()||0)-(routeGpsDate(b.updatedAt)?.getTime()||0));
    if(ordered.length<=2)return ordered;
    const max=14,selected=[ordered[0]];let last=ordered[0];
    const distance=(a,b)=>{const ca=routeGpsCoordinates(a),cb=routeGpsCoordinates(b);if(!ca||!cb)return 0;const lat=(ca[0]+cb[0])/2*Math.PI/180;const dx=(cb[1]-ca[1])*111320*Math.cos(lat),dy=(cb[0]-ca[0])*110540;return Math.hypot(dx,dy);};
    for(let i=1;i<ordered.length-1&&selected.length<max-1;i+=1){const item=ordered[i],lastTime=routeGpsDate(last.updatedAt)?.getTime()||0,itemTime=routeGpsDate(item.updatedAt)?.getTime()||0;if(distance(last,item)>=6000||(itemTime-lastTime)>=60*60*1000){selected.push(item);last=item;}}
    selected.push(ordered.at(-1));return selected;
  };
  const ROUTE_TRIP_STATE_COLORS={ENTREGUE:'#16a34a',PENDENTE:'#d97706',DEVOLVIDO:'#dc2626'};
  function renderRouteClients(clients=[],{tripMode=false}={}){
    if(!routeLocationMap||!window.L)return;
    if(routeClientMarkerLayer&&routeLocationMap.hasLayer(routeClientMarkerLayer))routeLocationMap.removeLayer(routeClientMarkerLayer);
    if(routeClientRadiusLayer&&routeLocationMap.hasLayer(routeClientRadiusLayer))routeLocationMap.removeLayer(routeClientRadiusLayer);
    routeClientMarkerLayer=null;routeClientRadiusLayer=null;
    if(!Array.isArray(clients)||!clients.length||(!tripMode&&routeLocationMap.getZoom()<13))return;
    const markerLayer=!tripMode&&typeof L.markerClusterGroup==='function'?L.markerClusterGroup({maxClusterRadius:34,disableClusteringAtZoom:17,spiderfyOnMaxZoom:true,showCoverageOnHover:false,removeOutsideVisibleBounds:true,iconCreateFunction:(cluster)=>L.divIcon({html:`<div class="client-cluster">${cluster.getChildCount()}</div>`,className:'client-cluster-icon',iconSize:[30,30]})}):L.layerGroup();
    const radiusLayer=L.layerGroup();
    clients.forEach((client)=>{
      const lat=Number(client.latitude),lng=Number(client.longitude),radius=100;
      if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
      const tripColor=tripMode?(ROUTE_TRIP_STATE_COLORS[client.tripState]||'#2563eb'):'';
      const marker=tripMode?L.circleMarker([lat,lng],{radius:8,weight:2,color:'#ffffff',fillColor:tripColor,fillOpacity:.95}):L.circleMarker([lat,lng],{radius:4,weight:1.5,className:'route-client-marker'});
      const maps=clientMapsUrl(client);const popupId=`share-client-${String(client.id||client.code||Math.random()).replace(/[^A-Za-z0-9_-]/g,'')}`;
      const popup=`<div class="route-map-popup route-client-popup"><strong>${esc(routeClientLabel(client))}</strong><span>${esc(client.businessUnit||client.business_unit||'Cliente cadastrado')}</span>${client.code?`<small><strong>Código:</strong> ${esc(client.code)}</small>`:''}<small>${esc(client.address||'')}${client.neighborhood?` · ${esc(client.neighborhood)}`:''}</small><small>${esc(client.city||'')}${client.state?` / ${esc(client.state)}`:''}</small><small>${esc(`${formatNumber(lat,6)}, ${formatNumber(lng,6)}`)}</small><small>Raio operacional do DMS: ${esc(formatNumber(radius,0))} m</small><div class="route-client-popup-actions">${maps?`<a class="btn btn-ghost btn-sm" href="${esc(maps)}" target="_blank" rel="noopener">Abrir localização</a>`:''}<button class="btn btn-secondary btn-sm" id="${esc(popupId)}" type="button">Compartilhar</button></div></div>`;
      marker.bindTooltip(`${tripMode?`<small>${client.sequence!==null&&client.sequence!==undefined?`Seq. ${esc(client.sequence)} · `:''}${esc(client.tripState||'')}</small>`:''}<strong>${esc(routeClientLabel(client))}</strong><small>${esc(client.city||'')}${client.state?` · ${esc(client.state)}`:''}</small>`,{direction:'top',className:'fleet-tooltip'});
      marker.bindPopup(popup);marker.on('popupopen',()=>{setTimeout(()=>{const button=document.getElementById(popupId);if(button)button.onclick=()=>shareMonitoringClient(client);},0);});
      markerLayer.addLayer(marker);
      const radiusCircle=L.circle([lat,lng],{radius,weight:1,opacity:.4,fillOpacity:.05,className:'route-client-radius'});radiusCircle.bindPopup(popup);radiusCircle.on('popupopen',()=>{setTimeout(()=>{const button=document.getElementById(popupId);if(button)button.onclick=()=>shareMonitoringClient(client);},0);});radiusCircle.addTo(radiusLayer);
    });
    routeClientMarkerLayer=markerLayer;routeClientRadiusLayer=radiusLayer;
    markerLayer.addTo(routeLocationMap);
    if(routeLocationMap.getZoom()>=16)radiusLayer.addTo(routeLocationMap);
  }
  function scheduleRouteClientsLoad(){
    clearTimeout(routeClientLoadTimer);
    const requestId=++routeClientRequestId;
    routeClientLoadTimer=setTimeout(async()=>{
      if(!routeLocationMap)return;
      if(routeTripClients){renderRouteClients(routeTripClients.records,{tripMode:true});return;}
      const zoom=routeLocationMap.getZoom();
      if(zoom<13){renderRouteClients([]);return;}
      const bounds=routeLocationMap.getBounds();
      const bbox=[bounds.getSouth(),bounds.getWest(),bounds.getNorth(),bounds.getEast()].map((value)=>Number(value).toFixed(6)).join(',');
      try{
        const payload=await api(`/api/clients?bbox=${encodeURIComponent(bbox)}&zoom=${encodeURIComponent(zoom)}&limit=1200`,{connectionImpact:false});
        if(requestId!==routeClientRequestId||!routeLocationMap)return;
        renderRouteClients(Array.isArray(payload.records)?payload.records:[]);
      }catch(error){console.warn('Clientes no mapa indisponíveis',error?.message||error);}
    },240);
  }
  function routeClusterTone(cluster){
    const states=cluster.getAllChildMarkers().map((marker)=>marker.options.dmsState||'offline');
    if(states.includes('alert'))return 'alert';
    if(states.includes('stopped'))return 'stopped';
    if(states.includes('moving'))return 'moving';
    if(states.includes('backup'))return 'backup';
    return 'offline';
  }
  function renderRouteLocationMap(rows,{historyPlate='',historyPositions=[],historyRoadSegments=[],clients=[],onSelect=null,fit=true}={}){
    const mapNode=$('#route-location-map');if(!mapNode)return;
    if(routeLocationMap){try{routeLocationMap.remove();}catch{}routeLocationMap=null;}
    clearTimeout(routeClientLoadTimer);routeClientRequestId+=1;
    routeLocationMarkers=new Map();routeLocationCluster=null;routeClientMarkerLayer=null;routeClientRadiusLayer=null;
    if(!window.L){mapNode.innerHTML='<div class="empty-state"><strong>Mapa indisponível.</strong><p>A biblioteca do mapa não foi carregada.</p></div>';return;}
    // maxZoom fica explícito no próprio mapa porque o MarkerCluster consulta
    // map.getMaxZoom(). Camadas vetoriais MapLibre não propagam esse limite ao
    // Leaflet como uma L.TileLayer tradicional, o que causava
    // "Map has no maxZoom specified" na tentativa anterior.
    routeLocationMap=L.map(mapNode,{zoomControl:true,attributionControl:true,preferCanvas:true,minZoom:4,maxZoom:19}).setView([-8.30,-35.45],8);
    let baseMapLoaded=false;
    if(typeof L.maplibreGL==='function'&&window.maplibregl){
      try{
        L.maplibreGL({style:'https://tiles.openfreemap.org/styles/liberty',attributionControl:false}).addTo(routeLocationMap);
        routeLocationMap.attributionControl.addAttribution('<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>');
        baseMapLoaded=true;
      }catch(error){console.warn('Falha ao iniciar OpenFreeMap/MapLibre',error?.message||error);}
    }
    if(!baseMapLoaded){
      // Contingência apenas para manter a tela operacional caso MapLibre não carregue.
      // Usa o endpoint OSM atualmente documentado (sem subdomínios).
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).addTo(routeLocationMap);
    }
    const bounds=[];
    if(historyPlate){
      (historyRoadSegments||[]).forEach((segment)=>{const road=(segment||[]).filter((coords)=>Array.isArray(coords)&&coords.length===2&&Number.isFinite(Number(coords[0]))&&Number.isFinite(Number(coords[1]))).map(([lat,lng])=>[Number(lat),Number(lng)]);if(road.length>1){L.polyline(road,{weight:4,opacity:.82,className:'route-road-history-line'}).addTo(routeLocationMap);road.forEach((coords)=>bounds.push(coords));}});
      const displayPoints=routeHistoryDisplayPoints(historyPositions);
      displayPoints.forEach((pos,index)=>{const coords=routeGpsCoordinates(pos);if(!coords)return;bounds.push(coords);const isFirst=index===0,isLast=index===displayPoints.length-1;if(isLast){const state=Number(pos.ignition)===1&&Number(pos.speed||0)>=5?'moving':Number(pos.ignition)===1?'stopped':'offline';const marker=L.marker(coords,{icon:L.divIcon({className:'route-map-div-icon',html:routeFleetPinHtml(state,{ignition:pos.ignition,blink:state==='offline'}),iconSize:[30,34],iconAnchor:[15,34],popupAnchor:[0,-30]})}).addTo(routeLocationMap);marker.bindTooltip(`<strong>${esc(historyPlate)}</strong><small>Última posição</small>`,{direction:'top',className:'fleet-tooltip'});marker.bindPopup(routeHistoryPopup(historyPlate,pos,'Última posição'));}else{const marker=L.circleMarker(coords,{radius:isFirst?5:3.5,weight:2,color:'#fff',fillColor:isFirst?'#3478c8':'#56635c',opacity:.95,fillOpacity:.95}).addTo(routeLocationMap);marker.bindPopup(routeHistoryPopup(historyPlate,pos,isFirst?'Início do período':'Posição intermediária'));}});
    }else{
      const clusterOptions={maxClusterRadius:46,disableClusteringAtZoom:17,spiderfyOnMaxZoom:true,showCoverageOnHover:false,removeOutsideVisibleBounds:true,animate:true,iconCreateFunction:(cluster)=>{const state=routeClusterTone(cluster);return L.divIcon({html:`<div class="fleet-cluster is-${state}">${cluster.getChildCount()}</div>`,className:'fleet-cluster-icon',iconSize:[38,38]});}};
      routeLocationCluster=typeof L.markerClusterGroup==='function'?L.markerClusterGroup(clusterOptions):L.layerGroup();
      rows.forEach((row)=>{const coords=routeGpsCoordinates(row.pos);if(!coords)return;bounds.push(coords);const state=routeFleetState(row);const alert=routeFleetAlert(row);const marker=L.marker(coords,{dmsState:state,dmsPlate:row.plate,icon:L.divIcon({className:'route-map-div-icon',html:routeFleetPinHtml(state,{ignition:row.pos?.ignition,blink:Boolean(alert?.blink),alertKind:alert?.kind||''}),iconSize:[30,34],iconAnchor:[15,34],popupAnchor:[0,-30]})});marker.bindTooltip(`<strong>${esc(row.plate)}</strong><small>${esc(alert?.label||routeFleetStateLabel(state))} · ${row.pos?`${row.pos.speedReliable!==false?`${formatNumber(row.pos.speed||0)} km/h`:'Lincros'} · ${esc(routeGpsAge(row.pos.updatedAt))}`:'sem GPS'}</small>`,{direction:'top',offset:[0,-4],className:'fleet-tooltip',opacity:.98});marker.on('click',()=>onSelect?.(row));routeLocationCluster.addLayer(marker);routeLocationMarkers.set(row.plate,marker);});
      routeLocationCluster.addTo(routeLocationMap);
    }
    if(fit){if(bounds.length===1)routeLocationMap.setView(bounds[0],historyPlate?14:13);else if(bounds.length>1)routeLocationMap.fitBounds(bounds,{padding:[38,38],maxZoom:historyPlate?15:11});}
    routeLocationMap.on('moveend',scheduleRouteClientsLoad);
    routeLocationMap.on('zoomend',scheduleRouteClientsLoad);
    scheduleRouteClientsLoad();
    setTimeout(()=>routeLocationMap?.invalidateSize(),80);
  }

  async function renderLocations({force=false,preserveView=false}={}){
    clearInterval(state.routeGpsTimer);
    if(!preserveView)state.routeLocationClientFocus=null;
    routeTripClients=null;
    const savedMapView=preserveView&&routeLocationMap?{center:routeLocationMap.getCenter(),zoom:routeLocationMap.getZoom()}:null;
    const vehicles=await loadCatalog('vehicles',force).catch(()=>[]),ownVehicles=vehicles.filter(routeOwnVehicle),plates=ownVehicles.map((v)=>routePlate(v.placa||v.raw?.PLACA)).filter(Boolean);
    const gpsPath=`/api/protectsat?scope=route&view=latest&refresh=${force?'1':'0'}${force?'&force=1':''}${plates.length?`&plates=${encodeURIComponent(plates.join(','))}`:''}`;
    const [gpsResult,monitoringResult,lincrosResult]=await Promise.allSettled([api(gpsPath,{fresh:force,connectionImpact:false,navigationScoped:false}),hasRouteAccess('monitoring')?api('/api/monitoring?limit=5000'):Promise.resolve({records:[]}),api(`/api/lincros?view=active&sync=1${force?'&force=1':''}`,{fresh:true,connectionImpact:false,navigationScoped:false,timeoutMs:12000})]);
    const gps=gpsResult.status==='fulfilled'?(gpsResult.value||{}):{enabled:true,positions:[],clients:[],message:gpsResult.reason?.message||'Protect Sat indisponível.'};
    const lincrosPayload=lincrosResult.status==='fulfilled'?(lincrosResult.value||{}):{records:[],runtimeConfigured:false};
    const lincrosRuntimeReady=lincrosPayload.runtimeConfigured===true;
    let monitoring=monitoringResult.status==='fulfilled'?(monitoringResult.value.records||[]):[];
    if((gps.autoReturns||[]).length&&hasRouteAccess('monitoring')){
      try{monitoring=(await api('/api/monitoring?limit=5000',{fresh:true})).records||monitoring;}catch(error){console.warn('Monitoramento pós-retorno GPS indisponível',error?.message||error);}
    }
    const gpsPositions=Array.isArray(gps.positions)?gps.positions.filter((pos)=>pos&&typeof pos==='object'&&routePlate(pos.plate)):[],protectSource=(gps.degraded||/D1_CACHE|UNAVAILABLE/i.test(String(gps.mode||'')))?'PROTECTSAT_CACHE':'PROTECTSAT',posByPlate=new Map(gpsPositions.map((pos)=>{const source=String(pos.source||protectSource).toUpperCase();return [routePlate(pos.plate),{...pos,source,speedReliable:source==='LINCROS'?false:pos.speedReliable!==false,ignitionReliable:source==='LINCROS'?false:pos.ignitionReliable!==false}];})),lincrosByPlate=new Map();
    for(const item of lincrosRuntimeReady?(lincrosPayload.records||[]):[]){const plate=routePlate(item.plate),pos=lincrosPosition(item);if(!plate||!pos)continue;const previous=lincrosByPlate.get(plate);if(!previous||routePositionMs(pos)>routePositionMs(previous))lincrosByPlate.set(plate,pos);}
    const assignByPlate=new Map(Object.entries(gps.assignments||{}).map(([plate,item])=>[routePlate(plate),item])),monByPlate=new Map();
    monitoring.forEach((row)=>{const plate=routePlate(row.placa||row.schedule?.placa);if(!plate)return;const previous=monByPlate.get(plate);if(!previous||normalize(previous.status)==='FINALIZADO')monByPlate.set(plate,row);});
    const rows=ownVehicles.map((vehicle)=>{const plate=routePlate(vehicle.placa||vehicle.raw?.PLACA),pos=bestRoutePosition(posByPlate.get(plate)||null,lincrosByPlate.get(plate)||null),mon=monByPlate.get(plate)||null,assignment=assignByPlate.get(plate)||pos?.assignment||null;const display={motorista:assignment?.motorista||mon?.motorista||'',rota:assignment?.rota||mon?.rota||''};const row={plate,vehicle,pos,monitoring:mon,assignment,display,status:routeLocationStatus(mon,vehicle)};row.fleetState=routeFleetState(row);return row;});
    const clients=Array.isArray(gps.clients)?gps.clients:[];
    const moving=rows.filter((r)=>r.fleetState==='moving').length,stopped=rows.filter((r)=>r.fleetState==='stopped').length,backup=rows.filter((r)=>r.fleetState==='backup').length,alerts=rows.filter((r)=>r.fleetState==='alert').length,offline=rows.filter((r)=>r.fleetState==='offline').length;
    $('#page-content').innerHTML=`
      <div class="page-intro"><div><span class="eyebrow">CENTRAL DE FROTA · PROTECT SAT</span><h3>Última localização</h3><p>Visão operacional da frota própria com status, telemetria e histórico sincronizados ao mapa.</p>${gps.aviso?`<div class="helper-text"><strong>${gps.degraded?'Contingência GPS':'GPS'}:</strong> ${esc(gps.aviso)}</div>`:gps.degraded?`<div class="helper-text"><strong>Contingência GPS:</strong> Exibindo a última posição válida armazenada.</div>`:!gpsPositions.length?`<div class="helper-text"><strong>GPS:</strong> Nenhuma posição foi recebida. ${esc(gps.message||gps.refreshError||'Use Atualizar posições para forçar uma nova consulta.')}</div>`:''}${Array.isArray(gps.syncWarnings)&&gps.syncWarnings.length?`<div class="helper-text"><strong>Diagnóstico:</strong> ${esc(gps.syncWarnings[0])}</div>`:''}${!gpsPositions.length&&gps.cacheMeta?`<div class="helper-text"><strong>Cache GPS:</strong> ${formatNumber(gps.cacheMeta.plateCount||0)} placa(s) · última sincronização ${esc(gps.cacheMeta.lastFetchedAt||'não registrada')}${gps.refreshError?` · erro: ${esc(gps.refreshError)}`:''}</div>`:''}</div><div class="page-intro-actions"><button class="btn btn-ghost" id="route-location-export">Exportar CSV</button><button class="btn btn-primary" id="route-location-refresh">Atualizar posições</button></div></div>
      <div class="cards-grid route-location-kpis">${metric('Total rastreado',rows.length,'Veículos próprios ativos','info')}${metric('Em movimento',moving,'Ignição ligada e deslocamento','success')}${metric('Parados',stopped,'Ignição ligada sem deslocamento','warning')}${metric('Alertas / redundância',alerts+offline+backup,`${alerts} alerta(s) · ${offline} offline · ${backup} via Lincros`,'danger')}</div>
      <section class="fleet-console">
        <div class="fleet-map-shell"><div id="route-location-map" class="route-location-map" aria-label="Mapa operacional da frota"></div><div class="fleet-map-toolbar"><button class="btn btn-secondary btn-sm" id="fleet-fit">Enquadrar frota</button><button class="btn btn-secondary btn-sm is-hidden" id="fleet-history-close">Voltar à frota</button></div><div id="fleet-trip-banner" class="fleet-trip-banner is-hidden" aria-live="polite"></div><div class="fleet-map-legend" aria-label="Legenda do mapa"><strong>Legenda</strong><span><i class="fleet-legend-dot is-moving"></i>Em movimento</span><span><i class="fleet-legend-dot is-stopped"></i>Parado</span><span><i class="fleet-legend-dot is-alert"></i>Alerta operacional</span><span><i class="fleet-legend-dot is-offline"></i>Sem posição / offline</span><span><i class="fleet-legend-dot is-backup"></i>Redundância Lincros</span><span><i class="fleet-legend-client"></i>Cliente</span></div><div class="fleet-map-update" id="fleet-map-update">Atualização automática a cada 5 min</div></div>
        <aside class="fleet-panel"><div class="fleet-panel-head"><div class="fleet-panel-title"><strong>Frota</strong><span id="fleet-count">${rows.length} veículo(s)</span></div><div class="fleet-filters"><input id="route-location-search" class="filter-control" placeholder="Buscar placa, motorista ou rota"><select id="route-location-state" class="filter-control"><option value="">Todos</option><option value="moving">Em movimento</option><option value="stopped">Parados</option><option value="alert">Alertas</option><option value="offline">Offline</option><option value="backup">Redundância Lincros</option></select></div><div class="fleet-client-search"><input id="route-location-client" class="filter-control" placeholder="Buscar cliente por código ou nome" autocomplete="off" aria-label="Buscar cliente por código ou nome"><div id="route-location-client-results" class="fleet-client-results is-hidden" role="listbox"></div><div id="route-location-client-chip" class="fleet-client-chip is-hidden"></div></div></div><div id="fleet-list" class="fleet-list"></div></aside>
        <aside id="fleet-drawer" class="fleet-drawer is-hidden" aria-live="polite"><div class="fleet-drawer-head"><strong id="fleet-drawer-plate">Veículo</strong><button class="icon-button" id="fleet-drawer-close" type="button">×</button></div><div class="fleet-drawer-body" id="fleet-drawer-body"></div></aside>
      </section>`;
    let displayed=[...rows],selectedPlate='',historyPlate='',historyPositions=[],historyRoadSegments=[];
    let clientFocus=state.routeLocationClientFocus||null,clientFocusLayer=null,clientSearchTimer=null,clientSearchSeq=0,clientResultList=[];
    const drawer=$('#fleet-drawer');
    const rowByPlate=(plate)=>rows.find((r)=>r.plate===routePlate(plate));
    const drawerHtml=(row)=>{const nearby=routeNearbyClients(row.pos),alert=routeFleetAlert(row);return `<div class="fleet-detail-status"><span class="fleet-status-dot is-${row.fleetState}"></span>${badge(alert?.label||routeFleetStateLabel(row.fleetState))}</div>${alert?`<div class="fleet-alert-box is-${alert.level}"><strong>${esc(alert.label)}</strong><span>${esc(alert.detail)}</span><small>Ignição: ${row.pos?(Number(row.pos.ignition)===1?'ligada':'desligada'):'sem informação'}</small></div>`:''}<div class="fleet-detail-grid"><div class="fleet-detail-stat"><span>Velocidade</span><strong>${row.pos&&row.pos.speedReliable!==false?`${formatNumber(row.pos.speed||0)} km/h`:'—'}</strong></div><div class="fleet-detail-stat"><span>Ignição</span><strong>${row.pos&&row.pos.ignitionReliable!==false?(Number(row.pos.ignition)===1?'Ligada':'Desligada'):'—'}</strong></div><div class="fleet-detail-stat"><span>Motorista</span><strong>${esc(row.display?.motorista||'Não informado')}</strong></div><div class="fleet-detail-stat"><span>Rota</span><strong>${esc(row.display?.rota||'Sem escala atribuída')}</strong></div></div><div class="fleet-detail-section"><span>Última posição</span><strong>${esc(row.pos?.point||row.pos?.location||row.vehicle.local_atual||'Localização não informada')}</strong><p>${row.pos?`${esc(routeGpsAge(row.pos.updatedAt))} · GPS ${esc(row.pos.updatedAt||'')}${Number.isFinite(Number(row.pos.apiFetchAgeMinutes))?` · API há ${esc(formatNumber(Number(row.pos.apiFetchAgeMinutes),0))} min`:''} · fonte ${esc(row.pos.source==='PROTECTSAT_CACHE'?'ProtectSat · última posição salva':row.pos.source||row.pos.timestampSource||'GPS')}`:'Sem posição GPS recebida'}</p></div>${nearby.length?`<div class="fleet-detail-section fleet-detail-nearby"><span>${nearby.length>1?'Clientes próximos':'Cliente próximo'}</span>${routeNearbyClientListHtml(row.pos)}</div>`:''}<div class="fleet-detail-actions"><button class="btn btn-secondary" id="fleet-detail-center" type="button">Centralizar</button><button class="btn btn-primary" id="fleet-detail-history" type="button" ${row.pos?'':'disabled'}>Últimas 24h</button></div>`;};
    const focusPlate=(plate)=>{const marker=routeLocationMarkers.get(routePlate(plate));if(!marker||!routeLocationMap)return;const focus=()=>{routeLocationMap.setView(marker.getLatLng(),15,{animate:true});marker.openTooltip();};if(routeLocationCluster?.zoomToShowLayer)routeLocationCluster.zoomToShowLayer(marker,focus);else focus();};
    const selectVehicle=(row)=>{if(!row)return;selectedPlate=row.plate;$$('.fleet-card').forEach((el)=>el.classList.toggle('is-selected',el.dataset.plate===row.plate));$('#fleet-drawer-plate').textContent=row.plate;$('#fleet-drawer-body').innerHTML=drawerHtml(row);drawer.classList.remove('is-hidden');$('#fleet-detail-center').onclick=()=>focusPlate(row.plate);$('#fleet-detail-history').onclick=()=>openHistory(row.plate);focusPlate(row.plate);syncTripClients();};
    const renderList=()=>{const q=normalize($('#route-location-search').value),stateFilter=$('#route-location-state').value;displayed=rows.filter((row)=>{if(stateFilter&&row.fleetState!==stateFilter)return false;if(clientFocus?.plates?.length&&!clientFocus.plates.includes(row.plate))return false;const hay=normalize(`${row.plate} ${row.display?.motorista||''} ${row.display?.rota||''} ${row.pos?.point||row.pos?.location||''}`);return !q||hay.includes(q);});$('#fleet-count').textContent=`${displayed.length} veículo(s)`;syncTripClients();$('#fleet-list').innerHTML=displayed.length?displayed.map((row)=>`<button class="fleet-card ${row.pos?'':'fleet-no-position'} ${selectedPlate===row.plate?'is-selected':''}" data-plate="${esc(row.plate)}" type="button"><span class="fleet-status-dot is-${row.fleetState}"></span><span class="fleet-card-main"><span class="fleet-card-line"><strong>${esc(row.plate)}</strong><span class="fleet-card-speed">${row.pos?(row.pos.speedReliable!==false?`${formatNumber(row.pos.speed||0)} km/h`:'Lincros'):'Sem GPS'}</span></span><span class="fleet-card-driver">${esc(row.display?.motorista||'Motorista não informado')}</span><span class="fleet-card-meta"><span>${esc(row.display?.rota||(routeFleetAlert(row)?.label||routeFleetStateLabel(row.fleetState)))}</span><span>${row.pos?esc(routeGpsAge(row.pos.updatedAt)):'sem posição'}</span></span></span></button>`).join(''):'<div class="empty-state"><strong>Nenhum veículo encontrado</strong><p>Ajuste os filtros para visualizar a frota.</p></div>';$$('.fleet-card').forEach((el)=>el.onclick=()=>selectVehicle(rowByPlate(el.dataset.plate)));};
    const drawMap=({fit=false,restoreView=null}={})=>{renderRouteLocationMap(displayed,{historyPlate,historyPositions,historyRoadSegments,clients,onSelect:selectVehicle,fit});paintClientFocus();if(restoreView&&!historyPlate&&routeLocationMap){setTimeout(()=>{try{routeLocationMap.setView(restoreView.center,restoreView.zoom,{animate:false});}catch{}},0);}$('#fleet-history-close').classList.toggle('is-hidden',!historyPlate);};
    const openHistory=async(plate)=>{const payload=await api(`/api/protectsat?scope=route&view=history&plate=${encodeURIComponent(routePlate(plate))}&hours=24`);historyPlate=routePlate(plate);historyPositions=Array.isArray(payload.positions)?payload.positions:[];historyRoadSegments=[];if(historyPositions.length>1){try{const road=await api('/api/route-path',{method:'POST',body:JSON.stringify({positions:historyPositions}),connectionImpact:false});historyRoadSegments=Array.isArray(road.segments)?road.segments:[];}catch(error){console.warn('Trajeto viário indisponível',error?.message||error);}}drawer.classList.add('is-hidden');drawMap({fit:true});$('#fleet-map-update').textContent=historyRoadSegments.length?'Histórico de 24h ajustado às estradas':'Histórico de 24h · pontos GPS';};
    const clearHistory=()=>{historyPlate='';historyPositions=[];historyRoadSegments=[];$('#fleet-map-update').textContent='Atualização automática a cada 5 min';drawMap({fit:true});};
    // Busca de cliente (código ou nome): marca o cliente no mapa e, quando há entrega
    // pendente em rota atual, filtra a frota pelos veículos que o atendem.
    const clientCoords=(client)=>{const lat=Number(client?.latitude),lng=Number(client?.longitude);return Number.isFinite(lat)&&Number.isFinite(lng)&&client?.latitude!==null&&client?.longitude!==null&&client?.latitude!==''&&client?.longitude!==''?[lat,lng]:null;};
    const clientPendingPlates=(client)=>[...new Set(((client?.deliveryInfo||{}).currentPending||[]).map((item)=>routePlate(item.plate)).filter(Boolean))];
    function paintClientFocus(){
      if(clientFocusLayer){try{clientFocusLayer.remove();}catch{}clientFocusLayer=null;}
      const coords=clientCoords(clientFocus);if(!coords||!routeLocationMap||!window.L)return;
      clientFocusLayer=L.layerGroup([
        L.circle(coords,{radius:Number(clientFocus.radiusMeters)||100,color:'#d97706',weight:2,fillColor:'#f59e0b',fillOpacity:.15,interactive:false}),
        L.circleMarker(coords,{radius:9,color:'#ffffff',weight:2,fillColor:'#d97706',fillOpacity:1}).bindTooltip(`${clientFocus.code||''} · ${clientFocus.name||''}`,{permanent:true,direction:'top',offset:[0,-8]}),
      ]).addTo(routeLocationMap);
    }
    const hideClientResults=()=>{clientResultList=[];const box=$('#route-location-client-results');if(box){box.classList.add('is-hidden');box.innerHTML='';}};
    const renderClientChip=()=>{
      const chip=$('#route-location-client-chip');if(!chip)return;
      if(!clientFocus){chip.classList.add('is-hidden');chip.innerHTML='';return;}
      const info=clientFocus.deliveryInfo||{},last=info.lastDelivered||null,plates=clientFocus.plates||[];
      const detail=plates.length?`Entrega pendente em: ${plates.join(', ')}`:(last?`Sem pendência. Última entrega: ${last.date?formatDate(last.date):'—'} · ${last.route||'—'} · ${last.plate||'—'}`:'Sem entrega pendente nem histórico sincronizado');
      chip.classList.remove('is-hidden');
      chip.innerHTML=`<div><strong>${esc(clientFocus.code||'—')} · ${esc(clientFocus.name||'—')}</strong><small>${esc([clientFocus.city,clientFocus.state].filter(Boolean).join(' / '))}</small><small>${esc(detail)}</small>${clientCoords(clientFocus)?'':'<small>Cliente sem coordenadas cadastradas.</small>'}</div><button type="button" class="icon-button" id="route-location-client-clear" aria-label="Limpar cliente">×</button>`;
      $('#route-location-client-clear').onclick=()=>setClientFocus(null);
    };
    function setClientFocus(client){
      clientFocus=client?{code:client.code||client.businessCode||'',name:client.name||'',city:client.city||'',state:client.state||'',latitude:client.latitude,longitude:client.longitude,radiusMeters:client.radiusMeters,deliveryInfo:client.deliveryInfo||{},plates:clientPendingPlates(client)}:null;
      state.routeLocationClientFocus=clientFocus;
      hideClientResults();renderClientChip();renderList();
      drawMap({fit:!clientCoords(clientFocus)});
      const coords=clientCoords(clientFocus);
      if(coords&&routeLocationMap)routeLocationMap.setView(coords,16,{animate:true});
      else if(clientFocus)toast('Cliente sem coordenadas cadastradas; filtrando apenas pelos veículos da entrega.','warning');
    }
    const searchClients=async()=>{
      const q=$('#route-location-client').value.trim(),box=$('#route-location-client-results'),seq=++clientSearchSeq;
      if(q.length<2){hideClientResults();return;}
      box.classList.remove('is-hidden');box.innerHTML='<div class="fleet-client-empty">Buscando...</div>';
      try{
        const payload=await api(`/api/clients?q=${encodeURIComponent(q)}&limit=8`,{connectionImpact:false,navigationScoped:false});
        if(seq!==clientSearchSeq)return;
        clientResultList=payload.records||[];
        box.innerHTML=clientResultList.length?clientResultList.map((client,index)=>`<button type="button" class="fleet-client-option" data-client-index="${index}" role="option"><strong>${esc(client.code||client.businessCode||'—')}</strong><span>${esc(client.name||'—')}</span><small>${esc([client.city,client.state].filter(Boolean).join(' / '))}</small></button>`).join(''):'<div class="fleet-client-empty">Nenhum cliente encontrado.</div>';
        $$('[data-client-index]',box).forEach((button)=>button.onclick=()=>setClientFocus(clientResultList[Number(button.dataset.clientIndex)]));
      }catch(error){if(seq===clientSearchSeq)box.innerHTML=`<div class="fleet-client-empty">${esc(error.message||'Falha ao buscar clientes.')}</div>`;}
    };
    // Veículo em rota (selecionado ou filtrado até sobrar um): o mapa mostra somente os
    // clientes da viagem dele, coloridos pela situação da entrega.
    let tripPlate='',tripSeq=0,tripDismissed='';
    const tripCache=state.routeTripCache||(state.routeTripCache=new Map());
    const renderTripBanner=(message='')=>{
      const node=$('#fleet-trip-banner');if(!node)return;
      const data=routeTripClients;
      if(!data&&!message){node.classList.add('is-hidden');node.innerHTML='';return;}
      node.classList.remove('is-hidden');
      const summary=data?.resumo||{};
      node.innerHTML=data&&data.entregas?`<strong>${esc(data.trip?.plate||tripPlate)} · ${esc(data.trip?.route||'Rota')}</strong><span>${formatNumber(data.entregas||0)} cliente(s): <i class="trip-dot is-entregue"></i>${summary.entregues||0} entregue(s) <i class="trip-dot is-pendente"></i>${summary.pendentes||0} pendente(s) <i class="trip-dot is-devolvido"></i>${summary.devolvidos||0} devolvido(s)</span>${data.semCoordenadas?`<small>${data.semCoordenadas} sem localização cadastrada.</small>`:''}<button type="button" class="btn btn-secondary btn-sm" id="fleet-trip-clear">Mostrar todos os clientes</button>`:`<span>${esc(message)}</span>${data?'<button type="button" class="btn btn-secondary btn-sm" id="fleet-trip-clear">Mostrar todos os clientes</button>':''}`;
      $('#fleet-trip-clear')?.addEventListener('click',()=>{tripDismissed=tripPlate;clearTripClients();});
    };
    function clearTripClients(){tripSeq+=1;tripPlate='';routeTripClients=null;renderTripBanner();scheduleRouteClientsLoad();}
    async function showTripClients(plate){
      const seq=++tripSeq;tripPlate=plate;
      if(routeTripClients&&String(routeTripClients.trip?.plate||'')!==plate){routeTripClients=null;renderTripBanner();scheduleRouteClientsLoad();}
      let cached=tripCache.get(plate);
      if(!cached||Date.now()-cached.at>60000){
        const row=rowByPlate(plate),mon=row?.monitoring||{};
        const hints=[...new Set([row?.assignment?.scheduleId,mon.schedule_record_id,mon.schedule_id,mon.escala_id].map((x)=>String(x||'').trim()).filter(Boolean))];
        try{cached={at:Date.now(),data:await api(`/api/clients?plate=${encodeURIComponent(plate)}${hints.length?`&schedule=${encodeURIComponent(hints.join(','))}`:''}`,{connectionImpact:false,navigationScoped:false})};tripCache.set(plate,cached);}
        catch(error){if(seq===tripSeq){routeTripClients=null;renderTripBanner();scheduleRouteClientsLoad();}return;}
      }
      if(seq!==tripSeq)return;
      const data=cached.data||{};
      // Carro em rota sem lista de entregas da Lincros: mostra nenhum cliente (nunca a
      // cidade inteira) e explica no quadro.
      const row=rowByPlate(plate),inRoute=Boolean(row?.assignment||(row?.monitoring&&normalize(row.monitoring.status||'')!=='FINALIZADO'));
      if(!data.trip&&!inRoute){routeTripClients=null;renderTripBanner();scheduleRouteClientsLoad();return;}
      routeTripClients=data.trip?data:{records:[],entregas:0,trip:{plate,route:row?.display?.rota||''}};
      renderTripBanner(data.entregas?'':`${plate}${row?.display?.rota?` · ${row.display.rota}`:''}: sem lista de clientes da Lincros para esta placa.`);scheduleRouteClientsLoad();
      const coords=(data.records||[]).map((client)=>[Number(client.latitude),Number(client.longitude)]).filter(([lat,lng])=>Number.isFinite(lat)&&Number.isFinite(lng));
      const vehicle=routeGpsCoordinates(rowByPlate(plate)?.pos);if(vehicle)coords.push(vehicle);
      if(coords.length&&routeLocationMap&&!historyPlate)routeLocationMap.fitBounds(coords,{padding:[44,44],maxZoom:14,animate:true});
    }
    function syncTripClients(){
      if(historyPlate)return;
      const filtering=Boolean($('#route-location-search')?.value.trim()||$('#route-location-state')?.value||clientFocus);
      const target=selectedPlate||(filtering&&displayed.length===1?displayed[0].plate:'');
      if(tripDismissed&&target!==tripDismissed)tripDismissed='';
      if(target===tripPlate)return;
      if(!target){clearTripClients();return;}
      if(target===tripDismissed)return;
      showTripClients(target);
    }
    renderList();renderClientChip();drawMap({fit:!savedMapView&&!clientCoords(clientFocus),restoreView:savedMapView});
    $('#route-location-search').oninput=()=>{const view=routeLocationMap?{center:routeLocationMap.getCenter(),zoom:routeLocationMap.getZoom()}:null;renderList();if(!historyPlate)drawMap({fit:false,restoreView:view});};
    $('#route-location-state').onchange=$('#route-location-search').oninput;
    $('#route-location-client').oninput=()=>{clearTimeout(clientSearchTimer);clientSearchTimer=setTimeout(searchClients,350);};
    $('#route-location-client').onkeydown=(event)=>{if(event.key==='Enter'){event.preventDefault();clearTimeout(clientSearchTimer);if(clientResultList.length===1)setClientFocus(clientResultList[0]);else searchClients();}else if(event.key==='Escape')hideClientResults();};
    if(state.routeClientOutsideHandler)document.removeEventListener('click',state.routeClientOutsideHandler,true);
    state.routeClientOutsideHandler=(event)=>{if(!event.target.closest?.('.fleet-client-search'))hideClientResults();};
    document.addEventListener('click',state.routeClientOutsideHandler,true);
    $('#fleet-drawer-close').onclick=()=>{drawer.classList.add('is-hidden');selectedPlate='';$$('.fleet-card').forEach((el)=>el.classList.remove('is-selected'));syncTripClients();};
    $('#fleet-fit').onclick=()=>drawMap({fit:true});
    $('#fleet-history-close').onclick=clearHistory;
    $('#route-location-refresh').onclick=()=>renderLocations({force:true,preserveView:true});
    $('#route-location-export').onclick=()=>exportCsv(rows.map((row)=>({placa:row.plate,status:routeFleetAlert(row)?.label||routeFleetStateLabel(row.fleetState),alerta:routeFleetAlert(row)?.detail||'',rota:row.display?.rota||'',motorista:row.display?.motorista||'',escala_id:row.assignment?.scheduleId||'',data_escala:row.assignment?.date||'',localizacao:row.pos?.point||row.pos?.location||'',atualizado_em:row.pos?.updatedAt||'',fonte_gps:row.pos?.source||'',velocidade_kmh:row.pos?.speedReliable===false?'':(row.pos?.speed??''),ignicao:row.pos?.ignitionReliable===false?'':(row.pos?Number(row.pos.ignition)===1?'LIGADA':'DESLIGADA':'')})),`ultima_localizacao_rota_${today()}.csv`);
    state.routeGpsTimer=setInterval(()=>{if(state.currentBase==='route'&&state.route==='route_location'&&!historyPlate)renderLocations({force:false,preserveView:true}).catch((error)=>console.error(error));},5*60*1000);
  }

  async function renderClients(){
    $('#page-content').innerHTML=`<div class="page-intro"><div><span class="eyebrow">OPERAÇÃO · CLIENTES</span><h3>Consultar clientes</h3><p>Pesquise qualquer cliente da base por código, nome, cidade ou endereço. A consulta também mostra entregas pendentes da rota atual e o histórico recente sincronizado da Lincros.</p></div></div>
      <section class="panel"><div class="panel-header"><div><h3>Consulta</h3><p class="helper-text">Digite pelo menos 2 caracteres. As informações de entrega são lidas do D1 e não dependem de uma chamada à Lincros para abrir esta tela.</p></div><div class="toolbar-group"><input id="route-client-search" class="filter-control" style="min-width:320px" placeholder="Código, nome, cidade ou endereço"><button class="btn btn-primary" id="route-client-search-button"><i data-lucide="search"></i><span>Pesquisar</span></button></div></div><div class="panel-body"><div id="route-client-results"><div class="empty-state">Digite um cliente para iniciar a consulta.</div></div></div></section>`;
    const host=$('#route-client-results');let records=[];
    const infoOf=(client)=>client?.deliveryInfo||{};
    const refText=(item={})=>{const parts=[];if(item.ocs)parts.push(`OC ${item.ocs}`);if(Array.isArray(item.invoices)&&item.invoices.length)parts.push(`NF ${item.invoices.join(' / ')}`);return parts.join(' · ')||'Sem OC/NF vinculada';};
    const clientDeliverySummary=(client)=>{const info=infoOf(client),pending=Array.isArray(info.currentPending)?info.currentPending:[],last=info.lastDelivered||null;if(pending.length){const item=pending[0];return `<div class="return-change-cell"><span class="badge badge-warning">PENDENTE NA ROTA ATUAL</span><strong>${esc(item.route||'Rota')}</strong><small class="muted">${item.date?esc(formatDate(item.date)):'—'} · ${esc(item.plate||'—')}${pending.length>1?` · +${pending.length-1} pend.`:''}</small></div>`;}if(last){return `<div class="return-change-cell"><span class="badge badge-success">${last.isCurrentRoute?'ENTREGUE NA ROTA ATUAL':'ÚLTIMA ENTREGA'}</span><strong>${esc(last.route||'Rota')}</strong><small class="muted">${last.date?esc(formatDate(last.date)):'—'} · ${esc(last.plate||'—')}</small></div>`;}return '<span class="muted">Sem histórico Lincros sincronizado</span>';};
    const deliveryTable=(items=[],title='Entregas')=>`<section class="panel"><div class="panel-header"><div><h3>${esc(title)}</h3><p class="helper-text">${items.length} registro(s)</p></div></div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Rota / placa</th><th>Sequência</th><th>Status</th><th>OC / NF</th><th>Chegada</th><th>Saída</th><th>Retenção</th><th>Dist. planejada</th><th>Dist. real</th><th></th></tr></thead><tbody>${items.map((item)=>`<tr><td>${item.date?esc(formatDate(item.date)):'—'}</td><td><strong>${esc(item.route||'—')}</strong><small class="muted">${esc(item.plate||'—')}${item.driver?` · ${esc(item.driver)}`:''}</small></td><td>${item.sequencePlanned??'—'}${item.sequenceActual!==null&&item.sequenceActual!==undefined?` → ${esc(item.sequenceActual)}`:''}</td><td>${badge(item.status||item.routeStatus||'—')}</td><td>${esc(refText(item))}</td><td>${item.arrivedAt?esc(auditDt(item.arrivedAt)):'—'}</td><td>${item.leftAt?esc(auditDt(item.leftAt)):'—'}</td><td>${Number.isFinite(Number(item.retentionMinutes))?esc(formatMinutes(Number(item.retentionMinutes))):'—'}</td><td>${esc(lincrosDistanceText(item.distancePlanned))}</td><td>${esc(lincrosDistanceText(item.distanceActual))}</td><td>${item.proofUrl?`<a class="btn btn-ghost btn-sm" href="${esc(item.proofUrl)}" target="_blank" rel="noopener">Comprovante</a>`:'—'}</td></tr>`).join('')||'<tr><td colspan="11" class="muted">Sem registros.</td></tr>'}</tbody></table></div></div></section>`;
    const openDeliveryDetails=(client)=>{const info=infoOf(client),pending=Array.isArray(info.currentPending)?info.currentPending:[],recent=Array.isArray(info.recentDelivered)?info.recentDelivered:[],last=info.lastDelivered||null;const lastHtml=last?`<div class="fleet-detail-grid"><div class="fleet-detail-stat"><span>Última entrega</span><strong>${last.date?esc(formatDate(last.date)):'—'}</strong></div><div class="fleet-detail-stat"><span>Rota / placa</span><strong>${esc(last.route||'—')} · ${esc(last.plate||'—')}</strong></div><div class="fleet-detail-stat"><span>Chegada</span><strong>${last.arrivedAt?esc(auditDt(last.arrivedAt)):'—'}</strong></div><div class="fleet-detail-stat"><span>Saída</span><strong>${last.leftAt?esc(auditDt(last.leftAt)):'—'}</strong></div><div class="fleet-detail-stat"><span>Retenção</span><strong>${Number.isFinite(Number(last.retentionMinutes))?esc(formatMinutes(Number(last.retentionMinutes))):'—'}</strong></div><div class="fleet-detail-stat"><span>OC / NF</span><strong>${esc(refText(last))}</strong></div></div>`:'<div class="empty-state">Nenhuma entrega realizada sincronizada para este cliente.</div>';modal({title:`Entregas · ${client.name||client.code||'Cliente'}`,confirmText:'Fechar',body:`<div class="info-box"><strong>Dados Lincros armazenados no D1.</strong> A consulta do cliente não chama a API externa; ela mostra o último estado sincronizado das rotas.</div>${pending.length?deliveryTable(pending,'Entrega pendente na rota atual'):'<div class="info-box">Este cliente não possui entrega pendente nas rotas atualmente abertas no DMS.</div>'}<section class="panel"><div class="panel-header"><div><h3>Última entrega realizada</h3><p class="helper-text">Registro mais recente encontrado para o cliente.</p></div></div><div class="panel-body">${lastHtml}</div></section>${recent.length?deliveryTable(recent,'Histórico recente de entregas realizadas'):''}`});refreshIcons();};
    const draw=()=>{host.innerHTML=records.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Código</th><th>Cliente</th><th>Cidade / UF</th><th>Endereço</th><th>Unidade</th><th>Situação da entrega</th><th>Localização</th><th>Ação</th></tr></thead><tbody>${records.map((client,i)=>{const hasCoords=Number.isFinite(Number(client.latitude))&&Number.isFinite(Number(client.longitude));const info=infoOf(client),hasDelivery=(info.currentPending?.length||info.lastDelivered);return `<tr><td><strong>${esc(client.code||client.businessCode||'—')}</strong></td><td><strong>${esc(client.name||'—')}</strong></td><td>${esc([client.city,client.state].filter(Boolean).join(' / ')||'—')}</td><td>${esc([client.address,client.neighborhood].filter(Boolean).join(' · ')||'—')}</td><td>${esc(client.businessUnit||'—')}</td><td>${clientDeliverySummary(client)}</td><td>${hasCoords?`${esc(Number(client.latitude).toFixed(6))}, ${esc(Number(client.longitude).toFixed(6))}`:'Endereço cadastrado'}</td><td><div class="card-actions">${hasDelivery?`<button class="btn btn-primary btn-sm" data-route-client-delivery="${i}" type="button"><i data-lucide="truck"></i><span>Entregas</span></button>`:''}<button class="btn btn-secondary btn-sm" data-route-client-share="${i}" type="button"><i data-lucide="share-2"></i><span>Compartilhar</span></button>${clientMapsUrl(client)?`<button class="btn btn-ghost btn-sm" data-route-client-map="${i}" type="button"><i data-lucide="map-pinned"></i><span>Abrir mapa</span></button>`:''}</div></td></tr>`;}).join('')}</tbody></table></div>`:'<div class="empty-state">Nenhum cliente encontrado para a busca.</div>';$$('[data-route-client-delivery]',host).forEach((button)=>button.onclick=()=>openDeliveryDetails(records[Number(button.dataset.routeClientDelivery)]));$$('[data-route-client-share]',host).forEach((button)=>button.onclick=()=>shareMonitoringClient(records[Number(button.dataset.routeClientShare)]));$$('[data-route-client-map]',host).forEach((button)=>button.onclick=()=>{const url=clientMapsUrl(records[Number(button.dataset.routeClientMap)]);if(url)window.open(url,'_blank','noopener');});refreshIcons();};
    const search=async()=>{const q=$('#route-client-search').value.trim();if(q.length<2){toast('Digite pelo menos 2 caracteres para pesquisar.','warning');$('#route-client-search').focus();return;}host.innerHTML='<div class="page-load-state"><div class="spinner"></div><strong>Consultando clientes e histórico de entregas...</strong></div>';const payload=await api(`/api/clients?q=${encodeURIComponent(q)}&limit=200`,{fresh:true,connectionImpact:false});records=payload.records||[];draw();};
    $('#route-client-search-button').onclick=()=>search().catch((error)=>{host.innerHTML=`<div class="danger-box">${esc(error.message||String(error))}</div>`;});$('#route-client-search').addEventListener('keydown',(event)=>{if(event.key==='Enter'){event.preventDefault();$('#route-client-search-button').click();}});refreshIcons();
  }


  // ===== Folgas (Gestão > Folgas) =====
  async function renderSettings() {
    const p=await api('/api/route-settings');const values=p.values||{},desc=p.descriptions||{};const keys=Object.keys(values);
    $('#page-content').innerHTML=`<div class="page-intro"><div><span class="eyebrow">CONFIGURAÇÕES · VERSÃO 1 - DMS ROTA</span><h3>Parâmetros da Rota</h3><p>Parâmetros operacionais usados pelas mesmas regras da v2.0.44.</p></div><div class="page-intro-actions">${canWrite()?'<button class="btn btn-primary" id="route-settings-save">Salvar parâmetros</button>':''}</div></div>${!p.storageReady?'<div class="warning-box"><strong>CONFIGURACOES não está disponível no D1 atual.</strong> Os valores padrão estão visíveis somente para conferência. Nenhuma migration foi criada automaticamente.</div>':''}<section class="panel"><div class="panel-body"><div class="form-grid">${keys.map((key)=>{const isTime=key.startsWith('HORA_'),isCajuDay=key.startsWith('CAJU_DIA_'),isText=key==='CAJU_ROTAS_VALOR_ESPECIAL';return `<label class="field"><span>${esc(key)}</span><input data-route-setting="${esc(key)}" type="${isTime?'time':isText?'text':'number'}" ${isTime||isText?'':isCajuDay?'min="1" max="31" step="1"':'min="0" step="1"'} value="${esc(values[key])}" ${!canWrite()||!p.storageReady?'disabled':''}><small>${esc(desc[key]||'')}</small></label>`;}).join('')}</div></div></section>`;
    $('#route-settings-save')?.addEventListener('click',async()=>{const out={};$$('[data-route-setting]').forEach((x)=>out[x.dataset.routeSetting]=x.value);await api('/api/route-settings',{method:'PUT',body:JSON.stringify({values:out,requestId:crypto.randomUUID()})});toast('Parâmetros atualizados.');await renderSettings();});
  }

  return {renderDashboard,renderSummary,renderSchedule,renderReturns,renderMonitoring,renderLocations,renderClients,renderIndicators,renderManagementData,renderSettings};
})();
