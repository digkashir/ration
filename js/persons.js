// Персоны (12G): карточки с дневными целями, средний % от цели за текущий период плана, правка в панели.
import * as store from './store.js';
import { ui, actions, hooks, openLayer, closeLayer, topLayer } from './ui.js';
import { $, $$, esc, fmt, parseNum, showToast, ICON } from './util.js';
import { persons, initial, dayTotals, daysBetween, entries } from './plan-model.js';

export const avatar = (p, cls = '') => `<span class="ava ${cls}" aria-hidden="true">${esc(initial(p))}</span>`;

function weekStats(p) {
  const days = daysBetween(ui.plan.from, ui.plan.to);
  const sum = { kcal: 0, p: 0, f: 0, c: 0 };
  let n = 0;
  for (const d of days) {
    const t = dayTotals(d)[p.id];
    if (!t || !t.kcal) continue;
    n++;
    for (const k of Object.keys(sum)) sum[k] += t[k];
  }
  if (!n) return null;
  const g = p.goals || {};
  const pct = (k) => (g[k] ? Math.round((sum[k] / n / g[k]) * 100) : null);
  return { n, kcal: pct('kcal'), p: pct('p'), f: pct('f'), c: pct('c') };
}

export function page() {
  const list = persons();
  const bar = (l, v) => v == null ? '' : `<div class="pbar"><div class="pbar-h"><span>${l}</span><b class="${v > 110 ? 'over' : ''}">${v}%</b></div><div class="track"><i style="width:${Math.min(100, v)}%" class="${v > 110 ? 'over' : ''}"></i></div></div>`;
  const cards = list.map((p) => {
    const g = p.goals || {};
    const st = weekStats(p);
    return `<div class="pcard" data-pid="${esc(p.id)}">
      <div class="pcard-h">${avatar(p, 'lg')}<button class="pcard-name" data-a="per-edit" data-id="${esc(p.id)}"><b>${esc(p.name)}</b><span class="hint">цель в день · изменить</span></button>
        <button class="grip pgrip" data-pgrip="${esc(p.id)}" aria-label="Порядок: перетащите карточку или нажимайте стрелки влево и вправо">${ICON.grip}</button></div>
      <div class="goals">${[['ккал', g.kcal], ['белки', g.p], ['жиры', g.f], ['углев.', g.c]].map(([l, v]) => `<div><span>${l}</span><b>${v ? fmt(v) : '—'}</b></div>`).join('')}</div>
      ${st ? `<span class="hint cap">период плана · в среднем от цели · ${st.n} дн.</span>${bar('ккал', st.kcal)}${bar('Б', st.p)}${bar('Ж', st.f)}${bar('У', st.c)}` : '<span class="hint">В текущем периоде плана пока нет приёмов.</span>'}
    </div>`;
  }).join('');
  return `<main class="page persons-page">
    <div class="page-head"><h1>Персоны</h1><span class="count">${list.length}</span><span class="spacer"></span>
      <button class="btn acc" data-a="per-new">+ Персона</button></div>
    ${list.length ? `<div class="pgrid" id="pgrid">${cards}</div>
      <p class="hint">Порядок карточек — порядок столбцов в плане, меняется перетаскиванием за ${ICON.grip}. Если персон больше пяти, план прокручивается вбок.</p>`
    : `<div class="empty">Персон пока нет. Добавьте тех, для кого планируете еду, — у каждого свои цели по КБЖУ.<br><br><button class="btn acc" data-a="per-new">+ Персона</button></div>`}
  </main>`;
}

export function editorView(l) {
  const isNew = l.id === 'new';
  const p = isNew ? { name: '', goals: {} } : store.get('persons', l.id);
  if (!p) return '';
  const g = p.goals || {};
  const inp = (n, lbl, v) => `<label class="field"><span>${lbl}</span><input name="${n}" inputmode="decimal" value="${v == null ? '' : esc(String(v))}" autocomplete="off"></label>`;
  const used = isNew ? 0 : entries().filter((e) => e.eaters && e.eaters[p.id]).length;
  return `<section class="drawer" role="dialog" aria-modal="true" aria-labelledby="per-title">
    <header><div class="per-head">${isNew ? '' : avatar(p, 'lg')}<h2 id="per-title">${isNew ? 'Новая персона' : esc(p.name)}</h2></div>
      <button class="btn icon" data-a="layer-close" aria-label="Закрыть">×</button></header>
    <form class="body" id="per-form" novalidate>
      <label class="field"><span>Имя</span><input name="name" value="${esc(p.name)}" autocomplete="off" data-autofocus></label>
      <div class="panel"><b>Дневные цели</b>
        <div class="grid2">${inp('kcal', 'ккал', g.kcal)}${inp('p', 'белки, г', g.p)}${inp('f', 'жиры, г', g.f)}${inp('c', 'углеводы, г', g.c)}</div>
        <span class="hint" id="per-check"></span></div>
      ${used ? `<p class="hint">В плане: ${used} ${used === 1 ? 'приём' : 'приёмов'}. При удалении персоны её порции уберутся из плана.</p>` : ''}
      <p class="err" id="per-err" role="alert"></p>
    </form>
    <footer><button class="btn acc" data-a="per-save">Сохранить</button><button class="btn" data-a="layer-close">Отмена</button><span class="spacer"></span>
      ${isNew ? '' : '<button class="btn danger" data-a="per-del">Удалить</button>'}</footer>
  </section>`;
}

export function afterRender() { check(); }
function check() {
  const f = $('#per-form'); const out = $('#per-check');
  if (!f || !out) return;
  const v = (n) => parseNum(f.elements[n].value);
  const p = v('p'), fa = v('f'), c = v('c'), k = v('kcal');
  if ([p, fa, c].some((x) => x == null || isNaN(x))) { out.textContent = ''; return; }
  const sum = p * 4 + fa * 9 + c * 4;
  out.textContent = `Проверка: ${fmt(p)}×4 + ${fmt(fa)}×9 + ${fmt(c)}×4 = ${fmt(sum)} ккал` + (k ? (Math.abs(sum - k) / k > 0.1 ? ' — заметно отличается от цели по ккал.' : ' — близко к цели.') : '.');
}

async function save() {
  const l = topLayer(); const f = $('#per-form'); if (!l || !f) return;
  const err = $('#per-err');
  $$('[aria-invalid]', f).forEach((i) => i.removeAttribute('aria-invalid'));
  const bad = (n, m) => { const i = f.elements[n]; i.setAttribute('aria-invalid', 'true'); i.focus(); err.textContent = m; };
  const name = f.elements.name.value.trim();
  if (!name) return bad('name', 'Введите имя.');
  const goals = {};
  for (const k of ['kcal', 'p', 'f', 'c']) {
    const n = parseNum(f.elements[k].value);
    if (n != null && (isNaN(n) || n < 0)) return bad(k, 'Цель — число от 0 или пусто.');
    goals[k] = n == null ? null : n;
  }
  const isNew = l.id === 'new';
  const base = isNew ? { id: store.newId('per'), order: Math.max(0, ...persons().map((p) => p.order ?? 0)) + 1 } : store.get('persons', l.id);
  await store.put('persons', { ...base, name, goals });
  showToast((isNew ? 'Добавлена персона «' : 'Сохранена персона «') + name + '»');
  closeLayer();
  hooks.refreshPage();
}

actions['per-new'] = () => openLayer({ type: 'person', id: 'new' });
actions['per-edit'] = (t) => openLayer({ type: 'person', id: t.dataset.id });
actions['per-save'] = () => save();
actions['per-del'] = () => {
  const l = topLayer(); const p = store.get('persons', l.id); if (!p) return;
  openLayer({ type: 'dialog', kind: 'confirm', title: `Удалить «${p.name}»?`, text: 'Персона и все её порции в плане будут удалены. Рецепты не пострадают.', ok: 'Удалить', danger: true,
    onOk: async () => {
      const changes = [{ coll: 'persons', id: p.id, remove: true }];
      for (const e of entries()) if (e.eaters && e.eaters[p.id]) { const eaters = { ...e.eaters }; delete eaters[p.id]; changes.push({ coll: 'plan', rec: { ...e, eaters } }); }
      ui.layers = ui.layers.filter((x) => x !== l); hooks.renderOverlay();
      await store.putAll(changes);
      showToast(`Персона «${p.name}» удалена`);
      hooks.refreshPage();
    } });
};

export function onInput(e) {
  if (e.target.closest && e.target.closest('#per-form')) { check(); return true; }
  return false;
}
export function onSubmit(e) { if (e.target.id === 'per-form') { e.preventDefault(); save(); return true; } return false; }

// ---------- порядок карточек: перетаскивание и стрелки ----------
async function saveOrder(ids) {
  const changes = ids.map((id, i) => ({ coll: 'persons', rec: { ...store.get('persons', id), order: i + 1 } }));
  await store.putAll(changes);
}
export function onKeydown(e) {
  const g = e.target.dataset && e.target.dataset.pgrip;
  if (!g || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return false;
  e.preventDefault();
  const ids = persons().map((p) => p.id); const i = ids.indexOf(g); const j = i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
  if (j < 0 || j >= ids.length) return true;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  saveOrder(ids).then(() => { hooks.refreshPage(); const b = $(`[data-pgrip="${CSS.escape(g)}"]`); if (b) b.focus(); });
  return true;
}
document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest && e.target.closest('[data-pgrip]');
  if (!grip || e.button > 0) return;
  const card = grip.closest('.pcard'); const grid = card && card.parentElement;
  if (!grid) return;
  e.preventDefault();
  card.classList.add('dragging');
  let moved = false;
  const move = (ev) => {
    moved = true;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const over = el && el.closest('.pcard');
    if (!over || over === card || over.parentElement !== grid) return;
    const r = over.getBoundingClientRect();
    const before = ev.clientX < r.left + r.width / 2;
    grid.insertBefore(card, before ? over : over.nextElementSibling);
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    card.classList.remove('dragging');
    if (!moved) return;
    saveOrder([...grid.children].map((c) => c.dataset.pid)).then(() => hooks.refreshPage());
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
});
