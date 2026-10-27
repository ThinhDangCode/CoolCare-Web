import { useEffect, useState } from 'react'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import { CertificateTable, DocumentLink } from './TechnicianShared.jsx'
import { formatDate, safeDocumentUrl } from './technicianFormat.js'
import { IdentityOcrPanel } from './IdentityOcrPanel.jsx'

export function IdentityReviewContent({ technicianId, onReady }) {
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
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
  if (error) return <div role="alert">{error} <button type="button" onClick={() => setRetry(n=>n+1)}>{t('Retry loading profile')}</button></div>
  if (!profile) return <p role="status">{t('Loading submitted identity documents…')}</p>
  return <section>
    <dl className="identity-review-summary">
      <div><dt>{t('Full name')}</dt><dd>{profile.full_name}</dd></div>
      <div><dt>{t('Phone number')}</dt><dd>{profile.phone || '—'}</dd></div>
      <div><dt>{t('Email')}</dt><dd>{profile.email || '—'}</dd></div>
      <div><dt>{t('Submitted on')}</dt><dd>{formatDate(profile.submitted_at)}</dd></div>
    </dl>
    <p>{t('Submitted citizen ID number')}: <strong>{profile.identity_number || t('Not provided')}</strong></p>
    {profile.verification_status !== 'PENDING' && <p role="alert">{t('This application has already been reviewed. Close this dialog and refresh the list.')}</p>}
    <div className="identity-review-images">
      {['front','back'].map(side => {
        const url = safeDocumentUrl(profile[`identity_${side}_url`])
        return <div key={side}>
          <h4>{t(side === 'front' ? 'Citizen ID — front' : 'Citizen ID — back')}</h4>
          {url && <img src={url} alt={t(side === 'front' ? 'Submitted citizen ID front image' : 'Submitted citizen ID back image')} />}
          <DocumentLink url={url}>{t('Open original image')}</DocumentLink>
        </div>
      })}
    </div>
    {profile.verification_status === 'PENDING' && <IdentityOcrPanel technicianId={profile.id} hasImages={Boolean(profile.identity_front_url || profile.identity_back_url)} />}
    <h3>{t('Submitted certificates')}</h3>
    <CertificateTable items={profile.certifications || []} />
  </section>
}
