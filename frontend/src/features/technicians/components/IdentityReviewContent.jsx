import { useEffect, useState } from 'react'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import { DocumentLink } from './TechnicianShared.jsx'
import { safeDocumentUrl } from './technicianFormat.js'
import { IdentityOcrPanel } from './IdentityOcrPanel.jsx'

export function IdentityReviewContent({ technicianId, onReady }) {
  const { token, logout } = useAuth()
  const [profile,setProfile] = useState(null)
  const [error,setError] = useState('')
  const [retry,setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    onReady(false)
    adminRequest(`/technicians/${technicianId}`,token,{signal:controller.signal})
      .then(data => {
        if (controller.signal.aborted) return
        setProfile(data)
        setError('')
        onReady(data.verification_status === 'PENDING')
      })
      .catch(err => {
        if (controller.signal.aborted) return
        setError(err.message)
        if (err.status === 401) logout()
      })
    return () => controller.abort()
  },[technicianId,token,logout,onReady,retry])
  if (error) return <div role="alert">{error} <button type="button" onClick={() => setRetry(n=>n+1)}>Tải lại hồ sơ</button></div>
  if (!profile) return <p role="status">Đang tải ảnh căn cước đã nộp…</p>
  return <section>
    <p>Số căn cước đã khai: <strong>{profile.identity_number || 'Chưa có'}</strong></p>
    {profile.verification_status !== 'PENDING' && <p role="alert">Hồ sơ đã được xử lý. Đóng và tải lại danh sách.</p>}
    <div className="identity-review-images">
      {['front','back'].map(side => {
        const url = safeDocumentUrl(profile[`identity_${side}_url`])
        return <div key={side}>
          <h4>{side === 'front' ? 'Căn cước mặt trước' : 'Căn cước mặt sau'}</h4>
          {url && <img src={url} alt={side === 'front' ? 'Ảnh căn cước mặt trước đã nộp' : 'Ảnh căn cước mặt sau đã nộp'} />}
          <DocumentLink url={url}>Mở ảnh gốc</DocumentLink>
        </div>
      })}
    </div>
    {profile.verification_status === 'PENDING' && <IdentityOcrPanel technicianId={profile.id} hasImages={Boolean(profile.identity_front_url || profile.identity_back_url)} />}
  </section>
}
