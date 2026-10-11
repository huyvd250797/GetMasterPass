import test from 'node:test';
import assert from 'node:assert/strict';
import {collectMaster,readMasterFromHrm,optimizeHrmPage,prepareHrmRuntime,prepareHrmReader} from './lib/hrm-browser.mjs';

function makePage({blocked=false,loginFails=false,popupState="absent",masterVisible=false,hoverOpens=true}={}) {
  let evaluations=0;const actions=[],waits=[];
  const profile='.dropdown-user > a.dropdown-toggle';
  const page={
    async setRequestInterception(){},on(){},
    setDefaultTimeout(){},setDefaultNavigationTimeout(){},async goto(url){actions.push('goto');assert.equal(url,'https://hrm.ascvn.com.vn/HeThong');},
    url:()=> 'https://hrm.ascvn.com.vn/HeThong',
    async evaluate(){evaluations++;if(evaluations===1||evaluations===2)return blocked;if(evaluations===3){actions.push('clearClipboard');return;}
      actions.push('readMaster');return {password:'TEST-ONLY',seconds:90};},
    async $(s){if(s==='input[name="UserName"]')return {};if(s==='a.gen-pass')return {boundingBox:async()=>({width:100,height:20}),isVisible:async()=>masterVisible};if(s==='#popupAddUpdatePassword #close'&&popupState!=='absent')return {isVisible:async()=>popupState==='visible',click:async()=>actions.push('closeNotice')};return null;},
    locator(s){return {fill:async()=>actions.push(s==='input[name="UserName"]'?'fillUsername':'fillPassword'),click:async()=>{
      if(s===profile){actions.push('openMenu');if(hoverOpens)masterVisible=true;masterVisible=!masterVisible;}
      else {if(!masterVisible)throw new Error('Master menu is closed');actions.push('getMaster');}
    }};},
    async waitForFunction(){return {asElement:()=>({click:async()=>actions.push('submitLogin')})};},
    async waitForSelector(s,options){
      waits.push({selector:s,...options});
      if(loginFails&&s===profile)throw new Error('TEST failure');
      if(s==='a.gen-pass'&&!masterVisible)throw Object.assign(new Error('TEST timeout'),{name:'TimeoutError'});
      if(s===profile)return {hover:async()=>{actions.push('hoverMenu');if(hoverOpens)masterVisible=true;},dispose:async()=>{}};
    },async bringToFront(){}
  };
  return {page,actions,waits};
}
test('normal login uses account fields then the observed HRM master copy action',async()=>{
  const {page,actions}=makePage();const result=await collectMaster(page,{HRM_USERNAME:'TEST-ONLY',HRM_PASSWORD:'TEST-ONLY'});
  assert.equal(result.password,'TEST-ONLY');assert.ok(result.remainingMs<=90000&&result.remainingMs>89000);
  assert.deepEqual(actions,['goto','fillUsername','fillPassword','submitLogin','clearClipboard','hoverMenu','getMaster','readMaster']);
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
  const {page}=makePage();let closed=false,permissions,launchOptions;
  const browser={defaultBrowserContext:()=>({overridePermissions:async(o,p)=>{permissions=p;}}),
    newPage:async()=>page,close:async()=>{closed=true;}};
  const result=await readMasterFromHrm({LOCAL_CHROME_PATH:'/test'},
    {loadPuppeteer:async()=>({default:{launch:async options=>{launchOptions=options;return browser;}}})});
  assert.equal(result.password,'TEST-ONLY');assert.equal(closed,true);
  assert.ok(permissions.includes('clipboard-read'));assert.ok(permissions.includes('clipboard-sanitized-write'));
  assert.deepEqual(launchOptions.defaultViewport,{width:1366,height:900});
});
test('browser closes if permission setup fails',async()=>{
  let closed=false;
  const browser={defaultBrowserContext:()=>({overridePermissions:async()=>{throw new Error('PRIVATE');}}),close:async()=>{closed=true;}};
  await assert.rejects(readMasterFromHrm({LOCAL_CHROME_PATH:'/test'},
    {loadPuppeteer:async()=>({default:{launch:async()=>browser}})}),e=>e.code==='BROWSER_SETUP_FAILED'&&e.stage==='browser_permissions');
  assert.equal(closed,true);
});
test('cold dependencies import concurrently and a prepared runtime is reused without another import',async()=>{
 let puppeteerStarted,chromiumStarted,resolvePuppeteer,resolveChromium;
 const pStarted=new Promise(r=>puppeteerStarted=r),cStarted=new Promise(r=>chromiumStarted=r);
 const p=new Promise(r=>resolvePuppeteer=r),c=new Promise(r=>resolveChromium=r);
 const {page}=makePage();const browser={defaultBrowserContext:()=>({overridePermissions:async()=>{}}),newPage:async()=>page,close:async()=>{}};
 const preparing=prepareHrmRuntime({VERCEL:'1'},{platform:'linux',loadPuppeteer:async()=>{puppeteerStarted();return p;},loadChromium:async()=>{chromiumStarted();return c;}});
 await Promise.all([pStarted,cStarted]);
 resolvePuppeteer({default:{launch:async()=>browser}});resolveChromium({default:{args:[],executablePath:async()=>'/TEST-BINARY'}});
 const runtime=await preparing;
 const result=await readMasterFromHrm({LOCAL_CHROME_PATH:'/TEST-BINARY'},{runtime,loadPuppeteer:()=>{throw Error('Duplicate import');}});
 assert.equal(result.password,'TEST-ONLY');
});

test('local browser priming launches once without contacting HRM and warm priming skips runtime setup',async()=>{
 const {createBrowserPool}=await import('./lib/browser-pool.mjs');const pool=createBrowserPool();
 let launches=0,pages=0,closedPages=0,closedBrowsers=0,imports=0,binaries=0;const visits=[];
 const browser={connected:true,defaultBrowserContext:()=>({overridePermissions:async()=>{}}),newPage:async()=>{
  pages++;const {page,actions}=makePage();visits.push(actions);page.close=async()=>{closedPages++;};return page;
 },close:async()=>{closedBrowsers++;}};
 const options={browserPool:pool,platform:'linux',loadPuppeteer:async()=>{imports++;return {default:{launch:async()=>{launches++;return browser;}}};},
  loadChromium:async()=>{imports++;return {default:{args:[],executablePath:async()=>{binaries++;return '/TEST';}}};}};
 const env={VERCEL:'1',HRM_USERNAME:'TEST',HRM_PASSWORD:'TEST'};
 try{
  const runtime=await prepareHrmReader(env,options);
  assert.equal(launches,1);assert.equal(pages,0);assert.equal(closedBrowsers,0);assert.equal(imports,2);assert.equal(binaries,1);
  await readMasterFromHrm(env,{...options,runtime});assert.equal(launches,1);assert.equal(pages,1);assert.equal(closedPages,1);
  const warmRuntime=await prepareHrmReader(env,options);
  assert.equal(warmRuntime,undefined);assert.equal(imports,2);assert.equal(binaries,1);assert.equal(pages,1);
  await readMasterFromHrm(env,{...options,runtime:warmRuntime});
  assert.equal(launches,1);assert.equal(imports,2);assert.equal(closedPages,2);
  assert.ok(visits.every(actions=>actions.includes('goto')&&actions.includes('getMaster')));
 }finally{await pool.clear();}assert.equal(closedBrowsers,1);
});

test('priming with browser reuse disabled prepares the runtime and never double-launches Chromium',async()=>{
 const {createBrowserPool}=await import('./lib/browser-pool.mjs');const pool=createBrowserPool();
 const {page}=makePage();let launches=0,closed=0;
 const browser={defaultBrowserContext:()=>({overridePermissions:async()=>{}}),newPage:async()=>page,close:async()=>{closed++;}};
 const env={VERCEL:'1',HRM_BROWSER_REUSE:'0'};
 const options={browserPool:pool,platform:'linux',loadPuppeteer:async()=>({default:{launch:async()=>{launches++;return browser;}}}),
  loadChromium:async()=>({default:{args:[],executablePath:async()=>'/TEST'}})};
 const runtime=await prepareHrmReader(env,options);assert.equal(launches,0);
 await readMasterFromHrm(env,{...options,runtime});assert.equal(launches,1);assert.equal(closed,1);await pool.clear();
});

test('an absent or hidden expired-password notice is skipped without waiting',async()=>{
  for (const popupState of ['absent','hidden']) {
    const {page,actions,waits}=makePage({popupState});
    await collectMaster(page,{});
    assert.ok(!actions.includes('closeNotice'));
    assert.ok(!waits.some(w=>w.selector==='#popupAddUpdatePassword #close'));
    assert.ok(actions.includes('getMaster'));
  }
});
test('a visible expired-password notice closes before opening the master menu',async()=>{
  const {page,actions,waits}=makePage({popupState:'visible'});
  await collectMaster(page,{});
  assert.equal(actions.filter(a=>a==='closeNotice').length,1);
  assert.ok(actions.indexOf('closeNotice')<actions.indexOf('hoverMenu'));
  assert.ok(waits.some(w=>w.selector==='#popupAddUpdatePassword #close'&&w.hidden===true));
});
test('a click-only menu is clicked once after hover fails to open it',async()=>{
  const {page,actions}=makePage({masterVisible:false,hoverOpens:false});
  await collectMaster(page,{});
  assert.equal(actions.filter(a=>a==='openMenu').length,1);
  assert.ok(actions.indexOf('openMenu')<actions.indexOf('getMaster'));
  assert.ok(actions.indexOf('hoverMenu')<actions.indexOf('openMenu'));
});
test('a hover menu is not toggled closed by a subsequent click',async()=>{
  const {page,actions}=makePage({masterVisible:false,hoverOpens:true});
  await collectMaster(page,{});
  assert.ok(actions.includes('hoverMenu'));assert.ok(!actions.includes('openMenu'));
  assert.ok(actions.includes('getMaster'));
});
test('an already visible master does not toggle the account menu closed',async()=>{
  const {page,actions}=makePage({masterVisible:true});
  await collectMaster(page,{});
  assert.ok(!actions.includes('hoverMenu'));assert.ok(!actions.includes('openMenu'));assert.ok(actions.includes('getMaster'));
});
test('menu open and visibility timeouts report distinct stages',async()=>{
  const timeout=Object.assign(new Error('PRIVATE'),{name:'TimeoutError'});
  const opening=makePage({hoverOpens:false});const locator=opening.page.locator;
  opening.page.locator=s=>s==='.dropdown-user > a.dropdown-toggle'?{click:async()=>{throw timeout;}}:locator(s);
  await assert.rejects(collectMaster(opening.page,{}),e=>e.stage==='master_menu_open'&&e.reason==='TIMEOUT');
  const visible=makePage();const wait=visible.page.waitForSelector;
  visible.page.waitForSelector=(s,o)=>s==='a.gen-pass'?Promise.reject(timeout):wait(s,o);
  await assert.rejects(collectMaster(visible.page,{}),e=>e.stage==='master_menu_visible'&&e.reason==='TIMEOUT');
});
test('a hover failure is reported without clicking or reading master',async()=>{
  const {page,actions}=makePage();const wait=page.waitForSelector;
  page.waitForSelector=async(s,o)=>{
    const handle=await wait(s,o);
    if(s==='.dropdown-user > a.dropdown-toggle')handle.hover=async()=>{throw Object.assign(new Error('PRIVATE'),{name:'TimeoutError'});};
    return handle;
  };
  await assert.rejects(collectMaster(page,{}),e=>e.stage==='master_menu_hover'&&e.reason==='TIMEOUT');
  assert.ok(!actions.includes('openMenu'));assert.ok(!actions.includes('getMaster'));
});
test('lightweight browser skips only HRM image/font/media, preserving UI scripts, APIs and verification',async()=>{
 let handler;const actions=[];
 await optimizeHrmPage({setRequestInterception:async value=>assert.equal(value,true),on:(event,fn)=>{assert.equal(event,'request');handler=fn;}});
 for(const [type,url,expected] of [
  ['image','https://hrm.ascvn.com.vn/logo.png','abort'],['font','https://hrm.ascvn.com.vn/a.woff','abort'],
  ['media','https://hrm.ascvn.com.vn/a.mp4','abort'],['stylesheet','https://hrm.ascvn.com.vn/a.css','continue'],
  ['script','https://hrm.ascvn.com.vn/a.js','continue'],['xhr','https://hrm.ascvn.com.vn/api','continue'],
  ['document','https://hrm.ascvn.com.vn/HeThong','continue'],['image','https://challenges.cloudflare.com/a','continue']]){
  handler({isInterceptResolutionHandled:()=>false,url:()=>url,resourceType:()=>type,
   abort:async()=>actions.push('abort'),continue:async()=>actions.push('continue')});
  assert.equal(actions.at(-1),expected);
 }
 const n=actions.length;handler({isInterceptResolutionHandled:()=>true});assert.equal(actions.length,n);
});
test('warm HRM browser keeps the ordinary login session while pages close after each read',async()=>{
 const {createBrowserPool}=await import('./lib/browser-pool.mjs');const pool=createBrowserPool();let launches=0,loggedIn=false,logins=0,closedPages=0,closedBrowsers=0;
 const browser={connected:true,defaultBrowserContext:()=>({overridePermissions:async()=>{}}),newPage:async()=>{
  const {page,actions}=makePage();const lookup=page.$;
  page.$=async selector=>selector==='input[name="UserName"]'&&loggedIn?null:lookup(selector);
  page.close=async()=>{closedPages++;if(actions.includes('submitLogin')){loggedIn=true;logins++;}};
  return page;
 },close:async()=>{closedBrowsers++;}};
 const options={browserPool:pool,platform:'linux',loadPuppeteer:async()=>({default:{launch:async()=>{launches++;return browser;}}}),loadChromium:async()=>({default:{args:[],executablePath:async()=>'/TEST'}})};
 const env={VERCEL:'1',HRM_USERNAME:'TEST',HRM_PASSWORD:'TEST'};
 try{
  await readMasterFromHrm(env,options);await readMasterFromHrm(env,options);
  assert.equal(launches,1);assert.equal(logins,1);assert.equal(closedPages,2);assert.equal(closedBrowsers,0);
  loggedIn=false;await readMasterFromHrm(env,options);assert.equal(logins,2);assert.equal(launches,1);
 }finally{await pool.clear();}assert.equal(closedBrowsers,1);
});
