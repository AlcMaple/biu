# 歌词时间轴对齐 worker：Demucs 分离人声 → MMS_FA 强制对齐（中文转拼音）。由 Node 服务按任务逐个拉起，跑完即退出。
# 每任务一个进程而不是常驻：两个模型加起来要 3~4 GB 内存，Mac mini 上还跑着别的服务，空闲时不该一直占着。
# 算法与参数的来历见 docs/lyrics/歌词时间轴对齐-可行方案调研.md 5.2.9 ~ 5.2.14，改这里之前先读那几节。
#
# 用法：python align.py <音频> <歌词.json> <输出.json> <工作目录>
#   歌词.json：[{"t": 原时间秒（没有时填 0）, "text": "一行歌词"}, …]，已由 Node 侧清洗过
#   输出.json：{"lines": [{"text", "chars", "t", "score", "repaired"}], "offset", "frameMs"}
# 失败时向 stderr 打一行 "ALIGN_ERROR <代码> <说明>" 并以非 0 退出，Node 侧据此分类错误文案。
import json, os, re, shutil, subprocess, sys
import numpy as np, soundfile as sf, scipy.signal as ss, torch, torchaudio
import torchaudio.functional as F
from pypinyin import lazy_pinyin, Style


def fail(code, msg):
    print(f'ALIGN_ERROR {code} {msg}', file=sys.stderr, flush=True)
    sys.exit(2)


audio, lyrics_path, out_path, workdir = sys.argv[1:5]
rows = json.load(open(lyrics_path, encoding='utf-8'))
if not rows: fail('LYRICS_EMPTY', '歌词为空')

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
lines, orig_t = [r['text'] for r in rows], [float(r.get('t') or 0) for r in rows]
out, line_tok = [], []
for text in lines:
    o = {'text': text, 'chars': [], 't': [], 'score': 0.0}; lt = []
    for c in text:
        if not c.strip() or PUNCT.match(c): continue
        rom = lazy_pinyin(c, style=Style.NORMAL, v_to_u=False)[0].lower() if '一' <= c <= '鿿' else c.lower()
        ids = [DICT[x] for x in rom if x in DICT and x != '*']
        o['chars'].append(c); o['t'].append(None)
        lt += [(x, len(o['chars']) - 1) for x in ids]
    out.append(o); line_tok.append(lt)
if not any(line_tok): fail('LYRICS_UNSUPPORTED', '歌词里没有可对齐的中文或拉丁字母')


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


def squeezed(ts, chars):
    cjk = [t for c, t in zip(chars, ts) if not c.isascii()]
    return len(cjk) >= 4 and np.median(np.diff(cjk)) < 0.15


# 局部重对齐：中文字中位字距 < 0.15 s 是唱不出来的速度，说明整首对齐在这里丢了位置。对这行和它前一行（被拉长的往往是
# 前一行行尾），只在「原歌词时间 + 整首中位偏移」±0.6 s 的窗口里单独再对齐一次，逐字时间仍来自音频。
# 不回退到「原歌词时间 + 均匀填充」：人耳试听里这类行都跟不上（调研 5.2.13）。两道闸防止现场版 / 剪辑版被挪错：
# 被连带的前一行起点挪动 > 1 s 不收；挤压行重对齐后必须变松。原歌词没有时间（纯文本）时跳过。
offset = 0.0
if any(orig_t):
    offset = float(np.median([o['t'][0] - t for o, t in zip(out, orig_t) if o['t']]))
    bad = sorted({j for i, o in enumerate(out) if o['chars'] and squeezed(o['t'], o['chars'])
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
        if squeezed(out[li]['t'], out[li]['chars']):
            ok = not squeezed(new, out[li]['chars']) or np.median(np.diff(new)) > np.median(np.diff(out[li]['t']))
        else:
            ok = abs(new[0] - out[li]['t'][0]) <= 1.0
        if ok:
            out[li]['t'] = new; out[li]['repaired'] = True
            if sc: out[li]['score'] = round(float(np.mean(sc)), 4)

json.dump({'lines': out, 'offset': round(offset, 3), 'frameMs': round(spf * 1000, 2)},
          open(out_path, 'w', encoding='utf-8'), ensure_ascii=False)
