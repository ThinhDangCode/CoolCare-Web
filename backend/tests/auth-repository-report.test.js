import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { AuthRepository } from '../src/modules/auth/auth.repository.js'

const repository = new AuthRepository()
const userId = '12345678-1234-1234-1234-123456789012'
const requestId = '23456789-2345-2345-2345-234567890123'
const future = '2099-01-01T00:00:00.000Z'
const past = '2020-01-01T00:00:00.000Z'

function transaction(t, respond) {
  const queries = []
  let released = 0
  t.mock.method(pool,'connect',async () => ({
    query: async (sql,params) => {
      queries.push([sql,params])
      if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return {rows:[]}
      return respond(sql,params)
    },
    release: () => {released++},
  }))
  return {queries,released:() => released}
}

function queryable(row) {
  const queries=[]
  return {queries,query: async (sql,params) => {queries.push([sql,params]); return {rows:row ? [row] : []}}}
}

test('AuthRepository looks up users by email and ID', async () => {
  const row = {id:userId,email:'user@example.test'}
  const db = queryable(row)
  assert.equal(await repository.findUserByEmail('user@example.test',db),row)
  assert.equal(await repository.findUserById(userId,db),row)
  assert.match(db.queries[0][0],/LOWER\(u.email\) = \$1/)
  assert.deepEqual(db.queries[1][1],[userId])
  assert.equal(await repository.findUserById(userId,queryable(null)),null)
})

test('AuthRepository creates a customer with linked customer profile', async t => {
  const tx = transaction(t,async (sql,params) => {
    if (sql.includes('FROM roles')) return {rows:[{id:'role-customer'}]}
    if (sql.includes('INSERT INTO users')) return {rows:[{id:params[0],email:params[2],phone:params[3],full_name:params[5]}]}
    return {rows:[]}
  })
  const result = await repository.createCustomer({email:'user@example.test',phone:'0901234567',passwordHash:'hash',fullName:'An'})
  assert.equal(result.email,'user@example.test')
  assert.equal(result.role,'CUSTOMER')
  assert.equal(result.has_technician_profile,false)
  assert.equal(tx.queries.filter(([sql]) => sql.includes('INSERT INTO')).length,2)
  assert.equal(tx.released(),1)
})

test('AuthRepository rejects customer creation without the customer role', async t => {
  const tx = transaction(t,async () => ({rows:[]}))
  await assert.rejects(repository.createCustomer({email:'user@example.test'}),/CUSTOMER role is missing/)
  assert.equal(tx.queries.some(([sql]) => sql==='ROLLBACK'),true)
  assert.equal(tx.released(),1)
})

test('AuthRepository returns an existing Google account', async t => {
  const row = {id:userId,google_sub:'google-1'}
  const tx = transaction(t,async () => ({rows:[row]}))
  assert.equal(await repository.findOrCreateGoogleCustomer({googleSub:'google-1',email:'user@example.test'}),row)
  assert.equal(tx.queries.filter(([sql]) => sql.includes('FROM users')).length,1)
})

test('AuthRepository links an existing email to a Google account', async t => {
  const row = {id:userId,google_sub:'google-1'}
  const tx = transaction(t,async sql => {
    if (sql.includes('WHERE u.google_sub')) return {rows:[]}
    if (sql.includes('FOR UPDATE')) return {rows:[{id:userId,google_sub:null}]}
    if (sql.includes('WHERE u.id')) return {rows:[row]}
    return {rows:[]}
  })
  assert.equal(await repository.findOrCreateGoogleCustomer({googleSub:'google-1',email:'user@example.test'}),row)
  assert.deepEqual(tx.queries.find(([sql]) => sql.includes('SET google_sub'))[1],['google-1',userId])
})

test('AuthRepository rejects a Google account linked to another subject', async t => {
  transaction(t,async sql => {
    if (sql.includes('WHERE u.google_sub')) return {rows:[]}
    return {rows:[{id:userId,google_sub:'another-google'}]}
  })
  await assert.rejects(repository.findOrCreateGoogleCustomer({googleSub:'google-1',email:'user@example.test'}),
    {status:409,code:'GOOGLE_ACCOUNT_LINKED'})
})

test('AuthRepository creates a new Google customer and profile', async t => {
  const row = {id:userId,google_sub:'google-1'}
  const tx = transaction(t,async sql => {
    if (sql.includes('WHERE u.google_sub')) return {rows:[]}
    if (sql.includes('FOR UPDATE')) return {rows:[]}
    if (sql.includes('FROM roles')) return {rows:[{id:'role-customer'}]}
    if (sql.includes('WHERE u.id')) return {rows:[row]}
    return {rows:[]}
  })
  assert.equal(await repository.findOrCreateGoogleCustomer({googleSub:'google-1',email:'user@example.test',fullName:'An'}),row)
  assert.equal(tx.queries.filter(([sql]) => sql.includes('INSERT INTO')).length,2)
})

for (const [name,method] of [
  ['password reset','replacePasswordResetToken'],
  ['email verification','replaceEmailVerificationToken'],
]) {
  test(`AuthRepository replaces a ${name} token atomically`, async t => {
    const tx = transaction(t,async sql => sql.includes('INSERT INTO password_reset_tokens')
      ? {rows:[{id:requestId,user_id:userId,expires_at:future}]} : {rows:[]})
    const row = await repository[method]({userId,tokenHash:'hash',expiresAt:future})
    assert.equal(row.id,requestId)
    assert.equal(tx.queries.filter(([sql]) => sql.includes('password_reset_tokens')).length,2)
  })
}

for (const [method,updateSql] of [
  ['consumeEmailVerification','email_verified_at = CURRENT_TIMESTAMP'],
  ['consumeResetAndUpdatePassword','password_hash = $1'],
]) {
  for (const [caseName,request,expected] of [
    ['missing',null,'missing'],
    ['used',{used_at:past,expires_at:future},'used'],
    ['expired',{used_at:null,expires_at:past},'expired'],
  ]) {
    test(`AuthRepository.${method} reports ${caseName} tokens`, async t => {
      const tx = transaction(t,async sql => sql.includes('FOR UPDATE')
        ? {rows:request ? [{id:requestId,user_id:userId,...request}] : []} : {rows:[]})
      const result = await repository[method]({requestId,userId,passwordHash:'new-hash'})
      assert.equal(result.status,expected)
      assert.equal(tx.queries.some(([sql]) => sql.includes(updateSql)),false)
    })
  }
}

test('AuthRepository verifies email and consumes the token once', async t => {
  const row = {id:userId,email:'user@example.test'}
  const tx = transaction(t,async sql => {
    if (sql.includes('FOR UPDATE')) return {rows:[{id:requestId,user_id:userId,used_at:null,expires_at:future}]}
    if (sql.includes('email_verified_at = CURRENT_TIMESTAMP')) return {rows:[{id:userId}]}
    if (sql.includes('WHERE u.id')) return {rows:[row]}
    return {rows:[]}
  })
  assert.deepEqual(await repository.consumeEmailVerification({requestId,userId}),{status:'verified',user:row})
  assert.equal(tx.queries.some(([sql]) => sql.includes('SET used_at = CURRENT_TIMESTAMP')),true)
})

test('AuthRepository updates password and consumes the reset token once', async t => {
  const tx = transaction(t,async sql => {
    if (sql.includes('FOR UPDATE')) return {rows:[{id:requestId,user_id:userId,used_at:null,expires_at:future}]}
    if (sql.includes('password_hash = $1')) return {rows:[{id:userId}]}
    return {rows:[]}
  })
  assert.deepEqual(await repository.consumeResetAndUpdatePassword({requestId,userId,passwordHash:'new-hash'}),{status:'updated'})
  assert.deepEqual(tx.queries.find(([sql]) => sql.includes('password_hash = $1'))[1],['new-hash',userId])
})
