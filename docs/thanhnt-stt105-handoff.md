# ThanhNT — STT 105: View Settlement Balance Withdrawal Requests

Ngày kiểm tra: 12/10/2026. Nhánh: `feature/thanhnt-withdrawal-requests`.
Giao diện danh sách và chi tiết đã được ThanhNT chốt.

## Phạm vi

- Admin vào Finance → Wallet → Withdrawal để xem danh sách.
- Tìm theo UUID yêu cầu, tên hoặc số điện thoại KTV; lọc trạng thái và khoảng ngày tạo.
- Phân trang 10/25/50 dòng, sắp xếp yêu cầu mới nhất trước.
- Trang chi tiết hiển thị KTV, ngân hàng, tiền yêu cầu, phí, tiền thực nhận,
  số dư hiện tại, khoản đang giữ và số dư khả dụng.
- Hiển thị các mốc xử lý và ledger chi trả thực sự được lưu.
- Giữ từ khóa, bộ lọc và trang khi quay lại bằng nút trong trang, browser Back
  hoặc tải lại entry danh sách hiện tại.
- Có loading, lỗi kèm retry, danh sách trống, ID sai và yêu cầu không tồn tại.

STT 106 (duyệt/từ chối), top-up và các nghiệp vụ tài chính khác không thuộc thay đổi này.
Không có API ghi, không sửa schema, trigger hoặc dữ liệu tài chính.

## Route và API

| Loại | Đường dẫn |
| --- | --- |
| Web danh sách | `/admin/settlement/withdrawals` |
| Web chi tiết | `/admin/settlement/withdrawals/:id` |
| API danh sách | `GET /api/admin/settlement/withdrawals` |
| API chi tiết | `GET /api/admin/settlement/withdrawals/:id` |

Web dùng ProtectedRoute; cả hai API dùng authenticate và requireRole('ADMIN').
Tham số/response API được ghi tại `backend/src/modules/settlement/README.md`.

## Chạy và kiểm tra trên máy thành viên

1. Dùng PostgreSQL với schema nhóm đã thống nhất; các bảng cần thiết:
   users, technician_profiles, technician_accounts, withdrawals, settlement_transactions.
2. Cấu hình `backend/.env` với kết nối database và JWT secret; cấu hình
   `frontend/.env` có `VITE_API_BASE_URL` trỏ tới backend.
3. Cài dependency theo lockfile bằng `npm ci` trong backend và frontend.
4. Chạy `npm run dev` ở mỗi thư mục, đăng nhập bằng tài khoản Admin.
5. Vào Finance → Wallet → Withdrawal, thử lọc và xem chi tiết.

Chức năng không cần SMTP, Google Login hay gateway thanh toán.
Không commit `.env`, mật khẩu, `.DS_Store`, node_modules hoặc ảnh kiểm tra.

Kiểm tra tự động:

```sh
# Từ thư mục backend
npm test
# Chỉ dùng trên database local có dữ liệu demo Pending/Success
RUN_SETTLEMENT_DB_TESTS=1 node --test tests/settlement.test.js

# Từ thư mục frontend
npx eslint src/features/settlement src/App.jsx src/components/AdminSidebar.jsx
npm run build
```

## Kết quả nghiệm thu local

- Các test backend trước đó: 11 đạt, 3 kiểm tra DB theo biến môi trường được bỏ qua.
  Bộ settlement chạy riêng với fixture DB local: 4/4 đạt.
- 26 kiểm tra API thật bổ sung đạt: kết hợp phone/KTV/trạng thái/ngày, phân trang,
  wildcard literal, input sai, chi tiết Pending/Success, 401/403/404/422 và các API
  health/users/catalog/vouchers/blogs/complaints hiện có.
- Snapshot ba bảng withdrawals, technician_accounts, settlement_transactions
  trước/sau kiểm tra API giống nhau.
- Frontend lint và build đạt sau sửa phần lưu lịch sử điều hướng.
- Mũi tên ở bộ lọc trạng thái và ô chọn số dòng cách mép phải 14px;
  đã kiểm tra thao tác chọn số dòng trên trình duyệt.
- Trình duyệt với dữ liệu thật: danh sách/chi tiết, phí null, lọc trạng thái và ngày,
  tìm KTV, nút quay lại giữ bộ lọc, 404 và sidebar đúng mục đang chọn.
- Môi trường UI thử riêng với 31 bản ghi tổng hợp: trang 2/trang cuối,
  đổi 25 dòng, Processing/Failed/Cancelled, lỗi API giả lập và retry/loading đạt.
  Browser Back và reload giữ trang 2. Môi trường này không ghi database thật.

## Quy tắc dữ liệu và giới hạn

- Ngày lọc tính theo Asia/Ho_Chi_Minh, gồm toàn bộ ngày đầu/cuối; hiển thị cùng múi giờ.
- ID hiển thị UUID rút gọn ở bảng, đầy đủ trong chi tiết; không tự tạo mã WD001.
- Phí/net chưa biết giữ null và hiển thị Not determined, không thay bằng 0.
- Số dư khả dụng = số dư hiện tại − tổng tiền yêu cầu Pending/Processing của tài khoản.
  Khoản đang giữ bao gồm yêu cầu hiện tại nếu nó còn hoạt động.
- Current balance là giá trị ở snapshot đọc; balance before/after trong payout record
  là giá trị lịch sử của đúng giao dịch chi trả.
- UI tìm KTV bằng tên/điện thoại theo bố cục Figma đã duyệt; API có thêm technician_id
  để lọc chính xác. Chưa có dropdown chọn riêng KTV.
- Schema chỉ lưu initiated_at/processed_at/paid_at, ghi chú và failure_reason;
  không có đầy đủ mọi lần đổi trạng thái hoặc người xử lý. Không tạo lịch sử giả.

## File thuộc bàn giao

File chung sửa tối thiểu:

- backend/src/app.js
- frontend/src/App.jsx
- frontend/src/components/AdminSidebar.jsx
- frontend/src/styles.css

File mới:

- backend/src/modules/settlement/settlement.routes.js
- backend/src/modules/settlement/settlement.controller.js
- backend/src/modules/settlement/settlement.service.js
- backend/src/modules/settlement/settlement.repository.js
- backend/src/modules/settlement/settlement.validation.js
- backend/src/modules/settlement/README.md
- backend/tests/settlement.test.js
- frontend/src/features/settlement/api/settlementApi.js
- frontend/src/features/settlement/pages/WithdrawalsPage.jsx
- frontend/src/features/settlement/pages/withdrawals.css
- frontend/src/features/settlement/pages/WithdrawalDetailPage.jsx
- frontend/src/features/settlement/pages/withdrawalDetail.css
- docs/thanhnt-stt105-handoff.md

Tổng: 13 file mới và 4 file chỉnh sửa. Bàn giao qua nhánh riêng để nhóm review.
