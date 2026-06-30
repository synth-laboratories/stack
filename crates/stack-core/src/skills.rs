use crate::config::StackPaths;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use thiserror::Error;

pub const SKILLS_REGISTRY_SCHEMA: &str = "stack/skills-registry/v1";
pub const PREINSTALLED_SKILL_IDS: &[&str] = &["oss-gepa", "hosted-gepa", "synth-ai"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillOrigin {
    Preinstalled,
    Bundled,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillInstalledBy {
    Stackd,
    Gardener,
    Operator,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRecord {
    pub skill_id: String,
    pub name: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    pub source_path: String,
    pub origin: SkillOrigin,
    pub installed_at: String,
    pub installed_by: SkillInstalledBy,
    #[serde(default = "default_allowed_actors")]
    pub allowed_actors: String,
    #[serde(default = "default_true")]
    pub mcp_exposed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsRegistry {
    pub schema: String,
    pub updated_at: String,
    pub skills: Vec<SkillRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillListResponse {
    pub count: usize,
    pub skills: Vec<SkillRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillReadResponse {
    pub skill: SkillRecord,
    pub content: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterSkillRequest {
    pub skill_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    pub source_path: Option<String>,
    pub installed_by: Option<String>,
    pub allowed_actors: Option<String>,
    #[serde(default)]
    pub mcp_exposed: Option<bool>,
}

#[derive(Debug, Error)]
pub enum SkillError {
    #[error("invalid skill id: {0}")]
    InvalidId(String),
    #[error("skill not found: {0}")]
    NotFound(String),
    #[error("skill already exists: {0}")]
    AlreadyExists(String),
    #[error("missing skill content or source_path")]
    MissingContent,
    #[error("invalid source path: {0}")]
    InvalidSourcePath(String),
    #[error("{0}")]
    Io(#[from] io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
}

pub fn skills_catalog_dir(paths: &StackPaths) -> PathBuf {
    paths.stack_global_dir.join("skills")
}

pub fn skills_registry_path(paths: &StackPaths) -> PathBuf {
    skills_catalog_dir(paths).join("registry.json")
}

/// Workspace-local `.codex/skills` directory. Holds the bundled (tracked)
/// skills and any custom skills Stack mirrors here so the Codex subprocess
/// (spawned with `-C <workspace>`) discovers them via its cwd-walk. Stack NEVER
/// writes to the user's global `~/.codex` — that is Codex's own home, which
/// Stack only reads (sessions).
pub fn bundled_skills_dir(paths: &StackPaths) -> PathBuf {
    paths.install_root.join(".codex").join("skills")
}

pub fn ensure_skills_runtime(paths: &StackPaths) -> Result<Vec<SkillRecord>, SkillError> {
    fs::create_dir_all(skills_catalog_dir(paths))?;
    sync_preinstalled_skills(paths)?;
    Ok(list_skills(paths)?)
}

pub fn list_skills(paths: &StackPaths) -> Result<Vec<SkillRecord>, SkillError> {
    let registry = read_registry(paths)?;
    let mut skills = registry.skills;
    skills.sort_by(|left, right| left.skill_id.cmp(&right.skill_id));
    Ok(skills)
}

pub fn read_skill(
    paths: &StackPaths,
    skill_id: &str,
    max_bytes: usize,
) -> Result<SkillReadResponse, SkillError> {
    let registry = read_registry(paths)?;
    let skill = registry
        .skills
        .iter()
        .find(|entry| entry.skill_id == skill_id || entry.name == skill_id)
        .cloned()
        .ok_or_else(|| SkillError::NotFound(skill_id.to_string()))?;
    let source = resolve_skill_source_path(paths, &skill.source_path)?;
    let bytes = fs::read(&source)?;
    let truncated = bytes.len() > max_bytes;
    let content = String::from_utf8_lossy(&bytes[..bytes.len().min(max_bytes)]).into_owned();
    Ok(SkillReadResponse {
        skill,
        content,
        truncated,
    })
}

pub fn search_skills(
    paths: &StackPaths,
    query: &str,
    limit: usize,
) -> Result<Vec<SkillRecord>, SkillError> {
    let terms: Vec<String> = query
        .split_whitespace()
        .map(|term| term.to_lowercase())
        .filter(|term| !term.is_empty())
        .collect();
    let mut scored: Vec<(i32, SkillRecord)> = list_skills(paths)?
        .into_iter()
        .map(|skill| (score_skill(&skill, &terms), skill))
        .filter(|(score, _)| *score > 0 || terms.is_empty())
        .collect();
    scored.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.skill_id.cmp(&right.1.skill_id))
    });
    Ok(scored
        .into_iter()
        .take(limit)
        .map(|(_, skill)| skill)
        .collect())
}

pub fn register_skill(
    paths: &StackPaths,
    request: RegisterSkillRequest,
) -> Result<SkillRecord, SkillError> {
    validate_skill_id(&request.skill_id)?;
    let installed_by = parse_installed_by(request.installed_by.as_deref());
    let mut registry = read_registry(paths)?;

    if registry
        .skills
        .iter()
        .any(|entry| entry.skill_id == request.skill_id)
    {
        return Err(SkillError::AlreadyExists(request.skill_id));
    }

    let source_path =
        if let Some(content) = request.content.filter(|value| !value.trim().is_empty()) {
            write_custom_skill(paths, &request.skill_id, &content)?
        } else if let Some(source) = request.source_path.filter(|value| !value.trim().is_empty()) {
            register_existing_source(paths, &request.skill_id, &source)?
        } else {
            return Err(SkillError::MissingContent);
        };

    let parsed = parse_skill_frontmatter(&fs::read_to_string(resolve_skill_source_path(
        paths,
        &source_path,
    )?)?);
    let record = SkillRecord {
        skill_id: request.skill_id.clone(),
        name: parsed.name.unwrap_or_else(|| request.skill_id.clone()),
        title: request
            .title
            .or(parsed.title)
            .unwrap_or_else(|| request.skill_id.clone()),
        description: request
            .description
            .or(parsed.description)
            .unwrap_or_default(),
        source_path,
        origin: SkillOrigin::Custom,
        installed_at: Utc::now().to_rfc3339(),
        installed_by,
        allowed_actors: request
            .allowed_actors
            .or(parsed.allowed_actors)
            .unwrap_or_else(default_allowed_actors),
        mcp_exposed: request.mcp_exposed.unwrap_or(true),
    };

    mirror_skill_for_codex(paths, &record)?;
    registry.skills.push(record.clone());
    registry.updated_at = Utc::now().to_rfc3339();
    write_registry(paths, &registry)?;
    Ok(record)
}

fn sync_preinstalled_skills(paths: &StackPaths) -> Result<(), SkillError> {
    let bundled_root = bundled_skills_dir(paths);
    let catalog_root = skills_catalog_dir(paths);
    fs::create_dir_all(&catalog_root)?;

    let mut registry = read_registry(paths)?;
    let now = Utc::now().to_rfc3339();

    for skill_id in PREINSTALLED_SKILL_IDS {
        let bundled_dir = bundled_root.join(skill_id);
        let bundled_skill = bundled_dir.join("SKILL.md");
        if !bundled_skill.is_file() {
            continue;
        }

        let catalog_dir = catalog_root.join(skill_id);
        ensure_symlink_dir(&bundled_dir, &catalog_dir)?;

        let relative_source = format!(".stack/skills/{skill_id}/SKILL.md");
        let content = fs::read_to_string(&bundled_skill)?;
        let parsed = parse_skill_frontmatter(&content);
        let record = SkillRecord {
            skill_id: (*skill_id).to_string(),
            name: parsed.name.unwrap_or_else(|| (*skill_id).to_string()),
            title: parsed.title.unwrap_or_else(|| (*skill_id).to_string()),
            description: parsed.description.unwrap_or_default(),
            source_path: relative_source,
            origin: SkillOrigin::Preinstalled,
            installed_at: now.clone(),
            installed_by: SkillInstalledBy::Stackd,
            allowed_actors: parsed.allowed_actors.unwrap_or_else(default_allowed_actors),
            mcp_exposed: true,
        };

        upsert_registry_entry(&mut registry, record);
        mirror_skill_for_codex(paths, registry.skills.last().unwrap())?;
    }

    registry.updated_at = now;
    write_registry(paths, &registry)?;
    Ok(())
}

fn upsert_registry_entry(registry: &mut SkillsRegistry, record: SkillRecord) {
    if let Some(existing) = registry
        .skills
        .iter_mut()
        .find(|entry| entry.skill_id == record.skill_id)
    {
        existing.title = record.title;
        existing.description = record.description;
        existing.source_path = record.source_path;
        existing.allowed_actors = record.allowed_actors;
        existing.mcp_exposed = record.mcp_exposed;
        if matches!(record.origin, SkillOrigin::Preinstalled) {
            existing.origin = SkillOrigin::Preinstalled;
        }
    } else {
        registry.skills.push(record);
    }
}

fn write_custom_skill(
    paths: &StackPaths,
    skill_id: &str,
    content: &str,
) -> Result<String, SkillError> {
    let dir = skills_catalog_dir(paths).join("custom").join(skill_id);
    fs::create_dir_all(&dir)?;
    let skill_path = dir.join("SKILL.md");
    fs::write(&skill_path, content)?;
    Ok(format!(".stack/skills/custom/{skill_id}/SKILL.md"))
}

fn register_existing_source(
    paths: &StackPaths,
    skill_id: &str,
    source: &str,
) -> Result<String, SkillError> {
    let resolved = resolve_external_source(paths, source)?;
    if !resolved.ends_with("SKILL.md") || !resolved.is_file() {
        return Err(SkillError::InvalidSourcePath(source.to_string()));
    }
    let dir = skills_catalog_dir(paths).join("custom").join(skill_id);
    fs::create_dir_all(&dir)?;
    ensure_symlink_dir(&resolved.parent().unwrap_or(Path::new(".")), &dir)?;
    Ok(format!(".stack/skills/custom/{skill_id}/SKILL.md"))
}

fn resolve_external_source(paths: &StackPaths, source: &str) -> Result<PathBuf, SkillError> {
    let candidate = PathBuf::from(source);
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        paths.app_root.join(candidate)
    };
    let canonical = resolved
        .canonicalize()
        .map_err(|_| SkillError::InvalidSourcePath(source.to_string()))?;
    Ok(canonical)
}

fn resolve_skill_source_path(paths: &StackPaths, source_path: &str) -> Result<PathBuf, SkillError> {
    let candidate = PathBuf::from(source_path);
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        paths.app_root.join(candidate)
    };
    resolved
        .canonicalize()
        .or_else(|_| {
            let fallback = skills_catalog_dir(paths).join(
                source_path
                    .strip_prefix(".stack/skills/")
                    .unwrap_or(source_path),
            );
            if fallback.join("SKILL.md").is_file() {
                Ok(fallback.join("SKILL.md"))
            } else if fallback.is_file() {
                Ok(fallback)
            } else {
                Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "skill source missing",
                ))
            }
        })
        .map_err(|_| SkillError::NotFound(source_path.to_string()))
}

fn read_registry(paths: &StackPaths) -> Result<SkillsRegistry, SkillError> {
    let path = skills_registry_path(paths);
    if !path.is_file() {
        return Ok(empty_registry());
    }
    let text = fs::read_to_string(path)?;
    serde_json::from_str(&text).map_err(SkillError::from)
}

fn write_registry(paths: &StackPaths, registry: &SkillsRegistry) -> Result<(), SkillError> {
    fs::create_dir_all(skills_catalog_dir(paths))?;
    fs::write(
        skills_registry_path(paths),
        serde_json::to_string_pretty(registry)?,
    )?;
    Ok(())
}

fn empty_registry() -> SkillsRegistry {
    SkillsRegistry {
        schema: SKILLS_REGISTRY_SCHEMA.to_string(),
        updated_at: Utc::now().to_rfc3339(),
        skills: Vec::new(),
    }
}

fn validate_skill_id(skill_id: &str) -> Result<(), SkillError> {
    let valid = !skill_id.is_empty()
        && skill_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');
    if valid {
        Ok(())
    } else {
        Err(SkillError::InvalidId(skill_id.to_string()))
    }
}

fn parse_installed_by(value: Option<&str>) -> SkillInstalledBy {
    match value.unwrap_or("stackd").trim().to_lowercase().as_str() {
        "gardener" => SkillInstalledBy::Gardener,
        "operator" => SkillInstalledBy::Operator,
        "user" => SkillInstalledBy::User,
        _ => SkillInstalledBy::Stackd,
    }
}

fn score_skill(skill: &SkillRecord, terms: &[String]) -> i32 {
    if terms.is_empty() {
        return 1;
    }
    let haystack = format!(
        "{} {} {} {}",
        skill.skill_id, skill.name, skill.title, skill.description
    )
    .to_lowercase();
    terms
        .iter()
        .map(|term| i32::from(haystack.contains(term)))
        .sum()
}

/// Make a skill discoverable by the Codex subprocess via the workspace-local
/// `.codex/skills` directory (cwd-walk). Never touches the user's `~/.codex`.
///
/// Bundled/preinstalled skills already live under `<workspace>/.codex/skills`,
/// so they are skipped (mirroring would point a symlink at its own source).
/// Custom skills (sourced from `.stack/skills/custom/`) are symlinked in. A
/// pre-existing real directory at the target is left untouched — Stack only
/// manages its own symlinks and never clobbers user content.
fn mirror_skill_for_codex(paths: &StackPaths, record: &SkillRecord) -> Result<(), SkillError> {
    let source_dir = resolve_skill_source_path(paths, &record.source_path)?
        .parent()
        .ok_or_else(|| SkillError::NotFound(record.skill_id.clone()))?
        .to_path_buf();
    let target_root = bundled_skills_dir(paths);

    let source_canon = source_dir
        .canonicalize()
        .unwrap_or_else(|_| source_dir.clone());
    if let Ok(root_canon) = target_root.canonicalize() {
        if source_canon.starts_with(&root_canon) {
            return Ok(());
        }
    }

    fs::create_dir_all(&target_root)?;
    let target = target_root.join(&record.name);
    if target.exists() && !target.is_symlink() {
        return Ok(());
    }
    ensure_symlink_dir(&source_dir, &target)
}

fn ensure_symlink_dir(source: &Path, target: &Path) -> Result<(), SkillError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        if target.is_symlink() || target.is_dir() {
            let _ = fs::remove_dir_all(target);
            let _ = fs::remove_file(target);
        }
        let source = source
            .canonicalize()
            .unwrap_or_else(|_| source.to_path_buf());
        symlink(&source, target)?;
        return Ok(());
    }
    #[cfg(not(unix))]
    {
        let _ = (source, target);
        Err(SkillError::Io(io::Error::new(
            io::ErrorKind::Unsupported,
            "skill symlinks require unix",
        )))
    }
}

#[derive(Default)]
struct SkillFrontmatter {
    name: Option<String>,
    title: Option<String>,
    description: Option<String>,
    allowed_actors: Option<String>,
}

fn parse_skill_frontmatter(content: &str) -> SkillFrontmatter {
    let mut result = SkillFrontmatter::default();
    if !content.starts_with("---\n") {
        return result;
    }
    let Some(end) = content.find("\n---") else {
        return result;
    };
    for line in content[4..end].lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        match key.trim() {
            "name" => result.name = Some(value),
            "title" => result.title = Some(value),
            "description" => result.description = Some(value),
            "allowed_actors" | "allowedActors" => result.allowed_actors = Some(value),
            _ => {}
        }
    }
    result
}

fn default_allowed_actors() -> String {
    "both".to_string()
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn temp_paths(root: &Path) -> StackPaths {
        StackPaths {
            app_root: root.to_path_buf(),
            install_root: root.to_path_buf(),
            stack_global_dir: root.join(".stack-global"),
            stack_dir: root.join(".stack"),
            session_log_dir: root.join(".stack").join("sessions"),
            export_dir: root.join(".stack").join("exports"),
            runtime_status_path: root.join(".stack").join("runtime").join("status.json"),
            codex_home: root.join(".codex-home"),
        }
    }

    #[test]
    fn preinstalled_skills_bootstrap() {
        let root = env::temp_dir().join(format!("stack-skills-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".codex/skills/oss-gepa")).unwrap();
        fs::write(
            root.join(".codex/skills/oss-gepa/SKILL.md"),
            "---\nname: oss-gepa\ntitle: OSS GEPA\ndescription: local gepa\n---\n",
        )
        .unwrap();
        let paths = temp_paths(&root);
        let skills = ensure_skills_runtime(&paths).unwrap();
        assert!(skills.iter().any(|skill| skill.skill_id == "oss-gepa"));
        assert!(
            !paths.codex_home.exists(),
            "Stack must not write to the user's ~/.codex home"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn custom_skill_mirrors_into_workspace_not_codex_home() {
        let root = env::temp_dir().join(format!("stack-skills-custom-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".stack-global/skills")).unwrap();
        let paths = temp_paths(&root);

        register_skill(
            &paths,
            RegisterSkillRequest {
                skill_id: "my-skill".to_string(),
                title: Some("My Skill".to_string()),
                description: Some("desc".to_string()),
                content: Some("---\nname: my-skill\ntitle: My Skill\n---\nbody\n".to_string()),
                source_path: None,
                installed_by: Some("user".to_string()),
                allowed_actors: None,
                mcp_exposed: None,
            },
        )
        .unwrap();

        // Mirrored into the workspace .codex/skills for Codex cwd-walk discovery.
        assert!(root.join(".codex/skills/my-skill").exists());
        // Never written to the user's ~/.codex home.
        assert!(
            !paths.codex_home.exists(),
            "Stack must not write to the user's ~/.codex home"
        );
        let _ = fs::remove_dir_all(root);
    }
}
