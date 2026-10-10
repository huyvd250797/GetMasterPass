import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const {version}=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8'));
const html = await readFile(new URL('./public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replaceAll('__APP_VERSION__',version);
function setup({copyFails=false,configured=true,processingMs=0,transitMs=0,diagnostic,backendVersion=version,versionAvailable=true,responseVersion=version,versionLatency=0}={}) {
  let now = 0, tick, copies = [], requests = 0;
  const elements = Object.fromEntries(['get','active','seconds','progress','status','manual','server-version'].map(id => [id,{
    textContent:'', value:'', hidden:['active','manual'].includes(id), disabled:false, style:{},
    addEventListener(type,fn){this[type]=fn;}
  }]));
  const context = {
    document:{getElementById:id=>elements[id],addEventListener(){}}, window:{addEventListener(){}},
    Date:{now:()=>now}, performance:{now:()=>now},
    setInterval:fn=>{tick=fn;return 1;},clearInterval(){},AbortSignal:{timeout:()=>null},
    navigator:{clipboard:{async writeText(s){if(copyFails)throw new Error('blocked');copies.push(s);}}},
    fetch:async(url,options)=>{
      if(url==='/api/version'){now+=versionLatency;return {ok:versionAvailable,json:async()=>({version:backendVersion})};}
      assert.equal(options.headers['X-App-Version'],version);
      requests++;now+=processingMs+transitMs;return {ok:configured,json:async()=>({...(configured?{password:'TEST-ONLY',remainingMs:90000,processingMs}:(diagnostic||{error:'NOT_CONFIGURED'})),version:responseVersion})};
    }
  };
  vm.runInNewContext(script,context);
  return {elements,copies,get requests(){return requests;},advance(ms){now+=ms;tick?.();},async click(){await elements.get.click();}};
}
test('copies, shows source lifetime and restores Get after expiry',async()=>{
  const h=setup();await h.click();
  assert.deepEqual(h.copies,['TEST-ONLY']);assert.equal(h.elements.seconds.textContent,'90');
  assert.equal(h.elements.get.hidden,true);assert.equal(h.elements.manual.value,'');
  h.advance(90000);
  assert.equal(h.elements.get.hidden,false);assert.equal(h.elements.active.hidden,true);
  assert.equal(h.elements.get.textContent,'Get master password');
  await h.click();assert.equal(h.requests,2);
});
test('copy rejection offers retry without fetching another secret',async()=>{
  const h=setup({copyFails:true});await h.click();
  assert.equal(h.elements.manual.hidden,false);assert.equal(h.elements.manual.value,'TEST-ONLY');
  assert.equal(h.elements.get.textContent,'Copy master password');
  await h.click();assert.equal(h.requests,1);
  h.advance(90000);assert.equal(h.elements.manual.value,'');assert.equal(h.elements.manual.hidden,true);
});
test('missing HRM account never reports a successful copy or starts a timer',async()=>{
  const h=setup({configured:false});await h.click();
  assert.equal(h.copies.length,0);assert.equal(h.elements.active.hidden,true);
  assert.match(h.elements.status.textContent,/Chưa cấu hình/);assert.equal(h.elements.get.disabled,false);
});
test('slow server login does not get subtracted again from sampled lifetime',async()=>{
  const h=setup({processingMs:20000,transitMs:800});await h.click();
  assert.equal(h.elements.seconds.textContent,'89');
});

test('backend diagnostics are visible without copying or starting an expiry timer',async()=>{
  const requestId='00000000-0000-4000-8000-000000000000';
  const h=setup({configured:false,diagnostic:{error:'CLIPBOARD_UNAVAILABLE',stage:'clipboard_clear',reason:'PERMISSION_DENIED',requestId}});
  await h.click();
  assert.match(h.elements.status.textContent,/clipboard_clear\/PERMISSION_DENIED/);
  assert.ok(h.elements.status.textContent.includes(requestId));
  assert.equal(h.copies.length,0);assert.equal(h.elements.active.hidden,true);assert.equal(h.elements.get.disabled,false);
});

test('old or unavailable backend prevents any master request',async()=>{
  for (const options of [{backendVersion:'2.0.2'},{versionAvailable:false}]) {
    const h=setup(options);await h.click();
    assert.equal(h.requests,0);assert.equal(h.copies.length,0);assert.equal(h.elements.active.hidden,true);
    assert.match(h.elements.status.textContent,/phiên bản/);assert.equal(h.elements.get.disabled,false);
  }
});
test('deployment change between version check and master response never copies the code',async()=>{
  const h=setup({responseVersion:'2.0.2'});await h.click();
  assert.equal(h.copies.length,0);assert.equal(h.elements.active.hidden,true);
  assert.match(h.elements.status.textContent,/khác phiên bản/);
});
test('slow version check is not subtracted from the later sampled HRM lifetime',async()=>{
  const h=setup({versionLatency:5000,processingMs:20000,transitMs:800});await h.click();
  assert.equal(h.elements.seconds.textContent,'89');
  assert.equal(h.elements['server-version'].textContent,` · Server v${version}`);
});
