import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import './penaltyReference.css'

const rules = [
  ['N01', 'Không tuân thủ lịch hẹn', 'Đến trễ không báo trước; tự ý đổi lịch; hủy lịch sát giờ không có lý do hợp lý.', 'Schedule violations', 'Late arrival without notice; changing the schedule without approval; cancelling close to the appointment without a reasonable cause.', '2–6'],
  ['N02', 'Thiếu chuyên nghiệp', 'Giao tiếp thiếu lịch sự; không hợp tác; không vệ sinh, thu dọn sau khi làm; thiếu tôn trọng không gian sinh hoạt của khách.', 'Unprofessional conduct', 'Rude communication; refusing to cooperate; failing to clean up; disrespecting the customer’s home.', '4–8'],
  ['N03', 'Không hoàn thành trách nhiệm', 'Không đến theo lịch; tự ý bỏ dở công việc; làm thiếu hạng mục; từ chối hoặc trì hoãn bảo hành thuộc trách nhiệm.', 'Failure to meet responsibilities', 'Missing an appointment; abandoning work; omitting agreed work; refusing or delaying required warranty service.', '4–10'],
  ['N04', 'Không đảm bảo chất lượng kỹ thuật', 'Làm sai quy trình; sửa chữa, lắp đặt sai kỹ thuật; lỗi do tay nghề khiến phải làm lại; gây hư hỏng thiết bị hoặc tài sản.', 'Poor technical quality', 'Incorrect procedures, repairs or installation; workmanship requiring rework; damage to equipment or property.', '6–10'],
  ['N05', 'Không trung thực', 'Tự ý thu thêm tiền; khai khống vật tư, hạng mục; báo sai tình trạng thiết bị để thu lợi; dùng hoặc tráo linh kiện không đúng thỏa thuận; giả mạo kết quả hoàn thành.', 'Dishonesty', 'Unauthorized charges; inflated materials or work; false diagnostics; unapproved parts; falsified completion.', '6–12'],
  ['N06', 'Xâm phạm quyền riêng tư', 'Tự ý chụp, đăng hoặc chia sẻ thông tin, hình ảnh của khách; sử dụng thông tin liên hệ ngoài mục đích công việc; tự ý vào khu vực riêng tư.', 'Privacy violation', 'Sharing customer information or images without consent; using contact details outside the job; entering private areas without permission.', '6–12'],
  ['N07', 'Có hành vi đe dọa, quấy rối', 'Chửi bới, xúc phạm; đe dọa khách; quấy rối; gây áp lực buộc khách rút khiếu nại hoặc sửa đánh giá.', 'Threats or harassment', 'Insults, threats or harassment; pressuring a customer to withdraw a complaint or change a review.', '6–12'],
  ['N08', 'Vi phạm đặc biệt nghiêm trọng', 'Trộm cắp; hành hung; cố ý phá hoại tài sản; vi phạm an toàn gây hậu quả đặc biệt nghiêm trọng.', 'Severe misconduct', 'Theft; assault; deliberate property damage; serious safety violations.', '12'],
]

export function PenaltyReference() {
  const { locale } = useUiPreferences()
  const vi = locale === 'vi'
  return (
    <aside className="penalty-reference" aria-labelledby="penalty-reference-title" lang={vi ? 'vi' : 'en'}>
      <header>
        <h3 id="penalty-reference-title">{vi ? 'Bảng điểm trừ kỹ thuật viên' : 'Technician penalty reference'}</h3>
        <p>{vi ? 'Mỗi thợ có 12 điểm ban đầu. Đối chiếu hành vi đã xác minh để quyết định mức trừ.' : 'Each technician starts with 12 points. Use verified conduct to decide the deduction.'}</p>
        <p>{vi ? 'Thợ hủy booking đã nhận tự động bị trừ 2 điểm, không hết hạn; bảng dưới dùng khi xử lý khiếu nại.' : 'Cancelling an accepted booking automatically deducts 2 points without expiry; this table guides complaint reviews.'}</p>
      </header>
      <div className="penalty-reference-scroll" tabIndex={0} role="region" aria-label={vi ? 'Nhóm vi phạm và điểm trừ' : 'Violation categories and point deductions'}>
        <table>
          <caption>{vi ? 'Điểm trừ mỗi lần theo nhóm vi phạm' : 'Points deducted per violation'}</caption>
          <thead><tr><th scope="col">{vi ? 'Nhóm vi phạm / Hành vi' : 'Violation / Conduct'}</th><th scope="col">{vi ? 'Điểm trừ' : 'Points'}</th></tr></thead>
          <tbody>
            {rules.map(([code, viName, viDescription, enName, enDescription, points]) => (
              <tr key={code}>
                <td><strong><span>{code}</span> {vi ? viName : enName}</strong><p>{vi ? viDescription : enDescription}</p></td>
                <td><b>{points}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  )
}
