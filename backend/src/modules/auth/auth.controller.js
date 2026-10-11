import {
  validateForgotPasswordInput,
  validateGoogleLoginInput,
  validateLoginInput,
  validateOtpInput,
  validateRegisterInput,
  validateResetPasswordInput,
  validateProfileInput,
  validateAvatarInput,
  validateChangePasswordInput,
} from './auth.validation.js'

export class AuthController {
  constructor(service) {
    this.service = service
  }

  register = async (request, response) => {
    const result = await this.service.register(validateRegisterInput(request.body))
    response.status(202).json({ data: result })
  }

  resendRegistrationEmailVerification = async (request, response) => {
    await this.service.requestEmailVerification(validateForgotPasswordInput(request.body))
    response
      .status(202)
      .json({ data: { message: 'Nếu có yêu cầu chờ xác thực, CoolCare đã gửi lại mã OTP.' } })
  }

  verifyRegistrationEmail = async (request, response) => {
    const result = await this.service.verifyEmailRegistrationOtp(validateOtpInput(request.body))
    response.json({ data: result })
  }

  login = async (request, response) => {
    const result = await this.service.login(validateLoginInput(request.body))
    response.json({ data: result })
  }

  googleLogin = async (request, response) => {
    const result = await this.service.loginWithGoogle(validateGoogleLoginInput(request.body))
    response.json({ data: result })
  }

  logout = async (_request, response) => {
    response.status(204).send()
  }

  profile = async (request, response) =>
    response.json({ data: await this.service.getProfile(request.auth.userId) })
  updateProfile = async (request, response) =>
    response.json({
      data: await this.service.updateProfile(
        request.auth.userId,
        validateProfileInput(request.body)
      ),
    })
  updateAvatar = async (request, response) =>
    response.json({
      data: await this.service.updateAvatar(
        request.auth.userId,
        validateAvatarInput(request.body).avatarUrl
      ),
    })
  refresh = async (request, response) =>
    response.json({ data: await this.service.refreshSession(request.auth.userId) })
  changePassword = async (request, response) => {
    await this.service.changePassword(
      request.auth.userId,
      validateChangePasswordInput(request.body)
    )
    response.json({ data: { message: 'Đổi mật khẩu thành công.' } })
  }

  forgotPassword = async (request, response) => {
    await this.service.requestPasswordReset(validateForgotPasswordInput(request.body))
    response.status(202).json({
      data: {
        message: 'Nếu email tồn tại, CoolCare đã gửi mã OTP đặt lại mật khẩu.',
      },
    })
  }

  verifyOtp = async (request, response) => {
    const resetToken = await this.service.verifyPasswordResetOtp(validateOtpInput(request.body))
    response.json({ data: { resetToken } })
  }

  resetPassword = async (request, response) => {
    await this.service.resetPassword(validateResetPasswordInput(request.body))
    response.json({ data: { message: 'Đặt lại mật khẩu thành công.' } })
  }
}
