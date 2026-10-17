import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validateCertificationId,
  validateCertificateNumber,
  validateCertificationIdentity,
  validateCertificationSubmission,
  validateTechnicianSkillId,
  validateTechnicianSkillSubmission,
} from '../src/modules/technician-portal/technician-portal.validation.js'
import { TechnicianPortalRepository } from '../src/modules/technician-portal/technician-portal.repository.js'

const validCertification = {
  certificate_name: 'Chứng chỉ HVAC nâng cao',
  certificate_number: 'HVAC-2026-01',
  issued_by: 'Hiệp hội Điện lạnh Việt Nam',
  issued_date: '2026-01-10',
  expiry_date: '2029-01-10',
  document_url: 'https://res.cloudinary.com/demo/certificate.pdf',
}

test('certification submission validation accepts all professional fields', () => {
  const result = validateCertificationSubmission(validCertification)
  assert.equal(result.certificate_name, validCertification.certificate_name)
  assert.equal(result.certificate_number, validCertification.certificate_number)
})

test('certification submission validation rejects invalid dates, files and missing required values', () => {
  assert.throws(() => validateCertificationSubmission({ ...validCertification, certificate_number: '' }), { status: 422 })
  assert.throws(() => validateCertificationSubmission({ ...validCertification, expiry_date: '2025-01-10' }), { status: 422 })
  assert.throws(() => validateCertificationSubmission({ ...validCertification, issued_date: '2025-02-30' }), { status: 422 })
  assert.throws(() => validateCertificationSubmission({ ...validCertification, document_url: 'http://example.com/file.pdf' }), { status: 422 })
  assert.throws(() => validateCertificationSubmission({ ...validCertification, extra: true }), { status: 422 })
})

test('certification identifiers must be UUIDs', () => {
  assert.equal(validateCertificationId('12345678-1234-4234-8234-123456789012'), '12345678-1234-4234-8234-123456789012')
  assert.throws(() => validateCertificationId('not-an-id'), { status: 400 })
})

test('certificate number validation trims values and rejects blank numbers', () => {
  assert.equal(validateCertificateNumber(' HVAC-001 '), 'HVAC-001')
  assert.throws(() => validateCertificateNumber('   '), { status: 422 })
})

test('certification identity validation requires and normalizes name, issuer and number', () => {
  assert.deepEqual(validateCertificationIdentity({
    name: ' Chứng chỉ HVAC ',
    issued_by: ' Trường nghề ',
    number: ' HVAC-001 ',
  }), {
    certificate_name: 'Chứng chỉ HVAC',
    issued_by: 'Trường nghề',
    certificate_number: 'HVAC-001',
  })
  assert.throws(() => validateCertificationIdentity({ name: '', issued_by: 'Trường nghề', number: 'HVAC-001' }), { status: 422 })
})

test('technician skill validation accepts active-catalog identifiers and rejects malformed input', () => {
  const skill = {
    skill_id: '12345678-1234-4234-8234-123456789012',
    ac_brand_id: null,
    skill_level: 'ADVANCED',
  }
  assert.deepEqual(validateTechnicianSkillSubmission(skill), skill)
  assert.equal(validateTechnicianSkillId('12345678-1234-4234-8234-123456789012'), '12345678-1234-4234-8234-123456789012')
  assert.throws(() => validateTechnicianSkillSubmission({ ...skill, skill_level: 'MASTER' }), { status: 422 })
  assert.throws(() => validateTechnicianSkillId('not-a-uuid'), { status: 400 })
})

test('technician skill validation accepts deterministic PostgreSQL UUIDs used by seed data', () => {
  const seededSkillId = 'bc908789-caf6-90f0-5410-627f1e767e8c'
  assert.deepEqual(validateTechnicianSkillSubmission({
    skill_id: seededSkillId,
    ac_brand_id: null,
    skill_level: 'INTERMEDIATE',
  }), {
    skill_id: seededSkillId,
    ac_brand_id: null,
    skill_level: 'INTERMEDIATE',
  })
})

test('adding a technician skill rejects duplicate skill and brand assignments', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('FROM technician_profiles')) return { rows: [{ id: 'technician-id' }] }
      if (sql.includes('FROM skills s')) return { rows: [{ id: 'skill-id' }] }
      if (sql.includes('FROM technician_skills')) return { rows: [{ id: 'existing-assignment' }] }
      return { rows: [] }
    },
  }
  const repository = new TechnicianPortalRepository({ transaction: async (operation) => operation(client) })
  await assert.rejects(
    repository.addSkill('user-id', {
      skill_id: '12345678-1234-4234-8234-123456789012',
      ac_brand_id: null,
      skill_level: 'ADVANCED',
    }),
    { status: 409, code: 'DUPLICATE_SKILL' },
  )
})

test('removing the last technician skill is rejected', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('FROM technician_profiles')) return { rows: [{ id: 'technician-id' }] }
      if (sql.startsWith('SELECT id FROM technician_skills')) return { rows: [{ id: 'assignment-id' }] }
      if (sql.includes('count(*)')) return { rows: [{ count: 1 }] }
      return { rows: [] }
    },
  }
  const repository = new TechnicianPortalRepository({ transaction: async (operation) => operation(client) })
  await assert.rejects(
    repository.removeSkill('user-id', '12345678-1234-4234-8234-123456789012'),
    { status: 422, code: 'SKILL_REQUIRED' },
  )
})

test('skill options only query active skills, parent services and brands', async () => {
  const queries = []
  const repository = new TechnicianPortalRepository({
    queryable: {
      async query(sql) {
        queries.push(sql)
        return { rows: [] }
      },
    },
  })
  repository.profile = async () => ({ id: 'technician-id' })
  assert.deepEqual(await repository.skillOptions('user-id'), { skills: [], brands: [] })
  assert.match(queries[0], /s\.is_active AND sv\.is_active/)
  assert.match(queries[1], /WHERE is_active/)
})

test('certification duplicate check matches the case-insensitive name, issuer and number triple', async () => {
  const queries = []
  const client = {
    async query(sql, params) {
      queries.push({ sql, params })
      if (sql.includes('SELECT id FROM technician_certifications')) {
        return { rows: [{ id: 'existing-certificate' }] }
      }
      return { rows: [] }
    },
  }
  const repository = new TechnicianPortalRepository()
  await assert.rejects(
    repository._ensureUniqueCertification(client, {
      certificate_name: ' Chứng chỉ HVAC ',
      issued_by: ' Trường nghề ',
      certificate_number: ' hvac-001 ',
    }),
    (error) => error.code === 'CERTIFICATE_NUMBER_ALREADY_EXISTS' &&
      error.details.certificate_number.includes('đã tồn tại'),
  )
  assert.match(queries[1].sql, /lower\(btrim\(certificate_number\)\)/)
  assert.match(queries[1].sql, /lower\(btrim\(certificate_name\)\)/)
  assert.match(queries[1].sql, /lower\(btrim\(issued_by\)\)/)
  assert.deepEqual(queries[1].params, [' Chứng chỉ HVAC ', ' Trường nghề ', ' hvac-001 ', null])
})
