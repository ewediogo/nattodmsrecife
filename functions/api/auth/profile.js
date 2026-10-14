import { cleanText, jsonResponse, requireUser } from '../../_lib/auth.js';

// Perfil do próprio usuário: dados profissionais, horário de trabalho e foto.
// Cargo e nome ficam em ROUTE_USERS; o restante em ROUTE_USER_PROFILES.
const WEEK_DAYS=Object.freeze(['SEG','TER','QUA','QUI','SEX','SAB','DOM']);
const AVATAR_PATTERN=/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const AVATAR_MAX_CHARS=140000;
const PROFILE_DDL=`CREATE TABLE IF NOT EXISTS ROUTE_USER_PROFILES (
  USER_ID INTEGER PRIMARY KEY,
  PHONE TEXT,
  UNIT TEXT,
  DEPARTMENT TEXT,
  BIRTHDATE TEXT,
  BIO TEXT,
  WORK_START TEXT,
  WORK_END TEXT,
  WORK_BREAK_MIN INTEGER,
  WORK_DAYS TEXT,
  AVATAR_DATA TEXT,
  UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
let schemaPromise=null;
async function ensureProfileSchema(db){
  if(!schemaPromise)schemaPromise=db.prepare(PROFILE_DDL).run().catch((error)=>{schemaPromise=null;throw error;});
  await schemaPromise;
}

const timeValue=(value,label)=>{
  const text=String(value??'').trim();
  if(!text)return '';
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(text))throw new Error(`${label} inválido. Use o formato HH:MM.`);
  return text;
};
const dateValue=(value)=>{
  const text=String(value??'').trim();
  if(!text)return '';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(Date.parse(`${text}T12:00:00Z`)))throw new Error('Data de nascimento inválida.');
  if(text>new Date().toISOString().slice(0,10)||text<'1900-01-01')throw new Error('Data de nascimento fora do intervalo permitido.');
  return text;
};

function publicProfile(user,profile){
  const days=String(profile?.WORK_DAYS||'').split(',').map((x)=>x.trim()).filter((x)=>WEEK_DAYS.includes(x));
  return {
    user:{id:user.ID,name:user.NAME,email:/@matricula\.natto\.local$/i.test(String(user.EMAIL||''))?'':user.EMAIL,matricula:user.MATRICULA||'',role:user.ROLE,cargo:user.CARGO||'',createdAt:user.CREATED_AT||'',lastLogin:user.LAST_LOGIN||''},
    profile:{
      phone:profile?.PHONE||'',unit:profile?.UNIT||'',department:profile?.DEPARTMENT||'',birthdate:profile?.BIRTHDATE||'',bio:profile?.BIO||'',
      workStart:profile?.WORK_START||'',workEnd:profile?.WORK_END||'',workBreakMin:profile?.WORK_BREAK_MIN??null,workDays:days,
      avatar:profile?.AVATAR_DATA||'',updatedAt:profile?.UPDATED_AT||'',
    },
  };
}
async function load(db,userId){
  const user=await db.prepare('SELECT ID,NAME,EMAIL,MATRICULA,ROLE,CARGO,CREATED_AT,LAST_LOGIN FROM ROUTE_USERS WHERE ID=?').bind(Number(userId)).first();
  if(!user)throw new Error('Usuário não encontrado.');
  const profile=await db.prepare('SELECT * FROM ROUTE_USER_PROFILES WHERE USER_ID=?').bind(Number(userId)).first();
  return publicProfile(user,profile);
}

export async function onRequestGet({env,request}){
  if(!env.DB)return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request);if(auth.response)return auth.response;
  try{await ensureProfileSchema(env.DB);return jsonResponse({versao:'1',...await load(env.DB,auth.user.id)});}
  catch(error){return jsonResponse({erro:error.message||String(error)},400);}
}

export async function onRequestPut({env,request}){
  if(!env.DB)return jsonResponse({erro:"Binding D1 'DB' não encontrado."},500);
  const auth=await requireUser(env.DB,request);if(auth.response)return auth.response;
  try{
    await ensureProfileSchema(env.DB);
    const body=await request.json().catch(()=>({}));
    const current=await load(env.DB,auth.user.id);
    const has=(key)=>Object.prototype.hasOwnProperty.call(body,key);
    // Campos de ROUTE_USERS
    const name=has('name')?cleanText(body.name,120):current.user.name;
    if(name.length<2)throw new Error('Informe o nome (mínimo de 2 caracteres).');
    const cargo=has('cargo')?cleanText(body.cargo,80):current.user.cargo;
    // Campos do perfil
    const phone=has('phone')?cleanText(body.phone,30).replace(/[^\d+()\-\s]/g,'').trim():current.profile.phone;
    const unit=has('unit')?cleanText(body.unit,80):current.profile.unit;
    const department=has('department')?cleanText(body.department,80):current.profile.department;
    const birthdate=has('birthdate')?dateValue(body.birthdate):current.profile.birthdate;
    const bio=has('bio')?cleanText(body.bio,300):current.profile.bio;
    const workStart=has('workStart')?timeValue(body.workStart,'Horário de entrada'):current.profile.workStart;
    const workEnd=has('workEnd')?timeValue(body.workEnd,'Horário de saída'):current.profile.workEnd;
    if(Boolean(workStart)!==Boolean(workEnd))throw new Error('Informe o horário de entrada e o de saída.');
    let breakMin=has('workBreakMin')?body.workBreakMin:current.profile.workBreakMin;
    breakMin=breakMin===''||breakMin===null||breakMin===undefined?null:Math.round(Number(breakMin));
    if(breakMin!==null&&(!Number.isFinite(breakMin)||breakMin<0||breakMin>480))throw new Error('Intervalo deve ficar entre 0 e 480 minutos.');
    let days=has('workDays')?body.workDays:current.profile.workDays;
    days=(Array.isArray(days)?days:[]).map((x)=>String(x).toUpperCase()).filter((x,i,list)=>WEEK_DAYS.includes(x)&&list.indexOf(x)===i);
    let avatar=current.profile.avatar;
    if(has('avatar')){
      avatar=String(body.avatar||'');
      if(avatar&&(avatar.length>AVATAR_MAX_CHARS||!AVATAR_PATTERN.test(avatar)))throw new Error('Foto inválida. Use uma imagem JPEG, PNG ou WebP de até 100 KB.');
    }
    await env.DB.prepare('UPDATE ROUTE_USERS SET NAME=?,CARGO=?,UPDATED_AT=CURRENT_TIMESTAMP WHERE ID=?').bind(name,cargo,Number(auth.user.id)).run();
    await env.DB.prepare(`INSERT INTO ROUTE_USER_PROFILES (USER_ID,PHONE,UNIT,DEPARTMENT,BIRTHDATE,BIO,WORK_START,WORK_END,WORK_BREAK_MIN,WORK_DAYS,AVATAR_DATA,UPDATED_AT)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(USER_ID) DO UPDATE SET PHONE=excluded.PHONE,UNIT=excluded.UNIT,DEPARTMENT=excluded.DEPARTMENT,BIRTHDATE=excluded.BIRTHDATE,BIO=excluded.BIO,
        WORK_START=excluded.WORK_START,WORK_END=excluded.WORK_END,WORK_BREAK_MIN=excluded.WORK_BREAK_MIN,WORK_DAYS=excluded.WORK_DAYS,AVATAR_DATA=excluded.AVATAR_DATA,UPDATED_AT=CURRENT_TIMESTAMP`)
      .bind(Number(auth.user.id),phone,unit,department,birthdate,bio,workStart,workEnd,breakMin,days.join(','),avatar).run();
    return jsonResponse({ok:true,versao:'1',...await load(env.DB,auth.user.id)});
  }catch(error){return jsonResponse({erro:error.message||String(error)},400);}
}
