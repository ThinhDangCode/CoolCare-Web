import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAddressInput } from '../src/modules/address/address.validation.js'

const base = {
  recipient_name:'Nguyễn Văn An',phone:'0912345678',city:'Cần Thơ',
  ward:'Ninh Kiều',address_line:'12 Đường A',latitude:10,longitude:105,
}
for (const [caseId,patch,valid,expected] of [
  ['UTCID01',{},true,{}],
  ['UTCID02',{latitude:-90,longitude:-180},true,{latitude:-90,longitude:-180}],
  ['UTCID03',{latitude:90,longitude:180},true,{latitude:90,longitude:180}],
  ['UTCID04',{latitude:0,longitude:0},true,{latitude:0,longitude:0}],
  ['UTCID05',{phone:'123'},false],
  ['UTCID06',{recipient_name:''},false],
  ['UTCID07',{address_line:'a'.repeat(256)},false],
  ['UTCID08',{latitude:90.01},false],
  ['UTCID09',{longitude:-180.01},false],
  ['UTCID10',{recipient_name:'a'.repeat(101)},false],
  ['UTCID11',{latitude:-90.01},false],
  ['UTCID12',{longitude:180.01},false],
  ['UTCID13',{recipient_name:'a'.repeat(100)},true,{}],
]) {
  test(`F018 ${caseId} validates address boundary input`, () => {
    const body = {...base,...patch}
    if (!valid) assert.throws(() => validateAddressInput(body),{status:400,code:'VALIDATION_ERROR'})
    else {
      const result = validateAddressInput(body)
      assert.equal(result.recipientName,body.recipient_name)
      assert.equal(result.phone,body.phone)
      assert.equal(result.city,'Cần Thơ')
      assert.equal(result.latitude,expected.latitude ?? body.latitude)
      assert.equal(result.longitude,expected.longitude ?? body.longitude)
    }
  })
}
