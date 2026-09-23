// Вход через Google и работа с Google Диском (доступ drive.file — только к файлам приложения
// и к файлам, которые пользователь сам выбрал в окне Google Picker).
import { CONFIG } from './config.js';

export class AuthError extends Error {
  constructor(msg = 'Нужен вход в Google') { super(msg); this.name = 'AuthError'; }
}

const TOKEN_KEY = 'ration.token';
let token = null;
let tokenExp = 0;

(function restore() {
  try {
    const s = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    if (s && s.exp > Date.now()) { token = s.token; tokenExp = s.exp; }
  } catch (e) { /* нет sessionStorage — не страшно */ }
})();

function saveToken() {
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: tokenExp })); } catch (e) { /* */ }
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
export async function signIn({ hint = '', consent = false } = {}) {
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
      error_callback: (e) => reject(new AuthError(e && e.message ? e.message : 'Вход отменён')),
    });
    client.requestAccessToken({ prompt: consent ? 'consent' : '', login_hint: hint || undefined });
  });
}

export function signOut() {
  if (token && window.google && window.google.accounts) {
    try { window.google.accounts.oauth2.revoke(token, () => {}); } catch (e) { /* */ }
  }
  token = null; tokenExp = 0;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* */ }
}

async function api(url, opts = {}) {
  if (!hasToken()) throw new AuthError();
  const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  if (res.status === 401) { token = null; tokenExp = 0; throw new AuthError(); }
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Google Диск ответил ошибкой ' + res.status + ': ' + text.slice(0, 300));
  }
  return res;
}

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const META_FIELDS = 'id,name,version,modifiedTime,webViewLink,parents';

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
