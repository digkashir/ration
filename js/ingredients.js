// База ингредиентов: список (v0.1) и редактор в боковой панели.
import * as store from './store.js';
import { noBuy } from './export-model.js';
import { ui, actions, openLayer, closeLayer, topLayer } from './ui.js';
import { $, $$, esc, norm, fmt, plural, parseNum, showToast, ICON } from './util.js';

export const groupTags = () => store.list('tags').filter((t) => t.group === 'ingredients').sort((a, b) => a.name.localeCompare(b.name, 'ru'));
export const tagName = (id) => { const t = store.get('tags', id); return t ? t.name : ''; };
export const usage = (ingId) => store.list('recipes').filter((r) => (r.ingredients || []).some((x) => x.ing === ingId));

function values(x) {
  const u = ui.ing.unit;
  if (u === '1') return [fmt(x.kcal, 2), fmt(x.p, 3), fmt(x.f, 3), fmt(x.c, 3), fmt(x.fib, 3)];
  if (u === 'pc') {
    if (!x.unitWeight) return ['—', '—', '—', '—', '—'];
    const w = x.unitWeight;
    return [fmt(x.kcal * w, 0), fmt(x.p * w, 1), fmt(x.f * w, 1), fmt(x.c * w, 1), fmt(x.fib * w, 1)];
  }
  return [fmt(x.kcal * 100, 0), fmt(x.p * 100, 1), fmt(x.f * 100, 1), fmt(x.c * 100, 1), fmt(x.fib * 100, 1)];
}

function filtered() {
  const q = norm(ui.ing.q).trim();
  return store.list('ingredients')
    .filter((x) => ui.ing.group === 'all' || (ui.ing.group === 'none' ? !x.group : x.group === ui.ing.group))
    .filter((x) => !q || norm(x.name).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function page() {
  const all = store.list('ingredients');
  const cnt = (g) => all.filter((x) => (g === 'none' ? !x.group : x.group === g)).length;
  const unitBtn = (v, l) => `<button data-a="ing-unit" data-v="${v}" aria-pressed="${ui.ing.unit === v}">${l}</button>`;
  return `<main class="page">
    <div class="page-head">
      <h1>Ингредиенты</h1><span class="count" id="ing-count"></span>
      <span class="spacer"></span>
      <div class="seg" role="group" aria-label="КБЖУ на">${unitBtn('100', 'на 100 г')}${unitBtn('1', 'на 1 г')}${unitBtn('pc', 'на 1 шт')}</div>
      <button class="btn acc" data-a="ing-new">+ Ингредиент</button>
      <label class="search">${ICON.search}<span class="sr-only">Поиск ингредиента</span><input id="ing-q" type="search" placeholder="Найти ингредиент" value="${esc(ui.ing.q)}"></label>
    </div>
    <div class="chips" role="group" aria-label="Группа ингредиентов">
      <button class="chip" data-a="ing-grp" data-v="all" aria-pressed="${ui.ing.group === 'all'}">Все<b>${all.length}</b></button>
      ${groupTags().map((t) => `<button class="chip" data-a="ing-grp" data-v="${t.id}" aria-pressed="${ui.ing.group === t.id}">${esc(t.name)}<b>${cnt(t.id)}</b></button>`).join('')}
      <button class="chip" data-a="ing-grp" data-v="none" aria-pressed="${ui.ing.group === 'none'}">без группы<b>${cnt('none')}</b></button>
    </div>
    <div class="ing-table" id="ing-list"></div>
  </main>`;
}

export function renderList() {
  const el = $('#ing-list');
  if (!el) return;
  const items = filtered();
  $('#ing-count').textContent = items.length + ' из ' + store.list('ingredients').length;
  const L = ui.ing.unit === '1' ? '1 г' : ui.ing.unit === 'pc' ? '1 шт' : '100 г';
  const head = `<div class="ing-row ing-head" aria-hidden="true"><span>название</span><span>группа</span>
    <span class="r">ккал · ${L}</span><span class="r">белки</span><span class="r">жиры</span><span class="r">углеводы</span><span class="r">клетчатка</span><span class="r">1 шт</span></div>`;
  if (!items.length) { el.innerHTML = head + '<div class="empty">Ничего не нашлось</div>'; return; }
  el.innerHTML = head + items.map((x) => {
    const v = values(x);
    return `<button class="ing-row" data-a="ing-edit" data-id="${esc(x.id)}" aria-label="Изменить: ${esc(x.name)}">
      <span class="cell name">${esc(x.name)}${x.custom ? '<small>свой</small>' : ''}</span>
      <span class="cell grp">${esc(tagName(x.group) || 'без группы')}</span>
      <span class="cell num" data-l="ккал">${v[0]}</span><span class="cell num" data-l="Б">${v[1]}</span><span class="cell num" data-l="Ж">${v[2]}</span><span class="cell num" data-l="У">${v[3]}</span><span class="cell num" data-l="клетч.">${v[4]}</span>
      <span class="cell unit">${x.unitWeight ? '1 ' + esc(x.unitName || 'шт') + ' = ' + fmt(x.unitWeight) + ' г' : '—'}</span>
    </button>`;
  }).join('');
}

// ---------- редактор ингредиента (слой type: 'ingredient') ----------
const num100 = (v) => (v == null ? '' : String(Math.round(v * 100 * 1000) / 1000).replace('.', ','));

export function editorView(layer) {
  const isNew = layer.id === 'new';
  const x = isNew ? { name: layer.prefill || '', group: null, kcal: 0, p: 0, f: 0, c: 0, fib: 0, unitWeight: null, unitName: 'шт', category: '' } : store.get('ingredients', layer.id);
  if (!x) return '';
  const used = isNew ? [] : usage(x.id);
  const opt = (id, name) => `<option value="${esc(id)}" ${x.group === id || (!x.group && !id) ? 'selected' : ''}>${esc(name)}</option>`;
  const inp = (n, l, v) => `<label class="field"><span>${l}</span><input name="${n}" inputmode="decimal" value="${esc(v)}" autocomplete="off"></label>`;
  return `<section class="drawer" role="dialog" aria-modal="true" aria-labelledby="ing-title">
    <header><div><div class="hint">${isNew ? 'Новый ингредиент' : (x.custom ? 'Свой ингредиент' : 'Ингредиент из стартовой базы')}</div><h2 id="ing-title">${isNew ? 'Добавить' : esc(x.name)}</h2></div>
      <button class="btn icon" data-a="layer-close" aria-label="Закрыть">×</button></header>
    <form class="body" id="ing-form" novalidate>
      <label class="field"><span>Название</span><input name="name" value="${esc(x.name)}" required autocomplete="off" data-autofocus></label>
      <label class="field"><span>Группа ингредиентов (для автотэгов рецептов)</span>
        <select name="group">${opt('', 'без группы')}${groupTags().map((t) => opt(t.id, t.name)).join('')}</select></label>
      <div class="panel">
        <span class="hint"><b>КБЖУ и клетчатка на 100 г.</b> В базе значения хранятся на 1 г и пересчитываются автоматически.</span>
        <div class="grid5">${inp('kcal', 'ккал', num100(x.kcal))}${inp('p', 'белки, г', num100(x.p))}${inp('f', 'жиры, г', num100(x.f))}${inp('c', 'углев., г', num100(x.c))}${inp('fib', 'клетч., г', num100(x.fib))}</div>
      </div>
      <div class="panel">
        <span class="hint"><b>Штука</b> — если продукт удобно считать поштучно (яйцо, банан). Оставьте вес пустым, если не нужно.</span>
        <div class="grid2">${inp('unitWeight', 'вес 1 штуки, г', x.unitWeight == null ? '' : String(x.unitWeight).replace('.', ','))}
          <label class="field"><span>как называть</span><input name="unitName" value="${esc(x.unitName || 'шт')}" autocomplete="off"></label></div>
      </div>
      <label class="field"><span>Категория — отдел в списке покупок (овощи, мясо, молочное…)</span><input name="category" value="${esc(x.category || '')}" autocomplete="off"></label>
      <label class="check-line"><input type="checkbox" name="noBuy" ${noBuy(x) ? 'checked' : ''}> Не покупать — не попадает в список покупок (как вода и соль), в гиде остаётся</label>
      ${used.length ? `<p class="hint">Используется в ${used.length} ${plural(used.length, 'рецепте', 'рецептах', 'рецептах')}: ${used.slice(0, 4).map((r) => '«' + esc(r.name) + '»').join(', ')}${used.length > 4 ? '…' : ''}.</p>` : ''}
      <p class="err" id="ing-err" role="alert"></p>
    </form>
    <footer>
      <button class="btn acc" data-a="ing-save">Сохранить</button>
      <button class="btn" data-a="layer-close">Отмена</button>
      <span class="spacer"></span>
      ${isNew ? '' : `<button class="btn danger" data-a="ing-del" ${used.length ? 'disabled title="Сначала уберите ингредиент из рецептов"' : ''}>Удалить</button>`}
    </footer>
  </section>`;
}

async function save() {
  const layer = topLayer();
  const form = $('#ing-form');
  if (!layer || !form) return;
  const fd = new FormData(form);
  const err = $('#ing-err');
  $$('[aria-invalid]', form).forEach((i) => i.removeAttribute('aria-invalid'));
  const bad = (name, msg) => { const i = form.elements[name]; if (i) { i.setAttribute('aria-invalid', 'true'); i.focus(); } err.textContent = msg; };
  const name = String(fd.get('name') || '').trim();
  if (!name) return bad('name', 'Введите название.');
  if (store.list('ingredients').find((x) => norm(x.name) === norm(name) && x.id !== layer.id)) return bad('name', 'Ингредиент с таким названием уже есть.');
  const vals = {};
  for (const k of ['kcal', 'p', 'f', 'c', 'fib']) {
    const n = parseNum(fd.get(k));
    if (n == null || isNaN(n) || n < 0) return bad(k, 'Введите число от 0 и больше (на 100 г).');
    vals[k] = Math.round((n / 100) * 1e6) / 1e6;
  }
  if (vals.p + vals.f + vals.c + vals.fib > 1.0001) return bad('p', 'Белков, жиров, углеводов и клетчатки в сумме не может быть больше 100 г на 100 г.');
  const uw = parseNum(fd.get('unitWeight'));
  if (uw != null && (isNaN(uw) || uw <= 0)) return bad('unitWeight', 'Вес штуки — число больше 0 или пусто.');
  const isNew = layer.id === 'new';
  const base = isNew ? { id: store.newId('ing'), custom: true } : store.get('ingredients', layer.id);
  const rec = {
    ...base, name, ...vals,
    group: String(fd.get('group') || '') || null,
    unitWeight: uw == null ? null : uw,
    unitName: uw == null ? null : (String(fd.get('unitName') || '').trim() || 'шт'),
    category: String(fd.get('category') || '').trim(),
    noBuy: fd.get('noBuy') === 'on',
  };
  await store.put('ingredients', rec);
  showToast((isNew ? 'Добавлен' : 'Сохранён') + ' ингредиент «' + name + '»');
  const cb = layer.onSaved;
  closeLayer();
  if (cb) cb(rec);
}

actions['ing-unit'] = (t) => { ui.ing.unit = t.dataset.v; $$('[data-a="ing-unit"]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); renderList(); };
actions['ing-grp'] = (t) => { ui.ing.group = t.dataset.v; $$('[data-a="ing-grp"]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); renderList(); };
actions['ing-new'] = () => openLayer({ type: 'ingredient', id: 'new' });
actions['ing-edit'] = (t) => openLayer({ type: 'ingredient', id: t.dataset.id });
actions['ing-save'] = (t, e) => { e.preventDefault(); save(); };
actions['ing-del'] = async () => {
  const layer = topLayer();
  const x = layer && store.get('ingredients', layer.id);
  if (!x || !window.confirm('Удалить ингредиент «' + x.name + '»?')) return;
  await store.remove('ingredients', x.id);
  showToast('Ингредиент «' + x.name + '» удалён');
  closeLayer();
};

export function onInput(e) {
  if (e.target.id === 'ing-q') { ui.ing.q = e.target.value; renderList(); return true; }
  return false;
}
export function onSubmit(e) {
  if (e.target.id === 'ing-form') { e.preventDefault(); save(); return true; }
  return false;
}
