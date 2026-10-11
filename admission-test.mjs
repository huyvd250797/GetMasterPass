import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createStore} from './lib/store.mjs';
import {authenticate,configStamp,digest} from './lib/security.mjs';
import {handleMasterRequest} from './lib/master-api.mjs';
import {createSharedMasterReader,sharedCacheScope} from './lib/shared-master.mjs';
import {APP_VERSION} from './lib/app-version.mjs';
import {testEnv,testHeaders,token,userId} from './test-support/auth-fixture.mjs';
const origin='https://master-test.invalid';
const req=(headers={})=>new Request(origin+'/api/master-password',{method:'POST',headers:{Origin:origin,'X-Master-Request':'1','X-App-Version':APP_VERSION,...testHeaders,...headers}});
test('atomic admission validates security and writes exactly one outcome per request',async t=>{
 const db=new PGlite();await db.exec(await readFile(new URL('./database/schema.sql',import.meta.url),'utf8'));
 let queries=0;const store=createStore(async(q,p=[])=>{queries++;return (await db.query(q,p)).rows;},()=>{throw new Error('Unexpected transaction');});
 await db.query('INSERT INTO mp_users(id,username,full_name,password_hash) VALUES($1,$2,$3,$4)',[userId,'tester','TEST ONLY','TEST-NOT-USED']);
 await db.query("INSERT INTO mp_sessions(token_hash,role,user_id,username,full_name,auth_version,config_stamp,expires_at) VALUES($1,'user',$2,'tester','TEST ONLY',1,$3,now()+interval '1 hour')",[digest(token),userId,configStamp(testEnv,'user')]);
 const options={env:testEnv,store,logger:()=>{}};
 const counts=async()=>{const r=await db.query('SELECT (SELECT count(*)::int FROM mp_get_gate) AS gates,(SELECT count(*)::int FROM mp_audit) AS audits');return r.rows[0];};
 try{
  await t.test('invalid CSRF fails before SQL, admission or audit',async()=>{
   queries=0;await assert.rejects(authenticate(req({'X-CSRF-Token':'TEST-BAD'}),testEnv,store,{csrf:true,getId:randomUUID()}),e=>e.appCode==='FORBIDDEN');
   assert.equal(queries,0);assert.deepEqual(await counts(),{gates:0,audits:0});
  });
  await t.test('revoked, expired or changed-key sessions never mutate the gate',async()=>{
   for(const mutation of ["UPDATE mp_users SET active=false","UPDATE mp_users SET auth_version=2","UPDATE mp_sessions SET expires_at=now()-interval '1 second'"]){
    await db.exec(mutation);await assert.rejects(authenticate(req(),testEnv,store,{csrf:true,getId:randomUUID()}),e=>e.appCode==='UNAUTHENTICATED');
    assert.deepEqual(await counts(),{gates:0,audits:0});await db.exec("UPDATE mp_users SET active=true,auth_version=1; UPDATE mp_sessions SET expires_at=now()+interval '1 hour'");
   }
   await assert.rejects(authenticate(req(),{...testEnv,SESSION_SECRET:'TEST-CHANGED-KEY-0000000000000000000000000'},store,{getId:randomUUID()}),e=>e.appCode==='UNAUTHENTICATED');assert.deepEqual(await counts(),{gates:0,audits:0});
  });
  await t.test('concurrent admission allows one reader and records one pending plus one denied',async()=>{
   const actors=await Promise.all([1,2].map(()=>authenticate(req(),testEnv,store,{csrf:true,getId:randomUUID()})));
   assert.equal(actors.filter(a=>a.getAdmitted).length,1);assert.ok(actors.every(a=>a.getAdmissionAudited));
   const rows=(await db.query('SELECT status,error_code FROM mp_audit ORDER BY status')).rows;
   assert.deepEqual(rows,[{status:'denied',error_code:'RATE_LIMITED'},{status:'pending',error_code:null}]);assert.deepEqual(await counts(),{gates:1,audits:2});
   let reads=0;const response=await handleMasterRequest(req(),{...options,reader:async()=>{reads++;throw new Error('Must not read');}});
   assert.equal(response.status,429);assert.equal(reads,0);assert.deepEqual(await counts(),{gates:1,audits:3});
  });
  await t.test('cold Get uses four SQL requests; reset uses four again with a new code and expiry',async()=>{
   let reads=0;
   const fast=createSharedMasterReader({reader:async()=>({password:`TEST-FRESH-${++reads}`,remainingMs:90000})});
   try{
    for(let attempt=1;attempt<=2;attempt++){
     await db.exec('DELETE FROM mp_get_gate');
     if(attempt===2){await db.query("UPDATE mp_master_cache SET expires_at=now()-interval '1 second' WHERE scope=$1",[sharedCacheScope(testEnv)]);fast.clear();}
     queries=0;
     const r=await handleMasterRequest(req(),{...options,reader:env=>fast(env,{store})});
     assert.equal(r.status,200);assert.equal((await r.json()).password,`TEST-FRESH-${attempt}`);assert.equal(queries,4);
    }
    assert.equal(reads,2);
   }finally{fast.clear();await db.exec("DELETE FROM mp_audit WHERE status='issued';DELETE FROM mp_get_gate");}
  });
  await t.test('changed admin password prevents admission before any gate or audit write',async()=>{
   const adminToken='b'.repeat(64);
   await db.query("INSERT INTO mp_sessions(token_hash,role,username,full_name,config_stamp,expires_at) VALUES($1,'admin','admin','TEST ADMIN',$2,now()+interval '1 hour')",[digest(adminToken),configStamp(testEnv,'admin')]);
   await assert.rejects(authenticate(req({Cookie:`__Host-mp_session=${adminToken}`}),{...testEnv,ADMIN_PASSWORD:'TEST-CHANGED-PASSWORD'},store,{getId:randomUUID()}),e=>e.appCode==='UNAUTHENTICATED');
   assert.deepEqual(await counts(),{gates:0,audits:3});
  });
 }finally{await db.close();}
});
