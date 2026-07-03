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

module.exports = router;
