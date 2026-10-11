import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMasterDelivery} from './lib/master-delivery.mjs';
import {APP_VERSION} from './lib/app-version.mjs';
import {testEnv,testHeaders,testStore} from './test-support/auth-fixture.mjs';
const origin='https://master-test.invalid';
const req=(extra={})=>new Request(origin+'/api/master-password',{method:'POST',headers:{Origin:origin,'X-Master-Request':'1','X-App-Version':APP_VERSION,Accept:'application/x-ndjson',...testHeaders,...extra}});
const options={env:testEnv,logger:()=>{}};
async function records(r){return (await r.text()).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));}
test('real progress arrives before HRM finishes; no master is streamed until the durable audit completes',async()=>{
 let releaseRead,releaseAudit,reading,auditing;
 const beganRead=new Promise(r=>reading=r),beganAudit=new Promise(r=>auditing=r);
 const readGate=new Promise(r=>releaseRead=r),auditGate=new Promise(r=>releaseAudit=r);
 const store={...testStore(),finishGetVerified:async()=>{auditing();await auditGate;return {status:'issued'};}};
 const r=handleMasterDelivery(req(),{...options,store,reader:async()=>{reading();await readGate;return {password:'TEST-STREAM-SECRET',remainingMs:90000};}});
 assert.match(r.headers.get('content-type'),/application\/x-ndjson/);assert.equal(r.headers.get('cache-control'),'no-store');
 const stream=r.body.getReader(),decoder=new TextDecoder();let chunks='';
 await beganRead;chunks+=decoder.decode((await stream.read()).value);chunks+=decoder.decode((await stream.read()).value);
 const progress=chunks.trim().split('\n').map(s=>JSON.parse(s));assert.deepEqual(progress.map(p=>p.step),[1,2]);assert.doesNotMatch(chunks,/SECRET|password|username|cookie/);
 releaseRead();await beganAudit;chunks+=decoder.decode((await stream.read()).value);assert.equal(JSON.parse(chunks.trim().split('\n').at(-1)).step,3);assert.doesNotMatch(chunks,/TEST-STREAM-SECRET/);
 releaseAudit();chunks+=decoder.decode((await stream.read()).value);assert.equal((await stream.read()).done,true);
 const result=JSON.parse(chunks.trim().split('\n').at(-1));assert.equal(result.type,'result');assert.equal(result.status,200);assert.equal(result.data.password,'TEST-STREAM-SECRET');assert.equal(result.data.version,APP_VERSION);
});
test('stream failures carry the real status and never expose the master after audit denial',async()=>{
 for(const [store,status,error] of [
  [{...testStore(),session:async()=>null},401,'UNAUTHENTICATED'],
  [{...testStore(),finishGetVerified:async()=>({status:'denied',error_code:'UNAUTHENTICATED'})},401,'UNAUTHENTICATED'],
  [{...testStore(),finishGet:async()=>{throw Error('TEST PRIVATE DB');}},503,'AUDIT_UNAVAILABLE']]){
  const items=await records(handleMasterDelivery(req(),{...options,store,reader:async()=>({password:'TEST-NEVER-STREAMED',remainingMs:90000})}));
  const result=items.at(-1);assert.equal(result.status,status);assert.equal(result.data.error,error);assert.doesNotMatch(JSON.stringify(items),/TEST-NEVER-STREAMED|TEST PRIVATE DB/);
 }
});
test('origin, anonymous and stale-version requests are rejected before starting the stream or reader',async()=>{
 let called=0;const reader=async()=>{called++;};
 for(const [headers,status] of [[{Origin:'https://evil.invalid'},403],[{Cookie:''},401],[{'X-App-Version':'2.3.0'},409]]){
  const r=await handleMasterDelivery(req(headers),{...options,store:testStore(),reader});assert.equal(r.status,status);assert.match(r.headers.get('content-type'),/application\/json/);
 }assert.equal(called,0);
});
test('JSON clients remain compatible and progress observer failures do not affect issuance',async()=>{
 const r=await handleMasterDelivery(req({Accept:'application/json'}),{...options,store:testStore(),reader:async()=>({password:'TEST-JSON',remainingMs:90000}),onProgress:()=>{throw Error('TEST UI progress error');}});
 assert.equal(r.status,200);assert.equal((await r.json()).password,'TEST-JSON');
});
test('cancelled stream still completes the underlying audited reader and never throws into its work',async()=>{
 let release,finished;const gate=new Promise(r=>release=r),completed=new Promise(r=>finished=r);
 const r=handleMasterDelivery(req(),{...options,store:{...testStore(),finishGet:async()=>finished()},reader:async()=>{await gate;return {password:'TEST-CANCEL',remainingMs:90000};}});
 await r.body.cancel();release();await completed;
});
