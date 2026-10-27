import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import { catalogRequest } from '../api/catalogApi.js'
import { Modal } from './Modal.jsx'
import './catalogTrash.css'

export function TrashIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
    </svg>
  )
}

export function CatalogTrashButton({ kind, row, onChanged }) {
  const { token, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const name = row.name || row.model_name
  const categoryInUse = kind === 'categories' && Number(row.service_count) > 0
  const brandInUse = kind === 'brands' && Number(row.model_count) > 0
  async function remove() {
    if (busy || categoryInUse || brandInUse) return
    setBusy(true)
    setError('')
    try {
      await catalogRequest(`/${kind}/${row.id}`, token, { method: 'DELETE' })
      setOpen(false)
      onChanged()
    } catch (err) {
      setError(err.message)
      if (err.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button
        type="button"
        className="catalog-trash-row"
        title="Move to trash"
        aria-label={`Move ${name} to trash`}
        onClick={() => {
          setError('')
          setOpen(true)
        }}
      >
        <TrashIcon />
      </button>
      {open &&
        createPortal(
          <Modal
            title={categoryInUse ? 'Category still contains services' : brandInUse ? 'Brand still contains models' : 'Move to trash?'}
            icon={<TrashIcon />}
            onClose={() => setOpen(false)}
            busy={busy}
          >
            <div className="catalog-confirm">
              <p>
                Move <strong>{name}</strong> to trash?
              </p>
              <p>
                You can restore this item from Trash. Existing bookings and history are preserved.
              </p>
              {kind === 'categories' && <p>
                A category can only be moved to Trash after all its services, including inactive services,
                have been moved to another category or to Trash. To temporarily hide the entire category,
                set its status to Inactive in Edit.
              </p>}
              {categoryInUse && <p role="alert">This category has {row.service_count} service(s). Move or trash those services first.</p>}
              {kind === 'brands' && <p>
                A brand can only be moved to Trash after all its models, including inactive models,
                have been moved to another brand or to Trash. To temporarily hide the brand,
                set its status to Inactive in Edit.
              </p>}
              {brandInUse && <p role="alert">This brand has {row.model_count} model(s). Move or trash those models first.</p>}
              {error && (
                <div className="catalog-error" role="alert">
                  {error}
                </div>
              )}
            </div>
            <footer className="catalog-form-actions">
              <button
                type="button"
                className="catalog-button"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="catalog-button danger"
                disabled={busy || categoryInUse || brandInUse}
                onClick={remove}
              >
                {busy ? 'Moving...' : 'Move to trash'}
              </button>
            </footer>
          </Modal>,
          document.body
        )}
    </>
  )
}

export function CatalogTrash({ kind, onChanged }) {
  const { token, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState({ items: [], total: 0 })
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    catalogRequest(`/${kind}?trash=true&status=all&limit=10&page=${page}`, token, {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return
        if (page > 1 && !result.items.length) {
          setPage(page - 1)
          return
        }
        setData(result)
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
  }, [kind, token, logout, page, open, refresh])
  async function restore(row) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await catalogRequest(`/${kind}/${row.id}/restore`, token, { method: 'PATCH' })
      setNotice(`${row.name || row.model_name} restored.`)
      setLoading(true)
      setRefresh((n) => n + 1)
      onChanged()
    } catch (err) {
      setError(err.message)
      if (err.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button
        type="button"
        className="catalog-button catalog-trash-top"
        onClick={() => {
          setOpen(true)
          setLoading(true)
          setError('')
          setPage(1)
          setNotice('')
        }}
      >
        <TrashIcon /> Trash
      </button>
      {open &&
        createPortal(
          <Modal
            title="Trash"
            icon={<TrashIcon />}
            className="catalog-trash-modal"
            onClose={() => setOpen(false)}
            busy={busy}
          >
            <div className="catalog-trash-body">
              <p>Deleted items can be restored with their previous Active or Inactive status.</p>
              {error && (
                <div className="catalog-error" role="alert">
                  {error}
                  <button
                    type="button"
                    onClick={() => {
                      setError('')
                      setLoading(true)
                      setRefresh((n) => n + 1)
                    }}
                  >
                    Retry
                  </button>
                </div>
              )}
              {notice && (
                <p className="catalog-notice" role="status">
                  {notice}
                </p>
              )}
              {loading ? (
                <div className="catalog-state" role="status">
                  Loading trash...
                </div>
              ) : error ? null : !data.items.length ? (
                <div className="catalog-state">Trash is empty.</div>
              ) : (
                <ul className="catalog-trash-list">
                  {data.items.map((row) => (
                    <li key={row.id}>
                      <span>
                        <strong>{row.name || row.model_name}</strong>
                        <small>Deleted {new Date(row.deleted_at).toLocaleString('vi-VN')}</small>
                      </span>
                      <button
                        type="button"
                        className="catalog-button"
                        disabled={busy}
                        onClick={() => restore(row)}
                      >
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <footer className="catalog-form-actions">
              <span>{loading || error ? '' : `${data.total} items`}</span>
              <button
                type="button"
                className="catalog-button"
                disabled={busy || loading || !!error || page <= 1}
                onClick={() => {
                  setLoading(true)
                  setPage(page - 1)
                }}
              >
                Previous
              </button>
              <span>{page}</span>
              <button
                type="button"
                className="catalog-button"
                disabled={busy || loading || !!error || page * 10 >= data.total}
                onClick={() => {
                  setLoading(true)
                  setPage(page + 1)
                }}
              >
                Next
              </button>
            </footer>
          </Modal>,
          document.body
        )}
    </>
  )
}
