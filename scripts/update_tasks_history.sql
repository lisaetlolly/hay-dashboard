-- 把 A list sheet 4 个历史周期任务进度同步到 Neon
-- 周期: 3.23-29 / 3.30-4.5 / 4.6-12 / 4.13-19

-- ① 确保 4 个历史周期存在
INSERT INTO task_period (label, start_date, end_date, is_current) VALUES
  ('2026-03-23~2026-03-29','2026-03-23','2026-03-29',FALSE),
  ('2026-03-30~2026-04-05','2026-03-30','2026-04-05',FALSE),
  ('2026-04-06~2026-04-12','2026-04-06','2026-04-12',FALSE),
  ('2026-04-13~2026-04-19','2026-04-13','2026-04-19',FALSE)
ON CONFLICT (label) DO NOTHING;

-- ② 给 4 个历史周期 × 每个商品建 9 个模板任务（如果还没建过）
-- 涉及 6 个商品
WITH product_list(product_id) AS (VALUES
  ('1020175879777'),
  ('1021718193334'),
  ('717349639294'),
  ('737675603229'),
  ('824946188993'),
  ('965048597796')
)
INSERT INTO tasks (product_id, detail, owner, category, time_range_label, status, priority, template_id)
SELECT p.product_id, t.detail, t.default_owner, t.category, '2026-03-23~2026-03-29', '待开始', '中', t.id
FROM product_list p CROSS JOIN task_template t WHERE t.is_active = TRUE
ON CONFLICT ON CONSTRAINT tasks_unique_dim DO NOTHING;

WITH product_list(product_id) AS (VALUES
  ('1020175879777'),
  ('1021718193334'),
  ('717349639294'),
  ('737675603229'),
  ('824946188993'),
  ('965048597796')
)
INSERT INTO tasks (product_id, detail, owner, category, time_range_label, status, priority, template_id)
SELECT p.product_id, t.detail, t.default_owner, t.category, '2026-03-30~2026-04-05', '待开始', '中', t.id
FROM product_list p CROSS JOIN task_template t WHERE t.is_active = TRUE
ON CONFLICT ON CONSTRAINT tasks_unique_dim DO NOTHING;

WITH product_list(product_id) AS (VALUES
  ('1020175879777'),
  ('1021718193334'),
  ('717349639294'),
  ('737675603229'),
  ('824946188993'),
  ('965048597796')
)
INSERT INTO tasks (product_id, detail, owner, category, time_range_label, status, priority, template_id)
SELECT p.product_id, t.detail, t.default_owner, t.category, '2026-04-06~2026-04-12', '待开始', '中', t.id
FROM product_list p CROSS JOIN task_template t WHERE t.is_active = TRUE
ON CONFLICT ON CONSTRAINT tasks_unique_dim DO NOTHING;

WITH product_list(product_id) AS (VALUES
  ('1020175879777'),
  ('1021718193334'),
  ('717349639294'),
  ('737675603229'),
  ('824946188993'),
  ('965048597796')
)
INSERT INTO tasks (product_id, detail, owner, category, time_range_label, status, priority, template_id)
SELECT p.product_id, t.detail, t.default_owner, t.category, '2026-04-13~2026-04-19', '待开始', '中', t.id
FROM product_list p CROSS JOIN task_template t WHERE t.is_active = TRUE
ON CONFLICT ON CONSTRAINT tasks_unique_dim DO NOTHING;

-- ③ 更新每条任务的状态 + 备注（来自 Excel）
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '824946188993' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '结合小红书/淘宝热搜词，优化链接标题';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '824946188993' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '梳理每个链接中差评（如有），分类问题';
UPDATE tasks SET status = '待开始', execution_note = '待完成，先完成矮凳', updated_at = now()
  WHERE product_id = '824946188993' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '针对共性问题，制作3条带图/视频好评进行覆盖';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '824946188993' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '优化问大家回复';
UPDATE tasks SET status = '进行中', execution_note = '持续完成，每周至少一篇', updated_at = now()
  WHERE product_id = '824946188993' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '光合内容制作、上线';
UPDATE tasks SET status = '待开始', execution_note = '未完成，4.3出页面给品牌方，预估节后上，争取本周完成', updated_at = now()
  WHERE product_id = '824946188993' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '迭代初版详情页';
UPDATE tasks SET status = '进行中', execution_note = '持续完成，刘婷初版的竞品报告偏价格定位和功能，应该关注短期可落地的如首页排版和详情页卖点', updated_at = now()
  WHERE product_id = '824946188993' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '竞品动作关注、价格策略调整';
UPDATE tasks SET status = '进行中', execution_note = '【淘宝】大促价保 https://e.tb.cn/h.iJWqyeBpjrnfYd7?tk=8o6n5hYOfWi HU071 「至夏｜原创复古吧台凳咖啡馆吧凳中古实木高脚凳岛台凳实木家用凳」
点击链接直接打开 或者 淘宝搜索直接打开', updated_at = now()
  WHERE product_id = '824946188993' AND time_range_label = '2026-04-13~2026-04-19'
    AND detail = '竞品动作关注、价格策略调整';
UPDATE tasks SET status = '进行中', execution_note = '持续完成，素材不可加字，推广计划迭代中', updated_at = now()
  WHERE product_id = '824946188993' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '确认推广金额及提出素材需求';
UPDATE tasks SET status = '待开始', execution_note = '未完成，7天/14天之后各给一个初步结论', updated_at = now()
  WHERE product_id = '824946188993' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '对流量、收藏加购情况做分析';
UPDATE tasks SET status = '进行中', execution_note = '上升趋势，活动？', updated_at = now()
  WHERE product_id = '824946188993' AND time_range_label = '2026-04-06~2026-04-12'
    AND detail = '对流量、收藏加购情况做分析';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '717349639294' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '结合小红书/淘宝热搜词，优化链接标题';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '717349639294' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '梳理每个链接中差评（如有），分类问题';
UPDATE tasks SET status = '待开始', execution_note = '待完成，先完成矮凳', updated_at = now()
  WHERE product_id = '717349639294' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '针对共性问题，制作3条带图/视频好评进行覆盖';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '717349639294' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '优化问大家回复';
UPDATE tasks SET status = '进行中', execution_note = '持续完成，每周至少一篇', updated_at = now()
  WHERE product_id = '717349639294' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '光合内容制作、上线';
UPDATE tasks SET status = '待开始', execution_note = '未完成，4.3出页面给品牌方，预估节后上，争取本周完成', updated_at = now()
  WHERE product_id = '717349639294' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '迭代初版详情页';
UPDATE tasks SET status = '进行中', execution_note = '持续完成，刘婷初版的竞品报告偏价格定位和功能，应该关注短期可落地的如首页排版和详情页卖点', updated_at = now()
  WHERE product_id = '717349639294' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '竞品动作关注、价格策略调整';
UPDATE tasks SET status = '进行中', execution_note = '持续完成，素材不可加字，推广计划迭代中', updated_at = now()
  WHERE product_id = '717349639294' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '确认推广金额及提出素材需求';
UPDATE tasks SET status = '待开始', execution_note = '未完成，7天/14天之后各给一个初步结论', updated_at = now()
  WHERE product_id = '717349639294' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '对流量、收藏加购情况做分析';
UPDATE tasks SET status = '进行中', execution_note = '上升趋势，活动？', updated_at = now()
  WHERE product_id = '717349639294' AND time_range_label = '2026-04-06~2026-04-12'
    AND detail = '对流量、收藏加购情况做分析';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '737675603229' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '结合小红书/淘宝热搜词，优化链接标题';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '737675603229' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '梳理每个链接中差评（如有），分类问题';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '737675603229' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '针对共性问题，制作3条带图/视频好评进行覆盖';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '737675603229' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '优化问大家回复';
UPDATE tasks SET status = '进行中', execution_note = '持续完成，每周至少一篇', updated_at = now()
  WHERE product_id = '737675603229' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '光合内容制作、上线';
UPDATE tasks SET status = '待开始', execution_note = '未完成，4.3出页面给品牌方，预估节后上，争取本周完成', updated_at = now()
  WHERE product_id = '737675603229' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '迭代初版详情页';
UPDATE tasks SET status = '进行中', execution_note = '持续完成，刘婷初版的竞品报告偏价格定位和功能，应该关注短期可落地的如首页排版和详情页卖点', updated_at = now()
  WHERE product_id = '737675603229' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '竞品动作关注、价格策略调整';
UPDATE tasks SET status = '进行中', execution_note = '持续完成，素材不可加字，推广计划迭代中', updated_at = now()
  WHERE product_id = '737675603229' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '确认推广金额及提出素材需求';
UPDATE tasks SET status = '待开始', execution_note = '未完成，7天/14天之后各给一个初步结论', updated_at = now()
  WHERE product_id = '737675603229' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '对流量、收藏加购情况做分析';
UPDATE tasks SET status = '进行中', execution_note = '上升趋势，活动？', updated_at = now()
  WHERE product_id = '737675603229' AND time_range_label = '2026-04-06~2026-04-12'
    AND detail = '对流量、收藏加购情况做分析';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '965048597796' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '结合小红书/淘宝热搜词，优化链接标题';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '965048597796' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '梳理每个链接中差评（如有），分类问题';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '965048597796' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '针对共性问题，制作3条带图/视频好评进行覆盖';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '965048597796' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '优化问大家回复';
UPDATE tasks SET status = '进行中', execution_note = '持续中，每周至少一篇', updated_at = now()
  WHERE product_id = '965048597796' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '光合内容制作、上线';
UPDATE tasks SET status = '待开始', execution_note = '未完成，4.3出页面给品牌方，预估节后上，争取本周完成', updated_at = now()
  WHERE product_id = '965048597796' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '迭代初版详情页';
UPDATE tasks SET status = '进行中', execution_note = '持续完成，刘婷初版的竞品报告偏价格定位和功能，应该关注短期可落地的如首页排版和详情页卖点', updated_at = now()
  WHERE product_id = '965048597796' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '竞品动作关注、价格策略调整';
UPDATE tasks SET status = '进行中', execution_note = '【淘宝】大促价保 https://e.tb.cn/h.iKjimSuk0tjigHT?tk=rym55hdrtIu MF937 「CONGSTUDIO餐具咖啡杯套装生日礼物可爱餐盘盘子多巴胺甜品盘杯子」
点击链接直接打开 或者 淘宝搜索直接打开', updated_at = now()
  WHERE product_id = '965048597796' AND time_range_label = '2026-04-13~2026-04-19'
    AND detail = '竞品动作关注、价格策略调整';
UPDATE tasks SET status = '进行中', execution_note = '持续完成，素材不可加字，推广计划迭代中', updated_at = now()
  WHERE product_id = '965048597796' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '确认推广金额及提出素材需求';
UPDATE tasks SET status = '待开始', execution_note = '未完成，7天/14天之后各给一个初步结论', updated_at = now()
  WHERE product_id = '965048597796' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '对流量、收藏加购情况做分析+追加下单（考虑SEEDING量）';
UPDATE tasks SET status = '进行中', execution_note = '上升趋势，补货', updated_at = now()
  WHERE product_id = '965048597796' AND time_range_label = '2026-04-06~2026-04-12'
    AND detail = '对流量、收藏加购情况做分析+追加下单（考虑SEEDING量）';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '1021718193334' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '梳理每个链接中差评（如有），分类问题';
UPDATE tasks SET status = '进行中', execution_note = '4.3出评价（manolito能送一个出去吗？JAS想让博主拍单，带图评价+发小红书，凳子金额返回博主，跟品牌确认是否按SEEDING走）', updated_at = now()
  WHERE product_id = '1021718193334' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '针对共性问题，制作3条带图/视频好评进行覆盖';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '1021718193334' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '优化问大家回复';
UPDATE tasks SET status = '已完成', updated_at = now()
  WHERE product_id = '1020175879777' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '结合小红书/淘宝热搜词，优化链接标题';
UPDATE tasks SET status = '待开始', execution_note = '待完成，两种方案给品牌选择', updated_at = now()
  WHERE product_id = '1020175879777' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '迭代初版详情页（需确认是否做拆分）';
UPDATE tasks SET status = '待开始', execution_note = '未完成，4.3出页面给品牌方，预估节后上，争取本周完成', updated_at = now()
  WHERE product_id = '1020175879777' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '竞品动作关注、价格策略调整';
UPDATE tasks SET status = '进行中', execution_note = '【淘宝】假一赔四 https://e.tb.cn/h.ipFLWHVnfIqOlfi?tk=qZMs5hWW4ov HU591 「Tagi.边边帆布袋高密度大容量多色设计感通勤百搭复古单肩包」
点击链接直接打开 或者 淘宝搜索直接打开', updated_at = now()
  WHERE product_id = '1020175879777' AND time_range_label = '2026-04-13~2026-04-19'
    AND detail = '竞品动作关注、价格策略调整';
UPDATE tasks SET status = '待开始', execution_note = '未完成，7天/14天之后各给一个初步结论', updated_at = now()
  WHERE product_id = '1020175879777' AND time_range_label = '2026-03-23~2026-03-29'
    AND detail = '对流量、收藏加购情况做分析';

-- 共 50 条 UPDATE

-- ④ 校验：4 个周期各自任务总数 + 状态分布
SELECT time_range_label,
       COUNT(*) AS 总数,
       COUNT(*) FILTER (WHERE status='已完成') AS 已完成,
       COUNT(*) FILTER (WHERE status='进行中') AS 进行中,
       COUNT(*) FILTER (WHERE status='待开始') AS 待开始
FROM tasks
WHERE time_range_label IN
  ('2026-03-23~2026-03-29','2026-03-30~2026-04-05','2026-04-06~2026-04-12','2026-04-13~2026-04-19')
GROUP BY time_range_label ORDER BY time_range_label;
