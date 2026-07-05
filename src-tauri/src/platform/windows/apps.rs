//! Installed-app discovery: walks the Start Menu (system + user) and the
//! Desktop (user + public) for shortcuts, resolves each `.lnk` through
//! `IShellLinkW`, and dedupes by launch target. Runs on a blocking thread
//! with its own COM apartment.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use windows::core::PCWSTR;
use windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink, SLGP_UNCPRIORITY};

use super::util::{from_wide, path_key, to_wide};
use crate::core::AeroResult;
use crate::platform::{AppEntry, ComApartment};

const MAX_PATH_LEN: usize = 260;

/// Shortcut names that are never things a user pins to a dock.
const EXCLUDED_NAME_FRAGMENTS: &[&str] = &["uninstall", "readme", "release notes", "help", "documentation", "website"];

/// Target executables that are launchers-of-launchers or noise.
const EXCLUDED_TARGETS: &[&str] = &["unins000.exe", "uninstall.exe", "setup.exe", "install.exe", "repair.exe"];

struct ScanRoot {
    dir: PathBuf,
    source: &'static str,
}

fn scan_roots() -> Vec<ScanRoot> {
    let mut roots = Vec::new();
    if let Ok(pd) = std::env::var("ProgramData") {
        roots.push(ScanRoot {
            dir: Path::new(&pd).join(r"Microsoft\Windows\Start Menu\Programs"),
            source: "start-menu",
        });
    }
    if let Ok(ad) = std::env::var("APPDATA") {
        roots.push(ScanRoot {
            dir: Path::new(&ad).join(r"Microsoft\Windows\Start Menu\Programs"),
            source: "start-menu",
        });
    }
    if let Ok(up) = std::env::var("USERPROFILE") {
        roots.push(ScanRoot {
            dir: Path::new(&up).join("Desktop"),
            source: "desktop",
        });
    }
    if let Ok(pb) = std::env::var("PUBLIC") {
        roots.push(ScanRoot {
            dir: Path::new(&pb).join("Desktop"),
            source: "desktop",
        });
    }
    roots
}

/// Enumerate installed apps: Start Menu / Desktop shortcuts first
/// (exe targets — they match running windows for indicators), then
/// everything else from `shell:AppsFolder` (UWP/Store/system apps like
/// Settings that have no filesystem shortcut). Call from `spawn_blocking`.
pub fn enumerate_apps() -> AeroResult<Vec<AppEntry>> {
    let _com = ComApartment::new();
    let link: IShellLinkW = unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)? };
    let persist: IPersistFile = windows::core::Interface::cast(&link)?;

    let mut seen: HashSet<String> = HashSet::new();
    let mut names_seen: HashSet<String> = HashSet::new();
    let mut apps: Vec<AppEntry> = Vec::new();

    for root in scan_roots() {
        let mut lnk_files = Vec::new();
        collect_lnk_files(&root.dir, &mut lnk_files, 0);
        for lnk in lnk_files {
            if let Some(entry) = resolve_shortcut(&link, &persist, &lnk, root.source) {
                let dedupe = format!("{}|{}", entry.target_path.to_lowercase(), entry.args.to_lowercase());
                if seen.insert(dedupe) {
                    names_seen.insert(entry.name.to_lowercase());
                    apps.push(entry);
                }
            }
        }
    }

    match enumerate_apps_folder() {
        Ok(store_apps) => {
            for entry in store_apps {
                if names_seen.insert(entry.name.to_lowercase()) {
                    apps.push(entry);
                }
            }
        }
        Err(e) => log::warn!("AppsFolder enumeration failed: {e}"),
    }

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(apps)
}

/// Everything Start-menu search would show: enumerate the virtual
/// `shell:AppsFolder`. Packaged apps get `shell:AppsFolder\<AUMID>`
/// launch targets, which both ShellExecuteW and the icon extractor
/// understand as parsing names.
fn enumerate_apps_folder() -> AeroResult<Vec<AppEntry>> {
    use windows::Win32::UI::Shell::{
        IEnumShellItems, IShellItem, SHGetKnownFolderItem, BHID_EnumItems, FOLDERID_AppsFolder,
        KF_FLAG_DEFAULT, SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING,
    };

    let folder: IShellItem =
        unsafe { SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None)? };
    let items: IEnumShellItems = unsafe { folder.BindToHandler(None, &BHID_EnumItems)? };

    let mut out = Vec::new();
    loop {
        let mut batch = [const { None }; 8];
        let mut fetched = 0u32;
        let hr = unsafe { items.Next(&mut batch, Some(&mut fetched)) };
        if hr.is_err() || fetched == 0 {
            break;
        }
        for item in batch.iter().take(fetched as usize).flatten() {
            let name = match unsafe { item.GetDisplayName(SIGDN_NORMALDISPLAY) } {
                Ok(p) => unsafe { pwstr_to_string(p) },
                Err(_) => continue,
            };
            let parsing = match unsafe { item.GetDisplayName(SIGDN_PARENTRELATIVEPARSING) } {
                Ok(p) => unsafe { pwstr_to_string(p) },
                Err(_) => continue,
            };
            if name.is_empty() || parsing.is_empty() {
                continue;
            }
            // exe-backed entries already come from the shortcut scan with
            // richer data; AppsFolder is here for the packaged/virtual ones
            let target = format!("shell:AppsFolder\\{parsing}");
            out.push(AppEntry {
                icon: Some(path_key(&target)),
                name,
                shortcut_path: None,
                target_path: target,
                args: String::new(),
                source: "apps-folder".to_string(),
            });
        }
    }
    Ok(out)
}

/// Take ownership of a shell-allocated PWSTR and free it.
unsafe fn pwstr_to_string(p: windows::core::PWSTR) -> String {
    if p.is_null() {
        return String::new();
    }
    let s = unsafe { p.to_string() }.unwrap_or_default();
    unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(p.as_ptr() as *const _)) };
    s
}

/// Resolve one dropped/browsed path into a pinnable entry. `.lnk` files
/// are dereferenced through the shell; exes and documents pin as-is.
/// Call from `spawn_blocking`.
pub fn resolve_single(path: &str) -> AeroResult<AppEntry> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(crate::core::AeroError::other(format!("path not found: {path}")));
    }
    let is_lnk = p
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("lnk"));

    if is_lnk {
        let _com = ComApartment::new();
        let link: IShellLinkW = unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)? };
        let persist: IPersistFile = windows::core::Interface::cast(&link)?;
        // resolve without the launcher-noise filtering used for bulk scans:
        // an explicit user drop should always pin
        let wide = to_wide(path);
        unsafe { persist.Load(PCWSTR(wide.as_ptr()), STGM_READ)? };
        let mut target_buf = [0u16; MAX_PATH_LEN];
        unsafe {
            link.GetPath(&mut target_buf, std::ptr::null_mut(), SLGP_UNCPRIORITY.0 as u32)?
        };
        let target = from_wide(&target_buf);
        if target.is_empty() || !Path::new(&target).exists() {
            return Err(crate::core::AeroError::other(
                "shortcut has no filesystem target",
            ));
        }
        let mut args_buf = [0u16; 1024];
        let args = match unsafe { link.GetArguments(&mut args_buf) } {
            Ok(()) => from_wide(&args_buf),
            Err(_) => String::new(),
        };
        let name = p
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| target.clone());
        return Ok(AppEntry {
            icon: Some(path_key(&target)),
            name,
            shortcut_path: Some(path.to_string()),
            target_path: target,
            args,
            source: "desktop".to_string(),
        });
    }

    let name = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    Ok(AppEntry {
        icon: Some(path_key(path)),
        name,
        shortcut_path: None,
        target_path: path.to_string(),
        args: String::new(),
        source: if p.is_dir() { "folder" } else { "desktop" }.to_string(),
    })
}

fn collect_lnk_files(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_lnk_files(&path, out, depth + 1);
        } else if path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("lnk"))
        {
            out.push(path);
        }
    }
}

fn resolve_shortcut(
    link: &IShellLinkW,
    persist: &IPersistFile,
    lnk_path: &Path,
    source: &'static str,
) -> Option<AppEntry> {
    let name = lnk_path.file_stem()?.to_string_lossy().to_string();
    let name_lower = name.to_lowercase();
    if EXCLUDED_NAME_FRAGMENTS.iter().any(|f| name_lower.contains(f)) {
        return None;
    }

    let wide = to_wide(&lnk_path.to_string_lossy());
    unsafe { persist.Load(PCWSTR(wide.as_ptr()), STGM_READ).ok()? };

    let mut target_buf = [0u16; MAX_PATH_LEN];
    unsafe {
        link.GetPath(&mut target_buf, std::ptr::null_mut(), SLGP_UNCPRIORITY.0 as u32)
            .ok()?
    };
    let target = from_wide(&target_buf);
    if target.is_empty() {
        return None; // UWP/advertised shortcut without a filesystem target
    }

    let target_lower = target.to_lowercase();
    if !target_lower.ends_with(".exe") || !Path::new(&target).exists() {
        return None;
    }
    if EXCLUDED_TARGETS
        .iter()
        .any(|t| target_lower.ends_with(t))
    {
        return None;
    }

    let mut args_buf = [0u16; 1024];
    let args = match unsafe { link.GetArguments(&mut args_buf) } {
        Ok(()) => from_wide(&args_buf),
        Err(_) => String::new(),
    };

    Some(AppEntry {
        icon: Some(path_key(&target)),
        name,
        shortcut_path: Some(lnk_path.to_string_lossy().to_string()),
        target_path: target,
        args,
        source: source.to_string(),
    })
}
