// The dashboard: upcoming bookings, availability rules, profile.

import { api, ApiError } from './api.js';
import { applyBrand } from './brand.js';
import { $, $$, el, clear, icon, toast, busy, copyText } from './dom.js';
import { formatDay, parseYmd, timeIn, dayIn, minutesLabel } from './dates.js';

const DAYS = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
];
const VIEWS = ['bookings', 'availability', 'profile'];

const state = {
  config: null, // { profile, availability, passcodeEnabled }
  bookings: null, // { bookings, pastCount, sampleCount }
  known: null, // ids already shown, so new arrivals can be highlighted
  confirming: '', // booking id with the "are you sure" row open
  saveTimer: 0,
  saving: false,
  queued: false,
  pending: {}, // unsaved patch
  loaded: false,
};

const bookingLink = () => new URL('book', location.href).href;

applyBrand();
wireShell();
boot();

// ---------- start-up and the passcode gate ----------

async function boot() {
  try {
    const [config, bookings] = await Promise.all([api.config(), api.bookings()]);
    state.config = config;
    state.bookings = bookings;
  } catch (err) {
    if (needsPasscode(err)) return showGate();
    return showAppError(err.message, true);
  }
  $('#app').hidden = false;
  $('#app-error').hidden = true;
  $('#lock').hidden = !state.config.passcodeEnabled;
  renderBookings();
  renderAvailability();
  renderProfile();
  route();
  if (!state.loaded) {
    state.loaded = true;
    setInterval(pollBookings, 4000);
    window.addEventListener('focus', pollBookings);
  }
}

// 401: the session ended (or a passcode was just set). The server swaps the
// dashboard for its sign-in page, so reloading is all it takes.
const needsPasscode = (err) => err instanceof ApiError && err.status === 401;

function showGate() {
  location.reload();
}

function showAppError(message, withRetry) {
  $('#app').hidden = false;
  for (const name of VIEWS) $(`#view-${name}`).hidden = true;
  const box = $('#app-error');
  clear(box).append(icon('alert'), el('span', null, message), withRetry ? el('button', { class: 'btn btn--sm btn--quiet', type: 'button', onclick: boot }, 'Try again') : null);
  box.hidden = false;
}

function wireShell() {
  $('#share-url').textContent = bookingLink().replace(/^https?:\/\//, '');
  $('#copy-link').addEventListener('click', copyLink);
  window.addEventListener('hashchange', () => route(true));

  $('#lock').addEventListener('click', async () => {
    try {
      await api.logout();
    } finally {
      location.reload();
    }
  });
}

async function copyLink() {
  const ok = await copyText(bookingLink());
  const label = $('#copy-link-label');
  if (!ok) return toast('Could not copy. Select the link and copy it by hand.', { bad: true });
  const button = $('#copy-link');
  label.textContent = 'Copied';
  button.classList.add('is-done');
  toast('Booking link copied');
  setTimeout(() => {
    label.textContent = 'Copy booking link';
    button.classList.remove('is-done');
  }, 1800);
}

function route(moveFocus = false) {
  const wanted = location.hash.replace('#', '');
  const current = VIEWS.includes(wanted) ? wanted : 'bookings';
  for (const name of VIEWS) $(`#view-${name}`).hidden = name !== current;
  for (const link of $$('.nav__item')) {
    if (link.dataset.view === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `${current.charAt(0).toUpperCase()}${current.slice(1)} · Dashboard`;
  if (moveFocus) {
    $(`#${current}-title`).focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }
}

// ---------- bookings ----------

const tz = () => state.config.availability.timezone;

function timeRange(booking) {
  const from = timeIn(booking.start, tz());
  const to = timeIn(booking.end, tz());
  const [clock, half] = from.split(' ');
  return half && to.endsWith(half) ? `${clock} – ${to}` : `${from} – ${to}`;
}

function relativeDay(day) {
  const today = dayIn(new Date().toISOString(), tz());
  if (day === today) return 'Today';
  const tomorrow = dayIn(new Date(Date.now() + 86400000).toISOString(), tz());
  if (day === tomorrow) return 'Tomorrow';
  return '';
}

async function pollBookings() {
  if (document.visibilityState !== 'visible' || $('#app').hidden || state.confirming) return;
  try {
    const next = await api.bookings();
    if (JSON.stringify(next) === JSON.stringify(state.bookings)) return;
    state.bookings = next;
    renderBookings();
  } catch (err) {
    if (needsPasscode(err)) showGate();
  }
}

function renderBookings() {
  const { bookings, pastCount, sampleCount } = state.bookings;
  const body = $('#bookings-body');
  const count = bookings.length;

  // Anything that was not here on the last draw gets a highlight as it arrives.
  const arrived = new Set(state.known ? bookings.filter((b) => !state.known.has(b.id)).map((b) => b.id) : []);
  state.known = new Set(bookings.map((b) => b.id));

  $('#bookings-sub').textContent = count ? `${count} upcoming${pastCount ? ` · ${pastCount} past` : ''}` : pastCount ? `Nothing upcoming · ${pastCount} past` : 'Nothing upcoming yet';
  const navCount = $('#nav-count');
  navCount.textContent = String(count);
  navCount.hidden = !count;

  renderSampleBanner(sampleCount);

  if (!count) {
    clear(body).append(
      el(
        'div',
        { class: 'blank' },
        el('div', { class: 'blank__icon' }, icon('inbox')),
        el('h2', { class: 'blank__title' }, 'No bookings yet'),
        el('p', { class: 'blank__text' }, 'Send someone your booking link. When they pick a time it shows up here on its own.'),
        el(
          'div',
          { class: 'blank__actions' },
          el('button', { class: 'btn', type: 'button', onclick: copyLink }, icon('copy'), 'Copy booking link'),
          el('button', { class: 'btn btn--quiet', type: 'button', onclick: seedSamples }, 'Add sample bookings')
        )
      )
    );
    return;
  }

  const [next, ...rest] = bookings;
  const nodes = [nextUp(next, arrived.has(next.id))];

  const groups = new Map();
  for (const booking of rest) {
    const day = dayIn(booking.start, tz());
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(booking);
  }
  if (groups.size) nodes.push(el('h2', { class: 'list-title' }, 'After that'));
  for (const [day, items] of groups) {
    const rel = relativeDay(day);
    nodes.push(
      el(
        'section',
        { class: 'day' },
        el('h3', { class: 'day__head' }, rel ? el('span', { class: 'day__rel' }, rel) : null, formatDay(day, 'long')),
        el('ul', { class: 'rows' }, items.map((b) => row(b, arrived.has(b.id))))
      )
    );
  }
  clear(body).append(...nodes);
}

async function seedSamples(event) {
  const restore = busy(event.currentTarget, 'Adding…');
  try {
    const result = await api.seedSamples();
    state.bookings = { bookings: result.bookings, pastCount: result.pastCount, sampleCount: result.sampleCount };
    state.known = new Set(); // let them all animate in
    renderBookings();
  } catch (err) {
    restore();
    if (needsPasscode(err)) return showGate();
    toast(err.message, { bad: true });
  }
}

function renderSampleBanner(sampleCount) {
  const banner = $('#sample-banner');
  banner.hidden = !sampleCount;
  if (!sampleCount) return clear(banner);
  const button = el('button', { class: 'btn btn--sm btn--quiet', type: 'button', id: 'clear-samples' }, 'Clear sample data');
  button.addEventListener('click', async () => {
    const restore = busy(button, 'Clearing…');
    try {
      const result = await api.clearSamples();
      state.bookings = { bookings: result.bookings, pastCount: result.pastCount, sampleCount: result.sampleCount };
      renderBookings();
      toast(`Removed ${result.removed} sample ${result.removed === 1 ? 'booking' : 'bookings'}`);
    } catch (err) {
      restore();
      if (needsPasscode(err)) return showGate();
      toast(err.message, { bad: true });
    }
  });
  clear(banner).append(
    el(
      'div',
      { class: 'notice notice--calm sample' },
      icon('alert'),
      el('span', null, el('strong', null, `${sampleCount} sample ${sampleCount === 1 ? 'booking' : 'bookings'}. `), 'Made-up people so the dashboard is not empty. Real bookings are never touched.'),
      button
    )
  );
}

function sampleTag(booking) {
  return booking.sample ? el('span', { class: 'tag' }, 'Sample') : null;
}

function person(booking) {
  return [
    el('p', { class: 'who__name' }, booking.name, sampleTag(booking)),
    el('a', { class: 'who__email', href: `mailto:${booking.email}` }, booking.email),
  ];
}

// The very next booking gets the ticket treatment.
function nextUp(booking, isNew) {
  const day = dayIn(booking.start, tz());
  const { d } = parseYmd(day);
  const rel = relativeDay(day);
  return el(
    'section',
    { class: `next${isNew ? ' is-new' : ''}`, 'aria-label': 'Next booking', dataset: { id: booking.id } },
    el(
      'div',
      { class: 'ticket' },
      el(
        'div',
        { class: 'ticket__date' },
        el('span', null, formatDay(day, 'weekdayShort')),
        el('span', { class: 'ticket__day' }, String(d).padStart(2, '0')),
        el('span', null, formatDay(day, 'monthShort'))
      ),
      el(
        'div',
        { class: 'ticket__info next__info' },
        el('p', { class: 'next__eyebrow mono' }, rel ? `Next up · ${rel}` : 'Next up'),
        el('p', { class: 'ticket__time' }, timeRange(booking)),
        el('div', { class: 'who who--dark' }, person(booking)),
        booking.note ? el('p', { class: 'next__note' }, booking.note) : null,
        actions(booking, true)
      )
    )
  );
}

function row(booking, isNew) {
  return el(
    'li',
    { class: `row${isNew ? ' is-new' : ''}`, dataset: { id: booking.id } },
    el('p', { class: 'row__time mono' }, timeRange(booking)),
    el('div', { class: 'who' }, person(booking), booking.note ? el('p', { class: 'row__note' }, booking.note) : null),
    actions(booking, false)
  );
}

// Cancel is two presses: the first swaps the button for a confirm pair.
function actions(booking, dark) {
  const wrap = el('div', { class: 'acts' });
  const draw = () => {
    clear(wrap);
    if (state.confirming !== booking.id) {
      wrap.append(
        el(
          'button',
          {
            class: `btn btn--sm ${dark ? 'btn--ghost' : 'btn--quiet'}`,
            type: 'button',
            'aria-label': `Cancel booking with ${booking.name}`,
            onclick: () => {
              state.confirming = booking.id;
              draw();
              wrap.querySelector('[data-keep]').focus();
            },
          },
          'Cancel'
        )
      );
      return;
    }
    const yes = el('button', { class: 'btn btn--sm btn--danger', type: 'button', 'data-yes': true }, 'Yes, cancel it');
    const keep = el('button', { class: `btn btn--sm ${dark ? 'btn--ghost' : 'btn--quiet'}`, type: 'button', 'data-keep': true }, 'Keep');
    keep.addEventListener('click', () => {
      state.confirming = '';
      draw();
      wrap.querySelector('button').focus();
    });
    yes.addEventListener('click', async () => {
      const restore = busy(yes, 'Cancelling…');
      try {
        const next = await api.cancel(booking.id);
        state.confirming = '';
        state.bookings = next;
        renderBookings();
        toast('Cancelled. That time is open again.');
        $('#bookings-title').focus({ preventScroll: true });
      } catch (err) {
        restore();
        state.confirming = '';
        if (needsPasscode(err)) return showGate();
        toast(err.status === 404 ? 'That booking was already cancelled.' : err.message, { bad: true });
        pollBookings();
      }
    });
    wrap.append(el('span', { class: 'acts__ask', role: 'alert' }, 'Cancel this booking?'), keep, yes);
  };
  draw();
  return wrap;
}

// ---------- saving (availability and profile share one queue) ----------

function setSaveState(kind, text) {
  for (const node of $$('[data-save-state]')) {
    node.dataset.kind = kind;
    clear(node);
    if (kind === 'saving') node.append(el('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
    else if (kind === 'saved') node.append(icon('check'), text);
    else if (kind === 'error') node.append(icon('alert'), text);
  }
}

// Merge a change into the pending patch and save shortly after the last edit.
function queueSave(patch, delay = 350) {
  const p = state.pending;
  if (patch.profile) p.profile = { ...(p.profile || {}), ...patch.profile };
  if (patch.availability) {
    const days = { ...((p.availability || {}).days || {}), ...(patch.availability.days || {}) };
    p.availability = { ...(p.availability || {}), ...patch.availability };
    if (Object.keys(days).length) p.availability.days = days;
  }
  setSaveState('saving', 'Saving…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, delay);
}

async function flushSave() {
  if (state.saving) {
    state.queued = true;
    return;
  }
  const patch = state.pending;
  state.pending = {};
  state.saving = true;
  try {
    const saved = await api.saveConfig(patch);
    state.config = saved;
    setSaveState('saved', 'Saved');
    if (state.bookings) renderBookings(); // times follow the timezone
  } catch (err) {
    if (needsPasscode(err)) {
      state.saving = false;
      return showGate();
    }
    setSaveState('error', 'Not saved');
    toast(err.message, { bad: true, ms: 5000 });
  }
  state.saving = false;
  if (state.queued || Object.keys(state.pending).length) {
    state.queued = false;
    flushSave();
  }
}

window.addEventListener('beforeunload', (event) => {
  if (Object.keys(state.pending).length || state.saving) event.preventDefault();
});

// ---------- availability ----------

function timezones() {
  let list = [];
  try {
    list = Intl.supportedValuesOf('timeZone');
  } catch {
    list = [];
  }
  const current = state.config.availability.timezone;
  if (!list.includes(current)) list = [current, ...list];
  return list;
}

function renderAvailability() {
  const a = state.config.availability;
  const body = $('#availability-body');

  // Weekly hours
  const week = el('div', { class: 'week', role: 'group', 'aria-labelledby': 'week-title' });
  for (const [key, name] of DAYS) week.append(dayRow(key, name, a.days[key]));

  // Meeting length and buffer
  const length = choice({
    legend: 'Meeting length',
    name: 'length',
    options: [15, 30, 45, 60],
    value: a.meetingLengthMinutes,
    label: (n) => `${n} min`,
    min: 5,
    max: 240,
    onChange: (n) => queueSave({ availability: { meetingLengthMinutes: n } }),
  });
  const buffer = choice({
    legend: 'Buffer between meetings',
    name: 'buffer',
    options: [0, 5, 10, 15, 30],
    value: a.bufferMinutes,
    label: (n) => (n ? `${n} min` : 'None'),
    min: 0,
    max: 120,
    onChange: (n) => queueSave({ availability: { bufferMinutes: n } }),
  });

  // Booking window
  const ahead = el('input', {
    class: 'field__input field__input--num mono',
    id: 'days-ahead',
    type: 'number',
    inputmode: 'numeric',
    min: '1',
    max: '365',
    step: '1',
    value: a.daysAhead,
    'aria-describedby': 'days-ahead-hint days-ahead-error',
  });
  const aheadError = el('p', { class: 'field__error', id: 'days-ahead-error', hidden: true });
  ahead.addEventListener('input', () => {
    const n = Number(ahead.value);
    const ok = Number.isInteger(n) && n >= 1 && n <= 365;
    ahead.setAttribute('aria-invalid', ok ? 'false' : 'true');
    aheadError.hidden = ok;
    clear(aheadError);
    if (!ok) return aheadError.append(icon('alert'), 'Use a whole number from 1 to 365.');
    queueSave({ availability: { daysAhead: n } }, 500);
  });

  const zone = el('select', { class: 'field__input', id: 'timezone' }, timezones().map((name) => el('option', { value: name }, name.replaceAll('_', ' '))));
  zone.value = a.timezone;
  zone.addEventListener('change', () => queueSave({ availability: { timezone: zone.value } }));

  clear(body).append(
    el('section', { class: 'block' }, el('h2', { class: 'block__title', id: 'week-title' }, 'Weekly hours'), week),
    el('section', { class: 'block' }, el('h2', { class: 'block__title' }, 'Meetings'), el('div', { class: 'block__grid' }, length, buffer)),
    el(
      'section',
      { class: 'block' },
      el('h2', { class: 'block__title' }, 'Booking window'),
      el(
        'div',
        { class: 'block__grid' },
        el(
          'div',
          { class: 'field' },
          el('label', { class: 'field__label', for: 'days-ahead' }, 'How far ahead people can book'),
          el('div', { class: 'with-unit' }, ahead, el('span', { class: 'with-unit__unit' }, 'days')),
          el('p', { class: 'field__hint', id: 'days-ahead-hint' }, 'Days after that stay greyed out on your calendar.'),
          aheadError
        ),
        el('div', { class: 'field' }, el('label', { class: 'field__label', for: 'timezone' }, 'Your timezone'), zone, el('p', { class: 'field__hint' }, 'Your hours above are in this timezone.'))
      )
    )
  );
}

function dayRow(key, name, rule) {
  const current = { ...rule };
  const id = `day-${key}`;
  const toggle = el('input', { class: 'switch__input', type: 'checkbox', role: 'switch', id, checked: current.enabled });
  const start = el('input', { class: 'field__input field__input--time mono', type: 'time', step: '300', value: current.start, 'aria-label': `${name} start time`, required: true });
  const end = el('input', { class: 'field__input field__input--time mono', type: 'time', step: '300', value: current.end, 'aria-label': `${name} end time`, required: true });
  const closed = el('p', { class: 'week__closed' }, 'Closed');
  const error = el('p', { class: 'field__error week__error', hidden: true, role: 'alert' });
  const hours = el('div', { class: 'week__hours' }, start, el('span', { class: 'week__to', 'aria-hidden': 'true' }, 'to'), end);
  const node = el(
    'div',
    { class: 'week__row' },
    el('label', { class: 'switch', for: id }, toggle, el('span', { class: 'switch__track', 'aria-hidden': 'true' }, el('span', { class: 'switch__thumb' })), el('span', { class: 'week__name' }, name)),
    hours,
    closed,
    error
  );

  const paint = () => {
    node.classList.toggle('is-off', !current.enabled);
    start.disabled = end.disabled = !current.enabled;
    hours.hidden = !current.enabled;
    closed.hidden = current.enabled;
  };
  const check = () => {
    const ok = Boolean(current.start) && Boolean(current.end) && current.end > current.start;
    const show = current.enabled && !ok;
    error.hidden = !show;
    clear(error);
    if (show) error.append(icon('alert'), 'End time must be after the start time.');
    end.setAttribute('aria-invalid', show ? 'true' : 'false');
    return ok;
  };
  const save = () => {
    paint();
    // A day with broken hours is not sent; the server would reject the whole save.
    if (!check()) {
      if (!current.enabled) queueSave({ availability: { days: { [key]: { ...rule, enabled: false } } } });
      return;
    }
    queueSave({ availability: { days: { [key]: { ...current } } } });
  };

  toggle.addEventListener('change', () => {
    current.enabled = toggle.checked;
    save();
  });
  start.addEventListener('change', () => {
    current.start = start.value;
    save();
  });
  end.addEventListener('change', () => {
    current.end = end.value;
    save();
  });

  paint();
  return node;
}

// A row of radio chips plus "Other" for a custom number.
function choice({ legend, name, options, value, label, min, max, onChange }) {
  const isCustom = !options.includes(value);
  const custom = el('input', {
    class: 'field__input field__input--num mono',
    type: 'number',
    inputmode: 'numeric',
    min,
    max,
    step: '1',
    value: isCustom ? value : '',
    'aria-label': `${legend} in minutes`,
  });
  const customWrap = el('div', { class: 'with-unit choice__custom', hidden: !isCustom }, custom, el('span', { class: 'with-unit__unit' }, 'min'));
  const error = el('p', { class: 'field__error', hidden: true });

  const chip = (val, text) => {
    const id = `${name}-${val}`;
    const input = el('input', { class: 'chip__input', type: 'radio', name, id, value: val, checked: val === 'other' ? isCustom : val === value });
    input.addEventListener('change', () => {
      const other = val === 'other';
      customWrap.hidden = !other;
      error.hidden = true;
      if (other) {
        custom.focus();
        if (custom.value) custom.dispatchEvent(new Event('input'));
      } else {
        onChange(val);
      }
    });
    return el('label', { class: 'chip', for: id }, input, el('span', { class: 'chip__face' }, text));
  };

  custom.addEventListener('input', () => {
    const n = Number(custom.value);
    const ok = custom.value !== '' && Number.isInteger(n) && n >= min && n <= max;
    custom.setAttribute('aria-invalid', ok ? 'false' : 'true');
    error.hidden = ok;
    clear(error);
    if (!ok) return error.append(icon('alert'), `Use a whole number from ${min} to ${max}.`);
    onChange(n);
  });

  return el(
    'fieldset',
    { class: 'choice' },
    el('legend', { class: 'field__label' }, legend),
    el('div', { class: 'choice__chips' }, options.map((n) => chip(n, label(n))), chip('other', 'Other')),
    customWrap,
    error
  );
}

// ---------- profile ----------

function renderProfile() {
  const p = { ...state.config.profile };
  const body = $('#profile-body');

  const preview = {
    avatar: el('div', { class: 'avatar', 'aria-hidden': 'true' }),
    name: el('p', { class: 'pv__name' }),
    agency: el('p', { class: 'pv__agency' }),
    meeting: el('p', { class: 'pv__meeting' }),
    desc: el('p', { class: 'pv__desc' }),
  };
  const paint = () => {
    const name = p.name.trim() || 'Your Name';
    preview.avatar.textContent = name.charAt(0);
    preview.name.textContent = name;
    preview.agency.textContent = p.agency.trim() || 'Your Agency';
    preview.meeting.textContent = `${minutesLabel(state.config.availability.meetingLengthMinutes)} ${p.meetingName.trim() || 'intro call'}`;
    preview.desc.textContent = p.description.trim();
    preview.desc.hidden = !p.description.trim();
  };

  const text = (key, labelText, { max, hint, area = false, autocomplete } = {}) => {
    const id = `p-${key}`;
    const input = el(area ? 'textarea' : 'input', {
      class: 'field__input',
      id,
      maxlength: max,
      rows: area ? 3 : undefined,
      type: area ? undefined : 'text',
      autocomplete: autocomplete || 'off',
      'aria-describedby': `${id}-hint`,
    });
    input.value = p[key];
    const counter = el('span', { class: 'mono' }, `${p[key].length} / ${max}`);
    input.addEventListener('input', () => {
      p[key] = input.value;
      counter.textContent = `${input.value.length} / ${max}`;
      paint();
      queueSave({ profile: { [key]: input.value } }, 600);
    });
    return el('div', { class: 'field' }, el('label', { class: 'field__label', for: id }, labelText), input, el('p', { class: 'field__hint field__hint--split', id: `${id}-hint` }, el('span', null, hint || ''), counter));
  };

  paint();
  clear(body).append(
    el(
      'div',
      { class: 'profile' },
      el(
        'div',
        { class: 'profile__form' },
        text('name', 'Your name', { max: 60, hint: 'The first letter becomes your avatar.', autocomplete: 'name' }),
        text('agency', 'Agency or business', { max: 60, hint: 'Shown under your name.', autocomplete: 'organization' }),
        text('meetingName', 'What the meeting is called', { max: 40, hint: 'For example: intro call, strategy call, coffee chat.' }),
        text('description', 'Description', { max: 280, hint: 'One or two lines on what the call is for.', area: true })
      ),
      el(
        'aside',
        { class: 'pv', 'aria-label': 'Preview of your booking page header' },
        el('p', { class: 'pv__label mono' }, 'Preview'),
        el('div', { class: 'pv__card' }, el('div', { class: 'pv__top' }, preview.avatar, el('div', null, preview.name, preview.agency)), preview.meeting, preview.desc),
        el('a', { class: 'link pv__link', href: 'book', target: '_blank', rel: 'noopener' }, 'Open your booking page')
      )
    )
  );
}
