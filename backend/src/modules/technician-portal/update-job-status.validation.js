import { AppError } from '../../utils.js'

export function validateUpdateJobStatus(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError({ body: 'Dữ liệu cập nhật trạng thái phải là một object.' })
  }

  const unknown = Object.keys(body).filter((key) => key !== 'status')
  if (unknown.length) {
    throw validationError({ body: `Không hỗ trợ trường: ${unknown.join(', ')}.` })
  }
  if (body.status !== 'COMPLETED') {
    throw validationError({ status: 'Trạng thái công việc chỉ có thể cập nhật thành COMPLETED.' })
  }
  return { status: 'COMPLETED' }
}

function validationError(details) {
  return new AppError(422, 'VALIDATION_ERROR', 'Trạng thái công việc không hợp lệ.', details)
}
