// Landing page: the self-playing demo in the hero, scroll reveals, copy button.
// The demo uses the same calendar component and styles as the real booking
// page, with made-up availability so the page works without the server.

import { applyBrand } from './brand.js';
import { $, $$, el, clear, icon, copyText, reducedMotion } from './dom.js';
import { createCalendar } from './calendar.js';
import { ymd, parseYmd, addDays, addMonths, daysInMonth, weekday, monthKey, formatDay } from './dates.js';

applyBrand();
reveals();
copyButtons();
demo($('#demo'));

// ---------- scroll reveals ----------

function reveals() {
  const nodes = $$('[data-reveal]');
  if (!('IntersectionObserver' in window) || reducedMotion()) return;
  document.documentElement.classList.add('js-reveal');
  const seen = new IntersectionObserver(
    (entries) => {
      let order = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.style.setProperty('--d', order++);
        entry.target.classList.add('is-in');
        seen.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
  );
  for (const node of nodes) seen.observe(node);
}

function copyButtons() {
  for (const button of $$('[data-copy]')) {
    const label = button.querySelector('span');
    button.addEventListener('click', async () => {
      const ok = await copyText(button.dataset.copy);
      label.textContent = ok ? 'Copied' : 'Press Ctrl+C';
      button.classList.toggle('is-done', ok);
      setTimeout(() => {
        label.textContent = 'Copy';
        button.classList.remove('is-done');
      }, 1600);
    });
  }
}

// ---------- the demo ----------

function demo(mount) {
  if (!mount) return;

  // Made-up availability: weekdays for the next few weeks.
  const now = new Date();
  const today = ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const lastDay = addDays(today, 35);
  const TIMES = ['9:30 AM', '11:00 AM', '1:30 PM', '2:00 PM', '3:30 PM', '4:00 PM'];
  const timesFor = (day) => {
    const dow = weekday(day);
    if (day <= today || day > lastDay || dow === 0 || dow === 6) return [];
    const { d } = parseYmd(day);
    return TIMES.filter((_, i) => (d + i) % 5 !== 0).slice(0, 5); // each day loses a slot or two
  };
  const status = (day) => (day < today || day > lastDay ? 'off' : timesFor(day).length ? 'open' : 'none');

  // Show whichever month has more open days left, so the demo never looks empty.
  let month = monthKey(today);
  const [y, m] = month.split('-').map(Number);
  let openLeft = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) if (timesFor(ymd(y, m, d)).length) openLeft++;
  if (openLeft < 6) month = addMonths(month, 1);

  const openDays = [];
  {
    const [yy, mm] = month.split('-').map(Number);
    for (let d = 1; d <= daysInMonth(yy, mm); d++) if (timesFor(ymd(yy, mm, d)).length) openDays.push(ymd(yy, mm, d));
  }

  const s = { day: openDays[1] || openDays[0], time: '', screen: 'pick' };
  let auto = !reducedMotion();
  let runId = 0;
  let calendar = null;
  let visible = true;

  const screen = el('div', { class: 'demo__screen' });
  clear(mount).append(
    el(
      'div',
      { class: 'demo__host' },
      el('div', { class: 'demo__avatar', 'aria-hidden': 'true' }, 'Y'),
      el('div', null, el('p', { class: 'demo__name' }, 'Your Name'), el('p', { class: 'demo__agency' }, 'Your Agency')),
      el('p', { class: 'demo__meeting' }, '30 min intro call')
    ),
    screen
  );

  // Any real click or key press hands control to the visitor for good.
  const takeOver = () => {
    if (!auto) return;
    auto = false;
    runId++;
    for (const node of mount.querySelectorAll('.is-pressed')) node.classList.remove('is-pressed');
    for (const node of mount.querySelectorAll('.is-typing')) node.classList.remove('is-typing');
  };
  mount.addEventListener('pointerdown', takeOver);
  mount.addEventListener('keydown', takeOver);

  // ----- screens -----

  function show(name, build) {
    s.screen = name;
    const next = el('div', { class: 'demo__screen' });
    build(next);
    mount.lastElementChild.replaceWith(next);
    return next;
  }

  let slotsBox;
  let whenText;
  let continueBtn;

  function showPick() {
    show('pick', (root) => {
      const calMount = el('div');
      slotsBox = el('div', { class: 'demo__slots' });
      whenText = el('p', { class: 'demo__when' });
      continueBtn = el(
        'button',
        { class: 'btn btn--arrow btn--sm', type: 'button', onclick: () => s.time && showForm() },
        'Continue',
        el('span', { class: 'btn__disc' }, icon('arrow-right'))
      );
      root.append(el('div', { class: 'demo__pick' }, calMount, slotsBox), el('div', { class: 'demo__bar' }, whenText, continueBtn));
      calendar = createCalendar(calMount, {
        month: monthKey(s.day),
        today,
        minMonth: monthKey(today),
        maxMonth: monthKey(lastDay),
        selected: s.day,
        status,
        openCount: (day) => timesFor(day).length,
        onSelect: (day) => pickDay(day, true),
      });
      drawSlots();
      drawBar();
    });
  }

  function pickDay(day, fresh) {
    s.day = day;
    s.time = '';
    calendar.update({ selected: day, fresh, month: monthKey(day) });
    drawSlots();
    drawBar();
  }

  function drawSlots() {
    const times = timesFor(s.day);
    const { d } = parseYmd(s.day);
    clear(slotsBox).append(
      el('p', { class: 'demo__slots-title' }, formatDay(s.day, 'weekdayLong')),
      el('p', { class: 'demo__slots-sub' }, `${formatDay(s.day, 'monthLong')} ${d}`),
      times.length
        ? el(
            'div',
            { class: 'slots__list' },
            times.map((time, i) =>
              el(
                'button',
                {
                  class: `slot${time === s.time ? ' is-selected' : ''}`,
                  type: 'button',
                  'aria-pressed': time === s.time ? 'true' : 'false',
                  style: `--i:${i}`,
                  dataset: { time },
                  onclick: () => pickTime(time),
                },
                el('span', { class: 'slot__time' }, time),
                icon('check', 'icon slot__tick')
              )
            )
          )
        : el('p', { class: 'demo__slots-sub' }, 'Nothing open. Try a weekday.')
    );
  }

  function pickTime(time) {
    s.time = time;
    for (const button of slotsBox.querySelectorAll('.slot')) {
      const on = button.dataset.time === time;
      button.classList.toggle('is-selected', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    drawBar();
  }

  function drawBar() {
    whenText.textContent = s.time ? `${formatDay(s.day, 'medium')} at ${s.time}` : 'Pick a time';
    whenText.classList.toggle('is-set', Boolean(s.time));
    continueBtn.setAttribute('aria-disabled', s.time ? 'false' : 'true');
  }

  let nameBox;
  let emailBox;
  let confirmBtn;

  function showForm() {
    show('form', (root) => {
      nameBox = el('span', { class: 'demo__input' });
      emailBox = el('span', { class: 'demo__input' });
      confirmBtn = el('button', { class: 'btn btn--arrow', type: 'button', onclick: showDone }, 'Confirm booking', el('span', { class: 'btn__disc' }, icon('check')));
      // In manual mode the fields come pre-filled: the real form is on /book.
      if (!auto) {
        nameBox.textContent = 'Sam Carter';
        emailBox.textContent = 'sam@example.com';
      }
      root.append(
        el(
          'div',
          { class: 'demo__form' },
          el('h3', null, 'Your details'),
          el('p', { class: 'demo__chosen' }, icon('calendar'), `${formatDay(s.day, 'long')} at ${s.time}`),
          el('div', { class: 'demo__field' }, 'Name', nameBox),
          el('div', { class: 'demo__field' }, 'Email', emailBox),
          confirmBtn
        )
      );
    });
  }

  function showDone() {
    const { d } = parseYmd(s.day);
    show('done', (root) => {
      root.append(
        el(
          'div',
          { class: 'demo__done is-celebrating' },
          el('div', { class: 'tick', 'aria-hidden': 'true' }, icon('check')),
          el('h3', { class: 'settle', style: '--i:0' }, "You're booked."),
          el(
            'div',
            { class: 'ticket settle', style: '--i:1' },
            el('div', { class: 'ticket__date' }, el('span', null, formatDay(s.day, 'weekdayShort')), el('span', { class: 'ticket__day' }, String(d).padStart(2, '0')), el('span', null, formatDay(s.day, 'monthShort'))),
            el('div', { class: 'ticket__info' }, el('p', { class: 'ticket__time' }, s.time), el('p', { class: 'ticket__line' }, '30 min intro call'), el('p', { class: 'ticket__line' }, 'with ', el('strong', null, 'Your Name')))
          ),
          el(
            'div',
            { class: 'demo__again settle', style: '--i:2' },
            el('a', { class: 'btn btn--sm btn--lime', href: 'book' }, 'Try the real one', icon('arrow-right')),
            el(
              'button',
              {
                class: 'btn btn--sm btn--quiet',
                type: 'button',
                onclick: () => {
                  s.time = '';
                  showPick();
                },
              },
              'Again'
            )
          )
        )
      );
    });
  }

  // ----- autoplay -----

  const sleep = (ms, id) =>
    new Promise((resolve, reject) => {
      const started = performance.now();
      const check = () => {
        if (id !== runId) return reject(new Error('stopped'));
        // Hold position while the tab is hidden or the demo is off screen.
        if (!visible || document.hidden) return setTimeout(check, 300);
        if (performance.now() - started >= ms) return resolve();
        setTimeout(check, 60);
      };
      check();
    });

  async function press(node, id) {
    node.classList.add('is-pressed');
    await sleep(170, id);
    node.classList.remove('is-pressed');
  }

  async function type(box, text, id) {
    box.classList.add('is-typing');
    for (let i = 1; i <= text.length; i++) {
      box.textContent = text.slice(0, i);
      await sleep(38 + (i % 3) * 14, id);
    }
    await sleep(220, id);
    box.classList.remove('is-typing');
  }

  async function play() {
    const id = ++runId;
    let turn = 0;
    try {
      while (auto) {
        const day = openDays[(2 + turn * 3) % openDays.length];
        const times = timesFor(day);
        const time = times[(1 + turn) % times.length];
        turn++;

        s.time = '';
        showPick();
        await sleep(1300, id);
        pickDay(day, true);
        await sleep(1250, id);
        pickTime(time);
        await sleep(950, id);
        await press(continueBtn, id);
        showForm();
        await sleep(500, id);
        await type(nameBox, 'Sam Carter', id);
        await type(emailBox, 'sam@example.com', id);
        await sleep(250, id);
        await press(confirmBtn, id);
        showDone();
        await sleep(3400, id);
      }
    } catch {
      /* the visitor took over */
    }
  }

  showPick();
  if (auto) {
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
      }).observe(mount);
    }
    play();
  } else {
    // Reduced motion: no autoplay. Start with a time already picked.
    pickTime(timesFor(s.day)[1] || '');
  }
}
