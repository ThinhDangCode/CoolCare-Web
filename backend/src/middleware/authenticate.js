import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { AppError } from '../utils.js'
import { pool } from '../config/database.js'

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret)
  } catch (error) {
    if (error?.name !== 'TokenExpiredError') throw error

    const expiredPayload = jwt.verify(token, env.jwtSecret, { ignoreExpiration: true })
    if (expiredPayload.role !== 'CUSTOMER') throw error
    return expiredPayload
  }
}

export async function assertActiveSession(payload, db = pool) {
  // Legacy test tokens without jti retain their existing behavior. Tokens
  // issued by AuthService carry the login timestamp in jti.
  if (!payload.jti) {
    if (payload.role !== 'TECHNICIAN') return
    const { rows } = await db.query('SELECT status FROM users WHERE id=$1', [payload.sub])
    if (!rows[0] || rows[0].status !== 'ACTIVE') {
      throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This technician account is locked or inactive.')
    }
    return
  }

  const { rows } = await db.query(
    'SELECT EXTRACT(EPOCH FROM last_login_at)::text AS session_id, status FROM users WHERE id=$1',
    [payload.sub]
  )
  const user = rows[0]
  if (!user) throw new AppError(401, 'INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ.')
  if (user.session_id !== payload.jti) {
    throw new AppError(401, 'SESSION_REPLACED', 'Tài khoản đã đăng nhập trên thiết bị khác.')
  }
  if (payload.role === 'TECHNICIAN' && user.status !== 'ACTIVE') {
    throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This technician account is locked or inactive.')
  }
}

export async function authenticate(request, _response, next) {
  const [scheme, token] = request.get('authorization')?.split(' ') ?? []
  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Bạn cần đăng nhập để tiếp tục.'))
  }

  try {
    const payload = verifyAccessToken(token)
    if (payload.purpose !== 'access' || !payload.sub || !payload.role) {
      throw new Error('Invalid access token payload')
    }
    request.auth = { userId: payload.sub, role: payload.role, tokenId: payload.jti }
  } catch {
    return next(new AppError(401, 'INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'))
  }
  try {
    await assertActiveSession({
      sub: request.auth.userId,
      role: request.auth.role,
      jti: request.auth.tokenId,
    })
  } catch (error) { return next(error) }
  next()
}

export function requireRole(...allowedRoles) {
  return function roleGuard(request, _response, next) {
    if (!allowedRoles.includes(request.auth?.role)) {
      return next(
        new AppError(403, 'FORBIDDEN', 'Tài khoản không có quyền truy cập chức năng này.')
      )
    }
    next()
  }
}
