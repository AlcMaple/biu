// Base screens: Splash, Home, Empty / Error states, Settings preview

function ScreenSplash() {
  return (
    <Phone bg="#000">
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 18,
      }}>
        {/* Biu logo (TV with play) */}
        <div style={{
          width: 92, height: 92, borderRadius: 24,
          background: `linear-gradient(135deg, ${T.primary} 0%, #0fa84a 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 14px 50px rgba(30,215,96,0.35)',
        }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="#000">
            <path d="M7.17 2.76 10.41 6h3.17l3.24-3.24a1 1 0 1 1 1.42 1.41L16.41 6 18.5 6A3.5 3.5 0 0 1 22 9.5v8a3.5 3.5 0 0 1-3.5 3.5h-13A3.5 3.5 0 0 1 2 17.5v-8A3.5 3.5 0 0 1 5.5 6l2.08 0L5.76 4.17a1 1 0 1 1 1.41-1.41ZM18.5 8h-13A1.5 1.5 0 0 0 4 9.5v8A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8Z"/>
            <path d="M15.18 12.64a1 1 0 0 1 0 1.72l-4.27 2.56a1 1 0 0 1-1.51-.86v-5.12a1 1 0 0 1 1.51-.86l4.27 2.56Z"/>
          </svg>
        </div>
        <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: 1 }}>Biu</div>
        <div style={{ fontSize: 13, color: T.fgMuted, marginTop: -10 }}>基于 Bilibili 的音乐播放器</div>
      </div>
      <div style={{
        position: 'absolute', bottom: 30, left: 0, right: 0, textAlign: 'center',
        fontSize: 11, color: T.fgFaint, letterSpacing: 0.5,
      }}>
        v1.4.0 · 非官方 · 仅供学习研究
      </div>
    </Phone>
  );
}

function ScreenHome() {
  const playlists = [
    { t: '默认收藏夹', n: 38, l: '默', s: 5, k: 'bili' },
    { t: 'high qa', n: 12, l: '风月', s: 0, k: 'bili' },
    { t: '周杰伦合辑', n: 56, l: '周', s: 7, k: 'bili' },
    { t: '日系治愈', n: 23, l: '日', s: 6, k: 'bili' },
    { t: '通勤随机', n: 45, l: '随', s: 3, k: 'local' },
    { t: '本地缓存', n: 18, l: '本', s: 2, k: 'local' },
  ];
  return (
    <Phone>
      <TopBar
        title={<span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.5 }}>Biu</span>}
        right={
          <IconBtn size={42} bg={T.surface}><I.Mic size={20} color={T.primary}/></IconBtn>
        }
      />
      <div style={{ position: 'absolute', top: 60, left: 0, right: 0, bottom: 84, overflow: 'hidden' }}>
        <div style={{ padding: '4px 16px 100px' }}>
          {/* Search bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '11px 14px', background: T.surface, borderRadius: 999,
            color: T.fgMuted, fontSize: 14,
          }}>
            <I.Search size={18}/>
            <span style={{ flex: 1 }}>搜索歌曲、UP主、收藏夹</span>
          </div>

          {/* 正在播放 hero card */}
          <div style={{
            marginTop: 16, padding: 14, borderRadius: 16,
            background: 'linear-gradient(135deg, rgba(30,215,96,0.18) 0%, rgba(20,20,22,0.9) 70%)',
            border: `1px solid ${T.primaryDim}`,
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <Cover seed={0} size={72} radius={12} label="青"/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, color: T.primary, fontWeight: 700, letterSpacing: 1.5 }}>● 正在播放</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4, display:'flex', alignItems:'center', gap: 6 }}>
                青花瓷 <HiResBadge/>
              </div>
              <div style={{ fontSize: 12, color: T.fgMuted, marginTop: 2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace: 'nowrap' }}>JLRS-jayfm · 周杰伦合辑</div>
            </div>
            <button style={{
              width: 44, height: 44, borderRadius: 22, border: 'none',
              background: T.primary, color: T.primaryFg,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(30,215,96,0.4)',
            }}><I.Pause size={22}/></button>
          </div>

          {/* 我的歌单 grid */}
          <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>我的歌单</div>
            <span style={{ fontSize: 12, color: T.fgMuted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <I.Plus size={14}/> 新建
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {playlists.map((p, i) => (
              <div key={i} style={{
                padding: 10, background: T.surface, border: `1px solid ${T.divider}`, borderRadius: 12,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <Cover seed={p.s} size={48} radius={8} label={p.l}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.t}</div>
                  <div style={{ fontSize: 10.5, color: T.fgMuted, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <SourceTag kind={p.k}/> {p.n} 首
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <MiniPlaybar/>
    </Phone>
  );
}

function ScreenEmpty({ kind = 'network' }) {
  const variants = {
    network: {
      icon: <I.WifiOff size={48} color={T.fgFaint}/>,
      title: '网络异常',
      sub: '检查网络后重试，或切换到「本地歌单」继续听',
      cta: '重试',
    },
    loading: {
      icon: <div style={{
        width: 48, height: 48, borderRadius: '50%',
        border: `3px solid ${T.surfaceTrans}`, borderTopColor: T.primary,
        animation: 'spin 1s linear infinite',
      }}/>,
      title: '加载中',
      sub: '正在同步 B 站收藏夹…',
      cta: null,
    },
    empty: {
      icon: <I.Music size={48} color={T.fgFaint}/>,
      title: '空空如也',
      sub: '还没有任何收藏，去搜索框找点喜欢的吧',
      cta: '去搜索',
    },
  };
  const v = variants[kind];
  return (
    <Phone>
      <TopBar
        left={<IconBtn><I.ArrL size={22}/></IconBtn>}
        title="我的歌单"
      />
      <div style={{
        position: 'absolute', top: 60, left: 0, right: 0, bottom: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '0 40px', gap: 14, textAlign: 'center',
      }}>
        {v.icon}
        <div style={{ fontSize: 17, fontWeight: 600, marginTop: 6 }}>{v.title}</div>
        <div style={{ fontSize: 13, color: T.fgMuted, lineHeight: 1.6 }}>{v.sub}</div>
        {v.cta && (
          <button style={{
            marginTop: 8, padding: '10px 28px', borderRadius: 999, border: 'none', cursor: 'pointer',
            background: T.primary, color: T.primaryFg, fontSize: 14, fontWeight: 600, fontFamily: T.font,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <I.Refresh size={16}/> {v.cta}
          </button>
        )}
      </div>
    </Phone>
  );
}

Object.assign(window, { ScreenSplash, ScreenHome, ScreenEmpty });
