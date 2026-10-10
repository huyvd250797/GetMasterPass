import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,validPassword,sessionCookie,cookieToken,authenticate,configStamp,csrfFor,checkConfig} from './lib/security.mjs';
import {handleAuthRequest,handleAdminRequest,handleHistoryRequest} from './lib/auth-api.mjs';
import {testEnv,token,testHeaders,testStore} from './test-support/auth-fixture.mjs';
import {APP_VERSION} from './lib/app-version.mjs';
import {safeAppFailure} from './lib/http.mjs';
const origin='https://master-test.invalid';
const request=(path,body,headers={})=>new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'X-Master-Request':'1','X-App-Version':APP_VERSION,'Content-Type':'application/json',...testHeaders,...headers},...(body?{body:JSON.stringify(body)}:{})});
test('salted scrypt accepts the right password and rejects wrong or malformed hashes',async()=>{
 const password='TEST-ONLY-password-123';const a=await hashPassword(password),b=await hashPassword(password);
 assert.notEqual(a,b);assert.ok(!a.includes(password));assert.equal(await verifyPassword(password,a),true);
 assert.equal(await verifyPassword('WRONG-ONLY-password',a),false);assert.equal(await verifyPassword(password,'bad'),false);
 await assert.rejects(hashPassword('abc'),e=>e.appCode==='PASSWORD_POLICY');
});
test('cookies are secure host-only and token values are bounded',()=>{
 const https=request('/api/auth');assert.match(sessionCookie(https,token),/^__Host-mp_session=/);
 assert.match(sessionCookie(https,token),/HttpOnly; SameSite=Strict/);assert.match(sessionCookie(https,token),/; Secure$/);
 assert.doesNotMatch(sessionCookie(https,token),/Domain=/);assert.equal(cookieToken(https),token);
 assert.equal(cookieToken(request('/api/auth',null,{Cookie:'__Host-mp_session=x'})),null);
 assert.equal(cookieToken(request('/api/auth',null,{Cookie:`__Host-mp_session=${token}; __Host-mp_session=${token}`})),null);
});
test('a changed admin credential or session key invalidates existing sessions',async()=>{
 const session={role:'admin',username:'admin',full_name:'Admin',config_stamp:configStamp(testEnv,'admin')};
 await assert.rejects(authenticate(request('/api/auth'),{...testEnv,ADMIN_PASSWORD:'OTHER-TEST-ONLY-PASSWORD'},{session:async()=>session}),e=>e.appCode==='UNAUTHENTICATED');
 await assert.rejects(authenticate(request('/api/auth'),{...testEnv,SESSION_SECRET:'b'.repeat(40)},testStore()),e=>e.appCode==='UNAUTHENTICATED');
 assert.throws(()=>checkConfig({...testEnv,SESSION_SECRET:'short'}),e=>e.appCode==='AUTH_NOT_CONFIGURED');
});
test('users cannot list/create accounts or request other users history',async()=>{
 const store={...testStore(),users:async()=>{throw new Error('must not run');}};
 assert.equal((await handleAdminRequest(request('/api/admin'),{env:testEnv,store})).status,403);
 assert.equal((await handleAdminRequest(request('/api/admin',{action:'create'}),{env:testEnv,store})).status,403);
 let filter;store.history=async f=>{filter=f;return {items:[],stats:{}};};
 assert.equal((await handleHistoryRequest(request('/api/history?actor=admin'),{env:testEnv,store})).status,200);
 assert.equal(filter.actorKey,'11111111-1111-4111-8111-111111111111');
});
test('login CSRF/version checks and oversize bodies fail without credential processing',async()=>{
 const store={rate:async()=>{throw new Error('must not run');}};
 for(const [headers,status] of [[{Origin:'https://evil.invalid'},403],[{'X-App-Version':'1.0.0'},409]]){
  assert.equal((await handleAuthRequest(request('/api/auth',{action:'login'},headers),{env:testEnv,store})).status,status);
 }
 const large=request('/api/auth',{action:'login',password:'x'.repeat(9000)});
 assert.equal((await handleAuthRequest(large,{env:testEnv,store})).status,400);
});
test('database failures only return static errors',async()=>{
 const result=await handleAuthRequest(request('/api/auth'),{env:testEnv,loadStore:async()=>{throw new Error('PRIVATE DB PASSWORD');}});
 assert.equal(result.status,503);assert.doesNotMatch(await result.text(),/PRIVATE|PASSWORD/);
});
test('admin history validates date range and applies Vietnam day boundaries',async()=>{
 const store={session:async()=>({role:'admin',username:'admin',full_name:'Admin',config_stamp:configStamp(testEnv,'admin')}),history:async f=>({filter:f})};
 const result=await handleHistoryRequest(request('/api/history?from=2026-10-10&to=2026-10-10'),{env:testEnv,store});
 assert.equal(result.status,200);const d=await result.json();assert.equal(d.filter.from,'2026-10-09T17:00:00.000Z');assert.equal(d.filter.to,'2026-10-10T17:00:00.000Z');
 assert.equal((await handleHistoryRequest(request('/api/history?from=2026-02-30'),{env:testEnv,store})).status,400);
});
test('configuration failures identify every invalid field without calling Neon or exposing values',async()=>{
 const cases=[
  ['ADMIN_USERNAME',undefined,'ADMIN_USERNAME_MISSING'],
  ['ADMIN_USERNAME','   ','ADMIN_USERNAME_MISSING'],
  ['ADMIN_USERNAME','PRIVATE ADMIN!','ADMIN_USERNAME_INVALID'],
  ['ADMIN_USERNAME','_admin','ADMIN_USERNAME_INVALID'],
  ['ADMIN_PASSWORD',undefined,'ADMIN_PASSWORD_MISSING'],
  ['ADMIN_PASSWORD','PRIVATE','ADMIN_PASSWORD_TOO_SHORT'],
  ['ADMIN_PASSWORD','PRIVATE'.repeat(40),'ADMIN_PASSWORD_TOO_LONG'],
  ['SESSION_SECRET',undefined,'SESSION_SECRET_MISSING'],
  ['SESSION_SECRET','PRIVATE KEY','SESSION_SECRET_TOO_SHORT']
 ];
 for(const [field,value,issue] of cases){
  let calls=0;const env={...testEnv,[field]:value};
  for(const body of [null,{action:'login',username:'admin',password:testEnv.ADMIN_PASSWORD}]){
   const result=await handleAuthRequest(request('/api/auth',body),{env,loadStore:async()=>{calls++;throw new Error('must not run');}});
   assert.equal(result.status,503);assert.equal(result.headers.get('cache-control'),'no-store');
   const data=await result.json();assert.deepEqual(data,{error:'AUTH_NOT_CONFIGURED',configIssues:[issue],version:APP_VERSION});
   assert.doesNotMatch(JSON.stringify(data),/PRIVATE|TEST-ADMIN-ONLY|TEST-ONLY-SESSION/);
  }
  assert.equal(calls,0);
 }
 const all=await handleAuthRequest(request('/api/auth'),{env:{},loadStore:async()=>{throw new Error('must not run');}});
 assert.deepEqual((await all.json()).configIssues,['ADMIN_USERNAME_MISSING','ADMIN_PASSWORD_MISSING','SESSION_SECRET_MISSING']);
});
test('valid configuration boundaries proceed to login without changing passwords or session keys',async()=>{
 for(const [username,password] of [[' Admin ', 'x'.repeat(8)],['a'.repeat(64),'x'.repeat(256)]]){
  const env={...testEnv,ADMIN_USERNAME:username,ADMIN_PASSWORD:password,SESSION_SECRET:'k'.repeat(32)};
  checkConfig(env);let saved;
  const store={rate:async()=>true,loginSession:async(s,a)=>{saved={s,a};}};
  const response=await handleAuthRequest(request('/api/auth',{action:'login',username:username.trim(),password}),{env,store});
  assert.equal(response.status,200);assert.equal(saved.a.role,'admin');assert.equal(saved.a.username,username.trim().toLowerCase());
  assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 }
 const env={...testEnv,ADMIN_PASSWORD:' TEST PASSWORD ',SESSION_SECRET:' k'.repeat(20)};
 let events=0;
 const rejected=await handleAuthRequest(request('/api/auth',{action:'login',username:'admin',password:env.ADMIN_PASSWORD.trim()}),{env,store:{rate:async()=>true,event:async()=>{events++;}}});
 assert.equal(rejected.status,401);assert.equal(events,1);
});
test('configuration diagnostics filter unknown labels and never forward arbitrary error details',async()=>{
 const result=safeAppFailure({appCode:'AUTH_NOT_CONFIGURED',configIssues:['ADMIN_PASSWORD_TOO_SHORT','PRIVATE KEY','ADMIN_PASSWORD_TOO_SHORT'],message:'PRIVATE PASSWORD',env:testEnv});
 assert.deepEqual(await result.json(),{error:'AUTH_NOT_CONFIGURED',configIssues:['ADMIN_PASSWORD_TOO_SHORT'],version:APP_VERSION});
});
test('role password policies accept admin 8+ and users 4+, retaining the 256 character maximum',async()=>{
 assert.throws(()=>checkConfig({...testEnv,ADMIN_PASSWORD:'1234567'}));
 checkConfig({...testEnv,ADMIN_PASSWORD:'12345678'});
 assert.equal(validPassword('123'),false);assert.equal(validPassword('1234'),true);
 assert.equal(validPassword('x'.repeat(256)),true);assert.equal(validPassword('x'.repeat(257)),false);
 const encoded=await hashPassword('1234');assert.equal(await verifyPassword('1234',encoded),true);
 assert.equal(await verifyPassword('1235',encoded),false);
});
