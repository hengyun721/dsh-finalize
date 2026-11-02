/**
 * dsh-finalize — Client half.
 *
 * One icon button in the finalized-message action row (next to copy / like /
 * dislike / branch). It renders only when this session has a delivery report,
 * and it opens a panel so unresolved items never leak into the answer text.
 */
window.__ModuleLoader__.load({
  id: 'dsh-finalize',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const LABELS = {
      title: '交付检查',
      empty: '这份回答还没有经过交付检查。',
      emptyHint: '检查只在文件交付时自动运行一次。',
      fixed: '已修',
      open: '待人工',
      close: '关闭',
      skipped: '已跳过',
      loading: '读取中…',
      failed: '报告不可用',
      noSession: '报告尚未生成',
    }

    const tone = {
      card: 'var(--dsw-alias-bg-elevated, #ffffff)',
      text: 'var(--dsw-alias-text-primary, #1f2328)',
      sub: 'var(--dsw-alias-text-secondary, #6b7280)',
      line: 'var(--dsw-alias-border-subtle, rgba(0,0,0,.12))',
      accent: 'var(--dsw-alias-text-accent, #2563eb)',
      warn: 'var(--dsw-alias-text-warning, #b45309)',
    }

    function reportUrl(props) {
      const id = props?.sessionId ?? props?.session?.id ?? props?.message?.sessionId
      return id ? `api/finalize.report?sessionId=${encodeURIComponent(id)}` : 'api/finalize.report'
    }

    function useReport(props, nonce) {
      const [state, setState] = useState({ status: 'idle', report: null })
      useEffect(() => {
        let live = true
        setState({ status: 'loading', report: null })
        fetch(reportUrl(props), { headers: { accept: 'application/json' } })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
          .then((body) => { if (live) setState({ status: 'ready', report: body?.report ?? null }) })
          .catch(() => { if (live) setState({ status: 'failed', report: null }) })
        return () => { live = false }
      }, [nonce])
      return state
    }

    function Row({ label, value, color }) {
      return h('div', {
        style: {
          display: 'flex', gap: 10, padding: '6px 0', borderTop: `1px solid ${tone.line}`,
          fontSize: 12, lineHeight: 1.5, alignItems: 'baseline',
        },
      },
      h('span', { style: { flex: '0 0 72px', color: tone.sub } }, label),
      h('span', { style: { flex: 1, color: color ?? tone.text, wordBreak: 'break-word' } }, value))
    }

    function FileBlock({ file }) {
      const open = file.unresolved?.length ?? 0
      const fixed = file.fixed?.length ?? 0
      return h('section', { style: { marginTop: 18 } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          h('span', { style: { fontSize: 13, fontWeight: 600, color: tone.text, wordBreak: 'break-all', flex: 1 } }, file.name),
          h('span', { style: { fontSize: 11, color: tone.sub, whiteSpace: 'nowrap' } }, `${fixed} 已修 · ${open} 待人工`)),
        h('div', { style: { fontSize: 11, color: tone.sub, marginTop: 2 } }, file.path),
        file.error ? h(Row, { label: '错误', value: file.error, color: tone.warn }) : null,
        file.skipped ? h(Row, { label: LABELS.skipped, value: file.skipped }) : null,
        ...(file.notes ?? []).map((item, i) => h(Row, { key: `n${i}`, label: `只读 · ${item.item}`, value: item.detail })),
        ...(file.fixed ?? []).map((item, i) => h(Row, { key: `f${i}`, label: `${LABELS.fixed} · ${item.item}`, value: item.value })),
        ...(file.unresolved ?? []).map((item, i) => h('div', {
          key: `u${i}`,
          style: { borderTop: `1px solid ${tone.line}`, padding: '8px 0' },
        },
        h('div', { style: { fontSize: 12, color: tone.warn, fontWeight: 600 } }, `${LABELS.open} · ${item.item}`),
        h('div', { style: { fontSize: 12, color: tone.text, marginTop: 2 } }, item.detail),
        h('div', { style: { fontSize: 11, color: tone.sub, marginTop: 2 } }, item.hint))))
    }

    function Panel({ state, nonce, refresh, onScan, onClose }) {
      const report = state.report
      const count = (report?.files ?? []).reduce((sum, file) => sum + (file.unresolved?.length ?? 0), 0)
      const header = h('header', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        h('strong', { style: { fontSize: 15 } }, LABELS.title),
        h('span', { style: { fontSize: 11, color: tone.sub } },
          report ? `${(report.files ?? []).length} files · ${count} open · ${report.ms}ms` : ''),
        h('span', { style: { flex: 1 } }),
        h('button', {
          onClick: onScan,
          style: { border: `1px solid ${tone.line}`, background: 'transparent', color: tone.accent, borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' },
        }, '扫描最近文件'),
        h('button', {
          onClick: refresh,
          style: { border: `1px solid ${tone.line}`, background: 'transparent', color: tone.sub, borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' },
        }, '↻'),
        h('button', {
          onClick: onClose,
          style: { border: `1px solid ${tone.line}`, background: 'transparent', color: tone.text, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' },
        }, LABELS.close))

      const children = [header]
      if (state.status === 'loading') children.push(h('p', { style: { fontSize: 12, color: tone.sub } }, LABELS.loading))
      if (state.status === 'failed') children.push(h('p', { style: { fontSize: 12, color: tone.warn } }, LABELS.failed))
      if (state.status === 'ready' && !report) {
        children.push(h('div', { style: { marginTop: 12 } },
          h('p', { style: { fontSize: 12, color: tone.text } }, LABELS.empty),
          h('p', { style: { fontSize: 11, color: tone.sub } }, LABELS.emptyHint)))
      }
      for (const file of report?.files ?? []) children.push(h(FileBlock, { key: file.path, file }))

      return h('div', {
        role: 'dialog',
        'aria-modal': true,
        'aria-label': LABELS.title,
        onClick: onClose,
        style: {
          position: 'fixed', inset: 0, zIndex: 2147483000, background: 'rgba(15,23,42,.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        },
      }, h('div', {
        onClick: (event) => event.stopPropagation(),
        style: {
          width: 'min(680px, 100%)', maxHeight: '80vh', overflow: 'auto', background: tone.card,
          color: tone.text, borderRadius: 12, padding: '18px 20px 20px',
          boxShadow: '0 24px 64px rgba(15,23,42,.28)', fontFamily: 'inherit',
        },
      }, ...children))
    }

    function Gate(props) {
      const [open, setOpen] = useState(false)
      const [nonce, setNonce] = useState(0)
      const state = useReport(props, nonce)
      const count = (state.report?.files ?? []).reduce((sum, file) => sum + (file.unresolved?.length ?? 0), 0)
      const refresh = useCallback(() => setNonce((n) => n + 1), [])
      const scan = useCallback(() => {
        const id = props?.sessionId ?? props?.session?.id ?? props?.message?.sessionId
        const url = id ? `api/finalize.scan?sessionId=${encodeURIComponent(id)}` : 'api/finalize.scan'
        fetch(url, { headers: { accept: 'application/json' } })
          .then(() => setNonce((n) => n + 1))
          .catch(() => setNonce((n) => n + 1))
      }, [])

      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          title: count > 0 ? `${LABELS.title}：${count} 项待人工` : LABELS.title,
          'aria-label': LABELS.title,
          onClick: () => setOpen(true),
          style: {
            position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, height: 24,
            padding: '0 6px', border: 0, borderRadius: 6, background: 'transparent',
            color: count > 0 ? tone.warn : 'inherit', cursor: 'pointer', opacity: 0.75,
          },
        },
        h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true },
          h('path', { d: 'M8 1.5 13 3v5c0 3-2.2 5.4-5 6.5C5.2 13.4 3 11 3 8V3z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
          h('path', { d: 'M5.6 8.1 7.2 9.7l3.2-3.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' })),
        count > 0 ? h('span', { style: { fontSize: 10, fontWeight: 600 } }, String(count)) : null),
        open ? h(Panel, { state, nonce, refresh, onScan: scan, onClose: () => setOpen(false) }) : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'dsh-finalize',
          order: 40,
          label: LABELS.title,
        }, Gate))
      },
    }
  },
})
