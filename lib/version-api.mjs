import { APP_VERSION } from './app-version.mjs';
// Deployment metadata only: no HRM connection, credentials or browser session.
export function handleVersionRequest(request) {
  const ok=request.method==='GET';
  return new Response(JSON.stringify(ok?{version:APP_VERSION}:{error:'METHOD_NOT_ALLOWED',version:APP_VERSION}),{
    status:ok?200:405,headers:{
      'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
      'CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store',
      'X-App-Version':APP_VERSION,'X-Content-Type-Options':'nosniff',...(!ok?{Allow:'GET'}:{})
    }
  });
}
