const express = require('express');
const config = require('../config');
const db = require('../db');
const aggregate = require('../services/aggregate');
const { runSync } = require('../scheduler');
const { getOutboundIp } = require('../diagnostics');
const runtimeSettings = require('../runtimeSettings');

const router = express.Router();

router.get('/overview', (req, res) => {
  res.json(aggregate.getOverview());
});

router.get('/reps', (req, res) => {
  const type = ['week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'month';
  const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
  res.json(aggregate.getRepBreakdown(type, offset));
});

router.get('/yoy', (req, res) => {
  res.json(aggregate.getYoY());
});

router.get('/objective', (req, res) => {
  res.json(aggregate.getGlobalObjective());
});

router.get('/trend', (req, res) => {
  const type = ['week', 'month', 'year'].includes(req.query.card) ? req.query.card : 'week';
  res.json(aggregate.getTrend(type));
});

router.get('/activity', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 8;
  res.json(aggregate.getRecentActivity(limit));
});

router.get('/meta', (req, res) => {
  const meta = db.getMeta();
  res.json({
    sources: meta.sources || {},
    mock: {
      shopify: !config.shopify.configured,
      io: !config.io.configured,
    },
    syncCron: config.syncCron,
  });
});

// Permet de forcer une synchronisation manuelle depuis le dashboard.
router.post('/sync', async (req, res) => {
  await runSync('manual');
  res.json({ ok: true, meta: db.getMeta() });
});

// Diagnostic: IP sortante du serveur, a fournir a un fournisseur (ex.
// rental.software) en cas de blocage par IP. Loggee aussi au demarrage.
router.get('/diagnostics/ip', async (req, res) => {
  try {
    const ip = await getOutboundIp();
    res.json({ ip });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Bouton "Réel/Démo" du dashboard: bascule la source de donnees IO au
// runtime, sans changer de variable d'environnement ni redeployer. L'etat
// effectif (mode) reflete deja tout override actif ou, a defaut,
// IO_FORCE_DEMO - voir config.js (io.configured).
router.get('/settings/io-mode', (req, res) => {
  res.json({ mode: config.io.configured ? 'real' : 'demo' });
});

router.post('/settings/io-mode', async (req, res) => {
  const { mode } = req.body || {};
  if (mode !== 'demo' && mode !== 'real') {
    return res.status(400).json({ error: 'mode doit etre "demo" ou "real".' });
  }

  runtimeSettings.setIoModeOverride(mode);
  // Resynchronise tout de suite pour que le changement soit visible sans
  // attendre le prochain cycle cron.
  await runSync('io-mode-change');

  res.json({ mode: config.io.configured ? 'real' : 'demo', meta: db.getMeta() });
});

module.exports = router;
