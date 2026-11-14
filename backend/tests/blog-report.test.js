import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validateBlogId,
  validatePublishedBlogQuery,
  validateAdminBlogQuery,
  validateBlogInput,
  validateBlogStatus,
} from '../src/modules/blogs/blog.validation.js'
import { BlogService } from '../src/modules/blogs/blog.service.js'

const blogId = '12345678-1234-1234-1234-123456789012'
const article = {
  title: 'Bảo dưỡng máy lạnh',
  slug: 'bao-duong-may-lanh',
  content: 'Hướng dẫn vệ sinh máy lạnh định kỳ tại nhà.',
}

for (const [id, body, outcome] of [
  ['UTCID01', { status:'PUBLISHED' }, 'PUBLISHED'],
  ['UTCID02', { status:'BAD' }, 'error'],
  ['UTCID03', { status:'PUBLISHED', extra:'yes' }, 'error'],
]) {
  test(`F030 ${id} validates blog status`, () => {
    if (outcome === 'error') assert.throws(() => validateBlogStatus(body), {status:422})
    else assert.equal(validateBlogStatus(body), outcome)
  })
}

for (const [id, query, outcome] of [
  ['UTCID01', {}, {page:1,limit:10,search:''}],
  ['UTCID02', {page:0}, 'error'],
  ['UTCID03', {limit:101}, 'error'],
  ['UTCID04', {limit:50}, {page:1,limit:50,search:''}],
  ['UTCID05', {limit:0}, 'error'],
  ['UTCID06', {limit:51}, 'error'],
  ['UTCID07', {search:'a'.repeat(100)}, {page:1,limit:10,search:'a'.repeat(100)}],
  ['UTCID08', {search:'a'.repeat(101)}, 'error'],
]) {
  test(`F033 ${id} validates published blog query`, () => {
    if (outcome === 'error') assert.throws(() => validatePublishedBlogQuery(query), {status:422})
    else assert.deepEqual(validatePublishedBlogQuery(query), outcome)
  })
}

for (const [id, query, outcome] of [
  ['UTCID01', {}, {page:1,limit:10,search:'',status:'ALL',sort:'NEWEST'}],
  ['UTCID02', {page:0}, 'error'],
  ['UTCID03', {limit:101}, 'error'],
  ['UTCID04', {status:'UNKNOWN'}, 'error'],
  ['UTCID05', {limit:100}, {page:1,limit:100,search:'',status:'ALL',sort:'NEWEST'}],
  ['UTCID06', {limit:0}, 'error'],
  ['UTCID07', {search:'a'.repeat(150)}, {page:1,limit:10,search:'a'.repeat(150),status:'ALL',sort:'NEWEST'}],
  ['UTCID08', {search:'a'.repeat(151)}, 'error'],
]) {
  test(`F034 ${id} validates admin blog query`, () => {
    if (outcome === 'error') assert.throws(() => validateAdminBlogQuery(query), {status:422})
    else assert.deepEqual(validateAdminBlogQuery(query), outcome)
  })
}

for (const [id, body, errorField] of [
  ['UTCID01', article, null],
  ['UTCID02', {...article,title:'abcd'}, 'title'],
  ['UTCID03', {...article,slug:'Bad Slug'}, 'slug'],
  ['UTCID04', {...article,content:'ngắn'}, 'content'],
  ['UTCID05', {...article,thumbnail_url:'ftp://example.test/image.png'}, 'thumbnail_url'],
  ['UTCID06', {...article,unsupported:true}, 'unsupported'],
]) {
  test(`F038 ${id} validates blog input`, () => {
    if (errorField) {
      assert.throws(() => validateBlogInput(body), error =>
        error?.status === 422 && Boolean(error.details?.[errorField]))
    } else {
      assert.deepEqual(validateBlogInput(body), {...article,status:'DRAFT'})
    }
  })
}

for (const [id, value, valid] of [
  ['UTCID01', blogId, true],
  ['UTCID02', 'bad', false],
  ['UTCID03', undefined, false],
]) {
  test(`F065 ${id} validates blog ID`, () => {
    if (valid) assert.equal(validateBlogId(value), value)
    else assert.throws(() => validateBlogId(value), {code:'INVALID_ID'})
  })
}

for (const [name, method, args, expected] of [
  ['F114', 'listPublished', [{page:1}], {id:blogId}],
  ['F115', 'getPublished', [blogId], {id:blogId}],
  ['F116', 'listAdmin', [{page:1}], {id:blogId}],
  ['F117', 'getAdmin', [blogId], {id:blogId}],
  ['F118', 'create', [article,'admin-id'], {id:blogId}],
  ['F119', 'update', [blogId,article,'admin-id'], {id:blogId}],
  ['F120', 'changeStatus', [blogId,'PUBLISHED','admin-id'], {id:blogId}],
]) {
  for (const [id, response] of [['UTCID01',expected], ['UTCID02',null], ['UTCID03',new Error('repository failed')]]) {
    test(`${name} ${id} returns or propagates the repository outcome`, async () => {
      const calls = []
      const execute = (...received) => {
        calls.push([method,...received])
        if (response instanceof Error) throw response
        return response
      }
      const save = (...received) => {
        calls.push(['save',...received])
        if (response instanceof Error) throw response
        return response
      }
      const repository = {[method]:execute,save}
      const action = () => new BlogService(repository)[method](...args)
      if (response instanceof Error) await assert.rejects(async () => action(), response)
      else assert.deepEqual(await action(), response)
      const expectedCall = method === 'create' ? ['save',null,article,'admin-id','CREATE_BLOG']
        : method === 'update' ? ['save',blogId,article,'admin-id','UPDATE_BLOG']
        : method === 'changeStatus' ? ['save',blogId,{status:'PUBLISHED'},'admin-id','TOGGLE_BLOG_STATUS']
        : [method,...args]
      assert.deepEqual(calls, [expectedCall])
    })
  }
}
