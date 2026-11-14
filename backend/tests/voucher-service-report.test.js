import assert from 'node:assert/strict'
import test from 'node:test'
import { VoucherService } from '../src/modules/vouchers/voucher.service.js'

const idA = '12345678-1234-1234-1234-123456789012'
const idB = '23456789-2345-2345-2345-234567890123'
const rows = [
  ['F121','available',[idA,idB],'available',[idA,idB]],
  ['F122','apply',[idA,idB,'COOL10'],'apply',[idA,idB,'COOL10']],
  ['F123','remove',[idA,idB],'remove',[idA,idB]],
  ['F124','list',[{page:1}],'list',[{page:1}]],
  ['F125','create',[{code:'COOL10'},idA],'save',[null,{code:'COOL10'},idA,'CREATE_VOUCHER']],
  ['F126','update',[idB,{code:'COOL20'},idA],'save',[idB,{code:'COOL20'},idA,'UPDATE_VOUCHER']],
  ['F127','changeStatus',[idB,false,idA],'save',[idB,{is_active:false},idA,'TOGGLE_VOUCHER_STATUS']],
  ['F128','listUsages',[{page:1}],'listUsages',[{page:1}]],
]

for (const [sheet,method,args,repositoryMethod,repositoryArgs] of rows) {
  for (const [caseId,response] of [
    ['UTCID01',{id:idB}],
    ['UTCID02',null],
    ['UTCID03',new Error('repository failure')],
  ]) {
    test(`${sheet} ${caseId} calls voucher repository and forwards its result`, async () => {
      let received
      const service = new VoucherService({
        [repositoryMethod]: (...actualArgs) => {
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
      assert.deepEqual(received, repositoryArgs)
    })
  }
}
