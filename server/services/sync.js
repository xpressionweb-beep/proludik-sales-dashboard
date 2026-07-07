const db = require('../db');
const config = require('../config');
const shopify = require('../connectors/shopify');
const inflatableOffice = require('../connectors/inflatableOffice');

const CONNECTORS = [
  {
    source: shopify.SOURCE,
    fetchSales: shopify.fetchSales,
    initialSyncDays: config.shopify.initialSyncDays,
    isMock: () => !config.shopify.configured,
  },
  {
    source: inflatableOffice.SOURCE,
    fetchSales: inflatableOffice.fetchSales,
    initialSyncDays: config.io.initialSyncDays,
    isMock: () => !config.io.configured,
  },
];

function sinceIsoFor(source, initialSyncDays) {
  const meta = db.getMeta();
  const last = meta.sources && meta.sources[source] && meta.sources[source].lastSuccessAt;
  if (last) return last;
  const days = initialSyncDays;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Renvoie la date la plus ancienne/recente (orderDate) parmi les
// enregistrements recuperes lors d'une sync. Sert de diagnostic: si on
// demande `sinceIso` tres dans le passe mais que la date la plus ancienne
// recue est beaucoup plus recente, c'est le signe d'une limite d'acces
// cote fournisseur (ex: Shopify ne donne acces qu'aux commandes des 60
// derniers jours aux apps sans le scope `read_all_orders` approuve) plutot
// que d'un bug de pagination cote serveur.
function dateRange(records) {
  if (!records.length) return { oldest: null, newest: null };
  let oldest = records[0].orderDate;
  let newest = records[0].orderDate;
  for (const r of records) {
    if (r.orderDate < oldest) oldest = r.orderDate;
    if (r.orderDate > newest) newest = r.orderDate;
  }
  return { oldest, newest };
}

const HISTORY_GAP_WARNING_MS = 5 * 24 * 60 * 60 * 1000; // 5 jours

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

async function syncSource({ source, fetchSales, initialSyncDays, isMock }) {
  const sinceIso = sinceIsoFor(source, initialSyncDays);
  const startedAt = new Date().toISOString();
  try {
    const records = await withWatchdog(fetchSales({ sinceIso }), config.syncWatchdogMs, `sync ${source}`);
    // En mode mock, le generateur renvoie a chaque fois son jeu de donnees
    // complet: on remplace plutot que d'upserter, pour ne jamais laisser
    // trainer d'anciens enregistrements (real ou mock) qui fausseraient les
    // agregats (voir server/db.js:replaceSourceSales).
    const result = isMock && isMock() ? db.replaceSourceSales(source, records) : db.upsertSales(records);
    const { oldest, newest } = dateRange(records);

    if (!isMock || !isMock()) {
      if (oldest && new Date(oldest).getTime() - new Date(sinceIso).getTime() > HISTORY_GAP_WARNING_MS) {
        const gapDays = Math.round((new Date(oldest).getTime() - new Date(sinceIso).getTime()) / (24 * 60 * 60 * 1000));
        console.warn(
          `[sync] ${source}: donnees demandees depuis ${sinceIso}, mais le plus ancien enregistrement recu date de ` +
          `${oldest} (${gapDays} jours plus tard). Si cet ecart est inattendu, verifie les droits d'acces a ` +
          `l'historique cote fournisseur (ex: scope Shopify "read_all_orders" - sans lui, l'API ne renvoie que les ` +
          `commandes des ~60 derniers jours, meme si created_at_min demande plus loin dans le passe).`
        );
      }
    }

    db.setSourceMeta(source, {
      lastSuccessAt: startedAt,
      lastError: null,
      lastRecordCount: records.length,
      requestedSinceIso: sinceIso,
      oldestRecordDate: oldest,
      newestRecordDate: newest,
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
