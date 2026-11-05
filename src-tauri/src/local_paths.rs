use std::path::{Path, PathBuf};

/// 相对地址缺少可用的基准文档。
pub(crate) const NO_DOCUMENT_PATH: &str = "NO_DOCUMENT_PATH";
/// 目标不是可以打开的本地 Markdown 地址。
pub(crate) const INVALID_LINK: &str = "INVALID_MARKDOWN_LINK";
/// 地址合法，但目标不存在、不是文件或不是 Markdown。
pub(crate) const LINK_UNAVAILABLE: &str = "MARKDOWN_UNAVAILABLE";

/// 把原始地址拆成“路径部分”和“? / # 后缀”。
///
/// 只在原文里查找分隔符：`%3F`、`%23` 是文件名字符，解码后不应再被当作后缀。
pub(crate) fn split_source_suffix(source: &str) -> (&str, &str) {
    let prefix = if cfg!(windows) && (source.starts_with("\\\\?\\") || source.starts_with("//?/")) {
        4
    } else {
        0
    };
    match source[prefix..].find(['?', '#']) {
        Some(index) => source.split_at(prefix + index),
        None => (source, ""),
    }
}

/// 校验百分号编码：每个 `%` 后面必须紧跟两个十六进制数字。
pub(crate) fn valid_percent_encoding(source: &str) -> bool {
    let bytes = source.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return false;
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    true
}

pub(crate) fn is_windows_drive_path(source: &str) -> bool {
    let bytes = source.as_bytes();
    cfg!(windows)
        && bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

pub(crate) fn has_url_scheme(source: &str) -> bool {
    let Some((scheme, _)) = source.split_once(':') else {
        return false;
    };
    let mut chars = scheme.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
}

/// 网络共享与设备路径：`\\server\share`、`\\.\COM1`、`\\?\UNC\...`，以及 `//host/...`。
pub(crate) fn is_network_or_device_path(path: &Path) -> bool {
    #[cfg(windows)]
    if let Some(std::path::Component::Prefix(prefix)) = path.components().next() {
        use std::path::Prefix;
        return !matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_));
    }
    let text = path.as_os_str().to_string_lossy();
    let bytes = text.as_bytes();
    bytes.len() >= 2 && matches!(bytes[0], b'/' | b'\\') && matches!(bytes[1], b'/' | b'\\')
}

fn has_markdown_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

/// 解析出候选路径，不做文件系统访问。
///
/// `document_path` 只作为相对地址的基准；绝对地址不依赖它。
fn markdown_candidate(document_path: Option<&Path>, source: &str) -> Result<PathBuf, String> {
    let source = source.trim();
    if source.is_empty() || !valid_percent_encoding(source) {
        return Err(INVALID_LINK.into());
    }
    let (path_source, _suffix) = split_source_suffix(source);
    if path_source.is_empty() || is_network_or_device_path(Path::new(path_source)) {
        return Err(INVALID_LINK.into());
    }

    let path = if path_source
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("file:"))
    {
        let url = url::Url::parse(path_source).map_err(|_| INVALID_LINK.to_string())?;
        if url.scheme() != "file"
            || url
                .host_str()
                .is_some_and(|host| !host.eq_ignore_ascii_case("localhost"))
        {
            return Err(INVALID_LINK.into());
        }
        url.to_file_path().map_err(|_| INVALID_LINK.to_string())?
    } else {
        if !is_windows_drive_path(path_source) && has_url_scheme(path_source) {
            return Err(INVALID_LINK.into());
        }
        let decoded = percent_encoding::percent_decode_str(path_source)
            .decode_utf8()
            .map_err(|_| INVALID_LINK.to_string())?;
        let candidate = Path::new(decoded.as_ref());
        if is_network_or_device_path(candidate) {
            return Err(INVALID_LINK.into());
        }
        if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            let document = document_path.ok_or(NO_DOCUMENT_PATH)?;
            if !document.is_absolute() || is_network_or_device_path(document) {
                return Err(NO_DOCUMENT_PATH.into());
            }
            document
                .parent()
                .ok_or(NO_DOCUMENT_PATH)?
                .join(candidate)
        }
    };

    if is_network_or_device_path(&path) || !has_markdown_extension(&path) {
        return Err(INVALID_LINK.into());
    }
    Ok(path)
}

/// 返回规范化的本地绝对路径；目标必须是存在的普通 Markdown 文件。
pub fn resolve_markdown_path(document_path: Option<&Path>, source: &str) -> Result<PathBuf, String> {
    let path = markdown_candidate(document_path, source)?;
    let resolved = std::fs::canonicalize(path).map_err(|_| LINK_UNAVAILABLE.to_string())?;
    if !resolved.is_file()
        || is_network_or_device_path(&resolved)
        || !has_markdown_extension(&resolved)
    {
        return Err(LINK_UNAVAILABLE.into());
    }
    Ok(resolved)
}

#[tauri::command]
pub fn resolve_markdown_link(
    document_path: Option<String>,
    source: String,
) -> Result<String, String> {
    let resolved = resolve_markdown_path(document_path.as_deref().map(Path::new), &source)?;
    resolved
        .into_os_string()
        .into_string()
        .map_err(|_| INVALID_LINK.to_string())
}

#[cfg(test)]
mod tests {
    use super::{markdown_candidate, resolve_markdown_path, split_source_suffix, NO_DOCUMENT_PATH};
    use std::fs;
    use std::path::PathBuf;

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("README.md"), "# root").unwrap();
        let docs = root.path().join("docs");
        fs::create_dir_all(docs.join("nested")).unwrap();
        fs::write(docs.join("README.md"), "# readme").unwrap();
        fs::write(docs.join("showcase.md"), "# showcase").unwrap();
        fs::write(docs.join("中文 笔记.MARKDOWN"), "# 中文").unwrap();
        fs::write(docs.join("a#b.md"), "# hash").unwrap();
        fs::write(docs.join("nested/note.md"), "# note").unwrap();
        fs::create_dir_all(docs.join("dir.md")).unwrap();
        let other = root.path().join("other");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("showcase.md"), "# other").unwrap();
        fs::write(other.join("README.md"), "# other readme").unwrap();
        let document = docs.join("README.md");
        (root, document)
    }

    #[test]
    fn resolves_relative_markdown_from_the_document_directory() {
        let (root, document) = fixture();
        let root_document = root.path().join("README.md");
        let expected = fs::canonicalize(document.parent().unwrap().join("showcase.md")).unwrap();
        assert_eq!(
            resolve_markdown_path(Some(&root_document), "docs/showcase.md").unwrap(),
            expected
        );
        assert_eq!(
            resolve_markdown_path(Some(&document), "./showcase.md").unwrap(),
            expected
        );
    }

    #[test]
    fn resolves_parent_segments_chinese_spaces_and_uppercase_extension() {
        let (_root, document) = fixture();
        let nested = document.parent().unwrap().join("nested/note.md");
        assert_eq!(
            resolve_markdown_path(Some(&nested), "../showcase.md").unwrap(),
            fs::canonicalize(document.parent().unwrap().join("showcase.md")).unwrap()
        );
        assert_eq!(
            resolve_markdown_path(Some(&document), "%E4%B8%AD%E6%96%87%20%E7%AC%94%E8%AE%B0.MARKDOWN")
                .unwrap(),
            fs::canonicalize(document.parent().unwrap().join("中文 笔记.MARKDOWN")).unwrap()
        );
    }

    #[test]
    fn resolves_encoded_hash_in_file_name_and_strips_the_fragment() {
        let (_root, document) = fixture();
        assert_eq!(
            resolve_markdown_path(Some(&document), "a%23b.md#heading").unwrap(),
            fs::canonicalize(document.parent().unwrap().join("a#b.md")).unwrap()
        );
    }

    #[test]
    fn encoded_question_mark_stays_part_of_the_file_name() {
        let (_root, document) = fixture();
        // Windows 文件名不能包含 `?`，这里只验证候选路径的切分与解码。
        let candidate = markdown_candidate(Some(&document), "a%3Fb.md?view=1").unwrap();
        assert_eq!(
            candidate,
            document.parent().unwrap().join("a?b.md"),
            "{}",
            candidate.display()
        );
        assert_eq!(
            split_source_suffix("a%3Fb.md?view=1"),
            ("a%3Fb.md", "?view=1")
        );
    }

    #[test]
    fn resolves_absolute_paths_and_local_file_urls_without_a_document() {
        let (_root, document) = fixture();
        let target = document.parent().unwrap().join("showcase.md");
        let expected = fs::canonicalize(&target).unwrap();
        assert_eq!(
            resolve_markdown_path(None, target.to_str().unwrap()).unwrap(),
            expected
        );
        let url = url::Url::from_file_path(&target).unwrap();
        assert_eq!(
            resolve_markdown_path(None, url.as_str()).unwrap(),
            expected
        );
    }

    #[test]
    fn same_relative_name_resolves_against_each_document_directory() {
        let (root, document) = fixture();
        let other = root.path().join("other/README.md");
        assert_eq!(
            resolve_markdown_path(Some(&document), "showcase.md").unwrap(),
            fs::canonicalize(root.path().join("docs/showcase.md")).unwrap()
        );
        assert_eq!(
            resolve_markdown_path(Some(&other), "showcase.md").unwrap(),
            fs::canonicalize(root.path().join("other/showcase.md")).unwrap()
        );
    }

    #[test]
    fn rejects_relative_paths_without_a_usable_document() {
        let (_root, document) = fixture();
        assert_eq!(
            resolve_markdown_path(None, "showcase.md").unwrap_err(),
            NO_DOCUMENT_PATH
        );
        assert_eq!(
            resolve_markdown_path(Some(std::path::Path::new("relative/README.md")), "showcase.md")
                .unwrap_err(),
            NO_DOCUMENT_PATH
        );
    }

    #[test]
    fn rejects_missing_directories_and_non_markdown_targets() {
        let (_root, document) = fixture();
        for source in ["missing.md", "dir.md", "showcase.pdf", "README.md.png", ""] {
            assert!(
                resolve_markdown_path(Some(&document), source).is_err(),
                "{source}"
            );
        }
    }

    #[test]
    fn rejects_invalid_encodings_and_unsupported_schemes() {
        let (_root, document) = fixture();
        for source in [
            "show%GG.md",
            "show%FF.md",
            "show%2",
            "javascript:alert(1)",
            "data:text/html,x",
            "https://example.test/a.md",
            "#heading",
            "?view=1",
        ] {
            assert!(
                resolve_markdown_path(Some(&document), source).is_err(),
                "{source}"
            );
        }
    }

    #[test]
    fn rejects_network_share_and_device_paths() {
        let (_root, document) = fixture();
        for source in [
            "//server/share/a.md",
            "\\\\server\\share\\a.md",
            "file://server/share/a.md",
            "%5C%5Cexample.invalid%5Cshare%5Ca.md",
            "%2F%2Fexample.invalid/share/a.md",
        ] {
            assert!(
                resolve_markdown_path(Some(&document), source).is_err(),
                "{source}"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn rejects_windows_device_namespaces() {
        let (_root, document) = fixture();
        for source in [r"\\.\COM1", r"\\?\UNC\server\share\a.md"] {
            assert!(
                resolve_markdown_path(Some(&document), source).is_err(),
                "{source}"
            );
        }
    }
}
