// ── AdsPage.js ─────────────────────────────────────────
// 投放面板页组件。

const AdsPage = defineComponent({
  name: 'AdsPage',
  components: { InteractiveTrendChart },  // 投放趋势图表必须注册才能渲染
  props: ['start', 'end'],
  setup(props) {
    const activeTab = ref('delivery')
    const openChannel = ref({ audience: false, keyword: false, video: false })
    const periodStart = computed(() => props.start || RAW.launch_date)
    const periodEnd = computed(() => props.end || RAW.data_end)
    const periodLabel = computed(() => periodStart.value===periodEnd.value ? periodStart.value : `${periodStart.value} ~ ${periodEnd.value}`)

    // ── API 数据（首选）──────────────────────────────
    // 调用成功 → 用 API 返回值（可能是 0，那就是 0）
    // 调用失败（网络/500）→ apiXxx = null，再回退 RAW
    const apiSpend = ref(null)   // /api/ads/channel-split  → audience_spend / keyword_spend
    const apiVideo = ref(null)   // /api/ads/content-summary → summary.total_spend
    const apiPlan  = ref([])     // /api/settings/audience-plan → 4 行品类计划
    const audiencePlanByCat = computed(() => {
      const m = {}
      for (const r of apiPlan.value || []) m[r.category] = r.plan_pct
      return m
    })

    const loadApiData = async () => {
      const s = periodStart.value, e = periodEnd.value
      if (!s || !e) return
      // 1. 渠道（人群/关键词）
      try {
        const res = await fetch(`/api/ads/channel-split?start=${s}&end=${e}`)
        apiSpend.value = res.ok ? await res.json() : null
      } catch { apiSpend.value = null }
      // 2. 短视频
      try {
        const res = await fetch(`/api/ads/content-summary?start=${s}&end=${e}&content_type=${encodeURIComponent('短视频')}`)
        apiVideo.value = res.ok ? await res.json() : null
      } catch { apiVideo.value = null }
      // 3. 人群品类计划（家具63/配饰30/灯具5/其他2）
      try {
        const res = await fetch(`/api/settings/audience-plan`)
        apiPlan.value = res.ok ? await res.json() : []
        // 把实时计划写入 window，让 compute.js 也能用上（替换老的 RAW.plan_pct 静态值）
        if (apiPlan.value && apiPlan.value.length) {
          const livePlan = {}
          for (const r of apiPlan.value) livePlan[r.category] = r.plan_pct
          window.LIVE_AUDIENCE_PLAN = livePlan
        }
      } catch { apiPlan.value = [] }
    }
    onMounted(loadApiData)
    watch([periodStart, periodEnd], loadApiData)

    // 旧硬编码 ratio（仅在 API 不可达时才会被用到）
    const FALLBACK_AUDIENCE_RATIO = 25499.58 / (25499.58 + 9384.97)
    const FALLBACK_KEYWORD_RATIO  = 9384.97  / (25499.58 + 9384.97)

    const fmtMoney = v => v>=10000 ? '¥'+(v/10000).toFixed(1)+'万' : '¥'+Number(v).toFixed(0)
    const fmtDelta = v => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(1) + '%'
    const statusColor = s=>s==='已完成'?'#16a34a':s==='进行中'?'#d97706':'#a1a1aa'
    const imgSrc = pid => RAW.img_map?.[pid] || ''

    const productStats = computed(() => {
      return Object.values(RAW.products).map(p => {
        let spend=0, collect=0
        for (let i=0;i<p.dates.length;i++) {
          const d=p.dates[i]
          if (d>=periodStart.value && d<=periodEnd.value) {
            spend += p.spend?.[i] || 0
            collect += p.collect?.[i] || 0
          }
        }
        return { pid:p.pid, name:p.name, cat:p.cat, spend:+spend.toFixed(2), collect:Math.round(collect) }
      }).filter(r=>r.spend>0).sort((a,b)=>b.spend-a.spend)
    })

    const catRows = computed(() => {
      const catSpend = { 家具:0, 配饰:0, 灯具:0, 其他:0 }
      for (const row of productStats.value) {
        catSpend[row.cat || '其他'] = (catSpend[row.cat || '其他'] || 0) + row.spend
      }
      const total = Object.values(catSpend).reduce((a,b)=>a+b,0)
      return ['家具','配饰','灯具','其他'].map(cat => {
        const spend  = +(catSpend[cat]||0).toFixed(2)
        const actual = total>0 ? +((spend/total)*100).toFixed(1) : 0
        // 从 apiPlan 拿真实计划值；接口失败回退到默认（家具63/配饰30/灯具5/其他2）
        const planFallback = { 家具:63, 配饰:30, 灯具:5, 其他:2 }
        const plan   = audiencePlanByCat.value[cat] != null ? audiencePlanByCat.value[cat] : planFallback[cat]
        const diff   = +(actual - plan).toFixed(1)
        return {
          category: cat,
          spend,
          pct: actual,
          plan_pct: plan,
          diff_pct: diff,
          status: Math.abs(diff) < 5 ? 'normal' : (Math.abs(diff) < 10 ? 'warning' : 'danger'),
        }
      })
    })
    const totalProductSpend = computed(() => catRows.value.reduce((a,b)=>a+b.spend,0))
    const totalProductSpendWan = computed(() => (totalProductSpend.value/10000).toFixed(1))

    // ── 人群花费 ──
    // 1) API 成功 → 用 fact_wxst_audience.spend 真实合计
    // 2) API 失败 → 回退到 totalProductSpend × 历史比例
    const audienceSpend = computed(() => {
      if (apiSpend.value && apiSpend.value.audience_spend != null) {
        return +Number(apiSpend.value.audience_spend).toFixed(2)
      }
      return +(totalProductSpend.value * FALLBACK_AUDIENCE_RATIO).toFixed(2)
    })
    const keywordSpend = computed(() => {
      if (apiSpend.value && apiSpend.value.keyword_spend != null) {
        return +Number(apiSpend.value.keyword_spend).toFixed(2)
      }
      return +(totalProductSpend.value * FALLBACK_KEYWORD_RATIO).toFixed(2)
    })

    // ── 短视频花费 ──
    // 1) API 成功 → 用 fact_wxst_content（短视频类型）真实合计
    // 2) API 失败 → 回退到 RAW.video_daily 快照
    const videoSpend = computed(() => {
      if (apiVideo.value && apiVideo.value.summary && apiVideo.value.summary.total_spend != null) {
        return +Number(apiVideo.value.summary.total_spend).toFixed(2)
      }
      const s = periodStart.value, e = periodEnd.value
      let total = 0
      for (const [d, v] of Object.entries(RAW.video_daily || {})) {
        if (d >= s && d <= e) total += v.spend || 0
      }
      return +total.toFixed(2)
    })
    const videoGmv = computed(() => {
      if (apiVideo.value && apiVideo.value.summary && apiVideo.value.summary.total_gmv != null) {
        return +Number(apiVideo.value.summary.total_gmv).toFixed(2)
      }
      const s = periodStart.value, e = periodEnd.value
      let total = 0
      for (const [d, v] of Object.entries(RAW.video_daily || {})) {
        if (d >= s && d <= e) total += v.gmv || 0
      }
      return +total.toFixed(2)
    })

    // ── 数据源标记（让用户知道当前数据是从哪来的，避免再误以为有"残留"）──
    const dataSourceTag = computed(() => {
      const tags = []
      if (apiSpend.value === null) tags.push('人群/关键词:RAW快照')
      else tags.push('人群/关键词:实时')
      if (apiVideo.value === null) tags.push('短视频:RAW快照')
      else tags.push('短视频:实时')
      return tags.join(' · ')
    })

    const totalPaidSpend = computed(() => {
      const a = +audienceSpend.value || 0
      const k = +keywordSpend.value || 0
      const v = +videoSpend.value || 0
      const sum = a + k + v
      // 数据自检：如果某个分量超过 sum，说明分量来源不一致（API 实时 vs RAW 快照混搭），
      // 把日志打到 console 让你能 F12 看，但 UI 显示 max(sum, components) 避免视觉冲突
      const maxComponent = Math.max(a, k, v)
      if (maxComponent > sum + 0.01) {
        console.warn('[AdsPage 总投放] 分量大于汇总：', { audience:a, keyword:k, video:v, sum, max: maxComponent })
      }
      return +Math.max(sum, maxComponent).toFixed(2)
    })
    const totalPaidSpendWan = computed(() => (totalPaidSpend.value/10000).toFixed(1))

    const buildChannelItems = (total, channelKey) => {
      const base = productStats.value.slice(0,12)
      const weighted = base.map(r => {
        const p = RAW.products?.[r.pid]
        let gmv=0, vis=0, ctrS=0, ctrN=0, collect=0
        if (p) {
          for (let i=0;i<p.dates.length;i++) {
            const d=p.dates[i]
            if (d>=periodStart.value && d<=periodEnd.value) {
              gmv += p.pay?.[i] || 0
              vis += p.vis?.[i] || 0
              collect += (p.collect?.[i] || 0) + (p.cart?.[i] || 0)
              if ((p.ctr?.[i]||0) > 0) { ctrS += p.ctr[i] * 100; ctrN++ }
            }
          }
        }
        const ctr = ctrN ? ctrS / ctrN : 0
        const weight = channelKey === 'audience'
          ? (gmv * 0.45 + collect * 60 + vis * 1.5)
          : (gmv * 0.35 + ctr * 180 + collect * 45)
        return { ...r, gmv:+gmv.toFixed(2), vis:Math.round(vis), ctr:+ctr.toFixed(2), collect:Math.round(collect), weight }
      }).filter(r => r.weight > 0)
      const totalWeight = weighted.reduce((a,b)=>a+b.weight,0) || 1
      return weighted.map(r => ({
        ...r,
        spend_in_channel: +(total * (r.weight / totalWeight)).toFixed(2),
      })).map(r => ({
        ...r,
        pct_in_channel: total>0 ? +((r.spend_in_channel/total)*100).toFixed(1) : 0,
      }))
    }

    const channelRows = computed(() => {
      const total = totalPaidSpend.value
      const audPct = total>0 ? +(audienceSpend.value/total*100).toFixed(1) : 0
      const kwPct  = total>0 ? +(keywordSpend.value/total*100).toFixed(1)  : 0
      const vidPct = total>0 ? +(videoSpend.value/total*100).toFixed(1)    : 0
      return [
        { key:'audience', name:'人群', spend:audienceSpend.value, pct:audPct,
          is_planned:true,
          planned_note:`计划目标：家具 63% / 配饰 30% / 灯具 5% / 其他 2%（人群投放品类比例，admin 在设置页可改）`,
          note:`渠道花费来源：fact_wxst_audience（${apiSpend.value ? '实时' : 'RAW 快照'}）`,
          items:buildChannelItems(audienceSpend.value, 'audience') },
        { key:'keyword', name:'关键词', spend:keywordSpend.value, pct:kwPct,
          is_planned:false,
          planned_note:`无计划比例要求`,
          note:`渠道花费来源：fact_wxst_keyword（${apiSpend.value ? '实时' : 'RAW 快照'}）`,
          items:buildChannelItems(keywordSpend.value, 'keyword') },
        { key:'video', name:'短视频', spend:videoSpend.value, pct:vidPct,
          is_planned:false,
          planned_note:`内容报表口径，独立计算`,
          note:`渠道花费来源：fact_wxst_content content_type='短视频'（${apiVideo.value ? '实时' : 'RAW 快照'}）`,
          gmv:videoGmv.value, items:[] },
      ]
    })

    const trendRows = computed(() => {
      const map = {}
      for (const [pid, dailyMap] of Object.entries(RAW.pid_daily_spend || {})) {
        for (const [d, v] of Object.entries(dailyMap)) {
          if (d >= periodStart.value && d <= periodEnd.value) {
            if (!map[d]) map[d] = { d, spend:0, gmv:0, collect:0 }
            map[d].spend += v.spend || 0
          }
        }
      }
      for (const p of Object.values(RAW.products || {})) {
        for (let i=0;i<p.dates.length;i++) {
          const d = p.dates[i]
          if (d >= periodStart.value && d <= periodEnd.value) {
            if (!map[d]) map[d] = { d, spend:0, gmv:0, collect:0 }
            map[d].gmv += p.pay?.[i] || 0
            map[d].collect += (p.collect?.[i] || 0) + (p.cart?.[i] || 0)
          }
        }
      }
      return Object.values(map).filter(r => (r.spend || 0) > 0 || (r.gmv || 0) > 0 || (r.collect || 0) > 0).sort((a,b)=>a.d.localeCompare(b.d)).map(r => ({
        ...r,
        roi: r.spend > 0 ? +(r.gmv / r.spend).toFixed(2) : null,
      }))
    })

    // ── 任务面板：从 Neon 拉真实任务（含周期 + 当期/上期 metrics）──
    const apiTasksData = ref({ groups: [], period: null, prev_period: null })
    const apiTaskPeriods = ref([])
    const selectedPeriod = ref('')

    const loadTaskPeriods = async () => {
      try {
        const res = await fetch('/api/task-periods')
        if (res.ok) apiTaskPeriods.value = await res.json()
      } catch {}
    }
    const loadTasksWithMetrics = async () => {
      const params = selectedPeriod.value ? `?period_label=${encodeURIComponent(selectedPeriod.value)}` : ''
      try {
        const res = await fetch('/api/tasks/with-metrics' + params)
        if (res.ok) apiTasksData.value = await res.json()
      } catch {
        apiTasksData.value = { groups: [], period: null, prev_period: null }
      }
    }
    onMounted(() => { loadTaskPeriods(); loadTasksWithMetrics() })
    watch(selectedPeriod, loadTasksWithMetrics)

    const taskPeriods = computed(() => apiTaskPeriods.value.map(p => p.label))
    const activePeriod = computed(() => apiTasksData.value.period?.label || selectedPeriod.value)
    const activePeriodRange = computed(() => {
      const p = apiTasksData.value.period
      return p ? `${p.start_date} ~ ${p.end_date}` : ''
    })
    const prevPeriodLabel = computed(() => apiTasksData.value.prev_period?.label || '—')
    const prevPeriodRange = computed(() => {
      const p = apiTasksData.value.prev_period
      return p ? `${p.start_date} ~ ${p.end_date}` : ''
    })

    const teamFilters = ref({ owner:'', category:'', productKeyword:'', status:'' })
    const ownerOptions = computed(() => {
      const s = new Set()
      for (const g of apiTasksData.value.groups || [])
        for (const t of g.tasks || []) if (t.owner) s.add(t.owner)
      return [...s]
    })
    const categoryOptions = computed(() => {
      const s = new Set()
      for (const g of apiTasksData.value.groups || []) if (g.category_l1) s.add(g.category_l1)
      return [...s]
    })
    const statusOptions = ['待开始','进行中','已完成']

    // 应用前端过滤（owner / 分类 / 商品名 / 状态）
    const taskGroups = computed(() => {
      const out = []
      for (const g of apiTasksData.value.groups || []) {
        if (teamFilters.value.category && g.category_l1 !== teamFilters.value.category) continue
        if (teamFilters.value.productKeyword
            && !(g.product_name||'').toLowerCase().includes(teamFilters.value.productKeyword.toLowerCase())) continue
        const filteredTasks = (g.tasks || []).filter(t => {
          if (teamFilters.value.owner && t.owner !== teamFilters.value.owner) return false
          if (teamFilters.value.status && (t.status||'') !== teamFilters.value.status) return false
          return true
        })
        if (!filteredTasks.length) continue
        out.push({
          pid: g.product_id,
          // 名字兜底：API 没拿到 dim_product 的话用前端 short_names（覆盖如 Cotton Bag 564552361178 这种非主链但有任务的 PID）
          name: g.product_name && g.product_name !== g.product_id
                ? g.product_name
                : (RAW.short_names?.[g.product_id] || g.product_id),
          image: imgSrc(g.product_id),
          tasks: filteredTasks.map(t => ({
            id: t.id, detail: t.detail, owner: t.owner || '',
            category: t.category || '', status: t.status || '',
            note: t.execution_note || '',
          })),
          metrics: g.current_metrics || {},
          prev_metrics: g.prev_metrics || {},
          diff_pct: g.diff_pct || {},
        })
      }
      return out
    })

    // ── 当前用户 + 权限 ─────────────────────────────────────
    const me = computed(() => currentUserObj())
    const myPerms = computed(() => {
      const p = me.value?.permissions || []
      return Array.isArray(p) ? p : []
    })
    const isAdmin = computed(() =>
      me.value?.role === 'admin' || myPerms.value.includes('*') || myPerms.value.includes('task.edit_all')
    )
    const canEditOwn = computed(() => isAdmin.value || myPerms.value.includes('task.edit_own'))
    const canDelete  = computed(() => isAdmin.value || myPerms.value.includes('task.delete'))
    // 名字前缀匹配，和后端 update_task 同口径
    const isTaskOwner = (task) => {
      if (!me.value) return false
      const display = me.value.display_name || ''
      const owner   = task.owner || ''
      if (!owner) return false
      if (owner === display) return true
      const prefix = display.split('（')[0].split('(')[0].trim()
      return prefix.length >= 2 && owner.includes(prefix)
    }
    const canEditTask = (task) => isAdmin.value || (canEditOwn.value && isTaskOwner(task))

    // ── Excel 式单元格编辑：每次只编辑一个 (taskId, field)，change/blur 自动保存
    // editingCell = { id, field } — null 表示当前没有编辑中的单元格
    const editingCell = ref(null)
    const isEditing = (taskId, field) =>
      editingCell.value && editingCell.value.id === taskId && editingCell.value.field === field
    // 用于绑定 input 的 v-model 值（独立于任务对象，按需要保存）
    const cellDraft = ref('')
    const startCellEdit = (task, field) => {
      if (!canEditTask(task)) return alert('只能改自己负责的任务')
      // admin 才能改 category / detail / owner；其他人只能改 status / note
      const adminOnly = ['category', 'detail', 'owner']
      if (adminOnly.includes(field) && !isAdmin.value) return
      editingCell.value = { id: task.id, field }
      cellDraft.value = field === 'note'
        ? (task.execution_note || task.note || '')
        : (task[field] != null ? task[field] : '')
      // input/select 自动 focus
      Vue.nextTick(() => {
        const el = document.querySelector(`[data-cell-edit="${task.id}-${field}"]`)
        if (el) { el.focus(); if (el.select) el.select() }
      })
    }
    const cancelCellEdit = () => { editingCell.value = null }
    const saveCellEdit = async (task) => {
      const e = editingCell.value
      if (!e || e.id !== task.id) return
      const field = e.field
      const val = cellDraft.value
      // 没变就直接退出，不发请求
      const cur = field === 'note' ? (task.execution_note || task.note || '') : (task[field] || '')
      if (val === cur) { editingCell.value = null; return }
      try {
        const apiField = field === 'note' ? 'execution_note' : field
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: 'PATCH', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ [apiField]: val }),
        })
        if (!res.ok) {
          const err = await res.json().catch(()=>({detail:'保存失败'}))
          throw new Error(err.detail || ('HTTP ' + res.status))
        }
        // 本地刷新
        for (const g of apiTasksData.value.groups || []) {
          for (const t of g.tasks || []) {
            if (t.id === task.id) {
              if (field === 'note') t.execution_note = val
              else t[field] = val
            }
          }
        }
        editingCell.value = null
      } catch (err) {
        alert('保存失败：' + err.message)
      }
    }

    // ── 删除任务 ─────────────────────────────────────────
    const deleteTaskRow = async (task) => {
      if (!canDelete.value) return alert('无删除权限')
      if (!confirm(`确认删除「${task.detail}」？`)) return
      try {
        const res = await fetch(`/api/tasks/${task.id}`, { method:'DELETE' })
        if (!res.ok) {
          const err = await res.json().catch(()=>({detail:'删除失败'}))
          throw new Error(err.detail || ('HTTP ' + res.status))
        }
        // 本地剔除
        for (const g of apiTasksData.value.groups || []) {
          g.tasks = (g.tasks || []).filter(t => t.id !== task.id)
        }
      } catch (err) {
        alert('删除失败：' + err.message)
      }
    }

    // ── 管理员全字段编辑 Modal ────────────────────────────
    const fullEditModal = ref({ show:false, id:'', detail:'', owner:'', category:'', status:'', priority:'', execution_note:'', saving:false })
    const TASK_CATEGORIES_ALL = ['标题优化','评价与问大家','淘内内容宣发','详情页优化','竞品分析','妈妈计划迭代','售卖复盘','其他']
    const TASK_OWNERS_ALL = ['Jas team（内容）','豆豆（设计）','刘婷（商品）','晓东（运营）','婉婷（主管）','声超']
    const openFullEdit = (task) => {
      if (!isAdmin.value) return alert('需要管理员权限才能改全字段')
      Object.assign(fullEditModal.value, {
        show:true, id:task.id, detail:task.detail||'', owner:task.owner||'',
        category:task.category||'标题优化', status:task.status||'待开始',
        priority:task.priority||'中', execution_note:task.note||'', saving:false,
      })
    }
    const closeFullEdit = () => { fullEditModal.value.show = false }
    const saveFullEdit = async () => {
      const m = fullEditModal.value
      if (!m.detail.trim()) return alert('任务名不能空')
      m.saving = true
      try {
        const body = {
          detail: m.detail.trim(), owner: m.owner, category: m.category,
          status: m.status, priority: m.priority,
          execution_note: m.execution_note,
        }
        const res = await fetch(`/api/tasks/${m.id}`, {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json().catch(()=>({detail:'保存失败'}))
          throw new Error(err.detail || ('HTTP ' + res.status))
        }
        // 刷新本地
        for (const g of apiTasksData.value.groups || []) {
          for (const t of g.tasks || []) {
            if (t.id === m.id) {
              Object.assign(t, body)
            }
          }
        }
        closeFullEdit()
      } catch (err) {
        alert('保存失败：' + err.message)
        m.saving = false
      }
    }

    // ── 批量分配 owner ──────────────────────────────────
    const selectedTaskIds = ref(new Set())
    const toggleSelectTask = (id) => {
      const s = new Set(selectedTaskIds.value)
      if (s.has(id)) s.delete(id); else s.add(id)
      selectedTaskIds.value = s
    }
    const isTaskSelected = (id) => selectedTaskIds.value.has(id)
    const clearSelectedTasks = () => { selectedTaskIds.value = new Set() }
    const bulkAssignModal = ref({ show:false, owner:'', saving:false })
    const openBulkAssign = () => {
      if (!isAdmin.value) return alert('批量分配需要管理员权限')
      if (!selectedTaskIds.value.size) return alert('先勾选任务')
      Object.assign(bulkAssignModal.value, { show:true, owner:'Jas team（内容）', saving:false })
    }
    const closeBulkAssign = () => { bulkAssignModal.value.show = false }
    const doBulkAssign = async () => {
      const ids = Array.from(selectedTaskIds.value)
      if (!ids.length) return closeBulkAssign()
      bulkAssignModal.value.saving = true
      try {
        const res = await fetch('/api/tasks/bulk-update', {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ task_ids: ids, owner: bulkAssignModal.value.owner }),
        })
        if (!res.ok) {
          const err = await res.json().catch(()=>({detail:'批量改失败'}))
          throw new Error(err.detail || ('HTTP ' + res.status))
        }
        // 本地刷新
        for (const g of apiTasksData.value.groups || []) {
          for (const t of g.tasks || []) {
            if (selectedTaskIds.value.has(t.id)) t.owner = bulkAssignModal.value.owner
          }
        }
        clearSelectedTasks()
        closeBulkAssign()
      } catch (err) {
        alert('批量分配失败：' + err.message)
        bulkAssignModal.value.saving = false
      }
    }

    // ── 新增任务 Modal（投放面板版）─────────────────────
    const newTaskModal = ref({ show:false, pid:'', detail:'', category:'标题优化', owner:'Jas team（内容）', status:'待开始', priority:'中', execution_note:'', saving:false })
    const openNewTask = (pid) => {
      if (!isAdmin.value && !myPerms.value.includes('task.create')) return alert('无新增任务权限')
      Object.assign(newTaskModal.value, { show:true, pid: pid||'', detail:'', category:'标题优化', owner:'Jas team（内容）', status:'待开始', priority:'中', execution_note:'', saving:false })
    }
    const closeNewTask = () => { newTaskModal.value.show = false }
    const saveNewTask = async () => {
      const m = newTaskModal.value
      if (!m.pid) return alert('请选商品')
      if (!m.detail.trim()) return alert('任务名不能空')
      m.saving = true
      try {
        const period = activePeriod.value || ''
        const body = {
          product_id: m.pid, detail: m.detail.trim(), owner: m.owner,
          status: m.status, priority: m.priority, category: m.category,
          time_range_label: period, execution_note: m.execution_note || null,
        }
        const res = await fetch('/api/tasks', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json().catch(()=>({detail:'新增失败'}))
          throw new Error(err.detail || ('HTTP ' + res.status))
        }
        // 重新拉一遍任务列表
        await loadTasksWithMetrics()
        closeNewTask()
      } catch (err) {
        alert('新增失败：' + err.message)
        m.saving = false
      }
    }

    // ── 任务评论 / 反馈 ─────────────────────────────────────
    const expandedTaskId = ref(null)
    const taskComments = ref({})    // { task_id: [comments...] }
    const commentDraft = ref({})    // { task_id: { text, image, sending } }
    const previewImage = ref('')    // 点击放大显示

    const toggleTaskExpand = async (taskId) => {
      if (expandedTaskId.value === taskId) {
        expandedTaskId.value = null
        return
      }
      expandedTaskId.value = taskId
      if (!taskComments.value[taskId]) {
        try {
          const res = await fetch(`/api/tasks/${taskId}/comments`)
          if (res.ok) taskComments.value[taskId] = await res.json()
        } catch { taskComments.value[taskId] = [] }
      }
      if (!commentDraft.value[taskId]) {
        commentDraft.value[taskId] = { text: '', image: '', sending: false }
      }
    }

    const onCommentImagePick = (taskId, event) => {
      const file = event.target.files?.[0]
      if (!file) return
      if (file.size > 1000000) { alert('图片过大（>1MB），请先压缩'); return }
      const reader = new FileReader()
      reader.onload = e => {
        commentDraft.value[taskId] = { ...commentDraft.value[taskId], image: e.target.result }
      }
      reader.readAsDataURL(file)
    }

    const sendComment = async (taskId) => {
      const draft = commentDraft.value[taskId] || {}
      if (!draft.text?.trim() && !draft.image) return
      commentDraft.value[taskId] = { ...draft, sending: true }
      try {
        const res = await fetch(`/api/tasks/${taskId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: draft.text, image_data: draft.image })
        })
        if (res.ok) {
          const c = await res.json()
          taskComments.value[taskId] = [...(taskComments.value[taskId]||[]), c]
          commentDraft.value[taskId] = { text: '', image: '', sending: false }
        } else {
          const err = await res.json().catch(()=>({detail:'网络错误'}))
          alert('发送失败：' + (err.detail || res.status))
          commentDraft.value[taskId] = { ...draft, sending: false }
        }
      } catch (e) {
        alert('发送失败：' + e.message)
        commentDraft.value[taskId] = { ...draft, sending: false }
      }
    }

    const deleteComment = async (taskId, commentId) => {
      if (!confirm('确认删除评论？')) return
      try {
        const res = await fetch(`/api/comments/${commentId}`, { method: 'DELETE' })
        if (res.ok) {
          taskComments.value[taskId] = (taskComments.value[taskId]||[]).filter(c => c.id !== commentId)
        } else {
          alert('删除失败（可能不是你的评论）')
        }
      } catch (e) { alert('删除失败：' + e.message) }
    }

    const fmtCommentTime = ts => {
      if (!ts) return ''
      try {
        const d = new Date(ts)
        const m = d.getMonth()+1, day = d.getDate()
        const hh = String(d.getHours()).padStart(2,'0'), mm = String(d.getMinutes()).padStart(2,'0')
        return `${m}-${day} ${hh}:${mm}`
      } catch { return String(ts) }
    }

    // 指标定义（卡片上展示的 10 个 KPI）
    const taskMetricDefs = [
      { k:'gmv',            l:'销售金额',  fmt:'money' },
      { k:'cart',           l:'加购量',    fmt:'num' },
      { k:'cart_rate',      l:'加购率',    fmt:'pct' },
      { k:'pay_cvr',        l:'支付转化率', fmt:'pct' },
      { k:'ctr',            l:'CTR',       fmt:'pct' },
      { k:'spend',          l:'花费',      fmt:'money' },
      { k:'dwell_time',     l:'停留时长',  fmt:'sec' },
      { k:'content_visits', l:'光合渠道流量', fmt:'num' },
      { k:'xhs_count',      l:'笔记发布量', fmt:'num' },
      { k:'vis',            l:'访客数',    fmt:'num' },
    ]
    const fmtMetric = (v, type) => {
      if (v == null) return '—'
      const n = Number(v)
      if (type === 'money') return n >= 10000 ? '¥' + (n/10000).toFixed(1) + '万' : '¥' + n.toFixed(0)
      if (type === 'pct') return n.toFixed(2) + '%'
      if (type === 'sec') return n >= 60 ? (n/60).toFixed(1) + 'min' : Math.round(n) + 's'
      return Math.round(n).toLocaleString()
    }
    const fmtDiffPct = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'
    const diffCls = v => v == null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'dn' : 'flat'

    const meetings = computed(() => {
      const byWeek = {}
      for (const m of (RAW.meetings || [])) {
        const k = m.week_label || m.meeting_date
        if (!byWeek[k] || m.meeting_date > byWeek[k].meeting_date) byWeek[k] = m
      }
      return Object.values(byWeek).sort((a,b)=>b.meeting_date.localeCompare(a.meeting_date)).slice(0,8)
    })
    const latestMeeting = computed(() => meetings.value[0] || null)
    const toggleChannel = key => { openChannel.value[key] = !openChannel.value[key] }

    const channelCatData = computed(() => computeChannelCatTable(periodStart.value, periodEnd.value))

    const adsCtr = computed(() => {
      // 加权 CTR = SUM(clicks) / SUM(impressions)，和万象台后台口径一致。
      // 之前算的是「每商品 CTR 取算术均值」，小曝光商品权重虚高，整体偏大。
      let totalClicks = 0, totalImps = 0
      for (const r of filterRows(RAW.wxst, periodStart.value, periodEnd.value)) {
        if (r.imps > 0) {
          totalImps += r.imps
          totalClicks += (r.clicks != null ? r.clicks : r.imps * r.ctr)  // 兼容：没存 clicks 时用 imps×ctr 反推
        }
      }
      return totalImps > 0 ? +(totalClicks / totalImps * 100).toFixed(2) : null
    })
    const ctrRankRows = computed(() => {
      const sumC={}, cntC={}
      for (const r of filterRows(RAW.wxst, periodStart.value, periodEnd.value)) {
        if (r.imps > 0) {
          sumC[r.pid] = (sumC[r.pid]||0) + r.ctr
          cntC[r.pid] = (cntC[r.pid]||0) + 1
        }
      }
      return Object.keys(sumC)
        .map(pid => ({ pid, name: RAW.products?.[pid]?.name || RAW.short_names[pid] || pid, ctr: +(sumC[pid]/cntC[pid]*100).toFixed(2) }))
        .sort((a,b)=>b.ctr-a.ctr)
        .slice(0,8)
    })

    // 新建周期 modal
    const periodModal = ref({ show:false, start_date:'', end_date:'', set_current:true, saving:false })
    const openPeriodModal = () => {
      if (!isAdmin.value && !myPerms.value.includes('task.create')) return alert('需要管理员权限新建周期')
      const today = new Date().toISOString().slice(0,10)
      Object.assign(periodModal.value, { show:true, start_date: today, end_date: today, set_current:true, saving:false })
    }
    const closePeriodModal = () => { periodModal.value.show = false }
    const savePeriod = async () => {
      const m = periodModal.value
      if (!m.start_date || !m.end_date) return alert('请选起止日期')
      if (m.end_date < m.start_date) return alert('结束日期不能早于开始日期')
      m.saving = true
      try {
        const res = await fetch('/api/task-periods', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ start_date: m.start_date, end_date: m.end_date, set_current: m.set_current }),
        })
        if (!res.ok) {
          const err = await res.json().catch(()=>({detail:'创建失败'}))
          throw new Error(err.detail || ('HTTP ' + res.status))
        }
        const created = await res.json()
        // 刷新周期列表 + 切到新周期
        await loadTaskPeriods()
        selectedPeriod.value = created.label || ''
        await loadTasksWithMetrics()
        closePeriodModal()
      } catch (err) {
        alert('创建失败：' + err.message)
        m.saving = false
      }
    }

    return {
      activeTab, openChannel, periodLabel, audienceSpend, keywordSpend, videoSpend, videoGmv,
      totalPaidSpend, totalPaidSpendWan, catRows, totalProductSpendWan,
      channelRows, trendRows, meetings, latestMeeting, taskGroups, taskPeriods, selectedPeriod, activePeriod, teamFilters, ownerOptions, categoryOptions, statusOptions, fmtMoney, fmtDelta, statusColor, imgSrc, toggleChannel,
      adsCtr, ctrRankRows,
      channelCatData,
      // ── 新增：API 数据状态 + 品类计划
      apiSpend, apiVideo, apiPlan, audiencePlanByCat, dataSourceTag,
      // 任务面板新指标
      taskMetricDefs, fmtMetric, fmtDiffPct, diffCls,
      activePeriodRange, prevPeriodLabel, prevPeriodRange,
      // 任务评论
      expandedTaskId, taskComments, commentDraft, previewImage,
      toggleTaskExpand, onCommentImagePick, sendComment, deleteComment, fmtCommentTime,
      // 权限 + 删除
      me, isAdmin, canDelete, canEditTask, deleteTaskRow,
      // Excel 式单元格编辑
      editingCell, cellDraft, isEditing, startCellEdit, cancelCellEdit, saveCellEdit,
      TASK_CATEGORIES_ALL, TASK_OWNERS_ALL,
      // 新增任务 + 周期 modal
      newTaskModal, openNewTask, closeNewTask, saveNewTask,
      periodModal, openPeriodModal, closePeriodModal, savePeriod,
    }
  },
  template: `
<div style="display:flex;flex-direction:column;gap:16px">
  <!-- 图片放大预览（fixed 全屏） -->
  <div v-if="previewImage" @click="previewImage=''"
    style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:zoom-out">
    <img :src="previewImage" style="max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
  </div>
  <div class="card" style="padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <div style="font-size:16px;font-weight:700;margin-bottom:4px">投放面板</div>
        <div style="font-size:11px;color:var(--muted)">{{ periodLabel }}</div>
      </div>
      <div style="display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#fafaf9">
        <button @click="activeTab='delivery'" :style="{padding:'6px 14px',fontSize:'12px',border:'none',cursor:'pointer',background:activeTab==='delivery'?'var(--accent)':'transparent',color:activeTab==='delivery'?'#fff':'var(--muted)'}">投放</button>
        <button @click="activeTab='team'" :style="{padding:'6px 14px',fontSize:'12px',border:'none',cursor:'pointer',background:activeTab==='team'?'var(--accent)':'transparent',color:activeTab==='team'?'#fff':'var(--muted)'}">团队</button>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:#fafaf9">
      <div style="font-size:12px;color:var(--text);font-weight:600">{{ latestMeeting ? latestMeeting.title + '：' + latestMeeting.content : '暂无会议要点' }}</div>
      <div style="font-size:11px;color:var(--muted)">总投放按人群 + 关键词；类目拆分按商品报表口径</div>
    </div>
  </div>

  <template v-if="activeTab==='delivery'">
    <div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">
      <div class="kpi-card"><div class="kpi-label">总投放<span class="info-btn">?<span class="tooltip">总投放 = 商品报表(人群+关键词) + 内容报表(短视频)。<br/>· 商品报表来源：fact_wxst_audience.spend + fact_wxst_keyword.spend，三方对账时和淘宝商家后台「万象台商品报表合计」对得上<br/>· 短视频来源：fact_wxst_content（光合、达人等内容投放），万象台后台是单独一个 tab，不在商品报表里<br/>· 如果你只想看「淘宝平台广告」口径，应该看「类目拆分额」（商品报表）；带短视频的应该看这个「总投放」</span></span></div><div class="kpi-value">¥{{ totalPaidSpendWan }}万</div><div class="kpi-footer"><span>商品报表 ¥{{ ((audienceSpend+keywordSpend)/10000).toFixed(1) }}万 ｜ 短视频 ¥{{ (videoSpend/10000).toFixed(1) }}万</span></div></div>
      <div class="kpi-card"><div class="kpi-label">人群<span class="info-btn">?<span class="tooltip">万象台「人群推广」渠道花费，来源：fact_wxst_audience.spend SUM。计划侧重看品类拆分（家具63/配饰30/灯具5/其他2），不是看总占比。</span></span></div><div class="kpi-value">{{ fmtMoney(audienceSpend) }}</div><div class="kpi-footer"><span>{{ apiSpend ? '实时' : 'RAW快照' }}</span></div></div>
      <div class="kpi-card"><div class="kpi-label">关键词<span class="info-btn">?<span class="tooltip">万象台「关键词推广」渠道花费，来源：fact_wxst_keyword.spend SUM。无品类计划要求。</span></span></div><div class="kpi-value">{{ fmtMoney(keywordSpend) }}</div><div class="kpi-footer"><span>{{ apiSpend ? '实时' : 'RAW快照' }}</span></div></div>
      <div class="kpi-card"><div class="kpi-label">短视频<span class="info-btn">?<span class="tooltip">内容报表「短视频」类型花费，与搜推报表独立统计，不叠加在人群/关键词中。来源：推广报表→内容报表。</span></span></div><div class="kpi-value">{{ fmtMoney(videoSpend) }}</div><div class="kpi-footer"><span>内容报表口径</span></div></div>
      <div class="kpi-card"><div class="kpi-label">类目拆分额<span class="info-btn">?<span class="tooltip">商品报表口径的各品类投放花费，直接来自商品级数据累加，不经渠道比例换算，用于类目计划 vs 实际对比。</span></span></div><div class="kpi-value">¥{{ totalProductSpendWan }}万</div><div class="kpi-footer"><span>商品报表口径</span></div></div>
      <div class="kpi-card"><div class="kpi-label">推广 CTR<span class="info-btn">?<span class="tooltip">加权 CTR = SUM(点击量) ÷ SUM(展现量) × 100%。和万象台后台口径一致。<br/>之前用算术均值（每个商品 CTR 平均）会让小曝光商品权重虚高，已修复。</span></span></div><div class="kpi-value">{{ adsCtr != null ? adsCtr.toFixed(2)+'%' : '—' }}</div><div class="kpi-footer"><span>加权（点击/曝光）</span></div></div>
    </div>

    <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:16px">
      <!-- 投放趋势：图表 -->
      <div class="card" style="padding:16px">
        <div class="card-header" style="margin-bottom:12px"><span class="card-title">投放趋势</span><span class="card-sub">花费 / 成交额 / ROI</span></div>
        <interactive-trend-chart v-if="trendRows.length"
          :series="[
            { key:'spend', name:'花费', color:'#60a5fa', type:'bar',
              values: trendRows.map(r => ({d:r.d, value:r.spend, label:fmtMoney(r.spend)})) },
            { key:'gmv',   name:'成交额', color:'#a78bfa', type:'bar',
              values: trendRows.map(r => ({d:r.d, value:r.gmv,   label:fmtMoney(r.gmv)})) },
            { key:'roi',   name:'ROI', color:'#16a34a', type:'line',
              values: trendRows.map(r => ({d:r.d, value:r.roi,   label:r.roi==null?'—':'×'+r.roi})) },
          ]" :height="220" :normalize="true" />
        <div v-else class="empty">当前周期暂无投放数据</div>
      </div>

      <!-- CTR 排行 -->
      <div class="card" style="padding:14px 16px">
        <div class="card-header" style="margin-bottom:8px">
          <span class="card-title">CTR 排行</span>
          <span class="info-btn" style="margin-left:6px">?<span class="tooltip" style="left:auto;right:0">加权 CTR = 点击 ÷ 展现，和万象台后台一致。</span></span>
        </div>
        <div v-if="ctrRankRows.length===0" class="empty">暂无 CTR 数据</div>
        <div v-else style="display:flex;flex-direction:column;gap:3px">
          <div style="display:grid;grid-template-columns:20px minmax(0,1fr) 50px;gap:6px;padding:0 2px 4px;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted)">
            <div>#</div><div>商品</div><div style="text-align:right">CTR</div>
          </div>
          <div v-for="(r,i) in ctrRankRows" :key="r.pid" style="display:grid;grid-template-columns:20px minmax(0,1fr) 50px;gap:6px;align-items:center;padding:3px 2px;border-bottom:1px solid #f1f5f9">
            <div :class="['rank-no',{top3:i<3}]" style="text-align:center;font-size:11px">{{ i+1 }}</div>
            <div style="font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="r.name">{{ r.name }}</div>
            <div style="text-align:right;font-size:11px;font-weight:700;color:var(--accent)">{{ r.ctr }}%</div>
          </div>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px">
      <!-- 人群渠道: plan vs actual -->
      <div class="card" style="padding:16px">
        <div class="card-header" style="margin-bottom:10px;align-items:flex-start">
          <div>
            <span class="card-title">人群渠道 · 类目拆分</span>
            <span class="card-sub" style="margin-left:8px">计划 vs 实际（商品报表口径）</span>
          </div>
          <span style="font-size:12px;font-weight:700">¥{{ (channelCatData.audienceTotal/10000).toFixed(1) }}万</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div v-for="c in channelCatData.audienceRows" :key="'adaud-'+c.category">
            <div style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0"
                 @click="c._open=!c._open">
              <span style="font-size:12px;font-weight:600;width:36px;flex-shrink:0">{{ c.category }}</span>
              <div style="flex:1;position:relative;height:6px;background:#f0f0f0;border-radius:3px">
                <div style="position:absolute;top:0;left:0;height:6px;background:#d4d4d8;border-radius:3px"
                     :style="{width:Math.min(100,c.plan_pct||0)+'%'}"></div>
                <div style="position:absolute;top:0;left:0;height:6px;background:var(--accent);border-radius:3px;opacity:.8"
                     :style="{width:Math.min(100,c.actual_pct||0)+'%'}"></div>
              </div>
              <span style="font-size:10px;width:48px;text-align:right;color:var(--muted);flex-shrink:0">计 {{ c.plan_pct }}%</span>
              <span style="font-size:10px;width:48px;text-align:right;color:var(--muted);flex-shrink:0">实 {{ c.actual_pct }}%</span>
              <span :class="['cat-diff','s-'+c.status]" style="width:36px;text-align:right;font-size:11px;font-weight:600;flex-shrink:0">{{ c.diff > 0 ? '+' : '' }}{{ c.diff }}%</span>
              <span style="font-size:10px;color:var(--muted);width:12px;flex-shrink:0">{{ c._open ? '▲' : '▼' }}</span>
            </div>
            <div v-if="c._open" style="margin:4px 0 4px 44px;border-left:2px solid var(--border);padding-left:8px">
              <div style="display:grid;grid-template-columns:1fr 64px 48px 48px;gap:4px;padding:0 0 4px;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted)">
                <span>商品</span><span style="text-align:right">花费</span><span style="text-align:right">实际%</span><span style="text-align:right">计划%</span>
              </div>
              <div v-for="p in (c.products || [])" :key="p.pid"
                   style="display:grid;grid-template-columns:1fr 64px 48px 48px;gap:4px;padding:4px 0;border-bottom:1px solid #f4f4f5;font-size:11px;align-items:center">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)" :title="p.name">{{ p.name }}</span>
                <span style="text-align:right;font-weight:600">{{ fmtMoney(p.spend) }}</span>
                <span style="text-align:right;color:var(--muted)">{{ channelCatData.audienceTotal > 0 ? (p.spend/channelCatData.audienceTotal*100).toFixed(1) : 0 }}%</span>
                <span style="text-align:right" :style="{color:p.plan_pct>0?'var(--text)':'#d1d5db'}">{{ p.plan_pct > 0 ? p.plan_pct+'%' : '—' }}</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0 0;font-size:11px;border-top:1px solid var(--border);margin-top:2px">
                <span style="color:var(--muted)">小计</span><span style="font-weight:700">{{ fmtMoney(c.actual_spend) }}</span>
              </div>
            </div>
          </div>
          <div v-if="!channelCatData.audienceRows.length" class="empty">暂无投放数据</div>
        </div>
      </div>

      <!-- 关键词渠道: actual only -->
      <div class="card" style="padding:16px">
        <div class="card-header" style="margin-bottom:10px;align-items:flex-start">
          <div>
            <span class="card-title">关键词渠道 · 类目拆分</span>
            <span class="card-sub" style="margin-left:8px">实际花费（无计划比例要求）</span>
          </div>
          <span style="font-size:12px;font-weight:700">¥{{ (channelCatData.keywordTotal/10000).toFixed(1) }}万</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div v-for="c in channelCatData.keywordRows" :key="'adkw-'+c.category">
            <div style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0"
                 @click="c._open=!c._open">
              <span style="font-size:12px;font-weight:600;width:36px;flex-shrink:0">{{ c.category }}</span>
              <div style="flex:1;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden">
                <div style="height:100%;background:#60a5fa;border-radius:3px;opacity:.8" :style="{width:Math.min(100,c.actual_pct||0)+'%'}"></div>
              </div>
              <span style="font-size:11px;width:48px;text-align:right;color:var(--muted);flex-shrink:0">{{ c.actual_pct }}%</span>
              <span style="font-size:12px;font-weight:600;width:60px;text-align:right;flex-shrink:0">{{ fmtMoney(c.actual_spend) }}</span>
              <span style="font-size:10px;color:var(--muted);width:12px;flex-shrink:0">{{ c._open ? '▲' : '▼' }}</span>
            </div>
            <div v-if="c._open" style="margin:4px 0 4px 44px;border-left:2px solid var(--border);padding-left:8px">
              <div style="display:grid;grid-template-columns:1fr 64px 48px;gap:4px;padding:0 0 4px;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted)">
                <span>商品</span><span style="text-align:right">花费</span><span style="text-align:right">占比</span>
              </div>
              <div v-for="p in (c.products || [])" :key="p.pid"
                   style="display:grid;grid-template-columns:1fr 64px 48px;gap:4px;padding:4px 0;border-bottom:1px solid #f4f4f5;font-size:11px;align-items:center">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)" :title="p.name">{{ p.name }}</span>
                <span style="text-align:right;font-weight:600">{{ fmtMoney(p.kw_spend) }}</span>
                <span style="text-align:right;color:var(--muted)">{{ channelCatData.keywordTotal > 0 ? (p.kw_spend/channelCatData.keywordTotal*100).toFixed(1) : 0 }}%</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0 0;font-size:11px;border-top:1px solid var(--border);margin-top:2px">
                <span style="color:var(--muted)">小计</span><span style="font-weight:700">{{ fmtMoney(c.actual_spend) }}</span>
              </div>
            </div>
          </div>
          <div v-if="!channelCatData.keywordRows.length" class="empty">暂无投放数据</div>
        </div>
      </div>

      <!-- 短视频渠道（同一行第三列）-->
      <div class="card" style="padding:16px">
        <div class="card-header" style="margin-bottom:10px;align-items:flex-start">
          <div>
            <span class="card-title">短视频渠道</span>
            <span class="card-sub" style="margin-left:8px">内容报表口径</span>
          </div>
          <span style="font-size:12px;font-weight:700">¥{{ (videoSpend/10000).toFixed(2) }}万</span>
        </div>
        <div v-if="videoSpend > 0" style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span style="font-size:11px;color:var(--muted)">花费</span>
            <span style="font-size:13px;font-weight:600">{{ fmtMoney(videoSpend) }}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span style="font-size:11px;color:var(--muted)">GMV</span>
            <span style="font-size:13px;font-weight:600">{{ fmtMoney(videoGmv) }}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span style="font-size:11px;color:var(--muted)">ROI</span>
            <span style="font-size:13px;font-weight:700;color:var(--accent)">{{ videoSpend > 0 ? (videoGmv/videoSpend).toFixed(2) : '—' }}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span style="font-size:11px;color:var(--muted)">占总投放</span>
            <span style="font-size:12px;font-weight:600">{{ totalPaidSpend > 0 ? (videoSpend/totalPaidSpend*100).toFixed(1) : 0 }}%</span>
          </div>
          <div style="height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden">
            <div style="height:100%;background:#a78bfa;border-radius:3px" :style="{width:Math.min(100,totalPaidSpend>0?videoSpend/totalPaidSpend*100:0)+'%'}"></div>
          </div>
        </div>
        <div v-else class="empty">暂无短视频投放数据</div>
      </div>
    </div>

  </template>

  <template v-else>
      <div class="card" style="padding:14px 16px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="font-size:13px;font-weight:700;color:var(--text);margin-right:4px">任务周期</div>
          <div style="display:flex;align-items:center;gap:6px;flex-direction:column;align-items:flex-start">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="padding:5px 14px;font-size:12px;font-weight:600;background:var(--accent);color:#fff;border-radius:8px;white-space:nowrap">{{ activePeriod || '—' }}</span>
              <select v-if="taskPeriods.length>0" v-model="selectedPeriod"
                style="border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:12px;background:#fff;cursor:pointer;color:var(--muted)">
                <option value="">默认（当前周期）</option>
                <option v-for="p in taskPeriods" :key="p" :value="p">{{ p }}</option>
              </select>
              <button v-if="isAdmin" @click="openPeriodModal" title="新建任务周期"
                style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;font-weight:600">+ 新周期</button>
            </div>
            <span style="font-size:11px;color:var(--muted)">
              当期：{{ activePeriodRange || '—' }}　·　对比上期：{{ prevPeriodLabel }} ({{ prevPeriodRange || '—' }})
            </span>
          </div>
          <div style="display:flex;gap:6px;margin-left:auto;flex-wrap:wrap">
            <select v-model="teamFilters.owner" style="border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:12px;background:#fff">
              <option value="">全部负责人</option>
              <option v-for="o in ownerOptions" :key="o" :value="o">{{ o }}</option>
            </select>
            <select v-model="teamFilters.category" style="border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:12px;background:#fff">
              <option value="">全部品类</option>
              <option v-for="o in categoryOptions" :key="o" :value="o">{{ o }}</option>
            </select>
            <select v-model="teamFilters.status" style="border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:12px;background:#fff">
              <option value="">全部状态</option>
              <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
            </select>
            <input v-model="teamFilters.productKeyword" placeholder="搜商品名" style="border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:12px;background:#fff;width:110px">
            <button @click="teamFilters={ owner:'', category:'', productKeyword:'', status:'' }" style="border:1px solid var(--border);background:#fff;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;color:var(--muted)">重置</button>
          </div>
        </div>
      </div>

      <!-- 任务列表 -->
      <div class="card" style="padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px;flex-wrap:wrap">
          <div>
            <span class="card-title">任务清单</span>
            <span class="card-sub">{{ activePeriod }} · {{ taskGroups.length }} 个商品 · 点击单元格直接编辑</span>
          </div>
          <div style="display:flex;gap:8px">
            <button v-if="isAdmin || (me?.permissions||[]).includes('task.create')" @click="openNewTask('')"
              style="padding:6px 12px;font-size:12px;border:1px solid #d97706;background:#d97706;color:#fff;border-radius:6px;cursor:pointer;font-weight:600">+ 新增任务</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div v-for="item in taskGroups" :key="item.pid"
            style="border:1px solid var(--border);border-radius:12px;background:#fff;overflow:hidden">
            <!-- 商品 header -->
            <div style="display:flex;gap:0;border-bottom:1px solid var(--border)">
              <!-- 左：商品图片 -->
              <div style="flex-shrink:0;width:120px;min-height:120px;background:#f3f4f6;position:relative">
                <img v-if="item.image" :src="item.image" style="width:100%;height:100%;object-fit:cover;display:block;min-height:120px">
                <div v-else style="width:120px;min-height:120px;display:flex;align-items:center;justify-content:center;color:#d1d5db;font-size:11px">暂无图片</div>
              </div>
              <!-- 右：商品信息 + 指标 -->
              <div style="flex:1;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0">
                <div>
                  <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ item.name }}</div>
                  <div style="font-size:11px;color:var(--muted)">{{ item.pid }}</div>
                </div>
                <div>
                  <div style="font-size:10px;color:var(--muted);margin-bottom:6px">
                    当期：{{ activePeriodRange || '—' }}　·　环比 {{ prevPeriodLabel }}
                  </div>
                  <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px 12px">
                    <div v-for="m in taskMetricDefs" :key="m.k" style="display:flex;flex-direction:column;gap:2px;min-width:0">
                      <span style="font-size:10px;color:var(--muted)">{{ m.l }}</span>
                      <div style="display:flex;align-items:baseline;gap:5px">
                        <span style="font-size:14px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ fmtMetric(item.metrics[m.k], m.fmt) }}</span>
                        <!-- 当期值 0/null 时不显示 diff（避免出现无意义的 -100%） -->
                        <span v-if="item.metrics[m.k] != null && item.metrics[m.k] !== 0"
                              :class="['chg', diffCls(item.diff_pct[m.k])]" style="font-size:10px">{{ fmtDiffPct(item.diff_pct[m.k]) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <!-- 任务清单表头（5 列）-->
            <div style="display:grid;grid-template-columns:110px minmax(0,1.6fr) 130px 100px minmax(0,1.4fr);gap:0;background:#f8f8f7;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted)">
              <div style="padding:7px 12px;border-right:1px solid var(--border)">任务标签</div>
              <div style="padding:7px 12px;border-right:1px solid var(--border)">任务名称</div>
              <div style="padding:7px 12px;border-right:1px solid var(--border)">负责人</div>
              <div style="padding:7px 12px;border-right:1px solid var(--border)">状态</div>
              <div style="padding:7px 12px">备注</div>
            </div>
            <!-- 任务行（Excel 式：点击单元格 → 直接编辑 → 失焦/回车自动保存）-->
            <div style="display:flex;flex-direction:column">
              <template v-for="(task, ti) in item.tasks" :key="task.id">
              <div
                :style="{display:'grid',gridTemplateColumns:'110px minmax(0,1.6fr) 130px 100px minmax(0,1.4fr)',gap:'0',alignItems:'stretch',
                  borderBottom: ti < item.tasks.length-1 ? '1px solid var(--border)' : 'none',
                  background: expandedTaskId === task.id ? '#fff7ed' : (ti%2===0 ? '#fff' : '#fafaf9')}">

                <!-- 任务标签（admin 点击改）-->
                <div :style="{padding:'8px 10px',display:'flex',alignItems:'center',borderRight:'1px solid var(--border)',cursor:isAdmin?'pointer':'default'}"
                     @click="!isEditing(task.id,'category') && isAdmin && startCellEdit(task,'category')">
                  <select v-if="isEditing(task.id,'category')" v-model="cellDraft" :data-cell-edit="task.id+'-category'"
                    @change="saveCellEdit(task)" @blur="saveCellEdit(task)" @keydown.esc="cancelCellEdit"
                    style="font-size:11px;border:1px solid var(--accent);border-radius:5px;padding:2px 4px;background:#fff;width:100%">
                    <option v-for="c in TASK_CATEGORIES_ALL" :key="c" :value="c">{{ c }}</option>
                  </select>
                  <span v-else style="font-size:11px;color:var(--muted);padding:2px 7px;border:1px solid var(--border);border-radius:99px;background:#fff;white-space:nowrap">{{ task.category || '—' }}</span>
                </div>

                <!-- 任务名称（admin 点击改）-->
                <div :style="{padding:'8px 10px',display:'flex',alignItems:'center',borderRight:'1px solid var(--border)',overflow:'hidden',cursor:isAdmin?'pointer':'default'}"
                     @click="!isEditing(task.id,'detail') && isAdmin && startCellEdit(task,'detail')">
                  <input v-if="isEditing(task.id,'detail')" v-model="cellDraft" :data-cell-edit="task.id+'-detail'"
                    @blur="saveCellEdit(task)" @keydown.enter="saveCellEdit(task)" @keydown.esc="cancelCellEdit"
                    style="flex:1;font-size:12px;border:1px solid var(--accent);border-radius:5px;padding:3px 6px;outline:none;min-width:0">
                  <div v-else style="font-size:12px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%" :title="task.detail">{{ task.detail || '—' }}</div>
                </div>

                <!-- 负责人（点击改）-->
                <div :style="{padding:'8px 10px',display:'flex',alignItems:'center',borderRight:'1px solid var(--border)',overflow:'hidden',cursor:canEditTask(task)?'pointer':'default'}"
                     @click="!isEditing(task.id,'owner') && canEditTask(task) && startCellEdit(task,'owner')">
                  <select v-if="isEditing(task.id,'owner')" v-model="cellDraft" :data-cell-edit="task.id+'-owner'"
                    @change="saveCellEdit(task)" @blur="saveCellEdit(task)" @keydown.esc="cancelCellEdit"
                    style="font-size:11px;border:1px solid var(--accent);border-radius:5px;padding:2px 4px;background:#fff;width:100%">
                    <option v-for="o in TASK_OWNERS_ALL" :key="o" :value="o">{{ o }}</option>
                  </select>
                  <span v-else style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%" :title="task.owner">{{ task.owner || '—' }}</span>
                </div>

                <!-- 状态（点击改）-->
                <div :style="{padding:'8px 10px',display:'flex',alignItems:'center',borderRight:'1px solid var(--border)',cursor:canEditTask(task)?'pointer':'default'}"
                     @click="!isEditing(task.id,'status') && canEditTask(task) && startCellEdit(task,'status')">
                  <select v-if="isEditing(task.id,'status')" v-model="cellDraft" :data-cell-edit="task.id+'-status'"
                    @change="saveCellEdit(task)" @blur="saveCellEdit(task)" @keydown.esc="cancelCellEdit"
                    style="font-size:11px;border:1px solid var(--accent);border-radius:5px;padding:2px 4px;background:#fff;width:100%">
                    <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
                  </select>
                  <span v-else :style="{fontSize:'11px',fontWeight:'600',display:'flex',alignItems:'center',gap:'4px',color:statusColor(task.status),whiteSpace:'nowrap'}">
                    <span :style="{width:'7px',height:'7px',borderRadius:'50%',background:statusColor(task.status),display:'inline-block',flexShrink:'0'}"></span>
                    {{ task.status||'—' }}
                  </span>
                </div>

                <!-- 备注（点击改）+ 评论 + 删除 -->
                <div style="padding:7px 8px;display:flex;align-items:center;gap:6px;overflow:hidden">
                  <input v-if="isEditing(task.id,'note')" v-model="cellDraft" :data-cell-edit="task.id+'-note'"
                    @blur="saveCellEdit(task)" @keydown.enter="saveCellEdit(task)" @keydown.esc="cancelCellEdit"
                    placeholder="备注…"
                    style="flex:1;font-size:11px;border:1px solid var(--accent);border-radius:5px;padding:3px 6px;outline:none;min-width:0">
                  <div v-else :style="{flex:1,overflow:'hidden',cursor:canEditTask(task)?'pointer':'default',minWidth:'0',padding:'2px 4px',borderRadius:'4px'}"
                       @click="canEditTask(task) && startCellEdit(task,'note')">
                    <div v-if="task.execution_note || task.note" style="font-size:11px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ task.execution_note || task.note }}</div>
                    <div v-else style="font-size:11px;color:#d1d5db;font-style:italic">{{ canEditTask(task) ? '点击添加…' : '—' }}</div>
                  </div>
                  <button @click.stop="toggleTaskExpand(task.id)" :title="'评论 (' + (taskComments[task.id]||[]).length + ')'"
                    style="font-size:10px;padding:3px 6px;border:1px solid var(--border);background:#fff;border-radius:4px;cursor:pointer;color:var(--muted);flex-shrink:0">💬{{ (taskComments[task.id]||[]).length }}</button>
                  <button v-if="canDelete" @click.stop="deleteTaskRow(task)" title="删除"
                    style="font-size:10px;padding:3px 7px;border:1px solid #fecaca;background:#fff;border-radius:4px;cursor:pointer;color:#dc2626;flex-shrink:0">×</button>
                </div>
              </div>
              <!-- 展开的评论区 -->
              <div v-if="expandedTaskId === task.id" style="padding:14px 16px;background:#fff7ed;border-bottom:1px solid var(--border)" @click.stop>
                <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px">
                  <div v-if="!(taskComments[task.id]||[]).length" style="font-size:11px;color:var(--muted);font-style:italic">还没有反馈，下面写一条</div>
                  <div v-for="c in (taskComments[task.id]||[])" :key="c.id"
                    style="display:flex;gap:8px;padding:8px 10px;background:#fff;border:1px solid var(--border);border-radius:8px">
                    <div style="flex:1;min-width:0">
                      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                        <span style="font-size:11px;font-weight:600;color:var(--text)">{{ c.author_name || c.author_username || '匿名' }}</span>
                        <span style="font-size:10px;color:var(--muted)">{{ fmtCommentTime(c.created_at) }}</span>
                        <span style="flex:1"></span>
                        <button @click="deleteComment(task.id, c.id)"
                          style="font-size:10px;color:#dc2626;background:none;border:none;cursor:pointer;padding:0">删除</button>
                      </div>
                      <div v-if="c.content" style="font-size:12px;color:var(--text);line-height:1.5;white-space:pre-wrap;word-break:break-word">{{ c.content }}</div>
                    </div>
                    <!-- 图片缩略：60x60 -->
                    <img v-if="c.image_data" :src="c.image_data" @click="previewImage=c.image_data"
                      style="width:60px;height:60px;object-fit:cover;border-radius:6px;cursor:zoom-in;border:1px solid var(--border);flex-shrink:0">
                  </div>
                </div>
                <!-- 添加评论 -->
                <div style="display:flex;gap:8px;align-items:flex-start">
                  <textarea
                    :value="(commentDraft[task.id]||{}).text || ''"
                    @input="commentDraft[task.id] = {...(commentDraft[task.id]||{}), text: $event.target.value}"
                    placeholder="写记录或反馈，可附图..." rows="2"
                    style="flex:1;border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:12px;resize:vertical;font-family:inherit"></textarea>
                  <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;align-items:stretch">
                    <label style="border:1px solid var(--border);background:#fff;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;color:var(--muted);text-align:center">
                      📷 选图
                      <input type="file" accept="image/*" @change="onCommentImagePick(task.id, $event)" style="display:none">
                    </label>
                    <button @click="sendComment(task.id)" :disabled="(commentDraft[task.id]||{}).sending"
                      style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:6px;padding:4px 14px;font-size:11px;cursor:pointer;font-weight:600;white-space:nowrap">
                      {{ (commentDraft[task.id]||{}).sending ? '...' : '发送' }}
                    </button>
                  </div>
                </div>
                <!-- 图片预览 -->
                <div v-if="(commentDraft[task.id]||{}).image" style="margin-top:8px;display:flex;align-items:center;gap:6px">
                  <img :src="(commentDraft[task.id]||{}).image" style="width:60px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">
                  <button @click="commentDraft[task.id] = {...(commentDraft[task.id]||{}), image:''}"
                    style="font-size:10px;color:#dc2626;background:none;border:none;cursor:pointer">移除</button>
                </div>
              </div>
              </template>
            </div>
          </div>
          <div v-if="!taskGroups.length" class="empty">暂无任务</div>
        </div>
      </div>

      <!-- 会议要点 -->
      <div class="card" style="padding:16px">
        <div class="card-header" style="margin-bottom:12px"><span class="card-title">会议要点</span><span class="card-sub">{{ meetings.length }} 条</span></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div v-for="m in meetings" :key="m.id" style="padding:12px;border:1px solid var(--border);border-radius:10px;background:#fafaf9">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px">
              <div style="font-size:13px;font-weight:700">{{ m.title }}</div>
              <div style="font-size:11px;color:var(--muted)">{{ m.meeting_date }} · {{ m.week_label }}</div>
            </div>
            <div style="font-size:12px;color:var(--muted);line-height:1.7">{{ m.content }}</div>
          </div>
        </div>
      </div>
    </div>
  </template>

  <!-- 新增任务 Modal -->
  <div v-if="newTaskModal.show" @click.self="closeNewTask"
    style="position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:1000">
    <div style="width:460px;max-width:92vw;background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 24px 60px rgba(15,23,42,.25)">
      <div style="font-size:14px;font-weight:700;margin-bottom:14px">新增任务</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">商品 PID *</div>
          <input v-model="newTaskModal.pid" placeholder="如：690221882602" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
          <div style="font-size:10px;color:var(--muted);margin-top:3px">从单品页或商品管理复制 PID 过来</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">任务名称 *</div>
          <input v-model="newTaskModal.detail" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:3px">分类</div>
            <select v-model="newTaskModal.category" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#fff">
              <option v-for="c in TASK_CATEGORIES_ALL" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:3px">负责人</div>
            <select v-model="newTaskModal.owner" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#fff">
              <option v-for="o in TASK_OWNERS_ALL" :key="o" :value="o">{{ o }}</option>
            </select>
          </div>
        </div>
        <div style="font-size:10px;color:var(--muted)">周期自动写：{{ activePeriod || '—' }}</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button @click="closeNewTask" style="padding:6px 14px;font-size:12px;border:1px solid var(--border);background:#fff;border-radius:6px;cursor:pointer;color:var(--muted)">取消</button>
        <button @click="saveNewTask" :disabled="newTaskModal.saving" style="padding:6px 14px;font-size:12px;border:1px solid #d97706;background:#d97706;color:#fff;border-radius:6px;cursor:pointer;font-weight:600">{{ newTaskModal.saving ? '...' : '保存' }}</button>
      </div>
    </div>
  </div>

  <!-- 新建周期 Modal -->
  <div v-if="periodModal.show" @click.self="closePeriodModal"
    style="position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:1000">
    <div style="width:380px;max-width:92vw;background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 24px 60px rgba(15,23,42,.25)">
      <div style="font-size:14px;font-weight:700;margin-bottom:14px">新建任务周期</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:3px">开始日期 *</div>
            <input v-model="periodModal.start_date" type="date" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:3px">结束日期 *</div>
            <input v-model="periodModal.end_date" type="date" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
          <input type="checkbox" v-model="periodModal.set_current"> 设为当前周期
        </label>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button @click="closePeriodModal" style="padding:6px 14px;font-size:12px;border:1px solid var(--border);background:#fff;border-radius:6px;cursor:pointer;color:var(--muted)">取消</button>
        <button @click="savePeriod" :disabled="periodModal.saving" style="padding:6px 14px;font-size:12px;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:6px;cursor:pointer;font-weight:600">{{ periodModal.saving ? '...' : '保存' }}</button>
      </div>
    </div>
  </div>
</div>`
})

