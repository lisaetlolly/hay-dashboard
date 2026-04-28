-- ===========================================================================
-- Barro Bowl & Plate PID 改正 V2：彻底把 7660181033346 改成 1020815058332
-- 上一版漏改了 dim_product.product_id，导致 metrics SQL JOIN 不上 → 商品仍无数据
-- ===========================================================================

BEGIN;

-- 0. 先看 7660181033346 在 DB 里还残留多少
SELECT 'tasks 残留' AS table_, COUNT(*) FROM tasks WHERE product_id = '7660181033346'
UNION ALL
SELECT 'dim_product spu', COUNT(*) FROM dim_product WHERE spu_id = '7660181033346'
UNION ALL
SELECT 'dim_product pid', COUNT(*) FROM dim_product WHERE product_id = '7660181033346'
UNION ALL
SELECT 'fact_syzt 残留',  COUNT(*) FROM fact_syzt_product WHERE product_id = '7660181033346'
UNION ALL
SELECT 'fact_wxst 残留',  COUNT(*) FROM fact_wxst_product WHERE product_id = '7660181033346';

-- 1. fact_syzt_product 合并
UPDATE fact_syzt_product s
SET pay_amount       = s.pay_amount       + COALESCE(old.pay_amount, 0),
    visitors         = s.visitors         + COALESCE(old.visitors, 0),
    cart_users       = s.cart_users       + COALESCE(old.cart_users, 0),
    pay_new_buyers   = s.pay_new_buyers   + COALESCE(old.pay_new_buyers, 0),
    pay_old_buyers   = s.pay_old_buyers   + COALESCE(old.pay_old_buyers, 0)
FROM (SELECT * FROM fact_syzt_product WHERE product_id = '7660181033346') old
WHERE s.product_id = '1020815058332' AND s.stat_date = old.stat_date;

DELETE FROM fact_syzt_product WHERE product_id = '7660181033346'
  AND stat_date IN (SELECT stat_date FROM fact_syzt_product WHERE product_id = '1020815058332');

UPDATE fact_syzt_product SET product_id = '1020815058332' WHERE product_id = '7660181033346';

-- 2. fact_wxst_product 合并
UPDATE fact_wxst_product w
SET spend     = w.spend     + COALESCE(old.spend, 0),
    impressions = w.impressions + COALESCE(old.impressions, 0),
    clicks    = w.clicks    + COALESCE(old.clicks, 0)
FROM (SELECT * FROM fact_wxst_product WHERE product_id = '7660181033346') old
WHERE w.product_id = '1020815058332' AND w.stat_date = old.stat_date;

DELETE FROM fact_wxst_product WHERE product_id = '7660181033346'
  AND stat_date IN (SELECT stat_date FROM fact_wxst_product WHERE product_id = '1020815058332');

UPDATE fact_wxst_product SET product_id = '1020815058332' WHERE product_id = '7660181033346';

-- 3. tasks 合并（同 product+period+cat+detail 保留最新）
DELETE FROM tasks t1
USING tasks t2
WHERE t1.product_id = '7660181033346'
  AND t2.product_id = '1020815058332'
  AND COALESCE(t1.time_range_label,'') = COALESCE(t2.time_range_label,'')
  AND COALESCE(t1.category,'')         = COALESCE(t2.category,'')
  AND COALESCE(t1.detail,'')           = COALESCE(t2.detail,'');

UPDATE tasks SET product_id = '1020815058332' WHERE product_id = '7660181033346';

-- 4. dim_product 整理：
--    若 1020815058332 行不存在 → 把 7660181033346 行 product_id 改名（一并改 spu_id）
--    若都存在 → 删掉 7660181033346 行
DO $$
DECLARE has_new BOOLEAN; has_old BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM dim_product WHERE product_id = '1020815058332') INTO has_new;
  SELECT EXISTS (SELECT 1 FROM dim_product WHERE product_id = '7660181033346') INTO has_old;
  IF has_new AND has_old THEN
    DELETE FROM dim_product WHERE product_id = '7660181033346';
  ELSIF has_old AND NOT has_new THEN
    UPDATE dim_product SET product_id = '1020815058332', spu_id = '1020815058332'
      WHERE product_id = '7660181033346';
  END IF;
  -- 保险：1020815058332 的 spu_id 必须是 1020815058332 才能进入 OFFICIAL 25 的 metrics 查询
  UPDATE dim_product SET spu_id = '1020815058332'
    WHERE product_id = '1020815058332' AND (spu_id IS NULL OR spu_id <> '1020815058332');
END$$;

COMMIT;

-- 验证
SELECT 'Barro Bowl 关键表（应该全是 1020815058332）' AS info;
SELECT 'tasks',  COUNT(*) FROM tasks            WHERE product_id = '1020815058332'
UNION ALL
SELECT 'dim_product pid',   COUNT(*) FROM dim_product     WHERE product_id = '1020815058332'
UNION ALL
SELECT 'dim_product spu',   COUNT(*) FROM dim_product     WHERE spu_id     = '1020815058332'
UNION ALL
SELECT 'fact_syzt',         COUNT(*) FROM fact_syzt_product WHERE product_id = '1020815058332'
UNION ALL
SELECT 'fact_wxst',         COUNT(*) FROM fact_wxst_product WHERE product_id = '1020815058332';

SELECT 'Barro Bowl 残留旧 PID（应当全 0）' AS info;
SELECT 'tasks 残留',         COUNT(*) FROM tasks            WHERE product_id = '7660181033346'
UNION ALL
SELECT 'dim_product 残留',   COUNT(*) FROM dim_product     WHERE product_id = '7660181033346' OR spu_id = '7660181033346'
UNION ALL
SELECT 'fact_syzt 残留',     COUNT(*) FROM fact_syzt_product WHERE product_id = '7660181033346'
UNION ALL
SELECT 'fact_wxst 残留',     COUNT(*) FROM fact_wxst_product WHERE product_id = '7660181033346';
