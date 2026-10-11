# Deploy Master Password v2.5.0

## Nâng cấp từ 2.3.x hoặc 2.4.x

1. Giải nén **Master_Password_Web_v2.5.0.zip**. Trong Neon SQL Editor của DATABASE_URL hiện tại, chạy toàn bộ **database/migrate-v2.5.0.sql trước khi deploy**. File chỉ thêm bảng cấu hình thời hạn phiên và mặc định 8 giờ; không xóa tài khoản/phiên/lịch sử, chạy lại không ghi đè thiết lập.
2. Thay source trong repo rồi commit/push để Vercel deploy commit mới. Không cần thêm biến môi trường. Kiểm tra footer và /api/version cùng là **2.5.0**. Nếu bỏ qua migration, đăng nhập có thể báo DATABASE_NOT_READY vì chưa có mp_app_settings.
3. Admin đăng nhập, vào **Tài khoản → Thời hạn phiên người dùng**, chọn số giờ nguyên 1–168 và Lưu thời hạn. Thiết lập áp dụng chung từ lần đăng nhập tiếp theo của user. Phiên hiện có giữ expiry đã cấp; phiên admin vẫn 8 giờ. Đăng nhập thử bằng user mới để xác nhận thời hạn.
4. Khi lấy mã thành công, dòng màu cam của Mr. HuyVo xuất hiện phía trên countdown. Hết hiệu lực/đăng xuất thì vùng này ẩn. Đồng hồ Get vẫn chỉ hiển thị số giây nguyên theo thời gian thực.

Mỗi phiên user hết hạn sau X giờ tính từ lúc login. UI tự đưa về màn hình đăng nhập, xóa mã đang giữ; server từ chối phiên hết hạn và kiểm tra lại trước khi trả mã. Get/Copy/refresh không gia hạn. Tab bị browser tạm dừng được xử lý ngay khi hoạt động trở lại. Cookie có thời hạn tương ứng nên user cấu hình hơn 8 giờ có thể giữ phiên theo thời hạn đã cấp. Không thêm polling vào Get; giữ kiểm tra phiên 30 giây hiện có.

Giữ tối ưu Chromium/Neon của 2.4.2, 2 SQL khi cache hit và 4 khi đọc mã mới không tranh chấp. Mục tiêu Get dưới 10 giây chưa được đo production. Build không đăng nhập HRM hoặc truy cập Neon.

## Cài mới hoặc nâng cấp từ 2.2.0

1. Giải nén **Master_Password_Web_v2.5.0.zip**. Trong **Neon SQL Editor**, chọn đúng database của DATABASE_URL hiện tại và chạy toàn bộ `database/migrate-v2.3.0.sql` rồi `database/migrate-v2.5.0.sql` **trước khi deploy**. Hai migration thêm bảng cache và cấu hình phiên, không xóa tài khoản/lịch sử. Nếu chưa có database, dùng toàn bộ `database/schema.sql` thay vì migration.
2. Giữ nguyên sáu biến server đang có: HRM_USERNAME, HRM_PASSWORD, ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET, DATABASE_URL. Không cần biến bắt buộc mới; cache dùng chung mặc định bật.
3. Thay source trong checkout GitHub đang nối Vercel. ZIP có package.json ở gốc. Không đưa .env.local hoặc secret vào Git.

```bash
npm ci
npm test
npm run build
git status
git add .
git commit -m "Admin user session policy and master usage notice v2.5.0"
git push
```

Nếu remote có commit mới, pull và xử lý xung đột; không force push. Vercel phải build commit mới, không Redeploy commit 2.2.0.

4. Cấu hình Framework **Other**, Root Directory chứa package.json, Build `npm run build`, Output `dist`, Node.js **22.x**. vercel.json đã đóng gói Chromium và giới hạn API Get 60 giây. Build không truy cập DB/HRM.
5. Chờ Ready, mở deployment mới. Footer và `/api/version` phải là **2.5.0**; domain Production cần trỏ vào deployment này.

## Cài mới và biến môi trường

Tạo Neon PostgreSQL tại https://console.neon.tech/ hoặc Vercel Marketplace. Chạy `database/schema.sql` trong SQL Editor. Lấy connection string từ Connect và cấu hình các biến ở đúng Vercel project/môi trường:

| Biến | Giá trị |
| --- | --- |
| HRM_USERNAME | Tài khoản HRM công ty hiện có. |
| HRM_PASSWORD | Mật khẩu HRM hiện có. |
| ADMIN_USERNAME | 3–64 ký tự chữ/số/._-, bắt đầu bằng chữ/số; không phân biệt hoa thường. |
| ADMIN_PASSWORD | 8–256 ký tự, admin chỉ đổi qua Vercel rồi deploy lại. |
| SESSION_SECRET | Chuỗi ngẫu nhiên ít nhất 32 ký tự, dùng cho phiên và dẫn xuất khóa cache; giữ ổn định và riêng với DB. |
| DATABASE_URL | Connection string Neon PostgreSQL, chỉ server. |

Tạo SESSION_SECRET trên máy của bạn:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Không thêm tiền tố NEXT_PUBLIC/VITE_PUBLIC. Value là giá trị thật, không có tên biến hoặc dấu nháy bao ngoài. Production và Preview nên có database/secret riêng. Không cần APP_ALLOWED_IPS. Sau khi thay biến phải tạo deployment mới.

Có thể chạy `npm run db:setup` với .env.local thay SQL Editor; script tạo bảng/index thiếu, không xóa dữ liệu. Không cần thêm DB setup vào Build Command.

## Kiểm tra chức năng

- Chưa đăng nhập: form login; Get không có phiên trả 401 và không đọc HRM.
- Admin: tạo/khóa/mở/đặt lại mật khẩu user; xem lịch sử. Không có tab đổi mật khẩu của admin; gọi action change_password bằng phiên admin cũng trả 403.
- User: Get tự copy và hiện toast; Copy lại hiện toast mới, giữ countdown và không tạo lượt Get mới. Hết hạn/đăng xuất xóa mã khỏi bộ nhớ UI.
- Không có dòng kết nối HRM hoặc câu “Lấy mật khẩu và copy ngay vào clipboard.” Get đang chạy có nút “Đang lấy…”, progress % ước tính và đồng hồ “Đã chờ X giây”. Sau khi nhận mã có thời gian Get; Copy lại giữ nguyên số đo, countdown và không gọi Get mới.
- User không có tab lịch sử; GET/POST `/api/history` bằng phiên user phải trả 403.
- User vào Đổi mật khẩu, nhập mật khẩu hiện tại và mật khẩu mới ≥4 ký tự, xác nhận. Thành công tự đăng xuất mọi phiên, đăng nhập lại bằng mật khẩu mới. Mật khẩu cũ sai không thay đổi tài khoản.
- Admin xóa một dòng: xác nhận hoặc hủy. Xóa tất cả: áp dụng mọi người và cả lịch sử ngoài bộ lọc; pending chưa quá 65 giây được giữ để Get đang chạy hoàn tất. Các audit đăng nhập/tài khoản/xóa lịch sử được giữ. Số lần Get và thống kê sẽ giảm theo lịch sử bị xóa.
- Khóa/đặt lại mật khẩu thu hồi phiên cũ; mở khóa không khôi phục phiên. Thay SESSION_SECRET thu hồi mọi phiên và làm cache cũ không giải mã được.

## Kiểm tra tốc độ

1. Get khi thiếu cache đọc HRM bằng browser/phiên còn hợp lệ trên cùng instance; nếu không có thì mở Chromium và đăng nhập bình thường. Mã còn hiệu lực được cache trong RAM và **dưới dạng AES-256-GCM ciphertext trên Neon**. Mỗi Get vẫn kiểm tra quyền, giới hạn và ghi lịch sử riêng.
2. Người khác/instance khác lấy trong thời gian còn hiệu lực có thể dùng cache Neon. Nhiều instance thiếu cache đồng thời dùng lease để chia sẻ một lần đọc HRM. Cache dừng tái sử dụng khi còn ≤3 giây; không cộng thêm thời gian hiệu lực.
3. Runtime Logs: `source=database` hoặc `memory` không mở HRM, `hrm` là đọc mới, `shared` là chờ reader cùng instance. So sánh readerMs/processingMs giữa các lượt. Không gửi master/credential/cookie vào log hoặc ảnh chụp.
4. Đường cache hit dùng **hai lượt SQL** (xác thực/cache/admission/pending, rồi kiểm tra lại quyền/issued) và một request Get từ UI. Khi Neon ngủ, mạng chậm hoặc cache hết hạn, thời gian vẫn có thể tăng. Chưa có số đo production; không bảo đảm lấy tức thì.
5. Vercel Function nên gần Neon. Nếu Neon của bạn ở Singapore, có thể thêm `"regions": ["sin1"]` ở cấp gốc vercel.json rồi deploy để Function gần Neon/HRM Việt Nam. Source giữ vùng hiện tại vì chưa biết region database đang có. Không chuyển DB đang có chỉ để áp dụng cấu hình mẫu. Tài liệu: https://vercel.com/docs/functions/configuring-functions/region và https://vercel.com/docs/regions.
6. Để đối chiếu: HRM_SHARED_CACHE_ENABLED=0 tắt Neon cache (còn RAM); HRM_CACHE_ENABLED=0 tắt cả hai; HRM_LIGHTWEIGHT_BROWSER=0 tải đầy đủ tài nguyên HRM; HRM_BROWSER_REUSE=0 đóng browser sau mỗi lần đọc. Các biến tùy chọn, không cần thêm cho mặc định.

### Đánh giá mục tiêu dưới 10 giây

1. Lấy mã khi chưa có cache và ghi số giây trong UI. Đợi đúng timer HRM hết hiệu lực, Get lần tiếp theo và ghi thời gian. Lấy thêm bằng một tài khoản khác khi mã đang còn hiệu lực để đo cache hit. Không xóa tài khoản/lịch sử/DB chỉ để đo tốc độ.
2. Mỗi nhóm cần vài lần đo để thấy cả cold start và instance đã hoạt động. Mốc 10 giây là mục tiêu, chưa có dữ liệu production để bảo đảm. Thời gian UI gồm click → nhận/kiểm tra mã; không bao gồm cấp quyền clipboard. processingMs trong log là thời gian server, có thể thấp hơn UI do mạng/cold start.
3. Để lại mặc định các lớp cache và browser reuse; kiểm tra Function cùng/gần region Neon. Source không tự đổi vùng hoặc tăng cấu hình trả phí. Xem thiết lập Fluid compute/CPU trong Vercel nếu cold start còn chiếm phần lớn thời gian: https://vercel.com/docs/fluid-compute và https://vercel.com/docs/functions/configuring-functions/memory.
4. Nếu vượt 10 giây, gửi thời gian UI và một dòng log master_request_completed chỉ có source/readerMs/processingMs/version/requestId để phân tích. Không gửi master, mật khẩu HRM, DATABASE_URL hoặc SESSION_SECRET.
5. Bản này đã qua 126 kiểm thử và build trên Node 24; Vercel target Node 22.x. Chưa chạy HRM/Neon production end-to-end hoặc kiểm tra giao diện render bằng browser thật.

Browser được giữ tối đa 10 phút không sử dụng và tối đa 30 phút từ khi khởi động; mỗi Get dùng trang mới và đóng trang. Instance mới/mất kết nối/lỗi/đổi credential sẽ mở browser mới. HRM hiện form đăng nhập thì đăng nhập lại bình thường. Cookies không được xuất vào Neon/log/API. Nếu thấy RAM tăng hoặc HRM không tương thích với phiên browser giữ lại, đặt `HRM_BROWSER_REUSE=0` và deploy lại. Không có đảm bảo instance/browser luôn được giữ giữa các Get.

Cache hết hạn bị từ chối nhưng ciphertext có thể còn trong bảng/backup đến khi thay thế hoặc dọn DB. Không lưu master dạng rõ trong Neon. Người giữ cả DB và SESSION_SECRET có khả năng giải mã cache, nên giữ secret ở server.

## Lỗi cấu hình

| Lỗi | Kiểm tra |
| --- | --- |
| AUTH_NOT_CONFIGURED | ADMIN_USERNAME đúng định dạng, ADMIN_PASSWORD ≥8, SESSION_SECRET ≥32; đọc configIssues để biết biến lỗi. |
| DATABASE_NOT_CONFIGURED | DATABASE_URL ở đúng môi trường deployment. |
| DATABASE_NOT_READY | Database mới: schema.sql; nâng cấp 2.3.x/2.4.x: migrate-v2.5.0.sql; 2.2.0 chạy cả migrate-v2.3.0.sql và migrate-v2.5.0.sql, đúng DB. |
| DATABASE_UNAVAILABLE | Neon/connection string/quyền DB/mạng. |
| AUDIT_UNAVAILABLE | Chưa xác nhận ghi được audit, app không trả mã. |
| CURRENT_PASSWORD_INVALID | Mật khẩu hiện tại chưa đúng. |
| PASSWORD_POLICY | Mật khẩu user phải từ 4 đến 256 ký tự. |
| SESSION_HOURS_INVALID | Thời hạn phiên user là số giờ nguyên từ 1 đến 168. |
| HISTORY_NOT_DELETABLE | Dòng đang xử lý hoặc đã xóa; tải lại lịch sử. |
| RATE_LIMITED | Login: 8/15 phút mỗi username, 60/phút toàn app; Get: ít nhất 10 giây/lần và một lượt đang chạy; đổi mật khẩu: 5/15 phút mỗi user; xóa lịch sử: 20/phút. |
| TRY_AGAIN | Đang chờ instance khác đọc HRM hoặc lease quá lâu; thử lại sau vài giây. |
| VERSION_MISMATCH | Tải lại trang/mở đúng deployment; kiểm tra footer/API cùng 2.5.0. |

Nếu HRM lỗi, chỉ gửi error/stage/reason/requestId. Các deployment cũ vẫn có source/config cũ; cần quản lý các URL cũ riêng. Bản này chưa deploy hoặc kiểm tra Neon/HRM production thực tế.
