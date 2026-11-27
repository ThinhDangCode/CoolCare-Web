
import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'
import { writeAdminAudit as writeManagementAudit } from '../audit/admin-audit.js'
import { resources } from './catalog.validation.js'
import { listSkills } from './skill.repository.js'
import { searchPattern, searchSql } from '../../search.js'

export class CatalogRepository {
  constructor({ transaction = withTransaction, audit = writeManagementAudit } = {}) {
    this.transaction = transaction
    this.audit = audit
  }

  async list(kind, filters, mobile = false) {
    if (kind === 'skills') {
      return listSkills(filters, mobile, this.transaction)
    }

    const { table } = resources[kind]
    const values = []

    const clauses = [
      `r.deleted_at IS ${!mobile && filters.trash ? 'NOT ' : ''}NULL`,
    ]

    const bind = (value) => {
      values.push(value)
      return `$${values.length}`
    }

    if (filters.search) {
      clauses.push(
        `${searchSql(`r.${kind === 'models' ? 'model_name' : 'name'}`)} LIKE ${bind(searchPattern(filters.search))}`
      )
    }

    if (mobile || filters.status !== 'all') {
      clauses.push(
        `r.is_active = ${bind(mobile || filters.status === 'active')}`
      )
    }

    if (kind === 'services' && filters.categoryId) {
      clauses.push(`r.category_id = ${bind(filters.categoryId)}`)
    }

    if (mobile && kind === 'services') {
      clauses.push('c.is_active = true AND c.deleted_at IS NULL')
    }

    if (kind === 'models') {
      if (filters.brandId) {
        clauses.push(`r.brand_id = ${bind(filters.brandId)}`)
      }

      if (filters.acType) {
        clauses.push(`r.ac_type = ${bind(filters.acType)}`)
      }

      if (filters.capacityBtu !== undefined) {
        clauses.push(`r.capacity_btu = ${bind(filters.capacityBtu)}`)
      }

      if (filters.inverter !== undefined) {
        clauses.push(`r.inverter = ${bind(filters.inverter)}`)
      }

      if (mobile) {
        clauses.push('b.is_active = true AND b.deleted_at IS NULL')
      }
    }

    const join =
      kind === 'services'
        ? ' JOIN service_categories c ON c.id = r.category_id'
        : kind === 'models'
          ? ' JOIN ac_brands b ON b.id = r.brand_id'
          : ''

    const where = clauses.length
      ? ` WHERE ${clauses.join(' AND ')}`
      : ''

    const columns =
      kind === 'models'
        ? 'r.*, b.name AS brand_name'
        : kind === 'services'
          ? 'r.*, c.name AS category_name'
          : kind === 'categories'
            ? `r.*, (
                SELECT count(*)::int
                FROM services s
                WHERE s.category_id = r.id AND s.deleted_at IS NULL
              ) AS service_count`
            : `r.*, (
                SELECT count(*)::int
                FROM ac_models m
                WHERE m.brand_id = r.id AND m.deleted_at IS NULL
              ) AS model_count`

    const nameColumn = kind === 'models'
      ? 'model_name'
      : 'name'

    const orders = {
      NEWEST: 'r.created_at DESC, r.id',
      OLDEST: 'r.created_at ASC, r.id',
      NAME_ASC: `LOWER(r.${nameColumn}) ASC, r.id`,
      NAME_DESC: `LOWER(r.${nameColumn}) DESC, r.id DESC`,
      PRICE_ASC: 'r.base_price ASC, r.id',
      PRICE_DESC: 'r.base_price DESC, r.id DESC',
      CAPACITY_ASC: 'r.capacity_btu ASC NULLS LAST, r.id',
      CAPACITY_DESC: 'r.capacity_btu DESC NULLS LAST, r.id DESC',
    }

    const order = orders[filters.sort] ?? orders.NEWEST

    return this.transaction(async (client) => {
      await client.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'
      )

      const count = await client.query(
        `SELECT count(*)::int AS total
         FROM ${table} r${join}${where}`,
        values
      )

      const pagination = [
        ...values,
        filters.limit,
        (filters.page - 1) * filters.limit,
      ]

      const rows = await client.query(
        `SELECT ${columns}
         FROM ${table} r${join}${where}
         ORDER BY ${order}
         LIMIT $${values.length + 1}
         OFFSET $${values.length + 2}`,
        pagination
      )

      return {
        items: rows.rows,
        total: count.rows[0].total,
        page: filters.page,
        limit: filters.limit,
      }
    })
  }

  async find(kind, id, mobile = false) {
    const resource = resources[kind]

    if (!resource) {
      throw new AppError(
        404,
        'NOT_FOUND',
        'Không tìm thấy tài nguyên.'
      )
    }

    const { table } = resource

    const join =
      kind === 'services'
        ? ' JOIN service_categories c ON c.id = r.category_id'
        : kind === 'models'
          ? ' JOIN ac_brands b ON b.id = r.brand_id'
          : kind === 'skills'
            ? ` JOIN services s ON s.id = r.service_id
                JOIN service_categories c ON c.id = s.category_id`
            : ''
    const columns = kind === 'services'
      ? 'r.*, c.name AS category_name'
      : kind === 'models'
        ? 'r.*, b.name AS brand_name'
        : kind === 'skills'
          ? "r.*, 'SK-' || upper(left(r.id::text, 8)) AS code, s.name AS service_name, s.is_active AS service_is_active"
          : 'r.*'
    const active = mobile
      ? ` AND r.is_active = true${
          kind === 'services'
            ? ' AND c.is_active = true AND c.deleted_at IS NULL'
            : kind === 'models'
              ? ' AND b.is_active = true AND b.deleted_at IS NULL'
              : kind === 'skills'
                ? ` AND s.is_active = true
                    AND s.deleted_at IS NULL
                    AND c.is_active = true
                    AND c.deleted_at IS NULL`
                : ''
        }`
      : ''

    return this.transaction(async (client) => {
      const result = await client.query(
        `SELECT ${columns} FROM ${table} r${join} WHERE r.id=$1 AND r.deleted_at IS NULL${active} LIMIT 1`,
        [id]
      )

      if (!result.rows[0]) {
        throw new AppError(
          404,
          'NOT_FOUND',
          'Không tìm thấy dữ liệu.'
        )
      }

      return result.rows[0]
    })
  }

  async mutate(kind, id, data, action, actorId) {
    const { table } = resources[kind]
    const { expected_updated_at: expectedUpdatedAt, ...changes } = data
    data = changes

    try {
      let before

      const result = await this.transaction(async (client) => {
        let existing

        if (id) {
          existing = (
            await client.query(
              `SELECT *
               FROM ${table}
               WHERE id = $1
               FOR UPDATE`,
              [id]
            )
          ).rows[0]

          if (!existing) {
            throw new AppError(
              404,
              'NOT_FOUND',
              'Không tìm thấy dữ liệu.'
            )
          }

          before = existing
          if (expectedUpdatedAt && new Date(existing.updated_at).getTime() !== new Date(expectedUpdatedAt).getTime()) {
            throw new AppError(409, 'STALE_CATALOG', 'This item has changed. Refresh the page before saving.')
          }

          if (
            action === 'TRASH' ||
            action === 'RESTORE' ||
            action === 'DELETE'
          ) {
            const restoring = action === 'RESTORE'

            if (
              (restoring && !existing.deleted_at) ||
              (!restoring && existing.deleted_at)
            ) {
              return existing
            }

            if (!restoring && (kind === 'categories' || kind === 'brands')) {
              const childTable = kind === 'categories' ? 'services' : 'ac_models'
              const foreignKey = kind === 'categories' ? 'category_id' : 'brand_id'
              const linked = await client.query(
                `SELECT id FROM ${childTable} WHERE ${foreignKey} = $1 AND deleted_at IS NULL LIMIT 1`,
                [id]
              )
              if (linked.rows.length) {
                throw new AppError(
                  409,
                  kind === 'categories' ? 'CATEGORY_IN_USE' : 'BRAND_IN_USE',
                  kind === 'categories'
                    ? 'Move the services in this category to another category or to Trash first.'
                    : 'Move the models in this brand to another brand or to Trash first.'
                )
              }
            }

            if (restoring) {
              await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`catalog:${kind}:names`])
              const nameField = kind === 'models' ? 'model_name' : 'name'
              const duplicate = await client.query(
                `SELECT id FROM ${table}
                 WHERE deleted_at IS NULL AND lower(trim(${nameField})) = lower(trim($1)) AND id <> $2
                   ${kind === 'models' ? 'AND brand_id = $3' : ''}
                 LIMIT 1`,
                kind === 'models' ? [existing.model_name, id, existing.brand_id] : [existing.name, id]
              )
              if (duplicate.rowCount) {
                throw new AppError(409, 'DUPLICATE_NAME', 'This name is already in use. Rename the existing item before restoring.', {
                  [nameField]: 'This name is already in use.',
                })
              }
              const parent =
                kind === 'services'
                  ? ['service_categories', existing.category_id]
                  : kind === 'models'
                    ? ['ac_brands', existing.brand_id]
                    : kind === 'skills'
                      ? ['services', existing.service_id]
                      : null

              if (parent) {
                const parentResult = await client.query(
                  `SELECT id
                   FROM ${parent[0]}
                   WHERE id = $1
                     AND deleted_at IS NULL
                   FOR SHARE`,
                  [parent[1]]
                )

                if (!parentResult.rowCount) {
                  throw new AppError(
                    409,
                    'PARENT_IN_TRASH',
                    'Restore the related category, brand or service first.'
                  )
                }
              }
            }

            return (
              await client.query(
                `UPDATE ${table}
                 SET deleted_at = ${
                   restoring ? 'NULL' : 'CURRENT_TIMESTAMP'
                 },
                 updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1
                 RETURNING *`,
                [id]
              )
            ).rows[0]
          }

          if (existing.deleted_at) {
            throw new AppError(
              409,
              'RESOURCE_IN_TRASH',
              'Restore this item before editing it.'
            )
          }
        }

        const parentField = { services: 'category_id', models: 'brand_id', skills: 'service_id' }[kind]
        const parentId = data[parentField] ?? existing?.[parentField]
        const parentChanged = data[parentField] && data[parentField] !== existing?.[parentField]
        const activating = data.is_active === true && existing?.is_active === false
        if (parentId && (parentChanged || activating)) {
          const parentQueries = {
            services: 'SELECT id FROM service_categories WHERE id=$1 AND deleted_at IS NULL AND is_active FOR SHARE',
            models: 'SELECT id FROM ac_brands WHERE id=$1 AND deleted_at IS NULL AND is_active FOR SHARE',
            skills: `SELECT s.id FROM services s JOIN service_categories c ON c.id=s.category_id
                     WHERE s.id=$1 AND s.deleted_at IS NULL AND s.is_active
                       AND c.deleted_at IS NULL AND c.is_active FOR SHARE OF s,c`,
          }
          const parent = await client.query(parentQueries[kind], [parentId])
          if (!parent.rowCount) {
            const label = { services: 'category', models: 'brand', skills: 'service in an active category' }[kind]
            const message = `Choose an active ${label}.`
            throw new AppError(422, 'VALIDATION_ERROR', message, { [parentField]: message })
          }
        }

        if (kind === 'models') {
          if (data.model_name || data.brand_id) {
            await client.query(
              'SELECT pg_advisory_xact_lock(hashtext($1))',
              ['catalog:models:names']
            )

            const duplicate = await client.query(
              `SELECT id
               FROM ac_models
               WHERE brand_id = $1
                 AND deleted_at IS NULL
                 AND lower(trim(model_name)) = lower($2)
                 AND ($3::uuid IS NULL OR id <> $3)
               LIMIT 1`,
              [
                data.brand_id ?? existing?.brand_id,
                data.model_name ?? existing?.model_name,
                id,
              ]
            )

            if (duplicate.rowCount) {
              throw new AppError(
                409,
                'DUPLICATE_NAME',
                'Tên model đã tồn tại trong hãng này.',
                {
                  model_name: 'Vui lòng sử dụng tên khác.',
                }
              )
            }
          }
        }

        if (data.name) {
          await client.query(
            'SELECT pg_advisory_xact_lock(hashtext($1))',
            [`catalog:${kind}:names`]
          )

          const duplicate = await client.query(
            `SELECT id
             FROM ${table}
             WHERE deleted_at IS NULL
               AND lower(trim(name)) = lower($1)
               AND ($2::uuid IS NULL OR id <> $2)
             LIMIT 1`,
            [data.name, id]
          )

          if (duplicate.rowCount) {
            throw new AppError(
              409,
              'DUPLICATE_NAME',
              'Tên đã tồn tại.',
              {
                name: 'Vui lòng sử dụng tên khác.',
              }
            )
          }
        }

        let after = null

        const fields = Object.keys(data)
        const values = Object.values(data)

        if (!id) {
          after = (
            await client.query(
              `INSERT INTO ${table}
               (${fields.join(',')})
               VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')})
               RETURNING *`,
              values
            )
          ).rows[0]
        } else {
          const changes = fields.map(
            (field, i) => `${field} = $${i + 1}`
          )

          after = (
            await client.query(
              `UPDATE ${table}
               SET ${changes.join(',')},
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $${values.length + 1}
               RETURNING *`,
              [...values, id]
            )
          ).rows[0]
        }

        return after
      })

      this.audit({
        actorId,
        action,
        entityType: {
          skills: 'SKILL',
          categories: 'SERVICE_CATEGORY',
          brands: 'AC_BRAND',
          models: 'AC_MODEL',
          services: 'SERVICE',
        }[kind],
        entityId: result.id,
        before,
        after: result,
      })

      return result
    } catch (error) {
      if (error.code === '23505') {
        throw new AppError(
          409,
          'DUPLICATE_NAME',
          'Tên đã tồn tại.',
          {
            name: 'Vui lòng sử dụng tên khác.',
          }
        )
      }

      throw error
    }
  }
}
