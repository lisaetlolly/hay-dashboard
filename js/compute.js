// ── compute.js ────────────────────────────────────────────────
// 核心数据计算函数。依赖：RAW（内联注入全局）、utils.js（filterRows/prevRange）、
// config.js（AUDIENCE_RATIO/KEYWORD_RATIO 仅作为 API 失败时的兜底常量）、
// OFFICIAL（内联全局）、PLAN_LOOKUP（内联全局）。
// 注意：PLAN_LOOKUP 初始化在 dashboard.html 内联脚本中（依赖 RAW）。

// ── 实时人群/关键词花费比例（替换硬编码 AUDIENCE_RATIO/KEYWORD_RATIO）──
// 用法：先 await fetchChannelRatios(s, e)，再调用 computeAll 等函数。
// 缓存键 = `${s}~${e}`，5 分钟内不会重复请求。
const _channelRatioCache = {}
async function fetchChannelRatios(s, e) {
  const key = `${s}~${e}`
  const now = Date.now()
  const cached = _channelRatioCache[key]
  if (cached && (now - cached.at) < 5*60*1000) return cached.value
  try {
    const res = await fetch(`/api/ads/channel-split?start=${s}&end=${e}`)
    if (!res.ok) throw new Error('http ' + res.status)
    const d = await res.json()
    if (d && d.audience_pct != null && d.total > 0) {
      const ratios = {
        audience: d.audience_pct / 100,
        keyword:  d.keyword_pct / 100,
        audience_spend: d.audience_spend,
        keyword_spend:  d.keyword_spend,
        plan_audience_pct: d.plan_audience_pct,
        plan_keyword_pct:  d.plan_keyword_pct,
        source: 'api'
      }
      _channelRatioCache[key] = { at: now, value: ratios }
      window.AUDIENCE_RATIO_LIVE = ratios.audience
      window.KEYWORD_RATIO_LIVE  = ratios.keyword
      return ratios
    }
  } catch (e) { /* fall through to hardcoded fallback */ }
  // Fallback：用 config.js 的硬编码 ratio
  return {
    audience: AUDIENCE_RATIO, keyword: KEYWORD_RATIO,
    audience_spend: null, keyword_spend: null,
    plan_audience_pct: 73.1, plan_keyword_pct: 26.9,
    source: 'fallback'
  }
}
function currentAudienceRatio() {
  return (typeof window !== 'undefined' && window.AUDIENCE_RATIO_LIVE != null)
    ? window.AUDIENCE_RATIO_LIVE : AUDIENCE_RATIO
}
function currentKeywordRatio() {
  return (typeof window !== 'undefined' && window.KEYWORD_RATIO_LIVE != null)
    ? window.KEYWORD_RATIO_LIVE : KEYWORD_RATIO
}

function computeKPI(s, e) {
  let pay=0, vis=0, cart=0, ctr_sum=0, ctr_n=0, fav_cart=0
  for (const r of filterRows(RAW.syzt || [], s, e)) {
    pay += r.pay; vis += r.vis; cart += r.cart
  }
  for (const r of filterRows(RAW.wxst || [], s, e)) {
    if (r.imps > 0) { ctr_sum += r.ctr; ctr_n++ }
  }
  for (const p of Object.values(RAW.products || {})) {
    for (let i=0;i<p.dates.length;i++) {
      if (p.dates[i]>=s && p.dates[i]<=e) {
        fav_cart += (p.collect?.[i]||0) + (p.cart?.[i]||0)
      }
    }
  }
  return {
    pay, vis, cart, fav_cart: Math.round(fav_cart),
    cart_rate: vis > 0 ? cart / vis * 100 : null,
    ctr: ctr_n > 0 ? ctr_sum / ctr_n * 100 : null,
  }
}

// 需要合并的后缀标记
const RELATED_SUFFIX_RE = /（关联\d*）|（非主链）|（旧）/

// 从所有已知商品（RAW.products + RAW.short_names）建立 baseName → mainPid 映射
// 这样即使主链本期无数据，关联商品也能找到主链并合并
function buildGlobalNameToMain() {
  const nameToMain = {}
  const prods = RAW.products || {}
  const shortNames = RAW.short_names || {}
  // 先遍历所有 products
  for (const pid in prods) {
    const name = (prods[pid].name || '').trim()
    if (name && !RELATED_SUFFIX_RE.test(name)) nameToMain[name] = pid
  }
  // 再补充 short_names（不覆盖 products 里已有的）
  for (const pid in shortNames) {
    const name = (shortNames[pid] || '').trim()
    if (name && !RELATED_SUFFIX_RE.test(name) && !(name in nameToMain)) nameToMain[name] = pid
  }
  return nameToMain
}

// 将"（关联）""（关联2）""（非主链）""（旧）"等 PID 的值合并到同名主链 PID 上
// 注意：（多色）不合并——颜色变体属于独立商品
// RAW.pid_merges 为显式合并表，处理自动名称匹配失败的情况（如 Revolver Stool）
function mergeRelatedPids(pidMap) {
  const nameToMain = buildGlobalNameToMain()
  const snapshot = { ...pidMap }
  for (const pid in snapshot) {
    // 1. 优先检查显式合并表
    const explicitMain = RAW.pid_merges?.[pid]
    if (explicitMain && explicitMain !== pid) {
      pidMap[explicitMain] = (pidMap[explicitMain] || 0) + (pidMap[pid] || 0)
      delete pidMap[pid]
      continue
    }
    // 2. 自动按名称后缀合并
    const name = (RAW.products?.[pid]?.name || RAW.short_names?.[pid] || '').trim()
    if (!RELATED_SUFFIX_RE.test(name)) continue
    const baseName = name.replace(RELATED_SUFFIX_RE, '').trim()
    const mainPid = nameToMain[baseName]
    if (mainPid && mainPid !== pid) {
      pidMap[mainPid] = (pidMap[mainPid] || 0) + (pidMap[pid] || 0)
      delete pidMap[pid]
    }
  }
  return pidMap
}

function computeRanking(s, e, metric, officialOnly) {
  const prev = prevRange(s, e)
  let curMap = {}, prvMap = {}

  if (metric === 'ctr') {
    const sumC={}, cntC={}, sumP={}, cntP={}
    for (const r of filterRows(RAW.wxst || [], s, e)) {
      if (r.imps > 0) { sumC[r.pid]=(sumC[r.pid]||0)+r.ctr; cntC[r.pid]=(cntC[r.pid]||0)+1 }
    }
    for (const r of filterRows(RAW.wxst || [], prev.s, prev.e)) {
      if (r.imps > 0) { sumP[r.pid]=(sumP[r.pid]||0)+r.ctr; cntP[r.pid]=(cntP[r.pid]||0)+1 }
    }
    for (const pid in sumC) curMap[pid] = sumC[pid]/cntC[pid]*100
    for (const pid in sumP) prvMap[pid] = sumP[pid]/cntP[pid]*100
  } else {
    const field = metric === 'gmv' ? 'pay' : 'vis'
    for (const r of filterRows(RAW.syzt || [], s, e))
      curMap[r.pid] = (curMap[r.pid] || 0) + r[field]
    for (const r of filterRows(RAW.syzt || [], prev.s, prev.e))
      prvMap[r.pid] = (prvMap[r.pid] || 0) + r[field]
  }

  // 合并关联/非主链 PID 到主链
  mergeRelatedPids(curMap)
  mergeRelatedPids(prvMap)

  const pct = (a, b) => b > 0 ? +((a-b)/b*100).toFixed(1) : null
  const f2 = n => +n.toFixed(2)

  // prev rank (all products)
  const prvSorted = Object.entries(prvMap).sort((a,b)=>b[1]-a[1])
  const prvRank = {}
  prvSorted.forEach(([pid],i) => prvRank[pid] = i+1)

  // cur: official first (top 25 only), then non-official marked with *
  const curAll = Object.entries(curMap).sort((a,b)=>b[1]-a[1])
  const curOfficial = curAll.filter(([pid]) => OFFICIAL.has(pid))
  const curExtra    = curAll.filter(([pid]) => !OFFICIAL.has(pid))
  const curSorted   = officialOnly ? curOfficial : [...curOfficial, ...curExtra]

  const mx = curSorted[0]?.[1] || 1
  const curList = curSorted.slice(0, 10).map(([pid,v], i) => ({
    rank: i+1, spu_id: pid,
    title: RAW.products?.[pid]?.name || RAW.short_names?.[pid] || pid,
    category_l1: RAW.cat_map?.[pid] || '',
    value: f2(v), prev_value: f2(prvMap[pid]||0),
    change_pct: pct(v, prvMap[pid]||0),
    bar_pct: +((v/mx)*100).toFixed(1),
    prev_rank: prvRank[pid] || null,
    unofficial: !OFFICIAL.has(pid),
  }))

  // prev top10 (official only for display, mark extras)
  const prvOfficial = prvSorted.filter(([pid]) => OFFICIAL.has(pid)).slice(0,10)
  const prvList = prvOfficial.map(([pid,v],i) => ({
    rank: i+1, spu_id: pid,
    title: RAW.products?.[pid]?.name || RAW.short_names?.[pid] || pid,
    value: f2(v), unofficial: false,
  }))

  return { cur: curList, prv: prvList }
}

function computePlan() {
  const s = RAW.launch_date
  const e = RAW.data_end
  const catSpend = { 家具:0, 配饰:0, 灯具:0, 其他:0 }
  // 口径固定为：4/8 上线至今，商品报表投放花费占比
  if (RAW.pid_daily_spend) {
    for (const [pid, dailyMap] of Object.entries(RAW.pid_daily_spend)) {
      let spend = 0
      for (const [d, v] of Object.entries(dailyMap)) {
        if (d >= s && d <= e) spend += (v.spend || 0)
      }
      const cat = RAW.cat_map?.[pid] || '其他'
      catSpend[cat] = (catSpend[cat] || 0) + spend
    }
  } else {
  for (const r of filterRows(RAW.wxst || [], s, e)) {
    const cat = RAW.cat_map?.[r.pid] || '其他'
      catSpend[cat] = (catSpend[cat] || 0) + (r.spend || 0)
    }
  }
  const total = Object.values(catSpend).reduce((a,b)=>a+b,0) || 1
  const items = ['家具','配饰','灯具','其他'].map(cat => {
    const actual = catSpend[cat]||0
    const ap = +((actual/total)*100).toFixed(1)
    const pp = RAW.plan_pct?.[cat] || 0
    const diff = +((ap-pp).toFixed(1))
    return {
      category:cat, plan_pct:pp, actual_pct:ap,
      actual_spend:+actual.toFixed(2),
      daily_budget: RAW.daily_budget?.[cat] || 0,
      diff, status:Math.abs(diff)>=10?'danger':Math.abs(diff)>=5?'warning':'normal',
      details: (RAW.plan_detail || []).filter(d=>d.category===cat),
      _open:false,
    }
  })
  return { total_actual:+total.toFixed(2), items, range_label:`${s} ~ ${e}`, source_label:'商品报表口径（上线至今）' }
}

function computeAll(s, e) {
  const prev = prevRange(s, e)
  const cur = computeKPI(s, e)
  const prv = computeKPI(prev.s, prev.e)
  const pct = (a,b) => b>0 ? +((a-b)/b*100).toFixed(1) : null
  return {
    kpi: {
      pay_amount: {value:+cur.pay.toFixed(2), prev:+prv.pay.toFixed(2), change_pct:pct(cur.pay,prv.pay)},
      visitors:   {value:Math.round(cur.vis), prev:Math.round(prv.vis), change_pct:pct(cur.vis,prv.vis)},
      cart_rate:  {value:cur.cart_rate?+cur.cart_rate.toFixed(2):null, prev:prv.cart_rate?+prv.cart_rate.toFixed(2):null, change_pct:pct(cur.cart_rate||0,prv.cart_rate||0)},
      fav_cart:   {value:cur.fav_cart, prev:prv.fav_cart, change_pct:pct(cur.fav_cart||0,prv.fav_cart||0)},
      ctr:        {value:cur.ctr?+cur.ctr.toFixed(2):null, prev:prv.ctr?+prv.ctr.toFixed(2):null, change_pct:pct(cur.ctr||0,prv.ctr||0)},
    },
    plan: computePlan(),
    ranking: (metric, off=true) => computeRanking(s, e, metric, off),
    meetings: RAW.meetings,
    loaded_at: RAW.loaded_at,
    prev: {s: prev.s, e: prev.e},
  }
}

function buildPlanLookup() {
  const lookup = {}  // product pid → plan_pct
  const planEntries = RAW.plan_detail || []
  for (const p of Object.values(RAW.products || {})) {
    const pname = (p.name || '').toLowerCase()
    let best = null, bestLen = 0
    for (const entry of planEntries) {
      if ((entry.category || '') !== (p.cat || '')) continue
      const ename = (entry.name || '').toLowerCase()
      // Check if any significant word in plan name appears in product name
      const words = ename.replace(/[（(）)／/·\s]+/g, ' ').split(' ').filter(w => w.length >= 2)
      const matchLen = words.filter(w => pname.includes(w)).length
      if (matchLen > bestLen) { bestLen = matchLen; best = entry }
    }
    if (best && bestLen > 0) lookup[p.pid] = best.plan_pct || 0
  }
  return lookup
}
// const PLAN_LOOKUP = buildPlanLookup() ← 在 dashboard.html 内联脚本中初始化（依赖 RAW）

const _emptyCatTable = { audienceRows:[], keywordRows:[], audienceTotal:0, keywordTotal:0, grandTotal:0 }
function computeChannelCatTable(s, e) {
  try { return _computeChannelCatTable(s, e) } catch(err) { console.error('[computeChannelCatTable]', err); return _emptyCatTable }
}
function _computeChannelCatTable(s, e) {
  // 1. Accumulate per-product spend in range, then merge related PIDs
  const rawSpend = {}
  for (const p of Object.values(RAW.products || {})) {
    let sp = 0
    for (let i = 0; i < p.dates.length; i++) {
      if (p.dates[i] >= s && p.dates[i] <= e) sp += p.spend?.[i] || 0
    }
    if (sp > 0) rawSpend[p.pid] = sp
  }
  // 合并关联/非主链/旧 → 先查显式合并表，再按名称后缀自动合并
  const nameToMain = buildGlobalNameToMain()
  for (const pid in { ...rawSpend }) {
    const explicitMain = RAW.pid_merges?.[pid]
    if (explicitMain && explicitMain !== pid) {
      rawSpend[explicitMain] = (rawSpend[explicitMain] || 0) + rawSpend[pid]
      delete rawSpend[pid]
      continue
    }
    const name = (RAW.products?.[pid]?.name || '').trim()
    if (!RELATED_SUFFIX_RE.test(name)) continue
    const baseName = name.replace(RELATED_SUFFIX_RE, '').trim()
    const mainPid = nameToMain[baseName]
    if (mainPid && mainPid !== pid) {
      rawSpend[mainPid] = (rawSpend[mainPid] || 0) + rawSpend[pid]
      delete rawSpend[pid]
    }
  }
  const pidSpend = {}
  const prodMap = RAW.products || {}
  for (const pid in rawSpend) {
    const p = prodMap[pid]
    if (!p) continue
    pidSpend[pid] = { pid, name: p.name, cat: p.cat, spend: +rawSpend[pid].toFixed(2), plan_pct: (typeof PLAN_LOOKUP !== "undefined" ? PLAN_LOOKUP[pid] : 0) || 0 }
  }
  const pidList = Object.values(pidSpend).sort((a, b) => b.spend - a.spend)

  // 2. Group by category
  const catOrder = ['家具', '配饰', '灯具', '其他']
  const catTotals = {}
  for (const row of pidList) {
    const cat = row.cat || '其他'
    catTotals[cat] = (catTotals[cat] || 0) + row.spend
  }
  const grandTotal = Object.values(catTotals).reduce((a, b) => a + b, 0) || 1

  // 3. Audience table: plan_pct from plan_detail (summed per category), actual from product spend
  const audienceRows = catOrder.map(cat => {
    const actual = catTotals[cat] || 0
    const actual_pct = +((actual / grandTotal) * 100).toFixed(1)
    const plan_pct = RAW.plan_pct?.[cat] || 0
    const diff = +(actual_pct - plan_pct).toFixed(1)
    const products = pidList.filter(p => (p.cat || '其他') === cat)
    return Vue.reactive({
      category: cat,
      plan_pct,
      actual_pct,
      actual_spend: +actual.toFixed(2),
      diff,
      status: Math.abs(diff) >= 10 ? 'danger' : Math.abs(diff) >= 5 ? 'warning' : 'normal',
      products,
      _open: false,
    })
  })

  // 4. Keyword table: same category grouping, no plan, just actual spend scaled by keyword ratio
  // 优先用 /api/ads/channel-split 返回的实时比例，失败回退到 config.js 硬编码常量
  const audRatio = currentAudienceRatio()
  const kwRatio  = currentKeywordRatio()
  const kwGrand  = grandTotal * kwRatio
  const audGrand = grandTotal * audRatio
  const keywordRows = catOrder.map(cat => {
    const audActual = catTotals[cat] || 0
    const kwActual = +(audActual * kwRatio / audRatio).toFixed(2)
    const kwPct = kwGrand > 0 ? +((kwActual / kwGrand) * 100).toFixed(1) : 0
    const products = pidList.filter(p => (p.cat || '其他') === cat).map(p => ({
      ...p,
      kw_spend: +(p.spend * kwRatio / audRatio).toFixed(2),
    }))
    return Vue.reactive({
      category: cat,
      actual_pct: kwPct,
      actual_spend: kwActual,
      products,
      _open: false,
    })
  })

  // sanity check
  audienceRows.forEach((r,i) => { if(!r || r.products===undefined) console.error('audienceRows['+i+'] bad:', r) })
  keywordRows.forEach((r,i) => { if(!r || r.products===undefined) console.error('keywordRows['+i+'] bad:', r) })
  return {
    audienceRows,
    keywordRows,
    audienceTotal: +audGrand.toFixed(2),
    keywordTotal: +kwGrand.toFixed(2),
    grandTotal: +grandTotal.toFixed(2),
  }
}
