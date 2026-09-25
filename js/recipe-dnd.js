// Перетаскивание в списке рецептов (project state 3.2.2, Q-44, Q-45):
// рецепт на рецепт → диалог новой группы; рецепт на группу → добавить (перенести) в неё;
// внутри раскрытой группы → новый порядок. Мышь — сразу, палец — после долгого нажатия.
import * as store from './store.js';
import { ui, openLayer } from './ui.js';
import { showToast } from './util.js';
import { members, addToGroup, promptLeft, setOrder } from './groups.js';
import { renderList } from './recipes.js';

const LONG_MS = 450;     // долгое нажатие на телефоне
const MOUSE_PX = 6;      // сдвиг мыши, после которого начинается перетаскивание
const TOUCH_SLOP = 10;   // если палец сдвинулся раньше — это прокрутка
let st = null;

export const isDragging = () => !!(st && st.dragging);

document.addEventListener('pointerdown', (e) => {
  if (st || ui.rec.select || ui.layers.length || e.button > 0) return;
  const row = e.target.closest && e.target.closest('#rec-list button.rec-row[data-a="rec-open"]');
  if (!row) return;
  const r = store.get('recipes', row.dataset.id);
  if (!r) return;
  st = {
    pid: e.pointerId, touch: e.pointerType !== 'mouse', row, id: r.id, name: r.name,
    srcGid: r.groupId && store.get('groups', r.groupId) ? r.groupId : null,
    x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, dragging: false, target: null,
  };
  if (st.touch) st.timer = setTimeout(begin, LONG_MS);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
});

// пока тащим пальцем — не прокручивать страницу
document.addEventListener('touchmove', (e) => { if (st && st.dragging) e.preventDefault(); }, { passive: false });
// долгое нажатие на Android не должно открывать системное меню
document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('#rec-list .rec-row')) e.preventDefault(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st && st.dragging) { e.stopPropagation(); finish(false); } }, true);

function begin() {
  if (!st || st.dragging || !st.row.isConnected) return;
  st.dragging = true;
  clearTimeout(st.timer);
  if (navigator.vibrate) try { navigator.vibrate(15); } catch (x) { /* */ }
  const rc = st.row.getBoundingClientRect();
  st.dx = st.x0 - rc.left; st.dy = st.y0 - rc.top;
  const g = st.row.cloneNode(true);
  g.classList.add('drag-ghost');
  g.removeAttribute('data-a');
  g.setAttribute('aria-hidden', 'true');
  g.style.width = rc.width + 'px';
  document.body.appendChild(g);
  st.ghost = g;
  st.row.classList.add('drag-src');
  document.body.classList.add('dragging-rec');
  place();
  st.raf = requestAnimationFrame(autoScroll);
}

function place() {
  st.ghost.style.left = (st.x - st.dx) + 'px';
  st.ghost.style.top = (st.y - st.dy) + 'px';
}

function onMove(e) {
  if (!st || e.pointerId !== st.pid) return;
  st.x = e.clientX; st.y = e.clientY;
  const dist = Math.hypot(st.x - st.x0, st.y - st.y0);
  if (!st.dragging) {
    if (st.touch) { if (dist > TOUCH_SLOP) cleanup(); return; }
    if (dist > MOUSE_PX) begin(); else return;
  }
  e.preventDefault();
  place();
  hitTest();
}

function autoScroll() {
  if (!st || !st.dragging) return;
  const edge = 70, bottom = window.innerHeight - (st.touch ? 100 : 20);
  let v = 0;
  if (st.y < edge) v = -Math.ceil((edge - st.y) / 6);
  else if (st.y > bottom - edge) v = Math.ceil((st.y - (bottom - edge)) / 6);
  if (v) { window.scrollBy(0, v); hitTest(); }
  st.raf = requestAnimationFrame(autoScroll);
}

function hitTest() {
  const el = document.elementFromPoint(st.x, st.y);
  const row = el && el.closest('#rec-list .rec-row[data-id]');
  const box = el && el.closest('#rec-list .rec-group[data-gid]');
  let t = null;
  if (box) {
    const gid = box.dataset.gid;
    if (gid === st.srcGid) {
      // свой рецепт двигаем внутри своей группы
      if (row && row !== st.row && row.parentElement === st.row.parentElement) {
        const r = row.getBoundingClientRect();
        const before = st.y < r.top + r.height / 2;
        const ref = before ? row : row.nextElementSibling;
        if (ref !== st.row && st.row.nextElementSibling !== ref) {
          const list = row.parentElement;
          list.insertBefore(st.row, ref);
          // чип «по умолчанию» переезжает на первый рецепт сразу
          const chip = list.querySelector('.def');
          const nameEl = list.firstElementChild && list.firstElementChild.querySelector('.r-name');
          if (chip && nameEl && !nameEl.contains(chip)) nameEl.appendChild(chip);
        }
      }
      t = { kind: 'reorder', gid, el: box };
    } else {
      const g = store.get('groups', gid);
      t = { kind: 'group', gid, el: box, label: 'добавить в «' + (g ? g.name : '') + '»' };
    }
  } else if (row && row !== st.row) {
    t = { kind: 'recipe', id: row.dataset.id, el: row, label: 'объединить в группу' };
  }
  setTarget(t);
}

function setTarget(t) {
  const old = st.target;
  if (old && t && old.el === t.el && old.kind === t.kind) return;
  if (old) { old.el.classList.remove('drop-on', 'reordering'); old.el.removeAttribute('data-drop'); }
  st.target = t;
  if (!t) return;
  if (t.kind === 'reorder') t.el.classList.add('reordering');
  else { t.el.classList.add('drop-on'); t.el.setAttribute('data-drop', t.label); }
}

function onUp(e) {
  if (!st || e.pointerId !== st.pid) return;
  if (!st.dragging) { cleanup(); return; } // обычный клик — откроет рецепт
  // клик после перетаскивания не должен открыть рецепт
  const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', stop, true);
  setTimeout(() => window.removeEventListener('click', stop, true), 350);
  finish(true);
}

function onCancel(e) { if (st && e.pointerId === st.pid) finish(false); }

async function finish(drop) {
  const s = st;
  const t = drop && s.row.isConnected ? s.target : null;
  cleanup();
  if (!t) { if (s.dragging) renderList(); return; }
  if (t.kind === 'recipe') {
    const target = store.get('recipes', t.id);
    renderList();
    if (!target) return;
    openLayer({ type: 'dialog', kind: 'group-new', recipeIds: [target.id, s.id], sourceId: null, groupName: target.name, fromDrop: true });
    return;
  }
  if (t.kind === 'group') {
    const g = store.get('groups', t.gid);
    if (!g) { renderList(); return; }
    const touched = await addToGroup(g.id, [s.id]);
    ui.rec.expanded.add(g.id); ui.rec.collapsed.delete(g.id);
    renderList();
    showToast(`«${s.name}» ${s.srcGid ? 'перенесён' : 'добавлен'} в группу «${g.name}»`);
    promptLeft(touched, s.name, g.name);
    return;
  }
  if (t.kind === 'reorder') {
    const visible = [...t.el.querySelectorAll('.g-list .rec-row[data-id]')].map((x) => x.dataset.id);
    const full = members(t.gid).map((r) => r.id);
    const vis = new Set(visible);
    let k = 0;
    const order = full.map((id) => (vis.has(id) ? visible[k++] : id)); // скрытые фильтром остаются на своих местах
    if (order.join() !== full.join()) {
      await setOrder(t.gid, order);
      if (order[0] !== full[0]) { const r = store.get('recipes', order[0]); if (r) showToast(`«${r.name}» теперь рецепт по умолчанию`); }
    }
    renderList();
  }
}

function cleanup() {
  if (!st) return;
  clearTimeout(st.timer);
  cancelAnimationFrame(st.raf);
  if (st.ghost) st.ghost.remove();
  if (st.target) { st.target.el.classList.remove('drop-on', 'reordering'); st.target.el.removeAttribute('data-drop'); }
  st.row.classList.remove('drag-src');
  document.body.classList.remove('dragging-rec');
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  st = null;
}
