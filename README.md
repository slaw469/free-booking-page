# Halfpast: a free booking page you run yourself

Someone opens your link, picks a day, picks a time, types their name and email, and the call is on your dashboard. No subscription, no account, no API keys, and nothing to install beyond Node.js.

You get three pages:

| Page | Address | Who it is for |
|---|---|---|
| Landing page | `/` | Anyone you want to explain it to |
| Booking page | `/book` | Your clients. This is the link you share |
| Dashboard | `/admin` | You: bookings, hours, profile |

"Halfpast" is only a name. Change it in `public/assets/js/brand.js`.

## Run it on your computer

You need [Node.js](https://nodejs.org) 18 or newer.

```
npm install
npm start
```

It prints the three addresses, starting with http://localhost:4517. Stop it with `Ctrl+C`.

`npm install` finishes instantly because there are no packages to download. If port 4517 is taken: `PORT=5050 npm start`.

While it runs on your computer, only that computer can open it. To give clients a real link, see [DEPLOY.md](DEPLOY.md).

## Make it yours

Open the dashboard at `/admin`.

- **Profile**: your name, agency name, what the meeting is called, and a one-line description.
- **Availability**: switch days on and off, set start and end times, meeting length, a buffer between meetings, how far ahead people can book, and your timezone.

Changes save as you make them. A booking page that is already open picks them up within a few seconds, without a reload.

The same settings are in `config.json` if you prefer a file. One setting is only there: `minimumNoticeMinutes` (default 60), which stops people booking a call that starts within the hour.

## Sample bookings

A fresh copy starts empty. To see what a busy dashboard looks like:

```
npm run seed     # adds four made-up bookings, tagged "Sample"
npm run clear    # removes them; real bookings are never touched
```

The dashboard also has a **Clear sample data** button. Sample people use `example.com` emails.

## If you put it online, set a passcode

The dashboard shows your clients' names, emails and notes. On your own computer it opens without a login, because nobody else can reach it. **On a host, set the `ADMIN_PASSCODE` environment variable**, and the dashboard and every action behind it will ask for it.

If you forget, the app does not leave the door open: with no passcode set, the dashboard refuses to load from any other machine and tells you to set one. Five wrong passcodes lock that visitor out for 15 minutes.

Step-by-step hosting instructions, costs, and the one mistake that loses bookings (no persistent disk) are in [DEPLOY.md](DEPLOY.md).

## Where your data lives

- `data/bookings.json`: every booking, as readable text. Copy it to back it up.
- `config.json`: your profile and hours.

On a host you set `DATA_DIR`, and both files live in that folder instead.

## What it does, and what it does not

It does:

- A booking page that only offers times you are free, in your timezone, with the visitor's local time shown when they are somewhere else
- No double-booking. The server decides: if two people confirm the same time at once, one gets it and the other is asked to pick again
- Buffers between meetings, a booking window, minimum notice
- A dashboard with who booked, their email and note, and a cancel button that reopens the time
- An "Add to calendar" file (.ics) that works with Google Calendar, Apple Calendar and Outlook, with a 15 minute reminder inside the event
- Updates on their own: new bookings appear on an open dashboard, changed hours appear on an open booking page

It does not, and these are real gaps compared with a paid scheduler:

- **No calendar sync.** It cannot see your Google or Outlook calendar, so it does not know you have class at 2 pm. Keep your hours right in the dashboard and add each booking to your own calendar.
- **No emails.** No confirmation to the client, no notification to you, no reminders. You see bookings by opening the dashboard. The client gets the calendar file only if they press the button.
- **No video links.** It does not create Zoom or Meet links. Put a standing link in your description, or send one yourself.
- **Clients cannot reschedule or cancel.** They message you; you cancel it in the dashboard.
- **One person, one meeting type.** No teams, no payments, no extra form questions.
- **No captcha.** There is a limit of 8 bookings per visitor per 10 minutes, nothing more.

If you need calendar sync and automatic emails today, pay for a scheduler. If you need a clean link that takes bookings for $0, this does that.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Run the app |
| `npm run seed` / `npm run clear` | Add or remove the sample bookings |
| `npm test` | Start a throwaway copy and check the whole API, including a 20-way race for one time slot |
| `npm run package` | Write `free-booking-page.zip` with stock settings and none of your bookings, ready to send to someone |
| `npm run start:classic` | Run with the plainer original pages in `ui/` instead of `public/` |

## Settings you can pass when starting

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4517` (or `port` in `config.json`) | Port to listen on |
| `ADMIN_PASSCODE` | none | Locks the dashboard |
| `DATA_DIR` | `./data` | Folder for `bookings.json`. When set, `config.json` lives there too |
| `HOST` | this computer only; `0.0.0.0` on Render, Railway, Fly, in the Docker image, or when `NODE_ENV=production` | Address to listen on. Set `HOST=0.0.0.0` yourself on any other host |
| `TRUST_PROXY` | off | Set to `1` on a host so rate limits count each visitor separately |

## Files

```
server.js            the web server: pages, API, passcode, rate limits
lib/core.js          hours, time slots, timezones, the bookings file, .ics
public/              the pages (map and design notes in public/README-frontend.md)
ui/                  the original, plainer pages (npm run start:classic)
scripts/             seed/clear sample bookings, build the zip
test/                API tests
config.json          your settings
data/                your bookings (created on first booking; never commit this)
API.md               every route, for anyone changing the pages
DEPLOY.md            hosting it
Dockerfile           for hosts that run containers
```

MIT licensed. Fonts in `public/assets/fonts` are under the SIL Open Font License.
