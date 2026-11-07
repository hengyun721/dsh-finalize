/**
 * Review-state audit: comments, unaccepted revisions and hidden content.
 *
 * Everything here is read-only and factual — "there are three comments by Li,
 * two hidden slides and one hidden sheet". No judgement, no rewriting.
 */

const unescape = (text) => text
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&amp;/g, '&')

function textOf(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  let out = ''
  for (let match = re.exec(xml); match; match = re.exec(xml)) out += unescape(match[1])
  return out.replace(/\s+/g, ' ').trim()
}

function attrs(source) {
  const out = {}
  for (const match of source.matchAll(/([\w:.-]+)="([^"]*)"/g)) out[match[1]] = match[2]
  return out
}

/* ----------------------------------------------------------------- docx -- */

function reviewDocx(entries) {
  const result = { comments: [], revisions: { total: 0, authors: [], samples: [] }, hidden: [] }
  const documentXml = entries.find((entry) => entry.name === 'word/document.xml')?.data.toString('utf8') ?? ''

  const commentsXml = entries.find((entry) => entry.name === 'word/comments.xml')?.data.toString('utf8')
  if (commentsXml) {
    for (const match of commentsXml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
      const meta = attrs(match[1])
      const text = textOf(match[2], 'w:t')
      if (!text) continue
      result.comments.push({ author: meta['w:author'] ?? 'unknown', date: (meta['w:date'] ?? '').slice(0, 10), text })
    }
  }

  const inserted = [...documentXml.matchAll(/<w:ins\b([^>]*)>/g)]
  const deleted = [...documentXml.matchAll(/<w:del\b([^>]*)>/g)]
  result.revisions.total = inserted.length + deleted.length
  if (result.revisions.total > 0) {
    const authors = new Set()
    for (const match of [...inserted, ...deleted]) {
      const author = attrs(match[1])['w:author']
      if (author) authors.add(author)
    }
    result.revisions.authors = [...authors]
    if (inserted.length) result.revisions.samples.push({ label: '插入', detail: `${inserted.length} 处` })
    if (deleted.length) result.revisions.samples.push({ label: '删除', detail: `${deleted.length} 处` })
    const deletedText = textOf(
      [...documentXml.matchAll(/<w:del\b[\s\S]*?<\/w:del>/g)].map((match) => match[0]).join(''),
      'w:delText',
    )
    if (deletedText) result.revisions.samples.push({ label: '被删除的内容', detail: deletedText.slice(0, 80) })
  }

  const runs = documentXml.split('</w:r>')
  const hidden = []
  const white = []
  for (const run of runs) {
    const text = textOf(run, 'w:t')
    if (!text) continue
    if (/<w:vanish\b/.test(run)) hidden.push(text)
    else if (/<w:color\b[^>]*w:val="FFFFFF"/i.test(run)) white.push(text)
  }
  if (hidden.length) result.hidden.push({ label: '隐藏文字', detail: `${hidden.length} 段：${hidden.slice(0, 3).join(' / ').slice(0, 120)}` })
  if (white.length) result.hidden.push({ label: '白色文字', detail: `${white.length} 段：${white.slice(0, 3).join(' / ').slice(0, 120)}` })
  return result
}

/* ----------------------------------------------------------------- pptx -- */

function reviewPptx(entries) {
  const result = { comments: [], revisions: { total: 0, authors: [], samples: [] }, hidden: [] }
  const presentation = entries.find((entry) => entry.name === 'ppt/presentation.xml')?.data.toString('utf8') ?? ''

  const hiddenSlides = (presentation.match(/<p:sldId\b[^>]*show="0"/g) ?? []).length
  const slides = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)).length
  if (hiddenSlides > 0) result.hidden.push({ label: '隐藏幻灯片', detail: `${hiddenSlides} / ${slides} 页` })

  const hiddenShapes = entries.reduce((sum, entry) => {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(entry.name)) return sum
    return sum + (entry.data.toString('utf8').match(/<p:cNvPr\b[^>]*hidden="1"/g) ?? []).length
  }, 0)
  if (hiddenShapes > 0) result.hidden.push({ label: '隐藏对象', detail: `${hiddenShapes} 个` })

  const notes = entries.filter((entry) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(entry.name))
  const notesWithText = notes.filter((entry) => textOf(entry.data.toString('utf8'), 'a:t').length > 0)
  if (notesWithText.length > 0) result.hidden.push({ label: '演讲者备注', detail: `${notesWithText.length} 页带备注，随文件分发` })

  const authors = new Map()
  const authorXml = entries.find((entry) => entry.name === 'ppt/commentAuthors.xml')?.data.toString('utf8') ?? ''
  for (const match of authorXml.matchAll(/<p:cmAuthor\b([^>]*)>/g)) {
    const meta = attrs(match[1])
    if (meta.name) authors.set(meta.id, meta.name)
  }
  for (const entry of entries) {
    if (!/^ppt\/comments\/comment\d+\.xml$/.test(entry.name)) continue
    const xml = entry.data.toString('utf8')
    for (const match of xml.matchAll(/<p:cm\b([^>]*)>([\s\S]*?)<\/p:cm>/g)) {
      const meta = attrs(match[1])
      const text = textOf(match[2], 'p:text')
      if (!text) continue
      result.comments.push({ author: authors.get(meta.authorId) ?? `id ${meta.authorId}`, date: (meta.dt ?? '').slice(0, 10), text })
    }
  }
  return result
}

/* ----------------------------------------------------------------- xlsx -- */

function reviewXlsx(entries) {
  const result = { comments: [], revisions: { total: 0, authors: [], samples: [] }, hidden: [] }

  const workbook = entries.find((entry) => entry.name === 'xl/workbook.xml')?.data.toString('utf8') ?? ''
  const hiddenSheets = [...workbook.matchAll(/<sheet\b([^>]*)>/g)]
    .map((match) => attrs(match[1]))
    .filter((meta) => meta.state === 'hidden' || meta.state === 'veryHidden')
  if (hiddenSheets.length) result.hidden.push({ label: '隐藏工作表', detail: hiddenSheets.map((meta) => meta.name).join(' / ') })

  let hiddenRows = 0
  let hiddenCols = 0
  for (const entry of entries) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)) continue
    const xml = entry.data.toString('utf8')
    hiddenRows += (xml.match(/<row\b[^>]*hidden="1"/g) ?? []).length
    hiddenCols += (xml.match(/<col\b[^>]*hidden="1"/g) ?? []).length
  }
  if (hiddenRows > 0) result.hidden.push({ label: '隐藏行', detail: `${hiddenRows} 行` })
  if (hiddenCols > 0) result.hidden.push({ label: '隐藏列', detail: `${hiddenCols} 列` })

  const authors = []
  for (const entry of entries) {
    if (!/^xl\/comments\d*\.xml$/.test(entry.name)) continue
    const xml = entry.data.toString('utf8')
    const authorBlock = xml.match(/<authors>([\s\S]*?)<\/authors>/)
    if (authorBlock) {
      for (const match of authorBlock[1].matchAll(/<author>([\s\S]*?)<\/author>/g)) authors.push(unescape(match[1]))
    }
    for (const match of xml.matchAll(/<comment\b([^>]*)>([\s\S]*?)<\/comment>/g)) {
      const meta = attrs(match[1])
      const text = textOf(match[2], 't')
      if (!text) continue
      const author = authors[Number(meta.authorId)] ?? 'unknown'
      result.comments.push({ author, date: '', text: `${meta.ref ?? ''} ${text}`.trim() })
    }
  }
  return result
}

/* ------------------------------------------------------------------ odf -- */

function reviewOdf(entries, kind) {
  const result = { comments: [], revisions: { total: 0, authors: [], samples: [] }, hidden: [] }
  const content = entries.find((entry) => entry.name === 'content.xml')?.data.toString('utf8') ?? ''

  const annotations = [...content.matchAll(/<office:annotation\b[^>]*>([\s\S]*?)<\/office:annotation>/g)]
  for (const match of annotations) {
    const text = textOf(match[1], 'text:p')
    if (text) result.comments.push({ author: '', date: '', text })
  }

  const tracked = (content.match(/<text:(?:changed-region|tracked-changes)\b/g) ?? []).length
  result.revisions.total = tracked
  if (tracked > 0) result.revisions.samples.push({ label: '修订区', detail: `${tracked} 处` })

  const hiddenText = (content.match(/text:display="none"/g) ?? []).length
  if (hiddenText > 0) result.hidden.push({ label: '隐藏内容', detail: `${hiddenText} 处 text:display="none"` })
  if (kind === 'ods') {
    const hiddenTables = (content.match(/table:display="false"/g) ?? []).length
    if (hiddenTables > 0) result.hidden.push({ label: '隐藏工作表', detail: `${hiddenTables} 张` })
  }
  return result
}

/* ---------------------------------------------------------------- entry -- */

/**
 * @param {Array<{name: string, data: Buffer}>} entries
 * @param {'docx'|'pptx'|'xlsx'|'odt'|'ods'|'odp'} kind
 */
export function reviewState(entries, kind) {
  if (kind === 'docx') return reviewDocx(entries)
  if (kind === 'pptx') return reviewPptx(entries)
  if (kind === 'xlsx') return reviewXlsx(entries)
  if (kind === 'odt' || kind === 'ods' || kind === 'odp') return reviewOdf(entries, kind)
  return { comments: [], revisions: { total: 0, authors: [], samples: [] }, hidden: [] }
}

/** Fold the review state into a report: problems become unresolved, a clean file gets one note. */
export function foldReview(report, review, kind) {
  const hasComments = review.comments.length > 0
  const hasRevisions = review.revisions.total > 0
  const hasHidden = review.hidden.length > 0

  if (hasComments) {
    const authors = [...new Set(review.comments.map((comment) => comment.author).filter(Boolean))]
    report.unresolved.push({
      item: '批注',
      detail: `${review.comments.length} 条未解决批注${authors.length ? `（${authors.slice(0, 3).join('、')}）` : ''}`,
      hint: '交付前确认是否删除：Word 审阅 → 删除所有批注；保留则说明是有意留的',
      samples: review.comments.slice(0, 20).map((comment) => ({
        rule: [comment.author, comment.date].filter(Boolean).join(' · ') || '批注',
        detail: comment.text.slice(0, 160),
      })),
    })
  }

  if (hasRevisions) {
    report.unresolved.push({
      item: '修订',
      detail: `${review.revisions.total} 处修订未接受${review.revisions.authors.length ? `（${review.revisions.authors.slice(0, 3).join('、')}）` : ''}`,
      hint: '交付前接受或拒绝全部修订，否则对方能看到每一处改动',
      samples: review.revisions.samples,
    })
  }

  if (hasHidden) {
    report.unresolved.push({
      item: '隐藏内容',
      detail: review.hidden.map((item) => `${item.label}：${item.detail}`).join('；'),
      hint: '这些内容在屏幕上不可见但仍随文件分发，确认是否需要清除',
      samples: review.hidden.map((item) => ({ rule: item.label, detail: item.detail })),
    })
  }

  if (!hasComments && !hasRevisions && !hasHidden) {
    const label = kind === 'pdf' ? 'PDF 无法检测' : '无批注、无修订、无隐藏内容'
    report.notes.push({ item: '审阅状态', detail: label })
  }
}
