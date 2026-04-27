"""
一键灌入旧 hardcoded 数据到 Neon —— 本地运行
用法:  python etl/seed_legacy_local.py

读取 etl/legacy_seed.json (从旧 dashboard.html 提取的快照，46商品/1678syzt/1603wxst)
写入 Neon PostgreSQL 的 dim_product / fact_syzt_product / fact_wxst_product
"""
import json
import os
import sys
import psycopg2

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://neondb_owner:npg_vJrIahw5N0gO@ep-steep-poetry-ao6yf96a-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
)

BASE = os.path.dirname(os.path.abspath(__file__))
SEED_PATH = os.path.join(BASE, 'legacy_seed.json')
SCHEMA_PATH = os.path.join(BASE, 'schema.sql')


def main():
    if not os.path.exists(SEED_PATH):
        print(f"[ERROR] 找不到 {SEED_PATH}")
        print("请先 git pull origin main 拉取最新代码（包含 legacy_seed.json）")
        sys.exit(1)

    print(f"[1/5] 读取 {SEED_PATH} ...")
    with open(SEED_PATH, 'r', encoding='utf-8') as f:
        seed = json.load(f)
    products  = seed.get('products', {})
    wxst_rows = seed.get('wxst', [])
    pid_daily = seed.get('pid_daily_spend', {})
    cat_map   = seed.get('cat_map', {})
    print(f"   产品 {len(products)} 个，syzt {sum(len(p.get('dates',[])) for p in products.values())} 天，"
          f"wxst {len(wxst_rows)} 行，pid_daily_spend {len(pid_daily)} 个")

    print(f"[2/5] 连接 Neon ({DSN.split('@')[-1].split('/')[0]}) ...")
    conn = psycopg2.connect(DSN, connect_timeout=30)
    conn.autocommit = False
    cur = conn.cursor()
    print("   连接成功")

    print("[3/5] 建表（schema.sql）...")
    if os.path.exists(SCHEMA_PATH):
        with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
            cur.execute(f.read())
        conn.commit()
        print("   schema OK")
    else:
        print(f"   [WARN] {SCHEMA_PATH} 不存在，跳过建表（假设已建好）")

    print("[4/5] 写入 dim_product + fact_syzt_product + fact_wxst_product ...")
    n_prod = n_syzt = n_wxst = 0

    # dim_product
    for pid, p in products.items():
        title = p.get('name') or pid
        cat_l1 = p.get('cat') or cat_map.get(pid) or ''
        cur.execute("""
            INSERT INTO dim_product(product_id, spu_id, title, category_l1, category_l2, inventory)
            VALUES (%s, %s, %s, %s, '', 0)
            ON CONFLICT(product_id) DO UPDATE SET
                title=EXCLUDED.title, category_l1=EXCLUDED.category_l1
        """, (pid, pid, title, cat_l1))
        n_prod += 1

    # fact_syzt_product
    for pid, p in products.items():
        dates = p.get('dates', [])
        pay = p.get('pay', []); vis = p.get('vis', []); cart = p.get('cart', [])
        collect = p.get('collect', []); refund = p.get('refund', []); nb = p.get('new_buyers', [])
        for i, d in enumerate(dates):
            pay_v = pay[i] if i < len(pay) else 0
            vis_v = vis[i] if i < len(vis) else 0
            cart_v = cart[i] if i < len(cart) else 0
            col_v = collect[i] if i < len(collect) else 0
            ref_v = refund[i] if i < len(refund) else 0
            nb_v = nb[i] if i < len(nb) else 0
            if not (pay_v or vis_v or cart_v or col_v or ref_v or nb_v):
                continue
            cur.execute("""
                INSERT INTO fact_syzt_product(stat_date, product_id, visitors, cart_users,
                    collect_users, pay_amount, refund_amount, pay_new_buyers, source_file)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'legacy_seed')
                ON CONFLICT(stat_date, product_id) DO UPDATE SET
                    visitors=EXCLUDED.visitors, cart_users=EXCLUDED.cart_users,
                    collect_users=EXCLUDED.collect_users, pay_amount=EXCLUDED.pay_amount,
                    refund_amount=EXCLUDED.refund_amount, pay_new_buyers=EXCLUDED.pay_new_buyers
            """, (d, pid, vis_v, cart_v, col_v, pay_v, ref_v, nb_v))
            n_syzt += 1

    # fact_wxst_product (从 pid_daily_spend 还原)
    for pid, daily_map in pid_daily.items():
        for d, vals in daily_map.items():
            spend = vals.get('spend', 0)
            ctr = vals.get('ctr', 0)
            roi = vals.get('roi', 0)
            if not (spend or ctr or roi):
                continue
            cur.execute("""
                INSERT INTO fact_wxst_product(stat_date, product_id, spend, ctr, roi, impressions, source_file)
                VALUES (%s,%s,%s,%s,%s,0,'legacy_seed')
                ON CONFLICT(stat_date, product_id) DO UPDATE SET
                    spend=EXCLUDED.spend, ctr=EXCLUDED.ctr, roi=EXCLUDED.roi
            """, (d, pid, spend, ctr, roi))
            n_wxst += 1

    # 用 wxst_rows 补 impressions
    n_imps = 0
    for r in wxst_rows:
        d = r.get('d'); pid = r.get('pid')
        imps = r.get('imps') or 0
        if not d or not pid or not imps:
            continue
        cur.execute("""
            UPDATE fact_wxst_product SET impressions=%s
            WHERE stat_date=%s AND product_id=%s
        """, (imps, d, pid))
        n_imps += 1

    conn.commit()
    print(f"   dim_product: {n_prod} | fact_syzt_product: {n_syzt} | fact_wxst_product: {n_wxst} | imps: {n_imps}")

    print("[5/5] 验证 ...")
    cur.execute("SELECT COUNT(*) FROM dim_product")
    print(f"   dim_product 行数: {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*), SUM(pay_amount), MIN(stat_date), MAX(stat_date) FROM fact_syzt_product")
    r = cur.fetchone()
    print(f"   fact_syzt_product: {r[0]} 行，总GMV={r[1]:.2f}，日期 {r[2]} → {r[3]}")
    cur.execute("SELECT COUNT(*), SUM(spend), MIN(stat_date), MAX(stat_date) FROM fact_wxst_product")
    r = cur.fetchone()
    print(f"   fact_wxst_product: {r[0]} 行，总花费={r[1]:.2f}，日期 {r[2]} → {r[3]}")

    conn.close()
    print("\n✅ 完成！现在去访问 https://hay-dashboard.onrender.com/ 强制刷新（Ctrl+Shift+R）")


if __name__ == '__main__':
    main()
