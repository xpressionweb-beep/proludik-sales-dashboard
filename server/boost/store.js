const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DEFAULT_DEFIS = require('./defaultDefis');

// Boîte à missions "Le Boost" (réunion ventes du mardi).
// Tout l'état tient dans un seul fichier JSON sur le disque persistant
// (DATA_DIR), comme sales.json et notifs.json.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'boost.json');

// Une mission réussie sort de la boîte pendant 6 semaines.
const REPOS_JOURS = 42;
const TZ = 'America/Toronto';

const DEFAULT_REPS = ['Cédric', 'Mathis', 'Didier'];

// Date du jour (AAAA-MM-JJ) à l'heure de Montréal/Québec, pas en UTC:
// Render tourne en UTC, une réunion à 20h serait sinon datée du lendemain.
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    const seed = {
      defis: DEFAULT_DEFIS.map((d) => ({ ...d, actif: true })),
      semaines: [],
      config: { reps: DEFAULT_REPS, parReunion: 3 },
    };
    save(seed);
    return seed;
  }
  const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  s.defis = s.defis || [];
  s.semaines = s.semaines || [];
  s.config = { reps: [], parReunion: 3, ...(s.config || {}) };
  return s;
}

function save(state) {
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

// État d'une mission, calculé à partir du dernier tirage où elle apparaît.
function statusOf(state, defiId, ref = today()) {
  const d = state.defis.find((x) => x.id === defiId);
  if (d && d.actif === false) return { k: 'off' };
  const weeks = [...state.semaines].sort((a, b) => b.id.localeCompare(a.id));
  for (const s of weeks) {
    const ts = s.tirages.filter((t) => t.defiId === defiId);
    if (!ts.length) continue;
    const t = ts[ts.length - 1];
    if (!t.resultat) return { k: 'encours', rep: t.rep, date: s.id };
    if (t.resultat === 'rate') return { k: 'dispo' };
    const fin = addDays(t.le || s.id, REPOS_JOURS);
    return fin > ref ? { k: 'repos', jusqua: fin } : { k: 'dispo' };
  }
  return { k: 'dispo' };
}

function week(state, id, create = false) {
  let w = state.semaines.find((s) => s.id === id);
  if (!w && create) {
    w = { id, tirages: [] };
    state.semaines.push(w);
  }
  return w;
}

function newId(prefix) {
  return prefix + crypto.randomBytes(5).toString('hex');
}

module.exports = { load, save, statusOf, week, today, addDays, newId, REPOS_JOURS };
