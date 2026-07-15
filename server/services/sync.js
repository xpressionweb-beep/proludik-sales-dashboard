const db = require('../db');
const config = require('../config');
const shopify = require('../connectors/shopify');
const inflatableOffice = require('../connectors/inflatableOffice');
const excelStats = require('../connectors/excelStats');

// Le fichier Excel de la collègue (onglet "IO + Shopify") contient déjà
// les deux sources fusionnées - on remplace donc les DEUX connecteurs API
// (bloqué côté IO, scope limité côté Shopify) par ce seul connecteur, qui
// alimente les sources 'io' et 'shopify' séparément pour ne rien changer
// au reste du pipeline (aggregate.js, dashboard). Les connecteurs API
// restent dans le repo (io.js/shopify.js) au cas où on voudrait revenir
// en arrière une fois l'accès API débloqué - il suffirait de restaurer
// CONNECTORS ci-dessous.
const USE_EXCEL_IMPORT = true;

const CONNECTORS = USE_EXCEL_IMPORT
  ? config.excel.configured
    ? [
        {
          source: excelStats.IO_SOURCE,
          fetchSales: excelStats.fetchIoSales,
          initialSyncDays: config.excel.initialSyncDays,
          isMock: () => false,
        },
        {
          source: excelStats.SHOPIFY_SOURCE,
          fetchSales: excelStats.fetchShopifySales,
          initialSyncDays: config.excel.initialSyncDays,
          isMock: () => false,
        },
      ]
    : [] // EXCEL_SHARE_URL pas encore configuré: pas de sync auto tant que
    // le mode manuel (upload, voir /api/admin/import-excel) est utilisé -
    // évite des erreurs de cron répétées inutiles.
  : [
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

// `forceFullResync`: ignore lastSuccessAt et repart de initialSyncDays,
// peu importe l'etat courant de la meta - utilise par
// POST /api/admin/reset-sync. Contrairement a un simple "effacer
// lastSuccessAt puis resynchroniser", ce flag ne depend d'aucune lecture
// de meta au moment ou la sync demarre reellement: si une AUTRE sync
// (cron, bouton "Synchroniser maintenant", etc.) etait deja en cours au
// moment du reset et finit APRES lui en ecrasant la meta avec une valeur
// perimee, la sync forcee (mise en file d'attente derriere) recalcule
// quand meme son sinceIso a partir de initialSyncDays et non de cette
// meta - le reset ne peut donc pas etre "efface" par une course entre
// deux syncs concurrentes.
//
// `forceReplace`: remplace entierement les enregistrements de la source
// (voir db.replaceSourceSales) plutot que d'upserter, meme en mode reel.
async function syncSource({ source, fetchSales, initialSyncDays, isMock, forceFullResync = false, forceReplace = false }) {
  const metaBefore = db.getMeta();
  const previousLastKnownMock = metaBefore.sources && metaBefore.sources[source] && metaBefore.sources[source].lastKnownMock;
  const currentlyMock = Boolean(isMock && isMock());
  // Vrai uniquement si on CONNAISSAIT deja le mode precedent (pas au tout
  // premier sync apres l'ajout de ce champ) et qu'il a change depuis.
  const modeChanged = previousLastKnownMock !== undefined && previousLastKnownMock !== currentlyMock;

  // En quittant le mode mock, un simple sync incremental ne recupererait
  // que les commandes recentes - insuffisant pour remplacer proprement
  // (on perdrait l'historique reel jamais encore resynchronise depuis que
  // la source etait en mock). On force donc une fenetre complete dans ce
  // cas precis, en plus de quand c'est explicitement demande.
  const effectiveForceFullResync = forceFullResync || (modeChanged && !currentlyMock);
  const sinceIso = effectiveForceFullResync
    ? new Date(Date.now() - initialSyncDays * 24 * 60 * 60 * 1000).toISOString()
    : sinceIsoFor(source, initialSyncDays);

  const startedAt = new Date().toISOString();
  try {
    const records = await withWatchdog(fetchSales({ sinceIso }), config.syncWatchdogMs, `sync ${source}`);
    // Remplace entierement (plutot qu'upsert incremental) si: la source
    // est actuellement en mode mock (le generateur renvoie toujours son
    // jeu complet - voir replaceSourceSales), OU si le mode vient de
    // changer depuis la derniere sync (mock<->reel: les enregistrements
    // de l'AUTRE mode ont des externalId distincts, un upsert seul ne les
    // retirerait jamais et ils resteraient melanges indefiniment), OU si
    // demande explicitement (reset manuel).
    if (modeChanged) {
      console.log(
        `[sync] ${source}: changement de mode detecte (${previousLastKnownMock ? 'demo' : 'reel'} -> ` +
        `${currentlyMock ? 'demo' : 'reel'}) - remplacement complet des donnees plutot qu'ajout, pour ne pas ` +
        `melanger les deux jeux de donnees.`
      );
    }
    const shouldReplace = forceReplace || currentlyMock || modeChanged;
    const result = shouldReplace ? db.replaceSourceSales(source, records) : db.upsertSales(records);
    const { oldest, newest } = dateRange(records);

    if (!currentlyMock && oldest && new Date(oldest).getTime() - new Date(sinceIso).getTime() > HISTORY_GAP_WARNING_MS) {
      const gapDays = Math.round((new Date(oldest).getTime() - new Date(sinceIso).getTime()) / (24 * 60 * 60 * 1000));
      console.warn(
        `[sync] ${source}: donnees demandees depuis ${sinceIso}, mais le plus ancien enregistrement recu date de ` +
        `${oldest} (${gapDays} jours plus tard). Si cet ecart est inattendu, verifie les droits d'acces a ` +
        `l'historique cote fournisseur (ex: scope Shopify "read_all_orders" - sans lui, l'API ne renvoie que les ` +
        `commandes des ~60 derniers jours, meme si created_at_min demande plus loin dans le passe).`
      );
    }

    db.setSourceMeta(source, {
      lastSuccessAt: startedAt,
      lastError: null,
      lastRecordCount: records.length,
      requestedSinceIso: sinceIso,
      oldestRecordDate: oldest,
      newestRecordDate: newest,
      lastKnownMock: currentlyMock,
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

// `opts.onlySources`: limite la sync a ces sources seulement (ex: reset
// cible d'une seule source, pour ne pas faire echouer/attendre sur
// l'autre source si elle est lente ou bloquee - voir /api/admin/reset-sync).
// `opts.forceFullResyncSources` / `opts.forceReplaceSources`: memes
// semantiques que sur syncSource, par source.
async function syncAll(opts = {}) {
  const { onlySources, forceFullResyncSources, forceReplaceSources } = opts;
  const connectors = onlySources ? CONNECTORS.filter((c) => onlySources.includes(c.source)) : CONNECTORS;
  const results = [];
  for (const connector of connectors) {
    // Sequentiel: petit volume attendu, evite de bombarder deux API en parallele.
    results.push(
      await syncSource({
        ...connector,
        forceFullResync: Boolean(forceFullResyncSources && forceFullResyncSources.includes(connector.source)),
        forceReplace: Boolean(forceReplaceSources && forceReplaceSources.includes(connector.source)),
      })
    );
  }
  return results;
}

module.exports = { syncAll };
