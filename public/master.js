const APP_VERSION = document.getElementById('app-version').textContent.trim().replace(/^v/, '');
    const serverVersion = document.getElementById('server-version');
    const button = document.getElementById('get');
    const copyButton = document.getElementById('copy');
    const active = document.getElementById('active');
    const seconds = document.getElementById('seconds');
    const progress = document.getElementById('progress');
    const status = document.getElementById('status');
    const manual = document.getElementById('manual');
    const getProgress = document.getElementById('get-progress');
    const getProgressBar = document.getElementById('get-progress-bar');
    const getProgressTrack = document.getElementById('get-progress-track');
    const getProgressLabel = document.getElementById('get-progress-label');
    const getProgressStep = document.getElementById('get-progress-step');
    let getStep = 0, getEpoch = 0;
    function fetching(step) {
      if (!Number.isInteger(step) || step < getStep || step > 4) return;
      getStep = step; getProgress.hidden = false;
      getProgressBar.style.width = `${step * 25}%`;
      getProgressTrack.setAttribute('aria-valuenow', String(step));
      getProgressTrack.setAttribute('aria-busy', String(step < 4));
      getProgressStep.textContent = `${step}/4`;
      getProgressLabel.textContent = ['Chuẩn bị yêu cầu…','Đang xử lý yêu cầu…','Đang lấy mật khẩu…','Đang hoàn tất…','Đã nhận mật khẩu'][step];
    }
    function clearFetching() {
      getProgress.hidden = true; getStep = 0; getProgressBar.style.width = '0%';
      getProgressTrack.setAttribute('aria-valuenow', '0');getProgressTrack.setAttribute('aria-busy', 'false');
      getProgressStep.textContent = '0/4';getProgressLabel.textContent = '';
    }
    async function readResult(response, onProgress) {
      if (!response.headers?.get('content-type')?.includes('application/x-ndjson')) return {status:response.status,ok:response.ok,data:await response.json()};
      if (!response.body?.getReader) throw new Error('API_INVALID_RESPONSE');
      const reader = response.body.getReader(), decoder = new TextDecoder();let pending = '', result;
      function line(value) {
        if (!value.trim()) return;
        const item = JSON.parse(value);
        if (item.version && item.version !== APP_VERSION) throw new Error('VERSION_MISMATCH');
        if (item.type === 'progress' && !result && Number.isInteger(item.step) && item.step >= 1 && item.step <= 3) onProgress(item.step);
        else if (item.type === 'result' && !result && Number.isInteger(item.status) && item.status >= 200 && item.status <= 599 && item.data && typeof item.data === 'object') result = {status:item.status,ok:item.status >= 200 && item.status < 300,data:item.data};
        else throw new Error('API_INVALID_RESPONSE');
      }
      try {
        while (true) {
          const {done,value} = await reader.read();pending += done ? decoder.decode() : decoder.decode(value,{stream:true});
          if (pending.length > 32768) throw new Error('API_INVALID_RESPONSE');
          const lines = pending.split('\n');pending = lines.pop();for (const value of lines) line(value);
          if (done) {if (pending) line(pending);break;}
        }
        if (!result) throw new Error('API_INVALID_RESPONSE');return result;
      } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
    }
    let secret = '', lifetime = 0, wallStart = 0, monotonicStart = 0, timer, masterEpoch = 0;
    const remaining = () => Math.max(0, lifetime - Math.max(Date.now() - wallStart, performance.now() - monotonicStart));
    const message = (text, type = '') => {status.textContent = text; status.className = type;};
    function expire() {
      getEpoch++;clearFetching();
      masterEpoch++; clearInterval(timer); secret = ''; manual.value = ''; manual.hidden = true; active.hidden = true;
      copyButton.hidden = true; copyButton.disabled = false;
      button.hidden = false; button.disabled = false; button.textContent = 'Get master password';
      message('');
    }
    window.clearMaster = expire;
    function tick() {
      const ms = remaining();
      if (ms < 1000) {expire(); return;}
      seconds.textContent = String(Math.floor(ms / 1000));
      progress.style.width = `${Math.min(100, ms / 3000)}%`;
    }
    async function copy(retrieved=false) {
      if (!window.MasterSession?.user) return expire();
      if (!secret || remaining() < 1000) return expire();
      const epoch = masterEpoch, session = window.MasterSession, value = secret;
      const stale = () => epoch !== masterEpoch || session !== window.MasterSession;
      try {
        await navigator.clipboard.writeText(value);
        if (stale()) return;
        if (!secret || remaining() < 1000) return expire();
        manual.hidden = true; manual.value = ''; button.hidden = true;
        message('');window.MasterNotify?.success(retrieved?'Đã lấy và copy master password.':'Đã copy lại master password.');
      } catch {
        if (stale()) return;
        if (!secret || remaining() < 1000) return expire();
        manual.value = secret; manual.hidden = false; button.hidden = true;
        message('Trình duyệt chưa cho phép copy. Bấm lại hoặc copy mã bên trên.', 'error');
        window.MasterNotify?.error('Chưa copy được. Bấm Copy lại hoặc copy mã thủ công.');
      }
    }
    copyButton.addEventListener('click', async () => {
      if (copyButton.disabled) return;
      copyButton.disabled = true;
      try {await copy();} finally {copyButton.disabled = false;}
    });
    button.addEventListener('click', async () => {
      const session = window.MasterSession;
      if (!session?.user) {message('Vui lòng đăng nhập trước khi lấy master.', 'error'); return;}
      if (secret && remaining() >= 1000) {button.disabled = true; await copy(); button.disabled = false; return;}
      if (button.disabled) return;
      const requestEpoch = ++getEpoch;getStep = 0;fetching(0);
      button.disabled = true; button.textContent = 'Đang lấy…'; message('');
      let start = performance.now();
      try {
        // Server validates X-App-Version before HRM work; no extra preflight round-trip.
        const response = await fetch('/api/master-password', {
          method:'POST', headers:{Accept:'application/x-ndjson','X-Master-Request':'1','X-App-Version':APP_VERSION,'X-CSRF-Token':session.csrfToken}, credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(65000)
        });
        let result;
        try { result = await readResult(response, step => {if (window.MasterSession === session && getEpoch === requestEpoch) fetching(step);}); } catch (error) {if (error.message === 'VERSION_MISMATCH') throw error;throw new Error('API_INVALID_RESPONSE');}
        const {data} = result;
        if (window.MasterSession !== session || getEpoch !== requestEpoch) return;
        if (result.status === 401) {window.MasterAccess?.requireLogin(); throw new Error('UNAUTHENTICATED');}
        if (data.version !== APP_VERSION) throw new Error('VERSION_MISMATCH');
        serverVersion.textContent = ` · Server v${data.version}`;
        if (!result.ok) throw Object.assign(new Error(data.error || 'HRM_UNAVAILABLE'),{diagnostic:data});
        const processing = Number.isFinite(data.processingMs) && data.processingMs >= 0 ? data.processingMs : 0;
        const transit = Math.max(0, performance.now() - start - processing);
        const ms = data.remainingMs - transit;
        if (typeof data.password !== 'string' || !data.password.trim() || !Number.isFinite(ms) || ms < 1000 || ms > 300000) throw new Error('INVALID_RESPONSE');
        fetching(4);
        masterEpoch++; secret = data.password; lifetime = ms; wallStart = Date.now(); monotonicStart = performance.now();
        button.hidden = true; copyButton.hidden = false;
        active.hidden = false; tick(); clearInterval(timer); timer = setInterval(tick, 250);
        await copy(true);
      } catch (error) {
        if (window.MasterSession !== session || getEpoch !== requestEpoch) return;
        const errors = {
          UNAUTHENTICATED:'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.',
          RATE_LIMITED:'Đang có yêu cầu lấy mã hoặc bạn thao tác quá nhanh. Đợi ít nhất 10 giây.',
          DATABASE_NOT_CONFIGURED:'Chưa cấu hình cơ sở dữ liệu.',
          DATABASE_NOT_READY:'Chưa khởi tạo các bảng dữ liệu.',
          DATABASE_UNAVAILABLE:'Chưa kết nối được cơ sở dữ liệu.',
          AUDIT_UNAVAILABLE:'Không ghi được lịch sử. Mã chưa được trả về.',
          AUTH_NOT_CONFIGURED:'Chưa cấu hình tài khoản admin và khóa phiên.',
          VERSION_MISMATCH:'Giao diện và server khác phiên bản. Tải lại trang hoặc mở deployment mới nhất.',
          VERSION_UNAVAILABLE:'Chưa xác nhận được phiên bản server. Kiểm tra deployment và thử lại.',
          NOT_CONFIGURED:'Chưa cấu hình tài khoản HRM trên server.',
          UNSUPPORTED_RUNTIME:'API cần chạy trên Vercel hoặc server local đi kèm.',
          LOGIN_FAILED:'Không đăng nhập được HRM. Kiểm tra tài khoản trên Vercel.',
          AUTH_BLOCKED:'HRM đang yêu cầu xác minh hoặc chặn truy cập tự động.',
          LOGIN_REQUIRED:'HRM yêu cầu phương thức đăng nhập khác.',
          HRM_UI_CHANGED:'Chưa thao tác được giao diện HRM. Kiểm tra bước lỗi bên dưới.',
          COPY_FAILED:'HRM chưa cung cấp được mã để copy.',
          HRM_TIMEOUT:'HRM phản hồi quá lâu. Vui lòng thử lại sau.',
          BROWSER_START_FAILED:'Chromium không khởi chạy được trên server.',
          BROWSER_SETUP_FAILED:'Không thiết lập được trình duyệt hoặc quyền clipboard.',
          HRM_CONNECTION_FAILED:'Server không kết nối được đến HRM.',
          HRM_ACCESS_DENIED:'HRM từ chối truy cập từ server.',
          CLIPBOARD_UNAVAILABLE:'Clipboard của trình duyệt server chưa hoạt động.',
          API_INVALID_RESPONSE:'Server chưa trả kết quả hoàn chỉnh. Kiểm tra deployment và thử lại.',
          HRM_UNAVAILABLE:'Backend gặp lỗi khi lấy mã HRM.',
          BROWSER_UNAVAILABLE:'Server chưa khởi chạy được trình duyệt HRM.',
          INVALID_CONFIGURATION:'Cấu hình API HRM chưa hợp lệ.',
          FORBIDDEN:'Kết nối không được cấp quyền.',
          TRY_AGAIN:'Vui lòng đợi vài giây rồi thử lại.',
          INVALID_RESPONSE:'HRM chưa trả về mã và thời gian hiệu lực hợp lệ.'
        };
        const d=error.diagnostic;
        // Display only diagnostic labels, never arbitrary server text.
        const details=d && /^[a-z_]{1,40}$/.test(d.stage) && /^[A-Z0-9_]{1,40}$/.test(d.reason) &&
          /^[a-f0-9-]{36}$/.test(d.requestId) ? ` [${error.message}: ${d.stage}/${d.reason}; ID ${d.requestId}]` : '';
        const description=error.message==='AUTH_NOT_CONFIGURED'&&window.MasterAccess?.errorText
          ?window.MasterAccess.errorText(error):errors[error.message] || 'Không lấy được mật khẩu. Vui lòng thử lại.';
        message(description+details, 'error');
        button.textContent = 'Get master password';
      } finally {if (getEpoch === requestEpoch) {clearFetching();button.disabled = false;}}
    });
    document.addEventListener('visibilitychange', () => {if (secret) tick();});
    window.addEventListener('pageshow', () => {if (secret) tick();});
    window.addEventListener('pagehide', expire);
