import { OAuth2Client } from 'google-auth-library'
import { env } from '../../config/env.js'
import { AppError, normalizeEmail } from '../../utils.js'

export class GoogleTokenVerifier {
  constructor({ clientId = env.googleClientId, client } = {}) {
    this.clientId = clientId
    this.client = client ?? (clientId ? new OAuth2Client(clientId) : null)
  }

  async verify(idToken) {
    if (!this.clientId || !this.client) {
      throw new AppError(
        503,
        'GOOGLE_NOT_CONFIGURED',
        'Đăng nhập Google chưa được cấu hình trên máy chủ.',
      )
    }

    let payload
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      })
      payload = ticket.getPayload()
    } catch (_) {
      throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Xác thực Google không hợp lệ hoặc đã hết hạn.')
    }

    const googleSub = String(payload?.sub ?? '').trim()
    const email = normalizeEmail(payload?.email)
    const emailVerified = payload?.email_verified === true || payload?.email_verified === 'true'
    const suppliedName = String(payload?.name ?? '').trim()
    const fullName = suppliedName.length >= 2 ? suppliedName.slice(0, 100) : 'Google user'

    if (!googleSub || !email || !emailVerified) {
      throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Tài khoản Google chưa có email đã xác thực.')
    }

    return { googleSub, email, fullName }
  }
}
