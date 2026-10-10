# Master Password — GitHub → Vercel

Web chỉ có nút **Get master password**. Người dùng không nhập tài khoản trên giao diện. Backend đọc tài khoản từ Environment Variables của Vercel, đăng nhập HRM theo luồng bình thường, bấm chức năng “Mật khẩu master” rồi trả mã và thời gian còn lại cho trình duyệt.

Luồng: Get → tự copy vào clipboard → đếm giây còn hiệu lực → hết hạn hiện lại Get. Nếu clipboard bị chặn, có nút copy lại và ô copy thủ công.

**Source đã có cấu hình Vercel và đã qua kiểm tra build/unit test. Chưa deploy live hoặc kiểm thử đăng nhập tự động trên Vercel bằng tài khoản thật. HRM có thể từ chối trình duyệt server, yêu cầu CAPTCHA hoặc thay đổi giao diện; trong các trường hợp đó app báo lỗi, không vượt qua kiểm soát truy cập.**

## Deploy

1. Giải nén. Push **nội dung thư mục chứa package.json** lên repo GitHub của Boss; nên dùng repo Private cho công việc nội bộ.
2. Mở https://vercel.com/new → Import repo đó.
3. Framework Preset: **Other**. Root Directory: thư mục chứa package.json. Build Command: **npm run build**. Output Directory: **dist**. Các giá trị này đã có trong vercel.json.
4. Trước khi nhập tài khoản HRM, trong project Vercel mở **Deployment Protection**, bật **Vercel Authentication** với mức **All Deployments**. Source chưa có login riêng, nên chưa đưa endpoint lấy master ra công khai. Source không tự xác minh hoặc thay đổi cài đặt bảo vệ của Vercel.
5. Thêm 2 biến môi trường ở bảng dưới vào Production, và Preview nếu cần kiểm thử preview.
6. Deploy. Sau khi sửa biến môi trường, redeploy để áp dụng.

| Biến | Giá trị |
| --- | --- |
| HRM_USERNAME | Tên đăng nhập HRM có quyền sử dụng Mật khẩu master. |
| HRM_PASSWORD | Mật khẩu HRM; nhập trực tiếp trên Vercel, không vào source hoặc chat. |

App không có màn hình đăng nhập riêng và không giới hạn IP. Backend chưa xác thực người dùng app. Nếu hosting công khai, bất kỳ ai gọi được endpoint đều có thể lấy master. Kiểm tra Origin/header của request chỉ hạn chế gọi chéo nguồn từ browser; đó không phải xác thực và không ngăn được một client tự gửi request.

Sau này bổ sung login: kiểm tra phiên đăng nhập và quyền sử dụng ngay trong lib/master-api.mjs, trước khi gọi reader(env). Chỉ ẩn nút trên frontend sẽ không bảo vệ endpoint.

Vercel Deployment Protection là lớp riêng của nền tảng và có thể yêu cầu đăng nhập ở deployment được bảo vệ. Source không thay đổi hoặc tắt cài đặt bảo vệ đó.

## Push repo mới

Tạo repo rỗng trên GitHub, chưa thêm README/.gitignore ở GitHub. Mở terminal tại thư mục source:

```bash
git init
git add .
git commit -m "Add master password app for Vercel"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

Thay YOUR_USERNAME/YOUR_REPOSITORY bằng repo thật. Nếu repo đã có nội dung, clone repo và đưa source vào checkout đó, không force push.

.gitignore đã loại .env, .env.local, node_modules, dist và .vercel. Không nhập tài khoản vào file JavaScript hoặc commit file chứa bí mật.

## Cách kết nối HRM

Nguồn cố định: https://hrm.ascvn.com.vn/HeThong. Các selector đã được đối chiếu với trang trong phiên kiểm tra:

- input[name="UserName"] và input[name="Password"]: trường đăng nhập.
- Nút có chữ “Đăng nhập”: gửi form đăng nhập.
- .dropdown-user > a.dropdown-toggle: mở menu tài khoản.
- a.gen-pass: chức năng Mật khẩu master, tự copy mã.
- #timer: số giây còn hiệu lực.

Backend dùng browser riêng cho từng yêu cầu, không dùng cookie từ cuộc trò chuyện, không lưu phiên đăng nhập để tái sử dụng, không xuất mật khẩu đăng nhập cho frontend. Nếu popup hết hạn mật khẩu có nút Đóng như trang đã quan sát, backend chỉ đóng thông báo đó; không thay đổi mật khẩu.

Không cần API riêng hoặc tự đoán thuật toán sinh mã. Bộ đếm lấy thời gian từ HRM, không mặc định cộng đủ 300 giây khi bấm Get. Thời gian truyền phản hồi và đóng browser được trừ khỏi thời gian còn hiệu lực.

Không lưu master vào localStorage, database, source hoặc log. Sau khi hết hạn, mã trong app được xóa; clipboard của hệ điều hành không tự xóa để tránh ghi đè nội dung người dùng đã copy sau đó.

## Chạy local

Cần Node.js 22 và Chrome trên máy. Tạo .env.local từ .env.example, thêm tài khoản và LOCAL_CHROME_PATH là đường dẫn Chrome trên máy. Trên Vercel không cần LOCAL_CHROME_PATH vì Chromium serverless được đóng gói trong dependencies.

```bash
npm install
npm test
npm run build
npm run dev
```

Mở http://127.0.0.1:8787. Có thể chạy Start.cmd sau khi npm install. Server local chỉ nghe loopback.

## Cấu trúc

- public/index.html: giao diện, clipboard và bộ đếm.
- api/master-password.js: Vercel Function.
- lib/master-api.mjs: xử lý request, lỗi và trả mã; vị trí bổ sung kiểm tra phiên/quyền khi phát triển login.
- lib/hrm-browser.mjs: đăng nhập HRM và thao tác master bằng browser server.
- scripts/build.mjs: build giao diện vào dist.
- scripts/dev.mjs: server phát triển local.
- vercel.json: Node function timeout, file Chromium và cấu hình static.
- .env.example: tên biến, không chứa bí mật.

Chromium 153.0.0 và Puppeteer Core 25.11.0 được pin để khớp phiên bản trình duyệt. Không dùng stealth, bỏ xác minh TLS, giải CAPTCHA hoặc tự retry đăng nhập khi thất bại. Nếu HRM chặn server Vercel hoặc bắt buộc một phương thức đăng nhập khác, cần dùng kết nối/triển khai được công ty cho phép.

## Đã kiểm tra

Build static, tải dependencies, unit test giao diện/bộ đếm, luồng login giả lập, lỗi login, lỗi xác minh và response không cache. Các test dùng dữ liệu TEST-ONLY, không dùng tài khoản thật.

Chưa kiểm tra đầu cuối Chromium → HRM trên Vercel hoặc clipboard của người dùng trên browser thật. Cần deploy trên hosting được bảo vệ bằng tài khoản Vercel của Boss và cấu hình 2 biến để xác minh.

## Tài liệu đã đối chiếu

- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/project-configuration/vercel-json
- https://vercel.com/docs/headers/request-headers
- https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication
- https://vercel.com/kb/guide/deploying-puppeteer-with-nextjs-on-vercel
- https://github.com/Sparticuz/chromium
- https://pptr.dev/supported-browsers
