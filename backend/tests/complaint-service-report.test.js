import assert from 'node:assert/strict'
import test from 'node:test'
import { ComplaintService } from '../src/modules/complaints/complaint.service.js'

const actorId = '12345678-1234-1234-1234-123456789012'
const recordId = '23456789-2345-2345-2345-234567890123'
const rows = [
  ['F129','list',[{page:1}]],
  ['F130','get',[recordId]],
  ['F131','resolve',[recordId,{resolution:'Đã hỗ trợ'},actorId]],
  ['F132','createCompensationVoucher',[recordId,{discount_value:100000},actorId]],
  ['F133','listMine',[actorId,{page:1}]],
  ['F134','getMine',[actorId,recordId]],
  ['F135','submit',[actorId,{booking_id:recordId,subject:'Chất lượng'}]],
]

for (const [sheet,method,args] of rows) {
  for (const [caseId,response] of [
    ['UTCID01',{id:recordId}],
    ['UTCID02',null],
    ['UTCID03',new Error('repository failure')],
  ]) {
    test(`${sheet} ${caseId} forwards complaint repository result or error`, async () => {
      let received
      const service = new ComplaintService({
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
      assert.deepEqual(received,args)
    })
  }
}
