/**
 * Heuristic PDF text extraction for the punctuation check.
 *
 * This is not a PDF renderer. It decodes what a text-layer PDF exposes:
 * Flate-compressed content streams, the `Tj` / `TJ` / `'` operators, literal and
 * hex strings, and per-font `ToUnicode` CMaps (including Identity-H CID fonts).
 *
 * It cannot read scanned pages, fonts without a ToUnicode map, or text drawn as
 * vector outlines. Callers must treat `stats.unmapped` as "unknown", not "clean".
 */
import zlib from 'node:zlib'

function hexToUnicode(hex) {
  const clean = hex.replace(/\s+/g, '')
  let out = ''
  for (let i = 0; i + 4 <= clean.length; i += 4) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16))
  }
  return out
}

function parseCMap(source) {
  const map = new Map()
  const twoByte = /begincodespacerange\s*<[0-9A-Fa-f]{4}>/.test(source)

  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(pair[1], 16), hexToUnicode(pair[2]))
    }
  }
  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      const low = parseInt(range[1], 16)
      const high = parseInt(range[2], 16)
      if (range[3] !== undefined) {
        const base = parseInt(range[3], 16)
        for (let code = low; code <= high && code - low < 4096; code += 1) {
          map.set(code, String.fromCharCode(base + (code - low)))
        }
      } else {
        const items = [...(range[4] ?? '').matchAll(/<([0-9A-Fa-f]+)>/g)].map((item) => hexToUnicode(item[1]))
        items.forEach((text, offset) => map.set(low + offset, text))
      }
    }
  }
  return { map, twoByte }
}

function objectsOf(text) {
  const objects = new Map()
  const re = /(\d+)\s+(\d+)\s+obj\b/g
  let match = re.exec(text)
  while (match) {
    const start = match.index + match[0].length
    const end = text.indexOf('endobj', start)
    if (end < 0) break
    objects.set(Number(match[1]), { body: text.slice(start, end) })
    re.lastIndex = end
    match = re.exec(text)
  }
  return objects
}

function streamOf(object) {
  const at = object.body.indexOf('stream')
  if (at < 0) return null
  const dict = object.body.slice(0, at)
  let start = at + 'stream'.length
  if (object.body[start] === '\r') start += 1
  if (object.body[start] === '\n') start += 1
  const end = object.body.lastIndexOf('endstream')
  if (end <= start) return null
  let raw = Buffer.from(object.body.slice(start, end).replace(/[\r\n]+$/, ''), 'latin1')
  if (/\/FlateDecode/.test(dict)) {
    try {
      raw = zlib.inflateSync(raw)
    } catch {
      try {
        raw = zlib.inflateRawSync(raw)
      } catch {
        return null
      }
    }
  } else if (/\/Filter/.test(dict)) {
    return null
  }
  return { dict, data: raw.toString('latin1') }
}

function unescapePdfString(raw) {
  return raw.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_match, code) => {
    if (/^[0-7]+$/.test(code)) return String.fromCharCode(parseInt(code, 8))
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[code] ?? code
  })
}

function decodeShow(raw, font) {
  if (font?.cid && !font.cmap) return ''
  if (font?.cmap?.twoByte) {
    const bytes = Buffer.from(raw, 'latin1')
    let out = ''
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1]
      out += font.cmap.map.get(code) ?? ''
    }
    return out
  }
  return raw
}

function decodeHexShow(hex, font) {
  if (font?.cid && !font.cmap) return ''
  const clean = hex.replace(/\s+/g, '')
  if (font?.cmap?.twoByte) {
    let out = ''
    for (let i = 0; i + 4 <= clean.length; i += 4) {
      out += font.cmap.map.get(parseInt(clean.slice(i, i + 4), 16)) ?? ''
    }
    return out
  }
  return Buffer.from(clean, 'hex').toString('latin1')
}

const TOKEN = /\/([A-Za-z0-9]+)\s+[-\d.]+\s+Tf|\(((?:\\.|[^\\()])*)\)\s*(Tj|'|")|<([0-9A-Fa-f\s]+)>\s*Tj|\[((?:[^\[\]]|\\.)*)\]\s*TJ/g

function textOfStream(content, fonts) {
  const chunks = []
  let font = null
  let buffer = ''
  const flush = () => {
    const text = buffer.replace(/\s+/g, ' ').trim()
    if (text.length >= 2) chunks.push(text)
    buffer = ''
  }

  for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
    buffer = ''
    TOKEN.lastIndex = 0
    for (let token = TOKEN.exec(block[1]); token; token = TOKEN.exec(block[1])) {
      if (token[1]) {
        font = fonts.get(token[1]) ?? null
      } else if (token[2] !== undefined) {
        buffer += decodeShow(unescapePdfString(token[2]), font)
        if (token[3] === "'") buffer += '\n'
      } else if (token[4] !== undefined) {
        buffer += decodeHexShow(token[4], font)
      } else if (token[5] !== undefined) {
        const array = token[5]
        for (const part of array.matchAll(/\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]+)>/g)) {
          buffer += part[1] !== undefined ? decodeShow(unescapePdfString(part[1]), font) : decodeHexShow(part[2], font)
        }
      }
    }
    flush()
  }
  return chunks
}

/**
 * Expand `/Type /ObjStm` compressed object streams into the object map.
 * Modern generators (Word, Chrome) put fonts and resource dictionaries there.
 */
function expandObjectStreams(objects) {
  const extra = new Map()
  for (const object of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm\b/.test(object.body)) continue
    const stream = streamOf(object)
    if (!stream) continue
    const count = Number((stream.dict.match(/\/N\s+(\d+)/) ?? [])[1] ?? 0)
    const first = Number((stream.dict.match(/\/First\s+(\d+)/) ?? [])[1] ?? 0)
    if (!count || !first) continue
    const header = stream.data.slice(0, first).trim().split(/\s+/).map(Number)
    for (let index = 0; index < count; index += 1) {
      const number = header[index * 2]
      const offset = header[index * 2 + 1]
      if (!Number.isFinite(number) || !Number.isFinite(offset)) continue
      const start = first + offset
      const nextOffset = index + 1 < count ? header[(index + 1) * 2 + 1] : stream.data.length - first
      extra.set(number, { body: stream.data.slice(start, first + nextOffset) })
    }
  }
  for (const [number, object] of extra) {
    if (!objects.has(number)) objects.set(number, object)
  }
}

/**
 * Extract readable text from a PDF.
 * @param {Buffer} bytes
 * @returns {{ chunks: string[], stats: { objects: number, textStreams: number, fonts: number, mappedFonts: number, unmappedFonts: number } }}
 */
export function extractPdfText(bytes) {
  const text = bytes.toString('latin1')
  const objects = objectsOf(text)
  expandObjectStreams(objects)
  const stats = { objects: objects.size, textStreams: 0, fonts: 0, mappedFonts: 0, unmappedFonts: 0 }

  const fontObjects = new Map()
  for (const [id, object] of objects) {
    if (/\/Type\s*\/Font\b/.test(object.body)) fontObjects.set(id, object)
  }
  stats.fonts = fontObjects.size

  const fonts = new Map()
  for (const object of fontObjects.values()) {
    const cid = /\/Subtype\s*\/Type0\b/.test(object.body) || /\/Identity-[HV]\b/.test(object.body)
    const toUnicode = object.body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/)
    let cmap = null
    if (toUnicode) {
      const target = objects.get(Number(toUnicode[1]))
      const stream = target ? streamOf(target) : null
      if (stream) {
        const parsed = parseCMap(stream.data)
        if (parsed.map.size > 0) cmap = parsed
      }
    }
    if (cmap) stats.mappedFonts += 1
    else stats.unmappedFonts += 1
    object.cmap = cmap
    object.cid = cid
  }

  for (const object of objects.values()) {
    const streamAt = object.body.indexOf('stream')
    const dict = streamAt < 0 ? object.body : object.body.slice(0, streamAt)
    for (const resource of dict.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) {
      for (const entry of resource[1].matchAll(/\/([A-Za-z0-9]+)\s+(\d+)\s+\d+\s+R/g)) {
        const font = fontObjects.get(Number(entry[2]))
        if (font) fonts.set(entry[1], font)
      }
    }
  }

  const chunks = []
  for (const object of objects.values()) {
    const stream = streamOf(object)
    if (!stream) continue
    if (!/\bBT\b/.test(stream.data) || !/(Tj|TJ)\b/.test(stream.data)) continue
    stats.textStreams += 1
    chunks.push(...textOfStream(stream.data, fonts))
  }

  return { chunks, stats }
}
