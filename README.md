# Master Password — v2.1.1

App Vercel có đăng nhập bằng username/password riêng. Chỉ người được admin cấp tài khoản mới lấy được master từ HRM. Nút Get giữ hành vi copy + bộ đếm thời gian thực của v2.0.4.

**Bắt đầu: đọc DEPLOY.md.** Bản này cần bốn biến mới ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET, DATABASE_URL và chạy database/schema.sql một lần trên Neon PostgreSQL; giữ hai biến HRM cũ.

## Chức năng

- Admin từ Vercel: tạo tài khoản có họ tên, username, mật khẩu; khóa/mở khóa; đặt lại mật khẩu; xem số lần Get từng người và lịch sử toàn bộ.
- User: đăng nhập, Get master, xem lịch sử của chính mình, đăng xuất. Không đăng ký công khai, không có API sửa quyền admin.
- Lịch sử: người yêu cầu, thời gian server, kết quả, thời gian hết hiệu lực, mã giao dịch; lọc người/ngày, phân trang 50 dòng. Hiển thị giờ Việt Nam.
- Thống kê phân biệt yêu cầu và lần server đã trả mã. Tài khoản chưa có quyền truy cập bị từ chối trước khi chạy HRM. Giới hạn Get bị từ chối được ghi nhận thành yêu cầu denied của người dùng đã xác thực.
- Không lưu master hoặc mật khẩu HRM trong DB/log; mật khẩu người dùng lưu scrypt với salt riêng (N=131072, r=8, p=1).

## Luồng và kiểm soát

1. POST /api/auth đăng nhập → kiểm tra tài khoản/rate limit → tạo token ngẫu nhiên mới, lưu SHA-256 token trong DB → cookie HttpOnly/Secure/SameSite=Strict trên HTTPS.
2. GET /api/auth xác nhận phiên, cấp CSRF token; phiên tối đa 8 giờ.
3. POST /api/master-password kiểm tra Origin/header/version, cookie, CSRF, tài khoản còn hoạt động và auth_version. Kiểm tra lặp lại sau công việc HRM.
4. DB ghi pending và cấp khóa Get nguyên tử: một yêu cầu / người tại một thời điểm, cách ít nhất 10 giây. Mỗi yêu cầu mới có mã giao dịch riêng, không tự retry lấy mã.
5. HRM login và menu hover → click khi cần → copy/read clipboard server + timer, giữ popup có điều kiện.
6. DB ghi issued trước khi trả master. Nếu không xác nhận ghi được lịch sử thì không trả mã. Thời gian ghi DB/đóng browser/truyền phản hồi được trừ khỏi hiệu lực.
7. Client copy rồi đếm giây; copy lại không tăng số Get. Hết hạn hoặc đăng xuất xóa mã trong bộ nhớ/ô copy. Clipboard hệ điều hành không tự xóa.

Khóa/mở khóa/đặt lại mật khẩu tăng auth_version, nên phiên cũ không dùng lại được. Thay mật khẩu/username admin hoặc SESSION_SECRET rồi redeploy thu hồi các phiên tương ứng. Giao diện kiểm tra phiên mỗi 30 giây khi đang mở; API kiểm tra mỗi yêu cầu. Không thể thu hồi một mã đã được người dùng copy ra ngoài app.

Lịch sử `issued` nghĩa là backend đã ghi nhận thành công và chuẩn bị trả response; không chứng minh browser nhận/copy được mã. Nếu function bị ngắt sau pending, dòng lịch sử quá 65 giây hiển thị Gián đoạn. Thống kê pending gồm cả các yêu cầu gián đoạn chưa hoàn tất. App không ghi IP hoặc fingerprint người dùng trong bản này.

HRM dùng chung tài khoản server hiện có: nhật ký app phân biệt người lấy mã, không thay đổi danh tính ghi nhận trong HRM và không chứng minh ai đã sử dụng mã ở hệ thống khác. Mỗi người phải có tài khoản app riêng để thống kê có ý nghĩa.

## Dữ liệu và quản trị

Schema: mp_users, mp_sessions, mp_limits, mp_get_gate, mp_audit. Dùng Neon HTTP driver với SQL tham số hóa. Thao tác tài khoản và ghi audit quản trị thực hiện trong transaction; app không có endpoint sửa/xóa lịch sử hoặc xóa người dùng. Admin xem audit Get qua UI; LOGIN/LOGOUT và thay đổi tài khoản cũng ghi DB để đối chiếu. Người sở hữu DB vẫn có thể sửa dữ liệu; nhật ký này không phải chứng cứ chống sửa tuyệt đối.

Giữ DB/bản sao lưu dưới quyền người quản trị được chỉ định. Bản này không tự xóa lịch sử; cần quyết định thời hạn lưu trước khi vận hành lâu dài. Dùng database riêng cho Production và Preview.

## Local và kiểm thử

Node.js 22.x. Tạo .env.local từ .env.example; cấu hình Neon/admin/HRM. Nếu thử HRM local, thêm LOCAL_CHROME_PATH.

```bash
npm ci
npm run db:setup
npm test
npm run build
npm run dev
```

Mở http://127.0.0.1:8787. Dev chỉ nghe loopback; cookie local tên mp_session_dev, production HTTPS dùng __Host-mp_session. Không cần DB/HRM thật khi npm test hoặc build: test dùng TEST-ONLY và PostgreSQL PGlite; không tạo tài khoản hay tác động HRM production.

## Cấu trúc

- api/auth.js, api/admin.js, api/history.js: endpoints đăng nhập/quản trị/lịch sử.
- api/master-password.js: endpoint Get có xác thực và audit.
- lib/security.mjs: băm mật khẩu, phiên, CSRF.
- lib/store.mjs: truy vấn Neon; lib/auth-api.mjs: quy tắc tài khoản/quản trị.
- lib/hrm-browser.mjs: kết nối HRM v2.0.4 được giữ nguyên.
- public/index.html, master.js, app-auth.js: form login, Get, admin và lịch sử; dữ liệu user luôn render bằng textContent. CSP chỉ cho JavaScript từ cùng nguồn.
- database/schema.sql, scripts/db-setup.mjs: khởi tạo DB.
- *-test.mjs, test-support/: kiểm thử an toàn, UI và SQL.

## Phiên bản và đóng gói

Dùng X.Y.Z: tăng patch cho sửa lỗi, minor cho thêm tính năng tương thích, major cho thay đổi không tương thích. Mỗi lần giao source phải tăng phiên bản; package.json là nguồn hiển thị và package-lock.json phải khớp. ZIP luôn tên **Master_Password_Web_vX.Y.Z.zip**, package.json ở gốc ZIP; không chứa node_modules, dist, .env.local hoặc bí mật. API version và footer phải cùng release.

## Giới hạn xác minh

Build, kiểm thử bộ đếm/clipboard giả lập, API và SQL PostgreSQL đã kiểm tra. Chưa xác minh Neon production, deployment Vercel, clipboard browser thật hoặc HRM end-to-end trong bản có auth. Không dùng stealth, bỏ TLS, giải CAPTCHA hay tự retry đăng nhập thất bại.

## Tài liệu

- https://github.com/neondatabase/serverless/blob/main/CONFIG.md
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- https://vercel.com/docs/functions/runtimes/node-js

## 2.1.1

Chẩn đoán cấu hình đăng nhập theo từng biến ngay trên giao diện và response API. Không thay chính sách mật khẩu, cơ chế phiên, schema Neon hoặc luồng HRM. Chi tiết cập nhật và kiểm tra môi trường deployment trong DEPLOY.md.
