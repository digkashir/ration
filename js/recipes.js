// База рецептов: список 10A с фильтрами, группами (3.2.2) и режимом выбора (11D).
import * as store from './store.js';
import { TAG_GROUPS } from './config.js';
import { ui, actions, hooks, openLayer } from './ui.js';
import { $, esc, norm, fmt, plural, ICON, MEAL_COLORS, showToast } from './util.js';
import { perPortion } from './nutrition.js';
import { members, addToGroup } from './groups.js';

const getIng = (id) => store.get('ingredients', id);
export const pp = (r) => perPortion(r, getIng);

// ---------- тэги ----------
const MEAL_ORDER = ['meal-breakfast', 'meal-lunch', 'meal-dinner', 'meal-snack', 'meal-tea'];
const mealPos = (id) => { const i = MEAL_ORDER.indexOf(id); return i < 0 ? 99 : i; };
export function tagsOf(groupId) {
  return store.list('tags').filter((t) => t.group === groupId)
    .sort((a, b) => mealPos(a.id) - mealPos(b.id) || a.name.localeCompare(b.name, 'ru'));
}
const TAG_RANK = { meal: 0, type: 1, nutrition: 2, ingredients: 3 };
export function sortedTags(ids) {
  return (ids || []).map((id) => store.get('tags', id)).filter(Boolean)
    .sort((a, b) => (TAG_RANK[a.group] ?? 9) - (TAG_RANK[b.group] ?? 9)
      || mealPos(a.id) - mealPos(b.id) || a.name.localeCompare(b.name, 'ru'));
}
export function tagChip(t, extra = '') {
  const c = MEAL_COLORS[t.id];
  return `<span class="tag${c ? ' meal' : ''}" ${c ? `style="--c:${c}"` : ''}>${esc(t.name)}${extra}</span>`;
}
function rowTags(r) {
  const all = sortedTags(r.tags);
  const meal = all.filter((t) => t.group === 'meal');
  const rest = all.filter((t) => t.group !== 'meal');
  const shown = rest.slice(0, 3);
  return meal.map((t) => tagChip(t)).join('') + shown.map((t) => tagChip(t)).join('') +
    (rest.length > shown.length ? `<span class="tag more">+${rest.length - shown.length}</span>` : '');
}
const mealDots = (r) => sortedTags(r.tags).filter((t) => t.group === 'meal').map((t) => `<i class="dot" style="background:${MEAL_COLORS[t.id]}" title="${esc(t.name)}"></i>`).join('');

// ---------- фильтры и поиск ----------
function activeByGroup() {
  const by = {};
  for (const id of ui.rec.filters) {
    const t = store.get('tags', id);
    if (!t) continue;
    (by[t.group] = by[t.group] || []).push(id);
  }
  return by;
}
/** Внутри группы тэгов — «или», между группами — «и». */
function matches(r, by, q) {
  for (const ids of Object.values(by)) if (!ids.some((id) => (r.tags || []).includes(id))) return false;
  if (q) {
    if (norm(r.name).includes(q)) return true;
    return (r.ingredients || []).some((x) => { const i = getIng(x.ing); return i && norm(i.name).includes(q); });
  }
  return true;
}
const filtering = () => ui.rec.filters.size > 0 || !!ui.rec.q.trim();

/** Элементы списка: одиночные рецепты и группы (с подходящими рецептами). */
function entries() {
  const by = activeByGroup();
  const q = norm(ui.rec.q).trim();
  const recipes = store.list('recipes');
  const ok = new Set(recipes.filter((r) => matches(r, by, q)).map((r) => r.id));
  const out = [];
  for (const g of store.list('groups')) {
    const all = members(g.id);
    const shown = all.filter((r) => ok.has(r.id));
    if (shown.length || (!filtering())) out.push({ group: g, all, shown });
  }
  for (const r of recipes) if (!r.groupId || !store.get('groups', r.groupId)) { if (ok.has(r.id)) out.push({ recipe: r }); }
  const key = (e) => {
    if (ui.rec.sort === 'kcal') {
      const list = e.recipe ? [e.recipe] : (e.shown.length ? e.shown : e.all);
      return list.length ? Math.min(...list.map((r) => pp(r).kcal)) : 1e9;
    }
    if (ui.rec.sort === 'new') {
      const list = e.recipe ? [e.recipe] : e.all;
      return -Math.max(0, ...list.map((r) => Date.parse(r.updatedAt || 0) || 0), Date.parse(e.group?.updatedAt || 0) || 0);
    }
    return 0;
  };
  const name = (e) => (e.recipe ? e.recipe.name : e.group.name);
  return out.sort((a, b) => key(a) - key(b) || name(a).localeCompare(name(b), 'ru'));
}

// ---------- страница ----------
export function page() {
  return `<main class="page rec-page">
    <aside class="filters" id="rec-filters" aria-label="Фильтры"></aside>
    <section class="rec-main">
      <div class="page-head">
        <div id="rec-title" class="title-wrap"></div>
        <span class="spacer"></span>
        <div class="seg only-wide" role="group" aria-label="Сортировка" id="rec-sort"></div>
        <label class="search">${ICON.search}<span class="sr-only">Поиск рецепта</span><input id="rec-q" type="search" placeholder="Название или ингредиент" value="${esc(ui.rec.q)}" autocomplete="off"></label>
        <div id="rec-actions" class="head-actions"></div>
      </div>
      <div class="quick only-narrow" id="rec-quick"></div>
      <div class="rec-list" id="rec-list"></div>
    </section>
    <div id="rec-bar"></div>
  </main>`;
}

export function refresh() {
  if (!$('#rec-list')) return;
  renderHead();
  $('#rec-filters').innerHTML = filtersView();
  renderList();
}

function renderHead() {
  const sel = ui.rec.select;
  const tgt = ui.rec.target && store.get('groups', ui.rec.target);
  $('#rec-title').innerHTML = `<h1>Рецепты</h1>${sel
    ? `<span class="count">${tgt ? 'добавить в группу «' + esc(tgt.name) + '»' : 'режим выбора'}</span>`
    : `<span class="count" id="rec-count"></span>`}`;
  const sb = (v, l) => `<button data-a="rec-sort" data-v="${v}" aria-pressed="${ui.rec.sort === v}">${l}</button>`;
  $('#rec-sort').innerHTML = sb('name', 'по названию') + sb('kcal', 'по калориям') + sb('new', 'новые');
  $('#rec-actions').innerHTML = sel
    ? `<button class="btn dark" data-a="rec-select-done">Готово</button>`
    : `<button class="btn" data-a="rec-select">Выбрать</button><button class="btn acc" data-a="rec-new" aria-label="Новый рецепт"><span class="plus">+</span><span class="only-wide">&nbsp;Рецепт</span></button>`;
  const meals = tagsOf('meal');
  $('#rec-quick').innerHTML = `<button class="chip dark-chip" data-a="rec-filters-open">Фильтры · ${ui.rec.filters.size}</button>` +
    meals.map((t) => `<button class="chip meal" style="--c:${MEAL_COLORS[t.id]}" data-a="rec-filter" data-id="${t.id}" aria-pressed="${ui.rec.filters.has(t.id)}">${esc(t.name)}</button>`).join('');
}

export function filtersView(sheet = false) {
  const recipes = store.list('recipes');
  const cnt = {};
  for (const r of recipes) for (const t of r.tags || []) cnt[t] = (cnt[t] || 0) + 1;
  const sb = (v, l) => `<button data-a="rec-sort" data-v="${v}" aria-pressed="${ui.rec.sort === v}">${l}</button>`;
  return `<div class="filters-head"><h2>Фильтры</h2>${ui.rec.filters.size ? '<button class="link" data-a="rec-filter-reset">сбросить</button>' : ''}</div>
    ${sheet ? `<div class="f-group"><h3>Сортировка</h3><div class="seg">${sb('name', 'по названию')}${sb('kcal', 'по калориям')}${sb('new', 'новые')}</div></div>` : ''}
    ${TAG_GROUPS.map((g) => {
      const tags = tagsOf(g.id).filter((t) => cnt[t.id] || ui.rec.filters.has(t.id));
      if (!tags.length) return '';
      return `<div class="f-group"><h3>${esc(g.name)}</h3><div class="f-chips">${tags.map((t) => {
        const c = MEAL_COLORS[t.id];
        return `<button class="chip${c ? ' meal' : ''}" ${c ? `style="--c:${c}"` : ''} data-a="rec-filter" data-id="${t.id}" aria-pressed="${ui.rec.filters.has(t.id)}">${esc(t.name)}<b>${cnt[t.id] || 0}</b></button>`;
      }).join('')}</div></div>`;
    }).join('')}
    <p class="hint">Внутри одной группы подходит любой из отмеченных тэгов, между группами — все сразу.</p>`;
}

function rowView(r, { inGroup = false, isDefault = false } = {}) {
  const v = pp(r);
  const sel = ui.rec.select;
  const disabled = sel && !!r.groupId && !!store.get('groups', r.groupId);
  const checked = ui.rec.selected.has(r.id);
  const check = sel ? `<span class="check${checked ? ' on' : ''}${disabled ? ' off' : ''}" aria-hidden="true">${checked ? '✓' : ''}</span>` : '';
  const act = sel ? (disabled ? '' : 'data-a="rec-toggle"') : 'data-a="rec-open"';
  const label = sel ? (disabled ? `${r.name}: уже в группе` : `Выбрать: ${r.name}`) : `Открыть рецепт: ${r.name}`;
  return `<button class="rec-row${inGroup ? ' sub' : ''}${checked ? ' picked' : ''}" ${act} data-id="${esc(r.id)}" ${disabled ? 'disabled' : ''} aria-label="${esc(label)}" ${sel && !disabled ? `aria-pressed="${checked}"` : ''}>
    <span class="r-name">${check}<span class="nm">${esc(r.name)}</span>${isDefault ? '<span class="chip-s dark">по умолчанию</span>' : ''}</span>
    <span class="r-tags">${rowTags(r)}</span>
    <span class="r-kcal">${fmt(v.kcal)}</span>
    <span class="r-bju">Б ${fmt(v.p)} · Ж ${fmt(v.f)} · У ${fmt(v.c)}</span>
    <span class="r-serv">${fmt(r.servings, 1)} порц.</span>
    <span class="r-meta only-narrow">${mealDots(r)}<span>Б ${fmt(v.p)} · Ж ${fmt(v.f)} · У ${fmt(v.c)} · ${fmt(r.servings, 1)} порц.</span></span>
  </button>`;
}

function groupView(e) {
  const g = e.group;
  const f = filtering();
  const open = f ? (e.shown.length > 0 && !ui.rec.collapsed.has(g.id)) : ui.rec.expanded.has(g.id);
  const list = f ? e.shown : e.all;
  const kc = e.all.map((r) => pp(r).kcal);
  const range = kc.length ? (Math.round(Math.min(...kc)) === Math.round(Math.max(...kc)) ? fmt(kc[0]) : fmt(Math.min(...kc)) + '–' + fmt(Math.max(...kc))) : '—';
  const cnt = f ? `${e.shown.length} из ${e.all.length}` : `группа · ${e.all.length}`;
  const firstId = e.all[0]?.id;
  return `<div class="rec-group${open ? ' open' : ''}">
    <div class="g-head">
      <button class="g-toggle" data-a="rec-expand" data-id="${esc(g.id)}" aria-expanded="${open}">
        <span class="caret" aria-hidden="true">${open ? ICON.up : ICON.down}</span>
        <span class="g-name">${esc(g.name)}</span><span class="chip-s dark">${cnt}</span>
        <span class="g-kcal">${range}</span>
      </button>
      <button class="btn icon sm dark" data-a="grp-menu" data-id="${esc(g.id)}" aria-label="Меню группы «${esc(g.name)}»">•••</button>
    </div>
    ${open ? `<div class="g-list">${list.length ? list.map((r) => rowView(r, { inGroup: true, isDefault: r.id === firstId })).join('') : '<p class="hint g-empty">В группе нет рецептов. Добавьте рецепты через меню ••• или расформируйте группу.</p>'}</div>` : ''}
  </div>`;
}

export function renderList() {
  const el = $('#rec-list');
  if (!el) return;
  const items = entries();
  const nShown = items.reduce((s, e) => s + (e.recipe ? 1 : e.shown.length), 0);
  const total = store.list('recipes').length;
  const c = $('#rec-count');
  if (c) c.textContent = filtering() ? `${nShown} из ${total}` : String(total);
  const head = `<div class="rec-row rec-head" aria-hidden="true"><span class="r-name">название</span><span class="r-tags">тэги</span><span class="r-kcal">ккал · порция</span><span class="r-bju">БЖУ, г</span><span class="r-serv">выход</span></div>`;
  el.innerHTML = items.length
    ? head + items.map((e) => (e.recipe ? rowView(e.recipe) : groupView(e))).join('')
    : `<div class="empty">Ничего не нашлось${filtering() ? '<br><button class="btn sm" data-a="rec-filter-reset">Сбросить фильтры и поиск</button>' : ''}</div>`;
  renderBar();
}

function renderBar() {
  const bar = $('#rec-bar');
  if (!bar) return;
  if (!ui.rec.select) { bar.innerHTML = ''; return; }
  const n = ui.rec.selected.size;
  const tgt = ui.rec.target && store.get('groups', ui.rec.target);
  const lbl = `Выбрано ${n} ${plural(n, 'рецепт', 'рецепта', 'рецептов')}`;
  bar.innerHTML = `<div class="sel-bar" role="region" aria-label="Выбранные рецепты"><span class="sel-n">${lbl}</span>
    ${tgt
      ? `<button class="btn acc" data-a="rec-sel-add-target" ${n ? '' : 'disabled'}>Добавить в «${esc(tgt.name)}»</button>`
      : `<button class="btn acc" data-a="rec-sel-group" ${n >= 2 ? '' : 'disabled'} title="Выберите хотя бы два рецепта">Объединить в группу</button>
         <button class="btn dark-soft" data-a="rec-sel-pick" ${n ? '' : 'disabled'}>Добавить в группу…</button>`}
    <button class="btn ghost-dark" data-a="rec-select-done">Отмена</button></div>`;
}

// ---------- лист фильтров на телефоне ----------
export function filtersSheet() {
  const n = entries().reduce((s, e) => s + (e.recipe ? 1 : e.shown.length), 0);
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="Фильтры">
    <div class="sheet-body filters" data-scroll="filters">${filtersView(true)}</div>
    <div class="dlg-foot"><button class="btn acc" data-a="layer-close">Показать ${n} ${plural(n, 'рецепт', 'рецепта', 'рецептов')}</button></div>
  </section>`;
}

// ---------- действия ----------
const exitSelect = () => { ui.rec.select = false; ui.rec.selected.clear(); ui.rec.target = null; };

actions['rec-sort'] = (t) => { ui.rec.sort = t.dataset.v; refresh(); hooks.refreshLayers(); };
actions['rec-filter'] = (t) => {
  const id = t.dataset.id;
  if (ui.rec.filters.has(id)) ui.rec.filters.delete(id); else ui.rec.filters.add(id);
  refresh(); hooks.refreshLayers();
};
actions['rec-filter-reset'] = () => { ui.rec.filters.clear(); ui.rec.q = ''; const q = $('#rec-q'); if (q) q.value = ''; refresh(); hooks.refreshLayers(); };
actions['rec-filters-open'] = () => openLayer({ type: 'filters' });
actions['rec-expand'] = (t) => {
  const id = t.dataset.id;
  // без фильтров группа раскрывается вручную; при фильтрации раскрыта, пока её не свернули
  const set = filtering() ? ui.rec.collapsed : ui.rec.expanded;
  if (set.has(id)) set.delete(id); else set.add(id);
  renderList();
  const b = $(`[data-a="rec-expand"][data-id="${CSS.escape(id)}"]`); if (b) b.focus();
};
actions['rec-open'] = (t) => openLayer({ type: 'recipe', id: t.dataset.id, mode: 'view' });
actions['rec-select'] = () => { ui.rec.select = true; ui.rec.selected.clear(); ui.rec.target = null; refresh(); };
actions['rec-select-done'] = () => { exitSelect(); refresh(); };
actions['rec-toggle'] = (t) => {
  const id = t.dataset.id;
  if (ui.rec.selected.has(id)) ui.rec.selected.delete(id); else ui.rec.selected.add(id);
  renderList();
  const b = $(`[data-a="rec-toggle"][data-id="${CSS.escape(id)}"]`); if (b) b.focus();
};
actions['rec-sel-group'] = () => {
  const ids = [...ui.rec.selected];
  if (ids.length < 2) return;
  const first = store.get('recipes', ids[0]);
  openLayer({ type: 'dialog', kind: 'group-new', recipeIds: ids, sourceId: null, groupName: first.name, fromSelection: true });
};
actions['rec-sel-pick'] = () => openLayer({ type: 'dialog', kind: 'group-pick', recipeIds: [...ui.rec.selected] });
actions['rec-sel-add-target'] = async () => {
  const g = store.get('groups', ui.rec.target);
  await addToGroup(ui.rec.target, [...ui.rec.selected]);
  ui.rec.expanded.add(g.id);
  exitSelect();
  showToast('Добавлено в группу «' + g.name + '»');
  refresh();
};

export function onInput(e) {
  if (e.target.id === 'rec-q') { ui.rec.q = e.target.value; renderList(); return true; }
  return false;
}
