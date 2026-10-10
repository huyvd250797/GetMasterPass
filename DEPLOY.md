# Deploy Master Password v2.2.0

Bản này giữ luồng HRM v2.0.4 đang hoạt động và thêm đăng nhập bắt buộc. Tài khoản admin lấy từ Vercel; tài khoản người dùng, phiên và lịch sử lưu trong Neon PostgreSQL.

## 1. Tạo cơ sở dữ liệu

1. Tạo project PostgreSQL tại https://console.neon.tech/ hoặc kết nối Neon qua Vercel Marketplace → Storage. Chọn vùng gần vùng chạy Vercel Function.
2. Trong Neon SQL Editor, mở database dành riêng cho app này. Copy **toàn bộ** nội dung `database/schema.sql` vào editor và Run một lần.
3. Lấy PostgreSQL connection string trong màn hình Connect. Lưu trực tiếp vào biến **DATABASE_URL** của Vercel, không đưa vào GitHub hoặc chat. Driver của app dùng Neon HTTP, nên bản này yêu cầu Neon; không dùng URL SQL Server hoặc PostgreSQL của nhà cung cấp khác.

Cách thay thế bước 2: trên máy local có `.env.local` chứa DATABASE_URL, chạy `npm ci` rồi `npm run db:setup`. Script chỉ tạo bảng/index còn thiếu, không tạo tài khoản hoặc xóa dữ liệu. Không cần chạy DB setup trong Build Command; build không cần tài khoản/database.

## 2. Cấu hình Vercel

Giữ HRM_USERNAME, HRM_PASSWORD hiện tại và thêm bốn biến mới:

| Biến | Nội dung |
| --- | --- |
| ADMIN_USERNAME | Username admin, 3–64 ký tự; chữ/số/._-, không phân biệt hoa thường. Không trùng username người dùng đã có. |
| ADMIN_PASSWORD | Mật khẩu admin riêng, từ 8 đến 256 ký tự. |
| SESSION_SECRET | Chuỗi ngẫu nhiên tối thiểu 32 ký tự; dùng lệnh dưới để tạo. |
| DATABASE_URL | Connection string Neon của database vừa khởi tạo. |

Tạo SESSION_SECRET bằng terminal **trên máy Boss**, rồi copy kết quả vào Vercel:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Các biến chỉ cấu hình server; không thêm tiền tố NEXT_PUBLIC/VITE_PUBLIC. Cấu hình Production; nếu dùng Preview thì dùng database và các giá trị riêng để preview không tác động tài khoản/lịch sử production. Không cần thêm APP_ALLOWED_IPS.

## 3. Push và deploy

1. Giải nén **Master_Password_Web_v2.2.0.zip**; package.json nằm ngay thư mục gốc của ZIP.
2. Thay source trong checkout repo đang nối Vercel. Giữ bí mật ở Environment Variables.
3. Chạy:

```bash
npm ci
npm test
npm run build
git status
git add .
git commit -m "Add copy button, password policies and faster master retrieval v2.2.0"
git push
```

Nếu remote có commit mới, pull và xử lý xung đột trước; không force push. Vercel phải deploy commit mới, không chỉ Redeploy commit cũ.

Cấu hình: Framework Other, Root Directory chứa package.json, Build Command `npm run build`, Output Directory `dist`, Node.js 22.x. `vercel.json` đã cấu hình function và đóng gói Chromium. Build không đăng nhập HRM hoặc kết nối DB.

4. Chờ deployment Ready, mở URL mới và kiểm tra footer **v2.2.0**. `/api/version` phải trả cùng phiên bản.
5. Đăng nhập bằng ADMIN_USERNAME/ADMIN_PASSWORD đã cấu hình. Tab **Tài khoản** → nhập họ tên, username và mật khẩu → Tạo tài khoản.
6. Đăng xuất admin; đăng nhập bằng tài khoản vừa cấp; thử Get master. Đăng nhập lại admin → tab **Lịch sử**, kiểm tra người dùng/thời gian/số lần.

Sau khi chuyển Production, kiểm tra các URL deployment v2.0.x cũ. Nếu chúng còn truy cập được mà chưa có đăng nhập, bảo vệ hoặc ngừng phục vụ các deployment đó; source mới không bảo vệ URL của bản cũ.

Source không tự thay đổi Deployment Protection hoặc cấu hình tài khoản Vercel. Các lớp bảo vệ hosting đang có vẫn giữ nguyên; app v2.2.0 có kiểm tra phiên riêng ở backend cho endpoint lấy master.

## 4. Kiểm tra sau deploy

- Mở tab riêng tư chưa đăng nhập: có form login; POST `/api/master-password` không có phiên phải bị từ chối, không mở HRM.
- Người dùng thường không truy cập được API quản trị; lịch sử của họ chỉ chứa yêu cầu của chính họ.
- Khóa tài khoản hoặc đặt lại mật khẩu từ admin: phiên cũ bị thu hồi. Mở khóa không khôi phục phiên cũ; phải đăng nhập lại.
- Thay ADMIN_PASSWORD và redeploy: các phiên admin cũ mất hiệu lực. Thay SESSION_SECRET: toàn bộ phiên cũ mất hiệu lực.
- Lịch sử không chứa master, mật khẩu hoặc cookie. Copy lại mã đang có không gọi Get mới.

## 5. Lỗi cấu hình

| Lỗi | Kiểm tra |
| --- | --- |
| AUTH_NOT_CONFIGURED | ADMIN_USERNAME đúng định dạng; ADMIN_PASSWORD ≥8 ký tự; SESSION_SECRET ≥32 ký tự. |
| DATABASE_NOT_CONFIGURED | DATABASE_URL có trong đúng môi trường deployment. |
| DATABASE_NOT_READY | Chạy database/schema.sql trên đúng database của DATABASE_URL. |
| DATABASE_UNAVAILABLE | Connection string/Neon/vùng mạng và quyền database. |
| AUDIT_UNAVAILABLE | App không trả master vì chưa xác nhận ghi được lịch sử. Kiểm tra database. |
| INVALID_CREDENTIALS | Username/mật khẩu sai hoặc tài khoản đã bị khóa; app không phân biệt các trường hợp này trên màn hình. |
| RATE_LIMITED khi login | 8 yêu cầu / 15 phút cho mỗi username, và 60 yêu cầu / phút toàn app. Chờ cửa sổ giới hạn hết hạn. |
| RATE_LIMITED khi Get | Một yêu cầu đang chạy hoặc chưa đủ 10 giây kể từ lần bắt đầu trước. Yêu cầu bị gián đoạn giữ khóa tối đa 65 giây. |
| VERSION_MISMATCH | Frontend và API khác release; tải lại trang hoặc mở đúng deployment. |

Nếu HRM lỗi, gửi nhãn error/stage/reason/requestId mới, không gửi mật khẩu, cookie, HTML HRM hoặc DATABASE_URL.

Đã kiểm tra bằng dữ liệu TEST-ONLY và PostgreSQL chạy trong bộ kiểm thử. Chưa deploy bản này, chưa xác minh kết nối Neon thật hoặc Chromium → HRM trên Vercel với lớp đăng nhập mới.

## Cập nhật từ 2.1.x lên 2.2.0

Không cần đổi schema hoặc tạo lại tài khoản. Bản 2.2.0 đổi ADMIN_PASSWORD thành tối thiểu 8 ký tự và mật khẩu người dùng thành tối thiểu 4 ký tự; giữ chẩn đoán theo biến từ 2.1.1. Ví dụ `ADMIN_PASSWORD: cần ít nhất 8 ký tự` dù biến đã tồn tại.

1. Thay source bằng ZIP 2.2.0, commit/push để Vercel build commit mới. Redeploy commit 2.1.x không cập nhật source.
2. Kiểm tra footer và `/api/version` cùng hiển thị `2.2.0`.
3. Nếu còn lỗi cấu hình, đọc tên biến trên màn hình hoặc `configIssues` trong response `/api/auth`. Các nhãn chỉ mô tả quy tắc không đạt; không trả giá trị, độ dài thực tế, URL database hoặc mật khẩu.
4. Trong đúng Vercel project, kiểm tra đúng tên biến (phân biệt hoa thường), môi trường Production/Preview của URL đang mở, và có giá trị thật. Không đưa cả dòng `ADMIN_PASSWORD=...` vào ô Value; không thêm dấu nháy bao ngoài như khi viết file .env.
5. Sau khi sửa biến, tạo deployment mới của source 2.2.0. Domain chính phải trỏ vào deployment đó; URL deployment cũ vẫn giữ cấu hình cũ.

Lỗi này chỉ liên quan ADMIN_USERNAME, ADMIN_PASSWORD và SESSION_SECRET. DATABASE_URL và bảng Neon có lỗi riêng. Không tự trim hoặc sửa ADMIN_PASSWORD/SESSION_SECRET vì sẽ thay đổi thông tin đăng nhập và khóa phiên. Nếu cả ba biến hợp lệ trong runtime thì `/api/auth` không trả AUTH_NOT_CONFIGURED; GET chưa đăng nhập trả UNAUTHENTICATED.

## Copy và kiểm tra tốc độ

1. Get lần đầu: mã tự copy; nút Copy lại xuất hiện. Bấm vài lần: nội dung copy giống mã hiện tại, countdown không reset, không có request master mới và số lần Get không tăng.
2. Hết hạn/đăng xuất: nút Copy lại ẩn và mã client bị xóa. Get mới có requestId/lịch sử riêng.
3. Lần Get tiếp trong thời gian mã còn hiệu lực (sau giới hạn 10 giây) trên cùng instance có thể dùng RAM cache, không mở Chromium/login lại. Nếu hai người Get cùng lúc, cùng instance có thể dùng chung lần đọc HRM; mỗi người vẫn ghi nhận riêng.
4. Trong Runtime Logs xem source và readerMs/processingMs để so sánh. memory: dùng mã trong RAM; shared: chờ một lần HRM đang chạy; hrm: đọc HRM mới. Lần đầu/instance mới vẫn chịu thời gian khởi động Chromium, mạng HRM và Neon.
5. Nếu cần so sánh với đường đọc cũ, đặt HRM_CACHE_ENABLED=0 và HRM_LIGHTWEIGHT_BROWSER=0 ở Vercel rồi deploy lại. Hai biến này tùy chọn, không cần thêm để chạy mặc định.

Các tài khoản/mật khẩu hiện có tiếp tục hoạt động, không cần chạy lại schema. Không tự hạ hoặc thay mật khẩu đang có. Lưu ý admin có ngưỡng riêng 8 ký tự; tạo/đặt lại mật khẩu người dùng trong tab Tài khoản có ngưỡng 4 ký tự.
