// Playlist: my list (B站/本地 tabs), detail page, item action sheet, create dialog

function ScreenPlaylistList() {
  const biliFavs = [
    { t: '默认收藏夹', n: 38, l: '默', s: 5, k: 'bili' },
    { t: 'high qa', n: 12, l: '风月', s: 0, k: 'bili' },
    { t: 'song', n: 84, l: 'song', s: 1, k: 'bili' },
    { t: '周杰伦合辑', n: 56, l: '周', s: 7, k: 'bili' },
    { t: '日系治愈', n: 23, l: '日', s: 6, k: 'bili' },
    { t: '本地缓存歌单', n: 18, l: '本地', s: 2, k: 'local' },
    { t: '通勤随机', n: 45, l: '随', s: 3, k: 'local' },
  ];
  return (
    <Phone>
      <TopBar
        title="我的歌单"
        right={
          <div style={{ display: 'flex' }}>
            <IconBtn><I.Search size={20}/></IconBtn>
            <IconBtn><I.Plus size={22} color={T.primary}/></IconBtn>
          </div>
        }
      />
      <div style={{ padding: '4px 16px 0' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Pill active>全部 · 7</Pill>
          <Pill>B 站 · 5</Pill>
          <Pill>本地 · 2</Pill>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 12, color: T.fgMuted, display:'inline-flex',alignItems:'center',gap:4 }}>
            <I.Refresh size={14}/> 同步
          </span>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 102, left: 0, right: 0, bottom: 84, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px 100px' }}>
          {biliFavs.map((f, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 0', borderBottom: i < biliFavs.length - 1 ? `1px solid ${T.divider}` : 'none',
            }}>
              <Cover seed={f.s} size={56} radius={10} label={f.l}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display:'flex', alignItems:'center', gap: 6 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{f.t}</span>
                  <SourceTag kind={f.k}/>
                </div>
                <div style={{ fontSize: 12, color: T.fgMuted, marginTop: 3 }}>{f.n} 首 · 上次播放 2 天前</div>
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

function ScreenPlaylistDetail() {
  const songs = [
    { t: '青花瓷', a: 'JLRS-jayfm', d: '03:56', l: '青', s: 0, hires: true },
    { t: '七里香', a: '周杰伦音乐', d: '04:58', l: '七', s: 1 },
    { t: '稻香', a: '杰威尔音乐', d: '03:42', l: '稻', s: 7 },
    { t: '夜曲', a: 'JLRS-jayfm', d: '03:48', l: '夜', s: 3 },
    { t: '简单爱', a: '周杰伦', d: '04:30', l: '简', s: 4 },
    { t: '安静', a: '周杰伦', d: '05:32', l: '安', s: 6 },
    { t: '可爱女人', a: '周杰伦', d: '03:38', l: '可', s: 2 },
  ];
  return (
    <Phone>
      <TopBar
        left={<IconBtn><I.ArrL size={22}/></IconBtn>}
        right={
          <div style={{ display:'flex' }}>
            <IconBtn><I.Search size={20}/></IconBtn>
            <IconBtn><I.More size={20}/></IconBtn>
          </div>
        }
      />
      <div style={{ position: 'absolute', top: 60, left: 0, right: 0, bottom: 84, overflow: 'hidden' }}>
        <div style={{ padding: '4px 16px 100px' }}>
          {/* header */}
          <div style={{ display: 'flex', gap: 14 }}>
            <Cover seed={7} size={108} radius={14} label="周"/>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>周杰伦合辑</div>
                <div style={{ fontSize: 12, color: T.fgMuted, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <SourceTag kind="bili"/> 56 首 · 收藏夹
                </div>
                <div style={{ fontSize: 11.5, color: T.fgFaint, marginTop: 8, lineHeight: 1.5 }}>
                  从 JLRS 录音棚拉的高码率合辑，慢慢听。
                </div>
              </div>
            </div>
          </div>
          {/* actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
            <button style={{
              flex: 1, padding: '11px 0', border: 'none', borderRadius: 999,
              background: T.primary, color: T.primaryFg, fontSize: 14, fontWeight: 700, fontFamily: T.font,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}><I.Play size={16}/> 播放全部</button>
            <button style={{
              padding: '11px 16px', border: `1px solid ${T.divider}`, borderRadius: 999,
              background: T.surface, color: T.fg, fontSize: 13, fontWeight: 500, fontFamily: T.font,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}><I.Shuffle size={15}/> 随机</button>
            <IconBtn size={42} bg={T.surface}><I.Edit size={18}/></IconBtn>
          </div>
          {/* sort row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: T.fgMuted }}>共 56 首</span>
            <span style={{ fontSize: 12, color: T.fgMuted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              收藏时间 <I.ChevD size={12}/>
            </span>
          </div>
          {/* song list */}
          {songs.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
              borderBottom: i < songs.length - 1 ? `1px solid ${T.divider}` : 'none',
              ...(i === 0 ? { background: 'rgba(30,215,96,0.07)', margin: '0 -10px', padding: '8px 10px', borderRadius: 8, borderBottom: 'none' } : {}),
            }}>
              <div style={{ width: 22, color: i === 0 ? T.primary : T.fgFaint, fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
                {i === 0 ? <I.Music size={14}/> : i + 1}
              </div>
              <Cover seed={s.s} size={42} radius={8} label={s.l}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: i === 0 ? 600 : 500, color: i === 0 ? T.primary : T.fg, overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{s.t}</span>
                  {s.hires && <HiResBadge/>}
                </div>
                <div style={{ fontSize: 11.5, color: T.fgMuted, marginTop: 1 }}>{s.a} · {s.d}</div>
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

function ScreenSongMenu() {
  const items = [
    { i: <I.Play size={18}/>, t: '下一首播放', sub: '加入正在播放队列下一位' },
    { i: <I.Folder size={18}/>, t: '加入其他歌单', sub: '复制到其他 B 站收藏夹 / 本地' },
    { i: <I.HeartFill size={18} color={T.danger}/>, t: '取消收藏', sub: '从「周杰伦合辑」中移除' },
    { i: <I.Download size={18}/>, t: '下载', sub: '保存到本地缓存' },
    { i: <I.Plus size={18}/>, t: '加入下一首播放', sub: '插入到队列下一位' },
  ];
  return (
    <Phone>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }}/>
      <TopBar left={<IconBtn><I.ArrL size={22}/></IconBtn>} title="周杰伦合辑"/>
      <div style={{ position:'absolute', top: 60, left: 0, right: 0, padding: '0 16px', opacity: 0.4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
          <Cover seed={0} size={42} radius={8} label="青"/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>青花瓷</div>
            <div style={{ fontSize: 11.5, color: T.fgMuted }}>JLRS-jayfm · 03:56</div>
          </div>
        </div>
      </div>
      {/* sheet */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: T.surface, borderRadius: '20px 20px 0 0',
        boxShadow: '0 -10px 30px rgba(0,0,0,0.4)',
        paddingBottom: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.divider }}/>
        </div>
        <div style={{ padding: '4px 16px 12px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${T.divider}` }}>
          <Cover seed={0} size={48} radius={10} label="青"/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>青花瓷 <HiResBadge/></div>
            <div style={{ fontSize: 12, color: T.fgMuted, marginTop: 2 }}>JLRS-jayfm · 03:56</div>
          </div>
        </div>
        {items.map((it, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: T.surfaceElev,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.fg, flex: 'none' }}>
              {it.i}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 500 }}>{it.t}</div>
              <div style={{ fontSize: 11.5, color: T.fgMuted, marginTop: 2 }}>{it.sub}</div>
            </div>
            <I.ChevR size={16} color={T.fgFaint}/>
          </div>
        ))}
        <div style={{ height: 1, background: T.divider, margin: '4px 16px' }}/>
        <div style={{ padding: '14px 18px', textAlign: 'center', fontSize: 14, color: T.fgMuted }}>取消</div>
      </div>
    </Phone>
  );
}

function ScreenCreatePlaylist() {
  return (
    <Phone>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }}/>
      <TopBar title="我的歌单" right={<IconBtn><I.Plus size={22} color={T.primary}/></IconBtn>}/>
      {/* dialog */}
      <div style={{
        position: 'absolute', left: 24, right: 24, top: 220,
        background: T.surface, borderRadius: 20, padding: 22,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: `1px solid ${T.divider}`,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>新建本地歌单</div>
        <div style={{ fontSize: 12, color: T.fgMuted, marginBottom: 18 }}>本地歌单仅保存在此设备</div>
        <div style={{ fontSize: 11, color: T.fgMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>名称</div>
        <div style={{
          padding: '12px 14px', background: T.bg, border: `1.5px solid ${T.primary}`, borderRadius: 10,
          fontSize: 14, color: T.fg,
        }}>晚间睡前 ▌</div>
        <div style={{ fontSize: 11, color: T.fgFaint, marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
          <span>避免重名 · 已存在 7 个</span><span>4 / 30</span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: `1px solid ${T.divider}`,
            background: 'transparent', color: T.fg, fontSize: 14, fontWeight: 500, fontFamily: T.font }}>取消</button>
          <button style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: 'none',
            background: T.primary, color: T.primaryFg, fontSize: 14, fontWeight: 700, fontFamily: T.font }}>创建</button>
        </div>
      </div>
    </Phone>
  );
}

Object.assign(window, { ScreenPlaylistList, ScreenPlaylistDetail, ScreenSongMenu, ScreenCreatePlaylist });
