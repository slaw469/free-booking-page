# API

The contract between the server (`server.js`, `lib/`) and the pages in `public/`.
Written 2026-10-07. Anything that changes after this goes in **CHANGES** at the bottom, with a date.

- Everything is same-origin. No CORS headers are sent.
- Request and response bodies are JSON (`Content-Type: application/json`), except the `.ics` download.
- Request bodies are limited to 20 KB.
- All times are ISO 8601 UTC strings (`2026-10-08T19:00:00.000Z`). All calendar days are `YYYY-MM-DD` in the **host's** timezone.

## Pages and static files

| Request | Serves |
|---|---|
| `GET /` | `public/index.html` (landing page) |
| `GET /book`, `/book/` | `public/book.html` (booking page) |
| `GET /admin`, `/admin/` | `public/admin.html` (dashboard). See "Passcode" for when the server sends a sign-in page instead |
| `GET /assets/...` | the same path under `public/assets/` |
| `GET /<name>.<ext>` | a file directly inside `public/`, for these extensions only: `.css .js .svg .png .jpg .webp .ico .woff2 .json .webmanifest .txt`. This is for `favicon.ico`, `robots.txt` and similar |
| `GET /healthz` | `{"ok": true}` for host health checks |

Notes:

- Pages use relative asset paths (`assets/css/base.css`) or absolute ones (`/assets/...`); both work, including on `/book/` and `/admin/` with a trailing slash, because those two redirect (308) to the path without the slash.
- `Cache-Control` is `no-cache` for everything except `.woff2`, which is `public, max-age=31536000, immutable`.
- Unknown paths return `404` with the JSON error shape below. There is no directory listing, and dotfiles are never served.
- `HEAD` works wherever `GET` does.

## Errors

Every error, on every route, has this shape:

```json
{ "error": { "code": "slot_unavailable", "message": "That time was just taken. Please pick another one.", "field": "email" } }
```

`message` is written for the person using the page and is safe to show as text. `field` appears only on validation errors. Codes:

| Status | `code` | When |
|---|---|---|
| 400 | `invalid` | A field failed validation. `field` says which (`name`, `email`, `start`, or absent for settings) |
| 400 | `bad_json` | The body is not valid JSON |
| 401 | `passcode_required` | An admin route was called without a valid session and a passcode is set |
| 401 | `wrong_passcode` | Login with the wrong passcode |
| 403 | `passcode_not_set` | An admin route was called from another machine and no passcode is set. See "Passcode" |
| 404 | `not_found` | Unknown route, or a booking id that does not exist |
| 405 | `method_not_allowed` | Wrong method on a known path |
| 409 | `slot_unavailable` | The requested time is not open (taken, outside hours, in the past, too soon, or beyond the booking window) |
| 413 | `too_large` | Body over 20 KB |
| 429 | `rate_limited` | Too many bookings or login attempts from one address. A `Retry-After` header gives the seconds to wait |
| 500 | `server_error` | Anything unexpected |

## Public routes

### `GET /api/availability`

Everything the booking page needs, in one call. Poll it (the baseline page does every 4 s while visible) to pick up changed hours and new bookings.

```json
{
  "profile": {
    "name": "Your Name",
    "agency": "Your Agency",
    "description": "Tell me what you're working on ...",
    "meetingName": "intro call",
    "meetingTitle": "30 min intro call"
  },
  "meetingLengthMinutes": 30,
  "timezone": "America/Chicago",
  "timezoneLabel": { "long": "Central Time", "short": "CDT" },
  "today": "2026-10-07",
  "lastDay": "2026-11-06",
  "days": {
    "2026-10-08": [
      { "start": "2026-10-08T14:00:00.000Z", "end": "2026-10-08T14:30:00.000Z", "label": "9:00 AM" }
    ]
  }
}
```

- `days` holds only days that have at least one open time, from `today` to `lastDay` inclusive. A day missing from `days` is unavailable (not a working day, fully booked, or past).
- Slots within a day are in time order. `label` is the start time in the host's timezone, ready to print.
- Booked times are simply absent. Nothing about who booked is ever exposed here.
- `today` and `lastDay` are the bounds for month navigation.

### `POST /api/bookings`

Request:

```json
{ "start": "2026-10-08T19:00:00.000Z", "name": "Jordan Lee", "email": "jordan@example.com", "note": "Optional" }
```

| Field | Rules |
|---|---|
| `start` | Required. Must equal the `start` of a slot currently in `/api/availability` |
| `name` | Required, 1 to 80 characters after trimming |
| `email` | Required, at most 120 characters, must look like an email. Stored lower-case |
| `note` | Optional, at most 600 characters. Longer text is cut, not rejected |

Control characters are stripped from all three text fields. Text is stored as typed, **not** HTML-escaped: pages must render it as text (`textContent`), never as HTML.

`201`:

```json
{ "booking": { "id": "0f1dca92-8d1d-4bf7-b74b-c06706843bb6", "start": "2026-10-08T19:00:00.000Z", "end": "2026-10-08T19:30:00.000Z", "name": "Jordan Lee", "email": "jordan@example.com" } }
```

Errors: `400 invalid` (with `field`), `400 bad_json`, `409 slot_unavailable`, `413 too_large`, `429 rate_limited`.

On `409`, fetch `/api/availability` again and send the visitor back to pick another time. Double-booking is decided here, on the server: of any number of simultaneous requests for one slot, exactly one gets `201`.

Rate limit: 8 bookings per address per 10 minutes. Requests from the same machine as the server (localhost) are not limited.

### `GET /api/bookings/:id/ics`

The calendar file for a booking. `200` with `Content-Type: text/calendar; charset=utf-8` and `Content-Disposition: attachment; filename="booking.ics"`. Link to it directly: `<a href="/api/bookings/ID/ics" download>`. `404 not_found` if the booking was cancelled or never existed.

The `id` is a random UUID, so the link works as an unguessable token. No session is needed.

## Passcode

There are three states. `GET /api/admin/session` tells a page which one it is in.

| State | When | What happens |
|---|---|---|
| **Open** | No passcode is set and the request comes from the same machine as the server | Admin routes work with no login. This is the local default |
| **Locked** | A passcode is set (`ADMIN_PASSCODE` env var, or `admin.passcode` in the config file; the env var wins) | Admin routes return `401 passcode_required` until the browser logs in |
| **Refused** | No passcode is set and the request comes from another machine or through a proxy | Admin routes return `403 passcode_not_set`. Nobody can use the dashboard until the owner sets a passcode. This stops a hosted copy from exposing clients' names and emails by accident |

`GET /admin` follows the same states. Open, or locked with a valid session: `public/admin.html`. Locked without a session: the server sends its own small sign-in page (status `401`), which posts to `/api/admin/login` and reloads. Refused: the server sends a page explaining how to set the passcode (status `403`). So `admin.html` never has to render a login form, though it should still handle a `401` from the API mid-session (the session expired) by reloading the page.

If `public/login.html` exists, the server sends that instead of its built-in sign-in page. It should post `{"passcode": "..."}` to `/api/admin/login` and, on `200`, reload.

### `GET /api/admin/session`

Always `200`, never needs a session.

```json
{ "passcodeRequired": true, "authenticated": false, "refused": false }
```

`authenticated` is `true` when admin routes will work for this browser (including the open state). `refused` is `true` in the refused state.

### `POST /api/admin/login`

Request: `{ "passcode": "..." }`

- `200 {"ok": true}` and a `Set-Cookie: booking_admin=...; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800` (plus `Secure` over HTTPS). The session lasts 7 days and survives server restarts. Changing the passcode ends every session.
- `200 {"ok": true}` with no cookie in the open state.
- `401 wrong_passcode`.
- `403 passcode_not_set` in the refused state.
- `429 rate_limited` after 5 wrong attempts from one address within 15 minutes. `Retry-After` says how long is left. A correct login does not clear the count early.

### `POST /api/admin/logout`

`200 {"ok": true}` and clears the cookie. Works in every state.

## Admin routes

All of these need the open state or a logged-in session. Otherwise: `401 passcode_required` or `403 passcode_not_set`.

### `GET /api/admin/bookings`

Upcoming bookings (end time still in the future), soonest first.

```json
{
  "bookings": [
    {
      "id": "0f1dca92-8d1d-4bf7-b74b-c06706843bb6",
      "start": "2026-10-08T19:00:00.000Z",
      "end": "2026-10-08T19:30:00.000Z",
      "name": "Jordan Lee",
      "email": "jordan@example.com",
      "note": "I need a landing page for my tutoring business.",
      "createdAt": "2026-10-07T16:02:11.000Z",
      "sample": true
    }
  ],
  "pastCount": 0,
  "sampleCount": 1
}
```

`sample` is present (and `true`) only on example bookings added by `npm run seed`. `note` may be an empty string. Poll this route to show new bookings as they arrive.

### `DELETE /api/admin/bookings/:id`

Cancels a booking; its time is open again immediately. `200` with the same body as `GET /api/admin/bookings`. `404 not_found` if it is already gone.

### `POST /api/admin/clear-samples`

Removes every booking flagged `sample`. `200`: `{ "removed": 4, "bookings": [...], "pastCount": 0, "sampleCount": 0 }`.

### `POST /api/admin/seed-samples`

Adds up to four example bookings on the next open days. `200`: `{ "added": 4, "bookings": [...], "pastCount": 0, "sampleCount": 4 }`. Calling it twice adds a second set at different times.

### `GET /api/admin/config`

```json
{
  "profile": { "name": "Your Name", "agency": "Your Agency", "description": "...", "meetingName": "intro call" },
  "availability": {
    "timezone": "America/Chicago",
    "meetingLengthMinutes": 30,
    "bufferMinutes": 0,
    "daysAhead": 30,
    "minimumNoticeMinutes": 60,
    "days": {
      "mon": { "enabled": true, "start": "09:00", "end": "17:00" },
      "tue": { "enabled": true, "start": "09:00", "end": "17:00" },
      "wed": { "enabled": true, "start": "09:00", "end": "17:00" },
      "thu": { "enabled": true, "start": "09:00", "end": "17:00" },
      "fri": { "enabled": true, "start": "09:00", "end": "17:00" },
      "sat": { "enabled": false, "start": "10:00", "end": "14:00" },
      "sun": { "enabled": false, "start": "10:00", "end": "14:00" }
    }
  },
  "passcodeEnabled": false
}
```

The passcode itself is never sent.

### `PUT /api/admin/config`

Send only what changed. `profile` and `availability` are merged key by key, and `availability.days` is merged day by day, so `{"availability": {"days": {"wed": {"enabled": false, "start": "09:00", "end": "17:00"}}}}` changes Wednesday and nothing else. A day object must be sent whole (`enabled`, `start`, `end`).

`200` with the same body as `GET /api/admin/config`, already saved. The booking page sees it on its next `/api/availability` call.

`400 invalid` if anything is out of range; nothing is saved in that case. Rules:

| Field | Rules |
|---|---|
| `profile.name`, `profile.agency` | Text, at most 60 characters. Empty falls back to the default placeholder |
| `profile.meetingName` | Text, at most 40 characters. Empty falls back to `intro call` |
| `profile.description` | Text, at most 280 characters. May be empty |
| `availability.timezone` | An IANA name the server recognises, such as `America/Chicago` |
| `availability.meetingLengthMinutes` | Whole number, 5 to 240 |
| `availability.bufferMinutes` | Whole number, 0 to 120 |
| `availability.daysAhead` | Whole number, 1 to 365 |
| `availability.minimumNoticeMinutes` | Whole number, 0 to 10080 |
| `availability.days.<day>.start`, `.end` | `HH:MM`, 24-hour. For an enabled day, `end` must be after `start` |

The passcode and the port cannot be changed through the API.

## How slots are worked out

For each enabled day, slots start at `start` and repeat every `meetingLengthMinutes + bufferMinutes` until one would run past `end`. A slot is dropped if it starts sooner than `minimumNoticeMinutes` from now, or if it overlaps an existing booking once `bufferMinutes` is added to both sides. Existing bookings keep their own start and end when the meeting length changes later.

## CHANGES

### 2026-10-07, 11:55

- **Two sets of pages.** The server serves one folder at a time, chosen by the `FRONTEND` environment variable: `public` (landing at `/`, booking at `/book`, dashboard at `/admin`) or `ui` (the classic pages: booking page at both `/` and `/book`, dashboard at `/admin`). `npm run start:public` and `npm run start:classic` pick one explicitly. Until the `public/` pages pass the final check, plain `npm start` serves `ui/`; after that it serves `public/`. Everything in "Pages and static files" applies to whichever folder is being served, and if that folder has no `book.html`, `/book` serves its `index.html`.
- `npm run clear-samples` is an alias for `npm run clear`.
- Nothing in the JSON API changed.

### 2026-10-07, 12:25

- The `public/` pages passed the final click-through, so plain `npm start` now serves `public/`. `npm run start:classic` serves `ui/`.
