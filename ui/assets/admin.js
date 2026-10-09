// Host dashboard: bookings on the left, settings on the right. Settings save as you change them.
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const DAYS = [
    ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun'],
  ];
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg>';

  const state = {
    config: null,
    bookingsRaw: '',
    bookings: [],
    known: null, // ids already shown, so new arrivals can be highlighted
    confirming: null, // id of the booking whose cancel is being confirmed
  };

  // ---------- helpers ----------

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      showGate();
      throw new Error('locked');
    }
    if (!res.ok) throw new Error((body.error && body.error.message) || 'Something went wrong.');
    return body;
  }

  let toastTimer;
  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('is-on'), 1800);
  }

  function flagSaved(node, error) {
    node.classList.toggle('is-error', Boolean(error));
    node.classList.add('is-on');
    if (error) node.textContent = error;
    else node.innerHTML = `${CHECK}Saved`;
    clearTimeout(node.timer);
    if (!error) node.timer = setTimeout(() => node.classList.remove('is-on'), 1600);
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  const pad = (n) => String(n).padStart(2, '0');
  const tz = () => state.config.availability.timezone;
  const fmt = (iso, opts) => new Intl.DateTimeFormat('en-US', { timeZone: tz(), ...opts }).format(new Date(iso));
  const dayKey = (iso) => fmt(iso, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeOf = (iso) => fmt(iso, { hour: 'numeric', minute: '2-digit' });

  function hourLabel(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
  }

  function fillSelect(select, options, current) {
    const list = options.some(([value]) => String(value) === String(current)) ? options : [...options, [current, String(current)]];
    select.replaceChildren(...list.map(([value, label]) => el('option', { value: String(value), text: label })));
    select.value = String(current);
  }

  // ---------- passcode gate ----------

  function showGate() {
    $('#gate').hidden = false;
    $('#admin').hidden = true;
    $('#topActions').hidden = true;
    $('#gateInput').focus();
  }

  $('#gateForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: $('#gateInput').value }),
    });
    if (res.ok) return window.location.reload();
    $('#gateError').textContent = 'Wrong passcode. Try again.';
    $('#gateInput').select();
  });

  // ---------- bookings ----------

  function dayHeading(iso) {
    const key = dayKey(iso);
    const now = Date.now();
    const label = fmt(iso, { weekday: 'long', month: 'long', day: 'numeric' });
    if (key === dayKey(now)) return `Today · ${label}`;
    if (key === dayKey(now + 86400000)) return `Tomorrow · ${label}`;
    return label;
  }

  function bookingRow(booking, isNew) {
    const confirming = state.confirming === booking.id;
    const minutes = Math.round((Date.parse(booking.end) - Date.parse(booking.start)) / 60000);

    const actions = confirming
      ? [
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Keep', 'data-keep': booking.id }),
          el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Cancel it', 'data-confirm': booking.id }),
        ]
      : [el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Cancel', 'data-cancel': booking.id })];

    return el('article', { class: `booking${isNew ? ' is-new' : ''}` }, [
      el('div', { class: 'booking-time' }, [timeOf(booking.start), el('small', { text: `${minutes} min` })]),
      el('div', { class: 'booking-main' }, [
        el('div', { class: 'booking-name' }, [booking.name, booking.sample ? el('span', { class: 'badge', text: 'Sample' }) : null]),
        el('a', { class: 'booking-email', href: `mailto:${booking.email}`, text: booking.email }),
        booking.note ? el('p', { class: 'booking-note', text: booking.note }) : null,
      ]),
      el('div', { class: 'booking-actions' }, actions),
    ]);
  }

  function renderBookings() {
    const { bookings } = state;
    const fresh = state.known ? bookings.filter((b) => !state.known.has(b.id)).map((b) => b.id) : [];
    state.known = new Set(bookings.map((b) => b.id));

    $('#bookingCount').textContent = bookings.length;

    const samples = bookings.filter((b) => b.sample).length;
    $('#sampleNote').hidden = !samples;
    $('#sampleText').textContent = `${samples} of these ${samples === 1 ? 'is a sample booking' : 'are sample bookings'}, so the page looks alive.`;

    const summary = $('#summary');
    if (bookings.length) {
      const next = bookings[0];
      summary.replaceChildren(
        'Next up: ',
        el('strong', { text: next.name }),
        `, ${fmt(next.start, { weekday: 'long', month: 'short', day: 'numeric' })} at ${timeOf(next.start)}.`
      );
    } else {
      summary.textContent = 'Nothing booked yet. Share your link to get your first call.';
    }

    const list = $('#bookingList');
    if (!bookings.length) {
      list.replaceChildren(
        el('div', { class: 'empty' }, [el('strong', { text: 'No upcoming bookings' }), 'New bookings show up here on their own.'])
      );
      return;
    }

    const groups = new Map();
    for (const booking of bookings) {
      const key = dayKey(booking.start);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(booking);
    }
    list.replaceChildren(
      ...[...groups.values()].map((group) =>
        el('div', { class: 'day-group' }, [
          el('p', { class: 'day-label', text: dayHeading(group[0].start) }),
          ...group.map((b) => bookingRow(b, fresh.includes(b.id))),
        ])
      )
    );
  }

  function applyBookings(body) {
    state.bookings = body.bookings;
    state.bookingsRaw = JSON.stringify(body.bookings);
    renderBookings();
  }

  async function refreshBookings() {
    let body;
    try {
      body = await api('/api/admin/bookings');
    } catch {
      return;
    }
    if (JSON.stringify(body.bookings) !== state.bookingsRaw) applyBookings(body);
  }

  $('#bookingList').addEventListener('click', async (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.cancel) state.confirming = btn.dataset.cancel;
    else if (btn.dataset.keep) state.confirming = null;
    else if (btn.dataset.confirm) {
      state.confirming = null;
      try {
        applyBookings(await api(`/api/admin/bookings/${btn.dataset.confirm}`, { method: 'DELETE' }));
        toast('Booking cancelled. That time is open again.');
      } catch (err) {
        toast(err.message);
        refreshBookings();
      }
      return;
    }
    renderBookings();
  });

  $('#clearSamples').addEventListener('click', async () => {
    try {
      const body = await api('/api/admin/clear-samples', { method: 'POST' });
      applyBookings(body);
      toast(`Removed ${body.removed} sample booking${body.removed === 1 ? '' : 's'}.`);
    } catch (err) {
      toast(err.message);
    }
  });

  // ---------- availability ----------

  const TIMES = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    const value = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    TIMES.push([value, hourLabel(value)]);
  }

  function renderDayRows() {
    const days = state.config.availability.days;
    $('#dayRows').replaceChildren(
      ...DAYS.map(([key, label]) => {
        const day = days[key];
        const toggle = el('label', { class: 'switch' }, [
          el('input', { type: 'checkbox', checked: day.enabled, 'data-day': key, 'data-part': 'enabled', 'aria-label': `${label} available` }),
          el('i'),
        ]);
        let hours;
        if (day.enabled) {
          const start = el('select', { class: 'select', 'data-day': key, 'data-part': 'start', 'aria-label': `${label} start` });
          const end = el('select', { class: 'select', 'data-day': key, 'data-part': 'end', 'aria-label': `${label} end` });
          fillSelect(start, TIMES, day.start);
          fillSelect(end, TIMES, day.end);
          hours = el('div', { class: 'day-row-hours' }, [start, el('span', { text: 'to' }), end]);
        } else {
          hours = el('div', { class: 'day-row-off', text: 'Unavailable' });
        }
        return el('div', { class: 'day-row' }, [toggle, el('span', { class: 'day-row-name', text: label }), hours]);
      })
    );
  }

  function renderRules() {
    const a = state.config.availability;
    fillSelect($('#meetingLength'), [15, 20, 30, 45, 60, 90].map((n) => [n, `${n} min`]), a.meetingLengthMinutes);
    fillSelect($('#buffer'), [[0, 'None'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min']], a.bufferMinutes);
    fillSelect($('#daysAhead'), [[7, '1 week'], [14, '2 weeks'], [30, '30 days'], [60, '60 days'], [90, '90 days']], a.daysAhead);
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    fillSelect($('#timezone'), zones.map((z) => [z, z.replace(/_/g, ' ')]), a.timezone);
  }

  const saveAvailability = debounce(async () => {
    const a = state.config.availability;
    const bad = DAYS.find(([key]) => a.days[key].enabled && a.days[key].end <= a.days[key].start);
    if (bad) return flagSaved($('#availSaved'), `${bad[1]}: end must be after start`);
    try {
      const body = await api('/api/admin/config', { method: 'PUT', body: JSON.stringify({ availability: a }) });
      state.config.availability = body.availability;
      flagSaved($('#availSaved'));
      renderBookings(); // times are shown in the host timezone, which may have changed
    } catch (err) {
      if (err.message !== 'locked') flagSaved($('#availSaved'), err.message);
    }
  }, 200);

  $('#dayRows').addEventListener('change', (event) => {
    const { day, part } = event.target.dataset;
    if (!day) return;
    state.config.availability.days[day][part] = part === 'enabled' ? event.target.checked : event.target.value;
    if (part === 'enabled') renderDayRows();
    saveAvailability();
  });

  for (const [id, key] of [['meetingLength', 'meetingLengthMinutes'], ['buffer', 'bufferMinutes'], ['daysAhead', 'daysAhead']]) {
    $(`#${id}`).addEventListener('change', (event) => {
      state.config.availability[key] = Number(event.target.value);
      saveAvailability();
    });
  }
  $('#timezone').addEventListener('change', (event) => {
    state.config.availability.timezone = event.target.value;
    saveAvailability();
  });

  // ---------- profile ----------

  const PROFILE_FIELDS = [['pName', 'name'], ['pAgency', 'agency'], ['pMeeting', 'meetingName'], ['pDescription', 'description']];

  function renderHeader() {
    const { profile } = state.config;
    document.querySelectorAll('[data-agency]').forEach((node) => (node.textContent = profile.agency));
    document.querySelectorAll('[data-first-name]').forEach((node) => (node.textContent = profile.name === 'Your Name' ? 'there' : profile.name.trim().split(/\s+/)[0] || 'there'));
    document.title = `Dashboard · ${profile.agency}`;
  }

  const saveProfile = debounce(async () => {
    const profile = {};
    for (const [id, key] of PROFILE_FIELDS) profile[key] = $(`#${id}`).value;
    try {
      const body = await api('/api/admin/config', { method: 'PUT', body: JSON.stringify({ profile }) });
      state.config.profile = body.profile;
      renderHeader();
      flagSaved($('#profileSaved'));
    } catch (err) {
      if (err.message !== 'locked') flagSaved($('#profileSaved'), err.message);
    }
  }, 450);

  for (const [id] of PROFILE_FIELDS) $(`#${id}`).addEventListener('input', saveProfile);

  // ---------- booking link ----------

  const bookingLink = () => `${window.location.origin}/`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(bookingLink());
    } catch {
      $('#linkField').select();
      document.execCommand('copy');
    }
    toast('Booking link copied');
  }
  $('#copyLink').addEventListener('click', copyLink);
  $('#copyLink2').addEventListener('click', copyLink);

  // ---------- start ----------

  async function start() {
    try {
      state.config = await api('/api/admin/config');
    } catch {
      return; // locked: the passcode form is showing
    }
    $('#admin').hidden = false;
    $('#topActions').hidden = false;
    $('#linkField').value = bookingLink();
    for (const [id, key] of PROFILE_FIELDS) $(`#${id}`).value = state.config.profile[key];
    renderHeader();
    renderDayRows();
    renderRules();
    await refreshBookings();
    renderBookings();

    setInterval(() => document.visibilityState === 'visible' && refreshBookings(), 3000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshBookings());
    window.addEventListener('focus', refreshBookings);
  }

  start();
})();
