//! What a workspace snapshot *is*, with none of the Win32 that captures
//! or applies one.
//!
//! Keeping the shape and the matching rules here means settings can store
//! snapshots without the config layer reaching into the platform layer,
//! and the tricky parts (pairing saved windows back to live ones, keeping
//! windows on a screen that still exists) are testable on any machine.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::names::exe_key;

/// How a window was showing when the snapshot was taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowState {
    Normal,
    Minimized,
    Maximized,
}

/// A plain rectangle that survives JSON. Screen coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl SnapRect {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }
    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
}

/// One remembered window.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSnapshot {
    /// Full path of the owning executable, used to relaunch.
    pub exe: String,
    /// Title at capture time, used to pair windows back up.
    pub title: String,
    /// AppUserModelID for packaged apps, which launch differently.
    #[serde(default)]
    pub aumid: Option<String>,
    /// Device name of the monitor the window was on, e.g. `\\.\DISPLAY1`.
    #[serde(default)]
    pub monitor: String,
    /// Restored geometry, independent of the show state.
    pub rect: SnapRect,
    pub state: WindowState,
}

impl WindowSnapshot {
    /// What to hand the launcher to bring this app back.
    pub fn launch_target(&self) -> String {
        match &self.aumid {
            Some(aumid) => format!("shell:AppsFolder\\{aumid}"),
            None => self.exe.clone(),
        }
    }
}

/// Everything remembered about a desktop at one moment.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    #[serde(default)]
    pub windows: Vec<WindowSnapshot>,
    /// Unix seconds, so settings can say how old a snapshot is.
    #[serde(default)]
    pub captured_at: u64,
}

impl WorkspaceSnapshot {
    pub fn is_empty(&self) -> bool {
        self.windows.is_empty()
    }

    /// Distinct executables in the snapshot, in first-seen order.
    pub fn apps(&self) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for w in &self.windows {
            if seen.insert(exe_key(&w.exe)) {
                out.push(w.exe.clone());
            }
        }
        out
    }
}

/// Pick the live window that best corresponds to a remembered one.
///
/// Candidates are `(index, exe, title)`. Only windows from the same
/// executable are eligible; among those an exact title wins, then the
/// longest shared prefix. `used` holds indices already claimed by an
/// earlier entry so two saved windows never fight over the same live one.
pub fn best_match(
    snap_exe: &str,
    snap_title: &str,
    candidates: &[(usize, String, String)],
    used: &HashSet<usize>,
) -> Option<usize> {
    let want = exe_key(snap_exe);
    let eligible: Vec<&(usize, String, String)> = candidates
        .iter()
        .filter(|(i, exe, _)| !used.contains(i) && exe_key(exe) == want)
        .collect();
    if eligible.is_empty() {
        return None;
    }
    if let Some(hit) = eligible.iter().find(|(_, _, title)| title == snap_title) {
        return Some(hit.0);
    }
    // documents reopen with a changed title ("file.txt - Notepad" becomes
    // "*file.txt - Notepad"), so fall back to the longest shared prefix
    eligible
        .iter()
        .max_by_key(|(_, _, title)| shared_prefix_len(title, snap_title))
        .map(|(i, _, _)| *i)
}

fn shared_prefix_len(a: &str, b: &str) -> usize {
    a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count()
}

/// Pull a rectangle back onto a monitor that actually exists.
///
/// Returns the rect unchanged when a usable part of it lands inside one
/// of the given work areas. Otherwise it is centered on `fallback`,
/// keeping its size where that fits, so unplugging a second screen cannot
/// strand windows off the edge of the desktop.
pub fn clamp_onto(rect: SnapRect, work_areas: &[SnapRect], fallback: SnapRect) -> SnapRect {
    // enough of the title bar has to be grabbable for the window to count
    // as reachable
    const NEEDED_X: i32 = 80;
    const NEEDED_Y: i32 = 20;
    let reachable = work_areas.iter().any(|area| {
        let ox = (rect.right.min(area.right) - rect.left.max(area.left)).max(0);
        let oy = (rect.bottom.min(area.bottom) - rect.top.max(area.top)).max(0);
        ox >= NEEDED_X && oy >= NEEDED_Y
    });
    if reachable {
        return rect;
    }
    let w = rect.width().clamp(120, fallback.width().max(120));
    let h = rect.height().clamp(80, fallback.height().max(80));
    let left = fallback.left + ((fallback.width() - w) / 2).max(0);
    let top = fallback.top + ((fallback.height() - h) / 2).max(0);
    SnapRect {
        left,
        top,
        right: left + w,
        bottom: top + h,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> SnapRect {
        SnapRect { left, top, right, bottom }
    }

    fn snap(exe: &str, title: &str) -> WindowSnapshot {
        WindowSnapshot {
            exe: exe.into(),
            title: title.into(),
            aumid: None,
            monitor: String::new(),
            rect: rect(0, 0, 100, 100),
            state: WindowState::Normal,
        }
    }

    #[test]
    fn an_exact_title_wins_over_a_similar_one() {
        let candidates = vec![
            (0, "notepad.exe".into(), "draft.txt - Notepad".into()),
            (1, "notepad.exe".into(), "notes.txt - Notepad".into()),
        ];
        let hit = best_match(
            r"C:\Windows\notepad.exe",
            "notes.txt - Notepad",
            &candidates,
            &HashSet::new(),
        );
        assert_eq!(hit, Some(1));
    }

    #[test]
    fn a_renamed_title_still_matches_on_its_prefix() {
        let candidates = vec![
            (0, "code.exe".into(), "other - Code".into()),
            (1, "code.exe".into(), "report.md - Visual Studio Code".into()),
        ];
        let hit = best_match(
            r"C:\Code\Code.exe",
            "report.md - Visual Studio Code - unsaved",
            &candidates,
            &HashSet::new(),
        );
        assert_eq!(hit, Some(1));
    }

    #[test]
    fn a_window_is_never_claimed_twice() {
        let candidates = vec![(0, "notepad.exe".into(), "a - Notepad".into())];
        let mut used = HashSet::new();
        let first = best_match("notepad.exe", "a - Notepad", &candidates, &used).unwrap();
        used.insert(first);
        assert_eq!(
            best_match("notepad.exe", "a - Notepad", &candidates, &used),
            None
        );
    }

    #[test]
    fn a_different_app_never_matches() {
        let candidates = vec![(0, "notepad.exe".into(), "same title".into())];
        assert_eq!(
            best_match("wordpad.exe", "same title", &candidates, &HashSet::new()),
            None
        );
    }

    #[test]
    fn the_same_app_from_a_different_folder_still_matches() {
        let candidates = vec![(0, r"D:\portable\Code.exe".into(), "x".into())];
        assert_eq!(
            best_match(r"C:\Program Files\Code.exe", "x", &candidates, &HashSet::new()),
            Some(0)
        );
    }

    #[test]
    fn a_rect_already_on_screen_is_left_alone() {
        let screen = rect(0, 0, 1920, 1040);
        let win = rect(100, 100, 900, 700);
        assert_eq!(clamp_onto(win, &[screen], screen), win);
    }

    #[test]
    fn a_rect_from_an_unplugged_monitor_comes_back_onto_the_primary() {
        let primary = rect(0, 0, 1920, 1040);
        let orphan = rect(2400, 300, 3200, 900);
        let fixed = clamp_onto(orphan, &[primary], primary);
        assert_ne!(fixed, orphan);
        assert!(fixed.left >= primary.left && fixed.right <= primary.right);
        assert!(fixed.top >= primary.top && fixed.bottom <= primary.bottom);
        // and it keeps the size it had
        assert_eq!(fixed.width(), orphan.width());
        assert_eq!(fixed.height(), orphan.height());
    }

    #[test]
    fn a_window_hanging_off_the_edge_by_a_sliver_is_pulled_back() {
        let primary = rect(0, 0, 1920, 1040);
        // only 20px wide on screen, under the threshold
        let sliver = rect(1900, 500, 2700, 1000);
        assert_ne!(clamp_onto(sliver, &[primary], primary), sliver);
    }

    #[test]
    fn a_window_on_a_second_screen_that_is_still_there_is_kept() {
        let primary = rect(0, 0, 1920, 1040);
        let second = rect(1920, 0, 3840, 1040);
        let win = rect(2400, 300, 3200, 900);
        assert_eq!(clamp_onto(win, &[primary, second], primary), win);
    }

    #[test]
    fn an_oversized_rect_is_shrunk_to_fit_the_fallback() {
        let primary = rect(0, 0, 1280, 720);
        let huge = rect(4000, 4000, 7000, 6000);
        let fixed = clamp_onto(huge, &[primary], primary);
        assert!(fixed.width() <= primary.width());
        assert!(fixed.height() <= primary.height());
    }

    #[test]
    fn clamping_survives_having_no_monitors_at_all() {
        let fallback = rect(0, 0, 1920, 1040);
        let win = rect(100, 100, 900, 700);
        // an empty monitor list must not panic or produce a broken rect
        let fixed = clamp_onto(win, &[], fallback);
        assert!(fixed.width() > 0 && fixed.height() > 0);
    }

    #[test]
    fn packaged_apps_relaunch_through_their_aumid() {
        let mut s = snap(r"C:\Windows\System32\ApplicationFrameHost.exe", "Calculator");
        s.aumid = Some("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App".into());
        assert_eq!(
            s.launch_target(),
            r"shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"
        );
    }

    #[test]
    fn plain_apps_relaunch_through_their_executable() {
        assert_eq!(
            snap(r"C:\Windows\notepad.exe", "Untitled").launch_target(),
            r"C:\Windows\notepad.exe"
        );
    }

    #[test]
    fn distinct_apps_are_listed_once_each() {
        let ws = WorkspaceSnapshot {
            windows: vec![
                snap(r"C:\a\Code.exe", "one"),
                snap(r"C:\a\code.exe", "two"),
                snap(r"C:\b\notepad.exe", "three"),
            ],
            captured_at: 0,
        };
        assert_eq!(ws.apps().len(), 2);
    }

    #[test]
    fn a_snapshot_round_trips_through_json() {
        let ws = WorkspaceSnapshot {
            windows: vec![WindowSnapshot {
                exe: r"C:\Windows\notepad.exe".into(),
                title: "Untitled - Notepad".into(),
                aumid: None,
                monitor: r"\\.\DISPLAY1".into(),
                rect: rect(10, 20, 810, 620),
                state: WindowState::Maximized,
            }],
            captured_at: 1_700_000_000,
        };
        let json = serde_json::to_string(&ws).unwrap();
        let back: WorkspaceSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(back.windows[0].rect, ws.windows[0].rect);
        assert_eq!(back.windows[0].state, WindowState::Maximized);
        assert_eq!(back.captured_at, 1_700_000_000);
    }
}
