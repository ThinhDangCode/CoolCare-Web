import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext.jsx'
import { adminRequest } from '../../management/api/managementApi.js'
import { CertificateTable, DocumentLink } from './TechnicianShared.jsx'
import { formatDate, safeDocumentUrl } from './technicianFormat.js'

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
  if (error) return <div role="alert">{error} <button type="button" onClick={() => setRetry(n=>n+1)}>Retry loading profile</button></div>
  if (!profile) return <p role="status">Loading submitted identity documents…</p>
  return <section>
    <dl className="identity-review-summary">
      <div><dt>Full name</dt><dd>{profile.full_name}</dd></div>
      <div><dt>Phone number</dt><dd>{profile.phone || '—'}</dd></div>
      <div><dt>Email</dt><dd>{profile.email || '—'}</dd></div>
      <div><dt>Submitted on</dt><dd>{formatDate(profile.submitted_at)}</dd></div>
    </dl>
    <p>Submitted citizen ID number: <strong>{profile.identity_number || 'Not provided'}</strong></p>
    {profile.verification_status !== 'PENDING' && <p role="alert">This application has already been reviewed. Close this dialog and refresh the list.</p>}
    <div className="identity-review-images">
      {['front','back'].map(side => {
        const url = safeDocumentUrl(profile[`identity_${side}_url`])
        return <div key={side}>
          <h4>{side === 'front' ? 'Citizen ID — front' : 'Citizen ID — back'}</h4>
          {url && <img src={url} alt={side === 'front' ? 'Submitted citizen ID front image' : 'Submitted citizen ID back image'} />}
          <DocumentLink url={url}>Open original image</DocumentLink>
        </div>
      })}
    </div>
    <h3>Submitted certificates</h3>
    <CertificateTable items={profile.certifications || []} />
  </section>
}
