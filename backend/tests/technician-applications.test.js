import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { createTechnicianApplicationRouter } from '../src/modules/technician-applications/technician-application.routes.js'
import { validateTechnicianApplication } from '../src/modules/technician-applications/technician-application.validation.js'

const validBody = {
  identity_number: '012345678901',
  identity_front_url: 'https://res.cloudinary.com/demo/front.jpg',
  identity_back_url: 'https://res.cloudinary.com/demo/back.jpg',
  qualification_level: 'INTERMEDIATE',
  years_experience: 3,
  bio: 'Có kinh nghiệm vệ sinh và sửa chữa máy lạnh dân dụng.',
  areas: [{ city: 'Thành phố Cần Thơ', ward: 'Phường Ninh Kiều' }],
  skills: [{
    skill_id: '12345678-1234-1234-1234-123456789012',
    ac_brand_id: null,
    skill_level: 'INTERMEDIATE',
  }],
  certifications: [{
    certificate_name: 'Chứng chỉ điện lạnh',
    certificate_number: 'CC-01',
    issued_by: 'Trường nghề',
    issued_date: '2024-01-01',
    expiry_date: null,
    document_url: 'https://res.cloudinary.com/demo/certificate.pdf',
  }],
}

test('technician application validation accepts a complete application', () => {
  const result = validateTechnicianApplication(validBody)
  assert.equal(result.identity_number, '012345678901')
  assert.equal(result.skills.length, 1)
  assert.equal(result.certifications.length, 1)
})

test('technician application validation rejects unsafe or incomplete data', () => {
  assert.throws(() => validateTechnicianApplication({ ...validBody, identity_number: '123' }), { status: 422 })
  assert.throws(() => validateTechnicianApplication({ ...validBody, identity_number: '112345678901' }), { status: 422 })
  assert.throws(() => validateTechnicianApplication({ ...validBody, identity_number: '01234567890A' }), { status: 422 })
  assert.throws(() => validateTechnicianApplication({ ...validBody, identity_front_url: 'http://example.com/id.jpg' }), { status: 422 })
  assert.throws(() => validateTechnicianApplication({ ...validBody, identity_back_url: validBody.identity_front_url }), { status: 422 })
  assert.throws(() => validateTechnicianApplication({ ...validBody, skills: [] }), { code: 'SKILL_REQUIRED' })
  assert.throws(() => validateTechnicianApplication({ ...validBody, extra: true }), { status: 422 })
  assert.throws(() => validateTechnicianApplication({
    ...validBody,
    certifications: [{ ...validBody.certifications[0], certificate_number: 'x'.repeat(31) }],
  }), { status: 422 })
  assert.throws(() => validateTechnicianApplication({
    ...validBody,
    certifications: [{ ...validBody.certifications[0], expiry_date: '2023-01-01' }],
  }), { status: 422 })
  assert.throws(() => validateTechnicianApplication({
    ...validBody,
    certifications: [{ ...validBody.certifications[0], issued_date: null, expiry_date: '2025-01-01' }],
  }), { status: 422 })
})

test('technician application routes require a customer and expose submit/status/options', async () => {
  const calls = []
  const repository = {
    async options() { calls.push('options'); return { skills: [] } },
    async status(userId) { calls.push(['status', userId]); return null },
    async submit(userId, body) { calls.push(['submit', userId, body]); return { id: 'application-id', verification_status: 'PENDING' } },
  }
  const app = express()
  app.use(express.json())
  app.use('/applications', createTechnicianApplicationRouter(repository))
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/applications`
  const userId = '12345678-1234-1234-1234-123456789012'
  const headers = (role) => ({ Authorization: `Bearer ${jwt.sign({ role, purpose: 'access' }, env.jwtSecret, { subject: userId, expiresIn: '1m' })}` })
  try {
    assert.equal((await fetch(`${base}/me`)).status, 401)
    assert.equal((await fetch(`${base}/me`, { headers: headers('ADMIN') })).status, 403)
    assert.equal((await fetch(`${base}/options`, { headers: headers('CUSTOMER') })).status, 200)
    assert.equal((await fetch(`${base}/me`, { headers: headers('CUSTOMER') })).status, 200)
    const response = await fetch(base, {
      method: 'POST',
      headers: { ...headers('CUSTOMER'), 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    assert.equal(response.status, 201)
    assert.equal((await response.json()).data.verification_status, 'PENDING')
    assert.equal(calls.at(-1)[1], userId)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
