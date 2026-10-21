import { AppError } from '../../utils.js'

export function validateCancelAcceptedJob(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError({ body: 'Dữ liệu hủy công việc phải là một object.' })
  }
  const unknown = Object.keys(body).filter((key) => key !== 'reason')
  if (unknown.length) {
    throw validationError({ body: `Không hỗ trợ trường: ${unknown.join(', ')}.` })
  }
  if (typeof body.reason !== 'string') {
    throw validationError({ reason: 'Lý do hủy công việc là bắt buộc.' })
  }
  const reason = body.reason.trim()
  if (reason.length < 5 || reason.length > 500) {
    throw validationError({ reason: 'Lý do hủy phải có từ 5 đến 500 ký tự.' })
  }
  return { reason }
}

function validationError(details) {
  return new AppError(422, 'VALIDATION_ERROR', 'Thông tin hủy công việc không hợp lệ.', details)
}
