/**
 * Weather, and the only part of Aero Dock that leaves the machine.
 *
 * The README promises the app makes no network requests, so this widget
 * has to earn its exception rather than quietly break the promise. It
 * asks for nothing until two separate things are true: the permission
 * switch in settings is on, and a location has been set. Until then it
 * says so on its face instead of fetching anything.
 *
 * Open-Meteo is used because it needs no account, no key and no
 * identifying header. The request carries a latitude and a longitude and
 * nothing else, so there is no profile to attach it to.
 */

import { useCallback, useEffect, useState } from "react";
import type { WidgetInstance } from "../../../ipc/types";
import type { WidgetProps } from "../registry";

/** Refreshed on the quarter hour; weather does not change faster. */
const POLL_MS = 15 * 60 * 1000;

interface Reading {
  temperature: number;
  code: number;
  wind: number;
  isDay: boolean;
}

/** The WMO codes Open-Meteo returns, grouped into what to draw. */
function describe(code: number): { label: string; icon: Icon } {
  if (code === 0) return { label: "Clear", icon: "sun" };
  if (code <= 2) return { label: "Partly cloudy", icon: "partly" };
  if (code === 3) return { label: "Overcast", icon: "cloud" };
  if (code <= 48) return { label: "Fog", icon: "cloud" };
  if (code <= 57) return { label: "Drizzle", icon: "rain" };
  if (code <= 67) return { label: "Rain", icon: "rain" };
  if (code <= 77) return { label: "Snow", icon: "snow" };
  if (code <= 82) return { label: "Showers", icon: "rain" };
  if (code <= 86) return { label: "Snow showers", icon: "snow" };
  return { label: "Thunderstorm", icon: "storm" };
}

type Icon = "sun" | "partly" | "cloud" | "rain" | "snow" | "storm";

function WeatherIcon({ icon, isDay }: { icon: Icon; isDay: boolean }) {
  const cloud = (
    <path
      d="M20 40h22a9 9 0 0 0 .7-18A14 14 0 0 0 16 26a8 8 0 0 0 4 14z"
      fill="rgba(255,255,255,0.88)"
      stroke="rgba(255,255,255,0.7)"
      strokeWidth="1.2"
    />
  );
  return (
    <svg viewBox="0 0 60 60" className="w-weather-icon" aria-hidden>
      {(icon === "sun" || icon === "partly") &&
        (isDay ? (
          <circle cx={icon === "sun" ? 30 : 22} cy={icon === "sun" ? 28 : 22} r="12" fill="#ffd76e" />
        ) : (
          <path d="M30 12a14 14 0 1 0 14 14 11 11 0 0 1-14-14z" fill="#e8f4ff" />
        ))}
      {icon !== "sun" && cloud}
      {icon === "rain" &&
        [0, 1, 2].map((i) => (
          <line
            key={i}
            x1={22 + i * 8}
            y1="44"
            x2={19 + i * 8}
            y2="53"
            stroke="var(--aero-accent, #2f9de3)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        ))}
      {icon === "snow" &&
        [0, 1, 2].map((i) => <circle key={i} cx={22 + i * 8} cy={49} r="2.4" fill="#ffffff" />)}
      {icon === "storm" && (
        <path d="M30 42l-6 9h5l-3 8 10-12h-5l4-5z" fill="#ffd76e" />
      )}
    </svg>
  );
}

interface Props extends WidgetProps {
  widget: WidgetInstance;
}

export function WeatherWidget({ widget }: Props) {
  const { latitude, longitude, place, celsius } = widget.options;
  const [reading, setReading] = useState<Reading | null>(null);
  const [failed, setFailed] = useState(false);

  const located = latitude !== null && longitude !== null;

  const fetchWeather = useCallback(async () => {
    if (!located) return;
    try {
      const url =
        "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${encodeURIComponent(String(latitude))}` +
        `&longitude=${encodeURIComponent(String(longitude))}` +
        "&current=temperature_2m,weather_code,wind_speed_10m,is_day" +
        `&temperature_unit=${celsius ? "celsius" : "fahrenheit"}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`weather responded ${res.status}`);
      const json = (await res.json()) as {
        current?: {
          temperature_2m?: number;
          weather_code?: number;
          wind_speed_10m?: number;
          is_day?: number;
        };
      };
      const c = json.current;
      if (!c || c.temperature_2m === undefined) throw new Error("no reading");
      setReading({
        temperature: Math.round(c.temperature_2m),
        code: c.weather_code ?? 0,
        wind: Math.round(c.wind_speed_10m ?? 0),
        isDay: c.is_day !== 0,
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [located, latitude, longitude, celsius]);

  useEffect(() => {
    if (!located) return;
    void fetchWeather();
    const id = setInterval(() => void fetchWeather(), POLL_MS);
    return () => clearInterval(id);
  }, [located, fetchWeather]);

  if (!located) {
    return (
      <div className="w-empty">
        Set a location for this widget in Settings, then Widgets.
      </div>
    );
  }
  if (failed && !reading) {
    return <div className="w-empty">Could not reach the weather service.</div>;
  }
  if (!reading) {
    return <div className="w-empty">Checking the sky…</div>;
  }

  const { label, icon } = describe(reading.code);

  return (
    <div className="w-weather">
      <WeatherIcon icon={icon} isDay={reading.isDay} />
      <div className="w-weather-text">
        <div className="w-weather-temp">
          {reading.temperature}
          <span className="w-weather-unit">{celsius ? "°C" : "°F"}</span>
        </div>
        <div className="w-weather-label">{label}</div>
        <div className="w-weather-place">{place || "Your location"}</div>
      </div>
    </div>
  );
}
