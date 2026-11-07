import './penaltyReference.css'

const rules = [
  ['N01', 'Không tuân thủ lịch hẹn', 'Đến trễ không báo trước; tự ý đổi lịch; hủy lịch sát giờ không có lý do hợp lý.', '2–6'],
  ['N02', 'Thiếu chuyên nghiệp', 'Giao tiếp thiếu lịch sự; không hợp tác; không vệ sinh, thu dọn sau khi làm; thiếu tôn trọng không gian sinh hoạt của khách.', '4–8'],
  ['N03', 'Không hoàn thành trách nhiệm', 'Không đến theo lịch; tự ý bỏ dở công việc; làm thiếu hạng mục; từ chối hoặc trì hoãn bảo hành thuộc trách nhiệm.', '4–10'],
  ['N04', 'Không đảm bảo chất lượng kỹ thuật', 'Làm sai quy trình; sửa chữa, lắp đặt sai kỹ thuật; lỗi do tay nghề khiến phải làm lại; gây hư hỏng thiết bị hoặc tài sản.', '6–10'],
  ['N05', 'Không trung thực', 'Tự ý thu thêm tiền; khai khống vật tư, hạng mục; báo sai tình trạng thiết bị để thu lợi; dùng hoặc tráo linh kiện không đúng thỏa thuận; giả mạo kết quả hoàn thành.', '6–12'],
  ['N06', 'Xâm phạm quyền riêng tư', 'Tự ý chụp, đăng hoặc chia sẻ thông tin, hình ảnh của khách; sử dụng thông tin liên hệ ngoài mục đích công việc; tự ý vào khu vực riêng tư.', '6–12'],
  ['N07', 'Có hành vi đe dọa, quấy rối', 'Chửi bới, xúc phạm; đe dọa khách; quấy rối; gây áp lực buộc khách rút khiếu nại hoặc sửa đánh giá.', '6–12'],
  ['N08', 'Vi phạm đặc biệt nghiêm trọng', 'Trộm cắp; hành hung; cố ý phá hoại tài sản; vi phạm an toàn gây hậu quả đặc biệt nghiêm trọng.', '12'],
]

export function PenaltyReference() {
  return (
    <aside className="penalty-reference" aria-labelledby="penalty-reference-title" lang="vi">
      <header>
        <h3 id="penalty-reference-title">Bảng điểm trừ kỹ thuật viên</h3>
        <p>Mỗi thợ có 12 điểm ban đầu. Đối chiếu hành vi đã xác minh để quyết định mức trừ.</p>
      </header>
      <div className="penalty-reference-scroll" tabIndex={0} role="region" aria-label="Nhóm vi phạm và điểm trừ">
        <table>
          <caption>Điểm trừ mỗi lần theo nhóm vi phạm</caption>
          <thead><tr><th scope="col">Nhóm vi phạm / Hành vi</th><th scope="col">Điểm trừ</th></tr></thead>
          <tbody>
            {rules.map(([code, name, description, points]) => (
              <tr key={code}>
                <td><strong><span>{code}</span> {name}</strong><p>{description}</p></td>
                <td><b>{points}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  )
}
