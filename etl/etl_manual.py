# -*- coding: utf-8 -*-
"""
HAY 手动数据录入脚本
用于: 小红书笔记、付费推广数据（无源表格，手动摘录后填入此脚本执行）
用法: python etl_manual.py --db etl/hay.db
"""
import sqlite3, argparse, os, sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def get_conn(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

# ─────────────────────────────────────────────
# 小红书笔记录入
# ─────────────────────────────────────────────
def insert_xhs_note(conn, note_title, note_url, publish_time, author,
                    likes, collects, shares, comments, reads,
                    products):
    """
    products: list of (product_id, product_name_in_note)
    示例:
      insert_xhs_note(conn,
        note_title='HAY花瓶开箱测评',
        note_url='https://www.xiaohongshu.com/xxx',
        publish_time='2026-04-15',
        author='小红薯123',
        likes=1200, collects=340, shares=56, comments=89, reads=15000,
        products=[('886839411718','HAY Empire Vase')]
      )
    """
    cur = conn.cursor()
    cur.execute("""INSERT OR REPLACE INTO fact_xhs_note
        (note_title,note_url,publish_time,author,likes,collects,shares,comments,reads)
        VALUES(?,?,?,?,?,?,?,?,?)""",
        (note_title, note_url, publish_time, author,
         likes, collects, shares, comments, reads))
    note_id = cur.lastrowid
    for pid, pname in (products or []):
        cur.execute("""INSERT INTO fact_xhs_note_product(note_id,product_id,product_mention)
            VALUES(?,?,?)""", (note_id, pid, pname))
    conn.commit()
    print(f"  XHS note inserted: id={note_id} title={note_title[:30]}")
    return note_id

# ─────────────────────────────────────────────
# 付费推广录入
# ─────────────────────────────────────────────
def insert_paid_promo(conn, stat_date, promo_type, dimension_name,
                      visitors, visitors_wow, view_3s_users,
                      product_click_users, cart_users, pay_buyers, pay_amount,
                      product_id=None):
    """
    promo_type: '人群推广' 或 '关键词推广'
    visitors_wow: 环比，小数形式（如 0.05 = +5%）
    """
    conn.execute("""INSERT OR REPLACE INTO fact_paid_promo
        (stat_date,promo_type,dimension_name,product_id,
         visitors,visitors_wow,view_3s_users,product_click_users,
         cart_users,pay_buyers,pay_amount)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        (stat_date, promo_type, dimension_name, product_id,
         visitors, visitors_wow, view_3s_users,
         product_click_users, cart_users, pay_buyers, pay_amount))
    conn.commit()
    print(f"  paid_promo inserted: {stat_date} {promo_type} {dimension_name}")

# ─────────────────────────────────────────────
# 示例 — 把下面的示例换成实际摘录的数据
# ─────────────────────────────────────────────
def load_sample_data(conn):
    # 小红书示例
    insert_xhs_note(conn,
        note_title='HAY花瓶测评｜北欧风居家好物分享',
        note_url='https://www.xiaohongshu.com/explore/example001',
        publish_time='2026-04-10',
        author='北欧好物分享官',
        likes=2300, collects=580, shares=120, comments=145, reads=32000,
        products=[
            ('886839411718', 'HAY Empire Vase 花瓶'),
            ('1022489092196', 'HAY Conical Vase 花瓶'),
        ]
    )
    # 付费推广示例
    insert_paid_promo(conn,
        stat_date='2026-04-21',
        promo_type='人群推广',
        dimension_name='新客定向人群',
        visitors=1200, visitors_wow=0.05,
        view_3s_users=800, product_click_users=650,
        cart_users=180, pay_buyers=45, pay_amount=12600.0
    )
    insert_paid_promo(conn,
        stat_date='2026-04-21',
        promo_type='关键词推广',
        dimension_name='北欧花瓶',
        visitors=340, visitors_wow=-0.02,
        view_3s_users=220, product_click_users=180,
        cart_users=55, pay_buyers=12, pay_amount=3800.0
    )

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=os.path.join(BASE_DIR, 'etl/hay.db'))
    ap.add_argument('--sample', action='store_true', help='Load sample/demo data')
    args = ap.parse_args()
    if not os.path.exists(args.db):
        print(f"DB not found: {args.db}\nRun etl_load.py first.")
        sys.exit(1)
    conn = get_conn(args.db)
    if args.sample:
        load_sample_data(conn)
    conn.close()
    print("Done.")

if __name__ == '__main__':
    main()
