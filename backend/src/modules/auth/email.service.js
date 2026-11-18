import nodemailer from 'nodemailer'
import { env } from '../../config/env.js'
import { AppError } from '../../utils.js'

class DevelopmentEmailSender {
  isConfigured = false

  async sendPasswordResetOtp({ email, otp, expiresMinutes }) {
    console.info(`[DEV EMAIL] OTP for ${email}: ${otp} (${expiresMinutes} minutes)`)
    throw new AppError(
      503,
      'EMAIL_NOT_CONFIGURED',
      'Gửi email chưa được cấu hình. Vui lòng thiết lập SMTP cho CoolCare.'
    )
  }

  async sendInvoiceEmail({ email, invoice }) {
    console.info(`[DEV EMAIL] Invoice ${invoice.invoiceNumber} for ${email}`)
    throw new AppError(
      503,
      'EMAIL_NOT_CONFIGURED',
      'Gửi email chưa được cấu hình. Vui lòng thiết lập SMTP cho CoolCare.'
    )
  }

  async sendMaintenanceReminder({ email, bookingCode }) {
    console.warn(`[DEV EMAIL] Maintenance reminder for ${bookingCode} to ${email} not sent: SMTP is not configured`)
    throw new AppError(503, 'EMAIL_NOT_CONFIGURED',
      'Chưa cấu hình SMTP để gửi email nhắc chăm sóc máy lạnh.')
  }

  async sendEmailVerificationOtp({ email, otp, expiresMinutes }) {
    console.info(`[DEV EMAIL] Verification OTP for ${email}: ${otp} (${expiresMinutes} minutes)`)
    throw new AppError(
      503,
      'EMAIL_NOT_CONFIGURED',
      'Gửi email chưa được cấu hình. Vui lòng thiết lập SMTP cho CoolCare.'
    )
  }
}

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

const vnd = (value) => `${Math.round(Number(value) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`

class SmtpEmailSender {
  isConfigured = true

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: { user: env.smtp.user, pass: env.smtp.password },
    })
  }

  async sendPasswordResetOtp({ email, otp, expiresMinutes }) {
    await this.transporter.sendMail({
      from: env.smtp.from,
      to: email,
      subject: 'Mã xác thực đặt lại mật khẩu CoolCare',
      text: `Mã OTP của bạn là ${otp}. Mã có hiệu lực trong ${expiresMinutes} phút.`,
      html: `<p>Mã OTP đặt lại mật khẩu CoolCare:</p><p style="font-size:24px;font-weight:700;letter-spacing:6px">${otp}</p><p>Mã có hiệu lực trong ${expiresMinutes} phút.</p>`,
    })
  }

  async sendEmailVerificationOtp({ email, otp, expiresMinutes }) {
    await this.transporter.sendMail({
      from: env.smtp.from,
      to: email,
      subject: 'Xác thực email đăng ký CoolCare',
      text: `Mã xác thực đăng ký CoolCare của bạn là ${otp}. Mã có hiệu lực trong ${expiresMinutes} phút.`,
      html: `<p>Mã xác thực email đăng ký CoolCare:</p><p style="font-size:24px;font-weight:700;letter-spacing:6px">${otp}</p><p>Mã có hiệu lực trong ${expiresMinutes} phút.</p>`,
    })
  }

  // The complete Vietnamese wording lives here, not in a separate template.
  async sendMaintenanceReminder({ email, name, bookingCode, unitNumber, items }) {
    const greeting = name ? `Xin chào ${name},` : 'Xin chào bạn,'
    const intro = `Theo lịch chăm sóc định kỳ của CoolCare, máy lạnh số ${unitNumber} trong lịch đặt ${bookingCode} đã đến kỳ cần được kiểm tra hoặc chăm sóc.`
    const lines = items.map(item =>
      `- ${item.serviceName} (đến kỳ ${item.dueDate}): ${item.recommendation}`)
    const text = [greeting, intro, 'CoolCare khuyến nghị:', ...lines,
      'Bạn có thể mở ứng dụng CoolCare để xem lịch sử dịch vụ và đặt lịch phù hợp.',
      'Đây là lời nhắc chăm sóc định kỳ theo chu kỳ đã cấu hình, không phải thông báo hết hạn bảo hành.',
      'Trân trọng,\nĐội ngũ CoolCare'].join('\n\n')
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#193943;max-width:560px">` +
      `<h2 style="color:#087f92">CoolCare - Đã đến kỳ chăm sóc máy lạnh</h2>` +
      `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p>` +
      `<p><strong>CoolCare khuyến nghị:</strong></p><ul>` +
      items.map(item => `<li><strong>${escapeHtml(item.serviceName)}</strong> ` +
        `(đến kỳ ${escapeHtml(item.dueDate)}): ${escapeHtml(item.recommendation)}</li>`).join('') +
      `</ul><p>Bạn có thể mở ứng dụng CoolCare để xem lịch sử dịch vụ và đặt lịch phù hợp.</p>` +
      `<p style="color:#64748b;font-size:12px">Đây là lịch nhắc chăm sóc định kỳ, không phải thời hạn bảo hành.</p></div>`
    await this.transporter.sendMail({
      from: env.smtp.from, to: email,
      subject: `CoolCare: Đã đến kỳ chăm sóc máy lạnh - ${bookingCode}`,
      text, html,
    })
  }

  async sendInvoiceEmail({ email, name, invoice, pdf, filename }) {
    const total = vnd(invoice.totalAmount)
    const greeting = name ? `Xin chào ${name},` : 'Xin chào,'
    await this.transporter.sendMail({
      from: env.smtp.from,
      to: email,
      subject: `Hóa đơn dịch vụ CoolCare ${invoice.invoiceNumber}`,
      text: [
        greeting,
        `Cảm ơn bạn đã sử dụng dịch vụ CoolCare. Hóa đơn ${invoice.invoiceNumber} cho booking ${invoice.booking.code} (tổng thanh toán ${total}) được đính kèm trong email này.`,
        'Bạn cũng có thể xem và tải lại hóa đơn trong ứng dụng CoolCare: Tài khoản > Lịch sử thanh toán.',
      ].join('\n\n'),
      html:
        `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:520px">` +
        `<h2 style="color:#ff6b00;margin:0 0 12px">Hóa đơn dịch vụ CoolCare</h2>` +
        `<p>${escapeHtml(greeting)}</p>` +
        `<p>Cảm ơn bạn đã sử dụng dịch vụ CoolCare. Hóa đơn của bạn được đính kèm dưới dạng PDF.</p>` +
        `<table style="border-collapse:collapse;width:100%;margin:16px 0">` +
        `<tr><td style="padding:8px 0;color:#64748b">Số hóa đơn</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(invoice.invoiceNumber)}</td></tr>` +
        `<tr><td style="padding:8px 0;color:#64748b">Mã booking</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(invoice.booking.code)}</td></tr>` +
        `<tr><td style="padding:8px 0;color:#64748b">Tổng thanh toán</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#ff6b00">${escapeHtml(total)}</td></tr>` +
        `</table>` +
        `<p style="color:#64748b;font-size:13px">Bạn có thể xem và tải lại hóa đơn trong ứng dụng: Tài khoản &gt; Lịch sử thanh toán.</p>` +
        `</div>`,
      attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
    })
  }
}

export function createEmailSender() {
  const smtpReady = env.smtp.host && env.smtp.user && env.smtp.password
  return smtpReady ? new SmtpEmailSender() : new DevelopmentEmailSender()
}
