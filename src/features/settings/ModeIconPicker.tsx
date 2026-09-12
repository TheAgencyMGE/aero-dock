/**
 * Choosing a mode's tile icon.
 *
 * The grid is laid out inline rather than in a popover. A floating panel
 * has to win a positioning fight with whatever is around it, and it lost
 * that fight once already; a plain wrapped grid cannot be covered, cannot
 * be clipped, and works the same at every window size.
 */

import { useState } from "react";

/** Emoji render as pictures; a letter has to be drawn as type. */
export function isPictorial(glyph: string): boolean {
  return /\p{Extended_Pictographic}/u.test(glyph);
}

/** What the tile shows: the chosen glyph, else the name's first letter. */
export function resolveGlyph(name: string, glyph: string): string {
  const trimmed = glyph.trim();
  if (trimmed) return trimmed;
  return name.trim().charAt(0).toUpperCase() || "M";
}

/** Ordered by theme so related icons sit together in the wrapped grid. */
const PRESETS: { glyph: string; label: string }[] = [
  { glyph: "💼", label: "Briefcase" },
  { glyph: "📊", label: "Chart" },
  { glyph: "📝", label: "Notes" },
  { glyph: "🗂️", label: "Files" },
  { glyph: "📅", label: "Calendar" },
  { glyph: "🏢", label: "Office" },
  { glyph: "✉️", label: "Mail" },
  { glyph: "🎯", label: "Focus" },
  { glyph: "💻", label: "Code" },
  { glyph: "🛠️", label: "Tools" },
  { glyph: "🧩", label: "Pieces" },
  { glyph: "⚙️", label: "Settings" },
  { glyph: "🎨", label: "Design" },
  { glyph: "✏️", label: "Draw" },
  { glyph: "🧪", label: "Experiment" },
  { glyph: "🚀", label: "Launch" },
  { glyph: "🎮", label: "Games" },
  { glyph: "🕹️", label: "Arcade" },
  { glyph: "🎧", label: "Headphones" },
  { glyph: "🎵", label: "Music" },
  { glyph: "🎬", label: "Film" },
  { glyph: "📷", label: "Photos" },
  { glyph: "📺", label: "Watching" },
  { glyph: "🎲", label: "Dice" },
  { glyph: "🫧", label: "Bubbles" },
  { glyph: "🌊", label: "Water" },
  { glyph: "🌿", label: "Leaf" },
  { glyph: "☀️", label: "Day" },
  { glyph: "🌙", label: "Night" },
  { glyph: "⚡", label: "Fast" },
  { glyph: "⭐", label: "Star" },
  { glyph: "🏠", label: "Home" },
];

interface Props {
  /** The mode's name, used for the letter fallback. */
  name: string;
  glyph: string;
  onChange: (glyph: string) => void;
}

export function ModeIconPicker({ name, glyph, onChange }: Props) {
  const [custom, setCustom] = useState("");
  const chosen = glyph.trim();
  const letter = resolveGlyph(name, "");

  return (
    <div className="icon-picker">
      <div className="icon-picker-grid">
        {/* the letter fallback sits first, as one of the choices */}
        <button
          type="button"
          className="icon-picker-option"
          data-active={!chosen}
          title={`Use the letter ${letter}`}
          aria-label={`Use the letter ${letter}`}
          onClick={() => onChange("")}
        >
          {letter}
        </button>
        {PRESETS.map((preset) => (
          <button
            key={preset.glyph}
            type="button"
            className="icon-picker-option"
            data-emoji="true"
            data-active={chosen === preset.glyph}
            title={preset.label}
            aria-label={preset.label}
            onClick={() => onChange(preset.glyph)}
          >
            {preset.glyph}
          </button>
        ))}
      </div>

      <div className="icon-picker-custom">
        <input
          className="ctl-text ctl-text-short"
          value={custom}
          maxLength={4}
          placeholder="Other"
          aria-label="Custom icon"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !custom.trim()) return;
            e.preventDefault();
            onChange(custom.trim());
            setCustom("");
          }}
        />
        <button
          type="button"
          className="aero-button"
          disabled={!custom.trim()}
          onClick={() => {
            onChange(custom.trim());
            setCustom("");
          }}
        >
          Use
        </button>
        {chosen && !PRESETS.some((p) => p.glyph === chosen) && (
          <span className="settings-note">Currently {chosen}</span>
        )}
      </div>
    </div>
  );
}
