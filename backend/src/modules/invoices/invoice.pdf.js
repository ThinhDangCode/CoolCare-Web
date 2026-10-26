import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { A4, PdfDocument } from './pdf/pdf-document.js'
import { formatDate, formatDateTime, formatQuantity, formatVnd } from './invoice.format.js'

// The layout is transcribed from the Figma frame (1588 px wide). Every number below
// is in design pixels and converted to points by K.
const K = A4.width / 1588
const P = (value) => value * K

const COLOR = Object.freeze({
  orange: '#FF6B00',
  orangeSoft: '#FFF1E5',
  orangeLine: '#FFD2B2',
  ink: '#0F172A',
  line: '#DCE1E7',
  tableHead: '#F3F4F6',
  muted: '#64748B',
  white: '#FFFFFF',
})

const MARGIN = 56
const CONTENT_WIDTH = 1588 - MARGIN * 2
const PAGE_HEIGHT = A4.height / K
const BOTTOM = PAGE_HEIGHT - 64
const LEFT_WIDTH = 527
const RIGHT_X = 616
const RIGHT_WIDTH = 1532 - RIGHT_X
const COLUMN_FRACTIONS = [334 / 916, 121 / 916, 212 / 916, 249 / 916]

let cachedFonts
function loadFonts() {
  cachedFonts ??= {
    regular: readFileSync(fileURLToPath(new URL('../../../assets/fonts/LiberationSans-Regular.ttf', import.meta.url))),
    bold: readFileSync(fileURLToPath(new URL('../../../assets/fonts/LiberationSans-Bold.ttf', import.meta.url))),
  }
  return cachedFonts
}

class InvoiceCanvas {
  constructor(doc) { this.doc = doc }

  rect(x, y, w, h, options) { this.doc.rect(P(x), P(y), P(w), P(h), { ...options, lineWidth: P(options.lineWidth ?? 2), radius: P(options.radius ?? 0) }) }
  line(x1, y1, x2, y2, options = {}) { this.doc.line(P(x1), P(y1), P(x2), P(y2), { ...options, lineWidth: P(options.lineWidth ?? 2) }) }
  measure(text, size, bold = false, spacing = 0) { return this.doc.measure(text, { font: bold ? 'bold' : 'regular', size: P(size), spacing: P(spacing) }) / K }

  text(text, x, baseline, { size = 30, bold = false, color = COLOR.ink, align = 'left', width = 0, spacing = 0 } = {}) {
    this.doc.text(text, P(x), P(baseline), { font: bold ? 'bold' : 'regular', size: P(size), color, align, width: P(width), spacing: P(spacing) })
  }

  // The font's ₫ glyph is tiny; the design uses an underlined "đ" at full size.
  money(value, rightX, baseline, { size = 30, bold = false, color = COLOR.ink } = {}) {
    const label = formatVnd(value).replace('₫', 'đ')
    const start = rightX - this.measure(label, size, bold)
    this.text(label, start, baseline, { size, bold, color })
    const dongWidth = this.measure('đ', size, bold)
    const y = baseline + size * 0.11
    this.line(rightX - dongWidth + size * 0.03, y, rightX - size * 0.03, y, { stroke: color, lineWidth: Math.max(size * 0.055, 1.6) })
  }

  wrap(text, width, size, bold = false) {
    return this.doc.wrap(text, P(width), { font: bold ? 'bold' : 'regular', size: P(size) })
  }

  // Shrinks text to fit; as a last resort truncates with an ellipsis.
  fit(text, width, size, bold = false, minSize = 22) {
    let current = size
    while (current > minSize && this.measure(text, current, bold) > width) current -= 1
    if (this.measure(text, current, bold) <= width) return { text, size: current }
    let cut = text.length
    while (cut > 1 && this.measure(`${text.slice(0, cut)}…`, current, bold) > width) cut -= 1
    return { text: `${text.slice(0, cut)}…`, size: current }
  }
}

function drawLogo(c) {
  c.rect(56, 86, 158, 158, { fill: COLOR.orange, radius: 32 })
  const cx = 135
  const cy = 165
  const arm = 54
  const stroke = { stroke: COLOR.white, lineWidth: 9, round: true }
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 2
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    c.line(cx, cy, cx + dx * arm, cy + dy * arm, stroke)
    const bx = cx + dx * arm * 0.62
    const by = cy + dy * arm * 0.62
    for (const side of [-1, 1]) {
      const branch = angle + side * (Math.PI / 4)
      c.line(bx, by, bx + Math.cos(branch) * arm * 0.34, by + Math.sin(branch) * arm * 0.34, stroke)
    }
  }
  c.text('CoolCare', 232, 190, { size: (120 * 463) / c.measure('CoolCare', 120, true), bold: true })
  const tagline = 'DỊCH VỤ ĐIỆN LẠNH'
  const taglineSize = 37
  const natural = c.measure(tagline, taglineSize, true)
  c.text(tagline, 240, 244, { size: taglineSize, bold: true, spacing: Math.max((394 - natural) / (tagline.length - 1), 0) })
}

function drawHeader(c, invoice) {
  drawLogo(c)
  c.text('HÓA ĐƠN DỊCH VỤ', 1532 - 700, 137, { size: 60, bold: true, align: 'right', width: 700 })
  c.text(`Số hóa đơn: ${invoice.invoiceNumber}`, 1532 - 700, 197, { size: 31, align: 'right', width: 700 })
  c.text(`Ngày lập: ${formatDate(invoice.issuedAt)}`, 1532 - 700, 243, { size: 31, align: 'right', width: 700 })

  c.rect(MARGIN, 358, CONTENT_WIDTH, 99, { fill: COLOR.orangeSoft, stroke: COLOR.orangeLine, lineWidth: 2, radius: 8 })
  for (const x of [541, 1025]) c.line(x, 382, x, 433, { stroke: COLOR.orange, lineWidth: 2.5 })
  const cells = [
    [`Mã booking: ${invoice.booking.code}`, 88, 437],
    [`Ngày dịch vụ: ${formatDate(invoice.booking.serviceDate)}`, 618, 392],
    [`Kỹ thuật viên: ${invoice.booking.technicianName ?? '—'}`, 1081, 432],
  ].map(([value, x, width]) => ({ x, ...c.fit(value, width, 31, true) }))
  const size = Math.min(...cells.map((cell) => cell.size))
  for (const cell of cells) c.text(cell.text, cell.x, 419, { size, bold: true })
}

function card(c, { title, y, lines, minHeight }) {
  const headerHeight = 87
  const textWidth = LEFT_WIDTH - 64
  const laid = []
  let cursor = y + headerHeight + 30
  for (const line of lines) {
    const size = line.size ?? 30
    const lineHeight = line.lineHeight ?? (line.bold ? 60 : 44)
    const wrapped = c.wrap(line.text, textWidth, size, line.bold)
    const visible = wrapped.slice(0, line.maxLines ?? 6)
    if (wrapped.length > visible.length) visible[visible.length - 1] = `${visible[visible.length - 1].replace(/\s+\S*$/, '')}…`
    cursor += line.gapBefore ?? 0
    for (const text of visible) {
      laid.push({ text, size, bold: line.bold, color: line.color, baseline: cursor + lineHeight * 0.5 + size * 0.36 })
      cursor += lineHeight
    }
  }
  const height = Math.max(cursor + 22 - y, minHeight)
  c.rect(MARGIN, y, LEFT_WIDTH, height, { fill: COLOR.white, radius: 8 })
  c.rect(MARGIN, y, LEFT_WIDTH, headerHeight, { fill: COLOR.orangeSoft, radius: 8 })
  c.rect(MARGIN, y + 40, LEFT_WIDTH, headerHeight - 40, { fill: COLOR.orangeSoft })
  c.rect(MARGIN, y, LEFT_WIDTH, height, { stroke: COLOR.line, lineWidth: 2, radius: 8 })
  const heading = c.fit(title, LEFT_WIDTH - 56, 38, true, 28)
  c.text(heading.text, MARGIN + 32, y + 58, { size: heading.size, bold: true, color: COLOR.orange })
  for (const item of laid) {
    c.text(item.text, MARGIN + 32, item.baseline, { size: item.size, bold: item.bold, color: item.color ?? COLOR.ink })
  }
  return y + height
}

function drawLeftColumn(c, invoice) {
  const provider = invoice.provider
  let y = 494
  y = card(c, {
    title: 'ĐƠN VỊ CUNG CẤP',
    y,
    minHeight: 363,
    lines: [
      { text: provider.name, bold: true, size: 44 },
      { text: `Địa chỉ: ${provider.address ?? '[Địa chỉ doanh nghiệp]'}`, lineHeight: 54, size: 30, maxLines: 3 },
      { text: `Hotline: ${provider.hotline ?? '[Số hỗ trợ]'}`, lineHeight: 54 },
      ...(provider.taxCode ? [{ text: `MST: ${provider.taxCode}`, lineHeight: 54 }] : []),
      ...(provider.address && provider.hotline ? [] : [{ text: 'Thông tin chờ cấu hình', lineHeight: 54 }]),
    ],
  }) + 37
  y = card(c, {
    title: 'KHÁCH HÀNG',
    y,
    minHeight: 379,
    lines: [
      { text: invoice.customer.name, bold: true, size: 44 },
      { text: `Điện thoại: ${invoice.customer.phoneMasked}`, lineHeight: 54 },
      { text: 'Địa chỉ thực hiện:', lineHeight: 50 },
      { text: invoice.customer.address || '—', lineHeight: 42, maxLines: 4 },
    ],
  }) + 37
  y = card(c, {
    title: 'THÔNG TIN THANH TOÁN',
    y,
    minHeight: 311,
    lines: [
      { text: `Trạng thái: ${invoice.payment.statusLabel}`, lineHeight: 54 },
      { text: `Phương thức: ${invoice.payment.methodLabel}`, lineHeight: 54 },
      { text: `Thời gian: ${formatDateTime(invoice.payment.paidAt)}`, lineHeight: 54 },
    ],
  }) + 37
  card(c, {
    title: 'GHI CHÚ',
    y,
    minHeight: 191,
    lines: [{ text: invoice.notes || 'Không có ghi chú.', lineHeight: 42, size: 28, maxLines: 6 }],
  })
}

class Flow {
  constructor(doc, c, invoice) {
    this.doc = doc
    this.c = c
    this.invoice = invoice
    this.x = RIGHT_X
    this.width = RIGHT_WIDTH
    this.y = 494
  }

  newPage() {
    this.doc.addPage()
    this.x = MARGIN
    this.width = CONTENT_WIDTH
    this.c.text(`Hóa đơn ${this.invoice.invoiceNumber} (tiếp theo)`, MARGIN, 96, { size: 38, bold: true })
    this.c.line(MARGIN, 124, MARGIN + CONTENT_WIDTH, 124, { stroke: COLOR.orangeLine, lineWidth: 2 })
    this.y = 164
  }

  ensure(height) {
    if (this.y + height > BOTTOM) { this.newPage(); return true }
    return false
  }

  sectionBar(title) {
    this.c.rect(this.x, this.y, this.width, 87, { fill: COLOR.orangeSoft, stroke: COLOR.orangeLine, lineWidth: 2, radius: 8 })
    this.c.text(title, this.x + 32, this.y + 58, { size: 38, bold: true, color: COLOR.orange })
    this.y += 87 + 22
  }

  columns() {
    const widths = COLUMN_FRACTIONS.map((fraction) => fraction * this.width)
    const starts = widths.reduce((acc, w, i) => [...acc, i === 0 ? this.x : acc[i - 1] + widths[i - 1]], [])
    return { widths, starts }
  }

  tableHeader(top) {
    const { widths, starts } = this.columns()
    this.c.rect(this.x, top, this.width, 86, { fill: COLOR.tableHead })
    this.c.text('Nội dung', starts[0] + 28, top + 55, { size: 30, bold: true })
    ;['SL', 'Đơn giá', 'Thành tiền'].forEach((label, i) => {
      this.c.text(label, starts[i + 1], top + 55, { size: 30, bold: true, align: 'center', width: widths[i + 1] })
    })
    return top + 86
  }

  serviceTable(items) {
    const c = this.c
    let { widths, starts } = this.columns()
    const linesFor = (item) => c.wrap(item.description, widths[0] - 56, 30)
    const heightFor = (lines) => Math.max(lines.length * 34 + 64, 98)
    let segmentTop = this.y
    let cursor = this.tableHeader(segmentTop)
    if (items.length === 0) {
      c.text('Chưa có hạng mục dịch vụ.', this.x + 28, cursor + 60, { size: 30, color: COLOR.muted })
      cursor += 90
    }
    const closeSegment = (bottom) => {
      const { starts: s } = this.columns()
      for (let i = 1; i < s.length; i += 1) c.line(s[i], segmentTop + 86, s[i], bottom, { stroke: COLOR.line, lineWidth: 2 })
      c.rect(this.x, segmentTop, this.width, bottom - segmentTop, { stroke: COLOR.line, lineWidth: 2, radius: 8 })
    }
    for (const item of items) {
      let lines = linesFor(item)
      let height = heightFor(lines)
      if (cursor + height > BOTTOM) {
        closeSegment(cursor)
        this.newPage()
        ;({ widths, starts } = this.columns())
        segmentTop = this.y
        cursor = this.tableHeader(segmentTop)
        lines = linesFor(item)
        height = heightFor(lines)
      }
      c.line(this.x, cursor, this.x + this.width, cursor, { stroke: COLOR.line, lineWidth: 2 })
      const lineHeight = 34
      const textTop = cursor + (height - lines.length * lineHeight) / 2
      lines.forEach((text, i) => c.text(text, starts[0] + 28, textTop + i * lineHeight + 25, { size: 30 }))
      const middle = cursor + height / 2 + 11
      c.text(formatQuantity(item.quantity), starts[1], middle, { size: 30, align: 'center', width: widths[1] })
      c.money(item.unitPrice, starts[2] + widths[2] - 28, middle, { size: 30 })
      c.money(item.totalPrice, starts[3] + widths[3] - 28, middle, { size: 30 })
      cursor += height
    }
    closeSegment(cursor)
    this.y = cursor + 49
  }

  materials(amount) {
    this.ensure(87 + 22 + 94)
    this.sectionBar('VẬT TƯ')
    this.c.rect(this.x, this.y, this.width, 94, { stroke: COLOR.line, lineWidth: 2, radius: 8 })
    this.c.text('Tổng tiền vật tư', this.x + 33, this.y + 60, { size: 31, bold: true })
    this.c.money(amount, this.x + this.width - 34, this.y + 60, { size: 31, bold: true })
    this.y += 94 + 49
  }

  totals(invoice) {
    const rows = [
      ['Tạm tính', invoice.subtotal, 89],
      ['Giảm giá', invoice.discountAmount > 0 ? -invoice.discountAmount : 0, 89],
      ['TỔNG THANH TOÁN', invoice.totalAmount, 128],
      ['Đã thanh toán', invoice.paidAmount, 90],
      ['Còn phải trả', invoice.remainingAmount, 90],
    ]
    const height = rows.reduce((sum, row) => sum + row[2], 0)
    this.ensure(height)
    const c = this.c
    const top = this.y
    const splitX = this.x + this.width * ((1195 - 616) / 916)
    c.rect(this.x, top, this.width, height, { fill: COLOR.white, radius: 8 })
    let cursor = top
    rows.forEach(([label, value, rowHeight], index) => {
      const highlight = index === 2
      if (highlight) c.rect(this.x, cursor, this.width, rowHeight, { fill: COLOR.orangeSoft })
      if (index > 0) c.line(this.x, cursor, this.x + this.width, cursor, { stroke: highlight || index === 3 ? COLOR.orangeLine : COLOR.line, lineWidth: 2 })
      if (!highlight) c.line(splitX, cursor, splitX, cursor + rowHeight, { stroke: COLOR.line, lineWidth: 2 })
      const baseline = cursor + rowHeight / 2 + (highlight ? 19 : 12)
      c.text(label, this.x + 41, baseline, { size: highlight ? 52 : 34, bold: true, color: highlight ? COLOR.orange : COLOR.ink })
      c.money(value, this.x + this.width - 34, baseline, { size: highlight ? 58 : 34, bold: true, color: highlight ? COLOR.orange : COLOR.ink })
      cursor += rowHeight
    })
    c.rect(this.x, top, this.width, height, { stroke: COLOR.line, lineWidth: 2, radius: 8 })
    this.y = cursor
  }
}

export function renderInvoicePdf(invoice) {
  const doc = new PdfDocument({
    fonts: loadFonts(),
    title: `Hóa đơn dịch vụ ${invoice.invoiceNumber}`,
    author: invoice.provider.name,
    subject: `Booking ${invoice.booking.code}`,
    creationDate: new Date(invoice.issuedAt ?? Date.now()),
  })
  doc.addPage()
  const canvas = new InvoiceCanvas(doc)
  drawHeader(canvas, invoice)
  drawLeftColumn(canvas, invoice)

  const flow = new Flow(doc, canvas, invoice)
  flow.sectionBar('DỊCH VỤ VÀ TIỀN CÔNG')
  flow.serviceTable(invoice.items)
  flow.materials(invoice.partsAmount)
  flow.totals(invoice)

  if (doc.pages.length > 1) {
    doc.pages.forEach((_, index) => {
      doc.goToPage(index)
      canvas.text(`Trang ${index + 1}/${doc.pages.length}`, 0, PAGE_HEIGHT - 28, { size: 24, color: COLOR.muted, align: 'center', width: 1588 })
    })
  }
  return doc.save()
}
