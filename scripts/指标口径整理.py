import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "指标口径整理"

C_HEADER_BG = "1E3A5F"
C_HEADER_FG = "FFFFFF"
C_GROUP_BG  = "2D6A9F"
C_GROUP_FG  = "FFFFFF"
C_ALT_BG    = "EBF5FB"
C_WHITE     = "FFFFFF"
C_WARN_BG   = "FFF3CD"
C_BORDER    = "BDC3C7"
C_NEW_BG    = "E8F5E9"   # 浅绿 - 新增指标

thin  = Side(style="thin",   color=C_BORDER)
thick = Side(style="medium", color="2D6A9F")

def border(l=thin, r=thin, t=thin, b=thin):
    return Border(left=l, right=r, top=t, bottom=b)

def hfill(h):
    return PatternFill("solid", fgColor=h)

def cs(row, col, value="", bold=False, fg="1A1A2E", bg=C_WHITE,
       halign="left", valign="top", size=10, bo=None):
    c = ws.cell(row=row, column=col, value=value)
    c.font = Font(bold=bold, color=fg, size=size, name="微软雅黑")
    c.fill = hfill(bg)
    c.alignment = Alignment(wrap_text=True, horizontal=halign,
                             vertical=valign)
    c.border = bo or border()
    return c

col_widths = [26, 32, 24, 56, 44, 40]
for i, w in enumerate(col_widths, 1):
    ws.column_dimensions[get_column_letter(i)].width = w

ws.row_dimensions[1].height = 32
ws.row_dimensions[2].height = 22

ws.merge_cells("A1:F1")
c = ws["A1"]
c.value = "HAY 数据面板 · 指标口径整理文档（v2）"
c.font = Font(bold=True, color=C_HEADER_FG, size=14, name="微软雅黑")
c.fill = hfill(C_HEADER_BG)
c.alignment = Alignment(horizontal="center", vertical="center")
c.border = border(thick, thick, thick, thick)

headers = ["指标类别", "数据来源", "取用字段", "计算方式 / 口径说明",
           "补充备注", "限制条件 / 特殊说明"]
for col, h in enumerate(headers, 1):
    cs(2, col, value=h, bold=True, fg=C_HEADER_FG, bg=C_GROUP_BG,
       halign="center", valign="center", size=10,
       bo=border(thick, thick, thick, thick))

# fmt: (指标类别, 数据来源, 字段, 口径说明, 备注, 限制, bg_override)
# bg_override=None 表示用交替色；"warn"=黄；"new"=绿
sections = [

    ("━━  投放花费类指标  ━━", [
        ("关键词投放花费",
         "万象台\n关键词投放商品报表",
         "花费",
         "直接汇总各推广商品关键词花费；\n无计划花费基准，仅计算实际品类花费与占比",
         "品类占比 = 该品类花费 ÷ 全部关键词花费",
         "无计划 vs 实际对比",
         None),
        ("人群投放花费",
         "万象台\n人群投放商品报表",
         "花费",
         "根据花费比例计划，对比实际花费与计划花费；\n品类按商品 ID 匹配归类",
         "需维护「品类-商品ID」映射表；\n计划花费从投放计划表读取",
         "唯一有「计划 vs 实际」对比的投放维度",
         None),
        ("短视频投放花费 ★新增",
         "万象台\n内容报表（短视频渠道）",
         "花费",
         "从内容报表中提取短视频推广渠道花费；\n无花费比例计划，计算实际品类花费与占比",
         "推广渠道新增：短视频；数据源新增：内容报表",
         "数据源已明确，后续接入内容报表",
         "new"),
        ("投放总花费",
         "万象台\n商品报表（总体）",
         "花费",
         "汇总全部渠道花费：\n  关键词 + 人群 + 短视频\n无花费比例计划，计算品类占比",
         "总花费 = 三渠道花费之和",
         "数据从 3/1 开始收录；\n4/8 起做了品类投放花费比例调整，\n前后数据可对比分析",
         None),
    ]),

    ("━━  投放效率类指标（投放面板）  ━━", [
        ("投放 CTR ★更名",
         "万象台\n商品报表",
         "点击率",
         "取商品报表中的「点击率」字段，仅摘录推广商品；\n不使用人群/关键词报表的 CTR，统一口径为商品维度",
         "原名「点击率 CTR」改为「投放 CTR」；\n仅展示有投放的商品",
         "放在投放面板，不在站内指标面板重复展示",
         None),
        ("ROI ★口径更新",
         "生意参谋 + 万象台",
         "GMV（支付金额）\n投放花费",
         "ROI = GMV ÷ 投放花费\n  GMV = 生意参谋支付金额\n  投放花费 = 万象台各渠道花费合计",
         "原口径为「下单金额 ÷ 投放金额」，\n现统一改为支付金额（GMV）÷ 投放花费",
         "与 GMV 口径一致，注意历史数据对比时口径变更节点",
         "new"),
        ("商品浏览深度 ★新增",
         "万象台\n商品报表",
         "商品访客数\n商品浏览量",
         "商品浏览深度 = 商品浏览量 ÷ 商品访客数\n（平均每位访客浏览该商品的次数）",
         "浏览量 PV / 访客数 UV，反映用户对商品的关注深度；\n>1 说明同一用户多次查看",
         "放在投放面板的商品浏览深度模块",
         "new"),
        ("停留时长 ★新增",
         "万象台\n商品报表",
         "平均停留时长",
         "直接取商品报表「平均停留时长」字段；\n单位：秒",
         "反映详情页吸引力，与浏览深度配合分析",
         "",
         "new"),
    ]),

    ("━━  店铺健康度评估（原「CTR 变化」）  ━━", [
        ("访问-加购转化率 ★新增",
         "生意参谋\n商品报表",
         "cart_users\nvisitors",
         "访问-加购转化率 = 加购人数 ÷ 访客数 × 100%\n用于评估店铺/商品整体运营动作效果",
         "原字段「CTR 变化」改为用此指标评估店铺层面效果；\n投放数据从 3/1 开始收录，4/8 为花费比例调整节点，\n前后数据均保留用于对比",
         "店铺层面汇总（非单品），反映整体承接能力",
         "new"),
        ("收藏加购绝对值 ★新增",
         "生意参谋\n商品报表",
         "collect\ncart",
         "收藏加购绝对值 = 收藏数 + 加购数（总量，非比率）\n与转化率配合，判断流量质量和用户兴趣",
         "绝对值反映流量规模效果；\n比率反映流量效率",
         "投放数据日期对齐：前期 3/1-4/7，调整后 4/8 至今",
         "new"),
    ]),

    ("━━  站内销售类指标  ━━", [
        ("GMV / 销售额",
         "生意参谋\n商品报表",
         "pay_amount\n（支付金额）",
         "支付金额 = 买家完成支付的实际金额；\n分三个维度汇总：\n  ① 全站合计\n  ② 按类目汇总\n  ③ 单品明细",
         "口径为支付金额，非下单金额\n（下单金额通常偏大，含未付款订单）",
         "单品/多品视图仅展示 25 个商品；\n排行榜按全店计算",
         None),
        ("UV（进店访客数）",
         "生意参谋\n商品报表",
         "visitors",
         "进店访客数总和；\n不拆分自然流量/付费来源，取合并口径",
         "同一用户当日多次进店仍计为 1 UV",
         "",
         None),
        ("退款金额",
         "生意参谋\n商品报表",
         "refund_amount",
         "直接取退款金额字段，按周期汇总",
         "退款率 = 退款金额 ÷ 销售额，可衍生",
         "",
         None),
        ("加购率",
         "生意参谋\n商品报表",
         "cart_users / visitors",
         "加购率 = 加购人数 ÷ 访客数 × 100%",
         "",
         "",
         None),
        ("转化率",
         "生意参谋\n商品报表",
         "cart_users / visitors",
         "转化率 = 加购人数 ÷ 访客数 × 100%\n（当前与加购率共用计算，后续可升级为支付人数口径）",
         "",
         "",
         None),
        ("收藏加购（数量）",
         "生意参谋\n商品报表",
         "collect + cart",
         "收藏加购数 = 收藏数 + 加购数",
         "",
         "",
         None),
        ("新客数",
         "生意参谋\n商品报表",
         "new_buyers",
         "新买家数量，直接取字段汇总",
         "新客率 = 新客数 ÷ 支付人数",
         "",
         None),
    ]),

    ("━━  单品 / 多品视图新增指标  ━━", [
        ("商品访客数 ★新增",
         "万象台\n商品报表",
         "商品访客数",
         "进入该商品详情页的去重用户数（UV）",
         "与生意参谋访客数口径不同，此为商品详情页维度",
         "单品/多品视图展示",
         "new"),
        ("商品浏览量 ★新增",
         "万象台\n商品报表",
         "商品浏览量",
         "商品详情页被打开的总次数（PV）",
         "PV / UV = 浏览深度",
         "单品/多品视图展示",
         "new"),
        ("平均停留时长 ★新增",
         "万象台\n商品报表",
         "平均停留时长",
         "用户在该商品详情页的平均停留秒数",
         "反映详情页内容吸引力",
         "单品/多品视图展示",
         "new"),
        ("商品详情页跳出率 ★新增",
         "万象台\n商品报表",
         "详情页跳出率",
         "进入详情页后未产生任何互动（加购/收藏/购买）直接离开的比率",
         "跳出率高 = 详情页吸引力弱或流量匹配度差",
         "单品/多品视图展示",
         "new"),
        ("商品收藏加购人数 ★新增",
         "万象台\n商品报表",
         "收藏加购人数",
         "对该商品产生收藏或加购行为的去重用户数",
         "注意是「人数」而非「次数」",
         "单品/多品视图展示",
         "new"),
        ("搜索引导访客数 ★新增",
         "万象台\n商品报表",
         "搜索引导访客数",
         "通过站内搜索词进入该商品详情页的访客数",
         "反映自然搜索流量贡献；\n与投放访客数对比可评估自然搜索健康度",
         "单品/多品视图展示",
         "new"),
    ]),

    ("━━  展示范围与数据日期说明  ━━", [
        ("排行榜",
         "生意参谋 + 万象台",
         "—",
         "按全店所有商品计算排名，无数量限制",
         "",
         "",
         None),
        ("单品视图 / 多品对比",
         "生意参谋 + 万象台",
         "—",
         "仅展示 25 个商品（按销售额降序截取）",
         "",
         "超出 25 个商品不显示",
         None),
        ("投放数据日期",
         "万象台",
         "—",
         "收录起始：2024/3/1\n关键节点：2024/4/8（品类投放花费比例调整）\n前后数据均保留，可对比分析调整效果",
         "4/8 前为调整前口径，4/8 起为新口径；\n面板内所有投放指标均标注此节点",
         "非「从4/8开始」，3/1 数据亦有效",
         None),
    ]),
]

ROW = 3
for sec_title, rows in sections:
    ws.merge_cells(f"A{ROW}:F{ROW}")
    c = ws.cell(row=ROW, column=1, value=sec_title)
    c.font = Font(bold=True, color=C_GROUP_FG, size=10, name="微软雅黑")
    c.fill = hfill(C_GROUP_BG)
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    c.border = border(thick, thick, thick, thick)
    ws.row_dimensions[ROW].height = 18
    ROW += 1

    for idx, (cat, src, field, calc, note, limit, bg_ov) in enumerate(rows):
        if bg_ov == "new":
            bg = C_NEW_BG
        elif bg_ov == "warn":
            bg = C_WARN_BG
        else:
            bg = C_ALT_BG if idx % 2 == 0 else C_WHITE

        for col, val in enumerate([cat, src, field, calc, note, limit], 1):
            cs(ROW, col, value=val, bold=(col == 1), bg=bg,
               halign="left", valign="top", size=10)

        # 行高按换行数估算
        max_lines = max(v.count("\n") for v in [calc, note, limit]) + 1
        ws.row_dimensions[ROW].height = max(18, min(90, 14 + max_lines * 14))
        ROW += 1

ws.freeze_panes = "A3"
ws.auto_filter.ref = f"A2:F{ROW - 1}"
ws.page_setup.fitToPage = True
ws.page_setup.fitToWidth = 1
ws.sheet_view.showGridLines = False

out = "/Users/jiayi/Downloads/数据库数据/HAY_指标口径整理.xlsx"
wb.save(out)
print(f"已保存：{out}  （共 {ROW - 3} 行数据）")
