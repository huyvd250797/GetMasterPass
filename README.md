# Master Password — v2.3.0

App chạy trên Vercel, đăng nhập bằng tài khoản do admin cấp, lấy master từ HRM, tự copy và đếm thời gian còn hiệu lực. **Đọc DEPLOY.md trước khi nâng cấp.** Từ 2.2.0 cần chạy `database/migrate-v2.3.0.sql` trên Neon một lần; không tạo lại tài khoản.

## Thay đổi 2.3.0

- Get dùng RAM cache và cache mã hóa dùng chung trên Neon. Instance mới có thể lấy mã đang còn hiệu lực mà không mở Chromium/đăng nhập HRM. Các instance dùng lease trong DB để gộp lần đọc HRM khi đồng thời thiếu cache.
- Bỏ lượt gọi `/api/version` trước mỗi Get. Server vẫn kiểm tra phiên bản trước HRM; response và footer giữ cùng phiên bản. Đường Get khi có cache hợp lệ cần ba lượt SQL: xác thực kèm cache, nhận quyền Get/ghi pending, kiểm tra lại phiên kèm ghi issued.
- Get/copy thành công hiện toast tự ẩn sau 3,5 giây. Bỏ dòng kết nối HRM và câu “Lấy mật khẩu và copy ngay vào clipboard.” Lỗi vẫn hiển thị để người dùng xử lý. Clipboard thất bại không báo copy thành công và có ô copy thủ công.
- User đổi mật khẩu của mình bằng mật khẩu hiện tại và mật khẩu mới 4–256 ký tự. Đổi thành công thu hồi mọi phiên của tài khoản và yêu cầu đăng nhập lại. Admin không được đổi mật khẩu qua UI hoặc endpoint này; sửa ADMIN_PASSWORD trên Vercel rồi deploy lại.
- Lịch sử chỉ dành cho admin; API chặn user bằng 403. Admin xóa một dòng hoặc toàn bộ lịch sử Get qua hộp xác nhận. Xóa tất cả áp dụng cả dữ liệu ngoài bộ lọc; giữ pending chưa quá 65 giây. Không xóa LOGIN/LOGOUT, sự kiện tài khoản hoặc sự kiện xóa lịch sử.
- Số lần Get và thống kê tính từ lịch sử còn giữ lại; xóa lịch sử làm giảm các số đếm này. Copy lại không gọi API Get và không tăng số lần Get.

## Luồng Get

1. Kiểm tra Origin/header/phiên bản, cookie, CSRF và cấu hình. Đọc phiên còn hiệu lực, trạng thái user và auth_version cùng cache mã hóa trong một câu SQL.
2. DB cấp quyền Get nguyên tử: một yêu cầu mỗi người tại một thời điểm, bắt đầu cách nhau ít nhất 10 giây; ghi pending riêng cho mỗi yêu cầu.
3. Dùng mã còn hiệu lực trong RAM hoặc giải mã cache Neon. Nếu không có, nhận lease 55 giây, kiểm tra lại cache rồi thực hiện luồng HRM hiện có: đăng nhập, đóng thông báo đổi mật khẩu nếu xuất hiện, hover menu rồi click khi cần, đọc clipboard/timer rồi đóng browser.
4. Ghi cache mã hóa. Kiểm tra lại phiên/user và ghi issued trong cùng một câu SQL trước khi trả mã. Nếu phiên bị thu hồi trong lúc đọc HRM hoặc chưa ghi được audit thì không trả mã.
5. Trừ thời gian đọc/đóng browser/SQL và truyền phản hồi khỏi hiệu lực. Client copy, hiện toast, đếm giây; hết hạn hoặc đăng xuất xóa mã khỏi bộ nhớ/ô thủ công. Clipboard hệ điều hành không tự xóa.

`issued` là backend đã ghi nhận và chuẩn bị trả mã, không chứng minh trình duyệt đã nhận/copy. Mã đã copy ra ngoài app không thể bị thu hồi bằng cách khóa tài khoản. Nhật ký app xác định người yêu cầu, không chứng minh người sử dụng mã tại hệ thống khác.

## Cache và dữ liệu

Bản 2.3.0 **có lưu ciphertext của master trong bảng mp_master_cache**. AES-256-GCM, IV ngẫu nhiên 12 byte, tag 16 byte; khóa HKDF từ SESSION_SECRET. AAD ràng buộc scope và thời điểm hết hạn; scope HMAC ràng buộc tài khoản HRM. Không lưu master dạng rõ hoặc mật khẩu HRM trong DB/log/file/CDN/localStorage. Không trả ciphertext qua API xác nhận phiên/lịch sử.

Kiểm tra cả thời gian DB, đồng hồ thực và monotonic trước khi tái sử dụng; bỏ cache khi còn ≤3 giây, không reset về 300 giây. Thay credential HRM hoặc SESSION_SECRET không dùng lại cache cũ. Dữ liệu hết hạn bị từ chối về mặt logic và được thay thế khi có mã mới; không cam kết xóa ciphertext/backup ngay tại thời điểm hết hạn. SESSION_SECRET cần giữ riêng với DB và ổn định giữa các instance cùng deployment.

Schema: mp_users, mp_sessions, mp_limits, mp_get_gate, mp_audit, mp_master_cache. Neon HTTP driver, SQL tham số hóa. Mật khẩu user: scrypt với salt riêng, N=131072/r=8/p=1. Token phiên ngẫu nhiên, DB chỉ giữ SHA-256; cookie HTTPS HttpOnly/Secure/SameSite=Strict, tối đa 8 giờ. Origin/CSRF bảo vệ các POST. Khóa/đặt lại mật khẩu tăng auth_version. Thay admin credential hoặc SESSION_SECRET rồi redeploy thu hồi các phiên tương ứng.

Lịch sử Get hiển thị giờ Việt Nam, lọc người/ngày, phân trang 50 dòng. Pending quá 65 giây hiển thị Gián đoạn. Thao tác xóa và audit xóa nằm trong cùng câu SQL. Người sở hữu DB vẫn có thể sửa dữ liệu; đây không phải nhật ký chống sửa tuyệt đối. App không ghi IP/fingerprint.

## Tốc độ và cấu hình tùy chọn

- Mặc định bật cả hai lớp cache. `HRM_SHARED_CACHE_ENABLED=0`: tắt cache Neon, còn RAM cache. `HRM_CACHE_ENABLED=0`: tắt cả hai và đọc HRM mới mỗi Get. Migration vẫn nên chạy trước deploy để schema đồng nhất.
- `HRM_LIGHTWEIGHT_BROWSER=0`: tải lại ảnh/font/media HRM; mặc định bỏ tài nguyên nội bộ không cần thiết, giữ CSS/JS/API và tài nguyên xác minh bên ngoài.
- Runtime Logs chỉ có nhãn source (`hrm`, `memory`, `shared`, `database`), readerMs/processingMs, version và requestId. `shared` là chờ cùng reader trên một instance; `database` là giải mã cache Neon.
- Cache hợp lệ không cần Chromium. Khi toàn bộ cache hết hạn, lần đầu vẫn chịu thời gian HRM, Chromium và mạng/DB. Không tự lấy trước theo lịch, không giữ browser mở. Chưa đo trên Vercel/HRM thật nên không cam kết số giây.
- Chọn vùng Function gần Neon; xem DEPLOY.md. Không tự chuyển database đang có sang vùng khác.

## Local và kiểm thử

Node.js 22.x. Tạo .env.local từ .env.example, cấu hình Neon/admin/HRM; thêm LOCAL_CHROME_PATH khi thử HRM local.

```bash
npm ci
npm run db:setup
npm test
npm run build
npm run dev
```

Mở http://127.0.0.1:8787. Dev chỉ nghe loopback, dùng cookie mp_session_dev; HTTPS dùng __Host-mp_session. Dev reader dùng Chrome local và RAM cache; Get trên Vercel dùng cả cache Neon. Bộ test không cần DB/HRM thật: dùng TEST-ONLY, PGlite PostgreSQL, clipboard/UI giả lập. Đã kiểm tra 79 test và build trên Node 24 của môi trường phát triển; Vercel cấu hình Node 22.x. Chưa deploy hoặc kiểm tra HRM/Neon production end-to-end bản này.

## Phiên bản và đóng gói

Dùng X.Y.Z: patch sửa lỗi, minor thêm tính năng, major thay đổi không tương thích. Mỗi lần giao source tăng phiên bản; package.json là nguồn hiển thị, lockfile phải khớp. ZIP tên **Master_Password_Web_vX.Y.Z.zip**, package.json ở gốc; không chứa node_modules/dist/.env.local hoặc bí mật.

Các file chính: api/ cho endpoint; lib/security.mjs, auth-api.mjs và store.mjs cho tài khoản/DB; lib/hrm-browser.mjs cho luồng HRM; lib/master-cache.mjs và shared-master.mjs cho cache; public/ cho UI/toast; database/ cho schema/migration; *-test.mjs cho kiểm thử.
