import { deflateSync } from 'node:zlib'
import { TrueTypeFont } from './truetype-font.js'

// Coordinates are PDF points measured from the TOP-LEFT of the page, which is how
// the invoice layout is designed. Text y is the baseline.

export const A4 = Object.freeze({ width: 595.28, height: 841.89 })

const KAPPA = 0.5522847498
const num = (value) => (Math.round(value * 1000) / 1000).toString()

function color(value) {
  const hex = String(value).replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) throw new Error(`Invalid color ${value}`)
  return [0, 2, 4].map((i) => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ')
}

const pdfString = (value) =>
  `(${String(value).replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?')})`

const hex4 = (value) => value.toString(16).padStart(4, '0')

function toUnicodeHex(codePoint) {
  if (codePoint <= 0xffff) return hex4(codePoint)
  const offset = codePoint - 0x10000
  return hex4(0xd800 + (offset >> 10)) + hex4(0xdc00 + (offset & 0x3ff))
}

class EmbeddedFont {
  constructor(name, key, buffer) {
    this.name = name
    this.key = key
    this.font = new TrueTypeFont(buffer)
    this.used = new Map() // glyph id -> code point
    this.glyphCache = new Map()
  }

  glyph(codePoint) {
    let glyph = this.glyphCache.get(codePoint)
    if (glyph === undefined) {
      glyph = this.font.glyphId(codePoint)
      this.glyphCache.set(codePoint, glyph)
    }
    return glyph
  }

  width(text, size, spacing = 0) {
    let units = 0
    let count = 0
    for (const char of text.normalize('NFC')) {
      units += this.font.advance(this.glyph(char.codePointAt(0)))
      count += 1
    }
    return (units / this.font.unitsPerEm) * size + spacing * count
  }

  encode(text) {
    let output = ''
    for (const char of text.normalize('NFC')) {
      const codePoint = char.codePointAt(0)
      const glyph = this.glyph(codePoint)
      if (glyph !== 0 && !this.used.has(glyph)) this.used.set(glyph, codePoint)
      output += hex4(glyph)
    }
    return `<${output}>`
  }
}

export class PdfDocument {
  constructor({ fonts, title = '', author = '', subject = '', creationDate = new Date() }) {
    this.fonts = Object.fromEntries(
      Object.entries(fonts).map(([key, buffer], index) => [key, new EmbeddedFont(`F${index + 1}`, key, buffer)])
    )
    this.meta = { title, author, subject, creationDate }
    this.pages = []
    this.page = null
  }

  addPage() {
    this.page = []
    this.pages.push(this.page)
    return this
  }

  goToPage(index) {
    if (!this.pages[index]) throw new Error(`Page ${index} does not exist`)
    this.page = this.pages[index]
    return this
  }

  #emit(operation) { this.page.push(operation) }
  #y(y) { return A4.height - y }

  measure(text, { font = 'regular', size = 12, spacing = 0 } = {}) {
    return this.fonts[font].width(String(text), size, spacing)
  }

  // Splits on words, falling back to characters for words wider than the box.
  wrap(text, width, options = {}) {
    const lines = []
    for (const paragraph of String(text ?? '').split(/\r?\n/)) {
      let line = ''
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word
        if (this.measure(candidate, options) <= width) { line = candidate; continue }
        if (line) lines.push(line)
        line = ''
        let rest = word
        while (this.measure(rest, options) > width) {
          let cut = rest.length - 1
          while (cut > 1 && this.measure(rest.slice(0, cut), options) > width) cut -= 1
          lines.push(rest.slice(0, cut))
          rest = rest.slice(cut)
        }
        line = rest
      }
      lines.push(line)
    }
    return lines.length ? lines : ['']
  }

  text(text, x, baseline, { font = 'regular', size = 12, color: fill = '#000000', align = 'left', width = 0, spacing = 0 } = {}) {
    const value = String(text ?? '')
    if (!value) return
    const embedded = this.fonts[font]
    let left = x
    if (align !== 'left') {
      const textWidth = embedded.width(value, size, spacing) - spacing
      left = align === 'right' ? x + width - textWidth : x + (width - textWidth) / 2
    }
    this.#emit(
      `BT /${embedded.name} ${num(size)} Tf ${color(fill)} rg ${num(spacing)} Tc ${num(left)} ${num(this.#y(baseline))} Td ${embedded.encode(value)} Tj ET`
    )
  }

  #roundedPath(x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2))
    const top = this.#y(y)
    const bottom = this.#y(y + h)
    if (radius === 0) return `${num(x)} ${num(bottom)} ${num(w)} ${num(h)} re`
    const c = radius * KAPPA
    return [
      `${num(x + radius)} ${num(top)} m`,
      `${num(x + w - radius)} ${num(top)} l`,
      `${num(x + w - radius + c)} ${num(top)} ${num(x + w)} ${num(top - radius + c)} ${num(x + w)} ${num(top - radius)} c`,
      `${num(x + w)} ${num(bottom + radius)} l`,
      `${num(x + w)} ${num(bottom + radius - c)} ${num(x + w - radius + c)} ${num(bottom)} ${num(x + w - radius)} ${num(bottom)} c`,
      `${num(x + radius)} ${num(bottom)} l`,
      `${num(x + radius - c)} ${num(bottom)} ${num(x)} ${num(bottom + radius - c)} ${num(x)} ${num(bottom + radius)} c`,
      `${num(x)} ${num(top - radius)} l`,
      `${num(x)} ${num(top - radius + c)} ${num(x + radius - c)} ${num(top)} ${num(x + radius)} ${num(top)} c h`,
    ].join(' ')
  }

  rect(x, y, w, h, { fill, stroke, lineWidth = 1, radius = 0 } = {}) {
    if (!fill && !stroke) return
    const paint = fill && stroke ? 'B' : fill ? 'f' : 'S'
    this.#emit(
      `q ${fill ? `${color(fill)} rg ` : ''}${stroke ? `${color(stroke)} RG ${num(lineWidth)} w ` : ''}${this.#roundedPath(x, y, w, h, radius)} ${paint} Q`
    )
  }

  line(x1, y1, x2, y2, { stroke = '#000000', lineWidth = 1, round = false } = {}) {
    this.#emit(
      `q ${color(stroke)} RG ${num(lineWidth)} w ${round ? '1 J 1 j ' : ''}${num(x1)} ${num(this.#y(y1))} m ${num(x2)} ${num(this.#y(y2))} l S Q`
    )
  }

  save() {
    const objects = [] // index 0 -> object 1
    const add = (body) => { objects.push(body); return objects.length }
    const reserve = () => { objects.push(null); return objects.length }
    const stream = (dict, data, compress = true) => {
      const body = compress ? deflateSync(data) : data
      return Buffer.concat([
        Buffer.from(`<< ${dict} /Length ${body.length}${compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1'),
        body,
        Buffer.from('\nendstream', 'latin1'),
      ])
    }

    const catalogId = reserve()
    const pagesId = reserve()

    const fontRefs = []
    Object.values(this.fonts).forEach((embedded, index) => {
      const tag = String.fromCharCode(65 + index).repeat(6)
      const baseName = `${tag}+InvoiceFont-${embedded.key}`
      const font = embedded.font
      const scale = 1000 / font.unitsPerEm
      const subset = font.subset(new Set(embedded.used.keys()))
      const fontFileId = add(stream(`/Length1 ${subset.length}`, subset))
      const descriptorId = add(
        `<< /Type /FontDescriptor /FontName /${baseName} /Flags 4 /FontBBox [${font.bbox.map((v) => Math.round(v * scale)).join(' ')}] ` +
          `/ItalicAngle 0 /Ascent ${Math.round(font.ascent * scale)} /Descent ${Math.round(font.descent * scale)} ` +
          `/CapHeight ${Math.round(font.capHeight * scale)} /StemV ${index ? 140 : 80} /FontFile2 ${fontFileId} 0 R >>`
      )
      const glyphs = [...embedded.used.keys()].sort((a, b) => a - b)
      const widths = glyphs.map((g) => `${g} [${Math.round(font.advance(g) * scale)}]`).join(' ')
      const cidId = add(
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
          `/FontDescriptor ${descriptorId} 0 R /CIDToGIDMap /Identity /DW 0 /W [${widths}] >>`
      )
      const entries = glyphs.map((g) => `<${hex4(g)}> <${toUnicodeHex(embedded.used.get(g))}>`)
      const blocks = []
      for (let i = 0; i < entries.length; i += 100) {
        const slice = entries.slice(i, i + 100)
        blocks.push(`${slice.length} beginbfchar\n${slice.join('\n')}\nendbfchar`)
      }
      const cmap =
        '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def ' +
        '/CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n' +
        `${blocks.join('\n')}\nendcmap CMapName currentdict /CMap defineresource pop end end`
      const toUnicodeId = add(stream('', Buffer.from(cmap, 'latin1')))
      const typeId = add(
        `<< /Type /Font /Subtype /Type0 /BaseFont /${baseName} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`
      )
      fontRefs.push(`/${embedded.name} ${typeId} 0 R`)
    })

    const pageIds = this.pages.map((operations) => {
      const contentId = add(stream('', Buffer.from(operations.join('\n'), 'latin1')))
      return add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /Font << ${fontRefs.join(' ')} >> >> /Contents ${contentId} 0 R >>`
      )
    })

    const stamp = this.meta.creationDate.toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const infoId = add(
      `<< /Title <FEFF${Buffer.from(this.meta.title, 'utf16le').swap16().toString('hex')}> /Author <FEFF${Buffer.from(this.meta.author, 'utf16le').swap16().toString('hex')}> ` +
        `/Subject <FEFF${Buffer.from(this.meta.subject, 'utf16le').swap16().toString('hex')}> /Producer ${pdfString('CoolCare')} /CreationDate ${pdfString(`D:${stamp}Z`)} >>`
    )
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

    const parts = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')]
    const offsets = []
    let position = parts[0].length
    objects.forEach((body, index) => {
      offsets.push(position)
      const chunk = Buffer.concat([
        Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
        Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'),
        Buffer.from('\nendobj\n', 'latin1'),
      ])
      parts.push(chunk)
      position += chunk.length
    })
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`]
    for (const offset of offsets) xref.push(`${String(offset).padStart(10, '0')} 00000 n \n`)
    xref.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${position}\n%%EOF\n`)
    parts.push(Buffer.from(xref.join(''), 'latin1'))
    return Buffer.concat(parts)
  }
}
