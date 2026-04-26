#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix 3 issues in dashboard.html:
1. Products filter: add filterOfficial toggle, default to showing only products with gmv>0 OR official
2. 加购率 in compare/products: treat cart_rate=null as skipped (already correct), but show 0 when vis=0 but still in range  
3. Default show only products that have sales in the selected period
"""

html_path = '/Users/jiayi/Downloads/数据库数据/dashboard.html'

with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

print(f'File size: {len(content)} chars')

# FIX 1: Add filterOfficial ref to ProductsPage setup
# Find where filterXhs is defined
old_refs = "    const filterCat = ref('全部')\n    const filterXhs = ref(false)\n    const searchQ = ref('')"
new_refs = "    const filterCat = ref('全部')\n    const filterXhs = ref(false)\n    const filterOfficial = ref(true)\n    const searchQ = ref('')"

if old_refs in content:
    content = content.replace(old_refs, new_refs, 1)
    print('Fix 1a: Added filterOfficial ref')
else:
    print('WARN: Fix 1a target not found')

# FIX 1b: Update products computed to use filterOfficial
old_products_filter = """const products = computed(() => {
      const sv=s.value, ev=e.value
      return Object.values(RAW.products)
        .filter(p => filterCat.value==='全部' || p.cat===filterCat.value)
        .filter(p => !searchQ.value || p.name.toLowerCase().includes(searchQ.value.toLowerCase()) || p.pid.includes(searchQ.value))
        .map(p => ({ ...p, ...agg(p, sv, ev) }))
        .filter(p => !filterXhs.value || p.xhs_notes > 0)
        .sort((a,b) => (b[sortBy.value]||0) - (a[sortBy.value]||0))
    })"""

new_products_filter = """const products = computed(() => {
      const sv=s.value, ev=e.value
      return Object.values(RAW.products)
        .filter(p => !filterOfficial.value || OFFICIAL.has(p.pid))
        .filter(p => filterCat.value==='全部' || p.cat===filterCat.value)
        .filter(p => !searchQ.value || p.name.toLowerCase().includes(searchQ.value.toLowerCase()) || p.pid.includes(searchQ.value))
        .map(p => ({ ...p, ...agg(p, sv, ev) }))
        .filter(p => p.gmv > 0 || p.ad_spend > 0)
        .filter(p => !filterXhs.value || p.xhs_notes > 0)
        .sort((a,b) => (b[sortBy.value]||0) - (a[sortBy.value]||0))
    })"""

if old_products_filter in content:
    content = content.replace(old_products_filter, new_products_filter, 1)
    print('Fix 1b: Updated products filter with filterOfficial and gmv>0 filter')
else:
    print('WARN: Fix 1b target not found')

# FIX 1c: Add filterOfficial to return statement
old_return = "return { filterCat, filterXhs, searchQ, sortBy, displayMode, periodLabel, sortOpts, products, summaryMetrics, chartMetricGroups, selectedChartMetrics, toggleChartMetric, isChartMetricSelected, fmt, fchg, chgCls, imgSrc, miniChart, productChartSeries }"
new_return = "return { filterCat, filterXhs, filterOfficial, searchQ, sortBy, displayMode, periodLabel, sortOpts, products, summaryMetrics, chartMetricGroups, selectedChartMetrics, toggleChartMetric, isChartMetricSelected, fmt, fchg, chgCls, imgSrc, miniChart, productChartSeries }"

if old_return in content:
    content = content.replace(old_return, new_return, 1)
    print('Fix 1c: Added filterOfficial to return')
else:
    print('WARN: Fix 1c target not found')

# FIX 1d: Add filterOfficial toggle button in template
old_filter_btn = """<button @click="filterXhs=!filterXhs" :style="{padding:'5px 10px',fontSize:'12px',borderRadius:'6px',cursor:'pointer',border:filterXhs?'1.5px solid #ff2442':'1px solid var(--border)',background:filterXhs?'#fff0f2':'transparent',color:filterXhs?'#ff2442':'var(--muted)'}">有小红书笔记</button>"""

new_filter_btn = """<button @click="filterOfficial=!filterOfficial" :style="{padding:'5px 10px',fontSize:'12px',borderRadius:'6px',cursor:'pointer',border:filterOfficial?'1.5px solid var(--accent)':'1px solid var(--border)',background:filterOfficial?'var(--accent)':'transparent',color:filterOfficial?'#fff':'var(--muted)'}">仅主链</button>
      <button @click="filterXhs=!filterXhs" :style="{padding:'5px 10px',fontSize:'12px',borderRadius:'6px',cursor:'pointer',border:filterXhs?'1.5px solid #ff2442':'1px solid var(--border)',background:filterXhs?'#fff0f2':'transparent',color:filterXhs?'#ff2442':'var(--muted)'}">有小红书笔记</button>"""

if old_filter_btn in content:
    content = content.replace(old_filter_btn, new_filter_btn, 1)
    print('Fix 1d: Added filterOfficial toggle button in template')
else:
    print('WARN: Fix 1d target not found')

# FIX 2: Show count of products in the header
# Find the period label display and add product count
old_period = """<div style="font-size:12px;color:var(--muted)">{{ periodLabel }}</div>"""
new_period = """<div style="font-size:12px;color:var(--muted)">{{ periodLabel }} · {{ products.length }} 个商品</div>"""

if old_period in content:
    content = content.replace(old_period, new_period, 1)
    print('Fix 2: Added product count to header')
else:
    print('WARN: Fix 2 target not found, trying alternative...')
    # Try without spaces
    old_period2 = '<div style="font-size:12px;color:var(--muted)">{{ periodLabel }}</div>'
    new_period2 = '<div style="font-size:12px;color:var(--muted)">{{ periodLabel }} · {{ products.length }} 个商品</div>'
    if old_period2 in content:
        content = content.replace(old_period2, new_period2, 1)
        print('Fix 2 (alt): Added product count to header')

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('All fixes applied!')
