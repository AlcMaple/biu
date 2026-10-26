"""从画面文字里找出歌词：用 B 站 AI 字幕的读音当锚点，只留「有人在唱」的那几行；没有字幕时按车道和换句节奏认。

用法：python screen_lyrics.py <ocr.jsonl> <subtitle.json> <out.json>
  ocr.jsonl     每行 {"t","text","conf","box":[x,y,w,h]}，由 ocr.swift 输出
  subtitle.json [{"from","to","content"}]，客户端上传的 AI 字幕
  out.json      {"from": "screen"|"subtitle"|null, "lines": [{"t","text","translation"?}], "confident": bool}

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


# 认出来的标记不删，挪到 tag 里，输出时写成「蕾：」：和画面原文带冒号的写法一致，对齐时统一跳过
def strip_singer_tags(lines):
    heads = Counter(o[4] for o in lines if o[4])
    tags = {c for c, n in heads.items() if n >= 3 and n >= 0.15 * len(lines)}
    return [
        (o[0], o[1][1:], o[2], o[3], o[4], o[5]) if o[4] in tags else (o[0], o[1], o[2], o[3], None, o[5])
        for o in lines
    ]


# 卡拉 OK 式逐字出现、同一行的几种认法会在附近出现好几版，只留最完整、最吻合的那一版。
# 窗口必须是 1.5 秒：放宽到 4 秒会把真实重复的副歌当成抖动删掉（欧气 7.9% → 14.9%）
def drop_partials(out):
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
            out.append((e['start'], text, score, e['cy'], unsung_head(text, sy, win), e))
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

    return drop_partials(out)


CREDIT = re.compile(r'^(原唱|演唱|填词|作词|作曲|编曲|混音|调教|曲绘|剪辑|视频|封面|策划|美工|和声|后期|字幕|原曲|出品|监制|画师|pv|mv|母带|人声)')


# 没有 AI 字幕时没法问「这行有没有人唱」，只能看字在画面上怎么出现：歌词占着一条车道，一行接一行换新句；
# 水印也占车道，但翻来覆去是同一串字（bilibili 的各种认法），所以按「互不相像的句子数」挑车道，而不是按事件数
def screen_only_lines(rows):
    if not rows:
        return [], 0.0, 0.0
    video_dur = max(r['t'] for r in rows) + STEP
    evs = build_events(rows)
    on_screen = {}
    for e in evs:
        on_screen[e['text']] = on_screen.get(e['text'], 0) + e['dur']
    evs = [e for e in evs if on_screen[e['text']] < 0.3 * video_dur]
    for e in evs:
        e['h'] = statistics.median(o['box'][3] for o in e['obs'])
    lanes = []
    for e in sorted((e for e in evs if len(e['text']) >= 4 and 0.8 <= e['dur'] <= 12), key=lambda e: e['cy']):
        lane = next((l for l in lanes if abs(l['cy'] - e['cy']) < 0.025 and abs(l['h'] - e['h']) < 0.3 * l['h']), None)
        if lane is None:
            lanes.append({'cy': e['cy'], 'h': e['h'], 'reps': [e['text']]})
        elif not any(sim(e['text'], r) >= 0.5 for r in lane['reps']):
            lane['reps'].append(e['text'])
    if not lanes:
        return [], 0.0, 0.0
    top = max(len(l['reps']) for l in lanes)
    # 对唱 / 双语会用两条车道，第二条的句子数和第一条同一量级；制作名单、梗图配字那几条只有零星几句
    lanes = [l for l in lanes if len(l['reps']) >= max(8, 0.4 * top)]
    kept = [
        e for e in sorted(evs, key=lambda e: e['start'])
        if len(e['text']) >= 2 and not CREDIT.match(e['text'])
        and any(abs(e['cy'] - l['cy']) < 0.03 and abs(e['h'] - l['h']) < 0.35 * l['h'] for l in lanes)
    ]
    if not kept:
        return [], 0.0, 0.0
    # 书法 / 毛笔字体每帧认出来的字都不一样，清楚的印刷字体几乎每帧一致：9 首里前者 0.75、后者 1.00，
    # 这几首就算拼出来错字率也在 35% 以上，读不通，宁可记查无
    agree = statistics.median(sum(o['n'] == e['text'] for o in e['obs']) / len(e['obs']) for e in kept)
    kept = [e for e in kept if not exit_fragment(e, kept)]
    lines = drop_partials([(e['start'], consensus(e), 0.0, e['cy'], None, e) for e in kept])
    return lines, agree, sing_rate(kept)


# 上一句淡出 / 飞出的那一帧会被认成残句（「notsayaword」「明弱是方」）：只停半秒，紧贴着上一句结束，字都被上一句包含
def exit_fragment(e, evs):
    if e['dur'] > STEP:
        return False
    sy = py(e['text'])
    for p in evs:
        if p is e or len(p['text']) <= len(e['text']) or abs(p['start'] + p['dur'] - e['start']) > 1.0:
            continue
        m = sum(b.size for b in SequenceMatcher(None, sy, py(p['text']), autojunk=False).get_matching_blocks())
        # 残句那一帧本身也认不准（「明明是为」→「明弱是方」），所以门槛比去重的 0.6 低
        if m >= 0.5 * len(sy):
            return True
    return False


# 说话的字幕（小剧场、采访）在画面上和歌词长得一样，只能靠语速分：实测说话约 6 字/秒，歌词不超过 3.3 字/秒。
# 双语画面只看中文那行：英文字母数和音节数换算不稳，混进来会把说话的语速拉低到歌词的范围；纯英文按 3 个字母折一个音节
def sing_rate(evs):
    han = [e for e in evs if re.search(r'[一-鿿]', e['text'])]
    if han:
        return statistics.median(len(re.findall(r'[一-鿿]', e['text'])) / e['dur'] for e in han)
    return statistics.median(len(e['text']) / 3 / e['dur'] for e in evs) if evs else 0.0


LATIN = re.compile(r'[A-Za-z]')
HAN = re.compile(r'[一-鿿]')


# 投票和比对都在去掉标点、转小写后的文字上做；给人看的要换回画面原文，英文才有大小写和空格，
# 「合：」这类冒号标记也才留得住。投票改过字时没有一帧和它完全一样，中文就用投票结果，英文取最像的那一帧
def display(text, ev, tag=None):
    full = (tag or '') + text
    raws = Counter(re.sub(r'\s+', ' ', o['text']).strip() for o in ev['obs'] if o['n'] == full)
    if raws:
        raw = raws.most_common(1)[0][0]
    elif LATIN.search(full):
        raw = re.sub(r'\s+', ' ', max(ev['obs'], key=lambda o: sim(o['n'], full))['text']).strip()
    else:
        raw = full
    if tag:
        rest = raw[len(tag):].lstrip(':： ') if raw.startswith(tag) else text
        return f'{tag}：{rest}'
    return raw


# 斜体英文常被认丢空格（mysight、Imiss）、把 I 认成 l / 1 / /。用 macOS 自带词表补：只在整词不认识、
# 拆开的两半都认识、且至少一半是常用词时才拆，人名、拼错的词不会被乱切（实测坏女孩 15 处全修好，采访视频里只误拆已经认糊的词）
WORDS_FILE = '/usr/share/dict/words'
COMMON = set(
    'the a an and or but so to of in on at by for from with as is are was were be been am do does did have has had '
    'i you he she it we they me him her us them my your his its our their this that what who where when why how not '
    'no all just only can will would could should may might must go come get got love like know see say want need '
    'feel make take give tell let back now then there here up down out over away one two time night day way life '
    'heart dear baby girl boy'.split()
)
SUFFIXES = ('s', 'es', 'ed', 'd', 'ing', "'s", "'re", "'ll", "'ve", "'m", "'d", "n't")
_words = None


def known(w):
    global _words
    if _words is None:
        try:
            with open(WORDS_FILE, encoding='utf-8') as f:
                _words = {x.strip().lower() for x in f} | {"i'm", "can't", "don't", "won't"}
        except OSError:
            _words = set()
    w = w.lower()
    if w in _words:
        return True
    for suf in SUFFIXES:
        stem = w[:-len(suf)]
        if w.endswith(suf) and len(stem) >= 2:
            # loved → love、stopped → stop
            if stem in _words or stem + 'e' in _words or (len(stem) >= 3 and stem[-1] == stem[-2] and stem[:-1] in _words):
                return True
    return False


def split_word(tok):
    m = re.match(r"^([A-Za-z']+)([^A-Za-z']*)$", tok)
    if not m or known(m[1]):
        return tok
    w = m[1]
    for i in range(1, len(w)):
        a, b = w[:i], w[i:]
        if all((len(x) >= 2 or x == 'I') and known(x) for x in (a, b)) and (a.lower() in COMMON or b.lower() in COMMON):
            return f'{a} {b}{m[2]}'
    return tok


def fix_latin(line):
    m = re.match(r"^[1l/|]([a-z']+)", line)
    if m and not known(line.split(' ')[0]) and known(m[1]):
        line = 'I ' + line[1:]
    return ' '.join(split_word('I' if t in ('l', '1', '/', '|') else t) for t in line.split(' '))


def is_latin_line(text):
    return len(LATIN.findall(text)) > len(HAN.findall(text))


# 上行英文唱词、下行中文翻译是同一句歌词：同时出现、同时消失。英文进歌词、中文进翻译；
# 中文混进歌词的话，对齐会整首按中文读，英文逐词对齐就做不成了。
# 双语视频里没配上对的中文行是淡出残句或只有翻译的字幕，丢掉；不是双语视频（配上的不到一半）就原样输出
def pair_bilingual(lines):
    latin = [l for l in lines if is_latin_line(l['text'])]
    han = [l for l in lines if not is_latin_line(l['text'])]
    used = set()
    for l in latin:
        mate = min(
            (h for h in han if id(h) not in used and abs(h['t'] - l['t']) <= 0.5),
            key=lambda h: abs(h['t'] - l['t']),
            default=None,
        )
        if mate:
            used.add(id(mate))
            l['translation'] = mate['text']
    if len(used) < 5 or len(used) < 0.5 * len(latin):
        for l in latin:
            l.pop('translation', None)
        return lines
    return latin


def output(lines):
    rows = [{'t': round(o[0], 2), 'text': display(o[1], o[5], o[4])} for o in lines]
    for r in rows:
        if is_latin_line(r['text']):
            r['text'] = fix_latin(r['text'])
    return pair_bilingual(rows)


def decide(rows, subtitle):
    sub = [s for s in subtitle if norm(s['content'])]
    if not sub:
        lines, agree, rate = screen_only_lines(rows)
        if len(lines) < 12 or agree < 0.9 or rate > 4.5:
            return {'from': None, 'lines': [], 'confident': False}
        # 没有字幕交叉核对，形近字纠不了，一律算「可能有错字」
        return {'from': 'screen', 'lines': output(lines), 'confident': False}
    lines = screen_lines(rows, '\n'.join(s['content'] for s in sub))
    # 画面上找到的行太少 = 视频没把歌词打在画面上，找到的只是碰巧对上几个音的杂字
    if len(lines) >= 5 and len(lines) * 3 >= len(sub):
        return {
            'from': 'screen',
            'lines': output(lines),
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
