/**
 * The widget catalogue.
 *
 * Adding a kind means adding a component and one line here. Nothing else
 * in the desktop layer knows what kinds exist: the frame, the dragging,
 * the materials and the settings list all read from this table.
 */

import type { ComponentType } from "react";
import type { WidgetInstance, WidgetKind } from "../../ipc/types";
import { CalendarWidget } from "./widgets/CalendarWidget";
import { ClockWidget } from "./widgets/ClockWidget";
import { MusicWidget } from "./widgets/MusicWidget";
import { StatsWidget } from "./widgets/StatsWidget";
import { WeatherWidget } from "./widgets/WeatherWidget";

/** Every widget component gets the instance it is rendering. */
export interface WidgetProps {
  widget: WidgetInstance;
}

export interface WidgetDefinition {
  kind: WidgetKind;
  label: string;
  /** One line for the settings list. */
  description: string;
  component: ComponentType<WidgetProps>;
  /** Smallest size that still reads, in CSS pixels. */
  minWidth: number;
  minHeight: number;
  /** True for anything that leaves the machine. Only weather does. */
  network?: boolean;
}

export const WIDGETS: WidgetDefinition[] = [
  {
    kind: "clock",
    label: "Clock",
    description: "Analogue or digital, with a sweeping second hand",
    component: ClockWidget,
    minWidth: 140,
    minHeight: 140,
  },
  {
    kind: "calendar",
    label: "Calendar",
    description: "The month, with today marked",
    component: CalendarWidget,
    minWidth: 210,
    minHeight: 210,
  },
  {
    kind: "weather",
    label: "Weather",
    description: "Current conditions for a place you choose",
    component: WeatherWidget,
    minWidth: 200,
    minHeight: 150,
    network: true,
  },
  {
    kind: "systemStats",
    label: "System stats",
    description: "Processor, memory and uptime",
    component: StatsWidget,
    minWidth: 190,
    minHeight: 160,
  },
  {
    kind: "music",
    label: "Music",
    description: "Whatever Windows is playing, with transport controls",
    component: MusicWidget,
    minWidth: 240,
    minHeight: 120,
  },
];

const BY_KIND = new Map(WIDGETS.map((w) => [w.kind, w]));

export function definitionFor(kind: WidgetKind): WidgetDefinition | undefined {
  return BY_KIND.get(kind);
}
