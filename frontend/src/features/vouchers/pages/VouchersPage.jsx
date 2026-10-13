import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { useAutoDismiss } from '../../../shared/hooks/useAutoDismiss.js'
import { adminRequest } from '../../../shared/api/adminApi.js'
import {
  CalendarIcon,
  CheckIcon,
  CloseIcon,
  FilterIcon,
  EyeIcon,
  PageHeader,
  Pagination,
  PlusIcon,
  SortIcon,
  TableState,
  TicketIcon,
} from '../../../shared/components/AdminUi.jsx'
import {
  validateVoucherForm,
  voucherPayload,
  voucherToForm,
} from '../components/voucherFormUtils.js'
import '../../../shared/styles/admin.css'

const money = (value) => `${new Intl.NumberFormat('en-US').format(Number(value))} ₫`
const date = (value) => new Date(value).toLocaleDateString('en-GB')
const isExpired = (row) => new Date(row.end_at).getTime() <= Date.now()
function displayStatus(row) {
  return row.is_active && !isExpired(row) ? 'Active' : 'Inactive'
}
function ActionIcon({ name }) {
  const paths = {
    edit: (
      <>
        <path d="M4 20h4l11-11-4-4L4 16v4Z" />
        <path d="m13.5 6.5 4 4" />
      </>
    ),
    history: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v5l3 2" />
      </>
    ),
    power: (
      <>
        <path d="M12 3v9" />
        <path d="M7 5.5a8 8 0 1 0 10 0" />
      </>
    ),
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

export function VouchersPage() {
  const { t } = useUiPreferences()
  const { token, logout } = useAuth()
  const [status, setStatus] = useState('ALL')
  const [sort, setSort] = useState('NEWEST')
  const [page, setPage] = useState(1)
  const [limit] = useState(10)
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [editing, setEditing] = useState(null)
  const [detail, setDetail] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const noticeHover = useAutoDismiss(notice, setNotice)

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ status, sort, page, limit })
    adminRequest(`/vouchers?${query}`, token, { signal: controller.signal })
      .then((result) => {
        setData(result)
        setError('')
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message)
          if (err.status === 401) logout()
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [token, status, sort, page, limit, refresh, logout])
  useEffect(() => {
    const nextExpiration = data.items
      .filter((row) => row.is_active && !isExpired(row))
      .map((row) => new Date(row.end_at).getTime())
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0]
    if (!nextExpiration) return undefined
    const timer = window.setTimeout(
      () => {
        setLoading(true)
        setRefresh((value) => value + 1)
      },
      Math.min(Math.max(nextExpiration - Date.now() + 100, 100), 2_147_000_000)
    )
    return () => window.clearTimeout(timer)
  }, [data.items])
  const reload = () => {
    setLoading(true)
    setRefresh((value) => value + 1)
  }
  function openEdit(row) {
    setEditing({ ...row, displayId: `VC${String(row.voucher_number).padStart(3, '0')}` })
    setEditForm(voucherToForm({ ...row, is_active: row.is_active && !isExpired(row) }))
    setFieldErrors({})
    setError('')
  }
  const editField = (key, value) => setEditForm((current) => ({ ...current, [key]: value }))
  async function saveEdit(event) {
    event.preventDefault()
    if (isExpired(editing)) return
    const validationErrors = validateVoucherForm(editForm)
    if (Object.keys(validationErrors).length) {
      setFieldErrors(validationErrors)
      setError('Please review the highlighted fields.')
      return
    }
    setBusy(true)
    setError('')
    setFieldErrors({})
    try {
      await adminRequest(`/vouchers/${editing.id}`, token, {
        method: 'PATCH',
        body: voucherPayload(editForm),
      })
      if (editing.is_active !== editForm.is_active)
        await adminRequest(`/vouchers/${editing.id}/status`, token, {
          method: 'PATCH',
          body: { is_active: editForm.is_active },
        })
      setEditing(null)
      setNotice('Voucher updated successfully.')
      reload()
    } catch (err) {
      setError(err.message)
      setFieldErrors(err.details ?? {})
      if (err.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }
  async function toggle(row) {
    if (isExpired(row)) return
    setBusy(true)
    try {
      await adminRequest(`/vouchers/${row.id}/status`, token, {
        method: 'PATCH',
        body: { is_active: !row.is_active },
      })
      setNotice(`Voucher ${row.is_active ? 'deactivated' : 'activated'}.`)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const editingExpired = editing ? isExpired(editing) : false

  return (
    <main className="figma-admin-main">
      <PageHeader
        title="Vouchers"
        subtitle={`${data.total} ${t('Vouchers').toLowerCase()}`}
        refreshing={loading}
        onRefresh={reload}
      />
      <section className="figma-vouchers-content">
        {notice && (
          <div className="figma-toast" {...noticeHover}>
            <CheckIcon /> <span>{notice}</span>
            <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
              <CloseIcon />
            </button>
          </div>
        )}
        <div className="voucher-toolbar">
          <div>
            <label className="voucher-filter">
              <FilterIcon />
              <select
                aria-label="Filter vouchers by status"
                value={status}
                onChange={(event) => {
                  setLoading(true)
                  setPage(1)
                  setStatus(event.target.value)
                }}
              >
                <option value="ALL">{t('Filter: All')}</option>
                <option value="ACTIVE">{t('Active')}</option>
                <option value="INACTIVE">{t('Inactive')}</option>
              </select>
            </label>
            <button
              className="voucher-sort"
              type="button"
              title="Change voucher order"
              onClick={() => {
                setLoading(true)
                setPage(1)
                setSort((value) => (value === 'NEWEST' ? 'OLDEST' : 'NEWEST'))
              }}
            >
              <SortIcon />{' '}
              {t('Sort: {order}', { order: t(sort === 'NEWEST' ? 'Newest' : 'Oldest') })}
            </button>
          </div>
          <Link to="/admin/vouchers/new">
            <PlusIcon /> {t('Create Voucher')}
          </Link>
        </div>
        <div className="figma-table-card">
          <div className="figma-voucher-table">
            <table>
              <thead>
                <tr>
                  <th>{t('VOUCHER ID')}</th>
                  <th>{t('VOUCHER CODE')}</th>
                  <th>{t('DISCOUNT')}</th>
                  <th>{t('EXPIRATION DATE')}</th>
                  <th>{t('STATUS')}</th>
                  <th>{t('ACTION')}</th>
                </tr>
              </thead>
              <tbody>
                <TableState
                  loading={loading}
                  error={error && !editing ? error : ''}
                  empty={!data.items.length}
                  colSpan={6}
                  retry={reload}
                />
                {!loading &&
                  !error &&
                  data.items.map((row) => {
                    const state = displayStatus(row)
                    const expired = isExpired(row)
                    return (
                      <tr key={row.id}>
                        <td>VC{String(row.voucher_number).padStart(3, '0')}</td>
                        <td>
                          <code>{row.code}</code>
                        </td>
                        <td>
                          <strong>
                            {row.discount_type === 'PERCENTAGE'
                              ? `${Number(row.discount_value)}% OFF`
                              : money(row.discount_value)}
                          </strong>
                          <small>
                            {row.discount_type === 'FIXED_AMOUNT'
                              ? 'Fixed'
                              : row.maximum_discount
                                ? `(Max ${new Intl.NumberFormat('en-US').format(Number(row.maximum_discount))})`
                                : ''}
                          </small>
                        </td>
                        <td>{date(row.end_at)}</td>
                        <td>
                          <span className={`figma-status ${state.toLowerCase()}`}>
                            <i />
                            {t(state)}
                          </span>
                        </td>
                        <td>
                          <div className="voucher-inline-actions">
                            <button
                              title={t('View voucher details')}
                              aria-label={`${t('View voucher details')} ${row.code}`}
                              onClick={() => setDetail(row)}
                            >
                              <EyeIcon />
                            </button>
                            <button
                              title="Edit voucher"
                              aria-label={`Edit ${row.code}`}
                              onClick={() => openEdit(row)}
                            >
                              <ActionIcon name="edit" />
                            </button>
                            <Link
                              title="Usage history"
                              aria-label={`Usage history of ${row.code}`}
                              to={`/admin/voucher-usages?voucher_id=${row.id}&voucher_code=${encodeURIComponent(row.code)}`}
                            >
                              <ActionIcon name="history" />
                            </Link>
                            <button
                              className={row.is_active ? 'deactivate' : 'activate'}
                              disabled={busy || expired}
                              title={
                                expired
                                  ? t('Expired vouchers cannot be reactivated')
                                  : row.is_active
                                    ? 'Deactivate voucher'
                                    : 'Activate voucher'
                              }
                              aria-label={`${row.is_active ? 'Deactivate' : 'Activate'} ${row.code}`}
                              onClick={() => toggle(row)}
                            >
                              <ActionIcon name="power" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            total={data.total}
            limit={limit}
            loading={loading}
            onPage={(value) => {
              setLoading(true)
              setPage(value)
            }}
          />
        </div>
      </section>
      {editing && (
        <div className="figma-modal-backdrop">
          <form className="voucher-edit-modal" onSubmit={saveEdit}>
            <header>
              <div>
                <i>
                  <TicketIcon />
                </i>
                <span>
                  <h2>
                    {t('Edit Voucher')}{' '}
                    <b className={editForm.is_active ? 'active' : 'inactive'}>
                      <i /> {t(editForm.is_active ? 'Active' : 'Inactive')}
                    </b>
                  </h2>
                  <p>
                    #{editing.displayId} · <strong>{editForm.code}</strong>
                  </p>
                </span>
              </div>
              <button
                type="button"
                aria-label="Close edit voucher"
                onClick={() => setEditing(null)}
              >
                <CloseIcon />
              </button>
            </header>
            <div className="voucher-edit-body">
              {editingExpired && (
                <div className="voucher-readonly-notice" role="status">
                  {t('This voucher has expired and is available in view-only mode.')}
                </div>
              )}
              <fieldset className="voucher-edit-readonly-fields" disabled={editingExpired}>
                <div className="voucher-edit-row two">
                  <label>
                    <span>
                      {t('Voucher Code')} <em>*</em>
                    </span>
                    <div className="edit-input with-icon">
                      <TicketIcon />
                      <input
                        required
                        maxLength="100"
                        value={editForm.code}
                        onChange={(event) => editField('code', event.target.value.toUpperCase())}
                      />
                    </div>
                    <small>{fieldErrors.code}</small>
                  </label>
                  <label>
                    <span>{t('Status')}</span>
                    <div className="edit-status-control">
                      <button
                        type="button"
                        className={editForm.is_active ? 'selected active' : ''}
                        onClick={() => editField('is_active', true)}
                      >
                        <i /> {t('Active')}
                      </button>
                      <button
                        type="button"
                        className={!editForm.is_active ? 'selected inactive' : ''}
                        onClick={() => editField('is_active', false)}
                      >
                        <i /> {t('Inactive')}
                      </button>
                    </div>
                    <small />
                  </label>
                </div>
                <label className="voucher-edit-description">
                  <span>{t('Description')}</span>
                  <textarea
                    required
                    maxLength="100"
                    value={editForm.name}
                    onChange={(event) => editField('name', event.target.value)}
                  />
                  <small>{fieldErrors.name}</small>
                </label>
                <fieldset className="voucher-edit-types">
                  <legend>
                    {t('Discount Type')} <em>*</em>
                  </legend>
                  <button
                    type="button"
                    className={editForm.discount_type === 'PERCENTAGE' ? 'selected' : ''}
                    onClick={() => editField('discount_type', 'PERCENTAGE')}
                  >
                    <i />
                    <strong>{t('Percentage (%)')}</strong>
                    <b>%</b>
                  </button>
                  <button
                    type="button"
                    className={editForm.discount_type === 'FIXED_AMOUNT' ? 'selected' : ''}
                    onClick={() => editField('discount_type', 'FIXED_AMOUNT')}
                  >
                    <i />
                    <span>{t('Fixed Amount (₫)')}</span>
                    <b>₫</b>
                  </button>
                </fieldset>
                <div className="voucher-edit-row three">
                  <label>
                    <span>
                      {t('Discount Value')} <em>*</em>
                    </span>
                    <div className="edit-input">
                      <input
                        required
                        type="number"
                        min="1"
                        max={editForm.discount_type === 'PERCENTAGE' ? 100 : undefined}
                        step="1"
                        value={editForm.discount_value}
                        onChange={(event) => editField('discount_value', event.target.value)}
                      />
                      <b>{editForm.discount_type === 'PERCENTAGE' ? '%' : '₫'}</b>
                    </div>
                    <small>{fieldErrors.discount_value}</small>
                  </label>
                  <label>
                    <span>{t('Max Discount Cap')}</span>
                    <div className="edit-input">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={editForm.maximum_discount}
                        onChange={(event) => editField('maximum_discount', event.target.value)}
                      />
                      <b>₫</b>
                    </div>
                    <small>{fieldErrors.maximum_discount}</small>
                  </label>
                  <label>
                    <span>{t('Min Order Amount')}</span>
                    <div className="edit-input">
                      <input
                        required
                        type="number"
                        min="0"
                        step="1"
                        value={editForm.minimum_order_amount}
                        onChange={(event) => editField('minimum_order_amount', event.target.value)}
                      />
                      <b>₫</b>
                    </div>
                    <small>{fieldErrors.minimum_order_amount}</small>
                  </label>
                </div>
                <div className="voucher-edit-row three">
                  <label>
                    <span>{t('Start Date')}</span>
                    <div className="edit-input date">
                      <input
                        required
                        type="datetime-local"
                        value={editForm.start_at}
                        onChange={(event) => editField('start_at', event.target.value)}
                      />
                      <CalendarIcon />
                    </div>
                    <small>{fieldErrors.start_at}</small>
                  </label>
                  <label>
                    <span>
                      {t('End Date')} <em>*</em>
                    </span>
                    <div className="edit-input date">
                      <input
                        required
                        type="datetime-local"
                        min={editForm.start_at}
                        value={editForm.end_at}
                        onChange={(event) => editField('end_at', event.target.value)}
                      />
                      <CalendarIcon />
                    </div>
                    <small>{fieldErrors.end_at}</small>
                  </label>
                  <label>
                    <span>{t('Usage Limit')}</span>
                    <div className="edit-input">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={editForm.usage_limit}
                        onChange={(event) => editField('usage_limit', event.target.value)}
                      />
                      <b>{t('uses')}</b>
                    </div>
                    <small>{fieldErrors.usage_limit}</small>
                  </label>
                </div>
              </fieldset>
              {error && <div className="figma-form-error">{error}</div>}
            </div>
            <footer>
              <span />
              <button type="button" onClick={() => setEditing(null)}>
                {t('Cancel')}
              </button>
              <button className="save" disabled={busy || editingExpired}>
                {busy ? (
                  t('Saving…')
                ) : (
                  <>
                    <CheckIcon /> {t('Save Changes')}
                  </>
                )}
              </button>
            </footer>
          </form>
        </div>
      )}
      {detail && (
        <div className="figma-modal-backdrop" onMouseDown={() => setDetail(null)}>
          <section
            className="record-detail-dialog voucher-detail-dialog"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <TicketIcon />
                <span>
                  <h2>{t('Voucher Details')}</h2>
                  <p>VC{String(detail.voucher_number).padStart(3, '0')} · {detail.code}</p>
                </span>
              </div>
              <button type="button" aria-label={t('Close')} onClick={() => setDetail(null)}>
                <CloseIcon />
              </button>
            </header>
            <div className="record-detail-body">
              <h3>{detail.name}</h3>
              <dl>
                <div><dt>{t('Status')}</dt><dd>{t(displayStatus(detail))}</dd></div>
                <div><dt>{t('Discount Type')}</dt><dd>{t(detail.discount_type === 'PERCENTAGE' ? 'Percentage' : 'Fixed')}</dd></div>
                <div><dt>{t('Discount Value')}</dt><dd>{detail.discount_type === 'PERCENTAGE' ? `${Number(detail.discount_value)}%` : money(detail.discount_value)}</dd></div>
                <div><dt>{t('Min Order Amount')}</dt><dd>{money(detail.minimum_order_amount)}</dd></div>
                <div><dt>{t('Max Discount Cap')}</dt><dd>{detail.maximum_discount ? money(detail.maximum_discount) : '—'}</dd></div>
                <div><dt>{t('Usage Limit')}</dt><dd>{detail.usage_limit ?? t('Unlimited')}</dd></div>
                <div><dt>{t('Start Date')}</dt><dd>{date(detail.start_at)}</dd></div>
                <div><dt>{t('End Date')}</dt><dd>{date(detail.end_at)}</dd></div>
              </dl>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
