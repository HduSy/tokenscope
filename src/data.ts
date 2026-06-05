import { invoke } from "@tauri-apps/api/core";

export interface SeriesPoint { label: string; input: number; cache: number; output: number }
export interface ModelStat { name: string; vendor: string; tokens: number; cost: number; color: string; priced: boolean }
export interface NamedCount { name: string; count: number }
export interface Metrics {
  totalTokens: number; inputTokens: number; cacheTokens: number; outputTokens: number; cost: number;
  mcpCalls: number; skillCalls: number; requests: number; sessions: number;
  deltaTokens: number; deltaCost: number; servers: number; skills: number;
}
export interface PeriodReport {
  metrics: Metrics; series: SeriesPoint[]; models: ModelStat[];
  mcp: NamedCount[]; skills: NamedCount[]; reqTrend: number[]; costTrend: number[];
}
export interface HeatDay { date: string; tokens: number; level: number }
export interface Dashboard {
  day: PeriodReport; week: PeriodReport; month: PeriodReport;
  heatmap: HeatDay[]; todayTokens: number; generatedAt: string;
}

export async function fetchDashboard(): Promise<Dashboard> {
  // Inside the Tauri runtime → call the Rust backend.
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (inTauri) return invoke<Dashboard>("get_dashboard");
  // Browser dev/preview fallback → static snapshot of real data.
  const res = await fetch("/dev-dashboard.json");
  if (!res.ok) throw new Error("not running in Tauri and no dev snapshot found");
  return res.json();
}

// ── formatting helpers ──────────────────────────────────────────
export const fmtTokens = (m: number) => (m >= 1 ? m.toFixed(2) + "M" : Math.round(m * 1000) + "K");
export const fmtInt = (n: number) => n.toLocaleString("en-US");
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
export function fmtMoney(v: number) {
  if (v >= 100000) return "$" + Math.round(v / 1000) + "K";
  if (v >= 10000) return "$" + (v / 1000).toFixed(1) + "K";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function linePath(values: number[], w: number, h: number, pad = 2) {
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const n = values.length;
  const px = (i: number) => pad + (i / (n - 1)) * (w - pad * 2);
  const py = (v: number) => pad + (1 - (v - min) / range) * (h - pad * 2);
  const pts = values.map((v, i) => [px(i), py(v)] as [number, number]);
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return { d, px, py, pts };
}

// ── theme ────────────────────────────────────────────────────────
export interface Theme {
  ui: string; mono: string; display: string;
  accent: string; accentSoft: string; cacheCol: string;
  text: string; dim: string; faint: string;
  gridLine: string; card: string;
  segBg: string; segBorder: string; segOnBg: string; segOnText: string; segOffText: string; segOnShadow: string;
  tip: string;
}
export const TH: Record<"dark" | "light", Theme> = {
  dark: {
    ui: "'IBM Plex Sans', system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
    display: "'Space Grotesk', system-ui, sans-serif",
    accent: "#27b06e", accentSoft: "#5fcf9c", cacheCol: "#5a6660",
    text: "rgba(255,255,255,0.94)", dim: "rgba(255,255,255,0.52)", faint: "rgba(255,255,255,0.32)",
    gridLine: "rgba(255,255,255,0.06)", card: "#1f2226",
    segBg: "rgba(255,255,255,0.06)", segBorder: "rgba(255,255,255,0.09)",
    segOnBg: "rgba(255,255,255,0.15)", segOnText: "#fff", segOffText: "rgba(255,255,255,0.55)",
    segOnShadow: "0 1px 2px rgba(0,0,0,0.35)", tip: "#34383d",
  },
  light: {
    ui: "'IBM Plex Sans', system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
    display: "'Space Grotesk', system-ui, sans-serif",
    accent: "#178a55", accentSoft: "#8fd9b4", cacheCol: "#aeb8b2",
    text: "rgba(17,22,19,0.94)", dim: "rgba(17,22,19,0.5)", faint: "rgba(17,22,19,0.32)",
    gridLine: "rgba(0,0,0,0.06)", card: "#ffffff",
    segBg: "rgba(0,0,0,0.05)", segBorder: "rgba(0,0,0,0.07)",
    segOnBg: "#ffffff", segOnText: "#111", segOffText: "rgba(0,0,0,0.5)",
    segOnShadow: "0 1px 2px rgba(0,0,0,0.12)", tip: "#1d2420",
  },
};

export function fmtHeatDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
