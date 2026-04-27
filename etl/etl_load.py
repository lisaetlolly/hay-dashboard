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
    # Facet Cabinet 边柜 → 主链 1016294283167
    '824452791755':  '1016294283167',
    '823129032370':  '1016294283167',
    # Cotton Bag 帆布包 → 主链 564552361178
    '655712136728':  '564552361178',
    '702658485207':  '564552361178',
    # Slit Table 边几 → 主链 718703980562
    '718962869038':  '718703980562',
    '719833026924':  '718703980562',
    # Tray Table 边几 → 主链 742288645501
    '742825018684':  '742288645501',
    # Bowler Table 茶几 → 主链 690221882602
    '690750181823':  '690221882602',
    # Conical Vase 花瓶 → 主链 1022489092196
    '1021714677571': '1022489092196',
    # Basket 收纳篓 → 主链 580467335137
    '975220170387':  '580467335137',
    # Colour Crate 收纳篮 → 主链 679198301351
    '1017849944486': '679198301351',
    # Weekend Bag 帆布袋 → 主链 888002957800
    '1020827662635': '888002957800',
    # La Pittura 餐盘 → 主链 965048597796
    '965582828141':  '965048597796',
    # Apex Floor Lamp 落地灯 → 主链 880816460277
    '880590249812':  '880816460277',
}

# ── PID typo 自动修正（运行时把错误 ID 替换成正确 ID）──
PID_FIX = {
    '7660181033346': '1020815058332',  # Barro Bowl & Plate 13 位数 → 13 位数应为 13 位 实为 1020815058332
}

def _load_product_ids():
    """
    加载 25 主链 SKU 列表 = 优化清单去重去 typo 后的 PID 集
    优化清单实际有 26 行，含一个 typo（7660181033346 → 1020815058332），
    去掉 1 个被 SPU 合并的副 SKU（824452791755）后剩 25 个主链 SKU。
    """
    path = os.path.join(DATA_DIR, '优化商品ID清单.xlsx')
    if not os.path.exists(path):
        raise FileNotFoundError(f"找不到优化商品ID清单.xlsx: {path}")
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
    try:
        return float(str(v).replace(',', '').replace('%', '').strip())
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

def init_db(conn, reset=False):
    cur = conn.cursor()
    if reset:
        print("  [RESET] 删除所有数据表...")
        cur.execute("""
            DROP TABLE IF EXISTS
                fact_xhs_note_product, fact_xhs_note,
                fact_paid_promo, fact_traffic,
                fact_wxst_keyword, fact_wxst_audience, fact_wxst_product,
                fact_syzt_product, dim_date, dim_product
            CASCADE
        """)
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

# ─────────────────────────────────────────────
# 生意参谋商品报表
# ─────────────────────────────────────────────
def read_xls(path):
    try:
        return read_xls_stdlib(path)
    except Exception as e:
        print(f"  [WARN] Failed to read {os.path.basename(path)}: {e}")
        return [], []

def load_syzt_product(conn):
    d = os.path.join(DATA_DIR, '生意参谋商品')
    if not os.path.isdir(d):
        print("  [SKIP] 生意参谋商品 dir not found")
        return
    files = sorted(glob.glob(os.path.join(d, '*.xls')))
    cur = conn.cursor()
    total = 0
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
        ON CONFLICT(stat_date, product_id) DO NOTHING
    """
    print(f"  生意参谋商品：开始处理 {len(files)} 个 xls 文件")
    for fi, fpath in enumerate(files, 1):
        fname = os.path.basename(fpath)
        headers, rows = read_xls(fpath)
        if not headers:
            print(f"    [{fi}/{len(files)}] {fname}: 0 行（无表头）")
            continue
        batch = []
        for row in rows:
            pid = str(row.get('商品ID', '')).strip()
            if not pid:
                continue
            # Option A：灌全店所有 PID（不再过滤 25 主链）
            stat_date = str(row.get('统计日期', ''))
            if not stat_date or stat_date == 'nan':
                m = re.search(r'(\d{4}-\d{2}-\d{2})', fname)
                stat_date = m.group(1) if m else ''
            if not stat_date:
                continue
            stat_date = str(stat_date)[:10]
            def g(k):  return safe_float(row.get(k))
            def gp(k): return safe_pct(row.get(k))
            batch.append((
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
            ))
        if batch:
            psycopg2.extras.execute_values(cur, sql, batch)
            conn.commit()  # 每个文件 commit 一次，不丢进度
        total += len(batch)
        if fi % 10 == 0 or fi == len(files):
            print(f"    [{fi}/{len(files)}] 累计 {total} 行")
    print(f"  fact_syzt_product: {total} rows ({len(files)} files)")

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
    # 兼容两种目录结构：推广报表/商品报表/*.csv  或  推广报表/商品报表*.csv
    matches = (glob.glob(os.path.join(DATA_DIR, '推广报表', '商品报表', '*.csv'))
            or glob.glob(os.path.join(DATA_DIR, '推广报表', '商品报表*.csv')))
    if not matches:
        print("  [SKIP] 万象台商品报表 not found")
        return
    cur = conn.cursor()
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
        ON CONFLICT(stat_date, product_id) DO NOTHING
    """
    seen = set()
    total = 0
    print(f"  万象台商品报表：开始处理 {len(matches)} 个 CSV 文件")
    for fi, fpath in enumerate(sorted(matches), 1):
        fname = os.path.basename(fpath)
        try:
            _, rs = read_csv_gbk(fpath)
        except Exception as e:
            print(f"  [WARN] {fname}: {e}")
            continue
        batch = []
        for row in rs:
            pid = str(row.get('主体ID', '')).strip()
            if not pid:
                continue
            # Option A：灌全店所有 PID（不再过滤 25 主链）。
            # 前端「优化页 25 SKU 视图」靠 OFFICIAL Set 过滤，不依赖 ETL 过滤；
            # 总览页 / 对账需要全店真实数据。
            stat_date = str(row.get('日期', '')).strip()[:10]
            if not stat_date:
                continue
            key = (stat_date, pid)
            if key in seen: continue
            seen.add(key)
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
                fname
            ))
        if batch:
            psycopg2.extras.execute_values(cur, sql, batch, page_size=200)
            conn.commit()
        total += len(batch)
        print(f"    [{fi}/{len(matches)}] {fname}: +{len(batch)}（累计 {total}）")
    print(f"  fact_wxst_product: {total} rows ({len(matches)} files)")

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
        ON CONFLICT(stat_date, audience_name) DO NOTHING
    """
    seen = set()
    total = 0
    print(f"  万象台人群报表：开始处理 {len(matches)} 个 CSV 文件")
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
    print(f"  fact_wxst_audience: {total} rows ({len(matches)} files)")

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
        ON CONFLICT (stat_date, keyword_id, scene_name, keyword_name) DO NOTHING
    """
    seen = set()
    total = 0
    print(f"  万象台关键词报表：开始处理 {len(matches)} 个 CSV 文件")
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
    print(f"  fact_wxst_keyword: {total} rows ({len(matches)} files)")

# ─────────────────────────────────────────────
# 万象台内容报表（短视频/直播花费数据源）
# 文件夹：推广报表/内容报表/*.csv
# 关键：主体ID = 视频ID，主体类型 = 短视频/直播
# ─────────────────────────────────────────────
def load_wxst_content(conn):
    matches = glob.glob(os.path.join(DATA_DIR, '推广报表', '内容报表', '*.csv'))
    if not matches:
        print("  [SKIP] 万象台内容报表 not found")
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
        ON CONFLICT(stat_date, content_id, content_type) DO NOTHING
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
    print(f"  fact_wxst_content: {total} rows ({len(matches)} files)")

# ─────────────────────────────────────────────
# 无限店铺流量
# ─────────────────────────────────────────────
def load_traffic(conn):
    d = os.path.join(DATA_DIR, '无限店铺流量')
    if not os.path.isdir(d):
        print("  [SKIP] 无限店铺流量 dir not found")
        return
    files = sorted(glob.glob(os.path.join(d, '*.xls')))
    cur = conn.cursor()
    total = 0

    sql = """
        INSERT INTO fact_traffic (
            stat_date, source_l1, source_l2, source_l3, source_l4,
            visitors, pay_buyers, collect_buyers, cart_users, source_file
        ) VALUES %s
        ON CONFLICT(stat_date, source_l1, source_l2, source_l3, source_l4) DO NOTHING
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
    ap.add_argument('--start', default='2026-01-01')
    ap.add_argument('--end',   default='2026-12-31')
    args = ap.parse_args()

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

    print("[8] 无限店铺流量")
    load_traffic(conn)

    conn.close()
    print("[ETL] Done -> Neon PostgreSQL")

if __name__ == '__main__':
    main()
