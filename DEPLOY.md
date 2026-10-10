# Deploy Master Password v2.3.0

## Nâng cấp từ 2.2.0

1. Giải nén **Master_Password_Web_v2.3.0.zip**. Trong **Neon SQL Editor**, chọn đúng database của DATABASE_URL hiện tại và chạy toàn bộ `database/migrate-v2.3.0.sql` **trước khi deploy**. Migration chỉ thêm bảng cache, không xóa tài khoản/lịch sử. Nếu chưa có database, dùng toàn bộ `database/schema.sql` thay vì migration.
2. Giữ nguyên sáu biến server đang có: HRM_USERNAME, HRM_PASSWORD, ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET, DATABASE_URL. Không cần biến bắt buộc mới; cache dùng chung mặc định bật.
3. Thay source trong checkout GitHub đang nối Vercel. ZIP có package.json ở gốc. Không đưa .env.local hoặc secret vào Git.

```bash
npm ci
npm test
npm run build
git status
git add .
git commit -m "Improve shared master caching and account controls v2.3.0"
git push
```

Nếu remote có commit mới, pull và xử lý xung đột; không force push. Vercel phải build commit mới, không Redeploy commit 2.2.0.

4. Cấu hình Framework **Other**, Root Directory chứa package.json, Build `npm run build`, Output `dist`, Node.js **22.x**. vercel.json đã đóng gói Chromium và giới hạn API Get 60 giây. Build không truy cập DB/HRM.
5. Chờ Ready, mở deployment mới. Footer và `/api/version` phải là **2.3.0**; domain Production cần trỏ vào deployment này.

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
- Không có dòng kết nối HRM hoặc câu “Lấy mật khẩu và copy ngay vào clipboard.” Get đang chạy chỉ có trạng thái nút “Đang lấy…”.
- User không có tab lịch sử; GET/POST `/api/history` bằng phiên user phải trả 403.
- User vào Đổi mật khẩu, nhập mật khẩu hiện tại và mật khẩu mới ≥4 ký tự, xác nhận. Thành công tự đăng xuất mọi phiên, đăng nhập lại bằng mật khẩu mới. Mật khẩu cũ sai không thay đổi tài khoản.
- Admin xóa một dòng: xác nhận hoặc hủy. Xóa tất cả: áp dụng mọi người và cả lịch sử ngoài bộ lọc; pending chưa quá 65 giây được giữ để Get đang chạy hoàn tất. Các audit đăng nhập/tài khoản/xóa lịch sử được giữ. Số lần Get và thống kê sẽ giảm theo lịch sử bị xóa.
- Khóa/đặt lại mật khẩu thu hồi phiên cũ; mở khóa không khôi phục phiên. Thay SESSION_SECRET thu hồi mọi phiên và làm cache cũ không giải mã được.

## Kiểm tra tốc độ

1. Get khi thiếu cache phải mở Chromium/HRM. Mã còn hiệu lực được cache trong RAM và **dưới dạng AES-256-GCM ciphertext trên Neon**. Mỗi Get vẫn kiểm tra quyền, giới hạn và ghi lịch sử riêng.
2. Người khác/instance khác lấy trong thời gian còn hiệu lực có thể dùng cache Neon. Nhiều instance thiếu cache đồng thời dùng lease để chia sẻ một lần đọc HRM. Cache dừng tái sử dụng khi còn ≤3 giây; không cộng thêm thời gian hiệu lực.
3. Runtime Logs: `source=database` hoặc `memory` không mở HRM, `hrm` là đọc mới, `shared` là chờ reader cùng instance. So sánh readerMs/processingMs giữa các lượt. Không gửi master/credential/cookie vào log hoặc ảnh chụp.
4. Đường cache hit dùng ba lượt SQL và một request Get từ UI. Khi Neon ngủ, mạng chậm hoặc cache hết hạn, thời gian vẫn có thể tăng. Chưa có số đo production; không bảo đảm lấy tức thì.
5. Vercel Function nên gần Neon. Nếu Neon của bạn ở Singapore, có thể thêm `"regions": ["sin1"]` ở cấp gốc vercel.json rồi deploy để Function gần Neon/HRM Việt Nam. Source giữ vùng hiện tại vì chưa biết region database đang có. Không chuyển DB đang có chỉ để áp dụng cấu hình mẫu. Tài liệu: https://vercel.com/docs/functions/configuring-functions/region và https://vercel.com/docs/regions.
6. Để đối chiếu: HRM_SHARED_CACHE_ENABLED=0 tắt Neon cache (còn RAM); HRM_CACHE_ENABLED=0 tắt cả hai; HRM_LIGHTWEIGHT_BROWSER=0 tải đầy đủ tài nguyên HRM. Các biến tùy chọn, không cần thêm cho mặc định.

Cache hết hạn bị từ chối nhưng ciphertext có thể còn trong bảng/backup đến khi thay thế hoặc dọn DB. Không lưu master dạng rõ trong Neon. Người giữ cả DB và SESSION_SECRET có khả năng giải mã cache, nên giữ secret ở server.

## Lỗi cấu hình

| Lỗi | Kiểm tra |
| --- | --- |
| AUTH_NOT_CONFIGURED | ADMIN_USERNAME đúng định dạng, ADMIN_PASSWORD ≥8, SESSION_SECRET ≥32; đọc configIssues để biết biến lỗi. |
| DATABASE_NOT_CONFIGURED | DATABASE_URL ở đúng môi trường deployment. |
| DATABASE_NOT_READY | Database mới: schema.sql; nâng cấp 2.2.0: migrate-v2.3.0.sql, đúng DB. |
| DATABASE_UNAVAILABLE | Neon/connection string/quyền DB/mạng. |
| AUDIT_UNAVAILABLE | Chưa xác nhận ghi được audit, app không trả mã. |
| CURRENT_PASSWORD_INVALID | Mật khẩu hiện tại chưa đúng. |
| PASSWORD_POLICY | Mật khẩu user phải từ 4 đến 256 ký tự. |
| HISTORY_NOT_DELETABLE | Dòng đang xử lý hoặc đã xóa; tải lại lịch sử. |
| RATE_LIMITED | Login: 8/15 phút mỗi username, 60/phút toàn app; Get: ít nhất 10 giây/lần và một lượt đang chạy; đổi mật khẩu: 5/15 phút mỗi user; xóa lịch sử: 20/phút. |
| TRY_AGAIN | Đang chờ instance khác đọc HRM hoặc lease quá lâu; thử lại sau vài giây. |
| VERSION_MISMATCH | Tải lại trang/mở đúng deployment; kiểm tra footer/API cùng 2.3.0. |

Nếu HRM lỗi, chỉ gửi error/stage/reason/requestId. Các deployment cũ vẫn có source/config cũ; cần quản lý các URL cũ riêng. Bản này chưa deploy hoặc kiểm tra Neon/HRM production thực tế.
