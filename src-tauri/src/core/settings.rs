//! Settings engine: a single versioned struct persisted as JSON at
//! `%APPDATA%\AeroDock\settings.json`, written atomically, with every
//! mutation pushed to the frontend as a full-struct `settings://changed`
//! event so the UI stays a pure function of settings.

use std::fs;
use std::path::{Path, PathBuf};

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::error::{AeroError, AeroResult};

pub const SETTINGS_EVENT: &str = "settings://changed";
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DockEdge {
    Top,
    Bottom,
    Left,
    Right,
}

impl Default for DockEdge {
    fn default() -> Self {
        Self::Bottom
    }
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
    /// Floating mode: detached from the edge with a margin.
    pub floating: bool,
    /// Gap between dock and screen edge in floating mode (logical px).
    pub floating_margin: u32,
    /// Show currently running apps that aren't pinned.
    pub show_running_apps: bool,
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
            floating: true,
            floating_margin: 8,
            show_running_apps: true,
        }
    }
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
        self.schema_version = CURRENT_SCHEMA_VERSION;
    }
}

/// Thread-safe settings store managed as Tauri state.
pub struct SettingsStore {
    inner: RwLock<Settings>,
    path: PathBuf,
}

impl SettingsStore {
    /// Load from disk (or defaults when missing/corrupt) at the app config dir.
    pub fn load(app: &AppHandle) -> AeroResult<Self> {
        let dir = app.path().app_config_dir()?;
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
        let mut settings: Settings = serde_json::from_str(&raw)?;
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
            fs::copy(&tmp, &self.path).map(|_| ()).and_then(|_| {
                let _ = fs::remove_file(&tmp);
                Ok(())
            })
        })?;
        Ok(())
    }

    pub fn export_json(&self) -> AeroResult<String> {
        Ok(serde_json::to_string_pretty(&self.get())?)
    }

    pub fn import_json(&self, app: &AppHandle, json: &str) -> AeroResult<Settings> {
        let settings: Settings =
            serde_json::from_str(json).map_err(|e| AeroError::other(format!("invalid settings file: {e}")))?;
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
        s.sanitize();
        assert_eq!(s.appearance.transparency, 0.3);
        assert_eq!(s.appearance.animation_speed, 2.0);
        assert_eq!(s.dock.icon_size, 96);
        assert_eq!(s.dock.magnification_scale, 2.0);
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
}
