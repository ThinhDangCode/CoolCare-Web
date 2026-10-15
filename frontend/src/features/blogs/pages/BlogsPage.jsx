import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { useAutoDismiss } from '../../../shared/hooks/useAutoDismiss.js'
import { adminRequest } from '../../../shared/api/adminApi.js'
import {
  CheckIcon,
  CloseIcon,
  EyeIcon,
  PageHeader,
  Pagination,
  PlusIcon,
  SearchIcon,
  TableState,
} from '../../../shared/components/AdminUi.jsx'
import '../../../shared/styles/admin.css'

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
  const { locale, t } = useUiPreferences()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [sort, setSort] = useState('NEWEST')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const noticeHover = useAutoDismiss(notice, setNotice)
  const errorHover = useAutoDismiss(error, setError)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ search, status, sort, page, limit })
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
  }, [token, search, status, sort, page, limit, refresh, logout])
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
  async function openDetail(row) {
    setDetail({ ...row, summaryOnly: true })
    setDetailLoading(true)
    setDetailError('')
    try {
      const fullBlog = await adminRequest(`/blogs/${row.id}`, token)
      setDetail({ ...row, ...fullBlog })
    } catch (err) {
      setDetailError(err.message)
      if (err.status === 401) logout()
    } finally {
      setDetailLoading(false)
    }
  }
  return (
    <main className="figma-admin-main">
      <PageHeader
        title="Blog Management"
        subtitle={`${data.total} ${t('articles')}`}
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
              placeholder={t('Search blog title...')}
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
            <option value="ALL">{t('All Statuses')}</option>
            <option value="DRAFT">{t('Draft')}</option>
            <option value="PUBLISHED">{t('Published')}</option>
            <option value="HIDDEN">{t('Hidden')}</option>
          </select>
          <select
            aria-label={t('Sort articles')}
            value={sort}
            onChange={(event) => {
              setLoading(true)
              setPage(1)
              setSort(event.target.value)
            }}
          >
            <option value="NEWEST">{t('Newest')}</option>
            <option value="OLDEST">{t('Oldest')}</option>
            <option value="TITLE_ASC">{t('Title A–Z')}</option>
            <option value="TITLE_DESC">{t('Title Z–A')}</option>
          </select>
          <Link className="primary" to="/admin/blogs/new">
            <PlusIcon /> {t('Create Article')}
          </Link>
        </div>
        <div className="figma-table-card">
          <table className="management-table blog-table">
            <thead>
              <tr>
                <th>{t('BLOG ID')}</th>
                <th>{t('TITLE')}</th>
                <th>{t('CREATED DATE')}</th>
                <th>{t('STATUS')}</th>
                <th>{t('ACTION')}</th>
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
                    <td>
                      {new Date(row.created_at).toLocaleDateString(
                        locale === 'vi' ? 'vi-VN' : 'en-US'
                      )}
                    </td>
                    <td>
                      <span className={`figma-status ${row.status.toLowerCase()}`}>
                        <i />
                        {t(row.status[0] + row.status.slice(1).toLowerCase())}
                      </span>
                    </td>
                    <td>
                      <div className="voucher-inline-actions">
                        <button title={t('View blog details')} onClick={() => openDetail(row)}>
                          <EyeIcon />
                        </button>
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
            limit={limit}
            loading={loading}
            pageSizeOptions={[5, 10, 15, 20, 25]}
            onLimit={(value) => {
              setLoading(true)
              setPage(1)
              setLimit(value)
            }}
            onPage={(value) => {
              setLoading(true)
              setPage(value)
            }}
          />
        </div>
      </section>
      {detail && (
        <div className="figma-modal-backdrop" onMouseDown={() => setDetail(null)}>
          <section
            className="record-detail-dialog blog-detail-dialog"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <EyeIcon />
                <span>
                  <h2>{t('Blog Details')}</h2>
                  <p>BLOG{String(detail.blog_number ?? '').padStart(3, '0')}</p>
                </span>
              </div>
              <button type="button" aria-label={t('Close')} onClick={() => setDetail(null)}>
                <CloseIcon />
              </button>
            </header>
            <div className="record-detail-body">
              {detailLoading ? (
                <div className="figma-table-state"><i className="figma-spinner" /> {t('Loading data…')}</div>
              ) : detailError ? (
                <div className="figma-form-error">{detailError}</div>
              ) : (
                <>
                  {detail.thumbnail_url && <img className="blog-detail-image" src={detail.thumbnail_url} alt="" />}
                  <h3>{detail.title}</h3>
                  <dl>
                    <div><dt>{t('Status')}</dt><dd>{t(detail.status[0] + detail.status.slice(1).toLowerCase())}</dd></div>
                    <div><dt>{t('Author')}</dt><dd>{detail.author_name || '—'}</dd></div>
                    <div><dt>{t('Created')}</dt><dd>{new Date(detail.created_at).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')}</dd></div>
                    <div><dt>Slug</dt><dd>{detail.slug}</dd></div>
                  </dl>
                  <article className="blog-detail-content">{detail.content}</article>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
