#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, re

html_path = '/Users/jiayi/Downloads/数据库数据/dashboard.html'

with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find and extract RAW JSON
raw_start = content.index('const RAW = ')
raw_end = content.index('const OFFICIAL = new Set(RAW.official_pids)')
raw_json_str = content[raw_start + len('const RAW = '):raw_end].strip().rstrip('\n')
raw = json.loads(raw_json_str)

# Updated short_names including all 13 missing PIDs
new_short_names = {
    "679198301351": "Colour Crate 收纳篮",
    "580467335137": "Basket 收纳篓",
    "781547798998": "Slice Chopping Board 砧板",
    "888002957800": "Weekend Bag 帆布袋",
    "965048597796": "La Pittura 餐盘",
    "886839411718": "Empire Vase 花瓶",
    "887041510904": "Coco Door Mat 地垫",
    "975799789205": "Canopy Umbrella 雨伞",
    "1020815058332": "Barro Bowl & Plate 碗盘",
    "1020175879777": "Grid Bag 尼龙包",
    "1022489092196": "Conical Vase 花瓶",
    "583134215392": "Jessica Hans Vase 花瓶",
    "824946188993": "Taburete 8 Bar Stool 吧椅",
    "824607518747": "Colour Rack 落地衣架",
    "1016294283167": "Facet Cabinet 边柜",
    "717349639294": "Weekday 长凳",
    "737675603229": "Arcs Trolley 小推车",
    "689952405763": "Revolver Stool & Bar Stool 吧椅",
    "682036237751": "Korpus 置物架",
    "690221882602": "Bowler Table 茶几",
    "652664516885": "Knit 衣架",
    "742092260504": "Apex Lamp 台灯",
    "880120382310": "Apex Wall Lamp 壁灯",
    "880816460277": "Apex Floor Lamp 落地灯",
    "824882661931": "Common Pendant & Table Cord 灯具组",
    "564552361178": "Cotton Bag 帆布包",
    "824452791755": "Facet Cabinet 边柜（多色）",
    "964204735455": "Perforated Cabinet 收纳柜",
    "702658485207": "Cotton Bag 购物袋（旧）",
    "718703980562": "Slit Table 边几",
    "742288645501": "Tray Table 边几",
    "818210888511": "Paper Shade 灯罩",
    "886901025905": "PC Portable Lamp 便携灯",
    # Previously missing PIDs - now hardcoded
    "1017849944486": "Colour Crate 收纳篮（关联）",
    "1020827662635": "Weekend Bag 帆布袋（关联）",
    "1021714677571": "Conical Vase 花瓶（关联）",
    "655712136728": "Cotton Bag 帆布包（非主链）",
    "690750181823": "Bowler Table 茶几（关联）",
    "718962869038": "Slit Table 边几（关联）",
    "719833026924": "Slit Table 边几（关联2）",
    "742825018684": "Tray Table 边几（关联）",
    "823129032370": "Facet Cabinet 边柜（关联）",
    "855162826447": "Revolver Stool 吧椅（关联）",
    "880590249812": "Apex Floor Lamp 落地灯（关联）",
    "965582828141": "La Pittura 餐盘（关联）",
    "975220170387": "Basket 收纳篓（关联）",
}

# Update short_names in raw
raw['short_names'] = new_short_names

# Also fix the product names in the products dict
for pid, p in raw.get('products', {}).items():
    if pid in new_short_names:
        p['name'] = new_short_names[pid]

# Serialize back
new_raw_json = json.dumps(raw, ensure_ascii=False, separators=(',', ': '))

# Replace in content
new_content = content[:raw_start + len('const RAW = ')] + new_raw_json + '\n' + content[raw_end:]

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Done. Updated short_names with', len(new_short_names), 'entries.')
print('Products updated:', sum(1 for pid in raw.get('products', {}) if pid in new_short_names))
