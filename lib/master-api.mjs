import {APP_VERSION} from './app-version.mjs';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {normalizeFailure} from './hrm-errors.mjs';
import {readMasterFast} from './master-cache.mjs';
import {readSharedMaster,sharedCacheScope} from './shared-master.mjs';
import {json,appError,sameOrigin,safeAppFailure} from './http.mjs';
import {authenticate,cookieToken,checkConfig,configStamp} from './security.mjs';
import {getStore} from './store.mjs';
export async function handleMasterRequest(request,{env=process.env,reader,clock=()=>performance.now(),
 logger=event=>console.error(JSON.stringify(event)),store,loadStore=getStore}={}){
 if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'},{Allow:'POST'});
 const started=clock(),requestId=randomUUID();let actor,admitted=false,finalized=false,issued=false;
 try{
  sameOrigin(request);
  if(!cookieToken(request))throw appError('UNAUTHENTICATED',401);
  checkConfig(env);
  const distributed=!reader&&env.HRM_CACHE_ENABLED!=='0'&&env.HRM_SHARED_CACHE_ENABLED!=='0';
  store??=await loadStore(env);actor=await authenticate(request,env,store,{csrf:true,cacheScope:distributed?sharedCacheScope(env):undefined});
  admitted=await store.beginGet(actor,requestId);
  if(!admitted){await store.event(actor,'GET_MASTER','denied','RATE_LIMITED');throw appError('RATE_LIMITED',429);}
  if(env.VERCEL!=='1')throw appError('UNSUPPORTED_RUNTIME',503);
  if(!env.HRM_USERNAME||!env.HRM_PASSWORD)throw appError('NOT_CONFIGURED',503);
  const readerStarted=clock();
  const data=reader?await reader(env):distributed?await readSharedMaster(env,{store,seed:actor.sharedCache}):await readMasterFast(env);
  const readerMs=Math.max(0,clock()-readerStarted);
  if(typeof data?.password!=='string'||!data.password.trim()||data.password.length>4096||!Number.isFinite(data.remainingMs)||data.remainingMs<1000||data.remainingMs>300000)throw appError('INVALID_RESPONSE',502);
  const sampledAt=clock();const remainingAtSample=Math.floor(data.remainingMs-(Number.isFinite(data.readAtMs)?Math.max(0,sampledAt-data.readAtMs):0));
  if(remainingAtSample<1000)throw appError('INVALID_RESPONSE',502);
  // Re-check after HRM work: a disabled account, reset password, expired session
  // or logout while fetching must never receive the code.
  const expiresAt=new Date(Date.now()+remainingAtSample-Math.max(0,clock()-sampledAt)).toISOString();
  if(store.finishGetVerified){
   const result=await store.finishGetVerified(actor,requestId,configStamp(env,actor.role),expiresAt);finalized=true;issued=result.status==='issued';
   if(result.status!=='issued')throw appError(result.error_code||'UNAUTHENTICATED',result.status==='denied'?401:502);
  }else{
   await authenticate(request,env,store,{csrf:true});
   try{await store.finishGet(actor,requestId,'issued',null,expiresAt);}catch{throw appError('AUDIT_UNAVAILABLE',503);}
  }
  const now=clock(),remainingMs=Math.floor(remainingAtSample-Math.max(0,now-sampledAt));
  if(remainingMs<1000)throw appError('INVALID_RESPONSE',502);
  // Only static labels, durations and request ID. Never log the master or actor credentials.
  try{logger({event:'master_request_completed',version:APP_VERSION,requestId,
   source:['hrm','memory','shared','database'].includes(data.source)?data.source:'hrm',
   readerMs:Math.round(readerMs),processingMs:Math.round(Math.max(0,now-started))});}catch{}
  return json(200,{password:data.password,remainingMs,processingMs:Math.max(0,now-started),requestId});
 }catch(error){
  const safe=error?.appCode?{code:error.appCode,stage:'reader',reason:'UNKNOWN'}:normalizeFailure(error);
  if(admitted&&(!finalized||(issued&&safe.code==='INVALID_RESPONSE'))){
   try{await store.finishGet(actor,requestId,['UNAUTHENTICATED','FORBIDDEN'].includes(safe.code)?'denied':'failed',safe.code);}
   catch{try{logger({event:'audit_write_failed',version:APP_VERSION,requestId});}catch{}return json(503,{error:'AUDIT_UNAVAILABLE',requestId});}
  }
  if(error?.appCode)return safeAppFailure(error);
  // Database failures cannot be classified as HRM success and never disclose secrets.
  if(!admitted||error?.code==='42P01'||error?.code==='ECONNREFUSED')return safeAppFailure(error);
  const diagnostic={error:safe.code,stage:safe.stage,reason:safe.reason,requestId};
  try{logger({event:'master_request_failed',version:APP_VERSION,...diagnostic});}catch{}
  return json(502,diagnostic);
 }
}
