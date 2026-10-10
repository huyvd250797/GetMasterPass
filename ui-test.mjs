import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile(new URL('./public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function setup({copyFails=false,configured=true,processingMs=0,transitMs=0}={}) {
  let now = 0, tick, copies = [], requests = 0;
  const elements = Object.fromEntries(['get','active','seconds','progress','status','manual'].map(id => [id,{
    textContent:'', value:'', hidden:['active','manual'].includes(id), disabled:false, style:{},
    addEventListener(type,fn){this[type]=fn;}
  }]));
  const context = {
    document:{getElementById:id=>elements[id],addEventListener(){}}, window:{addEventListener(){}},
    Date:{now:()=>now}, performance:{now:()=>now},
    setInterval:fn=>{tick=fn;return 1;},clearInterval(){},AbortSignal:{timeout:()=>null},
    navigator:{clipboard:{async writeText(s){if(copyFails)throw new Error('blocked');copies.push(s);}}},
    fetch:async()=>{requests++;now+=processingMs+transitMs;return {ok:configured,json:async()=>configured?{password:'TEST-ONLY',remainingMs:90000,processingMs}:{error:'NOT_CONFIGURED'}};}
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
