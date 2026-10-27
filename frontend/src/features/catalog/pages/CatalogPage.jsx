import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useAutoDismiss } from '../../../shared/hooks/useAutoDismiss.js'
import { uploadProfilePhoto } from '../../../shared/api/cloudinaryApi.js'
import { catalogRequest } from '../api/catalogApi.js'
import { CatalogLayout } from '../components/CatalogLayout.jsx'
import { Modal } from '../components/Modal.jsx'
import { CatalogTrash, CatalogTrashButton } from '../components/CatalogTrash.jsx'
import '../styles/catalog.css'
import { nameError, numberError } from '../catalogValidation.js'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'

const catalogConfig = {
  categories: {
    title: 'Service Categories',
    singular: 'Service Category',
    description: 'Organize your service catalog into clear, manageable categories.',
    icon: '▧',
  },
  brands: {
    title: 'AC Brands',
    singular: 'AC Brand',
    description: 'Manage air conditioner brands across the CoolCare catalog.',
    icon: '◈',
  },
  services: {
    title: 'Services',
    singular: 'Service',
    description: 'Manage service pricing, duration and maintenance schedules.',
    icon: '❄',
  },
}
const date = (value, locale) => new Date(value).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-US')
const money = (value) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value)

export function CatalogPage() {
  const { kind } = useParams()
  const config = catalogConfig[kind]
  const { token, logout } = useAuth()
  const { locale, t } = useUiPreferences()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState('NEWEST')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [result, setResult] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const noticeHover = useAutoDismiss(notice, setNotice)
  const [refresh, setRefresh] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState(false)
  const [categories, setCategories] = useState([])
  const close = useCallback(() => {
    setDialog(null)
    setError('')
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!config) return
    const controller = new AbortController()
    const query = new URLSearchParams({ search: debouncedSearch, status, sort, page, limit })
    if (kind === 'services' && category) query.set('category_id', category)
    catalogRequest(`/${kind}?${query}`, token, { signal: controller.signal })
      .then((data) => {
        if (data.total > 0 && page > Math.ceil(data.total / limit)) {
          setPage(Math.ceil(data.total / limit))
          return
        }
        setResult(data)
        setError('')
        setLoading(false)
      })
      .catch((error) => {
        if (error.name === 'AbortError') return
        setError(error.message)
        setLoading(false)
        if (error.status === 401) logout()
      })
    return () => controller.abort()
  }, [kind, config, token, debouncedSearch, status, category, sort, page, limit, refresh, logout])

  useEffect(() => {
    if (kind !== 'services') return
    const controller = new AbortController()
    async function load() {
      const all = []
      let currentPage = 1
      while (!controller.signal.aborted) {
        const data = await catalogRequest(`/categories?limit=100&page=${currentPage}`, token, {
          signal: controller.signal,
        })
        all.push(...data.items)
        if (all.length >= data.total) break
        currentPage++
      }
      if (!controller.signal.aborted) setCategories(all)
    }
    load().catch((error) => {
      if (error.name !== 'AbortError') setError(error.message)
    })
    return () => controller.abort()
  }, [kind, token])

  if (!config)
    return (
      <CatalogLayout>
        <p className="catalog-state">
          {t('Catalog page not found.')} <Link to="/catalog/categories">{t('Go to categories')}</Link>
        </p>
      </CatalogLayout>
    )

  async function mutate(path, options, success) {
    setBusy(true)
    setError('')
    try {
      await catalogRequest(path, token, options)
      setDialog(null)
      setNotice(success)
      setLoading(true)
      setRefresh((value) => value + 1)
    } catch (error) {
      setError(error.message)
      if (error.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }
  const totalPages = Math.max(1, Math.ceil(result.total / limit))
  return (
    <CatalogLayout
      heading={
        <div className="catalog-header-title">
          <h1>{t(config.title)}</h1>
          <p>{t(config.description)}</p>
        </div>
      }
      onRefresh={() => {
        setLoading(true)
        setRefresh(value => value + 1)
      }}
      refreshing={loading}
    >
      <section className="catalog-content">
        {notice && (
          <div className="catalog-notice" role="status" {...noticeHover}>
            ✓ {notice}
            <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}
        {error && !dialog && (
          <div className="catalog-error" role="alert">
            {error}{' '}
            <button
              onClick={() => {
                setLoading(true)
                setRefresh((value) => value + 1)
              }}
            >
              Thử lại
            </button>
          </div>
        )}
        <div className="catalog-panel">
          <div className="catalog-toolbar">
            <label className="catalog-search">
              <span>⌕</span>
              <input
                aria-label="Search catalog"
                placeholder={t(`Search ${config.title.toLowerCase()}…`)}
                value={search}
                onChange={(event) => {
                  setLoading(true)
                  setSearch(event.target.value)
                }}
              />
            </label>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                setPage(1)
                setLoading(true)
              }}
            >
              <option value="all">{t('All statuses')}</option>
              <option value="active">{t('Active')}</option>
              <option value="inactive">{t('Inactive')}</option>
            </select>
            {kind === 'services' && (
              <select
                aria-label="Filter by category"
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value)
                  setPage(1)
                  setLoading(true)
                }}
              >
                <option value="">{t('All categories')}</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label={t('Sort records')}
              value={sort}
              onChange={(event) => {
                setSort(event.target.value)
                setPage(1)
                setLoading(true)
              }}
            >
              <option value="NEWEST">{t('Newest')}</option>
              <option value="OLDEST">{t('Oldest')}</option>
              <option value="NAME_ASC">{t('Name A–Z')}</option>
              <option value="NAME_DESC">{t('Name Z–A')}</option>
              {kind === 'services' && (
                <>
                  <option value="PRICE_ASC">{t('Price low to high')}</option>
                  <option value="PRICE_DESC">{t('Price high to low')}</option>
                </>
              )}
            </select>
            <span className="catalog-count">{result.total} {t('records')}</span>
            <CatalogTrash kind={kind} onChanged={() => { setLoading(true); setRefresh((n) => n + 1) }} />
            <Link className="catalog-button primary catalog-add-button" to={`/catalog/${kind}/new`}>
              ＋ {t('Add')} {t(config.singular)}
            </Link>
          </div>
          <div className="catalog-table-scroll">
            <table className={`catalog-table catalog-resource-table catalog-resource-${kind}`}>
              <thead>
                <tr>
                  <th className="catalog-numeric">#</th>
                  <th>{t(kind === 'brands' ? 'BRAND NAME' : 'NAME')}</th>
                  {kind === 'services' ? (
                    <>
                      <th>{t('CATEGORY')}</th>
                      <th>{t('BASE PRICE')}</th>
                      <th>{t('DURATION')}</th>
                      <th>{t('MAINTENANCE')}</th>
                    </>
                  ) : (
                    <>
                      <th>{t('DESCRIPTION')}</th>
                      <th>{t(kind === 'brands' ? 'MODELS' : 'SERVICES')}</th>
                    </>
                  )}
                  <th>{t('STATUS')}</th>
                  <th>{t('UPDATED')}</th>
                  <th className="catalog-actions-title">{t('ACTIONS')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={kind === 'services' ? 9 : 7}>
                      <div className="catalog-state" role="status">
                        <span className="catalog-spinner" /> {t('Loading catalog…')}
                      </div>
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={kind === 'services' ? 9 : 7}>
                      <div className="catalog-state">Không thể tải dữ liệu.</div>
                    </td>
                  </tr>
                ) : !result.items.length ? (
                  <tr>
                    <td colSpan={kind === 'services' ? 9 : 7}>
                      <div className="catalog-state">
                        <span className="catalog-empty-icon">{config.icon}</span>
                        <strong>{t('No catalog records found')}</strong>
                        <p>
                          {search || status !== 'all' || category
                            ? t('Try changing your search or filters.')
                            : t('Add the first record to get started.')}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  result.items.map((row, index) => (
                    <tr key={row.id}>
                      <td className="catalog-index catalog-numeric">
                        {String((page - 1) * limit + index + 1).padStart(2, '0')}
                      </td>
                      <td>
                        <div className="catalog-name">
                          {kind === 'categories' && (
                            <span className={`catalog-row-icon tone-${index % 4}`}>
                              {config.icon}
                            </span>
                          )}
                          <strong>{row.name}</strong>
                        </div>
                      </td>
                      {kind === 'services' ? (
                        <>
                          <td>{row.category_name}</td>
                          <td className="catalog-price catalog-numeric">{money(row.base_price)}</td>
                          <td className="catalog-numeric">{row.estimated_duration ? `${row.estimated_duration} min` : '—'}</td>
                          <td className="catalog-numeric">
                            {row.maintenance_interval_days
                              ? `${row.maintenance_interval_days} days`
                              : '—'}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="catalog-description" title={row.description}>
                            {row.description || '—'}
                          </td>
                          <td className="catalog-numeric">
                            <span className="catalog-number">
                              {kind === 'brands' ? row.model_count : row.service_count}
                            </span>
                          </td>
                        </>
                      )}
                      <td>
                        <span className={`catalog-status ${row.is_active ? 'active' : 'inactive'}`}>
                          <i />
                          {t(row.is_active ? 'Active' : 'Inactive')}
                        </span>
                      </td>
                      <td className="catalog-date catalog-numeric">{date(row.updated_at, locale)}</td>
                      <td>
                        <div className="catalog-row-actions">
                          <button
                            title={`${t('Edit')} ${row.name}`}
                            aria-label={`${t('Edit')} ${row.name}`}
                            onClick={() => {
                              setError('')
                              setDialog({ type: 'edit', row })
                            }}
                          >
                            ✎
                          </button>
                          <button
                            title={t('Record details')}
                            aria-label={`${t('View details')}: ${row.name}`}
                            onClick={() => {
                              setError('')
                              setDialog({ type: 'details', row })
                            }}
                          >
                            ◷
                          </button>
                          <CatalogTrashButton
                            kind={kind}
                            row={row}
                            onChanged={() => {
                              setLoading(true)
                              setRefresh((n) => n + 1)
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <footer className="catalog-pagination">
            <div className="catalog-page-summary"><span>
              {result.total
                ? t('{first}–{last} of {total}', { first: (page - 1) * limit + 1, last: Math.min(page * limit, result.total), total: result.total })
                : t('0 records')}
            </span>
            <label>
              {t('Rows')}{' '}
              <select
                aria-label={t('Rows per page')}
                value={limit}
                disabled={loading}
                onChange={(event) => {
                  setLimit(Number(event.target.value))
                  setPage(1)
                  setLoading(true)
                }}
              >
                {[5, 10, 15, 20, 25].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label></div>
            <div>
              <button
                disabled={page === 1 || loading}
                onClick={() => {
                  setLoading(true)
                  setPage(page - 1)
                }}
              >
                ‹ {t('Previous')}
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages || loading}
                onClick={() => {
                  setLoading(true)
                  setPage(page + 1)
                }}
              >
                {t('Next')} ›
              </button>
            </div>
          </footer>
        </div>
      </section>
      {dialog?.type === 'edit' && (
        <Modal title={t(`Edit ${config.singular}`)} onClose={close} busy={busy}>
          <CatalogForm
            kind={kind}
            row={dialog.row}
            token={token}
            onCancel={close}
            onBusyChange={setBusy}
            onSaved={() => {
              close()
              setNotice('Đã cập nhật thành công.')
              setLoading(true)
              setRefresh((value) => value + 1)
            }}
          />
        </Modal>
      )}
      {(dialog?.type === 'delete' || dialog?.type === 'toggle') && (
        <Modal
          title={
            dialog.type === 'delete'
              ? 'Do you want to delete?'
              : `${dialog.row.is_active ? 'Deactivate' : 'Activate'} service?`
          }
          onClose={close}
          busy={busy}
          danger
        >
          <div className="catalog-confirm">
            <p>
              {dialog.type === 'delete' ? (
                <>
                  Delete <strong>{dialog.row.name}</strong>? This action cannot be undone.
                  Categories used by services cannot be deleted.
                </>
              ) : (
                <>
                  Change the status of <strong>{dialog.row.name}</strong>? Inactive services will be
                  hidden from the mobile catalog.
                </>
              )}
            </p>
            {error && (
              <div className="catalog-error" role="alert">
                {error}
              </div>
            )}
          </div>
          <footer className="catalog-form-actions">
            <button className="catalog-button" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button
              className={`catalog-button ${dialog.type === 'delete' ? 'danger' : 'primary'}`}
              disabled={busy}
              onClick={() =>
                mutate(
                  `/${kind}/${dialog.row.id}${dialog.type === 'toggle' ? '/status' : ''}`,
                  dialog.type === 'delete'
                    ? { method: 'DELETE' }
                    : { method: 'PATCH', body: { is_active: !dialog.row.is_active } },
                  dialog.type === 'delete' ? 'Đã xóa danh mục.' : 'Đã cập nhật trạng thái.'
                )
              }
            >
              {busy ? 'Saving…' : 'Confirm'}
            </button>
          </footer>
        </Modal>
      )}
      {dialog?.type === 'details' && (
        <Modal title={`Record details · ${dialog.row.name}`} onClose={close}>
          <dl className="catalog-record-details">
            <dt>Created</dt>
            <dd>{new Date(dialog.row.created_at).toLocaleString('vi-VN')}</dd>
            <dt>Last updated</dt>
            <dd>{new Date(dialog.row.updated_at).toLocaleString('vi-VN')}</dd>
            <dt>Status</dt>
            <dd>{dialog.row.is_active ? 'Active' : 'Inactive'}</dd>
          </dl>
        </Modal>
      )}
    </CatalogLayout>
  )
}

export function CatalogForm({ kind, row, token, onCancel, onSaved, onBusyChange }) {
  const config = catalogConfig[kind]
  const [values, setValues] = useState(() => ({
    name: row?.name ?? '',
    description: row?.description ?? '',
    image_url: row?.image_url ?? '',
    is_active: row?.is_active ?? true,
    category_id: row?.category_id ?? '',
    base_price: row?.base_price ?? '',
    estimated_duration: row?.estimated_duration ?? '',
    maintenance_interval_days: row?.maintenance_interval_days ?? '',
  }))
  const [categories, setCategories] = useState([])
  const [errors, setErrors] = useState({})
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [categoryLoading, setCategoryLoading] = useState(kind === 'services')
  const [retry, setRetry] = useState(0)
  const { logout } = useAuth()
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview)
    }
  }, [imagePreview])
  useEffect(() => {
    if (kind !== 'services') return
    const controller = new AbortController()
    async function load() {
      const all = []
      let page = 1
      while (!controller.signal.aborted) {
        const data = await catalogRequest(`/categories?limit=100&page=${page}`, token, {
          signal: controller.signal,
        })
        all.push(...data.items)
        if (all.length >= data.total) break
        page++
      }
      if (!controller.signal.aborted) {
        setCategories(all)
        setCategoryLoading(false)
        setError('')
      }
    }
    load().catch((error) => {
      if (error.name !== 'AbortError') {
        setError(error.message)
        setCategoryLoading(false)
        if (error.status === 401) logout()
      }
    })
    return () => controller.abort()
  }, [kind, token, retry, logout])
  const change = (key, value) => {
    if (key === 'name' && /\p{N}/u.test(value)) {
      setErrors((current) => ({ ...current, name: 'Names cannot contain numbers.' }))
      return
    }
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }
  function field(key, label, type = 'text', optional = false) {
    return (
      <label className="catalog-field">
        <span>
          {label}
          {!optional && <em> *</em>}
        </span>
        <input
          name={key}
          type={type}
          value={values[key]}
          required={!optional}
          maxLength={key === 'name' ? (kind === 'services' ? 150 : 100) : undefined}
          min={type === 'number' ? (key === 'base_price' ? 0 : 1) : undefined}
          max={type === 'number' ? (key === 'base_price' ? 9999999999.99 : 2147483647) : undefined}
          step={type === 'number' ? (key === 'base_price' ? '0.01' : '1') : undefined}
          placeholder={
            key === 'name'
              ? `Enter ${config.singular.toLowerCase()} name`
              : optional
                ? 'Optional'
                : undefined
          }
          aria-invalid={Boolean(errors[key])}
          disabled={busy}
          onChange={(event) => change(key, event.target.value)}
        />
        {errors[key] && <small className="catalog-field-error">{errors[key]}</small>}
      </label>
    )
  }
  async function submit(event) {
    event.preventDefault()
    if (busy || errors.image_url) return
    const validation = { name: nameError(values.name, kind === 'services' ? 150 : 100) }
    if (kind === 'services') {
      if (categoryLoading || !categories.some((category) => category.id === values.category_id))
        validation.category_id = 'Choose a valid category.'
      validation.base_price = numberError(values.base_price, { max: 9999999999.99, integer: false })
      for (const key of ['estimated_duration', 'maintenance_interval_days'])
        validation[key] = numberError(values[key], { optional: true, max: 2147483647 })
    }
    if (Object.values(validation).some(Boolean)) {
      setErrors(validation)
      return
    }
    const body = {
      name: values.name.trim(),
      description: values.description.trim() || null,
      is_active: values.is_active,
    }
    if (kind === 'categories') body.image_url = values.image_url.trim() || null
    if (kind === 'services')
      Object.assign(body, {
        category_id: values.category_id,
        base_price: Number(values.base_price),
        estimated_duration:
          values.estimated_duration === '' ? null : Number(values.estimated_duration),
        maintenance_interval_days:
          values.maintenance_interval_days === '' ? null : Number(values.maintenance_interval_days),
      })
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    setErrors({})
    try {
      if (kind === 'categories' && imageFile) {
        body.image_url = await uploadProfilePhoto(imageFile, 'coolcare/service-categories')
        change('image_url', body.image_url)
        setImageFile(null)
        setImagePreview('')
      }
      await catalogRequest(`/${kind}${row ? `/${row.id}` : ''}`, token, {
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
    <form onSubmit={submit} className="catalog-form">
      <div className="catalog-form-body">
        <p className="catalog-form-intro">
          {row
            ? 'Update the details below.'
            : `Add a new ${config.singular.toLowerCase()} to your catalog.`}
        </p>
        {error && (
          <div className="catalog-error" role="alert">
            {error}
            {kind === 'services' && !categories.length && (
              <button
                type="button"
                onClick={() => {
                  setCategoryLoading(true)
                  setRetry(retry + 1)
                }}
              >
                Retry categories
              </button>
            )}
          </div>
        )}
        <div className="catalog-form-section-label">GENERAL INFORMATION</div>
        {!['services', 'brands'].includes(kind) && (
          <div className="catalog-form-icon">{config.icon}</div>
        )}
        {field('name', `${config.singular} name`)}
        <label className="catalog-field">
          <span>Description</span>
          <textarea
            value={values.description}
            maxLength={5000}
            rows={3}
            disabled={busy}
            placeholder="Describe this catalog entry…"
            onChange={(event) => change('description', event.target.value)}
          />
          {errors.description && (
            <small className="catalog-field-error">{errors.description}</small>
          )}
        </label>
        {kind === 'categories' && (
          <div className="catalog-field catalog-image-field">
            <label htmlFor="category-image">Category image</label>
            {(imagePreview || values.image_url) && (
              <img
                className="catalog-image-preview"
                src={imagePreview || values.image_url}
                alt="Category preview"
              />
            )}
            <input
              id="category-image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              aria-invalid={Boolean(errors.image_url)}
              aria-describedby={errors.image_url ? 'category-image-error' : 'category-image-help'}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                const message = !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
                  ? 'Choose a JPG, PNG or WEBP image.'
                  : file.size > 5 * 1024 * 1024
                    ? 'Category image must not exceed 5 MB.'
                    : ''
                setErrors((current) => ({ ...current, image_url: message || undefined }))
                if (!message) {
                  setImageFile(file)
                  setImagePreview(URL.createObjectURL(file))
                }
              }}
            />
            <small id="category-image-help">
              Choose an image from your device. JPG, PNG or WEBP, up to 5 MB.
            </small>
            {imageFile && <small>{imageFile.name}</small>}
            {(imageFile || values.image_url) && (
              <button
                type="button"
                className="catalog-button"
                disabled={busy}
                onClick={() => {
                  setImageFile(null)
                  setImagePreview('')
                  change('image_url', '')
                }}
              >
                Remove image
              </button>
            )}
            {errors.image_url && (
              <small id="category-image-error" className="catalog-field-error" role="alert">
                {errors.image_url}
              </small>
            )}
          </div>
        )}
        {kind === 'services' && (
          <>
            <label className="catalog-field">
              <span>
                Category <em>*</em>
              </span>
              <select
                required
                value={values.category_id}
                disabled={busy || categoryLoading}
                onChange={(event) => change('category_id', event.target.value)}
              >
                <option value="">
                  {categoryLoading ? 'Loading categories…' : 'Select category'}
                </option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.is_active ? '' : ' (Inactive)'}
                  </option>
                ))}
              </select>
              {errors.category_id && (
                <small className="catalog-field-error">{errors.category_id}</small>
              )}
              {!categoryLoading && !categories.length && (
                <small>Create a category before adding a service.</small>
              )}
            </label>
            <div className="catalog-form-grid">
              {field('base_price', 'Base price (VND)', 'number')}
              {field('estimated_duration', 'Duration (minutes)', 'number', true)}
              {field('maintenance_interval_days', 'Maintenance interval (days)', 'number', true)}
            </div>
          </>
        )}
        <div className="catalog-form-section-label">OPERATIONAL STATUS</div>
        <div className="catalog-status-options">
          {[true, false].map((active) => (
            <label key={String(active)} className={values.is_active === active ? 'selected' : ''}>
              <input
                type="radio"
                name="is_active"
                checked={values.is_active === active}
                disabled={busy}
                onChange={() => change('is_active', active)}
              />
              <span>
                <strong>{active ? 'Active' : 'Inactive'}</strong>
                <small>{active ? 'Available in catalog' : 'Hidden from mobile'}</small>
              </span>
              <i />
            </label>
          ))}
        </div>
      </div>
      <footer className="catalog-form-actions">
        <button type="button" className="catalog-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="catalog-button primary"
          disabled={busy || categoryLoading || (kind === 'services' && !categories.length)}
        >
          {busy ? 'Saving…' : row ? 'Save changes' : `＋ Create ${config.singular}`}
        </button>
      </footer>
    </form>
  )
}

export function CreateCatalogPage() {
  const { kind } = useParams()
  const { token } = useAuth()
  const { t } = useUiPreferences()
  const navigate = useNavigate()
  const config = catalogConfig[kind]
  if (!config)
    return (
      <CatalogLayout>
        <p className="catalog-state">Catalog page not found.</p>
      </CatalogLayout>
    )
  return (
    <CatalogLayout
      heading={
        <div className="catalog-header-title">
          <h1>{t(`Create ${config.singular}`)}</h1>
          <p>{t('Add a new entry to your service & AC catalog.')}</p>
        </div>
      }
    >
      <section className="catalog-content">
        <div className="catalog-create-context">
          <Link className="catalog-button" to={`/catalog/${kind}`}>
            ← {t(`Back to ${config.title}`)}
          </Link>
        </div>
        <div className="catalog-create-panel">
          <CatalogForm
            kind={kind}
            token={token}
            onCancel={() => navigate(`/catalog/${kind}`)}
            onSaved={() => navigate(`/catalog/${kind}`)}
          />
        </div>
      </section>
    </CatalogLayout>
  )
}
