import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {handleVersionRequest} from '../lib/version-api.mjs';
import {handleMasterRequest} from '../lib/master-api.mjs';
import {handleAuthRequest,handleAdminRequest,handleHistoryRequest} from '../lib/auth-api.mjs';
import {createMasterReader} from '../lib/master-cache.mjs';
import {readMasterFromHrm} from '../lib/hrm-browser.mjs';
const localMasterReader=createMasterReader({reader:env=>readMasterFromHrm({...env,VERCEL:''})});
const port=Number(process.env.PORT||8787);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid PORT');
const host=`127.0.0.1:${port}`;
const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Version must use X.Y.Z');
const html=(await readFile(new URL('../public/index.html',import.meta.url),'utf8')).replaceAll('__APP_VERSION__',version);
const masterJs=await readFile(new URL('../public/master.js',import.meta.url),'utf8');
const notifyJs=await readFile(new URL('../public/notifications.js',import.meta.url),'utf8');
const authJs=await readFile(new URL('../public/app-auth.js',import.meta.url),'utf8');
http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==host){res.writeHead(403);res.end();return;}
  const path=new URL(req.url,`http://${host}`).pathname;
  if(req.method==='GET'&&['/','/app-auth.js','/master.js','/notifications.js'].includes(path)){
   res.writeHead(200,{'Content-Type':path==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY'});
   res.end(path==='/'?html:path==='/master.js'?masterJs:path==='/notifications.js'?notifyJs:authJs);return;
  }
  const handlers={'/api/version':handleVersionRequest,'/api/auth':handleAuthRequest,'/api/admin':handleAdminRequest,'/api/history':handleHistoryRequest,'/api/master-password':handleMasterRequest};
  if(!handlers[path]){res.writeHead(404);res.end();return;}
  const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(','):value);
  const init={method:req.method,headers};if(!['GET','HEAD'].includes(req.method)){init.body=Readable.toWeb(req);init.duplex='half';}
  const request=new Request(`http://${host}${req.url}`,init);
  const env={...process.env,VERCEL:'1'};
  const result=await handlers[path](request,{env,reader:localMasterReader});
  res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());
 }catch{res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'SERVER_ERROR',version}));}
}).listen(port,'127.0.0.1',()=>console.log(`Open http://${host}`));
