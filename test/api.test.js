'use strict';

// npm test
// Starts the real server on a spare port with a throwaway data folder and drives it over HTTP.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-test-'));
process.env.DATA_DIR = DATA_DIR;
process.env.FRONTEND = 'public';
delete process.env.ADMIN_PASSCODE;
delete process.env.TRUST_PROXY;

const core = require('../lib/core');
const { createApp } = require('../server');

const servers = [];
function listen(options) {
  return new Promise((resolve) => {
    const server = http.createServer(createApp({ log: () => {}, ...options }));
    servers.push(server);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function call(base, method, route, body, headers = {}) {
  const res = await fetch(base + route, {
    method,
    redirect: 'manual',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON (a page or an .ics file)
  }
  return { status: res.status, json, text, headers: res.headers };
}

const guest = (start, extra = {}) => ({ start, name: 'Jordan Lee', email: 'jordan@example.com', note: 'Hello', ...extra });
const REMOTE = { 'X-Forwarded-For': '203.0.113.7' };

let base;
test.before(async () => {
  core.ensureConfigFile();
  base = await listen();
});
test.after(() => {
  for (const server of servers) server.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

async function firstOpenSlot(skip = 0) {
  const { json } = await call(base, 'GET', '/api/availability');
  const days = Object.keys(json.days).filter((d) => d !== json.today);
  return json.days[days[skip]][3];
}

test('first run: settings file is created in DATA_DIR and there are no bookings', async () => {
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'config.json')));
  assert.equal(fs.existsSync(path.join(DATA_DIR, 'bookings.json')), false);
  const admin = await call(base, 'GET', '/api/admin/bookings');
  assert.equal(admin.status, 200);
  assert.deepEqual(admin.json, { bookings: [], pastCount: 0, sampleCount: 0 });
});

test('availability has the documented shape', async () => {
  const { status, json } = await call(base, 'GET', '/api/availability');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(json.profile).sort(), ['agency', 'description', 'meetingName', 'meetingTitle', 'name']);
  assert.match(json.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(json.lastDay > json.today);
  assert.equal(typeof json.timezoneLabel.long, 'string');
  const [day, slots] = Object.entries(json.days)[1];
  assert.ok(day >= json.today && day <= json.lastDay);
  assert.deepEqual(Object.keys(slots[0]).sort(), ['end', 'label', 'start']);
  assert.equal(Date.parse(slots[0].end) - Date.parse(slots[0].start), json.meetingLengthMinutes * 60000);
  assert.ok(Date.parse(slots[0].start) > Date.now());
});

test('booking a slot removes it, and it cannot be booked twice', async () => {
  const slot = await firstOpenSlot();
  const made = await call(base, 'POST', '/api/bookings', guest(slot.start, { email: 'JORDAN@Example.com' }));
  assert.equal(made.status, 201);
  assert.deepEqual(Object.keys(made.json.booking).sort(), ['email', 'end', 'id', 'name', 'start']);
  assert.equal(made.json.booking.email, 'jordan@example.com');

  const after = await call(base, 'GET', '/api/availability');
  assert.ok(!Object.values(after.json.days).flat().some((s) => s.start === slot.start));

  const again = await call(base, 'POST', '/api/bookings', guest(slot.start, { name: 'Someone Else' }));
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'slot_unavailable');

  const saved = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bookings.json'), 'utf8')).bookings;
  assert.equal(saved.filter((b) => b.start === slot.start).length, 1);
});

test('twenty simultaneous requests for one slot: exactly one wins', async () => {
  const slot = await firstOpenSlot(1);
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => call(base, 'POST', '/api/bookings', guest(slot.start, { name: `Racer ${i}` })))
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 19);
});

test('bad input is rejected with a field name', async () => {
  const slot = await firstOpenSlot(2);
  const cases = [
    [guest(slot.start, { name: '   ' }), 400, 'invalid', 'name'],
    [guest(slot.start, { email: 'not-an-email' }), 400, 'invalid', 'email'],
    [guest(slot.start, { email: `${'a'.repeat(130)}@example.com` }), 400, 'invalid', 'email'],
    [guest('tomorrow-ish'), 400, 'invalid', 'start'],
    [guest(undefined), 400, 'invalid', 'start'],
    [guest('2020-01-06T15:00:00.000Z'), 409, 'slot_unavailable', undefined],
    [guest('2099-01-05T15:00:00.000Z'), 409, 'slot_unavailable', undefined],
    [guest(new Date(Date.parse(slot.start) + 7 * 60000).toISOString()), 409, 'slot_unavailable', undefined],
  ];
  for (const [body, status, code, field] of cases) {
    const res = await call(base, 'POST', '/api/bookings', body);
    assert.equal(res.status, status, JSON.stringify(body));
    assert.equal(res.json.error.code, code);
    assert.equal(res.json.error.field, field);
    assert.equal(typeof res.json.error.message, 'string');
  }
  assert.equal((await call(base, 'POST', '/api/bookings', '{nope')).json.error.code, 'bad_json');
  assert.equal((await call(base, 'POST', '/api/bookings', guest(slot.start, { note: 'x'.repeat(30000) }))).status, 413);
  assert.equal((await call(base, 'POST', '/api/bookings', '[1,2]')).status, 400);
});

test('long and odd text is trimmed and stored as plain text', async () => {
  const slot = await firstOpenSlot(2);
  const res = await call(base, 'POST', '/api/bookings', guest(slot.start, {
    name: `  <script>alert(1)</script>${'n'.repeat(200)}`,
    note: `line one\u0000\u0007\nline two ${'y'.repeat(900)}`,
  }));
  assert.equal(res.status, 201);
  const saved = (await call(base, 'GET', '/api/admin/bookings')).json.bookings.find((b) => b.id === res.json.booking.id);
  assert.equal(saved.name.length, 80);
  assert.ok(saved.name.startsWith('<script>'));
  assert.equal(saved.note.length, 600);
  assert.ok(!/[\u0000\u0007]/.test(saved.note));
  await call(base, 'DELETE', `/api/admin/bookings/${saved.id}`);
});

test('the .ics file is a valid single event in UTC', async () => {
  const slot = await firstOpenSlot(3);
  const made = await call(base, 'POST', '/api/bookings', guest(slot.start, { note: 'Ads; landing page, and pricing\nplus more' }));
  const ics = await call(base, 'GET', `/api/bookings/${made.json.booking.id}/ics`);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type'), /^text\/calendar/);
  assert.match(ics.headers.get('content-disposition'), /attachment; filename="booking\.ics"/);

  const lines = ics.text.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines.at(-2), 'END:VCALENDAR');
  assert.ok(lines.every((line) => Buffer.byteLength(line) <= 75), 'no line over 75 bytes');
  assert.ok(!ics.text.replace(/\r\n/g, '').includes('\n'), 'only CRLF line endings');
  const stamp = (iso) => iso.replace(/[-:]/g, '').replace('.000Z', 'Z');
  assert.ok(lines.includes(`DTSTART:${stamp(slot.start)}`));
  assert.ok(lines.includes(`DTEND:${stamp(slot.end)}`));
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 1);
  for (const needed of ['VERSION:2.0', 'END:VEVENT', 'BEGIN:VALARM']) assert.ok(lines.includes(needed), needed);
  for (const prefix of ['UID:', 'DTSTAMP:', 'SUMMARY:', 'PRODID:']) assert.ok(lines.some((l) => l.startsWith(prefix)), prefix);
  assert.ok(ics.text.replace(/\r\n /g, '').includes('Ads\\; landing page\\, and pricing\\nplus more'));

  assert.equal((await call(base, 'GET', '/api/bookings/00000000-0000-0000-0000-000000000000/ics')).status, 404);
});

test('cancelling reopens the time', async () => {
  const slot = await firstOpenSlot(4);
  const made = await call(base, 'POST', '/api/bookings', guest(slot.start));
  const cancelled = await call(base, 'DELETE', `/api/admin/bookings/${made.json.booking.id}`);
  assert.equal(cancelled.status, 200);
  assert.ok(!cancelled.json.bookings.some((b) => b.id === made.json.booking.id));
  const after = await call(base, 'GET', '/api/availability');
  assert.ok(Object.values(after.json.days).flat().some((s) => s.start === slot.start));
  assert.equal((await call(base, 'DELETE', `/api/admin/bookings/${made.json.booking.id}`)).status, 404);
  assert.equal((await call(base, 'GET', `/api/bookings/${made.json.booking.id}/ics`)).status, 404);
});

test('changing settings changes what the public sees, and bad settings are refused', async () => {
  const before = (await call(base, 'GET', '/api/availability')).json;
  const everyDayOff = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { enabled: false, start: '09:00', end: '17:00' }]));

  let put = await call(base, 'PUT', '/api/admin/config', { availability: { days: everyDayOff } });
  assert.equal(put.status, 200);
  assert.deepEqual((await call(base, 'GET', '/api/availability')).json.days, {});

  put = await call(base, 'PUT', '/api/admin/config', {
    profile: { name: '  Alex Morgan  ', agency: 'North Studio' },
    availability: { meetingLengthMinutes: 60, bufferMinutes: 30, days: { ...everyDayOff, sat: { enabled: true, start: '10:00', end: '14:00' } } },
  });
  assert.equal(put.json.profile.name, 'Alex Morgan');
  assert.equal(put.json.passcodeEnabled, false);
  assert.ok(!('admin' in put.json));
  const now = (await call(base, 'GET', '/api/availability')).json;
  assert.equal(now.profile.meetingTitle, '60 min intro call');
  assert.equal(now.profile.agency, 'North Studio');
  const saturdays = Object.entries(now.days);
  assert.ok(saturdays.length >= 3);
  for (const [day, slots] of saturdays) {
    assert.equal(new Date(`${day}T12:00:00Z`).getUTCDay(), 6, `${day} is a Saturday`);
    if (day !== now.today) assert.deepEqual(slots.map((s) => s.label), ['10:00 AM', '11:30 AM', '1:00 PM']);
  }

  for (const bad of [
    { availability: { timezone: 'Mars/Olympus' } },
    { availability: { meetingLengthMinutes: 0 } },
    { availability: { bufferMinutes: 5.5 } },
    { availability: { daysAhead: 9999 } },
    { availability: { days: { sat: { enabled: true, start: '14:00', end: '10:00' } } } },
  ]) {
    const res = await call(base, 'PUT', '/api/admin/config', bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.json.error.code, 'invalid');
  }
  assert.equal((await call(base, 'GET', '/api/admin/config')).json.availability.meetingLengthMinutes, 60);

  const saved = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8'));
  assert.equal(saved.profile.name, 'Alex Morgan');

  // back to the defaults the other tests expect
  const weekdays = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, { enabled: true, start: '09:00', end: '17:00' }]));
  await call(base, 'PUT', '/api/admin/config', {
    availability: { meetingLengthMinutes: 30, bufferMinutes: 0, days: { ...weekdays, sat: { enabled: false, start: '10:00', end: '14:00' } } },
  });
  assert.equal(Object.keys((await call(base, 'GET', '/api/availability')).json.days).length >= Object.keys(before.days).length - 1, true);
});

test('sample bookings: seed adds flagged ones, clear removes only those', async () => {
  const real = (await call(base, 'GET', '/api/admin/bookings')).json.bookings.length;
  const seeded = await call(base, 'POST', '/api/admin/seed-samples');
  assert.equal(seeded.json.added, 4);
  assert.equal(seeded.json.sampleCount, 4);
  assert.ok(seeded.json.bookings.filter((b) => b.sample).every((b) => b.email.endsWith('@example.com')));
  const cleared = await call(base, 'POST', '/api/admin/clear-samples');
  assert.equal(cleared.json.removed, 4);
  assert.equal(cleared.json.sampleCount, 0);
  assert.equal(cleared.json.bookings.length, real);
});

test('bookings survive a restart (a second server reading the same folder)', async () => {
  const other = await listen();
  const a = (await call(base, 'GET', '/api/admin/bookings')).json;
  const b = (await call(other, 'GET', '/api/admin/bookings')).json;
  assert.ok(a.bookings.length >= 2);
  assert.deepEqual(a, b);
});

test('pages and files: routes map to public/, nothing outside it is served', async () => {
  for (const route of ['/', '/book', '/admin']) {
    const res = await call(base, 'GET', route);
    assert.equal(res.status, 200, route);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  }
  for (const route of ['/book/', '/admin/']) {
    const res = await call(base, 'GET', route);
    assert.equal(res.status, 308);
    assert.equal(res.headers.get('location'), route.slice(0, -1));
  }
  assert.deepEqual((await call(base, 'GET', '/healthz')).json, { ok: true });
  assert.equal((await call(base, 'HEAD', '/')).text, '');
  for (const route of [
    '/assets/../../config.json', '/assets/%2e%2e/%2e%2e/config.json', '/..%2fconfig.json', '/assets/..%2f..%2fserver.js',
    '/config.json', '/server.js', '/data/bookings.json', '/.gitignore', '/assets/.hidden.js', '/index.html', '/nope', '/api/nope',
  ]) {
    const res = await call(base, 'GET', route);
    assert.equal(res.status, 404, route);
    assert.ok(!res.text.includes('"profile"') && !res.text.includes('createApp'), route);
  }
  assert.equal((await call(base, 'POST', '/')).status, 405);
  assert.equal((await call(base, 'DELETE', '/api/availability')).json.error.code, 'method_not_allowed');
});

test('no passcode set: the dashboard is refused to anyone who is not on this machine', async () => {
  for (const [method, route] of [
    ['GET', '/api/admin/bookings'], ['GET', '/api/admin/config'], ['PUT', '/api/admin/config'],
    ['POST', '/api/admin/clear-samples'], ['POST', '/api/admin/seed-samples'],
    ['DELETE', '/api/admin/bookings/00000000-0000-0000-0000-000000000000'], ['POST', '/api/admin/login'],
  ]) {
    const res = await call(base, method, route, method === 'GET' || method === 'DELETE' ? undefined : {}, REMOTE);
    assert.equal(res.status, 403, `${method} ${route}`);
    assert.equal(res.json.error.code, 'passcode_not_set');
    assert.ok(!res.text.includes('example.com'));
  }
  const page = await call(base, 'GET', '/admin', undefined, REMOTE);
  assert.equal(page.status, 403);
  assert.match(page.text, /ADMIN_PASSCODE/);
  assert.deepEqual((await call(base, 'GET', '/api/admin/session', undefined, REMOTE)).json, { passcodeRequired: false, authenticated: false, refused: true });
  assert.deepEqual((await call(base, 'GET', '/api/admin/session')).json, { passcodeRequired: false, authenticated: true, refused: false });
  // the public side is unaffected
  assert.equal((await call(base, 'GET', '/api/availability', undefined, REMOTE)).status, 200);
});

test('passcode set: admin is locked until login, sessions are signed, attempts are limited', async (t) => {
  process.env.ADMIN_PASSCODE = 'correct horse battery';
  t.after(() => delete process.env.ADMIN_PASSCODE);
  const locked = await listen();

  for (const headers of [{}, REMOTE]) {
    const res = await call(locked, 'GET', '/api/admin/bookings', undefined, headers);
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, 'passcode_required');
  }
  const page = await call(locked, 'GET', '/admin');
  assert.equal(page.status, 401);
  assert.deepEqual((await call(locked, 'GET', '/api/admin/session')).json, { passcodeRequired: true, authenticated: false, refused: false });
  assert.equal((await call(locked, 'GET', '/api/availability')).status, 200);

  const wrong = await call(locked, 'POST', '/api/admin/login', { passcode: 'nope' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error.code, 'wrong_passcode');
  assert.equal(wrong.headers.get('set-cookie'), null);
  assert.equal((await call(locked, 'POST', '/api/admin/login', { passcode: ['correct horse battery'] })).status, 401);

  const login = await call(locked, 'POST', '/api/admin/login', { passcode: 'correct horse battery' });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];

  assert.equal((await call(locked, 'GET', '/api/admin/bookings', undefined, { Cookie: cookie })).status, 200);
  assert.equal((await call(locked, 'GET', '/api/admin/bookings', undefined, { Cookie: cookie, ...REMOTE })).status, 200);
  assert.equal((await call(locked, 'GET', '/admin', undefined, { Cookie: cookie })).status, 200);
  assert.equal((await call(locked, 'GET', '/api/admin/session', undefined, { Cookie: cookie })).json.authenticated, true);
  assert.equal(setCookie.includes('correct horse'), false);
  assert.equal((await call(locked, 'GET', '/api/admin/config', undefined, { Cookie: cookie })).json.passcodeEnabled, true);
  assert.ok(!(await call(locked, 'GET', '/api/admin/config', undefined, { Cookie: cookie })).text.includes('correct horse'));

  // forged, tampered and expired sessions
  const [expires, signature] = cookie.split('=')[1].split('.');
  const forged = [
    `booking_admin=${Number(expires) + 1000}.${signature}`,
    `booking_admin=${expires}.${signature.replace(/.$/, (c) => (c === '0' ? '1' : '0'))}`,
    `booking_admin=${expires}`,
    'booking_admin=9999999999.',
    `booking_admin=1.${signature}`,
  ];
  for (const bad of forged) assert.equal((await call(locked, 'GET', '/api/admin/bookings', undefined, { Cookie: bad })).status, 401, bad);

  // changing the passcode ends the session
  process.env.ADMIN_PASSCODE = 'a different one';
  assert.equal((await call(locked, 'GET', '/api/admin/bookings', undefined, { Cookie: cookie })).status, 401);
  process.env.ADMIN_PASSCODE = 'correct horse battery';

  const out = await call(locked, 'POST', '/api/admin/logout');
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);

  // five wrong attempts, then a lockout that even the right passcode cannot skip
  const fresh = await listen();
  for (let i = 0; i < 5; i++) assert.equal((await call(fresh, 'POST', '/api/admin/login', { passcode: `guess ${i}` })).status, 401);
  const blocked = await call(fresh, 'POST', '/api/admin/login', { passcode: 'correct horse battery' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error.code, 'rate_limited');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('booking creation is rate limited per address', async () => {
  const limited = await listen({ limitLocalRequests: true });
  const { json } = await call(limited, 'GET', '/api/availability');
  const slots = Object.entries(json.days).filter(([d]) => d !== json.today).flatMap(([, s]) => s).slice(40, 49);
  const statuses = [];
  const ids = [];
  for (const slot of slots) {
    const res = await call(limited, 'POST', '/api/bookings', guest(slot.start));
    statuses.push(res.status);
    if (res.status === 201) ids.push(res.json.booking.id);
    if (res.status === 429) {
      assert.equal(res.json.error.code, 'rate_limited');
      assert.ok(Number(res.headers.get('retry-after')) > 0);
    }
  }
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 201, 201, 201, 429]);
  // a refused booking (taken slot) does not use up the allowance; only successes count
  for (const id of ids) await call(base, 'DELETE', `/api/admin/bookings/${id}`);
});
