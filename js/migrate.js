// Приведение данных к текущей схеме (v2: группы рецептов, шаги списком, без «сложности»).
// Применяется при каждом чтении: локальном, с Диска и после слияния. Идемпотентно.
import { COLLECTIONS } from './config.js';

export const SCHEMA = 2;

export function splitSteps(text) {
  return String(text || '').split(/\n+/).map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
}

export function normalize(db) {
  if (!db || !db.collections) return db;
  for (const c of COLLECTIONS) db.collections[c] = db.collections[c] || {};
  for (const r of Object.values(db.collections.recipes)) {
    if (r.deleted) continue;
    if (typeof r.steps === 'string') r.steps = splitSteps(r.steps);
    if (!Array.isArray(r.steps)) r.steps = [];
    delete r.difficulty; delete r.parentId; delete r.variantLabel;
    if (r.groupId === undefined) r.groupId = null;
    r.ingredients = (r.ingredients || []).map((it) => ({ ing: it.ing, g: Number(it.g) || 0, unit: it.unit === 'pc' ? 'pc' : 'g' }));
    r.tags = Array.isArray(r.tags) ? r.tags : [];
  }
  for (const g of Object.values(db.collections.groups)) {
    if (g.deleted) continue;
    g.order = Array.isArray(g.order) ? g.order : [];
  }
  db.schema = SCHEMA;
  return db;
}
