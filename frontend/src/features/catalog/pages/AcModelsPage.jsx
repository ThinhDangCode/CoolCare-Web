import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useAutoDismiss } from '../../../shared/hooks/useAutoDismiss.js'
import { catalogRequest } from '../api/catalogApi.js'
import { CatalogLayout } from '../components/CatalogLayout.jsx'
import { Modal } from '../components/Modal.jsx'
import { CatalogTrash, CatalogTrashButton } from '../components/CatalogTrash.jsx'
import '../styles/catalog.css'
import './models.css'
import { modelNameError, numberError } from '../catalogValidation.js'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'

const types = [
  ['WALL_MOUNTED', 'Wall mounted', '▱'],
  ['CEILING_CASSETTE', 'Ceiling cassette', '▦'],
  ['CEILING_SUSPENDED', 'Ceiling suspended', '▤'],
  ['FLOOR_STANDING', 'Floor standing', '▯'],
  ['DUCTED', 'Ducted', '▥'],
  ['PORTABLE', 'Portable', '▣'],
  ['WINDOW', 'Window', '⊞'],
]
const typeLabel = (value) => types.find(([code]) => code === value)?.[1] ?? value ?? '—'
const btuLabel = (value) =>
  value == null ? '—' : `${new Intl.NumberFormat('en-US').format(value)} BTU`
const initialFilters = {
  brand_id: '',
  ac_type: '',
  capacity_btu: '',
  inverter: '',
  status: 'all',
  sort: 'NEWEST',
}

function ModelIcon({ name }) {
  const paths = {
    plus: <path d="M12 5v14M5 12h14" />,
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
    more: (
      <>
        <circle cx="12" cy="5" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="12" cy="19" r="1" />
      </>
    ),
  }
  return (
    <svg
      className="models-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

function useBrands(token) {
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const { logout } = useAuth()
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const rows = []
      let page = 1
      while (!controller.signal.aborted) {
        const data = await catalogRequest(`/brands?limit=100&page=${page}`, token, {
          signal: controller.signal,
        })
        rows.push(...data.items)
        if (rows.length >= data.total) break
        page++
      }
      if (!controller.signal.aborted) {
        setBrands(rows)
        setLoading(false)
        setError('')
      }
    }
    load().catch((error) => {
      if (error.name === 'AbortError') return
      setError(error.message)
      setLoading(false)
      if (error.status === 401) logout()
    })
    return () => controller.abort()
  }, [token, retry, logout])
  return {
    brands,
    loading,
    error,
    reload: () => {
      setLoading(true)
      setRetry((value) => value + 1)
    },
  }
}

export function AcModelsPage() {
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const brandOptions = useBrands(token)
  const [search, setSearch] = useState('')
  const [querySearch, setQuerySearch] = useState('')
  const [filters, setFilters] = useState(initialFilters)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [counts, setCounts] = useState(null)
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const noticeHover = useAutoDismiss(notice, setNotice)
  const [refresh, setRefresh] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState('')
  const close = useCallback(() => {
    setDialog(null)
    setMutationError('')
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuerySearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ page, limit, search: querySearch })
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== '') query.set(key, value)
    })
    catalogRequest(`/models?${query}`, token, { signal: controller.signal })
      .then((result) => {
        if (page > 1 && page > Math.max(1, Math.ceil(result.total / limit))) {
          setPage(Math.max(1, Math.ceil(result.total / limit)))
          return
        }
        setData(result)
        setLoading(false)
        setError('')
      })
      .catch((error) => {
        if (error.name === 'AbortError') return
        setError(error.message)
        setLoading(false)
        if (error.status === 401) logout()
      })
    return () => controller.abort()
  }, [token, querySearch, filters, page, limit, refresh, logout])
  const filter = (key, value) => {
    if (filters[key] === value) return
    setLoading(true)
    setPage(1)
    setFilters((current) => ({ ...current, [key]: value }))
  }
  const reload = () => {
    setLoading(true)
    setRefresh((value) => value + 1)
  }
  const open = (type, row) => {
    setMutationError('')
    setDialog({ type, row })
  }
  async function changeStatus() {
    setBusy(true)
    setMutationError('')
    try {
      await catalogRequest(`/models/${dialog.row.id}/status`, token, {
        method: 'PATCH',
        body: { is_active: !dialog.row.is_active },
      })
      setNotice(
        dialog.row.is_active
          ? 'Đã vô hiệu hóa model. Booking lịch sử được giữ nguyên.'
          : 'Đã kích hoạt model.'
      )
      close()
      reload()
    } catch (error) {
      setMutationError(error.message)
      if (error.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    const controller = new AbortController()
    Promise.all(
      ['all', 'active', 'inactive'].map((status) =>
        catalogRequest('/models?limit=1&status=' + status, token, {
          signal: controller.signal,
        }).then((result) => result.total)
      )
    )
      .then(([all, active, inactive]) => {
        if (!controller.signal.aborted) setCounts({ all, active, inactive })
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setCounts(null)
          if (error.status === 401) logout()
        }
      })
    return () => controller.abort()
  }, [token, refresh, logout])
  const totalPages = Math.max(1, Math.ceil(data.total / limit))
  const pages = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((value) => value > 0 && value <= totalPages)
    .sort((a, b) => a - b)
  function goToPage(value) {
    if (page === value) return
    setPage(value)
    setLoading(true)
  }
  return (
    <CatalogLayout
      className="models-main"
      heading={
        <h1>
          {t('AC Models')} <span className="models-count">{counts?.all ?? '…'} {t('models')}</span>
        </h1>
      }
      onRefresh={reload}
      refreshing={loading}
    >
      <section className="models-content">
        {notice && (
          <div className="catalog-notice" role="status" {...noticeHover}>
            {notice}
            <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}
        {error && (
          <div className="catalog-error" role="alert">
            {error}
            <button onClick={reload}>Retry</button>
          </div>
        )}
        {brandOptions.error && (
          <div className="catalog-error" role="alert">
            {brandOptions.error}
            <button onClick={brandOptions.reload}>Retry brands</button>
          </div>
        )}
        <div className="models-toolbar">
          <div className="models-tabs" role="group" aria-label="Model status">
            {[
              ['all', 'All'],
              ['active', 'Active'],
              ['inactive', 'Inactive'],
            ].map(([status, label]) => (
              <button
                key={status}
                type="button"
                aria-pressed={filters.status === status}
                className={filters.status === status ? 'selected' : ''}
                onClick={() => filter('status', status)}
              >
                {t(label)} <span>{counts?.[status] ?? '…'}</span>
              </button>
            ))}
          </div>
          <div className="models-toolbar-actions">
            <CatalogTrash kind="models" onChanged={reload} />
            <Link className="catalog-button primary" to="/catalog/models/new">
              <ModelIcon name="plus" /> {t('Add AC Model')}
            </Link>
          </div>
          <div className="models-filters">
            <label className="models-search">
              <ModelIcon name="search" />
              <input
                aria-label="Search AC models"
                placeholder={t('Search model name…')}
                value={search}
                maxLength={150}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setLoading(true)
                }}
              />
            </label>
            <select
              aria-label="Filter by brand"
              value={filters.brand_id}
              disabled={brandOptions.loading}
              onChange={(event) => filter('brand_id', event.target.value)}
            >
              <option value="">{t('All brands')}</option>
              {brandOptions.brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by AC type"
              value={filters.ac_type}
              onChange={(event) => filter('ac_type', event.target.value)}
            >
              <option value="">{t('All AC types')}</option>
              {types.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <input
              aria-label="Filter by cooling capacity in BTU"
              type="number"
              min="1"
              max="2147483647"
              step="1"
              placeholder={t('All BTU')}
              value={filters.capacity_btu}
              onChange={(event) => filter('capacity_btu', event.target.value)}
            />
            <select
              aria-label="Filter by inverter technology"
              value={filters.inverter}
              onChange={(event) => filter('inverter', event.target.value)}
            >
              <option value="">{t('All inverter')}</option>
              <option value="true">Inverter</option>
              <option value="false">Non-inverter</option>
            </select>
            <select
              aria-label="Sort models"
              value={filters.sort}
              onChange={(event) => filter('sort', event.target.value)}
            >
              <option value="NEWEST">{t('Newest')}</option>
              <option value="OLDEST">{t('Oldest')}</option>
              <option value="NAME_ASC">{t('Name A–Z')}</option>
              <option value="NAME_DESC">{t('Name Z–A')}</option>
              <option value="CAPACITY_ASC">{t('BTU low to high')}</option>
              <option value="CAPACITY_DESC">{t('BTU high to low')}</option>
            </select>
            <button
              type="button"
              className="catalog-button"
              onClick={() => {
                setSearch('')
                setQuerySearch('')
                setFilters(initialFilters)
                setPage(1)
                setLoading(true)
              }}
            >
              {t('Reset filters')}
            </button>
          </div>
        </div>
        <div className="models-table-wrap">
          <table className="models-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t('MODEL NAME')}</th>
                <th>{t('BRAND')}</th>
                <th>{t('AC TYPE')}</th>
                <th>{t('CAPACITY')}</th>
                <th>{t('INVERTER')}</th>
                <th>{t('STATUS')}</th>
                <th>{t('ACTIONS')}</th>
              </tr>
            </thead>
            <tbody>
              {loading || error || !data.items.length ? (
                <tr>
                  <td colSpan={8}>
                    <div className="catalog-state" role="status">
                      {loading ? (
                        <>
                          <span className="catalog-spinner" />
                          {t('Loading models…')}
                        </>
                      ) : error ? (
                        'Models unavailable. Please retry.'
                      ) : (
                        t('Try changing the filters or add a new model.')
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                data.items.map((row) => (
                  <tr key={row.id}>
                    <td className="models-id" title={row.id}>
                      #MD{row.id.split('-')[0].toUpperCase()}
                    </td>
                    <td>
                      <strong>{row.model_name}</strong>
                    </td>
                    <td>{row.brand_name}</td>
                    <td>{typeLabel(row.ac_type)}</td>
                    <td>{btuLabel(row.capacity_btu)}</td>
                    <td>{row.inverter == null ? '—' : row.inverter ? 'Inverter' : 'Non-inverter'}</td>
                    <td>
                      <span className={`catalog-status ${row.is_active ? 'active' : 'inactive'}`}>
                        <i />
                        {t(row.is_active ? 'Active' : 'Inactive')}
                      </span>
                    </td>
                    <td>
                      <div className="catalog-row-actions">
                        <button
                          type="button"
                          aria-label={'Edit ' + row.model_name}
                          title="Edit model"
                          onClick={() => open('edit', row)}
                        >
                          ✎
                        </button>
                        <button type="button" title="Record details" aria-label={`View details of ${row.model_name}`} onClick={() => open('details', row)}>◷</button>
                        <CatalogTrashButton kind="models" row={row} onChanged={reload} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <footer className="models-pagination">
          <span>
            {loading ? (
              'Loading…'
            ) : error ? (
              'Models unavailable'
            ) : (
              <>
                Showing{' '}
                <strong>
                  {data.total ? (page - 1) * limit + 1 : 0}-{Math.min(page * limit, data.total)}
                </strong>{' '}
                of <strong>{data.total}</strong> models
              </>
            )}
          </span>
          <div>
            <label>
              Rows:{' '}
              <select
                aria-label="Rows per page"
                value={limit}
                onChange={(event) => {
                  setLimit(Number(event.target.value))
                  goToPage(1)
                }}
              >
                {[10, 25, 50].map((value) => (
                  <option key={value} value={value}>
                    {value} / page
                  </option>
                ))}
              </select>
            </label>
            <nav aria-label="Models pagination">
              <button
                aria-label="Previous page"
                disabled={loading || !!error || page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                ‹
              </button>
              {pages.map((value, index) => (
                <span key={value}>
                  {index > 0 && value - pages[index - 1] > 1 && (
                    <span className="models-page-gap">…</span>
                  )}
                  <button
                    aria-label={'Page ' + value}
                    aria-current={page === value ? 'page' : undefined}
                    disabled={loading || !!error}
                    onClick={() => goToPage(value)}
                  >
                    {value}
                  </button>
                </span>
              ))}
              <button
                aria-label="Next page"
                disabled={loading || !!error || page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                ›
              </button>
            </nav>
          </div>
        </footer>
      </section>
      {dialog?.type === 'edit' && (
        <Modal title="Edit AC Model" onClose={close} busy={busy}>
          <AcModelForm
            row={dialog.row}
            onCancel={close}
            onBusyChange={setBusy}
            onSaved={() => {
              close()
              setNotice('Đã cập nhật model.')
              reload()
            }}
          />
        </Modal>
      )}
      {dialog?.type === 'status' && (
        <Modal
          title={dialog.row.is_active ? 'Deactivate AC Model?' : 'Activate AC Model?'}
          onClose={close}
          busy={busy}
          danger
        >
          <div className="catalog-confirm">
            <p>
              {dialog.row.is_active ? (
                <>
                  Deactivate <strong>{dialog.row.model_name}</strong>? This model will no longer be
                  available for selection. Existing bookings and their references will be preserved.
                </>
              ) : (
                <>
                  Make <strong>{dialog.row.model_name}</strong> active again?
                </>
              )}
            </p>
            {mutationError && (
              <div className="catalog-error" role="alert">
                {mutationError}
              </div>
            )}
          </div>
          <footer className="catalog-form-actions">
            <button className="catalog-button" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button
              className={`catalog-button ${dialog.row.is_active ? 'danger' : 'primary'}`}
              disabled={busy}
              onClick={changeStatus}
            >
              {busy ? 'Saving…' : dialog.row.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </footer>
        </Modal>
      )}
      {dialog?.type === 'details' && (
        <Modal title={dialog.row.model_name} onClose={close}>
          <dl className="catalog-record-details">
            <dt>Cooling capacity</dt>
            <dd>{btuLabel(dialog.row.capacity_btu)}</dd>
            <dt>Inverter technology</dt>
            <dd>{dialog.row.inverter ? 'Inverter' : 'Non-inverter'}</dd>
            <dt>Description</dt>
            <dd>{dialog.row.description || '—'}</dd>
            <dt>Created</dt>
            <dd>{new Date(dialog.row.created_at).toLocaleString('vi-VN')}</dd>
            <dt>Last updated</dt>
            <dd>{new Date(dialog.row.updated_at).toLocaleString('vi-VN')}</dd>
          </dl>
        </Modal>
      )}
    </CatalogLayout>
  )
}

function AcModelForm({ row, onCancel, onSaved, onBusyChange }) {
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const options = useBrands(token)
  const [values, setValues] = useState(() => ({
    model_name: row?.model_name ?? '',
    brand_id: row?.brand_id ?? '',
    ac_type: row?.ac_type ?? 'WALL_MOUNTED',
    capacity_btu: row?.capacity_btu ?? '',
    inverter: row?.inverter == null ? '' : String(row.inverter),
    description: row?.description ?? '',
    is_active: row?.is_active ?? true,
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errors, setErrors] = useState({})
  const change = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }
  const validation = (key) =>
    errors[key] && (
      <small className="catalog-field-error" id={`model-${key}-error`}>
        {errors[key]}
      </small>
    )
  async function submit(event) {
    event.preventDefault()
    if (busy || options.loading || options.error) return
    const fieldErrors = {
      model_name: modelNameError(values.model_name),
      capacity_btu: numberError(values.capacity_btu, { max: 2147483647 }),
      brand_id: options.brands.some((brand) => brand.id === values.brand_id)
        ? ''
        : 'Choose a valid brand.',
    }
    if (Object.values(fieldErrors).some(Boolean)) {
      setErrors(fieldErrors)
      return
    }
    if (
      !values.model_name.trim() ||
      !values.brand_id ||
      !values.ac_type ||
      values.inverter === '' ||
      !Number.isInteger(Number(values.capacity_btu)) ||
      Number(values.capacity_btu) <= 0
    ) {
      setError('Vui lòng nhập đầy đủ tên, hãng, loại máy, BTU và inverter hợp lệ.')
      return
    }
    const body = {
      ...values,
      model_name: values.model_name.trim(),
      capacity_btu: Number(values.capacity_btu),
      inverter: values.inverter === 'true',
      description: values.description.trim() || null,
    }
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    setErrors({})
    try {
      await catalogRequest(`/models${row ? `/${row.id}` : ''}`, token, {
        method: row ? 'PATCH' : 'POST',
        body,
      })
      onSaved()
    } catch (error) {
      setError(error.message)
      setErrors(error.details ?? {})
      if (error.status === 401) logout()
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }
  return (
    <form className={`catalog-form model-form ${row ? 'model-edit-form' : ''}`} onSubmit={submit}>
      <div className="catalog-form-body">
        <p className="catalog-form-intro">
          {row
            ? 'Update model specifications and operational status.'
            : 'Define a model and its specifications for your AC catalog.'}
        </p>
        {error && (
          <div className="catalog-error" role="alert">
            {error}
          </div>
        )}
        {options.error && (
          <div className="catalog-error" role="alert">
            {options.error}
            <button type="button" onClick={options.reload}>
              Retry brands
            </button>
          </div>
        )}
        <div className="model-form-columns">
          <div>
            <div className="catalog-form-section-label">MODEL IDENTIFICATION</div>
            <div className="catalog-form-grid">
              <label className="catalog-field">
                <span>
                  Model name <em>*</em>
                </span>
                <input
                  name="model_name"
                  value={values.model_name}
                  maxLength={100}
                  required
                  disabled={busy}
                  placeholder="Enter model name"
                  aria-invalid={Boolean(errors.model_name)}
                  onChange={(event) => change('model_name', event.target.value)}
                />
                {validation('model_name')}
              </label>
              <label className="catalog-field">
                <span>
                  AC brand <em>*</em>
                </span>
                <select
                  name="brand_id"
                  required
                  value={values.brand_id}
                  disabled={busy || options.loading}
                  aria-invalid={Boolean(errors.brand_id)}
                  onChange={(event) => change('brand_id', event.target.value)}
                >
                  <option value="">{options.loading ? 'Loading brands…' : 'Select brand'}</option>
                  {options.brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                      {brand.is_active ? '' : ' (Inactive)'}
                    </option>
                  ))}
                </select>
                {validation('brand_id')}
                {!options.loading && !options.error && !options.brands.length && (
                  <small>
                    No brands available. <Link to="/catalog/brands/new">Create an AC brand</Link>{' '}
                    first.
                  </small>
                )}
              </label>
            </div>
            <div className="catalog-form-section-label">TECHNICAL SPECIFICATIONS</div>
            <div className="catalog-form-grid">
              <label className="catalog-field">
                <span>
                  Cooling capacity (BTU) <em>*</em>
                </span>
                <input
                  name="capacity_btu"
                  type="number"
                  min="1"
                  max="2147483647"
                  step="1"
                  list="model-btu-options"
                  value={values.capacity_btu}
                  required
                  disabled={busy}
                  placeholder="e.g. 12000"
                  aria-invalid={Boolean(errors.capacity_btu)}
                  onChange={(event) => change('capacity_btu', event.target.value)}
                />
                <datalist id="model-btu-options">
                  {[9000, 12000, 18000, 24000, 36000, 48000].map((btu) => (
                    <option key={btu} value={btu} />
                  ))}
                </datalist>
                {validation('capacity_btu')}
              </label>
              <label className="catalog-field">
                <span>
                  Inverter technology <em>*</em>
                </span>
                <select
                  name="inverter"
                  required
                  value={values.inverter}
                  disabled={busy}
                  aria-invalid={Boolean(errors.inverter)}
                  onChange={(event) => change('inverter', event.target.value)}
                >
                  <option value="">Select technology</option>
                  <option value="true">Inverter</option>
                  <option value="false">Non-inverter</option>
                </select>
                {validation('inverter')}
              </label>
            </div>
            <fieldset className="model-types" disabled={busy}>
              <legend>
                AC type <em>*</em>
              </legend>
              <div>
                {types.map(([code, label, icon]) => (
                  <label key={code} className={values.ac_type === code ? 'selected' : ''}>
                    <input
                      type="radio"
                      name="ac_type"
                      value={code}
                      checked={values.ac_type === code}
                      required
                      onChange={() => change('ac_type', code)}
                    />
                    <span>{icon}</span>
                    <strong>{label}</strong>
                  </label>
                ))}
              </div>
              {validation('ac_type')}
            </fieldset>
            <label className="catalog-field">
              <span>Description</span>
              <textarea
                name="description"
                rows={3}
                maxLength={5000}
                value={values.description}
                disabled={busy}
                placeholder="Additional notes about this model…"
                onChange={(event) => change('description', event.target.value)}
              />
              {validation('description')}
            </label>
          </div>
          <aside className="model-status-panel">
            <div className="catalog-form-section-label">OPERATIONAL STATUS</div>
            <div className="catalog-status-options">
              {[true, false].map((active) => (
                <label
                  key={String(active)}
                  className={values.is_active === active ? 'selected' : ''}
                >
                  <input
                    name="is_active"
                    type="radio"
                    checked={values.is_active === active}
                    disabled={busy}
                    onChange={() => change('is_active', active)}
                  />
                  <span>
                    <strong>{active ? 'Active' : 'Inactive'}</strong>
                    <small>
                      {active ? 'Available for selection' : 'Unavailable for selection'}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <p>Deactivation keeps this model and all existing booking references.</p>
          </aside>
        </div>
      </div>
      <footer className="catalog-form-actions">
        <button type="button" className="catalog-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="catalog-button primary"
          disabled={busy || options.loading || Boolean(options.error) || !options.brands.length}
        >
          {busy ? t('Saving…') : row ? t('Save changes') : `＋ ${t('Create AC Model')}`}
        </button>
      </footer>
    </form>
  )
}

export function CreateAcModelPage() {
  const navigate = useNavigate()
  const { t } = useUiPreferences()
  return (
    <CatalogLayout
      heading={
        <div className="catalog-header-title">
          <h1>{t('Create AC Model')}</h1>
          <p>{t('Add an air conditioner model to the catalog.')}</p>
        </div>
      }
    >
      <section className="catalog-content">
        <div className="catalog-create-context">
          <Link className="catalog-button" to="/catalog/models">
            ← {t('Back to AC Models')}
          </Link>
        </div>
        <div className="catalog-create-panel model-create-panel">
          <AcModelForm
            onCancel={() => navigate('/catalog/models')}
            onSaved={() => navigate('/catalog/models')}
          />
        </div>
      </section>
    </CatalogLayout>
  )
}
