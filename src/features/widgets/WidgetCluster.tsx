/**
 * The dock's system corner: clock, battery, network, volume, and
 * Recycle Bin, rendered as a compact glass cluster.
 *
 * Interactions: scroll on the volume glyph adjusts level, click mutes;
 * click the bin to open it, right-click to empty (system confirmation).
 */

import { useEffect, useState } from "react";
import { ipc } from "../../ipc/commands";
import { useSystem } from "../../state/systemStore";
import "./widgets.css";

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // tick exactly on the minute
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, 60_000 - (Date.now() % 60_000) + 20);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return now;
}

function BatteryGlyph({ percent, charging }: { percent: number; charging: boolean }) {
  const fill = Math.max(0.06, percent / 100);
  const color = percent <= 20 && !charging ? "#ff9d8a" : "#d9f4ff";
  return (
    <svg viewBox="0 0 24 24" className="widget-glyph">
      <rect x="2" y="7" width="18" height="10" rx="2.5" fill="none" stroke={color} strokeWidth="1.6" />
      <rect x="21" y="10" width="2" height="4" rx="1" fill={color} />
      <rect x="4" y="9" width={14 * fill} height="6" rx="1.5" fill={color} opacity="0.9" />
      {charging && (
        <path d="M13 4 L8 13 h3 l-1 7 5-9 h-3 z" fill="#fff" stroke="rgba(20,90,150,.6)" strokeWidth="0.6" />
      )}
    </svg>
  );
}

function NetworkGlyph({ online }: { online: boolean }) {
  const color = online ? "#d9f4ff" : "rgba(217,244,255,0.35)";
  return (
    <svg viewBox="0 0 24 24" className="widget-glyph">
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M ${12 - (i + 1.6) * 3} ${13 - (i + 1.6) * 2.2} A ${(i + 1.6) * 4} ${(i + 1.6) * 4} 0 0 1 ${12 + (i + 1.6) * 3} ${13 - (i + 1.6) * 2.2}`}
          fill="none"
          stroke={color}
          strokeWidth="1.7"
          strokeLinecap="round"
          opacity={online ? 1 - i * 0.18 : 0.6}
        />
      ))}
      <circle cx="12" cy="17.5" r="1.9" fill={online ? "#d9f4ff" : color} />
      {!online && <line x1="4" y1="21" x2="20" y2="4" stroke="#ff9d8a" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

function VolumeGlyph({ level, muted }: { level: number; muted: boolean }) {
  const color = muted ? "rgba(217,244,255,0.4)" : "#d9f4ff";
  return (
    <svg viewBox="0 0 24 24" className="widget-glyph">
      <path d="M4 9 h4 l5 -4.5 v15 L8 15 H4 z" fill={color} />
      {!muted && level > 0 && (
        <path d="M15.5 8.5 a5 5 0 0 1 0 7" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      )}
      {!muted && level > 55 && (
        <path d="M18 6.5 a8.5 8.5 0 0 1 0 11" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" opacity="0.85" />
      )}
      {muted && <line x1="15" y1="9" x2="21" y2="15" stroke="#ff9d8a" strokeWidth="1.8" strokeLinecap="round" />}
      {muted && <line x1="21" y1="9" x2="15" y2="15" stroke="#ff9d8a" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

function BinGlyph({ full }: { full: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="widget-glyph widget-glyph-bin">
      <path d="M5.5 8 h13 l-1.2 12.2 a1.8 1.8 0 0 1 -1.8 1.6 H8.5 a1.8 1.8 0 0 1 -1.8 -1.6 z"
        fill={full ? "rgba(190,235,255,0.75)" : "rgba(190,235,255,0.32)"}
        stroke="#d9f4ff" strokeWidth="1.3" />
      <ellipse cx="12" cy="8" rx="6.8" ry="1.9" fill="rgba(230,248,255,0.85)" stroke="#d9f4ff" strokeWidth="1.1" />
      {full && <path d="M9 6.8 l1.4 -2.6 M12.4 6.5 l.4 -3 M15 6.9 l-0.7 -2.4" stroke="#d9f4ff" strokeWidth="1.4" strokeLinecap="round" fill="none" />}
    </svg>
  );
}

export function WidgetCluster() {
  const { status, hydrate } = useSystem();
  const now = useClock();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

  const onVolumeWheel = (e: React.WheelEvent) => {
    if (!status?.volume.available) return;
    const next = Math.max(0, Math.min(100, status.volume.level + (e.deltaY < 0 ? 4 : -4)));
    ipc.setVolume(next).catch((err) => console.error("set volume failed", err));
  };

  const binTooltip = status
    ? status.recycleBin.items === 0
      ? "Recycle Bin (empty)"
      : `Recycle Bin — ${status.recycleBin.items} item${status.recycleBin.items === 1 ? "" : "s"}`
    : "Recycle Bin";

  return (
    <div className="widget-cluster">
      <div className="widget-clock" title={date}>
        <span className="widget-time">{time}</span>
        <span className="widget-date">{date}</span>
      </div>
      <div className="widget-glyphs">
        {status?.battery.present && (
          <span
            className="widget-chip"
            title={`Battery ${status.battery.percent}%${status.battery.charging ? " (charging)" : ""}`}
          >
            <BatteryGlyph percent={status.battery.percent} charging={status.battery.charging} />
          </span>
        )}
        <span className="widget-chip" title={status?.internet ? "Connected" : "No internet"}>
          <NetworkGlyph online={status?.internet ?? false} />
        </span>
        {status?.volume.available && (
          <button
            className="widget-chip widget-chip-button"
            title={`Volume ${status.volume.level}%${status.volume.muted ? " (muted)" : ""} — scroll to adjust, click to mute`}
            onWheel={onVolumeWheel}
            onClick={() =>
              ipc.setVolume(undefined, !status.volume.muted).catch((e) =>
                console.error("mute failed", e),
              )
            }
          >
            <VolumeGlyph level={status.volume.level} muted={status.volume.muted} />
          </button>
        )}
        <button
          className="widget-chip widget-chip-button"
          title={`${binTooltip} — click to open, right-click to empty`}
          onClick={() => ipc.openRecycleBin().catch((e) => console.error("open bin failed", e))}
          onContextMenu={(e) => {
            e.preventDefault();
            ipc.emptyRecycleBin().catch((err) => console.error("empty bin failed", err));
          }}
        >
          <BinGlyph full={(status?.recycleBin.items ?? 0) > 0} />
        </button>
      </div>
    </div>
  );
}
