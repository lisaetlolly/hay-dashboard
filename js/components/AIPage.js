// ── AIPage.js ────────────────────────────────────────────
// AI 分析页组件。使用全局解构的 Vue API（与其他组件保持一致）。

const AIPage = defineComponent({
  name: 'AIPage',
  props: ['start', 'end'],
  setup(props) {
    const setupError = ref('')
    try {

    const STORAGE_KEY = 'hay_ai_settings_v1'
    const defaultConfig = {
      provider: 'openai-compatible',
      model: 'gpt-4.1-mini',
      apiBase: 'https://api.openai.com/v1',
      apiKey: '',
      systemPrompt: '你是 HAY 家居品牌运营分析助手。请基于提供的商品数据、投放数据、运营动作记录，输出简明、专业、可执行的业务建议。分析时优先关注ROI异常、趋势拐点、类目机会，建议要具体到商品名称和可操作步骤。',
    }
    const aiConfig = ref({ ...defaultConfig })
    const configSavedAt = ref('')
    const showApiKey = ref(false)

    const loadConfig = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return
        aiConfig.value = { ...defaultConfig, ...JSON.parse(raw) }
      } catch (e) {}
    }
    const saveConfig = () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(aiConfig.value))
      configSavedAt.value = new Date().toLocaleString()
    }
    const resetConfig = () => {
      aiConfig.value = { ...defaultConfig }
      saveConfig()
    }
    onMounted(loadConfig)

    // ── 数据摘要卡片（本地计算，无需 API Key）──────────────────
    const insights = computed(() => {
      const fmtM = v => v >= 10000 ? '¥' + (v / 10000).toFixed(1) + '万' : '¥' + Math.round(v).toLocaleString()
      const pct = v => v != null ? v.toFixed(2) + '%' : '—'
      const s = props.start, e = props.end
      if (!s || !e) return []

      const rows = Object.values(RAW.products || {}).map(p => {
        let gmv = 0, spend = 0, ctrS = 0, ctrN = 0, collect = 0, vis = 0, cart = 0
        for (let i = 0; i < p.dates.length; i++) {
          const d = p.dates[i]
          if (d >= s && d <= e) {
            gmv += p.pay?.[i] || 0
            spend += p.spend?.[i] || 0
            collect += (p.collect?.[i] || 0)
            cart += p.cart?.[i] || 0
            vis += p.vis?.[i] || 0
            if ((p.ctr?.[i] || 0) > 0) { ctrS += p.ctr[i] * 100; ctrN++ }
          }
        }
        const roi = spend > 0 ? gmv / spend : null
        const ctr = ctrN ? ctrS / ctrN : null
        const cartRate = vis > 0 ? cart / vis * 100 : null
        return { name: p.name, pid: p.pid, cat: p.cat, gmv, spend, roi, ctr, cartRate, collect, cart, vis }
      }).filter(r => r.gmv > 0 || r.spend > 0)

      if (!rows.length) return []

      const totalGmv = rows.reduce((acc, r) => acc + r.gmv, 0)
      const totalSpend = rows.reduce((acc, r) => acc + r.spend, 0)
      const sorted = [...rows].sort((a, b) => b.gmv - a.gmv)
      const top3 = sorted.slice(0, 3)
      const top3Share = top3.reduce((acc, r) => acc + r.gmv, 0) / (totalGmv || 1) * 100
      const results = []

      results.push({
        tag: '总览', color: '#1e40af',
        title: '周期整体：成交 ' + fmtM(totalGmv) + '，投放 ' + fmtM(totalSpend) + '，ROI ' + (totalSpend > 0 ? (totalGmv / totalSpend).toFixed(2) : '—'),
        text: '共 ' + rows.length + ' 个有数据商品。Top 3 商品（' + top3.map(r => r.name.split(' ')[0]).join('、') + '）占总成交额的 ' + top3Share.toFixed(0) + '%。'
      })

      if (top3.length) {
        results.push({
          tag: '明星品', color: '#16a34a',
          title: '成交额 TOP3：' + (top3[0]?.name.split(' ').slice(0, 2).join(' ') || '') + '、' + (top3[1]?.name.split(' ')[0] || '') + '、' + (top3[2]?.name.split(' ')[0] || ''),
          text: top3.map((r, i) => '#' + (i + 1) + ' ' + r.name.split(' ').slice(0, 2).join(' ') + ' — ' + fmtM(r.gmv) + (r.roi ? '，ROI ' + r.roi.toFixed(2) : '')).join('\n')
        })
      }

      const spendRows = rows.filter(r => r.spend > 500 && r.roi != null).sort((a, b) => a.roi - b.roi)
      if (spendRows.length) {
        const worst = spendRows[0]
        results.push({
          tag: 'ROI预警', color: '#dc2626',
          title: 'ROI偏低：' + worst.name.split(' ').slice(0, 2).join(' ') + ' ROI ' + worst.roi.toFixed(2),
          text: '花费 ' + fmtM(worst.spend) + '，成交 ' + fmtM(worst.gmv) + '，ROI ' + worst.roi.toFixed(2) + '。建议检查词包匹配度与素材点击率，或暂时降低预算测试效果。'
        })
      }

      const cartRows = rows.filter(r => r.cartRate != null).sort((a, b) => b.cartRate - a.cartRate)
      if (cartRows.length >= 2) {
        const best = cartRows[0], worstCart = cartRows[cartRows.length - 1]
        results.push({
          tag: '加购率', color: '#d97706',
          title: '加购率差异：' + best.name.split(' ')[0] + ' ' + pct(best.cartRate) + ' vs ' + worstCart.name.split(' ')[0] + ' ' + pct(worstCart.cartRate),
          text: '最高：' + best.name.split(' ').slice(0, 2).join(' ') + ' ' + pct(best.cartRate) + '，访客 ' + best.vis.toLocaleString() + ' 人。最低：' + worstCart.name.split(' ').slice(0, 2).join(' ') + ' ' + pct(worstCart.cartRate) + '，可检查详情页卖点与价格锚点。'
        })
      }

      const organicStars = rows.filter(r => r.spend < 100 && r.gmv > 5000).sort((a, b) => b.gmv - a.gmv)
      if (organicStars.length) {
        results.push({
          tag: '自然流', color: '#7c3aed',
          title: '自然流量贡献：' + organicStars.map(r => r.name.split(' ')[0]).slice(0, 3).join('、'),
          text: organicStars.slice(0, 3).map(r => r.name.split(' ').slice(0, 2).join(' ') + ' — 成交 ' + fmtM(r.gmv) + '，几乎无投放，可小预算测试放量潜力').join('\n')
        })
      }

      const ctrRows = rows.filter(r => r.ctr != null && r.spend > 200).sort((a, b) => a.ctr - b.ctr)
      if (ctrRows.length) {
        const lowCtr = ctrRows[0]
        results.push({
          tag: 'CTR优化', color: '#0891b2',
          title: 'CTR偏低：' + lowCtr.name.split(' ').slice(0, 2).join(' ') + ' CTR ' + pct(lowCtr.ctr),
          text: '当前 CTR ' + pct(lowCtr.ctr) + ' 在有投放商品中偏低，建议优先更新主图素材（增加场景感/对比图）、检查关键词匹配是否过于宽泛。'
        })
      }

      return results
    })

    // ── 一键分析模板 ───────────────────────────────────────────
    const ANALYSIS_TEMPLATES = [
      { key: 'focus_products', label: '今日重点品', color: '#1e40af', icon: '🎯',
        getPrompt: (s, e) => '基于当前周期（' + s + ' ~ ' + e + '）的数据，请分析本周期应重点关注的商品：\n1. 哪些商品成交额突出或正在增长，值得加大投放？\n2. 哪些商品ROI偏低但有潜力，需要策略调整？\n3. 哪些商品已连续下滑需要警觉？\n请列出3-5个重点品，每个给出1-2条具体行动建议。' },
      { key: 'best_actions', label: '最有效运营动作', color: '#16a34a', icon: '⚡',
        getPrompt: (s, e) => '根据 ' + s + ' ~ ' + e + ' 期间的运营动作记录和对应指标变化，请分析：\n1. 哪类运营动作（如主图更新、价格调整、词包优化等）带来了最显著的正向效果？\n2. 有没有某些动作执行后反而造成了下滑？\n3. 给出未来2周最值得复制的运营动作优先级排序。\n请结合具体商品案例说明。' },
      { key: 'task_dispatch', label: '任务派发建议', color: '#7c3aed', icon: '📋',
        getPrompt: (s, e) => '请基于 ' + s + ' ~ ' + e + ' 的数据表现，为运营团队生成本周任务派发建议：\n1. 紧急任务（需3天内完成）：ROI预警商品的投放调整\n2. 常规任务（本周完成）：低CTR商品的素材更新计划\n3. 优化任务（本周规划）：自然流表现好的商品扩量测试\n请以清单格式输出，每条任务包含：商品名、任务内容、预期目标、建议执行人角色。' },
      { key: 'competitor', label: '竞品分析', color: '#d97706', icon: '🔍',
        getPrompt: (s, e) => '请基于 ' + s + ' ~ ' + e + ' 的商品数据帮助分析竞争态势：\n1. 从我们的CTR和加购率数据推断，哪些品类可能面临较激烈竞争（流量成本高但转化低）？\n2. 哪些品类我们可能具有竞争优势（高ROI、高自然流）？\n3. 建议针对哪些品类加强竞争布局，针对哪些品类采取差异化策略？\n请给出具体的竞争应对策略建议。' },
      { key: 'strategy', label: '竞争策略', color: '#e11d48', icon: '🏆',
        getPrompt: (s, e) => '请根据 ' + s + ' ~ ' + e + ' 的整体数据，制定下一阶段的竞争策略：\n1. 资源聚焦：建议将80%预算集中在哪几个商品/类目，理由是什么？\n2. 防守策略：哪些商品需要维持现状、防止份额流失？\n3. 进攻机会：有没有低成本高回报的放量机会？\n4. 退出建议：哪些商品应该减少投放甚至暂停，释放预算？\n请给出优先级排序和可执行的策略路线图。' },
    ]

    // ── Chat ─────────────────────────────────────────────────
    const chatMessages = ref([])
    const chatInput = ref('')
    const chatLoading = ref(false)
    const chatError = ref('')
    const chatBoxRef = ref(null)

    const buildDataContext = () => {
      const fmtM = v => v >= 10000 ? '¥' + (v / 10000).toFixed(1) + '万' : '¥' + Math.round(v).toLocaleString()
      const s = props.start, e = props.end
      const rows = Object.values(RAW.products || {}).map(p => {
        let gmv = 0, spend = 0, vis = 0, cart = 0, ctrS = 0, ctrN = 0
        for (let i = 0; i < p.dates.length; i++) {
          const d = p.dates[i]
          if (d >= s && d <= e) {
            gmv += p.pay?.[i] || 0; spend += p.spend?.[i] || 0
            vis += p.vis?.[i] || 0; cart += p.cart?.[i] || 0
            if ((p.ctr?.[i] || 0) > 0) { ctrS += p.ctr[i] * 100; ctrN++ }
          }
        }
        const roi = spend > 0 ? +(gmv / spend).toFixed(2) : null
        const ctr = ctrN > 0 ? +(ctrS / ctrN).toFixed(2) : null
        const cartRate = vis > 0 ? +(cart / vis * 100).toFixed(2) : null
        return { name: p.name, cat: p.cat, gmv: +gmv.toFixed(0), spend: +spend.toFixed(0), vis, cart, roi, ctr, cartRate }
      }).filter(r => r.gmv > 0 || r.spend > 0)

      const totalGmv = rows.reduce((a, r) => a + r.gmv, 0)
      const totalSpend = rows.reduce((a, r) => a + r.spend, 0)

      const actions = (APP_STATE.value.actions || [])
        .filter(a => a.action_date && a.action_date >= s && a.action_date <= e)
        .sort((a, b) => b.action_date.localeCompare(a.action_date))
        .slice(0, 10)
      const actionSummary = actions.length
        ? '\n近期运营动作（' + actions.length + '条）：\n' + actions.map(a =>
          '- ' + a.action_date + ' [' + (a.action_type || '动作') + '] ' +
          (RAW.products?.[a.pid || a.pids?.[0]]?.name || a.pid || '全品') + ': ' +
          (a.note || a.content || '')).join('\n')
        : '\n近期无运营动作记录。'

      return '当前分析周期：' + s + ' ~ ' + e + '\n总成交额：' + fmtM(totalGmv) + '，总投放：' + fmtM(totalSpend) + '，整体ROI：' + (totalSpend > 0 ? (totalGmv / totalSpend).toFixed(2) : '—') +
        '\n商品数据（按成交额排序，前20）：\n' +
        rows.sort((a, b) => b.gmv - a.gmv).slice(0, 20).map(r =>
          '- ' + r.name + '（' + r.cat + '）：成交' + fmtM(r.gmv) + '，投放' + fmtM(r.spend) +
          '，UV ' + r.vis + '，加购' + r.cart + '，ROI ' + (r.roi ?? '—') +
          '，CTR ' + (r.ctr ?? '—') + '%，加购率 ' + (r.cartRate ?? '—') + '%'
        ).join('\n') + actionSummary
    }

    const runSSE = async (userText) => {
      if (!aiConfig.value.apiKey) { chatError.value = '请先在"AI 配置"中填写 API Key'; return }
      chatError.value = ''
      chatLoading.value = true
      const messages = [
        { role: 'system', content: aiConfig.value.systemPrompt + '\n\n' + buildDataContext() },
        ...chatMessages.value.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userText },
      ]
      chatMessages.value.push({ role: 'user', content: userText })
      const assistantIdx = chatMessages.value.length
      chatMessages.value.push({ role: 'assistant', content: '' })
      nextTick(() => { if (chatBoxRef.value) chatBoxRef.value.scrollTop = chatBoxRef.value.scrollHeight })

      try {
        const resp = await fetch(aiConfig.value.apiBase + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + aiConfig.value.apiKey },
          body: JSON.stringify({ model: aiConfig.value.model, messages, stream: true }),
        })
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + await resp.text())
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n'); buf = lines.pop()
          for (const line of lines) {
            const text = line.replace(/^data: /, '').trim()
            if (!text || text === '[DONE]') continue
            try {
              const delta = JSON.parse(text).choices?.[0]?.delta?.content
              if (delta) {
                chatMessages.value[assistantIdx].content += delta
                nextTick(() => { if (chatBoxRef.value) chatBoxRef.value.scrollTop = chatBoxRef.value.scrollHeight })
              }
            } catch {}
          }
        }
      } catch (err) {
        chatMessages.value[assistantIdx].content = '（请求失败：' + err.message + '）'
        chatError.value = err.message
      } finally {
        chatLoading.value = false
      }
    }

    const sendChat = async () => {
      const text = chatInput.value.trim()
      if (!text || chatLoading.value) return
      chatInput.value = ''
      await runSSE(text)
    }
    const clearChat = () => { chatMessages.value = []; chatError.value = '' }
    const injectInsight = item => { chatInput.value = '请就「' + item.title + '」给出更详细的分析和行动建议。' }
    const sendTemplate = async tpl => {
      if (chatLoading.value) return
      await runSSE(tpl.getPrompt(props.start, props.end))
    }

    return {
      setupError,
      aiConfig, configSavedAt, showApiKey, insights,
      saveConfig, resetConfig,
      ANALYSIS_TEMPLATES, sendTemplate,
      chatMessages, chatInput, chatLoading, chatError, chatBoxRef,
      sendChat, clearChat, injectInsight,
    }

    } catch(e) {
      setupError.value = e.message || String(e)
      return { setupError, aiConfig: ref({}), configSavedAt: ref(''), showApiKey: ref(false), insights: ref([]), saveConfig:()=>{}, resetConfig:()=>{}, ANALYSIS_TEMPLATES: [], sendTemplate:()=>{}, chatMessages: ref([]), chatInput: ref(''), chatLoading: ref(false), chatError: ref(''), chatBoxRef: ref(null), sendChat:()=>{}, clearChat:()=>{}, injectInsight:()=>{} }
    }
  },
  template: `
<div style="display:flex;flex-direction:column;gap:16px">
  <div v-if="setupError" style="padding:20px;background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;color:#dc2626;font-size:13px">
    AI 页面初始化失败：{{ setupError }}
  </div>
  <template v-else>
  <!-- AI 配置 -->
  <div class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:12px"><span class="card-title">AI 配置</span><span class="card-sub">配置存储在浏览器本地，不上传服务器</span></div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:12px">
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px">
        <span style="color:var(--muted)">模型名</span>
        <input v-model="aiConfig.model" placeholder="gpt-4.1-mini" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px">
        <span style="color:var(--muted)">API Base URL</span>
        <input v-model="aiConfig.apiBase" placeholder="https://api.openai.com/v1" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;grid-column:1/-1">
        <span style="color:var(--muted)">API Key <span style="color:#dc2626">*</span></span>
        <div style="display:flex;gap:8px;align-items:center">
          <input :type="showApiKey ? 'text' : 'password'" v-model="aiConfig.apiKey" placeholder="sk-..." style="flex:1;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px">
          <button @click="showApiKey=!showApiKey" style="border:1px solid var(--border);background:#fff;border-radius:8px;padding:7px 10px;font-size:11px;cursor:pointer;white-space:nowrap">{{ showApiKey ? '隐藏' : '显示' }}</button>
          <button @click="saveConfig" style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:7px 14px;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:600">保存</button>
        </div>
      </label>
    </div>
    <label style="display:flex;flex-direction:column;gap:6px;font-size:12px">
      <span style="color:var(--muted)">系统提示词</span>
      <textarea v-model="aiConfig.systemPrompt" rows="3" style="border:1px solid var(--border);border-radius:8px;padding:10px;font-size:12px;resize:vertical;font-family:inherit"></textarea>
    </label>
    <div style="font-size:11px;color:var(--muted);margin-top:8px">{{ configSavedAt ? '最近保存 ' + configSavedAt : '尚未保存（填写后点击保存）' }}</div>
  </div>

  <!-- 一键分析 -->
  <div class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:12px"><span class="card-title">一键分析</span><span class="card-sub">点击后自动附带当前周期完整数据发送给 AI</span></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
      <button v-for="tpl in ANALYSIS_TEMPLATES" :key="tpl.key" @click="sendTemplate(tpl)"
        :disabled="chatLoading"
        :style="{padding:'12px 14px',borderRadius:'12px',border:'1.5px solid',borderColor:tpl.color+'44',background:tpl.color+'0d',cursor:chatLoading?'default':'pointer',textAlign:'left',transition:'all 0.15s',opacity:chatLoading?0.6:1}">
        <div style="font-size:18px;margin-bottom:6px;line-height:1">{{ tpl.icon }}</div>
        <div :style="{fontSize:'13px',fontWeight:'700',marginBottom:'3px',color:tpl.color}">{{ tpl.label }}</div>
        <div style="font-size:10px;color:#94a3b8;line-height:1.4">AI 智能分析</div>
      </button>
    </div>
    <div v-if="!aiConfig.apiKey" style="margin-top:10px;padding:10px 14px;background:#fef3c7;border-radius:8px;font-size:12px;color:#92400e">
      请先填写 API Key 并保存，然后才能使用一键分析功能。
    </div>
  </div>

  <!-- 数据摘要 -->
  <div class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:12px"><span class="card-title">数据摘要</span><span class="card-sub">本地计算，无需 API Key；点击卡片可追问 AI</span></div>
    <div style="display:flex;flex-direction:column;gap:10px;max-height:340px;overflow:auto;padding-right:4px">
      <div v-for="(item,idx) in insights" :key="idx" @click="injectInsight(item)"
        style="padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:#fafaf9;cursor:pointer">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
          <span :style="{padding:'2px 8px',borderRadius:'99px',fontSize:'11px',fontWeight:'700',background:item.color+'18',color:item.color}">{{ item.tag }}</span>
          <div style="font-size:12px;font-weight:700;color:var(--text)">{{ item.title }}</div>
          <div style="margin-left:auto;font-size:10px;color:#cbd5e1">点击追问 →</div>
        </div>
        <div style="font-size:11px;color:var(--muted);line-height:1.8;white-space:pre-line">{{ item.text }}</div>
      </div>
      <div v-if="!insights.length" class="empty">当前时间范围暂无数据，请切换时间段</div>
    </div>
  </div>

  <!-- AI 对话 -->
  <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div>
        <div class="card-title">AI 对话</div>
        <div class="card-sub">实时流式对话；含当前周期商品数据 + 运营动作上下文</div>
      </div>
      <button @click="clearChat" style="border:1px solid var(--border);background:#fff;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;color:var(--muted)">清空对话</button>
    </div>

    <div v-if="chatMessages.length" ref="chatBoxRef"
      style="display:flex;flex-direction:column;gap:10px;max-height:480px;overflow-y:auto;padding:4px 2px">
      <div v-for="(msg,idx) in chatMessages" :key="idx"
        :style="{display:'flex',justifyContent:msg.role==='user'?'flex-end':'flex-start'}">
        <div :style="{maxWidth:'88%',padding:'10px 14px',borderRadius:msg.role==='user'?'14px 14px 4px 14px':'14px 14px 14px 4px',background:msg.role==='user'?'var(--accent)':'#f4f4f5',color:msg.role==='user'?'#fff':'var(--text)',fontSize:'13px',lineHeight:'1.7',whiteSpace:'pre-wrap',wordBreak:'break-word'}">
          <span v-if="chatLoading && idx===chatMessages.length-1 && msg.role==='assistant' && !msg.content" style="opacity:0.5">思考中…</span>
          <span v-else>{{ msg.content }}</span>
        </div>
      </div>
    </div>
    <div v-else style="padding:20px;text-align:center;color:var(--muted);font-size:12px">
      使用上方「一键分析」快速发起分析，或直接在下方输入问题
    </div>

    <div v-if="chatError" style="font-size:11px;color:var(--red);padding:4px 0">{{ chatError }}</div>

    <div style="display:flex;gap:8px;align-items:flex-end">
      <textarea v-model="chatInput" @keydown.enter.exact.prevent="sendChat"
        placeholder="输入问题，Enter 发送（Shift+Enter 换行）…"
        rows="2"
        style="flex:1;border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px;resize:none;outline:none;line-height:1.5;font-family:inherit"></textarea>
      <button @click="sendChat" :disabled="chatLoading || !chatInput.trim()"
        :style="{padding:'10px 18px',borderRadius:'10px',border:'none',cursor:chatLoading||!chatInput.trim()?'default':'pointer',background:chatLoading||!chatInput.trim()?'#e4e4e7':'var(--accent)',color:'#fff',fontSize:'13px',fontWeight:'600',flexShrink:0,transition:'background 0.15s'}">
        {{ chatLoading ? '…' : '发送' }}
      </button>
    </div>
  </div>
  </template>
</div>`
})
