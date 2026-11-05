/**
 * OOXML (docx / pptx / xlsx), ODF and a read-only PDF inspector.
 *
 * Rules: only rewrite what is provably wrong or provably unnecessary. Anything
 * that would require inventing evidence (edit time, review history) is returned
 * as an unresolved item instead of being written. Text punctuation is checked
 * and reported, never rewritten.
 */
import zlib from 'node:zlib'
import { checkPunctuation } from './punctuation.js'
import { extractPdfText } from './pdf-text.js'

/* ------------------------------------------------------------------ zip -- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (~c) >>> 0
}

function readZip(buf) {
  let eocd = -1
  const floor = Math.max(0, buf.length - 65558)
  for (let i = buf.length - 22; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip container')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('broken central directory')
    const method = buf.readUInt16LE(off + 10)
    const time = buf.readUInt16LE(off + 12)
    const date = buf.readUInt16LE(off + 14)
    const csize = buf.readUInt32LE(off + 20)
    const nlen = buf.readUInt16LE(off + 28)
    const elen = buf.readUInt16LE(off + 30)
    const clen = buf.readUInt16LE(off + 32)
    const lho = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nlen)
    const lnlen = buf.readUInt16LE(lho + 26)
    const lelen = buf.readUInt16LE(lho + 28)
    const start = lho + 30 + lnlen + lelen
    const raw = buf.subarray(start, start + csize)
    const data = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw)
    entries.push({ name, data, time, date })
    off += 46 + nlen + elen + clen
  }
  return entries
}

function writeZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const store = entry.name === 'mimetype'
    const comp = store ? entry.data : zlib.deflateRawSync(entry.data, { level: 9 })
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(store ? 0 : 8, 8)
    local.writeUInt16LE(entry.time ?? 0, 10)
    local.writeUInt16LE(entry.date ?? 0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, comp)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(store ? 0 : 8, 10)
    central.writeUInt16LE(entry.time ?? 0, 12)
    central.writeUInt16LE(entry.date ?? 0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(comp.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)

    offset += 30 + nameBuf.length + comp.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/* ------------------------------------------------------------- entities -- */

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g

function countText(xml) {
  let text = ''
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
  for (let match = re.exec(xml); match; match = re.exec(xml)) text += decodeXml(match[1] ?? match[2] ?? match[3] ?? '')
  return text
}

function textStats(xml) {
  const text = countText(xml)
  const cjk = (text.match(CJK) ?? []).length
  const latinWords = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length
  return {
    words: cjk + latinWords,
    characters: text.replace(/\s/g, '').length,
    charactersWithSpaces: text.length,
    paragraphs: (xml.match(/<w:p[ >]|<a:p[ >]/g) ?? []).length,
    lines: Math.max(1, Math.ceil(text.length / 38)),
  }
}

/* --------------------------------------------------------------- shared -- */

function fixCore(entries, index, options, report) {
  const coreAt = index.get('docProps/core.xml')
  if (coreAt === undefined) return
  let core = entries[coreAt].data.toString('utf8')
  const setCore = (tag, value) => {
    const pattern = new RegExp(`(<${tag}\\b[^>]*>)[\\s\\S]*?(</${tag}>)`)
    if (pattern.test(core)) core = core.replace(pattern, (_match, open, close) => `${open}${value}${close}`)
  }
  const author = (options.author ?? '').trim()
  if (author !== '') {
    setCore('dc:creator', escapeXml(author))
    setCore('cp:lastModifiedBy', escapeXml(author))
    report.fixed.push({ item: '作者字段', value: author })
  }
  if (/python-docx|python-pptx|openpyxl|generated by/i.test(core)) {
    setCore('dc:description', '')
    if (/<dc:creator\b[^>]*>\s*(python-docx|python-pptx|openpyxl)\s*</i.test(core)) setCore('dc:creator', '')
    setCore('cp:lastModifiedBy', '')
    report.fixed.push({ item: '生成器署名', value: 'removed generator name / description' })
  }
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  setCore('dcterms:modified', stamp)
  if (/2013-12-23/.test(core)) {
    setCore('dcterms:created', stamp)
    report.fixed.push({ item: '创建时间', value: 'replaced template date 2013-12-23' })
  }
  entries[coreAt].data = Buffer.from(core, 'utf8')
}

function setField(xml, tag, value) {
  const pattern = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`)
  return pattern.test(xml) ? xml.replace(pattern, `<${tag}>${value}</${tag}>`) : xml.replace('</Properties>', `<${tag}>${value}</${tag}></Properties>`)
}

function stripApplication(app, options, report) {
  if (options.dropApplicationField === false) return app
  const before = app
  const next = app.replace(/<Application>[\s\S]*?<\/Application>/, '').replace(/<AppVersion>[\s\S]*?<\/AppVersion>/, '')
  if (before !== next) report.fixed.push({ item: 'Application 字段', value: 'removed (not replaced with a fake Office version)' })
  return next
}

function dropThumbnail(entries, index, report) {
  if (!index.has('docProps/thumbnail.jpeg')) return
  const relsAt = index.get('_rels/.rels')
  if (relsAt === undefined) return
  const rels = entries[relsAt].data.toString('utf8')
  const next = rels.replace(/<Relationship[^>]*Type="[^"]*\/thumbnail"[^>]*\/>/g, '')
  if (next !== rels) {
    entries[relsAt].data = Buffer.from(next, 'utf8')
    report.fixed.push({ item: '模板缩略图', value: 'relationship removed' })
  }
}

function commonUnresolved(entries, index, report) {
  const hasComments = index.has('word/comments.xml') || index.has('ppt/comments/comment1.xml') || index.has('xl/comments1.xml')
  if (!hasComments) {
    report.unresolved.push({ item: '批注', detail: '文档没有任何批注，看不出评审过程', hint: '需要真实的评审轮次；生成批注属于伪造，不做' })
  }
  if (!entries.some((entry) => /<w:ins\s|<w:del\s/.test(entry.data.toString('utf8')))) {
    report.unresolved.push({ item: '修订记录', detail: '没有修订痕迹', hint: '只能真实产生，不能补写' })
  }
}

/* ---------------------------------------------------------- text checks -- */

/** Split one XML part into paragraphs and join their text runs. */
function blockChunks(xml, closing, textTag) {
  const out = []
  const re = new RegExp(`<${textTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${textTag}>`, 'g')
  for (const block of xml.split(closing)) {
    let text = ''
    for (let match = re.exec(block); match; match = re.exec(block)) text += decodeXml(match[1])
    re.lastIndex = 0
    if (text.trim().length >= 2) out.push(text)
  }
  return out
}

/** ODF content.xml: text lives in text:p and text:h blocks. */
function odfChunks(xml) {
  const out = []
  for (const block of xml.split(/<\/text:(?:p|h)>/)) {
    const text = decodeXml(block.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    if (text.length >= 2) out.push(text)
  }
  return out
}

/** Spreadsheet cells, long enough to be prose rather than labels or codes. */
function xlsxChunks(entries) {
  const out = []
  const collect = (xml) => {
    for (const block of xml.split('</si>')) {
      const text = [...block.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join('')
      if (text.trim().length >= 8) out.push(text)
    }
    for (const match of xml.matchAll(/<is>([\s\S]*?)<\/is>/g)) {
      const text = [...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((item) => decodeXml(item[1])).join('')
      if (text.trim().length >= 8) out.push(text)
    }
  }
  const shared = entries.find((entry) => entry.name === 'xl/sharedStrings.xml')
  if (shared) collect(shared.data.toString('utf8'))
  for (const entry of entries) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)) collect(entry.data.toString('utf8'))
  }
  return out
}

/** Run the punctuation rules and fold the result into the report. */
function punctuationCheck(report, chunks, textCheck) {
  if (textCheck?.punctuation === false) return
  if (!Array.isArray(chunks) || chunks.length === 0) return
  const result = checkPunctuation(chunks, { languages: textCheck?.languages })
  if (result.total === 0) {
    report.notes.push({ item: '标点', detail: '未发现中文/日文/韩文/英文/法文/德文标点混用' })
    return
  }
  const top = result.groups.slice(0, 3).map((group) => `${group.label} ${group.count} 处（例：${group.samples[0].before} → ${group.samples[0].after}）`)
  report.unresolved.push({
    item: '标点',
    detail: `${result.total} 处：${top.join('；')}`,
    hint: '只报不改：标点替换在代码、URL、公式和引用里容易误伤，确认后手动替换',
  })
}

/* ---------------------------------------------------------------- docx -- */

function finalizeDocx(bytes, options) {
  const entries = readZip(bytes)
  const index = new Map(entries.map((entry, at) => [entry.name, at]))
  const report = { fixed: [], unresolved: [], notes: [] }
  const docAt = index.get('word/document.xml')
  if (docAt === undefined) throw new Error('word/document.xml missing')

  fixCore(entries, index, options, report)
  const appAt = index.get('docProps/app.xml')
  if (appAt !== undefined) {
    let app = entries[appAt].data.toString('utf8')
    const stats = textStats(entries[docAt].data.toString('utf8'))
    app = stripApplication(app, options, report)
    for (const [tag, value] of [['Words', stats.words], ['Characters', stats.characters], ['CharactersWithSpaces', stats.charactersWithSpaces], ['Paragraphs', stats.paragraphs], ['Lines', stats.lines]]) {
      app = setField(app, tag, value)
    }
    report.fixed.push({ item: '统计字段', value: `${stats.words} words / ${stats.characters} chars` })
    if (Number((app.match(/<Pages>(\d+)<\/Pages>/) ?? [])[1] ?? 1) <= 1 && stats.characters > 1500) {
      report.unresolved.push({ item: '页数', detail: '模板 Pages=1，离线排不出真实页数', hint: '用 Word/WPS 打开保存一次，页数会自动写入' })
    }
    if (Number((app.match(/<TotalTime>(\d+)<\/TotalTime>/) ?? [])[1] ?? 0) === 0) {
      report.unresolved.push({ item: '编辑时间', detail: 'TotalTime=0：这份文件从未被 Word 保存过', hint: '不代填；真实打开改一次并保存，Word 自己会写' })
    }
    entries[appAt].data = Buffer.from(app, 'utf8')
  }
  dropThumbnail(entries, index, report)
  commonUnresolved(entries, index, report)
  punctuationCheck(report, blockChunks(entries[docAt].data.toString('utf8'), '</w:p>', 'w:t'), options.textCheck)
  return { bytes: writeZip(entries), report }
}

/* ---------------------------------------------------------------- pptx -- */

function finalizePptx(bytes, options) {
  const entries = readZip(bytes)
  const index = new Map(entries.map((entry, at) => [entry.name, at]))
  const report = { fixed: [], unresolved: [], notes: [] }

  fixCore(entries, index, options, report)
  const slides = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
  const notes = entries.filter((entry) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(entry.name))
  const presentation = entries.find((entry) => entry.name === 'ppt/presentation.xml')
  const hidden = presentation ? (presentation.data.toString('utf8').match(/<p:sldId[^>]*show="0"/g) ?? []).length : 0
  const notesWithText = notes.filter((entry) => countText(entry.data.toString('utf8')).trim().length > 0).length
  const text = slides.map((entry) => countText(entry.data.toString('utf8'))).join('\n')
  const stats = {
    words: (text.match(CJK) ?? []).length + (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length,
    characters: text.replace(/\s/g, '').length,
    paragraphCount: slides.reduce((sum, entry) => sum + (entry.data.toString('utf8').match(/<a:p[ >]/g) ?? []).length, 0),
  }

  const appAt = index.get('docProps/app.xml')
  if (appAt !== undefined) {
    let app = entries[appAt].data.toString('utf8')
    app = stripApplication(app, options, report)
    app = setField(app, 'Slides', slides.length)
    app = setField(app, 'Notes', notesWithText)
    app = setField(app, 'HiddenSlides', hidden)
    app = setField(app, 'Words', stats.words)
    app = setField(app, 'Paragraphs', stats.paragraphCount)
    app = setField(app, 'Characters', stats.characters)
    entries[appAt].data = Buffer.from(app, 'utf8')
    report.fixed.push({ item: '统计字段', value: `${slides.length} slides / ${notesWithText} notes with text` })
  }
  dropThumbnail(entries, index, report)

  if (slides.some((entry) => /<a:srcRect/.test(entry.data.toString('utf8')))) {
    report.unresolved.push({ item: '裁剪图片', detail: '有图片被裁剪，原图仍完整保存在 ppt/media 里', hint: '对方解压即可还原；确需处理请重新导出图片' })
  }
  if (notesWithText === 0) {
    report.unresolved.push({ item: '演讲者备注', detail: '没有备注页内容', hint: '备注是最能体现“真做过汇报”的痕迹，但只能真写' })
  }
  if (hidden > 0) {
    report.notes.push({ item: '隐藏幻灯片', detail: `${hidden} 页处于隐藏状态，仍随文件分发` })
  }
  commonUnresolved(entries, index, report)
  punctuationCheck(report, slides.flatMap((entry) => blockChunks(entry.data.toString('utf8'), '</a:p>', 'a:t')), options.textCheck)
  return { bytes: writeZip(entries), report }
}

/* ---------------------------------------------------------------- xlsx -- */

function finalizeXlsx(bytes, options) {
  const entries = readZip(bytes)
  const index = new Map(entries.map((entry, at) => [entry.name, at]))
  const report = { fixed: [], unresolved: [], notes: [] }

  fixCore(entries, index, options, report)

  const workbook = entries.find((entry) => entry.name === 'xl/workbook.xml')
  const sheets = workbook
    ? [...workbook.data.toString('utf8').matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*\/?>/g)].map((match) => decodeXml(match[1]))
    : []
  const hiddenSheets = workbook
    ? (workbook.data.toString('utf8').match(/<sheet\b[^>]*state="(hidden|veryHidden)"/g) ?? []).length
    : 0
  const sheetFiles = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
  const formulas = sheetFiles.reduce((sum, entry) => sum + (entry.data.toString('utf8').match(/<f[ >]/g) ?? []).length, 0)

  const appAt = index.get('docProps/app.xml')
  if (appAt !== undefined) {
    let app = entries[appAt].data.toString('utf8')
    app = stripApplication(app, options, report)
    if (sheets.length > 0 && /<TitlesOfParts>/.test(app)) {
      const titles = `<TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheets.map((name) => `<vt:lpstr>${escapeXml(name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts>`
      app = app.replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, titles)
      report.fixed.push({ item: 'TitlesOfParts', value: `aligned to ${sheets.length} sheet name(s)` })
    }
    entries[appAt].data = Buffer.from(app, 'utf8')
  }
  dropThumbnail(entries, index, report)

  if (formulas === 0 && sheetFiles.length > 0) {
    report.unresolved.push({ item: '公式', detail: '整本工作簿没有一条公式，全是算好的值', hint: '别人无法顺着公式复算，这是表格类最硬的破绽；建议保留计算过程' })
  } else {
    report.notes.push({ item: '公式', detail: `${formulas} 条，可被复算` })
  }
  if (index.has('xl/pivotCache/pivotCacheDefinition1.xml')) {
    report.unresolved.push({ item: '透视缓存', detail: '透视表缓存里保留着源数据快照，删掉的行列仍可恢复', hint: '交付前用 Excel「刷新并删除缓存」或另存为值' })
  }
  if (hiddenSheets > 0) {
    report.notes.push({ item: '隐藏工作表', detail: `${hiddenSheets} 张隐藏表仍随文件分发` })
  }
  if (index.has('xl/externalLinks/externalLink1.xml')) {
    report.unresolved.push({ item: '外部链接', detail: '工作簿引用外部文件，对方打开会看到路径或报错', hint: '断开链接或改为值' })
  }
  commonUnresolved(entries, index, report)
  punctuationCheck(report, xlsxChunks(entries), options.textCheck)
  return { bytes: writeZip(entries), report }
}

/* ----------------------------------------------------------------- pdf -- */

function pdfString(text, key) {
  const literal = text.match(new RegExp(`/${key}\\s*\\(([^)]*)\\)`))
  if (literal) return literal[1]
  const hex = text.match(new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]+)>`))
  if (!hex) return null
  try {
    return Buffer.from(hex[1].replace(/\s+/g, ''), 'hex').toString('utf8')
  } catch {
    return null
  }
}

function inspectPdf(bytes, options = {}) {
  const text = bytes.toString('latin1')
  const report = { fixed: [], unresolved: [], notes: [] }
  const producer = pdfString(text, 'Producer')
  const creator = pdfString(text, 'Creator')
  const created = pdfString(text, 'CreationDate')
  const modified = pdfString(text, 'ModDate')
  const xmpTool = (text.match(/<xmp:CreatorTool>([^<]*)</) ?? [])[1] ?? null
  const eofs = (text.match(/%%EOF/g) ?? []).length
  const encrypted = /\/Encrypt\s*<</.test(text) || /\/Encrypt\s+\d+\s+\d+\s+R/.test(text)
  const signed = /\/ByteRange\s*\[/.test(text)
  const outlines = /\/Outlines\b/.test(text)

  if (producer || creator || xmpTool) {
    report.notes.push({ item: '生成工具', detail: [producer && `Producer=${producer}`, creator && `Creator=${creator}`, xmpTool && `XMP=${xmpTool}`].filter(Boolean).join(' · ') })
  }
  if (created || modified) {
    report.notes.push({ item: 'PDF 时间', detail: [created && `CreationDate=${created}`, modified && `ModDate=${modified}`].filter(Boolean).join(' · ') })
  }
  if (eofs > 1) {
    report.unresolved.push({ item: '增量更新', detail: `文件里有 ${eofs} 个 %%EOF，说明保存过多次，旧版文字可能被恢复`, hint: '用 qpdf --linearize 重写一遍再交付' })
  }
  if (encrypted) {
    report.notes.push({ item: '加密', detail: 'PDF 已加密，部分工具读不到内容' })
  }
  if (signed) {
    report.notes.push({ item: '数字签名', detail: '含签名/时间戳——这是唯一无法伪造的可信度来源' })
  }
  if (!outlines) {
    report.unresolved.push({ item: '书签', detail: '没有大纲书签，长文档不便导航', hint: '导出时勾选“创建书签”，这是排版质量的直接信号' })
  }
  report.unresolved.push({ item: '编辑史', detail: 'PDF 是渲染结果，本身没有编辑史', hint: '所以 PDF 内部的任何字段都不构成“人写的”证据；可信度只能来自签名、时间戳或出具方' })
  const extracted = extractPdfText(bytes)
  if (extracted.chunks.length === 0) {
    report.notes.push({ item: '标点', detail: `PDF 未提取到文本层（${extracted.stats.textStreams} 个文本流，${extracted.stats.mappedFonts}/${extracted.stats.fonts} 个字体可解码），可能是扫描件或纯图形` })
  } else {
    punctuationCheck(report, extracted.chunks, options.textCheck)
    if (extracted.stats.unmappedFonts > 0) {
      report.notes.push({ item: '标点覆盖', detail: `${extracted.stats.unmappedFonts} 个字体缺少 ToUnicode 映射，相应文字未被检查` })
    }
  }
  return { bytes, report }
}

/* ----------------------------------------------------------------- odf -- */

function setAttr(tag, name, value) {
  const pattern = new RegExp(`${name}="[^"]*"`)
  return pattern.test(tag) ? tag.replace(pattern, `${name}="${value}"`) : tag.replace(/\/>$/, ` ${name}="${value}"/>`)
}

function finalizeOdf(bytes, kind, options) {
  let entries = readZip(bytes)
  const report = { fixed: [], unresolved: [], notes: [] }

  if (entries[0]?.name !== 'mimetype') {
    report.unresolved.push({ item: 'mimetype', detail: '包内第一个条目不是 mimetype', hint: '部分阅读器会拒绝打开；用 LibreOffice 另存一次即可修好' })
  }

  const manifestAt = entries.findIndex((entry) => entry.name === 'META-INF/manifest.xml')
  const hasThumb = entries.some((entry) => entry.name === 'Thumbnails/thumbnail.png')
  if (hasThumb) {
    entries = entries.filter((entry) => entry.name !== 'Thumbnails/thumbnail.png')
    const at = entries.findIndex((entry) => entry.name === 'META-INF/manifest.xml')
    if (at >= 0) {
      const manifest = entries[at].data.toString('utf8')
      const next = manifest.replace(/<manifest:file-entry[^>]*manifest:full-path="Thumbnails\/thumbnail\.png"[^>]*(?:\/>|><\/manifest:file-entry>)/g, '')
      entries[at].data = Buffer.from(next, 'utf8')
    }
    report.fixed.push({ item: '模板缩略图', value: 'Thumbnails/thumbnail.png removed' })
  }

  const index = new Map(entries.map((entry, at) => [entry.name, at]))
  const metaAt = index.get('meta.xml')
  if (metaAt === undefined) throw new Error('meta.xml missing')
  let meta = entries[metaAt].data.toString('utf8')
  const content = entries.find((entry) => entry.name === 'content.xml')?.data.toString('utf8') ?? ''
  const plain = decodeXml(content.replace(/<[^>]+>/g, ' '))
  const words = (plain.match(CJK) ?? []).length + (plain.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length
  const characters = plain.replace(/\s/g, '').length
  const paragraphs = (content.match(/<text:(?:p|h)[ >]/g) ?? []).length

  if (/<meta:generator>/.test(meta)) {
    meta = meta.replace(/<meta:generator>[\s\S]*?<\/meta:generator>/, '')
    report.fixed.push({ item: '生成器', value: 'removed meta:generator' })
  }
  const author = (options.author ?? '').trim()
  if (author !== '') {
    meta = meta.replace(/(<dc:creator>)[\s\S]*?(<\/dc:creator>)/, (_m, open, close) => `${open}${escapeXml(author)}${close}`)
    meta = meta.replace(/(<meta:initial-creator>)[\s\S]*?(<\/meta:initial-creator>)/, (_m, open, close) => `${open}${escapeXml(author)}${close}`)
    report.fixed.push({ item: '作者字段', value: author })
  }
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  meta = meta.replace(/(<meta:creation-date>)[\s\S]*?(<\/meta:creation-date>)/, (_m, open, close) => `${open}${stamp}${close}`)
  meta = meta.replace(/(<dc:date>)[\s\S]*?(<\/dc:date>)/, (_m, open, close) => `${open}${stamp}${close}`)

  meta = meta.replace(/<meta:document-statistic[^>]*\/>/, (tag) => {
    let next = setAttr(tag, 'meta:word-count', words)
    next = setAttr(next, 'meta:character-count', characters)
    next = setAttr(next, 'meta:paragraph-count', paragraphs)
    return next
  })
  report.fixed.push({ item: '统计字段', value: `${words} words / ${characters} chars / ${paragraphs} paragraphs` })

  const duration = (meta.match(/<meta:editing-duration>([^<]*)</) ?? [])[1]
  if (!duration || duration === 'PT0S') {
    report.unresolved.push({ item: '编辑时长', detail: `meta:editing-duration=${duration ?? '缺失'}，说明这份文件没被真正编辑过`, hint: '不代填；用 LibreOffice 打开改一次并保存，它会自己累加' })
  }
  const cycles = Number((meta.match(/<meta:editing-cycles>(\d+)</) ?? [])[1] ?? 1)
  if (cycles <= 1) {
    report.unresolved.push({ item: '保存次数', detail: `meta:editing-cycles=${cycles}`, hint: '同上：只能真实产生' })
  }
  if (!/<office:annotation[\s>]/.test(content)) {
    report.unresolved.push({ item: '批注', detail: '文档没有任何批注', hint: '需要真实评审；生成批注属于伪造' })
  }
  if (!/<text:tracked-changes[\s>]/.test(content)) {
    report.unresolved.push({ item: '修订记录', detail: '没有修订痕迹', hint: '只能真实产生，不能补写' })
  }

  entries[metaAt].data = Buffer.from(meta, 'utf8')
  punctuationCheck(report, odfChunks(content), options.textCheck)
  return { bytes: writeZip(entries), report }
}

/* ---------------------------------------------------------------- entry -- */

export function finalizeOffice(bytes, kind, options = {}) {
  if (kind === 'docx') return finalizeDocx(bytes, options)
  if (kind === 'pptx') return finalizePptx(bytes, options)
  if (kind === 'xlsx') return finalizeXlsx(bytes, options)
  if (kind === 'odt' || kind === 'ods' || kind === 'odp') return finalizeOdf(bytes, kind, options)
  if (kind === 'pdf') return inspectPdf(bytes, options)
  throw new Error(`unsupported format: ${kind}`)
}

export { finalizeDocx, finalizePptx, finalizeXlsx, finalizeOdf, inspectPdf, readZip, writeZip }
