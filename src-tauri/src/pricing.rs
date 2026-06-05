// Token pricing. Primary source: models.dev (bare model names, matches Claude
// CLI logs). Fallback: LiteLLM. Final backstop: a tiny built-in snapshot.
//
// Matching is layered: exact id → normalized id (strip provider path prefix +
// unify the ".'↔'p" version separator, e.g. "glm-5.1" ⇄ "glm-5p1").
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

const MODELSDEV_URL: &str = "https://models.dev/api.json";
const LITELLM_URL: &str =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60); // 24h

#[derive(Clone, Default)]
pub struct ModelPrice {
    pub input: f64,        // per-token USD
    pub output: f64,       // per-token USD
    pub cache_create: f64, // per-token USD
    pub cache_read: f64,   // per-token USD
}

impl ModelPrice {
    fn is_zero(&self) -> bool {
        self.input == 0.0 && self.output == 0.0 && self.cache_create == 0.0 && self.cache_read == 0.0
    }
}

pub struct Pricing {
    exact: HashMap<String, ModelPrice>,
    norm: HashMap<String, ModelPrice>,
}

/// Strip provider path prefix (after last '/') and unify version separators
/// so "z-ai/glm-5.1", "glm-5p1" and "glm-5.1" all collapse to one key.
fn normalize_key(s: &str) -> String {
    let base = s.rsplit('/').next().unwrap_or(s);
    base.to_lowercase().replace('.', "p")
}

fn bare(s: &str) -> &str {
    s.rsplit('/').next().unwrap_or(s)
}

fn cache_dir() -> Option<PathBuf> {
    let dir = dirs::cache_dir()?.join("tokenscope");
    let _ = fs::create_dir_all(&dir);
    Some(dir)
}

/// Read a fresh (<24h) cache for `name`, else fetch `url` & cache it, else fall
/// back to any stale cache. Returns the raw JSON text.
fn fetch_cached(name: &str, url: &str) -> Option<String> {
    let path = cache_dir()?.join(format!("{name}.json"));
    if let Ok(meta) = fs::metadata(&path) {
        let fresh = meta
            .modified()
            .ok()
            .and_then(|m| SystemTime::now().duration_since(m).ok())
            .map(|age| age < MAX_AGE)
            .unwrap_or(false);
        if fresh {
            if let Ok(t) = fs::read_to_string(&path) {
                return Some(t);
            }
        }
    }
    // fetch fresh
    if let Ok(resp) = ureq::get(url).timeout(Duration::from_secs(10)).call() {
        if let Ok(text) = resp.into_string() {
            if text.trim_start().starts_with('{') {
                let _ = fs::write(&path, &text);
                return Some(text);
            }
        }
    }
    // stale cache as last resort
    fs::read_to_string(&path).ok()
}

impl Pricing {
    pub fn load() -> Self {
        let mut p = Pricing {
            exact: HashMap::new(),
            norm: HashMap::new(),
        };
        // 1. models.dev — primary (inserted first, so it wins on conflict)
        if let Some(text) = fetch_cached("modelsdev", MODELSDEV_URL) {
            p.ingest_modelsdev(&text);
        }
        // 2. LiteLLM — fills gaps models.dev doesn't cover
        if let Some(text) = fetch_cached("litellm", LITELLM_URL) {
            p.ingest_litellm(&text);
        }
        // 3. built-in backstop (offline first run)
        p.ingest_builtin();
        p
    }

    fn insert(&mut self, id: &str, price: ModelPrice) {
        if price.is_zero() {
            return;
        }
        self.exact.entry(id.to_string()).or_insert_with(|| price.clone());
        self.exact.entry(bare(id).to_string()).or_insert_with(|| price.clone());
        self.norm.entry(normalize_key(id)).or_insert(price);
    }

    // models.dev: { provider: { models: { id: { cost: {input,output,cache_read,cache_write} } } } }
    // cost is per-1M tokens → divide by 1e6 for per-token.
    fn ingest_modelsdev(&mut self, text: &str) {
        let Ok(json) = serde_json::from_str::<serde_json::Value>(text) else { return };
        let Some(root) = json.as_object() else { return };
        // gather (id, price); bare ids (no '/') first so official-vendor prices win
        let mut entries: Vec<(String, ModelPrice)> = Vec::new();
        for prov in root.values() {
            let Some(models) = prov.get("models").and_then(|m| m.as_object()) else { continue };
            for (id, m) in models {
                let Some(c) = m.get("cost").and_then(|c| c.as_object()) else { continue };
                let g = |k: &str| c.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
                let price = ModelPrice {
                    input: g("input") / 1e6,
                    output: g("output") / 1e6,
                    cache_create: g("cache_write") / 1e6,
                    cache_read: g("cache_read") / 1e6,
                };
                entries.push((id.clone(), price));
            }
        }
        entries.sort_by_key(|(id, _)| id.contains('/')); // false(0)=bare first
        for (id, price) in entries {
            self.insert(&id, price);
        }
    }

    // LiteLLM: { key: { input_cost_per_token, output_cost_per_token, ... } } — already per-token.
    fn ingest_litellm(&mut self, text: &str) {
        let Ok(json) = serde_json::from_str::<serde_json::Value>(text) else { return };
        let Some(root) = json.as_object() else { return };
        let mut entries: Vec<(String, ModelPrice)> = Vec::new();
        for (id, m) in root {
            let Some(o) = m.as_object() else { continue };
            let g = |k: &str| o.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let price = ModelPrice {
                input: g("input_cost_per_token"),
                output: g("output_cost_per_token"),
                cache_create: g("cache_creation_input_token_cost"),
                cache_read: g("cache_read_input_token_cost"),
            };
            entries.push((id.clone(), price));
        }
        entries.sort_by_key(|(id, _)| id.contains('/'));
        for (id, price) in entries {
            self.insert(&id, price);
        }
    }

    fn ingest_builtin(&mut self) {
        let mk = |i: f64, o: f64, cc: f64, cr: f64| ModelPrice {
            input: i,
            output: o,
            cache_create: cc,
            cache_read: cr,
        };
        let b: &[(&str, ModelPrice)] = &[
            ("claude-opus-4-7", mk(5e-6, 25e-6, 6.25e-6, 0.5e-6)),
            ("claude-opus-4-8", mk(5e-6, 25e-6, 6.25e-6, 0.5e-6)),
            ("claude-sonnet-4-5", mk(3e-6, 15e-6, 3.75e-6, 0.3e-6)),
            ("claude-sonnet-4-6", mk(3e-6, 15e-6, 3.75e-6, 0.3e-6)),
            ("claude-haiku-4-5", mk(1e-6, 5e-6, 1.25e-6, 0.1e-6)),
        ];
        for (id, price) in b {
            self.insert(id, price.clone());
        }
    }

    fn lookup(&self, model: &str) -> Option<&ModelPrice> {
        if let Some(p) = self.exact.get(model) {
            return Some(p);
        }
        self.norm.get(&normalize_key(model))
    }

    /// Exact-or-normalized cost in USD. None = no pricing data for this model.
    pub fn cost(
        &self,
        model: &str,
        input: f64,
        output: f64,
        cache_create: f64,
        cache_read: f64,
    ) -> Option<f64> {
        let p = self.lookup(model)?;
        Some(
            input * p.input
                + output * p.output
                + cache_create * p.cache_create
                + cache_read * p.cache_read,
        )
    }

    #[allow(dead_code)]
    pub fn known(&self, model: &str) -> bool {
        self.lookup(model).is_some()
    }
}
