'use strict';

// Everything that is not HTTP: config, the bookings file, slot maths, .ics.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
// Locally, settings are config.json in this folder and bookings are data/bookings.json.
// When DATA_DIR is set (a hosted copy with a persistent disk), both live in that folder,
// so settings changed in the dashboard survive a redeploy.
// (Railway announces an attached volume as RAILWAY_VOLUME_MOUNT_PATH; that counts too.)
const DATA_DIR_SETTING = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
const DATA_DIR = path.resolve(DATA_DIR_SETTING || path.join(ROOT, 'data'));
const SHIPPED_CONFIG_PATH = path.join(ROOT, 'config.json');
const CONFIG_PATH = process.env.CONFIG_PATH
  ? path.resolve(process.env.CONFIG_PATH)
  : DATA_DIR_SETTING
    ? path.join(DATA_DIR, 'config.json')
    : SHIPPED_CONFIG_PATH;
const BOOKINGS_PATH = path.join(DATA_DIR, 'bookings.json');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DEFAULTS = {
  profile: {
    name: 'Your Name',
    agency: 'Your Agency',
    description: '',
    meetingName: 'intro call',
  },
  availability: {
    timezone: 'America/Chicago',
    meetingLengthMinutes: 30,
    bufferMinutes: 0,
    daysAhead: 30,
    minimumNoticeMinutes: 60,
    days: {
      sun: { enabled: false, start: '10:00', end: '14:00' },
      mon: { enabled: true, start: '09:00', end: '17:00' },
      tue: { enabled: true, start: '09:00', end: '17:00' },
      wed: { enabled: true, start: '09:00', end: '17:00' },
      thu: { enabled: true, start: '09:00', end: '17:00' },
      fri: { enabled: true, start: '09:00', end: '17:00' },
      sat: { enabled: false, start: '10:00', end: '14:00' },
    },
  },
  admin: { passcode: '' },
  port: 4517,
};

// ---------- config ----------

function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function cleanText(value, max, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);
}

function cleanInt(value, min, max, fallback, errors, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.round(n) !== n || n < min || n > max) {
    if (value !== undefined) errors.push(`${label} must be a whole number from ${min} to ${max}.`);
    return fallback;
  }
  return n;
}

function toMinutes(hhmm) {
  const m = HHMM.exec(hhmm);
  return Number(m[1]) * 60 + Number(m[2]);
}

// Returns a complete, safe config plus a list of anything that had to be corrected.
function normalizeConfig(raw) {
  const errors = [];
  const src = raw && typeof raw === 'object' ? raw : {};
  const p = src.profile && typeof src.profile === 'object' ? src.profile : {};
  const a = src.availability && typeof src.availability === 'object' ? src.availability : {};
  const d = DEFAULTS.availability;

  const profile = {
    name: cleanText(p.name, 60) || DEFAULTS.profile.name,
    agency: cleanText(p.agency, 60) || DEFAULTS.profile.agency,
    description: cleanText(p.description, 280),
    meetingName: cleanText(p.meetingName, 40) || DEFAULTS.profile.meetingName,
  };

  let timezone = d.timezone;
  if (isValidTimezone(a.timezone)) timezone = a.timezone;
  else if (a.timezone !== undefined) errors.push('Timezone is not a valid IANA name (for example America/Chicago).');

  const days = {};
  for (const key of DAY_KEYS) {
    const day = a.days && typeof a.days[key] === 'object' && a.days[key] ? a.days[key] : {};
    let start = HHMM.test(day.start) ? day.start : d.days[key].start;
    let end = HHMM.test(day.end) ? day.end : d.days[key].end;
    let enabled = day.enabled === undefined ? d.days[key].enabled : Boolean(day.enabled);
    if (toMinutes(end) <= toMinutes(start)) {
      if (enabled) errors.push(`${key}: end time must be after start time.`);
      enabled = false;
    }
    days[key] = { enabled, start, end };
  }

  const availability = {
    timezone,
    meetingLengthMinutes: cleanInt(a.meetingLengthMinutes, 5, 240, d.meetingLengthMinutes, errors, 'Meeting length'),
    bufferMinutes: cleanInt(a.bufferMinutes, 0, 120, d.bufferMinutes, errors, 'Buffer'),
    daysAhead: cleanInt(a.daysAhead, 1, 365, d.daysAhead, errors, 'Days ahead'),
    minimumNoticeMinutes: cleanInt(a.minimumNoticeMinutes, 0, 10080, d.minimumNoticeMinutes, errors, 'Minimum notice'),
    days,
  };

  const admin = { passcode: src.admin && typeof src.admin.passcode === 'string' ? src.admin.passcode : '' };
  const port = Number.isInteger(src.port) && src.port > 0 && src.port < 65536 ? src.port : DEFAULTS.port;

  return { config: { profile, availability, admin, port }, errors };
}

// Fails early, with a message a person can act on, if the data folder cannot be written.
function checkDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const probe = path.join(DATA_DIR, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return null;
  } catch (err) {
    return `Cannot write to the data folder ${DATA_DIR} (${err.code || err.message}). Bookings could not be saved.`;
  }
}

// First start: make sure the settings file exists where we expect it.
function ensureConfigFile() {
  if (fs.existsSync(CONFIG_PATH)) return;
  let starting = {};
  if (CONFIG_PATH !== SHIPPED_CONFIG_PATH) {
    try {
      starting = JSON.parse(fs.readFileSync(SHIPPED_CONFIG_PATH, 'utf8'));
    } catch {
      // no shipped file, or unreadable: fall back to built-in defaults
    }
  }
  saveConfig(normalizeConfig(starting).config);
}

let lastGoodConfig = null;
let lastConfigWarning = '';

// Read on every request so hand edits to config.json show up without a restart.
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const { config, errors } = normalizeConfig(raw);
    const warning = errors.join(' ');
    if (warning && warning !== lastConfigWarning) console.warn(`config.json: ${warning} Using defaults for those values.`);
    lastConfigWarning = warning;
    lastGoodConfig = config;
    return config;
  } catch (err) {
    const warning = err.code === 'ENOENT' ? 'config.json not found' : `config.json could not be read (${err.message})`;
    if (warning !== lastConfigWarning) console.warn(`${warning}. Using ${lastGoodConfig ? 'the last good settings' : 'defaults'}.`);
    lastConfigWarning = warning;
    return lastGoodConfig || normalizeConfig({}).config;
  }
}

function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// Written Monday-first with one line per day, so config.json stays easy to edit by hand.
function saveConfig(config) {
  const days = {};
  for (const key of [...DAY_KEYS.slice(1), DAY_KEYS[0]]) days[key] = config.availability.days[key];
  const ordered = { ...config, availability: { ...config.availability, days } };
  const text = JSON.stringify(ordered, null, 2).replace(
    /\{\s+"enabled": (true|false),\s+"start": ("[^"]*"),\s+"end": ("[^"]*")\s+\}/g,
    '{ "enabled": $1, "start": $2, "end": $3 }'
  );
  writeFileAtomic(CONFIG_PATH, text + '\n');
  lastGoodConfig = config;
}

// ---------- time ----------

const partsFormatters = new Map();

function tzParts(ms, tz) {
  let fmt = partsFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(tz, fmt);
  }
  const out = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out;
}

function tzOffsetMs(ms, tz) {
  const p = tzParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// Wall-clock time in a timezone -> UTC ms. Returns null for times that do not
// exist (the hour skipped when clocks go forward).
function zonedToUtc(ymd, minutes, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const h = Math.floor(minutes / 60);
  const mi = minutes % 60;
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  const p = tzParts(t, tz);
  if (p.day !== d || p.hour !== h || p.minute !== mi) return null;
  return t;
}

const pad = (n) => String(n).padStart(2, '0');

function dateInTz(ms, tz) {
  const p = tzParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function weekdayKey(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return DAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function timeLabel(minutes) {
  const h = Math.floor(minutes / 60);
  return `${h % 12 || 12}:${pad(minutes % 60)} ${h < 12 ? 'AM' : 'PM'}`;
}

function timezoneLabel(tz, ms = Date.now()) {
  const name = (style) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: style })
      .formatToParts(new Date(ms))
      .find((p) => p.type === 'timeZoneName').value;
  try {
    return { long: name('longGeneric'), short: name('short') };
  } catch {
    return { long: tz, short: tz };
  }
}

// ---------- bookings file ----------

function readBookings() {
  let text;
  try {
    text = fs.readFileSync(BOOKINGS_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  if (!text.trim()) return [];
  // A corrupt file throws here on purpose: better to refuse than to overwrite real bookings.
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data && data.bookings;
  return Array.isArray(list) ? list.filter((b) => b && typeof b.start === 'string' && typeof b.end === 'string') : [];
}

function writeBookings(bookings) {
  const sorted = [...bookings].sort((a, b) => a.start.localeCompare(b.start));
  writeFileAtomic(BOOKINGS_PATH, JSON.stringify({ bookings: sorted }, null, 2) + '\n');
}

function bookingsFileExists() {
  return fs.existsSync(BOOKINGS_PATH);
}

// ---------- slots ----------

function overlaps(startMs, endMs, bookings, bufferMs) {
  return bookings.some((b) => {
    const bStart = Date.parse(b.start);
    const bEnd = Date.parse(b.end);
    return startMs < bEnd + bufferMs && endMs + bufferMs > bStart;
  });
}

// Open slots for one calendar day (in the host's timezone).
function slotsForDate(ymd, config, bookings, nowMs) {
  const a = config.availability;
  const rule = a.days[weekdayKey(ymd)];
  if (!rule || !rule.enabled) return [];

  const lengthMs = a.meetingLengthMinutes * 60000;
  const bufferMs = a.bufferMinutes * 60000;
  const earliest = nowMs + a.minimumNoticeMinutes * 60000;
  const step = a.meetingLengthMinutes + a.bufferMinutes;
  const endOfDay = toMinutes(rule.end);
  const slots = [];

  for (let t = toMinutes(rule.start); t + a.meetingLengthMinutes <= endOfDay; t += step) {
    const startMs = zonedToUtc(ymd, t, a.timezone);
    if (startMs === null || startMs < earliest) continue;
    if (overlaps(startMs, startMs + lengthMs, bookings, bufferMs)) continue;
    slots.push({
      start: new Date(startMs).toISOString(),
      end: new Date(startMs + lengthMs).toISOString(),
      label: timeLabel(t),
    });
  }
  return slots;
}

function buildAvailability(config, bookings, nowMs = Date.now()) {
  const a = config.availability;
  const today = dateInTz(nowMs, a.timezone);
  const lastDay = addDays(today, a.daysAhead);
  const days = {};
  for (let i = 0; i <= a.daysAhead; i++) {
    const ymd = addDays(today, i);
    const slots = slotsForDate(ymd, config, bookings, nowMs);
    if (slots.length) days[ymd] = slots;
  }
  return { today, lastDay, days };
}

// ---------- creating a booking ----------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function fail(status, code, message, field) {
  return { ok: false, status, code, message, field };
}

// Read, check and write happen in one synchronous run, and Node handles one
// request at a time, so two people can never both get the same slot.
function createBooking(input, nowMs = Date.now(), extra = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const name = cleanText(body.name, 80);
  const email = cleanText(body.email, 120).toLowerCase();
  const note = cleanText(body.note, 600);

  if (!name) return fail(400, 'invalid', 'Please enter your name.', 'name');
  if (!EMAIL.test(email)) return fail(400, 'invalid', 'Please enter a valid email address.', 'email');

  const startMs = typeof body.start === 'string' ? Date.parse(body.start) : NaN;
  if (!Number.isFinite(startMs)) return fail(400, 'invalid', 'Please pick a time.', 'start');

  const config = loadConfig();
  const bookings = readBookings();
  const ymd = dateInTz(startMs, config.availability.timezone);
  const horizon = buildAvailability(config, [], nowMs);
  const inWindow = ymd >= horizon.today && ymd <= horizon.lastDay;
  const slot = inWindow
    ? slotsForDate(ymd, config, bookings, nowMs).find((s) => Date.parse(s.start) === startMs)
    : null;
  if (!slot) return fail(409, 'slot_unavailable', 'That time was just taken. Please pick another one.');

  const booking = {
    id: crypto.randomUUID(),
    start: slot.start,
    end: slot.end,
    name,
    email,
    note,
    createdAt: new Date(nowMs).toISOString(),
    ...extra,
  };
  writeBookings([...bookings, booking]);
  return { ok: true, booking };
}

function cancelBooking(id) {
  const bookings = readBookings();
  const remaining = bookings.filter((b) => b.id !== id);
  if (remaining.length === bookings.length) return false;
  writeBookings(remaining);
  return true;
}

// ---------- sample data ----------

const SAMPLE_PEOPLE = [
  { name: 'Maya Okafor', email: 'maya@example.com', note: 'I run a small bakery and want more online orders.', at: 600 },
  { name: 'Daniel Reyes', email: 'daniel.reyes@example.com', note: 'Looking for help with ads for my gym.', at: 810 },
  { name: 'Priya Nair', email: 'priya@example.com', note: 'Need a new website before our spring launch.', at: 660 },
  { name: 'Tom Becker', email: 'tom.becker@example.com', note: '', at: 900 },
];

// Adds example bookings on the next few open days, each flagged "sample": true.
function addSampleBookings(nowMs = Date.now()) {
  const config = loadConfig();
  const tz = config.availability.timezone;
  const today = dateInTz(nowMs, tz);
  const added = [];
  let offset = 1;

  for (const person of SAMPLE_PEOPLE) {
    for (; offset <= 21; offset++) {
      const ymd = addDays(today, offset);
      const slots = slotsForDate(ymd, config, readBookings(), nowMs);
      if (!slots.length) continue;
      const wanted = zonedToUtc(ymd, person.at, tz) ?? Date.parse(slots[0].start);
      const nearest = slots.reduce((best, s) =>
        Math.abs(Date.parse(s.start) - wanted) < Math.abs(Date.parse(best.start) - wanted) ? s : best
      );
      const result = createBooking({ ...person, start: nearest.start }, nowMs, { sample: true });
      if (result.ok) added.push(result.booking);
      offset++;
      break;
    }
  }
  return added;
}

function clearSampleBookings() {
  const bookings = readBookings();
  const remaining = bookings.filter((b) => !b.sample);
  if (remaining.length !== bookings.length) writeBookings(remaining);
  return bookings.length - remaining.length;
}

// ---------- .ics ----------

function icsEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545: lines are at most 75 octets, continuation lines start with a space.
function icsFold(line) {
  const out = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

function icsStamp(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function meetingTitle(config) {
  return `${config.availability.meetingLengthMinutes} min ${config.profile.meetingName}`;
}

// Times are written in UTC (the trailing Z), so every calendar app shows the
// right local time whatever timezone the guest is in.
function buildIcs(booking, config, nowMs = Date.now()) {
  const { profile } = config;
  const description = [
    `${meetingTitle(config)} with ${profile.name} (${profile.agency}).`,
    `Booked by ${booking.name} <${booking.email}>.`,
    booking.note ? `Topic: ${booking.note}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Free Booking Page//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@free-booking-page`,
    `DTSTAMP:${icsStamp(new Date(nowMs).toISOString())}`,
    `DTSTART:${icsStamp(booking.start)}`,
    `DTEND:${icsStamp(booking.end)}`,
    `SUMMARY:${icsEscape(`${profile.meetingName.replace(/^./, (c) => c.toUpperCase())}: ${booking.name} and ${profile.name}`)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

module.exports = {
  ROOT,
  CONFIG_PATH,
  DATA_DIR,
  BOOKINGS_PATH,
  ensureConfigFile,
  checkDataDir,
  DAY_KEYS,
  DEFAULTS,
  normalizeConfig,
  loadConfig,
  saveConfig,
  readBookings,
  bookingsFileExists,
  writeBookings,
  buildAvailability,
  createBooking,
  cancelBooking,
  addSampleBookings,
  clearSampleBookings,
  buildIcs,
  meetingTitle,
  timezoneLabel,
};
