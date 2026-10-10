# Cập nhật bản 2.0.3 lên GitHub / Vercel

1. Giải nén Master_Password_Web_v2.0.3.zip vào một thư mục riêng. package.json nằm ngay tại thư mục đó, không nằm trong thư mục con.
2. Đưa nội dung đã giải nén vào đúng checkout repo GitHub đang nối với project Vercel. Thay các file source trùng tên; giữ cấu hình tài khoản trong Environment Variables của Vercel.
3. Tại repo, kiểm tra package.json có version 2.0.3 và có api/version.js. Chạy:

```bash
npm ci
npm test
npm run build
git status
git add .
git commit -m "Update master password app to v2.0.3"
git push
```

Nếu repo vừa tạo chưa có remote, dùng luồng git init/remote/add/commit/push phù hợp. Nếu push báo remote có commit mới, pull và xử lý xung đột trước; không force push.

4. Vercel project dùng Framework Other, Root Directory là thư mục trong repo chứa package.json mới. Nếu đã đưa source ở repo root, Root Directory là repo root. Build Command npm run build, Output Directory dist. vercel.json đã có các giá trị build; giữ 2 biến HRM_USERNAME/HRM_PASSWORD hiện tại, không cần biến mới.
5. Mở deployment mới được tạo từ commit vừa push và chờ Ready. Đối chiếu branch/commit của deployment với GitHub; Production phải dùng commit mới này. Redeploy một deployment cũ chỉ xây dựng lại source của deployment đó; bỏ Build Cache không tự đổi Git commit.
6. Mở URL deployment mới: footer phải có v2.0.3. Truy cập /api/version trên chính URL đó phải trả {"version":"2.0.3"}. Endpoint này không lấy master. Khi cả hai đúng, bấm Get.

Nếu lỗi HRM còn xảy ra, gửi JSON Response mới của POST /api/master-password. Bản này có version, error, stage, reason, requestId; các nhãn master_menu_open và master_menu_visible phân biệt lỗi mở menu với lỗi chờ mục master hiện ra. Không gửi tài khoản, mật khẩu, master, cookie hoặc HTML HRM.

Build và kiểm thử giả lập đã đạt; chưa xác nhận Chromium → HRM trên Vercel bằng tài khoản thật. Chưa có login riêng của app: duy trì bảo vệ hosting hiện tại cho deployment sử dụng tài khoản HRM.
