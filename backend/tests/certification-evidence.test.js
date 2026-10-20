import test from 'node:test'
import assert from 'node:assert/strict'
import { validateReview } from '../src/modules/technicians/technician.validation.js'
import { TechnicianMutations } from '../src/modules/technicians/technician.mutations.js'

const evidence = {method:'OFFICIAL_LOOKUP',reference:'https://issuer.example/lookup/123',notes:'Issuer confirmed holder and certificate validity.',matched:true,serial_number:'123',register_number:''}
const review = {status:'VERIFIED',expected_updated_at:'2026-10-20T00:00:00.000Z',verification_evidence:evidence}
test('approval requires issuer evidence and an explicit match confirmation', () => {
  for (const value of [undefined, {...evidence,matched:false}, {...evidence,reference:'javascript:alert(1)'}, {...evidence,notes:'short'}, {...evidence,method:'AI'}]) {
    assert.throws(() => validateReview({...review,verification_evidence:value},true), {status:422})
  }
  assert.deepEqual(validateReview(review,true).verification_evidence,evidence)
  assert.throws(() => validateReview({...review,verification_evidence:{...evidence,serial_number:'',register_number:''}},true),{status:422})
  assert.equal(validateReview({...review,verification_evidence:{...evidence,serial_number:'',register_number:'SO-456'}},true).verification_evidence.register_number,'SO-456')
  assert.equal(validateReview({status:'REJECTED',reason:'Unable to confirm issuer',expected_updated_at:review.expected_updated_at},true).verification_evidence,null)
  assert.equal(validateReview({status:'VERIFIED'}).status,'VERIFIED')
})
test('certificate review persists evidence in its transaction', async () => {
  const queries = []
  const service = new TechnicianMutations({audit:()=>{},transaction:async work=>work({query:async (sql,params)=>{
    queries.push({sql,params})
    if (sql.startsWith('SELECT technician_id')) return {rows:[{technician_id:'technician'}]}
    if (sql.includes('AS expired')) return {rows:[{verification_status:'PENDING',updated_at:review.expected_updated_at,document_url:'https://example.com/doc.pdf',expired:false}]}
    return {rows:[{id:'certificate'}]}
  }})})
  await service.certification('certificate',validateReview(review,true),'admin')
  const update = queries.find(q=>q.sql.includes('UPDATE technician_certifications SET'))
  assert.deepEqual(JSON.parse(update.params[4]),evidence)
})
