// Экран «Тэги» (12H, Q-43, Q-55): переименовать можно всё, кроме «Время приёма»; удалить — только свои тэги.
import * as store from './store.js';
import { TAG_GROUPS } from './config.js';
import { actions, hooks, openLayer, closeLayer, topLayer } from './ui.js';
import { $, esc, norm, showToast } from './util.js';
import { tagsOf } from './recipes.js';
import { MEAL_COLORS } from './util.js';

const usedIn = (id) => store.list('recipes').filter((r) => (r.tags || []).includes(id));

export function page() {
  const blocks = TAG_GROUPS.map((g) => {
    const tags = tagsOf(g.id);
    const note = g.locked ? 'менять нельзя — совпадает со слотами плана' : (g.id === 'nutrition' || g.id === 'ingredients' ? 'тэги с правилами считаются автоматически · переименовать можно' : 'свои тэги можно переименовать и удалить');
    const chips = tags.map((t) => {
      const c = MEAL_COLORS[t.id];
      const n = usedIn(t.id).length;
      if (g.locked) return `<span class="tchip meal" style="--c:${c}">${esc(t.name)}<small>${n}</small></span>`;
      return `<span class="tchip${t.custom ? ' own' : ''}"><button class="tchip-name" data-a="tag-rename" data-id="${esc(t.id)}" aria-label="Переименовать тэг «${esc(t.name)}»">${esc(t.name)}<small>${n}</small></button>${t.custom ? `<button class="tchip-x" data-a="tag-del" data-id="${esc(t.id)}" aria-label="Удалить тэг «${esc(t.name)}»">×</button>` : ''}</span>`;
    }).join('');
    return `<section class="tblock"><div class="tblock-h"><h2>${esc(g.name)}</h2><span class="hint">${note}</span><span class="spacer"></span>
      ${g.locked ? '' : `<button class="btn sm ghost" data-a="tag-new" data-g="${g.id}">+ тэг</button>`}</div><div class="tchips">${chips}</div></section>`;
  }).join('');
  return `<main class="page tags-page"><div class="page-head"><h1>Тэги</h1><span class="count">число — в скольких рецептах тэг</span></div>${blocks}
    <p class="hint">Нажмите на тэг, чтобы переименовать. Удалить можно только свои тэги (с крестиком): тэг снимется со всех рецептов, рецепты останутся.</p></main>`;
}

export function dialogView(l) {
  if (l.kind === 'tag-edit') {
    const t = l.id ? store.get('tags', l.id) : null;
    const g = TAG_GROUPS.find((x) => x.id === (t ? t.group : l.group));
    return `<section class="dialog small" role="dialog" aria-modal="true" aria-labelledby="te-title"><div class="dlg-body">
      <h2 id="te-title">${t ? 'Переименовать тэг' : 'Новый тэг'}</h2><p class="hint">Группа «${esc(g.name)}»${t ? ` · в ${usedIn(t.id).length} рецептах` : ''}</p>
      <label class="field"><span>Название</span><input id="te-name" value="${esc(t ? t.name : '')}" autocomplete="off" data-autofocus></label>
      <p class="err" id="te-err" role="alert"></p></div>
      <div class="dlg-foot"><button class="btn" data-a="layer-close">Отмена</button><button class="btn acc" data-a="tag-save">Сохранить</button></div></section>`;
  }
  if (l.kind === 'tag-del') {
    const t = store.get('tags', l.id); if (!t) return '';
    const rs = usedIn(t.id);
    return `<section class="dialog small" role="dialog" aria-modal="true" aria-labelledby="td-title"><div class="dlg-body">
      <h2 id="td-title">Удалить тэг «${esc(t.name)}»?</h2>
      <p class="hint">${rs.length ? `Он снимется с ${rs.length} ${rs.length === 1 ? 'рецепта' : 'рецептов'}: ${rs.slice(0, 5).map((r) => '«' + esc(r.name) + '»').join(', ')}${rs.length > 5 ? '…' : ''}. Рецепты не удалятся.` : 'Тэг не используется в рецептах.'}</p></div>
      <div class="dlg-foot"><button class="btn" data-a="layer-close">Отмена</button><button class="btn dark" data-a="tag-del-now">Удалить тэг</button></div></section>`;
  }
  return '';
}

actions['tag-rename'] = (t) => openLayer({ type: 'dialog', kind: 'tag-edit', id: t.dataset.id });
actions['tag-new'] = (t) => openLayer({ type: 'dialog', kind: 'tag-edit', group: t.dataset.g });
actions['tag-del'] = (t) => openLayer({ type: 'dialog', kind: 'tag-del', id: t.dataset.id });
actions['tag-save'] = async () => {
  const l = topLayer();
  const name = ($('#te-name').value || '').trim();
  const t = l.id ? store.get('tags', l.id) : null;
  const group = t ? t.group : l.group;
  if (!name) { $('#te-err').textContent = 'Введите название.'; return; }
  if (tagsOf(group).some((x) => norm(x.name) === norm(name) && (!t || x.id !== t.id))) { $('#te-err').textContent = 'Такой тэг в группе уже есть.'; return; }
  if (t) await store.put('tags', { ...t, name });
  else await store.put('tags', { id: store.newId('tag'), name, group, auto: false, custom: true });
  closeLayer(); showToast(t ? 'Тэг переименован' : 'Тэг «' + name + '» добавлен'); hooks.refreshPage();
};
actions['tag-del-now'] = async () => {
  const l = topLayer(); const t = store.get('tags', l.id); if (!t) return;
  const changes = usedIn(t.id).map((r) => ({ coll: 'recipes', rec: { ...r, tags: r.tags.filter((x) => x !== t.id) } }));
  changes.push({ coll: 'tags', id: t.id, remove: true });
  await store.putAll(changes);
  closeLayer(); showToast('Тэг «' + t.name + '» удалён'); hooks.refreshPage();
};
export function onKeydown(e) {
  if (e.target.id === 'te-name' && e.key === 'Enter') { e.preventDefault(); actions['tag-save'](); return true; }
  return false;
}
