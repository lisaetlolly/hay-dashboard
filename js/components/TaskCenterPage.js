// ── TaskCenterPage.js ───────────────────────────────────────
// 「任务中心」独立页（投放面板旧任务清单保留，不动）。
// 规则：
//   · 每个单品默认恒有 9 个任务；未发布=灰色占位，每行有「发布」按钮，点了即建任务→变黑、记发布时间
//   · 9 个之外 = 临时任务（紫色「临时」标）
//   · 任务行显示发布时间(created_at)；已完成显示完成时间(completed_at)
//   · 进度跟随：显示「截至所看周的最新状态」；上周没完成→本周延续(进行中)；本周新建→红点
//   · 默认停在「上周数据」周（=数据截止周，本周任务依据）；左右滑/←→/日历 切周
//   · 两种看法：卡片（所有单品竖排，可下拉/‹›定位）/ 总览（25×9 矩阵）
//   · 指标=该周；环比=对比上一周（默认即 上周 vs 上上周），数值带 ▲▼ + 上上周原值
const TaskCenterPage = defineComponent({
  name: 'TaskCenterPage',
  setup() {
    const pad = n => String(n).padStart(2, '0')
    const fmtISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const parseISO = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d) }
    const mondayOf = (input) => { const d = input instanceof Date ? new Date(input) : parseISO(input); const dow = d.getDay() || 7; d.setDate(d.getDate() - dow + 1); d.setHours(0, 0, 0, 0); return d }
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
    const weekLabel = (mon) => { const s = addDays(mon, 6), m1 = mon.getMonth() + 1, d1 = mon.getDate(), m2 = s.getMonth() + 1, d2 = s.getDate(); return m1 === m2 ? `${m1}月${d1}-${d2}日` : `${m1}月${d1}日-${m2}月${d2}日` }
    const weekRange = (mon) => `${fmtISO(mon)} ~ ${fmtISO(addDays(mon, 6))}`
    const fmtDate = s => { if (!s) return ''; const t = String(s).slice(0, 10); return t.length === 10 ? t.slice(5) : t }

    const statusColor = s => s === '已完成' ? '#138a52' : s === '进行中' ? '#c2790e' : (s === '未确认' || s === '已超时') ? '#e5484d' : '#a1a1aa'
    const STATUS_OPTS = ['待开始', '进行中', '已完成', '未确认']
    // 角色化状态选项：管理员可「发布」(本周新发布任务)+推进；成员只能切「进行中/已完成」
    const statusOpts = computed(() => isAdmin.value ? ['本周新发布任务', '进行中', '已完成', '已超时'] : ['进行中', '已完成'])
    const fmtMoney = v => v >= 10000 ? '¥' + (v / 10000).toFixed(1) + '万' : '¥' + Number(v || 0).toFixed(0)
    const fmtNum = v => Number(v || 0).toLocaleString('zh-CN')
    const fmtPct = v => (Number(v || 0)).toFixed(2) + '%'
    const imgSrc = pid => (APP_STATE.value.imageOverrides || {})[pid] || RAW.img_map?.[pid] || ''

    const me = computed(() => { try { return JSON.parse(localStorage.getItem('hay_current_user') || 'null') } catch { return null } })
    const myPerms = computed(() => { const p = me.value?.permissions; return Array.isArray(p) ? p : [] })
    const isAdmin = computed(() => me.value?.role === 'admin' || myPerms.value.includes('*') || myPerms.value.includes('task.edit_all'))
    const canEditOwn = computed(() => isAdmin.value || myPerms.value.includes('task.edit_own'))
    const isTaskOwner = (task) => {
      if (!me.value) return false
      const display = me.value.display_name || '', owner = task.owner || ''
      if (!owner || !display) return false
      if (owner === display) return true
      const prefix = display.split('（')[0].split('(')[0].trim()
      return prefix.length >= 2 && owner.includes(prefix)
    }
    const canEditTask = (task) => isAdmin.value || (canEditOwn.value && isTaskOwner(task))

    const FALLBACK_TEMPLATES = [
      { id: 'fb_1', category: '标题优化', detail: '结合小红书/淘宝热搜词，优化链接标题', sort_order: 1 },
      { id: 'fb_2', category: '评价与问大家', detail: '梳理每个链接中差评（如有），分类问题', sort_order: 2 },
      { id: 'fb_3', category: '评价与问大家', detail: '针对共性问题，制作3条带图/视频好评进行覆盖', sort_order: 3 },
      { id: 'fb_4', category: '评价与问大家', detail: '优化问大家回复', sort_order: 4 },
      { id: 'fb_5', category: '淘内内容宣发', detail: '光合内容制作、上线', sort_order: 5 },
      { id: 'fb_6', category: '详情页优化', detail: '迭代初版详情页', sort_order: 6 },
      { id: 'fb_7', category: '竞品分析', detail: '竞品动作关注、价格策略调整', sort_order: 7 },
      { id: 'fb_8', category: '妈妈计划迭代', detail: '确认推广金额及提出素材需求', sort_order: 8 },
      { id: 'fb_9', category: '售卖复盘', detail: '对流量、收藏加购情况做分析', sort_order: 9 },
    ]

    const earliestMon = computed(() => { let min = null; for (const p of Object.values(RAW.products || {})) { const ds = p.dates || []; if (ds.length && (!min || ds[0] < min)) min = ds[0] } return mondayOf(min || RAW.launch_date || fmtISO(new Date())) })
    // 「当前操作周」：持久化在 APP_STATE.taskOpWeek，点「进入下一周」+7；默认本日历周。
    // 任务的 本周新发布/❗/已完成灰 都相对这个周算（点一下进入下一周即完成状态推进，不复制任务行）。
    const opMon = () => { const s = APP_STATE.value && APP_STATE.value.taskOpWeek; try { return s ? mondayOf(String(s)) : mondayOf(fmtISO(new Date())) } catch { return mondayOf(fmtISO(new Date())) } }
    const latestMon = computed(() => opMon())

    const view = ref(isAdmin.value ? 'card' : 'mine')   // 'mine' 我的 | 'card' 卡片 | 'global' 总览
    const selMon = ref(latestMon.value)
    const skuIdx = ref(0)
    const showCal = ref(false)
    const extraGroups = ref([])

    const atEarliest = computed(() => fmtISO(selMon.value) <= fmtISO(earliestMon.value))
    const atLatest = computed(() => fmtISO(selMon.value) >= fmtISO(latestMon.value))
    const selLabel = computed(() => weekLabel(selMon.value))
    const selRange = computed(() => weekRange(selMon.value))
    // 指标数据周 = 选中周的上一周（上周数据·本周依据）
    const metricRange = computed(() => weekRange(addDays(selMon.value, -7)))
    // 只列「数据周(选中周的上一周)有数据」的周；范围显示数据周，和顶部一致
    const calWeeks = computed(() => {
      const out = []; const stop = fmtISO(earliestMon.value)
      const dEnd = RAW.data_end ? fmtISO(mondayOf(RAW.data_end)) : fmtISO(latestMon.value)
      let c = new Date(latestMon.value); let g = 0
      while (fmtISO(c) >= stop && g++ < 200) {
        const dm = addDays(c, -7)
        if (fmtISO(dm) >= stop && fmtISO(dm) <= dEnd) out.push({ iso: fmtISO(c), label: weekLabel(c), range: '数据 ' + weekRange(dm) })
        c = addDays(c, -7)
      }
      return out
    })

    const weekCache = ref({})
    const curWeek = computed(() => weekCache.value[fmtISO(selMon.value)] || { groups: [], templates: FALLBACK_TEMPLATES, loading: true })
    const loadWeek = async (mon, force = false) => {
      const iso = fmtISO(mon)
      if (!force && weekCache.value[iso] && !weekCache.value[iso].error) return
      weekCache.value[iso] = { ...(weekCache.value[iso] || { groups: [], templates: FALLBACK_TEMPLATES }), loading: true, error: null }
      try {
        // 「上周数据·本周依据」：选中第 W 周，指标拉 W 的【上一周】(W-7)；任务清单是 flat 的、与周无关。
        const metricMon = fmtISO(addDays(mon, -7))
        const res = await fetch(`/api/tasks/with-metrics?week_start=${metricMon}&_=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const data = await res.json()
        weekCache.value[iso] = { groups: data.groups || [], templates: (data.task_templates && data.task_templates.length ? data.task_templates : FALLBACK_TEMPLATES), loading: false, error: null }
      } catch (e) { weekCache.value[iso] = { groups: [], templates: FALLBACK_TEMPLATES, loading: false, error: e.message } }
    }

    const columns = computed(() => {
      const tpls = [...(curWeek.value.templates || FALLBACK_TEMPLATES)].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      const cc = {}; tpls.forEach(t => cc[t.category] = (cc[t.category] || 0) + 1)
      return tpls.map(t => ({ key: (t.category || '') + '||' + (t.detail || ''), category: t.category || '', detail: t.detail || '', label: cc[t.category] > 1 ? (t.detail || t.category).slice(0, 6) : t.category, title: `${t.category}｜${t.detail}` }))
    })

    const groups = computed(() => {
      const out = (curWeek.value.groups || []).map(g => ({
        pid: g.product_id, name: g.product_name && g.product_name !== g.product_id ? g.product_name : (RAW.short_names?.[g.product_id] || g.product_id),
        image: imgSrc(g.product_id), tasks: g.tasks || [], metrics: g.current_metrics || {}, prev: g.prev_metrics || {}, diff: g.diff_pct || {},
      }))
      const have = new Set(out.map(g => g.pid))
      // 新增单品：从 RAW 拉该商品当周指标（数据同步）
      for (const eg of extraGroups.value) if (!have.has(eg.pid)) out.push({ ...eg, metrics: weekMetricsFromRaw(eg.pid), diff: {} })
      // 删除单品卡片：过滤掉本地已隐藏的
      const filtered = hiddenPids.value.length ? out.filter(g => !hiddenPids.value.includes(g.pid)) : out
      // 排序：有"最新发布任务"的单品排前面（按任务 created_at 最大值降序）
      const lastTs = g => (g.tasks || []).reduce((m, t) => { const ts = Date.parse(t.created_at || t.updated_at || 0) || 0; return ts > m ? ts : m }, 0)
      filtered.sort((a, b) => lastTs(b) - lastTs(a))
      return filtered
    })
    const curSku = computed(() => groups.value[Math.min(skuIdx.value, Math.max(0, groups.value.length - 1))] || null)
    const cardRows = computed(() => curSku.value ? rowsFor(curSku.value) : [])
    const visibleCards = computed(() => view.value === 'card' ? groups.value : [])
    // 「我的」收件区：当前账号负责的任务（跨单品，本周），未读优先
    const myTasks = computed(() => {
      const out = []
      for (const g of groups.value) for (const t of (g.tasks || [])) if (t.mine) { t._pid = g.pid; out.push({ t, prod: g.name }) }
      out.sort((a, b) => ((b.t.unread ? 1 : 0) - (a.t.unread ? 1 : 0)) || String(a.prod).localeCompare(String(b.prod)))
      return out
    })
    const myUnreadCount = computed(() => myTasks.value.filter(x => x.t.unread).length)

    // 行 = 9 默认（真任务或灰色占位） + 临时任务
    const rowsFor = (g) => {
      const tasks = g.tasks || []; const used = new Set()
      const defaults = columns.value.map(col => {
        const t = tasks.find(x => (x.category || '') === col.category && (x.detail || '') === col.detail)
        if (t) { t._pid = g.pid; used.add(t); return t }
        return { id: null, _pid: g.pid, category: col.category, detail: col.detail, owner: '', status: '待开始', _placeholder: true }
      })
      const temps = tasks.filter(t => !used.has(t)).map(t => { t._pid = g.pid; t._temp = true; return t })
      return [...defaults, ...temps]
    }
    const taskOf = (g, col) => (g.tasks || []).find(t => (t.category || '') === col.category && (t.detail || '') === col.detail) || null
    const statusOf = (g, col) => { const t = taskOf(g, col); return t ? (t.status || '待开始') : '待开始' }
    const cellNew = (g, col) => { const t = taskOf(g, col); return !!(t && t.is_new) }
    const timeText = (task) => {
      if (!task.id) return ''
      if (task.status === '已完成') return '✓完成 ' + (fmtDate(task.completed_at) || fmtDate(task.eta_date) || '')
      return '发布 ' + (fmtDate(task.created_at) || fmtDate(task.start_date) || '')
    }

    const METRIC_DEFS = [
      { k: 'gmv', label: '销售金额', fmt: fmtMoney }, { k: 'cart', label: '加购量', fmt: fmtNum },
      { k: 'cart_rate', label: '加购率', fmt: fmtPct }, { k: 'pay_cvr', label: '支付转化率', fmt: fmtPct },
      { k: 'ctr', label: 'CTR', fmt: fmtPct }, { k: 'spend', label: '花费', fmt: fmtMoney },
      { k: 'dwell_time', label: '停留时长', fmt: v => Number(v || 0).toFixed(0) + 's' }, { k: 'vis', label: '访客数', fmt: fmtNum },
    ]
    const metricsFor = (g) => METRIC_DEFS.map(d => {
      const v = g.metrics[d.k], pv = (g.prev || {})[d.k], dv = g.diff[d.k]
      return { label: d.label, val: (v == null ? '/' : d.fmt(v)), prev: (pv == null ? '—' : d.fmt(pv)), deltaAbs: dv == null ? '' : Math.abs(dv).toFixed(1) + '%', up: dv != null && dv >= 0, has: dv != null }
    })

    // ── 一比一复刻投放面板卡片：10 指标(5列×2行) + 格式（与 AdsPage 同口径）──
    const taskMetricDefs = [
      { k: 'gmv', l: '销售金额', fmt: 'money' }, { k: 'cart', l: '加购量', fmt: 'num' },
      { k: 'cart_rate', l: '加购率', fmt: 'pct' }, { k: 'pay_cvr', l: '支付转化率', fmt: 'pct' },
      { k: 'ctr', l: 'CTR', fmt: 'pct' }, { k: 'spend', l: '花费', fmt: 'money' },
      { k: 'dwell_time', l: '停留时长', fmt: 'sec' }, { k: 'content_visits', l: '光合渠道流量', fmt: 'num' },
      { k: 'xhs_count', l: '笔记发布量', fmt: 'num' }, { k: 'vis', l: '访客数', fmt: 'num' },
    ]
    const fmtMetric = (v, type) => {
      if (v == null) return '/'
      const n = Number(v)
      if (!isFinite(n) || n === 0) return '/'
      if (type === 'money') return n >= 10000 ? '¥' + (n / 10000).toFixed(1) + '万' : '¥' + n.toFixed(0)
      if (type === 'pct') return n.toFixed(2) + '%'
      if (type === 'sec') return n.toFixed(0) + 's'
      return n.toLocaleString('zh-CN')
    }
    const fmtDiffPct = v => v == null ? '' : (v > 0 ? '+' : '') + Number(v).toFixed(1) + '%'
    const diffColor = v => v == null ? 'var(--muted)' : v > 0 ? '#138a52' : v < 0 ? '#e5484d' : 'var(--muted)'
    const isDone = s => s === '已完成' || s === '完成'
    const fmtDateShort = s => { if (!s) return '—'; const t = String(s).slice(0, 10); return t.length === 10 ? t.slice(5) : t }
    const fmtNoteTime = s => {
      if (!s) return ''
      const d = new Date(String(s).replace(' ', 'T'))
      if (isNaN(d.getTime())) { const t = String(s); return t.slice(5, 10) + (t.length >= 16 ? ' ' + t.slice(11, 16) : '') }
      const u = new Date(d.getTime() + 8 * 3600 * 1000)  // 统一显示北京时间(+08)
      const p = n => String(n).padStart(2, '0')
      return `${p(u.getUTCMonth() + 1)}-${p(u.getUTCDate())} ${p(u.getUTCHours())}:${p(u.getUTCMinutes())}`
    }
    const noteText = t => t.execution_note || t.note || ''
    // 是否在当前选中周（按日期字符串判断）
    const inSelWeek = (dstr) => { if (!dstr) return false; try { return fmtISO(mondayOf(String(dstr).slice(0, 10))) === fmtISO(selMon.value) } catch { return false } }
    // 是否在选中周的「上一周」
    const inPrevWeek = (dstr) => { if (!dstr) return false; try { const p = new Date(selMon.value); p.setDate(p.getDate() - 7); return fmtISO(mondayOf(String(dstr).slice(0, 10))) === fmtISO(p) } catch { return false } }
    // 「本周新发布 / ❗未跟进」按【真实日历周】判定（跟你正在看哪一周的数据无关）。基准日前的旧底表一律灰、不参与。
    const STALE_BASELINE = '2026-06-08'
    const isPublished = (t) => !!t && String(t.created_at || '').slice(0, 10) >= STALE_BASELINE
    // 「本周/上周」相对【正在看的那一周 selMon】判定：翻到哪周就看哪周的状态（本周新发=红、上周发布没动=❗、上周完成=灰）
    const inThisRealWeek = (dstr) => inSelWeek(dstr)
    const inPrevRealWeek = (dstr) => inPrevWeek(dstr)
    // ❗未跟进 = 已发布 + 待开始 + 上周(真实)发布 + 本周(真实)没改动
    const isStaleUnstarted = (t) => !!t && t.status === '待开始' && isPublished(t)
      && inPrevRealWeek(t.created_at) && !inThisRealWeek(t.updated_at)
    // 状态配色/文字（最终规则）：本周发布新任务=红有字；进行中=橙；本周完成=绿；往期完成/待开始(非本周)/未发布=灰无字
    const statusInfo = (task) => {
      if (!task || !task.id || task._placeholder) return { color: '#c0c5cd', dot: '#dde0e5', label: '' }
      const s = task.status || ''
      if (s === '进行中') return { color: '#c2790e', dot: '#c2790e', label: '进行中' }
      if (s === '已完成') return inSelWeek(task.completed_at) ? { color: '#138a52', dot: '#138a52', label: '已完成' } : { color: '#9ca3af', dot: '#9ca3af', label: '已完成' }
      if (s === '已超时') return { color: '#e5484d', dot: '#e5484d', label: '已超时' }
      if (s === '待开始') {
        if (isPublished(task) && inThisRealWeek(task.created_at)) return { color: '#e5484d', dot: '#e5484d', label: '本周新发布任务' }
        if (isStaleUnstarted(task)) return { color: '#e5484d', dot: '#e5484d', label: '❗未跟进' }
        return { color: '#9ca3af', dot: '#9ca3af', label: '' }
      }
      if (s === '未确认') return { color: '#e5484d', dot: '#e5484d', label: '未确认' }
      return { color: '#9ca3af', dot: '#9ca3af', label: s }
    }
    // 本周新发布任务 → 显示「发布 发布人·月-日 时:分」
    const pubLabel = (task) => {
      if (!task || task.status !== '待开始' || !isPublished(task) || !inThisRealWeek(task.created_at)) return ''
      const who = task.created_by ? task.created_by + '·' : ''
      return '发布 ' + who + fmtDate(task.created_at)
    }
    // 总览单元格：上周遗留没改(待开始非本周)→红❗；本周新发布→红点；进行中→橙；本周完成→绿；往期完成→灰；空→灰
    const cellInfo = (g, col) => {
      const t = taskOf(g, col)
      if (!t || !t.id) return { bg: '#f1f3f6', dot: '#c8cdd5', mark: '' }
      const s = t.status || ''
      if (s === '已超时') return { bg: '#fdecec', dot: '#e5484d', mark: '⏰' }
      if (s === '待开始' && isPublished(t) && inThisRealWeek(t.created_at)) return { bg: '#fdecec', dot: '#e5484d', mark: '' }
      if (s === '待开始') return isStaleUnstarted(t) ? { bg: '#fdecec', dot: '', mark: '❗' } : { bg: '#f1f3f6', dot: '#9ca3af', mark: '' }
      if (s === '进行中') return { bg: '#fef3e3', dot: '#c2790e', mark: '' }
      if (s === '已完成') return inSelWeek(t.completed_at) ? { bg: '#e7f6ef', dot: '#138a52', mark: '' } : { bg: '#f1f3f6', dot: '#9ca3af', mark: '' }
      if (s === '未确认') return { bg: '#fdecec', dot: '#e5484d', mark: '' }
      return { bg: '#f1f3f6', dot: '#9ca3af', mark: '' }
    }
    const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    const renderNote = t => escapeHtml(t).replace(/@([^\s@，,。.；;：:、]{1,20})/g, '<span style="color:#2563eb;font-weight:600">@$1</span>')

    const goWeek = (delta) => { const n = addDays(selMon.value, delta * 7); if (fmtISO(n) < fmtISO(earliestMon.value)) return toast('已到最早数据周'); if (fmtISO(n) > fmtISO(latestMon.value)) return toast('已到最新数据周'); selMon.value = n; loadWeek(n) }
    const pickWeek = (iso) => { selMon.value = parseISO(iso); showCal.value = false; loadWeek(selMon.value) }
    const scrollToCard = (pid) => { nextTick(() => { const el = document.getElementById('tc-card-' + pid); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }) }
    const goSku = (delta) => { const n = skuIdx.value + delta; if (n >= 0 && n < groups.value.length) { skuIdx.value = n; scrollToCard(groups.value[n].pid) } }
    const jumpSku = () => { const g = groups.value[skuIdx.value]; if (g) scrollToCard(g.pid) }

    // ── 内联编辑状态 ────────────────────────────────────
    const editingCell = ref(null)
    const cellDraft = ref('')
    const rowKey = (task) => (task._pid || '') + '||' + (task.category || '') + '||' + (task.detail || '')
    const isEditing = (task, field) => editingCell.value && editingCell.value.key === rowKey(task) && editingCell.value.field === field
    const startEdit = (task, field) => { if (!canEditTask(task)) return; editingCell.value = { key: rowKey(task), field }; cellDraft.value = field === 'note' ? noteText(task) : field === 'status' ? ((task.status === '待开始' || !task.status) ? '本周新发布任务' : task.status) : (task[field] != null ? task[field] : ''); nextTick(() => { const el = document.querySelector(`[data-tc-edit="${rowKey(task)}-${field}"]`); if (el) { el.focus(); el.select && el.select() } }) }
    const cancelEdit = () => { editingCell.value = null }
    const saveEdit = async (task) => {
      const e = editingCell.value; if (!e) return
      const field = e.field; let val = cellDraft.value
      // 「本周新发布任务」是 待开始 的展示别名，落库仍存「待开始」（保持与团队面板一致）
      const wantPublish = (field === 'status' && val === '本周新发布任务')
      if (wantPublish) val = '待开始'
      const g = groups.value.find(x => x.pid === task._pid)
      try {
        // 占位行（本周还没这条任务）→ 编辑即落库（不再要单独「发布」按钮）
        if (!task.id) {
          const body = { product_id: task._pid, category: task.category, detail: task.detail, owner: task.owner || '', status: '待开始', priority: '中', time_range_label: weekRange(selMon.value), start_date: fmtISO(selMon.value), eta_date: fmtISO(addDays(selMon.value, 6)), archive_same: false }
          if (field === 'note') body.execution_note = val; else body[field] = val
          const cr = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          if (!cr.ok) { const er = await cr.json().catch(() => ({})); throw new Error(er.detail || ('HTTP ' + cr.status)) }
          task.id = (await cr.json()).id; task._placeholder = false; task.created_at = new Date().toISOString(); task.is_new = true
          if (field === 'note') { task.execution_note = val; task.note = val } else task[field] = val
          if (g && !(g.tasks || []).includes(task)) g.tasks.push(task)
          editingCell.value = null; return
        }
        const cur = field === 'note' ? noteText(task) : (task[field] || '')
        const valChanged = (val !== cur)
        if (valChanged) {
          const apiField = field === 'note' ? 'execution_note' : field
          const res = await fetch(`/api/tasks/${task.id}?_=${Date.now()}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ [apiField]: val }) })
          if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || ('HTTP ' + res.status)) }
          if (field === 'note') { task.execution_note = val; task.note = val; task.note_by = (me.value && me.value.display_name) || task.note_by }
          else task[field] = val
          if (field === 'status') task.completed_at = (val === '已完成') ? (task.completed_at || new Date().toISOString()) : null
        }
        // 选「本周新发布任务」：状态落「待开始」之外，还要把发布时间(created_at)重置为现在，
        // 否则旧 created_at 不在本周/早于基准日 → statusInfo 落成灰点（chen 反馈的 bug）。
        if (wantPublish) {
          const rp = await fetch(`/api/tasks/${task.id}/republish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' })
          if (!rp.ok) { const e2 = await rp.json().catch(() => ({})); throw new Error(e2.detail || ('HTTP ' + rp.status)) }
          task.created_at = new Date().toISOString(); task.status = '待开始'; task.completed_at = null
        }
        editingCell.value = null
      } catch (err) { alert('保存失败：' + err.message); editingCell.value = null }
    }
    // ── 备注 @提醒 自动补全 ──
    const mentionNames = ref([])
    const loadMentionNames = async () => {
      try {
        const r = await fetch('/api/owner-names?_=' + Date.now(), { cache: 'no-store' })
        if (r.ok) {
          const arr = await r.json(); const set = new Set()
          for (const n of (arr || [])) { const p = String(n).split('（')[0].split('(')[0].trim(); if (p) set.add(p) }
          mentionNames.value = [...set]
        }
      } catch (e) { }
      if (!mentionNames.value.length) mentionNames.value = ['晓东', '豆豆', 'Jas team', '李越']
    }
    const mention = ref({ show: false, items: [], idx: 0, start: 0, caret: 0 })
    const closeMention = () => { mention.value = { show: false, items: [], idx: 0, start: 0, caret: 0 } }
    const onNoteInput = (task, ev) => {
      const el = ev.target, val = el.value, caret = el.selectionStart != null ? el.selectionStart : val.length
      const m = val.slice(0, caret).match(/@([^\s@，,。.；;：:、]{0,20})$/)
      if (!m) { closeMention(); return }
      const q = m[1].toLowerCase()
      const items = mentionNames.value.filter(n => !q || n.toLowerCase().includes(q)).slice(0, 6)
      if (!items.length) { closeMention(); return }
      mention.value = { show: true, items, idx: 0, start: caret - m[0].length, caret }
    }
    const pickMention = (task, name) => {
      const val = cellDraft.value || '', s = mention.value.start, c = mention.value.caret
      cellDraft.value = val.slice(0, s) + '@' + name + ' ' + val.slice(c)
      closeMention()
      nextTick(() => { const el = document.querySelector(`[data-tc-edit="${rowKey(task)}-note"]`); if (el) { el.focus(); const pos = s + name.length + 2; try { el.setSelectionRange(pos, pos) } catch (e) { } } })
    }
    const onNoteKeydown = (task, ev) => {
      const md = mention.value
      if (md.show && md.items.length) {
        if (ev.key === 'ArrowDown') { ev.preventDefault(); mention.value.idx = (md.idx + 1) % md.items.length; return }
        if (ev.key === 'ArrowUp') { ev.preventDefault(); mention.value.idx = (md.idx - 1 + md.items.length) % md.items.length; return }
        if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); pickMention(task, md.items[md.idx]); return }
        if (ev.key === 'Escape') { ev.preventDefault(); closeMention(); return }
      }
      if (ev.key === 'Enter') saveEdit(task)
      else if (ev.key === 'Escape') cancelEdit()
    }
    // 取消发布：发布时间设回基准日前 → 显示为未发布(灰)，任务保留
    const unpublishTask = async (task) => {
      if (!task.id || !canEditTask(task)) return
      if (!confirm('取消发布这条任务？会变回「未发布(灰)」，任务保留、不删除。')) return
      try {
        const res = await fetch(`/api/tasks/${task.id}/unpublish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' })
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || ('HTTP ' + res.status)) }
        task.created_at = '2000-01-01T00:00:00+08:00'
      } catch (err) { alert('取消发布失败：' + err.message) }
    }
    // 清除备注（只清备注文字/图片/附件，不删任务）
    const clearNote = async (task) => {
      if (!task.id || !canEditTask(task)) return
      if (!confirm('清除这条任务的备注？')) return
      try {
        const res = await fetch(`/api/tasks/${task.id}?_=${Date.now()}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ execution_note: '' }) })
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || ('HTTP ' + res.status)) }
        task.execution_note = ''; task.note = ''; task.note_by = ''; task.note_at = null
      } catch (err) { alert('清除失败：' + err.message) }
    }
    // 删除单条任务行
    const deleteTaskRow = async (task) => {
      if (!task.id || !isAdmin.value) return
      if (!confirm('确认删除任务「' + (task.detail || '') + '」？')) return
      const g = groups.value.find(x => x.pid === task._pid)
      try {
        const res = await fetch(`/api/tasks/${task.id}?_=${Date.now()}`, { method: 'DELETE', cache: 'no-store' })
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || ('HTTP ' + res.status)) }
        if (g) g.tasks = (g.tasks || []).filter(t => t.id !== task.id)
      } catch (err) { alert('删除失败：' + err.message) }
    }
    // 删除整张单品卡片（隐藏该商品）
    const hiddenPids = ref([])
    const deleteCard = async (g) => {
      if (!isAdmin.value) return alert('仅管理员可删除单品')
      if (!confirm('确认从爆款孵化移除单品「' + g.name + '」？（隐藏，不删任务数据）')) return
      try {
        const res = await fetch('/api/products/hide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: g.pid, hidden: true }) })
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || ('HTTP ' + res.status)) }
        if (!hiddenPids.value.includes(g.pid)) hiddenPids.value.push(g.pid)
        extraGroups.value = extraGroups.value.filter(x => x.pid !== g.pid)
        toast('已移除「' + g.name + '」')
      } catch (err) { alert('删除失败：' + err.message) }
    }
    // 一键复制：归档本周·开下周
    const rolloverWeek = async () => {
      if (!isAdmin.value) return alert('仅管理员可复制')
      if (!confirm('把本周任务复制一份作为「下周底表」（状态重置为待开始），本周作为快照保留。确认？')) return
      try {
        const res = await fetch('/api/tasks/rollover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ week_start: fmtISO(selMon.value) }) })
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || ('HTTP ' + res.status)) }
        const d = await res.json()
        toast('已生成下周底表（' + (d.created || 0) + ' 条）')
        if (d.next_week_start) { selMon.value = parseISO(d.next_week_start); await loadWeek(selMon.value, true) }
      } catch (err) { alert('复制失败：' + err.message) }
    }
    // 进入下一周：只把「当前操作周」指针 +7 并持久化，不复制/不删任何任务行。
    // 效果：上周已完成→灰、上周发布没动→❗、之后新发布→本周新发布。
    const advanceWeek = () => {
      if (!isAdmin.value) return alert('仅管理员可进入下一周')
      const next = fmtISO(addDays(opMon(), 7))
      if (!confirm('进入下一周（' + weekLabel(parseISO(next)) + '）？\n\n· 上周已完成 → 变灰\n· 上周发布了但没动 → 变 ❗\n· 之后新发布 → 本周新发布\n\n不复制、不删任务，只推进周指针（可点"回上周"撤回）。')) return
      if (!APP_STATE.value) return
      APP_STATE.value.taskOpWeek = next
      try { persistAppState() } catch (e) { }
      selMon.value = parseISO(next); loadWeek(selMon.value, true)
      toast('已进入下一周：' + weekLabel(parseISO(next)))
    }
    // 新增单品：从 RAW.products 客户端算该商品当周指标（数据同步）
    const weekMetricsFromRaw = (pid) => {
      const p = RAW.products && RAW.products[pid]
      if (!p || !p.dates) return {}
      const mon = fmtISO(selMon.value), sun = fmtISO(addDays(selMon.value, 6))
      let gmv = 0, vis = 0, cart = 0, spend = 0, ctrS = 0, ctrN = 0, payb = 0
      for (let i = 0; i < p.dates.length; i++) {
        const d = p.dates[i]
        if (d >= mon && d <= sun) {
          gmv += (p.pay && p.pay[i]) || 0; vis += (p.vis && p.vis[i]) || 0
          cart += (p.cart && p.cart[i]) || 0; spend += (p.spend && p.spend[i]) || 0
          payb += (p.pay_buyers && p.pay_buyers[i]) || 0
          if (p.ctr && p.ctr[i] > 0) { ctrS += p.ctr[i] * 100; ctrN++ }
        }
      }
      return { gmv, vis, cart, spend, ctr: ctrN ? +(ctrS / ctrN).toFixed(2) : 0, cart_rate: vis ? +(cart / vis * 100).toFixed(2) : 0, pay_cvr: vis ? +(payb / vis * 100).toFixed(2) : 0 }
    }
    // 批量改时间（整张卡片所有任务统一起止日）
    const batchTimeModal = ref({ show: false, pid: '', name: '', start: '', end: '', saving: false })
    const openBatchTime = (g) => { if (!isAdmin.value) return alert('仅管理员可批量改时间'); batchTimeModal.value = { show: true, pid: g.pid, name: g.name, start: fmtISO(selMon.value), end: fmtISO(addDays(selMon.value, 6)), saving: false } }
    const saveBatchTime = async () => {
      const m = batchTimeModal.value
      const g = groups.value.find(x => x.pid === m.pid); if (!g) { m.show = false; return }
      const real = (g.tasks || []).filter(t => t.id)
      if (!real.length) { m.show = false; return alert('该单品本周还没有已发布的任务') }
      m.saving = true
      try {
        for (const t of real) {
          await fetch(`/api/tasks/${t.id}?_=${Date.now()}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ start_date: m.start, eta_date: m.end }) })
          t.start_date = m.start; t.eta_date = m.end
        }
        m.show = false; toast('已批量更新时间')
      } catch (err) { alert('批量改时间失败：' + err.message) } finally { m.saving = false }
    }

    // ── 新增任务 / 新增单品 ──────────────────────────────
    const addTaskModal = ref({ show: false, pid: '', category: '', detail: '', owner: '', saving: false })
    const ownerOptions = computed(() => { const s = new Set(); for (const g of groups.value) for (const t of (g.tasks || [])) if (t.owner) s.add(t.owner); return [...s] })
    const catOptions = computed(() => [...new Set(columns.value.map(c => c.category))])
    const openAddTask = (pid) => { if (!isAdmin.value) return alert('仅管理员可新增任务'); const p = pid || (curSku.value && curSku.value.pid) || (groups.value[0] && groups.value[0].pid); addTaskModal.value = { show: true, pid: p || '', category: '', detail: '', owner: '', saving: false } }
    const saveAddTask = async () => {
      const m = addTaskModal.value
      if (!m.pid) return alert('请选择单品')
      if (!m.category.trim() || !m.detail.trim()) return alert('请填任务标签 + 任务名称')
      m.saving = true
      try {
        const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: m.pid, category: m.category.trim(), detail: m.detail.trim(), owner: m.owner.trim(), status: '待开始', priority: '中', time_range_label: weekRange(selMon.value), start_date: fmtISO(selMon.value), eta_date: fmtISO(addDays(selMon.value, 6)), archive_same: false }) })
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || ('HTTP ' + res.status)) }
        m.show = false; await loadWeek(selMon.value, true)
      } catch (err) { alert('新增失败：' + err.message) } finally { m.saving = false }
    }
    const addSkuModal = ref({ show: false, pid: '', name: '' })
    const availableProducts = computed(() => { const have = new Set(groups.value.map(g => g.pid)); return Object.values(RAW.products || {}).filter(p => !have.has(p.pid)).map(p => ({ pid: p.pid, name: p.name || RAW.short_names?.[p.pid] || p.pid })) })
    const openAddSku = () => { if (!isAdmin.value) return alert('仅管理员可新增单品'); addSkuModal.value = { show: true, pid: '', name: '' } }
    const saveAddSku = () => {
      const m = addSkuModal.value, pid = (m.pid || '').trim()
      if (!pid) return alert('请选择或填写单品 PID')
      if (groups.value.some(g => g.pid === pid)) { addSkuModal.value.show = false; return alert('该单品已在列表中') }
      const name = (m.name || '').trim() || RAW.short_names?.[pid] || (RAW.products?.[pid]?.name) || pid
      extraGroups.value.push({ pid, name, image: imgSrc(pid), tasks: [], metrics: {}, prev: {}, diff: {} })
      addSkuModal.value.show = false; skuIdx.value = groups.value.length - 1; view.value = 'card'
      nextTick(() => scrollToCard(pid)); toast('已加入「' + name + '」，9 个默认任务已就位，逐行点「发布」启用')
    }

    // ── 红点(未读) ──────────────────────────────────────
    // 红点只对"该任务负责人本人"亮（后端按 owner_link/姓名判定 unread）；点任务名即清。
    const cellUnread = (g, col) => { const t = taskOf(g, col); return !!(t && t.unread) }
    const markSeen = async (task) => {
      if (!task || !task.id || !task.unread) return
      task.unread = false
      try { await fetch(`/api/tasks/${task.id}/seen?_=${Date.now()}`, { method: 'POST', cache: 'no-store' }) } catch (_) { }
    }
    const onCell = (g, col) => { const t = taskOf(g, col); if (t && t.unread) markSeen(t); const i = groups.value.findIndex(x => x.pid === g.pid); if (i >= 0) { skuIdx.value = i; view.value = 'card'; scrollToCard(g.pid) } }

    // ── 负责人 ↔ 账号 关联（设置红点归属）──────────────────
    const ownerLinkModal = ref({ show: false, names: [], users: [], links: {}, loading: false })
    const openOwnerLinks = async () => {
      if (!isAdmin.value) return alert('仅管理员可关联人员')
      ownerLinkModal.value = { show: true, names: [], users: [], links: {}, loading: true }
      try {
        const [nm, lk, us] = await Promise.all([
          fetch('/api/owner-names?_=' + Date.now(), { cache: 'no-store' }).then(r => r.json()),
          fetch('/api/owner-links?_=' + Date.now(), { cache: 'no-store' }).then(r => r.json()),
          fetch('/api/users?_=' + Date.now(), { cache: 'no-store' }).then(r => r.json()),
        ])
        const links = {}; for (const l of (lk || [])) links[l.owner_name] = l.user_id
        // 把任务里出现过、但 owner-names 接口没返的也补上（兜底用当前已加载分组里的 owner）
        const set = new Set(nm || [])
        for (const g of groups.value) for (const t of (g.tasks || [])) if (t.owner) set.add(t.owner)
        ownerLinkModal.value = { show: true, names: [...set].sort(), users: us || [], links, loading: false }
      } catch (e) { ownerLinkModal.value = { ...ownerLinkModal.value, loading: false }; alert('加载失败：' + e.message) }
    }
    const setOwnerLink = async (name, uid) => {
      const v = uid === '' || uid == null ? null : Number(uid)
      ownerLinkModal.value.links[name] = v
      try {
        const res = await fetch('/api/owner-links', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner_name: name, user_id: v }) })
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || ('HTTP ' + res.status)) }
        toast('已更新关联')
      } catch (err) { alert('保存失败：' + err.message) }
    }

    const toastMsg = ref(''); let toastTimer = null
    const toast = (m) => { toastMsg.value = m; clearTimeout(toastTimer); toastTimer = setTimeout(() => toastMsg.value = '', 1800) }
    let dragX = null
    const onDown = (ev) => { if (ev.target.closest('select,button,input,a,.tc-cell,.tc-scroll,.tc-modal')) return; dragX = ev.clientX }
    const onUp = (ev) => { if (dragX == null) return; const dx = ev.clientX - dragX; dragX = null; if (Math.abs(dx) > 70) goWeek(dx < 0 ? 1 : -1) }
    const onKey = (ev) => { if (['INPUT', 'SELECT', 'TEXTAREA'].includes(ev.target.tagName)) return; if (ev.key === 'ArrowLeft') goWeek(-1); if (ev.key === 'ArrowRight') goWeek(1) }
    const onDocClick = (e) => { if (!e.target.closest('.tc-weeknav')) showCal.value = false }
    const loadHidden = async () => { try { const r = await fetch('/api/products/hidden?_=' + Date.now(), { cache: 'no-store' }); if (r.ok) hiddenPids.value = await r.json() } catch (_) { } }
    onMounted(() => { loadWeek(selMon.value); loadHidden(); loadMentionNames(); window.addEventListener('keydown', onKey); window.addEventListener('pointerup', onUp); document.addEventListener('click', onDocClick) })
    Vue.onUnmounted && Vue.onUnmounted(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerup', onUp); document.removeEventListener('click', onDocClick) })

    return {
      view, selMon, selLabel, selRange, metricRange, skuIdx, showCal, calWeeks, atEarliest, atLatest, curWeek,
      columns, groups, curSku, cardRows, visibleCards, myTasks, myUnreadCount, rowsFor, metricsFor, statusOf, taskOf, cellUnread, markSeen, timeText, statusColor, STATUS_OPTS, statusOpts,
      taskMetricDefs, fmtMetric, fmtDiffPct, diffColor, isDone, fmtDateShort, fmtNoteTime, noteText, renderNote, clearNote, unpublishTask,
      goWeek, pickWeek, goSku, jumpSku, onCell, statusInfo, cellInfo, deleteTaskRow,
      deleteCard, rolloverWeek, advanceWeek, batchTimeModal, openBatchTime, saveBatchTime,
      ownerLinkModal, openOwnerLinks, setOwnerLink,
      isAdmin, canEditTask, editingCell, cellDraft, isEditing, startEdit, cancelEdit, saveEdit, rowKey,
      mention, onNoteInput, onNoteKeydown, pickMention, pubLabel,
      addTaskModal, openAddTask, saveAddTask, catOptions, ownerOptions, addSkuModal, openAddSku, saveAddSku, availableProducts,
      toastMsg, onDown,
    }
  },
  template: `
<div style="position:relative" @pointerdown="onDown">

  <div style="position:sticky;top:0;z-index:60;background:var(--surface);display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;margin:0 0 10px;border-bottom:1px solid var(--border);box-shadow:0 4px 10px -4px rgba(0,0,0,.16)">
    <div style="display:inline-flex;background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:3px;gap:2px">
      <button v-for="opt in [['mine','我的'],['card','卡片'],['global','总览']]" :key="opt[0]" @click="view=opt[0]"
        :style="{position:'relative',padding:'6px 16px',fontSize:'13px',fontWeight:'600',border:'none',borderRadius:'7px',cursor:'pointer',background:view===opt[0]?'var(--surface)':'transparent',color:view===opt[0]?'var(--text)':'var(--muted)',boxShadow:view===opt[0]?'0 1px 2px rgba(0,0,0,.08)':'none'}">{{ opt[1] }}<span v-if="opt[0]==='mine' && myUnreadCount" style="margin-left:5px;font-size:10px;background:#e5484d;color:#fff;border-radius:9px;padding:0 5px;font-weight:700">{{ myUnreadCount }}</span></button>
    </div>

    <div class="tc-weeknav" style="position:relative;display:flex;align-items:center;gap:2px;background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:3px">
      <button @click="goWeek(-1)" :disabled="atEarliest" :style="{width:'28px',height:'28px',border:'none',background:'transparent',borderRadius:'6px',cursor:atEarliest?'not-allowed':'pointer',color:'var(--muted)',fontSize:'15px',opacity:atEarliest?0.3:1}">‹</button>
      <div @click.stop="showCal=!showCal" style="min-width:158px;text-align:center;cursor:pointer;border-radius:6px;padding:2px 8px" title="点击用日历选周">
        <div style="font-size:13px;font-weight:700;line-height:1.2">{{ selLabel }}<span v-if="atLatest" style="margin-left:5px;font-size:10px;font-weight:600;color:var(--accent);background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0 4px">上周数据·本周依据</span></div>
        <div style="font-size:10px;color:var(--muted)">数据 {{ metricRange }}</div>
      </div>
      <button @click="atLatest ? advanceWeek() : goWeek(1)" :title="atLatest ? '进入下一周（上周完成→灰、发布没动→❗、新发布→红）' : '下一周'" :style="{width:'28px',height:'28px',border:'none',background:atLatest?'var(--accent)':'transparent',borderRadius:'6px',cursor:'pointer',color:atLatest?'#fff':'var(--muted)',fontSize:'15px',fontWeight:atLatest?'700':'400'}">{{ atLatest ? '+' : '›' }}</button>
      <button @click.stop="showCal=!showCal" title="日历选周" style="width:28px;height:28px;border:none;background:transparent;border-radius:6px;cursor:pointer;color:var(--muted)">📅</button>
      <div v-if="showCal" style="position:absolute;top:42px;left:0;width:230px;max-height:280px;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.16);padding:6px;z-index:50">
        <div style="font-size:11px;color:var(--muted);padding:4px 8px">选择数据周</div>
        <div v-for="w in calWeeks" :key="w.iso" @click="pickWeek(w.iso)" style="display:flex;justify-content:space-between;align-items:center;padding:7px 9px;border-radius:7px;cursor:pointer;font-size:12px" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background='transparent'"><span>{{ w.label }}</span><span style="color:var(--muted);font-size:10px">{{ w.range }}</span></div>
      </div>
    </div>

    <template v-if="view==='card'">
      <select v-model="skuIdx" @change="jumpSku" style="border:1px solid var(--border);border-radius:7px;padding:6px 8px;font-size:12px;background:var(--surface);color:var(--text);cursor:pointer;max-width:200px">
        <option v-for="(g,i) in groups" :key="g.pid" :value="i">{{ i+1 }}. {{ g.name }}</option>
      </select>
      <button @click="goSku(-1)" :disabled="skuIdx<=0" :style="{width:'28px',height:'28px',border:'1px solid var(--border)',background:'var(--surface)',borderRadius:'7px',cursor:skuIdx<=0?'not-allowed':'pointer',color:'var(--muted)',opacity:skuIdx<=0?0.4:1}">‹</button>
      <button @click="goSku(1)" :disabled="skuIdx>=groups.length-1" :style="{width:'28px',height:'28px',border:'1px solid var(--border)',background:'var(--surface)',borderRadius:'7px',cursor:skuIdx>=groups.length-1?'not-allowed':'pointer',color:'var(--muted)',opacity:skuIdx>=groups.length-1?0.4:1}">›</button>
    </template>

    <button v-if="isAdmin" @click="openAddSku" style="padding:6px 12px;font-size:12px;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:7px;cursor:pointer;font-weight:600">+ 新增单品</button>
    <span v-if="curWeek.loading" style="font-size:11px;color:var(--accent)">加载中…</span>
    <span v-else-if="curWeek.error" style="font-size:11px;color:#e5484d">加载失败：{{ curWeek.error }}</span>
  </div>
  <div style="font-size:11px;color:var(--muted);margin-bottom:12px">指标为该周数据，环比对比上一周；任务状态与团队面板同一份、翻周不变；灰色=未发布，点「发布」启用；左右滑 / ‹ › / 日历 切周</div>

  <!-- 我的（任务查收区）-->
  <div v-if="view==='mine'">
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <span style="font-size:14px;font-weight:700">我的任务</span>
        <span style="font-size:12px;color:var(--muted)">{{ selLabel }} · 共 {{ myTasks.length }} 条<template v-if="myUnreadCount">，<span style="color:#e5484d;font-weight:600">{{ myUnreadCount }} 条未读</span></template></span>
      </div>
      <div v-if="!myTasks.length" style="padding:40px;text-align:center;color:var(--muted);font-size:13px">该周没有分配给你的任务。<span style="font-size:11px">（负责人需在「关联人员」里关联到你的账号，红点才认人）</span></div>
      <div v-else>
        <div style="display:grid;grid-template-columns:150px 110px 1fr 100px 132px;background:var(--bg);font-size:12px;color:var(--muted);font-weight:600">
          <div style="padding:8px 12px;border-right:1px solid var(--border)">单品</div>
          <div style="padding:8px 12px;border-right:1px solid var(--border)">任务标签</div>
          <div style="padding:8px 12px;border-right:1px solid var(--border)">任务名称</div>
          <div style="padding:8px 12px;border-right:1px solid var(--border)">状态</div>
          <div style="padding:8px 12px">发布/完成时间</div>
        </div>
        <div v-for="it in myTasks" :key="it.t._pid+rowKey(it.t)" :style="{display:'grid',gridTemplateColumns:'150px 110px 1fr 100px 132px',borderTop:'1px solid var(--border)',fontSize:'13px',alignItems:'center',background: it.t.unread?'#fff7f6':'transparent'}">
          <div style="padding:9px 12px;border-right:1px solid var(--border);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ it.prod }}</div>
          <div style="padding:9px 12px;border-right:1px solid var(--border)"><span style="font-size:11px;font-weight:600;color:var(--muted);background:var(--bg);padding:3px 8px;border-radius:6px">{{ it.t.category }}</span></div>
          <div style="padding:9px 12px;border-right:1px solid var(--border);display:flex;align-items:center;gap:6px">
            <span :style="{cursor: it.t.unread?'pointer':'default'}" @click="markSeen(it.t)">{{ it.t.detail }}</span>
            <span v-if="it.t.unread" title="未读，点任务名清除" style="width:8px;height:8px;border-radius:50%;background:#e5484d;flex-shrink:0"></span>
            <span v-if="it.t.mentioned" :title="(it.t.mention_by||'有人')+' 在备注里@了你'" style="font-size:10px;color:#2563eb;border:1px solid #bcd0f7;border-radius:4px;padding:0 4px">被@{{ it.t.mention_by? ('·'+it.t.mention_by):'' }}</span>
          </div>
          <div style="padding:7px 10px;border-right:1px solid var(--border)" @click="!isEditing(it.t,'status') && canEditTask(it.t) && startEdit(it.t,'status')" :style="{cursor: canEditTask(it.t)?'pointer':'default'}">
            <select v-if="isEditing(it.t,'status')" v-model="cellDraft" :data-tc-edit="rowKey(it.t)+'-status'" @change="saveEdit(it.t)" @blur="saveEdit(it.t)" @keydown.esc="cancelEdit" style="font-size:11px;border:1px solid var(--accent);border-radius:5px;padding:2px 4px;background:var(--surface);width:100%">
              <option v-for="s in statusOpts" :key="s" :value="s">{{ s }}</option>
            </select>
            <span v-else :style="{fontSize:'12px',fontWeight:'600',display:'flex',alignItems:'center',gap:'5px',color:statusInfo(it.t).color}"><span :style="{width:'7px',height:'7px',borderRadius:'50%',background:statusInfo(it.t).dot,display:'inline-block'}"></span>{{ statusInfo(it.t).label || '—' }}</span>
          </div>
          <div style="padding:7px 12px;font-size:11px" :style="{color: it.t.status==='已完成'?'#138a52':'var(--muted)'}">{{ timeText(it.t) }}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- 卡片：一比一复刻任务清单卡片，所有单品一个个竖排下去；左右滑/‹›/日历 切周 -->
  <div v-else-if="view==='card'">
    <div v-if="!groups.length && !curWeek.loading" class="empty" style="padding:60px;text-align:center;color:var(--muted)">该周暂无单品数据</div>
    <div v-for="g in groups" :key="g.pid + selLabel" :id="'tc-card-'+g.pid" style="border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden;margin-bottom:14px;scroll-margin-top:12px">
      <!-- 商品头部：左图 + 名称/PID + 周期 + 10 指标 -->
      <div style="display:flex;border-bottom:1px solid var(--border)">
        <div style="flex-shrink:0;width:120px;min-height:128px;background:#f3f4f6;position:relative">
          <img v-if="g.image" :src="g.image" style="width:100%;height:100%;min-height:128px;object-fit:cover;display:block">
          <div v-else style="width:120px;min-height:128px;height:100%;display:flex;align-items:center;justify-content:center;color:#c7ccd4;font-size:11px">暂无图片</div>
        </div>
        <div style="flex:1;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
            <div style="min-width:0">
              <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ g.name }}</div>
              <div style="font-size:11px;color:var(--muted)">{{ g.pid }}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <span style="font-size:11px;color:var(--muted)">数据统计 {{ metricRange }}</span>
              <button @click="goWeek(-1)" :disabled="atEarliest" title="上一周" :style="{width:'24px',height:'24px',border:'1px solid var(--border)',background:'var(--surface)',borderRadius:'6px',cursor:atEarliest?'not-allowed':'pointer',color:'var(--muted)',fontSize:'14px',lineHeight:1,opacity:atEarliest?0.35:1}">‹</button>
              <span style="font-size:11px;font-weight:600;color:var(--accent);background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:2px 7px;white-space:nowrap">{{ selLabel }}</span>
              <button @click="goWeek(1)" :disabled="atLatest" title="下一周" :style="{width:'24px',height:'24px',border:'1px solid var(--border)',background:'var(--surface)',borderRadius:'6px',cursor:atLatest?'not-allowed':'pointer',color:'var(--muted)',fontSize:'14px',lineHeight:1,opacity:atLatest?0.35:1}">›</button>
              <button v-if="isAdmin" @click="openAddTask(g.pid)" title="给该单品新增任务" style="margin-left:6px;width:28px;height:28px;font-size:18px;line-height:1;border:1px solid var(--accent);background:var(--surface);color:var(--accent);border-radius:50%;cursor:pointer;font-weight:700;flex-shrink:0">+</button>
              <button v-if="isAdmin" @click="openBatchTime(g)" title="批量改本单品所有任务的起止时间" style="width:28px;height:28px;font-size:13px;line-height:1;border:1px solid var(--border);background:var(--surface);color:var(--muted);border-radius:7px;cursor:pointer;flex-shrink:0">📅</button>
              <button v-if="isAdmin" @click="deleteCard(g)" title="从爆款孵化移除该单品" style="width:28px;height:28px;font-size:15px;line-height:1;border:1px solid #fecaca;background:var(--surface);color:#e5484d;border-radius:7px;cursor:pointer;flex-shrink:0">🗑</button>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px 14px">
            <div v-for="m in taskMetricDefs" :key="m.k" style="display:flex;flex-direction:column;gap:2px;min-width:0">
              <span style="font-size:10px;color:var(--muted)">{{ m.l }}</span>
              <div style="display:flex;align-items:baseline;gap:5px">
                <span style="font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ fmtMetric(g.metrics[m.k], m.fmt) }}</span>
                <span v-if="g.metrics[m.k]!=null && g.metrics[m.k]!==0 && g.diff[m.k]!=null" :style="{fontSize:'10px',fontWeight:'700',color:diffColor(g.diff[m.k])}">{{ fmtDiffPct(g.diff[m.k]) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 任务表头（6 列）-->
      <div style="display:grid;grid-template-columns:96px minmax(0,1.5fr) 130px 96px 128px minmax(0,1.3fr);background:#f8f8f7;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted)">
        <div style="padding:7px 12px;border-right:1px solid var(--border)">任务标签</div>
        <div style="padding:7px 12px;border-right:1px solid var(--border)">任务名称</div>
        <div style="padding:7px 12px;border-right:1px solid var(--border)">负责人</div>
        <div style="padding:7px 12px;border-right:1px solid var(--border)">状态</div>
        <div style="padding:7px 12px;border-right:1px solid var(--border)">时间</div>
        <div style="padding:7px 12px">备注</div>
      </div>
      <!-- 任务行 -->
      <div v-for="(task,ti) in rowsFor(g)" :key="rowKey(task)"
        :style="{display:'grid',gridTemplateColumns:'96px minmax(0,1.5fr) 130px 132px 128px minmax(0,1.3fr)',alignItems:'stretch',fontSize:'13px',borderBottom: ti<rowsFor(g).length-1?'1px solid var(--border)':'none',background: ti%2===0?'#fff':'#fafaf9'}">
        <!-- 任务标签 -->
        <div style="padding:8px 10px;display:flex;align-items:center;border-right:1px solid var(--border)">
          <span :style="{fontSize:'11px',padding:'2px 7px',border:'1px solid var(--border)',borderRadius:'99px',background:'#fff',whiteSpace:'nowrap',color: task._placeholder?'#b6bcc6':'var(--muted)'}">{{ task.category || '—' }}</span>
          <span v-if="task._temp" title="临时任务" style="margin-left:5px;font-size:10px;color:#7c3aed">临时</span>
        </div>
        <!-- 任务名称 -->
        <div style="padding:8px 10px;display:flex;align-items:center;gap:6px;border-right:1px solid var(--border)" :style="{color: task._placeholder?'#aab0ba':'var(--text)'}">
          <span :style="{cursor: task.unread?'pointer':'default',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}" @click="markSeen(task)">{{ task.detail }}</span>
          <span v-if="task.unread" title="未读：新发布或有更新，点任务名清除" style="width:8px;height:8px;border-radius:50%;background:#e5484d;flex-shrink:0"></span>
        </div>
        <!-- 负责人 -->
        <div style="padding:8px 10px;display:flex;align-items:center;border-right:1px solid var(--border)" :style="{color: task._placeholder?'#b6bcc6':'var(--muted)'}">{{ task.owner || '—' }}</div>
        <!-- 状态 -->
        <div style="padding:6px 10px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;border-right:1px solid var(--border);min-width:0;overflow:hidden" @click="!isEditing(task,'status') && canEditTask(task) && startEdit(task,'status')" :style="{cursor: canEditTask(task)?'pointer':'default'}">
          <select v-if="isEditing(task,'status')" v-model="cellDraft" :data-tc-edit="rowKey(task)+'-status'" @change="saveEdit(task)" @blur="saveEdit(task)" @keydown.esc="cancelEdit" style="font-size:11px;border:1px solid var(--accent);border-radius:5px;padding:2px 4px;background:#fff;width:100%">
            <option v-for="s in statusOpts" :key="s" :value="s">{{ s }}</option>
          </select>
          <template v-else>
            <span :style="{fontSize:'11px',fontWeight:'600',display:'flex',alignItems:'center',gap:'4px',color:statusInfo(task).color,whiteSpace:'nowrap'}"><span :style="{width:'7px',height:'7px',borderRadius:'50%',background:statusInfo(task).dot,display:'inline-block',flexShrink:0}"></span>{{ statusInfo(task).label }}</span>
            <span v-if="pubLabel(task)" style="font-size:9px;color:#9ca3af;line-height:1.3;word-break:break-all;white-space:normal">{{ pubLabel(task) }}</span>
            <span v-if="canEditTask(task) && statusInfo(task).label==='本周新发布任务'" @click.stop="unpublishTask(task)" title="取消发布（改回未发布灰）" style="font-size:9px;color:#9ca3af;text-decoration:underline;cursor:pointer;white-space:normal">取消发布</span>
          </template>
        </div>
        <!-- 时间 -->
        <div style="padding:6px 8px;display:flex;align-items:center;gap:3px;border-right:1px solid var(--border);font-size:11px">
          <span v-if="!task.id" style="color:#c0c5cd">—</span>
          <template v-else-if="isDone(task.status)">
            <input v-if="isEditing(task,'completed_at')" type="date" v-model="cellDraft" :data-tc-edit="rowKey(task)+'-completed_at'" @change="saveEdit(task)" @blur="saveEdit(task)" @keydown.esc="cancelEdit" style="font-size:11px;border:1px solid var(--accent);border-radius:4px;padding:1px 3px;width:100%">
            <span v-else :style="{color:'#138a52',cursor:canEditTask(task)?'pointer':'default'}" @click="canEditTask(task)&&startEdit(task,'completed_at')">✓ {{ fmtDateShort(task.completed_at || task.eta_date) }}</span>
          </template>
          <template v-else>
            <input v-if="isEditing(task,'start_date')" type="date" v-model="cellDraft" :data-tc-edit="rowKey(task)+'-start_date'" @change="saveEdit(task)" @blur="saveEdit(task)" @keydown.esc="cancelEdit" style="font-size:11px;border:1px solid var(--accent);border-radius:4px;padding:1px 2px;width:48%">
            <span v-else :style="{color:'#64748b',cursor:canEditTask(task)?'pointer':'default'}" @click="canEditTask(task)&&startEdit(task,'start_date')">{{ fmtDateShort(task.start_date) }}</span>
            <span style="color:#9ca3af">~</span>
            <input v-if="isEditing(task,'eta_date')" type="date" v-model="cellDraft" :data-tc-edit="rowKey(task)+'-eta_date'" @change="saveEdit(task)" @blur="saveEdit(task)" @keydown.esc="cancelEdit" style="font-size:11px;border:1px solid var(--accent);border-radius:4px;padding:1px 2px;width:48%">
            <span v-else :style="{color:'#64748b',cursor:canEditTask(task)?'pointer':'default'}" @click="canEditTask(task)&&startEdit(task,'eta_date')">{{ fmtDateShort(task.eta_date) }}</span>
          </template>
        </div>
        <!-- 备注 -->
        <div style="padding:6px 10px;display:flex;align-items:flex-start;min-width:0;position:relative">
          <span v-if="!isEditing(task,'note') && (task.note_images||[]).length" title="备注图片" style="font-size:10px;color:#0369a1;flex-shrink:0;margin-right:4px">🖼{{ (task.note_images||[]).length }}</span>
          <span v-if="!isEditing(task,'note') && (task.note_attachments||[]).length" title="附件" style="font-size:10px;color:#0369a1;flex-shrink:0;margin-right:4px">📎{{ (task.note_attachments||[]).length }}</span>
          <input v-if="isEditing(task,'note')" v-model="cellDraft" :data-tc-edit="rowKey(task)+'-note'" @input="onNoteInput(task,$event)" @keydown="onNoteKeydown(task,$event)" @blur="saveEdit(task)" placeholder="备注 / 链接 / @某人提醒" autocomplete="off" style="font-size:11px;border:1px solid var(--accent);border-radius:5px;padding:2px 6px;background:#fff;width:100%">
          <div v-if="isEditing(task,'note') && mention.show" style="position:absolute;z-index:90;top:100%;left:10px;margin-top:2px;min-width:150px;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.14);overflow:hidden">
            <div style="padding:4px 12px;font-size:10px;color:var(--muted);border-bottom:1px solid var(--border)">提醒谁（↑↓ 选，回车确认）</div>
            <div v-for="(n,i) in mention.items" :key="n" @mousedown.prevent="pickMention(task,n)" :style="{padding:'6px 12px',fontSize:'12px',cursor:'pointer',color:'#2563eb',fontWeight:'600',background: i===mention.idx?'var(--bg)':'#fff'}">@{{ n }}</div>
          </div>
          <span v-else-if="noteText(task)" :style="{fontSize:'11px',lineHeight:'1.5',cursor:(task.id&&canEditTask(task))?'pointer':'default',whiteSpace:'normal',wordBreak:'break-word',minWidth:0,flex:1}" @click="task.id && canEditTask(task) && startEdit(task,'note')" v-html="renderNote(noteText(task))"></span>
          <span v-else :style="{fontSize:'11px',color:'#d1d5db',fontStyle:'italic',cursor: canEditTask(task)?'pointer':'default',flex:1}" @click="canEditTask(task) && startEdit(task,'note')">{{ canEditTask(task) ? '点击添加…（可 @某人）' : '—' }}</span>
          <!-- 右侧：发布人 · 时间 -->
          <span v-if="!isEditing(task,'note') && noteText(task) && (task.note_by || task.note_at)" style="flex-shrink:0;margin-left:8px;font-size:10px;color:#9ca3af;white-space:nowrap">{{ task.note_by }}<template v-if="task.note_at"> · {{ fmtNoteTime(task.note_at) }}</template></span>
          <!-- 清除备注（只清备注，不删任务）-->
          <button v-if="!isEditing(task,'note') && noteText(task) && task.id && canEditTask(task)" @click.stop="clearNote(task)" title="清除备注" style="margin-left:6px;flex-shrink:0;border:none;background:transparent;color:#cbd0d8;cursor:pointer;font-size:13px;line-height:1;padding:0 2px">✕</button>
          <!-- 删除整条任务（管理员）-->
          <button v-if="task.id && isAdmin" @click.stop="deleteTaskRow(task)" title="删除该任务" style="margin-left:4px;flex-shrink:0;border:none;background:transparent;color:#e5b4b4;cursor:pointer;font-size:13px;line-height:1;padding:0 2px">🗑</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 总览矩阵（25 单品 × 9 任务 状态矩阵）-->
  <div v-else-if="view==='global'">
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden">
      <div class="tc-scroll" style="overflow:auto;max-height:calc(100vh - 230px)">
        <table style="border-collapse:separate;border-spacing:0;width:100%;font-size:12px">
          <thead><tr>
            <th style="position:sticky;top:0;left:0;z-index:5;background:var(--bg);text-align:left;padding:10px 12px;min-width:200px;border-bottom:1px solid var(--border)">链接名称 · {{ groups.length }} 个单品</th>
            <th v-for="col in columns" :key="col.key" :title="col.title" style="position:sticky;top:0;z-index:3;background:var(--bg);padding:10px 6px;text-align:center;white-space:nowrap;border-bottom:1px solid var(--border);color:var(--muted);font-weight:600">{{ col.label }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="(g,gi) in groups" :key="g.pid">
              <th style="position:sticky;left:0;z-index:2;background:var(--surface);text-align:left;font-weight:600;padding:9px 12px;white-space:nowrap;border-bottom:1px solid var(--border)"><span style="color:var(--accent);font-weight:700;margin-right:8px">{{ String(gi+1).padStart(2,'0') }}</span>{{ g.name }}</th>
              <td v-for="col in columns" :key="col.key" style="text-align:center;padding:7px 6px;border-bottom:1px solid var(--border)">
                <span class="tc-cell" @click="onCell(g,col)" :title="g.name+' · '+col.title+'：'+statusOf(g,col)" :style="{position:'relative',display:'inline-flex',alignItems:'center',justifyContent:'center',width:'22px',height:'22px',borderRadius:'7px',cursor:'pointer',background: cellInfo(g,col).bg}">
                  <span v-if="cellInfo(g,col).mark" style="color:#e5484d;font-weight:700;font-size:13px">{{ cellInfo(g,col).mark }}</span>
                  <span v-else :style="{width:'11px',height:'11px',borderRadius:'50%',background:cellInfo(g,col).dot}"></span>
                  <span v-if="cellUnread(g,col)" title="未读" style="position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:#e5484d;border:1px solid var(--surface)"></span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style="padding:11px 14px;border-top:1px solid var(--border);font-size:12px;color:var(--muted);text-align:center">{{ groups.length }} 个链接 × {{ columns.length }} 个任务 · 红点=未读 · 点格跳到该单品卡片</div>
    </div>
    <div style="display:flex;gap:16px;align-items:center;margin-top:12px;font-size:12px;color:var(--muted);flex-wrap:wrap">
      <span style="display:flex;align-items:center;gap:6px"><span style="color:#e5484d;font-weight:700">❗</span>上周没改状态</span>
      <span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:#c2790e"></span>进行中</span>
      <span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:#138a52"></span>本周完成</span>
      <span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:#9ca3af"></span>往期已完成</span>
      <span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:#e5484d"></span>本周新发布</span>
    </div>
  </div>

  <!-- 新增任务 modal -->
  <div v-if="addTaskModal.show" class="tc-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:200" @click.self="addTaskModal.show=false">
    <div style="background:var(--surface);border-radius:12px;padding:20px;width:390px;box-shadow:0 12px 48px rgba(0,0,0,.25)">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">新增任务</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px">{{ selLabel }} · 命中 9 个默认之一→填该行；否则记「临时任务」</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:3px">单品</div>
      <select v-model="addTaskModal.pid" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--bg);color:var(--text);margin-bottom:10px"><option v-for="g in groups" :key="g.pid" :value="g.pid">{{ g.name }}（{{ g.pid }}）</option></select>
      <div style="font-size:11px;color:var(--muted);margin-bottom:3px">任务标签（可选已有/手填新的）</div>
      <input v-model="addTaskModal.category" list="tc-cats" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--bg);color:var(--text);margin-bottom:10px">
      <datalist id="tc-cats"><option v-for="c in catOptions" :key="c" :value="c"></option></datalist>
      <div style="font-size:11px;color:var(--muted);margin-bottom:3px">任务名称</div>
      <input v-model="addTaskModal.detail" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--bg);color:var(--text);margin-bottom:10px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:3px">负责人</div>
      <input v-model="addTaskModal.owner" list="tc-owners" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--bg);color:var(--text);margin-bottom:16px">
      <datalist id="tc-owners"><option v-for="o in ownerOptions" :key="o" :value="o"></option></datalist>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button @click="addTaskModal.show=false" style="padding:7px 14px;border:1px solid var(--border);background:var(--surface);border-radius:7px;font-size:13px;cursor:pointer;color:var(--muted)">取消</button>
        <button @click="saveAddTask" :disabled="addTaskModal.saving" style="padding:7px 14px;border:none;background:var(--accent);color:#fff;border-radius:7px;font-size:13px;cursor:pointer;font-weight:600">{{ addTaskModal.saving?'保存中…':'保存' }}</button>
      </div>
    </div>
  </div>

  <!-- 新增单品 modal -->
  <div v-if="addSkuModal.show" class="tc-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:200" @click.self="addSkuModal.show=false">
    <div style="background:var(--surface);border-radius:12px;padding:20px;width:380px;box-shadow:0 12px 48px rgba(0,0,0,.25)">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">新增单品（加一张卡片）</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px">加入后自带 9 个默认任务（灰色未发布）；逐行点「发布」或编辑后留存</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:3px">选择已有商品</div>
      <select v-model="addSkuModal.pid" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--bg);color:var(--text);margin-bottom:10px"><option value="">— 选择 —</option><option v-for="p in availableProducts" :key="p.pid" :value="p.pid">{{ p.name }}（{{ p.pid }}）</option></select>
      <div style="font-size:11px;color:var(--muted);margin-bottom:3px">或手填 PID</div>
      <input v-model="addSkuModal.pid" placeholder="商品 PID" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--bg);color:var(--text);margin-bottom:10px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:3px">名称（可留空，自动带出）</div>
      <input v-model="addSkuModal.name" placeholder="单品名称" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--bg);color:var(--text);margin-bottom:16px">
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button @click="addSkuModal.show=false" style="padding:7px 14px;border:1px solid var(--border);background:var(--surface);border-radius:7px;font-size:13px;cursor:pointer;color:var(--muted)">取消</button>
        <button @click="saveAddSku" style="padding:7px 14px;border:none;background:var(--accent);color:#fff;border-radius:7px;font-size:13px;cursor:pointer;font-weight:600">加入</button>
      </div>
    </div>
  </div>

  <!-- 关联人员 modal -->
  <div v-if="ownerLinkModal.show" class="tc-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:200" @click.self="ownerLinkModal.show=false">
    <div style="background:var(--surface);border-radius:12px;padding:20px;width:440px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,.25)">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">负责人 ↔ 账号 关联</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px">关联后，「我的」收件区和红点才会按账号认人；品牌方等可留「不关联」</div>
      <div v-if="ownerLinkModal.loading" style="padding:30px;text-align:center;color:var(--muted)">加载中…</div>
      <div v-else style="overflow:auto">
        <div v-for="name in ownerLinkModal.names" :key="name" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="flex:1;font-size:13px;font-weight:600">{{ name }}</span>
          <select :value="ownerLinkModal.links[name] || ''" @change="setOwnerLink(name, $event.target.value)" style="border:1px solid var(--border);border-radius:7px;padding:5px 8px;font-size:12px;background:var(--bg);color:var(--text);min-width:160px">
            <option value="">— 不关联 —</option>
            <option v-for="u in ownerLinkModal.users" :key="u.id" :value="u.id">{{ u.display_name }}（{{ u.username }}）</option>
          </select>
        </div>
        <div v-if="!ownerLinkModal.names.length" style="padding:20px;text-align:center;color:var(--muted);font-size:12px">暂无负责人数据</div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button @click="ownerLinkModal.show=false" style="padding:7px 16px;border:none;background:var(--accent);color:#fff;border-radius:7px;font-size:13px;cursor:pointer;font-weight:600">完成</button>
      </div>
    </div>
  </div>

  <!-- 批量改时间 modal -->
  <div v-if="batchTimeModal.show" class="tc-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:200" @click.self="batchTimeModal.show=false">
    <div style="background:var(--surface);border-radius:12px;padding:20px;width:360px;box-shadow:0 12px 48px rgba(0,0,0,.25)">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">批量改时间</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px">「{{ batchTimeModal.name }}」本周所有已发布任务统一起止日期</div>
      <div style="display:flex;gap:10px;margin-bottom:16px">
        <div style="flex:1"><div style="font-size:11px;color:var(--muted);margin-bottom:3px">开始</div><input type="date" v-model="batchTimeModal.start" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--bg)"></div>
        <div style="flex:1"><div style="font-size:11px;color:var(--muted);margin-bottom:3px">截止</div><input type="date" v-model="batchTimeModal.end" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--bg)"></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button @click="batchTimeModal.show=false" style="padding:7px 14px;border:1px solid var(--border);background:var(--surface);border-radius:7px;font-size:13px;cursor:pointer;color:var(--muted)">取消</button>
        <button @click="saveBatchTime" :disabled="batchTimeModal.saving" style="padding:7px 14px;border:none;background:var(--accent);color:#fff;border-radius:7px;font-size:13px;cursor:pointer;font-weight:600">{{ batchTimeModal.saving?'保存中…':'应用到全部' }}</button>
      </div>
    </div>
  </div>

  <div v-if="toastMsg" style="position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#1f2430;color:#fff;font-size:13px;padding:9px 16px;border-radius:9px;z-index:300">{{ toastMsg }}</div>
</div>`
})
