-- ===========================================================================
-- 紧急修：Grid Bag (1020175879777) 只保留你要的 4 条任务，删掉其它 5 条 + 写入 hidden
-- ===========================================================================

BEGIN;

-- 兜底建表
CREATE TABLE IF NOT EXISTS task_hidden (
  product_id TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  hidden_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (product_id, category, detail)
);

-- 1. 把 Grid Bag 不在保留名单里的所有任务，写入 hidden
INSERT INTO task_hidden (product_id, category, detail)
SELECT DISTINCT '1020175879777', category, detail
FROM tasks
WHERE product_id = '1020175879777'
  AND NOT (
    (category = '标题优化'   AND detail = '结合小红书/淘宝热搜词，优化链接标题') OR
    (category = '详情页优化' AND detail LIKE '迭代初版详情页%') OR
    (category = '竞品分析'   AND detail = '竞品动作关注、价格策略调整') OR
    (category = '售卖复盘'   AND detail = '对流量、收藏加购情况做分析')
  )
ON CONFLICT DO NOTHING;

-- 2. 删除 Grid Bag 不在保留名单里的所有任务
DELETE FROM tasks
WHERE product_id = '1020175879777'
  AND NOT (
    (category = '标题优化'   AND detail = '结合小红书/淘宝热搜词，优化链接标题') OR
    (category = '详情页优化' AND detail LIKE '迭代初版详情页%') OR
    (category = '竞品分析'   AND detail = '竞品动作关注、价格策略调整') OR
    (category = '售卖复盘'   AND detail = '对流量、收藏加购情况做分析')
  );

COMMIT;

-- 验证：Grid Bag 只剩 4 条
SELECT id, category, LEFT(detail, 30) AS detail_preview, status, time_range_label
FROM tasks WHERE product_id = '1020175879777'
ORDER BY category, detail;

-- 验证：Grid Bag hidden 表里有 5 条（防止下次 backfill 又加回来）
SELECT category, detail FROM task_hidden WHERE product_id = '1020175879777';
