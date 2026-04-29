// ── api.js ────────────────────────────────────────────────────
// HTTP 请求层 + offline fallback。依赖：compute.js（computeAll）、RAW（内联全局）。
//
// 全局 fetch 拦截：自动注入 X-Username header
//   后端写权限校验靠这个 header 找当前用户；登录后 user 会被
//   写入 localStorage('hay_current_user')，下面这层包装读出来塞到 header 里。
//   未登录或权限不够的写操作会被后端 401/403。
;(function setupAuthHeader() {
  if (window.__hayFetchPatched) return
  window.__hayFetchPatched = true
  const _origFetch = window.fetch.bind(window)
  window.fetch = function(input, init) {
    init = init || {}
    init.headers = new Headers(init.headers || {})
    try {
      const u = JSON.parse(localStorage.getItem('hay_current_user') || 'null')
      if (u && u.username) init.headers.set('X-Username', u.username)
    } catch {}
    return _origFetch(input, init)
  }
})()

const api = (path, params) => {
  // 起止默认值改成跟 RAW 对齐，不再写死 '2026-04-15'
  const s = params?.start || RAW.launch_date || RAW.data_end
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
