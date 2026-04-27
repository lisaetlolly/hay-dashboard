# -*- coding: utf-8 -*-
"""
把本地最新底表数据写进 dashboard.html 的 RAW 块
用法: python etl/refresh_dashboard.py

目录约定：
  生意参谋商品/          *.xls / *.xlsx
  推广报表/商品报表/      *.csv  (总花费/CTR/ROI，所有渠道合计)
  推广报表/人群推广商品报表/  *.csv  (人群渠道下各商品)
  推广报表/关键词商品报表/   *.csv  (关键词渠道下各商品)
  推广报表/人群报表/      *.csv  (人群维度，非商品级)
  推广报表/关键词报表/    *.csv  (关键词维度，非商品级)
  无限店铺流量/          *.xls / *.xlsx
"""
import json, csv, sys, re
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent))
from xls_reader import read_xls_stdlib

base      = Path(__file__).parent.parent
html_path = base / 'dashboard.html'

print('[1] 读取 dashboard.html …')
html  = html_path.read_text(encoding='utf-8')
start = html.index('const RAW = ')
end   = html.index('const OFFICIAL = new Set(RAW.official_pids)')
raw   = json.loads(html[start + len('const RAW = '):end].strip().rstrip('\n'))

product_ids  = set(raw.get('cat_map', {}).keys()) | set(raw.get('products', {}).keys())
short_names  = raw.get('short_names', {})
cat_map      = raw.get('cat_map', {})
wxst_exclude = set(raw.get('wxst_exclude_dates', []))

def to_float(v):
    try:
        return float(str(v or '0').replace(',', '').replace('%', '').strip() or 0)
    except:
        return 0.0

def read_csv_rows(path):
    raw_bytes = path.read_bytes()
    for enc in ('gbk', 'utf-8-sig', 'utf-8'):
        try:
            text = raw_bytes.decode(enc); break
        except UnicodeDecodeError:
            continue
    else:
        text = raw_bytes.decode('gbk', errors='replace')
    return list(csv.DictReader(text.splitlines()))

# ── [2] 生意参谋商品 XLS ─────────────────────────────────────────
print('[2] 读取生意参谋商品 XLS …')
syzt_rows = []; syzt_map = {}
xls_dir   = base / '生意参谋商品'
xls_files = sorted(list(xls_dir.glob('*.xls')) + list(xls_dir.glob('*.xlsx'))) if xls_dir.exists() else []
for i, f in enumerate(xls_files):
    if i % 10 == 0:
        print(f'    {i+1}/{len(xls_files)} {f.name}')
    try:
        _, rows = read_xls_stdlib(str(f))
    except Exception as e:
        print(f'    WARN: {f.name}: {e}'); continue
    for row in rows:
        pid = str(row.get('商品ID', '')).strip()
        if not pid or pid not in product_ids:
            continue
        d = str(row.get('统计日期', '')).strip()[:10]
        if not d:
            continue
        pay  = to_float(row.get('支付金额'))
        vis  = to_float(row.get('商品访客数'))
        cart = to_float(row.get('商品加购人数'))
        syzt_rows.append({'d': d, 'pid': pid, 'pay': pay, 'vis': vis, 'cart': cart})
        syzt_map[(d, pid)] = {
            'pay':        pay,
            'vis':        vis,
            'cart':       cart,
            'collect':    to_float(row.get('商品收藏人数')),
            'refund':     to_float(row.get('成功退款金额')),
            'new_buyers': to_float(row.get('支付新买家数')),
        }
print(f'    syzt 共 {len(syzt_rows)} 行')

# ── 推广报表 CSV 通用读取 ────────────────────────────────────────
def _read_wxst_product_dir(subdir):
    """读取某推广商品级CSV目录，返回 (d, pid) -> spend 映射（多文件累加）。"""
    d_pid = base / '推广报表' / subdir
    files = sorted(d_pid.glob('*.csv')) if d_pid.exists() else []
    result = {}
    total  = 0
    for f in files:
        try:
            rows = read_csv_rows(f)
        except Exception as e:
            print(f'    WARN {subdir}/{f.name}: {e}'); continue
        for row in rows:
            d   = str(row.get('日期', '')).strip()[:10]
            pid = str(row.get('主体ID', '')).strip()
            if not d or not pid or pid not in product_ids or d in wxst_exclude:
                continue
            spend = to_float(row.get('花费'))
            key   = (d, pid)
            result[key] = round(result.get(key, 0.0) + spend, 2)
            total += 1
    print(f'    {subdir} 共 {total} 行 → {len(result)} 个 date+pid 组合')
    return result

def _read_wxst_dim_dir(subdir, name_col):
    """读取非商品级推广CSV目录（人群/关键词），返回 row list。"""
    d_dir = base / '推广报表' / subdir
    files = sorted(d_dir.glob('*.csv')) if d_dir.exists() else []
    rows_out = []; seen = set()
    for f in files:
        try:
            rows = read_csv_rows(f)
        except Exception as e:
            print(f'    WARN {subdir}/{f.name}: {e}'); continue
        for row in rows:
            d    = str(row.get('日期', '')).strip()[:10]
            name = str(row.get(name_col, '')).strip()
            if not d or not name or d in wxst_exclude:
                continue
            key = (d, name)
            if key in seen:
                continue
            seen.add(key)
            ctr = to_float(row.get('点击率'))
            ctr = ctr / 100 if ctr > 1.5 else ctr
            rows_out.append({
                'd':     d,
                'name':  name,
                'spend': round(to_float(row.get('花费')), 2),
                'imps':  round(to_float(row.get('展现量'))),
                'ctr':   round(ctr, 4),
                'roi':   round(to_float(row.get('投入产出比')), 2),
                'gmv':   round(to_float(row.get('总成交金额')), 2),
            })
    print(f'    {subdir} 共 {len(rows_out)} 行')
    return rows_out

# ── [3] 万象台商品报表（总）────────────────────────────────────
print('[3] 读取万象台商品报表 CSV（总）…')
wxst_rows = []; wxst_map = {}; pid_daily_spend = {}
wxst_dir  = base / '推广报表' / '商品报表'
wxst_files = sorted(wxst_dir.glob('*.csv')) if wxst_dir.exists() else []
if not wxst_files:
    print('    ⚠ 未找到推广报表 CSV，花费/CTR 数据将为空')
for f in wxst_files:
    try:
        rows = read_csv_rows(f)
    except Exception as e:
        print(f'    WARN 商品报表/{f.name}: {e}'); continue
    for row in rows:
        pid = str(row.get('主体ID', '')).strip()
        if not pid or pid not in product_ids:
            continue
        d = str(row.get('日期', '')).strip()[:10]
        if not d or d in wxst_exclude:
            continue
        spend = to_float(row.get('花费'))
        ctr   = to_float(row.get('点击率'))
        ctr   = ctr / 100 if ctr > 1.5 else ctr
        roi   = to_float(row.get('投入产出比'))
        imps  = to_float(row.get('展现量'))
        key   = (d, pid)
        if key not in wxst_map:
            wxst_rows.append({'d': d, 'pid': pid, 'spend': 0, 'ctr': 0, 'imps': 0})
            wxst_map[key] = {'spend': 0, 'ctr': 0, 'roi': 0, '_idx': len(wxst_rows) - 1}
        e = wxst_map[key]
        e['spend'] = round(e['spend'] + spend, 2)
        e['roi']   = round(to_float(row.get('投入产出比')), 2)
        e['ctr']   = round(ctr, 4)
        wxst_rows[e['_idx']].update({'spend': e['spend'], 'ctr': e['ctr'], 'imps': imps})
        pid_daily_spend.setdefault(pid, {})[d] = {'spend': e['spend'], 'ctr': e['ctr'], 'roi': e['roi']}
print(f'    wxst 共 {len(wxst_rows)} 行')

# ── [3b] 人群推广商品报表 ──────────────────────────────────────
print('[3b] 读取人群推广商品报表 CSV …')
rq_product_map = _read_wxst_product_dir('人群推广商品报表')

# ── [3c] 关键词商品报表 ───────────────────────────────────────
print('[3c] 读取关键词商品报表 CSV …')
kw_product_map = _read_wxst_product_dir('关键词商品报表')

# ── [3d] 人群报表（人群维度，非商品级）────────────────────────
print('[3d] 读取人群报表 CSV …')
audience_rows = _read_wxst_dim_dir('人群报表', '人群名字')

# ── [3e] 关键词报表（关键词维度，非商品级）────────────────────
print('[3e] 读取关键词报表 CSV …')
keyword_rows = _read_wxst_dim_dir('关键词报表', '词名字/词包名字')

# ── [3f] 无限店铺流量 XLS ─────────────────────────────────────
print('[3f] 读取无限店铺流量 XLS …')
traffic_rows = []
tf_dir   = base / '无限店铺流量'
tf_files = sorted(list(tf_dir.glob('*.xls')) + list(tf_dir.glob('*.xlsx'))) if tf_dir.exists() else []
for fpath in tf_files:
    fname = fpath.name
    try:
        from xls_reader import _extract_workbook_stream, _parse_biff8
        with open(fpath, 'rb') as fh:
            raw_bytes = fh.read()
        stream = _extract_workbook_stream(raw_bytes)
        if not stream:
            continue
        all_rows = _parse_biff8(stream)
    except Exception as e:
        print(f'    WARN {fname}: {e}'); continue

    hdr_idx = None
    for i, row in enumerate(all_rows[:20]):
        if any('访客数' in str(v) for v in row):
            hdr_idx = i; break
    if hdr_idx is None:
        continue

    col_names = [str(v).strip() for v in all_rows[hdr_idx]]
    col_idx = {}
    for ci, cn in enumerate(col_names):
        if cn and cn not in col_idx:
            col_idx[cn] = ci

    def gv(row, name):
        ci = col_idx.get(name)
        if ci is None or ci >= len(row):
            return None
        try:
            return int(float(str(row[ci]).replace(',', '')))
        except:
            return None

    date_ci    = col_idx.get('统计日期') or col_idx.get('日期')
    m_date     = re.search(r'(\d{4}-\d{2}-\d{2})', fname)
    current_l1 = ''

    for row in all_rows[hdr_idx + 2:]:
        if not row or len(row) < 2:
            continue
        cell0 = str(row[0]).strip()
        cell1 = str(row[1]).strip() if len(row) > 1 else ''
        if cell0 and not re.match(r'^[\d,.\-%]+$', cell0):
            current_l1 = cell0
        if not cell1 or re.match(r'^[\d,.\-%]+$', cell1):
            continue
        stat_date = (str(row[date_ci]).strip()[:10]
                     if date_ci is not None and date_ci < len(row)
                     else (m_date.group(1) if m_date else ''))
        if not stat_date:
            continue
        sl3 = str(row[2]).strip() if len(row) > 2 else ''
        sl4 = str(row[3]).strip() if len(row) > 3 else ''
        if re.match(r'^[\d,.\-%]+$', sl3): sl3 = ''
        if re.match(r'^[\d,.\-%]+$', sl4): sl4 = ''
        traffic_rows.append({
            'd':         stat_date,
            'l1':        current_l1,
            'l2':        cell1,
            'l3':        sl3,
            'l4':        sl4,
            'visitors':  gv(row, '访客数'),
            'pay_buyers': gv(row, '支付买家数'),
            'cart_users': gv(row, '加购人数'),
        })
print(f'    无限店铺流量 共 {len(traffic_rows)} 行')

# ── [4] 重建 products ────────────────────────────────────────
print('[4] 重建 products 数组 …')
all_dates = sorted(
    {r['d'] for r in syzt_rows} |
    {r['d'] for r in wxst_rows} |
    {k[0] for k in rq_product_map} |
    {k[0] for k in kw_product_map}
)
new_products = {}
for pid in sorted(product_ids):
    old  = raw.get('products', {}).get(pid, {})
    name = short_names.get(pid) or old.get('name') or pid
    cat  = cat_map.get(pid)    or old.get('cat')  or '其他'
    series  = {k: [] for k in ['pay', 'vis', 'cart', 'collect', 'refund',
                                'new_buyers', 'spend', 'ctr', 'roi',
                                'spend_rq', 'spend_kw']}
    has_any = False
    for d in all_dates:
        sy = syzt_map.get((d, pid), {})
        wx = wxst_map.get((d, pid), {})
        vals = {
            'pay':        round(float(sy.get('pay',      0) or 0), 2),
            'vis':        round(float(sy.get('vis',      0) or 0)),
            'cart':       round(float(sy.get('cart',     0) or 0)),
            'collect':    round(float(sy.get('collect',  0) or 0)),
            'refund':     round(float(sy.get('refund',   0) or 0), 2),
            'new_buyers': round(float(sy.get('new_buyers', 0) or 0)),
            'spend':      round(float(wx.get('spend',    0) or 0), 2),
            'ctr':        round(float(wx.get('ctr',      0) or 0), 4),
            'roi':        round(float(wx.get('roi',      0) or 0), 2),
            'spend_rq':   rq_product_map.get((d, pid), 0.0),
            'spend_kw':   kw_product_map.get((d, pid), 0.0),
        }
        if any(vals.values()):
            has_any = True
        for k, v in vals.items():
            series[k].append(v)
    if has_any or old:
        new_products[pid] = {'pid': pid, 'name': name, 'cat': cat,
                             'dates': all_dates, **series}
print(f'    products 共 {len(new_products)} 个')

# ── [5] 写回 dashboard.html ─────────────────────────────────
print('[5] 写入 dashboard.html …')
raw['syzt']            = sorted(syzt_rows,    key=lambda x: (x['d'], x['pid']))
raw['wxst']            = sorted(wxst_rows,    key=lambda x: (x['d'], x['pid']))
raw['pid_daily_spend'] = pid_daily_spend
raw['products']        = new_products
raw['wxst_audience']   = sorted(audience_rows, key=lambda x: x['d'])
raw['wxst_keyword']    = sorted(keyword_rows,  key=lambda x: x['d'])
raw['traffic']         = sorted(traffic_rows,  key=lambda x: (x['d'], x['l1'], x['l2']))
raw['data_end']        = all_dates[-1] if all_dates else raw.get('data_end')
raw['loaded_at']       = datetime.now().strftime('%m-%d %H:%M')

new_raw = 'const RAW = ' + json.dumps(raw, ensure_ascii=False) + '\n\n'
html = html[:start] + new_raw + html[end:]
html_path.write_text(html, encoding='utf-8')
print(f'[完成] data_end={raw["data_end"]}  loaded_at={raw["loaded_at"]}')
print(f'       syzt={len(raw["syzt"])} wxst={len(raw["wxst"])} products={len(raw["products"])}')
print(f'       wxst_audience={len(audience_rows)} wxst_keyword={len(keyword_rows)} '
      f'traffic={len(traffic_rows)} rq_product={len(rq_product_map)} kw_product={len(kw_product_map)}')
