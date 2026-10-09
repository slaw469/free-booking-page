'use strict';

// The web server. Routes and response shapes are documented in API.md.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('./lib/core');

// Two sets of pages share this server and API (see API.md):
//   ui/      the classic pages: booking page at / (and /book), dashboard at /admin
//   public/  the full site: landing page at /, booking at /book, dashboard at /admin
// FRONTEND=public or FRONTEND=ui picks one; DEFAULT_FRONTEND is used otherwise.
const DEFAULT_FRONTEND = 'public';
const FRONTEND = ['ui', 'public'].includes(process.env.FRONTEND) ? process.env.FRONTEND : DEFAULT_FRONTEND;
const PUBLIC_DIR = path.join(__dirname, fs.existsSync(path.join(__dirname, FRONTEND)) ? FRONTEND : 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};
const PAGES = { '/': 'index.html', '/book': 'book.html', '/admin': 'admin.html' };

const MAX_BODY_BYTES = 20000;
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const BOOKING_LIMIT = { max: 8, windowMs: 10 * 60 * 1000 };
const LOGIN_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
};

// ---------- responses ----------

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    ...BASE_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(res.req.method === 'HEAD' ? undefined : JSON.stringify(body));
}

function sendError(res, status, code, message, extra = {}, headers = {}) {
  sendJson(res, status, { error: { code, message, ...extra } }, headers);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
  res.end(res.req.method === 'HEAD' ? undefined : html);
}

function sendFile(res, file, status = 200) {
  fs.readFile(file, (err, data) => {
    if (err) return sendError(res, 404, 'not_found', 'Not found.');
    const ext = path.extname(file);
    res.writeHead(status, {
      ...BASE_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Fonts never change, so let the browser keep them; everything else is revalidated.
      'Cache-Control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(res.req.method === 'HEAD' ? undefined : data);
  });
}

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Stop keeping the data; the connection is closed once the 413 has been sent.
        chunks.length = 0;
        return reject(httpError(413, 'too_large', 'That request is too large.'));
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(body && typeof body === 'object' && !Array.isArray(body) ? body : {});
      } catch {
        reject(httpError(400, 'bad_json', 'The request body is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

// ---------- who is asking ----------

const FORWARD_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'fly-client-ip'];

function isLoopback(address = '') {
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.');
}

// True only for a browser on the same machine as the server, talking to it directly.
// A request relayed by a proxy or tunnel counts as remote even if the relay is local.
function isLocalRequest(req) {
  return isLoopback(req.socket.remoteAddress) && !FORWARD_HEADERS.some((h) => req.headers[h]);
}

// The address used for rate limits. Behind a host's proxy, set TRUST_PROXY=1 so the
// visitor's address is used instead of the proxy's.
function clientAddress(req) {
  if (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-for']) {
    const hops = String(req.headers['x-forwarded-for']).split(',');
    return hops[hops.length - 1].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

// ---------- rate limits (in memory, per address) ----------

function createLimiter({ max, windowMs }) {
  const hits = new Map();
  const current = (key, now) => {
    const entry = hits.get(key);
    if (entry && entry.resetAt > now) return entry;
    hits.delete(key);
    return null;
  };
  return {
    // Seconds until the address may try again, or 0 if it is under the limit.
    blockedFor(key, now = Date.now()) {
      const entry = current(key, now);
      return entry && entry.count >= max ? Math.ceil((entry.resetAt - now) / 1000) : 0;
    },
    record(key, now = Date.now()) {
      if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      const entry = current(key, now) || { count: 0, resetAt: now + windowMs };
      entry.count += 1;
      hits.set(key, entry);
    },
  };
}

// ---------- admin passcode ----------

function adminPasscode(config) {
  return process.env.ADMIN_PASSCODE || config.admin.passcode || '';
}

function cookieValue(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

// Sessions are a signed expiry time, so they survive restarts and need no storage.
// The signing key comes from the passcode: change the passcode and every session ends.
function signSession(expires, passcode) {
  const key = crypto.createHash('sha256').update(`booking-admin:${passcode}`).digest();
  return crypto.createHmac('sha256', key).update(String(expires)).digest('hex');
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function hasSession(req, passcode, now) {
  const [expires, signature] = cookieValue(req, 'booking_admin').split('.');
  if (!expires || !signature || !(Number(expires) * 1000 > now)) return false;
  return safeEqual(signature, signSession(expires, passcode));
}

// 'open'    no passcode, same machine: no login needed
// 'ok'      passcode set and this browser is logged in
// 'locked'  passcode set, not logged in
// 'refused' no passcode and the request is not from this machine
function adminState(req, config, now) {
  const passcode = adminPasscode(config);
  if (!passcode) return isLocalRequest(req) ? 'open' : 'refused';
  return hasSession(req, passcode, now) ? 'ok' : 'locked';
}

function sessionCookie(req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  return `booking_admin=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

const REFUSED_MESSAGE =
  'This dashboard has no passcode yet, so it only opens on the computer running it. Set the ADMIN_PASSCODE environment variable and restart.';

function simplePage(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f3ee; color: #14171a;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { width: min(380px, calc(100vw - 32px)); padding: 28px; background: #fff; border: 1px solid #e4e1d8; border-radius: 16px; }
  h1 { margin: 0 0 6px; font-size: 22px; }
  p { margin: 0 0 18px; color: #4b515a; }
  code { background: #f1efe8; padding: 2px 6px; border-radius: 6px; font-size: 14px; }
  input, button { width: 100%; min-height: 48px; border-radius: 10px; font: inherit; box-sizing: border-box; }
  input { padding: 0 14px; border: 1.5px solid #cfcabd; }
  button { margin-top: 12px; border: 0; background: #14171a; color: #fff; font-weight: 600; cursor: pointer; }
  [role=alert] { min-height: 22px; margin: 8px 0 0; color: #b3321c; font-size: 14px; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

const LOGIN_PAGE = simplePage(
  'Sign in',
  `<h1>Dashboard</h1>
<p>Enter the passcode to continue.</p>
<form id="f">
  <input id="p" type="password" autocomplete="current-password" aria-label="Passcode" required autofocus>
  <p role="alert" id="e"></p>
  <button type="submit">Unlock</button>
</form>
<script>
  document.getElementById('f').addEventListener('submit', async (event) => {
    event.preventDefault();
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: document.getElementById('p').value }),
    });
    if (res.ok) return location.reload();
    const body = await res.json().catch(() => ({}));
    document.getElementById('e').textContent = (body.error && body.error.message) || 'Could not sign in.';
    document.getElementById('p').select();
  });
</script>`
);

const REFUSED_PAGE = simplePage(
  'Passcode needed',
  `<h1>Set a passcode first</h1>
<p>This dashboard shows your clients' names and emails, so it will not open over the internet until it has a passcode.</p>
<p>On your host, add an environment variable named <code>ADMIN_PASSCODE</code> with a long passcode, then restart or redeploy. Steps are in DEPLOY.md.</p>`
);

// ---------- views of the data ----------

function publicView(config, nowMs) {
  const a = config.availability;
  return {
    profile: {
      name: config.profile.name,
      agency: config.profile.agency,
      description: config.profile.description,
      meetingName: config.profile.meetingName,
      meetingTitle: core.meetingTitle(config),
    },
    meetingLengthMinutes: a.meetingLengthMinutes,
    timezone: a.timezone,
    timezoneLabel: core.timezoneLabel(a.timezone, nowMs),
    ...core.buildAvailability(config, core.readBookings(), nowMs),
  };
}

function adminConfigView(config) {
  return {
    profile: config.profile,
    availability: config.availability,
    passcodeEnabled: Boolean(adminPasscode(config)),
  };
}

function adminBookingsView(nowMs) {
  const all = core.readBookings();
  const upcoming = all.filter((b) => Date.parse(b.end) > nowMs).sort((a, b) => a.start.localeCompare(b.start));
  return {
    bookings: upcoming,
    pastCount: all.length - upcoming.length,
    sampleCount: upcoming.filter((b) => b.sample).length,
  };
}

// ---------- the app ----------

function createApp({ limitLocalRequests = process.env.RATE_LIMIT_LOCAL === '1', log = console.log } = {}) {
  const bookingLimiter = createLimiter(BOOKING_LIMIT);
  const loginLimiter = createLimiter(LOGIN_LIMIT);
  const limited = (req) => limitLocalRequests || !isLocalRequest(req);
  const tooMany = (res, seconds, message) =>
    sendError(res, 429, 'rate_limited', message, {}, { 'Retry-After': String(seconds) });

  const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

  // [method, path pattern, needs admin, handler]
  const routes = [
    ['GET', /^\/healthz$/, false, (ctx) => sendJson(ctx.res, 200, { ok: true })],

    ['GET', /^\/api\/availability$/, false, (ctx) => sendJson(ctx.res, 200, publicView(ctx.config, ctx.now))],

    ['POST', /^\/api\/bookings$/, false, async (ctx) => {
      const { req, res, now } = ctx;
      const address = clientAddress(req);
      if (limited(req)) {
        const wait = bookingLimiter.blockedFor(address, now);
        if (wait) return tooMany(res, wait, 'Too many bookings from this connection. Please try again in a few minutes.');
      }
      const result = core.createBooking(await readJsonBody(req), now);
      if (!result.ok) {
        return sendError(res, result.status, result.code, result.message, result.field ? { field: result.field } : {});
      }
      if (limited(req)) bookingLimiter.record(address, now);
      const { id, start, end, name, email } = result.booking;
      log(`  New booking: ${name} <${email}> at ${start}`);
      return sendJson(res, 201, { booking: { id, start, end, name, email } });
    }],

    ['GET', new RegExp(`^/api/bookings/${UUID}/ics$`), false, (ctx) => {
      const booking = core.readBookings().find((b) => b.id === ctx.params[0]);
      if (!booking) return sendError(ctx.res, 404, 'not_found', 'That booking no longer exists.');
      ctx.res.writeHead(200, {
        ...BASE_HEADERS,
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="booking.ics"',
        'Cache-Control': 'no-store',
      });
      return ctx.res.end(ctx.req.method === 'HEAD' ? undefined : core.buildIcs(booking, ctx.config, ctx.now));
    }],

    ['GET', /^\/api\/admin\/session$/, false, (ctx) => {
      const state = adminState(ctx.req, ctx.config, ctx.now);
      return sendJson(ctx.res, 200, {
        passcodeRequired: Boolean(adminPasscode(ctx.config)),
        authenticated: state === 'open' || state === 'ok',
        refused: state === 'refused',
      });
    }],

    ['POST', /^\/api\/admin\/login$/, false, async (ctx) => {
      const { req, res, config, now } = ctx;
      const passcode = adminPasscode(config);
      if (!passcode) {
        if (!isLocalRequest(req)) return sendError(res, 403, 'passcode_not_set', REFUSED_MESSAGE);
        return sendJson(res, 200, { ok: true });
      }
      // Login attempts are limited for everyone, local or not.
      const address = clientAddress(req);
      const wait = loginLimiter.blockedFor(address, now);
      if (wait) return tooMany(res, wait, `Too many wrong passcodes. Try again in ${Math.ceil(wait / 60)} minutes.`);
      const body = await readJsonBody(req);
      if (typeof body.passcode !== 'string' || !safeEqual(body.passcode, passcode)) {
        loginLimiter.record(address, now);
        return sendError(res, 401, 'wrong_passcode', 'Wrong passcode.');
      }
      const expires = Math.floor(now / 1000) + SESSION_SECONDS;
      const token = `${expires}.${signSession(expires, passcode)}`;
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token, SESSION_SECONDS) });
    }],

    ['POST', /^\/api\/admin\/logout$/, false, (ctx) =>
      sendJson(ctx.res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(ctx.req, '', 0) })],

    ['GET', /^\/api\/admin\/bookings$/, true, (ctx) => sendJson(ctx.res, 200, adminBookingsView(ctx.now))],

    ['DELETE', new RegExp(`^/api/admin/bookings/${UUID}$`), true, (ctx) => {
      if (!core.cancelBooking(ctx.params[0])) return sendError(ctx.res, 404, 'not_found', 'That booking no longer exists.');
      return sendJson(ctx.res, 200, adminBookingsView(ctx.now));
    }],

    ['POST', /^\/api\/admin\/clear-samples$/, true, (ctx) => {
      const removed = core.clearSampleBookings();
      return sendJson(ctx.res, 200, { removed, ...adminBookingsView(ctx.now) });
    }],

    ['POST', /^\/api\/admin\/seed-samples$/, true, (ctx) => {
      const added = core.addSampleBookings(ctx.now).length;
      return sendJson(ctx.res, 200, { added, ...adminBookingsView(ctx.now) });
    }],

    ['GET', /^\/api\/admin\/config$/, true, (ctx) => sendJson(ctx.res, 200, adminConfigView(ctx.config))],

    ['PUT', /^\/api\/admin\/config$/, true, async (ctx) => {
      const { res, config } = ctx;
      const body = await readJsonBody(ctx.req);
      const part = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
      const availability = part(body.availability);
      // The passcode and port are only ever changed outside the API.
      const { config: next, errors } = core.normalizeConfig({
        profile: { ...config.profile, ...part(body.profile) },
        availability: {
          ...config.availability,
          ...availability,
          days: { ...config.availability.days, ...part(availability.days) },
        },
        admin: config.admin,
        port: config.port,
      });
      if (errors.length) return sendError(res, 400, 'invalid', errors.join(' '));
      core.saveConfig(next);
      return sendJson(res, 200, adminConfigView(next));
    }],
  ];

  async function handleApi(req, res, pathname) {
    const matches = routes.filter(([, pattern]) => pattern.test(pathname));
    if (!matches.length) return sendError(res, 404, 'not_found', 'Not found.');
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const route = matches.find(([m]) => m === method);
    if (!route) return sendError(res, 405, 'method_not_allowed', 'Method not allowed.');

    const [, pattern, needsAdmin, handler] = route;
    const config = core.loadConfig();
    const now = Date.now();
    if (needsAdmin) {
      const state = adminState(req, config, now);
      if (state === 'locked') return sendError(res, 401, 'passcode_required', 'Please enter the passcode.');
      if (state === 'refused') return sendError(res, 403, 'passcode_not_set', REFUSED_MESSAGE);
    }
    return handler({ req, res, config, now, params: pattern.exec(pathname).slice(1) });
  }

  function handlePage(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'method_not_allowed', 'Method not allowed.');

    if (pathname === '/book/' || pathname === '/admin/') {
      res.writeHead(308, { ...BASE_HEADERS, Location: pathname.slice(0, -1) });
      return res.end();
    }

    if (pathname === '/admin') {
      const state = adminState(req, core.loadConfig(), Date.now());
      if (state === 'refused') return sendHtml(res, 403, REFUSED_PAGE);
      if (state === 'locked') {
        const custom = path.join(PUBLIC_DIR, 'login.html');
        return fs.existsSync(custom) ? sendFile(res, custom, 401) : sendHtml(res, 401, LOGIN_PAGE);
      }
    }

    if (PAGES[pathname]) {
      const page = path.join(PUBLIC_DIR, PAGES[pathname]);
      // The classic pages have no separate landing page, so /book shows the same page as /.
      return sendFile(res, fs.existsSync(page) ? page : path.join(PUBLIC_DIR, 'index.html'));
    }

    // Everything else is a plain file: /assets/..., or a known file type directly in public/.
    const file = path.normalize(path.join(PUBLIC_DIR, pathname));
    const relative = path.relative(PUBLIC_DIR, file);
    const parts = relative.split(path.sep);
    const inside = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    const hidden = parts.some((part) => part.startsWith('.'));
    const allowed = parts[0] === 'assets' || (parts.length === 1 && path.extname(file) !== '.html');
    if (!inside || hidden || !allowed || !MIME[path.extname(file)]) return sendError(res, 404, 'not_found', 'Not found.');
    return sendFile(res, file);
  }

  return async function app(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.includes('\0')) throw new Error('bad path');
    } catch {
      return sendError(res, 400, 'invalid', 'Bad request.');
    }

    try {
      if (pathname.startsWith('/api/') || pathname === '/healthz') return await handleApi(req, res, pathname);
      return handlePage(req, res, pathname);
    } catch (err) {
      if (!err.status) console.error(err);
      if (res.headersSent) return res.end();
      if (err.status === 413) {
        res.on('finish', () => req.destroy());
        return sendError(res, 413, err.code, err.message, {}, { Connection: 'close' });
      }
      if (err.status) return sendError(res, err.status, err.code, err.message);
      return sendError(res, 500, 'server_error', 'Something went wrong on the server.');
    }
  };
}

// ---------- start ----------

function start() {
  const problem = core.checkDataDir();
  if (problem) {
    console.error(`\n  ${problem}\n  Set DATA_DIR to a folder this app may write to.\n`);
    process.exit(1);
  }
  core.ensureConfigFile();
  const config = core.loadConfig();
  const port = Number(process.env.PORT) || config.port;
  const passcodeOn = Boolean(adminPasscode(config));

  // On your own computer the server answers only that computer. On a host (recognised by
  // NODE_ENV=production or the variables Render, Railway and Fly set) it accepts outside
  // connections. HOST overrides the guess either way.
  const hosted =
    process.env.NODE_ENV === 'production' ||
    ['RENDER', 'RAILWAY_ENVIRONMENT', 'FLY_APP_NAME'].some((name) => process.env[name]);
  const hosts = process.env.HOST ? [process.env.HOST] : hosted ? ['0.0.0.0'] : ['127.0.0.1', '::1'];

  const app = createApp();
  const servers = [];
  let announced = false;

  const announce = () => {
    if (announced) return;
    announced = true;
    const base = `http://localhost:${port}`;
    console.log('');
    console.log('  Free Booking Page is running');
    console.log('');
    const landing = fs.existsSync(path.join(PUBLIC_DIR, 'book.html'));
    if (landing) console.log(`  Home           ${base}`);
    console.log(`  Booking page   ${base}${landing ? '/book' : ''}`);
    console.log(`  Dashboard      ${base}/admin`);
    console.log('');
    console.log(`  Bookings are saved in ${core.BOOKINGS_PATH}`);
    if (passcodeOn) console.log('  Dashboard passcode is ON.');
    else if (hosts.some((h) => !['127.0.0.1', '::1', 'localhost'].includes(h))) {
      console.log('  No ADMIN_PASSCODE is set: the dashboard will only open on this computer.');
    }
    console.log('  Stop with Ctrl+C.');
    console.log('');
  };

  hosts.forEach((host, index) => {
    const server = http.createServer(app);
    servers.push(server);
    server.on('error', (err) => {
      if (index > 0) return; // the IPv6 loopback is a convenience; fine if it is unavailable
      if (err.code === 'EADDRINUSE') {
        console.error(`\n  Port ${port} is already in use. Try another one:  PORT=${port + 1} npm start\n`);
        process.exit(1);
      }
      throw err;
    });
    server.listen(port, host, announce);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      let open = servers.length;
      for (const server of servers) server.close(() => --open || process.exit(0));
      setTimeout(() => process.exit(0), 500).unref();
    });
  }
}

if (require.main === module) start();

module.exports = { createApp };
