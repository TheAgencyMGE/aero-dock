/**
 * Calendar: the current month with today marked.
 *
 * Weeks start on the locale's first day rather than always Monday, which
 * is the kind of thing that looks like a bug to whoever it is wrong for.
 */

import { useEffect, useMemo, useState } from "react";
import type { WidgetProps } from "../registry";

/** Which weekday the locale starts on: 0 Sunday through 6 Saturday. */
function firstDayOfWeek(): number {
  type WithWeekInfo = { weekInfo?: { firstDay?: number } };
  const locale = new Intl.Locale(navigator.language) as Intl.Locale & WithWeekInfo;
  // weekInfo counts 1 Monday through 7 Sunday; the Date API counts
  // 0 Sunday through 6 Saturday, so 7 folds back to 0.
  const first = locale.weekInfo?.firstDay;
  return first === undefined ? 0 : first % 7;
}

export function CalendarWidget(_: WidgetProps) {
  const [today, setToday] = useState(() => new Date());

  // Roll over at midnight without polling every second all day.
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      setToday((prev) => (prev.toDateString() === now.toDateString() ? prev : now));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const { weekdays, cells, monthLabel } = useMemo(() => {
    const start = firstDayOfWeek();
    const year = today.getFullYear();
    const month = today.getMonth();

    const names: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      // any Sunday works as a reference for naming the days
      const ref = new Date(2024, 8, 1 + ((start + i) % 7));
      names.push(ref.toLocaleDateString(undefined, { weekday: "narrow" }));
    }

    const firstOfMonth = new Date(year, month, 1);
    const lead = (firstOfMonth.getDay() - start + 7) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const list: (number | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysInMonth; d += 1) list.push(d);
    while (list.length % 7 !== 0) list.push(null);

    return {
      weekdays: names,
      cells: list,
      monthLabel: today.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    };
  }, [today]);

  const dayOfMonth = today.getDate();

  return (
    <div className="w-cal">
      <div className="w-cal-head">{monthLabel}</div>
      <div className="w-cal-grid" role="grid" aria-label={monthLabel}>
        {weekdays.map((d, i) => (
          <span key={`h${i}`} className="w-cal-weekday">
            {d}
          </span>
        ))}
        {cells.map((d, i) =>
          d === null ? (
            <span key={`b${i}`} className="w-cal-cell" />
          ) : (
            <span key={`d${d}`} className="w-cal-cell" data-today={d === dayOfMonth}>
              {d}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
