import test from 'node:test';
import assert from 'node:assert/strict';
import {createMasterReader} from './lib/master-cache.mjs';
const env={VERCEL:'1',HRM_USERNAME:'TEST-ONLY',HRM_PASSWORD:'TEST-HRM-ONLY'};
function fixture(reader){
 let now=10000,wall=100000,reads=0;const timers=new Map();let timerId=0;
 const read=createMasterReader({reader:async e=>{reads++;return reader?reader(e):{password:'TEST-'+reads,remainingMs:90000,readAtMs:now-500};},
  clock:()=>now,wallClock:()=>wall,schedule:(cb,delay)=>{const id=++timerId;timers.set(id,{cb,delay});return id;},cancel:id=>timers.delete(id)});
 return {read,timers,get reads(){return reads;},advance(ms){now+=ms;wall+=ms;},wallAdvance(ms){wall+=ms;}};
}
test('warm reads skip HRM and keep the original expiry after browser cleanup and elapsed time',async()=>{
 const h=fixture();const first=await h.read(env);assert.equal(first.remainingMs,89500);assert.equal(first.source,'hrm');
 h.advance(10000);const next=await h.read(env);assert.equal(h.reads,1);assert.equal(next.password,first.password);
 assert.equal(next.remainingMs,79500);assert.equal(next.source,'memory');
 h.advance(77000);const renewed=await h.read(env);assert.equal(h.reads,2);assert.notEqual(renewed.password,first.password);
 h.read.clear();assert.equal(h.timers.size,0);
});
test('simultaneous cache misses share one normal HRM read and return independent result objects',async()=>{
 let resolve;const h=fixture(()=>new Promise(r=>{resolve=r;}));
 const a=h.read(env),b=h.read(env);await new Promise(r=>setImmediate(r));assert.equal(h.reads,1);
 resolve({password:'TEST-SHARED',remainingMs:90000});const [x,y]=await Promise.all([a,b]);
 assert.equal(x.source,'hrm');assert.equal(y.source,'shared');assert.notEqual(x,y);
 x.password='ALTERED';assert.equal(y.password,'TEST-SHARED');assert.equal((await h.read(env)).password,'TEST-SHARED');h.read.clear();
});
test('credential changes, explicit disable and missing credentials cannot reuse the old code',async()=>{
 const h=fixture();await h.read(env);await h.read({...env,HRM_PASSWORD:'CHANGED-TEST-ONLY'});assert.equal(h.reads,2);
 await h.read({...env,HRM_CACHE_ENABLED:'0'});await h.read({...env,HRM_CACHE_ENABLED:'0'});assert.equal(h.reads,4);
 await h.read(env);await assert.rejects(h.read({...env,HRM_PASSWORD:''}),e=>e.appCode==='NOT_CONFIGURED');
 await h.read(env);assert.equal(h.reads,6);h.read.clear();
});
test('failed and invalid reads are not cached; the next request can recover',async()=>{
 let calls=0;const h=fixture(async()=>{
  calls++;if(calls===1)throw new Error('TEST failure');if(calls===2)return {password:'TEST',remainingMs:300001};
  return {password:'TEST-RECOVERED',remainingMs:90000};
 });
 await assert.rejects(h.read(env));await assert.rejects(h.read(env),e=>e.appCode==='INVALID_RESPONSE');
 assert.equal((await h.read(env)).password,'TEST-RECOVERED');assert.equal(h.reads,3);h.read.clear();
});
test('wall-clock expiry invalidates a cache after instance suspension; scheduled cleanup removes it too',async()=>{
 const h=fixture();await h.read(env);h.wallAdvance(90000);await h.read(env);assert.equal(h.reads,2);
 const {cb,delay}=[...h.timers.values()].at(-1);assert.equal(delay,86500);cb();
 await h.read(env);assert.equal(h.reads,3);h.read.clear();
});
test('an earlier credential generation finishing late cannot overwrite a newer account cache',async()=>{
 let resolve;const h=fixture(e=>e.HRM_PASSWORD===env.HRM_PASSWORD?new Promise(r=>{resolve=r;}):{password:'TEST-NEW',remainingMs:90000});
 const old=h.read(env);await new Promise(r=>setImmediate(r));const changed={...env,HRM_PASSWORD:'CHANGED-TEST-ONLY'};
 await h.read(changed);resolve({password:'TEST-OLD',remainingMs:90000});await old;
 assert.equal((await h.read(changed)).password,'TEST-NEW');assert.equal(h.reads,2);h.read.clear();
});
