import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { uploadProfilePhoto } from '../../../shared/api/cloudinaryApi.js'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import {
  ArrowLeftIcon,
  CalendarIcon,
  CloseIcon,
  EyeIcon,
  PageHeader,
  PlusIcon,
  SparklesIcon,
} from '../../../shared/components/AdminUi.jsx'
import '../../../shared/styles/admin.css'
import '../styles/blogEditor.css'

const blank = { title: '', slug: '', thumbnail_url: '', content: '', status: 'PUBLISHED' }
const slugify = (value) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const validate = (form) => {
  const errors = {}
  const title = form.title.trim()
  const slug = form.slug.trim()
  const content = form.content.trim()
  if (title.length < 5 || title.length > 200)
    errors.title = 'Title must be between 5 and 200 characters.'
  if (slug.length > 200) errors.slug = 'Slug must not exceed 200 characters.'
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    errors.slug = 'Slug may only contain lowercase letters, numbers, and hyphens.'
  if (content.length < 20) errors.content = 'Article content must contain at least 20 characters.'
  else if (content.length > 50000)
    errors.content = 'Article content must not exceed 50,000 characters.'
  if (!['DRAFT', 'PUBLISHED', 'HIDDEN'].includes(form.status))
    errors.status = 'Select a valid article status.'
  return errors
}
const UploadIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v4h14v-4" />
  </svg>
)
const statusOptions = [
  { value: 'PUBLISHED', title: 'Published', note: 'Active and visible to readers' },
  { value: 'DRAFT', title: 'Draft', note: 'Inactive and only visible to administrators' },
  { value: 'HIDDEN', title: 'Hidden', note: 'Archived and removed from public views' },
]

export function BlogEditorPage() {
  const { id } = useParams()
  const editing = Boolean(id)
  const { token, logout, user } = useAuth()
  const { t } = useUiPreferences()
  const navigate = useNavigate()
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(editing)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState(false)
  const contentRef = useRef(null)
  useEffect(() => {
    if (!editing) return
    adminRequest(`/blogs/${id}`, token)
      .then((row) =>
        setForm({
          title: row.title,
          slug: row.slug,
          thumbnail_url: row.thumbnail_url || '',
          content: row.content,
          status: row.status,
        })
      )
      .catch((err) => {
        setError(err.message)
        if (err.status === 401) logout()
      })
      .finally(() => setLoading(false))
  }, [editing, id, token, logout])
  const change = (key, value) =>
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'title' ? { slug: slugify(value) } : {}),
    }))
  const formatContent = (before, after = before) => {
    const input = contentRef.current
    if (!input) return
    const start = input.selectionStart
    const end = input.selectionEnd
    const selected = form.content.slice(start, end) || 'text'
    const next = `${form.content.slice(0, start)}${before}${selected}${after}${form.content.slice(end)}`
    change('content', next)
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }
  async function upload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      change('thumbnail_url', await uploadProfilePhoto(file))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }
  async function save(event) {
    event.preventDefault()
    const nextErrors = validate(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setBusy(true)
    setError('')
    const editableFields = {
      title: form.title,
      slug: form.slug,
      thumbnail_url: form.thumbnail_url || null,
      content: form.content,
      status: form.status,
    }
    try {
      await adminRequest(editing ? `/blogs/${id}` : '/blogs', token, {
        method: editing ? 'PATCH' : 'POST',
        body: editableFields,
      })
      navigate('/admin/blogs', { replace: true })
    } catch (err) {
      setError(err.message)
      setErrors(err.details || {})
      if (err.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }
  if (loading)
    return (
      <main className="figma-admin-main">
        <PageHeader title={editing ? 'Edit Blog' : 'Create Blog'} subtitle="Loading article..." />
        <div className="figma-table-state">
          <i className="figma-spinner" />
          {t('Loading data…')}
        </div>
      </main>
    )
  return (
    <main className="figma-admin-main blog-editor-page">
      <PageHeader
        title={editing ? 'Edit Blog' : 'Create Blog'}
        subtitle={
          editing
            ? 'Review and update the article before publishing changes.'
            : 'Draft, format, and publish an article for the CoolCare knowledge base.'
        }
      />
      <form onSubmit={save}>
        <div className="blog-editor-heading">
          <Link to="/admin/blogs">
            <ArrowLeftIcon /> {t('Back to Blogs')}
          </Link>
          <span className="blog-editor-badge">
            <SparklesIcon />
            {t(editing ? 'Edit Article' : 'Article Editor')}
          </span>
          <button type="button" onClick={() => setPreview(true)}>
            <EyeIcon /> {t('Preview Article')}
          </button>
        </div>
        <div className="blog-editor-layout">
          <section className="blog-editor-card blog-information-card">
            <header>
              <strong>{t('Blog Information')}</strong>
            </header>
            <label>
              {t('Featured Cover Image')}
              <div
                className={`blog-cover-upload ${form.thumbnail_url ? 'has-image' : ''}`}
                style={
                  form.thumbnail_url ? { backgroundImage: `url(${form.thumbnail_url})` } : undefined
                }
              >
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} />
                {!form.thumbnail_url && (
                  <span className="blog-upload-icon">
                    <UploadIcon />
                  </span>
                )}
                <strong>
                  {uploading
                    ? t('Uploading…')
                    : form.thumbnail_url
                      ? t('Click to replace cover image')
                      : t('Click to upload or drag and drop here')}
                </strong>
                <small>{t('Recommended dimensions: 1200 × 630px · JPG, PNG or WEBP')}</small>
              </div>
            </label>
            <label>
              {t('Article Title *')}
              <input
                maxLength="200"
                placeholder={t('Enter a clear article title')}
                value={form.title}
                onChange={(event) => change('title', event.target.value)}
              />
              <small>{errors.title ? t(errors.title) : ''}</small>
            </label>
            <label>
              {t('Article Slug *')}
              <input
                maxLength="200"
                placeholder="article-url-slug"
                value={form.slug}
                onChange={(event) => change('slug', slugify(event.target.value))}
              />
              <small>{errors.slug ? t(errors.slug) : ''}</small>
            </label>
            <label>
              {t('Article Body Content *')}
              <div className="blog-rich-editor">
                <div className="blog-rich-toolbar" aria-label={t('Article formatting')}>
                  <button type="button" title={t('Bold')} onClick={() => formatContent('**')}>
                    <b>B</b>
                  </button>
                  <button type="button" title={t('Italic')} onClick={() => formatContent('_')}>
                    <i>I</i>
                  </button>
                  <button
                    type="button"
                    title={t('Heading')}
                    onClick={() => formatContent('## ', '')}
                  >
                    H2
                  </button>
                  <button
                    type="button"
                    title={t('Bulleted list')}
                    onClick={() => formatContent('- ', '')}
                  >
                    • {t('List')}
                  </button>
                  <button
                    type="button"
                    title={t('Link')}
                    onClick={() => formatContent('[', '](https://)')}
                  >
                    {t('Link')}
                  </button>
                </div>
                <textarea
                  ref={contentRef}
                  maxLength="50000"
                  placeholder={t('Write the article content here…')}
                  value={form.content}
                  onChange={(event) => change('content', event.target.value)}
                />
              </div>
              <small>{errors.content ? t(errors.content) : ''}</small>
            </label>
          </section>
          <aside className="blog-editor-card blog-settings-card">
            <header>
              <strong>{t('Status & Visibility')}</strong>
            </header>
            {statusOptions.map((item) => (
              <button
                type="button"
                key={item.value}
                className={`status-${item.value.toLowerCase()} ${form.status === item.value ? 'selected' : ''}`}
                onClick={() => change('status', item.value)}
              >
                <i />
                <span>
                  <strong>{t(item.title)}</strong>
                  <small>{t(item.note)}</small>
                </span>
              </button>
            ))}
            <div className="blog-author">
              <span>{t('Article Author')}</span>
              <strong>{user?.fullName || 'Admin'}</strong>
              <small>Admin</small>
            </div>
            <div className="blog-setting-block">
              <span>{t('Publish Schedule')}</span>
              <p>
                <CalendarIcon />{' '}
                {form.status === 'PUBLISHED'
                  ? t('Publish immediately after saving')
                  : t('No publication scheduled')}
              </p>
            </div>
            <div className="blog-setting-block">
              <span>{t('Target Channels')}</span>
              <label>
                <input type="checkbox" checked readOnly /> {t('CoolCare Customer App')}
              </label>
              <label>
                <input type="checkbox" checked readOnly /> {t('Public Knowledge Base')}
              </label>
            </div>
          </aside>
        </div>
        {error && <div className="figma-form-error">{error}</div>}
        <footer className="blog-editor-actions">
          <Link to="/admin/blogs">{t('Cancel')}</Link>
          <button disabled={busy || uploading}>
            <PlusIcon />
            {t(busy ? 'Saving…' : editing ? 'Save Changes' : 'Create Blog')}
          </button>
        </footer>
      </form>
      {preview && (
        <div className="figma-modal-backdrop" onMouseDown={() => setPreview(false)}>
          <article className="blog-preview-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <small>{t('ARTICLE PREVIEW')}</small>
                <h2>{form.title || t('Untitled article')}</h2>
              </div>
              <button
                type="button"
                aria-label={t('Close preview')}
                onClick={() => setPreview(false)}
              >
                <CloseIcon />
              </button>
            </header>
            {form.thumbnail_url && <img src={form.thumbnail_url} alt="" />}
            <div className="blog-preview-content">
              {form.content || t('Article content will appear here.')}
            </div>
          </article>
        </div>
      )}
    </main>
  )
}
