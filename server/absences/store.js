const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Calendrier des absences / vacances du staff bureau (page public/absences.html).
// Tout l'état tient dans un seul fichier JSON sur le disque persistant
// (DATA_DIR), comme sales.json, notifs.json et boost.json.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'absences.json');
const TZ = 'America/Toronto';

// Types d'absence (reprennent les codes de couleur de l'ancien Excel).
const TYPES = {
  vacances: { label: 'Vacances', paye: true },
  autre_paye: { label: 'Autre absence payée', paye: true },
  maladie_perso: { label: 'Maladie / journée perso', paye: true },
  sans_solde: { label: 'Sans solde', paye: false },
};

const STATUTS = ['demande', 'approuve', 'refuse', 'annule'];
const ROLES = ['employe', 'paye', 'admin'];

// Staff bureau repris de l'ancien fichier Excel. Jérôme = admin (approuve).
const DEFAULT_STAFF = [
  ['André', 'employe'], ['Isabelle', 'paye'], ['Rosalie', 'paye'],
  ['Jérôme', 'admin'], ['Mathieu', 'employe'], ['Cédric', 'employe'],
  ['Didier', 'employe'], ['Daniel', 'employe'], ['Mathis', 'employe'],
];

// ---------- Dates (toujours en chaînes AAAA-MM-JJ, calculs en UTC) ----------

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function iso(dt) {
  return dt.toISOString().slice(0, 10);
}

function addDays(s, n) {
  const dt = toDate(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return iso(dt);
}

function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return iso(toDate(s)) === s;
}

function isWeekend(s) {
  const d = toDate(s).getUTCDay();
  return d === 0 || d === 6;
}

// Dimanche de Pâques (algorithme grégorien anonyme).
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(new Date(Date.UTC(year, month - 1, day)));
}

// n-ième lundi d'un mois (month 1-12)
function nthMonday(year, month, n) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (8 - first.getUTCDay()) % 7; // jours jusqu'au 1er lundi
  return iso(new Date(Date.UTC(year, month - 1, 1 + offset + 7 * (n - 1))));
}

// Les 8 jours fériés prévus par la Loi sur les normes du travail du Québec.
// (Vendredi saint OU lundi de Pâques au choix de l'employeur: Vendredi saint
// par défaut, modifiable dans l'onglet Gestion.) Les congés « maison »
// (26 déc., 2 janv., etc.) s'ajoutent à la main dans Gestion.
function feriesQuebec(year) {
  // Journée nationale des patriotes: le lundi qui précède le 25 mai.
  let patriotes = `${year}-05-24`;
  while (toDate(patriotes).getUTCDay() !== 1) patriotes = addDays(patriotes, -1);
  return [
    { date: `${year}-01-01`, nom: "Jour de l'An" },
    { date: addDays(easter(year), -2), nom: 'Vendredi saint' },
    { date: patriotes, nom: 'Journée nationale des patriotes' },
    { date: `${year}-06-24`, nom: 'Fête nationale' },
    { date: `${year}-07-01`, nom: 'Fête du Canada' },
    { date: nthMonday(year, 9, 1), nom: 'Fête du Travail' },
    { date: nthMonday(year, 10, 2), nom: "Action de grâces" },
    { date: `${year}-12-25`, nom: 'Noël' },
  ];
}

// Jours ouvrables (lun-ven, hors fériés) entre deux dates incluses,
// optionnellement limités à une fenêtre [from, to] (pour la paye).
function joursOuvrables(abs, feries, from, to) {
  const fset = new Set(feries.map((f) => f.date));
  const start = from && from > abs.debut ? from : abs.debut;
  const end = to && to < abs.fin ? to : abs.fin;
  if (start > end) return 0;
  if (abs.demi && abs.debut === abs.fin) {
    return !isWeekend(start) && !fset.has(start) ? 0.5 : 0;
  }
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!isWeekend(d) && !fset.has(d)) n += 1;
  }
  return n;
}

// ---------- NIP ----------

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return { salt, hash };
}

function checkPin(pin, stored) {
  if (!stored) return false;
  const h = crypto.scryptSync(String(pin), stored.salt, 32);
  return crypto.timingSafeEqual(h, Buffer.from(stored.hash, 'hex'));
}

// ---------- Persistance ----------

function newId(prefix) {
  return prefix + crypto.randomBytes(5).toString('hex');
}

function seed() {
  const y = Number(today().slice(0, 4));
  return {
    secret: crypto.randomBytes(32).toString('hex'),
    employes: DEFAULT_STAFF.map(([nom, role]) => ({
      id: newId('e_'), nom, role, actif: true, pin: null, pinVer: 0,
    })),
    absences: [],
    feries: [...feriesQuebec(y), ...feriesQuebec(y + 1)],
  };
}

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    const s = seed();
    save(s);
    return s;
  }
  const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  s.employes = s.employes || [];
  s.absences = s.absences || [];
  s.feries = s.feries || [];
  let changed = false;
  if (!s.secret) {
    s.secret = crypto.randomBytes(32).toString('hex');
    changed = true;
  }
  if (migrate(s)) changed = true;
  if (changed) save(s);
  return s;
}

// Ajustements ponctuels demandés par Jérôme, appliqués UNE seule fois
// (le drapeau dans s.migrations évite de défaire ce qu'il change ensuite
// dans l'onglet Gestion).
function migrate(s) {
  s.migrations = s.migrations || {};
  if (s.migrations['2026-10-08-kiev-paye']) return false;
  const norm = (n) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  // Retirer Kiev (désactivé seulement s'il a déjà des absences, pour garder l'historique)
  const kiev = s.employes.find((e) => norm(e.nom) === 'kiev');
  if (kiev) {
    if (s.absences.some((a) => a.employeId === kiev.id)) kiev.actif = false;
    else s.employes = s.employes.filter((e) => e.id !== kiev.id);
  }
  // Accès Paye pour Isabelle et Rosalie (sans toucher à un admin)
  for (const e of s.employes) {
    if (['isabelle', 'rosalie'].includes(norm(e.nom)) && e.role !== 'admin') e.role = 'paye';
  }
  s.migrations['2026-10-08-kiev-paye'] = new Date().toISOString();
  return true;
}

function save(state) {
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

module.exports = {
  TYPES, STATUTS, ROLES,
  load, save, newId, today, addDays, isIsoDate, isWeekend,
  feriesQuebec, joursOuvrables, hashPin, checkPin,
};
