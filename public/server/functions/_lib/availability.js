function clean(value,max=240){return String(value??'').trim().slice(0,max);}
function dateIso(value){const raw=String(value||'').trim();const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;const b=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);return b?`${b[3]}-${b[2]}-${b[1]}`:'';}
function addDays(date,amount){const day=dateIso(date);if(!day)return '';const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+Number(amount||0));return d.toISOString().slice(0,10);}
function actor(user){return clean(user?.email||user?.name||'Sistema',180);}
function scheduleId(schedule){return String(schedule?.id||schedule?.ID||schedule?.schedule_record_id||schedule?.ESCALA_ID||'');}
function refs(schedule){return [
  {type:'VEICULO',id:schedule?.veiculo_id||schedule?.VEICULO_ID,name:schedule?.placa||schedule?.PLACA},
  {type:'MOTORISTA',id:schedule?.motorista_id||schedule?.MOTORISTA_ID,name:schedule?.motorista||schedule?.MOTORISTA},
  {type:'AJUDANTE',id:schedule?.ajudante_1_id||schedule?.AJUDANTE_1_ID,name:schedule?.ajudante_1||schedule?.AJUDANTE_1},
  {type:'AJUDANTE',id:schedule?.ajudante_2_id||schedule?.AJUDANTE_2_ID,name:schedule?.ajudante_2||schedule?.AJUDANTE_2},
].filter(r=>r.id);}
let availabilitySchemaPromise=null;
async function availabilitySchemaReady(db){try{const expected=['DISPONIBILIDADE_RECURSOS','IDX_ROUTE_AVAILABILITY_DATE_RESOURCE'];const placeholders=expected.map(()=>'?').join(',');const result=await db.prepare(`SELECT name FROM sqlite_master WHERE name IN (${placeholders})`).bind(...expected).all();const found=new Set((result.results||[]).map((row)=>String(row.name||'')));return expected.every((name)=>found.has(name));}catch{return false;}}
export async function ensureAvailabilitySchema(db){if(!availabilitySchemaPromise)availabilitySchemaPromise=(async()=>{if(await availabilitySchemaReady(db))return;await db.batch([db.prepare(`CREATE TABLE IF NOT EXISTS DISPONIBILIDADE_RECURSOS (
  ID TEXT PRIMARY KEY,DATA_DISPONIBILIDADE TEXT NOT NULL,ESCALA_ORIGEM_ID TEXT,TIPO_RECURSO TEXT NOT NULL,RECURSO_ID TEXT NOT NULL,NOME TEXT,
  ORIGEM TEXT NOT NULL,STATUS TEXT NOT NULL DEFAULT 'DISPONÍVEL',OBSERVACOES TEXT,CRIADO_EM TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ATUALIZADO_EM TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,USUARIO TEXT
)`),db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_AVAILABILITY_DATE_RESOURCE ON DISPONIBILIDADE_RECURSOS(DATA_DISPONIBILIDADE,TIPO_RECURSO,RECURSO_ID,STATUS)`)]);})().catch((error)=>{availabilitySchemaPromise=null;throw error;});return availabilitySchemaPromise;}
export async function createAvailabilityRowsForSchedule(db,schedule,dateValue,origin,notes,user){
  await ensureAvailabilitySchema(db);const date=dateIso(dateValue);if(!date)return [];
  const sid=scheduleId(schedule),created=[];
  for(const resource of refs(schedule)){
    const duplicate=await db.prepare(`SELECT ID FROM DISPONIBILIDADE_RECURSOS WHERE DATA_DISPONIBILIDADE=? AND ESCALA_ORIGEM_ID=? AND TIPO_RECURSO=? AND RECURSO_ID=? AND UPPER(COALESCE(STATUS,''))<>'CANCELADO' LIMIT 1`).bind(date,sid,resource.type,String(resource.id)).first();
    if(duplicate)continue;
    const row={ID:`DISP-${crypto.randomUUID().toUpperCase()}`,DATA_DISPONIBILIDADE:date,ESCALA_ORIGEM_ID:sid,TIPO_RECURSO:resource.type,RECURSO_ID:String(resource.id),NOME:clean(resource.name,180),ORIGEM:clean(origin||'SISTEMA',120),STATUS:'DISPONÍVEL',OBSERVACOES:clean(notes,500),USUARIO:actor(user)};
    await db.prepare(`INSERT INTO DISPONIBILIDADE_RECURSOS (ID,DATA_DISPONIBILIDADE,ESCALA_ORIGEM_ID,TIPO_RECURSO,RECURSO_ID,NOME,ORIGEM,STATUS,OBSERVACOES,USUARIO) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(row.ID,row.DATA_DISPONIBILIDADE,row.ESCALA_ORIGEM_ID,row.TIPO_RECURSO,row.RECURSO_ID,row.NOME,row.ORIGEM,row.STATUS,row.OBSERVACOES,row.USUARIO).run();
    created.push(row);
  }
  return created;
}
export async function createAvailabilityAfterReturn(db,schedule,returnDateTime,user){return createAvailabilityRowsForSchedule(db,schedule,dateIso(returnDateTime),'RETORNO REAL','Liberado imediatamente após retorno confirmado.',user);}
export async function setManualAvailability(db,payload,user){
  await ensureAvailabilitySchema(db);const date=dateIso(payload.data_disponibilidade||payload.data);if(!date)throw new Error('Informe a data de disponibilidade.');
  const type=String(payload.tipo_recurso||payload.resource_type||'').trim().toUpperCase(),id=String(payload.recurso_id||payload.resource_id||'').trim(),name=clean(payload.nome||payload.resource_name,180);
  if(!['VEICULO','MOTORISTA','AJUDANTE'].includes(type)||!id)throw new Error('Informe tipo e recurso válidos.');
  const row={ID:`DISP-${crypto.randomUUID().toUpperCase()}`,DATA_DISPONIBILIDADE:date,ESCALA_ORIGEM_ID:String(payload.escala_origem_id||payload.schedule_record_id||''),TIPO_RECURSO:type,RECURSO_ID:id,NOME:name,ORIGEM:'AJUSTE MANUAL',STATUS:'DISPONÍVEL',OBSERVACOES:clean(payload.observacoes||payload.justificativa,500),USUARIO:actor(user)};
  await db.prepare(`INSERT INTO DISPONIBILIDADE_RECURSOS (ID,DATA_DISPONIBILIDADE,ESCALA_ORIGEM_ID,TIPO_RECURSO,RECURSO_ID,NOME,ORIGEM,STATUS,OBSERVACOES,USUARIO) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(row.ID,row.DATA_DISPONIBILIDADE,row.ESCALA_ORIGEM_ID,row.TIPO_RECURSO,row.RECURSO_ID,row.NOME,row.ORIGEM,row.STATUS,row.OBSERVACOES,row.USUARIO).run();return row;
}
