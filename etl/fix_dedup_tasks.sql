-- ════════════════════════════════════════════════════════════════
-- 修复 bootstrap_recovery.sql 第 3 步报 23505 错误
-- 原因：tasks 表里已有重复行(product_id+time_range_label+detail+owner)，
--       导致 UNIQUE 约束建不上
-- 操作：先去重 → 再建约束 → 然后回去 Neon Console 重跑 bootstrap_recovery.sql
-- ════════════════════════════════════════════════════════════════

-- ── Step 1：先看看有哪些重复（让你心里有数，不删任何东西）──
SELECT product_id, time_range_label, detail, owner, COUNT(*) AS dup_count
FROM tasks
GROUP BY product_id, time_range_label, detail, owner
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, product_id
LIMIT 50;


-- ── Step 2：去重，每组重复保留 1 条 ──
-- 优先级：
--   1) execution_note 非空（有人填过备注的）优先
--   2) status 不是"待开始"或"—"（已经动过的）优先
--   3) id 最小（最早的）保底
-- 不符合上述优先级的同组其它行删除
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY product_id, time_range_label, detail, owner
               ORDER BY
                   (CASE WHEN COALESCE(execution_note,'') <> '' THEN 0 ELSE 1 END),
                   (CASE WHEN status NOT IN ('待开始','—','','pending') THEN 0 ELSE 1 END),
                   id ASC
           ) AS rn
    FROM tasks
)
DELETE FROM tasks
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);


-- ── Step 3：现在可以建唯一约束了 ──
ALTER TABLE tasks
    ADD CONSTRAINT tasks_unique_dim
    UNIQUE (product_id, time_range_label, detail, owner);


-- ── Step 4：校验 ──
SELECT
    COUNT(*) AS 总任务数,
    COUNT(*) FILTER (WHERE owner = '晓东（运营）')   AS 晓东_任务,
    COUNT(*) FILTER (WHERE owner = '豆豆（设计）')   AS 豆豆_任务,
    COUNT(*) FILTER (WHERE owner = '刘婷（商品）')   AS 刘婷_任务,
    COUNT(*) FILTER (WHERE owner = 'Jas team（内容）') AS Jas_任务,
    COUNT(DISTINCT product_id)                        AS 涉及商品数,
    COUNT(DISTINCT time_range_label)                  AS 涉及周期数
FROM tasks;
