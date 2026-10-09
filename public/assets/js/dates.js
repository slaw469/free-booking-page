// Calendar days travel as "YYYY-MM-DD" strings in the host's timezone, the
// same way the server sends them. Nothing here depends on the browser's zone.

const pad = (n) => String(n).padStart(2, '0');

export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function parseYmd(value) {
  const [y, m, d] = value.split('-').map(Number);
  return { y, m, d };
}

const utc = (value) => {
  const { y, m, d } = parseYmd(value);
  return new Date(Date.UTC(y, m - 1, d));
};

export function addDays(value, n) {
  const date = utc(value);
  date.setUTCDate(date.getUTCDate() + n);
  return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export const weekday = (value) => utc(value).getUTCDay(); // 0 = Sunday
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthKey = (value) => value.slice(0, 7);

export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

const fmt = (options) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options });
const F = {
  long: fmt({ weekday: 'long', month: 'long', day: 'numeric' }),
  full: fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
  medium: fmt({ weekday: 'short', month: 'short', day: 'numeric' }),
  weekdayLong: fmt({ weekday: 'long' }),
  weekdayShort: fmt({ weekday: 'short' }),
  monthShort: fmt({ month: 'short' }),
  monthLong: fmt({ month: 'long' }),
};

export const formatDay = (value, style = 'long') => F[style].format(utc(value));
export const monthName = (key) => F.monthLong.format(utc(`${key}-01`));
export const monthYear = (key) => key.slice(0, 4);

// ---- instants (ISO strings) shown in a chosen timezone ----

export function timeIn(iso, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function dayIn(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function zoneShort(iso, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date(iso))
      .find((p) => p.type === 'timeZoneName').value;
  } catch {
    return timeZone;
  }
}

export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

// True when the visitor's clock reads differently from the host's at that moment.
export function zonesDiffer(iso, a, b) {
  if (!a || !b || a === b) return false;
  return timeIn(iso, a) !== timeIn(iso, b) || dayIn(iso, a) !== dayIn(iso, b);
}

export function minutesLabel(total) {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
