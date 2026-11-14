import assert from 'node:assert/strict'
import test from 'node:test'
import { CustomerNotificationsService } from '../src/modules/notifications/customer-notifications.service.js'
import { TechnicianNotificationsService } from '../src/modules/notifications/technician-notifications.service.js'

const userId = '12345678-1234-1234-1234-123456789012'
const notificationId = '23456789-2345-2345-2345-234567890123'

for (const [sheet,Service] of [
  ['F149',CustomerNotificationsService],
  ['F150',TechnicianNotificationsService],
]) {
  test(`${sheet} UTCID01 scopes unread list and paginates page two`, async () => {
    let received
    const service = new Service({list: async (...args) => {
      received=args
      return {items:[{id:notificationId}],pagination:{total:40,unreadCount:5}}
    }})
    const result = await service.list(userId,{page:'2',limit:'20',unreadOnly:'true'})
    assert.deepEqual(received,[userId,{unreadOnly:true,limit:20,offset:20}])
    assert.deepEqual(result.pagination,{page:2,limit:20,total:40,totalPages:2,unreadCount:5})
  })
  for (const [caseId,query] of [
    ['UTCID02',{page:'0'}],
    ['UTCID03',{limit:'51'}],
    ['UTCID04',{unreadOnly:'yes'}],
  ]) {
    test(`${sheet} ${caseId} rejects invalid list filters`, async () => {
      const service = new Service({list: async () => {throw Error('repository should not be called')}})
      await assert.rejects(service.list(userId,query),{status:422,code:'VALIDATION_ERROR'})
    })
  }
  test(`${sheet} UTCID05 requires login`, async () => {
    const service = new Service({list: async () => {throw Error('repository should not be called')}})
    await assert.rejects(service.list(undefined,{}),{status:401,code:'UNAUTHENTICATED'})
  })
  test(`${sheet} UTCID06 marks only the owner's notification as read`, () => {
    const response = {id:notificationId,read:true}
    const service = new Service({markRead: (user,notification) => {
      assert.deepEqual([user,notification],[userId,notificationId])
      return response
    }})
    assert.equal(service.markRead(userId,notificationId),response)
  })
  test(`${sheet} UTCID07 marks only the owner's notifications as read`, () => {
    const response = {updated:3}
    const service = new Service({markAllRead: user => {
      assert.equal(user,userId)
      return response
    }})
    assert.equal(service.markAllRead(userId),response)
  })
}
