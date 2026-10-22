import { apiCode, databaseCodebooks, storageCode } from './database-codebooks.js'

// Keep the public API's enum strings while PostgreSQL stores the revised
// smallint codes. Only columns listed in databaseCodebooks are translated.
const enumColumns = new Set(Object.values(databaseCodebooks).flatMap((columns) => Object.keys(columns)))
const resultAliases = {
  account_status: ['users', 'status'],
  booking_status: ['bookings', 'status'],
  bookingStatus: ['bookings', 'status'],
  itemType: ['quotation_items', 'item_type'],
  kind: ['payments', 'payment_kind'],
  ledgerType: ['settlement_transactions', 'transaction_type'],
  recorded_status: ['technician_penalties', 'status'],
  request_status: ['booking_technicians', 'status'],
  technician_qualification: ['technician_profiles', 'qualification_level'],
}
const sourceTables = {
  latest_assignments: 'booking_technicians',
  payment_source: 'payments',
  source_assignments: 'booking_technicians',
  source_history: 'booking_status_history',
  source_technicians: 'technician_profiles',
}
const aliasesFor = (sql) => {
  const aliases = new Map()
  const update = /\bUPDATE\s+(?:public\.)?([a-z_]+)/i.exec(sql)
  if (update) aliases.updateTarget = update[1].toLowerCase()
  for (const match of sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:public\.)?([a-z_]+)(?:\s+(?:AS\s+)?([a-z_]+))?/gi)) {
    const name = match[1].toLowerCase()
    const table = sourceTables[name] ??
      (name.startsWith('source_') ? name.slice('source_'.length) : name)
    if (!databaseCodebooks[table]) continue
    aliases.set(table, table)
    if (match[2] && !/^(?:set|where|on|using|values|returning|left|right|inner|outer|cross|join|order|group|limit)$/i.test(match[2])) {
      aliases.set(match[2].toLowerCase(), table)
    }
  }
  for (const match of sql.matchAll(/\bFROM\s*\(\s*SELECT\s+([a-z_]+)\.\*[\s\S]*?\bFROM\s+\1\s*\)\s+([a-z_]+)/gi)) {
    if (databaseCodebooks[match[1].toLowerCase()]) aliases.set(match[2].toLowerCase(), match[1].toLowerCase())
  }
  return aliases
}

function tableFor(aliases, qualifier, column, label) {
  if (qualifier) return aliases.get(qualifier.toLowerCase())
  const target = aliases.updateTarget
  if (databaseCodebooks[target]?.[column]?.includes(label)) return target
  const tables = [...new Set(aliases.values())].filter((table) => databaseCodebooks[table]?.[column])
  return tables.length === 1 && databaseCodebooks[tables[0]][column].includes(label)
    ? tables[0] : null
}

function replaceTokens(input, table, column, values) {
  return input.replace(/'([A-Z][A-Z_]+)'|\$(\d+)(?:::[a-z_]+(?:\[\])?)?/g, (token, label, index) => {
    if (label) {
      const code = storageCode(table, column, label)
      return typeof code === 'number' ? String(code) : token
    }
    const i = Number(index) - 1
    if (i >= 0 && i < values.length) {
      const value = values[i]
      values[i] = Array.isArray(value)
        ? value.map((item) => storageCode(table, column, item))
        : storageCode(table, column, value)
    }
    return token.includes('::') ? `$${index}` : token
  })
}

function splitTopLevel(text) {
  const parts = []
  let start = 0; let depth = 0; let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === "'") {
      if (quoted && text[i + 1] === "'") { i += 1; continue }
      quoted = !quoted
    } else if (!quoted && char === '(') depth += 1
    else if (!quoted && char === ')') depth -= 1
    else if (!quoted && depth === 0 && char === ',') {
      parts.push(text.slice(start, i)); start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

function matchingParen(sql, opening) {
  let depth = 0; let quoted = false
  for (let i = opening; i < sql.length; i += 1) {
    if (sql[i] === "'") {
      if (quoted && sql[i + 1] === "'") { i += 1; continue }
      quoted = !quoted
    } else if (!quoted && sql[i] === '(') depth += 1
    else if (!quoted && sql[i] === ')' && --depth === 0) return i
  }
  return -1
}

function topLevelKeyword(sql, start, keywords) {
  let depth = 0; let quoted = false
  for (let i = start; i < sql.length; i += 1) {
    if (sql[i] === "'") {
      if (quoted && sql[i + 1] === "'") { i += 1; continue }
      quoted = !quoted
    } else if (!quoted && sql[i] === '(') depth += 1
    else if (!quoted && sql[i] === ')') depth -= 1
    else if (!quoted && depth === 0) {
      for (const keyword of keywords) {
        if (sql.slice(i).toUpperCase().startsWith(keyword) &&
            !/[A-Za-z_]/.test(sql[i - 1] ?? ' ') &&
            !/[A-Za-z_]/.test(sql[i + keyword.length] ?? ' ')) return i
      }
    }
  }
  return -1
}

function rewriteInsertValues(sql, values) {
  const insert = /\bINSERT\s+INTO\s+(?:public\.)?([a-z_]+)\s*\(/gi
  let match; let offset = 0
  while ((match = insert.exec(sql))) {
    const table = match[1].toLowerCase()
    if (!databaseCodebooks[table]) continue
    const columnStart = sql.indexOf('(', match.index)
    const columnEnd = matchingParen(sql, columnStart)
    if (columnEnd < 0) continue
    const columns = splitTopLevel(sql.slice(columnStart + 1, columnEnd)).map((x) => x.trim().toLowerCase())
    const selectStart = topLevelKeyword(sql, columnEnd + 1, ['SELECT'])
    const valuesMatch = /\bVALUES\s*\(/gi
    valuesMatch.lastIndex = columnEnd + 1
    const found = valuesMatch.exec(sql)
    if (selectStart >= 0 && (!found || selectStart < found.index)) {
      const listStart = selectStart + 6
      const listEnd = topLevelKeyword(sql, listStart, ['FROM', 'WHERE', 'RETURNING', 'ON CONFLICT'])
      if (listEnd < 0) continue
      const original = sql.slice(listStart, listEnd)
      const expressions = splitTopLevel(original)
      if (expressions.length !== columns.length) continue
      const converted = expressions.map((expression, i) =>
        databaseCodebooks[table][columns[i]]
          ? replaceTokens(expression, table, columns[i], values) : expression).join(',')
      sql = sql.slice(0, listStart) + converted + sql.slice(listEnd)
      insert.lastIndex = listEnd + converted.length - original.length
      continue
    }
    if (!found || /\bSELECT\b/i.test(sql.slice(columnEnd + 1, found.index))) continue
    let cursor = sql.indexOf('(', found.index)
    while (cursor >= 0) {
      const end = matchingParen(sql, cursor)
      if (end < 0) break
      const original = sql.slice(cursor + 1, end)
      const expressions = splitTopLevel(original)
      if (expressions.length !== columns.length) break
      const converted = expressions.map((expression, i) =>
        databaseCodebooks[table][columns[i]]
          ? replaceTokens(expression, table, columns[i], values) : expression).join(',')
      sql = sql.slice(0, cursor + 1) + converted + sql.slice(end)
      offset += converted.length - original.length
      cursor += converted.length + 2
      const next = /^\s*,\s*\(/.exec(sql.slice(cursor))
      if (!next) break
      cursor += next[0].lastIndexOf('(')
    }
    insert.lastIndex = columnEnd + offset + 1
  }
  return sql
}

export function adaptDatabaseQuery(query, params = []) {
  if (typeof query !== 'string') return { query, params }
  const values = [...params]
  const aliases = aliasesFor(query)
  let sql = rewriteInsertValues(query, values)
  // Comparisons, SET clauses, IN lists and simple CASE operands all carry the
  // column name, making the conversion safe even when a label has several codes.
  sql = sql.replace(/\b(?:(\w+)\.)?(\w+)\s*(=|<>|!=|IN|NOT\s+IN|IS\s+DISTINCT\s+FROM)\s*(\([^()]*\)|'[^']*'|\$\d+(?:::[a-z_]+(?:\[\])?)?)/gi,
    (whole, qualifier, column, operator, operand) => {
      column = column.toLowerCase()
      if (!enumColumns.has(column)) return whole
      const label = /'([A-Z][A-Z_]+)'/.exec(operand)?.[1]
        ?? values[Number(/\$(\d+)/.exec(operand)?.[1]) - 1]
      const table = tableFor(aliases, qualifier, column, Array.isArray(label) ? label[0] : label)
      if (!table) return whole
      return whole.slice(0, whole.length - operand.length) + replaceTokens(operand, table, column, values)
    })
  sql = sql.replace(/\bCASE\s+(?:(\w+)\.)?(\w+)\s+((?:WHEN\s+'[A-Z_]+'\s+THEN\s+[^\s]+\s*)+)/gi,
    (whole, qualifier, column, arms) => {
      const label = /WHEN\s+'([A-Z_]+)'/.exec(arms)?.[1]
      const table = tableFor(aliases, qualifier, column.toLowerCase(), label)
      return table ? whole.replace(/\bWHEN\s+'([A-Z_]+)'/gi,
        (part, value) => `WHEN ${storageCode(table, column.toLowerCase(), value)}`) : whole
    })
  return { query: sql, params: values }
}

let columnOrigins
async function getColumnOrigins(rawQuery) {
  if (columnOrigins) return columnOrigins
  const result = await rawQuery(`SELECT c.oid::text AS oid,c.relname,a.attnum,a.attname
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0`,
    [Object.keys(databaseCodebooks)])
  columnOrigins = new Map(result.rows.map((r) => [`${r.oid}:${r.attnum}`, [r.relname, r.attname]]))
  return columnOrigins
}

function fallbackTable(sql, column, value) {
  if (column === 'account_status') return 'users'
  if (column === 'booking_status') return 'bookings'
  if (column === 'recorded_status') return 'technician_penalties'
  const tables = [...new Set(aliasesFor(sql).values())].filter((table) =>
    databaseCodebooks[table]?.[column]?.[value] !== undefined)
  if (tables.length === 1) return tables[0]
  if (tables.length > 1 && new Set(tables.map((table) => apiCode(table, column, value))).size === 1) return tables[0]
  return null
}

function nestedTable(row, parent) {
  if (parent === 'technicians' || parent === 'assignments') return 'booking_technicians'
  if (row.complaint_code || row.complaintCode) return 'complaints'
  if (row.payment_code || row.paymentCode || row.payment_kind) return 'payments'
  if (row.topup_code || row.topupCode) return 'technician_topups'
  if (row.payout_reference || row.payoutReference || row.bankName ||
      (row.technicianId && row.initiatedAt && row.amount !== undefined)) return 'withdrawals'
  if (row.quotation_number) return 'quotations'
  if (row.booking_code || row.bookingCode || row.scheduled_at) return 'bookings'
  if (row.email && (row.full_name || row.name)) return 'users'
  return null
}

function decodeNested(value, parent, table) {
  if (Array.isArray(value)) return value.map((item) => decodeNested(item, parent, table))
  if (!value || typeof value !== 'object' || value instanceof Date) return value
  const origin = nestedTable(value, parent) ?? table
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' && key === 'verificationStatus') {
      value[key] = apiCode('technician_profiles', 'verification_status', item)
    } else if (typeof item === 'number' && key === 'itemType') {
      value[key] = apiCode('quotation_items', 'item_type', item)
    } else if (typeof item === 'number' && origin && databaseCodebooks[origin]?.[key]) {
      value[key] = apiCode(origin, key, item)
    } else if (item && typeof item === 'object') value[key] = decodeNested(item, key, origin)
  }
  return value
}

export async function adaptDatabaseResult(result, sql, rawQuery) {
  if (!result?.fields?.length || !result.rows?.length) return result
  const relevant = result.fields.some((field) => field.tableID || enumColumns.has(field.name) ||
    result.rows.some((row) => row[field.name] && typeof row[field.name] === 'object'))
  if (!relevant) return result
  const origins = await getColumnOrigins(rawQuery)
  for (const row of result.rows) {
    const rowTable = nestedTable(row, '')
    for (const field of result.fields) {
      const value = row[field.name]
      if (typeof value === 'number') {
        const origin = origins.get(`${field.tableID}:${field.columnID}`)
        if (origin && databaseCodebooks[origin[0]]?.[origin[1]]) {
          row[field.name] = apiCode(origin[0], origin[1], value)
        } else if (resultAliases[field.name] &&
          databaseCodebooks[resultAliases[field.name][0]]?.[resultAliases[field.name][1]]?.[value] !== undefined) {
          row[field.name] = apiCode(...resultAliases[field.name], value)
        } else if (field.name === 'type' && rowTable === 'quotations') {
          row[field.name] = apiCode('quotations', 'quotation_type', value)
        } else if (field.name === 'status' && rowTable === 'payments') {
          row[field.name] = apiCode('payments', 'payment_status', value)
        } else if (field.name === 'status' && rowTable === 'technician_topups') {
          row[field.name] = apiCode('technician_topups', 'payment_status', value)
        } else if (enumColumns.has(field.name)) {
          const table = databaseCodebooks[rowTable]?.[field.name]
            ? rowTable : fallbackTable(sql, field.name, value)
          if (table) row[field.name] = apiCode(table, field.name, value)
        } else if (field.name.endsWith('_status')) {
          const table = fallbackTable(sql, field.name, value)
          if (table) row[field.name] = apiCode(table, 'status', value)
        }
      } else if (value && typeof value === 'object') {
        row[field.name] = decodeNested(value, field.name, fallbackTable(sql, field.name, 0))
      }
    }
  }
  return result
}
