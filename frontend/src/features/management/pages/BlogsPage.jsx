import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss.js'
import { adminRequest } from '../api/managementApi.js'
import {
  CheckIcon,
  CloseIcon,
  PageHeader,
  Pagination,
  PlusIcon,
  SearchIcon,
  TableState,
} from '../components/ManagementShared.jsx'
import './management.css'

const EditIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20ZM13.5 7l3.5 3.5" />
  </svg>
)
const PowerIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0" />
  </svg>
)

export function BlogsPage() {
  const { token, logout } = useAuth()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const noticeHover = useAutoDismiss(notice, setNotice)
  const errorHover = useAutoDismiss(error, setError)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ search, status, sort: 'NEWEST', page, limit: 10 })
      adminRequest(`/blogs?${query}`, token, { signal: controller.signal })
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
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [token, search, status, page, refresh, logout])
  const reload = () => {
    setLoading(true)
    setRefresh((value) => value + 1)
  }
  async function toggle(row) {
    const nextStatus = row.status === 'PUBLISHED' ? 'HIDDEN' : 'PUBLISHED'
    setBusy(true)
    try {
      await adminRequest(`/blogs/${row.id}/status`, token, {
        method: 'PATCH',
        body: { status: nextStatus },
      })
      setNotice(
        nextStatus === 'PUBLISHED' ? 'Blog published successfully.' : 'Blog hidden successfully.'
      )
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
        title="Blog"
        subtitle={`${data.total} articles`}
        refreshing={loading}
        onRefresh={reload}
      />
      <section className="management-content blog-management-content">
        {notice && (
          <div className="figma-toast" {...noticeHover}>
            <CheckIcon />
            <span>{notice}</span>
            <button onClick={() => setNotice('')}>
              <CloseIcon />
            </button>
          </div>
        )}
        {error && (
          <div className="figma-toast danger" {...errorHover}>
            <span className="toast-symbol">!</span>
            <span>{error}</span>
            <button onClick={() => setError('')}>
              <CloseIcon />
            </button>
          </div>
        )}
        <div className="management-toolbar blog-toolbar">
          <label>
            <SearchIcon />
            <input
              placeholder="Search blog title..."
              value={search}
              onChange={(event) => {
                setLoading(true)
                setPage(1)
                setSearch(event.target.value)
              }}
            />
          </label>
          <select
            value={status}
            onChange={(event) => {
              setLoading(true)
              setPage(1)
              setStatus(event.target.value)
            }}
          >
            <option value="ALL">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="HIDDEN">Hidden</option>
          </select>
          <Link className="primary" to="/admin/blogs/new">
            <PlusIcon /> Create Article
          </Link>
          <span className="repository-state">
            <i /> Operational Repository
          </span>
        </div>
        <div className="figma-table-card">
          <table className="management-table blog-table">
            <thead>
              <tr>
                <th>BLOG ID</th>
                <th>TITLE</th>
                <th>CREATED DATE</th>
                <th>STATUS</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                loading={loading}
                error=""
                empty={!data.items.length}
                colSpan={5}
                retry={reload}
              />
              {!loading &&
                data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>BLOG{String(row.blog_number).padStart(3, '0')}</strong>
                    </td>
                    <td>
                      <strong>{row.title}</strong>
                    </td>
                    <td>{new Date(row.created_at).toLocaleDateString('vi-VN')}</td>
                    <td>
                      <span className={`figma-status ${row.status.toLowerCase()}`}>
                        <i />
                        {row.status[0] + row.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td>
                      <div className="voucher-inline-actions">
                        <Link title="Edit blog" to={`/admin/blogs/${row.id}/edit`}>
                          <EditIcon />
                        </Link>
                        <button
                          disabled={busy}
                          title={row.status === 'PUBLISHED' ? 'Hide blog' : 'Publish blog'}
                          onClick={() => toggle(row)}
                        >
                          <PowerIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            total={data.total}
            limit={10}
            loading={loading}
            onPage={(value) => {
              setLoading(true)
              setPage(value)
            }}
          />
        </div>
      </section>
    </main>
  )
}
