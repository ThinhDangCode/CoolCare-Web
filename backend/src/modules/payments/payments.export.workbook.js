import ExcelJS from 'exceljs'
import { REPORT_TIMEZONE, REVENUE_METRICS } from './payments.export.constants.js'

const moneyFormat = '#,##0.00;[Red](#,##0.00);0.00'
const dateFormat = 'dd/mm/yyyy hh:mm:ss'
const orange = 'FFFF6B00'
const navy = 'FF17243A'

// Excel has 15-digit numeric precision. SQL sums never pass through Number arithmetic.
export function excelMoney(value) {
  if (value === null || value === undefined) return null
  const text = String(value)
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Invalid monetary snapshot')
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.')
  const units = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (units.toString().length > 15) return text
  return Number(text)
}

export function vietnamExcelDate(value) {
  if (value === null || value === undefined) return null
  const actual = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(actual.getTime())) throw new Error('Invalid report timestamp')
  const wallClock = new Date(actual.getTime() + 7 * 60 * 60 * 1000)
  // Preserve out-of-Excel-range legacy dates as labelled text instead of negative serials.
  if (wallClock < new Date('1900-03-01T00:00:00Z') || wallClock.getUTCFullYear() > 9999) {
    return `${wallClock.toISOString().replace('T', ' ').replace('Z', '')} UTC+7`
  }
  return wallClock
}

function excelCalendarDate(value) {
  const date = new Date(`${value}T00:00:00Z`)
  // Excel's fictional 1900 leap day makes early dates unreliable across readers.
  return date < new Date('1900-03-01T00:00:00Z') ? value : date
}

function literal(value) { return value === null || value === undefined ? null : String(value) }
function titleRow(row, fill = navy) {
  row.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
  row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
}

export async function buildRevenueWorkbook(report, filters) {
  const book = new ExcelJS.Workbook()
  book.creator = 'CoolCare'
  book.created = report.generatedAt
  const summary = book.addWorksheet('Revenue Summary', { views: [{ state: 'frozen', ySplit: 14, showGridLines: false }] })
  summary.columns = [{ width: 39 }, { width: 25 }, { width: 15 }, { width: 15 }, { width: 28 }, { width: 24 }]
  for (const column of summary.columns) column.font = { name: 'Arial', size: 11 }
  summary.mergeCells('A1:F1')
  summary.getCell('A1').value = 'COOLCARE REVENUE REPORT'
  summary.getCell('A1').font = { name: 'Arial', size: 18, bold: true, color: { argb: orange } }
  summary.getRow(1).height = 32
  summary.mergeCells('A2:F2')
  summary.getCell('A2').value = 'Gross successful booking payment receipts — not platform net revenue.'
  const metadata = [
    ['Report period from', excelCalendarDate(filters.from)],
    ['Report period to', excelCalendarDate(filters.to)],
    ['Timezone', REPORT_TIMEZONE],
    ['Generated at (UTC+7)', vietnamExcelDate(report.generatedAt)],
    ['Method filter', filters.method],
    ['Search filter', filters.search || 'All'],
    ['Status', 'Successful, paid date recorded'],
    ['Paid payment count', report.rowCount],
    ['Source', 'Paid date and saved payment amounts'],
  ]
  metadata.forEach(([label, value], index) => {
    const row = summary.getRow(index + 4)
    summary.mergeCells(`B${index + 4}:F${index + 4}`)
    row.getCell(1).value = label
    row.getCell(2).value = value
    row.getCell(1).font = { bold: true, name: 'Arial', size: 11 }
    if (value instanceof Date) row.getCell(2).numFmt = index === 0 || index === 1 ? 'dd/mm/yyyy' : dateFormat
  })
  summary.getRow(14).values = ['Metric', 'Total (VND)', 'Known rows', 'Missing rows', 'Known-value sum (VND)', 'Completeness']
  titleRow(summary.getRow(14))
  summary.getRow(14).height = 34
  REVENUE_METRICS.forEach(({ key, label }, index) => {
    const metric = report.metrics[key]
    const row = summary.getRow(index + 15)
    row.values = [label, excelMoney(metric.total), metric.knownCount, metric.missingCount, excelMoney(metric.knownSum), metric.missingCount ? 'INCOMPLETE' : 'Complete']
    row.height = 24
    for (const column of [2, 5]) {
      row.getCell(column).numFmt = typeof row.getCell(column).value === 'string' ? '@' : moneyFormat
      row.getCell(column).alignment = { horizontal: 'right', vertical: 'middle' }
    }
    if (metric.missingCount) row.getCell(6).font = { bold: true, color: { argb: 'FFC2410C' } }
  })
  const notes = [
    'The period uses paid dates in Vietnam calendar days, including both selected dates. Creation dates do not determine this report period.',
    'Blank financial snapshots are unknown, never zero. Incomplete totals are blank; known-value sums are explicitly partial.',
    'Very large monetary totals are stored as text to preserve every digit.',
    'Dates use UTC+7 wall-clock values. Early-1900 and out-of-range dates remain text to preserve their calendar dates. No net platform revenue is inferred.',
  ]
  notes.forEach((note, index) => {
    const row = index + 20
    summary.mergeCells(`A${row}:F${row}`)
    summary.getCell(`A${row}`).value = note
    summary.getCell(`A${row}`).alignment = { wrapText: true, vertical: 'middle' }
    summary.getRow(row).height = 30
  })
  summary.getCell('B9').alignment = { wrapText: true, vertical: 'top' }
  summary.getRow(9).height = filters.search.length > 75 ? 44 : 24
  summary.getCell('B12').alignment = { wrapText: true }
  summary.getRow(12).height = 24

  const paid = book.addWorksheet('Paid Payments', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] })
  const headers = ['Payment UUID', 'Payment code', 'Booking code', 'Customer', 'Customer phone', 'Payment technician', 'Method code', 'Method name', 'Status', 'Gross paid amount (VND)', 'Commission snapshot (VND)', 'Platform discount snapshot (VND)', 'Technician entitlement snapshot (VND)', 'Created at (UTC+7)', 'Paid at (UTC+7)', 'Settled at (UTC+7)', 'Payment kind']
  const widths = [38, 22, 22, 28, 20, 28, 18, 22, 16, 25, 25, 28, 32, 25, 25, 25, 18]
  paid.columns = headers.map((header, index) => ({ header, width: widths[index] }))
  for (const column of paid.columns) column.font = { name: 'Arial', size: 11 }
  titleRow(paid.getRow(1))
  paid.getRow(1).height = 44
  paid.autoFilter = 'A1:Q1'
  for (const payment of report.rows) {
    const row = paid.addRow([
      literal(payment.id), literal(payment.paymentCode), literal(payment.bookingCode),
      literal(payment.customerName), literal(payment.customerPhone), literal(payment.technicianName),
      literal(payment.methodCode), literal(payment.methodName), literal(payment.status),
      excelMoney(payment.amount), excelMoney(payment.commissionAmount),
      excelMoney(payment.platformDiscountAmount), excelMoney(payment.technicianEarning),
      vietnamExcelDate(payment.createdAt), vietnamExcelDate(payment.paidAt), vietnamExcelDate(payment.settledAt), literal(payment.kind),
    ])
    row.height = 24
    row.alignment = { horizontal: 'left', vertical: 'middle' }
    for (let column = 1; column <= 9; column += 1) row.getCell(column).numFmt = '@'
    for (let column = 10; column <= 13; column += 1) {
      row.getCell(column).numFmt = typeof row.getCell(column).value === 'string' ? '@' : moneyFormat
      row.getCell(column).alignment = { horizontal: 'right', vertical: 'middle' }
    }
    for (let column = 14; column <= 16; column += 1) row.getCell(column).numFmt = dateFormat
    row.getCell(17).numFmt = '@'
  }
  return Buffer.from(await book.xlsx.writeBuffer())
}
