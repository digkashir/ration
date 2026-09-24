// Расчёт КБЖУ рецептов и автотэгов (правила — project state, раздел 3.2.1).

/** Сумма КБЖУ и клетчатки на весь рецепт. getIng(id) → ингредиент (значения на 1 г). */
export function totals(recipe, getIng) {
  const t = { kcal: 0, p: 0, f: 0, c: 0, fib: 0, g: 0 };
  for (const it of recipe.ingredients || []) {
    const x = getIng(it.ing);
    if (!x) continue;
    const g = Number(it.g) || 0;
    t.kcal += x.kcal * g; t.p += x.p * g; t.f += x.f * g; t.c += x.c * g; t.fib += (x.fib || 0) * g; t.g += g;
  }
  return t;
}

export function perPortion(recipe, getIng) {
  const t = totals(recipe, getIng);
  const s = Number(recipe.servings) || 1;
  return { kcal: t.kcal / s, p: t.p / s, f: t.f / s, c: t.c / s, fib: t.fib / s, g: t.g / s };
}

// Тэги, у которых есть правило (участвуют в сравнении «Сейчас / По расчёту», Q-28)
export const NUT_RULE_TAGS = ['nut-high-protein', 'nut-high-fiber', 'nut-low-cal', 'nut-filling', 'nut-fatty', 'nut-carby', 'nut-low-carb', 'nut-vegetarian', 'nut-lenten'];
export const GRP_TAGS = ['grp-meat', 'grp-poultry', 'grp-fish', 'grp-seafood', 'grp-eggs', 'grp-dairy', 'grp-cheese', 'grp-grains', 'grp-legumes',
  'grp-pasta', 'grp-flour', 'grp-potato', 'grp-veg', 'grp-mushrooms', 'grp-fruit', 'grp-nuts'];
export const RULE_TAGS = new Set([...NUT_RULE_TAGS, ...GRP_TAGS]);

const FLESH_GROUPS = new Set(['grp-meat', 'grp-poultry', 'grp-fish', 'grp-seafood']);
const FLESH_CATS = new Set(['мясо', 'рыба', 'намазка']);
const ANIMAL_GROUPS = new Set(['grp-eggs', 'grp-dairy', 'grp-cheese']);
const ANIMAL_CATS = new Set(['яйца', 'молочное']);
const ANIMAL_NAMES = new Set(['Сливочное масло', 'Майонез']);
const GROUP_THRESHOLD = { 'grp-cheese': 15, 'grp-nuts': 15 };

/** Набор тэгов по правилам для рецепта (или экземпляра). */
export function autoTags(recipe, getIng) {
  const pp = perPortion(recipe, getIng);
  const s = Number(recipe.servings) || 1;
  const e = 4 * pp.p + 9 * pp.f + 4 * pp.c || 1;
  const out = new Set();
  if ((4 * pp.p) / e >= 0.25 && pp.p >= 20) out.add('nut-high-protein');
  if (pp.fib >= 5) out.add('nut-high-fiber');
  if (pp.kcal <= 300) out.add('nut-low-cal');
  if (pp.kcal >= 600) out.add('nut-filling');
  if ((9 * pp.f) / e >= 0.55) out.add('nut-fatty');
  if ((4 * pp.c) / e >= 0.55) out.add('nut-carby');
  if ((4 * pp.c) / e <= 0.10) out.add('nut-low-carb');
  let flesh = false, animal = false;
  const w = {};
  for (const it of recipe.ingredients || []) {
    const x = getIng(it.ing);
    if (!x) continue;
    if (FLESH_GROUPS.has(x.group) || FLESH_CATS.has(x.category)) flesh = true;
    if (ANIMAL_GROUPS.has(x.group) || ANIMAL_CATS.has(x.category) || ANIMAL_NAMES.has(x.name)) animal = true;
    if (x.group) w[x.group] = (w[x.group] || 0) + (Number(it.g) || 0) / s;
  }
  if (!flesh) out.add('nut-vegetarian');
  if (!flesh && !animal) out.add('nut-lenten');
  for (const [g, v] of Object.entries(w)) if (v >= (GROUP_THRESHOLD[g] || 30)) out.add(g);
  return out;
}

/** Сравнение текущих тэгов с расчётом: только тэги с правилами. */
export function tagDiff(currentTags, computed) {
  const cur = new Set((currentTags || []).filter((t) => RULE_TAGS.has(t)));
  const add = [...computed].filter((t) => !cur.has(t));
  const remove = [...cur].filter((t) => !computed.has(t));
  return { add, remove, same: add.length === 0 && remove.length === 0 };
}

/** Применить расчёт: оставить тэги без правил, тэги с правилами заменить расчётом. */
export function applyAuto(currentTags, computed) {
  return [...(currentTags || []).filter((t) => !RULE_TAGS.has(t)), ...computed];
}
