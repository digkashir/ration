// Выгрузка «Покупки и гид» в одну Google Таблицу (3.5, Q-10, Q-20, решения Q-70…Q-77).
// Таблица «Рацион — покупки и гид» лежит в папке «Планировщик еды» и перезаписывается целиком:
// лист «Список покупок» (15D: по отделам, флажки «куплено», дни готовки над столбцами готовок)
// и лист «Гид» (15F: ингредиенты слева, шаги справа).
import * as store from './store.js';
import * as drive from './drive.js';
import { dayParts, rangeTitle, slotOf } from './plan-model.js';
import { mealsText } from './export-model.js';
import { fmt } from './util.js';

export const TITLE = 'Рацион — покупки и гид';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHOP = 101, GUIDE = 102;

// ---------- ячейки ----------
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 }; };
const INK = rgb('#232325'), MUTED = rgb('#6E6B66'), DARK = rgb('#39393C'), LIGHT = rgb('#F6F5F2'), HEAD = rgb('#F3F1EC'), CAT = rgb('#EEF0EA'), SUB = rgb('#EDEBE6');
const SLOT = { breakfast: '#F4BE34', snack: '#A9D8C4', lunch: '#BCC7D3', dinner: '#F59A76', tea: '#D6D3CC' };
function cell(v, f = {}) {
  const c = { userEnteredFormat: { verticalAlignment: 'MIDDLE', ...f } };
  if (v === null || v === undefined || v === '') return c;
  if (typeof v === 'number') c.userEnteredValue = { numberValue: v };
  else if (typeof v === 'boolean') c.userEnteredValue = { boolValue: v };
  else c.userEnteredValue = { stringValue: String(v) };
  return c;
}
const txt = (o) => ({ textFormat: { foregroundColor: INK, ...o } });
const round = (g) => (g < 10 ? Math.round(g * 10) / 10 : Math.round(g));
const num = (n) => fmt(n, 1);
const dd = (d) => { const x = dayParts(d); return `${x.dow} ${x.d}`; };
const width = (sheetId, i, px) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
const pad = (row, n, f) => { while (row.length < n) row.push(cell('', f)); return row; };

// ---------- лист «Список покупок» ----------
export function shopSheet(m) {
  const cooks = m.cooks;
  const loose = m.hasLoose;
  const C0 = 6; // A ✓ | B ингредиент | C купить | D ≈ шт | E нужно | F есть дома | готовки…
  const ncol = C0 + cooks.length + (loose ? 1 : 0);
  const rows = []; const req = [];
  // строка 1: заголовок и дни приготовления над столбцами готовок
  const r1 = [cell(''), cell(`Покупки · ${rangeTitle(m.from, m.to)} · по дням ${m.basis === 'cook' ? 'приготовления' : 'приёма'}`, txt({ bold: true, fontSize: 11 }))];
  pad(r1, C0, {});
  let prev = null; let start = C0;
  cooks.forEach((c, i) => {
    const col = C0 + i;
    if (c.day !== prev) {
      if (prev !== null && col - start > 1) req.push({ mergeCells: { range: { sheetId: SHOP, startRowIndex: 0, endRowIndex: 1, startColumnIndex: start, endColumnIndex: col }, mergeType: 'MERGE_ALL' } });
      prev = c.day; start = col;
    }
    r1.push(cell(col === start ? `${m.basis === 'cook' ? 'готовить ' : ''}${dd(c.day)}` : '', { backgroundColor: DARK, ...txt({ bold: true, foregroundColor: LIGHT }) }));
  });
  if (cooks.length && C0 + cooks.length - start > 1) req.push({ mergeCells: { range: { sheetId: SHOP, startRowIndex: 0, endRowIndex: 1, startColumnIndex: start, endColumnIndex: C0 + cooks.length }, mergeType: 'MERGE_ALL' } });
  if (loose) r1.push(cell('', { backgroundColor: DARK }));
  rows.push(r1);
  // строка 2: названия столбцов
  const hf = { backgroundColor: HEAD, ...txt({ bold: true }), wrapStrategy: 'WRAP', borders: { bottom: { style: 'SOLID_MEDIUM', color: rgb('#9A968E') } } };
  const hr = { ...hf, horizontalAlignment: 'RIGHT' };
  const r2 = [cell('✓', { ...hf, horizontalAlignment: 'CENTER' }), cell('Ингредиент', hf), cell('Купить, г', hr), cell('≈ штук', hr), cell('Нужно, г', hr), cell('Есть дома, г', hr)];
  for (const c of cooks) r2.push(cell(`${c.title}\n${num(c.n)} порц.`, hf));
  if (loose) r2.push(cell('без рецепта', hf));
  rows.push(r2);
  // группы по отделам
  let r = 2; const checks = [];
  let cat = null; let gStart = null;
  const closeGroup = () => { if (gStart !== null && r > gStart) checks.push([gStart, r]); };
  for (const x of m.shop) {
    if (x.cat !== cat) {
      closeGroup();
      cat = x.cat;
      const row = [cell('', { backgroundColor: CAT }), cell(cat.toUpperCase(), { backgroundColor: CAT, ...txt({ bold: true }) })];
      rows.push(pad(row, ncol, { backgroundColor: CAT })); r++;
      gStart = r;
    }
    const right = { horizontalAlignment: 'RIGHT' };
    const row = [
      cell(!!x.bought, { horizontalAlignment: 'CENTER' }),
      cell(x.name),
      cell(round(x.buy), { ...right, ...txt({ bold: true }) }),
      cell(x.pcsBuy ? `${num(x.pcsBuy)} ${x.unitName}` : '', { ...right, ...txt({ foregroundColor: MUTED }) }),
      cell(round(x.need), right),
      cell(x.have ? round(x.have) : '', { ...right, ...txt({ foregroundColor: MUTED }) }),
    ];
    x.cols.slice(0, cooks.length).forEach((g) => row.push(cell(g ? round(g) : '', right)));
    if (loose) row.push(cell(x.cols[m.looseCol] ? round(x.cols[m.looseCol]) : '', right));
    rows.push(row); r++;
  }
  closeGroup();
  if (m.hidden.length) {
    rows.push([]); r++;
    rows.push([cell(''), cell(`Не покупаются: ${m.hidden.map((x) => x.name).join(', ')} — флажок «не покупать» в карточке ингредиента`, txt({ italic: true, foregroundColor: MUTED }))]); r++;
  }
  for (const [a, b] of checks) {
    req.push({ setDataValidation: { range: { sheetId: SHOP, startRowIndex: a, endRowIndex: b, startColumnIndex: 0, endColumnIndex: 1 }, rule: { condition: { type: 'BOOLEAN' }, showCustomUi: true } } });
  }
  if (m.shop.length) {
    req.push({ addConditionalFormatRule: { index: 0, rule: {
      ranges: [{ sheetId: SHOP, startRowIndex: 2, endRowIndex: r, startColumnIndex: 1, endColumnIndex: 6 }],
      booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=$A3=TRUE' }] }, format: { textFormat: { strikethrough: true, foregroundColor: MUTED } } },
    } } });
  }
  const widths = [34, 230, 84, 76, 76, 90, ...cooks.map(() => 104), ...(loose ? [96] : [])].map((px, i) => width(SHOP, i, px));
  return { rows, ncol, nrow: rows.length, requests: [
    { updateCells: { rows: rows.map((v) => ({ values: v })), fields: 'userEnteredValue,userEnteredFormat', start: { sheetId: SHOP, rowIndex: 0, columnIndex: 0 } } },
    ...req, ...widths,
    { updateDimensionProperties: { range: { sheetId: SHOP, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 42 }, fields: 'pixelSize' } },
  ] };
}

// ---------- лист «Гид» ----------
export function guideSheet(m) {
  const rows = []; const req = [];
  const W = 4; // A ингредиент | B граммы | C штуки | D шаги
  const ing = (id) => store.get('ingredients', id);
  const pcsText = (id, g) => { const x = ing(id); return x && x.unitWeight ? `${num(g / x.unitWeight)} ${x.unitName || 'шт'}` : ''; };
  rows.push([cell(`Гид · ${rangeTitle(m.from, m.to)} · по дням ${m.basis === 'cook' ? 'приготовления' : 'приёма'}`, txt({ bold: true, fontSize: 12 }))]);
  rows.push([]);
  for (const d of m.days) {
    const n = d.cooks.reduce((s, c) => s + c.n, 0);
    const df = { backgroundColor: DARK, ...txt({ bold: true, foregroundColor: LIGHT, fontSize: 11 }) };
    rows.push(pad([cell(`${m.basis === 'cook' ? 'Готовить ' : ''}${dd(d.date)}`, df), cell('', df), cell('', df),
      cell(d.cooks.length ? `${d.cooks.length} ${d.cooks.length === 1 ? 'готовка' : d.cooks.length < 5 ? 'готовки' : 'готовок'} · ${num(n)} порц.` : '', { ...df, textFormat: { foregroundColor: LIGHT } })], W, df));
    for (const c of d.cooks) {
      const bg = rgb(SLOT[c.meals[0].slot] || '#EDEBE6');
      const tf = { backgroundColor: bg };
      rows.push([cell(c.title, { ...tf, ...txt({ bold: true, fontSize: 11 }) }), cell(`${num(c.n)} порц.`, { ...tf, horizontalAlignment: 'RIGHT', ...txt({ bold: true }) }), cell('', tf),
        cell((c.meals.length > 1 ? 'одна готовка: ' : 'на ') + mealsText(c, dayParts, num), { ...tf, ...txt({ foregroundColor: rgb('#3A3A3A') }) })]);
      const many = c.variants.length > 1 || c.variants.some((v) => v.own);
      for (const v of c.variants) {
        if (many) rows.push([cell(v.name, { backgroundColor: SUB, ...txt({ bold: true }) }), cell(`${num(v.n)} порц.`, { backgroundColor: SUB, horizontalAlignment: 'RIGHT' }), cell('', { backgroundColor: SUB }),
          cell(v.who.join(', '), { backgroundColor: SUB, ...txt({ foregroundColor: MUTED }) })]);
        const steps = v.s.steps || [];
        const k = Math.max(v.ings.length, steps.length);
        for (let i = 0; i < k; i++) {
          const it = v.ings[i]; const x = it && ing(it.ing);
          rows.push([
            cell(it ? (x ? x.name : 'удалённый ингредиент') : ''),
            cell(it ? round(it.g) : '', { horizontalAlignment: 'RIGHT', ...txt({ bold: true }) }),
            cell(it ? pcsText(it.ing, it.g) : '', txt({ foregroundColor: MUTED })),
            cell(steps[i] ? `${i + 1}. ${steps[i]}` : '', { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' }),
          ]);
        }
        if (v.s.desc) rows.push([cell(''), cell(''), cell(''), cell(v.s.desc, { wrapStrategy: 'WRAP', ...txt({ italic: true, foregroundColor: MUTED }) })]);
      }
      rows.push([]);
    }
    if (d.loose.length) {
      rows.push(pad([cell('Ингредиенты без рецепта', { backgroundColor: CAT, ...txt({ bold: true }) })], W, { backgroundColor: CAT }));
      for (const l of d.loose) {
        const x = ing(l.ing);
        rows.push([cell(l.name), cell(round(l.g), { horizontalAlignment: 'RIGHT', ...txt({ bold: true }) }),
          cell(l.unit === 'pc' && x && x.unitWeight ? `${num(l.n)} ${x.unitName || 'шт'}` : pcsText(l.ing, l.g), txt({ foregroundColor: MUTED })),
          cell(`${slotOf(l.slot).name}${m.basis === 'cook' ? '' : ''} · ${l.who.join(', ')}`, txt({ foregroundColor: MUTED }))]);
      }
      rows.push([]);
    }
  }
  const widths = [260, 84, 84, 760].map((px, i) => width(GUIDE, i, px));
  return { rows, nrow: rows.length, requests: [
    { updateCells: { rows: rows.map((v) => ({ values: v })), fields: 'userEnteredValue,userEnteredFormat', start: { sheetId: GUIDE, rowIndex: 0, columnIndex: 0 } } },
    ...req, ...widths,
    { autoResizeDimensions: { dimensions: { sheetId: GUIDE, dimension: 'ROWS', startIndex: 0, endIndex: rows.length } } },
  ] };
}

// ---------- выгрузка ----------
/** Все запросы batchUpdate: пересоздать два листа и заполнить их. oldIds — листы, которые сейчас есть в таблице. */
export function buildRequests(m, oldIds) {
  const shop = shopSheet(m); const guide = guideSheet(m);
  const tmp = 900000 + Math.floor(Math.random() * 90000);
  return [
    { addSheet: { properties: { sheetId: tmp, title: 'tmp-' + tmp } } },
    ...oldIds.map((sheetId) => ({ deleteSheet: { sheetId } })),
    { addSheet: { properties: { sheetId: SHOP, title: 'Список покупок', index: 0, gridProperties: { rowCount: Math.max(shop.nrow + 5, 30), columnCount: Math.max(shop.ncol, 8), frozenRowCount: 2, frozenColumnCount: 2 } } } },
    { addSheet: { properties: { sheetId: GUIDE, title: 'Гид', index: 1, gridProperties: { rowCount: Math.max(guide.nrow + 5, 30), columnCount: 6, frozenRowCount: 1 } } } },
    { deleteSheet: { sheetId: tmp } },
    ...shop.requests, ...guide.requests,
  ];
}

export async function exportModel(m) {
  const set = store.get('settings', 'export');
  let id = set && set.sheetId;
  if (id) {
    try { const f = await drive.fileInfo(id); if (!f || f.trashed) id = null; } catch (e) { if (e instanceof drive.AuthError) throw e; id = null; }
  }
  if (!id) {
    const folder = (await drive.findFolder()) || (await drive.createFolder());
    const f = await drive.createSheetFile(TITLE, folder.id);
    id = f.id;
  }
  const meta = await (await drive.request(`${API}/${id}?fields=sheets.properties.sheetId`)).json();
  const oldIds = (meta.sheets || []).map((s) => s.properties.sheetId);
  await drive.request(`${API}/${id}:batchUpdate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: buildRequests(m, oldIds) }),
  });
  return { id, link: `https://docs.google.com/spreadsheets/d/${id}/edit` };
}

/** Понятный текст ошибки выгрузки. */
export function explain(e) {
  const t = String((e && e.message) || e);
  if (e instanceof drive.AuthError) return 'Нужно снова войти в Google: меню аккаунта → «Войти и подключить Google Диск», затем повторите выгрузку.';
  if (/SERVICE_DISABLED|has not been used|sheets\.googleapis\.com.*disabled|API has not been/i.test(t)) return 'Google Таблицы ещё не включены для проекта: в Google Cloud откройте APIs & Services → Library → Google Sheets API → Enable, подождите пару минут и повторите.';
  if (/Failed to fetch|NetworkError/i.test(t)) return 'Нет связи с Google. Проверьте интернет и повторите.';
  return 'Не удалось выгрузить таблицу: ' + t.replace(/^Google Диск ответил ошибкой/, 'Google ответил ошибкой');
}
