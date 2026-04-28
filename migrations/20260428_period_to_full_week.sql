-- ===========================================================================
-- task_period 范围统一改成完整周一-周日（Mon-Sun）
-- 之前 "4.20-22"（只 3 天）/ "4.27-30"（只 4 天）会导致 metrics 漏掉那几天的数据
-- 跑这个之前先确认前两个 migration 已经成功
-- ===========================================================================

BEGIN;

-- 工具函数：给一个日期，返回它所在 Mon-Sun 周的 Mon 和 Sun
-- (Postgres date_trunc('week') 返回的是 ISO 周一)
DO $$
DECLARE
  rec RECORD;
  mon DATE;
  sun DATE;
  new_label TEXT;
BEGIN
  FOR rec IN SELECT id, label, start_date, end_date FROM task_period LOOP
    -- 用 start_date 推出 Mon-Sun 完整周
    mon := date_trunc('week', rec.start_date)::date;  -- Mon
    sun := mon + 6;                                    -- Sun
    -- 新 label：4.20-26 / 4.27-5.3 这种格式
    IF EXTRACT(MONTH FROM mon) = EXTRACT(MONTH FROM sun) THEN
      new_label := EXTRACT(MONTH FROM mon)::text || '.' || EXTRACT(DAY FROM mon)::text || '-' || EXTRACT(DAY FROM sun)::text;
    ELSE
      new_label := EXTRACT(MONTH FROM mon)::text || '.' || EXTRACT(DAY FROM mon)::text || '-' || EXTRACT(MONTH FROM sun)::text || '.' || EXTRACT(DAY FROM sun)::text;
    END IF;

    -- 同时把 tasks 表里 time_range_label 跟着改
    -- 但要小心：如果新 label 已经在 task_period 里存在（如 "4.20-26" 既有了又要从 "4.20-22" 改过来）
    -- → 先合并 tasks，再改 period
    IF EXISTS (SELECT 1 FROM task_period WHERE label = new_label AND id <> rec.id) THEN
      -- 合并：把当前 period 的 tasks 改 label 到目标 period
      UPDATE tasks SET time_range_label = new_label WHERE time_range_label = rec.label;
      -- 删当前 period（因为目标已存在）
      DELETE FROM task_period WHERE id = rec.id;
    ELSE
      -- 直接更新当前 period
      UPDATE tasks SET time_range_label = new_label WHERE time_range_label = rec.label;
      UPDATE task_period
        SET label = new_label, start_date = mon, end_date = sun, updated_at = now()
        WHERE id = rec.id;
    END IF;
  END LOOP;
END$$;

COMMIT;

-- 验证
SELECT '所有 period 现在的范围（应当都是 7 天 Mon-Sun）' AS info;
SELECT id, label, start_date, end_date,
       end_date - start_date + 1 AS day_count,
       to_char(start_date, 'Dy') AS start_dow,
       to_char(end_date, 'Dy') AS end_dow
FROM task_period ORDER BY start_date;
