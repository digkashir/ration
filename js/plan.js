// План «по дням приёма» (12A + «*» из 14A), добавление блюда и ингредиента (12F), порции и варианты по персонам,
// меню блюда, телефон (12I, 12J). Режим «по дням приготовления» — v0.3.1.
import * as store from './store.js';
import { ui, actions, hooks, openLayer, closeLayer, topLayer } from './ui.js';
import { $, $$, esc, norm, fmt, plural, showToast, ICON } from './util.js';
import { members } from './groups.js';
import {
  SLOTS, slotOf, today, addDays, diffDays, dayParts, rangeTitle, daysBetween, fromIso, iso, persons, initial, snap, perPortion,
  entries, dayEntries, eaterValues, entryTotals, dayTotals, entryName, similar, variantLabel, diffOwn, nextOrder, defaultSlot, ingGrams, eaterRecipe,
} from './plan-model.js';

const T = today();
ui.plan = ui.plan || {
  len: 'week', from: T, to: addDays(T, 6), expanded: new Set([T]), phoneDay: T, hl: null,
  side: { q: '', slot: null, open: new Set() },
};
const P = ui.plan;
const getIng = (id) => store.get('ingredients', id);
const ava = (p, cls = '') => `<span class="ava ${cls}" aria-hidden="true">${esc(initial(p))}</span>`;
const slotVar = (id) => `var(--s-${slotOf(id).tag.replace('meal-', '')})`;
const num = (n) => fmt(n, 1);
const STAR = '<span aria-hidden="true">*</span>';

// ---------- период ----------
function setLen(len, from = P.from) {
  P.len = len;
  if (len === 'day') { P.from = from; P.to = from; }
  else if (len === 'week') { P.from = from; P.to = addDays(from, 6); }
  else if (len === 'month') { const d = fromIso(from); P.from = iso(new Date(d.getFullYear(), d.getMonth(), 1)); P.to = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
}
function shift(dir) {
  if (P.len === 'month') { const d = fromIso(P.from); setLen('month', iso(new Date(d.getFullYear(), d.getMonth() + dir, 1))); return; }
  const n = diffDays(P.to, P.from) + 1;
  P.from = addDays(P.from, dir * n); P.to = addDays(P.to, dir * n);
}

// ---------- страница ----------
export function page() {
  const segs = [['day', 'День'], ['week', '7 дней'], ['month', 'Месяц'], ['custom', 'Свой период']]
    .map(([v, l]) => `<button data-a="pl-len" data-v="${v}" aria-pressed="${P.len === v}">${l}</button>`).join('');
  return `<main class="page plan-page">
    <aside class="plan-side only-wide" id="plan-side" aria-label="Рецепты для плана"></aside>
    <section class="plan-main">
      <div class="plan-top">
        <div class="seg only-wide" role="group" aria-label="Режим плана"><button aria-pressed="true">По дням приёма</button><button disabled title="Режим «По дням приготовления» появится в версии 0.3.1">Приготовление · v0.3.1</button></div>
        <div class="pnav-wrap"><div class="pnav"><button class="btn icon sm" data-a="pl-prev" aria-label="Раньше">‹</button><h1 id="pl-title"></h1><button class="btn icon sm" data-a="pl-next" aria-label="Позже">›</button>
          <button class="link" data-a="pl-today">сегодня</button></div>
        <div class="seg only-wide" role="group" aria-label="Период">${segs}</div></div>
      </div>
      <div id="plan-body"></div>
    </section>
  </main>`;
}

export function refreshSide() { const side = $('#plan-side'); if (side) side.innerHTML = sideView(); }
export function refresh() {
  if (!$('#plan-body')) return;
  $('#pl-title').textContent = rangeTitle(P.from, P.to);
  $$('[data-a="pl-len"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === P.len)));
  const side = $('#plan-side'); if (side) side.innerHTML = sideView();
  $('#plan-body').innerHTML = bodyView();
}

// ---------- боковая база рецептов ----------
function sideItems() {
  const q = norm(P.side.q).trim();
  const tag = P.side.slot ? slotOf(P.side.slot).tag : null;
  const ok = (r) => (!tag || (r.tags || []).includes(tag)) && (!q || norm(r.name).includes(q) ||
    (r.ingredients || []).some((x) => { const i = getIng(x.ing); return i && norm(i.name).includes(q); }));
  const out = [];
  for (const g of store.list('groups')) {
    const m = members(g.id); const byName = q && norm(g.name).includes(q) && (!tag || m.some((r) => (r.tags || []).includes(tag)));
    const shown = byName ? m : m.filter(ok); if (shown.length) out.push({ g, m: shown, all: m });
  }
  for (const r of store.list('recipes')) if ((!r.groupId || !store.get('groups', r.groupId)) && ok(r)) out.push({ r });
  return out.sort((a, b) => (a.g ? a.g.name : a.r.name).localeCompare(b.g ? b.g.name : b.r.name, 'ru'));
}
function sideView() {
  const chips = SLOTS.map((s) => `<button class="chip meal" style="--c:${slotVar(s.id)}" data-a="pl-side-slot" data-v="${s.id}" aria-pressed="${P.side.slot === s.id}">${s.name}</button>`).join('');
  const kcal = (r) => fmt(perPortion(snap(r)).kcal);
  const items = sideItems().slice(0, 80).map((x) => {
    if (x.r) return `<button class="ps-item" data-a="pl-side-pick" data-rid="${esc(x.r.id)}" data-drag-rid="${esc(x.r.id)}">${ICON.grip}<span class="nm">${esc(x.r.name)}</span><b>${kcal(x.r)}</b></button>`;
    const open = P.side.open.has(x.g.id) || !!P.side.q;
    return `<div class="ps-group${open ? ' open' : ''}" data-gid="${esc(x.g.id)}">
      <div class="ps-gh"><button class="ps-gt" data-a="pl-side-group" data-id="${esc(x.g.id)}" aria-expanded="${open}" data-drag-gid="${esc(x.g.id)}">${ICON.grip}<span class="nm">${esc(x.g.name)}</span><span class="chip-s dark">группа · ${x.all.length}</span></button></div>
      ${open ? x.m.map((r, i) => `<button class="ps-item sub" data-a="pl-side-pick" data-rid="${esc(r.id)}" data-drag-rid="${esc(r.id)}" data-in-gid="${esc(x.g.id)}">${ICON.grip}<span class="nm">${esc(r.name)}</span>${r.id === x.all[0].id ? '<span class="chip-s dark">по умолч.</span>' : ''}<b>${kcal(r)}</b></button>`).join('') : ''}</div>`;
  }).join('');
  return `<div class="ps-head"><h2>Рецепты</h2></div>
    <label class="search">${ICON.search}<span class="sr-only">Поиск рецепта</span><input id="ps-q" type="search" placeholder="Блюдо или ингредиент" value="${esc(P.side.q)}" autocomplete="off"></label>
    <div class="f-chips">${chips}</div>
    <div class="ps-list" id="ps-list">${items || '<p class="hint">Ничего не нашлось</p>'}</div>
    <p class="hint">Нажмите, чтобы добавить, или перетащите в день либо в ячейку персоны (сменить вариант). Внутри списка: на рецепт — новая группа, на группу — добавить в неё, в раскрытой группе — порядок.</p>`;
}

// ---------- тело плана ----------
function bodyView() {
  const ps = persons();
  if (!ps.length) return `<div class="empty">Чтобы планировать, добавьте персон — тех, кто ест.<br><br><a class="btn acc" href="#/persons">Перейти к персонам</a></div>`;
  const days = daysBetween(P.from, P.to);
  const all = entries();
  const simMap = new Map(all.filter((e) => e.kind === 'dish').map((e) => [e.id, similar(e, all)]));
  const head = `<div class="pt-head"><span>день</span><span>блюдо</span>${ps.map((p) => `<span class="pt-ph">${ava(p)}<b>${esc(p.name)}</b><small>${goalText(p)}</small></span>`).join('')}<span>итого</span></div>`;
  const desk = `<div class="plan-scroll only-wide"><div class="pt" style="--np:${ps.length}">${head}${days.map((d) => dayView(d, ps, simMap)).join('')}</div>${summaryView(ps, days)}</div>`;
  return desk + phoneView(ps, days, simMap);
}
const goalText = (p) => { const g = p.goals || {}; return g.kcal ? `${fmt(g.kcal)} · ${fmt(g.p || 0)}/${fmt(g.f || 0)}/${fmt(g.c || 0)}` : 'цель не задана'; };

function dayLabel(d, open) {
  const x = dayParts(d);
  return `<button class="pt-dl${d === T ? ' today' : ''}" data-a="pl-day" data-date="${d}" aria-expanded="${open}" aria-label="${x.dow}, ${x.d} ${x.monf}: ${open ? 'свернуть' : 'развернуть'}">
    <small>${x.dow}</small><b>${x.d}</b><small>${x.mon}</small>${d === T ? '<i>сегодня</i>' : ''}</button>`;
}

function dayView(d, ps, simMap) {
  const list = dayEntries(d);
  const open = P.expanded.has(d);
  if (!open) {
    const kc = list.reduce((s, e) => s + entryTotals(e).kcal, 0);
    const chips = list.map((e) => `<span class="pchip" data-e="${esc(e.id)}" style="--c:${slotVar(e.slot)}">${esc(entryName(e))}${simMap.get(e.id)?.length ? `<span class="star sm" data-star="${esc(e.id)}">${STAR}</span>` : ''}</span>`).join('');
    return `<div class="pt-day" data-date="${d}" data-drop-day="${d}">${dayLabel(d, false)}
      <button class="pt-coll" data-a="pl-day" data-date="${d}">${chips || '<span class="hint">пока пусто</span>'}${list.length ? `<span class="hint">${fmt(kc)} ккал на всех</span>` : ''}<span class="spacer"></span><span aria-hidden="true">▾</span></button></div>`;
  }
  const rows = list.map((e) => rowView(e, ps, simMap)).join('');
  const tt = dayTotals(d);
  const sum = Object.values(tt).reduce((s, t) => s + t.kcal, 0);
  const totals = `<div class="pt-totals">
    <div class="pt-tl"><b>Итого за день</b><div><button class="btn sm dark-soft" data-a="pl-add" data-date="${d}">+ блюдо</button><button class="btn sm dark-soft" data-a="pl-add" data-date="${d}" data-tab="ing">+ ингредиент</button></div></div>
    ${ps.map((p) => personTotal(p, tt[p.id])).join('')}
    <div class="pt-tsum"><b>${fmt(sum)}</b><small>ккал на всех</small></div></div>`;
  return `<div class="pt-day open" data-date="${d}" data-drop-day="${d}">${dayLabel(d, true)}
    <div class="pt-rows">${rows || `<div class="pt-emptyday">В этот день пока ничего. Добавьте блюдо кнопкой ниже или перетащите рецепт слева.</div>`}${totals}</div></div>`;
}

function personTotal(p, t) {
  const g = p.goals || {};
  const pct = g.kcal ? Math.round((t.kcal / g.kcal) * 100) : null;
  const over = (k) => g[k] && t[k] > g[k] * 1.1;
  return `<div class="pt-pt"><div class="pt-pth"><b class="${over('kcal') ? 'over' : ''}">${fmt(t.kcal)}</b><span>${pct == null ? '' : pct + '%'}</span></div>
    <div class="track dark"><i style="width:${Math.min(100, pct || 0)}%" class="${over('kcal') ? 'over' : ''}"></i></div>
    <small>Б <span class="${over('p') ? 'over' : ''}">${fmt(t.p)}</span> · Ж <span class="${over('f') ? 'over' : ''}">${fmt(t.f)}</span> · У <span class="${over('c') ? 'over' : ''}">${fmt(t.c)}</span></small></div>`;
}

function dishCell(e, simMap) {
  const sim = simMap.get(e.id) || [];
  const sub = e.kind === 'ing' ? 'ингредиент без рецепта' : (e.groupId ? 'группа · ' + Object.keys(e.recipes).length + ' вар. в приёме' : '');
  return `<div class="pt-dish${e.kind === 'ing' ? ' ing' : ''}" style="--c:${slotVar(e.slot)}">
    <button class="grip rowgrip" data-rowgrip="${esc(e.id)}" aria-label="Переместить внутри приёма: перетащите или стрелки вверх и вниз">${ICON.grip}</button>
    <button class="pt-dn" data-a="pl-dish" data-e="${esc(e.id)}"><small>${slotOf(e.slot).name}</small><b>${esc(entryName(e))}</b>${sub ? `<small>${sub}</small>` : ''}</button>
    ${sim.length ? `<button class="star" data-star="${esc(e.id)}" data-a="pl-star" data-e="${esc(e.id)}" aria-label="Похожие блюда рядом: ${sim.length}" title="Похожие блюда рядом (±5 дней)">${STAR}</button>` : ''}
  </div>`;
}

function stepInfo(e) {
  if (e.kind === 'dish') return { step: 0.5, min: 0.5, unit: '' };
  const x = getIng(e.ing);
  if (e.unit === 'pc') return { step: 0.5, min: 0.5, unit: (x && x.unitName) || 'шт' };
  return { step: 10, min: 10, unit: 'г' };
}
function stepper(e, pid, n) {
  const s = stepInfo(e);
  return `<span class="stp"><button data-a="pl-n" data-e="${esc(e.id)}" data-p="${esc(pid)}" data-d="-1" aria-label="Меньше" ${n <= s.min ? 'disabled' : ''}>−</button><b>${num(n)}${s.unit ? `<small>${s.unit}</small>` : ''}</b><button class="dark" data-a="pl-n" data-e="${esc(e.id)}" data-p="${esc(pid)}" data-d="1" aria-label="Больше">+</button></span>`;
}

function rowView(e, ps, simMap) {
  const cells = ps.map((p) => {
    const x = e.eaters && e.eaters[p.id];
    if (!x) return `<button class="pt-cell empty" data-a="pl-eater-add" data-e="${esc(e.id)}" data-p="${esc(p.id)}" data-drop-cell="${esc(e.id)}|${esc(p.id)}" aria-label="Добавить: ${esc(p.name)}">+ добавить</button>`;
    const v = eaterValues(e, p.id);
    const lab = variantLabel(e, p.id);
    return `<div class="pt-cell" data-drop-cell="${esc(e.id)}|${esc(p.id)}">
      <div class="pt-ct">${stepper(e, p.id, x.n)}<b class="kc">${fmt(v.kcal)}</b></div>
      <button class="pt-cb" data-a="pl-eater" data-e="${esc(e.id)}" data-p="${esc(p.id)}" aria-label="${esc(p.name)}: подробнее">Б ${fmt(v.p)} · Ж ${fmt(v.f)} · У ${fmt(v.c)}${lab ? `<span class="vchip${x.own ? ' own' : ''}">${esc(lab)}</span>` : ''}</button>
      <button class="pt-x" data-a="pl-eater-rm" data-e="${esc(e.id)}" data-p="${esc(p.id)}" aria-label="${esc(p.name)}: убрать из приёма">×</button></div>`;
  }).join('');
  const t = entryTotals(e);
  const s = stepInfo(e);
  return `<div class="pt-row" data-e="${esc(e.id)}">${dishCell(e, simMap)}${cells}
    <div class="pt-tot"><b>${fmt(t.kcal)}</b><small>${num(t.n)} ${e.kind === 'ing' ? s.unit : 'порц.'}</small></div></div>`;
}

function summaryView(ps, days) {
  const cols = ps.map((p) => {
    let sum = 0, n = 0;
    for (const d of days) { const t = dayTotals(d)[p.id]; if (t && t.kcal) { sum += t.kcal; n++; } }
    const g = p.goals || {};
    return `<span class="ps-avg">${ava(p, 'sm')}${n ? `${fmt(sum / n)}${g.kcal ? ' · ' + Math.round((sum / n / g.kcal) * 100) + '%' : ''}` : '—'}</span>`;
  }).join('');
  return `<div class="pt-sum"><b>В среднем в день</b><span class="hint">по дням, где есть приёмы</span>${cols}<span class="spacer"></span>
    <button class="btn sm" disabled title="Появится в версии 0.4">Покупки и гид · v0.4</button></div>`;
}

// ---------- телефон ----------
function phoneView(ps, days, simMap) {
  if (!days.includes(P.phoneDay)) P.phoneDay = days.includes(T) ? T : days[0];
  const d = P.phoneDay;
  const strip = days.map((x) => { const q = dayParts(x); return `<button class="pday${x === d ? ' on' : ''}${x === T ? ' today' : ''}" data-a="pl-phone-day" data-date="${x}"><small>${q.dow}</small><b>${q.d}</b></button>`; }).join('');
  const tt = dayTotals(d);
  const tot = `<div class="pp-tot"><div class="pp-toth"><b>Итого за день</b><span>${fmt(Object.values(tt).reduce((s, t) => s + t.kcal, 0))} ккал</span></div>
    <div class="pp-bars">${ps.map((p) => { const g = p.goals || {}; const t = tt[p.id]; const pct = g.kcal ? Math.round((t.kcal / g.kcal) * 100) : 0; const over = g.kcal && t.kcal > g.kcal * 1.1;
      return `<div><div class="pp-bh"><b>${esc(p.name)}</b><span class="${over ? 'over' : ''}">${pct ? pct + '%' : fmt(t.kcal)}</span></div><div class="track dark"><i style="width:${Math.min(100, pct)}%" class="${over ? 'over' : ''}"></i></div></div>`; }).join('')}</div></div>`;
  const cards = dayEntries(d).map((e) => {
    const t = entryTotals(e);
    const sim = simMap.get(e.id) || [];
    const rows = ps.filter((p) => e.eaters && e.eaters[p.id]).map((p) => {
      const x = e.eaters[p.id]; const v = eaterValues(e, p.id); const lab = variantLabel(e, p.id);
      return `<div class="pp-row"><button class="pp-who" data-a="pl-eater" data-e="${esc(e.id)}" data-p="${esc(p.id)}">${ava(p)}<span><b>${esc(p.name)}</b><small>${fmt(v.kcal)} ккал${lab ? ' · ' + esc(lab) : ''}</small></span></button>${stepper(e, p.id, x.n)}
        <button class="btn icon sm" data-a="pl-eater-rm" data-e="${esc(e.id)}" data-p="${esc(p.id)}" aria-label="Убрать ${esc(p.name)}">×</button></div>`;
    }).join('');
    const missing = ps.filter((p) => !(e.eaters && e.eaters[p.id]));
    return `<div class="pp-card" data-e="${esc(e.id)}"><div class="pp-ch${e.kind === 'ing' ? ' ing' : ''}" style="--c:${slotVar(e.slot)}"><button class="pp-cn" data-a="pl-dish" data-e="${esc(e.id)}"><small>${slotOf(e.slot).name}</small><b>${esc(entryName(e))}</b></button>
      ${sim.length ? `<span class="star" data-star="${esc(e.id)}" title="Похожие блюда рядом">${STAR}</span>` : ''}<span class="pp-ct">${fmt(t.kcal)}</span></div>
      <div class="pp-rows">${rows}${missing.length ? `<div class="pp-miss">${missing.map((p) => `<button class="btn sm ghost" data-a="pl-eater-add" data-e="${esc(e.id)}" data-p="${esc(p.id)}">+ ${esc(p.name)}</button>`).join('')}</div>` : ''}</div></div>`;
  }).join('');
  return `<div class="plan-phone only-narrow"><div class="pdays">${strip}</div>${tot}${cards || '<div class="empty">В этот день пока ничего.</div>'}
    <button class="fab" data-a="pl-add" data-date="${d}" aria-label="Добавить блюдо">+</button></div>`;
}

// ---------- запись изменений ----------
const getE = (id) => store.get('plan', id);
async function putE(e) { await store.put('plan', e); }
function withEater(e, pid, fn) { const eaters = { ...e.eaters }; eaters[pid] = fn(eaters[pid] ? { ...eaters[pid] } : null); if (!eaters[pid]) delete eaters[pid]; return { ...e, eaters }; }

actions['pl-prev'] = () => { shift(-1); refresh(); };
actions['pl-next'] = () => { shift(1); refresh(); };
actions['pl-today'] = () => { const t = today(); setLen(P.len === 'custom' ? 'week' : P.len, t); P.expanded = new Set([t]); P.phoneDay = t; refresh(); };
actions['pl-len'] = (t) => {
  if (t.dataset.v === 'custom') { openLayer({ type: 'dialog', kind: 'pl-range' }); return; }
  setLen(t.dataset.v, P.len === 'month' ? today() : P.from); refresh();
};
actions['pl-day'] = (t) => { const d = t.dataset.date; if (P.expanded.has(d)) P.expanded.delete(d); else P.expanded.add(d); refresh(); const b = $(`.pt-dl[data-date="${d}"]`); if (b) b.focus(); };
actions['pl-phone-day'] = (t) => { P.phoneDay = t.dataset.date; refresh(); };
actions['pl-n'] = async (t) => {
  const e = getE(t.dataset.e); const pid = t.dataset.p; if (!e || !e.eaters[pid]) return;
  const s = stepInfo(e);
  const n = Math.max(s.min, Math.round((e.eaters[pid].n + Number(t.dataset.d) * s.step) * 100) / 100);
  await putE(withEater(e, pid, (x) => ({ ...x, n })));
  const b = $(`[data-a="pl-n"][data-e="${CSS.escape(e.id)}"][data-p="${CSS.escape(pid)}"][data-d="${t.dataset.d}"]:not([disabled])`); if (b) b.focus();
};
actions['pl-eater-rm'] = async (t) => {
  const e = getE(t.dataset.e); if (!e) return;
  const p = store.get('persons', t.dataset.p);
  await putE(withEater(e, t.dataset.p, () => null));
  if (topLayer() && topLayer().kind === 'pl-eater') closeLayer();
  showToast(`Персона ${p ? p.name : ''} убрана из приёма «${entryName(e)}»`);
};
actions['pl-eater-add'] = async (t) => {
  const e = getE(t.dataset.e); if (!e) return;
  const n = e.kind === 'dish' ? 1 : (e.unit === 'pc' ? 1 : 100);
  await putE(withEater(e, t.dataset.p, () => (e.kind === 'dish' ? { n, rid: e.main, own: null } : { n })));
};
actions['pl-eater'] = (t) => openLayer({ type: 'dialog', kind: 'pl-eater', e: t.dataset.e, p: t.dataset.p });
actions['pl-dish'] = (t) => openLayer({ type: 'dialog', kind: 'pl-dish', e: t.dataset.e, date: (getE(t.dataset.e) || {}).date });
actions['pl-star'] = (t) => { P.hl = P.hl === t.dataset.e ? null : t.dataset.e; highlight(P.hl); };
actions['pl-add'] = (t) => openAdd({ date: t.dataset.date, tab: t.dataset.tab || 'dish' });
actions['pl-side-slot'] = (t) => { P.side.slot = P.side.slot === t.dataset.v ? null : t.dataset.v; $('#plan-side').innerHTML = sideView(); };
actions['pl-side-group'] = (t) => { const id = t.dataset.id; if (P.side.open.has(id)) P.side.open.delete(id); else P.side.open.add(id); $('#plan-side').innerHTML = sideView(); };
actions['pl-side-pick'] = (t) => {
  const d = [...P.expanded].filter((x) => x >= P.from && x <= P.to).sort()[0] || (T >= P.from && T <= P.to ? T : P.from);
  openAdd({ date: d, rid: t.dataset.rid });
};

// ---------- подсветка похожих («*») ----------
export function highlight(id) {
  $$('.hl').forEach((x) => x.classList.remove('hl'));
  if (!id) return;
  const e = getE(id); if (!e) return;
  for (const o of [e, ...similar(e)]) $$(`[data-e="${CSS.escape(o.id)}"]`).forEach((x) => { if (x.matches('.pt-row, .pchip, .pp-card')) x.classList.add('hl'); });
}
document.addEventListener('mouseover', (ev) => {
  const s = ev.target.closest && ev.target.closest('[data-star]');
  if (s) highlight(s.dataset.star); else if (!P.hl && document.querySelector('.hl')) highlight(null);
});

// ---------- добавить блюдо / ингредиент (12F) ----------
hooks.openAdd = (o) => openAdd(o);
export function openAdd({ date, tab = 'dish', rid = null, gid = null, slot = null }) {
  const l = { type: 'dialog', kind: 'pl-add', date: date || today(), tab, q: '', pick: null, slot: slot || 'lunch', who: {}, unit: 'g' };
  for (const p of persons()) l.who[p.id] = { on: true, n: 1, rid: null };
  if (rid || gid) pick(l, rid ? { rid } : { gid });
  openLayer(l);
}
function pick(l, what) {
  l.pick = what;
  if (what.rid) {
    const r = store.get('recipes', what.rid);
    const g = r && r.groupId && store.get('groups', r.groupId) ? r.groupId : null;
    l.pick = g ? { gid: g, rid: r.id } : { rid: r.id };
    if (r && !slotChosen(l)) l.slot = defaultSlot(r);
    for (const w of Object.values(l.who)) w.rid = r.id;
  } else if (what.gid) {
    const m = members(what.gid); const r = m[0];
    l.pick = { gid: what.gid, rid: r ? r.id : null };
    if (r && !slotChosen(l)) l.slot = defaultSlot(r);
    for (const w of Object.values(l.who)) w.rid = r ? r.id : null;
  } else if (what.ing) {
    const x = getIng(what.ing);
    l.unit = x && x.unitWeight ? 'pc' : 'g';
    for (const w of Object.values(l.who)) w.n = l.unit === 'pc' ? 1 : 100;
  }
}
const slotChosen = (l) => l._slotTouched;

function addList(l) {
  const q = norm(l.q).trim();
  if (l.tab === 'ing') {
    const list = store.list('ingredients').filter((x) => !q || norm(x.name).includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'ru')).slice(0, 60);
    return list.map((x) => `<button class="pa-item${l.pick && l.pick.ing === x.id ? ' on' : ''}" data-a="pa-pick" data-ing="${esc(x.id)}"><b>${esc(x.name)}</b><small>${fmt(x.kcal * 100)} ккал / 100 г${x.unitWeight ? ' · 1 ' + esc(x.unitName || 'шт') + ' = ' + fmt(x.unitWeight) + ' г' : ''}</small></button>`).join('') || '<p class="hint">Ничего не нашлось</p>';
  }
  const tag = slotOf(l.slot).tag;
  const ok = (r) => !q || norm(r.name).includes(q) || (r.ingredients || []).some((x) => { const i = getIng(x.ing); return i && norm(i.name).includes(q); });
  const items = [];
  for (const g of store.list('groups')) { const m = members(g.id); if (m.some(ok) || (q && norm(g.name).includes(q))) items.push({ g, m, fit: m.some((r) => (r.tags || []).includes(tag)) }); }
  for (const r of store.list('recipes')) if ((!r.groupId || !store.get('groups', r.groupId)) && ok(r)) items.push({ r, fit: (r.tags || []).includes(tag) });
  items.sort((a, b) => (b.fit - a.fit) || (a.g ? a.g.name : a.r.name).localeCompare(b.g ? b.g.name : b.r.name, 'ru'));
  return items.slice(0, 60).map((x) => {
    if (x.g) {
      const on = l.pick && l.pick.gid === x.g.id;
      return `<button class="pa-item${on ? ' on' : ''}" data-a="pa-pick" data-gid="${esc(x.g.id)}"><b>${esc(x.g.name)} <span class="chip-s dark">группа · ${x.m.length}</span></b><small>${x.m.map((r) => esc(r.name)).join(' · ')}</small></button>`;
    }
    const r = x.r; const on = l.pick && l.pick.rid === r.id && !l.pick.gid;
    return `<button class="pa-item${on ? ' on' : ''}" data-a="pa-pick" data-rid="${esc(r.id)}"><b>${esc(r.name)}</b><small>${fmt(perPortion(snap(r)).kcal)} ккал на порцию</small></button>`;
  }).join('') || '<p class="hint">Ничего не нашлось</p>';
}

function addWho(l) {
  if (!l.pick) return `<p class="hint">${l.tab === 'ing' ? 'Выберите ингредиент слева.' : 'Выберите блюдо слева — поиск работает и по ингредиентам.'}</p>`;
  const ps = persons();
  const grp = l.pick.gid ? members(l.pick.gid) : null;
  const x = l.pick.ing ? getIng(l.pick.ing) : null;
  const unitSeg = x && x.unitWeight ? `<div class="seg sm"><button data-a="pa-unit" data-v="pc" aria-pressed="${l.unit === 'pc'}">${esc(x.unitName || 'шт')}</button><button data-a="pa-unit" data-v="g" aria-pressed="${l.unit === 'g'}">г</button></div>` : '';
  const rows = ps.map((p) => {
    const w = l.who[p.id];
    if (!w.on) return `<div class="pa-row off">${ava(p)}<b>${esc(p.name)}</b><span class="spacer"></span><button class="btn sm ghost" data-a="pa-who" data-p="${esc(p.id)}">+ добавить</button></div>`;
    const sel = grp ? `<select data-f="pa-rid" data-p="${esc(p.id)}" aria-label="Вариант для ${esc(p.name)}">${grp.map((r) => `<option value="${esc(r.id)}" ${r.id === w.rid ? 'selected' : ''}>${esc(r.name)} · ${fmt(perPortion(snap(r)).kcal)}</option>`).join('')}</select>` : '';
    const s = l.tab === 'ing' ? (l.unit === 'pc' ? { step: 0.5, min: 0.5 } : { step: 10, min: 10 }) : { step: 0.5, min: 0.5 };
    return `<div class="pa-row">${ava(p)}<div class="pa-rn"><b>${esc(p.name)}</b>${sel}</div>
      <span class="stp"><button data-a="pa-n" data-p="${esc(p.id)}" data-d="-${s.step}" ${w.n <= s.min ? 'disabled' : ''} aria-label="Меньше">−</button><b>${num(w.n)}</b><button class="dark" data-a="pa-n" data-p="${esc(p.id)}" data-d="${s.step}" aria-label="Больше">+</button></span>
      <button class="btn icon sm" data-a="pa-who" data-p="${esc(p.id)}" aria-label="Убрать ${esc(p.name)}">×</button></div>`;
  }).join('');
  return `<div class="pa-wh"><b>Кому и сколько${grp ? ' · вариант' : ''}</b>${unitSeg}</div>${rows}
    <p class="hint">${l.tab === 'ing' ? (l.unit === 'pc' ? 'Шаг 0,5 шт.' : 'Шаг 10 г.') : 'По умолчанию всем по 1 порции' + (grp ? ' варианта «по умолчанию»' : '') + '. Шаг 0,5, меньше 0,5 нельзя.'}</p>`;
}

function addGoText(l) {
  if (!l.pick) return 'Выберите, что добавить';
  let n = 0, k = 0;
  for (const [pid, w] of Object.entries(l.who)) {
    if (!w.on) continue;
    n += w.n;
    if (l.pick.ing) { const x = getIng(l.pick.ing); const g = l.unit === 'pc' && x && x.unitWeight ? w.n * x.unitWeight : w.n; k += x ? x.kcal * g : 0; }
    else { const r = store.get('recipes', w.rid); if (r) k += perPortion(snap(r)).kcal * w.n; }
  }
  const unit = l.pick.ing ? (l.unit === 'pc' ? 'шт' : 'г') : plural(Math.ceil(n), 'порция', 'порции', 'порций');
  return `В ${slotOf(l.slot).name} · ${num(n)} ${unit} · ${fmt(k)} ккал`;
}

function addView(l) {
  const dp = dayParts(l.date);
  return `<section class="dialog pa" role="dialog" aria-modal="true" aria-labelledby="pa-title"><div class="dlg-body">
    <div class="pa-h"><h2 id="pa-title">Добавить в ${dp.dow}, ${dp.d} ${dp.mon}</h2>
      <label class="pa-date"><span class="sr-only">Дата</span><input type="date" id="pa-date" value="${l.date}"></label><span class="spacer"></span>
      <div class="seg sm" role="tablist"><button role="tab" data-a="pa-tab" data-v="dish" aria-selected="${l.tab === 'dish'}" aria-pressed="${l.tab === 'dish'}">Блюдо</button><button role="tab" data-a="pa-tab" data-v="ing" aria-selected="${l.tab === 'ing'}" aria-pressed="${l.tab === 'ing'}">Ингредиент</button></div>
      <button class="btn icon sm" data-a="layer-close" aria-label="Закрыть">×</button></div>
    <div class="pa-slots" role="group" aria-label="Приём">${SLOTS.map((s) => `<button class="chip meal" style="--c:${slotVar(s.id)}" data-a="pa-slot" data-v="${s.id}" aria-pressed="${l.slot === s.id}">${s.name}</button>`).join('')}</div>
    <label class="search">${ICON.search}<span class="sr-only">Поиск</span><input id="pa-q" type="search" value="${esc(l.q)}" placeholder="${l.tab === 'ing' ? 'Найти ингредиент' : 'Блюдо или ингредиент'}" autocomplete="off" data-autofocus></label>
    <div class="pa-cols"><div class="pa-list" id="pa-list" data-scroll="pa-list">${addList(l)}</div><div class="pa-who panel" id="pa-who">${addWho(l)}</div></div>
    <p class="err" id="pa-err" role="alert"></p></div>
    <div class="dlg-foot"><button class="btn acc wide" data-a="pa-go" id="pa-go" ${l.pick ? '' : 'disabled'}>${addGoText(l)}</button></div></section>`;
}
function paUpdate(l, parts = ['list', 'who', 'go']) {
  if (parts.includes('list')) { const el = $('#pa-list'); if (el) el.innerHTML = addList(l); }
  if (parts.includes('who')) { const el = $('#pa-who'); if (el) el.innerHTML = addWho(l); }
  if (parts.includes('go')) { const b = $('#pa-go'); if (b) { b.textContent = addGoText(l); b.disabled = !l.pick; } }
}
const paL = () => { const l = topLayer(); return l && l.kind === 'pl-add' ? l : null; };
actions['pa-tab'] = (t) => { const l = paL(); l.tab = t.dataset.v; l.pick = null; l.q = ''; hooks.renderOverlay(); };
actions['pa-slot'] = (t) => { const l = paL(); l.slot = t.dataset.v; l._slotTouched = true; $$('[data-a="pa-slot"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === l.slot))); paUpdate(l, ['list', 'go']); };
actions['pa-pick'] = (t) => { const l = paL(); pick(l, t.dataset.ing ? { ing: t.dataset.ing } : t.dataset.gid ? { gid: t.dataset.gid } : { rid: t.dataset.rid });
  $$('[data-a="pa-slot"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === l.slot))); paUpdate(l); };
actions['pa-who'] = (t) => { const l = paL(); const w = l.who[t.dataset.p]; w.on = !w.on; if (w.on && !w.rid && l.pick) w.rid = l.pick.rid; paUpdate(l, ['who', 'go']); };
actions['pa-n'] = (t) => { const l = paL(); const w = l.who[t.dataset.p]; const d = Number(t.dataset.d); const min = Math.abs(d); w.n = Math.max(min, Math.round((w.n + d) * 100) / 100); paUpdate(l, ['who', 'go']); const b = $(`[data-a="pa-n"][data-p="${CSS.escape(t.dataset.p)}"][data-d="${t.dataset.d}"]:not([disabled])`); if (b) b.focus(); };
actions['pa-unit'] = (t) => { const l = paL(); l.unit = t.dataset.v; for (const w of Object.values(l.who)) w.n = l.unit === 'pc' ? 1 : 100; paUpdate(l, ['who', 'go']); };
actions['pa-go'] = async () => {
  const l = paL(); if (!l || !l.pick) return;
  const on = Object.entries(l.who).filter(([, w]) => w.on);
  if (!on.length) { $('#pa-err').textContent = 'Выберите хотя бы одного человека.'; return; }
  const date = l.date;
  let e;
  if (l.pick.ing) {
    e = { id: store.newId('pl'), date, cookDate: date, slot: l.slot, order: nextOrder(date, l.slot), kind: 'ing', ing: l.pick.ing, unit: l.unit, eaters: {} };
    for (const [pid, w] of on) e.eaters[pid] = { n: w.n };
  } else {
    const recipes = {};
    const main = l.pick.gid ? (members(l.pick.gid)[0] || {}).id : l.pick.rid;
    for (const [, w] of on) { const r = store.get('recipes', w.rid || main); if (r) recipes[r.id] = snap(r); }
    const mr = store.get('recipes', main); if (mr) recipes[mr.id] = snap(mr);
    const g = l.pick.gid ? store.get('groups', l.pick.gid) : null;
    e = { id: store.newId('pl'), date, cookDate: date, slot: l.slot, order: nextOrder(date, l.slot), kind: 'dish',
      title: g ? g.name : (mr ? mr.name : ''), groupId: g ? g.id : null, main, recipes, eaters: {} };
    for (const [pid, w] of on) e.eaters[pid] = { n: w.n, rid: w.rid || main, own: null };
  }
  await putE(e);
  closeLayer();
  P.expanded.add(date); P.phoneDay = date;
  if (date < P.from || date > P.to) { setLen(P.len === 'custom' ? 'week' : P.len, date); }
  showToast(`${entryName(e)} → ${slotOf(e.slot).name}, ${dayParts(date).dow} ${dayParts(date).d}`);
  hooks.refreshPage();
};

// ---------- окно персоны в приёме ----------
function eaterView(l) {
  const e = getE(l.e); const p = store.get('persons', l.p);
  if (!e || !p || !e.eaters[l.p]) return `<section class="dialog small"><div class="dlg-body"><h2>Уже удалено</h2></div><div class="dlg-foot"><button class="btn" data-a="layer-close">Закрыть</button></div></section>`;
  const x = e.eaters[l.p]; const v = eaterValues(e, l.p);
  let variants = '', own = '';
  if (e.kind === 'dish') {
    const ids = new Set(Object.keys(e.recipes));
    const opts = e.groupId && store.get('groups', e.groupId) ? members(e.groupId).map((r) => ({ id: r.id, name: r.name })) : [];
    for (const id of ids) if (!opts.some((o) => o.id === id)) opts.push({ id, name: e.recipes[id].name });
    if (opts.length > 1) variants = `<div class="chips-w">${opts.map((o) => `<button class="chip" data-a="pe-var" data-rid="${esc(o.id)}" aria-pressed="${!x.own && x.rid === o.id}">${esc(o.name)}</button>`).join('')}</div>`;
    if (x.own) {
      const d = diffOwn(e.recipes[x.rid] || e.recipes[e.main], x.own);
      own = `<div class="own-box"><b>Свой вариант:</b> ${d.map((z) => esc(z.text)).join(', ') || 'шаги или описание'} · ${fmt(perPortion(x.own).kcal)} ккал на порцию</div>`;
    }
  }
  return `<section class="dialog small pe" role="dialog" aria-modal="true" aria-labelledby="pe-title"><div class="dlg-body">
    <div class="pe-h">${ava(p, 'lg')}<div><h2 id="pe-title">${esc(p.name)} · ${slotOf(e.slot).name}</h2><span class="hint">${esc(entryName(e))} · ${dayParts(e.date).dow} ${dayParts(e.date).d}</span></div><span class="spacer"></span>${stepper(e, l.p, x.n)}</div>
    <p class="hint">${fmt(v.kcal)} ккал · Б ${fmt(v.p)} · Ж ${fmt(v.f)} · У ${fmt(v.c)}</p>
    ${variants}${own}
    <div class="menu-list">
      ${e.kind === 'dish' ? `<button data-a="pe-edit">✎ Изменить состав — только в этом приёме…</button>` : ''}
      ${e.kind === 'dish' && x.own ? `<button data-a="pe-reset">↺ Как в рецепте</button><button data-a="pe-save" class="acc-t">+ Сохранить как рецепт…</button>` : ''}
      <button data-a="pl-eater-rm" data-e="${esc(e.id)}" data-p="${esc(p.id)}" class="danger">× Убрать из этого приёма</button>
    </div></div><div class="dlg-foot"><button class="btn" data-a="layer-close">Готово</button></div></section>`;
}
actions['pe-var'] = async (t) => {
  const l = topLayer(); const e = getE(l.e); if (!e) return;
  const rid = t.dataset.rid;
  const recipes = { ...e.recipes };
  if (!recipes[rid]) { const r = store.get('recipes', rid); if (!r) return; recipes[rid] = snap(r); }
  const had = e.eaters[l.p].own;
  await putE({ ...withEater(e, l.p, (x) => ({ ...x, rid, own: null })), recipes });
  if (had) showToast('Свой вариант заменён выбранным рецептом');
  hooks.renderOverlay();
};
actions['pe-reset'] = async () => { const l = topLayer(); const e = getE(l.e); await putE(withEater(e, l.p, (x) => ({ ...x, own: null }))); hooks.renderOverlay(); };
actions['pe-edit'] = () => { const l = topLayer(); hooks.openInstance(l.e, l.p); };
actions['pe-save'] = () => { const l = topLayer(); const e = getE(l.e); openLayer({ type: 'dialog', kind: 'pl-inst-save', e: l.e, p: l.p, own: e.eaters[l.p].own }); };

// ---------- меню блюда ----------
function dishMenuView(l) {
  const e = getE(l.e); if (!e) return '';
  const base = e.kind === 'dish' ? store.get('recipes', e.main) : null;
  return `<section class="dialog small" role="dialog" aria-modal="true" aria-labelledby="pd-title"><div class="dlg-body">
    <h2 id="pd-title">${esc(entryName(e))}</h2><span class="hint">${dayParts(e.date).dow}, ${dayParts(e.date).d} ${dayParts(e.date).monf} · ${slotOf(e.slot).name}</span>
    <div class="pa-slots" role="group" aria-label="Приём">${SLOTS.map((s) => `<button class="chip meal" style="--c:${slotVar(s.id)}" data-a="pd-slot" data-v="${s.id}" aria-pressed="${e.slot === s.id}">${s.name}</button>`).join('')}</div>
    <div class="pd-move"><label class="field"><span>Перенести на день</span><input type="date" id="pd-date" value="${l.date}"></label><button class="btn" data-a="pd-move">Перенести</button></div>
    <div class="menu-list">${base ? `<button data-a="pd-open">Открыть рецепт «${esc(base.name)}»</button>` : ''}
      <button data-a="pd-del" class="danger">Удалить из плана</button></div></div>
    <div class="dlg-foot"><button class="btn" data-a="layer-close">Готово</button></div></section>`;
}
actions['pd-slot'] = async (t) => { const l = topLayer(); const e = getE(l.e); if (e.slot === t.dataset.v) return; await putE({ ...e, slot: t.dataset.v, order: nextOrder(e.date, t.dataset.v) }); hooks.renderOverlay(); };
actions['pd-move'] = async () => {
  const l = topLayer(); const e = getE(l.e); const d = $('#pd-date').value; if (!d || d === e.date) return;
  await putE({ ...e, date: d, cookDate: d, order: nextOrder(d, e.slot) });
  closeLayer(); P.expanded.add(d); showToast(`«${entryName(e)}» перенесено на ${dayParts(d).dow} ${dayParts(d).d}`);
};
actions['pd-open'] = () => { const l = topLayer(); const e = getE(l.e); closeLayer(); openLayer({ type: 'recipe', id: e.main, mode: 'view' }); };
actions['pd-del'] = async () => { const l = topLayer(); const e = getE(l.e); await store.remove('plan', e.id); closeLayer(); showToast(`«${entryName(e)}» удалено из плана`); };

// ---------- свой период ----------
function rangeView() {
  return `<section class="dialog small" role="dialog" aria-modal="true" aria-labelledby="pr-title"><div class="dlg-body"><h2 id="pr-title">Свой период</h2>
    <div class="grid2"><label class="field"><span>С</span><input type="date" id="pr-from" value="${P.from}"></label><label class="field"><span>По</span><input type="date" id="pr-to" value="${P.to}"></label></div>
    <p class="err" id="pr-err" role="alert"></p></div><div class="dlg-foot"><button class="btn" data-a="layer-close">Отмена</button><button class="btn acc" data-a="pr-ok">Показать</button></div></section>`;
}
actions['pr-ok'] = () => {
  const f = $('#pr-from').value, t = $('#pr-to').value;
  if (!f || !t || t < f) { $('#pr-err').textContent = 'Проверьте даты: «по» не раньше «с».'; return; }
  if (diffDays(t, f) > 92) { $('#pr-err').textContent = 'Не больше трёх месяцев.'; return; }
  P.len = 'custom'; P.from = f; P.to = t; closeLayer(); refresh();
};

// ---------- экземпляр → рецепт (12E) ----------
function instSaveView(l) {
  const e = getE(l.e); const p = store.get('persons', l.p); if (!e || !p) return '';
  const x = e.eaters[l.p]; const base = e.recipes[x.rid] || e.recipes[e.main];
  const dbBase = base && store.get('recipes', base.id);
  const g = dbBase && dbBase.groupId ? store.get('groups', dbBase.groupId) : null;
  const d = diffOwn(base, l.own);
  return `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="is-title"><div class="dlg-body">
    <h2 id="is-title">Сохранить как рецепт</h2><p class="hint">Свой вариант ${esc(p.name)} (${dayParts(e.date).dow} ${dayParts(e.date).d}, ${slotOf(e.slot).name}): ${d.map((z) => esc(z.text)).join(', ') || 'изменены шаги или описание'}. Количество пересчитается на число порций рецепта.</p>
    <div class="grid-name"><label class="field"><span>Название рецепта</span><input id="is-name" value="${esc((base ? base.name : 'Рецепт') + ' (свой)')}" data-autofocus></label>
      <label class="field"><span>Порций в рецепте</span><input id="is-serv" inputmode="decimal" value="${base ? fmt(base.servings, 1) : 1}"></label></div>
    ${dbBase ? `<label class="radio"><input type="radio" name="is-kind" value="group" checked><span><b>Вариант в группе «${esc(g ? g.name : dbBase.name)}»</b><small>${g ? 'Рядом с другими рецептами группы.' : 'У рецепта «' + esc(dbBase.name) + '» появится группа.'}</small></span></label>` : ''}
    <label class="radio"><input type="radio" name="is-kind" value="solo" ${dbBase ? '' : 'checked'}><span><b>Отдельный рецепт</b><small>Без связи с «${esc(base ? base.name : '')}».</small></span></label>
    <label class="check-line"><input type="checkbox" id="is-replace" checked> В этом приёме заменить свой вариант новым рецептом</label>
    <p class="err" id="is-err" role="alert"></p></div>
    <div class="dlg-foot"><button class="btn" data-a="layer-close">Отмена</button><button class="btn acc" data-a="is-save">Сохранить рецепт</button></div></section>`;
}
actions['is-save'] = async () => {
  const l = topLayer(); const e = getE(l.e); const x = e.eaters[l.p];
  const name = $('#is-name').value.trim(); const serv = Number(String($('#is-serv').value).replace(',', '.'));
  if (!name) { $('#is-err').textContent = 'Введите название.'; return; }
  if (!(serv > 0)) { $('#is-err').textContent = 'Порций — число больше 0.'; return; }
  const base = e.recipes[x.rid] || e.recipes[e.main];
  const dbBase = base && store.get('recipes', base.id);
  const kind = ($('input[name="is-kind"]:checked') || {}).value || 'solo';
  const own = l.own;
  const rec = { id: store.newId('rec'), name, servings: serv, groupId: null, custom: true,
    ingredients: own.ingredients.map((z) => ({ ing: z.ing, g: Math.round((z.g / (own.servings || 1)) * serv * 100) / 100, unit: z.unit || 'g' })),
    steps: [...(own.steps || [])], desc: own.desc || '', tags: [...(own.tags || [])] };
  const changes = [];
  let gid = null;
  if (kind === 'group' && dbBase) {
    const g = dbBase.groupId ? store.get('groups', dbBase.groupId) : null;
    if (g) { gid = g.id; changes.push({ coll: 'groups', rec: { ...g, order: [...members(g.id).map((r) => r.id), rec.id] } }); }
    else { gid = store.newId('grp'); changes.push({ coll: 'groups', rec: { id: gid, name: dbBase.name, order: [dbBase.id, rec.id] } }); changes.push({ coll: 'recipes', rec: { ...dbBase, groupId: gid } }); }
  }
  rec.groupId = gid;
  changes.push({ coll: 'recipes', rec });
  if ($('#is-replace').checked) {
    const upd = { ...e, recipes: { ...e.recipes, [rec.id]: snap(rec) }, eaters: { ...e.eaters, [l.p]: { ...x, rid: rec.id, own: null } } };
    if (gid && !e.groupId) { upd.groupId = gid; upd.title = dbBase.name; }
    changes.push({ coll: 'plan', rec: upd });
  }
  await store.putAll(changes);
  ui.layers = ui.layers.filter((z) => !(z.kind === 'pl-inst-save' || z.kind === 'pl-eater' || (z.type === 'recipe' && z.inst)));
  hooks.renderOverlay();
  showToast(`Рецепт «${name}» сохранён${gid ? ' в группе' : ''}`);
};

export function dialogView(l) {
  if (l.kind === 'pl-add') return addView(l);
  if (l.kind === 'pl-eater') return eaterView(l);
  if (l.kind === 'pl-dish') return dishMenuView(l);
  if (l.kind === 'pl-range') return rangeView();
  if (l.kind === 'pl-inst-save') return instSaveView(l);
  return '';
}

export function onInput(e) {
  const t = e.target;
  if (t.id === 'ps-q') { P.side.q = t.value; const el = $('#ps-list'); if (el) { const tmp = document.createElement('div'); tmp.innerHTML = sideView(); el.innerHTML = tmp.querySelector('#ps-list').innerHTML; } return true; }
  const l = paL();
  if (l && t.id === 'pa-q') { l.q = t.value; paUpdate(l, ['list']); return true; }
  if (l && t.id === 'pa-date') { if (t.value) { l.date = t.value; const h = $('#pa-title'); const dp = dayParts(l.date); if (h) h.textContent = `Добавить в ${dp.dow}, ${dp.d} ${dp.mon}`; } return true; }
  if (l && t.dataset.f === 'pa-rid') { l.who[t.dataset.p].rid = t.value; paUpdate(l, ['go']); return true; }
  return false;
}
export function onKeydown(e) {
  if (e.target.id === 'pa-q' && e.key === 'Enter') { e.preventDefault(); const f = $('#pa-list .pa-item'); if (f) f.click(); return true; }
  return false;
}
export { stepInfo, getE, putE, P as planState, setLen };
export const _unused = { iso, eaterRecipe, ingGrams };
