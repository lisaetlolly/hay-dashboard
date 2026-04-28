-- ===========================================================================
-- 投放面板-团队 大改：4.27-30 周期数据修正 + 任务组 + 多负责人 + 不在 25 单品的扩展商品支持
-- 在 Render Dashboard → Database → SQL Editor 执行
-- ===========================================================================

BEGIN;

-- 1. tasks 表新字段：default_owners (一个任务配置可指定多负责人，发布时挑一个)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS eta_date DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 2. task_template 加多负责人列（一个任务配置可指派一个或多个固定负责人）
ALTER TABLE task_template ADD COLUMN IF NOT EXISTS default_owners TEXT[];
-- 把现有 default_owner 同步到新数组
UPDATE task_template SET default_owners = ARRAY[default_owner]
WHERE default_owners IS NULL AND default_owner IS NOT NULL;

-- 3. 任务组 task_group + task_group_member
CREATE TABLE IF NOT EXISTS task_group (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  is_default  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_group_member (
  group_id    INT NOT NULL REFERENCES task_group(id) ON DELETE CASCADE,
  template_id INT NOT NULL REFERENCES task_template(id) ON DELETE CASCADE,
  sort_order  INT DEFAULT 0,
  PRIMARY KEY (group_id, template_id)
);

-- 默认任务组：包含现有 9 个 active 模板
INSERT INTO task_group (name, is_default)
VALUES ('默认任务组', TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO task_group_member (group_id, template_id, sort_order)
SELECT (SELECT id FROM task_group WHERE name = '默认任务组'),
       t.id, t.sort_order
FROM task_template t
WHERE t.is_active = TRUE
ON CONFLICT DO NOTHING;

-- 4. 4.27-30 周期数据修正
-- · Colour Crate (679198301351), Basket (580467335137), Slice Chopping Board (781547798998)
--   → status='进行中', start_date='2026-04-27', eta_date='2026-04-30'
UPDATE tasks
SET status = '进行中',
    start_date = '2026-04-27',
    eta_date   = '2026-04-30',
    updated_at = now()
WHERE time_range_label = '4.27-30'
  AND product_id IN ('679198301351', '580467335137', '781547798998');

-- · 其他商品在 4.27-30 周期：保持现状（已完成的不动；其它默认待开始即可）
-- 保险：所有还没有 start/eta 但属于这一周期的，给个周期默认起止
UPDATE tasks
SET start_date = '2026-04-27',
    eta_date   = '2026-04-30',
    updated_at = now()
WHERE time_range_label = '4.27-30'
  AND start_date IS NULL
  AND eta_date IS NULL;

-- 5. tasks 唯一约束：(product_id, time_range_label, category, detail) — 用于"重复发布覆盖"逻辑
-- 已有 tasks_unique_dim 约束的话跳过
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_unique_pid_period_cat_det'
  ) THEN
    -- 为了 ON CONFLICT 落地：先删可能存在的真重复（保留最新一条）
    DELETE FROM tasks t1
    USING tasks t2
    WHERE t1.id < t2.id
      AND t1.product_id = t2.product_id
      AND COALESCE(t1.time_range_label,'') = COALESCE(t2.time_range_label,'')
      AND COALESCE(t1.category,'')         = COALESCE(t2.category,'')
      AND COALESCE(t1.detail,'')           = COALESCE(t2.detail,'');
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_unique_pid_period_cat_det
      UNIQUE (product_id, time_range_label, category, detail);
  END IF;
END$$;

COMMIT;

-- 验证
SELECT '修正后的 4.27-30 任务（应当 27 条 = 3 商品 × 9 任务）' AS info;
SELECT product_id, COUNT(*) AS task_count, MIN(status) AS sample_status
FROM tasks WHERE time_range_label='4.27-30'
  AND product_id IN ('679198301351','580467335137','781547798998')
GROUP BY product_id;

SELECT '任务组列表' AS info;
SELECT g.name, g.is_default, COUNT(m.template_id) AS template_count
FROM task_group g LEFT JOIN task_group_member m ON m.group_id = g.id
GROUP BY g.id, g.name, g.is_default ORDER BY g.id;
