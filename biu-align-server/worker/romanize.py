# 语种判定 + 转写：把每行歌词的每个字转成 MMS_FA 认识的字母串（a-z 和 '），和原文逐字对应。
# 依据与实测见 docs/lyrics/歌词时间轴对齐-多语言方案调研.md 4.1、4.2。
#   中文：拼音。写法与多语言之前的线上版本逐字相同，中文结果不能因为加了别的语种而变
#   日语：MeCab（unidic-lite）按上下文取读音，分回每个汉字 / 假名，再 uroman 转罗马字。
#        不能直接 uroman：它把汉字一律按中文读（花火 → huahuo）
#   韩语：每个谚文音节单独 uroman
#   英语不走这里，走歌声模型（singing.py），它要的是音素而不是字母
import re, unicodedata

KANA = re.compile(r'[぀-ヿ]')
HANGUL = re.compile(r'[가-힯]')
HAN = re.compile(r'[㐀-鿿々]')
SMALL = set('ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ')


def is_latin(c):
    return c.isascii() and c.isalpha() or (c.isalpha() and 'LATIN' in unicodedata.name(c, ''))


def detect(lines):
    # 整首判一次：日语歌词里的汉字单看分不出是中文还是日文，有假名就整首按日语读，汉字才拿得到日语读音。
    # 阈值 5 个字：中文歌词偶尔夹一两个「の」之类的装饰字，不能因此整首改按日语读
    t = ''.join(lines)
    if len(KANA.findall(t)) >= 5: return 'ja'
    if len(HANGUL.findall(t)) >= 5: return 'ko'
    if HAN.search(t): return 'zh'
    letters = [c for c in t if c.isalpha()]
    other = sum(1 for c in letters if not is_latin(c))
    # 俄语、泰语等 uroman 能转写，但没测过对齐效果，先不开
    if letters and other < 5: return 'en'
    return None


_U = None
_cache = {}
def ur(s):
    global _U
    if s not in _cache:
        if _U is None:
            import uroman
            _U = uroman.Uroman()
        _cache[s] = re.sub(r"[^a-z']", '', _U.romanize_string(s).lower())
    return _cache[s]


def latin(c):
    return c.lower() if c.isascii() and c.isalnum() else ''


def zh_line(text):
    from pypinyin import lazy_pinyin, Style
    return [lazy_pinyin(c, style=Style.NORMAL, v_to_u=False)[0].lower() if '一' <= c <= '鿿' else c.lower() for c in text]


def ko_line(text):
    return [ur(c) if HANGUL.match(c) else latin(c) for c in text]


def hira2kata(s):
    return ''.join(chr(ord(c) + 0x60) if 'ぁ' <= c <= 'ゖ' else c for c in s)


def kana_romaji(per):
    # 每个字的片假名读音 → 罗马字。拗音小字并到前一个字一起转（キャ → kya，不是 ki + ya）；
    # 促音、长音单独不发新音，不给字母，时间取前一个字
    out = [''] * len(per)
    groups = []
    for i, k in enumerate(per):
        if k and k[0] in SMALL and groups:
            j, prev = groups[-1]; groups[-1] = (j, prev + k)
        elif k:
            groups.append((i, k))
    for i, k in groups:
        if k in ('ッ', 'ー'): continue
        out[i] = ur(k)
    return out


def split_reading(rd, n):
    # 多个汉字共用一个读音时按音拍平均切（花火 ハナビ → ハナ / ビ）。只影响字内点亮，行起点仍来自音频
    mo = [ch for ch in rd if ch not in SMALL and ch != 'ー'] or [rd]
    cut = [round(len(mo) * i / n) for i in range(n + 1)]
    idx, cnt = [0], 0
    for ch in rd:
        if ch not in SMALL and ch != 'ー': cnt += 1
        idx.append(cnt)
    return [''.join(ch for ci, ch in enumerate(rd)
                    if cut[i] < idx[ci + 1] <= cut[i + 1] or (idx[ci + 1] == idx[ci] and cut[i] < idx[ci] <= cut[i + 1]))
            for i in range(n)]


_tagger = None
def ja_line(text):
    global _tagger
    if _tagger is None:
        import fugashi
        _tagger = fugashi.Tagger()
    per = [''] * len(text)
    pos = 0
    for w in _tagger(text):
        surf = w.surface
        at = text.find(surf, pos)
        if at < 0: continue
        pos = at + len(surf)
        f = w.feature
        reading = getattr(f, 'kana', None)
        if f.pos1 == '助詞' and surf in ('は', 'へ'):  # 助词按发音读 wa / e
            reading = 'ワ' if surf == 'は' else 'エ'
        if not reading or reading == '*':
            for k, c in enumerate(surf):
                per[at + k] = hira2kata(c) if KANA.match(c) else ''
            continue
        reading = hira2kata(reading)
        # 读音分回每个字：假名对假名，汉字串吃掉中间剩下的读音
        runs = re.findall(r'[぀-ヿ]+|[^぀-ヿ]+', surf)
        pat = ''.join(re.escape(hira2kata(r)) if KANA.match(r) else '(.+?)' for r in runs)
        m = re.fullmatch(pat, reading)
        if not m:
            per[at] = reading
            continue
        k, g = at, 1
        for r in runs:
            if KANA.match(r):
                for c in r: per[k] = hira2kata(c); k += 1
            else:
                rd = m.group(g); g += 1
                parts = [rd] if len(r) == 1 else split_reading(rd, len(r))
                for i, p in enumerate(parts): per[k + i] = p
                k += len(r)
    rom = kana_romaji(per)
    return [rom[i] if per[i] else latin(c) for i, c in enumerate(text)]


def romanize(lines, lang):
    return [{'zh': zh_line, 'ja': ja_line, 'ko': ko_line}[lang](t) for t in lines]
