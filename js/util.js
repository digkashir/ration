// Общие мелочи интерфейса.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
export const fmt = (n, d = 0) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: 0 });

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 10, b = Math.abs(n) % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

export function parseNum(v) {
  const s = String(v == null ? '' : v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

export function showToast(text, kind = 'info', ms = 4000) {
  const box = $('#toasts');
  if (!box || !text) return;
  // не больше двух сообщений одновременно, чтобы не закрывать интерфейс
  while (box.children.length >= 2) box.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// Тэги времени приёма окрашиваются в цвета приёмов (D-03)
export const MEAL_COLORS = {
  'meal-breakfast': 'var(--s-breakfast)', 'meal-lunch': 'var(--s-lunch)', 'meal-dinner': 'var(--s-dinner)',
  'meal-snack': 'var(--s-snack)', 'meal-tea': 'var(--s-tea)',
};

export const ICON = {
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  grip: '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="2" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>',
  person: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
};
