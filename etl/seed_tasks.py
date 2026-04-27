# -*- coding: utf-8 -*-
"""
将标准任务模板（9 条 × 13 个商品）及各周期数据写入 dashboard.html 的 RAW 块。
可重复运行：先移除同名 detail 的旧任务，再写入新任务（避免重复）。
"""
import json, uuid
from pathlib import Path

base      = Path(__file__).parent.parent
html_path = base / 'dashboard.html'

html  = html_path.read_text(encoding='utf-8')
start = html.index('const RAW = ')
end   = html.index('\nasync function _loadRawFromAPI')
raw   = json.loads(html[start + len('const RAW = '):end].strip())

TEMPLATES = [
    {"category": "标题优化",    "detail": "结合小红书/淘宝热搜词，优化链接标题",              "owner": "Jas team（内容）"},
    {"category": "评价与问大家", "detail": "梳理每个链接中差评（如有），分类问题",               "owner": "Jas team（内容）"},
    {"category": "评价与问大家", "detail": "针对共性问题，制作3条带图/视频好评进行覆盖",          "owner": "Jas team（内容）"},
    {"category": "评价与问大家", "detail": "优化问大家回复",                                  "owner": "Jas team（内容）"},
    {"category": "淘内内容宣发", "detail": "光合内容制作、上线",                              "owner": "Jas team（内容）"},
    {"category": "详情页优化",   "detail": "迭代初版详情页",                                  "owner": "豆豆（设计）"},
    {"category": "竞品分析",    "detail": "竞品动作关注、价格策略调整",                         "owner": "刘婷（商品）"},
    {"category": "妈妈计划迭代", "detail": "确认推广金额及提出素材需求",                         "owner": "晓东（运营）"},
    {"category": "售卖复盘",    "detail": "对流量、收藏加购情况做分析",                         "owner": "晓东（运营）"},
]

_E = ("待开始", "")
_P = ("待开始", "")

def bowler():
    return [
        ("已完成", "已按后台引流权重优化标题"),
        ("已完成", "基本为带图好评"),
        ("已完成", "暂时无需刷评"),
        ("已完成", "基本为正向回答，暂时无需优化"),
        ("进行中", "安排发布中"),
        ("进行中", "详情页已做，暂停中"),
        ("待开始", ""),
        ("进行中", "计划已修正"),
        ("待开始", "待更进"),
    ]

def knit():
    return [
        ("已完成", "已按后台引流权重优化标题"),
        ("已完成", "基本为带图好评"),
        ("已完成", "暂时无需刷评"),
        ("已完成", "基本为正向回答，暂时无需优化"),
        ("进行中", "博主素材已发布，继续发布总部素材"),
        ("进行中", "详情页已做，暂停中"),
        ("待开始", ""),
        ("进行中", "计划已修正"),
        ("待开始", "待更进"),
    ]

def facet():
    return [
        ("已完成", "已按后台引流权重优化标题"),
        ("进行中", "中差评：品控不佳，售后方案不满意"),
        ("待开始", "4月安排博主排单刷评"),
        ("已完成", "容易分配到中差评卖家，暂不优化"),
        ("进行中", "先发够数量，前端种草板块得到展现"),
        ("进行中", "详情页已做，暂停中"),
        ("待开始", ""),
        ("进行中", "计划已修正"),
        ("待开始", "待更进"),
    ]

def colour_rack():
    return [
        ("已完成", "已按后台引流权重优化标题"),
        ("已完成", "基本为带图好评"),
        ("已完成", "暂时无需刷评"),
        ("已完成", "基本为正向回答，暂时无需优化"),
        ("进行中", "继续发布总部素材"),
        ("进行中", "详情页已做，暂停中"),
        ("待开始", ""),
        ("进行中", "计划已修正"),
        ("待开始", "待更进"),
    ]

EMPTY_ROW   = [_E] * 9
PENDING_ROW = [_P, _P, _P, _P, _P, _P, _E, _P, _P]

# ── 4.20-22 period: initial setup for all tracked products ──────────────────
PERIOD_420 = "4.20-22"
PRODUCTS_420 = {
    "679198301351": EMPTY_ROW,    # Colour Crate
    "580467335137": PENDING_ROW,  # Basket
    "781547798998": PENDING_ROW,  # Slice Chopping Board
    "564552361178": EMPTY_ROW,    # Cotton Bag
    "689952405763": PENDING_ROW,  # Revolver Stool & Bar Stool
    "690221882602": bowler(),     # Bowler Table
    "652664516885": knit(),       # Knit
    "824452791755": facet(),      # Facet Cabinet
    "824607518747": colour_rack(),# Colour Rack
    "682036237751": EMPTY_ROW,    # Korpus
    "742092260504": [_P]*9,       # Apex Lamp
    "886901025905": EMPTY_ROW,    # PC Portable
    "818210888511": EMPTY_ROW,    # Paper Shade
}

# ── 4.27-30 period: new products added this cycle ───────────────────────────
PERIOD_427 = "4.27-30"
# Only products NEW to the task board this period need their tasks created.
# Products already in PRODUCTS_420 already have tasks; just adding the period
# to task_periods is sufficient for them to show up in the new period UI.
PRODUCTS_427_NEW = {
    "7660181033346": EMPTY_ROW,   # Barro Bowl & Plate (new this period)
}

def make_id():
    return "task_" + uuid.uuid4().hex[:8]

def upsert_tasks(tasks_by_pid, period, product_map):
    """Add template tasks for each product in product_map, deduplicating by detail."""
    template_details = {t["detail"] for t in TEMPLATES}
    for pid, notes in product_map.items():
        existing = tasks_by_pid.get(pid, [])
        existing = [t for t in existing if t.get("detail") not in template_details]
        new_tasks = []
        for i, tmpl in enumerate(TEMPLATES):
            status, note = notes[i]
            task = {
                "id": make_id(),
                "category": tmpl["category"],
                "detail":   tmpl["detail"],
                "owner":    tmpl["owner"],
                "status":   status,
                "period_notes": {period: note} if note else {},
            }
            new_tasks.append(task)
        tasks_by_pid[pid] = new_tasks + existing


tasks_by_pid = raw.get("tasks_by_pid", {})
periods      = raw.get("task_periods", [])

# Apply 4.20-22
upsert_tasks(tasks_by_pid, PERIOD_420, PRODUCTS_420)
if PERIOD_420 not in periods:
    periods.append(PERIOD_420)

# Apply 4.27-30 new products only
upsert_tasks(tasks_by_pid, PERIOD_427, PRODUCTS_427_NEW)
if PERIOD_427 not in periods:
    periods.append(PERIOD_427)

raw["tasks_by_pid"] = tasks_by_pid
raw["task_periods"]  = periods

new_raw = 'const RAW = ' + json.dumps(raw, ensure_ascii=False) + '\n\n'
html = html[:start] + new_raw + html[end:]
html_path.write_text(html, encoding='utf-8')

total_tasks = sum(len(v) for v in tasks_by_pid.values())
print(f"完成：{len(tasks_by_pid)} 个商品，共 {total_tasks} 条任务，task_periods={periods}")
