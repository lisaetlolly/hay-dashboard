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
                refundRate:0.30, refundFloor:500, visFloor:20,
                // chen 分品类逻辑：红灯(今天处理)/黄灯(本周处理)
                dropRed:0.60, dropYellow:0.30, cumFloor:300,
                lowFreqDays:5, consec0Red:10, consec0Yellow:6 }
    // 红灯/黄灯展示
    const LIGHT = { red:{ label:'红灯·今天处理', color:'#e5484d' }, yellow:{ label:'黄灯·本周处理', color:'#d6892a' } }
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
      L1: { label:'成交预警', color:'#e5484d', desc:'近期天天卖、今天突然停或腰斩' },
      L2: { label:'投放预警', color:'#d6892a', desc:'推广烧钱不出单 / ROI 差' },
      L3: { label:'流量预警', color:'#2f6fb0', desc:'流量、加购、收藏先跌' },
      L4: { label:'退款预警', color:'#64748b', desc:'退款率高、白卖' },
    }
    const ORDER = ['L1','L2','L3','L4']

    const loading   = ref(true)
    const cards     = ref([])
    const kpi       = ref([])
    const tab       = ref('ALL')
    const openTasks = ref({})           // pid -> [{id,status,category}]
    const toast     = ref('')
    const anomalyDate = computed(() => props.end || RAW.data_end)
    const csView = ref('issue')                       // 客服异常视角：issue=按问题 / agent=按客服
    const CS = (typeof window !== 'undefined' && window.HAY_CS_WEEK) ? window.HAY_CS_WEEK : null

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
        const cat = p.cat || ''
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
        if (spend >= T.burnSpend && adgmv === 0) reasons.push(['投放', `推广花费 ${yuan(spend)}，成交转化为 0`])
        else if (spend >= T.burnSpend && adgmv/spend < 1) reasons.push(['投放', `推广花费 ${yuan(spend)}，回收 ${yuan(adgmv)}，ROI<1`])

        // ── 成交预警（chen 分品类逻辑 + 红灯/黄灯）──
        let crash = false, light = '', base = ppAll
        const W = (arr, a, b) => { let s=0; for (let j=Math.max(0,a); j<=b && j<(arr?.length||0); j++) s+=+arr[j]||0; return s }
        const payArr=p.pay||[], cartArr=p.cart_qty||[], visArr=p.vis||[], buyArr=p.pay_buyers||[]
        // 近3周在卖天数+总额（判断"低频但近期活跃"，剔除久不卖的死品）+ 末尾连续 0 单天数
        let sd21=0, tot21=0
        for (let j=idx; j>idx-21 && j>=0; j--) { const v=+payArr[j]||0; if (v>T.cliffToday) sd21++; tot21+=v }
        let consec0=0
        for (let j=idx; j>=0; j--) { if ((+payArr[j]||0) <= T.cliffToday) consec0++; else break }
        // 近7天在卖日均（剔除 0 那些天）
        const sp=[]; for (let j=idx-1; j>=0 && sp.length<7; j--) sp.push(+payArr[j]||0)
        const sv=sp.filter(v=>v>T.cliffToday); const sellAvg=sv.length?sv.reduce((a,b)=>a+b,0)/sv.length:0
        const lowFreq = sd21>=2 && sd21<=8 && tot21>=1000   // 低频但近期真在卖
        // 7日加购 & 转化率（辅助信号）
        const cart7=W(cartArr,idx-6,idx), cartP7=W(cartArr,idx-13,idx-7)
        const cvr7=W(visArr,idx-6,idx)?W(buyArr,idx-6,idx)/W(visArr,idx-6,idx):0
        const cvrP7=W(visArr,idx-13,idx-7)?W(buyArr,idx-13,idx-7)/W(visArr,idx-13,idx-7):0
        const qualDown=(cartP7>0&&cart7<cartP7*0.7)&&(cvrP7>0&&cvr7<cvrP7*0.7)
        const qn=qualDown?'；近7天加购和转化率同步下滑':''
        const fire=(lt,msg)=>{ crash=true; light=lt; reasons.push(['搜索', msg]) }
        if (lowFreq && consec0<=21) {
          if (consec0>=T.consec0Red)        fire('red',    `低频商品：连续 ${consec0} 天无成交（近3周有成交 ${sd21} 天、共 ${yuan(tot21)}）`)
          else if (consec0>=T.consec0Yellow) fire('yellow', `低频商品：连续 ${consec0} 天无成交（近3周有成交 ${sd21} 天）`)
        } else if (cat==='灯具') {
          const s3=W(payArr,idx-2,idx), p3=W(payArr,idx-5,idx-3); base=p3/3
          if (p3>=T.cumFloor) { const d=1-s3/p3
            if (s3<=T.cliffToday||d>=T.dropRed) fire('red', `近3日累计成交 ${yuan(s3)}，较前3日 ${yuan(p3)} 下降 ${Math.round(d*100)}%${qn}`)
            else if (d>=T.dropYellow||qualDown) fire('yellow', `近3日累计成交 ${yuan(s3)}，较前3日 ${yuan(p3)} 下降 ${Math.round(Math.max(d,0)*100)}%${qn}`) }
        } else if (cat==='家具') {
          const s7=W(payArr,idx-6,idx), p7=W(payArr,idx-13,idx-7); base=p7/7
          if (p7>=T.cumFloor*2) { const d=1-s7/p7
            if (d>=T.dropRed) fire('red', `本周累计成交 ${yuan(s7)}，较上周 ${yuan(p7)} 下降 ${Math.round(d*100)}%${qn}`)
            else if (d>=T.dropYellow||qualDown) fire('yellow', `本周累计成交 ${yuan(s7)}，较上周 ${yuan(p7)} 下降 ${Math.round(Math.max(d,0)*100)}%${qn}`) }
        } else {
          base=sellAvg; const avail=sp.length, soldN=sv.length
          if (avail>=5 && soldN/avail>=0.8 && sellAvg>=T.dropFloor) {
            if (cp<=T.cliffToday)            fire('red', `近期日销稳定（日均 ${yuan(sellAvg)}），今日成交归零`)
            else if (cp<sellAvg*(1-T.dropRed)) fire('red', `近期日均 ${yuan(sellAvg)}，今日成交 ${yuan(cp)}，环比下降 ${Math.round((1-cp/sellAvg)*100)}%`)
            else if (cp<sellAvg*(1-T.dropYellow)) fire('yellow', `近期日均 ${yuan(sellAvg)}，今日成交 ${yuan(cp)}，环比下降 ${Math.round((1-cp/sellAvg)*100)}%`)
          }
        }
        // 流量 / 加购 / 收藏 / 跳出
        if (pv >= T.trafficAvg && cv < pv*T.trafficRatio) reasons.push(['落地页', `访客从日均 ${Math.round(pv)} 人降至 ${cv} 人`])
        if (pc >= T.cartAvg && cc === 0) reasons.push(['落地页', `加购骤降为 0（前期日均 ${Math.round(pc)} 件）`])
        if (pcol >= T.collectAvg && ccol === 0) reasons.push(['落地页', `收藏骤降为 0（前期日均 ${Math.round(pcol)} 人）`])
        if (bToday - bPrev >= T.bounceJump && cv >= 10) reasons.push(['落地页', `详情页跳出率上升 ${Math.round((bToday-bPrev)*100)} pct（流量精准度下降）`])
        // 老品销量回升
        if (ppAll > 0 && ppAll <= T.reviveAvg && cp >= ppAll*T.reviveMult && cp > 200) reasons.push(['竞品', `老品销量回升：日均从 ${yuan(ppAll)} 升至 ${yuan(cp)}（关注备货/竞品）`])
        // 退款率偏高
        if (cp > 0 && cref/cp >= T.refundRate && cref >= T.refundFloor) reasons.push(['退款', `退款率 ${Math.round(cref/cp*100)}%（退款 ${yuan(cref)} / 成交 ${yuan(cp)}）`])

        if (!reasons.length) continue
        const types = new Set(reasons.map(r => r[0]))
        const ptype = TYPE_PRIORITY.find(t => types.has(t))
        const [tcat, owner] = MAP[ptype] || ['', '']
        let sev = 'L2'
        if (types.has('退款') && !crash) sev = 'L4'
        else if (crash) sev = 'L1'
        else if (types.has('投放')) sev = 'L2'
        else if (types.has('落地页')) sev = 'L3'
        // 紧急度（红=今天处理/黄=本周跟进）覆盖所有类型；成交已在上面定了 light
        if (!light) {
          if (sev==='L4')      light = (cp>0 && cref/cp>=0.5) ? 'red' : 'yellow'
          else if (sev==='L2') light = (adgmv===0 && spend>=T.burnSpend) ? 'red' : 'yellow'
          else if (sev==='L3') light = (pv>=T.trafficAvg && cv < pv*T.trafficRatio) ? 'red' : 'yellow'
          else light = 'yellow'
        }
        out.push({ sev, light, pid: sid, title: p.name || sid,
                   cat: p.cat || '', cp, base, cv, reason: reasons.slice(0,3).map(r=>r[1]).join('；'),
                   primary: reasons[0][1], tcat, owner })
      }
      const sevRank = { L1:0, L2:1, L3:2, L4:3 }
      const lightRank = x => x.light==='red' ? 0 : x.light==='yellow' ? 1 : 2
      out.sort((a,b) => sevRank[a.sev]-sevRank[b.sev] || lightRank(a)-lightRank(b) || (b.base-b.cp)-(a.base-a.cp))
      cards.value = out
    }

    // ── 大盘 KPI（店铺级，今天 vs 上周同日）──
    const shiftDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10) }
    // 大盘 KPI：从 RAW.products（商品级）按日汇总，今天 vs 上周同日。
    // 不用 /api/overview/kpi：单日查询会因 prev-period 过薄返回 null → NaN。
    // 支付/退款可加、退款率是比值，商品级汇总与店铺级基本一致；买家数不可加故不展示。
    const sumDay = (D) => {
      let pay=0, ref=0
      for (const p of Object.values(RAW.products || {})) {
        const i = (p.dates||[]).indexOf(D); if (i<0) continue
        pay += +p.pay?.[i]||0; ref += +p.refund?.[i]||0
      }
      return { pay, ref }
    }
    const computeKpi = () => {
      const D = anomalyDate.value, W = shiftDays(D, -7)
      const c = sumDay(D), w = sumDay(W)
      const pct = (a,b) => (!b) ? null : (a-b)/b*100
      const rr  = c.pay ? c.ref/c.pay*100 : null
      const wrr = w.pay ? w.ref/w.pay*100 : null
      kpi.value = [
        { n:'支付金额', v:c.pay, ch:pct(c.pay,w.pay), money:true, good:(pct(c.pay,w.pay)||0)>=0 },
        { n:'退款金额', v:c.ref, ch:pct(c.ref,w.ref), money:true, good:(pct(c.ref,w.ref)||0)<0 },
        { n:'全店退款率', v:rr, ch:(rr!=null&&wrr!=null)?rr-wrr:null, rate:true, good:(rr!=null&&wrr!=null)?rr<=wrr:true },
        { n:'今日异常', v:cards.value.length, count:true, sub:'共 '+cards.value.length+' 条 · 需处理' },
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
      try { compute(); computeKpi(); await loadTasks() }
      catch (e) { console.error('[anomaly]', e); showToast('计算异常出错：' + (e && e.message || e)) }
      finally { loading.value = false }
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
    const redCount = computed(() => cards.value.filter(c => c.light==='red').length)
    const yellowCount = computed(() => cards.value.filter(c => c.light==='yellow').length)
    const sevCounts = computed(() => { const m={L1:0,L2:0,L3:0,L4:0}; for (const c of cards.value) m[c.sev]=(m[c.sev]||0)+1; return m })
    const groups = computed(() => ORDER.map(s => ({ sev:s, label:SEV[s].label, color:SEV[s].color, desc:SEV[s].desc, rows: visibleCards.value.filter(c => c.sev===s) })).filter(g => g.rows.length))
    const pendingCount = computed(() => visibleCards.value.filter(c => !existingRef(c)).length)
    const addAllVisible = async () => {
      const chosen = visibleCards.value.filter(c => !existingRef(c))
      if (!chosen.length) { showToast('当前这些都已有任务，无需新建'); return }
      let ok = 0
      for (const c of chosen) { try { await postTask(buildTask(c)); ok++ } catch {} }
      await loadTasks(); showToast(`已批量新建 ${ok} 个任务`)
    }

    const fmtKpi = k => k.v==null ? '—' : (k.rate ? k.v.toFixed(1)+'%' : (k.money ? yuan(k.v) : Math.round(k.v).toLocaleString()))
    const fmtCh  = k => k.ch==null ? '—' : (k.ch>=0?'+':'') + k.ch.toFixed(1) + (k.rate?'pct':'%')

    // ── 主 Tab（数据指标 / 客服）+ AI 接入（复用「设置 → AI 配置」）──
    const mainTab   = ref('data')
    const aiResult  = ref(''); const aiLoading = ref(false); const aiError = ref('')
    const csText    = ref(''); const csFileName = ref('')
    const csResult  = ref(''); const csLoading = ref(false); const csError = ref('')
    const _getAiCfg = () => {
      try { const d = JSON.parse(localStorage.getItem('hay_ai_presets_v2') || 'null')
        if (d && Array.isArray(d.presets)) return d.presets.find(p => p.id === d.activeId) || d.presets[0] || null } catch(e) {}
      try { const l = JSON.parse(localStorage.getItem('hay_ai_settings_v1') || 'null'); if (l && l.apiKey) return l } catch(e) {}
      return null
    }
    const _callAI = async (systemPrompt, userText) => {
      const cfg = _getAiCfg()
      if (!cfg || !cfg.apiKey) throw new Error('请先到「设置 → AI 配置」填写 API Key')
      const base = (cfg.apiBase || 'https://api.openai.com/v1').replace(/\/$/, '')
      const resp = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
        body: JSON.stringify({ model: cfg.model || 'gpt-4.1-mini', messages: [
          { role: 'system', content: systemPrompt }, { role: 'user', content: userText }], stream: false }),
      })
      if (!resp.ok) throw new Error('AI 调用失败 HTTP ' + resp.status)
      const j = await resp.json()
      return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '(AI 无返回)'
    }
    const runDataAI = async () => {
      aiError.value = ''; aiResult.value = ''; aiLoading.value = true
      try {
        const lines = cards.value.slice(0, 40).map(c =>
          `[${SEV[c.sev].label}] ${c.title} | 主因:${c.primary} | 今日成交¥${Math.round(c.cp)} 近7天日均¥${Math.round(c.base)} | 负责人:${c.owner || '-'}`).join('\n')
        const sys = '你是 HAY 家居运营分析助手。下面是当日异常预警清单（已按严重度分级）。请输出：①今天最该先处理的 3-5 个商品及理由；②按负责人汇总今天各自要做什么；③一句话风险提示。中文、简明、可执行。'
        aiResult.value = await _callAI(sys, `数据日 ${anomalyDate.value}，共 ${cards.value.length} 条异常：\n${lines}`)
      } catch(e) { aiError.value = String(e.message || e) } finally { aiLoading.value = false }
    }
    const onCsFile = (ev) => {
      const f = ev.target.files && ev.target.files[0]; if (!f) return
      csFileName.value = f.name
      const r = new FileReader(); r.onload = () => { csText.value = String(r.result || '') }; r.readAsText(f)
    }
    const runCsAI = async () => {
      csError.value = ''; csResult.value = ''
      if (!csText.value.trim()) { csError.value = '请先上传或粘贴聊天记录'; return }
      csLoading.value = true
      try {
        const sys = '你是 HAY 天猫客服质量分析助手。下面是客服聊天记录。请输出：①主要问题分类与频次；②挽单/催付话术是否到位（举例）；③高频问题对应的标准话术建议；④给客服的 3 条改进点。中文、条理清晰。'
        csResult.value = await _callAI(sys, csText.value.slice(0, 12000))
      } catch(e) { csError.value = String(e.message || e) } finally { csLoading.value = false }
    }

    return { SEV, LIGHT, ORDER, loading, kpi, cards, tab, anomalyDate, visibleCards, redCount, yellowCount, sevCounts, groups, pendingCount,
             addOne, addAllVisible, existingRef, yuan, fmtKpi, fmtCh, toast, CS, csView,
             mainTab, aiResult, aiLoading, aiError, runDataAI,
             csText, csFileName, csResult, csLoading, csError, onCsFile, runCsAI }
  },
  template: `
<div style="padding:2px 2px 60px">
  <div v-if="loading" style="padding:60px;text-align:center;color:var(--muted)">正在计算异常…</div>
  <template v-else>
    <!-- 主 Tab：数据指标 / 客服 -->
    <div style="display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--border)">
      <div @click="mainTab='data'" :style="mainTabStyle('data')">数据指标</div>
      <div @click="mainTab='cs'" :style="mainTabStyle('cs')">客服</div>
    </div>

  <div v-show="mainTab==='data'">
    <!-- AI 解读 -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <button @click="runDataAI" :disabled="aiLoading" :style="{background:aiLoading?'var(--border)':'var(--accent)',color:'#fff',border:'none',borderRadius:'8px',padding:'8px 16px',fontSize:'13px',cursor:aiLoading?'default':'pointer'}">{{ aiLoading ? 'AI 分析中…' : '🧠 AI 解读异常' }}</button>
      <span style="font-size:12px;color:var(--muted)">把当日异常清单发给 AI：今天最该处理哪些商品、各负责人分工</span>
    </div>
    <div v-if="aiError" style="margin-bottom:12px;font-size:12px;color:var(--red)">{{ aiError }}</div>
    <div v-if="aiResult" style="margin-bottom:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;font-size:13px;line-height:1.7;color:var(--text);white-space:pre-wrap">{{ aiResult }}</div>

    <!-- 大盘 KPI -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      <div v-for="k in kpi" :key="k.n" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">{{ k.n }}</div>
        <div style="font-size:23px;font-weight:700;color:var(--text)">{{ fmtKpi(k) }}</div>
        <div v-if="k.count" style="font-size:12px;margin-top:5px;color:var(--muted)">{{ k.sub }}</div>
        <div v-else :style="{fontSize:'12px',marginTop:'5px',fontWeight:600,color:k.good?'#1b7a3e':'#e5484d'}">较上周同期 {{ fmtCh(k) }}</div>
      </div>
    </div>

    <!-- 严重度筛选 -->
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px">
      <div @click="tab='ALL'" :style="chipStyle('ALL')">全部 <b style="margin-left:4px">{{ cards.length }}</b></div>
      <div v-for="s in ORDER" :key="s" @click="tab=s" :style="chipStyle(s)">
        <span :style="{display:'inline-block',width:'8px',height:'8px',borderRadius:'50%',background:SEV[s].color,marginRight:'7px'}"></span>{{ SEV[s].label }} <b style="margin-left:4px">{{ sevCounts[s] }}</b>
      </div>
      <div style="flex:1"></div>
      <div style="font-size:12px;color:var(--muted)">数据日 {{ anomalyDate }}</div>
    </div>

    <!-- 批量操作条 -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;font-size:13px">
      <button @click="addAllVisible" :disabled="!pendingCount"
              :style="{background:pendingCount?'var(--accent)':'var(--border)',color:'#fff',border:'none',borderRadius:'6px',padding:'6px 14px',cursor:pendingCount?'pointer':'default'}">
        一键给当前 {{ pendingCount }} 条加任务
      </button>
      <span style="color:var(--muted)">或逐条点卡片里的「+ 加任务」</span>
    </div>

    <!-- 按严重度分组列表 -->
    <div style="display:flex;flex-direction:column;gap:14px">
      <div v-for="g in groups" :key="g.sev" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px 6px">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:6px">
          <span :style="{width:'10px',height:'10px',borderRadius:'50%',background:g.color,display:'inline-block',flex:'none'}"></span>
          <span style="font-size:14.5px;font-weight:700;color:var(--text)">{{ g.label }}</span>
          <span :style="{fontSize:'11.5px',fontWeight:700,color:g.color,background:g.color+'1f',borderRadius:'999px',padding:'2px 9px'}">{{ g.rows.length }}</span>
          <span style="font-size:12px;color:var(--muted)">{{ g.desc }}</span>
        </div>
        <div v-for="(c,i) in g.rows" :key="c.pid"
             :style="{display:'flex',alignItems:'center',gap:'14px',padding:'11px 0',borderTop: i ? '1px solid var(--border)' : 'none'}">
          <span :style="{width:'7px',height:'7px',borderRadius:'50%',background:g.color,flex:'none'}"></span>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ c.title }}</div>
            <div style="font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              <span :style="{color:LIGHT[c.light].color,fontWeight:600,marginRight:'6px'}">{{ c.light==='red'?'今天':'本周' }}</span>{{ c.primary }}
            </div>
          </div>
          <div style="width:150px;text-align:right;flex:none">
            <div style="font-size:13px;font-weight:700;color:var(--text)">{{ yuan(c.cp) }}</div>
            <div style="font-size:11px;color:var(--muted)">日均 {{ yuan(c.base) }}</div>
          </div>
          <span style="width:128px;flex:none;font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ c.tcat }} · {{ c.owner }}</span>
          <span v-if="existingRef(c)" style="width:96px;flex:none;text-align:right;font-size:11.5px;color:#1b7a3e">{{ existingRef(c) }}</span>
          <button v-else @click="addOne(c)"
                  style="width:96px;flex:none;background:var(--accent);color:#fff;border:none;border-radius:7px;padding:6px 0;font-size:12px;cursor:pointer">+ 加任务</button>
        </div>
      </div>
    </div>
    <div v-if="!visibleCards.length" style="padding:50px;text-align:center;color:var(--muted)">本类暂无异常 🎉</div>
  </div>

  <!-- 客服 Tab -->
  <div v-show="mainTab==='cs'">
    <!-- 上传聊天记录 → AI 分析 -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px">
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:10px">客服聊天记录分析</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:8px;padding:7px 13px;font-size:12.5px;color:var(--text);cursor:pointer;background:#fff">📎 选择文件<input type="file" accept=".txt,.csv,.log,text/plain" @change="onCsFile" style="display:none"></label>
        <span style="font-size:12px;color:var(--muted)">{{ csFileName || '支持 txt / csv 聊天记录；也可直接粘贴到下方' }}</span>
        <div style="flex:1"></div>
        <button @click="runCsAI" :disabled="csLoading" :style="{background:csLoading?'var(--border)':'var(--accent)',color:'#fff',border:'none',borderRadius:'8px',padding:'8px 16px',fontSize:'13px',cursor:csLoading?'default':'pointer'}">{{ csLoading ? 'AI 分析中…' : '🧠 AI 分析' }}</button>
      </div>
      <textarea v-model="csText" placeholder="粘贴客服聊天记录（客服名 × 客户名 × 时间 × 内容）…" style="width:100%;box-sizing:border-box;margin-top:10px;min-height:120px;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:12.5px;font-family:inherit;resize:vertical"></textarea>
      <div v-if="csError" style="margin-top:8px;font-size:12px;color:var(--red)">{{ csError }}</div>
      <div v-if="csResult" style="margin-top:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.7;color:var(--text);white-space:pre-wrap">{{ csResult }}</div>
    </div>

    <!-- ── 客服异常（本周）── -->
    <div v-if="CS" style="margin-top:0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div style="font-size:15px;font-weight:600;color:var(--text)">客服异常 · {{ CS.period }}</div>
        <div style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">
          <button @click="csView='issue'" :style="{border:'none',padding:'5px 13px',fontSize:'12px',cursor:'pointer',background:csView==='issue'?'var(--accent)':'transparent',color:csView==='issue'?'#fff':'var(--muted)'}">按问题</button>
          <button @click="csView='agent'" :style="{border:'none',padding:'5px 13px',fontSize:'12px',cursor:'pointer',background:csView==='agent'?'var(--accent)':'transparent',color:csView==='agent'?'#fff':'var(--muted)'}">按客服</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
          <template v-if="csView==='issue'">
            <div v-for="i in CS.issues" :key="i.name" style="padding:7px 0;border-top:1px solid var(--border)">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="flex:1;font-size:13px;color:var(--text)">{{ i.name }}</span>
                <span style="font-size:12px;color:var(--muted)">{{ i.freq }} 例 · {{ i.trend }}</span>
              </div>
              <div style="margin-top:4px"><span v-for="a in i.agents" :key="a" style="display:inline-block;font-size:11px;color:var(--muted);background:var(--bg);border-radius:6px;padding:2px 8px;margin:2px 4px 0 0">{{ a }}</span></div>
            </div>
          </template>
          <template v-else>
            <div v-for="a in CS.agents" :key="a.name" style="padding:7px 0;border-top:1px solid var(--border)">
              <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
                <span :style="{fontSize:'13px',fontWeight:600,color:a.focus?'#e5484d':'var(--text)'}">{{ a.name }}</span>
                <span style="font-size:12px;color:var(--muted)">{{ a.perf }}</span>
              </div>
              <div style="margin-top:4px"><span v-for="t in a.issues" :key="t" style="display:inline-block;font-size:11px;color:var(--muted);background:var(--bg);border-radius:6px;padding:2px 8px;margin:2px 4px 0 0">{{ t }}</span></div>
            </div>
          </template>
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;align-items:baseline;gap:8px">
            <span style="font-size:12px;color:var(--muted)">挽单尝试率</span>
            <span style="font-size:17px;font-weight:600;color:#e5484d">{{ CS.rescue_rate.prev }}% → {{ CS.rescue_rate.cur }}%</span>
            <span style="font-size:12px;color:var(--muted)">较上期 {{ CS.rescue_rate.cur-CS.rescue_rate.prev }}pp · 目标 {{ CS.rescue_rate.target }}%</span>
          </div>
        </div>
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
          <div style="font-size:12px;color:var(--muted);margin-bottom:8px">较上期(W22) 改善 vs 恶化</div>
          <div style="font-size:12px;color:#1b7a3e;font-weight:600;margin-bottom:4px">改善</div>
          <div v-for="x in CS.vs_last.improved" :key="x" style="font-size:12px;color:var(--text);line-height:1.55">· {{ x }}</div>
          <div style="font-size:12px;color:#e5484d;font-weight:600;margin:9px 0 4px">恶化 / 回潮</div>
          <div v-for="x in CS.vs_last.worsened" :key="x" style="font-size:12px;color:var(--text);line-height:1.55">· {{ x }}</div>
        </div>
      </div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-top:14px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">数据 × 客服 关联分析（退款/成交下跌与客服问题互相印证）</div>
        <div v-for="c in CS.cross" :key="c.topic" style="display:grid;grid-template-columns:1.4fr 1.4fr 1.9fr 1.4fr;gap:10px;font-size:12px;padding:7px 0;border-top:1px solid var(--border)">
          <span style="color:var(--text);font-weight:600">{{ c.topic }}</span>
          <span style="color:var(--muted)">{{ c.data }}</span>
          <span style="color:var(--muted)">{{ c.cs }}</span>
          <span style="color:#2f6fb0">{{ c.fix }}</span>
        </div>
      </div>
    </div>
  </div>
  </template>

  <div v-if="toast" style="position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1f2933;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.2)">{{ toast }}</div>
</div>`,
  methods: {
    mainTabStyle(id) {
      const active = this.mainTab === id
      return { cursor:'pointer', padding:'8px 16px', fontSize:'14px', fontWeight: active ? '700' : '500',
               color: active ? 'var(--text)' : 'var(--muted)',
               borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent', marginBottom:'-1px' }
    },
    chipStyle(id) {
      const active = this.tab === id
      const acc = id==='ALL' ? 'var(--accent)' : (this.SEV[id] ? this.SEV[id].color : 'var(--accent)')
      return { cursor:'pointer', borderRadius:'999px', padding:'6px 13px', fontSize:'13px',
               border:'1px solid var(--border)', userSelect:'none', display:'inline-flex', alignItems:'center',
               background: active ? acc : 'var(--surface)',
               color: active ? '#fff' : 'var(--text)' }
    },
    tabStyle(id) {
      const active = this.tab === id
      const acc = id==='red' ? this.LIGHT.red.color : id==='yellow' ? this.LIGHT.yellow.color : 'var(--accent)'
      return { cursor:'pointer', borderRadius:'999px', padding:'6px 13px', fontSize:'13px',
               border:'1px solid var(--border)', userSelect:'none',
               background: active ? acc : 'var(--surface)',
               color: active ? '#fff' : 'var(--text)' }
    }
  }
})
