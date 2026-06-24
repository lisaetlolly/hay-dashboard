// ── ProductsPage.js ─────────────────────────────────────────
// 商品看板页组件。依赖：api.js / compute.js / utils.js / InteractiveTrendChart（全局）。

const ProductsPage = defineComponent({
  name: 'ProductsPage',
  components: { InteractiveTrendChart },
  props: ['start', 'end'],
  setup(props) {
    const filterCat = ref('全部')
    const filterXhs = ref(false)
    const searchQ = ref('')
    const sortBy = ref('gmv')
    const displayMode = ref('卡片')
    const selectedChartMetrics = ref(['gmv','vis','cart_rate','ad_roi','fav_cart','new_buyers'])

    const s = computed(() => props.start || RAW.launch_date)
    const e = computed(() => props.end || RAW.data_end)
    const periodLabel = computed(() => s.value===e.value ? s.value : `${s.value} ~ ${e.value}`)
    const sortOpts = [
      {k:'gmv',l:'销售额'},{k:'vis',l:'UV'},{k:'cart_rate',l:'加购率'},{k:'ad_spend',l:'投放花费'},{k:'ad_roi',l:'ROI'}
    ]
    const summaryMetrics = [
      { k:'gmv',           l:'销售额',     fmt:'money' },
      { k:'vis',           l:'UV',         fmt:'num'   },
      { k:'cart_rate',     l:'加购率',     fmt:'pct'   },
      { k:'conv_rate',     l:'转化率',     fmt:'pct'   },
      { k:'ad_roi',        l:'ROI',        fmt:'x'     },
      { k:'fav_cart',      l:'收藏加购',   fmt:'num'   },
      { k:'new_buyers',    l:'新客数',     fmt:'num'   },
      { k:'refund',        l:'退款金额',   fmt:'money' },
      { k:'ad_spend',      l:'投放花费',   fmt:'money' },
      { k:'ad_ctr',        l:'投放CTR',    fmt:'pct'   },
      { k:'pv',            l:'浏览量',     fmt:'num'   },
      { k:'dwell_time',    l:'停留时长',   fmt:'sec'   },
      { k:'bounce_rate',   l:'跳出率',     fmt:'pct'   },
      { k:'fav_cart_users',l:'收藏加购人数',fmt:'num'  },
      { k:'search_vis',    l:'搜索引导UV', fmt:'num'   },
    ]
    const chartMetricGroups = [
      { label:'站内', items:[
        { key:'gmv',            name:'售卖金额',    color:'#d8b4fe', fmt:'money' },
        { key:'cart_rate',      name:'加购率',      color:'#f59e0b', fmt:'pct'   },
        { key:'conv_rate',      name:'转化率',      color:'#34d399', fmt:'pct'   },
        { key:'ad_roi',         name:'ROI',         color:'#f43f5e', fmt:'x'     },
        { key:'fav_cart',       name:'收藏加购',    color:'#a78bfa', fmt:'num'   },
        { key:'new_buyers',     name:'新客数',      color:'#14b8a6', fmt:'num'   },
        { key:'ad_ctr',         name:'投放CTR',     color:'#ec4899', fmt:'pct'   },
        { key:'ad_spend',       name:'投放花费',    color:'#60a5fa', fmt:'money' },
        { key:'pv',             name:'浏览量',      color:'#818cf8', fmt:'num'   },
        { key:'dwell_time',     name:'停留时长(s)', color:'#06b6d4', fmt:'sec'   },
        { key:'bounce_rate',    name:'跳出率',      color:'#fb7185', fmt:'pct'   },
        { key:'fav_cart_users', name:'收藏加购人数',color:'#c084fc', fmt:'num'   },
        { key:'search_vis',     name:'搜索引导UV',  color:'#4ade80', fmt:'num'   },
      ]},
      { label:'站外', items:[
        { key:'xhs_inter', name:'小红书互动量', color:'#fb923c', fmt:'num' },
      ]},
    ]

    const subDays = (dateStr, n) => { const d = new Date(dateStr); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10) }
    const fmt = (v, type) => {
      if (v == null) return '—'
      const n = Number(v)
      if (type === 'money') return n >= 10000 ? '¥' + (n/10000).toFixed(1) + '万' : '¥' + n.toFixed(0)
      if (type === 'pct') return n === 0 ? '—' : n.toFixed(2) + '%'
      if (type === 'x') return n === 0 ? '—' : n.toFixed(2) + 'x'
      if (type === 'sec') return n === 0 ? '—' : n >= 60 ? (n/60).toFixed(1) + 'min' : Math.round(n) + 's'
      return Math.round(n).toLocaleString()
    }
    const fchg = v => v == null ? '—' : ((v>0?'+':'') + v.toFixed(1) + '%')
    const chgCls = v => v == null ? 'flat' : v>0 ? 'up' : 'dn'
    const imgSrc = pid => (APP_STATE.value.imageOverrides || {})[pid] || RAW.img_map?.[pid] || ''

    function agg(p, s, e) {
      const prev = s === e ? { s: subDays(s,1), e: subDays(e,1) } : prevRange(s, e)
      let pay=0,vis=0,cart=0,cart_qty_total=0,collect=0,refund=0,spend=0,ctr_s=0,ctr_n=0,ppay=0,pvis=0
      let newBuyers=0, payBuyers=0
      // ad_gmv = 推广带来的 GMV（直接+间接），由 daily roi[i] * spend[i] 反算
      // 之前 ad_roi 用 pay/spend 实际算的是 PSR（销售杠杆），不是真 ROI
      let ad_gmv_total = 0
      const daily=[]
      for (let i=0;i<p.dates.length;i++) {
        const d = p.dates[i]
        if (d>=s && d<=e) {
          const gmv = p.pay[i]||0, uv = p.vis[i]||0, cartN = p.cart[i]||0, rf = p.refund?.[i]||0
          const colN = p.collect?.[i]||0
          const cartQtyN = p.cart_qty?.[i]||0
          const nb = p.new_buyers?.[i]||0
          // 支付买家数 = 新客 + 老客（兼容旧 RAW 没有 pay_buyers/old_buyers 字段时回退）
          const pb = (p.pay_buyers?.[i] != null) ? p.pay_buyers[i]
                   : (nb + (p.old_buyers?.[i]||0))
          const spFromProduct = p.spend?.[i]||0
          const spFromDaily = RAW.pid_daily_spend?.[p.pid]?.[d]?.spend || 0
          const sp = spFromProduct > 0 ? spFromProduct : spFromDaily
          // 当日推广 GMV = roi * spend（roi 来自 fact_wxst_product，已经是推广 GMV/花费）
          const adGmv = (p.roi?.[i] || 0) * sp
          pay += gmv; vis += uv; cart += cartN; collect += colN; refund += rf; spend += sp; cart_qty_total += cartQtyN
          newBuyers += nb; payBuyers += pb
          ad_gmv_total += adGmv
          if ((p.ctr?.[i]||0)>0) { ctr_s += p.ctr[i]*100; ctr_n++ }
          const xhsInter = (RAW.xhs_notes||[]).filter(n => n.pid===p.pid && n.date===d).reduce((a,n)=>a+(n.inter||0),0)
          const pv_v          = p.pv?.[i]            ?? null
          const dwell_v       = p.dwell_time?.[i]    ?? null
          const bounce_v      = p.bounce_rate?.[i]   ?? null
          const fav_cu_v      = p.fav_cart_users?.[i]?? null
          const search_vis_v  = p.search_vis?.[i]    ?? null
          daily.push({
            d, gmv, uv, refund: rf, spend: sp, nb,
            fav_cart: cartQtyN + colN,  // sycm 收藏加购 = 加购件数+收藏人数
            cart_rate: uv>0 ? cartN/uv*100 : null,
            // 转化率 = 支付买家 / UV (不再等同于加购率)
            conv_rate: uv>0 ? pb/uv*100 : null,
            // 当日 ad_roi = 推广 GMV ÷ 推广花费（不是 全店GMV/spend，那是销售杠杆）
            ad_roi: sp>0 ? +(adGmv/sp).toFixed(2) : null,
            // 销售杠杆 PSR = 全店 GMV / 推广花费（以前误叫 ROI 的那个）
            psr: sp>0 ? +(gmv/sp).toFixed(2) : null,
            ad_ctr: (p.ctr?.[i]||0)>0 ? p.ctr[i]*100 : null,
            xhs_inter: xhsInter,
            pv: pv_v,
            dwell_time: dwell_v,
            bounce_rate: bounce_v,
            fav_cart_users: fav_cu_v,
            search_vis: search_vis_v,
          })
        }
        if (d>=prev.s && d<=prev.e) { ppay += p.pay[i]||0; pvis += p.vis[i]||0 }
      }
      const xhsList = (RAW.xhs_notes||[]).filter(n=>n.pid===p.pid&&n.date>=s&&n.date<=e)
      // 任务只显示当前周期；用 activePeriod（已经在 setup 末尾定义为「APP_STATE.selectedTaskPeriod || apiCurrentPeriod」）
      const _all = APP_STATE.value.tasksByPid?.[p.pid]||[]
      const _curPeriod = activePeriod.value || ''
      const allTasks = _curPeriod
        ? _all.filter(t => (t.time_range_label || '').includes(_curPeriod) || (t.period_notes && t.period_notes[_curPeriod]))
        : _all
      const pct = (a,b)=>b>0?+((a-b)/b*100).toFixed(1):null
      return {
        gmv:+pay.toFixed(2), vis:Math.round(vis),
        cart_rate: vis>0 ? +(cart/vis*100).toFixed(2) : null,
        // 转化率 = 支付买家 / UV，不是加购率
        conv_rate: vis>0 ? +(payBuyers/vis*100).toFixed(2) : null,
        fav_cart: cart_qty_total + collect,  // 件数+收藏人数
        new_buyers: newBuyers,
        pay_buyers: payBuyers,
        refund:+refund.toFixed(2), ad_spend:+spend.toFixed(2),
        ad_ctr: ctr_n>0 ? +(ctr_s/ctr_n).toFixed(2) : null,
        // 真 ROI = 推广带来的 GMV ÷ 推广花费（业界标准；万象台后台口径）
        ad_roi: spend>0 ? +(ad_gmv_total/spend).toFixed(2) : null,
        // 销售杠杆 PSR = 全店 GMV ÷ 推广花费（含自然流量功劳，sycm 主页那个 30.28x）
        psr: spend>0 ? +(pay/spend).toFixed(2) : null,
        pv: p.pv ? p.pv.filter((_,i)=>p.dates[i]>=s&&p.dates[i]<=e).reduce((a,v)=>a+(v||0),0) : null,
        dwell_time: (() => { const vs=p.dwell_time?.filter?.((_,i)=>p.dates[i]>=s&&p.dates[i]<=e).filter(v=>v>0)||[]; return vs.length?+(vs.reduce((a,v)=>a+v,0)/vs.length).toFixed(1):null })(),
        bounce_rate: (() => { const vs=p.bounce_rate?.filter?.((_,i)=>p.dates[i]>=s&&p.dates[i]<=e).filter(v=>v>0)||[]; return vs.length?+(vs.reduce((a,v)=>a+v,0)/vs.length).toFixed(2):null })(),
        fav_cart_users: p.fav_cart_users ? p.fav_cart_users.filter((_,i)=>p.dates[i]>=s&&p.dates[i]<=e).reduce((a,v)=>a+(v||0),0) : null,
        search_vis: p.search_vis ? p.search_vis.filter((_,i)=>p.dates[i]>=s&&p.dates[i]<=e).reduce((a,v)=>a+(v||0),0) : null,
        gmv_chg:pct(pay,ppay), vis_chg:pct(vis,pvis),
        xhs_notes:xhsList.length, xhsList, allTasks, daily,
      }
    }

    // 事件标注（大促/活动/上新等）—— 按 pid 过滤，'*' 表示全局事件
    const eventsForPid = pid => {
      const all = APP_STATE.value.events || []
      return all.filter(ev => ev && (ev.pid === pid || ev.pid === '*'))
        .sort((a,b) => (a.start_date||'').localeCompare(b.start_date||''))
    }

    const products = computed(() => {
      const sv=s.value, ev=e.value
      return getEffectiveProducts()
        .filter(p => OFFICIAL.has(p.pid))
        .filter(p => filterCat.value==='全部' || p.cat===filterCat.value)
        .filter(p => !searchQ.value || p.name.toLowerCase().includes(searchQ.value.toLowerCase()) || p.pid.includes(searchQ.value))
        .map(p => ({ ...p, ...agg(p, sv, ev), events: eventsForPid(p.pid) }))
        .filter(p => !filterXhs.value || p.xhs_notes > 0)
        .sort((a,b) => (b[sortBy.value]||0) - (a[sortBy.value]||0))
    })

    // 事件 CRUD（权限控制）
    const currentUser = computed(() => currentUserObj())
    const canEvent = code => hasPermission(currentUser.value, code)

    // 标签颜色精简：3 类色系（暖/冷/灰），不和任务状态色（绿/橙/灰）打架。
    const EVENT_CATEGORIES = [
      { k:'promo',    l:'大促',   color:'#e5484d' },  // 暖（红）
      { k:'activity', l:'活动',   color:'#e5484d' },  // 暖（红，与大促同色系，仅文字区分）
      { k:'launch',   l:'上新',   color:'#0ea5e9' },  // 冷（蓝）
      { k:'marketing',l:'营销',   color:'#0ea5e9' },  // 冷（蓝）
      { k:'other',    l:'其他',   color:'#64748b' },  // 灰
    ]
    const colorOfCategory = c => (EVENT_CATEGORIES.find(x=>x.k===c)?.color) || '#64748b'
    const labelOfCategory = c => (EVENT_CATEGORIES.find(x=>x.k===c)?.l) || '其他'
    const eventModal = ref({ show:false, mode:'add', id:'', pid:'', title:'', category:'promo', start_date:'', end_date:'', note:'' })
    const openAddEvent = (pid) => {
      if (!canEvent('event.create')) return alert('无权限新增事件')
      const today = new Date().toISOString().slice(0,10)
      Object.assign(eventModal.value, { show:true, mode:'add', id:'', pid, title:'', category:'promo', start_date: today, end_date:'', note:'' })
    }
    const openEditEvent = (pid, ev) => {
      if (!canEvent('event.edit')) return alert('无权限编辑事件')
      Object.assign(eventModal.value, { show:true, mode:'edit', id:ev.id, pid, title:ev.title||'', category:ev.category||'other', start_date:ev.start_date||'', end_date:ev.end_date||'', note:ev.note||'' })
    }
    const closeEventModal = () => { eventModal.value.show = false }
    const saveEvent = () => {
      const m = eventModal.value
      if (!m.title.trim())     return alert('请填写事件名称')
      if (!m.start_date)       return alert('请选择开始日期')
      if (m.end_date && m.end_date < m.start_date) return alert('结束日期不能早于开始日期')
      if (!APP_STATE.value.events) APP_STATE.value.events = []
      const list = APP_STATE.value.events
      const payload = {
        id: m.mode==='edit' ? m.id : ('evt_' + Math.random().toString(36).slice(2,10)),
        pid: m.pid, title: m.title.trim(), category: m.category,
        start_date: m.start_date, end_date: m.end_date || '',
        color: colorOfCategory(m.category), note: m.note.trim(),
      }
      if (m.mode === 'edit') {
        const idx = list.findIndex(x => x.id === m.id)
        if (idx >= 0) list[idx] = payload; else list.push(payload)
      } else {
        list.push(payload)
      }
      persistAppState()
      closeEventModal()
    }
    const deleteEvent = (id) => {
      if (!canEvent('event.delete')) return alert('无权限删除事件')
      if (!confirm('确认删除此事件？')) return
      const list = APP_STATE.value.events || []
      const idx = list.findIndex(x => x.id === id)
      if (idx >= 0) { list.splice(idx, 1); persistAppState() }
    }

    // ── 任务 新增（POST /api/tasks，刷新本地 tasksByPid）──
    const TASK_CATEGORIES = ['标题优化','评价与问大家','淘内内容宣发','详情页优化','竞品分析','妈妈计划迭代','售卖复盘','其他']
    const TASK_OWNERS     = ['Jas team（内容）','豆豆（设计）','刘婷（商品）','晓东（运营）','婉婷（主管）']
    const taskModal = ref({ show:false, pid:'', detail:'', category:'标题优化', owner:'Jas team（内容）', status:'待开始', priority:'中', execution_note:'', saving:false })
    const openAddTask = (pid) => {
      if (!canEvent('task.create')) return alert('无权限新增任务')
      Object.assign(taskModal.value, { show:true, pid, detail:'', category:'标题优化', owner:'Jas team（内容）', status:'待开始', priority:'中', execution_note:'', saving:false })
    }
    const closeTaskModal = () => { taskModal.value.show = false }
    const saveTask = async () => {
      const m = taskModal.value
      if (!m.detail.trim()) return alert('请填写任务名称')
      m.saving = true
      try {
        const period = activePeriod.value || ''
        const body = {
          product_id: m.pid, detail: m.detail.trim(),
          owner: m.owner, status: m.status, priority: m.priority,
          category: m.category, time_range_label: period,
          execution_note: m.execution_note.trim() || null,
        }
        const res = await fetch('/api/tasks', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json().catch(()=>({detail:'网络错误'}))
          throw new Error(err.detail || ('HTTP ' + res.status))
        }
        const newTask = await res.json()
        // 同步到 APP_STATE，免得用户等 RAW 重拉
        if (!APP_STATE.value.tasksByPid) APP_STATE.value.tasksByPid = {}
        const list = APP_STATE.value.tasksByPid[m.pid] || []
        list.push({
          id: newTask.id, detail: newTask.detail, owner: newTask.owner,
          status: newTask.status, priority: newTask.priority,
          category: newTask.category, period_notes: {},
          time_range_label: newTask.time_range_label,
          execution_note: newTask.execution_note || '',
        })
        APP_STATE.value.tasksByPid[m.pid] = list
        persistAppState()
        closeTaskModal()
      } catch (e) {
        alert('新增失败：' + e.message)
        m.saving = false
      }
    }

    // ── 小红书笔记 新增（暂存 APP_STATE.events 不合适，单独存 customXhsNotes，与 RAW.xhs_notes 合并）──
    const XHS_FIELDS = ['title','link','date','author','likes','collect','comments','views']
    const xhsModal = ref({ show:false, pid:'', title:'', link:'', date:'', author:'', likes:0, collect:0, comments:0, views:0, saving:false })
    const openAddXhs = (pid) => {
      if (!canEvent('xhs.create')) return alert('无权限新增笔记')
      const today = new Date().toISOString().slice(0,10)
      Object.assign(xhsModal.value, { show:true, pid, title:'', link:'', date: today, author:'', likes:0, collect:0, comments:0, views:0, saving:false })
    }
    const closeXhsModal = () => { xhsModal.value.show = false }
    const saveXhs = async () => {
      const m = xhsModal.value
      if (!m.title.trim()) return alert('请填写笔记标题')
      if (!m.link.trim())  return alert('请填写笔记链接')
      m.saving = true
      try {
        const body = {
          pid: m.pid, title: m.title.trim(), link: m.link.trim(),
          date: m.date || null, author: m.author.trim() || null,
          likes: +m.likes||0, collect: +m.collect||0,
          comments: +m.comments||0, views: +m.views||0,
        }
        const res = await fetch('/api/xhs-notes', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json().catch(()=>({detail:'保存失败'}))
          throw new Error(err.detail || ('HTTP ' + res.status))
        }
        const newNote = await res.json()
        // 同步到 RAW.xhs_notes，避免等 reload
        if (!Array.isArray(RAW.xhs_notes)) RAW.xhs_notes = []
        RAW.xhs_notes.push(newNote)
        // 更新 xhs_by_pid 聚合
        if (!RAW.xhs_by_pid) RAW.xhs_by_pid = {}
        const agg = RAW.xhs_by_pid[m.pid] || { notes:0,likes:0,collect:0,comments:0,inter:0,views:0 }
        agg.notes++
        agg.likes    += newNote.likes
        agg.collect  += newNote.collect
        agg.comments += newNote.comments
        agg.inter    += newNote.inter
        agg.views    += newNote.views
        RAW.xhs_by_pid[m.pid] = agg
        closeXhsModal()
      } catch (err) {
        alert('保存失败：' + err.message)
        m.saving = false
      }
    }

    const toggleChartMetric = key => {
      selectedChartMetrics.value = selectedChartMetrics.value.includes(key)
        ? (selectedChartMetrics.value.length > 1 ? selectedChartMetrics.value.filter(x => x !== key) : selectedChartMetrics.value)
        : [...selectedChartMetrics.value, key]
    }
    const isChartMetricSelected = key => selectedChartMetrics.value.includes(key)

    const filteredSummaryMetrics = computed(() => summaryMetrics.filter(m => selectedChartMetrics.value.includes(m.k)))
    const chartMetricMap = key => chartMetricGroups.flatMap(g => g.items).find(x => x.key === key)
    const productChartSeries = daily => selectedChartMetrics.value.map(key => {
      const meta = chartMetricMap(key)
      if (!meta) return null
      const sourceKey = key === 'ad_spend' ? 'spend'
        : key === 'ad_roi' ? 'ad_roi'
        : key === 'conv_rate' ? 'conv_rate'
        : key === 'fav_cart' ? 'fav_cart'
        : key === 'new_buyers' ? 'nb'
        : key
      return {
        key: meta.key,
        name: meta.name,
        color: meta.color,
        type: meta.fmt === 'money' || meta.fmt === 'num' ? 'bar' : 'line',
        values: (daily||[]).map(x => ({ d:x.d, value:x[sourceKey] != null ? x[sourceKey] : null, label:x[sourceKey] != null ? fmt(x[sourceKey], meta.fmt) : '—' }))
      }
    }).filter(Boolean).filter(s => s.values.some(v => v.value != null))

    const miniChart = daily => productChartSeries(daily).slice(0,1)

    const cardTabs = Vue.reactive({})
    const getCardTab = pid => cardTabs[pid] || 'daily'
    const setCardTab = (pid, tab) => { cardTabs[pid] = tab }

    const showMetricGuide = ref(false)
    const guideKeys = ['gmv','vis','cart_rate','conv_rate','ad_roi','fav_cart','new_buyers','refund','ad_ctr','pv','dwell_time','bounce_rate','fav_cart_users','search_vis','xhs_inter']
    const guideItems = guideKeys.map(k => ({ key:k, label:METRIC_TIPS[k]?.label||k, tip:METRIC_TIPS[k]?.tip||'' }))

    // 与投放面板共用同一个任务周期。优先用 APP_STATE 选中的，
    // 没选 / 选了已废弃周期 → 退回 API task_period.is_current=true 的周期。
    const apiCurrentPeriod = ref('')
    const apiKnownPeriods = ref([])
    ;(async () => {
      try {
        const res = await fetch('/api/task-periods')
        if (res.ok) {
          const list = await res.json()
          apiKnownPeriods.value = list.map(p => p.label)
          const cur = list.find(p => p.is_current)
          if (cur) apiCurrentPeriod.value = cur.label
          else if (list.length) apiCurrentPeriod.value = list[0].label  // 接口已按 start_date DESC，最新优先
        }
      } catch {}
    })()
    const activePeriod = computed(() => {
      const sel = APP_STATE.value.selectedTaskPeriod
      if (sel && apiKnownPeriods.value.includes(sel)) return sel
      return apiCurrentPeriod.value || sel || ''
    })

    return { filterCat, filterXhs, searchQ, sortBy, displayMode, periodLabel, sortOpts, products, summaryMetrics, chartMetricGroups, selectedChartMetrics, toggleChartMetric, isChartMetricSelected, filteredSummaryMetrics, fmt, fchg, chgCls, imgSrc, miniChart, productChartSeries, getCardTab, setCardTab, showMetricGuide, guideItems, activePeriod,
      EVENT_CATEGORIES, labelOfCategory, colorOfCategory, eventModal, openAddEvent, openEditEvent, closeEventModal, saveEvent, deleteEvent, canEvent,
      TASK_CATEGORIES, TASK_OWNERS, taskModal, openAddTask, closeTaskModal, saveTask,
      xhsModal, openAddXhs, closeXhsModal, saveXhs,
    }
  },
  template: `
<div style="display:flex;flex-direction:column;height:100%;gap:0">
  <!-- 指标说明：折叠到弹窗，不再占顶部一大块 -->
  <div v-if="showMetricGuide" @click.self="showMetricGuide=false"
       style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:12px;padding:20px;max-width:780px;max-height:80vh;overflow:auto;width:90%">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <span style="font-size:14px;font-weight:700">指标说明</span>
        <button @click="showMetricGuide=false" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--muted)">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px">
        <div v-for="item in guideItems" :key="item.key" style="padding:8px 10px;background:#f8f8f7;border-radius:8px;font-size:11px">
          <div style="font-weight:700;color:var(--text);margin-bottom:2px">{{ item.label }}</div>
          <div style="color:var(--muted);line-height:1.5">{{ item.tip }}</div>
        </div>
      </div>
    </div>
  </div>
  <div style="flex-shrink:0;padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid var(--border)">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <button @click="showMetricGuide=true" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#fff;cursor:pointer;color:var(--muted)" title="查看各指标口径">📖 指标说明</button>
      <input v-model="searchQ" placeholder="搜索商品名 / ID" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;outline:none;width:150px;background:var(--surface)">
      <div style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">
        <button v-for="c in ['全部','配饰','家具','灯具','其他']" :key="c" @click="filterCat=c" :style="{padding:'5px 10px',fontSize:'12px',border:'none',cursor:'pointer',background:filterCat===c?'var(--accent)':'transparent',color:filterCat===c?'#fff':'var(--muted)'}">{{ c }}</button>
      </div>
      <button @click="filterXhs=!filterXhs" :style="{padding:'5px 10px',fontSize:'12px',borderRadius:'6px',cursor:'pointer',border:filterXhs?'1.5px solid #ff2442':'1px solid var(--border)',background:filterXhs?'#fff0f2':'transparent',color:filterXhs?'#ff2442':'var(--muted)'}">有小红书笔记</button>
      <select v-model="sortBy" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;outline:none;background:var(--surface)"><option v-for="o in sortOpts" :key="o.k" :value="o.k">{{ o.l }}</option></select>
      <div style="flex:1"></div>
      <div style="display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#fafaf9">
        <button v-for="m in ['卡片','网格','列表']" :key="m" @click="displayMode=m" :style="{padding:'6px 12px',fontSize:'12px',border:'none',cursor:'pointer',background:displayMode===m?'var(--accent)':'transparent',color:displayMode===m?'#fff':'var(--muted)'}">{{ m }}</button>
      </div>
      <span style="font-size:11px;color:var(--muted)">{{ products.length }} 个 · {{ periodLabel }}</span>
    </div>
    <div style="display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:6px">
        <button @click="selectedChartMetrics=chartMetricGroups.flatMap(g=>g.items).map(i=>i.key)" style="padding:3px 8px;font-size:11px;border-radius:999px;cursor:pointer;border:1px solid var(--accent);background:var(--accent)14;color:var(--accent);font-weight:700">一键全选</button>
        <button @click="selectedChartMetrics=['gmv','vis','cart_rate','ad_roi','fav_cart','new_buyers']" style="padding:3px 8px;font-size:11px;border-radius:999px;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--muted)">重置</button>
      </div>
      <div v-for="group in chartMetricGroups" :key="group.label" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:11px;color:var(--muted);white-space:nowrap">{{ group.label }}</span>
        <button v-for="item in group.items" :key="item.key" @click="toggleChartMetric(item.key)"
                :style="{padding:'3px 8px',fontSize:'11px',borderRadius:'999px',cursor:'pointer',border:isChartMetricSelected(item.key)?'1px solid '+item.color:'1px solid var(--border)',background:isChartMetricSelected(item.key)?item.color+'14':'transparent',color:isChartMetricSelected(item.key)?item.color:'var(--muted)',fontWeight:isChartMetricSelected(item.key)?'700':'500'}">{{ item.name }}</button>
      </div>
    </div>
  </div>

  <div v-if="displayMode==='卡片'" style="display:flex;flex-direction:column;gap:12px;overflow:auto;padding-right:2px">
    <div v-for="p in products" :key="p.pid" class="card" style="padding:14px">
      <div style="display:grid;grid-template-columns:80px minmax(0,1fr) 230px;gap:14px;align-items:start">
        <div style="width:80px;height:80px;border:1px solid var(--border);border-radius:10px;background:#fafaf9;display:flex;align-items:center;justify-content:center">
          <img v-if="imgSrc(p.pid)" :src="imgSrc(p.pid)" style="max-width:72px;max-height:72px;object-fit:contain">
        </div>
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <div style="font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span>{{ p.name }}</span>
              <span v-if="p.alias_pids && p.alias_pids.length"
                    :title="'已合并副 SKU：' + p.alias_pids.join('、')"
                    style="display:inline-flex;align-items:center;padding:1px 6px;font-size:10px;font-weight:600;background:#fef3c7;color:#92400e;border-radius:4px;cursor:help;line-height:1.4">
                🔗 含 {{ p.alias_pids.length }} 个副 SKU
              </span>
            </div>
            <span style="font-size:10px;color:var(--muted);padding:2px 6px;border:1px solid var(--border);border-radius:99px">{{ p.cat }}</span>
            <span @click="setCardTab(p.pid, getCardTab(p.pid)==='xhs'?'daily':'xhs')" :style="{fontSize:'10px',padding:'2px 8px',border:'1px solid',borderColor:getCardTab(p.pid)==='xhs'?'#ff2442':'#ffccd5',background:getCardTab(p.pid)==='xhs'?'#ff2442':'#fff0f2',borderRadius:'99px',cursor:'pointer',color:getCardTab(p.pid)==='xhs'?'#fff':'#ff2442'}">小红书</span>
            <span @click="setCardTab(p.pid, getCardTab(p.pid)==='tasks'?'daily':'tasks')" :style="{fontSize:'10px',padding:'2px 8px',border:'1px solid',borderColor:getCardTab(p.pid)==='tasks'?'#c2790e':'#fde68a',background:getCardTab(p.pid)==='tasks'?'#c2790e':'#fffbeb',borderRadius:'99px',cursor:'pointer',color:getCardTab(p.pid)==='tasks'?'#fff':'#c2790e'}">任务</span>
            <span @click="setCardTab(p.pid, getCardTab(p.pid)==='events'?'daily':'events')" :style="{fontSize:'10px',padding:'2px 8px',border:'1px solid',borderColor:getCardTab(p.pid)==='events'?'#e5484d':'#fecaca',background:getCardTab(p.pid)==='events'?'#e5484d':'#fef2f2',borderRadius:'99px',cursor:'pointer',color:getCardTab(p.pid)==='events'?'#fff':'#e5484d'}">事件</span>
          </div>
          <div :style="{display:'grid',gridTemplateColumns:'repeat('+Math.min(filteredSummaryMetrics.length,5)+',minmax(72px,1fr))',gap:'10px',marginBottom:'10px'}">
            <div v-for="m in filteredSummaryMetrics" :key="m.k">
              <div style="font-size:10px;color:var(--muted);margin-bottom:2px">{{ m.l }}</div>
              <div style="font-size:14px;font-weight:700">{{ fmt(p[m.k],m.fmt) }}</div>
            </div>
          </div>
          <interactive-trend-chart :series="productChartSeries(p.daily)" :height="210" :normalize="true" :events="p.events" />
        </div>
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="font-size:12px;font-weight:700">{{ getCardTab(p.pid)==='xhs'?'小红书笔记':getCardTab(p.pid)==='tasks'?'本期任务':getCardTab(p.pid)==='events'?'事件标注':'日数据' }}</div>
            <span v-if="getCardTab(p.pid)!=='daily'" @click="setCardTab(p.pid,'daily')" style="font-size:10px;color:var(--muted);cursor:pointer;text-decoration:underline">返回日数据</span>
            <button v-if="getCardTab(p.pid)==='events' && canEvent('event.create')" @click="openAddEvent(p.pid)" style="margin-left:auto;padding:3px 8px;font-size:10px;border:1px solid #e5484d;background:#e5484d;color:#fff;border-radius:6px;cursor:pointer">+ 新增事件</button>
            <button v-if="getCardTab(p.pid)==='tasks' && canEvent('task.create')" @click="openAddTask(p.pid)" style="margin-left:auto;padding:3px 8px;font-size:10px;border:1px solid #c2790e;background:#c2790e;color:#fff;border-radius:6px;cursor:pointer">+ 新增任务</button>
            <button v-if="getCardTab(p.pid)==='xhs' && canEvent('xhs.create')" @click="openAddXhs(p.pid)" style="margin-left:auto;padding:3px 8px;font-size:10px;border:1px solid #ff2442;background:#ff2442;color:#fff;border-radius:6px;cursor:pointer">+ 新增笔记</button>
          </div>
          <template v-if="getCardTab(p.pid)==='xhs'">
            <div v-if="!p.xhsList.length" style="font-size:11px;color:var(--muted);padding:14px 8px;text-align:center;border:1px dashed var(--border);border-radius:8px">
              暂无笔记，点击右上角「+ 新增笔记」添加
            </div>
            <div v-else style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto">
              <div v-for="note in p.xhsList" :key="note.link" style="padding:6px 0;border-bottom:1px solid #f4f4f5;font-size:11px">
                <div style="font-weight:600;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a :href="note.link" target="_blank" style="color:var(--text);text-decoration:none">{{ note.title }}</a></div>
                <div style="display:flex;gap:8px;color:var(--muted)">
                  <span>{{ note.date }}</span><span>{{ note.author }}</span>
                  <span>互动 {{ note.inter }}</span><span>浏览 {{ note.views }}</span>
                </div>
              </div>
            </div>
          </template>
          <template v-else-if="getCardTab(p.pid)==='events'">
            <div v-if="!p.events.length" style="font-size:11px;color:var(--muted);padding:14px 8px;text-align:center;border:1px dashed var(--border);border-radius:8px">
              暂无事件，点击右上角「+ 新增事件」添加
            </div>
            <div v-else style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow:auto">
              <div v-for="ev in p.events" :key="ev.id"
                :style="{padding:'8px 10px',border:'1px solid '+ (ev.color||'#7c3aed')+'33',background:(ev.color||'#7c3aed')+'08',borderLeft:'3px solid '+(ev.color||'#7c3aed'),borderRadius:'8px',fontSize:'11px'}">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                  <span :style="{fontSize:'9px',padding:'1px 6px',background:ev.color||'#7c3aed',color:'#fff',borderRadius:'99px',fontWeight:'700'}">{{ labelOfCategory(ev.category) }}</span>
                  <span style="font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ ev.title }}</span>
                  <span v-if="ev.pid==='*'" style="font-size:9px;color:var(--muted);border:1px solid var(--border);border-radius:99px;padding:0 5px">全局</span>
                </div>
                <div style="color:var(--muted);font-size:10px;margin-bottom:3px">
                  <span>{{ ev.start_date }}</span>
                  <span v-if="ev.end_date && ev.end_date !== ev.start_date"> ~ {{ ev.end_date }}</span>
                  <span v-else-if="!ev.end_date"> · 单点 / 进行中</span>
                </div>
                <div v-if="ev.note" style="color:var(--text);font-size:10px;background:#fff;border-radius:4px;padding:3px 5px;margin-bottom:4px">{{ ev.note }}</div>
                <div v-if="canEvent('event.edit')||canEvent('event.delete')" style="display:flex;gap:6px">
                  <button v-if="canEvent('event.edit')" @click="openEditEvent(p.pid, ev)" style="font-size:10px;padding:2px 8px;border:1px solid var(--border);background:#fff;border-radius:4px;cursor:pointer;color:var(--muted)">编辑</button>
                  <button v-if="canEvent('event.delete')" @click="deleteEvent(ev.id)" style="font-size:10px;padding:2px 8px;border:1px solid #fecaca;background:#fff;border-radius:4px;cursor:pointer;color:#e5484d">删除</button>
                </div>
              </div>
            </div>
          </template>
          <template v-else-if="getCardTab(p.pid)==='tasks'">
            <div style="font-size:10px;color:var(--muted);margin-bottom:6px">周期：{{ activePeriod || '全部' }}</div>
            <div v-if="!p.allTasks.length" style="font-size:11px;color:var(--muted);padding:14px 8px;text-align:center;border:1px dashed var(--border);border-radius:8px">
              暂无任务，点击右上角「+ 新增任务」添加
            </div>
            <div v-else style="display:flex;flex-direction:column;gap:4px;max-height:220px;overflow:auto">
              <div v-for="task in p.allTasks"
                   :key="task.id" style="padding:6px 0;border-bottom:1px solid #f4f4f5;font-size:11px">
                <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:nowrap">
                  <span style="font-size:10px;color:var(--muted);border:1px solid var(--border);border-radius:99px;padding:1px 5px;flex-shrink:0;white-space:nowrap">{{ task.category }}</span>
                  <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">{{ task.detail }}</span>
                </div>
                <div style="margin-top:2px;color:var(--muted);display:flex;gap:8px;align-items:center">
                  <span>{{ task.owner }}</span>
                  <span style="font-size:10px;padding:1px 5px;border-radius:99px;background:#f3f4f6">{{ task.status||'—' }}</span>
                </div>
                <div v-if="activePeriod && (task.period_notes||{})[activePeriod]" style="margin-top:2px;font-size:10px;color:var(--text);background:#f8f8f7;border-radius:4px;padding:2px 5px">{{ task.period_notes[activePeriod] }}</div>
              </div>
            </div>
          </template>
          <template v-else>
          <div :style="{maxHeight:p.daily.length>7?'220px':'none',overflowY:p.daily.length>7?'auto':'visible',paddingRight:p.daily.length>7?'4px':'0'}">
            <div style="display:grid;grid-template-columns:42px 1fr 1fr 1fr 1fr;gap:4px;padding:0 0 4px;border-bottom:1px solid #f4f4f5;font-size:10px;font-weight:700;color:var(--muted)">
              <span>日期</span><span>销售</span><span>加购率</span><span>ROI</span><span>花费</span>
            </div>
            <div v-for="row in [...p.daily].reverse()" :key="row.d" style="display:grid;grid-template-columns:42px 1fr 1fr 1fr 1fr;gap:4px;padding:5px 0;border-bottom:1px solid #f4f4f5;font-size:11px">
              <div style="color:var(--muted);white-space:nowrap">{{ row.d.slice(5) }}</div>
              <div>{{ fmt(row.gmv,'money') }}</div>
              <div>{{ row.cart_rate!=null ? row.cart_rate.toFixed(1)+'%' : '—' }}</div>
              <div>{{ row.ad_roi!=null ? row.ad_roi.toFixed(1)+'x' : '—' }}</div>
              <div>{{ fmt(row.spend,'money') }}</div>
            </div>
          </div>
          </template>
        </div>
      </div>
    </div>
  </div>

  <div v-else-if="displayMode==='网格'" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;overflow:auto;padding-right:2px">
    <div v-for="p in products" :key="p.pid" class="card" style="padding:12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="width:56px;height:56px;border:1px solid var(--border);border-radius:10px;background:#fafaf9;display:flex;align-items:center;justify-content:center"><img v-if="imgSrc(p.pid)" :src="imgSrc(p.pid)" style="max-width:48px;max-height:48px;object-fit:contain"></div>
        <div style="min-width:0;flex:1"><div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ p.name }}<span v-if="p.alias_pids && p.alias_pids.length" :title="'已合并副 SKU：' + p.alias_pids.join('、')" style="margin-left:6px;padding:1px 5px;font-size:9px;background:#fef3c7;color:#92400e;border-radius:3px;cursor:help;font-weight:600">🔗 +{{ p.alias_pids.length }}</span></div><div style="font-size:10px;color:var(--muted)">{{ p.cat }}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
        <div v-for="m in summaryMetrics.slice(0,6)" :key="m.k"><div style="font-size:10px;color:var(--muted)">{{ m.l }}</div><div style="font-size:13px;font-weight:700">{{ fmt(p[m.k],m.fmt) }}</div></div>
      </div>
      <interactive-trend-chart :series="productChartSeries(p.daily)" :height="210" :normalize="true" :events="p.events" />
    </div>
  </div>

  <div v-else style="overflow:auto">
    <div class="card" style="padding:0;overflow:hidden">
      <div style="display:grid;grid-template-columns:minmax(220px,1.6fr) repeat(15,minmax(70px,.6fr)) 180px;gap:0;padding:10px 12px;background:#fafaf9;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--muted)">
        <div>商品</div><div>销售额</div><div>UV</div><div>加购率</div><div>转化率</div><div>ROI</div><div>收藏加购</div><div>新客数</div><div>退款金额</div><div>投放花费</div><div>投放CTR</div><div>浏览量</div><div>停留时长</div><div>跳出率</div><div>收藏加购人数</div><div>搜索引导UV</div><div>趋势</div>
      </div>
      <div v-for="p in products" :key="p.pid" style="display:grid;grid-template-columns:minmax(220px,1.6fr) repeat(15,minmax(70px,.6fr)) 180px;gap:0;padding:12px;border-bottom:1px solid #f4f4f5;align-items:center;font-size:12px">
        <div style="display:flex;align-items:center;gap:10px;min-width:0"><div style="width:44px;height:44px;border:1px solid var(--border);border-radius:10px;background:#fafaf9;display:flex;align-items:center;justify-content:center"><img v-if="imgSrc(p.pid)" :src="imgSrc(p.pid)" style="max-width:38px;max-height:38px;object-fit:contain"></div><div style="min-width:0"><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ p.name }}</div><div style="font-size:10px;color:var(--muted)">{{ p.cat }}</div></div></div>
        <div>{{ fmt(p.gmv,'money') }}</div><div>{{ fmt(p.vis,'num') }}</div><div>{{ fmt(p.cart_rate,'pct') }}</div><div>{{ fmt(p.conv_rate,'pct') }}</div><div>{{ fmt(p.ad_roi,'x') }}</div><div>{{ fmt(p.fav_cart,'num') }}</div><div>{{ fmt(p.new_buyers,'num') }}</div><div>{{ fmt(p.refund,'money') }}</div><div>{{ fmt(p.ad_spend,'money') }}</div><div>{{ fmt(p.ad_ctr,'pct') }}</div><div>{{ fmt(p.pv,'num') }}</div><div>{{ fmt(p.dwell_time,'sec') }}</div><div>{{ fmt(p.bounce_rate,'pct') }}</div><div>{{ fmt(p.fav_cart_users,'num') }}</div><div>{{ fmt(p.search_vis,'num') }}</div><interactive-trend-chart :series="miniChart(p.daily)" :height="70" :normalize="true" />
      </div>
    </div>
  </div>

  <!-- 事件 新增/编辑 弹窗 -->
  <div v-if="eventModal.show" @click.self="closeEventModal"
    style="position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:1000">
    <div style="width:420px;max-width:92vw;background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 24px 60px rgba(15,23,42,.25)">
      <div style="font-size:14px;font-weight:700;margin-bottom:14px">{{ eventModal.mode==='edit' ? '编辑事件' : '新增事件' }}</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">事件名称 *</div>
          <input v-model="eventModal.title" placeholder="如：618 大促 / 五一活动" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">事件类型</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button v-for="c in EVENT_CATEGORIES" :key="c.k" @click="eventModal.category=c.k" type="button"
              :style="{padding:'4px 10px',fontSize:'11px',borderRadius:'99px',cursor:'pointer',border:'1px solid '+(eventModal.category===c.k?c.color:'var(--border)'),background:eventModal.category===c.k?c.color+'18':'transparent',color:eventModal.category===c.k?c.color:'var(--muted)',fontWeight:eventModal.category===c.k?'700':'500'}">{{ c.l }}</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:3px">开始日期 *</div>
            <input v-model="eventModal.start_date" type="date" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:3px">结束日期（可空）</div>
            <input v-model="eventModal.end_date" type="date" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
          </div>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:-4px;line-height:1.5">
          留空 = 单点事件或进行中（图表上显示为虚线）；填写则显示为时间段（阴影区域）
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">备注（可空）</div>
          <textarea v-model="eventModal.note" rows="2" placeholder="补充说明" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;resize:vertical;box-sizing:border-box;font-family:inherit"></textarea>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button @click="closeEventModal" style="padding:6px 14px;font-size:12px;border:1px solid var(--border);background:#fff;border-radius:6px;cursor:pointer;color:var(--muted)">取消</button>
        <button @click="saveEvent" style="padding:6px 14px;font-size:12px;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:6px;cursor:pointer;font-weight:600">保存</button>
      </div>
    </div>
  </div>

  <!-- 任务 新增弹窗 -->
  <div v-if="taskModal.show" @click.self="closeTaskModal"
    style="position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:1000">
    <div style="width:440px;max-width:92vw;background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 24px 60px rgba(15,23,42,.25)">
      <div style="font-size:14px;font-weight:700;margin-bottom:14px">新增任务</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">任务名称 *</div>
          <input v-model="taskModal.detail" placeholder="如：优化主图、写小红书种草稿" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:3px">分类</div>
            <select v-model="taskModal.category" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#fff">
              <option v-for="c in TASK_CATEGORIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:3px">负责人</div>
            <select v-model="taskModal.owner" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#fff">
              <option v-for="o in TASK_OWNERS" :key="o" :value="o">{{ o }}</option>
            </select>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:3px">状态</div>
            <select v-model="taskModal.status" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#fff">
              <option>待开始</option><option>进行中</option><option>已完成</option>
            </select>
          </div>
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:3px">优先级</div>
            <select v-model="taskModal.priority" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#fff">
              <option>高</option><option>中</option><option>低</option>
            </select>
          </div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">备注（可空）</div>
          <textarea v-model="taskModal.execution_note" rows="2" placeholder="执行说明、风险、依赖" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;resize:vertical;box-sizing:border-box;font-family:inherit"></textarea>
        </div>
        <div style="font-size:10px;color:var(--muted)">周期会自动写入：{{ activePeriod || '当前周期' }}</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button @click="closeTaskModal" style="padding:6px 14px;font-size:12px;border:1px solid var(--border);background:#fff;border-radius:6px;cursor:pointer;color:var(--muted)">取消</button>
        <button @click="saveTask" :disabled="taskModal.saving" style="padding:6px 14px;font-size:12px;border:1px solid #c2790e;background:#c2790e;color:#fff;border-radius:6px;cursor:pointer;font-weight:600">{{ taskModal.saving ? '...' : '保存' }}</button>
      </div>
    </div>
  </div>

  <!-- 笔记 新增弹窗（暂存前端，下版本接 API） -->
  <div v-if="xhsModal.show" @click.self="closeXhsModal"
    style="position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:1000">
    <div style="width:460px;max-width:92vw;background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 24px 60px rgba(15,23,42,.25)">
      <div style="font-size:14px;font-weight:700;margin-bottom:14px">新增小红书笔记</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">笔记标题 *</div>
          <input v-model="xhsModal.title" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">链接 *</div>
          <input v-model="xhsModal.link" placeholder="https://www.xiaohongshu.com/..." style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:3px">日期</div>
            <input v-model="xhsModal.date" type="date" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:3px">作者</div>
            <input v-model="xhsModal.author" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
          <div><div style="font-size:11px;color:var(--muted);margin-bottom:3px">点赞</div><input v-model.number="xhsModal.likes" type="number" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box"></div>
          <div><div style="font-size:11px;color:var(--muted);margin-bottom:3px">收藏</div><input v-model.number="xhsModal.collect" type="number" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box"></div>
          <div><div style="font-size:11px;color:var(--muted);margin-bottom:3px">评论</div><input v-model.number="xhsModal.comments" type="number" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box"></div>
          <div><div style="font-size:11px;color:var(--muted);margin-bottom:3px">浏览</div><input v-model.number="xhsModal.views" type="number" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;box-sizing:border-box"></div>
        </div>
        <div style="font-size:10px;color:#138a52;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:6px 8px;line-height:1.5">
          ✓ 已接后端 API（fact_xhs_note 表），保存后所有人可见。链接重复会自动更新指标
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button @click="closeXhsModal" style="padding:6px 14px;font-size:12px;border:1px solid var(--border);background:#fff;border-radius:6px;cursor:pointer;color:var(--muted)">取消</button>
        <button @click="saveXhs" :disabled="xhsModal.saving" style="padding:6px 14px;font-size:12px;border:1px solid #ff2442;background:#ff2442;color:#fff;border-radius:6px;cursor:pointer;font-weight:600">{{ xhsModal.saving ? '...' : '保存' }}</button>
      </div>
    </div>
  </div>
</div>`
})
