use std::fs;
use std::path::{Path, PathBuf};

use crate::config::StackPaths;

pub fn bundled_defaults_root(app_root: &Path) -> PathBuf {
    app_root.join("bundled")
}

pub fn ensure_stack_defaults(paths: &StackPaths) -> std::io::Result<()> {
    let bundled_root = bundled_defaults_root(&paths.app_root);
    if !bundled_root.is_dir() {
        return Ok(());
    }

    for subdir in ["monitors", "guidance", "stackeval"] {
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
