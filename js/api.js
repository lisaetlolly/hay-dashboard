// ── api.js ────────────────────────────────────────────────────
// HTTP 请求层 + offline fallback。依赖：compute.js（computeAll）、RAW（内联全局）。
const api = (path, params) => {
  const s = params?.start || '2026-04-15'
  const e = params?.end   || RAW.data_end
  return fetch(path +
    (params ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v])=>v!=null))) : ''))
    .then(async r => {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return await r.json()
    })
    .catch(() => {
      const all = computeAll(s, e)
      if (path === '/api/overview/kpi') return all.kpi
      if (path === '/api/plan/category') return all.plan
      if (path === '/api/tasks') return []
      if (path === '/api/meeting-notes') return RAW.meetings
      if (path.includes('/api/overview/ranking')) {
        const metric = params?.metric || 'gmv'
        const r = all.ranking(metric, true)
        return { items: r.cur, prev_top: r.prv }
      }
      if (path.includes('/api/overview/report')) {
        return { kpi: all.kpi, plan: all.plan, meetings: all.meetings, prev: all.prev }
      }
      if (path === '/api/health') return { latest_date: RAW.data_end, loaded_at: RAW.loaded_at, status:'offline' }
      if (path.includes('page-views')) return { count: 0 }
      return null
    })
}
