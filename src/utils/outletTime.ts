// All outlets currently operate in India (IST, UTC+5:30). The server runs in UTC (Docker default),
// so "today", "this month" and "hour of day" must be computed in IST explicitly — never with the
// server's local clock (Date#getHours, new Date(y, m, d), setHours...), which would be 5h30m off.
export const OUTLET_UTC_OFFSET_MINUTES = 330;

const OFFSET_MS = OUTLET_UTC_OFFSET_MINUTES * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar parts of an instant in outlet local time. */
export function outletLocalParts(instant: Date) {
  const local = new Date(instant.getTime() + OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
    weekday: local.getUTCDay(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

/** The instant at which the given outlet-local calendar day starts (local midnight). */
export function outletDayStart(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - OFFSET_MS);
}

/** Start of the outlet-local day containing `instant`. */
export function outletStartOfDay(instant: Date): Date {
  const { year, month, day } = outletLocalParts(instant);
  return outletDayStart(year, month, day);
}

/** Last millisecond of the outlet-local day containing `instant`. */
export function outletEndOfDay(instant: Date): Date {
  return new Date(outletStartOfDay(instant).getTime() + DAY_MS - 1);
}

/** Start of the outlet-local day for a "YYYY-MM-DD" string (falls back to the instant's day for other formats). */
export function outletStartOfDateString(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (match) {
    return outletDayStart(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return outletStartOfDay(new Date(dateStr));
}

/** "YYYYMMDD" for the outlet-local day of `instant` (used in daily order numbers). */
export function outletDateKey(instant: Date): string {
  const { year, month, day } = outletLocalParts(instant);
  return `${year}${String(month + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

export const ONE_DAY_MS = DAY_MS;
