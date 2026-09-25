/**
 * Whatever Windows is playing.
 *
 * This reads the system media session, the same one the volume flyout
 * shows, so it works with anything that registers: browsers, Spotify, the
 * built-in player. There is no per-app integration and nothing to set up.
 */

import { useCallback, useEffect, useState } from "react";
import { ipc } from "../../../ipc/commands";
import type { MediaAction, NowPlaying } from "../../../ipc/types";
import type { WidgetProps } from "../registry";

const POLL_MS = 2000;

function Glyph({ action, playing }: { action: MediaAction; playing: boolean }) {
  if (action === "playpause") {
    return playing ? (
      <svg viewBox="0 0 16 16" aria-hidden>
        <rect x="4" y="3" width="3.2" height="10" rx="1" fill="currentColor" />
        <rect x="8.8" y="3" width="3.2" height="10" rx="1" fill="currentColor" />
      </svg>
    ) : (
      <svg viewBox="0 0 16 16" aria-hidden>
        <path d="M5 3.4v9.2a.6.6 0 0 0 .92.5l7-4.6a.6.6 0 0 0 0-1l-7-4.6a.6.6 0 0 0-.92.5z" fill="currentColor" />
      </svg>
    );
  }
  const flip = action === "previous";
  return (
    <svg viewBox="0 0 16 16" aria-hidden style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M3.5 4v8a.5.5 0 0 0 .78.42L10 8.42a.5.5 0 0 0 0-.84L4.28 3.58A.5.5 0 0 0 3.5 4z" fill="currentColor" />
      <rect x="10.8" y="3.6" width="2" height="8.8" rx="1" fill="currentColor" />
    </svg>
  );
}

export function MusicWidget(_: WidgetProps) {
  const [track, setTrack] = useState<NowPlaying | null>(null);

  const refresh = useCallback(() => {
    ipc
      .widgetNowPlaying()
      .then(setTrack)
      .catch(() => {
        // nothing playing is the common case, not an error worth showing
      });
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const send = (action: MediaAction) => {
    ipc
      .widgetMediaControl(action)
      // read back straight away so the button reflects what happened
      .then(() => setTimeout(refresh, 180))
      .catch(() => undefined);
  };

  if (!track?.active) {
    return <div className="w-empty">Nothing playing</div>;
  }

  return (
    <div className="w-music">
      <div className="w-music-text">
        <div className="w-music-title" title={track.title}>
          {track.title}
        </div>
        <div className="w-music-artist" title={track.artist}>
          {track.artist || track.album || "Unknown artist"}
        </div>
      </div>
      <div className="w-music-controls">
        {(["previous", "playpause", "next"] as MediaAction[]).map((action) => (
          <button
            key={action}
            className="w-music-btn"
            data-primary={action === "playpause"}
            aria-label={action === "playpause" ? (track.playing ? "Pause" : "Play") : action}
            // the frame drags on pointerdown, so a button press must not
            // also start moving the widget
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => send(action)}
          >
            <Glyph action={action} playing={track.playing} />
          </button>
        ))}
      </div>
    </div>
  );
}
