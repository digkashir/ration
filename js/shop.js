// Страница «Покупки и гид» (15B, Q-70…Q-77; доработки v0.5: Q-79…Q-82).
// Вкладки «Список покупок» и «Гид», у каждой свой период (общий переключатель period.js).
// Список — таблицей: слева флажок «куплено», ингредиент и «купить» (ручная правка: «дома уже есть — докупить меньше»),
// справа столбец на каждую готовку с граммами; фильтр по блюдам. На телефоне левая часть закреплена, столбцы листаются.
import * as store from './store.js';
import { ui, actions, hooks, openLayer, closeLayer, topLayer } from './ui.js';
import { $, $$, esc, fmt, plural, parseNum, showToast } from './util.js';
import { dayParts, rangeTitle, slotOf, iso } from './plan-model.js';
import { build, mealsText, setShop, noBuy, halfUp, toggleExcl } from './export-model.js';
import { amountText } from './recipe.js';
import * as PER from './period.js';
import * as SHEETS from './sheets.js';

ui.shop = ui.shop || { basis: 'cook', busy: false, tab: 'list', list: PER.fresh(), guide: PER.fresh() };
const S = ui.shop;
PER.register('shop', S.list, { persist: true, refresh: () => refresh() });
PER.register('guide', S.guide, { persist: true, refresh: () => refresh() });
const num = (n) => fmt(n, 1);
const fg = (g) => fmt(g, g < 10 ? 1 : 0);
const slotVar = (id) => `var(--s-${slotOf(id).tag.replace('meal-', '')})`;
const dd = (d) => { const x = dayParts(d); return `${x.dow} ${x.d}`; };
const L = () => S.list; // период списка покупок
let model = null;
const M = () => { const st = S.tab === 'guide' ? S.guide : S.list; return (model = build(st.from, st.to, S.basis)); };

const EXT = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';

export function page() {
  return `<main class="page shop-page">
    <div class="shop-top">
      <div class="seg" role="tablist" aria-label="Раздел"><button role="tab" data-a="sh-tab" data-v="list" aria-selected="${S.tab === 'list'}" aria-pressed="${S.tab === 'list'}">Список покупок</button><button role="tab" data-a="sh-tab" data-v="guide" aria-selected="${S.tab === 'guide'}" aria-pressed="${S.tab === 'guide'}">Гид</button></div>
      <div class="sh-period" id="sh-period">${PER.view(S.tab === 'guide' ? 'guide' : 'shop')}</div>
    </div>
    <div class="shop-sub"><div class="seg sm" role="group" aria-label="Считать по"><button data-a="sh-basis" data-v="cook">по дням приготовления</button><button data-a="sh-basis" data-v="eat">по дням приёма</button></div>
      <span class="spacer"></span><div class="sh-export" id="sh-export"></div></div>
    <div id="shop-body"></div>
  </main>`;
}

export function refresh() {
  const body = $('#shop-body'); if (!body) return;
  const m = M();
  PER.sync(S.tab === 'guide' ? 'guide' : 'shop');
  $$('[data-a="sh-basis"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === S.basis)));
  $('#sh-export').innerHTML = exportView(m);
  const wrap = $('.sh-tablewrap'); const sx = wrap ? wrap.scrollLeft : 0;
  const y = window.scrollY;
  const empty = `<div class="empty">В этом периоде ${S.basis === 'cook' ? 'ничего не готовится' : 'нет приёмов'}. Добавьте блюда в <a href="#/plan">план</a> или выберите другой период.</div>`;
  if (S.tab === 'guide') body.innerHTML = m.cooks.length || m.days.length ? guideView(m) : empty;
  else body.innerHTML = m.cooks.length || m.days.length ? listView(m) : empty;
  const w2 = $('.sh-tablewrap'); if (w2) { w2.scrollLeft = sx; w2.classList.toggle('scrolled', sx > 2); w2.addEventListener('scroll', () => w2.classList.toggle('scrolled', w2.scrollLeft > 2), { passive: true }); }
  window.scrollTo(0, y);
}
actions['sh-tab'] = (t) => {
  if (S.tab === t.dataset.v) return;
  S.tab = t.dataset.v;
  $$('[data-a="sh-tab"]').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.v === S.tab)); b.setAttribute('aria-selected', String(b.dataset.v === S.tab)); });
  $('#sh-period').innerHTML = PER.view(S.tab === 'guide' ? 'guide' : 'shop');
  refresh();
};

// ---------- выгрузка ----------
function exportView(m) {
  const set = store.get('settings', 'export');
  const drv = store.state.meta && store.state.meta.mode === 'drive';
  const when = set && set.at ? new Date(set.at) : null;
  const whenTxt = when ? `выгружено ${dd(iso(when))}, ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` : '';
  const off = !drv ? 'Подключите Google Диск в меню аккаунта — таблица создаётся на нём' : !navigator.onLine ? 'Нет интернета' : '';
  return `${whenTxt ? `<span class="hint">${whenTxt}</span>` : ''}
    ${set && set.link ? `<a class="btn" href="${esc(set.link)}" target="_blank" rel="noopener">Открыть таблицу ${EXT}</a>` : ''}
    <button class="btn acc" data-a="sh-export" ${off || S.busy ? 'disabled' : ''} title="${esc(off || 'Лист «Список покупок» — за период списка, лист «Гид» — за период гида')}">${S.busy ? 'Выгружаю…' : 'Выгрузить в Google Таблицу'}</button>`;
}
actions['sh-export'] = async () => {
  if (S.busy) return;
  S.busy = true; refresh();
  try {
    const r = await SHEETS.exportModel(build(S.list.from, S.list.to, S.basis), build(S.guide.from, S.guide.to, S.basis));
    await store.put('settings', { id: 'export', ...(store.get('settings', 'export') || {}), sheetId: r.id, link: r.link, at: new Date().toISOString() });
    showToast('Таблица «Рацион — покупки и гид» обновлена');
  } catch (e) {
    console.error(e);
    showToast(SHEETS.explain(e), 'error', 12000);
  } finally { S.busy = false; refresh(); }
};

// ---------- список покупок ----------
function amount(r) {
  const pcs = r.pcsBuy != null && r.buy > 0 ? `${num(r.pcsBuy)} ${esc(r.unitName)}` : '';
  const note = r.have > 0 ? `нужно ${fg(r.need)} · есть ${fg(r.have)}` : r.have < 0 ? `нужно ${fg(r.need)} · +${fg(-r.have)} сверх` : '';
  return `<button class="sh-amt${r.have ? ' edited' : ''}" data-a="sh-edit" data-ing="${esc(r.ing)}" aria-label="${esc(r.name)}: купить ${fg(r.buy)} г. Изменить количество">
    <b>${r.buy > 0 ? fg(r.buy) + ' г' : 'не нужно'}</b><span class="pcs">${pcs}</span>${note ? `<small>${note}</small>` : ''}</button>`;
}
function listView(m) {
  const cooks = m.cooks;
  const chips = cooks.map((c) => `<button class="chip sh-dish${c.off ? ' off' : ''}" data-a="sh-excl" data-k="${esc(c.key)}" aria-pressed="${!c.off}" title="${c.off ? 'Включить в список покупок' : 'Не покупать для этого блюда'}">${c.off ? '' : CHECK}${esc(c.title)}<small>${dd(c.day)}</small></button>`).join('') +
    (m.hasLoose ? `<button class="chip sh-dish${m.looseOff ? ' off' : ''}" data-a="sh-excl" data-k="loose" aria-pressed="${!m.looseOff}">${m.looseOff ? '' : CHECK}без рецепта</button>` : '');
  const ncol = cooks.length + (m.hasLoose ? 1 : 0);
  const head = `<tr><th class="sh-first-h" scope="col">Ингредиент · купить</th>${cooks.map((c) => `<th scope="col" class="sh-colh${c.off ? ' off' : ''}"><b class="nm">${esc(c.title)}</b><small>${dd(c.day)} · ${num(c.n)} порц.</small></th>`).join('')}${m.hasLoose ? `<th scope="col" class="sh-colh${m.looseOff ? ' off' : ''}"><b>без рецепта</b></th>` : ''}</tr>`;
  let cat = null; let rows = '';
  for (const r of m.shop) {
    if (r.cat !== cat) { cat = r.cat; rows += `<tr class="sh-cat"><th scope="rowgroup" class="sh-first">${esc(cat)}</th>${ncol ? `<td colspan="${ncol}"></td>` : ''}</tr>`; }
    const cells = cooks.map((c, i) => `<td class="${c.off ? 'off' : ''}">${r.cols[i] ? fg(r.cols[i]) : ''}</td>`).join('') + (m.hasLoose ? `<td class="${m.looseOff ? 'off' : ''}">${r.cols[m.looseCol] ? fg(r.cols[m.looseCol]) : ''}</td>` : '');
    rows += `<tr class="sh-row${r.bought ? ' done' : ''}${r.buy <= 0 ? ' zero' : ''}"><th scope="row" class="sh-first"><div class="sh-item">
      <button class="sh-check" data-a="sh-bought" data-ing="${esc(r.ing)}" role="checkbox" aria-checked="${r.bought}" aria-label="${esc(r.name)}: куплено">${r.bought ? CHECK : ''}</button>
      <span class="nm">${esc(r.name)}</span>${amount(r)}</div></th>${cells}</tr>`;
  }
  const done = m.shop.filter((r) => r.bought).length;
  const hid = m.hidden.length ? `<p class="hint sh-hidden">Не покупаются: ${m.hidden.map((r) => `<button class="link" data-a="sh-nobuy-off" data-ing="${esc(r.ing)}" title="Вернуть в список покупок">${esc(r.name)}</button>`).join(', ')}. Флажок «не покупать» — в карточке ингредиента.</p>` : '';
  return `${chips ? `<div class="sh-filter panel" role="group" aria-label="Блюда в списке покупок"><span class="sh-fl">Блюда</span>${chips}<span class="hint">выключенное блюдо не попадает в список и в Google Таблицу</span></div>` : ''}
    <section class="sh-list panel" aria-label="Список покупок">
    <div class="sh-lh"><h2>Список покупок</h2><span class="hint">${m.shop.length} ${plural(m.shop.length, 'ингредиент', 'ингредиента', 'ингредиентов')}${done ? ` · ${done} куплено` : ''}</span>
      <span class="spacer"></span><span class="hint">нажмите на количество, чтобы изменить${ncol ? ' · граммы по блюдам — справа' : ''}</span></div>
    ${m.shop.length ? `<div class="sh-tablewrap"><table class="sh-table">${ncol ? `<thead>${head}</thead>` : ''}<tbody>${rows}</tbody></table></div>` : '<p class="hint">Покупать нечего.</p>'}${hid}</section>`;
}
actions['sh-excl'] = (t) => toggleExcl(L().from, L().to, t.dataset.k);
actions['sh-bought'] = async (t) => {
  const r = model && model.shop.find((x) => x.ing === t.dataset.ing); if (!r) return;
  await setShop(L().from, L().to, r.ing, { bought: !r.bought });
  const b = $(`[data-a="sh-bought"][data-ing="${CSS.escape(r.ing)}"]`); if (b) b.focus();
};
actions['sh-nobuy-off'] = async (t) => {
  const x = store.get('ingredients', t.dataset.ing); if (!x) return;
  await store.put('ingredients', { ...x, noBuy: false });
  showToast(`«${x.name}» снова в списке покупок`);
};

// ---------- ручная правка количества ----------
actions['sh-edit'] = (t) => {
  const r = model && model.shop.find((x) => x.ing === t.dataset.ing); if (!r) return;
  const uw = r.x && r.x.unitWeight;
  openLayer({ type: 'dialog', kind: 'sh-edit', ing: r.ing, unit: uw ? 'pc' : 'g' });
};
function editView(l) {
  const r = model && model.shop.find((x) => x.ing === l.ing);
  if (!r) return `<section class="dialog small"><div class="dlg-body"><h2>Ингредиент больше не нужен в этом периоде</h2></div><div class="dlg-foot"><button class="btn" data-a="layer-close">Закрыть</button></div></section>`;
  const uw = r.x && r.x.unitWeight;
  const pc = l.unit === 'pc' && uw;
  const val = pc ? halfUp(r.buy / uw) : Math.round(r.buy);
  return `<section class="dialog small" role="dialog" aria-modal="true" aria-labelledby="se-title"><div class="dlg-body">
    <h2 id="se-title">${esc(r.name)}</h2>
    <p class="hint">По рецептам нужно <b>${fg(r.need)} г</b>${uw ? ` ≈ ${num(halfUp(r.need / uw))} ${esc(r.unitName)}` : ''} на ${esc(rangeTitle(L().from, L().to))}.</p>
    <div class="se-row"><label class="field"><span>Купить</span><input id="se-buy" inputmode="decimal" value="${fmt(val, 1)}" autocomplete="off" data-autofocus></label>
      ${uw ? `<div class="seg sm" role="group" aria-label="Единицы"><button data-a="se-unit" data-v="pc" aria-pressed="${!!pc}">${esc(r.unitName)}</button><button data-a="se-unit" data-v="g" aria-pressed="${!pc}">г</button></div>` : '<span class="se-u">г</span>'}</div>
    <p class="hint" id="se-have">${haveText(r, r.buy)}</p>
    <p class="err" id="se-err" role="alert"></p>
    <div class="menu-list">${r.have ? '<button data-a="se-reset">↺ Как по рецептам</button>' : ''}<button data-a="se-nobuy">Не покупать «${esc(r.name)}» совсем</button></div></div>
    <div class="dlg-foot"><button class="btn" data-a="layer-close">Отмена</button><button class="btn acc" data-a="se-save">Сохранить</button></div></section>`;
}
function haveText(r, buyG) {
  const have = r.need - buyG;
  if (Math.abs(have) < 0.5) return 'Ровно столько, сколько нужно по рецептам.';
  if (have > 0) return `Значит, дома уже есть ${fg(have)} г — их не покупаем.`;
  return `Это на ${fg(-have)} г больше, чем нужно по рецептам.`;
}
function readBuy(l, r) {
  const n = parseNum($('#se-buy').value);
  if (n == null || isNaN(n) || n < 0) return null;
  const uw = r.x && r.x.unitWeight;
  return l.unit === 'pc' && uw ? n * uw : n;
}
actions['se-unit'] = (t) => { const l = topLayer(); l.unit = t.dataset.v; hooks.renderOverlay(); };
actions['se-save'] = async () => {
  const l = topLayer(); const r = model.shop.find((x) => x.ing === l.ing); if (!r) return closeLayer();
  const g = readBuy(l, r);
  if (g == null) { $('#se-err').textContent = 'Введите число от 0.'; return; }
  await setShop(L().from, L().to, r.ing, { have: Math.round((r.need - g) * 10) / 10 });
  closeLayer();
  showToast(`${r.name}: купить ${fg(g)} г`);
};
actions['se-reset'] = async () => { const l = topLayer(); await setShop(L().from, L().to, l.ing, { have: 0 }); closeLayer(); };
actions['se-nobuy'] = async () => {
  const l = topLayer(); const x = store.get('ingredients', l.ing); if (!x) return;
  await store.put('ingredients', { ...x, noBuy: true });
  closeLayer();
  showToast(`«${x.name}» больше не попадает в список покупок. Вернуть — внизу списка или в карточке ингредиента`);
};

// ---------- гид ----------
function guideView(m) {
  const days = m.days.map((d) => `<div class="sh-day"><h3>${S.basis === 'cook' ? 'Готовить ' : ''}${dd(d.date)}</h3>
    ${d.cooks.map((c) => `<button class="sh-cook${c.meals.length > 1 ? ' joint' : ''}" data-a="sh-cook" data-c="${c.id}" style="--c:${slotVar(c.meals[0].slot)}">
      <span class="bar" aria-hidden="true"></span><span class="t"><b class="nm">${esc(c.title)}</b><small>${esc(mealsText(c, dayParts, num))}${c.variants.length > 1 ? ` · ${c.variants.length} вар.` : ''}</small></span>
      <b class="n">${num(c.n)} порц.</b><span aria-hidden="true">›</span></button>`).join('')}
    ${d.loose.length ? `<div class="sh-loose"><b>Ингредиенты без рецепта</b>${d.loose.map((x) => `<div><span>${esc(x.name)}</span><small>${esc(slotOf(x.slot).name)} · ${esc(x.who.join(', '))}</small><b>${looseAmt(x)}</b></div>`).join('')}</div>` : ''}</div>`).join('');
  return `<section class="sh-guide" aria-label="Гид по приготовлению"><div class="sh-lh"><h2>Гид · ${m.cooks.length} ${plural(m.cooks.length, 'готовка', 'готовки', 'готовок')}</h2><span class="hint">нажмите — рецепт на эти порции</span></div><div class="sh-days">${days}</div></section>`;
}
function looseAmt(x) {
  const ing = store.get('ingredients', x.ing);
  if (x.unit === 'pc' && ing && ing.unitWeight) return `${num(x.n)} ${esc(ing.unitName || 'шт')}`;
  return `${fg(x.g)} г`;
}
actions['sh-cook'] = (t) => openLayer({ type: 'dialog', kind: 'sh-cook', c: t.dataset.c, v: 0 });
function cookView(l) {
  const c = model && model.cooks.find((x) => x.id === l.c);
  if (!c) return '';
  const i = Math.min(l.v || 0, c.variants.length - 1); const v = c.variants[i];
  const ings = v.ings.map((it) => { const x = store.get('ingredients', it.ing);
    return `<div class="ing-line"><span>${x ? esc(x.name) : '<i class="hint">удалённый ингредиент</i>'}</span><span class="amt">${amountText(it, 1)}</span></div>`; }).join('');
  const steps = v.s.steps || [];
  return `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="sc-title"><div class="dlg-body">
    <div class="pa-h"><h2 id="sc-title">${esc(c.title)}</h2><span class="spacer"></span><button class="btn icon sm" data-a="layer-close" aria-label="Закрыть">×</button></div>
    <p class="hint">${S.basis === 'cook' ? 'Готовить ' + dd(c.day) + ' · ' : ''}${num(c.n)} порц. · ${esc(mealsText(c, dayParts, num))}</p>
    ${c.variants.length > 1 ? `<div class="chips-w" role="group" aria-label="Варианты">${c.variants.map((x, j) => `<button class="chip" data-a="sc-v" data-v="${j}" aria-pressed="${j === i}">${esc(x.name)} · ${num(x.n)}</button>`).join('')}</div>` : ''}
    <div class="pd-rec-h"><b>${esc(v.name)}</b><span class="hint">${esc(v.who.join(', '))} · ${num(v.n)} ${plural(Math.ceil(v.n), 'порция', 'порции', 'порций')}</span></div>
    <div class="pd-ings">${ings}</div>
    ${v.s.desc ? `<p class="rv-desc">${esc(v.s.desc)}</p>` : ''}
    <h3 class="rv-sub">Приготовление · ${steps.length} ${plural(steps.length, 'шаг', 'шага', 'шагов')}</h3>
    ${steps.length ? `<ol class="steps">${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : '<p class="hint">Шагов нет.</p>'}
    </div><div class="dlg-foot"><button class="btn" data-a="layer-close">Готово</button></div></section>`;
}
actions['sc-v'] = (t) => { const l = topLayer(); l.v = Number(t.dataset.v); hooks.renderOverlay(); };

actions['sh-basis'] = (t) => { S.basis = t.dataset.v; refresh(); };

export function dialogView(l) {
  if (l.kind === 'sh-edit') return editView(l);
  if (l.kind === 'sh-cook') return cookView(l);
  return '';
}
export function onInput(e) {
  if (e.target.id === 'se-buy') {
    const l = topLayer(); const r = model && model.shop.find((x) => x.ing === l.ing); if (!r) return true;
    const g = readBuy(l, r); const h = $('#se-have'); if (h) h.textContent = g == null ? '' : haveText(r, g);
    return true;
  }
  return false;
}
export function onKeydown(e) {
  if (e.target.id === 'se-buy' && e.key === 'Enter') { e.preventDefault(); actions['se-save'](); return true; }
  return false;
}
export { noBuy };
