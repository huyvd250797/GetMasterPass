import { performance } from 'node:perf_hooks';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {hrmBrowserPool} from './browser-pool.mjs';
import { failure, step } from './hrm-errors.mjs';
const origin='https://hrm.ascvn.com.vn';
const home=`${origin}/HeThong`;

export async function optimizeHrmPage(page){
 await page.setRequestInterception(true);
 page.on('request',request=>{
  if(request.isInterceptResolutionHandled())return;
  let skip=false;
  try{skip=new URL(request.url()).origin===origin&&['image','font','media'].includes(request.resourceType());}catch{}
  // Keep documents, scripts, stylesheets, APIs and external verification resources.
  // A closed page may reject the operation; never log the request URL or error.
  try{void (skip?request.abort():request.continue()).catch(()=>{});}catch{}
 });
}

async function checkBlock(page) {
  if (new URL(page.url()).origin!==origin) throw failure('LOGIN_REQUIRED','hrm_check');
  const blocked=await page.evaluate(()=>{
    const title=document.title;
    const text=document.body?.innerText||'';
    return /checking your browser|verify you are human|just a moment|automated traffic|unusual traffic/i.test(title+' '+text) ||
      !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"]');
  });
  if (blocked) throw failure('AUTH_BLOCKED','hrm_check');
}

// Normal UI login and the observed HRM Copy action. No alternate endpoint or challenge bypass.
export async function collectMaster(page,env,onStage=()=>{}) {
  const run=(stage,code,work)=>{onStage(stage);return step(stage,code,work);};
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(18000);
  await run('hrm_navigation','HRM_CONNECTION_FAILED',async()=>{
    const response=await page.goto(home,{waitUntil:'domcontentloaded'});
    const status=response?.status();
    if (status>=400) {
      const reason=[401,403,429].includes(status)?`HTTP_${status}`:status>=500?'HTTP_5XX':'UNKNOWN';
      throw failure('HRM_ACCESS_DENIED','hrm_navigation',reason);
    }
  });
  await run('hrm_check','HRM_CONNECTION_FAILED',()=>checkBlock(page));
  const login=await run('login_form','HRM_UI_CHANGED',()=>page.$('input[name="UserName"]'));
  if (login) {
    await run('login_form','HRM_UI_CHANGED',async()=>{
      await page.locator('input[name="UserName"]').fill(env.HRM_USERNAME);
      await page.locator('input[name="Password"]').fill(env.HRM_PASSWORD);
    });
    await run('login_submit','HRM_UI_CHANGED',async()=>{
      const button=await page.waitForFunction(()=>Array.from(document.querySelectorAll('button'))
        .find(e=>e.getClientRects().length && e.textContent.trim()==='Đăng nhập'));
      const element=button.asElement();
      if (!element) throw failure('HRM_UI_CHANGED','login_submit');
      await element.click();
    });
    await run('login_result','LOGIN_FAILED',async()=>{
      try {
        await page.waitForSelector('.dropdown-user > a.dropdown-toggle',{visible:true,timeout:18000});
      } catch(error) {
        await checkBlock(page);
        throw error;
      }
    });
  }
  await run('hrm_check','HRM_CONNECTION_FAILED',()=>checkBlock(page));
  await run('dismiss_notice','HRM_UI_CHANGED',async()=>{
    // Close the site's offered expired-password notice; never change a credential.
    const close=await page.$('#popupAddUpdatePassword #close');
    // Do not wait for a notice that may never appear after password renewal.
    if (close && await close.isVisible()) {
      await close.click();
      await page.waitForSelector('#popupAddUpdatePassword #close',{hidden:true,timeout:5000});
    }
  });
  await run('clipboard_clear','CLIPBOARD_UNAVAILABLE',async()=>{
    await page.bringToFront();
    // This is an isolated server clipboard, not the visitor's desktop clipboard.
    await page.evaluate(()=>navigator.clipboard.writeText(''));
  });
  await run('master_menu','HRM_UI_CHANGED',async()=>{
    const master=await page.$('a.gen-pass');
    if (!master) throw failure('HRM_UI_CHANGED','master_menu');
    // HRM advertises both data-hover="dropdown" and data-bs-toggle="dropdown".
    // Moving the pointer for a click can open a hover menu before the click
    // toggles it closed. Hover first, observe, then click only if still closed.
    if (!await master.isVisible()) {
      await run('master_menu_hover','HRM_UI_CHANGED',async()=>{
        const toggle=await page.waitForSelector('.dropdown-user > a.dropdown-toggle',{visible:true});
        try {await toggle.hover();} finally {await toggle.dispose();}
      });
      try {
        await page.waitForSelector('a.gen-pass',{visible:true,timeout:1200});
      } catch(error) {
        // A click-only dropdown is a supported UI path, not a browser retry.
        if (error?.name!=='TimeoutError') throw error;
        if (!await master.isVisible()) {
          await run('master_menu_open','HRM_UI_CHANGED',()=>page.locator('.dropdown-user > a.dropdown-toggle').click());
        }
      }
    }
    await run('master_menu_visible','HRM_UI_CHANGED',()=>page.waitForSelector('a.gen-pass',{visible:true}));
  });
  await run('master_copy','COPY_FAILED',async()=>{
    await page.locator('a.gen-pass').click();
    await page.waitForFunction(async()=>{
      const timer=document.querySelector('#timer')?.textContent?.trim()||'';
      if (!/^\d{1,3}$/.test(timer) || Number(timer)<1 || Number(timer)>300) return false;
      return (await navigator.clipboard.readText()).trim().length>0;
    },{timeout:8000});
  });
  return run('master_read','COPY_FAILED',async()=>{
    const readStarted=performance.now();
    const data=await page.evaluate(async()=>({
      password:await navigator.clipboard.readText(),
      seconds:Number(document.querySelector('#timer')?.textContent?.trim())
    }));
    const now=performance.now();
    return {password:data.password,remainingMs:Math.floor(data.seconds*1000-(now-readStarted)),readAtMs:now,readAtWallMs:Date.now()};
  });
}

export async function readMasterFromHrm(env,{
  loadPuppeteer=()=>import('puppeteer-core'),loadChromium=()=>import('@sparticuz/chromium'),platform=process.platform,browserPool=hrmBrowserPool
}={}) {
  let deadline,currentStage='dependencies';
  const started=performance.now();
  const run=(stage,code,work)=>{currentStage=stage;return step(stage,code,work);};
  const launch=async()=>{
    let browser;try{
    const {default:puppeteer}=await run('dependencies','BROWSER_UNAVAILABLE',loadPuppeteer);
    let args,executablePath,headless;
    if (env.VERCEL==='1' && platform==='linux') {
      const {default:chromium}=await run('dependencies','BROWSER_UNAVAILABLE',loadChromium);
      chromium.setGraphicsMode=false;
      args=chromium.args;headless='shell';
      // Explicit included bin path also works when Vercel relocates/bundles module code.
      const bin=join(process.cwd(),'node_modules','@sparticuz','chromium','bin');
      executablePath=await run('browser_binary','BROWSER_UNAVAILABLE',()=>chromium.executablePath(existsSync(bin)?bin:undefined));
    } else if (env.LOCAL_CHROME_PATH) {
      args=[];executablePath=env.LOCAL_CHROME_PATH;headless=true;
    } else {throw failure('BROWSER_UNAVAILABLE','browser_binary','FILE_MISSING');}
    const budget=50000-(performance.now()-started);
    if (budget<=0) throw failure('HRM_TIMEOUT',currentStage,'TIMEOUT');
    browser=await run('browser_launch','BROWSER_START_FAILED',()=>puppeteer.launch({args,executablePath,headless,
      defaultViewport:{width:1366,height:900},timeout:Math.min(15000,budget)}));
    // Grant sanitized text writes too. In Puppeteer both clipboard-read and
    // clipboard-write map to clipboardReadWrite; neither grants clipboardSanitizedWrite.
    await run('browser_permissions','BROWSER_SETUP_FAILED',()=>browser.defaultBrowserContext().overridePermissions(origin,
      ['clipboard-read','clipboard-write','clipboard-sanitized-write']));
    return browser;
    }catch(error){await browser?.close().catch(()=>{});throw error;}
  };
  try{return await browserPool.run(env,launch,async(browser,reused)=>{
    const page=await run('browser_page','BROWSER_SETUP_FAILED',()=>browser.newPage());
    if(env.HRM_LIGHTWEIGHT_BROWSER!=='0')await run('browser_page','BROWSER_SETUP_FAILED',()=>optimizeHrmPage(page));
    try{return await Promise.race([
      collectMaster(page,env,stage=>{currentStage=stage;}),
      new Promise((_,reject)=>{deadline=setTimeout(()=>reject(failure('HRM_TIMEOUT',currentStage,'TIMEOUT')),Math.max(1,50000-(performance.now()-started)));})
    ]);}finally{
     clearTimeout(deadline);
     if(page.close)await run('browser_page','BROWSER_SETUP_FAILED',()=>page.close());
    }
  });}finally{clearTimeout(deadline);}
}
