import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
// One idle authenticated browser per instance. Concurrent borrowers use isolated
// browsers so process-wide clipboard operations never race in the same browser.
export function createBrowserPool({clock=()=>performance.now(),wallClock=()=>Date.now(),schedule=setTimeout,cancel=clearTimeout}={}){
 let state;
 const key=env=>createHash('sha256').update(JSON.stringify([env.HRM_USERNAME,env.HRM_PASSWORD,env.SESSION_SECRET,env.VERCEL,env.LOCAL_CHROME_PATH])).digest('hex');
 const age=(mono,wall)=>Math.max(0,clock()-mono,wallClock()-wall);
 const dispose=async entry=>{if(entry.timer)cancel(entry.timer);entry.timer=null;if(state===entry)state=undefined;await entry.browser?.close().catch(()=>{});};
 const healthy=entry=>entry.browser?.connected!==false&&age(entry.created,entry.createdWall)<1800000&&age(entry.used,entry.usedWall)<600000;
 async function run(env,launch,work){
  if(env.VERCEL!=='1'||env.HRM_BROWSER_REUSE==='0'){
   if(state){state.retire=true;if(!state.active)await dispose(state);}
   const browser=await launch();try{return await work(browser,false);}finally{await browser.close().catch(()=>{});}
  }
  const scope=key(env);let entry=state,previous;
  if(entry?.active){const browser=await launch();try{return await work(browser,false);}finally{await browser.close().catch(()=>{});}}
  if(entry&&(entry.key!==scope||!healthy(entry))){previous=entry;entry=undefined;}
  if(!entry){entry={key:scope,browser:null,active:true,created:clock(),createdWall:wallClock(),used:clock(),usedWall:wallClock(),timer:null};state=entry;}
  else{entry.active=true;if(entry.timer)cancel(entry.timer);entry.timer=null;}
  try{
   if(previous)await dispose(previous);
   const reused=!!entry.browser;entry.browser??=await launch();
   const result=await work(entry.browser,reused);
   entry.used=clock();entry.usedWall=wallClock();entry.active=false;
   if(entry.retire){await dispose(entry);return result;}
   entry.timer=schedule(()=>{if(state===entry&&!entry.active)void dispose(entry);},Math.min(600000,Math.max(1,1800000-age(entry.created,entry.createdWall))));entry.timer?.unref?.();
   return result;
  }catch(error){entry.active=false;await dispose(entry);throw error;}
 }
 return {run,clear:async()=>{if(state){state.retire=true;if(!state.active)await dispose(state);}}};
}
export const hrmBrowserPool=createBrowserPool();
