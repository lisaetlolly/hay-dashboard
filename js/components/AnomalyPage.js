// ── AnomalyPage.js ────────────────────────────────────────────
// 「异常预警」页签。客户端从 RAW.products（/api/raw-data 时序）跑异常规则，
// 大盘 KPI 调 /api/overview/kpi（店铺级，对齐看板口径），任务建议读 /api/tasks，
// 支持一键加任务 / 批量加任务（POST /api/tasks）。无新增后端接口。
// 规则源 AI_异常预警逻辑_v1.xlsx；判断逻辑见 report/anomaly_report.py（保持一致）。

const AnomalyPage = defineComponent({
  props: { start: String, end: String },
  setup(props) {
    const T = { dropFloor:500, cliffToday:50, burnSpend:200, trafficAvg:20, trafficRatio:0.05,
                cartAvg:5, collectAvg:3, reviveAvg:100, reviveMult:5, bounceJump:0.20,
                refundRate:0.30, refundFloor:500, visFloor:20 }
    // 异常主因 → 任务类目 + 负责人（与看板任务模块分工一致）
    const MAP = {
      '投放': ['妈妈计划迭代', '晓东（运营）'],
      '退款': ['售卖复盘',     '晓东（运营）'],
      '搜索': ['标题优化',     'Jas team'],
      '落地页':['详情页优化',   '豆豆（设计）'],
      '竞品': ['竞品分析',     '刘婷（商品）'],
    }
    const TYPE_PRIORITY = ['投放','退款','搜索','落地页','竞品']
    const SEV = {
      L1: { label:'成交预警', color:'#e23b3b', desc:'近期天天卖、今天突然停或腰斩' },
      L2: { label:'投放预警', color:'#d6892a', desc:'推广烧钱不出单 / ROI 差' },
      L3: { label:'流量预警', color:'#2f6fb0', desc:'流量、加购、收藏先跌' },
      L4: { label:'退款预警', color:'#6b7280', desc:'退款率高、白卖' },
    }
    const ORDER = ['L1','L2','L3','L4']

    const loading   = ref(true)
    const cards     = ref([])
    const kpi       = ref([])
    const tab       = ref('ALL')
    const selected  = ref({})           // pid -> true（批量选择）
    const openTasks = ref({})           // pid -> [{id,status,category}]
    const toast     = ref('')
    const anomalyDate = computed(() => props.end || RAW.data_end)

    const yuan = v => '¥' + Math.round(v || 0).toLocaleString()
    const mean = a => a.length ? a.reduce((x,y)=>x+y,0) / a.length : 0
    const prevAvg = (arr, idx, n=7) => {
      const w = []
      for (let j = idx-1; j >= 0 && w.length < n; j--) w.push(+arr?.[j] || 0)
      return mean(w)
    }

    // ── 跑异常规则（客户端，按所选日）──
    const compute = () => {
      const D = anomalyDate.value
      const out = []
      for (const [sid, p] of Object.entries(RAW.products || {})) {
        const idx = (p.dates || []).indexOf(D)
        if (idx < 0) continue
        const cp = +p.pay?.[idx]   || 0
        const cv = +p.vis?.[idx]   || 0
        const cref = +p.refund?.[idx] || 0
        const cc = +p.cart_qty?.[idx] || 0
        const ccol = +p.collect?.[idx] || 0
        const spend = +p.spend?.[idx] || 0
        const roi   = +p.roi?.[idx] || 0
        const adgmv = spend * roi
        const pv = prevAvg(p.vis, idx), pc = prevAvg(p.cart_qty, idx), pcol = prevAvg(p.collect, idx)
        const ppAll = prevAvg(p.pay, idx)
        const bToday = +p.bounce_rate?.[idx] || 0
        const bPrev = prevAvg(p.bounce_rate, idx)
        const reasons = []

        // 投放：烧钱不出单 / ROI<1
        if (spend >= T.burnSpend && adgmv === 0) reasons.push(['投放', `推广花了 ${yuan(spend)}，一单都没回本`])
        else if (spend >= T.burnSpend && adgmv/spend < 1) reasons.push(['投放', `推广花 ${yuan(spend)} 只回 ${yuan(adgmv)}，亏本`])

        // 成交预警：近期几乎天天卖、今天突然停/腰斩；基准=在卖那些天的日均
        let crash = false, base = ppAll
        const prior = []
        for (let j = idx-1; j >= 0 && prior.length < 7; j--) prior.push(+p.pay?.[j] || 0)
        const sell = prior.filter(v => v > T.cliffToday)
        const avail = prior.length, soldN = sell.length
        const sellAvg = soldN ? sell.reduce((a,b)=>a+b,0)/soldN : 0
        if (avail >= 5 && soldN/avail >= 0.8 && sellAvg >= T.dropFloor) {
          base = sellAvg
          if (cp <= T.cliffToday) { crash = true; reasons.push(['搜索', `之前 ${avail} 天有 ${soldN} 天在卖（几乎天天卖），今天突然没成交（在卖日均 ${yuan(sellAvg)}）`]) }
          else if (cp < sellAvg*0.5) { crash = true; reasons.push(['搜索', `之前几乎天天卖、日均 ${yuan(sellAvg)}，今天只卖 ${yuan(cp)}（腰斩）`]) }
        }
        // 流量 / 加购 / 收藏 / 跳出
        if (pv >= T.trafficAvg && cv < pv*T.trafficRatio) reasons.push(['落地页', `访客从每天 ${Math.round(pv)} 人掉到 ${cv} 人`])
        if (pc >= T.cartAvg && cc === 0) reasons.push(['落地页', `以前每天有人加购 ${Math.round(pc)} 件，今天 0 加购`])
        if (pcol >= T.collectAvg && ccol === 0) reasons.push(['落地页', `以前每天 ${Math.round(pcol)} 人收藏，今天 0 收藏`])
        if (bToday - bPrev >= T.bounceJump && cv >= 10) reasons.push(['落地页', `打开就走的人多了 ${Math.round((bToday-bPrev)*100)} 个点（详情页/流量不精准）`])
        // 老品翻红
        if (ppAll > 0 && ppAll <= T.reviveAvg && cp >= ppAll*T.reviveMult && cp > 200) reasons.push(['竞品', `老品翻红：日均从 ${yuan(ppAll)} 涨到 ${yuan(cp)}（注意备货/看竞品）`])
        // 退款率高
        if (cp > 0 && cref/cp >= T.refundRate && cref >= T.refundFloor) reasons.push(['退款', `退款率 ${Math.round(cref/cp*100)}%（退了 ${yuan(cref)}，才卖 ${yuan(cp)}）`])

        if (!reasons.length) continue
        const types = new Set(reasons.map(r => r[0]))
        const ptype = TYPE_PRIORITY.find(t => types.has(t))
        const [tcat, owner] = MAP[ptype] || ['', '']
        let sev = 'L2'
        if (types.has('退款') && !crash) sev = 'L4'
        else if (crash) sev = 'L1'
        else if (types.has('投放')) sev = 'L2'
        else if (types.has('落地页')) sev = 'L3'
        out.push({ sev, pid: sid, title: p.title || sid,
                   cat: p.cat || '', cp, base, cv, reason: reasons.slice(0,3).map(r=>r[1]).join('；'),
                   primary: reasons[0][1], tcat, owner })
      }
      const sevRank = { L1:0, L2:1, L3:2, L4:3 }
      out.sort((a,b) => sevRank[a.sev]-sevRank[b.sev] || (b.base-b.cp)-(a.base-a.cp))
      cards.value = out
    }

    // ── 大盘 KPI（店铺级，今天 vs 上周同日）──
    const shiftDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10) }
    const loadKpi = async () => {
      const D = anomalyDate.value, W = shiftDays(D, -7)
      let cur = {}, wk = {}
      try { cur = await fetch(`/api/overview/kpi?start=${D}&end=${D}`).then(r=>r.json()) } catch {}
      try { wk  = await fetch(`/api/overview/kpi?start=${W}&end=${W}`).then(r=>r.json()) } catch {}
      const g = (o,k) => (o && o[k] != null) ? +o[k] : null
      const pct = (a,b) => (a==null||b==null||b===0) ? null : (a-b)/b*100
      const pay = g(cur,'pay'), refund = g(cur,'refund'), buyers = g(cur,'pay_buyers')
      const wpay = g(wk,'pay'), wref = g(wk,'refund'), wbuy = g(wk,'pay_buyers')
      const rr  = (pay) ? refund/pay*100 : null
      const wrr = (wpay) ? wref/wpay*100 : null
      kpi.value = [
        { n:'支付金额', v: pay,    ch: pct(pay,wpay),    money:true,  good:(pct(pay,wpay)||0)>=0 },
        { n:'退款金额', v: refund, ch: pct(refund,wref), money:true,  good:(pct(refund,wref)||0)<0 },
        { n:'全店退款率', v: rr,   ch: (rr!=null&&wrr!=null)?rr-wrr:null, rate:true, good:(rr!=null&&wrr!=null)?rr<=wrr:true },
        { n:'支付买家数', v: buyers, ch: pct(buyers,wbuy), good:(pct(buyers,wbuy)||0)>=0 },
      ]
    }

    const loadTasks = async () => {
      try {
        const list = await fetch('/api/tasks').then(r=>r.json())
        const m = {}
        for (const t of (Array.isArray(list)?list:[])) {
          if (!['待开始','进行中'].includes(t.status)) continue
          ;(m[t.product_id] = m[t.product_id] || []).push(t)
        }
        openTasks.value = m
      } catch {}
    }

    const existingRef = (c) => {
      const hit = (openTasks.value[c.pid] || []).find(t => (t.category||'') === c.tcat)
      return hit ? `已有任务#${hit.id} ${hit.status}` : ''
    }

    const refreshAll = async () => {
      loading.value = true
      compute(); await Promise.all([loadKpi(), loadTasks()])
      loading.value = false
    }
    onMounted(refreshAll)
    watch(() => props.end, refreshAll)

    // ── 加任务 ──
    const buildTask = (c) => ({
      product_id: c.pid,
      detail: `[异常预警·${SEV[c.sev].label}] ${c.title} — ${c.primary}`,
      owner: c.owner, category: c.tcat, status: '待开始',
      priority: c.sev === 'L1' ? '高' : '中',
      time_range_label: anomalyDate.value,
    })
    const postTask = async (body) => {
      const r = await fetch('/api/tasks', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    }
    const showToast = (m) => { toast.value = m; setTimeout(()=>toast.value='', 2600) }
    const addOne = async (c) => {
      if (existingRef(c)) { showToast('该商品已有同类任务，去任务页跟进即可'); return }
      try { await postTask(buildTask(c)); await loadTasks(); showToast(`已为「${c.title}」新建${c.tcat}任务（${c.owner}）`) }
      catch (e) { showToast('加任务失败：' + e.message + '（需登录且有建任务权限）') }
    }
    const visibleCards = computed(() => tab.value==='ALL' ? cards.value : cards.value.filter(c => c.sev===tab.value))
    const selCount = computed(() => Object.values(selected.value).filter(Boolean).length)
    const toggle = (pid) => { selected.value = { ...selected.value, [pid]: !selected.value[pid] } }
    const selectAllVisible = () => {
      const s = { ...selected.value }; const all = visibleCards.value.every(c => s[c.pid])
      visibleCards.value.forEach(c => s[c.pid] = !all); selected.value = s
    }
    const addBatch = async () => {
      const chosen = cards.value.filter(c => selected.value[c.pid] && !existingRef(c))
      if (!chosen.length) { showToast('没有可新建的（已选的都已有任务或未选）'); return }
      let ok = 0
      for (const c of chosen) { try { await postTask(buildTask(c)); ok++ } catch {} }
      await loadTasks(); selected.value = {}; showToast(`批量新建 ${ok} 个任务完成`)
    }

    const counts = computed(() => { const m={}; ORDER.forEach(s=>m[s]=cards.value.filter(c=>c.sev===s).length); return m })
    const fmtKpi = k => k.v==null ? '—' : (k.rate ? k.v.toFixed(1)+'%' : (k.money ? yuan(k.v) : Math.round(k.v).toLocaleString()))
    const fmtCh  = k => k.ch==null ? '—' : (k.ch>=0?'+':'') + k.ch.toFixed(1) + (k.rate?'pct':'%')

    return { SEV, ORDER, loading, kpi, cards, tab, anomalyDate, visibleCards, counts, selected, selCount,
             toggle, selectAllVisible, addOne, addBatch, existingRef, yuan, fmtKpi, fmtCh, toast }
  },
  template: `
<div style="padding:2px 2px 60px">
  <div v-if="loading" style="padding:60px;text-align:center;color:var(--muted)">正在计算异常…</div>
  <template v-else>
    <!-- 大盘 KPI -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      <div v-for="k in kpi" :key="k.n" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">{{ k.n }}</div>
        <div style="font-size:23px;font-weight:700;color:var(--text)">{{ fmtKpi(k) }}</div>
        <div :style="{fontSize:'12px',marginTop:'5px',fontWeight:600,color:k.good?'#1b7a3e':'#e23b3b'}">较上周同期 {{ fmtCh(k) }}</div>
      </div>
    </div>

    <!-- 筛选标签 -->
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px">
      <div @click="tab='ALL'" :style="tabStyle('ALL')">全部 <b>{{ cards.length }}</b></div>
      <div v-for="s in ORDER" :key="s" @click="tab=s" :style="tabStyle(s)">
        <span :style="{display:'inline-block',width:'8px',height:'8px',borderRadius:'50%',background:SEV[s].color,marginRight:'6px'}"></span>
        {{ SEV[s].label }} <b>{{ counts[s] }}</b>
      </div>
      <div style="flex:1"></div>
      <div style="font-size:12px;color:var(--muted)">数据日 {{ anomalyDate }}</div>
    </div>

    <!-- 批量操作条 -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;font-size:13px">
      <button @click="selectAllVisible" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:5px 12px;cursor:pointer;color:var(--text)">全选当前</button>
      <button @click="addBatch" :disabled="!selCount"
              :style="{background:selCount?'var(--accent)':'var(--border)',color:'#fff',border:'none',borderRadius:'6px',padding:'5px 14px',cursor:selCount?'pointer':'default'}">
        批量加任务（已选 {{ selCount }}）
      </button>
      <span style="color:var(--muted)">勾选卡片右上角，或逐条点「+ 加任务」</span>
    </div>

    <!-- 卡片网格 -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px">
      <div v-for="c in visibleCards" :key="c.pid"
           :style="{background:'var(--surface)',border:'1px solid var(--border)',borderLeft:'4px solid '+SEV[c.sev].color,borderRadius:'10px',padding:'13px 15px'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">
          <span :style="{fontSize:'12px',fontWeight:700,color:'#fff',background:SEV[c.sev].color,borderRadius:'5px',padding:'2px 9px'}">{{ SEV[c.sev].label }}</span>
          <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);cursor:pointer">
            <input type="checkbox" :checked="!!selected[c.pid]" @change="toggle(c.pid)"> 选
          </label>
        </div>
        <div style="font-size:14px;font-weight:600;color:var(--text);line-height:1.3">{{ c.title }}
          <span style="font-size:11px;color:var(--muted);font-weight:400">{{ c.pid }}</span></div>
        <div style="display:flex;gap:16px;margin:9px 0;align-items:baseline">
          <div><div style="font-size:11px;color:var(--muted)">今天成交</div><div style="font-size:15px;font-weight:600;color:var(--text)">{{ yuan(c.cp) }}</div></div>
          <div><div style="font-size:11px;color:var(--muted)">近7天在卖日均</div><div style="font-size:15px;font-weight:600;color:var(--muted)">{{ yuan(c.base) }}</div></div>
          <div><div style="font-size:11px;color:var(--muted)">今天访客</div><div style="font-size:15px;font-weight:600;color:var(--text)">{{ Math.round(c.cv).toLocaleString() }}人</div></div>
        </div>
        <div style="font-size:12.5px;color:var(--text);background:var(--bg);border-radius:8px;padding:7px 10px;line-height:1.5;margin-bottom:9px">{{ c.reason }}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="flex:1;font-size:12px;color:var(--muted)">建议：<b style="color:var(--text)">{{ c.tcat }}</b> · {{ c.owner }}</span>
          <span v-if="existingRef(c)" style="font-size:11.5px;color:#1b7a3e">{{ existingRef(c) }}</span>
          <button v-else @click="addOne(c)"
                  style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:4px 11px;font-size:12px;cursor:pointer;white-space:nowrap">+ 加任务</button>
        </div>
      </div>
    </div>
    <div v-if="!visibleCards.length" style="padding:50px;text-align:center;color:var(--muted)">本类暂无异常 🎉</div>
  </template>

  <div v-if="toast" style="position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1f2933;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.2)">{{ toast }}</div>
</div>`,
  methods: {
    tabStyle(id) {
      const active = this.tab === id
      return { cursor:'pointer', borderRadius:'999px', padding:'6px 13px', fontSize:'13px',
               border:'1px solid var(--border)', userSelect:'none',
               background: active ? 'var(--accent)' : 'var(--surface)',
               color: active ? '#fff' : 'var(--text)' }
    }
  }
})
