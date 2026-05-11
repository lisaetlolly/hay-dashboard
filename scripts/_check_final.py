"""
任务清单 (with-metrics) 最终全量对账：当期 4-20~4-26 + 环比基准 4-13~4-19。
直接拉 dashboard 实际接口数据。
"""
import json, urllib.request

# 生意参谋页面期望值（4-20~4-26 较 4-13~4-19）
# 顺序: pay, refund, pay_cvr%, cart_qty, cart_r%, coll_r%, vis, pv, stay, search_vis, spend
SYCM = {
    '580467335137': ('Basket',          36816.25, 11590.84, 1.40,  941,  6.33, 1.17, 11522, 24769,  9.92, 525,  4407.91),
    '965048597796': ('La Pittura',      25271.77,  8589.51, 0.41,  568,  3.34, 1.69, 11331, 21214, 18.71, 313,  1420.41),
    '679198301351': ('Colour Crate',    23473.87,  3575.22, 3.87, 1425, 17.00, 3.13,  4060, 14846, 12.57, 1012,    0.00),
    '1022489092196':('Conical Vase',    14912.66,  6197.60, 1.15,  352,  9.00, 2.49,  3377,  9279, 14.45, 267,   265.63),
    '1020175879777':('Grid Bag',        11659.56, 11036.17, 0.22,  318,  1.45, 0.56, 17553, 27941, 14.72, 349,   904.23),
    '781547798998': ('Slice Chopping',   9887.13,  3800.07, 0.44,  379,  3.84, 0.98,  7740, 12859, 22.50, 220,   709.18),
    '824607518747': ('Colour Rack',      8994.00,  4312.00, 0.06,  201,  2.32, 1.53,  8158, 13900, 16.33, 151,  1008.14),
    '690221882602': ('Bowler Table',     8985.00,  5387.00, 0.08,   70,  1.00, 0.46,  6106,  8342, 23.48,  80,  1140.41),
    '886839411718': ('Empire Vase',      8104.56,  1742.00, 0.31,  179,  3.30, 1.12,  5090,  8205, 20.38, 122,   512.97),
    '1016294283167':('Facet Cabinet 新', 6596.00,  1495.00, 0.04,   63,  0.50, 0.20, 11027, 13166, 16.78,  53,   673.99),
    '888002957800': ('Weekend Bag',      6464.49,  4537.88, 0.43,  203,  5.88, 2.43,  3046,  7779,  8.36, 118,     0.00),
    '742092260504': ('Apex Lamp',        4829.00,  1418.00, 0.16,  114,  2.86, 1.76,  3641,  5973, 29.34, 170,   634.79),
    '880816460277': ('Apex Floor Lamp',  4398.00,     0.00, 0.72,   28,  9.39, 2.89,   277,   573, 10.91,  41,     0.00),
    '824882661931': ('Common Pendant',   4153.72,  2031.26, 1.47,   66,  8.67, 2.45,   611,  1453, 10.31,  52,     0.00),
    '652664516885': ('Knit',             3198.00,  1402.00, 0.03,   53,  0.65, 1.63,  7426,  9664, 19.11,  87,   719.12),
    '583134215392': ('Jessica Hans',     2975.00,     0.00, 0.53,   70,  7.16, 2.42,   950,  1834,  6.47, 109,     0.00),
    '689952405763': ('Revolver Stool',   2288.00,     0.00, 0.05,   29,  0.69, 0.64,  4229,  5659, 19.58,  31,  1389.72),
    '737675603229': ('Arcs Trolley',     2094.00,  2094.00, 0.02,   36,  0.66, 0.56,  4991,  6832, 21.26,  29,  1024.37),
    '975799789205': ('Canopy',           1827.00,   397.00, 0.14,  333,  5.62, 6.57,  5766, 13477,  6.22,  90,     0.00),
    '824452791755': ('Facet 老',         1396.59,     0.00, 0.37,   23,  7.35, 6.99,   272,   777,  7.47,  22,    16.03),
    '682036237751': ('Korpus',           1149.00,     0.00, 0.14,   55,  6.30, 4.06,   714,  1738, 11.26,  87,     0.00),
    '880120382310': ('Apex Wall',         717.57,   627.00, 0.20,   27,  5.28, 2.85,   492,  1109,  7.81,  65,     0.00),
    '717349639294': ('Weekday',             0.00,  1666.87, 0.00,   81,  1.09, 0.41,  7132, 10040, 24.92, 101,  1184.32),
    '1020815058332':('Barro Bowl',          0.00,     0.00, 0.00,   18,  8.50, 1.31,   153,   175, 15.30,   0,     0.00),
    '824946188993': ('Taburete',            0.00,     0.00, 0.00,   99,  1.19, 1.86,  7481, 10857, 19.19,  87,  1743.54),
    '564552361178': ('Cotton Bag',      43339.14, 18314.49, 5.04, 2546, 17.97, 1.94, 13124, 47939,  5.42, 3395,   50.00),
    '818210888511': ('Paper Shade',      2080.60,   715.53, 0.89,   84,  9.01, 2.41,   788,  2443,  7.60,  42,     0.00),
    '1021718193334':('Manolito',         1793.00,     0.00, 0.21,   50,  5.14, 1.61,   933,  1496, 11.47,  90,     0.00),
    '887041510904': ('Coco Door Mat',     434.00,  1118.00, 0.09,   74,  5.59, 3.61,  1162,  2621,  5.96,  45,     0.00),
}

with urllib.request.urlopen('http://127.0.0.1:8000/api/tasks/with-metrics') as r:
    data = json.load(r)

FIELDS = [
    ('gmv',        'pay',     '支付金额'),
    ('vis',        'vis',     '商品访客'),
    ('cart',       'cart_q',  '加购件数'),
    ('cart_rate',  'cart_r',  '加购率%'),
    ('pay_cvr',    'pay_cvr', '支付转化率%'),
    ('dwell_time', 'stay',    '停留时长'),
    ('spend',      'spend',   '推广消耗'),
]
EXP_INDEX = {'pay':1, 'refund':2, 'pay_cvr':3, 'cart_q':4, 'cart_r':5, 'coll_r':6, 'vis':7, 'pv':8, 'stay':9, 'search':10, 'spend':11}

# 当期对账
print("\n" + "="*70)
print("【任务清单 当期 4-20~4-26 vs 生意参谋页面】")
print("="*70)
print(f"{'商品':<18} {'pay':>9} {'vis':>6} {'cart_q':>7} {'cart_r':>7} {'pay_cvr':>8} {'stay':>6} {'spend':>8}")

groups_by_pid = {g['product_id']: g for g in data.get('groups', [])}
mismatches_per_pid = {}

for pid, e in SYCM.items():
    g = groups_by_pid.get(pid)
    if not g: continue
    name = e[0]
    cur = g.get('current_metrics', {})
    cells = []
    miss = []
    for api_k, exp_k, label in FIELDS:
        exp = e[EXP_INDEX[exp_k]]
        got = float(cur.get(api_k) or 0)
        if exp == 0 and got == 0:
            cells.append('  ✓ ')
            continue
        if exp == 0:
            diff = 100 if got != 0 else 0
        else:
            diff = abs(got - exp) / abs(exp) * 100
        ok = diff < 5
        cells.append('  ✓ ' if ok else f' ⚠{diff:.0f}%')
        if not ok: miss.append(label)
    if miss: mismatches_per_pid[name] = miss
    print(f"{name:<18}" + ''.join(c.rjust(9) for c in cells))

# 汇总
print("\n=== 各指标对齐率 ===")
hits = {f[1]: 0 for f in FIELDS}
total = {f[1]: 0 for f in FIELDS}
for pid, e in SYCM.items():
    g = groups_by_pid.get(pid)
    if not g: continue
    cur = g.get('current_metrics', {})
    for api_k, exp_k, label in FIELDS:
        exp = e[EXP_INDEX[exp_k]]
        got = float(cur.get(api_k) or 0)
        total[exp_k] += 1
        if exp == 0 and got == 0:
            hits[exp_k] += 1; continue
        if exp == 0: diff = 100 if got != 0 else 0
        else: diff = abs(got - exp) / abs(exp) * 100
        if diff < 5: hits[exp_k] += 1

for api_k, exp_k, label in FIELDS:
    pct = hits[exp_k]/total[exp_k]*100
    bar = '█'*int(pct/5)
    mark = '✓' if pct >= 95 else ('~' if pct >= 80 else '✗')
    print(f"  {mark} {label:<10} {hits[exp_k]:>2}/{total[exp_k]}  {pct:5.1f}%  {bar}")

if mismatches_per_pid:
    print(f"\n=== 还有差距的商品（差>5%）===")
    for name, fields in mismatches_per_pid.items():
        print(f"  {name}: {', '.join(fields)}")
