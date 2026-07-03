const express = require('express');
const config = require('../config');
const db = require('../db');
const aggregate = require('../services/aggregate');
const { runSync } = require('../scheduler');

const router = express.Router();

router.get('/overview', (req, res) => {
  res.json(aggregate.getOverview());
});

router.get('/reps', (req, res) => {
  const type = ['week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'month';
  const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
  res.json(aggregate.getRepBreakdown(type, offset));
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

module.exports = router;
