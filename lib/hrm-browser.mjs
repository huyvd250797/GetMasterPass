import { performance } from 'node:perf_hooks';
const origin='https://hrm.ascvn.com.vn';
const home=`${origin}/HeThong`;
const failure=code=>Object.assign(new Error(code),{code});

async function checkBlock(page) {
  if (new URL(page.url()).origin!==origin) throw failure('LOGIN_REQUIRED');
  const blocked=await page.evaluate(()=>{
    const title=document.title;
    const text=document.body?.innerText||'';
    return /checking your browser|verify you are human|just a moment|automated traffic|unusual traffic/i.test(title+' '+text) ||
      !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"]');
  });
  if (blocked) throw failure('AUTH_BLOCKED');
}

// Normal UI login and the observed HRM Copy action. No alternate endpoint, fingerprint spoofing or challenge bypass.
export async function collectMaster(page,env) {
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(18000);
  await page.goto(home,{waitUntil:'domcontentloaded'});
  await checkBlock(page);
  const login=await page.$('input[name="UserName"]');
  if (login) {
    await page.locator('input[name="UserName"]').fill(env.HRM_USERNAME);
    await page.locator('input[name="Password"]').fill(env.HRM_PASSWORD);
    const button=await page.waitForFunction(()=>Array.from(document.querySelectorAll('button'))
      .find(e=>e.getClientRects().length && e.textContent.trim()==='Đăng nhập'));
    const element=button.asElement();
    if (!element) throw failure('HRM_UI_CHANGED');
    await element.click();
    try {
      await page.waitForSelector('.dropdown-user > a.dropdown-toggle',{visible:true,timeout:18000});
    } catch {
      await checkBlock(page);
      throw failure('LOGIN_FAILED');
    }
  }
  await checkBlock(page);
  // The site offers a Close control for its expired-password notification. Never change a credential.
  const close=await page.$('#popupAddUpdatePassword #close');
  if (close && await close.boundingBox()) await close.click();
  await page.bringToFront();
  // This is an isolated server browser clipboard, not the visitor's desktop clipboard.
  await page.evaluate(()=>navigator.clipboard.writeText(''));
  const master=await page.$('a.gen-pass');
  if (!master) throw failure('HRM_UI_CHANGED');
  if (!await master.boundingBox()) {
    await page.locator('.dropdown-user > a.dropdown-toggle').click();
  }
  await page.waitForSelector('a.gen-pass',{visible:true});
  await page.locator('a.gen-pass').click();
  try {
    await page.waitForFunction(async()=>{
      const timer=document.querySelector('#timer')?.textContent?.trim()||'';
      if (!/^\d{1,3}$/.test(timer) || Number(timer)<1 || Number(timer)>300) return false;
      return (await navigator.clipboard.readText()).trim().length>0;
    },{timeout:8000});
  } catch {throw failure('COPY_FAILED');}
  const readStarted=performance.now();
  const data=await page.evaluate(async()=>({
    password:await navigator.clipboard.readText(),
    seconds:Number(document.querySelector('#timer')?.textContent?.trim())
  }));
  const now=performance.now();
  return {password:data.password,remainingMs:Math.floor(data.seconds*1000-(now-readStarted)),readAtMs:now};
}

export async function readMasterFromHrm(env) {
  let browser,deadline;
  const started=performance.now();
  try {
    const {default:puppeteer}=await import('puppeteer-core');
    let args,executablePath,headless;
    if (env.VERCEL==='1' && process.platform==='linux') {
      const {default:chromium}=await import('@sparticuz/chromium');
      chromium.setGraphicsMode=false;
      args=chromium.args;executablePath=await chromium.executablePath();headless='shell';
    } else if (env.LOCAL_CHROME_PATH) {
      args=[];executablePath=env.LOCAL_CHROME_PATH;headless=true;
    } else {throw failure('BROWSER_UNAVAILABLE');}
    const budget=50000-(performance.now()-started);
    if (budget<=0) throw failure('HRM_TIMEOUT');
    browser=await puppeteer.launch({args,executablePath,headless,timeout:Math.min(15000,budget)});
    await browser.defaultBrowserContext().overridePermissions(origin,['clipboard-read','clipboard-write']);
    const page=await browser.newPage();
    return await Promise.race([
      collectMaster(page,env),
      new Promise((_,reject)=>{deadline=setTimeout(()=>reject(failure('HRM_TIMEOUT')),Math.max(1,50000-(performance.now()-started)));})
    ]);
  } catch (error) {
    if (error.code) throw error;
    throw failure('HRM_UNAVAILABLE');
  } finally {
    clearTimeout(deadline);
    if (browser) await browser.close().catch(()=>{});
  }
}
