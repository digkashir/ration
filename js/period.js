// Единый выбор периода (решение пользователя к Q-79): план, покупки и гид — одинаковый переключатель
// «‹ период › · сегодня · День / 7 дней / Месяц / Свой период». У каждого раздела свой период.
import { actions, openLayer, closeLayer, topLayer } from './ui.js';
import { $, $$, esc } from './util.js';
import { today, addDays, diffDays, fromIso, iso, rangeTitle } from './plan-model.js';

const REG = {}; // ключ → { st: {len, from, to}, refresh(), onToday?(date), persist? }
const KEY = (k) => 'ration.period.' + k;

/** Новое состояние периода: «сегодня + 6 дней». */
export const fresh = () => { const t = today(); return { len: 'week', from: t, to: addDays(t, 6) }; };

/** Зарегистрировать раздел. persist — запоминать период на устройстве (покупки и гид: в магазине приложение часто перезапускается). */
export function register(key, st, opts = {}) {
  if (opts.persist) {
    try {
      const s = JSON.parse(localStorage.getItem(KEY(key)) || 'null');
      if (s && s.from && s.to && s.len) Object.assign(st, { len: s.len, from: s.from, to: s.to });
    } catch (e) { /* нет хранилища — начинаем с «сегодня» */ }
  }
  REG[key] = { st, ...opts };
  return st;
}
function save(key) {
  const r = REG[key]; if (!r || !r.persist) return;
  try { localStorage.setItem(KEY(key), JSON.stringify({ len: r.st.len, from: r.st.from, to: r.st.to })); } catch (e) { /* */ }
}

export function setLen(st, len, from = st.from) {
  st.len = len;
  if (len === 'day') { st.from = from; st.to = from; }
  else if (len === 'week') { st.from = from; st.to = addDays(from, 6); }
  else if (len === 'month') { const d = fromIso(from); st.from = iso(new Date(d.getFullYear(), d.getMonth(), 1)); st.to = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
}
export function shift(st, dir) {
  if (st.len === 'month') { const d = fromIso(st.from); setLen(st, 'month', iso(new Date(d.getFullYear(), d.getMonth() + dir, 1))); return; }
  const n = diffDays(st.to, st.from) + 1;
  st.from = addDays(st.from, dir * n); st.to = addDays(st.to, dir * n);
}
/** Показать дату: если она вне периода — сдвинуть период к ней (свой период превращается в 7 дней). */
export function reveal(st, date) {
  if (date >= st.from && date <= st.to) return false;
  setLen(st, st.len === 'custom' ? 'week' : st.len, date);
  return true;
}

const LENS = [['day', 'День'], ['week', '7 дней'], ['month', 'Месяц'], ['custom', 'Свой период']];
/** Разметка переключателя. segClass — например 'only-wide', если на телефоне переключатель не нужен. */
export function view(key, { segClass = '' } = {}) {
  const st = REG[key].st;
  return `<div class="pnav-wrap" data-pk="${key}"><div class="pnav"><button class="btn icon sm" data-a="per-prev" data-k="${key}" aria-label="Раньше">‹</button>
    <h1 class="per-title" id="per-title-${key}">${esc(rangeTitle(st.from, st.to))}</h1><button class="btn icon sm" data-a="per-next" data-k="${key}" aria-label="Позже">›</button>
    <button class="link" data-a="per-today" data-k="${key}">сегодня</button></div>
    <div class="seg ${segClass}" role="group" aria-label="Период">${LENS.map(([v, l]) => `<button data-a="per-len" data-k="${key}" data-v="${v}" aria-pressed="${st.len === v}">${l}</button>`).join('')}</div></div>`;
}
/** Обновить заголовок и кнопки без перерисовки страницы. */
export function sync(key) {
  const st = REG[key] && REG[key].st; if (!st) return;
  const h = $(`#per-title-${key}`); if (h) h.textContent = rangeTitle(st.from, st.to);
  $$(`[data-a="per-len"][data-k="${key}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === st.len)));
}
function changed(key) { save(key); sync(key); const r = REG[key]; if (r.refresh) r.refresh(); }

actions['per-prev'] = (t) => { const r = REG[t.dataset.k]; shift(r.st, -1); changed(t.dataset.k); };
actions['per-next'] = (t) => { const r = REG[t.dataset.k]; shift(r.st, 1); changed(t.dataset.k); };
actions['per-today'] = (t) => {
  const r = REG[t.dataset.k]; const d = today();
  setLen(r.st, r.st.len === 'custom' ? 'week' : r.st.len, d);
  if (r.onToday) r.onToday(d);
  changed(t.dataset.k);
};
actions['per-len'] = (t) => {
  const k = t.dataset.k; const r = REG[k];
  if (t.dataset.v === 'custom') { openLayer({ type: 'dialog', kind: 'per-range', k }); return; }
  setLen(r.st, t.dataset.v, r.st.len === 'month' ? today() : r.st.from);
  changed(k);
};

function rangeView(l) {
  const st = REG[l.k].st;
  return `<section class="dialog small" role="dialog" aria-modal="true" aria-labelledby="pr-title"><div class="dlg-body"><h2 id="pr-title">Свой период</h2>
    <div class="grid2"><label class="field"><span>С</span><input type="date" id="pr-from" value="${st.from}"></label><label class="field"><span>По</span><input type="date" id="pr-to" value="${st.to}"></label></div>
    <p class="err" id="pr-err" role="alert"></p></div><div class="dlg-foot"><button class="btn" data-a="layer-close">Отмена</button><button class="btn acc" data-a="pr-ok">Показать</button></div></section>`;
}
actions['pr-ok'] = () => {
  const l = topLayer(); if (!l || l.kind !== 'per-range') return;
  const f = $('#pr-from').value, t = $('#pr-to').value;
  if (!f || !t || t < f) { $('#pr-err').textContent = 'Проверьте даты: «по» не раньше «с».'; return; }
  if (diffDays(t, f) > 92) { $('#pr-err').textContent = 'Не больше трёх месяцев.'; return; }
  const r = REG[l.k]; Object.assign(r.st, { len: 'custom', from: f, to: t });
  closeLayer(); changed(l.k);
};
export function dialogView(l) { return l.kind === 'per-range' ? rangeView(l) : ''; }
