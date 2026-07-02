use std::fs;
use std::path::{Path, PathBuf};

use crate::config::StackPaths;

pub fn bundled_defaults_root(app_root: &Path) -> PathBuf {
    app_root.join("bundled")
}

pub fn ensure_stack_defaults(paths: &StackPaths) -> std::io::Result<()> {
    let bundled_root = bundled_defaults_root(&paths.install_root);
    if !bundled_root.is_dir() {
        return Ok(());
    }

    for subdir in ["monitors", "gardeners", "remote_gardeners", "guidance"] {
        let source = bundled_root.join(subdir);
        if source.is_dir() {
            copy_tree_if_missing(&source, &paths.stack_dir.join(subdir))?;
        }
    }

    fs::create_dir_all(paths.stack_dir.join("meta-threads"))?;
    fs::create_dir_all(paths.stack_dir.join("sessions"))?;
    Ok(())
}

fn copy_tree_if_missing(source: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dest.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_tree_if_missing(&src_path, &dst_path)?;
        } else if file_type.is_file() && !dst_path.exists() {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn seeds_from_install_root_when_workspace_has_no_bundled() {
        // Regression for F3: an installed user runs `stack` from their own project,
        // so app_root (workspace) has no bundled/. Defaults must seed from the
        // install root regardless.
        let base = env::temp_dir().join(format!("stack-seed-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let install = base.join("install");
        let workspace = base.join("workspace");
        fs::create_dir_all(install.join("bundled").join("monitors")).unwrap();
        fs::write(install.join("bundled").join("monitors").join("default.toml"), "x = 1\n").unwrap();
        fs::create_dir_all(&workspace).unwrap();

        let paths = StackPaths {
            app_root: workspace.clone(),
            install_root: install.clone(),
            stack_global_dir: base.join("global"),
            stack_dir: workspace.join(".stack"),
            session_log_dir: workspace.join(".stack").join("sessions"),
            export_dir: workspace.join(".stack").join("exports"),
            runtime_status_path: workspace.join(".stack").join("runtime").join("status.json"),
            codex_home: base.join("codex-home"),
        };

        ensure_stack_defaults(&paths).unwrap();

        assert!(
            workspace.join(".stack").join("monitors").join("default.toml").is_file(),
            "defaults must seed from install_root even when the workspace has no bundled/"
        );
        let _ = fs::remove_dir_all(&base);
    }
}
