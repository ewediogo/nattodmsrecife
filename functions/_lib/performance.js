const PERFORMANCE_INDEXES=[
  {name:'IDX_ROUTE_ESCALA_DATA_PLATE_STATUS',table:'ESCALAS_DIA',sql:'CREATE INDEX IF NOT EXISTS IDX_ROUTE_ESCALA_DATA_PLATE_STATUS ON ESCALAS_DIA(DATA,PLACA,STATUS,ID)'},
  {name:'IDX_ROUTE_RECORD_SCHEDULE_DATE_ID',table:'ROUTE_RECORDS',sql:"CREATE INDEX IF NOT EXISTS IDX_ROUTE_RECORD_SCHEDULE_DATE_ID ON ROUTE_RECORDS(MODULE,DATE_KEY,ID)"},
  {name:'IDX_ROUTE_DEPARTURE_DATE_PLATE_STATUS',table:'ROUTE_DEPARTURES',sql:'CREATE INDEX IF NOT EXISTS IDX_ROUTE_DEPARTURE_DATE_PLATE_STATUS ON ROUTE_DEPARTURES(DATE_KEY,PLATE,STATUS,SCHEDULE_ID)'},
  {name:'IDX_ROUTE_MONITORING_STATUS_DATE_PLATE',table:'ROUTE_MONITORING',sql:'CREATE INDEX IF NOT EXISTS IDX_ROUTE_MONITORING_STATUS_DATE_PLATE ON ROUTE_MONITORING(STATUS,DATE_KEY,PLATE,ID)'},
  {name:'IDX_ROUTE_RETURN_DATE_PLATE',table:'ROUTE_RETURNS',sql:'CREATE INDEX IF NOT EXISTS IDX_ROUTE_RETURN_DATE_PLATE ON ROUTE_RETURNS(DATE_KEY,PLATE,ID)'},
  {name:'IDX_ROUTE_RESOURCE_DATE_EFFECTIVE_ID',table:'ROUTE_RESOURCE_EVENTS',sql:'CREATE INDEX IF NOT EXISTS IDX_ROUTE_RESOURCE_DATE_EFFECTIVE_ID ON ROUTE_RESOURCE_EVENTS(DATE_KEY,EFFECTIVE_AT,ID)'},
  {name:'IDX_ROUTE_GPS_LATEST_GPS_TIME',table:'ROUTE_GPS_LATEST',sql:'CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_LATEST_GPS_TIME ON ROUTE_GPS_LATEST(GPS_TIME DESC)'},
  {name:'IDX_ROUTE_GPS_RET_ACTIVE_PLATE',table:'ROUTE_GPS_RETENTIONS',sql:'CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_RET_ACTIVE_PLATE ON ROUTE_GPS_RETENTIONS(ACTIVE,PLATE,LAST_SEEN_AT)'},
  // Índice composto usado pelo Monitoramento/diagnóstico. Ele precisa existir também em
  // ambientes onde as migrations antigas não foram aplicadas manualmente no D1.
  {name:'IDX_ROUTE_GPS_RET_DATE_ACTIVE',table:'ROUTE_GPS_RETENTIONS',sql:'CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_RET_DATE_ACTIVE ON ROUTE_GPS_RETENTIONS(DATE_KEY,ACTIVE,PLATE,STARTED_AT)'},
  {name:'IDX_ROUTE_GPS_OCC_DATE_PLATE',table:'ROUTE_GPS_OCCURRENCES',sql:'CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_OCC_DATE_PLATE ON ROUTE_GPS_OCCURRENCES(DATE_KEY,PLATE,TYPE)'},
  {name:'IDX_ROUTE_GPS_OCC_DATE_TYPE',table:'ROUTE_GPS_OCCURRENCES',sql:'CREATE INDEX IF NOT EXISTS IDX_ROUTE_GPS_OCC_DATE_TYPE ON ROUTE_GPS_OCCURRENCES(DATE_KEY,TYPE,PLATE)'},
  {name:'IDX_BASE_CLIENTES_LAT_LNG',table:'BASE_CLIENTES',sql:'CREATE INDEX IF NOT EXISTS IDX_BASE_CLIENTES_LAT_LNG ON BASE_CLIENTES(ATIVO,LATITUDE,LONGITUDE)'},
];
let ensurePromise=null;let lastEnsureAt=0;
export async function ensurePerformanceIndexes(db,{force=false}={}){
  if(!db)return {created:[],missingTables:[]};
  const now=Date.now();if(!force&&now-lastEnsureAt<30*60*1000)return {created:[],cached:true};
  if(ensurePromise)return ensurePromise;
  ensurePromise=(async()=>{
    const schema=await db.prepare("SELECT type,name,tbl_name FROM sqlite_master WHERE type IN ('table','index')").all();
    const tables=new Set((schema.results||[]).filter(r=>String(r.type)==='table').map(r=>String(r.name||'')));
    const indexes=new Set((schema.results||[]).filter(r=>String(r.type)==='index').map(r=>String(r.name||'')));
    const pending=PERFORMANCE_INDEXES.filter(item=>tables.has(item.table)&&!indexes.has(item.name));
    const created=[];
    for(let i=0;i<pending.length;i+=3){
      const group=pending.slice(i,i+3);
      try{await db.batch(group.map(item=>db.prepare(item.sql)));created.push(...group.map(item=>item.name));}catch(error){console.warn('Performance index bootstrap warning',group.map(x=>x.name).join(','),error?.message||error);}
    }
    lastEnsureAt=Date.now();
    return {created,missingTables:PERFORMANCE_INDEXES.filter(item=>!tables.has(item.table)).map(item=>item.table)};
  })().finally(()=>{ensurePromise=null;});
  return ensurePromise;
}
export function performanceIndexDefinitions(){return PERFORMANCE_INDEXES.map(({name,table})=>({name,table}));}
