"""从画面文字里找出歌词：用 B 站 AI 字幕的读音当锚点，只留「有人在唱」的那几行。

用法：python screen_lyrics.py <ocr.jsonl> <subtitle.json> <out.json>
  ocr.jsonl     每行 {"t","text","conf","box":[x,y,w,h]}，由 ocr.swift 输出
  subtitle.json [{"from","to","content"}]，客户端上传的 AI 字幕
  out.json      {"from": "screen"|"subtitle"|null, "lines": [{"t","text"}], "confident": bool}

参数全部来自 9 首填词歌的实测调参（docs/ideas/006-填词歌歌词识别.md），改之前先在没参与调参的歌上复测。
"""

import json
import re
import statistics
import sys
from collections import Counter
from difflib import SequenceMatcher

from pypinyin import Style, lazy_pinyin

STEP = 0.5
KEEP_MATCH = 0.4
# 吻合度中位数到这条线以上才算「画面歌词基本可信」；以下的都是书法 / 毛笔字体那几首
HIGH_MATCH = 0.8


def norm(s):
    return ''.join(re.findall(r'[一-鿿A-Za-z0-9]', s)).lower()


def py(s):
    return lazy_pinyin(s, style=Style.NORMAL, errors=lambda x: list(x))


def sim(a, b):
    return SequenceMatcher(None, a, b).ratio()


def load_ocr(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            r['n'] = norm(r['text'])
            r['cy'] = r['box'][1] + r['box'][3] / 2
            if r['n']:
                rows.append(r)
    return rows


# 相邻帧里同一高度的同一行字算一个事件。识别会在几种写法之间抖动，所以按相似度而不是全等来认
def build_events(rows):
    tracks, active = [], []
    by_t = {}
    for r in rows:
        by_t.setdefault(r['t'], []).append(r)
    for t in sorted(by_t):
        still = []
        for r in by_t[t]:
            best = None
            for tr in active:
                # 抖动不改长度；只是长得像的另一句歌词通常长度不同
                s = sim(tr['key'], r['n'])
                if abs(tr['cy'] - r['cy']) < 0.05 and (s >= 0.85 or (s >= 0.6 and len(tr['key']) == len(r['n']))):
                    best = tr
                    break
            if best is None:
                best = {'cy': r['cy'], 'key': r['n'], 'start': t, 'obs': []}
                tracks.append(best)
            best['end'] = t
            best['obs'].append(r)
            if best not in still:
                still.append(best)
        active = [tr for tr in active + still if t - tr['end'] <= 1.0]
        active = list({id(tr): tr for tr in active}.values())
    for tr in tracks:
        c = Counter(o['n'] for o in tr['obs'])
        tr['text'] = max(c, key=lambda k: (c[k], sum(o['conf'] for o in tr['obs'] if o['n'] == k)))
        tr['dur'] = tr['end'] - tr['start'] + STEP
    return tracks


# 同一行在不同帧上认错的字不一样，所以逐位投票
def consensus(ev):
    strings = [o['n'] for o in ev['obs']]
    base = Counter(strings).most_common(1)[0][0]
    votes = [Counter() for _ in base]
    for s in strings:
        for op, i1, i2, j1, j2 in SequenceMatcher(None, base, s, autojunk=False).get_opcodes():
            if op in ('equal', 'replace') and i2 - i1 == j2 - j1:
                for k in range(i2 - i1):
                    votes[i1 + k][s[j1 + k]] += 1
    return ''.join(v.most_common(1)[0][0] if v else base[i] for i, v in enumerate(votes))


# 这行画面文字在字幕的哪一段被唱出来？只比读音：画面认错是形近字，听写错是同音字，两边错的地方不一样
def best_window(sy, sub_sy):
    n, best, best_win = len(sy), 0.0, []
    for start in range(0, max(1, len(sub_sy) - n + 1)):
        for ln in (n - 1, n, n + 1):
            win = sub_sy[start:start + ln]
            if win:
                r = SequenceMatcher(None, sy, win, autojunk=False).ratio()
                if r > best:
                    best, best_win = r, win
    return best, best_win


# 合唱视频常在每行前标演唱者（「蕾」「藤」），没人唱，对齐时会被当成要唱的字。
# 只认「行首 1 个字在字幕里找不到读音、而且同一个字开头的这种行很多」：
# 单看「找不到读音」不行，AI 字幕常听错第一个字，9 首里有 6 首会被误删真歌词
def unsung_head(text, sy, win):
    blocks = [b for b in SequenceMatcher(None, sy, win, autojunk=False).get_matching_blocks() if b.size]
    return text[0] if blocks and blocks[0].a == 1 and len(text) >= 4 else None


def strip_singer_tags(lines):
    heads = Counter(o[4] for o in lines if o[4])
    tags = {c for c, n in heads.items() if n >= 3 and n >= 0.15 * len(lines)}
    return [(o[0], o[1][1:] if o[4] in tags else o[1], o[2], o[3]) for o in lines]


def screen_lines(rows, sub_text):
    if not rows:
        return []
    video_dur = max(r['t'] for r in rows) + STEP
    evs = build_events(rows)
    on_screen = {}
    for e in evs:
        on_screen[e['text']] = on_screen.get(e['text'], 0) + e['dur']
    sub_sy = py(norm(sub_text))
    out = []
    for e in sorted(evs, key=lambda e: e['start']):
        # 水印、免责声明一直挂在屏幕上
        if on_screen[e['text']] >= 0.3 * video_dur:
            continue
        text = consensus(e)
        sy = py(text)
        score, win = best_window(sy, sub_sy)
        if score >= KEEP_MATCH:
            out.append((e['start'], text, score, e['cy'], unsung_head(text, sy, win)))
    out = strip_singer_tags(out)
    # 歌词固定在一两条「车道」上；梗图配字、游戏界面偶尔也能碰上几个音，用长且吻合度高的行学出车道位置
    anchors = sorted(o[3] for o in out if o[2] >= 0.8 and len(o[1]) >= 5)
    lanes = []
    for y in anchors:
        if lanes and y - lanes[-1][-1] < 0.03:
            lanes[-1].append(y)
        else:
            lanes.append([y])
    lanes = [l for l in lanes if len(l) >= max(3, 0.15 * len(anchors))]
    out = [o for o in out if len(o[1]) >= 3 and any(min(l) - 0.03 <= o[3] <= max(l) + 0.03 for l in lanes)]

    # 卡拉 OK 式逐字出现、同一行的几种认法会在附近出现好几版，只留最完整、最吻合的那一版。
    # 窗口必须是 1.5 秒：放宽到 4 秒会把真实重复的副歌当成抖动删掉（欧气 7.9% → 14.9%）
    def covered(a, b):
        sa, sb = py(a[1]), py(b[1])
        m = sum(x.size for x in SequenceMatcher(None, sa, sb, autojunk=False).get_matching_blocks())
        return m >= 0.6 * len(sa)

    return [
        o for i, o in enumerate(out)
        if not any(
            j != i and abs(p[0] - o[0]) <= 1.5 and covered(o, p) and (len(p[1]), p[2]) > (len(o[1]), o[2])
            for j, p in enumerate(out)
        )
    ]


def decide(rows, subtitle):
    sub = [s for s in subtitle if norm(s['content'])]
    if not sub:
        return {'from': None, 'lines': [], 'confident': False}
    lines = screen_lines(rows, '\n'.join(s['content'] for s in sub))
    # 画面上找到的行太少 = 视频没把歌词打在画面上，找到的只是碰巧对上几个音的杂字
    if len(lines) >= 5 and len(lines) * 3 >= len(sub):
        return {
            'from': 'screen',
            'lines': [{'t': round(t, 2), 'text': text} for t, text, _, _ in lines],
            'confident': statistics.median(l[2] for l in lines) >= HIGH_MATCH,
        }
    return {
        'from': 'subtitle',
        'lines': [{'t': round(float(s['from']), 2), 'text': s['content'].replace('♪', '').strip()} for s in sub],
        'confident': False,
    }


if __name__ == '__main__':
    ocr_path, sub_path, out_path = sys.argv[1:4]
    with open(sub_path, encoding='utf-8') as f:
        subtitle = json.load(f)
    result = decide(load_ocr(ocr_path), subtitle)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False)
