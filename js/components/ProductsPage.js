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
      let pay=0,vis=0,cart=0,collect=0,refund=0,spend=0,ctr_s=0,ctr_n=0,ppay=0,pvis=0
      let newBuyers=0
      const daily=[]
      for (let i=0;i<p.dates.length;i++) {
        const d = p.dates[i]
        if (d>=s && d<=e) {
          const gmv = p.pay[i]||0, uv = p.vis[i]||0, cartN = p.cart[i]||0, rf = p.refund?.[i]||0
          const colN = p.collect?.[i]||0
          const nb = p.new_buyers?.[i]||0
          const spFromProduct = p.spend?.[i]||0
          const spFromDaily = RAW.pid_daily_spend?.[p.pid]?.[d]?.spend || 0
          const sp = spFromProduct > 0 ? spFromProduct : spFromDaily
          pay += gmv; vis += uv; cart += cartN; collect += colN; refund += rf; spend += sp; newBuyers += nb
          if ((p.ctr?.[i]||0)>0) { ctr_s += p.ctr[i]*100; ctr_n++ }
          const xhsInter = (RAW.xhs_notes||[]).filter(n => n.pid===p.pid && n.date===d).reduce((a,n)=>a+(n.inter||0),0)
          const pv_v          = p.pv?.[i]            ?? null
          const dwell_v       = p.dwell_time?.[i]    ?? null
          const bounce_v      = p.bounce_rate?.[i]   ?? null
          const fav_cu_v      = p.fav_cart_users?.[i]?? null
          const search_vis_v  = p.search_vis?.[i]    ?? null
          daily.push({
            d, gmv, uv, refund: rf, spend: sp, nb,
            fav_cart: cartN + colN,
            cart_rate: uv>0 ? cartN/uv*100 : null,
            conv_rate: uv>0 ? (gmv>0 ? cartN/uv*100 : null) : null,
            ad_roi: sp>0 ? gmv/sp : null,
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
      const allTasks = (RAW.tasks_by_pid?.[p.pid]||[])
      const pct = (a,b)=>b>0?+((a-b)/b*100).toFixed(1):null
      return {
        gmv:+pay.toFixed(2), vis:Math.round(vis),
        cart_rate: vis>0 ? +(cart/vis*100).toFixed(2) : null,
        conv_rate: vis>0 ? +(cart/vis*100).toFixed(2) : null,
        fav_cart: cart + collect,
        new_buyers: newBuyers,
        refund:+refund.toFixed(2), ad_spend:+spend.toFixed(2),
        ad_ctr: ctr_n>0 ? +(ctr_s/ctr_n).toFixed(2) : null,
        ad_roi: spend>0 ? +(pay/spend).toFixed(2) : null,
        pv: p.pv ? p.pv.filter((_,i)=>p.dates[i]>=s&&p.dates[i]<=e).reduce((a,v)=>a+(v||0),0) : null,
        dwell_time: (() => { const vs=p.dwell_time?.filter?.((_,i)=>p.dates[i]>=s&&p.dates[i]<=e).filter(v=>v>0)||[]; return vs.length?+(vs.reduce((a,v)=>a+v,0)/vs.length).toFixed(1):null })(),
        bounce_rate: (() => { const vs=p.bounce_rate?.filter?.((_,i)=>p.dates[i]>=s&&p.dates[i]<=e).filter(v=>v>0)||[]; return vs.length?+(vs.reduce((a,v)=>a+v,0)/vs.length).toFixed(2):null })(),
        fav_cart_users: p.fav_cart_users ? p.fav_cart_users.filter((_,i)=>p.dates[i]>=s&&p.dates[i]<=e).reduce((a,v)=>a+(v||0),0) : null,
        search_vis: p.search_vis ? p.search_vis.filter((_,i)=>p.dates[i]>=s&&p.dates[i]<=e).reduce((a,v)=>a+(v||0),0) : null,
        gmv_chg:pct(pay,ppay), vis_chg:pct(vis,pvis),
        xhs_notes:xhsList.length, xhsList, allTasks, daily,
      }
    }

    const products = computed(() => {
      const sv=s.value, ev=e.value
      return getEffectiveProducts()
        .filter(p => OFFICIAL.has(p.pid))
        .filter(p => filterCat.value==='全部' || p.cat===filterCat.value)
        .filter(p => !searchQ.value || p.name.toLowerCase().includes(searchQ.value.toLowerCase()) || p.pid.includes(searchQ.value))
        .map(p => ({ ...p, ...agg(p, sv, ev) }))
        .filter(p => !filterXhs.value || p.xhs_notes > 0)
        .sort((a,b) => (b[sortBy.value]||0) - (a[sortBy.value]||0))
    })

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

    return { filterCat, filterXhs, searchQ, sortBy, displayMode, periodLabel, sortOpts, products, summaryMetrics, chartMetricGroups, selectedChartMetrics, toggleChartMetric, isChartMetricSelected, filteredSummaryMetrics, fmt, fchg, chgCls, imgSrc, miniChart, productChartSeries, getCardTab, setCardTab, showMetricGuide, guideItems }
  },
  template: `
<div style="display:flex;flex-direction:column;height:100%;gap:0">
  <div class="card" style="flex-shrink:0;padding:10px 14px;margin-bottom:12px">
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
  <div style="flex-shrink:0;padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid var(--border)">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <input v-model="searchQ" placeholder="搜索商品名 / ID" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;outline:none;width:150px;background:var(--surface)">
      <div style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">
        <button v-for="c in ['全部','配饰','家具','灯具']" :key="c" @click="filterCat=c" :style="{padding:'5px 10px',fontSize:'12px',border:'none',cursor:'pointer',background:filterCat===c?'var(--accent)':'transparent',color:filterCat===c?'#fff':'var(--muted)'}">{{ c }}</button>
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
            <div style="font-size:15px;font-weight:700">{{ p.name }}</div>
            <span style="font-size:10px;color:var(--muted);padding:2px 6px;border:1px solid var(--border);border-radius:99px">{{ p.cat }}</span>
            <span v-if="p.xhs_notes>0" @click="setCardTab(p.pid, getCardTab(p.pid)==='xhs'?'daily':'xhs')" :style="{fontSize:'10px',color:'#ff2442',padding:'2px 6px',border:'1px solid',borderColor:getCardTab(p.pid)==='xhs'?'#ff2442':'#ffccd5',background:getCardTab(p.pid)==='xhs'?'#ff2442':'#fff0f2',borderRadius:'99px',cursor:'pointer',color:getCardTab(p.pid)==='xhs'?'#fff':'#ff2442'}">小红书 {{ p.xhs_notes }}</span>
            <span v-if="p.allTasks.length>0" @click="setCardTab(p.pid, getCardTab(p.pid)==='tasks'?'daily':'tasks')" :style="{fontSize:'10px',padding:'2px 6px',border:'1px solid',borderColor:getCardTab(p.pid)==='tasks'?'#d97706':'#fde68a',background:getCardTab(p.pid)==='tasks'?'#d97706':'#fffbeb',borderRadius:'99px',cursor:'pointer',color:getCardTab(p.pid)==='tasks'?'#fff':'#d97706'}">任务 {{ p.allTasks.length }}</span>
          </div>
          <div :style="{display:'grid',gridTemplateColumns:'repeat('+Math.min(filteredSummaryMetrics.length,5)+',minmax(72px,1fr))',gap:'10px',marginBottom:'10px'}">
            <div v-for="m in filteredSummaryMetrics" :key="m.k">
              <div style="font-size:10px;color:var(--muted);margin-bottom:2px">{{ m.l }}</div>
              <div style="font-size:14px;font-weight:700">{{ fmt(p[m.k],m.fmt) }}</div>
            </div>
          </div>
          <interactive-trend-chart :series="productChartSeries(p.daily)" :height="210" :normalize="true" />
        </div>
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="font-size:12px;font-weight:700">{{ getCardTab(p.pid)==='xhs'?'小红书笔记':getCardTab(p.pid)==='tasks'?'本期任务':'日数据' }}</div>
            <span v-if="getCardTab(p.pid)!=='daily'" @click="setCardTab(p.pid,'daily')" style="font-size:10px;color:var(--muted);cursor:pointer;text-decoration:underline">返回日数据</span>
          </div>
          <template v-if="getCardTab(p.pid)==='xhs'">
            <div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto">
              <div v-for="note in p.xhsList" :key="note.link" style="padding:6px 0;border-bottom:1px solid #f4f4f5;font-size:11px">
                <div style="font-weight:600;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a :href="note.link" target="_blank" style="color:var(--text);text-decoration:none">{{ note.title }}</a></div>
                <div style="display:flex;gap:8px;color:var(--muted)">
                  <span>{{ note.date }}</span><span>{{ note.author }}</span>
                  <span>互动 {{ note.inter }}</span><span>浏览 {{ note.views }}</span>
                </div>
              </div>
            </div>
          </template>
          <template v-else-if="getCardTab(p.pid)==='tasks'">
            <div style="display:flex;flex-direction:column;gap:4px;max-height:220px;overflow:auto">
              <div v-for="task in p.allTasks" :key="task.id" style="padding:6px 0;border-bottom:1px solid #f4f4f5;font-size:11px">
                <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:nowrap">
                  <span style="font-size:10px;color:var(--muted);border:1px solid var(--border);border-radius:99px;padding:1px 5px;flex-shrink:0;white-space:nowrap">{{ task.category }}</span>
                  <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">{{ task.detail }}</span>
                </div>
                <div style="margin-top:2px;color:var(--muted);display:flex;gap:8px">
                  <span>{{ task.owner }}</span><span style="font-size:10px;padding:1px 5px;border-radius:99px;background:#f3f4f6">{{ task.status||'—' }}</span>
                </div>
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
        <div style="min-width:0;flex:1"><div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ p.name }}</div><div style="font-size:10px;color:var(--muted)">{{ p.cat }}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
        <div v-for="m in summaryMetrics.slice(0,6)" :key="m.k"><div style="font-size:10px;color:var(--muted)">{{ m.l }}</div><div style="font-size:13px;font-weight:700">{{ fmt(p[m.k],m.fmt) }}</div></div>
      </div>
      <interactive-trend-chart :series="productChartSeries(p.daily)" :height="210" :normalize="true" />
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
</div>`
})
