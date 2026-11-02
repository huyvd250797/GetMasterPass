import {appError} from './http.mjs';
export const DEFAULT_HRM_URL='https://hrm.ascvn.com.vn/HeThong';
// Server configuration only. A bad configured value must never fall back to another site.
export function hrmTarget(env={}){
 const raw=env.HRM_URL===undefined?DEFAULT_HRM_URL:env.HRM_URL;
 try{
  if(typeof raw!=='string'||!raw.trim())throw new Error();
  const url=new URL(raw.trim());
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error();
  return {home:url.href,origin:url.origin};
 }catch{throw appError('NOT_CONFIGURED',503);}
}
