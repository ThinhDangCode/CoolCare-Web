# CoolCare Web

Technician administration uses the existing database schema without migrations. Reviews use `reviewed_by_id`, `reviewed_at`, and `rejection_reason`. The original one-active-job limit is preserved. Review actions write structured `ADMIN_AUDIT` events to the backend logger. Approval does not override wallet restrictions. Deactivation disables sign-in and new assignments while preserving existing job history.

- `backend`: API dùng chung cho Flutter và Admin Web.
- `frontend`: React/Vite Admin Web.

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
