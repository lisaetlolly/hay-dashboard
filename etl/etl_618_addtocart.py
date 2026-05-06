# -*- coding: utf-8 -*-
"""
618 加购看板 — 品类维度 ETL（运行时按需读 xls，不入库）

数据源：
  - <DATA_DIR>/25年5月/【生意参谋平台】商品_全部_2025-05-DD_2025-05-DD.xls   (去年同期)
  - <DATA_DIR>/生意参谋商品/【生意参谋平台】商品_全部_2026-05-DD_2026-05-DD.xls (今年；可能多版本)

输出：每天每品类的加购人数日值 + 累计值（跨日不去重，符合甲方"每天累计无法去重"的口径）。

注意：CTR 不加权、口径以 sycm 显示为准（参考 memory feedback_ctr_no_weighting）；
品类划分用前端写死的 cat_map，未匹配 PID 归"其他"。
"""
import os
import re
import glob
from collections import defaultdict
from typing import Dict, List, Tuple, Optional

from .xls_reader import read_xls_stdlib

# 与 dashboard.html 里 RAW.cat_map 完全一致的 PID → 品类映射
# （直接 hard-code 在这里，后续如有更新建议同步两处。Barro Bowl & Plate 7660181033346
#  按 memory project_barro_bowl_pids 是错的 PID，但 cat_map 里仍把它登记为配饰，
#  以保持和前端一致。本看板按 PID 计算，没匹配的 PID 自动落入"其他"）
CAT_MAP = {
    "679198301351": "配饰", "580467335137": "配饰", "781547798998": "配饰",
    "888002957800": "配饰", "965048597796": "配饰", "886839411718": "配饰",
    "887041510904": "配饰", "975799789205": "配饰", "7660181033346": "配饰",
    "1020175879777": "配饰", "1022489092196": "配饰", "583134215392": "配饰",
    "564552361178": "配饰", "702658485207": "配饰", "1020827662635": "配饰",
    "655712136728": "配饰", "975220170387": "配饰", "1021714677571": "配饰",
    "965582828141": "配饰", "1017849944486": "配饰",
    "824946188993": "家具", "824607518747": "家具", "1016294283167": "家具",
    "717349639294": "家具", "737675603229": "家具", "689952405763": "家具",
    "682036237751": "家具", "690221882602": "家具", "652664516885": "家具",
    "824452791755": "家具", "718703980562": "家具", "742288645501": "家具",
    "964204735455": "家具", "823129032370": "家具", "855162826447": "家具",
    "742825018684": "家具", "718962869038": "家具", "719833026924": "家具",
    "690750181823": "家具",
    "824882661931": "灯具", "742092260504": "灯具", "880120382310": "灯具",
    "880816460277": "灯具", "818210888511": "灯具", "886901025905": "灯具",
    "880590249812": "灯具",
}

CATS = ["家具", "配饰", "灯具", "其他"]

# 品类 daily 兜底值 — Render 等部署环境读不到 25年5月/ 与 生意参谋商品/ 的 xls 时用。
# 维护方式：本地新增/更新 xls 后跑：
#   python3 -c "import sys;sys.path.insert(0,'.');from etl.etl_618_addtocart import build_618_category_series; \
#               import json; print(json.dumps(build_618_category_series('.'),ensure_ascii=False,indent=2))"
# 把输出里的 daily 段粘到下面（保持 5/1-5/12 范围）。
CATEGORY_DAILY_FALLBACK = {
    "2025-05-01": {"家具": 20, "配饰": 385, "灯具": 20, "其他": 246},
    "2025-05-02": {"家具": 14, "配饰": 308, "灯具": 19, "其他": 172},
    "2025-05-03": {"家具": 12, "配饰": 321, "灯具": 10, "其他": 153},
    "2025-05-04": {"家具": 33, "配饰": 382, "灯具": 10, "其他": 163},
    "2025-05-05": {"家具": 21, "配饰": 388, "灯具": 7,  "其他": 340},
    "2025-05-06": {"家具": 58, "配饰": 544, "灯具": 11, "其他": 166},
    "2025-05-07": {"家具": 40, "配饰": 594, "灯具": 14, "其他": 257},
    "2025-05-08": {"家具": 7,  "配饰": 417, "灯具": 24, "其他": 250},
    "2025-05-09": {"家具": 24, "配饰": 459, "灯具": 10, "其他": 331},
    "2025-05-10": {"家具": 89, "配饰": 456, "灯具": 5,  "其他": 193},
    "2025-05-11": {"家具": 72, "配饰": 436, "灯具": 23, "其他": 186},
    "2025-05-12": {"家具": 41, "配饰": 438, "灯具": 15, "其他": 167},
    "2026-05-01": {"家具": 25, "配饰": 606, "灯具": 14, "其他": 216},
    "2026-05-02": {"家具": 6,  "配饰": 770, "灯具": 0,  "其他": 374},
    "2026-05-03": {"家具": 95, "配饰": 726, "灯具": 18, "其他": 431},
    "2026-05-04": {"家具": 83, "配饰": 627, "灯具": 15, "其他": 180},
    # 2026-05-05 起每天补一行（拿到 xls 后跑上面的命令更新这里）
}

# 全店日加购人数 — sycm 后台"宏观监控-核心指标监控"逐日"商品加购人数"
# 由运营手抄给我，写死在代码里（甲方说"前端不放手填表"，反正一年只用 12 天）。
# 口径：单日去重；跨日不去重（同一买家多天加购被算多次），KPI tooltip 已注明。
# 后续每天补一行就行（推 git → Render 自动部署）。
STORE_DAILY_ADDTOCART = {
    # ── 25 年同期（5/1-5/12 全 12 天）──
    "2025-05-01": 736,
    "2025-05-02": 733,
    "2025-05-03": 719,
    "2025-05-04": 783,
    "2025-05-05": 905,
    "2025-05-06": 1057,
    "2025-05-07": 1134,
    "2025-05-08": 936,
    "2025-05-09": 956,
    "2025-05-10": 1025,
    "2025-05-11": 1028,
    "2025-05-12": 895,
    # ── 26 年（截至录入时刻 2026-05-06，5/6 起每天补一行）──
    "2026-05-01": 1160,
    "2026-05-02": 1278,
    "2026-05-03": 1300,
    "2026-05-04": 1281,
    "2026-05-05": 1495,
}

# sycm UI 上选 5/1-5/N 自定义区间，UI 上的"商品加购人数"= 真去重累计。这是首选展示值；
# 没有的日期 → fallback 到 naïve 日加购求和（前端 tooltip 标"按日求和、跨日不去重"）。
# 跨日去重折扣巨大：25 年 5/1-5/12 naïve 求和 10,907，sycm 真去重只 5,974（差 45%）。
STORE_CUM_DEDUP = {
    # ── 25 年 ──
    "2025-05-05": 3876,   # sycm UI 选 5/1-5/5（= daily 求和，短窗口无跨日重复）
    "2025-05-06": 4933,   # sycm UI 选 5/1-5/6（= daily 求和）
    "2025-05-12": 5974,   # sycm UI 选 5/1-5/12（< daily 求和 10907，跨日去重生效）
    # ── 26 年（T+1 每天补一行）──
    "2026-05-05": 6514,   # sycm UI 选 5/1-5/5（= daily 求和）
}

# 任意窗口的 sycm UI 去重值（不是 5/1 起，给"任意区间对比" picker 用）
STORE_WIN_DEDUP = {
    ("2025-05-06", "2025-05-10"): 5108,
    ("2025-05-11", "2025-05-12"): 1923,
}


def build_618_store_series(
    days: range = range(1, 13),
    db_overrides: Optional[dict] = None,
) -> Dict[str, dict]:
    """
    全店加购人数：daily + 两条累计曲线。
      - cumsum_naive：日值简单求和（跨日不去重，虚高）
      - cumsum_dedup：sycm UI 上选 5/1-5/N 得到的真去重累计；只在 STORE_CUM_DEDUP 里给的日子有值

    db_overrides: 来自 addtocart_618_data 表的 admin 编辑值，结构：
      {
        "daily":     {"YYYY-MM-DD": int, ...},
        "cum_dedup": {"YYYY-MM-DD": int, ...},   # key 是 end_date
        "win_dedup": {("start","end"): int, ...},
      }
      DB 里有的覆盖 hardcoded；DB 里没有的继续用 hardcoded 值。
    """
    daily_src = dict(STORE_DAILY_ADDTOCART)
    cum_src   = dict(STORE_CUM_DEDUP)
    win_src   = dict(STORE_WIN_DEDUP)
    if db_overrides:
        daily_src.update(db_overrides.get("daily", {}))
        cum_src.update(db_overrides.get("cum_dedup", {}))
        win_src.update(db_overrides.get("win_dedup", {}))

    out: Dict[str, dict] = {}
    for tag, year in (("last_year", 2025), ("this_year", 2026)):
        daily: Dict[str, int] = {}
        cumsum_naive: Dict[str, int] = {}
        cumsum_dedup: Dict[str, int] = {}
        running = 0
        for d in sorted(days):
            ds = f"{year}-05-{d:02d}"
            v = daily_src.get(ds)
            if v is not None:
                daily[ds] = int(v)
                running += int(v)
                cumsum_naive[ds] = running
            if ds in cum_src:
                cumsum_dedup[ds] = cum_src[ds]
        out[tag] = {
            "year": year,
            "daily": daily,
            "cumsum_naive": cumsum_naive,
            "cumsum_dedup": cumsum_dedup,
        }
    out["windows"] = [
        {"start": s, "end": e, "users": v} for (s, e), v in sorted(win_src.items())
    ]
    return out

# 文件名里的日期段
_DATE_RE = re.compile(r"商品_全部_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})")


def _to_int(v) -> int:
    """生意参谋导出的数字带千分位逗号；按 sycm 原值保真，不做任何加权/换算"""
    if v is None:
        return 0
    s = str(v).strip().replace(",", "")
    if not s or s in ("-", "—", "N/A", "nan"):
        return 0
    try:
        return int(float(s))
    except (ValueError, TypeError):
        return 0


def _list_daily_files(folder: str, year: int, days: range) -> Dict[str, str]:
    """
    扫文件夹，对每个目标日期挑一份 xls。
    重复文件（如 "(3).xls"、"_v2.xls"、UUID 前缀的 .xls）按文件大小最大优先 —
    生意参谋偶尔导出"残卷"，大文件通常是完整版。
    """
    out: Dict[str, str] = {}
    if not os.path.isdir(folder):
        return out
    candidates: Dict[str, List[Tuple[int, str]]] = defaultdict(list)
    for fp in glob.glob(os.path.join(folder, "*.xls")):
        m = _DATE_RE.search(os.path.basename(fp))
        if not m:
            continue
        d_start, d_end = m.group(1), m.group(2)
        # 只要单天文件（start==end）落在当前年的目标 days 范围内
        if d_start != d_end:
            continue
        try:
            yy, mm, dd = (int(x) for x in d_start.split("-"))
        except ValueError:
            continue
        if yy != year or mm != 5 or dd not in days:
            continue
        try:
            sz = os.path.getsize(fp)
        except OSError:
            sz = 0
        candidates[d_start].append((sz, fp))
    for d, lst in candidates.items():
        lst.sort(reverse=True)  # 大文件优先
        out[d] = lst[0][1]
    return out


def _aggregate_daily(xls_path: str) -> Dict[str, int]:
    """读单个 xls，返回 {category: cart_users_sum}"""
    headers, rows = read_xls_stdlib(xls_path)
    if not rows:
        return {c: 0 for c in CATS}
    # 容错：列名可能带空格
    pid_key = next((h for h in headers if h.strip() == "商品ID"), "商品ID")
    cart_key = next((h for h in headers if h.strip() == "商品加购人数"), "商品加购人数")
    out = {c: 0 for c in CATS}
    seen_pids: set = set()
    for r in rows:
        pid = (r.get(pid_key) or "").strip()
        if not pid or not pid.replace(".", "").isdigit():
            continue
        # 同一 xls 同 PID 偶尔有"主商品/SKU"两行——按单天 PID 去重
        if pid in seen_pids:
            continue
        seen_pids.add(pid)
        cat = CAT_MAP.get(pid, "其他")
        out[cat] += _to_int(r.get(cart_key))
    return out


def build_618_category_series(
    data_dir: str,
    days: range = range(1, 13),  # 5/1 - 5/12
    db_overrides: Optional[dict] = None,
) -> Dict[str, dict]:
    """
    主入口。返回：
    {
      "this_year": {
        "year": 2026,
        "daily":  {"2026-05-01": {家具,配饰,灯具,其他,合计}, ...},
        "cumsum": {"2026-05-01": {家具,配饰,灯具,其他,合计}, ...},
      },
      "last_year": { ... year=2025 ... },
      "missing_dates": {"this_year": [...], "last_year": [...]},
    }
    跨日不去重（即逐日累加日值），符合甲方"每天累计无法去重"口径。
    """
    folders = {
        "last_year": (os.path.join(data_dir, "25年5月"), 2025),
        "this_year": (os.path.join(data_dir, "生意参谋商品"), 2026),
    }
    result = {"missing_dates": {}, "store": build_618_store_series(days, db_overrides=db_overrides)}
    for tag, (folder, year) in folders.items():
        files = _list_daily_files(folder, year, days)
        daily: Dict[str, Dict[str, int]] = {}
        for d in sorted(days):
            ds = f"{year}-05-{d:02d}"
            if ds in files:
                # 优先 xls 实读
                cats = _aggregate_daily(files[ds])
            elif ds in CATEGORY_DAILY_FALLBACK:
                # Render 等部署环境读不到 xls → 用代码里固化的兜底值
                cats = dict(CATEGORY_DAILY_FALLBACK[ds])
            else:
                continue
            cats["合计"] = sum(cats[c] for c in CATS)
            daily[ds] = cats
        # 累计：从 5/1 顺序滚加
        cumsum: Dict[str, Dict[str, int]] = {}
        running = {c: 0 for c in CATS + ["合计"]}
        for d in sorted(days):
            ds = f"{year}-05-{d:02d}"
            if ds not in daily:
                continue
            for k in CATS + ["合计"]:
                running[k] += daily[ds][k]
            cumsum[ds] = dict(running)
        result[tag] = {"year": year, "daily": daily, "cumsum": cumsum}
        # 缺失日期（让前端能告诉用户"5/5 还没下"）
        result["missing_dates"][tag] = [
            f"{year}-05-{d:02d}" for d in sorted(days) if f"{year}-05-{d:02d}" not in daily
        ]
    return result


if __name__ == "__main__":
    import json
    import sys
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = build_618_category_series(base)
    print(json.dumps(out, ensure_ascii=False, indent=2))
