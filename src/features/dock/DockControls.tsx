/**
 * The dock's own controls: search and settings.
 *
 * These used to be flat two-tone strokes, which read as generic next to
 * app icons that all have depth. They are drawn as glass now: a gradient
 * body lit from the top, a specular highlight, and a darker seat, so they
 * sit in the same material language as the bar they live on. Colour still
 * comes from `--aero-control-ink` so every theme retints them.
 */

import type { ReactNode } from "react";

/** Shared gradient defs. Ids are per-instance to avoid collisions. */
function Gloss({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
        <stop offset="45%" stopColor="currentColor" stopOpacity="0.92" />
        <stop offset="100%" stopColor="currentColor" />
      </linearGradient>
      <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.98" />
        <stop offset="100%" stopColor="currentColor" />
      </linearGradient>
    </defs>
  );
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className="dock-control-btn" title={label} aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24">{children}</svg>
    </button>
  );
}

export function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <ControlButton label="Search apps and files" onClick={onClick}>
      <Gloss id="ad-search" />
      {/* lens: translucent glass with a lit rim */}
      <circle cx="10.4" cy="10.4" r="6.3" fill="rgba(255,255,255,0.3)" />
      <circle
        cx="10.4"
        cy="10.4"
        r="6.3"
        fill="none"
        stroke="url(#ad-search-rim)"
        strokeWidth="2.5"
      />
      {/* specular arc across the top left of the lens */}
      <path
        d="M6.3 8.4a4.7 4.7 0 0 1 3.2-3.1"
        fill="none"
        stroke="rgba(255,255,255,0.9)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="15.2"
        y1="15.2"
        x2="20.4"
        y2="20.4"
        stroke="url(#ad-search-body)"
        strokeWidth="2.9"
        strokeLinecap="round"
      />
    </ControlButton>
  );
}

/** Eight teeth around a hub, built from primitives so the shape stays true. */
export function SettingsButton({ onClick }: { onClick: () => void }) {
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <ControlButton label="Aero Dock settings" onClick={onClick}>
      <Gloss id="ad-gear" />
      <g fill="url(#ad-gear-body)">
        {teeth.map((angle) => (
          <rect
            key={angle}
            x="10.75"
            y="1.7"
            width="2.5"
            height="5.4"
            rx="1.15"
            transform={`rotate(${angle} 12 12)`}
          />
        ))}
      </g>
      <circle cx="12" cy="12" r="6.4" fill="url(#ad-gear-body)" />
      {/* highlight along the top of the hub */}
      <path
        d="M7.6 10.2a5 5 0 0 1 3.4-3.3"
        fill="none"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* seat: the hole reads as depth rather than a flat dot */}
      <circle cx="12" cy="12" r="3.05" fill="rgba(12,52,92,0.55)" />
      <circle
        cx="12"
        cy="12"
        r="3.05"
        fill="none"
        stroke="rgba(255,255,255,0.75)"
        strokeWidth="1"
      />
    </ControlButton>
  );
}
