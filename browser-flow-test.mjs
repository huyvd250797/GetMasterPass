import test from 'node:test';
import assert from 'node:assert/strict';
import {collectMaster} from './lib/hrm-browser.mjs';

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
