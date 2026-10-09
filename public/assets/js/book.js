// The public booking flow: pick a day, pick a time, leave your details, done.

import { api, ApiError } from './api.js';
import { applyBrand } from './brand.js';
import { $, el, clear, icon, busy, reducedMotion } from './dom.js';
import { createCalendar } from './calendar.js';
import { formatDay, monthKey, parseYmd, timeIn, dayIn, zoneShort, browserZone, zonesDiffer, minutesLabel } from './dates.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const view = {
  booking: $('#booking'),
  host: $('#host'),
  cal: $('#cal'),
  slots: $('#slots'),
  banner: $('#banner'),
  announce: $('#announce'),
  actionText: $('#actionbar-text'),
  next: $('#continue'),
  steps: { pick: $('#step-pick'), details: $('#step-details'), done: $('#step-done') },
  back: $('#back'),
  chosen: $('#chosen'),
  form: $('#form'),
  formError: $('#form-error'),
  submit: $('#submit'),
  noteCount: $('#f-note-count'),
};

const state = {
  data: null, // last /api/availability response
  day: '', // selected YYYY-MM-DD (host timezone)
  slot: null, // selected { start, end, label }
  step: 'pick',
  calendar: null,
  guest: { name: '', email: '' },
  myZone: browserZone(),
};

applyBrand();
start();

async function start() {
  try {
    state.data = await api.availability();
  } catch (err) {
    return showFatal(err);
  }
  view.booking.removeAttribute('aria-busy');
  document.title = `Book a ${state.data.profile.meetingTitle} with ${state.data.profile.name}`;
  renderHost();
  state.day = firstOpenDay() || state.data.today;
  buildCalendar();
  renderSlots();
  wire();
  watch();
}

// ---------- data helpers ----------

const slotsFor = (day) => (state.data.days && state.data.days[day]) || [];

function firstOpenDay(after = '') {
  return Object.keys(state.data.days || {})
    .sort()
    .find((day) => day > after && slotsFor(day).length);
}

function dayStatus(day) {
  if (day < state.data.today || day > state.data.lastDay) return 'off';
  return slotsFor(day).length ? 'open' : 'none';
}

function zoneName() {
  const label = state.data.timezoneLabel;
  return (label && label.long) || state.data.timezone;
}

function timeRange(slot) {
  const tz = state.data.timezone;
  const from = timeIn(slot.start, tz);
  const to = timeIn(slot.end, tz);
  // "2:00 – 2:30 PM" when both ends share AM/PM.
  const [fromClock, fromHalf] = from.split(' ');
  return fromHalf && to.endsWith(fromHalf) ? `${fromClock} – ${to}` : `${from} – ${to}`;
}

function myTimeNote(slot) {
  if (!zonesDiffer(slot.start, state.data.timezone, state.myZone)) return '';
  const sameDay = dayIn(slot.start, state.myZone) === dayIn(slot.start, state.data.timezone);
  const when = timeIn(slot.start, state.myZone);
  const zone = zoneShort(slot.start, state.myZone);
  return sameDay ? `${when} ${zone} for you` : `${when} ${zone} for you, ${formatDay(dayIn(slot.start, state.myZone), 'medium')}`;
}

function say(message) {
  view.announce.textContent = '';
  requestAnimationFrame(() => {
    view.announce.textContent = message;
  });
}

// ---------- host ----------

function renderHost() {
  const { profile, meetingLengthMinutes } = state.data;
  const initial = (profile.name || '?').trim().charAt(0) || '?';

  clear(view.host).append(
    el(
      'div',
      { class: 'host__top' },
      el('div', { class: 'avatar', 'aria-hidden': 'true' }, initial),
      el('div', { class: 'host__who' }, el('p', { class: 'host__name' }, profile.name), el('p', { class: 'host__agency' }, profile.agency))
    ),
    el('p', { class: 'host__meeting' }, profile.meetingTitle),
    profile.description ? el('p', { class: 'host__desc' }, profile.description) : null,
    el(
      'ul',
      { class: 'host__meta' },
      el('li', null, icon('clock'), minutesLabel(meetingLengthMinutes)),
      el('li', null, icon('globe'), zoneName())
    )
  );
}

// ---------- calendar ----------

function buildCalendar() {
  const { today, lastDay } = state.data;
  state.calendar = createCalendar(view.cal, {
    month: monthKey(state.day),
    today,
    minMonth: monthKey(today),
    maxMonth: monthKey(lastDay),
    selected: state.day,
    status: dayStatus,
    openCount: (day) => slotsFor(day).length,
    onSelect: selectDay,
  });
}

function selectDay(day, { scroll = true } = {}) {
  const changed = day !== state.day;
  state.day = day;
  if (changed) setSlot(null);
  state.calendar.update({ selected: day, fresh: changed, month: monthKey(day) });
  renderSlots();
  const count = slotsFor(day).length;
  say(`${formatDay(day)}. ${count ? `${count} ${count === 1 ? 'time' : 'times'} open.` : 'Nothing open.'}`);
  // On a phone the times sit below the calendar: bring them into view.
  if (scroll && window.matchMedia('(max-width: 920px)').matches) {
    view.slots.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }
}

// ---------- slots ----------

function partOfDay(slot) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: state.data.timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(slot.start))
  );
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

function renderSlots({ quiet = false } = {}) {
  const day = state.day;
  const slots = slotsFor(day);
  const { d } = parseYmd(day);
  const head = el(
    'div',
    { class: 'slots__head' },
    el('h2', { class: 'slots__day', id: 'slots-title' }, formatDay(day, 'weekdayLong')),
    el('p', { class: 'slots__date' }, `${formatDay(day, 'monthLong')} ${d}`, slots.length ? ` · ${zoneName()}` : '')
  );

  if (!slots.length) {
    clear(view.slots).append(head, emptyState(day));
    return;
  }

  const groups = new Map();
  for (const slot of slots) {
    const key = partOfDay(slot);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(slot);
  }

  let index = 0;
  const selectedStart = state.slot && state.slot.start;
  const list = el('div', { class: `slots__scroll${quiet ? ' is-quiet' : ''}`, role: 'radiogroup', 'aria-labelledby': 'slots-title' });
  for (const [name, items] of groups) {
    list.append(
      el(
        'div',
        { class: 'slots__group' },
        el('p', { class: 'slots__label', 'aria-hidden': 'true' }, name),
        el(
          'div',
          { class: 'slots__list' },
          items.map((slot) => {
            const selected = slot.start === selectedStart;
            const button = el(
              'button',
              {
                class: `slot${selected ? ' is-selected' : ''}`,
                type: 'button',
                role: 'radio',
                'aria-checked': selected ? 'true' : 'false',
                'aria-label': `${slot.label}, ${name.toLowerCase()}`,
                tabindex: '-1',
                style: `--i:${index++}`,
                onclick: () => setSlot(slot),
              },
              el('span', { class: 'slot__time' }, slot.label),
              icon('check', 'icon slot__tick')
            );
            button.slotData = slot; // not .slot: that is a built-in DOM property
            return button;
          })
        )
      )
    );
  }
  list.addEventListener('keydown', onSlotKey);
  clear(view.slots).append(head, list);
  rove(list);
}

// One tab stop for the whole list; arrows move between times.
function rove(list, focusIt = false) {
  const buttons = [...list.querySelectorAll('.slot')];
  const current = buttons.find((b) => b.classList.contains('is-selected')) || buttons[0];
  for (const b of buttons) b.tabIndex = b === current ? 0 : -1;
  if (focusIt && current) current.focus();
}

function onSlotKey(event) {
  const buttons = [...event.currentTarget.querySelectorAll('.slot')];
  const at = buttons.indexOf(event.target.closest('.slot'));
  if (at < 0) return;
  const columns = getComputedStyle(buttons[0].parentElement).gridTemplateColumns.split(' ').length;
  const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
  let to = at;
  if (event.key in moves) to = at + moves[event.key];
  else if (event.key === 'Home') to = 0;
  else if (event.key === 'End') to = buttons.length - 1;
  else if (event.key === 'Enter' && buttons[at].classList.contains('is-selected')) {
    event.preventDefault();
    return goTo('details');
  } else return;
  event.preventDefault();
  to = Math.max(0, Math.min(buttons.length - 1, to));
  if (to === at) return;
  for (const b of buttons) b.tabIndex = -1;
  buttons[to].tabIndex = 0;
  buttons[to].focus();
}

function emptyState(day) {
  const next = firstOpenDay(day) || firstOpenDay();
  const none = !firstOpenDay();
  return el(
    'div',
    { class: 'empty' },
    el('div', { class: 'empty__icon' }, icon('moon')),
    el('p', { class: 'empty__title' }, none ? 'No times are open right now' : `Nothing open on ${formatDay(day, 'weekdayLong')}`),
    el('p', { class: 'empty__text' }, none ? 'Every slot in the booking window is taken. Check back soon.' : `The next opening is ${formatDay(next)}.`),
    none
      ? null
      : el('button', { class: 'btn btn--sm btn--quiet', type: 'button', onclick: () => selectDay(next, { scroll: false }) }, `Go to ${formatDay(next, 'medium')}`, icon('arrow-right'))
  );
}

function setSlot(slot) {
  state.slot = slot;
  view.booking.classList.toggle('has-slot', Boolean(slot));
  view.next.setAttribute('aria-disabled', slot ? 'false' : 'true');

  for (const button of view.slots.querySelectorAll('.slot')) {
    const on = Boolean(slot) && button.slotData.start === slot.start;
    button.classList.toggle('is-selected', on);
    button.setAttribute('aria-checked', on ? 'true' : 'false');
    button.tabIndex = on ? 0 : -1;
  }
  if (!slot) {
    const first = view.slots.querySelector('.slot');
    if (first) first.tabIndex = 0;
    clear(view.actionText).append(el('span', { class: 'actionbar__hint' }, 'Pick a time to continue'));
    return;
  }

  const note = myTimeNote(slot);
  clear(view.actionText).append(
    el('span', { class: 'actionbar__when' }, `${formatDay(state.day, 'medium')} at ${slot.label}`),
    el('span', { class: 'actionbar__sub' }, note || zoneName())
  );
  say(`${slot.label} selected. Press Continue.`);
}

// ---------- steps ----------

function goTo(step, { back = false } = {}) {
  if (step === 'details' && !state.slot) return;
  state.step = step;
  view.booking.dataset.step = step;
  for (const [name, node] of Object.entries(view.steps)) {
    node.hidden = name !== step;
    node.classList.toggle('is-back', back && name === step);
  }
  if (step === 'details') renderChosen();
  const heading = view.steps[step].querySelector('h1');
  if (step === 'pick') {
    const target = view.slots.querySelector('.slot.is-selected') || view.cal.querySelector('.cal__day[tabindex="0"]');
    if (target) target.focus({ preventScroll: true });
  } else if (heading) {
    heading.focus({ preventScroll: true });
  }
  if (step !== 'pick' || !back) window.scrollTo({ top: 0, behavior: 'auto' });
}

function renderChosen() {
  const note = myTimeNote(state.slot);
  clear(view.chosen).append(
    el('div', { class: 'chosen__icon' }, icon('calendar')),
    el(
      'div',
      null,
      el('p', { class: 'chosen__day' }, formatDay(state.day, 'full')),
      el('p', { class: 'chosen__time mono' }, `${timeRange(state.slot)} · ${zoneName()}`, note ? ` (${note})` : '')
    )
  );
}

// ---------- form ----------

const fields = {
  name: { input: $('#f-name'), error: $('#f-name-error'), check: (v) => (v.trim() ? '' : 'Enter your name so we know who is coming.') },
  email: {
    input: $('#f-email'),
    error: $('#f-email-error'),
    check: (v) => (!v.trim() ? 'Enter your email address.' : EMAIL.test(v.trim()) ? '' : 'That email does not look right. Check for a typo.'),
  },
};

function setFieldError(field, message) {
  field.input.setAttribute('aria-invalid', message ? 'true' : 'false');
  field.error.hidden = !message;
  clear(field.error);
  if (message) field.error.append(icon('alert'), message);
  return !message;
}

function validate(name) {
  const field = fields[name];
  return setFieldError(field, field.check(field.input.value));
}

function wire() {
  view.next.addEventListener('click', () => {
    if (state.slot) goTo('details');
  });
  view.back.addEventListener('click', () => goTo('pick', { back: true }));

  for (const [name, field] of Object.entries(fields)) {
    field.input.addEventListener('blur', () => {
      if (field.input.value) validate(name);
    });
    field.input.addEventListener('input', () => {
      if (field.input.getAttribute('aria-invalid') === 'true') validate(name);
    });
  }
  const note = $('#f-note');
  note.addEventListener('input', () => {
    view.noteCount.textContent = `${note.value.length} / 600`;
  });

  view.form.addEventListener('submit', onSubmit);
}

async function onSubmit(event) {
  event.preventDefault();
  if (view.submit.classList.contains('is-busy')) return;
  view.formError.hidden = true;

  const okName = validate('name');
  const okEmail = validate('email');
  if (!okName || !okEmail) {
    (okName ? fields.email : fields.name).input.focus();
    return;
  }

  const payload = {
    start: state.slot.start,
    name: fields.name.input.value.trim(),
    email: fields.email.input.value.trim(),
    note: $('#f-note').value.trim(),
  };
  const restore = busy(view.submit, 'Booking…');

  try {
    const { booking } = await api.book(payload);
    restore();
    state.guest = { name: booking.name, email: booking.email };
    showDone(booking, state.slot);
    refresh(); // the slot is gone now; keep the calendar honest for "Book another"
  } catch (err) {
    restore();
    if (err instanceof ApiError && err.code === 'slot_unavailable') return slotTaken(err.message);
    if (err instanceof ApiError && fields[err.field]) {
      setFieldError(fields[err.field], err.message);
      fields[err.field].input.focus();
      return;
    }
    clear(view.formError).append(icon('alert'), el('span', null, err.message));
    view.formError.hidden = false;
  }
}

// Someone else took the slot between loading the page and pressing confirm.
async function slotTaken(message) {
  const lost = state.slot;
  setSlot(null);
  goTo('pick', { back: true });
  showBanner(`${lost.label} was just taken. Here are the times still open.`, message);
  await refresh();
  view.slots.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
}

// Re-reads availability. Called after a booking, when a slot was taken, and on
// a timer so changes made in the dashboard show up here without a reload.
async function refresh() {
  let data;
  try {
    data = await api.availability();
  } catch {
    return; // keep showing what we have; the next action will surface the error
  }
  if (JSON.stringify(data) === JSON.stringify(state.data)) return;
  state.data = data;

  const { today, lastDay } = data;
  if (state.day < today || state.day > lastDay) state.day = firstOpenDay() || today;
  if (state.slot && !slotsFor(state.day).some((s) => s.start === state.slot.start)) setSlot(null);
  state.calendar.update({
    today,
    minMonth: monthKey(today),
    maxMonth: monthKey(lastDay),
    selected: state.day,
    month: state.calendar.month < monthKey(today) ? monthKey(today) : state.calendar.month > monthKey(lastDay) ? monthKey(lastDay) : state.calendar.month,
  });
  renderHost();
  document.title = `Book a ${data.profile.meetingTitle} with ${data.profile.name}`;
  if (state.step === 'pick') {
    const hadFocus = view.slots.contains(document.activeElement);
    renderSlots({ quiet: true });
    if (hadFocus) {
      const list = view.slots.querySelector('.slots__scroll');
      if (list) rove(list, true);
    }
  }
}

function watch() {
  const tick = () => {
    if (document.visibilityState === 'visible' && state.step === 'pick') refresh();
  };
  setInterval(tick, 4000);
  window.addEventListener('focus', tick);
  document.addEventListener('visibilitychange', tick);
}

function showBanner(text) {
  clear(view.banner).append(
    el(
      'div',
      { class: 'notice', role: 'alert' },
      icon('alert'),
      el('span', null, text),
      el('button', { class: 'btn btn--sm btn--quiet', type: 'button', 'aria-label': 'Dismiss message', onclick: () => (view.banner.hidden = true) }, 'OK')
    )
  );
  view.banner.hidden = false;
}

// ---------- confirmation ----------

function showDone(booking, slot) {
  const { profile } = state.data;
  const tz = state.data.timezone;
  const day = dayIn(booking.start, tz);
  const { d } = parseYmd(day);
  const shown = { start: booking.start, end: booking.end, label: slot.label };
  const note = myTimeNote(shown);

  const done = view.steps.done;
  done.className = 'step step--done done is-celebrating';
  clear(done).append(
    el('div', { class: 'tick', 'aria-hidden': 'true' }, icon('check')),
    el('h1', { class: 'done__title settle', id: 'done-title', tabindex: '-1', style: '--i:0' }, "You're booked."),
    el('p', { class: 'done__sub settle', style: '--i:1' }, `${profile.meetingTitle} with ${profile.name}.`),
    el(
      'div',
      { class: 'ticket settle', style: '--i:2' },
      el(
        'div',
        { class: 'ticket__date' },
        el('span', null, formatDay(day, 'weekdayShort')),
        el('span', { class: 'ticket__day' }, String(d).padStart(2, '0')),
        el('span', null, formatDay(day, 'monthShort'))
      ),
      el(
        'div',
        { class: 'ticket__info' },
        el('p', { class: 'ticket__time' }, timeRange(shown)),
        el('p', { class: 'ticket__line' }, zoneName(), note ? ` · ${note}` : ''),
        el('p', { class: 'ticket__line' }, 'Booked for ', el('strong', null, booking.name)),
        el('p', { class: 'ticket__line' }, booking.email)
      )
    ),
    el(
      'div',
      { class: 'done__actions settle', style: '--i:3' },
      el('a', { class: 'btn btn--lime', href: api.icsUrl(booking.id), download: 'booking.ics', id: 'add-to-calendar' }, icon('calendar-plus'), 'Add to calendar'),
      el('button', { class: 'btn btn--ghost', type: 'button', id: 'book-another', onclick: bookAnother }, 'Book another')
    ),
    el('p', { class: 'done__note settle', style: '--i:4' }, 'This page is your confirmation. Add it to your calendar so it does not slip.')
  );

  state.step = 'done';
  goTo('done');
  say(`You're booked. ${formatDay(day, 'full')}, ${timeRange(shown)}, ${zoneName()}.`);
}

async function bookAnother() {
  setSlot(null);
  $('#f-note').value = '';
  view.noteCount.textContent = '0 / 600';
  view.banner.hidden = true;
  await refresh();
  goTo('pick', { back: true });
  renderSlots();
}

// ---------- could not load at all ----------

function showFatal(err) {
  view.booking.removeAttribute('aria-busy');
  view.booking.dataset.step = 'error';
  clear(view.host).append(
    el('div', { class: 'host__top' }, el('div', { class: 'avatar', 'aria-hidden': 'true' }, '?'), el('div', { class: 'host__who' }, el('p', { class: 'host__name' }, 'Booking page')))
  );
  const pane = view.steps.pick.parentElement;
  for (const node of Object.values(view.steps)) node.hidden = true;
  pane.append(
    el(
      'div',
      { class: 'fatal', role: 'alert' },
      el('div', { class: 'empty__icon', style: 'background:var(--red-soft);color:var(--red)' }, icon('alert')),
      el('h1', { class: 'fatal__title' }, "The calendar didn't load"),
      el('p', { class: 'fatal__text' }, err.message),
      el('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Try again')
    )
  );
}
