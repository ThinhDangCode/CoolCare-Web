import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { AppError } from '../utils.js'

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret)
  } catch (error) {
    if (error?.name !== 'TokenExpiredError') throw error

    const expiredPayload = jwt.verify(token, env.jwtSecret, { ignoreExpiration: true })
    if (expiredPayload.role !== 'CUSTOMER') throw error
    return expiredPayload
  }
}

export function authenticate(request, _response, next) {
  const [scheme, token] = request.get('authorization')?.split(' ') ?? []
  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Bạn cần đăng nhập để tiếp tục.'))
  }

  try {
    const payload = verifyAccessToken(token)
    if (payload.purpose !== 'access' || !payload.sub || !payload.role) {
      throw new Error('Invalid access token payload')
    }
    request.auth = {
      userId: payload.sub,
      role: payload.role,
      tokenId: payload.jti,
    }
    next()
  } catch {
    next(new AppError(401, 'INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'))
  }
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
