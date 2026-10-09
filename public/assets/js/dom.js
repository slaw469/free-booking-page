// Small DOM helpers. Text always goes in through textContent, so nothing a
// visitor types (names, notes, agency text) can ever be read as HTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

// el('button', { class: 'btn', onclick: fn, 'aria-label': 'x' }, 'text', childNode)
export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key === 'hidden' || key === 'disabled' || key === 'checked' || key === 'required') node[key] = Boolean(value);
      else if (key === 'value') node.value = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

// Icons come from the <svg> sprite at the top of each page.
export function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `assets/icons.svg#i-${name}`);
  svg.append(use);
  return svg;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let rack;
export function toast(message, { bad = false, ms = 2600 } = {}) {
  if (!rack) {
    rack = el('div', { class: 'toast-rack', role: 'status', 'aria-live': 'polite' });
    document.body.append(rack);
  }
  const node = el('div', { class: `toast${bad ? ' toast--bad' : ''}` }, icon(bad ? 'x' : 'check'), message);
  rack.append(node);
  setTimeout(() => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 240);
  }, ms);
}

// Puts a button into a waiting state and returns a function that restores it.
export function busy(button, label) {
  const before = [...button.childNodes];
  button.classList.add('is-busy');
  button.setAttribute('aria-busy', 'true');
  button.replaceChildren(el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', { class: 'btn__label' }, label));
  return () => {
    button.classList.remove('is-busy');
    button.removeAttribute('aria-busy');
    button.replaceChildren(...before);
  };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and plain-http pages on a LAN address.
    const area = el('textarea', { class: 'sr-only', readonly: true, 'aria-hidden': 'true' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
