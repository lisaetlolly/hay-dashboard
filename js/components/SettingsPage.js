// ── SettingsPage.js ─────────────────────────────────────
// 设置页组件。

const SettingsPage = defineComponent({
  name: 'SettingsPage',
  errorCaptured(err, instance, info) {
    console.error('[SettingsPage errorCaptured]', info, err.message, err.stack)
    return false
  },
  setup() {
    const state = APP_STATE.value
    console.log('[Settings] state keys:', Object.keys(state))
    console.log('[Settings] permissionGroups:', JSON.stringify(state.permissionGroups))
    console.log('[Settings] users sample:', JSON.stringify((state.users||[]).slice(0,1)))
    console.log('[Settings] actions sample:', JSON.stringify((state.actions||[]).slice(0,1)))
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
    }
    const expandedUserId = Vue.ref('')
    const toggleExpand = id => { expandedUserId.value = expandedUserId.value === id ? '' : id }
    const setMe = id => { state.currentUserId=id; persistAppState() }

    // ── 用户 CRUD ──────────────────────────────────────────────
    const userModal = Vue.reactive({ show:false, mode:'', id:'', name:'', role:'member' })
    const openAddUser = () => {
      if (!can('user.create')) return alert('无新增用户权限')
      Object.assign(userModal, { show:true, mode:'add', id:'', name:'', role:'member' })
    }
    const openEditUser = u => {
      if (!can('user.edit')) return alert('无编辑用户权限')
      Object.assign(userModal, { show:true, mode:'edit', id:u.id, name:u.display_name, role:u.role||'member' })
    }
    const roleDefaultPerms = {
      admin:  ['*'],
      ops:    ['task.view_all','task.create','task.edit_all','meeting.view','meeting.create','meeting.edit','action.view','action.create','action.edit','metric.view','product.view'],
      member: ['task.view_all','task.view_own','task.edit_own','action.view','meeting.view','metric.view','product.view'],
    }
    const saveUserModal = () => {
      if (!userModal.name.trim()) return alert('用户名不能为空')
      const defaultPerms = roleDefaultPerms[userModal.role] || roleDefaultPerms.member
      if (userModal.mode === 'add') {
        state.users.push({ id:makeId('user'), display_name:userModal.name.trim(), role:userModal.role, permissions:[...defaultPerms] })
      } else {
        const u = state.users.find(x => x.id === userModal.id)
        if (u) {
          const roleChanged = u.role !== userModal.role
          u.display_name = userModal.name.trim()
          u.role = userModal.role
          if (roleChanged) u.permissions = [...defaultPerms]
        }
      }
      persistAppState()
      userModal.show = false
    }
    const deleteUser = u => {
      if (!can('user.delete')) return alert('无删除用户权限')
      if (u.id===state.currentUserId) return alert('不能删除当前登录用户')
      if (!confirm('确认删除？')) return
      state.users=state.users.filter(x=>x.id!==u.id); persistAppState()
    }
    const togglePerm = (u, code) => {
      if (!can('permission.assign')) return alert('无权限分配权限')
      if ((u.permissions||[]).includes('*')) return alert('管理员拥有全部权限')
      const s=new Set(u.permissions||[])
      s.has(code)?s.delete(code):s.add(code)
      u.permissions=[...s]; persistAppState()
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
        state.metricRegistry.unshift({ id:makeId('metric'), key:metricModal.key.trim()||'new_metric', label:metricModal.label.trim(), module:metricModal.module, unit:metricModal.unit, note:metricModal.note })
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
    const productModal = Vue.reactive({ show:false, mode:'', pid:'', newPid:'', name:'', cat:'配饰', isCustom:false })
    const openAddProduct = () => {
      if (!can('product.create')) return alert('无新增商品权限')
      Object.assign(productModal, { show:true, mode:'add', pid:'', newPid:'', name:'', cat:'配饰', isCustom:true })
    }
    const openEditProduct = p => {
      if (!can('product.edit')) return alert('无编辑商品权限')
      Object.assign(productModal, { show:true, mode:'edit', pid:p.pid, newPid:p.pid, name:p.name, cat:p.cat, isCustom:!!p.isCustom })
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
          // rename PID for custom product
          const cp = (state.customProducts||[]).find(p => p.pid === productModal.pid)
          if (cp) { cp.pid = newPid; cp.name = productModal.name.trim(); cp.cat = productModal.cat }
          delete state.productOverrides[productModal.pid]
          if (!state.pidRemaps) state.pidRemaps = {}
          state.pidRemaps[productModal.pid] = newPid
        } else {
          state.productOverrides[productModal.pid] = { name: productModal.name.trim(), cat: productModal.cat }
        }
      }
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

    return {
      me,users,metrics,permGroups,PERM_LABELS,expandedUserId,toggleExpand,meetings,can,setMe,
      userModal,openAddUser,openEditUser,saveUserModal,deleteUser,togglePerm,
      metricModal,openAddMetric,openEditMetric,saveMetricModal,deleteMetric,
      meetingModal,openAddMeeting,openEditMeeting,saveMeetingModal,deleteMeeting,
      actions,ACTION_TYPES,actionModal,openAddAction,openEditAction,saveActionModal,deleteAction,
      exportState,importState,
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
    <div class="card-header" style="margin-bottom:10px"><span class="card-title">当前角色</span><span class="card-sub">切换后前端权限即时生效</span></div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <select :value="me?.id" @change="setMe($event.target.value)" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;background:#fff">
        <option v-for="u in (users || [])" :key="u.id" :value="u.id">{{ u.display_name }}（{{ u.role }}）</option>
      </select>
      <div style="font-size:11px;color:var(--muted)">切换不同角色可验证新增/编辑/删除的权限控制效果</div>
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
                {{ u.role==='admin'?'管理员':u.role==='ops'?'运营':'成员' }}
              </span>
            </div>
            <div style="font-size:11px;color:var(--muted)">
              <span v-if="(u.permissions||[]).includes('*')" style="color:#16a34a;font-weight:600">全部权限</span>
              <span v-else>{{ (u.permissions||[]).length }} 项权限已开启</span>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:6px" @click.stop>
              <button @click="openEditUser(u)" style="border:1px solid var(--border);background:#fff;border-radius:7px;padding:4px 10px;font-size:11px;cursor:pointer">编辑</button>
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
          <div><span class="card-title">指标配置</span><span class="card-sub">可新增自定义指标</span></div>
          <button @click="openAddMetric" style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer">新增指标</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:240px;overflow:auto">
          <div v-for="m in (metrics || [])" :key="m.id" style="padding:10px;border:1px solid var(--border);border-radius:10px;background:#fafaf9">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
              <div style="font-size:12px;font-weight:700">{{ m.label }}</div>
              <div style="display:flex;gap:5px">
                <button @click="openEditMetric(m)" style="border:1px solid var(--border);background:#fff;border-radius:6px;padding:3px 7px;font-size:11px;cursor:pointer">编辑</button>
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
          <div v-for="m in (meetings || [])" :key="m.id" style="padding:10px;border:1px solid var(--border);border-radius:10px;background:#fafaf9">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px">
              <div>
                <div style="font-size:12px;font-weight:700">{{ m.title }}</div>
                <div style="font-size:11px;color:var(--muted)">{{ m.meeting_date }} · {{ m.week_label }}</div>
              </div>
              <div style="display:flex;gap:5px;flex-shrink:0">
                <button @click="openEditMeeting(m)" style="border:1px solid var(--border);background:#fff;border-radius:6px;padding:3px 7px;font-size:11px;cursor:pointer">编辑</button>
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
      <div v-for="(a, ai) in (actions || [])" :key="a.id"
        :style="{display:'grid',gridTemplateColumns:'90px 96px minmax(0,1fr) minmax(0,2fr) 100px',padding:'8px 14px',borderBottom:ai<actions.length-1?'1px solid var(--border)':'none',alignItems:'center'}">
        <div>
          <span style="padding:2px 7px;border-radius:99px;font-size:11px;font-weight:600;background:#f0fdf4;color:#16a34a">{{ a.action_type }}</span>
        </div>
        <div style="font-size:12px;color:var(--muted)">{{ a.action_date }}</div>
        <div style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px">
          {{ a.pid ? productNameByPid(a.pid) : (a.pids?.length > 0 ? (a.pids.includes('*') ? '全部商品' : a.pids.length + '个商品') : '—') }}
        </div>
        <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px">{{ a.note || a.content || '—' }}</div>
        <div style="display:flex;justify-content:flex-end;gap:5px">
          <button @click="openEditAction(a)" style="border:1px solid var(--border);background:#fff;border-radius:6px;padding:3px 7px;font-size:11px;cursor:pointer">编辑</button>
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
      <div v-for="(p, pi) in (allProductsForManage || [])" :key="p.pid"
        :style="{display:'grid',gridTemplateColumns:'minmax(0,2fr) 64px 60px 120px',padding:'8px 14px',borderBottom:pi<allProductsForManage.length-1?'1px solid var(--border)':'none',alignItems:'center',background:p.hidden?'#fafaf9':'#fff'}">
        <div style="min-width:0">
          <div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :style="{opacity:p.hidden?0.4:1}">{{ p.name }}</div>
          <div style="font-size:10px;color:var(--muted)">{{ p.pid }}</div>
        </div>
        <div style="font-size:11px;color:var(--muted)">{{ p.cat }}</div>
        <div>
          <span v-if="p.isCustom" style="font-size:10px;padding:2px 6px;border-radius:99px;background:#dbeafe;color:#1e40af;font-weight:600">自定义</span>
          <span v-if="p.hidden" style="font-size:10px;padding:2px 6px;border-radius:99px;background:#f3f4f6;color:#71717a">已隐藏</span>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:5px">
          <button @click="openEditProduct(p)" style="border:1px solid var(--border);background:#fff;border-radius:6px;padding:3px 7px;font-size:11px;cursor:pointer">编辑</button>
          <button @click="toggleHideProduct(p.pid)" style="border:1px solid var(--border);background:#fff;border-radius:6px;padding:3px 7px;font-size:11px;cursor:pointer">{{ p.hidden ? '显示' : '隐藏' }}</button>
          <button v-if="p.isCustom" @click="deleteCustomProduct(p.pid)" style="border:1px solid #fecaca;background:#fff;color:#dc2626;border-radius:6px;padding:3px 7px;font-size:11px;cursor:pointer">删除</button>
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

</div>`
})
