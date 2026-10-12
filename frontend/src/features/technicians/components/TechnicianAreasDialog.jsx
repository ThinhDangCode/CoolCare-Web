import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext.jsx'
import { adminRequest } from '../../management/api/managementApi.js'
import { Dialog } from './TechnicianActions.jsx'
import { TechnicianNotification } from './TechnicianShared.jsx'

export function TechnicianAreasDialog({ data, onClose, onSuccess }) {
  const { token, logout } = useAuth()
  const [areas, setAreas] = useState(() => data.areas.map(({ city, ward }) => ({ city, ward })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [options, setOptions] = useState(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    adminRequest('/technicians/area-options', token, { signal: controller.signal })
      .then(setOptions)
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message)
          if (err.status === 401) logout()
        }
      })
    return () => controller.abort()
  }, [token, logout, refresh])
  const invalidAreas =
    !areas.length || !options || areas.some((area) => !options.wards.includes(area.ward))
  const update = (index, key, value) =>
    setAreas((old) => old.map((area, i) => (i === index ? { ...area, [key]: value } : area)))
  async function submit(event) {
    event.preventDefault()
    if (invalidAreas) {
      setError('Select at least one valid Can Tho service area before saving.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await adminRequest(`/technicians/${data.id}/areas`, token, {
        method: 'PATCH',
        body: { areas: areas.map((area) => ({ city: options.city, ward: area.ward })) },
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
    <Dialog title="Update service areas" busy={busy} onClose={onClose}>
      <form onSubmit={submit}>
        <p>
          Select the Can Tho wards served by {data.full_name}. At least one service area is
          required. Changes apply to future recommendations.
        </p>
        {!options && (
          <p role="status">
            Loading ward options…{' '}
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
        )}
        {areas.map((area, index) => (
          <div className="technician-area-edit" key={index}>
            <label>
              City
              <input value={options?.city || 'Thành phố Cần Thơ'} readOnly />
            </label>
            <label>
              Ward
              <select
                required
                value={area.ward}
                disabled={busy || !options}
                onChange={(e) => update(index, 'ward', e.target.value)}
              >
                <option value="">Choose ward</option>
                {area.ward && options && !options.wards.includes(area.ward) && (
                  <option value={area.ward} disabled>
                    {area.ward} — select a current ward
                  </option>
                )}
                {options?.wards.map((ward) => (
                  <option
                    key={ward}
                    value={ward}
                    disabled={areas.some((other, i) => i !== index && other.ward === ward)}
                  >
                    {ward}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (areas.length === 1) {
                  setError('A technician must have at least one service area.')
                  return
                }
                setError('')
                setAreas((old) => old.filter((_, i) => i !== index))
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {!areas.length && <p role="status">Add at least one service area before saving.</p>}
        <button
          type="button"
          disabled={busy || !options || areas.length >= options.wards.length}
          onClick={() => setAreas((old) => [...old, { city: options.city, ward: '' }])}
        >
          + Add area
        </button>
        <TechnicianNotification message={error} onDismiss={setError} danger />
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || invalidAreas}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      </form>
    </Dialog>
  )
}
