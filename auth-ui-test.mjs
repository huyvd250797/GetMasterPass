import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {APP_VERSION} from './lib/app-version.mjs';
const html=(await readFile(new URL('./public/index.html',import.meta.url),'utf8')).replaceAll('__APP_VERSION__',APP_VERSION);
const scripts=await Promise.all(['master.js','app-auth.js'].map(f=>readFile(new URL('./public/'+f,import.meta.url),'utf8')));
async function flush(){for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));}
async function setup({deferredMaster=false}={}){
 const dom=new JSDOM(html,{url:'https://master-test.invalid',runScripts:'outside-only'}),w=dom.window;
 const requests=[],copies=[],users=[];let current=null,resolveMaster;
 const admin={id:'admin',username:'admin',fullName:'TEST ADMIN',role:'admin'},user={id:'user',username:'tester',fullName:'TEST USER',role:'user'};
 w.AbortSignal=AbortSignal;w.setInterval=()=>1;w.clearInterval=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async s=>copies.push(s)}});
 const response=(status,body)=>new Response(JSON.stringify({...body,version:APP_VERSION}),{status});
 w.fetch=async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):null;requests.push({path,body,headers:options.headers});
  if(path==='/api/version')return response(200,{});
  if(path==='/api/auth'){
   if(body?.action==='login'){current=body.username==='admin'?admin:user;return response(200,{user:current,csrfToken:'TEST-CSRF-'+current.id});}
   if(body?.action==='logout'){assert.equal(options.headers['X-CSRF-Token'],'TEST-CSRF-'+current.id);current=null;return response(200,{ok:true});}
   return current?response(200,{user:current,csrfToken:'TEST-CSRF-'+current.id}):response(401,{error:'UNAUTHENTICATED'});
  }
  if(path==='/api/admin'){
   assert.equal(current?.role,'admin');if(body?.action==='create')users.push({id:'test-id',username:body.username,full_name:body.fullName,active:true,get_count:0});
   if(body?.action==='toggle')users[0].active=body.active;
   return response(200,body?{ok:true}:{users});
  }
  if(path.startsWith('/api/history'))return response(200,{items:[],stats:{total:0,issued:0,failed:0},offset:0,pageSize:50});
  if(path==='/api/master-password'){
   assert.ok(current);assert.equal(options.headers['X-CSRF-Token'],'TEST-CSRF-'+current.id);
   if(deferredMaster)return new Promise(r=>{resolveMaster=()=>r(response(200,{password:'TEST-MASTER',remainingMs:90000,processingMs:0}));});
   return response(200,{password:'TEST-MASTER',remainingMs:90000,processingMs:0});
  }throw new Error('Unexpected request');
 };
 for(const s of scripts)w.eval(s);await flush();
 const $=id=>w.document.getElementById(id);
 async function submit(id){$(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();}
 async function login(username){$('login-username').value=username;$('login-password').value='TEST-ONLY-PASSWORD';await submit('login-form');}
 async function click(id){$(id).click();await flush();}
 return {dom,w,$,requests,copies,users,login,click,submit,resolve:()=>resolveMaster()};
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
 }finally{h.dom.window.close();}
});
test('a master response finishing after logout is never copied or shown',async()=>{
 const h=await setup({deferredMaster:true});try{
  await h.login('tester');await h.click('get');await h.click('logout');h.resolve();await flush();
  assert.equal(h.copies.length,0);assert.equal(h.$('manual').value,'');assert.equal(h.$('workspace').hidden,true);
 }finally{h.dom.window.close();}
});
