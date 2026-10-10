// Safe diagnostic labels only. Never return values or secret lengths.
export const AUTH_CONFIG_ISSUES=new Set([
 'ADMIN_USERNAME_MISSING','ADMIN_USERNAME_INVALID',
 'ADMIN_PASSWORD_MISSING','ADMIN_PASSWORD_TOO_SHORT','ADMIN_PASSWORD_TOO_LONG',
 'SESSION_SECRET_MISSING','SESSION_SECRET_TOO_SHORT'
]);
export const normalizeUsername=s=>typeof s==='string'?s.trim().toLowerCase():'';
export const validUsername=s=>/^[a-z0-9][a-z0-9._-]{2,63}$/.test(s);
export function authConfigIssues(env){
 const issues=[];
 if(typeof env.ADMIN_USERNAME!=='string'||!env.ADMIN_USERNAME.trim())issues.push('ADMIN_USERNAME_MISSING');
 else if(!validUsername(normalizeUsername(env.ADMIN_USERNAME)))issues.push('ADMIN_USERNAME_INVALID');
 if(typeof env.ADMIN_PASSWORD!=='string'||!env.ADMIN_PASSWORD)issues.push('ADMIN_PASSWORD_MISSING');
 else if(env.ADMIN_PASSWORD.length<12)issues.push('ADMIN_PASSWORD_TOO_SHORT');
 else if(env.ADMIN_PASSWORD.length>256)issues.push('ADMIN_PASSWORD_TOO_LONG');
 if(typeof env.SESSION_SECRET!=='string'||!env.SESSION_SECRET)issues.push('SESSION_SECRET_MISSING');
 else if(env.SESSION_SECRET.length<32)issues.push('SESSION_SECRET_TOO_SHORT');
 return issues;
}
