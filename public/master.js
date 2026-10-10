const APP_VERSION = document.getElementById('app-version').textContent.trim().replace(/^v/, '');
    const serverVersion = document.getElementById('server-version');
    const button = document.getElementById('get');
    const copyButton = document.getElementById('copy');
    const active = document.getElementById('active');
    const seconds = document.getElementById('seconds');
    const progress = document.getElementById('progress');
    const status = document.getElementById('status');
    const manual = document.getElementById('manual');
    let secret = '', lifetime = 0, wallStart = 0, monotonicStart = 0, timer, masterEpoch = 0;
    const remaining = () => Math.max(0, lifetime - Math.max(Date.now() - wallStart, performance.now() - monotonicStart));
    const message = (text, type = '') => {status.textContent = text; status.className = type;};
    function expire() {
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
      button.disabled = true; button.textContent = 'Đang lấy…'; message('');
      let start = performance.now();
      try {
        // Server validates X-App-Version before HRM work; no extra preflight round-trip.
        const response = await fetch('/api/master-password', {
          method:'POST', headers:{'X-Master-Request':'1','X-App-Version':APP_VERSION,'X-CSRF-Token':session.csrfToken}, credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(65000)
        });
        let data;
        try { data = await response.json(); } catch { throw new Error('API_INVALID_RESPONSE'); }
        if (window.MasterSession !== session) return;
        if (response.status === 401) {window.MasterAccess?.requireLogin(); throw new Error('UNAUTHENTICATED');}
        if (data.version !== APP_VERSION) throw new Error('VERSION_MISMATCH');
        serverVersion.textContent = ` · Server v${data.version}`;
        if (!response.ok) throw Object.assign(new Error(data.error || 'HRM_UNAVAILABLE'),{diagnostic:data});
        const processing = Number.isFinite(data.processingMs) && data.processingMs >= 0 ? data.processingMs : 0;
        const transit = Math.max(0, performance.now() - start - processing);
        const ms = data.remainingMs - transit;
        if (typeof data.password !== 'string' || !data.password.trim() || !Number.isFinite(ms) || ms < 1000 || ms > 300000) throw new Error('INVALID_RESPONSE');
        masterEpoch++; secret = data.password; lifetime = ms; wallStart = Date.now(); monotonicStart = performance.now();
        button.hidden = true; copyButton.hidden = false;
        active.hidden = false; tick(); clearInterval(timer); timer = setInterval(tick, 250);
        await copy(true);
      } catch (error) {
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
          API_INVALID_RESPONSE:'API không trả JSON. Kiểm tra deployment và Runtime Logs.',
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
      } finally {button.disabled = false;}
    });
    document.addEventListener('visibilitychange', () => {if (secret) tick();});
    window.addEventListener('pageshow', () => {if (secret) tick();});
    window.addEventListener('pagehide', expire);
