import test from 'node:test';
import assert from 'node:assert/strict';
import {APP_VERSION} from './lib/app-version.mjs';
import {handleVersionRequest} from './lib/version-api.mjs';
import {readFile} from 'node:fs/promises';
test('version endpoint is noncached and exposes only the release version',async()=>{
  const response=handleVersionRequest(new Request('https://test.invalid/api/version'));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('x-app-version'),APP_VERSION);
  assert.deepEqual(await response.json(),{version:APP_VERSION});
});
test('version endpoint rejects write methods',async()=>{
  const response=handleVersionRequest(new Request('https://test.invalid/api/version',{method:'POST'}));
  assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET');
});
test('release version follows X.Y.Z and matches lockfile',async()=>{
  assert.match(APP_VERSION,/^\d+\.\d+\.\d+$/);
  const lock=JSON.parse(await readFile(new URL('./package-lock.json',import.meta.url),'utf8'));
  assert.equal(lock.version,APP_VERSION);assert.equal(lock.packages[''].version,APP_VERSION);
});
