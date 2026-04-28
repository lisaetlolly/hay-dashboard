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

    // ── 5 个场景花费（fact_wxst_scene 全口径，万象台后台权威源）──
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
    const shopDirectSpend = computed(() => {
      const v = apiSpend.value && apiSpend.value.shop_direct_spend
      return v != null ? +Number(v).toFixed(2) : 0
    })
    const allSceneSpend = computed(() => {
      const v = apiSpend.value && apiSpend.value.all_scene_spend
      return v != null ? +Number(v).toFixed(2) : 0
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

    // 总投放 = 5 个场景之和（人群+关键词+店铺直达+货品全站+短视频）
    // 优先用后端 channel-split 的 total_scene_spend（fact_wxst_scene 全场景汇总，万象台后台「全营销场景报表」权威数）
    const totalPaidSpend = computed(() => {
      if (apiSpend.value && apiSpend.value.total_scene_spend != null) {
        return +Number(apiSpend.value.total_scene_spend).toFixed(2)
      }
      // fallback：手动加 5 个分量
      const a = +audienceSpend.value || 0
      const k = +keywordSpend.value || 0
      const v = +videoSpend.value || 0
      const s = +shopDirectSpend.value || 0
      const f = +allSceneSpend.value || 0
      return +(a + k + s + f + v).toFixed(2)
    })
    const totalPaidSpendWan = computed(() => (totalPaidSpend.value/10000).toFixed(1))
    // 商品推广合计（不含短视频，对应万象台后台的「商品推广」总数）
    const productPromoSpend = computed(() => {
      const a = +audienceSpend.value || 0
      const k = +keywordSpend.value || 0
      const s = +shopDirectSpend.value || 0
      const f = +allSceneSpend.value || 0
      return +(a + k + s + f).toFixed(2)
    })

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
    const apiTasksData = ref({ groups: [], period: null, prev_period: null, task_templates: [] })
    const apiTaskPeriods = ref([])
    const selectedPeriod = ref('')

    // 周一-周日为一周。
    // 运营约定：每周看的都是上周一到上周日的复盘数据。
    const pickDefaultPeriodLabel = (periods) => {
      if (!periods || !periods.length) return ''
      const now = new Date()
      // 回退 7 天 → 落到上一周
      const target = new Date(now)
      target.setDate(now.getDate() - 7)
      const ts = target.toISOString().slice(0,10)
      // 1. 找包含上周某天的周期
      let hit = periods.find(p => p.start_date <= ts && ts <= p.end_date)
      if (hit) return hit.label
      // 2. 找 is_current 的上一个（按 start_date 排序后取倒数第二）
      const sortedAsc = [...periods].sort((a,b)=> (a.start_date||'').localeCompare(b.start_date||''))
      const curIdx = sortedAsc.findIndex(p => p.is_current)
      if (curIdx > 0) return sortedAsc[curIdx-1].label
      if (curIdx === 0 || sortedAsc.length >= 2) return sortedAsc[Math.max(0, sortedAsc.length-2)].label
      // 3. 兜底：start_date 最大的
      return sortedAsc[sortedAsc.length-1].label
    }

    const loadTaskPeriods = async () => {
      try {
        const res = await fetch('/api/task-periods')
        if (res.ok) {
          const data = await res.json()
          apiTaskPeriods.value = data
          // 仅在用户尚未选择时才填默认（避免覆盖用户切换）
          if (!selectedPeriod.value) {
            selectedPeriod.value = pickDefaultPeriodLabel(data)
          }
        }
      } catch {}
    }
    const loadTasksWithMetrics = async () => {
      const params = selectedPeriod.value ? `?period_label=${encodeURIComponent(selectedPeriod.value)}` : ''
      try {
        const res = await fetch('/api/tasks/with-metrics' + params)
        if (res.ok) apiTasksData.value = await res.json()
      } catch {
        apiTasksData.value = { groups: [], period: null, prev_period: null, task_templates: [] }
      }
    }
    onMounted(() => { loadTaskPeriods(); loadTasksWithMetrics() })
    watch(selectedPeriod, loadTasksWithMetrics)

    // 给定 ISO 日期字符串，返回它所在那一周的周一 / 周日 (Date 对象)
    const mondayOf = (isoDate) => {
      if (!isoDate) return null
      const d = new Date(isoDate)
      if (isNaN(d.getTime())) return null
      d.setHours(0,0,0,0)
      const dow = d.getDay()           // 0=Sun, 1=Mon..6=Sat
      const offset = (dow === 0) ? -6 : (1 - dow)
      const mon = new Date(d)
      mon.setDate(d.getDate() + offset)
      return mon
    }
    const sundayOf = (isoDate) => {
      const mon = mondayOf(isoDate)
      if (!mon) return null
      const sun = new Date(mon)
      sun.setDate(mon.getDate() + 6)
      return sun
    }
    // Mon-Sun 显示标签：4.20-26 / 4.27-5.3 这样
    const fmtWeekRange = (startIso) => {
      const mon = mondayOf(startIso)
      const sun = sundayOf(startIso)
      if (!mon || !sun) return ''
      const m1 = mon.getMonth()+1, d1 = mon.getDate()
      const m2 = sun.getMonth()+1, d2 = sun.getDate()
      return m1 === m2 ? `${m1}.${d1}-${d2}` : `${m1}.${d1}-${m2}.${d2}`
    }
    // 把后端的 period {label, start_date, end_date} 包装成展示用 — label 还是原值（API 调用要用），
    // displayLabel 是 Mon-Sun 周标签（UI 显示用）
    const enrichPeriod = (p) => {
      if (!p) return null
      return Object.assign({}, p, { displayLabel: fmtWeekRange(p.start_date) || p.label })
    }
    // 下拉选项：用 period.label 作 value（API 兼容），用 Mon-Sun 周标签作 label（UI 看到的）
    const taskPeriods = computed(() => apiTaskPeriods.value.map(p => ({
      value: p.label,
      label: fmtWeekRange(p.start_date) || p.label,
      start_date: p.start_date, end_date: p.end_date,
      is_current: !!p.is_current,
    })))
    const activePeriod = computed(() => {
      const p = enrichPeriod(apiTasksData.value.period)
      return (p && p.displayLabel) || selectedPeriod.value || ''
    })
    const activePeriodRange = computed(() => {
      const p = apiTasksData.value.period
      if (!p) return ''
      const mon = mondayOf(p.start_date), sun = sundayOf(p.start_date)
      if (!mon || !sun) return `${p.start_date} ~ ${p.end_date}`
      const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      return `${fmt(mon)} ~ ${fmt(sun)}（周一-周日）`
    })
    const prevPeriodLabel = computed(() => {
      const p = enrichPeriod(apiTasksData.value.prev_period)
      return (p && p.displayLabel) || '—'
    })
    const prevPeriodRange = computed(() => {
      const p = apiTasksData.value.prev_period
      if (!p) return ''
      const mon = mondayOf(p.start_date), sun = sundayOf(p.start_date)
      if (!mon || !sun) return `${p.start_date} ~ ${p.end_date}`
      const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      return `${fmt(mon)} ~ ${fmt(sun)}`
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

    // 25 个主链官方 PID — 前端写死，不依赖任何接口（投放面板团队 tab 永远 25 个）
    const OFFICIAL_25_PIDS = [
      '1020175879777','580467335137','652664516885','975799789205','7660181033346',
      '717349639294','824946188993','824607518747','824882661931','742092260504',
      '682036237751','886839411718','880816460277','965048597796','888002957800',
      '1016294283167','737675603229','583134215392','781547798998','679198301351',
      '880120382310','690221882602','1022489092196','887041510904','689952405763',
    ]

    // 9 个固定任务的前端兜底（API 没返 task_templates 时用）—— 和 task_template 表保持一致
    const FALLBACK_TEMPLATES = [
      { id:'fb_1', category:'标题优化',     detail:'结合小红书/淘宝热搜词，优化链接标题', default_owner:'Jas team（内容）', sort_order:1 },
      { id:'fb_2', category:'评价与问大家', detail:'梳理每个链接中差评（如有），分类问题',  default_owner:'Jas team（内容）', sort_order:2 },
      { id:'fb_3', category:'评价与问大家', detail:'针对共性问题，制作3条带图/视频好评进行覆盖', default_owner:'Jas team（内容）', sort_order:3 },
      { id:'fb_4', category:'评价与问大家', detail:'优化问大家回复',                       default_owner:'Jas team（内容）', sort_order:4 },
      { id:'fb_5', category:'淘内内容宣发', detail:'光合内容制作、上线',                   default_owner:'Jas team（内容）', sort_order:5 },
      { id:'fb_6', category:'详情页优化',   detail:'迭代初版详情页',                       default_owner:'豆豆（设计）',     sort_order:6 },
      { id:'fb_7', category:'竞品分析',     detail:'竞品动作关注、价格策略调整',           default_owner:'刘婷（商品）',     sort_order:7 },
      { id:'fb_8', category:'妈妈计划迭代', detail:'确认推广金额及提出素材需求',           default_owner:'晓东（运营）',     sort_order:8 },
      { id:'fb_9', category:'售卖复盘',     detail:'对流量、收藏加购情况做分析',           default_owner:'晓东（运营）',     sort_order:9 },
    ]

    // 应用前端过滤（owner / 分类 / 商品名 / 状态）
    // 关键：用 RAW.official_pids（25 个写死）兜底，确保后端没返就帮它补齐 → 永远 25 个商品卡。
    // 商品没有真实任务时，用 task_templates 渲染 9 行占位（id 形如 tmpl_<tplId>_<pid>，
    // 前端编辑或状态变化时调用「按模板新建任务」接口落库）
    const taskGroups = computed(() => {
      const out = []
      const apiTpls = apiTasksData.value.task_templates || []
      const templates = apiTpls.length ? apiTpls : FALLBACK_TEMPLATES
      const f = teamFilters.value
      const hasOwnerFilter   = !!f.owner
      const hasStatusFilter  = !!f.status
      const hasTaskLevelFilter = hasOwnerFilter || hasStatusFilter

      // 把后端返回的 groups 按 pid 索引一份，再用 official_pids 兜底拼 25 组
      const apiByPid = {}
      for (const g of apiTasksData.value.groups || []) {
        if (g && g.product_id) apiByPid[g.product_id] = g
      }
      // 严格 25 个：只渲染 OFFICIAL_25_PIDS 里的 PID，后端返的扩展 PID（Cotton Bag /
      // PC Portable / Paper Shade / Manolito 等）一律不进团队 tab
      const allPids = [...OFFICIAL_25_PIDS]
      const mergedGroups = allPids.map(pid => apiByPid[pid] || {
        product_id: pid,
        product_name: RAW.short_names?.[pid] || pid,
        category_l1: RAW.cat_map?.[pid] || '',
        tasks: [],
        current_metrics: {},
        prev_metrics: {},
        diff_pct: {},
      })

      for (const g of mergedGroups) {
        if (f.category && g.category_l1 !== f.category) continue
        if (f.productKeyword
            && !(g.product_name||'').toLowerCase().includes(f.productKeyword.toLowerCase())) continue
        // 真实任务（DB 有的）—— 不 map，直接透传原始对象引用，避免丢字段（execution_note / priority 等）
        // 同时 patch 一个 is_template:false 标记 + note 别名（兼容老模板里的 task.note）
        const realTasks = (g.tasks || []).map(t => {
          if (t.is_template === undefined) t.is_template = false
          if (t.note === undefined) t.note = t.execution_note || ''
          return t
        })
        // 占位：DB 缺失的 9 个固定模板（按 template_id 比对）
        const usedTplIds = new Set(realTasks.map(t => t.template_id).filter(Boolean))
        const placeholderTasks = templates
          .filter(tpl => !usedTplIds.has(tpl.id))
          .map(tpl => ({
            id: 'tmpl_' + tpl.id + '_' + g.product_id,
            template_id: tpl.id,
            detail: tpl.detail,
            owner: tpl.default_owner || '',
            category: tpl.category || '',
            status: '待开始',
            note: '',
            execution_note: '',
            created_at: null, eta_date: null, completed_at: null,
            is_template: true,
          }))
        // 真实任务在前，占位任务在后；保持「9 个固定任务每个商品都看得到」
        const mergedTasks = [...realTasks, ...placeholderTasks]
        // 任务级过滤（owner / status）
        const filteredTasks = mergedTasks.filter(t => {
          if (hasOwnerFilter && t.owner !== f.owner) return false
          if (hasStatusFilter && (t.status||'') !== f.status) return false
          return true
        })
        // 仅当用户主动启用「任务级过滤」且筛后空，才把整个商品隐藏；
        // 默认（无过滤）情况下空商品也要显示，确保 25 个商品全部出现。
        if (hasTaskLevelFilter && !filteredTasks.length) continue
        out.push({
          pid: g.product_id,
          // 名字兜底：API 没拿到 dim_product 的话用前端 short_names（覆盖如 Cotton Bag 564552361178 这种非主链但有任务的 PID）
          name: g.product_name && g.product_name !== g.product_id
                ? g.product_name
                : (RAW.short_names?.[g.product_id] || g.product_id),
          image: imgSrc(g.product_id),
          tasks: filteredTasks,
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
      // admin 才能改 category / detail / owner / eta_date；其他人只能改 status / note
      const adminOnly = ['category', 'detail', 'owner', 'eta_date', 'start_date', 'completed_at']
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
        // 占位行（is_template=true / id 形如 'tmpl_…'）：先 bulk-instantiate 落库，再重新拉数据
        if (task.is_template || (typeof task.id === 'string' && task.id.startsWith('tmpl_'))) {
          let pid = null
          for (const g of apiTasksData.value.groups || []) {
            if (typeof task.id === 'string' && task.id.endsWith('_' + g.product_id)) {
              pid = g.product_id; break
            }
          }
          if (!pid) {
            for (const grp of taskGroups.value) {
              if (grp.tasks.some(t => t.id === task.id)) { pid = grp.pid; break }
            }
          }
          if (!pid) { alert('占位任务定位失败，请刷新重试'); editingCell.value = null; return }
          const inst = await fetch('/api/tasks/bulk-instantiate', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
              period_label: selectedPeriod.value || apiTasksData.value.period?.label,
              product_ids: [pid],
              template_ids: task.template_id ? [task.template_id] : null,
            }),
          })
          if (!inst.ok) {
            const err = await inst.json().catch(()=>({detail:'落库失败'}))
            throw new Error(err.detail || ('HTTP ' + inst.status))
          }
          // 只 reload 一次，找到新生成的真实任务后用 PATCH 写字段（不再 reload 第二次）
          await loadTasksWithMetrics()
          let realTask = null
          for (const g of apiTasksData.value.groups || []) {
            if (g.product_id !== pid) continue
            for (const t of (g.tasks || [])) {
              if (t.template_id === task.template_id) { realTask = t; break }
            }
            if (realTask) break
          }
          if (!realTask) { editingCell.value = null; return }
          const apiField = field === 'note' ? 'execution_note' : field
          const r2 = await fetch(`/api/tasks/${realTask.id}`, {
            method: 'PATCH', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ [apiField]: val }),
          })
          if (!r2.ok) {
            const err = await r2.json().catch(()=>({detail:'保存失败'}))
            throw new Error(err.detail || ('HTTP ' + r2.status))
          }
          // 本地写入新值（不再二次 reload，避免慢）
          if (field === 'note') {
            realTask.execution_note = val; realTask.note = val
          } else {
            realTask[field] = val
          }
          if (field === 'status' && ['done','已完成','完成'].includes(val)) {
            realTask.completed_at = realTask.completed_at || new Date().toISOString()
          }
          editingCell.value = null
          return
        }
        const apiField = field === 'note' ? 'execution_note' : field
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: 'PATCH', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ [apiField]: val }),
        })
        if (!res.ok) {
          const err = await res.json().catch(()=>({detail:'保存失败'}))
          throw new Error(err.detail || ('HTTP ' + res.status))
        }
        // 本地刷新（直接改 g.tasks 里那条原始对象，taskGroups 透传所以会即时反映）
        for (const g of apiTasksData.value.groups || []) {
          for (const t of g.tasks || []) {
            if (t.id !== task.id) continue
            if (field === 'note') {
              t.execution_note = val
              t.note = val
            } else {
              t[field] = val
            }
            // 状态变化时同步 completed_at；状态离开"已完成"时清空
            if (field === 'status') {
              if (['done','已完成','完成'].includes(val)) {
                t.completed_at = t.completed_at || new Date().toISOString()
              } else {
                t.completed_at = null
              }
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

    // ── 任务模板（task_template 表 9 条固定模板）──
    // 用户改的「负责人名」改的是当前任务行的 owner，不影响模板的 default_owner（部门绑定）
    const taskTemplates = ref([])  // [{id, category, detail, default_owner, sort_order}, ...]
    const loadTaskTemplates = async () => {
      try {
        const res = await fetch('/api/task-templates')
        if (res.ok) taskTemplates.value = await res.json()
      } catch {}
    }
    onMounted(loadTaskTemplates)

    // ── 新增单个任务 Modal（基于模板：选一级 → 二级 → owner 自动填）──
    // 新增任务 state：标签/名称 支持已有 + 新建，负责人是固定下拉
    // category：一级分类（标签）  detail：二级分类（任务名称）  owner：负责人
    const newTaskModal = ref({ show:false, pid:'', category:'', detail:'', owner:'', saving:false })
    // 已有标签（一级）：从 task_template 拉所有 category 去重
    const newTaskCategories = computed(() =>
      [...new Set(taskTemplates.value.map(t => t.category).filter(Boolean))]
    )
    const newTaskCategory = computed({
      get: () => newTaskModal.value.category,
      set: (v) => { newTaskModal.value.category = v }
    })
    // 当前已选标签下面的已有任务名（二级）
    const newTaskTemplatesInCat = computed(() =>
      taskTemplates.value.filter(t => t.category === newTaskModal.value.category)
    )
    const openNewTask = (pid) => {
      if (!isAdmin.value) return alert('仅管理员可新增任务')
      // 默认：第一个标签 + 该标签下第一个名称 + 该模板默认负责人
      const firstCat = taskTemplates.value[0]?.category || ''
      const firstTpl = taskTemplates.value.find(t => t.category === firstCat)
      Object.assign(newTaskModal.value, {
        show: true, pid: pid || '',
        category: firstCat,
        detail: firstTpl?.detail || '',
        owner: firstTpl?.default_owner || '',
        saving: false,
      })
    }
    // 当用户选择一个已有的"任务名称"时，自动填充其默认负责人（如果对得上）
    Vue.watch(() => newTaskModal.value.detail, (newDetail) => {
      const tpl = taskTemplates.value.find(t =>
        t.category === newTaskModal.value.category && t.detail === newDetail)
      if (tpl && tpl.default_owner) newTaskModal.value.owner = tpl.default_owner
    })
    // 切标签时，如果当前 detail 在新标签下不存在 → 重置为新标签下第一个 detail
    Vue.watch(() => newTaskModal.value.category, (newCat) => {
      const exists = taskTemplates.value.some(t =>
        t.category === newCat && t.detail === newTaskModal.value.detail)
      if (!exists) {
        const firstTpl = taskTemplates.value.find(t => t.category === newCat)
        if (firstTpl) {
          newTaskModal.value.detail = firstTpl.detail
          newTaskModal.value.owner = firstTpl.default_owner
        } else {
          newTaskModal.value.detail = ''
        }
      }
    })
    const closeNewTask = () => { newTaskModal.value.show = false }
    const saveNewTask = async () => {
      const m = newTaskModal.value
      if (!m.pid) return alert('请填商品 PID')
      if (!m.category || !m.category.trim()) return alert('请填任务标签')
      if (!m.detail || !m.detail.trim()) return alert('请填任务名称')
      if (!m.owner) return alert('请选负责人')
      // 看看 category+detail 是不是一个已有 9 模板里的：
      // 是 → 带上 template_id，不打红点（这是常规任务）
      // 否 → 不带 template_id，打红点（这是全新没出现过的任务）
      const matched = taskTemplates.value.find(t =>
        t.category === m.category.trim() && t.detail === m.detail.trim())
      m.saving = true
      try {
        const body = {
          product_id: m.pid,
          detail: m.detail.trim(),
          owner: m.owner,
          category: m.category.trim(),
          status: '待开始', priority: '中',
          time_range_label: activePeriod.value || apiTasksData.value.period?.label || '',
        }
        if (matched && matched.id) body.template_id = matched.id
        const res = await fetch('/api/tasks', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json().catch(()=>({detail:'新增失败'}))
          throw new Error(err.detail || ('HTTP ' + res.status))
        }
        await loadTasksWithMetrics()
        closeNewTask()
      } catch (err) {
        alert('新增失败：' + err.message)
        m.saving = false
      }
    }

    // ── 批量给多商品建任务 Modal（任务组合 a/b → 调 bulk-instantiate）──
    // mode='all'：组合 a，全 9 模板；mode='custom'：组合 b，勾选模板子集
    const bulkModal = ref({
      show:false, mode:'all', pidsText:'', selectedTplIds:new Set(),
      period:'', saving:false, lastResult:null,
    })
    const openBulkCreate = () => {
      if (!isAdmin.value && !myPerms.value.includes('task.create')) return alert('需要 task.create 权限')
      const all = new Set(taskTemplates.value.map(t => t.id))
      Object.assign(bulkModal.value, {
        show:true, mode:'all', pidsText:'',
        selectedTplIds: all,  // 默认全选
        period: activePeriod.value || '',
        saving:false, lastResult:null,
      })
    }
    const closeBulkCreate = () => { bulkModal.value.show = false }
    const toggleBulkTpl = (id) => {
      const s = new Set(bulkModal.value.selectedTplIds)
      if (s.has(id)) s.delete(id); else s.add(id)
      bulkModal.value.selectedTplIds = s
    }
    const isBulkTplSelected = (id) => bulkModal.value.selectedTplIds.has(id)
    const saveBulkCreate = async () => {
      const m = bulkModal.value
      // 解析 PID 列表（支持空格/逗号/换行分隔）
      const pids = (m.pidsText || '').split(/[\s,，;；\n]+/).map(s => s.trim()).filter(Boolean)
      if (!pids.length) return alert('请填至少 1 个商品 PID')
      if (!m.period) return alert('请选周期')
      const tplIds = m.mode === 'all'
        ? null  // 后端 template_ids 为空 = 全部
        : Array.from(m.selectedTplIds)
      if (m.mode === 'custom' && !tplIds.length) return alert('自选模式至少选 1 个模板')
      m.saving = true
      try {
        const res = await fetch('/api/tasks/bulk-instantiate', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            product_ids: pids,
            period_label: m.period,
            template_ids: tplIds,  // null = 全 9 个
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(()=>({detail:'批量创建失败'}))
          throw new Error(err.detail || ('HTTP ' + res.status))
        }
        const data = await res.json()
        m.lastResult = `✓ 已为 ${data.product_count} 个商品创建 ${data.created} 条任务（重复的自动跳过）`
        await loadTasksWithMetrics()
      } catch (err) {
        m.lastResult = '✗ ' + err.message
      }
      m.saving = false
    }

    // ── 任务评论 / 反馈 ─────────────────────────────────────
    const expandedTaskId = ref(null)
    const taskComments = ref({})    // { task_id: [comments...] }
    const commentDraft = ref({})    // { task_id: { text, images: [...], sending } }
    const previewImage = ref('')    // 点击放大显示

    const toggleTaskExpand = async (taskId) => {
      if (expandedTaskId.value === taskId) {
        expandedTaskId.value = null
        return
      }
      expandedTaskId.value = taskId
      // 自动聚焦 textarea（用户展开后不用再点一下）
      Vue.nextTick(() => {
        const el = document.querySelector(`[data-comment-textarea="${taskId}"]`)
        if (el) el.focus()
      })
      if (!taskComments.value[taskId]) {
        try {
          const res = await fetch(`/api/tasks/${taskId}/comments`)
          if (res.ok) taskComments.value[taskId] = await res.json()
        } catch { taskComments.value[taskId] = [] }
      }
      if (!commentDraft.value[taskId]) {
        commentDraft.value[taskId] = { text: '', images: [], sending: false }
      }
      // 旧格式兼容：把 image 字段迁到 images 数组
      const d = commentDraft.value[taskId]
      if (d.image && (!d.images || !d.images.length)) {
        commentDraft.value[taskId] = { ...d, images: [d.image], image: '' }
      }
    }

    // 多图：通用入口（支持 input picker / drag-drop / 粘贴板）
    const _addImagesFromFiles = (taskId, fileList) => {
      const files = Array.from(fileList || []).filter(f => f && f.type && f.type.startsWith('image/'))
      if (!files.length) return
      const cur = commentDraft.value[taskId] || { text: '', images: [], sending: false }
      const images = [...(cur.images || [])]
      let processed = 0
      const oversized = []
      const finish = () => {
        commentDraft.value[taskId] = { ...cur, images }
        if (oversized.length) alert('以下图片过大（>1MB）已跳过：\n' + oversized.join('\n'))
      }
      files.forEach(file => {
        if (file.size > 1000000) {
          oversized.push(file.name || '截图')
          processed++
          if (processed === files.length) finish()
          return
        }
        const reader = new FileReader()
        reader.onload = e => {
          images.push(e.target.result)
          processed++
          if (processed === files.length) finish()
        }
        reader.readAsDataURL(file)
      })
    }
    const onCommentImagePick = (taskId, event) => {
      _addImagesFromFiles(taskId, event.target.files)
      if (event.target) event.target.value = ''
    }
    const onCommentDrop = (taskId, event) => {
      _addImagesFromFiles(taskId, event.dataTransfer && event.dataTransfer.files)
    }
    const onCommentPaste = (taskId, event) => {
      const items = event.clipboardData && event.clipboardData.items
      if (!items) return
      const files = []
      for (const it of items) {
        if (it.kind === 'file') {
          const f = it.getAsFile()
          if (f) files.push(f)
        }
      }
      if (files.length) {
        event.preventDefault()
        _addImagesFromFiles(taskId, files)
      }
    }
    const removeCommentImage = (taskId, idx) => {
      const cur = commentDraft.value[taskId]
      if (!cur || !cur.images) return
      const images = [...cur.images]
      images.splice(idx, 1)
      commentDraft.value[taskId] = { ...cur, images }
    }

    const sendComment = async (taskId) => {
      const draft = commentDraft.value[taskId] || {}
      const imgs = draft.images || []
      if (!draft.text?.trim() && !imgs.length) return
      commentDraft.value[taskId] = { ...draft, sending: true }
      try {
        // 多张图：image_data 传 JSON 数组（后端兼容字符串/数组两种格式）
        const body = {
          content: draft.text,
          // 单图：传字符串保持兼容；多图：传数组
          image_data: imgs.length === 0 ? null
                    : imgs.length === 1 ? imgs[0]
                    : imgs,  // 数组
          images: imgs,  // 显式数组字段，未来用
        }
        const res = await fetch(`/api/tasks/${taskId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
        if (res.ok) {
          const c = await res.json()
          taskComments.value[taskId] = [...(taskComments.value[taskId]||[]), c]
          commentDraft.value[taskId] = { text: '', images: [], sending: false }
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
      if (v == null) return '/'
      const n = Number(v)
      // 0 值统一显示 "/"（包括 CTR=0、点击=0、花费=0 等都没意义）
      if (!isFinite(n) || n === 0) return '/'
      if (type === 'money') return n >= 10000 ? '¥' + (n/10000).toFixed(1) + '万' : '¥' + n.toFixed(0)
      if (type === 'pct') return n.toFixed(2) + '%'
      if (type === 'sec') return n >= 60 ? (n/60).toFixed(1) + 'min' : Math.round(n) + 's'
      return Math.round(n).toLocaleString()
    }
    const fmtDiffPct = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'
    const diffCls = v => v == null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'dn' : 'flat'

    // ── 状态归一 + 任务时间相关辅助 ───────────────────────────
    const STATUS_DONE = ['done', '已完成', '完成']
    const STATUS_PROGRESS = ['in_progress', '进行中', 'doing']
    const isStatusDone = s => STATUS_DONE.includes(s)
    const isStatusInProgress = s => STATUS_PROGRESS.includes(s)

    // 当前 ISO 周（周一到周日）的起止 epoch ms
    const currentWeekRange = () => {
      const d = new Date(); d.setHours(0,0,0,0)
      const dow = d.getDay()  // 0=Sun,1=Mon,...,6=Sat
      const offsetToMon = (dow === 0) ? -6 : (1 - dow)  // 周一为 ISO 周首
      const mon = new Date(d); mon.setDate(d.getDate() + offsetToMon)
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999)
      return [mon.getTime(), sun.getTime()]
    }
    // 红点 = "全新没出现过的任务"——3 个条件全满足才打：
    //
    // 1) 不是占位行（is_template）
    // 2) 不是 9 个固定任务（标准任务）
    //    判定方式（任一命中就算"标准"，不打）：
    //      a. task.template_id 存在且不为空 → 是从 task_template 实例化出来的，标准
    //      b. (category, detail) 在后端拉来的 taskTemplates 里 → 标准
    //      c. (category, detail) 在前端 FALLBACK_TEMPLATES 里 → 标准（兼容后端没返时）
    // 3) created_at 落在当前展示周期内 → 一整周显示，下周自动消失
    //
    // 改状态 / 补录历史数据 不会变红（created_at 不变）
    // 只有管理员"+ 新增任务"填了自定义名称 才会打红点
    const TEMPLATE_KEY = (cat, det) =>
      String(cat||'').trim() + '||' + String(det||'').trim()
    const standardTaskKeys = computed(() => {
      const set = new Set()
      for (const t of (taskTemplates.value || [])) set.add(TEMPLATE_KEY(t.category, t.detail))
      // 兜底：后端没返 task_templates 时，仍认 9 项默认模板为标准
      for (const t of FALLBACK_TEMPLATES) set.add(TEMPLATE_KEY(t.category, t.detail))
      return set
    })
    const isNewThisWeek = (task) => {
      if (!task) return false
      if (task.is_template) return false
      if (!task.created_at) return false
      // 条件 a：明确绑了 template_id
      if (task.template_id != null && task.template_id !== '' && task.template_id !== 0) return false
      // 条件 b/c：(category, detail) 命中已知标准
      if (standardTaskKeys.value.has(TEMPLATE_KEY(task.category, task.detail))) return false
      // 周期窗
      const p = apiTasksData.value.period
      if (!p || !p.start_date || !p.end_date) return false
      const t = new Date(task.created_at)
      if (isNaN(t.getTime())) return false
      const start = new Date(p.start_date + 'T00:00:00')
      const end = new Date(p.end_date + 'T23:59:59')
      return t >= start && t <= end
    }
    // 完成时间格式化（保留分钟）
    const fmtCompletedAt = (iso) => {
      if (!iso) return '—'
      const d = new Date(iso)
      if (isNaN(d.getTime())) return '—'
      const m = (d.getMonth()+1).toString().padStart(2,'0')
      const day = d.getDate().toString().padStart(2,'0')
      const hh = d.getHours().toString().padStart(2,'0')
      const mm = d.getMinutes().toString().padStart(2,'0')
      return `${m}-${day} ${hh}:${mm}`
    }
    // 智能完成时间：优先 completed_at，缺失则回退到任务所在周期的 end_date（4.27-30 这种老库 NULL 兜底）
    const fmtCompletedSmart = (task) => {
      if (task && task.completed_at) return fmtCompletedAt(task.completed_at)
      const p = apiTasksData.value.period
      if (p && p.end_date) {
        const m = String(p.end_date).match(/^(\d{4})-(\d{2})-(\d{2})/)
        if (m) return `${m[2]}-${m[3]}（周末）`
      }
      return '—'
    }
    // 周期开始 / 结束日期（用于待开始/进行中时间列兜底显示 "4.27-4.30" 这种）
    const periodStartDateDisplay = computed(() => {
      const p = apiTasksData.value.period
      if (!p || !p.start_date) return ''
      const m = String(p.start_date).match(/^\d{4}-(\d{2})-(\d{2})/)
      return m ? `${parseInt(m[1])}.${parseInt(m[2])}` : p.start_date
    })
    const periodEndDateDisplay = computed(() => {
      const p = apiTasksData.value.period
      if (!p || !p.end_date) return ''
      const m = String(p.end_date).match(/^\d{4}-(\d{2})-(\d{2})/)
      return m ? `${parseInt(m[1])}.${parseInt(m[2])}` : p.end_date
    })
    // ETA 日期：YYYY-MM-DD → MM-DD
    const fmtEtaDate = (s) => {
      if (!s) return ''
      const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
      return m ? `${m[2]}-${m[3]}` : s
    }

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
    // 周期编辑：modal 既能新建也能改老周期
    const periodModal = ref({ show:false, mode:'add', id:null, start_date:'', end_date:'', set_current:true, saving:false })
    const openPeriodEdit = () => {
      if (!isAdmin.value) return alert('需要管理员权限')
      const cur = apiTaskPeriods.value.find(p => p.label === selectedPeriod.value)
        || apiTaskPeriods.value.find(p => p.is_current)
        || apiTaskPeriods.value[0]
      if (!cur) return alert('当前无周期可编辑，先新建一个')
      Object.assign(periodModal.value, {
        show: true, mode: 'edit', id: cur.id,
        start_date: cur.start_date, end_date: cur.end_date,
        set_current: !!cur.is_current, saving: false,
      })
    }
    const deleteCurrentPeriod = async () => {
      if (!isAdmin.value) return alert('需要管理员权限')
      const cur = apiTaskPeriods.value.find(p => p.label === selectedPeriod.value)
      if (!cur) return alert('请在下拉里选一个周期再删')
      if (!confirm(`确认删除周期「${cur.label}」？该周期下所有任务也会被删除！`)) return
      try {
        const res = await fetch(`/api/task-periods/${cur.id}`, { method:'DELETE' })
        if (!res.ok) {
          const err = await res.json().catch(()=>({detail:'删除失败'}))
          throw new Error(err.detail || ('HTTP ' + res.status))
        }
        const data = await res.json()
        alert(`已删除周期 ${data.deleted_label}（连带 ${data.deleted_tasks} 条任务）`)
        await loadTaskPeriods()
        selectedPeriod.value = ''
        await loadTasksWithMetrics()
      } catch (e) { alert('删除失败：' + e.message) }
    }
    const openPeriodModal = () => {
      if (!isAdmin.value && !myPerms.value.includes('task.create')) return alert('需要管理员权限新建周期')
      const today = new Date().toISOString().slice(0,10)
      Object.assign(periodModal.value, { show:true, mode:'add', id:null, start_date: today, end_date: today, set_current:true, saving:false })
    }
    const closePeriodModal = () => { periodModal.value.show = false }
    const savePeriod = async () => {
      const m = periodModal.value
      if (!m.start_date || !m.end_date) return alert('请选起止日期')
      if (m.end_date < m.start_date) return alert('结束日期不能早于开始日期')
      m.saving = true
      try {
        const isEdit = m.mode === 'edit' && m.id
        const url = isEdit ? `/api/task-periods/${m.id}` : '/api/task-periods'
        const method = isEdit ? 'PATCH' : 'POST'
        const res = await fetch(url, {
          method, headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ start_date: m.start_date, end_date: m.end_date, set_current: m.set_current }),
        })
        if (!res.ok) {
          const err = await res.json().catch(()=>({detail:'保存失败'}))
          throw new Error(err.detail || ('HTTP ' + res.status))
        }
        const data = await res.json()
        await loadTaskPeriods()
        selectedPeriod.value = data.label || ''
        await loadTasksWithMetrics()
        closePeriodModal()
      } catch (err) {
        alert('保存失败：' + err.message)
        m.saving = false
      }
    }

    return {
      activeTab, openChannel, periodLabel, audienceSpend, keywordSpend, videoSpend, videoGmv,
      shopDirectSpend, allSceneSpend, productPromoSpend,
      totalPaidSpend, totalPaidSpendWan, catRows, totalProductSpendWan,
      channelRows, trendRows, meetings, latestMeeting, taskGroups, taskPeriods, selectedPeriod, activePeriod, teamFilters, ownerOptions, categoryOptions, statusOptions, fmtMoney, fmtDelta, statusColor, imgSrc, toggleChannel,
      // 任务时间/红点辅助
      isNewThisWeek, isStatusDone, isStatusInProgress, fmtCompletedAt, fmtCompletedSmart, fmtEtaDate,
      periodStartDateDisplay, periodEndDateDisplay,
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
      removeCommentImage, onCommentDrop, onCommentPaste,
      // 权限 + 删除
      me, isAdmin, canDelete, canEditTask, deleteTaskRow,
      // Excel 式单元格编辑
      editingCell, cellDraft, isEditing, startCellEdit, cancelCellEdit, saveCellEdit,
      TASK_CATEGORIES_ALL, TASK_OWNERS_ALL,
      // 新增任务 + 周期 modal
      newTaskModal, openNewTask, closeNewTask, saveNewTask,
      newTaskCategory, newTaskCategories, newTaskTemplatesInCat, taskTemplates,
      periodModal, openPeriodModal, closePeriodModal, savePeriod,
      openPeriodEdit, deleteCurrentPeriod, apiTaskPeriods,
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
    <!-- 第 1 行：总投放 + 商品推广（人群/关键词/店铺直达/货品全站） + 短视频 + CTR -->
    <div class="kpi-grid" style="grid-template-columns:repeat(7,1fr)">
      <div class="kpi-card"><div class="kpi-label">总投放<span class="info-btn">?<span class="tooltip">万象台「全营销场景报表」5 个场景合计：人群推广 + 关键词推广 + 店铺直达 + 货品全站推广 + 超级短视频。<br/>和万象台后台首页显示的「总投放」一致，老板钦定的口径。</span></span></div><div class="kpi-value">¥{{ totalPaidSpendWan }}万</div><div class="kpi-footer"><span>商品推广 ¥{{ (productPromoSpend/10000).toFixed(1) }}万 ｜ 短视频 ¥{{ (videoSpend/10000).toFixed(1) }}万</span></div></div>
      <div class="kpi-card"><div class="kpi-label">人群<span class="info-btn">?<span class="tooltip">万象台「人群推广」场景花费。商品推广的最大头，按品类配比（家具63/配饰30/灯具5/其他2）。</span></span></div><div class="kpi-value">{{ fmtMoney(audienceSpend) }}</div><div class="kpi-footer"><span>{{ totalPaidSpend > 0 ? (audienceSpend/totalPaidSpend*100).toFixed(1)+'%' : '—' }} 占总投放</span></div></div>
      <div class="kpi-card"><div class="kpi-label">关键词<span class="info-btn">?<span class="tooltip">万象台「关键词推广」场景花费。包含淘宝搜索关键词竞价和品牌词等。</span></span></div><div class="kpi-value">{{ fmtMoney(keywordSpend) }}</div><div class="kpi-footer"><span>{{ totalPaidSpend > 0 ? (keywordSpend/totalPaidSpend*100).toFixed(1)+'%' : '—' }} 占总投放</span></div></div>
      <div class="kpi-card"><div class="kpi-label">店铺直达<span class="info-btn">?<span class="tooltip">万象台「店铺直达」场景花费。以引导用户到店铺主页为目的的展示位投放。</span></span></div><div class="kpi-value">{{ fmtMoney(shopDirectSpend) }}</div><div class="kpi-footer"><span>{{ totalPaidSpend > 0 ? (shopDirectSpend/totalPaidSpend*100).toFixed(1)+'%' : '—' }} 占总投放</span></div></div>
      <div class="kpi-card"><div class="kpi-label">货品全站<span class="info-btn">?<span class="tooltip">万象台「货品全站推广」场景花费。系统智能投放，跨站位综合优化。</span></span></div><div class="kpi-value">{{ fmtMoney(allSceneSpend) }}</div><div class="kpi-footer"><span>{{ totalPaidSpend > 0 ? (allSceneSpend/totalPaidSpend*100).toFixed(1)+'%' : '—' }} 占总投放</span></div></div>
      <div class="kpi-card"><div class="kpi-label">短视频<span class="info-btn">?<span class="tooltip">万象台「超级短视频」场景花费。内容投放，与商品推广独立。</span></span></div><div class="kpi-value">{{ fmtMoney(videoSpend) }}</div><div class="kpi-footer"><span>{{ totalPaidSpend > 0 ? (videoSpend/totalPaidSpend*100).toFixed(1)+'%' : '—' }} 占总投放</span></div></div>
      <div class="kpi-card"><div class="kpi-label">推广 CTR<span class="info-btn">?<span class="tooltip">加权 CTR = SUM(点击量) ÷ SUM(展现量) × 100%。和万象台后台口径一致。</span></span></div><div class="kpi-value">{{ adsCtr != null ? adsCtr.toFixed(2)+'%' : '—' }}</div><div class="kpi-footer"><span>加权（点击/曝光）</span></div></div>
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
      <!-- 筛选栏（任务周期已去除，周维度由 pickDefaultPeriodLabel 自动按本周锁定）-->
      <div class="card" style="padding:10px 14px">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
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

      <!-- 任务列表 -->
      <div class="card" style="padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px;flex-wrap:wrap">
          <div>
            <span class="card-title">任务清单</span>
            <span class="card-sub">{{ activePeriod }} · {{ taskGroups.length }} 个商品 · 点击单元格直接编辑</span>
          </div>
          <div style="display:flex;gap:8px">
            <button v-if="isAdmin" @click="openNewTask('')"
              style="padding:6px 14px;font-size:13px;border:1px solid #d97706;background:#d97706;color:#fff;border-radius:6px;cursor:pointer;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.06)">+ 新增任务</button>
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
            <!-- 任务清单表头（6 列：标签 / 任务名 / 负责人 / 状态 / 时间(ETA或完成) / 备注）-->
            <div style="display:grid;grid-template-columns:100px minmax(0,1.6fr) 110px 100px 110px minmax(0,1.4fr);gap:0;background:#f8f8f7;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted)">
              <div style="padding:7px 12px;border-right:1px solid var(--border)">任务标签</div>
              <div style="padding:7px 12px;border-right:1px solid var(--border)">任务名称</div>
              <div style="padding:7px 12px;border-right:1px solid var(--border)">负责人</div>
              <div style="padding:7px 12px;border-right:1px solid var(--border)">状态</div>
              <div style="padding:7px 12px;border-right:1px solid var(--border)" title="进行中显示「预计完成」(管理员可改)；已完成显示「完成时间」(自动)">时间</div>
              <div style="padding:7px 12px">备注</div>
            </div>
            <!-- 任务行（Excel 式：点击单元格 → 直接编辑 → 失焦/回车自动保存）-->
            <div style="display:flex;flex-direction:column">
              <template v-for="(task, ti) in item.tasks" :key="task.id">
              <div
                :style="{display:'grid',gridTemplateColumns:'100px minmax(0,1.6fr) 110px 100px 110px minmax(0,1.4fr)',gap:'0',alignItems:'stretch',
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

                <!-- 任务名称（admin 点击改）+ 红点：本周新增（created_at 落在本 ISO 周内）-->
                <div :style="{padding:'8px 10px',display:'flex',alignItems:'center',gap:'6px',borderRight:'1px solid var(--border)',overflow:'hidden',cursor:isAdmin?'pointer':'default'}"
                     @click="!isEditing(task.id,'detail') && isAdmin && startCellEdit(task,'detail')">
                  <span v-if="isNewThisWeek(task)" title="本周新增任务"
                        style="width:8px;height:8px;border-radius:50%;background:#dc2626;flex-shrink:0;box-shadow:0 0 0 2px #fee2e2"></span>
                  <input v-if="isEditing(task.id,'detail')" v-model="cellDraft" :data-cell-edit="task.id+'-detail'"
                    @blur="saveCellEdit(task)" @keydown.enter="saveCellEdit(task)" @keydown.esc="cancelCellEdit"
                    style="flex:1;font-size:12px;border:1px solid var(--accent);border-radius:5px;padding:3px 6px;outline:none;min-width:0">
                  <div v-else style="font-size:12px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0" :title="task.detail">{{ task.detail || '—' }}</div>
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

                <!-- 时间列：开始 ~ 结束（任务自己的起止日，跨期可保留）-->
                <!-- 已完成 → 完成时间；其它 → start_date ~ eta_date，缺啥用周期默认 -->
                <div style="padding:6px 8px;display:flex;align-items:center;gap:4px;border-right:1px solid var(--border);font-size:11px">
                  <!-- 已完成 + 编辑 completed_at（仅管理员）-->
                  <template v-if="isStatusDone(task.status)">
                    <input v-if="isEditing(task.id,'completed_at')" type="date" v-model="cellDraft" :data-cell-edit="task.id+'-completed_at'"
                      @change="saveCellEdit(task)" @blur="saveCellEdit(task)" @keydown.enter="saveCellEdit(task)" @keydown.esc="cancelCellEdit"
                      style="font-size:11px;border:1px solid var(--accent);border-radius:5px;padding:2px 4px;background:#fff;width:100%">
                    <span v-else style="color:#16a34a;cursor:pointer"
                      :title="isAdmin ? '点击改完成时间' : '完成时间'"
                      @click="isAdmin && startCellEdit(task,'completed_at')">
                      ✓ {{ fmtCompletedSmart(task) }}
                    </span>
                  </template>
                  <!-- 待开始 / 进行中：start_date ~ eta_date 双格 -->
                  <template v-else>
                    <!-- 开始日期 -->
                    <input v-if="isEditing(task.id,'start_date')" type="date" v-model="cellDraft" :data-cell-edit="task.id+'-start_date'"
                      @change="saveCellEdit(task)" @blur="saveCellEdit(task)" @keydown.enter="saveCellEdit(task)" @keydown.esc="cancelCellEdit"
                      style="font-size:11px;border:1px solid var(--accent);border-radius:4px;padding:1px 3px;background:#fff;width:48%">
                    <span v-else
                      :style="{color: task.start_date ? '#16a34a' : '#9ca3af', cursor: isAdmin?'pointer':'default'}"
                      :title="isAdmin ? '点击改开始日期' : '开始日期'"
                      @click="isAdmin && startCellEdit(task,'start_date')">
                      {{ task.start_date ? fmtEtaDate(task.start_date) : periodStartDateDisplay || '—' }}
                    </span>
                    <span style="color:#9ca3af">~</span>
                    <!-- 截止日期 -->
                    <input v-if="isEditing(task.id,'eta_date')" type="date" v-model="cellDraft" :data-cell-edit="task.id+'-eta_date'"
                      @change="saveCellEdit(task)" @blur="saveCellEdit(task)" @keydown.enter="saveCellEdit(task)" @keydown.esc="cancelCellEdit"
                      style="font-size:11px;border:1px solid var(--accent);border-radius:4px;padding:1px 3px;background:#fff;width:48%">
                    <span v-else
                      :style="{color: task.eta_date ? '#f59e0b' : '#9ca3af', cursor: isAdmin?'pointer':'default'}"
                      :title="isAdmin ? '点击改截止日期' : '截止日期'"
                      @click="isAdmin && startCellEdit(task,'eta_date')">
                      {{ task.eta_date ? fmtEtaDate(task.eta_date) : periodEndDateDisplay || '—' }}
                    </span>
                  </template>
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
              <!-- 展开的评论区（支持拖拽图片到任意位置）-->
              <div v-if="expandedTaskId === task.id"
                   style="padding:14px 16px;background:#fff7ed;border-bottom:1px solid var(--border)"
                   @click.stop
                   @dragover.prevent
                   @drop.prevent="onCommentDrop(task.id, $event)">
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
                      <!-- 多图缩略（兼容旧 image_data 单字符串 + 新 images 数组）-->
                      <div v-if="(c.images && c.images.length) || (c.image_data && (Array.isArray(c.image_data) ? c.image_data.length : true))"
                           style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">
                        <img v-for="(im, ii) in (c.images || (Array.isArray(c.image_data) ? c.image_data : [c.image_data]))" :key="ii"
                             :src="im" @click="previewImage=im"
                             style="width:60px;height:60px;object-fit:cover;border-radius:6px;cursor:zoom-in;border:1px solid var(--border)">
                      </div>
                    </div>
                  </div>
                </div>
                <!-- 添加评论：textarea 支持粘贴图（Cmd+V）；可拖拽到整个区域；可点 Cmd+Enter 发送 -->
                <div style="display:flex;gap:8px;align-items:flex-start">
                  <textarea
                    :data-comment-textarea="task.id"
                    :value="(commentDraft[task.id]||{}).text || ''"
                    @input="commentDraft[task.id] = {...(commentDraft[task.id]||{}), text: $event.target.value}"
                    @paste="onCommentPaste(task.id, $event)"
                    @keydown.meta.enter="sendComment(task.id)"
                    @keydown.ctrl.enter="sendComment(task.id)"
                    placeholder="写记录或反馈。可拖图、可粘贴截图（Cmd+V）、Cmd+Enter 发送" rows="2"
                    style="flex:1;border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:12px;resize:vertical;font-family:inherit"></textarea>
                  <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;align-items:stretch">
                    <label style="border:1px solid var(--border);background:#fff;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;color:var(--muted);text-align:center">
                      📷 选图（多张）
                      <input type="file" accept="image/*" multiple @change="onCommentImagePick(task.id, $event)" style="display:none">
                    </label>
                    <button @click="sendComment(task.id)" :disabled="(commentDraft[task.id]||{}).sending"
                      style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:6px;padding:4px 14px;font-size:11px;cursor:pointer;font-weight:600;white-space:nowrap">
                      {{ (commentDraft[task.id]||{}).sending ? '...' : '发送' }}
                    </button>
                  </div>
                </div>
                <!-- 多图预览 -->
                <div v-if="((commentDraft[task.id]||{}).images || []).length" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">
                  <div v-for="(img, idx) in (commentDraft[task.id]||{}).images" :key="idx" style="position:relative">
                    <img :src="img" style="width:60px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--border);display:block">
                    <button @click="removeCommentImage(task.id, idx)"
                      style="position:absolute;top:-4px;right:-4px;width:18px;height:18px;border-radius:50%;border:1px solid #fecaca;background:#fff;color:#dc2626;font-size:11px;cursor:pointer;line-height:1;padding:0">×</button>
                  </div>
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

  <!-- 新增任务 Modal — 标签/名称 用 datalist：可以选已有的，也可以填全新的（全新的会打红点）-->
  <div v-if="newTaskModal.show" @click.self="closeNewTask"
    style="position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:1000">
    <div style="width:480px;max-width:92vw;background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 24px 60px rgba(15,23,42,.25)">
      <div style="font-size:14px;font-weight:700;margin-bottom:14px">新增任务（仅管理员）</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">商品 PID *</div>
          <input v-model="newTaskModal.pid" placeholder="如：690221882602" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
          <div style="font-size:10px;color:var(--muted);margin-top:3px">从单品页或商品管理复制 PID</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">任务标签 *（一级分类，可选已有/可填新的）</div>
          <input v-model="newTaskModal.category" list="new-task-cats" placeholder="如：标题优化 / 评价与问大家 …" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
          <datalist id="new-task-cats">
            <option v-for="c in newTaskCategories" :key="c" :value="c"></option>
          </datalist>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">任务名称 *（二级分类，自动落到当前标签下）</div>
          <input v-model="newTaskModal.detail" list="new-task-names" placeholder="如：结合小红书/淘宝热搜词，优化链接标题" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
          <datalist id="new-task-names">
            <option v-for="t in newTaskTemplatesInCat" :key="t.id" :value="t.detail"></option>
          </datalist>
          <div style="font-size:10px;color:#dc2626;margin-top:3px" v-if="newTaskModal.category && newTaskModal.detail && !taskTemplates.find(t=>t.category===newTaskModal.category.trim()&&t.detail===newTaskModal.detail.trim())">
            ⚠ 全新任务（不在 9 个固定任务里），本周会标红点
          </div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">负责人 *</div>
          <select v-model="newTaskModal.owner" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#fff">
            <option value="">— 选负责人 —</option>
            <option v-for="o in TASK_OWNERS_ALL" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>
        <div style="font-size:10px;color:var(--muted)">周期自动写：{{ activePeriod || '—' }}（周一-周日）</div>
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
      <div style="font-size:14px;font-weight:700;margin-bottom:14px">{{ periodModal.mode === 'edit' ? '修改任务周期' : '新建任务周期' }}</div>
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

