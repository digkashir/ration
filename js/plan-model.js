// Модель плана (project state 3.4): даты, персоны, записи плана (приёмы), снимки рецептов, КБЖУ.
//
// Запись плана (коллекция plan):
//  блюдо:      { id, date:'ГГГГ-ММ-ДД', slot, order, kind:'dish', title, groupId, main, recipes:{rid: снимок},
//                eaters:{ pid: { n, rid, own: null | снимок на 1 порцию } }, cookDate }
//  ингредиент: { id, date, slot, order, kind:'ing', ing, unit:'pc'|'g', eaters:{ pid: { n } }, cookDate }
// Состав блюда запоминается в момент добавления (Q-47): снимок рецепта хранится в записи.
import * as store from './store.js';
import { totals } from './nutrition.js';

export const SLOTS = [
  { id: 'breakfast', tag: 'meal-breakfast', name: 'завтрак' },
  { id: 'snack', tag: 'meal-snack', name: 'перекус' },
  { id: 'lunch', tag: 'meal-lunch', name: 'обед' },
  { id: 'dinner', tag: 'meal-dinner', name: 'ужин' },
  { id: 'tea', tag: 'meal-tea', name: 'к чаю' },
];
export const slotOf = (id) => SLOTS.find((s) => s.id === id) || SLOTS[2];
export const slotIdx = (id) => { const i = SLOTS.findIndex((s) => s.id === id); return i < 0 ? 9 : i; };
export const SIMILAR_DAYS = 5;

// ---------- даты (локальные, без часовых поясов) ----------
const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => iso(new Date());
export const addDays = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
export const diffDays = (a, b) => Math.round((fromIso(a) - fromIso(b)) / 86400000);
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['янв', 'февр', 'марта', 'апр', 'мая', 'июня', 'июля', 'авг', 'сент', 'окт', 'нояб', 'дек'];
const MONF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export function dayParts(s) { const d = fromIso(s); return { dow: DOW[d.getDay()], d: d.getDate(), mon: MON[d.getMonth()], monf: MONF[d.getMonth()], m: d.getMonth(), y: d.getFullYear() }; }
export function rangeTitle(from, to) {
  const a = dayParts(from), b = dayParts(to);
  if (from === to) return `${a.dow}, ${a.d} ${a.monf}`;
  if (a.m === b.m && a.y === b.y) return `${a.d} — ${b.d} ${b.monf}`;
  return `${a.d} ${a.monf} — ${b.d} ${b.monf}`;
}
export function daysBetween(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }

// ---------- персоны ----------
export function persons() {
  return store.list('persons').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'ru'));
}
export const initial = (p) => (p && p.name ? p.name.trim()[0].toUpperCase() : '?');

// ---------- снимки рецептов ----------
export function snap(r) {
  return { id: r.id, name: r.name, servings: Number(r.servings) || 1, groupId: r.groupId || null,
    ingredients: (r.ingredients || []).map((x) => ({ ing: x.ing, g: Number(x.g) || 0, unit: x.unit || 'g' })),
    steps: [...(r.steps || [])], desc: r.desc || '', tags: [...(r.tags || [])] };
}
const getIng = (id) => store.get('ingredients', id);
/** КБЖУ на 1 порцию снимка. */
export function perPortion(s) {
  if (!s) return { kcal: 0, p: 0, f: 0, c: 0, fib: 0 };
  const t = totals(s, getIng);
  const k = Number(s.servings) || 1;
  return { kcal: t.kcal / k, p: t.p / k, f: t.f / k, c: t.c / k, fib: t.fib / k };
}
/** Ингредиенты снимка на 1 порцию. */
export function perPortionIngs(s) {
  const k = Number(s.servings) || 1;
  return (s.ingredients || []).map((x) => ({ ing: x.ing, g: x.g / k, unit: x.unit || 'g' }));
}

// ---------- записи плана ----------
export const entries = () => store.list('plan');
export function dayEntries(date) {
  return entries().filter((e) => e.date === date).sort((a, b) => slotIdx(a.slot) - slotIdx(b.slot) || (a.order ?? 0) - (b.order ?? 0));
}
export function eaterRecipe(e, pid) {
  const x = e.eaters && e.eaters[pid];
  if (!x || e.kind !== 'dish') return null;
  return x.own || e.recipes[x.rid] || e.recipes[e.main] || null;
}
/** Граммы ингредиента на одного едока (запись-ингредиент). */
export function ingGrams(e, n) {
  const x = getIng(e.ing);
  return e.unit === 'pc' && x && x.unitWeight ? n * x.unitWeight : n;
}
/** КБЖУ порций персоны в записи. */
export function eaterValues(e, pid) {
  const x = e.eaters && e.eaters[pid];
  if (!x) return null;
  if (e.kind === 'ing') {
    const ing = getIng(e.ing);
    const g = ingGrams(e, x.n);
    if (!ing) return { kcal: 0, p: 0, f: 0, c: 0, fib: 0, n: x.n };
    return { kcal: ing.kcal * g, p: ing.p * g, f: ing.f * g, c: ing.c * g, fib: (ing.fib || 0) * g, n: x.n };
  }
  const v = perPortion(eaterRecipe(e, pid));
  return { kcal: v.kcal * x.n, p: v.p * x.n, f: v.f * x.n, c: v.c * x.n, fib: v.fib * x.n, n: x.n };
}
export function entryTotals(e) {
  const t = { kcal: 0, n: 0 };
  for (const pid of Object.keys(e.eaters || {})) {
    if (!store.get('persons', pid)) continue;
    const v = eaterValues(e, pid);
    if (v) { t.kcal += v.kcal; t.n += v.n; }
  }
  return t;
}
export function dayTotals(date) {
  const out = {};
  for (const p of persons()) out[p.id] = { kcal: 0, p: 0, f: 0, c: 0, fib: 0 };
  for (const e of dayEntries(date)) {
    for (const pid of Object.keys(e.eaters || {})) {
      if (!out[pid]) continue;
      const v = eaterValues(e, pid);
      for (const k of ['kcal', 'p', 'f', 'c', 'fib']) out[pid][k] += v[k];
    }
  }
  return out;
}
export function entryName(e) {
  if (e.kind === 'ing') { const x = getIng(e.ing); return x ? x.name : 'удалённый ингредиент'; }
  return e.title || (e.recipes[e.main] && e.recipes[e.main].name) || 'Блюдо';
}
/** Похожие блюда (тот же рецепт или та же группа) в пределах ±5 дней. */
export function similar(e, all = entries()) {
  if (e.kind !== 'dish') return [];
  const rids = new Set(Object.keys(e.recipes || {}));
  return all.filter((o) => o.id !== e.id && o.kind === 'dish' && Math.abs(diffDays(o.date, e.date)) <= SIMILAR_DAYS &&
    ((e.groupId && o.groupId === e.groupId) || Object.keys(o.recipes || {}).some((r) => rids.has(r))));
}
/** Короткое имя варианта для чипа в ячейке. */
export function variantLabel(e, pid) {
  const x = e.eaters[pid];
  if (!x || e.kind !== 'dish') return '';
  if (x.own) return 'свой вариант';
  if (!e.groupId || x.rid === e.main) return '';
  const r = e.recipes[x.rid];
  if (!r) return '';
  const base = (e.title || '').trim().toLowerCase();
  let n = r.name;
  if (base && n.toLowerCase().startsWith(base)) n = n.slice(base.length).replace(/^[\s·—–:,-]+/, '').trim() || r.name;
  return n;
}
/** Сравнение своего варианта с рецептом (для чипов отличий). */
export function diffOwn(base, own) {
  const b = new Map(perPortionIngs(base).map((x) => [x.ing, x.g]));
  const o = new Map(perPortionIngs(own).map((x) => [x.ing, x.g]));
  const name = (id) => { const x = getIng(id); return x ? x.name : '?'; };
  const out = [];
  for (const [id, g] of o) {
    if (!b.has(id)) out.push({ kind: 'add', text: '+ ' + name(id).toLowerCase() });
    else if (Math.abs(b.get(id) - g) > 0.5) out.push({ kind: 'chg', text: name(id).toLowerCase() + ' ' + (g > b.get(id) ? '↑' : '↓') });
  }
  for (const id of b.keys()) if (!o.has(id)) out.push({ kind: 'rm', text: '− ' + name(id).toLowerCase() });
  return out;
}
export const nextOrder = (date, slot) => Math.max(0, ...entries().filter((e) => e.date === date && e.slot === slot).map((e) => e.order ?? 0)) + 1;
/** Приём по умолчанию для рецепта: первый тэг времени приёма. */
export function defaultSlot(recipe) {
  for (const s of SLOTS) if ((recipe.tags || []).includes(s.tag)) return s.id;
  return 'lunch';
}
