const express = require('express');
const config = require('../config');
const db = require('../db');
const aggregate = require('../services/aggregate');
const { runSync } = require('../scheduler');
const { getOutboundIp } = require('../diagnostics');
const runtimeSettings = require('../runtimeSettings');
const facebookConnector = require('../connectors/facebook');
const instagramConnector = require('../connectors/instagram');
const shopifyConnector = require('../connectors/shopify');

const router = express.Router();

// Une sync peut rester en file d'attente jusqu'a config.syncWatchdogMs
// (par defaut 120s) si une sync precedente est bloquee - voir
// scheduler.js. On ne veut pas faire pendre la requete HTTP (et donc le
// navigateur) aussi longtemps: on attend un court instant, et si la sync
// n'est pas terminee, on repond immediatement avec `queued: true` en
// laissant la sync continuer/se terminer en arriere-plan (elle mettra a
// jour data/sales.json toute seule; voir scheduler.js pour la garantie
// qu'elle ne sera jamais ignoree, juste retardee).
const QUICK_SYNC_MS = 4000;

async function triggerSyncQuick(trigger, opts) {
  const syncPromise = runSync(trigger, opts);
  const outcome = await Promise.race([
    syncPromise.then(() => 'done').catch(() => 'done'),
    new Promise((resolve) => setTimeout(() => resolve('queued'), QUICK_SYNC_MS)),
  ]);

  if (outcome === 'queued') {
    syncPromise.catch((err) => console.error(`[api] sync differee (${trigger}) en erreur:`, err.message));
  }

  return { queued: outcome === 'queued' };
}

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

router.get('/status-counts-7d', (req, res) => {
  res.json(aggregate.getStatusCounts7d());
});

router.get('/rep-conversion-summary', (req, res) => {
  res.json(aggregate.getRepConversionSummary());
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
  const { queued } = await triggerSyncQuick('manual');
  res.json({ ok: true, meta: db.getMeta(), queued });
});

// Sources de donnees connues - doit rester en phase avec shopify.SOURCE /
// inflatableOffice.SOURCE (voir server/connectors/*.js).
const VALID_SYNC_SOURCES = ['shopify', 'io'];

// Force une resynchronisation complete d'une (ou des deux, "all") source(s)
// (ex: apres correction d'un probleme d'acces cote fournisseur - scope
// Shopify read_all_orders approuve apres coup - ou pour purger de vieux
// enregistrements de demo restes melanges a des donnees reelles apres un
// changement de mode). Deja protege par l'auth Basic globale (voir
// server/index.js) quand DASHBOARD_USER/PASSWORD sont configures.
//
// Cible explicitement la ou les sources demandees (`onlySources`): une
// resync Shopify ne declenche pas aussi IO (et inversement), pour eviter
// qu'un probleme sur l'AUTRE source (ex: timeout) ne pollue la reponse
// d'un reset qui ne la concernait pas.
//
// Remplace entierement (`forceReplaceSources`) les enregistrements de la
// source, sur une fenetre complete (`forceFullResyncSources`, ignore
// lastSuccessAt) - voir services/sync.js:syncSource pour le detail. Ce
// n'est PAS un simple "effacer lastSuccessAt puis resynchroniser": ces
// deux flags sont portes par l'appel de sync lui-meme, donc le resultat
// est correct meme si une autre sync (cron, bouton "Synchroniser
// maintenant") est deja en cours au moment de l'appel et se termine apres
// (cf. commentaire dans syncSource).
router.post('/admin/reset-sync', async (req, res) => {
  const raw = req.query.source || (req.body && req.body.source);
  const sources = raw === 'all' ? VALID_SYNC_SOURCES : VALID_SYNC_SOURCES.includes(raw) ? [raw] : null;
  if (!sources) {
    return res.status(400).json({ error: `source doit etre l'un de: ${VALID_SYNC_SOURCES.join(', ')}, all.` });
  }

  // Purement cosmetique/immediat (voir syncSource: le comportement correct
  // ne depend plus de cet effacement, seulement des flags force* ci-dessous) -
  // evite d'afficher une etendue de donnees perimee si /api/meta est
  // consulte pendant que la resync est encore en cours.
  for (const s of sources) db.resetSourceMeta(s);
  console.log(`[api] Reset de sync demande pour [${sources.join(', ')}] - resynchronisation complete forcee.`);
  const { queued } = await triggerSyncQuick(`reset-sync:${sources.join(',')}`, {
    onlySources: sources,
    forceFullResyncSources: sources,
    forceReplaceSources: sources,
  });

  res.json({ ok: true, sources, meta: db.getMeta(), queued });
});

// Diagnostic: force l'obtention d'un nouveau token OAuth Shopify (ignore le
// cache en memoire) pour verifier immediatement, via les logs serveur et la
// reponse ci-dessous, le scope reellement accorde par Shopify (ex: confirmer
// si read_all_orders est bien pris en compte apres une modif du Dev
// Dashboard, sans attendre l'expiration naturelle du cache ~24h).
// Accepte GET et POST temporairement pour permettre un test rapide en
// collant simplement l'URL dans un navigateur (sans Postman/curl).
router.all('/diagnostics/shopify-token-refresh', async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Methode non supportee (GET ou POST uniquement).' });
  }
  if (config.shopify.accessToken) {
    return res.status(400).json({ error: 'App configuree avec un token statique (pas de flux OAuth a rafraichir).' });
  }
  if (!config.shopify.clientId || !config.shopify.clientSecret) {
    return res.status(400).json({ error: 'SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET non configures.' });
  }

  try {
    await shopifyConnector.getAccessToken({ forceRefresh: true });
    res.json({ ok: true, scope: shopifyConnector.getCachedScope() });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
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
  // attendre le prochain cycle cron. Si une sync precedente est deja en
  // cours (ex: bloquee sur un timeout IO), celle-ci est mise en file
  // d'attente (jamais ignoree - voir scheduler.js) et se declenchera
  // automatiquement a la suite; on ne fait pas pendre la reponse HTTP
  // au-dela de QUICK_SYNC_MS dans ce cas (voir `queued` dans la reponse).
  const { queued } = await triggerSyncQuick('io-mode-change');

  res.json({ mode: config.io.configured ? 'real' : 'demo', meta: db.getMeta(), queued });
});

// Cartes "Réseaux sociaux" du dashboard: donnees de demo tant que les
// vraies cles Facebook/Instagram ne sont pas configurees (voir
// server/connectors/facebook.js et instagram.js). Chaque plateforme est
// recuperee independamment (Promise.allSettled) pour qu'une erreur sur
// l'une n'empeche pas l'affichage de l'autre.
router.get('/social', async (req, res) => {
  const [facebook, instagram] = await Promise.allSettled([facebookConnector.fetchStats(), instagramConnector.fetchStats()]);

  function toResult(settled, mock) {
    if (settled.status === 'fulfilled') {
      return { ...settled.value, mock, error: null };
    }
    return { mock, error: settled.reason.message };
  }

  res.json({
    facebook: toResult(facebook, !config.social.facebook.configured),
    instagram: toResult(instagram, !config.social.instagram.configured),
  });
});

module.exports = router;
