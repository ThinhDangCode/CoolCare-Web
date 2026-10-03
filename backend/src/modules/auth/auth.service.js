import { randomInt, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'
import { AppError } from '../../utils.js'

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    fullName: user.full_name,
    role: user.role,
    hasTechnicianProfile: Boolean(user.has_technician_profile),
  }
}

function isGoogleOnlyAccount(user) {
  return Boolean(user?.google_sub) && !user.password_hash
}

export class AuthService {
  constructor({ repository, emailSender, googleTokenVerifier }) {
    this.repository = repository
    this.emailSender = emailSender
    this.googleTokenVerifier = googleTokenVerifier
  }

  createAccessToken(user) {
    return jwt.sign(
      { role: user.role, purpose: 'access' },
      env.jwtSecret,
      { subject: user.id, jwtid: randomUUID(), expiresIn: env.jwtExpiresIn },
    )
  }

  ensureEmailDelivery() {
    if (this.emailSender.isConfigured === false) {
      throw new AppError(
        503,
        'EMAIL_NOT_CONFIGURED',
        'Gửi email chưa được cấu hình. Vui lòng thiết lập SMTP cho CoolCare.',
      )
    }
  }

  async register(input) {
    const existingUser = await this.repository.findUserByEmail(input.email)
    if (existingUser) {
      if (isGoogleOnlyAccount(existingUser)) {
        throw new AppError(
          409,
          'GOOGLE_SIGN_IN_REQUIRED',
          'Email này đã được đăng ký bằng Google. Vui lòng chọn “Continue with Google”.',
        )
      }
      if (!existingUser.email_verified_at && existingUser.password_hash) {
        await this.requestEmailVerification({ email: existingUser.email })
        return { email: existingUser.email, emailVerificationRequired: true }
      }
      throw new AppError(
        409,
        'EMAIL_ALREADY_REGISTERED',
        'Email này đã được đăng ký. Vui lòng đăng nhập.',
      )
    }
    this.ensureEmailDelivery()
    const passwordHash = await bcrypt.hash(input.password, 12)
    const user = await this.repository.createCustomer({ ...input, passwordHash })
    await this.requestEmailVerification({ email: user.email })
    return { email: user.email, emailVerificationRequired: true }
  }

  async login({ email, password }) {
    const user = await this.repository.findUserByEmail(email)
    if (!user) {
      await bcrypt.compare(password, '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv')
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.')
    }
    if (user.status !== 'ACTIVE') {
      throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'Tài khoản hiện không thể đăng nhập.')
    }
    if (!user.email_verified_at) {
      throw new AppError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Email chưa được xác thực. Vui lòng xác thực email trước khi đăng nhập.',
      )
    }
    if (isGoogleOnlyAccount(user)) {
      throw new AppError(
        409,
        'GOOGLE_SIGN_IN_REQUIRED',
        'Tài khoản này dùng Google. Vui lòng chọn “Continue with Google”.',
      )
    }
    const passwordMatches = user.password_hash
      ? await bcrypt.compare(password, user.password_hash)
      : false
    if (!passwordMatches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.')
    }

    await this.repository.updateLastLogin(user.id)
    return { token: this.createAccessToken(user), user: publicUser(user) }
  }

  async loginWithGoogle({ idToken }) {
    if (!this.googleTokenVerifier) {
      throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'Đăng nhập Google chưa được cấu hình trên máy chủ.')
    }
    const identity = await this.googleTokenVerifier.verify(idToken)
    const user = await this.repository.findOrCreateGoogleCustomer(identity)
    if (user.status !== 'ACTIVE') {
      throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'Tài khoản hiện không thể đăng nhập.')
    }
    await this.repository.updateLastLogin(user.id)
    return { token: this.createAccessToken(user), user: publicUser(user) }
  }

  async requestPasswordReset({ email }) {
    const user = await this.repository.findUserByEmail(email)
    if (!user) return
    if (isGoogleOnlyAccount(user)) {
      throw new AppError(
        409,
        'GOOGLE_SIGN_IN_REQUIRED',
        'Tài khoản này dùng Google và không có mật khẩu để đặt lại. Vui lòng chọn “Continue with Google”.',
      )
    }
    if (!user.email_verified_at) return
    if (!user.password_hash) return

    this.ensureEmailDelivery()

    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const otpHash = await bcrypt.hash(otp, 10)
    const expiresAt = new Date(Date.now() + env.otpExpiresMinutes * 60_000)
    await this.repository.replacePasswordResetToken({
      userId: user.id,
      tokenHash: otpHash,
      expiresAt,
    })
    await this.emailSender.sendPasswordResetOtp({
      email: user.email,
      otp,
      expiresMinutes: env.otpExpiresMinutes,
    })
  }

  async requestEmailVerification({ email }) {
    const user = await this.repository.findUserByEmail(email)
    if (!user || user.email_verified_at || !user.password_hash) return

    this.ensureEmailDelivery()
    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const otpHash = await bcrypt.hash(otp, 10)
    const expiresAt = new Date(
      Date.now() + env.emailVerificationOtpExpiresMinutes * 60_000,
    )
    await this.repository.replaceEmailVerificationToken({
      userId: user.id,
      tokenHash: otpHash,
      expiresAt,
    })
    await this.emailSender.sendEmailVerificationOtp({
      email: user.email,
      otp,
      expiresMinutes: env.emailVerificationOtpExpiresMinutes,
    })
  }

  async verifyEmailRegistrationOtp({ email, otp }) {
    const request = await this.repository.findLatestEmailVerificationToken(email)
    if (!request || request.used_at) {
      throw new AppError(400, 'INVALID_OTP', 'Mã OTP không hợp lệ.')
    }
    if (new Date(request.expires_at) <= new Date()) {
      throw new AppError(400, 'OTP_EXPIRED', 'Mã OTP đã hết hạn.')
    }
    if (!(await bcrypt.compare(otp, request.token_hash))) {
      throw new AppError(400, 'INVALID_OTP', 'Mã OTP không hợp lệ.')
    }

    const result = await this.repository.consumeEmailVerification({
      requestId: request.id,
      userId: request.user_id,
    })
    if (result.status !== 'verified' || !result.user) {
      throw new AppError(400, 'INVALID_OTP', 'Mã OTP không còn hiệu lực.')
    }
    if (result.user.status !== 'ACTIVE') {
      throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'Tài khoản hiện không thể đăng nhập.')
    }
    await this.repository.updateLastLogin(result.user.id)
    return { token: this.createAccessToken(result.user), user: publicUser(result.user) }
  }

  async verifyPasswordResetOtp({ email, otp }) {
    const request = await this.repository.findLatestPasswordResetToken(email)
    if (!request || request.used_at) {
      throw new AppError(400, 'INVALID_OTP', 'Mã OTP không hợp lệ.')
    }
    if (new Date(request.expires_at) <= new Date()) {
      throw new AppError(400, 'OTP_EXPIRED', 'Mã OTP đã hết hạn.')
    }
    if (!(await bcrypt.compare(otp, request.token_hash))) {
      throw new AppError(400, 'INVALID_OTP', 'Mã OTP không hợp lệ.')
    }

    return jwt.sign(
      { purpose: 'password_reset', requestId: request.id },
      env.jwtSecret,
      {
        subject: request.user_id,
        jwtid: randomUUID(),
        expiresIn: env.resetTokenExpiresIn,
      },
    )
  }

  async resetPassword({ resetToken, newPassword }) {
    let payload
    try {
      payload = jwt.verify(resetToken, env.jwtSecret)
    } catch {
      throw new AppError(400, 'INVALID_RESET_TOKEN', 'Quyền đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.')
    }
    if (payload.purpose !== 'password_reset' || !payload.requestId || !payload.sub) {
      throw new AppError(400, 'INVALID_RESET_TOKEN', 'Quyền đặt lại mật khẩu không hợp lệ.')
    }

    const passwordHash = await bcrypt.hash(newPassword, 12)
    const result = await this.repository.consumeResetAndUpdatePassword({
      requestId: payload.requestId,
      userId: payload.sub,
      passwordHash,
    })
    if (result.status !== 'updated') {
      throw new AppError(400, 'INVALID_RESET_TOKEN', 'Yêu cầu đặt lại mật khẩu không còn hiệu lực.')
    }
  }
}
