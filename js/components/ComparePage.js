// ── ComparePage.js ─────────────────────────────────────
// 多品对比页组件。

const ComparePage = defineComponent({
  name: 'ComparePage',
  components: { InteractiveTrendChart },
  props: ['start', 'end'],
  setup(props) {
    const metric = ref('cart_rate')
    const selectedPids = ref(RAW.official_pids ? RAW.official_pids.slice(0, 8) : Object.values(RAW.products || {}).filter(p => OFFICIAL.has(p.pid)).slice(0, 8).map(p => p.pid))
    const selectedCats = ref(['配饰','家具','灯具'])
    const hoverKey = ref('')

    const metricOptions = [
      { k:'gmv', l:'销售额', fmt:'money' },
      { k:'vis', l:'UV', fmt:'num' },
      { k:'cart_rate', l:'加购率', fmt:'pct' },
      { k:'conv_rate', l:'转化率', fmt:'pct' },
      { k:'ad_roi', l:'ROI', fmt:'x' },
      { k:'fav_cart', l:'收藏加购', fmt:'num' },
      { k:'new_buyers', l:'新客数', fmt:'num' },
      { k:'refund', l:'退款金额', fmt:'money' },
      { k:'ad_spend', l:'投放花费', fmt:'money' },
      { k:'ad_ctr', l:'投放CTR', fmt:'pct' },
      { k:'pv', l:'浏览量', fmt:'num' },
      { k:'dwell_time', l:'停留时长', fmt:'sec' },
      { k:'bounce_rate', l:'跳出率', fmt:'pct' },
      { k:'fav_cart_users', l:'收藏加购人数', fmt:'num' },
      { k:'search_vis', l:'搜索引导UV', fmt:'num' },
      { k:'xhs_inter', l:'小红书互动量', fmt:'num' },
    ]
    const palette = ['#3b82f6','#10b981','#f43f5e','#8b5cf6','#f59e0b','#06b6d4','#ef4444','#22c55e','#a855f7','#f97316','#14b8a6','#ec4899']
    const categories = ['配饰','家具','灯具','其他']

    const productOptions = computed(() => Object.values(RAW.products || {})
      .filter(p => OFFICIAL.has(p.pid))
      .map((p, i) => ({ id:p.pid, label:p.name, cat:p.cat, color:palette[i % palette.length] }))
      .sort((a,b) => a.cat.localeCompare(b.cat) || a.label.localeCompare(b.label))
    )

    const currentRange = computed(() => ({ s: props.start || RAW.launch_date, e: props.end || RAW.data_end }))
    const launchRange = computed(() => ({ s: RAW.launch_date, e: RAW.data_end }))

    const dayMetricRow = (p, i) => {
      const vis = p.vis[i] || 0
      const cart = p.cart[i] || 0
      const gmv = p.pay[i] || 0
      const spend = p.spend?.[i] || 0
      // 真 ROI = 推广 GMV ÷ 推广花费（roi[i] 是日级真 ROI，反算 ad_gmv）
      const adGmv = (p.roi?.[i] || 0) * spend
      const d = p.dates[i]
      // 支付买家 = pay_buyers 字段；缺则回退到 new + old
      const payBuyers = (p.pay_buyers?.[i] != null) ? p.pay_buyers[i]
                      : ((p.new_buyers?.[i]||0) + (p.old_buyers?.[i]||0))
      const xhsInter = (RAW.xhs_notes||[]).filter(n => n.pid===p.pid && n.date===d).reduce((a,n)=>a+(n.inter||0),0)
      return {
        gmv,
        vis,
        cart_rate: vis > 0 ? cart / vis * 100 : null,
        // 转化率 = 支付买家 / UV，不是加购率
        conv_rate: vis > 0 ? payBuyers / vis * 100 : null,
        ad_roi: spend > 0 ? adGmv / spend : null,
        psr:    spend > 0 ? gmv / spend : null,  // 销售杠杆 = 全店GMV/花费（对齐 sycm 30.28x）
        fav_cart: (p.collect?.[i] || 0) + cart,
        new_buyers: p.new_buyers?.[i] || 0,
        refund: p.refund?.[i] || 0,
        ad_spend: spend,
        ad_ctr: (p.ctr?.[i] || 0) > 0 ? p.ctr[i] * 100 : null,
        xhs_inter: xhsInter,
        pv: p.pv?.[i] ?? null,
        dwell_time: p.dwell_time?.[i] ?? null,
        bounce_rate: p.bounce_rate?.[i] ?? null,
        fav_cart_users: p.fav_cart_users?.[i] ?? null,
        search_vis: p.search_vis?.[i] ?? null,
      }
    }

    const itemSeries = computed(() => {
      const cur = currentRange.value
      const launch = launchRange.value
      return selectedPids.value.map(pid => {
        const p = (RAW.products || {})[pid]
        const opt = productOptions.value.find(x => x.id === pid)
        if (!p || !opt) return null
        const build = (s, e) => p.dates.map((d, i) => d >= s && d <= e ? ({ d, ...dayMetricRow(p, i) }) : null).filter(Boolean)
        let values = build(cur.s, cur.e)
        if (!values.length || values.every(v => v[metric.value] == null || v[metric.value] === 0)) values = build(launch.s, launch.e)
        return values.length ? { key: pid, name: p.name, color: opt.color, values } : null
      }).filter(Boolean)
    })

    const catSeries = computed(() => {
      const { s, e } = currentRange.value
      const catMap = Object.fromEntries(selectedCats.value.map(cat => [cat, {}]))
      for (const p of Object.values(RAW.products || {})) {
        if (!selectedCats.value.includes(p.cat)) continue
        for (let i = 0; i < p.dates.length; i++) {
          const d = p.dates[i]
          if (d < s || d > e) continue
          if (!catMap[p.cat][d]) catMap[p.cat][d] = { gmv:0, vis:0, cart:0, refund:0, ad_spend:0, ctr_s:0, ctr_n:0, roi_s:0, roi_n:0 }
          const m = catMap[p.cat][d]
          m.gmv += p.pay[i] || 0
          m.vis += p.vis[i] || 0
          m.cart += p.cart[i] || 0
          m.refund += p.refund?.[i] || 0
          m.ad_spend += p.spend?.[i] || 0
          if ((p.ctr?.[i] || 0) > 0) { m.ctr_s += p.ctr[i] * 100; m.ctr_n++ }
          if ((p.roi?.[i] || 0) > 0) { m.roi_s += p.roi[i]; m.roi_n++ }
        }
      }
      return selectedCats.value.map((cat, i) => {
        const values = Object.entries(catMap[cat] || {}).sort((a,b) => a[0].localeCompare(b[0])).map(([d,m]) => ({
          d,
          gmv: m.gmv,
          vis: m.vis,
          cart_rate: m.vis > 0 ? m.cart / m.vis * 100 : null,
          refund: m.refund,
          ad_spend: m.ad_spend,
          ad_ctr: m.ctr_n > 0 ? m.ctr_s / m.ctr_n : null,
          ad_roi: m.roi_n > 0 ? m.roi_s / m.roi_n : null,
          xhs_inter: 0,
        }))
        return values.length ? { key: cat, name: cat, color: palette[i % palette.length], values } : null
      }).filter(Boolean)
    })

    const togglePid = pid => {
      selectedPids.value = selectedPids.value.includes(pid)
        ? selectedPids.value.filter(x => x !== pid)
        : [...selectedPids.value, pid]
    }
    const toggleCat = cat => {
      selectedCats.value = selectedCats.value.includes(cat)
        ? selectedCats.value.filter(x => x !== cat)
        : [...selectedCats.value, cat]
    }

    const isDim = key => hoverKey.value && hoverKey.value !== key
    const seriesFor = rows => rows.map(s => {
      const fmt = metricOptions.find(m => m.k===metric.value)?.fmt
      return {
        ...s,
        type: fmt === 'money' || fmt === 'num' ? 'bar' : 'line',
        values: s.values.map(v => ({
          d: v.d,
          value: v[metric.value],
          label: fmt === 'money' ? (v[metric.value] >= 10000 ? '¥'+(v[metric.value]/10000).toFixed(1)+'万' : '¥'+Math.round(v[metric.value])) : fmt === 'pct' ? (v[metric.value] == null ? '—' : v[metric.value].toFixed(2)+'%') : fmt === 'x' ? (v[metric.value] == null ? '—' : v[metric.value].toFixed(2)+'x') : Math.round(v[metric.value]||0).toLocaleString(),
        }))
      }
    }).filter(s => s.values.some(v => v.value != null))

    const itemPlotSeries = computed(() => seriesFor(itemSeries.value))
    const catPlotSeries = computed(() => seriesFor(catSeries.value))

    const showMetricGuide = ref(false)
    const guideKeys = ['gmv','vis','cart_rate','conv_rate','ad_roi','fav_cart','new_buyers','refund','ad_ctr','pv','dwell_time','bounce_rate','fav_cart_users','search_vis','xhs_inter']
    const guideItems = guideKeys.map(k => ({ key:k, label:METRIC_TIPS[k]?.label||k, tip:METRIC_TIPS[k]?.tip||'' }))

    return {
      metric, metricOptions, productOptions, categories,
      selectedPids, selectedCats, togglePid, toggleCat,
      hoverKey, isDim, itemPlotSeries, catPlotSeries,
      showMetricGuide, guideItems,
    }
  },
  template: `
<div style="display:flex;flex-direction:column;gap:16px">
  <div class="card" style="padding:10px 14px">
    <div @click="showMetricGuide=!showMetricGuide" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none">
      <span style="font-size:12px;font-weight:700;color:var(--muted)">指标说明</span>
      <span style="font-size:11px;color:var(--muted)">{{ showMetricGuide ? '▲ 收起' : '▼ 展开' }}</span>
    </div>
    <div v-if="showMetricGuide" style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px">
      <div v-for="item in guideItems" :key="item.key" style="padding:8px 10px;background:#f8f8f7;border-radius:8px;font-size:11px">
        <div style="font-weight:700;color:var(--text);margin-bottom:2px">{{ item.label }}</div>
        <div style="color:var(--muted);line-height:1.5">{{ item.tip }}</div>
      </div>
    </div>
  </div>
  <div class="card" style="padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <div style="font-size:16px;font-weight:700">多产品对比</div>
      <select v-model="metric" style="padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);font-size:12px">
        <option v-for="m in metricOptions" :key="m.k" :value="m.k">{{ m.l }}</option>
      </select>
    </div>

    <div style="display:grid;grid-template-columns:260px minmax(0,1fr);gap:14px;margin-bottom:18px">
      <div style="border:1px solid var(--border);border-radius:12px;padding:10px;background:#fafaf9;height:420px;overflow:auto">
        <div v-for="o in productOptions" :key="o.id"
             @mouseenter="hoverKey=o.id" @mouseleave="hoverKey=''"
             @click="togglePid(o.id)"
             :style="{display:'flex',alignItems:'center',gap:'8px',padding:'7px 8px',borderRadius:'8px',cursor:'pointer',marginBottom:'4px',
               background:selectedPids.includes(o.id)?o.color+'14':'transparent',
               border:selectedPids.includes(o.id)?'1px solid '+o.color:'1px solid transparent',
               opacity:isDim(o.id)?0.35:1}">
          <span :style="{width:'8px',height:'8px',borderRadius:'999px',background:o.color,flexShrink:0}"></span>
          <span style="font-size:12px;line-height:1.35;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ o.label }}</span>
        </div>
      </div>
      <div style="border:1px solid var(--border);border-radius:12px;padding:10px;background:#fff;min-width:0">
        <interactive-trend-chart :series="itemPlotSeries" :height="320" :normalize="true" :active-key-prop="hoverKey" />
      </div>
    </div>

    <div style="display:grid;grid-template-columns:260px minmax(0,1fr);gap:14px">
      <div style="border:1px solid var(--border);border-radius:12px;padding:10px;background:#fafaf9;height:180px;overflow:auto">
        <div v-for="(cat,idx) in categories" :key="cat"
             @mouseenter="hoverKey=cat" @mouseleave="hoverKey=''"
             @click="toggleCat(cat)"
             :style="{display:'flex',alignItems:'center',gap:'8px',padding:'7px 8px',borderRadius:'8px',cursor:'pointer',marginBottom:'4px',
               background:selectedCats.includes(cat)?['#3b82f6','#10b981','#f43f5e','#8b5cf6'][idx%4]+'14':'transparent',
               border:selectedCats.includes(cat)?'1px solid '+['#3b82f6','#10b981','#f43f5e','#8b5cf6'][idx%4]:'1px solid transparent',
               opacity:isDim(cat)?0.35:1}">
          <span :style="{width:'8px',height:'8px',borderRadius:'999px',background:['#3b82f6','#10b981','#f43f5e','#8b5cf6'][idx%4],flexShrink:0}"></span>
          <span style="font-size:12px">{{ cat }}</span>
        </div>
      </div>
      <div style="border:1px solid var(--border);border-radius:12px;padding:10px;background:#fff;min-width:0">
        <interactive-trend-chart :series="catPlotSeries" :height="320" :normalize="true" :active-key-prop="hoverKey" />
      </div>
    </div>
  </div>
</div>`
})

