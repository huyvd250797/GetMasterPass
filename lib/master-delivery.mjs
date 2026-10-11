import {handleMasterRequest} from './master-api.mjs';
import {APP_VERSION} from './app-version.mjs';
import {sameOrigin,appError,safeAppFailure} from './http.mjs';
import {cookieToken} from './security.mjs';

// One POST, no polling/extra database calls. Only static milestones precede
// the result. Master remains inside the authenticated, durably audited result.
export function handleMasterDelivery(request,options={}){
 if(request.method!=='POST'||!request.headers.get('accept')?.includes('application/x-ndjson'))return handleMasterRequest(request,options);
 try{sameOrigin(request);if(!cookieToken(request))throw appError('UNAUTHENTICATED',401);}catch(error){return safeAppFailure(error);}
 let closed=false;
 const stream=new ReadableStream({
  async start(controller){
   const encoder=new TextEncoder();
   const send=value=>{if(!closed)try{controller.enqueue(encoder.encode(JSON.stringify(value)+'\n'));}catch{closed=true;}};
   try{
    const result=await handleMasterRequest(request,{...options,onProgress:step=>send({type:'progress',step,version:APP_VERSION})});
    send({type:'result',status:result.status,data:await result.json()});
   }catch{send({type:'result',status:503,data:{error:'DATABASE_UNAVAILABLE',version:APP_VERSION}});}
   finally{if(!closed){closed=true;controller.close();}}
  },
  cancel(){closed=true;}
 });
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store',
  'CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-App-Version':APP_VERSION,
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
