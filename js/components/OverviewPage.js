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

    const localRank = (metric, s, e) => {
      const rows = Object.values(RAW.products).map(p => {
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
          value: metric==='gmv' ? gmv : vis,
        }
      }).filter(r => r.value != null && r.value > 0)
        .sort((a,b)=>(b.value||0)-(a.value||0))
        .slice(0,10)
        .map((r,i)=>({ ...r, rank:i+1 }))
      return { items: rows, prev_top: [] }
    }

    const loadRank = async () => {
      rankLoading.value = true
      const s = props.start, e = props.end
      if (!s || !e) { rankLoading.value = false; return }
      const d = await api('/api/overview/ranking', { metric: rankMetric.value, start: s, end: e })
      const valid = d && Array.isArray(d.items) && d.items.length >= 10 ? d : localRank(rankMetric.value, s, e)
      rankData.value = valid || { items: [] }
      if (valid && valid.prev_top) prevTopData.value = valid.prev_top
      rankLoading.value = false
    }
    const load = () => {
      const s = props.start, e = props.end
      if (!s || !e) return
      const all = computeAll(s, e)
      const subD = (ds, n) => { const d = new Date(ds); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10) }
      const prev = s === e ? { s: subD(s,1), e: subD(e,1) } : prevRange(s, e)
      prevPeriod.value = prev
      kpi.value      = all.kpi
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

    return {
      kpi, planData, tasks, meetings, rankMetric, rankData, rankLoading,
      kpiDefs, rankDefs, kpiVal, kpiChg, barW, rankFmt, fmtWan, imgSrc,
      dotColor, statusLabel, totalActualWan, prevTopList, prevPeriod, chgCls, chgTxt,
      selectedOverviewMetrics, overviewMetricOpts, trendSeries, trendGranularity,
      channelCatData,
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
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px">
        <div class="tabs" style="border-bottom:none">
          <div v-for="m in rankDefs" :key="m.k"
               class="tab" :class="{active:rankMetric===m.k}"
               @click="rankMetric=m.k">{{ m.l }} 排行</div>
        </div>
        <div style="font-size:11px;color:var(--muted)">vs 上期</div>
        <span class="info-btn" style="margin-left:8px">?<span class="tooltip" style="left:auto;right:0">
          GMV：生意参谋 pay_amount 字段汇总 ｜
          流量：生意参谋 visitors 字段汇总
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
