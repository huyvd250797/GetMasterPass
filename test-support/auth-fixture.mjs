import {configStamp,csrfFor} from '../lib/security.mjs';
export const testEnv={VERCEL:'1',HRM_USERNAME:'TEST-ONLY',HRM_PASSWORD:'TEST-ONLY',ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'TEST-ADMIN-ONLY-123',SESSION_SECRET:'TEST-ONLY-SESSION-KEY-000000000000000000000000'};
export const token='a'.repeat(64),userId='11111111-1111-4111-8111-111111111111';
export const testHeaders={Cookie:`__Host-mp_session=${token}`,'X-CSRF-Token':csrfFor(token,testEnv)};
export function testStore(){return {session:async()=>({role:'user',user_id:userId,username:'tester',full_name:'TEST ONLY',auth_version:1,config_stamp:configStamp(testEnv,'user')}),
 beginGet:async()=>true,finishGet:async()=>{},event:async()=>{}};}
