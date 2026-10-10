import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,sessionCookie,cookieToken,authenticate,configStamp,csrfFor,checkConfig} from './lib/security.mjs';
import {handleAuthRequest,handleAdminRequest,handleHistoryRequest} from './lib/auth-api.mjs';
import {testEnv,token,testHeaders,testStore} from './test-support/auth-fixture.mjs';
import {APP_VERSION} from './lib/app-version.mjs';
const origin='https://master-test.invalid';
const request=(path,body,headers={})=>new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'X-Master-Request':'1','X-App-Version':APP_VERSION,'Content-Type':'application/json',...testHeaders,...headers},...(body?{body:JSON.stringify(body)}:{})});
test('salted scrypt accepts the right password and rejects wrong or malformed hashes',async()=>{
 const password='TEST-ONLY-password-123';const a=await hashPassword(password),b=await hashPassword(password);
 assert.notEqual(a,b);assert.ok(!a.includes(password));assert.equal(await verifyPassword(password,a),true);
 assert.equal(await verifyPassword('WRONG-ONLY-password',a),false);assert.equal(await verifyPassword(password,'bad'),false);
 await assert.rejects(hashPassword('short'),e=>e.appCode==='PASSWORD_POLICY');
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
