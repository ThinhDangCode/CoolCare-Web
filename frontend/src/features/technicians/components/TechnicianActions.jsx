import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import './technicianActions.css'
import { DocumentLink, TechnicianNotification } from './TechnicianShared.jsx'
import { IdentityReviewContent } from './IdentityReviewContent.jsx'
import {
  localProfilePhone,
  profileInputError,
  validateTechnicianProfile,
} from './technicianProfileValidation.js'

export function Dialog({ title, children, onClose, busy }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="technician-action-dialog"
      aria-labelledby="technician-action-title"
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onClose()
      }}
    >
      <h2 id="technician-action-title">{title}</h2>
      {children}
    </dialog>
  )
}
export function ReviewDialog({ target, onClose, onSuccess }) {
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const approve = target.status === 'VERIFIED'
  const [identityReady, setIdentityReady] = useState(false)
  async function submit(event) {
    event.preventDefault()
    if (target.technicianId && !identityReady) return
    setBusy(true)
    setError('')
    try {
      await adminRequest(target.path, token, {
        method: 'PATCH',
        body: {
          status: target.status,
          ...(!approve ? { reason } : {}),
          ...(target.updatedAt ? { expected_updated_at: target.updatedAt } : {}),
        },
      })
      onSuccess()
    } catch (err) {
      setError(err.message)
      if (err.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={t(approve ? 'Approve {kind}?' : 'Reject {kind}?', { kind: t(target.kind || 'profile') })}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <p>{target.name}</p>
        {target.technicianId && <IdentityReviewContent technicianId={target.technicianId} onReady={setIdentityReady} />}
        <p>
          {approve
            ? t('Confirm that you have checked the submitted identity or certificate documents.')
            : t('Provide a reason so the technician knows what needs to be corrected.')}
        </p>
        {target.kind === 'certification' && target.certificate && (
          <section>
            <p>{t('Issuer')}: <strong>{target.certificate.issued_by || t('Not provided')}</strong></p>
            <p>{t('Certificate number')}: <strong>{target.certificate.certificate_number || t('Not provided')}</strong></p>
            <DocumentLink url={target.certificate.document_url}>{t('Open certificate document')}</DocumentLink>
          </section>
        )}
        {!approve && (
          <label>
            {t('Rejection reason')}
            <textarea
              required
              minLength={5}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        <TechnicianNotification message={t(error)} onDismiss={setError} danger />
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className={approve ? 'primary' : 'danger'} disabled={busy || Boolean(target.technicianId && !identityReady)}>
            {busy ? t('Saving…') : t(approve ? 'Approve' : 'Reject')}
          </button>
        </footer>
      </form>
    </Dialog>
  )
}
export function DeactivateDialog({ data, activate = false, onClose, onSuccess }) {
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await adminRequest(`/technicians/${data.id}/${activate ? 'activate' : 'deactivate'}`, token, {
        method: 'POST',
      })
      onSuccess()
    } catch (err) {
      setError(err.message)
      if (err.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={t(activate ? 'Activate technician?' : 'Deactivate technician?')}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit}>
        <p>
          {t(activate ? 'Activate' : 'Deactivate')} <strong>{data.full_name}</strong>?{' '}
          {activate
            ? t('Restore account access. New jobs still require a verified profile, availability and wallet eligibility.')
            : t('This disables sign-in and new job assignments. Existing job history will be preserved.')}
        </p>
        <TechnicianNotification message={t(error)} onDismiss={setError} danger />
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className={activate ? 'primary' : 'danger'} disabled={busy}>
            {busy ? t('Saving…') : t(activate ? 'Activate' : 'Deactivate')}
          </button>
        </footer>
      </form>
    </Dialog>
  )
}
export function EditTechnicianDialog({ data, skillsOnly = false, onClose, onSuccess }) {
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const formRef = useRef(null)
  const submitting = useRef(false)
  const errorFieldRef = useRef(null)
  const [form, setForm] = useState({
    full_name: data.full_name || '',
    phone: localProfilePhone(data.phone),
    qualification_level: data.qualification_level,
    years_experience: String(data.years_experience ?? ''),
    bio: data.bio || '',
  })
  const [skills, setSkills] = useState(
    data.skills.map((s) => ({
      skill_id: s.skill_id,
      ac_brand_id: s.ac_brand_id,
      skill_level: s.skill_level,
    }))
  )
  const [options, setOptions] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [refresh, setRefresh] = useState(0)
  const skillRequired = skillsOnly && data.verification_status === 'VERIFIED' && !skills.length
  useEffect(() => {
    if (!skillsOnly) return
    const controller = new AbortController()
    adminRequest('/technicians/skill-options', token, { signal: controller.signal })
      .then(setOptions)
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message)
          if (err.status === 401) logout()
        }
      })
    return () => controller.abort()
  }, [skillsOnly, token, logout, refresh])
  async function submit(event) {
    event.preventDefault()
    if (submitting.current) return
    if (skillRequired) {
      setError(t('A verified technician must have at least one skill.'))
      return
    }
    if (!skillsOnly) {
      const errors = Object.fromEntries(
        Object.entries({ ...fieldErrors, ...validateTechnicianProfile(form) }).filter(
          ([, message]) => message
        )
      )
      setFieldErrors(errors)
      if (Object.keys(errors).length) {
        formRef.current?.elements.namedItem(Object.keys(errors)[0])?.focus()
        return
      }
    }
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      await adminRequest(`/technicians/${data.id}${skillsOnly ? '/skills' : ''}`, token, {
        method: 'PATCH',
        body: skillsOnly
          ? { skills }
          : { ...form, years_experience: Number(form.years_experience) },
      })
      onSuccess()
    } catch (err) {
      const fields =
        !skillsOnly &&
        Object.fromEntries(
          Object.entries(err.details ?? {}).filter(
            ([key, message]) => Object.hasOwn(form, key) && typeof message === 'string'
          )
        )
      if (fields && Object.keys(fields).length) {
        setFieldErrors(fields)
        errorFieldRef.current = Object.keys(fields)[0]
      } else {
        setError(err.message)
      }
      if (err.status === 401) logout()
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!busy && errorFieldRef.current) {
      formRef.current?.elements.namedItem(errorFieldRef.current)?.focus()
      errorFieldRef.current = null
    }
  }, [busy])
  const update = (key, value) => {
    const inputError = profileInputError(key, value)
    if (inputError) {
      setFieldErrors((old) => ({ ...old, [key]: inputError }))
      return
    }
    const next = { ...form, [key]: value }
    setForm(next)
    setError('')
    setFieldErrors((old) => ({
      ...old,
      [key]: old[key] ? validateTechnicianProfile(next)[key] : '',
    }))
  }
  const validateField = (key) =>
    setFieldErrors((old) => ({ ...old, [key]: validateTechnicianProfile(form)[key] ?? '' }))
  const adjustExperience = (difference) => {
    const current = /^\d+$/.test(form.years_experience) ? Number(form.years_experience) : 0
    update('years_experience', String(Math.min(60, Math.max(0, current + difference))))
  }
  const levels = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']
  return (
    <Dialog
      title={t(skillsOnly ? 'Update technician skills' : 'Update technician')}
      onClose={onClose}
      busy={busy}
    >
      <form ref={formRef} onSubmit={submit} noValidate={!skillsOnly}>
        {skillsOnly ? (
          <>
            {!options ? (
              <p>
                {t('Loading skill options…')}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError('')
                    setRefresh((n) => n + 1)
                  }}
                >
                  {t('Retry')}
                </button>
              </p>
            ) : (
              <>
                {skills.map((skill, index) => (
                  <div className="technician-skill-edit" key={index}>
                    <label>
                      {t('Skill')}
                      <select
                        required
                        value={skill.skill_id}
                        onChange={(e) =>
                          setSkills((old) =>
                            old.map((s, i) =>
                              i === index ? { ...s, skill_id: e.target.value } : s
                            )
                          )
                        }
                      >
                        <option value="">{t('Choose skill')}</option>
                        {options.skills.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('AC brand')}
                      <select
                        value={skill.ac_brand_id || ''}
                        onChange={(e) =>
                          setSkills((old) =>
                            old.map((s, i) =>
                              i === index ? { ...s, ac_brand_id: e.target.value || null } : s
                            )
                          )
                        }
                      >
                        <option value="">{t('All brands')}</option>
                        {options.brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('Level')}
                      <select
                        value={skill.skill_level}
                        onChange={(e) =>
                          setSkills((old) =>
                            old.map((s, i) =>
                              i === index ? { ...s, skill_level: e.target.value } : s
                            )
                          )
                        }
                      >
                        {levels.map((level) => (
                          <option key={level} value={level}>{t(level)}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (data.verification_status === 'VERIFIED' && skills.length === 1) {
                          setError(t('A verified technician must have at least one skill.'))
                          return
                        }
                        setError('')
                        setSkills((old) => old.filter((_, i) => i !== index))
                      }}
                    >
                      {t('Remove')}
                    </button>
                  </div>
                ))}
                {!skills.length && (
                  <p role="status">
                    {data.verification_status === 'VERIFIED'
                      ? t('A verified technician must have at least one skill. Add a skill before saving.')
                      : t('No skills selected.')}
                  </p>
                )}
                <button
                  type="button"
                  disabled={busy || skills.length >= 100}
                  onClick={() =>
                    setSkills((old) => [
                      ...old,
                      { skill_id: '', ac_brand_id: null, skill_level: 'BEGINNER' },
                    ])
                  }
                >
                  + {t('Add skill')}
                </button>
              </>
            )}
          </>
        ) : (
          <div className="technician-edit-fields">
            <label>
              {t('Full name')}
              <input
                name="full_name"
                autoComplete="name"
                required
                maxLength={100}
                value={form.full_name}
                disabled={busy}
                aria-invalid={!!fieldErrors.full_name}
                aria-describedby={fieldErrors.full_name ? 'technician-name-error' : undefined}
                onBlur={() => validateField('full_name')}
                onChange={(e) => update('full_name', e.target.value)}
              />
              {fieldErrors.full_name && (
                <small id="technician-name-error" className="technician-field-error" role="alert">
                  {t(fieldErrors.full_name)}
                </small>
              )}
            </label>
            <label>
              {t('Phone')}
              <input
                name="phone"
                maxLength={10}
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                required
                value={form.phone}
                disabled={busy}
                aria-invalid={!!fieldErrors.phone}
                aria-describedby={fieldErrors.phone ? 'technician-phone-error' : undefined}
                onBlur={() => validateField('phone')}
                onChange={(e) => update('phone', e.target.value)}
              />
              {fieldErrors.phone && (
                <small id="technician-phone-error" className="technician-field-error" role="alert">
                  {t(fieldErrors.phone)}
                </small>
              )}
            </label>
            <label>
              {t('Qualification')}
              <select
                name="qualification_level"
                value={form.qualification_level}
                disabled={busy}
                aria-invalid={!!fieldErrors.qualification_level}
                aria-describedby={
                  fieldErrors.qualification_level ? 'technician-qualification-error' : undefined
                }
                onBlur={() => validateField('qualification_level')}
                onChange={(e) => update('qualification_level', e.target.value)}
              >
                {levels.map((level) => (
                  <option key={level} value={level}>{t(level)}</option>
                ))}
              </select>
              {fieldErrors.qualification_level && (
                <small
                  id="technician-qualification-error"
                  className="technician-field-error"
                  role="alert"
                >
                  {t(fieldErrors.qualification_level)}
                </small>
              )}
            </label>
            <label htmlFor="technician-years-experience">
              {t('Years of experience')}
              <div className="technician-experience-input">
                <button
                  type="button"
                  aria-label={t('Decrease years of experience')}
                  disabled={
                    busy || (form.years_experience !== '' && Number(form.years_experience) <= 0)
                  }
                  onClick={() => adjustExperience(-1)}
                >
                  −
                </button>
                <input
                  id="technician-years-experience"
                  name="years_experience"
                  type="number"
                  required
                  min={0}
                  max={60}
                  step={1}
                  inputMode="numeric"
                  value={form.years_experience}
                  disabled={busy}
                  aria-invalid={!!fieldErrors.years_experience}
                  aria-describedby={
                    fieldErrors.years_experience ? 'technician-experience-error' : undefined
                  }
                  onBlur={() => validateField('years_experience')}
                  onChange={(e) => update('years_experience', e.target.value)}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-'].includes(e.key)) {
                      e.preventDefault()
                      setFieldErrors((old) => ({
                        ...old,
                        years_experience:
                          'Years of experience must be a whole number from 0 to 60.',
                      }))
                    }
                  }}
                />
                <button
                  type="button"
                  aria-label={t('Increase years of experience')}
                  disabled={busy || Number(form.years_experience) >= 60}
                  onClick={() => adjustExperience(1)}
                >
                  +
                </button>
              </div>
              {fieldErrors.years_experience && (
                <small
                  id="technician-experience-error"
                  className="technician-field-error"
                  role="alert"
                >
                  {t(fieldErrors.years_experience)}
                </small>
              )}
            </label>
            <label>
              {t('Biography')}
              <textarea
                name="bio"
                maxLength={2000}
                value={form.bio}
                disabled={busy}
                aria-invalid={!!fieldErrors.bio}
                aria-describedby={fieldErrors.bio ? 'technician-bio-error' : undefined}
                onBlur={() => validateField('bio')}
                onChange={(e) => update('bio', e.target.value)}
              />
              {fieldErrors.bio && (
                <small id="technician-bio-error" className="technician-field-error" role="alert">
                  {t(fieldErrors.bio)}
                </small>
              )}
            </label>
          </div>
        )}
        <TechnicianNotification message={t(error)} onDismiss={setError} danger />
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" disabled={busy || (skillsOnly && !options) || skillRequired}>
            {t(busy ? 'Saving…' : 'Save changes')}
          </button>
        </footer>
      </form>
    </Dialog>
  )
}
