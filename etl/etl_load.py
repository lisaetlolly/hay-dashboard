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

NEON_DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://neondb_owner:npg_vJrIahw5N0gO@ep-steep-poetry-ao6yf96a.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
)

# 两个 Facet Cabinet SKU 合并为同一 SPU，展示用新款 ID
SPU_MAP = {
    '824452791755': '1016294283167',
}

def _load_product_ids():
    path = os.path.join(DATA_DIR, '优化商品ID清单.xlsx')
    if os.path.exists(path):
        # existing xlsx loading code...
        zf = zipfile.ZipFile(path)
        sh_xml = zf.read('xl/worksheets/sheet1.xml').decode('utf-8')
        sr = ET.fromstring(sh_xml)
        ns = {'n': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        ids = set()
        for i, row in enumerate(sr.findall('.//n:row', ns)):
            if i == 0:
                continue
            cells = row.findall('n:c', ns)
            if not cells:
                continue
            v = cells[0].find('n:v', ns)
            if v is not None and v.text:
                ids.add(str(v.text).strip())
        print(f"  [优化商品ID清单] 加载 {len(ids)} 个商品ID")
        return ids
    else:
        # Fallback: read from dim_product in the database
        print("  [优化商品ID清单] 文件未找到，从数据库 dim_product 读取")
        try:
            conn = get_conn()
            cur = conn.cursor()
            cur.execute("SELECT product_id FROM dim_product")
            ids = {r[0] for r in cur.fetchall()}
            conn.close()
            if ids:
                print(f"  [dim_product] 加载 {len(ids)} 个商品ID")
                return ids
        except Exception as e:
            print(f"  [WARN] 无法从数据库读取商品ID: {e}")
        # Last resort: read from dashboard.html static RAW
        html_path = os.path.join(DATA_DIR, 'dashboard.html')
        if os.path.exists(html_path):
            import json
            html = open(html_path, encoding='utf-8').read()
            try:
                start = html.index('const RAW = ')
                end   = html.index('const OFFICIAL = new Set(RAW.official_pids)')
                raw   = json.loads(html[start + len('const RAW = '):end].strip())
                ids   = set(raw.get('cat_map', {}).keys())
                print(f"  [dashboard.html] 加载 {len(ids)} 个商品ID")
                return ids
            except Exception as e2:
                print(f"  [WARN] 无法从 dashboard.html 读取: {e2}")
        raise FileNotFoundError("无法获取商品ID列表（xlsx/db/html 均不可用）")

PRODUCT_IDS = _load_product_ids()

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
                fact_wxst_kw_product, fact_wxst_rq_product,
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
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO dim_date VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
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
# ─────────────────────────────────────────────
def load_dim_product(conn):
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

    inv_path = os.path.join(DATA_DIR, '优化商品ID清单.xlsx')
    products = {}
    if os.path.exists(inv_path):
        for r in read_xlsx_all(inv_path)[1:]:
            if r and r[0]:
                pid   = str(r[0]).strip()
                title = str(r[1]).strip() if len(r) > 1 else ''
                inv   = int(float(r[2])) if len(r) > 2 and r[2] else 0
                if pid in PRODUCT_IDS:
                    products[pid] = (title, inv)

    cur = conn.cursor()
    inserted = 0
    for pid, (title, inv) in products.items():
        l1, l2 = cats.get(pid, ('', ''))
        sid = spu_id(pid)
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
    print(f"  dim_product: {inserted} rows (SPU合并: {len(SPU_MAP)} 对)")

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
    for fpath in files:
        fname = os.path.basename(fpath)
        headers, rows = read_xls(fpath)
        if not headers:
            continue
        for row in rows:
            pid = str(row.get('商品ID', '')).strip()
            if not pid or pid not in PRODUCT_IDS:
                continue
            stat_date = str(row.get('统计日期', ''))
            if not stat_date or stat_date == 'nan':
                m = re.search(r'(\d{4}-\d{2}-\d{2})', fname)
                stat_date = m.group(1) if m else ''
            if not stat_date:
                continue
            stat_date = str(stat_date)[:10]

            def g(k):  return safe_float(row.get(k))
            def gp(k): return safe_pct(row.get(k))

            cur.execute("""
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
                ) VALUES (
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
                )
                ON CONFLICT(stat_date, product_id) DO NOTHING
            """, (
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
            total += 1
    conn.commit()
    print(f"  fact_syzt_product: {total} rows attempted ({len(files)} files)")

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
    matches = glob.glob(os.path.join(DATA_DIR, '推广报表', '商品报表*.csv'))
    if not matches:
        print("  [SKIP] 万象台商品报表 not found")
        return
    fname = os.path.basename(sorted(matches)[-1])
    _, rows = read_csv_gbk(sorted(matches)[-1])
    cur = conn.cursor()
    total = 0
    for row in rows:
        pid = str(row.get('主体ID', '')).strip()
        if not pid or pid not in PRODUCT_IDS:
            continue
        stat_date = str(row.get('日期', '')).strip()[:10]
        if not stat_date:
            continue

        def g(k):  return safe_float(row.get(k))
        def gp(k): return safe_pct(row.get(k))

        cur.execute("""
            INSERT INTO fact_wxst_product (
                stat_date, product_id, product_name,
                impressions, clicks, spend, ctr, avg_cpc, cpm,
                total_gmv, direct_gmv, indirect_gmv,
                click_cvr, roi, cart_rate, cart_cnt,
                collect_item_cnt, collect_shop_cnt, total_collect_cart, item_collect_cart,
                guided_visits, avg_visit_pages, transaction_buyers, new_buyers,
                natural_gmv, natural_impressions, source_file
            ) VALUES (
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
            )
            ON CONFLICT(stat_date, product_id) DO NOTHING
        """, (
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
        total += 1
    conn.commit()
    print(f"  fact_wxst_product: {total} rows")

def load_wxst_audience(conn):
    matches = glob.glob(os.path.join(DATA_DIR, '推广报表', '人群报表*.csv'))
    if not matches:
        print("  [SKIP] 万象台人群报表 not found")
        return
    fname = os.path.basename(sorted(matches)[-1])
    _, rows = read_csv_gbk(sorted(matches)[-1])
    cur = conn.cursor()
    total = 0
    for row in rows:
        stat_date = str(row.get('日期', '')).strip()[:10]
        aname = str(row.get('人群名字', '')).strip()
        if not stat_date or not aname:
            continue

        def g(k):  return safe_float(row.get(k))
        def gp(k): return safe_pct(row.get(k))

        cur.execute("""
            INSERT INTO fact_wxst_audience (
                stat_date, audience_name, product_name,
                impressions, clicks, spend, ctr, avg_cpc, cpm,
                total_gmv, direct_gmv, indirect_gmv,
                click_cvr, roi, cart_rate, cart_cnt,
                collect_item_cnt, collect_shop_cnt, total_collect_cart, item_collect_cart,
                guided_visits, avg_visit_pages, new_buyers,
                natural_gmv, natural_impressions, source_file
            ) VALUES (
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s
            )
            ON CONFLICT(stat_date, audience_name) DO NOTHING
        """, (
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
        total += 1
    conn.commit()
    print(f"  fact_wxst_audience: {total} rows")

def load_wxst_keyword(conn):
    matches = glob.glob(os.path.join(DATA_DIR, '推广报表', '关键词报表*.csv'))
    if not matches:
        print("  [SKIP] 万象台关键词报表 not found")
        return
    fname = os.path.basename(sorted(matches)[-1])
    _, rows = read_csv_gbk(sorted(matches)[-1])
    cur = conn.cursor()
    total = 0
    for row in rows:
        stat_date = str(row.get('日期', '')).strip()[:10]
        kname = str(row.get('词名字/词包名字', '')).strip()
        if not stat_date or not kname:
            continue

        def g(k):  return safe_float(row.get(k))
        def gp(k): return safe_pct(row.get(k))

        cur.execute("""
            INSERT INTO fact_wxst_keyword (
                stat_date, keyword_name, keyword_id, keyword_type, scene_name, product_name,
                impressions, clicks, spend, ctr, avg_cpc, cpm,
                total_gmv, direct_gmv, indirect_gmv,
                click_cvr, roi, cart_rate, cart_cnt,
                collect_item_cnt, collect_shop_cnt, total_collect_cart, item_collect_cart,
                guided_visits, avg_visit_pages, new_buyers,
                natural_gmv, natural_impressions, source_file
            ) VALUES (
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
            )
            ON CONFLICT(stat_date, keyword_name) DO NOTHING
        """, (
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
        total += 1
    conn.commit()
    print(f"  fact_wxst_keyword: {total} rows")

def _load_wxst_channel_product(conn, subdir, table_name):
    """通用：读取渠道商品报表（人群推广商品报表 / 关键词商品报表）"""
    import csv
    matches = glob.glob(os.path.join(DATA_DIR, '推广报表', subdir, '*.csv'))
    if not matches:
        print(f"  [SKIP] {subdir} not found")
        return
    cur = conn.cursor()
    total = 0
    for fpath in sorted(matches):
        fname = os.path.basename(fpath)
        with open(fpath, 'rb') as f:
            raw_bytes = f.read()
        for enc in ('gbk', 'utf-8-sig', 'utf-8'):
            try:
                text = raw_bytes.decode(enc); break
            except UnicodeDecodeError:
                continue
        else:
            text = raw_bytes.decode('gbk', errors='replace')
        rows_csv = list(csv.DictReader(text.splitlines()))
        for row in rows_csv:
            pid = str(row.get('主体ID', '')).strip()
            if not pid or pid not in PRODUCT_IDS:
                continue
            stat_date = str(row.get('日期', '')).strip()[:10]
            if not stat_date:
                continue
            spend = safe_float(row.get('花费')) or 0
            imps  = safe_float(row.get('展现量')) or 0
            ctr   = safe_pct(row.get('点击率')) or 0
            roi   = safe_float(row.get('投入产出比')) or 0
            gmv   = safe_float(row.get('总成交金额')) or 0
            cur.execute(f"""
                INSERT INTO {table_name} (stat_date, product_id, spend, impressions, ctr, roi, total_gmv, source_file)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT(stat_date, product_id) DO UPDATE SET
                    spend=EXCLUDED.spend, impressions=EXCLUDED.impressions,
                    ctr=EXCLUDED.ctr, roi=EXCLUDED.roi, total_gmv=EXCLUDED.total_gmv
            """, (stat_date, pid, spend, imps, ctr, roi, gmv, fname))
            total += 1
    conn.commit()
    print(f"  {table_name}: {total} rows")

def load_wxst_rq_product(conn):
    _load_wxst_channel_product(conn, '人群推广商品报表', 'fact_wxst_rq_product')

def load_wxst_kw_product(conn):
    _load_wxst_channel_product(conn, '关键词商品报表', 'fact_wxst_kw_product')

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

    for fpath in files:
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

            cur.execute("""
                INSERT INTO fact_traffic (
                    stat_date, source_l1, source_l2, source_l3, source_l4,
                    visitors, pay_buyers, collect_buyers, cart_users, source_file
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT(stat_date, source_l1, source_l2, source_l3, source_l4) DO NOTHING
            """, (
                stat_date, current_l1, cell1, sl3, sl4,
                gv(row, '访客数'),
                gv(row, '支付买家数'),
                gv(row, '商品收藏人数'),
                gv(row, '加购人数'),
                fname
            ))
            total += 1

    conn.commit()
    print(f"  fact_traffic: {total} rows attempted ({len(files)} files)")

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

    print("[8] 万象台人群推广商品报表")
    load_wxst_rq_product(conn)

    print("[9] 万象台关键词商品报表")
    load_wxst_kw_product(conn)

    print("[7] 无限店铺流量")
    load_traffic(conn)

    conn.close()
    print("[ETL] Done -> Neon PostgreSQL")

if __name__ == '__main__':
    main()
