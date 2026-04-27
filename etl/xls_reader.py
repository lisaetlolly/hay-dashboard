# -*- coding: utf-8 -*-
"""
纯 Python 标准库 XLS (BIFF8/OLE2) 解析器
无需任何第三方包，支持读取旧版 .xls 文件
"""
import struct


def _read_fat_chain(data, start, fat, sector_size):
    chain = []
    s = start
    visited = set()
    while s < 0xFFFFFFFE:
        if s in visited:
            break
        visited.add(s)
        chain.append(s)
        if s >= len(fat):
            break
        s = fat[s]
    out = b''
    for s in chain:
        off = (s + 1) * sector_size
        out += data[off: off + sector_size]
    return out


def _extract_workbook_stream(data):
    """从 OLE2 容器中提取 Workbook/Book BIFF 流"""
    SECT = struct.unpack_from('<H', data, 0x1e)[0]
    sector_size = 1 << SECT

    num_fat = struct.unpack_from('<I', data, 0x2c)[0]
    # DIFAT array in header (up to 109 entries)
    difat_in_hdr = [struct.unpack_from('<I', data, 0x4c + i * 4)[0] for i in range(min(num_fat, 109))]

    fat = []
    for s in difat_in_hdr:
        if s >= 0xFFFFFFFE:
            break
        off = (s + 1) * sector_size
        for i in range(sector_size // 4):
            fat.append(struct.unpack_from('<I', data, off + i * 4)[0])

    first_dir = struct.unpack_from('<I', data, 0x30)[0]
    dir_data = _read_fat_chain(data, first_dir, fat, sector_size)

    # Mini stream setup
    mini_sector_size = 1 << struct.unpack_from('<H', data, 0x20)[0]
    mini_stream_cutoff = struct.unpack_from('<I', data, 0x38)[0]
    first_mini_fat = struct.unpack_from('<I', data, 0x3c)[0]
    mini_fat = []
    ms = first_mini_fat
    visited = set()
    while ms < 0xFFFFFFFE:
        if ms in visited:
            break
        visited.add(ms)
        off = (ms + 1) * sector_size
        for i in range(sector_size // 4):
            mini_fat.append(struct.unpack_from('<I', data, off + i * 4)[0])
        if ms >= len(fat):
            break
        ms = fat[ms]

    # Root entry gives us the mini stream container
    root = dir_data[:128]
    root_start = struct.unpack_from('<I', root, 0x74)[0]
    mini_stream = _read_fat_chain(data, root_start, fat, sector_size)

    def read_mini(start, size):
        chain = []
        s = start
        visited2 = set()
        while s < 0xFFFFFFFE:
            if s in visited2:
                break
            visited2.add(s)
            chain.append(s)
            if s >= len(mini_fat):
                break
            s = mini_fat[s]
        out = b''
        for s in chain:
            off = s * mini_sector_size
            out += mini_stream[off: off + mini_sector_size]
        return out[:size]

    # Scan directory entries
    for i in range(len(dir_data) // 128):
        e = dir_data[i * 128: (i + 1) * 128]
        name_len = struct.unpack_from('<H', e, 0x40)[0]
        if name_len < 2:
            continue
        name = e[:name_len - 2].decode('utf-16-le', errors='ignore')
        obj_type = e[0x42]
        start = struct.unpack_from('<I', e, 0x74)[0]
        size = struct.unpack_from('<I', e, 0x78)[0]
        if name in ('Workbook', 'Book') and obj_type == 2:
            if size < mini_stream_cutoff:
                return read_mini(start, size)
            else:
                raw = _read_fat_chain(data, start, fat, sector_size)
                return raw[:size]
    return None


def _parse_biff8(stream):
    """
    解析 BIFF8 流，返回 list of list (行列数据，字符串类型)
    """
    pos = 0
    sst = []          # Shared String Table
    rows = {}         # row_idx -> {col_idx: value}
    dimensions = (0, 0)

    def read_rec():
        nonlocal pos
        if pos + 4 > len(stream):
            return None, None, None
        rec_type = struct.unpack_from('<H', stream, pos)[0]
        rec_len = struct.unpack_from('<H', stream, pos + 2)[0]
        payload = stream[pos + 4: pos + 4 + rec_len]
        pos += 4 + rec_len
        return rec_type, rec_len, payload

    # BIFF8 record types
    BOF      = 0x0809
    EOF      = 0x000A
    SST      = 0x00FC
    CONTINUE = 0x003C
    LABELSST = 0x00FD
    NUMBER   = 0x0203
    RK       = 0x027E
    MULRK    = 0x00BD
    LABEL    = 0x0204
    BLANK    = 0x0201
    FORMULA  = 0x0006
    STRING   = 0x0207  # formula string result
    BOOLERR  = 0x0205
    MULBLANK = 0x00BE
    DIMENSIONS = 0x0200

    def decode_rk(rk_val):
        if rk_val & 2:
            v = rk_val >> 2
            if rk_val & 1:
                v /= 100.0
        else:
            b = struct.pack('<Q', (rk_val & 0xFFFFFFFC) << 32)
            v = struct.unpack('<d', b)[0]
            if rk_val & 1:
                v /= 100.0
        return v

    def read_unicode_string(data, offset, rich=False, phonetic=False):
        """Read BIFF8 Unicode string, return (string, bytes_consumed)"""
        if offset + 3 > len(data):
            return '', 0
        nchars = struct.unpack_from('<H', data, offset)[0]
        flags = data[offset + 2]
        compressed = not (flags & 1)
        has_rich = bool(flags & 8)
        has_phonetic = bool(flags & 4)
        o = offset + 3
        rich_count = 0
        phonetic_size = 0
        if has_rich:
            rich_count = struct.unpack_from('<H', data, o)[0]
            o += 2
        if has_phonetic:
            phonetic_size = struct.unpack_from('<I', data, o)[0]
            o += 4
        char_size = 1 if compressed else 2
        char_bytes = nchars * char_size
        if o + char_bytes > len(data):
            char_bytes = len(data) - o
        if compressed:
            s = data[o: o + char_bytes].decode('latin-1', errors='replace')
        else:
            s = data[o: o + char_bytes].decode('utf-16-le', errors='replace')
        o += char_bytes
        o += rich_count * 4
        o += phonetic_size
        return s, o - offset

    # ---- Parse SST (may span CONTINUE records) ----
    # We do two passes: first collect all record positions, then parse
    saved_pos = pos
    pos = 0
    all_recs = []
    while pos < len(stream):
        if pos + 4 > len(stream):
            break
        rt = struct.unpack_from('<H', stream, pos)[0]
        rl = struct.unpack_from('<H', stream, pos + 2)[0]
        all_recs.append((pos, rt, rl))
        pos += 4 + rl

    # Find SST record and its CONTINUE blocks
    sst_data = b''
    i = 0
    while i < len(all_recs):
        rpos, rt, rl = all_recs[i]
        if rt == SST:
            sst_data = stream[rpos + 4: rpos + 4 + rl]
            j = i + 1
            while j < len(all_recs) and all_recs[j][1] == CONTINUE:
                cp, _, cl = all_recs[j]
                sst_data += stream[cp + 4: cp + 4 + cl]
                j += 1
            # parse SST
            if len(sst_data) >= 8:
                total_str = struct.unpack_from('<I', sst_data, 0)[0]
                unique_str = struct.unpack_from('<I', sst_data, 4)[0]
                sp = 8
                for _ in range(unique_str):
                    if sp >= len(sst_data):
                        break
                    s, consumed = read_unicode_string(sst_data, sp)
                    sst.append(s)
                    sp += consumed
            break
        i += 1

    # Parse cell records
    for rpos, rt, rl in all_recs:
        payload = stream[rpos + 4: rpos + 4 + rl]
        if rt == LABELSST:
            if len(payload) < 7:
                continue
            row = struct.unpack_from('<H', payload, 0)[0]
            col = struct.unpack_from('<H', payload, 2)[0]
            sst_idx = struct.unpack_from('<I', payload, 6)[0]
            val = sst[sst_idx] if sst_idx < len(sst) else ''
            rows.setdefault(row, {})[col] = val

        elif rt == NUMBER:
            if len(payload) < 14:
                continue
            row = struct.unpack_from('<H', payload, 0)[0]
            col = struct.unpack_from('<H', payload, 2)[0]
            val = struct.unpack_from('<d', payload, 6)[0]
            rows.setdefault(row, {})[col] = val

        elif rt == RK:
            if len(payload) < 6:
                continue
            row = struct.unpack_from('<H', payload, 0)[0]
            col = struct.unpack_from('<H', payload, 2)[0]
            rk_val = struct.unpack_from('<I', payload, 4)[0]
            rows.setdefault(row, {})[col] = decode_rk(rk_val)

        elif rt == MULRK:
            if len(payload) < 6:
                continue
            row = struct.unpack_from('<H', payload, 0)[0]
            col_first = struct.unpack_from('<H', payload, 2)[0]
            col_last = struct.unpack_from('<H', payload, len(payload) - 2)[0]
            rk_offset = 4
            for c in range(col_first, col_last + 1):
                if rk_offset + 6 > len(payload):
                    break
                rk_val = struct.unpack_from('<I', payload, rk_offset + 2)[0]
                rows.setdefault(row, {})[c] = decode_rk(rk_val)
                rk_offset += 6

        elif rt == LABEL:
            if len(payload) < 7:
                continue
            row = struct.unpack_from('<H', payload, 0)[0]
            col = struct.unpack_from('<H', payload, 2)[0]
            s, _ = read_unicode_string(payload, 6, rich=False, phonetic=False)
            rows.setdefault(row, {})[col] = s

        elif rt == DIMENSIONS:
            if len(payload) >= 10:
                dimensions = (
                    struct.unpack_from('<I', payload, 0)[0],
                    struct.unpack_from('<H', payload, 8)[0]
                )

    if not rows:
        return []

    max_row = max(rows.keys())
    result = []
    for ri in range(max_row + 1):
        if ri not in rows:
            result.append([])
            continue
        row_dict = rows[ri]
        max_col = max(row_dict.keys()) if row_dict else 0
        result.append([str(row_dict.get(c, '')) for c in range(max_col + 1)])
    return result


def _read_html_table(data):
    """生意参谋 / 淘宝 经常导出 HTML 表格但扩展名 .xls；用 html.parser 解析。"""
    from html.parser import HTMLParser
    text = None
    for enc in ('utf-8', 'gb18030', 'gbk', 'utf-16', 'latin-1'):
        try:
            text = data.decode(enc)
            break
        except Exception:
            continue
    if not text:
        return []
    head = text.lstrip()[:200].lower()
    if not (head.startswith('<') or '<table' in head or '<html' in head):
        return []

    class T(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.rows, self.cur, self.cell, self.in_cell = [], None, [], False
        def handle_starttag(self, tag, attrs):
            if tag == 'tr':
                self.cur = []
            elif tag in ('td', 'th'):
                self.in_cell = True; self.cell = []
            elif tag == 'br' and self.in_cell:
                self.cell.append(' ')
        def handle_endtag(self, tag):
            if tag in ('td', 'th') and self.in_cell:
                self.in_cell = False
                if self.cur is not None:
                    self.cur.append(''.join(self.cell).strip())
            elif tag == 'tr' and self.cur is not None:
                if any(c for c in self.cur):
                    self.rows.append(self.cur)
                self.cur = None
        def handle_data(self, d):
            if self.in_cell:
                self.cell.append(d)
    p = T()
    try:
        p.feed(text)
    except Exception:
        pass
    return p.rows


def read_xls_stdlib(path):
    """
    主入口：读取 .xls 文件，返回 (headers, list_of_dicts)
    支持三种格式：BIFF8 (真二进制 xls)、HTML 表格（伪 xls，淘系常用）、纯文本占位
    """
    with open(path, 'rb') as f:
        data = f.read()

    all_rows = []
    # 1) 优先尝试 OLE2/BIFF8
    try:
        stream = _extract_workbook_stream(data)
        if stream is not None:
            all_rows = _parse_biff8(stream) or []
    except Exception:
        all_rows = []

    # 2) BIFF 解析失败 → 尝试 HTML 表格（生意参谋常见伪 xls）
    if not all_rows:
        all_rows = _read_html_table(data)

    if not all_rows:
        return [], []

    # 找真正的表头行（跳过顶部注释行，找第一个非空列数 >= 5 的行）
    header_row_idx = 0
    for i, row in enumerate(all_rows[:15]):
        non_empty = [v for v in row if v.strip() and v.strip() not in ('0', '0.0')]
        if len(non_empty) >= 5:
            header_row_idx = i
            break

    headers = [str(v).strip() for v in all_rows[header_row_idx]]

    result = []
    for row in all_rows[header_row_idx + 1:]:
        if not any(str(v).strip() for v in row):
            continue
        d = {}
        for ci, h in enumerate(headers):
            d[h] = str(row[ci]).strip() if ci < len(row) else ''
        result.append(d)

    return headers, result
