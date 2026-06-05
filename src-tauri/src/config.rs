// Loads the "user-installed" whitelists so the dashboard only counts
// MCP servers / Skills the user actually added (PRD decision).
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub struct UserConfig {
    pub mcp_servers: HashSet<String>,
    pub skills: HashSet<String>,
}

fn home() -> Option<PathBuf> {
    dirs::home_dir()
}

/// Read ~/.claude.json -> mcpServers (top level) + projects[*].mcpServers
fn load_user_mcps() -> HashSet<String> {
    let mut set = HashSet::new();
    let Some(h) = home() else { return set };
    let path = h.join(".claude.json");
    let Ok(text) = fs::read_to_string(&path) else { return set };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { return set };

    if let Some(obj) = json.get("mcpServers").and_then(|v| v.as_object()) {
        for k in obj.keys() {
            set.insert(k.clone());
        }
    }
    if let Some(projects) = json.get("projects").and_then(|v| v.as_object()) {
        for proj in projects.values() {
            if let Some(obj) = proj.get("mcpServers").and_then(|v| v.as_object()) {
                for k in obj.keys() {
                    set.insert(k.clone());
                }
            }
        }
    }
    set
}

/// Project paths registered in ~/.claude.json (keys of `projects`).
fn project_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let Some(h) = home() else { return roots };
    let Ok(text) = fs::read_to_string(h.join(".claude.json")) else { return roots };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { return roots };
    if let Some(projects) = json.get("projects").and_then(|v| v.as_object()) {
        for key in projects.keys() {
            roots.push(PathBuf::from(key));
        }
    }
    roots
}

/// Add each subdirectory name of `dir` to the set (skills are folders).
fn scan_skill_dir(dir: &Path, set: &mut HashSet<String>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            if e.path().is_dir() {
                if let Some(name) = e.file_name().to_str() {
                    set.insert(name.to_string());
                }
            }
        }
    }
}

/// User-installed skills = global ~/.claude/skills/ + each project's
/// <project>/.claude/skills/ (mirrors how MCP reads project-level servers).
fn load_user_skills() -> HashSet<String> {
    let mut set = HashSet::new();
    let Some(h) = home() else { return set };
    scan_skill_dir(&h.join(".claude").join("skills"), &mut set);
    for root in project_roots() {
        scan_skill_dir(&root.join(".claude").join("skills"), &mut set);
    }
    set
}

impl UserConfig {
    pub fn load() -> Self {
        UserConfig {
            mcp_servers: load_user_mcps(),
            skills: load_user_skills(),
        }
    }

    /// A tool name like "mcp__<server>__<tool>" → is server user-installed?
    pub fn is_user_mcp(&self, server: &str) -> bool {
        self.mcp_servers.contains(server)
    }

    /// A skill id (may be "plugin:skill") → strip plugin prefix, check dir.
    pub fn is_user_skill(&self, skill: &str) -> bool {
        let key = skill.rsplit(':').next().unwrap_or(skill);
        self.skills.contains(key)
    }
}
