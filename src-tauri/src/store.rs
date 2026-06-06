// Incremental event store.
//
// Ingestion (this file) is the only place that touches the JSONL logs. It
// parses each assistant message into a provider/config/price-independent
// RawEvent (just the facts), reads only newly-appended bytes of changed files
// (tracked by a per-file size/mtime/offset manifest), dedupes by message id,
// and persists everything to the cache dir. Aggregation (parser.rs) then works
// purely on these in-memory events — cheap, and recomputed per request because
// the Day/Week/Month windows are relative to "now".
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use walkdir::WalkDir;

#[derive(Serialize, Deserialize, Clone)]
pub struct RawEvent {
    pub ts_ms: i64,
    pub session: String,
    pub model: String, // raw model id (price lookup), normalized later for grouping
    pub in_tok: f64,
    pub cc: f64, // cache creation
    pub cr: f64, // cache read
    pub out_tok: f64,
    pub mcp: Vec<String>,    // all mcp__<server> names called (unfiltered)
    pub skills: Vec<String>, // all Skill input.skill ids called (unfiltered)
    pub id: String,          // message id (dedup)
}

#[derive(Serialize, Deserialize, Default)]
struct Manifest {
    // path -> (size, mtime_ms, byte offset already ingested)
    files: HashMap<String, (u64, i64, u64)>,
}

pub struct Store {
    pub events: Vec<RawEvent>,
    seen: HashSet<String>,
    manifest: Manifest,
}

fn projects_dir() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude").join("projects"))
}

fn cache_dir() -> Option<PathBuf> {
    let d = dirs::cache_dir()?.join("tokenscope");
    let _ = fs::create_dir_all(&d);
    Some(d)
}

impl Store {
    /// Load persisted events + offset manifest (empty on first run).
    pub fn load() -> Self {
        let mut events: Vec<RawEvent> = Vec::new();
        let mut manifest = Manifest::default();
        if let Some(dir) = cache_dir() {
            if let Ok(t) = fs::read_to_string(dir.join("events.json")) {
                if let Ok(v) = serde_json::from_str::<Vec<RawEvent>>(&t) {
                    events = v;
                }
            }
            if let Ok(t) = fs::read_to_string(dir.join("offsets.json")) {
                if let Ok(m) = serde_json::from_str::<Manifest>(&t) {
                    manifest = m;
                }
            }
        }
        let seen = events
            .iter()
            .filter(|e| !e.id.is_empty())
            .map(|e| e.id.clone())
            .collect();
        Store {
            events,
            seen,
            manifest,
        }
    }

    pub fn save(&self) {
        if let Some(dir) = cache_dir() {
            if let Ok(t) = serde_json::to_string(&self.events) {
                let _ = fs::write(dir.join("events.json"), t);
            }
            if let Ok(t) = serde_json::to_string(&self.manifest) {
                let _ = fs::write(dir.join("offsets.json"), t);
            }
        }
    }

    /// Incrementally read only the new bytes of new/changed JSONL files.
    /// Returns the number of newly-appended events.
    pub fn ingest(&mut self) -> usize {
        let before = self.events.len();
        let Some(root) = projects_dir() else {
            return 0;
        };
        for entry in WalkDir::new(&root)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|x| x == "jsonl").unwrap_or(false))
        {
            let path = entry.path();
            let key = path.to_string_lossy().to_string();
            let Ok(meta) = fs::metadata(path) else { continue };
            let size = meta.len();
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);

            let mut offset = match self.manifest.files.get(&key).copied() {
                Some((psize, pmtime, poff)) => {
                    if psize == size && pmtime == mtime_ms {
                        continue; // unchanged → skip
                    }
                    if size < poff {
                        0 // truncated / rewritten → re-read (dedup protects us)
                    } else {
                        poff
                    }
                }
                None => 0,
            };

            let Ok(mut f) = fs::File::open(path) else { continue };
            if f.seek(SeekFrom::Start(offset)).is_err() {
                continue;
            }
            let mut buf = Vec::new();
            if f.read_to_end(&mut buf).is_err() {
                continue;
            }
            // only process up to the last newline; leave a partial trailing line
            // (file still being written) for the next pass
            let process_until = match buf.iter().rposition(|&b| b == b'\n') {
                Some(i) => i + 1,
                None => 0,
            };
            for line in buf[..process_until].split(|&b| b == b'\n') {
                if line.is_empty() {
                    continue;
                }
                let Ok(s) = std::str::from_utf8(line) else { continue };
                if let Some(ev) = parse_line(s) {
                    if !ev.id.is_empty() && !self.seen.insert(ev.id.clone()) {
                        continue; // already counted
                    }
                    self.events.push(ev);
                }
            }
            offset += process_until as u64;
            self.manifest.files.insert(key, (size, mtime_ms, offset));
        }
        self.events.len() - before
    }
}

/// Parse one JSONL line into a RawEvent (assistant messages only).
fn parse_line(line: &str) -> Option<RawEvent> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let msg = v.get("message")?;
    let model = msg.get("model").and_then(|m| m.as_str()).unwrap_or("unknown");
    if model == "<synthetic>" {
        return None;
    }
    let ts = v.get("timestamp")?.as_str()?;
    let ts_ms = DateTime::parse_from_rfc3339(ts).ok()?.timestamp_millis();
    let session = v
        .get("sessionId")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    let id = msg
        .get("id")
        .and_then(|i| i.as_str())
        .unwrap_or("")
        .to_string();

    let usage = msg.get("usage");
    let g = |k: &str| -> f64 {
        usage
            .and_then(|u| u.get(k))
            .and_then(|x| x.as_f64())
            .unwrap_or(0.0)
    };

    let mut mcp = Vec::new();
    let mut skills = Vec::new();
    if let Some(content) = msg.get("content").and_then(|c| c.as_array()) {
        for block in content {
            if block.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
                continue;
            }
            let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
            if let Some(rest) = name.strip_prefix("mcp__") {
                mcp.push(rest.split("__").next().unwrap_or("").to_string());
            } else if name == "Skill" {
                if let Some(sk) = block
                    .get("input")
                    .and_then(|i| i.get("skill"))
                    .and_then(|s| s.as_str())
                {
                    if !sk.is_empty() {
                        skills.push(sk.to_string());
                    }
                }
            }
        }
    }

    Some(RawEvent {
        ts_ms,
        session,
        model: model.to_string(),
        in_tok: g("input_tokens"),
        cc: g("cache_creation_input_tokens"),
        cr: g("cache_read_input_tokens"),
        out_tok: g("output_tokens"),
        mcp,
        skills,
        id,
    })
}
