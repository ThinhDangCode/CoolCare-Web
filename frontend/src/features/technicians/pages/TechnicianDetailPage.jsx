import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { PageHeader } from '../../../shared/components/AdminUi.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import {
  CertificateTable,
  TechnicianNotification,
  DocumentLink,
  TechnicianAvatar,
  TechnicianBadge,
  formatDate,
  label,
} from '../components/TechnicianShared.jsx'
import '../../../shared/styles/admin.css'
import './technicians.css'
import './technicianDetail.css'
import { TechnicianAreasDialog } from '../components/TechnicianAreasDialog.jsx'
import { EditTechnicianDialog, DeactivateDialog } from '../components/TechnicianActions.jsx'

const tabs = {
  overview: 'Overview',
  qualification: 'Skills & Certifications',
}
function Field({ title, children }) {
  const { t } = useUiPreferences()
  return (
    <div className="technician-field">
      <dt>{t(title)}</dt>
      <dd>{typeof children === 'string' ? t(children) : children || '—'}</dd>
    </div>
  )
}

export function TechnicianDetailPage() {
  const { id } = useParams()
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const [params, setParams] = useSearchParams()
  const requestedTab = params.get('tab')
  const tab =
    requestedTab === 'certifications'
      ? 'qualification'
      : Object.hasOwn(tabs, requestedTab)
        ? requestedTab
        : 'overview'
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [action, setAction] = useState(null)
  const [notice, setNotice] = useState('')
  const canManage = data?.verification_status === 'VERIFIED'
  useEffect(() => {
    const controller = new AbortController()
    adminRequest(`/technicians/${id}`, token, { signal: controller.signal })
      .then((result) => {
        setData(result)
        setError('')
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message)
          if (err.status === 401) logout()
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [id, token, logout, refresh])
  const retry = () => {
    setLoading(true)
    setRefresh((n) => n + 1)
  }
  return (
    <main className="figma-admin-main technician-main technician-detail-page">
      <PageHeader
        title="Technician Details"
        subtitle="Manage technician profile, verification documents, and service status"
        onRefresh={retry}
        refreshing={loading}
      />
      <section className="technician-content">
        <div className="technician-detail-heading">
          <div className="technician-profile-actions">
            <Link className="technician-view" to="/admin/technicians">
              ← {t('Back to list')}
            </Link>
            {canManage && !loading && !error && (
              <>
                {(!data.is_active || data.account_status === 'INACTIVE') &&
                  data.account_status !== 'LOCKED' && (
                    <button className="primary" onClick={() => setAction('activate')}>
                      {t('Activate Account')}
                    </button>
                  )}
                {(data.is_active || data.account_status !== 'INACTIVE') && (
                  <button className="danger" onClick={() => setAction('deactivate')}>
                    ⊘ {t('Deactivate Account')}
                  </button>
                )}
                <button onClick={() => setAction('edit')}>✎ {t('Edit Profile')}</button>
                <button onClick={() => setAction('skills')}>{t('Update Skills')}</button>
                <button onClick={() => setAction('areas')}>{t('Update Service Areas')}</button>
              </>
            )}
          </div>
        </div>
        <TechnicianNotification message={notice} onDismiss={setNotice} />
        {loading ? (
          <div role="status" className="technician-state">
            <i className="figma-spinner" /> {t('Loading technician profile…')}
          </div>
        ) : error ? (
          <div role="alert" className="technician-state">
            <p>{error}</p>
            <button onClick={retry}>{t('Try again')}</button>
          </div>
        ) : (
          data && (
            <>
              <section className="technician-summary">
                <div className="technician-person">
                  <div className="technician-detail-avatar">
                    <TechnicianAvatar name={data.full_name} url={data.avatar_url} />
                    <i
                      className={
                        data.is_active && data.availability_status === 'ONLINE' ? 'online' : ''
                      }
                      aria-label={label(data.availability_status)}
                    />
                  </div>
                  <div>
                    <h2>{data.full_name}</h2>
                    <TechnicianBadge value={data.status} />{' '}
                    <TechnicianBadge value={data.availability_status} />
                  </div>
                </div>
                <div className="technician-metrics">
                  <div>
                    <small>{t('OVERALL RATING')}</small>
                    <strong>
                      {data.total_reviews ? Number(data.rating_average).toFixed(2) : '—'}{' '}
                      <span>/ 5</span>
                    </strong>
                    <small>
                      {data.total_reviews} {t('reviews')}
                    </small>
                  </div>
                  <div>
                    <small>{t('COMPLETED JOBS')}</small>
                    <strong>{data.completed_jobs}</strong>
                  </div>
                </div>
              </section>
              <div className="technician-profile-actions technician-detail-review">
                {data.verification_status === 'PENDING' && (
                  <>
                    <Link
                      className="technician-view"
                      to={`/admin/technicians/verification?search=${encodeURIComponent(data.full_name)}`}
                    >
                      {t('Pending verification · Open Verification Queue')} →
                    </Link>
                  </>
                )}
              </div>
              <div
                className="technician-tabs"
                role="tablist"
                aria-label={t('Technician profile sections')}
              >
                {Object.entries(tabs).map(([key, text]) => (
                  <button
                    key={key}
                    id={`tab-${key}`}
                    role="tab"
                    aria-selected={tab === key}
                    aria-controls="technician-panel"
                    className={tab === key ? 'active' : ''}
                    onClick={() => setParams({ tab: key })}
                  >
                    {t(text)}
                  </button>
                ))}
              </div>
              <div id="technician-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
                {tab === 'overview' && (
                  <>
                    <section className="technician-card">
                      <div className="technician-card-heading">
                        <h3>{t('Personal information')}</h3>
                        <TechnicianBadge value={data.verification_status} />
                      </div>
                      <dl className="technician-fields">
                        <Field title="FULL NAME">{data.full_name}</Field>
                        <Field title="DATE OF BIRTH">Not provided</Field>
                        <Field title="GENDER">Not provided</Field>
                        <Field title="CONTACT PHONE">
                          {data.phone}
                          {data.phone_verified_at && (
                            <span className="technician-phone-check" title={t('Verified phone')}>
                              {' '}
                              ✓
                            </span>
                          )}
                        </Field>
                        <Field title="PERSONAL EMAIL">{data.email}</Field>
                        <div className="technician-detail-wide">
                          <Field title="PERMANENT ADDRESS">Not provided</Field>
                        </div>
                        <div className="technician-detail-wide">
                          <Field title="SERVICE AREAS">
                            {data.areas.length
                              ? data.areas
                                  .map((a) => [a.ward, a.city].filter(Boolean).join(', '))
                                  .join(' · ')
                              : t('No service areas assigned.')}
                          </Field>
                        </div>
                      </dl>
                      <div className="technician-detail-emergency">
                        <Field title="EMERGENCY CONTACT">Not provided</Field>
                      </div>
                      <div className="technician-detail-joined">
                        <span>▦</span>
                        <span>
                          {t('Joined CoolCare Platform')}:{' '}
                          <strong>{formatDate(data.created_at)}</strong>
                        </span>
                      </div>
                      {data.bio && (
                        <div className="technician-note">
                          <strong>{t('About technician')}</strong>
                          <p>{data.bio}</p>
                        </div>
                      )}
                    </section>
                  </>
                )}
                {tab === 'overview' && (
                  <section className="technician-card">
                    <div className="technician-card-heading">
                      <h3>{t('Identity information')}</h3>
                      <TechnicianBadge value={data.verification_status} />
                    </div>
                    <dl className="technician-fields">
                      <Field title="CITIZEN ID (CCCD)">{data.identity_number}</Field>
                      <Field title="CONTACT NUMBER">{data.phone}</Field>
                      <Field title="EMAIL VERIFIED">{formatDate(data.email_verified_at)}</Field>
                      <Field title="PHONE VERIFIED">{formatDate(data.phone_verified_at)}</Field>
                      <Field title="RESIDENTIAL ADDRESS">Not recorded in the current profile</Field>
                      <Field title="SUBMITTED">{formatDate(data.submitted_at)}</Field>
                      <Field title="REVIEWED BY">{data.reviewed_by}</Field>
                      <Field title="REVIEWED AT">{formatDate(data.reviewed_at)}</Field>
                    </dl>
                    <div className="technician-document-grid">
                      <div>
                        <h4>{t('CCCD · Front side')}</h4>
                        <DocumentLink url={data.identity_front_url}>Open front side</DocumentLink>
                      </div>
                      <div>
                        <h4>{t('CCCD · Back side')}</h4>
                        <DocumentLink url={data.identity_back_url}>Open back side</DocumentLink>
                      </div>
                    </div>
                    {data.rejection_reason && (
                      <div className="technician-note">
                        <strong>{t('Rejection reason')}</strong>
                        <p>{data.rejection_reason}</p>
                      </div>
                    )}
                  </section>
                )}
                {tab === 'qualification' && (
                  <>
                    <section className="technician-card">
                      <div className="technician-card-heading">
                        <h3>{t('Skills & qualification')}</h3>
                        {canManage && (
                          <div className="technician-profile-actions">
                            <button onClick={() => setAction('skills')}>
                              {t('Update skills')}
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="technician-qualification">
                        <div>
                          <small>{t('QUALIFICATION LEVEL')}</small>
                          <strong>{t(label(data.qualification_level))}</strong>
                        </div>
                        <div>
                          <small>{t('EXPERIENCE')}</small>
                          <strong>
                            {data.years_experience} {t('years')}
                          </strong>
                        </div>
                      </div>
                      <div className="figma-users-table technician-table">
                        <table>
                          <thead>
                            <tr>
                              <th>{t('SKILL')}</th>
                              <th>{t('LEVEL')}</th>
                              <th>{t('AC BRAND')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.skills.length ? (
                              data.skills.map((s) => (
                                <tr key={s.id}>
                                  <td>{s.name}</td>
                                  <td>{t(label(s.skill_level))}</td>
                                  <td>{s.brand || t('All brands')}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={3}>
                                  <div className="figma-table-state">
                                    {t('No skills assigned.')}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                    <section className="technician-card">
                      <h3>
                        {t('Professional certifications')}{' '}
                        <span className="technician-count">{data.certifications.length}</span>
                      </h3>
                      <CertificateTable items={data.certifications} />
                    </section>
                  </>
                )}
              </div>
            </>
          )
        )}
      </section>
      {canManage &&
        action &&
        (action === 'areas' ? (
          <TechnicianAreasDialog
            data={data}
            onClose={() => setAction(null)}
            onSuccess={() => {
              setAction(null)
              setNotice(t('Technician service areas updated.'))
              retry()
            }}
          />
        ) : ['edit', 'skills'].includes(action) ? (
          <EditTechnicianDialog
            data={data}
            skillsOnly={action === 'skills'}
            onClose={() => setAction(null)}
            onSuccess={() => {
              setAction(null)
              setNotice(
                action === 'skills'
                  ? t('Technician skills updated.')
                  : t('Technician profile updated.')
              )
              retry()
            }}
          />
        ) : ['deactivate', 'activate'].includes(action) ? (
          <DeactivateDialog
            data={data}
            activate={action === 'activate'}
            onClose={() => setAction(null)}
            onSuccess={() => {
              setAction(null)
              setNotice(
                action === 'activate'
                  ? t('Technician activated.')
                  : t('Technician deactivated.')
              )
              retry()
            }}
          />
        ) : null)}
    </main>
  )
}
