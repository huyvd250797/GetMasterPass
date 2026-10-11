import {createCipheriv,createDecipheriv,createHmac,hkdfSync,randomBytes,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {appError} from './http.mjs';
import {createMasterReader} from './master-cache.mjs';
import {readMasterFromHrm,prepareHrmRuntime} from './hrm-browser.mjs';

export const sharedCacheScope=env=>createHmac('sha256',env.SESSION_SECRET)
 .update(JSON.stringify(['master-cache-v1',env.HRM_USERNAME,env.HRM_PASSWORD])).digest('hex');
const key=env=>Buffer.from(hkdfSync('sha256',env.SESSION_SECRET,'mp-cache-salt-v1','mp-cache-aes-256-gcm-v1',32));
export function sealMaster(env,data,{clock=()=>performance.now(),wallClock=()=>Date.now()}={}){
 const now=clock(),wall=wallClock();
 const remainingMs=Math.floor(data.remainingMs-Math.max(0,
  Number.isFinite(data.readAtMs)?now-data.readAtMs:0,Number.isFinite(data.readAtWallMs)?wall-data.readAtWallMs:0));
 if(typeof data.password!=='string'||!data.password.trim()||data.password.length>4096||
  !Number.isFinite(remainingMs)||remainingMs<1000||remainingMs>300000)throw appError('INVALID_RESPONSE',502);
 const scope=sharedCacheScope(env),expiresAt=new Date(wall+remainingMs).toISOString(),iv=randomBytes(12);
 const cipher=createCipheriv('aes-256-gcm',key(env),iv,{authTagLength:16});
 cipher.setAAD(Buffer.from(scope+'|'+expiresAt));
 const encrypted=Buffer.concat([cipher.update(JSON.stringify({password:data.password}),'utf8'),cipher.final()]);
 return {scope,expiresAt,payload:['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.')};
}
export function openMaster(env,row,{clock=()=>performance.now(),wallClock=()=>Date.now()}={}){
 try{
  if(typeof row?.payload!=='string'||row.payload.length>24000)return null;
  const [version,iv,tag,encrypted,...extra]=row.payload.split('.');
  if(version!=='v1'||extra.length||![iv,tag,encrypted].every(s=>typeof s==='string'&&/^[A-Za-z0-9_-]+$/.test(s)))return null;
  const ivBytes=Buffer.from(iv,'base64url'),tagBytes=Buffer.from(tag,'base64url');
  if(ivBytes.length!==12||tagBytes.length!==16)return null;
  const expiresAt=new Date(row.expires_at).toISOString(),now=clock();
  const dbRemaining=Number(row.remaining_ms);
  if(!Number.isFinite(dbRemaining)||!Number.isFinite(row.read_at_ms))return null;
  const remainingMs=Math.floor(Math.min(Date.parse(expiresAt)-wallClock(),dbRemaining-Math.max(0,now-row.read_at_ms)));
  if(remainingMs<=3000||remainingMs>300000)return null;
  const decipher=createDecipheriv('aes-256-gcm',key(env),ivBytes,{authTagLength:16});
  decipher.setAAD(Buffer.from(sharedCacheScope(env)+'|'+expiresAt));decipher.setAuthTag(tagBytes);
  const data=JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted,'base64url')),decipher.final()]).toString('utf8'));
  if(typeof data.password!=='string'||!data.password.trim()||data.password.length>4096)return null;
  return {password:data.password,remainingMs,readAtMs:now,source:'database'};
 }catch{return null;}
}
export function createSharedMasterReader({reader=readMasterFromHrm,prepare=reader===readMasterFromHrm?prepareHrmRuntime:undefined,clock=()=>performance.now(),wallClock=()=>Date.now(),
 wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const clocks={clock,wallClock};
 async function distributed(env,{store,seed}={}){
  if(env.HRM_CACHE_ENABLED==='0'||env.HRM_SHARED_CACHE_ENABLED==='0')return reader(env);
  const scope=sharedCacheScope(env),fromSeed=openMaster(env,seed,clocks);
  if(fromSeed)return fromSeed;
  // Only admitted Get requests reach this reader. Prepare local runtime while
  // Neon grants the lease; never navigate/login/read HRM before owning it.
  // Capture speculative failures so a valid DB cache can still be returned.
  const prepared=prepare?Promise.resolve().then(()=>prepare(env)).then(runtime=>({runtime}),error=>({error})):undefined;
  const started=clock(),owner=randomUUID();let attempt=0;
  while(clock()-started<48000){
   const snapshot=store.cacheAcquireWithSnapshot?await store.cacheAcquireWithSnapshot(scope,owner):null;
   if(snapshot?snapshot.acquired:await store.cacheAcquire(scope,owner)){
    let published=false;
    try{
     // Another instance may have published between the seed SELECT and lease acquisition.
     const existing=openMaster(env,snapshot||await store.cacheRead(scope),clocks);
     if(existing)return existing;
     const setup=await prepared;if(setup?.error)throw setup.error;
     const data=await reader(env,setup?{runtime:setup.runtime}:undefined),sealed=sealMaster(env,data,clocks);
     published=await store.cachePublish(scope,owner,sealed.payload,sealed.expiresAt);
     if(!published)throw appError('TRY_AGAIN',429);
     const now=clock();return {password:data.password,remainingMs:Math.floor(Date.parse(sealed.expiresAt)-wallClock()),readAtMs:now,source:'hrm'};
    }finally{if(!published)await store.cacheRelease(scope,owner).catch(()=>{});}
   }
   const existing=openMaster(env,snapshot||await store.cacheRead(scope),clocks);if(existing)return existing;
   await wait(Math.min(800,200+attempt++*150));
  }
  throw appError('TRY_AGAIN',429);
 }
 return createMasterReader({reader:distributed,clock,wallClock});
}
export const readSharedMaster=createSharedMasterReader();
