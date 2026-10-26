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
