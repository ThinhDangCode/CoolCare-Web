import assert from 'node:assert/strict'
import test from 'node:test'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET = 'test-secret-that-is-longer-than-32-characters'

const { AuthService } = await import('../src/modules/auth/auth.service.js')

test('login returns an access JWT and public ADMIN data', async () => {
  const passwordHash = await bcrypt.hash('CoolCare@123', 4)
  const repository = {
    async findUserByEmail() {
      return {
        id: 'admin-id',
        email: 'admin@coolcare.test',
        phone: '0901234567',
        full_name: 'CoolCare Admin',
        password_hash: passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
        email_verified_at: new Date(),
        has_technician_profile: false,
      }
    },
    async updateLastLogin() {},
  }
  const service = new AuthService({ repository, emailSender: {} })

  const result = await service.login({ email: 'admin@coolcare.test', password: 'CoolCare@123' })
  const payload = jwt.verify(result.token, process.env.JWT_SECRET)

  assert.equal(payload.sub, 'admin-id')
  assert.equal(payload.role, 'ADMIN')
  assert.equal(payload.purpose, 'access')
  assert.equal(result.user.fullName, 'CoolCare Admin')
  assert.equal(result.user.password_hash, undefined)
})

test('login rejects an incorrect password without returning account details', async () => {
  const repository = { async findUserByEmail() { return null } }
  const service = new AuthService({ repository, emailSender: {} })

  await assert.rejects(
    service.login({ email: 'missing@coolcare.test', password: 'WrongPass1' }),
    (error) => error.code === 'INVALID_CREDENTIALS' && error.status === 401,
  )
})

test('Google login verifies the provider identity before issuing an access JWT', async () => {
  let receivedIdentity
  let lastLoginUserId
  const repository = {
    async findOrCreateGoogleCustomer(identity) {
      receivedIdentity = identity
      return {
        id: 'google-customer-id',
        email: identity.email,
        full_name: identity.fullName,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        has_technician_profile: false,
      }
    },
    async updateLastLogin(userId) {
      lastLoginUserId = userId
    },
  }
  const googleTokenVerifier = {
    async verify(idToken) {
      assert.equal(idToken, 'verified-google-id-token')
      return {
        googleSub: 'google-subject-id',
        email: 'customer@gmail.com',
        fullName: 'Google Customer',
      }
    },
  }
  const service = new AuthService({ repository, emailSender: {}, googleTokenVerifier })

  const result = await service.loginWithGoogle({ idToken: 'verified-google-id-token' })
  const payload = jwt.verify(result.token, process.env.JWT_SECRET)

  assert.deepEqual(receivedIdentity, {
    googleSub: 'google-subject-id',
    email: 'customer@gmail.com',
    fullName: 'Google Customer',
  })
  assert.equal(lastLoginUserId, 'google-customer-id')
  assert.equal(payload.sub, 'google-customer-id')
  assert.equal(result.user.email, 'customer@gmail.com')
})

test('forgot password does not reveal a missing email', async () => {
  let emailSent = false
  const repository = { async findUserByEmail() { return null } }
  const emailSender = { async sendPasswordResetOtp() { emailSent = true } }
  const service = new AuthService({ repository, emailSender })

  await service.requestPasswordReset({ email: 'missing@coolcare.test' })
  assert.equal(emailSent, false)
})

test('Google-only account cannot use password login', async () => {
  const repository = {
    async findUserByEmail() {
      return {
        id: 'google-only-id',
        email: 'google-only@gmail.com',
        password_hash: null,
        google_sub: 'google-subject-id',
        status: 'ACTIVE',
        email_verified_at: new Date(),
      }
    },
  }
  const service = new AuthService({ repository, emailSender: {} })

  await assert.rejects(
    service.login({ email: 'google-only@gmail.com', password: 'AnyPassword1' }),
    (error) => error.code === 'GOOGLE_SIGN_IN_REQUIRED' && error.status === 409,
  )
})

test('Google-only email cannot be registered again with a password', async () => {
  let customerCreated = false
  const repository = {
    async findUserByEmail() {
      return {
        id: 'google-only-id',
        email: 'google-only@gmail.com',
        password_hash: null,
        google_sub: 'google-subject-id',
      }
    },
    async createCustomer() {
      customerCreated = true
    },
  }
  const service = new AuthService({ repository, emailSender: {} })

  await assert.rejects(
    service.register({
      email: 'google-only@gmail.com',
      fullName: 'Google Customer',
      password: 'CoolCare@123',
    }),
    (error) => error.code === 'GOOGLE_SIGN_IN_REQUIRED' && error.status === 409,
  )
  assert.equal(customerCreated, false)
})

test('forgot password rejects Google-only account without creating or emailing an OTP', async () => {
  let tokenCreated = false
  let emailSent = false
  const repository = {
    async findUserByEmail() {
      return {
        id: 'google-only-id',
        email: 'google-only@gmail.com',
        password_hash: null,
        google_sub: 'google-subject-id',
      }
    },
    async replacePasswordResetToken() {
      tokenCreated = true
    },
  }
  const emailSender = {
    async sendPasswordResetOtp() {
      emailSent = true
    },
  }
  const service = new AuthService({ repository, emailSender })

  await assert.rejects(
    service.requestPasswordReset({ email: 'google-only@gmail.com' }),
    (error) => error.code === 'GOOGLE_SIGN_IN_REQUIRED' && error.status === 409,
  )
  assert.equal(tokenCreated, false)
  assert.equal(emailSent, false)
})

test('forgot password still sends OTP for an account with Google and a password', async () => {
  let tokenCreated = false
  let emailSent = false
  const repository = {
    async findUserByEmail() {
      return {
        id: 'linked-id',
        email: 'linked@gmail.com',
        password_hash: 'stored-password-hash',
        google_sub: 'google-subject-id',
        email_verified_at: new Date(),
      }
    },
    async replacePasswordResetToken() {
      tokenCreated = true
    },
  }
  const emailSender = {
    async sendPasswordResetOtp({ email, otp }) {
      assert.equal(email, 'linked@gmail.com')
      assert.match(otp, /^\d{6}$/)
      emailSent = true
    },
  }
  const service = new AuthService({ repository, emailSender })

  await service.requestPasswordReset({ email: 'linked@gmail.com' })
  assert.equal(tokenCreated, true)
  assert.equal(emailSent, true)
})

test('register creates a pending account and sends an email verification OTP', async () => {
  let created = false
  let tokenInput
  let emailInput
  const pendingUser = {
    id: 'pending-user-id',
    email: 'new@coolcare.test',
    password_hash: 'password-hash',
    email_verified_at: null,
  }
  const repository = {
    async findUserByEmail() {
      return created ? pendingUser : null
    },
    async createCustomer() {
      created = true
      return pendingUser
    },
    async replaceEmailVerificationToken(input) {
      tokenInput = input
    },
  }
  const emailSender = {
    isConfigured: true,
    async sendEmailVerificationOtp(input) {
      emailInput = input
    },
  }
  const service = new AuthService({ repository, emailSender })

  const result = await service.register({
    fullName: 'New Customer',
    email: 'new@coolcare.test',
    password: 'CoolCare@123',
  })

  assert.deepEqual(result, {
    email: 'new@coolcare.test',
    emailVerificationRequired: true,
  })
  assert.equal(created, true)
  assert.equal(tokenInput.userId, 'pending-user-id')
  assert.equal(emailInput.email, 'new@coolcare.test')
  assert.match(emailInput.otp, /^\d{6}$/)
})

test('email verification signs the customer in after the OTP is confirmed', async () => {
  const otpHash = await bcrypt.hash('123456', 4)
  let lastLoginUserId
  const repository = {
    async findLatestEmailVerificationToken() {
      return {
        id: 'verification-request-id',
        user_id: 'verified-user-id',
        token_hash: otpHash,
        expires_at: new Date(Date.now() + 60_000),
        used_at: null,
      }
    },
    async consumeEmailVerification({ requestId, userId }) {
      assert.equal(requestId, 'verification-request-id')
      assert.equal(userId, 'verified-user-id')
      return {
        status: 'verified',
        user: {
          id: userId,
          email: 'verified@coolcare.test',
          full_name: 'Verified Customer',
          role: 'CUSTOMER',
          status: 'ACTIVE',
          has_technician_profile: false,
        },
      }
    },
    async updateLastLogin(userId) {
      lastLoginUserId = userId
    },
  }
  const service = new AuthService({ repository, emailSender: { isConfigured: true } })

  const result = await service.verifyEmailRegistrationOtp({
    email: 'verified@coolcare.test',
    otp: '123456',
  })

  const payload = jwt.verify(result.token, process.env.JWT_SECRET)
  assert.equal(payload.sub, 'verified-user-id')
  assert.equal(lastLoginUserId, 'verified-user-id')
  assert.equal(result.user.email, 'verified@coolcare.test')
})
