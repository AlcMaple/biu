// Shared tokens, icons, frame, primitives for Biu Android mockups
// Visual language matches Biu Electron app: dark surface, #1ed760 accent.

const T = {
  bg: '#0a0a0a',
  surface: '#18181b',
  surfaceElev: '#232328',
  surfaceTrans: 'rgba(255,255,255,0.06)',
  surfaceTrans2: 'rgba(255,255,255,0.10)',
  divider: 'rgba(255,255,255,0.08)',
  fg: '#fafafa',
  fgMuted: '#a1a1aa',
  fgFaint: '#71717a',
  primary: '#1ed760',
  primaryDim: 'rgba(30,215,96,0.18)',
  primaryFg: '#000',
  amber: '#f5a524',
  amberDim: 'rgba(245,165,36,0.16)',
  danger: '#f31260',
  blue: '#338ef7',
  font: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  rSm: 8,
  rMd: 12,
  rLg: 16,
};

// ───── Icons (lucide-style stroke=2 24x24) ─────
const I = {};
const mkIcon = (path) => ({ size = 22, color = 'currentColor', fill = 'none', strokeWidth = 2 } = {}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);
I.Search = mkIcon(<><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>);
I.Mic = mkIcon(<><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></>);
I.Music = mkIcon(<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>);
I.Play = mkIcon(<polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/>);
I.Pause = mkIcon(<><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/></>);
I.Prev = mkIcon(<><polygon points="19 4 8 12 19 20 19 4" fill="currentColor"/><rect x="5" y="4" width="2" height="16" fill="currentColor" stroke="none"/></>);
I.Next = mkIcon(<><polygon points="5 4 16 12 5 20 5 4" fill="currentColor"/><rect x="17" y="4" width="2" height="16" fill="currentColor" stroke="none"/></>);
I.List = mkIcon(<><path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><circle cx="4" cy="6" r=".7" fill="currentColor"/><circle cx="4" cy="12" r=".7" fill="currentColor"/><circle cx="4" cy="18" r=".7" fill="currentColor"/></>);
I.Shuffle = mkIcon(<><path d="m17 4 4 4-4 4"/><path d="M3 8h4l4 8h6"/><path d="M21 16h-4l-1.5-3"/><path d="m17 20 4-4-4-4"/><path d="M3 16h4l1-2"/></>);
I.Repeat = mkIcon(<><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>);
I.Repeat1 = mkIcon(<><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></>);
I.Heart = mkIcon(<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>);
I.HeartFill = mkIcon(<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill="currentColor"/>);
I.More = mkIcon(<><circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/></>);
I.MoreH = mkIcon(<><circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/></>);
I.ChevL = mkIcon(<polyline points="15 6 9 12 15 18"/>);
I.ChevR = mkIcon(<polyline points="9 6 15 12 9 18"/>);
I.ChevD = mkIcon(<polyline points="6 9 12 15 18 9"/>);
I.X = mkIcon(<><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>);
I.Plus = mkIcon(<><path d="M12 5v14"/><path d="M5 12h14"/></>);
I.Folder = mkIcon(<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"/>);
I.Download = mkIcon(<><path d="M12 4v12"/><polyline points="7 11 12 16 17 11"/><path d="M5 20h14"/></>);
I.Settings = mkIcon(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></>);
I.WifiOff = mkIcon(<><path d="m2 2 20 20"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M2 8.8a16 16 0 0 1 4.7-2.7"/><path d="M14 4.1a16 16 0 0 1 8 4.7"/><path d="M5 12.6a10 10 0 0 1 4-2.5"/><path d="M15 10.1a10 10 0 0 1 4 2.5"/><circle cx="12" cy="20" r="1" fill="currentColor"/></>);
I.Refresh = mkIcon(<><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><polyline points="21 3 21 8 16 8"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><polyline points="3 21 3 16 8 16"/></>);
I.Check = mkIcon(<polyline points="4 12 10 18 20 6"/>);
I.Edit = mkIcon(<><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></>);
I.Trash = mkIcon(<><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></>);
I.ArrL = mkIcon(<><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></>);
I.Phone = mkIcon(<rect x="6" y="2" width="12" height="20" rx="2"/>);
I.Lock = mkIcon(<><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>);
I.Mail = mkIcon(<><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/></>);
I.Msg = mkIcon(<path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 4Z"/>);
I.Eye = mkIcon(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>);
I.EyeOff = mkIcon(<><path d="m3 3 18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.4 5.5A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 4"/><path d="M6 6.6A18 18 0 0 0 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.5-1.2"/></>);
I.Bell = mkIcon(<><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></>);
I.Sun = mkIcon(<><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/></>);
I.Cast = mkIcon(<><path d="M2 16a6 6 0 0 1 6 6"/><path d="M2 12a10 10 0 0 1 10 10"/><path d="M2 8a14 14 0 0 1 14 14"/><circle cx="3" cy="21" r="1" fill="currentColor"/></>);
I.Quote = mkIcon(<path d="M7 7h4v6H5v-2a4 4 0 0 1 2-4Zm10 0h4v6h-6v-2a4 4 0 0 1 2-4Z" fill="currentColor"/>);

// ───── Frame ─────
function StatusBar({ light = false }) {
  const c = light ? T.fg : T.fg;
  return (
    <div style={{
      height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 18px', position: 'relative', flex: 'none',
      fontFamily: T.font, color: c, fontSize: 14, fontWeight: 600,
    }}>
      <span>9:30</span>
      <div style={{
        position: 'absolute', left: '50%', top: 8, transform: 'translateX(-50%)',
        width: 22, height: 22, borderRadius: 100, background: '#000',
      }}/>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <svg width="16" height="11" viewBox="0 0 16 11" fill={c}><path d="M8 9.6 1 3a9.5 9.5 0 0 1 14 0L8 9.6Z"/></svg>
        <svg width="14" height="14" viewBox="0 0 14 14" fill={c}><path d="M13 13V1L1 13h12Z"/></svg>
        <svg width="22" height="11" viewBox="0 0 22 11" fill="none" stroke={c} strokeWidth="1.2">
          <rect x=".7" y=".7" width="18" height="9.6" rx="2"/>
          <rect x="2.5" y="2.5" width="14" height="6" rx="1" fill={c}/>
          <rect x="20" y="3.5" width="1.5" height="4" rx=".5" fill={c}/>
        </svg>
      </div>
    </div>
  );
}

function NavBar() {
  return (
    <div style={{ height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
      <div style={{ width: 120, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.55)' }}/>
    </div>
  );
}

// Outer phone frame. children fill the surface. bg defaults to dark.
function Phone({ children, bg = T.bg, frameColor = '#2a2a2e' }) {
  return (
    <div style={{
      width: 412, height: 892, borderRadius: 44, overflow: 'hidden',
      background: bg, border: `7px solid ${frameColor}`,
      boxShadow: '0 28px 70px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04) inset',
      display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
      fontFamily: T.font, color: T.fg, position: 'relative',
    }}>
      <StatusBar/>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {children}
      </div>
      <NavBar/>
    </div>
  );
}

// ───── Primitives ─────

// Cover image — gradient stand-in that LOOKS like a real album.
function Cover({ seed = 1, size = 56, radius = T.rSm, label, badge }) {
  const palettes = [
    ['#1a3a5c','#0d1f33','#2a5a82'],
    ['#3d2820','#1d0f0a','#5c3a2a'],
    ['#243d2a','#0f1f15','#3a5c45'],
    ['#3a2a4a','#1a1025','#5c3a6a'],
    ['#4a3a1a','#251d0a','#6a5530'],
    ['#1a3d3a','#0a1f1d','#2a5c58'],
    ['#3a1a2a','#250a18','#5c2a45'],
    ['#2a2a3d','#15151f','#45456a'],
  ];
  const [a, b, c] = palettes[seed % palettes.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flex: 'none',
      background: `linear-gradient(135deg, ${a} 0%, ${b} 50%, ${c} 100%)`,
      position: 'relative', overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    }}>
      {label && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size > 80 ? 44 : 18, fontWeight: 700, color: 'rgba(255,255,255,0.85)',
          letterSpacing: 2, textShadow: '0 2px 8px rgba(0,0,0,0.5)',
          fontFamily: '"Songti SC","STSong",serif',
        }}>{label}</div>
      )}
      {badge && (
        <div style={{
          position: 'absolute', top: 6, left: 6, padding: '2px 6px',
          background: 'rgba(0,0,0,0.55)', color: T.amber, fontSize: 10, fontWeight: 700,
          borderRadius: 4, letterSpacing: 0.5,
        }}>{badge}</div>
      )}
    </div>
  );
}

// Top app bar (matches Biu's flat dark look — no shadow, just optional border)
function TopBar({ left, title, right, sub, bordered = false, bg = 'transparent' }) {
  return (
    <div style={{
      flex: 'none', padding: '8px 12px', background: bg,
      borderBottom: bordered ? `1px solid ${T.divider}` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
        {left}
        <div style={{ flex: 1, minWidth: 0 }}>
          {title && <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>}
          {sub && <div style={{ fontSize: 12, color: T.fgMuted, lineHeight: 1.3, marginTop: 2 }}>{sub}</div>}
        </div>
        {right}
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, size = 40, bg = 'transparent', color = T.fg }) {
  return (
    <button onClick={onClick} style={{
      width: size, height: size, borderRadius: size/2, border: 'none', background: bg, color,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none',
    }}>{children}</button>
  );
}

function Pill({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
      background: active ? T.primary : T.surfaceTrans,
      color: active ? T.primaryFg : T.fg,
      fontSize: 13, fontWeight: 600, fontFamily: T.font,
    }}>{children}</button>
  );
}

// Mini playbar — bottom-docked component, used on most pages.
function MiniPlaybar({ playing = true, song = '青花瓷', artist = 'JLRS-jayfm', cover = 0, progress = 0.31 }) {
  return (
    <div style={{
      position: 'absolute', left: 8, right: 8, bottom: 10,
      background: 'rgba(28,28,30,0.92)', backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: `1px solid ${T.divider}`, borderRadius: 14,
      padding: '8px 10px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Cover seed={cover} size={42} radius={8} label="青" badge="HiRes"/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{song}</div>
          <div style={{ fontSize: 11.5, color: T.fgMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artist}</div>
        </div>
        <IconBtn size={36}>{playing ? <I.Pause size={26}/> : <I.Play size={22}/>}</IconBtn>
        <IconBtn size={36}><I.Next size={22}/></IconBtn>
        <IconBtn size={36} color={T.fgMuted}><I.List size={20}/></IconBtn>
      </div>
      <div style={{ height: 2, marginTop: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 1, overflow: 'hidden' }}>
        <div style={{ width: `${progress*100}%`, height: '100%', background: T.primary }}/>
      </div>
    </div>
  );
}

// Bottom tab bar
function TabBar({ active = 'home' }) {
  const tabs = [
    { id: 'home', icon: <I.Music size={22}/>, label: '首页' },
    { id: 'fav', icon: <I.Folder size={22}/>, label: '歌单' },
    { id: 'search', icon: <I.Search size={22}/>, label: '搜索' },
    { id: 'me', icon: <I.Settings size={22}/>, label: '我的' },
  ];
  return (
    <div style={{
      flex: 'none', height: 64, display: 'flex',
      borderTop: `1px solid ${T.divider}`, background: T.bg,
    }}>
      {tabs.map(t => (
        <div key={t.id} style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 3, color: t.id === active ? T.primary : T.fgFaint,
        }}>
          {t.icon}
          <span style={{ fontSize: 11, fontWeight: t.id === active ? 600 : 500 }}>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

// Loss-less / quality badge inline
function HiResBadge() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '1px 6px',
      borderRadius: 4, background: T.amberDim, color: T.amber, fontSize: 10, fontWeight: 700,
      letterSpacing: 0.4,
    }}>无损</span>
  );
}

// Source badge (B站收藏夹 vs 本地)
function SourceTag({ kind = 'bili' }) {
  const isBili = kind === 'bili';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '1px 6px',
      borderRadius: 4, fontSize: 10, fontWeight: 600,
      background: isBili ? 'rgba(51,142,247,0.16)' : T.primaryDim,
      color: isBili ? T.blue : T.primary,
    }}>{isBili ? 'B 站' : '本地'}</span>
  );
}

Object.assign(window, {
  T, I, Phone, StatusBar, NavBar, Cover, TopBar, IconBtn, Pill, MiniPlaybar, TabBar, HiResBadge, SourceTag,
});
