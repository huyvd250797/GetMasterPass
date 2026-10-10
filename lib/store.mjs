import {randomUUID} from 'node:crypto';
import {appError} from './http.mjs';
export async function getStore(env){
 if(!env.DATABASE_URL)throw appError('DATABASE_NOT_CONFIGURED',503);
 const {neon}=await import('@neondatabase/serverless');
 const sql=neon(env.DATABASE_URL);
 // Each DB request is bounded. No error text or connection URL is exposed.
 return createStore((q,p=[])=>sql.query(q,p,{fetchOptions:{signal:AbortSignal.timeout(5000)}}),
 statements=>sql.transaction(statements.map(([q,p])=>sql.query(q,p)),{fetchOptions:{signal:AbortSignal.timeout(5000)}}));
}
export function createStore(query,transaction){
 const one=async(q,p)=>(await query(q,p))[0];
 const eventStatement=(a,action,status,targetId=null,error=null)=>[
  'INSERT INTO mp_audit(id,actor_key,username,full_name,action,status,target_id,error_code,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())',
  [randomUUID(),a.actorKey,a.username,a.fullName,action,status,targetId,error]];
 const api={
  query,
  async rate(key,limit,seconds){
   const row=await one(`INSERT INTO mp_limits(key,window_start,hits) VALUES($1,now(),1)
    ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN mp_limits.window_start<=now()-make_interval(secs=>$2) THEN 1 ELSE mp_limits.hits+1 END,
    window_start=CASE WHEN mp_limits.window_start<=now()-make_interval(secs=>$2) THEN now() ELSE mp_limits.window_start END RETURNING hits`,[key,seconds]);
   return row.hits<=limit;
  },
  userByName:username=>one('SELECT * FROM mp_users WHERE username=$1',[username]),
  session:hash=>one(`SELECT s.* FROM mp_sessions s LEFT JOIN mp_users u ON s.user_id=u.id
   WHERE s.token_hash=$1 AND s.expires_at>now() AND (s.role='admin' OR (u.active AND u.auth_version=s.auth_version))`,[hash]),
  async loginSession(s,a,action='LOGIN'){
   await transaction([
    ['DELETE FROM mp_sessions WHERE expires_at<=now()',[]],
    [`INSERT INTO mp_sessions(token_hash,role,user_id,username,full_name,auth_version,config_stamp,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '8 hours')`,[s.hash,a.role,a.userId,a.username,a.fullName,a.authVersion,s.stamp]],
    eventStatement(a,action,'ok')]);
  },
  async logout(a){await transaction([['DELETE FROM mp_sessions WHERE token_hash=$1',[a.tokenHash]],eventStatement(a,'LOGOUT','ok')]);},
  async event(a,action,status,error=null){const [q,p]=eventStatement(a,action,status,null,error);await query(q,p);},
  async createUser(a,u){
   await transaction([['INSERT INTO mp_users(id,username,full_name,password_hash) VALUES($1,$2,$3,$4)',[u.id,u.username,u.fullName,u.passwordHash]],eventStatement(a,'ACCOUNT_CREATE','ok',u.id)]);
  },
  async changeUser(a,id,{active,passwordHash}){
   // CTE emits no audit event when target does not exist. Sessions are invalidated
   // by auth_version in the same transaction as the change and admin audit.
   const rows=await query(`WITH changed AS (
    UPDATE mp_users SET active=COALESCE($2,active),password_hash=COALESCE($3,password_hash),auth_version=auth_version+1 WHERE id=$1 RETURNING id
   ) INSERT INTO mp_audit(id,actor_key,username,full_name,action,status,target_id,completed_at)
    SELECT $4,$5,$6,$7,$8,'ok',id,now() FROM changed RETURNING target_id`,
    [id,active??null,passwordHash??null,randomUUID(),a.actorKey,a.username,a.fullName,passwordHash?'PASSWORD_RESET':active?'ACCOUNT_ENABLE':'ACCOUNT_DISABLE']);
   return rows.length>0;
  },
  async users(){return query(`SELECT u.id,u.username,u.full_name,u.active,u.created_at,
   (SELECT count(*)::int FROM mp_audit a WHERE a.actor_key=u.id::text AND a.action='GET_MASTER' AND a.status='issued') AS get_count
   FROM mp_users u ORDER BY u.created_at DESC LIMIT 1000`);},
  async beginGet(a,id){
   const rows=await query(`WITH gate AS (
    INSERT INTO mp_get_gate(actor_key,started_at,busy_until) VALUES($2,now(),now()+interval '65 seconds')
    ON CONFLICT(actor_key) DO UPDATE SET started_at=now(),busy_until=now()+interval '65 seconds'
    WHERE mp_get_gate.busy_until<=now() AND mp_get_gate.started_at<=now()-interval '10 seconds' RETURNING actor_key
   ) INSERT INTO mp_audit(id,actor_key,username,full_name,action,status)
     SELECT $1,$2,$3,$4,'GET_MASTER','pending' FROM gate RETURNING id`,[id,a.actorKey,a.username,a.fullName]);
   return rows.length>0;
  },
  async finishGet(a,id,status,error=null,expiresAt=null){
   const result=await transaction([
    ['UPDATE mp_audit SET status=$2,error_code=$3,expires_at=$4,completed_at=now() WHERE id=$1 AND actor_key=$5 AND status IN (\'pending\',\'issued\') RETURNING id',[id,status,error,expiresAt,a.actorKey]],
    ['UPDATE mp_get_gate SET busy_until=now() WHERE actor_key=$1',[a.actorKey]]]);
   if(result[0].length!==1)throw appError('AUDIT_UNAVAILABLE',503);
  },
  async history({actorKey=null,from=null,to=null,offset=0}){
   const where=`action='GET_MASTER' AND ($1::text IS NULL OR actor_key=$1) AND ($2::timestamptz IS NULL OR requested_at>=$2) AND ($3::timestamptz IS NULL OR requested_at<$3)`;
   const params=[actorKey,from,to];
   const results=await transaction([
    [`SELECT id,username,full_name,requested_at,completed_at,expires_at,error_code,
      CASE WHEN status='pending' AND requested_at<now()-interval '65 seconds' THEN 'interrupted' ELSE status END AS status
      FROM mp_audit WHERE ${where} ORDER BY requested_at DESC,id DESC LIMIT 50 OFFSET $4`,[...params,offset]],
    [`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='issued')::int AS issued,
      count(*) FILTER(WHERE status IN ('failed','denied'))::int AS failed,
      count(*) FILTER(WHERE status='pending')::int AS pending FROM mp_audit WHERE ${where}`,params]]);
   return {items:results[0],stats:results[1][0],offset,pageSize:50};
  }
 };
 return api;
}
