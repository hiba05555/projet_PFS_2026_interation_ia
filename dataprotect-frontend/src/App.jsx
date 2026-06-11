import { useState, useEffect, useRef } from "react";
import ChatWidget from './ChatWidget';


// ─── THEME ───────────────────────────────────────────────────────────────────
const T = {
  red: "#CC0000", darkred: "#990000", lightred: "#FF1A1A",
  navy: "#061E29", teal: "#1E5F74", sage: "#4E8A8A",
  dark: "#0A0A0A", dark2: "#111", dark3: "#1A1A1A",
  white: "#FFFFFF", light: "#F5F5F7", gray: "#888", lightgray: "#E5E5E5",
  success: "#1D9E75", warning: "#BA7517", danger: "#CC0000",
};

const glassCard = {
  background: "rgba(15,15,20,0.7)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(204,0,0,0.18)",
  boxShadow: "0 8px 32px rgba(204,0,0,0.08)",
  borderRadius: 12,
};

const darkInput = {
  width: "100%",
  padding: "10px 12px",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  fontSize: 12,
  color: "#fff",
  outline: "none",
};

// ─── GLOBAL STYLES ───────────────────────────────────────────────────────────
const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { height: 100%; font-family: 'Inter', sans-serif; }
    body { background: #0A0A0A; color: #FFFFFF; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
    ::-webkit-scrollbar-thumb { background: rgba(204,0,0,0.4); border-radius: 2px; }
    input, button, select, textarea { font-family: 'Inter', sans-serif; }
    select option { background: #1a1a2e; color: #fff; }
    input::placeholder, textarea::placeholder { color: rgba(255,255,255,0.25); }
    @keyframes pulse { 0%,100%{opacity:.3;transform:scale(1)} 50%{opacity:.7;transform:scale(1.05)} }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.2} }
    @keyframes fadeIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
    @keyframes slideIn { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)} }
    @keyframes scan { 0%,100%{opacity:.2} 50%{opacity:.7} }
    @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
    @keyframes float1 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(40px,-30px) scale(1.08)} 66%{transform:translate(-25px,15px) scale(0.94)} }
    @keyframes float2 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(-50px,25px) scale(1.12)} 66%{transform:translate(25px,-15px) scale(0.92)} }
    @keyframes float3 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(40px,35px) scale(1.18)} }
    @keyframes glowPulse { 0%,100%{box-shadow:0 0 15px rgba(204,0,0,0.25)} 50%{box-shadow:0 0 40px rgba(204,0,0,0.55),0 0 80px rgba(204,0,0,0.15)} }
  `}</style>
);

// ─── AURORA BACKGROUND ───────────────────────────────────────────────────────
function AuroraBackground({ children, style }) {
  return (
    <div style={{ position: "relative", background: "#0A0A0A", overflow: "hidden", ...style }}>
      <div style={{ position:"absolute", inset:0, zIndex:0, background:"radial-gradient(ellipse 80% 80% at 20% 40%, rgba(204,0,0,0.09) 0%, transparent 50%), radial-gradient(ellipse 60% 60% at 80% 20%, rgba(6,30,41,0.5) 0%, transparent 50%)" }} />
      <div style={{ position:"absolute", width:700, height:700, borderRadius:"50%", background:"radial-gradient(circle, rgba(204,0,0,0.07) 0%, transparent 70%)", top:-200, left:-200, animation:"float1 15s ease-in-out infinite", zIndex:0, pointerEvents:"none" }} />
      <div style={{ position:"absolute", width:500, height:500, borderRadius:"50%", background:"radial-gradient(circle, rgba(30,95,116,0.1) 0%, transparent 70%)", bottom:-100, right:-100, animation:"float2 18s ease-in-out infinite", zIndex:0, pointerEvents:"none" }} />
      <div style={{ position:"absolute", width:400, height:400, borderRadius:"50%", background:"radial-gradient(circle, rgba(204,0,0,0.05) 0%, transparent 70%)", top:"40%", right:"25%", animation:"float3 22s ease-in-out infinite", zIndex:0, pointerEvents:"none" }} />
      <div style={{ position:"absolute", inset:0, zIndex:0, backgroundImage:"linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px)", backgroundSize:"44px 44px", pointerEvents:"none" }} />
      <div style={{ position:"relative", zIndex:1, height:"100%", display:"flex" }}>
        {children}
      </div>
    </div>
  );
}


// ─── GOOEY TEXT MORPH ────────────────────────────────────────────────────────
function GooeyText({ texts, morphTime = 1.5, cooldownTime = 0.5, textStyle }) {
  const t1 = useRef(null);
  const t2 = useRef(null);
  useEffect(() => {
    let idx = texts.length - 1, time = new Date(), morph = 0, cd = cooldownTime, raf;
    const setMorph = f => {
      if (!t2.current || !t1.current) return;
      t2.current.style.filter = `blur(${Math.min(8/f-8,100)}px)`;
      t2.current.style.opacity = `${Math.pow(f,0.4)*100}%`;
      f = 1 - f;
      t1.current.style.filter = `blur(${Math.min(8/f-8,100)}px)`;
      t1.current.style.opacity = `${Math.pow(f,0.4)*100}%`;
    };
    const doCooldown = () => { morph=0; if(t2.current){t2.current.style.filter="";t2.current.style.opacity="100%";} if(t1.current){t1.current.style.filter="";t1.current.style.opacity="0%";} };
    const doMorph = () => { morph-=cd; cd=0; let f=morph/morphTime; if(f>1){cd=cooldownTime;f=1;} setMorph(f); };
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = new Date(), shouldInc = cd > 0, dt = (now-time)/1000;
      time = now; cd -= dt;
      if (cd <= 0) {
        if (shouldInc) {
          idx = (idx+1) % texts.length;
          if(t1.current) t1.current.textContent = texts[idx % texts.length];
          if(t2.current) t2.current.textContent = texts[(idx+1) % texts.length];
        }
        doMorph();
      } else doCooldown();
    };
    animate();
    return () => cancelAnimationFrame(raf);
  }, [texts, morphTime, cooldownTime]);

  return (
    <div style={{ position:"relative", height:28, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <svg style={{ position:"absolute", height:0, width:0 }} aria-hidden="true">
        <defs><filter id="goo-thresh"><feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 255 -140"/></filter></defs>
      </svg>
      <div style={{ filter:"url(#goo-thresh)", display:"flex", alignItems:"center", justifyContent:"center", width:"100%" }}>
        <span ref={t1} style={{ position:"absolute", display:"inline-block", userSelect:"none", ...textStyle }} />
        <span ref={t2} style={{ position:"absolute", display:"inline-block", userSelect:"none", ...textStyle }} />
      </div>
    </div>
  );
}

// ─── ANIMATED TEXT CYCLE ─────────────────────────────────────────────────────
function AnimatedTextCycle({ texts, interval = 3000, style }) {
  const [idx, setIdx] = useState(0);
  const [vis, setVis] = useState(true);
  useEffect(() => {
    const t1 = setTimeout(() => setVis(false), interval - 500);
    const t2 = setTimeout(() => { setIdx(i => (i+1)%texts.length); setVis(true); }, interval);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [idx, interval, texts.length]);
  return <span style={{ display:"inline-block", transition:"opacity 0.5s", opacity: vis ? 1 : 0, ...style }}>{texts[idx]}</span>;
}

// ─── CURSOR CARD ─────────────────────────────────────────────────────────────
function CursorCard({ children, style }) {
  const ref = useRef(null);
  const [m, setM] = useState({ x:0, y:0, on:false });
  return (
    <div
      ref={ref}
      onMouseMove={e => { const r=ref.current.getBoundingClientRect(); setM({x:e.clientX-r.left,y:e.clientY-r.top,on:true}); }}
      onMouseLeave={() => setM(p=>({...p,on:false}))}
      style={{
        backgroundImage: m.on ? `radial-gradient(500px circle at ${m.x}px ${m.y}px, rgba(204,0,0,0.07) 0%, transparent 40%)` : "none",
        backgroundColor: "rgba(15,15,20,0.7)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: `1px solid ${m.on ? "rgba(204,0,0,0.35)" : "rgba(204,0,0,0.18)"}`,
        boxShadow: m.on ? "0 8px 40px rgba(204,0,0,0.15)" : "0 8px 32px rgba(204,0,0,0.08)",
        borderRadius: 12,
        transition: "border-color 0.2s, box-shadow 0.2s",
        ...style,
      }}
    >{children}</div>
  );
}

// ─── STARDUST BUTTON ─────────────────────────────────────────────────────────
function StardustButton({ children, onClick, disabled, style, type="button" }) {
  const [hov, setHov] = useState(false);
  const [press, setPress] = useState(false);
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>{setHov(false);setPress(false);}}
      onMouseDown={()=>setPress(true)} onMouseUp={()=>setPress(false)}
      style={{
        background: disabled ? "rgba(120,120,120,0.3)" : hov ? "rgba(220,0,0,0.95)" : "rgba(204,0,0,0.85)",
        color: "#fff",
        border: `1px solid ${disabled ? "rgba(150,150,150,0.2)" : "rgba(204,0,0,0.6)"}`,
        borderRadius: 10,
        padding: "12px 24px",
        fontSize: 14,
        fontWeight: 600,
        fontFamily: "'Rajdhani', sans-serif",
        letterSpacing: "0.1em",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.2s",
        transform: press ? "scale(0.98)" : "scale(1)",
        boxShadow: hov && !disabled ? "0 0 25px rgba(204,0,0,0.5), 0 0 50px rgba(204,0,0,0.2)" : "0 0 10px rgba(204,0,0,0.2)",
        backdropFilter: "blur(10px)",
        ...style,
      }}
    >{children}</button>
  );
}

// ─── ANIMATED BAR CHART ──────────────────────────────────────────────────────
function AnimatedBarChart({ data, height=110 }) {
  const [vis, setVis] = useState(false);
  useEffect(() => { const t = setTimeout(()=>setVis(true), 200); return ()=>clearTimeout(t); }, []);
  const max = Math.max(...data.map(d=>d.v));
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8, height, padding:"0 4px" }}>
      {data.map(({l,v,c=T.red},i) => (
        <div key={l} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:6, height:"100%", justifyContent:"flex-end" }}>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)" }}>{v}</div>
          <div style={{
            width:"100%", borderRadius:"4px 4px 0 0",
            background: `linear-gradient(180deg, ${c} 0%, ${c}88 100%)`,
            boxShadow: `0 0 10px ${c}50`,
            height: vis ? `${(v/max)*80}%` : "0%",
            transition: `height ${0.5+i*0.08}s ease`,
            minHeight: 3,
          }} />
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.45)", textAlign:"center" }}>{l}</div>
        </div>
      ))}
    </div>
  );
}

// ─── ICON ────────────────────────────────────────────────────────────────────
function Icon({ name, size=16, color="currentColor" }) {
  const icons = {
    grid: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></>,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    monitor: <><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></>,
    dollar: <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
    box: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></>,
    "user-plus": <><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></>,
    home: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    "help-circle": <><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    check: <polyline points="20 6 9 13.5 4 8.5"/>,
    clock: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
    "trending-up": <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>,
    "alert-circle": <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,
    search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    menu: <><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  );
}

// ─── PASSWORD STRENGTH ───────────────────────────────────────────────────────
function PasswordStrength({ password }) {
  if (!password) return null;
  const checks = [
    { label: '8+ chars', ok: password.length >= 8 },
    { label: 'A-Z', ok: /[A-Z]/.test(password) },
    { label: 'a-z', ok: /[a-z]/.test(password) },
    { label: '0-9', ok: /[0-9]/.test(password) },
    { label: '!@#', ok: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) },
  ];
  const score = checks.filter(c => c.ok).length;
  const levels = ['', 'Très faible', 'Faible', 'Moyen', 'Fort', 'Très fort'];
  const colors = ['', T.red, T.red, T.warning, T.success, T.success];
  return (
    <div style={{ marginTop:8, marginBottom:4 }}>
      <div style={{ display:"flex", gap:4, marginBottom:6 }}>
        {[1,2,3,4,5].map(i => (
          <div key={i} style={{ flex:1, height:3, borderRadius:2, background: i<=score ? colors[score] : "rgba(255,255,255,0.1)", transition:"background .3s" }} />
        ))}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:10, color: colors[score], fontWeight:500 }}>{levels[score]}</div>
        <div style={{ display:"flex", gap:8 }}>
          {checks.map(c => (
            <span key={c.label} style={{ fontSize:9, color: c.ok ? T.success : "rgba(255,255,255,0.3)", display:"flex", alignItems:"center", gap:2 }}>
              {c.ok ? '✓' : '○'} {c.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ANIMATED COUNTER ────────────────────────────────────────────────────────
function AnimCounter({ to, duration=1200, suffix="" }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = to / (duration / 16);
    const t = setInterval(() => {
      start = Math.min(start + step, to);
      setVal(Math.round(start));
      if (start >= to) clearInterval(t);
    }, 16);
    return () => clearInterval(t);
  }, [to]);
  return <>{val.toLocaleString()}{suffix}</>;
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [remember, setRemember] = useState(false);
  const [showPw, setShowPw]     = useState(false);

  const handleLogin = async () => {
    if (!email || !password) { setError("Veuillez remplir tous les champs"); return; }
    setLoading(true); setError("");
    try {
      const res  = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Erreur de connexion");
      localStorage.setItem("token",        data.token);
      localStorage.setItem("user",         JSON.stringify(data.user));
      localStorage.setItem("mustChangePw", data.mustChangePassword ? "true" : "false");
      onLogin(data.user, data.token, data.mustChangePassword);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <AuroraBackground style={{ width:"100vw", height:"100vh", overflow:"hidden" }}>

      {/*
        ═══════════════════════════════════════════════════════════
        WRAPPER : occupe 100% de la largeur ET de la hauteur
        Les deux colonnes se partagent tout l'espace disponible :
          • Gauche : flex 2  → ~40% de la largeur
          • Droite : flex 3  → ~60% de la largeur  (1.5× la gauche)
        Aucun padding latéral sur le wrapper = pas de vide aux bords
        ═══════════════════════════════════════════════════════════
      */}
      <div style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: "100%",
        alignItems: "center",
      }}>

        {/* ══════════════════════════════════════════
            COLONNE GAUCHE — Branding DataProtect
            flex:2 = 40% de la largeur totale
            Contenu centré dans sa colonne
        ══════════════════════════════════════════ */}
        <div style={{
          flex: 2,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "40px 32px",
          boxSizing: "border-box",
          borderRight: "1px solid rgba(204,0,0,0.08)",
        }}>

          {/* Logo Shield */}
          <div style={{
            width:110, height:110, borderRadius:"50%",
            border:"1.5px solid rgba(204,0,0,0.5)",
            display:"flex", alignItems:"center", justifyContent:"center",
            marginBottom:28,
            animation:"glowPulse 3s ease-in-out infinite",
            backdropFilter:"blur(10px)",
            background:"rgba(204,0,0,0.05)",
          }}>
            <div style={{
              width:86, height:86, borderRadius:"50%",
              background:"rgba(255,255,255,0.04)",
              border:"1px solid rgba(204,0,0,0.3)",
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(204,0,0,0.9)" strokeWidth="1.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
          </div>

          {/* DATAPROTECT */}
          <div style={{ fontFamily:"'Rajdhani',sans-serif", marginBottom:12, textAlign:"center" }}>
            <span style={{ fontSize:36, fontWeight:700, color:T.red, letterSpacing:3, textShadow:"0 0 30px rgba(204,0,0,0.4)" }}>DATA</span>
            <span style={{ fontSize:36, fontWeight:700, color:T.white, letterSpacing:3 }}>PROTECT</span>
          </div>

          <GooeyText
            texts={["work environment","secure workspace","growth hub","protection layer"]}
            textStyle={{ fontSize:13, color:"rgba(255,255,255,0.45)", letterSpacing:"0.05em" }}
          />

          {/* Scan Lines */}
          <div style={{ marginTop:20 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                height:1, width:`${140-i*20}px`, marginBottom:8,
                background:`linear-gradient(90deg,transparent,rgba(204,0,0,${0.4+i*0.1}),transparent)`,
                animation:`scan ${2+i*0.4}s ease-in-out infinite`,
                animationDelay:`${i*0.3}s`,
              }} />
            ))}
          </div>

          {/* Status Badge */}
          <div style={{
            marginTop:24, ...glassCard,
            padding:"6px 16px", fontSize:10,
            color:"rgba(255,255,255,0.5)",
            display:"flex", alignItems:"center", gap:8,
          }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:"#1D9E75", animation:"blink 1.5s infinite" }} />
            Système opérationnel — Connexion sécurisée
          </div>

          {/* Stats Grid */}
          <div style={{ marginTop:24, display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, width:"100%", maxWidth:320 }}>
            {[["247","Utilisateurs actifs"],["99.9%","Disponibilité"],["AES-256","Chiffrement"],["JWT","Auth"]].map(([v,l]) => (
              <div key={l} style={{ ...glassCard, padding:"10px 12px", textAlign:"center" }}>
                <div style={{ fontSize:14, fontWeight:600, color:T.red, fontFamily:"'Rajdhani',sans-serif" }}>{v}</div>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", marginTop:2 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════════
            COLONNE DROITE — Carte formulaire
            flex:3 = 60% de la largeur totale (1.5× gauche)
            Carte centrée dans sa colonne avec padding
        ══════════════════════════════════════════ */}
        <div style={{
          flex: 3,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",           /* centre la carte dans les 60% */
          padding: "40px 60px 40px 0px",           /* espace intérieur confortable */
          boxSizing: "border-box",
          animation: "slideIn .5s ease",
        }}>

          {/* La carte occupe toute la largeur disponible dans sa colonne */}
          <div style={{
            ...glassCard,
            padding: "40px 48px",
            borderRadius: 20,
            width: "100%",               /* s'étale sur toute la colonne */
            maxWidth: 780,               /* plafond raisonnable */
          }}>

            {/* User Icon */}
            <div style={{
              width:52, height:52, borderRadius:"50%",
              background:"rgba(204,0,0,0.1)",
              border:"1.5px solid rgba(204,0,0,0.4)",
              display:"flex", alignItems:"center", justifyContent:"center",
              marginBottom:20,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(204,0,0,0.8)" strokeWidth="1.5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>

            {/* Title */}
            <div style={{ fontSize:26, fontWeight:500, color:T.white, marginBottom:4 }}>
              Bon retour <span style={{ color:T.red }}>.</span>
            </div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", marginBottom:28, lineHeight:1.6 }}>
              Connectez-vous à votre espace de travail sécurisé
            </div>

            {/* Identifiant */}
            <div style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontSize:10, fontWeight:600, color:"rgba(255,255,255,0.4)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.07em" }}>
                IDENTIFIANT
              </label>
              <input
                type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key==="Enter" && handleLogin()}
                placeholder="votre.email@dataprotect.ma"
                style={{ ...darkInput, padding:"12px 14px", borderRadius:10, fontSize:13 }}
                onFocus={e => e.target.style.borderColor="rgba(204,0,0,0.6)"}
                onBlur={e  => e.target.style.borderColor="rgba(255,255,255,0.1)"}
              />
            </div>

            {/* Mot de passe */}
            <div style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontSize:10, fontWeight:600, color:"rgba(255,255,255,0.4)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.07em" }}>
                MOT DE PASSE
              </label>
              <div style={{ position:"relative" }}>
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key==="Enter" && handleLogin()}
                  placeholder="••••••••"
                  style={{ ...darkInput, padding:"12px 44px 12px 14px", borderRadius:10, fontSize:13 }}
                  onFocus={e => e.target.style.borderColor="rgba(204,0,0,0.6)"}
                  onBlur={e  => e.target.style.borderColor="rgba(255,255,255,0.1)"}
                />
                <button onClick={() => setShowPw(!showPw)} style={{
                  position:"absolute", right:12, top:"50%", transform:"translateY(-50%)",
                  background:"none", border:"none", cursor:"pointer", padding:4,
                  color:"rgba(255,255,255,0.3)",
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    {showPw
                      ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                      : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                    }
                  </svg>
                </button>
              </div>
            </div>

            {/* Remember + Forgot */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
              <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"rgba(255,255,255,0.35)", cursor:"pointer" }}>
                <input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} style={{ accentColor:T.red }} />
                Se souvenir de moi
              </label>
              <span style={{ fontSize:11, color:T.red, cursor:"pointer" }}>Mot de passe oublié ?</span>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background:"rgba(204,0,0,0.12)", border:"0.5px solid rgba(204,0,0,0.4)",
                borderRadius:8, padding:"10px 14px", fontSize:12, color:"#ff8888", marginBottom:14,
              }}>{error}</div>
            )}

            {/* Login Button */}
            <StardustButton onClick={handleLogin} disabled={loading} style={{ width:"100%", padding:"14px", borderRadius:10, fontSize:14 }}>
              {loading ? "CONNEXION..." : "LOGIN"}
            </StardustButton>

            {/* Progress Dots */}
            <div style={{ display:"flex", justifyContent:"center", gap:6, marginTop:18 }}>
              {[true,false,false].map((a,i) => (
                <div key={i} style={{
                  height:5, width:a?18:5, borderRadius:3,
                  background:a?T.red:"rgba(255,255,255,0.12)",
                  transition:"all .3s",
                }} />
              ))}
            </div>

            {/* Footer */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginTop:14, fontSize:10, color:"rgba(255,255,255,0.18)" }}>
              {["DataProtect © 2026","AES-256","JWT"].map((t,i) => (
                <span key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  {i>0 && <span style={{ width:3, height:3, borderRadius:"50%", background:"rgba(255,255,255,0.18)", display:"inline-block" }} />}
                  {t}
                </span>
              ))}
            </div>

          </div>
        </div>

      </div>
    </AuroraBackground>
  );
}




// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
const DEPT_MODULE = { IT:"it", HR:"hr", Finance:"finance", Operations:"operations" };
const DEPT_LABEL  = { IT:"Informatique", HR:"Ressources Humaines", Finance:"Finance", Operations:"Opérations" };
const DEPT_ICON   = { IT:"monitor", HR:"users", Finance:"dollar", Operations:"box" };

const MENU = {
  admin: [
    { id:"dashboard", label:"Dashboard", icon:"grid" },
    { id:"hr", label:"Ressources Humaines", icon:"users", badge:12 },
    { id:"it", label:"Informatique", icon:"monitor", badge:5 },
    { id:"finance", label:"Finance", icon:"dollar" },
    { id:"operations", label:"Opérations", icon:"box" },
    { id:"users", label:"Utilisateurs", icon:"user-plus" },
  ],
  employee: [
    { id:"home", label:"Accueil", icon:"home" },
    { id:"tickets", label:"Mes tickets", icon:"help-circle", badge:2 },
    { id:"leave", label:"Congés", icon:"calendar" },
    { id:"profile", label:"Mon profil", icon:"user" },
  ],
};

// Génère le menu pour un manager selon son département
const getManagerMenu = (user) => {
  const dept = user?.department;
  const moduleId = DEPT_MODULE[dept];
  const moduleItem = moduleId
    ? [{ id: moduleId, label: DEPT_LABEL[dept] || dept, icon: DEPT_ICON[dept] || "box" }]
    : [];
  return [
    { id:"dashboard", label:"Dashboard", icon:"grid" },
    ...moduleItem,
    { id:"tickets", label:"Mes tickets", icon:"help-circle", badge:2 },
    { id:"leave", label:"Congés", icon:"calendar" },
    { id:"profile", label:"Mon profil", icon:"user" },
  ];
};

function Sidebar({ user, active, setActive, onLogout, collapsed, setCollapsed }) {
  const isAdmin   = user?.role === "admin";
  const isManager = user?.role === "manager";
  const role = isAdmin ? "admin" : "employee";
  const menu = isAdmin ? MENU.admin : isManager ? getManagerMenu(user) : MENU.employee;
  return (
    <div style={{ width:collapsed?64:220, background:"rgba(6,20,33,0.95)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", display:"flex", flexDirection:"column", borderRight:"1px solid rgba(204,0,0,0.12)", flexShrink:0, transition:"width .25s ease", overflow:"hidden" }}>
      <div style={{ padding:"16px 14px", borderBottom:"1px solid rgba(255,255,255,0.05)", display:"flex", alignItems:"center", justifyContent:"space-between", minHeight:56 }}>
        {!collapsed && (
          <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:15, fontWeight:700, letterSpacing:1, whiteSpace:"nowrap" }}>
            <span style={{ color:T.red }}>DATA</span><span style={{ color:T.white }}>PROTECT</span>
          </div>
        )}
        <button onClick={()=>setCollapsed(!collapsed)}
          style={{ background:"transparent", border:"none", cursor:"pointer", padding:4, display:"flex", alignItems:"center", justifyContent:"center", color:"rgba(255,255,255,0.4)", marginLeft:collapsed?"auto":0, flexShrink:0 }}>
          <Icon name="menu" size={18} color="rgba(255,255,255,0.4)"/>
        </button>
      </div>

      {!collapsed && (
        <div style={{ padding:"6px 18px 4px", fontSize:9, fontWeight:500, color:"rgba(255,255,255,0.25)", textTransform:"uppercase", letterSpacing:"0.08em", marginTop:8 }}>
          {isAdmin ? "Administration" : isManager ? `Manager · ${user?.department||""}` : "Portail Employé"}
        </div>
      )}

      <nav style={{ flex:1, padding:"8px 0", overflowY:"auto" }}>
        {menu.map(item => (
          <div key={item.id} onClick={()=>setActive(item.id)}
            title={collapsed ? item.label : ""}
            style={{ display:"flex", alignItems:"center", gap:collapsed?0:10, padding:collapsed?"10px 0":"10px 18px", justifyContent:collapsed?"center":"flex-start", fontSize:12, color:active===item.id?"#fff":"rgba(255,255,255,0.45)", background:active===item.id?"rgba(204,0,0,0.15)":"transparent", borderLeft:`3px solid ${active===item.id?T.red:"transparent"}`, cursor:"pointer", transition:"all .15s", position:"relative", boxShadow:active===item.id?"inset 0 0 20px rgba(204,0,0,0.05)":"none" }}>
            <Icon name={item.icon} size={15} color={active===item.id?T.red:"rgba(255,255,255,0.35)"} />
            {!collapsed && item.label}
            {!collapsed && item.badge && <span style={{ marginLeft:"auto", background:T.red, color:"#fff", fontSize:9, padding:"2px 6px", borderRadius:10, boxShadow:"0 0 8px rgba(204,0,0,0.4)" }}>{item.badge}</span>}
            {collapsed && item.badge && <span style={{ position:"absolute", top:6, right:8, width:8, height:8, borderRadius:"50%", background:T.red, boxShadow:"0 0 6px rgba(204,0,0,0.6)" }} />}
          </div>
        ))}
      </nav>

      <div style={{ padding:"14px", borderTop:"1px solid rgba(255,255,255,0.05)" }}>
        {!collapsed && (
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <div style={{ width:30, height:30, borderRadius:"50%", background:"rgba(204,0,0,0.2)", border:"1px solid rgba(204,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:600, color:T.red, flexShrink:0 }}>
              {user?.username?.[0]?.toUpperCase() || "U"}
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:11, fontWeight:500, color:"rgba(255,255,255,0.9)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user?.username}</div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)" }}>{user?.department}</div>
            </div>
          </div>
        )}
        <button onClick={onLogout} title={collapsed?"Déconnexion":""}
          style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:collapsed?"center":"flex-start", gap:8, padding:"7px 10px", background:"rgba(204,0,0,0.08)", border:"0.5px solid rgba(204,0,0,0.2)", borderRadius:8, color:"rgba(255,255,255,0.45)", fontSize:11, cursor:"pointer", transition:"all .2s" }}
          onMouseEnter={e=>{e.currentTarget.style.background="rgba(204,0,0,0.18)";e.currentTarget.style.color="#fff";}}
          onMouseLeave={e=>{e.currentTarget.style.background="rgba(204,0,0,0.08)";e.currentTarget.style.color="rgba(255,255,255,0.45)";}}>
          <Icon name="logout" size={13} color="rgba(204,0,0,0.7)" />
          {!collapsed && "Déconnexion"}
        </button>
      </div>
    </div>
  );
}

// ─── TOPBAR ──────────────────────────────────────────────────────────────────
function Topbar({ title, user }) {
  return (
    <div style={{ background:"rgba(6,20,33,0.8)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", padding:"0 24px", height:56, display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:"1px solid rgba(255,255,255,0.05)", flexShrink:0 }}>
      <div style={{ fontSize:15, fontWeight:500, color:"rgba(255,255,255,0.9)", fontFamily:"'Rajdhani',sans-serif", letterSpacing:0.5 }}>{title}</div>
      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
        <div style={{ position:"relative", cursor:"pointer" }}>
          <Icon name="bell" size={18} color="rgba(255,255,255,0.5)" />
          <div style={{ position:"absolute", top:0, right:0, width:7, height:7, borderRadius:"50%", background:T.red, boxShadow:"0 0 6px rgba(204,0,0,0.7)" }} />
        </div>
        <div style={{ width:32, height:32, borderRadius:"50%", background:"rgba(204,0,0,0.2)", border:"1px solid rgba(204,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:600, color:T.red }}>
          {user?.username?.[0]?.toUpperCase() || "U"}
        </div>
      </div>
    </div>
  );
}

// ─── STAT CARD ───────────────────────────────────────────────────────────────
function StatCard({ label, value, trend, trendUp, icon, color, delay=0 }) {
  return (
    <CursorCard style={{ padding:18, animation:`fadeIn .5s ease ${delay}s both`, cursor:"default" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
        <div style={{ width:36, height:36, borderRadius:10, background:`${color}18`, border:`1px solid ${color}30`, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Icon name={icon} size={17} color={color} />
        </div>
        {trend && <span style={{ fontSize:10, fontWeight:500, padding:"3px 8px", borderRadius:20, background:trendUp?"rgba(29,158,117,0.15)":"rgba(204,0,0,0.12)", color:trendUp?T.success:"#ff8888", border:`1px solid ${trendUp?"rgba(29,158,117,0.3)":"rgba(204,0,0,0.3)"}` }}>{trend}</span>}
      </div>
      <div style={{ fontSize:28, fontWeight:600, color:"#fff", fontFamily:"'Rajdhani',sans-serif" }}>
        <AnimCounter to={typeof value==="number"?value:0} />
        {typeof value==="string" && value}
      </div>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginTop:4 }}>{label}</div>
    </CursorCard>
  );
}

// ─── MODULE BG WRAPPER ───────────────────────────────────────────────────────
function ModulePage({ children }) {
  return (
    <div style={{ position:"relative", background:"#0A0A0A", height:"100%", overflow:"hidden" }}>
      <div style={{ position:"absolute", width:500, height:500, borderRadius:"50%", background:"radial-gradient(circle, rgba(204,0,0,0.04) 0%, transparent 70%)", top:-200, right:-100, pointerEvents:"none", zIndex:0 }} />
      <div style={{ position:"absolute", width:400, height:400, borderRadius:"50%", background:"radial-gradient(circle, rgba(6,30,41,0.5) 0%, transparent 70%)", bottom:-150, left:-100, pointerEvents:"none", zIndex:0 }} />
      <div style={{ position:"relative", zIndex:1, padding:24, overflowY:"auto", height:"100%" }}>
        {children}
      </div>
    </div>
  );
}

// ─── ADMIN DASHBOARD ─────────────────────────────────────────────────────────
function AdminDashboard({ user }) {
  const stats = [
    { label:"Employés actifs", value:247, trend:"+8%", trendUp:true, icon:"users", color:T.teal, delay:0 },
    { label:"Tickets ouverts", value:18, trend:"+3", trendUp:false, icon:"help-circle", color:T.red, delay:.1 },
    { label:"Budget restant (k MAD)", value:342, trend:"-2%", trendUp:false, icon:"dollar", color:T.warning, delay:.2 },
    { label:"Projets actifs", value:12, trend:"+12%", trendUp:true, icon:"box", color:T.success, delay:.3 },
  ];
  const barData = [
    {l:"HR",v:75,c:T.teal},{l:"Finance",v:55,c:T.red},{l:"IT",v:88,c:T.sage},{l:"Ops",v:62,c:T.warning},{l:"Admin",v:40,c:"#888"}
  ];
  const recent = [
    { user:"Hiba C.", action:"Ticket créé", dept:"IT", time:"Il y a 5 min", status:"open" },
    { user:"Ahmed M.", action:"Congé approuvé", dept:"HR", time:"Il y a 23 min", status:"done" },
    { user:"Sara B.", action:"Facture soumise", dept:"Finance", time:"Il y a 1h", status:"pending" },
    { user:"Karim D.", action:"Compte créé", dept:"IT", time:"Il y a 2h", status:"done" },
    { user:"Leila N.", action:"Rapport généré", dept:"Finance", time:"Il y a 3h", status:"done" },
  ];
  return (
    <ModulePage>
      {/* Welcome */}
      <div style={{ marginBottom:20, animation:"fadeIn .4s ease" }}>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", marginBottom:4 }}>Bienvenue,</div>
        <div style={{ fontSize:22, fontWeight:600, color:"#fff", fontFamily:"'Rajdhani',sans-serif", letterSpacing:0.5 }}>
          {user?.username || "Admin"} — <AnimatedTextCycle texts={["Vue d'ensemble","Tableau de bord","Monitoring","Analytics"]} style={{ color:T.red }} />
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:20 }}>
        {stats.map(s=><StatCard key={s.label} {...s} />)}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1.6fr 1fr", gap:14, marginBottom:20 }}>
        <CursorCard style={{ padding:18 }}>
          <div style={{ fontSize:12, fontWeight:500, color:"rgba(255,255,255,0.7)", marginBottom:16, fontFamily:"'Rajdhani',sans-serif", letterSpacing:0.5 }}>Activité par département</div>
          <AnimatedBarChart data={barData} height={110} />
        </CursorCard>
        <CursorCard style={{ padding:18 }}>
          <div style={{ fontSize:12, fontWeight:500, color:"rgba(255,255,255,0.7)", marginBottom:16, fontFamily:"'Rajdhani',sans-serif", letterSpacing:0.5 }}>Statut des tickets</div>
          {[["Ouverts",35,T.red],["En cours",45,T.teal],["Résolus",20,T.success]].map(([l,v,c])=>(
            <div key={l} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:c, boxShadow:`0 0 6px ${c}80`, flexShrink:0 }} />
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", flex:1 }}>{l}</div>
              <div style={{ flex:2, height:5, borderRadius:3, background:"rgba(255,255,255,0.05)", overflow:"hidden" }}>
                <div style={{ height:"100%", borderRadius:3, background:c, width:`${v}%`, transition:"width 1s ease", boxShadow:`0 0 8px ${c}50` }} />
              </div>
              <div style={{ fontSize:11, fontWeight:500, color:"rgba(255,255,255,0.7)", width:30, textAlign:"right" }}>{v}%</div>
            </div>
          ))}
        </CursorCard>
      </div>

      <CursorCard style={{ overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:"1px solid rgba(255,255,255,0.04)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontSize:12, fontWeight:500, color:"rgba(255,255,255,0.7)", fontFamily:"'Rajdhani',sans-serif", letterSpacing:0.5 }}>Activité récente</div>
        </div>
        {recent.map((r,i)=>(
          <div key={i} style={{ display:"flex", alignItems:"center", padding:"12px 18px", borderBottom:"1px solid rgba(255,255,255,0.03)", gap:12, animation:`fadeIn .3s ease ${i*.08}s both` }}>
            <div style={{ width:32, height:32, borderRadius:"50%", background:"rgba(204,0,0,0.12)", border:"1px solid rgba(204,0,0,0.25)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:600, color:T.red, flexShrink:0 }}>
              {r.user[0]}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.85)", fontWeight:500 }}>{r.user} <span style={{ fontWeight:400, color:"rgba(255,255,255,0.4)" }}>— {r.action}</span></div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", marginTop:2 }}>{r.dept} · {r.time}</div>
            </div>
            <span style={{ fontSize:10, padding:"3px 10px", borderRadius:20, fontWeight:500,
              background:r.status==="open"?"rgba(204,0,0,0.12)":r.status==="done"?"rgba(29,158,117,0.12)":"rgba(186,117,23,0.12)",
              color:r.status==="open"?"#ff8888":r.status==="done"?T.success:T.warning,
              border:`1px solid ${r.status==="open"?"rgba(204,0,0,0.25)":r.status==="done"?"rgba(29,158,117,0.25)":"rgba(186,117,23,0.25)"}` }}>
              {r.status==="open"?"Ouvert":r.status==="done"?"Fait":"En cours"}
            </span>
          </div>
        ))}
      </CursorCard>
    </ModulePage>
  );
}

// ─── HR MODULE ───────────────────────────────────────────────────────────────
function HRModule({ token }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ first_name:"", last_name:"", email:"", department:"", position:"", hire_date:"" });

  useEffect(()=>{ fetchEmployees(); }, []);

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const r = await fetch("http://localhost/api/hr/employees", { headers:{ Authorization:`Bearer ${token}` } });
      const d = await r.json();
      setEmployees(d.data || []);
    } catch {}
    setLoading(false);
  };

  const createEmployee = async () => {
    if (!form.first_name || !form.email || !form.hire_date) return;
    await fetch("http://localhost/api/hr/employees", {
      method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
      body: JSON.stringify(form)
    });
    setShowForm(false); setForm({ first_name:"", last_name:"", email:"", department:"", position:"", hire_date:"" });
    fetchEmployees();
  };

  const labelStyle = { display:"block", fontSize:10, fontWeight:600, color:"rgba(255,255,255,0.4)", marginBottom:5, textTransform:"uppercase", letterSpacing:"0.06em" };

  return (
    <ModulePage>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:500, color:"#fff", fontFamily:"'Rajdhani',sans-serif" }}>Ressources Humaines</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginTop:2 }}>{employees.length} employé(s) enregistré(s)</div>
        </div>
        <StardustButton onClick={()=>setShowForm(!showForm)} style={{ padding:"9px 16px", fontSize:12, display:"flex", alignItems:"center", gap:6 }}>
          <Icon name="plus" size={14} color="#fff" /> Nouvel employé
        </StardustButton>
      </div>

      {showForm && (
        <CursorCard style={{ padding:20, marginBottom:20, animation:"fadeIn .3s ease" }}>
          <div style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.85)", marginBottom:16, fontFamily:"'Rajdhani',sans-serif" }}>Ajouter un employé</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            {[["Prénom","first_name","text"],["Nom","last_name","text"],["Email","email","email"],["Département","department","text"],["Poste","position","text"],["Date d'embauche","hire_date","date"]].map(([l,k,t])=>(
              <div key={k}>
                <label style={labelStyle}>{l}</label>
                <input type={t} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} style={{ ...darkInput }} />
              </div>
            ))}
          </div>
          <div style={{ display:"flex", gap:8, marginTop:16 }}>
            <StardustButton onClick={createEmployee} style={{ padding:"9px 20px", fontSize:12 }}>Créer</StardustButton>
            <button onClick={()=>setShowForm(false)} style={{ padding:"9px 20px", background:"rgba(255,255,255,0.05)", color:"rgba(255,255,255,0.5)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, fontSize:12, cursor:"pointer" }}>Annuler</button>
          </div>
        </CursorCard>
      )}

      <CursorCard style={{ overflow:"hidden" }}>
        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr", padding:"12px 18px", background:"rgba(6,30,41,0.8)", gap:8 }}>
          {["Employé","Département","Poste","Statut"].map(h=><div key={h} style={{ fontSize:10, fontWeight:500, color:"rgba(255,255,255,0.45)", textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</div>)}
        </div>
        {loading ? (
          <div style={{ padding:40, textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:12 }}>Chargement...</div>
        ) : employees.length === 0 ? (
          <div style={{ padding:40, textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:12 }}>Aucun employé. Ajoutez le premier !</div>
        ) : employees.map((e,i)=>(
          <div key={i} style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr", padding:"14px 18px", gap:8, borderBottom:"1px solid rgba(255,255,255,0.03)", animation:`fadeIn .3s ease ${i*.05}s both` }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:30, height:30, borderRadius:"50%", background:"rgba(204,0,0,0.12)", border:"1px solid rgba(204,0,0,0.25)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:600, color:T.red, flexShrink:0 }}>
                {e.first_name?.[0]}{e.last_name?.[0]}
              </div>
              <div>
                <div style={{ fontSize:12, fontWeight:500, color:"rgba(255,255,255,0.85)" }}>{e.first_name} {e.last_name}</div>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>{e.email}</div>
              </div>
            </div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)", display:"flex", alignItems:"center" }}>{e.department||"—"}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)", display:"flex", alignItems:"center" }}>{e.position||"—"}</div>
            <div style={{ display:"flex", alignItems:"center" }}>
              <span style={{ fontSize:10, padding:"3px 10px", borderRadius:20, background:e.status==="active"?"rgba(29,158,117,0.12)":"rgba(255,255,255,0.05)", color:e.status==="active"?T.success:"rgba(255,255,255,0.3)", border:`1px solid ${e.status==="active"?"rgba(29,158,117,0.3)":"rgba(255,255,255,0.08)"}`, fontWeight:500 }}>
                {e.status==="active"?"Actif":"Inactif"}
              </span>
            </div>
          </div>
        ))}
      </CursorCard>
    </ModulePage>
  );
}

// ─── IT MODULE ───────────────────────────────────────────────────────────────
function ITModule({ token, user }) {
  const [tickets, setTickets] = useState([]);
  const [myTickets, setMyTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title:"", description:"", priority:"medium", category:"general" });
  const isIT = user?.department === "IT" || user?.role === "admin";

  useEffect(()=>{ fetchTickets(); }, []);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      if (isIT) {
        const r = await fetch("http://localhost/api/it/helpdesk", { headers:{ Authorization:`Bearer ${token}` } });
        const d = await r.json();
        setTickets(d.data || []);
      }
      const r2 = await fetch("http://localhost/api/it/helpdesk/my-tickets", { headers:{ Authorization:`Bearer ${token}` } });
      const d2 = await r2.json();
      setMyTickets(d2.data || []);
    } catch {}
    setLoading(false);
  };

  const createTicket = async () => {
    if (!form.title || !form.description) return;
    await fetch("http://localhost/api/it/helpdesk", {
      method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
      body: JSON.stringify(form)
    });
    setShowForm(false); setForm({ title:"", description:"", priority:"medium", category:"general" });
    fetchTickets();
  };

  const statusColor = s => s==="open"?T.red:s==="in_progress"?T.warning:s==="resolved"?T.success:"#888";
  const statusLabel = s => s==="open"?"Ouvert":s==="in_progress"?"En cours":s==="resolved"?"Résolu":"Inconnu";
  const displayTickets = isIT ? tickets : myTickets;
  const labelStyle = { display:"block", fontSize:10, fontWeight:600, color:"rgba(255,255,255,0.4)", marginBottom:5, textTransform:"uppercase", letterSpacing:"0.06em" };

  return (
    <ModulePage>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:500, color:"#fff", fontFamily:"'Rajdhani',sans-serif" }}>Helpdesk IT</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginTop:2 }}>{isIT ? `${tickets.length} ticket(s) total` : `${myTickets.length} mes ticket(s)`}</div>
        </div>
        <StardustButton onClick={()=>setShowForm(!showForm)} style={{ padding:"9px 16px", fontSize:12, display:"flex", alignItems:"center", gap:6 }}>
          <Icon name="plus" size={14} color="#fff" /> Nouveau ticket
        </StardustButton>
      </div>

      {showForm && (
        <CursorCard style={{ padding:20, marginBottom:20, animation:"fadeIn .3s ease" }}>
          <div style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.85)", marginBottom:16, fontFamily:"'Rajdhani',sans-serif" }}>Créer un ticket support</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            {[["Priorité","priority","select",["low","medium","high","critical"]],["Catégorie","category","select",["general","hardware","software","network","access"]]].map(([l,k,t,opts])=>(
              <div key={k}>
                <label style={labelStyle}>{l}</label>
                <select value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} style={{ ...darkInput }}>
                  {opts.map(o=><option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={labelStyle}>Titre</label>
            <input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} style={{ ...darkInput }} placeholder="Décrivez brièvement le problème" />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={3} style={{ ...darkInput, resize:"vertical" }} placeholder="Détails du problème..." />
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <StardustButton onClick={createTicket} style={{ padding:"9px 20px", fontSize:12 }}>Créer le ticket</StardustButton>
            <button onClick={()=>setShowForm(false)} style={{ padding:"9px 20px", background:"rgba(255,255,255,0.05)", color:"rgba(255,255,255,0.5)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, fontSize:12, cursor:"pointer" }}>Annuler</button>
          </div>
        </CursorCard>
      )}

      <CursorCard style={{ overflow:"hidden" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr 1fr 1fr 1fr", padding:"12px 18px", background:"rgba(6,30,41,0.8)", gap:8 }}>
          {["N°","Titre","Priorité","Catégorie","Statut"].map(h=><div key={h} style={{ fontSize:10, fontWeight:500, color:"rgba(255,255,255,0.45)", textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</div>)}
        </div>
        {loading ? <div style={{ padding:40, textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:12 }}>Chargement...</div>
        : displayTickets.length===0 ? <div style={{ padding:40, textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:12 }}>Aucun ticket. Créez le premier !</div>
        : displayTickets.map((t,i)=>(
          <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 2fr 1fr 1fr 1fr", padding:"12px 18px", gap:8, borderBottom:"1px solid rgba(255,255,255,0.03)", animation:`fadeIn .3s ease ${i*.05}s both` }}>
            <div style={{ fontSize:10, color:T.red, fontWeight:500, display:"flex", alignItems:"center" }}>{t.ticket_number}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.8)", display:"flex", alignItems:"center", fontWeight:500 }}>{t.title}</div>
            <div style={{ display:"flex", alignItems:"center" }}>
              <span style={{ fontSize:10, padding:"3px 8px", borderRadius:20, background:t.priority==="high"||t.priority==="critical"?"rgba(204,0,0,0.12)":t.priority==="medium"?"rgba(186,117,23,0.12)":"rgba(29,158,117,0.12)", color:t.priority==="high"||t.priority==="critical"?"#ff8888":t.priority==="medium"?T.warning:T.success, fontWeight:500 }}>{t.priority}</span>
            </div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", display:"flex", alignItems:"center" }}>{t.category}</div>
            <div style={{ display:"flex", alignItems:"center" }}>
              <span style={{ fontSize:10, padding:"3px 10px", borderRadius:20, background:`${statusColor(t.status)}15`, color:statusColor(t.status), fontWeight:500, border:`1px solid ${statusColor(t.status)}30` }}>{statusLabel(t.status)}</span>
            </div>
          </div>
        ))}
      </CursorCard>
    </ModulePage>
  );
}

// ─── FINANCE MODULE ───────────────────────────────────────────────────────────
function FinanceModule({ token }) {
  const stats = [
    { label:"Budget total (k MAD)", value:500, icon:"dollar", color:T.teal },
    { label:"Dépenses (k MAD)", value:158, icon:"trending-up", color:T.red },
    { label:"Factures en attente", value:7, icon:"alert-circle", color:T.warning },
    { label:"Paiements effectués", value:43, icon:"check", color:T.success },
  ];
  const barData = [
    {l:"RH",v:45,c:T.teal},{l:"IT",v:20,c:T.red},{l:"Ops",v:25,c:T.warning},{l:"Admin",v:10,c:T.sage}
  ];
  return (
    <ModulePage>
      <div style={{ fontSize:18, fontWeight:500, color:"#fff", marginBottom:20, fontFamily:"'Rajdhani',sans-serif" }}>Finance</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:20 }}>
        {stats.map((s,i)=><StatCard key={s.label} {...s} delay={i*.1} />)}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr", gap:14 }}>
        <CursorCard style={{ padding:20 }}>
          <div style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.7)", marginBottom:16, fontFamily:"'Rajdhani',sans-serif" }}>Répartition du budget</div>
          {[["RH",45,T.teal],["IT",20,T.red],["Opérations",25,T.warning],["Administration",10,T.sage]].map(([l,v,c])=>(
            <div key={l} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
              <div style={{ width:80, fontSize:12, color:"rgba(255,255,255,0.45)" }}>{l}</div>
              <div style={{ flex:1, height:6, background:"rgba(255,255,255,0.05)", borderRadius:4, overflow:"hidden" }}>
                <div style={{ height:"100%", background:c, borderRadius:4, width:`${v}%`, transition:"width 1s ease", boxShadow:`0 0 8px ${c}50` }} />
              </div>
              <div style={{ fontSize:12, fontWeight:500, color:"rgba(255,255,255,0.7)", width:35, textAlign:"right" }}>{v}%</div>
            </div>
          ))}
        </CursorCard>
        <CursorCard style={{ padding:20 }}>
          <div style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.7)", marginBottom:16, fontFamily:"'Rajdhani',sans-serif" }}>Vue graphique</div>
          <AnimatedBarChart data={barData} height={130} />
        </CursorCard>
      </div>
    </ModulePage>
  );
}

// ─── OPS MODULE ──────────────────────────────────────────────────────────────
function OpsModule({ token }) {
  const projects = [
    { name:"Migration Cloud", status:"En cours", progress:65, team:8 },
    { name:"Audit Sécurité", status:"Planifié", progress:20, team:3 },
    { name:"ERP Phase 2", status:"En cours", progress:40, team:12 },
    { name:"Formation DevOps", status:"Terminé", progress:100, team:5 },
  ];
  return (
    <ModulePage>
      <div style={{ fontSize:18, fontWeight:500, color:"#fff", marginBottom:20, fontFamily:"'Rajdhani',sans-serif" }}>Opérations</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        {projects.map((p,i)=>(
          <CursorCard key={i} style={{ padding:18, animation:`fadeIn .4s ease ${i*.1}s both` }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.85)", fontFamily:"'Rajdhani',sans-serif" }}>{p.name}</div>
              <span style={{ fontSize:10, padding:"3px 10px", borderRadius:20, fontWeight:500,
                background:p.status==="Terminé"?"rgba(29,158,117,0.12)":p.status==="En cours"?"rgba(30,95,116,0.15)":"rgba(186,117,23,0.12)",
                color:p.status==="Terminé"?T.success:p.status==="En cours"?T.teal:T.warning,
                border:`1px solid ${p.status==="Terminé"?"rgba(29,158,117,0.3)":p.status==="En cours"?"rgba(30,95,116,0.3)":"rgba(186,117,23,0.3)"}` }}>{p.status}</span>
            </div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginBottom:12 }}>{p.team} membres</div>
            <div style={{ height:5, background:"rgba(255,255,255,0.05)", borderRadius:3, overflow:"hidden", marginBottom:6 }}>
              <div style={{ height:"100%", background:p.progress===100?T.success:T.teal, borderRadius:3, width:`${p.progress}%`, transition:"width 1s ease", boxShadow:`0 0 8px ${p.progress===100?T.success:T.teal}50` }} />
            </div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", textAlign:"right" }}>{p.progress}%</div>
          </CursorCard>
        ))}
      </div>
    </ModulePage>
  );
}

// ─── STABLE INPUT ─────────────────────────────────────────────────────────────
const StableInput = ({ label, name, type="text", value, onChange, options, error, onBlur, placeholder }) => (
  <div>
    <label style={{ display:"block", fontSize:10, fontWeight:600, color:"rgba(255,255,255,0.4)", marginBottom:5, textTransform:"uppercase", letterSpacing:"0.06em" }}>
      {label}
    </label>
    {options ? (
      <select value={value} onChange={onChange} style={{ ...darkInput }}>
        {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    ) : (
      <input type={type} value={value} onChange={onChange} onBlur={onBlur} placeholder={placeholder}
        style={{ ...darkInput, borderColor: error ? "rgba(204,0,0,0.6)" : "rgba(255,255,255,0.1)" }} />
    )}
  </div>
);

// ─── USERS MODULE ─────────────────────────────────────────────────────────────
function UsersModule({ token }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [showPwForm, setShowPwForm] = useState(null);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ username:"", email:"", role:"employee", department:"", job_title:"" });
  const [createdUser, setCreatedUser] = useState(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const r = await fetch("http://localhost/api/auth/users", { headers:{ Authorization:`Bearer ${token}` } });
      const d = await r.json();
      setUsers(d.data || []);
    } catch {}
    setLoading(false);
  };

  useEffect(()=>{ fetchUsers(); },[]);

  const showMsg = (m) => { setMsg(m); setTimeout(()=>setMsg(""),4000); };

  const createUser = async () => {
    if (!form.username || !form.email || !form.department) { showMsg("❌ Nom d'utilisateur, email et département sont requis"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { showMsg("❌ Format d'email invalide"); return; }
    try {
      const r = await fetch("http://localhost/api/auth/admin/create", {
        method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) { showMsg("❌ " + (d.message || "Erreur")); return; }
      setCreatedUser({ username:d.data.username, email:d.data.email, tempPassword:d.tempPassword, role:d.data.role, department:d.data.department, emailSent:d.emailSent, emailMessage:d.emailMessage });
      setShowForm(false);
      setForm({ username:"", email:"", role:"employee", department:"", job_title:"" });
      fetchUsers();
    } catch { showMsg("❌ Erreur réseau"); }
  };

  const toggleUser = async (id, isActive) => {
    try {
      const r = await fetch(`http://localhost/api/auth/${id}/${isActive?"deactivate":"activate"}`, {
        method:"POST", headers:{ Authorization:`Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) { showMsg("❌ " + (d.message || "Erreur")); return; }
      showMsg(isActive ? "✅ Compte désactivé" : "✅ Compte activé");
      fetchUsers();
    } catch {}
  };

  const resetPassword = async (id) => {
    try {
      const r = await fetch(`http://localhost/api/auth/${id}/reset-password`, {
        method:"POST", headers:{ Authorization:`Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) { showMsg("❌ " + (d.message || "Erreur")); return; }
      showMsg(`✅ Nouveau MDP temporaire : ${d.tempPassword}`);
      setShowPwForm(null);
    } catch {}
  };

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.username?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.department?.toLowerCase().includes(q);
    const matchRole = filterRole === "all" || u.role === filterRole;
    return matchSearch && matchRole;
  });

  return (
    <ModulePage>
      {createdUser && (
        <CursorCard style={{ padding:20, marginBottom:20, animation:"fadeIn .4s ease", borderColor:createdUser.emailSent?"rgba(29,158,117,0.4)":"rgba(186,117,23,0.4)" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:createdUser.emailSent?"rgba(29,158,117,0.15)":"rgba(186,117,23,0.15)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <span style={{ fontSize:18 }}>{createdUser.emailSent?"✅":"⚠️"}</span>
              </div>
              <div>
                <div style={{ fontSize:14, fontWeight:600, color:"rgba(255,255,255,0.9)" }}>Compte créé avec succès !</div>
                <div style={{ fontSize:11, color:createdUser.emailSent?T.success:T.warning }}>{createdUser.emailMessage}</div>
              </div>
            </div>
            <button onClick={()=>setCreatedUser(null)} style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer", color:"rgba(255,255,255,0.4)" }}>Fermer</button>
          </div>
          <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:16, borderLeft:`3px solid ${T.red}` }}>
            <div style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:12 }}>
              {createdUser.emailSent ? "Identifiants envoyés par email" : "⚠️ Communiquez ces identifiants manuellement"}
            </div>
            {[["Email",createdUser.email],["Nom d'utilisateur",createdUser.username],["Mot de passe temporaire",createdUser.tempPassword||"(envoyé par email)"],["Rôle",createdUser.role],["Département",createdUser.department||"—"]].map(([l,v])=>(
              <div key={l} style={{ display:"flex", alignItems:"center", marginBottom:8, gap:12 }}>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", width:180, flexShrink:0 }}>{l}</div>
                <div style={{ fontSize:12, fontWeight:600, color:"rgba(255,255,255,0.85)", fontFamily:"monospace", background:"rgba(255,255,255,0.05)", padding:"4px 10px", borderRadius:6, border:"1px solid rgba(255,255,255,0.08)", flex:1 }}>{v}</div>
              </div>
            ))}
            <div style={{ marginTop:10, padding:10, background:"rgba(186,117,23,0.1)", borderRadius:8, fontSize:11, color:T.warning, border:"1px solid rgba(186,117,23,0.2)" }}>
              🔒 L'employé devra changer ce mot de passe à la première connexion.
            </div>
          </div>
        </CursorCard>
      )}

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:500, color:"#fff", fontFamily:"'Rajdhani',sans-serif" }}>Gestion des comptes</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginTop:2 }}>{users.length} compte(s) système</div>
        </div>
        <StardustButton onClick={()=>setShowForm(!showForm)} style={{ padding:"9px 16px", fontSize:12, display:"flex", alignItems:"center", gap:6 }}>
          <Icon name="plus" size={14} color="#fff"/> Nouveau compte
        </StardustButton>
      </div>

      {msg && <div style={{ background:msg.startsWith("✅")?"rgba(29,158,117,0.12)":"rgba(204,0,0,0.12)", border:`0.5px solid ${msg.startsWith("✅")?"rgba(29,158,117,0.3)":"rgba(204,0,0,0.3)"}`, borderRadius:8, padding:"10px 14px", fontSize:12, color:msg.startsWith("✅")?T.success:"#ff8888", marginBottom:16, animation:"fadeIn .3s ease", wordBreak:"break-all" }}>{msg}</div>}

      {showForm && (
        <CursorCard style={{ padding:20, marginBottom:20, animation:"fadeIn .3s ease" }}>
          <div style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.85)", marginBottom:4, fontFamily:"'Rajdhani',sans-serif" }}>Créer un compte utilisateur</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginBottom:16 }}>Le mot de passe temporaire sera généré automatiquement et envoyé par email.</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
            <StableInput label="Nom d'utilisateur *" name="username" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} />
            <StableInput label="Email professionnel *" name="email" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="nom@domaine.com" />
            <StableInput label="Département *" name="department" value={form.department} onChange={e=>setForm({...form,department:e.target.value})} />
            <StableInput label="Titre du poste" name="job_title" value={form.job_title} onChange={e=>setForm({...form,job_title:e.target.value})} placeholder="Ex: Manager RH..." />
            <StableInput label="Rôle" name="role" value={form.role} onChange={e=>setForm({...form,role:e.target.value})}
              options={[{value:"employee",label:"Employé"},{value:"hr",label:"RH"},{value:"finance",label:"Finance"},{value:"it",label:"IT"},{value:"operations",label:"Opérations"},{value:"admin",label:"Admin"}]} />
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <StardustButton onClick={createUser} style={{ padding:"9px 20px", fontSize:12 }}>Créer le compte</StardustButton>
            <button onClick={()=>setShowForm(false)} style={{ padding:"9px 20px", background:"rgba(255,255,255,0.05)", color:"rgba(255,255,255,0.5)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, fontSize:12, cursor:"pointer" }}>Annuler</button>
          </div>
        </CursorCard>
      )}

      <div style={{ display:"flex", gap:10, marginBottom:16 }}>
        <div style={{ flex:1, display:"flex", alignItems:"center", gap:8, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, padding:"8px 12px" }}>
          <Icon name="search" size={14} color="rgba(255,255,255,0.3)"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un utilisateur..."
            style={{ border:"none", outline:"none", fontSize:12, flex:1, background:"transparent", color:"#fff" }}/>
        </div>
        <select value={filterRole} onChange={e=>setFilterRole(e.target.value)}
          style={{ padding:"8px 12px", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, fontSize:12, outline:"none", background:"rgba(255,255,255,0.04)", color:"rgba(255,255,255,0.7)" }}>
          <option value="all">Tous les rôles</option>
          <option value="admin">Admin</option>
          <option value="employee">Employé</option>
          <option value="hr">RH</option>
          <option value="finance">Finance</option>
          <option value="it">IT</option>
          <option value="operations">Opérations</option>
        </select>
      </div>

      <CursorCard style={{ overflow:"hidden" }}>
        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr", padding:"12px 18px", background:"rgba(6,30,41,0.8)", gap:8 }}>
          {["Utilisateur","Département","Rôle","Statut","Actions"].map(h=>(
            <div key={h} style={{ fontSize:10, fontWeight:500, color:"rgba(255,255,255,0.45)", textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</div>
          ))}
        </div>
        {loading ? <div style={{ padding:40, textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:12 }}>Chargement...</div>
        : filtered.length===0 ? <div style={{ padding:40, textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:12 }}>Aucun utilisateur trouvé.</div>
        : filtered.map((u,i)=>(
          <div key={i}>
            <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr", padding:"12px 18px", gap:8, borderBottom:"1px solid rgba(255,255,255,0.03)", alignItems:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:32, height:32, borderRadius:"50%", background:u.is_active?"rgba(204,0,0,0.12)":"rgba(255,255,255,0.04)", border:`1px solid ${u.is_active?"rgba(204,0,0,0.3)":"rgba(255,255,255,0.08)"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:600, color:u.is_active?T.red:"rgba(255,255,255,0.3)", flexShrink:0 }}>
                  {u.username?.[0]?.toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize:12, fontWeight:500, color:"rgba(255,255,255,0.85)" }}>{u.username}</div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>{u.email}</div>
                </div>
              </div>
              <div>
                <div style={{ fontSize:12, fontWeight:500, color:"rgba(255,255,255,0.7)" }}>{u.job_title||"—"}</div>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)" }}>{u.department}</div>
              </div>
              <div>
                <span style={{ fontSize:10, padding:"3px 8px", borderRadius:20, background:"rgba(30,95,116,0.15)", color:T.teal, fontWeight:500, border:"1px solid rgba(30,95,116,0.3)" }}>{u.role}</span>
              </div>
              <div>
                <span style={{ fontSize:10, padding:"3px 10px", borderRadius:20, background:u.is_active?"rgba(29,158,117,0.12)":"rgba(255,255,255,0.04)", color:u.is_active?T.success:"rgba(255,255,255,0.3)", fontWeight:500, border:`1px solid ${u.is_active?"rgba(29,158,117,0.3)":"rgba(255,255,255,0.08)"}` }}>
                  {u.is_active?"Actif":"Inactif"}
                </span>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={()=>toggleUser(u.user_id,u.is_active)} disabled={u.role==="admin"} title={u.role==="admin"?"Impossible de désactiver un administrateur":""}
                  style={{ padding:"5px 10px", background:u.role==="admin"?"rgba(255,255,255,0.02)":u.is_active?"rgba(204,0,0,0.12)":"rgba(29,158,117,0.12)", color:u.role==="admin"?"rgba(255,255,255,0.2)":u.is_active?"#ff8888":T.success, border:`1px solid ${u.role==="admin"?"rgba(255,255,255,0.05)":u.is_active?"rgba(204,0,0,0.3)":"rgba(29,158,117,0.3)"}`, borderRadius:6, fontSize:10, cursor:u.role==="admin"?"not-allowed":"pointer", fontWeight:500, opacity:u.role==="admin"?0.4:1 }}>
                  {u.is_active?"Désactiver":"Activer"}
                </button>
                <button onClick={()=>setShowPwForm(showPwForm===u.user_id?null:u.user_id)}
                  style={{ padding:"5px 10px", background:"rgba(255,255,255,0.04)", color:"rgba(255,255,255,0.4)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:6, fontSize:10, cursor:"pointer" }}>
                  Réinit. MDP
                </button>
              </div>
            </div>
            {showPwForm===u.user_id && (
              <div style={{ padding:"12px 18px", background:"rgba(186,117,23,0.08)", borderBottom:"1px solid rgba(255,255,255,0.03)", display:"flex", alignItems:"center", gap:12, borderLeft:"3px solid rgba(186,117,23,0.5)" }}>
                <div style={{ fontSize:12, color:T.warning, flex:1 }}>⚠️ Un nouveau mot de passe temporaire sera généré. L'employé devra le changer à sa prochaine connexion.</div>
                <StardustButton onClick={()=>resetPassword(u.user_id)} style={{ padding:"8px 16px", fontSize:12, flexShrink:0 }}>Générer nouveau MDP</StardustButton>
                <button onClick={()=>setShowPwForm(null)} style={{ padding:"8px 14px", background:"rgba(255,255,255,0.05)", color:"rgba(255,255,255,0.4)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, fontSize:12, cursor:"pointer", flexShrink:0 }}>Annuler</button>
              </div>
            )}
          </div>
        ))}
      </CursorCard>
    </ModulePage>
  );
}

// ─── EMPLOYEE HOME ────────────────────────────────────────────────────────────
function EmployeeHome({ user }) {
  return (
    <ModulePage>
      <CursorCard style={{ padding:"20px 24px", marginBottom:20, display:"flex", alignItems:"center", justifyContent:"space-between", animation:"fadeIn .4s ease" }}>
        <div>
          <div style={{ fontSize:20, fontWeight:500, color:"#fff", fontFamily:"'Rajdhani',sans-serif" }}>Bonjour, {user?.username} 👋</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", marginTop:4 }}>{user?.department} · {new Date().toLocaleDateString("fr-FR",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
        </div>
        <div style={{ background:"rgba(29,158,117,0.1)", borderRadius:10, padding:"8px 16px", fontSize:11, color:T.success, border:"1px solid rgba(29,158,117,0.3)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}><div style={{ width:6, height:6, borderRadius:"50%", background:T.success, animation:"blink 2s infinite" }} />En ligne</div>
        </div>
      </CursorCard>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        {[["Mes tickets","2 ouverts","help-circle",T.red],["Congés","8j restants","calendar",T.teal],["Mon équipe","12 membres","users",T.sage],["Documents","5 fichiers","box",T.warning]].map(([t,s,ic,c])=>(
          <CursorCard key={t} style={{ padding:16, cursor:"pointer", textAlign:"center", transition:"transform .2s" }}
            onMouseEnter={e=>e.currentTarget.style.transform="translateY(-3px)"}
            onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
            <div style={{ width:40, height:40, borderRadius:12, background:`${c}15`, border:`1px solid ${c}25`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 10px" }}><Icon name={ic} size={18} color={c} /></div>
            <div style={{ fontSize:12, fontWeight:500, color:"rgba(255,255,255,0.85)" }}>{t}</div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", marginTop:3 }}>{s}</div>
          </CursorCard>
        ))}
      </div>
    </ModulePage>
  );
}

// ─── LEAVE MODULE ─────────────────────────────────────────────────────────────
function LeaveModule({ token, user }) {
  const [leaves, setLeaves] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ employee_id:"", leave_type:"annual", start_date:"", end_date:"", reason:"" });

  useEffect(()=>{
    if (user?.id) {
      setForm(f=>({...f, employee_id: user.id}));
      fetch(`http://localhost/api/hr/leave/my-requests`, { headers:{ Authorization:`Bearer ${token}` } })
        .then(r=>r.json()).then(d=>setLeaves(d.data||[])).catch(()=>{});
    }
  },[user]);

  const submitLeave = async () => {
    if (!form.start_date || !form.end_date) return;
    await fetch("http://localhost/api/hr/leave/", {
      method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
      body: JSON.stringify(form)
    });
    setShowForm(false);
    if (user?.id) {
      fetch(`http://localhost/api/hr/leave/my-requests`, { headers:{ Authorization:`Bearer ${token}` } })
        .then(r=>r.json()).then(d=>setLeaves(d.data||[])).catch(()=>{});
    }
  };

  const statusColor = s => s==="approved"?T.success:s==="pending"?T.warning:T.danger;
  const statusLabel = s => s==="approved"?"Approuvé":s==="pending"?"En attente":"Rejeté";
  const labelStyle = { display:"block", fontSize:10, fontWeight:600, color:"rgba(255,255,255,0.4)", marginBottom:5, textTransform:"uppercase", letterSpacing:"0.06em" };

  return (
    <ModulePage>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:500, color:"#fff", fontFamily:"'Rajdhani',sans-serif" }}>Mes demandes de congé</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginTop:2 }}>{leaves.length} demande(s)</div>
        </div>
        <StardustButton onClick={()=>setShowForm(!showForm)} style={{ padding:"9px 16px", fontSize:12, display:"flex", alignItems:"center", gap:6 }}>
          <Icon name="plus" size={14} color="#fff" /> Nouvelle demande
        </StardustButton>
      </div>

      {showForm && (
        <CursorCard style={{ padding:20, marginBottom:20, animation:"fadeIn .3s ease" }}>
          <div style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.85)", marginBottom:16, fontFamily:"'Rajdhani',sans-serif" }}>Demande de congé</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div>
              <label style={labelStyle}>Type de congé</label>
              <select value={form.leave_type} onChange={e=>setForm({...form,leave_type:e.target.value})} style={{ ...darkInput }}>
                {["annual","sick","personal","maternity","paternity"].map(o=><option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            {[["Date début","start_date","date"],["Date fin","end_date","date"]].map(([l,k,t])=>(
              <div key={k}>
                <label style={labelStyle}>{l}</label>
                <input type={t} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} style={{ ...darkInput }} />
              </div>
            ))}
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={labelStyle}>Motif</label>
            <textarea value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} rows={2} style={{ ...darkInput, resize:"vertical" }} placeholder="Motif de la demande..." />
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <StardustButton onClick={submitLeave} style={{ padding:"9px 20px", fontSize:12 }}>Soumettre</StardustButton>
            <button onClick={()=>setShowForm(false)} style={{ padding:"9px 20px", background:"rgba(255,255,255,0.05)", color:"rgba(255,255,255,0.5)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, fontSize:12, cursor:"pointer" }}>Annuler</button>
          </div>
        </CursorCard>
      )}

      <CursorCard style={{ overflow:"hidden" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr", padding:"12px 18px", background:"rgba(6,30,41,0.8)", gap:8 }}>
          {["Type","Début","Fin","Jours","Statut"].map(h=><div key={h} style={{ fontSize:10, fontWeight:500, color:"rgba(255,255,255,0.45)", textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</div>)}
        </div>
        {leaves.length===0 ? <div style={{ padding:40, textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:12 }}>Aucune demande. Créez votre première demande !</div>
        : leaves.map((l,i)=>(
          <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr", padding:"12px 18px", gap:8, borderBottom:"1px solid rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.8)", fontWeight:500, display:"flex", alignItems:"center" }}>{l.leave_type}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", display:"flex", alignItems:"center" }}>{l.start_date?.slice(0,10)}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", display:"flex", alignItems:"center" }}>{l.end_date?.slice(0,10)}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", display:"flex", alignItems:"center" }}>{l.total_days}j</div>
            <div style={{ display:"flex", alignItems:"center" }}>
              <span style={{ fontSize:10, padding:"3px 10px", borderRadius:20, background:`${statusColor(l.status)}15`, color:statusColor(l.status), fontWeight:500, border:`1px solid ${statusColor(l.status)}30` }}>{statusLabel(l.status)}</span>
            </div>
          </div>
        ))}
      </CursorCard>
    </ModulePage>
  );
}

// ─── PROFILE MODULE ───────────────────────────────────────────────────────────
function ProfileModule({ user }) {
  return (
    <ModulePage>
      <div style={{ fontSize:18, fontWeight:500, color:"#fff", marginBottom:20, fontFamily:"'Rajdhani',sans-serif" }}>Mon profil</div>
      <CursorCard style={{ padding:28, maxWidth:500 }}>
        <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:24, paddingBottom:24, borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ width:60, height:60, borderRadius:"50%", background:"rgba(204,0,0,0.15)", border:"2px solid rgba(204,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, fontWeight:600, color:T.red }}>
            {user?.username?.[0]?.toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize:16, fontWeight:500, color:"rgba(255,255,255,0.9)" }}>{user?.username}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", marginTop:3 }}>{user?.email}</div>
            <div style={{ marginTop:6 }}><span style={{ fontSize:10, padding:"3px 10px", borderRadius:20, background:"rgba(29,158,117,0.12)", color:T.success, fontWeight:500, border:"1px solid rgba(29,158,117,0.3)" }}>Actif</span></div>
          </div>
        </div>
        {[["Rôle",user?.role],["Département",user?.department],["ID",user?.id]].map(([l,v])=>(
          <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"12px 0", borderBottom:"1px solid rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }}>{l}</div>
            <div style={{ fontSize:12, fontWeight:500, color:"rgba(255,255,255,0.8)" }}>{v||"—"}</div>
          </div>
        ))}
      </CursorCard>
    </ModulePage>
  );
}

// ─── CHANGE PASSWORD SCREEN ───────────────────────────────────────────────────
function ChangePasswordScreen({ user, token, onSuccess }) {
  const [current, setCurrent] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const checks = [
    { label:"8+ chars", ok: newPw.length >= 8 },
    { label:"A-Z", ok: /[A-Z]/.test(newPw) },
    { label:"a-z", ok: /[a-z]/.test(newPw) },
    { label:"0-9", ok: /[0-9]/.test(newPw) },
    { label:"!@#", ok: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPw) },
  ];
  const score = checks.filter(c => c.ok).length;
  const colors = ["","#CC0000","#CC0000","#BA7517","#1D9E75","#1D9E75"];
  const labels = ["","Très faible","Faible","Moyen","Fort","Très fort"];

  const handleChange = async () => {
    if (!current || !newPw || !confirm) { setError("Tous les champs sont requis"); return; }
    if (newPw !== confirm) { setError("Les mots de passe ne correspondent pas"); return; }
    if (score < 4) { setError("Mot de passe trop faible"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("http://localhost/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: current, new_password: newPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      onSuccess();
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <AuroraBackground style={{ height:"100vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ width:480, position:"relative", zIndex:1, animation:"slideIn .4s ease" }}>
        <CursorCard style={{ padding:"40px 44px" }}>
          <div style={{ textAlign:"center", marginBottom:28 }}>
            <div style={{ width:56, height:56, borderRadius:"50%", background:"rgba(204,0,0,0.1)", border:`2px solid rgba(204,0,0,0.4)`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px", animation:"glowPulse 3s ease-in-out infinite" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={T.red} strokeWidth="1.8">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:20, fontWeight:700, color:"rgba(255,255,255,0.9)" }}>Changement de mot de passe requis</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", marginTop:6, lineHeight:1.6 }}>
              Bienvenue <strong style={{ color:"rgba(255,255,255,0.7)" }}>{user?.username}</strong> ! Pour votre sécurité,<br/>vous devez changer votre mot de passe temporaire.
            </div>
          </div>

          <div style={{ background:"rgba(186,117,23,0.1)", border:"1px solid rgba(186,117,23,0.3)", borderRadius:8, padding:"10px 14px", fontSize:11, color:T.warning, marginBottom:20 }}>
            ⚠️ Ce mot de passe temporaire doit être changé avant de continuer.
          </div>

          {[["Mot de passe temporaire (actuel)", current, setCurrent],["Nouveau mot de passe", newPw, setNewPw],["Confirmer le nouveau mot de passe", confirm, setConfirm]].map(([label, val, setter]) => (
            <div key={label} style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontSize:10, fontWeight:600, color:"rgba(255,255,255,0.4)", marginBottom:5, textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</label>
              <input type="password" value={val} onChange={e => setter(e.target.value)}
                style={{ ...darkInput, borderColor: label.includes("Confirmer") && confirm && newPw !== confirm ? "rgba(204,0,0,0.6)" : "rgba(255,255,255,0.1)" }} />
            </div>
          ))}

          {newPw && (
            <div style={{ marginBottom:16 }}>
              <div style={{ display:"flex", gap:4, marginBottom:6 }}>
                {[1,2,3,4,5].map(i => <div key={i} style={{ flex:1, height:3, borderRadius:2, background: i<=score ? colors[score] : "rgba(255,255,255,0.08)", transition:"background .3s" }} />)}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:10, color:colors[score], fontWeight:500 }}>{labels[score]}</span>
                <div style={{ display:"flex", gap:8 }}>
                  {checks.map(c => <span key={c.label} style={{ fontSize:9, color: c.ok ? T.success : "rgba(255,255,255,0.2)" }}>{c.ok?"✓":"○"} {c.label}</span>)}
                </div>
              </div>
            </div>
          )}

          {error && <div style={{ background:"rgba(204,0,0,0.1)", border:"0.5px solid rgba(204,0,0,0.35)", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#ff8888", marginBottom:14 }}>{error}</div>}

          <StardustButton onClick={handleChange} disabled={loading || !(score>=4 && newPw===confirm && newPw)} style={{ width:"100%", padding:"13px" }}>
            {loading ? "Changement en cours..." : "Confirmer le nouveau mot de passe"}
          </StardustButton>
        </CursorCard>
      </div>
    </AuroraBackground>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [active, setActive] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mustChangePw, setMustChangePw] = useState(false);

  useEffect(()=>{
    const u = localStorage.getItem("user");
    const t = localStorage.getItem("token");
    const mcp = localStorage.getItem("mustChangePw");
    if (u && t) { setUser(JSON.parse(u)); setToken(t); setMustChangePw(mcp === "true"); }
  },[]);

  useEffect(()=>{
    if (user) {
      if (user.role === "admin" || user.role === "manager") setActive("dashboard");
      else setActive("home");
    }
  },[user]);

  const handleLogin = (u, t, mustChange) => { setUser(u); setToken(t); setMustChangePw(!!mustChange); };

  const handleLogout = () => {
    setUser(null); setToken(null); setMustChangePw(false);
    localStorage.clear();
  };

  const handlePasswordChanged = () => {
    setMustChangePw(false);
    localStorage.setItem("mustChangePw", "false");
  };

  const titles = { dashboard:"Vue d'ensemble", hr:"Ressources Humaines", it:"Helpdesk IT", finance:"Finance", operations:"Opérations", users:"Utilisateurs", home:"Accueil", tickets:"Mes tickets", leave:"Congés", profile:"Mon profil" };
  const isAdmin   = user?.role === "admin";
  const isManager = user?.role === "manager";
  const userDept  = user?.department;

  // Vérifie si l'utilisateur a accès à un module donné
  const canAccess = (module) => {
    if (isAdmin) return true;
    if (isManager) {
      const deptModule = DEPT_MODULE[userDept]; // ex: "it", "hr", "finance", "operations"
      return deptModule === module || module === "dashboard";
    }
    return false;
  };

  const renderContent = () => {
    switch(active) {
      case "dashboard":   return canAccess("dashboard") ? <AdminDashboard user={user} /> : <EmployeeHome user={user} />;
      case "hr":         return canAccess("hr")        ? <HRModule token={token} />       : <EmployeeHome user={user} />;
      case "it":
      case "tickets":    return <ITModule token={token} user={user} />;
      case "finance":    return canAccess("finance")   ? <FinanceModule token={token} />  : <EmployeeHome user={user} />;
      case "operations": return canAccess("operations")? <OpsModule token={token} />      : <EmployeeHome user={user} />;
      case "users":      return isAdmin                ? <UsersModule token={token} />    : <EmployeeHome user={user} />;
      case "home":       return <EmployeeHome user={user} />;
      case "leave":      return <LeaveModule token={token} user={user} />;
      case "profile":    return <ProfileModule user={user} />;
      default:           return canAccess("dashboard") ? <AdminDashboard user={user} /> : <EmployeeHome user={user} />;
    }
  };

  if (!user) return (<><GlobalStyle /><LoginPage onLogin={handleLogin} /></>);

  if (mustChangePw) return (
    <>
      <GlobalStyle />
      <ChangePasswordScreen user={user} token={token} onSuccess={handlePasswordChanged} />
    </>
  );

  return (
    <>
      <GlobalStyle />
      <div style={{ display:"flex", height:"100vh", overflow:"visible", background:"#0A0A0A" }}>
        <Sidebar user={user} active={active} setActive={setActive} onLogout={handleLogout} collapsed={collapsed} setCollapsed={setCollapsed} />
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"visible" }}>
          <Topbar title={titles[active]||""} user={user} />
          <div style={{ flex:1, overflow:"auto" }}>{renderContent()}</div>
        </div>
      </div>
      <ChatWidget />
    </>
  );
}
