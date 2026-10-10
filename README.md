# Master Password — GitHub → Vercel

Web chỉ có nút **Get master password**. Người dùng không nhập tài khoản trên giao diện. Backend đọc tài khoản từ Environment Variables của Vercel, đăng nhập HRM theo luồng bình thường, bấm chức năng “Mật khẩu master” rồi trả mã và thời gian còn lại cho trình duyệt.

Luồng: Get → tự copy vào clipboard → đếm giây còn hiệu lực → hết hạn hiện lại Get. Nếu clipboard bị chặn, có nút copy lại và ô copy thủ công.

**Source đã có cấu hình Vercel và đã qua kiểm tra build/unit test. Chưa deploy live hoặc kiểm thử đăng nhập tự động trên Vercel bằng tài khoản thật. HRM có thể từ chối trình duyệt server, yêu cầu CAPTCHA hoặc thay đổi giao diện; trong các trường hợp đó app báo lỗi, không vượt qua kiểm soát truy cập.**

## Bản sửa 2.0.4

- Đã đăng nhập bằng form bảo mật và đối chiếu menu HRM ngày 10/10/2026: một mục a.gen-pass trong menu tài khoản; nút tài khoản có data-hover="dropdown" và data-bs-toggle="dropdown". Bấm mở rồi chọn master đã nhận thông báo HRM sao chép thành công và timer hợp lệ. Không lưu tài khoản hoặc master vào source.
- Sửa luồng mở menu: rê chuột bằng ElementHandle.hover, chờ tối đa 1,2 giây để menu mở; chỉ bấm nút tài khoản nếu mục master vẫn ẩn. Khi menu đã mở, không bấm toggle lần nữa. Việc click sau khi hover có thể đóng menu vừa mở; đây là nhánh được kiểm thử hồi quy, chưa xác nhận là nguyên nhân duy nhất trên Vercel.
- Chromium dùng viewport desktop 1366 × 900 thay vì kích thước mặc định. Thêm chẩn đoán master_menu_hover, giữ master_menu_open và master_menu_visible.
- Giữ popup có điều kiện, kiểm tra phiên bản frontend/server, copy và bộ đếm từ HRM. Footer, API và tên ZIP cùng v2.0.4.
- Kiểm tra browser HRM tương tác thường không thay thế kiểm tra Chromium serverless trên Vercel. Chưa deploy hoặc xác minh clipboard backend bằng tài khoản thật trên Vercel.

## Bản sửa 2.0.3

- Phiên bản X.Y.Z lấy từ package.json cho cả frontend và API. Footer hiển thị v2.0.3; sau khi bấm Get, hiển thị thêm phiên bản Server đã kiểm tra.
- GET /api/version chỉ trả phiên bản release, không đăng nhập HRM hoặc trả bí mật.
- Trước mỗi yêu cầu lấy master, frontend xác nhận server cùng phiên bản. Nếu API version thiếu, lỗi hoặc không khớp thì báo lỗi và không gọi endpoint lấy master.
- POST /api/master-password yêu cầu X-App-Version khớp release, kiểm tra trước khi đọc tài khoản hoặc mở browser. Mỗi phản hồi đều có version và header X-App-Version. Nếu deployment đổi trong lúc request chạy, frontend không copy response của phiên bản khác.
- Giữ sửa menu isVisible và popup có điều kiện của v2.0.2. Chưa thay selector theo giao diện mới vì chưa hoàn tất kiểm tra HRM sau đăng nhập.
- Tên ZIP là Master_Password_Web_v2.0.3.zip. Nội dung ZIP nằm ngay thư mục gốc: package.json, api/, lib/, public/, scripts/... Không bọc thêm một thư mục Master_Password_Web bên trong ZIP.

Đọc DEPLOY.md để đưa bản này vào repo/deployment hiện tại. Source không tự thay commit, Root Directory hoặc Production domain của Vercel. Nếu cả website và API vẫn là bản cũ, chỉ source mới được deploy đúng mới thay được website đó.

## Bản sửa 2.0.2

- Popup hết hạn mật khẩu: chỉ bấm Đóng khi nút đang hiển thị; nếu popup không tồn tại hoặc đang ẩn thì bỏ qua ngay, không chờ popup xuất hiện. Khi có bấm Đóng, chờ nút ẩn trước khi tiếp tục.
- Menu master: dùng isVisible thay cho boundingBox để kiểm tra trạng thái hiển thị. Phần tử visibility:hidden vẫn có thể có kích thước, nên bản cũ có thể bỏ qua mở menu rồi timeout. Đây là lỗi logic đã sửa; chưa xác minh đó là nguyên nhân duy nhất trên deployment thật.
- Tách master_menu_open và master_menu_visible để biết lỗi ở thao tác mở menu hay chờ mục master hiển thị.
- Hiển thị phiên bản ở footer, tự lấy từ package.json khi build Vercel hoặc chạy server local.

Đã mở HRM trong browser kiểm tra: trang hiện yêu cầu đăng nhập. Phiên đăng nhập chưa được tiếp tục nên chưa đối chiếu lại menu sau đăng nhập trong lần kiểm tra này. Các selector menu giữ theo giao diện đã quan sát trước; bản sửa tập trung vào điều kiện hiển thị và lỗi timeout trong source.

## Quy tắc phiên bản cho các lần cập nhật sau

Dùng X.Y.Z: X cho thay đổi không tương thích; Y cho thêm tính năng tương thích; Z cho sửa lỗi. Mỗi bản giao source phải tăng phiên bản; tên ZIP phải là Master_Password_Web_vX.Y.Z.zip và khớp phiên bản source/giao diện. package.json là nguồn duy nhất cho phiên bản hiển thị trong app; package-lock.json phải khớp.

Dùng một trong các lệnh trước khi build và đóng gói:

```bash
npm version patch --no-git-tag-version
npm version minor --no-git-tag-version
npm version major --no-git-tag-version
```

Chỉ chạy lệnh phù hợp cho lần cập nhật, không chạy cả ba. Build/dev kiểm tra định dạng X.Y.Z và tự đưa phiên bản vào footer. Sau deploy, nhìn footer theo phiên bản package.json để xác nhận đang mở đúng bản sửa.

## Bản sửa 2.0.1 — lỗi HRM_UNAVAILABLE

Phản hồi cũ chỉ có HRM_UNAVAILABLE không cho biết bước hỏng. Bản này:

- Bổ sung quyền clipboard-sanitized-write cho clipboard của Chromium server, ngoài quyền đọc/ghi đã có. Đây là quyền cần cho thao tác ghi văn bản; hai tên clipboard-read và clipboard-write trong phiên bản Puppeteer đã pin cùng ánh xạ sang clipboardReadWrite.
- Dùng đường dẫn bin được đóng gói ở node_modules khi tồn tại, tránh phụ thuộc vị trí module sau bundling.
- Phân biệt lỗi nạp dependency, giải nén Chromium, khởi chạy browser, cấp quyền, kết nối HRM, đăng nhập, copy và đọc mã.
- Trả error, stage, reason, requestId và ghi sự kiện master_request_failed với đúng các nhãn này. Không ghi nguyên văn exception, stack, HTML, cookie, URL hoặc bí mật.

Để cập nhật: thay nội dung source trong repo hiện tại, commit/push lên nhánh Vercel đang deploy, chờ deployment mới thành công rồi thử Get. Nếu deploy thủ công, chọn **Redeploy**, bỏ chọn **Use existing Build Cache** để lấy source/dependencies sạch. Không cần thêm biến môi trường.

Nếu vẫn lỗi, gửi JSON của request **mới** trong DevTools → Network → master-password → Response. Trong Vercel project → Logs, tìm master_request_failed theo requestId tương ứng. Chỉ cần các nhãn chẩn đoán; không gửi tài khoản, mật khẩu, master, cookie hoặc nội dung HRM.

| error / stage / reason | Hướng kiểm tra |
| --- | --- |
| BROWSER_UNAVAILABLE / browser_binary / FILE_MISSING | Chromium bin chưa được đóng gói; kiểm tra Root Directory, npm dependencies và includeFiles trong vercel.json. |
| BROWSER_START_FAILED / browser_launch / LIBRARY_MISSING | Chromium thiếu thư viện hệ thống ở runtime. Cần đối chiếu runtime thực tế trong Function Logs. |
| HRM_CONNECTION_FAILED / hrm_navigation / DNS_FAILED, CONNECTION_REFUSED, TLS_FAILED hoặc TIMEOUT | Kết nối từ server tới HRM không thành công. Máy người dùng truy cập được chưa chứng minh Vercel cũng truy cập được. |
| HRM_ACCESS_DENIED / hrm_navigation / HTTP_403, HTTP_429 hoặc HTTP_5XX | HRM trả lỗi HTTP cho server. Không tự retry hoặc bỏ qua kiểm soát truy cập. |
| LOGIN_FAILED / login_result | Không thấy phiên đăng nhập hoàn tất; kiểm tra tài khoản hoặc yêu cầu đăng nhập khác của HRM. Không khẳng định chỉ sai mật khẩu. |
| CLIPBOARD_UNAVAILABLE / clipboard_clear / PERMISSION_DENIED | Clipboard của browser server chưa được cấp quyền hoặc trang không cho phép. |
| COPY_FAILED / master_copy / TIMEOUT | Thao tác master chưa trả clipboard và timer hợp lệ. |

Bản này đã qua build và unit test, chưa xác nhận lỗi cụ thể của deployment hiện tại vì chưa có log theo bước. Chưa kiểm thử đầu cuối trên Vercel bằng tài khoản HRM thật.

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
- lib/hrm-errors.mjs: nhãn lỗi an toàn, không xuất chi tiết exception.
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
