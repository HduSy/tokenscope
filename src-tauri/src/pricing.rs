// Token pricing. Primary source: models.dev (bare model names, matches Claude
// CLI logs). Fallback: LiteLLM. Final backstop: a tiny built-in snapshot.
//
// Matching is layered: exact id → normalized id (strip provider path prefix +
// unify the ".'↔'p" version separator, e.g. "glm-5.1" ⇄ "glm-5p1").
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, SystemTime};

// Process-wide memoized price table. Loaded once off the main thread (see
// reload_shared) and refreshed every 24h, so build_dashboard — which holds
// BUILD_LOCK — only ever does a cheap Arc clone, never JSON parsing or network.
static PRICING: OnceLock<RwLock<Arc<Pricing>>> = OnceLock::new();

const MODELSDEV_URL: &str = "https://models.dev/api.json";
const LITELLM_URL: &str =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60); // 24h
// Bundled LiteLLM price table snapshot — offline fallback so a first launch
// with no network (and no prior cache) still prices the common third-party
// models, not just the few hardcoded in `ingest_builtin`. Live sources, when
// reachable, are ingested first and win.
const LITELLM_SNAPSHOT: &str = include_str!("../snapshots/litellm.json");

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

/// Whether `provider` is `id`'s first-party vendor, as opposed to a reseller,
/// gateway, or cloud that re-lists the same model (often with a markup, or with
/// cache-token pricing omitted). Lets the authoritative price win regardless of
/// the order models.dev happens to iterate its providers in. Unknown vendors
/// return false and fall back to the completeness/bare-id ordering.
///
/// Vendors with both an international and a China provider key list both;
/// subscription-plan keys (`*-coding-plan`, `*-token-plan`) are deliberately
/// excluded — plan rates aren't the pay-as-you-go API price. When both keys
/// carry the same bare id, the stable sort keeps models.dev's key order, so the
/// alphabetically-first (international, USD) entry wins the tie.
fn is_first_party(provider: &str, id: &str) -> bool {
    let l = id.to_lowercase();
    let vendors: &[&str] = if l.contains("claude") {
        &["anthropic"]
    } else if l.contains("gpt") || l.starts_with("o1") || l.starts_with("o3") {
        &["openai"]
    } else if l.contains("gemini") {
        &["google"]
    } else if l.contains("deepseek") {
        &["deepseek"]
    } else if l.contains("grok") {
        &["xai"]
    } else if l.contains("glm") {
        &["zai", "zhipuai"]
    } else if l.contains("qwen") {
        &["alibaba", "alibaba-cn"]
    } else if l.contains("kimi") {
        &["moonshotai", "moonshotai-cn"]
    } else if l.contains("minimax") {
        &["minimax", "minimax-cn"]
    } else {
        return false;
    };
    vendors.contains(&provider)
}

fn cache_dir() -> Option<PathBuf> {
    let dir = dirs::cache_dir()?.join("tokenscope");
    let _ = fs::create_dir_all(&dir);
    Some(dir)
}

/// A models.dev payload: at least one provider with a non-empty `models` map.
fn valid_modelsdev(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|v| {
            v.as_object().map(|root| {
                root.values().any(|p| {
                    p.get("models")
                        .and_then(|m| m.as_object())
                        .map(|m| !m.is_empty())
                        .unwrap_or(false)
                })
            })
        })
        .unwrap_or(false)
}

/// A LiteLLM payload: at least one entry carrying a per-token cost field.
fn valid_litellm(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|v| {
            v.as_object().map(|root| {
                root.values().filter_map(|m| m.as_object()).any(|m| {
                    m.contains_key("input_cost_per_token")
                        || m.contains_key("output_cost_per_token")
                })
            })
        })
        .unwrap_or(false)
}

/// Read a fresh (<24h) cache for `name`, else fetch `url` & cache it, else fall
/// back to any stale cache. Returns the raw JSON text. `valid` gates what gets
/// written to the cache: a 200 carrying a JSON error envelope (CDN/proxy/rate
/// limit) would otherwise poison the cache for 24h with zero usable prices, so
/// we only persist a body that actually parses as a price table — and keep the
/// previous good cache otherwise.
fn fetch_cached(name: &str, url: &str, valid: impl Fn(&str) -> bool) -> Option<String> {
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
    // fetch fresh — only overwrite the cache if the body validates as a table
    if let Ok(resp) = ureq::get(url).timeout(Duration::from_secs(10)).call() {
        if let Ok(text) = resp.into_string() {
            if valid(&text) {
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
        if let Some(text) = fetch_cached("modelsdev", MODELSDEV_URL, valid_modelsdev) {
            p.ingest_modelsdev(&text);
        }
        // 2. LiteLLM — fills gaps models.dev doesn't cover
        if let Some(text) = fetch_cached("litellm", LITELLM_URL, valid_litellm) {
            p.ingest_litellm(&text);
        }
        // 3. bundled LiteLLM snapshot — offline fallback for anything the live
        //    sources didn't supply (only fills gaps; live prices already won).
        p.ingest_litellm(LITELLM_SNAPSHOT);
        // 4. built-in backstop (a handful of core models, last resort)
        p.ingest_builtin();
        p
    }

    /// Just the built-in snapshot — no disk, no network. Returned by `shared()`
    /// before the background loader has run, so the common Claude models still
    /// price during the first moments after launch.
    fn builtin_only() -> Self {
        let mut p = Pricing {
            exact: HashMap::new(),
            norm: HashMap::new(),
        };
        p.ingest_builtin();
        p
    }

    /// The process-wide memoized price table (cheap Arc clone). Never blocks on
    /// disk/network — until `reload_shared` has populated the cell it returns the
    /// built-in snapshot, so callers holding BUILD_LOCK are never stalled.
    pub fn shared() -> Arc<Pricing> {
        if let Some(lock) = PRICING.get() {
            if let Ok(g) = lock.read() {
                return g.clone();
            }
        }
        Arc::new(Pricing::builtin_only())
    }

    /// Load the full table (cache read + network on cold/stale cache) and swap it
    /// into the shared cell. MUST run on a background thread — never the main
    /// thread or a BUILD_LOCK holder — since the fetch can block up to ~20s.
    pub fn reload_shared() {
        let p = Arc::new(Pricing::load());
        match PRICING.get() {
            Some(lock) => {
                if let Ok(mut g) = lock.write() {
                    *g = p;
                }
            }
            None => {
                let _ = PRICING.set(RwLock::new(p));
            }
        }
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
        // gather (provider, id, price)
        let mut entries: Vec<(&str, String, ModelPrice)> = Vec::new();
        for (prov_name, prov) in root {
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
                entries.push((prov_name.as_str(), id.clone(), price));
            }
        }
        // insert() is first-writer-wins, so order entries best-first. models.dev
        // lists the same model under many providers (the first-party vendor plus
        // resellers / gateways / clouds), and some reseller entries omit
        // cache-token pricing entirely. Prefer, in order: the model's first-party
        // vendor; then entries that actually carry cache pricing (so a reseller
        // that omits it can't zero it out — Claude usage is mostly cache reads, so
        // dropping cache pricing undercounts cost several-fold); then bare ids over
        // "vendor/model" duplicates.
        entries.sort_by_key(|(prov, id, price)| {
            let has_cache = price.cache_create > 0.0 || price.cache_read > 0.0;
            (!is_first_party(prov, id), !has_cache, id.contains('/'))
        });
        for (_, id, price) in entries {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn empty() -> Pricing {
        Pricing {
            exact: HashMap::new(),
            norm: HashMap::new(),
        }
    }

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() <= b.abs() * 1e-9 + 1e-18
    }

    // A reseller that omits cache-token pricing and sorts before the first-party
    // vendor (models.dev iterates providers in key order) must not shadow the
    // official entry — otherwise cache tokens, which dominate Claude usage, are
    // priced at zero and cost is undercounted several-fold.
    #[test]
    fn first_party_entry_wins_over_cacheless_reseller() {
        let json = r#"{
            "abacus":    { "models": { "claude-x": { "cost": { "input": 5, "output": 25 } } } },
            "anthropic": { "models": { "claude-x": { "cost": { "input": 5, "output": 25, "cache_write": 6.25, "cache_read": 0.5 } } } }
        }"#;
        let mut p = empty();
        p.ingest_modelsdev(json);
        let price = p.lookup("claude-x").expect("claude-x should be priced");
        assert!(approx(price.input, 5e-6));
        assert!(approx(price.output, 25e-6));
        assert!(approx(price.cache_create, 6.25e-6));
        assert!(approx(price.cache_read, 0.5e-6));
    }

    // Same shape as the abacus case, but for a Chinese vendor: the cacheless
    // reseller sorts first alphabetically yet must not shadow the official
    // zhipuai entry.
    #[test]
    fn cn_vendor_entry_wins_over_cacheless_reseller() {
        let json = r#"{
            "abacus":  { "models": { "glm-x": { "cost": { "input": 1, "output": 3.2 } } } },
            "zhipuai": { "models": { "glm-x": { "cost": { "input": 1, "output": 3.2, "cache_write": 1.25, "cache_read": 0.2 } } } }
        }"#;
        let mut p = empty();
        p.ingest_modelsdev(json);
        let price = p.lookup("glm-x").expect("glm-x should be priced");
        assert!(approx(price.cache_create, 1.25e-6));
        assert!(approx(price.cache_read, 0.2e-6));
    }

    // Both international and -cn keys are first-party; subscription-plan keys
    // and resellers are not.
    #[test]
    fn first_party_vendor_mapping() {
        assert!(is_first_party("zai", "glm-5"));
        assert!(is_first_party("zhipuai", "GLM-5.1"));
        assert!(!is_first_party("zai-coding-plan", "glm-5"));
        assert!(is_first_party("alibaba", "qwen3-max"));
        assert!(is_first_party("alibaba-cn", "qwen3-max"));
        assert!(!is_first_party("alibaba-coding-plan", "qwen3-max"));
        assert!(is_first_party("moonshotai", "kimi-k2-thinking"));
        assert!(is_first_party("moonshotai-cn", "kimi-k2-thinking"));
        assert!(is_first_party("minimax", "MiniMax-M2.5"));
        assert!(is_first_party("minimax-cn", "MiniMax-M2.5"));
        assert!(!is_first_party("abacus", "MiniMax-M2.5"));
    }

    // With no first-party match, a complete price still beats a cache-less one.
    #[test]
    fn cache_bearing_entry_wins_when_no_first_party() {
        let json = r#"{
            "aaa": { "models": { "acme-1": { "cost": { "input": 2, "output": 4 } } } },
            "bbb": { "models": { "acme-1": { "cost": { "input": 2, "output": 4, "cache_write": 2.5, "cache_read": 0.2 } } } }
        }"#;
        let mut p = empty();
        p.ingest_modelsdev(json);
        let price = p.lookup("acme-1").expect("acme-1 should be priced");
        assert!(approx(price.cache_read, 0.2e-6));
        assert!(approx(price.cache_create, 2.5e-6));
    }
}
