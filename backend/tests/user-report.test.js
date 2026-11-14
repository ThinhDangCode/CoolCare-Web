import assert from 'node:assert/strict'
import test from 'node:test'
import {
  validateUserId,
  validateUserListQuery,
  validateUserStatus,
} from '../src/modules/users/user.validation.js'
import { UserService } from '../src/modules/users/user.service.js'
import { UserRepository } from '../src/modules/users/user.repository.js'

const id = '12345678-1234-1234-1234-123456789012'

const statusCases = [
  ['UTCID01', {status:'LOCKED'}, true],
  ['UTCID02', {status:'Administrator'}, false],
  ['UTCID03', {status:'LOCKED', extra:'Yes'}, false],
]
for (const [caseId, body, valid] of statusCases) {
  test(`F031 ${caseId} validates documented status input`, () => {
    if (valid) assert.equal(validateUserStatus(body), body.status)
    else assert.throws(() => validateUserStatus(body), {status:422})
  })
}

const listCases = [
  ['UTCID01', {}, true, {page:1, limit:10, search:'',status:'ALL',role:'ALL',sortBy:'user_number',sortOrder:'asc'}],
  ['UTCID02', {page:0}, false],
  ['UTCID03', {limit:101}, false],
  ['UTCID04', {status:'UNKNOWN'}, false],
  ['UTCID05', {limit:100}, true, {limit:100}],
  ['UTCID06', {limit:0}, false],
  ['UTCID07', {status:'LOCKED',role:'TECHNICIAN',sort_by:'full_name',sort_order:'desc'}, true,
    {status:'LOCKED',role:'TECHNICIAN',sortBy:'full_name',sortOrder:'desc'}],
  ['UTCID08', {role:'SUPERADMIN'}, false],
  ['UTCID09', {sort_by:'password_hash'}, false],
  ['UTCID10', {search:'a'.repeat(150)}, true, {search:'a'.repeat(150)}],
  ['UTCID11', {search:'a'.repeat(151)}, false],
]
for (const [caseId, query, valid, expected] of listCases) {
  test(`F035 ${caseId} validates documented list filters`, () => {
    if (!valid) assert.throws(() => validateUserListQuery(query), {status:422})
    else assert.deepEqual(validateUserListQuery(query), {
      page:1,limit:10,search:'',status:'ALL',role:'ALL',sortBy:'user_number',sortOrder:'asc',
      ...expected,
    })
  })
}

for (const [caseId, value, valid] of [
  ['UTCID01', id, true],
  ['UTCID02', 'bad', false],
  ['UTCID03', undefined, false],
]) {
  test(`F067 ${caseId} validates documented user ID`, () => {
    if (valid) assert.equal(validateUserId(value), value)
    else assert.throws(() => validateUserId(value), {status:422})
  })
}

for (const [sheet, method, args] of [
  ['F136','list',[{page:1}]],
  ['F137','changeStatus',[id,'LOCKED','actor-id']],
]) {
  for (const [caseId, response] of [
    ['UTCID01',{id}],
    ['UTCID02',null],
    ['UTCID03',new Error('repository failure')],
  ]) {
    test(`${sheet} ${caseId} forwards repository result or error`, async () => {
      let received
      const service = new UserService({
        [method]: (...actualArgs) => {
          received = actualArgs
          if (response instanceof Error) throw response
          return response
        },
      })
      if (response instanceof Error) {
        await assert.rejects(async () => service[method](...args), response)
      } else {
        assert.equal(service[method](...args), response)
      }
      assert.deepEqual(received, args)
    })
  }
}

test('UserRepository.list escapes search and passes pagination to both queries', async () => {
  const calls = []
  const transaction = async (callback) => callback({
    query: async (...args) => {
      calls.push(args)
      if (args[0].includes('count(*)')) return {rows:[{total:2}]}
      return {rows:[{id:'user-1'},{id:'user-2'}]}
    },
  })
  const repository = new UserRepository({transaction})
  const result = await repository.list({page:2,limit:5,search:'a_b%',status:'LOCKED',role:'CUSTOMER',sortBy:'full_name',sortOrder:'desc'})
  assert.deepEqual(result,{items:[{id:'user-1'},{id:'user-2'}],total:2,page:2,limit:5})
  assert.match(calls[2][0],/ORDER BY u\.full_name DESC,u\.user_number ASC/)
  assert.deepEqual(calls[1][1],['%a\\_b\\%%','LOCKED','CUSTOMER'])
  assert.deepEqual(calls[2][1],['%a\\_b\\%%','LOCKED','CUSTOMER',5,5])
})

test('UserRepository.list keeps default order without filters', async () => {
  const calls = []
  const repository = new UserRepository({transaction: async callback => callback({query: async (...args) => {
    calls.push(args)
    return args[0].includes('count(*)') ? {rows:[{total:0}]} : {rows:[]}
  }})})
  const result = await repository.list(validateUserListQuery({}))
  assert.deepEqual(result,{items:[],total:0,page:1,limit:10})
  assert.match(calls[2][0],/ORDER BY u\.user_number ASC LIMIT \$1 OFFSET \$2/)
  assert.deepEqual(calls[2][1],[10,0])
})

test('UserRepository.changeStatus rejects self change before opening a transaction', async () => {
  const repository = new UserRepository({transaction: async () => { throw Error('unexpected transaction') }})
  await assert.rejects(repository.changeStatus(id,'LOCKED',id), {status:409,code:'SELF_LOCK_FORBIDDEN'})
})

test('UserRepository.changeStatus rejects missing user', async () => {
  const repository = new UserRepository({transaction: async callback => callback({query: async () => ({rows:[]})})})
  await assert.rejects(repository.changeStatus(id,'LOCKED','actor-id'), {status:404,code:'NOT_FOUND'})
})

test('UserRepository.changeStatus skips update and audit for unchanged status', async () => {
  let queries = 0
  let audits = 0
  const before = {id,status:'LOCKED'}
  const repository = new UserRepository({
    transaction: async callback => callback({query: async () => {queries++; return {rows:[before]} }}),
    audit: () => {audits++},
  })
  assert.equal(await repository.changeStatus(id,'LOCKED','actor-id'),before)
  assert.equal(queries,1)
  assert.equal(audits,0)
})

test('UserRepository.changeStatus updates status and writes an audit record', async () => {
  const queries = []
  const audits = []
  const row = {id,status:'LOCKED'}
  const repository = new UserRepository({
    transaction: async callback => callback({query: async (sql,params) => {
      queries.push([sql,params])
      return {rows:[queries.length===1 ? {id,status:'ACTIVE'} : row]}
    }}),
    audit: entry => audits.push(entry),
  })
  assert.equal(await repository.changeStatus(id,'LOCKED','actor-id'),row)
  assert.deepEqual(queries[1][1],['LOCKED',id])
  assert.deepEqual(audits[0],{
    actorId:'actor-id',action:'LOCK_USER',entityType:'USER',entityId:id,
    before:{status:'ACTIVE'},after:{status:'LOCKED'},
  })
})
