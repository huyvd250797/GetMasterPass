import {randomUUID} from 'node:crypto';
import {json,appError,sameOrigin,bodyJson,safeAppFailure} from './http.mjs';
import {getStore} from './store.mjs';
import {authenticate,checkConfig,normalizeUsername,validUsername,validPassword,verifyPassword,hashPassword,equal,newToken,digest,configStamp,csrfFor,sessionCookie,publicActor} from './security.mjs';
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
export async function handleAuthRequest(request,{env=process.env,store,loadStore=getStore}={}){
 try{
  if(!['GET','POST'].includes(request.method))return json(405,{error:'METHOD_NOT_ALLOWED'},{Allow:'GET, POST'});
  if(request.method==='POST')sameOrigin(request);
  checkConfig(env);store??=await loadStore(env);
  if(request.method==='GET'){
   const a=await authenticate(request,env,store);return json(200,{user:publicActor(a),csrfToken:csrfFor(a.token,env)});
  }
  const body=await bodyJson(request);
  if(body.action==='change_password'){
   const a=await authenticate(request,env,store,{csrf:true});
   if(a.role!=='user')throw appError('FORBIDDEN',403);
   if(!await store.rate('password-change:'+a.actorKey,5,900))throw appError('RATE_LIMITED',429);
   if(typeof body.currentPassword!=='string'||!body.currentPassword||body.currentPassword.length>256||!validPassword(body.newPassword))throw appError('PASSWORD_POLICY');
   const u=await store.userByName(a.username);
   if(!u?.active||!await verifyPassword(body.currentPassword,u?.password_hash))throw appError('CURRENT_PASSWORD_INVALID',400);
   if(!await store.changeOwnPassword(a,u.password_hash,await hashPassword(body.newPassword)))throw appError('UNAUTHENTICATED',401);
   return json(200,{ok:true,loginRequired:true},{'Set-Cookie':sessionCookie(request)});
  }
  if(body.action==='logout'){
   const a=await authenticate(request,env,store,{csrf:true});await store.logout(a);
   return json(200,{ok:true},{'Set-Cookie':sessionCookie(request)});
  }
  if(body.action!=='login')throw appError('INVALID_INPUT');
  const username=normalizeUsername(body.username),password=body.password;
  if(!validUsername(username)||typeof password!=='string'||!password||password.length>256)throw appError('INVALID_CREDENTIALS',401);
  // Distributed rate limits protect the password derivation and account attempts.
  if(!await store.rate('login-global',60,60)||!await store.rate('login:'+digest(username),8,900))throw appError('RATE_LIMITED',429);
  let a,valid;
  if(username===normalizeUsername(env.ADMIN_USERNAME)){
   valid=equal(password,env.ADMIN_PASSWORD);
   a={actorKey:'admin',role:'admin',userId:null,authVersion:null,username,fullName:'Quản trị viên'};
  }else{
   const u=await store.userByName(username);
   valid=await verifyPassword(password,u?.password_hash)&&!!u?.active;
   a={actorKey:u?.id||'unknown',role:'user',userId:u?.id||null,authVersion:u?.auth_version||null,username,fullName:u?.full_name||''};
  }
  if(!valid){await store.event(a,'LOGIN','failed','INVALID_CREDENTIALS');throw appError('INVALID_CREDENTIALS',401);}
  const token=newToken();await store.loginSession({hash:digest(token),stamp:configStamp(env,a.role)},a);
  return json(200,{user:publicActor(a),csrfToken:csrfFor(token,env)},{'Set-Cookie':sessionCookie(request,token)});
 }catch(error){return safeAppFailure(error);}
}
export async function handleAdminRequest(request,{env=process.env,store,loadStore=getStore}={}){
 try{
  if(!['GET','POST'].includes(request.method))return json(405,{error:'METHOD_NOT_ALLOWED'},{Allow:'GET, POST'});
  if(request.method==='POST')sameOrigin(request);
  store??=await loadStore(env);
  const a=await authenticate(request,env,store,{admin:true,csrf:request.method==='POST'});
  if(request.method==='GET')return json(200,{users:await store.users()});
  if(!await store.rate('admin-write:'+a.actorKey,20,60))throw appError('RATE_LIMITED',429);
  const b=await bodyJson(request);
  if(b.action==='create'){
   const username=normalizeUsername(b.username),fullName=typeof b.fullName==='string'?b.fullName.trim():'';
   if(!validUsername(username)||!fullName||fullName.length>120)throw appError('INVALID_INPUT');
   if(username===normalizeUsername(env.ADMIN_USERNAME))throw appError('RESERVED_USERNAME');
   if(!validPassword(b.password))throw appError('PASSWORD_POLICY');
   const passwordHash=await hashPassword(b.password);
   try{await store.createUser(a,{id:randomUUID(),username,fullName,passwordHash});}catch(e){if(e?.code==='23505')throw appError('USERNAME_EXISTS',409);throw e;}
   return json(201,{ok:true});
  }
  if(!uuid(b.id))throw appError('INVALID_INPUT');
  if(b.action==='toggle'){
   if(typeof b.active!=='boolean')throw appError('INVALID_INPUT');
   if(!await store.changeUser(a,b.id,{active:b.active}))throw appError('USER_NOT_FOUND',404);
  }else if(b.action==='reset'){
   if(!validPassword(b.password))throw appError('PASSWORD_POLICY');
   if(!await store.changeUser(a,b.id,{passwordHash:await hashPassword(b.password)}))throw appError('USER_NOT_FOUND',404);
  }else throw appError('INVALID_INPUT');
  return json(200,{ok:true});
 }catch(error){return safeAppFailure(error);}
}
function dateBound(s,nextDay=false){
 if(!s)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s)))throw appError('INVALID_INPUT');
 const midnight=new Date(s+'T00:00:00Z');if(midnight.toISOString().slice(0,10)!==s)throw appError('INVALID_INPUT');
 return new Date(midnight.getTime()-7*3600000+(nextDay?86400000:0)).toISOString();
}
export async function handleHistoryRequest(request,{env=process.env,store,loadStore=getStore}={}){
 try{
  if(!['GET','POST'].includes(request.method))return json(405,{error:'METHOD_NOT_ALLOWED'},{Allow:'GET, POST'});
  if(request.method==='POST')sameOrigin(request);
  store??=await loadStore(env);const a=await authenticate(request,env,store,{admin:true,csrf:request.method==='POST'});
  if(request.method==='POST'){
   if(!await store.rate('history-delete:'+a.actorKey,20,60))throw appError('RATE_LIMITED',429);
   const b=await bodyJson(request);
   if(!['delete_one','delete_all'].includes(b.action)||b.action==='delete_one'&&!uuid(b.id))throw appError('INVALID_INPUT');
   if(b.action==='delete_all'&&b.confirm!=='DELETE_ALL_GET_HISTORY')throw appError('INVALID_INPUT');
   const deleted=await store.deleteHistory(a,b.action==='delete_one'?b.id:null);
   if(b.action==='delete_one'&&!deleted)throw appError('HISTORY_NOT_DELETABLE',409);
   return json(200,{ok:true,deleted});
  }
  const p=new URL(request.url).searchParams;let actorKey=a.actorKey;
  if(a.role==='admin'){actorKey=p.get('actor')||null;if(actorKey&&actorKey!=='admin'&&!uuid(actorKey))throw appError('INVALID_INPUT');}
  const from=dateBound(p.get('from')),to=dateBound(p.get('to'),true);
  if(from&&to&&from>=to)throw appError('INVALID_INPUT');
  const raw=p.get('offset')||'0';if(!/^\d{1,7}$/.test(raw))throw appError('INVALID_INPUT');
  return json(200,await store.history({actorKey,from,to,offset:Number(raw)}));
 }catch(error){return safeAppFailure(error);}
}
