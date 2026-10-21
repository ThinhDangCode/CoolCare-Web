# CoolCare Web

Technician administration uses the existing database schema without migrations. Reviews use `reviewed_by_id`, `reviewed_at`, and `rejection_reason`. The original one-active-job limit is preserved. Review actions write structured `ADMIN_AUDIT` events to the backend logger. Approval does not override wallet restrictions. Deactivation disables sign-in and new assignments while preserving existing job history.

- `backend`: API dùng chung cho Flutter và Admin Web.
- `frontend`: React/Vite Admin Web.

STT118 (ThanhNT, Sprint 2): Admin xem doanh thu hoa hồng tại `/admin/revenue`.
Thống kê dùng ngày đối soát `settled_at` theo UTC+7 và phân bổ hoa hồng theo
tỷ trọng dịch vụ/công trong báo giá đã duyệt. Không cần migration hoặc chạy lại
seed. Quy tắc và API được mô tả tại [Revenue](backend/src/modules/revenue/README.md).

STT119 (ThanhNT, Sprint 2): Admin xem toàn bộ giao dịch rút tiền tại
`/admin/withdrawals`, tìm kiếm/lọc theo ngày khởi tạo (UTC+7) và xem chi tiết
phí, tiền thực nhận, ngân hàng, trạng thái cùng bút toán đối soát nếu có.
Chức năng chỉ đọc dữ liệu, không duyệt hoặc chuyển tiền; không cần migration
hay chạy lại seed. API được mô tả tại [Withdrawals](backend/src/modules/withdrawals/README.md).

STT120 (ThanhNT, Sprint 2): Admin xem lịch sử nạp tiền của kỹ thuật viên tại
`/admin/topups`, lọc theo trạng thái, phương thức thanh toán và ngày tạo (UTC+7).
Chi tiết hiển thị thời gian thanh toán, đối soát và bút toán tăng số dư nếu có.
Chức năng chỉ đọc dữ liệu; API được mô tả tại [Top-ups](backend/src/modules/topups/README.md).

STT121 (ThanhNT, Sprint 3): Admin xem báo cáo tổng quan tại
`/admin/analytics/reports` (Analytics → Reports). Lọc 7/30/90 ngày, từ đầu năm
hoặc khoảng tùy chọn tối đa 366 ngày theo UTC+7. Lịch đặt và lượt dùng dịch vụ
tính theo ngày tạo lịch; hoa hồng tính theo ngày đối soát thanh toán thành công.
Tổng khách hàng/kỹ thuật viên là số hồ sơ hiện tại. Chức năng chỉ đọc dữ liệu,
không cần migration/seed; quy tắc và API tại [Reports](backend/src/modules/reports/README.md).

STT122 (ThanhNT, Sprint 3): Phân tích khách hàng tại `/admin/analytics/customers`,
gồm tổng quan, khách mới, khu vực, dịch vụ, hủy/từ chối và tài khoản bị khóa.
Tổng tài khoản/trạng thái/địa chỉ là dữ liệu hiện tại; khách mới theo ngày tạo hồ sơ,
dịch vụ theo lịch đặt hoàn thành thuộc nhóm ngày tạo lịch đã chọn, tỷ lệ hủy/từ chối
theo cùng nhóm lịch đặt. Hỗ trợ Việt/Anh; chỉ đọc dữ liệu, không migration/seed.
Quy tắc và API tại [Customer statistics](backend/src/modules/customer-statistics/README.md).

STT123 (ThanhNT, Sprint 3): Phân tích kỹ thuật viên tại `/admin/analytics/technicians`,
gồm tổng quan, thu nhập, khu vực phục vụ, hiệu suất, vấn đề và tài khoản bị khóa.
Tổng hồ sơ, trạng thái và khu vực là dữ liệu hiện tại; hoạt động theo nhóm yêu cầu
phân công gửi trong kỳ, thu nhập theo thanh toán thành công đã đối soát, đánh giá
theo ngày tạo, khiếu nại theo ngày tạo và hình phạt theo ngày áp dụng (UTC+7).
Tiền kỹ thuật viên được hưởng bao gồm hoàn trả vật tư nếu có, không phải lợi nhuận.
Hỗ trợ Việt/Anh; chỉ đọc dữ liệu, không migration/seed. Quy tắc chi tiết và API tại
[Technician statistics](backend/src/modules/technician-statistics/README.md).

Chạy backend:

```text
cd backend
# nhận backend/.env riêng từ trưởng nhóm; không commit file này
npm install
npm run dev
```

Xác thực email khi đăng ký cần migration sau (chạy một lần trên database đang dùng):

```text
psql -d coolcare_db -v ON_ERROR_STOP=1 -f backend/database/migrations/20261003_add_email_verification_tokens.sql
```

Để gửi OTP thật đến Gmail, cấu hình SMTP trong `backend/.env`. Không commit mật khẩu SMTP:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-coolcare-email@gmail.com
SMTP_PASSWORD=your-16-character-app-password
SMTP_FROM=CoolCare <your-coolcare-email@gmail.com>
```

Với Gmail, `SMTP_PASSWORD` là App Password, không phải mật khẩu Gmail thông thường.
Khi chưa cấu hình SMTP, API trả lỗi `EMAIL_NOT_CONFIGURED` thay vì nói OTP đã được gửi.

Dữ liệu mẫu dùng chung do nhóm chuẩn bị nằm tại `backend/database/seed_data.sql`.
Sau khi tạo đúng schema 41 bảng, chạy toàn bộ file này một lần bằng DBeaver, pgAdmin
hoặc psql:

```text
psql -d coolcare_db -v ON_ERROR_STOP=1 -f backend/database/seed_data.sql
```

File seed chạy trong transaction và tự dừng nếu database đã có dữ liệu mẫu, vì vậy
không chạy lại trên database đang sử dụng. Mật khẩu chung của tài khoản demo là
`CoolCare@123`.

Chạy frontend:

```text
cd frontend
# nhận frontend/.env riêng từ trưởng nhóm nếu cần đổi API URL
npm install
npm run dev
```

Các file `.env` là cấu hình local và không được commit lên Git.
