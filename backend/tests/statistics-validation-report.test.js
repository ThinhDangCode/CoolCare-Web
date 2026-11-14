import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAcHistoryQuery } from '../src/modules/customer-ac-units/ac-unit.validation.js'
import { validateReportsQuery } from '../src/modules/reports/reports.validation.js'
import { validateCustomerStatisticsQuery } from '../src/modules/customer-statistics/customer-statistics.validation.js'
import { validateTechnicianStatisticsQuery } from '../src/modules/technician-statistics/technician-statistics.validation.js'

for (const [caseId,query,valid,expected] of [
  ['UTCID01',{brandId:'none',modelId:'none' },true,{brandId:null,modelId:null,page:1,limit:20,offset:0}],
  ['UTCID02',{brandId:'bad',modelId:'none'},false],
  ['UTCID03',{brandId:'none',modelId:'none',limit:'51'},false],
  ['UTCID04',{brandId:'none',modelId:'none',page:'0'},false],
  ['UTCID05',{brandId:'none',modelId:'none',unexpected:true},false],
]) {
  test(`F042 ${caseId} validates AC history filters`, () => {
    if (!valid) assert.throws(() => validateAcHistoryQuery(query),{status:422})
    else assert.deepEqual(validateAcHistoryQuery(query),expected)
  })
}

for (const [sheet,validator] of [
  ['F087',validateReportsQuery],
  ['F088',validateCustomerStatisticsQuery],
  ['F089',validateTechnicianStatisticsQuery],
]) {
  for (const [caseId,query,valid] of [
    ['UTCID01',{from:'2026-10-01',to:'2026-10-31'},true],
    ['UTCID02',{from:'2026-02-29',to:'2026-03-01'},false],
    ['UTCID03',{from:'2026-10-31',to:'2026-10-01'},false],
    ['UTCID04',{from:'2026-10-01',to:'2026-10-31',x:'unexpected'},false],
  ]) {
    test(`${sheet} ${caseId} validates report date range`, () => {
      if (!valid) assert.throws(() => validator(query),{status:422})
      else {
        const result = validator(query)
        assert.equal(result.from,'2026-10-01')
        assert.equal(result.to,'2026-10-31')
        assert.equal(result.timeZone,'Asia/Ho_Chi_Minh')
      }
    })
  }
}
