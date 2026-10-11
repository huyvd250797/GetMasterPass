import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createStore} from './lib/store.mjs';
import {sealMaster,openMaster,sharedCacheScope,createSharedMasterReader} from './lib/shared-master.mjs';
import {testEnv} from './test-support/auth-fixture.mjs';
const wall=1700000000000;
const clocks={clock:()=>1500,wallClock:()=>wall};
test('shared ciphertext authenticates the code, expiry and account/key scope; time never resets',()=>{
 const sealed=sealMaster(testEnv,{password:'TEST-CACHE-SECRET',remainingMs:90000},clocks);
 assert.ok(!sealed.payload.includes('TEST-CACHE-SECRET'));
 const row={payload:sealed.payload,expires_at:sealed.expiresAt,remaining_ms:90000,read_at_ms:1500};
 const value=openMaster(testEnv,row,{clock:()=>4500,wallClock:()=>wall+1000});
 assert.equal(value.password,'TEST-CACHE-SECRET');assert.equal(value.remainingMs,87000);
 for(const bad of [{...row,payload:row.payload.slice(0,-3)+'AAA'},{...row,expires_at:new Date(wall+120000).toISOString()},{...row,remaining_ms:2000},{...row,read_at_ms:NaN}])assert.equal(openMaster(testEnv,bad,clocks),null);
 for(const env of [{...testEnv,SESSION_SECRET:'x'.repeat(40)},{...testEnv,HRM_PASSWORD:'OTHER-TEST'}])assert.equal(openMaster(env,row,clocks),null);
 assert.equal(openMaster(testEnv,row,{clock:()=>1500,wallClock:()=>wall+90001}),null);
 assert.throws(()=>sealMaster(testEnv,{password:'TEST',remainingMs:300001},clocks));
});
test('PostgreSQL lease merges two independent instances and the next instance uses ciphertext without HRM',async()=>{
 const db=new PGlite();await db.exec(await readFile(new URL('./database/schema.sql',import.meta.url),'utf8'));
 const store=createStore(async(q,p=[])=>(await db.query(q,p)).rows,()=>{throw Error('unused');});
 let reads=0,release,started;const began=new Promise(r=>{started=r;});const gate=new Promise(r=>{release=r;});
 const raw=async()=>{reads++;started();await gate;return {password:'TEST-DISTRIBUTED-MASTER',remainingMs:90000,readAtMs:performance.now()};};
 const a=createSharedMasterReader({reader:raw}),b=createSharedMasterReader({reader:raw}),c=createSharedMasterReader({reader:raw});
 try{
  const first=a(testEnv,{store});await began;const second=b(testEnv,{store});release();
  const results=await Promise.all([first,second]);assert.equal(reads,1);assert.equal(results[0].password,results[1].password);
  assert.equal(results[1].source,'database');
  const row=await store.cacheRead(sharedCacheScope(testEnv));assert.ok(row.payload);assert.doesNotMatch(JSON.stringify(row),/TEST-DISTRIBUTED-MASTER/);
  const third=await c(testEnv,{store,seed:row});assert.equal(third.source,'database');assert.equal(reads,1);assert.ok(third.remainingMs<=90000);
  const owner=randomUUID(),other=randomUUID();assert.equal(await store.cacheAcquire(row.scope||sharedCacheScope(testEnv),owner),true);
  assert.equal(await store.cacheAcquire(sharedCacheScope(testEnv),other),false);
  assert.equal(await store.cachePublish(sharedCacheScope(testEnv),other,'INVALID',new Date(Date.now()+90000)),false);
  await store.cacheRelease(sharedCacheScope(testEnv),other);assert.equal(await store.cacheAcquire(sharedCacheScope(testEnv),other),false);
  await store.cacheRelease(sharedCacheScope(testEnv),owner);assert.equal(await store.cacheAcquire(sharedCacheScope(testEnv),other),true);
 }finally{a.clear();b.clear();c.clear();await db.close();}
});
test('failed HRM read releases its lease; disabling shared cache uses the original reader',async()=>{
 let releases=0,calls=0;
 const store={cacheAcquire:async()=>true,cacheRead:async()=>null,cacheRelease:async()=>{releases++;},cachePublish:async()=>true};
 const reader=createSharedMasterReader({reader:async()=>{if(++calls===1)throw Error('TEST failure');return {password:'TEST-RECOVERED',remainingMs:90000};}});
 try{
  await assert.rejects(reader(testEnv,{store}));assert.equal(releases,1);
  assert.equal((await reader(testEnv,{store})).password,'TEST-RECOVERED');
  await reader({...testEnv,HRM_SHARED_CACHE_ENABLED:'0'});assert.equal(calls,3);
 }finally{reader.clear();}
});
test('cold runtime preparation overlaps the atomic lease query, while HRM waits for both',async()=>{
 let prepared,claimed,resolveSetup,resolveLease,reads=0,publishes=0;
 const setupStarted=new Promise(r=>prepared=r),leaseStarted=new Promise(r=>claimed=r);
 const setup=new Promise(r=>resolveSetup=r),lease=new Promise(r=>resolveLease=r);
 const runtime={marker:'TEST-RUNTIME'};
 const store={cacheAcquireWithSnapshot:async()=>{claimed();return lease;},cachePublish:async()=>{publishes++;return true;},cacheRelease:async()=>{},cacheRead:async()=>{throw Error('Redundant SQL');}};
 const fast=createSharedMasterReader({prepare:async()=>{prepared();return setup;},reader:async(env,options)=>{reads++;assert.equal(options.runtime,runtime);return {password:'TEST-COLD',remainingMs:90000};}});
 try{
  const result=fast(testEnv,{store});await Promise.all([setupStarted,leaseStarted]);assert.equal(reads,0);
  resolveSetup(runtime);await Promise.resolve();assert.equal(reads,0);resolveLease({acquired:true});
  assert.equal((await result).password,'TEST-COLD');assert.equal(reads,1);assert.equal(publishes,1);
 }finally{fast.clear();}
});
test('cache published before claim skips HRM despite failed speculative runtime preparation',async()=>{
 let reads=0,releases=0;
 const sealed=sealMaster(testEnv,{password:'TEST-CACHE-WON',remainingMs:90000});
 const snapshot={acquired:true,payload:sealed.payload,expires_at:sealed.expiresAt,remaining_ms:90000,read_at_ms:performance.now()};
 const fast=createSharedMasterReader({prepare:async()=>{throw Error('TEST-UNAVAILABLE');},reader:async()=>{reads++;}});
 try{
  const result=await fast(testEnv,{store:{cacheAcquireWithSnapshot:async()=>snapshot,cacheRelease:async()=>{releases++;},cacheRead:async()=>{throw Error('Redundant SQL');}}});
  assert.equal(result.password,'TEST-CACHE-WON');assert.equal(reads,0);assert.equal(releases,1);
 }finally{fast.clear();}
});
test('failed preparation releases the owned lease and never navigates HRM',async()=>{
 let reads=0,releases=0;
 const fast=createSharedMasterReader({prepare:async()=>{throw Error('TEST-UNAVAILABLE');},reader:async()=>{reads++;}});
 try{
  await assert.rejects(fast(testEnv,{store:{cacheAcquireWithSnapshot:async()=>({acquired:true}),cacheRelease:async()=>{releases++;}}}),/TEST-UNAVAILABLE/);
  assert.equal(reads,0);assert.equal(releases,1);
 }finally{fast.clear();}
});
