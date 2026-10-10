import test from 'node:test';
import assert from 'node:assert/strict';
import {collectMaster,readMasterFromHrm} from './lib/hrm-browser.mjs';

function makePage({blocked=false,loginFails=false}={}) {
  let evaluations=0;const actions=[];
  const profile='.dropdown-user > a.dropdown-toggle';
  const page={
    setDefaultTimeout(){},setDefaultNavigationTimeout(){},async goto(url){actions.push('goto');assert.equal(url,'https://hrm.ascvn.com.vn/HeThong');},
    url:()=> 'https://hrm.ascvn.com.vn/HeThong',
    async evaluate(){evaluations++;if(evaluations===1||evaluations===2)return blocked;if(evaluations===3){actions.push('clearClipboard');return;}
      actions.push('readMaster');return {password:'TEST-ONLY',seconds:90};},
    async $(s){if(s==='input[name="UserName"]')return {};if(s==='a.gen-pass')return {boundingBox:async()=>null};return null;},
    locator(s){return {fill:async()=>actions.push(s==='input[name="UserName"]'?'fillUsername':'fillPassword'),click:async()=>actions.push(s===profile?'openMenu':'getMaster')};},
    async waitForFunction(){return {asElement:()=>({click:async()=>actions.push('submitLogin')})};},
    async waitForSelector(s){if(loginFails&&s===profile)throw new Error('TEST failure');},async bringToFront(){}
  };
  return {page,actions};
}
test('normal login uses account fields then the observed HRM master copy action',async()=>{
  const {page,actions}=makePage();const result=await collectMaster(page,{HRM_USERNAME:'TEST-ONLY',HRM_PASSWORD:'TEST-ONLY'});
  assert.equal(result.password,'TEST-ONLY');assert.ok(result.remainingMs<=90000&&result.remainingMs>89000);
  assert.deepEqual(actions,['goto','fillUsername','fillPassword','submitLogin','clearClipboard','openMenu','getMaster','readMaster']);
});
test('bot verification stops before credential entry',async()=>{
  const {page,actions}=makePage({blocked:true});
  await assert.rejects(collectMaster(page,{}),error=>error.code==='AUTH_BLOCKED');
  assert.deepEqual(actions,['goto']);
});
test('rejected login is not retried and never gets the master',async()=>{
  const {page,actions}=makePage({loginFails:true});
  await assert.rejects(collectMaster(page,{}),error=>error.code==='LOGIN_FAILED');
  assert.equal(actions.filter(a=>a==='submitLogin').length,1);assert.ok(!actions.includes('getMaster'));
});

test('server clipboard failures identify the failing step instead of HRM_UNAVAILABLE',async()=>{
  const {page}=makePage();let calls=0;
  page.evaluate=async()=>{if(++calls===3)throw Object.assign(new Error('PRIVATE'),{name:'NotAllowedError'});return false;};
  await assert.rejects(collectMaster(page,{}),e=>e.code==='CLIPBOARD_UNAVAILABLE'&&e.stage==='clipboard_clear'&&e.reason==='PERMISSION_DENIED');
});
test('network DNS failures and HTTP refusals are distinguished',async()=>{
  const {page}=makePage();page.goto=async()=>{throw new Error('net::ERR_NAME_NOT_RESOLVED https://PRIVATE');};
  await assert.rejects(collectMaster(page,{}),e=>e.code==='HRM_CONNECTION_FAILED'&&e.stage==='hrm_navigation'&&e.reason==='DNS_FAILED');
  page.goto=async()=>({status:()=>403});
  await assert.rejects(collectMaster(page,{}),e=>e.code==='HRM_ACCESS_DENIED'&&e.reason==='HTTP_403');
});
test('missing Chromium libraries get a safe launch diagnostic',async()=>{
  const loadPuppeteer=async()=>({default:{launch:async()=>{throw new Error('/PRIVATE error while loading shared libraries: libPRIVATE.so');}}});
  await assert.rejects(readMasterFromHrm({LOCAL_CHROME_PATH:'/test'},{loadPuppeteer}),
    e=>e.code==='BROWSER_START_FAILED'&&e.stage==='browser_launch'&&e.reason==='LIBRARY_MISSING');
});
test('browser grants sanitized text write permission and is closed after success',async()=>{
  const {page}=makePage();let closed=false,permissions;
  const browser={defaultBrowserContext:()=>({overridePermissions:async(o,p)=>{permissions=p;}}),
    newPage:async()=>page,close:async()=>{closed=true;}};
  const result=await readMasterFromHrm({LOCAL_CHROME_PATH:'/test'},
    {loadPuppeteer:async()=>({default:{launch:async()=>browser}})});
  assert.equal(result.password,'TEST-ONLY');assert.equal(closed,true);
  assert.ok(permissions.includes('clipboard-read'));assert.ok(permissions.includes('clipboard-sanitized-write'));
});
test('browser closes if permission setup fails',async()=>{
  let closed=false;
  const browser={defaultBrowserContext:()=>({overridePermissions:async()=>{throw new Error('PRIVATE');}}),close:async()=>{closed=true;}};
  await assert.rejects(readMasterFromHrm({LOCAL_CHROME_PATH:'/test'},
    {loadPuppeteer:async()=>({default:{launch:async()=>browser}})}),e=>e.code==='BROWSER_SETUP_FAILED'&&e.stage==='browser_permissions');
  assert.equal(closed,true);
});
