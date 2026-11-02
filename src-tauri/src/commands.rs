use notify::{RecursiveMode, Watcher, recommended_watcher};
use serde::Serialize;
use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Emitter;

#[derive(Debug, Serialize)]
pub struct OpenedFile {
    pub name: String,
    pub content: String,
    pub size: u64,
}

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// 错误以短码返回，前端映射为中文提示
#[tauri::command]
pub fn open_file(path: String) -> Result<OpenedFile, String> {
    let p = Path::new(&path);
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "未命名".into());
    let bytes = fs::read(p).map_err(|_| "OPEN_FAILED".to_string())?;
    let size = bytes.len() as u64;
    let content = String::from_utf8(bytes).map_err(|_| "NOT_UTF8".to_string())?;
    Ok(OpenedFile {
        name,
        content,
        size,
    })
}

/// 从启动参数里挑出要打开的文件：跳过程序自身（调用方已 skip）、跳过 `-` 开头的开关
/// （如 macOS 的 `-psn_0_123`），只接受真实存在的文件。
pub fn file_arg_from<I: IntoIterator<Item = OsString>>(args: I) -> Option<PathBuf> {
    args.into_iter()
        .map(PathBuf::from)
        .find(|candidate| {
            !candidate.as_os_str().is_empty()
                && !candidate.to_string_lossy().starts_with('-')
                && candidate.is_file()
        })
        .map(|p| std::path::absolute(&p).unwrap_or(p))
}

/// 启动时随命令行传入的文件（双击文件 /「打开方式」/ 拖到图标都会走这里）。
/// 前端启动后取走一次，取走即清空，避免重复打开。
pub struct InitialFile(Mutex<Option<String>>);

impl InitialFile {
    pub fn new<I: IntoIterator<Item = OsString>>(args: I) -> Self {
        Self(Mutex::new(
            file_arg_from(args).map(|p| p.to_string_lossy().into_owned()),
        ))
    }

    pub fn take(&self) -> Option<String> {
        self.0.lock().unwrap().take()
    }
}

impl Default for InitialFile {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[tauri::command]
pub fn take_initial_file(state: tauri::State<InitialFile>) -> Option<String> {
    state.take()
}

/// 原子写：先写同目录临时文件，再 rename 覆盖目标

#[tauri::command]
pub fn save_file(
    path: String,
    content: String,
    expected: Option<String>,
    expected_missing: bool,
) -> Result<(), String> {
    let resolved = resolve_file_path(Path::new(&path))?;
    let p = resolved.as_path();
    let dir = p
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .ok_or_else(|| "SAVE_FAILED".to_string())?;
    let name = p.file_name().ok_or_else(|| "SAVE_FAILED".to_string())?;
    let tmp = dir.join(format!(
        ".{}.{}.{}.tmp",
        name.to_string_lossy(),
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    #[cfg(unix)]
    let permissions = fs::metadata(p).ok().map(|metadata| metadata.permissions());
    write_temporary(&tmp, content.as_bytes()).map_err(|_| "SAVE_FAILED".to_string())?;
    #[cfg(unix)]
    if let Some(permissions) = permissions {
        if fs::set_permissions(&tmp, permissions).is_err() {
            let _ = fs::remove_file(&tmp);
            return Err("SAVE_FAILED".to_string());
        }
    }
    if expected_missing {
        let check = match fs::symlink_metadata(p) {
            Ok(_) => Err("FILE_CONFLICT"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("SAVE_FAILED"),
        };
        if let Err(error) = check {
            let _ = fs::remove_file(&tmp);
            return Err(error.to_string());
        }
    }
    if let Some(expected) = expected {
        let check = match fs::read(p) {
            Ok(current) if current == expected.as_bytes() => Ok(()),
            Ok(_) => Err("FILE_CONFLICT"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err("FILE_MISSING"),
            Err(_) => Err("SAVE_FAILED"),
        };
        if let Err(error) = check {
            let _ = fs::remove_file(&tmp);
            return Err(error.to_string());
        }
    }
    if expected_missing {
        return rename_noreplace(&tmp, p).map_err(|error| {
            let _ = fs::remove_file(&tmp);
            if error.kind() == std::io::ErrorKind::AlreadyExists || fs::symlink_metadata(p).is_ok()
            {
                "FILE_CONFLICT".to_string()
            } else {
                format!("SAVE_FAILED:{error}")
            }
        });
    }
    fs::rename(&tmp, p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("SAVE_FAILED:{e}")
    })
}

fn write_temporary(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    if let Err(error) = file.write_all(content) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

#[cfg(windows)]
fn rename_noreplace(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileW(existing: *const u16, new: *const u16) -> i32;
    }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    if source[..source.len() - 1].contains(&0) || target[..target.len() - 1].contains(&0) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path contains NUL",
        ));
    }
    if unsafe { MoveFileW(source.as_ptr(), target.as_ptr()) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn rename_noreplace(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::hard_link(source, target)?;
    let _ = fs::remove_file(source);
    Ok(())
}

fn resolve_file_path(path: &Path) -> Result<PathBuf, String> {
    let mut current = path.to_path_buf();
    for _ in 0..40 {
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                let target = fs::read_link(&current).map_err(|_| "SAVE_FAILED".to_string())?;
                current = if target.is_absolute() {
                    target
                } else {
                    current.parent().unwrap_or(Path::new(".")).join(target)
                };
            }
            Ok(_) => return Ok(current),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(current),
            Err(_) => return Err("SAVE_FAILED".to_string()),
        }
    }
    Err("SAVE_FAILED".to_string())
}

pub struct WatchState(Mutex<Option<notify::RecommendedWatcher>>);

impl Default for WatchState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy().to_lowercase() == right.to_string_lossy().to_lowercase()
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn watch_targets<F>(
    target: &Path,
    selected: &Path,
    on_change: F,
) -> notify::Result<notify::RecommendedWatcher>
where
    F: Fn(bool) + Send + 'static,
{
    let target_parent = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| notify::Error::generic("file has no parent directory"))?;
    let selected_parent = selected
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| notify::Error::generic("file has no parent directory"))?;
    let track_selected = !same_path(target, selected);
    let target = target.to_path_buf();
    let selected = selected.to_path_buf();
    let mut watcher = recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        if let Ok(event) = res {
            if event.kind.is_modify() || event.kind.is_create() || event.kind.is_remove() {
                let selected_event = event.paths.iter().any(|path| same_path(path, &selected));
                let rebind = selected_event
                    && (track_selected
                        || event.kind.is_create()
                        || event.kind.is_remove()
                        || matches!(
                            event.kind,
                            notify::EventKind::Modify(notify::event::ModifyKind::Name(_))
                        ));
                if rebind || event.paths.iter().any(|path| same_path(path, &target)) {
                    on_change(rebind);
                }
            }
        }
    })?;
    watcher.watch(target_parent, RecursiveMode::NonRecursive)?;
    if track_selected && !same_path(target_parent, selected_parent) {
        watcher.watch(selected_parent, RecursiveMode::NonRecursive)?;
    }
    Ok(watcher)
}

#[cfg(test)]
fn watch_changes<F>(path: &Path, on_change: F) -> notify::Result<notify::RecommendedWatcher>
where
    F: Fn() + Send + 'static,
{
    watch_targets(path, path, move |_| on_change())
}

/// 监视当前文件；重复调用会替换上一个 watcher（换文件时自动停旧启新）
#[tauri::command]
pub fn watch_file(
    app: tauri::AppHandle,
    state: tauri::State<WatchState>,
    path: String,
) -> Result<(), String> {
    let app = app.clone();
    let resolved = resolve_file_path(Path::new(&path))?;
    let target = fs::canonicalize(&resolved).unwrap_or(resolved);
    let selected_path = Path::new(&path);
    let parent = selected_path
        .parent()
        .ok_or_else(|| "WATCH_FAILED".to_string())?;
    let name = selected_path
        .file_name()
        .ok_or_else(|| "WATCH_FAILED".to_string())?;
    let selected = fs::canonicalize(parent)
        .unwrap_or_else(|_| parent.to_path_buf())
        .join(name);
    let watcher = watch_targets(&target, &selected, move |link_changed| {
        let _ = app.emit("file-changed", link_changed);
    })
    .map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_file(state: tauri::State<WatchState>) -> Result<(), String> {
    *state.0.lock().unwrap() = None; // drop 即停止
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn watcher_detects_removal_and_recreation_of_current_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::write(&path, "old").unwrap();
        let (tx, rx) = mpsc::channel();
        let _watcher = watch_changes(&path, move || {
            let _ = tx.send(());
        })
        .unwrap();

        fs::remove_file(&path).unwrap();
        rx.recv_timeout(Duration::from_secs(3))
            .expect("file removal was not reported");
        while rx.recv_timeout(Duration::from_millis(100)).is_ok() {}
        fs::write(&path, "new").unwrap();
        rx.recv_timeout(Duration::from_secs(3))
            .expect("file recreation was not reported");
    }

    #[test]
    fn watcher_detects_changes_to_the_selected_link_as_well_as_its_target() {
        let dir = tempfile::tempdir().unwrap();
        let links = dir.path().join("links");
        let targets = dir.path().join("targets");
        fs::create_dir(&links).unwrap();
        fs::create_dir(&targets).unwrap();
        let selected = links.join("selected.md");
        let target = targets.join("target.md");
        fs::write(&selected, "link").unwrap();
        fs::write(&target, "target").unwrap();
        let (tx, rx) = mpsc::channel();
        let _watcher = watch_targets(&target, &selected, move |link_changed| {
            let _ = tx.send(link_changed);
        })
        .unwrap();
        fs::write(&selected, "changed").unwrap();
        assert!(
            rx.recv_timeout(Duration::from_secs(3))
                .expect("selected path change was not reported")
        );
    }

    #[test]
    fn watcher_requests_rebinding_when_a_selected_path_is_recreated() {
        let dir = tempfile::tempdir().unwrap();
        let selected = dir.path().join("selected.md");
        fs::write(&selected, "old").unwrap();
        let (tx, rx) = mpsc::channel();
        let _watcher = watch_targets(&selected, &selected, move |rebind| {
            let _ = tx.send(rebind);
        })
        .unwrap();
        fs::remove_file(&selected).unwrap();
        assert!(
            rx.recv_timeout(Duration::from_secs(3))
                .expect("removal was not reported")
        );
        while rx.recv_timeout(Duration::from_millis(100)).is_ok() {}
        fs::write(&selected, "new").unwrap();
        assert!(
            rx.recv_timeout(Duration::from_secs(3))
                .expect("recreation was not reported")
        );
    }

    #[cfg(windows)]
    #[test]
    fn watcher_matches_windows_file_names_case_insensitively() {
        let dir = tempfile::tempdir().unwrap();
        let actual = dir.path().join("MyFile.md");
        let selected = dir.path().join("myfile.md");
        fs::write(&actual, "old").unwrap();
        let (tx, rx) = mpsc::channel();
        let _watcher = watch_changes(&selected, move || {
            let _ = tx.send(());
        })
        .unwrap();

        fs::write(&actual, "new").unwrap();
        rx.recv_timeout(Duration::from_secs(3))
            .expect("case-insensitive file change was not reported");
    }

    #[test]
    fn save_roundtrip_and_no_tmp_leftover() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        save_file(
            path.to_string_lossy().to_string(),
            "# 你好".into(),
            None,
            true,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "# 你好");
        let n = fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(n, 1);
    }

    #[test]
    fn save_overwrites_existing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::write(&path, "old").unwrap();
        save_file(
            path.to_string_lossy().to_string(),
            "new".into(),
            None,
            false,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn save_rejects_external_changes_without_overwriting_them() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::write(&path, "external").unwrap();
        let result = save_file(
            path.to_string_lossy().to_string(),
            "local".into(),
            Some("previous".into()),
            false,
        );
        assert_eq!(result.unwrap_err(), "FILE_CONFLICT");
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn save_does_not_replace_a_file_when_creation_was_expected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::write(&path, "external").unwrap();
        let result = save_file(
            path.to_string_lossy().to_string(),
            "local".into(),
            None,
            true,
        );
        assert_eq!(result.unwrap_err(), "FILE_CONFLICT");
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
    }

    #[test]
    fn publishing_a_new_file_does_not_replace_a_concurrently_created_target() {
        let dir = tempfile::tempdir().unwrap();
        let temporary = dir.path().join("temporary.md");
        let target = dir.path().join("target.md");
        fs::write(&temporary, "local").unwrap();
        fs::write(&target, "external").unwrap();
        assert!(rename_noreplace(&temporary, &target).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "external");
        assert_eq!(fs::read_to_string(&temporary).unwrap(), "local");
    }

    #[test]
    fn temporary_writer_does_not_truncate_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let temporary = dir.path().join("temporary.md");
        fs::write(&temporary, "existing").unwrap();
        assert!(write_temporary(&temporary, b"new").is_err());
        assert_eq!(fs::read_to_string(&temporary).unwrap(), "existing");
    }

    #[cfg(unix)]
    #[test]
    fn saving_preserves_existing_file_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("private.md");
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        save_file(
            path.to_string_lossy().to_string(),
            "new".into(),
            Some("old".into()),
            false,
        )
        .unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[cfg(unix)]
    #[test]
    fn saving_a_symbolic_link_preserves_the_link_and_updates_its_target() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.md");
        let link = dir.path().join("link.md");
        fs::write(&target, "old").unwrap();
        symlink("target.md", &link).unwrap();
        save_file(
            link.to_string_lossy().to_string(),
            "new".into(),
            Some("old".into()),
            false,
        )
        .unwrap();
        assert!(
            fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
    }

    #[test]
    fn open_returns_utf8_and_name() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("笔记.md");
        fs::write(&path, "# hi").unwrap();
        let r = open_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(r.name, "笔记.md");
        assert_eq!(r.content, "# hi");
        assert_eq!(r.size, 4);
    }

    #[test]
    fn open_rejects_non_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gbk.md");
        fs::write(&path, [0xD6, 0xD0, 0xCE, 0xC4]).unwrap(); // GBK "中文"
        let err = open_file(path.to_string_lossy().to_string()).unwrap_err();
        assert_eq!(err, "NOT_UTF8");
    }

    #[test]
    fn open_missing_file_fails() {
        let err = open_file("Z:/不存在/x.md".into()).unwrap_err();
        assert_eq!(err, "OPEN_FAILED");
    }

    #[test]
    fn file_arg_picks_the_existing_file_and_skips_flags() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("笔记.md");
        fs::write(&path, "# hi").unwrap();
        let args = vec![
            OsString::from("--inspect"),
            OsString::from("-psn_0_123"),
            path.clone().into_os_string(),
        ];
        assert_eq!(
            file_arg_from(args),
            Some(std::path::absolute(&path).unwrap())
        );
    }

    #[test]
    fn file_arg_ignores_missing_paths() {
        let dir = tempfile::tempdir().unwrap();
        let args = vec![dir.path().join("不存在.md").into_os_string()];
        assert_eq!(file_arg_from(args), None);
    }

    #[test]
    fn file_arg_is_none_without_arguments() {
        assert_eq!(file_arg_from(Vec::new()), None);
    }

    #[test]
    fn initial_file_is_consumed_only_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::write(&path, "old").unwrap();
        let state = InitialFile::new(vec![path.into_os_string()]);
        assert!(state.take().is_some());
        assert!(state.take().is_none());
    }
}
