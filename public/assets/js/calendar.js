// Month grid with full keyboard support. Used by the booking page and by the
// self-playing demo on the landing page.
//
// status(ymd) must return one of:
//   'open'  has times, selectable
//   'none'  inside the booking window but nothing free, selectable (shows the empty state)
//   'off'   in the past or outside the booking window, not selectable

import { el, clear, icon } from './dom.js';
import { ymd, parseYmd, addDays, addMonths, daysInMonth, weekday, monthKey, monthName, monthYear, formatDay } from './dates.js';

const DOW = [
  ['S', 'Sunday'],
  ['M', 'Monday'],
  ['T', 'Tuesday'],
  ['W', 'Wednesday'],
  ['T', 'Thursday'],
  ['F', 'Friday'],
  ['S', 'Saturday'],
];

let uid = 0;

export function createCalendar(mount, options) {
  const id = `cal-${++uid}`;
  let state = {
    month: '',
    today: '',
    minMonth: '',
    maxMonth: '',
    selected: '',
    status: () => 'off',
    openCount: () => 0,
    onSelect: () => {},
    onMonth: () => {},
    interactive: true,
    ...options,
  };
  let cursor = ''; // the day that owns tabindex=0
  let direction = 0;
  let fresh = ''; // day that was selected by the last action (gets the pop)

  const monthEl = el('span', { class: 'cal__month' });
  const yearEl = el('span', { class: 'cal__year mono' });
  const title = el('h2', { class: 'cal__title', id: `${id}-title`, 'aria-live': 'polite' }, monthEl, ' ', yearEl);
  const prev = el('button', { class: 'cal__arrow', type: 'button', 'aria-label': 'Previous month', onclick: () => shift(-1) }, icon('chevron-left'));
  const next = el('button', { class: 'cal__arrow', type: 'button', 'aria-label': 'Next month', onclick: () => shift(1) }, icon('chevron-right'));
  const grid = el('div', { class: 'cal__grid', role: 'grid', 'aria-labelledby': `${id}-title` });
  const root = el('div', { class: 'cal' }, el('div', { class: 'cal__head' }, title, el('div', { class: 'cal__nav' }, prev, next)), grid);

  grid.addEventListener('keydown', onKey);
  clear(mount).append(root);

  function shift(n, focusDay) {
    const target = addMonths(state.month, n);
    if (target < state.minMonth || target > state.maxMonth) return false;
    direction = n;
    state.month = target;
    cursor = focusDay || '';
    state.onMonth(target);
    draw();
    return true;
  }

  function firstDay() {
    return `${state.minMonth}-01`;
  }
  function lastDay() {
    const [y, m] = state.maxMonth.split('-').map(Number);
    return ymd(y, m, daysInMonth(y, m));
  }

  function defaultCursor() {
    const [y, m] = state.month.split('-').map(Number);
    const total = daysInMonth(y, m);
    if (state.selected && monthKey(state.selected) === state.month) return state.selected;
    for (let d = 1; d <= total; d++) if (state.status(ymd(y, m, d)) === 'open') return ymd(y, m, d);
    if (monthKey(state.today) === state.month) return state.today;
    return ymd(y, m, 1);
  }

  function onKey(event) {
    const button = event.target.closest('.cal__day');
    if (!button) return;
    const day = button.dataset.day;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let target = '';

    if (event.key in moves) target = addDays(day, moves[event.key]);
    else if (event.key === 'Home') target = addDays(day, -weekday(day));
    else if (event.key === 'End') target = addDays(day, 6 - weekday(day));
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const { d } = parseYmd(day);
      const key = addMonths(monthKey(day), event.key === 'PageUp' ? -1 : 1);
      const [y, m] = key.split('-').map(Number);
      target = ymd(y, m, Math.min(d, daysInMonth(y, m)));
    } else return;

    event.preventDefault();
    if (target < firstDay()) target = firstDay();
    if (target > lastDay()) target = lastDay();
    if (target === day) return;

    if (monthKey(target) !== state.month) {
      direction = target > day ? 1 : -1;
      state.month = monthKey(target);
      state.onMonth(state.month);
    } else {
      direction = 0;
    }
    cursor = target;
    draw();
    focus();
  }

  function focus() {
    const node = grid.querySelector('.cal__day[tabindex="0"]');
    if (node) node.focus();
  }

  function pick(day) {
    if (state.status(day) === 'off') return;
    fresh = day;
    cursor = day;
    state.selected = day;
    state.onSelect(day);
  }

  function draw() {
    const [y, m] = state.month.split('-').map(Number);
    monthEl.textContent = monthName(state.month);
    yearEl.textContent = monthYear(state.month);
    prev.disabled = state.month <= state.minMonth;
    next.disabled = state.month >= state.maxMonth;

    if (!cursor || monthKey(cursor) !== state.month) cursor = defaultCursor();

    const rows = [];
    rows.push(
      el('div', { class: 'cal__row cal__row--dow', role: 'row' }, DOW.map(([short, long]) => el('span', { class: 'cal__dow', role: 'columnheader', 'aria-label': long }, short)))
    );

    const total = daysInMonth(y, m);
    const lead = weekday(ymd(y, m, 1));
    let cells = [];
    for (let i = 0; i < lead; i++) cells.push(el('span', { class: 'cal__cell', role: 'gridcell' }));

    for (let d = 1; d <= total; d++) {
      const day = ymd(y, m, d);
      const status = state.status(day);
      const isSelected = day === state.selected;
      const isToday = day === state.today;
      const count = status === 'open' ? state.openCount(day) : 0;

      let label = formatDay(day, 'long');
      if (isToday) label += ', today';
      if (status === 'open') label += count ? `, ${count} ${count === 1 ? 'time' : 'times'} open` : ', times open';
      else if (status === 'none') label += ', nothing open';
      else label += ', not available';

      const classes = ['cal__day', `is-${status}`];
      if (isSelected) classes.push('is-selected');
      if (isSelected && fresh === day) classes.push('is-fresh');
      if (isToday) classes.push('is-today');

      const button = el(
        'button',
        {
          class: classes.join(' '),
          type: 'button',
          dataset: { day },
          tabindex: state.interactive && day === cursor ? '0' : '-1',
          'aria-label': label,
          'aria-disabled': status === 'off' ? 'true' : undefined,
          'aria-current': isToday ? 'date' : undefined,
          onclick: () => pick(day),
        },
        el('span', { class: 'cal__num' }, d)
      );
      cells.push(el('span', { class: 'cal__cell', role: 'gridcell', 'aria-selected': isSelected ? 'true' : 'false' }, button));

      if (cells.length === 7 || d === total) {
        while (cells.length < 7) cells.push(el('span', { class: 'cal__cell', role: 'gridcell' }));
        rows.push(el('div', { class: 'cal__row', role: 'row' }, cells));
        cells = [];
      }
    }

    grid.classList.remove('from-next', 'from-prev');
    clear(grid).append(...rows);
    if (direction) {
      void grid.offsetWidth; // restart the slide
      grid.classList.add(direction > 0 ? 'from-next' : 'from-prev');
    }
    direction = 0;
    fresh = '';
  }

  draw();

  return {
    // Merge new values and redraw. Pass { selected } after a pick to show it.
    update(patch = {}) {
      const had = grid.contains(document.activeElement);
      state = { ...state, ...patch };
      if (patch.selected && patch.fresh) fresh = patch.selected;
      if (patch.selected) cursor = patch.selected;
      draw();
      if (had) focus();
    },
    get month() {
      return state.month;
    },
    focus,
    root,
  };
}
