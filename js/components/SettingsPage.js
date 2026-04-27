// ── SettingsPage.js ─────────────────────────────────────
// 设置页组件。

const SettingsPage = defineComponent({
  name: 'SettingsPage',
  errorCaptured(err, instance, info) {
    console.error('[SettingsPage errorCaptured]', info, err.message, err.stack)
    return false
  },
  setup() {
    // Proxy ensures all state.X accesses always go through APP_STATE.value,
    // so the component stays in sync after syncStateFromServer replaces the object.
    const state = new Proxy({}, {
      get(_, prop) { return APP_STATE.value[prop] },
      set(_, prop, value) { APP_STATE.value[prop] = value; return true },
    })
    // ── 用户列表：从 DB 拉真实账号（之前用 localStorage 5 个假账号 u_admin/u_ops，和 DB 8 个真账号 admin/xiaodong/... 完全脱节）
    const dbUsers = Vue.ref([])
    const usersLoading = Vue.ref(false)
    const loadDbUsers = async () => {
      usersLoading.value = true
      try {
        const res = await fetch('/api/users')
        if (res.ok) {
          const list = await res.json()
          // 后端 user.id 是 INT；保留为字符串方便比对前端 currentUserId
          dbUsers.value = list.map(u => ({
            id: String(u.id),
            username: u.username,
            display_name: u.display_name,
            role: u.role,
            permissions: Array.isArray(u.permissions) ? u.permissions : [],
          }))
          // 把真实账号同步进 APP_STATE 让全站 me 计算用同一份
          state.users = dbUsers.value
          if (!state.currentUserId || !dbUsers.value.find(u => u.id === state.currentUserId)) {
            // 默认选 admin 账号
            const admin = dbUsers.value.find(u => u.username === 'admin') || dbUsers.value[0]
            if (admin) state.currentUserId = admin.id
          }
          persistAppState()
        }
      } catch (e) { console.warn('[loadDbUsers]', e) }
      usersLoading.value = false
    }
    Vue.onMounted(loadDbUsers)

    const me = Vue.computed(() => (state.users||[]).find(u=>u.id===state.currentUserId)||state.users?.[0])
    const users = Vue.computed(() => state.users||[])
    const metrics = Vue.computed(() => state.metricRegistry||[])
    const permGroups = Vue.computed(() => (state.permissionGroups||[]).filter(g => g && Array.isArray(g.perms)))
    const can = code => hasPermission(me.value, code)
    const PERM_LABELS = {
      'task.view_all':'查看全部任务','task.view_own':'查看自己任务','task.create':'新增任务',
      'task.edit_all':'编辑全部任务','task.edit_own':'编辑自己任务','task.delete':'删除任务',
      'product.view':'查看商品','product.create':'新增商品','product.edit':'编辑商品','product.delete':'删除商品',
      'meeting.view':'查看会议','meeting.create':'新增会议','meeting.edit':'编辑会议','meeting.delete':'删除会议',
      'action.view':'查看运营动作','action.create':'新增动作','action.edit':'编辑动作','action.delete':'删除动作',
      'metric.view':'查看指标','metric.create':'新增指标','metric.edit':'编辑指标','metric.delete':'删除指标',
      'user.view':'查看用户','user.create':'新增用户','user.edit':'编辑用户','user.delete':'删除用户',
      'permission.assign':'分配权限',
      'event.create':'新增事件','event.edit':'编辑事件','event.delete':'删除事件',
      'xhs.create':'新增小红书笔记','xhs.edit':'编辑小红书笔记','xhs.delete':'删除小红书笔记',
    }
    const expandedUserId = Vue.ref('')
    const toggleExpand = id => { expandedUserId.value = expandedUserId.value === id ? '' : id }
    const setMe = id => {
      state.currentUserId = id
      persistAppState()
      // 强制提示一下，避免用户以为切换没生效
      const u = (state.users||[]).find(x => x.id === id)
      if (u) {
        // 用 Vue.nextTick 等下一个 tick，确保 me.computed 已经响应新值
        Vue.nextTick(() => {
          const tag = document.getElementById('role-switch-toast')
          if (tag) {
            tag.textContent = `已切换到「${u.display_name}」(${u.role})`
            tag.style.opacity = '1'
            setTimeout(() => { tag.style.opacity = '0' }, 1800)
          }
        })
      }
    }

    // ── 用户 CRUD ──────────────────────────────────────────────
    const userModal = Vue.reactive({ show:false, mode:'', id:'', name:'', role:'member', username:'', password:'' })
    const openAddUser = () => {
      if (!can('user.create')) return alert('无新增用户权限')
      Object.assign(userModal, { show:true, mode:'add', id:'', name:'', role:'member', username:'', password:'' })
    }
    const openEditUser = u => {
      if (!can('user.edit')) return alert('无编辑用户权限')
      Object.assign(userModal, { show:true, mode:'edit', id:u.id, name:u.display_name, role:u.role||'member', username:u.username||'', password:'' })
    }
    const roleDefaultPerms = {
      admin:  ['*'],
      ops:    ['task.view_all','task.create','task.edit_all','meeting.view','meeting.create','meeting.edit','action.view','action.create','action.edit','metric.view','product.view'],
      member: ['task.view_all','task.view_own','task.edit_own','action.view','meeting.view','metric.view','product.view'],
      viewer: ['task.view_own','action.view','meeting.view','metric.view','product.view'],
    }
    const saveUserModal = async () => {
      if (!userModal.name.trim()) return alert('显示名不能为空')
      const defaultPerms = roleDefaultPerms[userModal.role] || roleDefaultPerms.member
      if (userModal.mode === 'add') {
        if (!userModal.username.trim()) return alert('登录账号不能为空')
        if (!userModal.password.trim()) return alert('初始密码不能为空')
        try {
          const res = await fetch('/api/users/register', { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ username: userModal.username.trim(), password: userModal.password.trim(),
              display_name: userModal.name.trim(), role: userModal.role }) })
          if (!res.ok) {
            const d = await res.json().catch(()=>({}))
            // 用户名已存在 → 提示但仍刷新列表（让用户看到已经存在的账号）
            await loadDbUsers()
            return alert(d.detail || '注册失败')
          }
        } catch { return alert('注册失败，请检查网络') }
        // 新建成功 → 重新拉真账号列表
        await loadDbUsers()
        userModal.show = false
        return
      } else {
        const u = state.users.find(x => x.id === userModal.id)
        if (u && /^\d+$/.test(u.id)) {
          const roleChanged = u.role !== userModal.role
          // 真账号 → 调 PATCH /api/users/{id} 落 DB
          try {
            const res = await fetch(`/api/users/${u.id}`, {
              method: 'PATCH', headers: {'Content-Type':'application/json'},
              body: JSON.stringify({
                display_name: userModal.name.trim(),
                role: userModal.role,
                username: userModal.username.trim(),
              }),
            })
            if (!res.ok) {
              const d = await res.json().catch(()=>({}))
              return alert(d.detail || '保存失败')
            }
          } catch (e) { return alert('保存失败：' + e.message) }
          // 改密码
          if (userModal.password.trim()) {
            await fetch(`/api/users/${u.id}/password`, {
              method:'PATCH', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ password: userModal.password.trim() })
            }).catch(()=>{})
          }
          // 角色变了，按新角色默认权限刷一下（DB 里的 permissions 也跟着变）
          if (roleChanged) {
            await fetch(`/api/users/${u.id}/permissions`, {
              method:'PATCH', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ permissions: defaultPerms }),
            }).catch(()=>{})
          }
        }
      }
      // 一律重新拉真账号列表，保证视图和 DB 一致
      await loadDbUsers()
      userModal.show = false
    }
    const deleteUser = async (u) => {
      if (!can('user.delete')) return alert('无删除用户权限')
      if (u.id === state.currentUserId) return alert('不能删除当前登录用户')
      if (!confirm(`确认删除「${u.display_name}」？`)) return
      // 真账号 → 调后端 DELETE
      if (/^\d+$/.test(u.id)) {
        try {
          const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE' })
          if (!res.ok) {
            const d = await res.json().catch(()=>({}))
            return alert(d.detail || '删除失败（后端可能未实现 DELETE 接口，要去 Neon 跑 SQL 删）')
          }
        } catch (e) { return alert('删除失败：' + e.message) }
      }
      await loadDbUsers()
    }
    const togglePerm = async (u, code) => {
      if (!can('permission.assign')) return alert('无权限分配权限')
      if ((u.permissions||[]).includes('*')) return alert('管理员拥有全部权限')
      const s = new Set(u.permissions || [])
      s.has(code) ? s.delete(code) : s.add(code)
      const newPerms = [...s]
      // 真账号（id 是数字字符串）→ 调 PATCH /api/users/{id}/permissions 落 DB
      const isRealUser = u.id && /^\d+$/.test(u.id)
      if (isRealUser) {
        try {
          const res = await fetch(`/api/users/${u.id}/permissions`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permissions: newPerms }),
          })
          if (!res.ok) {
            const err = await res.json().catch(()=>({detail:'保存失败'}))
            return alert('保存失败：' + (err.detail || res.status))
          }
          u.permissions = newPerms
          persistAppState()
        } catch (e) {
          alert('保存失败：' + e.message)
        }
      } else {
        // 旧 localStorage 账号（u_admin 等）—— 现在不应该再出现，但留个兼容
        u.permissions = newPerms
        persistAppState()
      }
    }

    // ── 指标 CRUD (Modal) ──────────────────────────────────────
    const metricModal = Vue.reactive({ show:false, mode:'', id:'', key:'', label:'', module:'overview', unit:'number', note:'' })
    const openAddMetric = () => {
      if (!can('metric.create')) return alert('无新增指标权限')
      Object.assign(metricModal, { show:true, mode:'add', id:'', key:'', label:'', module:'overview', unit:'number', note:'' })
    }
    const openEditMetric = m => {
      if (!can('metric.edit')) return alert('无编辑指标权限')
      Object.assign(metricModal, { show:true, mode:'edit', id:m.id, key:m.key, label:m.label, module:m.module||'overview', unit:m.unit||'number', note:m.note||'' })
    }
    const saveMetricModal = () => {
      if (!metricModal.label.trim()) return alert('指标名称不能为空')
      if (metricModal.mode === 'add') {
        const newKey = metricModal.key.trim() || 'new_metric'
        if (state.metricRegistry.find(m => m.key === newKey)) return alert('指标 Key「' + newKey + '」已存在，请修改')
        state.metricRegistry.unshift({ id:makeId('metric'), key:newKey, label:metricModal.label.trim(), module:metricModal.module, unit:metricModal.unit, note:metricModal.note })
      } else {
        const m = state.metricRegistry.find(x => x.id === metricModal.id)
        if (m) { m.label=metricModal.label.trim(); m.key=metricModal.key.trim(); m.module=metricModal.module; m.unit=metricModal.unit; m.note=metricModal.note }
      }
      persistAppState(); metricModal.show = false
    }
    const deleteMetric = m => {
      if (!can('metric.delete')) return alert('无删除指标权限')
      if (!confirm('确认删除该指标？')) return
      state.metricRegistry=state.metricRegistry.filter(x=>x.id!==m.id); persistAppState()
    }

    // ── 会议 CRUD (Modal) ──────────────────────────────────────
    const meetings = Vue.computed(() => state.meetings||[])
    const meetingModal = Vue.reactive({ show:false, mode:'', id:'', title:'', date:'', week:'', content:'' })
    const openAddMeeting = () => {
      if (!can('meeting.create')) return alert('无新增会议权限')
      Object.assign(meetingModal, { show:true, mode:'add', id:'', title:'运营周会', date:new Date().toISOString().slice(0,10), week:'', content:'' })
    }
    const openEditMeeting = m => {
      if (!can('meeting.edit')) return alert('无编辑会议权限')
      Object.assign(meetingModal, { show:true, mode:'edit', id:m.id, title:m.title, date:m.meeting_date||'', week:m.week_label||'', content:m.content||'' })
    }
    const saveMeetingModal = () => {
      if (!meetingModal.title.trim()) return alert('会议标题不能为空')
      if (meetingModal.mode === 'add') {
        state.meetings.unshift({ id:Date.now(), title:meetingModal.title.trim(), meeting_date:meetingModal.date, week_label:meetingModal.week, content:meetingModal.content, important_level:'normal' })
      } else {
        const m = state.meetings.find(x => x.id === meetingModal.id)
        if (m) { m.title=meetingModal.title.trim(); m.content=meetingModal.content; m.meeting_date=meetingModal.date; m.week_label=meetingModal.week }
      }
      persistAppState(); meetingModal.show = false
    }
    const deleteMeeting = m => {
      if (!can('meeting.delete')) return alert('无删除会议权限')
      if (!confirm('确认删除？')) return
      state.meetings=state.meetings.filter(x=>x.id!==m.id); persistAppState()
    }

    // ── 人群投放品类计划（admin 可改）─────────────────────────
    const audiencePlan = Vue.ref([])           // [{category, plan_pct, sort_order}, ...]
    const audiencePlanLoading = Vue.ref(false)
    const audiencePlanSaving  = Vue.ref(false)
    const audiencePlanMsg     = Vue.ref('')

    const loadAudiencePlan = async () => {
      audiencePlanLoading.value = true
      try {
        const res = await fetch('/api/settings/audience-plan')
        if (res.ok) {
          const data = await res.json()
          // 保证 4 行齐全
          const byCat = {}
          for (const r of data || []) byCat[r.category] = r
          audiencePlan.value = ['家具','配饰','灯具','其他'].map((c, i) => ({
            category: c,
            plan_pct: byCat[c]?.plan_pct ?? ({家具:63, 配饰:30, 灯具:5, 其他:2}[c]),
            sort_order: byCat[c]?.sort_order ?? (i+1)*10,
          }))
        }
      } catch (e) { audiencePlanMsg.value = '加载失败：' + e.message }
      audiencePlanLoading.value = false
    }
    const audiencePlanTotal = Vue.computed(() =>
      audiencePlan.value.reduce((a,b)=>a+(+b.plan_pct||0), 0).toFixed(1)
    )
    const saveAudiencePlan = async () => {
      if (!can('metric.edit') && !((me.value?.permissions||[]).includes('*'))) {
        return alert('无修改人群品类计划权限（需要 admin）')
      }
      audiencePlanSaving.value = true
      audiencePlanMsg.value = ''
      try {
        const res = await fetch('/api/settings/audience-plan', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: audiencePlan.value.map(r => ({ category: r.category, plan_pct: +r.plan_pct })),
            updated_by: me.value?.display_name || ''
          })
        })
        const out = await res.json()
        if (res.ok) {
          audiencePlanMsg.value = out.warning ? `已保存（注意：${out.warning}）` : '已保存'
          setTimeout(() => { audiencePlanMsg.value = '' }, 3000)
        } else {
          audiencePlanMsg.value = '保存失败：' + (out.detail || res.status)
        }
      } catch (e) { audiencePlanMsg.value = '保存失败：' + e.message }
      audiencePlanSaving.value = false
    }
    const resetAudiencePlanDefault = () => {
      audiencePlan.value = [
        { category:'家具', plan_pct:63, sort_order:10 },
        { category:'配饰', plan_pct:30, sort_order:20 },
        { category:'灯具', plan_pct:5,  sort_order:30 },
        { category:'其他', plan_pct:2,  sort_order:40 },
      ]
    }
    Vue.onMounted(loadAudiencePlan)

    // ── 数据导出/导入 ─────────────────────────────────────────
    const exportState = () => {
      const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'})
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob)
      a.download='hay_dashboard_state_'+new Date().toISOString().slice(0,10)+'.json'; a.click()
    }
    const importState = () => {
      const inp=document.createElement('input'); inp.type='file'; inp.accept='.json'
      inp.onchange=e=>{
        const file=e.target.files[0]; if(!file) return
        const reader=new FileReader()
        reader.onload=ev=>{
          try {
            const data=JSON.parse(ev.target.result)
            Object.assign(APP_STATE.value,data); persistAppState()
            alert('导入成功，刷新页面生效')
          } catch { alert('文件格式错误') }
        }
        reader.readAsText(file)
      }
      inp.click()
    }

    // ── 商品 CRUD ──────────────────────────────────────────────
    const allProductsForManage = Vue.computed(() => {
      const hidden = new Set(state.hiddenPids || [])
      const overrides = state.productOverrides || {}
      const custom = state.customProducts || []
      const base = Object.values(RAW.products || {}).map(p => ({
        pid: p.pid, name: overrides[p.pid]?.name || p.name, cat: overrides[p.pid]?.cat || p.cat,
        isCustom: false, hidden: hidden.has(p.pid)
      }))
      const cust = custom.map(p => ({
        pid: p.pid, name: overrides[p.pid]?.name || p.name, cat: overrides[p.pid]?.cat || p.cat,
        isCustom: true, hidden: hidden.has(p.pid)
      }))
      return [...base, ...cust].sort((a,b) => a.name.localeCompare(b.name))
    })
    const productModal = Vue.reactive({ show:false, mode:'', pid:'', newPid:'', name:'', cat:'配饰', isCustom:false, imageUrl:'' })
    const openAddProduct = () => {
      if (!can('product.create')) return alert('无新增商品权限')
      Object.assign(productModal, { show:true, mode:'add', pid:'', newPid:'', name:'', cat:'配饰', isCustom:true, imageUrl:'' })
    }
    const openEditProduct = p => {
      if (!can('product.edit')) return alert('无编辑商品权限')
      const imgUrl = (state.imageOverrides || {})[p.pid] || ''
      Object.assign(productModal, { show:true, mode:'edit', pid:p.pid, newPid:p.pid, name:p.name, cat:p.cat, isCustom:!!p.isCustom, imageUrl:imgUrl })
    }
    const saveProductModal = () => {
      if (!productModal.name.trim()) return alert('商品名不能为空')
      if (productModal.mode === 'add') {
        if (!productModal.pid.trim()) return alert('商品ID不能为空')
        if ((state.customProducts||[]).find(p => p.pid === productModal.pid)) return alert('该商品ID已存在')
        if (!state.customProducts) state.customProducts = []
        state.customProducts.push({ pid: productModal.pid.trim(), name: productModal.name.trim(), cat: productModal.cat, dates:[], pay:[], vis:[], cart:[], spend:[], refund:[], collect:[], ctr:[], roi:[], new_buyers:[] })
      } else {
        const newPid = productModal.newPid.trim()
        if (!newPid) return alert('商品ID不能为空')
        if (!state.productOverrides) state.productOverrides = {}
        if (productModal.isCustom && newPid !== productModal.pid) {
          const cp = (state.customProducts||[]).find(p => p.pid === productModal.pid)
          if (cp) { cp.pid = newPid; cp.name = productModal.name.trim(); cp.cat = productModal.cat }
          delete state.productOverrides[productModal.pid]
          if (!state.pidRemaps) state.pidRemaps = {}
          state.pidRemaps[productModal.pid] = newPid
        } else {
          state.productOverrides[productModal.pid] = { name: productModal.name.trim(), cat: productModal.cat }
        }
      }
      if (!state.imageOverrides) state.imageOverrides = {}
      const targetPid = productModal.mode === 'add' ? productModal.pid.trim() : productModal.newPid.trim()
      if (productModal.imageUrl.trim()) state.imageOverrides[targetPid] = productModal.imageUrl.trim()
      else delete state.imageOverrides[targetPid]
      persistAppState(); productModal.show = false
    }
    const toggleHideProduct = pid => {
      if (!can('product.delete')) return alert('无删除商品权限')
      if (!state.hiddenPids) state.hiddenPids = []
      const idx = state.hiddenPids.indexOf(pid)
      if (idx >= 0) state.hiddenPids.splice(idx, 1)
      else state.hiddenPids.push(pid)
      persistAppState()
    }
    const deleteCustomProduct = pid => {
      if (!can('product.delete')) return alert('无删除商品权限')
      if (!confirm('确认删除该自定义商品？')) return
      state.customProducts = (state.customProducts||[]).filter(p => p.pid !== pid)
      if (state.productOverrides) delete state.productOverrides[pid]
      persistAppState()
    }

    // ── 运营动作 CRUD ──────────────────────────────────────────
    const actions = Vue.computed(() => state.actions || [])
    const ACTION_TYPES = ['主图更新','价格调整','词包优化','直播推广','达人合作','活动报名','详情页优化','货品补充','其他']
    const actionModal = Vue.reactive({ show:false, mode:'', id:'', action_type:'主图更新', action_date:new Date().toISOString().slice(0,10), pid:'', note:'' })
    const openAddAction = () => {
      if (!can('action.create')) return alert('无新增动作权限')
      Object.assign(actionModal, { show:true, mode:'add', id:'', action_type:'主图更新', action_date:new Date().toISOString().slice(0,10), pid:'', note:'' })
    }
    const openEditAction = a => {
      if (!can('action.edit')) return alert('无编辑动作权限')
      Object.assign(actionModal, { show:true, mode:'edit', id:a.id, action_type:a.action_type||'其他', action_date:a.action_date||'', pid:a.pid||'', note:a.note||a.content||'' })
    }
    const saveActionModal = () => {
      if (!actionModal.action_date) return alert('请选择执行日期')
      if (!state.actions) state.actions = []
      if (actionModal.mode === 'add') {
        state.actions.unshift({ id:makeId('action'), action_type:actionModal.action_type, action_date:actionModal.action_date, pid:actionModal.pid, note:actionModal.note, pids:actionModal.pid ? [actionModal.pid] : [] })
      } else {
        const a = state.actions.find(x => x.id === actionModal.id)
        if (a) { a.action_type=actionModal.action_type; a.action_date=actionModal.action_date; a.pid=actionModal.pid; a.note=actionModal.note; a.pids=actionModal.pid ? [actionModal.pid] : [] }
      }
      persistAppState(); actionModal.show = false
    }
    const deleteAction = a => {
      if (!can('action.delete')) return alert('无删除动作权限')
      if (!confirm('确认删除该运营动作？')) return
      state.actions = (state.actions||[]).filter(x => x.id !== a.id); persistAppState()
    }

    // ── 手工数据录入 ─────────────────────────────────────────
    const manualInputPid = Vue.ref('')
    const manualInputDate = Vue.ref(new Date().toISOString().slice(0,10))
    const manualInputFields = Vue.reactive({ pay:'', vis:'', cart:'', spend:'', refund:'', collect:'' })
    const manualProductOptions = Vue.computed(() => Object.values(RAW.products || {}).map(p => ({ pid:p.pid, name:p.name })).concat((state.customProducts||[]).map(p=>({pid:p.pid,name:p.name}))))
    const saveManualData = () => {
      if (!manualInputPid.value || !manualInputDate.value) return alert('请选择商品和日期')
      if (!state.manualDailyData) state.manualDailyData = {}
      if (!state.manualDailyData[manualInputPid.value]) state.manualDailyData[manualInputPid.value] = {}
      const entry = {}
      if (manualInputFields.pay !== '') entry.pay = parseFloat(manualInputFields.pay) || 0
      if (manualInputFields.vis !== '') entry.vis = parseFloat(manualInputFields.vis) || 0
      if (manualInputFields.cart !== '') entry.cart = parseFloat(manualInputFields.cart) || 0
      if (manualInputFields.spend !== '') entry.spend = parseFloat(manualInputFields.spend) || 0
      if (manualInputFields.refund !== '') entry.refund = parseFloat(manualInputFields.refund) || 0
      if (manualInputFields.collect !== '') entry.collect = parseFloat(manualInputFields.collect) || 0
      state.manualDailyData[manualInputPid.value][manualInputDate.value] = entry
      persistAppState()
      alert('已保存！')
    }

    // ── AI 配置（从 AIPage 搬过来）─────────────────────────
    const PRESETS_KEY  = 'hay_ai_presets_v2'
    const aiDefaultConfig = {
      id: 'preset_default', name: '默认',
      provider: 'openai-compatible',
      model: 'gpt-4.1-mini',
      apiBase: 'https://api.openai.com/v1',
      apiKey: '',
      systemPrompt: '你是 HAY 家居品牌运营分析助手。请基于提供的商品数据、投放数据、运营动作记录，输出简明、专业、可执行的业务建议。分析时优先关注ROI异常、趋势拐点、类目机会，建议要具体到商品名称和可操作步骤。',
    }
    const aiConfig = Vue.ref({ ...aiDefaultConfig })
    const aiSavedAt = Vue.ref('')
    const aiShowKey = Vue.ref(false)
    const loadAiConfig = () => {
      try {
        const presetsRaw = localStorage.getItem(PRESETS_KEY)
        if (presetsRaw) {
          const data = JSON.parse(presetsRaw)
          const active = (data.presets || []).find(p => p.id === data.activeId) || (data.presets || [])[0]
          if (active) aiConfig.value = { ...aiDefaultConfig, ...active }
        }
      } catch {}
    }
    const saveAiConfig = () => {
      const data = { activeId: aiConfig.value.id || 'preset_default', presets: [aiConfig.value] }
      localStorage.setItem(PRESETS_KEY, JSON.stringify(data))
      aiSavedAt.value = new Date().toLocaleString()
      // 触发其他 tab 的 AIPage 重新加载
      try {
        window.dispatchEvent(new StorageEvent('storage', { key: PRESETS_KEY }))
      } catch {}
    }
    const resetAiConfig = () => {
      if (!confirm('恢复默认配置？API Key 会清空。')) return
      aiConfig.value = { ...aiDefaultConfig }
      saveAiConfig()
    }
    Vue.onMounted(loadAiConfig)

    return {
      me,users,metrics,permGroups,PERM_LABELS,expandedUserId,toggleExpand,meetings,can,setMe,
      userModal,openAddUser,openEditUser,saveUserModal,deleteUser,togglePerm,
      metricModal,openAddMetric,openEditMetric,saveMetricModal,deleteMetric,
      meetingModal,openAddMeeting,openEditMeeting,saveMeetingModal,deleteMeeting,
      actions,ACTION_TYPES,actionModal,openAddAction,openEditAction,saveActionModal,deleteAction,
      exportState,importState,
      // 人群投放品类计划
      audiencePlan, audiencePlanLoading, audiencePlanSaving, audiencePlanMsg, audiencePlanTotal,
      saveAudiencePlan, resetAudiencePlanDefault, loadAudiencePlan,
      // AI 配置
      aiConfig, aiSavedAt, aiShowKey, saveAiConfig, resetAiConfig,
      allProductsForManage,productModal,openAddProduct,openEditProduct,saveProductModal,toggleHideProduct,deleteCustomProduct,
      manualInputPid,manualInputDate,manualInputFields,manualProductOptions,saveManualData,
      productNameByPid: pid => RAW.products?.[pid]?.name || pid,
      ...(() => {
        // ── 数据底表导入 ──────────────────────────────────────
        const importFiles = Vue.ref([])
        const importStatus = Vue.ref('')
        const importLoading = Vue.ref(false)
        const onImportFilesChange = e => { importFiles.value = Array.from(e.target.files||[]) }
        const pickImportFiles = () => {
          const inp = document.createElement('input')
          inp.type='file'; inp.multiple=true; inp.accept='.xls,.xlsx,.csv'
          inp.onchange = onImportFilesChange
          inp.click()
        }
        const runImport = async () => {
          if (!importFiles.value.length) return alert('请先选择文件')
          importLoading.value = true; importStatus.value = '上传中…'
          try {
            const fd = new FormData()
            importFiles.value.forEach(f => fd.append('files', f))
            const res = await fetch('/api/refresh-data', { method:'POST', body:fd })
            const data = await res.json()
            if (res.ok) {
              importStatus.value = `✓ 导入成功！data_end=${data.data_end||'—'}  ${data.syzt||0} 行生意参谋 · ${data.wxst||0} 行推广报表`
              importFiles.value = []
            } else {
              importStatus.value = `✗ 失败：${data.detail||res.statusText}`
            }
          } catch(e) { importStatus.value = `✗ 网络错误：${e.message}` }
          importLoading.value = false
        }
        return { importFiles, importStatus, importLoading, pickImportFiles, runImport }
      })(),
    }
  },
  template: `
<div style="display:flex;flex-direction:column;gap:16px">
  <!-- 当前用户切换 -->
  <div class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:10px"><span class="card-title">当前角色</span><span class="card-sub">前端测试用：切换后页面 can(...) 权限即时生效；服务器接口仍按真实登录账号校验</span></div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <select :value="me?.id" @change="setMe($event.target.value)" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;background:#fff">
        <option v-for="u in (users || [])" :key="u.id" :value="u.id">{{ u.display_name }}（{{ u.role }}）</option>
      </select>
      <span style="font-size:11px;color:#16a34a;font-weight:600">当前：{{ me?.display_name }} · {{ me?.role }} · {{ (me?.permissions||[]).includes('*') ? '全部权限' : ((me?.permissions||[]).length + ' 项权限') }}</span>
      <span id="role-switch-toast" style="font-size:11px;background:#dcfce7;color:#166534;padding:4px 10px;border-radius:99px;opacity:0;transition:opacity 0.3s"></span>
      <div style="display:flex;gap:8px;margin-left:auto">
        <button @click="exportState" style="border:1px solid var(--border);background:#fff;border-radius:8px;padding:7px 12px;font-size:12px;cursor:pointer">导出配置 JSON</button>
        <button @click="importState" style="border:1px solid var(--border);background:#fff;border-radius:8px;padding:7px 12px;font-size:12px;cursor:pointer">导入配置 JSON</button>
      </div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
    <!-- 用户与权限 -->
    <div class="card" style="padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div><span class="card-title">用户权限管理</span><span class="card-sub">{{ users.length }} 个用户</span></div>
        <button @click="openAddUser" style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;font-weight:600">+ 新增用户</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:0;border:1px solid var(--border);border-radius:12px;overflow:hidden">
        <div style="display:grid;grid-template-columns:1fr 80px 1fr 100px;gap:0;padding:8px 14px;background:#f8f8f7;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--muted)">
          <div>用户名</div><div>角色</div><div>权限概览</div><div style="text-align:right">操作</div>
        </div>
        <div v-for="(u, ui) in (users || [])" :key="u.id">
          <div :style="{display:'grid',gridTemplateColumns:'1fr 80px 1fr 100px',gap:'0',padding:'10px 14px',
            background:expandedUserId===u.id?'#f4f4f5':'#fff',
            borderBottom: ui<users.length-1 || expandedUserId===u.id ? '1px solid var(--border)' : 'none',
            alignItems:'center',cursor:'pointer'}"
            @click="toggleExpand(u.id)">
            <div>
              <div style="font-size:13px;font-weight:600">{{ u.display_name }}</div>
              <div v-if="expandedUserId===u.id" style="font-size:10px;color:var(--accent);margin-top:1px">▲ 收起权限</div>
              <div v-else style="font-size:10px;color:var(--muted);margin-top:1px">▼ 展开权限</div>
            </div>
            <div style="font-size:11px;color:var(--muted)">
              <span :style="{padding:'2px 8px',borderRadius:'99px',fontSize:'11px',background:u.role==='admin'?'#fef3c7':u.role==='ops'?'#dbeafe':'#f3f4f6',color:u.role==='admin'?'#92400e':u.role==='ops'?'#1e40af':'#52525b',fontWeight:'600'}">
                {{ u.role==='admin'?'管理员':u.role==='ops'?'运营':u.role==='viewer'?'只读':'成员' }}
              </span>
            </div>
            <div style="font-size:11px;color:var(--muted)">
              <span v-if="(u.permissions||[]).includes('*')" style="color:#16a34a;font-weight:600">全部权限</span>
              <span v-else>{{ (u.permissions||[]).length }} 项权限已开启</span>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:6px" @click.stop>
              <button @click="openEditUser(u)" style="border:1px solid var(--border);background:#fff;border-radius:7px;padding:4px 10px;font-size:11px;cursor:pointer">修改</button>
              <button @click="deleteUser(u)" style="border:1px solid #fecaca;background:#fff;color:#dc2626;border-radius:7px;padding:4px 10px;font-size:11px;cursor:pointer">删除</button>
            </div>
          </div>
          <div v-if="expandedUserId===u.id" style="padding:14px;background:#fafaf9;border-bottom:1px solid var(--border)">
            <div v-if="(u.permissions||[]).includes('*')" style="font-size:12px;color:#16a34a;font-weight:600;padding:4px 0">
              ✓ 管理员 — 拥有全部权限，无需单独配置
            </div>
            <div v-else>
              <div style="font-size:11px;color:var(--muted);margin-bottom:10px">点击权限项开关 / 关闭，修改实时保存</div>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
                <div v-for="g in (permGroups || [])" :key="g.key" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px">
                  <div style="font-size:11px;font-weight:700;margin-bottom:8px;color:var(--text)">{{ g.label }}</div>
                  <div style="display:flex;flex-direction:column;gap:5px">
                    <label v-for="p in (g && g.perms || [])" :key="p" style="display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer">
                      <span style="font-size:11px;color:var(--muted)">{{ PERM_LABELS[p] || p }}</span>
                      <span :style="{display:'inline-flex',alignItems:'center',width:'32px',height:'18px',borderRadius:'99px',padding:'2px',cursor:'pointer',flexShrink:'0',background:(u.permissions||[]).includes(p)?'var(--accent)':'#d1d5db',transition:'background 0.15s'}"
                        @click="togglePerm(u,p)">
                        <span :style="{display:'block',width:'14px',height:'14px',borderRadius:'50%',background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,.2)',transform:(u.permissions||[]).includes(p)?'translateX(14px)':'translateX(0)',transition:'transform 0.15s'}"></span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:16px">
      <!-- 指标配置 -->
      <div class="card" style="padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div><span class="card-title">指标配置</span><span class="card-sub">元数据登记表（key/label/口径说明）</span></div>
          <button @click="openAddMetric" style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer">新增指标</button>
        </div>
        <div style="font-size:11px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;margin-bottom:10px;line-height:1.6">
          ⚠️ <strong>当前是登记表</strong>：在这里加/删指标只改 metricRegistry（前端 localStorage），<strong>不影响</strong>总览/单品/投放面板上实际显示的指标——那些是在各页组件里硬编码的。
          <br/>下版本接通：让这里的列表驱动各页面的指标卡片选择 + tooltip 来源。
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:240px;overflow:auto">
          <div v-for="m in (metrics || [])" :key="m.id" @click="openEditMetric(m)"
            style="padding:10px;border:1px solid var(--border);border-radius:10px;background:#fafaf9;cursor:pointer;transition:border-color .15s"
            :style="{'border-color':'var(--border)'}" @mouseenter="$event.currentTarget.style.borderColor='var(--accent)'" @mouseleave="$event.currentTarget.style.borderColor='var(--border)'">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
              <div style="font-size:12px;font-weight:700">{{ m.label }}</div>
              <div style="display:flex;gap:5px" @click.stop>
                <button @click="deleteMetric(m)" style="border:1px solid #fecaca;background:#fff;color:#dc2626;border-radius:6px;padding:3px 7px;font-size:11px;cursor:pointer">删除</button>
              </div>
            </div>
            <div style="font-size:10px;color:var(--muted)">key: {{ m.key }} · 模块: {{ m.module }} · 单位: {{ m.unit }}</div>
            <div v-if="m.note" style="font-size:10px;color:var(--muted)">{{ m.note }}</div>
          </div>
        </div>
      </div>

      <!-- 会议要点 CRUD -->
      <div class="card" style="padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div><span class="card-title">会议要点管理</span><span class="card-sub">{{ meetings.length }} 条</span></div>
          <button @click="openAddMeeting" style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer">新增会议要点</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow:auto">
          <div v-for="m in (meetings || [])" :key="m.id" @click="openEditMeeting(m)"
            style="padding:10px;border:1px solid var(--border);border-radius:10px;background:#fafaf9;cursor:pointer">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px">
              <div>
                <div style="font-size:12px;font-weight:700">{{ m.title }}</div>
                <div style="font-size:11px;color:var(--muted)">{{ m.meeting_date }} · {{ m.week_label }}</div>
              </div>
              <div style="display:flex;gap:5px;flex-shrink:0" @click.stop>
                <button @click="deleteMeeting(m)" style="border:1px solid #fecaca;background:#fff;color:#dc2626;border-radius:6px;padding:3px 7px;font-size:11px;cursor:pointer">删除</button>
              </div>
            </div>
            <div style="font-size:11px;color:var(--muted);line-height:1.7">{{ m.content }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 运营动作管理 -->
  <div class="card" style="padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div><span class="card-title">运营动作记录</span><span class="card-sub">{{ actions.length }} 条，用于效果分析页的前后对比</span></div>
      <button @click="openAddAction" style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer">+ 新增动作</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;max-height:300px;overflow-y:auto">
      <div style="display:grid;grid-template-columns:90px 96px minmax(0,1fr) minmax(0,2fr) 100px;padding:7px 14px;background:#f8f8f7;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--muted)">
        <div>类型</div><div>执行日期</div><div>关联商品</div><div>备注</div><div style="text-align:right">操作</div>
      </div>
      <div v-if="!actions.length" class="empty" style="padding:24px">暂无运营动作记录，点击「新增动作」开始记录</div>
      <div v-for="(a, ai) in (actions || [])" :key="a.id" @click="openEditAction(a)"
        :style="{display:'grid',gridTemplateColumns:'90px 96px minmax(0,1fr) minmax(0,2fr) 60px',padding:'8px 14px',borderBottom:ai<actions.length-1?'1px solid var(--border)':'none',alignItems:'center',cursor:'pointer'}">
        <div>
          <span style="padding:2px 7px;border-radius:99px;font-size:11px;font-weight:600;background:#f0fdf4;color:#16a34a">{{ a.action_type }}</span>
        </div>
        <div style="font-size:12px;color:var(--muted)">{{ a.action_date }}</div>
        <div style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px">
          {{ a.pid ? productNameByPid(a.pid) : (a.pids?.length > 0 ? (a.pids.includes('*') ? '全部商品' : a.pids.length + '个商品') : '—') }}
        </div>
        <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px">{{ a.note || a.content || '—' }}</div>
        <div style="display:flex;justify-content:flex-end" @click.stop>
          <button @click="deleteAction(a)" style="border:1px solid #fecaca;background:#fff;color:#dc2626;border-radius:6px;padding:3px 7px;font-size:11px;cursor:pointer">删除</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 商品管理 -->
  <div class="card" style="padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div><span class="card-title">商品管理</span><span class="card-sub">{{ allProductsForManage.length }} 个商品</span></div>
      <button @click="openAddProduct" style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer">+ 新增自定义商品</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;max-height:280px;overflow-y:auto">
      <div style="display:grid;grid-template-columns:minmax(0,2fr) 64px 60px 120px;padding:7px 14px;background:#f8f8f7;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--muted)">
        <div>商品名称</div><div>类目</div><div>状态</div><div style="text-align:right">操作</div>
      </div>
      <div v-for="(p, pi) in (allProductsForManage || [])" :key="p.pid" @click="openEditProduct(p)"
        :style="{display:'grid',gridTemplateColumns:'minmax(0,2fr) 64px 60px 90px',padding:'8px 14px',borderBottom:pi<allProductsForManage.length-1?'1px solid var(--border)':'none',alignItems:'center',background:p.hidden?'#fafaf9':'#fff',cursor:'pointer'}">
        <div style="min-width:0">
          <div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :style="{opacity:p.hidden?0.4:1}">{{ p.name }}</div>
          <div style="font-size:10px;color:var(--muted)">{{ p.pid }}</div>
        </div>
        <div style="font-size:11px;color:var(--muted)">{{ p.cat }}</div>
        <div>
          <span v-if="p.isCustom" style="font-size:10px;padding:2px 6px;border-radius:99px;background:#dbeafe;color:#1e40af;font-weight:600">自定义</span>
          <span v-if="p.hidden" style="font-size:10px;padding:2px 6px;border-radius:99px;background:#f3f4f6;color:#71717a">已隐藏</span>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:4px" @click.stop>
          <button @click="toggleHideProduct(p.pid)" style="border:1px solid var(--border);background:#fff;border-radius:6px;padding:3px 6px;font-size:11px;cursor:pointer">{{ p.hidden ? '显示' : '隐藏' }}</button>
          <button v-if="p.isCustom" @click="deleteCustomProduct(p.pid)" style="border:1px solid #fecaca;background:#fff;color:#dc2626;border-radius:6px;padding:3px 6px;font-size:11px;cursor:pointer">删除</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 手工数据录入 -->
  <div class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:12px"><span class="card-title">手工数据录入</span><span class="card-sub">补录缺失的每日数据</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">选择商品</div>
        <select v-model="manualInputPid" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff">
          <option value="">请选择商品</option>
          <option v-for="p in (manualProductOptions || [])" :key="p.pid" :value="p.pid">{{ p.name }}</option>
        </select>
      </div>
      <div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">日期</div>
        <input type="date" v-model="manualInputDate" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">
      <label v-for="f in ['pay','vis','cart','spend','refund','collect']" :key="f" style="display:flex;flex-direction:column;gap:4px;font-size:12px">
        <span style="color:var(--muted)">{{ {pay:'成交额',vis:'访客UV',cart:'加购数',spend:'投放花费',refund:'退款额',collect:'收藏加购'}[f] }}</span>
        <input type="number" v-model="manualInputFields[f]" placeholder="留空=不更新" style="border:1px solid var(--border);border-radius:8px;padding:7px 10px;font-size:12px">
      </label>
    </div>
    <div style="display:flex;justify-content:flex-end">
      <button @click="saveManualData" style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:8px 16px;font-size:12px;cursor:pointer;font-weight:600">保存数据</button>
    </div>
  </div>

  <!-- 人群投放品类计划（admin 可改） -->
  <div class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:14px">
      <span class="card-title">人群投放品类计划</span>
      <span class="card-sub">晓东定的目标比例：家具/配饰/灯具/其他。改完保存后投放面板自动同步</span>
    </div>
    <div v-if="audiencePlanLoading" style="color:var(--muted);font-size:12px">加载中...</div>
    <div v-else>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px">
        <div v-for="(row, idx) in audiencePlan" :key="row.category"
          style="border:1px solid var(--border);border-radius:8px;padding:12px;background:#fafaf9">
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px">{{ row.category }}</div>
          <div style="display:flex;align-items:center;gap:6px">
            <input type="number" v-model.number="row.plan_pct" min="0" max="100" step="0.1"
              style="width:70px;padding:6px 8px;font-size:14px;font-weight:700;border:1px solid var(--border);border-radius:6px;text-align:right"
              :disabled="!can('metric.edit') && !((me?.permissions||[]).includes('*'))">
            <span style="font-size:12px;color:var(--muted)">%</span>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;font-size:12px">
        <span style="color:var(--muted)">合计：</span>
        <span :style="{fontWeight:700, color: Math.abs(audiencePlanTotal - 100) < 0.5 ? 'var(--green)' : 'var(--yellow)'}">
          {{ audiencePlanTotal }}%
        </span>
        <span v-if="Math.abs(audiencePlanTotal - 100) >= 0.5" style="color:var(--yellow)">⚠️ 计划总和不为 100%</span>
        <div style="flex:1"></div>
        <button @click="resetAudiencePlanDefault"
          style="padding:5px 12px;font-size:12px;border:1px solid var(--border);background:#fff;color:var(--muted);border-radius:6px;cursor:pointer">
          恢复默认 (63/30/5/2)
        </button>
        <button @click="saveAudiencePlan" :disabled="audiencePlanSaving"
          style="padding:5px 14px;font-size:12px;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:6px;cursor:pointer;font-weight:600">
          {{ audiencePlanSaving ? '保存中...' : '保存' }}
        </button>
      </div>
      <div v-if="audiencePlanMsg" style="margin-top:8px;font-size:12px"
        :style="{color: audiencePlanMsg.includes('失败') ? 'var(--red)' : 'var(--green)'}">{{ audiencePlanMsg }}</div>
    </div>
  </div>

  <!-- AI 配置（从 AI 分析页搬过来）-->
  <div class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:14px">
      <span class="card-title">AI 配置</span>
      <span class="card-sub">配置存储在浏览器本地（localStorage），不上传服务器；填完保存后到「AI 分析」页用</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:12px">
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px">
        <span style="color:var(--muted)">模型名</span>
        <input v-model="aiConfig.model" placeholder="gpt-4.1-mini / claude-sonnet-4-6 等" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;box-sizing:border-box">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px">
        <span style="color:var(--muted)">API Base URL</span>
        <input v-model="aiConfig.apiBase" placeholder="https://api.openai.com/v1" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;box-sizing:border-box">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;grid-column:1/-1">
        <span style="color:var(--muted)">API Key <span style="color:#dc2626">*</span></span>
        <div style="display:flex;gap:8px;align-items:center">
          <input :type="aiShowKey ? 'text' : 'password'" v-model="aiConfig.apiKey" placeholder="sk-..." style="flex:1;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;box-sizing:border-box">
          <button @click="aiShowKey=!aiShowKey" style="border:1px solid var(--border);background:#fff;border-radius:8px;padding:7px 10px;font-size:11px;cursor:pointer;white-space:nowrap">{{ aiShowKey ? '隐藏' : '显示' }}</button>
        </div>
      </label>
    </div>
    <label style="display:flex;flex-direction:column;gap:6px;font-size:12px">
      <span style="color:var(--muted)">系统提示词</span>
      <textarea v-model="aiConfig.systemPrompt" rows="3" style="border:1px solid var(--border);border-radius:8px;padding:10px;font-size:12px;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea>
    </label>
    <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
      <button @click="saveAiConfig" style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;cursor:pointer;font-weight:600">保存</button>
      <button @click="resetAiConfig" style="border:1px solid var(--border);background:#fff;color:var(--muted);border-radius:8px;padding:7px 14px;font-size:12px;cursor:pointer">恢复默认</button>
      <span style="font-size:11px;color:var(--muted);margin-left:auto">{{ aiSavedAt ? '最近保存 ' + aiSavedAt : (aiConfig.apiKey ? '已存在配置' : '尚未保存') }}</span>
    </div>
  </div>

  <!-- 数据底表导入 -->
  <div class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:14px">
      <span class="card-title">数据底表导入</span>
      <span class="card-sub">上传生意参谋 XLS、推广报表 CSV，服务端自动刷新 RAW 数据</span>
    </div>
    <div @click="pickImportFiles"
      style="border:2px dashed var(--border);border-radius:10px;padding:24px;text-align:center;cursor:pointer;transition:border-color .15s;background:#fafaf9"
      @dragover.prevent @drop.prevent="e=>{importFiles=Array.from(e.dataTransfer.files);}"
      onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
      <div style="font-size:24px;margin-bottom:6px">📁</div>
      <div style="font-size:13px;font-weight:600;color:var(--text)">点击选择文件 / 拖拽到此处</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">支持 .xls .xlsx .csv，可多选</div>
    </div>
    <div v-if="importFiles.length" style="margin-top:10px;padding:10px 14px;background:#f4f4f5;border-radius:8px">
      <div v-for="f in importFiles" :key="f.name" style="font-size:12px;color:var(--text);padding:2px 0">📄 {{ f.name }}</div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
      <button @click="runImport" :disabled="importLoading||!importFiles.length"
        :style="{border:'1px solid var(--accent)',background:importLoading||!importFiles.length?'#d4d4d8':'var(--accent)',color:'#fff',borderRadius:'8px',padding:'8px 20px',fontSize:'12px',cursor:importLoading||!importFiles.length?'default':'pointer',fontWeight:'600'}">
        {{ importLoading ? '处理中…' : '开始导入' }}
      </button>
      <span v-if="importStatus" :style="{fontSize:'12px',color:importStatus.startsWith('✓')?'var(--green)':'var(--red)'}">{{ importStatus }}</span>
    </div>
  </div>

  <!-- 用户编辑 Modal -->
  <div v-if="userModal.show" style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000" @click.self="userModal.show=false">
    <div style="background:#fff;border-radius:14px;padding:24px;width:380px;box-shadow:0 8px 32px rgba(0,0,0,.15)">
      <div style="font-size:15px;font-weight:700;margin-bottom:16px">{{ userModal.mode==='add'?'新增用户':'编辑用户' }}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">显示名 <span style="color:#e55">*</span></div>
          <input v-model="userModal.name" placeholder="如：晓东（运营）" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">登录账号 <span style="color:#e55">*</span></div>
          <input v-model="userModal.username" placeholder="如：xiaodong" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">角色</div>
          <select v-model="userModal.role" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff">
            <option value="admin">管理员</option><option value="ops">运营</option><option value="member">成员</option><option value="viewer">只读</option>
          </select>
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">{{ userModal.mode==='add'?'初始密码 *':'新密码（留空不改）' }}</div>
          <input v-model="userModal.password" type="password" placeholder="输入密码" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button @click="saveUserModal" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer;font-weight:600">保存</button>
        <button @click="userModal.show=false" style="flex:1;background:#f4f4f5;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer">取消</button>
      </div>
    </div>
  </div>

  <!-- 指标编辑 Modal -->
  <div v-if="metricModal.show" style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000" @click.self="metricModal.show=false">
    <div style="background:#fff;border-radius:14px;padding:24px;width:400px;box-shadow:0 8px 32px rgba(0,0,0,.15)">
      <div style="font-size:15px;font-weight:700;margin-bottom:16px">{{ metricModal.mode==='add'?'新增指标':'编辑指标' }}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">指标名称</div>
          <input v-model="metricModal.label" placeholder="如：转化率" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">Key</div>
          <input v-model="metricModal.key" placeholder="如：conv_rate" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">模块</div>
          <select v-model="metricModal.module" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff">
            <option value="overview">总览</option><option value="product">单品</option><option value="compare">对比</option>
          </select>
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">单位</div>
          <select v-model="metricModal.unit" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff">
            <option value="number">数字</option><option value="money">金额</option><option value="percent">百分比</option><option value="uv">人数</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom:20px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">备注</div>
        <input v-model="metricModal.note" placeholder="可选备注" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
      </div>
      <div style="display:flex;gap:8px">
        <button @click="saveMetricModal" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer;font-weight:600">保存</button>
        <button @click="metricModal.show=false" style="flex:1;background:#f4f4f5;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer">取消</button>
      </div>
    </div>
  </div>

  <!-- 会议编辑 Modal -->
  <div v-if="meetingModal.show" style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000" @click.self="meetingModal.show=false">
    <div style="background:#fff;border-radius:14px;padding:24px;width:420px;box-shadow:0 8px 32px rgba(0,0,0,.15)">
      <div style="font-size:15px;font-weight:700;margin-bottom:16px">{{ meetingModal.mode==='add'?'新增会议要点':'编辑会议要点' }}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">标题</div>
          <input v-model="meetingModal.title" placeholder="如：4月运营周会" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">日期</div>
          <input type="date" v-model="meetingModal.date" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">周标签</div>
          <input v-model="meetingModal.week" placeholder="如：第17周" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
        </div>
      </div>
      <div style="margin-bottom:20px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">内容</div>
        <textarea v-model="meetingModal.content" rows="4" placeholder="会议要点内容" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;resize:vertical;box-sizing:border-box"></textarea>
      </div>
      <div style="display:flex;gap:8px">
        <button @click="saveMeetingModal" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer;font-weight:600">保存</button>
        <button @click="meetingModal.show=false" style="flex:1;background:#f4f4f5;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer">取消</button>
      </div>
    </div>
  </div>

  <!-- 商品编辑 Modal -->
  <div v-if="productModal.show" style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000" @click.self="productModal.show=false">
    <div style="background:#fff;border-radius:14px;padding:24px;width:360px;box-shadow:0 8px 32px rgba(0,0,0,.15)">
      <div style="font-size:15px;font-weight:700;margin-bottom:16px">{{ productModal.mode==='add'?'新增自定义商品':'编辑商品' }}</div>
      <div style="margin-bottom:12px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">商品ID</div>
        <input v-model="productModal.newPid" :placeholder="productModal.mode==='add'?'商品ID（必填）':'修改商品ID'"
          :disabled="productModal.mode==='edit'&&!productModal.isCustom"
          :style="{width:'100%',padding:'8px 10px',border:'1px solid var(--border)',borderRadius:'8px',fontSize:'12px',boxSizing:'border-box',background:productModal.mode==='edit'&&!productModal.isCustom?'#f4f4f5':'#fff'}">
      </div>
      <div style="margin-bottom:12px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">商品名</div>
        <input v-model="productModal.name" placeholder="商品名称" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">类目</div>
          <select v-model="productModal.cat" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff">
            <option value="家具">家具</option><option value="配饰">配饰</option><option value="灯具">灯具</option><option value="其他">其他</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">商品图片 URL（留空则用系统默认）</div>
        <input v-model="productModal.imageUrl" placeholder="粘贴图片链接，如 https://..." style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
        <div v-if="productModal.imageUrl" style="margin-top:6px;width:60px;height:60px;border:1px solid var(--border);border-radius:6px;overflow:hidden">
          <img :src="productModal.imageUrl" style="width:100%;height:100%;object-fit:cover">
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button @click="saveProductModal" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer;font-weight:600">保存</button>
        <button @click="productModal.show=false" style="flex:1;background:#f4f4f5;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer">取消</button>
      </div>
    </div>
  </div>

  <!-- 运营动作编辑 Modal -->
  <div v-if="actionModal.show" style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000" @click.self="actionModal.show=false">
    <div style="background:#fff;border-radius:14px;padding:24px;width:400px;box-shadow:0 8px 32px rgba(0,0,0,.15)">
      <div style="font-size:15px;font-weight:700;margin-bottom:16px">{{ actionModal.mode==='add'?'新增运营动作':'编辑运营动作' }}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">动作类型</div>
          <select v-model="actionModal.action_type" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff">
            <option v-for="t in ACTION_TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">执行日期</div>
          <input type="date" v-model="actionModal.action_date" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
        </div>
      </div>
      <div style="margin-bottom:20px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">备注</div>
        <input v-model="actionModal.note" placeholder="执行说明" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box">
      </div>
      <div style="display:flex;gap:8px">
        <button @click="saveActionModal" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer;font-weight:600">保存</button>
        <button @click="actionModal.show=false" style="flex:1;background:#f4f4f5;border:none;border-radius:8px;padding:9px;font-size:12px;cursor:pointer">取消</button>
      </div>
    </div>
  </div>

</div>`
})
