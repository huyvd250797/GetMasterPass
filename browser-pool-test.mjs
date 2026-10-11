import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserPool} from './lib/browser-pool.mjs';
import {testEnv} from './test-support/auth-fixture.mjs';
function fixture(){
 let mono=0,wall=0,launches=0;const browsers=[],timers=[];
 const pool=createBrowserPool({clock:()=>mono,wallClock:()=>wall,schedule:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},cancel:timer=>{timer.cancelled=true;}});
 const launch=async()=>{launches++;const b={connected:true,closes:0,close:async()=>{b.closes++;b.connected=false;}};browsers.push(b);return b;};
 return {pool,launch,browsers,timers,get launches(){return launches;},advance:ms=>{mono+=ms;wall+=ms;},suspend:ms=>{wall+=ms;}};
}
test('browser reuse avoids another launch, expires across suspension and credentials, and respects disable',async()=>{
 const f=fixture(),work=async(b,reused)=>reused;
 assert.equal(await f.pool.run(testEnv,f.launch,work),false);
 f.advance(300000);assert.equal(await f.pool.run(testEnv,f.launch,work),true);assert.equal(f.launches,1);
 f.suspend(600001);assert.equal(await f.pool.run(testEnv,f.launch,work),false);assert.equal(f.browsers[0].closes,1);
 assert.equal(await f.pool.run({...testEnv,HRM_PASSWORD:'TEST-CHANGED'},f.launch,work),false);assert.equal(f.browsers[1].closes,1);
 await f.pool.run({...testEnv,HRM_BROWSER_REUSE:'0'},f.launch,work);assert.equal(f.browsers[2].closes,1);assert.equal(f.browsers[3].closes,1);
 await f.pool.clear();
});
test('absolute browser lifetime is bounded even with frequent successful reads',async()=>{
 const f=fixture(),work=async()=>{};
 await f.pool.run(testEnv,f.launch,work);
 for(let i=0;i<5;i++){f.advance(300000);await f.pool.run(testEnv,f.launch,work);}
 assert.equal(f.launches,1);f.advance(300000);await f.pool.run(testEnv,f.launch,work);
 assert.equal(f.launches,2);assert.equal(f.browsers[0].closes,1);await f.pool.clear();
});
test('disconnected or failed browsers are discarded without silently retrying HRM',async()=>{
 const f=fixture();await f.pool.run(testEnv,f.launch,async()=>{});f.browsers[0].connected=false;
 await assert.rejects(f.pool.run(testEnv,f.launch,async()=>{throw new Error('TEST-REJECTED');}),/TEST-REJECTED/);
 assert.equal(f.launches,2);assert.equal(f.browsers[0].closes,1);assert.equal(f.browsers[1].closes,1);
 await f.pool.run(testEnv,f.launch,async()=>{});assert.equal(f.launches,3);await f.pool.clear();
});
test('concurrent borrowers use separate browsers and never share a clipboard',async()=>{
 const f=fixture();let release,entered;const ready=new Promise(r=>entered=r),pending=new Promise(r=>release=r);
 const first=f.pool.run(testEnv,f.launch,async browser=>{entered(browser);await pending;return browser;});
 const a=await ready,b=await f.pool.run(testEnv,f.launch,async browser=>browser);
 assert.notEqual(a,b);assert.equal(b.closes,1);assert.equal(a.closes,0);release();assert.equal(await first,a);
 assert.equal(await f.pool.run(testEnv,f.launch,async browser=>browser),a);assert.equal(f.launches,2);await f.pool.clear();
});
test('idle cleanup and clear during active work close only after the read completes',async()=>{
 const f=fixture();await f.pool.run(testEnv,f.launch,async()=>{});f.timers.at(-1).fn();await Promise.resolve();assert.equal(f.browsers[0].closes,1);
 let release,entered;const ready=new Promise(r=>entered=r),pending=new Promise(r=>release=r);
 const first=f.pool.run(testEnv,f.launch,async()=>{entered();await pending;return 'TEST-DONE';});await ready;
 await f.pool.clear();assert.equal(f.browsers[1].closes,0);release();assert.equal(await first,'TEST-DONE');assert.equal(f.browsers[1].closes,1);
});
