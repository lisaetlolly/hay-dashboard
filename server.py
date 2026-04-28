"""
HAY 电商数据看板 — API 服务（连接 Neon PostgreSQL）
运行: python3 server.py
访问: http://localhost:766
"""
import hashlib
import os
from contextlib import contextmanager
from typing import Optional, Any
from datetime import date

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, Query, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

NEON_DSN = os.environ.get("DATABASE_URL")
if not NEON_DSN:
    raise RuntimeError(
        "环境变量 DATABASE_URL 未设置。\n"
        "本地：export DATABASE_URL='postgresql://...'\n"
        "Render：在 Dashboard → Environment → 增加 DATABASE_URL\n"
        "（请勿把 Neon 密码 commit 进代码库）"
    )

DASHBOARD_DIR = os.path.dirname(os.path.abspath(__file__))

app = FastAPI(title="HAY Dashboard API")

# 挂载商品图片静态目录
_img_dir = os.path.join(DASHBOARD_DIR, "25个商品图片")
if os.path.exists(_img_dir):
    app.mount("/images", StaticFiles(directory=_img_dir), name="images")

# 挂载模块化 JS 目录
_js_dir = os.path.join(DASHBOARD_DIR, "js")
if os.path.exists(_js_dir):
    app.mount("/js", StaticFiles(directory=_js_dir), name="js")


@app.on_event("startup")
def create_tables():
    try:
        with db() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id            SERIAL PRIMARY KEY,
                    username      TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    display_name  TEXT NOT NULL DEFAULT '',
                    role          TEXT NOT NULL DEFAULT 'viewer',
                    permissions   JSONB NOT NULL DEFAULT '{}',
                    created_at    TIMESTAMPTZ DEFAULT now()
                )
            """)
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'")
            cur.execute("SELECT COUNT(*) FROM users")
            if cur.fetchone()[0] == 0:
                pw = hashlib.sha256(b"hay2026").hexdigest()
                cur.execute(
                    "INSERT INTO users (username, password_hash, display_name, role, permissions) VALUES (%s,%s,%s,%s,'{}') ON CONFLICT DO NOTHING",
                    ("admin", pw, "管理员", "admin")
                )
            cur.execute("""
                CREATE TABLE IF NOT EXISTS page_views (
                    id               SERIAL PRIMARY KEY,
                    page_path        TEXT NOT NULL,
                    username         TEXT NOT NULL DEFAULT '',
                    opened_at        TIMESTAMPTZ DEFAULT now(),
                    duration_seconds INT DEFAULT 0
                )
            """)
            conn.commit()
    except Exception as e:
        import logging
        logging.warning(f"Startup DB init skipped (offline mode): {e}")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@contextmanager
def db():
    try:
        conn = psycopg2.connect(NEON_DSN, connect_timeout=5)
        conn.autocommit = False
        try:
            yield conn
        finally:
            conn.close()
    except Exception:
        # Fallback: yield a dummy that will cause API calls to use SQLite path
        raise


# ══════════════════════════════════════════════════════════════════════
# 权限校验：FastAPI Dependency
# ══════════════════════════════════════════════════════════════════════
# 前端在所有写操作 fetch 中带 X-Username header（在 js/api.js 统一注入）
# 后端按用户名查 users 表 → 返回 user dict 给业务函数检查 permissions
# 注意：这是"信任前端 header"的简化方案，适用于内部团队工具，
#       不替代真正的 Bearer Token / OAuth。
def get_current_user(x_username: Optional[str] = Header(default=None, alias="X-Username")):
    """读 header 拿当前用户。未带 header → 返回 None（公开 endpoint 兼容）"""
    if not x_username:
        return None
    try:
        with db() as conn:
            return row(conn, """
                SELECT id, username, display_name, role, permissions
                FROM users WHERE username = %s
            """, (x_username,))
    except Exception:
        return None


def require_permission(perm_code: str):
    """
    Decorator-like dependency。给写 endpoint 加 Depends(require_permission('task.create'))，
    会自动从 X-Username 找用户并校验权限。
    'admin' 或 permissions 含 '*' → 通过所有；
    permissions 含 perm_code → 通过该 code；
    否则 → 403。
    """
    def _checker(user: Optional[dict] = Depends(get_current_user)):
        if not user:
            raise HTTPException(401, "未登录或缺少 X-Username header")
        perms = user.get("permissions") or []
        if isinstance(perms, dict):
            # 兼容旧 jsonb={} 默认值
            perms = []
        if user.get("role") == "admin" or "*" in perms or perm_code in perms:
            return user
        raise HTTPException(403, f"无 {perm_code} 权限（当前角色 {user.get('role')}）")
    return _checker


def rows(conn, sql, params=()):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


def row(conn, sql, params=()):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(sql, params)
    r = cur.fetchone()
    return dict(r) if r else None


# ── 默认日期范围（投放周期起始到今天）
CAMPAIGN_START = "2026-04-08"


def default_range():
    return CAMPAIGN_START, date.today().isoformat()


# ══════════════════════════════════════════════════
# 商品维度
# ══════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════════════════
# /api/raw-data — 给 dashboard.html 启动时一次性拉的"大包"数据
# 前端会 Object.assign(RAW, data)，所以返回的 key 直接覆盖到 RAW.* 上。
# 关键字段：products / syzt / wxst / pid_daily_spend / video_daily / data_end
# ══════════════════════════════════════════════════════════════════════
@app.get("/api/raw-data")
def get_raw_data():
    """
    一次性返回前端 RAW 需要的所有数据（products 时序 + syzt/wxst 明细
    + 各种映射表）。前端启动时 fetch 这个，失败时回退到内嵌 RAW（仅元数据）。
    """
    from datetime import datetime
    try:
        with db() as conn:
            # 1. dim_product → 25 主链 + 副 SKU
            #    ORDER 让主 SKU(product_id == spu_id) 排前，使 spu_meta 用主 SKU title
            dim = rows(conn, """
                SELECT product_id, spu_id, title, category_l1, category_l2, inventory,
                       (product_id = spu_id) AS is_main
                FROM dim_product
                ORDER BY spu_id, is_main DESC, product_id
            """)
            spu_to_pids = {}  # spu_id → list of product_id (主+副)
            spu_meta = {}     # spu_id → {title, cat}
            for d in dim:
                sid = d["spu_id"]
                spu_to_pids.setdefault(sid, []).append(d["product_id"])
                # 主 SKU 优先（is_main=TRUE 排在前面），首次遇到即记录
                if sid not in spu_meta:
                    spu_meta[sid] = {
                        "title": d["title"],
                        "cat": d["category_l1"] or "其他",
                        "category_l2": d["category_l2"] or "",
                        "inventory": d["inventory"] or 0,
                    }

            # 2. 取所有有数据的日期范围
            dates_row = row(conn, """
                SELECT MIN(stat_date) AS s, MAX(stat_date) AS e
                FROM fact_syzt_product
            """) or {}
            data_start = dates_row.get("s") or "2026-02-01"
            data_end   = dates_row.get("e") or date.today().isoformat()

            # 3. 拉所有 syzt 明细（按 SPU 聚合，副 SKU 合并到主）
            syzt_data = rows(conn, """
                SELECT p.spu_id,
                       s.stat_date AS d,
                       SUM(s.pay_amount)        AS pay,
                       SUM(s.visitors)          AS vis,
                       SUM(s.cart_users)        AS cart,
                       SUM(s.collect_users)     AS collect,
                       SUM(s.refund_amount)     AS refund,
                       SUM(s.pay_new_buyers)    AS new_buyers,
                       SUM(s.page_views)        AS pv,
                       SUM(s.search_visitors)   AS search_vis,
                       SUM(s.avg_stay_duration * s.visitors)::numeric/NULLIF(SUM(s.visitors),0) AS dwell_time,
                       SUM(s.bounce_rate * s.visitors)::numeric/NULLIF(SUM(s.visitors),0)        AS bounce_rate,
                       SUM(s.pay_old_buyers)    AS old_buyers,
                       SUM(s.pay_new_buyers + s.pay_old_buyers) AS pay_buyers
                FROM fact_syzt_product s
                JOIN dim_product p ON s.product_id = p.product_id
                GROUP BY p.spu_id, s.stat_date
                ORDER BY p.spu_id, s.stat_date
            """)
            # 4. 拉所有 wxst 商品级（按 SPU 聚合）
            wxst_data = rows(conn, """
                SELECT p.spu_id,
                       w.stat_date AS d,
                       SUM(w.spend)        AS spend,
                       SUM(w.total_gmv)    AS ad_gmv,
                       SUM(w.impressions)  AS imps,
                       SUM(w.clicks)       AS clicks,
                       SUM(w.clicks)::numeric / NULLIF(SUM(w.impressions),0) AS ctr,
                       SUM(w.total_gmv)::numeric / NULLIF(SUM(w.spend),0)    AS roi
                FROM fact_wxst_product w
                JOIN dim_product p ON w.product_id = p.product_id
                GROUP BY p.spu_id, w.stat_date
                ORDER BY p.spu_id, w.stat_date
            """)

            # 5. 把数据按 SPU 组装成时序（products 结构）
            from collections import defaultdict
            syzt_by_spu = defaultdict(list)
            for r in syzt_data:
                syzt_by_spu[r["spu_id"]].append(r)
            wxst_by_spu = defaultdict(dict)
            for r in wxst_data:
                wxst_by_spu[r["spu_id"]][r["d"]] = r

            products = {}
            for spu_id, meta in spu_meta.items():
                # 该 SPU 的所有有数据日期
                syzt_rows = syzt_by_spu.get(spu_id, [])
                wxst_rows = wxst_by_spu.get(spu_id, {})
                # 不再跳过没数据的商品 —— 主链 SKU 没销售也要保留在列表里，
                # 否则商品管理页 OFFICIAL 25 个会因为某个新品零数据少 1 个
                all_dates = sorted({r["d"] for r in syzt_rows} | set(wxst_rows.keys()))
                # 构建 dates 数组 + 各列时序
                arr_pay, arr_vis, arr_cart, arr_collect, arr_refund = [], [], [], [], []
                arr_new_buyers, arr_pay_buyers, arr_old_buyers = [], [], []
                arr_pv, arr_search_vis, arr_dwell, arr_bounce = [], [], [], []
                arr_spend, arr_ctr, arr_roi = [], [], []
                syzt_idx = {r["d"]: r for r in syzt_rows}
                for d in all_dates:
                    sy = syzt_idx.get(d, {})
                    wx = wxst_rows.get(d, {})
                    arr_pay.append(float(sy.get("pay") or 0))
                    arr_vis.append(int(sy.get("vis") or 0))
                    arr_cart.append(int(sy.get("cart") or 0))
                    arr_collect.append(int(sy.get("collect") or 0))
                    arr_refund.append(float(sy.get("refund") or 0))
                    arr_new_buyers.append(int(sy.get("new_buyers") or 0))
                    arr_old_buyers.append(int(sy.get("old_buyers") or 0))
                    arr_pay_buyers.append(int(sy.get("pay_buyers") or 0))
                    arr_pv.append(int(sy.get("pv") or 0))
                    arr_search_vis.append(int(sy.get("search_vis") or 0))
                    arr_dwell.append(float(sy.get("dwell_time") or 0))
                    arr_bounce.append(float(sy.get("bounce_rate") or 0))
                    arr_spend.append(float(wx.get("spend") or 0))
                    arr_ctr.append(float(wx.get("ctr") or 0))
                    arr_roi.append(float(wx.get("roi") or 0))
                products[spu_id] = {
                    "pid": spu_id,
                    "name": meta["title"],
                    "cat": meta["cat"],
                    "category_l2": meta["category_l2"],
                    "inventory": meta["inventory"],
                    "dates": all_dates,
                    "pay": arr_pay, "vis": arr_vis, "cart": arr_cart,
                    "collect": arr_collect, "refund": arr_refund,
                    "new_buyers": arr_new_buyers, "old_buyers": arr_old_buyers,
                    "pay_buyers": arr_pay_buyers,
                    "pv": arr_pv, "search_vis": arr_search_vis,
                    "dwell_time": arr_dwell, "bounce_rate": arr_bounce,
                    "spend": arr_spend, "ctr": arr_ctr, "roi": arr_roi,
                }

            # 6. 扁平 syzt / wxst 数组（兼容老 compute.js）
            syzt_flat = [{"d": r["d"], "pid": r["spu_id"],
                          "pay": float(r.get("pay") or 0),
                          "vis": int(r.get("vis") or 0),
                          "cart": int(r.get("cart") or 0)} for r in syzt_data]
            wxst_flat = [{"d": r["d"], "pid": r["spu_id"],
                          "spend": float(r.get("spend") or 0),
                          "ctr": float(r.get("ctr") or 0),
                          "imps": int(r.get("imps") or 0),
                          "clicks": int(r.get("clicks") or 0)} for r in wxst_data]

            # 7. pid_daily_spend：每个 SPU 每天的 spend/ctr/roi
            pid_daily_spend = {}
            for r in wxst_data:
                pid_daily_spend.setdefault(r["spu_id"], {})[r["d"]] = {
                    "spend": float(r.get("spend") or 0),
                    "ctr":   float(r.get("ctr") or 0),
                    "roi":   float(r.get("roi") or 0),
                }

            # 8. video_daily：从 fact_wxst_content（短视频）按日聚合
            try:
                vd_rows = rows(conn, """
                    SELECT stat_date AS d,
                           SUM(spend)        AS spend,
                           SUM(total_gmv)    AS gmv,
                           SUM(clicks)       AS clicks,
                           SUM(impressions)  AS imps
                    FROM fact_wxst_content
                    WHERE content_type = '短视频'
                    GROUP BY stat_date ORDER BY stat_date
                """)
                video_daily = {r["d"]: {
                    "spend": float(r["spend"] or 0),
                    "gmv":   float(r["gmv"] or 0),
                    "clicks": int(r["clicks"] or 0),
                    "imps":   int(r["imps"] or 0),
                } for r in vd_rows}
            except Exception:
                video_daily = {}

            # 9. official_pids = 主链 SPU 列表（dim_product 里 spu_id == product_id 的）
            #    排除 ETL 的 EXTRA_PRODUCTS 兜底（Cotton Bag / PC Portable / Paper Shade / Manolito 等）
            #    它们写进 dim_product 是为了让任务面板能查到名字，不是主链单品。
            EXTRA_FALLBACK_PIDS = {
                '564552361178',   # Cotton Bag
                '886901025905',   # PC Portable Lamp
                '818210888511',   # Paper Shade
                '1021718193334',  # Manolito Stool
                # Barro Bowl & Plate (1020815058332) 是真主链，留在 25 里
                # Facet 副SKU (824452791755) spu!=pid，本来就不会被算进
            }
            official_pids = sorted({d["spu_id"] for d in dim
                                    if d["spu_id"] == d["product_id"]
                                    and d["product_id"] not in EXTRA_FALLBACK_PIDS})

            # 9a. img_map —— 实际扫描 25个商品图片/ 目录，避免幽灵路径
            img_map = {}
            # 已知 PID typo 别名（来源：etl/etl_load.py PID_FIX）。
            # 即使 ETL 还没重跑，前端用旧 PID 查图也能命中正确文件。
            PID_TYPO_ALIASES = {
                '7660181033346': '1020815058332',  # Barro Bowl & Plate
            }
            try:
                img_dir = os.path.join(DASHBOARD_DIR, "25个商品图片")
                if os.path.exists(img_dir):
                    for fname in os.listdir(img_dir):
                        # 文件名 = "{pid}.{ext}"，pid 必须是纯数字
                        stem = fname.rsplit(".", 1)[0]
                        if stem.isdigit():
                            img_map[stem] = "/images/" + fname
                # 副 SKU 共用主 SKU 的图
                for d in dim:
                    pid = d["product_id"]; sid = d["spu_id"]
                    if pid != sid and sid in img_map and pid not in img_map:
                        img_map[pid] = img_map[sid]
                # typo PID 别名：把错误 PID 也指向正确 PID 的图
                for typo_pid, real_pid in PID_TYPO_ALIASES.items():
                    if real_pid in img_map and typo_pid not in img_map:
                        img_map[typo_pid] = img_map[real_pid]
            except Exception:
                pass

            # 9b. cat_map / short_names —— 用 Neon 数据覆盖前端 RAW 里的旧 typo（如 7660181033346）
            cat_map = {}
            short_names = {}
            for d in dim:
                pid = d["product_id"]
                cat_map[pid] = d["category_l1"] or "其他"
                short_names[pid] = d["title"] or pid
                # 副 SKU 也填上主链的标题，避免老旧链接 lookup 失败
                sid = d["spu_id"]
                if sid != pid:
                    cat_map.setdefault(sid, d["category_l1"] or "其他")
                    short_names.setdefault(sid, d["title"] or sid)
            # typo PID 别名：让旧 PID 也能 lookup 到分类/名称（前端 RAW 快照里残留的 typo）
            for typo_pid, real_pid in PID_TYPO_ALIASES.items():
                if real_pid in cat_map:
                    cat_map.setdefault(typo_pid, cat_map[real_pid])
                if real_pid in short_names:
                    short_names.setdefault(typo_pid, short_names[real_pid])

            # 10. tasks_by_pid（从 tasks 表读，按 product_id 分组）
            tasks_by_pid = {}
            try:
                t_rows = rows(conn, """
                    SELECT id, product_id, detail, owner, status, priority,
                           category, time_range_label, execution_note
                    FROM tasks
                    WHERE product_id IS NOT NULL
                    ORDER BY product_id, id
                """)
                for t in t_rows:
                    pid = t["product_id"]
                    tasks_by_pid.setdefault(pid, []).append(t)
            except Exception:
                pass

            # 11. meetings
            try:
                meetings = rows(conn, """
                    SELECT id, week_label, meeting_date, title, content,
                           important_level, created_by_name
                    FROM meeting_notes ORDER BY meeting_date DESC
                """)
                for m in meetings:
                    if m.get("meeting_date"):
                        m["meeting_date"] = str(m["meeting_date"])
            except Exception:
                meetings = []

            # 12. plan_pct（从 category_audience_plan 读）
            try:
                pl_rows = rows(conn, """
                    SELECT category, plan_pct FROM category_audience_plan
                """)
                plan_pct = {r["category"]: float(r["plan_pct"]) for r in pl_rows}
            except Exception:
                plan_pct = {"家具": 63, "配饰": 30, "灯具": 5, "其他": 2}

            # 13. xhs_notes（小红书笔记）—— ETL 拉的 + 用户手动加的，前端按 PID 分组用
            try:
                xhs_rows = rows(conn, """
                    SELECT n.id, n.note_title AS title, n.note_url AS link,
                           n.publish_time AS date, n.author,
                           COALESCE(n.likes,0)    AS likes,
                           COALESCE(n.collects,0) AS collect,
                           COALESCE(n.comments,0) AS comments,
                           COALESCE(n.reads,0)    AS views,
                           array_agg(np.product_id) AS product_ids
                    FROM fact_xhs_note n
                    LEFT JOIN fact_xhs_note_product np ON np.note_id = n.id
                    GROUP BY n.id
                    ORDER BY n.publish_time DESC
                """)
                xhs_notes = []
                xhs_by_pid_full = {}
                for r in xhs_rows:
                    pids = [p for p in (r.get("product_ids") or []) if p]
                    inter = (r.get("likes") or 0) + (r.get("collect") or 0) + (r.get("comments") or 0)
                    base = {
                        "id": r["id"], "title": r["title"] or "", "link": r["link"] or "",
                        "date": str(r["date"] or ""), "author": r["author"] or "",
                        "likes": r["likes"], "collect": r["collect"],
                        "comments": r["comments"], "inter": inter,
                        "views": r["views"],
                    }
                    for pid in (pids or [None]):
                        item = dict(base, pid=pid)
                        xhs_notes.append(item)
                        if pid:
                            agg = xhs_by_pid_full.setdefault(pid, {
                                "notes": 0, "likes": 0, "collect": 0,
                                "comments": 0, "inter": 0, "views": 0,
                            })
                            agg["notes"]    += 1
                            agg["likes"]    += item["likes"]
                            agg["collect"]  += item["collect"]
                            agg["comments"] += item["comments"]
                            agg["inter"]    += item["inter"]
                            agg["views"]    += item["views"]
            except Exception:
                xhs_notes, xhs_by_pid_full = [], {}

            return {
                "products":        products,
                "syzt":            syzt_flat,
                "wxst":            wxst_flat,
                "pid_daily_spend": pid_daily_spend,
                "video_daily":     video_daily,
                "official_pids":   official_pids,
                "cat_map":         cat_map,
                "short_names":     short_names,
                "img_map":         img_map,
                "tasks_by_pid":    tasks_by_pid,
                "meetings":        meetings,
                "plan_pct":        plan_pct,
                "xhs_notes":       xhs_notes,
                "xhs_by_pid":      xhs_by_pid_full,
                "data_start":      data_start,
                "data_end":        data_end,
                "loaded_at":       datetime.now().strftime("%m-%d %H:%M"),
                "_source":         "neon",
            }
    except Exception as e:
        import traceback
        return {
            "_error":   str(e),
            "_traceback": traceback.format_exc()[:2000],
            "products": {}, "syzt": [], "wxst": [],
            "pid_daily_spend": {}, "video_daily": {},
            "official_pids": [], "tasks_by_pid": {}, "meetings": [],
            "plan_pct": {"家具": 63, "配饰": 30, "灯具": 5, "其他": 2},
        }


@app.get("/api/products")
def get_products():
    with db() as conn:
        return rows(conn, "SELECT * FROM dim_product ORDER BY category_l1, title")


# ══════════════════════════════════════════════════
# 万象台广告数据
# ══════════════════════════════════════════════════

@app.get("/api/ads/daily")
def get_ads_daily(
    start: str = Query(default=None),
    end: str = Query(default=None),
    product_id: Optional[str] = None,
):
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        if product_id:
            return rows(conn, """
                SELECT w.*, p.title as product_title, p.category_l1
                FROM fact_wxst_product w
                LEFT JOIN dim_product p ON w.product_id = p.product_id
                WHERE w.stat_date BETWEEN %s AND %s AND w.product_id = %s
                ORDER BY w.stat_date
            """, (s, e, product_id))
        return rows(conn, """
            SELECT w.*, p.title as product_title, p.category_l1
            FROM fact_wxst_product w
            LEFT JOIN dim_product p ON w.product_id = p.product_id
            WHERE w.stat_date BETWEEN %s AND %s
            ORDER BY w.stat_date, w.spend DESC
        """, (s, e))


@app.get("/api/ads/summary")
def get_ads_summary(
    start: str = Query(default=None),
    end: str = Query(default=None),
):
    """按商品(SPU)汇总投放期间总花费、总GMV、加权ROI、加权CTR"""
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        return rows(conn, """
            SELECT
                p.spu_id,
                MAX(w.product_id)                     AS product_id,
                MAX(p.title)                          AS product_title,
                MAX(p.category_l1)                    AS category_l1,
                MAX(p.category_l2)                    AS category_l2,
                COUNT(DISTINCT w.stat_date)           AS days,
                ROUND(SUM(w.spend), 2)                AS total_spend,
                ROUND(SUM(w.total_gmv), 2)            AS total_gmv,
                ROUND(SUM(w.direct_gmv), 2)           AS total_direct_gmv,
                ROUND(SUM(w.indirect_gmv), 2)         AS total_indirect_gmv,
                ROUND(SUM(w.total_gmv) / NULLIF(SUM(w.spend),0), 2) AS roi,
                ROUND(SUM(w.clicks) / NULLIF(SUM(w.impressions),0) * 100, 4) AS avg_ctr,
                ROUND(SUM(w.spend) / NULLIF(SUM(w.clicks),0), 2)  AS avg_cpc,
                SUM(w.new_buyers)                     AS total_new_buyers,
                ROUND(SUM(w.spend) / NULLIF(SUM(w.new_buyers),0), 2) AS cpna,
                SUM(w.cart_cnt)                       AS total_cart_cnt,
                SUM(w.total_collect_cart)             AS total_collect_cart,
                SUM(w.impressions)                    AS total_impressions,
                SUM(w.clicks)                         AS total_clicks,
                SUM(w.guided_visits)                  AS total_guided_visits,
                SUM(w.transaction_buyers)             AS total_transaction_buyers,
                ROUND(SUM(w.natural_gmv), 2)          AS total_natural_gmv,
                SUM(w.natural_impressions)            AS total_natural_impressions
            FROM fact_wxst_product w
            LEFT JOIN dim_product p ON w.product_id = p.product_id
            WHERE w.stat_date BETWEEN %s AND %s
            GROUP BY p.spu_id
            ORDER BY total_spend DESC
        """, (s, e))


@app.get("/api/ads/category")
def get_ads_by_category(
    start: str = Query(default=None),
    end: str = Query(default=None),
):
    """按品类汇总花费"""
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        return rows(conn, """
            SELECT
                p.category_l1,
                ROUND(SUM(w.spend), 2)       AS total_spend,
                ROUND(SUM(w.total_gmv), 2)   AS total_gmv,
                ROUND(SUM(w.total_gmv) / NULLIF(SUM(w.spend),0), 2) AS roi,
                COUNT(DISTINCT w.product_id) AS product_count
            FROM fact_wxst_product w
            LEFT JOIN dim_product p ON w.product_id = p.product_id
            WHERE w.stat_date BETWEEN %s AND %s
            GROUP BY p.category_l1
            ORDER BY total_spend DESC
        """, (s, e))


@app.get("/api/ads/latest")
def get_ads_latest():
    """最新一天的全店广告汇总"""
    with db() as conn:
        latest = row(conn, "SELECT MAX(stat_date) as d FROM fact_wxst_product")
        if not latest or not latest["d"]:
            return {}
        d = latest["d"]
        return row(conn, """
            SELECT
                stat_date,
                ROUND(SUM(spend), 2)      AS total_spend,
                ROUND(SUM(total_gmv), 2)  AS total_gmv,
                ROUND(SUM(total_gmv) / NULLIF(SUM(spend),0), 2) AS roi,
                SUM(total_collect_cart)   AS total_collect_cart,
                SUM(new_buyers)           AS total_new_buyers
            FROM fact_wxst_product
            WHERE stat_date = %s
        """, (d,))


# ══════════════════════════════════════════════════
# 生意参谋商品数据
# ══════════════════════════════════════════════════

@app.get("/api/syzt/summary")
def get_syzt_summary(
    start: str = Query(default=None),
    end: str = Query(default=None),
):
    """按商品(SPU)汇总生意参谋指标，转化率全部加权计算"""
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        return rows(conn, """
            SELECT
                p.spu_id,
                MAX(s.product_id)                       AS product_id,
                MAX(p.title)                            AS product_title,
                MAX(p.category_l1)                      AS category_l1,
                MAX(p.category_l2)                      AS category_l2,
                COUNT(DISTINCT s.stat_date)             AS days,
                SUM(s.visitors)                         AS total_visitors,
                SUM(s.page_views)                       AS total_pv,
                ROUND(SUM(s.page_views)/NULLIF(SUM(s.visitors),0), 2) AS avg_pv_per_uv,
                SUM(s.pay_amount)                       AS total_pay,
                SUM(s.order_amount)                     AS total_order,
                SUM(s.refund_amount)                    AS total_refund,
                ROUND(SUM(s.pay_amount) - SUM(s.refund_amount), 2) AS net_pay,
                SUM(s.cart_users)                       AS total_cart_users,
                SUM(s.cart_qty)                         AS total_cart_qty,
                SUM(s.collect_users)                    AS total_collect,
                SUM(s.order_buyers)                     AS total_order_buyers,
                SUM(s.order_qty)                        AS total_order_qty,
                SUM(s.pay_new_buyers)                   AS total_new_buyers,
                SUM(s.pay_old_buyers)                   AS total_old_buyers,
                SUM(s.search_visitors)                  AS total_search_visitors,
                ROUND(SUM(s.search_visitors)/NULLIF(SUM(s.visitors),0)*100, 2) AS search_traffic_pct,
                ROUND(SUM(s.cart_users)/NULLIF(SUM(s.visitors),0)*100, 4)      AS cart_rate,
                ROUND(SUM(s.collect_users)/NULLIF(SUM(s.visitors),0)*100, 4)   AS collect_rate,
                ROUND(SUM(s.order_buyers)/NULLIF(SUM(s.visitors),0)*100, 4)    AS order_cvr,
                ROUND(SUM(s.pay_amount)/NULLIF(SUM(s.visitors),0), 2)          AS visitor_value,
                ROUND(SUM(s.pay_amount)/NULLIF(SUM(s.pay_new_buyers)+SUM(s.pay_old_buyers),0), 2) AS avg_order_value,
                ROUND(SUM(s.pay_new_buyers)/NULLIF(SUM(s.pay_new_buyers)+SUM(s.pay_old_buyers),0)*100, 2) AS new_buyer_pct,
                -- 平均停留时长按 UV 加权（高 UV 天数权重更大）
                ROUND(SUM(s.avg_stay_duration * s.visitors)::numeric / NULLIF(SUM(s.visitors),0), 1) AS avg_stay_duration,
                -- 跳出率按 UV 加权
                ROUND(SUM(s.bounce_rate * s.visitors)::numeric / NULLIF(SUM(s.visitors),0) * 100, 2) AS avg_bounce_rate
            FROM fact_syzt_product s
            LEFT JOIN dim_product p ON s.product_id = p.product_id
            WHERE s.stat_date BETWEEN %s AND %s
            GROUP BY p.spu_id
            ORDER BY total_pay DESC
        """, (s, e))


@app.get("/api/syzt/daily")
def get_syzt_daily(
    start: str = Query(default=None),
    end: str = Query(default=None),
    product_id: Optional[str] = None,
):
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        if product_id:
            return rows(conn, """
                SELECT s.*, p.title as product_title
                FROM fact_syzt_product s
                LEFT JOIN dim_product p ON s.product_id = p.product_id
                WHERE s.stat_date BETWEEN %s AND %s AND s.product_id = %s
                ORDER BY s.stat_date
            """, (s, e, product_id))
        return rows(conn, """
            SELECT s.*, p.title as product_title, p.category_l1
            FROM fact_syzt_product s
            LEFT JOIN dim_product p ON s.product_id = p.product_id
            WHERE s.stat_date BETWEEN %s AND %s
            ORDER BY s.stat_date, s.pay_amount DESC
        """, (s, e))


# ══════════════════════════════════════════════════
# 流量数据
# ══════════════════════════════════════════════════

@app.get("/api/traffic/summary")
def get_traffic_summary(
    start: str = Query(default=None),
    end: str = Query(default=None),
):
    """按一级来源汇总流量"""
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        return rows(conn, """
            SELECT
                source_l1,
                source_l2,
                ROUND(SUM(visitors), 0)         AS total_visitors,
                ROUND(SUM(pay_buyers), 0)        AS total_pay_buyers,
                ROUND(SUM(product_visitors), 0)  AS total_product_visitors
            FROM fact_traffic
            WHERE stat_date BETWEEN %s AND %s
              AND source_l1 != ''
              AND visitors > 0
            GROUP BY source_l1, source_l2
            ORDER BY total_visitors DESC
        """, (s, e))


@app.get("/api/traffic/trend")
def get_traffic_trend(
    start: str = Query(default=None),
    end: str = Query(default=None),
):
    """全店每日访客趋势"""
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        return rows(conn, """
            SELECT
                stat_date,
                ROUND(SUM(CASE WHEN visitors > 0 THEN visitors ELSE 0 END), 0) AS total_visitors,
                ROUND(SUM(CASE WHEN pay_buyers > 0 THEN pay_buyers ELSE 0 END), 0) AS total_pay_buyers
            FROM fact_traffic
            WHERE stat_date BETWEEN %s AND %s
            GROUP BY stat_date
            ORDER BY stat_date
        """, (s, e))


# ══════════════════════════════════════════════════
# 关键词 & 人群
# ══════════════════════════════════════════════════

@app.get("/api/keywords/top")
def get_top_keywords(
    start: str = Query(default=None),
    end: str = Query(default=None),
    limit: int = 20,
):
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        return rows(conn, """
            SELECT
                keyword_name,
                scene_name,
                ROUND(SUM(spend), 2)      AS total_spend,
                ROUND(SUM(total_gmv), 2)  AS total_gmv,
                ROUND(SUM(total_gmv) / NULLIF(SUM(spend),0), 2) AS roi,
                ROUND(AVG(ctr) * 100, 2)  AS avg_ctr
            FROM fact_wxst_keyword
            WHERE stat_date BETWEEN %s AND %s
            GROUP BY keyword_name, scene_name
            ORDER BY total_spend DESC
            LIMIT %s
        """, (s, e, limit))


@app.get("/api/ads/channel-split")
def get_channel_split(
    start: str = Query(default=None),
    end: str = Query(default=None),
):
    """
    渠道花费按场景拆分（实时计算）。
    优先级：fact_wxst_scene（万象台后台「全营销场景报表」权威源，老板钦定）→ 没数据时回退到 fact_wxst_audience+keyword
    """
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        # 优先用全营销场景报表（万象台后台口径，含店铺直达/货品全站等）
        scene_rows = []
        try:
            scene_rows = rows(conn, """
                SELECT scene_name, COALESCE(SUM(spend), 0) AS s
                FROM fact_wxst_scene
                WHERE stat_date BETWEEN %s AND %s
                GROUP BY scene_name
            """, (s, e))
        except Exception:
            scene_rows = []
        scene_map = {r["scene_name"]: float(r["s"] or 0) for r in scene_rows}
        if scene_map:
            a = scene_map.get("人群推广", 0) + scene_map.get("精准人群推广", 0)
            k = scene_map.get("关键词推广", 0)
            v = scene_map.get("超级短视频", 0)
            shop = scene_map.get("店铺直达", 0)
            allscene = scene_map.get("货品全站推广", 0)
            total_all = sum(scene_map.values())
            return {
                "period":         {"start": s, "end": e},
                "source":         "fact_wxst_scene",
                "audience_spend": round(a, 2),
                "keyword_spend":  round(k, 2),
                "video_spend":    round(v, 2),
                "shop_direct_spend":   round(shop, 2),
                "all_scene_spend":     round(allscene, 2),
                "total_scene_spend":   round(total_all, 2),
                "by_scene":            {n: round(v, 2) for n, v in scene_map.items()},
                "total":          round(a + k, 2),  # 兼容老前端
                "audience_pct":   round(a / (a + k) * 100, 1) if (a + k) > 0 else None,
                "keyword_pct":    round(k / (a + k) * 100, 1) if (a + k) > 0 else None,
            }
        # fallback: 老 audience+keyword 表
        aud = row(conn, """
            SELECT COALESCE(SUM(spend), 0) AS s
            FROM fact_wxst_audience
            WHERE stat_date BETWEEN %s AND %s
        """, (s, e)) or {"s": 0}
        kw = row(conn, """
            SELECT COALESCE(SUM(spend), 0) AS s
            FROM fact_wxst_keyword
            WHERE stat_date BETWEEN %s AND %s
        """, (s, e)) or {"s": 0}
        a = float(aud["s"] or 0)
        k = float(kw["s"] or 0)
        total = a + k
        return {
            "period":         {"start": s, "end": e},
            "source":         "fact_wxst_audience+keyword",
            "audience_spend": round(a, 2),
            "keyword_spend":  round(k, 2),
            "total":          round(total, 2),
            "audience_pct":   round(a / total * 100, 1) if total > 0 else None,
            "keyword_pct":    round(k / total * 100, 1) if total > 0 else None,
        }


# ── 人群投放品类计划（admin 可编辑）──
@app.get("/api/settings/audience-plan")
def get_audience_plan():
    """
    返回 4 个品类（家具/配饰/灯具/其他）的人群投放计划比例。
    晓东定的，admin 角色可以在设置页改。
    """
    with db() as conn:
        try:
            return rows(conn, """
                SELECT category, plan_pct, sort_order, updated_at, updated_by
                FROM category_audience_plan
                ORDER BY sort_order
            """)
        except Exception:
            return []


class AudiencePlanItem(BaseModel):
    category: str
    plan_pct: float


class AudiencePlanUpdate(BaseModel):
    items: list  # [{ "category":"家具", "plan_pct":63 }, ...]
    updated_by: str = ""


@app.put("/api/settings/audience-plan")
def update_audience_plan(body: AudiencePlanUpdate, _user=Depends(require_permission('metric.edit'))):
    """
    替换 4 行人群品类计划。允许总和 ≠ 100（前端给个 warning，但不强制）。
    谁改的记到 updated_by。
    """
    if not body.items:
        raise HTTPException(400, "items 不能为空")
    total = sum(float(it.get("plan_pct", 0)) for it in body.items)
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        for i, it in enumerate(body.items):
            cat = it.get("category", "").strip()
            pct = float(it.get("plan_pct", 0))
            if not cat:
                continue
            cur.execute("""
                INSERT INTO category_audience_plan (category, plan_pct, sort_order, updated_by, updated_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (category) DO UPDATE SET
                    plan_pct = EXCLUDED.plan_pct,
                    sort_order = EXCLUDED.sort_order,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = now()
            """, (cat, pct, (i+1)*10, body.updated_by))
        conn.commit()
        return {
            "ok": True,
            "total_pct": round(total, 1),
            "warning": "计划总和不为 100%" if abs(total - 100) > 0.5 else None
        }


# ── 内容报表（短视频/直播）汇总 ──
@app.get("/api/ads/content-summary")
def get_content_summary(
    start: str = Query(default=None),
    end: str = Query(default=None),
    content_type: Optional[str] = Query(default=None,
        description="过滤：短视频 / 直播 / 图文。留空=全部"),
):
    """
    内容报表汇总，主要给"短视频推广花费 KPI"和"内容投放面板"用。
    数据源：fact_wxst_content（来自 推广报表/内容报表/*.csv）
    """
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    where = ["stat_date BETWEEN %s AND %s"]
    params = [s, e]
    if content_type:
        where.append("content_type = %s"); params.append(content_type)
    with db() as conn:
        try:
            summary = row(conn, f"""
                SELECT
                    COALESCE(SUM(spend), 0)          AS total_spend,
                    COALESCE(SUM(impressions), 0)    AS total_impressions,
                    COALESCE(SUM(clicks), 0)         AS total_clicks,
                    COALESCE(SUM(total_gmv), 0)      AS total_gmv,
                    ROUND(SUM(total_gmv)::numeric/NULLIF(SUM(spend),0), 2) AS roi,
                    ROUND(SUM(clicks)::numeric/NULLIF(SUM(impressions),0)*100, 4) AS ctr,
                    COUNT(DISTINCT content_id)       AS content_count
                FROM fact_wxst_content
                WHERE {' AND '.join(where)}
            """, tuple(params)) or {}
            top_videos = rows(conn, f"""
                SELECT content_id, content_name, content_type,
                       ROUND(SUM(spend), 2)      AS total_spend,
                       ROUND(SUM(total_gmv), 2)  AS total_gmv,
                       ROUND(SUM(total_gmv)/NULLIF(SUM(spend),0), 2) AS roi,
                       SUM(impressions)          AS impressions,
                       SUM(clicks)               AS clicks
                FROM fact_wxst_content
                WHERE {' AND '.join(where)}
                GROUP BY content_id, content_name, content_type
                ORDER BY total_spend DESC
                LIMIT 20
            """, tuple(params))
            return {
                "period": {"start": s, "end": e},
                "summary": summary,
                "top_videos": top_videos,
            }
        except Exception as e:
            return {"period": {"start": s, "end": e}, "summary": {}, "top_videos": [], "error": str(e)}


@app.get("/api/audience/top")
def get_top_audience(
    start: str = Query(default=None),
    end: str = Query(default=None),
):
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        return rows(conn, """
            SELECT
                audience_name,
                ROUND(SUM(spend), 2)      AS total_spend,
                ROUND(SUM(total_gmv), 2)  AS total_gmv,
                ROUND(SUM(total_gmv) / NULLIF(SUM(spend),0), 2) AS roi,
                ROUND(AVG(ctr) * 100, 2)  AS avg_ctr
            FROM fact_wxst_audience
            WHERE stat_date BETWEEN %s AND %s
            GROUP BY audience_name
            ORDER BY total_spend DESC
            LIMIT 20
        """, (s, e))


# ══════════════════════════════════════════════════
# 任务
# ══════════════════════════════════════════════════

class TaskCreate(BaseModel):
    product_id: Optional[str] = None
    detail: str
    owner: str = ""
    status: str = "待开始"
    priority: str = "中"
    category: str = ""
    time_range_label: str = ""
    execution_note: str = ""
    start_date: Optional[str] = None
    eta_date: Optional[str] = None
    template_id: Optional[int] = None


class TaskUpdate(BaseModel):
    detail: Optional[str] = None
    owner: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    execution_note: Optional[str] = None
    note_images: Optional[list] = None     # base64 dataURI 数组，支持备注里多张图
    time_range_label: Optional[str] = None
    start_date: Optional[str] = None       # 任务开始日期（'YYYY-MM-DD' 或 '' 清空）
    eta_date: Optional[str] = None         # 任务截止日期（'YYYY-MM-DD' 或 '' 清空）
    completed_at: Optional[str] = None     # 管理员补录历史完成时间用（'YYYY-MM-DD' 或 ISO timestamp）
    category: Optional[str] = None
    template_id: Optional[int] = None


@app.get("/api/tasks")
def get_tasks(
    product_id: Optional[str] = None,
    owner: Optional[str] = None,
    period: Optional[str] = None,
    period_start: Optional[str] = None,
    period_end: Optional[str] = None,
    status: Optional[str] = None,
):
    """
    任务查询。所有参数可选并叠加：
    - product_id    单品过滤
    - owner         按负责人精确匹配（用于"我的任务"）
    - period        按周期标签精确匹配（如 '2026-04-27~2026-04-30'）
    - period_start / period_end  日历范围筛选（包含与该范围有重叠的周期）
    - status        状态过滤
    """
    where = []
    params = []
    if product_id:
        where.append("t.product_id = %s"); params.append(product_id)
    if owner:
        where.append("t.owner = %s"); params.append(owner)
    if period:
        where.append("t.time_range_label = %s"); params.append(period)
    if status:
        where.append("t.status = %s"); params.append(status)
    if period_start and period_end:
        # 周期格式 'YYYY-MM-DD~YYYY-MM-DD'，提取起止做范围交叠判断
        where.append("""
            EXISTS (SELECT 1 FROM task_period tp
                    WHERE tp.label = t.time_range_label
                      AND tp.start_date <= %s::date
                      AND tp.end_date   >= %s::date)
        """)
        params.extend([period_end, period_start])
    sql = "SELECT t.* FROM tasks t"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY t.time_range_label DESC, t.product_id, t.id"
    with db() as conn:
        return rows(conn, sql, tuple(params))


# ── 任务评论 / 反馈 ─────────────────────────────────────
def _ensure_task_comment_table():
    """server 启动时自建表（生产已建则跳过），避免 deploy 时漏跑 bootstrap"""
    try:
        with db() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS task_comment (
                    id              SERIAL PRIMARY KEY,
                    task_id         INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    author_username TEXT NOT NULL DEFAULT '',
                    author_name     TEXT NOT NULL DEFAULT '',
                    content         TEXT,
                    image_data      TEXT,
                    created_at      TIMESTAMPTZ DEFAULT now(),
                    updated_at      TIMESTAMPTZ DEFAULT now()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_task_comment_task ON task_comment(task_id)")
            conn.commit()
    except Exception as e:
        import logging; logging.warning(f"task_comment table init skipped: {e}")
_ensure_task_comment_table()


@app.get("/api/tasks/{task_id}/comments")
def list_task_comments(task_id: int):
    with db() as conn:
        try:
            return rows(conn, """
                SELECT id, task_id, author_username, author_name, content,
                       image_data, images,
                       created_at, updated_at
                FROM task_comment
                WHERE task_id = %s
                ORDER BY created_at ASC
            """, (task_id,))
        except Exception:
            # images 列还没建（老 DB），降级
            return rows(conn, """
                SELECT id, task_id, author_username, author_name, content, image_data,
                       created_at, updated_at
                FROM task_comment
                WHERE task_id = %s
                ORDER BY created_at ASC
            """, (task_id,))


class CommentCreate(BaseModel):
    content: Optional[str] = None
    # 兼容三种：单图 base64 字符串、多图字符串数组、新字段 images
    image_data: Optional[Any] = None
    images: Optional[list] = None


@app.post("/api/tasks/{task_id}/comments", status_code=201)
def create_task_comment(task_id: int, body: CommentCreate,
                         user: Optional[dict] = Depends(get_current_user)):
    if not user:
        raise HTTPException(401, "未登录")
    # 统一收集图片到一个 list
    imgs = []
    if body.images and isinstance(body.images, list):
        imgs = [x for x in body.images if isinstance(x, str)]
    elif isinstance(body.image_data, list):
        imgs = [x for x in body.image_data if isinstance(x, str)]
    elif isinstance(body.image_data, str):
        imgs = [body.image_data]
    if not body.content and not imgs:
        raise HTTPException(400, "评论内容和图片至少有一项")
    # 单张图大小限制
    for i, im in enumerate(imgs):
        if len(im) > 1500000:
            raise HTTPException(400, f"第 {i+1} 张图过大（>1MB）")
    # 总大小限制 10MB
    if sum(len(im) for im in imgs) > 10 * 1500000:
        raise HTTPException(400, "图片总量过大（>10MB）")
    # DB image_data 列存第一张（兼容旧前端）；images 列存全部 jsonb 数组
    import json as _json
    image_data_col = imgs[0] if imgs else None
    images_col = _json.dumps(imgs) if imgs else None
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # 自动加 images 列（如果还没有）
        try:
            cur.execute("ALTER TABLE task_comment ADD COLUMN IF NOT EXISTS images JSONB")
        except Exception:
            pass
        cur.execute("""
            INSERT INTO task_comment (task_id, author_username, author_name, content, image_data, images)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb) RETURNING *
        """, (task_id, user.get("username") or "", user.get("display_name") or "",
              body.content or "", image_data_col, images_col))
        out = dict(cur.fetchone())
        conn.commit()
        return out


class CommentUpdate(BaseModel):
    content: Optional[str] = None
    image_data: Optional[str] = None


@app.patch("/api/comments/{comment_id}")
def update_task_comment(comment_id: int, body: CommentUpdate,
                         user: Optional[dict] = Depends(get_current_user)):
    if not user:
        raise HTTPException(401, "未登录")
    with db() as conn:
        c = row(conn, "SELECT author_username FROM task_comment WHERE id = %s", (comment_id,))
        if not c:
            raise HTTPException(404, "评论不存在")
        # admin 或评论作者本人才能改
        perms = user.get("permissions") or []
        if isinstance(perms, dict): perms = []
        is_admin = user.get("role") == "admin" or "*" in perms
        if not is_admin and c["author_username"] != user.get("username"):
            raise HTTPException(403, "只能编辑自己的评论")
        fields = {k: v for k, v in body.model_dump().items() if v is not None}
        if not fields:
            raise HTTPException(400, "无字段更新")
        set_clause = ", ".join(f"{k} = %s" for k in fields)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            f"UPDATE task_comment SET {set_clause}, updated_at = now() WHERE id = %s RETURNING *",
            (*fields.values(), comment_id)
        )
        out = dict(cur.fetchone())
        conn.commit()
        return out


@app.delete("/api/comments/{comment_id}")
def delete_task_comment(comment_id: int, user: Optional[dict] = Depends(get_current_user)):
    if not user:
        raise HTTPException(401, "未登录")
    with db() as conn:
        c = row(conn, "SELECT author_username FROM task_comment WHERE id = %s", (comment_id,))
        if not c:
            return {"ok": True}
        perms = user.get("permissions") or []
        if isinstance(perms, dict): perms = []
        is_admin = user.get("role") == "admin" or "*" in perms
        if not is_admin and c["author_username"] != user.get("username"):
            raise HTTPException(403, "只能删除自己的评论")
        cur = conn.cursor()
        cur.execute("DELETE FROM task_comment WHERE id = %s", (comment_id,))
        conn.commit()
        return {"ok": True}


@app.get("/api/tasks/with-metrics")
def get_tasks_with_metrics(period_label: Optional[str] = None):
    """
    专为投放面板"任务面板"设计：
    - 按 product_id 分组任务，每组返回任务列表 + 当期 10 个指标 + 上期对比
    - period_label 不传时取 task_period.is_current=TRUE 的当前周期
    - 上期 = task_period.start_date < 当前周期.start_date 的最近一个

    返回 metrics 含：gmv, vis, cart, cart_rate, pay_cvr, ctr, spend,
                     dwell_time, content_visits（光合渠道流量）,
                     xhs_count（小红书笔记数）
    """
    with db() as conn:
        # 兜底：老库可能还没有 start_date / eta_date / completed_at 列
        cur = conn.cursor()
        cur.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE")
        cur.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS eta_date DATE")
        cur.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ")
        conn.commit()

        # period_label 三种语义：
        # · '' / 'all'   → 不过滤周期，返回全部任务（默认状态）
        # · 具体 label   → 只看那期 + 跨期未完成
        # · 缺省（None）  → 取最新一期
        view_all = (period_label is None or period_label == '' or period_label == 'all')

        # 1. 当前周期
        if not view_all:
            cur_period = row(conn, "SELECT label, start_date::text AS start_date, end_date::text AS end_date FROM task_period WHERE label = %s", (period_label,))
            if not cur_period:
                return {"error": "no current period found", "groups": [], "task_templates": []}
        else:
            # 默认全部模式：metrics 用"上周"作参考（运营约定 — 周一/周二看上周一-周日的数据）
            # 找包含 today-7 那天的 period
            from datetime import date, timedelta
            target = (date.today() - timedelta(days=7)).isoformat()
            cur_period = row(conn, """
                SELECT label, start_date::text AS start_date, end_date::text AS end_date
                FROM task_period
                WHERE start_date <= %s::date AND end_date >= %s::date
                ORDER BY start_date DESC LIMIT 1
            """, (target, target))
            if not cur_period:
                # 兜底：DB 里没有覆盖上周的 period → 用最新一期
                cur_period = row(conn, "SELECT label, start_date::text AS start_date, end_date::text AS end_date FROM task_period ORDER BY start_date DESC LIMIT 1")
            if not cur_period:
                cur_period = {"label": "—", "start_date": None, "end_date": None}
        # 2. 上期：start_date 小于当前的最近一个
        prev_period = None
        if cur_period.get("start_date"):
            prev_period = row(conn, """
                SELECT label, start_date::text AS start_date, end_date::text AS end_date
                FROM task_period
                WHERE start_date < %s::date
                ORDER BY start_date DESC LIMIT 1
            """, (cur_period["start_date"],))

        # 3. 任务列表
        DONE = ('done', '已完成', '完成')
        if view_all:
            # 全部任务（默认）
            tasks = rows(conn, """
                SELECT t.id, t.product_id, t.detail, t.owner, t.status, t.priority,
                       t.category, t.time_range_label, t.execution_note,
                       COALESCE(t.note_images, '[]'::jsonb) AS note_images,
                       t.template_id,
                       t.created_at::text         AS created_at,
                       t.start_date::text         AS start_date,
                       t.eta_date::text           AS eta_date,
                       t.completed_at::text       AS completed_at
                FROM tasks t
                WHERE t.product_id IS NOT NULL
                ORDER BY t.product_id, t.id
            """)
        else:
            tasks = rows(conn, """
            SELECT t.id, t.product_id, t.detail, t.owner, t.status, t.priority,
                   t.category, t.time_range_label, t.execution_note,
                   t.template_id,
                   t.created_at::text         AS created_at,
                   t.start_date::text         AS start_date,
                   t.eta_date::text           AS eta_date,
                   t.completed_at::text       AS completed_at
            FROM tasks t
            WHERE t.product_id IS NOT NULL
              AND (
                -- 主条件：当期任务
                t.time_range_label = %(label)s
                OR
                -- 跨期保留：未完成 + 起止日期跟本期重叠（只要 start_date < period.end 且 eta_date >= period.start）
                (
                  COALESCE(t.status,'') NOT IN %(done)s
                  AND t.start_date IS NOT NULL
                  AND t.eta_date IS NOT NULL
                  AND t.start_date <= %(end)s::date
                  AND t.eta_date >= %(start)s::date
                )
              )
            ORDER BY t.product_id, t.id
        """, {
            "label": cur_period["label"],
            "done":  DONE,
            "start": cur_period["start_date"],
            "end":   cur_period["end_date"],
        })

        # 4a. 25 个主链官方 PID — 硬编码，和前端 RAW.official_pids 完全一致。
        # 不再走 dim_product 推断（spu_id==product_id 在生产库里覆盖不全，会漏到 13~17 个）。
        OFFICIAL_25_PIDS = [
            '1020175879777',  # Grid Bag 尼龙包
            '580467335137',   # Basket 收纳篓
            '652664516885',   # Knit 衣架
            '975799789205',   # Canopy Umbrella 雨伞
            '1020815058332',  # Barro Bowl & Plate 碗盘
            '717349639294',   # Weekday 长凳
            '824946188993',   # Taburete 8 Bar Stool 吧椅
            '824607518747',   # Colour Rack 落地衣架
            '824882661931',   # Common Pendant & Table Cord 灯具组
            '742092260504',   # Apex Lamp 台灯
            '682036237751',   # Korpus 置物架
            '886839411718',   # Empire Vase 花瓶
            '880816460277',   # Apex Floor Lamp 落地灯
            '965048597796',   # La Pittura 餐盘
            '888002957800',   # Weekend Bag 帆布袋
            '1016294283167',  # Facet Cabinet 边柜
            '737675603229',   # Arcs Trolley 小推车
            '583134215392',   # Jessica Hans Vase 花瓶
            '781547798998',   # Slice Chopping Board 砧板
            '679198301351',   # Colour Crate 收纳篮
            '880120382310',   # Apex Wall Lamp 壁灯
            '690221882602',   # Bowler Table 茶几
            '1022489092196',  # Conical Vase 花瓶
            '887041510904',   # Coco Door Mat 地垫
            '689952405763',   # Revolver Stool & Bar Stool 吧椅
        ]
        official_pids = sorted(set(OFFICIAL_25_PIDS))

        # 4b. 涉及到的 product_id：25 个主链 + 当期 tasks 表里实际出现的 PID
        pids_with_tasks = {t["product_id"] for t in tasks}
        pids = sorted(set(official_pids) | pids_with_tasks)

        # 4c. 9 个固定任务模板（按 sort_order）—— 前端在空商品下当占位行用
        task_templates = rows(conn, """
            SELECT id, category, detail, default_owner, sort_order
            FROM task_template
            WHERE is_active = TRUE
            ORDER BY sort_order, id
        """)

        if not pids:
            return {
                "period": cur_period,
                "prev_period": prev_period,
                "groups": [],
                "task_templates": task_templates,
            }

        # 5. 每个 product_id 当期 + 上期的 metrics
        def calc_metrics(start, end):
            if not start or not end:
                return {}
            result = {}
            # syzt：gmv / vis / cart / cart_rate / pay_cvr / dwell_time
            syzt = rows(conn, """
                SELECT p.spu_id AS pid,
                       COALESCE(SUM(s.pay_amount), 0)        AS gmv,
                       COALESCE(SUM(s.visitors), 0)          AS vis,
                       COALESCE(SUM(s.cart_users), 0)        AS cart,
                       COALESCE(SUM(s.cart_users)::numeric / NULLIF(SUM(s.visitors),0) * 100, 0) AS cart_rate,
                       COALESCE(SUM(s.pay_new_buyers + s.pay_old_buyers)::numeric / NULLIF(SUM(s.visitors),0) * 100, 0) AS pay_cvr,
                       COALESCE(SUM(s.avg_stay_duration * s.visitors)::numeric / NULLIF(SUM(s.visitors),0), 0) AS dwell_time
                FROM fact_syzt_product s
                JOIN dim_product p ON s.product_id = p.product_id
                WHERE s.stat_date BETWEEN %s AND %s
                  AND p.spu_id = ANY(%s)
                GROUP BY p.spu_id
            """, (start, end, pids))
            for r in syzt:
                result[r["pid"]] = {
                    "gmv": float(r["gmv"] or 0),
                    "vis": int(r["vis"] or 0),
                    "cart": int(r["cart"] or 0),
                    "cart_rate": round(float(r["cart_rate"] or 0), 2),
                    "pay_cvr": round(float(r["pay_cvr"] or 0), 2),
                    "dwell_time": round(float(r["dwell_time"] or 0), 1),
                }
            # wxst：spend / ctr
            wxst = rows(conn, """
                SELECT p.spu_id AS pid,
                       COALESCE(SUM(w.spend), 0)         AS spend,
                       COALESCE(SUM(w.clicks)::numeric / NULLIF(SUM(w.impressions),0) * 100, 0) AS ctr
                FROM fact_wxst_product w
                JOIN dim_product p ON w.product_id = p.product_id
                WHERE w.stat_date BETWEEN %s AND %s
                  AND p.spu_id = ANY(%s)
                GROUP BY p.spu_id
            """, (start, end, pids))
            for r in wxst:
                m = result.setdefault(r["pid"], {})
                m["spend"] = round(float(r["spend"] or 0), 2)
                m["ctr"] = round(float(r["ctr"] or 0), 2)
            # 光合渠道流量（来自 fact_wxst_content - 内容报表的引导访问）
            # ⚠️ 内容报表是视频维度，不是商品维度。之前把全店总和赋给每个商品（13188 同一个值），
            # 完全没有可解读性，全部改为 0 — fmtMetric 会显示"/"，等"内容→商品"明细数据补齐再加。
            for pid in pids:
                result.setdefault(pid, {})["content_visits"] = 0
            # 小红书笔记数（按 publish_time 落在周期内 + 关联商品）
            try:
                xhs = rows(conn, """
                    SELECT np.product_id AS pid, COUNT(DISTINCT n.id) AS xhs_count
                    FROM fact_xhs_note n
                    JOIN fact_xhs_note_product np ON np.note_id = n.id
                    WHERE n.publish_time BETWEEN %s AND %s
                      AND np.product_id = ANY(%s)
                    GROUP BY np.product_id
                """, (start, end, pids))
                xhs_by_pid = {r["pid"]: int(r["xhs_count"] or 0) for r in xhs}
                for pid in pids:
                    result.setdefault(pid, {})["xhs_count"] = xhs_by_pid.get(pid, 0)
            except Exception:
                for pid in pids:
                    result.setdefault(pid, {})["xhs_count"] = 0
            # 补齐缺失字段为 0
            for pid in pids:
                m = result.setdefault(pid, {})
                for k in ("gmv", "vis", "cart", "cart_rate", "pay_cvr",
                          "dwell_time", "spend", "ctr", "content_visits", "xhs_count"):
                    m.setdefault(k, 0)
            return result

        cur_metrics = calc_metrics(cur_period["start_date"], cur_period["end_date"])
        prev_metrics = calc_metrics(prev_period["start_date"], prev_period["end_date"]) if prev_period else {}

        # 6. 商品名 / 分类 / 图片
        prod_info = rows(conn, """
            SELECT spu_id, MAX(title) AS title, MAX(category_l1) AS category_l1
            FROM dim_product
            WHERE spu_id = ANY(%s)
            GROUP BY spu_id
        """, (pids,))
        info_by_pid = {r["spu_id"]: r for r in prod_info}

        # 7. 组装 groups
        def diff_pct(cur, prev):
            if not prev or prev == 0:
                return None
            return round((cur - prev) / prev * 100, 1)

        groups = []
        tasks_by_pid = {}
        for t in tasks:
            tasks_by_pid.setdefault(t["product_id"], []).append(t)
        for pid in pids:
            cur_m = cur_metrics.get(pid, {})
            prev_m = prev_metrics.get(pid, {})
            diff = {k: diff_pct(cur_m.get(k, 0), prev_m.get(k, 0))
                    for k in cur_m}
            info = info_by_pid.get(pid, {})
            groups.append({
                "product_id":     pid,
                "product_name":   info.get("title") or pid,
                "category_l1":    info.get("category_l1") or "",
                "tasks":          tasks_by_pid.get(pid, []),
                "current_metrics": cur_m,
                "prev_metrics":   prev_m,
                "diff_pct":       diff,
            })
        # 按当期 GMV 从高到低（GMV 为 0 的商品排到末尾，但仍然返回）
        groups.sort(key=lambda g: g["current_metrics"].get("gmv", 0), reverse=True)

        return {
            "period":      cur_period,
            "prev_period": prev_period,
            "groups":      groups,
            "task_templates": task_templates,
        }


# ===========================================================================
# 团队 tab 新接口：新增任务配置 / 任务组 CRUD / 批量发布（覆盖式）
# ===========================================================================

class TaskTemplateCreate(BaseModel):
    category: str
    detail: str
    default_owners: list  # ["晓东（运营）", ...] 或 ["xxx"] 单负责人也是数组
    sort_order: Optional[int] = 999


@app.post("/api/task-templates", status_code=201)
def create_task_template(body: TaskTemplateCreate):
    """新增任务配置（一级标签 + 二级名称 + 一个或多个固定负责人）。
    标签若已存在 → 自动归到该标签下。"""
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # 兜底列
        cur.execute("ALTER TABLE task_template ADD COLUMN IF NOT EXISTS default_owners TEXT[]")
        conn.commit()
        # 重复检查
        existing = row(conn, """
            SELECT id FROM task_template
            WHERE category = %s AND detail = %s AND is_active = TRUE
        """, (body.category, body.detail))
        if existing:
            raise HTTPException(409, f"模板已存在（id={existing['id']}）")
        owners = body.default_owners or []
        primary_owner = owners[0] if owners else ''
        cur.execute("""
            INSERT INTO task_template (category, detail, default_owner, default_owners, sort_order, is_active)
            VALUES (%s, %s, %s, %s, %s, TRUE)
            RETURNING *
        """, (body.category, body.detail, primary_owner, owners, body.sort_order))
        conn.commit()
        return cur.fetchone()


@app.get("/api/task-groups")
def list_task_groups():
    """所有任务组及其包含的模板。"""
    with db() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS task_group (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              is_default BOOLEAN DEFAULT FALSE,
              created_at TIMESTAMPTZ DEFAULT now(),
              updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS task_group_member (
              group_id INT NOT NULL REFERENCES task_group(id) ON DELETE CASCADE,
              template_id INT NOT NULL REFERENCES task_template(id) ON DELETE CASCADE,
              sort_order INT DEFAULT 0,
              PRIMARY KEY (group_id, template_id)
            );
        """)
        conn.commit()
        groups = rows(conn, """
            SELECT g.id, g.name, g.is_default,
                   COALESCE(json_agg(json_build_object(
                     'template_id', m.template_id,
                     'category',    t.category,
                     'detail',      t.detail,
                     'sort_order',  m.sort_order
                   ) ORDER BY m.sort_order, m.template_id) FILTER (WHERE m.template_id IS NOT NULL), '[]') AS templates
            FROM task_group g
            LEFT JOIN task_group_member m ON m.group_id = g.id
            LEFT JOIN task_template t ON t.id = m.template_id
            GROUP BY g.id, g.name, g.is_default
            ORDER BY g.is_default DESC, g.id
        """)
        return groups


class TaskGroupCreate(BaseModel):
    name: str
    template_ids: list   # [1, 2, 3, ...]


@app.post("/api/task-groups", status_code=201)
def create_task_group(body: TaskGroupCreate):
    if not body.name.strip():
        raise HTTPException(400, "任务组名称不能空")
    if not body.template_ids:
        raise HTTPException(400, "任务组至少包含 1 个任务")
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            cur.execute("""
                INSERT INTO task_group (name) VALUES (%s) RETURNING *
            """, (body.name.strip(),))
            grp = cur.fetchone()
            for i, tpl_id in enumerate(body.template_ids):
                cur.execute("""
                    INSERT INTO task_group_member (group_id, template_id, sort_order)
                    VALUES (%s, %s, %s) ON CONFLICT DO NOTHING
                """, (grp["id"], tpl_id, i))
            conn.commit()
            return grp
        except psycopg2.errors.UniqueViolation:
            conn.rollback()
            raise HTTPException(409, f"任务组名称 '{body.name}' 已存在")


@app.delete("/api/task-groups/{group_id}")
def delete_task_group(group_id: int):
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT is_default FROM task_group WHERE id = %s", (group_id,))
        r = cur.fetchone()
        if not r: raise HTTPException(404, "任务组不存在")
        if r[0]: raise HTTPException(400, "默认任务组不能删除")
        cur.execute("DELETE FROM task_group WHERE id = %s", (group_id,))
        conn.commit()
        return {"deleted": True}


class TaskPublishBody(BaseModel):
    product_ids: list           # ["679198301351", ...]
    template_ids: Optional[list] = None   # 单选/多选模板
    group_id: Optional[int] = None        # 或选任务组
    period_label: str           # 必传，发布到哪个周期（如 '4.27-5.3'）
    start_date: Optional[str] = None      # 'YYYY-MM-DD'
    end_date: Optional[str] = None        # 'YYYY-MM-DD'
    overwrite: Optional[bool] = True      # 重复时是否覆盖（默认是）


@app.post("/api/tasks/publish", status_code=201)
def publish_tasks(body: TaskPublishBody):
    """
    批量发布任务到一组商品。
    - 重复（同 product_id + period_label + category + detail）→ 覆盖：更新时间、状态、清空备注
    - 新的 → INSERT
    """
    if not body.product_ids:
        raise HTTPException(400, "请选至少 1 个商品")
    if not body.template_ids and not body.group_id:
        raise HTTPException(400, "请选任务或任务组")
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # 兜底建表
        cur.execute("""
            CREATE TABLE IF NOT EXISTS task_group (
              id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE,
              is_default BOOLEAN DEFAULT FALSE,
              created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS task_group_member (
              group_id INT NOT NULL REFERENCES task_group(id) ON DELETE CASCADE,
              template_id INT NOT NULL REFERENCES task_template(id) ON DELETE CASCADE,
              sort_order INT DEFAULT 0,
              PRIMARY KEY (group_id, template_id)
            );
        """)
        conn.commit()
        # 解析模板 ID
        tpl_ids = list(body.template_ids or [])
        if body.group_id:
            cur.execute("SELECT template_id FROM task_group_member WHERE group_id = %s ORDER BY sort_order", (body.group_id,))
            tpl_ids.extend([r["template_id"] for r in cur.fetchall()])
        tpl_ids = list({tid for tid in tpl_ids if tid})
        if not tpl_ids:
            raise HTTPException(400, "选中的任务/任务组里没有有效模板")
        cur.execute("SELECT id, category, detail, default_owner FROM task_template WHERE id = ANY(%s)", (tpl_ids,))
        templates = cur.fetchall()
        if not templates:
            raise HTTPException(400, "模板不存在")
        # 期间检查 / 自动建期
        prd = row(conn, "SELECT label FROM task_period WHERE label = %s", (body.period_label,))
        if not prd:
            raise HTTPException(400, f"周期 {body.period_label} 不存在，请先建周期")
        created = 0
        overwritten = 0
        for pid in body.product_ids:
            for tpl in templates:
                # 查是否存在重复（同 product+period+category+detail）
                cur.execute("""
                    SELECT id FROM tasks
                    WHERE product_id = %s
                      AND COALESCE(time_range_label,'') = %s
                      AND COALESCE(category,'') = %s
                      AND COALESCE(detail,'')   = %s
                """, (pid, body.period_label, tpl["category"] or '', tpl["detail"] or ''))
                existing = cur.fetchone()
                if existing:
                    if body.overwrite:
                        # 覆盖：时间/状态更新，备注清空
                        cur.execute("""
                            UPDATE tasks
                            SET status = '待开始',
                                start_date = %s::date,
                                eta_date   = %s::date,
                                completed_at = NULL,
                                execution_note = NULL,
                                updated_at = now()
                            WHERE id = %s
                        """, (body.start_date or None, body.end_date or None, existing["id"]))
                        overwritten += 1
                    # 否则跳过
                else:
                    cur.execute("""
                        INSERT INTO tasks
                          (product_id, detail, owner, category, time_range_label,
                           status, priority, template_id, start_date, eta_date)
                        VALUES (%s, %s, %s, %s, %s, '待开始', '中', %s, %s::date, %s::date)
                    """, (pid, tpl["detail"], tpl["default_owner"] or '',
                          tpl["category"], body.period_label, tpl["id"],
                          body.start_date or None, body.end_date or None))
                    created += 1
        conn.commit()
        return {
            "created": created,
            "overwritten": overwritten,
            "products": len(body.product_ids),
            "templates": len(templates),
        }


@app.get("/api/tasks/mine")
def get_my_tasks(owner: str, only_current: bool = True):
    """
    "我的任务"专用接口。only_current=True 只返回当前周期(is_current=TRUE)的任务，
    便于"快速锁定本周重点"。
    """
    with db() as conn:
        if only_current:
            return rows(conn, """
                SELECT t.*, tp.start_date, tp.end_date, tp.is_current
                FROM tasks t
                LEFT JOIN task_period tp ON tp.label = t.time_range_label
                WHERE t.owner = %s
                  AND COALESCE(tp.is_current, FALSE) = TRUE
                ORDER BY t.product_id, t.id
            """, (owner,))
        return rows(conn, """
            SELECT t.*, tp.start_date, tp.end_date, tp.is_current
            FROM tasks t
            LEFT JOIN task_period tp ON tp.label = t.time_range_label
            WHERE t.owner = %s
            ORDER BY tp.start_date DESC NULLS LAST, t.id DESC
        """, (owner,))


# ── 任务模板 / 周期 ─────────────────────────────────────
@app.get("/api/task-templates")
def list_task_templates():
    with db() as conn:
        try:
            return rows(conn, """
                SELECT id, category, detail, default_owner, sort_order, is_active
                FROM task_template WHERE is_active = TRUE
                ORDER BY sort_order, id
            """)
        except Exception:
            return []


class TaskTemplateUpdate(BaseModel):
    default_owner: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None
    propagate_to_future: bool = True


@app.patch("/api/task-templates/{tpl_id}")
def update_task_template(tpl_id: int, body: TaskTemplateUpdate):
    """
    改模板（如换 default_owner）。
    propagate_to_future=True 时，会把当前及未来周期里属于该模板的任务也改 owner。
    历史任务保持不变（避免污染复盘记录）。
    """
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        fields = {k: v for k, v in body.model_dump().items()
                  if v is not None and k != 'propagate_to_future'}
        if not fields:
            raise HTTPException(400, "no fields to update")
        set_clause = ", ".join(f"{k} = %s" for k in fields)
        cur.execute(
            f"UPDATE task_template SET {set_clause}, updated_at=now() WHERE id = %s RETURNING *",
            (*fields.values(), tpl_id)
        )
        tpl = dict(cur.fetchone())
        # 把当前/未来周期的任务 owner 同步过去
        if body.propagate_to_future and body.default_owner:
            cur.execute("""
                UPDATE tasks SET owner = %s, updated_at = now()
                WHERE template_id = %s
                  AND time_range_label IN (
                    SELECT label FROM task_period
                    WHERE end_date >= CURRENT_DATE
                  )
            """, (body.default_owner, tpl_id))
        conn.commit()
        return tpl


@app.get("/api/task-periods")
def list_task_periods(include_empty: bool = Query(default=False,
        description="是否包含没有任务的周期；默认 False，前端隐藏没任务的旧周期")):
    """
    返回任务周期列表，附带任务条数 task_count（默认隐藏 task_count=0 的周期）。
    """
    with db() as conn:
        try:
            sql = """
                SELECT tp.id, tp.label,
                       tp.start_date::text AS start_date,
                       tp.end_date::text AS end_date,
                       tp.is_current,
                       COALESCE(c.cnt, 0) AS task_count
                FROM task_period tp
                LEFT JOIN (
                    SELECT time_range_label AS label, COUNT(*) AS cnt
                    FROM tasks WHERE time_range_label IS NOT NULL AND time_range_label <> ''
                    GROUP BY time_range_label
                ) c ON c.label = tp.label
                ORDER BY tp.start_date DESC
            """
            data = rows(conn, sql)
            if not include_empty:
                # 当前周（is_current）即使 0 任务也保留，免得新建空周看不到
                data = [r for r in data if (r.get("task_count") or 0) > 0 or r.get("is_current")]
            return data
        except Exception:
            return []


class TaskPeriodCreate(BaseModel):
    start_date: str
    end_date: str
    set_current: bool = False


@app.post("/api/task-periods", status_code=201)
def create_task_period(body: TaskPeriodCreate):
    label = f"{body.start_date}~{body.end_date}"
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if body.set_current:
            cur.execute("UPDATE task_period SET is_current = FALSE")
        cur.execute("""
            INSERT INTO task_period (label, start_date, end_date, is_current)
            VALUES (%s, %s::date, %s::date, %s)
            ON CONFLICT (label) DO UPDATE SET is_current = EXCLUDED.is_current
            RETURNING id, label, start_date::text AS start_date,
                      end_date::text AS end_date, is_current
        """, (label, body.start_date, body.end_date, body.set_current))
        out = dict(cur.fetchone())
        conn.commit()
        return out


class TaskPeriodUpdate(BaseModel):
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    set_current: Optional[bool] = None


@app.patch("/api/task-periods/{period_id}")
def update_task_period(period_id: int, body: TaskPeriodUpdate):
    """改周期日期。如果起止日期变了，label 也跟着改成新格式 'YYYY-MM-DD~YYYY-MM-DD'，
    并把 tasks 表里所有引用旧 label 的也一起改名（保持任务关联）。"""
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        existing = row(conn, "SELECT * FROM task_period WHERE id = %s", (period_id,))
        if not existing:
            raise HTTPException(404, "周期不存在")
        new_start = body.start_date or str(existing["start_date"])
        new_end   = body.end_date   or str(existing["end_date"])
        new_label = f"{new_start}~{new_end}"
        old_label = existing["label"]

        if body.set_current is True:
            cur.execute("UPDATE task_period SET is_current = FALSE")

        cur.execute("""
            UPDATE task_period
            SET label = %s, start_date = %s::date, end_date = %s::date,
                is_current = COALESCE(%s, is_current)
            WHERE id = %s
            RETURNING id, label, start_date::text AS start_date,
                      end_date::text AS end_date, is_current
        """, (new_label, new_start, new_end, body.set_current, period_id))
        out = dict(cur.fetchone())

        # 改名后同步 tasks 表里的 time_range_label
        if old_label != new_label:
            cur.execute("UPDATE tasks SET time_range_label = %s WHERE time_range_label = %s",
                        (new_label, old_label))
        conn.commit()
        return out


@app.delete("/api/task-periods/{period_id}")
def delete_task_period(period_id: int):
    """删周期。同时删除该周期下所有任务（避免孤立任务）。"""
    with db() as conn:
        cur = conn.cursor()
        existing = row(conn, "SELECT label FROM task_period WHERE id = %s", (period_id,))
        if not existing:
            raise HTTPException(404, "周期不存在")
        cur.execute("DELETE FROM tasks WHERE time_range_label = %s", (existing["label"],))
        deleted_tasks = cur.rowcount
        cur.execute("DELETE FROM task_period WHERE id = %s", (period_id,))
        conn.commit()
        return {"ok": True, "deleted_tasks": deleted_tasks, "deleted_label": existing["label"]}


# ── 任务批量操作（一键生成本周 / 一键克隆上周） ──
class TasksBulkInstantiate(BaseModel):
    period_label: str
    product_ids: list  # ['679198301351', ...]
    template_ids: Optional[list] = None  # None 时全部模板


@app.post("/api/tasks/bulk-instantiate", status_code=201)
def bulk_instantiate_tasks(body: TasksBulkInstantiate):
    """
    一键给指定周期 × 商品列表 生成全部模板任务。
    重复任务（同 product+period+detail+owner）会被 ON CONFLICT 跳过。
    """
    if not body.product_ids:
        raise HTTPException(400, "至少选 1 个商品")
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        tpl_filter = ""
        params = [body.period_label]
        if body.template_ids:
            tpl_filter = "AND id = ANY(%s)"
            params.append(body.template_ids)
        # 验证周期存在
        prd = row(conn, "SELECT label FROM task_period WHERE label = %s", (body.period_label,))
        if not prd:
            raise HTTPException(400, f"周期 {body.period_label} 不存在，请先创建")
        cur.execute(f"""
            WITH product_list(product_id) AS (
                SELECT unnest(%s::text[])
            )
            INSERT INTO tasks (product_id, detail, owner, category, time_range_label, status, priority, template_id)
            SELECT p.product_id, t.detail, t.default_owner, t.category, %s, '待开始', '中', t.id
            FROM product_list p CROSS JOIN task_template t
            WHERE t.is_active = TRUE {tpl_filter}
            ON CONFLICT ON CONSTRAINT tasks_unique_dim DO NOTHING
            RETURNING id
        """, (body.product_ids, body.period_label, *([body.template_ids] if body.template_ids else [])))
        created = cur.rowcount
        conn.commit()
        return {"created": created, "period_label": body.period_label,
                "product_count": len(body.product_ids)}


@app.post("/api/tasks", status_code=201)
def create_task(task: TaskCreate, _user=Depends(require_permission('task.create'))):
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE")
        cur.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS eta_date DATE")
        conn.commit()
        cur.execute("""
            INSERT INTO tasks (product_id, detail, owner, status, priority, category,
                               time_range_label, execution_note, start_date, eta_date, template_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::date, %s::date, %s) RETURNING id
        """, (task.product_id, task.detail, task.owner, task.status,
              task.priority, task.category, task.time_range_label, task.execution_note,
              task.start_date or None, task.eta_date or None, task.template_id))
        new_id = cur.fetchone()["id"]
        conn.commit()
        return row(conn, "SELECT * FROM tasks WHERE id = %s", (new_id,))


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: int, task: TaskUpdate, user: Optional[dict] = Depends(get_current_user)):
    """
    任务编辑：admin/edit_all 通过；edit_own 仅当 task.owner 命中当前用户。
    """
    fields = {k: v for k, v in task.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "no fields to update")
    if not user:
        raise HTTPException(401, "未登录")
    perms = user.get("permissions") or []
    if isinstance(perms, dict): perms = []
    is_admin = user.get("role") == "admin" or "*" in perms or "task.edit_all" in perms
    if not is_admin:
        # 必须有 edit_own 权限 + 任务归属当前用户
        if "task.edit_own" not in perms:
            raise HTTPException(403, "无 task.edit_own 权限")
        with db() as conn:
            t = row(conn, "SELECT owner FROM tasks WHERE id = %s", (task_id,))
            if not t:
                raise HTTPException(404, "任务不存在")
            owner = t.get("owner") or ""
            display = user.get("display_name") or ""
            # 用 isTaskOwner 同样的逻辑：精确或前缀包含
            name_prefix = display.split("（")[0].split("(")[0].strip()
            if owner != display and not (len(name_prefix) >= 2 and name_prefix in owner):
                raise HTTPException(403, "只能编辑自己的任务")
    # 状态切到 / 离开「已完成」时，同步 completed_at
    # （已完成的别名：'done' / '已完成' / '完成'）
    # 但是：如果用户在同一次 PATCH 里直接传了 completed_at（管理员补录），就尊重用户的值，
    # 不再覆盖。
    DONE_ALIASES = {'done', '已完成', '完成'}
    extra_clauses = []
    extra_values = []
    if 'status' in fields and 'completed_at' not in fields:
        if fields['status'] in DONE_ALIASES:
            extra_clauses.append("completed_at = COALESCE(completed_at, now())")
        else:
            extra_clauses.append("completed_at = NULL")

    # 确保 start_date / eta_date / completed_at / note_images 列存在（首次运行自动建表）
    with db() as conn:
        cur = conn.cursor()
        cur.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE")
        cur.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS eta_date DATE")
        cur.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ")
        cur.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS note_images JSONB DEFAULT '[]'::jsonb")
        conn.commit()
    # note_images 数组传入 → 序列化 JSON
    if 'note_images' in fields:
        v = fields['note_images']
        if v is None or v == '':
            fields['note_images'] = '[]'
        else:
            import json as _json
            fields['note_images'] = _json.dumps(v if isinstance(v, list) else [v])

    # start_date / eta_date 空字符串 → SQL NULL
    if 'start_date' in fields and (fields['start_date'] == '' or fields['start_date'] is None):
        fields['start_date'] = None
    if 'eta_date' in fields and (fields['eta_date'] == '' or fields['eta_date'] is None):
        fields['eta_date'] = None
    # completed_at 空字符串 → SQL NULL；'YYYY-MM-DD' → 加 12:00 时区中性时间
    if 'completed_at' in fields:
        v = fields['completed_at']
        if v == '' or v is None:
            fields['completed_at'] = None
        elif isinstance(v, str) and len(v) == 10:  # YYYY-MM-DD
            fields['completed_at'] = v + ' 12:00:00'

    set_parts = [f"{k} = %s" for k in fields] + extra_clauses
    set_clause = ", ".join(set_parts)
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE tasks SET {set_clause}, updated_at = now() WHERE id = %s",
            (*fields.values(), *extra_values, task_id)
        )
        conn.commit()
        return row(conn, "SELECT * FROM tasks WHERE id = %s", (task_id,))


class TasksBulkUpdate(BaseModel):
    task_ids: list  # [int, ...]
    status: Optional[str] = None
    owner: Optional[str] = None
    priority: Optional[str] = None


@app.patch("/api/tasks/bulk-update")
def bulk_update_tasks(body: TasksBulkUpdate,
                      user: Optional[dict] = Depends(get_current_user)):
    """
    批量改任务（status / owner / priority）。
    需要 task.edit_all 权限（防止 edit_own 用户误改别人的）。
    """
    if not user:
        raise HTTPException(401, "未登录")
    perms = user.get("permissions") or []
    if isinstance(perms, dict): perms = []
    is_admin = user.get("role") == "admin" or "*" in perms or "task.edit_all" in perms
    if not is_admin:
        raise HTTPException(403, "批量操作需要 task.edit_all 权限")
    if not body.task_ids:
        raise HTTPException(400, "task_ids 不能为空")
    fields = {k: v for k, v in body.model_dump().items()
              if v is not None and k != "task_ids"}
    if not fields:
        raise HTTPException(400, "没有要更新的字段")
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE tasks SET {set_clause}, updated_at = now() "
            f"WHERE id = ANY(%s)",
            (*fields.values(), body.task_ids)
        )
        affected = cur.rowcount
        conn.commit()
        return {"updated": affected, "task_ids": body.task_ids}


class TasksBulkDelete(BaseModel):
    task_ids: list


@app.post("/api/tasks/bulk-delete")
def bulk_delete_tasks(body: TasksBulkDelete,
                      _user=Depends(require_permission('task.delete'))):
    if not body.task_ids:
        raise HTTPException(400, "task_ids 不能为空")
    with db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM tasks WHERE id = ANY(%s)", (body.task_ids,))
        affected = cur.rowcount
        conn.commit()
        return {"deleted": affected}


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int, _user=Depends(require_permission('task.delete'))):
    with db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM tasks WHERE id = %s", (task_id,))
        conn.commit()
        return {"ok": True}


# ══════════════════════════════════════════════════
# 会议要点
# ══════════════════════════════════════════════════

class NoteCreate(BaseModel):
    week_label: str
    meeting_date: str
    title: str
    content: str
    important_level: str = "normal"
    created_by_name: str = ""


@app.get("/api/meeting-notes")
def get_meeting_notes():
    with db() as conn:
        return rows(conn, "SELECT * FROM meeting_notes ORDER BY meeting_date DESC")


@app.post("/api/meeting-notes", status_code=201)
def create_meeting_note(note: NoteCreate, _user=Depends(require_permission('meeting.create'))):
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            INSERT INTO meeting_notes (week_label, meeting_date, title, content, important_level, created_by_name)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        """, (note.week_label, note.meeting_date, note.title, note.content,
              note.important_level, note.created_by_name))
        new_id = cur.fetchone()["id"]
        conn.commit()
        return row(conn, "SELECT * FROM meeting_notes WHERE id = %s", (new_id,))


class NoteUpdate(BaseModel):
    week_label: Optional[str] = None
    meeting_date: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    important_level: Optional[str] = None


@app.put("/api/meeting-notes/{note_id}")
def update_meeting_note(note_id: int, note: NoteUpdate):
    fields = {k: v for k, v in note.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "no fields to update")
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE meeting_notes SET {set_clause} WHERE id = %s",
            (*fields.values(), note_id)
        )
        conn.commit()
        return row(conn, "SELECT * FROM meeting_notes WHERE id = %s", (note_id,))


@app.delete("/api/meeting-notes/{note_id}")
def delete_meeting_note(note_id: int, _user=Depends(require_permission('meeting.delete'))):
    with db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM meeting_notes WHERE id = %s", (note_id,))
        conn.commit()
        return {"ok": True}


# ══════════════════════════════════════════════════
# 用户认证
# ══════════════════════════════════════════════════

# ══════════════════════════════════════════════════
# 指标注册表 & 用户偏好
# ══════════════════════════════════════════════════

# 所有可选指标的元数据
# group: 分组；key: 唯一标识；label: 显示名；source: 数据来源；views: 适用视图
METRIC_REGISTRY = [
    # ── 运营类（生意参谋）
    {"group": "运营",  "key": "pay_amount",        "label": "销售额",          "unit": "元",  "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "net_pay",            "label": "净销售额",        "unit": "元",  "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "visitors",           "label": "进店UV",          "unit": "人",  "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "page_views",         "label": "页面PV",          "unit": "次",  "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "avg_pv_per_uv",      "label": "人均浏览深度",    "unit": "页",  "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "cart_rate",          "label": "加购率",          "unit": "%",   "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "cart_users",         "label": "加购人数",        "unit": "人",  "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "order_cvr",          "label": "下单转化率",      "unit": "%",   "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "collect_users",      "label": "收藏人数",        "unit": "人",  "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "collect_rate",       "label": "收藏率",          "unit": "%",   "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "avg_stay_duration",  "label": "平均停留时长",    "unit": "秒",  "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "avg_bounce_rate",    "label": "跳出率",          "unit": "%",   "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "pay_new_buyers",     "label": "新客数",          "unit": "人",  "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "new_buyer_pct",      "label": "新客占比",        "unit": "%",   "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "visitor_avg_value",  "label": "访客平均价值",    "unit": "元",  "source": "syzt", "views": ["product"]},
    {"group": "运营",  "key": "search_visitors",    "label": "搜索引导UV",      "unit": "人",  "source": "syzt", "views": ["product", "compare"]},
    {"group": "运营",  "key": "search_traffic_pct", "label": "搜索流量占比",    "unit": "%",   "source": "syzt", "views": ["product"]},
    {"group": "运营",  "key": "refund_amount",      "label": "退款金额",        "unit": "元",  "source": "syzt", "views": ["product"]},
    # ── 投放类（万象台）
    {"group": "投放",  "key": "spend",              "label": "投放花费",        "unit": "元",  "source": "wxst", "views": ["product", "compare"]},
    {"group": "投放",  "key": "impressions",        "label": "展现量",          "unit": "次",  "source": "wxst", "views": ["product", "compare"]},
    {"group": "投放",  "key": "clicks",             "label": "点击量",          "unit": "次",  "source": "wxst", "views": ["product", "compare"]},
    {"group": "投放",  "key": "ctr",                "label": "CTR点击率",       "unit": "%",   "source": "wxst", "views": ["product", "compare"]},
    {"group": "投放",  "key": "cpc",                "label": "CPC平均点击成本", "unit": "元",  "source": "wxst", "views": ["product", "compare"]},
    {"group": "投放",  "key": "total_gmv",          "label": "投放GMV",         "unit": "元",  "source": "wxst", "views": ["product", "compare"]},
    {"group": "投放",  "key": "direct_gmv",         "label": "直接成交GMV",     "unit": "元",  "source": "wxst", "views": ["product"]},
    {"group": "投放",  "key": "indirect_gmv",       "label": "间接成交GMV",     "unit": "元",  "source": "wxst", "views": ["product"]},
    {"group": "投放",  "key": "roi",                "label": "ROI投产比",       "unit": "",    "source": "wxst", "views": ["product", "compare"]},
    {"group": "投放",  "key": "cpna",               "label": "CPNA新客成本",    "unit": "元",  "source": "wxst", "views": ["product", "compare"]},
    {"group": "投放",  "key": "natural_gmv",        "label": "自然流量GMV",     "unit": "元",  "source": "wxst", "views": ["product"]},
    # ── 深度指标（计算逻辑.xlsx）
    {"group": "深度",  "key": "browse_decay_rate",     "label": "浏览衰减率",          "unit": "%",  "source": "calc", "views": ["product"]},
    {"group": "深度",  "key": "stay_pay_efficiency",   "label": "停留-转化效率",       "unit": "",   "source": "calc", "views": ["product"]},
    {"group": "深度",  "key": "bounce_collect_hedge",  "label": "跳出-收藏对冲值",     "unit": "",   "source": "calc", "views": ["product"]},
    {"group": "深度",  "key": "search_depth_index",    "label": "搜索引导深度",        "unit": "",   "source": "calc", "views": ["product"]},
    {"group": "深度",  "key": "natural_feedback_coef", "label": "自然流量反哺系数",    "unit": "",   "source": "calc", "views": ["product"]},
    {"group": "深度",  "key": "click_cart_ratio",      "label": "点击-加购效率比",     "unit": "",   "source": "calc", "views": ["product", "compare"]},
    {"group": "深度",  "key": "heat_index",            "label": "商品热度指数",        "unit": "",   "source": "calc", "views": ["product", "compare"]},
    {"group": "深度",  "key": "price_sensitivity",     "label": "价格敏感系数",        "unit": "",   "source": "calc", "views": ["product"]},
]

# 各视图的默认偏好字段（新用户或未设置时使用）
DEFAULT_PREFERENCES = {
    "product_view_metrics": [
        "pay_amount", "visitors", "cart_rate", "order_cvr",
        "avg_stay_duration", "avg_bounce_rate", "new_buyer_pct"
    ],
    "compare_view_metrics": [
        "pay_amount", "visitors", "cart_rate", "ctr", "roi"
    ],
    "product_view_layout": "grid",   # grid | list
    "compare_chart_type": "line",    # line | bar
}


@app.get("/api/metrics/registry")
def get_metric_registry(view: Optional[str] = None):
    """
    返回所有可选指标的元数据。
    view 参数可过滤：product | compare
    """
    if view:
        return [m for m in METRIC_REGISTRY if view in m["views"]]
    return METRIC_REGISTRY


@app.get("/api/users/{user_id}/preferences")
def get_user_preferences(user_id: int):
    """获取用户偏好（字段选择 + 布局）"""
    with db() as conn:
        r = row(conn,
            "SELECT preferences FROM users WHERE id = %s", (user_id,))
        if not r:
            raise HTTPException(404, "用户不存在")
        prefs = r["preferences"] or {}
        # 合并默认值，保证缺失键有默认
        merged = {**DEFAULT_PREFERENCES, **prefs}
        return merged


class PreferencesUpdate(BaseModel):
    product_view_metrics: Optional[list] = None
    compare_view_metrics: Optional[list] = None
    product_view_layout:  Optional[str]  = None
    compare_chart_type:   Optional[str]  = None


@app.patch("/api/users/{user_id}/preferences")
def update_user_preferences(user_id: int, body: PreferencesUpdate):
    """
    局部更新用户偏好，只传需要修改的字段。
    前端保存"偏好设置"时调用。
    """
    import json
    with db() as conn:
        r = row(conn, "SELECT preferences FROM users WHERE id = %s", (user_id,))
        if not r:
            raise HTTPException(404, "用户不存在")
        current = r["preferences"] or {}
        updates = body.model_dump(exclude_none=True)
        # 校验 metric key 是否合法
        valid_keys = {m["key"] for m in METRIC_REGISTRY}
        for field in ["product_view_metrics", "compare_view_metrics"]:
            if field in updates:
                invalid = [k for k in updates[field] if k not in valid_keys]
                if invalid:
                    raise HTTPException(400, f"无效的指标 key: {invalid}")
        merged = {**current, **updates}
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET preferences = %s WHERE id = %s",
            (json.dumps(merged), user_id)
        )
        conn.commit()
        return {**DEFAULT_PREFERENCES, **merged}


@app.post("/api/users/{user_id}/preferences/reset")
def reset_user_preferences(user_id: int):
    """重置为默认偏好"""
    import json
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET preferences = %s WHERE id = %s",
            (json.dumps({}), user_id)
        )
        conn.commit()
        return DEFAULT_PREFERENCES


class UserRegister(BaseModel):
    username: str
    password: str
    display_name: str = ""
    role: str = "viewer"


class UserVerify(BaseModel):
    username: str
    password: str


@app.post("/api/users/register", status_code=201)
def register_user(body: UserRegister):
    pw_hash = hashlib.sha256(body.password.encode()).hexdigest()
    with db() as conn:
        existing = row(conn, "SELECT id FROM users WHERE username = %s", (body.username,))
        if existing:
            raise HTTPException(400, "用户名已存在")
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            INSERT INTO users (username, password_hash, display_name, role)
            VALUES (%s, %s, %s, %s) RETURNING id, username, display_name, role
        """, (body.username, pw_hash, body.display_name or body.username, body.role))
        user = dict(cur.fetchone())
        conn.commit()
        return user


@app.post("/api/users/verify")
def verify_user(body: UserVerify):
    pw_hash = hashlib.sha256(body.password.encode()).hexdigest()
    with db() as conn:
        user = row(conn, """
            SELECT id, username, display_name, role, permissions
            FROM users WHERE username = %s AND password_hash = %s
        """, (body.username, pw_hash))
        if not user:
            raise HTTPException(401, "用户名或密码错误")
        return user


@app.get("/api/users")
def get_users():
    with db() as conn:
        return rows(conn, "SELECT id, username, display_name, role, permissions, created_at FROM users ORDER BY created_at")


class UserPermissionsUpdate(BaseModel):
    # 前端传 list（如 ["task.view_all","task.edit_own"]），存为 jsonb array
    # 之前误标 dict，前端 PATCH 一直 422 导致权限保存到 DB 失败
    permissions: list


@app.patch("/api/users/{user_id}/permissions")
def update_user_permissions(user_id: int, body: UserPermissionsUpdate,
                             _user=Depends(require_permission('permission.assign'))):
    import json
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET permissions = %s WHERE id = %s",
            (json.dumps(body.permissions), user_id)
        )
        conn.commit()
        return row(conn, "SELECT id, username, display_name, role, permissions FROM users WHERE id = %s", (user_id,))


class UserRoleUpdate(BaseModel):
    role: Optional[str] = None
    display_name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None  # 新密码（明文）；None 表示不改


@app.patch("/api/users/{user_id}")
def update_user(user_id: int, body: UserRoleUpdate):
    fields = {}
    if body.role is not None: fields['role'] = body.role
    if body.display_name is not None: fields['display_name'] = body.display_name
    if body.username is not None: fields['username'] = body.username
    if body.password is not None and body.password.strip():
        fields['password_hash'] = hashlib.sha256(body.password.encode()).hexdigest()
    if not fields:
        raise HTTPException(400, "no fields to update")
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE users SET {set_clause} WHERE id = %s",
            (*fields.values(), user_id)
        )
        conn.commit()
        return row(conn, "SELECT id, username, display_name, role, permissions FROM users WHERE id = %s", (user_id,))


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int,
                _user=Depends(require_permission('user.delete'))):
    """删除用户。需要 user.delete 权限或 admin。"""
    with db() as conn:
        cur = conn.cursor()
        # 先看看这个用户有没有评论 / 任务，避免数据残留 NULL 引用
        cur.execute("SELECT username FROM users WHERE id = %s", (user_id,))
        u = cur.fetchone()
        if not u:
            raise HTTPException(404, "user not found")
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
        conn.commit()
        return {"ok": True, "deleted_username": u[0]}


# ══════════════════════════════════════════════════
# 页面访问统计
# ══════════════════════════════════════════════════

class PageViewCreate(BaseModel):
    page_path: str
    username: str = ""


class PageViewDurationUpdate(BaseModel):
    duration_seconds: int


@app.post("/api/page-views", status_code=201)
def record_page_view(body: PageViewCreate):
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            INSERT INTO page_views (page_path, username)
            VALUES (%s, %s) RETURNING id
        """, (body.page_path, body.username))
        new_id = cur.fetchone()["id"]
        conn.commit()
        return {"id": new_id}


@app.patch("/api/page-views/{record_id}")
def update_page_view_duration(record_id: int, body: PageViewDurationUpdate):
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE page_views SET duration_seconds = %s WHERE id = %s",
            (body.duration_seconds, record_id)
        )
        conn.commit()
        return {"ok": True}


@app.get("/api/page-views/count")
def get_page_view_count(page_path: str):
    with db() as conn:
        result = row(conn, """
            SELECT COUNT(*) AS count FROM page_views
            WHERE page_path = %s AND opened_at::date = CURRENT_DATE
        """, (page_path,))
        return {"count": int(result["count"]) if result else 0}


# ══════════════════════════════════════════════════
# 深度指标：单品 / 多品对比
# ══════════════════════════════════════════════════

@app.get("/api/metrics/product")
def get_product_metrics(
    spu_id: str,
    start: str = Query(default=None),
    end: str = Query(default=None),
):
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        base = row(conn, """
            SELECT
                p.spu_id,
                MAX(p.title)              AS product_title,
                MAX(p.category_l1)        AS category_l1,
                MAX(p.category_l2)        AS category_l2,
                MAX(p.inventory)          AS inventory,
                COUNT(DISTINCT s.stat_date) AS days,
                SUM(s.visitors)           AS total_visitors,
                SUM(s.page_views)         AS total_pv,
                SUM(s.pay_amount)         AS total_pay,
                SUM(s.refund_amount)      AS total_refund,
                SUM(s.order_amount)       AS total_order,
                SUM(s.cart_users)         AS total_cart_users,
                SUM(s.cart_qty)           AS total_cart_qty,
                SUM(s.collect_users)      AS total_collect,
                SUM(s.order_buyers)       AS total_order_buyers,
                SUM(s.order_qty)          AS total_order_qty,
                SUM(s.pay_new_buyers)     AS total_new_buyers,
                SUM(s.pay_old_buyers)     AS total_old_buyers,
                SUM(s.search_visitors)    AS total_search_visitors,
                -- 按 UV 加权（避免低 UV 天 skew）
                SUM(s.avg_stay_duration * s.visitors)::numeric / NULLIF(SUM(s.visitors),0)  AS avg_stay_duration,
                SUM(s.bounce_rate * s.visitors)::numeric        / NULLIF(SUM(s.visitors),0) AS avg_bounce_rate,
                -- 累计指标：MAX 仅在单 SKU 时正确；多 SKU 合并 SPU 时可能略偏，
                -- 准确做法是各 SKU 取最新日累积值再 SUM，这里先保留 MAX，等下个迭代修
                MAX(s.year_cum_pay)       AS year_cum_pay,
                MAX(s.month_cum_pay)      AS month_cum_pay
            FROM fact_syzt_product s
            JOIN dim_product p ON s.product_id = p.product_id
            WHERE p.spu_id = %s AND s.stat_date BETWEEN %s AND %s
            GROUP BY p.spu_id
        """, (spu_id, s, e))
        if not base:
            raise HTTPException(404, f"SPU {spu_id} 无数据")

        ads = row(conn, """
            SELECT
                SUM(w.spend)               AS total_spend,
                SUM(w.total_gmv)           AS total_gmv,
                SUM(w.direct_gmv)          AS total_direct_gmv,
                SUM(w.indirect_gmv)        AS total_indirect_gmv,
                SUM(w.impressions)         AS total_impressions,
                SUM(w.clicks)              AS total_clicks,
                SUM(w.cart_cnt)            AS total_cart_cnt,
                SUM(w.new_buyers)          AS ad_new_buyers,
                SUM(w.natural_gmv)         AS total_natural_gmv,
                SUM(w.natural_impressions) AS total_natural_impressions,
                SUM(w.guided_visits)       AS total_guided_visits,
                SUM(w.transaction_buyers)  AS ad_transaction_buyers
            FROM fact_wxst_product w
            JOIN dim_product p ON w.product_id = p.product_id
            WHERE p.spu_id = %s AND w.stat_date BETWEEN %s AND %s
        """, (spu_id, s, e)) or {}

        uv      = base["total_visitors"] or 0
        pv      = base["total_pv"] or 0
        pay     = base["total_pay"] or 0
        cart    = base["total_cart_users"] or 0
        collect = base["total_collect"] or 0
        bounce  = base["avg_bounce_rate"] or 0
        stay    = base["avg_stay_duration"] or 0
        order_b = base["total_order_buyers"] or 0
        new_b   = base["total_new_buyers"] or 0
        old_b   = base["total_old_buyers"] or 0
        s_uv    = base["total_search_visitors"] or 0
        spend   = float(ads.get("total_spend") or 0)
        impressions = float(ads.get("total_impressions") or 0)
        clicks  = float(ads.get("total_clicks") or 0)
        nat_imp = float(ads.get("total_natural_impressions") or 0)
        ad_new  = float(ads.get("ad_new_buyers") or 0)
        ctr     = clicks / impressions if impressions else None
        cpc     = spend / clicks if clicks else None
        roi     = float(ads.get("total_gmv") or 0) / spend if spend else None
        cpna    = spend / ad_new if ad_new else None
        pv_per_uv    = pv / uv if uv else None
        cart_rate    = cart / uv if uv else None
        collect_rate = collect / uv if uv else None
        order_cvr    = order_b / uv if uv else None
        pay_cvr      = (new_b + old_b) / uv if uv else None
        net_pay      = pay - (base["total_refund"] or 0)
        visitor_value  = pay / uv if uv else None
        avg_order_val  = pay / (new_b + old_b) if (new_b + old_b) else None
        new_buyer_pct  = new_b / (new_b + old_b) if (new_b + old_b) else None
        search_pct     = s_uv / uv if uv else None
        ad_cart = float(ads.get("total_cart_cnt") or 0)
        cart_rate_ad = ad_cart / clicks if clicks else None

        # Sheet2 流量质量
        browse_decay        = (pv_per_uv - 1) / pv_per_uv if pv_per_uv and pv_per_uv > 1 else None
        stay_pay_efficiency = pay / stay * 100 if stay else None
        bounce_collect_hedge = collect / bounce if bounce else None
        search_depth        = s_uv * pv_per_uv if pv_per_uv else None

        # Sheet3 推广效率
        natural_feedback  = nat_imp / spend if spend else None
        click_cart_ratio  = cart_rate_ad / ctr if (cart_rate_ad and ctr) else None

        # Sheet4 商品健康度
        heat_index = uv * (cart_rate or 0) * (pay_cvr or 0) * 1e6
        try:
            price_sensitivity = (
                (1 - (pay_cvr or 0) / order_cvr) / (1 - (cart_rate or 0) / (pay_cvr or 1))
                if order_cvr and pay_cvr and cart_rate else None
            )
        except ZeroDivisionError:
            price_sensitivity = None

        # Sheet5 预警
        inv = base.get("inventory") or 0
        cart_qty = base["total_cart_qty"] or 0
        avg_cart_pp = cart_qty / cart if cart else 1
        cart_inv_warn = bool((cart * avg_cart_pp) > (inv * 0.8)) if inv else None

        def r4(v): return round(float(v), 4) if v is not None else None

        return {
            "spu_id": spu_id,
            "product_title": base["product_title"],
            "category_l1": base["category_l1"],
            "category_l2": base["category_l2"],
            "inventory": inv,
            "days": base["days"],
            "date_range": {"start": s, "end": e},
            "traffic": {
                "total_visitors": uv, "total_pv": pv,
                "avg_pv_per_uv": r4(pv_per_uv),
                "search_visitors": s_uv, "search_traffic_pct": r4(search_pct),
                "avg_stay_duration": r4(stay), "avg_bounce_rate": r4(bounce),
            },
            "conversion": {
                "total_pay": r4(pay), "net_pay": r4(net_pay),
                "total_order": r4(base["total_order"]),
                "total_refund": r4(base["total_refund"]),
                "total_cart_users": cart, "total_cart_qty": base["total_cart_qty"],
                "total_collect": collect, "total_order_buyers": order_b,
                "total_order_qty": base["total_order_qty"],
                "cart_rate": r4(cart_rate), "collect_rate": r4(collect_rate),
                "order_cvr": r4(order_cvr), "pay_cvr": r4(pay_cvr),
                "visitor_value": r4(visitor_value), "avg_order_value": r4(avg_order_val),
                "new_buyer_cnt": new_b, "old_buyer_cnt": old_b,
                "new_buyer_pct": r4(new_buyer_pct),
                "year_cum_pay": base["year_cum_pay"], "month_cum_pay": base["month_cum_pay"],
            },
            "ads": {
                "total_spend": r4(spend),
                "total_gmv": r4(float(ads.get("total_gmv") or 0)),
                "direct_gmv": r4(float(ads.get("total_direct_gmv") or 0)),
                "indirect_gmv": r4(float(ads.get("total_indirect_gmv") or 0)),
                "natural_gmv": r4(float(ads.get("total_natural_gmv") or 0)),
                "roi": r4(roi), "ctr": r4(ctr), "cpc": r4(cpc), "cpna": r4(cpna),
                "total_impressions": impressions, "total_clicks": clicks,
                "ad_new_buyers": ad_new,
                "natural_impressions": nat_imp,
                "guided_visits": ads.get("total_guided_visits"),
            },
            "deep_metrics": {
                "browse_decay_rate": r4(browse_decay),
                "stay_pay_efficiency": r4(stay_pay_efficiency),
                "bounce_collect_hedge": r4(bounce_collect_hedge),
                "search_depth_index": r4(search_depth),
                "natural_feedback_coef": r4(natural_feedback),
                "click_cart_ratio": r4(click_cart_ratio),
                "heat_index": r4(heat_index),
                "price_sensitivity": r4(price_sensitivity),
            },
            "alerts": {
                "cart_inventory_warning": cart_inv_warn,
                "inventory_note": "库存来自优化商品ID清单.xlsx，如需精确预警请对接ERP" if inv else "暂无库存数据",
            },
        }


@app.get("/api/metrics/compare")
def compare_products(
    spu_ids: str,
    start: str = Query(default=None),
    end: str = Query(default=None),
):
    """多品对比，spu_ids 逗号分隔"""
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    id_list = [x.strip() for x in spu_ids.split(',') if x.strip()]
    with db() as conn:
        ph = ','.join(['%s'] * len(id_list))
        return rows(conn, f"""
            SELECT
                p.spu_id,
                MAX(p.title)         AS product_title,
                MAX(p.category_l1)   AS category_l1,
                SUM(s.visitors)      AS total_visitors,
                SUM(s.page_views)    AS total_pv,
                ROUND(SUM(s.page_views)/NULLIF(SUM(s.visitors),0),2)          AS pv_per_uv,
                SUM(s.pay_amount)    AS total_pay,
                ROUND(SUM(s.pay_amount)-SUM(s.refund_amount),2)               AS net_pay,
                ROUND(SUM(s.cart_users)/NULLIF(SUM(s.visitors),0)*100,4)      AS cart_rate,
                ROUND(SUM(s.order_buyers)/NULLIF(SUM(s.visitors),0)*100,4)    AS order_cvr,
                ROUND(SUM(s.pay_amount)/NULLIF(SUM(s.visitors),0),2)          AS visitor_value,
                ROUND(SUM(s.pay_new_buyers)/NULLIF(SUM(s.pay_new_buyers)+SUM(s.pay_old_buyers),0)*100,2) AS new_buyer_pct,
                -- 按 UV 加权
                SUM(s.avg_stay_duration * s.visitors)::numeric / NULLIF(SUM(s.visitors),0) AS avg_stay,
                SUM(s.bounce_rate * s.visitors)::numeric        / NULLIF(SUM(s.visitors),0) * 100 AS bounce_rate,
                SUM(s.search_visitors)    AS search_visitors,
                ROUND(SUM(s.search_visitors)/NULLIF(SUM(s.visitors),0)*100,2) AS search_pct,
                SUM(w.spend)              AS total_spend,
                SUM(w.total_gmv)          AS ad_total_gmv,
                ROUND(SUM(w.total_gmv)/NULLIF(SUM(w.spend),0),2)              AS roi,
                ROUND(SUM(w.clicks)/NULLIF(SUM(w.impressions),0)*100,4)       AS ctr,
                ROUND(SUM(w.spend)/NULLIF(SUM(w.clicks),0),2)                 AS cpc,
                ROUND(SUM(w.spend)/NULLIF(SUM(w.new_buyers),0),2)             AS cpna
            FROM fact_syzt_product s
            JOIN dim_product p ON s.product_id = p.product_id
            LEFT JOIN fact_wxst_product w
                ON w.product_id = s.product_id AND w.stat_date = s.stat_date
            WHERE p.spu_id IN ({ph}) AND s.stat_date BETWEEN %s AND %s
            GROUP BY p.spu_id
            ORDER BY total_pay DESC
        """, (*id_list, s, e))


@app.get("/api/metrics/daily")
def get_product_daily_metrics(
    spu_id: str,
    start: str = Query(default=None),
    end: str = Query(default=None),
):
    """单品每日指标时序，用于趋势图"""
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        return rows(conn, """
            SELECT
                s.stat_date,
                SUM(s.visitors)      AS visitors,
                SUM(s.page_views)    AS pv,
                SUM(s.pay_amount)    AS pay_amount,
                SUM(s.cart_users)    AS cart_users,
                SUM(s.order_buyers)  AS order_buyers,
                SUM(s.collect_users) AS collect_users,
                ROUND(SUM(s.cart_users)/NULLIF(SUM(s.visitors),0)*100,4)   AS cart_rate,
                ROUND(SUM(s.order_buyers)/NULLIF(SUM(s.visitors),0)*100,4) AS order_cvr,
                SUM(w.spend)         AS spend,
                SUM(w.total_gmv)     AS ad_gmv,
                ROUND(SUM(w.total_gmv)/NULLIF(SUM(w.spend),0),2)          AS roi,
                ROUND(SUM(w.clicks)/NULLIF(SUM(w.impressions),0)*100,4)   AS ctr
            FROM fact_syzt_product s
            JOIN dim_product p ON s.product_id = p.product_id
            LEFT JOIN fact_wxst_product w
                ON w.product_id = s.product_id AND w.stat_date = s.stat_date
            WHERE p.spu_id = %s AND s.stat_date BETWEEN %s AND %s
            GROUP BY s.stat_date
            ORDER BY s.stat_date
        """, (spu_id, s, e))


@app.get("/api/metrics/alerts")
def get_alerts(
    start: str = Query(default=None),
    end: str = Query(default=None),
):
    """Sheet5 预警：销量衰退预警 + 加购库存预警"""
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        decay = rows(conn, """
            WITH daily AS (
                SELECT p.spu_id, MAX(p.title) AS title,
                       s.stat_date, SUM(s.pay_amount) AS pay
                FROM fact_syzt_product s
                JOIN dim_product p ON s.product_id = p.product_id
                WHERE s.stat_date BETWEEN %s AND %s
                GROUP BY p.spu_id, s.stat_date
            ),
            recent AS (
                SELECT spu_id, title, AVG(pay) AS avg_pay FROM daily
                WHERE stat_date >= (SELECT MAX(stat_date) FROM daily) - INTERVAL '6 days'
                GROUP BY spu_id, title
            ),
            prev AS (
                SELECT spu_id, AVG(pay) AS avg_pay FROM daily
                WHERE stat_date BETWEEN
                    (SELECT MAX(stat_date) FROM daily) - INTERVAL '13 days'
                    AND (SELECT MAX(stat_date) FROM daily) - INTERVAL '7 days'
                GROUP BY spu_id
            )
            SELECT r.spu_id, r.title,
                ROUND(r.avg_pay,2) AS recent_7d_avg,
                ROUND(p.avg_pay,2) AS prev_7d_avg,
                ROUND((r.avg_pay-p.avg_pay)/NULLIF(p.avg_pay,0)*100,1) AS change_pct,
                CASE WHEN r.avg_pay < p.avg_pay*0.7 THEN true ELSE false END AS decay_alert
            FROM recent r LEFT JOIN prev p USING(spu_id)
            ORDER BY change_pct ASC NULLS LAST
        """, (s, e))

        inventory = rows(conn, """
            SELECT p.spu_id, MAX(p.title) AS title,
                MAX(p.inventory) AS inventory,
                SUM(s.cart_qty)  AS recent_cart_qty,
                CASE WHEN SUM(s.cart_qty) > MAX(p.inventory)*0.8
                     THEN true ELSE false END AS inventory_alert
            FROM fact_syzt_product s
            JOIN dim_product p ON s.product_id = p.product_id
            WHERE s.stat_date BETWEEN %s AND %s
            GROUP BY p.spu_id
            ORDER BY inventory_alert DESC, recent_cart_qty DESC
        """, (s, e))

        return {
            "decay_alerts": decay,
            "inventory_alerts": inventory,
            "inventory_note": "库存数据来自优化商品ID清单.xlsx，如需精确预警请对接ERP"
        }


@app.get("/api/metrics/xhs")
def get_xhs_metrics(
    product_id: Optional[str] = None,
    start: str = Query(default=None),
    end: str = Query(default=None),
):
    """Sheet6 小红书笔记指标（CEI + 发布后成交关联）"""
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    with db() as conn:
        base_sql = """
            SELECT n.id, n.note_title, n.note_url, n.publish_time, n.author,
                n.likes, n.collects, n.shares, n.comments, n.reads,
                ROUND(
                    (n.likes*1.0 + n.collects*2.0 + n.shares*3.0 + n.comments*1.5)
                    / NULLIF(n.reads,0) * 1000, 2
                ) AS cei,
                array_agg(np.product_id) AS product_ids
            FROM fact_xhs_note n
            LEFT JOIN fact_xhs_note_product np ON np.note_id = n.id
        """
        if product_id:
            result = rows(conn, base_sql +
                "WHERE np.product_id=%s AND n.publish_time BETWEEN %s AND %s "
                "GROUP BY n.id ORDER BY cei DESC NULLS LAST",
                (product_id, s, e))
        else:
            result = rows(conn, base_sql +
                "WHERE n.publish_time BETWEEN %s AND %s "
                "GROUP BY n.id ORDER BY cei DESC NULLS LAST",
                (s, e))
        for r in result:
            pids = [p for p in (r["product_ids"] or []) if p]
            if pids and r["publish_time"]:
                ph = ','.join(['%s']*len(pids))
                pay_row = row(conn, f"""
                    SELECT SUM(pay_amount) AS pay FROM fact_syzt_product
                    WHERE product_id IN ({ph})
                      AND stat_date BETWEEN %s AND (%s::date + INTERVAL '7 days')::text
                """, (*pids, r["publish_time"], r["publish_time"]))
                r["pay_after_7d"] = pay_row["pay"] if pay_row else None
            else:
                r["pay_after_7d"] = None
        return result


# ══════════════════════════════════════════════════
# 小红书笔记 CRUD（用户在单品页手动加 / 删）
# ══════════════════════════════════════════════════
class XhsNoteCreate(BaseModel):
    pid: str
    title: str
    link: str
    date: Optional[str] = None
    author: Optional[str] = None
    likes: int = 0
    collect: int = 0
    comments: int = 0
    views: int = 0


@app.post("/api/xhs-notes", status_code=201)
def create_xhs_note(body: XhsNoteCreate,
                    _user=Depends(require_permission('xhs.create'))):
    """
    新增小红书笔记。链接 UNIQUE，已存在则更新指标。
    """
    if not body.title.strip():
        raise HTTPException(400, "标题不能为空")
    if not body.link.strip():
        raise HTTPException(400, "链接不能为空")
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # 1. upsert fact_xhs_note
        cur.execute("""
            INSERT INTO fact_xhs_note
                (note_title, note_url, publish_time, author,
                 likes, collects, comments, reads)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (note_url) DO UPDATE SET
                note_title = EXCLUDED.note_title,
                publish_time = EXCLUDED.publish_time,
                author = EXCLUDED.author,
                likes = EXCLUDED.likes,
                collects = EXCLUDED.collects,
                comments = EXCLUDED.comments,
                reads = EXCLUDED.reads
            RETURNING id
        """, (body.title.strip(), body.link.strip(), body.date or None,
              body.author or '', body.likes, body.collect,
              body.comments, body.views))
        note_id = cur.fetchone()["id"]
        # 2. upsert fact_xhs_note_product 关联
        cur.execute("""
            INSERT INTO fact_xhs_note_product (note_id, product_id)
            VALUES (%s, %s)
            ON CONFLICT DO NOTHING
        """, (note_id, body.pid))
        conn.commit()
        return {
            "id": note_id, "pid": body.pid, "title": body.title,
            "link": body.link, "date": body.date, "author": body.author,
            "likes": body.likes, "collect": body.collect,
            "comments": body.comments,
            "inter": body.likes + body.collect + body.comments,
            "views": body.views,
        }


@app.delete("/api/xhs-notes/{note_id}")
def delete_xhs_note(note_id: int,
                    _user=Depends(require_permission('xhs.delete'))):
    """
    删除小红书笔记（连带删 fact_xhs_note_product）。
    """
    with db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM fact_xhs_note_product WHERE note_id = %s", (note_id,))
        cur.execute("DELETE FROM fact_xhs_note WHERE id = %s", (note_id,))
        conn.commit()
        return {"ok": True}


# ══════════════════════════════════════════════════
# ══════════════════════════════════════════════════
# 总览：排行榜对比 & 品类计划
# ══════════════════════════════════════════════════

def _prev_range(start: str, end: str):
    """计算对比期（等长前移）"""
    from datetime import date, timedelta
    s = date.fromisoformat(start)
    e = date.fromisoformat(end)
    delta = (e - s).days + 1
    return (s - timedelta(days=delta)).isoformat(), (e - timedelta(days=delta)).isoformat()


@app.get("/api/overview/ranking")
def get_overview_ranking(
    metric: str = Query(default="gmv", description="gmv | ctr | visitors"),
    start: str = Query(default=None),
    end:   str = Query(default=None),
    limit: int = 10,
    category: Optional[str] = Query(default=None,
        description="按一级分类筛选：配饰 / 家具 / 灯具，留空=全部"),
):
    """
    商品排行榜，含当期 vs 上一周期对比。
    metric: gmv=销售额  ctr=点击率  visitors=进店UV
    category: 可选，限定一级分类
    """
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    ps, pe = _prev_range(s, e)
    cat_clause = " AND p.category_l1 = %s" if category else ""
    cat_params = (category,) if category else ()

    try:
      with db() as conn:
        if metric == "ctr":
            sql_cur = f"""
                SELECT p.spu_id,
                       MAX(p.title) AS title,
                       MAX(p.category_l1) AS category_l1,
                       ROUND(SUM(w.clicks)/NULLIF(SUM(w.impressions),0)*100, 4) AS value,
                       SUM(w.impressions) AS impressions,
                       SUM(w.clicks)      AS clicks
                FROM fact_wxst_product w
                JOIN dim_product p ON w.product_id = p.product_id
                WHERE w.stat_date BETWEEN %s AND %s {cat_clause}
                GROUP BY p.spu_id
                HAVING SUM(w.impressions) > 0
                ORDER BY value DESC LIMIT %s
            """
            sql_prev = f"""
                SELECT p.spu_id,
                       ROUND(SUM(w.clicks)/NULLIF(SUM(w.impressions),0)*100, 4) AS value
                FROM fact_wxst_product w
                JOIN dim_product p ON w.product_id = p.product_id
                WHERE w.stat_date BETWEEN %s AND %s {cat_clause}
                GROUP BY p.spu_id
            """
            cur_rows  = rows(conn, sql_cur,  (s, e, *cat_params, limit))
            prev_rows = rows(conn, sql_prev, (ps, pe, *cat_params))
        elif metric == "visitors":
            sql_cur = f"""
                SELECT p.spu_id,
                       MAX(p.title) AS title,
                       MAX(p.category_l1) AS category_l1,
                       SUM(s.visitors) AS value
                FROM fact_syzt_product s
                JOIN dim_product p ON s.product_id = p.product_id
                WHERE s.stat_date BETWEEN %s AND %s {cat_clause}
                GROUP BY p.spu_id
                ORDER BY value DESC LIMIT %s
            """
            sql_prev = f"""
                SELECT p.spu_id, SUM(s.visitors) AS value
                FROM fact_syzt_product s
                JOIN dim_product p ON s.product_id = p.product_id
                WHERE s.stat_date BETWEEN %s AND %s {cat_clause}
                GROUP BY p.spu_id
            """
            cur_rows  = rows(conn, sql_cur,  (s, e, *cat_params, limit))
            prev_rows = rows(conn, sql_prev, (ps, pe, *cat_params))
        else:  # gmv
            sql_cur = f"""
                SELECT p.spu_id,
                       MAX(p.title) AS title,
                       MAX(p.category_l1) AS category_l1,
                       ROUND(SUM(s.pay_amount), 2) AS value
                FROM fact_syzt_product s
                JOIN dim_product p ON s.product_id = p.product_id
                WHERE s.stat_date BETWEEN %s AND %s {cat_clause}
                GROUP BY p.spu_id
                ORDER BY value DESC LIMIT %s
            """
            sql_prev = f"""
                SELECT p.spu_id, ROUND(SUM(s.pay_amount), 2) AS value
                FROM fact_syzt_product s
                JOIN dim_product p ON s.product_id = p.product_id
                WHERE s.stat_date BETWEEN %s AND %s {cat_clause}
                GROUP BY p.spu_id
            """
            cur_rows  = rows(conn, sql_cur,  (s, e, *cat_params, limit))
            prev_rows = rows(conn, sql_prev, (ps, pe, *cat_params))

        prev_map = {r["spu_id"]: r["value"] for r in prev_rows}
        max_val = max((r["value"] or 0 for r in cur_rows), default=1)

        result = []
        for rank, r in enumerate(cur_rows, 1):
            cur_val  = r["value"] or 0
            prev_val = prev_map.get(r["spu_id"])
            if prev_val and prev_val > 0:
                change_pct = round((cur_val - prev_val) / prev_val * 100, 1)
            else:
                change_pct = None
            result.append({
                "rank":        rank,
                "spu_id":      r["spu_id"],
                "title":       r["title"],
                "category_l1": r["category_l1"],
                "value":       cur_val,
                "prev_value":  prev_val,
                "change_pct":  change_pct,
                "bar_pct":     round(cur_val / max_val * 100, 1) if max_val else 0,
            })
        # 上期 Top10：用同样的 sql_prev 但限制 LIMIT，并按 value 排序
        # （sql_prev 没有 LIMIT/ORDER BY，所以这里 Python 处理）
        prev_top = sorted(prev_rows, key=lambda r: r.get("value") or 0, reverse=True)[:limit]
        prev_top_with_meta = []
        prev_pids = [r["spu_id"] for r in prev_top]
        if prev_pids:
            with db() as conn2:
                meta = rows(conn2, """
                    SELECT spu_id, MAX(title) AS title, MAX(category_l1) AS category_l1
                    FROM dim_product WHERE spu_id = ANY(%s) GROUP BY spu_id
                """, (prev_pids,))
                meta_by_pid = {r["spu_id"]: r for r in meta}
            for rank, r in enumerate(prev_top, 1):
                m = meta_by_pid.get(r["spu_id"], {})
                prev_top_with_meta.append({
                    "rank":        rank,
                    "spu_id":      r["spu_id"],
                    "title":       m.get("title") or r["spu_id"],
                    "category_l1": m.get("category_l1") or "",
                    "value":       r["value"],
                })

        return {
            "metric":     metric,
            "period":     {"start": s, "end": e},
            "prev_period":{"start": ps, "end": pe},
            "items":      result,
            "prev_top":   prev_top_with_meta,
        }
    except Exception as exc:
        # 兜底：不让 500 出去，返回空结果 + 错误信息
        import traceback
        return {
            "metric": metric,
            "period": {"start": s, "end": e},
            "prev_period": {"start": ps, "end": pe},
            "items": [],
            "_error": str(exc),
            "_traceback": traceback.format_exc()[:1500],
        }


@app.get("/api/overview/kpi")
def get_overview_kpi(
    start: str = Query(default=None),
    end:   str = Query(default=None),
):
    """总览4个KPI卡片：销售额、加购率、CTR、流量，含环比"""
    s, e   = start or CAMPAIGN_START, end or date.today().isoformat()
    ps, pe = _prev_range(s, e)
    with db() as conn:
        def syzt_agg(s_, e_):
            return row(conn, """
                SELECT SUM(pay_amount)  AS pay,
                       SUM(visitors)   AS visitors,
                       SUM(cart_users) AS cart_users
                FROM fact_syzt_product
                WHERE stat_date BETWEEN %s AND %s
            """, (s_, e_))
        def wxst_agg(s_, e_):
            return row(conn, """
                SELECT SUM(clicks)      AS clicks,
                       SUM(impressions) AS impressions
                FROM fact_wxst_product
                WHERE stat_date BETWEEN %s AND %s
            """, (s_, e_))

        cur  = syzt_agg(s, e)  or {}
        prev = syzt_agg(ps, pe) or {}
        wc   = wxst_agg(s, e)  or {}
        wp   = wxst_agg(ps, pe) or {}

        def pct_change(a, b):
            if b and b > 0:
                return round((a - b) / b * 100, 1)
            return None

        pay      = float(cur.get("pay") or 0)
        visitors = float(cur.get("visitors") or 0)
        cart     = float(cur.get("cart_users") or 0)
        clicks   = float(wc.get("clicks") or 0)
        imps     = float(wc.get("impressions") or 0)
        ctr      = round(clicks / imps * 100, 4) if imps else None
        cart_rate = round(cart / visitors * 100, 4) if visitors else None

        ppay      = float(prev.get("pay") or 0)
        pvisitors = float(prev.get("visitors") or 0)
        pcart     = float(prev.get("cart_users") or 0)
        pclicks   = float(wp.get("clicks") or 0)
        pimps     = float(wp.get("impressions") or 0)
        pctr      = round(pclicks / pimps * 100, 4) if pimps else None
        pcart_rate = round(pcart / pvisitors * 100, 4) if pvisitors else None

        return {
            "period":      {"start": s,  "end": e},
            "prev_period": {"start": ps, "end": pe},
            "pay_amount":  {"value": pay,       "prev": ppay,       "change_pct": pct_change(pay, ppay)},
            "visitors":    {"value": visitors,  "prev": pvisitors,  "change_pct": pct_change(visitors, pvisitors)},
            "cart_rate":   {"value": cart_rate, "prev": pcart_rate, "change_pct": pct_change(cart_rate or 0, pcart_rate or 0)},
            "ctr":         {"value": ctr,       "prev": pctr,       "change_pct": pct_change(ctr or 0, pctr or 0),
                            "note": "仅含投放商品"},
        }


# ── 品类计划预算 ──────────────────────────────────
@app.get("/api/plan/category")
def get_plan_category():
    """读取品类计划占比，同时返回实际花费"""
    # 默认计划（来自运营配置表）
    DEFAULT_PLAN = {
        "家具":  {"plan_pct": 63.0, "daily_budget": 660},
        "配饰":  {"plan_pct": 30.0, "daily_budget": 400},
        "灯具":  {"plan_pct":  5.0, "daily_budget": 100},
        "其他":  {"plan_pct":  2.0, "daily_budget":   0},
    }
    with db() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS plan_budget (
                id          SERIAL PRIMARY KEY,
                category    TEXT NOT NULL UNIQUE,
                plan_pct    REAL DEFAULT 0,
                plan_amount REAL DEFAULT 0,
                daily_budget REAL DEFAULT 0,
                updated_at  TIMESTAMPTZ DEFAULT now()
            )
        """)
        # 自动补充默认值（首次启动时）
        for cat, d in DEFAULT_PLAN.items():
            cur.execute("""
                INSERT INTO plan_budget(category, plan_pct, plan_amount, daily_budget)
                VALUES(%s, %s, 0, %s)
                ON CONFLICT(category) DO NOTHING
            """, (cat, d["plan_pct"], d["daily_budget"]))
        conn.commit()
        plans = rows(conn, "SELECT category, plan_pct, plan_amount, daily_budget FROM plan_budget ORDER BY category")
        plan_map = {p["category"]: p for p in plans}

        actuals = rows(conn, """
            SELECT p.category_l1 AS category,
                   ROUND(SUM(w.spend), 2) AS actual_spend
            FROM fact_wxst_product w
            JOIN dim_product p ON w.product_id = p.product_id
            WHERE w.stat_date >= %s
            GROUP BY p.category_l1
        """, (CAMPAIGN_START,))
        total_actual = sum(float(a["actual_spend"] or 0) for a in actuals)

        result = []
        for a in actuals:
            cat = a["category"] or "其他"
            actual = float(a["actual_spend"] or 0)
            actual_pct = round(actual / total_actual * 100, 1) if total_actual else 0
            plan = plan_map.get(cat, {})
            plan_pct = plan.get("plan_pct") or 0
            diff = round(actual_pct - plan_pct, 1)
            if abs(diff) >= 10:
                status = "danger"
            elif abs(diff) >= 5:
                status = "warning"
            else:
                status = "normal"
            result.append({
                "category":    cat,
                "plan_pct":    plan_pct,
                "actual_pct":  actual_pct,
                "actual_spend":actual,
                "diff":        diff,
                "status":      status,
            })
        return {"total_actual": total_actual, "items": result}


class PlanCategoryUpdate(BaseModel):
    items: list


@app.put("/api/plan/category")
def update_plan_category(body: PlanCategoryUpdate):
    """保存品类计划占比"""
    import json
    with db() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS plan_budget (
                id SERIAL PRIMARY KEY, category TEXT UNIQUE,
                plan_pct REAL DEFAULT 0, plan_amount REAL DEFAULT 0,
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        for item in body.items:
            cur.execute("""
                INSERT INTO plan_budget(category, plan_pct, plan_amount)
                VALUES(%s,%s,%s)
                ON CONFLICT(category) DO UPDATE SET
                    plan_pct=EXCLUDED.plan_pct,
                    plan_amount=EXCLUDED.plan_amount,
                    updated_at=now()
            """, (item.get("category"), item.get("plan_pct", 0), item.get("plan_amount", 0)))
        conn.commit()
    return {"ok": True}


# 健康检查
# ══════════════════════════════════════════════════

@app.get("/api/health")
def health():
    try:
        with db() as conn:
            counts = {
                "products": row(conn, "SELECT COUNT(*) as n FROM dim_product")["n"],
                "ads_days": row(conn, "SELECT COUNT(DISTINCT stat_date) as n FROM fact_wxst_product")["n"],
                "syzt_days": row(conn, "SELECT COUNT(DISTINCT stat_date) as n FROM fact_syzt_product")["n"],
                "tasks": row(conn, "SELECT COUNT(*) as n FROM tasks")["n"],
            }
            latest = row(conn, "SELECT MAX(stat_date) as d FROM fact_wxst_product")
            loaded = row(conn, """
                SELECT TO_CHAR(MAX(loaded_at) AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS t
                FROM fact_syzt_product
            """)
        return {
            "status": "ok",
            "latest_date": latest["d"],
            "loaded_at": loaded["t"] if loaded else None,
            "counts": counts,
        }
    except Exception:
        return {
            "status": "offline",
            "latest_date": "2026-04-21",
            "loaded_at": "04-21 21:57",
            "counts": {},
        }





# ══════════════════════════════════════════════════
# 协同状态同步（APP_STATE 存云端，多人共享）
# ══════════════════════════════════════════════════

def _ensure_app_state_table():
    try:
        with db() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS app_state (
                    id         INT PRIMARY KEY DEFAULT 1,
                    state_json JSONB NOT NULL DEFAULT '{}',
                    updated_at TIMESTAMPTZ DEFAULT now()
                )
            """)
            cur.execute("INSERT INTO app_state(id,state_json) VALUES(1,'{}') ON CONFLICT DO NOTHING")
            conn.commit()
    except Exception as e:
        import logging; logging.warning(f"app_state table init skipped: {e}")

_ensure_app_state_table()


@app.get("/api/app-state")
def get_app_state():
    import json
    try:
        with db() as conn:
            r = row(conn, "SELECT state_json, updated_at FROM app_state WHERE id=1")
            if not r:
                return {"state": None, "updated_at": None}
            state = r["state_json"] if isinstance(r["state_json"], dict) else json.loads(r["state_json"] or "{}")
            return {"state": state, "updated_at": str(r["updated_at"]) if r["updated_at"] else None}
    except Exception as e:
        raise HTTPException(500, str(e))


class AppStateSave(BaseModel):
    state: dict


@app.post("/api/app-state")
def save_app_state(body: AppStateSave):
    import json
    try:
        with db() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO app_state(id,state_json,updated_at) VALUES(1,%s,now()) "
                "ON CONFLICT(id) DO UPDATE SET state_json=%s, updated_at=now()",
                (json.dumps(body.state), json.dumps(body.state))
            )
            conn.commit()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


# ══════════════════════════════════════════════════
# 数据底表导入（上传文件 → 运行 ETL → 刷新 RAW）
# ══════════════════════════════════════════════════

from fastapi import UploadFile, File
from typing import List


@app.post("/api/refresh-data")
async def refresh_data_upload(files: List[UploadFile] = File(...)):
    import shutil, subprocess
    if not files:
        raise HTTPException(400, "未收到文件")

    base_dir = DASHBOARD_DIR
    saved = []
    # 文件名 → 目标文件夹分发（按淘宝/万象台导出文件名前缀识别）
    def _route_file(filename: str) -> Optional[str]:
        n = filename or ""
        ext = n.rsplit(".", 1)[-1].lower()
        if ext not in ("xls", "xlsx", "csv"):
            return None
        # 流量类
        if "无限店铺流量" in n or "流量报表" in n or "店铺流量" in n:
            return os.path.join(base_dir, "无限店铺流量")
        # 万象台 推广报表 子类（按文件名优先匹配最具体的）
        if "人群推广商品报表" in n or "人群商品报表" in n:
            return os.path.join(base_dir, "推广报表", "商品报表", "人群推广商品报表")
        if "关键词商品报表" in n or "关键词推广商品报表" in n:
            return os.path.join(base_dir, "推广报表", "商品报表", "关键词商品报表")
        if "全部营销场景商品报表" in n or "全场景商品报表" in n:
            return os.path.join(base_dir, "推广报表", "商品报表")
        # 全营销场景报表（场景级日数据，老板要求的 ROI 口径权威源）
        if "全营销场景报表" in n or "全部营销场景报表" in n or "全场景报表" in n:
            return os.path.join(base_dir, "推广报表", "全营销场景报表")
        if "人群报表" in n:
            return os.path.join(base_dir, "推广报表", "人群报表")
        if "关键词报表" in n:
            return os.path.join(base_dir, "推广报表", "关键词报表")
        if "内容报表" in n:
            return os.path.join(base_dir, "推广报表", "内容报表")
        if "创意报表" in n:
            return os.path.join(base_dir, "推广报表", "创意报表")
        # 通用商品报表（兜底）
        if "推广" in n or "商品报表" in n:
            return os.path.join(base_dir, "推广报表", "商品报表")
        # 生意参谋（默认 xls 文件）
        if ext in ("xls", "xlsx"):
            return os.path.join(base_dir, "生意参谋商品")
        # csv 默认放生意参谋
        return os.path.join(base_dir, "生意参谋商品")

    for f in files:
        name = f.filename or "upload"
        dest_dir = _route_file(name)
        if not dest_dir:
            continue
        os.makedirs(dest_dir, exist_ok=True)
        dest_path = os.path.join(dest_dir, name)
        with open(dest_path, "wb") as out:
            shutil.copyfileobj(f.file, out)
        saved.append({"name": name, "dest": dest_dir.replace(base_dir + os.sep, "")})

    if not saved:
        raise HTTPException(400, "未识别到有效文件（需要 .xls/.xlsx/.csv）")

    # 双轨 ETL：先跑 etl_load.py 灌 Neon（dashboard 主要数据源），
    # 再跑 refresh_dashboard.py 更新 dashboard.html RAW 快照（fallback 兜底）。
    # 老接口只跑后者，导致前端从 Neon 读到的数据不会刷新。
    neon_script = os.path.join(base_dir, "etl", "etl_load.py")
    snapshot_script = os.path.join(base_dir, "etl", "refresh_dashboard.py")
    if not os.path.exists(neon_script):
        raise HTTPException(500, "ETL 脚本不存在：etl/etl_load.py")

    logs = []
    try:
        # 1) Neon: 直接灌库
        env = os.environ.copy()
        if not env.get("DATABASE_URL"):
            raise HTTPException(500, "DATABASE_URL 未配置，无法灌 Neon")
        r1 = subprocess.run(
            ["python3", neon_script],
            cwd=base_dir, env=env,
            capture_output=True, text=True, timeout=300
        )
        logs.append(f"[etl_load.py] rc={r1.returncode}\n{r1.stdout[-600:]}\n{r1.stderr[-600:]}")
        if r1.returncode != 0:
            raise HTTPException(500, f"Neon ETL 失败：{r1.stderr[-800:]}")
        # 2) 快照（best-effort，不阻塞主流程）
        if os.path.exists(snapshot_script):
            r2 = subprocess.run(
                ["python3", snapshot_script],
                cwd=base_dir,
                capture_output=True, text=True, timeout=120
            )
            logs.append(f"[refresh_dashboard.py] rc={r2.returncode}")
        result = r1  # 返回值兼容老下游
        if result.returncode != 0:
            raise HTTPException(500, f"ETL 失败：{result.stderr[-800:]}")
        # 从 etl_load.py 输出里抓行数（fact_syzt_product: N rows / fact_wxst_product: N rows / fact_traffic: N rows）
        import re as _re
        out = result.stdout or ""
        def _pick(tbl):
            m = _re.search(rf'fact_{tbl}\s*:\s*(\d+)\s*rows', out)
            return int(m.group(1)) if m else 0
        syzt = _pick('syzt_product')
        wxst = _pick('wxst_product')
        traffic = _pick('traffic')
        audience = _pick('wxst_audience')
        keyword = _pick('wxst_keyword')
        # data_end 从 syzt 表最大日期取（近似）
        m = _re.search(r'fact_syzt_product:.*?\n.*?data_end[=：]\s*(\d{4}-\d{2}-\d{2})', out, _re.S)
        data_end = m.group(1) if m else None
        return {
            "ok": True, "saved_files": saved,
            "data_end": data_end,
            "syzt": syzt, "wxst": wxst,
            "traffic": traffic, "audience": audience, "keyword": keyword,
            "log": out[-1500:],
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(500, "ETL 超时（>120s）")


# ── 静态文件：直接访问 http://localhost:766 打开看板 ──
@app.get("/")
def serve_dashboard():
    path = os.path.join(DASHBOARD_DIR, "dashboard.html")
    return FileResponse(path, media_type="text/html")

@app.get("/favicon.ico")
def favicon():
    return FileResponse(os.path.join(DASHBOARD_DIR, "favicon.ico")) if os.path.exists(
        os.path.join(DASHBOARD_DIR, "favicon.ico")) else {"detail": "no favicon"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=766, reload=True)
