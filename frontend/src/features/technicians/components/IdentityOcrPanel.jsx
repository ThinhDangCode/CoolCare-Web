import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import './identityOcr.css'

const labels = {id:'Số căn cước',name:'Họ tên',dob:'Ngày sinh',sex:'Giới tính',nationality:'Quốc tịch',home:'Quê quán',address:'Địa chỉ',doe:'Ngày hết hạn',issue_date:'Ngày cấp',issue_loc:'Nơi cấp'}
const comparisonLabels = {MATCH:'Khớp hồ sơ',MISMATCH:'Không khớp — cần xem lại',UNAVAILABLE:'Chưa đủ dữ liệu đối chiếu'}

function SideResult({ title, result }) {
  if (result.status === 'ERROR') return <section><h4>{title}</h4><p role="alert">{result.message}</p></section>
  const entries = Object.entries(result.fields).filter(([,field]) => field.value)
  return <section>
    <h4>{title} — Đã đọc ảnh</h4>
    {result.warning && <p role="alert">{result.warning}</p>}
    {!entries.length && <p>Không có trường thông tin đọc được.</p>}
    <dl>{entries.map(([key,field]) => <div key={key}>
      <dt>{labels[key]}</dt>
      <dd>{field.value}{field.confidence !== null && <small>Độ tin cậy đọc chữ: {(field.confidence * 100).toFixed(1)}%</small>}</dd>
    </div>)}</dl>
  </section>
}

export function IdentityOcrPanel({ technicianId, hasImages }) {
  const { token, logout } = useAuth()
  const [busy,setBusy] = useState(false)
  const [result,setResult] = useState(null)
  const [error,setError] = useState('')
  const controller = useRef(null)
  useEffect(() => () => controller.current?.abort(), [])
  async function check() {
    if (busy) return
    const request = new AbortController()
    controller.current = request
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const data = await adminRequest(`/technicians/${technicianId}/identity-ocr`,token,{method:'POST',signal:request.signal})
      if (!request.signal.aborted) setResult(data)
    } catch (err) {
      if (!request.signal.aborted) {
        setError(err.message)
        if (err.status === 401) logout()
      }
    } finally {
      if (!request.signal.aborted) setBusy(false)
    }
  }
  return <div className="identity-ocr-panel" aria-busy={busy}>
    <h4>Đọc căn cước bằng FPT AI</h4>
    <p>Gửi hai ảnh căn cước đã nộp đến FPT để đọc thông tin và đối chiếu hồ sơ.</p>
    <button type="button" disabled={busy || !hasImages} onClick={check}>{busy ? 'Đang đọc hai mặt căn cước…' : 'Kiểm tra căn cước bằng AI'}</button>
    {!hasImages && <p>Cần có ảnh căn cước để kiểm tra.</p>}
    {error && <p className="identity-ocr-error" role="alert">{error}</p>}
    {result && <div aria-live="polite">
      <p>Thời điểm kiểm tra: {new Date(result.checked_at).toLocaleString('vi-VN')}</p>
      <ul>
        <li>Số căn cước: <strong>{comparisonLabels[result.comparison.identity_number]}</strong></li>
        <li>Họ tên: <strong>{comparisonLabels[result.comparison.full_name]}</strong></li>
      </ul>
      <div className="identity-ocr-sides">
        <SideResult title="Mặt trước" result={result.front} />
        <SideResult title="Mặt sau" result={result.back} />
      </div>
    </div>}
    <p className="identity-ocr-note">OCR chỉ đọc thông tin, không xác nhận căn cước thật/giả. Độ tin cậy là độ tin cậy đọc chữ; kết quả không tự duyệt hồ sơ.</p>
  </div>
}
