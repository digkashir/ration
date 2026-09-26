// Режим «по дням приготовления» (14B) и фильтр по «*» (14C).
// Строки — дни приёма с блюдами, столбцы — дни приготовления. Блюдо стоит в столбце дня, когда его готовят.
// Правила: не позже дня приёма и не раньше чем за 5 дней (Q-62, Q-69); похожие блюда в одном дне — одна готовка (Q-61).
import * as store from './store.js';
import { ui } from './ui.js';
import { esc, fmt, plural, ICON } from './util.js';
import {
  slotOf, today, addDays, dayParts, daysBetween, entries, entryName, entryTotals, similar, slotIdx, diffDays,
  cookOf, cookBlock, cookings, alike, COOK_AHEAD,
} from './plan-model.js';

const slotVar = (id) => `var(--s-${slotOf(id).tag.replace('meal-', '')})`;
const num = (n) => fmt(n, 1);
const daysText = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const dd = (d) => { const x = dayParts(d); return `${x.dow} ${x.d}`; };
export const LINK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
export const FILTER = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 4h18l-7 9v6l-4 2v-8z"/></svg>';

const dishesOf = (all, date) => all.filter((e) => e.kind === 'dish' && e.date === date)
  .sort((a, b) => slotIdx(a.slot) - slotIdx(b.slot) || (a.order ?? 0) - (b.order ?? 0));

/** Подпись и допустимость переноса готовки блюда e в день c (для перетаскивания и клавиатуры). */
export function cookTarget(e, c, all = entries()) {
  const why = cookBlock(e, c);
  if (why) return { ok: false, label: `нельзя — ${why}` };
  const mates = all.filter((o) => o.id !== e.id && o.kind === 'dish' && cookOf(o) === c && alike(o, e));
  if (mates.length) return { ok: true, label: `в ${dd(c)} — вместе с «${entryName(mates[0])}»${mates.length > 1 ? ' ×' + mates.length : ''}`, mates };
  return { ok: true, label: c === e.date ? `в ${dd(c)} — в день приёма` : `в ${dd(c)} — заранее` };
}

function card(e, sim, group, filt) {
  const t = entryTotals(e);
  const ahead = cookOf(e) < e.date;
  let note = ahead ? `<small>заранее · за ${ahead ? daysText(diffDays(e.date, cookOf(e))) : ''}</small>` : '';
  if (group && group.length > 1) {
    const others = [...new Set(group.filter((o) => o !== e).map((o) => dd(o.date)))];
    const n = group.reduce((s, o) => s + entryTotals(o).n, 0);
    note = `<small class="ck-joint">${LINK}вместе с ${others.join(', ')} · ${num(n)}</small>`;
  }
  const star = sim ? `<button class="star in${filt ? ' on' : ''}" data-star="${esc(e.id)}" data-a="ck-filter" data-e="${esc(e.id)}" aria-label="${filt ? 'Сбросить фильтр' : 'Показать только похожие блюда'}" title="${filt ? 'Сбросить фильтр' : 'Только это блюдо и похожие'}">${FILTER}</button>` : '';
  return `<div class="ck-card${group && group.length > 1 ? ' joint' : ''}${ahead ? ' ahead' : ''}" data-e="${esc(e.id)}" data-ck="${esc(e.id)}" style="--c:${slotVar(e.slot)}">
    <span class="ck-grip" aria-hidden="true">${ICON.grip}</span>
    <button class="ck-open" data-a="pl-card" data-e="${esc(e.id)}" data-ckkey="${esc(e.id)}" aria-label="${esc(entryName(e))}, готовить ${dd(cookOf(e))}. Открыть блюдо; стрелки влево и вправо — другой день приготовления"><b class="nm">${esc(entryName(e))}</b>${note}</button>
    <span class="ck-n">${num(t.n)}</span>${star}</div>`;
}

export function cookView() {
  const P = ui.plan;
  const T = today();
  const all = entries();
  let filt = P.cookFilter ? store.get('plan', P.cookFilter) : null;
  if (P.cookFilter && !filt) P.cookFilter = null;
  let rowDays, cols, shown;
  if (filt) {
    const set = [filt, ...similar(filt, all)];
    shown = new Set(set.map((e) => e.id));
    rowDays = [...new Set(set.map((e) => e.date))].sort();
    cols = daysBetween(addDays(rowDays[0], -COOK_AHEAD), rowDays[rowDays.length - 1]);
  } else {
    rowDays = daysBetween(P.from, P.to);
    const inRange = all.filter((e) => e.kind === 'dish' && e.date >= P.from && e.date <= P.to);
    shown = null;
    let start = addDays(P.from, -(P.cookExtra || 0));
    for (const e of inRange) if (cookOf(e) < start) start = cookOf(e);
    cols = daysBetween(start, P.to);
  }
  const groups = new Map();
  for (const c of cols) for (const g of cookings(c, all)) for (const e of g) groups.set(e.id, g);
  const simIds = new Set(all.filter((e) => e.kind === 'dish' && similar(e, all).length).map((e) => e.id));
  const N = cols.length;
  const style = `--ck: 52px 92px repeat(${N}, minmax(104px, 1fr)); min-width: ${52 + 92 + N * 110 + 12}px`;

  const earlier = !filt && (P.cookExtra || 0) < COOK_AHEAD ? `<button class="link" data-a="ck-earlier">‹ ещё день раньше</button>` : '';
  const head = `<div class="ck-head"><div class="ck-legend"><span>↓ дни приёма</span><span>→ дни приготовления</span><span><i class="ck-eat"></i>день приёма</span><span><i class="ck-hatch"></i>нельзя</span>${earlier}</div>
    ${cols.map((c) => { const x = dayParts(c); return `<div class="ck-ch${c === T ? ' today' : ''}${c < T ? ' past' : ''}"><small>${x.dow}</small><b>${x.d}</b></div>`; }).join('')}</div>`;

  const body = rowDays.map((d) => {
    const list = dishesOf(all, d).filter((e) => !shown || shown.has(e.id));
    const x = dayParts(d);
    const lab = `<div class="ck-dl${d === T ? ' today' : ''}" style="grid-row: 1 / span ${Math.max(1, list.length)}"><small>${x.dow}</small><b>${x.d}</b><small>${x.mon}</small></div>`;
    if (!list.length) return `<div class="ck-day">${lab}<div class="ck-none">нет блюд</div></div>`;
    const rows = list.map((e, i) => {
      const cells = cols.map((c) => {
        const r = `style="grid-row:${i + 1}" data-cr="${esc(e.id)}" data-cc="${c}"`;
        if (c === cookOf(e)) return `<div class="ck-cell has" ${r}>${card(e, simIds.has(e.id), groups.get(e.id), filt && filt.id === e.id)}</div>`;
        const why = cookBlock(e, c);
        if (why) return `<div class="ck-cell no" ${r} title="${why} — нельзя"></div>`;
        return `<div class="ck-cell${c === e.date ? ' eat' : ''}${c < T ? ' past' : ''}" ${r}></div>`;
      }).join('');
      return `<div class="ck-sl" style="grid-row:${i + 1}; grid-column:2; --c:${slotVar(e.slot)}">${slotOf(e.slot).name}</div>${cells}`;
    }).join('');
    return `<div class="ck-day" data-date="${d}">${lab}${rows}</div>`;
  }).join('');

  const foot = `<div class="ck-foot"><div class="ck-fl">Готовить в этот день</div>${cols.map((c) => {
    const gs = cookings(c, all).filter((g) => !shown || g.some((e) => shown.has(e.id)));
    if (!gs.length) return '<div class="ck-fc empty"></div>';
    const n = gs.reduce((s, g) => s + g.length, 0);
    const por = gs.reduce((s, g) => s + g.reduce((a, e) => a + entryTotals(e).n, 0), 0);
    const joint = gs.filter((g) => g.length > 1).map((g) => `${esc(entryName(g[0]))} ×${g.length} → одна готовка`);
    return `<div class="ck-fc"><b>${n} ${plural(n, 'блюдо', 'блюда', 'блюд')} · ${num(por)} порц.</b>${joint.map((j) => `<small>${j}</small>`).join('')}</div>`;
  }).join('')}</div>`;

  const banner = filt ? `<div class="ck-filter"><span class="star in on" aria-hidden="true">${FILTER}</span><div><b>Фильтр: ${esc(entryName(filt))} и похожие</b>
      <small>Показаны только похожие блюда (±${COOK_AHEAD} дней) и все дни, где их можно готовить, — в том числе прошедшие.</small></div>
      <button class="btn sm dark-soft" data-a="ck-filter-off">× Сбросить фильтр</button></div>` : '';
  return `${banner}<div class="plan-scroll only-wide"><div class="ck" style="${style}">${head}${body}${foot}</div>
    <p class="hint ck-hint">Перетащите карточку в другой столбец — блюдо будет готовиться в этот день. Рамкой отмечен день приёма, штриховкой — дни, когда готовить нельзя (позже приёма или раньше чем за ${COOK_AHEAD} дней). Похожие блюда в одном дне — одна готовка. Ингредиенты без рецепта здесь не показываются.</p></div>`;
}
