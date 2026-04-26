// ── InteractiveTrendChart.js ──────────────────────────────────
// 自定义 SVG 折线/柱状图组件。依赖：Vue 全局（defineComponent / ref / computed）。

const InteractiveTrendChart = defineComponent({
  name: 'InteractiveTrendChart',
  props: ['series', 'height', 'normalize', 'activeKeyProp'],
  setup(props) {
    const activeKey = ref('')
    const tooltip = ref(null)
    const W = computed(() => 760)
    const H = computed(() => props.height || 220)
    const pad = { L: 16, R: 12, T: 18, B: 24 }

    const labels = computed(() => [...new Set((props.series||[]).flatMap(s => (s.values||[]).map(v => v.d)))].sort())
    const plotted = computed(() => {
      const ls = labels.value
      const baseVals = (props.series||[]).flatMap(s => (s.values||[]).map(v => v.value).filter(v => v != null))
      const gMin = Math.min(...baseVals, 0)
      const gMax = Math.max(...baseVals, 1)
      return (props.series||[]).map(s => {
        const ownVals = (s.values||[]).map(v => v.value).filter(v => v != null)
        const sMin = Math.min(...ownVals, 0)
        const sMax = Math.max(...ownVals, 1)
        const xOf = d => pad.L + (ls.indexOf(d) / Math.max(ls.length - 1, 1)) * (W.value - pad.L - pad.R)
        const yOf = v => {
          const min = props.normalize ? sMin : gMin
          const max = props.normalize ? sMax : gMax
          return H.value - pad.B - ((v - min) / ((max - min) || 1)) * (H.value - pad.T - pad.B)
        }
        return {
          ...s,
          points: (s.values||[]).map(v => ({
            ...v,
            x: xOf(v.d),
            y: v.value != null ? yOf(v.value) : null,
          })).filter(v => v.x != null)
        }
      }).filter(s => s.points.length)
    })

    const gridYs = computed(() => [0,.25,.5,.75,1].map(p => pad.T + p*(H.value-pad.T-pad.B)))
    const tickStep = computed(() => Math.max(1, Math.ceil(labels.value.length / 8)))
    const barWidth = computed(() => Math.max(8, ((W.value - pad.L - pad.R) / Math.max(labels.value.length,1)) * 0.42))

    // 计算需要渲染的 X 轴刻度，避免最后标签与前一个刻度重叠，边缘用 start/end 锚点防截断
    const tickLabels = computed(() => {
      const ls = labels.value
      const n = ls.length
      if (!n) return []
      const step = tickStep.value
      const result = []
      for (let i = 0; i < n; i += step) {
        result.push({ d: ls[i], i, anchor: i === 0 ? 'start' : 'middle' })
      }
      // 只在最后标签距前一个刻度至少半个 step 间距时才追加（否则重叠）
      const lastIdx = n - 1
      const prevIdx = result[result.length - 1]?.i ?? 0
      if (lastIdx > prevIdx && (lastIdx - prevIdx) * 2 >= step) {
        result.push({ d: ls[lastIdx], i: lastIdx, anchor: 'end' })
      }
      return result
    })
    const pathD = pts => {
      let d = '', started = false
      for (const p of pts) {
        if (p.y == null) continue
        d += (started ? 'L' : 'M') + ` ${p.x.toFixed(1)} ${p.y.toFixed(1)} `
        started = true
      }
      return d.trim()
    }
    const gapBridgeD = _pts => []
    // 检测孤立点（前后邻近点均为 null）
    const isIsolated = (pts, idx) => {
      const prev = pts[idx - 1]
      const next = pts[idx + 1]
      return (!prev || prev.y == null) && (!next || next.y == null)
    }
    const mergedActiveKey = computed(() => props.activeKeyProp || activeKey.value)
    const isDim = key => mergedActiveKey.value && mergedActiveKey.value !== key
    const onLegend = key => { activeKey.value = key; tooltip.value = null }
    const onLeave = () => { activeKey.value = ''; tooltip.value = null }
    const onPoint = (series, point) => {
      activeKey.value = series.key
      tooltip.value = {
        x: Math.max(12, Math.min(point.x + 10, W.value - 170)),
        y: Math.max(12, point.y - 56),
        title: series.name,
        date: point.d,
        value: point.label || point.value,
        color: series.color,
      }
    }
    return { W, H, pad, labels, plotted, gridYs, tickStep, tickLabels, barWidth, pathD, gapBridgeD, isIsolated, activeKey, mergedActiveKey, tooltip, isDim, onLegend, onLeave, onPoint }
  },
  template: `
<div style="width:100%">
  <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:8px">
    <div v-for="s in plotted" :key="s.key" @mouseenter="onLegend(s.key)" @mouseleave="onLeave"
         :style="{display:'inline-flex',alignItems:'center',gap:'6px',cursor:'pointer',opacity:isDim(s.key)?0.35:1}">
      <span :style="{width:'10px',height:'10px',borderRadius:'999px',background:s.color,display:'inline-block'}"></span>
      <span style="font-size:12px;color:#94a3b8;font-weight:600">{{ s.name }}</span>
    </div>
  </div>
  <div style="position:relative;width:100%;overflow:hidden">
    <svg :viewBox="'0 0 ' + W + ' ' + H" style="width:100%;display:block;overflow:visible">
      <line v-for="y in gridYs" :key="y" :x1="pad.L" :y1="y" :x2="W-pad.R" :y2="y" stroke="#edf2f7" stroke-width="1"/>
      <g v-for="(s,sidx) in plotted" :key="s.key" @mouseenter="onLegend(s.key)" @mouseleave="onLeave" style="cursor:pointer">
        <template v-if="s.type==='bar'">
          <template v-for="p in s.points" :key="s.key + p.d"><rect v-if="p.y != null" :x="p.x - barWidth/2 + sidx*(barWidth/Math.max(plotted.length,1))" :y="p.y" :width="Math.max(4, barWidth/Math.max(plotted.length,1)-1)" :height="Math.max(2, H-pad.B-p.y)"
                :rx="3" :fill="s.color" :opacity="mergedActiveKey?(mergedActiveKey===s.key?0.9:0.14):0.72"
                @mouseenter="onPoint(s,p)" @mouseleave="onLeave"/></template>
        </template>
        <template v-else>
          <path :d="pathD(s.points)" fill="none" :stroke="s.color" :stroke-width="mergedActiveKey===s.key?3:2" :opacity="mergedActiveKey?(mergedActiveKey===s.key?1:0.16):0.95" stroke-linecap="round" stroke-linejoin="round"/>
          <template v-for="(bridge,bi) in gapBridgeD(s.points)" :key="s.key+'br'+bi">
            <path :d="bridge" fill="none" :stroke="s.color" stroke-width="1.2" stroke-dasharray="4,4" :opacity="mergedActiveKey?(mergedActiveKey===s.key?0.45:0.08):0.35" stroke-linecap="round"/>
          </template>
          <template v-for="(p,pi) in s.points" :key="s.key + p.d">
            <template v-if="p.y != null && isIsolated(s.points, pi)">
              <polygon :points="p.x+','+(p.y-6)+' '+(p.x+5)+','+p.y+' '+p.x+','+(p.y+6)+' '+(p.x-5)+','+p.y"
                :fill="s.color" :opacity="mergedActiveKey?(mergedActiveKey===s.key?1:0.16):0.95"
                @mouseenter="onPoint(s,p)" @mouseleave="onLeave"/>
            </template>
            <template v-else>
              <circle v-if="p.y != null" :cx="p.x" :cy="p.y" :r="mergedActiveKey===s.key?4:3"
                :fill="s.color" :opacity="mergedActiveKey?(mergedActiveKey===s.key?1:0.16):0.95"
                @mouseenter="onPoint(s,p)" @mouseleave="onLeave"/>
            </template>
          </template>
        </template>
      </g>
      <text v-for="t in tickLabels" :key="t.d"
        :x="pad.L + (t.i/Math.max(labels.length-1,1))*(W-pad.L-pad.R)"
        :y="H-8" :text-anchor="t.anchor" fill="#94a3b8" font-size="10">{{ t.d.slice(5) }}</text>
    </svg>
    <div v-if="tooltip" :style="{position:'absolute',left:tooltip.x+'px',top:tooltip.y+'px',background:'#111827',color:'#fff',padding:'8px 10px',borderRadius:'8px',fontSize:'11px',pointerEvents:'none',minWidth:'140px',boxShadow:'0 10px 30px rgba(15,23,42,.18)'}">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span :style="{width:'8px',height:'8px',borderRadius:'999px',background:tooltip.color,display:'inline-block'}"></span><span style="font-weight:700">{{ tooltip.title }}</span></div>
      <div style="opacity:.8;margin-bottom:2px">{{ tooltip.date }}</div>
      <div style="font-size:12px;font-weight:700">{{ tooltip.value }}</div>
    </div>
  </div>
</div>`
})
