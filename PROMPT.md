# The one prompt

Paste this into Claude Code in an empty folder.

```
Build me a free replacement for Calendly that I can run on my own computer and give away.

A booking page: my name, my agency, a one-line description and "30 min intro call" on the
left. A month calendar in the middle with the days I'm free highlighted. Click a day and the
open times for that day appear. Pick a time, type your name, email and what you want to
talk about, confirm, and you get a confirmation screen with an "Add to calendar" button
that downloads a real .ics file.

A dashboard at /admin for me: upcoming bookings with a cancel button, switches for which
days I work and what hours, meeting length, buffer between meetings, how far ahead people
can book, my profile, and a button that copies my booking link. When I change my hours the
booking page should update by itself.

A landing page at / that explains it, with a live demo of the booking widget.

Two people must never be able to book the same time. Check that on the server, not just in
the page.

Keep it simple: Node, no paid services, no accounts, no packages, no build step. Settings in
one config.json, bookings saved to a file. Starts with "npm start". Sample bookings only
when I run "npm run seed".

Make it safe for strangers to host: a passcode for the dashboard from an environment
variable, and refuse to show the dashboard over the internet if no passcode is set. Rate
limit bookings and passcode attempts. Add a Dockerfile, hosting instructions, tests, and a
command that zips it up without my data.

Make it look like a product someone would pay for, not a template: one accent colour, real
typography, big enough to read on a phone. Then run it and test the whole thing yourself,
including trying to double-book.
```

That describes what is in this folder. In practice it was built in a few rounds rather than one message: the booking flow and dashboard first, then the landing page and the design, then the hosting and safety work.
