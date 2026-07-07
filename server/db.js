const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SALES_FILE = path.join(DATA_DIR, 'sales.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  ensureDataDir();
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  ensureDataDir();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// --- Sales ---

function getAllSales() {
  return readJson(SALES_FILE, []);
}

// Upsert a batch of sale records, keyed by (source, externalId).
// Returns { inserted, updated }.
function upsertSales(records) {
  const sales = getAllSales();
  const index = new Map(sales.map((s, i) => [`${s.source}:${s.externalId}`, i]));
  let inserted = 0;
  let updated = 0;

  for (const rec of records) {
    const key = `${rec.source}:${rec.externalId}`;
    if (index.has(key)) {
      sales[index.get(key)] = rec;
      updated += 1;
    } else {
      sales.push(rec);
      index.set(key, sales.length - 1);
      inserted += 1;
    }
  }

  writeJsonAtomic(SALES_FILE, sales);
  return { inserted, updated, total: sales.length };
}

// Remplace entierement les enregistrements d'une source par un nouveau lot.
// Utilise pour les sources en mode mock: le generateur produit a chaque
// sync son jeu de donnees complet, donc un replace evite l'accumulation de
// vieux enregistrements (ex: restes d'une tentative reelle precedente, ou
// d'une ancienne "generation" de donnees de demo) qui resteraient melanges
// indefiniment via upsert (voir README, section "Limite connue").
function replaceSourceSales(source, records) {
  const sales = getAllSales().filter((s) => s.source !== source);
  const before = sales.length;
  sales.push(...records);

  writeJsonAtomic(SALES_FILE, sales);
  return { inserted: sales.length - before, updated: 0, total: sales.length };
}

// --- Sync meta (last fetch status per source) ---

function getMeta() {
  return readJson(META_FILE, { sources: {} });
}

function setSourceMeta(source, patch) {
  const meta = getMeta();
  meta.sources = meta.sources || {};
  meta.sources[source] = { ...meta.sources[source], ...patch };
  writeJsonAtomic(META_FILE, meta);
  return meta;
}

// Efface la meta d'une source (dont lastSuccessAt) pour forcer une
// resynchronisation complete: sans lastSuccessAt, sinceIsoFor() (voir
// services/sync.js) retombe sur initialSyncDays au prochain cycle plutot
// que de repartir de la derniere sync incrementale. Les enregistrements
// deja stockes (data/sales.json) ne sont pas touches - le prochain sync
// les mettra a jour par upsert (meme externalId), sans doublons.
function resetSourceMeta(source) {
  const meta = getMeta();
  meta.sources = meta.sources || {};
  delete meta.sources[source];
  writeJsonAtomic(META_FILE, meta);
  return meta;
}

module.exports = {
  getAllSales,
  upsertSales,
  replaceSourceSales,
  getMeta,
  setSourceMeta,
  resetSourceMeta,
};
