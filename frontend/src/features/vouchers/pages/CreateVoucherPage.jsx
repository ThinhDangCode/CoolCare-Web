import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import {
  ArrowLeftIcon,
  CloseIcon,
  EyeIcon,
  ListIcon,
  PageHeader,
  PlusIcon,
  SparklesIcon,
} from '../../../shared/components/AdminUi.jsx'
import { VoucherFields } from '../components/VoucherForm.jsx'
import {
  blankVoucher,
  validateVoucherForm,
  voucherPayload,
} from '../components/voucherFormUtils.js'
import { useAutoDismiss } from '../../../shared/hooks/useAutoDismiss.js'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import '../../../shared/styles/admin.css'

export function CreateVoucherPage() {
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const navigate = useNavigate()
  const [form, setForm] = useState({ ...blankVoucher })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState('')
  const errorHover = useAutoDismiss(error, setError)

  const presets = [
    {
      name: 'Welcome 10%',
      description: 'New-customer percentage promotion',
      values: {
        code: 'WELCOME10',
        name: '10% welcome discount for new customers',
        discount_type: 'PERCENTAGE',
        discount_value: '10',
        minimum_order_amount: '200000',
        maximum_discount: '50000',
        usage_limit: '500',
        usage_limit_per_customer: '1',
        is_active: true,
      },
    },
    {
      name: 'Service 20%',
      description: 'Limited percentage campaign',
      values: {
        code: 'SERVICE20',
        name: '20% discount on eligible CoolCare services',
        discount_type: 'PERCENTAGE',
        discount_value: '20',
        minimum_order_amount: '500000',
        maximum_discount: '50000',
        usage_limit: '200',
        usage_limit_per_customer: '1',
        is_active: true,
      },
    },
    {
      name: 'Fixed 50,000₫',
      description: 'Fixed-value order promotion',
      values: {
        code: 'SAVE50K',
        name: '50,000₫ discount on qualifying orders',
        discount_type: 'FIXED_AMOUNT',
        discount_value: '50000',
        minimum_order_amount: '300000',
        maximum_discount: '50000',
        usage_limit: '300',
        usage_limit_per_customer: '1',
        is_active: true,
      },
    },
  ]
  const localDateTime = (date) => {
    const offset = date.getTimezoneOffset() * 60000
    return new Date(date.getTime() - offset).toISOString().slice(0, 16)
  }
  const applyPreset = (preset) => {
    const start = new Date()
    start.setSeconds(0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 30)
    setForm((current) => ({
      ...current,
      ...preset.values,
      start_at: current.start_at || localDateTime(start),
      end_at: current.end_at || localDateTime(end),
    }))
    setErrors({})
    setError('')
    setDialog('')
  }
  const openPreview = () => {
    const validationErrors = validateVoucherForm(form, t)
    setErrors(validationErrors)
    setError(Object.keys(validationErrors).length ? t('Please check the highlighted voucher fields.') : '')
    if (!Object.keys(validationErrors).length) setDialog('preview')
  }

  async function submit(event) {
    event.preventDefault()
    const validationErrors = validateVoucherForm(form, t)
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors)
      setError(t('Please check the highlighted voucher fields.'))
      return
    }
    setBusy(true)
    setError('')
    setErrors({})
    try {
      const created = await adminRequest('/vouchers', token, {
        method: 'POST',
        body: voucherPayload(form),
      })
      if (!form.is_active)
        await adminRequest(`/vouchers/${created.id}/status`, token, {
          method: 'PATCH',
          body: { is_active: false },
        })
      navigate('/admin/vouchers', { replace: true })
    } catch (err) {
      setError(err.message)
      setErrors(err.details ?? {})
      if (err.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="figma-admin-main voucher-create-page">
      <PageHeader
        title={t('Create Voucher')}
        subtitle={t('Configure voucher parameters, redemption limitations, and targeted availability windows.')}
      />
      {error && (
        <div className="figma-toast danger" role="alert" {...errorHover}>
          <span className="toast-symbol" aria-hidden="true">
            !
          </span>
          <span>{error}</span>
          <button
            type="button"
            aria-label="Dismiss error notification"
            onClick={() => setError('')}
          >
            <CloseIcon />
          </button>
        </div>
      )}
      <form noValidate onSubmit={submit}>
        <div className="voucher-create-heading">
          <div className="voucher-create-context">
            <Link className="voucher-back-button" to="/admin/vouchers">
              <ArrowLeftIcon /> {t('Back to Vouchers')}
            </Link>
            <span>
              <SparklesIcon /> {t('New Promotion')}
            </span>
          </div>
          <div className="voucher-create-tools">
            <button type="button" onClick={() => setDialog('presets')}>
              <ListIcon /> {t('Load Preset')}
            </button>
            <button type="button" onClick={openPreview}>
              <EyeIcon /> {t('Preview Live Rule')}
            </button>
          </div>
        </div>
        <div className="voucher-create-layout">
          <VoucherFields initial={form} errors={errors} onChange={setForm} />
          <aside>
            <section>
              <header>
                <i>
                  <SparklesIcon />
                </i>
                <strong>{t('Status & Visibility')}</strong>
              </header>
              <button
                type="button"
                className={form.is_active ? 'selected active' : ''}
                onClick={() => setForm({ ...form, is_active: true })}
              >
                {t('Active')} <i />
              </button>
              <button
                type="button"
                className={!form.is_active ? 'selected inactive' : ''}
                onClick={() => setForm({ ...form, is_active: false })}
              >
                {t('Inactive / Draft')} <i />
              </button>
              <p>{t('A voucher can be used when it is active, within its validity period, and the booking meets its conditions.')}</p>
              <p>{t('Eligible CoolCare services can use this voucher; the discount is calculated on service charges only.')}</p>
            </section>
          </aside>
        </div>
        <footer className="voucher-create-actions">
          <Link to="/admin/vouchers">{t('Cancel')}</Link>
          <button disabled={busy}>
            <PlusIcon />
            {busy ? t('Creating…') : t('Create Voucher')}
          </button>
        </footer>
      </form>
      {dialog === 'presets' && (
        <div className="figma-modal-backdrop">
          <section
            className="voucher-tool-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preset-title"
          >
            <header>
              <div>
                <ListIcon />
                <span>
                  <h2 id="preset-title">Load Voucher Preset</h2>
                  <p>Select a template, then adjust any field before creating.</p>
                </span>
              </div>
              <button type="button" aria-label="Close presets" onClick={() => setDialog('')}>
                <CloseIcon />
              </button>
            </header>
            <div className="voucher-preset-list">
              {presets.map((preset) => (
                <button type="button" key={preset.name} onClick={() => applyPreset(preset)}>
                  <span>
                    <strong>{preset.name}</strong>
                    <small>{preset.description}</small>
                  </span>
                  <ArrowLeftIcon />
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      {dialog === 'preview' && (
        <div className="figma-modal-backdrop">
          <section
            className="voucher-tool-dialog preview"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
          >
            <header>
              <div>
                <EyeIcon />
                <span>
                  <h2 id="preview-title">{t('Voucher preview')}</h2>
                  <p>{t('Review the conditions before creating this voucher.')}</p>
                </span>
              </div>
              <button type="button" aria-label="Close preview" onClick={() => setDialog('')}>
                <CloseIcon />
              </button>
            </header>
            <div className="voucher-rule-preview">
              <div>
                <small>CODE</small>
                <strong>{form.code.trim().toUpperCase()}</strong>
                <span className={form.is_active ? 'active' : 'inactive'}>
                  {t(form.is_active ? 'Active' : 'Inactive')}
                </span>
              </div>
              <p>{form.name.trim()}</p>
              <dl>
                <div>
                  <dt>{t('Customer receives')}</dt>
                  <dd>
                    {form.discount_type === 'PERCENTAGE'
                      ? t('{percent}% off eligible services', { percent: form.discount_value })
                      : t('{amount} VND off eligible services', { amount: Number(form.discount_value).toLocaleString('vi-VN') })}
                  </dd>
                </div>
                <div>
                  <dt>{t('Minimum eligible service amount')}</dt>
                  <dd>{Number(form.minimum_order_amount).toLocaleString('vi-VN')}₫</dd>
                </div>
                <div>
                  <dt>{t('Maximum discount')}</dt>
                  <dd>{Number(form.maximum_discount || 50000).toLocaleString('vi-VN')}₫</dd>
                </div>
                <div>
                  <dt>Usage</dt>
                  <dd>
                    {form.usage_limit || 'Unlimited'} total ·{' '}
                    {form.usage_limit_per_customer || 'Unlimited'} per customer
                  </dd>
                </div>
                <div>
                  <dt>Validity</dt>
                  <dd>
                    {new Date(form.start_at).toLocaleString('vi-VN')} –{' '}
                    {new Date(form.end_at).toLocaleString('vi-VN')}
                  </dd>
                </div>
              </dl>
            </div>
            <footer>
              <button type="button" onClick={() => setDialog('')}>
                {t('Continue Editing')}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  )
}
