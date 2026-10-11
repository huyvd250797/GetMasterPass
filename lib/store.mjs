import {randomUUID} from 'node:crypto';
import {appError} from './http.mjs';
import {performance} from 'node:perf_hooks';
import {ADMIN_SESSION_HOURS,DEFAULT_USER_SESSION_HOURS,validSessionHours} from './session-policy.mjs';
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
  session:hash=>one(`SELECT s.*,floor(extract(epoch FROM (s.expires_at-now()))*1000) AS session_remaining_ms FROM mp_sessions s LEFT JOIN mp_users u ON s.user_id=u.id
   WHERE s.token_hash=$1 AND s.expires_at>now() AND (s.role='admin' OR (u.active AND u.auth_version=s.auth_version))`,[hash]),
  async sessionWithCache(hash,scope){
   const observed=performance.now();
   const row=await one(`SELECT s.*,c.payload AS cache_payload,c.expires_at AS cache_expires_at,
    floor(extract(epoch FROM (c.expires_at-now()))*1000) AS cache_remaining_ms
    FROM mp_sessions s LEFT JOIN mp_users u ON s.user_id=u.id
    LEFT JOIN mp_master_cache c ON c.scope=$2 AND c.expires_at>now()+interval '3 seconds'
    WHERE s.token_hash=$1 AND s.expires_at>now() AND (s.role='admin' OR (u.active AND u.auth_version=s.auth_version))`,[hash,scope]);
   if(row)row.cache_read_at_ms=observed;return row;
  },
  async admitSessionWithCache(hash,scope,id,userStamp,adminStamp){
   const observed=performance.now();
   const row=await one(`WITH authorized AS MATERIALIZED (
    SELECT s.*,CASE WHEN s.role='admin' THEN 'admin' ELSE s.user_id::text END AS actor_key,
     c.payload AS cache_payload,c.expires_at AS cache_expires_at,
     floor(extract(epoch FROM (c.expires_at-now()))*1000) AS cache_remaining_ms
    FROM mp_sessions s LEFT JOIN mp_users u ON s.user_id=u.id
    LEFT JOIN mp_master_cache c ON c.scope=$2 AND c.expires_at>now()+interval '3 seconds'
    WHERE s.token_hash=$1 AND s.expires_at>now()
     AND s.config_stamp=CASE WHEN s.role='admin' THEN $5 ELSE $4 END
     AND (s.role='admin' OR (u.active AND u.auth_version=s.auth_version))
   ), gate AS (
    INSERT INTO mp_get_gate(actor_key,started_at,busy_until)
    SELECT actor_key,now(),now()+interval '65 seconds' FROM authorized
    ON CONFLICT(actor_key) DO UPDATE SET started_at=now(),busy_until=now()+interval '65 seconds'
    WHERE mp_get_gate.busy_until<=now() AND mp_get_gate.started_at<=now()-interval '10 seconds' RETURNING actor_key
   ), admission AS (
    INSERT INTO mp_audit(id,actor_key,username,full_name,action,status)
    SELECT $3,a.actor_key,a.username,a.full_name,'GET_MASTER','pending' FROM authorized a JOIN gate g USING(actor_key) RETURNING id
   ), denied AS (
    INSERT INTO mp_audit(id,actor_key,username,full_name,action,status,error_code,completed_at)
    SELECT $3,actor_key,username,full_name,'GET_MASTER','denied','RATE_LIMITED',now() FROM authorized
    WHERE NOT EXISTS(SELECT 1 FROM gate)
   ) SELECT a.*,EXISTS(SELECT 1 FROM admission) AS get_admitted FROM authorized a`,[hash,scope??null,id,userStamp,adminStamp]);
   if(row)row.cache_read_at_ms=observed;return row;
  },
  async loginSession(s,a,action='LOGIN'){
   const observed=performance.now();
   const results=await transaction([
    ['DELETE FROM mp_sessions WHERE expires_at<=now()',[]],
    [`INSERT INTO mp_sessions(token_hash,role,user_id,username,full_name,auth_version,config_stamp,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()+make_interval(hours=>CASE WHEN $2='admin' THEN $8 ELSE
       COALESCE((SELECT user_session_hours FROM mp_app_settings WHERE id=true),$9) END))
      RETURNING expires_at,floor(extract(epoch FROM (expires_at-now()))*1000) AS remaining_ms`,
      [s.hash,a.role,a.userId,a.username,a.fullName,a.authVersion,s.stamp,ADMIN_SESSION_HOURS,DEFAULT_USER_SESSION_HOURS]],
    eventStatement(a,action,'ok')]);
   const row=results[1][0];
   return {expiresAt:new Date(row.expires_at).toISOString(),remainingMs:Math.max(0,Number(row.remaining_ms)-(performance.now()-observed))};
  },
  async userSessionHours(){
   const row=await one('SELECT user_session_hours FROM mp_app_settings WHERE id=true');
   return row?.user_session_hours??DEFAULT_USER_SESSION_HOURS;
  },
  async setUserSessionHours(a,hours){
   if(a.role!=='admin')throw appError('FORBIDDEN',403);
   if(!validSessionHours(hours))throw appError('SESSION_HOURS_INVALID');
   await transaction([
    [`INSERT INTO mp_app_settings(id,user_session_hours,updated_at) VALUES(true,$1,now())
      ON CONFLICT(id) DO UPDATE SET user_session_hours=$1,updated_at=now()`,[hours]],
    eventStatement(a,'SESSION_POLICY_UPDATE','ok',null,'USER_SESSION_HOURS_'+hours)]);
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
  async changeOwnPassword(a,oldHash,passwordHash){
   const rows=await query(`WITH changed AS (
    UPDATE mp_users u SET password_hash=$3,auth_version=auth_version+1
    WHERE u.id=$1 AND u.active AND u.auth_version=$4 AND u.password_hash=$2
     AND EXISTS(SELECT 1 FROM mp_sessions s WHERE s.token_hash=$5 AND s.user_id=u.id AND s.expires_at>now()) RETURNING id
   ), removed AS (DELETE FROM mp_sessions s USING changed c WHERE s.user_id=c.id RETURNING s.token_hash)
   INSERT INTO mp_audit(id,actor_key,username,full_name,action,status,target_id,completed_at)
    SELECT $6,$7,$8,$9,'PASSWORD_CHANGE','ok',id,now() FROM changed RETURNING id`,
   [a.userId,oldHash,passwordHash,a.authVersion,a.tokenHash,randomUUID(),a.actorKey,a.username,a.fullName]);
   return rows.length===1;
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
  async finishGetVerified(a,id,stamp,expiresAt){
   const rows=await query(`WITH authorized AS MATERIALIZED (
    SELECT s.token_hash FROM mp_sessions s LEFT JOIN mp_users u ON s.user_id=u.id
    WHERE s.token_hash=$3 AND s.config_stamp=$4 AND s.expires_at>now()
     AND (s.role='admin' OR (u.active AND u.auth_version=s.auth_version))
   ), outcome AS (
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM authorized) THEN 'denied'
     WHEN $5::timestamptz<=now()+interval '1 second' THEN 'failed' ELSE 'issued' END AS status
   ), updated AS (
    UPDATE mp_audit a SET status=o.status,completed_at=now(),expires_at=$5,
     error_code=CASE WHEN o.status='denied' THEN 'UNAUTHENTICATED' WHEN o.status='failed' THEN 'INVALID_RESPONSE' ELSE NULL END
    FROM outcome o WHERE a.id=$1 AND a.actor_key=$2 AND a.status='pending' RETURNING a.status,a.error_code
   ), released AS (UPDATE mp_get_gate SET busy_until=now() WHERE actor_key=$2 AND EXISTS(SELECT 1 FROM updated))
   SELECT * FROM updated`,[id,a.actorKey,a.tokenHash,stamp,expiresAt]);
   if(rows.length!==1)throw appError('AUDIT_UNAVAILABLE',503);return rows[0];
  },
  async cacheRead(scope){
   const observed=performance.now();const row=await one(`SELECT payload,expires_at,
    floor(extract(epoch FROM (expires_at-now()))*1000) AS remaining_ms FROM mp_master_cache WHERE scope=$1`,[scope]);
   return row?{...row,read_at_ms:observed}:null;
  },
  async cacheAcquire(scope,id){
   const rows=await query(`INSERT INTO mp_master_cache(scope,lease_id,lease_until) VALUES($1,$2,now()+interval '55 seconds')
    ON CONFLICT(scope) DO UPDATE SET lease_id=$2,lease_until=now()+interval '55 seconds'
    WHERE mp_master_cache.lease_until<=now() RETURNING scope`,[scope,id]);return rows.length===1;
  },
  async cacheAcquireWithSnapshot(scope,id){
   const observed=performance.now();
   const row=await one(`WITH acquired AS (
    INSERT INTO mp_master_cache(scope,lease_id,lease_until) VALUES($1,$2,now()+interval '55 seconds')
    ON CONFLICT(scope) DO UPDATE SET lease_id=$2,lease_until=now()+interval '55 seconds'
    WHERE mp_master_cache.lease_until<=now() RETURNING payload,expires_at
   ) SELECT true AS acquired,payload,expires_at,
     floor(extract(epoch FROM (expires_at-now()))*1000) AS remaining_ms FROM acquired
    UNION ALL SELECT false AS acquired,payload,expires_at,
     floor(extract(epoch FROM (expires_at-now()))*1000) AS remaining_ms FROM mp_master_cache
     WHERE scope=$1 AND NOT EXISTS(SELECT 1 FROM acquired)`,[scope,id]);
   return {...row,acquired:row?.acquired===true,read_at_ms:observed};
  },
  async cachePublish(scope,id,payload,expiresAt){
   const rows=await query(`UPDATE mp_master_cache SET payload=$3,expires_at=$4,lease_id=NULL,lease_until=now()
    WHERE scope=$1 AND lease_id=$2 AND lease_until>now() RETURNING scope`,[scope,id,payload,expiresAt]);
   return rows.length===1;
  },
  async cacheRelease(scope,id){await query('UPDATE mp_master_cache SET lease_id=NULL,lease_until=now() WHERE scope=$1 AND lease_id=$2',[scope,id]);},
  async deleteHistory(a,id=null){
   const rows=await query(`WITH deleted AS (
    DELETE FROM mp_audit WHERE action='GET_MASTER' AND ($1::uuid IS NULL OR id=$1)
     AND (status<>'pending' OR requested_at<now()-interval '65 seconds') RETURNING id
   ), logged AS (
    INSERT INTO mp_audit(id,actor_key,username,full_name,action,status,target_id,error_code,completed_at)
    SELECT $2,$3,$4,$5,$6,'ok',$1,'DELETED_'||count(*)::text,now() FROM deleted
   ) SELECT count(*)::int AS deleted FROM deleted`,
   [id,randomUUID(),a.actorKey,a.username,a.fullName,id?'HISTORY_DELETE_ONE':'HISTORY_DELETE_ALL']);
   return rows[0].deleted;
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
