const express = require('express');
const crypto = require('crypto');
const XLSX = require('xlsx');
const store = require('../absences/store');

// API du calendrier des absences (page public/absences.html).
//
// Accès: la page et cette API sont exemptées du mot de passe global du
// dashboard (voir basicAuth.js) - les employés n'ont PAS accès aux ventes.
// Chacun se connecte avec son nom + son NIP personnel; une session signée
// (cookie HttpOnly) garde la connexion 30 jours.
//
// Rôles:
//   employe -> voit le calendrier (sans le motif des absences des autres),
//              fait et annule ses propres demandes
//   paye    -> + voit tout le détail et la vue Paye (export Excel)
//   admin   -> + approuve/refuse, entre des absences pour les autres,
//              gère les employés, les NIP et les fériés

const router = express.Router();
const COOKIE = 'abs_session';
const SESSION_DAYS = 30;

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

// ---------- Sessions ----------

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function makeToken(state, emp) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = `${emp.id}.${emp.pinVer || 0}.${exp}`;
  return `${payload}.${sign(state.secret, payload)}`;
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

function sessionEmp(state, req) {
  const tok = readCookie(req);
  if (!tok) return null;
  const parts = tok.split('.');
  if (parts.length !== 4) return null;
  const [id, ver, exp, sig] = parts;
  const expected = sign(state.secret, `${id}.${ver}.${exp}`);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now()) return null;
  const emp = state.employes.find((e) => e.id === id);
  // Changer le NIP (pinVer++) ou désactiver l'employé coupe ses sessions.
  if (!emp || !emp.actif || String(emp.pinVer || 0) !== ver) return null;
  return emp;
}

function setCookie(req, res, value, maxAgeSec) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', [
    `${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${maxAgeSec}`, secure ? 'Secure' : '',
  ].filter(Boolean).join('; '));
}

// Anti-devinette de NIP: 5 essais ratés par employé => 15 min de blocage.
const failures = new Map();
const MAX_TRIES = 5;
const LOCK_MS = 15 * 60000;

function isLocked(id) {
  const f = failures.get(id);
  return f && f.count >= MAX_TRIES && Date.now() - f.last < LOCK_MS;
}
function noteFailure(id) {
  const f = failures.get(id);
  if (!f || Date.now() - f.last >= LOCK_MS) failures.set(id, { count: 1, last: Date.now() });
  else failures.set(id, { count: f.count + 1, last: Date.now() });
}

function validPin(pin) {
  return /^\d{4,6}$/.test(String(pin || ''));
}

// ---------- Middleware ----------

function withState(handler) {
  return (req, res) => {
    try {
      const state = store.load();
      const me = sessionEmp(state, req);
      handler(req, res, state, me);
    } catch (e) {
      console.error('[absences]', e);
      res.status(500).json({ error: e.message });
    }
  };
}

function need(roles, handler) {
  return withState((req, res, state, me) => {
    if (!me) return res.status(401).json({ error: 'Connexion requise.' });
    if (roles && !roles.includes(me.role)) return res.status(403).json({ error: 'Accès refusé.' });
    handler(req, res, state, me);
  });
}

const canSeeAll = (me) => me.role === 'admin' || me.role === 'paye';

// ---------- Vues publiques des données ----------

function empPublic(e, full) {
  const o = { id: e.id, nom: e.nom, actif: e.actif };
  if (full) Object.assign(o, { role: e.role, nipDefini: Boolean(e.pin) });
  return o;
}

function absView(a, state, me) {
  const mine = a.employeId === me.id;
  const jours = store.joursOuvrables(a, state.feries);
  if (mine || canSeeAll(me)) return { ...a, jours };
  // Tout le monde voit le tableau complet (dates, type, statut), comme
  // dans l'ancien Excel. Seules la note et la réponse de l'admin restent
  // privées (la personne concernée, la paye et l'admin).
  return { id: a.id, employeId: a.employeId, debut: a.debut, fin: a.fin, demi: a.demi, statut: a.statut, type: a.type, jours };
}

// ---------- Pushover (avis à l'admin pour chaque nouvelle demande) ----------

async function notifyAdmin(req, text) {
  const token = process.env.PUSHOVER_APP_TOKEN;
  const user = process.env.PUSHOVER_USER_KEY;
  if (!token || !user) return;
  const device = process.env.ABSENCES_PUSHOVER_DEVICE || 'iphone-je';
  try {
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token, user, device, message: text,
        title: "Proludik - Demande d'absence",
        url: `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}/absences.html#approuver`,
        url_title: 'Approuver / refuser',
      }),
    });
  } catch (e) {
    console.error('[absences] Pushover:', e.message);
  }
}

function fmt(d) {
  const [y, m, j] = d.split('-').map(Number);
  const mois = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return `${j} ${mois[m - 1]} ${y}`;
}

// ---------- Connexion ----------

// Liste des noms pour l'écran de connexion (rien de sensible).
router.get('/login-list', withState((req, res, state) => {
  const actifs = state.employes.filter((e) => e.actif).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  res.json({
    employes: actifs.map((e) => ({
      id: e.id, nom: e.nom,
      pret: Boolean(e.pin),
    })),
  });
}));

router.post('/login', withState((req, res, state) => {
  const emp = state.employes.find((e) => e.id === req.body?.employeId && e.actif);
  const pin = String(req.body?.pin || '');
  if (!emp) return res.status(400).json({ error: 'Choisis ton nom.' });
  if (isLocked(emp.id)) return res.status(429).json({ error: 'Trop d’essais. Réessaie dans 15 minutes.' });

  if (!emp.pin) {
    return res.status(400).json({ error: 'Première connexion : choisis ton NIP.', premiere: true });
  }
  const ok = store.checkPin(pin, emp.pin);
  if (!ok) {
    noteFailure(emp.id);
    return res.status(401).json({ error: 'NIP incorrect.' });
  }
  failures.delete(emp.id);
  setCookie(req, res, makeToken(state, emp), SESSION_DAYS * 86400);
  res.json({ ok: true });
}));

// 1re connexion (ou après une réinitialisation par l'admin): la personne
// choisit son NIP, qui reste bon tant qu'elle ne le change pas.
// Seulement possible si aucun NIP n'existe encore pour ce nom.
router.post('/premiere', withState((req, res, state) => {
  const emp = state.employes.find((e) => e.id === req.body?.employeId && e.actif);
  if (!emp) return res.status(400).json({ error: 'Choisis ton nom.' });
  if (emp.pin) return res.status(400).json({ error: 'Ce nom a déjà un NIP. Si ce n’est pas toi qui l’as choisi, avertis Jérôme.' });
  const pin = String(req.body?.pin || '');
  if (!validPin(pin)) return res.status(400).json({ error: 'Le NIP doit avoir de 4 à 6 chiffres.' });
  emp.pin = store.hashPin(pin);
  emp.pinVer = (emp.pinVer || 0) + 1;
  failures.delete(emp.id);
  store.save(state);
  setCookie(req, res, makeToken(state, emp), SESSION_DAYS * 86400);
  res.json({ ok: true });
}));

router.post('/logout', (req, res) => {
  setCookie(req, res, '', 0);
  res.json({ ok: true });
});

router.get('/me', need(null, (req, res, state, me) => {
  res.json({ id: me.id, nom: me.nom, role: me.role, nipPerso: Boolean(me.pin) });
}));

// Changer son propre NIP
router.post('/pin', need(null, (req, res, state, me) => {
  const nouveau = String(req.body?.nouveau || '');
  if (!validPin(nouveau)) return res.status(400).json({ error: 'Le NIP doit avoir de 4 à 6 chiffres.' });
  const emp = state.employes.find((e) => e.id === me.id);
  emp.pin = store.hashPin(nouveau);
  emp.pinVer = (emp.pinVer || 0) + 1;
  store.save(state);
  setCookie(req, res, makeToken(state, emp), SESSION_DAYS * 86400);
  res.json({ ok: true });
}));

// ---------- Calendrier / données ----------

router.get('/state', need(null, (req, res, state, me) => {
  const visibles = state.absences.filter((a) => a.statut === 'demande' || a.statut === 'approuve'
    || ((a.statut === 'refuse' || a.statut === 'annule') && (a.employeId === me.id || canSeeAll(me))));
  res.json({
    today: store.today(),
    me: { id: me.id, nom: me.nom, role: me.role, nipPerso: Boolean(me.pin) },
    types: store.TYPES,
    employes: state.employes.filter((e) => e.actif || canSeeAll(me)).map((e) => empPublic(e, me.role === 'admin')),
    absences: visibles.map((a) => absView(a, state, me)),
    feries: [...state.feries].sort((a, b) => a.date.localeCompare(b.date)),
  });
}));

// Nouvelle demande (ou saisie directe par l'admin pour un employé)
router.post('/absences', need(null, (req, res, state, me) => {
  const b = req.body || {};
  const isAdmin = me.role === 'admin';
  const employeId = isAdmin && b.employeId ? b.employeId : me.id;
  const emp = state.employes.find((e) => e.id === employeId && e.actif);
  if (!emp) return res.status(400).json({ error: 'Employé introuvable.' });

  const debut = b.debut, fin = b.fin || b.debut;
  if (!store.isIsoDate(debut) || !store.isIsoDate(fin)) return res.status(400).json({ error: 'Dates invalides.' });
  if (fin < debut) return res.status(400).json({ error: 'La date de fin est avant la date de début.' });
  if (store.addDays(debut, 366) < fin) return res.status(400).json({ error: 'Maximum un an par demande.' });
  if (!store.TYPES[b.type]) return res.status(400).json({ error: "Type d'absence invalide." });
  const demi = Boolean(b.demi) && debut === fin;

  const chevauche = state.absences.find((a) => a.employeId === employeId
    && (a.statut === 'demande' || a.statut === 'approuve') && a.debut <= fin && a.fin >= debut);
  if (chevauche) {
    return res.status(400).json({ error: `Chevauche une absence déjà inscrite (${fmt(chevauche.debut)} au ${fmt(chevauche.fin)}).` });
  }

  const abs = {
    id: store.newId('a_'), employeId, debut, fin, demi, type: b.type,
    note: clean(b.note, 300),
    statut: 'demande', creeLe: new Date().toISOString(), creePar: me.id,
    decideLe: null, decidePar: null, commentaire: '',
  };
  // L'admin qui entre une absence pour quelqu'un (ou pour lui-même) peut
  // l'approuver d'office - pratique pour transférer l'ancien Excel.
  if (isAdmin && b.approuver) {
    abs.statut = 'approuve';
    abs.decideLe = abs.creeLe;
    abs.decidePar = me.id;
  }
  if (store.joursOuvrables(abs, state.feries) === 0) {
    return res.status(400).json({ error: 'Aucun jour ouvrable dans cette période (fin de semaine ou férié).' });
  }
  state.absences.push(abs);
  store.save(state);

  if (abs.statut === 'demande') {
    const j = store.joursOuvrables(abs, state.feries);
    const quand = debut === fin ? fmt(debut) : `${fmt(debut)} au ${fmt(fin)}`;
    notifyAdmin(req, `${emp.nom} demande: ${store.TYPES[abs.type].label}, ${quand} (${j} jour${j > 1 ? 's' : ''}).`);
  }
  res.json({ ok: true, absence: absView(abs, state, me) });
}));

// Annuler: l'employé peut annuler sa demande tant qu'elle n'est pas
// approuvée; une absence approuvée ne s'annule que par l'admin (la paye
// a peut-être déjà été ajustée).
router.post('/absences/:id/annuler', need(null, (req, res, state, me) => {
  const a = state.absences.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Introuvable.' });
  const isAdmin = me.role === 'admin';
  if (!isAdmin && a.employeId !== me.id) return res.status(403).json({ error: 'Accès refusé.' });
  if (!isAdmin && a.statut !== 'demande') {
    return res.status(400).json({ error: 'Déjà approuvée: demande à Jérôme de l’annuler.' });
  }
  if (a.statut !== 'demande' && a.statut !== 'approuve') return res.status(400).json({ error: 'Déjà fermée.' });
  a.statut = 'annule';
  a.decideLe = new Date().toISOString();
  a.decidePar = me.id;
  store.save(state);
  res.json({ ok: true });
}));

router.post('/absences/:id/decision', need(['admin'], (req, res, state, me) => {
  const a = state.absences.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Introuvable.' });
  if (a.statut !== 'demande') return res.status(400).json({ error: 'Cette demande a déjà été traitée.' });
  const d = req.body?.decision;
  if (d !== 'approuve' && d !== 'refuse') return res.status(400).json({ error: 'Décision invalide.' });
  a.statut = d;
  a.decideLe = new Date().toISOString();
  a.decidePar = me.id;
  a.commentaire = clean(req.body?.commentaire, 300);
  store.save(state);
  res.json({ ok: true });
}));

// ---------- Paye ----------

function payeRows(state, from, to) {
  const byId = Object.fromEntries(state.employes.map((e) => [e.id, e]));
  return state.absences
    .filter((a) => a.statut === 'approuve' && a.debut <= to && a.fin >= from)
    .map((a) => ({
      id: a.id,
      employeId: a.employeId,
      employe: byId[a.employeId]?.nom || '?',
      type: a.type,
      typeLabel: store.TYPES[a.type]?.label || a.type,
      paye: store.TYPES[a.type]?.paye ?? true,
      debut: a.debut,
      fin: a.fin,
      demi: a.demi,
      joursPeriode: store.joursOuvrables(a, state.feries, from, to),
      joursTotal: store.joursOuvrables(a, state.feries),
      note: a.note,
    }))
    .filter((r) => r.joursPeriode > 0)
    .sort((x, y) => x.employe.localeCompare(y.employe, 'fr') || x.debut.localeCompare(y.debut));
}

function periode(req) {
  const from = req.query.from, to = req.query.to;
  if (!store.isIsoDate(from) || !store.isIsoDate(to) || to < from) return null;
  return { from, to };
}

router.get('/paye', need(['admin', 'paye'], (req, res, state) => {
  const p = periode(req);
  if (!p) return res.status(400).json({ error: 'Période invalide.' });
  const rows = payeRows(state, p.from, p.to);
  const feries = state.feries.filter((f) => f.date >= p.from && f.date <= p.to && !store.isWeekend(f.date));
  res.json({ ...p, rows, feries });
}));

router.get('/paye.xlsx', need(['admin', 'paye'], (req, res, state) => {
  const p = periode(req);
  if (!p) return res.status(400).send('Période invalide.');
  const rows = payeRows(state, p.from, p.to);

  const detail = rows.map((r) => ({
    'Employé': r.employe,
    'Type': r.typeLabel,
    'Payé': r.paye ? 'Oui' : 'Non',
    'Début': r.debut,
    'Fin': r.fin,
    'Jours dans la période': r.joursPeriode,
    'Jours (absence complète)': r.joursTotal,
    'Note': r.note || '',
  }));

  const totals = {};
  for (const r of rows) {
    totals[r.employe] = totals[r.employe] || { 'Employé': r.employe };
    for (const t of Object.values(store.TYPES)) totals[r.employe][t.label] = totals[r.employe][t.label] || 0;
    totals[r.employe][r.typeLabel] += r.joursPeriode;
  }

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(Object.values(totals).length ? Object.values(totals) : [{ 'Employé': 'Aucune absence approuvée' }]);
  ws1['!cols'] = [{ wch: 16 }, ...Object.values(store.TYPES).map(() => ({ wch: 24 }))];
  XLSX.utils.book_append_sheet(wb, ws1, 'Sommaire');
  const ws2 = XLSX.utils.json_to_sheet(detail.length ? detail : [{ 'Employé': 'Aucune absence approuvée' }]);
  ws2['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 7 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 22 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Détail');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="absences-paye_${p.from}_au_${p.to}.xlsx"`);
  res.send(buf);
}));

// ---------- Gestion (admin) ----------

router.post('/admin/employes', need(['admin'], (req, res, state) => {
  const nom = clean(req.body?.nom, 40);
  if (!nom) return res.status(400).json({ error: 'Nom requis.' });
  if (state.employes.some((e) => e.nom.toLowerCase() === nom.toLowerCase())) {
    return res.status(400).json({ error: 'Ce nom existe déjà.' });
  }
  const role = store.ROLES.includes(req.body?.role) ? req.body.role : 'employe';
  state.employes.push({ id: store.newId('e_'), nom, role, actif: true, pin: null, pinVer: 0 });
  store.save(state);
  res.json({ ok: true });
}));

router.put('/admin/employes/:id', need(['admin'], (req, res, state, me) => {
  const emp = state.employes.find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: 'Introuvable.' });
  const b = req.body || {};
  if (b.nom !== undefined) {
    const nom = clean(b.nom, 40);
    if (!nom) return res.status(400).json({ error: 'Nom requis.' });
    emp.nom = nom;
  }
  if (b.role !== undefined) {
    if (!store.ROLES.includes(b.role)) return res.status(400).json({ error: 'Rôle invalide.' });
    if (emp.id === me.id && b.role !== 'admin') return res.status(400).json({ error: 'Tu ne peux pas retirer ton propre rôle admin.' });
    emp.role = b.role;
  }
  if (b.actif !== undefined) {
    if (emp.id === me.id && !b.actif) return res.status(400).json({ error: 'Tu ne peux pas te désactiver toi-même.' });
    emp.actif = Boolean(b.actif);
  }
  store.save(state);
  res.json({ ok: true });
}));

// Réinitialiser le NIP (oublié, ou choisi par quelqu'un d'autre): efface
// le NIP et coupe les sessions; la personne en choisit un nouveau à sa
// prochaine connexion.
router.post('/admin/employes/:id/reset', need(['admin'], (req, res, state, me) => {
  const emp = state.employes.find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: 'Introuvable.' });
  if (emp.id === me.id) return res.status(400).json({ error: 'Change ton propre NIP avec « Mon NIP ».' });
  emp.pin = null;
  emp.pinVer = (emp.pinVer || 0) + 1;
  failures.delete(emp.id);
  store.save(state);
  res.json({ ok: true });
}));

router.post('/admin/feries', need(['admin'], (req, res, state) => {
  const date = req.body?.date;
  const nom = clean(req.body?.nom, 60);
  if (!store.isIsoDate(date)) return res.status(400).json({ error: 'Date invalide.' });
  if (!nom) return res.status(400).json({ error: 'Nom requis.' });
  if (state.feries.some((f) => f.date === date)) return res.status(400).json({ error: 'Il y a déjà un férié à cette date.' });
  state.feries.push({ date, nom });
  store.save(state);
  res.json({ ok: true });
}));

// Ajoute d'un coup les 8 fériés légaux du Québec pour une année.
router.post('/admin/feries/annee', need(['admin'], (req, res, state) => {
  const y = Number(req.body?.annee);
  if (!Number.isInteger(y) || y < 2020 || y > 2100) return res.status(400).json({ error: 'Année invalide.' });
  let ajoutes = 0;
  for (const f of store.feriesQuebec(y)) {
    if (!state.feries.some((x) => x.date === f.date)) { state.feries.push(f); ajoutes += 1; }
  }
  store.save(state);
  res.json({ ok: true, ajoutes });
}));

router.delete('/admin/feries/:date', need(['admin'], (req, res, state) => {
  const before = state.feries.length;
  state.feries = state.feries.filter((f) => f.date !== req.params.date);
  if (state.feries.length === before) return res.status(404).json({ error: 'Introuvable.' });
  store.save(state);
  res.json({ ok: true });
}));

module.exports = router;
