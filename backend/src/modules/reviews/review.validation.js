import { requireValidBody } from '../../utils.js'

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function validateReviewInput(body = {}) {
  const rating = Number(body.rating)
  const comment = String(body.comment ?? '').trim()
  requireValidBody({
    booking_id: uuidPattern.test(String(body.booking_id ?? ''))
      ? null
      : 'Vui lòng chọn lịch dịch vụ hợp lệ.',
    rating:
      Number.isInteger(rating) && rating >= 1 && rating <= 5
        ? null
        : 'Điểm đánh giá phải từ 1 đến 5 sao.',
    comment: comment.length <= 1000 ? null : 'Nhận xét không được vượt quá 1000 ký tự.',
  })
  return { booking_id: body.booking_id, rating, comment: comment || null }
}

export function validateReviewUpdateInput(body = {}) {
  const rating = Number(body.rating)
  const comment = String(body.comment ?? '').trim()
  requireValidBody({
    rating:
      Number.isInteger(rating) && rating >= 1 && rating <= 5
        ? null
        : 'Điểm đánh giá phải từ 1 đến 5 sao.',
    comment: comment.length <= 1000 ? null : 'Nhận xét không được vượt quá 1000 ký tự.',
  })
  return { rating, comment: comment || null }
}
