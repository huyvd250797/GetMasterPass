(() => {
 const $=id=>document.getElementById(id);
 const version=$('app-version').textContent.trim().replace(/^v/,'');
 let authEpoch=0,offset=0,total=0,selectedTab='master',resetId='',historyLoad=0,usersLoad=0;
 const errors={UNAUTHENTICATED:'Vui lòng đăng nhập lại.',INVALID_CREDENTIALS:'Sai username, mật khẩu hoặc tài khoản đã bị khóa.',
  FORBIDDEN:'Tài khoản không có quyền thực hiện thao tác.',AUTH_NOT_CONFIGURED:'Chưa cấu hình đăng nhập. Liên hệ quản trị viên.',
  DATABASE_NOT_CONFIGURED:'Chưa cấu hình dữ liệu. Liên hệ quản trị viên.',DATABASE_NOT_READY:'Chưa khởi tạo dữ liệu. Liên hệ quản trị viên.',
  DATABASE_UNAVAILABLE:'Chưa kết nối được cơ sở dữ liệu. Vui lòng thử lại sau.',VERSION_MISMATCH:'Giao diện và server khác phiên bản. Tải lại trang.',
  RATE_LIMITED:'Quá nhiều yêu cầu. Đăng nhập tối đa 8 lần / 15 phút cho mỗi username; hãy thử lại sau.',
  USERNAME_EXISTS:'Username đã tồn tại.',RESERVED_USERNAME:'Username này dành cho admin.',PASSWORD_POLICY:'Mật khẩu phải có từ 4 đến 256 ký tự.',
  INVALID_INPUT:'Thông tin chưa hợp lệ. Kiểm tra các trường và khoảng ngày.',USER_NOT_FOUND:'Tài khoản không tồn tại.'};
 const show=(id,text,type='')=>{$(id).textContent=text;$(id).className='note '+type;};
 const configMessages={
  ADMIN_USERNAME_MISSING:'ADMIN_USERNAME: deployment chưa nhận được giá trị.',
  ADMIN_USERNAME_INVALID:'ADMIN_USERNAME: cần 3–64 ký tự, bắt đầu bằng chữ/số; chỉ dùng chữ không dấu, số, dấu . _ -.',
  ADMIN_PASSWORD_MISSING:'ADMIN_PASSWORD: deployment chưa nhận được giá trị.',
  ADMIN_PASSWORD_TOO_SHORT:'ADMIN_PASSWORD: cần ít nhất 8 ký tự.',
  ADMIN_PASSWORD_TOO_LONG:'ADMIN_PASSWORD: tối đa 256 ký tự.',
  SESSION_SECRET_MISSING:'SESSION_SECRET: deployment chưa nhận được giá trị.',
  SESSION_SECRET_TOO_SHORT:'SESSION_SECRET: cần ít nhất 32 ký tự.'
 };
 function errorText(e){
  if(e.message==='AUTH_NOT_CONFIGURED'){
   const issues=e.diagnostic?.configIssues;
   const details=Array.isArray(issues)?[...new Set(issues.filter(s=>typeof s==='string'&&Object.hasOwn(configMessages,s)))].map(s=>configMessages[s]):[];
   if(details.length)return 'Cấu hình đăng nhập chưa hợp lệ. '+details.join(' ')+' Kiểm tra Environment Variables của đúng project và môi trường, sau đó deploy lại.';
  }
  return errors[e.message]||'Không hoàn tất được yêu cầu. Vui lòng thử lại.';
 }
 function requireLogin(){
  authEpoch++;historyLoad++;usersLoad++;window.MasterSession=null;window.clearMaster?.();$('workspace').hidden=true;$('login-panel').hidden=false;
  $('tab-users').hidden=true;$('actor-filter').hidden=true;document.querySelector('main').classList.remove('wide');
  $('create-form').reset();$('history-actor').replaceChildren();$('who').textContent='';
  $('users-rows').replaceChildren();$('history-rows').replaceChildren();$('reset-dialog').close();$('reset-password').value='';resetId='';
 }
 window.MasterAccess={requireLogin,errorText};
 async function api(path,body){
  const options={method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)};
  if(body){options.headers={'Content-Type':'application/json','X-Master-Request':'1','X-App-Version':version,'X-CSRF-Token':window.MasterSession?.csrfToken||''};options.body=JSON.stringify(body);}
  const requestSession=window.MasterSession;
  const r=await fetch(path,options);const d=await r.json();
  if(d.version!==version)throw new Error('VERSION_MISMATCH');
  if(!r.ok){if(r.status===401&&body?.action!=='login'&&window.MasterSession===requestSession)requireLogin();throw Object.assign(new Error(d.error||'FAILED'),{diagnostic:d});}
  return d;
 }
 function enter(d){
  if(window.MasterSession?.csrfToken!==d.csrfToken){authEpoch++;window.clearMaster?.();}
  if(window.MasterSession?.csrfToken!==d.csrfToken)window.MasterSession={user:d.user,csrfToken:d.csrfToken};
  $('login-panel').hidden=true;$('workspace').hidden=false;$('login-password').value='';
  $('who').textContent=`${d.user.fullName} · ${d.user.username}${d.user.role==='admin'?' · Admin':''}`;
  $('tab-users').hidden=d.user.role!=='admin';$('actor-filter').hidden=d.user.role!=='admin';
 }
 async function refresh(){
  const epoch=authEpoch;try{const d=await api('/api/auth');if(epoch!==authEpoch)return;enter(d);}
  catch(e){if(epoch!==authEpoch)return;if(e.message==='UNAUTHENTICATED')requireLogin();else show(window.MasterSession?'app-status':'login-status',errorText(e),'error');}
 }
 async function busy(button,work,statusId='app-status'){
  button.disabled=true;try{await work();}catch(e){show(statusId,errorText(e),'error');}finally{button.disabled=false;}
 }
 function row(cells){const tr=document.createElement('tr');for(const text of cells){const td=document.createElement('td');td.textContent=text??'—';tr.append(td);}return tr;}
 const time=s=>s?new Date(s).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false}):'—';
 function empty(tbody,text,span){const tr=row([text]);tr.firstChild.colSpan=span;tr.firstChild.className='empty';tbody.append(tr);}
 async function loadUsers(){
  const sequence=++usersLoad,session=window.MasterSession;const d=await api('/api/admin');
  if(sequence!==usersLoad||window.MasterSession!==session)return;
  $('users-rows').replaceChildren();const filter=$('history-actor'),previous=filter.value;
  filter.replaceChildren();for(const [value,label] of [['','Tất cả'],['admin','Quản trị viên'],...d.users.map(u=>[u.id,`${u.full_name} (${u.username})`])]){
   const opt=document.createElement('option');opt.value=value;opt.textContent=label;filter.append(opt);
  }filter.value=previous;
  for(const u of d.users){
   const tr=row([u.full_name,u.username,u.active?'Hoạt động':'Đã khóa',u.get_count]);
   const td=document.createElement('td');td.className='row-actions';
   const toggle=document.createElement('button');toggle.type='button';toggle.className='secondary';toggle.textContent=u.active?'Khóa':'Mở khóa';
   toggle.addEventListener('click',()=>busy(toggle,async()=>{await api('/api/admin',{action:'toggle',id:u.id,active:!u.active});show('app-status','Đã cập nhật trạng thái tài khoản.','success');await loadUsers();}));
   const reset=document.createElement('button');reset.type='button';reset.className='secondary';reset.textContent='Đặt lại mật khẩu';
   reset.addEventListener('click',()=>{resetId=u.id;$('reset-target').textContent=`${u.full_name} · ${u.username}`;$('reset-password').value='';show('reset-status','');$('reset-dialog').showModal();});
   td.append(toggle,reset);tr.append(td);$('users-rows').append(tr);
  }
  if(!d.users.length)empty($('users-rows'),'Chưa có tài khoản. Tạo tài khoản đầu tiên ở bên trên.',5);
 }
 async function loadHistory(){
  const sequence=++historyLoad,session=window.MasterSession;
  const p=new URLSearchParams({offset:String(offset)});
  if($('history-from').value)p.set('from',$('history-from').value);
  if($('history-to').value)p.set('to',$('history-to').value);
  if(window.MasterSession?.user.role==='admin'&&$('history-actor').value)p.set('actor',$('history-actor').value);
  const d=await api('/api/history?'+p);
  if(sequence!==historyLoad||window.MasterSession!==session)return;
  total=d.stats.total;for(const k of ['total','issued','failed'])$('stat-'+k).textContent=String(d.stats[k]);
  $('history-rows').replaceChildren();const labels={issued:'Đã trả mã',failed:'Lỗi',denied:'Từ chối',pending:'Đang xử lý',interrupted:'Gián đoạn / chưa trả mã'};
  for(const r of d.items)$('history-rows').append(row([`${r.full_name} (${r.username})`,time(r.requested_at),`${labels[r.status]||r.status}${r.error_code?' · '+r.error_code:''}`,time(r.expires_at),r.id]));
  if(!d.items.length)empty($('history-rows'),'Không có yêu cầu trong khoảng đã chọn.',5);
  $('history-prev').disabled=offset===0;$('history-next').disabled=offset+50>=total;
  $('history-page').textContent=total?`${offset+1}–${Math.min(offset+50,total)} / ${total}`:'0 yêu cầu';
 }
 async function tab(name){
  selectedTab=name;show('app-status','');
  for(const t of ['master','history','users']){$(t+'-panel').hidden=t!==name;$('tab-'+t).setAttribute('aria-pressed',String(t===name));}
  document.querySelector('main').classList.toggle('wide',name!=='master');
  try{if(name==='users')await loadUsers();if(name==='history'){offset=0;if(window.MasterSession?.user.role==='admin')await loadUsers();await loadHistory();}}
  catch(e){show('app-status',errorText(e),'error');}
 }
 for(const name of ['master','history','users'])$('tab-'+name).addEventListener('click',()=>tab(name));
 $('login-form').addEventListener('submit',e=>{e.preventDefault();busy($('login-submit'),async()=>{
  const username=$('login-username').value,password=$('login-password').value;
  try{const d=await api('/api/auth',{action:'login',username,password});enter(d);show('login-status','Đăng nhập bằng tài khoản được admin cấp.');await tab('master');}
  finally{$('login-password').value='';}
 },'login-status');});
 $('logout').addEventListener('click',()=>busy($('logout'),async()=>{await api('/api/auth',{action:'logout'});requireLogin();show('login-status','Đã đăng xuất.');}));
 $('create-form').addEventListener('submit',e=>{e.preventDefault();busy($('create-submit'),async()=>{
  try{await api('/api/admin',{action:'create',fullName:$('create-name').value,username:$('create-username').value,password:$('create-password').value});
   $('create-form').reset();show('app-status','Đã tạo tài khoản. Gửi thông tin đăng nhập riêng cho người dùng.','success');await loadUsers();}
  finally{$('create-password').value='';}
 });});
 $('reset-form').addEventListener('submit',e=>{e.preventDefault();busy($('reset-submit'),async()=>{
  try{await api('/api/admin',{action:'reset',id:resetId,password:$('reset-password').value});$('reset-dialog').close();show('app-status','Đã đặt lại mật khẩu và thu hồi các phiên cũ.','success');}
  finally{$('reset-password').value='';}
 },'reset-status');});
 $('reset-cancel').addEventListener('click',()=>{$('reset-password').value='';$('reset-dialog').close();});
 $('reset-dialog').addEventListener('close',()=>{$('reset-password').value='';resetId='';});
 $('history-form').addEventListener('submit',e=>{e.preventDefault();offset=0;busy($('history-submit'),loadHistory);});
 $('history-prev').addEventListener('click',()=>{offset=Math.max(0,offset-50);loadHistory().catch(e=>show('app-status',errorText(e),'error'));});
 $('history-next').addEventListener('click',()=>{offset+=50;loadHistory().catch(e=>show('app-status',errorText(e),'error'));});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 window.addEventListener('pageshow',refresh);
 setInterval(()=>{if(window.MasterSession&&!document.hidden)refresh();},30000);
 requireLogin();refresh();
})();
