# 英语歌词对齐：在歌声上训练的音素识别模型（Huang, Benetos, Ewert, "Improving Lyrics Alignment through Joint Pitch
# Detection", ICASSP 2022，https://github.com/jhuang448/LyricsAlignment-MTL，MIT 许可，版权声明见 singing-LICENSE）。
# 为什么英语不用 MMS_FA：MMS 是朗读语音上训练的，英语歌的伴唱 / 和声会把行首吸走；同一套评测下这个模型
# 行起点中位误差 40 ms 对 56 ms、错 1 s 以上的行 18 对 26（调研文档 4.8）。中日韩没有现成的歌声模型权重，仍走 MMS。
#
# 下面网络结构逐行照搬原仓库 model.py 的推理部分（权重按这个结构存的，改一处就加载不上或结果不对）。
# 注意第 2、3 层 LSTM 的 batch_first=False 是原仓库的写法：输入其实是 (batch, 时间, 特征)，这两层等于逐帧独立处理。
# 训练时就是这样，推理必须保持一致，不要「修」。
import os, re, string, unicodedata, warnings
import numpy as np, soundfile as sf, torch, torch.nn as nn, torch.nn.functional as F
import torchaudio, torchaudio.functional as AF

SR = 22050
RES = 256 / 22050 * 3  # 每帧 34.8 ms：mel 跳长 256 点，再在时间轴上被 3 倍池化
PHONES = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'B', 'CH', 'D', 'DH', 'EH', 'ER', 'EY', 'F', 'G', 'HH', 'IH', 'IY',
          'JH', 'K', 'L', 'M', 'N', 'NG', 'OW', 'OY', 'P', 'R', 'S', 'SH', 'T', 'TH', 'UH', 'UW', 'V', 'W', 'Y',
          'Z', 'ZH', ' ']
P2I = {p: i for i, p in enumerate(PHONES)}
SPACE, BLANK = P2I[' '], len(PHONES)
CHECKPOINT = os.environ.get('BIU_SINGING_CHECKPOINT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models', 'checkpoint_MTL')


class CNNLayerNorm(nn.Module):
    def __init__(self, n_feats):
        super().__init__()
        self.layer_norm = nn.LayerNorm(n_feats)

    def forward(self, x):
        x = x.transpose(2, 3).contiguous()
        x = self.layer_norm(x)
        return x.transpose(2, 3).contiguous()


class ResidualCNN(nn.Module):
    def __init__(self, in_channels, out_channels, kernel, stride, dropout, n_feats):
        super().__init__()
        self.cnn1 = nn.Conv2d(in_channels, out_channels, kernel, stride, padding=kernel // 2)
        self.cnn2 = nn.Conv2d(out_channels, out_channels, kernel, stride, padding=kernel // 2)
        self.dropout1 = nn.Dropout(dropout)
        self.dropout2 = nn.Dropout(dropout)
        self.layer_norm1 = CNNLayerNorm(n_feats)
        self.layer_norm2 = CNNLayerNorm(n_feats)

    def forward(self, x):
        residual = x
        x = self.cnn1(self.dropout1(F.gelu(self.layer_norm1(x))))
        x = self.cnn2(self.dropout2(F.gelu(self.layer_norm2(x))))
        return x + residual


class BidirectionalLSTM(nn.Module):
    def __init__(self, rnn_dim, hidden_size, dropout, batch_first):
        super().__init__()
        self.BiLSTM = nn.LSTM(input_size=rnn_dim, hidden_size=hidden_size, num_layers=1, batch_first=batch_first, bidirectional=True)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x):
        x, _ = self.BiLSTM(x)
        return self.dropout(x)


class AcousticModel(nn.Module):
    # MTL 权重：音素 41 类（39 音素 + 空格 + 空白）× 音高 47 类，推理时把音高维加起来
    def __init__(self, n_class=(41, 47), n_feats=32, rnn_dim=256, dropout=0.1):
        super().__init__()
        self.n_class = n_class
        self.cnn_layers = nn.Sequential(nn.Conv2d(1, n_feats, 3, stride=1, padding=1), nn.ReLU())
        self.rescnn_layers = nn.Sequential(ResidualCNN(n_feats, n_feats, kernel=3, stride=1, dropout=dropout, n_feats=128))
        self.maxpooling = nn.MaxPool2d(kernel_size=(2, 3))
        self.fully_connected = nn.Linear(n_feats * 64, rnn_dim)
        self.bilstm = nn.Sequential(
            BidirectionalLSTM(rnn_dim=rnn_dim, hidden_size=rnn_dim, dropout=dropout, batch_first=True),
            BidirectionalLSTM(rnn_dim=rnn_dim * 2, hidden_size=rnn_dim, dropout=dropout, batch_first=False),
            BidirectionalLSTM(rnn_dim=rnn_dim * 2, hidden_size=rnn_dim, dropout=dropout, batch_first=False))
        self.classifier = nn.Sequential(nn.Linear(rnn_dim * 2, n_class[0] * n_class[1]))

    def forward(self, x):
        x = self.maxpooling(self.rescnn_layers(self.cnn_layers(x)))
        sizes = x.size()
        x = x.view(sizes[0], sizes[1] * sizes[2], sizes[3]).transpose(1, 2)
        x = self.classifier(self.bilstm(self.fully_connected(x)))
        return x.view(sizes[0], sizes[3], self.n_class[0], self.n_class[1])


def emissions(vocals_path):
    # 模型在 16 kHz 的分离人声上训练、按 22.05 kHz 提特征；原仓库评测时也是先降到 16 kHz 再升回来模拟同样的条件
    y, sr = sf.read(vocals_path)
    y = y.mean(axis=1) if y.ndim > 1 else y
    w = torch.from_numpy(y.astype(np.float32))[None]
    w = AF.resample(AF.resample(w, sr, 16000), 16000, SR)
    model = AcousticModel().eval()
    model.load_state_dict(torch.load(CHECKPOINT, map_location='cpu', weights_only=False)['model_state_dict'])
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        mel = torchaudio.transforms.MelSpectrogram(sample_rate=SR, n_mels=128, n_fft=512)
    with torch.inference_mode():
        lp = torch.log_softmax(model(mel(w).unsqueeze(1)).sum(dim=3), dim=2)[0]
    return lp[:int(w.shape[1] / SR // RES)]


_g2p = None
def phones(word):
    # g2p_en 首次 import 会联网下载 NLTK 词典；部署时预先下好（见 README），否则断网时这里直接失败
    global _g2p
    if _g2p is None:
        from g2p_en import G2p
        _g2p = G2p()
    out = [p.rstrip(string.digits) for p in _g2p(word)]
    return [p for p in out if p in P2I and p != ' ']


PUNCT = re.compile(r'[\W_]', re.U)


class Aligner:
    # 输出格式与 MMS 路径相同：每行 chars（去掉空格和标点的每个字）、t（每个字的时间）。
    # 模型给的是词级时间，同一个词里的字共用词首时间；客户端本来就按词点亮拉丁字母
    def __init__(self, vocals_path, texts):
        self.lp = emissions(vocals_path)
        self.n_frames = self.lp.shape[0]
        self.lines, self.line_tok = [], []
        for text in texts:
            chars, wi_of, lt = [], [], []
            words, cur = [], ''
            for k, c in enumerate(text):
                inword = c.strip() and (not PUNCT.match(c) or (c in "'’" and cur and k + 1 < len(text) and text[k + 1].isalpha()))
                if inword:
                    cur += c
                    if not PUNCT.match(c): chars.append(c); wi_of.append(len(words))
                elif cur:
                    words.append(cur); cur = ''
            if cur: words.append(cur)
            for wi, w in enumerate(words):
                plain = unicodedata.normalize('NFKD', w.lower())
                ps = phones(re.sub(r"[^a-z']", '', plain.replace('’', "'"))) if re.search('[a-z]', plain) else []
                if ps:
                    if lt: lt.append((SPACE, None))
                    lt += [(P2I[p], wi if k == 0 else None) for k, p in enumerate(ps)]
            self.lines.append((chars, wi_of)); self.line_tok.append(lt)

    def has_tokens(self, li):
        return bool(self.line_tok[li])

    def _times(self, li, word_start):
        chars, wi_of = self.lines[li]
        ts, last = [], None
        for wi in wi_of:
            t = word_start.get(wi, last)
            ts.append(t); last = t
        first = next((t for t in ts if t is not None), None)
        return [first if t is None else t for t in ts] if first is not None else []

    def _run(self, f0, f1, which):
        tokens, owner = [], []
        for li in which:
            if tokens and self.line_tok[li]: tokens.append(SPACE); owner.append(None)
            for x, wi in self.line_tok[li]: tokens.append(x); owner.append((li, wi))
        if not tokens or f1 - f0 < 2 * len(tokens): raise ValueError('窗口放不下这些音素')
        al, sc = AF.forced_align(self.lp[None, f0:f1].contiguous(), torch.tensor([tokens], dtype=torch.int32), blank=BLANK)
        spans = AF.merge_tokens(al[0], sc[0].exp(), blank=BLANK)
        got = {li: ({}, []) for li in which}
        for sp, ow in zip(spans, owner):
            if not ow: continue
            ws, scs = got[ow[0]]
            if ow[1] is not None: ws[ow[1]] = round((sp.start + f0) * RES, 3)
            scs.append(float(sp.score))
        return {li: (self._times(li, ws), scs) for li, (ws, scs) in got.items()}

    def align_all(self):
        return self._run(0, self.n_frames, range(len(self.lines)))

    def align_line(self, f0, f1, li):
        ts, scs = self._run(f0, f1, [li])[li]
        if not ts: raise ValueError('这一行没有可对齐的词')
        return ts, scs
