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

  async sendEmailVerificationOtp({ email, otp, expiresMinutes }) {
    console.info(`[DEV EMAIL] Verification OTP for ${email}: ${otp} (${expiresMinutes} minutes)`)
    throw new AppError(
      503,
      'EMAIL_NOT_CONFIGURED',
      'Gửi email chưa được cấu hình. Vui lòng thiết lập SMTP cho CoolCare.'
    )
  }
}

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
}

export function createEmailSender() {
  const smtpReady = env.smtp.host && env.smtp.user && env.smtp.password
  return smtpReady ? new SmtpEmailSender() : new DevelopmentEmailSender()
}
