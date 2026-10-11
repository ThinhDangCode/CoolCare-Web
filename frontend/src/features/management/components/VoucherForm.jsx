import { blankVoucher } from './voucherFormUtils.js'
import { CalendarIcon, ListIcon, TicketIcon, UserIcon } from './ManagementShared.jsx'

export function VoucherFields({ initial = blankVoucher, errors = {}, onChange, compact = false }) {
  const form = initial
  function change(key, value) {
    onChange({ ...form, [key]: value })
  }

  return (
    <div className={compact ? 'voucher-fields compact' : 'voucher-fields'}>
      <section className="voucher-section information">
        <header>
          <i>
            <TicketIcon />
          </i>
          <strong>Voucher Information</strong>
        </header>
        <label>
          <span>
            Voucher Code <em>*</em>
          </span>
          <div className="input-with-icon">
            <span>
              <TicketIcon />
            </span>
            <input
              required
              maxLength="100"
              value={form.code}
              onChange={(event) => change('code', event.target.value.toUpperCase())}
            />
          </div>
          <small>{errors.code}</small>
        </label>
        <label>
          <span>
            {compact ? 'Description' : 'Promotion Campaign Description'} <em>*</em>
          </span>
          <textarea
            required
            maxLength="100"
            value={form.name}
            onChange={(event) => change('name', event.target.value)}
          />
          <small>{errors.name}</small>
        </label>
      </section>
      <section className="voucher-section discount">
        <header>
          <i>%</i>
          <strong>Discount Configuration</strong>
        </header>
        <div className="voucher-choice">
          <button
            type="button"
            className={form.discount_type === 'PERCENTAGE' ? 'selected' : ''}
            onClick={() => change('discount_type', 'PERCENTAGE')}
          >
            <i />
            <span>
              <strong>Percentage</strong>
              <small>Discount</small>
            </span>
            <b>%</b>
          </button>
          <button
            type="button"
            className={form.discount_type === 'FIXED_AMOUNT' ? 'selected' : ''}
            onClick={() => change('discount_type', 'FIXED_AMOUNT')}
          >
            <i />
            <span>
              <strong>Fixed</strong>
              <small>Amount</small>
            </span>
            <b>₫</b>
          </button>
        </div>
        <div className="voucher-field-grid">
          <label>
            <span>
              {form.discount_type === 'PERCENTAGE' ? 'Discount Percentage' : 'Discount Amount'}{' '}
              <em>*</em>
            </span>
            <div>
              <input
                required
                type="number"
                inputMode="numeric"
                min="1"
                max={form.discount_type === 'PERCENTAGE' ? 100 : undefined}
                step="1"
                placeholder={form.discount_type === 'PERCENTAGE' ? '20' : '50000'}
                value={form.discount_value}
                onChange={(event) => change('discount_value', event.target.value)}
              />
              <span>{form.discount_type === 'PERCENTAGE' ? '%' : '₫'}</span>
            </div>
            <small>{errors.discount_value}</small>
          </label>
          <label>
            <span>Max Discount Cap</span>
            <div>
              <input
                type="number"
                min="0"
                step="1"
                value={form.maximum_discount}
                onChange={(event) => change('maximum_discount', event.target.value)}
              />
              <span>₫</span>
            </div>
            <small>{errors.maximum_discount}</small>
          </label>
          <label>
            <span>
              Min Order Spend <em>*</em>
            </span>
            <div>
              <input
                required
                type="number"
                min="0"
                step="1"
                value={form.minimum_order_amount}
                onChange={(event) => change('minimum_order_amount', event.target.value)}
              />
              <span>₫</span>
            </div>
            <small>{errors.minimum_order_amount}</small>
          </label>
        </div>
      </section>
      <section className="voucher-section limits">
        <header>
          <i>
            <ListIcon />
          </i>
          <strong>Usage Limits & Governance</strong>
        </header>
        <div className="voucher-field-grid two">
          <label>
            <span>Total Voucher Pool Limit</span>
            <div>
              <span>#</span>
              <input
                type="number"
                min="1"
                step="1"
                value={form.usage_limit}
                onChange={(event) => change('usage_limit', event.target.value)}
              />
            </div>
            <small>{errors.usage_limit}</small>
          </label>
          <label>
            <span>Customer Frequency Restriction</span>
            <div>
              <span>
                <UserIcon />
              </span>
              <input
                type="number"
                min="1"
                step="1"
                value={form.usage_limit_per_customer}
                onChange={(event) => change('usage_limit_per_customer', event.target.value)}
              />
              <b>use(s) per customer</b>
            </div>
            <small>{errors.usage_limit_per_customer}</small>
          </label>
        </div>
      </section>
      <section className="voucher-section validity">
        <header>
          <i>
            <CalendarIcon />
          </i>
          <strong>Validity Schedule</strong>
        </header>
        <div className="voucher-field-grid two">
          <label>
            <span>
              Campaign Start Date & Time <em>*</em>
            </span>
            <input
              required
              type="datetime-local"
              value={form.start_at}
              onChange={(event) => change('start_at', event.target.value)}
            />
            <small>{errors.start_at}</small>
          </label>
          <label>
            <span>
              Campaign Expiration Date & Time <em>*</em>
            </span>
            <input
              required
              type="datetime-local"
              min={form.start_at}
              value={form.end_at}
              onChange={(event) => change('end_at', event.target.value)}
            />
            <small>{errors.end_at}</small>
          </label>
        </div>
      </section>
    </div>
  )
}
