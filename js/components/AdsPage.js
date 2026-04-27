// ── AdsPage.js ─────────────────────────────────────────
// 投放面板页组件。

const AdsPage = defineComponent({
  name: 'AdsPage',
  props: ['start', 'end'],
  setup(props) {
    const activeTab = ref('delivery')
    const openChannel = ref({ audience: false, keyword: false, video: false })
    const periodStart = computed(() => props.start || RAW.launch_date)
    const periodEnd = computed(() => props.end || RAW.data_end)
    const periodLabel = computed(() => periodStart.value===periodEnd.value ? periodStart.value : `${periodStart.value} ~ ${periodEnd.value}`)

    // 将 "4.20-22" / "3.30-4.5" 等短格式解析为 {s,e} ISO 日期
    const parseTaskPeriod = str => {
      if (!str) return { s: null, e: null }
      const pad = n => String(n).padStart(2, '0')
      const fmt = (m, d) => `2026-${pad(m)}-${pad(d)}`
      const cross = str.match(/^(\d+)\.(\d+)-(\d+)\.(\d+)$/)
      if (cross) return { s: fmt(+cross[1], +cross[2]), e: fmt(+cross[3], +cross[4]) }
      const same = str.match(/^(\d+)\.(\d+)-(\d+)$/)
      if (same) return { s: fmt(+same[1], +same[2]), e: fmt(+same[1], +same[3]) }
      return { s: null, e: null }
    }
    // 任务周期对应的实际日期范围（优先用任务周期，不可解析时退回顶栏日期）
    const taskPeriodDates = computed(() => {
      const p = parseTaskPeriod(activePeriod.value)
      return { start: p.s || periodStart.value, end: p.e || periodEnd.value,
               label: p.s && p.e ? `${p.s} ~ ${p.e}` : periodLabel.value }
    })

    const audienceRatio = AUDIENCE_RATIO
    const keywordRatio = KEYWORD_RATIO

    const fmtMoney = v => v>=10000 ? '¥'+(v/10000).toFixed(1)+'万' : '¥'+Number(v).toFixed(0)
    const fmtDelta = v => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(1) + '%'
    const statusColor = s=>s==='已完成'?'#16a34a':s==='进行中'?'#d97706':'#a1a1aa'
    const imgSrc = pid => (APP_STATE.value.imageOverrides || {})[pid] || RAW.img_map?.[pid] || ''

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
      return ['家具','配饰','灯具','其他'].map(cat => ({
        category: cat,
        spend: +(catSpend[cat]||0).toFixed(2),
        pct: total>0 ? +(((catSpend[cat]||0)/total)*100).toFixed(1) : 0,
      }))
    })
    const totalProductSpend = computed(() => catRows.value.reduce((a,b)=>a+b.spend,0))
    const totalProductSpendWan = computed(() => (totalProductSpend.value/10000).toFixed(1))
    const audienceSpend = computed(() => +(totalProductSpend.value * audienceRatio).toFixed(2))
    const keywordSpend = computed(() => +(totalProductSpend.value * keywordRatio).toFixed(2))

    const videoSpend = computed(() => {
      const s = periodStart.value, e = periodEnd.value
      let total = 0
      for (const [d, v] of Object.entries(RAW.video_daily || {})) {
        if (d >= s && d <= e) total += v.spend || 0
      }
      return +total.toFixed(2)
    })
    const videoGmv = computed(() => {
      const s = periodStart.value, e = periodEnd.value
      let total = 0
      for (const [d, v] of Object.entries(RAW.video_daily || {})) {
        if (d >= s && d <= e) total += v.gmv || 0
      }
      return +total.toFixed(2)
    })

    const totalPaidSpend = computed(() => +(audienceSpend.value + keywordSpend.value + videoSpend.value).toFixed(2))
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

    const channelRows = computed(() => [
      { key:'audience', name:'人群', spend:audienceSpend.value, pct:totalPaidSpend.value>0?+(audienceSpend.value/totalPaidSpend.value*100).toFixed(1):0, is_planned:true, planned_note:'计划有比例要求，当前实际 73.1%', note:'实际花费比例（计划有强制要求）', items:buildChannelItems(audienceSpend.value, 'audience') },
      { key:'keyword', name:'关键词', spend:keywordSpend.value, pct:totalPaidSpend.value>0?+(keywordSpend.value/totalPaidSpend.value*100).toFixed(1):0, is_planned:false, planned_note:'无计划比例要求，当前实际 26.9%', note:'实际花费比例（无计划强制要求）', items:buildChannelItems(keywordSpend.value, 'keyword') },
      { key:'video', name:'短视频', spend:videoSpend.value, pct:totalPaidSpend.value>0?+(videoSpend.value/totalPaidSpend.value*100).toFixed(1):0, is_planned:false, planned_note:'内容报表口径，含短视频推广花费', note:'短视频内容推广（内容报表）', gmv:videoGmv.value, items:[] },
    ])

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

    const taskPeriods = computed(() => {
      const base = RAW.task_periods || []
      const custom = APP_STATE.value.customPeriods || []
      return [...new Set([...base, ...custom])].sort()
    })
    const activePeriod = computed(() =>
      APP_STATE.value.selectedTaskPeriod || taskPeriods.value[taskPeriods.value.length - 1] || ''
    )
    const setTaskPeriod = (p) => {
      APP_STATE.value.selectedTaskPeriod = p
      persistAppState()
    }
    const newPeriodInput = ref('')
    const addPeriod = () => {
      const p = newPeriodInput.value.trim()
      if (!p) return
      if (!taskPeriods.value.includes(p)) {
        APP_STATE.value.customPeriods = [...(APP_STATE.value.customPeriods || []), p]
      }
      setTaskPeriod(p)
      newPeriodInput.value = ''
    }

    const saveGuanghe = (pid, value) => {
      const num = parseFloat(String(value).replace(/,/g,'')) || 0
      if (!APP_STATE.value.guangheTraffic) APP_STATE.value.guangheTraffic = {}
      if (!APP_STATE.value.guangheTraffic[pid]) APP_STATE.value.guangheTraffic[pid] = {}
      APP_STATE.value.guangheTraffic[pid][activePeriod.value] = num
      persistAppState()
    }

    const allTasks = computed(() => {
      // 使用任务周期对应的实际日期，而非顶栏日期
      const s = taskPeriodDates.value.start, e = taskPeriodDates.value.end
      const period = activePeriod.value
      // 上一等长周期用于环比
      const days = Math.round((new Date(e) - new Date(s)) / 86400000) + 1
      const pe = new Date(s); pe.setDate(pe.getDate() - 1)
      const ps = new Date(pe); ps.setDate(ps.getDate() - days + 1)
      const prevS = ps.toISOString().slice(0,10), prevE = pe.toISOString().slice(0,10)
      // 近 7 天笔记窗口（以 e 为终点）
      const noteStartD = new Date(e); noteStartD.setDate(noteStartD.getDate() - 6)
      const noteS = noteStartD.toISOString().slice(0,10)
      const prevNoteE = new Date(noteS); prevNoteE.setDate(prevNoteE.getDate() - 1)
      const prevNoteS = new Date(prevNoteE); prevNoteS.setDate(prevNoteS.getDate() - 6)
      const pNoteS = prevNoteS.toISOString().slice(0,10), pNoteE = prevNoteE.toISOString().slice(0,10)

      return Object.entries(APP_STATE.value.tasksByPid || {}).flatMap(([pid, list]) => {
        // 只显示 RAW 商品目录中存在的商品，过滤旧数据残留 PID
        const p = RAW.products?.[pid]
        if (!p) return []
        let gmv=0, spend=0, cart=0, vis=0, ctrSum=0, ctrN=0, staySum=0, stayN=0, pcvrSum=0, pcvrN=0
        let pgmv=0, pspend=0, pcart=0, pvis=0, pctrSum=0, pctrN=0, pStaySum=0, pStayN=0, pPcvrSum=0, pPcvrN=0
        // 近 7 天 XHS 笔记
        const xhsNotes  = (RAW.xhs_notes||[]).filter(n=>n.pid===pid&&n.date>=noteS&&n.date<=e).length
        const pXhsNotes = (RAW.xhs_notes||[]).filter(n=>n.pid===pid&&n.date>=pNoteS&&n.date<=pNoteE).length
        // 光合渠道流量（人工录入）
        const guanghe = (APP_STATE.value.guangheTraffic||{})[pid]?.[period] ?? null
        if (p) {
          for (let i=0; i<p.dates.length; i++) {
            const d = p.dates[i]
            if (d >= s && d <= e) {
              gmv   += p.pay?.[i]   || 0; spend += p.spend?.[i] || 0
              cart  += p.cart?.[i]  || 0; vis   += p.vis?.[i]   || 0
              if ((p.ctr?.[i]||0)>0)     { ctrSum  +=p.ctr[i]*100;  ctrN++  }
              if ((p.avg_stay?.[i]||0)>0) { staySum +=p.avg_stay[i]; stayN++ }
              if ((p.pay_cvr?.[i]||0)>0)  { pcvrSum +=p.pay_cvr[i]*100; pcvrN++ }
            }
            if (d >= prevS && d <= prevE) {
              pgmv   += p.pay?.[i]   || 0; pspend += p.spend?.[i] || 0
              pcart  += p.cart?.[i]  || 0; pvis   += p.vis?.[i]   || 0
              if ((p.ctr?.[i]||0)>0)     { pctrSum  +=p.ctr[i]*100;  pctrN++  }
              if ((p.avg_stay?.[i]||0)>0) { pStaySum +=p.avg_stay[i]; pStayN++ }
              if ((p.pay_cvr?.[i]||0)>0)  { pPcvrSum +=p.pay_cvr[i]*100; pPcvrN++ }
            }
          }
        }
        const pct = (a, b) => b > 0 ? +((a-b)/b*100).toFixed(1) : null
        const ctr      = ctrN   > 0 ? +(ctrSum  /ctrN  ).toFixed(2) : null
        const pctr     = pctrN  > 0 ? +(pctrSum /pctrN ).toFixed(2) : null
        const avgStay  = stayN  > 0 ? +(staySum /stayN ).toFixed(1) : null
        const pAvgStay = pStayN > 0 ? +(pStaySum/pStayN).toFixed(1) : null
        const payCvr   = pcvrN  > 0 ? +(pcvrSum /pcvrN ).toFixed(2) : null
        const pPayCvr  = pPcvrN > 0 ? +(pPcvrSum/pPcvrN).toFixed(2) : null
        // 加购率 = 加购用户数 / 访客数（周期累计）
        const cartRate  = vis  > 0 ? +((cart /vis )*100).toFixed(2) : null
        const pCartRate = pvis > 0 ? +((pcart/pvis)*100).toFixed(2) : null
        return (list||[]).map(t => ({ ...t, pid, image: imgSrc(pid),
          metrics: {
            gmv:   +gmv.toFixed(2),   gmv_chg:   pct(gmv,  pgmv),
            spend: +spend.toFixed(2), spend_chg: pct(spend, pspend),
            cart:  Math.round(cart),  cart_chg:  pct(cart,  pcart),
            ctr,  ctr_chg: (ctr!=null&&pctr!=null) ? pct(ctr, pctr) : null,
            roi:  spend>0 ? +(gmv/spend).toFixed(2) : null,
            xhs_notes: xhsNotes, xhs_notes_chg: pct(xhsNotes, pXhsNotes),
            guanghe,
            avg_stay: avgStay, avg_stay_chg: (avgStay!=null&&pAvgStay!=null) ? pct(avgStay, pAvgStay) : null,
            cart_rate: cartRate, cart_rate_chg: (cartRate!=null&&pCartRate!=null) ? pct(cartRate, pCartRate) : null,
            pay_cvr: payCvr, pay_cvr_chg: (payCvr!=null&&pPayCvr!=null) ? pct(payCvr, pPayCvr) : null,
          }
        }))
      })
    })

    const currentUser = computed(() => currentUserObj())
    const canEditTask = (task) => canEditOwnTask(currentUser.value, task)

    const teamFilters = ref({ owner:'', category:'', productKeyword:'', status:'' })
    const ownerOptions = computed(() => [...new Set(allTasks.value.map(t => t.owner).filter(Boolean))])
    const categoryOptions = computed(() => [...new Set(allTasks.value.map(t => RAW.products?.[t.pid]?.cat).filter(Boolean))])
    const statusOptions = ['待开始','进行中','已完成']
    const taskGroups = computed(() => {
      const byPid = {}
      const period = activePeriod.value
      for (const t of allTasks.value) {
        // 任务始终显示，周期只影响备注列显示哪一条笔记
        const product = RAW.products?.[t.pid]
        const productName = product?.name || RAW.short_names?.[t.pid] || t.pid
        if (teamFilters.value.owner && t.owner !== teamFilters.value.owner) continue
        if (teamFilters.value.category && (product?.cat||'') !== teamFilters.value.category) continue
        if (teamFilters.value.productKeyword && !productName.toLowerCase().includes(teamFilters.value.productKeyword.toLowerCase())) continue
        if (teamFilters.value.status && (t.status||'') !== teamFilters.value.status) continue
        if (!byPid[t.pid]) byPid[t.pid] = { pid:t.pid, name:productName, image:t.image, metrics:t.metrics, tasks:[] }
        const note = (t.period_notes||{})[period] || ''
        byPid[t.pid].tasks.push({ id:t.id, detail:t.detail, owner:t.owner||'', category:t.category||'', note, status:t.status||'' })
      }
      return Object.values(byPid).filter(p => p.tasks.length)
    })

    const meetings = computed(() => {
      const byWeek = {}
      for (const m of (APP_STATE.value.meetings || [])) {
        const k = m.week_label || m.meeting_date
        if (!byWeek[k] || m.meeting_date > byWeek[k].meeting_date) byWeek[k] = m
      }
      return Object.values(byWeek).sort((a,b)=>b.meeting_date.localeCompare(a.meeting_date)).slice(0,8)
    })
    const latestMeeting = computed(() => meetings.value[0] || null)
    const toggleChannel = key => { openChannel.value[key] = !openChannel.value[key] }

    const taskTemplates = computed(() => {
      const base = defaultTaskTemplates ? defaultTaskTemplates() : []
      const saved = APP_STATE.value.taskTemplates || []
      const seen = new Set(base.map(t => t.detail))
      const custom = saved.filter(t => !seen.has(t.detail))
      return [...base, ...custom]
    })
    const taskModal = ref({ show:false, mode:'edit', pid:'', id:'', detail:'', owner:'', category:'', status:'待开始', note:'', templateKey:'' })
    const onTemplateSelect = (e) => {
      const key = e.target.value
      taskModal.value.templateKey = key
      if (!key || key === '__custom__') return
      const tpl = taskTemplates.value.find(t => t.detail === key)
      if (!tpl) return
      taskModal.value.detail = tpl.detail
      taskModal.value.category = tpl.category
      if (!taskModal.value.owner && tpl.defaultOwner) taskModal.value.owner = tpl.defaultOwner
    }
    const openEditTask = (item, task) => {
      if (!canEditTask(task)) return
      Object.assign(taskModal.value, { show:true, mode:'edit', pid:item.pid, id:task.id, detail:task.detail, owner:task.owner, category:task.category, status:task.status||'待开始', note:task.note||'', templateKey:'' })
    }
    const openAddTask = (item) => {
      const u = currentUser.value
      if (!u) return
      Object.assign(taskModal.value, { show:true, mode:'add', pid:item.pid, id:'', detail:'', owner: u.role==='admin'?'':(u.display_name||''), category:'', status:'待开始', note:'', templateKey:'' })
    }
    const saveTaskModal = () => {
      const { pid, id, mode, detail, owner, category, status, note } = taskModal.value
      if (!detail.trim()) return alert('请填写任务名称')
      if (!APP_STATE.value.tasksByPid) APP_STATE.value.tasksByPid = {}
      if (!APP_STATE.value.tasksByPid[pid]) APP_STATE.value.tasksByPid[pid] = []
      const list = APP_STATE.value.tasksByPid[pid]
      // 如果是全新自定义任务，保存到模板库
      const knownDetails = new Set((APP_STATE.value.taskTemplates || []).concat(defaultTaskTemplates ? defaultTaskTemplates() : []).map(t => t.detail))
      if (!knownDetails.has(detail.trim())) {
        if (!APP_STATE.value.taskTemplates) APP_STATE.value.taskTemplates = []
        APP_STATE.value.taskTemplates.push({ category: category || '', detail: detail.trim(), defaultOwner: owner || '' })
      }
      if (mode === 'add') {
        const newTask = { id: makeId('task'), detail: detail.trim(), owner, category, status, period_notes: {} }
        newTask.period_notes[activePeriod.value] = note
        list.push(newTask)
      } else {
        const t = list.find(x => x.id === id)
        if (t) {
          t.detail = detail; t.owner = owner; t.category = category; t.status = status
          if (!t.period_notes) t.period_notes = {}
          t.period_notes[activePeriod.value] = note
        }
      }
      persistAppState(); taskModal.value.show = false
    }
    const deleteTask = () => {
      const { pid, id } = taskModal.value
      if (!confirm('确认删除此任务？')) return
      const list = APP_STATE.value.tasksByPid[pid]
      if (list) {
        const idx = list.findIndex(x => x.id === id)
        if (idx >= 0) list.splice(idx, 1)
      }
      persistAppState(); taskModal.value.show = false
    }
    const updateTaskStatus = (pid, taskId, newStatus, task) => {
      if (!canEditTask(task || {})) return
      const list = APP_STATE.value.tasksByPid[pid]
      const t = list?.find(x => x.id === taskId)
      if (t) { t.status = newStatus; persistAppState() }
    }
    const updateTaskOwner = (pid, taskId, newOwner, task) => {
      if (!canEditTask(task || {})) return
      const list = APP_STATE.value.tasksByPid[pid]
      const t = list?.find(x => x.id === taskId)
      if (t) { t.owner = newOwner; persistAppState() }
    }
    const saveInlineNote = (pid, taskId, value) => {
      const list = APP_STATE.value.tasksByPid?.[pid]
      const t = list?.find(x => x.id === taskId)
      if (t) {
        if (!t.period_notes) t.period_notes = {}
        t.period_notes[activePeriod.value] = value
        persistAppState()
      }
    }
    const userOptions = computed(() => APP_STATE.value.users || [])

    const channelCatData = computed(() => computeChannelCatTable(periodStart.value, periodEnd.value))

    const adsCtr = computed(() => {
      let ctrS=0, ctrN=0
      for (const r of filterRows(RAW.wxst, periodStart.value, periodEnd.value)) {
        if (r.imps > 0) { ctrS += r.ctr; ctrN++ }
      }
      return ctrN > 0 ? +(ctrS / ctrN * 100).toFixed(2) : null
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

    return {
      activeTab, openChannel, periodLabel, audienceSpend, keywordSpend, videoSpend, videoGmv,
      totalPaidSpend, totalPaidSpendWan, catRows, totalProductSpendWan,
      channelRows, trendRows, meetings, latestMeeting, taskGroups,
      taskPeriods, activePeriod, setTaskPeriod, newPeriodInput, addPeriod, canEditTask,
      teamFilters, ownerOptions, categoryOptions, statusOptions, fmtMoney, fmtDelta, statusColor, imgSrc, toggleChannel,
      adsCtr, ctrRankRows,
      channelCatData,
      taskModal, openEditTask, openAddTask, saveTaskModal, deleteTask, updateTaskStatus, updateTaskOwner, saveInlineNote, saveGuanghe, userOptions,
      taskTemplates, onTemplateSelect, taskPeriodDates,
    }
  },
  template: `
<div style="display:flex;flex-direction:column;gap:16px">
  <div class="card" style="padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <div style="font-size:16px;font-weight:700;margin-bottom:4px">投放面板</div>
        <div style="font-size:11px;color:var(--muted)">{{ activeTab==='team' ? (activePeriod || taskPeriodDates.label) : periodLabel }}</div>
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
      <div class="kpi-card"><div class="kpi-label">总投放<span class="info-btn">?<span class="tooltip">万象台商品报表口径人群+关键词花费，加上内容报表短视频花费的总和。三个渠道分别独立统计。</span></span></div><div class="kpi-value">¥{{ totalPaidSpendWan }}万</div><div class="kpi-footer"><span>人群+关键词+短视频</span></div></div>
      <div class="kpi-card"><div class="kpi-label">人群<span class="info-btn">?<span class="tooltip">万象台「人群推广」渠道花费，按商品报表总花费 × 73.1% 估算（实际比例来自报表期总数）。计划目标 73.1%。</span></span></div><div class="kpi-value">{{ fmtMoney(audienceSpend) }}</div><div class="kpi-footer"><span>渠道口径</span></div></div>
      <div class="kpi-card"><div class="kpi-label">关键词<span class="info-btn">?<span class="tooltip">万象台「关键词推广」渠道花费，按商品报表总花费 × 26.9% 估算。计划目标 26.9%，无强制要求。</span></span></div><div class="kpi-value">{{ fmtMoney(keywordSpend) }}</div><div class="kpi-footer"><span>渠道口径</span></div></div>
      <div class="kpi-card"><div class="kpi-label">短视频<span class="info-btn">?<span class="tooltip">内容报表「短视频」类型花费，与搜推报表独立统计，不叠加在人群/关键词中。来源：推广报表→内容报表。</span></span></div><div class="kpi-value">{{ fmtMoney(videoSpend) }}</div><div class="kpi-footer"><span>内容报表口径</span></div></div>
      <div class="kpi-card"><div class="kpi-label">类目拆分额<span class="info-btn">?<span class="tooltip">商品报表口径的各品类投放花费，直接来自商品级数据累加，不经渠道比例换算，用于类目计划 vs 实际对比。</span></span></div><div class="kpi-value">¥{{ totalProductSpendWan }}万</div><div class="kpi-footer"><span>商品报表口径</span></div></div>
      <div class="kpi-card"><div class="kpi-label">推广 CTR<span class="info-btn">?<span class="tooltip">万象台商品报表 CTR 字段均值（点击量 ÷ 展现量 × 100%）。仅统计有曝光的商品，按商品数取算术均值。</span></span></div><div class="kpi-value">{{ adsCtr != null ? adsCtr.toFixed(2)+'%' : '—' }}</div><div class="kpi-footer"><span>万象台均值</span></div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
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
    </div>

    <!-- 短视频渠道 -->
    <div v-if="videoSpend > 0" class="card" style="padding:16px">
      <div class="card-header" style="margin-bottom:10px">
        <div>
          <span class="card-title">短视频渠道</span>
          <span class="card-sub" style="margin-left:8px">内容报表口径</span>
        </div>
        <span style="font-size:12px;font-weight:700">¥{{ (videoSpend/10000).toFixed(2) }}万花费 · GMV ¥{{ (videoGmv/10000).toFixed(1) }}万</span>
      </div>
      <div style="display:flex;gap:24px;flex-wrap:wrap">
        <div style="display:flex;flex-direction:column;gap:4px">
          <div style="font-size:11px;color:var(--muted)">ROI</div>
          <div style="font-size:16px;font-weight:700;color:var(--accent)">{{ videoSpend > 0 ? (videoGmv/videoSpend).toFixed(2) : '—' }}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <div style="font-size:11px;color:var(--muted)">花费占总投放</div>
          <div style="font-size:16px;font-weight:700">{{ totalPaidSpend > 0 ? (videoSpend/totalPaidSpend*100).toFixed(1) : 0 }}%</div>
        </div>
        <div style="flex:1;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden;align-self:center;min-width:80px">
          <div style="height:100%;background:#a78bfa;border-radius:3px" :style="{width:Math.min(100,totalPaidSpend>0?videoSpend/totalPaidSpend*100:0)+'%'}"></div>
        </div>
      </div>
    </div>

    <!-- CTR 排行 -->
    <div class="card" style="padding:16px">
      <div class="card-header" style="margin-bottom:12px">
        <span class="card-title">CTR 排行</span>
        <span class="card-sub">万象台口径，当前周期均值</span>
        <span class="info-btn" style="margin-left:8px">?<span class="tooltip" style="left:auto;right:0">万象台商品报表 ctr 字段均值（clicks÷impressions×100%），仅含有投放的商品，按当前时间段汇总取均值</span></span>
      </div>
      <div v-if="ctrRankRows.length===0" class="empty">当前周期暂无投放 CTR 数据</div>
      <div v-else style="display:flex;flex-direction:column;gap:6px">
        <div style="display:grid;grid-template-columns:24px 1fr 70px 1fr;gap:8px;padding:0 4px 6px;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted)">
          <span>#</span><span>商品</span><span style="text-align:right">CTR</span><span></span>
        </div>
        <div v-for="(r,i) in ctrRankRows" :key="r.pid" style="display:grid;grid-template-columns:24px 1fr 70px 1fr;gap:8px;align-items:center;padding:5px 4px;border-bottom:1px solid #f1f5f9">
          <div :class="['rank-no',{top3:i<3}]" style="text-align:center">{{ i+1 }}</div>
          <div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="r.name">{{ r.name }}</div>
          <div style="text-align:right;font-size:12px;font-weight:700;color:var(--accent)">{{ r.ctr }}%</div>
          <div style="height:6px;background:#f3f4f6;border-radius:99px;overflow:hidden">
            <div style="height:100%;background:var(--accent);border-radius:99px" :style="{width:(ctrRankRows[0]?r.ctr/ctrRankRows[0].ctr*100:0)+'%'}"></div>
          </div>
        </div>
      </div>
    </div>
  </template>

  <template v-else>
      <div class="card" style="padding:14px 16px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="font-size:13px;font-weight:700;color:var(--text);margin-right:4px">任务周期</div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="padding:5px 14px;font-size:12px;font-weight:600;background:var(--accent);color:#fff;border-radius:8px;white-space:nowrap">{{ activePeriod }}</span>
            <select v-if="taskPeriods.length>1" :value="activePeriod" @change="setTaskPeriod($event.target.value)"
              style="border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:12px;background:#fff;cursor:pointer;color:var(--muted)">
              <option v-for="p in taskPeriods" :key="p" :value="p">{{ p }}</option>
            </select>
            <input v-model="newPeriodInput" placeholder="新周期名称（如 4.23-25）" @keydown.enter="addPeriod"
              style="border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:12px;width:150px;background:#fff">
            <button @click="addPeriod"
              style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer">+ 新增</button>
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
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <span class="card-title">任务清单</span>
            <span class="card-sub">{{ activePeriod }} · {{ taskGroups.length }} 个商品</span>
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
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
                  <div style="min-width:0">
                    <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ item.name }}</div>
                    <div style="font-size:11px;color:var(--muted)">{{ item.pid }}</div>
                  </div>
                  <button @click="openAddTask(item)"
                    style="flex-shrink:0;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-weight:500;white-space:nowrap">
                    + 新增任务
                  </button>
                </div>
                <div>
                  <div style="font-size:10px;color:var(--muted);margin-bottom:6px">数据统计：{{ taskPeriodDates.label }}</div>
                  <div style="display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--border);border-radius:8px;overflow:hidden">
                    <template v-for="(m,mi) in [
                      {label:'销售金额',           val:fmtMoney(item.metrics.gmv),                                            chg:item.metrics.gmv_chg},
                      {label:'CTR',               val:item.metrics.ctr!=null?item.metrics.ctr+\`%\`:\`—\`,                    chg:item.metrics.ctr_chg},
                      {label:'花费',               val:fmtMoney(item.metrics.spend),                                          chg:item.metrics.spend_chg},
                      {label:'加购量',             val:item.metrics.cart,                                                     chg:item.metrics.cart_chg},
                      {label:'加购率',             val:item.metrics.cart_rate!=null?item.metrics.cart_rate+\`%\`:\`—\`,       chg:item.metrics.cart_rate_chg},
                      {label:'支付转化率',         val:item.metrics.pay_cvr!=null?item.metrics.pay_cvr+\`%\`:\`—\`,           chg:item.metrics.pay_cvr_chg},
                      {label:'平均停留时长 (秒)',   val:item.metrics.avg_stay!=null?item.metrics.avg_stay+\`s\`:\`—\`,         chg:item.metrics.avg_stay_chg},
                      {label:'发布笔记量 (近7天)', val:item.metrics.xhs_notes,                                                chg:item.metrics.xhs_notes_chg},
                    ]" :key="mi">
                      <div :style="{padding:'8px 12px',background:'#fafaf9',borderRight:'1px solid var(--border)',borderBottom:'1px solid var(--border)'}">
                        <div style="font-size:10px;color:var(--muted);margin-bottom:3px">{{ m.label }}</div>
                        <div style="font-size:15px;font-weight:700">{{ m.val }}</div>
                        <div style="font-size:10px;margin-top:2px">
                          <span style="color:var(--muted)">环比上周期 </span>
                          <span :style="{fontWeight:'600',color:m.chg==null?'var(--muted)':m.chg>=0?'#16a34a':'#dc2626'}">
                            {{ m.chg==null ? '—' : (m.chg>0?'↑':'↓')+Math.abs(m.chg)+'%' }}
                          </span>
                        </div>
                      </div>
                    </template>
                    <!-- 光合渠道流量（可内联录入） -->
                    <div style="padding:8px 12px;background:#fafaf9;border-bottom:1px solid var(--border)">
                      <div style="font-size:10px;color:var(--muted);margin-bottom:3px">光合渠道流量</div>
                      <input :value="item.metrics.guanghe ?? ''"
                        type="text" placeholder="点击录入"
                        @blur="saveGuanghe(item.pid, $event.target.value)"
                        style="width:100%;border:none;outline:none;background:transparent;font-size:15px;font-weight:700;color:var(--text);padding:0;cursor:text">
                      <div style="font-size:10px;margin-top:2px;color:var(--muted)">环比上周期 —</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <!-- 任务清单表头 -->
            <div style="display:grid;grid-template-columns:100px 1fr 110px 90px 1fr;gap:0;background:#f8f8f7;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted)">
              <div style="padding:7px 12px;border-right:1px solid var(--border)">任务标签</div>
              <div style="padding:7px 12px;border-right:1px solid var(--border)">任务名称</div>
              <div style="padding:7px 12px;border-right:1px solid var(--border)">负责人</div>
              <div style="padding:7px 12px;border-right:1px solid var(--border)">任务状态</div>
              <div style="padding:7px 12px">任务记录/备注</div>
            </div>
            <!-- 任务行列表 -->
            <div style="display:flex;flex-direction:column">
              <div v-for="(task, ti) in item.tasks" :key="task.id"
                :style="{display:'grid',gridTemplateColumns:'100px 1fr 110px 90px 1fr',gap:'0',alignItems:'start',
                  borderBottom: ti < item.tasks.length-1 ? '1px solid var(--border)' : 'none',
                  background: ti%2===0 ? '#fff' : '#fafaf9'}">
                <!-- 任务标签 -->
                <div style="padding:9px 12px;display:flex;align-items:center;border-right:1px solid var(--border)">
                  <span style="font-size:11px;color:var(--muted);padding:2px 7px;border:1px solid var(--border);border-radius:99px;background:#fff;white-space:nowrap">{{ task.category || '—' }}</span>
                </div>
                <!-- 任务名称（点击可编辑全部字段） -->
                <div style="padding:9px 12px;display:flex;align-items:center;border-right:1px solid var(--border);overflow:hidden"
                  :style="{cursor:canEditTask(task)?'pointer':'default'}"
                  @click="canEditTask(task) && openEditTask(item, task)"
                  :title="canEditTask(task)?'点击编辑任务':''">
                  <div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                    :style="{color:canEditTask(task)?'var(--accent)':'var(--text)'}">{{ task.detail }}</div>
                </div>
                <!-- 负责人（可直接下拉选择） -->
                <div style="padding:6px 8px;display:flex;align-items:center;border-right:1px solid var(--border)">
                  <select :value="task.owner" @change="updateTaskOwner(item.pid, task.id, $event.target.value, task)"
                    :disabled="!canEditTask(task)"
                    style="width:100%;border:1px solid var(--border);border-radius:6px;padding:3px 4px;font-size:11px;background:#fff"
                    :style="{cursor:canEditTask(task)?'pointer':'default',color:'var(--text)'}">
                    <option value="">— 未分配 —</option>
                    <option v-for="u in userOptions" :key="u.id" :value="u.display_name">{{ u.display_name }}</option>
                  </select>
                </div>
                <!-- 任务状态 -->
                <div style="padding:6px 8px;display:flex;align-items:center;border-right:1px solid var(--border)">
                  <select :value="task.status" @change="updateTaskStatus(item.pid, task.id, $event.target.value, task)"
                    :disabled="!canEditTask(task)"
                    style="width:100%;border:1px solid var(--border);border-radius:6px;padding:3px 4px;font-size:11px;background:#fff"
                    :style="{color:statusColor(task.status),fontWeight:'600',cursor:canEditTask(task)?'pointer':'default'}">
                    <option v-for="s in statusOptions" :key="s" :value="s" :style="{color:statusColor(s)}">{{ s||'—' }}</option>
                  </select>
                </div>
                <!-- 任务记录/备注（内联直接编辑，无需弹窗） -->
                <div style="padding:6px 8px;display:flex;align-items:center;overflow:hidden">
                  <textarea v-if="canEditTask(task)"
                    :value="task.note"
                    rows="1"
                    placeholder="填写本周期进展…"
                    @blur="saveInlineNote(item.pid, task.id, $event.target.value)"
                    @focus="$event.currentTarget.style.borderColor='var(--accent)'"
                    style="width:100%;border:1px solid var(--border);border-radius:6px;padding:3px 6px;font-size:11px;resize:none;background:#fff;outline:none;font-family:inherit;color:var(--text)"
                  ></textarea>
                  <div v-else style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:3px 2px">{{ task.note || '暂无记录' }}</div>
                </div>
              </div>
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
  </template>

  <!-- 任务编辑 Modal -->
  <div v-if="taskModal.show" style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000" @click.self="taskModal.show=false">
    <div style="background:#fff;border-radius:14px;padding:24px;width:440px;box-shadow:0 8px 32px rgba(0,0,0,.15)">
      <div style="font-size:15px;font-weight:700;margin-bottom:16px">{{ taskModal.mode==='add' ? '新增任务' : '编辑任务' }}</div>
      <!-- 新增模式：先选模板 -->
      <div v-if="taskModal.mode==='add'" style="margin-bottom:12px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">选择任务模板（可选）</div>
        <select :value="taskModal.templateKey" @change="onTemplateSelect"
          style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff;box-sizing:border-box;color:var(--text)">
          <option value="">— 从模板选择 —</option>
          <option v-for="tpl in taskTemplates" :key="tpl.detail" :value="tpl.detail">【{{ tpl.category }}】{{ tpl.detail }}</option>
          <option value="__custom__">+ 自定义任务（新建）</option>
        </select>
      </div>
      <div style="margin-bottom:12px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">任务名称 <span style="color:#e55">*</span></div>
        <input v-model="taskModal.detail" placeholder="任务描述" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">负责人</div>
          <select v-model="taskModal.owner" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff;box-sizing:border-box">
            <option value="">— 请选择 —</option>
            <option v-for="u in userOptions" :key="u.id" :value="u.display_name">{{ u.display_name }}</option>
          </select>
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">任务标签</div>
          <input v-model="taskModal.category" placeholder="如：投放、内容…" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">任务状态</div>
          <select v-model="taskModal.status" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff">
            <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">任务备注（{{ activePeriod }}）</div>
        <textarea v-model="taskModal.note" rows="3" placeholder="本周期进展记录" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;resize:vertical;box-sizing:border-box"></textarea>
      </div>
      <div style="display:flex;gap:8px">
        <button @click="saveTaskModal" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer;font-weight:600">保存</button>
        <button @click="taskModal.show=false" style="flex:1;background:#f4f4f5;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer">取消</button>
        <button v-if="taskModal.mode==='edit'" @click="deleteTask"
          style="border:1px solid #fecaca;background:#fff;color:#dc2626;border-radius:8px;padding:9px 14px;font-size:12px;cursor:pointer">删除</button>
      </div>
    </div>
  </div>
</div>`
})

