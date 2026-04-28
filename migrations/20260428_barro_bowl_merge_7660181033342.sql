-- ===========================================================================
-- Barro Bowl 第三个 PID 合并：7660181033342（ends in 2，有 116 行真实数据）
--   → 全部合并到 1020815058332
-- ===========================================================================

BEGIN;

-- 1. fact_syzt_product 合并
UPDATE fact_syzt_product s
SET pay_amount     = s.pay_amount     + COALESCE(old.pay_amount, 0),
    visitors       = s.visitors       + COALESCE(old.visitors, 0),
    cart_users     = s.cart_users     + COALESCE(old.cart_users, 0),
    pay_new_buyers = s.pay_new_buyers + COALESCE(old.pay_new_buyers, 0),
    pay_old_buyers = s.pay_old_buyers + COALESCE(old.pay_old_buyers, 0)
FROM (SELECT * FROM fact_syzt_product WHERE product_id = '7660181033342') old
WHERE s.product_id = '1020815058332' AND s.stat_date = old.stat_date;

DELETE FROM fact_syzt_product WHERE product_id = '7660181033342'
  AND stat_date IN (SELECT stat_date FROM fact_syzt_product WHERE product_id = '1020815058332');

UPDATE fact_syzt_product SET product_id = '1020815058332' WHERE product_id = '7660181033342';

-- 2. fact_wxst_product 合并
UPDATE fact_wxst_product w
SET spend       = w.spend       + COALESCE(old.spend, 0),
    impressions = w.impressions + COALESCE(old.impressions, 0),
    clicks      = w.clicks      + COALESCE(old.clicks, 0)
FROM (SELECT * FROM fact_wxst_product WHERE product_id = '7660181033342') old
WHERE w.product_id = '1020815058332' AND w.stat_date = old.stat_date;

DELETE FROM fact_wxst_product WHERE product_id = '7660181033342'
  AND stat_date IN (SELECT stat_date FROM fact_wxst_product WHERE product_id = '1020815058332');

UPDATE fact_wxst_product SET product_id = '1020815058332' WHERE product_id = '7660181033342';

-- 3. tasks 合并（同 cat+detail 重复的去重）
DELETE FROM tasks t1 USING tasks t2
WHERE t1.product_id = '7660181033342'
  AND t2.product_id = '1020815058332'
  AND COALESCE(t1.time_range_label,'') = COALESCE(t2.time_range_label,'')
  AND COALESCE(t1.category,'') = COALESCE(t2.category,'')
  AND COALESCE(t1.detail,'')   = COALESCE(t2.detail,'');
UPDATE tasks SET product_id = '1020815058332' WHERE product_id = '7660181033342';

-- 4. dim_product 清掉旧的（如有）
DELETE FROM dim_product WHERE product_id = '7660181033342';

COMMIT;

-- 验证：1020815058332 应当继承了所有数据
SELECT 'tasks',        COUNT(*) FROM tasks            WHERE product_id = '1020815058332'
UNION ALL
SELECT 'syzt 行数',    COUNT(*) FROM fact_syzt_product WHERE product_id = '1020815058332'
UNION ALL
SELECT 'syzt 上周GMV', SUM(pay_amount)::int FROM fact_syzt_product
   WHERE product_id = '1020815058332' AND stat_date BETWEEN '2026-04-20' AND '2026-04-26'
UNION ALL
SELECT 'wxst 行数',    COUNT(*) FROM fact_wxst_product WHERE product_id = '1020815058332'
UNION ALL
SELECT '7660181033342 残留', COUNT(*) FROM fact_syzt_product WHERE product_id = '7660181033342';
