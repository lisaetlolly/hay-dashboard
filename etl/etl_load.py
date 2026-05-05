# -*- coding: utf-8 -*-
"""
HAY 电商数据 ETL 主脚本 — 写入 Neon PostgreSQL
用法: python etl_load.py [--reset]
依赖: psycopg2-binary
"""
import os, sys, re, zipfile, xml.etree.ElementTree as ET
import argparse, datetime, glob
import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xls_reader import read_xls_stdlib

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, '..')
SCHEMA   = os.path.join(BASE_DIR, 'schema.sql')

NEON_DSN = os.environ.get("DATABASE_URL")
if not NEON_DSN:
    raise RuntimeError(
        "环境变量 DATABASE_URL 未设置。请先 export DATABASE_URL='postgresql://...'\n"
        "或在 .env 文件里设置后再运行 ETL。"
    )

# ── SPU 合并表 ────────────────────────────────────────────────
# 同款不同 SKU 合并到同一 SPU（key=副 SKU，value=主 SKU/SPU）
# 主 SKU 的 spu_id = 自身；副 SKU 的 spu_id 指向主 SKU
# 来源：人工核对 short_names 一致 + 销售数据重叠
SPU_MAP = {
    # ⚠️ 2026-05-05 用户在 SYCM 逐个验证 PID 商品名后，发现项目原 SPU_MAP 几乎
    # 全是错的（"人工核对"从未真正核对）。已全部清空，只保留唯一确认正确的：
    # Barro Bowl & Plate 第二条链接 → 主链 1020815058332（用户实地确认）
    '766018103334':  '1020815058332',
}

# ── 历史错误的 SPU 映射（用于在 dim_product 里把 spu_id 改回自身）──
# 这些 PID 之前被错误合并到主链，全部经 SYCM 实地搜索确认是独立商品
# 14 条历史 SPU_MAP 中，13 条已确认错；1 条 (Barro 766018103334) 用户确认正确
BAD_SPU_MAP_REVERT = {
    # SYCM 实地确认的 13 个错误映射（2026-05-05）
    '823129032370',   # 实为 Shim Coffee Table 圆形茶几（误标 Facet Cabinet 副）
    '655712136728',   # 实为 Pouf 豆袋（误标 Cotton Bag 副）
    '702658485207',   # 实为 Mousqueton Portable 便携灯（误标 Cotton Bag 副）
    '1021714677571',  # 实为 Everyday 包包（误标 Conical Vase 副）
    '690750181823',   # 实为 Rey Chair & Stool 单椅（误标 Bowler Table 副，本周 21,196）
    '1017849944486',  # 实为 Aplat 台灯（误标 Colour Crate 副）
    '975220170387',   # 实为 Tin Container 收纳盒（误标 Basket 副）
    '1020827662635',  # 实为 Multi Pouch（误标 Weekend Bag 副）
    '880590249812',   # 实为 X-Line Chair 单椅（误标 Apex Floor Lamp 副，本周 7,487）
    '742825018684',   # 实为 Elementaire Chair 单椅（误标 Tray Table 副）
    '965582828141',   # 实为 Multi Wash Bag 洗漱包（误标 La Pittura 副，本周 1,986）
    '719833026924',   # 实为 J-Series 单椅（误标 Slit Table 副）
    '718962869038',   # 实为 Tray Table 茶几（误标 Slit Table 副，本周 10,394）
    # 仅剩 1 个未截图验证：
    '824452791755',   # 之前标 Facet Cabinet 副（待 SYCM 验证）
}

# ── PID typo 自动修正（运行时把错误 ID 替换成正确 ID）──
PID_FIX = {
    '7660181033346': '1020815058332',  # Barro Bowl & Plate 13 位数 → 13 位数应为 13 位 实为 1020815058332
}

# 主链 SKU 硬编码 fallback（来自 优化商品ID清单.xlsx 26 行去 typo 后 25 个）
# Render 上 .gitignore 屏蔽了 *.xlsx，所以远程跑 ETL 时 xlsx 不存在，要用这个兜底
HARDCODED_MAIN_PIDS = {
    '679198301351','580467335137','781547798998','888002957800','965048597796',
    '886839411718','887041510904','975799789205','1020815058332','1020175879777',
    '1022489092196','824946188993','824607518747','1016294283167','717349639294',
    '737675603229','689952405763','682036237751','824882661931','742092260504',
    '880120382310','583134215392','690221882602','652664516885','880816460277',
}

def _load_product_ids():
    """
    加载 25 主链 SKU。优先读 优化商品ID清单.xlsx，没有则用硬编码 fallback。
    SPU_MAP 里的副 SKU 也加进来让 ETL 识别。
    """
    path = os.path.join(DATA_DIR, '优化商品ID清单.xlsx')
    if not os.path.exists(path):
        # Render 远程：xlsx 文件被 gitignore 排除，用硬编码兜底
        ids = set(HARDCODED_MAIN_PIDS)
        ids_with_aliases = ids | set(SPU_MAP.keys())
        print(f"  [优化商品ID清单] xlsx 文件不存在，用硬编码 25 PID + {len(SPU_MAP)} 个 alias")
        return ids_with_aliases, ids
    zf = zipfile.ZipFile(path)
    sh_xml = zf.read('xl/worksheets/sheet1.xml').decode('utf-8')
    sr = ET.fromstring(sh_xml)
    ns = {'n': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    ids = set()
    typo_fixed = 0
    for i, row in enumerate(sr.findall('.//n:row', ns)):
        if i == 0:
            continue
        cells = row.findall('n:c', ns)
        if not cells:
            continue
        v = cells[0].find('n:v', ns)
        if v is not None and v.text:
            pid = str(v.text).strip()
            if pid in PID_FIX:
                typo_fixed += 1
                pid = PID_FIX[pid]
            ids.add(pid)
    # 把 SPU_MAP 里的副 SKU 也加进 PRODUCT_IDS，让 ETL 能识别它们的源数据，
    # 但 dim_product 只保留主 SKU
    ids_with_aliases = ids | set(SPU_MAP.keys())
    print(f"  [优化商品ID清单] 主链 PID {len(ids)} 个 (typo 修正 {typo_fixed} 个)")
    print(f"  [合并副 SKU] 加载 {len(SPU_MAP)} 个 alias，ETL 接收 PID 集合 {len(ids_with_aliases)} 个")
    return ids_with_aliases, ids

PRODUCT_IDS, MAIN_PRODUCT_IDS = _load_product_ids()

def safe_float(v):
    if v is None or str(v).strip() in ('', '--', 'N/A', 'nan', '-'):
        return None
    s = str(v).replace(',', '').replace('%', '').replace('元', '').strip()
    # SYCM 周/月维度报表会把金额导成「2.5万」「1.2亿」格式，纯数字解析会失败。
    # 这里识别中文单位放大倍数，避免整列字段被解成 NULL 导致 dashboard 数低于 SYCM。
    mult = 1.0
    if s.endswith('万'):
        mult, s = 10000.0, s[:-1].strip()
    elif s.endswith('亿'):
        mult, s = 100000000.0, s[:-1].strip()
    try:
        return float(s) * mult
    except:
        return None

def safe_pct(v):
    f = safe_float(v)
    if f is None:
        return None
    if f > 1.5:
        return round(f / 100, 6)
    return f

def spu_id(pid):
    return SPU_MAP.get(pid, pid)

# ─────────────────────────────────────────────
# DB 连接 & 初始化
# ─────────────────────────────────────────────
def get_conn():
    return psycopg2.connect(NEON_DSN)

# --reset 白名单:只允许 TRUNCATE 这些事实表,严禁 DROP 业务表(dim_product/users/tasks/...)
# 历史教训:之前 --reset 把 dim_product 也 DROP,bootstrap_recovery.sql 手补的 4 个商品被冲,
# 加上 users / tasks / task_template / task_period / category_audience_plan 不在 schema.sql 里,
# 一旦执行就业务数据全断。详见 修改计划.md P0#19。
RESETTABLE_TABLES = (
    'fact_xhs_note_product', 'fact_xhs_note',
    'fact_paid_promo', 'fact_traffic',
    'fact_wxst_kw_product', 'fact_wxst_rq_product',
    'fact_wxst_content', 'fact_wxst_scene',
    'fact_wxst_keyword', 'fact_wxst_audience', 'fact_wxst_product',
    'fact_syzt_product',
)
# 严禁出现在白名单里的表(出现即抛错,作为代码守卫)
PROTECTED_TABLES = ('dim_product', 'users', 'tasks', 'task_template',
                    'task_period', 'task_comment', 'category_audience_plan',
                    'meeting_notes', 'app_state')

def init_db(conn, reset=False):
    cur = conn.cursor()
    if reset:
        # 守卫:确保白名单里没误加业务表
        bad = set(RESETTABLE_TABLES) & set(PROTECTED_TABLES)
        assert not bad, f"RESETTABLE_TABLES 不允许包含业务表: {bad}"
        print(f"  [RESET] 仅 TRUNCATE 事实表({len(RESETTABLE_TABLES)} 张),保留 dim_product/users/tasks 等业务表")
        # 用 TRUNCATE 而不是 DROP:保留表结构与外键约束,只清行
        # 不存在的表 TRUNCATE 会报错,所以包在 to_regclass 检查里
        for tbl in RESETTABLE_TABLES:
            cur.execute("SELECT to_regclass(%s)", (tbl,))
            if cur.fetchone()[0] is not None:
                cur.execute(f"TRUNCATE TABLE {tbl} RESTART IDENTITY CASCADE")
                print(f"    [RESET] truncated {tbl}")
            else:
                print(f"    [RESET] {tbl} 不存在,跳过")
        conn.commit()
    with open(SCHEMA, 'r', encoding='utf-8') as f:
        sql = f.read()
    cur.execute(sql)
    conn.commit()
    print("  Schema 初始化完成")

# ─────────────────────────────────────────────
# 日期维度
# ─────────────────────────────────────────────
def populate_dim_date(conn, start='2026-01-01', end='2026-12-31'):
    cur = conn.cursor()
    cur.execute("SELECT MAX(date_str) FROM dim_date")
    row = cur.fetchone()
    if row and row[0] and row[0] >= end:
        return
    d = datetime.date.fromisoformat(start)
    end_d = datetime.date.fromisoformat(end)
    rows = []
    while d <= end_d:
        iso = d.isocalendar()
        rows.append((
            d.isoformat(), d.year, d.month,
            iso[1], (d.month - 1) // 3 + 1,
            d.weekday(), 1 if d.weekday() >= 5 else 0
        ))
        d += datetime.timedelta(days=1)
    # execute_values 需要单个 %s 占位符，由 psycopg2 自动展开成 (v1,v2,...) 多行
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO dim_date (date_str, year, month, week, quarter, weekday, is_weekend) VALUES %s ON CONFLICT DO NOTHING",
        rows
    )
    conn.commit()
    print(f"  dim_date: {len(rows)} rows")

# ─────────────────────────────────────────────
# xlsx 读取工具
# ─────────────────────────────────────────────
def read_xlsx_all(path):
    zf = zipfile.ZipFile(path)
    try:
        ss = zf.read('xl/sharedStrings.xml').decode('utf-8')
        sr = ET.fromstring(ss)
        ns = {'n': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        strings = [
            (si.find('.//n:t', ns).text or '')
            for si in sr.findall('n:si', ns)
            if si.find('.//n:t', ns) is not None
        ]
    except Exception:
        strings = []
    sh_xml = zf.read('xl/worksheets/sheet1.xml').decode('utf-8')
    sr2 = ET.fromstring(sh_xml)
    ns = {'n': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    result = []
    for row in sr2.findall('.//n:row', ns):
        rd = []
        for c in row.findall('n:c', ns):
            ta = c.get('t', '')
            v  = c.find('n:v', ns)
            if v is None:
                rd.append('')
            elif ta == 's':
                rd.append(strings[int(v.text)] if int(v.text) < len(strings) else '')
            else:
                rd.append(v.text or '')
        result.append(rd)
    return result

# ─────────────────────────────────────────────
# 商品维度（dim_product）
#   - 25 个主链 SKU 进入 dim_product（spu_id = self）
#   - SPU_MAP 里的副 SKU 也写入 dim_product，但 spu_id 指向主 SKU
#     这样查询 view_product_daily 时 GROUP BY spu_id 自动合并
#   - 配件→配饰 在 ETL 这一步统一
#   - inventory：优化清单第 3 列在当前文件里是空，先按 0 处理；
#               真实库存对接 ERP 后再写
# ─────────────────────────────────────────────
def load_dim_product(conn):
    # ── 1. 读分类映射表 ──
    cats = {}
    cat_path = os.path.join(DATA_DIR, '分类映射表.xlsx')
    if os.path.exists(cat_path):
        for r in read_xlsx_all(cat_path)[1:]:
            if r and r[0]:
                pid = str(r[0]).strip()
                l1  = str(r[1]).strip() if len(r) > 1 else ''
                l2  = str(r[2]).strip() if len(r) > 2 else ''
                if l1 == '配件':
                    l1 = '配饰'
                cats[pid] = (l1, l2)

    # ── 1b. 缺失分类的硬补丁（修复 1020815058332 typo 后该 PID 不在分类映射表里）──
    if '1020815058332' not in cats:
        cats['1020815058332'] = ('配饰', '')  # Barro Bowl & Plate 餐具→配饰

    # 副 SKU 继承主 SKU 的分类（避免 SPU 合并后某些 SKU 分类为空）
    for sub_pid, main_pid in SPU_MAP.items():
        if main_pid in cats and sub_pid not in cats:
            cats[sub_pid] = cats[main_pid]

    # ── 2. 读优化清单 → 商品标题 ──
    inv_path = os.path.join(DATA_DIR, '优化商品ID清单.xlsx')
    products = {}
    if os.path.exists(inv_path):
        for r in read_xlsx_all(inv_path)[1:]:
            if r and r[0]:
                pid = str(r[0]).strip()
                # typo 修正
                if pid in PID_FIX:
                    pid = PID_FIX[pid]
                title_full = str(r[1]).strip() if len(r) > 1 else ''
                title_short = str(r[2]).strip() if len(r) > 2 else ''
                title = title_short or title_full
                # 第 3 列在当前优化清单里是"短名"，不是 inventory
                # 等 ERP 对接后再赋值
                inv = 0
                products[pid] = (title, inv)

    # ── 3. 把 SPU_MAP 里的副 SKU 也写入 dim_product，让 syzt/wxst 能 join 上 ──
    # 副 SKU 用主 SKU 的 title（前端按 spu_id 聚合，不会单独展示副 SKU 标题）
    for sub_pid, main_pid in SPU_MAP.items():
        if sub_pid not in products and main_pid in products:
            products[sub_pid] = products[main_pid]  # 直接共用 title + inv

    # ── 4. 写库 ──
    cur = conn.cursor()
    inserted = 0
    skipped = 0
    for pid, (title, inv) in products.items():
        if pid not in PRODUCT_IDS:
            skipped += 1
            continue
        l1, l2 = cats.get(pid, ('', ''))
        sid = spu_id(pid)  # 副 SKU → 主 SKU；主 SKU → self
        cur.execute(
            """INSERT INTO dim_product(product_id, spu_id, title, category_l1, category_l2, inventory)
               VALUES(%s,%s,%s,%s,%s,%s)
               ON CONFLICT(product_id) DO UPDATE SET
                   spu_id=EXCLUDED.spu_id, title=EXCLUDED.title,
                   category_l1=EXCLUDED.category_l1, category_l2=EXCLUDED.category_l2,
                   inventory=EXCLUDED.inventory""",
            (pid, sid, title, l1, l2, inv)
        )
        inserted += 1
    conn.commit()
    main_count = sum(1 for p in products if p in MAIN_PRODUCT_IDS)
    sub_count  = inserted - main_count
    print(f"  dim_product: {inserted} 行（主链 {main_count} + 副 SKU {sub_count}）")
    print(f"               SPU 合并: {len(SPU_MAP)} 个副 SKU 指向主链")

    # 兜底：补几个不在「优化商品ID清单」但有任务/销售的 PID，
    # 不然它们在 dim_product 里查不到，前端任务面板 / 商品列表只显示 PID 不显示名字
    EXTRA_PRODUCTS = [
        ('564552361178',  '564552361178',  'Cotton Bag 帆布包',         '配饰', '包袋', 0),
        ('886901025905',  '886901025905',  'PC Portable Lamp 便携灯',   '灯具', '便携灯', 0),
        ('818210888511',  '818210888511',  'Paper Shade 灯罩',          '灯具', '灯罩', 0),
        ('824452791755',  '1016294283167', 'Facet Cabinet 边柜（多色）','家具', '边柜', 0),  # 副 SKU 合并到 1016
        ('1020815058332', '1020815058332', 'Barro Bowl & Plate 碗盘',   '配饰', '餐具', 0),
        ('1021718193334', '1021718193334', 'Manolito Stool 矮凳',       '家具', '凳子', 0),
    ]
    for pid, sid, title, l1, l2, inv in EXTRA_PRODUCTS:
        cur.execute(
            """INSERT INTO dim_product(product_id, spu_id, title, category_l1, category_l2, inventory)
               VALUES(%s,%s,%s,%s,%s,%s)
               ON CONFLICT(product_id) DO UPDATE SET
                   title       = EXCLUDED.title,
                   category_l1 = EXCLUDED.category_l1,
                   category_l2 = EXCLUDED.category_l2""",
            (pid, sid, title, l1, l2, inv)
        )
    conn.commit()
    print(f"               补充：{len(EXTRA_PRODUCTS)} 个额外 PID（Cotton Bag / PC Portable / Paper Shade 等）")

# ─────────────────────────────────────────────
# 生意参谋商品报表
# ─────────────────────────────────────────────
def read_xls(path):
    try:
        return read_xls_stdlib(path)
    except Exception as e:
        print(f"  [WARN] Failed to read {os.path.basename(path)}: {e}")
        return [], []

# 去 NULL 字节：PostgreSQL 不允许字符串里有 \x00，xls 解析出来偶尔会带，全局清一遍
def _strip_nul(v):
    if isinstance(v, str):
        return v.replace('\x00', '')
    return v

def _clean_row(t):
    return tuple(_strip_nul(v) for v in t)

# 全局 monkeypatch psycopg2.extras.execute_values，自动清掉所有 batch 里的 NUL
_orig_execute_values = psycopg2.extras.execute_values
def _safe_execute_values(cur, sql, argslist, *args, **kwargs):
    cleaned = [_clean_row(r) if isinstance(r, (tuple, list)) else r for r in argslist]
    return _orig_execute_values(cur, sql, cleaned, *args, **kwargs)
psycopg2.extras.execute_values = _safe_execute_values

# ── 增量加载支持 ─────────────────────────────────────
# FORCE_RELOAD = True 时所有文件都重新读；否则按 source_file 跳过已入库的
FORCE_RELOAD = False

def _loaded_files(conn, table):
    """返回某表里已经入过库的 source_file 集合（增量跳过用）"""
    if FORCE_RELOAD:
        return set()
    try:
        cur = conn.cursor()
        cur.execute(f"SELECT DISTINCT source_file FROM {table} WHERE source_file IS NOT NULL")
        return {r[0] for r in cur.fetchall() if r[0]}
    except Exception:
        return set()

def load_syzt_product(conn):
    d = os.path.join(DATA_DIR, '生意参谋商品')
    if not os.path.isdir(d):
        print("  [SKIP] 生意参谋商品 dir not found")
        return
    files = sorted(glob.glob(os.path.join(d, '*.xls')))
    cur = conn.cursor()
    total = 0
    loaded = _loaded_files(conn, 'fact_syzt_product')
    skipped_files = 0
    # DO UPDATE 而非 DO NOTHING:平台经常补昨天数据,新值需覆盖旧值。修改计划 P0#20
    sql = """
        INSERT INTO fact_syzt_product (
            stat_date, product_id,
            visitors, page_views, avg_stay_duration, bounce_rate,
            collect_users, cart_qty, cart_users,
            order_buyers, order_qty, order_amount, order_cvr,
            pay_amount, pay_cvr,
            pay_new_buyers, pay_old_buyers, old_buyer_pay_amount, visitor_avg_value,
            refund_amount, year_cum_pay, month_cum_pay, month_cum_qty,
            search_pay_cvr, search_visitors, search_pay_buyers,
            source_file
        ) VALUES %s
        ON CONFLICT(stat_date, product_id) DO UPDATE SET
            visitors=EXCLUDED.visitors, page_views=EXCLUDED.page_views,
            avg_stay_duration=EXCLUDED.avg_stay_duration, bounce_rate=EXCLUDED.bounce_rate,
            collect_users=EXCLUDED.collect_users, cart_qty=EXCLUDED.cart_qty, cart_users=EXCLUDED.cart_users,
            order_buyers=EXCLUDED.order_buyers, order_qty=EXCLUDED.order_qty,
            order_amount=EXCLUDED.order_amount, order_cvr=EXCLUDED.order_cvr,
            pay_amount=EXCLUDED.pay_amount, pay_cvr=EXCLUDED.pay_cvr,
            pay_new_buyers=EXCLUDED.pay_new_buyers, pay_old_buyers=EXCLUDED.pay_old_buyers,
            old_buyer_pay_amount=EXCLUDED.old_buyer_pay_amount, visitor_avg_value=EXCLUDED.visitor_avg_value,
            refund_amount=EXCLUDED.refund_amount, year_cum_pay=EXCLUDED.year_cum_pay,
            month_cum_pay=EXCLUDED.month_cum_pay, month_cum_qty=EXCLUDED.month_cum_qty,
            search_pay_cvr=EXCLUDED.search_pay_cvr, search_visitors=EXCLUDED.search_visitors,
            search_pay_buyers=EXCLUDED.search_pay_buyers,
            source_file=EXCLUDED.source_file
    """
    # syzt 文件每次全量重跑：(stat_date, product_id) 上有 ON CONFLICT DO UPDATE，
    # 重跑幂等。生意参谋经常补昨天/上周数据，同名 xls 重新下载是常态，靠 source_file
    # 跳过会让补录数据永远进不来 —— dashboard 偏低就是这个 bug。
    print(f"  生意参谋商品：{len(files)} 个 xls 文件（每次全量重跑，依赖 ON CONFLICT 幂等）")
    for fi, fpath in enumerate(files, 1):
        fname = os.path.basename(fpath)
        headers, rows = read_xls(fpath)
        if not headers:
            print(f"    [{fi}/{len(files)}] {fname}: 0 行（无表头）")
            continue
        batch = []
        dirty_skip = 0
        # 淘宝 PID 一律是 8-13 位纯数字。任何 (字母/汉字/% / , /. / 短数字) 一律是错位脏数据
        import re as _re
        _PID_RE = _re.compile(r'^[0-9]{8,13}$')
        for row in rows:
            pid = str(row.get('商品ID', '')).strip().replace(',', '')
            if not pid:
                continue
            if not _PID_RE.match(pid):
                dirty_skip += 1
                continue
            # Option A：灌全店所有 PID（不再过滤 25 主链）
            stat_date = str(row.get('统计日期', ''))
            if not stat_date or stat_date == 'nan':
                m = re.search(r'(\d{4}-\d{2}-\d{2})', fname)
                stat_date = m.group(1) if m else ''
            if not stat_date:
                continue
            stat_date = str(stat_date)[:10]
            # ── 列错位 sanity check ──
            # 生意参谋导出 xls 偶尔会跨列串行（e.g. 4-24 的 10 行：'平均停留时长'='92.96%'，
            # '访客平均价值'='HAY 商品名…'）。命中任一就跳过整行，免污染加权。
            stay_raw = str(row.get('平均停留时长') or '').strip()
            avp_raw  = str(row.get('访客平均价值') or '').strip()
            ocvr_raw = str(row.get('下单转化率') or '').strip()
            if ('%' in stay_raw):
                dirty_skip += 1; continue
            # 访客平均价值列出现非 ASCII → 可能是「商品名串过来了」(列错位)，
            # 也可能是合法的中文单位 "2.5万" / "1.2亿" / "xx元"。先剥离已知单位再判定，
            # 避免周/月维度报表整行被误杀。
            _avp_strip = avp_raw.replace(',','').replace('.','').replace('-','')
            for _u in ('万', '亿', '元'):
                _avp_strip = _avp_strip.replace(_u, '')
            if avp_raw and _avp_strip and not _avp_strip.isascii():
                dirty_skip += 1; continue
            if ocvr_raw and ocvr_raw.replace(',','').replace('.','').isdigit() and len(ocvr_raw.replace(',','').split('.')[0]) >= 8:
                # 下单转化率应是 % 数；出现 8 位以上整数（PID 串过来）→ 跳
                dirty_skip += 1; continue
            def g(k):  return safe_float(row.get(k))
            def gp(k): return safe_pct(row.get(k))
            # 数值兜底：停留时长 > 600 秒（10 分钟）显然异常，强制 0
            stay_v = g('平均停留时长')
            if stay_v is not None and stay_v > 600:
                dirty_skip += 1; continue
            batch.append(_clean_row((
                stat_date, pid,
                g('商品访客数'), g('商品浏览量'), g('平均停留时长'),
                gp('商品详情页跳出率'),
                g('商品收藏人数'), g('商品加购件数'), g('商品加购人数'),
                g('下单买家数'), g('下单件数'), g('下单金额'), gp('下单转化率'),
                g('支付金额'), gp('商品支付转化率'),
                g('支付新买家数'), g('支付老买家数'), g('老买家支付金额'),
                g('访客平均价值'),
                g('成功退款金额'), g('年累计支付金额'), g('月累计支付金额'),
                g('月累计支付件数'),
                gp('搜索引导支付转化率'), g('搜索引导访客数'), g('搜索引导支付买家数'),
                fname
            )))
        if batch:
            psycopg2.extras.execute_values(cur, sql, batch)
            conn.commit()  # 每个文件 commit 一次，不丢进度
        total += len(batch)
        if dirty_skip:
            print(f"    [{fi}/{len(files)}] {fname}: 跳过 {dirty_skip} 行错位脏数据")
        if fi % 10 == 0 or fi == len(files):
            print(f"    [{fi}/{len(files)}] 累计 {total} 行")
    print(f"  fact_syzt_product: {total} rows ({len(files)} files, {skipped_files} 跳过, {len(files)-skipped_files} 处理)")

# ─────────────────────────────────────────────
# 万象台推广报表（CSV）
# ─────────────────────────────────────────────
def read_csv_gbk(path):
    with open(path, 'rb') as f:
        raw = f.read()
    text = raw.decode('gbk', errors='replace')
    lines = [l for l in text.split('\n') if l.strip()]
    if not lines:
        return [], []
    headers = [h.strip() for h in lines[0].split(',')]
    rows = []
    for line in lines[1:]:
        vals = line.split(',')
        d = {headers[i]: (vals[i].strip() if i < len(vals) else '') for i in range(len(headers))}
        rows.append(d)
    return headers, rows

def load_wxst_product(conn):
    """
    万象台商品报表 (fact_wxst_product)：(date, product_id) 唯一。
    数据源：
      · 父级 推广报表/商品报表/*.csv —— "全场景合并"版本（人群+关键词+店铺直达+短视频 等都已合并）
      · 子文件夹（人群推广商品报表 / 关键词商品报表）—— 单 channel；后台一般在合并版还没出来前先发这个。
    策略：
      1) 父级文件直接走原来的"INSERT...ON CONFLICT...DO UPDATE 整行覆盖"
      2) 子文件夹的同 (date, pid) 跨 channel 在内存里 SUM，**只对 fact_wxst_product 还没数据的 (date, pid) INSERT**，
         不覆盖父级合并版的值（因为合并版本来就 ≥ 单 channel SUM）。
    """
    parent_files = sorted(glob.glob(os.path.join(DATA_DIR, '推广报表', '商品报表', '*.csv')))
    sub_files    = sorted(glob.glob(os.path.join(DATA_DIR, '推广报表', '商品报表', '*', '*.csv')))
    if not (parent_files or sub_files):
        print("  [SKIP] 万象台商品报表 not found")
        return
    cur = conn.cursor()
    loaded = _loaded_files(conn, 'fact_wxst_product')
    sql = """
        INSERT INTO fact_wxst_product (
            stat_date, product_id, product_name,
            impressions, clicks, spend, ctr, avg_cpc, cpm,
            total_gmv, direct_gmv, indirect_gmv,
            click_cvr, roi, cart_rate, cart_cnt,
            collect_item_cnt, collect_shop_cnt, total_collect_cart, item_collect_cart,
            guided_visits, avg_visit_pages, transaction_buyers, new_buyers,
            natural_gmv, natural_impressions, source_file
        ) VALUES %s
        ON CONFLICT(stat_date, product_id) DO UPDATE SET
            product_name=EXCLUDED.product_name,
            impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, spend=EXCLUDED.spend,
            ctr=EXCLUDED.ctr, avg_cpc=EXCLUDED.avg_cpc, cpm=EXCLUDED.cpm,
            total_gmv=EXCLUDED.total_gmv, direct_gmv=EXCLUDED.direct_gmv, indirect_gmv=EXCLUDED.indirect_gmv,
            click_cvr=EXCLUDED.click_cvr, roi=EXCLUDED.roi,
            cart_rate=EXCLUDED.cart_rate, cart_cnt=EXCLUDED.cart_cnt,
            collect_item_cnt=EXCLUDED.collect_item_cnt, collect_shop_cnt=EXCLUDED.collect_shop_cnt,
            total_collect_cart=EXCLUDED.total_collect_cart, item_collect_cart=EXCLUDED.item_collect_cart,
            guided_visits=EXCLUDED.guided_visits, avg_visit_pages=EXCLUDED.avg_visit_pages,
            transaction_buyers=EXCLUDED.transaction_buyers, new_buyers=EXCLUDED.new_buyers,
            natural_gmv=EXCLUDED.natural_gmv, natural_impressions=EXCLUDED.natural_impressions,
            source_file=EXCLUDED.source_file
    """
    skipped_files = 0
    total = 0

    # === 1) 父级：原来逻辑，直写 ===
    import re as _re
    _PID_RE = _re.compile(r'^[0-9]{8,13}$')
    seen_parent = set()
    print(f"  万象台商品报表：父级 {len(parent_files)} 个 + 子文件夹 {len(sub_files)} 个")
    for fi, fpath in enumerate(parent_files, 1):
        fname = os.path.basename(fpath)
        if fname in loaded:
            skipped_files += 1
            continue
        try:
            _, rs = read_csv_gbk(fpath)
        except Exception as e:
            print(f"  [WARN] {fname}: {e}")
            continue
        batch = []
        for row in rs:
            pid = str(row.get('主体ID', '')).strip().replace(',', '')
            if not _PID_RE.match(pid):
                continue
            stat_date = str(row.get('日期', '')).strip()[:10]
            if not stat_date:
                continue
            key = (stat_date, pid)
            if key in seen_parent: continue
            seen_parent.add(key)
            def g(k):  return safe_float(row.get(k))
            def gp(k): return safe_pct(row.get(k))
            batch.append((
                stat_date, pid, str(row.get('主体名称', '')),
                g('展现量'), g('点击量'), g('花费'),
                gp('点击率'), g('平均点击花费'), g('千次展现花费'),
                g('总成交金额'), g('直接成交金额'), g('间接成交金额'),
                gp('点击转化率'), g('投入产出比'),
                gp('加购率'), g('总购物车数'),
                g('收藏宝贝数'), g('收藏店铺数'),
                g('总收藏加购数'), g('宝贝收藏加购数'),
                g('引导访问量'), g('平均访问页面数'),
                g('成交人数'), g('成交新客数'),
                g('自然流量转化金额'), g('自然流量曝光量'),
                fname,
            ))
        if batch:
            psycopg2.extras.execute_values(cur, sql, batch, page_size=200)
            conn.commit()
        total += len(batch)
        print(f"    [父级 {fi}/{len(parent_files)}] {fname}: +{len(batch)}（累计 {total}）")

    # === 2) 子文件夹：跨 channel SUM 同 (date, pid)，只对 DB 没有的 (date, pid) INSERT ===
    sub_new_files = [f for f in sub_files if os.path.basename(f) not in loaded]
    if sub_new_files:
        # 拿到 DB 已有的 (date, pid) 集合
        cur.execute("SELECT stat_date::text, product_id FROM fact_wxst_product")
        existing = set((r[0], r[1]) for r in cur.fetchall())

        # 内存里 SUM
        agg = {}  # (date, pid) -> dict of summed metrics + name + fname
        NUMERIC_KEYS = (
            '展现量', '点击量', '花费', '平均点击花费', '千次展现花费',
            '总成交金额', '直接成交金额', '间接成交金额',
            '总购物车数', '收藏宝贝数', '收藏店铺数',
            '总收藏加购数', '宝贝收藏加购数',
            '引导访问量', '平均访问页面数',
            '成交人数', '成交新客数',
            '自然流量转化金额', '自然流量曝光量',
        )
        PCT_KEYS = ('点击率', '点击转化率', '加购率', '投入产出比')
        for fpath in sub_new_files:
            fname = os.path.basename(fpath)
            try:
                _, rs = read_csv_gbk(fpath)
            except Exception as e:
                print(f"  [WARN] {fname}: {e}")
                continue
            for row in rs:
                pid = str(row.get('主体ID', '')).strip().replace(',', '')
                if not _PID_RE.match(pid):
                    continue
                stat_date = str(row.get('日期', '')).strip()[:10]
                if not stat_date:
                    continue
                key = (stat_date, pid)
                if key in existing:
                    continue  # 父级合并版已有 → 不动
                # 防御 None：safe_float / safe_pct 个别字段可能返 None，统一兜成 0
                def _f(v): return float(v) if v is not None else 0.0
                e = agg.get(key)
                if e is None:
                    e = {'name': str(row.get('主体名称', '')), 'fname': fname}
                    for k in NUMERIC_KEYS: e[k] = _f(safe_float(row.get(k)))
                    for k in PCT_KEYS:     e[k] = _f(safe_pct(row.get(k)))
                    agg[key] = e
                else:
                    for k in NUMERIC_KEYS: e[k] = _f(e.get(k)) + _f(safe_float(row.get(k)))
                    for k in PCT_KEYS:     e[k] = _f(safe_pct(row.get(k))) or _f(e.get(k))
                    e['fname'] = fname
        if agg:
            batch = []
            for (stat_date, pid), m in agg.items():
                batch.append((
                    stat_date, pid, m['name'],
                    m.get('展现量', 0), m.get('点击量', 0), m.get('花费', 0),
                    m.get('点击率', 0), m.get('平均点击花费', 0), m.get('千次展现花费', 0),
                    m.get('总成交金额', 0), m.get('直接成交金额', 0), m.get('间接成交金额', 0),
                    m.get('点击转化率', 0), m.get('投入产出比', 0),
                    m.get('加购率', 0), m.get('总购物车数', 0),
                    m.get('收藏宝贝数', 0), m.get('收藏店铺数', 0),
                    m.get('总收藏加购数', 0), m.get('宝贝收藏加购数', 0),
                    m.get('引导访问量', 0), m.get('平均访问页面数', 0),
                    m.get('成交人数', 0), m.get('成交新客数', 0),
                    m.get('自然流量转化金额', 0), m.get('自然流量曝光量', 0),
                    m['fname'],
                ))
            psycopg2.extras.execute_values(cur, sql, batch, page_size=200)
            conn.commit()
            total += len(batch)
            print(f"    [子文件夹 SUM] +{len(batch)} (date, pid) 行（累计 {total}）")
        else:
            print(f"    [子文件夹 SUM] +0（父级已覆盖所有 (date, pid)）")
    print(f"  fact_wxst_product: {total} rows（父级 {len(parent_files)} + 子 {len(sub_files)}，{skipped_files} 跳过）")

def load_wxst_audience(conn):
    """
    循环所有 CSV 合并去重（最新一份只覆盖近 2-3 天，历史数据需要从老 CSV 拼）
    去重 key = (stat_date, audience_name)
    """
    matches = (glob.glob(os.path.join(DATA_DIR, '推广报表', '人群报表', '*.csv'))
            or glob.glob(os.path.join(DATA_DIR, '推广报表', '人群报表*.csv')))
    if not matches:
        print("  [SKIP] 万象台人群报表 not found")
        return
    cur = conn.cursor()
    loaded = _loaded_files(conn, 'fact_wxst_audience')
    skipped_files = 0
    sql = """
        INSERT INTO fact_wxst_audience (
            stat_date, audience_name, product_name,
            impressions, clicks, spend, ctr, avg_cpc, cpm,
            total_gmv, direct_gmv, indirect_gmv,
            click_cvr, roi, cart_rate, cart_cnt,
            collect_item_cnt, collect_shop_cnt, total_collect_cart, item_collect_cart,
            guided_visits, avg_visit_pages, new_buyers,
            natural_gmv, natural_impressions, source_file
        ) VALUES %s
        ON CONFLICT(stat_date, audience_name) DO UPDATE SET
            product_name=EXCLUDED.product_name,
            impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, spend=EXCLUDED.spend,
            ctr=EXCLUDED.ctr, avg_cpc=EXCLUDED.avg_cpc, cpm=EXCLUDED.cpm,
            total_gmv=EXCLUDED.total_gmv, direct_gmv=EXCLUDED.direct_gmv, indirect_gmv=EXCLUDED.indirect_gmv,
            click_cvr=EXCLUDED.click_cvr, roi=EXCLUDED.roi,
            cart_rate=EXCLUDED.cart_rate, cart_cnt=EXCLUDED.cart_cnt,
            collect_item_cnt=EXCLUDED.collect_item_cnt, collect_shop_cnt=EXCLUDED.collect_shop_cnt,
            total_collect_cart=EXCLUDED.total_collect_cart, item_collect_cart=EXCLUDED.item_collect_cart,
            guided_visits=EXCLUDED.guided_visits, avg_visit_pages=EXCLUDED.avg_visit_pages,
            new_buyers=EXCLUDED.new_buyers,
            natural_gmv=EXCLUDED.natural_gmv, natural_impressions=EXCLUDED.natural_impressions,
            source_file=EXCLUDED.source_file
    """
    seen = set()
    total = 0
    print(f"  万象台人群报表：{len(matches)} 个 CSV（增量）")
    for fi, fpath in enumerate(sorted(matches), 1):
        fname = os.path.basename(fpath)
        if fname in loaded:
            skipped_files += 1
            continue
        try:
            _, rs = read_csv_gbk(fpath)
        except Exception as e:
            print(f"  [WARN] {fname}: {e}")
            continue
        batch = []
        for row in rs:
            stat_date = str(row.get('日期', '')).strip()[:10]
            aname = str(row.get('人群名字', '')).strip()
            if not stat_date or not aname:
                continue
            key = (stat_date, aname)
            if key in seen: continue
            seen.add(key)
            def g(k):  return safe_float(row.get(k))
            def gp(k): return safe_pct(row.get(k))
            batch.append((
                stat_date, aname, str(row.get('主体名称', '')),
                g('展现量'), g('点击量'), g('花费'),
                gp('点击率'), g('平均点击花费'), g('千次展现花费'),
                g('总成交金额'), g('直接成交金额'), g('间接成交金额'),
                gp('点击转化率'), g('投入产出比'),
                gp('加购率'), g('总购物车数'),
                g('收藏宝贝数'), g('收藏店铺数'),
                g('总收藏加购数'), g('宝贝收藏加购数'),
                g('引导访问量'), g('平均访问页面数'),
                g('成交新客数'),
                g('自然流量转化金额'), g('自然流量曝光量'),
                fname
            ))
        if batch:
            psycopg2.extras.execute_values(cur, sql, batch, page_size=200)
            conn.commit()
        total += len(batch)
        print(f"    [{fi}/{len(matches)}] {fname}: +{len(batch)}（累计 {total}）")
    print(f"  fact_wxst_audience: {total} rows ({len(matches)} files, {skipped_files} 跳过)")

def load_wxst_keyword(conn):
    """
    循环所有 CSV 合并去重。
    去重 key = (stat_date, keyword_id, scene_name, keyword_name)
    —— 修复：同一关键词「茶几」在「关键词推广」「精准词包」等不同场景下都会出现，
       老 key=(date, name) 把第二次起全部丢弃，导致花费严重少算（4 月少 24K，约 68%）。
    """
    matches = (glob.glob(os.path.join(DATA_DIR, '推广报表', '关键词报表', '*.csv'))
            or glob.glob(os.path.join(DATA_DIR, '推广报表', '关键词报表*.csv')))
    if not matches:
        print("  [SKIP] 万象台关键词报表 not found")
        return
    cur = conn.cursor()
    loaded = _loaded_files(conn, 'fact_wxst_keyword')
    skipped_files = 0
    # 先把旧的窄 UNIQUE 拆掉（只跑一次也是幂等）
    cur.execute("""
        ALTER TABLE fact_wxst_keyword
        DROP CONSTRAINT IF EXISTS fact_wxst_keyword_stat_date_keyword_name_key
    """)
    # 加宽 UNIQUE 让多场景共存
    cur.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fact_wxst_keyword_uniq_v2') THEN
                ALTER TABLE fact_wxst_keyword ADD CONSTRAINT fact_wxst_keyword_uniq_v2
                    UNIQUE (stat_date, keyword_id, scene_name, keyword_name);
            END IF;
        END$$;
    """)
    conn.commit()
    sql = """
        INSERT INTO fact_wxst_keyword (
            stat_date, keyword_name, keyword_id, keyword_type, scene_name, product_name,
            impressions, clicks, spend, ctr, avg_cpc, cpm,
            total_gmv, direct_gmv, indirect_gmv,
            click_cvr, roi, cart_rate, cart_cnt,
            collect_item_cnt, collect_shop_cnt, total_collect_cart, item_collect_cart,
            guided_visits, avg_visit_pages, new_buyers,
            natural_gmv, natural_impressions, source_file
        ) VALUES %s
        ON CONFLICT (stat_date, keyword_id, scene_name, keyword_name) DO UPDATE SET
            keyword_type=EXCLUDED.keyword_type, product_name=EXCLUDED.product_name,
            impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, spend=EXCLUDED.spend,
            ctr=EXCLUDED.ctr, avg_cpc=EXCLUDED.avg_cpc, cpm=EXCLUDED.cpm,
            total_gmv=EXCLUDED.total_gmv, direct_gmv=EXCLUDED.direct_gmv, indirect_gmv=EXCLUDED.indirect_gmv,
            click_cvr=EXCLUDED.click_cvr, roi=EXCLUDED.roi,
            cart_rate=EXCLUDED.cart_rate, cart_cnt=EXCLUDED.cart_cnt,
            collect_item_cnt=EXCLUDED.collect_item_cnt, collect_shop_cnt=EXCLUDED.collect_shop_cnt,
            total_collect_cart=EXCLUDED.total_collect_cart, item_collect_cart=EXCLUDED.item_collect_cart,
            guided_visits=EXCLUDED.guided_visits, avg_visit_pages=EXCLUDED.avg_visit_pages,
            new_buyers=EXCLUDED.new_buyers,
            natural_gmv=EXCLUDED.natural_gmv, natural_impressions=EXCLUDED.natural_impressions,
            source_file=EXCLUDED.source_file
    """
    seen = set()
    total = 0
    print(f"  万象台关键词报表：{len(matches)} 个 CSV（增量）")
    for fi, fpath in enumerate(sorted(matches), 1):
        fname = os.path.basename(fpath)
        if fname in loaded:
            skipped_files += 1
            continue
        try:
            _, rs = read_csv_gbk(fpath)
        except Exception as e:
            print(f"  [WARN] {fname}: {e}")
            continue
        batch = []
        for row in rs:
            stat_date = str(row.get('日期', '')).strip()[:10]
            kname = str(row.get('词名字/词包名字', '')).strip()
            kid   = str(row.get('词ID/词包ID', row.get('词 ID/词包ID', ''))).strip()
            scene = str(row.get('场景名字', '')).strip()
            if not stat_date or not kname:
                continue
            # 用 (date, kid, scene, kname) 全维度去重，匹配新 UNIQUE 约束
            key = (stat_date, kid, scene, kname)
            if key in seen: continue
            seen.add(key)
            def g(k):  return safe_float(row.get(k))
            def gp(k): return safe_pct(row.get(k))
            batch.append((
                stat_date, kname,
                str(row.get('词ID/词包ID', row.get('词 ID/词包ID', ''))),
                str(row.get('词类型', '')),
                str(row.get('场景名字', '')),
                str(row.get('主体名称', '')),
                g('展现量'), g('点击量'), g('花费'),
                gp('点击率'), g('平均点击花费'), g('千次展现花费'),
                g('总成交金额'), g('直接成交金额'), g('间接成交金额'),
                gp('点击转化率'), g('投入产出比'),
                gp('加购率'), g('总购物车数'),
                g('收藏宝贝数'), g('收藏店铺数'),
                g('总收藏加购数'), g('宝贝收藏加购数'),
                g('引导访问量'), g('平均访问页面数'),
                g('成交新客数'),
                g('自然流量转化金额'), g('自然流量曝光量'),
                fname
            ))
        if batch:
            psycopg2.extras.execute_values(cur, sql, batch, page_size=200)
            conn.commit()
        total += len(batch)
        print(f"    [{fi}/{len(matches)}] {fname}: +{len(batch)}（累计 {total}）")
    print(f"  fact_wxst_keyword: {total} rows ({len(matches)} files, {skipped_files} 跳过)")

# ─────────────────────────────────────────────
# 万象台内容报表（短视频/直播花费数据源）
# 文件夹：推广报表/内容报表/*.csv
# 关键：主体ID = 视频ID，主体类型 = 短视频/直播
# ─────────────────────────────────────────────
def load_wxst_content(conn):
    all_matches = glob.glob(os.path.join(DATA_DIR, '推广报表', '内容报表', '*.csv'))
    if not all_matches:
        print("  [SKIP] 万象台内容报表 not found")
        return
    # 增量过滤
    loaded = _loaded_files(conn, 'fact_wxst_content')
    matches = [m for m in all_matches if os.path.basename(m) not in loaded]
    skipped_files = len(all_matches) - len(matches)
    if not matches:
        print(f"  [万象台内容报表] 无新文件（{len(all_matches)} 个全部已入库）")
        return
        return
    cur = conn.cursor()
    total = 0
    seen = set()  # 同一份报表里同一 (date, content_id, content_type) 只入一次
    sql = """
        INSERT INTO fact_wxst_content (
            stat_date, content_id, content_type, content_name,
            impressions, clicks, spend, ctr, avg_cpc, cpm,
            total_gmv, direct_gmv, indirect_gmv,
            click_cvr, roi, cart_rate, cart_cnt,
            collect_item_cnt, total_collect_cart,
            guided_visits, new_buyers, transaction_buyers,
            source_file
        ) VALUES %s
        ON CONFLICT(stat_date, content_id, content_type) DO UPDATE SET
            content_name=EXCLUDED.content_name,
            impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, spend=EXCLUDED.spend,
            ctr=EXCLUDED.ctr, avg_cpc=EXCLUDED.avg_cpc, cpm=EXCLUDED.cpm,
            total_gmv=EXCLUDED.total_gmv, direct_gmv=EXCLUDED.direct_gmv, indirect_gmv=EXCLUDED.indirect_gmv,
            click_cvr=EXCLUDED.click_cvr, roi=EXCLUDED.roi,
            cart_rate=EXCLUDED.cart_rate, cart_cnt=EXCLUDED.cart_cnt,
            collect_item_cnt=EXCLUDED.collect_item_cnt, total_collect_cart=EXCLUDED.total_collect_cart,
            guided_visits=EXCLUDED.guided_visits,
            new_buyers=EXCLUDED.new_buyers, transaction_buyers=EXCLUDED.transaction_buyers,
            source_file=EXCLUDED.source_file
    """
    for fpath in sorted(matches):
        fname = os.path.basename(fpath)
        try:
            _, rs = read_csv_gbk(fpath)
        except Exception as e:
            print(f"  [WARN] {fname}: {e}")
            continue
        batch = []
        for row in rs:
            stat_date = str(row.get('日期', '')).strip()[:10]
            content_id   = str(row.get('主体ID', '')).strip()
            content_type = str(row.get('主体类型', '')).strip()
            if not stat_date or not content_id:
                continue
            key = (stat_date, content_id, content_type)
            if key in seen:
                continue
            seen.add(key)
            def g(k):  return safe_float(row.get(k))
            def gp(k): return safe_pct(row.get(k))
            batch.append((
                stat_date, content_id, content_type,
                str(row.get('主体名称', '')),
                g('展现量'), g('点击量'), g('花费'),
                gp('点击率'), g('平均点击花费'), g('千次展现花费'),
                g('总成交金额'), g('直接成交金额'), g('间接成交金额'),
                gp('点击转化率'), g('投入产出比'),
                gp('加购率'), g('总购物车数'),
                g('收藏宝贝数'), g('总收藏加购数'),
                g('引导访问量'), g('成交新客数'), g('成交人数'),
                fname
            ))
        if batch:
            psycopg2.extras.execute_values(cur, sql, batch, page_size=200)
            conn.commit()
        total += len(batch)
    conn.commit()
    print(f"  fact_wxst_content: {total} rows（处理 {len(matches)} 个新文件，跳过 {skipped_files}）")

# ─────────────────────────────────────────────
# 万象台全营销场景报表（场景级日数据）
# 文件夹：推广报表/全营销场景报表/*.csv
# 用于「总投放 ROI 口径」对账：万象台后台显示的总花费/ROI 用的就是这个表
# ─────────────────────────────────────────────
def load_wxst_scene(conn):
    # 同时扫描根目录 + 子目录（人群营销场景报表 / 关键词营销场景报表 等子分类）
    all_matches = sorted(set(
        glob.glob(os.path.join(DATA_DIR, '推广报表', '全营销场景报表', '**', '*.csv'), recursive=True)
        + glob.glob(os.path.join(DATA_DIR, '推广报表', '全营销场景报表*.csv'))
        + glob.glob(os.path.join(DATA_DIR, '推广报表', '全场景*.csv'))
    ))
    if not all_matches:
        print("  [SKIP] 万象台全营销场景报表 not found")
        return
    loaded = _loaded_files(conn, 'fact_wxst_scene')
    matches = [m for m in all_matches if os.path.basename(m) not in loaded]
    skipped_files = len(all_matches) - len(matches)
    if not matches:
        print(f"  [全营销场景报表] 无新文件（{len(all_matches)} 个全部已入库）")
        return
    cur = conn.cursor()
    sql = """
        INSERT INTO fact_wxst_scene (
            stat_date, scene_id, scene_name, sub_scene_id, sub_scene_name,
            impressions, clicks, spend, ctr, avg_cpc, cpm,
            total_gmv, direct_gmv, indirect_gmv,
            total_orders, direct_orders, indirect_orders,
            click_cvr, roi, cart_cnt, cart_rate,
            collect_item_cnt, collect_shop_cnt, total_collect_cart,
            placed_orders, placed_amount,
            guided_visits, guided_visitors,
            new_buyers, new_pct,
            natural_gmv, natural_impressions, source_file
        ) VALUES %s
        ON CONFLICT(stat_date, scene_id, sub_scene_id) DO UPDATE SET
            impressions  = EXCLUDED.impressions,
            clicks       = EXCLUDED.clicks,
            spend        = EXCLUDED.spend,
            total_gmv    = EXCLUDED.total_gmv,
            direct_gmv   = EXCLUDED.direct_gmv,
            indirect_gmv = EXCLUDED.indirect_gmv,
            roi          = EXCLUDED.roi,
            placed_amount= EXCLUDED.placed_amount,
            new_buyers   = EXCLUDED.new_buyers
    """
    seen = set()
    total = 0
    print(f"  万象台全营销场景报表：开始处理 {len(matches)} 个 CSV 文件")
    for fi, fpath in enumerate(sorted(matches), 1):
        fname = os.path.basename(fpath)
        try:
            _, rs = read_csv_gbk(fpath)
        except Exception as e:
            print(f"  [WARN] {fname}: {e}")
            continue
        batch = []
        for row in rs:
            stat_date = str(row.get('日期', '')).strip()[:10]
            scene_id  = str(row.get('场景ID', '')).strip()
            sub_id    = str(row.get('原二级场景ID', '')).strip() or scene_id
            if not stat_date or not scene_id:
                continue
            key = (stat_date, scene_id, sub_id)
            if key in seen: continue
            seen.add(key)
            def g(k):  return safe_float(row.get(k))
            def gp(k): return safe_pct(row.get(k))
            batch.append((
                stat_date, scene_id, str(row.get('场景名字', '')),
                sub_id, str(row.get('原二级场景名字', '')),
                g('展现量'), g('点击量'), g('花费'),
                gp('点击率'), g('平均点击花费'), g('千次展现花费'),
                g('总成交金额'), g('直接成交金额'), g('间接成交金额'),
                g('总成交笔数'), g('直接成交笔数'), g('间接成交笔数'),
                gp('点击转化率'), g('投入产出比'),
                g('总购物车数'), gp('加购率'),
                g('收藏宝贝数'), g('收藏店铺数'), g('总收藏加购数'),
                g('拍下订单笔数'), g('拍下订单金额'),
                g('引导访问量'), g('引导访问人数'),
                g('成交新客数'), gp('成交新客占比'),
                g('自然流量转化金额'), g('自然流量曝光量'),
                fname
            ))
        if batch:
            psycopg2.extras.execute_values(cur, sql, batch, page_size=200)
            conn.commit()
        total += len(batch)
        print(f"    [{fi}/{len(matches)}] {fname}: +{len(batch)}（累计 {total}）")
    print(f"  fact_wxst_scene: {total} rows ({len(matches)} files)")

# ─────────────────────────────────────────────
# 无限店铺流量
# ─────────────────────────────────────────────
def load_traffic(conn):
    d = os.path.join(DATA_DIR, '无限店铺流量')
    if not os.path.isdir(d):
        print("  [SKIP] 无限店铺流量 dir not found")
        return
    all_files = sorted(glob.glob(os.path.join(d, '*.xls')))
    loaded = _loaded_files(conn, 'fact_traffic')
    files = [f for f in all_files if os.path.basename(f) not in loaded]
    skipped_files = len(all_files) - len(files)
    if skipped_files:
        print(f"  [增量] 跳过 {skipped_files} 个已入库文件")
    if not files:
        print(f"  [无限店铺流量] 无新文件（{len(all_files)} 个全部已入库）")
        return
    cur = conn.cursor()
    total = 0

    sql = """
        INSERT INTO fact_traffic (
            stat_date, source_l1, source_l2, source_l3, source_l4,
            visitors, pay_buyers, collect_buyers, cart_users, source_file
        ) VALUES %s
        ON CONFLICT(stat_date, source_l1, source_l2, source_l3, source_l4) DO UPDATE SET
            visitors=EXCLUDED.visitors,
            pay_buyers=EXCLUDED.pay_buyers,
            collect_buyers=EXCLUDED.collect_buyers,
            cart_users=EXCLUDED.cart_users,
            source_file=EXCLUDED.source_file
    """
    print(f"  无限店铺流量：开始处理 {len(files)} 个 xls 文件")
    for fi, fpath in enumerate(files, 1):
        fname = os.path.basename(fpath)
        m = re.search(r'(\d{4}-\d{2}-\d{2})_\d{4}-\d{2}-\d{2}', fname)
        stat_date = m.group(1) if m else ''
        if not stat_date:
            continue

        try:
            from xls_reader import _extract_workbook_stream, _parse_biff8
            with open(fpath, 'rb') as f:
                raw = f.read()
            stream = _extract_workbook_stream(raw)
            if not stream:
                continue
            all_rows = _parse_biff8(stream)
        except Exception as e:
            print(f"  [WARN] {fname}: {e}")
            continue

        hdr_idx = None
        for i, row in enumerate(all_rows[:15]):
            if any('访客数' in str(v) for v in row):
                hdr_idx = i
                break
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
            return safe_float(row[ci])

        current_l1 = ''
        batch = []
        seen_keys = set()
        for row in all_rows[hdr_idx + 2:]:
            if not row or len(row) < 2:
                continue
            cell0 = str(row[0]).strip()
            cell1 = str(row[1]).strip() if len(row) > 1 else ''
            if cell0 and not re.match(r'^[\d,.\-%]+$', cell0):
                current_l1 = cell0
            if not cell1 or re.match(r'^[\d,.\-%]+$', cell1):
                continue
            sl3 = str(row[2]).strip() if len(row) > 2 else ''
            sl4 = str(row[3]).strip() if len(row) > 3 else ''
            if re.match(r'^[\d,.\-%]+$', sl3): sl3 = ''
            if re.match(r'^[\d,.\-%]+$', sl4): sl4 = ''
            key = (stat_date, current_l1, cell1, sl3, sl4)
            if key in seen_keys: continue
            seen_keys.add(key)
            batch.append((
                stat_date, current_l1, cell1, sl3, sl4,
                gv(row, '访客数'),
                gv(row, '支付买家数'),
                gv(row, '商品收藏人数'),
                gv(row, '加购人数'),
                fname
            ))
        if batch:
            psycopg2.extras.execute_values(cur, sql, batch, page_size=200)
            conn.commit()
        total += len(batch)
        if fi % 5 == 0 or fi == len(files):
            print(f"    [{fi}/{len(files)}] 累计 {total} 行")
    print(f"  fact_traffic: {total} rows ({len(files)} files)")

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description='HAY ETL loader -> Neon PostgreSQL')
    ap.add_argument('--reset', action='store_true', help='Drop and recreate all tables')
    ap.add_argument('--reload', action='store_true', help='Force reload all files (ignore source_file dedup)')
    ap.add_argument('--start', default='2026-01-01')
    ap.add_argument('--end',   default='2026-12-31')
    args = ap.parse_args()

    # 增量/全量模式
    global FORCE_RELOAD
    if args.reload or args.reset:
        FORCE_RELOAD = True
        print("[ETL] 模式：全量加载（--reload / --reset）")
    else:
        print("[ETL] 模式：增量加载（仅处理新文件，跑过 --reload 强制全量）")

    print("[ETL] 连接 Neon PostgreSQL...")
    conn = get_conn()

    print("[0] 初始化 Schema")
    init_db(conn, reset=args.reset)

    print("[1] dim_date")
    populate_dim_date(conn, args.start, args.end)

    print("[2] dim_product")
    load_dim_product(conn)

    print("[3] 生意参谋商品报表")
    load_syzt_product(conn)

    print("[4] 万象台商品报表")
    load_wxst_product(conn)

    print("[5] 万象台人群报表")
    load_wxst_audience(conn)

    print("[6] 万象台关键词报表")
    load_wxst_keyword(conn)

    print("[7] 万象台内容报表（短视频/直播）")
    load_wxst_content(conn)

    print("[7b] 万象台全营销场景报表（场景级，ROI 口径权威源）")
    load_wxst_scene(conn)

    print("[8] 无限店铺流量")
    load_traffic(conn)

    conn.close()
    print("[ETL] Done -> Neon PostgreSQL")

if __name__ == '__main__':
    main()
