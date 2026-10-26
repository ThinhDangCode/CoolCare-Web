// Minimal TrueType (glyf) reader and subsetter. It exists so invoices can embed a
// Unicode font (Vietnamese needs it) without adding a PDF dependency to the API.

const checksum = (buffer) => {
  let sum = 0
  const padded = buffer.length % 4 === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(4 - (buffer.length % 4))])
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0
  return sum
}

const pad4 = (buffer) =>
  buffer.length % 4 === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(4 - (buffer.length % 4))])

export class TrueTypeFont {
  constructor(buffer) {
    this.buffer = buffer
    this.tables = new Map()
    const numTables = buffer.readUInt16BE(4)
    for (let i = 0; i < numTables; i += 1) {
      const at = 12 + i * 16
      this.tables.set(buffer.toString('latin1', at, at + 4), {
        offset: buffer.readUInt32BE(at + 8),
        length: buffer.readUInt32BE(at + 12),
      })
    }
    for (const required of ['head', 'hhea', 'hmtx', 'maxp', 'cmap', 'loca', 'glyf']) {
      if (!this.tables.has(required)) throw new Error(`Font is missing the ${required} table`)
    }
    const head = this.table('head')
    this.unitsPerEm = head.readUInt16BE(18)
    this.bbox = [head.readInt16BE(36), head.readInt16BE(38), head.readInt16BE(40), head.readInt16BE(42)]
    this.locaFormat = head.readInt16BE(50)
    this.numGlyphs = this.table('maxp').readUInt16BE(4)
    const hhea = this.table('hhea')
    this.ascent = hhea.readInt16BE(4)
    this.descent = hhea.readInt16BE(6)
    this.numberOfHMetrics = hhea.readUInt16BE(34)
    const os2 = this.tables.has('OS/2') ? this.table('OS/2') : null
    this.capHeight = os2 && os2.length >= 90 && os2.readUInt16BE(0) >= 2 ? os2.readInt16BE(88) : Math.round(this.ascent * 0.7)
    this.cmap = this.#readCmap()
  }

  table(tag) {
    const entry = this.tables.get(tag)
    return this.buffer.subarray(entry.offset, entry.offset + entry.length)
  }

  #readCmap() {
    const cmap = this.table('cmap')
    const count = cmap.readUInt16BE(2)
    let best = null
    for (let i = 0; i < count; i += 1) {
      const platform = cmap.readUInt16BE(4 + i * 8)
      const encoding = cmap.readUInt16BE(6 + i * 8)
      const offset = cmap.readUInt32BE(8 + i * 8)
      const format = cmap.readUInt16BE(offset)
      const unicode = (platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0
      if (!unicode || (format !== 4 && format !== 12)) continue
      if (!best || format === 12) best = { offset, format }
    }
    if (!best) throw new Error('Font has no Unicode cmap')
    return { table: cmap, ...best }
  }

  glyphId(codePoint) {
    const { table, offset, format } = this.cmap
    if (format === 12) {
      const groups = table.readUInt32BE(offset + 12)
      for (let i = 0; i < groups; i += 1) {
        const at = offset + 16 + i * 12
        const start = table.readUInt32BE(at)
        const end = table.readUInt32BE(at + 4)
        if (codePoint >= start && codePoint <= end) return table.readUInt32BE(at + 8) + (codePoint - start)
      }
      return 0
    }
    if (codePoint > 0xffff) return 0
    const segCount = table.readUInt16BE(offset + 6) / 2
    const endCodes = offset + 14
    const startCodes = endCodes + segCount * 2 + 2
    const deltas = startCodes + segCount * 2
    const rangeOffsets = deltas + segCount * 2
    for (let i = 0; i < segCount; i += 1) {
      if (codePoint > table.readUInt16BE(endCodes + i * 2)) continue
      const start = table.readUInt16BE(startCodes + i * 2)
      if (codePoint < start) return 0
      const delta = table.readInt16BE(deltas + i * 2)
      const rangeOffset = table.readUInt16BE(rangeOffsets + i * 2)
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff
      const glyphAt = rangeOffsets + i * 2 + rangeOffset + (codePoint - start) * 2
      const glyph = table.readUInt16BE(glyphAt)
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff
    }
    return 0
  }

  advance(glyph) {
    const hmtx = this.table('hmtx')
    const index = Math.min(glyph, this.numberOfHMetrics - 1)
    return hmtx.readUInt16BE(index * 4)
  }

  #glyphRange(glyph) {
    const loca = this.table('loca')
    if (this.locaFormat === 0) return [loca.readUInt16BE(glyph * 2) * 2, loca.readUInt16BE(glyph * 2 + 2) * 2]
    return [loca.readUInt32BE(glyph * 4), loca.readUInt32BE(glyph * 4 + 4)]
  }

  #glyphData(glyph) {
    const [start, end] = this.#glyphRange(glyph)
    return this.table('glyf').subarray(start, end)
  }

  // Composite glyphs reference other glyphs; those must travel with the subset.
  #closure(glyphs) {
    const result = new Set([0, ...glyphs])
    const queue = [...result]
    while (queue.length) {
      const data = this.#glyphData(queue.pop())
      if (data.length < 10 || data.readInt16BE(0) >= 0) continue
      let at = 10
      for (;;) {
        const flags = data.readUInt16BE(at)
        const component = data.readUInt16BE(at + 2)
        if (!result.has(component)) { result.add(component); queue.push(component) }
        at += 4 + (flags & 0x1 ? 4 : 2)
        if (flags & 0x8) at += 2
        else if (flags & 0x40) at += 4
        else if (flags & 0x80) at += 8
        if (!(flags & 0x20)) break
      }
    }
    return result
  }

  // Keeps glyph ids stable (PDF content refers to them) and empties unused outlines.
  subset(glyphs) {
    const keep = this.#closure(glyphs)
    const chunks = []
    const loca = Buffer.alloc((this.numGlyphs + 1) * 4)
    let length = 0
    for (let glyph = 0; glyph < this.numGlyphs; glyph += 1) {
      loca.writeUInt32BE(length, glyph * 4)
      if (!keep.has(glyph)) continue
      const data = pad4(Buffer.from(this.#glyphData(glyph)))
      chunks.push(data)
      length += data.length
    }
    loca.writeUInt32BE(length, this.numGlyphs * 4)

    const head = Buffer.from(this.table('head'))
    head.writeInt16BE(1, 50)
    head.writeUInt32BE(0, 8)
    const output = new Map([
      ['glyf', Buffer.concat(chunks)],
      ['head', head],
      ['hhea', Buffer.from(this.table('hhea'))],
      ['hmtx', Buffer.from(this.table('hmtx'))],
      ['loca', loca],
      ['maxp', Buffer.from(this.table('maxp'))],
    ])
    for (const optional of ['cvt ', 'fpgm', 'prep']) {
      if (this.tables.has(optional)) output.set(optional, Buffer.from(this.table(optional)))
    }
    return buildFont(output)
  }
}

function buildFont(tables) {
  const tags = [...tables.keys()].sort()
  const count = tags.length
  let entrySelector = 0
  while (2 ** (entrySelector + 1) <= count) entrySelector += 1
  const searchRange = 2 ** entrySelector * 16
  const header = Buffer.alloc(12 + count * 16)
  header.writeUInt32BE(0x00010000, 0)
  header.writeUInt16BE(count, 4)
  header.writeUInt16BE(searchRange, 6)
  header.writeUInt16BE(entrySelector, 8)
  header.writeUInt16BE(count * 16 - searchRange, 10)
  let offset = header.length
  const bodies = []
  tags.forEach((tag, index) => {
    const body = tables.get(tag)
    const at = 12 + index * 16
    header.write(tag, at, 'latin1')
    header.writeUInt32BE(checksum(body), at + 4)
    header.writeUInt32BE(offset, at + 8)
    header.writeUInt32BE(body.length, at + 12)
    const padded = pad4(body)
    bodies.push(padded)
    offset += padded.length
  })
  const font = Buffer.concat([header, ...bodies])
  const headIndex = tags.indexOf('head')
  const headOffset = header.readUInt32BE(12 + headIndex * 16 + 8)
  font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8)
  return font
}
