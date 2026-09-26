// «Рацион.» v0.2 — каркас приложения: вход, разделы, слои поверх страницы, события.
import * as store from './store.js';
import { CONFIG } from './config.js';
import { ui, actions, hooks, closeLayer, closeAll, topLayer } from './ui.js';
import { $, $$, esc, showToast, ICON } from './util.js';
import * as ING from './ingredients.js';
import * as GRP from './groups.js';
import * as RECS from './recipes.js';
import * as REC from './recipe.js';
import { isDragging } from './recipe-dnd.js';
import * as PLAN from './plan.js';
import * as PER from './persons.js';
import * as TAGS from './tags.js';
import * as PDND from './plan-dnd.js';

const NAV_ICON = {
  plan: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  recipes: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/></svg>',
  ingredients: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 8h16l-2 11H6z"/><path d="M9 8l3-4 3 4"/></svg>',
  persons: ICON.person,
};
const ROUTES = [
  { id: 'plan', name: 'План' },
  { id: 'recipes', name: 'Рецепты' },
  { id: 'ingredients', name: 'Ингредиенты' },
  { id: 'persons', name: 'Персоны' },
];
function route() {
  const r = (location.hash || '').replace(/^#\/?/, '');
  if (r === 'tags') return r;
  return ROUTES.find((x) => x.id === r) ? r : 'plan';
}

window.addEventListener('ration:toast', (e) => showToast(e.detail.text, e.detail.kind));

async function withBusy(fn) {
  if (ui.busy) return;
  ui.busy = true; render();
  try { await fn(); } catch (e) {
    console.error(e);
    showToast(e.message || String(e), 'error', 8000);
  } finally { ui.busy = false; render(); }
}

// ---------------- экраны входа ----------------
function welcomeView() {
  return `<div class="welcome"><div class="card">
    <h1>рацион<i>.</i></h1>
    <p>Планировщик еды: рецепты, КБЖУ, порции для каждого и список покупок. Все данные хранятся в папке «${esc(CONFIG.folderName)}» на вашем Google Диске.</p>
    <div class="actions">
      <button class="btn acc lg" data-a="connect" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Подключаюсь…' : 'Войти через Google'}</button>
      <button class="btn lg" data-a="local" ${ui.busy ? 'disabled' : ''}>Попробовать без входа</button>
    </div>
    <p class="fine">Без входа данные останутся только на этом устройстве. Подключить Google Диск можно позже, изменения не потеряются.</p>
  </div></div>`;
}

function setupView() {
  const u = store.state.meta && store.state.meta.user;
  return `<div class="welcome"><div class="card">
    <h1>База на Диске</h1>
    <p>${u ? 'Вы вошли как <b>' + esc(u.email) + '</b>. ' : ''}На вашем Google Диске пока нет базы «Рациона».</p>
    <div class="actions">
      <button class="btn acc lg" data-a="create" ${ui.busy ? 'disabled' : ''}>Создать новую базу</button>
      <p class="fine">Создаст папку «${esc(CONFIG.folderName)}» с файлом ${esc(CONFIG.fileName)}. В базу сразу попадут 91 ингредиент и 94 рецепта${store.state.data ? ' и все изменения, сделанные на этом устройстве' : ''}.</p>
      <button class="btn lg" data-a="join" ${ui.busy ? 'disabled' : ''}>Подключить общую базу</button>
      <p class="fine">Если владелец поделился с вами папкой «${esc(CONFIG.folderName)}», выберите в ней файл ${esc(CONFIG.fileName)}.</p>
      <button class="btn ghost" data-a="setup-later" ${ui.busy ? 'disabled' : ''}>Пока без Диска</button>
    </div>
  </div></div>`;
}

// ---------------- шапка ----------------
function syncLabel() {
  const s = store.state.status, m = store.state.meta || {};
  const t = m.lastSync ? new Date(m.lastSync).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
  return {
    local: 'Только на этом устройстве', synced: 'Сохранено на Диске' + (t ? ' · ' + t : ''), dirty: 'Есть несохранённые изменения',
    syncing: 'Сохраняю на Диск…', offline: 'Нет сети · сохраню позже', auth: 'Войти, чтобы сохранить на Диск',
    error: 'Ошибка сохранения · повторить', idle: '',
  }[s] || '';
}

function topView(r) {
  const u = store.state.meta && store.state.meta.user;
  const ini = u && u.name ? esc(u.name.trim()[0].toUpperCase()) : ICON.person;
  const link = (x, cls) => (x.id === r
    ? `<a href="#/${x.id}" aria-current="page" class="${cls}">${cls === 'tab' ? NAV_ICON[x.id] : ''}<span>${x.name}</span></a>`
    : `<a href="#/${x.id}" class="${cls}${x.soon ? ' soon' : ''}">${cls === 'tab' ? NAV_ICON[x.id] : ''}<span>${x.name}</span>${x.soon && cls !== 'tab' ? ` <small>${x.soon}</small>` : ''}</a>`);
  return `<header class="top">
    <span class="brand">рацион<i>.</i></span>
    <nav class="nav" aria-label="Разделы">${ROUTES.map((x) => link(x, '')).join('')}</nav>
    <span class="spacer"></span>
    <button class="sync" id="sync" data-a="sync-chip" data-s="${store.state.status}" title="${esc(store.state.error)}"><span class="dot"></span><span>${esc(syncLabel())}</span></button>
    <button class="avatar" data-a="menu" aria-label="Аккаунт и настройки">${ini}</button>
  </header>
  <nav class="tabbar" aria-label="Разделы">${ROUTES.map((x) => link(x, 'tab')).join('')}</nav>`;
}

function updateSyncChip() {
  const el = $('#sync');
  if (!el) return;
  el.dataset.s = store.state.status;
  el.title = store.state.error || '';
  el.lastElementChild.textContent = syncLabel();
}

function menuView() {
  const m = store.state.meta || {};
  const u = m.user;
  const drv = m.mode === 'drive';
  return `<div class="menu" role="menu" aria-label="Аккаунт и настройки">
    <div class="who">${u ? `<b>${esc(u.name || '')}</b>${esc(u.email)}` : '<b>Без входа</b>Данные только на этом устройстве'}</div>
    ${!drv ? '<button role="menuitem" data-a="connect">Войти и подключить Google Диск</button>' : ''}
    ${drv ? '<button role="menuitem" data-a="sync-now">Сохранить на Диск сейчас</button>' : ''}
    ${drv && m.fileLink ? `<a role="menuitem" href="${esc(m.fileLink)}" target="_blank" rel="noopener">Открыть файл базы на Диске</a>` : ''}
    <a role="menuitem" href="#/tags">Тэги рецептов</a>
    <button role="menuitem" data-a="backup">Скачать резервную копию (JSON)</button>
    ${drv ? '<button role="menuitem" data-a="signout">Выйти из Google на этом устройстве</button>' : ''}
    <button role="menuitem" data-a="reset">Стереть данные на этом устройстве…</button>
    <div class="ver">Рацион v${CONFIG.version}</div>
  </div>`;
}

function soonPage(r) {
  const x = ROUTES.find((y) => y.id === r);
  const extra = r === 'plan' ? 'Таблица-журнал рациона по дням и персонам.' : 'Карточки едоков с целями по КБЖУ.';
  return `<main class="page"><div class="soon-page"><h2>${x.name}</h2><p>Раздел появится в версии ${x.soon}. ${extra}</p></div></main>`;
}

// ---------------- страница ----------------
let lastRoute = null;
function render() {
  const app = $('#app');
  const s = store.state;
  if (!s.data || ui.setup) {
    app.innerHTML = ui.setup ? setupView() : welcomeView();
    lastRoute = null;
    return;
  }
  const r = route();
  const body = { ingredients: ING.page, recipes: RECS.page, plan: PLAN.page, persons: PER.page, tags: TAGS.page }[r]();
  app.innerHTML = topView(r) + body;
  app.dataset.route = r;
  lastRoute = r;
  refreshPage();
}

function refreshPage() {
  if (lastRoute === 'ingredients') ING.renderList();
  else if (lastRoute === 'recipes') RECS.refresh();
  else if (lastRoute === 'plan') PLAN.refresh();
  else if (lastRoute === 'persons' || lastRoute === 'tags') { const m = $('main.page'); if (m) { const y = window.scrollY; m.outerHTML = lastRoute === 'persons' ? PER.page() : TAGS.page(); window.scrollTo(0, y); } }
}

// ---------------- слои: панели, диалоги, меню ----------------
const nodes = new Map(); // слой → DOM-узел

function layerHtml(l) {
  switch (l.type) {
    case 'ingredient': return ING.editorView(l);
    case 'recipe': return REC.view(l);
    case 'dialog': return PLAN.dialogView(l) || TAGS.dialogView(l) || REC.dialogView(l) || GRP.dialogView(l);
    case 'person': return PER.editorView(l);
    case 'menu': return menuView();
    case 'filters': return RECS.filtersSheet();
    default: return '';
  }
}

function renderLayer(l, i) {
  const o = $('#overlay');
  let el = nodes.get(l);
  const fresh = !el;
  if (fresh) { el = document.createElement('div'); el.className = 'layer'; nodes.set(l, el); o.appendChild(el); }
  const scroll = {};
  $$('[data-scroll]', el).forEach((s) => { scroll[s.dataset.scroll] = s.scrollTop; });
  const focusSel = !fresh && el.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  el.dataset.type = l.type;
  el.style.zIndex = String(20 + i * 2);
  el.innerHTML = `<div class="scrim${l.type === 'menu' ? ' clear' : ''}" data-a="layer-close"></div>` + layerHtml(l);
  $$('[data-scroll]', el).forEach((s) => { if (scroll[s.dataset.scroll] != null) s.scrollTop = scroll[s.dataset.scroll]; });
  REC.autosize(el);
  if (l.type === 'person') PER.afterRender();
  if (fresh) {
    const af = $('[data-autofocus]', el);
    const panel = el.children[1];
    if (af) setTimeout(() => af.focus(), 0);
    else if (panel) { panel.setAttribute('tabindex', '-1'); panel.focus({ preventScroll: true }); }
  } else if (focusSel) {
    const f = $(focusSel, el); if (f) f.focus({ preventScroll: true });
  }
}

function focusKey(a) {
  if (a.id) return '#' + CSS.escape(a.id);
  const d = a.dataset || {};
  if (d.a) return `[data-a="${d.a}"]` + (d.id ? `[data-id="${CSS.escape(d.id)}"]` : '') + (d.v ? `[data-v="${CSS.escape(d.v)}"]` : '') + (d.i ? `[data-i="${d.i}"]` : '');
  if (d.f) return `[data-f="${d.f}"]` + (d.i ? `[data-i="${d.i}"]` : '');
  return null;
}

function renderOverlay() {
  for (const [l, el] of nodes) if (!ui.layers.includes(l)) { el.remove(); nodes.delete(l); }
  ui.layers.forEach((l, i) => { if (!nodes.has(l) || i === ui.layers.length - 1) renderLayer(l, i); });
  document.body.classList.toggle('noscroll', ui.layers.length > 0);
  const av = $('.avatar'); if (av) av.setAttribute('aria-expanded', String(!!ui.layers.find((l) => l.type === 'menu')));
}

/** Перерисовать слои, которые показывают данные (не трогая открытые формы). */
function refreshLayers() {
  ui.layers.forEach((l, i) => {
    if ((l.type === 'recipe' && l.mode !== 'edit') || l.type === 'filters' || (l.type === 'dialog' && (l.kind === 'pl-eater' || l.kind === 'pl-dish'))) renderLayer(l, i);
  });
}

hooks.render = render;
hooks.renderOverlay = renderOverlay;
hooks.refreshPage = refreshPage;
hooks.refreshLayers = refreshLayers;

// ---------------- действия каркаса ----------------
actions['layer-close'] = () => {
  const l = topLayer();
  if (l && l.type === 'recipe' && l.mode === 'edit') return actions['rec-cancel']();
  closeLayer();
};
actions['connect'] = () => {
  closeAll();
  return withBusy(async () => {
    const res = await store.connect();
    if (res === 'need-setup') ui.setup = true;
    else showToast('Подключено к базе на Google Диске');
  });
};
actions['local'] = () => withBusy(() => store.startLocal());
actions['create'] = () => withBusy(async () => { await store.createBase(); ui.setup = false; showToast('База создана на Google Диске в папке «' + CONFIG.folderName + '»'); });
actions['join'] = () => withBusy(async () => { const ok = await store.joinShared(); if (ok) { ui.setup = false; showToast('Общая база подключена'); } });
actions['setup-later'] = () => withBusy(async () => { if (!store.state.data) await store.startLocal(); ui.setup = false; });
actions['sync-chip'] = () => {
  const s = store.state.status;
  if (s === 'local') return actions.menu();
  if (s === 'auth') return withBusy(() => store.signInAgain());
  return store.sync();
};
actions['sync-now'] = () => { closeAll(); store.sync(); };
actions['menu'] = () => {
  if (ui.layers.find((l) => l.type === 'menu')) return closeAll();
  ui.layers.push({ type: 'menu', _opener: $('.avatar') });
  renderOverlay();
};
actions['backup'] = () => {
  const url = URL.createObjectURL(store.backupBlob());
  const link = document.createElement('a');
  link.href = url; link.download = 'ration-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  closeAll();
};
actions['signout'] = () => { closeAll(); store.signOut(); showToast('Вы вышли. Изменения сохраняются на устройстве и отправятся на Диск после входа.'); };
actions['reset'] = () => {
  if (!window.confirm('Стереть все данные «Рациона» на этом устройстве? Файл на Google Диске не пострадает. Несохранённые на Диск изменения пропадут.')) return;
  closeAll();
  return withBusy(() => store.resetDevice());
};

// ---------------- события ----------------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-a]');
  if (!t || t.disabled) return;
  const fn = actions[t.dataset.a];
  if (!fn) return;
  if (t.tagName === 'A' && t.getAttribute('href')) return; // обычные ссылки
  e.preventDefault();
  Promise.resolve(fn(t, e)).catch((err) => { console.error(err); showToast(err.message || String(err), 'error', 8000); });
});
document.addEventListener('submit', (e) => { if (!PER.onSubmit(e)) ING.onSubmit(e); });
document.addEventListener('input', (e) => { if (!REC.onInput(e) && !RECS.onInput(e) && !PLAN.onInput(e) && !PER.onInput(e)) ING.onInput(e); });
document.addEventListener('change', (e) => { if (e.target.type === 'checkbox') REC.onInput(e); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.layers.length) {
    e.preventDefault();
    // сначала закрыть подсказки поиска ингредиента
    const sugg = $('#ed-sugg'); if (sugg && sugg.innerHTML && sugg.closest('.layer') === nodes.get(topLayer())) { sugg.innerHTML = ''; const q = $('#ed-ing-q'); if (q) { q.value = ''; q.focus(); } return; }
    return actions['layer-close']();
  }
  if (e.key === 'Tab' && ui.layers.length) {
    const el = nodes.get(topLayer()); if (!el) return;
    const f = $$('button:not([disabled]), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])', el).filter((x) => x.offsetParent !== null && !x.classList.contains('scrim'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    return;
  }
  if (REC.onKeydown(e) || PER.onKeydown(e) || TAGS.onKeydown(e) || PLAN.onKeydown(e)) return;
  PDND.onKeydown(e);
});
window.addEventListener('hashchange', () => { closeAll(); render(); window.scrollTo(0, 0); });

let lastRev = -1;
store.subscribe(() => {
  updateSyncChip();
  if (store.state.rev !== lastRev) {
    lastRev = store.state.rev;
    // во время перетаскивания список не перерисовываем — обновится после отпускания
    if (!ui.busy && store.state.data && !ui.setup && !isDragging() && !PDND.isDragging()) { refreshPage(); refreshLayers(); }
  }
});

// ---------------- запуск ----------------
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) showToast('Установлена новая версия приложения. Обновите страницу, чтобы её увидеть.', 'info', 12000);
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e)));
}
store.init().then(() => {
  render();
  store.sync();
}).catch((e) => {
  console.error(e);
  $('#app').innerHTML = `<div class="welcome"><div class="card"><h1>рацион<i>.</i></h1><p>Не удалось запустить приложение: ${esc(e.message)}</p></div></div>`;
});

// ---------------- подсказка с полным названием, если оно обрезано ----------------
const TIP_SEL = '.ck-open b, .ck-open small, .nm, .g-name, .pt-dn b, .pa-item small, .pp-cn b, .pp-who b';
let tipEl = null;
function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest && e.target.closest(TIP_SEL);
  if (!el) { hideTip(); return; }
  if (el.scrollWidth <= el.clientWidth + 1 || document.body.classList.contains('dragging-rec')) { hideTip(); return; }
  hideTip();
  tipEl = document.createElement('div');
  tipEl.className = 'tip'; tipEl.setAttribute('role', 'tooltip');
  tipEl.textContent = el.textContent.trim();
  document.body.appendChild(tipEl);
  const r = el.getBoundingClientRect(); const t = tipEl.getBoundingClientRect();
  let x = r.left; if (x + t.width > window.innerWidth - 8) x = window.innerWidth - 8 - t.width;
  let y = r.top - t.height - 6; if (y < 8) y = r.bottom + 6;
  tipEl.style.left = Math.max(8, x) + 'px'; tipEl.style.top = y + 'px';
});
['scroll', 'pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, hideTip, true));
