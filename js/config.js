// ── config.js ─────────────────────────────────────────────────
// 静态常量。无任何外部依赖，必须在所有其他 js/ 文件之前加载。
// 注意：OFFICIAL 依赖 RAW（Python 注入），保留在 dashboard.html 内联脚本中。

const APP_STORAGE_KEY = 'hay_dashboard_app_state_v2'

const DEFAULT_PERMISSION_GROUPS = [
  { key:'task', label:'任务', perms:['task.view_all','task.view_own','task.create','task.edit_all','task.edit_own','task.delete'] },
  { key:'product', label:'商品', perms:['product.view','product.create','product.edit','product.delete'] },
  { key:'meeting', label:'会议要点', perms:['meeting.view','meeting.create','meeting.edit','meeting.delete'] },
  { key:'action', label:'运营动作', perms:['action.view','action.create','action.edit','action.delete'] },
  { key:'metric', label:'指标配置', perms:['metric.view','metric.create','metric.edit','metric.delete'] },
  { key:'user', label:'用户权限', perms:['user.view','user.create','user.edit','user.delete','permission.assign'] },
  { key:'event', label:'事件标注', perms:['event.create','event.edit','event.delete'] },
]

// 渠道拆分比例（来自实际投放数据，如有变化在此处更新）
const AUDIENCE_RATIO = 25499.58 / (25499.58 + 9384.97)
const KEYWORD_RATIO  = 9384.97  / (25499.58 + 9384.97)

// 类目顺序（用于渠道拆分表展示排序）
const CAT_ORDER = ['家具', '配饰', '灯具', '其他']

// ── 全局指标说明 ───────────────────────────────────────────────
// 各页面的指标 ? tooltip 均从此处读取，方便统一维护口径
const METRIC_TIPS = {
  // ── 总览 / KPI ──
  pay_amount:   { label: '成交金额 GMV',    tip: '生意参谋店铺流量报表「支付金额」，含退款前口径。时间范围内每日累加。' },
  visitors:     { label: '访客数 UV',       tip: '生意参谋店铺流量报表「访客数」，同一买家当天多次访问计1人。' },
  cart_rate:    { label: '加购率',           tip: '加购件数 ÷ 访客数 × 100%。反映商品对浏览客户的吸引力。来源：生意参谋商品报表。' },
  fav_cart:     { label: '收藏加购量',       tip: '商品报表「收藏人数 + 加购件数」之和，衡量意向用户积累。' },
  ctr:          { label: '推广点击率 CTR',   tip: '万象台商品推广报表「点击量 ÷ 展现量 × 100%」，按有效曝光商品的 CTR 取加权均值。' },

  // ── 投放面板 ──
  spend:        { label: '投放花费',         tip: '商品维度的累计花费 = 万象台商品报表 spend 字段（=人群+关键词，单商品级）。短视频是内容报表口径，与商品报表分开。' },
  ad_roi:       { label: '投放 ROI',         tip: '成交金额 ÷ 投放花费。成交金额含间接成交（点击 24h 内）。注意：分子是淘宝 GMV，分母是万象台 spend，与淘宝后台 ROI 报表口径基本一致但可能差 1-2%。' },
  ad_ctr:       { label: '推广 CTR',         tip: '万象台商品报表 CTR 字段均值（点击量 ÷ 展现量）。按 SPU 取算术均值，仅含有效曝光（impressions>0）的商品。' },
  audience_pct: { label: '人群渠道占比',     tip: '人群推广花费 ÷ (人群+关键词) × 100%。商品报表内部拆分。短视频不计入此处。' },
  keyword_pct:  { label: '关键词渠道占比',   tip: '关键词推广花费 ÷ (人群+关键词) × 100%。和上面那个加起来 = 100%。' },
  video_spend:  { label: '短视频推广花费',   tip: '内容报表「短视频」类型花费（fact_wxst_content WHERE content_type=短视频）。万象台后台是单独 tab，不在商品报表里。包含光合、达人内容推广。' },
  total_paid:   { label: '总投放',           tip: '总投放 = 商品报表(人群+关键词) + 内容报表(短视频)。如果只想看「淘宝平台广告」口径，看「类目拆分额」（=商品报表）；带短视频的看「总投放」。' },

  // ── 单品视图 / 多品对比 ──
  gmv:          { label: '成交金额',         tip: '商品维度：生意参谋商品报表「支付金额」，与店铺报表口径一致（含退款前）。' },
  vis:          { label: '访客数 UV',        tip: '商品报表「访客数」，同一买家同一天访问同一商品多次计1次。' },
  conv_rate:    { label: '转化率',           tip: '支付件数 ÷ 访客数 × 100%。与加购率的区别：这里是真实下单，不含仅加购未购买。' },
  new_buyers:   { label: '新客数',           tip: '商品报表「新客数」，该周期内首次购买该商品的买家数量。衡量拉新效果。' },
  refund:       { label: '退款金额',         tip: '商品报表「退款金额」，已申请退款（含未完成退款）的金额，可能滞后1-3天体现。' },
  pv:           { label: '浏览量 PV',        tip: '商品页面总浏览次数（含同一买家多次浏览），PV/UV 即人均浏览次数。' },
  dwell_time:   { label: '停留时长',         tip: '访客在商品详情页的平均停留秒数，反映详情页内容吸引力。来源：生意参谋商品报表。' },
  bounce_rate:  { label: '跳出率',           tip: '仅浏览商品页但未产生任何互动（加购/收藏/下单）即离开的访客占比。越低越好。' },
  fav_cart_users:{ label: '收藏加购人数',    tip: '产生收藏或加购行为的去重人数（不是件数）。衡量深度意向用户规模。' },
  search_vis:   { label: '搜索引导UV',       tip: '通过淘宝搜索进入商品页的访客数，反映搜索自然流量权重。' },
  xhs_inter:    { label: '小红书互动量',     tip: '小红书笔记「点赞+收藏+评论」总互动数，衡量内容种草效果。非淘系数据，手动录入。' },

  // ── 效果分析 ──
  action_effect:{ label: '运营动作效果',     tip: '对比运营动作发生前后（各7天）的核心指标变化。基准期与观察期使用相同天数。' },
}

// 快速获取 tooltip HTML片段（用于各组件 inline 引用）
const metricTip = key => {
  const m = METRIC_TIPS[key]
  if (!m) return ''
  return `<span class="info-btn" style="margin-left:4px">?<span class="tooltip">${m.tip}</span></span>`
}
