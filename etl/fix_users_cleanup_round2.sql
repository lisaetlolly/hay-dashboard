-- ════════════════════════════════════════════════════════════════
-- 第二轮清理：补上 "Jas team" → "Jas team（内容）"
-- 然后看一下 87 个空 owner 任务长什么样
-- ════════════════════════════════════════════════════════════════

-- ── Step 1：把 "Jas team"（没有"（内容）"后缀的）归一化 ──
UPDATE tasks SET owner = 'Jas team（内容）'
 WHERE owner = 'Jas team';
-- 应该 UPDATE 19


-- ── Step 2：抽样看 87 个空 owner 任务的真相 ──
SELECT id, product_id, category, detail, status, time_range_label, execution_note
FROM tasks
WHERE owner IS NULL OR owner = ''
ORDER BY category, product_id
LIMIT 30;
-- 看 category + detail，能不能从 task_template 里反推 owner？


-- ── Step 3：能从 detail 反推 owner 的，自动归类 ──
-- 用 task_template 里的 default_owner 做匹配修复
UPDATE tasks t
SET owner = tpl.default_owner
FROM task_template tpl
WHERE (t.owner IS NULL OR t.owner = '')
  AND t.category = tpl.category
  AND t.detail   = tpl.detail;
-- 这一步应该把大部分空 owner 自动补上


-- ── Step 4：再看还有多少没救的（detail 跟模板对不上的）──
SELECT id, product_id, category, detail, status, time_range_label
FROM tasks
WHERE owner IS NULL OR owner = ''
ORDER BY category, product_id
LIMIT 30;


-- ── Step 5：汇总现在的 owner 分布 ──
SELECT owner, COUNT(*) AS task_count
FROM tasks
GROUP BY owner
ORDER BY task_count DESC;


-- ── Step 6：tasks 总览 ──
SELECT
    COUNT(*) AS 总任务,
    COUNT(*) FILTER (WHERE owner IS NULL OR owner = '') AS 仍空owner,
    COUNT(*) FILTER (WHERE time_range_label = '2026-04-27~2026-04-30') AS 本周任务,
    COUNT(DISTINCT owner) AS 涉及负责人数,
    COUNT(DISTINCT product_id) AS 涉及商品数,
    COUNT(DISTINCT time_range_label) AS 涉及周期数
FROM tasks;
