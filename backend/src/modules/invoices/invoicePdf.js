import { PDFDocument } from 'pdfkit'
import { fileURLToPath } from 'node:url'
import { groupInvoiceItems } from './invoiceItems.js'

const asset = (name) => fileURLToPath(new URL(`./assets/${name}`, import.meta.url))
const fonts = {
  regular: asset('RobotoCondensed-Regular.ttf'),
  bold: asset('RobotoCondensed-Bold.ttf'),
}
const logoSource = asset('coolcare-logo.png')
const PAGE = { width: 794, height: 1123, bottom: 1018 }
const MARGIN = 28
const LEFT = { x: MARGIN, width: 264 }
const RIGHT = { x: 308, width: 458 }
const COLORS = {
  orange: '#FF6B00', tint: '#FFF1E5', ink: '#0F172A', muted: '#697586',
  border: '#DCE1E7', table: '#F3F4F6', white: '#FFFFFF',
}
const paymentMethods = {
  CASH: 'Tiền mặt', VNPAY: 'VNPay', ZALOPAY: 'ZaloPay', MOMO: 'MoMo',
  BANK_TRANSFER: 'Chuyển khoản', FREE: 'Miễn phí', WALLET: 'Ví',
}
const printable = (value, fallback = '—') => {
  const text = value === null || value === undefined ? '' : String(value)
  return text.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim() || fallback
}

// Money is a decimal snapshot from PostgreSQL, never a floating point sum.
export function formatInvoicePdfAmount(value) {
  const text = typeof value === 'string' ? value : ''
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return '—'
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.')
  const amount = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(BigInt(whole))
  const decimals = /[1-9]/.test(fraction) ? `,${fraction.padEnd(2, '0')}` : ''
  const negative = text.startsWith('-') && (BigInt(whole) !== 0n || /[1-9]/.test(fraction))
  return `${negative ? '-' : ''}${amount}${decimals} ₫`
}

export function formatInvoicePdfQuantity(value) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) return '—'
  const [whole, fraction = ''] = text.split('.')
  const decimals = fraction.replace(/0+$/, '')
  return `${new Intl.NumberFormat('vi-VN').format(BigInt(whole))}${decimals ? `,${decimals}` : ''}`
}

function dateText(value, withTime = false) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  const options = { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }
  if (withTime) Object.assign(options, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return new Intl.DateTimeFormat('en-GB', options).format(date)
}

export function safeInvoicePdfFilename(invoice) {
  const value = printable(invoice?.invoiceNumber, 'invoice').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  return `CoolCare-${value.slice(0, 90) || 'invoice'}.pdf`
}

export async function buildInvoicePdf(invoice, { supplier = {} } = {}) {
  if (!invoice || typeof invoice !== 'object') throw new TypeError('Invoice is required to create a PDF.')
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true,
    info: { Title: `Hóa đơn dịch vụ ${printable(invoice.invoiceNumber)}`, Author: 'CoolCare', Subject: 'Hóa đơn dịch vụ CoolCare' } })
  const chunks = []
  const result = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  try {
    doc.registerFont('regular', fonts.regular)
    doc.registerFont('bold', fonts.bold)
    const scale = 595.28 / PAGE.width
    let pageCount = 0
    const font = (size, weight = 'regular') => doc.font(weight).fontSize(size * scale)
    const rect = (x, y, width, height, fill = null, stroke = COLORS.border) => {
      doc.save().lineWidth(0.7 * scale).rect(x * scale, y * scale, width * scale, height * scale)
      if (fill && stroke) doc.fillAndStroke(fill, stroke)
      else if (fill) doc.fill(fill)
      else if (stroke) doc.stroke(stroke)
      doc.restore()
    }
    const line = (x1, y1, x2, y2, color = COLORS.border) => {
      doc.save().lineWidth(0.7 * scale).strokeColor(color)
        .moveTo(x1 * scale, y1 * scale).lineTo(x2 * scale, y2 * scale).stroke().restore()
    }
    const widthOf = (text, size, weight = 'regular') => { font(size, weight); return doc.widthOfString(text) / scale }
    // Explicit line wrapping lets both columns paginate independently without
    // PDFKit's implicit page breaks clipping a row or changing the other column.
    const wrap = (value, width, size, weight = 'regular') => {
      const lines = []
      for (const paragraph of printable(value).split('\n')) {
        if (!paragraph.trim()) { lines.push(''); continue }
        let current = ''
        for (const word of paragraph.trim().split(/\s+/)) {
          const candidate = current ? `${current} ${word}` : word
          if (widthOf(candidate, size, weight) <= width) { current = candidate; continue }
          if (current) { lines.push(current); current = '' }
          if (widthOf(word, size, weight) <= width) { current = word; continue }
          for (const char of Array.from(word)) {
            if (current && widthOf(`${current}${char}`, size, weight) > width) { lines.push(current); current = '' }
            current += char
          }
        }
        if (current) lines.push(current)
      }
      return lines.length ? lines : ['']
    }
    const textLines = (lines, x, y, width, size = 17, weight = 'regular', color = COLORS.ink, align = 'left', leading = 1.24) => {
      font(size, weight).fillColor(color)
      lines.forEach((text, index) => {
        // A line is already wrapped. Setting lineBreak=false prevents an
        // automatic page break at the native A4 page boundary.
        doc.text(text, x * scale, (y + index * size * leading) * scale,
          { width: width * scale, lineBreak: false, align })
      })
      return lines.length * size * leading
    }
    const text = (value, x, y, width, size = 17, weight = 'regular', color = COLORS.ink, align = 'left') =>
      textLines(wrap(value, width, size, weight), x, y, width, size, weight, color, align)
    const numericLayout = (value, width, size = 17, weight = 'regular') => {
      const originalWidth = widthOf(value, size, weight)
      if (originalWidth <= width) return { lines: [value], size }
      const fittedSize = Math.max(12, Math.min(size, size * width / Math.max(1, originalWidth) * 0.99))
      if (widthOf(value, fittedSize, weight) <= width) return { lines: [value], size: fittedSize }
      // Extremely large values still preserve complete digit groups and the
      // decimal fraction. Do not split an arbitrary digit to force a line fit.
      const groups = value.split(/(?<=[.,])/u)
      const lines = []
      let current = ''
      for (const group of groups) {
        if (current && widthOf(`${current}${group}`, fittedSize, weight) > width) {
          lines.push(current)
          current = ''
        }
        current += group
      }
      if (current) lines.push(current)
      return { lines, size: fittedSize }
    }
    const continuationTitle = wrap(`HÓA ĐƠN DỊCH VỤ - ${printable(invoice.invoiceNumber)}`, 458, 19, 'bold')
    const continuationTop = Math.max(94, 32 + continuationTitle.length * 19 * 1.24 + 28)
    let firstContentTop = 246
    const drawFirstHeader = () => {
      // Only the approved logo is an image. Invoice content is searchable text
      // drawn from stored invoice values, not a rasterized design screenshot.
      doc.image(logoSource, 28 * scale, 40 * scale, { width: 330 * scale, height: 93 * scale })
      let headerY = 42
      headerY += text('HÓA ĐƠN DỊCH VỤ', 425, headerY, 341, 30, 'bold', COLORS.ink, 'right') + 15
      headerY += text(`Số hóa đơn: ${printable(invoice.invoiceNumber)}`, 420, headerY, 346, 16, 'regular', COLORS.ink, 'right') + 4
      headerY += text(`Ngày lập: ${dateText(invoice.issuedAt)}`, 420, headerY, 346, 16, 'regular', COLORS.ink, 'right')
      const stripY = Math.max(178, headerY + 20)
      const columns = [
        { x: 43, width: 218, label: 'Mã booking', value: invoice.booking?.code },
        { x: 290, width: 200, label: 'Ngày dịch vụ', value: dateText(invoice.booking?.completedAt) },
        { x: 535, width: 215, label: 'Kỹ thuật viên', value: invoice.technician?.name },
      ]
      const content = columns.map((column) => wrap(`${column.label}: ${printable(column.value)}`, column.width, 17, 'bold'))
      const stripHeight = Math.max(48, ...content.map((lines) => lines.length * 17 * 1.24 + 24))
      rect(MARGIN, stripY, 738, stripHeight, COLORS.tint, '#FFC69C')
      line(270, stripY + 11, 270, stripY + stripHeight - 11, '#FFAB71')
      line(513, stripY + 11, 513, stripY + stripHeight - 11, '#FFAB71')
      columns.forEach((column, index) => textLines(content[index], column.x, stripY + 13, column.width, 17, 'bold'))
      firstContentTop = stripY + stripHeight + 20
    }
    const ensurePage = (index) => {
      while (pageCount <= index) {
        doc.addPage()
        pageCount += 1
        rect(0, 0, PAGE.width, PAGE.height, COLORS.white, null)
        if (pageCount === 1) drawFirstHeader()
        else {
          text('CoolCare', MARGIN, 29, 270, 26, 'bold', COLORS.orange)
          textLines(continuationTitle, 308, 32, 458, 19, 'bold', COLORS.ink, 'right')
          line(MARGIN, continuationTop - 21, 766, continuationTop - 21, COLORS.orange)
        }
      }
      doc.switchToPage(index)
    }
    const topOf = (page) => page === 0 ? firstContentTop : continuationTop
    ensurePage(0)
    const flow = (column) => ({ ...column, page: 0, y: firstContentTop })
    const left = flow(LEFT)
    const right = flow(RIGHT)
    const nextPage = (column) => {
      column.page += 1
      ensurePage(column.page)
      column.y = topOf(column.page)
    }
    const fit = (column, height) => {
      if (column.y + height > PAGE.bottom) nextPage(column)
      else ensurePage(column.page)
    }

    const panel = (column, title, paragraphs) => {
      const pad = 17
      const titleLines = wrap(title, column.width - 2 * pad, 20, 'bold')
      const initialHeadingHeight = titleLines.length * 20 * 1.24 + 17
      const lines = []
      for (const paragraph of paragraphs) {
        const size = paragraph.size || 17
        const weight = paragraph.weight || 'regular'
        const content = wrap(paragraph.text, column.width - 2 * pad, size, weight)
        content.forEach((value) => lines.push({ text: value, size, weight, color: paragraph.color || COLORS.ink, height: size * 1.24 }))
        lines.push({ text: '', size: 0, weight, color: COLORS.ink, height: paragraph.gap ?? 6 })
      }
      if (lines.at(-1)?.size === 0) lines.pop()
      const fullHeight = initialHeadingHeight + 2 * pad + lines.reduce((sum, item) => sum + item.height, 0)
      // Keep normal panels whole; exceptionally long fields flow onto the next
      // page with the heading repeated instead of shrinking or truncating data.
      if (fullHeight <= PAGE.bottom - continuationTop) fit(column, fullHeight)
      let offset = 0
      let continued = false
      do {
        const currentTitle = continued ? wrap(`${title} (tiếp)`, column.width - 2 * pad, 20, 'bold') : titleLines
        const headingHeight = currentTitle.length * 20 * 1.24 + 17
        fit(column, headingHeight + 2 * pad + 25)
        const available = PAGE.bottom - column.y - headingHeight - 2 * pad
        let end = offset
        let bodyHeight = 0
        while (end < lines.length && bodyHeight + lines[end].height <= available) bodyHeight += lines[end++].height
        if (end === offset && lines.length) { nextPage(column); continue }
        const height = headingHeight + 2 * pad + bodyHeight
        rect(column.x, column.y, column.width, height)
        rect(column.x, column.y, column.width, headingHeight, COLORS.tint, null)
        textLines(currentTitle, column.x + pad, column.y + 10, column.width - 2 * pad, 20, 'bold', COLORS.orange)
        let y = column.y + headingHeight + pad
        for (const item of lines.slice(offset, end)) {
          if (item.size) textLines([item.text], column.x + pad, y, column.width - 2 * pad, item.size, item.weight, item.color)
          y += item.height
        }
        offset = end
        column.y += height + 18
        if (offset < lines.length) { continued = true; nextPage(column) }
      } while (offset < lines.length)
    }

    panel(left, 'ĐƠN VỊ CUNG CẤP', [
      { text: printable(supplier.name, 'CoolCare'), size: 23, weight: 'bold', gap: 9 },
      { text: `Địa chỉ: ${printable(supplier.address, '')}` },
      { text: `Hotline: ${printable(supplier.hotline, '')}` },
    ])
    panel(left, 'KHÁCH HÀNG', [
      { text: printable(invoice.customer?.name), size: 22, weight: 'bold', gap: 9 },
      { text: `Điện thoại: ${printable(invoice.customer?.phone)}` },
      { text: `Địa chỉ thực hiện:\n${printable(invoice.booking?.address)}` },
    ])
    const paid = invoice.paymentStatus === 'PAID'
    const payments = Array.isArray(invoice.payments) ? invoice.payments : []
    const paymentParagraphs = [{ text: `Trạng thái: ${paid ? 'Đã thanh toán' : 'Chưa ghi nhận'}` }]
    if (paid && payments.length === 1) {
      const payment = payments[0]
      paymentParagraphs.push({ text: `Phương thức: ${paymentMethods[payment.method] || printable(payment.method)}` },
        { text: `Thời gian: ${dateText(payment.paidAt, true)} (UTC+7)` })
    } else if (paid && payments.length > 1) {
      paymentParagraphs.push({ text: 'Các giao dịch thanh toán khớp hóa đơn:', size: 16 })
      payments.forEach((payment) => paymentParagraphs.push({ text: `${printable(payment.code)}\n${paymentMethods[payment.method] || printable(payment.method)} - ${dateText(payment.paidAt, true)} (UTC+7)`, size: 15 }))
    } else {
      paymentParagraphs.push({ text: 'Phương thức: Chưa xác định' }, { text: 'Thời gian: Chưa xác định' })
    }
    panel(left, 'THÔNG TIN THANH TOÁN', paymentParagraphs)
    panel(left, 'GHI CHÚ', [{ text: 'Vui lòng liên hệ CoolCare nếu cần hỗ trợ về hóa đơn.', size: 16 }])

    const invoiceItems = groupInvoiceItems(Array.isArray(invoice.items) ? invoice.items : [])
    const needsWideAmounts = invoiceItems.some((item) =>
      widthOf(formatInvoicePdfAmount(item.unitPrice), 12) > 86 || widthOf(formatInvoicePdfAmount(item.totalPrice), 12) > 104)
    // Preserve Figma proportions for normal invoices. An exceptional long
    // exact amount gets a little more space before reaching the minimum font.
    const widths = needsWideAmounts ? [148, 52, 124, 134] : [168, 60, 106, 124]
    const starts = widths.reduce((values, width, index) => [...values, (values[index - 1] || RIGHT.x) + (widths[index - 1] || 0)], [])
    const heading = (continued = false) => {
      const height = 44
      fit(right, 44 + 44 + 50)
      rect(right.x, right.y, right.width, height, COLORS.tint, null)
      text(continued ? 'DỊCH VỤ VÀ TIỀN CÔNG (tiếp)' : 'DỊCH VỤ VÀ TIỀN CÔNG', right.x + 14, right.y + 11, right.width - 28, 20, 'bold', COLORS.orange)
      right.y += height + 10
      rect(right.x, right.y, right.width, 44, COLORS.table)
      ;['Nội dung', 'SL', 'Đơn giá', 'Thành tiền'].forEach((label, index) => {
        if (index) line(starts[index], right.y, starts[index], right.y + 44)
        text(label, starts[index] + 12, right.y + 12, widths[index] - 24, 17, 'bold', COLORS.ink, index ? 'center' : 'left')
      })
      right.y += 44
    }
    heading()
    const renderRow = (item) => {
      const description = printable(item.description || item.service?.name)
      const hasDiscount = /^\d+(?:\.\d{1,2})?$/.test(String(item.discountAmount)) && /[1-9]/.test(String(item.discountAmount))
      const content = [
        ...wrap(description, widths[0] - 28, 17).map((value) => ({ value, size: 17, color: COLORS.ink })),
        ...(hasDiscount ? wrap(`Giảm giá dòng: ${formatInvoicePdfAmount(item.discountAmount)}`, widths[0] - 28, 14).map((value) => ({ value, size: 14, color: COLORS.muted })) : []),
      ]
      const numericCells = [formatInvoicePdfQuantity(item.quantity), formatInvoicePdfAmount(item.unitPrice), formatInvoicePdfAmount(item.totalPrice)]
        .map((value, index) => numericLayout(value, widths[index + 1] - 20))
      const cells = [content, ...numericCells.map((cell) => cell.lines.map((value) => ({ value, size: cell.size })))]
      let remaining = cells.map((cell) => [...cell])
      while (remaining.some((cell) => cell.length)) {
        const rowHeight = Math.max(62, ...remaining.map((cell) => cell.reduce((sum, value) => sum + value.size * 1.24, 0) + 24))
        if (right.y + Math.min(rowHeight, 62) > PAGE.bottom) { nextPage(right); heading(true) }
        const available = PAGE.bottom - right.y - 24
        const fragments = remaining.map((cell) => {
          let used = 0
          let count = 0
          while (count < cell.length && used + cell[count].size * 1.24 <= available) used += cell[count++].size * 1.24
          return { lines: cell.slice(0, count), used, count }
        })
        const height = Math.max(62, ...fragments.map((fragment) => fragment.used + 24))
        ensurePage(right.page)
        rect(right.x, right.y, right.width, height)
        fragments.forEach((fragment, index) => {
          if (index) line(starts[index], right.y, starts[index], right.y + height)
          let y = right.y + 12
          fragment.lines.forEach((value) => {
            textLines([value.value], starts[index] + (index ? 10 : 14), y, widths[index] - (index ? 20 : 28), value.size,
              'regular', value.color || COLORS.ink, index === 1 ? 'center' : index ? 'right' : 'left')
            y += value.size * 1.24
          })
        })
        remaining = remaining.map((cell, index) => cell.slice(fragments[index].count))
        right.y += height
        if (remaining.some((cell) => cell.length)) { nextPage(right); heading(true) }
      }
    }
    if (invoiceItems.length) invoiceItems.forEach(renderRow)
    else renderRow({ description: 'Chưa có nội dung dịch vụ được ghi nhận.', quantity: null, unitPrice: null, totalPrice: null })
    right.y += 22

    const summaryRow = (label, value, { highlight = false, bold = true } = {}) => {
      const labelSize = highlight ? 23 : 19
      const valueSize = highlight ? 25 : 20
      const split = 272
      const labels = wrap(label, split - 32, labelSize, bold ? 'bold' : 'regular')
      const amount = /\d/.test(value) ? numericLayout(value, right.width - split - 28, valueSize, bold ? 'bold' : 'regular')
        : { lines: wrap(value, right.width - split - 28, valueSize, bold ? 'bold' : 'regular'), size: valueSize }
      const height = Math.max(highlight ? 62 : 45, labels.length * labelSize * 1.24 + 22, amount.lines.length * amount.size * 1.24 + 22)
      fit(right, height)
      rect(right.x, right.y, right.width, height, highlight ? COLORS.tint : null, highlight ? '#FFC69C' : COLORS.border)
      if (!highlight) line(right.x + split, right.y, right.x + split, right.y + height)
      textLines(labels, right.x + 18, right.y + 12, split - 32, labelSize, bold ? 'bold' : 'regular', highlight ? COLORS.orange : COLORS.ink)
      textLines(amount.lines, right.x + split + 14, right.y + 12, right.width - split - 28, amount.size, bold ? 'bold' : 'regular', highlight ? COLORS.orange : COLORS.ink, 'right')
      right.y += height
    }
    fit(right, 44 + 10 + 48 + 20)
    rect(right.x, right.y, right.width, 44, COLORS.tint, null)
    text('VẬT TƯ', right.x + 14, right.y + 10, right.width - 28, 21, 'bold', COLORS.orange)
    right.y += 54
    summaryRow('Tổng tiền vật tư', formatInvoicePdfAmount(invoice.totals?.partsAmount))
    right.y += 28
    const discount = formatInvoicePdfAmount(invoice.totals?.discountAmount)
    summaryRow('Tạm tính', formatInvoicePdfAmount(invoice.totals?.subtotal))
    summaryRow('Giảm giá', discount !== '—' && !discount.startsWith('-') && /[1-9]/.test(discount) ? `-${discount}` : discount)
    summaryRow('TỔNG THANH TOÁN', formatInvoicePdfAmount(invoice.totals?.totalAmount), { highlight: true })
    summaryRow('Đã thanh toán', paid ? formatInvoicePdfAmount(invoice.totals?.totalAmount) : 'Chưa xác định')
    summaryRow('Còn phải trả', paid ? formatInvoicePdfAmount('0') : 'Chưa xác định')

    for (let index = 0; index < pageCount; index += 1) {
      ensurePage(index)
      line(MARGIN, 1041, 766, 1041, COLORS.orange)
      text('Cảm ơn quý khách đã sử dụng dịch vụ CoolCare.', MARGIN, 1055, 640, 15)
      text('Chứng từ dịch vụ từ hệ thống - không dùng để kê khai thuế.', MARGIN, 1079, 640, 13, 'regular', COLORS.muted)
      text(`${index + 1}/${pageCount}`, 693, 1079, 73, 13, 'regular', COLORS.muted, 'right')
    }
    doc.end()
  } catch (error) {
    doc.destroy(error)
  }
  return result
}
