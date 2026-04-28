-- ===========================================================================
-- 给 25 主链商品都补齐 9 项标准任务（DB 里没的才插入；已有的保留状态/时间/备注）
-- 跳过 task_hidden 里被 admin 主动删过的（不"诈尸"）
-- 4 个扩展商品（Cotton Bag / Manolito / Paper Shade / PC Portable）不动
-- ===========================================================================

BEGIN;

-- 兜底：约束存在
CREATE UNIQUE INDEX IF NOT EXISTS tasks_unique_pid_period_cat_det_idx
  ON tasks (product_id, time_range_label, category, detail);

CREATE TABLE IF NOT EXISTS task_hidden (
  product_id TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  hidden_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (product_id, category, detail)
);

-- 给 25 主链补齐 4.20-26 周期的所有 active 模板任务
INSERT INTO tasks (product_id, detail, owner, category, time_range_label, status, priority, template_id, start_date, eta_date)
SELECT p.product_id, tpl.detail, tpl.default_owner, tpl.category,
       '4.20-26', '待开始', '中', tpl.id,
       NULL::date, NULL::date
FROM (VALUES
  ('1020175879777'),('580467335137'),('652664516885'),('975799789205'),('1020815058332'),
  ('717349639294'),('824946188993'),('824607518747'),('824882661931'),('742092260504'),
  ('682036237751'),('886839411718'),('880816460277'),('965048597796'),('888002957800'),
  ('1016294283167'),('737675603229'),('583134215392'),('781547798998'),('679198301351'),
  ('880120382310'),('690221882602'),('1022489092196'),('887041510904'),('689952405763')
) AS p(product_id)
CROSS JOIN task_template tpl
WHERE tpl.is_active = TRUE
  AND NOT EXISTS (   -- 跳过被主动删过的
    SELECT 1 FROM task_hidden h
    WHERE h.product_id = p.product_id
      AND h.category = tpl.category
      AND h.detail = tpl.detail
  )
ON CONFLICT (product_id, time_range_label, category, detail) DO NOTHING;

COMMIT;

-- 验证：每个 25 主链应当 ≥9 条任务（除非有 hidden）
SELECT p.product_id, COUNT(t.id) AS task_count
FROM (VALUES
  ('1020175879777'),('580467335137'),('652664516885'),('975799789205'),('1020815058332'),
  ('717349639294'),('824946188993'),('824607518747'),('824882661931'),('742092260504'),
  ('682036237751'),('886839411718'),('880816460277'),('965048597796'),('888002957800'),
  ('1016294283167'),('737675603229'),('583134215392'),('781547798998'),('679198301351'),
  ('880120382310'),('690221882602'),('1022489092196'),('887041510904'),('689952405763')
) AS p(product_id)
LEFT JOIN tasks t ON t.product_id = p.product_id
GROUP BY p.product_id
ORDER BY task_count, p.product_id;
