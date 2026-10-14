import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import './technicianActions.css'
import { TechnicianNotification } from './TechnicianShared.jsx'

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
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const approve = target.status === 'VERIFIED'
  async function submit(event) {
    event.preventDefault()
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
      title={`${approve ? 'Approve' : 'Reject'} ${target.kind || 'profile'}?`}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <p>{target.name}</p>
        <p>
          {approve
            ? 'Confirm that you have checked the submitted identity or certificate documents.'
            : 'Provide a reason so the technician knows what needs to be corrected.'}
        </p>
        {!approve && (
          <label>
            Rejection reason
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
        <TechnicianNotification message={error} onDismiss={setError} danger />
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className={approve ? 'primary' : 'danger'} disabled={busy}>
            {busy ? 'Saving…' : approve ? 'Approve' : 'Reject'}
          </button>
        </footer>
      </form>
    </Dialog>
  )
}
export function DeactivateDialog({ data, activate = false, onClose, onSuccess }) {
  const { token, logout } = useAuth()
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
      title={activate ? 'Activate technician?' : 'Deactivate technician?'}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit}>
        <p>
          {activate ? 'Activate' : 'Deactivate'} <strong>{data.full_name}</strong>?{' '}
          {activate
            ? 'Restore account access. New jobs still require a verified profile, availability and wallet eligibility.'
            : 'This disables sign-in and new job assignments. Existing job history will be preserved.'}
        </p>
        <TechnicianNotification message={error} onDismiss={setError} danger />
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className={activate ? 'primary' : 'danger'} disabled={busy}>
            {busy ? 'Saving…' : activate ? 'Activate' : 'Deactivate'}
          </button>
        </footer>
      </form>
    </Dialog>
  )
}
export function EditTechnicianDialog({ data, skillsOnly = false, onClose, onSuccess }) {
  const { token, logout } = useAuth()
  const [form, setForm] = useState({
    full_name: data.full_name,
    phone: data.phone || '',
    qualification_level: data.qualification_level,
    years_experience: data.years_experience,
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
    if (skillRequired) {
      setError('A verified technician must have at least one skill.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await adminRequest(`/technicians/${data.id}${skillsOnly ? '/skills' : ''}`, token, {
        method: 'PATCH',
        body: skillsOnly ? { skills } : form,
      })
      onSuccess()
    } catch (err) {
      setError(err.message)
      if (err.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }
  const update = (key, value) => setForm((old) => ({ ...old, [key]: value }))
  const levels = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']
  return (
    <Dialog
      title={skillsOnly ? 'Update technician skills' : 'Update technician'}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit}>
        {skillsOnly ? (
          <>
            {!options ? (
              <p>
                Loading skill options…{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError('')
                    setRefresh((n) => n + 1)
                  }}
                >
                  Retry
                </button>
              </p>
            ) : (
              <>
                {skills.map((skill, index) => (
                  <div className="technician-skill-edit" key={index}>
                    <label>
                      Skill
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
                        <option value="">Choose skill</option>
                        {options.skills.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      AC brand
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
                        <option value="">All brands</option>
                        {options.brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Level
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
                          <option key={level}>{level}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (data.verification_status === 'VERIFIED' && skills.length === 1) {
                          setError('A verified technician must have at least one skill.')
                          return
                        }
                        setError('')
                        setSkills((old) => old.filter((_, i) => i !== index))
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {!skills.length && (
                  <p role="status">{data.verification_status === 'VERIFIED' ? 'A verified technician must have at least one skill. Add a skill before saving.' : 'No skills selected.'}</p>
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
                  + Add skill
                </button>
              </>
            )}
          </>
        ) : (
          <div className="technician-edit-fields">
            <label>
              Full name
              <input
                required
                maxLength={100}
                value={form.full_name}
                onChange={(e) => update('full_name', e.target.value)}
              />
            </label>
            <label>
              Phone
              <input
                required
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
              />
            </label>
            <label>
              Qualification
              <select
                value={form.qualification_level}
                onChange={(e) => update('qualification_level', e.target.value)}
              >
                {levels.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
            <label>
              Years of experience
              <input
                type="number"
                required
                min={0}
                max={80}
                value={form.years_experience}
                onChange={(e) => update('years_experience', Number(e.target.value))}
              />
            </label>
            <label>
              Biography
              <textarea
                maxLength={2000}
                value={form.bio}
                onChange={(e) => update('bio', e.target.value)}
              />
            </label>
          </div>
        )}
        <TechnicianNotification message={error} onDismiss={setError} danger />
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || (skillsOnly && !options) || skillRequired}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      </form>
    </Dialog>
  )
}
