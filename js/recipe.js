// Рецепт в боковой панели: просмотр (11A / 11F) и правка на месте (11B / 11G).
import * as store from './store.js';
import { TAG_GROUPS } from './config.js';
import { ui, actions, hooks, openLayer, closeLayer, topLayer, findLayer, pref, setPref } from './ui.js';
import { $, $$, esc, norm, fmt, plural, parseNum, showToast, ICON, MEAL_COLORS } from './util.js';
import { totals, autoTags, tagDiff, applyAuto, RULE_TAGS } from './nutrition.js';
import { members, deleteRecipe } from './groups.js';
import { sortedTags, tagChip, tagsOf } from './recipes.js';

const getIng = (id) => store.get('ingredients', id);
const auto = (r) => autoTags(r, getIng);
const fmtG = (g) => fmt(g, g < 10 ? 1 : 0);
const halfUp = (n) => Math.max(0.5, Math.ceil(n * 2 - 1e-9) / 2);
const numStr = (n) => (n == null || n === '' ? '' : String(Math.round(n * 100) / 100).replace('.', ','));
const editLayer = () => findLayer('recipe');

// ================= просмотр =================
function shortName(name, group) {
  if (!group) return name;
  const g = norm(group.name).trim();
  const n = norm(name);
  if (g && n.startsWith(g)) { const rest = name.slice(group.name.trim().length).replace(/^[\s·—–:,-]+/, '').trim(); if (rest) return rest; }
  return name;
}

function amountText(it, div) {
  const x = getIng(it.ing);
  const g = (Number(it.g) || 0) / div;
  if (x && x.unitWeight) {
    const pcs = g / x.unitWeight, un = esc(x.unitName || 'шт');
    if (it.unit === 'pc') return `${fmt(pcs, 2)} ${un} <span class="hint">· ${fmtG(g)} г</span>`;
    return `${fmtG(g)} г <span class="hint">≈ ${fmt(halfUp(pcs), 1)} ${un}</span>`;
  }
  return `${fmtG(g)} г`;
}

function viewMode(l) {
  const r = store.get('recipes', l.id);
  if (!r) {
    return `<section class="drawer rec-view" role="dialog" aria-modal="true" aria-label="Рецепт">
      <header><h2>Рецепт удалён</h2><button class="btn icon" data-a="layer-close" aria-label="Закрыть">×</button></header>
      <div class="body"><p class="hint">Этот рецепт удалили — возможно, на другом устройстве.</p></div></section>`;
  }
  const g = r.groupId ? store.get('groups', r.groupId) : null;
  const mem = g ? members(g.id) : [];
  const serv = Number(r.servings) || 1;
  const per = ui.rec.perPortion;
  const div = per ? serv : 1;
  const t = totals(r, getIng);
  const collapsed = pref('ingCollapsed', false);
  const diff = tagDiff(r.tags, auto(r));
  const tags = sortedTags(r.tags);
  const nIng = (r.ingredients || []).length;
  const tile = (lbl, v, dark = false) => `<div class="tile${dark ? ' dark' : ''}"><span>${lbl}</span><b>${v}</b></div>`;
  return `<section class="drawer rec-view" role="dialog" aria-modal="true" aria-labelledby="rv-title">
    <header class="rv-head">
      <button class="btn icon only-narrow" data-a="layer-close" aria-label="Назад">←</button>
      ${g ? `<div class="grp-line"><span class="lbl only-wide">группа</span>
        <button class="chip-s dark" data-a="grp-menu" data-id="${esc(g.id)}">${esc(g.name)} · ${mem.length}<span class="only-wide">&nbsp;${plural(mem.length, 'рецепт', 'рецепта', 'рецептов')}</span></button>
        <button class="btn icon sm" data-a="grp-menu" data-id="${esc(g.id)}" aria-label="Меню группы «${esc(g.name)}»">•••</button></div>` : ''}
      <span class="spacer"></span>
      <button class="btn dark only-narrow" data-a="rec-edit">Изменить</button>
      <button class="btn icon only-wide" data-a="layer-close" aria-label="Закрыть">×</button>
    </header>
    <div class="body" data-scroll="rv-${esc(r.id)}">
      ${g && mem.length > 1 ? `<div class="rv-tabs" role="tablist" aria-label="Рецепты группы">${mem.map((m, i) => `<button role="tab" data-a="rec-tab" data-id="${esc(m.id)}" aria-selected="${m.id === r.id}">${esc(shortName(m.name, g))}${i === 0 ? ' <small>по умолч.</small>' : ''}<span>${fmt(totals(m, getIng).kcal / (Number(m.servings) || 1))}</span></button>`).join('')}</div>` : ''}
      <h2 id="rv-title" class="rv-title">${esc(r.name)}</h2>
      <div class="rv-tags">${tags.map((x) => tagChip(x)).join('')}${!tags.length ? '<span class="hint">без тэгов</span>' : ''}
        ${diff.same ? '' : `<button class="tag-link" data-a="rec-tags-compare">≠ автотэги · сравнить</button>`}</div>
      <div class="rv-kbju">
        <div class="seg sm" role="group" aria-label="КБЖУ и ингредиенты"><button data-a="rec-portion" data-v="1" aria-pressed="${per}">на 1 порцию</button><button data-a="rec-portion" data-v="0" aria-pressed="${!per}">на весь рецепт</button></div>
        <div class="tiles">${tile('ккал', fmt(t.kcal / div), true)}${tile('белки', fmt(t.p / div))}${tile('жиры', fmt(t.f / div))}${tile('углеводы', fmt(t.c / div))}${tile('клетчатка', fmt(t.fib / div, 1))}</div>
      </div>
      <div class="ing-box${collapsed ? '' : ' open'}">
        <button class="ing-toggle" data-a="rec-ing-toggle" aria-expanded="${!collapsed}">
          <span><b>Ингредиенты</b> · ${nIng} · рецепт на ${fmt(serv, 1)} ${plural(Math.ceil(serv), 'порцию', 'порции', 'порций')}</span>
          <span class="more">${collapsed ? 'развернуть' : 'свернуть'} ${collapsed ? ICON.down : ICON.up}</span></button>
        ${collapsed ? '' : `<div class="ing-list"><p class="hint">${per ? 'количество на 1 порцию' : 'количество на весь рецепт'}</p>${(r.ingredients || []).map((it) => {
          const x = getIng(it.ing);
          return `<div class="ing-line"><span>${x ? esc(x.name) : '<i class="hint">удалённый ингредиент</i>'}</span><span class="amt">${amountText(it, div)}</span></div>`;
        }).join('') || '<p class="hint">Ингредиентов нет</p>'}</div>`}
      </div>
      ${r.desc ? `<p class="rv-desc">${esc(r.desc)}</p>` : ''}
      <h3 class="rv-sub">Приготовление · ${r.steps.length} ${plural(r.steps.length, 'шаг', 'шага', 'шагов')}</h3>
      ${r.steps.length ? `<ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '<p class="hint">Шагов пока нет. Нажмите «Изменить», чтобы добавить.</p>'}
    </div>
    <footer>
      <button class="btn dark only-wide" data-a="rec-edit">Изменить</button>
      <button class="btn" data-a="rec-variant">Сделать вариант</button>
      <button class="btn" disabled title="Появится в версии 0.3">В план · v0.3</button>
      <span class="spacer"></span>
      <button class="btn danger" data-a="rec-del">Удалить</button>
    </footer>
  </section>`;
}

// ================= правка =================
function makeDraft(r) {
  return {
    id: r.id, name: r.name || '', servings: numStr(r.servings), desc: r.desc || '',
    ingredients: (r.ingredients || []).map((it) => {
      const x = getIng(it.ing);
      const pc = it.unit === 'pc' && x && x.unitWeight;
      return { ing: it.ing, unit: pc ? 'pc' : 'g', qty: numStr(pc ? it.g / x.unitWeight : it.g) };
    }),
    steps: [...(r.steps || [])], tags: [...(r.tags || [])],
  };
}
const clone = (d) => JSON.parse(JSON.stringify(d));

function grams(it) {
  const n = parseNum(it.qty);
  if (n == null || isNaN(n)) return 0;
  if (it.unit === 'pc') { const x = getIng(it.ing); return x && x.unitWeight ? n * x.unitWeight : 0; }
  return n;
}
/** Черновик → вид рецепта для расчётов. */
function asRecipe(d) {
  const s = parseNum(d.servings);
  return { servings: s && s > 0 ? s : 1, ingredients: d.ingredients.map((it) => ({ ing: it.ing, g: grams(it) })) };
}

function changedCount(l) {
  const a = l.draft, b = l.orig;
  const st = (x) => JSON.stringify(x.steps.map((s) => s.trim()).filter(Boolean));
  let n = 0;
  if (a.name.trim() !== b.name.trim()) n++;
  if (String(a.servings).trim() !== String(b.servings).trim()) n++;
  if (a.desc.trim() !== b.desc.trim()) n++;
  if (JSON.stringify(a.ingredients) !== JSON.stringify(b.ingredients)) n++;
  if (st(a) !== st(b)) n++;
  if ([...a.tags].sort().join() !== [...b.tags].sort().join()) n++;
  return n;
}

function statusText(l) {
  if (l.variantOf) { const s = store.get('recipes', l.variantOf); return 'Новый вариант' + (s ? ' «' + esc(s.name) + '»' : ''); }
  if (l.isNew) return 'Новый рецепт';
  const n = changedCount(l);
  return 'Правка рецепта · ' + (n ? `изменено ${n} ${plural(n, 'поле', 'поля', 'полей')}` : 'без изменений');
}

function sumView(l) {
  const t = totals(asRecipe(l.draft), getIng);
  const s = asRecipe(l.draft).servings;
  return `<span class="lbl">на 1 порцию</span><b>${fmt(t.kcal / s)}</b><span>ккал</span>
    <span class="bju">Б ${fmt(t.p / s)} · Ж ${fmt(t.f / s)} · У ${fmt(t.c / s)} · кл ${fmt(t.fib / s, 1)}</span>`;
}

function convText(it) {
  const x = getIng(it.ing);
  if (!x || !x.unitWeight) return '';
  const g = grams(it);
  if (!g) return '';
  return it.unit === 'pc' ? `= ${fmtG(g)} г` : `≈ ${fmt(halfUp(g / x.unitWeight), 1)} ${esc(x.unitName || 'шт')}`;
}

function ingsView(l) {
  const rows = l.draft.ingredients.map((it, i) => {
    const x = getIng(it.ing);
    const name = x ? x.name : 'удалённый ингредиент';
    return `<div class="ed-ing">
      <span class="n">${esc(name)}<small id="conv-${i}">${convText(it)}</small></span>
      <input class="qty" data-f="qty" data-i="${i}" inputmode="decimal" value="${esc(it.qty)}" aria-label="Количество: ${esc(name)}" autocomplete="off">
      <div class="seg sm unit" role="group" aria-label="Единица: ${esc(name)}">
        <button data-a="ed-unit" data-i="${i}" data-v="g" aria-pressed="${it.unit === 'g'}">г</button>
        <button data-a="ed-unit" data-i="${i}" data-v="pc" aria-pressed="${it.unit === 'pc'}" ${x && x.unitWeight ? '' : 'disabled title="У ингредиента не указан вес штуки"'}>${esc((x && x.unitName) || 'шт')}</button>
      </div>
      <button class="btn icon sm" data-a="ed-ing-rm" data-i="${i}" aria-label="Убрать: ${esc(name)}">×</button>
    </div>`;
  }).join('');
  return `<h3 class="sec-title">Ингредиенты на весь рецепт</h3>${rows || '<p class="hint">Добавьте ингредиенты через поиск ниже.</p>'}
    <div class="ing-add"><label class="search dashed">${ICON.search}<span class="sr-only">Добавить ингредиент</span>
      <input id="ed-ing-q" placeholder="+ ингредиент" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="ed-sugg" aria-autocomplete="list"></label>
      <div id="ed-sugg" class="sugg" role="listbox" aria-label="Ингредиенты"></div></div>`;
}

function stepsView(l) {
  const s = l.draft.steps;
  return `<h3 class="sec-title">Приготовление · порядок меняется перетаскиванием за ${ICON.grip}</h3>
    <ol class="steps-ed">${s.map((x, i) => `<li class="step-ed" data-i="${i}">
      <button class="grip" data-grip="${i}" aria-label="Шаг ${i + 1}: перетащите или нажимайте стрелки вверх и вниз">${ICON.grip}</button>
      <span class="num">${i + 1}</span>
      <textarea data-f="step" data-i="${i}" rows="1" aria-label="Текст шага ${i + 1}" placeholder="Что сделать на этом шаге">${esc(x)}</textarea>
      <button class="btn icon sm" data-a="ed-step-rm" data-i="${i}" aria-label="Удалить шаг ${i + 1}">×</button></li>`).join('')}</ol>
    <button class="btn ghost wide" data-a="ed-step-add">+ шаг</button>`;
}

function compareView(curTags, computed) {
  const cur = sortedTags(curTags.filter((t) => RULE_TAGS.has(t)));
  const d = tagDiff(curTags, computed);
  const comp = sortedTags([...computed, ...d.remove]);
  return `<div class="cmp">
    <div><h4>Сейчас в рецепте</h4><div class="chips-w">${cur.map((t) => tagChip(t)).join('') || '<span class="hint">нет</span>'}</div></div>
    <div><h4>По расчёту</h4><div class="chips-w">${comp.map((t) => {
      if (d.add.includes(t.id)) return `<span class="tag add" title="добавится">+ ${esc(t.name)}</span>`;
      if (d.remove.includes(t.id)) return `<span class="tag rm" title="снимется"><s>${esc(t.name)}</s></span>`;
      return tagChip(t);
    }).join('') || '<span class="hint">нет</span>'}</div></div></div>`;
}

function tagsView(l) {
  const d = l.draft;
  const open = l.tagsOpen || l.tab === 'tags';
  if (!open) {
    const all = sortedTags(d.tags);
    return `<div class="tags-bar"><b>Тэги</b><div class="chips-w">${all.slice(0, 6).map((t) => tagChip(t)).join('')}${all.length > 6 ? `<span class="hint">+ ещё ${all.length - 6}</span>` : ''}${!all.length ? '<span class="hint">нет</span>' : ''}</div>
      <button class="btn sm" data-a="ed-tags-toggle" aria-expanded="false">Тэги и автотэги ${ICON.down}</button></div>`;
  }
  const groups = TAG_GROUPS.map((g) => {
    const mine = sortedTags(d.tags).filter((t) => t.group === g.id);
    return `<div class="tg"><span class="tg-name">${esc(g.name)}</span><div class="chips-w">
      ${mine.map((t) => tagChip(t, `<button data-a="ed-tag-rm" data-id="${esc(t.id)}" aria-label="Снять тэг «${esc(t.name)}»">×</button>`)).join('')}
      <button class="chip add" data-a="ed-tag-add" data-g="${g.id}">+ тэг</button></div></div>`;
  }).join('');
  let autoBlock;
  if (l.isNew) {
    autoBlock = `<label class="check-line"><input type="checkbox" id="ed-auto" ${l.autoCalc ? 'checked' : ''}> Посчитать автотэги при сохранении</label>
      <p class="hint">Тэги питательной ценности и групп ингредиентов проставятся по составу. Потом их можно снять или добавить вручную.</p>`;
  } else {
    const computed = auto(asRecipe(d));
    const diff = tagDiff(d.tags, computed);
    if (diff.same) autoBlock = '<p class="hint ok">✓ Автотэги совпадают с расчётом по составу.</p>';
    else if (l.keepTags) autoBlock = `<p class="hint">Тэги отличаются от расчёта по составу. <button class="link" data-a="ed-tags-accept">Пересчитать автоматически</button></p>`;
    else autoBlock = `<p class="hint"><b>Автотэги отличаются от расчёта по составу.</b> Сравниваются только тэги с правилами (питательная ценность и группы ингредиентов).</p>
      ${compareView(d.tags, computed)}
      <div class="cmp-foot"><button class="btn sm" data-a="ed-tags-keep">Оставить как есть</button><button class="btn sm dark" data-a="ed-tags-accept">Принять расчёт</button></div>`;
  }
  return `<div class="tags-head"><h3 class="sec-title">Тэги</h3>${l.tab === 'tags' ? '' : `<button class="btn sm" data-a="ed-tags-toggle" aria-expanded="true">свернуть ${ICON.up}</button>`}</div>
    ${groups}<div class="auto-box">${autoBlock}</div>`;
}

function editMode(l) {
  const d = l.draft;
  const tab = (v, lbl) => `<button role="tab" data-a="ed-tab" data-v="${v}" aria-selected="${l.tab === v}">${lbl}</button>`;
  return `<section class="drawer wide rec-edit" data-tab="${l.tab}" role="dialog" aria-modal="true" aria-label="Правка рецепта">
    <div class="edit-bar"><span class="dot" aria-hidden="true"></span><span id="ed-status" class="st">${statusText(l)}</span><span class="spacer"></span>
      <button class="btn dark-soft" data-a="rec-cancel">Отмена</button><button class="btn acc" data-a="rec-save">Сохранить</button></div>
    <div class="ed-tabs only-narrow" role="tablist" aria-label="Разделы рецепта">${tab('main', 'Основное')}${tab('ings', 'Ингредиенты')}${tab('steps', 'Шаги')}${tab('tags', 'Тэги')}</div>
    <p class="err ed-err" id="ed-err" role="alert"></p>
    <div class="body ed-grid" data-scroll="ed">
      <div class="ed-main" data-tab="main">
        <label class="field"><span>Название рецепта</span><input data-f="name" value="${esc(d.name)}" autocomplete="off" ${l.isNew ? 'data-autofocus' : ''}></label>
        <label class="field serv"><span>Порций в рецепте</span><input data-f="servings" inputmode="decimal" value="${esc(d.servings)}" autocomplete="off"></label>
      </div>
      <div class="ed-sum" id="ed-sum" data-tab="main ings">${sumView(l)}</div>
      <div class="ed-ings panel" id="ed-ings" data-tab="ings">${ingsView(l)}</div>
      <label class="field ed-desc" data-tab="main"><span>Описание (необязательно)</span><textarea data-f="desc" rows="2" placeholder="Коротко о блюде">${esc(d.desc)}</textarea></label>
      <div class="ed-steps" id="ed-steps" data-tab="steps">${stepsView(l)}</div>
      <div class="ed-tags panel" id="ed-tags" data-tab="tags">${tagsView(l)}</div>
    </div>
  </section>`;
}

export function view(l) { return l.mode === 'edit' ? editMode(l) : viewMode(l); }

// ---------- частичные обновления ----------
export function autosize(root = document) {
  $$('textarea[data-f]', root).forEach((t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; });
}
function section(name, l) {
  const el = $('#ed-' + name);
  if (!el) return;
  el.innerHTML = { ings: ingsView, steps: stepsView, tags: tagsView, sum: sumView }[name](l);
  if (name === 'steps') autosize(el);
}
let lastTagSig = '';
function live(l) {
  const st = $('#ed-status'); if (st) st.innerHTML = statusText(l);
  section('sum', l);
  l.draft.ingredients.forEach((it, i) => { const c = $('#conv-' + i); if (c) c.innerHTML = convText(it); });
  if (!l.isNew) {
    const sig = [...auto(asRecipe(l.draft))].sort().join();
    const tagsEl = $('#ed-tags');
    if (sig !== lastTagSig && tagsEl && !tagsEl.contains(document.activeElement)) { lastTagSig = sig; section('tags', l); }
  }
}

// ---------- сохранение ----------
async function save(l) {
  const d = l.draft;
  const err = $('#ed-err');
  $$('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
  const bad = (sel, tabName, msg) => {
    if (l.tab !== tabName && window.matchMedia('(max-width: 860px)').matches) { l.tab = tabName; hooks.renderOverlay(); }
    const i = $(sel); if (i) { i.setAttribute('aria-invalid', 'true'); i.focus(); }
    const e = $('#ed-err'); if (e) e.textContent = msg;
  };
  if (err) err.textContent = '';
  const name = d.name.trim();
  if (!name) return bad('[data-f="name"]', 'main', 'Введите название рецепта.');
  const serv = parseNum(d.servings);
  if (serv == null || isNaN(serv) || serv <= 0) return bad('[data-f="servings"]', 'main', 'Порций в рецепте — число больше 0.');
  for (let i = 0; i < d.ingredients.length; i++) {
    const n = parseNum(d.ingredients[i].qty);
    if (n == null || isNaN(n) || n <= 0) return bad(`[data-f="qty"][data-i="${i}"]`, 'ings', 'Укажите количество больше 0 для каждого ингредиента.');
  }
  const base = l.isNew ? {} : (store.get('recipes', l.id) || {});
  const rec = {
    ...base, id: d.id, name, servings: serv, desc: d.desc.trim(),
    ingredients: d.ingredients.map((it) => ({ ing: it.ing, g: Math.round(grams(it) * 100) / 100, unit: it.unit })),
    steps: d.steps.map((s) => s.trim()).filter(Boolean),
    tags: [...new Set(d.tags)],
    groupId: base.groupId ?? null,
    custom: l.isNew ? true : !!base.custom,
  };
  const cb = $('#ed-auto');
  if (l.isNew && (cb ? cb.checked : l.autoCalc)) rec.tags = applyAuto(rec.tags, auto(rec));
  if (l.variantOf) {
    const src = store.get('recipes', l.variantOf);
    const g = src && src.groupId ? store.get('groups', src.groupId) : null;
    if (g) {
      rec.groupId = g.id;
      const order = [...members(g.id).map((r) => r.id), rec.id];
      await store.putAll([{ coll: 'recipes', rec }, { coll: 'groups', rec: { ...g, order } }]);
      showToast('Вариант добавлен в группу «' + g.name + '»');
    } else if (src) {
      openLayer({ type: 'dialog', kind: 'group-new', draft: rec, sourceId: src.id, recipeIds: [src.id, rec.id], groupName: src.name, openAfter: rec.id });
      return;
    } else {
      await store.put('recipes', rec);
      showToast('Рецепт «' + name + '» сохранён');
    }
  } else {
    await store.put('recipes', rec);
    showToast((l.isNew ? 'Добавлен' : 'Сохранён') + ' рецепт «' + name + '»');
  }
  toView(l, rec.id);
}

function toView(l, id) {
  l.mode = 'view'; l.id = id;
  delete l.draft; delete l.orig; delete l.variantOf; delete l.isNew;
  hooks.renderOverlay(); hooks.refreshPage();
}

function leaveEdit(l) {
  if (l.variantOf) return toView(l, l.variantOf);
  if (l.isNew) { ui.layers = ui.layers.filter((x) => x !== l); hooks.renderOverlay(); return; }
  toView(l, l.id);
}

function startEdit(l, draft, extra = {}) {
  Object.assign(l, { mode: 'edit', draft, orig: clone(draft), tab: 'main', tagsOpen: false, keepTags: false, autoCalc: true }, extra);
  lastTagSig = '';
  hooks.renderOverlay();
}

export function newRecipe() {
  const draft = { id: store.newId('rec'), name: '', servings: '1', desc: '', ingredients: [], steps: [''], tags: [] };
  const l = { type: 'recipe', id: draft.id };
  startEdit(l, draft, { isNew: true });
  openLayer(l);
}

// ---------- диалоги тэгов ----------
export function dialogView(l) {
  if (l.kind === 'tag-pick') {
    const g = TAG_GROUPS.find((x) => x.id === l.group);
    return `<section class="dialog small" role="dialog" aria-modal="true" aria-labelledby="tp-title"><div class="dlg-body">
      <h2 id="tp-title">Тэги: ${esc(g.name.toLowerCase())}</h2>
      <label class="search">${ICON.search}<span class="sr-only">Найти тэг</span><input id="tag-q" value="${esc(l.q || '')}" placeholder="${g.locked ? 'Найти тэг' : 'Найти или создать тэг'}" autocomplete="off" data-autofocus></label>
      <div id="tag-list" class="chips-w pick">${tagPickList(l)}</div>
      ${g.locked ? '<p class="hint">В группу «Время приёма» новые тэги добавлять нельзя — она совпадает со слотами плана.</p>' : ''}
    </div><div class="dlg-foot"><button class="btn dark" data-a="layer-close">Готово</button></div></section>`;
  }
  if (l.kind === 'tag-compare') {
    const r = store.get('recipes', l.id);
    if (!r) return '';
    return `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="tc-title"><div class="dlg-body">
      <h2 id="tc-title">Автотэги «${esc(r.name)}»</h2>
      <p class="hint">Тэги питательной ценности и групп ингредиентов отличаются от расчёта по составу. Зелёные добавятся, зачёркнутые снимутся. Остальные тэги не меняются.</p>
      ${compareView(r.tags, auto(r))}</div>
      <div class="dlg-foot"><button class="btn" data-a="layer-close">Оставить как есть</button><button class="btn dark" data-a="rv-tags-accept">Принять расчёт</button></div></section>`;
  }
  return '';
}

function tagPickList(l) {
  const ed = editLayer();
  const have = new Set(ed ? ed.draft.tags : []);
  const q = norm(l.q || '').trim();
  const g = TAG_GROUPS.find((x) => x.id === l.group);
  const list = tagsOf(l.group).filter((t) => !q || norm(t.name).includes(q));
  const exact = tagsOf(l.group).some((t) => norm(t.name) === q);
  return list.map((t) => {
    const c = MEAL_COLORS[t.id];
    return `<button class="chip${c ? ' meal' : ''}" ${c ? `style="--c:${c}"` : ''} data-a="tag-toggle" data-id="${esc(t.id)}" aria-pressed="${have.has(t.id)}">${have.has(t.id) ? '✓ ' : ''}${esc(t.name)}</button>`;
  }).join('') + (q && !exact && !g.locked ? `<button class="chip add" data-a="tag-create">+ Создать тэг «${esc(l.q.trim())}»</button>` : '') +
    (!list.length && (g.locked || !q) ? '<span class="hint">Ничего не нашлось</span>' : '');
}

// ---------- действия: просмотр ----------
actions['rec-tab'] = (t) => { const l = topLayer(); l.id = t.dataset.id; hooks.renderOverlay(); const b = $(`[data-a="rec-tab"][data-id="${CSS.escape(l.id)}"]`); if (b) { b.focus(); b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } };
actions['rec-portion'] = (t) => { ui.rec.perPortion = t.dataset.v === '1'; hooks.renderOverlay(); };
actions['rec-ing-toggle'] = () => { setPref('ingCollapsed', !pref('ingCollapsed', false)); hooks.renderOverlay(); const b = $('[data-a="rec-ing-toggle"]'); if (b) b.focus(); };
actions['rec-edit'] = () => { const l = topLayer(); const r = store.get('recipes', l.id); if (r) startEdit(l, makeDraft(r)); };
actions['rec-variant'] = () => {
  const l = topLayer(); const r = store.get('recipes', l.id); if (!r) return;
  const d = makeDraft(r);
  d.id = store.newId('rec'); d.name = r.name + ' — вариант';
  startEdit(l, d, { isNew: true, variantOf: r.id });
};
actions['rec-new'] = () => newRecipe();
actions['rec-del'] = () => {
  const l = topLayer(); const r = store.get('recipes', l.id); if (!r) return;
  const g = r.groupId && store.get('groups', r.groupId);
  openLayer({
    type: 'dialog', kind: 'confirm', title: 'Удалить «' + r.name + '»?', ok: 'Удалить', danger: true,
    text: g ? `Рецепт удалится из базы. Остальные рецепты группы «${g.name}» останутся.` : 'Рецепт удалится из базы.',
    onOk: async () => {
      ui.layers = ui.layers.filter((x) => x !== l);
      ui.rec.selected.delete(r.id);
      hooks.renderOverlay();
      await deleteRecipe(r.id);
      hooks.refreshPage();
    },
  });
};
actions['rec-tags-compare'] = () => { const l = topLayer(); openLayer({ type: 'dialog', kind: 'tag-compare', id: l.id }); };
actions['rv-tags-accept'] = async () => {
  const l = topLayer(); const r = store.get('recipes', l.id);
  closeLayer();
  if (r) { await store.put('recipes', { ...r, tags: applyAuto(r.tags, auto(r)) }); showToast('Автотэги пересчитаны'); hooks.refreshLayers(); hooks.refreshPage(); }
};

// ---------- действия: правка ----------
actions['rec-save'] = () => { const l = editLayer(); if (l && l.mode === 'edit') save(l); };
actions['rec-cancel'] = () => {
  const l = editLayer(); if (!l) return;
  if (changedCount(l) === 0) return leaveEdit(l);
  openLayer({ type: 'dialog', kind: 'confirm', title: l.isNew ? 'Не сохранять рецепт?' : 'Отменить правки?', text: 'Изменения не сохранятся.', ok: 'Не сохранять', danger: true, onOk: () => leaveEdit(l) });
};
actions['ed-tab'] = (t) => { const l = editLayer(); l.tab = t.dataset.v; hooks.renderOverlay(); const b = $(`[data-a="ed-tab"][data-v="${l.tab}"]`); if (b) b.focus(); };
actions['ed-unit'] = (t) => {
  const l = editLayer(); const it = l.draft.ingredients[Number(t.dataset.i)]; const v = t.dataset.v;
  if (!it || it.unit === v) return;
  const x = getIng(it.ing); const g = grams(it);
  if (v === 'pc' && x && x.unitWeight) it.qty = g ? numStr(g / x.unitWeight) : '';
  else it.qty = g ? numStr(g) : '';
  it.unit = v;
  section('ings', l); live(l);
  const b = $(`[data-a="ed-unit"][data-i="${t.dataset.i}"][data-v="${v}"]`); if (b) b.focus();
};
actions['ed-ing-rm'] = (t) => {
  const l = editLayer(); const i = Number(t.dataset.i);
  l.draft.ingredients.splice(i, 1);
  section('ings', l); live(l);
  const next = $(`[data-a="ed-ing-rm"][data-i="${Math.min(i, l.draft.ingredients.length - 1)}"]`) || $('#ed-ing-q'); if (next) next.focus();
};
function addIngredient(l, id) {
  l.draft.ingredients.push({ ing: id, unit: 'g', qty: '' });
  section('ings', l); live(l);
  const i = l.draft.ingredients.length - 1;
  const q = $(`[data-f="qty"][data-i="${i}"]`); if (q) q.focus();
}
actions['ed-ing-add'] = (t) => addIngredient(editLayer(), t.dataset.id);
actions['ed-ing-create'] = () => {
  const l = editLayer(); const q = ($('#ed-ing-q')?.value || '').trim();
  openLayer({ type: 'ingredient', id: 'new', prefill: q, onSaved: (rec) => addIngredient(l, rec.id) });
};
actions['ed-step-add'] = () => {
  const l = editLayer(); l.draft.steps.push('');
  section('steps', l); live(l);
  const ta = $$('[data-f="step"]'); if (ta.length) ta[ta.length - 1].focus();
};
actions['ed-step-rm'] = (t) => {
  const l = editLayer(); const i = Number(t.dataset.i);
  l.draft.steps.splice(i, 1);
  section('steps', l); live(l);
  const next = $(`[data-f="step"][data-i="${Math.min(i, l.draft.steps.length - 1)}"]`) || $('[data-a="ed-step-add"]'); if (next) next.focus();
};
actions['ed-tags-toggle'] = () => { const l = editLayer(); l.tagsOpen = !l.tagsOpen; section('tags', l); const b = $('[data-a="ed-tags-toggle"]'); if (b) b.focus(); };
actions['ed-tag-rm'] = (t) => { const l = editLayer(); l.draft.tags = l.draft.tags.filter((x) => x !== t.dataset.id); section('tags', l); live(l); };
actions['ed-tag-add'] = (t) => openLayer({ type: 'dialog', kind: 'tag-pick', group: t.dataset.g, q: '' });
actions['ed-tags-keep'] = () => { const l = editLayer(); l.keepTags = true; section('tags', l); };
actions['ed-tags-accept'] = () => {
  const l = editLayer(); l.draft.tags = applyAuto(l.draft.tags, auto(asRecipe(l.draft))); l.keepTags = false;
  section('tags', l); live(l); showToast('Автотэги пересчитаны по составу', 'info', 2500);
};
actions['tag-toggle'] = (t) => {
  const l = editLayer(); const id = t.dataset.id;
  l.draft.tags = l.draft.tags.includes(id) ? l.draft.tags.filter((x) => x !== id) : [...l.draft.tags, id];
  const box = $('#tag-list'); if (box) box.innerHTML = tagPickList(topLayer());
  section('tags', l); live(l);
  const b = $(`[data-a="tag-toggle"][data-id="${CSS.escape(id)}"]`); if (b) b.focus();
};
actions['tag-create'] = async () => {
  const pl = topLayer(); const l = editLayer();
  const name = (pl.q || '').trim(); if (!name) return;
  const g = TAG_GROUPS.find((x) => x.id === pl.group); if (!g || g.locked) return;
  const tag = { id: store.newId('tag'), name, group: g.id, auto: false, custom: true };
  await store.put('tags', tag);
  l.draft.tags.push(tag.id);
  pl.q = '';
  const inp = $('#tag-q'); if (inp) { inp.value = ''; inp.focus(); }
  const box = $('#tag-list'); if (box) box.innerHTML = tagPickList(pl);
  section('tags', l); live(l);
  showToast('Тэг «' + name + '» создан');
};

// ---------- ввод ----------
function renderSugg(q) {
  const box = $('#ed-sugg'); const inp = $('#ed-ing-q');
  if (!box) return;
  const nq = norm(q).trim();
  if (!nq) { box.innerHTML = ''; inp.setAttribute('aria-expanded', 'false'); return; }
  const all = store.list('ingredients');
  const list = all.filter((x) => norm(x.name).includes(nq))
    .sort((a, b) => (norm(a.name).startsWith(nq) ? 0 : 1) - (norm(b.name).startsWith(nq) ? 0 : 1) || a.name.localeCompare(b.name, 'ru')).slice(0, 8);
  const exact = all.some((x) => norm(x.name) === nq);
  box.innerHTML = list.map((x) => `<button role="option" class="opt" data-a="ed-ing-add" data-id="${esc(x.id)}"><span>${esc(x.name)}</span><span class="hint">${fmt(x.kcal * 100)} ккал / 100 г${x.unitWeight ? ' · 1 ' + esc(x.unitName || 'шт') + ' = ' + fmt(x.unitWeight) + ' г' : ''}</span></button>`).join('') +
    (exact ? '' : `<button class="opt create" data-a="ed-ing-create">+ Создать ингредиент «${esc(q.trim())}»</button>`);
  inp.setAttribute('aria-expanded', 'true');
}

export function onInput(e) {
  const t = e.target;
  if (t.id === 'ed-ing-q') { renderSugg(t.value); return true; }
  if (t.id === 'tag-q') { const pl = topLayer(); pl.q = t.value; const box = $('#tag-list'); if (box) box.innerHTML = tagPickList(pl); return true; }
  if (t.id === 'ed-auto') { const l = editLayer(); if (l) l.autoCalc = t.checked; return true; }
  const f = t.dataset && t.dataset.f;
  if (!f || !t.closest('.rec-edit')) return false;
  const l = editLayer(); if (!l || !l.draft) return false;
  const i = Number(t.dataset.i);
  if (f === 'name') l.draft.name = t.value;
  else if (f === 'servings') l.draft.servings = t.value;
  else if (f === 'desc') { l.draft.desc = t.value; autosize(t.parentElement); }
  else if (f === 'qty') l.draft.ingredients[i].qty = t.value;
  else if (f === 'step') { l.draft.steps[i] = t.value; t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }
  t.removeAttribute('aria-invalid');
  live(l);
  return true;
}

export function onKeydown(e) {
  const t = e.target;
  if (t.id === 'ed-ing-q') {
    if (e.key === 'Enter') { e.preventDefault(); const first = $('#ed-sugg .opt'); if (first) first.click(); return true; }
    if (e.key === 'ArrowDown') { e.preventDefault(); const first = $('#ed-sugg .opt'); if (first) first.focus(); return true; }
  }
  if (t.classList && t.classList.contains('opt') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const sib = e.key === 'ArrowDown' ? t.nextElementSibling : (t.previousElementSibling || $('#ed-ing-q'));
    if (sib) sib.focus();
    return true;
  }
  if (t.id === 'tag-q' && e.key === 'Enter') { e.preventDefault(); const c = $('[data-a="tag-create"]') || $('#tag-list [data-a="tag-toggle"]'); if (c) c.click(); return true; }
  if (t.dataset && t.dataset.grip != null && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const l = editLayer(); const i = Number(t.dataset.grip); const j = i + (e.key === 'ArrowUp' ? -1 : 1);
    const s = l.draft.steps; if (j < 0 || j >= s.length) return true;
    [s[i], s[j]] = [s[j], s[i]];
    section('steps', l); live(l);
    const g = $(`[data-grip="${j}"]`); if (g) g.focus();
    return true;
  }
  return false;
}

// ---------- перетаскивание шагов (мышь и палец) ----------
document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest && e.target.closest('[data-grip]');
  if (!grip || e.button > 0) return;
  const list = grip.closest('.steps-ed'); const item = grip.closest('.step-ed');
  const body = grip.closest('.body');
  if (!list || !item) return;
  e.preventDefault();
  // слушаем окно: при перестановке узла в DOM захват указателя теряется
  item.classList.add('dragging');
  let moved = false;
  const move = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    moved = true;
    const others = [...list.children].filter((x) => x !== item);
    let before = null;
    for (const it of others) { const r = it.getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { before = it; break; } }
    if (before) { if (item.nextElementSibling !== before) list.insertBefore(item, before); } else if (list.lastElementChild !== item) list.appendChild(item);
    if (body) { const br = body.getBoundingClientRect(); if (ev.clientY < br.top + 40) body.scrollTop -= 12; else if (ev.clientY > br.bottom - 40) body.scrollTop += 12; }
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    item.classList.remove('dragging');
    if (!moved) return;
    const l = editLayer(); if (!l) return;
    const order = [...list.children].map((x) => Number(x.dataset.i));
    l.draft.steps = order.map((i) => l.draft.steps[i]);
    section('steps', l); live(l);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
});
