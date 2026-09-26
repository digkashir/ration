// Перетаскивание в плане: рецепт из боковой базы → в день (добавить) или в ячейку персоны (сменить вариант, Q-56);
// строка блюда за ⋮⋮ → новый порядок внутри своего приёма (Q-48);
// режим «по дням приготовления»: карточка блюда → другой столбец своей строки (день приготовления, 14B, Q-68, Q-69).
import * as store from './store.js';
import { ui, openLayer } from './ui.js';
import { members, addToGroup, promptLeft, setOrder } from './groups.js';
import { $$, showToast } from './util.js';
import { snap, entryName, dayEntries } from './plan-model.js';
import { openAdd, refresh, refreshSide, planState, setCook } from './plan.js';
import { cookTarget } from './plan-cook.js';

let st = null;
export const isDragging = () => !!(st && st.dragging);

document.addEventListener('pointerdown', (e) => {
  if (st || ui.layers.length || e.button > 0) return;
  const card = e.target.closest && !e.target.closest('.star') && e.target.closest('[data-ck]');
  if (card) {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    st = { kind: 'cook', el: card, eid: card.dataset.ck, x0: e.clientX, y0: e.clientY, dragging: false, target: null, pid: e.pointerId };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cleanup);
    return;
  }
  const src = e.target.closest && e.target.closest('[data-drag-rid], [data-drag-gid]');
  const grip = e.target.closest && e.target.closest('[data-rowgrip]');
  if (!src && !grip) return;
  if (src && e.pointerType !== 'mouse') return; // база рецептов есть только на компьютере
  st = { kind: grip ? 'row' : 'recipe', el: grip ? grip.closest('.pt-row') : src, rid: src && src.dataset.dragRid, gid: src && src.dataset.dragGid,
    eid: grip && grip.dataset.rowgrip, x0: e.clientX, y0: e.clientY, dragging: false, target: null, pid: e.pointerId };
  if (grip) e.preventDefault();
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', cleanup);
});

function begin() {
  st.dragging = true;
  if (st.kind === 'recipe' || st.kind === 'cook') {
    const g = st.el.cloneNode(true); g.classList.add('drag-ghost', 'ps-ghost'); g.removeAttribute('data-a');
    g.style.width = st.el.getBoundingClientRect().width + 'px';
    document.body.appendChild(g); st.ghost = g;
  } else st.el.classList.add('dragging');
  if ((st.kind === 'recipe' && st.rid) || st.kind === 'cook') st.el.classList.add('drag-src');
  document.body.classList.add('dragging-rec');
}

function onMove(e) {
  if (!st || e.pointerId !== st.pid) return;
  const dist = Math.hypot(e.clientX - st.x0, e.clientY - st.y0);
  if (!st.dragging) { if (dist < 6) return; begin(); }
  e.preventDefault();
  if (st.ghost) { st.ghost.style.left = e.clientX + 8 + 'px'; st.ghost.style.top = e.clientY + 8 + 'px'; }
  if (st.kind === 'cook') {
    // столбец выбирается по горизонтали — строку держать точно не нужно
    const cells = $$(`.ck-cell[data-cr="${CSS.escape(st.eid)}"]`);
    const cell = cells.find((c) => { const r = c.getBoundingClientRect(); return e.clientX >= r.left - 2 && e.clientX <= r.right + 2; });
    const en = store.get('plan', st.eid);
    if (!cell || !en) { setTarget(null); return; }
    const t = cookTarget(en, cell.dataset.cc);
    setTarget({ kind: 'cook', el: cell, date: cell.dataset.cc, ok: t.ok, label: t.label });
    return;
  }
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (st.kind === 'row') {
    const over = el && el.closest('.pt-row');
    if (over && over !== st.el && over.parentElement === st.el.parentElement) {
      const a = store.get('plan', over.dataset.e), b = store.get('plan', st.eid);
      if (a && b && a.slot === b.slot) { const r = over.getBoundingClientRect(); over.parentElement.insertBefore(st.el, e.clientY < r.top + r.height / 2 ? over : over.nextElementSibling); }
    }
    return;
  }
  let t = null;
  // внутри списка рецептов плана — те же действия, что в разделе «Рецепты»
  const psItem = el && el.closest('.ps-item[data-drag-rid]');
  const psGroup = el && el.closest('.ps-group[data-gid]');
  if (st.rid && (psItem || psGroup)) {
    const src = store.get('recipes', st.rid);
    const srcG = src && src.groupId && store.get('groups', src.groupId) ? src.groupId : null;
    if (psGroup) {
      const gid = psGroup.dataset.gid;
      if (gid === srcG) {
        if (psItem && psItem !== st.el && psItem.parentElement === st.el.parentElement) {
          const r = psItem.getBoundingClientRect();
          psItem.parentElement.insertBefore(st.el, e.clientY < r.top + r.height / 2 ? psItem : psItem.nextElementSibling);
          st.moved = true;
        }
        t = { kind: 'reorder', el: psGroup, gid, ok: true };
      } else {
        const g = store.get('groups', gid);
        t = { kind: 'side-group', el: psGroup, gid, ok: true, label: 'добавить в «' + (g ? g.name : '') + '»' };
      }
    } else if (psItem && psItem !== st.el) {
      t = { kind: 'side-recipe', el: psItem, id: psItem.dataset.dragRid, ok: true, label: 'объединить в группу' };
    }
    setTarget(t);
    return;
  }
  const cell = el && el.closest('[data-drop-cell]');
  const day = el && el.closest('[data-drop-day]');
  if (cell) {
    const [eid, pid] = cell.dataset.dropCell.split('|');
    const en = store.get('plan', eid);
    const r = st.rid ? store.get('recipes', st.rid) : null;
    const ok = en && en.kind === 'dish' && r && (en.recipes[r.id] || (en.groupId && r.groupId === en.groupId));
    t = { kind: 'cell', el: cell, eid, pid, ok, label: ok ? 'этот вариант — сюда' : 'сюда — только варианты «' + (en ? entryName(en) : '') + '»' };
  } else if (day) t = { kind: 'day', el: day, date: day.dataset.dropDay, ok: true, label: 'добавить в этот день' };
  setTarget(t);
}
function setTarget(t) {
  if (st.target && (!t || st.target.el !== t.el || st.target.kind !== t.kind)) { st.target.el.classList.remove('drop-on', 'drop-bad', 'reordering'); st.target.el.removeAttribute('data-drop'); }
  st.target = t;
  if (!t) return;
  if (t.kind === 'reorder') { t.el.classList.add('reordering'); return; }
  t.el.classList.add(t.ok ? 'drop-on' : 'drop-bad'); t.el.setAttribute('data-drop', t.label);
}

async function onUp(e) {
  if (!st || e.pointerId !== st.pid) return;
  const s = st;
  if (!s.dragging) { cleanup(); return; }
  const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', stop, true); setTimeout(() => window.removeEventListener('click', stop, true), 300);
  cleanup();
  if (s.kind === 'row') {
    const rows = [...s.el.parentElement.querySelectorAll(':scope > .pt-row')].map((r) => store.get('plan', r.dataset.e)).filter(Boolean);
    const moved = store.get('plan', s.eid); if (!moved) return;
    const same = rows.filter((x) => x.slot === moved.slot && x.date === moved.date);
    const changes = same.map((x, i) => ({ coll: 'plan', rec: { ...x, order: i + 1 } })).filter((c, i) => (same[i].order ?? 0) !== i + 1);
    if (changes.length) await store.putAll(changes); else refresh();
    return;
  }
  const t = s.target;
  if (s.kind === 'cook') { if (t && t.ok) await setCook(s.eid, t.date); else if (t) showToast(t.label.replace(/^нельзя — /, 'Здесь готовить нельзя: ')); return; }
  if (!t || !t.ok) { if (s.moved) refreshSide(); return; }
  if (t.kind === 'side-recipe') {
    const target = store.get('recipes', t.id); refreshSide();
    if (target) openLayer({ type: 'dialog', kind: 'group-new', recipeIds: [target.id, s.rid], sourceId: null, groupName: target.name, fromDrop: true });
    return;
  }
  if (t.kind === 'side-group') {
    const g = store.get('groups', t.gid); const r = store.get('recipes', s.rid); if (!g || !r) { refreshSide(); return; }
    const wasIn = r.groupId && store.get('groups', r.groupId);
    const touched = await addToGroup(g.id, [r.id]);
    planState.side.open.add(g.id); refreshSide();
    showToast(`«${r.name}» ${wasIn ? 'перенесён' : 'добавлен'} в группу «${g.name}»`);
    promptLeft(touched, r.name, g.name);
    return;
  }
  if (t.kind === 'reorder') {
    const visible = [...t.el.querySelectorAll('.ps-item.sub[data-drag-rid]')].map((x) => x.dataset.dragRid);
    const full = members(t.gid).map((r) => r.id); const vis = new Set(visible); let k = 0;
    const order = full.map((id) => (vis.has(id) ? visible[k++] : id));
    if (order.join() !== full.join()) {
      await setOrder(t.gid, order);
      if (order[0] !== full[0]) { const r = store.get('recipes', order[0]); if (r) showToast(`«${r.name}» теперь рецепт по умолчанию`); }
    }
    refreshSide();
    return;
  }
  if (t.kind === 'day') { openAdd({ date: t.date, rid: s.rid, gid: s.rid ? null : s.gid }); return; }
  const en = store.get('plan', t.eid); const r = store.get('recipes', s.rid);
  if (!en || !r) return;
  const recipes = { ...en.recipes }; if (!recipes[r.id]) recipes[r.id] = snap(r);
  const cur = en.eaters[t.pid];
  const eaters = { ...en.eaters, [t.pid]: { n: cur ? cur.n : 1, rid: r.id, own: null } };
  await store.put('plan', { ...en, recipes, eaters });
  const p = store.get('persons', t.pid);
  showToast(`${p ? p.name : ''}: ${r.name}`);
}

function cleanup() {
  if (!st) return;
  if (st.ghost) st.ghost.remove();
  if (st.el) st.el.classList.remove('dragging', 'drag-src');
  if (st.target) { st.target.el.classList.remove('drop-on', 'drop-bad', 'reordering'); st.target.el.removeAttribute('data-drop'); }
  document.body.classList.remove('dragging-rec');
  window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', cleanup);
  st = null;
}

// клавиатура: ⋮⋮ строки + стрелки вверх/вниз
export async function onKeydown(e) {
  const id = e.target.dataset && e.target.dataset.rowgrip;
  if (!id || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return false;
  e.preventDefault();
  const x = store.get('plan', id); if (!x) return true;
  const same = dayEntries(x.date).filter((o) => o.slot === x.slot);
  const i = same.findIndex((o) => o.id === id); const j = i + (e.key === 'ArrowUp' ? -1 : 1);
  if (j < 0 || j >= same.length) return true;
  [same[i], same[j]] = [same[j], same[i]];
  await store.putAll(same.map((o, k) => ({ coll: 'plan', rec: { ...o, order: k + 1 } })));
  const g = $$(`[data-rowgrip="${CSS.escape(id)}"]`)[0]; if (g) g.focus();
  return true;
}
