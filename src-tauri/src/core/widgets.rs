//! Desktop widgets: what one is, and the rules that keep a set of them
//! sane.
//!
//! Every widget is the same shape regardless of what it shows. A kind
//! decides which component renders and which of the options below it
//! reads; everything about placement and material is shared. Adding a
//! kind means adding a variant and a component, and nothing else here
//! has to change.
//!
//! Positions are in virtual-desktop pixels, so a widget can sit on any
//! monitor, including ones left of or above the primary where the
//! coordinates go negative.

use serde::{Deserialize, Serialize};

use super::settings::SurfaceStyle;

/// Widgets smaller than this stop being readable; larger than this and a
/// stray resize can cover the screen.
pub const MIN_SIZE: u32 = 90;
pub const MAX_SIZE: u32 = 1600;

/// A hand-editable file should not be able to spawn a thousand windows.
pub const MAX_WIDGETS: usize = 24;

/// How far off the virtual desktop a widget may sit before it is pulled
/// back. Generous, because monitor layouts move around.
const POSITION_LIMIT: i32 = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WidgetKind {
    Clock,
    Calendar,
    Weather,
    SystemStats,
    Music,
}

impl WidgetKind {
    /// A sensible starting size for each kind, in logical pixels.
    pub fn default_size(self) -> (u32, u32) {
        match self {
            Self::Clock => (260, 260),
            Self::Calendar => (300, 300),
            Self::Weather => (280, 190),
            Self::SystemStats => (260, 220),
            Self::Music => (340, 150),
        }
    }

    /// Whether this kind ever leaves the machine. Only weather does, and
    /// only once the user has asked for it.
    pub fn uses_network(self) -> bool {
        matches!(self, Self::Weather)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Clock => "Clock",
            Self::Calendar => "Calendar",
            Self::Weather => "Weather",
            Self::SystemStats => "System stats",
            Self::Music => "Music",
        }
    }
}

/// Per-kind settings. Flat and all optional so a new kind can add a field
/// without a migration, and so an older build ignores what it does not
/// understand instead of failing to parse.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetOptions {
    /// Clock: sweep a second hand and show seconds.
    pub seconds: bool,
    /// Clock: 24 hour face instead of 12.
    pub twenty_four_hour: bool,
    /// Clock: analogue face rather than digital readout.
    pub analog: bool,
    /// Weather: where to report for. Without these the widget asks to be
    /// set up rather than guessing.
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub place: Option<String>,
    /// Weather: Celsius when true, Fahrenheit when false.
    pub celsius: bool,
}

impl Default for WidgetOptions {
    fn default() -> Self {
        Self {
            seconds: true,
            twenty_four_hour: false,
            analog: true,
            latitude: None,
            longitude: None,
            place: None,
            celsius: true,
        }
    }
}

/// One widget on the desktop.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetInstance {
    pub id: String,
    pub kind: WidgetKind,
    /// Virtual-desktop position of the top left corner.
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// 0.3..=1.0. Below a third the text stops being readable.
    pub opacity: f32,
    /// Which material the widget is made of, independent of the dock.
    pub surface: SurfaceStyle,
    /// Hex tint (`#rrggbb`) overriding the theme accent for this widget.
    pub accent: Option<String>,
    /// Bubbles and light drifting inside the widget.
    pub ambient: bool,
    /// Pinned in place, so a stray drag cannot move it.
    pub locked: bool,
    pub options: WidgetOptions,
}

impl Default for WidgetInstance {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: WidgetKind::Clock,
            x: 80,
            y: 80,
            width: 260,
            height: 260,
            opacity: 0.92,
            surface: SurfaceStyle::Aero,
            accent: None,
            ambient: true,
            locked: false,
            options: WidgetOptions::default(),
        }
    }
}

impl WidgetInstance {
    /// A new widget of a kind, at a position, sized for that kind.
    pub fn new(id: String, kind: WidgetKind, x: i32, y: i32) -> Self {
        let (width, height) = kind.default_size();
        Self {
            id,
            kind,
            x,
            y,
            width,
            height,
            ..Self::default()
        }
    }

    /// The rectangle this widget occupies, as `(x, y, width, height)`.
    /// The overlay window uses these to decide where clicks land.
    pub fn rect(&self) -> (i32, i32, u32, u32) {
        (self.x, self.y, self.width, self.height)
    }
}

/// The widget layer as a whole.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetsSettings {
    /// Off until asked for, so upgrading puts nothing on the desktop.
    pub enabled: bool,
    pub widgets: Vec<WidgetInstance>,
    /// Weather is the only widget that makes a network request, so it
    /// carries its own switch on top of being added at all.
    pub allow_weather_network: bool,
}

impl WidgetsSettings {
    /// Clamp everything into range, drop duplicates, and keep the list a
    /// sane length. Called from the settings sanitizer, so a hand-edited
    /// file cannot produce a widget nobody can see or reach.
    pub fn sanitize(&mut self) {
        self.widgets.truncate(MAX_WIDGETS);

        let mut seen: Vec<String> = Vec::with_capacity(self.widgets.len());
        let mut spare = 1;
        for w in self.widgets.iter_mut() {
            if w.id.trim().is_empty() || seen.contains(&w.id) {
                loop {
                    let candidate = format!("widget-{spare}");
                    spare += 1;
                    if !seen.contains(&candidate) {
                        w.id = candidate;
                        break;
                    }
                }
            }
            seen.push(w.id.clone());

            w.width = w.width.clamp(MIN_SIZE, MAX_SIZE);
            w.height = w.height.clamp(MIN_SIZE, MAX_SIZE);
            w.x = w.x.clamp(-POSITION_LIMIT, POSITION_LIMIT);
            w.y = w.y.clamp(-POSITION_LIMIT, POSITION_LIMIT);
            w.opacity = w.opacity.clamp(0.3, 1.0);
            if let Some(accent) = &w.accent {
                if !is_hex_colour(accent) {
                    w.accent = None;
                }
            }
        }

        // Nothing to show means the layer should not be holding a window
        // open, and an empty desktop with the feature "on" reads as broken.
        if self.widgets.is_empty() {
            self.enabled = false;
        }
    }

    /// Rectangles for every widget, for the overlay's hit region.
    pub fn rects(&self) -> Vec<(i32, i32, u32, u32)> {
        self.widgets.iter().map(WidgetInstance::rect).collect()
    }

    /// True when any widget present would actually reach the network.
    pub fn wants_network(&self) -> bool {
        self.allow_weather_network
            && self.widgets.iter().any(|w| w.kind.uses_network())
    }
}

/// `#rrggbb`, the only form the pickers produce.
fn is_hex_colour(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 7
        && bytes[0] == b'#'
        && bytes[1..].iter().all(|b| b.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn widget(id: &str) -> WidgetInstance {
        WidgetInstance::new(id.into(), WidgetKind::Clock, 10, 10)
    }

    #[test]
    fn a_new_widget_gets_the_size_its_kind_wants() {
        let w = WidgetInstance::new("a".into(), WidgetKind::Music, 0, 0);
        assert_eq!((w.width, w.height), WidgetKind::Music.default_size());
    }

    #[test]
    fn only_weather_touches_the_network() {
        assert!(WidgetKind::Weather.uses_network());
        for kind in [
            WidgetKind::Clock,
            WidgetKind::Calendar,
            WidgetKind::SystemStats,
            WidgetKind::Music,
        ] {
            assert!(!kind.uses_network(), "{kind:?} must stay offline");
        }
    }

    #[test]
    fn weather_stays_offline_until_both_switches_are_on() {
        let mut s = WidgetsSettings {
            enabled: true,
            widgets: vec![WidgetInstance::new("w".into(), WidgetKind::Weather, 0, 0)],
            allow_weather_network: false,
        };
        assert!(!s.wants_network(), "present but not permitted");
        s.allow_weather_network = true;
        assert!(s.wants_network());
    }

    #[test]
    fn permission_alone_does_not_reach_the_network() {
        let s = WidgetsSettings {
            enabled: true,
            widgets: vec![widget("clock")],
            allow_weather_network: true,
        };
        assert!(!s.wants_network(), "no weather widget means no request");
    }

    #[test]
    fn sanitize_clamps_sizes_and_opacity() {
        let mut s = WidgetsSettings {
            enabled: true,
            widgets: vec![WidgetInstance {
                width: 5,
                height: 99_999,
                opacity: 4.0,
                ..widget("a")
            }],
            allow_weather_network: false,
        };
        s.sanitize();
        assert_eq!(s.widgets[0].width, MIN_SIZE);
        assert_eq!(s.widgets[0].height, MAX_SIZE);
        assert_eq!(s.widgets[0].opacity, 1.0);
    }

    #[test]
    fn sanitize_keeps_negative_positions_for_monitors_left_of_primary() {
        let mut s = WidgetsSettings {
            enabled: true,
            widgets: vec![WidgetInstance {
                x: -1400,
                y: -200,
                ..widget("a")
            }],
            allow_weather_network: false,
        };
        s.sanitize();
        assert_eq!(s.widgets[0].x, -1400);
        assert_eq!(s.widgets[0].y, -200);
    }

    #[test]
    fn sanitize_pulls_back_absurd_positions() {
        let mut s = WidgetsSettings {
            enabled: true,
            widgets: vec![WidgetInstance {
                x: 9_000_000,
                ..widget("a")
            }],
            allow_weather_network: false,
        };
        s.sanitize();
        assert!(s.widgets[0].x <= POSITION_LIMIT);
    }

    #[test]
    fn sanitize_repairs_duplicate_and_empty_ids() {
        let mut s = WidgetsSettings {
            enabled: true,
            widgets: vec![widget("dup"), widget("dup"), widget("")],
            allow_weather_network: false,
        };
        s.sanitize();
        let ids: Vec<&str> = s.widgets.iter().map(|w| w.id.as_str()).collect();
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        assert_eq!(unique.len(), 3, "ids must be unique: {ids:?}");
        assert!(ids.iter().all(|i| !i.is_empty()));
    }

    #[test]
    fn sanitize_rejects_a_malformed_colour_rather_than_passing_it_to_css() {
        let mut s = WidgetsSettings {
            enabled: true,
            widgets: vec![
                WidgetInstance { accent: Some("#12ab34".into()), ..widget("good") },
                WidgetInstance { accent: Some("red; content: evil".into()), ..widget("bad") },
            ],
            allow_weather_network: false,
        };
        s.sanitize();
        assert_eq!(s.widgets[0].accent.as_deref(), Some("#12ab34"));
        assert_eq!(s.widgets[1].accent, None);
    }

    #[test]
    fn sanitize_turns_the_layer_off_when_nothing_is_left() {
        let mut s = WidgetsSettings {
            enabled: true,
            widgets: Vec::new(),
            allow_weather_network: false,
        };
        s.sanitize();
        assert!(!s.enabled);
    }

    #[test]
    fn sanitize_caps_a_runaway_list() {
        let mut s = WidgetsSettings {
            enabled: true,
            widgets: (0..200).map(|i| widget(&format!("w{i}"))).collect(),
            allow_weather_network: false,
        };
        s.sanitize();
        assert_eq!(s.widgets.len(), MAX_WIDGETS);
    }

    #[test]
    fn rects_line_up_with_the_widgets() {
        let s = WidgetsSettings {
            enabled: true,
            widgets: vec![WidgetInstance { x: 5, y: 6, width: 100, height: 120, ..widget("a") }],
            allow_weather_network: false,
        };
        assert_eq!(s.rects(), vec![(5, 6, 100, 120)]);
    }

    #[test]
    fn a_widget_round_trips_through_json() {
        let w = WidgetInstance {
            surface: SurfaceStyle::Liquid,
            accent: Some("#7ad03a".into()),
            options: WidgetOptions { analog: false, celsius: false, ..Default::default() },
            ..widget("a")
        };
        let back: WidgetInstance =
            serde_json::from_str(&serde_json::to_string(&w).unwrap()).unwrap();
        assert_eq!(back, w);
    }

    #[test]
    fn a_config_written_before_widgets_existed_still_loads() {
        let s: WidgetsSettings = serde_json::from_str("{}").expect("must load");
        assert!(!s.enabled);
        assert!(s.widgets.is_empty());
        assert!(!s.allow_weather_network);
    }
}
