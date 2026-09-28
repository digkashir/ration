// Вход через Google и работа с Google Диском (доступ drive.file — только к файлам приложения
// и к файлам, которые пользователь сам выбрал в окне Google Picker).
import { CONFIG } from './config.js';

export class AuthError extends Error {
  constructor(msg = 'Нужен вход в Google') { super(msg); this.name = 'AuthError'; }
}

const TOKEN_KEY = 'ration.token';
const PENDING_KEY = 'ration.auth.pending';
let token = null;
let tokenExp = 0;

// Токен живёт час. Храним его в localStorage: на iPhone приложение с экрана «Домой» теряет sessionStorage
// при каждом закрытии, и пришлось бы входить заново.
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* */ } } };
(function restore() {
  try {
    const s = JSON.parse(ls.get(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || 'null');
    if (s && s.exp > Date.now()) { token = s.token; tokenExp = s.exp; }
  } catch (e) { /* нет хранилища — не страшно */ }
})();

function saveToken() { ls.set(TOKEN_KEY, JSON.stringify({ token, exp: tokenExp })); }

/**
 * Вход переадресацией (вся страница уходит на Google и возвращается с токеном).
 * Нужен на iPhone и iPad: всплывающее окно входа там закрывается, не передав токен («popup window closed»).
 */
export function useRedirect() {
  if (ls.get('ration.auth.mode') === 'redirect') return true;
  if (ls.get('ration.auth.mode') === 'popup') return false;
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios || window.navigator.standalone === true;
}
export const redirectUri = () => CONFIG.redirectUri || (location.origin + location.pathname.replace(/index\.html$/, ''));

function redirectSignIn({ hint, consent, then }) {
  const st = Math.random().toString(36).slice(2) + Date.now().toString(36);
  ls.set(PENDING_KEY, JSON.stringify({ state: st, then: then || '', route: location.hash || '', at: Date.now() }));
  const q = new URLSearchParams({
    client_id: CONFIG.clientId, redirect_uri: redirectUri(), response_type: 'token', scope: CONFIG.scope,
    include_granted_scopes: 'true', state: st,
  });
  if (consent) q.set('prompt', 'consent');
  if (hint) q.set('login_hint', hint);
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q.toString());
  return new Promise(() => {}); // страница уходит на Google
}

/**
 * Вызывается при запуске: если вернулись со страницы входа Google, забрать токен из адреса.
 * @returns {null | {then: string} | {error: string}}
 */
export function takeRedirect() {
  const h = location.hash || '';
  if (!/(^|[#&])(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h.replace(/^#\/?/, ''));
  let pending = null;
  try { pending = JSON.parse(ls.get(PENDING_KEY) || 'null'); } catch (e) { /* */ }
  ls.del(PENDING_KEY);
  const back = (pending && pending.route) || '#/plan';
  history.replaceState(null, '', location.pathname + location.search + back);
  if (!pending || p.get('state') !== pending.state) return { error: 'Вход не завершён: ответ Google не совпал с запросом. Попробуйте ещё раз.' };
  if (p.get('error')) return { error: p.get('error') === 'access_denied' ? 'Вход отменён.' : 'Google не выполнил вход: ' + p.get('error') };
  token = p.get('access_token');
  tokenExp = Date.now() + (Number(p.get('expires_in') || 3600) - 60) * 1000;
  saveToken();
  return { then: pending.then || '' };
}

export function hasToken() { return !!token && Date.now() < tokenExp; }

function waitFor(check, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function tick() {
      const v = check();
      if (v) return resolve(v);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('Не удалось загрузить сервисы Google. Проверьте интернет.'));
      setTimeout(tick, 100);
    })();
  });
}

/** Запросить токен. Вызывать из обработчика клика — иначе браузер может заблокировать окно входа. */
export async function signIn({ hint = '', consent = false, then = '' } = {}) {
  if (hasToken() && !consent) return token;
  if (useRedirect()) return redirectSignIn({ hint, consent, then });
  await waitFor(() => window.google && window.google.accounts && window.google.accounts.oauth2);
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.clientId,
      scope: CONFIG.scope,
      callback: (r) => {
        if (r.error) return reject(new AuthError(r.error_description || r.error));
        token = r.access_token;
        tokenExp = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000;
        saveToken();
        resolve(token);
      },
      error_callback: (e) => {
        // окно не открылось (блокировщик, встроенный браузер) — входим переадресацией
        if (e && e.type === 'popup_failed_to_open') { redirectSignIn({ hint, consent, then }); return; }
        reject(new AuthError(e && e.type === 'popup_closed' ? 'Окно входа закрылось до конца входа. Попробуйте ещё раз.' : (e && e.message ? e.message : 'Вход отменён')));
      },
    });
    client.requestAccessToken({ prompt: consent ? 'consent' : '', login_hint: hint || undefined });
  });
}

export function signOut() {
  if (token && window.google && window.google.accounts) {
    try { window.google.accounts.oauth2.revoke(token, () => {}); } catch (e) { /* */ }
  }
  token = null; tokenExp = 0;
  ls.del(TOKEN_KEY);
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* */ }
}

async function api(url, opts = {}) {
  if (!hasToken()) throw new AuthError();
  const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  if (res.status === 401) { token = null; tokenExp = 0; ls.del(TOKEN_KEY); throw new AuthError(); }
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Google Диск ответил ошибкой ' + res.status + ': ' + text.slice(0, 300));
  }
  return res;
}

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const META_FIELDS = 'id,name,version,modifiedTime,webViewLink,parents';

/** Запрос к API Google от имени пользователя (Диск, Таблицы). */
export const request = (url, opts) => api(url, opts);
/** Сведения о файле (в том числе, не в корзине ли он). */
export async function fileInfo(id) {
  const r = await api(DRIVE + '/files/' + id + '?supportsAllDrives=true&fields=id,name,trashed,webViewLink');
  return r.json();
}
/** Пустая Google Таблица в папке приложения (доступ drive.file: приложение видит её как свою). */
export async function createSheetFile(name, folderId) {
  const r = await api(DRIVE + '/files?supportsAllDrives=true&fields=id,name,webViewLink', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.spreadsheet', parents: folderId ? [folderId] : undefined }),
  });
  return r.json();
}

export async function about() {
  const r = await api(DRIVE + '/about?fields=' + encodeURIComponent('user(displayName,emailAddress)'));
  return (await r.json()).user;
}

async function list(q, fields = 'files(' + META_FIELDS + ')') {
  const url = DRIVE + '/files?spaces=drive&pageSize=50&q=' + encodeURIComponent(q) + '&fields=' + encodeURIComponent(fields) +
    '&includeItemsFromAllDrives=true&supportsAllDrives=true';
  return (await (await api(url)).json()).files || [];
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function findFolder() {
  const f = await list(`name='${esc(CONFIG.folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  return f[0] || null;
}

export async function createFolder() {
  const r = await api(DRIVE + '/files?fields=' + META_FIELDS, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: CONFIG.folderName, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return r.json();
}

export async function findDataFile() {
  const f = await list(`name='${esc(CONFIG.fileName)}' and trashed=false`);
  f.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
  return f[0] || null;
}

export async function createDataFile(folderId, data) {
  const boundary = 'ration' + Math.random().toString(36).slice(2);
  const meta = { name: CONFIG.fileName, mimeType: 'application/json', parents: folderId ? [folderId] : undefined };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
  const r = await api(UPLOAD + '/files?uploadType=multipart&supportsAllDrives=true&fields=' + META_FIELDS, {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body,
  });
  return r.json();
}

export async function getMeta(id) {
  const r = await api(DRIVE + '/files/' + id + '?supportsAllDrives=true&fields=' + META_FIELDS);
  return r.json();
}

export async function download(id) {
  const r = await api(DRIVE + '/files/' + id + '?alt=media&supportsAllDrives=true');
  return r.json();
}

export async function upload(id, data) {
  const r = await api(UPLOAD + '/files/' + id + '?uploadType=media&supportsAllDrives=true&fields=' + META_FIELDS, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(data),
  });
  return r.json();
}

// ---------- Окно выбора файла (для «Подключить общую базу») ----------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('Не удалось загрузить ' + src));
    document.head.appendChild(s);
  });
}

export async function pickDataFile() {
  if (!hasToken()) throw new AuthError();
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve) => window.gapi.load('picker', resolve));
  const gp = window.google.picker;
  return new Promise((resolve) => {
    const shared = new gp.DocsView(gp.ViewId.DOCS).setMimeTypes('application/json').setIncludeFolders(true).setOwnedByMe(false);
    const mine = new gp.DocsView(gp.ViewId.DOCS).setMimeTypes('application/json').setIncludeFolders(true);
    const picker = new gp.PickerBuilder()
      .setTitle('Выберите файл ' + CONFIG.fileName + ' из общей папки «' + CONFIG.folderName + '»')
      .addView(shared)
      .addView(mine)
      .enableFeature(gp.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setDeveloperKey(CONFIG.apiKey)
      .setAppId(CONFIG.appId)
      .setLocale('ru')
      .setCallback((data) => {
        if (data.action === gp.Action.PICKED) resolve(data.docs[0]);
        else if (data.action === gp.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
}
