use crate::local_paths::{
    has_url_scheme, is_network_or_device_path, is_windows_drive_path, split_source_suffix,
    valid_percent_encoding,
};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// 图片地址与链接地址共用同一套后缀切分规则。
fn split_image_source(source: &str) -> (&str, &str) {
    split_source_suffix(source)
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

static PASTED_IMAGE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn save_pasted_image_bytes(document: &Path, mime: &str, bytes: &[u8]) -> Result<String, String> {
    if !document.is_absolute() || is_network_or_device_path(document) || !document.is_file() {
        return Err("INVALID_IMAGE_DOCUMENT".into());
    }
    let extension = match mime.to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/avif" => "avif",
        "image/svg+xml" => "svg",
        _ => return Err("UNSUPPORTED_IMAGE_FORMAT".into()),
    };
    if bytes.is_empty() {
        return Err("EMPTY_IMAGE".into());
    }
    let directory = document
        .parent()
        .ok_or("INVALID_IMAGE_DOCUMENT")?
        .join("images");
    std::fs::create_dir_all(&directory).map_err(|_| "IMAGE_SAVE_FAILED")?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "IMAGE_SAVE_FAILED")?
        .as_nanos();
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let permissions = std::fs::metadata(document)
            .map_err(|_| "IMAGE_SAVE_FAILED")?
            .permissions()
            .mode();
        options.mode(permissions & 0o666);
    }
    loop {
        let sequence = PASTED_IMAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let name = format!("pasted-{timestamp}-{sequence}.{extension}");
        let path = directory.join(&name);
        let mut file = match options.open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("IMAGE_SAVE_FAILED".into()),
        };
        if file.write_all(bytes).is_err() {
            drop(file);
            let _ = std::fs::remove_file(&path);
            return Err("IMAGE_SAVE_FAILED".into());
        }
        return Ok(format!("images/{name}"));
    }
}

#[tauri::command]
pub fn save_pasted_image(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let path = request
        .headers()
        .get("x-document-path")
        .and_then(|value| value.to_str().ok())
        .ok_or("INVALID_IMAGE_DOCUMENT")?;
    let path = percent_encoding::percent_decode_str(path)
        .decode_utf8()
        .map_err(|_| "INVALID_IMAGE_DOCUMENT")?;
    let mime = request
        .headers()
        .get("x-image-mime")
        .and_then(|value| value.to_str().ok())
        .ok_or("UNSUPPORTED_IMAGE_FORMAT")?;
    let bytes = pasted_image_payload(request.body())?;
    save_pasted_image_bytes(Path::new(path.as_ref()), mime, bytes.as_ref())
}

fn pasted_image_payload(
    body: &tauri::ipc::InvokeBody,
) -> Result<std::borrow::Cow<'_, [u8]>, String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(std::borrow::Cow::Borrowed(bytes)),
        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value::<Vec<u8>>(value.clone())
            .map(std::borrow::Cow::Owned)
            .map_err(|_| "EMPTY_IMAGE".into()),
    }
}

fn copy_pasted_image_source(document: &Path, source: &str) -> Result<String, String> {
    let url = url::Url::parse(source).map_err(|_| "INVALID_IMAGE_PATH")?;
    if url.scheme() != "file" || url.host_str().is_some_and(|host| host != "localhost") {
        return Err("INVALID_IMAGE_PATH".into());
    }
    let path = url.to_file_path().map_err(|_| "INVALID_IMAGE_PATH")?;
    if is_network_or_device_path(&path) {
        return Err("INVALID_IMAGE_PATH".into());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        _ => return Err("UNSUPPORTED_IMAGE_FORMAT".into()),
    };
    let bytes = std::fs::read(path).map_err(|_| "IMAGE_UNAVAILABLE")?;
    save_pasted_image_bytes(document, mime, &bytes)
}

#[tauri::command]
pub fn copy_pasted_image(document_path: String, source: String) -> Result<String, String> {
    copy_pasted_image_source(Path::new(&document_path), &source)
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

    #[test]
    fn pasted_image_is_written_next_to_the_document_and_referenced_relatively() {
        let root = tempfile::tempdir().unwrap();
        let document = root.path().join("note.md");
        fs::write(&document, "# note").unwrap();

        let relative =
            super::save_pasted_image_bytes(&document, "image/png", b"first image").unwrap();

        assert!(relative.starts_with("images/"));
        assert!(relative.ends_with(".png"));
        assert_eq!(
            fs::read(root.path().join(relative)).unwrap(),
            b"first image"
        );
    }

    #[test]
    fn pasted_images_never_overwrite_one_another() {
        let (_root, document, existing) = fixture();
        let first = super::save_pasted_image_bytes(&document, "image/jpeg", b"first").unwrap();
        let second = super::save_pasted_image_bytes(&document, "image/jpeg", b"second").unwrap();

        assert_ne!(first, second);
        assert!(first.ends_with(".jpg"));
        assert_eq!(
            fs::read(document.parent().unwrap().join(first)).unwrap(),
            b"first"
        );
        assert_eq!(
            fs::read(document.parent().unwrap().join(second)).unwrap(),
            b"second"
        );
        assert_eq!(fs::read(existing).unwrap(), b"test image");
    }

    #[test]
    fn pasted_image_requires_a_saved_document_and_a_supported_format() {
        let root = tempfile::tempdir().unwrap();
        let document = root.path().join("missing.md");
        assert!(super::save_pasted_image_bytes(&document, "image/png", b"image").is_err());
        fs::write(&document, "# note").unwrap();
        assert!(super::save_pasted_image_bytes(&document, "image/unknown", b"image").is_err());
        assert!(!root.path().join("images").exists());
    }

    #[test]
    fn copies_a_local_clipboard_image_into_the_document_images_directory() {
        let root = tempfile::tempdir().unwrap();
        let document = root.path().join("note.md");
        let source = root.path().join("源 图.png");
        fs::write(&document, "# note").unwrap();
        fs::write(&source, b"image bytes").unwrap();
        let uri = url::Url::from_file_path(&source).unwrap();

        let relative = super::copy_pasted_image_source(&document, uri.as_str()).unwrap();

        assert!(relative.starts_with("images/"));
        assert_eq!(
            fs::read(root.path().join(relative)).unwrap(),
            b"image bytes"
        );
        assert!(super::copy_pasted_image_source(&document, "file://server/share/a.png").is_err());
        assert!(super::copy_pasted_image_source(&document, "https://example.test/a.png").is_err());
    }

    #[test]
    fn accepts_binary_and_json_ipc_image_payloads() {
        use tauri::ipc::InvokeBody;
        let raw = InvokeBody::Raw(vec![1, 2, 3]);
        let fallback = InvokeBody::Json(serde_json::json!([1, 2, 3]));
        assert_eq!(
            super::pasted_image_payload(&raw).unwrap().as_ref(),
            &[1, 2, 3]
        );
        assert_eq!(
            super::pasted_image_payload(&fallback).unwrap().as_ref(),
            &[1, 2, 3]
        );
        assert!(super::pasted_image_payload(&InvokeBody::Json(serde_json::json!([999]))).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn pasted_image_does_not_have_more_read_permissions_than_the_document() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let document = root.path().join("private.md");
        fs::write(&document, "# private").unwrap();
        fs::set_permissions(&document, fs::Permissions::from_mode(0o600)).unwrap();

        let relative = super::save_pasted_image_bytes(&document, "image/png", b"image").unwrap();

        let mode = fs::metadata(root.path().join(relative))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0);
    }
}
