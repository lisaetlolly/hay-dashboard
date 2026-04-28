-- ============================================================
-- HAY 电商数据看板  Schema  (PostgreSQL)
-- ============================================================

-- 1. 维度：商品（含 SPU 合并逻辑）
-- spu_id: 同一品的多个 SKU 映射到同一 spu_id，展示时用最新 SKU 的 product_id
-- 两个 Facet Cabinet: 824452791755(老) -> spu_id = 1016294283167(新)
CREATE TABLE IF NOT EXISTS dim_product (
    product_id   TEXT PRIMARY KEY,
    spu_id       TEXT NOT NULL,      -- 合并展示用，默认等于 product_id
    title        TEXT NOT NULL,
    category_l1  TEXT,
    category_l2  TEXT,
    inventory    INTEGER DEFAULT 0,  -- 来自优化商品ID清单.xlsx
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- 2. 维度：日期
CREATE TABLE IF NOT EXISTS dim_date (
    date_str   TEXT PRIMARY KEY,
    year       INTEGER,
    month      INTEGER,
    week       INTEGER,
    quarter    INTEGER,
    weekday    INTEGER,
    is_weekend INTEGER DEFAULT 0
);

-- 3. 生意参谋商品报表（每商品每天一行）
CREATE TABLE IF NOT EXISTS fact_syzt_product (
    id                      SERIAL PRIMARY KEY,
    stat_date               TEXT NOT NULL,
    product_id              TEXT NOT NULL,
    visitors                REAL,
    page_views              REAL,
    avg_stay_duration       REAL,
    bounce_rate             REAL,
    collect_users           REAL,
    cart_qty                REAL,
    cart_users              REAL,
    order_buyers            REAL,
    order_qty               REAL,
    order_amount            REAL,
    order_cvr               REAL,
    pay_amount              REAL,
    pay_cvr                 REAL,
    pay_new_buyers          REAL,
    pay_old_buyers          REAL,        -- 支付老买家数
    old_buyer_pay_amount    REAL,        -- 老买家支付金额
    visitor_avg_value       REAL,        -- 访客平均价值
    refund_amount           REAL,
    year_cum_pay            REAL,
    month_cum_pay           REAL,
    month_cum_qty           REAL,        -- 月累计支付件数
    search_pay_cvr          REAL,
    search_visitors         REAL,
    search_pay_buyers       REAL,        -- 搜索引导支付买家数
    source_file             TEXT,
    loaded_at               TIMESTAMPTZ DEFAULT now(),
    UNIQUE(stat_date, product_id)
);

-- 4. 万象台商品推广报表
CREATE TABLE IF NOT EXISTS fact_wxst_product (
    id                    SERIAL PRIMARY KEY,
    stat_date             TEXT NOT NULL,
    product_id            TEXT NOT NULL,
    product_name          TEXT,
    impressions           REAL,
    clicks                REAL,         -- 点击量（算真实 CPC 必须）
    spend                 REAL,
    ctr                   REAL,         -- 点击率（小数）
    avg_cpc               REAL,
    cpm                   REAL,
    total_gmv             REAL,
    direct_gmv            REAL,         -- 直接成交金额
    indirect_gmv          REAL,         -- 间接成交金额
    click_cvr             REAL,
    roi                   REAL,
    cart_rate             REAL,
    cart_cnt              REAL,         -- 总购物车数
    collect_item_cnt      REAL,
    collect_shop_cnt      REAL,
    total_collect_cart    REAL,
    item_collect_cart     REAL,
    guided_visits         REAL,
    avg_visit_pages       REAL,
    transaction_buyers    REAL,         -- 成交人数
    new_buyers            REAL,
    natural_gmv           REAL,
    natural_impressions   REAL,
    source_file           TEXT,
    loaded_at             TIMESTAMPTZ DEFAULT now(),
    UNIQUE(stat_date, product_id)
);

-- 5. 万象台人群报表
CREATE TABLE IF NOT EXISTS fact_wxst_audience (
    id                    SERIAL PRIMARY KEY,
    stat_date             TEXT NOT NULL,
    audience_name         TEXT NOT NULL,
    product_name          TEXT,
    impressions           REAL,
    clicks                REAL,
    spend                 REAL,
    ctr                   REAL,
    avg_cpc               REAL,
    cpm                   REAL,
    total_gmv             REAL,
    direct_gmv            REAL,
    indirect_gmv          REAL,
    click_cvr             REAL,
    roi                   REAL,
    cart_rate             REAL,
    cart_cnt              REAL,
    collect_item_cnt      REAL,
    collect_shop_cnt      REAL,
    total_collect_cart    REAL,
    item_collect_cart     REAL,
    guided_visits         REAL,
    avg_visit_pages       REAL,
    new_buyers            REAL,
    natural_gmv           REAL,
    natural_impressions   REAL,
    source_file           TEXT,
    loaded_at             TIMESTAMPTZ DEFAULT now(),
    UNIQUE(stat_date, audience_name)
);

-- 6. 万象台关键词报表
CREATE TABLE IF NOT EXISTS fact_wxst_keyword (
    id                    SERIAL PRIMARY KEY,
    stat_date             TEXT NOT NULL,
    keyword_name          TEXT NOT NULL,
    keyword_id            TEXT,
    keyword_type          TEXT,
    scene_name            TEXT,
    product_name          TEXT,
    impressions           REAL,
    clicks                REAL,
    spend                 REAL,
    ctr                   REAL,
    avg_cpc               REAL,
    cpm                   REAL,
    total_gmv             REAL,
    direct_gmv            REAL,
    indirect_gmv          REAL,
    click_cvr             REAL,
    roi                   REAL,
    cart_rate             REAL,
    cart_cnt              REAL,
    collect_item_cnt      REAL,
    collect_shop_cnt      REAL,
    total_collect_cart    REAL,
    item_collect_cart     REAL,
    guided_visits         REAL,
    avg_visit_pages       REAL,
    new_buyers            REAL,
    natural_gmv           REAL,
    natural_impressions   REAL,
    source_file           TEXT,
    loaded_at             TIMESTAMPTZ DEFAULT now(),
    UNIQUE(stat_date, keyword_name)
);

-- 6b. 万象台全营销场景报表（场景级日数据，用于"总投放 ROI 口径"对账）
-- 这是老板要求的"投放花费"权威来源 = 万象台后台「全营销场景报表」每行 spend
CREATE TABLE IF NOT EXISTS fact_wxst_scene (
    id              SERIAL PRIMARY KEY,
    stat_date       TEXT NOT NULL,
    scene_id        TEXT NOT NULL,
    scene_name      TEXT NOT NULL,
    sub_scene_id    TEXT,
    sub_scene_name  TEXT,
    impressions     REAL,
    clicks          REAL,
    spend           REAL,
    ctr             REAL,
    avg_cpc         REAL,
    cpm             REAL,
    total_gmv       REAL,    -- 总成交金额 = 直接+间接
    direct_gmv      REAL,
    indirect_gmv    REAL,
    total_orders    REAL,    -- 总成交笔数
    direct_orders   REAL,
    indirect_orders REAL,
    click_cvr       REAL,    -- 点击转化率
    roi             REAL,    -- 投入产出比
    cart_cnt        REAL,    -- 总购物车数
    cart_rate       REAL,
    collect_item_cnt REAL,
    collect_shop_cnt REAL,
    total_collect_cart REAL,
    placed_orders   REAL,    -- 拍下订单笔数（你之前说的 GMV 定义=下单金额可以用这个）
    placed_amount   REAL,    -- 拍下订单金额
    guided_visits   REAL,
    guided_visitors REAL,
    new_buyers      REAL,    -- 成交新客数
    new_pct         REAL,    -- 成交新客占比
    natural_gmv     REAL,
    natural_impressions REAL,
    source_file     TEXT,
    loaded_at       TIMESTAMPTZ DEFAULT now(),
    UNIQUE(stat_date, scene_id, sub_scene_id)
);
CREATE INDEX IF NOT EXISTS idx_wxst_scene_date ON fact_wxst_scene(stat_date);

-- 7. 无限店铺流量
CREATE TABLE IF NOT EXISTS fact_traffic (
    id                SERIAL PRIMARY KEY,
    stat_date         TEXT NOT NULL,
    source_l1         TEXT DEFAULT '',
    source_l2         TEXT DEFAULT '',
    source_l3         TEXT DEFAULT '',
    source_l4         TEXT DEFAULT '',
    visitors          REAL,
    product_visitors  REAL,
    pay_buyers        REAL,
    product_pv        REAL,
    collect_buyers    REAL,
    cart_users        REAL,
    all_traffic       REAL,
    product_traffic   REAL,
    shop_traffic      REAL,
    live_traffic      REAL,
    content_traffic   REAL,
    source_file       TEXT,
    loaded_at         TIMESTAMPTZ DEFAULT now(),
    UNIQUE(stat_date, source_l1, source_l2, source_l3, source_l4)
);

-- 8. 付费推广手动录入
CREATE TABLE IF NOT EXISTS fact_paid_promo (
    id                  SERIAL PRIMARY KEY,
    stat_date           TEXT NOT NULL,
    promo_type          TEXT NOT NULL,
    dimension_name      TEXT NOT NULL,
    product_id          TEXT,
    visitors            REAL,
    visitors_wow        REAL,
    view_3s_users       REAL,
    product_click_users REAL,
    cart_users          REAL,
    pay_buyers          REAL,
    pay_amount          REAL,
    loaded_at           TIMESTAMPTZ DEFAULT now(),
    UNIQUE(stat_date, promo_type, dimension_name)
);

-- 9. 小红书笔记
CREATE TABLE IF NOT EXISTS fact_xhs_note (
    id            SERIAL PRIMARY KEY,
    note_title    TEXT NOT NULL,
    note_url      TEXT UNIQUE,
    publish_time  TEXT,
    author        TEXT,
    likes         INTEGER DEFAULT 0,
    collects      INTEGER DEFAULT 0,
    shares        INTEGER DEFAULT 0,
    comments      INTEGER DEFAULT 0,
    reads         INTEGER DEFAULT 0,
    loaded_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fact_xhs_note_product (
    id              SERIAL PRIMARY KEY,
    note_id         INTEGER NOT NULL REFERENCES fact_xhs_note(id),
    product_id      TEXT NOT NULL,
    product_mention TEXT,
    UNIQUE (note_id, product_id)
);

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'viewer',
    permissions   JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- 会议纪要
CREATE TABLE IF NOT EXISTS meeting_notes (
    id               SERIAL PRIMARY KEY,
    week_label       TEXT,
    meeting_date     TEXT,
    title            TEXT,
    content          TEXT,
    important_level  TEXT DEFAULT 'normal',
    created_by_name  TEXT DEFAULT '',
    created_at       TIMESTAMPTZ DEFAULT now()
);

-- 任务
CREATE TABLE IF NOT EXISTS tasks (
    id               SERIAL PRIMARY KEY,
    product_id       TEXT,
    detail           TEXT,
    owner            TEXT DEFAULT '',
    status           TEXT DEFAULT '待开始',
    priority         TEXT DEFAULT '中',
    category         TEXT DEFAULT '',
    time_range_label TEXT DEFAULT '',
    execution_note   TEXT DEFAULT '',
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);

-- 页面访问统计
CREATE TABLE IF NOT EXISTS page_views (
    id               SERIAL PRIMARY KEY,
    page_path        TEXT NOT NULL,
    username         TEXT NOT NULL DEFAULT '',
    opened_at        TIMESTAMPTZ DEFAULT now(),
    duration_seconds INT DEFAULT 0
);

-- 人群推广商品报表（人群渠道下各商品花费）
CREATE TABLE IF NOT EXISTS fact_wxst_rq_product (
    id           SERIAL PRIMARY KEY,
    stat_date    TEXT NOT NULL,
    product_id   TEXT NOT NULL,
    spend        REAL DEFAULT 0,
    impressions  REAL DEFAULT 0,
    ctr          REAL DEFAULT 0,
    roi          REAL DEFAULT 0,
    total_gmv    REAL DEFAULT 0,
    source_file  TEXT,
    loaded_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE(stat_date, product_id)
);

-- 关键词商品报表（关键词渠道下各商品花费）
CREATE TABLE IF NOT EXISTS fact_wxst_kw_product (
    id           SERIAL PRIMARY KEY,
    stat_date    TEXT NOT NULL,
    product_id   TEXT NOT NULL,
    spend        REAL DEFAULT 0,
    impressions  REAL DEFAULT 0,
    ctr          REAL DEFAULT 0,
    roi          REAL DEFAULT 0,
    total_gmv    REAL DEFAULT 0,
    source_file  TEXT,
    loaded_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE(stat_date, product_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_syzt_date    ON fact_syzt_product(stat_date);
CREATE INDEX IF NOT EXISTS idx_syzt_pid     ON fact_syzt_product(product_id);
CREATE INDEX IF NOT EXISTS idx_wxst_date    ON fact_wxst_product(stat_date);
CREATE INDEX IF NOT EXISTS idx_wxst_pid     ON fact_wxst_product(product_id);
CREATE INDEX IF NOT EXISTS idx_aud_date     ON fact_wxst_audience(stat_date);
CREATE INDEX IF NOT EXISTS idx_kw_date      ON fact_wxst_keyword(stat_date);
CREATE INDEX IF NOT EXISTS idx_tr_date      ON fact_traffic(stat_date);
CREATE INDEX IF NOT EXISTS idx_paid_date    ON fact_paid_promo(stat_date);
CREATE INDEX IF NOT EXISTS idx_xhs_time     ON fact_xhs_note(publish_time);
CREATE INDEX IF NOT EXISTS idx_product_spu  ON dim_product(spu_id);
CREATE INDEX IF NOT EXISTS idx_rq_date  ON fact_wxst_rq_product(stat_date);
CREATE INDEX IF NOT EXISTS idx_kw_date  ON fact_wxst_kw_product(stat_date);
