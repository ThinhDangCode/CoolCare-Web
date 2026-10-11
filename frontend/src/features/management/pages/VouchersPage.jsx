import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss.js'
import { adminRequest } from '../api/managementApi.js'
import {
  CalendarIcon,
  CheckIcon,
  CloseIcon,
  FilterIcon,
  PageHeader,
  Pagination,
  PlusIcon,
  SortIcon,
  TableState,
  TicketIcon,
} from '../components/ManagementShared.jsx'
import {
  validateVoucherForm,
  voucherPayload,
  voucherToForm,
} from '../components/voucherFormUtils.js'
import './management.css'

const money = (value) => `${new Intl.NumberFormat('en-US').format(Number(value))} ₫`
const date = (value) => new Date(value).toLocaleDateString('en-GB')
function displayStatus(row) {
  return row.is_active ? 'Active' : 'Inactive'
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
  const reload = () => {
    setLoading(true)
    setRefresh((value) => value + 1)
  }
  function openEdit(row) {
    setEditing({ ...row, displayId: `VC${String(row.voucher_number).padStart(3, '0')}` })
    setEditForm(voucherToForm(row))
    setFieldErrors({})
    setError('')
  }
  const editField = (key, value) => setEditForm((current) => ({ ...current, [key]: value }))
  async function saveEdit(event) {
    event.preventDefault()
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

  return (
    <main className="figma-admin-main">
      <PageHeader
        title="Vouchers"
        subtitle={`${data.total} vouchers`}
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
                <option value="ALL">Filter: All</option>
                <option value="ACTIVE">Filter: Active</option>
                <option value="INACTIVE">Filter: Inactive</option>
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
              <SortIcon /> Sort: {sort === 'NEWEST' ? 'Newest' : 'Oldest'}
            </button>
          </div>
          <Link to="/admin/vouchers/new">
            <PlusIcon /> Create Voucher
          </Link>
        </div>
        <div className="figma-table-card">
          <div className="figma-voucher-table">
            <table>
              <thead>
                <tr>
                  <th>VOUCHER ID</th>
                  <th>VOUCHER CODE</th>
                  <th>DISCOUNT</th>
                  <th>EXPIRATION DATE</th>
                  <th>STATUS</th>
                  <th>ACTION</th>
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
                            {state}
                          </span>
                        </td>
                        <td>
                          <div className="voucher-inline-actions">
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
                              disabled={busy}
                              title={row.is_active ? 'Deactivate voucher' : 'Activate voucher'}
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
                    Edit Voucher{' '}
                    <b className={editForm.is_active ? 'active' : 'inactive'}>
                      <i /> {editForm.is_active ? 'Active' : 'Inactive'}
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
              <div className="voucher-edit-row two">
                <label>
                  <span>
                    Voucher Code <em>*</em>
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
                  <span>Status</span>
                  <div className="edit-status-control">
                    <button
                      type="button"
                      className={editForm.is_active ? 'selected active' : ''}
                      onClick={() => editField('is_active', true)}
                    >
                      <i /> Active
                    </button>
                    <button
                      type="button"
                      className={!editForm.is_active ? 'selected inactive' : ''}
                      onClick={() => editField('is_active', false)}
                    >
                      <i /> Inactive
                    </button>
                  </div>
                  <small />
                </label>
              </div>
              <label className="voucher-edit-description">
                <span>Description</span>
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
                  Discount Type <em>*</em>
                </legend>
                <button
                  type="button"
                  className={editForm.discount_type === 'PERCENTAGE' ? 'selected' : ''}
                  onClick={() => editField('discount_type', 'PERCENTAGE')}
                >
                  <i />
                  <strong>Percentage (%)</strong>
                  <b>%</b>
                </button>
                <button
                  type="button"
                  className={editForm.discount_type === 'FIXED_AMOUNT' ? 'selected' : ''}
                  onClick={() => editField('discount_type', 'FIXED_AMOUNT')}
                >
                  <i />
                  <span>Fixed Amount (₫)</span>
                  <b>₫</b>
                </button>
              </fieldset>
              <div className="voucher-edit-row three">
                <label>
                  <span>
                    Discount Value <em>*</em>
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
                  <span>Max Discount Cap</span>
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
                  <span>Min Order Amount</span>
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
                  <span>Start Date</span>
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
                    End Date <em>*</em>
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
                  <span>Usage Limit</span>
                  <div className="edit-input">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={editForm.usage_limit}
                      onChange={(event) => editField('usage_limit', event.target.value)}
                    />
                    <b>uses</b>
                  </div>
                  <small>{fieldErrors.usage_limit}</small>
                </label>
              </div>
              {error && <div className="figma-form-error">{error}</div>}
            </div>
            <footer>
              <span />
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="save" disabled={busy}>
                {busy ? (
                  'Saving…'
                ) : (
                  <>
                    <CheckIcon /> Save Changes
                  </>
                )}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
