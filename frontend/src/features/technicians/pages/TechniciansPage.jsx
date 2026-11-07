import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import {
  PageHeader,
  Pagination,
  SearchIcon,
  EyeIcon,
  TableState,
} from '../../../shared/components/AdminUi.jsx'
import { TechnicianBadge } from '../components/TechnicianShared.jsx'
import { label } from '../components/technicianFormat.js'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import '../../../shared/styles/admin.css'
import './technicians.css'

const initialFilters = {
  status: 'ALL',
  verification: 'VERIFIED',
  availability: 'ALL',
  area: '',
  sort: 'NAME',
}

export function TechniciansPage() {
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [filters, setFilters] = useState(initialFilters)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [options, setOptions] = useState({ areas: [] })
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
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
    adminRequest('/technicians/options', token, { signal: controller.signal })
      .then(setOptions)
      .catch((err) => {
        if (err.status === 401) logout()
      })
    return () => controller.abort()
  }, [token, logout, refresh])
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({
      ...filters,
      verification: 'VERIFIED',
      search: keyword,
      page,
      limit,
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
  }, [token, logout, keyword, filters, page, limit, refresh])
  const change = (key, value) => {
    setLoading(true)
    setPage(1)
    setFilters((old) => ({ ...old, [key]: value }))
  }
  const retry = () => {
    setLoading(true)
    setRefresh((n) => n + 1)
  }
  const sortHeading = (key, title) => {
    const active = key === 'NAME' ? ['NAME', 'NAME_DESC'].includes(filters.sort) : filters.sort.startsWith('ID_')
    const descending = active && filters.sort.endsWith('_DESC')
    return (
      <th className={key === 'ID' ? 'technician-numeric' : undefined} aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}>
        <button type="button" className="technician-column-sort" onClick={() => change('sort', key === 'NAME' ? (active && !descending ? 'NAME_DESC' : 'NAME') : (active && !descending ? 'ID_DESC' : 'ID_ASC'))}>
          {title}
          <svg viewBox="0 0 16 16" aria-hidden="true" className={active ? 'active' : ''}>
            <path d="M8 2v12M5 5l3-3 3 3" opacity={descending ? '.35' : '1'} />
            <path d="m5 11 3 3 3-3" opacity={active && !descending ? '.35' : '1'} />
          </svg>
        </button>
      </th>
    )
  }
  const select = (key, title, items, placeholder = `All ${title}`) => (
    <label className="technician-filter">
      <span>{t(title)}</span>
      <select aria-label={t(title)} value={filters[key]} onChange={(e) => change(key, e.target.value)}>
        <option value={key === 'area' ? '' : 'ALL'}>{t(placeholder)}</option>
        {items.map((item) => (
          <option key={item} value={item}>
            {t(label(item))}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <main className="figma-admin-main technician-main technician-directory-page">
      <PageHeader
        title="Technicians"
        subtitle={t('{count} technicians · Directory and account management', { count: data.total })}
        onRefresh={retry}
        refreshing={loading}
      />
      <section className="technician-content">
        <div className="technician-list-card">
          <div className="technician-toolbar">
            <label className="technician-search">
              <SearchIcon />
              <input
                maxLength={150}
                aria-label={t('Search technicians')}
                placeholder={t('Search technician...')}
                value={search}
                onChange={(e) => {
                  setLoading(true)
                  setSearch(e.target.value)
                }}
              />
            </label>
            {select('status', 'Statuses', ['ACTIVE', 'INACTIVE', 'LOCKED'])}
            {select('area', 'Service Areas', options.areas)}
          </div>
          <div className="figma-users-table technician-table">
            <table>
              <colgroup>
                <col className="technician-col-id" />
                <col className="technician-col-name" />
                <col className="technician-col-phone" />
                <col className="technician-col-area" />
                <col className="technician-col-rating" />
                <col className="technician-col-jobs" />
                <col className="technician-col-status" />
                <col className="technician-col-action" />
              </colgroup>
              <thead>
                <tr>
                  {sortHeading('ID', 'ID')}
                  {sortHeading('NAME', t('TECHNICIAN'))}
                  <th className="technician-numeric">{t('PHONE NUMBER')}</th>
                  <th>{t('ASSIGNED AREA')}</th>
                  <th className="technician-numeric">{t('RATING')}</th>
                  <th className="technician-numeric technician-jobs-heading">{t('COMPLETED JOBS')}</th>
                  <th>{t('STATUS')}</th>
                  <th>{t('ACTION')}</th>
                </tr>
              </thead>
              <tbody>
                <TableState
                  loading={loading}
                  error={error}
                  empty={!data.items.length}
                  colSpan={8}
                  retry={retry}
                />
                {!loading &&
                  !error &&
                  data.items.map((row) => (
                    <tr key={row.id}>
                      <td className="technician-numeric">{row.display_id}</td>
                      <td>
                        <Link className="technician-list-name" to={`/admin/technicians/${row.id}`}>
                          <strong>{row.full_name}</strong>
                        </Link>
                      </td>
                      <td className="technician-numeric technician-phone-number">{row.phone || '—'}</td>
                      <td className="technician-assigned-area">{row.areas.map((a) => a.ward).join(', ') || '—'}</td>
                      <td className={row.total_reviews ? 'technician-numeric' : ''}>
                        {row.total_reviews ? (
                          <strong className="technician-list-rating">
                            <span className="technician-rating">★</span>{' '}
                            {Number(row.rating_average).toFixed(2)}
                          </strong>
                        ) : (
                          <em className="technician-unrated">
                            {t('No reviews')}
                            <br />
                            {t('yet')}
                          </em>
                        )}
                      </td>
                      <td className="technician-numeric">{row.completed_jobs}</td>
                      <td>
                        <TechnicianBadge value={row.status} />
                      </td>
                      <td>
                        <Link
                          className="technician-row-action"
                          aria-label={`${t('View details')}: ${row.full_name}`}
                          title={t('View technician details')}
                          to={`/admin/technicians/${row.id}`}
                        >
                          <EyeIcon />
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="technician-list-footer">
              <div className="technician-page-size">
                <label>
                  {t('Showing')}{' '}
                  <select
                    value={limit}
                    onChange={(e) => {
                      setLoading(true)
                      setLimit(Number(e.target.value))
                      setPage(1)
                    }}
                  >
                    {[10, 20, 50].map((n) => (
                      <option key={n} value={n}>
                        {n} / {t('page')}
                      </option>
                    ))}
                  </select>{' '}
                  {t('of')} {data.total} {t('technicians')}
                </label>
              </div>
              <Pagination
                page={page}
                total={data.total}
                limit={limit}
                loading={loading}
                onPage={(n) => {
                  setLoading(true)
                  setPage(n)
                }}
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
