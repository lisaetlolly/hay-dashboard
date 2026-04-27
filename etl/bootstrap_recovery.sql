-- ════════════════════════════════════════════════════════════════
-- HAY Dashboard — 一键恢复脚本
-- 用途：在 Neon Console 直接执行，建用户 + 灌 4.27-4.30 周任务
-- 执行：复制本文件全部内容到 Neon SQL Editor → Run
-- 幂等：可多次执行（用 ON CONFLICT 防重复插入）
-- ════════════════════════════════════════════════════════════════

-- ── 1. 确保表存在（生产已有则跳过）──
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'viewer',
    permissions   JSONB NOT NULL DEFAULT '{}',
    preferences   JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ DEFAULT now()
);

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

-- 加唯一约束防止任务重复插入（按 商品+周期+任务详情+负责人 唯一）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tasks_unique_dim'
    ) THEN
        ALTER TABLE tasks ADD CONSTRAINT tasks_unique_dim
            UNIQUE (product_id, time_range_label, detail, owner);
    END IF;
END$$;

-- ── 任务模板表 ────────────────────────────────────────────
-- 9 个固定任务模板。员工换人时改 default_owner 一行 →
-- 通过 GUI "重新指派" 按钮把该模板下所有未来周的任务批量改 owner。
-- 历史任务保持原 owner 不变，避免复盘时混淆。
CREATE TABLE IF NOT EXISTS task_template (
    id            SERIAL PRIMARY KEY,
    category      TEXT NOT NULL,
    detail        TEXT NOT NULL,
    default_owner TEXT NOT NULL,
    sort_order    INT  DEFAULT 100,
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (category, detail)
);

-- 任务表加 template_id 外键（关联到模板）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS template_id INT REFERENCES task_template(id);

-- 任务周期表（让前端日历筛选可用）
CREATE TABLE IF NOT EXISTS task_period (
    id            SERIAL PRIMARY KEY,
    label         TEXT UNIQUE NOT NULL,   -- '2026-04-27~2026-04-30'
    start_date    DATE NOT NULL,
    end_date      DATE NOT NULL,
    is_current    BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMPTZ DEFAULT now()
);


-- ════════════════════════════════════════════════════════════════
-- 2. 用户账号（密码 = sha256('hay2026')，登录后建议改）
-- ════════════════════════════════════════════════════════════════
-- sha256('hay2026') = '84d3457b1b68ed4ca4afec84db7c6dd6e78a16487ffdf687a70e14f87e96a1f9'

INSERT INTO users (username, password_hash, display_name, role, permissions) VALUES
    ('admin',    '84d3457b1b68ed4ca4afec84db7c6dd6e78a16487ffdf687a70e14f87e96a1f9', '系统管理员',     'admin',  '["*"]'::jsonb),
    ('xiaodong', '84d3457b1b68ed4ca4afec84db7c6dd6e78a16487ffdf687a70e14f87e96a1f9', '晓东（店长）',   'admin',  '["*"]'::jsonb),
    ('shengchao','84d3457b1b68ed4ca4afec84db7c6dd6e78a16487ffdf687a70e14f87e96a1f9', '声超（老板）',   'admin',  '["*"]'::jsonb),
    ('wanting',  '84d3457b1b68ed4ca4afec84db7c6dd6e78a16487ffdf687a70e14f87e96a1f9', '婉婷（主管）',   'admin',  '["*"]'::jsonb),
    ('jas',      '84d3457b1b68ed4ca4afec84db7c6dd6e78a16487ffdf687a70e14f87e96a1f9', 'Jas team（内容）','member', '["task.view_all","task.edit_own","task.view_own","action.view","meeting.view","metric.view","product.view"]'::jsonb),
    ('doudou',   '84d3457b1b68ed4ca4afec84db7c6dd6e78a16487ffdf687a70e14f87e96a1f9', '豆豆（设计）',   'member', '["task.view_all","task.edit_own","task.view_own","action.view","meeting.view","metric.view","product.view"]'::jsonb),
    ('liuting',  '84d3457b1b68ed4ca4afec84db7c6dd6e78a16487ffdf687a70e14f87e96a1f9', '刘婷（商品）',   'member', '["task.view_all","task.edit_own","task.view_own","action.view","meeting.view","metric.view","product.view"]'::jsonb),
    ('hay',      '84d3457b1b68ed4ca4afec84db7c6dd6e78a16487ffdf687a70e14f87e96a1f9', 'HAY（客户只读）','viewer', '["task.view_all","action.view","meeting.view","metric.view","product.view"]'::jsonb)
ON CONFLICT (username) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    role         = EXCLUDED.role,
    permissions  = EXCLUDED.permissions;


-- ════════════════════════════════════════════════════════════════
-- 3. 9 个任务模板（固定结构：category × detail × owner）
--    后续员工换人 → 只改 default_owner 一行即可
-- ════════════════════════════════════════════════════════════════
INSERT INTO task_template (category, detail, default_owner, sort_order) VALUES
    ('标题优化',      '结合小红书/淘宝热搜词，优化链接标题',           'Jas team（内容）', 10),
    ('评价与问大家',  '梳理每个链接中差评（如有），分类问题',           'Jas team（内容）', 20),
    ('评价与问大家',  '针对共性问题，制作3条带图/视频好评进行覆盖',     'Jas team（内容）', 30),
    ('评价与问大家',  '优化问大家回复',                                 'Jas team（内容）', 40),
    ('淘内内容宣发',  '光合内容制作、上线',                             'Jas team（内容）', 50),
    ('详情页优化',    '迭代初版详情页',                                 '豆豆（设计）',     60),
    ('竞品分析',      '竞品动作关注、价格策略调整',                     '刘婷（商品）',     70),
    ('妈妈计划迭代',  '确认推广金额及提出素材需求',                     '晓东（运营）',     80),
    ('售卖复盘',      '对流量、收藏加购情况做分析',                     '晓东（运营）',     90)
ON CONFLICT (category, detail) DO UPDATE SET
    default_owner = EXCLUDED.default_owner,
    sort_order    = EXCLUDED.sort_order,
    updated_at    = now();

-- ── 人群投放品类计划（晓东设的目标比例，admin 在设置页可改）──
-- 默认值：家具 63% / 配饰 30% / 灯具 5% / 其他 2%
-- 注：之前代码里的 73.1% 是历史"人群vs关键词"比例，跟这张表无关，已废弃
CREATE TABLE IF NOT EXISTS category_audience_plan (
    category    TEXT PRIMARY KEY,
    plan_pct    REAL NOT NULL,
    sort_order  INT  DEFAULT 100,
    updated_at  TIMESTAMPTZ DEFAULT now(),
    updated_by  TEXT DEFAULT ''
);

INSERT INTO category_audience_plan (category, plan_pct, sort_order) VALUES
    ('家具', 63.0, 10),
    ('配饰', 30.0, 20),
    ('灯具',  5.0, 30),
    ('其他',  2.0, 40)
ON CONFLICT (category) DO UPDATE SET
    plan_pct = EXCLUDED.plan_pct,
    sort_order = EXCLUDED.sort_order;

-- ── 内容报表（短视频）事实表 ──
CREATE TABLE IF NOT EXISTS fact_wxst_content (
    id                    SERIAL PRIMARY KEY,
    stat_date             TEXT NOT NULL,
    content_id            TEXT NOT NULL,           -- 主体ID = 视频ID
    content_type          TEXT,                    -- 短视频 / 直播 / 图文
    content_name          TEXT,                    -- 视频标题
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
    total_collect_cart    REAL,
    guided_visits         REAL,
    new_buyers            REAL,
    transaction_buyers    REAL,
    source_file           TEXT,
    loaded_at             TIMESTAMPTZ DEFAULT now(),
    UNIQUE(stat_date, content_id, content_type)
);

CREATE INDEX IF NOT EXISTS idx_content_date ON fact_wxst_content(stat_date);
CREATE INDEX IF NOT EXISTS idx_content_type ON fact_wxst_content(content_type);

-- ── 任务周期录入 ──
INSERT INTO task_period (label, start_date, end_date, is_current) VALUES
    ('2026-03-23~2026-03-29', '2026-03-23', '2026-03-29', FALSE),
    ('2026-03-30~2026-04-05', '2026-03-30', '2026-04-05', FALSE),
    ('2026-04-06~2026-04-12', '2026-04-06', '2026-04-12', FALSE),
    ('2026-04-13~2026-04-19', '2026-04-13', '2026-04-19', FALSE),
    ('2026-04-20~2026-04-26', '2026-04-20', '2026-04-26', FALSE),
    ('2026-04-27~2026-04-30', '2026-04-27', '2026-04-30', TRUE)
ON CONFLICT (label) DO UPDATE SET
    is_current = EXCLUDED.is_current;

-- 当只有一个周期 is_current=TRUE，确保唯一
UPDATE task_period SET is_current = FALSE
 WHERE label != '2026-04-27~2026-04-30';


-- ════════════════════════════════════════════════════════════════
-- 4. 4.27-4.30 周任务批量录入
--    4 个商品 × 9 个任务模板 = 36 条
--    商品：Colour Crate / Cotton Bag / Korpus / Barro
--    注：tasks.template_id 自动关联到 task_template，员工换人时
--        UPDATE task_template SET default_owner='新人' WHERE id=X;
--        UPDATE tasks SET owner=（新人）WHERE template_id=X AND time_range_label IN (...);
-- ════════════════════════════════════════════════════════════════

-- 4 商品 × 9 模板 = 36 条任务，CROSS JOIN 一次写入
WITH product_list(product_id, product_label) AS (
    VALUES
        ('679198301351',  'Colour Crate 收纳篮'),
        ('564552361178',  'Cotton Bag 帆布包'),
        ('682036237751',  'Korpus 置物架'),
        ('1020815058332', 'Barro Bowl & Plate 碗盘')
)
INSERT INTO tasks (product_id, detail, owner, category, time_range_label, status, priority, template_id)
SELECT
    p.product_id,
    t.detail,
    t.default_owner,
    t.category,
    '2026-04-27~2026-04-30',
    '待开始',
    '中',
    t.id
FROM product_list p CROSS JOIN task_template t
WHERE t.is_active = TRUE
ON CONFLICT ON CONSTRAINT tasks_unique_dim DO NOTHING;


-- ════════════════════════════════════════════════════════════════
-- 5. 校验
-- ════════════════════════════════════════════════════════════════

-- 用户清单
SELECT id, username, display_name, role, jsonb_pretty(permissions) AS perms
FROM users ORDER BY id;

-- 4.27-4.30 周新增任务清单
SELECT product_id, category, detail, owner, status
FROM tasks
WHERE time_range_label = '2026-04-27~2026-04-30'
ORDER BY product_id, category;

-- 任务总数（含历史）
SELECT
    COUNT(*) AS 总任务,
    COUNT(*) FILTER (WHERE time_range_label = '2026-04-27~2026-04-30') AS 本周任务,
    COUNT(DISTINCT owner) AS 涉及负责人数,
    COUNT(DISTINCT product_id) AS 涉及商品数
FROM tasks;
