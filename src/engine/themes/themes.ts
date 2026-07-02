/**
 * Built-in themes. A theme is a set of design-token overrides applied to
 * :root; components and the effects layer read only tokens, so switching
 * themes restyles everything at once.
 */

export interface Theme {
  id: string;
  name: string;
  /** Two stops used by the settings UI for the preview swatch. */
  preview: [string, string];
  tokens: Record<string, string>;
}

export const THEMES: Theme[] = [
  {
    id: "aero",
    name: "Aero",
    preview: ["#7ec9e8", "#2f9de3"],
    tokens: {}, // the defaults in tokens.css ARE the Aero theme
  },
  {
    id: "ocean",
    name: "Ocean",
    preview: ["#4fc3dd", "#0b5e8e"],
    tokens: {
      "--aero-accent": "#1ba7c9",
      "--aero-accent-deep": "#0b5e8e",
      "--aero-life": "#3ddbb4",
      "--glass-tint-top": "rgba(214, 246, 255, 0.5)",
      "--glass-tint-mid": "rgba(120, 215, 235, 0.18)",
      "--glass-tint-bottom": "rgba(20, 120, 165, 0.34)",
      "--bloom-color": "rgba(110, 230, 255, 0.9)",
      "--bloom-soft": "rgba(110, 230, 255, 0.35)",
      "--ambient-glow": "rgba(40, 170, 210, 0.28)",
    },
  },
  {
    id: "forest",
    name: "Forest",
    preview: ["#9adf6e", "#2e7d32"],
    tokens: {
      "--aero-accent": "#5cb84a",
      "--aero-accent-deep": "#2e7d32",
      "--aero-life": "#c8f06e",
      "--glass-tint-top": "rgba(235, 255, 220, 0.5)",
      "--glass-tint-mid": "rgba(170, 230, 140, 0.16)",
      "--glass-tint-bottom": "rgba(60, 130, 60, 0.3)",
      "--bloom-color": "rgba(190, 255, 140, 0.9)",
      "--bloom-soft": "rgba(190, 255, 140, 0.32)",
      "--ambient-glow": "rgba(100, 190, 90, 0.25)",
    },
  },
  {
    id: "aurora",
    name: "Aurora",
    preview: ["#8ef0c8", "#5a4fcf"],
    tokens: {
      "--aero-accent": "#7c6cf0",
      "--aero-accent-deep": "#4636a8",
      "--aero-life": "#63f2c2",
      "--glass-tint-top": "rgba(230, 235, 255, 0.48)",
      "--glass-tint-mid": "rgba(160, 150, 250, 0.16)",
      "--glass-tint-bottom": "rgba(80, 220, 180, 0.26)",
      "--bloom-color": "rgba(150, 240, 210, 0.9)",
      "--bloom-soft": "rgba(160, 150, 250, 0.35)",
      "--ambient-glow": "rgba(120, 110, 230, 0.28)",
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    preview: ["#ffc06e", "#e0526d"],
    tokens: {
      "--aero-accent": "#f2884b",
      "--aero-accent-deep": "#c2404f",
      "--aero-life": "#ffd76e",
      "--glass-tint-top": "rgba(255, 240, 220, 0.52)",
      "--glass-tint-mid": "rgba(255, 180, 130, 0.18)",
      "--glass-tint-bottom": "rgba(200, 90, 100, 0.3)",
      "--bloom-color": "rgba(255, 200, 130, 0.9)",
      "--bloom-soft": "rgba(255, 160, 120, 0.35)",
      "--ambient-glow": "rgba(240, 140, 90, 0.28)",
    },
  },
  {
    id: "night",
    name: "Night",
    preview: ["#39456e", "#0c101f"],
    tokens: {
      "--aero-accent": "#5a78c8",
      "--aero-accent-deep": "#26325e",
      "--aero-life": "#8fd0ff",
      "--aero-text-on-glass": "#e8eeff",
      "--glass-tint-top": "rgba(130, 150, 200, 0.34)",
      "--glass-tint-mid": "rgba(50, 65, 110, 0.3)",
      "--glass-tint-bottom": "rgba(15, 22, 45, 0.5)",
      "--glass-border": "rgba(180, 200, 255, 0.4)",
      "--bloom-color": "rgba(150, 190, 255, 0.85)",
      "--bloom-soft": "rgba(150, 190, 255, 0.3)",
      "--ambient-glow": "rgba(70, 100, 180, 0.3)",
      "--gloss-strength": "0.32",
    },
  },
];

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Every token any theme overrides — cleared before applying a theme so
 * switching back to Aero restores the stylesheet defaults. */
export const THEMED_TOKENS: string[] = [
  ...new Set(THEMES.flatMap((t) => Object.keys(t.tokens))),
];
