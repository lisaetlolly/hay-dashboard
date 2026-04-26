// ── store.js ──────────────────────────────────────────────────
// 全局应用状态。依赖：config.js（常量）、utils.js（deepClone/readStore/writeStore/makeId）、RAW（内联注入）。
// APP_STATE 初始化后在 dashboard.html 内联脚本中调用 loadAppState()。

function defaultActions() {
  // action_type: 改主图 / 投放启动 / seeding / 标题优化 / 详情页优化 / 活动报名
  // action_date: 执行日（效果分析以此为原点）
  // pids: 涉及商品列表（'*' = 全部商品；否则为 pid 数组）
  // is_global: 是否为全局动作（展开为每个商品一条记录）
  return [
    // ── 改主图 ─────────────────────────────────────────────
    { id:makeId('action'), pid:'564552361178', pids:['564552361178'], action_type:'改主图', title:'Cotton Bag 主图 A/B 换版', owner:'豆豆（设计）', status:'已完成', action_date:'2026-02-24', end_date:'', note:'换用白底纯色主图，测试点击率变化' },
    { id:makeId('action'), pid:'580467335137', pids:['580467335137'], action_type:'改主图', title:'Basket 主图场景化更新', owner:'豆豆（设计）', status:'已完成', action_date:'2026-03-08', end_date:'', note:'从白底改为生活场景图' },
    { id:makeId('action'), pid:'965048597796', pids:['965048597796'], action_type:'改主图', title:'La Pittura 主图更换（节庆版）', owner:'豆豆（设计）', status:'已完成', action_date:'2026-04-07', end_date:'', note:'加入节日氛围感元素' },
    { id:makeId('action'), pid:'886839411718', pids:['886839411718'], action_type:'改主图', title:'Empire Vase 主图优化', owner:'豆豆（设计）', status:'进行中', action_date:'2026-04-15', end_date:'', note:'测试多花卉场景' },
    // ── 投放启动 ─────────────────────────────────────────
    { id:makeId('action'), pid:'*', pids:['580467335137','652664516885','717349639294','824946188993','965048597796'], action_type:'投放启动', title:'4月主力品类万象台投放上线', owner:'晓东（运营）', status:'已完成', action_date:'2026-04-08', is_global:true, end_date:'', note:'Basket / Weekday 等主力 SKU 投放上线' },
    { id:makeId('action'), pid:'579198301351', pids:['679198301351'], action_type:'投放启动', title:'Colour Crate 妈妈计划上线', owner:'晓东（运营）', status:'已完成', action_date:'2026-04-11', end_date:'', note:'针对 Colour Crate 单独启动妈妈计划' },
    { id:makeId('action'), pid:'1020175879777', pids:['1020175879777'], action_type:'投放启动', title:'Grid Bag 人群包推广启动', owner:'晓东（运营）', status:'已完成', action_date:'2026-02-17', end_date:'', note:'启动小众包袋人群定向' },
    // ── seeding ───────────────────────────────────────────
    { id:makeId('action'), pid:'742092260504', pids:['742092260504'], action_type:'seeding', title:'Apex Lamp 小红书博主寄样', owner:'晓东（运营）', status:'已完成', action_date:'2026-03-24', end_date:'', note:'寄样给3位家居 KOL，内容于4月初陆续发布' },
    { id:makeId('action'), pid:'1022489092196', pids:['1022489092196'], action_type:'seeding', title:'Conical Vase 博主内容合作', owner:'晓东（运营）', status:'已完成', action_date:'2026-03-14', end_date:'', note:'合作笔记在3月底~4月初上线' },
    { id:makeId('action'), pid:'*', pids:['1020175879777','780467335137','965048597796'], action_type:'seeding', title:'全店 KOL seeding 第一波', owner:'晓东（运营）', status:'已完成', action_date:'2026-02-23', is_global:true, end_date:'', note:'全店核心 SKU 第一轮寄样，共 3 款' },
    // ── 标题优化 ────────────────────────────────────────────
    { id:makeId('action'), pid:'652664516885', pids:['652664516885'], action_type:'标题优化', title:'Knit 衣架标题 A/B 测试', owner:'Jas team（内容）', status:'已完成', action_date:'2026-03-23', end_date:'', note:'根据生意参谋热搜词优化标题' },
    { id:makeId('action'), pid:'824607518747', pids:['824607518747'], action_type:'标题优化', title:'Colour Rack 标题加入关键词', owner:'Jas team（内容）', status:'已完成', action_date:'2026-03-25', end_date:'', note:'增加「落地衣架」「可移动」等热搜词' },
    { id:makeId('action'), pid:'*', pids:['679198301351','781547798998','580467335137'], action_type:'标题优化', title:'主力 SKU 批量标题优化', owner:'Jas team（内容）', status:'进行中', action_date:'2026-04-13', is_global:true, end_date:'', note:'3 款主力商品统一按生意参谋建议优化' },
    // ── 详情页优化 ─────────────────────────────────────────
    { id:makeId('action'), pid:'824946188993', pids:['824946188993'], action_type:'详情页优化', title:'吧椅详情页全面迭代', owner:'豆豆（设计）', status:'已完成', action_date:'2026-03-30', end_date:'', note:'新增尺寸对比图、使用场景图、买家秀区' },
    { id:makeId('action'), pid:'1020175879777', pids:['1020175879777'], action_type:'详情页优化', title:'Grid Bag 详情页分拆优化', owner:'豆豆（设计）', status:'进行中', action_date:'2026-04-03', end_date:'', note:'将单链接拆分为两款颜色独立链接' },
    // ── 活动报名 ───────────────────────────────────────────
    { id:makeId('action'), pid:'*', pids:['*'], action_type:'活动报名', title:'4.23 世界读书日活动上线', owner:'晓东（运营）', status:'已完成', action_date:'2026-04-23', is_global:true, end_date:'', note:'全店参与品台活动，流量整体上涨' },
    { id:makeId('action'), pid:'*', pids:['564552361178','580467335137'], action_type:'活动报名', title:'3.8 女神节大促报名', owner:'晓东（运营）', status:'已完成', action_date:'2026-03-01', is_global:true, end_date:'', note:'帆布包 + 收纳篓参与女神节大促' },
  ]
}
function defaultMetricRegistry() {
  return [
    { id:'metric_gmv', key:'gmv', label:'总销售额', module:'overview', unit:'money', note:'默认指标' },
    { id:'metric_cart_rate', key:'cart_rate', label:'加购率', module:'overview', unit:'percent', note:'默认指标' },
    { id:'metric_ctr', key:'ctr', label:'CTR', module:'overview', unit:'percent', note:'默认指标' },
    { id:'metric_visitors', key:'visitors', label:'进店 UV', module:'overview', unit:'uv', note:'默认指标' },
  ]
}
function defaultUsers() {
  return [
    { id:'u_admin', display_name:'管理员', role:'admin', permissions:['*'] },
    { id:'u_ops', display_name:'晓东（运营）', role:'ops', permissions:['task.view_all','task.create','task.edit_all','meeting.view','meeting.create','meeting.edit','action.view','action.create','action.edit','metric.view'] },
    { id:'u_design', display_name:'豆豆（设计）', role:'member', permissions:['task.view_all','task.edit_own','task.view_own','action.view','meeting.view','metric.view'] },
  ]
}
function createInitialAppState() {
  return {
    currentUserId:'u_admin',
    users: defaultUsers(),
    meetings: deepClone(RAW.meetings || []),
    tasksByPid: deepClone(RAW.tasks_by_pid || {}),
    actions: defaultActions(),
    metricRegistry: defaultMetricRegistry(),
    permissionGroups: DEFAULT_PERMISSION_GROUPS,
    customProducts: [],
    hiddenPids: [],
    productOverrides: {},
    manualDailyData: {},
  }
}
// APP_STATE 初始化在 dashboard.html 内联脚本中（需要 RAW 和 ref 均已就绪后执行）
// let APP_STATE  ← 由内联脚本声明：const APP_STATE = Vue.ref(createInitialAppState())
function loadAppState() {
  const saved = readStore(APP_STORAGE_KEY, null)
  if (!saved) return
  const initial = createInitialAppState()
  APP_STATE.value = {
    ...initial,
    ...saved,
    permissionGroups: initial.permissionGroups,
  }
}
let _lastServerStateAt = null

async function syncStateFromServer() {
  try {
    const res = await fetch('/api/app-state')
    if (!res.ok) return
    const { state, updated_at } = await res.json()
    if (!state || !updated_at) return
    if (_lastServerStateAt === updated_at) return
    _lastServerStateAt = updated_at
    const initial = createInitialAppState()
    APP_STATE.value = { ...initial, ...state, permissionGroups: initial.permissionGroups }
    writeStore(APP_STORAGE_KEY, APP_STATE.value)
  } catch {}
}

async function pushStateToServer(stateSnapshot) {
  try {
    await fetch('/api/app-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: stateSnapshot }),
    })
  } catch {}
}

function persistAppState() {
  writeStore(APP_STORAGE_KEY, APP_STATE.value)
  pushStateToServer(APP_STATE.value)
}

function startStateSync(intervalMs = 15000) {
  syncStateFromServer()
  setInterval(syncStateFromServer, intervalMs)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncStateFromServer()
  })
}

function getEffectiveProducts() {
  const hidden = new Set(APP_STATE.value.hiddenPids || [])
  const overrides = APP_STATE.value.productOverrides || {}
  const custom = APP_STATE.value.customProducts || []
  const manualData = APP_STATE.value.manualDailyData || {}
  const base = Object.values(RAW.products)
    .filter(p => !hidden.has(p.pid))
    .map(p => {
      const ov = overrides[p.pid] || {}
      const manual = manualData[p.pid] || {}
      const merged = { ...p }
      if (ov.name) merged.name = ov.name
      if (ov.cat) merged.cat = ov.cat
      if (Object.keys(manual).length) {
        const newDates = [], newPay = [], newVis = [], newCart = [], newSpend = [], newRefund = [], newCollect = []
        for (let i = 0; i < merged.dates.length; i++) {
          const d = merged.dates[i]
          const m = manual[d]
          newDates.push(d)
          newPay.push(m?.pay != null ? m.pay : (merged.pay?.[i] || 0))
          newVis.push(m?.vis != null ? m.vis : (merged.vis?.[i] || 0))
          newCart.push(m?.cart != null ? m.cart : (merged.cart?.[i] || 0))
          newSpend.push(m?.spend != null ? m.spend : (merged.spend?.[i] || 0))
          newRefund.push(m?.refund != null ? m.refund : (merged.refund?.[i] || 0))
          newCollect.push(m?.collect != null ? m.collect : (merged.collect?.[i] || 0))
        }
        merged.pay = newPay; merged.vis = newVis; merged.cart = newCart
        merged.spend = newSpend; merged.refund = newRefund; merged.collect = newCollect
      }
      return merged
    })
  const customMapped = custom.filter(p => !hidden.has(p.pid)).map(p => {
    const ov = overrides[p.pid] || {}
    return { ...p, name: ov.name || p.name, cat: ov.cat || p.cat }
  })
  return [...base, ...customMapped]
}
function currentUserObj() {
  return APP_STATE.value.users.find(u => u.id === APP_STATE.value.currentUserId) || APP_STATE.value.users[0]
}
