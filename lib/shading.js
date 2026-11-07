/**
 * Text background audit.
 *
 * The classic AI-paste artifact is a run-level `<w:shd w:fill="F2F2F2">` (or a
 * similarly neutral grey/blue) left behind when rich text is converted into a
 * docx. It looks like a highlighter smear across the page and carries no
 * meaning, so those neutral fills are removed by default. Explicit highlights
 * (`w:highlight`, `a:highlight`) are never touched — they are a deliberate
 * author choice — and every other fill colour is reported, not rewritten.
 */

/** Neutral fills that only ever come from paste/convert residue. */
const ARTIFACT_FILLS = new Set(['F2F2F2', 'E7E6E6', 'EDEDED', 'F3F3F3', 'EEEEEE'])

const RUN = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g
const SHD = /<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"[^>]*\/>/

function textOfRun(run) {
  return [...run.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]).join('')
}

/**
 * Inspect (and optionally strip) run-level shading in a docx part.
 * @param {string} xml word/document.xml
 * @param {{ stripTextShading?: boolean }} options `false` disables removal
 */
export function processDocxShading(xml, options = {}) {
  const strip = options.stripTextShading !== false
  const report = { fills: new Map(), highlights: 0, removed: 0, samples: [] }
  const next = xml.replace(RUN, (run) => {
    const shading = run.match(SHD)
    const highlighted = /<w:highlight\b/.test(run)
    if (!shading && !highlighted) return run
    const text = textOfRun(run).slice(0, 60)
    if (highlighted) {
      report.highlights += 1
      if (report.samples.length < 10) report.samples.push({ label: '高亮', detail: text })
    }
    if (shading) {
      const color = shading[1].toUpperCase()
      report.fills.set(color, (report.fills.get(color) ?? 0) + 1)
      if (report.samples.length < 10) report.samples.push({ label: `底纹 #${color}`, detail: text })
      if (strip && ARTIFACT_FILLS.has(color)) {
        report.removed += 1
        return run.replace(shading[0], '')
      }
    }
    return run
  })
  return { xml: next, report }
}

/** Highlight counts for pptx and odf parts (detection only). */
export function inspectShading(entries, kind) {
  const report = { highlights: 0, fills: new Map(), samples: [] }
  if (kind === 'pptx') {
    for (const entry of entries) {
      if (!/^ppt\/slides\/slide\d+\.xml$/.test(entry.name)) continue
      const xml = entry.data.toString('utf8')
      const hits = xml.match(/<a:highlight\b/g) ?? []
      report.highlights += hits.length
      if (hits.length && report.samples.length < 10) {
        const text = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]).join(' ')
        report.samples.push({ label: '高亮', detail: text.slice(0, 60) })
      }
    }
  }
  if (kind === 'odt' || kind === 'ods' || kind === 'odp') {
    const content = entries.find((entry) => entry.name === 'content.xml')?.data.toString('utf8') ?? ''
    for (const match of content.matchAll(/text:background-color="([^"]+)"/g)) {
      report.fills.set(match[1], (report.fills.get(match[1]) ?? 0) + 1)
    }
    if (report.fills.size && report.samples.length < 10) {
      const text = [...content.matchAll(/<text:(?:p|h)[^>]*>([\s\S]*?)<\/text:(?:p|h)>/g)].map((match) => match[1].replace(/<[^>]+>/g, '')).join(' ')
      report.samples.push({ label: '文字底色', detail: text.slice(0, 60) })
    }
  }
  return report
}
