import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {appError} from './http.mjs';
import {readMasterFromHrm} from './hrm-browser.mjs';

// Private RAM only: no cookie, database, disk, CDN or browser storage.
// This is a shared HRM master for authenticated app users. Authorization,
// per-user admission and durable audit remain in master-api for EVERY request.
export function createMasterReader({reader=readMasterFromHrm,clock=()=>performance.now(),wallClock=()=>Date.now(),
 schedule=setTimeout,cancel=clearTimeout}={}){
 let state;
 const remaining=(entry,now=clock())=>Math.floor(entry.lifetime-Math.max(0,now-entry.started,wallClock()-entry.wallStarted));
 function clear(){if(state?.timer)cancel(state.timer);state=undefined;}
 const sample=(entry,source)=>{const now=clock();return {password:entry.password,remainingMs:remaining(entry,now),readAtMs:now,source};};
 async function read(env,context){
  if(!env.HRM_USERNAME||!env.HRM_PASSWORD){clear();throw appError('NOT_CONFIGURED',503);}
  if(env.HRM_CACHE_ENABLED==='0'){clear();return reader(env,context);}
  const key=createHash('sha256').update(JSON.stringify([env.HRM_USERNAME,env.HRM_PASSWORD,env.SESSION_SECRET,env.HRM_SHARED_CACHE_ENABLED,env.VERCEL,env.LOCAL_CHROME_PATH,env.HRM_LIGHTWEIGHT_BROWSER])).digest('hex');
  if(state?.key!==key){clear();state={key,entry:null,pending:null,timer:null};}
  const current=state;
  // Stop reuse 3s before the conservative observed expiry. Never reset to 300s.
  if(current.entry&&remaining(current.entry)>3000)return sample(current.entry,'memory');
  if(current.timer)cancel(current.timer);current.timer=null;current.entry=null;
  const shared=!!current.pending;
  if(!current.pending){
   current.pending=Promise.resolve().then(()=>reader(env,context)).then(data=>{
    if(typeof data?.password!=='string'||!data.password.trim()||data.password.length>4096||
      !Number.isFinite(data.remainingMs)||data.remainingMs<1000||data.remainingMs>300000)throw appError('INVALID_RESPONSE',502);
    const now=clock();
    const lifetime=Math.floor(data.remainingMs-Math.max(0,
     Number.isFinite(data.readAtMs)?now-data.readAtMs:0,
     Number.isFinite(data.readAtWallMs)?wallClock()-data.readAtWallMs:0));
    if(lifetime<1000)throw appError('INVALID_RESPONSE',502);
    const entry={password:data.password,lifetime,started:now,wallStarted:wallClock(),source:data.source==='database'?'database':'hrm'};
    if(state===current&&lifetime>3000){
     current.entry=entry;
     current.timer=schedule(()=>{if(current.entry===entry){current.entry=null;current.timer=null;}},lifetime-3000);
     current.timer?.unref?.();
    }
    return entry;
   }).finally(()=>{current.pending=null;});
  }
  const entry=await current.pending;
  if(remaining(entry)<1000)throw appError('INVALID_RESPONSE',502);
  return sample(entry,shared?'shared':entry.source);
 }
 read.clear=clear;
 return read;
}
export const readMasterFast=createMasterReader();
