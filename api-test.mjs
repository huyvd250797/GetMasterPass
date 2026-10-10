import test from 'node:test';
import assert from 'node:assert/strict';
import {APP_VERSION} from './lib/app-version.mjs';
import {handleMasterRequest} from './lib/master-api.mjs';
const origin='https://master-test.invalid';
const env={VERCEL:'1',HRM_USERNAME:'TEST-ONLY',HRM_PASSWORD:'TEST-ONLY'};
const req=(options={})=>new Request(`${origin}/api/master-password`,{method:options.method||'POST',headers:{
  Origin:origin,'X-Master-Request':'1','X-App-Version':APP_VERSION,...options.headers
}});
test('cross-origin and GET requests are rejected',async()=>{
  const reader=async()=>{throw new Error('must not run');};
  assert.equal((await handleMasterRequest(req({method:'GET'}),{env,reader})).status,405);
  assert.equal((await handleMasterRequest(req({headers:{Origin:'https://other.invalid'}}),{env,reader})).status,403);
});
test('missing credentials do not start a browser',async()=>{
  const result=await handleMasterRequest(req(),{env:{...env,HRM_PASSWORD:''},reader:async()=>{throw new Error('must not run');}});
  assert.equal(result.status,503);assert.deepEqual(await result.json(),{error:'NOT_CONFIGURED',version:APP_VERSION});
});
test('successful request subtracts closing time, keeps original lifetime and disables cache',async()=>{
  let now=100;
  const result=await handleMasterRequest(req(),{env,clock:()=>now,reader:async()=>{
    now=20300;return {password:'TEST-ONLY',remainingMs:120000,readAtMs:20000};
  }});
  assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
  assert.deepEqual(await result.json(),{password:'TEST-ONLY',remainingMs:119700,processingMs:20200,version:APP_VERSION});
});
test('failure response and runtime log contain only allowlisted diagnostics',async()=>{
  const logs=[];
  for (const error of [Object.assign(new Error('PRIVATE PASSWORD COOKIE HTML'),{code:'AUTH_BLOCKED',stage:'hrm_check'}),
    Object.assign(new Error('PRIVATE PASSWORD COOKIE HTML'),{code:'PRIVATE',stage:'PRIVATE'})]) {
    const result=await handleMasterRequest(req(),{env,logger:e=>logs.push(e),reader:async()=>{throw error;}});
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
    const result=await handleMasterRequest(req(),{env,reader:async()=>({password:'TEST-ONLY',remainingMs})});
    assert.equal(result.status,502);assert.deepEqual(await result.json(),{error:'INVALID_RESPONSE',version:APP_VERSION});
  }
});

test('stale UI version stops the request before an HRM login',async()=>{
  let ran=false;
  for (const version of ['', '2.0.2']) {
    const result=await handleMasterRequest(req({headers:{'X-App-Version':version}}),{env,reader:async()=>{ran=true;}});
    assert.equal(result.status,409);assert.equal(result.headers.get('x-app-version'),APP_VERSION);
    assert.deepEqual(await result.json(),{error:'VERSION_MISMATCH',version:APP_VERSION});
  }
  assert.equal(ran,false);
});
