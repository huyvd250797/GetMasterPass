import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {APP_VERSION} from './lib/app-version.mjs';
const html=(await readFile(new URL('./public/index.html',import.meta.url),'utf8')).replaceAll('__APP_VERSION__',APP_VERSION);
const scripts=await Promise.all(['notifications.js','master.js','app-auth.js'].map(f=>readFile(new URL('./public/'+f,import.meta.url),'utf8')));
async function flush(){for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));}
async function setup({deferredMaster=false,configIssues=null,streamMaster=false}={}){
 const dom=new JSDOM(html,{url:'https://master-test.invalid',runScripts:'outside-only'}),w=dom.window;
 const requests=[],copies=[],users=[],history=[];let current=null,resolveMaster,streamController;
 const admin={id:'admin',username:'admin',fullName:'TEST ADMIN',role:'admin'},user={id:'user',username:'tester',fullName:'TEST USER',role:'user'};
 w.AbortSignal=AbortSignal;w.TextDecoder=TextDecoder;
 let now=0,wallNow=1700000000000,nextTimer=0;const intervals=new Map();
 Object.defineProperty(w.performance,'now',{value:()=>now});
 w.Date.now=()=>wallNow;
 w.setInterval=(fn,ms)=>{const id=++nextTimer;intervals.set(id,{fn,ms,at:now});return id;};w.clearInterval=id=>intervals.delete(id);
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async s=>copies.push(s)}});
 const response=(status,body)=>new Response(JSON.stringify({...body,version:APP_VERSION}),{status});
 w.fetch=async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):null;requests.push({path,body,headers:options.headers});
  if(path==='/api/version')return response(200,{});
  if(path==='/api/auth'){
   if(configIssues)return response(503,{error:'AUTH_NOT_CONFIGURED',configIssues,privateValue:'PRIVATE-SERVER-VALUE'});
   if(body?.action==='login'){current=body.username==='admin'?admin:user;return response(200,{user:current,csrfToken:'TEST-CSRF-'+current.id});}
   if(body?.action==='change_password'){assert.equal(current.role,'user');current=null;return response(200,{ok:true,loginRequired:true});}
   if(body?.action==='logout'){assert.equal(options.headers['X-CSRF-Token'],'TEST-CSRF-'+current.id);current=null;return response(200,{ok:true});}
   return current?response(200,{user:current,csrfToken:'TEST-CSRF-'+current.id}):response(401,{error:'UNAUTHENTICATED'});
  }
  if(path==='/api/admin'){
   assert.equal(current?.role,'admin');if(body?.action==='create')users.push({id:'test-id',username:body.username,full_name:body.fullName,active:true,get_count:0});
   if(body?.action==='toggle')users[0].active=body.active;
   return response(200,body?{ok:true}:{users});
  }
  if(path.startsWith('/api/history')){if(body){assert.equal(current.role,'admin');const count=body.action==='delete_all'?history.length:1;history.splice(0,body.action==='delete_all'?history.length:1);return response(200,{ok:true,deleted:count});}return response(200,{items:history,stats:{total:history.length,issued:history.length,failed:0},offset:0,pageSize:50});}
  if(path==='/api/master-password'){
   assert.ok(current);assert.equal(options.headers['X-CSRF-Token'],'TEST-CSRF-'+current.id);
   if(streamMaster)return new Response(new ReadableStream({start(controller){streamController=controller;}}),{headers:{'Content-Type':'application/x-ndjson'}});
   if(deferredMaster)return new Promise(r=>{resolveMaster=()=>r(response(200,{password:'TEST-MASTER',remainingMs:90000,processingMs:0}));});
   return response(200,{password:'TEST-MASTER',remainingMs:90000,processingMs:0});
  }throw new Error('Unexpected request');
 };
 for(const s of scripts)w.eval(s);await flush();
 const $=id=>w.document.getElementById(id);
 async function submit(id){$(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();}
 async function login(username){$('login-username').value=username;$('login-password').value='TEST-ONLY-PASSWORD';await submit('login-form');}
 async function click(id){$(id).click();await flush();}
 return {dom,w,$,requests,copies,users,history,login,click,submit,advance:async(ms,{runTimers=true,wallOnly=false}={})=>{if(!wallOnly)now+=ms;wallNow+=ms;if(runTimers)for(const item of [...intervals.values()])if(now-item.at>=item.ms){item.at=now;item.fn();}await flush();},resolve:()=>resolveMaster(),push:async item=>{streamController.enqueue(new TextEncoder().encode(JSON.stringify(item)+'\n'));await flush();},finish:async()=>{streamController.close();await flush();},chunk:async text=>{streamController.enqueue(new TextEncoder().encode(text));await flush();}};
}
test('UI login, admin create/lock/reset, history and logout clear private content',async()=>{
 const h=await setup();try{
  assert.equal(h.$('workspace').hidden,true);assert.equal(h.$('login-panel').hidden,false);
  await h.login('admin');assert.equal(h.$('workspace').hidden,false);assert.equal(h.$('tab-users').hidden,false);assert.equal(h.$('login-password').value,'');
  await h.click('tab-users');h.$('create-name').value='<img src=x onerror=alert(1)>';h.$('create-username').value='tester';h.$('create-password').value='TEST-ONLY-USER-PASS';await h.submit('create-form');
  assert.equal(h.users.length,1);assert.ok(h.$('users-rows').textContent.includes('<img'));assert.equal(h.$('users-rows').querySelector('img'),null);assert.equal(h.$('create-password').value,'');
  h.$('users-rows').querySelector('button').click();await flush();assert.equal(h.users[0].active,false);
  h.$('users-rows').querySelectorAll('button')[1].click();assert.equal(h.$('reset-dialog').open,true);h.$('reset-password').value='NEW-TEST-ONLY-PASS';await h.submit('reset-form');
  assert.equal(h.$('reset-dialog').open,false);assert.equal(h.$('reset-password').value,'');
  await h.click('tab-history');assert.equal(h.$('history-panel').hidden,false);assert.equal(h.$('stat-issued').textContent,'0');
  await h.click('logout');assert.equal(h.$('workspace').hidden,true);assert.equal(h.w.MasterSession,null);assert.equal(h.$('users-rows').textContent,'');
  await h.login('tester');assert.equal(h.$('tab-users').hidden,true);assert.equal(h.$('actor-filter').hidden,true);
  await h.click('get');assert.deepEqual(h.copies,['TEST-MASTER']);
  const before=h.requests.length;await h.click('copy');assert.deepEqual(h.copies,['TEST-MASTER','TEST-MASTER']);assert.equal(h.requests.length,before);
  await h.click('logout');assert.equal(h.$('copy').hidden,true);await h.click('copy');assert.equal(h.copies.length,2);
 }finally{h.dom.window.close();}
});
test('a master response finishing after logout is never copied or shown',async()=>{
 const h=await setup({deferredMaster:true});try{
  await h.login('tester');await h.click('get');await h.click('logout');h.resolve();await flush();
  assert.equal(h.copies.length,0);assert.equal(h.$('manual').value,'');assert.equal(h.$('workspace').hidden,true);
 }finally{h.dom.window.close();}
});
test('Get elapsed time follows the whole request across stages; duration remains after copy and clears at logout',async()=>{
 const h=await setup({streamMaster:true});try{
  await h.login('tester');await h.click('get');assert.equal(h.$('get-elapsed').textContent,'0 giây');assert.equal(h.$('get-duration').hidden,true);
  await h.advance(1250);assert.equal(h.$('get-elapsed').textContent,'1 giây');
  await h.push({type:'progress',step:2,version:APP_VERSION});await h.advance(2500);assert.equal(h.$('get-elapsed').textContent,'3 giây');
  await h.push({type:'progress',step:3,version:APP_VERSION});await h.advance(500);assert.equal(h.$('get-elapsed').textContent,'4 giây');
  await h.push({type:'result',status:200,data:{version:APP_VERSION,password:'TEST-MASTER',remainingMs:90000,processingMs:4250}});await h.finish();
  assert.equal(h.$('get-duration').hidden,false);assert.equal(h.$('get-duration-value').textContent,'4 giây');assert.equal(h.$('get-progress').hidden,true);
  const count=h.requests.length;await h.advance(2000);await h.click('copy');assert.equal(h.requests.length,count);assert.equal(h.$('get-duration-value').textContent,'4 giây');
  await h.click('logout');assert.equal(h.$('get-duration').hidden,true);
 }finally{h.dom.window.close();}
});
test('failed Get reports its elapsed duration and the next attempt starts at zero',async()=>{
 const h=await setup({streamMaster:true});try{
  await h.login('tester');await h.click('get');await h.advance(11250);
  await h.push({type:'result',status:502,data:{version:APP_VERSION,error:'HRM_TIMEOUT'}});await h.finish();
  assert.equal(h.$('get-duration-value').textContent,'11 giây');assert.match(h.$('get-duration-label').textContent,/chưa thành công/);assert.equal(h.$('master-state').dataset.state,'error');
  await h.click('get');assert.equal(h.$('get-duration').hidden,true);assert.equal(h.$('get-elapsed').textContent,'0 giây');
  await h.click('logout');await h.push({type:'result',status:200,data:{version:APP_VERSION,password:'TEST-LATE',remainingMs:90000,processingMs:0}});await h.finish();assert.equal(h.$('get-duration').hidden,true);assert.equal(h.copies.length,0);
 }finally{h.dom.window.close();}
});
test('Get displays completed whole seconds at boundaries and freezes the same integer on success',async()=>{
 const h=await setup({streamMaster:true});try{
  await h.login('tester');await h.click('get');
  await h.advance(999);assert.equal(h.$('get-elapsed').textContent,'0 giây');
  await h.advance(1,{runTimers:false});h.w.dispatchEvent(new h.w.Event('pageshow'));assert.equal(h.$('get-elapsed').textContent,'1 giây');
  await h.advance(999);assert.equal(h.$('get-elapsed').textContent,'1 giây');
  await h.advance(1,{runTimers:false});h.w.dispatchEvent(new h.w.Event('pageshow'));assert.equal(h.$('get-elapsed').textContent,'2 giây');
  await h.advance(950);
  await h.push({type:'result',status:200,data:{version:APP_VERSION,password:'TEST-MASTER',remainingMs:90000,processingMs:2950}});await h.finish();
  assert.equal(h.$('get-duration-value').textContent,'2 giây');
  await h.advance(5000);await h.click('copy');assert.equal(h.$('get-duration-value').textContent,'2 giây');
 }finally{h.dom.window.close();}
});
test('progress jumps do not change the clock; suspended callbacks catch up to actual elapsed time',async()=>{
 const h=await setup({streamMaster:true});try{
  await h.login('tester');await h.click('get');await h.advance(2000);
  const before=h.$('get-elapsed').textContent;
  await h.push({type:'progress',step:3,version:APP_VERSION});assert.equal(h.$('get-progress-step').textContent,'95%');assert.equal(h.$('get-elapsed').textContent,before);
  await h.advance(15000,{runTimers:false});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
  assert.equal(h.$('get-elapsed').textContent,'17 giây');assert.equal(h.$('get-progress-step').textContent,'95%');
  await h.push({type:'result',status:200,data:{version:APP_VERSION,password:'TEST-REAL-TIME',remainingMs:90000,processingMs:17000}});await h.finish();
  assert.equal(h.$('get-duration-value').textContent,'17 giây');
 }finally{h.dom.window.close();}
});
test('wall elapsed time covers sleep even when the monotonic clock does not advance',async()=>{
 const h=await setup({streamMaster:true});try{
  await h.login('tester');await h.click('get');await h.advance(10250,{runTimers:false,wallOnly:true});
  h.w.dispatchEvent(new h.w.Event('pageshow'));assert.equal(h.$('get-elapsed').textContent,'10 giây');
  await h.push({type:'result',status:200,data:{version:APP_VERSION,password:'TEST-SLEEP',remainingMs:90000,processingMs:10250}});await h.finish();
  assert.equal(h.$('get-duration-value').textContent,'10 giây');
  await h.advance(5000);await h.click('copy');assert.equal(h.$('get-duration-value').textContent,'10 giây');
 }finally{h.dom.window.close();}
});
test('configuration diagnostics appear on page load and failed login using only known labels',async()=>{
 const h=await setup({configIssues:['ADMIN_PASSWORD_TOO_SHORT','SESSION_SECRET_MISSING','<img src=x onerror=alert(1)>','PRIVATE-SERVER-VALUE']});
 try{
  const verify=()=>{
   assert.match(h.$('login-status').textContent,/ADMIN_PASSWORD: cần ít nhất 8 ký tự/);
   assert.match(h.$('login-status').textContent,/SESSION_SECRET: deployment chưa nhận được giá trị/);
   assert.doesNotMatch(h.$('login-status').textContent,/PRIVATE|<img/);
   assert.equal(h.$('login-status').querySelector('img'),null);
   assert.equal(h.$('workspace').hidden,true);assert.equal(h.w.MasterSession,null);
  };
  verify();await h.login('admin');verify();assert.equal(h.$('login-password').value,'');
 }finally{h.dom.window.close();}
});
test('user history is hidden and guarded; own password form clears secrets and requires a new login',async()=>{
 const h=await setup();try{
  await h.login('tester');assert.equal(h.$('tab-history').hidden,true);assert.equal(h.$('tab-password').hidden,false);
  const before=h.requests.length;await h.click('tab-history');assert.equal(h.requests.length,before);assert.equal(h.$('history-panel').hidden,true);
  await h.click('tab-password');assert.equal(h.$('password-panel').hidden,false);
  h.$('password-current').value='TEST-OLD';h.$('password-new').value='abcd';h.$('password-confirm').value='dcba';
  await h.submit('password-form');assert.match(h.$('password-status').textContent,/chưa khớp/);assert.equal(h.requests.filter(r=>r.body?.action==='change_password').length,0);
  h.$('password-current').value='TEST-OLD';h.$('password-new').value='abcd';h.$('password-confirm').value='abcd';await h.submit('password-form');
  const request=h.requests.find(r=>r.body?.action==='change_password');assert.equal(request.body.newPassword,'abcd');assert.equal(request.headers['X-CSRF-Token'],'TEST-CSRF-user');
  assert.equal(h.w.MasterSession,null);assert.equal(h.$('workspace').hidden,true);assert.equal(h.$('password-current').value,'');assert.equal(h.$('password-new').value,'');
  assert.match(h.$('toast').textContent,/Đã đổi mật khẩu/);assert.equal(h.$('toast').hidden,false);
  await h.login('admin');assert.equal(h.$('tab-password').hidden,true);await h.click('tab-password');assert.equal(h.$('password-panel').hidden,true);
 }finally{h.dom.window.close();}
});
test('Get/copy success uses an auto-dismissed toast and no static success line',async()=>{
 const h=await setup();try{
  assert.ok(!html.includes('Lấy mật khẩu và copy ngay vào clipboard.'));assert.ok(!html.includes('Đang kết nối HRM'));
  const timers=[];h.w.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};h.w.clearTimeout=()=>{};
  await h.login('tester');await h.click('get');assert.match(h.$('toast').textContent,/Đã lấy và copy/);assert.equal(h.$('status').textContent,'');
  assert.equal(timers.at(-1).ms,3500);timers.at(-1).fn();assert.equal(h.$('toast').hidden,true);assert.equal(h.$('toast').textContent,'');
  await h.click('copy');assert.match(h.$('toast').textContent,/Đã copy lại/);assert.equal(h.$('status').textContent,'');
 }finally{h.dom.window.close();}
});
test('admin confirms or cancels single-row and all-history deletion',async()=>{
 const h=await setup();try{
  h.history.push({id:'11111111-1111-4111-8111-111111111111',full_name:'TEST USER',username:'tester',status:'issued',requested_at:new Date().toISOString()});
  await h.login('admin');await h.click('tab-history');h.$('history-rows').querySelector('button').click();
  assert.equal(h.$('history-delete-dialog').open,true);await h.click('history-delete-cancel');assert.equal(h.requests.filter(r=>r.body?.action==='delete_one').length,0);
  h.$('history-rows').querySelector('button').click();await h.submit('history-delete-form');
  assert.equal(h.requests.find(r=>r.body?.action==='delete_one').body.id,'11111111-1111-4111-8111-111111111111');assert.equal(h.$('history-delete-dialog').open,false);assert.match(h.$('toast').textContent,/Đã xóa 1/);
  await h.click('history-delete-all');assert.match(h.$('history-delete-description').textContent,/ngoài bộ lọc/);await h.submit('history-delete-form');
  assert.equal(h.requests.find(r=>r.body?.action==='delete_all').body.confirm,'DELETE_ALL_GET_HISTORY');
 }finally{h.dom.window.close();}
});
test('estimated percent increases while waiting, server completion advances it, and only a valid result finishes',async()=>{
 const h=await setup({streamMaster:true});try{
  await h.login('tester');await h.click('get');assert.equal(h.$('get-progress').hidden,false);assert.equal(h.$('get-progress-step').textContent,'3%');assert.equal(h.$('get').disabled,true);
  const requests=h.requests.length;await h.click('get');assert.equal(h.requests.length,requests);
  await h.push({type:'progress',step:2,version:APP_VERSION});assert.equal(h.$('get-progress-step').textContent,'30%');assert.equal(h.$('get-progress-track').getAttribute('aria-valuenow'),'30');
  assert.equal(h.$('get-progress-bar').style.width,'30%');assert.equal(h.copies.length,0);assert.match(h.$('get-progress-hint').textContent,/ước tính/);
  await h.push({type:'progress',step:1,version:APP_VERSION});assert.equal(h.$('get-progress-step').textContent,'30%');
  await h.chunk('{"type":"progress","step":');assert.equal(h.$('get-progress-step').textContent,'30%');
  await h.advance(20000);const percent=Number.parseInt(h.$('get-progress-step').textContent);assert.ok(percent>30&&percent<90);assert.equal(h.copies.length,0);
  await h.chunk('3,"version":"'+APP_VERSION+'"}\n');assert.equal(h.$('get-progress-step').textContent,'95%');assert.match(h.$('get-progress-label').textContent,/Đang hoàn tất/);
  assert.equal(h.$('get-progress-bar').style.width,'95%');
  await h.push({type:'result',status:200,data:{version:APP_VERSION,password:'TEST-STREAM-UI',remainingMs:90000,processingMs:0}});await h.finish();
  assert.deepEqual(h.copies,['TEST-STREAM-UI']);assert.equal(h.$('get-progress').hidden,true);assert.equal(h.$('get').disabled,false);assert.match(h.$('toast').textContent,/Đã lấy và copy/);
 }finally{h.dom.window.close();}
});
test('failed or truncated progress never reaches completion; logout discards late milestones and results',async()=>{
 for(const mode of ['failed','truncated','logout']){
  const h=await setup({streamMaster:true});try{
   await h.login('tester');await h.click('get');await h.push({type:'progress',step:2,version:APP_VERSION});
   if(mode==='failed')await h.push({type:'result',status:502,data:{version:APP_VERSION,error:'HRM_TIMEOUT'}});
   if(mode==='logout'){await h.click('logout');await h.push({type:'progress',step:3,version:APP_VERSION});await h.push({type:'result',status:200,data:{version:APP_VERSION,password:'TEST-LATE-SECRET',remainingMs:90000,processingMs:0}});}
   await h.finish();assert.equal(h.copies.length,0);assert.equal(h.$('get-progress').hidden,true);assert.equal(h.$('get').disabled,false);
   if(mode!=='logout')assert.ok(h.$('status').textContent.length>0);else assert.equal(h.w.MasterSession,null);
  }finally{h.dom.window.close();}
 }
});
test('long waits stay below 100%, do not regress, and success alone can show 100%',async()=>{
 const h=await setup({streamMaster:true});let releaseCopy;
 try{
  await h.login('tester');await h.click('get');await h.push({type:'progress',step:2,version:APP_VERSION});
  await h.advance(200000);const waiting=Number.parseInt(h.$('get-progress-step').textContent);assert.ok(waiting>=80&&waiting<=90);assert.equal(h.copies.length,0);
  await h.push({type:'progress',step:2,version:APP_VERSION});assert.equal(Number.parseInt(h.$('get-progress-step').textContent),waiting);
  await h.push({type:'progress',step:1,version:APP_VERSION});assert.equal(Number.parseInt(h.$('get-progress-step').textContent),waiting);
  await h.push({type:'progress',step:3,version:APP_VERSION});await h.advance(200000);
  assert.ok(Number.parseInt(h.$('get-progress-step').textContent)>=95);assert.ok(Number.parseInt(h.$('get-progress-step').textContent)<100);
  const gate=new Promise(r=>releaseCopy=r),original=h.w.navigator.clipboard.writeText;
  h.w.navigator.clipboard.writeText=async value=>{await gate;await original(value);};
  await h.push({type:'result',status:200,data:{version:APP_VERSION,password:'TEST-PERCENT-READY',remainingMs:90000,processingMs:400000}});await h.finish();
  assert.equal(h.$('get-progress-step').textContent,'100%');assert.equal(h.$('get-progress-track').getAttribute('aria-valuenow'),'100');assert.equal(h.$('get-progress-track').getAttribute('aria-valuemax'),'100');
  assert.equal(h.$('get-progress').hidden,false);releaseCopy();await flush();assert.equal(h.$('get-progress').hidden,true);
 }finally{releaseCopy?.();h.dom.window.close();}
});
test('failure clears the progress timer and a retry starts from a fresh percentage',async()=>{
 const h=await setup({streamMaster:true});try{
  await h.login('tester');await h.click('get');await h.push({type:'progress',step:2,version:APP_VERSION});await h.advance(20000);
  await h.push({type:'result',status:502,data:{version:APP_VERSION,error:'HRM_TIMEOUT'}});await h.finish();
  assert.equal(h.$('get-progress').hidden,true);assert.equal(h.$('get-progress-step').textContent,'0%');await h.advance(1000);assert.equal(h.$('get-progress-step').textContent,'0%');
  await h.click('get');assert.equal(h.$('get-progress-step').textContent,'3%');await h.click('logout');await h.advance(1000);
  assert.equal(h.$('get-progress').hidden,true);assert.equal(h.$('get-progress-step').textContent,'0%');await h.finish();
 }finally{h.dom.window.close();}
});
