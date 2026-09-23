// «Рацион.» v0.1 — каркас: вход, Google Диск, офлайн, база ингредиентов.
import * as store from './store.js';
import { CONFIG, TAG_GROUPS } from './config.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const fmt = (n, d = 0) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: 0 });

const ui = {
  setup: false,        // показать экран «базы на Диске нет»
  busy: false,
  ingQuery: '', ingGroup: 'all', ingUnit: '100',
  editing: null,       // id ингредиента или 'new'
  menu: false,
};

const ROUTES = [
  { id: 'plan', name: 'План', soon: 'v0.3' },
  { id: 'recipes', name: 'Рецепты', soon: 'v0.2' },
  { id: 'ingredients', name: 'Ингредиенты' },
  { id: 'persons', name: 'Персоны', soon: 'v0.3' },
];
function route() {
  const r = (location.hash || '').replace(/^#\/?/, '');
  return ROUTES.find((x) => x.id === r) ? r : 'ingredients';
}

// ---------------- тосты ----------------
window.addEventListener('ration:toast', (e) => showToast(e.detail.text, e.detail.kind));
function showToast(text, kind = 'info', ms = 5000) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

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
  const ini = u && u.name ? esc(u.name.trim()[0].toUpperCase()) : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>';
  return `<header class="top">
    <span class="brand">рацион<i>.</i></span>
    <nav class="nav" aria-label="Разделы">
      ${ROUTES.map((x) => x.id === r
        ? `<a href="#/${x.id}" aria-current="page">${x.name}</a>`
        : `<a href="#/${x.id}" class="${x.soon ? 'soon' : ''}">${x.name}${x.soon ? ` <small>${x.soon}</small>` : ''}</a>`).join('')}
    </nav>
    <span class="spacer"></span>
    <button class="sync" id="sync" data-a="sync-chip" data-s="${store.state.status}" title="${esc(store.state.error)}"><span class="dot"></span><span>${esc(syncLabel())}</span></button>
    <button class="avatar" data-a="menu" aria-label="Аккаунт и настройки" aria-expanded="${ui.menu}">${ini}</button>
  </header>`;
}

function updateSyncChip() {
  const el = $('#sync');
  if (!el) return;
  el.dataset.s = store.state.status;
  el.title = store.state.error || '';
  el.lastElementChild.textContent = syncLabel();
}

// ---------------- ингредиенты ----------------
const GROUP_TAGS = () => store.list('tags').filter((t) => t.group === 'ingredients').sort((a, b) => a.name.localeCompare(b.name, 'ru'));
const tagName = (id) => { const t = store.get('tags', id); return t ? t.name : ''; };

function usage(ingId) {
  return store.list('recipes').filter((r) => (r.ingredients || []).some((x) => x.ing === ingId));
}

function ingValues(x) {
  const u = ui.ingUnit;
  if (u === '1') return [fmt(x.kcal, 2), fmt(x.p, 3), fmt(x.f, 3), fmt(x.c, 3), fmt(x.fib, 3)];
  if (u === 'pc') {
    if (!x.unitWeight) return ['—', '—', '—', '—', '—'];
    const w = x.unitWeight;
    return [fmt(x.kcal * w, 0), fmt(x.p * w, 1), fmt(x.f * w, 1), fmt(x.c * w, 1), fmt(x.fib * w, 1)];
  }
  return [fmt(x.kcal * 100, 0), fmt(x.p * 100, 1), fmt(x.f * 100, 1), fmt(x.c * 100, 1), fmt(x.fib * 100, 1)];
}

function filteredIngredients() {
  const q = norm(ui.ingQuery).trim();
  return store.list('ingredients')
    .filter((x) => ui.ingGroup === 'all' || (ui.ingGroup === 'none' ? !x.group : x.group === ui.ingGroup))
    .filter((x) => !q || norm(x.name).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function ingredientsPage() {
  const all = store.list('ingredients');
  const cnt = (g) => all.filter((x) => (g === 'none' ? !x.group : x.group === g)).length;
  const unitBtn = (v, l) => `<button data-a="unit" data-v="${v}" aria-pressed="${ui.ingUnit === v}">${l}</button>`;
  return `<main class="page">
    <div class="page-head">
      <h1>Ингредиенты</h1><span class="count" id="ing-count"></span>
      <span class="spacer"></span>
      <div class="seg" role="group" aria-label="КБЖУ на">${unitBtn('100', 'на 100 г')}${unitBtn('1', 'на 1 г')}${unitBtn('pc', 'на 1 шт')}</div>
      <button class="btn acc" data-a="ing-new">+ Ингредиент</button>
      <label class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <span class="sr-only">Поиск ингредиента</span><input id="ing-q" type="search" placeholder="Найти ингредиент" value="${esc(ui.ingQuery)}"></label>
    </div>
    <div class="chips" role="group" aria-label="Группа ингредиентов">
      <button class="chip" data-a="grp" data-v="all" aria-pressed="${ui.ingGroup === 'all'}">Все<b>${all.length}</b></button>
      ${GROUP_TAGS().map((t) => `<button class="chip" data-a="grp" data-v="${t.id}" aria-pressed="${ui.ingGroup === t.id}">${esc(t.name)}<b>${cnt(t.id)}</b></button>`).join('')}
      <button class="chip" data-a="grp" data-v="none" aria-pressed="${ui.ingGroup === 'none'}">без группы<b>${cnt('none')}</b></button>
    </div>
    <div class="ing-table" id="ing-list"></div>
  </main>`;
}

function renderIngList() {
  const el = $('#ing-list');
  if (!el) return;
  const items = filteredIngredients();
  $('#ing-count').textContent = items.length + ' из ' + store.list('ingredients').length;
  const L = ui.ingUnit === '1' ? '1 г' : ui.ingUnit === 'pc' ? '1 шт' : '100 г';
  const head = `<div class="ing-row ing-head" aria-hidden="true"><span>название</span><span>группа</span>
    <span style="text-align:right">ккал · ${L}</span><span style="text-align:right">белки</span><span style="text-align:right">жиры</span><span style="text-align:right">углеводы</span><span style="text-align:right">клетчатка</span><span style="text-align:right">1 шт</span></div>`;
  if (!items.length) { el.innerHTML = head + `<div class="empty">Ничего не нашлось</div>`; return; }
  el.innerHTML = head + items.map((x) => {
    const v = ingValues(x);
    return `<button class="ing-row" data-a="ing-edit" data-id="${esc(x.id)}" aria-label="Изменить: ${esc(x.name)}">
      <span class="cell name">${esc(x.name)}${x.custom ? '<small>свой</small>' : ''}</span>
      <span class="cell grp">${esc(tagName(x.group) || 'без группы')}</span>
      <span class="cell num" data-l="ккал">${v[0]}</span><span class="cell num" data-l="Б">${v[1]}</span><span class="cell num" data-l="Ж">${v[2]}</span><span class="cell num" data-l="У">${v[3]}</span><span class="cell num" data-l="клетч.">${v[4]}</span>
      <span class="cell unit">${x.unitWeight ? '1 ' + esc(x.unitName || 'шт') + ' = ' + fmt(x.unitWeight) + ' г' : '—'}</span>
    </button>`;
  }).join('');
}

// ---------------- редактор ингредиента ----------------
const num100 = (v) => (v == null ? '' : String(Math.round(v * 100 * 1000) / 1000).replace('.', ','));
function editorView() {
  const isNew = ui.editing === 'new';
  const x = isNew ? { name: '', group: null, kcal: 0, p: 0, f: 0, c: 0, fib: 0, unitWeight: null, unitName: 'шт', category: '' } : store.get('ingredients', ui.editing);
  if (!x) return '';
  const used = isNew ? [] : usage(x.id);
  const opt = (id, name) => `<option value="${esc(id)}" ${x.group === id || (!x.group && !id) ? 'selected' : ''}>${esc(name)}</option>`;
  const inp = (n, l, v) => `<label class="field"><span>${l}</span><input name="${n}" inputmode="decimal" value="${esc(v)}" autocomplete="off"></label>`;
  return `<div class="scrim" data-a="close"></div>
  <section class="drawer" role="dialog" aria-modal="true" aria-labelledby="ed-title">
    <header><div><div class="hint">${isNew ? 'Новый ингредиент' : (x.custom ? 'Свой ингредиент' : 'Ингредиент из стартовой базы')}</div><h2 id="ed-title">${isNew ? 'Добавить' : esc(x.name)}</h2></div>
      <button class="btn icon" data-a="close" aria-label="Закрыть">×</button></header>
    <form class="body" id="ing-form" novalidate>
      <label class="field"><span>Название</span><input name="name" value="${esc(x.name)}" required autocomplete="off"></label>
      <label class="field"><span>Группа ингредиентов (для автотэгов рецептов)</span>
        <select name="group">${opt('', 'без группы')}${GROUP_TAGS().map((t) => opt(t.id, t.name)).join('')}</select></label>
      <div class="panel">
        <span class="hint"><b>КБЖУ и клетчатка на 100 г.</b> В базе значения хранятся на 1 г и пересчитываются автоматически.</span>
        <div class="grid5">${inp('kcal', 'ккал', num100(x.kcal))}${inp('p', 'белки, г', num100(x.p))}${inp('f', 'жиры, г', num100(x.f))}${inp('c', 'углев., г', num100(x.c))}${inp('fib', 'клетч., г', num100(x.fib))}</div>
      </div>
      <div class="panel">
        <span class="hint"><b>Штука</b> — если продукт удобно считать поштучно (яйцо, банан). Оставьте вес пустым, если не нужно.</span>
        <div class="grid2">${inp('unitWeight', 'вес 1 штуки, г', x.unitWeight == null ? '' : String(x.unitWeight).replace('.', ','))}
          <label class="field"><span>как называть</span><input name="unitName" value="${esc(x.unitName || 'шт')}" autocomplete="off"></label></div>
      </div>
      <label class="field"><span>Категория (как в старой базе, необязательно)</span><input name="category" value="${esc(x.category || '')}" autocomplete="off"></label>
      ${used.length ? `<p class="hint">Используется в ${used.length} ${plural(used.length, 'рецепте', 'рецептах', 'рецептах')}: ${used.slice(0, 4).map((r) => '«' + esc(r.name) + '»').join(', ')}${used.length > 4 ? '…' : ''}.</p>` : ''}
      <p class="err" id="ing-err" role="alert"></p>
    </form>
    <footer>
      <button class="btn acc" data-a="ing-save" form="ing-form">Сохранить</button>
      <button class="btn" data-a="close">Отмена</button>
      <span class="spacer"></span>
      ${isNew ? '' : `<button class="btn danger" data-a="ing-del" ${used.length ? 'disabled title="Сначала уберите ингредиент из рецептов"' : ''}>Удалить</button>`}
    </footer>
  </section>`;
}

function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

function parseNum(v) {
  const s = String(v || '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

async function saveIngredient() {
  const form = $('#ing-form');
  const fd = new FormData(form);
  const err = $('#ing-err');
  form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
  const bad = (name, msg) => { const i = form.elements[name]; if (i) { i.setAttribute('aria-invalid', 'true'); i.focus(); } err.textContent = msg; return false; };
  const name = String(fd.get('name') || '').trim();
  if (!name) return bad('name', 'Введите название.');
  const dup = store.list('ingredients').find((x) => norm(x.name) === norm(name) && x.id !== ui.editing);
  if (dup) return bad('name', 'Ингредиент с таким названием уже есть.');
  const vals = {};
  for (const k of ['kcal', 'p', 'f', 'c', 'fib']) {
    const n = parseNum(fd.get(k));
    if (n == null || isNaN(n) || n < 0) return bad(k, 'Введите число от 0 и больше (на 100 г).');
    vals[k] = Math.round((n / 100) * 1e6) / 1e6;
  }
  if (vals.p + vals.f + vals.c + vals.fib > 1.0001) return bad('p', 'Белков, жиров, углеводов и клетчатки в сумме не может быть больше 100 г на 100 г.');
  const uw = parseNum(fd.get('unitWeight'));
  if (uw != null && (isNaN(uw) || uw <= 0)) return bad('unitWeight', 'Вес штуки — число больше 0 или пусто.');
  const base = ui.editing === 'new' ? { id: store.newId('ing'), custom: true } : store.get('ingredients', ui.editing);
  const rec = {
    ...base, name, ...vals,
    group: String(fd.get('group') || '') || null,
    unitWeight: uw == null ? null : uw,
    unitName: uw == null ? null : (String(fd.get('unitName') || '').trim() || 'шт'),
    category: String(fd.get('category') || '').trim(),
  };
  await store.put('ingredients', rec);
  showToast((ui.editing === 'new' ? 'Добавлен' : 'Сохранён') + ' ингредиент «' + name + '»');
  closeOverlay();
  return true;
}

// ---------------- меню аккаунта ----------------
function menuView() {
  const m = store.state.meta || {};
  const u = m.user;
  const drv = m.mode === 'drive';
  return `<div class="scrim" data-a="close" style="background:transparent"></div>
  <div class="menu" role="menu">
    <div class="who">${u ? `<b>${esc(u.name || '')}</b>${esc(u.email)}` : '<b>Без входа</b>Данные только на этом устройстве'}</div>
    ${!drv ? '<button role="menuitem" data-a="connect">Войти и подключить Google Диск</button>' : ''}
    ${drv ? '<button role="menuitem" data-a="sync-now">Сохранить на Диск сейчас</button>' : ''}
    ${drv && m.fileLink ? `<a role="menuitem" href="${esc(m.fileLink)}" target="_blank" rel="noopener">Открыть файл базы на Диске</a>` : ''}
    <button role="menuitem" data-a="backup">Скачать резервную копию (JSON)</button>
    ${drv ? '<button role="menuitem" data-a="signout">Выйти из Google на этом устройстве</button>' : ''}
    <button role="menuitem" data-a="reset">Стереть данные на этом устройстве…</button>
    <div class="ver">Рацион v${CONFIG.version}</div>
  </div>`;
}

// ---------------- заглушки разделов ----------------
function soonPage(r) {
  const x = ROUTES.find((y) => y.id === r);
  const extra = r === 'recipes' ? `В базе уже ${store.list('recipes').length} рецептов с тэгами и автотэгами.` :
    r === 'plan' ? 'Таблица-журнал рациона по дням и персонам.' : 'Карточки едоков с целями по КБЖУ.';
  return `<main class="page"><div class="soon-page"><h2>${x.name}</h2><p>Раздел появится в версии ${x.soon}. ${extra}</p></div></main>`;
}

// ---------------- рендер ----------------
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
  app.innerHTML = topView(r) + (r === 'ingredients' ? ingredientsPage() : soonPage(r));
  lastRoute = r;
  if (r === 'ingredients') renderIngList();
  renderOverlay();
}

function renderOverlay() {
  const o = $('#overlay');
  if (ui.editing) {
    if (!$('.drawer', o)) {
      o.innerHTML = editorView();
      const first = $('input[name="name"]', o);
      if (first) setTimeout(() => first.focus(), 0);
    }
  } else if (ui.menu) {
    o.innerHTML = menuView();
  } else o.innerHTML = '';
}

function closeOverlay() { ui.editing = null; ui.menu = false; $('#overlay').innerHTML = ''; const a = $('.avatar'); if (a) a.setAttribute('aria-expanded', 'false'); }

// ---------------- события ----------------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-a]');
  if (!t) return;
  const a = t.dataset.a;
  switch (a) {
    case 'connect':
      closeOverlay();
      return withBusy(async () => {
        const res = await store.connect();
        if (res === 'need-setup') ui.setup = true;
        else showToast('Подключено к базе на Google Диске');
      });
    case 'local': return withBusy(() => store.startLocal());
    case 'create':
      return withBusy(async () => { await store.createBase(); ui.setup = false; showToast('База создана на Google Диске в папке «' + CONFIG.folderName + '»'); });
    case 'join':
      return withBusy(async () => { const ok = await store.joinShared(); if (ok) { ui.setup = false; showToast('Общая база подключена'); } });
    case 'setup-later':
      return withBusy(async () => { if (!store.state.data) await store.startLocal(); ui.setup = false; });
    case 'sync-chip': {
      const s = store.state.status;
      if (s === 'local') { ui.menu = true; return renderOverlay(); }
      if (s === 'auth') return withBusy(() => store.signInAgain());
      return store.sync();
    }
    case 'sync-now': closeOverlay(); return store.sync();
    case 'menu': ui.menu = !ui.menu; ui.editing = null; t.setAttribute('aria-expanded', String(ui.menu)); return renderOverlay();
    case 'close': return closeOverlay();
    case 'backup': {
      const url = URL.createObjectURL(store.backupBlob());
      const link = document.createElement('a');
      link.href = url; link.download = 'ration-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return closeOverlay();
    }
    case 'signout': closeOverlay(); store.signOut(); return showToast('Вы вышли. Изменения сохраняются на устройстве и отправятся на Диск после входа.');
    case 'reset':
      if (!window.confirm('Стереть все данные «Рациона» на этом устройстве? Файл на Google Диске не пострадает. Несохранённые на Диск изменения пропадут.')) return;
      closeOverlay();
      return withBusy(() => store.resetDevice());
    case 'unit': ui.ingUnit = t.dataset.v; document.querySelectorAll('[data-a="unit"]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); return renderIngList();
    case 'grp': ui.ingGroup = t.dataset.v; document.querySelectorAll('[data-a="grp"]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); return renderIngList();
    case 'ing-new': ui.menu = false; ui.editing = 'new'; return renderOverlay();
    case 'ing-edit': ui.menu = false; ui.editing = t.dataset.id; return renderOverlay();
    case 'ing-save': e.preventDefault(); return saveIngredient();
    case 'ing-del': {
      const x = store.get('ingredients', ui.editing);
      if (!x || !window.confirm('Удалить ингредиент «' + x.name + '»?')) return;
      store.remove('ingredients', x.id).then(() => { showToast('Ингредиент «' + x.name + '» удалён'); closeOverlay(); });
      return;
    }
  }
});

document.addEventListener('submit', (e) => { if (e.target.id === 'ing-form') { e.preventDefault(); saveIngredient(); } });
document.addEventListener('input', (e) => { if (e.target.id === 'ing-q') { ui.ingQuery = e.target.value; renderIngList(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (ui.editing || ui.menu)) closeOverlay(); });
window.addEventListener('hashchange', () => { closeOverlay(); render(); });

store.subscribe(() => {
  updateSyncChip();
  if (!ui.busy && store.state.data && !ui.setup && lastRoute === 'ingredients') renderIngList();
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
