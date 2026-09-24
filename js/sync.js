// Слияние двух копий базы: локальной (устройство) и удалённой (файл на Google Диске).
// Правило (решение Q-27): по каждой записи побеждает более поздняя версия (updatedAt).
// Удаление — тоже версия записи (deleted: true), поэтому удаления тоже синхронизируются.
import { COLLECTIONS } from './config.js';

function newer(a, b) {
  // true, если запись a новее b
  if (!b) return true;
  if (!a) return false;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return (a.updatedBy || '') > (b.updatedBy || '');
}

export function emptyDb() {
  const collections = {};
  for (const c of COLLECTIONS) collections[c] = {};
  return { schema: 1, app: 'ration', updatedAt: new Date(0).toISOString(), collections };
}

/**
 * @param local  локальная копия
 * @param remote копия с Диска
 * @param dirty  Set ключей "коллекция/id", изменённых локально после последней синхронизации
 * @returns {{ merged, overwritten: Array<{coll, id, name, by}>, changedLocal: boolean, changedRemote: boolean }}
 */
export function merge(local, remote, dirty = new Set()) {
  const merged = emptyDb();
  const overwritten = [];
  let changedLocal = false;   // локальная копия получила что-то новое
  let changedRemote = false;  // в удалённую копию нужно отправить что-то новое
  // все коллекции обеих копий — даже неизвестные этой версии приложения (чтобы старая версия не стёрла данные новой)
  const colls = new Set([...COLLECTIONS, ...Object.keys((local && local.collections) || {}), ...Object.keys((remote && remote.collections) || {})]);
  for (const c of colls) {
    merged.collections[c] = merged.collections[c] || {};
    const L = (local && local.collections[c]) || {};
    const R = (remote && remote.collections[c]) || {};
    const ids = new Set([...Object.keys(L), ...Object.keys(R)]);
    for (const id of ids) {
      const l = L[id], r = R[id];
      if (l && r && l.updatedAt === r.updatedAt && (l.updatedBy || '') === (r.updatedBy || '')) {
        merged.collections[c][id] = l;
        continue;
      }
      if (newer(r, l)) {
        merged.collections[c][id] = r;
        changedLocal = true;
        if (l && dirty.has(c + '/' + id)) overwritten.push({ coll: c, id, name: r.name || l.name || id, by: r.updatedBy || '' });
      } else {
        merged.collections[c][id] = l;
        changedRemote = true;
      }
    }
  }
  merged.updatedAt = [local && local.updatedAt, remote && remote.updatedAt].filter(Boolean).sort().pop() || merged.updatedAt;
  return { merged, overwritten, changedLocal, changedRemote };
}
