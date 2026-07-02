//! Recent files: resolve the shortcuts Windows keeps in the Recent
//! folder, newest first. Powers the search overlay's recent section.

use std::path::Path;

use serde::Serialize;
use windows::core::PCWSTR;
use windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink, SLGP_UNCPRIORITY};

use super::util::{from_wide, path_key, to_wide};
use crate::core::AeroResult;
use crate::platform::ComApartment;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub name: String,
    pub path: String,
    /// Icon cache key (resolve via resolve_icons).
    pub icon: String,
    /// Last-used time as seconds since the epoch (from the .lnk mtime).
    pub used_at: u64,
}

/// Call from `spawn_blocking`.
pub fn list_recent(limit: usize) -> AeroResult<Vec<RecentFile>> {
    let recent_dir = std::env::var("APPDATA")
        .map(|a| Path::new(&a).join(r"Microsoft\Windows\Recent"))
        .map_err(|_| crate::core::AeroError::other("APPDATA not set"))?;

    let mut links: Vec<(std::path::PathBuf, u64)> = std::fs::read_dir(&recent_dir)?
        .flatten()
        .filter(|e| {
            e.path()
                .extension()
                .is_some_and(|x| x.eq_ignore_ascii_case("lnk"))
        })
        .filter_map(|e| {
            let mtime = e
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_secs();
            Some((e.path(), mtime))
        })
        .collect();
    links.sort_by(|a, b| b.1.cmp(&a.1));

    let _com = ComApartment::new();
    let link: IShellLinkW = unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)? };
    let persist: IPersistFile = windows::core::Interface::cast(&link)?;

    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (lnk, used_at) in links {
        if out.len() >= limit {
            break;
        }
        let wide = to_wide(&lnk.to_string_lossy());
        if unsafe { persist.Load(PCWSTR(wide.as_ptr()), STGM_READ) }.is_err() {
            continue;
        }
        let mut buf = [0u16; 260];
        if unsafe { link.GetPath(&mut buf, std::ptr::null_mut(), SLGP_UNCPRIORITY.0 as u32) }
            .is_err()
        {
            continue;
        }
        let target = from_wide(&buf);
        if target.is_empty() || !Path::new(&target).exists() {
            continue;
        }
        // folders show up here too; keep files only — folders are pinnable
        if Path::new(&target).is_dir() {
            continue;
        }
        if !seen.insert(target.to_lowercase()) {
            continue;
        }
        let name = lnk
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| target.clone());
        out.push(RecentFile {
            icon: path_key(&target),
            name,
            path: target,
            used_at,
        });
    }
    Ok(out)
}
