'use strict';

// npm run package
// Builds free-booking-page.zip: the app, ready to send. Leaves out your bookings, your
// personal settings, node_modules, screenshots and working notes.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const core = require('../lib/core');

const ROOT = path.join(__dirname, '..');
const NAME = 'free-booking-page';
const OUT = path.join(ROOT, `${NAME}.zip`);

const INCLUDE = [
  'server.js', 'lib', 'scripts', 'public', 'ui', 'test', 'package.json',
  'README.md', 'DEPLOY.md', 'API.md', 'PROMPT.md', 'LICENSE',
  'Dockerfile', '.dockerignore', '.gitignore',
];
const SKIP = new Set(['.DS_Store', 'node_modules']);

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-package-'));
const target = path.join(stage, NAME);
fs.mkdirSync(target);

const missing = [];
for (const item of INCLUDE) {
  const from = path.join(ROOT, item);
  if (!fs.existsSync(from)) {
    missing.push(item);
    continue;
  }
  fs.cpSync(from, path.join(target, item), { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
}

// Always ship the stock settings, never the sender's own name, hours or passcode.
const stock = core.normalizeConfig({}).config;
stock.profile.description = "Tell me what you're working on and I'll show you how we can help. No pitch deck, just a conversation.";
const days = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, stock.availability.days[d]]));
const text = JSON.stringify({ ...stock, availability: { ...stock.availability, days } }, null, 2).replace(
  /\{\s+"enabled": (true|false),\s+"start": ("[^"]*"),\s+"end": ("[^"]*")\s+\}/g,
  '{ "enabled": $1, "start": $2, "end": $3 }'
);
fs.writeFileSync(path.join(target, 'config.json'), text + '\n');

fs.rmSync(OUT, { force: true });
try {
  execFileSync('zip', ['-r', '-q', '-X', OUT, NAME], { cwd: stage, stdio: 'inherit' });
} catch (err) {
  console.error('Could not run the "zip" command. It ships with macOS and Linux; on Windows, zip the folder by hand.');
  process.exitCode = 1;
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

if (!process.exitCode) {
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`Wrote ${path.relative(process.cwd(), OUT) || OUT} (${kb} KB)`);
  if (missing.length) console.log(`Note: not found, so not included: ${missing.join(', ')}`);
}
