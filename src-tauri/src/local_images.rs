use std::path::{Path, PathBuf};
use tauri::Manager;

fn split_image_source(source: &str) -> (&str, &str) {
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

fn valid_percent_encoding(source: &str) -> bool {
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

fn is_windows_drive_path(source: &str) -> bool {
    let bytes = source.as_bytes();
    cfg!(windows)
        && bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

fn has_url_scheme(source: &str) -> bool {
    let Some((scheme, _)) = source.split_once(':') else {
        return false;
    };
    let mut chars = scheme.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
}

fn is_network_or_device_path(path: &Path) -> bool {
    #[cfg(windows)]
    if let Some(std::path::Component::Prefix(prefix)) = path.components().next() {
        use std::path::Prefix;
        return !matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_));
    }
    let text = path.as_os_str().to_string_lossy();
    let bytes = text.as_bytes();
    bytes.len() >= 2 && matches!(bytes[0], b'/' | b'\\') && matches!(bytes[1], b'/' | b'\\')
}

fn resolve_image_candidate(document_path: &Path, source: &str) -> Result<PathBuf, String> {
    const INVALID: &str = "INVALID_IMAGE_PATH";
    if source.is_empty()
        || !document_path.is_absolute()
        || is_network_or_device_path(document_path)
        || is_network_or_device_path(Path::new(source))
        || !valid_percent_encoding(source)
    {
        return Err(INVALID.into());
    }

    let path = if source
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("file:"))
    {
        let url = url::Url::parse(source).map_err(|_| INVALID.to_string())?;
        if url.host_str().is_some_and(|host| host != "localhost") {
            return Err(INVALID.into());
        }
        url.to_file_path().map_err(|_| INVALID.to_string())?
    } else {
        if !is_windows_drive_path(source) && has_url_scheme(source) {
            return Err(INVALID.into());
        }
        let decoded = percent_encoding::percent_decode_str(source)
            .decode_utf8()
            .map_err(|_| INVALID.to_string())?;
        let candidate = Path::new(decoded.as_ref());
        if is_network_or_device_path(candidate) {
            return Err(INVALID.into());
        }
        if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            document_path.parent().ok_or(INVALID)?.join(candidate)
        }
    };

    if is_network_or_device_path(&path) {
        return Err(INVALID.into());
    }
    Ok(path)
}

fn resolve_image_path(document_path: &Path, source: &str) -> Result<PathBuf, String> {
    let path = resolve_image_candidate(document_path, source)?;
    let resolved = std::fs::canonicalize(path).map_err(|_| "IMAGE_UNAVAILABLE".to_string())?;
    if !resolved.is_file() {
        return Err("IMAGE_UNAVAILABLE".into());
    }
    Ok(resolved)
}

#[tauri::command]
pub fn resolve_document_image(
    webview: tauri::WebviewWindow,
    document_path: String,
    source: String,
) -> Result<String, String> {
    let (source_path, suffix) = split_image_source(&source);
    let image = resolve_image_path(Path::new(&document_path), source_path)?;
    webview
        .asset_protocol_scope()
        .allow_file(&image)
        .map_err(|_| "IMAGE_UNAVAILABLE".to_string())?;
    let url = webview
        .convert_file_src(&image, None)
        .map_err(|_| "IMAGE_UNAVAILABLE".to_string())?;
    Ok(format!("{url}{suffix}"))
}

#[cfg(test)]
mod tests {
    use super::{resolve_image_candidate, resolve_image_path, split_image_source};
    use std::fs;
    use std::path::{Path, PathBuf};

    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let docs = root.path().join("docs");
        let images = docs.join("images");
        fs::create_dir_all(&images).unwrap();
        let document = docs.join("README.md");
        fs::write(&document, "# document").unwrap();
        let image = images.join("中文 #.png");
        fs::write(&image, b"test image").unwrap();
        (root, document, image)
    }

    #[test]
    fn resolves_relative_image_from_document_directory() {
        let (_root, document, image) = fixture();
        let resolved =
            resolve_image_path(&document, "./images/%E4%B8%AD%E6%96%87%20%23.png").unwrap();
        assert_eq!(resolved, fs::canonicalize(image).unwrap());
    }

    #[test]
    fn accepts_a_canonical_local_document_path() {
        let (_root, document, image) = fixture();
        let document = fs::canonicalize(document).unwrap();
        let resolved =
            resolve_image_path(&document, "images/%E4%B8%AD%E6%96%87%20%23.png").unwrap();
        assert_eq!(resolved, fs::canonicalize(image).unwrap());
    }

    #[test]
    fn resolves_parent_segments_from_nested_documents() {
        let (root, _document, image) = fixture();
        let nested = root.path().join("docs/nested/note.md");
        fs::create_dir_all(nested.parent().unwrap()).unwrap();
        fs::write(&nested, "# nested").unwrap();
        let resolved = resolve_image_path(&nested, "../images/中文 %23.png").unwrap();
        assert_eq!(resolved, fs::canonicalize(image).unwrap());
    }

    #[test]
    fn resolves_absolute_paths_and_local_file_urls() {
        let (_root, document, image) = fixture();
        let expected = fs::canonicalize(&image).unwrap();
        assert_eq!(
            resolve_image_path(&document, image.to_str().unwrap()).unwrap(),
            expected
        );
        let path = image
            .to_str()
            .unwrap()
            .replace('\\', "/")
            .replace(' ', "%20")
            .replace('#', "%23");
        let uri = if cfg!(windows) {
            format!("file:///{path}")
        } else {
            format!("file://{path}")
        };
        assert_eq!(resolve_image_path(&document, &uri).unwrap(), expected);
    }

    #[test]
    fn keeps_query_and_fragment_separate_from_encoded_filename() {
        assert_eq!(
            split_image_source("images/a%3Fb%23c.png?size=1#view"),
            ("images/a%3Fb%23c.png", "?size=1#view")
        );
        assert_eq!(
            split_image_source("images/a.png#view"),
            ("images/a.png", "#view")
        );
        assert_eq!(split_image_source("images/a.png"), ("images/a.png", ""));
    }

    #[test]
    fn rejects_nonlocal_invalid_and_missing_sources() {
        let (_root, document, _image) = fixture();
        for source in [
            "https://example.test/image.png",
            "//example.test/image.png",
            "data:image/png;base64,AAAA",
            "file://server/share/image.png",
            "images/does-not-exist.png",
            "images/invalid%GG.png",
            "images/invalid%FF.png",
            "",
        ] {
            assert!(resolve_image_path(&document, source).is_err(), "{source}");
        }
        assert!(resolve_image_path(&document, Path::new("images").to_str().unwrap()).is_err());
    }

    #[test]
    fn rejects_encoded_network_and_device_paths_before_filesystem_access() {
        let (_root, document, _image) = fixture();
        for source in [
            "%5C%5Cexample.invalid%5Cshare%5Cimage.png",
            "%2F%2Fexample.invalid/share/image.png",
            "%5C%2Fexample.invalid/share/image.png",
            "%2F%5Cexample.invalid/share/image.png",
            "%5C%5C%3F%5CUNC%5Cexample.invalid%5Cshare%5Cimage.png",
            "%5C%5C.%5CCOM1",
            "file://example.invalid/share/image.png",
            "file:///%5C%5Cexample.invalid%5Cshare%5Cimage.png",
            "file:////example.invalid/share/image.png",
        ] {
            assert!(
                resolve_image_candidate(&document, source).is_err(),
                "{source}"
            );
        }
        assert!(
            resolve_image_candidate(Path::new("//example.invalid/share/note.md"), "image.png")
                .is_err()
        );
    }

    #[cfg(windows)]
    #[test]
    fn accepts_local_verbatim_disk_paths_without_filesystem_access() {
        let (_root, document, _image) = fixture();
        let source = "%5C%5C%3F%5CC%3A%5Cimage.png";
        assert_eq!(
            resolve_image_candidate(&document, source).unwrap(),
            PathBuf::from(r"\\?\C:\image.png")
        );
        assert_eq!(
            split_image_source(r"\\?\C:\image.png?size=1"),
            (r"\\?\C:\image.png", "?size=1")
        );
    }
}
