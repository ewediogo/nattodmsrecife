// Motivo/atividade do segundo motorista (carona) da Escala, ex.: "Buscar SMX0A05 na Veneza".
// Aparece na impressão da escala logo abaixo da linha da viagem.
const TABLE='ROUTE_SCHEDULE_CARONA';
let ensurePromise=null;
const clean=(value,max=300)=>String(value??'').trim().slice(0,max);
async function tableExists(db){return Boolean((await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND UPPER(name)=UPPER(?)").bind(TABLE).first())?.name);}
export async function ensureCaronaTable(db){
  if(!ensurePromise)ensurePromise=(async()=>{
    await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (ESCALA_ID TEXT PRIMARY KEY,DATE_KEY TEXT NOT NULL,REASON TEXT NOT NULL,UPDATED_BY TEXT,UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_SCHEDULE_CARONA_DATE ON ${TABLE}(DATE_KEY)`).run();
  })().catch((error)=>{ensurePromise=null;throw error;});
  return ensurePromise;
}
// Leitura segura: sem tabela, sem motivos.
export async function readCaronaReasons(db,{start='',end=''}={}){
  try{
    if(!(await tableExists(db)))return new Map();
    const clauses=[],binds=[];if(start){clauses.push('DATE_KEY>=?');binds.push(start);}if(end){clauses.push('DATE_KEY<=?');binds.push(end);}
    const {results=[]}=await db.prepare(`SELECT ESCALA_ID,REASON FROM ${TABLE}${clauses.length?` WHERE ${clauses.join(' AND ')}`:''}`).bind(...binds).all();
    return new Map(results.map((row)=>[String(row.ESCALA_ID),String(row.REASON||'')]));
  }catch{return new Map();}
}
export async function saveCaronaReason(db,{scheduleId,date,reason,user}={}){
  const text=clean(reason);if(!scheduleId)return;
  if(!text){try{if(await tableExists(db))await db.prepare(`DELETE FROM ${TABLE} WHERE ESCALA_ID=?`).bind(String(scheduleId)).run();}catch{}return;}
  await ensureCaronaTable(db);
  await db.prepare(`INSERT INTO ${TABLE} (ESCALA_ID,DATE_KEY,REASON,UPDATED_BY,UPDATED_AT) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(ESCALA_ID) DO UPDATE SET DATE_KEY=excluded.DATE_KEY,REASON=excluded.REASON,UPDATED_BY=excluded.UPDATED_BY,UPDATED_AT=CURRENT_TIMESTAMP`).bind(String(scheduleId),clean(date,10),text,clean(user,180)).run();
}
