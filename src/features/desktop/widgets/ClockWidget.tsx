/**
 * Clock. Analogue by default, because a glass face with a sweeping hand
 * is the most Frutiger Aero thing on the desktop.
 *
 * The tick is one timer at the rate actually needed: every second when
 * seconds are shown, otherwise every fifteen, which is enough to land on
 * the right minute without waking the widget sixty times for nothing.
 */

import { useEffect, useState } from "react";
import type { WidgetProps } from "../registry";

function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function ClockWidget({ widget }: WidgetProps) {
  const { seconds, twentyFourHour, analog } = widget.options;
  const now = useNow(seconds ? 1000 : 15000);

  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();

  if (!analog) {
    const hour = twentyFourHour ? h : h % 12 || 12;
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      <div className="w-clock-digital">
        <div className="w-clock-time">
          {twentyFourHour ? pad(hour) : hour}
          <span className="w-clock-colon">:</span>
          {pad(m)}
          {seconds && <span className="w-clock-seconds">{pad(s)}</span>}
        </div>
        {!twentyFourHour && <div className="w-clock-meridiem">{h < 12 ? "AM" : "PM"}</div>}
        <div className="w-clock-date">
          {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </div>
      </div>
    );
  }

  // Degrees, with the smaller hands carrying the fraction of the larger
  // unit so nothing jumps between ticks.
  const secDeg = s * 6;
  const minDeg = m * 6 + s * 0.1;
  const hourDeg = (h % 12) * 30 + m * 0.5;

  return (
    <div className="w-clock-face">
      <svg viewBox="0 0 100 100" className="w-clock-svg" aria-hidden>
        <defs>
          <radialGradient id="w-face" cx="38%" cy="30%" r="80%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
            <stop offset="60%" stopColor="rgba(190,230,255,0.16)" />
            <stop offset="100%" stopColor="rgba(40,110,170,0.22)" />
          </radialGradient>
          <linearGradient id="w-hand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="rgba(210,240,255,0.75)" />
          </linearGradient>
        </defs>

        <circle cx="50" cy="50" r="47" fill="url(#w-face)" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" />
        <circle cx="50" cy="50" r="43" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />

        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          const outer = 42;
          const inner = i % 3 === 0 ? 34 : 38;
          return (
            <line
              key={i}
              x1={50 + Math.sin(a) * inner}
              y1={50 - Math.cos(a) * inner}
              x2={50 + Math.sin(a) * outer}
              y2={50 - Math.cos(a) * outer}
              stroke="rgba(255,255,255,0.75)"
              strokeWidth={i % 3 === 0 ? 2 : 1}
              strokeLinecap="round"
            />
          );
        })}

        <g transform={`rotate(${hourDeg} 50 50)`}>
          <line x1="50" y1="52" x2="50" y2="27" stroke="url(#w-hand)" strokeWidth="4.2" strokeLinecap="round" />
        </g>
        <g transform={`rotate(${minDeg} 50 50)`}>
          <line x1="50" y1="54" x2="50" y2="17" stroke="url(#w-hand)" strokeWidth="2.8" strokeLinecap="round" />
        </g>
        {seconds && (
          <g transform={`rotate(${secDeg} 50 50)`}>
            <line x1="50" y1="58" x2="50" y2="14" stroke="var(--aero-life, #7ad03a)" strokeWidth="1.3" strokeLinecap="round" />
          </g>
        )}
        <circle cx="50" cy="50" r="3.2" fill="#ffffff" />
        <circle cx="50" cy="50" r="1.4" fill="var(--aero-accent, #2f9de3)" />
      </svg>
    </div>
  );
}
