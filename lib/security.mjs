import {createHash,createHmac,randomBytes,scrypt as rawScrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {appError} from './http.mjs';
import {authConfigIssues,normalizeUsername,validUsername} from './auth-config.mjs';
export {normalizeUsername,validUsername} from './auth-config.mjs';
const scrypt=promisify(rawScrypt);
const cost={N:131072,r:8,p:1,maxmem:192*1024*1024};
export const digest=s=>createHash('sha256').update(s).digest('hex');
export const equal=(a,b)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
export function checkConfig(env){
 const issues=authConfigIssues(env);
 if(issues.length)throw Object.assign(appError('AUTH_NOT_CONFIGURED',503),{configIssues:issues});
}
export function validPassword(s){return typeof s==='string'&&s.length>=12&&s.length<=256;}
export async function hashPassword(password){
 if(!validPassword(password))throw appError('PASSWORD_POLICY');
 const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64,cost);
 return `scrypt$131072$8$1$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password,encoded){
 const parts=String(encoded||'').split('$');
 const valid=parts.length===6&&parts[0]==='scrypt'&&parts[1]==='131072'&&parts[2]==='8'&&parts[3]==='1'&&/^[a-f0-9]{32}$/.test(parts[4])&&/^[a-f0-9]{128}$/.test(parts[5]);
 // Unknown accounts still perform the same expensive derivation.
 const key=await scrypt(password,valid?parts[4]:'00000000000000000000000000000000',64,cost);
 return valid&&timingSafeEqual(key,Buffer.from(parts[5],'hex'));
}
export const configStamp=(env,role)=>createHmac('sha256',env.SESSION_SECRET).update(role==='admin'?JSON.stringify([normalizeUsername(env.ADMIN_USERNAME),env.ADMIN_PASSWORD]):'user-session-v1').digest('hex');
export const csrfFor=(token,env)=>createHmac('sha256',env.SESSION_SECRET).update(`csrf:${token}`).digest('hex');
export const newToken=()=>randomBytes(32).toString('hex');
export function cookieName(request){return new URL(request.url).protocol==='https:'?'__Host-mp_session':'mp_session_dev';}
export function cookieToken(request){
 const items=(request.headers.get('cookie')||'').split(';').map(s=>s.trim());
 const matches=items.filter(s=>s.startsWith(cookieName(request)+'='));
 if(matches.length!==1)return null;const token=matches[0].slice(matches[0].indexOf('=')+1);
 return /^[a-f0-9]{64}$/.test(token)?token:null;
}
export function sessionCookie(request,token='',maxAge=28800){
 return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token?maxAge:0}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
export const publicActor=a=>({id:a.actorKey,username:a.username,fullName:a.fullName,role:a.role});
export async function authenticate(request,env,store,{csrf=false,admin=false}={}){
 const token=cookieToken(request);if(!token)throw appError('UNAUTHENTICATED',401);
 checkConfig(env);
 const session=await store.session(digest(token));
 if(!session||!equal(session.config_stamp,configStamp(env,session.role)))throw appError('UNAUTHENTICATED',401);
 const actor={actorKey:session.role==='admin'?'admin':session.user_id,username:session.username,fullName:session.full_name,
 role:session.role,token,tokenHash:digest(token),userId:session.user_id,authVersion:session.auth_version};
 if(admin&&actor.role!=='admin')throw appError('FORBIDDEN',403);
 if(csrf&&!equal(request.headers.get('x-csrf-token')||'',csrfFor(token,env)))throw appError('FORBIDDEN',403);
 return actor;
}
