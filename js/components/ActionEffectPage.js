// ── ActionEffectPage.js ─────────────────────────────────
// 运营动作效果分析页组件。

const ActionEffectPage = defineComponent({
  name: 'ActionEffectPage',
  setup() {
    const allActions = computed(() => APP_STATE.value.actions || [])
    const actionTypes = computed(() => [...new Set(allActions.value.map(a => a.action_type).filter(Boolean))])
    const selectedType = ref('')
    const nDays = ref(7)
    const selectedMetric = ref('pay')
    const COLORS = ['#2563eb','#16a34a','#d97706','#9333ea','#e11d48','#0891b2','#65a30d','#7c3aed']
    const metricOptions = [
      { key:'pay', label:'成交额' }, { key:'vis', label:'进店UV' },
      { key:'cart', label:'加购' }, { key:'collect', label:'收藏加购' }, { key:'cart_rate', label:'加购率' },
      { key:'conv_rate', label:'转化率' }, { key:'ad_roi', label:'ROI' }, { key:'new_buyers', label:'新客数' },
      { key:'pv', label:'浏览量' }, { key:'dwell_time', label:'停留时长' },
      { key:'bounce_rate', label:'跳出率' }, { key:'fav_cart_users', label:'收藏加购人数' }, { key:'search_vis', label:'搜索引导UV' },
    ]
    watch(actionTypes, v => { if (!selectedType.value && v.length) selectedType.value = v[0] }, { immediate:true })

    function getProd(pid) { return RAW.products?.[pid] || null }
    function expandPids(a) {
      if (!a.pids || !a.pids.length) return [a.pid].filter(Boolean)
      if (a.pids.includes('*')) return RAW.official_pids || []
      return a.pids
    }
    function getWindow(pid, actionDate, n) {
      const p = getProd(pid); if (!p) return []
      const center = new Date(actionDate)
      return Array.from({ length: n*2+1 }, (_,i) => {
        const offset = i - n
        const d = new Date(center); d.setDate(center.getDate()+offset)
        const ds = d.toISOString().slice(0,10)
        const idx = p.dates.indexOf(ds)
        const vis = idx>=0?(p.vis?.[idx]||0):null, cart = idx>=0?(p.cart?.[idx]||0):null
        const pay = idx>=0?(p.pay?.[idx]||0):null
        const spend = idx>=0?(p.spend?.[idx]||0):null
        // 真 ROI = 推广带来的 GMV ÷ 推广花费（不是 全店GMV/spend，那是 PSR 销售杠杆）
        const adGmv = idx>=0?((p.roi?.[idx]||0)*(spend||0)):null
        // 转化率分子 = 支付买家数(优先 pay_buyers,缺则 new+old);避免和加购率混
        const payBuyers = idx>=0
          ? (p.pay_buyers?.[idx] ?? ((p.new_buyers?.[idx]||0)+(p.old_buyers?.[idx]||0)))
          : null
        return { offset, date:ds,
          pay,
          vis,   cart,
          collect: idx>=0?((p.collect?.[idx]||0)+(p.cart?.[idx]||0)):null,
          cart_rate: vis!=null&&vis>0?(cart/vis*100):null,
          conv_rate: vis!=null&&vis>0&&payBuyers!=null?(payBuyers/vis*100):null,
          ad_roi: spend!=null&&spend>0&&adGmv!=null?(adGmv/spend):null,
          psr:    spend!=null&&spend>0&&pay!=null?(pay/spend):null,  // 销售杠杆：全店GMV/花费
          new_buyers: idx>=0?(p.new_buyers?.[idx]||0):null,
          pv: idx>=0?(p.pv?.[idx]??null):null,
          dwell_time: idx>=0?(p.dwell_time?.[idx]??null):null,
          bounce_rate: idx>=0?(p.bounce_rate?.[idx]??null):null,
          fav_cart_users: idx>=0?(p.fav_cart_users?.[idx]??null):null,
          search_vis: idx>=0?(p.search_vis?.[idx]??null):null }
      })
    }
    function computeBA(pid, actionDate) {
      const rows = getWindow(pid, actionDate, nDays.value)
      const metric = selectedMetric.value
      const before = rows.filter(r=>r.offset<0&&r[metric]!=null)
      const after  = rows.filter(r=>r.offset>0&&r[metric]!=null)
      const avg = arr => arr.length ? arr.reduce((s,r)=>s+r[metric],0)/arr.length : null
      const bA=avg(before), aA=avg(after)
      return { before:bA, after:aA, chg:bA!=null&&bA>0?(aA-bA)/bA*100:null }
    }
    const productRows = computed(() => {
      if (!selectedType.value) return []
      const acts = allActions.value.filter(a=>a.action_type===selectedType.value&&a.action_date)
      const pidMap = {}
      for (const a of acts) {
        for (const pid of expandPids(a)) {
          if (!pidMap[pid]||a.action_date>pidMap[pid].action_date) pidMap[pid]={...a,pid}
        }
      }
      return Object.values(pidMap).filter(r=>getProd(r.pid)).sort((a,b)=>b.action_date.localeCompare(a.action_date))
    })
    const selectedPids = ref([])
    watch(productRows, rows => { selectedPids.value = rows.slice(0,5).map(r=>r.pid) }, { immediate:true })
    const togglePid = pid => { const i=selectedPids.value.indexOf(pid); i>=0?selectedPids.value.splice(i,1):selectedPids.value.push(pid) }

    const CHART_W=520, CHART_H=120, PL=10, PR=10, PT=12, PB=20
    const chartData = computed(() => {
      const n=nDays.value, metric=selectedMetric.value
      const rows=productRows.value.filter(r=>selectedPids.value.includes(r.pid))
      if (!rows.length) return {series:[],xLabels:[],zeroX:0,chartW:CHART_W,chartH:CHART_H,toX:i=>i,toY:v=>v}
      const xLen=n*2+1
      const xLabels=Array.from({length:xLen},(_,i)=>i-n)
      const series=rows.map((row,ci)=>{
        const win=getWindow(row.pid,row.action_date,n)
        const vals=win.map(r=>r[metric])
        return {pid:row.pid,name:getProd(row.pid)?.name||row.pid,color:COLORS[ci%COLORS.length],vals}
      })
      const allVals=series.flatMap(s=>s.vals).filter(v=>v!=null)
      const yMax=allVals.length?Math.max(...allVals)*1.15:1
      const W=CHART_W-PL-PR, H=CHART_H-PT-PB
      const toX=i=>PL+(i/(xLen-1))*W, toY=v=>PT+H-(v/yMax)*H
      const paths=series.map(s=>{
        const pts=s.vals.map((v,i)=>v!=null?`${toX(i).toFixed(1)},${toY(v).toFixed(1)}`:null)
        let d=''
        for (let i=0;i<pts.length;i++) { if (!pts[i]) continue; if (!d||!pts[i-1]) d+=`M ${pts[i]}`; else d+=` L ${pts[i]}` }
        return {...s,d}
      })
      return {series:paths,xLabels,yMax,toX,toY,zeroX:toX(n).toFixed(1),chartW:CHART_W,chartH:CHART_H}
    })
    const metricCards = computed(() =>
      productRows.value.filter(r=>selectedPids.value.includes(r.pid)).map((row,ci)=>{
        const ba=computeBA(row.pid,row.action_date)
        return {pid:row.pid,name:getProd(row.pid)?.name||row.pid,action_date:row.action_date,color:COLORS[ci%COLORS.length],...ba}
      })
    )
    function fmtVal(v,m){
      if(v==null)return'—'
      if(m==='pay'||m==='gmv')return v>=10000?'¥'+(v/10000).toFixed(1)+'万':'¥'+Math.round(v)
      if(m==='cart_rate'||m==='conv_rate'||m==='bounce_rate')return v.toFixed(2)+'%'
      if(m==='ad_roi')return v.toFixed(2)+'x'
      if(m==='dwell_time')return v>=60?(v/60).toFixed(1)+'min':Math.round(v)+'s'
      return Math.round(v).toLocaleString()
    }
    const chgCls=v=>v==null?'flat':v>0?'up':v<0?'dn':'flat'
    const chgTxt=v=>v==null?'—':(v>0?'+':'')+v.toFixed(1)+'%'
    const imgSrc=pid=>(APP_STATE.value.imageOverrides||{})[pid]||RAW.img_map?.[pid]||''
    const metricLabel=computed(()=>metricOptions.find(m=>m.key===selectedMetric.value)?.label||'')
    const showMetricGuide = ref(false)
    const guideKeys = ['action_effect','gmv','vis','cart_rate','conv_rate','ad_roi','new_buyers','pv','dwell_time','bounce_rate','fav_cart_users','search_vis']
    const guideItems = guideKeys.map(k => ({ key:k, label:METRIC_TIPS[k]?.label||k, tip:METRIC_TIPS[k]?.tip||'' })).filter(i => i.tip)

    // ── 任务看板 ──────────────────────────────────────────────
    const me = computed(() => {
      const s = APP_STATE.value
      return (s.users||[]).find(u => u.id === s.currentUserId) || (s.users||[])[0]
    })
    const can = code => hasPermission(me.value, code)
    const productNameByPid = pid => RAW.products?.[pid]?.name || pid

    const TASK_STATUS = ['待开始','进行中','已完成','已暂停']
    const ACTION_TYPES = ['主图更新','价格调整','词包优化','直播推广','达人合作','活动报名','详情页优化','货品补充','改主图','投放启动','seeding','标题优化','其他']
    const showTaskBoard = ref(true)
    const taskTypeFilter = ref('')

    const filteredTasks = computed(() => {
      const acts = allActions.value
      if (!taskTypeFilter.value) return acts
      return acts.filter(a => a.action_type === taskTypeFilter.value)
    })

    const taskModal = Vue.reactive({ show:false, mode:'', id:'', action_type:'主图更新', action_date:new Date().toISOString().slice(0,10), pid:'', pids_str:'', title:'', owner:'', status:'待开始', note:'' })
    const manualProductOptions = computed(() => Object.values(RAW.products||{}).map(p=>({pid:p.pid,name:p.name})))

    const openAddTask = () => {
      if (!can('action.create')) return alert('无新增动作权限')
      Object.assign(taskModal, { show:true, mode:'add', id:'', action_type:'主图更新', action_date:new Date().toISOString().slice(0,10), pid:'', pids_str:'', title:'', owner:me.value?.display_name||'', status:'待开始', note:'' })
    }
    const openEditTask = a => {
      if (!can('action.edit')) return alert('无编辑动作权限')
      Object.assign(taskModal, { show:true, mode:'edit', id:a.id, action_type:a.action_type||'其他', action_date:a.action_date||'', pid:a.pid||'', pids_str:(a.pids||[]).filter(x=>x!=='*').join(','), title:a.title||'', owner:a.owner||'', status:a.status||'待开始', note:a.note||a.content||'' })
    }
    const saveTaskModal = () => {
      if (!taskModal.action_date) return alert('请选择执行日期')
      const state = APP_STATE.value
      if (!state.actions) state.actions = []
      const pids = taskModal.pids_str ? taskModal.pids_str.split(',').map(s=>s.trim()).filter(Boolean) : (taskModal.pid ? [taskModal.pid] : [])
      if (taskModal.mode === 'add') {
        state.actions.unshift({ id:makeId('action'), action_type:taskModal.action_type, action_date:taskModal.action_date, pid:taskModal.pid, title:taskModal.title, owner:taskModal.owner, status:taskModal.status, note:taskModal.note, pids })
      } else {
        const a = state.actions.find(x => x.id === taskModal.id)
        if (a) { a.action_type=taskModal.action_type; a.action_date=taskModal.action_date; a.pid=taskModal.pid; a.title=taskModal.title; a.owner=taskModal.owner; a.status=taskModal.status; a.note=taskModal.note; a.pids=pids }
      }
      persistAppState(); taskModal.show = false
    }
    const deleteTask = a => {
      if (!can('action.delete')) return alert('无删除动作权限')
      if (!confirm('确认删除该运营动作？')) return
      APP_STATE.value.actions = (APP_STATE.value.actions||[]).filter(x => x.id !== a.id)
      persistAppState()
    }
    const updateTaskStatus = (a, newStatus) => {
      if (!can('action.edit')) return alert('无编辑权限')
      a.status = newStatus
      persistAppState()
    }
    const statusColor = s => ({ '待开始':'#6b7280', '进行中':'#2563eb', '已完成':'#16a34a', '已暂停':'#d97706' }[s] || '#6b7280')
    const statusBg   = s => ({ '待开始':'#f3f4f6', '进行中':'#dbeafe', '已完成':'#dcfce7', '已暂停':'#fef3c7' }[s] || '#f3f4f6')

    return {allActions,actionTypes,selectedType,nDays,selectedMetric,metricOptions,metricLabel,
      productRows,selectedPids,togglePid,chartData,metricCards,
      fmtVal,chgCls,chgTxt,imgSrc,COLORS,computeBA,getProd,
      showMetricGuide,guideItems,
      showTaskBoard,taskTypeFilter,filteredTasks,taskModal,manualProductOptions,
      TASK_STATUS,ACTION_TYPES,openAddTask,openEditTask,saveTaskModal,deleteTask,updateTaskStatus,
      statusColor,statusBg,can,productNameByPid}
  },
  template: `
<div style="display:flex;flex-direction:column;gap:16px">

  <!-- 任务看板 -->
  <div class="card" style="padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:15px;font-weight:700">任务看板</span>
        <span style="font-size:11px;color:var(--muted)">{{ allActions.length }} 条运营动作</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button v-if="can('action.create')" @click="openAddTask"
          style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;font-weight:600">+ 新增动作</button>
        <button @click="showTaskBoard=!showTaskBoard"
          style="border:1px solid var(--border);background:#fff;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;color:var(--muted)">
          {{ showTaskBoard ? '▲ 收起' : '▼ 展开' }}
        </button>
      </div>
    </div>
    <template v-if="showTaskBoard">
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 10px">
        <button @click="taskTypeFilter=''"
          :style="{padding:'4px 12px',fontSize:'11px',border:'1px solid var(--border)',borderRadius:'99px',cursor:'pointer',
            background:taskTypeFilter===''?'var(--accent)':'#fff',color:taskTypeFilter===''?'#fff':'var(--muted)'}">全部</button>
        <button v-for="t in actionTypes" :key="t" @click="taskTypeFilter=taskTypeFilter===t?'':t"
          :style="{padding:'4px 12px',fontSize:'11px',border:'1px solid var(--border)',borderRadius:'99px',cursor:'pointer',
            background:taskTypeFilter===t?'var(--accent)':'#fff',color:taskTypeFilter===t?'#fff':'var(--muted)'}">{{ t }}</button>
      </div>
      <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
        <div style="display:grid;grid-template-columns:80px minmax(0,2fr) 90px 100px 90px minmax(0,1.5fr) 120px;padding:7px 14px;background:#f8f8f7;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted)">
          <div>类型</div><div>标题</div><div>执行日</div><div>负责人</div><div>关联商品</div><div>备注</div><div style="text-align:center">状态 / 操作</div>
        </div>
        <div v-if="!filteredTasks.length" class="empty" style="padding:24px">暂无运营动作，点击「新增动作」</div>
        <div v-for="(a, ai) in filteredTasks" :key="a.id"
          :style="{display:'grid',gridTemplateColumns:'80px minmax(0,2fr) 90px 100px 90px minmax(0,1.5fr) 120px',padding:'9px 14px',
            borderBottom:ai<filteredTasks.length-1?'1px solid var(--border)':'none',alignItems:'center',background:'#fff'}">
          <div>
            <span :style="{padding:'2px 7px',borderRadius:'99px',fontSize:'10px',fontWeight:'600',background:'#f0fdf4',color:'#16a34a'}">{{ a.action_type }}</span>
          </div>
          <div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px">{{ a.title || a.note || '—' }}</div>
          <div style="font-size:11px;color:var(--muted)">{{ a.action_date }}</div>
          <div style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:6px">{{ a.owner || '—' }}</div>
          <div style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:6px">
            {{ a.pid ? productNameByPid(a.pid) : (a.pids?.includes('*') ? '全部' : a.pids?.length ? a.pids.length+'个' : '—') }}
          </div>
          <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px">{{ a.note||'—' }}</div>
          <div style="display:flex;align-items:center;gap:5px;justify-content:flex-end">
            <select :value="a.status||'待开始'" @change="updateTaskStatus(a,$event.target.value)"
              :style="{padding:'2px 6px',fontSize:'10px',fontWeight:'600',borderRadius:'99px',cursor:'pointer',border:'1px solid',outline:'none',
                borderColor:statusColor(a.status||'待开始'),color:statusColor(a.status||'待开始'),background:statusBg(a.status||'待开始')}">
              <option v-for="s in TASK_STATUS" :key="s" :value="s">{{ s }}</option>
            </select>
            <button @click="openEditTask(a)" style="border:1px solid var(--border);background:#fff;border-radius:6px;padding:2px 7px;font-size:10px;cursor:pointer">编辑</button>
            <button @click="deleteTask(a)" style="border:1px solid #fecaca;background:#fff;color:#dc2626;border-radius:6px;padding:2px 7px;font-size:10px;cursor:pointer">删除</button>
          </div>
        </div>
      </div>
    </template>
  </div>

  <!-- 任务编辑 Modal -->
  <div v-if="taskModal.show" style="position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:1000;display:flex;align-items:center;justify-content:center" @click.self="taskModal.show=false">
    <div style="background:#fff;border-radius:16px;padding:24px;width:480px;max-width:94vw;box-shadow:0 8px 32px rgba(0,0,0,.18);max-height:90vh;overflow-y:auto">
      <div style="font-size:16px;font-weight:700;margin-bottom:18px">{{ taskModal.mode==='add'?'新增运营动作':'编辑运营动作' }}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">动作类型</div>
          <select v-model="taskModal.action_type" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff">
            <option v-for="t in ACTION_TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">执行日期</div>
          <input type="date" v-model="taskModal.action_date" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px">
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">状态</div>
          <select v-model="taskModal.status" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff">
            <option v-for="s in TASK_STATUS" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">负责人</div>
          <input v-model="taskModal.owner" placeholder="如：晓东（运营）" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px">
        </div>
        <div style="grid-column:1/-1">
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">标题</div>
          <input v-model="taskModal.title" placeholder="动作标题" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px">
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">关联商品（单个）</div>
          <select v-model="taskModal.pid" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff">
            <option value="">— 不限定单品 —</option>
            <option v-for="p in manualProductOptions" :key="p.pid" :value="p.pid">{{ p.name }}</option>
          </select>
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">多品ID（逗号分隔，或留空）</div>
          <input v-model="taskModal.pids_str" placeholder="如：123,456 或留空" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px">
        </div>
        <div style="grid-column:1/-1">
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">备注</div>
          <textarea v-model="taskModal.note" rows="3" placeholder="备注说明" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;resize:vertical"></textarea>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button @click="taskModal.show=false" style="border:1px solid var(--border);background:#fff;border-radius:8px;padding:8px 16px;font-size:12px;cursor:pointer">取消</button>
        <button @click="saveTaskModal" style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:8px 16px;font-size:12px;cursor:pointer;font-weight:600">保存</button>
      </div>
    </div>
  </div>

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
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px">
      <div>
        <div style="font-size:16px;font-weight:700;margin-bottom:4px">运营动作效果分析</div>
        <div style="font-size:11px;color:var(--muted)">选择动作类型 → 查看执行商品前后指标变化；以动作日为原点，前后 N 天对比</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;color:var(--muted)">对比窗口</span>
        <select v-model.number="nDays" style="border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:12px;background:#fff">
          <option :value="7">前后 7 天</option><option :value="14">前后 14 天</option><option :value="21">前后 21 天</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button v-for="t in actionTypes" :key="t" @click="selectedType=t"
        :style="{padding:'5px 14px',fontSize:'12px',border:'1px solid var(--border)',borderRadius:'99px',cursor:'pointer',
          background:selectedType===t?'var(--accent)':'#fff',color:selectedType===t?'#fff':'var(--text)',fontWeight:selectedType===t?'600':'400'}">
        {{ t }}
      </button>
      <span v-if="!actionTypes.length" style="font-size:12px;color:var(--muted)">暂无运营动作数据</span>
    </div>
  </div>
  <template v-if="selectedType && productRows.length">
    <div class="card" style="padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span class="card-title">执行商品 · 最近一次记录</span>
        <span class="card-sub">{{ productRows.length }} 个商品，点击行选中/取消叠加</span>
      </div>
      <div style="display:flex;flex-direction:column;border:1px solid var(--border);border-radius:10px;overflow:hidden">
        <div style="display:grid;grid-template-columns:28px 44px minmax(0,2fr) 88px 100px 100px 80px;gap:0;padding:7px 14px;background:#f8f8f7;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--muted)">
          <div></div><div></div><div>商品</div><div>执行日</div>
          <div style="text-align:right">前{{nDays}}天均值</div><div style="text-align:right">后{{nDays}}天均值</div><div style="text-align:right">变化</div>
        </div>
        <div v-for="row in productRows" :key="row.pid" @click="togglePid(row.pid)"
          :style="{display:'grid',gridTemplateColumns:'28px 44px minmax(0,2fr) 88px 100px 100px 80px',gap:'0',padding:'8px 14px',
            borderBottom:'1px solid var(--border)',cursor:'pointer',
            background:selectedPids.includes(row.pid)?COLORS[selectedPids.indexOf(row.pid)%COLORS.length]+'14':'#fff'}">
          <div style="display:flex;align-items:center">
            <div :style="{width:'12px',height:'12px',borderRadius:'3px',flexShrink:0,
              border:'2px solid '+(selectedPids.includes(row.pid)?COLORS[selectedPids.indexOf(row.pid)%COLORS.length]:'var(--border)'),
              background:selectedPids.includes(row.pid)?COLORS[selectedPids.indexOf(row.pid)%COLORS.length]:'transparent'}"></div>
          </div>
          <div style="display:flex;align-items:center">
            <div style="width:34px;height:34px;border:1px solid var(--border);border-radius:6px;overflow:hidden;background:#f9f9f9">
              <img v-if="imgSrc(row.pid)" :src="imgSrc(row.pid)" style="width:100%;height:100%;object-fit:cover">
            </div>
          </div>
          <div style="display:flex;align-items:center;min-width:0;padding-right:8px">
            <div>
              <div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ getProd(row.pid)?.name || row.pid }}</div>
              <div style="font-size:10px;color:var(--muted)">{{ row.note||'' }}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;font-size:11px;color:var(--muted)">{{ row.action_date }}</div>
          <div style="display:flex;align-items:center;justify-content:flex-end;font-size:12px;font-weight:600">{{ fmtVal(computeBA(row.pid,row.action_date).before,selectedMetric) }}</div>
          <div style="display:flex;align-items:center;justify-content:flex-end;font-size:12px;font-weight:600">{{ fmtVal(computeBA(row.pid,row.action_date).after,selectedMetric) }}</div>
          <div style="display:flex;align-items:center;justify-content:flex-end">
            <span :class="['chg',chgCls(computeBA(row.pid,row.action_date).chg)]">{{ chgTxt(computeBA(row.pid,row.action_date).chg) }}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="card" style="padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <span class="card-title">前后趋势叠加（以动作日为 D0）</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button v-for="m in metricOptions" :key="m.key" @click="selectedMetric=m.key"
            :style="{padding:'3px 10px',fontSize:'11px',border:'1px solid var(--border)',borderRadius:'99px',cursor:'pointer',
              background:selectedMetric===m.key?'var(--accent)':'#fff',color:selectedMetric===m.key?'#fff':'var(--muted)'}">{{ m.label }}</button>
        </div>
      </div>
      <div v-if="chartData.series && chartData.series.length" style="overflow-x:auto;margin-bottom:10px">
        <svg :width="chartData.chartW" :height="chartData.chartH" style="display:block">
          <line :x1="chartData.zeroX" :x2="chartData.zeroX" :y1="12" :y2="chartData.chartH-20"
                stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.6"/>
          <text :x="chartData.zeroX" y="9" text-anchor="middle" font-size="9" fill="#ef4444">D0</text>
          <path v-for="s in chartData.series" :key="s.pid" :d="s.d" :stroke="s.color" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
          <template v-for="(lbl,li) in chartData.xLabels" :key="'xl'+li">
            <text v-if="lbl%7===0||lbl===0" :x="chartData.toX(li)" :y="chartData.chartH-4"
              text-anchor="middle" font-size="9" :fill="lbl===0?'#ef4444':'#a1a1aa'">{{ lbl===0?'D0':(lbl>0?'+':'')+lbl }}</text>
          </template>
        </svg>
      </div>
      <div v-else class="empty" style="padding:24px">请在上方勾选商品</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px">
        <div v-for="row in productRows.filter(r=>selectedPids.includes(r.pid))" :key="'leg'+row.pid"
             style="display:flex;align-items:center;gap:5px;font-size:11px">
          <div :style="{width:'16px',height:'3px',borderRadius:'2px',background:COLORS[selectedPids.indexOf(row.pid)%COLORS.length]}"></div>
          <span style="color:var(--muted);max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ (getProd(row.pid)?.name||row.pid).split(' ')[0] }}</span>
        </div>
      </div>
    </div>
    <div>
      <div style="font-size:12px;font-weight:600;margin-bottom:10px;color:var(--muted)">{{ metricLabel }} 指标对比卡（前{{nDays}}天 vs 后{{nDays}}天）</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px">
        <div v-for="card in metricCards" :key="'mc'+card.pid"
             style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div :style="{width:'10px',height:'10px',borderRadius:'2px',background:card.color,flexShrink:0}"></div>
            <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">{{ (card.name||'').split(' ').slice(0,3).join(' ') }}</div>
          </div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:8px">{{ metricLabel }} · 动作日 {{ card.action_date }}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
            <div><div style="font-size:10px;color:var(--muted);margin-bottom:2px">前{{nDays}}天均值</div><div style="font-size:15px;font-weight:700">{{ fmtVal(card.before,selectedMetric) }}</div></div>
            <div><div style="font-size:10px;color:var(--muted);margin-bottom:2px">后{{nDays}}天均值</div><div style="font-size:15px;font-weight:700">{{ fmtVal(card.after,selectedMetric) }}</div></div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding-top:8px;border-top:1px solid var(--border)">
            <span style="font-size:11px;color:var(--muted)">变化幅度</span>
            <span :class="['chg',chgCls(card.chg)]" style="font-size:13px;font-weight:700">{{ chgTxt(card.chg) }}</span>
          </div>
        </div>
      </div>
    </div>
  </template>
  <div v-else-if="selectedType" class="empty" style="padding:48px">该动作类型下暂无有效商品数据</div>
  <div v-else class="empty" style="padding:60px">请在上方选择动作类型</div>
</div>`
})

