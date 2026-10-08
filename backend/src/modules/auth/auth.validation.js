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

export function validateProfileInput(body = {}) {
  const fullName = normalizeFullName(body.fullName)
  const phone = normalizePhone(body.phone) || null
  const dateOfBirth = body.dateOfBirth ? String(body.dateOfBirth) : null
  const gender = body.gender ? String(body.gender) : null
  const parsedBirthDate = dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
    ? new Date(`${dateOfBirth}T00:00:00.000Z`)
    : null
  const birthDateIsValid = !dateOfBirth || (
    parsedBirthDate
    && !Number.isNaN(parsedBirthDate.getTime())
    && parsedBirthDate.toISOString().slice(0, 10) === dateOfBirth
    && parsedBirthDate <= new Date()
  )
  requireValidBody({
    fullName: fullName.length < 2 || fullName.length > 100 || !isValidFullName(fullName) ? 'Họ tên không hợp lệ.' : null,
    phone: phone && !isValidVietnamesePhone(phone) ? 'Số điện thoại Việt Nam không hợp lệ.' : null,
    dateOfBirth: !birthDateIsValid ? 'Ngày sinh không hợp lệ hoặc nằm trong tương lai.' : null,
    gender: gender && !['MALE', 'FEMALE', 'OTHER'].includes(gender) ? 'Giới tính không hợp lệ.' : null,
  })
  return { fullName, phone, dateOfBirth, gender }
}

export function validateAvatarInput(body = {}) {
  const avatarUrl = body.avatarUrl == null ? null : String(body.avatarUrl).trim()
  let validUrl = true
  if (avatarUrl) {
    try {
      const parsed = new URL(avatarUrl)
      validUrl = parsed.protocol === 'https:' && parsed.hostname === 'res.cloudinary.com' && avatarUrl.length <= 2048
    } catch {
      validUrl = false
    }
  }
  requireValidBody({ avatarUrl: validUrl ? null : 'URL ảnh đại diện Cloudinary không hợp lệ.' })
  return { avatarUrl }
}

export function validateChangePasswordInput(body = {}) {
  const currentPassword = String(body.currentPassword ?? '')
  const newPassword = body.newPassword
  requireValidBody({
    currentPassword: !currentPassword ? 'Vui lòng nhập mật khẩu hiện tại.' : null,
    newPassword: !isStrongPassword(newPassword) ? 'Mật khẩu mới cần 8–72 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.' : null,
    passwordReuse: currentPassword && newPassword === currentPassword ? 'Mật khẩu mới phải khác mật khẩu hiện tại.' : null,
  })
  return { currentPassword, newPassword }
}
