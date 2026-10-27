# Master Password — v2.5.3

App chạy trên Vercel, đăng nhập bằng tài khoản do admin cấp, lấy master từ HRM, tự copy và đếm thời gian còn hiệu lực. **Đọc DEPLOY.md trước khi nâng cấp.** Từ 2.3.x/2.4.x cần chạy `database/migrate-v2.5.0.sql` trên Neon trước khi deploy. Từ 2.2.0 cần chạy cả migrate-v2.3.0.sql rồi migrate-v2.5.0.sql; không tạo lại tài khoản.

## Thay đổi 2.5.3

- Thêm tùy chọn Nhớ tài khoản và mật khẩu, mặc định tắt. Chỉ ghi khi API đăng nhập thành công và phiên hợp lệ; lần đăng nhập lỗi không ghi đè thông tin đã lưu.
- Tự điền lần mở sau hoặc khi đăng xuất/hết phiên, mật khẩu luôn được che. Không tự đăng nhập, không kéo dài phiên và không bỏ kiểm tra quyền.
- Bỏ chọn xóa ngay thông tin đã lưu. Đổi mật khẩu thành công xóa thông tin cũ; sau khi admin reset, đăng nhập thành công bằng mật khẩu mới sẽ cập nhật bản lưu.
- Lưu một tài khoản gần nhất trong localStorage của trình duyệt, không đồng bộ giữa thiết bị. Đây là dữ liệu có thể đọc được bởi mã cùng origin hoặc người truy cập hồ sơ trình duyệt; chỉ bật trên thiết bị cá nhân. Xóa dữ liệu trang cũng xóa thông tin nhớ. Không lưu master password, không đưa thông tin vào log hoặc gửi thêm API.
- Trình duyệt chặn lưu trữ vẫn đăng nhập bình thường. Không đổi DB hoặc biến môi trường từ 2.5.0–2.5.2.
- Source ZIP: Master_Password_Web_v2.5.3.zip. Cài/chạy/build/deploy theo hướng dẫn bên dưới.

## Thay đổi 2.5.2 (lịch sử)

- Form login có nút Hiện/Ẩn mật khẩu, type=button để không gửi form; giữ giá trị khi chuyển trạng thái. Trả về trạng thái ẩn và xóa giá trị khi kết thúc lần đăng nhập, đăng xuất hoặc hết phiên. Hỗ trợ nhãn và trạng thái cho trình đọc màn hình.
- Nút Copy lại có nhãn ngắn và icon SVG trang trí. Chỉ copy mã đang còn hiệu lực, không Get mới, không thay đổi countdown hoặc số lần Get.
- Get thất bại chuyển nút chính thành Thử lại; người dùng chủ động bấm để gửi một lượt Get mới qua luồng kiểm tra quyền/rate limit/audit hiện có. Khi đang chạy nút bị khóa, không tự retry hoặc polling thêm. Lỗi đọc mã không được báo thành công.
- Mã lỗi, stage/reason và requestId nằm trong Chi tiết lỗi (details/summary), mặc định đóng. Thông báo chính giữ câu dễ hiểu. Chỉ đưa mã lỗi đã biết và các nhãn diagnostic có định dạng hợp lệ vào textContent; không hiển thị message/HTML tùy ý từ server. Lần thử mới, thành công hoặc đăng xuất xóa lỗi cũ. Hướng dẫn lỗi cấu hình vẫn có trong chi tiết; kiểm tra login giữ thông báo cấu hình hiện có.
- Tab Tài khoản của admin có Tìm nhanh tài khoản theo họ tên/username, không phân biệt hoa/thường và dấu tiếng Việt; lọc ngay trên danh sách đã tải, không request API cho mỗi ký tự. Hiển thị số kết quả, trạng thái không tìm thấy, giữ thao tác Khóa/Đặt lại mật khẩu đúng tài khoản. Lọc tìm nhanh áp dụng trên tối đa 1.000 tài khoản mà endpoint hiện tại trả về. Logout xóa từ khóa, bảng và dữ liệu tìm kiếm.
- Nâng cùng một bản 2.5.2, ZIP Master_Password_Web_v2.5.2.zip, giữ các tùy chỉnh khác trong source Boss gửi. Không đổi schema/API HRM, không thêm migration/biến môi trường từ 2.5.0/2.5.1. Cài từ 2.3.x/2.4.x vẫn cần migrate-v2.5.0.sql như trước.

## Thay đổi 2.5.1 (lịch sử)

- Cảnh báo master được rút gọn thành hai dòng đầy đủ: “Mật khẩu master do Mr. HuyVo quản lý.” / “Vui lòng chỉ sử dụng đúng mục đích.” Nới chiều ngang của khung trong thẻ master, giảm padding/chiều cao, chọn cỡ chữ theo màn hình. Giữ màu cam, không dùng dấu … hoặc cắt mất nội dung.
- Chỉ sửa trình bày và câu cảnh báo. Từ 2.5.0 đã hoạt động không cần migration hoặc biến môi trường mới. Phiên bản và ZIP tăng lên 2.5.1.

## Thay đổi 2.5.0 (lịch sử)

- Khi nhận master hợp lệ, hiển thị dòng màu cam ngay trên countdown: **“Mật khẩu master do Mr. HuyVo quản lý. Vui lòng sử dụng đúng mục đích và trong phạm vi được cấp quyền.”** Dòng nằm trong vùng mã còn hiệu lực, ẩn khi chưa có mã, lỗi, hết hạn hoặc đăng xuất. Đây là thông điệp hướng dẫn sử dụng; quyền truy cập vẫn do server kiểm tra.
- Admin vào **Tài khoản → Thời hạn phiên người dùng**, nhập số giờ nguyên **1–168**, rồi Lưu thời hạn. Mặc định **8 giờ**, lưu dùng chung trên Neon và ghi audit SESSION_POLICY_UPDATE. API chặn user, yêu cầu phiên admin/CSRF/Origin/phiên bản và giới hạn tốc độ như các thao tác quản trị hiện có.
- Thiết lập áp dụng chung cho **các lần đăng nhập user tiếp theo**. Mỗi phiên có expires_at tuyệt đối từ lúc login; thay đổi thiết lập giữ nguyên thời hạn phiên đang hoạt động, không hồi sinh phiên đã hết hạn. Admin vẫn 8 giờ. Get, Copy, đổi tab hoặc refresh xác thực không gia hạn phiên.
- Cookie Max-Age được cấp theo thời hạn thực của phiên; không còn giới hạn cookie user cố định ở 8 giờ. Server kiểm tra expires_at trên mọi endpoint cần đăng nhập và kiểm tra lại trước khi trả master, kể cả phiên hết hạn trong lúc HRM đang đọc.
- API login/kiểm tra phiên trả sessionExpiresAt và sessionRemainingMs; UI dùng đồng hồ thực/monotonic, đưa về login và xóa master trong bộ nhớ khi hết hạn. Tab bị tạm dừng được kiểm tra lại khi hiện/pageshow; Get/Copy kiểm tra deadline ngay trước thao tác. Phản hồi Get muộn không được hiển thị/copy. Kiểm tra phiên mỗi 30 giây hiện có được giữ, không thêm polling cho Get.
- UI đo thời hạn theo remainingMs server và trừ độ trễ request một cách bảo thủ, có thể thoát sớm vài giây khi request/đồng hồ máy thay đổi. Backend là nguồn quyết định hết hạn; chỉnh đồng hồ hoặc vô hiệu hóa JavaScript không kéo dài quyền truy cập. Clipboard hệ điều hành không tự xóa sau logout.
- **Cần migration migrate-v2.5.0.sql trước khi deploy** để thêm mp_app_settings; chạy lại an toàn, không reset thiết lập đã lưu, không xóa user/phiên/lịch sử. Không cần biến Vercel mới. Schema cài mới gồm bảng này. Giữ các tối ưu Get v2.4.2; đường cache hit vẫn 2 SQL, đọc mã mới không tranh chấp vẫn 4 SQL. Mục tiêu dưới 10 giây vẫn chưa được xác nhận production.
- Kiểm thử SQL PostgreSQL/PGlite cho cấp phiên 1 giờ/168 giờ/admin 8 giờ, cookie, phân quyền, đầu vào, migration, hết hạn trước/trong Get; kiểm thử DOM cho cấu hình, tự thoát, tab ngủ, phản hồi muộn và thông điệp. Chưa chạy HRM production hoặc render bằng browser thật.

## Thay đổi 2.4.2 (lịch sử)

- Footer hiển thị in đậm **© 2026 HuyVo. All rights reserved · v2.4.2**. Phiên bản lấy từ package.json khi build; vẫn dùng X.Y.Z và tăng phiên bản/tên ZIP mỗi lần giao source.
- Thời gian đang Get và thời gian Get hoàn tất chỉ hiển thị **X giây**. Giữ đo millisecond theo timestamp thực bên trong, hiển thị số giây đã trôi qua bằng Math.floor, ví dụ 1.999 ms là 1 giây, 2.000 ms là 2 giây. Lượt cache nhanh dưới 1 giây hiển thị 0 giây. Progress % không quyết định số giây.
- Khi cache thiếu/hết hạn, khởi động Chromium và cấp quyền clipboard cục bộ song song với truy vấn nhận lease/snapshot Neon. Trước khi nhận lease không tạo trang, truy cập HRM, nhập tài khoản hoặc lấy mã. Sau khi có lease mới dùng browser đã sẵn sàng để đi qua luồng HRM hiện có. Khác với 2.4.0/2.4.1, phần launch được chạy song song thay vì chỉ import/chuẩn bị binary.
- Khi browser đang giữ lại còn hợp lệ, bước chuẩn bị không import lại dependency, không chuẩn bị binary và không launch mới; lần đọc sau khi mã hết hạn dùng browser/phiên HRM đó. Khi tắt HRM_BROWSER_REUSE, chỉ chuẩn bị runtime và launch đúng một lần sau lease.
- Các instance đang tranh lease có thể cùng chuẩn bị browser cục bộ; chỉ chủ lease được đọc HRM. Cache hit có sẵn không khởi động browser. Nếu cache xuất hiện sau bước admission, browser chuẩn bị trước có thể được giữ idle cho lần sau; tái sử dụng browser làm tăng RAM như trước.
- Giữ 4 lượt SQL khi đọc mã mới không tranh chấp và 2 lượt khi cache hit, kiểm tra quyền/audit và thời gian hiệu lực gốc. Không giảm timeout thành 10 giây. Mục tiêu dưới 10 giây chưa có số đo trên HRM/Vercel production để xác nhận; mức cải thiện phụ thuộc độ trễ DB, startup Chromium và HRM.
- Không cần SQL migration hoặc biến môi trường mới từ 2.3.x/2.4.x. Đã kiểm tra 111 test và build; chưa kiểm tra HRM production hoặc render bằng browser thật.

## Thay đổi 2.4.1 (lịch sử)

- Gom icon và tên Master Password thành một hàng ở góc trên trái của app, giảm padding và khoảng trống đầu trang. Bỏ ASC | WORKSPACE và câu giới thiệu dưới tên app.
- Bỏ hai dòng “Mã còn hiệu lực có thể copy lại ngay tại đây.” và “Phiên đăng nhập được kiểm tra cho mỗi lần Get”.
- Tách đồng hồ Get khỏi bộ cập nhật progress %. Đồng hồ lấy chênh lệch timestamp từ lúc click đến khi nhận/kiểm tra kết quả, cập nhật độc lập mỗi 100 ms, hiển thị một chữ số thập phân. Không lấy phần trăm, số lần callback hoặc số bước để tính giây.
- Kết hợp performance.now và Date.now để tính thời gian đã trôi qua khi browser tạm dừng hoặc máy ngủ; số đo không giảm. Khi quay lại tab/pageshow, đồng hồ cập nhật lại ngay từ timestamp. Việc đổi giờ hệ thống về phía trước trong lúc Get có thể ảnh hưởng số đo wall clock.
- Ví dụ: progress nhảy từ 30% lên 95% ở giây thứ 2 thì đồng hồ vẫn là 2,0 giây; bị ngừng callback 15 giây thì lúc tiếp tục phải là 17,0 giây. Kiểm thử xác nhận cả hai trường hợp.
- Copy lại giữ nguyên thời gian Get hoàn tất. Lần Get mới bắt đầu từ 0, lỗi giữ số giây đã chờ, đăng xuất dừng/xóa số đo. Thời gian Get độc lập với countdown hiệu lực của mã.
- Không đổi luồng HRM/SQL, không có migration hoặc biến môi trường mới từ 2.4.0. Chưa kiểm tra render bằng browser thật hoặc HRM production trong môi trường này.

## Thay đổi 2.4.0 (lịch sử)

- Khi thiếu cache hoặc mã hết hiệu lực, import Puppeteer/Chromium song song; chuẩn bị binary Chromium đồng thời với câu SQL nhận lease/cache. Chỉ mở browser, đăng nhập và đọc HRM sau khi nhận lease. Không thêm request Get từ UI hoặc tự gọi HRM trước khi user bấm Get.
- Gộp nhận lease và lấy snapshot cache vào một câu SQL. Lượt đọc HRM mới không tranh chấp dùng **4 lượt SQL** thay vì 5 (admission → lease/snapshot → publish cache → kiểm tra quyền/issued). Cache hit giữ **2 lượt SQL**. Những lần chờ instance khác có thể cần thêm truy vấn; không coi 4 là số cố định cho mọi tình huống.
- Giữ tái sử dụng browser/phiên HRM, cache mã hóa và gộp yêu cầu đồng thời của 2.3.3. Nếu instance mới hoàn toàn vẫn có bước khởi động Chromium; không có cắt timeout xuống 10 giây để tạo cảm giác nhanh.
- UI được thiết kế lại với vùng thao tác master riêng, trạng thái Sẵn sàng/Đang xử lý/Mã đang hiệu lực/Sắp hết hiệu lực, form và bảng quản trị rõ hơn, responsive, focus bàn phím và giảm chuyển động.
- Khi Get chạy, hiển thị **Đã chờ X,X giây** cạnh progress %. Khi nhận mã hợp lệ, hiển thị **Lần Get vừa hoàn tất — X,X giây**. Thời gian đo từ click tới nhận/kiểm tra kết quả, gồm mạng và backend; không bao gồm thời gian người dùng cấp quyền clipboard. Copy lại không đổi số đo. Lỗi hiển thị thời gian yêu cầu chưa thành công; lần thử mới bắt đầu từ 0. Đăng xuất xóa số đo của phiên.
- Thời gian Get không phải countdown hiệu lực, không lưu lịch sử cá nhân cho user. Mã hết hạn được loại khỏi cache; lần đọc tiếp theo lấy mã mới từ HRM. Không phát hiện được việc đổi mã ngoài HRM sớm hơn timer đã quan sát khi cache vẫn còn hợp lệ.
- Mục tiêu dưới 10 giây **chưa được xác nhận trên Vercel/Neon/HRM production**. Đo cả lần đầu, lần sau khi hết hạn và cache hit bằng UI/log. Mạng, thời gian đăng nhập HRM, Function region, Neon đang ngủ và cold start có thể làm vượt mục tiêu.
- Không cần migration hoặc biến bắt buộc mới từ 2.3.x. Chưa kiểm tra bằng trình duyệt render thật trong môi trường hiện tại; UI được kiểm tra bằng DOM/mô phỏng tương tác.

## Thay đổi 2.3.3 (lịch sử)

- Đường Get khi cache hợp lệ giảm từ **3 xuống 2 lượt SQL**: gộp xác thực phiên/user, đọc cache, cấp quyền Get và ghi pending/denied vào một câu SQL nguyên tử; lượt còn lại kiểm tra lại quyền và ghi issued trước khi trả mã. CSRF được kiểm tra trước câu SQL có thao tác ghi. Mỗi Get vẫn có audit riêng.
- Khi cần đọc mã mới, tái sử dụng Chromium và phiên HRM còn hợp lệ trên **cùng instance Vercel**. Mỗi lần đọc tạo trang mới, đi qua giao diện HRM bình thường và đóng trang sau khi đọc; nếu HRM yêu cầu đăng nhập lại thì dùng luồng đăng nhập hiện có. Không tự thử lại khi bị từ chối/xác minh/lỗi.
- Một browser được giữ tối đa 10 phút không sử dụng và 30 phút kể từ khi tạo. Kiểm tra cả đồng hồ thực/monotonic sau khi instance tạm dừng; loại bỏ khi mất kết nối, đổi HRM credential/SESSION_SECRET hoặc lỗi. Hai lượt đồng thời dùng browser riêng để không tranh chấp clipboard.
- Cookies HRM chỉ thuộc browser server; không xuất vào DB, log hoặc API. Việc giữ browser làm tăng RAM của instance. Có thể đặt `HRM_BROWSER_REUSE=0` để đóng browser sau mỗi lần đọc như trước.
- Giữ progress %, toast, Copy lại, phân quyền và thời gian hiệu lực gốc. Không cần SQL migration hoặc biến bắt buộc mới từ 2.3.x.
- Chưa đo độ trễ trên Vercel/HRM thật; kết quả kiểm thử xác nhận số SQL và số lần khởi động/đăng nhập đã giảm, không cam kết số giây.

## Thay đổi 2.3.2 (lịch sử)

- Thay bộ đếm bước 2/4 bằng phần trăm tăng dần, nhãn “Tiến độ ước tính”, giữ các trạng thái server hiện có.
- Khi đang chờ, % tăng theo thời gian ở từng giai đoạn và chậm dần: chuẩn bị 3–12%, xử lý 15–24%, lấy mã 30–90%. Khi server đọc mã xong và bắt đầu kiểm tra phiên/audit, chuyển lên 95%, tăng chậm và luôn dưới 100%. Chỉ lên 100% sau khi client nhận và kiểm tra kết quả hợp lệ.
- HRM không cung cấp tổng khối lượng công việc hoặc ETA; % không phải phần trăm công việc đo được và không dự đoán số giây còn lại. Có thể dừng tăng sát giới hạn của giai đoạn nếu server phản hồi lâu.
- Cập nhật mỗi 250 ms ở client, không thêm request, truy vấn DB hoặc trì hoãn copy. Chỉ số không giảm khi nhận sự kiện cũ/lặp; timer dừng khi hoàn tất/lỗi/đăng xuất. Mỗi Get mới bắt đầu từ đầu, độc lập với thanh countdown hiệu lực.
- Không có migration hoặc biến môi trường mới từ 2.3.0/2.3.1.

## Thay đổi 2.3.1 (lịch sử)

- Thanh tiến trình riêng khi Get đang chạy, có hiệu ứng chuyển động và hỗ trợ giảm chuyển động/accessibility.
- Các mốc 1/4, 2/4, 3/4 đến từ server trong cùng POST: đã xác thực → được nhận yêu cầu và đang đọc mã → đã đọc mã, đang kiểm tra lại phiên/ghi audit. Client hoàn tất 4/4 chỉ sau khi nhận kết quả hợp lệ; sau đó copy/toast và chuyển sang countdown như trước.
- Đây là tiến trình theo bước, không phải phần trăm thời gian hay dự đoán số giây. HRM chậm có thể giữ ở 2/4; không tự chạy gần đầy. Cache hit có thể chuyển rất nhanh. Không thêm polling, truy vấn DB hay độ trễ chờ hiệu ứng.
- Khi lỗi, hết thời gian hoặc đăng xuất, thanh ẩn/reset; không nhận/copy kết quả thuộc phiên cũ. Get bị chặn bấm lặp trong lúc đang lấy.
- Frontend yêu cầu application/x-ndjson. Các dòng progress chỉ chứa type/step/version. Dòng result chứa status và data; status trong dòng này là kết quả API thực, vì HTTP stream đã mở có status 200. Mã chỉ nằm trong result sau xác thực và audit như trước. Client không yêu cầu streaming vẫn nhận JSON/HTTP status cũ.
- Giữ nguyên schema của 2.3.0, không cần migration mới hoặc biến môi trường mới.

## Thay đổi 2.3.0 (lịch sử)

- Get dùng RAM cache và cache mã hóa dùng chung trên Neon. Instance mới có thể lấy mã đang còn hiệu lực mà không mở Chromium/đăng nhập HRM. Các instance dùng lease trong DB để gộp lần đọc HRM khi đồng thời thiếu cache.
- Bỏ lượt gọi `/api/version` trước mỗi Get. Server vẫn kiểm tra phiên bản trước HRM; response và footer giữ cùng phiên bản. Đường Get khi có cache hợp lệ cần ba lượt SQL: xác thực kèm cache, nhận quyền Get/ghi pending, kiểm tra lại phiên kèm ghi issued.
- Get/copy thành công hiện toast tự ẩn sau 3,5 giây. Bỏ dòng kết nối HRM và câu “Lấy mật khẩu và copy ngay vào clipboard.” Lỗi vẫn hiển thị để người dùng xử lý. Clipboard thất bại không báo copy thành công và có ô copy thủ công.
- User đổi mật khẩu của mình bằng mật khẩu hiện tại và mật khẩu mới 4–256 ký tự. Đổi thành công thu hồi mọi phiên của tài khoản và yêu cầu đăng nhập lại. Admin không được đổi mật khẩu qua UI hoặc endpoint này; sửa ADMIN_PASSWORD trên Vercel rồi deploy lại.
- Lịch sử chỉ dành cho admin; API chặn user bằng 403. Admin xóa một dòng hoặc toàn bộ lịch sử Get qua hộp xác nhận. Xóa tất cả áp dụng cả dữ liệu ngoài bộ lọc; giữ pending chưa quá 65 giây. Không xóa LOGIN/LOGOUT, sự kiện tài khoản hoặc sự kiện xóa lịch sử.
- Số lần Get và thống kê tính từ lịch sử còn giữ lại; xóa lịch sử làm giảm các số đếm này. Copy lại không gọi API Get và không tăng số lần Get.

## Luồng Get

1. Kiểm tra Origin/header/phiên bản, cookie, CSRF và cấu hình trước khi ghi DB.
2. Một câu SQL xác thực phiên, trạng thái user/auth_version/config_stamp, đọc cache mã hóa và cấp quyền Get nguyên tử: một yêu cầu mỗi người tại một thời điểm, bắt đầu cách nhau ít nhất 10 giây. Ghi pending nếu được nhận, denied nếu bị giới hạn; phiên không hợp lệ không tạo gate/audit Get.
3. Dùng mã còn hiệu lực trong RAM hoặc giải mã cache Neon. Nếu không có, chuẩn bị browser cục bộ song song với câu SQL nhận lease 55 giây/snapshot cache, rồi đọc HRM khi đã có lease và không còn cache hợp lệ: mượn browser đã sẵn sàng, tạo trang mới, đăng nhập khi form yêu cầu, đóng thông báo đổi mật khẩu nếu có, mở menu rồi đọc clipboard/timer. Trang được đóng sau mỗi lần đọc; browser còn hợp lệ có thể được giữ cho lần sau.
4. Ghi cache mã hóa. Kiểm tra lại phiên/user và ghi issued trong cùng một câu SQL trước khi trả mã. Nếu phiên bị thu hồi trong lúc đọc HRM hoặc chưa ghi được audit thì không trả mã.
5. Trừ thời gian xử lý/SQL và truyền phản hồi khỏi hiệu lực. Client copy, hiện toast, đếm giây; hết hạn hoặc đăng xuất xóa mã khỏi bộ nhớ/ô thủ công. Clipboard hệ điều hành không tự xóa.

`issued` là backend đã ghi nhận và chuẩn bị trả mã, không chứng minh trình duyệt đã nhận/copy. Mã đã copy ra ngoài app không thể bị thu hồi bằng cách khóa tài khoản. Nhật ký app xác định người yêu cầu, không chứng minh người sử dụng mã tại hệ thống khác.

## Cache và dữ liệu

Bản 2.3.0 **có lưu ciphertext của master trong bảng mp_master_cache**. AES-256-GCM, IV ngẫu nhiên 12 byte, tag 16 byte; khóa HKDF từ SESSION_SECRET. AAD ràng buộc scope và thời điểm hết hạn; scope HMAC ràng buộc tài khoản HRM. Không lưu master dạng rõ hoặc mật khẩu HRM trong DB/log/file/CDN/localStorage. Không trả ciphertext qua API xác nhận phiên/lịch sử.

Kiểm tra cả thời gian DB, đồng hồ thực và monotonic trước khi tái sử dụng; bỏ cache khi còn ≤3 giây, không reset về 300 giây. Thay credential HRM hoặc SESSION_SECRET không dùng lại cache cũ. Dữ liệu hết hạn bị từ chối về mặt logic và được thay thế khi có mã mới; không cam kết xóa ciphertext/backup ngay tại thời điểm hết hạn. SESSION_SECRET cần giữ riêng với DB và ổn định giữa các instance cùng deployment.

Schema: mp_users, mp_sessions, mp_limits, mp_get_gate, mp_audit, mp_master_cache, mp_app_settings. Neon HTTP driver, SQL tham số hóa. Mật khẩu user: scrypt với salt riêng, N=131072/r=8/p=1. Token phiên ngẫu nhiên, DB chỉ giữ SHA-256; cookie HTTPS HttpOnly/Secure/SameSite=Strict; user 1–168 giờ theo thiết lập khi login, admin 8 giờ. Origin/CSRF bảo vệ các POST. Khóa/đặt lại mật khẩu tăng auth_version. Thay admin credential hoặc SESSION_SECRET rồi redeploy thu hồi các phiên tương ứng.

Lịch sử Get hiển thị giờ Việt Nam, lọc người/ngày, phân trang 50 dòng. Pending quá 65 giây hiển thị Gián đoạn. Thao tác xóa và audit xóa nằm trong cùng câu SQL. Người sở hữu DB vẫn có thể sửa dữ liệu; đây không phải nhật ký chống sửa tuyệt đối. App không ghi IP/fingerprint.

## Tốc độ và cấu hình tùy chọn

- Mặc định bật cả hai lớp cache. `HRM_SHARED_CACHE_ENABLED=0`: tắt cache Neon, còn RAM cache. `HRM_CACHE_ENABLED=0`: tắt cả hai và đọc HRM mới mỗi Get. Migration vẫn nên chạy trước deploy để schema đồng nhất.
- `HRM_LIGHTWEIGHT_BROWSER=0`: tải lại ảnh/font/media HRM; mặc định bỏ tài nguyên nội bộ không cần thiết, giữ CSS/JS/API và tài nguyên xác minh bên ngoài.
- Runtime Logs chỉ có nhãn source (`hrm`, `memory`, `shared`, `database`), readerMs/processingMs, version và requestId. `shared` là chờ cùng reader trên một instance; `database` là giải mã cache Neon.
- Cache hợp lệ không cần Chromium. Khi cache hết hạn, browser/phiên HRM có thể được dùng lại nếu còn trên cùng instance. Instance mới hoặc browser đã hết hạn vẫn phải khởi động và đăng nhập; không tự lấy trước theo lịch. Giữ browser là tối ưu best effort, không đảm bảo Vercel luôn giữ instance. Chưa đo trên Vercel/HRM thật nên không cam kết số giây.
- `HRM_BROWSER_REUSE=0`: tắt giữ browser/phiên HRM; độc lập với hai lớp cache master.
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

Mở http://127.0.0.1:8787. Dev chỉ nghe loopback, dùng cookie mp_session_dev; HTTPS dùng __Host-mp_session. Dev reader dùng Chrome local và RAM cache; Get trên Vercel dùng cả cache Neon. Bộ test không cần DB/HRM thật: dùng TEST-ONLY, PGlite PostgreSQL, clipboard/UI giả lập. Đã kiểm tra 132 test và build trên Node 24 của môi trường phát triển; Vercel cấu hình Node 22.x. Chưa deploy hoặc kiểm tra HRM/Neon production end-to-end bản này.

## Phiên bản và đóng gói

Dùng X.Y.Z: patch sửa lỗi, minor thêm tính năng, major thay đổi không tương thích. Mỗi lần giao source tăng phiên bản; package.json là nguồn hiển thị, lockfile phải khớp. ZIP tên **Master_Password_Web_vX.Y.Z.zip**, package.json ở gốc; không chứa node_modules/dist/.env.local hoặc bí mật.

Các file chính: api/ cho endpoint; lib/security.mjs, auth-api.mjs và store.mjs cho tài khoản/DB; lib/hrm-browser.mjs cho luồng HRM; public/styles.css cho giao diện; lib/master-cache.mjs và shared-master.mjs cho cache; public/ cho UI/toast; database/ cho schema/migration; *-test.mjs cho kiểm thử.
