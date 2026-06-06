import { useId, useRef, useState } from "react";
import {
  Theme, ModelStat, NamedCount, SeriesPoint, HeatDay,
  fmtInt, fmtMoney, fmtTokens, linePath, fmtHeatDate,
} from "./data";

export function TokenGlyph({ color = "#1f9d63", size = 14 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14">
      <rect x="0.6" y="0.6" width="12.8" height="12.8" rx="3.2" fill="none" stroke={color} strokeWidth="1.3" />
      <rect x="3" y="7.5" width="1.7" height="3.2" rx="0.6" fill={color} />
      <rect x="6.15" y="5" width="1.7" height="5.7" rx="0.6" fill={color} />
      <rect x="9.3" y="3" width="1.7" height="7.7" rx="0.6" fill={color} />
    </svg>
  );
}

export function Segmented({ value, items = ["Day", "Week", "Month"], theme, onSelect }:
  { value: string; items?: string[]; theme: Theme; onSelect?: (v: string) => void }) {
  const t = theme;
  return (
    <div style={{ display: "inline-flex", padding: 2, borderRadius: 7, background: t.segBg, border: `1px solid ${t.segBorder}`, gap: 2 }}>
      {items.map((it) => {
        const on = it === value;
        return (
          <div key={it} onClick={() => onSelect && onSelect(it)} style={{
            font: `600 11px ${t.ui}`, letterSpacing: ".02em", padding: "3px 11px", borderRadius: 5, cursor: "pointer", userSelect: "none",
            color: on ? t.segOnText : t.segOffText, background: on ? t.segOnBg : "transparent",
            boxShadow: on ? t.segOnShadow : "none", transition: "color .15s, background .15s",
          }}>{it}</div>
        );
      })}
    </div>
  );
}

export function BarChart({ data, theme, height = 96, accent, accentSoft, radius = 3 }:
  { data: SeriesPoint[]; theme: Theme; height?: number; accent?: string; accentSoft?: string; radius?: number }) {
  const t = theme;
  accent = accent || t.accent; accentSoft = accentSoft || t.accentSoft;
  const max = Math.max(...data.map((d) => d.input + d.cache + d.output), 1e-9);
  const n = data.length;
  const gapPct = Math.max(0.8, Math.min(6, 32 / n));
  const effRadius = n > 16 ? 1 : radius;
  return (
    <div>
      <div style={{ position: "relative", height, display: "flex", alignItems: "flex-end", gap: `${gapPct}%` }}>
        {[0.25, 0.5, 0.75, 1].map((g, i) => (
          <div key={i} style={{ position: "absolute", left: 0, right: 0, bottom: `${g * 100}%`, borderTop: `1px solid ${t.gridLine}` }} />
        ))}
        {data.map((d, i) => {
          // stacked top→bottom: output · input(+cache)
          const hO = (d.output / max) * height, hI = ((d.input + d.cache) / max) * height;
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", position: "relative", zIndex: 1 }}>
              <div style={{ height: hO, background: accentSoft, borderRadius: `${effRadius}px ${effRadius}px 0 0` }} />
              <div style={{ height: hI, background: accent }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: `${gapPct}%`, marginTop: 6 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", font: `500 9px ${t.mono}`, color: t.dim, letterSpacing: ".03em" }}>{d.label}</div>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ values, theme, width = 80, height = 24, accent, strokeW = 1.6 }:
  { values: number[]; theme: Theme; width?: number; height?: number; accent?: string; strokeW?: number }) {
  const t = theme; accent = accent || t.accent;
  if (!values.length || values.every((v) => v === values[0])) values = values.length ? values : [0, 0];
  const gid = useId().replace(/:/g, "");
  const { d, px } = linePath(values, width, height, strokeW + 1);
  // Apple-Stocks style: line + gradient area fading out below the curve.
  const area = `${d} L ${px(values.length - 1).toFixed(1)} ${height} L ${px(0).toFixed(1)} ${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={`sl${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.32" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sl${gid})`} stroke="none" />
      <path d={d} fill="none" stroke={accent} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CostDonut({ models, theme, size = 104, thickness = 16 }:
  { models: ModelStat[]; theme: Theme; size?: number; thickness?: number }) {
  const t = theme;
  const [hi, setHi] = useState(-1);
  const total = models.reduce((s, m) => s + m.cost, 0) || 1e-9;
  const cx = size / 2, cy = size / 2;
  const rOut = (size - 2) / 2, rIn = rOut - thickness;
  const gap = 0.045;
  let a = -Math.PI / 2;
  const arc = (a0: number, a1: number, rO: number, rI: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + rO * Math.cos(a0), y0 = cy + rO * Math.sin(a0);
    const x1 = cx + rO * Math.cos(a1), y1 = cy + rO * Math.sin(a1);
    const x2 = cx + rI * Math.cos(a1), y2 = cy + rI * Math.sin(a1);
    const x3 = cx + rI * Math.cos(a0), y3 = cy + rI * Math.sin(a0);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${rO} ${rO} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${rI} ${rI} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
  };
  const wedges = models.map((m, i) => {
    const frac = m.cost / total;
    const a0 = a + gap / 2, a1 = a + frac * 2 * Math.PI - gap / 2;
    a += frac * 2 * Math.PI;
    return { m, i, d: arc(a0, a1, hi === i ? rOut + 2 : rOut, rIn) };
  });
  const cur = hi >= 0 ? models[hi] : null;
  const amount = cur ? cur.cost : total;
  const txt = fmtMoney(amount);
  const avail = (size - 2 - thickness * 2) * 0.98;
  const base = cur ? 15 : 17;
  const fit = Math.min(base, Math.max(10, avail / (txt.length * 0.62)));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
          {wedges.map((w) => (
            <path key={w.i} d={w.d} fill={w.m.color}
              opacity={hi === -1 || hi === w.i ? 1 : 0.32}
              onMouseEnter={() => setHi(w.i)} onMouseLeave={() => setHi(-1)}
              style={{ transition: "opacity .14s", cursor: "default" }} />
          ))}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <span style={{ font: `600 ${fit.toFixed(1)}px ${t.mono}`, color: cur ? cur.color : t.text, lineHeight: 1, letterSpacing: "-.01em" }}>{txt}</span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {models.map((m, i) => (
          <div key={i} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(-1)}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "2.5px 0", opacity: hi === -1 || hi === i ? 1 : 0.45, transition: "opacity .14s", cursor: "default", userSelect: "none" }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: m.color, flex: "0 0 auto" }} />
            <span style={{ font: `500 10.5px ${t.ui}`, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, fontWeight: hi === i ? 600 : 500 }}>{m.name.replace("Claude ", "")}</span>
            <span style={{ font: `600 10.5px ${t.mono}`, color: hi === i ? m.color : t.dim, flex: "0 0 auto" }}>{fmtMoney(m.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarList({ items, theme, accent, limit = 5 }:
  { items: NamedCount[]; theme: Theme; accent?: string; limit?: number }) {
  const t = theme; accent = accent || t.accent;
  const shown = items.slice(0, limit);
  // Bar length = this item's share of the *total* calls (count / total), so the
  // track (light) is the whole, the fill (accent) is the percentage — same logic
  // as the Total-tokens bar.
  const total = items.reduce((s, i) => s + i.count, 0) || 1;
  const more = items.length - shown.length;
  return (
    <div>
      {shown.map((it, i) => (
        // name flush-left (width 134 keeps the bar start aligned with ModelRow's
        // bar at x=143); the bar then runs all the way to a far-right count, whose
        // right edge lines up with the model rows' trailing value.
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "3px 0" }}>
          <span style={{ font: `500 10.5px ${t.mono}`, color: t.text, flex: "0 0 134px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</span>
          <div style={{ flex: 1, height: 5, borderRadius: 3, background: t.gridLine, overflow: "hidden" }}>
            <div style={{ width: `${(it.count / total) * 100}%`, height: "100%", background: accent, borderRadius: 3 }} />
          </div>
          <span style={{ font: `600 10.5px ${t.mono}`, color: t.dim, flex: "0 0 auto", minWidth: 30, textAlign: "right" }}>{fmtInt(it.count)}</span>
        </div>
      ))}
      {more > 0 && <div style={{ font: `500 9.5px ${t.ui}`, color: t.faint, paddingTop: 4 }}>+{more} more</div>}
    </div>
  );
}

function ramp(accent: string, lvl: number, gridLine: string, card: string) {
  if (lvl === 0) return gridLine;
  const op = [0, 0.28, 0.5, 0.74, 1][lvl];
  return `color-mix(in srgb, ${accent} ${Math.round(op * 100)}%, ${card})`;
}

export function Heatmap({ days, theme, accent, gap = 2 }:
  { days: HeatDay[]; theme: Theme; accent?: string; gap?: number }) {
  const t = theme; accent = accent || t.accent;
  const [hi, setHi] = useState<HeatDay | null>(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const weeks: (HeatDay | null)[][] = [];
  days.forEach((d) => {
    const dow = new Date(d.date + "T00:00:00").getDay();
    if (dow === 0 || weeks.length === 0) weeks.push(new Array(7).fill(null));
    weeks[weeks.length - 1][dow] = d;
  });
  // Label each month at the week column containing its 1st day (so a month
  // starting mid-week — e.g. the current month — still gets labelled). The
  // first (partial) column is labelled with its own starting month.
  const monthLabels: { frac: number; m: number }[] = [];
  const seenM = new Set<number>();
  weeks.forEach((wk, wi) => {
    const present = wk.filter(Boolean) as HeatDay[];
    if (!present.length) return;
    if (monthLabels.length === 0) {
      const m = new Date(present[0].date + "T00:00:00").getMonth();
      monthLabels.push({ frac: wi / weeks.length, m });
      seenM.add(m);
      return;
    }
    for (const d of present) {
      const dt = new Date(d.date + "T00:00:00");
      if (dt.getDate() <= 7 && !seenM.has(dt.getMonth())) {
        seenM.add(dt.getMonth());
        monthLabels.push({ frac: wi / weeks.length, m: dt.getMonth() });
        break;
      }
    }
  });
  const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const onCell = (d: HeatDay, e: React.MouseEvent) => {
    // viewport coords → tooltip uses position:fixed so it isn't clipped by the
    // scrolling card's overflow (renders on top of the panel).
    const r = (e.target as HTMLElement).getBoundingClientRect();
    setHi(d); setTip({ x: r.left + r.width / 2, y: r.top });
  };
  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ position: "relative", height: 12, marginBottom: 3 }}>
        {monthLabels.map((ml, i) => (
          <span key={i} style={{ position: "absolute", left: `${ml.frac * 100}%`, font: `500 8.5px ${t.mono}`, color: t.faint }}>{MN[ml.m]}</span>
        ))}
      </div>
      <div style={{ display: "flex", gap, width: "100%" }}>
        {weeks.map((wk, wi) => (
          <div key={wi} style={{ display: "flex", flexDirection: "column", gap, flex: "1 1 0", minWidth: 0 }}>
            {wk.map((d, di) => (
              <div key={di}
                onMouseEnter={d ? (e) => onCell(d, e) : undefined}
                onMouseLeave={() => setHi(null)}
                style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 2,
                  background: d ? ramp(accent!, d.level, t.gridLine, t.card) : "transparent" }} />
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end", marginTop: 8, font: `500 8.5px ${t.mono}`, color: t.faint }}>
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (<span key={l} style={{ width: 9, height: 9, borderRadius: 2, background: ramp(accent!, l, t.gridLine, t.card) }} />))}
        <span>More</span>
      </div>
      {hi && (
        <div style={{
          position: "fixed",
          left: Math.min(Math.max(tip.x, 96), (typeof window !== "undefined" ? window.innerWidth : 372) - 96),
          top: tip.y - 8, transform: "translate(-50%,-100%)",
          background: t.tip, color: "#fff", borderRadius: 6, padding: "5px 8px",
          font: `500 10px ${t.mono}`, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 9999,
          boxShadow: "0 4px 14px rgba(0,0,0,0.35)" }}>
          <span style={{ color: accent, fontWeight: 600 }}>{hi.tokens === 0 ? "No calls" : fmtTokens(hi.tokens) + " tokens"}</span>
          <span style={{ opacity: 0.7 }}> · {fmtHeatDate(hi.date)}</span>
        </div>
      )}
    </div>
  );
}
