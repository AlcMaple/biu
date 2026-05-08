// Shazam (听歌识曲): listening, found, history

function ScreenShazamListen() {
  return (
    <Phone bg="#0a0a0a">
      <div style={{ position: 'absolute', inset: 0,
        background: 'radial-gradient(80% 60% at 50% 40%, rgba(30,215,96,0.18) 0%, rgba(30,215,96,0.04) 40%, #0a0a0a 75%)' }}/>
      <div style={{ position:'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <TopBar
          left={<IconBtn><I.X size={22}/></IconBtn>}
          right={<span style={{ color: T.fgMuted, fontSize: 13, padding: '0 12px' }}>历史</span>}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 28px' }}>
          {/* listening orb */}
          <div style={{ position: 'relative', width: 230, height: 230 }}>
            {[1, 2, 3].map((n, i) => (
              <div key={i} style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: `1.5px solid ${T.primary}`,
                opacity: 0.45 - i * 0.12,
                transform: `scale(${1 + i * 0.18})`,
                animation: `pulse 2.5s ease-out ${i * 0.4}s infinite`,
              }}/>
            ))}
            <div style={{
              position: 'absolute', inset: 32, borderRadius: '50%',
              background: `radial-gradient(circle, ${T.primary} 0%, #0fa84a 70%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 60px rgba(30,215,96,0.5)',
            }}>
              <I.Mic size={68} color="#000" strokeWidth={2.4}/>
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 36, letterSpacing: 0.5 }}>正在聆听 ...</div>
          <div style={{ fontSize: 13, color: T.fgMuted, marginTop: 10, textAlign: 'center', lineHeight: 1.6 }}>
            将麦克风对准音源，<br/>或在外放环境中保持安静
          </div>
          {/* live waveform */}
          <div style={{ marginTop: 28, display: 'flex', gap: 3, alignItems: 'center', height: 28 }}>
            {[10, 16, 22, 14, 24, 18, 26, 20, 12, 18, 24, 14, 20, 22, 12, 18, 26, 16, 22, 14].map((h, i) => (
              <span key={i} style={{
                width: 3, height: h, background: T.primary, opacity: 0.4 + (h / 30) * 0.6,
                borderRadius: 1.5,
              }}/>
            ))}
          </div>
        </div>
        <div style={{ padding: '0 28px 32px', textAlign: 'center', fontSize: 11.5, color: T.fgFaint }}>
          数据由 ACRCloud 提供 · 默认不上传录音
        </div>
      </div>
    </Phone>
  );
}

function ScreenShazamFound() {
  return (
    <Phone>
      <div style={{ position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, rgba(30,215,96,0.15) 0%, transparent 40%)' }}/>
      <div style={{ position:'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <TopBar left={<IconBtn><I.X size={22}/></IconBtn>} right={<span style={{ color: T.fgMuted, fontSize: 13, padding:'0 12px' }}>分享</span>}/>
        <div style={{ padding: '0 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.primary, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            ✓ 已识别
          </div>
        </div>
        <div style={{ flex: 1, padding: '24px 28px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Cover seed={5} size={220} radius={14} label="夜空"/>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 24, textAlign: 'center' }}>夜空中最亮的星</div>
          <div style={{ fontSize: 14, color: T.fgMuted, marginTop: 6 }}>逃跑计划 · 世界</div>
          {/* match meta */}
          <div style={{ marginTop: 18, display: 'flex', gap: 18, fontSize: 11.5, color: T.fgFaint }}>
            <span>匹配度 <span style={{ color: T.primary, fontWeight: 600 }}>98%</span></span>
            <span>· 用时 4.2s</span>
            <span>· 1:18</span>
          </div>
          {/* lyric snippet */}
          <div style={{ width: '100%', marginTop: 28, padding: '14px 16px', background: T.surface, borderRadius: 12,
            border: `1px solid ${T.divider}` }}>
            <div style={{ fontSize: 11, color: T.fgMuted, marginBottom: 8 }}>识别到的片段</div>
            <div style={{ fontSize: 14, lineHeight: 1.8 }}>
              <div style={{ color: T.fgFaint }}>每当我找不到存在的意义</div>
              <div style={{ color: T.primary, fontWeight: 500 }}>每当我迷失在黑夜里</div>
              <div style={{ color: T.fgFaint }}>夜空中最亮的星</div>
            </div>
          </div>
          <div style={{ marginTop: 'auto', paddingBottom: 24, fontSize: 12, color: T.fgFaint, textAlign: 'center' }}>
            再次点击麦克风可重新识别
          </div>
        </div>
      </div>
    </Phone>
  );
}

function ScreenShazamHistory() {
  const items = [
    { t: '夜空中最亮的星', a: '逃跑计划', when: '刚刚', l: '夜空', s: 5, m: 98 },
    { t: 'Stay With Me', a: 'Calvin Harris', when: '今天 14:02', l: 'Stay', s: 3, m: 92 },
    { t: '起风了', a: '买辣椒也用券', when: '昨天 22:18', l: '风', s: 6, m: 95 },
    { t: '后来', a: '刘若英', when: '昨天 19:40', l: '后', s: 7, m: 87 },
    { t: '阳光彩虹小白马', a: '大张伟', when: '5 月 6 日', l: '阳光', s: 4, m: 99 },
    { t: '匿名的好友', a: '陈奕迅', when: '5 月 5 日', l: '匿', s: 1, m: '? ' },
  ];
  return (
    <Phone>
      <TopBar
        left={<IconBtn><I.ArrL size={22}/></IconBtn>}
        title="识曲历史"
        right={<IconBtn><I.More size={20}/></IconBtn>}
      />
      <div style={{ padding: '0 16px' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Pill active>全部 · 23</Pill>
          <Pill>已收藏 · 5</Pill>
          <Pill>未匹配 · 2</Pill>
        </div>
      </div>
      <div style={{ position:'absolute', top: 110, left: 0, right: 0, bottom: 84, overflow:'hidden' }}>
        <div style={{ padding: '12px 16px 100px' }}>
          {items.map((it, i) => {
            const matched = typeof it.m === 'number';
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 0', borderBottom: i < items.length - 1 ? `1px solid ${T.divider}` : 'none',
              }}>
                <Cover seed={it.s} size={48} radius={10} label={it.l}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 500, overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                    {matched ? it.t : <span style={{ color: T.fgMuted, fontStyle: 'italic' }}>未能识别</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: T.fgMuted, marginTop: 2, display:'flex',gap:6,alignItems:'center' }}>
                    {matched && <span>{it.a}</span>}
                    {matched && <span>·</span>}
                    <span>{it.when}</span>
                  </div>
                </div>
                {matched
                  ? <span style={{ fontSize: 11, color: T.primary, fontWeight: 600 }}>{it.m}%</span>
                  : <span style={{ fontSize: 11, color: T.fgFaint }}>重试</span>}
                <IconBtn size={32} color={T.fgMuted}><I.Play size={16}/></IconBtn>
              </div>
            );
          })}
        </div>
      </div>
      <MiniPlaybar/>
    </Phone>
  );
}

Object.assign(window, { ScreenShazamListen, ScreenShazamFound, ScreenShazamHistory });
