"""
HAY 电商数据看板 — API 服务（连接 Neon PostgreSQL）
运行: python3 server.py
访问: http://localhost:766
"""
import hashlib
import os
from contextlib import contextmanager
from typing import Optional
from datetime import date

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

NEON_DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://neondb_owner:npg_vJrIahw5N0gO@ep-steep-poetry-ao6yf96a-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
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
                ROUND(AVG(s.avg_stay_duration), 1)      AS avg_stay_duration,
                ROUND(AVG(s.bounce_rate)*100, 2)        AS avg_bounce_rate
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


class TaskUpdate(BaseModel):
    detail: Optional[str] = None
    owner: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    execution_note: Optional[str] = None
    time_range_label: Optional[str] = None


@app.get("/api/tasks")
def get_tasks(product_id: Optional[str] = None):
    with db() as conn:
        if product_id:
            return rows(conn, "SELECT * FROM tasks WHERE product_id = %s ORDER BY id DESC", (product_id,))
        return rows(conn, "SELECT * FROM tasks ORDER BY id DESC")


@app.post("/api/tasks", status_code=201)
def create_task(task: TaskCreate):
    with db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            INSERT INTO tasks (product_id, detail, owner, status, priority, category, time_range_label, execution_note)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
        """, (task.product_id, task.detail, task.owner, task.status,
              task.priority, task.category, task.time_range_label, task.execution_note))
        new_id = cur.fetchone()["id"]
        conn.commit()
        return row(conn, "SELECT * FROM tasks WHERE id = %s", (new_id,))


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: int, task: TaskUpdate):
    fields = {k: v for k, v in task.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "no fields to update")
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE tasks SET {set_clause}, updated_at = now() WHERE id = %s",
            (*fields.values(), task_id)
        )
        conn.commit()
        return row(conn, "SELECT * FROM tasks WHERE id = %s", (task_id,))


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int):
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
def create_meeting_note(note: NoteCreate):
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
def delete_meeting_note(note_id: int):
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
    permissions: dict


@app.patch("/api/users/{user_id}/permissions")
def update_user_permissions(user_id: int, body: UserPermissionsUpdate):
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
    role: str
    display_name: Optional[str] = None


@app.patch("/api/users/{user_id}")
def update_user(user_id: int, body: UserRoleUpdate):
    fields = {'role': body.role}
    if body.display_name is not None:
        fields['display_name'] = body.display_name
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE users SET {set_clause} WHERE id = %s",
            (*fields.values(), user_id)
        )
        conn.commit()
        return row(conn, "SELECT id, username, display_name, role, permissions FROM users WHERE id = %s", (user_id,))


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
                AVG(s.avg_stay_duration)  AS avg_stay_duration,
                AVG(s.bounce_rate)        AS avg_bounce_rate,
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
                AVG(s.avg_stay_duration)  AS avg_stay,
                AVG(s.bounce_rate)*100    AS bounce_rate,
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
):
    """
    商品排行榜，含当期 vs 上一周期对比。
    metric: gmv=销售额  ctr=点击率  visitors=进店UV
    """
    s, e = start or CAMPAIGN_START, end or date.today().isoformat()
    ps, pe = _prev_range(s, e)

    with db() as conn:
        if metric == "ctr":
            sql_cur = """
                SELECT p.spu_id,
                       MAX(p.title) AS title,
                       MAX(p.category_l1) AS category_l1,
                       ROUND(SUM(w.clicks)/NULLIF(SUM(w.impressions),0)*100, 4) AS value,
                       SUM(w.impressions) AS impressions,
                       SUM(w.clicks)      AS clicks
                FROM fact_wxst_product w
                JOIN dim_product p ON w.product_id = p.product_id
                WHERE w.stat_date BETWEEN %s AND %s
                GROUP BY p.spu_id
                HAVING SUM(w.impressions) > 0
                ORDER BY value DESC LIMIT %s
            """
            sql_prev = """
                SELECT p.spu_id,
                       ROUND(SUM(w.clicks)/NULLIF(SUM(w.impressions),0)*100, 4) AS value
                FROM fact_wxst_product w
                JOIN dim_product p ON w.product_id = p.product_id
                WHERE w.stat_date BETWEEN %s AND %s
                GROUP BY p.spu_id
            """
            cur_rows  = rows(conn, sql_cur,  (s, e, limit))
            prev_rows = rows(conn, sql_prev, (ps, pe))
        elif metric == "visitors":
            sql_cur = """
                SELECT p.spu_id,
                       MAX(p.title) AS title,
                       MAX(p.category_l1) AS category_l1,
                       SUM(s.visitors) AS value
                FROM fact_syzt_product s
                JOIN dim_product p ON s.product_id = p.product_id
                WHERE s.stat_date BETWEEN %s AND %s
                GROUP BY p.spu_id
                ORDER BY value DESC LIMIT %s
            """
            sql_prev = """
                SELECT p.spu_id, SUM(s.visitors) AS value
                FROM fact_syzt_product s
                JOIN dim_product p ON s.product_id = p.product_id
                WHERE s.stat_date BETWEEN %s AND %s
                GROUP BY p.spu_id
            """
            cur_rows  = rows(conn, sql_cur,  (s, e, limit))
            prev_rows = rows(conn, sql_prev, (ps, pe))
        else:  # gmv
            sql_cur = """
                SELECT p.spu_id,
                       MAX(p.title) AS title,
                       MAX(p.category_l1) AS category_l1,
                       ROUND(SUM(s.pay_amount), 2) AS value
                FROM fact_syzt_product s
                JOIN dim_product p ON s.product_id = p.product_id
                WHERE s.stat_date BETWEEN %s AND %s
                GROUP BY p.spu_id
                ORDER BY value DESC LIMIT %s
            """
            sql_prev = """
                SELECT p.spu_id, ROUND(SUM(s.pay_amount), 2) AS value
                FROM fact_syzt_product s
                JOIN dim_product p ON s.product_id = p.product_id
                WHERE s.stat_date BETWEEN %s AND %s
                GROUP BY p.spu_id
            """
            cur_rows  = rows(conn, sql_cur,  (s, e, limit))
            prev_rows = rows(conn, sql_prev, (ps, pe))

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
        return {
            "metric":     metric,
            "period":     {"start": s, "end": e},
            "prev_period":{"start": ps, "end": pe},
            "items":      result,
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
    for f in files:
        name = f.filename or "upload"
        ext = name.rsplit(".", 1)[-1].lower()
        if ext in ("xls", "xlsx"):
            dest_dir = os.path.join(base_dir, "生意参谋商品")
        elif ext == "csv":
            # Detect: ad report vs store report
            content_head = await f.read(512)
            await f.seek(0)
            if b"\xe8\x8a\xb1\xe8\xb4\xb9" in content_head or b"spend" in content_head.lower() or "推广" in name or "商品报表" in name:
                dest_dir = os.path.join(base_dir, "推广报表", "商品报表")
            else:
                dest_dir = os.path.join(base_dir, "生意参谋商品")
        else:
            continue
        os.makedirs(dest_dir, exist_ok=True)
        dest_path = os.path.join(dest_dir, name)
        with open(dest_path, "wb") as out:
            shutil.copyfileobj(f.file, out)
        saved.append(name)

    if not saved:
        raise HTTPException(400, "未识别到有效文件（需要 .xls/.xlsx/.csv）")

    etl_script = os.path.join(base_dir, "etl", "refresh_dashboard.py")
    if not os.path.exists(etl_script):
        raise HTTPException(500, "ETL 脚本不存在：etl/refresh_dashboard.py")

    try:
        result = subprocess.run(
            ["python3", etl_script],
            cwd=base_dir,
            capture_output=True, text=True, timeout=120
        )
        if result.returncode != 0:
            raise HTTPException(500, f"ETL 失败：{result.stderr[-800:]}")
        # Extract data_end from output
        data_end = None
        for line in result.stdout.splitlines():
            if "data_end=" in line:
                data_end = line.split("data_end=")[1].split()[0]
                break
        syzt = wxst = 0
        for line in result.stdout.splitlines():
            if "syzt=" in line:
                try: syzt = int(line.split("syzt=")[1].split()[0])
                except: pass
            if "wxst=" in line:
                try: wxst = int(line.split("wxst=")[1].split()[0])
                except: pass
        return {"ok": True, "saved_files": saved, "data_end": data_end, "syzt": syzt, "wxst": wxst, "log": result.stdout[-600:]}
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
