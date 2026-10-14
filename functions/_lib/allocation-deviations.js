// Justificativas de desvio do Plano de Alocação: quando a Escala usa um motorista diferente do
// previsto na placa, o usuário justifica (por que o motorista do plano não foi usado e a ação
// tomada). O texto aparece no Plano de Alocação para montar o plano de ação.
const TABLE='ROUTE_ALLOCATION_DEVIATIONS';
let ensurePromise=null;
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
async function tableExists(db){return Boolean((await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND UPPER(name)=UPPER(?)").bind(TABLE).first())?.name);}
export async function ensureDeviationsTable(db){
  if(!ensurePromise)ensurePromise=(async()=>{
    await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      ESCALA_ID TEXT PRIMARY KEY,DATE_KEY TEXT NOT NULL,PLATE TEXT,ROUTE TEXT,DRIVER_ID TEXT,DRIVER_NAME TEXT,
      PLANNED_DRIVER TEXT,PLANNED_SUBSTITUTE TEXT,JUSTIFICATION TEXT NOT NULL,USER_NAME TEXT,
      CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_ALLOCATION_DEVIATIONS_DATE ON ${TABLE}(DATE_KEY)`).run();
  })().catch((error)=>{ensurePromise=null;throw error;});
  return ensurePromise;
}
function shape(row){return {scheduleId:String(row.ESCALA_ID||''),date:String(row.DATE_KEY||''),plate:String(row.PLATE||''),route:String(row.ROUTE||''),driverId:String(row.DRIVER_ID||''),driver:String(row.DRIVER_NAME||''),plannedDriver:String(row.PLANNED_DRIVER||''),plannedSubstitute:String(row.PLANNED_SUBSTITUTE||''),justification:String(row.JUSTIFICATION||''),user:String(row.USER_NAME||''),createdAt:String(row.CREATED_AT||''),updatedAt:String(row.UPDATED_AT||'')};}
// Leitura segura: se a tabela ainda não existe, não há justificativas.
export async function readDeviations(db,{start='',end=''}={}){
  try{
    if(!(await tableExists(db)))return new Map();
    const clauses=[],binds=[];if(start){clauses.push('DATE_KEY>=?');binds.push(start);}if(end){clauses.push('DATE_KEY<=?');binds.push(end);}
    const {results=[]}=await db.prepare(`SELECT * FROM ${TABLE}${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY DATE_KEY DESC LIMIT 5000`).bind(...binds).all();
    return new Map(results.map((row)=>[String(row.ESCALA_ID),shape(row)]));
  }catch{return new Map();}
}
export async function upsertDeviation(db,data={}){
  await ensureDeviationsTable(db);
  const text=clean(data.justification,1000);if(!text||!data.scheduleId)return false;
  await db.prepare(`INSERT INTO ${TABLE} (ESCALA_ID,DATE_KEY,PLATE,ROUTE,DRIVER_ID,DRIVER_NAME,PLANNED_DRIVER,PLANNED_SUBSTITUTE,JUSTIFICATION,USER_NAME,UPDATED_AT)
    VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(ESCALA_ID) DO UPDATE SET DATE_KEY=excluded.DATE_KEY,PLATE=excluded.PLATE,ROUTE=excluded.ROUTE,DRIVER_ID=excluded.DRIVER_ID,DRIVER_NAME=excluded.DRIVER_NAME,PLANNED_DRIVER=excluded.PLANNED_DRIVER,PLANNED_SUBSTITUTE=excluded.PLANNED_SUBSTITUTE,JUSTIFICATION=excluded.JUSTIFICATION,USER_NAME=excluded.USER_NAME,UPDATED_AT=CURRENT_TIMESTAMP`)
    .bind(String(data.scheduleId),clean(data.date,10),clean(data.plate,30),clean(data.route,180),clean(data.driverId,80),clean(data.driver,180),clean(data.plannedDriver,180),clean(data.plannedSubstitute,180),text,clean(data.user,180)).run();
  return true;
}
export async function deleteDeviation(db,scheduleId){
  try{if(!(await tableExists(db)))return;await db.prepare(`DELETE FROM ${TABLE} WHERE ESCALA_ID=?`).bind(String(scheduleId)).run();}catch{}
}
