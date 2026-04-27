// ── App.js ───────────────────────────────────────────────────
// 根组件，注册所有页面组件，管理路由切换。
// createApp(App).mount('#app') 保留在 dashboard.html 内联脚本（依赖 DOM #app 节点存在）。

const App = defineComponent({
  components: { OverviewPage, ProductsPage, ComparePage, ActionEffectPage, 'ai-page': AIPage, AdsPage, SettingsPage },
  setup() {
    const page        = ref('overview')
    const timePreset  = ref('30d')
    const startDate   = ref('2026-04-15')
    const endDate     = ref('2026-04-21')
    const lastUpdated = ref('')
    const pageViewCount = ref(0)
    const user = ref({ display_name: '', role: '' })

    // ── 登录 ──────────────────────────────────────────────────
    const loggedIn     = ref(false)
    const loginUsername = ref('')
    const loginPassword = ref('')
    const loginError   = ref('')
    const loginLoading = ref(false)

    const doLogin = async () => {
      if (!loginUsername.value || !loginPassword.value) return (loginError.value = '请输入用户名和密码')
      loginLoading.value = true; loginError.value = ''
      try {
        const res = await fetch('/api/users/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: loginUsername.value, password: loginPassword.value })
        })
        if (res.ok) {
          const u = await res.json()
          user.value = { display_name: u.display_name || u.username, role: u.role }
          const matched = (APP_STATE.value.users || []).find(x => x.display_name === u.display_name)
          if (matched) APP_STATE.value.currentUserId = matched.id
          sessionStorage.setItem('hay_user', JSON.stringify({ display_name: user.value.display_name, role: user.value.role, userId: APP_STATE.value.currentUserId }))
          loggedIn.value = true
        } else {
          const d = await res.json().catch(() => ({}))
          loginError.value = d.detail || '用户名或密码错误'
        }
      } catch { loginError.value = '服务器连接失败，请检查网络' }
      loginLoading.value = false
    }

    const logout = () => {
      sessionStorage.removeItem('hay_user')
      loggedIn.value = false
      loginUsername.value = ''; loginPassword.value = ''; loginError.value = ''
    }

    const navItems = [
      { id: 'overview', label: '总览' },
      { id: 'products', label: '单品视图' },
      { id: 'compare',  label: '多品对比' },
      { id: 'effect',   label: '效果分析' },
      { id: 'ai',       label: 'AI 分析' },
      { id: 'ads',      label: '投放面板' },
    ]
    const currentPageLabel = computed(
      () => navItems.find(n => n.id === page.value)?.label || '设置'
    )

    const DATA_END = RAW.data_end
    const LAUNCH_DATE = RAW.launch_date
    const fmt = d => (typeof d === 'string' ? d : d.toISOString().slice(0, 10))
    const sub = (base, n) => { const d = new Date(base); d.setDate(d.getDate() - n); return fmt(d) }

    // 当前周期的天数（用于前后平移）
    const periodDays = computed(() => {
      if (!startDate.value || !endDate.value) return 7
      const ms = new Date(endDate.value) - new Date(startDate.value)
      return Math.round(ms / 86400000) + 1
    })

    const presets = [
      { k:'7d', l:'7天' }, { k:'30d', l:'30天' },
      { k:'day', l:'日' }, { k:'week', l:'周' }, { k:'month', l:'月' },
      { k:'custom', l:'自定义' },
    ]

    const setPreset = (k) => {
      timePreset.value = k
      const today = new Date(DATA_END)
      if (k === '7d') {
        startDate.value = sub(today, 6); endDate.value = fmt(today)
      } else if (k === '30d') {
        startDate.value = sub(today, 29); endDate.value = fmt(today)
      } else if (k === 'day') {
        startDate.value = fmt(today); endDate.value = fmt(today)
      } else if (k === 'week') {
        const dow = today.getDay() || 7
        const mon = new Date(today); mon.setDate(today.getDate() - dow + 1)
        startDate.value = fmt(mon); endDate.value = fmt(today)
      } else if (k === 'month') {
        startDate.value = fmt(new Date(today.getFullYear(), today.getMonth(), 1))
        endDate.value = fmt(today)
      }
      // custom: do nothing, let user pick
    }

    const shiftPeriod = (dir) => {
      const days = periodDays.value
      const s = new Date(startDate.value)
      const e = new Date(endDate.value)
      s.setDate(s.getDate() + dir * days)
      e.setDate(e.getDate() + dir * days)
      timePreset.value = 'custom'
      startDate.value = fmt(s)
      endDate.value = fmt(e)
    }

    const applyPreset = () => setPreset(timePreset.value)

    onMounted(async () => {
      const savedSession = sessionStorage.getItem('hay_user')
      if (savedSession) { try { const u = JSON.parse(savedSession); user.value = { display_name: u.display_name, role: u.role }; if (u.userId) APP_STATE.value.currentUserId = u.userId; loggedIn.value = true } catch (_) {} }
      applyPreset()
      const h = await api('/api/health')
      if (h) lastUpdated.value = h.loaded_at || h.latest_date || '—'
      // 记录本次访问
      try {
        await fetch('/api/page-views', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page_path: '/' })
        })
      } catch (_) {}
      const pv = await api('/api/page-views/count', { page_path: '/' })
      if (pv) pageViewCount.value = pv.count || 0
    })

    return {
      page, timePreset, startDate, endDate, lastUpdated, pageViewCount,
      user, navItems, currentPageLabel, presets, setPreset, shiftPeriod, periodDays,
      loggedIn, loginUsername, loginPassword, loginError, loginLoading, doLogin, logout,
      onTimePreset: () => { if (timePreset.value !== 'custom') applyPreset() }
    }
  },
  template: `
<div style="height:100vh;width:100vw;overflow:hidden;position:fixed;inset:0">
  <div v-if="!loggedIn" style="display:flex;align-items:center;justify-content:center;height:100%;background:var(--bg)">
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:40px;min-width:320px;box-shadow:0 4px 24px rgba(0,0,0,.08)">
      <div style="font-size:26px;font-weight:700;letter-spacing:2px;margin-bottom:6px;color:var(--text)">HAY</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:28px">品牌数据中台 · 请登录</div>
      <div style="margin-bottom:14px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:5px">用户名</div>
        <input v-model="loginUsername" type="text" placeholder="请输入用户名" @keydown.enter="doLogin"
               style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text);outline:none">
      </div>
      <div style="margin-bottom:18px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:5px">密码</div>
        <input v-model="loginPassword" type="password" placeholder="请输入密码" @keydown.enter="doLogin"
               style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text);outline:none">
      </div>
      <div v-if="loginError" style="color:#e55;font-size:12px;margin-bottom:12px">{{ loginError }}</div>
      <button @click="doLogin" :disabled="loginLoading"
              style="width:100%;padding:10px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;font-weight:500;opacity:1"
              :style="{opacity:loginLoading?0.6:1}">
        {{ loginLoading ? '登录中…' : '登录' }}
      </button>
    </div>
  </div>
  <div v-else style="display:flex;height:100%;width:100%">
  <div id="sidebar">
    <div class="brand">HAY</div>
    <div class="nav">
      <div v-for="item in navItems" :key="item.id"
           class="nav-item" :class="{active: page===item.id}"
           @click="page=item.id">{{ item.label }}</div>
      <div class="nav-sep"></div>
      <div class="nav-item" :class="{active: page==='settings'}" @click="page='settings'">设置</div>
    </div>
    <div class="user-bar">
      <div class="avatar">{{ (user.display_name||'U')[0] }}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:500">{{ user.display_name }}</div>
        <div style="font-size:11px;color:var(--muted)">{{ user.role }}</div>
      </div>
      <button @click="logout" title="退出登录"
              style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:14px;padding:2px 4px;flex-shrink:0" >⏻</button>
    </div>
  </div>
  <div id="main">
    <div id="topbar" style="flex-wrap:nowrap">
      <div class="page-title" style="flex-shrink:0">{{ currentPageLabel }}</div>
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;overflow:hidden">
        <div style="display:flex;align-items:center;gap:0;border:1px solid var(--border);border-radius:6px;overflow:hidden;flex-shrink:0">
          <button v-for="p in presets" :key="p.k"
                  @click="setPreset(p.k)"
                  :style="{padding:'4px 10px',fontSize:'12px',border:'none',cursor:'pointer',
                    background:timePreset===p.k?'var(--accent)':'transparent',
                    color:timePreset===p.k?'#fff':'var(--muted)',
                    borderRight:'1px solid var(--border)'}">{{ p.l }}</button>
          <button @click="shiftPeriod(-1)"
                  :disabled="!['day','7d','week','month'].includes(timePreset)"
                  :style="{padding:'4px 8px',fontSize:'12px',border:'none',
                    cursor:['day','7d','week','month'].includes(timePreset)?'pointer':'default',
                    background:'transparent',
                    color:['day','7d','week','month'].includes(timePreset)?'var(--muted)':'var(--border)'}"
                  title="上一个周期">&lt;</button>
          <button @click="shiftPeriod(1)"
                  :disabled="!['day','7d','week','month'].includes(timePreset)"
                  :style="{padding:'4px 8px',fontSize:'12px',border:'none',
                    cursor:['day','7d','week','month'].includes(timePreset)?'pointer':'default',
                    background:'transparent',
                    color:['day','7d','week','month'].includes(timePreset)?'var(--muted)':'var(--border)'}"
                  title="下一个周期">&gt;</button>
        </div>
        <span v-if="timePreset==='custom'" style="display:flex;align-items:center;gap:4px;
              background:var(--surface);border:1px solid var(--accent);border-radius:6px;padding:3px 8px;flex-shrink:0">
          <input type="date" v-model="startDate"
                 style="border:none;outline:none;font-size:12px;background:transparent;color:var(--text);width:108px">
          <span style="color:var(--muted)">—</span>
          <input type="date" v-model="endDate"
                 style="border:none;outline:none;font-size:12px;background:transparent;color:var(--text);width:108px">
        </span>
        <span v-else style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          {{ timePreset==='day' ? startDate : startDate + ' ~ ' + endDate }}
        </span>
      </div>
      <div style="font-size:11px;color:var(--muted);white-space:nowrap;flex-shrink:0">更新 {{ lastUpdated || '—' }}</div>
      <div style="font-size:11px;color:var(--muted);white-space:nowrap;flex-shrink:0">访问 {{ pageViewCount }}</div>
    </div>
    <div id="content">
      <overview-page v-if="page==='overview'" :start="startDate" :end="endDate" :granularity="timePreset" />
      <products-page v-else-if="page==='products'" :start="startDate" :end="endDate" />
      <compare-page v-else-if="page==='compare'" :start="startDate" :end="endDate" />
      <action-effect-page v-else-if="page==='effect'" />
      <ai-page v-else-if="page==='ai'" :start="startDate" :end="endDate" />
      <ads-page v-else-if="page==='ads'" :start="startDate" :end="endDate" />
      <settings-page v-else-if="page==='settings'" />
      <div v-else class="empty" style="padding:80px">{{ currentPageLabel }} — 开发中</div>
    </div>
  </div>
  </div>
</div>`
})

