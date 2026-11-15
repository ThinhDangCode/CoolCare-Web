import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSearch, searchPattern, searchSql } from '../src/search.js'

test('Vietnamese search accepts accented and plain input while treating wildcards literally', () => {
  assert.equal(normalizeSearch('Trần Đỗ'), 'tran do')
  assert.equal(searchPattern('Đỗ_%'), '%do\\_\\%%')
  assert.equal(searchPattern('do_%'), '%do\\_\\%%')
  assert.match(searchSql('u.full_name'), /^translate\(lower\(u\.full_name\),/)
})
