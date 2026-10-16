import { AppError } from '../../utils.js'

export const JOB_REQUEST_ACTIONS = ['ACCEPT', 'DECLINE']

export function validateAcceptDeclineJobRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError({ body: 'Dữ liệu phản hồi phải là một object.' })
  }

  const allowed = ['action', 'reason']
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
  if (unknown.length) {
    throw validationError({ body: `Không hỗ trợ trường: ${unknown.join(', ')}.` })
  }

  if (typeof body.action !== 'string' || !JOB_REQUEST_ACTIONS.includes(body.action)) {
    throw validationError({ action: `Hành động phải là một trong: ${JOB_REQUEST_ACTIONS.join(', ')}.` })
  }

  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') {
    throw validationError({ reason: 'Lý do từ chối phải là chuỗi.' })
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : null
  if (reason && reason.length > 500) {
    throw validationError({ reason: 'Lý do từ chối không được vượt quá 500 ký tự.' })
  }
  if (body.action === 'ACCEPT' && reason) {
    throw validationError({ reason: 'Không gửi lý do từ chối khi chấp nhận công việc.' })
  }

  return { action: body.action, reason: body.action === 'DECLINE' ? reason : null }
}

function validationError(details) {
  return new AppError(422, 'VALIDATION_ERROR', 'Phản hồi yêu cầu công việc không hợp lệ.', details)
}
