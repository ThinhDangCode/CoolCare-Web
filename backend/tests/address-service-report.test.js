import assert from 'node:assert/strict'
import test from 'node:test'
import { AddressService } from '../src/modules/address/address.service.js'

const auth = {userId:'user-1',role:'CUSTOMER'}
const input = {city:'Cần Thơ',recipientName:'An',addressLine:'1 Main Street'}

for (const [caseId,credentials,expectedStatus] of [
  ['UTCID01',auth,null],
  ['UTCID02',{},401],
  ['UTCID03',{userId:'user-1',role:'TECHNICIAN'},403],
]) {
  test(`F019 ${caseId} checks customer access`, () => {
    const service = new AddressService({})
    if (expectedStatus===null) assert.equal(service.ensureCustomer(credentials),undefined)
    else assert.throws(() => service.ensureCustomer(credentials),{status:expectedStatus})
  })
}

for (const [caseId,city,valid] of [
  ['UTCID01','Cần Thơ',true],
  ['UTCID02','Thành phố Cần Thơ',true],
  ['UTCID03','TP. Can Tho',true],
  ['UTCID04','Hà Nội',false],
]) {
  test(`F020 ${caseId} checks the Can Tho service area`, () => {
    const service = new AddressService({})
    if (valid) assert.equal(service.ensureCanTho({city}),undefined)
    else assert.throws(() => service.ensureCanTho({city}),{status:400,code:'OUTSIDE_SERVICE_AREA'})
  })
}

for (const [caseId,profile,expected] of [
  ['UTCID01',{id:'customer-1'},'customer-1'],
  ['UTCID02',null,null],
]) {
  test(`F021 ${caseId} resolves the customer profile`, async () => {
    const service = new AddressService({findCustomerProfileByUserId: async userId => {
      assert.equal(userId,auth.userId)
      return profile
    }})
    if (expected===null) await assert.rejects(service.getCustomerId(auth),{status:404,code:'CUSTOMER_PROFILE_NOT_FOUND'})
    else assert.equal(await service.getCustomerId(auth),expected)
  })
}

for (const [sheet,method,repositoryMethod,args] of [
  ['F022','updateAddress','update',[auth,'address-1',input]],
  ['F023','deleteAddress','delete',[auth,'address-1']],
  ['F024','setDefaultAddress','setDefault',[auth,'address-1']],
]) {
  test(`${sheet} UTCID01 reports an address missing for the customer`, async () => {
    const service = new AddressService({
      findCustomerProfileByUserId: async () => ({id:'customer-1'}),
      [repositoryMethod]: async () => null,
    })
    await assert.rejects(service[method](...args),{status:404,code:'ADDRESS_NOT_FOUND'})
  })
  test(`${sheet} UTCID02 changes only the customer-owned address`, async () => {
    const address = {id:'address-1'}
    let received
    const service = new AddressService({
      findCustomerProfileByUserId: async () => ({id:'customer-1'}),
      [repositoryMethod]: async (...actual) => {received=actual; return address},
    })
    assert.equal(await service[method](...args),address)
    assert.deepEqual(received,method==='updateAddress'
      ? ['address-1','customer-1',input] : ['address-1','customer-1'])
  })
  test(`${sheet} UTCID03 rejects an administrator before repository access`, async () => {
    const service = new AddressService({findCustomerProfileByUserId: async () => {throw Error('unexpected lookup')}})
    await assert.rejects(service[method]({...auth,role:'ADMIN'},...args.slice(1)),{status:403,code:'FORBIDDEN'})
  })
}

test('F146 UTCID01 returns addresses for the customer profile', async () => {
  const calls = []
  const service = new AddressService({
    findCustomerProfileByUserId: async userId => {calls.push(['profile',userId]); return {id:'customer-1'}},
    findAllByCustomerId: async customerId => {calls.push(['addresses',customerId]); return [{id:'address-1'}]},
  })
  assert.deepEqual(await service.getAddresses(auth),[{id:'address-1'}])
  assert.deepEqual(calls,[['profile','user-1'],['addresses','customer-1']])
})

test('F146 UTCID02 rejects an administrator', async () => {
  const service = new AddressService({findCustomerProfileByUserId: async () => {throw Error('unexpected lookup')}})
  await assert.rejects(service.getAddresses({...auth,role:'ADMIN'}),{status:403,code:'FORBIDDEN'})
})

test('F146 UTCID03 reports a missing customer profile', async () => {
  const service = new AddressService({findCustomerProfileByUserId: async () => null})
  await assert.rejects(service.getAddresses(auth),{status:404,code:'CUSTOMER_PROFILE_NOT_FOUND'})
})

test('F147 UTCID01 creates an address for the customer profile', async () => {
  const calls = []
  const address = {id:'address-1'}
  const service = new AddressService({
    findCustomerProfileByUserId: async () => ({id:'customer-1'}),
    create: async (...args) => {calls.push(args); return address},
  })
  assert.equal(await service.createAddress(auth,input),address)
  assert.deepEqual(calls,[['customer-1',input]])
})

test('F147 UTCID02 rejects administrator address creation', async () => {
  const service = new AddressService({})
  await assert.rejects(service.createAddress({...auth,role:'ADMIN'},input),{status:403,code:'FORBIDDEN'})
})

test('F147 UTCID03 rejects address creation without a customer profile', async () => {
  const service = new AddressService({findCustomerProfileByUserId: async () => null})
  await assert.rejects(service.createAddress(auth,input),{status:404,code:'CUSTOMER_PROFILE_NOT_FOUND'})
})

test('F147 UTCID04 rejects an address outside Can Tho', async () => {
  const service = new AddressService({findCustomerProfileByUserId: async () => ({id:'customer-1'})})
  await assert.rejects(service.createAddress(auth,{...input,city:'Hà Nội'}),{status:400,code:'OUTSIDE_SERVICE_AREA'})
})

const provinces = [{code:'CT',name:'Cần Thơ'},{code:'HN',name:'Hà Nội'}]
test('F148 UTCID01 returns only Can Tho provinces', async () => {
  const service = new AddressService({getProvinces: async () => provinces})
  assert.deepEqual(await service.getProvinces(),[provinces[0]])
})

test('F148 UTCID02 returns wards in Can Tho', async () => {
  const wards = [{code:'W1',name:'Ninh Kiều'}]
  const service = new AddressService({getProvinces: async () => provinces,getWards: async code => {
    assert.equal(code,'CT')
    return wards
  }})
  assert.equal(await service.getWards('CT'),wards)
})

test('F148 UTCID03 rejects wards outside the service area', async () => {
  const service = new AddressService({getProvinces: async () => provinces})
  await assert.rejects(service.getWards('HN'),{status:400,code:'OUTSIDE_SERVICE_AREA'})
})

test('F148 UTCID04 requires a province code', async () => {
  const service = new AddressService({})
  await assert.rejects(service.getWards(''),{status:400,code:'PROVINCE_CODE_REQUIRED'})
})

test('AddressService rejects a request without a user ID', async () => {
  const service = new AddressService({})
  await assert.rejects(service.getAddresses({role:'CUSTOMER'}),{status:401,code:'UNAUTHORIZED'})
})

test('AddressService updates an existing customer address', async () => {
  const row = {id:'address-1'}
  const service = new AddressService({
    findCustomerProfileByUserId: async () => ({id:'customer-1'}),
    update: async (addressId, customerId, receivedInput) => {
      assert.deepEqual([addressId,customerId,receivedInput],['address-1','customer-1',input])
      return row
    },
  })
  assert.equal(await service.updateAddress(auth,'address-1',input),row)
})

test('AddressService reports a missing address during update', async () => {
  const service = new AddressService({
    findCustomerProfileByUserId: async () => ({id:'customer-1'}),
    update: async () => null,
  })
  await assert.rejects(service.updateAddress(auth,'missing',input),{status:404,code:'ADDRESS_NOT_FOUND'})
})
