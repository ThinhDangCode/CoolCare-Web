import { AppError } from '../utils.js'

export function notFoundHandler(request, _response, next) {
  next(new AppError(404, 'NOT_FOUND', `Không tìm thấy ${request.method} ${request.originalUrl}.`))
}

export function errorHandler(error, _request, response, _next) {
  if (error instanceof AppError) {
    return response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    })
  }

  if (error?.code === '23505') {
    return response.status(409).json({
      error: {
        code: 'DUPLICATE_DATA',
        message: 'Email hoặc số điện thoại đã được sử dụng.',
      },
    })
  }

  console.error(error)
  return response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Hệ thống đang bận. Vui lòng thử lại sau.',
    },
  })
}
