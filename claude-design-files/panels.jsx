// panels.jsx — the four bold panel directions + light variants.
// Depends on data.jsx (window.TD) and charts.jsx primitives.

const TH = {
  dark: {
    ui: "'IBM Plex Sans', system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
    display: "'Space Grotesk', system-ui, sans-serif",
    accent: '#27b06e', accentSoft: '#5fcf9c',
    text: 'rgba(255,255,255,0.94)', dim: 'rgba(255,255,255,0.52)', faint: 'rgba(255,255,255,0.32)',
    gridLine: 'rgba(255,255,255,0.06)', card: '#1f2226',
    segBg: 'rgba(255,255,255,0.06)', segBorder: 'rgba(255,255,255,0.09)',
    segOnBg: 'rgba(255,255,255,0.15)', segOnText: '#fff', segOffText: 'rgba(255,255,255,0.55)',
    segOnShadow: '0 1px 2px rgba(0,0,0,0.35)',
    tip: '#34383d',
  },
  light: {
    ui: "'IBM Plex Sans', system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
    display: "'Space Grotesk', system-ui, sans-serif",
    accent: '#178a55', accentSoft: '#8fd9b4',
    text: 'rgba(17,22,19,0.94)', dim: 'rgba(17,22,19,0.5)', faint: 'rgba(17,22,19,0.32)',
    gridLine: 'rgba(0,0,0,0.06)', card: '#ffffff',
    segBg: 'rgba(0,0,0,0.05)', segBorder: 'rgba(0,0,0,0.07)',
    segOnBg: '#ffffff', segOnText: '#111', segOffText: 'rgba(0,0,0,0.5)',
    segOnShadow: '0 1px 2px rgba(0,0,0,0.12)',
    tip: '#1d2420',
  },
};

// desktop wallpaper backdrops so frosted glass reads
const WALL = {
  dark: 'radial-gradient(120% 80% at 80% 0%, #1c3a30 0%, #15191c 45%, #0e1012 100%)',
  light: 'radial-gradient(120% 80% at 80% 0%, #d6e9df 0%, #eef1ee 45%, #e4e7e4 100%)',
};

// ── Desk: wallpaper + menu bar + the dropped panel ─────────────
function Desk({ dark, theme, wall, children, caretLeft, caretColor }) {
  return (
    <div style={{ width: '100%', height: '100%', background: wall || WALL[dark ? 'dark' : 'light'], position: 'relative', fontFamily: theme.ui }}>
      <MenuBar theme={theme} dark={dark} highlight />
      <div style={{ position: 'relative', padding: '12px 12px' }}>
        <div style={{ position: 'relative' }}>
          <PanelCaret color={caretColor} left={caretLeft} />
          {children}
        </div>
      </div>
    </div>
  );
}

// shared little pieces ------------------------------------------------
function Delta({ v, theme, big }) {
  const up = v >= 0;
  const col = up ? theme.accent : '#e0795f';
  return (
    <span style={{
      font: `600 ${big ? 11 : 10}px ${theme.mono}`, color: col,
      display: 'inline-flex', alignItems: 'center', gap: 2,
      padding: big ? '2px 7px' : '1.5px 5px', borderRadius: 5,
      background: up ? 'rgba(39,176,110,0.14)' : 'rgba(224,121,95,0.16)',
    }}>
      {up ? '▲' : '▼'}{Math.abs(Math.round(v * 100))}%
    </span>
  );
}

function ModelRow({ m, max, theme, dark, total }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0' }}>
      <span style={{ width: 7, height: 7, borderRadius: 2, background: m.color, flex: '0 0 auto' }} />
      <div style={{ minWidth: 0, flex: '0 0 118px' }}>
        <div style={{ font: `500 11.5px ${theme.ui}`, color: theme.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
      </div>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: theme.gridLine, overflow: 'hidden' }}>
        <div style={{ width: `${(m.tokens / max) * 100}%`, height: '100%', background: m.color, borderRadius: 3 }} />
      </div>
      <span style={{ font: `500 10.5px ${theme.mono}`, color: theme.dim, flex: '0 0 auto', width: 42, textAlign: 'right' }}>{TD.fmtTokens(m.tokens)}</span>
      <span style={{ font: `600 10.5px ${theme.mono}`, color: theme.text, flex: '0 0 auto', width: 30, textAlign: 'right' }}>{TD.pct(m.tokens, total || TD.METRICS.totalTokens)}%</span>
    </div>
  );
}

function MiniStat({ label, value, sub, theme, accent, children }) {
  return (
    <div style={{ background: theme.gridLine, borderRadius: 9, padding: '9px 10px', minWidth: 0 }}>
      <div style={{ font: `500 9.5px ${theme.ui}`, color: theme.dim, letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 3, gap: 6 }}>
        <span style={{ font: `600 17px ${theme.mono}`, color: accent || theme.text, lineHeight: 1 }}>{value}</span>
        {children}
      </div>
      {sub && <div style={{ font: `500 9px ${theme.mono}`, color: theme.faint, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// =====================================================================
// A · NATIVE PRO — frosted dark, native macOS rhythm
// =====================================================================
function PanelA({ dark = true }) {
  const t = TH[dark ? 'dark' : 'light'];
  const [period, setPeriod] = React.useState('Week');
  const P = TD.PERIODS[period];
  const M = P.metrics;
  const models = TD.modelsFor(period);
  const maxM = Math.max(...models.map(m => m.tokens));
  const mcpList = TD.callsFor(TD.MCP_SERVERS, M.mcpCalls);
  const skillList = TD.callsFor(TD.SKILLS, M.skillCalls);
  const trendSub = { 'Day': 'today 24h', 'Week': 'last 7 days', 'Month': 'last 4 weeks' }[period];
  const cardBg = dark ? 'rgba(33,36,40,0.82)' : 'rgba(255,255,255,0.9)';
  const card = (
    <div style={{
      width: '100%', borderRadius: 15, background: cardBg,
      border: `1px solid ${dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)'}`,
      backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
      boxShadow: dark ? '0 18px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)' : '0 18px 50px rgba(40,60,50,0.18), inset 0 1px 0 rgba(255,255,255,0.7)',
      padding: 15, color: t.text,
    }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TokenGlyph color={t.accent} size={16} />
          <span style={{ font: `600 13px ${t.ui}`, color: t.text, letterSpacing: '.01em' }}>Tokenscope</span>
        </div>
        <Segmented value={period} theme={t} onSelect={setPeriod} />
      </div>
      {/* hero */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ font: `500 10px ${t.ui}`, color: t.dim, letterSpacing: '.04em', textTransform: 'uppercase' }}>Total tokens</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 3 }}>
            <span style={{ font: `600 30px ${t.mono}`, color: t.text, letterSpacing: '-.01em' }}>{M.totalTokens.toFixed(2)}<span style={{ font: `500 15px ${t.mono}`, color: t.dim, marginLeft: 2 }}>M</span></span>
            <Delta v={M.deltaTokens} theme={t} />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ font: `500 10px ${t.ui}`, color: t.dim }}>Est. cost</div>
          <div style={{ font: `600 18px ${t.mono}`, color: t.accent, marginTop: 2 }}>${M.cost.toFixed(2)}</div>
        </div>
      </div>
      {/* input/output split */}
      <div style={{ display: 'flex', gap: 3, height: 7, borderRadius: 4, overflow: 'hidden', marginBottom: 5 }}>
        <div style={{ width: `${TD.pct(M.inputTokens, M.totalTokens)}%`, background: t.accent }} />
        <div style={{ flex: 1, background: t.accentSoft }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', font: `500 10px ${t.mono}`, color: t.dim, marginBottom: 14 }}>
        <span><span style={{ color: t.accent }}>●</span> Input {M.inputTokens.toFixed(2)}M</span>
        <span><span style={{ color: t.accentSoft }}>●</span> Output {M.outputTokens.toFixed(2)}M</span>
      </div>
      {/* bar chart */}
      <BarChart data={P.series} theme={t} height={84} />
      <div style={{ height: 1, background: t.gridLine, margin: '14px 0 10px' }} />
      {/* models */}
      <div style={{ font: `600 10px ${t.ui}`, color: t.dim, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 4 }}>Tokens by model</div>
      {models.map((m, i) => <ModelRow key={i} m={m} max={maxM} theme={t} dark={dark} total={M.totalTokens} />)}
      <div style={{ height: 1, background: t.gridLine, margin: '10px 0 10px' }} />
      {/* cost by model (interactive donut) */}
      <div style={{ font: `600 10px ${t.ui}`, color: t.dim, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 8 }}>Cost by model</div>
      <CostDonut models={models} theme={t} size={100} thickness={15} />
      <div style={{ height: 1, background: t.gridLine, margin: '12px 0 12px' }} />
      {/* footer stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <MiniStat label="Requests" value={TD.fmtInt(M.requests)} sub={`${M.sessions} sessions`} theme={t}>
          <Sparkline values={P.reqTrend} theme={t} width={52} height={20} accent={t.accent} />
        </MiniStat>
        <MiniStat label="Cost trend" value={`$${M.cost.toFixed(2)}`} sub={trendSub} theme={t} accent={t.accent}>
          <Sparkline values={P.costTrend} theme={t} width={52} height={20} accent={t.accent} />
        </MiniStat>
      </div>
      {/* MCP calls — own row, per-server breakdown */}
      {mcpList.length > 0 && (
        <React.Fragment>
          <div style={{ height: 1, background: t.gridLine, margin: '12px 0 10px' }} />
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ font: `600 10px ${t.ui}`, color: t.dim, letterSpacing: '.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>MCP calls</span>
            <span style={{ font: `500 10px ${t.mono}`, color: t.faint, whiteSpace: 'nowrap' }}><span style={{ color: t.text, fontWeight: 600 }}>{TD.fmtInt(M.mcpCalls)}</span> · {M.servers} servers</span>
          </div>
          <BarList items={mcpList} theme={t} accent={t.accent} />
        </React.Fragment>
      )}
      {/* Skill calls — own row, per-skill breakdown */}
      {skillList.length > 0 && (
        <React.Fragment>
          <div style={{ height: 1, background: t.gridLine, margin: '12px 0 10px' }} />
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ font: `600 10px ${t.ui}`, color: t.dim, letterSpacing: '.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Skill calls</span>
            <span style={{ font: `500 10px ${t.mono}`, color: t.faint, whiteSpace: 'nowrap' }}><span style={{ color: t.text, fontWeight: 600 }}>{TD.fmtInt(M.skillCalls)}</span> · {M.skills} skills</span>
          </div>
          <BarList items={skillList} theme={t} accent={t.accentSoft} />
        </React.Fragment>
      )}
      {/* year-long daily token heatmap */}
      <div style={{ height: 1, background: t.gridLine, margin: '12px 0 10px' }} />
      <div style={{ marginBottom: 9 }}>
        <span style={{ font: `600 10px ${t.ui}`, color: t.dim, letterSpacing: '.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Daily activity</span>
      </div>
      <Heatmap days={TD.YEAR_DAILY} theme={t} accent={t.accent} />
    </div>
  );
  return <Desk dark={dark} theme={t} caretLeft={232} caretColor={cardBg}>{card}</Desk>;
}

// =====================================================================
// B · TERMINAL — monospace phosphor data readout
// =====================================================================
function MonoBar({ frac, width = 10, color, dim }) {
  const filled = Math.round(frac * width);
  return (
    <span style={{ letterSpacing: '-1px' }}>
      <span style={{ color }}>{'█'.repeat(filled)}</span>
      <span style={{ color: dim }}>{'░'.repeat(width - filled)}</span>
    </span>
  );
}
function PanelB() {
  const t = { ...TH.dark, accent: '#39e08a', accentSoft: '#1a7a4d', mono: "'IBM Plex Mono', ui-monospace, monospace" };
  const green = '#39e08a', dimg = 'rgba(120,170,140,0.7)', faintg = 'rgba(90,130,105,0.45)';
  const M = TD.METRICS, models = TD.MODELS;
  const maxM = Math.max(...models.map(m => m.tokens));
  const bg = '#070b08';
  const L = (txt, c) => <div style={{ color: c || faintg, font: `400 10px ${t.mono}`, letterSpacing: '0', whiteSpace: 'pre' }}>{txt}</div>;
  const card = (
    <div style={{
      width: '100%', borderRadius: 8, background: bg,
      border: `1px solid #18301f`, boxShadow: '0 18px 50px rgba(0,0,0,0.6), inset 0 0 60px rgba(40,200,120,0.03)',
      padding: '13px 14px', color: green, fontFamily: t.mono,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ font: `600 11px ${t.mono}`, color: green, letterSpacing: '.06em' }}>● TOKENSCOPE</span>
        <span style={{ font: `400 10px ${t.mono}`, color: dimg }}>--period=week</span>
      </div>
      {L('────────────────────────────────────────────')}
      {/* total */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '8px 0 4px' }}>
        <span style={{ font: `400 10px ${t.mono}`, color: dimg, letterSpacing: '.05em', whiteSpace: 'nowrap' }}>TOTAL TOKENS</span>
        <span style={{ font: `400 10px ${t.mono}`, color: green }}>▲ {Math.round(M.deltaTokens * 100)}%</span>
      </div>
      <div style={{ font: `700 34px ${t.mono}`, color: green, letterSpacing: '-.01em', lineHeight: 1, textShadow: `0 0 16px rgba(57,224,138,0.4)` }}>
        {M.totalTokens.toFixed(2)}<span style={{ fontSize: 16, color: dimg }}> M</span>
      </div>
      <div style={{ font: `400 10px ${t.mono}`, color: dimg, marginTop: 7, display: 'flex', justifyContent: 'space-between' }}>
        <span>in  {M.inputTokens.toFixed(2)}M  <MonoBar frac={M.inputTokens / M.totalTokens} width={8} color={green} dim={'#16331f'} /></span>
        <span>out {M.outputTokens.toFixed(2)}M  <MonoBar frac={M.outputTokens / M.totalTokens} width={8} color={'#1f9d63'} dim={'#16331f'} /></span>
      </div>
      {L('────────────────────────────────────────────')}
      {/* bar chart sharp */}
      <div style={{ margin: '6px 0 2px', font: `400 9px ${t.mono}`, color: faintg, letterSpacing: '.05em' }}>DAILY ▸ M TOKENS</div>
      <BarChart data={TD.WEEK} theme={{ ...t, dim: dimg }} height={70} accent={green} accentSoft={'#1c6b45'} radius={0} />
      {L('────────────────────────────────────────────')}
      {/* model table */}
      <div style={{ margin: '6px 0 4px', font: `400 9px ${t.mono}`, color: faintg, letterSpacing: '.05em' }}>BY MODEL</div>
      {models.map((m, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', font: `400 10.5px ${t.mono}`, padding: '2px 0', color: 'rgba(190,230,205,0.9)' }}>
          <span style={{ width: 132, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
          <MonoBar frac={m.tokens / maxM} width={9} color={green} dim={'#16331f'} />
          <span style={{ width: 38, textAlign: 'right', color: dimg }}>{TD.fmtTokens(m.tokens)}</span>
          <span style={{ width: 32, textAlign: 'right', color: green }}>{TD.pct(m.tokens, TD.METRICS.totalTokens)}%</span>
        </div>
      ))}
      {L('────────────────────────────────────────────')}
      {/* footer kv */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 16px', marginTop: 6, font: `400 10.5px ${t.mono}` }}>
        {[['cost', `$${M.cost.toFixed(2)}`], ['requests', TD.fmtInt(M.requests)], ['mcp_calls', TD.fmtInt(M.mcpCalls)], ['skill_calls', TD.fmtInt(M.skillCalls)]].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: dimg }}>{k}</span><span style={{ color: green }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
  return <Desk dark theme={t} caretLeft={232} caretColor={bg}>{card}</Desk>;
}

// =====================================================================
// C · EDITORIAL — giant type, one elegant curve
// =====================================================================
function PanelC() {
  const t = TH.dark;
  const M = TD.METRICS, models = TD.MODELS;
  const bg = '#121311';
  const card = (
    <div style={{
      width: '100%', borderRadius: 16, background: `linear-gradient(165deg, #16181450 0%, ${bg} 60%)`,
      backgroundColor: bg,
      border: `1px solid rgba(255,255,255,0.07)`,
      boxShadow: '0 18px 50px rgba(0,0,0,0.55)', padding: '18px 18px 0', color: t.text, overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <span style={{ font: `600 10px ${t.ui}`, color: t.dim, letterSpacing: '.16em', textTransform: 'uppercase' }}>This week · usage</span>
        <Segmented value="Week" theme={t} />
      </div>
      {/* giant number */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
        <span style={{ font: `600 76px ${t.display}`, color: t.text, lineHeight: 0.84, letterSpacing: '-.03em' }}>12.4</span>
        <span style={{ font: `500 19px ${t.display}`, color: t.dim, marginBottom: 8 }}>M tokens</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0 4px', font: `500 12px ${t.mono}`, color: t.dim }}>
        <span><Delta v={M.deltaTokens} theme={t} big /> vs last week</span>
        <span style={{ color: t.faint }}>·</span>
        <span>In <span style={{ color: t.text }}>{M.inputTokens.toFixed(1)}M</span> / Out <span style={{ color: t.text }}>{M.outputTokens.toFixed(1)}M</span></span>
      </div>
      {/* elegant trend band */}
      <div style={{ margin: '14px -18px 0', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 18, top: 8, font: `500 10px ${t.ui}`, color: t.faint, letterSpacing: '.05em', zIndex: 1 }}>DAILY TREND</div>
        <TrendCurve values={TD.WEEK.map(d => d.input + d.output)} theme={t} width={360} height={104} accent={t.accent} dots />
      </div>
      {/* model split bar */}
      <div style={{ padding: '16px 0 4px' }}>
        <StackedBar data={models} theme={t} height={9} radius={5} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 11 }}>
          {models.slice(0, 4).map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, font: `500 10.5px ${t.ui}`, color: t.dim, whiteSpace: 'nowrap' }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: m.color }} />
              {m.name.replace('Claude ', '').replace(' 4.5', '').replace(' 4.1', '')}
              <span style={{ color: t.faint, fontFamily: t.mono }}>{TD.pct(m.tokens, TD.METRICS.totalTokens)}%</span>
            </div>
          ))}
        </div>
      </div>
      {/* three editorial stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderTop: `1px solid ${t.gridLine}`, margin: '14px -18px 0' }}>
        {[['$' + M.cost.toFixed(0), 'cost', t.accent], [TD.fmtInt(M.requests), 'requests', t.text], [TD.fmtInt(M.mcpCalls), 'mcp calls', t.text]].map(([v, l, c], i) => (
          <div key={i} style={{ padding: '14px 18px', borderLeft: i ? `1px solid ${t.gridLine}` : 'none' }}>
            <div style={{ font: `600 24px ${t.display}`, color: c, lineHeight: 1 }}>{v}</div>
            <div style={{ font: `500 10px ${t.ui}`, color: t.dim, marginTop: 4, letterSpacing: '.04em', textTransform: 'uppercase' }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
  return <Desk dark theme={t} caretLeft={232} caretColor={bg}>{card}</Desk>;
}

// =====================================================================
// D · MODULAR GRID — dense card dashboard
// =====================================================================
function GCard({ children, span, theme, pad = 11 }) {
  return (
    <div style={{
      gridColumn: span ? `span ${span}` : 'auto',
      background: theme._cardBg, borderRadius: 11, padding: pad,
      border: `1px solid ${theme._cardBorder}`, minWidth: 0,
    }}>{children}</div>
  );
}
function CardHead({ label, theme, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
      <span style={{ font: `600 9.5px ${theme.ui}`, color: theme.dim, letterSpacing: '.05em', textTransform: 'uppercase' }}>{label}</span>
      {right}
    </div>
  );
}
function PanelD({ dark = true }) {
  const base = TH[dark ? 'dark' : 'light'];
  const t = { ...base,
    _cardBg: dark ? '#22262b' : '#ffffff',
    _cardBorder: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' };
  const M = TD.METRICS, models = TD.MODELS;
  const top = models[0];
  const panelBg = dark ? '#16191d' : '#eef1ef';
  const card = (
    <div style={{
      width: '100%', borderRadius: 15, background: panelBg,
      border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}`,
      boxShadow: dark ? '0 18px 50px rgba(0,0,0,0.5)' : '0 18px 50px rgba(40,60,50,0.16)',
      padding: 12, color: t.text,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TokenGlyph color={t.accent} size={16} />
          <span style={{ font: `600 13px ${t.ui}`, color: t.text }}>Tokenscope</span>
        </div>
        <Segmented value="Week" theme={t} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {/* tokens spanning */}
        <GCard span={2} theme={t}>
          <CardHead label="Token usage · this week" theme={t} right={<Delta v={M.deltaTokens} theme={t} />} />
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 9 }}>
            <span style={{ font: `600 26px ${t.mono}`, color: t.text, lineHeight: 1 }}>{M.totalTokens.toFixed(2)}<span style={{ fontSize: 14, color: t.dim }}>M</span></span>
            <span style={{ font: `500 10px ${t.mono}`, color: t.dim }}>
              <span style={{ color: t.accent }}>●</span> in {M.inputTokens.toFixed(1)}M&nbsp;&nbsp;<span style={{ color: t.accentSoft }}>●</span> out {M.outputTokens.toFixed(1)}M
            </span>
          </div>
          <BarChart data={TD.WEEK} theme={t} height={66} />
        </GCard>
        {/* cost */}
        <GCard theme={t}>
          <CardHead label="Est. cost" theme={t} />
          <div style={{ font: `600 22px ${t.mono}`, color: t.accent, lineHeight: 1 }}>${M.cost.toFixed(2)}</div>
          <div style={{ marginTop: 6 }}><Sparkline values={TD.COST_TREND} theme={t} width={170} height={26} accent={t.accent} /></div>
        </GCard>
        {/* models donut */}
        <GCard theme={t}>
          <CardHead label="Models" theme={t} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Donut data={models} theme={t} size={62} thickness={10} />
            <div style={{ minWidth: 0 }}>
              {models.slice(0, 3).map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, font: `500 10px ${t.ui}`, color: t.dim, padding: '1px 0' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: m.color }} />
                  <span style={{ color: t.text }}>{TD.pct(m.tokens, M.totalTokens)}%</span>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name.replace('Claude ', '').replace(/ \d.*/, '')}</span>
                </div>
              ))}
            </div>
          </div>
        </GCard>
        {/* MCP */}
        <GCard theme={t}>
          <CardHead label="MCP calls" theme={t} />
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <span style={{ font: `600 22px ${t.mono}`, color: t.text, lineHeight: 1 }}>{TD.fmtInt(M.mcpCalls)}</span>
            <Sparkline values={[180, 240, 200, 320, 280, 110, 254]} theme={t} width={66} height={24} accent={t.accent} />
          </div>
          <div style={{ font: `500 9px ${t.mono}`, color: t.faint, marginTop: 6 }}>across 14 servers</div>
        </GCard>
        {/* Skill */}
        <GCard theme={t}>
          <CardHead label="Skill calls" theme={t} />
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <span style={{ font: `600 22px ${t.mono}`, color: t.text, lineHeight: 1 }}>{TD.fmtInt(M.skillCalls)}</span>
            <Sparkline values={[40, 62, 55, 88, 70, 30, 56]} theme={t} width={66} height={24} accent={t.accent} />
          </div>
          <div style={{ font: `500 9px ${t.mono}`, color: t.faint, marginTop: 6 }}>across 22 skills</div>
        </GCard>
        {/* requests + sessions */}
        <GCard span={2} theme={t} pad={0}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
            {[['Requests', TD.fmtInt(M.requests)], ['Sessions', TD.fmtInt(M.sessions)], ['Avg / req', '4.4K']].map(([l, v], i) => (
              <div key={i} style={{ padding: '11px 12px', borderLeft: i ? `1px solid ${t._cardBorder}` : 'none' }}>
                <div style={{ font: `500 9.5px ${t.ui}`, color: t.dim, letterSpacing: '.04em', textTransform: 'uppercase' }}>{l}</div>
                <div style={{ font: `600 19px ${t.mono}`, color: t.text, marginTop: 4 }}>{v}</div>
              </div>
            ))}
          </div>
        </GCard>
      </div>
    </div>
  );
  return <Desk dark={dark} theme={t} caretLeft={280} caretColor={panelBg}>{card}</Desk>;
}

Object.assign(window, { PanelA, PanelB, PanelC, PanelD, TH });
