import test from 'node:test'
import assert from 'node:assert/strict'
import { validateReview } from '../src/modules/technicians/technician.validation.js'
import { TechnicianMutations } from '../src/modules/technicians/technician.mutations.js'

const review = { status: 'VERIFIED', expected_updated_at: '2026-10-20T00:00:00.000Z' }

test('certificate review works without verification_evidence', async () => {
  assert.equal(validateReview(review, true).status, 'VERIFIED')
  assert.throws(() => validateReview({ ...review, verification_evidence: {} }, true), { status: 422 })
  const queries = []
  const service = new TechnicianMutations({ audit: () => {}, transaction: async (work) => work({
    query: async (sql, params) => {
      queries.push({ sql, params })
      if (sql.startsWith('SELECT technician_id')) return { rows: [{ technician_id: 'technician' }] }
      if (sql.includes('AS expired')) return { rows: [{ verification_status: 'PENDING', updated_at: review.expected_updated_at, document_url: 'https://example.com/doc.pdf', expired: false }] }
      if (sql.includes('WHERE id<>$1')) return { rows: [] }
      return { rows: [{ id: 'certificate' }] }
    },
  }) })
  await service.certification('certificate', validateReview(review, true), 'admin')
  const update = queries.find(({ sql }) => sql.includes('UPDATE technician_certifications SET'))
  assert.ok(update)
  assert.equal(update.params.length, 4)
  assert.ok(!update.sql.includes('verification_evidence'))
})
