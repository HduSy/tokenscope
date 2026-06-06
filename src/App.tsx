import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Dashboard, PeriodReport, ModelStat, Theme, TH,
  fetchDashboard, fmtInt, fmtTokens, pct,
} from "./data";
import {
  TokenGlyph, Segmented, BarChart, Sparkline, CostDonut, BarList, Heatmap,
} from "./charts";

// Count up to `target`. Restarts from 0 whenever `resetKey` changes (popover
// open / period switch); on a live value change it eases from the current
// value to the new one instead of snapping back to 0.
function useCountUp(target: number, resetKey: string, duration = 850): number {
  const [val, setVal] = useState(0);
  const valRef = useRef(0);
  const keyRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const reset = keyRef.current !== resetKey;
    keyRef.current = resetKey;
    const from = reset ? 0 : valRef.current;
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const set = (v: number) => { valRef.current = v; setVal(v); };
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      set(from + (target - from) * ease(p));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [resetKey, target, duration]);
  return val;
}

function Delta({ v, theme }: { v: number; theme: Theme }) {
  const up = v >= 0;
  const col = up ? theme.accent : "#e0795f";
  return (
    <span style={{ font: `600 10px ${theme.mono}`, color: col, display: "inline-flex", alignItems: "center", gap: 2,
      padding: "1.5px 5px", borderRadius: 5, background: up ? "rgba(39,176,110,0.14)" : "rgba(224,121,95,0.16)" }}>
      {up ? "▲" : "▼"}{Math.abs(Math.round(v))}%
    </span>
  );
}

function ModelRow({ m, max, theme, total }: { m: ModelStat; max: number; theme: Theme; total: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0" }}>
      <span style={{ width: 7, height: 7, borderRadius: 2, background: m.color, flex: "0 0 auto" }} />
      <div style={{ minWidth: 0, flex: "0 0 118px" }}>
        <div style={{ font: `500 11.5px ${theme.ui}`, color: theme.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
      </div>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: theme.gridLine, overflow: "hidden" }}>
        <div style={{ width: `${(m.tokens / max) * 100}%`, height: "100%", background: m.color, borderRadius: 3 }} />
      </div>
      <span style={{ font: `500 10.5px ${theme.mono}`, color: theme.dim, flex: "0 0 auto", width: 42, textAlign: "right" }}>{fmtTokens(m.tokens)}</span>
      <span style={{ font: `600 10.5px ${theme.mono}`, color: theme.text, flex: "0 0 auto", width: 30, textAlign: "right" }}>{pct(m.tokens, total)}%</span>
    </div>
  );
}

function MiniStat({ label, value, sub, theme, accent, children }:
  { label: string; value: string; sub?: string; theme: Theme; accent?: string; children?: React.ReactNode }) {
  return (
    <div style={{ background: theme.gridLine, borderRadius: 9, padding: "9px 10px", minWidth: 0 }}>
      <div style={{ font: `500 9.5px ${theme.ui}`, color: theme.dim, letterSpacing: ".04em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 3, gap: 6 }}>
        <span style={{ font: `600 17px ${theme.mono}`, color: accent || theme.text, lineHeight: 1 }}>{value}</span>
        {children}
      </div>
      {sub && <div style={{ font: `500 9px ${theme.mono}`, color: theme.faint, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// Input/Output legend: full words by default, abbreviated to In/Out only
// when the row would otherwise overflow the available width.
function SplitLegend({ t, inputM, outputM, cachedPct }:
  { t: Theme; inputM: number; outputM: number; cachedPct: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const key = `${inputM}|${outputM}|${cachedPct}`;
  // reset to full labels whenever the numbers change, then re-measure
  useLayoutEffect(() => { setCompact(false); }, [key]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !compact && el.scrollWidth > el.clientWidth + 1) setCompact(true);
  });
  return (
    <div ref={ref} style={{
      display: "flex", alignItems: "center", gap: 14,
      font: `500 10px ${t.mono}`, color: t.dim, marginBottom: 14, whiteSpace: "nowrap", overflow: "hidden",
    }}>
      <span><span style={{ color: t.accent }}>●</span> {compact ? "In" : "Input"} {inputM.toFixed(2)}M</span>
      <span><span style={{ color: t.accentSoft }}>●</span> {compact ? "Out" : "Output"} {outputM.toFixed(2)}M</span>
      <span style={{ color: t.faint }}>{cachedPct}% cached</span>
    </div>
  );
}

const SectionRule = ({ t, m = "12px 0 10px" }: { t: Theme; m?: string }) => (
  <div style={{ height: 1, background: t.gridLine, margin: m }} />
);
const Label = ({ t, children }: { t: Theme; children: React.ReactNode }) => (
  <span style={{ font: `600 10px ${t.ui}`, color: t.dim, letterSpacing: ".05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{children}</span>
);

function ThemeToggle({ dark, theme, onToggle }: { dark: boolean; theme: Theme; onToggle: () => void }) {
  const t = theme;
  return (
    <button onClick={onToggle} title={dark ? "切换到浅色" : "切换到深色"} aria-label="toggle theme" style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 26, height: 26, borderRadius: 7, cursor: "pointer", padding: 0,
      background: t.segBg, border: `1px solid ${t.segBorder}`, color: t.dim,
    }}>
      {dark ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.dim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill={t.dim} stroke="none">
          <path d="M21 12.9A9 9 0 1 1 11.1 3a7.2 7.2 0 0 0 9.9 9.9z" />
        </svg>
      )}
    </button>
  );
}

function Panel({ dash, dark, onToggleTheme, openGen }: { dash: Dashboard; dark: boolean; onToggleTheme: () => void; openGen: number }) {
  const t = TH[dark ? "dark" : "light"];
  const [period, setPeriod] = useState<"Day" | "Week" | "Month">("Week");
  const P: PeriodReport = period === "Day" ? dash.day : period === "Month" ? dash.month : dash.week;
  const M = P.metrics;
  // animated Total tokens: counts up from 0 on each open / period switch
  const animTotal = useCountUp(M.totalTokens, `${period}:${openGen}`);
  const models = P.models;
  // Hide noise: 0% token-share rows, and $0 entries in the cost donut.
  const tokenModels = models.filter((m) => pct(m.tokens, M.totalTokens || 1) > 0);
  const costModels = models.filter((m) => m.cost > 0);
  // models that were used but have no LiteLLM pricing (cost unknown, not $0)
  const unpricedModels = models.filter((m) => !m.priced && m.tokens > 0);
  const maxM = Math.max(...tokenModels.map((m) => m.tokens), 1e-9);
  const trendSub = { Day: "today 24h", Week: "last 7 days", Month: "last 30 days" }[period];

  return (
    <div style={{
      width: "100%", height: "100vh", overflow: "hidden", boxSizing: "border-box",
      background: "transparent", padding: 0,
      fontFamily: t.ui,
    }}>
      <div className="om-scroll" style={{
        width: "100%", height: "100%", overflowY: "auto",
        borderRadius: 12, background: dark ? "#1f2226" : "#ffffff",
        border: `1px solid ${dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)"}`,
        padding: 0, color: t.text,
      }}>
        {/* sticky header — stays put while the body scrolls */}
        <div style={{
          position: "sticky", top: 0, zIndex: 10,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "15px 15px 12px",
          background: dark ? "#1f2226" : "#ffffff",
          borderBottom: `1px solid ${t.gridLine}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TokenGlyph color={t.accent} size={16} />
            <span style={{ font: `600 13px ${t.ui}`, color: t.text, letterSpacing: ".01em" }}>Tokenscope</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Segmented value={period} theme={t} onSelect={(v) => setPeriod(v as any)} />
            <ThemeToggle dark={dark} theme={t} onToggle={onToggleTheme} />
          </div>
        </div>
        {/* scrolling body */}
        <div style={{ padding: "14px 15px 15px" }}>
        {/* hero */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <div style={{ font: `500 10px ${t.ui}`, color: t.dim, letterSpacing: ".04em", textTransform: "uppercase" }}>Total tokens</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3 }}>
              <span style={{ font: `600 30px ${t.mono}`, color: t.text, letterSpacing: "-.01em" }}>{animTotal.toFixed(2)}<span style={{ font: `500 15px ${t.mono}`, color: t.dim, marginLeft: 2 }}>M</span></span>
              {Math.round(M.deltaTokens) !== 0 && <Delta v={M.deltaTokens} theme={t} />}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ font: `500 10px ${t.ui}`, color: t.dim }}>Est. cost</div>
            <div style={{ font: `600 18px ${t.mono}`, color: t.accent, marginTop: 2 }}>${M.cost.toFixed(2)}</div>
          </div>
        </div>
        {/* input(+cache) / output split — 2-colour; cache hits fold into input */}
        <div style={{ display: "flex", gap: 0, height: 7, borderRadius: 4, overflow: "hidden", marginBottom: 5 }}>
          <div style={{ flexGrow: Math.max(M.inputTokens + M.cacheTokens, 1e-6), flexBasis: 0, minWidth: 4, background: t.accent }} />
          <div style={{ flexGrow: Math.max(M.outputTokens, 1e-6), flexBasis: 0, minWidth: 4, background: t.accentSoft }} />
        </div>
        <SplitLegend t={t} inputM={M.inputTokens + M.cacheTokens} outputM={M.outputTokens} cachedPct={pct(M.cacheTokens, M.totalTokens)} />
        {/* bar chart */}
        <BarChart data={P.series} theme={t} height={84} />
        <SectionRule t={t} m="14px 0 10px" />
        {/* models */}
        <div style={{ marginBottom: 4 }}><Label t={t}>Tokens by model</Label></div>
        {tokenModels.length === 0 && <div style={{ font: `500 10.5px ${t.mono}`, color: t.faint, padding: "4px 0" }}>No usage in this period</div>}
        {tokenModels.map((m, i) => <ModelRow key={i} m={m} max={maxM} theme={t} total={M.totalTokens || 1} />)}
        <SectionRule t={t} m="10px 0 10px" />
        {/* cost donut */}
        <div style={{ marginBottom: 8 }}><Label t={t}>Cost by model</Label></div>
        {costModels.length > 0
          ? <CostDonut models={costModels} theme={t} size={100} thickness={15} />
          : <div style={{ font: `500 10.5px ${t.mono}`, color: t.faint }}>—</div>}
        {unpricedModels.length > 0 && (
          <div style={{ marginTop: 9, font: `500 9.5px ${t.mono}`, color: t.faint, lineHeight: 1.5 }}>
            {unpricedModels.length} 个模型暂无定价数据（成本未计入）：
            <span style={{ color: t.dim }}>{unpricedModels.map((m) => m.name).join("、")}</span>
          </div>
        )}
        <SectionRule t={t} m="12px 0 12px" />
        {/* footer stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <MiniStat label="Requests" value={fmtInt(M.requests)} sub={`${M.sessions} sessions`} theme={t}>
            <Sparkline values={P.reqTrend.length ? P.reqTrend : [0, 0]} theme={t} width={52} height={20} accent={t.accent} />
          </MiniStat>
          <MiniStat label="Cost trend" value={`$${M.cost.toFixed(2)}`} sub={trendSub} theme={t} accent={t.accent}>
            <Sparkline values={P.costTrend.length ? P.costTrend : [0, 0]} theme={t} width={52} height={20} accent={t.accent} />
          </MiniStat>
        </div>
        {/* MCP — shown whenever the user has installed MCP servers */}
        {M.servers > 0 && (
          <>
            <SectionRule t={t} />
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 }}>
              <Label t={t}>MCP calls</Label>
              <span style={{ font: `500 10px ${t.mono}`, color: t.faint, whiteSpace: "nowrap" }}><span style={{ color: t.text, fontWeight: 600 }}>{fmtInt(M.mcpCalls)}</span> · {M.servers} servers</span>
            </div>
            {P.mcp.length > 0
              ? <BarList items={P.mcp} theme={t} accent={t.accent} />
              : <div style={{ font: `500 10px ${t.mono}`, color: t.faint, padding: "2px 0" }}>No MCP calls in this period</div>}
          </>
        )}
        {/* Skill — shown whenever the user has installed skills */}
        {M.skills > 0 && (
          <>
            <SectionRule t={t} />
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 }}>
              <Label t={t}>Skill calls</Label>
              <span style={{ font: `500 10px ${t.mono}`, color: t.faint, whiteSpace: "nowrap" }}><span style={{ color: t.text, fontWeight: 600 }}>{fmtInt(M.skillCalls)}</span> · {M.skills} skills</span>
            </div>
            {P.skills.length > 0
              ? <BarList items={P.skills} theme={t} accent={t.accentSoft} />
              : <div style={{ font: `500 10px ${t.mono}`, color: t.faint, padding: "2px 0" }}>No skill calls in this period</div>}
          </>
        )}
        {/* heatmap */}
        <SectionRule t={t} />
        <div style={{ marginBottom: 9 }}><Label t={t}>Daily activity</Label></div>
        <Heatmap days={dash.heatmap} theme={t} accent={t.accent} />
        {/* footer note */}
        <div style={{ marginTop: 12, font: `500 8.5px ${t.mono}`, color: t.faint, textAlign: "center" }}>
          Est. cost via models.dev / LiteLLM · estimate
        </div>
        </div>{/* /scrolling body */}
      </div>
    </div>
  );
}

export default function App() {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openGen, setOpenGen] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("tokenscope-theme") : null;
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const dark = theme === "dark";
  const toggleTheme = () =>
    setTheme((p) => {
      const n = p === "dark" ? "light" : "dark";
      try { localStorage.setItem("tokenscope-theme", n); } catch {}
      return n;
    });

  useEffect(() => {
    // initial load (shows the Loading state only until the first data arrives)
    fetchDashboard().then(setDash).catch((e) => setErr(String(e)));

    const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (!inTauri) return;
    const unlisten: Array<() => void> = [];
    // live updates pushed from the background refresh thread — setDash swaps the
    // data in place (no Loading), so values update without any flicker.
    listen<Dashboard>("dashboard-updated", (e) => setDash(e.payload)).then((u) => unlisten.push(u));
    // refetch the instant the popover gains focus (i.e. is opened)
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          setOpenGen((g) => g + 1); // re-run the count-up on each open
          fetchDashboard().then(setDash).catch(() => {});
        }
      })
      .then((u) => unlisten.push(u));
    return () => unlisten.forEach((u) => u());
  }, []);

  // window is transparent; the rounded card paints its own background
  useEffect(() => {
    document.body.style.background = "transparent";
  }, [dark]);

  const t = TH[dark ? "dark" : "light"];
  if (err) {
    return <div style={{ padding: 20, font: `500 12px ${t.mono}`, color: "#e0795f" }}>加载失败：{err}</div>;
  }
  if (!dash) {
    return (
      <div style={{ height: "100vh", padding: 10, boxSizing: "border-box", background: "transparent" }}>
        <div style={{ height: "100%", borderRadius: 14, background: dark ? "#1f2226" : "#ffffff",
          display: "flex", alignItems: "center", justifyContent: "center",
          font: `500 12px ${t.mono}`, color: t.dim }}>Loading…</div>
      </div>
    );
  }
  return <Panel dash={dash} dark={dark} onToggleTheme={toggleTheme} openGen={openGen} />;
}
