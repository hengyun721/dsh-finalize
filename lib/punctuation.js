/**
 * Punctuation checker for document text.
 *
 * Reports only — it never rewrites the document. A blind character swap corrupts
 * code, URLs, formulas and citations far more often than it helps, so findings
 * carry a snippet and a suggested replacement for a human to apply.
 *
 * Languages covered: zh, ja, ko, en, fr, de. Language is detected per paragraph
 * from script counts (Han / Kana / Hangul / Latin), with a Latin-language guess
 * based on diacritics and stop words.
 */

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const KANA = /[\u3040-\u30ff]/
const HANGUL = /[\uac00-\ud7af\u1100-\u11ff]/
const LATIN = /[A-Za-zÀ-ÖØ-öø-ÿ]/

const ZH_MAP = { ',': '，', '.': '。', '!': '！', '?': '？', ':': '：', ';': '；', '(': '（', ')': '）' }
const JA_MAP = { ',': '、', '.': '。', '!': '！', '?': '？', ':': '：', ';': '；', '(': '（', ')': '）' }
const FULLWIDTH_MAP = { '，': ',', '。': '.', '！': '!', '？': '?', '：': ':', '；': ';', '（': '(', '）': ')' }

const RULE_LABELS = {
  'cjk-ascii': '中文/日文段落里用了英文标点',
  'ja-comma': '日文里用了中文逗号「，」',
  'latin-fullwidth': '拉丁文字段落里用了全角标点',
  'ko-fullwidth': '韩文段落里用了全角标点',
  'space-before': '标点前多了空格',
  'repeat': '标点重复',
  'quotes': '引号不成对',
}

const FR_WORDS = /\b(le|la|les|des|une|est|dans|pour|que|qui|pas|avec|sur|aux|du|au|ce|cette)\b/gi
const DE_WORDS = /\b(der|die|das|und|ist|nicht|ein|eine|mit|für|auf|von|den|dem|des|auch|werden)\b/gi

function kindOf(ch) {
  if (!ch) return null
  if (HAN.test(ch)) return 'han'
  if (KANA.test(ch)) return 'kana'
  if (HANGUL.test(ch)) return 'hangul'
  if (LATIN.test(ch)) return 'latin'
  return null
}

function countOf(text, pattern) {
  return (text.match(pattern) ?? []).length
}

/** Guess the language of one paragraph. Returns zh / ja / ko / en / fr / de, or null. */
export function detectLanguage(text) {
  const han = countOf(text, HAN)
  const kana = countOf(text, KANA)
  const hangul = countOf(text, HANGUL)
  const latin = countOf(text, LATIN)
  if (kana > 0 && kana + han >= latin) return 'ja'
  if (hangul > 0 && hangul >= latin) return 'ko'
  if (han > 0 && han >= latin) return 'zh'
  if (latin === 0) return null
  const fr = countOf(text, /[àâçéèêëîïôûùüÿœ]/gi)
  const de = countOf(text, /[äöüß]/gi)
  const frWords = countOf(text, FR_WORDS)
  const deWords = countOf(text, DE_WORDS)
  const frScore = fr * 2 + frWords
  const deScore = de * 2 + deWords
  if (deScore > frScore) return 'de'
  if (frScore > deScore) return 'fr'
  return 'en'
}

function prevChar(text, index) {
  let at = index - 1
  while (at >= 0 && /\s/.test(text[at])) at -= 1
  return at >= 0 ? text[at] : ''
}

function nextChar(text, index) {
  let at = index + 1
  while (at < text.length && /\s/.test(text[at])) at += 1
  return at < text.length ? text[at] : ''
}

function snippet(text, index, replacement) {
  const from = Math.max(0, index - 12)
  const to = Math.min(text.length, index + 13)
  const before = (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : '')
  const after = (from > 0 ? '…' : '') + (text.slice(from, index) + replacement + text.slice(index + 1, to)).replace(/\s+/g, ' ') + (to < text.length ? '…' : '')
  return { before, after }
}

/**
 * Skip decimals, list numbers, versions, URLs, e-mail addresses and paths:
 * replacing punctuation there is always wrong.
 */
function insideTechnicalToken(text, index, ch) {
  const around = text.slice(Math.max(0, index - 24), Math.min(text.length, index + 24))
  const previous = text[index - 1] ?? ''
  const next = text[index + 1] ?? ''
  if (/[0-9][.,][0-9]/.test(text.slice(Math.max(0, index - 1), index + 2))) return true
  // "1." / "1)" / "3.2" list and section numbering, including before Chinese text.
  if (/[0-9]/.test(previous) && (ch === '.' || ch === ')' || ch === ':' || ch === ',')) return true
  if (ch === '.' && /[A-Za-z]/.test(previous) && /[A-Za-z]/.test(next)) return true
  if (/:\/\/|www\.|@|\\|\/[a-z0-9]/i.test(around)) return true
  return false
}

function normalize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

/** Signature of the local context around a mark: start|han|：|han|end. */
function keyOf(text, index, ch) {
  return `${kindOf(prevChar(text, index)) ?? 'start'}|${ch}|${kindOf(nextChar(text, index)) ?? 'end'}`
}

function collect(text, lang) {
  const findings = []
  const push = (rule, index, replacement) => {
    const { before, after } = snippet(text, index, replacement)
    findings.push({ rule, key: rule === 'quotes' || rule === 'repeat' ? `${rule}|${text[index]}` : keyOf(text, index, text[index]), index, before, after })
  }

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]

    if (lang === 'zh' || lang === 'ja') {
      const map = lang === 'ja' ? JA_MAP : ZH_MAP
      if (map[ch] && !insideTechnicalToken(text, i, ch)) {
        const near = [prevChar(text, i), nextChar(text, i)].some((c) => kindOf(c) === 'han' || kindOf(c) === 'kana')
        if (near) push(lang === 'ja' && ch === ',' ? 'ja-comma' : 'cjk-ascii', i, map[ch])
      }
      if (lang === 'ja' && ch === '，') push('ja-comma', i, '、')
    }

    if ((lang === 'en' || lang === 'fr' || lang === 'de') && FULLWIDTH_MAP[ch]) {
      const near = [prevChar(text, i), nextChar(text, i)].some((c) => kindOf(c) === 'latin')
      if (near) push('latin-fullwidth', i, FULLWIDTH_MAP[ch])
    }

    if (lang === 'ko' && FULLWIDTH_MAP[ch]) {
      const near = [prevChar(text, i), nextChar(text, i)].some((c) => kindOf(c) === 'hangul')
      if (near) push('ko-fullwidth', i, FULLWIDTH_MAP[ch])
    }
  }

  if (lang === 'zh' || lang === 'ja') {
    for (const match of text.matchAll(/[ \u00a0]+([，。！？；：、])/g)) push('space-before', match.index, match[1])
    for (const match of text.matchAll(/([，。、；：])\1{2,}/g)) push('repeat', match.index, match[1])
  }

  for (const [open, close] of [['“', '”'], ['「', '」'], ['『', '』']]) {
    if (countOf(text, new RegExp(open, 'g')) !== countOf(text, new RegExp(close, 'g'))) {
      push('quotes', Math.max(0, text.indexOf(open)), open)
    }
  }
  return findings
}

function groupOf(findings) {
  const groups = new Map()
  for (const finding of findings) {
    const group = groups.get(finding.rule) ?? { rule: finding.rule, label: RULE_LABELS[finding.rule], count: 0, samples: [] }
    group.count += 1
    if (group.samples.length < 3) group.samples.push({ before: finding.before, after: finding.after })
    groups.set(finding.rule, group)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

/**
 * Check punctuation and classify every finding by origin.
 *
 * `baseline` holds normalised paragraphs of the document the user supplied
 * (template or earlier version). Text found there is never actionable: it is
 * reported as `inherited`. A finding whose local signature also occurs in the
 * baseline is `convention` — the assistant followed the template's own style,
 * which is correct even when that style is non-standard.
 *
 * @param {string[]} chunks paragraphs, cells or slide bodies
 * @param {{ languages?: string[], baseline?: Set<string>, baselineKeys?: Set<string> }} options
 */
export function checkPunctuation(chunks, options = {}) {
  const enabled = new Set(options.languages ?? ['zh', 'ja', 'ko', 'en', 'fr', 'de'])
  const baseline = options.baseline ?? new Set()
  const baselineKeys = options.baselineKeys ?? new Set()
  const findings = []

  chunks.forEach((raw, chunkIndex) => {
    const text = String(raw ?? '')
    if (text.trim().length < 2) return
    const lang = detectLanguage(text)
    if (!lang || !enabled.has(lang)) return
    for (const finding of collect(text, lang)) findings.push({ ...finding, chunkIndex })
  })

  const originOf = (finding) => {
    if (baseline.has(normalize(chunks[finding.chunkIndex]))) return 'inherited'
    if (baselineKeys.has(finding.key)) return 'convention'
    return 'own'
  }
  const classified = findings.map((finding) => ({ ...finding, origin: originOf(finding) }))
  const bucket = (origin) => {
    const list = classified.filter((finding) => finding.origin === origin)
    return { count: list.length, groups: groupOf(list), findings: list }
  }

  return {
    total: classified.length,
    findings: classified,
    groups: groupOf(classified),
    own: bucket('own'),
    inherited: bucket('inherited'),
    convention: bucket('convention'),
  }
}
