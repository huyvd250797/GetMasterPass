import test from 'node:test';
import assert from 'node:assert/strict';
import {APP_VERSION} from './lib/app-version.mjs';
import {handleMasterRequest} from './lib/master-api.mjs';
import {createMasterReader} from './lib/master-cache.mjs';
const origin='https://master-test.invalid';
import {testEnv as env,testHeaders,testStore} from './test-support/auth-fixture.mjs';
const handle=(r,o)=>handleMasterRequest(r,{store:testStore(),...o});
const req=(options={})=>new Request(`${origin}/api/master-password`,{method:options.method||'POST',headers:{
  ...testHeaders,Origin:origin,'X-Master-Request':'1','X-App-Version':APP_VERSION,...options.headers
}});
test('cross-origin and GET requests are rejected',async()=>{
  const reader=async()=>{throw new Error('must not run');};
  assert.equal((await handle(req({method:'GET'}),{env,reader})).status,405);
  assert.equal((await handle(req({headers:{Origin:'https://other.invalid'}}),{env,reader})).status,403);
});
test('missing credentials do not start a browser',async()=>{
  const result=await handle(req(),{env:{...env,HRM_PASSWORD:''},reader:async()=>{throw new Error('must not run');}});
  assert.equal(result.status,503);assert.deepEqual(await result.json(),{error:'NOT_CONFIGURED',version:APP_VERSION});
});
test('successful request subtracts closing time, keeps original lifetime and disables cache',async()=>{
  let now=100;
  const result=await handle(req(),{env,clock:()=>now,reader:async()=>{
    now=20300;return {password:'TEST-ONLY',remainingMs:120000,readAtMs:20000};
  }});
  assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
  const data=await result.json();assert.match(data.requestId,/^[a-f0-9-]{36}$/);delete data.requestId;
  assert.deepEqual(data,{password:'TEST-ONLY',remainingMs:119700,processingMs:20200,version:APP_VERSION});
});
test('failure response and runtime log contain only allowlisted diagnostics',async()=>{
  const logs=[];
  for (const error of [Object.assign(new Error('PRIVATE PASSWORD COOKIE HTML'),{code:'AUTH_BLOCKED',stage:'hrm_check'}),
    Object.assign(new Error('PRIVATE PASSWORD COOKIE HTML'),{code:'PRIVATE',stage:'PRIVATE'})]) {
    const result=await handle(req(),{env,logger:e=>logs.push(e),reader:async()=>{throw error;}});
    assert.equal(result.status,502);
    const data=await result.json();
    assert.equal(data.error,error.code==='AUTH_BLOCKED'?'AUTH_BLOCKED':'HRM_UNAVAILABLE');
    assert.equal(data.stage,error.code==='AUTH_BLOCKED'?'hrm_check':'reader');
    assert.equal(data.reason,'UNKNOWN');assert.match(data.requestId,/^[a-f0-9-]{36}$/);
    assert.equal(logs.at(-1).requestId,data.requestId);
    assert.doesNotMatch(JSON.stringify(data)+JSON.stringify(logs),/PRIVATE|PASSWORD|COOKIE|HTML/);
  }
});
test('expired or overlong code lifetime is rejected',async()=>{
  for (const remainingMs of [0,500,300001]) {
    const result=await handle(req(),{env,reader:async()=>({password:'TEST-ONLY',remainingMs})});
    assert.equal(result.status,502);assert.deepEqual(await result.json(),{error:'INVALID_RESPONSE',version:APP_VERSION});
  }
});

test('stale UI version stops the request before an HRM login',async()=>{
  let ran=false;
  for (const version of ['', '2.0.2']) {
    const result=await handle(req({headers:{'X-App-Version':version}}),{env,reader:async()=>{ran=true;}});
    assert.equal(result.status,409);assert.equal(result.headers.get('x-app-version'),APP_VERSION);
    assert.deepEqual(await result.json(),{error:'VERSION_MISMATCH',version:APP_VERSION});
  }
  assert.equal(ran,false);
});

test('anonymous, revoked and CSRF-less requests never start HRM',async()=>{
 let ran=0;const reader=async()=>{ran++;};
 for(const [request,store,status] of [
  [req({headers:{Cookie:''}}),testStore(),401],
  [req(),{...testStore(),session:async()=>null},401],
  [req({headers:{'X-CSRF-Token':''}}),testStore(),403]]){
  assert.equal((await handleMasterRequest(request,{env,store,reader})).status,status);
 }assert.equal(ran,0);
});
test('audit failure never returns or logs the master password',async()=>{
 const store={...testStore(),finishGet:async()=>{throw new Error('PRIVATE DB URL');}};
 const logs=[];const response=await handle(req(),{env,store,logger:e=>logs.push(e),reader:async()=>({password:'SECRET-NOT-IN-LOG',remainingMs:90000})});
 assert.equal(response.status,503);const data=await response.json();assert.equal(data.error,'AUDIT_UNAVAILABLE');
 assert.doesNotMatch(JSON.stringify(data)+JSON.stringify(logs),/SECRET|PRIVATE/);
});
test('session revoked while HRM runs blocks the password and records denial',async()=>{
 let calls=0;const finishes=[];const store={...testStore(),session:async()=>++calls===1?await testStore().session():null,finishGet:async(...args)=>finishes.push(args)};
 const r=await handle(req(),{env,store,reader:async()=>({password:'SECRET',remainingMs:90000})});
 assert.equal(r.status,401);assert.equal(finishes[0][2],'denied');assert.doesNotMatch(await r.text(),/SECRET/);
});
test('audit latency is deducted and concurrent admission denial never runs HRM',async()=>{
 let now=0;const store={...testStore(),finishGet:async()=>{now+=2200;}};
 const response=await handle(req(),{env,store,clock:()=>now,reader:async()=>({password:'TEST-ONLY',remainingMs:90000})});
 assert.equal((await response.json()).remainingMs,87800);
 let ran=false;const r=await handle(req(),{env,store:{...testStore(),beginGet:async()=>false},reader:async()=>{ran=true;}});
 assert.equal(r.status,429);assert.equal(ran,false);
});
test('warm cache still requires authentication, admission, revalidation and a separate durable audit per Get',async()=>{
 let reads=0,finishes=0;const logs=[];const reader=createMasterReader({reader:async()=>{reads++;return {password:'PRIVATE-MASTER',remainingMs:90000};}});
 const store={...testStore(),finishGet:async()=>{finishes++;}};
 try{
  const a=await handle(req(),{env,store,reader,logger:e=>logs.push(e)});assert.equal(a.status,200);
  const b=await handle(req(),{env,store,reader,logger:e=>logs.push(e)});assert.equal(b.status,200);
  assert.notEqual((await a.json()).requestId,(await b.json()).requestId);assert.equal(reads,1);assert.equal(finishes,2);
  assert.equal(logs.at(-1).source,'memory');assert.doesNotMatch(JSON.stringify(logs),/PRIVATE-MASTER|TEST-HRM|PASSWORD|COOKIE/);
  assert.equal((await handle(req({headers:{Cookie:''}}),{env,store,reader})).status,401);
  assert.equal((await handle(req(),{env,store:{...store,session:async()=>null},reader})).status,401);
  const blocked=await handle(req(),{env,store:{...store,finishGet:async()=>{throw new Error('TEST audit unavailable');}},reader,logger:()=>{}});
  assert.equal(blocked.status,503);assert.doesNotMatch(await blocked.text(),/PRIVATE-MASTER/);assert.equal(reads,1);
 }finally{reader.clear();}
});
test('optimized durable verification denial/expiry never leaks a code or retries an already final audit',async()=>{
 for(const result of [{status:'denied',error_code:'UNAUTHENTICATED'},{status:'failed',error_code:'INVALID_RESPONSE'}]){
  let finishes=0,sessions=0;
  const store={...testStore(),session:async()=>{sessions++;return testStore().session();},finishGetVerified:async()=>result,finishGet:async()=>{finishes++;throw Error('already final');}};
  const r=await handle(req(),{env,store,reader:async()=>({password:'TEST-NEVER-RELEASED',remainingMs:90000}),logger:()=>{}});
  assert.equal(r.status,result.status==='denied'?401:502);assert.equal(sessions,1);assert.equal(finishes,0);assert.doesNotMatch(await r.text(),/TEST-NEVER-RELEASED/);
 }
});
