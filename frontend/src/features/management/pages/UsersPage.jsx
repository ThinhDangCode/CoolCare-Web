import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext.jsx'
import { adminRequest } from '../api/managementApi.js'
import {
  CheckIcon,
  CloseIcon,
  ConfirmDialog,
  LockIcon,
  PageHeader,
  Pagination,
  SearchIcon,
  SlidersIcon,
  TableState,
} from '../components/ManagementShared.jsx'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss.js'
import './management.css'

export function UsersPage() {
  const { token, user, logout } = useAuth()
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [role, setRole] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [limit] = useState(10)
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [target, setTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const noticeHover = useAutoDismiss(notice, setNotice)
  useEffect(() => {
    const id = setTimeout(() => {
      setKeyword(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(id)
  }, [search])
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ search: keyword, role, status, page, limit })
    adminRequest(`/users?${query}`, token, { signal: controller.signal })
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
  }, [token, keyword, role, status, page, limit, refresh, logout])
  const changeFilter = (setter, value) => {
    setLoading(true)
    setPage(1)
    setter(value)
  }
  async function toggleStatus() {
    setBusy(true)
    setError('')
    const next = target.status === 'LOCKED' ? 'ACTIVE' : 'LOCKED'
    try {
      await adminRequest(`/users/${target.id}/status`, token, {
        method: 'PATCH',
        body: { status: next },
      })
      setTarget(null)
      setNotice(next === 'LOCKED' ? 'User account locked.' : 'User account unlocked.')
      setLoading(true)
      setRefresh((value) => value + 1)
    } catch (err) {
      setError(err.message)
      if (err.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="figma-admin-main">
      <PageHeader
        title="Users"
        subtitle={`${data.total.toLocaleString('en-US')} users total`}
        refreshing={loading}
        onRefresh={() => {
          setLoading(true)
          setRefresh((value) => value + 1)
        }}
      />
      <section className="figma-users-content">
        {notice && (
          <div className="figma-toast" role="status" {...noticeHover}>
            <CheckIcon />
            <span>{notice}</span>
            <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
              <CloseIcon />
            </button>
          </div>
        )}
        <div className="figma-user-toolbar">
          <label className="figma-user-search">
            <SearchIcon />
            <input
              aria-label="Search users"
              placeholder="Search by name, email, phone..."
              value={search}
              onChange={(event) => {
                setLoading(true)
                setSearch(event.target.value)
              }}
            />
          </label>
          <div className="figma-role-tabs" aria-label="Filter by role">
            {['ALL', 'CUSTOMER', 'TECHNICIAN', 'ADMIN'].map((item) => (
              <button
                key={item}
                className={role === item ? 'active' : ''}
                onClick={() => changeFilter(setRole, item)}
              >
                {item[0] + item.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <label className="figma-status-filter">
            <SlidersIcon />
            <span>Status:</span>
            <select
              aria-label="Status filter"
              value={status}
              onChange={(event) => changeFilter(setStatus, event.target.value)}
            >
              <option value="ALL">All</option>
              <option value="ACTIVE">Active</option>
              <option value="LOCKED">Blocked</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        </div>
        <div className="figma-users-table">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>USER</th>
                <th>EMAIL</th>
                <th>PHONE</th>
                <th>ROLE</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                loading={loading}
                error={error && !target ? error : ''}
                empty={!data.items.length}
                colSpan={7}
                retry={() => {
                  setLoading(true)
                  setRefresh((value) => value + 1)
                }}
              />
              {!loading &&
                !error &&
                data.items.map((row, index) => (
                  <tr key={row.id}>
                    <td>{(page - 1) * limit + index + 1}</td>
                    <td>{row.full_name}</td>
                    <td>{row.email}</td>
                    <td className="phone-cell">{row.phone || '—'}</td>
                    <td>
                      <strong className={row.role === 'ADMIN' ? 'admin-role' : ''}>
                        {row.role[0] + row.role.slice(1).toLowerCase()}
                      </strong>
                    </td>
                    <td>
                      <span
                        className={`figma-status ${row.status === 'LOCKED' ? 'blocked' : row.status.toLowerCase()}`}
                      >
                        <i />
                        {row.status === 'LOCKED'
                          ? 'Blocked'
                          : row.status[0] + row.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td>
                      <button
                        className="figma-lock"
                        disabled={row.id === user?.id}
                        title={row.status === 'LOCKED' ? 'Unlock account' : 'Lock account'}
                        onClick={() => setTarget(row)}
                      >
                        <LockIcon open={row.status === 'LOCKED'} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
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
      {target && (
        <ConfirmDialog
          title={target.status === 'LOCKED' ? 'Unlock user account?' : 'Lock user account?'}
          confirmLabel={target.status === 'LOCKED' ? 'Unlock Account' : 'Lock Account'}
          danger={target.status !== 'LOCKED'}
          busy={busy}
          onCancel={() => {
            setTarget(null)
            setError('')
          }}
          onConfirm={toggleStatus}
        >
          <p>
            {target.status === 'LOCKED' ? 'Restore access for' : 'Prevent'}{' '}
            <strong>{target.full_name}</strong>{' '}
            {target.status === 'LOCKED'
              ? 'to the CoolCare system.'
              : 'from signing in until an administrator unlocks the account.'}
          </p>
          {error && <span className="figma-inline-error">{error}</span>}
        </ConfirmDialog>
      )}
    </main>
  )
}
