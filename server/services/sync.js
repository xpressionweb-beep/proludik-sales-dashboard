const db = require('../db');
const config = require('../config');
const shopify = require('../connectors/shopify');
const inflatableOffice = require('../connectors/inflatableOffice');

const CONNECTORS = [
  { source: shopify.SOURCE, fetchSales: shopify.fetchSales, initialSyncDays: config.shopify.initialSyncDays },
  { source: inflatableOffice.SOURCE, fetchSales: inflatableOffice.fetchSales, initialSyncDays: config.io.initialSyncDays },
];

function sinceIsoFor(source, initialSyncDays) {
  const meta = db.getMeta();
  const last = meta.sources && meta.sources[source] && meta.sources[source].lastSuccessAt;
  if (last) return last;
  const days = initialSyncDays;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Garde-fou de dernier recours: chaque requete HTTP individuelle a deja un
// timeout (voir config.httpTimeoutMs dans les connecteurs), mais on
// s'assure ici que meme un blocage imprevu (pagination qui boucle sans
// jamais lever d'erreur, etc.) ne bloque pas indefiniment le flag
// "running" du scheduler - ce qui ferait sauter tous les cycles cron
// suivants ("deja en cours"). La requete sous-jacente peut continuer en
// arriere-plan si elle finit par se resoudre plus tard, mais la sync elle
// n'attend plus au-dela de ce delai.
function withWatchdog(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout: ${label} n'a pas repondu apres ${ms}ms.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function syncSource({ source, fetchSales, initialSyncDays }) {
  const sinceIso = sinceIsoFor(source, initialSyncDays);
  const startedAt = new Date().toISOString();
  try {
    const records = await withWatchdog(fetchSales({ sinceIso }), config.syncWatchdogMs, `sync ${source}`);
    const result = db.upsertSales(records);
    db.setSourceMeta(source, {
      lastSuccessAt: startedAt,
      lastError: null,
      lastRecordCount: records.length,
      ...result,
    });
    return { source, ok: true, ...result };
  } catch (err) {
    db.setSourceMeta(source, {
      lastAttemptAt: startedAt,
      lastError: err.message,
    });
    return { source, ok: false, error: err.message };
  }
}

async function syncAll() {
  const results = [];
  for (const connector of CONNECTORS) {
    // Sequentiel: petit volume attendu, evite de bombarder deux API en parallele.
    results.push(await syncSource(connector));
  }
  return results;
}

module.exports = { syncAll };
