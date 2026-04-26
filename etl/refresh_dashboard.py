# -*- coding: utf-8 -*-
"""
把本地最新底表数据写进 dashboard.html 的 RAW 块
用法: python etl/refresh_dashboard.py
"""
import json, csv, sys
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent))
from xls_reader import read_xls_stdlib

base = Path(__file__).parent.parent
html_path = base / 'dashboard.html'

print('[1] 读取 dashboard.html …')
html = html_path.read_text(encoding='utf-8')
start = html.index('const RAW = ')
end   = html.index('const OFFICIAL = new Set(RAW.official_pids)')
raw   = json.loads(html[start + len('const RAW = '):end].strip().rstrip('\n'))
product_ids = set(raw.get('cat_map', {}).keys()) | set(raw.get('products', {}).keys())
short_names = raw.get('short_names', {})
cat_map     = raw.get('cat_map', {})

def to_float(v):
    try:
        return float(str(v or '0').replace(',','').replace('%','').strip() or 0)
    except:
        return 0.0

# ── 生意参谋商品（所有 XLS） ────────────────────────────────────
print('[2] 读取生意参谋商品 XLS …')
syzt_rows = []; syzt_map = {}
xls_files = sorted((base / '生意参谋商品').glob('*.xls'))
for i, f in enumerate(xls_files):
    if i % 10 == 0:
        print(f'    {i+1}/{len(xls_files)} {f.name}')
    try:
        _, rows = read_xls_stdlib(str(f))
    except Exception as e:
        print(f'    WARN: {f.name}: {e}'); continue
    for row in rows:
        pid = str(row.get('商品ID','')).strip()
        if not pid or pid not in product_ids:
            continue
        d = str(row.get('统计日期','')).strip()[:10]
        if not d:
            continue
        pay  = to_float(row.get('支付金额'))
        vis  = to_float(row.get('商品访客数'))
        cart = to_float(row.get('商品加购人数'))
        syzt_rows.append({'d': d, 'pid': pid, 'pay': pay, 'vis': vis, 'cart': cart})
        syzt_map[(d, pid)] = {
            'pay':pay,'vis':vis,'cart':cart,
            'collect':  to_float(row.get('商品收藏人数')),
            'refund':   to_float(row.get('成功退款金额')),
            'new_buyers': to_float(row.get('支付新买家数')),
        }
print(f'    syzt 共 {len(syzt_rows)} 行')

# ── 万象台推广报表（最新一份 CSV） ──────────────────────────────
print('[3] 读取万象台商品报表 CSV …')
latest_csv = sorted((base / '推广报表' / '商品报表').glob('*.csv'))[-1]
print(f'    使用: {latest_csv.name}')
rows_csv = list(csv.DictReader(latest_csv.read_bytes().decode('gbk', errors='replace').splitlines()))
wxst_rows = []; wxst_map = {}; pid_daily_spend = {}
for row in rows_csv:
    pid = str(row.get('主体ID','')).strip()
    if not pid or pid not in product_ids:
        continue
    d = str(row.get('日期','')).strip()[:10]
    if not d:
        continue
    spend = to_float(row.get('花费'))
    ctr   = to_float(row.get('点击率'))
    ctr   = ctr / 100 if ctr > 1.5 else ctr
    roi   = to_float(row.get('投入产出比'))
    imps  = to_float(row.get('展现量'))
    wxst_rows.append({'d':d,'pid':pid,'spend':round(spend,2),'ctr':round(ctr,4),'imps':imps})
    wxst_map[(d,pid)] = {'spend':round(spend,2),'ctr':round(ctr,4),'roi':round(roi,2)}
    pid_daily_spend.setdefault(pid,{})[d] = {'spend':round(spend,2),'ctr':round(ctr,4),'roi':round(roi,2)}
print(f'    wxst 共 {len(wxst_rows)} 行')

# ── 重建 products ────────────────────────────────────────────────
print('[4] 重建 products 数组 …')
all_dates = sorted({r['d'] for r in syzt_rows} | {r['d'] for r in wxst_rows})
new_products = {}
for pid in sorted(product_ids):
    old  = raw.get('products', {}).get(pid, {})
    name = short_names.get(pid) or old.get('name') or pid
    cat  = cat_map.get(pid)    or old.get('cat')  or '其他'
    series = {k: [] for k in ['pay','vis','cart','collect','refund','new_buyers','spend','ctr','roi']}
    has_any = False
    for d in all_dates:
        sy = syzt_map.get((d, pid), {})
        wx = wxst_map.get((d, pid), {})
        vals = {
            'pay':      round(float(sy.get('pay',0) or 0), 2),
            'vis':      round(float(sy.get('vis',0) or 0)),
            'cart':     round(float(sy.get('cart',0) or 0)),
            'collect':  round(float(sy.get('collect',0) or 0)),
            'refund':   round(float(sy.get('refund',0) or 0), 2),
            'new_buyers': round(float(sy.get('new_buyers',0) or 0)),
            'spend':    round(float(wx.get('spend',0) or 0), 2),
            'ctr':      round(float(wx.get('ctr',0) or 0), 4),
            'roi':      round(float(wx.get('roi',0) or 0), 2),
        }
        if any(vals.values()):
            has_any = True
        for k, v in vals.items():
            series[k].append(v)
    if has_any or old:
        new_products[pid] = {'pid':pid,'name':name,'cat':cat,'dates':all_dates,**series}
print(f'    products 共 {len(new_products)} 个')

# ── 写回 dashboard.html ─────────────────────────────────────────
print('[5] 写入 dashboard.html …')
raw['syzt']           = sorted(syzt_rows, key=lambda x: (x['d'], x['pid']))
raw['wxst']           = sorted(wxst_rows, key=lambda x: (x['d'], x['pid']))
raw['pid_daily_spend']= pid_daily_spend
raw['products']       = new_products
raw['data_end']       = all_dates[-1] if all_dates else raw.get('data_end')
raw['loaded_at']      = datetime.now().strftime('%m-%d %H:%M')
new_raw = 'const RAW = ' + json.dumps(raw, ensure_ascii=False) + '\n\n'
html = html[:start] + new_raw + html[end:]
html_path.write_text(html, encoding='utf-8')
print(f'[完成] data_end={raw["data_end"]}  loaded_at={raw["loaded_at"]}')
print(f'       syzt={len(raw["syzt"])} wxst={len(raw["wxst"])} products={len(raw["products"])}')
