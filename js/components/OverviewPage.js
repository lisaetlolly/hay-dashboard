// ── OverviewPage.js ──────────────────────────────────────────
// 总览页组件。依赖：api.js / compute.js / utils.js / InteractiveTrendChart（全局）。

const OverviewPage = defineComponent({
  name: 'OverviewPage',
  components: { InteractiveTrendChart },
  props: ['start', 'end'],
  setup(props) {
    const kpi       = ref({})
    const planData  = ref({ items:[], total_actual:0 })
    const tasks     = ref([])
    const meetings  = ref([])
    const rankMetric   = ref('gmv')
    const rankCategory = ref('全部')   // 新增：分类筛选（全部 / 配饰 / 家具 / 灯具）
    const rankData     = ref({ items:[] })
    const channelCatData = ref({ audienceRows:[], keywordRows:[], audienceTotal:0, keywordTotal:0, grandTotal:0 })
    const rankLoading  = ref(false)
    const prevTopData  = ref([])
    const prevPeriod   = ref({ s:'', e:'' })

    const kpiDefs = [
      { key: 'pay_amount', label: '总销售额',     tip: '生意参谋 > 商品报表 > pay_amount（支付金额）字段汇总' },
      { key: 'cart_rate',  label: '加购率',       tip: '生意参谋 > cart_users ÷ visitors × 100%，反映加购转化能力' },
      { key: 'fav_cart',   label: '总收藏加购数', tip: '商品报表 collect（收藏数）+ cart（加购数）汇总，反映用户兴趣深度' },
      { key: 'visitors',   label: '进店 UV',      tip: '生意参谋 > 商品报表 > visitors（访客数）字段汇总' },
    ]
    const rankDefs = [
      { k: 'gmv', l: 'GMV' }, { k: 'visitors', l: '流量' }
    ]

    const fmtWan = n => {
      if (n == null) return '—'
      const v = Number(n)
      if (v >= 10000) return (v/10000).toFixed(1) + '万'
      if (v >= 1000)  return v.toFixed(0)
      return v.toFixed(0)
    }
    // 优先用设置页改过的图片链接覆盖；没覆盖再用 RAW.img_map
    const imgSrc = pid => (APP_STATE.value.imageOverrides || {})[pid] || RAW.img_map?.[pid] || ''
    const kpiVal = key => {
      const k = kpi.value[key]
      if (!k) return '—'
      if (key === 'pay_amount') return '¥' + fmtWan(k.value)
      if (key === 'visitors')   return fmtWan(k.value) + ' UV'
      if (key === 'fav_cart')   return k.value != null ? Number(k.value).toLocaleString() : '—'
      if (key === 'cart_rate' || key === 'ctr')
        return k.value != null ? Number(k.value).toFixed(2) + '%' : '—'
      return k.value ?? '—'
    }
    const kpiChg  = key => kpi.value[key]?.change_pct ?? null
    const barW    = p => Math.min(100, Math.max(0, p || 0)) + '%'
    const rankFmt = v => {
      if (v == null) return '—'
      if (rankMetric.value === 'gmv') return '¥' + (Number(v)/10000).toFixed(1) + '万'
      return Number(v) >= 10000 ? (Number(v)/10000).toFixed(1) + '万UV' : Number(v).toFixed(0) + 'UV'
    }
    const dotColor = s => s === '已完成' ? '#16a34a' : s === '进行中' ? '#d97706' : '#a1a1aa'
    const statusLabel = s => ({ normal:'正常', warning:'关注', danger:'需调整' })[s] || s
    const totalActualWan = computed(() => {
      const v = planData.value.total_actual || 0
      return v >= 10000 ? (v/10000).toFixed(1) + '万' : v.toFixed(0)
    })

    // 在 [s, e] 范围内计算指定 spu 的 metric value（不限 top10，用于环比兜底）
    const localValueByPid = (metric, s, e, cat) => {
      const out = {}
      for (const p of Object.values(RAW.products)) {
        if (cat !== '全部' && p.cat !== cat) continue
        let gmv = 0, vis = 0
        for (let i = 0; i < p.dates.length; i++) {
          const d = p.dates[i]
          if (d >= s && d <= e) {
            gmv += p.pay[i] || 0
            vis += p.vis[i] || 0
          }
        }
        out[p.pid] = metric === 'gmv' ? gmv : vis
      }
      return out
    }

    // 在 [s, e] 范围内计算每个商品的 metric value，按 value 降序返回 top10
    const localRankInRange = (metric, s, e, cat) => {
      return Object.values(RAW.products)
        .filter(p => cat === '全部' || p.cat === cat)
        .map(p => {
          let gmv=0, vis=0
          for (let i=0;i<p.dates.length;i++) {
            const d=p.dates[i]
            if (d>=s && d<=e) {
              gmv += p.pay[i]||0
              vis += p.vis[i]||0
            }
          }
          return {
            spu_id:p.pid,
            title:p.name,
            category_l1: p.cat,
            value: metric==='gmv' ? gmv : vis,
          }
        }).filter(r => r.value != null && r.value > 0)
        .sort((a,b)=>(b.value||0)-(a.value||0))
        .slice(0,10)
        .map((r,i)=>({ ...r, rank:i+1 }))
    }
    const localRank = (metric, s, e, cat) => {
      const items = localRankInRange(metric, s, e, cat)
      // 上期 = 等长前移
      const subD = (ds, n) => { const d = new Date(ds); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10) }
      const days = Math.max(1, Math.round((new Date(e) - new Date(s)) / 86400000) + 1)
      const ps = subD(s, days), pe = subD(s, 1)
      const prev_top = localRankInRange(metric, ps, pe, cat)
      return { items, prev_top }
    }

    const loadRank = async () => {
      rankLoading.value = true
      const s = props.start, e = props.end
      if (!s || !e) { rankLoading.value = false; return }
      const params = { metric: rankMetric.value, start: s, end: e }
      if (rankCategory.value !== '全部') params.category = rankCategory.value
      const d = await api('/api/overview/ranking', params)
      // API 返回不足时本地兜底（含上期）
      const valid = d && Array.isArray(d.items) && d.items.length > 0
        ? d
        : localRank(rankMetric.value, s, e, rankCategory.value)
      rankData.value = valid || { items: [] }
      // 上期 prev_top 三层兜底：
      //   1) API 返回非空 + 至少有一项 value > 0 → 用 API
      //   2) 否则用 RAW.products 本地算
      //   3) 本地也算不出 → 把上期当作"当期"再请求一次 API（彻底绕开 SQL 上期口径 bug）
      const apiPrev = (valid && Array.isArray(valid.prev_top)) ? valid.prev_top : []
      const apiPrevHasValue = apiPrev.some(r => (r.value || 0) > 0)
      if (apiPrevHasValue) {
        prevTopData.value = apiPrev
      } else {
        const fallbackPrev = localRank(rankMetric.value, s, e, rankCategory.value).prev_top
        if (fallbackPrev && fallbackPrev.length && fallbackPrev.some(r => (r.value || 0) > 0)) {
          prevTopData.value = fallbackPrev
        } else if (valid && valid.prev_period && valid.prev_period.start && valid.prev_period.end) {
          // 第三层兜底：用上期日期再请求一次 ranking API（当期=上期），把 items 当成上期 top
          try {
            const prevParams = { metric: rankMetric.value, start: valid.prev_period.start, end: valid.prev_period.end }
            if (rankCategory.value !== '全部') prevParams.category = rankCategory.value
            const d2 = await api('/api/overview/ranking', prevParams)
            if (d2 && Array.isArray(d2.items) && d2.items.length) {
              prevTopData.value = d2.items.map(r => ({
                rank: r.rank, spu_id: r.spu_id, title: r.title,
                category_l1: r.category_l1, value: r.value,
              }))
            } else {
              prevTopData.value = apiPrev || []
            }
          } catch {
            prevTopData.value = apiPrev || []
          }
        } else {
          prevTopData.value = apiPrev || []
        }
      }
      // 第四层兜底：如果 items[i].change_pct 全部为 null/undefined，
      //            就用 prev_top（前面已经填好）按 spu_id 查表计算环比
      const items = (rankData.value.items || [])
      const allNullChange = items.length > 0 && items.every(r => r.change_pct == null)
      if (allNullChange) {
        // 用所有商品的本地前期值（不限 top10），按 spu_id 查表
        const subD = (ds, n) => { const d = new Date(ds); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10) }
        const days = Math.max(1, Math.round((new Date(e) - new Date(s)) / 86400000) + 1)
        const ps = subD(s, days), pe = subD(s, 1)
        const prevValByPid = (rankMetric.value === 'gmv' || rankMetric.value === 'visitors')
          ? localValueByPid(rankMetric.value, ps, pe, rankCategory.value)
          : {}
        // CTR 兜底：从 RAW.products 里抓 ctr 平均（如果有）
        // 优先合并 prev_top（如果有）再用本地 RAW
        if (prevTopData.value && prevTopData.value.length) {
          for (const p of prevTopData.value) {
            if (prevValByPid[p.spu_id] == null) prevValByPid[p.spu_id] = p.value || 0
          }
        }
        for (const r of items) {
          const pv = prevValByPid[r.spu_id]
          if (pv != null && pv > 0) {
            r.change_pct = +(((r.value||0) - pv) / pv * 100).toFixed(1)
            r.prev_value = pv
          }
        }
      }
      rankLoading.value = false
    }
    // 切换分类时立即重载
    Vue.watch(rankCategory, () => loadRank())
    const load = async () => {
      const s = props.start, e = props.end
      if (!s || !e) return
      // 先预热实时人群/关键词比例，再算所有派生指标
      try { await fetchChannelRatios(s, e) } catch {}
      const all = computeAll(s, e)
      const subD = (ds, n) => { const d = new Date(ds); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10) }
      const prev = s === e ? { s: subD(s,1), e: subD(e,1) } : prevRange(s, e)
      prevPeriod.value = prev
      // KPI 优先调真后端 /api/overview/kpi (店铺级 fact_shop_overview)
      // 不再用 computeAll().kpi 那个 25 主链商品级累加结果
      try {
        const realKpi = await fetch('/api/overview/kpi?start=' + s + '&end=' + e).then(r => r.json())
        kpi.value = realKpi
      } catch {
        kpi.value = all.kpi  // fallback
      }
      planData.value = all.plan
      meetings.value = all.meetings.slice(0, 6)
      channelCatData.value = computeChannelCatTable(s, e)
      loadRank()
    }

    watch([() => props.start, () => props.end], load, { immediate: true })
    watch(rankMetric, loadRank)

    const prevTopList = computed(() => prevTopData.value)

    const selectedOverviewMetrics = ref(['gmv', 'cart_collect'])
    const overviewMetricOpts = [
      { key: 'gmv',          name: '销售额',     color: '#a78bfa', type: 'bar',  fmt: v => v>=10000 ? '¥'+(v/10000).toFixed(1)+'万' : '¥'+Math.round(v) },
      { key: 'visitors',     name: 'UV',         color: '#60a5fa', type: 'bar',  fmt: v => Math.round(v).toLocaleString() },
      { key: 'cart_collect', name: '收藏加购数', color: '#34d399', type: 'line', fmt: v => Math.round(v).toLocaleString() },
      { key: 'cart_rate',    name: '加购率',     color: '#f59e0b', type: 'line', fmt: v => v!=null ? v.toFixed(2)+'%' : '—' },
    ]
    const trendGranularity = computed(() => {
      const g = props.granularity
      if (g === 'week') return 'week'
      if (g === 'month') return 'month'
      return 'day'
    })
    const getWeekKey = d => {
      const dt = new Date(d)
      const jan1 = new Date(dt.getFullYear(), 0, 1)
      const wk = Math.ceil(((dt - jan1) / 86400000 + jan1.getDay() + 1) / 7)
      return dt.getFullYear() + '-W' + String(wk).padStart(2, '0')
    }
    const getMonthKey = d => d.slice(0, 7)
    const trendSeries = computed(() => {
      const s = props.start, e = props.end
      if (!s || !e) return []
      const gran = trendGranularity.value
      const dayMap = {}
      for (const p of Object.values(RAW.products)) {
        for (let i=0;i<p.dates.length;i++) {
          const d = p.dates[i]
          if (d<s || d>e) continue
          const key = gran === 'week' ? getWeekKey(d) : gran === 'month' ? getMonthKey(d) : d
          if (!dayMap[key]) dayMap[key] = {pay:0, vis:0, cart:0, collect:0, days:0}
          dayMap[key].pay += p.pay[i]||0
          dayMap[key].vis += p.vis[i]||0
          dayMap[key].cart += p.cart[i]||0
          dayMap[key].collect += p.collect?.[i]||0
          dayMap[key].days++
        }
      }
      const keys = Object.keys(dayMap).sort()
      const trendLabel = gran === 'week' ? '周' : gran === 'month' ? '月' : '日'
      return selectedOverviewMetrics.value.map(key => {
        const opt = overviewMetricOpts.find(o=>o.key===key)
        if (!opt) return null
        return {
          key, name: opt.name + '（' + trendLabel + '）', color: opt.color, type: opt.type,
          values: keys.map(k => {
            const r = dayMap[k]
            let v = null
            if (key==='gmv') v = r.pay
            else if (key==='visitors') v = r.vis
            else if (key==='cart_collect') v = r.cart + r.collect
            else if (key==='cart_rate') v = r.vis>0 ? +(r.cart/r.vis*100).toFixed(2) : null
            return { d: k, value: v, label: opt.fmt(v) }
          })
        }
      }).filter(Boolean)
    })

    // ══════════════════════════════════════════════════════════════════
    // 618 加购看板 — 5/1-5/12 累计同比（YoY）
    // - 全店去重累计：sycm 后台 UI 数字，由用户手填，存 addtocart_618_manual
    // - 三大品类（家具/配饰/灯具）日累计：xls 直读 + cat_map 汇总（跨日不去重）
    // ══════════════════════════════════════════════════════════════════
    const ADD_DAYS = [1,2,3,4,5,6,7,8,9,10,11,12]
    const ADD_CATS = ['家具', '配饰', '灯具']  // 其他不画线，但参与 KPI 合计
    const ADD_CAT_COLOR = { '家具': '#6366f1', '配饰': '#ec4899', '灯具': '#f59e0b' }
    const addCategorySeries = ref(null)        // /api/618/category-cumulative 返回值（含 .store）
    const addLoading = ref(false)
    const addSelectedN = ref(null)             // 选 5/1-5/N 累计中的 N，默认=今年最后有数据那天

    const addLoadAll = async () => {
      addLoading.value = true
      try {
        const cat = await fetch('/api/618/category-cumulative').then(r => r.json())
        addCategorySeries.value = cat
        // 默认 N = 今年最大有数据日（cumsum_naive 里最后一天）
        const tDays = Object.keys((cat && cat.store && cat.store.this_year && cat.store.this_year.cumsum_naive) || {})
          .map(s => parseInt(s.slice(8,10), 10)).sort((a,b)=>a-b)
        addSelectedN.value = tDays.length ? tDays[tDays.length-1] : 1
      } catch (e) {
        console.warn('[618] load failed', e)
      }
      addLoading.value = false
    }
    addLoadAll()

    // 取某年 5/1-N 的全店累计加购：优先 sycm 真去重，没有就 fallback 到日值求和
    // 返回 { value, source: 'dedup'|'sum'|null }
    const pickStoreCum = (year, day) => {
      const cs = addCategorySeries.value
      if (!cs || !cs.store) return { value: null, source: null }
      const tag = year === 2026 ? 'this_year' : 'last_year'
      const yr = cs.store[tag] || {}
      const ds = `${year}-05-${String(day).padStart(2,'0')}`
      if (yr.cumsum_dedup && yr.cumsum_dedup[ds] != null) {
        return { value: yr.cumsum_dedup[ds], source: 'dedup' }
      }
      if (yr.cumsum_naive && yr.cumsum_naive[ds] != null) {
        return { value: yr.cumsum_naive[ds], source: 'sum' }
      }
      return { value: null, source: null }
    }

    const fmtNum = n => n == null ? '—' : Number(n).toLocaleString()
    const yoyPct = (cur, prev) => {
      if (cur == null || prev == null || prev === 0) return null
      return +(((cur - prev) / prev) * 100).toFixed(1)
    }

    // KPI 数据：全店累计加购人数（优先 sycm 真去重，fallback 日值求和）
    const addManualKpi = computed(() => {
      const n = addSelectedN.value
      if (!n) return { thisYr: null, lastYr: null, yoy: null, sourceThis: null, sourceLast: null }
      const t = pickStoreCum(2026, n)
      const l = pickStoreCum(2025, n)
      return {
        thisYr: t.value, lastYr: l.value,
        yoy: yoyPct(t.value, l.value),
        sourceThis: t.source, sourceLast: l.source,
      }
    })

    // 品类累计 KPI：5/1-N 三大品类合计
    const addCategoryKpi = computed(() => {
      const n = addSelectedN.value
      const cs = addCategorySeries.value
      if (!n || !cs) return { thisYr: null, lastYr: null, yoy: null, byCat: [] }
      const dThis = `2026-05-${String(n).padStart(2,'0')}`
      const dLast = `2025-05-${String(n).padStart(2,'0')}`
      const cThis = cs?.this_year?.cumsum?.[dThis] || null
      const cLast = cs?.last_year?.cumsum?.[dLast] || null
      const totalT = cThis ? (cThis['家具']+cThis['配饰']+cThis['灯具']) : null
      const totalL = cLast ? (cLast['家具']+cLast['配饰']+cLast['灯具']) : null
      const byCat = ADD_CATS.map(c => ({
        cat: c,
        thisYr: cThis ? cThis[c] : null,
        lastYr: cLast ? cLast[c] : null,
        yoy:    cThis && cLast ? yoyPct(cThis[c], cLast[c]) : null,
      }))
      return { thisYr: totalT, lastYr: totalL, yoy: yoyPct(totalT, totalL), byCat }
    })

    // SVG 折线图数据：3 品类 × 2 年 = 6 条折线（cumsum 沿 5/1-5/12）
    const addChartLines = computed(() => {
      const cs = addCategorySeries.value
      if (!cs) return []
      const lines = []
      for (const yr of [2026, 2025]) {
        const tag = yr === 2026 ? 'this_year' : 'last_year'
        const cum = cs?.[tag]?.cumsum || {}
        for (const cat of ADD_CATS) {
          const points = ADD_DAYS.map(d => {
            const ds = `${yr}-05-${String(d).padStart(2,'0')}`
            const v = cum[ds]?.[cat]
            return v == null ? null : { d, v }
          }).filter(Boolean)
          if (!points.length) continue
          lines.push({
            cat, year: yr, color: ADD_CAT_COLOR[cat],
            dashed: yr === 2025,
            label: `${cat} · ${yr}`,
            points,
          })
        }
      }
      return lines
    })

    // SVG 视图盒坐标
    const addChartGeom = computed(() => {
      const W = 720, H = 220, padL = 40, padR = 12, padT = 14, padB = 26
      const lines = addChartLines.value
      let maxV = 0
      for (const ln of lines) for (const p of ln.points) if (p.v > maxV) maxV = p.v
      maxV = Math.max(10, Math.ceil(maxV * 1.1 / 100) * 100)
      const x = d => padL + ((d - 1) / (12 - 1)) * (W - padL - padR)
      const y = v => H - padB - (v / maxV) * (H - padT - padB)
      const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(maxV * t))
      return { W, H, padL, padR, padT, padB, maxV, x, y, yTicks }
    })

    const addLinePath = (line) => {
      const g = addChartGeom.value
      return line.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${g.x(p.d).toFixed(1)} ${g.y(p.v).toFixed(1)}`).join(' ')
    }

    return {
      kpi, planData, tasks, meetings, rankMetric, rankCategory, rankData, rankLoading,
      kpiDefs, rankDefs, kpiVal, kpiChg, barW, rankFmt, fmtWan, imgSrc,
      dotColor, statusLabel, totalActualWan, prevTopList, prevPeriod, chgCls, chgTxt,
      selectedOverviewMetrics, overviewMetricOpts, trendSeries, trendGranularity,
      channelCatData,
      // 618 加购看板（数据从 /api/618/category-cumulative 来；admin 在设置页改）
      ADD_DAYS, ADD_CATS, ADD_CAT_COLOR,
      addCategorySeries, addLoading, addSelectedN,
      addManualKpi, addCategoryKpi, addChartLines, addChartGeom, addLinePath,
      fmtNum,
    }
  },
  template: `
<div style="display:flex;flex-direction:column;gap:16px">

  <!-- KPI -->
  <div class="kpi-grid">
    <div v-for="k in kpiDefs" :key="k.key" class="kpi-card">
      <div class="kpi-label">
        <span class="info-wrap">{{ k.label }}<span class="info-btn">?<span class="tooltip">{{ k.tip }}</span></span></span>
      </div>
      <div class="kpi-value">{{ kpiVal(k.key) }}</div>
      <div class="kpi-footer">
        <span :class="['chg', chgCls(kpiChg(k.key))]">{{ chgTxt(kpiChg(k.key)) }}</span>
        <span>vs 上期等长周期</span>
      </div>
    </div>
  </div>

  <!-- 618 加购看板（5/1-5/12，YoY vs 25年） -->
  <div class="card" style="padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <div>
        <span class="card-title">618 加购看板</span>
        <span class="card-sub" style="margin-left:8px">5/1-5/12 累计 · 同比 25 年</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#64748b">
        <span>累计区间：5/1 -</span>
        <select v-model.number="addSelectedN"
          style="padding:3px 8px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;font-size:12px">
          <option v-for="d in ADD_DAYS" :key="d" :value="d">5/{{ d }}</option>
        </select>
      </div>
    </div>

    <!-- 顶部 KPI 行：全店去重（手填） + 三大品类合计 -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px">
      <div class="kpi-card" style="background:#f8fafc">
        <div class="kpi-label">
          <span class="info-wrap">全店累计加购人数<span class="info-btn">?<span class="tooltip">优先用 sycm 后台 UI 上选 5/1-N 自定义区间得到的"商品加购人数"（真去重）；当天没录入就 fallback 到日值求和（跨日不去重，标"按日求和"）。25 年 5/6 与 5/12 已是真去重值。</span></span></span>
          <span v-if="addManualKpi.sourceThis==='sum'" style="color:#f59e0b;font-size:11px;margin-left:4px">按日求和</span>
          <span v-else-if="addManualKpi.sourceThis==='dedup'" style="color:#16a34a;font-size:11px;margin-left:4px">真去重</span>
        </div>
        <div class="kpi-value" style="color:#0f172a">
          {{ fmtNum(addManualKpi.thisYr) }}
        </div>
        <div class="kpi-footer">
          <span :class="['chg', addManualKpi.yoy==null?'':(addManualKpi.yoy>=0?'chg-up':'chg-dn')]">
            {{ addManualKpi.yoy==null ? '—' : (addManualKpi.yoy>=0?'+':'') + addManualKpi.yoy + '%' }}
          </span>
          <span>vs 25年同期 {{ fmtNum(addManualKpi.lastYr) }}<span v-if="addManualKpi.sourceLast==='dedup'" style="color:#16a34a;margin-left:2px">·真</span></span>
        </div>
      </div>
      <div class="kpi-card" style="background:#f8fafc">
        <div class="kpi-label">
          <span class="info-wrap">三大品类合计加购<span class="info-btn">?<span class="tooltip">家具+配饰+灯具，xls 单品按 cat_map 分类后日累计求和（跨日不去重）</span></span></span>
        </div>
        <div class="kpi-value" style="color:#0f172a">
          {{ fmtNum(addCategoryKpi.thisYr) }}
        </div>
        <div class="kpi-footer">
          <span :class="['chg', addCategoryKpi.yoy==null?'':(addCategoryKpi.yoy>=0?'chg-up':'chg-dn')]">
            {{ addCategoryKpi.yoy==null ? '—' : (addCategoryKpi.yoy>=0?'+':'') + addCategoryKpi.yoy + '%' }}
          </span>
          <span>vs 25年同期 {{ fmtNum(addCategoryKpi.lastYr) }}</span>
        </div>
      </div>
      <div v-for="c in addCategoryKpi.byCat" :key="c.cat" class="kpi-card" style="background:#fafafa">
        <div class="kpi-label">
          <span style="display:inline-block;width:8px;height:8px;border-radius:99px;margin-right:4px"
                :style="{background: ADD_CAT_COLOR[c.cat]}"></span>{{ c.cat }} 累计
        </div>
        <div class="kpi-value" style="font-size:18px">{{ fmtNum(c.thisYr) }}</div>
        <div class="kpi-footer">
          <span :class="['chg', c.yoy==null?'':(c.yoy>=0?'chg-up':'chg-dn')]">
            {{ c.yoy==null ? '—' : (c.yoy>=0?'+':'') + c.yoy + '%' }}
          </span>
          <span>{{ fmtNum(c.lastYr) }}</span>
        </div>
      </div>
    </div>

    <!-- 主图：3 品类 × 2 年 并排折线（cumsum） -->
    <div>
      <div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:6px;font-size:12px;color:#64748b">
          <span v-for="c in ADD_CATS" :key="c" style="display:inline-flex;align-items:center;gap:4px">
            <span style="width:14px;height:2px;display:inline-block" :style="{background:ADD_CAT_COLOR[c]}"></span>
            {{ c }} · 26年
          </span>
          <span v-for="c in ADD_CATS" :key="c+'-l'" style="display:inline-flex;align-items:center;gap:4px;opacity:.7">
            <span style="width:14px;height:0;border-top:2px dashed" :style="{borderColor:ADD_CAT_COLOR[c]}"></span>
            {{ c }} · 25年
          </span>
        </div>
        <svg :viewBox="'0 0 ' + addChartGeom.W + ' ' + addChartGeom.H" style="width:100%;height:240px;background:#fff">
          <!-- y 轴网格 -->
          <g v-for="(tick, i) in addChartGeom.yTicks" :key="'y'+i">
            <line :x1="addChartGeom.padL" :x2="addChartGeom.W - addChartGeom.padR"
                  :y1="addChartGeom.y(tick)" :y2="addChartGeom.y(tick)"
                  stroke="#f1f5f9" stroke-width="1" />
            <text :x="addChartGeom.padL - 4" :y="addChartGeom.y(tick) + 3"
                  text-anchor="end" font-size="10" fill="#94a3b8">{{ fmtNum(tick) }}</text>
          </g>
          <!-- x 轴 -->
          <text v-for="d in ADD_DAYS" :key="'x'+d"
                :x="addChartGeom.x(d)" :y="addChartGeom.H - 8"
                text-anchor="middle" font-size="10" fill="#94a3b8">5/{{ d }}</text>
          <!-- 折线 -->
          <path v-for="(ln, i) in addChartLines" :key="'p'+i"
                :d="addLinePath(ln)" fill="none" :stroke="ln.color" stroke-width="1.8"
                :stroke-dasharray="ln.dashed ? '4,3' : ''" />
          <!-- 数据点 -->
          <g v-for="(ln, i) in addChartLines" :key="'pt'+i">
            <circle v-for="p in ln.points" :key="ln.cat+ln.year+p.d"
                    :cx="addChartGeom.x(p.d)" :cy="addChartGeom.y(p.v)" r="2.5"
                    :fill="ln.color" :fill-opacity="ln.dashed ? 0.5 : 1">
              <title>{{ ln.cat }} · {{ ln.year }}-5-{{ p.d }} 累计 {{ fmtNum(p.v) }}</title>
            </circle>
          </g>
        </svg>
      </div>

    </div>
  </div>

  <!-- Trend Chart -->
  <div class="card" style="padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <div>
        <span class="card-title">趋势图</span>
        <span class="card-sub">柱状 + 折线复合，按{{ trendGranularity==='week'?'周':trendGranularity==='month'?'月':'日' }}聚合</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <label v-for="opt in overviewMetricOpts" :key="opt.key"
          style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;padding:3px 8px;border-radius:99px;border:1px solid"
          :style="{borderColor:selectedOverviewMetrics.includes(opt.key)?opt.color:'#e2e8f0',background:selectedOverviewMetrics.includes(opt.key)?opt.color+'18':'transparent',color:selectedOverviewMetrics.includes(opt.key)?opt.color:'#94a3b8'}">
          <input type="checkbox" :value="opt.key" v-model="selectedOverviewMetrics" style="display:none">
          <span :style="{width:'8px',height:'8px',borderRadius:opt.type==='bar'?'2px':'999px',background:opt.color,display:'inline-block'}"></span>
          {{ opt.name }}
        </label>
      </div>
    </div>
    <InteractiveTrendChart :series="trendSeries" :height="220" :normalize="true" />
  </div>

  <!-- Category + Ranking -->
  <div class="row-2-3">

    <!-- Channel Cat Tables: Audience (plan vs actual) + Keyword (actual) -->
    <div style="display:flex;flex-direction:column;gap:12px">

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
          <div v-for="c in channelCatData.audienceRows" :key="'aud-'+c.category">
            <div style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0"
               @click="c._open=!c._open">
              <span style="font-size:12px;font-weight:600;width:36px;flex-shrink:0">{{ c.category }}</span>
              <div style="flex:1;position:relative;height:6px;background:#f0f0f0;border-radius:3px">
                <div style="position:absolute;top:0;left:0;height:6px;background:#d4d4d8;border-radius:3px"
                     :style="{width:Math.min(100,c.plan_pct||0)+'%'}"></div>
                <div style="position:absolute;top:0;left:0;height:6px;background:var(--accent);border-radius:3px;opacity:.8"
                     :style="{width:Math.min(100,c.actual_pct||0)+'%'}"></div>
            </div>
              <span style="font-size:10px;width:52px;text-align:right;color:var(--muted);flex-shrink:0">计 {{ c.plan_pct }}%</span>
              <span style="font-size:10px;width:52px;text-align:right;color:var(--muted);flex-shrink:0">实 {{ c.actual_pct }}%</span>
              <span :class="['cat-diff','s-'+c.status]" style="width:40px;text-align:right;font-size:11px;font-weight:600;flex-shrink:0">
              {{ c.diff > 0 ? '+' : '' }}{{ c.diff }}%
            </span>
              <span style="font-size:10px;color:var(--muted);width:16px;text-align:center;flex-shrink:0">{{ c._open ? '▲' : '▼' }}</span>
          </div>
            <div v-if="c._open" style="margin:4px 0 4px 44px;border-left:2px solid var(--border);padding-left:8px">
              <div style="display:grid;grid-template-columns:1fr 64px 52px 52px;gap:4px;padding:0 0 4px;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted)">
                <span>商品</span><span style="text-align:right">花费</span><span style="text-align:right">实际%</span><span style="text-align:right">计划%</span>
            </div>
              <div v-for="p in (c.products || [])" :key="p.pid"
                   style="display:grid;grid-template-columns:1fr 64px 52px 52px;gap:4px;padding:4px 0;border-bottom:1px solid #f4f4f5;font-size:11px;align-items:center">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)" :title="p.name">{{ p.name }}</span>
                <span style="text-align:right;font-weight:600">¥{{ p.spend >= 10000 ? (p.spend/10000).toFixed(1)+'万' : p.spend.toFixed(0) }}</span>
                <span style="text-align:right;color:var(--muted)">{{ channelCatData.audienceTotal > 0 ? (p.spend/channelCatData.audienceTotal*100).toFixed(1) : 0 }}%</span>
                <span style="text-align:right" :style="{color:p.plan_pct>0?'var(--text)':'#d1d5db'}">{{ p.plan_pct > 0 ? p.plan_pct+'%' : '—' }}</span>
            </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0 0;font-size:11px;border-top:1px solid var(--border);margin-top:2px">
                <span style="color:var(--muted)">小计</span>
                <span style="font-weight:700">¥{{ c.actual_spend >= 10000 ? (c.actual_spend/10000).toFixed(1)+'万' : c.actual_spend.toFixed(0) }}</span>
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
          <div v-for="c in channelCatData.keywordRows" :key="'kw-'+c.category">
            <div style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0"
                 @click="c._open=!c._open">
              <span style="font-size:12px;font-weight:600;width:36px;flex-shrink:0">{{ c.category }}</span>
              <div style="flex:1;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden">
                <div style="height:100%;background:#60a5fa;border-radius:3px;opacity:.8"
                     :style="{width:Math.min(100,c.actual_pct||0)+'%'}"></div>
              </div>
              <span style="font-size:11px;width:52px;text-align:right;color:var(--muted);flex-shrink:0">{{ c.actual_pct }}%</span>
              <span style="font-size:12px;font-weight:600;width:72px;text-align:right;flex-shrink:0">¥{{ c.actual_spend >= 10000 ? (c.actual_spend/10000).toFixed(1)+'万' : c.actual_spend.toFixed(0) }}</span>
              <span style="font-size:10px;color:var(--muted);width:16px;text-align:center;flex-shrink:0">{{ c._open ? '▲' : '▼' }}</span>
            </div>
            <div v-if="c._open" style="margin:4px 0 4px 44px;border-left:2px solid var(--border);padding-left:8px">
              <div style="display:grid;grid-template-columns:1fr 64px 52px;gap:4px;padding:0 0 4px;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted)">
                <span>商品</span><span style="text-align:right">花费</span><span style="text-align:right">占比</span>
              </div>
              <div v-for="p in (c.products || [])" :key="p.pid"
                   style="display:grid;grid-template-columns:1fr 64px 52px;gap:4px;padding:4px 0;border-bottom:1px solid #f4f4f5;font-size:11px;align-items:center">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)" :title="p.name">{{ p.name }}</span>
                <span style="text-align:right;font-weight:600">¥{{ p.kw_spend >= 10000 ? (p.kw_spend/10000).toFixed(1)+'万' : p.kw_spend.toFixed(0) }}</span>
                <span style="text-align:right;color:var(--muted)">{{ channelCatData.keywordTotal > 0 ? (p.kw_spend/channelCatData.keywordTotal*100).toFixed(1) : 0 }}%</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0 0;font-size:11px;border-top:1px solid var(--border);margin-top:2px">
                <span style="color:var(--muted)">小计</span>
                <span style="font-weight:700">¥{{ c.actual_spend >= 10000 ? (c.actual_spend/10000).toFixed(1)+'万' : c.actual_spend.toFixed(0) }}</span>
              </div>
            </div>
          </div>
          <div v-if="!channelCatData.keywordRows.length" class="empty">暂无投放数据</div>
        </div>
      </div>

    </div>

    <!-- Ranking -->
    <div class="card" style="padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div class="tabs" style="border-bottom:none">
          <div v-for="m in rankDefs" :key="m.k"
               class="tab" :class="{active:rankMetric===m.k}"
               @click="rankMetric=m.k">{{ m.l }} 排行</div>
        </div>
        <!-- 分类筛选按钮组：全部 / 配饰 / 家具 / 灯具 -->
        <div style="display:flex;gap:4px;align-items:center">
          <span style="font-size:11px;color:var(--muted)">分类：</span>
          <button v-for="c in ['全部','配饰','家具','灯具']" :key="c"
            @click="rankCategory=c"
            :style="{padding:'4px 10px',fontSize:'11px',border:rankCategory===c?'1px solid var(--accent)':'1px solid var(--border)',
                     background:rankCategory===c?'var(--accent)':'transparent',color:rankCategory===c?'#fff':'var(--muted)',
                     borderRadius:'14px',cursor:'pointer',fontWeight:rankCategory===c?'600':'400'}">{{ c }}</button>
        </div>
        <div style="font-size:11px;color:var(--muted)">vs 上期</div>
        <span class="info-btn" style="margin-left:8px">?<span class="tooltip" style="left:auto;right:0">
          GMV：生意参谋 pay_amount 字段汇总 ｜
          流量：生意参谋 visitors 字段汇总 ｜
          分类筛选只看该一级分类下的商品排行
        </span></span>
      </div>
      <div style="border-bottom:1px solid var(--border);margin:8px 0 10px"></div>
      <div v-if="rankLoading" class="empty">加载中...</div>
      <div v-else style="overflow-x:auto">
        <div style="min-width:500px">
        <!-- header -->
        <div style="display:grid;grid-template-columns:22px minmax(60px,.8fr) 54px 6px 22px minmax(100px,1.6fr) 60px 44px;
                    gap:3px;padding:0 0 6px;border-bottom:2px solid var(--border);
                    font-size:10px;font-weight:600;color:var(--muted);letter-spacing:.3px;align-items:end">
          <span></span><span style="opacity:.6">上期</span><span style="text-align:right;opacity:.6">金额</span><span></span>
          <span></span><span style="padding-left:6px">本期</span><span style="text-align:right">金额</span><span style="text-align:right">环比</span>
        </div>
        <!-- rows -->
        <div v-for="(r,i) in rankData.items||[]" :key="r.spu_id"
             style="display:grid;grid-template-columns:22px minmax(60px,.8fr) 54px 6px 22px minmax(100px,1.6fr) 60px 44px;
                    gap:3px;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
          <!-- 上期排名 -->
          <div style="font-size:11px;text-align:center;font-weight:600;flex-shrink:0"
               :style="{color:(prevTopList[i]&&prevTopList[i].rank<=3)?'var(--text)':'var(--muted)'}">
            {{ prevTopList[i] ? prevTopList[i].rank : '—' }}
          </div>
          <!-- 上期名称 -->
          <div style="display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden">
            <img v-if="prevTopList[i]&&imgSrc(prevTopList[i].spu_id)"
                 :src="imgSrc(prevTopList[i].spu_id)"
                 style="width:24px;height:24px;object-fit:cover;border-radius:3px;flex-shrink:0;border:1px solid var(--border)">
            <span style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)"
               :title="prevTopList[i]&&prevTopList[i].title">
            {{ prevTopList[i] ? prevTopList[i].title : '—' }}
            </span>
          </div>
          <!-- 上期金额 -->
          <div style="font-size:11px;text-align:right;color:var(--muted);white-space:nowrap">
            {{ prevTopList[i] ? rankFmt(prevTopList[i].value) : '' }}
          </div>
          <!-- divider -->
          <div style="border-left:1px solid var(--border);height:100%;margin:0 auto"></div>
          <!-- 本期排名 -->
          <div class="rank-no" :class="{top3:r.rank<=3}" style="text-align:center;flex-shrink:0">{{ r.rank }}</div>
          <!-- 本期名称 + 位次 -->
          <div style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;padding-left:4px">
            <img v-if="imgSrc(r.spu_id)" :src="imgSrc(r.spu_id)"
                 style="width:28px;height:28px;object-fit:cover;border-radius:4px;flex-shrink:0;border:1px solid var(--border)">
            <div style="min-width:0;overflow:hidden">
              <div style="display:flex;align-items:center;gap:4px;overflow:hidden">
                <span v-if="r.unofficial" style="color:#d97706;font-size:10px;font-weight:700;flex-shrink:0;background:#fef3c7;padding:0 3px;border-radius:3px;line-height:1.4">*</span>
                <span style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="r.title">{{ r.title }}</span>
                <span v-if="r.prev_rank" style="flex-shrink:0;font-size:10px;font-weight:700;padding:1px 4px;border-radius:3px"
                      :style="{background:r.rank<r.prev_rank?'#dcfce7':r.rank>r.prev_rank?'#fee2e2':'#f4f4f5',
                               color:r.rank<r.prev_rank?'var(--green)':r.rank>r.prev_rank?'var(--red)':'var(--muted)'}">
                  {{ r.rank<r.prev_rank?'↑'+(r.prev_rank-r.rank):r.rank>r.prev_rank?'↓'+(r.rank-r.prev_rank):'=' }}
                  </span>
              </div>
              <div style="font-size:10px;color:var(--muted);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ r.spu_id }}</div>
            </div>
          </div>
          <!-- 本期金额 -->
          <div style="font-size:12px;font-weight:600;text-align:right;white-space:nowrap">{{ rankFmt(r.value) }}</div>
          <!-- 环比 -->
          <div style="font-size:11px;text-align:right;white-space:nowrap" :class="chgCls(r.change_pct)">{{ chgTxt(r.change_pct) }}</div>
        </div>
        <div v-if="!(rankData.items&&rankData.items.length)" class="empty">暂无数据</div>
        </div>
      </div>
    </div>

  </div>

  <!-- Meetings -->
  <div class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:12px">
      <span class="card-title">本周开会重点</span>
      <span class="card-sub">{{ meetings.length }} 条</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div v-for="m in meetings" :key="m.id"
           style="padding:10px 12px;background:#f9f9f8;border-radius:6px;border-left:3px solid"
           :style="{borderLeftColor:m.important_level==='high'?'var(--accent)':m.important_level==='low'?'var(--yellow)':'var(--border)'}">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:12px;font-weight:600">{{ m.title }}</span>
          <span style="font-size:11px;color:var(--muted)">{{ m.meeting_date }} {{ m.week_label }}</span>
        </div>
        <div style="font-size:12px;color:var(--muted);line-height:1.6">{{ m.content }}</div>
      </div>
      <div v-if="meetings.length===0" class="empty">暂无会议记录</div>
    </div>
  </div>

</div>`
})
