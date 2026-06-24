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
          // 关键：同步写 localStorage('hay_current_user')，让 api.js 的 X-Username header 始终对得上
          // 不然 toggle 权限会 401「未登录或缺少 X-Username header」
          const cur = dbUsers.value.find(u => u.id === state.currentUserId)
          if (cur && cur.username) {
            try {
              localStorage.setItem('hay_current_user', JSON.stringify({
                id: cur.id, username: cur.username, display_name: cur.display_name,
                role: cur.role, permissions: cur.permissions || [],
              }))
            } catch {}
          }
          persistAppState()
        }
      } catch (e) { console.warn('[loadDbUsers]', e) }
      usersLoading.value = false
    }
    Vue.onMounted(loadDbUsers)

    const me = Vue.computed(() => (state.users||[]).find(u=>u.id===state.currentUserId)||state.users?.[0])
    // 是否是管理员：拥有 '*' 通配权限（来自 role=admin 或被显式赋了 *）
    const isAdmin = Vue.computed(() => {
      const m = me.value
      return !!(m && (m.permissions||[]).includes('*'))
    })

    // ── 修改密码（所有人都能改自己的）─────────────────────
    const pwForm = Vue.reactive({ pw1: '', pw2: '', loading: false, msg: '' })
    const changePassword = async () => {
      pwForm.msg = ''
      const p1 = (pwForm.pw1||'').trim()
      const p2 = (pwForm.pw2||'').trim()
      if (!p1 || p1.length < 4) { pwForm.msg = '✗ 新密码至少 4 位'; return }
      if (p1 !== p2) { pwForm.msg = '✗ 两次密码不一致'; return }
      const m = me.value
      if (!m || !m.id) { pwForm.msg = '✗ 当前账号未识别'; return }
      pwForm.loading = true
      try {
        const res = await fetch(`/api/users/${m.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: p1 })
        })
        if (res.ok) {
          pwForm.msg = '✓ 已修改，下次登录用新密码'
          pwForm.pw1 = ''; pwForm.pw2 = ''
        } else {
          const d = await res.json().catch(()=>({}))
          pwForm.msg = `✗ 失败：${d.detail || res.statusText}`
        }
      } catch (e) {
        pwForm.msg = `✗ 网络错误：${e.message}`
      }
      pwForm.loading = false
    }

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
      const u = (state.users||[]).find(x => x.id === id)
      // 关键：同步写到 localStorage('hay_current_user')，这样 api.js 的 X-Username header 也会跟着变
      // 不然「测试角色切到 jas」但写操作还是用真账号身份，权限检查会错。
      if (u && u.username) {
        try {
          localStorage.setItem('hay_current_user', JSON.stringify({
            id: u.id, username: u.username, display_name: u.display_name,
            role: u.role, permissions: u.permissions || [],
          }))
        } catch {}
      }
      persistAppState()
      if (u) {
        Vue.nextTick(() => {
          const tag = document.getElementById('role-switch-toast')
          if (tag) {
            tag.textContent = `已切换到「${u.display_name}」(${u.role}) — 接口写操作也按这个身份发送`
            tag.style.opacity = '1'
            setTimeout(() => { tag.style.opacity = '0' }, 2400)
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
    // 乐观更新 + 后台保存：点击立刻变，失败回滚。避免每次等 200ms 网络。
    const togglePerm = (u, code) => {
      if (!can('permission.assign')) return alert('无权限分配权限')
      if ((u.permissions||[]).includes('*')) return alert('管理员拥有全部权限')
      const before = [...(u.permissions || [])]
      const s = new Set(before)
      s.has(code) ? s.delete(code) : s.add(code)
      const newPerms = [...s]
      // 1) 立即 UI 更新
      u.permissions = newPerms
      persistAppState()
      // 2) 后台调 API 保存。真账号才发请求；失败回滚 UI
      const isRealUser = u.id && /^\d+$/.test(u.id)
      if (!isRealUser) return
      ;(async () => {
        try {
          const res = await fetch(`/api/users/${u.id}/permissions`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permissions: newPerms }),
          })
          if (!res.ok) {
            u.permissions = before  // 回滚
            persistAppState()
            const err = await res.json().catch(()=>({detail:'保存失败'}))
            alert('保存失败（已回滚）：' + (err.detail || res.status))
          }
        } catch (e) {
          u.permissions = before
          persistAppState()
          alert('保存失败（已回滚）：' + e.message)
        }
      })()
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
    // 商品管理列表搜索（按名称 / pid）
    const productSearch = Vue.ref('')
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
    // 经搜索过滤后的视图（搜索框输入会同时匹配 name + pid，大小写不敏感）
    const filteredProductsForManage = Vue.computed(() => {
      const q = (productSearch.value || '').trim().toLowerCase()
      const all = allProductsForManage.value || []
      if (!q) return all
      return all.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        String(p.pid || '').toLowerCase().includes(q)
      )
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

    // ── 数据异常检测：哪些日期缺数据 ──
    // 各类报表的起算日期不同：生意参谋从 data_start（2 月）；万象台/短视频从投放上线日（launch_date 4.8）
    const dataGaps = Vue.computed(() => {
      const gaps = []
      const today = new Date().toISOString().slice(0, 10)
      const syztStart = RAW.data_start || '2026-04-01'  // 生意参谋全店从开店起就有
      const adsStart = RAW.launch_date || '2026-04-08'   // 万象台/短视频上线后才有数据
      const end = (RAW.data_end && RAW.data_end < today) ? RAW.data_end : today
      const range = (s, e) => {
        const dates = []
        const sd = new Date(s), ed = new Date(e)
        for (let d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) {
          dates.push(d.toISOString().slice(0, 10))
        }
        return dates
      }
      const syztDates = new Set((RAW.syzt || []).map(r => r.d))
      for (const d of range(syztStart, end)) {
        if (!syztDates.has(d)) gaps.push({ report: '生意参谋商品报表', date: d })
      }
      const wxstDates = new Set((RAW.wxst || []).map(r => r.d))
      for (const d of range(adsStart, end)) {
        if (!wxstDates.has(d)) gaps.push({ report: '万象台商品报表', date: d })
      }
      const videoDates = new Set(Object.keys(RAW.video_daily || {}))
      for (const d of range(adsStart, end)) {
        if (!videoDates.has(d)) gaps.push({ report: '内容报表(短视频)', date: d })
      }
      return gaps.slice(0, 30)
    })

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

    // ──────────────────────────────────────────────────────────────────
    // 618 加购数据管理（admin） — 增/删/改 addtocart_618_data 表
    // ──────────────────────────────────────────────────────────────────
    const cart618Items = Vue.ref([])
    const cart618Loading = Vue.ref(false)
    const cart618Msg = Vue.ref('')
    const cart618Form = Vue.ref({
      data_type: 'cum_dedup',
      start_date: '2026-05-01',
      end_date:   '',
      users: '',
      note: '',
    })

    const cart618LoadAll = async () => {
      cart618Loading.value = true
      try {
        const r = await fetch('/api/618/store-data').then(r => r.json())
        cart618Items.value = r.items || []
      } catch (e) {
        cart618Msg.value = '加载失败：' + e
      }
      cart618Loading.value = false
    }
    const cart618Grouped = Vue.computed(() => {
      const out = { daily: [], cum_dedup: [], win_dedup: [] }
      for (const it of cart618Items.value) {
        if (out[it.data_type]) out[it.data_type].push(it)
      }
      return out
    })

    // 选了 data_type 后自动调整默认 start/end，让管理员省力
    const cart618OnTypeChange = () => {
      const t = cart618Form.value.data_type
      const today = new Date().toISOString().slice(0, 10)
      if (t === 'daily') {
        cart618Form.value.start_date = today
        cart618Form.value.end_date   = today
      } else if (t === 'cum_dedup') {
        const yr = today.slice(0, 4)
        cart618Form.value.start_date = `${yr}-05-01`
        cart618Form.value.end_date   = today
      } else {
        cart618Form.value.start_date = '2026-05-01'
        cart618Form.value.end_date   = today
      }
    }

    const cart618Save = async () => {
      const f = cart618Form.value
      if (!f.users && f.users !== 0) { cart618Msg.value = '✗ 加购人数必填'; return }
      if (f.data_type === 'daily' && !f.start_date) { cart618Msg.value = '✗ 选个日期'; return }
      if (f.data_type === 'daily') f.end_date = f.start_date
      try {
        const u = JSON.parse(localStorage.getItem('hay_current_user') || '{}')
        const res = await fetch('/api/618/store-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Username': u.username || '' },
          body: JSON.stringify({
            data_type: f.data_type,
            start_date: f.start_date,
            end_date: f.end_date,
            users: Math.round(Number(f.users)),
            note: f.note || '',
            updated_by: u.username || '',
          }),
        })
        if (!res.ok) { cart618Msg.value = '✗ 保存失败：' + (await res.text()); return }
        cart618Msg.value = '✓ 已保存（看板会自动刷新）'
        f.users = ''; f.note = ''
        await cart618LoadAll()
        setTimeout(() => { cart618Msg.value = '' }, 3000)
      } catch (e) {
        cart618Msg.value = '✗ ' + e
      }
    }

    const cart618Delete = async (id) => {
      if (!confirm('删除这条数据？hardcoded 默认值仍会兜底。')) return
      try {
        const u = JSON.parse(localStorage.getItem('hay_current_user') || '{}')
        const res = await fetch(`/api/618/store-data/${id}`, {
          method: 'DELETE',
          headers: { 'X-Username': u.username || '' },
        })
        if (!res.ok) { cart618Msg.value = '✗ 删除失败：' + (await res.text()); return }
        await cart618LoadAll()
        cart618Msg.value = '✓ 已删除'
        setTimeout(() => { cart618Msg.value = '' }, 3000)
      } catch (e) {
        cart618Msg.value = '✗ ' + e
      }
    }

    Vue.onMounted(cart618LoadAll)

    return {
      // 618 加购数据管理
      cart618Items, cart618Loading, cart618Msg, cart618Form, cart618Grouped,
      cart618OnTypeChange, cart618Save, cart618Delete, cart618LoadAll,
      me,isAdmin,pwForm,changePassword,
      users,metrics,permGroups,PERM_LABELS,expandedUserId,toggleExpand,meetings,can,setMe,
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
      allProductsForManage,filteredProductsForManage,productSearch,productModal,openAddProduct,openEditProduct,saveProductModal,toggleHideProduct,deleteCustomProduct,
      manualInputPid,manualInputDate,manualInputFields,manualProductOptions,saveManualData,
      dataGaps,
      productNameByPid: pid => RAW.products?.[pid]?.name || pid,
      ...(() => {
        // ── 数据底表导入 ──────────────────────────────────────
        const importFiles = Vue.ref([])
        const importStatus = Vue.ref('')
        const importLoading = Vue.ref(false)
        // 选文件：累加追加，不要每次替换（用户可能分批选）。去重按 name
        const onImportFilesChange = e => {
          const incoming = Array.from(e.target.files || [])
          const map = new Map(importFiles.value.map(f => [f.name, f]))
          for (const f of incoming) map.set(f.name, f)
          importFiles.value = Array.from(map.values())
        }
        const pickImportFiles = () => {
          const inp = document.createElement('input')
          inp.type='file'; inp.multiple=true; inp.accept='.xls,.xlsx,.csv'
          inp.onchange = onImportFilesChange
          inp.click()
        }
        const removeImportFile = (name) => {
          importFiles.value = importFiles.value.filter(f => f.name !== name)
        }
        const clearImportFiles = () => { importFiles.value = [] }
        const runImport = async () => {
          if (!importFiles.value.length) return alert('请先选择文件')
          importLoading.value = true; importStatus.value = '上传中…'
          try {
            const fd = new FormData()
            importFiles.value.forEach(f => fd.append('files', f))
            const res = await fetch('/api/refresh-data', { method:'POST', body:fd })
            const data = await res.json()
            if (res.ok) {
              const parts = []
              parts.push(`生意参谋 ${data.syzt||0}`)
              parts.push(`商品报表 ${data.wxst||0}`)
              if (data.audience != null) parts.push(`人群 ${data.audience}`)
              if (data.keyword  != null) parts.push(`关键词 ${data.keyword}`)
              if (data.traffic  != null) parts.push(`流量 ${data.traffic}`)
              const fileSummary = (data.saved_files || []).map(f =>
                typeof f === 'string' ? f : `${f.name} → ${f.dest || ''}`
              ).join('\n  · ')
              const totalRows = (data.syzt||0)+(data.wxst||0)+(data.audience||0)+(data.keyword||0)+(data.traffic||0)
              const status = totalRows > 0 ? '✓ 导入成功' : '⚠️ 文件已上传但 ETL 没读到数据'
              importStatus.value = `${status}（${importFiles.value.length} 个文件）\n汇总：${parts.join(' · ')} 行\n路由：\n  · ${fileSummary || '—'}`
              if (totalRows === 0 && data.log) {
                importStatus.value += `\nETL 日志末尾：\n${(data.log || '').split('\n').slice(-15).join('\n')}`
              }
              importFiles.value = []
            } else {
              importStatus.value = `✗ 失败：${data.detail||res.statusText}`
            }
          } catch(e) { importStatus.value = `✗ 网络错误：${e.message}` }
          importLoading.value = false
        }
        return { importFiles, importStatus, importLoading, pickImportFiles, runImport, removeImportFile, clearImportFiles }
      })(),
    }
  },
  template: `
<div style="display:flex;flex-direction:column;gap:16px">

  <!-- 修改密码（所有人都能改自己的）-->
  <div class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:10px">
      <span class="card-title">修改密码</span>
      <span class="card-sub">改完下次登录生效；忘了密码联系管理员重置</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end">
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
        <span style="color:var(--muted)">新密码</span>
        <input type="password" v-model="pwForm.pw1" placeholder="至少 4 位" autocomplete="new-password"
               style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;box-sizing:border-box">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
        <span style="color:var(--muted)">再输一次</span>
        <input type="password" v-model="pwForm.pw2" placeholder="确认新密码" autocomplete="new-password"
               style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;box-sizing:border-box">
      </label>
      <button @click="changePassword" :disabled="pwForm.loading"
              :style="{border:'1px solid var(--accent)',background:pwForm.loading?'#d4d4d8':'var(--accent)',color:'#fff',borderRadius:'8px',padding:'8px 18px',fontSize:'12px',cursor:pwForm.loading?'default':'pointer',fontWeight:'600'}">
        {{ pwForm.loading ? '保存中…' : '修改密码' }}
      </button>
    </div>
    <div v-if="pwForm.msg" style="margin-top:8px;font-size:12px"
         :style="{color: pwForm.msg.startsWith('✓') ? '#138a52' : '#e5484d'}">{{ pwForm.msg }}</div>
  </div>

  <!-- 非管理员到此为止 -->
  <div v-if="!isAdmin" style="padding:16px;background:#fafaf9;border:1px dashed var(--border);border-radius:10px;font-size:12px;color:var(--muted);text-align:center">
    其他设置项需要管理员权限。如需新增任务、修改商品等操作请联系管理员。
  </div>

  <!-- 当前用户切换 -->
  <div v-if="isAdmin" class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:10px"><span class="card-title">当前角色</span><span class="card-sub">前端测试用：切换后页面 can(...) 权限即时生效；服务器接口仍按真实登录账号校验</span></div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <select :value="me?.id" @change="setMe($event.target.value)" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;background:#fff">
        <option v-for="u in (users || [])" :key="u.id" :value="u.id">{{ u.display_name }}（{{ u.role }}）</option>
      </select>
      <span style="font-size:11px;color:#138a52;font-weight:600">当前：{{ me?.display_name }} · {{ me?.role }} · {{ (me?.permissions||[]).includes('*') ? '全部权限' : ((me?.permissions||[]).length + ' 项权限') }}</span>
      <span id="role-switch-toast" style="font-size:11px;background:#dcfce7;color:#166534;padding:4px 10px;border-radius:99px;opacity:0;transition:opacity 0.3s"></span>
    </div>
  </div>

  <!-- 用户与权限 -->
  <div v-if="isAdmin">
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
              <span v-if="(u.permissions||[]).includes('*')" style="color:#138a52;font-weight:600">全部权限</span>
              <span v-else>{{ (u.permissions||[]).length }} 项权限已开启</span>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:6px" @click.stop>
              <button @click="openEditUser(u)" style="border:1px solid var(--border);background:#fff;border-radius:7px;padding:4px 10px;font-size:11px;cursor:pointer">修改</button>
              <button @click="deleteUser(u)" style="border:1px solid #fecaca;background:#fff;color:#e5484d;border-radius:7px;padding:4px 10px;font-size:11px;cursor:pointer">删除</button>
            </div>
          </div>
          <div v-if="expandedUserId===u.id" style="padding:14px;background:#fafaf9;border-bottom:1px solid var(--border)">
            <div v-if="(u.permissions||[]).includes('*')" style="font-size:12px;color:#138a52;font-weight:600;padding:4px 0">
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

  </div>

  <!-- 运营动作管理 -->
  <div v-if="isAdmin" class="card" style="padding:16px">
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
          <span style="padding:2px 7px;border-radius:99px;font-size:11px;font-weight:600;background:#f0fdf4;color:#138a52">{{ a.action_type }}</span>
        </div>
        <div style="font-size:12px;color:var(--muted)">{{ a.action_date }}</div>
        <div style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px">
          {{ a.pid ? productNameByPid(a.pid) : (a.pids?.length > 0 ? (a.pids.includes('*') ? '全部商品' : a.pids.length + '个商品') : '—') }}
        </div>
        <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px">{{ a.note || a.content || '—' }}</div>
        <div style="display:flex;justify-content:flex-end" @click.stop>
          <button @click="deleteAction(a)" style="border:1px solid #fecaca;background:#fff;color:#e5484d;border-radius:6px;padding:3px 7px;font-size:11px;cursor:pointer">删除</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 商品管理 -->
  <div v-if="isAdmin" class="card" style="padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px;flex-wrap:wrap">
      <div><span class="card-title">商品管理</span><span class="card-sub">{{ filteredProductsForManage.length }}/{{ allProductsForManage.length }} 个商品</span></div>
      <div style="display:flex;align-items:center;gap:8px">
        <input v-model="productSearch" placeholder="搜索 名称 / 商品ID"
          style="border:1px solid var(--border);background:#fff;border-radius:8px;padding:6px 30px 6px 10px;font-size:12px;width:200px;outline:none">
        <button v-if="productSearch" @click="productSearch=''" title="清空搜索"
          style="border:1px solid var(--border);background:#fff;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;color:var(--muted)">×</button>
        <button @click="openAddProduct" style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer">+ 新增自定义商品</button>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;max-height:280px;overflow-y:auto">
      <div style="display:grid;grid-template-columns:minmax(0,2fr) 64px 60px 120px;padding:7px 14px;background:#f8f8f7;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--muted);position:sticky;top:0;z-index:1">
        <div>商品名称</div><div>类目</div><div>状态</div><div style="text-align:right">操作</div>
      </div>
      <div v-if="!filteredProductsForManage.length" style="padding:24px 14px;text-align:center;color:var(--muted);font-size:12px">
        无匹配商品（搜索：{{ productSearch }}）
      </div>
      <div v-for="(p, pi) in filteredProductsForManage" :key="p.pid" @click="openEditProduct(p)"
        :style="{display:'grid',gridTemplateColumns:'minmax(0,2fr) 64px 60px 90px',padding:'8px 14px',borderBottom:pi<filteredProductsForManage.length-1?'1px solid var(--border)':'none',alignItems:'center',background:p.hidden?'#fafaf9':'#fff',cursor:'pointer'}">
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
          <button v-if="p.isCustom" @click="deleteCustomProduct(p.pid)" style="border:1px solid #fecaca;background:#fff;color:#e5484d;border-radius:6px;padding:3px 6px;font-size:11px;cursor:pointer">删除</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 数据异常 / 手工补录 -->
  <div v-if="isAdmin" class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:12px">
      <span class="card-title">数据异常</span>
      <span class="card-sub">下方提示有缺失的日期，可手动补录</span>
    </div>
    <!-- 缺失数据提示（自动检测）-->
    <div v-if="dataGaps && dataGaps.length" style="margin-bottom:12px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;line-height:1.7;color:#92400e">
      ⚠️ 检测到以下日期数据缺失：
      <div v-for="g in dataGaps" :key="g.report+'-'+g.date" style="margin-top:3px">
        · <strong>{{ g.report }}</strong> 缺 <span style="font-weight:600">{{ g.date }}</span>
      </div>
    </div>
    <div v-else style="margin-bottom:12px;padding:8px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px;color:#166534">
      ✓ 当前周期数据完整，无缺失
    </div>
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
  <div v-if="isAdmin" class="card" style="padding:16px">
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

  <!-- 618 加购数据管理（admin 可改）-->
  <div v-if="isAdmin" class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:14px">
      <span class="card-title">618 加购数据管理</span>
      <span class="card-sub">总览页"618 加购看板"取数源；admin 改完，看板自动刷新（无需重启）</span>
    </div>

    <!-- 新增/编辑表单 -->
    <div style="background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px">
      <div style="display:grid;grid-template-columns:140px 1fr 1fr 110px auto;gap:8px;align-items:end">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span style="color:var(--muted)">类型</span>
          <select v-model="cart618Form.data_type" @change="cart618OnTypeChange"
            style="border:1px solid var(--border);border-radius:6px;padding:6px;font-size:12px;background:#fff">
            <option value="cum_dedup">5/1-5/N 累计去重</option>
            <option value="daily">日加购人数</option>
            <option value="win_dedup">任意窗口去重</option>
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span style="color:var(--muted)">起始日期</span>
          <input type="date" v-model="cart618Form.start_date"
            :disabled="cart618Form.data_type==='daily'"
            style="border:1px solid var(--border);border-radius:6px;padding:6px;font-size:12px">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span style="color:var(--muted)">结束日期</span>
          <input type="date" v-model="cart618Form.end_date"
            :disabled="cart618Form.data_type==='daily'"
            style="border:1px solid var(--border);border-radius:6px;padding:6px;font-size:12px">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span style="color:var(--muted)">加购人数</span>
          <input type="number" min="0" v-model="cart618Form.users" placeholder="如 6514"
            style="border:1px solid var(--border);border-radius:6px;padding:6px;font-size:12px">
        </label>
        <button @click="cart618Save"
          style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:6px;padding:7px 16px;font-size:12px;cursor:pointer;font-weight:600">
          保存
        </button>
      </div>
      <input v-model="cart618Form.note" placeholder="备注（可选，比如"sycm 5/6 截图"）"
        style="width:100%;margin-top:8px;border:1px solid var(--border);border-radius:6px;padding:6px;font-size:12px;box-sizing:border-box">
      <div v-if="cart618Msg" style="margin-top:6px;font-size:12px"
        :style="{color: cart618Msg.startsWith('✓') ? '#138a52' : '#e5484d'}">{{ cart618Msg }}</div>
      <div style="margin-top:8px;font-size:11px;color:var(--muted);line-height:1.6">
        <strong>类型说明：</strong>
        <br>· <strong>5/1-5/N 累计去重</strong> — sycm 后台选 5/1-5/N 自定义区间得到的"商品加购人数"。每天 T+1 加一行（看板 KPI 主用）
        <br>· <strong>日加购人数</strong> — 每天单天值（核心指标监控里的）。给折线图当 fallback 用
        <br>· <strong>任意窗口去重</strong> — 比如 5/6-5/10 这种段值，目前不直接显示，备用
      </div>
    </div>

    <!-- 已录入清单（按类型分组）-->
    <div v-if="cart618Loading" style="color:var(--muted);font-size:12px">加载中…</div>
    <div v-else style="display:flex;flex-direction:column;gap:14px">
      <div v-for="(grp, key) in cart618Grouped" :key="key">
        <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px">
          {{ key === 'cum_dedup' ? '5/1-5/N 累计去重' : key === 'daily' ? '日加购人数' : '任意窗口去重' }}
          <span style="color:var(--muted);font-weight:400">（{{ grp.length }} 条）</span>
        </div>
        <div v-if="!grp.length" style="font-size:11px;color:var(--muted);padding:6px 0">— 暂无 —</div>
        <table v-else style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="color:var(--muted);border-bottom:1px solid var(--border)">
              <th style="text-align:left;padding:5px 8px;font-weight:500;width:140px">起始</th>
              <th style="text-align:left;padding:5px 8px;font-weight:500;width:140px">结束</th>
              <th style="text-align:right;padding:5px 8px;font-weight:500;width:100px">人数</th>
              <th style="text-align:left;padding:5px 8px;font-weight:500">备注</th>
              <th style="text-align:left;padding:5px 8px;font-weight:500;width:140px">最近改</th>
              <th style="text-align:right;padding:5px 8px;font-weight:500;width:60px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="it in grp" :key="it.id" style="border-bottom:1px solid #f1f5f9">
              <td style="padding:5px 8px">{{ it.start_date }}</td>
              <td style="padding:5px 8px">{{ it.end_date }}</td>
              <td style="padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums">{{ Number(it.users).toLocaleString() }}</td>
              <td style="padding:5px 8px;color:var(--muted)">{{ it.note || '—' }}</td>
              <td style="padding:5px 8px;color:var(--muted)">{{ it.updated_by || '—' }}<br><span style="font-size:10px">{{ it.updated_at }}</span></td>
              <td style="padding:5px 8px;text-align:right">
                <button @click="cart618Delete(it.id)"
                  style="border:1px solid var(--border);background:#fff;color:#e5484d;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer">删</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- AI 配置（从 AI 分析页搬过来）-->
  <div v-if="isAdmin" class="card" style="padding:16px">
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
        <span style="color:var(--muted)">API Key <span style="color:#e5484d">*</span></span>
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
  <div v-if="isAdmin" class="card" style="padding:16px">
    <div class="card-header" style="margin-bottom:14px">
      <span class="card-title">数据底表导入</span>
      <span class="card-sub">上传生意参谋 XLS、推广报表 CSV，服务端自动刷新 RAW 数据</span>
    </div>
    <div @click="pickImportFiles"
      style="border:2px dashed var(--border);border-radius:10px;padding:24px;text-align:center;cursor:pointer;transition:border-color .15s;background:#fafaf9"
      @dragover.prevent
      @drop.prevent="e=>{
        const incoming = Array.from(e.dataTransfer.files || []);
        const map = new Map(importFiles.map(f=>[f.name,f]));
        incoming.forEach(f=>map.set(f.name,f));
        importFiles = Array.from(map.values());
      }"
      onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
      <div style="font-size:24px;margin-bottom:6px">📁</div>
      <div style="font-size:13px;font-weight:600;color:var(--text)">点击选择文件 / 拖拽到此处（按住 Cmd/Ctrl 多选）</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">支持 .xls .xlsx .csv，可多选；也可分批多次选，自动累加</div>
    </div>
    <div v-if="importFiles.length" style="margin-top:10px;padding:10px 14px;background:#f4f4f5;border-radius:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:11px;font-weight:600;color:var(--text)">已选 {{ importFiles.length }} 个</span>
        <button @click="clearImportFiles" style="font-size:11px;padding:2px 8px;border:1px solid var(--border);background:#fff;border-radius:4px;cursor:pointer;color:var(--muted)">全部清除</button>
      </div>
      <div v-for="f in importFiles" :key="f.name" style="font-size:12px;color:var(--text);padding:2px 0;display:flex;align-items:center;gap:6px">
        📄 <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ f.name }}</span>
        <button @click="removeImportFile(f.name)" style="font-size:10px;border:none;background:none;cursor:pointer;color:#e5484d">×</button>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
      <button @click="runImport" :disabled="importLoading||!importFiles.length"
        :style="{border:'1px solid var(--accent)',background:importLoading||!importFiles.length?'#d4d4d8':'var(--accent)',color:'#fff',borderRadius:'8px',padding:'8px 20px',fontSize:'12px',cursor:importLoading||!importFiles.length?'default':'pointer',fontWeight:'600'}">
        {{ importLoading ? '处理中…' : '开始导入' }}
      </button>
      <pre v-if="importStatus" :style="{fontSize:'11px',color:importStatus.startsWith('✓')?'#138a52':importStatus.startsWith('⚠')?'#c2790e':'#e5484d',whiteSpace:'pre-wrap',margin:0,fontFamily:'inherit',background:'#fafaf9',padding:'8px 10px',borderRadius:'6px',maxHeight:'240px',overflow:'auto',width:'100%'}">{{ importStatus }}</pre>
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
