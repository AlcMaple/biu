# 离群行局部重对齐（只对外语；中文仍只用 align.py 里的挤压重对齐，结果和多语言之前逐字相同）。
# 依据与实测见 docs/lyrics/歌词时间轴对齐-多语言方案调研.md 4.4、4.8。
#
# 要修的是：整首对齐在某一行丢了位置。英语常见行首被提前吸到伴唱 / 前奏上（Blinding Lights 第 2 行前三个词提前 2.2 s），
# 或者重复短句整段错一个轮次（Counting Stars「Take that money」、Faded「Another dream」）。
# 判定：这一行「对齐起点 − 原歌词时间」和前后各 5 行同一差值的中位数差出 0.5 s 以上。前后几行一致，说明这一段原歌词
# 时间对这份录音可信，唯独这一行错了。逐字时间仍然来自音频，不回退到原歌词时间（中文阶段人耳已否决回退）。
#
# 每行先试「窗口法」：在「原时间 + 本地偏移」前 0.6 s 到下一行之间整窗对齐这一行。三道闸全部满足才采纳——
#   新起点离预期 ≤ 0.5 s，且比旧起点更近；
#   新置信度 ≥ 旧的 85%，旧位置和前后行顺序颠倒时免掉这条。
#   为什么不是「必须更高」：Blinding 第 2 行挪回去就和真值一致，整行平均置信度却从 0.178 降到 0.171（挤错的只是几个短词）。
#   为什么还要 85%：Someone Like You 有两行是网易云原时间本身错了，没有这道闸会被「修」到错的原时间上，那两行只剩 80% ~ 82%。
#   为什么顺序颠倒就免：错位到同一句的上一遍时，那里也真的唱了这几个词，置信度天然一样高，这道闸永远过不去。
# 窗口法失败再试「扫描」（scan=True，目前只给英语歌声模型；MMS 上没测过）：长窗里 CTC 会把首个音素拉长，起点被拖到窗口
# 前部的弱匹配上（Faded「Another dream」整窗给 145.17 s，真值 146.24 s）。改为在预期 ±1.5 s 内每 0.1 s 放一个短窗，
# 取平均置信度最高处；距离闸放宽到 1.5 s，因为网易云对这类行的时间本身可能早 1 s 以上，作为代价要求新位置夹在前后
# 两行好行之间——只和没被判离群的行比，连续错位时紧挨着的邻居自己也是错的。
# 不把窗口放宽到同时包住旧位置：试过，错位置本身对模型有吸引力，包进去局部对齐还会选它。
import numpy as np

NB = 5
DIST = 0.5
CONF = 0.85
SCAN_D = 1.5


def repair_outliers(out, orig_t, has_tok, align_line, frame_s, n_frames, scan=False):
    # out[li]['t']：每个字的时间；align_line(f0, f1, li) → (每个字的时间, 每个 token 的置信度)，放不下时抛异常
    fixed = 0
    for _ in range(2):  # 第一轮修好的行会改变邻居的本地偏移
        d = [o['t'][0] - t if o['t'] and has_tok(i) else None for i, (o, t) in enumerate(zip(out, orig_t))]

        def local(i):
            nb = [d[j] for j in range(max(0, i - NB), min(len(out), i + NB + 1)) if j != i and d[j] is not None]
            return float(np.median(nb)) if len(nb) >= 3 else None

        flagged = {i for i in range(len(out)) if d[i] is not None and local(i) is not None and abs(d[i] - local(i)) > DIST}
        for li in range(len(out)):
            if d[li] is None: continue
            loc = local(li)
            if loc is None or abs(d[li] - loc) <= DIST: continue
            exp = orig_t[li] + loc
            old = out[li]['t'][0]
            prev_t = next((out[j]['t'][0] for j in range(li - 1, -1, -1) if out[j]['t']), None)
            next_t = next((out[j]['t'][0] for j in range(li + 1, len(out)) if out[j]['t']), None)
            disorder = (prev_t is not None and old <= prev_t) or (next_t is not None and old >= next_t)

            def take(new, scs):
                nonlocal fixed
                out[li]['t'] = new; out[li]['repaired'] = True; fixed += 1
                out[li]['score'] = round(float(np.mean(scs)), 4) if scs else 0.0
                d[li] = new[0] - orig_t[li]

            hi = (orig_t[li + 1] if li + 1 < len(out) else orig_t[li] + 8) + loc + 0.6
            f0, f1 = max(0, int((exp - 0.6) / frame_s)), min(n_frames, int(hi / frame_s))
            try:
                new, scs = align_line(f0, f1, li)
            except (ValueError, RuntimeError):  # RuntimeError：forced_align 判定窗口帧数不够
                new, scs = [], []
            if new:
                ns = float(np.mean(scs)) if scs else 0.0
                if abs(new[0] - exp) <= DIST and abs(new[0] - exp) < abs(old - exp) and (disorder or ns >= CONF * out[li]['score']):
                    take(new, scs)
                    continue
            if not scan: continue

            span = orig_t[li + 1] - orig_t[li] if li + 1 < len(out) and orig_t[li + 1] > orig_t[li] else 3.0
            win = min(max(0.6 * span, 1.0), 3.0)
            best = None
            for t in np.arange(exp - SCAN_D, exp + SCAN_D + 1e-9, 0.1):
                g0, g1 = max(0, int(t / frame_s)), min(n_frames, int((t + win) / frame_s))
                try:
                    cand, cs = align_line(g0, g1, li)
                except (ValueError, RuntimeError):
                    continue
                if cand and cs and (best is None or np.mean(cs) > best[0]): best = (float(np.mean(cs)), cand, cs)
            if best is None: continue
            ns, new, scs = best
            pg = next((out[j]['t'][0] for j in range(li - 1, -1, -1) if out[j]['t'] and has_tok(j) and j not in flagged), None)
            ng = next((out[j]['t'][0] for j in range(li + 1, len(out)) if out[j]['t'] and has_tok(j) and j not in flagged), None)
            in_order = (pg is None or new[0] > pg) and (ng is None or new[0] < ng)
            if abs(new[0] - exp) <= SCAN_D and abs(new[0] - exp) <= abs(old - exp) and in_order \
                    and abs(new[0] - old) > 0.2 and (disorder or ns >= CONF * out[li]['score']):
                take(new, scs)
    return fixed


def timeline_match(out, orig_t):
    # 「歌词和音频对不上」的判据（外语用）：修复前的行起点里，有多少落在「原歌词时间 + 整首偏移」±1 s 内。
    # 对得上的外语歌 80% ~ 100%，故意配错的 6% ~ 27%（调研 4.5）。必须用修复前的起点：两种重对齐都是把行往
    # 原时间附近拉，用修复后的会把配错的歌也拉出很高的吻合度。原歌词没有时间时返回 None
    if not any(orig_t): return None
    d = np.array([o['t0'] - t for o, t in zip(out, orig_t) if o.get('t0') is not None])
    if not len(d): return None
    return round(float(np.mean(np.abs(d - np.median(d)) <= 1.0)), 4)
