// Общее состояние интерфейса, реестр действий и слои поверх страницы (панели, диалоги, меню).
export const ui = {
  setup: false,
  busy: false,
  layers: [],   // стек слоёв: { type, ... }
  ing: { q: '', group: 'all', unit: '100' },
  rec: { q: '', sort: 'name', filters: new Set(), expanded: new Set(), collapsed: new Set(), select: false, selected: new Set(), target: null, perPortion: true },
};

/** Реестр действий: data-a="имя" → функция(элемент, событие). Модули добавляют свои. */
export const actions = {};

export const hooks = { render: () => {}, renderOverlay: () => {}, refreshPage: () => {}, refreshLayers: () => {} };

export function openLayer(layer) {
  if (!layer._opener) layer._opener = document.activeElement;
  ui.layers.push(layer); hooks.renderOverlay();
}
export function closeLayer() {
  const l = ui.layers.pop(); hooks.renderOverlay();
  const o = l && l._opener;
  if (o && o.isConnected && typeof o.focus === 'function') o.focus();
}
export function closeAll() { ui.layers = []; hooks.renderOverlay(); }
export function topLayer() { return ui.layers[ui.layers.length - 1] || null; }
export function findLayer(type) { for (let i = ui.layers.length - 1; i >= 0; i--) if (ui.layers[i].type === type) return ui.layers[i]; return null; }

/** Сохранение мелких настроек интерфейса на устройстве (свёрнутые ингредиенты и т.п.). */
export function pref(key, def) {
  try { const v = localStorage.getItem('ration.' + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
}
export function setPref(key, v) {
  try { localStorage.setItem('ration.' + key, JSON.stringify(v)); } catch (e) { /* */ }
}
