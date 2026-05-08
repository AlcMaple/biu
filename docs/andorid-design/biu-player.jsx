// Player: full screen player, queue drawer, lock screen, notification

function ScreenFullPlayer() {
  return (
    <Phone bg="#1a1a1a">
      {/* blurred bg */}
      <div style={{ position: 'absolute', inset: 0,
        background: 'radial-gradient(140% 90% at 50% 18%, rgba(58,42,74,0.7) 0%, rgba(36,61,42,0.45) 35%, #0a0a0a 80%)' }}/>
      <div style={{ position:'relative', display: 'flex', flexDirection:'column', height: '100%' }}>
      <TopBar
        left={<IconBtn><I.ChevD size={26}/></IconBtn>}
        title={<div style={{ textAlign:'center', fontSize: 12, color: T.fgMuted }}>播放自 · 周杰伦合辑</div>}
        right={<IconBtn><I.More size={22}/></IconBtn>}
      />
      <div style={{ flex: 1, padding: '8px 28px 0', display: 'flex', flexDirection: 'column' }}>
        {/* cover */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
          <Cover seed={0} size={300} radius={16} label="青"/>
        </div>
        {/* title */}
        <div style={{ marginTop: 32, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 22, fontWeight: 700, overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>青花瓷</div>
              <HiResBadge/>
            </div>
            <div style={{ fontSize: 13, color: T.fgMuted, marginTop: 6 }}>JLRS-jayfm · 在百万级录音棚听周杰伦</div>
          </div>
          <IconBtn size={42} color={T.danger}><I.HeartFill size={22}/></IconBtn>
        </div>
        {/* progress */}
        <div style={{ marginTop: 22 }}>
          <div style={{ position: 'relative', height: 4, background: 'rgba(255,255,255,0.12)', borderRadius: 2 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '32%', background: T.primary, borderRadius: 2 }}/>
            <div style={{ position: 'absolute', left: '32%', top: '50%', width: 12, height: 12, borderRadius: 6,
              background: T.primary, transform: 'translate(-50%, -50%)', boxShadow: '0 0 0 4px rgba(30,215,96,0.2)' }}/>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: T.fgMuted, fontVariantNumeric: 'tabular-nums' }}>
            <span>01:14</span><span>03:56</span>
          </div>
        </div>
        {/* controls */}
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconBtn size={44} color={T.fgMuted}><I.Repeat size={22}/></IconBtn>
          <IconBtn size={48}><I.Prev size={32}/></IconBtn>
          <button style={{
            width: 72, height: 72, borderRadius: '50%', border: 'none',
            background: T.primary, color: T.primaryFg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(30,215,96,0.35)',
          }}><I.Pause size={36}/></button>
          <IconBtn size={48}><I.Next size={32}/></IconBtn>
          <IconBtn size={44} color={T.fgMuted}><I.List size={22}/></IconBtn>
        </div>
        {/* secondary actions */}
        <div style={{ marginTop: 22, display: 'flex', justifyContent: 'space-around', alignItems: 'center', color: T.fgMuted }}>
          <span style={{ display:'inline-flex',alignItems:'center',gap:5,fontSize:11.5 }}><I.Shuffle size={16}/> 随机</span>
          <span style={{ display:'inline-flex',alignItems:'center',gap:5,fontSize:11.5 }}><I.Download size={16}/> 下载</span>
          <span style={{ display:'inline-flex',alignItems:'center',gap:5,fontSize:11.5 }}><I.Folder size={16}/> 加歌单</span>
        </div>
      </div>
      </div>
    </Phone>
  );
}

function ScreenQueueDrawer() {
  const songs = [
    { t: '青花瓷', a: 'JLRS-jayfm', l: '青', s: 0, playing: true },
    { t: '七里香', a: '周杰伦音乐', l: '七', s: 1 },
    { t: '稻香', a: '杰威尔音乐', l: '稻', s: 7 },
    { t: '夜曲', a: 'JLRS-jayfm', l: '夜', s: 3 },
    { t: '简单爱', a: '周杰伦', l: '简', s: 4 },
    { t: '安静', a: '周杰伦', l: '安', s: 6 },
    { t: '可爱女人', a: '周杰伦', l: '可', s: 2 },
    { t: '轨迹', a: '周杰伦', l: '轨', s: 5 },
  ];
  return (
    <Phone>
      <div style={{ position:'absolute', inset:0, background: 'rgba(0,0,0,0.5)' }}/>
      <TopBar title="周杰伦合辑" left={<IconBtn><I.ArrL size={22}/></IconBtn>}/>
      {/* drawer */}
      <div style={{ position:'absolute', left:0, right:0, bottom: 0, top: 200,
        background: T.surface, borderRadius: '20px 20px 0 0',
        boxShadow: '0 -10px 30px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.divider }}/>
        </div>
        <div style={{ padding: '4px 18px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>当前播放</div>
            <div style={{ fontSize: 11.5, color: T.fgMuted, marginTop: 2, display:'inline-flex',alignItems:'center',gap:6 }}>
              <I.Repeat size={13}/> 列表循环 · 共 8 首
            </div>
          </div>
          <div style={{ display: 'flex' }}>
            <IconBtn size={36} color={T.fgMuted}><I.Shuffle size={18}/></IconBtn>
            <IconBtn size={36} color={T.fgMuted}><I.Trash size={18}/></IconBtn>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: '0 8px 100px' }}>
            {songs.map((s, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px',
                borderRadius: 10, background: s.playing ? T.primaryDim : 'transparent',
              }}>
                <Cover seed={s.s} size={40} radius={8} label={s.l}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: s.playing ? T.primary : T.fg, overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{s.t}</div>
                  <div style={{ fontSize: 11.5, color: T.fgMuted, marginTop: 1 }}>{s.a}</div>
                </div>
                {s.playing
                  ? <div style={{ display:'flex', gap: 2, alignItems: 'flex-end', height: 16 }}>
                      <span style={{ width: 3, height: 12, background: T.primary, borderRadius: 1, animation: 'eq 1s ease-in-out infinite' }}/>
                      <span style={{ width: 3, height: 8, background: T.primary, borderRadius: 1 }}/>
                      <span style={{ width: 3, height: 14, background: T.primary, borderRadius: 1 }}/>
                    </div>
                  : <IconBtn size={28} color={T.fgFaint}><I.X size={16}/></IconBtn>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Phone>
  );
}

function ScreenLockNotif() {
  return (
    <Phone bg="#000">
      <div style={{ position:'absolute', inset:0,
        background:'linear-gradient(165deg,#243d2a 0%,#0f1f15 50%,#1a3a5c 120%)' }}/>
      <div style={{ position:'relative', height:'100%', display:'flex', flexDirection: 'column', padding: '36px 16px 24px' }}>
        <div style={{ textAlign: 'center', marginTop: 28 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color:'rgba(255,255,255,0.9)' }}>5 月 8 日 · 周五</div>
          <div style={{ fontSize: 86, fontWeight: 200, lineHeight: 1, marginTop: 4, color: '#fff', fontFamily: T.font, letterSpacing: -2 }}>9:30</div>
        </div>
        {/* media notif card */}
        <div style={{ marginTop: 30, background: 'rgba(20,20,22,0.85)', backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)', borderRadius: 20, padding: 14, border: `1px solid ${T.divider}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: T.fgMuted, marginBottom: 10 }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, background: T.primary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="#000"><path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>
            </div>
            Biu · 正在播放
            <span style={{ marginLeft: 'auto' }}>现在</span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Cover seed={0} size={56} radius={10} label="青"/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>青花瓷</div>
              <div style={{ fontSize: 12, color: T.fgMuted, marginTop: 2 }}>JLRS-jayfm</div>
            </div>
          </div>
          <div style={{ height: 3, marginTop: 12, background: 'rgba(255,255,255,0.15)', borderRadius: 1.5 }}>
            <div style={{ width: '32%', height: '100%', background: T.primary, borderRadius: 1.5 }}/>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: T.fgMuted, fontVariantNumeric: 'tabular-nums' }}>
            <span>01:14</span><span>-02:42</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', marginTop: 10 }}>
            <I.Prev size={26}/>
            <div style={{ width: 48, height: 48, borderRadius: 24, background: T.primary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: T.primaryFg }}>
              <I.Pause size={24}/>
            </div>
            <I.Next size={26}/>
          </div>
        </div>
        <div style={{ marginTop: 14, padding: '8px 12px', background: 'rgba(20,20,22,0.6)', backdropFilter: 'blur(14px)', WebkitBackdropFilter:'blur(14px)', borderRadius: 14, border: `1px solid ${T.divider}`, fontSize: 12, color: T.fgMuted }}>
          <div style={{ fontWeight: 600, color: T.fg, marginBottom: 2 }}>耳机已连接</div>
          AirPods Pro · 双击切换下一首
        </div>
        <div style={{ flex: 1 }}/>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 16px', color: T.fgMuted }}>
          <I.Phone size={22}/>
          <div style={{ width: 50, height: 50, borderRadius: 25, border: '1.5px solid rgba(255,255,255,0.4)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <I.Lock size={20}/>
          </div>
          <I.Mic size={22}/>
        </div>
      </div>
    </Phone>
  );
}

Object.assign(window, { ScreenFullPlayer, ScreenQueueDrawer, ScreenLockNotif });
