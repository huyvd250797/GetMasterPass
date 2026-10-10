// Only these static labels may leave the server. Never log browser error messages,
// stack traces, page contents, URLs, cookies or credential values.
export const codes = new Set(['LOGIN_FAILED','AUTH_BLOCKED','LOGIN_REQUIRED','HRM_UI_CHANGED',
  'COPY_FAILED','HRM_TIMEOUT','BROWSER_UNAVAILABLE','BROWSER_START_FAILED','BROWSER_SETUP_FAILED',
  'HRM_CONNECTION_FAILED','HRM_ACCESS_DENIED','CLIPBOARD_UNAVAILABLE','HRM_UNAVAILABLE']);
export const stages = new Set(['dependencies','browser_binary','browser_launch','browser_permissions',
  'browser_page','hrm_navigation','hrm_check','login_form','login_submit','login_result',
  'dismiss_notice','clipboard_clear','master_menu','master_menu_hover','master_menu_open','master_menu_visible','master_copy','master_read','reader']);
const reasons = new Set(['UNKNOWN','FILE_MISSING','LIBRARY_MISSING','TIMEOUT','DNS_FAILED',
  'CONNECTION_REFUSED','CONNECTION_RESET','CONNECTION_CLOSED','TLS_FAILED','NETWORK_FAILED',
  'PERMISSION_DENIED','BROWSER_CLOSED','DEPENDENCY_MISSING','HTTP_401','HTTP_403','HTTP_429','HTTP_5XX']);
export function safeReason(error) {
  if (reasons.has(error?.reason)) return error.reason;
  // Inspect locally to classify, but never return the source string.
  const text = String(error?.message || '');
  if (/error while loading shared libraries|cannot open shared object file/i.test(text)) return 'LIBRARY_MISSING';
  if (error?.code==='ENOENT' || /input directory .* does not exist/i.test(text)) return 'FILE_MISSING';
  if (error?.code==='ERR_MODULE_NOT_FOUND') return 'DEPENDENCY_MISSING';
  if (error?.name==='TimeoutError' || /timed out|timeout/i.test(text)) return 'TIMEOUT';
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/.test(text)) return 'DNS_FAILED';
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(text)) return 'CONNECTION_REFUSED';
  if (/ERR_CONNECTION_RESET|ECONNRESET/.test(text)) return 'CONNECTION_RESET';
  if (/ERR_CONNECTION_CLOSED/.test(text)) return 'CONNECTION_CLOSED';
  if (/ERR_CERT_|certificate|SSL|TLS/.test(text)) return 'TLS_FAILED';
  if (/ERR_NETWORK|ERR_INTERNET|ERR_FAILED/.test(text)) return 'NETWORK_FAILED';
  if (error?.name==='NotAllowedError' || /permission denied|read permission|write permission/i.test(text)) return 'PERMISSION_DENIED';
  if (/Target closed|Session closed|Connection closed|browser has disconnected/i.test(text)) return 'BROWSER_CLOSED';
  return 'UNKNOWN';
}
export function failure(code,stage,reason='UNKNOWN') {
  return Object.assign(new Error(code),{code,stage,reason});
}
export function normalizeFailure(error,stage='reader',fallback='HRM_UNAVAILABLE') {
  return failure(codes.has(error?.code)?error.code:fallback,
    stages.has(error?.stage)?error.stage:stage,safeReason(error));
}
export async function step(stage,code,work) {
  try {return await work();} catch(error) {throw normalizeFailure(error,stage,code);}
}
