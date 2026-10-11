import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createStore} from './lib/store.mjs';
import {handleAuthRequest,handleAdminRequest,handleHistoryRequest} from './lib/auth-api.mjs';
import {handleMasterRequest} from './lib/master-api.mjs';
import {testEnv} from './test-support/auth-fixture.mjs';
import {sealMaster,sharedCacheScope} from './lib/shared-master.mjs';
import {APP_VERSION} from './lib/app-version.mjs';
const origin='https://master-test.invalid';
function req(path,auth,body){return new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'X-Master-Request':'1','X-App-Version':APP_VERSION,'Content-Type':'application/json',Cookie:auth?.cookie||'','X-CSRF-Token':auth?.csrf||''},...(body?{body:JSON.stringify(body)}:{})});}
test('PostgreSQL integration: accounts, sessions, revocation, audit and concurrency',async t=>{
 const db=new PGlite();await db.exec(await readFile(new URL('./database/schema.sql',import.meta.url),'utf8'));
 let queries=0;
 const store=createStore(async(q,p=[])=>{queries++;return (await db.query(q,p)).rows;},statements=>db.transaction(async tx=>{
  const results=[];for(const [q,p]of statements)results.push((await tx.query(q,p)).rows);return results;
 }));
 const options={env:testEnv,store};let admin,user,userId;
 async function login(username,password){const r=await handleAuthRequest(req('/api/auth',null,{action:'login',username,password}),options);assert.equal(r.status,200);const d=await r.json();return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:d.csrfToken,user:d.user};}
 try{
  await t.test('environment admin creates an individually named account',async()=>{
   admin=await login('ADMIN',testEnv.ADMIN_PASSWORD);assert.equal(admin.user.role,'admin');
   const r=await handleAdminRequest(req('/api/admin',admin,{action:'create',username:'Tester',fullName:'TEST PERSON',password:'TEST-USER-ONLY-123'}),options);
   assert.equal(r.status,201);user=await login('tester','TEST-USER-ONLY-123');userId=user.user.id;
   const rows=await store.query('SELECT * FROM mp_users');assert.match(rows[0].password_hash,/^scrypt\$/);assert.ok(!rows[0].password_hash.includes('TEST-USER'));
   const response=await handleAdminRequest(req('/api/admin',admin),options);assert.doesNotMatch(await response.text(),/password_hash|scrypt|TEST-USER/);
  });
  await t.test('duplicate/reserved username and invalid password are rejected',async()=>{
   for(const [username,password,status]of [['tester','TEST-USER-ONLY-123',409],['admin','TEST-USER-ONLY-123',400],['another','abc',400]]){
    const r=await handleAdminRequest(req('/api/admin',admin,{action:'create',username,fullName:'TEST',password}),options);assert.equal(r.status,status);
   }
  });
  await t.test('get master is attributed by verified session, counted and contains no stored secret',async()=>{
   const r=await handleMasterRequest(req('/api/master-password',user,{}),{...options,reader:async()=>({password:'TEST-MASTER-SECRET',remainingMs:90000})});
   assert.equal(r.status,200);assert.equal((await r.json()).password,'TEST-MASTER-SECRET');
   const rows=await store.query("SELECT * FROM mp_audit WHERE action='GET_MASTER'");assert.equal(rows.length,1);assert.equal(rows[0].actor_key,userId);assert.equal(rows[0].status,'issued');
   assert.doesNotMatch(JSON.stringify(rows),/TEST-MASTER-SECRET|TEST-USER-ONLY/);
   assert.equal((await handleHistoryRequest(req('/api/history?actor=admin',user),options)).status,403);
   const history=await handleHistoryRequest(req('/api/history?actor='+userId,admin),options);const data=await history.json();assert.equal(data.stats.issued,1);assert.equal(data.items[0].username,'tester');
   const users=await store.users();assert.equal(users[0].get_count,1);
  });
  await t.test('atomic get gate admits only one simultaneous request',async()=>{
   await store.query("UPDATE mp_get_gate SET started_at=now()-interval '20 seconds',busy_until=now()-interval '1 second'");
   const actor={actorKey:userId,username:'tester',fullName:'TEST PERSON'};
   const results=await Promise.all([store.beginGet(actor,randomUUID()),store.beginGet(actor,randomUUID())]);assert.equal(results.filter(Boolean).length,1);
   const rows=await store.query("SELECT count(*)::int AS n FROM mp_audit WHERE action='GET_MASTER'");assert.equal(rows[0].n,2);
  });
  await t.test('lock revokes sessions, unlock does not restore old sessions',async()=>{
   assert.equal((await handleAdminRequest(req('/api/admin',admin,{action:'toggle',id:userId,active:false}),options)).status,200);
   assert.equal((await handleAuthRequest(req('/api/auth',user),options)).status,401);
   assert.equal((await handleAdminRequest(req('/api/admin',admin,{action:'toggle',id:userId,active:true}),options)).status,200);
   assert.equal((await handleAuthRequest(req('/api/auth',user),options)).status,401);
   user=await login('tester','TEST-USER-ONLY-123');
  });
  await t.test('password reset invalidates sessions; wrong credentials and logout work',async()=>{
   assert.equal((await handleAdminRequest(req('/api/admin',admin,{action:'reset',id:userId,password:'NEW-TEST-ONLY-PASS'}),options)).status,200);
   assert.equal((await handleAuthRequest(req('/api/auth',user),options)).status,401);
   assert.equal((await handleAuthRequest(req('/api/auth',null,{action:'login',username:'tester',password:'TEST-USER-ONLY-123'}),options)).status,401);
   user=await login('tester','NEW-TEST-ONLY-PASS');
   assert.equal((await handleAuthRequest(req('/api/auth',user,{action:'logout'}),options)).status,200);
   assert.equal((await handleAuthRequest(req('/api/auth',user),options)).status,401);
  });
  await t.test('missing audit row is not mistaken for a successful durable write',async()=>{
   await assert.rejects(store.finishGet({actorKey:userId},randomUUID(),'issued'),e=>e.appCode==='AUDIT_UNAVAILABLE');
  });
  await t.test('distributed rate limit and bounded history SQL behave correctly',async()=>{
   assert.equal(await store.rate('test-limit',2,60),true);assert.equal(await store.rate('test-limit',2,60),true);assert.equal(await store.rate('test-limit',2,60),false);
   const result=await store.history({actorKey:'not-a-user'});assert.equal(result.stats.total,0);
   const limited=await store.history({offset:50});assert.equal(limited.items.length,0);
   assert.equal((await handleAdminRequest(req('/api/admin',admin,{action:'toggle',id:randomUUID(),active:false}),options)).status,404);
  });
  await t.test('four-character user passwords work for account creation, login and reset with session revocation',async()=>{
   const created=await handleAdminRequest(req('/api/admin',admin,{action:'create',username:'user4',fullName:'TEST SHORT POLICY',password:'abcd'}),options);
   assert.equal(created.status,201);const short=await login('user4','abcd');
   const reset=await handleAdminRequest(req('/api/admin',admin,{action:'reset',id:short.user.id,password:'wxyz'}),options);
   assert.equal(reset.status,200);assert.equal((await handleAuthRequest(req('/api/auth',short),options)).status,401);
   await login('user4','wxyz');
  });
  await t.test('users change only their own password, revoke all sessions, and admin cannot use this endpoint',async()=>{
   const a=await login('user4','wxyz'),b=await login('user4','wxyz');
   const body={action:'change_password',currentPassword:'wxyz',newPassword:'1234',id:userId,username:'tester'};
   assert.equal((await handleAuthRequest(req('/api/auth',admin,body),options)).status,403);
   assert.equal((await handleAuthRequest(req('/api/auth',a,{...body,currentPassword:'wrong'}),options)).status,400);
   assert.equal((await handleAuthRequest(req('/api/auth',a,{...body,newPassword:'abc'}),options)).status,400);
   const changed=await handleAuthRequest(req('/api/auth',a,body),options);assert.equal(changed.status,200);assert.match(changed.headers.get('set-cookie'),/Max-Age=0/);
   assert.equal((await handleAuthRequest(req('/api/auth',a),options)).status,401);assert.equal((await handleAuthRequest(req('/api/auth',b),options)).status,401);
   await login('user4','1234');assert.equal((await store.userByName('tester')).password_hash.includes('1234'),false);
   assert.equal((await store.query("SELECT count(*)::int AS n FROM mp_audit WHERE action='PASSWORD_CHANGE'"))[0].n,1);
  });
  await t.test('optimized verification blocks revocation during HRM read',async()=>{
   const a=await login('user4','1234');
   const r=await handleMasterRequest(req('/api/master-password',a,{}),{...options,logger:()=>{},reader:async()=>{
    await handleAdminRequest(req('/api/admin',admin,{action:'toggle',id:a.user.id,active:false}),options);
    return {password:'TEST-BLOCKED-MASTER',remainingMs:90000};
   }});assert.equal(r.status,401);assert.doesNotMatch(await r.text(),/TEST-BLOCKED-MASTER/);
  });
  await t.test('warm production route returns encrypted shared cache using exactly two SQL requests',async()=>{
   const scope=sharedCacheScope(testEnv),lease=randomUUID();
   const sealed=sealMaster(testEnv,{password:'TEST-PRODUCTION-CACHE',remainingMs:90000});
   assert.equal(await store.cacheAcquire(scope,lease),true);assert.equal(await store.cachePublish(scope,lease,sealed.payload,sealed.expiresAt),true);
   queries=0;const r=await handleMasterRequest(req('/api/master-password',admin,{}),{...options,logger:()=>{}});
   assert.equal(r.status,200);assert.equal((await r.json()).password,'TEST-PRODUCTION-CACHE');assert.equal(queries,2);
   const row=await store.sessionWithCache('invalid-token',scope);assert.equal(row,undefined);
  });
  await t.test('history deletion is admin-only, confirms all, retains active requests and other audit actions',async()=>{
   const pending=(await store.query("SELECT id FROM mp_audit WHERE action='GET_MASTER' AND status='pending'"))[0].id;
   const issued=(await store.query("SELECT id FROM mp_audit WHERE status='issued'"))[0].id;
   const a=await login('tester','NEW-TEST-ONLY-PASS');
   assert.equal((await handleHistoryRequest(req('/api/history',a,{action:'delete_one',id:issued}),options)).status,403);
   assert.equal((await handleHistoryRequest(req('/api/history',admin,{action:'delete_all'}),options)).status,400);
   assert.equal((await handleHistoryRequest(req('/api/history',admin,{action:'delete_one',id:pending}),options)).status,409);
   const r=await handleHistoryRequest(req('/api/history',admin,{action:'delete_one',id:issued}),options);assert.equal(r.status,200);assert.equal((await r.json()).deleted,1);
   assert.equal((await store.users()).find(u=>u.id===userId).get_count,0);
   assert.equal((await handleHistoryRequest(req('/api/history',admin,{action:'delete_all',confirm:'DELETE_ALL_GET_HISTORY'}),options)).status,200);
   assert.equal((await store.query("SELECT count(*)::int AS n FROM mp_audit WHERE action='GET_MASTER'"))[0].n,1);
   await store.query("UPDATE mp_audit SET requested_at=now()-interval '70 seconds' WHERE id=$1",[pending]);
   assert.equal((await store.history({})).items[0].status,'interrupted');
   assert.equal(await store.deleteHistory({actorKey:'admin',username:'admin',fullName:'TEST ADMIN'},pending),1);
   assert.ok((await store.query("SELECT count(*)::int AS n FROM mp_audit WHERE action='LOGIN'"))[0].n>0);
   assert.ok((await store.query("SELECT count(*)::int AS n FROM mp_audit WHERE action LIKE 'HISTORY_DELETE_%'"))[0].n>=3);
  });
 }finally{await db.close();}
});
