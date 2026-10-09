// Sign-in for the dashboard. The server sends login.html in place of the
// dashboard when a passcode is set and this browser has no session yet.

import { api } from './api.js';
import { applyBrand } from './brand.js';
import { $, clear, icon, busy } from './dom.js';

applyBrand();

const input = $('#passcode');
const error = $('#passcode-error');
const card = $('.gate__card');

function fail(message) {
  input.setAttribute('aria-invalid', 'true');
  clear(error).append(icon('alert'), message);
  error.hidden = false;
  card.classList.remove('is-wrong');
  void card.offsetWidth; // restart the shake
  card.classList.add('is-wrong');
  input.focus();
  input.select();
}

$('#gate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!input.value) return fail('Enter the passcode.');
  const restore = busy($('#gate-submit'), 'Checking…');
  try {
    await api.login(input.value);
    location.reload(); // the server now sends the dashboard
  } catch (err) {
    restore();
    fail(err.code === 'wrong_passcode' ? 'That passcode is not right.' : err.message);
  }
});
