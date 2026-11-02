import test from 'node:test';
import assert from 'node:assert/strict';
import {hrmTarget,DEFAULT_HRM_URL} from './lib/hrm-config.mjs';
import {sharedCacheScope} from './lib/shared-master.mjs';
import {createMasterReader} from './lib/master-cache.mjs';
import {createBrowserPool} from './lib/browser-pool.mjs';
const env={HRM_USERNAME:'TEST',HRM_PASSWORD:'TEST-ONLY',SESSION_SECRET:'test-only-secret-for-configuration',VERCEL:'1'};
test('HRM URL defaults, normalizes and rejects invalid configured values',()=>{
 assert.equal(hrmTarget({}).home,DEFAULT_HRM_URL);
 assert.equal(hrmTarget({HRM_URL:' https://HRM-NEW.example:443/Portal/HeThong '}).home,'https://hrm-new.example/Portal/HeThong');
 for(const HRM_URL of ['', ' ', 'not-a-url','http://hrm.example/HeThong','https://user:pass@hrm.example/','https://hrm.example/?x=1','https://hrm.example/#section','file:///tmp/a'])
  assert.throws(()=>hrmTarget({HRM_URL}),e=>e.appCode==='NOT_CONFIGURED');
});
test('shared cache scope changes with source URL, including path; equivalent URLs share scope',()=>{
 const a=sharedCacheScope(env);
 assert.equal(a,sharedCacheScope({...env,HRM_URL:DEFAULT_HRM_URL}));
 assert.notEqual(a,sharedCacheScope({...env,HRM_URL:'https://new.example/HeThong'}));
 assert.notEqual(a,sharedCacheScope({...env,HRM_URL:'https://hrm.ascvn.com.vn/Other'}));
});
test('memory cache cannot return a master from a previous HRM URL',async()=>{
 let reads=0;const read=createMasterReader({reader:async()=>({password:'TEST-'+(++reads),remainingMs:90000})});
 try{
  const a=await read(env);assert.equal((await read(env)).password,a.password);
  const b=await read({...env,HRM_URL:'https://new.example/HeThong'});assert.notEqual(a.password,b.password);assert.equal(reads,2);
  await assert.rejects(read({...env,HRM_URL:'bad'}),e=>e.appCode==='NOT_CONFIGURED');
 }finally{read.clear();}
});
test('browser pool retires old authenticated browser when HRM URL changes',async()=>{
 const pool=createBrowserPool();let launches=0,closes=0;
 const launch=async()=>{launches++;return {connected:true,close:async()=>{closes++;}};};
 try{
  await pool.run(env,launch,async()=>{});await pool.run(env,launch,async()=>{});assert.equal(launches,1);
  await pool.run({...env,HRM_URL:'https://new.example/HeThong'},launch,async()=>{});
  assert.equal(launches,2);assert.equal(closes,1);
 }finally{await pool.clear();}
});
