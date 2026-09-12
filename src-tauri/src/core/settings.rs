//! Settings engine: a single versioned struct persisted as JSON at
//! `%APPDATA%\AeroDock\settings.json`, written atomically, with every
//! mutation pushed to the frontend as a full-struct `settings://changed`
//! event so the UI stays a pure function of settings.

use std::fs;
use std::path::{Path, PathBuf};

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::error::{AeroError, AeroResult};
use super::names::exe_key;
use super::workspace::WorkspaceSnapshot;

pub const SETTINGS_EVENT: &str = "settings://changed";
pub const CURRENT_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DockEdge {
    Top,
    #[default]
    Bottom,
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DockSettings {
    /// Which screen edge the dock lives on.
    pub edge: DockEdge,
    /// Monitor name (as reported by the OS); `None` = primary.
    pub monitor: Option<String>,
    /// Base icon size in logical pixels.
    pub icon_size: u32,
    /// Cursor-proximity magnification on hover.
    pub magnification: bool,
    /// Peak scale at the cursor (1.0 = off, 1.5 = 150%).
    pub magnification_scale: f32,
    /// Slide off-screen when not in use.
    pub auto_hide: bool,
    /// How long the pointer must be away before auto-hide slides the dock
    /// out, in milliseconds.
    pub auto_hide_delay_ms: u32,
    /// Floating mode: detached from the edge with a margin.
    pub floating: bool,
    /// Gap between dock and screen edge in floating mode (logical px).
    pub floating_margin: u32,
    /// Show currently running apps that aren't pinned.
    pub show_running_apps: bool,
    /// Built-in dock controls, each independently hideable.
    pub show_search_button: bool,
    pub show_settings_button: bool,
    pub show_clock: bool,
    /// Battery, network, volume and Recycle Bin glyphs.
    pub show_system_status: bool,
}

impl Default for DockSettings {
    fn default() -> Self {
        Self {
            edge: DockEdge::Bottom,
            monitor: None,
            icon_size: 48,
            magnification: true,
            magnification_scale: 1.45,
            auto_hide: false,
            auto_hide_delay_ms: 1400,
            floating: true,
            floating_margin: 8,
            show_running_apps: true,
            show_search_button: true,
            show_settings_button: true,
            show_clock: true,
            show_system_status: true,
        }
    }
}

/// How a surface is rendered.
///
/// Both are Frutiger Aero; they differ in how thick the material reads.
/// `Aero` is the glossy, beveled 2000s panel. `Liquid` keeps the same
/// palette but renders as a thin lens: most of the tint comes out of the
/// body and the work moves to the rim, where light enters and bends.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SurfaceStyle {
    #[default]
    Aero,
    Liquid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppearanceSettings {
    /// Theme id: aero | ocean | forest | aurora | sunset | night.
    pub theme: String,
    /// Overall dock opacity, 0.3..=1.0.
    pub transparency: f32,
    /// Glass blur/refraction intensity, 0.0..=1.0.
    pub glass_intensity: f32,
    /// Hover/launch bloom strength, 0.0..=1.0.
    pub bloom_amount: f32,
    /// Icon reflection strength, 0.0..=1.0.
    pub reflection_strength: f32,
    /// Ambient particle density, 0.0..=1.0 (0 disables particles).
    pub particle_density: f32,
    /// Ambient scene: none | dust | rain | snow | bubbles | aurora.
    pub scene: String,
    /// Global animation speed multiplier, 0.5..=2.0.
    pub animation_speed: f32,
    /// Tint the theme from the wallpaper's dominant color.
    pub wallpaper_sync: bool,
    /// Material used by the dock, its flyouts and its controls.
    pub dock_surface: SurfaceStyle,
    /// Material used by the settings window. Independent of the dock, so
    /// either window can be glossy while the other is a lens.
    pub settings_surface: SurfaceStyle,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: "aero".into(),
            transparency: 0.92,
            glass_intensity: 0.8,
            bloom_amount: 0.7,
            reflection_strength: 0.6,
            particle_density: 0.35,
            scene: "dust".into(),
            animation_speed: 1.0,
            wallpaper_sync: false,
            // Both windows keep the look the app has always had, so
            // upgrading changes nothing on screen. Liquid is opt-in.
            dock_surface: SurfaceStyle::Aero,
            settings_surface: SurfaceStyle::Aero,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PinKind {
    App,
    File,
    Folder,
    /// A dock folder holding other items (a "stack").
    Stack,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinnedItem {
    /// Stable id (uuid-ish string generated at pin time).
    pub id: String,
    pub kind: PinKind,
    /// Filesystem target. Empty for stacks.
    #[serde(default)]
    pub path: String,
    pub name: String,
    /// Icon cache key (see icons module); `None` = not yet extracted.
    #[serde(default)]
    pub icon: Option<String>,
    /// Children when `kind == Stack`.
    #[serde(default)]
    pub children: Vec<PinnedItem>,
}

/// Ceilings that stop a hand-edited or imported file from producing a
/// dock nobody can use, or a restore that grinds for minutes.
const MAX_MODES: usize = 12;
const MAX_SNAPSHOT_WINDOWS: usize = 200;

/// What a mode remembers about one app's audio.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppAudioPref {
    /// Lowercased executable file name, e.g. `discord.exe`.
    pub exe: String,
    /// 0..=100.
    pub volume: u8,
    pub muted: bool,
    /// Output endpoint chosen for this app; `None` follows the system.
    #[serde(default)]
    pub device_id: Option<String>,
}

/// One saved way of working: its own pins, its own window layout, and its
/// own per-app volumes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DockMode {
    pub id: String,
    pub name: String,
    /// A short glyph shown on the switcher tile. Empty means the UI picks.
    pub glyph: String,
    /// The pins this mode shows. Loaded into `Settings::pinned` while the
    /// mode is active, which is why every existing pin path keeps working.
    pub pinned: Vec<PinnedItem>,
    pub audio: Vec<AppAudioPref>,
    pub workspace: WorkspaceSnapshot,
    /// Executables that pull this mode to the front when they focus.
    pub auto_switch_apps: Vec<String>,
}

impl Default for DockMode {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: "Mode".into(),
            glyph: String::new(),
            pinned: Vec::new(),
            audio: Vec::new(),
            workspace: WorkspaceSnapshot::default(),
            auto_switch_apps: Vec::new(),
        }
    }
}

impl DockMode {
    /// Read one app's remembered audio, if this mode has an opinion.
    pub fn audio_for(&self, exe: &str) -> Option<&AppAudioPref> {
        let key = exe_key(exe);
        self.audio.iter().find(|a| a.exe == key)
    }

    /// Remember an app's audio, replacing any earlier entry for it.
    pub fn set_audio(&mut self, pref: AppAudioPref) {
        let key = exe_key(&pref.exe);
        self.audio.retain(|a| a.exe != key);
        self.audio.push(AppAudioPref { exe: key, ..pref });
    }

    /// True when this mode claims the given foreground app.
    pub fn claims(&self, exe: &str) -> bool {
        let key = exe_key(exe);
        self.auto_switch_apps.iter().any(|a| exe_key(a) == key)
    }
}

/// The Modes feature as a whole. Off by default, so upgrading changes
/// nothing until the user turns it on.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModesSettings {
    pub enabled: bool,
    /// Id of the mode currently loaded into the dock.
    pub active_id: String,
    pub modes: Vec<DockMode>,
    /// Follow the foreground app into whichever mode claims it.
    pub auto_switch: bool,
    /// Also put windows back when switching, not just pins and audio.
    pub restore_workspace_on_switch: bool,
}

impl Default for ModesSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            active_id: String::new(),
            modes: Vec::new(),
            auto_switch: false,
            restore_workspace_on_switch: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub schema_version: u32,
    pub dock: DockSettings,
    pub appearance: AppearanceSettings,
    pub pinned: Vec<PinnedItem>,
    pub launch_at_startup: bool,
    /// Put the Windows taskbar into auto-hide so Aero Dock is the bar.
    pub hide_taskbar: bool,
    pub onboarding_complete: bool,
    pub modes: ModesSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            dock: DockSettings::default(),
            appearance: AppearanceSettings::default(),
            pinned: Vec::new(),
            launch_at_startup: false,
            hide_taskbar: false,
            onboarding_complete: false,
            modes: ModesSettings::default(),
        }
    }
}

impl Settings {
    /// Clamp every numeric field into its documented range so a hand-edited
    /// or imported file can never push the renderer into a broken state.
    fn sanitize(&mut self) {
        let a = &mut self.appearance;
        a.transparency = a.transparency.clamp(0.3, 1.0);
        a.glass_intensity = a.glass_intensity.clamp(0.0, 1.0);
        a.bloom_amount = a.bloom_amount.clamp(0.0, 1.0);
        a.reflection_strength = a.reflection_strength.clamp(0.0, 1.0);
        a.particle_density = a.particle_density.clamp(0.0, 1.0);
        a.animation_speed = a.animation_speed.clamp(0.5, 2.0);
        let d = &mut self.dock;
        d.icon_size = d.icon_size.clamp(24, 96);
        d.magnification_scale = d.magnification_scale.clamp(1.0, 2.0);
        d.floating_margin = d.floating_margin.min(64);
        // below ~200ms the dock hides while you are still reaching for it
        d.auto_hide_delay_ms = d.auto_hide_delay_ms.clamp(200, 10_000);
        self.sanitize_modes();
        // Every pin, unpin and reorder edits `pinned` directly, so the
        // active mode has to pick those up here. Without this a pin made
        // between two switches would be thrown away by the next switch.
        self.sync_pins_into_active_mode();
        self.schema_version = CURRENT_SCHEMA_VERSION;
    }

    /// Keep the mode list internally consistent: no duplicate or empty
    /// ids, sane volumes, bounded sizes, and an active id that actually
    /// resolves. A file edited by hand cannot leave the dock pointing at
    /// a mode that is not there.
    fn sanitize_modes(&mut self) {
        let m = &mut self.modes;
        m.modes.truncate(MAX_MODES);

        let mut seen: Vec<String> = Vec::with_capacity(m.modes.len());
        let mut next_spare = 1;
        for mode in m.modes.iter_mut() {
            if mode.id.trim().is_empty() || seen.contains(&mode.id) {
                // a collision would make switching ambiguous, so mint a
                // fresh id rather than dropping the user's mode
                loop {
                    let candidate = format!("mode-{next_spare}");
                    next_spare += 1;
                    if !seen.contains(&candidate) {
                        mode.id = candidate;
                        break;
                    }
                }
            }
            seen.push(mode.id.clone());

            if mode.name.trim().is_empty() {
                mode.name = "Mode".into();
            }
            mode.workspace.windows.truncate(MAX_SNAPSHOT_WINDOWS);

            for pref in mode.audio.iter_mut() {
                pref.exe = exe_key(&pref.exe);
                pref.volume = pref.volume.min(100);
            }
            // one entry per app; the last one written wins
            let mut keep: Vec<AppAudioPref> = Vec::with_capacity(mode.audio.len());
            for pref in mode.audio.drain(..).rev() {
                if !keep.iter().any(|k| k.exe == pref.exe) {
                    keep.push(pref);
                }
            }
            keep.reverse();
            mode.audio = keep;

            for app in mode.auto_switch_apps.iter_mut() {
                *app = exe_key(app);
            }
            mode.auto_switch_apps.retain(|a| !a.is_empty());
            mode.auto_switch_apps.dedup();
        }

        // the active id has to name a mode that exists
        if !m.modes.iter().any(|x| x.id == m.active_id) {
            m.active_id = m.modes.first().map(|x| x.id.clone()).unwrap_or_default();
        }
        // enabled with nothing to switch to is a broken state; the dock
        // would have no pins to show
        if m.enabled && m.modes.is_empty() {
            m.enabled = false;
        }
    }

    /// The mode currently loaded into the dock, if Modes is on.
    pub fn active_mode(&self) -> Option<&DockMode> {
        if !self.modes.enabled {
            return None;
        }
        self.modes.modes.iter().find(|m| m.id == self.modes.active_id)
    }

    fn active_mode_mut(&mut self) -> Option<&mut DockMode> {
        if !self.modes.enabled {
            return None;
        }
        let id = self.modes.active_id.clone();
        self.modes.modes.iter_mut().find(|m| m.id == id)
    }

    /// Copy the dock's live pins into the active mode.
    ///
    /// `pinned` is the working set every existing command already edits,
    /// so this is what makes an ordinary pin or reorder stick to the mode
    /// it happened in.
    pub fn sync_pins_into_active_mode(&mut self) {
        let pins = self.pinned.clone();
        if let Some(mode) = self.active_mode_mut() {
            mode.pinned = pins;
        }
    }

    /// Turn Modes on, seeding the first mode from the dock as it is now
    /// so nothing the user already set up is lost.
    pub fn enable_modes_with_default(&mut self, id: String, name: String) {
        if self.modes.modes.is_empty() {
            self.modes.modes.push(DockMode {
                id: id.clone(),
                name,
                pinned: self.pinned.clone(),
                ..DockMode::default()
            });
            self.modes.active_id = id;
        }
        self.modes.enabled = true;
    }

    /// Switch modes: the outgoing mode keeps the current pins, and the
    /// incoming mode's pins become the dock.
    ///
    /// Returns false when the id names no mode, leaving everything alone.
    pub fn switch_mode(&mut self, id: &str) -> bool {
        if !self.modes.modes.iter().any(|m| m.id == id) {
            return false;
        }
        self.sync_pins_into_active_mode();
        self.modes.active_id = id.to_string();
        if let Some(mode) = self.active_mode() {
            self.pinned = mode.pinned.clone();
        }
        true
    }

    /// Which mode claims the given foreground executable, if any. Used by
    /// auto-switching; returns None when the active mode already claims
    /// it, so a switch is only reported when it would change something.
    pub fn mode_claiming(&self, exe: &str) -> Option<&DockMode> {
        if !self.modes.enabled || !self.modes.auto_switch {
            return None;
        }
        let hit = self.modes.modes.iter().find(|m| m.claims(exe))?;
        (hit.id != self.modes.active_id).then_some(hit)
    }
}

/// Drop a leading UTF-8 byte order mark.
///
/// Several Windows editors add one when saving, and a settings file
/// that has been through one would otherwise fail to parse. That
/// failure is not harmless: the store treats an unreadable file as
/// corrupt, renames it aside and starts from defaults, so a BOM would
/// quietly cost somebody their pinned apps.
fn strip_bom(raw: &str) -> &str {
    raw.strip_prefix('\u{feff}').unwrap_or(raw)
}

/// Thread-safe settings store managed as Tauri state.
pub struct SettingsStore {
    inner: RwLock<Settings>,
    path: PathBuf,
}

impl SettingsStore {
    /// Load from disk (or defaults when missing/corrupt) at the app config dir.
    pub fn load(app: &AppHandle) -> AeroResult<Self> {
        let dir = crate::core::paths::config_dir(app)?;
        fs::create_dir_all(&dir)?;
        let path = dir.join("settings.json");
        let settings = Self::read_file(&path).unwrap_or_else(|e| {
            if path.exists() {
                log::warn!("settings unreadable ({e}); backing up and using defaults");
                let _ = fs::rename(&path, dir.join("settings.json.bak"));
            }
            Settings::default()
        });
        Ok(Self {
            inner: RwLock::new(settings),
            path,
        })
    }

    fn read_file(path: &Path) -> AeroResult<Settings> {
        let raw = fs::read_to_string(path)?;
        let mut settings: Settings = serde_json::from_str(strip_bom(&raw))?;
        settings.sanitize();
        Ok(settings)
    }

    pub fn get(&self) -> Settings {
        self.inner.read().clone()
    }

    /// Apply a mutation, persist atomically, and broadcast the new state.
    pub fn update<F: FnOnce(&mut Settings)>(&self, app: &AppHandle, f: F) -> AeroResult<Settings> {
        let snapshot = {
            let mut guard = self.inner.write();
            f(&mut guard);
            guard.sanitize();
            guard.clone()
        };
        self.persist(&snapshot)?;
        app.emit(SETTINGS_EVENT, &snapshot)?;
        Ok(snapshot)
    }

    /// Replace the whole struct (settings import).
    pub fn replace(&self, app: &AppHandle, mut settings: Settings) -> AeroResult<Settings> {
        settings.sanitize();
        {
            let mut guard = self.inner.write();
            *guard = settings.clone();
        }
        self.persist(&settings)?;
        app.emit(SETTINGS_EVENT, &settings)?;
        Ok(settings)
    }

    /// Atomic write: temp file in the same directory, then rename over.
    fn persist(&self, settings: &Settings) -> AeroResult<()> {
        let json = serde_json::to_string_pretty(settings)?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json)?;
        fs::rename(&tmp, &self.path).or_else(|_| {
            // rename over an open file can fail on Windows; fall back to copy
            fs::copy(&tmp, &self.path).map(|_| {
                let _ = fs::remove_file(&tmp);
            })
        })?;
        Ok(())
    }

    pub fn export_json(&self) -> AeroResult<String> {
        Ok(serde_json::to_string_pretty(&self.get())?)
    }

    pub fn import_json(&self, app: &AppHandle, json: &str) -> AeroResult<Settings> {
        let settings: Settings = serde_json::from_str(strip_bom(json))
            .map_err(|e| AeroError::other(format!("invalid settings file: {e}")))?;
        self.replace(app, settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sane() {
        let s = Settings::default();
        assert_eq!(s.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(s.dock.icon_size, 48);
        assert!(s.dock.magnification);
        assert_eq!(s.appearance.theme, "aero");
    }

    #[test]
    fn sanitize_clamps_out_of_range() {
        let mut s = Settings::default();
        s.appearance.transparency = 0.0;
        s.appearance.animation_speed = 10.0;
        s.dock.icon_size = 500;
        s.dock.magnification_scale = 9.0;
        s.dock.auto_hide_delay_ms = 50;
        s.sanitize();
        assert_eq!(s.appearance.transparency, 0.3);
        assert_eq!(s.appearance.animation_speed, 2.0);
        assert_eq!(s.dock.icon_size, 96);
        assert_eq!(s.dock.magnification_scale, 2.0);
        assert_eq!(s.dock.auto_hide_delay_ms, 200);
    }

    #[test]
    fn auto_hide_delay_upper_bound_is_clamped() {
        let mut s = Settings::default();
        s.dock.auto_hide_delay_ms = 99_000;
        s.sanitize();
        assert_eq!(s.dock.auto_hide_delay_ms, 10_000);
    }

    #[test]
    fn built_in_dock_items_default_to_visible() {
        let d = DockSettings::default();
        assert!(d.show_search_button);
        assert!(d.show_settings_button);
        assert!(d.show_clock);
        assert!(d.show_system_status);
        assert_eq!(d.auto_hide_delay_ms, 1400);
    }

    #[test]
    fn settings_from_v1_0_gain_the_new_fields() {
        // a file written by 1.0.0 has none of the v1.1 keys
        let json = r#"{
            "schemaVersion": 1,
            "dock": { "edge": "bottom", "iconSize": 48, "autoHide": true },
            "appearance": { "theme": "ocean" }
        }"#;
        let s: Settings = serde_json::from_str(json).expect("v1.0 settings should still load");
        assert_eq!(s.dock.icon_size, 48);
        assert!(s.dock.auto_hide);
        assert_eq!(s.appearance.theme, "ocean");
        // new fields fall back to their defaults rather than failing
        assert_eq!(s.dock.auto_hide_delay_ms, 1400);
        assert!(s.dock.show_search_button);
        assert!(s.dock.show_system_status);
    }

    #[test]
    fn roundtrips_through_json() {
        let s = Settings::default();
        let json = serde_json::to_string(&s).expect("serialize");
        let back: Settings = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.dock.icon_size, s.dock.icon_size);
        assert_eq!(back.appearance.theme, s.appearance.theme);
    }

    #[test]
    fn unknown_fields_and_missing_fields_tolerated() {
        // forward/backward compatibility: extra + missing fields both fine
        let json = r#"{ "schemaVersion": 1, "futureField": true, "dock": { "iconSize": 64 } }"#;
        let s: Settings = serde_json::from_str(json).expect("lenient parse");
        assert_eq!(s.dock.icon_size, 64);
        assert_eq!(s.appearance.theme, "aero");
    }

    fn pin(id: &str) -> PinnedItem {
        PinnedItem {
            id: id.into(),
            kind: PinKind::App,
            path: format!(r"C:\apps\{id}.exe"),
            name: id.into(),
            icon: None,
            children: Vec::new(),
        }
    }

    fn with_two_modes() -> Settings {
        let mut s = Settings {
            pinned: vec![pin("work-a"), pin("work-b")],
            ..Default::default()
        };
        s.enable_modes_with_default("work".into(), "Work".into());
        s.modes.modes.push(DockMode {
            id: "play".into(),
            name: "Play".into(),
            pinned: vec![pin("game")],
            ..DockMode::default()
        });
        s
    }

    #[test]
    fn a_settings_file_saved_with_a_byte_order_mark_still_parses() {
        // what a Windows editor writes when told to save as UTF-8 with BOM
        let json = "\u{feff}{ \"schemaVersion\": 1, \"dock\": { \"iconSize\": 64 } }";
        let s: Settings = serde_json::from_str(strip_bom(json))
            .expect("a BOM must not look like corruption");
        assert_eq!(s.dock.icon_size, 64);
    }

    #[test]
    fn stripping_a_bom_leaves_ordinary_json_alone() {
        let json = "{ \"schemaVersion\": 1 }";
        assert_eq!(strip_bom(json), json);
    }

    #[test]
    fn both_windows_keep_the_classic_material_by_default() {
        let a = AppearanceSettings::default();
        assert_eq!(a.dock_surface, SurfaceStyle::Aero);
        assert_eq!(a.settings_surface, SurfaceStyle::Aero);
    }

    #[test]
    fn the_two_surfaces_are_independent() {
        let mut s = Settings::default();
        s.appearance.dock_surface = SurfaceStyle::Liquid;
        s.appearance.settings_surface = SurfaceStyle::Aero;
        s.sanitize();
        assert_eq!(s.appearance.dock_surface, SurfaceStyle::Liquid);
        assert_eq!(s.appearance.settings_surface, SurfaceStyle::Aero);
    }

    #[test]
    fn surfaces_serialize_as_plain_lowercase_names() {
        let json = serde_json::to_string(&AppearanceSettings::default()).unwrap();
        assert!(json.contains(r#""dockSurface":"aero""#), "got {json}");
        assert!(json.contains(r#""settingsSurface":"aero""#), "got {json}");
    }

    #[test]
    fn an_older_config_gains_both_surfaces() {
        // a 1.2 file, written before surfaces existed
        let json = r#"{ "schemaVersion": 2, "appearance": { "theme": "ocean" } }"#;
        let s: Settings = serde_json::from_str(json).expect("must still load");
        assert_eq!(s.appearance.theme, "ocean");
        assert_eq!(s.appearance.dock_surface, SurfaceStyle::Aero);
        assert_eq!(s.appearance.settings_surface, SurfaceStyle::Aero);
    }

    #[test]
    fn an_unknown_surface_name_is_rejected_rather_than_guessed() {
        // a hand-edited file naming a material that does not exist should
        // fail the field, not silently pick one
        let json = r#"{ "appearance": { "dockSurface": "chrome" } }"#;
        assert!(serde_json::from_str::<Settings>(json).is_err());
    }

    #[test]
    fn modes_are_off_until_asked_for() {
        let s = Settings::default();
        assert!(!s.modes.enabled);
        assert!(s.modes.modes.is_empty());
        assert!(s.active_mode().is_none());
    }

    #[test]
    fn turning_modes_on_keeps_the_pins_that_were_already_there() {
        let mut s = Settings {
            pinned: vec![pin("a"), pin("b")],
            ..Default::default()
        };
        s.enable_modes_with_default("default".into(), "Everyday".into());
        assert!(s.modes.enabled);
        assert_eq!(s.modes.active_id, "default");
        // the seeded mode carries the existing dock, and the dock is unchanged
        assert_eq!(s.active_mode().unwrap().pinned.len(), 2);
        assert_eq!(s.pinned.len(), 2);
    }

    #[test]
    fn turning_modes_on_twice_does_not_duplicate_the_default() {
        let mut s = Settings {
            pinned: vec![pin("a")],
            ..Default::default()
        };
        s.enable_modes_with_default("default".into(), "Everyday".into());
        s.modes.enabled = false;
        s.enable_modes_with_default("other".into(), "Other".into());
        assert_eq!(s.modes.modes.len(), 1);
        assert_eq!(s.modes.active_id, "default");
    }

    #[test]
    fn switching_gives_each_mode_its_own_pins() {
        let mut s = with_two_modes();
        assert!(s.switch_mode("play"));
        assert_eq!(s.modes.active_id, "play");
        assert_eq!(s.pinned.len(), 1);
        assert_eq!(s.pinned[0].id, "game");

        // and back again, with the Work pins intact
        assert!(s.switch_mode("work"));
        assert_eq!(s.pinned.len(), 2);
        assert_eq!(s.pinned[0].id, "work-a");
    }

    #[test]
    fn pins_added_while_a_mode_is_active_stay_with_that_mode() {
        let mut s = with_two_modes();
        s.switch_mode("play");
        // the same thing pin_item does: edit the live working set
        s.pinned.push(pin("second-game"));
        s.switch_mode("work");
        s.switch_mode("play");
        assert_eq!(s.pinned.len(), 2);
        assert!(s.pinned.iter().any(|p| p.id == "second-game"));
    }

    #[test]
    fn a_pin_added_without_switching_is_not_lost_on_the_next_switch() {
        let mut s = with_two_modes();
        // pin something the way pin_item does, then let the store persist
        s.pinned.push(pin("late-addition"));
        s.sanitize();
        // go away and come back
        s.switch_mode("play");
        s.switch_mode("work");
        assert!(
            s.pinned.iter().any(|p| p.id == "late-addition"),
            "a pin made between switches must survive"
        );
    }

    #[test]
    fn syncing_does_nothing_when_modes_are_off() {
        let mut s = Settings {
            pinned: vec![pin("a")],
            ..Default::default()
        };
        s.enable_modes_with_default("m".into(), "M".into());
        s.modes.enabled = false;
        s.pinned.push(pin("b"));
        s.sanitize();
        // the dormant mode keeps what it had; the dock keeps what it has
        assert_eq!(s.modes.modes[0].pinned.len(), 1);
        assert_eq!(s.pinned.len(), 2);
    }

    #[test]
    fn switching_to_a_mode_that_does_not_exist_changes_nothing() {
        let mut s = with_two_modes();
        let before = s.pinned.clone();
        assert!(!s.switch_mode("nope"));
        assert_eq!(s.modes.active_id, "work");
        assert_eq!(s.pinned.len(), before.len());
    }

    #[test]
    fn per_app_audio_is_stored_once_per_app() {
        let mut mode = DockMode::default();
        mode.set_audio(AppAudioPref {
            exe: r"C:\x\Discord.exe".into(),
            volume: 40,
            muted: false,
            device_id: None,
        });
        mode.set_audio(AppAudioPref {
            exe: "discord.exe".into(),
            volume: 70,
            muted: true,
            device_id: None,
        });
        assert_eq!(mode.audio.len(), 1);
        let pref = mode.audio_for(r"D:\other\DISCORD.EXE").unwrap();
        assert_eq!(pref.volume, 70);
        assert!(pref.muted);
    }

    #[test]
    fn sanitize_repairs_duplicate_and_empty_mode_ids() {
        let mut s = Settings::default();
        s.modes.enabled = true;
        s.modes.modes = vec![
            DockMode { id: "dup".into(), ..DockMode::default() },
            DockMode { id: "dup".into(), ..DockMode::default() },
            DockMode { id: String::new(), ..DockMode::default() },
        ];
        s.sanitize();
        let ids: Vec<&str> = s.modes.modes.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids.len(), 3);
        assert!(ids.iter().all(|i| !i.is_empty()));
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        assert_eq!(unique.len(), 3, "ids must be unique after sanitize");
    }

    #[test]
    fn sanitize_points_a_dangling_active_id_at_a_real_mode() {
        let mut s = Settings::default();
        s.modes.enabled = true;
        s.modes.active_id = "ghost".into();
        s.modes.modes = vec![DockMode { id: "real".into(), ..DockMode::default() }];
        s.sanitize();
        assert_eq!(s.modes.active_id, "real");
    }

    #[test]
    fn sanitize_turns_modes_off_when_there_are_none() {
        let mut s = Settings::default();
        s.modes.enabled = true;
        s.modes.modes.clear();
        s.sanitize();
        assert!(!s.modes.enabled, "enabled with no modes would leave the dock empty");
    }

    #[test]
    fn sanitize_clamps_audio_and_normalizes_keys() {
        let mut s = Settings::default();
        s.modes.enabled = true;
        s.modes.modes = vec![DockMode {
            id: "m".into(),
            audio: vec![AppAudioPref {
                exe: r"C:\Games\Game.EXE".into(),
                volume: 200,
                muted: false,
                device_id: None,
            }],
            auto_switch_apps: vec![r"C:\Games\Game.EXE".into(), String::new()],
            ..DockMode::default()
        }];
        s.sanitize();
        let m = &s.modes.modes[0];
        assert_eq!(m.audio[0].volume, 100);
        assert_eq!(m.audio[0].exe, "game.exe");
        assert_eq!(m.auto_switch_apps, vec!["game.exe".to_string()]);
    }

    #[test]
    fn sanitize_caps_runaway_mode_and_window_counts() {
        use crate::core::workspace::{SnapRect, WindowSnapshot, WindowState};
        let mut s = Settings::default();
        s.modes.enabled = true;
        s.modes.modes = (0..40)
            .map(|i| DockMode { id: format!("m{i}"), ..DockMode::default() })
            .collect();
        s.modes.modes[0].workspace.windows = (0..500)
            .map(|i| WindowSnapshot {
                exe: format!(r"C:\a\app{i}.exe"),
                title: String::new(),
                aumid: None,
                monitor: String::new(),
                rect: SnapRect { left: 0, top: 0, right: 1, bottom: 1 },
                state: WindowState::Normal,
            })
            .collect();
        s.sanitize();
        assert_eq!(s.modes.modes.len(), MAX_MODES);
        assert_eq!(s.modes.modes[0].workspace.windows.len(), MAX_SNAPSHOT_WINDOWS);
    }

    #[test]
    fn auto_switching_only_fires_for_a_different_mode() {
        let mut s = with_two_modes();
        s.modes.auto_switch = true;
        s.modes.modes[1].auto_switch_apps = vec!["game.exe".into()];
        s.modes.modes[0].auto_switch_apps = vec!["code.exe".into()];

        // a game while Work is active should pull Play forward
        assert_eq!(
            s.mode_claiming(r"D:\Steam\Game.exe").map(|m| m.id.clone()),
            Some("play".into())
        );
        // the active mode owning the app is not a switch
        assert!(s.mode_claiming(r"C:\dev\code.exe").is_none());
        // an app nobody claims is not a switch
        assert!(s.mode_claiming("notepad.exe").is_none());
    }

    #[test]
    fn auto_switching_stays_quiet_when_it_is_off() {
        let mut s = with_two_modes();
        s.modes.auto_switch = false;
        s.modes.modes[1].auto_switch_apps = vec!["game.exe".into()];
        assert!(s.mode_claiming("game.exe").is_none());
    }

    #[test]
    fn a_v1_1_settings_file_still_loads_and_gains_modes_switched_off() {
        // exactly what 1.1.0 wrote: no modes key at all
        let json = r#"{
            "schemaVersion": 1,
            "dock": { "edge": "bottom", "iconSize": 48, "autoHide": true },
            "appearance": { "theme": "ocean" },
            "pinned": [
                { "id": "p1", "kind": "app", "path": "C:\\a\\x.exe", "name": "X",
                  "icon": null, "children": [] }
            ],
            "hideTaskbar": true,
            "onboardingComplete": true
        }"#;
        let mut s: Settings = serde_json::from_str(json).expect("a 1.1 file must still load");
        s.sanitize();
        // everything that was there survives
        assert_eq!(s.pinned.len(), 1);
        assert_eq!(s.pinned[0].name, "X");
        assert!(s.dock.auto_hide);
        assert!(s.hide_taskbar);
        assert!(s.onboarding_complete);
        assert_eq!(s.appearance.theme, "ocean");
        // and modes arrive dormant, changing nothing about the dock
        assert!(!s.modes.enabled);
        assert!(s.modes.modes.is_empty());
        assert_eq!(s.schema_version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn modes_round_trip_through_json_with_everything_populated() {
        use crate::core::workspace::{SnapRect, WindowSnapshot, WindowState, WorkspaceSnapshot};
        let mut s = with_two_modes();
        s.modes.auto_switch = true;
        s.modes.modes[0].set_audio(AppAudioPref {
            exe: "discord.exe".into(),
            volume: 35,
            muted: true,
            device_id: Some("{0.0.0.00000000}.{abc}".into()),
        });
        s.modes.modes[0].workspace = WorkspaceSnapshot {
            windows: vec![WindowSnapshot {
                exe: r"C:\Windows\notepad.exe".into(),
                title: "Untitled - Notepad".into(),
                aumid: None,
                monitor: r"\\.\DISPLAY1".into(),
                rect: SnapRect { left: 1, top: 2, right: 803, bottom: 604 },
                state: WindowState::Maximized,
            }],
            captured_at: 1_700_000_000,
        };

        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.modes.modes.len(), 2);
        let work = &back.modes.modes[0];
        assert_eq!(work.audio[0].volume, 35);
        assert_eq!(work.audio[0].device_id.as_deref(), Some("{0.0.0.00000000}.{abc}"));
        assert_eq!(work.workspace.windows[0].rect.right, 803);
        assert_eq!(work.workspace.captured_at, 1_700_000_000);
        assert!(back.modes.auto_switch);
    }
}
