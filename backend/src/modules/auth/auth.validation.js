import {
  isStrongPassword,
  isValidFullName,
  isValidEmail,
  isValidVietnamesePhone,
  normalizeEmail,
  normalizeFullName,
  normalizePhone,
  requireValidBody,
} from '../../utils.js'

export function validateRegisterInput(body = {}) {
  const fullName = normalizeFullName(body.fullName)
  const email = normalizeEmail(body.email)
  const phone = normalizePhone(body.phone) || null
  const password = body.password

  requireValidBody({
    fullName: fullName.length < 2
      ? 'Họ tên phải có ít nhất 2 ký tự.'
      : fullName.length > 100
        ? 'Họ tên không được quá 100 ký tự.'
        : !isValidFullName(fullName)
          ? 'Họ tên chỉ gồm chữ cái, khoảng trắng, dấu nháy đơn hoặc gạch nối.'
        : null,
    email: email.length > 254 || !isValidEmail(email) ? 'Email không hợp lệ.' : null,
    phone: phone && !isValidVietnamesePhone(phone) ? 'Số điện thoại Việt Nam không hợp lệ.' : null,
    password: !isStrongPassword(password)
      ? 'Mật khẩu cần 8–72 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.'
      : null,
  })

  return { fullName, email, phone, password }
}

export function validateLoginInput(body = {}) {
  const email = normalizeEmail(body.email)
  const password = String(body.password ?? '')
  requireValidBody({
    email: !isValidEmail(email) ? 'Email không hợp lệ.' : null,
    password: password.length === 0 ? 'Vui lòng nhập mật khẩu.' : null,
  })
  return { email, password }
}

export function validateGoogleLoginInput(body = {}) {
  const idToken = String(body.idToken ?? '').trim()
  requireValidBody({
    idToken: !idToken || idToken.length > 10000 ? 'Google ID token không hợp lệ.' : null,
  })
  return { idToken }
}

export function validateForgotPasswordInput(body = {}) {
  const email = normalizeEmail(body.email)
  requireValidBody({ email: !isValidEmail(email) ? 'Email không hợp lệ.' : null })
  return { email }
}

export function validateOtpInput(body = {}) {
  const email = normalizeEmail(body.email)
  const otp = String(body.otp ?? '').trim()
  requireValidBody({
    email: !isValidEmail(email) ? 'Email không hợp lệ.' : null,
    otp: !/^\d{6}$/.test(otp) ? 'OTP phải gồm đúng 6 chữ số.' : null,
  })
  return { email, otp }
}

export function validateResetPasswordInput(body = {}) {
  const resetToken = String(body.resetToken ?? '').trim()
  const newPassword = body.newPassword
  requireValidBody({
    resetToken: !resetToken ? 'Thiếu quyền đặt lại mật khẩu.' : null,
    newPassword: !isStrongPassword(newPassword)
      ? 'Mật khẩu mới cần 8–72 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.'
      : null,
  })
  return { resetToken, newPassword }
}
