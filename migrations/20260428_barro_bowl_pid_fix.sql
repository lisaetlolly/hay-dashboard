-- ===========================================================================
-- Barro Bowl & Plate PID 改正：7660181033346（旧/typo） → 1020815058332（正确）
-- 在 Render Dashboard → Database → SQL Editor 执行
-- 跑这个之前先确认上一个 migration 已经成功
-- ===========================================================================

BEGIN;

-- 1. 先把旧 PID 的任务挪到新 PID（如果有同周期+同 detail 的会冲突，先清理）
DELETE FROM tasks t1
USING tasks t2
WHERE t1.product_id = '7660181033346'
  AND t2.product_id = '1020815058332'
  AND COALESCE(t1.time_range_label,'') = COALESCE(t2.time_range_label,'')
  AND COALESCE(t1.category,'')         = COALESCE(t2.category,'')
  AND COALESCE(t1.detail,'')           = COALESCE(t2.detail,'')
  AND t1.id < t2.id;

UPDATE tasks SET product_id = '1020815058332' WHERE product_id = '7660181033346';

-- 2. dim_product 把旧 PID 的记录关掉（如果存在）
UPDATE dim_product SET spu_id = '1020815058332' WHERE product_id = '7660181033346' AND spu_id = '7660181033346';

-- 3. 商品报表 fact_syzt_product 把旧 PID 的数据合并到新 PID
-- （如果两边都有同 stat_date 数据 → 加和）
UPDATE fact_syzt_product s
SET pay_amount = s.pay_amount + COALESCE(old.pay_amount, 0),
    visitors   = s.visitors   + COALESCE(old.visitors, 0),
    cart_users = s.cart_users + COALESCE(old.cart_users, 0)
FROM (SELECT * FROM fact_syzt_product WHERE product_id = '7660181033346') old
WHERE s.product_id = '1020815058332' AND s.stat_date = old.stat_date;

DELETE FROM fact_syzt_product WHERE product_id = '7660181033346'
  AND stat_date IN (SELECT stat_date FROM fact_syzt_product WHERE product_id = '1020815058332');

UPDATE fact_syzt_product SET product_id = '1020815058332' WHERE product_id = '7660181033346';

-- 推广报表也一样
UPDATE fact_wxst_product SET product_id = '1020815058332' WHERE product_id = '7660181033346';

COMMIT;

SELECT 'Barro Bowl 任务数（新 PID）' AS info, COUNT(*)
FROM tasks WHERE product_id = '1020815058332';

SELECT '旧 PID 是否清空' AS info, COUNT(*)
FROM tasks WHERE product_id = '7660181033346';
