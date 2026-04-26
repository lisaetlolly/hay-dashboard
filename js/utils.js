// ── utils.js ──────────────────────────────────────────────────
// 纯工具函数。无业务逻辑，无外部依赖（仅 localStorage）。
// 必须在 config.js 之后、store.js 之前加载。

function deepClone(v) { return JSON.parse(JSON.stringify(v)) }
function readStore(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback } catch (e) { return fallback }
}
function writeStore(key, value) { localStorage.setItem(key, JSON.stringify(value)) }
function makeId(prefix='id') { return prefix + '_' + Math.random().toString(36).slice(2, 10) }
function flattenTasksByPid(tasksByPid) {
  return Object.entries(tasksByPid || {}).flatMap(([pid, list]) => (list || []).map(t => ({ ...t, pid })))
}
function buildTasksByPid(tasks) {
  const out = {}
  for (const t of (tasks || [])) {
    if (!out[t.pid]) out[t.pid] = []
    const { pid, ...rest } = t
    out[t.pid].push(rest)
  }
  return out
}

function filterRows(rows, s, e) {
  return rows.filter(r => r.d >= s && r.d <= e)
}

function prevRange(s, e) {
  const sd = new Date(s), ed = new Date(e)
  const days = Math.round((ed - sd) / 86400000) + 1
  const ps = new Date(sd); ps.setDate(ps.getDate() - days)
  const pe = new Date(ed); pe.setDate(pe.getDate() - days)
  const fmt = d => d.toISOString().slice(0, 10)
  return { s: fmt(ps), e: fmt(pe) }
}

const wan  = n => n == null ? '—' : (n/10000).toFixed(1) + '万'
const fPct = n => n == null ? '—' : Number(n).toFixed(2) + '%'
const chgCls = v => v == null ? 'flat' : v > 0 ? 'up' : 'dn'
const chgTxt = v => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(1) + '%'
