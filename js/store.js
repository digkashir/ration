// Состояние приложения: локальная копия базы + синхронизация с Google Диском.
import * as idb from './db.js';
import * as drive from './drive.js';
import { merge, emptyDb } from './sync.js';
import { CONFIG } from './config.js';
import { normalize } from './migrate.js';

const listeners = new Set();
export const state = {
  data: null,          // база: { schema, collections: { ingredients, tags, recipes, persons, plan } }
  meta: null,          // { mode: 'local'|'drive', fileId, fileLink, remoteVersion, lastSync, user, dirty: [] }
  status: 'idle',      // idle | local | syncing | synced | dirty | offline | auth | error
  error: '',
  rev: 0,              // растёт при каждом изменении данных (для перерисовки)
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(state); }
export function toast(text, kind = 'info') { window.dispatchEvent(new CustomEvent('ration:toast', { detail: { text, kind } })); }

function setStatus(s, error = '') { state.status = s; state.error = error; emit(); }

async function persist() {
  await idb.set('data', state.data);
  await idb.set('meta', state.meta);
}

export async function init() {
  state.data = normalize((await idb.get('data')) || null);
  state.meta = (await idb.get('meta')) || null;
  if (state.meta) state.meta.dirty = state.meta.dirty || [];
  refreshStatus();
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => refreshStatus());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  setInterval(() => sync(), CONFIG.syncIntervalMs);
  return !!state.data;
}

function refreshStatus() {
  if (!state.meta) return setStatus('idle');
  if (state.meta.mode !== 'drive') return setStatus('local');
  if (!navigator.onLine) return setStatus('offline');
  if (!drive.hasToken()) return setStatus('auth');
  setStatus(state.meta.dirty.length ? 'dirty' : 'synced');
}

export async function loadSeed() {
  const r = await fetch('data/seed.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('Не удалось загрузить стартовую базу');
  return normalize(await r.json());
}

/** Начать работу только на этом устройстве (без входа). */
export async function startLocal() {
  state.data = await loadSeed();
  state.meta = { mode: 'local', dirty: [], user: null };
  await persist();
  refreshStatus();
}

// ---------- чтение ----------
export function list(coll) {
  const c = (state.data && state.data.collections[coll]) || {};
  return Object.values(c).filter((x) => !x.deleted);
}
export function get(coll, id) {
  const x = state.data && state.data.collections[coll][id];
  return x && !x.deleted ? x : null;
}

// ---------- запись ----------
export function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function stamp(rec) {
  rec.updatedAt = new Date().toISOString();
  rec.updatedBy = (state.meta && state.meta.user && state.meta.user.email) || 'local';
  return rec;
}

export async function put(coll, rec) {
  state.data.collections[coll][rec.id] = stamp({ ...rec });
  markDirty(coll, rec.id);
  state.rev++;
  await persist();
  emit();
  scheduleSync();
}

/** Несколько изменений разом: [{ coll, rec }] или [{ coll, id, remove: true }]. */
export async function putAll(changes) {
  for (const ch of changes) {
    if (ch.remove) {
      const old = state.data.collections[ch.coll][ch.id] || { id: ch.id };
      state.data.collections[ch.coll][ch.id] = stamp({ id: ch.id, name: old.name, deleted: true });
      markDirty(ch.coll, ch.id);
    } else {
      state.data.collections[ch.coll][ch.rec.id] = stamp({ ...ch.rec });
      markDirty(ch.coll, ch.rec.id);
    }
  }
  state.rev++;
  await persist();
  emit();
  scheduleSync();
}

export async function remove(coll, id) {
  const old = state.data.collections[coll][id] || { id };
  state.data.collections[coll][id] = stamp({ id, name: old.name, deleted: true });
  markDirty(coll, id);
  state.rev++;
  await persist();
  emit();
  scheduleSync();
}

function markDirty(coll, id) {
  const k = coll + '/' + id;
  if (!state.meta.dirty.includes(k)) state.meta.dirty.push(k);
  if (state.meta.mode === 'drive' && state.status !== 'syncing') setStatus(navigator.onLine ? 'dirty' : 'offline');
}

let timer = null;
function scheduleSync() {
  clearTimeout(timer);
  timer = setTimeout(() => sync(), CONFIG.syncDebounceMs);
}

// ---------- Google Диск ----------
let syncing = null;
export function sync() {
  if (syncing) return syncing;
  syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  if (!state.meta || state.meta.mode !== 'drive' || !state.meta.fileId) return refreshStatus();
  if (!navigator.onLine) return setStatus('offline');
  if (!drive.hasToken()) return setStatus('auth');
  setStatus('syncing');
  try {
    const dirty = new Set(state.meta.dirty);
    const recAt = (k) => { const [c, id] = k.split('/'); const r = state.data.collections[c][id]; return r ? r.updatedAt : ''; };
    const snapshot = new Map([...dirty].map((k) => [k, recAt(k)]));
    const metaR = await drive.getMeta(state.meta.fileId);
    let data = state.data;
    let needUpload = dirty.size > 0;
    if (String(metaR.version) !== String(state.meta.remoteVersion)) {
      const remote = normalize(await drive.download(state.meta.fileId));
      const m = merge(state.data, remote, dirty);
      data = normalize(m.merged);
      needUpload = m.changedRemote;
      if (m.overwritten.length) {
        toast('Более поздние правки с другого устройства заменили ваши: ' + m.overwritten.slice(0, 3).map((o) => '«' + o.name + '»').join(', ') +
          (m.overwritten.length > 3 ? ' и ещё ' + (m.overwritten.length - 3) : ''), 'warn');
      }
    }
    let version = metaR.version;
    if (needUpload) {
      data.updatedAt = new Date().toISOString();
      const up = await drive.upload(state.meta.fileId, data);
      version = up.version;
    }
    // Правки, сделанные пока шла синхронизация, остаются несинхронизированными.
    const stillDirty = state.meta.dirty.filter((k) => !snapshot.has(k) || snapshot.get(k) !== recAt(k));
    if (data !== state.data) {
      for (const k of stillDirty) {
        const [c, id] = k.split('/');
        data.collections[c][id] = state.data.collections[c][id];
      }
    }
    if (data !== state.data) state.rev++;
    state.data = data;
    state.meta.remoteVersion = version;
    state.meta.lastSync = new Date().toISOString();
    state.meta.fileLink = metaR.webViewLink || state.meta.fileLink;
    state.meta.dirty = stillDirty;
    await persist();
    setStatus(stillDirty.length ? 'dirty' : 'synced');
    if (stillDirty.length) scheduleSync();
  } catch (e) {
    if (e instanceof drive.AuthError) return setStatus('auth');
    console.error(e);
    setStatus(navigator.onLine ? 'error' : 'offline', e.message);
  }
}

/**
 * Вход и подключение к базе на Диске. Вызывать из клика.
 * @returns 'connected' | 'need-setup'
 */
export async function connect() {
  const hint = state.meta && state.meta.user ? state.meta.user.email : '';
  await drive.signIn({ hint });
  const user = await drive.about();
  if (!state.meta) state.meta = { mode: 'local', dirty: [] };
  state.meta.user = { name: user.displayName, email: user.emailAddress };
  if (state.meta.mode === 'drive' && state.meta.fileId) {
    await persist();
    await sync();
    return 'connected';
  }
  const f = await drive.findDataFile();
  if (f) {
    await attach(f);
    return 'connected';
  }
  await persist();
  emit();
  return 'need-setup';
}

async function attach(file) {
  state.meta.mode = 'drive';
  state.meta.fileId = file.id;
  state.meta.fileLink = file.webViewLink || '';
  state.meta.remoteVersion = null; // заставит скачать и слить
  if (!state.data) state.data = emptyDb();
  // локальные записи сольются с файлом на Диске по правилу «побеждает более поздняя версия»
  state.meta.dirty = [];
  await persist();
  await sync();
}

/** Создать новую базу на Диске владельца: папка «Планировщик еды» + ration-db.json. */
export async function createBase() {
  if (!state.data) state.data = await loadSeed();
  const folder = (await drive.findFolder()) || (await drive.createFolder());
  const file = await drive.createDataFile(folder.id, state.data);
  state.meta.mode = 'drive';
  state.meta.fileId = file.id;
  state.meta.fileLink = file.webViewLink || '';
  state.meta.remoteVersion = file.version;
  state.meta.lastSync = new Date().toISOString();
  state.meta.dirty = [];
  await persist();
  refreshStatus();
}

/** Подключить общую базу, которой поделился владелец (окно выбора файла Google). */
export async function joinShared() {
  const doc = await drive.pickDataFile();
  if (!doc) return false;
  if (!state.data) state.data = await loadSeed();
  await attach({ id: doc.id, webViewLink: doc.url });
  return true;
}

export async function signInAgain() {
  const hint = state.meta && state.meta.user ? state.meta.user.email : '';
  await drive.signIn({ hint });
  await sync();
}

export async function signOut() {
  drive.signOut();
  refreshStatus();
}

/** Полный сброс устройства (данные на Диске не трогаем). */
export async function resetDevice() {
  drive.signOut();
  await idb.del('data');
  await idb.del('meta');
  state.data = null; state.meta = null;
  setStatus('idle');
}

export function backupBlob() {
  return new Blob([JSON.stringify(state.data, null, 1)], { type: 'application/json' });
}
