# Front end

Plain HTML, CSS and JavaScript (ES modules). No build step, no framework, no CDN. Fonts are self-hosted in `assets/fonts/`, so the whole thing works offline.

## Rename it

The product name, tagline, footer credit and repo link live in one file: `assets/js/brand.js`. Change them there and every page updates. (The HTML also carries the default name as plain text so the pages read correctly before JavaScript runs; search for `Halfpast` if you want those gone too.)

The accent colour is one variable: `--lime` in `assets/css/base.css`.

## Design plan

**Name:** Halfpast. Short, about time, not about anyone else's product. The mark is a clock face with the hand at half past.

**Concept:** "Ink and highlighter." Near-black green ink, warm paper, and a single highlighter-lime accent that only ever marks the thing you picked or the thing to press. The landing page is dark and loud; the booking flow and dashboard are light and calm so they read when the screen is small.

**Palette**

| Name       | Hex       | Used for                                             |
|------------|-----------|------------------------------------------------------|
| Ink        | `#0F130E` | Text, dark surfaces, primary buttons                 |
| Moss       | `#1A2118` | Raised dark surfaces on the landing page             |
| Paper      | `#F5F4EE` | Light page background                                |
| Card       | `#FFFFFF` | Light raised surfaces                                |
| Stone      | `#5C6357` | Secondary text on light                              |
| Fog        | `#A9B0A2` | Secondary text on dark                               |
| Lime       | `#C8F53C` | The one accent: selected day, selected slot, actions |
| Lime deep  | `#3F6B00` | Accent text on light backgrounds (passes AA)         |
| Signal red | `#B8321C` | Errors and destructive actions only                  |

Lime always carries Ink text (about 14:1). It is never used as text on a light background.

**Type**

- Display: Bricolage Grotesque (variable, OFL). Headlines, the month name, big numerals. Tight tracking, heavy weights.
- Body and UI: Geist (variable, OFL).
- Numbers: Geist Mono (variable, OFL). Times, dates, code.
- Fallbacks: `ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif` and `ui-monospace, "SF Mono", Menlo, monospace`.
- Scale (px): 13, 15, 17, 20, 24, 32, 44, 64, 88. Body is 17 on the booking flow so it survives being shrunk into a phone frame.

**Layout**

- Landing: left-aligned hero with the real booking widget on the right, playing itself. Sections alternate dark and paper. Features are an uneven grid, not three equal cards.
- Booking: one card, three columns on desktop (host, calendar, times); one column on a phone with the primary action pinned to the bottom edge within thumb reach.
- Dashboard: side rail on desktop, bottom tab bar on a phone. Lists are separated by hairlines, not boxed in cards.
- Spacing on a 4px grid: 4, 8, 12, 16, 24, 32, 48, 72, 112. Radii: 10 (controls), 16 (cards), 28 (shells), full (pills).

**Motion**

- Only `transform` and `opacity` are animated.
- One easing for movement, `cubic-bezier(0.22, 1, 0.36, 1)`, and one with a little overshoot for "you picked this" moments, `cubic-bezier(0.34, 1.4, 0.64, 1)`.
- Durations: 140ms (press), 260ms (select), 480ms (panel change).
- The three moments that matter: the selected day gets a lime disc that pops in; the selected slot fills lime with a tick while the action bar names the time you picked; the confirmation draws a tick and settles the details in one after another.
- `prefers-reduced-motion: reduce` turns all of it off, including the self-playing demo on the landing page.

## Files

```
index.html   landing page (/)
book.html    public booking page (/book)
admin.html   dashboard (/admin)
login.html   passcode screen; the server sends it for /admin when a passcode is set

assets/css/base.css      tokens, fonts, buttons, fields, toasts
assets/css/widget.css    calendar, time slots, confirmation ticket (shared)
assets/css/landing.css   landing page only
assets/css/book.css      booking page layout
assets/css/admin.css     dashboard and passcode screen

assets/js/brand.js       name, tagline, credit: edit this
assets/js/api.js         every call to the server (see API.md)
assets/js/dom.js         safe DOM helpers, toasts, copy to clipboard
assets/js/dates.js       calendar-day and timezone helpers
assets/js/calendar.js    the month grid, with keyboard support
assets/js/landing.js     self-playing demo, scroll reveals
assets/js/book.js        booking flow
assets/js/admin.js       dashboard
assets/js/login.js       passcode screen

assets/icons.svg         icon sprite
assets/fonts/            three variable fonts, self-hosted
```

Anything that came from a person (names, notes, agency text) is written with `textContent`, never `innerHTML`.

## Behaviour worth knowing

- The booking page re-reads availability every 4 seconds while it is visible, so changes made in the dashboard appear without a reload.
- The dashboard checks for new bookings every 4 seconds; a new one flashes lime as it arrives.
- Availability and profile edits save on their own about a third of a second after the last change. There is no Save button.
- Layout switches: the booking page is three columns above 920px and one column below it. The dashboard rail becomes a top bar and bottom tabs below 800px.
- Keyboard: arrow keys move through calendar days and through times, Page Up and Page Down change month, Enter or Space selects, Enter on a selected time continues.
- The demo on the landing page uses made-up availability and never calls the server, so the landing page still works if you host it on its own.

## Fonts

Bricolage Grotesque, Geist and Geist Mono are licensed under the SIL Open Font License 1.1, which allows bundling and redistribution.
