import { APP_VERSION } from './app-version.mjs';
import { randomUUID } from 'node:crypto';
import { normalizeFailure } from './hrm-errors.mjs';
import { performance } from 'node:perf_hooks';
import { readMasterFromHrm } from './hrm-browser.mjs';

const json = (status, body, extra = {}) => new Response(JSON.stringify({...body,version:APP_VERSION}), {
  status, headers:{
    'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store',
    'X-App-Version':APP_VERSION,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra
  }
});
export async function handleMasterRequest(request, {env=process.env,reader=readMasterFromHrm,clock=()=>performance.now(),logger=event=>console.error(JSON.stringify(event))}={}) {
  if (request.method!=='POST') return json(405,{error:'METHOD_NOT_ALLOWED'},{Allow:'POST'});
  if (request.headers.get('origin')!==new URL(request.url).origin || request.headers.get('x-master-request')!=='1') {
    return json(403,{error:'FORBIDDEN'});
  }
  if (request.headers.get('x-app-version')!==APP_VERSION) return json(409,{error:'VERSION_MISMATCH'});
  // No app-level login yet. Keep this deployment protected at the hosting layer.
  // Before public release, authorize the visitor here, before invoking the HRM reader.
  // The Origin check above prevents browser cross-origin calls; it is not authentication.
  if (env.VERCEL!=='1') return json(503,{error:'UNSUPPORTED_RUNTIME'});
  if (!env.HRM_USERNAME || !env.HRM_PASSWORD) return json(503,{error:'NOT_CONFIGURED'});
  try {
    const started=clock();
    const data=await reader(env);
    if (typeof data?.password!=='string' || !data.password.trim() || data.password.length>4096 ||
        !Number.isFinite(data.remainingMs) || data.remainingMs<1000 || data.remainingMs>300000) {
      return json(502,{error:'INVALID_RESPONSE'});
    }
    const now=clock();
    const remainingMs=Math.floor(data.remainingMs-(Number.isFinite(data.readAtMs)?Math.max(0,now-data.readAtMs):0));
    if (remainingMs<1000) return json(502,{error:'INVALID_RESPONSE'});
    return json(200,{password:data.password,remainingMs,processingMs:Math.max(0,now-started)});
  } catch (error) {
    const safe=normalizeFailure(error);
    const diagnostic={error:safe.code,stage:safe.stage,reason:safe.reason,requestId:randomUUID()};
    // Only a fixed schema of allowlisted labels goes to Runtime Logs and frontend.
    // Never disclose raw errors, HTML, inputs, cookies, browser logs or stack traces.
    try {logger({event:'master_request_failed',version:APP_VERSION,...diagnostic});} catch {}
    return json(502,diagnostic);
  }
}
