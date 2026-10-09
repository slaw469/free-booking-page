// Public booking page: pick a day, pick a time, leave your details.
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const card = $('#card');
  const calGrid = $('#calGrid');
  const slotGrid = $('#slotGrid');
  const form = $('#bookForm');

  const state = {
    data: null, // last /api/availability response
    raw: '', // its JSON text, to skip re-rendering when nothing changed
    month: null, // "YYYY-MM" on screen
    date: null, // "YYYY-MM-DD" picked
    slot: null, // slot object picked
    step: 'pick',
    booking: null,
    notice: '', // one-off message above the times, e.g. "that time was just taken"
  };

  // ---------- dates (plain "YYYY-MM-DD" strings in the host's timezone) ----------

  const pad = (n) => String(n).padStart(2, '0');
  const utcDate = (ymd) => new Date(`${ymd}T12:00:00Z`);
  const fmtDay = (ymd, opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(utcDate(ymd));
  const longDay = (ymd) => fmtDay(ymd, { weekday: 'long', month: 'long', day: 'numeric' });
  const shortDay = (ymd) => fmtDay(ymd, { weekday: 'short', month: 'short', day: 'numeric' });

  function fmtTime(iso, timeZone) {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));
  }

  function timeRange(slot) {
    const tz = state.data.timezone;
    return `${fmtTime(slot.start, tz)} – ${fmtTime(slot.end, tz)}`;
  }

  // Shown only when the visitor is in a different timezone from the host.
  function localTimeNote(slot) {
    const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!mine || fmtTime(slot.start, mine) === fmtTime(slot.start, state.data.timezone)) return '';
    return `${fmtTime(slot.start, mine)} your time`;
  }

  // ---------- rendering ----------

  function setText(selector, text) {
    document.querySelectorAll(selector).forEach((el) => (el.textContent = text));
  }

  function renderProfile() {
    const { profile, meetingLengthMinutes, timezoneLabel } = state.data;
    setText('[data-name]', profile.name);
    setText('[data-agency]', profile.agency);
    setText('[data-description]', profile.description);
    setText('[data-meeting]', profile.meetingTitle);
    setText('[data-initial]', (profile.name.trim()[0] || '?').toUpperCase());
    setText('[data-first-name]', profile.name === 'Your Name' ? 'them' : profile.name.trim().split(/\s+/)[0] || 'them');
    setText('[data-length]', `${meetingLengthMinutes} min`);
    setText('[data-timezone]', `${timezoneLabel.long} (${timezoneLabel.short})`);
    document.title = `Book a ${profile.meetingTitle} with ${profile.name}`;
  }

  function renderCalendar() {
    const { days, today, lastDay } = state.data;
    const [year, month] = state.month.split('-').map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    $('#calTitle').textContent = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(first);
    $('#prevMonth').disabled = state.month <= today.slice(0, 7);
    $('#nextMonth').disabled = state.month >= lastDay.slice(0, 7);

    const cells = [];
    for (let i = 0; i < first.getUTCDay(); i++) cells.push('<span class="day-blank"></span>');
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = `${year}-${pad(month)}-${pad(d)}`;
      const open = Boolean(days[ymd]);
      const classes = ['day'];
      if (open) classes.push('is-open');
      if (ymd === today) classes.push('is-today');
      if (ymd === state.date) classes.push('is-selected');
      const label = `${longDay(ymd)}${open ? `, ${days[ymd].length} times open` : ', unavailable'}`;
      cells.push(
        `<button type="button" class="${classes.join(' ')}" data-date="${ymd}" aria-label="${label}"` +
          `${open ? '' : ' disabled'}${ymd === state.date ? ' aria-pressed="true"' : ''}>${d}</button>`
      );
    }
    calGrid.innerHTML = cells.join('');
  }

  function renderSlots() {
    const slots = state.date ? state.data.days[state.date] || [] : [];
    $('#slotsTitle').textContent = state.date ? shortDay(state.date) : 'Pick a day';
    $('#slotsHint').textContent = state.notice || 'Open days are highlighted. Choose one to see the times.';
    $('#slotsHint').hidden = Boolean(state.date) && !state.notice;
    slotGrid.innerHTML = slots
      .map(
        (slot, i) =>
          `<button type="button" class="slot${state.slot && state.slot.start === slot.start ? ' is-selected' : ''}"` +
          ` style="--i:${i}" data-start="${slot.start}">${slot.label}</button>`
      )
      .join('');
    renderContinue();
  }

  function renderContinue() {
    const btn = $('#continueBtn');
    btn.hidden = !state.slot;
    if (state.slot) btn.textContent = `Continue with ${state.slot.label}`;
  }

  function renderChosen() {
    const show = state.step !== 'pick' && state.slot;
    $('#chosen').hidden = !show;
    if (!show) return;
    const note = localTimeNote(state.slot);
    $('#chosenDate').textContent = longDay(state.date);
    $('#chosenTime').textContent = timeRange(state.slot) + (note ? ` (${note})` : '');
  }

  function setStep(step) {
    state.step = step;
    card.dataset.step = step;
    document.querySelectorAll('[data-panel]').forEach((panel) => (panel.hidden = panel.dataset.panel !== step));
    renderChosen();
    if (step === 'form') $('#fName').focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 860px)').matches && step !== 'pick') card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- data ----------

  async function refresh() {
    let res;
    try {
      res = await fetch('/api/availability', { cache: 'no-store' });
    } catch {
      return; // server briefly unreachable: keep what is on screen
    }
    if (!res.ok) return;
    const raw = await res.text();
    if (raw === state.raw) return;
    state.raw = raw;
    state.data = JSON.parse(raw);
    const { days, today, lastDay } = state.data;

    if (!state.month) state.month = (Object.keys(days)[0] || today).slice(0, 7);
    if (state.month < today.slice(0, 7)) state.month = today.slice(0, 7);
    if (state.month > lastDay.slice(0, 7)) state.month = lastDay.slice(0, 7);

    // Keep the visitor's selection only if it is still open.
    if (state.step !== 'done') {
      const stillOpen = state.slot && (days[state.date] || []).some((s) => s.start === state.slot.start);
      if (state.slot && !stillOpen) {
        state.slot = null;
        state.notice = 'Sorry, that time was just taken. Please pick another.';
        if (state.step === 'form') setStep('pick');
      }
      if (state.date && !days[state.date]) state.date = null;
    }

    renderProfile();
    renderCalendar();
    renderSlots();
    renderChosen();
  }

  // ---------- events ----------

  function shiftMonth(delta) {
    const [y, m] = state.month.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1 + delta, 1));
    state.month = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`;
    renderCalendar();
  }
  $('#prevMonth').addEventListener('click', () => shiftMonth(-1));
  $('#nextMonth').addEventListener('click', () => shiftMonth(1));

  calGrid.addEventListener('click', (event) => {
    const btn = event.target.closest('.day:not(:disabled)');
    if (!btn || btn.dataset.date === state.date) return;
    state.date = btn.dataset.date;
    state.slot = null;
    state.notice = '';
    renderCalendar();
    renderSlots();
    if (window.matchMedia('(max-width: 860px)').matches) $('#slots').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  slotGrid.addEventListener('click', (event) => {
    const btn = event.target.closest('.slot');
    if (!btn) return;
    state.slot = state.data.days[state.date].find((s) => s.start === btn.dataset.start) || null;
    slotGrid.querySelectorAll('.slot').forEach((el) => el.classList.toggle('is-selected', el === btn));
    if (state.notice) {
      state.notice = '';
      $('#slotsHint').hidden = true;
    }
    renderContinue();
  });

  $('#continueBtn').addEventListener('click', () => state.slot && setStep('form'));
  $('#backBtn').addEventListener('click', () => setStep('pick'));
  $('#changeTime').addEventListener('click', () => setStep('pick'));

  function showFieldError(field, message) {
    document.querySelectorAll('.field').forEach((el) => el.classList.remove('has-error'));
    document.querySelectorAll('[data-error]').forEach((el) => (el.textContent = ''));
    const target = field && document.querySelector(`[data-error="${field}"]`);
    if (target) {
      target.textContent = message;
      target.closest('.field').classList.add('has-error');
      target.closest('.field').querySelector('input').focus();
    }
    const alert = $('#formAlert');
    alert.hidden = Boolean(target) || !message;
    alert.textContent = target ? '' : message || '';
  }

  // A field's error goes away as soon as the visitor starts fixing it.
  form.addEventListener('input', (event) => {
    const field = event.target.closest('.field');
    if (!field || !field.classList.contains('has-error')) return;
    field.classList.remove('has-error');
    field.querySelector('.field-error').textContent = '';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#fName').value.trim();
    const email = $('#fEmail').value.trim();
    if (!name) return showFieldError('name', 'Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showFieldError('email', 'Please enter a valid email address.');
    showFieldError(null, '');

    const btn = $('#confirmBtn');
    btn.disabled = true;
    btn.textContent = 'Booking…';
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: state.slot.start, name, email, note: $('#fNote').value }),
      });
      const body = await res.json();
      if (res.status === 201) {
        state.booking = body.booking;
        renderDone();
        setStep('done');
        refresh();
      } else if (res.status === 409) {
        await refresh(); // drops the selection, returns to the calendar and says why
        if (state.step === 'form') {
          state.slot = null;
          state.notice = 'Sorry, that time is no longer available. Please pick another.';
          renderSlots();
          setStep('pick');
        }
      } else {
        showFieldError(body.error.field, body.error.message);
      }
    } catch {
      showFieldError(null, 'Could not reach the server. Check your connection and try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirm booking';
    }
  });

  function renderDone() {
    const { profile } = state.data;
    const note = localTimeNote(state.slot);
    $('#doneSub').textContent = `${state.booking.name.split(/\s+/)[0]}, your ${profile.meetingTitle} with ${profile.name} is confirmed.`;
    $('#doneDate').textContent = longDay(state.date);
    $('#doneTime').innerHTML = '';
    $('#doneTime').append(timeRange(state.slot));
    const small = document.createElement('small');
    small.textContent = state.data.timezoneLabel.long + (note ? ` · ${note}` : '');
    $('#doneTime').append(small);
    $('#doneWith').textContent = `${profile.name}, ${profile.agency}`;
    $('#icsLink').href = `/api/bookings/${state.booking.id}/ics`;
  }

  $('#bookAnother').addEventListener('click', () => {
    state.slot = null;
    state.booking = null;
    state.date = null;
    state.notice = '';
    form.reset();
    renderCalendar();
    renderSlots();
    setStep('pick');
  });

  // Stay current when the host changes their hours or someone else books.
  setInterval(() => document.visibilityState === 'visible' && refresh(), 4000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
  window.addEventListener('focus', refresh);

  refresh();
})();
