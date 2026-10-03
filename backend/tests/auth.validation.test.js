import assert from 'node:assert/strict'
import test from 'node:test'
import {
  validateLoginInput,
  validateGoogleLoginInput,
  validateOtpInput,
  validateRegisterInput,
} from '../src/modules/auth/auth.validation.js'

test('register normalizes valid customer input', () => {
  assert.deepEqual(
    validateRegisterInput({
      fullName: '  Nguyễn Văn An  ',
      email: '  AN@coolcare.test ',
      phone: '090 123 4567',
      password: 'CoolCare@1',
    }),
    {
      fullName: 'Nguyễn Văn An',
      email: 'an@coolcare.test',
      phone: '0901234567',
      password: 'CoolCare@1',
    },
  )
})

test('register rejects a one-character, numeric, or symbol-only full name', () => {
  for (const fullName of ['A', '12', '@@', 'Nguyễn 123']) {
    assert.throws(
      () => validateRegisterInput({
        fullName,
        email: 'an@coolcare.test',
        password: 'CoolCare@1',
      }),
      (error) => error.code === 'VALIDATION_ERROR' && Boolean(error.details.fullName),
    )
  }
})

test('register accepts Vietnamese names with spaces, apostrophes, and hyphens', () => {
  assert.equal(
    validateRegisterInput({
      fullName: "  Nguyễn   Thị  O'Connor-Lê  ",
      email: 'an@coolcare.test',
      password: 'CoolCare@1',
    }).fullName,
    "Nguyễn Thị O'Connor-Lê",
  )
})

test('register rejects a weak password', () => {
  assert.throws(
    () => validateRegisterInput({
      fullName: 'Nguyễn Văn An',
      email: 'an@coolcare.test',
      phone: '0901234567',
      password: '12345678',
    }),
    (error) => error.code === 'VALIDATION_ERROR' && Boolean(error.details.password),
  )
})

test('register rejects a password without a special character or over 72 characters', () => {
  assert.throws(() => validateRegisterInput({
    fullName: 'Nguyễn Văn An',
    email: 'an@coolcare.test',
    password: 'CoolCare123',
  }))
  assert.throws(() => validateRegisterInput({
    fullName: 'Nguyễn Văn An',
    email: 'an@coolcare.test',
    password: `Aa1@${'x'.repeat(69)}`,
  }))
})

test('register accepts the Figma form without an optional phone number', () => {
  assert.deepEqual(
    validateRegisterInput({
      fullName: 'Nguyễn Văn An',
      email: 'an@coolcare.test',
      password: 'CoolCare@1',
    }),
    {
      fullName: 'Nguyễn Văn An',
      email: 'an@coolcare.test',
      phone: null,
      password: 'CoolCare@1',
    },
  )
})

test('login requires email and password', () => {
  assert.throws(
    () => validateLoginInput({ email: 'invalid', password: '' }),
    (error) => error.code === 'VALIDATION_ERROR',
  )
})

test('Google login requires a bounded ID token', () => {
  assert.deepEqual(validateGoogleLoginInput({ idToken: '  token  ' }), { idToken: 'token' })
  assert.throws(() => validateGoogleLoginInput({ idToken: '' }))
  assert.throws(() => validateGoogleLoginInput({ idToken: 'x'.repeat(10001) }))
})

test('OTP contains exactly six digits', () => {
  assert.deepEqual(validateOtpInput({ email: 'user@coolcare.test', otp: '123456' }), {
    email: 'user@coolcare.test',
    otp: '123456',
  })
  assert.throws(() => validateOtpInput({ email: 'user@coolcare.test', otp: '12345' }))
})
