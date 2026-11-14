import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validateRegisterInput,
  validateLoginInput,
  validateGoogleLoginInput,
  validateForgotPasswordInput,
  validateOtpInput,
  validateResetPasswordInput,
  validateProfileInput,
  validateAvatarInput,
  validateChangePasswordInput,
} from '../src/modules/auth/auth.validation.js'

const validRegistration = {
  fullName: ' Nguyễn   Văn An ',
  email: ' UNIT@EXAMPLE.TEST ',
  phone: '0912 345 678',
  password: 'Aa1!abcd',
}

for (const [id, changes, expected] of [
  ['UTCID01', {}, { fullName: 'Nguyễn Văn An', email: 'unit@example.test', phone: '0912345678' }],
  ['UTCID02', { fullName: 'Nguyễn Văn An', email: 'unit@example.test', phone: null }, { phone: null }],
  ['UTCID03', { fullName: 'A' }, 'fullName'],
  ['UTCID04', { fullName: 'A'.repeat(101) }, 'fullName'],
  ['UTCID05', { email: 'bad' }, 'email'],
  ['UTCID06', { password: 'Aa1!abc' }, 'password'],
  ['UTCID07', { password: 'Aa1!abcd' + 'a'.repeat(65) }, 'password'],
  ['UTCID08', { phone: '0000000000' }, 'phone'],
  ['UTCID09', { fullName: 'An' }, { fullName: 'An' }],
  ['UTCID10', { fullName: 'A'.repeat(100) }, { fullName: 'A'.repeat(100) }],
]) {
  test(`F009 ${id} validates registration input`, () => {
    const input = { ...validRegistration, ...changes }
    if (typeof expected === 'string') {
      assert.throws(() => validateRegisterInput(input), (error) =>
        error?.status === 422 && error?.code === 'VALIDATION_ERROR' && Boolean(error.details?.[expected]))
    } else {
      const actual = validateRegisterInput(input)
      for (const [field, value] of Object.entries(expected)) assert.equal(actual[field], value)
    }
  })
}

test('login and forgot password normalize email and reject missing credentials', () => {
  assert.deepEqual(validateLoginInput({ email: ' UNIT@EXAMPLE.TEST ', password: 'password' }), {
    email: 'unit@example.test', password: 'password',
  })
  assert.throws(() => validateLoginInput({ email: 'bad', password: '' }), {
    code: 'VALIDATION_ERROR',
  })
  assert.deepEqual(validateForgotPasswordInput({ email: ' UNIT@EXAMPLE.TEST ' }), {
    email: 'unit@example.test',
  })
  assert.throws(() => validateForgotPasswordInput({ email: 'bad' }), { status: 422 })
})

test('Google and OTP validators enforce token and six-digit boundaries', () => {
  assert.deepEqual(validateGoogleLoginInput({ idToken: ' token ' }), { idToken: 'token' })
  for (const idToken of ['', 'x'.repeat(10001)]) {
    assert.throws(() => validateGoogleLoginInput({ idToken }), { status: 422 })
  }
  assert.deepEqual(validateOtpInput({ email: ' UNIT@EXAMPLE.TEST ', otp: ' 123456 ' }), {
    email: 'unit@example.test', otp: '123456',
  })
  for (const otp of ['12345', '1234567', '12345a']) {
    assert.throws(() => validateOtpInput({ email: 'unit@example.test', otp }), { status: 422 })
  }
})

test('password reset requires a token and a strong new password', () => {
  assert.deepEqual(validateResetPasswordInput({ resetToken: ' token ', newPassword: 'Aa1!abcd' }), {
    resetToken: 'token', newPassword: 'Aa1!abcd',
  })
  assert.throws(() => validateResetPasswordInput({ resetToken: '', newPassword: 'Aa1!abcd' }), {
    status: 422,
  })
  assert.throws(() => validateResetPasswordInput({ resetToken: 'token', newPassword: 'weak' }), {
    status: 422,
  })
})

test('profile validates optional birth date and gender while normalizing name', () => {
  const base = { fullName: ' Nguyễn   Văn An ', phone: '', dateOfBirth: '2000-02-29', gender: 'MALE' }
  assert.deepEqual(validateProfileInput(base), {
    fullName: 'Nguyễn Văn An', phone: null, dateOfBirth: '2000-02-29', gender: 'MALE',
  })
  for (const dateOfBirth of ['2001-02-29', '2099-01-01']) {
    assert.throws(() => validateProfileInput({ ...base, dateOfBirth }), { status: 422 })
  }
  assert.throws(() => validateProfileInput({ ...base, gender: 'INVALID' }), { status: 422 })
})

test('avatar permits only HTTPS Cloudinary URLs', () => {
  assert.deepEqual(validateAvatarInput({ avatarUrl: null }), { avatarUrl: null })
  assert.deepEqual(validateAvatarInput({ avatarUrl: ' https://res.cloudinary.com/demo/image.png ' }), {
    avatarUrl: 'https://res.cloudinary.com/demo/image.png',
  })
  for (const avatarUrl of ['http://res.cloudinary.com/demo/image.png', 'https://evil.test/x', 'not-a-url']) {
    assert.throws(() => validateAvatarInput({ avatarUrl }), { status: 422 })
  }
})

test('changing a password rejects missing current and reused passwords', () => {
  assert.deepEqual(validateChangePasswordInput({ currentPassword: 'Aa1!abcd', newPassword: 'Bb2@abcd' }), {
    currentPassword: 'Aa1!abcd', newPassword: 'Bb2@abcd',
  })
  assert.throws(() => validateChangePasswordInput({ currentPassword: '', newPassword: 'Bb2@abcd' }), {
    status: 422,
  })
  assert.throws(() => validateChangePasswordInput({ currentPassword: 'Aa1!abcd', newPassword: 'Aa1!abcd' }), {
    status: 422,
  })
})

const standardEmail = 'unit@example.test'
for (const [caseId,body,expected] of [
  ['UTCID01',{email:'  UNIT@EXAMPLE.TEST  ',password:'Aa1!abcd'},{email:standardEmail,password:'Aa1!abcd'}],
  ['UTCID02',{email:'bad',password:'Aa1!abcd'},null],
  ['UTCID03',{email:standardEmail,password:''},null],
]) {
  test(`F010 ${caseId} validates login credentials`, () => {
    if (expected===null) assert.throws(() => validateLoginInput(body),{status:422})
    else assert.deepEqual(validateLoginInput(body),expected)
  })
}

for (const [caseId,email,expected] of [
  ['UTCID01','  UNIT@EXAMPLE.TEST  ',standardEmail],
  ['UTCID02','bad',null],
  ['UTCID03',undefined,null],
]) {
  test(`F011 ${caseId} validates password reset email`, () => {
    if (expected===null) assert.throws(() => validateForgotPasswordInput({email}),{status:422})
    else assert.deepEqual(validateForgotPasswordInput({email}),{email:expected})
  })
}

for (const [caseId,idToken,expected] of [
  ['UTCID01','  token  ','token'],
  ['UTCID02','',null],
  ['UTCID03','x'.repeat(10001),null],
]) {
  test(`F012 ${caseId} validates Google ID token`, () => {
    if (expected===null) assert.throws(() => validateGoogleLoginInput({idToken}),{status:422})
    else assert.deepEqual(validateGoogleLoginInput({idToken}),{idToken:expected})
  })
}

for (const [caseId,otp,expected] of [
  ['UTCID01','  012345  ','012345'],
  ['UTCID02','12345',null],
  ['UTCID03','1234567',null],
  ['UTCID04','abcdef',null],
]) {
  test(`F013 ${caseId} validates OTP length and digits`, () => {
    const body = {email:standardEmail,otp}
    if (expected===null) assert.throws(() => validateOtpInput(body),{status:422})
    else assert.deepEqual(validateOtpInput(body),{email:standardEmail,otp:expected})
  })
}

for (const [caseId,body,expected] of [
  ['UTCID01',{resetToken:'  token  ',newPassword:'Aa1!abcd'},{resetToken:'token',newPassword:'Aa1!abcd'}],
  ['UTCID02',{resetToken:'',newPassword:'Aa1!abcd'},null],
  ['UTCID03',{resetToken:'token',newPassword:'weak'},null],
]) {
  test(`F014 ${caseId} validates reset token and new password`, () => {
    if (expected===null) assert.throws(() => validateResetPasswordInput(body),{status:422})
    else assert.deepEqual(validateResetPasswordInput(body),expected)
  })
}

for (const [caseId,dateOfBirth,gender,valid] of [
  ['UTCID01','2000-02-29','MALE',true],
  ['UTCID02','2001-02-29','MALE',false],
  ['UTCID03','2999-01-01','MALE',false],
  ['UTCID04','2000-02-29','UNKNOWN',false],
]) {
  test(`F015 ${caseId} validates profile date and gender`, () => {
    const body = {fullName:'Nguyễn Văn An',phone:'',dateOfBirth,gender}
    if (!valid) assert.throws(() => validateProfileInput(body),{status:422})
    else assert.deepEqual(validateProfileInput(body),{fullName:'Nguyễn Văn An',phone:null,dateOfBirth,gender})
  })
}

for (const [caseId,avatarUrl,valid] of [
  ['UTCID01','  https://res.cloudinary.com/unit/a.png  ',true],
  ['UTCID02','http://res.cloudinary.com/unit/a.png',false],
  ['UTCID03','https://example.com/unit/a.png',false],
]) {
  test(`F016 ${caseId} validates a Cloudinary avatar URL`, () => {
    if (!valid) assert.throws(() => validateAvatarInput({avatarUrl}),{status:422})
    else assert.deepEqual(validateAvatarInput({avatarUrl}),{avatarUrl:avatarUrl.trim()})
  })
}

for (const [caseId,body,valid] of [
  ['UTCID01',{currentPassword:'Aa1!abcd',newPassword:'Bb2!abcdef'},true],
  ['UTCID02',{currentPassword:'',newPassword:'Aa1!abcd'},false],
  ['UTCID03',{currentPassword:'Aa1!abcd',newPassword:'Aa1!abcd'},false],
  ['UTCID04',{currentPassword:'Aa1!abcd',newPassword:'weak'},false],
]) {
  test(`F017 ${caseId} validates a password change`, () => {
    if (!valid) assert.throws(() => validateChangePasswordInput(body),{status:422})
    else assert.deepEqual(validateChangePasswordInput(body),body)
  })
}
