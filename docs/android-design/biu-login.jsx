// Login: password, sms, post-login state
function ScreenLoginPwd() {
  return (
    <Phone>
      <TopBar left={<IconBtn><I.X size={22}/></IconBtn>} right={<span style={{ color: T.fgMuted, fontSize: 13, padding: '0 12px' }}>帮助</span>}/>
      <div style={{ padding: '12px 24px', overflow: 'auto' }}>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>登录 Bilibili</div>
          <div style={{ fontSize: 13, color: T.fgMuted, marginTop: 8, lineHeight: 1.5 }}>
            登录后可同步 B 站收藏夹、稍后再看，享受高码率音频。
          </div>
        </div>
        {/* tabs */}
        <div style={{ display: 'flex', gap: 24, marginTop: 28, borderBottom: `1px solid ${T.divider}` }}>
          {['账号密码','短信登录'].map((t,i) => (
            <div key={i} style={{
              padding: '10px 0', fontSize: 14, fontWeight: i===0?600:500,
              color: i===0?T.fg:T.fgMuted, borderBottom: i===0?`2px solid ${T.primary}`:'2px solid transparent', marginBottom: -1,
            }}>{t}</div>
          ))}
        </div>
        {/* fields */}
        <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field icon={<I.Phone size={18}/>} placeholder="手机号 / 邮箱 / UID" value="13800001234"/>
          <Field icon={<I.Lock size={18}/>} placeholder="密码" value="••••••••" trailing={<I.EyeOff size={18} color={T.fgMuted}/>}/>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field placeholder="验证码" value="A8K3" small/>
            <div style={{ width: 96, height: 46, borderRadius: 12, background: 'linear-gradient(135deg,#3a2a4a,#243d2a)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'serif',
              fontSize: 22, fontStyle: 'italic', letterSpacing: 4, color: '#e8e0c8',
              textShadow: '1px 2px 0 rgba(0,0,0,.4)' }}>A8k3</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 12 }}>
          <span style={{ color: T.fgMuted, display:'inline-flex',alignItems:'center',gap:6 }}>
            <span style={{ width:14,height:14,borderRadius:3,border:`1.5px solid ${T.primary}`,background:T.primary,display:'inline-flex',alignItems:'center',justifyContent:'center' }}><I.Check size={10} color={T.primaryFg}/></span>
            记住登录
          </span>
          <span style={{ color: T.primary }}>忘记密码 ?</span>
        </div>
        <button style={{
          width: '100%', marginTop: 28, padding: '14px 0', border: 'none',
          background: T.primary, color: T.primaryFg, borderRadius: 12, fontSize: 15, fontWeight: 700, fontFamily: T.font,
        }}>登 录</button>
        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 11.5, color: T.fgFaint, lineHeight: 1.6 }}>
          登录即代表同意《用户协议》《隐私政策》<br/>本应用为非官方客户端，与 Bilibili 无关
        </div>
      </div>
    </Phone>
  );
}

function Field({ icon, placeholder, value, trailing, small }) {
  return (
    <div style={{
      height: small ? 46 : 50, display: 'flex', alignItems: 'center', gap: 10,
      background: T.surface, border: `1px solid ${T.divider}`, borderRadius: 12, padding: '0 14px',
      flex: small ? 1 : undefined,
    }}>
      {icon && <span style={{ color: T.fgMuted }}>{icon}</span>}
      <span style={{ flex: 1, fontSize: 14, color: value ? T.fg : T.fgFaint }}>{value || placeholder}</span>
      {trailing}
    </div>
  );
}

function ScreenLoginSms() {
  return (
    <Phone>
      <TopBar left={<IconBtn><I.X size={22}/></IconBtn>} right={<span style={{ color: T.fgMuted, fontSize: 13, padding: '0 12px' }}>帮助</span>}/>
      <div style={{ padding: '12px 24px' }}>
        <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>短信登录</div>
        <div style={{ fontSize: 13, color: T.fgMuted, marginTop: 8 }}>未注册手机号将自动创建账号</div>
        <div style={{ display: 'flex', gap: 24, marginTop: 28, borderBottom: `1px solid ${T.divider}` }}>
          {['账号密码','短信登录'].map((t,i) => (
            <div key={i} style={{ padding: '10px 0', fontSize: 14, fontWeight: i===1?600:500,
              color: i===1?T.fg:T.fgMuted, borderBottom: i===1?`2px solid ${T.primary}`:'2px solid transparent', marginBottom:-1 }}>{t}</div>
          ))}
        </div>
        <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ width: 70, height: 50, borderRadius: 12, background: T.surface, border: `1px solid ${T.divider}`,
              display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,gap:4 }}>
              +86 <I.ChevD size={14} color={T.fgMuted}/>
            </div>
            <Field placeholder="手机号" value="138 0000 1234"/>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field placeholder="6 位验证码" value="3 9 4 ▌"/>
            <button style={{ width: 110, height: 50, border: `1px solid ${T.primary}`, background: T.primaryDim, color: T.primary,
              borderRadius: 12, fontSize: 13, fontWeight: 600, fontFamily: T.font }}>59 秒</button>
          </div>
        </div>
        <button style={{ width: '100%', marginTop: 28, padding: '14px 0', border: 'none',
          background: T.primary, color: T.primaryFg, borderRadius: 12, fontSize: 15, fontWeight: 700, fontFamily: T.font }}>登 录</button>
        <div style={{ marginTop: 22, textAlign: 'center', fontSize: 12.5, color: T.fgMuted }}>
          没收到验证码 ? <span style={{ color: T.primary }}>语音验证</span>
        </div>
      </div>
    </Phone>
  );
}

Object.assign(window, { ScreenLoginPwd, ScreenLoginSms });
