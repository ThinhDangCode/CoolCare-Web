import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeEmail,normalizePhone,normalizeFullName,isValidEmail,isValidVietnamesePhone,
  isValidFullName,isStrongPassword,validateUuid,
} from '../src/utils.js'

for (const [sheet,fn,cases] of [
  ['F001',normalizeEmail,[['UTCID01','  UNIT@EXAMPLE.TEST  ','unit@example.test'],['UTCID02',null,'']]],
  ['F002',normalizePhone,[['UTCID01','0912.345-678','0912345678'],['UTCID02','  0912 345 678  ','0912345678']]],
  ['F003',normalizeFullName,[['UTCID01','  Nguyễn   Văn An  ','Nguyễn Văn An'],['UTCID02',null,'']]],
]) {
  for (const [caseId,input,expected] of cases) {
    test(`${sheet} ${caseId} normalizes input`, () => assert.equal(fn(input),expected))
  }
}

for (const [sheet,fn,cases] of [
  ['F004',isValidEmail,[['UTCID01','unit@example.test',true],['UTCID02','bad',false],['UTCID03','',false]]],
  ['F005',isValidVietnamesePhone,[['UTCID01','0912345678',true],['UTCID02','+84912345678',true],['UTCID03','0000000000',false],['UTCID04','123',false]]],
  ['F006',isValidFullName,[['UTCID01','Nguyễn Văn An',true],['UTCID02','An123',false],['UTCID03','',false]]],
  ['F007',isStrongPassword,[
    ['UTCID01','Aa1!abcd',true],['UTCID02','Aa1!abc',false],
    ['UTCID03','Aa1!'+'a'.repeat(68),true],['UTCID04','Aa1!'+'a'.repeat(69),false],
    ['UTCID05','aaaaaaaa',false],['UTCID06','AA1!AAAA',false],
    ['UTCID07','aa1!abcd',false],['UTCID08','AA1!ABCD',false],
    ['UTCID09','AaX!abcd',false],['UTCID10','Aa12abcd',false],
  ]],
]) {
  for (const [caseId,input,expected] of cases) {
    test(`${sheet} ${caseId} checks input validity`, () => assert.equal(fn(input),expected))
  }
}

const id = '12345678-1234-1234-1234-123456789012'
for (const [caseId,value,valid] of [
  ['UTCID01',id,true],['UTCID02','bad',false],['UTCID03',undefined,false],
]) {
  test(`F008 ${caseId} validates UUID`, () => {
    if (valid) assert.equal(validateUuid(value),value)
    else assert.throws(() => validateUuid(value),{status:422,code:'INVALID_ID'})
  })
}
