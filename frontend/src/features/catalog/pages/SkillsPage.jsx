import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { useAutoDismiss } from '../../../shared/hooks/useAutoDismiss.js'
import { catalogRequest } from '../api/catalogApi.js'
import { CatalogLayout } from '../components/CatalogLayout.jsx'
import { Modal } from '../components/Modal.jsx'
import { CatalogTrash, CatalogTrashButton } from '../components/CatalogTrash.jsx'
import '../styles/catalog.css'
import './skills.css'
import { nameError } from '../catalogValidation.js'

function SkillIcon({ name, ...props }) {
  const paths = {
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    edit: (
      <>
        <path d="m16 3 5 5L9 20H4v-5Z" />
        <path d="m14 5 5 5" />
      </>
    ),
    power: (
      <>
        <path d="M12 3v8M6 6a9 9 0 1 0 12 0" />
      </>
    ),
    back: <path d="m14 5-7 7 7 7" />,
    next: <path d="m10 5 7 7-7 7" />,
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7Z" />,
    filter: <path d="M3 5h18l-7 8v6l-4-2v-4Z" />,
    sort: (
      <>
        <path d="M5 5v14m-3-3 3 3 3-3M11 5h10M11 10h7M11 15h4" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
  }
  return (
    <svg
      className="skill-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] ?? paths.bolt}
    </svg>
  )
}

function useServices(token) {
  const { logout } = useAuth()
  const [retry, setRetry] = useState(0)
  const key = `${token}:${retry}`
  const [state, setState] = useState({ key: '', items: [], error: '' })
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const items = []
      for (let page = 1; !controller.signal.aborted; page++) {
        const data = await catalogRequest(`/services?limit=100&page=${page}`, token, {
          signal: controller.signal,
        })
        items.push(...data.items)
        if (items.length >= data.total) break
      }
      if (!controller.signal.aborted) setState({ key, items, error: '' })
    }
    load().catch((error) => {
      if (error.name !== 'AbortError') {
        setState({ key, items: [], error: error.message })
        if (error.status === 401) logout()
      }
    })
    return () => controller.abort()
  }, [token, key, logout])
  return { ...state, loading: state.key !== key, reload: () => setRetry((value) => value + 1) }
}

function SkillForm({ row, onCancel, onSaved, onBusyChange }) {
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const services = useServices(token)
  const nameRef = useRef(null)
  const submitting = useRef(false)
  const [values, setValues] = useState({
    name: row?.name ?? '',
    service_id: row?.service_id ?? '',
    is_active: row?.is_active ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [details, setDetails] = useState({})
  useEffect(() => {
    if (details.name && !busy) nameRef.current?.focus()
  }, [details.name, busy])
  const options = services.items.filter(
    (service) => service.is_active || service.id === row?.service_id
  )
  const selectedService = options.find((service) => service.id === values.service_id)
  const unavailable = !services.loading && !services.error && !options.length
  function change(field, value) {
    if (field === 'name' && /\p{N}/u.test(value)) {
      setDetails((current) => ({ ...current, name: t('Skill names cannot contain numbers.') }))
      setError('')
      return
    }
    setValues((current) => ({ ...current, [field]: value }))
    setDetails((current) => ({ ...current, [field]: '' }))
    setError('')
  }
  async function submit(event) {
    event.preventDefault()
    if (submitting.current || services.loading || services.error || unavailable) return
    if (!values.name.trim()) {
      setDetails({ name: t('Enter a skill name.') })
      nameRef.current?.focus()
      return
    }
    if (/\p{N}/u.test(values.name)) {
      setDetails({ name: t('Skill names cannot contain numbers.') })
      nameRef.current?.focus()
      return
    }
    const invalidName = nameError(values.name)
    if (invalidName) {
      setDetails({ name: invalidName })
      nameRef.current?.focus()
      return
    }
    submitting.current = true
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    setDetails({})
    try {
      await catalogRequest(`/skills${row ? `/${row.id}` : ''}`, token, {
        method: row ? 'PATCH' : 'POST',
        body: { ...values, name: values.name.trim() },
      })
      onSaved(row ? 'Skill updated successfully.' : 'Skill created successfully.')
    } catch (err) {
      setError(err.message)
      setDetails(err.details ?? {})
      if (err.details?.name) nameRef.current?.focus()
      if (err.status === 401) logout()
    } finally {
      submitting.current = false
      setBusy(false)
      onBusyChange?.(false)
    }
  }
  return (
    <form
      className={`skill-form ${row ? 'skill-edit-form' : ''}`}
      onSubmit={submit}
      aria-busy={busy}
    >
      {error && (
        <div className="catalog-error" role="alert">
          {error}
        </div>
      )}
      {services.error && (
        <div className="catalog-error" role="alert">
          {services.error}
          <button type="button" onClick={services.reload}>
            {t('Retry')}
          </button>
        </div>
      )}
      {unavailable && (
        <div className="skill-form-hint" role="status">
          {t('Create an active service before adding a skill.')}{' '}
          <Link to="/catalog/services/new">{t('Create service')}</Link>
        </div>
      )}
      <label className="catalog-field" htmlFor="skill-name">
        <span>
          {t('Skill Name')} <em>*</em>
        </span>
        <span className="skill-input-wrap">
          <SkillIcon name="bolt" />
          <input
            ref={nameRef}
            id="skill-name"
            required
            maxLength={100}
            placeholder="e.g. Inverter PCB Diagnostic & Repair"
            value={values.name}
            disabled={busy}
            aria-invalid={!!details.name}
            aria-describedby={details.name ? 'skill-name-error' : undefined}
            onChange={(e) => change('name', e.target.value)}
          />
        </span>
        {details.name && (
          <small id="skill-name-error" className="skill-field-error">
            {details.name}
          </small>
        )}
      </label>
      <label className="catalog-field" htmlFor="skill-service">
        <span>
          {t('Related Service')} <em>*</em>
        </span>
        <select
          id="skill-service"
          required
          value={values.service_id}
          disabled={busy || services.loading || !!services.error || unavailable}
          aria-invalid={!!details.service_id}
          aria-describedby={details.service_id ? 'skill-service-error' : undefined}
          onChange={(e) => change('service_id', e.target.value)}
        >
          <option value="">
            {t(services.loading ? 'Loading services…' : 'Select related service')}
          </option>
          {options.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
              {service.is_active ? '' : ` (${t('Inactive')})`}
            </option>
          ))}
        </select>
        {details.service_id && (
          <small id="skill-service-error" className="skill-field-error">
            {details.service_id}
          </small>
        )}
      </label>
      {!row && options.length > 0 && (
        <div className="skill-suggestions">
          <span>{t('Suggestions')}:</span>
          {options
            .filter((service) => service.is_active)
            .slice(0, 3)
            .map((service) => (
              <button
                type="button"
                key={service.id}
                title={service.name}
                aria-pressed={values.service_id === service.id}
                disabled={busy}
                onClick={() => change('service_id', service.id)}
              >
                {service.name}
              </button>
            ))}
        </div>
      )}
      {row && selectedService && (
        <div className="skill-suggestions">
          <span>{t('Linked')}:</span>
          <span className="skill-linked-service">{selectedService.name}</span>
        </div>
      )}
      <fieldset className="skill-status-field">
        <legend>
          {t('Status')} <em>*</em>
        </legend>
        <div className="skill-status-options">
          {[true, false].map((active) => (
            <label
              key={String(active)}
              className={`${active ? 'active' : 'inactive'} ${values.is_active === active ? 'selected' : ''}`}
            >
              <span className="skill-status-dot" />
              <span className="skill-status-copy">
                <strong>{t(active ? 'Active' : 'Inactive')}</strong>
                {row && (
                  <small>{t(active ? 'Available for assignment' : 'Temporarily suspended')}</small>
                )}
              </span>
              <input
                type="radio"
                name="skill-status"
                value={String(active)}
                checked={values.is_active === active}
                disabled={busy}
                onChange={() => change('is_active', active)}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <footer className="catalog-form-actions">
        <button
          type="button"
          className="catalog-button skill-cancel"
          disabled={busy}
          onClick={onCancel}
        >
          {t('Cancel')}
        </button>
        <button
          className="catalog-button primary"
          disabled={busy || services.loading || !!services.error || unavailable}
        >
          <SkillIcon name="check" />
          {t(busy ? 'Saving…' : row ? 'Save Changes' : 'Create Skill')}
        </button>
      </footer>
    </form>
  )
}

export function SkillsPage() {
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const location = useLocation()
  const services = useServices(token)
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [service, setService] = useState('')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [refresh, setRefresh] = useState(0)
  const query = new URLSearchParams({ search: keyword, status, sort, page, limit })
  if (service) query.set('service_id', service)
  const queryString = query.toString()
  const key = `${token}:${queryString}:${refresh}`
  const [state, setState] = useState({
    key: '',
    data: { items: [], total: 0, counts: { all: 0, active: 0, inactive: 0 } },
    error: '',
  })
  const result = state.data
  const counts = result.counts
  const loading = state.key !== key || search.trim() !== keyword
  const error = state.key === key ? state.error : ''
  const [notice, setNotice] = useState(() => location.state?.skillNotice ?? '')
  const noticeHover = useAutoDismiss(notice, setNotice)
  const [dialog, setDialog] = useState(null)
  const [mutationError, setMutationError] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const close = useCallback(() => {
    setDialog(null)
    setMutationError('')
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const controller = new AbortController()
    catalogRequest(`/skills?${queryString}`, token, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return
        const lastPage = Math.max(1, Math.ceil(data.total / limit))
        if (page > lastPage) {
          setPage(lastPage)
          return
        }
        setState({ key, data, error: '' })
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setState((current) => ({ ...current, key, error: err.message }))
          if (err.status === 401) logout()
        }
      })
    return () => controller.abort()
  }, [token, queryString, key, page, limit, logout])
  function filter(setter, value) {
    setter(value)
    setPage(1)
  }
  function reload() {
    setRefresh((value) => value + 1)
    services.reload()
  }
  function open(type, row) {
    setMutationError('')
    setDialog({ type, row })
  }
  async function toggle() {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setMutationError('')
    try {
      await catalogRequest(`/skills/${dialog.row.id}/status`, token, {
        method: 'PATCH',
        body: { is_active: !dialog.row.is_active },
      })
      setNotice(
        dialog.row.is_active ? 'Skill deactivated successfully.' : 'Skill activated successfully.'
      )
      close()
      setRefresh((value) => value + 1)
    } catch (err) {
      setMutationError(err.message)
      if (err.status === 401) logout()
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const pages = Math.max(1, Math.ceil(result.total / limit))
  const visiblePages = Array.from(new Set([1, page - 1, page, page + 1, pages]))
    .filter((value) => value >= 1 && value <= pages)
    .sort((a, b) => a - b)
  const filtered = keyword || service || status !== 'all'
  return (
    <CatalogLayout
      className="skills-main"
      heading={
        <h1>
          {t('Skills')} <span className="skill-count">{loading ? '…' : counts.all} {t('skills')}</span>
        </h1>
      }
      onRefresh={reload}
      refreshing={loading}
    >
      <section className="catalog-content skills-content">
        {notice && (
          <div className="catalog-notice" role="status" {...noticeHover}>
            <span>
              <SkillIcon name="check" />
              {t(notice)}
            </span>
            <button aria-label={t('Dismiss notification')} onClick={() => setNotice('')}>
              <SkillIcon name="close" />
            </button>
          </div>
        )}
        {error && (
          <div className="catalog-error" role="alert">
            {error}
            <button onClick={reload}>{t('Retry')}</button>
          </div>
        )}
        {services.error && (
          <div className="catalog-error" role="alert">
            {services.error}
            <button onClick={services.reload}>{t('Retry services')}</button>
          </div>
        )}
        <div className="skill-toolbar">
          <div className="skill-tabs" role="group" aria-label={t('Filter by status')}>
            {[
              ['all', 'All'],
              ['active', 'Active'],
              ['inactive', 'Inactive'],
            ].map(([value, text]) => (
              <button
                key={value}
                aria-pressed={status === value}
                className={status === value ? 'selected' : ''}
                onClick={() => filter(setStatus, value)}
              >
                {t(text)}
                <span>{loading ? '…' : counts[value]}</span>
              </button>
            ))}
          </div>
          <label className="catalog-search">
            <SkillIcon name="search" />
            <input
              aria-label={t('Search skills')}
              placeholder={t('Search skill, service, code…')}
              maxLength={150}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" aria-label={t('Clear search')} onClick={() => setSearch('')}>
                <SkillIcon name="close" />
              </button>
            )}
          </label>
          <label className="skill-select">
            <SkillIcon name="filter" />
            <select
              aria-label={t('Filter by service')}
              value={service}
              disabled={services.loading || !!services.error}
              onChange={(e) => filter(setService, e.target.value)}
            >
              <option value="">{t('All services')}</option>
              {services.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.is_active ? '' : ` (${t('Inactive')})`}
                </option>
              ))}
            </select>
          </label>
          <label className="skill-select skill-sort">
            <SkillIcon name="sort" />
            <select
              aria-label={t('Sort skills')}
              value={sort}
              onChange={(e) => filter(setSort, e.target.value)}
            >
              <option value="newest">{t('Newest')}</option>
              <option value="oldest">{t('Oldest')}</option>
              <option value="name">{t('Name A–Z')}</option>
            </select>
          </label>
          <CatalogTrash kind="skills" onChanged={reload} />
          <Link className="catalog-button primary skill-add" to="/catalog/skills/new">
            <SkillIcon name="plus" />{t('Add Skill')}
          </Link>
        </div>
        <div className="catalog-panel skill-list-panel" aria-busy={loading}>
          <div className="catalog-table-scroll">
            <table className="catalog-table skill-table">
              <caption className="skill-sr-only">
                {t('Technical skills and their linked services')}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t('CODE')}</th>
                  <th scope="col">{t('SKILL NAME')}</th>
                  <th scope="col">{t('APPLICABLE SERVICE')}</th>
                  <th scope="col" className="catalog-numeric">{t('TECHNICIANS')}</th>
                  <th scope="col">{t('STATUS')}</th>
                  <th scope="col" className="catalog-actions-title">
                    {t('ACTIONS')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="catalog-state" role="status">
                        <span className="catalog-spinner" />
                        {t('Loading skills…')}
                      </div>
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="catalog-state">
                        <strong>{t('Unable to load skills')}</strong>
                        <p>{t('Please try again.')}</p>
                        <button className="catalog-button" onClick={reload}>
                          {t('Retry')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : !result.items.length ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="catalog-state">
                        <span className="skill-empty-icon">
                          <SkillIcon name="bolt" />
                        </span>
                        <strong>{t('No skills found')}</strong>
                        <p>
                          {filtered
                            ? t('Try another search or reset your filters.')
                            : t('Add your first technical skill to get started.')}
                        </p>
                        {filtered ? (
                          <button
                            className="catalog-button"
                            onClick={() => {
                              setSearch('')
                              setKeyword('')
                              setStatus('all')
                              setService('')
                              setPage(1)
                            }}
                          >
                            {t('Reset filters')}
                          </button>
                        ) : (
                          <Link className="catalog-button primary" to="/catalog/skills/new">
                            <SkillIcon name="plus" />
                            {t('Add Skill')}
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  result.items.map((row) => (
                    <tr key={row.id} className={row.is_active ? '' : 'skill-inactive-row'}>
                      <td className="skill-code" title={row.id}>
                        #{row.code}
                      </td>
                      <td className="skill-name">
                        <strong>{row.name}</strong>
                      </td>
                      <td>
                        <span className="skill-service-tag" title={row.service_name}>
                          {row.service_name}
                        </span>
                        {!row.service_is_active && (
                          <small className="skill-service-inactive">{t('Inactive service')}</small>
                        )}
                      </td>
                      <td className="catalog-numeric">
                        <span
                          className="skill-technician-count"
                          title={t('{count} assigned technicians', { count: row.technician_count })}
                        >
                          {row.technician_count}
                        </span>
                      </td>
                      <td>
                        <span className={`catalog-status ${row.is_active ? 'active' : 'inactive'}`}>
                          <i />
                          {t(row.is_active ? 'Active' : 'Inactive')}
                        </span>
                      </td>
                      <td>
                        <div className="catalog-row-actions">
                          <button
                            aria-label={`${t('Edit')} ${row.name}`}
                            title={t('Edit Skill')}
                            onClick={() => open('edit', row)}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            title={t('Record details')}
                            aria-label={`${t('View details')}: ${row.name}`}
                            onClick={() => open('details', row)}
                          >
                            ◷
                          </button>
                          <CatalogTrashButton kind="skills" row={row} onChanged={reload} />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <footer className="catalog-pagination skill-pagination">
            <span>
              {loading ? (
                t('Loading…')
              ) : error ? (
                t('Skills unavailable')
              ) : (
                <>
                  {t('Showing')}{' '}
                  <strong>
                    {result.total ? (page - 1) * limit + 1 : 0}–
                    {Math.min(page * limit, result.total)}
                  </strong>{' '}
                  {t('of')} <strong>{result.total}</strong> {t('skills')}
                </>
              )}
            </span>
            <div>
              <label>
                {t('Show')}:{' '}
                <select
                  aria-label={t('Rows per page')}
                  value={limit}
                  onChange={(e) => filter(setLimit, Number(e.target.value))}
                >
                  {[10, 25, 50].map((value) => (
                    <option key={value} value={value}>
                      {value} / {t('page')}
                    </option>
                  ))}
                </select>
              </label>
              <nav aria-label={t('Skills pagination')}>
                <button
                  aria-label={t('Previous page')}
                  disabled={loading || !!error || page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  <SkillIcon name="back" />
                </button>
                {visiblePages.map((value, index) => (
                  <span className="skill-page-item" key={value}>
                    {index > 0 && value - visiblePages[index - 1] > 1 && (
                      <span className="skill-page-gap">…</span>
                    )}
                    <button
                      aria-label={`${t('Page')} ${value}`}
                      aria-current={page === value ? 'page' : undefined}
                      className={page === value ? 'selected' : ''}
                      disabled={loading || !!error}
                      onClick={() => setPage(value)}
                    >
                      {value}
                    </button>
                  </span>
                ))}
                <button
                  aria-label={t('Next page')}
                  disabled={loading || !!error || page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  <SkillIcon name="next" />
                </button>
              </nav>
            </div>
          </footer>
        </div>
      </section>
      {dialog?.type === 'edit' && (
        <Modal
          title={t('Edit Skill')}
          subtitle={`#${dialog.row.code}`}
          icon={<SkillIcon name="bolt" />}
          className="skill-modal"
          onClose={close}
          busy={busy}
        >
          <SkillForm
            row={dialog.row}
            onCancel={close}
            onBusyChange={setBusy}
            onSaved={(message) => {
              close()
              setNotice(message)
              setRefresh((value) => value + 1)
            }}
          />
        </Modal>
      )}
      {dialog?.type === 'details' && (
        <Modal title={`${t('Record details')} · ${dialog.row.name}`} onClose={close}>
          <dl className="catalog-record-details">
            <dt>{t('Skill code')}</dt>
            <dd>{dialog.row.code}</dd>
            <dt>{t('Service')}</dt>
            <dd>{dialog.row.service_name || '—'}</dd>
            <dt>{t('Assigned technicians')}</dt>
            <dd>{dialog.row.technician_count ?? 0}</dd>
            <dt>{t('Created')}</dt>
            <dd>{dialog.row.created_at ? new Date(dialog.row.created_at).toLocaleString('vi-VN') : '—'}</dd>
            <dt>{t('Last updated')}</dt>
            <dd>{dialog.row.updated_at ? new Date(dialog.row.updated_at).toLocaleString('vi-VN') : '—'}</dd>
            <dt>{t('Status')}</dt>
            <dd>{t(dialog.row.is_active ? 'Active' : 'Inactive')}</dd>
          </dl>
        </Modal>
      )}
      {dialog?.type === 'toggle' && (
        <Modal
          title={`${t(dialog.row.is_active ? 'Deactivate' : 'Activate')} ${t('Skill')}?`}
          subtitle={`#${dialog.row.code}`}
          icon={<SkillIcon name="power" />}
          className="skill-modal skill-confirm-modal"
          onClose={close}
          busy={busy}
        >
          <div className="catalog-confirm">
            <p>
              {t(dialog.row.is_active ? 'Deactivate' : 'Activate')} <strong>{dialog.row.name}</strong>?
            </p>
            <p>
              {dialog.row.is_active
                ? t('This skill will no longer be available for new technician assignments.')
                : t('This skill will be available for new technician assignments.')}{' '}
              {t('Existing assignments and history will be preserved.')}
            </p>
            {mutationError && (
              <div className="catalog-error" role="alert">
                {mutationError}
              </div>
            )}
          </div>
          <footer className="catalog-form-actions">
            <button className="catalog-button" disabled={busy} onClick={close}>
              {t('Cancel')}
            </button>
            <button className="catalog-button primary" disabled={busy} onClick={toggle}>
              {t(busy ? 'Saving…' : dialog.row.is_active ? 'Deactivate Skill' : 'Activate Skill')}
            </button>
          </footer>
        </Modal>
      )}
    </CatalogLayout>
  )
}

export function CreateSkillPage() {
  const navigate = useNavigate()
  const { t } = useUiPreferences()
  const [busy, setBusy] = useState(false)
  const cancel = () => navigate('/catalog/skills')
  return (
    <CatalogLayout
      className="skills-main"
      heading={
        <>
          <button
            className="skill-back-button"
            aria-label={t('Back to skills')}
            disabled={busy}
            onClick={cancel}
          >
            <SkillIcon name="back" />
          </button>
          <h1>
            {t('Create Skill')} <span className="skill-new">{t('New')}</span>
          </h1>
        </>
      }
    >
      <section className="catalog-content skills-content">
        <div className="skill-create-wrap">
          <nav className="catalog-breadcrumb" aria-label={t('Breadcrumb')}>
            <Link to="/catalog/skills">
              <SkillIcon name="back" />
              {t('Skills')}
            </Link>
            <span>/</span>
            <Link to="/catalog/services">{t('Service')}</Link>
            <span>/</span>
            <Link to="/catalog/skills">{t('Skill Management')}</Link>
            <span>/</span>
            <span aria-current="page">{t('Create Skill')}</span>
          </nav>
          <div className="catalog-panel skill-create-panel">
            <header>
              <span className="catalog-heading-icon">
                <SkillIcon name="plus" />
              </span>
              <div>
                <strong>{t('Skill Information')}</strong>
                <small>{t('Configure skill identity and mapped service')}</small>
              </div>
            </header>
            <SkillForm
              onCancel={cancel}
              onBusyChange={setBusy}
              onSaved={(message) =>
                navigate('/catalog/skills', { state: { skillNotice: message } })
              }
            />
          </div>
        </div>
      </section>
    </CatalogLayout>
  )
}
