const express = require('express');
const router = express.Router();
const store = require('../boost/store');

// API de la boîte à missions "Le Boost" (page public/boost.html).
// Le tirage au sort se fait ici, côté serveur: le contenu des missions
// encore dans la boîte n'est jamais révélé avant d'être pigé.

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

function publicState(state) {
  const ref = store.today();
  return {
    today: ref,
    reposJours: store.REPOS_JOURS,
    config: state.config,
    semaines: [...state.semaines].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 30),
    defis: [...state.defis].sort((a, b) => a.num - b.num).map((d) => ({ ...d, statut: store.statusOf(state, d.id, ref) })),
  };
}

function mutate(res, fn) {
  try {
    const state = store.load();
    const err = fn(state);
    if (err) return res.status(400).json({ error: err });
    store.save(state);
    res.json(publicState(state));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

router.get('/state', (req, res) => {
  try { res.json(publicState(store.load())); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Piger une mission au hasard parmi celles disponibles
router.post('/draw', (req, res) => mutate(res, (state) => {
  const ref = store.today();
  const w = store.week(state, ref, true);
  if (w.tirages.length >= (state.config.parReunion || 3)) return 'Toutes les missions de la réunion sont déjà pigées.';
  const pool = state.defis.filter((d) => store.statusOf(state, d.id, ref).k === 'dispo');
  if (!pool.length) return 'La boîte est vide.';
  const pick = pool[Math.floor(Math.random() * pool.length)];
  w.tirages.push({ id: store.newId('t'), defiId: pick.id, rep: clean(req.body.rep, 40), resultat: null });
}));

// Remettre une pige du jour dans la boîte (erreur de pige)
router.post('/undo', (req, res) => mutate(res, (state) => {
  const w = store.week(state, store.today());
  if (!w) return 'Aucune pige aujourd\'hui.';
  w.tirages = w.tirages.filter((t) => t.id !== req.body.tirageId);
}));

// Réussie / pas réussie (recliquer le même bouton annule)
router.post('/verdict', (req, res) => mutate(res, (state) => {
  const { semaineId, tirageId, verdict } = req.body;
  if (!['reussi', 'rate'].includes(verdict)) return 'Verdict invalide.';
  const t = store.week(state, semaineId)?.tirages.find((x) => x.id === tirageId);
  if (!t) return 'Pige introuvable.';
  if (t.resultat === verdict) { t.resultat = null; delete t.le; } else { t.resultat = verdict; t.le = store.today(); }
}));

// Ajouter ou modifier une mission
router.post('/defis', (req, res) => mutate(res, (state) => {
  const l1 = clean(req.body.l1, 30).toUpperCase();
  const l2 = clean(req.body.l2, 30).toUpperCase();
  const desc = clean(req.body.desc, 280);
  const icone = clean(req.body.icone, 20) || 'fusee';
  if (!l1 || !desc) return 'Il faut au moins un titre et une description.';
  if (req.body.id) {
    const d = state.defis.find((x) => x.id === req.body.id);
    if (!d) return 'Mission introuvable.';
    Object.assign(d, { l1, l2, desc, icone });
  } else {
    const num = Math.max(0, ...state.defis.map((d) => d.num)) + 1;
    state.defis.push({ id: 'd' + String(num).padStart(2, '0'), num, l1, l2, desc, icone, actif: true });
  }
}));

router.post('/defis/:id/toggle', (req, res) => mutate(res, (state) => {
  const d = state.defis.find((x) => x.id === req.params.id);
  if (!d) return 'Mission introuvable.';
  d.actif = d.actif === false;
}));

// Équipe et nombre de piges par réunion
router.put('/config', (req, res) => mutate(res, (state) => {
  if (Array.isArray(req.body.reps)) {
    state.config.reps = req.body.reps
      .map((r) => clean(typeof r === 'string' ? r : r.nom, 40))
      .filter(Boolean);
  }
  if (req.body.emails && typeof req.body.emails === 'object') {
    const emails = {};
    for (const nom of state.config.reps) {
      const e = clean(req.body.emails[nom], 120).toLowerCase();
      if (e) emails[nom] = e;
    }
    state.config.emails = emails;
  }
  if (req.body.parReunion) state.config.parReunion = Math.max(1, Math.min(10, parseInt(req.body.parReunion, 10) || 3));
}));

// Remise à zéro: efface toutes les piges et tous les bilans.
// Les missions (et celles ajoutées) et l'équipe sont conservées.
router.post('/reset', (req, res) => mutate(res, (state) => {
  if (req.body.confirm !== 'ZERO') return 'Confirmation manquante.';
  state.semaines = [];
}));

module.exports = router;
