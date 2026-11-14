import assert from 'node:assert/strict'
import test from 'node:test'
import { validateInput } from '../src/modules/catalog/catalog.validation.js'

const categoryId = '12345678-1234-1234-1234-123456789012'
for (const [caseId,price,valid] of [
  ['UTCID01',200000,true],
  ['UTCID02',0,true],
  ['UTCID03',9999999999.99,true],
  ['UTCID04',-1,false],
  ['UTCID05',10000000000,false],
  ['UTCID06',1.001,false],
]) {
  test(`F043 ${caseId} validates service price boundary`, () => {
    const body = {name:'Vệ sinh máy lạnh',category_id:categoryId,base_price:price}
    if (!valid) assert.throws(() => validateInput('services',body),{status:422})
    else assert.deepEqual(validateInput('services',body),body)
  })
}
