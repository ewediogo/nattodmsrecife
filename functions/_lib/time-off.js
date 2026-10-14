// Folgas agendadas (Gestão > Folgas): motorista/ajudante com folga na data não é
// escalado (Escala manual, Saída e pré-escala automática) e o dia do CAJU vira FOLGA.
export const TIME_OFF_TABLE='ROUTE_TIME_OFF';
export const TIME_OFF_STATUS='FOLGA AGENDADA';
export const TIME_OFF_REASONS=Object.freeze([
  'FOLGA SOLICITADA','COMPENSAÇÃO / BANCO DE HORAS','CONSULTA / EXAME MÉDICO','ASSUNTO PESSOAL','LUTO','CASAMENTO',
  'DOAÇÃO DE SANGUE','NASCIMENTO DE FILHO','OUTROS',
]);

const isoDate=(value)=>/^\d{4}-\d{2}-\d{2}/.test(String(value||''))?String(value).slice(0,10):'';

export async function ensureTimeOffSchema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${TIME_OFF_TABLE} (
    ID TEXT PRIMARY KEY,
    EMPLOYEE_ID TEXT NOT NULL,
    EMPLOYEE_NAME TEXT NOT NULL DEFAULT '',
    EMPLOYEE_FUNCTION TEXT,
    START_DATE TEXT NOT NULL,
    END_DATE TEXT NOT NULL,
    REASON TEXT NOT NULL,
    NOTES TEXT,
    STATUS TEXT NOT NULL DEFAULT 'AGENDADA',
    CREATED_BY TEXT,
    CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_BY TEXT,
    UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CANCELED_BY TEXT,
    CANCELED_AT TEXT
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_TIME_OFF_EMPLOYEE ON ${TIME_OFF_TABLE}(EMPLOYEE_ID,START_DATE)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS IDX_ROUTE_TIME_OFF_PERIOD ON ${TIME_OFF_TABLE}(START_DATE,END_DATE)`).run();
}

// Folgas ativas que cobrem pelo menos um dia do intervalo. Sem a tabela (ainda não
// criada), retorna vazio: a funcionalidade não pode derrubar a Escala.
export async function readActiveTimeOff(db,start,end=start){
  const from=isoDate(start),to=isoDate(end)||from;
  if(!from)return [];
  try{
    const {results=[]}=await db.prepare(`SELECT * FROM ${TIME_OFF_TABLE} WHERE START_DATE<=? AND END_DATE>=? AND UPPER(COALESCE(STATUS,'AGENDADA'))<>'CANCELADA' LIMIT 5000`).bind(to,from).all();
    return results||[];
  }catch{return [];}
}

// employeeId -> linha da folga (primeira que cobre a data).
export function timeOffByEmployeeOn(rows,date){
  const day=isoDate(date),map=new Map();
  for(const row of rows||[]){
    const id=String(row.EMPLOYEE_ID||'');
    if(!id||map.has(id))continue;
    if(day&&row.START_DATE<=day&&row.END_DATE>=day)map.set(id,row);
  }
  return map;
}

// Mantém status duros e viagem em andamento; qualquer outro vira FOLGA AGENDADA.
const KEEP_STATUSES=new Set(['FÉRIAS','FERIAS','ATESTADO','AFASTADO','RESERVADO','BLOQUEADO','DESLIGADO','INATIVO','EM ROTA','PERNOITE']);
export function applyTimeOffStatus(status,timeOffRow){
  if(!timeOffRow)return status;
  const key=String(status||'').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toUpperCase();
  const keepKeys=new Set([...KEEP_STATUSES].map((item)=>item.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase()));
  return keepKeys.has(key)?status:TIME_OFF_STATUS;
}
