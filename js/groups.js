// Группы рецептов (project state 3.2.2): равноправные рецепты-варианты, у группы есть название и порядок.
// Первый рецепт в порядке — «по умолчанию». Группа не исчезает сама: её судьбу решает пользователь.
import * as store from './store.js';
import { actions, openLayer, closeLayer, closeAll, hooks, ui } from './ui.js';
import { $, esc, showToast, ICON, plural } from './util.js';

export function members(groupId) {
  const g = store.get('groups', groupId);
  const list = store.list('recipes').filter((r) => r.groupId === groupId);
  const order = (g && g.order) || [];
  const pos = (r) => { const i = order.indexOf(r.id); return i < 0 ? 1e6 : i; };
  return list.sort((a, b) => pos(a) - pos(b) || a.name.localeCompare(b.name, 'ru'));
}

/** Рецепты, которые уже в другой группе, переносятся (Q-44): убрать их из порядка старой группы. */
function detach(recipeIds, exceptGroupId) {
  const byGroup = {};
  for (const id of recipeIds) {
    const r = store.get('recipes', id);
    if (r && r.groupId && r.groupId !== exceptGroupId && store.get('groups', r.groupId)) (byGroup[r.groupId] = byGroup[r.groupId] || []).push(id);
  }
  const changes = Object.entries(byGroup).map(([gid, ids]) => {
    const g = store.get('groups', gid);
    return { coll: 'groups', rec: { ...g, order: (g.order || []).filter((x) => !ids.includes(x)) } };
  });
  return { changes, touched: Object.keys(byGroup) };
}

/** @returns {{group, touched}} touched — старые группы, из которых перенесли рецепты */
export async function createGroup(name, recipeIds, renames = {}) {
  const g = { id: store.newId('grp'), name: name.trim(), order: [...recipeIds] };
  const d = detach(recipeIds, null);
  const changes = [{ coll: 'groups', rec: g }, ...d.changes];
  for (const id of recipeIds) {
    const r = store.get('recipes', id);
    if (r) changes.push({ coll: 'recipes', rec: { ...r, groupId: g.id, name: (renames[id] || r.name).trim() } });
  }
  await store.putAll(changes);
  return { group: g, touched: d.touched };
}

/** @returns {string[]} старые группы, из которых перенесли рецепты */
export async function addToGroup(groupId, recipeIds) {
  const g = store.get('groups', groupId);
  const order = [...members(groupId).map((r) => r.id)];
  const d = detach(recipeIds, groupId);
  const changes = [...d.changes];
  for (const id of recipeIds) {
    const r = store.get('recipes', id);
    if (!r || r.groupId === groupId) continue;
    order.push(id);
    changes.push({ coll: 'recipes', rec: { ...r, groupId } });
  }
  changes.push({ coll: 'groups', rec: { ...g, order } });
  await store.putAll(changes);
  return d.touched;
}

/** Если после переноса в старой группе остался один рецепт или ни одного — спросить (11E). */
export function promptLeft(touched, movedName, toName) {
  for (const gid of touched || []) {
    if (store.get('groups', gid) && members(gid).length <= 1) {
      openLayer({ type: 'dialog', kind: 'last-one', groupId: gid, removed: movedName, movedTo: toName });
      return;
    }
  }
}

/** Новый порядок рецептов группы. */
export async function setOrder(groupId, order) {
  const g = store.get('groups', groupId);
  if (g) await store.put('groups', { ...g, order });
}

export async function disband(groupId) {
  const changes = members(groupId).map((r) => ({ coll: 'recipes', rec: { ...r, groupId: null } }));
  changes.push({ coll: 'groups', id: groupId, remove: true });
  await store.putAll(changes);
}

/** Удалить рецепт; если он был в группе — спросить про судьбу группы (11E). */
export async function deleteRecipe(id) {
  const r = store.get('recipes', id);
  if (!r) return;
  const gid = r.groupId;
  const changes = [{ coll: 'recipes', id, remove: true }];
  if (gid) {
    const g = store.get('groups', gid);
    if (g) changes.push({ coll: 'groups', rec: { ...g, order: (g.order || []).filter((x) => x !== id) } });
  }
  await store.putAll(changes);
  showToast('Рецепт «' + r.name + '» удалён');
  if (gid && store.get('groups', gid)) {
    const left = members(gid);
    if (left.length <= 1) openLayer({ type: 'dialog', kind: 'last-one', groupId: gid, removed: r.name });
  }
}

// ---------------- диалоги групп ----------------
export function dialogView(l) {
  const g = l.groupId ? store.get('groups', l.groupId) : null;
  if (l.kind === 'group-new') {
    const src = store.get('recipes', l.sourceId);
    const names = l.names || {};
    const rows = l.recipeIds.map((id) => {
      const r = id === l.draft?.id ? l.draft : store.get('recipes', id);
      const tag = id === l.sourceId ? 'исходный' : (l.draft && id === l.draft.id ? 'новый' : '');
      return `<div class="dlg-row"><input data-rename="${esc(id)}" value="${esc(names[id] != null ? names[id] : r.name)}" aria-label="Название рецепта">${tag ? `<span class="hint">${tag}</span>` : ''}</div>`;
    }).join('');
    return dlg(`<h2>Рецепты объединятся в группу</h2>
      <p class="hint">${l.draft ? 'У «' + esc(src.name) + '» появился вариант. Оба рецепта станут равноправными вариантами одной группы.' : l.fromDrop ? 'Оба рецепта станут равноправными вариантами одной группы. Первый в списке — рецепт по умолчанию.' : 'Выбранные рецепты станут равноправными вариантами одной группы.'}${l.recipeIds.some((id) => { const r = store.get('recipes', id); return r && r.groupId && store.get('groups', r.groupId); }) ? ' Рецепт из другой группы перенесётся сюда.' : ''}</p>
      <label class="field"><span>Название группы</span><input id="grp-name" value="${esc(l.groupName)}" data-autofocus></label>
      <div class="panel"><span class="hint"><b>В группе</b> — здесь же можно переименовать рецепты, например исходный — в «… без начинки».</span>${rows}</div>
      <p class="err" id="dlg-err" role="alert"></p>`,
      `<button class="btn" data-a="layer-close">Отмена</button><button class="btn acc" data-a="grp-create">Создать группу</button>`);
  }
  if (l.kind === 'last-one') {
    const left = members(l.groupId);
    const gone = l.movedTo ? `«${esc(l.removed)}» перенесён в «${esc(l.movedTo)}»` : `«${esc(l.removed)}» удалён`;
    const txt = left.length === 1
      ? `${gone}. Расформировать группу, чтобы «${esc(left[0].name)}» стал обычным рецептом? Или оставить группу, если скоро добавите новые варианты.`
      : `${gone}, в группе не осталось рецептов. Удалить пустую группу или оставить её?`;
    return dlg(`<h2>${left.length === 1 ? 'В группе «' + esc(g.name) + '» остался один рецепт' : 'Группа «' + esc(g.name) + '» пуста'}</h2><p class="hint">${txt}</p>`,
      `<button class="btn" data-a="layer-close">Оставить группу</button><button class="btn dark" data-a="grp-disband-now">${left.length === 1 ? 'Расформировать' : 'Удалить группу'}</button>`, true);
  }
  if (l.kind === 'group-menu') {
    const n = members(l.groupId).length;
    return dlg(`<h2>Группа «${esc(g.name)}»</h2><p class="hint">${n} ${plural(n, 'рецепт', 'рецепта', 'рецептов')}</p>
      <div class="menu-list">
        <button data-a="grp-rename-open">Переименовать группу</button>
        <button data-a="grp-add-open">Добавить в группу рецепты…</button>
        <button data-a="grp-order-open">Порядок рецептов и рецепт по умолчанию</button>
        <button data-a="grp-disband-ask" class="danger">Расформировать группу</button>
      </div><p class="hint">При расформировании рецепты станут отдельными, ничего не удалится.</p>`,
      `<button class="btn" data-a="layer-close">Закрыть</button>`, true);
  }
  if (l.kind === 'group-rename') {
    return dlg(`<h2>Переименовать группу</h2><label class="field"><span>Название группы</span><input id="grp-name" value="${esc(g.name)}" data-autofocus></label><p class="err" id="dlg-err" role="alert"></p>`,
      `<button class="btn" data-a="layer-close">Отмена</button><button class="btn acc" data-a="grp-rename-save">Сохранить</button>`, true);
  }
  if (l.kind === 'group-order') {
    const order = l.order;
    const rows = order.map((id, i) => {
      const r = store.get('recipes', id);
      return `<div class="dlg-row order"><span class="ord-name">${esc(r ? r.name : id)}</span>${i === 0 ? '<span class="chip-s dark">по умолчанию</span>' : ''}
        <button class="btn icon sm" data-a="grp-order-move" data-i="${i}" data-d="-1" aria-label="Выше" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
        <button class="btn icon sm" data-a="grp-order-move" data-i="${i}" data-d="1" aria-label="Ниже" ${i === order.length - 1 ? 'disabled' : ''}>${ICON.down}</button></div>`;
    }).join('');
    return dlg(`<h2>Порядок рецептов</h2><p class="hint">Первый рецепт — рецепт по умолчанию для группы (пригодится в плане).</p><div class="panel">${rows}</div>`,
      `<button class="btn" data-a="layer-close">Отмена</button><button class="btn acc" data-a="grp-order-save">Сохранить</button>`, true);
  }
  if (l.kind === 'group-disband') {
    return dlg(`<h2>Расформировать «${esc(g.name)}»?</h2><p class="hint">Рецепты группы станут отдельными рецептами. Ничего не удалится.</p>`,
      `<button class="btn" data-a="layer-close">Отмена</button><button class="btn dark" data-a="grp-disband-now">Расформировать</button>`, true);
  }
  if (l.kind === 'group-pick') {
    const groups = store.list('groups').sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return dlg(`<h2>Добавить в группу</h2><p class="hint">Выбрано рецептов: ${l.recipeIds.length}</p>
      <div class="menu-list">${groups.length ? groups.map((x) => `<button data-a="grp-pick" data-id="${esc(x.id)}">${esc(x.name)} <span class="hint">· ${members(x.id).length}</span></button>`).join('') : '<p class="hint">Групп пока нет — выберите хотя бы два рецепта и нажмите «Объединить в группу».</p>'}</div>`,
      `<button class="btn" data-a="layer-close">Отмена</button>`, true);
  }
  if (l.kind === 'confirm') {
    return dlg(`<h2>${esc(l.title)}</h2><p class="hint">${esc(l.text)}</p>`,
      `<button class="btn" data-a="layer-close">Отмена</button><button class="btn ${l.danger ? 'dark' : 'acc'}" data-a="confirm-ok">${esc(l.ok)}</button>`, true);
  }
  return '';
}

function dlg(body, foot, small = false) {
  return `<section class="dialog ${small ? 'small' : ''}" role="dialog" aria-modal="true"><div class="dlg-body">${body}</div><div class="dlg-foot">${foot}</div></section>`;
}

const cur = () => ui.layers[ui.layers.length - 1];

actions['grp-create'] = async () => {
  const l = cur();
  const name = ($('#grp-name').value || '').trim();
  if (!name) { $('#dlg-err').textContent = 'Введите название группы.'; return; }
  const renames = {};
  document.querySelectorAll('[data-rename]').forEach((i) => { renames[i.dataset.rename] = i.value.trim() || i.defaultValue; });
  if (l.draft) {
    // сначала сохраняем новый вариант, потом собираем группу
    const draft = { ...l.draft, name: renames[l.draft.id] || l.draft.name };
    await store.put('recipes', draft);
  }
  const { group: g, touched } = await createGroup(name, l.recipeIds, renames);
  showToast('Группа «' + name + '» создана');
  const open = l.openAfter;
  if (l.fromSelection) { ui.rec.select = false; ui.rec.selected.clear(); }
  ui.rec.expanded.add(g.id);
  closeAll();
  if (open) openLayer({ type: 'recipe', id: open, mode: 'view' });
  hooks.refreshPage();
  if (l.fromDrop) promptLeft(touched, store.get('recipes', l.recipeIds[1])?.name || '', name);
};

actions['grp-disband-now'] = async () => {
  const l = cur();
  const g = store.get('groups', l.groupId);
  await disband(l.groupId);
  showToast(members(l.groupId).length ? '' : 'Группа «' + g.name + '» расформирована');
  // закрыть всё, что относится к группе
  ui.layers = ui.layers.filter((x) => !(x.type === 'dialog'));
  hooks.renderOverlay();
  hooks.refreshPage();
};

actions['grp-menu'] = (t) => openLayer({ type: 'dialog', kind: 'group-menu', groupId: t.dataset.id });
actions['grp-rename-open'] = () => { const l = cur(); closeLayer(); openLayer({ type: 'dialog', kind: 'group-rename', groupId: l.groupId }); };
actions['grp-rename-save'] = async () => {
  const l = cur(); const name = ($('#grp-name').value || '').trim();
  if (!name) { $('#dlg-err').textContent = 'Введите название группы.'; return; }
  await store.put('groups', { ...store.get('groups', l.groupId), name });
  closeLayer(); hooks.refreshPage();
};
actions['grp-order-open'] = () => { const l = cur(); closeLayer(); openLayer({ type: 'dialog', kind: 'group-order', groupId: l.groupId, order: members(l.groupId).map((r) => r.id) }); };
actions['grp-order-move'] = (t) => {
  const l = cur(); const i = Number(t.dataset.i), d = Number(t.dataset.d);
  const o = l.order; const j = i + d; if (j < 0 || j >= o.length) return;
  [o[i], o[j]] = [o[j], o[i]]; hooks.renderOverlay();
};
actions['grp-order-save'] = async () => {
  const l = cur(); await store.put('groups', { ...store.get('groups', l.groupId), order: l.order });
  closeLayer(); showToast('Порядок сохранён'); hooks.refreshPage();
};
actions['grp-disband-ask'] = () => { const l = cur(); closeLayer(); openLayer({ type: 'dialog', kind: 'group-disband', groupId: l.groupId }); };
actions['grp-add-open'] = () => {
  const l = cur();
  ui.rec.select = true; ui.rec.selected.clear(); ui.rec.target = l.groupId;
  closeAll(); location.hash = '#/recipes'; hooks.render();
};
actions['grp-pick'] = async (t) => {
  const l = cur();
  await addToGroup(t.dataset.id, l.recipeIds);
  const g = store.get('groups', t.dataset.id);
  showToast('Добавлено в группу «' + g.name + '»');
  ui.rec.select = false; ui.rec.selected.clear(); ui.rec.expanded.add(g.id);
  closeAll(); hooks.refreshPage();
};
actions['confirm-ok'] = async () => { const l = cur(); closeLayer(); if (l.onOk) await l.onOk(); };
