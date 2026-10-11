import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createStore} from './lib/store.mjs';
import {handleAuthRequest,handleAdminRequest} from './lib/auth-api.mjs';
import {handleMasterRequest} from './lib/master-api.mjs';
import {digest} from './lib/security.mjs';
import {APP_VERSION} from './lib/app-version.mjs';
import {testEnv} from './test-support/auth-fixture.mjs';
const origin='https://master-test.invalid';
const req=(path,auth,body,headers={})=>new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'X-Master-Request':'1','X-App-Version':APP_VERSION,'Content-Type':'application/json',Cookie:auth?.cookie||'','X-CSRF-Token':auth?.csrf||'',...headers},...(body?{body:JSON.stringify(body)}:{})});
test('PostgreSQL session policy: durable admin setting, absolute expiry, cookies and HRM authorization',async t=>{
 const db=new PGlite();const schema=await readFile(new URL('./database/schema.sql',import.meta.url),'utf8');
 await db.exec(schema);
 const store=createStore(async(q,p=[])=>{return (await db.query(q,p)).rows;},statements=>db.transaction(async tx=>{
  const rows=[];for(const [q,p] of statements)rows.push((await tx.query(q,p)).rows);return rows;
 }));
 const options={env:testEnv,store};let admin,user,originalExpiry;
 const login=async(username,password)=>{
  const r=await handleAuthRequest(req('/api/auth',null,{action:'login',username,password}),options);
  assert.equal(r.status,200);const data=await r.json();
  return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:data.csrfToken,data,maxAge:Number(r.headers.get('set-cookie').match(/Max-Age=(\d+)/)[1])};
 };
 const getSession=async a=>(await db.query('SELECT *,extract(epoch FROM (expires_at-created_at)) AS lifetime_seconds FROM mp_sessions WHERE token_hash=$1',[digest(a.cookie.split('=')[1])])).rows[0];
 const save=hours=>handleAdminRequest(req('/api/admin',admin,{action:'set_session_hours',hours}),options);
 try{
  await t.test('default is eight hours and only admin can read/change policy',async()=>{
   admin=await login('admin',testEnv.ADMIN_PASSWORD);
   assert.equal((await handleAdminRequest(req('/api/admin',admin),options)).status,200);
   const created=await handleAdminRequest(req('/api/admin',admin,{action:'create',username:'sessionuser',fullName:'TEST SESSION',password:'1234'}),options);assert.equal(created.status,201);
   user=await login('sessionuser','1234');originalExpiry=(await getSession(user)).expires_at;
   assert.equal(Number((await getSession(user)).lifetime_seconds),28800);
   assert.equal((await handleAdminRequest(req('/api/admin',user),options)).status,403);
   assert.equal((await handleAdminRequest(req('/api/admin',user,{action:'set_session_hours',hours:1}),options)).status,403);
   assert.equal((await handleAdminRequest(req('/api/admin',null,{action:'set_session_hours',hours:1}),options)).status,401);
   assert.equal(await store.userSessionHours(),8);
  });
  await t.test('policy writes require CSRF, Origin, version and strict integer range',async()=>{
   for(const [headers,status] of [[{'X-CSRF-Token':'BAD'},403],[{Origin:'https://evil.invalid'},403],[{'X-App-Version':'0.0.0'},409]]){
    const r=await handleAdminRequest(req('/api/admin',admin,{action:'set_session_hours',hours:1},headers),options);assert.equal(r.status,status);
   }
   for(const hours of [0,-1,169,0.5,'2',null,true,{},1e20]){
    const r=await save(hours);assert.equal(r.status,400);assert.equal((await r.json()).error,'SESSION_HOURS_INVALID');
   }
   assert.equal(await store.userSessionHours(),8);
  });
  await t.test('setting is durable, audited, preserves live sessions and applies to subsequent logins',async()=>{
   assert.equal((await save(1)).status,200);assert.equal(await store.userSessionHours(),1);
   assert.deepEqual((await handleAdminRequest(req('/api/admin',admin),options)).status,200);
   assert.equal(new Date((await getSession(user)).expires_at).getTime(),new Date(originalExpiry).getTime());
   user=await login('sessionuser','1234');const row=await getSession(user);
   assert.equal(Number(row.lifetime_seconds),3600);assert.ok(user.maxAge>=3590&&user.maxAge<=3600);
   assert.ok(user.data.sessionRemainingMs>3590000&&user.data.sessionRemainingMs<=3600000);
   assert.equal(new Date(user.data.sessionExpiresAt).getTime(),new Date(row.expires_at).getTime());
   const auth=await handleAuthRequest(req('/api/auth',user),options);assert.equal(auth.status,200);
   const d=await auth.json();assert.ok(d.sessionRemainingMs>0&&d.sessionRemainingMs<=3600000);
   const audit=(await db.query("SELECT error_code FROM mp_audit WHERE action='SESSION_POLICY_UPDATE'")).rows;
   assert.deepEqual(audit,[{error_code:'USER_SESSION_HOURS_1'}]);
  });
  await t.test('168-hour users have matching DB/cookie lifetime while admin remains eight hours',async()=>{
   assert.equal((await save(168)).status,200);
   const long=await login('sessionuser','1234');assert.equal(Number((await getSession(long)).lifetime_seconds),604800);assert.ok(long.maxAge>=604790&&long.maxAge<=604800);
   const again=await login('admin',testEnv.ADMIN_PASSWORD);assert.equal(Number((await getSession(again)).lifetime_seconds),28800);
   assert.ok(again.maxAge>=28790&&again.maxAge<=28800);
  });
  await t.test('migration/schema can be rerun without resetting settings or deleting users/history',async()=>{
   const migration=await readFile(new URL('./database/migrate-v2.5.0.sql',import.meta.url),'utf8');
   await db.exec(migration);await db.exec(migration);await db.exec(schema);
   assert.equal(await store.userSessionHours(),168);assert.ok(await store.userByName('sessionuser'));
   assert.equal((await db.query("SELECT count(*)::int AS n FROM mp_audit WHERE action='SESSION_POLICY_UPDATE'")).rows[0].n,2);
  });
  await t.test('expired sessions reject authentication and Get before any HRM or admission write',async()=>{
   await db.query("UPDATE mp_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[digest(user.cookie.split('=')[1])]);
   assert.equal((await handleAuthRequest(req('/api/auth',user),options)).status,401);
   let reads=0;const result=await handleMasterRequest(req('/api/master-password',user,{}),{...options,logger:()=>{},reader:async()=>{reads++;}});
   assert.equal(result.status,401);assert.equal(reads,0);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM mp_get_gate')).rows[0].n,0);
  });
  await t.test('a session expiring during Get is rechecked and never returns the master',async()=>{
   const active=await login('sessionuser','1234');
   const result=await handleMasterRequest(req('/api/master-password',active,{}),{...options,logger:()=>{},reader:async()=>{
    await db.query("UPDATE mp_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[digest(active.cookie.split('=')[1])]);
    return {password:'TEST-NOT-ISSUED',remainingMs:90000};
   }});
   assert.equal(result.status,401);assert.doesNotMatch(await result.text(),/TEST-NOT-ISSUED/);
   assert.equal((await db.query("SELECT status,error_code FROM mp_audit WHERE action='GET_MASTER' ORDER BY requested_at DESC LIMIT 1")).rows[0].error_code,'UNAUTHENTICATED');
  });
 }finally{await db.close();}
});

test('v2.5.0 migration upgrades old schema without altering existing accounts, sessions or audit',async()=>{
 const db=new PGlite();try{
  const schema=await readFile(new URL('./database/schema.sql',import.meta.url),'utf8');
  await db.exec(schema.split('-- v2.5.0:')[0]);
  const id='11111111-1111-4111-8111-111111111111';
  await db.query("INSERT INTO mp_users(id,username,full_name,password_hash) VALUES($1,'legacy','TEST LEGACY','TEST-UNCHANGED-HASH')",[id]);
  await db.query("INSERT INTO mp_sessions(token_hash,role,user_id,username,full_name,auth_version,config_stamp,expires_at) VALUES($1,'user',$2,'legacy','TEST LEGACY',1,$3,now()+interval '8 hours')",['a'.repeat(64),id,'b'.repeat(64)]);
  await db.query("INSERT INTO mp_audit(id,actor_key,username,full_name,action,status) VALUES($1,$2,'legacy','TEST LEGACY','LOGIN','ok')",[id,id]);
  const snapshot=await db.query('SELECT * FROM mp_sessions');
  const migration=await readFile(new URL('./database/migrate-v2.5.0.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration);
  assert.deepEqual((await db.query('SELECT * FROM mp_sessions')).rows,snapshot.rows);
  assert.equal((await db.query('SELECT password_hash FROM mp_users')).rows[0].password_hash,'TEST-UNCHANGED-HASH');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM mp_audit')).rows[0].n,1);
  assert.equal((await db.query('SELECT user_session_hours FROM mp_app_settings')).rows[0].user_session_hours,8);
 }finally{await db.close();}
});
