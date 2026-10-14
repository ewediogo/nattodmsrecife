import { normalizeText } from './route-phase1.js';

// Cadastro de motoristas carreteiros, motoristas de bitruck e placas de bitruck do CAJU - Carreteiros.
// - CARRETEIRO: motorista que NÃO aparece na Escala.
// - MOTORISTA_BITRUCK: aparece na Escala, mas só pode ser escalado em placas de bitruck cadastradas.
// - BITRUCK: placa de bitruck cadastrada.
export const CARRETEIRO_KINDS=Object.freeze(['CARRETEIRO','MOTORISTA_BITRUCK','BITRUCK']);
const TABLE='ROUTE_CARRETEIROS';
let ensurePromise=null;
export function carreteiroPlateKey(value=''){return normalizeText(value).replace(/[^A-Z0-9]/g,'');}
async function tableExists(db,name){return Boolean((await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND UPPER(name)=UPPER(?)").bind(name).first())?.name);}
export async function ensureCarreteirosTable(db){
  if(!ensurePromise)ensurePromise=(async()=>{
    await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      ID TEXT PRIMARY KEY,KIND TEXT NOT NULL,NOME TEXT,MATRICULA TEXT,COLABORADOR_ID TEXT,PLACA TEXT,ATIVO INTEGER NOT NULL DEFAULT 1,
      OBSERVACOES TEXT,CREATED_BY INTEGER,CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_CARRETEIROS_KIND ON ${TABLE}(KIND,ATIVO)`).run();
  })().catch((error)=>{ensurePromise=null;throw error;});
  return ensurePromise;
}
export function carreteiroRow(row={}){
  return {id:String(row.ID||''),kind:String(row.KIND||''),nome:String(row.NOME||''),matricula:String(row.MATRICULA||''),colaboradorId:String(row.COLABORADOR_ID||''),placa:String(row.PLACA||''),ativo:Number(row.ATIVO??1)!==0,observacoes:String(row.OBSERVACOES||'')};
}
export async function listCarreteiros(db){
  await ensureCarreteirosTable(db);
  const {results=[]}=await db.prepare(`SELECT * FROM ${TABLE} ORDER BY KIND,NOME,PLACA`).all();
  return results.map(carreteiroRow);
}
// Leitura usada pela Escala: não cria tabela e nunca falha a escala se ela ainda não existe.
export async function readCarreteirosRegistry(db){
  const empty={carreteiroIds:new Set(),carreteiroNames:new Set(),bitruckDriverIds:new Set(),bitruckDriverNames:new Set(),bitruckPlates:new Set(),records:[]};
  try{
    if(!(await tableExists(db,TABLE)))return empty;
    const {results=[]}=await db.prepare(`SELECT * FROM ${TABLE} WHERE COALESCE(ATIVO,1)<>0`).all();
    const registry={...empty,records:results.map(carreteiroRow)};
    for(const item of registry.records){
      if(item.kind==='CARRETEIRO'){if(item.colaboradorId)registry.carreteiroIds.add(item.colaboradorId);if(item.nome)registry.carreteiroNames.add(normalizeText(item.nome));}
      else if(item.kind==='MOTORISTA_BITRUCK'){if(item.colaboradorId)registry.bitruckDriverIds.add(item.colaboradorId);if(item.nome)registry.bitruckDriverNames.add(normalizeText(item.nome));}
      else if(item.kind==='BITRUCK'&&item.placa)registry.bitruckPlates.add(carreteiroPlateKey(item.placa));
    }
    return registry;
  }catch{return empty;}
}
export function isCarreteiroDriver(registry,driver={}){
  if(!registry||!driver)return false;
  return registry.carreteiroIds?.has(String(driver.id||''))||registry.carreteiroNames?.has(normalizeText(driver.nome||''));
}
export function isBitruckDriver(registry,driver={}){
  if(!registry||!driver)return false;
  return registry.bitruckDriverIds?.has(String(driver.id||''))||registry.bitruckDriverNames?.has(normalizeText(driver.nome||''));
}
export function bitruckDriverMayUsePlate(registry,driver,plate){
  if(!isBitruckDriver(registry,driver))return true;
  const key=carreteiroPlateKey(plate);return Boolean(key&&registry.bitruckPlates?.has(key));
}
