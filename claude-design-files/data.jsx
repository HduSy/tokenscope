// data.jsx — shared sample data for the Tokens usage panel.
// Local, cross-provider model usage. Exposed on window.TD.

const ACCENT = '#1f9d63';        // primary green
const ACCENT_SOFT = '#7fd1a6';   // light green (output / secondary)

// ── Period series ──────────────────────────────────────────────
// Each datum: label, input (M tokens), output (M tokens)
const WEEK = [
  { label: 'Mon', input: 0.92, output: 0.48 },
  { label: 'Tue', input: 1.36, output: 0.74 },
  { label: 'Wed', input: 1.18, output: 0.62 },
  { label: 'Thu', input: 1.71, output: 0.89 },
  { label: 'Fri', input: 1.52, output: 0.78 },
  { label: 'Sat', input: 0.58, output: 0.31 },
  { label: 'Sun', input: 0.86, output: 0.44 },
];

// 24 hourly buckets — realistic daily rhythm (low overnight, peak afternoon)
const DAY = (() => {
  const shape = [0.05,0.03,0.02,0.02,0.03,0.06,0.12,0.28,0.46,0.62,0.74,0.81,
                 0.69,0.58,0.83,0.92,0.78,0.64,0.49,0.38,0.31,0.22,0.14,0.08];
  return shape.map((v, h) => ({
    label: h % 6 === 0 ? String(h).padStart(2, '0') : '',
    input: +(v * 0.11).toFixed(3),
    output: +(v * 0.058).toFixed(3),
  }));
})();

// 30 daily buckets — weekly rhythm (weekends lower), label every 5 days
const MONTH = (() => {
  const arr = [];
  for (let d = 1; d <= 30; d++) {
    const dow = (d - 1) % 7;            // 0..6
    const weekend = dow === 5 || dow === 6;
    const base = weekend ? 0.42 : 0.92;
    const wobble = 0.78 + 0.44 * Math.abs(Math.sin(d * 1.7));
    const v = base * wobble;
    arr.push({
      label: (d === 1 || d % 5 === 0) ? String(d) : '',
      input: +(v * 0.62).toFixed(3),
      output: +(v * 0.32).toFixed(3),
    });
  }
  return arr;
})();

// ── Model distribution (by total tokens, M) ────────────────────
const MODELS = [
  { name: 'Claude Sonnet 4.5', vendor: 'Anthropic', tokens: 5.82, cost: 18.40, color: '#1f9d63' },
  { name: 'Claude Opus 4.1',   vendor: 'Anthropic', tokens: 3.07, cost: 19.10, color: '#34c27e' },
  { name: 'GPT-5',             vendor: 'OpenAI',     tokens: 1.94, cost: 6.20,  color: '#6ad0a0' },
  { name: 'Gemini 2.5 Pro',    vendor: 'Google',     tokens: 0.91, cost: 2.40,  color: '#a7e3c5' },
  { name: 'Llama 3.3 70B',     vendor: 'Local',      tokens: 0.66, cost: 0.00,  color: '#4b5a52' },
];

// ── Headline metrics (this week) ───────────────────────────────
const METRICS = {
  totalTokens: 12.40,   // M
  inputTokens: 8.13,    // M
  outputTokens: 4.27,   // M
  cost: 46.10,          // $
  mcpCalls: 1284,
  skillCalls: 356,
  requests: 2847,
  sessions: 143,
  deltaTokens: +0.14,   // vs prev period
  deltaCost: -0.06,
};

// cost trend (last 7 periods, $)
const COST_TREND = [5.2, 7.8, 6.4, 9.1, 8.3, 3.1, 6.2];
// requests trend
const REQ_TREND = [288, 412, 360, 503, 451, 188, 645];

// ── helpers ────────────────────────────────────────────────────
function fmtTokens(m) {
  // m in millions
  if (m >= 1) return m.toFixed(2) + 'M';
  return Math.round(m * 1000) + 'K';
}
function fmtInt(n) { return n.toLocaleString('en-US'); }
function pct(part, whole) { return Math.round((part / whole) * 100); }

// money for tight spaces: keep cents when small, abbreviate when large
function fmtMoney(v) {
  if (v >= 100000) return '$' + Math.round(v / 1000) + 'K';
  if (v >= 10000) return '$' + (v / 1000).toFixed(1) + 'K';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Build an SVG path (smooth) for a series of y-values within w×h box.
function linePath(values, w, h, pad = 2) {
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const n = values.length;
  const px = (i) => pad + (i / (n - 1)) * (w - pad * 2);
  const py = (v) => pad + (1 - (v - min) / range) * (h - pad * 2);
  const pts = values.map((v, i) => [px(i), py(v)]);
  // catmull-rom -> bezier smoothing
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return { d, px, py, pts };
}

// ── Period-specific headline metrics ───────────────────────────
// Model token totals (week) sum to 12.40M == weekly total, so other
// periods just scale the model distribution by total ratio.
const WEEK_TOTAL = MODELS.reduce((s, m) => s + m.tokens, 0); // 12.40
const WEEK_COST = MODELS.reduce((s, m) => s + m.cost, 0);    // 46.10
const PERIODS = {
  'Day': {
    series: DAY,
    metrics: { totalTokens: 1.94, inputTokens: 1.27, outputTokens: 0.67, cost: 7.20,
      mcpCalls: 198, skillCalls: 54, requests: 441, sessions: 23, deltaTokens: -0.18, deltaCost: -0.12,
      servers: 9, skills: 12 },
    reqTrend: [12, 41, 58, 92, 74, 61, 38, 19],
    costTrend: [0.4, 1.1, 0.9, 1.6, 1.3, 0.8, 0.5, 0.6],
  },
  'Week': {
    series: WEEK,
    metrics: { ...METRICS, servers: 14, skills: 22 },
    reqTrend: REQ_TREND,
    costTrend: COST_TREND,
  },
  'Month': {
    series: MONTH,
    metrics: { totalTokens: 27.50, inputTokens: 18.10, outputTokens: 9.40, cost: 101.30,
      mcpCalls: 5230, skillCalls: 1442, requests: 11680, sessions: 602, deltaTokens: +0.11, deltaCost: +0.09,
      servers: 18, skills: 28 },
    reqTrend: [1880, 2410, 2050, 3340],
    costTrend: [22.4, 28.1, 21.6, 29.2],
  },
};

// scale the model distribution to a period's totals
// (tokens by token-total, cost by cost-total — so each sums to its metric)
function modelsFor(periodKey) {
  const mm = PERIODS[periodKey].metrics;
  const rt = mm.totalTokens / WEEK_TOTAL;
  const rc = mm.cost / WEEK_COST;
  return MODELS.map(m => ({ ...m, tokens: +(m.tokens * rt).toFixed(2), cost: +(m.cost * rc).toFixed(2) }));
}

// ── MCP servers & Skills breakdown (week baselines; scaled per period) ──
const MCP_SERVERS = [
  { name: 'filesystem', count: 312 },
  { name: 'github', count: 268 },
  { name: 'memory', count: 198 },
  { name: 'fetch', count: 156 },
  { name: 'postgres', count: 142 },
  { name: 'puppeteer', count: 98 },
  { name: 'slack', count: 64 },
  { name: 'brave-search', count: 46 },
];
const SKILLS = [
  { name: 'pdf-reader', count: 92 },
  { name: 'web-search', count: 78 },
  { name: 'deck-builder', count: 61 },
  { name: 'code-runner', count: 54 },
  { name: 'image-gen', count: 38 },
  { name: 'data-viz', count: 33 },
];
// scale a named-count list to a period total, drop zeros, sort desc
function callsFor(list, periodTotal) {
  const base = list.reduce((s, x) => s + x.count, 0);
  const r = periodTotal / base;
  return list.map(x => ({ ...x, count: Math.round(x.count * r) }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count);
}

// ── Half-year daily heatmap data (GitHub-contributions style) ──
// ~26 weeks, returns array of {date, tokens(M), level 0..4}, oldest→newest.
const YEAR_DAILY = (() => {
  const days = [];
  const today = new Date(2026, 5, 5);            // anchor: Jun 5 2026
  // start from the Sunday of the week 25 weeks ago
  const start = new Date(today);
  start.setDate(start.getDate() - 25 * 7 - today.getDay());
  for (let i = 0; ; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (d > today) break;
    const dow = d.getDay();
    const weekend = dow === 0 || dow === 6;
    // seasonal wave + weekly rhythm + noise; some idle days at 0
    const seasonal = 0.55 + 0.45 * Math.sin((i / 182) * Math.PI * 2 + 1);
    const noise = Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
    let v = (weekend ? 0.35 : 1) * seasonal * (0.4 + noise);
    if (noise < 0.12) v = 0;                       // idle days
    const tokens = +(v * 2.4).toFixed(2);          // up to ~2.4M/day
    days.push({ date: new Date(d), tokens });
  }
  // assign levels by quantile-ish thresholds
  const maxV = Math.max(...days.map(x => x.tokens));
  days.forEach(x => {
    const f = x.tokens / maxV;
    x.level = x.tokens === 0 ? 0 : f < 0.25 ? 1 : f < 0.5 ? 2 : f < 0.75 ? 3 : 4;
  });
  return days;
})();
const YEAR_TOTAL = +YEAR_DAILY.reduce((s, d) => s + d.tokens, 0).toFixed(1);
const YEAR_ACTIVE = YEAR_DAILY.filter(d => d.tokens > 0).length;

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

window.TD = {
  ACCENT, ACCENT_SOFT,
  DAY, WEEK, MONTH, MODELS, METRICS, COST_TREND, REQ_TREND,
  PERIODS, modelsFor, WEEK_TOTAL,
  MCP_SERVERS, SKILLS, callsFor,
  YEAR_DAILY, YEAR_TOTAL, YEAR_ACTIVE, fmtDate,
  fmtTokens, fmtInt, pct, fmtMoney, linePath,
};
