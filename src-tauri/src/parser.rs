// Parse ~/.claude/projects/**/*.jsonl, dedupe assistant messages by id,
// classify tool calls (user-installed MCP / Skill only), and aggregate
// into Day / Week / Month reports + a daily heatmap.
use crate::config::UserConfig;
use crate::model::*;
use crate::pricing::Pricing;
use chrono::{DateTime, Datelike, Duration, Local, Timelike};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use walkdir::WalkDir;

// One assistant API response, normalized.
struct Event {
    ts: DateTime<Local>,
    session: String,
    model: String,
    input: f64,  // raw tokens, uncached new input only
    cache: f64,  // raw tokens, cache creation + read
    output: f64, // raw tokens
    cost: f64,   // USD (differentiated by token type), 0 if unknown model
    priced: bool, // whether LiteLLM had pricing for this model
    mcp: Vec<String>,   // user-installed server names called in this msg
    skills: Vec<String>, // user-installed skill names called in this msg
}

// Top-5 models keep the green/slate scheme; everything beyond is uniform gray.
const PALETTE: &[&str] = &["#1f9d63", "#34c27e", "#6ad0a0", "#a7e3c5", "#4b5a52"];
const OVERFLOW_GRAY: &str = "#79817b";

fn projects_dir() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude").join("projects"))
}

/// Strip a trailing "-YYYYMMDD" date suffix so dated releases merge into
/// their base model (e.g. "claude-haiku-4-5-20251001" → "claude-haiku-4-5").
fn normalize_model(name: &str) -> String {
    if let Some(idx) = name.rfind('-') {
        let suffix = &name[idx + 1..];
        if suffix.len() == 8 && suffix.chars().all(|c| c.is_ascii_digit()) {
            return name[..idx].to_string();
        }
    }
    name.to_string()
}

fn vendor_of(model: &str) -> &'static str {
    let m = model.to_lowercase();
    if m.contains("claude") {
        "Anthropic"
    } else if m.contains("gpt") || m.contains("o1") || m.contains("o3") {
        "OpenAI"
    } else if m.contains("gemini") {
        "Google"
    } else if m.contains("llama") {
        "Local"
    } else if m.contains("glm") {
        "Zhipu"
    } else if m.contains("deepseek") {
        "DeepSeek"
    } else {
        "Other"
    }
}

pub fn build_dashboard() -> Dashboard {
    let cfg = UserConfig::load();
    let pricing = Pricing::load();
    let events = collect_events(&cfg, &pricing);

    let now = Local::now();
    let today = now.date_naive();

    let mut day = report_day(&events, now);
    let mut week = report_range(&events, now, 7, "Week");
    let mut month = report_range(&events, now, 30, "Month");
    let heatmap = build_heatmap(&events, today);

    // "servers"/"skills" = how many the user has *installed* (global, constant
    // across periods), not how many were called in the window.
    let installed_servers = cfg.mcp_servers.len() as u64;
    let installed_skills = cfg.skills.len() as u64;
    for r in [&mut day, &mut week, &mut month] {
        r.metrics.servers = installed_servers;
        r.metrics.skills = installed_skills;
    }

    // today's displayed tokens (M) for the tray
    let today_tokens: f64 = events
        .iter()
        .filter(|e| e.ts.date_naive() == today)
        .map(|e| (e.input + e.cache + e.output) / 1e6)
        .sum();

    Dashboard {
        day,
        week,
        month,
        heatmap,
        today_tokens,
        generated_at: now.to_rfc3339(),
    }
}

fn collect_events(cfg: &UserConfig, pricing: &Pricing) -> Vec<Event> {
    let mut events = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let Some(root) = projects_dir() else {
        return events;
    };

    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "jsonl").unwrap_or(false))
    {
        let Ok(file) = std::fs::File::open(entry.path()) else {
            continue;
        };
        let reader = BufReader::new(file);
        for line in reader.lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
                continue;
            }
            let msg = match v.get("message") {
                Some(m) => m,
                None => continue,
            };

            // dedupe by message.id (streaming/retries duplicate usage)
            if let Some(id) = msg.get("id").and_then(|i| i.as_str()) {
                if !seen.insert(id.to_string()) {
                    continue;
                }
            }

            let ts = v
                .get("timestamp")
                .and_then(|t| t.as_str())
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Local));
            let Some(ts) = ts else { continue };

            let session = v
                .get("sessionId")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            let raw_model = msg.get("model").and_then(|m| m.as_str()).unwrap_or("unknown");
            if raw_model == "<synthetic>" {
                continue;
            }
            // normalize for grouping; price lookup uses the raw model id.
            let model = normalize_model(raw_model);

            let usage = msg.get("usage");
            let g = |k: &str| -> f64 {
                usage
                    .and_then(|u| u.get(k))
                    .and_then(|x| x.as_f64())
                    .unwrap_or(0.0)
            };
            let in_tok = g("input_tokens");
            let out_tok = g("output_tokens");
            let cc = g("cache_creation_input_tokens");
            let cr = g("cache_read_input_tokens");

            // split: uncached input · cache (creation+read) · output
            let input = in_tok;
            let cache = cc + cr;
            let output = out_tok;
            let cost_opt = pricing
                .cost(raw_model, in_tok, out_tok, cc, cr)
                .or_else(|| pricing.cost(&model, in_tok, out_tok, cc, cr));
            let priced = cost_opt.is_some();
            let cost = cost_opt.unwrap_or(0.0);

            // classify tool_use blocks
            let mut mcp = Vec::new();
            let mut skills = Vec::new();
            if let Some(content) = msg.get("content").and_then(|c| c.as_array()) {
                for block in content {
                    if block.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
                        continue;
                    }
                    let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    if let Some(rest) = name.strip_prefix("mcp__") {
                        let server = rest.split("__").next().unwrap_or("");
                        if cfg.is_user_mcp(server) {
                            mcp.push(server.to_string());
                        }
                    } else if name == "Skill" {
                        let sk = block
                            .get("input")
                            .and_then(|i| i.get("skill"))
                            .and_then(|s| s.as_str())
                            .unwrap_or("");
                        if !sk.is_empty() && cfg.is_user_skill(sk) {
                            let key = sk.rsplit(':').next().unwrap_or(sk).to_string();
                            skills.push(key);
                        }
                    }
                }
            }

            events.push(Event {
                ts,
                session,
                model,
                input,
                cache,
                output,
                cost,
                priced,
                mcp,
                skills,
            });
        }
    }
    events
}

// ── aggregation helpers ────────────────────────────────────────────
#[derive(Default)]
struct Agg {
    input: f64,
    cache: f64,
    output: f64,
    cost: f64,
    requests: u64,
    sessions: HashSet<String>,
    mcp_calls: u64,
    skill_calls: u64,
    model_tok: HashMap<String, f64>,
    model_cost: HashMap<String, f64>,
    model_priced: HashMap<String, bool>,
    mcp_counts: HashMap<String, u64>,
    skill_counts: HashMap<String, u64>,
}

impl Agg {
    fn add(&mut self, e: &Event) {
        self.input += e.input;
        self.cache += e.cache;
        self.output += e.output;
        self.cost += e.cost;
        self.requests += 1;
        if !e.session.is_empty() {
            self.sessions.insert(e.session.clone());
        }
        // model totals keep all token types so shares sum to Total tokens
        *self.model_tok.entry(e.model.clone()).or_default() += e.input + e.cache + e.output;
        *self.model_cost.entry(e.model.clone()).or_default() += e.cost;
        // a model is "priced" if any of its messages had a known price
        *self.model_priced.entry(e.model.clone()).or_default() |= e.priced;
        for s in &e.mcp {
            self.mcp_calls += 1;
            *self.mcp_counts.entry(s.clone()).or_default() += 1;
        }
        for s in &e.skills {
            self.skill_calls += 1;
            *self.skill_counts.entry(s.clone()).or_default() += 1;
        }
    }

    fn models(&self) -> Vec<ModelStat> {
        let mut v: Vec<(String, f64, f64)> = self
            .model_tok
            .iter()
            .map(|(k, t)| (k.clone(), *t, *self.model_cost.get(k).unwrap_or(&0.0)))
            .collect();
        v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        v.into_iter()
            .enumerate()
            .map(|(i, (name, tok, cost))| {
                let priced = *self.model_priced.get(&name).unwrap_or(&false);
                ModelStat {
                    vendor: vendor_of(&name).to_string(),
                    tokens: (tok / 1e6 * 100.0).round() / 100.0,
                    cost: (cost * 100.0).round() / 100.0,
                    color: if i < PALETTE.len() { PALETTE[i] } else { OVERFLOW_GRAY }.to_string(),
                    priced,
                    name,
                }
            })
            .collect()
    }

    fn named(counts: &HashMap<String, u64>) -> Vec<NamedCount> {
        let mut v: Vec<NamedCount> = counts
            .iter()
            .map(|(k, c)| NamedCount {
                name: k.clone(),
                count: *c,
            })
            .collect();
        v.sort_by(|a, b| b.count.cmp(&a.count));
        v
    }

    fn metrics(&self, delta_tokens: f64, delta_cost: f64) -> Metrics {
        Metrics {
            total_tokens: ((self.input + self.cache + self.output) / 1e6 * 100.0).round() / 100.0,
            input_tokens: (self.input / 1e6 * 100.0).round() / 100.0,
            cache_tokens: (self.cache / 1e6 * 100.0).round() / 100.0,
            output_tokens: (self.output / 1e6 * 100.0).round() / 100.0,
            cost: (self.cost * 100.0).round() / 100.0,
            mcp_calls: self.mcp_calls,
            skill_calls: self.skill_calls,
            requests: self.requests,
            sessions: self.sessions.len() as u64,
            delta_tokens,
            delta_cost,
            servers: self.mcp_counts.len() as u64,
            skills: self.skill_counts.len() as u64,
        }
    }
}

fn pct_delta(cur: f64, prev: f64) -> f64 {
    if prev <= 0.0 {
        return 0.0;
    }
    ((cur - prev) / prev * 100.0).round() / 100.0
}

// ── Day report: today, 24 hourly buckets ───────────────────────────
fn report_day(events: &[Event], now: DateTime<Local>) -> PeriodReport {
    let today = now.date_naive();
    let yesterday = today - Duration::days(1);
    let mut agg = Agg::default();
    let mut prev = Agg::default();
    let mut buckets = vec![(0.0f64, 0.0f64, 0.0f64); 24]; // (input, cache, output) M
    let mut req_b = vec![0.0f64; 24];
    let mut cost_b = vec![0.0f64; 24];

    for e in events {
        let d = e.ts.date_naive();
        if d == today {
            agg.add(e);
            let h = e.ts.hour() as usize;
            buckets[h].0 += e.input / 1e6;
            buckets[h].1 += e.cache / 1e6;
            buckets[h].2 += e.output / 1e6;
            req_b[h] += 1.0;
            cost_b[h] += e.cost;
        } else if d == yesterday {
            prev.add(e);
        }
    }

    let series = (0..24)
        .map(|h| SeriesPoint {
            label: if h % 6 == 0 {
                format!("{:02}", h)
            } else {
                String::new()
            },
            input: buckets[h].0,
            cache: buckets[h].1,
            output: buckets[h].2,
        })
        .collect();

    PeriodReport {
        metrics: agg.metrics(
            pct_delta(
                agg.input + agg.cache + agg.output,
                prev.input + prev.cache + prev.output,
            ),
            pct_delta(agg.cost, prev.cost),
        ),
        series,
        models: agg.models(),
        mcp: Agg::named(&agg.mcp_counts),
        skills: Agg::named(&agg.skill_counts),
        req_trend: req_b,
        cost_trend: cost_b,
    }
}

// ── Week/Month report: last N days, daily buckets ───────────────────
fn report_range(events: &[Event], now: DateTime<Local>, days: i64, kind: &str) -> PeriodReport {
    let today = now.date_naive();
    let start = today - Duration::days(days - 1);
    let prev_start = start - Duration::days(days);

    let mut agg = Agg::default();
    let mut prev = Agg::default();
    let mut buckets = vec![(0.0f64, 0.0f64, 0.0f64); days as usize];
    let mut req_b = vec![0.0f64; days as usize];
    let mut cost_b = vec![0.0f64; days as usize];

    for e in events {
        let d = e.ts.date_naive();
        if d >= start && d <= today {
            agg.add(e);
            let idx = (d - start).num_days() as usize;
            if idx < buckets.len() {
                buckets[idx].0 += e.input / 1e6;
                buckets[idx].1 += e.cache / 1e6;
                buckets[idx].2 += e.output / 1e6;
                req_b[idx] += 1.0;
                cost_b[idx] += e.cost;
            }
        } else if d >= prev_start && d < start {
            prev.add(e);
        }
    }

    let weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let series = (0..days as usize)
        .map(|i| {
            let date = start + Duration::days(i as i64);
            let label = if kind == "Week" {
                weekday[date.weekday().num_days_from_monday() as usize].to_string()
            } else {
                let dn = date.day();
                if i == 0 || dn % 5 == 0 {
                    dn.to_string()
                } else {
                    String::new()
                }
            };
            SeriesPoint {
                label,
                input: buckets[i].0,
                cache: buckets[i].1,
                output: buckets[i].2,
            }
        })
        .collect();

    PeriodReport {
        metrics: agg.metrics(
            pct_delta(
                agg.input + agg.cache + agg.output,
                prev.input + prev.cache + prev.output,
            ),
            pct_delta(agg.cost, prev.cost),
        ),
        series,
        models: agg.models(),
        mcp: Agg::named(&agg.mcp_counts),
        skills: Agg::named(&agg.skill_counts),
        req_trend: req_b,
        cost_trend: cost_b,
    }
}

// ── Heatmap: last ~26 weeks daily totals ────────────────────────────
fn build_heatmap(events: &[Event], today: chrono::NaiveDate) -> Vec<HeatDay> {
    let start = today - Duration::days(25 * 7 + today.weekday().num_days_from_sunday() as i64);
    let mut by_day: HashMap<chrono::NaiveDate, f64> = HashMap::new();
    for e in events {
        let d = e.ts.date_naive();
        if d >= start && d <= today {
            *by_day.entry(d).or_default() += (e.input + e.cache + e.output) / 1e6;
        }
    }
    let mut days = Vec::new();
    let mut d = start;
    let mut maxv = 0.0f64;
    while d <= today {
        let t = *by_day.get(&d).unwrap_or(&0.0);
        maxv = maxv.max(t);
        days.push((d, t));
        d += Duration::days(1);
    }
    days.into_iter()
        .map(|(date, tokens)| {
            let f = if maxv > 0.0 { tokens / maxv } else { 0.0 };
            let level = if tokens == 0.0 {
                0
            } else if f < 0.25 {
                1
            } else if f < 0.5 {
                2
            } else if f < 0.75 {
                3
            } else {
                4
            };
            HeatDay {
                date: date.format("%Y-%m-%d").to_string(),
                tokens: (tokens * 100.0).round() / 100.0,
                level,
            }
        })
        .collect()
}
