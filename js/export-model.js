// Модель «Покупки и гид» (project state 3.5, решения Q-70…Q-77).
// Период считается по дням приготовления (или, запасным вариантом, по дням приёма).
// Гид: день → готовки (похожие блюда в одном дне — одна готовка, Q-61) → варианты
// (одинаковые на порцию экземпляры схлопываются, Q-04; свой вариант персоны — отдельный подблок, Q-75)
// + «Ингредиенты без рецепта» дня (Q-74).
// Покупки: ингредиент → нужно по готовкам (столбец на готовку, Q-72) и «без рецепта»,
// «есть дома» (ручная правка), купить = нужно − есть; «не покупать» (Q-73) не попадает в список.
import * as store from './store.js';
import {
  persons, entries, entryName, daysBetween, cookOf, alike, slotIdx, perPortionIngs, ingGrams, slotOf,
} from './plan-model.js';

export const CATS = ['овощи', 'зелень', 'фрукты', 'грибы', 'мясо', 'птица', 'рыба', 'морепродукты', 'молочное', 'сыр', 'яйца',
  'крупы', 'макароны', 'бобовые', 'мука', 'выпечка', 'бакалея', 'орехи', 'сухофрукты', 'соусы', 'намазка', 'жиры', 'уксус', 'специи', 'прочее'];
const NO_BUY_DEFAULT = new Set(['water', 'salt']);
const getIng = (id) => store.get('ingredients', id);

/** Ингредиент не покупается (флажок в ингредиенте; по умолчанию — вода и соль). */
export function noBuy(x) {
  if (!x) return false;
  return x.noBuy == null ? NO_BUY_DEFAULT.has(x.id) : !!x.noBuy;
}
const catOf = (x) => { const c = String((x && x.category) || '').trim().toLowerCase(); return c || 'прочее'; };
export const catIdx = (c) => { const i = CATS.indexOf(c); return i < 0 ? CATS.length : i; };
/** Округление штук вверх до 0,5 (Q-19) — только для покупок. */
export const halfUp = (n) => (n > 0 ? Math.ceil(n * 2 - 1e-9) / 2 : 0);

const byPlan = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : slotIdx(a.slot) - slotIdx(b.slot) || (a.order ?? 0) - (b.order ?? 0));

/** Ключ состава на 1 порцию: одинаковые экземпляры схлопываются (Q-04). */
function compKey(s) {
  const ings = perPortionIngs(s).map((x) => x.ing + ':' + Math.round(x.g * 10) / 10).sort().join(',');
  return ings + '|' + (s.steps || []).join('\u0001') + '|' + (s.desc || '');
}

/**
 * Модель периода.
 * @returns {{ from, to, basis, days: [{date, cooks: [Cook], loose: [Loose]}], cooks: [Cook], shop: [Row], hidden: [Row], columns }}
 */
export function build(from, to, basis = 'cook') {
  const ps = persons();
  const pname = (id) => { const p = ps.find((x) => x.id === id); return p ? p.name : ''; };
  const live = (e) => Object.keys(e.eaters || {}).some((pid) => ps.some((p) => p.id === pid));
  const all = entries().filter(live);
  const dayOf = (e) => (e.kind === 'dish' && basis === 'cook' ? cookOf(e) : e.date);
  const inRange = (e) => { const d = dayOf(e); return d >= from && d <= to; };
  const sel = all.filter(inRange).sort(byPlan);
  const days = [];
  const cooks = [];
  for (const d of daysBetween(from, to)) {
    const dishes = sel.filter((e) => e.kind === 'dish' && dayOf(e) === d);
    const clusters = [];
    for (const e of dishes) { const c = clusters.find((x) => x.some((o) => alike(o, e))); if (c) c.push(e); else clusters.push([e]); }
    const dayCooks = clusters.map((list) => {
      const same = list.every((e) => e.groupId && e.groupId === list[0].groupId);
      const title = same ? (list[0].title || entryName(list[0])) : entryName(list[0]);
      const meals = list.map((e) => ({ id: e.id, date: e.date, slot: e.slot, n: Object.entries(e.eaters).filter(([pid]) => pname(pid)).reduce((s, [, x]) => s + x.n, 0) }));
      const vmap = new Map(); const variants = [];
      for (const e of list) {
        for (const p of ps) {
          const x = e.eaters[p.id]; if (!x) continue;
          const s = x.own || e.recipes[x.rid] || e.recipes[e.main]; if (!s) continue;
          const key = compKey(s);
          let v = vmap.get(key);
          if (!v) { v = { key, s, own: !!x.own, name: s.name, who: [], n: 0 }; vmap.set(key, v); variants.push(v); }
          if (!x.own) v.own = false;
          v.n += x.n;
          if (!v.who.includes(p.name)) v.who.push(p.name);
        }
      }
      for (const v of variants) {
        if (v.own) v.name = `${v.s.name} — свой вариант (${v.who.join(', ')})`;
        v.ings = perPortionIngs(v.s).map((it) => ({ ing: it.ing, g: it.g * v.n, unit: it.unit }));
      }
      const c = { id: 'c' + cooks.length, day: d, title, entries: list.map((e) => e.id), meals, n: meals.reduce((a, m) => a + m.n, 0), variants, main: list[0] };
      cooks.push(c);
      return c;
    });
    const loose = sel.filter((e) => e.kind === 'ing' && e.date === d).map((e) => {
      const x = getIng(e.ing);
      const per = Object.entries(e.eaters).filter(([pid]) => pname(pid));
      const n = per.reduce((s, [, y]) => s + y.n, 0);
      return { id: e.id, ing: e.ing, name: x ? x.name : 'удалённый ингредиент', date: e.date, slot: e.slot, g: ingGrams(e, n), n, unit: e.unit,
        who: per.map(([pid]) => pname(pid)) };
    });
    if (dayCooks.length || loose.length) days.push({ date: d, cooks: dayCooks, loose });
  }
  // ---------- покупки ----------
  const LOOSE_COL = cooks.length; // последний столбец — «без рецепта»
  const rows = new Map();
  const row = (ing) => {
    let r = rows.get(ing);
    if (!r) { const x = getIng(ing); r = { ing, x, name: x ? x.name : 'удалённый ингредиент', cat: catOf(x), need: 0, cols: new Array(cooks.length + 1).fill(0) }; rows.set(ing, r); }
    return r;
  };
  cooks.forEach((c, i) => { for (const v of c.variants) for (const it of v.ings) { const r = row(it.ing); r.cols[i] += it.g; r.need += it.g; } });
  for (const d of days) for (const l of d.loose) { const r = row(l.ing); r.cols[LOOSE_COL] += l.g; r.need += l.g; }
  const rec = (ing) => store.get('shop', shopId(from, to, ing));
  const shop = []; const hidden = [];
  for (const r of rows.values()) {
    const s = rec(r.ing);
    r.have = s && s.have ? Math.min(s.have, r.need) : 0;
    r.buy = Math.max(0, r.need - r.have);
    r.bought = !!(s && s.bought);
    const uw = r.x && r.x.unitWeight;
    r.pcsNeed = uw ? halfUp(r.need / uw) : null;
    r.pcsBuy = uw ? halfUp(r.buy / uw) : null;
    r.unitName = (r.x && r.x.unitName) || 'шт';
    (noBuy(r.x) ? hidden : shop).push(r);
  }
  const sortRows = (a, b) => catIdx(a.cat) - catIdx(b.cat) || a.cat.localeCompare(b.cat, 'ru') || a.name.localeCompare(b.name, 'ru');
  shop.sort(sortRows); hidden.sort(sortRows);
  const hasLoose = days.some((d) => d.loose.length);
  return { from, to, basis, days, cooks, shop, hidden, hasLoose, looseCol: LOOSE_COL };
}

/** Подпись приёмов готовки: «сб 26 обед — 3,5 · вс 27 обед — 3,5». */
export function mealsText(c, dp, num) {
  return c.meals.map((m) => { const x = dp(m.date); return `${x.dow} ${x.d} ${slotOf(m.slot).name} — ${num(m.n)}`; }).join(' · ');
}

/** Запись «есть дома» / «куплено» для ингредиента в периоде. */
export function shopId(from, to, ing) { return `shop|${from}|${to}|${ing}`; }
export async function setShop(from, to, ing, patch) {
  const id = shopId(from, to, ing);
  const cur = store.get('shop', id) || { id, from, to, ing, have: 0, bought: false };
  await store.put('shop', { ...cur, ...patch });
}
