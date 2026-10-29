// Добавление рецептов из файла (меню аккаунта → «Добавить рецепты из файла…»).
// Формат файла: { format: 'ration-recipes', version: 1, ingredients: [...], recipes: [...] }.
// Ничего не перезаписывает: ингредиенты, которые уже есть (тот же id или то же название), берутся из базы,
// рецепты с уже существующим названием пропускаются. Новое попадает в базу обычной записью и уходит на Диск синхронизацией.
import * as store from './store.js';
import { actions, openLayer, closeLayer, topLayer, closeAll } from './ui.js';
import { esc, norm, fmt, plural, showToast } from './util.js';
import { autoTags, applyAuto, perPortion } from './nutrition.js';

export function openImport() {
  closeAll();
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    try { openLayer({ type: 'dialog', kind: 'imp', plan: prepare(JSON.parse(await f.text())), file: f.name }); } catch (e) { showToast('Не получилось прочитать файл: ' + e.message, 'error', 8000); }
  };
  inp.click();
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Разобрать файл и посчитать, что добавится. */
export function prepare(data) {
  if (!data || data.format !== 'ration-recipes' || !Array.isArray(data.recipes)) throw new Error('это не файл рецептов «Рациона»');
  const ingByName = new Map(store.list('ingredients').map((x) => [norm(x.name).trim(), x]));
  const map = {}; const newIngs = []; const skippedIngs = [];
  for (const x of data.ingredients || []) {
    const have = store.get('ingredients', x.id) || ingByName.get(norm(x.name).trim());
    if (have) { map[x.id] = have.id; skippedIngs.push(have.name); continue; }
    const rec = { id: x.id || store.newId('ing'), name: String(x.name).trim(), kcal: num(x.kcal), p: num(x.p), f: num(x.f), c: num(x.c), fib: num(x.fib),
      unitWeight: x.unitWeight ? num(x.unitWeight) : null, unitName: x.unitWeight ? (x.unitName || 'шт') : null, group: x.group || null, category: x.category || '', custom: true };
    map[x.id] = rec.id; newIngs.push(rec);
  }
  const all = new Map([...store.list('ingredients').map((x) => [x.id, x]), ...newIngs.map((x) => [x.id, x])]);
  const getIng = (id) => all.get(id);
  const recNames = new Set(store.list('recipes').map((r) => norm(r.name).trim()));
  const newRecs = []; const skippedRecs = []; const broken = [];
  for (const r of data.recipes) {
    if (recNames.has(norm(r.name).trim())) { skippedRecs.push(r.name); continue; }
    const ingredients = (r.ingredients || []).map((it) => ({ ing: map[it.ing] || it.ing, g: num(it.g), unit: it.unit === 'pc' ? 'pc' : 'g' }));
    if (ingredients.some((it) => !getIng(it.ing))) { broken.push(r.name); continue; }
    const rec = { id: store.newId('rec'), name: String(r.name).trim(), servings: num(r.servings) || 1, groupId: null, ingredients,
      steps: (r.steps || []).map(String), desc: r.desc || '', tags: [], custom: true };
    rec.tags = applyAuto(r.tags || [], autoTags(rec, getIng));
    rec._pp = perPortion(rec, getIng);
    newRecs.push(rec); recNames.add(norm(rec.name).trim());
  }
  return { newIngs, newRecs, skippedIngs, skippedRecs, broken };
}

function view(l) {
  const p = l.plan;
  const list = p.newRecs.map((r) => `<div class="ing-line"><span>${esc(r.name)}</span><span class="amt">${fmt(r._pp.kcal)} ккал · Б ${fmt(r._pp.p)}</span></div>`).join('');
  return `<section class="dialog small" role="dialog" aria-modal="true" aria-labelledby="imp-title"><div class="dlg-body">
    <h2 id="imp-title">Добавить рецепты из файла</h2><p class="hint">${esc(l.file || '')}</p>
    <p><b>${p.newRecs.length} ${plural(p.newRecs.length, 'рецепт', 'рецепта', 'рецептов')}</b>${p.newIngs.length ? ` и <b>${p.newIngs.length} ${plural(p.newIngs.length, 'новый ингредиент', 'новых ингредиента', 'новых ингредиентов')}</b> (${p.newIngs.map((x) => esc(x.name)).join(', ')})` : ''}.</p>
    <div class="panel imp-list">${list || '<p class="hint">Добавлять нечего.</p>'}</div>
    ${p.skippedRecs.length ? `<p class="hint">Уже есть в базе, пропущу: ${p.skippedRecs.map(esc).join(', ')}.</p>` : ''}
    ${p.broken.length ? `<p class="err">Не хватает ингредиентов, пропущу: ${p.broken.map(esc).join(', ')}.</p>` : ''}
    <p class="hint">Ничего из того, что уже есть в базе, не изменится. Тэги «низкокалорийное», «много белка» и другие посчитаются автоматически.</p></div>
    <div class="dlg-foot"><button class="btn" data-a="layer-close">Отмена</button><button class="btn acc" data-a="imp-go" ${p.newRecs.length || p.newIngs.length ? '' : 'disabled'}>Добавить</button></div></section>`;
}
actions['imp-go'] = async () => {
  const l = topLayer(); if (!l || l.kind !== 'imp') return;
  const p = l.plan;
  const changes = [...p.newIngs.map((rec) => ({ coll: 'ingredients', rec })), ...p.newRecs.map(({ _pp, ...rec }) => ({ coll: 'recipes', rec }))];
  await store.putAll(changes);
  closeLayer();
  showToast(`Добавлено ${p.newRecs.length} ${plural(p.newRecs.length, 'рецепт', 'рецепта', 'рецептов')}${p.newIngs.length ? ` и ${p.newIngs.length} ${plural(p.newIngs.length, 'ингредиент', 'ингредиента', 'ингредиентов')}` : ''}`);
};
actions['import'] = () => openImport();
export function dialogView(l) { return l.kind === 'imp' ? view(l) : ''; }
