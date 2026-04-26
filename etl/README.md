# HAY 电商数据看板 — 数据库 & ETL

## 文件结构

```
etl/
├── schema.sql      ← 建表 DDL（SQLite/PostgreSQL 兼容）
├── etl_load.py     ← 主 ETL 脚本（自动导入所有底表）
├── etl_manual.py   ← 手动录入脚本（小红书、付费推广）
├── hay.db          ← 生成的 SQLite 数据库（运行后产生）
└── README.md       ← 本文件
```

---

## 快速开始

### 第一步：安装依赖

```bash
pip install xlrd==1.2.0 openpyxl
# xlrd 1.2.0 是唯一支持旧 .xls 格式的版本
```

### 第二步：初始化数据库并导入所有数据

```bash
cd 数据库数据/etl
python etl_load.py --reset
```

`--reset` 会清空旧数据重新导入。日常增量导入去掉 `--reset`：

```bash
python etl_load.py
```

### 第三步：录入手动数据（小红书 / 付费推广）

编辑 `etl_manual.py` 底部的 `load_sample_data()` 函数，
把实际摘录的数据填入，然后：

```bash
python etl_manual.py --db etl/hay.db
```

---

## 数据表说明

| 表名 | 说明 | 来源 |
|------|------|------|
| `dim_product` | 25 个核心商品 + 分类 | 底表 + 分类映射表 |
| `dim_date` | 日期维度（周/月/季度） | 自动生成 |
| `fact_syzt_product` | 生意参谋商品报表（日） | 生意参谋商品/*.xls |
| `fact_wxst_product` | 万象台商品报表 | 推广报表/商品报表*.csv |
| `fact_wxst_audience` | 万象台人群报表 | 推广报表/人群报表*.csv |
| `fact_wxst_keyword` | 万象台关键词报表 | 推广报表/关键词报表*.csv |
| `fact_traffic` | 无限店铺流量（日+来源） | 无限店铺流量/*.xls |
| `fact_paid_promo` | 付费推广（人群/关键词） | 手动录入 |
| `fact_xhs_note` | 小红书笔记 | 手动录入 |
| `fact_xhs_note_product` | 笔记×商品关联 | 手动录入 |

---

## 视图说明（看板直接查询）

| 视图名 | 说明 |
|--------|------|
| `view_product_daily` | 商品日报宽表（生意参谋+万象台） |
| `view_product_weekly` | 商品周汇总 |
| `view_product_monthly` | 商品月汇总 |
| `view_category_monthly` | 分类月汇总 |
| `view_wxst_daily` | 万象台 ROI 日报 |
| `view_traffic_daily` | 流量来源日报 |

---

## 看板连接方式

### Metabase（推荐）
1. 下载 Metabase Jar：https://www.metabase.com/start/oss/jar
2. `java -jar metabase.jar`
3. 数据源选 **SQLite** → 路径填 `hay.db` 绝对路径
4. 直接用视图建问题/仪表盘

### Grafana
1. 安装 SQLite 插件：grafana-cli plugins install frser-sqlite-datasource
2. 数据源 → SQLite → 填路径

### 任何 SQL 工具
```
sqlite3 etl/hay.db
```

---

## 常用查询示例

```sql
-- 近 30 天 各商品支付金额排行
SELECT product_title, SUM(pay_amount) AS total_pay
FROM view_product_daily
WHERE stat_date >= date('now','-30 days')
GROUP BY product_id
ORDER BY total_pay DESC;

-- 某商品近 90 天 日均访客趋势
SELECT stat_date, visitors, pay_amount, pay_cvr
FROM view_product_daily
WHERE product_id = '886839411718'
  AND stat_date >= date('now','-90 days')
ORDER BY stat_date;

-- 分类月度 GMV 对比
SELECT category_l1, year, month, total_pay_amount
FROM view_category_monthly
ORDER BY year, month, total_pay_amount DESC;

-- 万象台 ROI 最高的商品（本月）
SELECT product_title, AVG(roi) AS avg_roi, SUM(spend) AS total_spend
FROM view_wxst_daily
WHERE stat_date >= date('now','start of month')
GROUP BY product_id
ORDER BY avg_roi DESC;

-- 关键词花费 TOP10
SELECT keyword_name, SUM(spend) AS total_spend, SUM(total_gmv) AS total_gmv,
       AVG(roi) AS avg_roi
FROM fact_wxst_keyword
GROUP BY keyword_name
ORDER BY total_spend DESC
LIMIT 10;

-- 流量来源占比
SELECT source_l1, SUM(total_visitors) AS visitors
FROM view_traffic_daily
WHERE stat_date >= date('now','-30 days')
GROUP BY source_l1
ORDER BY visitors DESC;
```

---

## 分类规则
- **配件** 在分类映射表中统一归入 **配饰**（ETL 自动处理）
- 一级分类：家具 / 配饰 / 灯具
- 二级分类：收纳盒 / 边几 / 台灯 / 椅类 / 架类 等

## 新增数据时
1. 把新 XLS/CSV 文件放入对应目录
2. 运行 `python etl_load.py`（无 `--reset`，只插入新数据）
