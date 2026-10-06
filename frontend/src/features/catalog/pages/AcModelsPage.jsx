import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/context/AuthContext.jsx'
import { catalogRequest } from '../api/catalogApi.js'
import { CatalogLayout } from '../components/CatalogLayout.jsx'
import { Modal } from '../components/Modal.jsx'
import './catalog.css'

const types = [
  ['WALL_MOUNTED', 'Wall mounted', '▱'], ['CEILING_CASSETTE', 'Ceiling cassette', '▦'],
  ['CEILING_SUSPENDED', 'Ceiling suspended', '▤'], ['FLOOR_STANDING', 'Floor standing', '▯'],
  ['DUCTED', 'Ducted', '▥'], ['PORTABLE', 'Portable', '▣'], ['WINDOW', 'Window', '⊞'],
]
const typeLabel = (value) => types.find(([code]) => code === value)?.[1] ?? value ?? '—'
const btuLabel = (value) => value == null ? '—' : `${new Intl.NumberFormat('en-US').format(value)} BTU`

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
        const data = await catalogRequest(`/brands?limit=100&page=${page}`, token, { signal: controller.signal })
        rows.push(...data.items)
        if (rows.length >= data.total) break
        page++
      }
      if (!controller.signal.aborted) { setBrands(rows); setLoading(false); setError('') }
    }
    load().catch((error) => {
      if (error.name === 'AbortError') return
      setError(error.message); setLoading(false)
      if (error.status === 401) logout()
    })
    return () => controller.abort()
  }, [token, retry, logout])
  return { brands, loading, error, reload: () => { setLoading(true); setRetry((value) => value + 1) } }
}

export function AcModelsPage() {
  const { token, logout } = useAuth()
  const brandOptions = useBrands(token)
  const [search, setSearch] = useState('')
  const [querySearch, setQuerySearch] = useState('')
  const [filters, setFilters] = useState({ brand_id: '', ac_type: '', capacity_btu: '', inverter: '', status: 'all' })
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState('')
  const close = useCallback(() => { setDialog(null); setMutationError('') }, [])
  useEffect(() => {
    const timer = setTimeout(() => { setQuerySearch(search); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ page, limit: 10, search: querySearch })
    Object.entries(filters).forEach(([key, value]) => { if (value !== '') query.set(key, value) })
    catalogRequest(`/models?${query}`, token, { signal: controller.signal }).then((result) => {
      if (page > 1 && page > Math.max(1, Math.ceil(result.total / 10))) { setPage(Math.max(1, Math.ceil(result.total / 10))); return }
      setData(result); setLoading(false); setError('')
    }).catch((error) => {
      if (error.name === 'AbortError') return
      setError(error.message); setLoading(false)
      if (error.status === 401) logout()
    })
    return () => controller.abort()
  }, [token, querySearch, filters, page, refresh, logout])
  const filter = (key, value) => { setLoading(true); setPage(1); setFilters((current) => ({ ...current, [key]: value })) }
  const reload = () => { setLoading(true); setRefresh((value) => value + 1) }
  const open = (type, row) => { setMutationError(''); setDialog({ type, row }) }
  async function changeStatus() {
    setBusy(true); setMutationError('')
    try {
      await catalogRequest(`/models/${dialog.row.id}/status`, token, { method: 'PATCH', body: { is_active: !dialog.row.is_active } })
      setNotice(dialog.row.is_active ? 'Đã vô hiệu hóa model. Booking lịch sử được giữ nguyên.' : 'Đã kích hoạt model.'); close(); reload()
    } catch (error) { setMutationError(error.message); if (error.status === 401) logout() }
    finally { setBusy(false) }
  }
  const totalPages = Math.max(1, Math.ceil(data.total / 10))
  return <CatalogLayout><section className="catalog-content">
    <div className="catalog-breadcrumb">Catalog <span>/</span> AC Models</div>
    <div className="catalog-page-heading"><div><h1>AC Models</h1><p>Manage air conditioner models, specifications and availability.</p></div><Link className="catalog-button primary" to="/catalog/models/new">＋ Add AC Model</Link></div>
    {notice && <div className="catalog-notice" role="status">✓ {notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
    {error && <div className="catalog-error" role="alert">{error}<button onClick={reload}>Thử lại</button></div>}
    {brandOptions.error && <div className="catalog-error" role="alert">Không tải được danh sách hãng. {brandOptions.error}<button onClick={brandOptions.reload}>Thử lại</button></div>}
    <div className="catalog-panel">
      <div className="catalog-toolbar model-toolbar">
        <label className="catalog-search"><span>⌕</span><input aria-label="Search AC models" placeholder="Search model name…" value={search} maxLength={150} onChange={(event) => { setSearch(event.target.value); setLoading(true) }} /></label>
        <select aria-label="Filter by brand" value={filters.brand_id} disabled={brandOptions.loading} onChange={(event) => filter('brand_id', event.target.value)}><option value="">{brandOptions.loading ? 'Loading brands…' : 'All brands'}</option>{brandOptions.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select>
        <select aria-label="Filter by AC type" value={filters.ac_type} onChange={(event) => filter('ac_type', event.target.value)}><option value="">All AC types</option>{types.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>
        <label className="model-btu-filter"><input type="number" min="1" max="2147483647" step="1" aria-label="Filter by BTU" placeholder="All BTU" value={filters.capacity_btu} onChange={(event) => filter('capacity_btu', event.target.value)} /></label>
        <select aria-label="Filter by inverter" value={filters.inverter} onChange={(event) => filter('inverter', event.target.value)}><option value="">All inverter</option><option value="true">Inverter</option><option value="false">Non-inverter</option></select>
        <select aria-label="Filter by status" value={filters.status} onChange={(event) => filter('status', event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <button className="catalog-button" onClick={() => { setSearch(''); setFilters({ brand_id: '', ac_type: '', capacity_btu: '', inverter: '', status: 'all' }); setPage(1); reload() }}>Reset filters</button>
      </div>
      <div className="catalog-table-scroll"><table className="catalog-table"><thead><tr><th>#</th><th>MODEL NAME</th><th>BRAND</th><th>AC TYPE</th><th>CAPACITY</th><th>INVERTER</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={8}><div className="catalog-state" role="status"><span className="catalog-spinner" />Loading models…</div></td></tr> : error ? <tr><td colSpan={8}><div className="catalog-state">Không thể tải danh sách model.</div></td></tr> : !data.items.length ? <tr><td colSpan={8}><div className="catalog-state"><span className="catalog-empty-icon">❄</span><strong>No AC models found</strong><p>Try changing the filters or add a new model.</p></div></td></tr> : data.items.map((row, index) => <tr key={row.id}>
          <td className="catalog-index">{String((page - 1) * 10 + index + 1).padStart(2, '0')}</td><td><div className="catalog-name"><span className={`catalog-row-icon tone-${index % 4}`}>❄</span><strong>{row.model_name}</strong></div></td><td>{row.brand_name}</td><td>{typeLabel(row.ac_type)}</td><td className="catalog-price">{btuLabel(row.capacity_btu)}</td><td><span className={`model-inverter ${row.inverter === true ? 'enabled' : ''}`}>{row.inverter === null ? '—' : row.inverter ? 'Inverter' : 'Non-inverter'}</span></td><td><span className={`catalog-status ${row.is_active ? 'active' : 'inactive'}`}><i />{row.is_active ? 'Active' : 'Inactive'}</span></td>
          <td><div className="catalog-row-actions"><button aria-label={`Edit ${row.model_name}`} title="Edit model" onClick={() => open('edit', row)}>✎</button><button aria-label={`View details of ${row.model_name}`} title="Record details" onClick={() => open('details', row)}>◷</button><button aria-label={`${row.is_active ? 'Deactivate' : 'Activate'} ${row.model_name}`} title={row.is_active ? 'Deactivate model' : 'Activate model'} onClick={() => open('status', row)}>⏻</button></div></td>
        </tr>)}
      </tbody></table></div>
      <footer className="catalog-pagination"><span>{data.total ? `${(page - 1) * 10 + 1}–${Math.min(page * 10, data.total)} of ${data.total} models` : '0 models'}</span><div><button disabled={page <= 1 || loading} onClick={() => { setPage(page - 1); setLoading(true) }}>‹ Previous</button><span>{page} / {totalPages}</span><button disabled={page >= totalPages || loading} onClick={() => { setPage(page + 1); setLoading(true) }}>Next ›</button></div></footer>
    </div>
  </section>
    {dialog?.type === 'edit' && <Modal title="Edit AC Model" onClose={close} busy={busy}><AcModelForm row={dialog.row} onCancel={close} onBusyChange={setBusy} onSaved={() => { close(); setNotice('Đã cập nhật model.'); reload() }} /></Modal>}
    {dialog?.type === 'status' && <Modal title={dialog.row.is_active ? 'Deactivate AC Model?' : 'Activate AC Model?'} onClose={close} busy={busy} danger>
      <div className="catalog-confirm"><p>{dialog.row.is_active ? <>Deactivate <strong>{dialog.row.model_name}</strong>? This model will no longer be available for selection. Existing bookings and their references will be preserved.</> : <>Make <strong>{dialog.row.model_name}</strong> active again?</>}</p>{mutationError && <div className="catalog-error" role="alert">{mutationError}</div>}</div><footer className="catalog-form-actions"><button className="catalog-button" disabled={busy} onClick={close}>Cancel</button><button className={`catalog-button ${dialog.row.is_active ? 'danger' : 'primary'}`} disabled={busy} onClick={changeStatus}>{busy ? 'Saving…' : dialog.row.is_active ? 'Deactivate' : 'Activate'}</button></footer>
    </Modal>}
    {dialog?.type === 'details' && <Modal title={dialog.row.model_name} onClose={close}><dl className="catalog-record-details"><dt>Description</dt><dd>{dialog.row.description || '—'}</dd><dt>Created</dt><dd>{new Date(dialog.row.created_at).toLocaleString('vi-VN')}</dd><dt>Last updated</dt><dd>{new Date(dialog.row.updated_at).toLocaleString('vi-VN')}</dd></dl></Modal>}
  </CatalogLayout>
}

function AcModelForm({ row, onCancel, onSaved, onBusyChange }) {
  const { token, logout } = useAuth()
  const options = useBrands(token)
  const [values, setValues] = useState(() => ({ model_name: row?.model_name ?? '', brand_id: row?.brand_id ?? '', ac_type: row?.ac_type ?? 'WALL_MOUNTED', capacity_btu: row?.capacity_btu ?? '', inverter: row?.inverter == null ? '' : String(row.inverter), description: row?.description ?? '', is_active: row?.is_active ?? true }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errors, setErrors] = useState({})
  const change = (key, value) => { setValues((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: undefined })) }
  const validation = (key) => errors[key] && <small className="catalog-field-error" id={`model-${key}-error`}>{errors[key]}</small>
  async function submit(event) {
    event.preventDefault()
    if (!values.model_name.trim() || !values.brand_id || !values.ac_type || values.inverter === '' || !Number.isInteger(Number(values.capacity_btu)) || Number(values.capacity_btu) <= 0) { setError('Vui lòng nhập đầy đủ tên, hãng, loại máy, BTU và inverter hợp lệ.'); return }
    const body = { ...values, model_name: values.model_name.trim(), capacity_btu: Number(values.capacity_btu), inverter: values.inverter === 'true', description: values.description.trim() || null }
    setBusy(true); onBusyChange?.(true); setError(''); setErrors({})
    try { await catalogRequest(`/models${row ? `/${row.id}` : ''}`, token, { method: row ? 'PATCH' : 'POST', body }); onSaved() }
    catch (error) { setError(error.message); setErrors(error.details ?? {}); if (error.status === 401) logout() }
    finally { setBusy(false); onBusyChange?.(false) }
  }
  return <form className={`catalog-form model-form ${row ? 'model-edit-form' : ''}`} onSubmit={submit}>
    <div className="catalog-form-body"><p className="catalog-form-intro">{row ? 'Update model specifications and operational status.' : 'Define a model and its specifications for your AC catalog.'}</p>
      {error && <div className="catalog-error" role="alert">{error}</div>}{options.error && <div className="catalog-error" role="alert">{options.error}<button type="button" onClick={options.reload}>Retry brands</button></div>}
      <div className="model-form-columns"><div>
        <div className="catalog-form-section-label">MODEL IDENTIFICATION</div>
        <div className="catalog-form-grid"><label className="catalog-field"><span>Model name <em>*</em></span><input name="model_name" value={values.model_name} maxLength={100} required disabled={busy} placeholder="Enter model name" aria-invalid={Boolean(errors.model_name)} onChange={(event) => change('model_name', event.target.value)} />{validation('model_name')}</label>
          <label className="catalog-field"><span>AC brand <em>*</em></span><select name="brand_id" required value={values.brand_id} disabled={busy || options.loading} aria-invalid={Boolean(errors.brand_id)} onChange={(event) => change('brand_id', event.target.value)}><option value="">{options.loading ? 'Loading brands…' : 'Select brand'}</option>{options.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}{brand.is_active ? '' : ' (Inactive)'}</option>)}</select>{validation('brand_id')}{!options.loading && !options.error && !options.brands.length && <small>No brands available. <Link to="/catalog/brands/new">Create an AC brand</Link> first.</small>}</label></div>
        <div className="catalog-form-section-label">TECHNICAL SPECIFICATIONS</div>
        <div className="catalog-form-grid"><label className="catalog-field"><span>Cooling capacity (BTU) <em>*</em></span><input name="capacity_btu" type="number" min="1" max="2147483647" step="1" list="model-btu-options" value={values.capacity_btu} required disabled={busy} placeholder="e.g. 12000" aria-invalid={Boolean(errors.capacity_btu)} onChange={(event) => change('capacity_btu', event.target.value)} /><datalist id="model-btu-options">{[9000, 12000, 18000, 24000, 36000, 48000].map((btu) => <option key={btu} value={btu} />)}</datalist>{validation('capacity_btu')}</label>
          <label className="catalog-field"><span>Inverter technology <em>*</em></span><select name="inverter" required value={values.inverter} disabled={busy} aria-invalid={Boolean(errors.inverter)} onChange={(event) => change('inverter', event.target.value)}><option value="">Select technology</option><option value="true">Inverter</option><option value="false">Non-inverter</option></select>{validation('inverter')}</label></div>
        <fieldset className="model-types" disabled={busy}><legend>AC type <em>*</em></legend><div>{types.map(([code, label, icon]) => <label key={code} className={values.ac_type === code ? 'selected' : ''}><input type="radio" name="ac_type" value={code} checked={values.ac_type === code} required onChange={() => change('ac_type', code)} /><span>{icon}</span><strong>{label}</strong></label>)}</div>{validation('ac_type')}</fieldset>
        <label className="catalog-field"><span>Description</span><textarea name="description" rows={3} maxLength={5000} value={values.description} disabled={busy} placeholder="Additional notes about this model…" onChange={(event) => change('description', event.target.value)} />{validation('description')}</label>
      </div><aside className="model-status-panel"><div className="catalog-form-section-label">OPERATIONAL STATUS</div><div className="catalog-status-options">{[true, false].map((active) => <label key={String(active)} className={values.is_active === active ? 'selected' : ''}><input name="is_active" type="radio" checked={values.is_active === active} disabled={busy} onChange={() => change('is_active', active)} /><span><strong>{active ? 'Active model' : 'Inactive model'}</strong><small>{active ? 'Available for selection' : 'Unavailable for selection'}</small></span></label>)}</div><p>Deactivation keeps this model and all existing booking references.</p></aside></div>
    </div><footer className="catalog-form-actions"><button type="button" className="catalog-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="catalog-button primary" disabled={busy || options.loading || Boolean(options.error) || !options.brands.length}>{busy ? 'Saving…' : row ? 'Save changes' : '＋ Create AC Model'}</button></footer>
  </form>
}

export function CreateAcModelPage() {
  const navigate = useNavigate()
  return <CatalogLayout><section className="catalog-content"><div className="catalog-breadcrumb">Catalog<span>/</span><Link to="/catalog/models">AC Models</Link><span>/</span>Create</div><div className="catalog-page-heading"><div><h1>Create AC Model</h1><p>Add an air conditioner model to the catalog.</p></div><Link className="catalog-button" to="/catalog/models">← Back to AC Models</Link></div><div className="catalog-create-panel model-create-panel"><AcModelForm onCancel={() => navigate('/catalog/models')} onSaved={() => navigate('/catalog/models')} /></div></section></CatalogLayout>
}
