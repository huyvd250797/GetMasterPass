import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createStore} from './lib/store.mjs';
import {handleAuthRequest,handleAdminRequest,handleHistoryRequest} from './lib/auth-api.mjs';
import {handleMasterRequest} from './lib/master-api.mjs';
import {testEnv} from './test-support/auth-fixture.mjs';
import {APP_VERSION} from './lib/app-version.mjs';
const origin='https://master-test.invalid';
function req(path,auth,body){return new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'X-Master-Request':'1','X-App-Version':APP_VERSION,'Content-Type':'application/json',Cookie:auth?.cookie||'','X-CSRF-Token':auth?.csrf||''},...(body?{body:JSON.stringify(body)}:{})});}
test('PostgreSQL integration: accounts, sessions, revocation, audit and concurrency',async t=>{
 const db=new PGlite();await db.exec(await readFile(new URL('./database/schema.sql',import.meta.url),'utf8'));
 const store=createStore(async(q,p=[])=>(await db.query(q,p)).rows,statements=>db.transaction(async tx=>{
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
   for(const [username,password,status]of [['tester','TEST-USER-ONLY-123',409],['admin','TEST-USER-ONLY-123',400],['another','short',400]]){
    const r=await handleAdminRequest(req('/api/admin',admin,{action:'create',username,fullName:'TEST',password}),options);assert.equal(r.status,status);
   }
  });
  await t.test('get master is attributed by verified session, counted and contains no stored secret',async()=>{
   const r=await handleMasterRequest(req('/api/master-password',user,{}),{...options,reader:async()=>({password:'TEST-MASTER-SECRET',remainingMs:90000})});
   assert.equal(r.status,200);assert.equal((await r.json()).password,'TEST-MASTER-SECRET');
   const rows=await store.query("SELECT * FROM mp_audit WHERE action='GET_MASTER'");assert.equal(rows.length,1);assert.equal(rows[0].actor_key,userId);assert.equal(rows[0].status,'issued');
   assert.doesNotMatch(JSON.stringify(rows),/TEST-MASTER-SECRET|TEST-USER-ONLY/);
   const history=await handleHistoryRequest(req('/api/history?actor=admin',user),options);const data=await history.json();assert.equal(data.stats.issued,1);assert.equal(data.items[0].username,'tester');
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
 }finally{await db.close();}
});
