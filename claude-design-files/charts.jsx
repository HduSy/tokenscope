// charts.jsx — reusable chart primitives + macOS chrome for the panels.
// All visual, theme-driven via props. Exports to window.

const { useId } = React;

// ── Segmented period control (Day/Week/Month) ──────────────────
function Segmented({ value = 'Week', items = ['Day', 'Week', 'Month'], theme, onSelect }) {
  const t = theme;
  return (
    <div style={{
      display: 'inline-flex', padding: 2, borderRadius: 7,
      background: t.segBg, border: `1px solid ${t.segBorder}`, gap: 2,
    }}>
      {items.map((it) => {
        const on = it === value;
        return (
          <div key={it} onClick={() => onSelect && onSelect(it)} style={{
            font: `600 11px ${t.ui}`, letterSpacing: '.02em',
            padding: '3px 11px', borderRadius: 5, cursor: 'pointer', userSelect: 'none',
            color: on ? t.segOnText : t.segOffText,
            background: on ? t.segOnBg : 'transparent',
            boxShadow: on ? t.segOnShadow : 'none',
            transition: 'color .15s, background .15s',
          }}>{it}</div>
        );
      })}
    </div>
  );
}

// ── Stacked bar chart (input + output per period) ──────────────
function BarChart({ data, theme, height = 96, accent, accentSoft, showGrid = true, radius = 3, overlayCurve = false, curveColor, curveDots = true, dotSize = 5, dotColor }) {
  const t = theme;
  accent = accent || t.accent; accentSoft = accentSoft || t.accentSoft;
  curveColor = curveColor || '#fff';
  const max = Math.max(...data.map(d => d.input + d.output));
  const n = data.length;
  // percentage-based gap so bar centers are computable in pure % (line + dots align exactly)
  const gapPct = Math.max(0.8, Math.min(6, 32 / n));
  const barPct = (100 - (n - 1) * gapPct) / n;
  const effRadius = n > 16 ? 1 : radius;
  const centerX = (i) => i * (barPct + gapPct) + barPct / 2;     // 0..100
  const cpts = data.map((d, i) => [centerX(i), (1 - (d.input + d.output) / max) * 100]);
  const smooth = (() => {
    let dd = `M ${cpts[0][0].toFixed(2)} ${cpts[0][1].toFixed(2)}`;
    for (let i = 0; i < cpts.length - 1; i++) {
      const p0 = cpts[i - 1] || cpts[i], p1 = cpts[i], p2 = cpts[i + 1], p3 = cpts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      dd += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
    }
    return dd;
  })();
  return (
    <div>
      <div style={{ position: 'relative', height, display: 'flex', alignItems: 'flex-end', gap: `${gapPct}%` }}>
        {showGrid && [0.25, 0.5, 0.75, 1].map((g, i) => (
          <div key={i} style={{ position: 'absolute', left: 0, right: 0, bottom: `${g * 100}%`, borderTop: `1px solid ${t.gridLine}` }} />
        ))}
        {data.map((d, i) => {
          const hO = (d.output / max) * height;
          const hI = (d.input / max) * height;
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', position: 'relative', zIndex: 1 }}>
              <div style={{ height: hO, background: accentSoft, borderRadius: `${effRadius}px ${effRadius}px 0 0` }} />
              <div style={{ height: hI, background: accent }} />
            </div>
          );
        })}
        {overlayCurve && (
          <svg width="100%" height={height} viewBox="0 0 100 100" preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, zIndex: 2, overflow: 'visible', pointerEvents: 'none' }}>
            <path d={smooth} fill="none" stroke={curveColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        {overlayCurve && curveDots && cpts.map((p, i) => (
          <span key={i} style={{
            position: 'absolute', zIndex: 3, width: dotSize, height: dotSize, borderRadius: '50%',
            background: dotColor || curveColor, left: `${p[0]}%`, top: `${(p[1] / 100) * height}px`,
            transform: 'translate(-50%, -50%)', pointerEvents: 'none',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: `${gapPct}%`, marginTop: 6 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', font: `500 9px ${t.mono}`, color: t.dim, letterSpacing: '.03em' }}>{d.label}</div>
        ))}
      </div>
    </div>
  );
}

// ── Trend curve (area + line) ──────────────────────────────────
function TrendCurve({ values, theme, width = 320, height = 80, accent, fill = true, dots = false, strokeW = 2 }) {
  const t = theme;
  accent = accent || t.accent;
  const gid = useId().replace(/:/g, '');
  const { d, px, py, pts } = TD.linePath(values, width, height, strokeW + 1);
  const area = `${d} L ${px(values.length - 1).toFixed(1)} ${height} L ${px(0).toFixed(1)} ${height} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#g${gid})`} />}
      <path d={d} fill="none" stroke={accent} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {dots && pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2.4" fill={accent} vectorEffect="non-scaling-stroke" />
      ))}
      {dots && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.4" fill={accent} stroke={t.card} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

// ── Sparkline (tiny line, no fill) ─────────────────────────────
function Sparkline({ values, theme, width = 80, height = 24, accent, strokeW = 1.6 }) {
  const t = theme; accent = accent || t.accent;
  const { d, pts } = TD.linePath(values, width, height, strokeW + 1);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
      <path d={d} fill="none" stroke={accent} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.1" fill={accent} />
    </svg>
  );
}

// ── Donut (model distribution) ─────────────────────────────────
function Donut({ data, theme, size = 92, thickness = 13 }) {
  const total = data.reduce((s, d) => s + d.tokens, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {data.map((d, i) => {
          const frac = d.tokens / total;
          const dash = frac * c;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r}
              fill="none" stroke={d.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-acc * c}
              strokeLinecap="butt" />
          );
          acc += frac;
          return el;
        })}
      </g>
    </svg>
  );
}

// ── Horizontal stacked distribution bar ────────────────────────
function StackedBar({ data, theme, height = 10, radius = 5, gap = 2 }) {
  const total = data.reduce((s, d) => s + d.tokens, 0);
  return (
    <div style={{ display: 'flex', gap, height, borderRadius: radius, overflow: 'hidden' }}>
      {data.map((d, i) => (
        <div key={i} style={{ width: `${(d.tokens / total) * 100}%`, background: d.color, borderRadius: 2 }} />
      ))}
    </div>
  );
}

// ── macOS menu bar strip (panel hangs below the bar icon) ──────
function MenuBar({ theme, dark, highlight = false }) {
  const t = theme;
  const c = dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.82)';
  const dim = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  return (
    <div style={{
      height: 26, display: 'flex', alignItems: 'center', gap: 15,
      padding: '0 11px',
      background: dark ? 'rgba(28,30,32,0.5)' : 'rgba(250,250,250,0.6)',
      borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
      backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    }}>
      <svg width="13" height="13" viewBox="0 0 16 16" style={{ opacity: dark ? 0.92 : 0.78 }}><path fill={c} d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm0 1.2a5.3 5.3 0 110 10.6A5.3 5.3 0 018 2.7z"/></svg>
      <span style={{ font: `600 12px ${t.ui}`, color: c }}>Finder</span>
      <span style={{ font: `400 12px ${t.ui}`, color: dim }}>File</span>
      <span style={{ font: `400 12px ${t.ui}`, color: dim }}>Edit</span>
      <span style={{ marginLeft: 'auto' }} />
      {/* status extras */}
      <span style={{ font: `400 12px ${t.ui}`, color: dim }}>􀙇</span>
      <span style={{ font: `400 12px ${t.ui}`, color: dim }}>􀖀</span>
      {/* the app's own menu bar item (highlighted = panel open) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '2px 6px', borderRadius: 5,
        background: highlight ? (dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)') : 'transparent',
      }}>
        <TokenGlyph color={t.accent} size={13} />
        <span style={{ font: `600 11px ${t.mono}`, color: c, letterSpacing: '.01em' }}>12.4M</span>
      </div>
      <span style={{ font: `500 12px ${t.ui}`, color: dim }}>Mon 9:41</span>
    </div>
  );
}

// little app glyph — concentric meter
function TokenGlyph({ color = '#1f9d63', size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14">
      <rect x="0.6" y="0.6" width="12.8" height="12.8" rx="3.2" fill="none" stroke={color} strokeWidth="1.3" />
      <rect x="3" y="7.5" width="1.7" height="3.2" rx="0.6" fill={color} />
      <rect x="6.15" y="5" width="1.7" height="5.7" rx="0.6" fill={color} />
      <rect x="9.3" y="3" width="1.7" height="7.7" rx="0.6" fill={color} />
    </svg>
  );
}

// caret that connects panel to the menu bar icon
function PanelCaret({ color, left = 18 }) {
  return (
    <div style={{ position: 'absolute', top: -7, left, width: 0, height: 0,
      borderLeft: '8px solid transparent', borderRight: '8px solid transparent',
      borderBottom: `8px solid ${color}`, filter: 'drop-shadow(0 -1px 1px rgba(0,0,0,0.06))' }} />
  );
}

// ── Interactive cost donut (hover a wedge → center shows its $) ──
function CostDonut({ models, theme, size = 104, thickness = 16, valueKey = 'cost', accent }) {
  const t = theme;
  const [hi, setHi] = React.useState(-1);
  const total = models.reduce((s, m) => s + m[valueKey], 0);
  const cx = size / 2, cy = size / 2;
  const rOut = (size - 2) / 2;
  const rIn = rOut - thickness;
  const gap = 0.045; // radians between wedges
  let a = -Math.PI / 2;
  const arc = (a0, a1, rO, rI) => {
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = cx + rO * Math.cos(a0), y0 = cy + rO * Math.sin(a0);
    const x1 = cx + rO * Math.cos(a1), y1 = cy + rO * Math.sin(a1);
    const x2 = cx + rI * Math.cos(a1), y2 = cy + rI * Math.sin(a1);
    const x3 = cx + rI * Math.cos(a0), y3 = cy + rI * Math.sin(a0);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${rO} ${rO} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${rI} ${rI} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
  };
  const wedges = models.map((m, i) => {
    const frac = m[valueKey] / total;
    const a0 = a + gap / 2, a1 = a + frac * 2 * Math.PI - gap / 2;
    a += frac * 2 * Math.PI;
    const on = hi === i;
    return { m, i, d: arc(a0, a1, on ? rOut + 2 : rOut, rIn) };
  });
  const cur = hi >= 0 ? models[hi] : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
          {wedges.map((w) => (
            <path key={w.i} d={w.d} fill={w.m.color}
              opacity={hi === -1 || hi === w.i ? 1 : 0.32}
              onMouseEnter={() => setHi(w.i)} onMouseLeave={() => setHi(-1)}
              style={{ transition: 'opacity .14s', cursor: 'default' }} />
          ))}
        </svg>
        {/* center amount — total by default, hovered model on hover.
            auto-fits font to the hole + abbreviates large sums so the UI never breaks */}
        {(() => {
          const amount = cur ? cur.cost : total;
          const txt = TD.fmtMoney(amount);
          const avail = (size - 2 - thickness * 2) * 0.98;     // usable width in the hole
          const base = cur ? 15 : 17;
          const fit = Math.min(base, Math.max(10, avail / (txt.length * 0.62)));
          return (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ font: `600 ${fit.toFixed(1)}px ${t.mono}`, color: cur ? cur.color : t.text, lineHeight: 1, letterSpacing: '-.01em' }}>{txt}</span>
            </div>
          );
        })()}
      </div>
      {/* legend with $ amounts */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {models.map((m, i) => (
          <div key={i} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(-1)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2.5px 0', opacity: hi === -1 || hi === i ? 1 : 0.45, transition: 'opacity .14s', cursor: 'default', userSelect: 'none' }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: m.color, flex: '0 0 auto' }} />
            <span style={{ font: `500 10.5px ${t.ui}`, color: hi === i ? t.text : t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, fontWeight: hi === i ? 600 : 500 }}>{m.name.replace('Claude ', '')}</span>
            <span style={{ font: `600 10.5px ${t.mono}`, color: hi === i ? m.color : t.dim, flex: '0 0 auto' }}>{TD.fmtMoney(m.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Named horizontal-bar list (MCP servers / skills: name · bar · count) ──
function BarList({ items, theme, accent, limit = 5 }) {
  const t = theme; accent = accent || t.accent;
  const shown = items.slice(0, limit);
  const max = Math.max(...items.map(i => i.count), 1);
  const more = items.length - shown.length;
  return (
    <div>
      {shown.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '3px 0' }}>
          <span style={{ font: `500 10.5px ${t.mono}`, color: t.text, flex: '0 0 96px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</span>
          <div style={{ flex: 1, height: 5, borderRadius: 3, background: t.gridLine, overflow: 'hidden' }}>
            <div style={{ width: `${(it.count / max) * 100}%`, height: '100%', background: accent, borderRadius: 3 }} />
          </div>
          <span style={{ font: `600 10.5px ${t.mono}`, color: t.dim, flex: '0 0 auto', width: 38, textAlign: 'right' }}>{TD.fmtInt(it.count)}</span>
        </div>
      ))}
      {more > 0 && (
        <div style={{ font: `500 9.5px ${t.ui}`, color: t.faint, paddingTop: 4 }}>+{more} more</div>
      )}
    </div>
  );
}

// ── Contribution heatmap (GitHub-style year grid, width-responsive) ──
function Heatmap({ days, theme, accent, gap = 2 }) {
  const t = theme; accent = accent || t.accent;
  const [hi, setHi] = React.useState(null);
  const [tip, setTip] = React.useState({ x: 0, y: 0 });
  const wrapRef = React.useRef(null);
  // bucket into weeks (columns of 7, indexed by getDay)
  const weeks = [];
  days.forEach((d) => {
    const dow = d.date.getDay();
    if (dow === 0 || weeks.length === 0) weeks.push(new Array(7).fill(null));
    weeks[weeks.length - 1][dow] = d;
  });
  const empty = t.gridLine;
  const ramp = (lvl) => {
    if (lvl === 0) return empty;
    const op = [0, 0.28, 0.5, 0.74, 1][lvl];
    return mix(accent, op, t.card);
  };
  // month labels positioned by column fraction
  const monthLabels = [];
  let lastMonth = -1;
  weeks.forEach((wk, wi) => {
    const first = wk.find(Boolean);
    if (first) {
      const m = first.date.getMonth();
      if (m !== lastMonth) { monthLabels.push({ frac: wi / weeks.length, m }); lastMonth = m; }
    }
  });
  const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const onCell = (d, e) => {
    if (!d) return;
    const wrap = wrapRef.current.getBoundingClientRect();
    const r = e.target.getBoundingClientRect();
    setHi(d);
    setTip({ x: r.left - wrap.left + r.width / 2, y: r.top - wrap.top });
  };
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* month labels */}
      <div style={{ position: 'relative', height: 12, marginBottom: 3 }}>
        {monthLabels.map((ml, i) => (
          <span key={i} style={{ position: 'absolute', left: `${ml.frac * 100}%`, font: `500 8.5px ${t.mono}`, color: t.faint }}>{MN[ml.m]}</span>
        ))}
      </div>
      {/* grid — columns flex to fill width, cells square via aspect-ratio */}
      <div style={{ display: 'flex', gap, width: '100%' }}>
        {weeks.map((wk, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap, flex: '1 1 0', minWidth: 0 }}>
            {wk.map((d, di) => (
              <div key={di}
                onMouseEnter={d ? (e) => onCell(d, e) : undefined}
                onMouseLeave={() => setHi(null)}
                style={{
                  width: '100%', aspectRatio: '1 / 1', borderRadius: 2,
                  background: d ? ramp(d.level) : 'transparent',
                  outline: hi === d ? `1.5px solid ${t.text}` : 'none', outlineOffset: -0.5,
                }} />
            ))}
          </div>
        ))}
      </div>
      {/* legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end', marginTop: 8, font: `500 8.5px ${t.mono}`, color: t.faint }}>
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} style={{ width: 9, height: 9, borderRadius: 2, background: ramp(l) }} />
        ))}
        <span>More</span>
      </div>
      {/* tooltip */}
      {hi && (
        <div style={{
          position: 'absolute', left: tip.x, top: tip.y - 8, transform: 'translate(-50%,-100%)',
          background: t.tip || '#000', color: '#fff', borderRadius: 6, padding: '5px 8px',
          font: `500 10px ${t.mono}`, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 5,
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)', maxWidth: '100%',
        }}>
          <span style={{ color: accent, fontWeight: 600 }}>{hi.tokens === 0 ? 'No calls' : TD.fmtTokens(hi.tokens) + ' tokens'}</span>
          <span style={{ opacity: 0.7 }}> · {TD.fmtDate(hi.date)}</span>
        </div>
      )}
    </div>
  );
}
// blend an accent color over a base at given opacity → solid hex-ish rgba
function mix(accent, op, base) {
  return `color-mix(in srgb, ${accent} ${Math.round(op * 100)}%, ${base})`;
}

Object.assign(window, { Segmented, BarChart, TrendCurve, Sparkline, Donut, CostDonut, BarList, Heatmap, StackedBar, MenuBar, TokenGlyph, PanelCaret });
