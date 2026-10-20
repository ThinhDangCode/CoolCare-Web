import assert from 'node:assert/strict'
import test from 'node:test'
import { validateTechnicianUpdate } from '../src/modules/technicians/technician.validation.js'
import { TechnicianMutations } from '../src/modules/technicians/technician.mutations.js'
import {
  localProfilePhone,
  profileInputError,
  validateTechnicianProfile,
} from '../../frontend/src/features/technicians/components/technicianProfileValidation.js'

const valid = {
  full_name: 'Nguyễn Văn An',
  phone: '0908341882',
  qualification_level: 'EXPERT',
  years_experience: '4',
  bio: '',
}

test('technician profile identifies every invalid field and does not turn blank experience into zero', () => {
  const errors = validateTechnicianProfile({
    ...valid,
    full_name: 'Nguyễn Văn An1',
    phone: '090abc1882',
    years_experience: '',
  })
  assert.match(errors.full_name, /numbers/)
  assert.match(errors.phone, /digits only/)
  assert.match(errors.years_experience, /required/)
  assert.deepEqual(validateTechnicianProfile({ ...valid, years_experience: '0' }), {})
  assert.deepEqual(validateTechnicianProfile({ ...valid, years_experience: '60' }), {})
  for (const years_experience of ['-1', '61', '80', '3.5', '1e1', 'abc'])
    assert.match(
      validateTechnicianProfile({ ...valid, years_experience }).years_experience,
      /whole number from 0 to 60/
    )
  for (const phone of ['', '090123', '0123456789', '0999999999'])
    assert.ok(validateTechnicianProfile({ ...valid, phone }).phone)
})

test('technician name and phone input guards cover typed and pasted values, including Unicode digits', () => {
  for (const name of ['Nguyễn Văn An', "O'Neill", 'Jean-Pierre', 'Nguyễn Va\u0306n An']) {
    assert.equal(profileInputError('full_name', name), '')
    assert.deepEqual(validateTechnicianProfile({ ...valid, full_name: name }), {})
    assert.equal(
      validateTechnicianUpdate({ ...valid, full_name: name, years_experience: 4 }).full_name,
      name
    )
  }
  for (const name of ['An1', 'An１', 'An١'])
    assert.match(profileInputError('full_name', name), /numbers/)
  assert.ok(profileInputError('full_name', 'An@'))
  assert.match(profileInputError('phone', '090a341882'), /digits only/)
  assert.match(profileInputError('phone', '090 834 1882'), /digits only/)
  assert.equal(localProfilePhone('+84 908.341.882'), '0908341882')
  assert.equal(localProfilePhone('0908341882'), '0908341882')
  assert.match(profileInputError('phone', '1908341882'), /start with 0/)
  assert.match(profileInputError('phone', '09083418823'), /at most 10/)
  assert.equal(profileInputError('phone', ''), '')
  assert.equal(profileInputError('phone', '0'), '')
})

test('backend returns precise profile field errors rather than accepting invalid data', () => {
  assert.throws(
    () =>
      validateTechnicianUpdate({
        ...valid,
        full_name: 'An2',
        phone: '090a341882',
        years_experience: 3.5,
      }),
    (error) => {
      assert.equal(error.status, 422)
      assert.match(error.details.full_name, /numbers/)
      assert.match(error.details.phone, /digits only/)
      assert.match(error.details.years_experience, /whole number from 0 to 60/)
      return true
    }
  )
  for (const years_experience of [null, '', -1, 61, 80, '4'])
    assert.throws(
      () => validateTechnicianUpdate({ ...valid, years_experience }),
      (error) => !!error.details.years_experience
    )
})

test('phone validation requires exactly ten digits starting with zero on both sides', () => {
  for (const [phone, message] of [['1908341882', /start with 0/], ['090834188', /exactly 10/], ['09083418823', /10 digits/], ['+84908341882', /digits only/]]) {
    assert.match(validateTechnicianProfile({ ...valid, phone }).phone, message)
    assert.throws(() => validateTechnicianUpdate({ ...valid, phone, years_experience: 4 }), error => {
      assert.match(error.details.phone, message)
      return true
    })
  }
  assert.equal(validateTechnicianUpdate({ ...valid, years_experience: 60 }).years_experience, 60)
})

test('duplicate technician phone errors point to the phone field and do not emit a successful audit', async () => {
  const audits = []
  const mutations = new TechnicianMutations({
    transaction: async () => {
      throw Object.assign(new Error('duplicate'), { code: '23505' })
    },
    audit: (event) => audits.push(event),
  })
  await assert.rejects(
    mutations.update('technician-id', { ...valid, years_experience: 4 }, 'admin-id'),
    (error) => {
      assert.equal(error.status, 409)
      assert.equal(error.code, 'DUPLICATE_PHONE')
      assert.match(error.details.phone, /another account/)
      return true
    }
  )
  assert.deepEqual(audits, [])
})
