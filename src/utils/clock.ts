/**
 * Times on the stats page are shown either in Oslo time (Europe/Oslo, so summer and winter time are
 * handled) or in the export's own clock (the UTC offset the upload was made in, usually UTC -7:00).
 *
 * "Wall time" is a timestamp shifted so that its UTC fields read as the clock on the wall,
 * so the getUTC* methods give the local date and hour.
 */
export type Clock = 'oslo' | 'export';

const HOUR = 3_600_000;
// A night runs 06:00 to 06:00, so 01:00 counts as the evening before
const NIGHT_START_HOUR = 6;

const osloFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Oslo',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

const osloWallTime = (ms: number): number => {
  const parts = Object.fromEntries(osloFormat.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
};

/** The wall time of an ISO timestamp in the chosen clock */
export const wallTime = (iso: string, clock: Clock, exportOffsetMinutes: number): number => {
  const ms = Date.parse(iso);
  return clock === 'oslo' ? osloWallTime(ms) : ms + exportOffsetMinutes * 60_000;
};

/** The night (as an ISO date) a wall time belongs to */
export const nightOf = (wall: number): string => new Date(wall - NIGHT_START_HOUR * HOUR).toISOString().slice(0, 10);

/** Wall time of the start (06:00) of a night */
export const nightStart = (night: string): number => Date.parse(`${night}T00:00:00Z`) + NIGHT_START_HOUR * HOUR;

/** Day of the week of a night, 0 = Monday */
export const weekdayOf = (night: string): number => (new Date(`${night}T00:00:00Z`).getUTCDay() + 6) % 7;

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n: number) => String(n).padStart(2, '0');

const fmt = (wall: number, options: Intl.DateTimeFormatOptions) =>
  new Date(wall).toLocaleString('en-GB', { ...options, timeZone: 'UTC' });

/** "19:31" */
export const formatHourMinute = (wall: number): string => {
  const d = new Date(wall);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** "Mon 12 Oct 19:31" */
export const formatDayTime = (wall: number): string =>
  `${fmt(wall, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')} ${formatHourMinute(wall)}`;

/** "Mon 12" */
export const formatNightShort = (night: string): string =>
  fmt(Date.parse(`${night}T00:00:00Z`), { weekday: 'short', day: 'numeric' }).replace(',', '');

/** "Monday 12 Oct" */
export const formatNightLong = (night: string): string =>
  fmt(Date.parse(`${night}T00:00:00Z`), { weekday: 'long', day: 'numeric', month: 'short' }).replace(',', '');

/** "UTC−7" for an offset of -420 minutes */
export const formatUtcOffset = (minutes: number): string => {
  const abs = Math.abs(minutes);
  return `UTC${minutes < 0 ? '−' : '+'}${Math.floor(abs / 60)}${abs % 60 ? `:${pad(abs % 60)}` : ''}`;
};

export const clockName = (clock: Clock): string => (clock === 'oslo' ? 'Oslo time' : 'export time');
