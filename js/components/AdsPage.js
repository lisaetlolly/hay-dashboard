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

    const audienceRatio = 25499.58 / (25499.58 + 9384.97)
    const keywordRatio = 9384.97 / (25499.58 + 9384.97)

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

    const allTasks = computed(() => Object.entries(APP_STATE.value.tasksByPid || {}).flatMap(([pid, list]) => {
      const p = RAW.products?.[pid]
      let gmv = 0, spend = 0, collect = 0, vis = 0
      if (p) {
        for (let i=0;i<p.dates.length;i++) {
          const d = p.dates[i]
          if (d >= periodStart.value && d <= periodEnd.value) {
            gmv += p.pay?.[i] || 0; spend += p.spend?.[i] || 0
            collect += (p.collect?.[i]||0)+(p.cart?.[i]||0); vis += p.vis?.[i] || 0
          }
        }
      }
      return (list||[]).map(t => ({ ...t, pid, image: imgSrc(pid),
        metrics: { gmv:+gmv.toFixed(2), spend:+spend.toFixed(2), collect:Math.round(collect),
          visitors:Math.round(vis), roi: spend>0 ? +(gmv/spend).toFixed(2) : null }
      }))
    }))

    const taskPeriods = computed(() => {
      const raw = RAW.task_periods || []
      const custom = APP_STATE.value.customPeriods || []
      return [...new Set([...raw, ...custom])].sort()
    })
    const selectedPeriod = ref('')
    const activePeriod = computed(() =>
      selectedPeriod.value || taskPeriods.value[taskPeriods.value.length-1] || ''
    )
    const newPeriodInput = ref('')
    const addPeriod = () => {
      const p = newPeriodInput.value.trim()
      if (!p) return
      const existing = taskPeriods.value
      if (!existing.includes(p)) {
        APP_STATE.value.customPeriods = [...(APP_STATE.value.customPeriods || []), p]
        persistAppState()
      }
      selectedPeriod.value = p
      newPeriodInput.value = ''
    }

    const currentUser = computed(() => currentUserObj())
    const canEditTask = (task) => {
      const u = currentUser.value
      if (!u) return false
      if (u.role === 'admin' || (u.permissions || []).includes('*')) return true
      return task.owner === u.display_name
    }

    const teamFilters = ref({ owner:'', category:'', productKeyword:'', status:'' })
    const ownerOptions = computed(() => [...new Set(allTasks.value.map(t => t.owner).filter(Boolean))])
    const categoryOptions = computed(() => [...new Set(allTasks.value.map(t => RAW.products?.[t.pid]?.cat).filter(Boolean))])
    const statusOptions = ['待开始','进行中','已完成']
    const taskGroups = computed(() => {
      const byPid = {}
      const period = activePeriod.value
      for (const t of allTasks.value) {
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
      for (const m of (RAW.meetings || [])) {
        const k = m.week_label || m.meeting_date
        if (!byWeek[k] || m.meeting_date > byWeek[k].meeting_date) byWeek[k] = m
      }
      return Object.values(byWeek).sort((a,b)=>b.meeting_date.localeCompare(a.meeting_date)).slice(0,8)
    })
    const latestMeeting = computed(() => meetings.value[0] || null)
    const toggleChannel = key => { openChannel.value[key] = !openChannel.value[key] }

    const taskModal = ref({ show:false, pid:'', id:'', detail:'', owner:'', category:'', status:'待开始', note:'' })
    const openEditTask = (item, task) => {
      if (!canEditTask(task)) return
      Object.assign(taskModal.value, { show:true, pid:item.pid, id:task.id, detail:task.detail, owner:task.owner, category:task.category, status:task.status||'待开始', note:task.note||'' })
    }
    const saveTaskModal = () => {
      const { pid, id, detail, owner, category, status, note } = taskModal.value
      const list = APP_STATE.value.tasksByPid[pid]
      if (!list) return (taskModal.value.show = false)
      const t = list.find(x => x.id === id)
      if (t) {
        t.detail = detail; t.owner = owner; t.category = category; t.status = status
        if (!t.period_notes) t.period_notes = {}
        t.period_notes[activePeriod.value] = note
      }
      persistAppState(); taskModal.value.show = false
    }
    const updateTaskStatus = (pid, taskId, newStatus, task) => {
      if (!canEditTask(task || {})) return
      const list = APP_STATE.value.tasksByPid[pid]
      const t = list?.find(x => x.id === taskId)
      if (t) { t.status = newStatus; persistAppState() }
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
      channelRows, trendRows, meetings, latestMeeting, taskGroups, taskPeriods, selectedPeriod, activePeriod,
      newPeriodInput, addPeriod, canEditTask,
      teamFilters, ownerOptions, categoryOptions, statusOptions, fmtMoney, fmtDelta, statusColor, imgSrc, toggleChannel,
      adsCtr, ctrRankRows,
      channelCatData,
      taskModal, openEditTask, saveTaskModal, updateTaskStatus, userOptions,
    }
  },
  template: `
<div style="display:flex;flex-direction:column;gap:16px">
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
      <div class="kpi-card"><div class="kpi-label">总投放<span class="info-btn">?<span class="tooltip">万象台商品报表口径人群+关键词花费，加上内容报表短视频花费的总和。三个渠道分别独立统计。</span></span></div><div class="kpi-value">¥{{ totalPaidSpendWan }}万</div><div class="kpi-footer"><span>人群+关键词+短视频</span></div></div>
      <div class="kpi-card"><div class="kpi-label">人群<span class="info-btn">?<span class="tooltip">万象台「人群推广」渠道花费，按商品报表总花费 × 73.1% 估算（实际比例来自报表期总数）。计划目标 73.1%。</span></span></div><div class="kpi-value">{{ fmtMoney(audienceSpend) }}</div><div class="kpi-footer"><span>渠道口径</span></div></div>
      <div class="kpi-card"><div class="kpi-label">关键词<span class="info-btn">?<span class="tooltip">万象台「关键词推广」渠道花费，按商品报表总花费 × 26.9% 估算。计划目标 26.9%，无强制要求。</span></span></div><div class="kpi-value">{{ fmtMoney(keywordSpend) }}</div><div class="kpi-footer"><span>渠道口径</span></div></div>
      <div class="kpi-card"><div class="kpi-label">短视频<span class="info-btn">?<span class="tooltip">内容报表「短视频」类型花费，与搜推报表独立统计，不叠加在人群/关键词中。来源：推广报表→内容报表。</span></span></div><div class="kpi-value">{{ fmtMoney(videoSpend) }}</div><div class="kpi-footer"><span>内容报表口径</span></div></div>
      <div class="kpi-card"><div class="kpi-label">类目拆分额<span class="info-btn">?<span class="tooltip">商品报表口径的各品类投放花费，直接来自商品级数据累加，不经渠道比例换算，用于类目计划 vs 实际对比。</span></span></div><div class="kpi-value">¥{{ totalProductSpendWan }}万</div><div class="kpi-footer"><span>商品报表口径</span></div></div>
      <div class="kpi-card"><div class="kpi-label">推广 CTR<span class="info-btn">?<span class="tooltip">万象台商品报表 CTR 字段均值（点击量 ÷ 展现量 × 100%）。仅统计有曝光的商品，按商品数取算术均值。</span></span></div><div class="kpi-value">{{ adsCtr != null ? adsCtr.toFixed(2)+'%' : '—' }}</div><div class="kpi-footer"><span>万象台均值</span></div></div>
    </div>

    <div class="card" style="padding:16px">
      <div class="card-header" style="margin-bottom:12px"><span class="card-title">投放趋势</span><span class="card-sub">当前周期按日</span></div>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow:auto">
        <div style="display:grid;grid-template-columns:84px repeat(3,1fr);gap:10px;padding:0 4px 6px;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted)">
          <div>日期</div><div style="text-align:right">花费</div><div style="text-align:right">成交额</div><div style="text-align:right">ROI / 收藏加购</div>
        </div>
        <div v-for="row in trendRows" :key="row.d" style="display:grid;grid-template-columns:84px repeat(3,1fr);gap:10px;padding:6px 4px;border-bottom:1px solid #f1f5f9;font-size:11px;align-items:center">
          <div style="color:var(--muted)">{{ row.d.slice(5) }}</div>
          <div style="text-align:right;font-weight:600">{{ fmtMoney(row.spend) }}</div>
          <div style="text-align:right;font-weight:600">{{ fmtMoney(row.gmv) }}</div>
          <div style="text-align:right;color:var(--muted)">{{ row.roi == null ? '—' : 'ROI ' + row.roi }} / {{ row.collect }}</div>
        </div>
      </div>
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
            <select v-if="taskPeriods.length>1" v-model="selectedPeriod"
              style="border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:12px;background:#fff;cursor:pointer;color:var(--muted)">
              <option v-for="p in taskPeriods" :key="p" :value="p">{{ p }}</option>
            </select>
            <input v-model="newPeriodInput" placeholder="新时间段名称" @keydown.enter="addPeriod"
              style="border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:12px;width:120px;background:#fff">
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
                <div>
                  <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ item.name }}</div>
                  <div style="font-size:11px;color:var(--muted)">{{ item.pid }}</div>
                </div>
                <div>
                  <div style="font-size:10px;color:var(--muted);margin-bottom:6px">数据统计时间：{{ periodLabel }}</div>
                  <div style="display:flex;gap:24px;flex-wrap:wrap">
                    <div style="display:flex;flex-direction:column;gap:2px">
                      <span style="font-size:10px;color:var(--muted)">成交额</span>
                      <span style="font-size:16px;font-weight:700;color:var(--text)">{{ fmtMoney(item.metrics.gmv) }}</span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:2px">
                      <span style="font-size:10px;color:var(--muted)">花费</span>
                      <span style="font-size:16px;font-weight:700;color:var(--text)">{{ fmtMoney(item.metrics.spend) }}</span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:2px">
                      <span style="font-size:10px;color:var(--muted)">ROI</span>
                      <span style="font-size:16px;font-weight:700;color:var(--text)">{{ item.metrics.roi == null ? '—' : item.metrics.roi }}</span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:2px">
                      <span style="font-size:10px;color:var(--muted)">收藏加购</span>
                      <span style="font-size:16px;font-weight:700;color:var(--text)">{{ item.metrics.collect }}</span>
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
                :style="{display:'grid',gridTemplateColumns:'100px 1fr 110px 90px 1fr',gap:'0',alignItems:'stretch',
                  borderBottom: ti < item.tasks.length-1 ? '1px solid var(--border)' : 'none',
                  background: ti%2===0 ? '#fff' : '#fafaf9'}">
                <!-- 任务标签 -->
                <div style="padding:9px 12px;display:flex;align-items:center;border-right:1px solid var(--border)">
                  <span style="font-size:11px;color:var(--muted);padding:2px 7px;border:1px solid var(--border);border-radius:99px;background:#fff;white-space:nowrap">{{ task.category || '—' }}</span>
                </div>
                <!-- 任务名称 -->
                <div style="padding:9px 12px;display:flex;align-items:center;border-right:1px solid var(--border);overflow:hidden">
                  <div style="font-size:12px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ task.detail }}</div>
                </div>
                <!-- 负责人 -->
                <div style="padding:9px 12px;display:flex;align-items:center;border-right:1px solid var(--border);overflow:hidden">
                  <span style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="task.owner">{{ task.owner || '—' }}</span>
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
                <!-- 任务记录/备注（点击可编辑） -->
                <div @click="openEditTask(item, task)"
                  :style="{padding:'9px 12px',display:'flex',alignItems:'center',overflow:'hidden',
                    cursor:canEditTask(task)?'pointer':'default',
                    background:canEditTask(task)?'transparent':'inherit'}"
                  :title="canEditTask(task)?'点击编辑':''">
                  <div style="flex:1;min-width:0;overflow:hidden">
                    <div v-if="task.note" style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ task.note }}</div>
                    <div v-else style="font-size:11px;font-style:italic"
                      :style="{color:canEditTask(task)?'var(--accent)':'#d1d5db'}">
                      {{ canEditTask(task) ? '点击添加记录…' : '暂无记录' }}</div>
                  </div>
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
    <div style="background:#fff;border-radius:14px;padding:24px;width:420px;box-shadow:0 8px 32px rgba(0,0,0,.15)">
      <div style="font-size:15px;font-weight:700;margin-bottom:16px">编辑任务</div>
      <div style="margin-bottom:12px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">任务名称</div>
        <input v-model="taskModal.detail" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
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
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">任务状态</div>
          <select v-model="taskModal.status" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff">
            <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom:20px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">任务备注（{{ activePeriod }}）</div>
        <textarea v-model="taskModal.note" rows="3" placeholder="本周期进展记录" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;resize:vertical;box-sizing:border-box"></textarea>
      </div>
      <div style="display:flex;gap:8px">
        <button @click="saveTaskModal" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer;font-weight:600">保存</button>
        <button @click="taskModal.show=false" style="flex:1;background:#f4f4f5;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer">取消</button>
      </div>
    </div>
  </div>
</div>`
})

