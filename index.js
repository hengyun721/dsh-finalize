/**
 * dsh-finalize — Host half.
 *
 * One finalize pass right before delivery, and nowhere else. No tool, no prompt
 * section: the model never sees it, so it costs zero tokens.
 *
 * Multiple files are handled in one run; several deliveries in the same session
 * merge into one report instead of replacing each other.
 */
import { readFile, writeFile, stat, readdir, appendFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { finalizeOffice } from './lib/office.js'

export const name = 'dsh-finalize'

const readFileAsync = promisify(readFile)
const writeFileAsync = promisify(writeFile)
const statAsync = promisify(stat)
const readdirAsync = promisify(readdir)

/** Diagnostics are opt-in: set DSH_FINALIZE_DEBUG=1 to get a trace in the OS temp dir. */
const DEBUG = process.env.DSH_FINALIZE_DEBUG === '1'
const TRACE = join(tmpdir(), 'dsh-finalize.log')
const OFFICE = new Set(['docx', 'pptx', 'xlsx', 'pdf', 'odt', 'ods', 'odp'])

function trace(line) {
  if (!DEBUG) return
  try { appendFileSync(TRACE, `${new Date().toISOString()} ${line}\n`) } catch { /* diagnostics only */ }
}

/* --------------------------------------------------------------- reports -- */

const reports = new Map()

function mergeReports(previous, next, now) {
  if (!previous) return next
  if (previous.sessionId !== next.sessionId) return next
  if (now - Date.parse(previous.at) > 30 * 60 * 1000) return next
  const files = [...previous.files]
  for (const file of next.files) {
    const at = files.findIndex((item) => item.path === file.path)
    if (at >= 0) files[at] = file
    else files.push(file)
  }
  return { ...next, at: previous.at, files, ms: previous.ms + next.ms, runs: (previous.runs ?? 1) + 1 }
}

function remember(sessionId, report) {
  const now = Date.parse(report.at)
  if (sessionId) reports.set(sessionId, mergeReports(reports.get(sessionId), report, now))
  const global = reports.get('global')
  reports.set('global', mergeReports(global?.sessionId === report.sessionId ? global : null, report, now))
}

/* ------------------------------------------------------------------ exec -- */

function toolNameOf(exec) {
  return exec?.name ?? exec?.toolName ?? exec?.tool?.name ?? exec?.call?.name ?? ''
}

function argsOf(exec) {
  return exec?.arguments ?? exec?.args ?? exec?.input ?? exec?.call?.args ?? {}
}

function sessionOf(exec) {
  return exec?.agent?.session?.id ?? exec?.session?.id ?? exec?.sessionId ?? exec?.agent?.id
}

function filesOf(args) {
  const list = args?.files ?? args?.file ?? args?.paths ?? []
  const out = []
  for (const item of Array.isArray(list) ? list : [list]) {
    if (typeof item === 'string') out.push(item)
    else if (item && typeof item.path === 'string') out.push(item.path)
  }
  return [...new Set(out)]
}

async function processOne(path, config) {
  const ext = extname(path).toLowerCase().replace('.', '')
  const entry = { path, name: basename(path), format: ext, fixed: [], unresolved: [], notes: [] }
  if (!(config?.formats ?? ['docx']).includes(ext)) {
    entry.skipped = `format "${ext}" is outside this adapter set`
    return entry
  }
  try {
    const info = await statAsync(path)
    const bytes = await readFileAsync(path)
    const result = finalizeOffice(bytes, ext, { ...(config?.autoFix ?? {}), textCheck: config?.textCheck })
    if (result.bytes !== bytes) await writeFileAsync(path, result.bytes)
    entry.fixed = result.report.fixed
    entry.unresolved = result.report.unresolved
    entry.notes = result.report.notes
    entry.sizeBefore = bytes.length
    entry.sizeAfter = result.bytes.length
    entry.mtime = info.mtime.toISOString()
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error)
  }
  return entry
}

async function runFinalize(exec, config) {
  const started = Date.now()
  const sessionId = sessionOf(exec)
  const paths = filesOf(argsOf(exec))
  const report = { at: new Date().toISOString(), sessionId: sessionId ?? null, files: [], ms: 0, runs: 1 }
  trace(`run start tool=${toolNameOf(exec)} files=${paths.length}`)
  for (const path of paths) report.files.push(await processOne(path, config))
  report.ms = Date.now() - started
  remember(sessionId, report)
  trace(`run done files=${report.files.length} fixed=${report.files.reduce((n, f) => n + f.fixed.length, 0)} open=${report.files.reduce((n, f) => n + f.unresolved.length, 0)}`)
  if (DEBUG) {
    try {
      await writeFileAsync(join(tmpdir(), 'dsh-finalize-last.json'), JSON.stringify({ at: report.at, tool: toolNameOf(exec), sessionId: sessionId ?? null, paths, merged: reports.get(sessionId)?.files.length ?? report.files.length }, null, 2), 'utf8')
    } catch { /* diagnostics only */ }
  }
  return report
}

/* ------------------------------------------------------------------ scan -- */

async function scanLatest(ctx, sessionId, config) {
  const wd = ctx.get?.('workingDirectory')
  const dirs = [wd?.defaultDirectory, process.cwd()].filter((dir) => typeof dir === 'string' && dir.length > 0)
  const limit = config?.scanLimit ?? 5
  for (const dir of dirs) {
    let names = []
    try { names = await readdirAsync(dir) } catch { continue }
    const files = []
    for (const entry of names) {
      const ext = extname(entry).toLowerCase().replace('.', '')
      if (!OFFICE.has(ext)) continue
      try {
        const info = await statAsync(join(dir, entry))
        if (info.isFile()) files.push({ path: join(dir, entry), mtime: info.mtimeMs })
      } catch { /* skip */ }
    }
    if (files.length === 0) continue
    files.sort((a, b) => b.mtime - a.mtime)
    const report = { at: new Date().toISOString(), sessionId: sessionId ?? null, dir, files: [], ms: 0, runs: 1 }
    const started = Date.now()
    for (const file of files.slice(0, limit)) report.files.push(await processOne(file.path, config))
    report.ms = Date.now() - started
    remember(sessionId, report)
    trace(`scan dir=${dir} files=${report.files.length}`)
    return report
  }
  return { at: new Date().toISOString(), sessionId: sessionId ?? null, dir: dirs[0] ?? null, files: [], ms: 0, runs: 1 }
}

/* ----------------------------------------------------------------- apply -- */

export function apply(ctx, config = {}) {
  const trigger = new Set(config.triggerTools ?? ['present', 'qqbot_send_file'])
  const enabled = config.enabled !== false
  trace(`apply trigger=${[...trigger].join(',')} enabled=${enabled}`)

  ctx.effect(() => ctx.on('tools/pre-execute', async (exec, next) => {
    const tool = toolNameOf(exec)
    if (!enabled || !trigger.has(tool)) return next()
    try { await runFinalize(exec, config) } catch (error) { trace(`run failed: ${error instanceof Error ? error.message : String(error)}`) }
    return next()
  }), 'dsh-finalize.hook()')

  const mount = (scope) => {
    const connection = scope?.connection?.fetch ? scope.connection
      : scope?.fetch?.register ? scope
        : scope?.get?.('connection')
    if (!connection?.fetch?.register) {
      trace('connection.fetch unavailable')
      return
    }
    ctx.effect(() => connection.fetch.register({
      path: '/api/finalize.report',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => {
        const sessionId = new URL(request.url).searchParams.get('sessionId')
        const report = (sessionId && reports.get(sessionId)) || reports.get('global') || null
        return Promise.resolve(Response.json({ report }, { headers: { 'cache-control': 'no-store' } }))
      },
    }), 'dsh-finalize.report()')
    ctx.effect(() => connection.fetch.register({
      path: '/api/finalize.scan',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const sessionId = new URL(request.url).searchParams.get('sessionId')
        const report = await scanLatest(ctx, sessionId, config)
        return Response.json({ report }, { headers: { 'cache-control': 'no-store' } })
      },
    }), 'dsh-finalize.scan()')
    trace('routes registered')
  }

  if (typeof ctx.inject === 'function') {
    try { ctx.inject(['connection'], mount) } catch { mount(ctx) }
  } else {
    mount(ctx)
  }
}
