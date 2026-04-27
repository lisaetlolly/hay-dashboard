 -- ════════════════════════════════════════════════════════════════
-- 清理 users 表的历史残留 + 任务 owner 字段大小写/格式不一致
-- 目标：从 12 个用户减到 8 个（我们认证的版本），任务 owner 全部对齐到新版命名
-- ════════════════════════════════════════════════════════════════

-- ── Step 1：先看一下任务表里都有哪些 owner（确认要不要重命名）──
SELECT DISTINCT owner, COUNT(*) AS task_count
FROM tasks
GROUP BY owner
ORDER BY owner;


-- ── Step 2：把历史 owner 写法统一成新版 ──
-- 旧→新映射（注意 display_name 里的全角括号 vs 半角括号、空格、是否带"team"等差别）
UPDATE tasks SET owner = 'Jas team（内容）'
 WHERE owner IN ('Jas（内容）', 'Jas (内容)', 'Jas team （内容）', 'Jas');

UPDATE tasks SET owner = '刘婷（商品）'
 WHERE owner IN ('Liuting（商品）', '刘婷 （商品）', 'Liuting');

UPDATE tasks SET owner = 'HAY（客户只读）'
 WHERE owner IN ('HAY', 'HAY客户');

-- 不需要改的（这些已经是标准写法）：
-- '晓东（运营）', '豆豆（设计）', '系统管理员', '声超（老板）', '婉婷（主管）'


-- ── Step 3：删除历史残留用户（保留我们 bootstrap 那 8 个）──
DELETE FROM users WHERE id IN (
    1,    -- "+1" 测试账号
    6,    -- "Jas" 旧版（已被 id=103 "jas" 替换）
    7,    -- "Liuting" 旧版（已被 id=105 "liuting" 替换）
    8     -- "HAY" 旧版（已被 id=106 "hay" 替换）
);


-- ── Step 4：校验 ──
SELECT id, username, display_name, role, created_at
FROM users ORDER BY id;
-- 应该剩 8 行：admin / xiaodong / doudou / shengchao / wanting / jas / liuting / hay

-- 任务 owner 分布
SELECT owner, COUNT(*) AS task_count
FROM tasks
GROUP BY owner
ORDER BY task_count DESC;
-- 应该只看到这几种 owner：晓东（运营）/ 豆豆（设计）/ 刘婷（商品）/ Jas team（内容）

-- 没人认领的孤儿任务（owner 不在 users.display_name 里）
SELECT t.id, t.product_id, t.detail, t.owner
FROM tasks t
LEFT JOIN users u ON u.display_name = t.owner
WHERE u.id IS NULL
LIMIT 20;
-- 期望：0 行；如果有，说明还有 owner 字符串没归一化，跑一遍把这些字符串补到 Step 2 的 UPDATE 里
