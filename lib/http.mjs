import {APP_VERSION} from './app-version.mjs';
export const json=(status,body,extra={})=>new Response(JSON.stringify({...body,version:APP_VERSION}),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','CDN-Cache-Control':'no-store',
 'Vercel-CDN-Cache-Control':'no-store','X-App-Version':APP_VERSION,'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',...extra}});
export const appError=(code,status=400)=>Object.assign(new Error(code),{appCode:code,status});
export function sameOrigin(request){
 if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('x-master-request')!=='1')throw appError('FORBIDDEN',403);
 if(request.headers.get('x-app-version')!==APP_VERSION)throw appError('VERSION_MISMATCH',409);
}
export async function bodyJson(request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw appError('INVALID_INPUT');
 if(Number(request.headers.get('content-length'))>8192)throw appError('INVALID_INPUT');
 // Enforce a bound on chunked bodies too; do not parse arbitrary-length passwords.
 const reader=request.body?.getReader();if(!reader)throw appError('INVALID_INPUT');
 let bytes=0,chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>8192){await reader.cancel();throw appError('INVALID_INPUT');}chunks.push(value);}
 try {const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!b||typeof b!=='object'||Array.isArray(b))throw 0;return b;}catch{throw appError('INVALID_INPUT');}
}
export function safeAppFailure(error){
 // Application errors are created only by this server, never from HRM output.
 if(error?.appCode)return json(error.status||400,{error:error.appCode});
 return json(503,{error:error?.code==='42P01'?'DATABASE_NOT_READY':'DATABASE_UNAVAILABLE'});
}
