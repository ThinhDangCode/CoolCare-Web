import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import {
  PageHeader,
  Pagination,
  SearchIcon,
  FilterIcon,
  EyeIcon,
  TableState,
} from '../../../shared/components/AdminUi.jsx'
import { TechnicianBadge, label } from '../components/TechnicianShared.jsx'
import '../../../shared/styles/admin.css'
import './technicians.css'

const initialFilters = {
  status: 'ALL',
  verification: 'VERIFIED',
  qualification: 'ALL',
  availability: 'ALL',
  area: '',
  skill: '',
}

export function TechniciansPage() {
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [filters, setFilters] = useState(initialFilters)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [options, setOptions] = useState({ areas: [], skills: [] })
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [expandedFilters, setExpandedFilters] = useState(false)
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
  const select = (key, title, items, placeholder = `All ${title}`) => (
    <label className="technician-filter">
      <span>{t(title)}</span>
      <select
        aria-label={t(title)}
        value={filters[key]}
        onChange={(e) => change(key, e.target.value)}
      >
        <option value={key === 'skill' || key === 'area' ? '' : 'ALL'}>{t(placeholder)}</option>
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
        subtitle={t('{count} technicians · Directory and account management', {
          count: data.total,
        })}
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
            {select('skill', 'Skills', options.skills)}
            {select('area', 'Service Areas', options.areas)}
            {select('qualification', 'Levels', ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'])}
            <button
              className={`technician-filter-toggle ${expandedFilters ? 'active' : ''}`}
              aria-label={t('Additional filters')}
              aria-expanded={expandedFilters}
              aria-controls="technician-extra-filters"
              onClick={() => setExpandedFilters((open) => !open)}
            >
              <FilterIcon />
              {filters.availability !== 'ALL' && <i />}
            </button>
          </div>
          {expandedFilters && (
            <div className="technician-extra-filters" id="technician-extra-filters">
              {select('availability', 'Availability', ['ONLINE', 'OFFLINE', 'BUSY'])}
              <button
                className="technician-reset"
                onClick={() => {
                  setLoading(true)
                  setSearch('')
                  setKeyword('')
                  setPage(1)
                  setFilters(initialFilters)
                  setRefresh((n) => n + 1)
                }}
              >
                {t('Reset filters')}
              </button>
            </div>
          )}
          <div className="figma-users-table technician-table">
            <table>
              <thead>
                <tr>
                  <th>{t('NO.')}</th>
                  <th>{t('TECHNICIAN')}</th>
                  <th>{t('PHONE NUMBER')}</th>
                  <th>{t('ASSIGNED AREA')}</th>
                  <th>{t('RATING')}</th>
                  <th>{t('COMPLETED JOBS')}</th>
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
                  data.items.map((row, index) => (
                    <tr key={row.id}>
                      <td>{(page - 1) * limit + index + 1}</td>
                      <td>
                        <Link className="technician-list-name" to={`/admin/technicians/${row.id}`}>
                          <strong>{row.full_name}</strong>
                        </Link>
                      </td>
                      <td>{row.phone || '—'}</td>
                      <td>{row.areas.map((a) => a.ward).join(', ') || '—'}</td>
                      <td>
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
                      <td>{row.completed_jobs}</td>
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
