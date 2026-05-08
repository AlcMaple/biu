// Search: empty (suggestions), typing (autocomplete), results

function ScreenSearchEmpty() {
  const hist = ['周杰伦', '青花瓷', '逃跑计划', 'JLRS-jayfm', 'lo-fi', 'cmj 翻唱'];
  const hot = [
    { i: 1, t: '黑神话悟空 OST', tag: '热' },
    { i: 2, t: '林俊杰 重生 2025' },
    { i: 3, t: 'Taylor Swift Tortured', tag: '新' },
    { i: 4, t: '哈基米 翻唱合集' },
    { i: 5, t: '周深 长安三万里' },
    { i: 6, t: '上春山 全网最佳版本' },
  ];
  return (
    <Phone>
      <div style={{ flex: 'none', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconBtn><I.ArrL size={22}/></IconBtn>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10,
          background: T.surface, borderRadius: 999, padding: '9px 14px', fontSize: 14, color: T.fgMuted }}>
          <I.Search size={17}/> <span style={{ flex: 1 }}>搜索歌曲、UP主、收藏夹</span>
          <I.Mic size={17} color={T.primary}/>
        </div>
        <span style={{ fontSize: 14, color: T.fg, padding: '0 4px' }}>搜索</span>
      </div>
      <div style={{ position:'absolute', top: 60, left: 0, right: 0, bottom: 84, overflow: 'hidden' }}>
        <div style={{ padding: '8px 16px 100px' }}>
          {/* history */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>搜索历史</span>
              <I.Trash size={16} color={T.fgFaint}/>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {hist.map((h, i) => (
                <span key={i} style={{
                  padding: '6px 12px', background: T.surface, border: `1px solid ${T.divider}`,
                  borderRadius: 999, fontSize: 12.5, color: T.fg,
                }}>{h}</span>
              ))}
            </div>
          </div>
          {/* hot */}
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>热搜榜 <span style={{ fontSize: 11, color: T.fgFaint, fontWeight: 400 }}>· B站音乐</span></span>
              <span style={{ fontSize: 11, color: T.fgMuted, display:'inline-flex',alignItems:'center',gap:4 }}><I.Refresh size={12}/> 刷新</span>
            </div>
            {hot.map((h, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0',
                borderBottom: i < hot.length - 1 ? `1px solid ${T.divider}` : 'none',
              }}>
                <span style={{ width: 18, fontSize: 14, fontWeight: 700, fontFamily: 'serif',
                  color: h.i <= 3 ? T.primary : T.fgFaint, textAlign: 'center' }}>{h.i}</span>
                <span style={{ flex: 1, fontSize: 14, fontWeight: h.i <= 3 ? 500 : 400 }}>{h.t}</span>
                {h.tag && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                  background: h.tag === '新' ? T.primaryDim : T.amberDim,
                  color: h.tag === '新' ? T.primary : T.amber }}>{h.tag}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <MiniPlaybar/>
    </Phone>
  );
}

function ScreenSearchTyping() {
  const sugs = [
    '青花瓷',
    '青花瓷 周杰伦',
    '青花瓷 cmj 翻唱',
    '青花瓷 钢琴版',
    '青花瓷 纯音乐',
    '青花瓷 慢摇',
    '青花瓷 8d',
    '青花瓷 demo 流出',
  ];
  return (
    <Phone>
      <div style={{ flex: 'none', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconBtn><I.ArrL size={22}/></IconBtn>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10,
          background: T.surface, borderRadius: 999, padding: '9px 14px', fontSize: 14 }}>
          <I.Search size={17} color={T.fgMuted}/>
          <span style={{ flex: 1, color: T.fg }}>青花<span style={{ background: T.primaryDim, color: T.primary, padding: '0 2px', borderRadius: 2 }}>瓷</span><span style={{ display:'inline-block',width:1.5,height:14,background:T.primary,marginLeft:1,verticalAlign:'middle',animation:'blink 1s steps(1) infinite' }}/></span>
          <I.X size={15} color={T.fgMuted}/>
        </div>
        <span style={{ fontSize: 14, color: T.primary, padding: '0 4px', fontWeight: 600 }}>搜索</span>
      </div>
      <div style={{ position: 'absolute', top: 60, left: 0, right: 0, bottom: 84, overflow: 'hidden' }}>
        <div style={{ padding: '4px 0 100px' }}>
          {sugs.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${T.divider}` }}>
              <I.Search size={16} color={T.fgFaint}/>
              <span style={{ flex: 1, fontSize: 14 }}>
                <span style={{ color: T.primary }}>青花</span>
                <span dangerouslySetInnerHTML={{ __html: s.replace('青花', '') }}/>
              </span>
              <span style={{ fontSize: 11, color: T.fgFaint, transform: 'rotate(45deg)' }}><I.ArrL size={14}/></span>
            </div>
          ))}
        </div>
      </div>
    </Phone>
  );
}

function ScreenSearchResults() {
  const songs = [
    { t: '青花瓷', a: 'JLRS-jayfm', d: '03:56', l: '青', s: 0, hires: true, plays: '1280 万' },
    { t: '青花瓷 (钢琴版)', a: '光环音乐', d: '04:12', l: '青', s: 1, plays: '342 万' },
    { t: '青花瓷 (Live)', a: '周杰伦演唱会', d: '04:34', l: '青', s: 7, plays: '186 万' },
    { t: '青花瓷 (cmj 翻唱)', a: 'cmj 音乐', d: '03:48', l: '青', s: 3, plays: '52 万' },
  ];
  const ups = [
    { n: 'JLRS-jayfm', f: '128万 粉丝', s: 0, l: 'J' },
    { n: '光环音乐', f: '46万 粉丝', s: 1, l: '光' },
  ];
  return (
    <Phone>
      <div style={{ flex: 'none', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconBtn><I.ArrL size={22}/></IconBtn>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10,
          background: T.surface, borderRadius: 999, padding: '9px 14px', fontSize: 14 }}>
          <I.Search size={17} color={T.fgMuted}/>
          <span style={{ flex: 1 }}>青花瓷</span>
          <I.X size={15} color={T.fgMuted}/>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 60, left: 0, right: 0, bottom: 84, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px 100px' }}>
          {/* best match */}
          <div style={{ padding: 14, background: 'linear-gradient(135deg, rgba(30,215,96,0.14), rgba(30,215,96,0.04))',
            border: `1px solid ${T.primaryDim}`, borderRadius: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
            <Cover seed={0} size={68} radius={10} label="青"/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, color: T.primary, fontWeight: 700, letterSpacing: 1.2 }}>最佳匹配</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                青花瓷 <HiResBadge/>
              </div>
              <div style={{ fontSize: 12, color: T.fgMuted, marginTop: 2 }}>JLRS-jayfm · 周杰伦合辑</div>
            </div>
            <button style={{ width: 40, height: 40, borderRadius: 20, border: 'none',
              background: T.primary, color: T.primaryFg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <I.Play size={18}/>
            </button>
          </div>

          {/* 歌曲 */}
          <div style={{ marginTop: 18, marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>歌曲 · 248</span>
            <span style={{ fontSize: 11.5, color: T.fgMuted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              相关度 <I.ChevD size={12}/>
            </span>
          </div>
          {songs.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
              borderBottom: i < songs.length - 1 ? `1px solid ${T.divider}` : 'none',
            }}>
              <Cover seed={s.s} size={42} radius={8} label={s.l}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    <span style={{ color: T.primary }}>青花瓷</span>
                    {s.t.replace('青花瓷', '')}
                  </span>
                  {s.hires && <HiResBadge/>}
                </div>
                <div style={{ fontSize: 11.5, color: T.fgMuted, marginTop: 2 }}>{s.a} · {s.d} · {s.plays} 播放</div>
              </div>
              <IconBtn size={32} color={T.fgMuted}><I.More size={18}/></IconBtn>
            </div>
          ))}
        </div>
      </div>
      <MiniPlaybar/>
    </Phone>
  );
}

Object.assign(window, { ScreenSearchEmpty, ScreenSearchTyping, ScreenSearchResults });
