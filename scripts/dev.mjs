import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { handleMasterRequest } from '../lib/master-api.mjs';
const port=Number(process.env.PORT||8787);
if (!Number.isInteger(port)||port<1024||port>65535) throw new Error('Invalid PORT');
const host=`127.0.0.1:${port}`;
const html=await readFile(new URL('../public/index.html',import.meta.url));
http.createServer(async(req,res)=>{
  if (req.headers.host!==host) {res.writeHead(403);res.end();return;}
  if (req.url==='/'&&req.method==='GET') {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY'});
    res.end(html);return;
  }
  if (req.url!=='/api/master-password') {res.writeHead(404);res.end();return;}
  const headers=new Headers();
  for (const [name,value] of Object.entries(req.headers)) {
    if (value!==undefined) headers.set(name,Array.isArray(value)?value.join(','):value);
  }
  const request=new Request(`http://${host}${req.url}`,{method:req.method,headers});
  const env={...process.env,VERCEL:'1'};
  const reader=(await import('../lib/hrm-browser.mjs')).readMasterFromHrm;
  const result=await handleMasterRequest(request,{env,reader:()=>reader({...process.env,VERCEL:''})});
  res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());
}).listen(port,'127.0.0.1',()=>console.log(`Open http://${host}`));
