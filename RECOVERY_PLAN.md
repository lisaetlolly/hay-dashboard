# HAY Dashboard 恢复操作手册

最后更新：2026-04-28

> 目标：今天内 ① 数据回 Neon ② 同事能登录改自己任务进度 ③ 关键 bug 修复上线
>
> 你只需要做 4 步：跑 SQL → 本地跑 ETL → git push → 在 Render 改环境变量

---

## 第 0 步：拿到 Neon 连接串（已做）

```
postgresql://neondb_owner:npg_vJrIahw5N0gO@ep-steep-poetry-ao6yf96a-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

> 后面所有命令把这个串放在 `DATABASE_URL` 环境变量里。**不要直接 commit 进代码库。**

---

## 第 1 步：在 Neon Console 跑一键恢复 SQL（5 分钟）

> 这一步立刻让账号 + 这周任务可用，不依赖本地环境。
> ⚠️ **Claude 这边没有 Neon 网络访问权限，所以这步必须你手动跑**

### 详细步骤（按顺序点）

1. **打开 Neon Console**
   - 浏览器访问 https://console.neon.tech
   - 用你创建数据库时用的账号登录（GitHub / Google / 邮箱都可能）

2. **进入 SQL Editor**
   - 登录后顶部会列出所有 project，点你那个项目（连接串里 `ep-steep-poetry-ao6yf96a` 的）
   - 进项目后看左侧栏，找 **"SQL Editor"** 菜单（图标像 `>_`）
   - 点开后右边出现一个空白的 SQL 输入框

3. **复制 SQL 文件全文**
   - 在你电脑用文本编辑器打开 `/Users/jiayi/Downloads/数据库数据/etl/bootstrap_recovery.sql`
   - **全选**（Cmd+A）→ **复制**（Cmd+C）

4. **粘贴并运行**
   - 回到 Neon SQL Editor，先把里面的示例 SQL（如果有）删掉
   - 粘贴（Cmd+V）你刚复制的内容
   - 右上角点 **"Run"** 按钮（或 Cmd+Enter）

5. **检查结果**
   下方 Results 面板应该显示三个查询结果：
   - **第 1 个 query**：8 行用户（admin / xiaodong / shengchao / wanting / jas / doudou / liuting / hay）
   - **第 2 个 query**：36 行任务（4 商品 × 9 模板，time_range_label = '2026-04-27~2026-04-30'）
   - **第 3 个 query**：一行汇总（总任务、本周任务、负责人数、商品数）

   如果看到 `success` 但没结果，往下滚动找最后一个 SELECT 输出。

### 如果跑出错了

| 错误信息 | 原因 | 怎么办 |
|---|---|---|
| `relation "fact_xxx" does not exist` | 之前没建过事实表，跳过即可（第 2 步会建）| 忽略 |
| `permission denied` | Neon 角色不对 | 用 `neondb_owner` 登录的项目，应该没问题 |
| `duplicate key value violates unique constraint` | 重复跑了，已经存在 | 用了 ON CONFLICT，正常会跳过，看 Results 末尾确认有结果 |
| 跑了之后 SELECT 返回 0 行 | INSERT 成功但 SELECT 拿不到 | 把整个 SQL 再跑一遍；或者另开一个 Query 单独跑校验 |

### 如果你不熟 Neon Console，备选：用 Render Shell

1. Render Dashboard → hay-dashboard 服务 → 左侧 **"Shell"** tab
2. 等终端启动后跑：
```bash
cd /opt/render/project/src
python3 -c "
import psycopg2, os
sql = open('etl/bootstrap_recovery.sql', encoding='utf-8').read()
conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()
cur.execute(sql)
conn.commit()
# 校验
cur.execute('SELECT count(*) FROM users')
print('users:', cur.fetchone()[0])
cur.execute(\"SELECT count(*) FROM tasks WHERE time_range_label='2026-04-27~2026-04-30'\")
print('本周任务:', cur.fetchone()[0])
"
```
3. 应该输出：`users: 8` 和 `本周任务: 36`

---

## 第 2 步：本地跑 ETL，把 92 个生意参谋 + 24 个流量 + 7 类推广报表灌进 Neon（30 分钟）

```bash
# 进项目目录
cd /Users/jiayi/Downloads/数据库数据

# 设环境变量（本次会话有效）
export DATABASE_URL='postgresql://neondb_owner:npg_vJrIahw5N0gO@ep-steep-poetry-ao6yf96a.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'
# 注意：ETL 用的是非 -pooler 的 DSN（直连），server.py 用的是 -pooler

# 装依赖（一次）
pip3 install psycopg2-binary openpyxl xlrd

# 跑 ETL（--reset 会清空 fact_* 表重新灌）
cd etl
python3 etl_load.py --reset
```

**预期输出**（截一下图发我看）：
```
[优化商品ID清单] 主链 PID 25 个 (typo 修正 1 个)
[合并副 SKU] 加载 13 个 alias，ETL 接收 PID 集合 38 个
[ETL] 连接 Neon PostgreSQL...
[0] 初始化 Schema
  Schema 初始化完成
[1] dim_date
  dim_date: 365 rows
[2] dim_product
  dim_product: 38 行（主链 25 + 副 SKU 13）
                SPU 合并: 13 个副 SKU 指向主链
[3] 生意参谋商品报表
  fact_syzt_product: ~1700 rows
[4] 万象台商品报表
  fact_wxst_product: ~1600 rows
[5] 万象台人群报表
  fact_wxst_audience: 数百 rows
[6] 万象台关键词报表
  fact_wxst_keyword: 数百 rows
[7] 无限店铺流量
  fact_traffic: 数千 rows
[ETL] Done -> Neon PostgreSQL
```

**如果报错**：发我看错误信息，最常见的是网络问题（重跑一次）或者某个 xls 损坏（脚本会跳过并打 WARN）。

---

## 第 3 步：把代码改动 commit + push 到 GitHub（5 分钟）

```bash
cd /Users/jiayi/Downloads/数据库数据
git status   # 应该看到这些改动：
             #   修改: server.py（清密码 + 新增任务/我的任务/总览分类筛选 API）
             #   修改: etl/etl_load.py（SPU_MAP 扩 13 对 + typo 修正 + inventory 兼容）
             #   修改: render.yaml（disk 挂载路径）
             #   修改: js/components/ProductsPage.js（cart_rate=conv_rate bug）
             #   修改: js/components/ComparePage.js（cart_rate=conv_rate bug）
             #   新增: etl/bootstrap_recovery.sql
             #   新增: RECOVERY_PLAN.md（本文件）

git add .
git commit -m "fix: SPU 合并扩成 13 对 + 转化率公式修正 + 任务模板/我的任务/分类筛选 API + 安全/部署修复"
git push
```

GitHub push 后，Render 会自动 redeploy（约 2-3 分钟）。

---

## 第 4 步：在 Render 检查环境变量（2 分钟）

> server.py 现在强制要求 `DATABASE_URL`，没设会启动失败。

1. 打开 Render Dashboard → 选 hay-dashboard 服务 → Environment
2. 确认有 `DATABASE_URL`，值为：
   ```
   postgresql://neondb_owner:npg_vJrIahw5N0gO@ep-steep-poetry-ao6yf96a-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```
3. 如果之前没设，加完后会自动重新部署
4. 部署完成后访问 https://hay-dashboard.onrender.com 验证

---

## 已完成的修复清单

| ID | 修复内容 | 文件 |
|---|---|---|
| T1 | 数据灌回 Neon（SQL + ETL）| `etl/bootstrap_recovery.sql` + `etl/etl_load.py` |
| T3 | 4.27-4.30 周 36 条任务批量录入 | `bootstrap_recovery.sql` |
| T4 | 8 个用户账号建好（含权限分配）| `bootstrap_recovery.sql` |
| T5 | SPU 合并扩到 13 组 + typo 修正 | `etl/etl_load.py` |
| T6 | 转化率公式修复（cart_rate ≠ conv_rate）| `ProductsPage.js`, `ComparePage.js` |
| T8 | "我的任务"接口（按 owner 筛 + 仅本周）| `server.py /api/tasks/mine` |
| T9 | 总览排行加分类筛选 | `server.py /api/overview/ranking?category=` |
| T11 | 清掉硬编码密码 + 修 disk 挂载 | `server.py`, `render.yaml` |
| 新增 | 任务模板表（员工换人只改一行）| `task_template`, `task_period` |
| 新增 | 任务批量生成 API（一键克隆下周）| `server.py /api/tasks/bulk-instantiate` |

---

## 还没做完、下一阶段做（不影响今天上线）

| ID | 待做 | 工作量 |
|---|---|---|
| T13 | SKU 颜色销售明细（Colour Crate 多色，品牌方需求，**已暂缓**）| 半天，需要新数据源 |
| T8 UI | 前端"我的任务"独立 tab（**已暂缓**：用户说任务卡片有 owner 筛选就够用）| 1 小时 |
| T9c | 日历视图周期筛选器（用户提的"日历筛选 4.27-4.30"）| 30 分钟 |
| - | 修加权口径 SQL（bounce_rate / cart_rate 等服务端加权统计）| 30 分钟 |
| - | 后端写操作加权限校验（防止 viewer 偷偷改任务）| 1 小时 |
| - | actions 表落库 + CRUD（运营动作目前在前端硬编码）| 1 小时 |
| - | 操作日志 audit_log 表 | 30 分钟 |

## 今天的全部产出（已 commit-ready）

| ID | 内容 | 文件 |
|---|---|---|
| T1 | Neon 一键恢复 SQL | `etl/bootstrap_recovery.sql`（用户 + 4.27-4.30 任务 + 任务模板 + 周期表）|
| T5 | ETL SPU 合并 13 对 + typo 修正 | `etl/etl_load.py` |
| T6 | 转化率公式修正 | `js/components/ProductsPage.js`, `ComparePage.js` |
| T8 | 后端"我的任务"API（基础设施留作后用）| `server.py /api/tasks/mine` |
| T9 | 总览排行加分类筛选（前后端） | `server.py /api/overview/ranking?category=` + `OverviewPage.js` |
| T10 | 人群花费比例改实时 API | `server.py /api/ads/channel-split` + `js/compute.js fetchChannelRatios` |
| T11 | 清掉硬编码密码 + 修 disk 挂载 | `server.py`, `render.yaml` |
| 新增 | 任务模板表（员工换人改一行）| `bootstrap_recovery.sql` |
| 新增 | 任务批量生成 API（一键克隆）| `server.py /api/tasks/bulk-instantiate` |
| 新增 | 周期管理 API（建周期 / 列周期 / 当前周）| `server.py /api/task-periods` |
| 新增 | 任务模板 CRUD API（员工换人触发任务批量改 owner）| `server.py /api/task-templates/{id}` |
| T14 | 删除 73.1% 硬编码 + 加可编辑人群品类计划（家具63/配饰30/灯具5/其他2）| `server.py /api/settings/audience-plan` + `category_audience_plan` 表 |
| T15 | 内容报表 ETL（短视频花费数据源）| `etl/etl_load.py load_wxst_content` + `fact_wxst_content` 表 + `server.py /api/ads/content-summary` |
| T16 | 妈妈计划口径文档化 | 已确认数据源 = `fact_wxst_*` 系列，缺的是"妈妈计划专属人群包名"列表，等晓东提供后过滤 |

---

## 给同事的"快速上手"信息（你转发给他们）

```
HAY Dashboard 上线了，链接：https://hay-dashboard.onrender.com

【你的账号】
姓名         用户名     默认密码
晓东（店长） xiaodong   hay2026   ← 管理员权限
声超（老板） shengchao  hay2026   ← 管理员权限
婉婷（主管） wanting    hay2026   ← 管理员权限
Jas team    jas        hay2026
豆豆（设计） doudou     hay2026
刘婷（商品） liuting    hay2026
HAY 客户    hay        hay2026   ← 只读

【更新自己本周任务】
1. 登录 → 投放面板 → 看到所有任务
2. 找到 owner 是你的任务（jas / 豆豆 / 刘婷 / 晓东）
3. 点击任务 → 改状态（待开始 / 进行中 / 已完成）→ 写执行备注
4. 保存即可，所有人都能看到更新

【设置 → 我的任务】（即将上线，今晚或明天）
快速锁定本周自己的任务，跳过翻找过程。
```

---

## 出问题时的"自检清单"

**症状**：网站显示"加载中..."不动
- 检查 Render Dashboard 是否在 Live 状态
- 看 Render Logs 有无错误（最常见：`DATABASE_URL` 没设）

**症状**：登录失败 "用户名或密码错误"
- 在 Neon Console 跑：`SELECT username, role FROM users;` 确认账号在
- 确认密码是 `hay2026`（如果同事改过就让他们重置）

**症状**：仍然看不到 4.27-4.30 周任务
- 在 Neon Console 跑：`SELECT product_id, owner, detail FROM tasks WHERE time_range_label = '2026-04-27~2026-04-30';`
- 应该有 36 行；如果是 0，重跑 `bootstrap_recovery.sql`

**症状**：单品视图缺少 Cotton Bag / Slit Table / Tray Table
- 这是因为 ETL 还没跑，或 SPU_MAP 没生效
- 跑 `python etl_load.py --reset` 重灌一次
