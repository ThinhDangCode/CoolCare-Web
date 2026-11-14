import assert from 'node:assert/strict'
import test from 'node:test'
import { CatalogRepository } from '../src/modules/catalog/catalog.repository.js'
import { validateQuery } from '../src/modules/catalog/catalog.validation.js'

const id = '12345678-1234-1234-1234-123456789012'
const kinds = [
  ['F206','categories'],
  ['F207','brands'],
  ['F208','models'],
  ['F209','services'],
  ['F210','skills'],
]

function stub(respond) {
  const calls=[]
  const repository = new CatalogRepository({
    transaction: async work => work({query: async (sql,values) => {
      calls.push([sql,values])
      return respond(sql,values)
    }}),
    audit: () => {},
  })
  return {repository,calls}
}

for (const [sheet,kind] of kinds) {
  test(`${sheet} UTCID01 filters active public records with escaped search`, async () => {
    const {repository,calls} = stub(sql => {
      if (sql.includes('count(*)::int AS all')) return {rows:[{all:1,active:1,inactive:0}]}
      if (sql.includes('count(*)::int AS total')) return {rows:[{total:1}]}
      return {rows:[{id}]}
    })
    const result = await repository.list(kind,validateQuery({search:'%_'},kind),true)
    assert.deepEqual(result.items,[{id}])
    const count = calls.find(([sql]) => sql.includes('count(*)'))
    assert.equal(count[1][0],'%\\%\\_%')
    assert.match(count[0],/deleted_at IS NULL/)
    assert.match(count[0],/is_active/)
  })

  test(`${sheet} UTCID02 rejects an unknown catalog record`, async () => {
    const {repository} = stub(() => ({rows:[]}))
    await assert.rejects(repository.find(kind,id),{status:404,code:'NOT_FOUND'})
  })

  test(`${sheet} UTCID03 soft deletes a catalog record`, async () => {
    const existing = {id,deleted_at:null}
    const trashed = {id,deleted_at:'2026-11-14T00:00:00Z'}
    const {repository,calls} = stub(sql => {
      if (sql.includes('FOR UPDATE')) return {rows:[existing]}
      if (sql.includes('FROM services WHERE category_id') || sql.includes('FROM ac_models WHERE brand_id')) return {rows:[]}
      if (sql.includes('SET deleted_at')) return {rows:[trashed]}
      return {rows:[]}
    })
    assert.equal(await repository.mutate(kind,id,{},'TRASH','admin-1'),trashed)
    const update = calls.find(([sql]) => sql.includes('SET deleted_at'))
    assert.match(update[0],/CURRENT_TIMESTAMP/)
    assert.equal(calls.some(([sql]) => sql.includes('DELETE FROM')),false)
  })

  test(`${sheet} UTCID04 requires restoring a trashed record before edit`, async () => {
    const {repository} = stub(sql => sql.includes('FOR UPDATE')
      ? {rows:[{id,deleted_at:'2026-11-14T00:00:00Z'}]} : {rows:[]})
    await assert.rejects(repository.mutate(kind,id,{name:'Updated'},'UPDATE','admin-1'),
      {status:409,code:'RESOURCE_IN_TRASH'})
  })

  test(`${sheet} UTCID05 rejects a duplicate catalog name`, async () => {
    const data = kind === 'models' ? {model_name:'Duplicate',brand_id:id} : {name:'Duplicate'}
    const {repository,calls} = stub(sql => {
      if (sql.includes('FROM ac_brands') && sql.includes('FOR SHARE')) return {rows:[{id}],rowCount:1}
      if (sql.includes('lower(trim(')) return {rows:[{id}],rowCount:1}
      return {rows:[],rowCount:0}
    })
    await assert.rejects(repository.mutate(kind,null,data,'CREATE','admin-1'),
      {status:409,code:'DUPLICATE_NAME'})
    assert.equal(calls.some(([sql]) => sql.includes('INSERT INTO')),false)
  })
}
