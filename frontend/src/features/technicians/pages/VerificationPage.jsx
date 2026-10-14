import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import {
  BellIcon,
  SearchIcon,
  SlidersIcon,
  EyeIcon,
  CheckIcon,
  CloseIcon,
  Pagination,
  TableState,
} from '../../../shared/components/AdminUi.jsx'
import { TechnicianAvatar, TechnicianNotification, formatDate } from '../components/TechnicianShared.jsx'
import '../../../shared/styles/admin.css'
import './technicians.css'
import './verification.css'
import { ReviewDialog } from '../components/TechnicianActions.jsx'

export function VerificationPage() {
  const { token, user, logout } = useAuth()
  const [params] = useSearchParams()
  const [search, setSearch] = useState(() => (params.get('search') || '').slice(0, 150))
  const [keyword, setKeyword] = useState(() => (params.get('search') || '').slice(0, 150).trim())
  const [sort, setSort] = useState('LATEST')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [qualification, setQualification] = useState('ALL')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [review, setReview] = useState(null)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(search.trim())
      setPage(1)
      setRefresh((n) => n + 1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({
      search: keyword,
      verification: 'PENDING',
      sort,
      page,
      limit,
      qualification,
    })
    adminRequest(`/technicians?${query}`, token, { signal: controller.signal })
      .then((result) => {
        setData(result)
        setError('')
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message)
          if (err.status === 401) logout()
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [token, logout, keyword, sort, page, limit, qualification, refresh])
  const change = (setter, value) => {
    setLoading(true)
    setPage(1)
    setter(value)
  }
  const retry = () => {
    setLoading(true)
    setRefresh((n) => n + 1)
  }
  return (
    <main className="figma-admin-main technician-main verification-page">
      <header className="verification-topbar">
        <nav aria-label="Breadcrumb">
          <Link to="/">Admin</Link>
          <span>›</span>
          <Link to="/admin/technicians">Technician</Link>
          <span>›</span>
          <strong>Verification Queue</strong>
        </nav>
        <div className="verification-topbar-user">
          <BellIcon />
          <Link to="/profile">
            <TechnicianAvatar name={user?.fullName} url={user?.avatarUrl} />
            <span>
              <strong>{user?.fullName || 'Admin'}</strong>
              <small>Super Admin</small>
            </span>
          </Link>
        </div>
      </header>
      <section className="verification-content">
        <TechnicianNotification message={notice} onDismiss={setNotice} />
        <div className="verification-heading">
          <h1>Technician Verification</h1>
          <span className="verification-live">
            <i />
            {loading ? 'Syncing' : error ? 'Unavailable' : 'Pipeline Live'}
          </span>
        </div>
        <div className="verification-toolbar">
          <label className="verification-search">
            <SearchIcon />
            <input
              maxLength={150}
              aria-label="Search verification requests"
              placeholder="Search technician name, citizen ID (CCCD), phone number..."
              value={search}
              onChange={(e) => {
                setLoading(true)
                setSearch(e.target.value)
              }}
            />
          </label>
          <span className="verification-status pending">Pending Review</span>
          <select
            aria-label="Sort requests"
            value={sort}
            onChange={(e) => change(setSort, e.target.value)}
          >
            <option value="LATEST">Latest First</option>
            <option value="OLDEST">Oldest First</option>
            <option value="NAME">Name A–Z</option>
          </select>
          <button
            className={`verification-filter-button ${filtersOpen ? 'active' : ''}`}
            aria-label="Additional filters"
            aria-expanded={filtersOpen}
            aria-controls="verification-extra-filters"
            onClick={() => setFiltersOpen((value) => !value)}
          >
            <SlidersIcon />
          </button>
        </div>
        {filtersOpen && (
          <div className="verification-extra-filters" id="verification-extra-filters">
            <label>
              Qualification{' '}
              <select
                value={qualification}
                onChange={(e) => change(setQualification, e.target.value)}
              >
                <option value="ALL">All levels</option>
                {['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                setSearch('')
                setKeyword('')
                setSort('LATEST')
                setQualification('ALL')
                setPage(1)
                retry()
              }}
            >
              Reset filters
            </button>
          </div>
        )}
        <section className="verification-queue">
          <header>
            <h2>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
                <path d="m8 12 3 3 5-6" />
              </svg>
              VERIFICATION REQUESTS
            </h2>
            <span>
              Showing {data.items.length} of {data.total} Queue Items
            </span>
          </header>
          <div className="verification-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>TECHNICIAN</th>
                  <th>CONTACT</th>
                  <th>SUBMITTED</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                <TableState
                  loading={loading}
                  error={error}
                  empty={!data.items.length}
                  colSpan={5}
                  retry={retry}
                />
                {!loading &&
                  !error &&
                  data.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link
                          className="verification-person"
                          to={`/admin/technicians/${row.id}?tab=overview`}
                        >
                          <TechnicianAvatar name={row.full_name} url={row.avatar_url} />
                          <strong>{row.full_name}</strong>
                        </Link>
                      </td>
                      <td className="verification-phone">{row.phone || '—'}</td>
                      <td>{formatDate(row.submitted_at)}</td>
                      <td>
                        <span
                          className={`verification-status ${row.verification_status.toLowerCase()}`}
                        >
                          <i />
                          Pending Review
                        </span>
                      </td>
                      <td>
                        <div className="verification-actions">
                          <Link
                            className="view"
                            aria-label={`View identity — ${row.full_name}`}
                            title="View identity information"
                            to={`/admin/technicians/${row.id}?tab=overview`}
                          >
                            <EyeIcon />
                          </Link>
                          {row.verification_status === 'PENDING' && (
                            <>
                              <button
                                className="approve"
                                aria-label={`Approve ${row.full_name}`}
                                title="Approve profile"
                                onClick={() =>
                                  setReview({
                                    path: `/technicians/${row.id}/verification`,
                                    status: 'VERIFIED',
                                    name: row.full_name,
                                  })
                                }
                              >
                                <CheckIcon />
                              </button>
                              <button
                                className="reject"
                                aria-label={`Reject ${row.full_name}`}
                                title="Reject profile"
                                onClick={() =>
                                  setReview({
                                    path: `/technicians/${row.id}/verification`,
                                    status: 'REJECTED',
                                    name: row.full_name,
                                  })
                                }
                              >
                                <CloseIcon />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <footer className="verification-footer">
            <div>
              Showing {data.total ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, data.total)}{' '}
              of {data.total} requests{' '}
              <label>
                Rows per page:{' '}
                <select
                  aria-label="Rows per page"
                  value={limit}
                  onChange={(e) => change(setLimit, Number(e.target.value))}
                >
                  {[10, 20, 50].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
            <Pagination
              page={page}
              limit={limit}
              total={data.total}
              loading={loading}
              onPage={(value) => change(setPage, value)}
            />
          </footer>
        </section>
        {review && (
          <ReviewDialog
            target={review}
            onClose={() => setReview(null)}
            onSuccess={() => {
              setNotice(review.status === 'VERIFIED' ? 'Profile approved.' : 'Profile rejected.')
              setReview(null)
              setPage(1)
              retry()
            }}
          />
        )}
      </section>
    </main>
  )
}
