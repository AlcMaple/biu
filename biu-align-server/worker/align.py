# 歌词时间轴对齐 worker：Demucs 分离人声 → 强制对齐。由 Node 服务按任务逐个拉起，跑完即退出。
#   中文 / 日语 / 韩语：MMS_FA，先按语种转成字母（romanize.py）
#   英语：在歌声上训练的音素模型（singing.py）
# 每任务一个进程而不是常驻：两个模型加起来要 3~4 GB 内存，Mac mini 上还跑着别的服务，空闲时不该一直占着。
# 算法与参数的来历：中文见 docs/lyrics/歌词时间轴对齐-可行方案调研.md 5.2.9 ~ 5.2.14；其他语种见
# docs/lyrics/歌词时间轴对齐-多语言方案调研.md。改这里之前先读那几节。
#
# 用法：python align.py <音频> <歌词.json> <输出.json> <工作目录>
#   歌词.json：[{"t": 原时间秒（没有时填 0）, "text": "一行歌词"}, …]，已由 Node 侧清洗过
#   输出.json：{"lang", "lines": [{"text", "chars", "t", "t0", "score", "repaired"}], "offset", "frameMs", "timelineMatch"}
#     t0 = 修复前的行起点；timelineMatch 见 repair.py，原歌词没有时间时为 null
# 失败时向 stderr 打一行 "ALIGN_ERROR <代码> <说明>" 并以非 0 退出，Node 侧据此分类错误文案。
import json, os, re, shutil, subprocess, sys
import numpy as np, soundfile as sf, scipy.signal as ss, torch, torchaudio
import torchaudio.functional as F

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from repair import repair_outliers, timeline_match
from romanize import detect, romanize


def fail(code, msg):
    print(f'ALIGN_ERROR {code} {msg}', file=sys.stderr, flush=True)
    sys.exit(2)


audio, lyrics_path, out_path, workdir = sys.argv[1:5]
rows = json.load(open(lyrics_path, encoding='utf-8'))
if not rows: fail('LYRICS_EMPTY', '歌词为空')
lines, orig_t = [r['text'] for r in rows], [float(r.get('t') or 0) for r in rows]
LANG = detect(lines)
if LANG is None: fail('LYRICS_UNSUPPORTED', '歌词里没有可对齐的中文、日文、韩文或英文')

# 离线评测时用已分离好的人声，跳过 1.5 min 的 Demucs；服务里不设这个变量
def to_wav(src, dst):
    # Demucs 读 m4a 要靠 ffmpeg；部署用的 Mac mini 没装 ffmpeg，而系统自带的 afconvert 能直接读 B 站的 DASH 音频。
    # 先转成 wav，两种部署环境都能跑：有 ffmpeg 用 ffmpeg（Linux），没有就用 afconvert（macOS）
    if shutil.which('ffmpeg'):
        cmd = ['ffmpeg', '-v', 'error', '-y', '-i', src, '-ac', '2', '-ar', '44100', dst]
    elif shutil.which('afconvert'):
        cmd = ['afconvert', '-f', 'WAVE', '-d', 'LEI16@44100', src, dst]
    else:
        fail('SEPARATION_FAILED', '找不到 ffmpeg 或 afconvert，无法解码音频')
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(dst):
        fail('SEPARATION_FAILED', f'音频解码失败：{(r.stderr or r.stdout).strip()[:300]}')


vocals = os.environ.get('BIU_ALIGN_VOCALS')
if not vocals:
    wav_in = os.path.join(workdir, 'input.wav')
    to_wav(audio, wav_in)
    # Apple 芯片上 Demucs 走 MPS 会报错或结果异常，固定用 CPU
    r = subprocess.run([sys.executable, '-m', 'demucs', '-d', 'cpu', '--two-stems', 'vocals', '-o', workdir, wav_in],
                       capture_output=True, text=True)
    if r.returncode != 0:
        tail = (r.stderr or r.stdout).strip().splitlines()
        fail('SEPARATION_FAILED', tail[-1][:300] if tail else 'demucs 退出码非 0')
    vocals = os.path.join(workdir, 'htdemucs', 'input', 'vocals.wav')
if not os.path.exists(vocals): fail('SEPARATION_FAILED', '没有生成人声轨')


def write_output(out, offset, frame_ms):
    json.dump({'lang': LANG, 'lines': out, 'offset': round(offset, 3), 'frameMs': frame_ms,
               'timelineMatch': timeline_match(out, orig_t)},
              open(out_path, 'w', encoding='utf-8'), ensure_ascii=False)


if LANG == 'en':
    import singing
    al = singing.Aligner(vocals, lines)
    if not any(al.line_tok): fail('LYRICS_UNSUPPORTED', '歌词里没有可对齐的英文单词')
    try:
        res = al.align_all()
    except (ValueError, RuntimeError):
        fail('AUDIO_TOO_SHORT', '音频比歌词短，放不下这么多词')
    out, last = [], 0.0
    for li, text in enumerate(lines):
        ts, sc = res[li]
        chars = al.lines[li][0]
        # 整行没有可发音的词（如纯数字）：沿用上一行的结束时间，和 MMS 路径对数字的处理一致
        out.append({'text': text, 'chars': chars, 't': ts or [last] * len(chars),
                    'score': round(float(np.mean(sc)), 4) if sc else 0.0, 't0': ts[0] if ts else None})
        if out[-1]['t']: last = out[-1]['t'][-1]
    offset = 0.0
    if any(orig_t):
        offset = float(np.median([o['t0'] - t for o, t in zip(out, orig_t) if o['t0'] is not None]))
        repair_outliers(out, orig_t, al.has_tokens, al.align_line, singing.RES, al.n_frames, scan=True)
    write_output(out, offset, round(singing.RES * 1000, 2))
    sys.exit(0)

bundle = torchaudio.pipelines.MMS_FA
model = bundle.get_model(with_star=True).eval()
DICT = bundle.get_dict(star='*')
y, sr = sf.read(vocals); y = y.mean(axis=1) if y.ndim > 1 else y
wav = torch.from_numpy(ss.resample_poly(y, 16000, sr).astype(np.float32))[None]

# 发射概率按 15 s 一块算（整首一次过 wav2vec2 自注意力内存会爆）。块边缘附近模型只看到单侧上下文，唱得含糊的句子
# 会丢位置（跳楼机「又急速落地」压在 90 s 边界上被挤到下一行）。所以按 0 和半块两种起点各切一遍取平均，
# 任何时刻至少有一份离块边缘 ≥ 3.75 s（调研 5.2.14）。
CHUNK = 16000 * 15
def chunked(shift):
    starts = sorted({0, *range(shift, wav.shape[1], CHUNK)})
    with torch.inference_mode():
        return torch.cat([model(wav[:, a:b])[0] for a, b in zip(starts, starts[1:] + [wav.shape[1]]) if b - a > 400], dim=1)
em1, em2 = chunked(0), chunked(CHUNK // 2)
n = min(em1.shape[1], em2.shape[1])
em = torch.logsumexp(torch.stack([em1[:, :n], em2[:, :n]]), 0) - np.log(2)
spf = wav.shape[1] / em.shape[1] / 16000

# 静音门控：人声轨几乎无能量的帧只允许 blank / <star>。不加时前奏里的静音段会吸走首行——
# 晴天 Hi-Res 前 29 s 人声为 0，首行仍被放在 2.8 s（调研 5.2.11）。阈值 = 整首 90 分位能量的 2%，前后各扩 0.3 s 保住辅音起头。
hop = wav.shape[1] / n
w = wav[0].numpy()
rms = np.array([np.sqrt(np.mean(w[int(i * hop):int((i + 1) * hop)] ** 2) + 1e-12) for i in range(n)])
voiced = rms > 0.02 * np.percentile(rms, 90)
pad = int(round(0.3 / spf))
voiced = np.convolve(voiced.astype(float), np.ones(2 * pad + 1), 'same') > 0
keep = torch.zeros(em.shape[2], dtype=torch.bool); keep[0] = True; keep[DICT['*']] = True
silent = torch.from_numpy(~voiced).nonzero().squeeze(1)
em[0, silent[:, None], (~keep).nonzero().squeeze(1)[None, :]] = -1e4

PUNCT = re.compile(r'[\W_]', re.U)
out, line_tok, word_start = [], [], []
for text, roms in zip(lines, romanize(lines, LANG)):
    o = {'text': text, 'chars': [], 't': [], 'score': 0.0}; lt = []; ws = []; prev = ' '
    for c, rom in zip(text, roms):
        if not c.strip() or PUNCT.match(c): prev = c; continue
        ws.append(not (c.isascii() and c.isalnum() and prev.isascii() and prev.isalnum())); prev = c
        ids = [DICT[x] for x in rom if x in DICT and x != '*']
        o['chars'].append(c); o['t'].append(None)
        lt += [(x, len(o['chars']) - 1) for x in ids]
    out.append(o); line_tok.append(lt); word_start.append(ws)
if not any(line_tok): fail('LYRICS_UNSUPPORTED', '歌词里没有可对齐的字')


def align(em_part, which):
    # 行与行之间插 <star>，吸收歌词里没有的和声 / 即兴
    tokens, owner = [DICT['*']], [None]
    for li in which:
        for x, ci in line_tok[li]: tokens.append(x); owner.append((li, ci))
        tokens.append(DICT['*']); owner.append(None)
    if em_part.shape[1] < len(tokens): raise ValueError('音频比歌词短')
    aligned, scores = F.forced_align(em_part.contiguous(), torch.tensor([tokens], dtype=torch.int32), blank=0)
    spans = F.merge_tokens(aligned[0], scores[0].exp())
    got = {li: ([None] * len(out[li]['chars']), []) for li in which}
    for sp, ow in zip(spans, owner):
        if not ow: continue
        t, sc = got[ow[0]]
        if t[ow[1]] is None: t[ow[1]] = sp.start
        sc.append(float(sp.score))
    return got


def fill(ts):  # 没有可发音字母的字（如数字）取前一个字的时间
    last = None
    for k, t in enumerate(ts):
        if t is None: ts[k] = last if last is not None else next((x for x in ts if x is not None), 0.0)
        last = ts[k]
    return ts


try:
    res = align(em, range(len(lines)))
except ValueError:
    fail('AUDIO_TOO_SHORT', '音频比歌词短，放不下这么多字')
for li, (fr, sc) in res.items():
    out[li]['t'] = fill([None if f is None else round(f * spf, 3) for f in fr])
    out[li]['score'] = round(float(np.mean(sc)), 4) if sc else 0.0
    out[li]['t0'] = out[li]['t'][0] if out[li]['t'] else None


def squeezed(ts, chars, ws):
    # 中文跳过所有 ASCII 字符（和多语言之前一致）；日韩歌里的拉丁字母按词计，只取词首字母的时间，
    # 否则 baby 这种词的几个字母挤在一起会被误当成挤压
    pts = [t for c, t in zip(chars, ts) if not c.isascii()] if LANG == 'zh' else [t for t, w in zip(ts, ws) if w]
    return len(pts) >= 4 and np.median(np.diff(pts)) < 0.15


# 局部重对齐：中文字中位字距 < 0.15 s 是唱不出来的速度，说明整首对齐在这里丢了位置。对这行和它前一行（被拉长的往往是
# 前一行行尾），只在「原歌词时间 + 整首中位偏移」±0.6 s 的窗口里单独再对齐一次，逐字时间仍来自音频。
# 不回退到「原歌词时间 + 均匀填充」：人耳试听里这类行都跟不上（调研 5.2.13）。两道闸防止现场版 / 剪辑版被挪错：
# 被连带的前一行起点挪动 > 1 s 不收；挤压行重对齐后必须变松。原歌词没有时间（纯文本）时跳过。
offset = 0.0
if any(orig_t):
    offset = float(np.median([o['t'][0] - t for o, t in zip(out, orig_t) if o['t']]))
    bad = sorted({j for i, o in enumerate(out) if o['chars'] and squeezed(o['t'], o['chars'], word_start[i])
                  for j in (i - 1, i) if j >= 0 and out[j]['chars']})
    for li in bad:
        lo = orig_t[li] + offset - 0.6
        hi = (orig_t[li + 1] if li + 1 < len(lines) else orig_t[li] + 8) + offset + 0.6
        f0, f1 = max(0, int(lo / spf)), min(em.shape[1], int(hi / spf))
        if f1 - f0 < 2 * len(line_tok[li]) + 2: continue
        try:
            fr, sc = align(em[:, f0:f1], [li])[li]
        except ValueError:
            continue
        new = fill([None if f is None else round((f + f0) * spf, 3) for f in fr])
        if squeezed(out[li]['t'], out[li]['chars'], word_start[li]):
            ok = not squeezed(new, out[li]['chars'], word_start[li]) or np.median(np.diff(new)) > np.median(np.diff(out[li]['t']))
        else:
            ok = abs(new[0] - out[li]['t'][0]) <= 1.0
        if ok:
            out[li]['t'] = new; out[li]['repaired'] = True
            if sc: out[li]['score'] = round(float(np.mean(sc)), 4)

    # 外语再做离群行局部重对齐（repair.py）；中文只用上面的挤压重对齐，结果和多语言之前逐字相同
    if LANG != 'zh':
        def align_line(f0, f1, li):
            if f1 - f0 < 2 * len(line_tok[li]) + 2: raise ValueError('窗口太短')
            fr, sc = align(em[:, f0:f1], [li])[li]
            return fill([None if f is None else round((f + f0) * spf, 3) for f in fr]), sc
        repair_outliers(out, orig_t, lambda i: bool(line_tok[i]), align_line, spf, em.shape[1])

write_output(out, offset, round(spf * 1000, 2))
