const cron = require('node-cron');
const config = require('./config');
const { syncAll } = require('./services/sync');

// File d'attente (chainage de promesses): chaque appel a runSync() est
// serialise, jamais ignore silencieusement. Si une sync est deja en cours
// (ex: bloquee a attendre le timeout IO), le nouvel appel est mis en
// attente et se declenche automatiquement des que la precedente se
// termine - au lieu de disparaitre avec "deja en cours" comme avant.
// `busy` ne sert qu'a l'affichage; la serialisation reelle vient du
// chainage de `queue`.
let busy = false;
let queue = Promise.resolve();

async function doSync(trigger, opts) {
  busy = true;
  console.log(`[sync] demarrage (${trigger})`);
  try {
    const results = await syncAll(opts);
    for (const r of results) {
      if (r.ok) {
        console.log(`[sync] ${r.source}: ok (${r.inserted} nouveaux, ${r.updated} mis a jour)`);
      } else {
        console.error(`[sync] ${r.source}: echec - ${r.error}`);
      }
    }
    return results;
  } finally {
    busy = false;
  }
}

// `opts` (optionnel): transmis tel quel a syncAll() - voir services/sync.js
// (onlySources / forceFullResyncSources / forceReplaceSources), utilise par
// POST /api/admin/reset-sync pour cibler et forcer une resync complete
// d'une seule source sans toucher a l'autre.
function runSync(trigger, opts) {
  if (busy) {
    console.log(`[sync] "${trigger}" mis en file d'attente (une sync est deja en cours) - se declenchera automatiquement a la suite.`);
  }

  const scheduled = queue.then(
    () => doSync(trigger, opts),
    () => doSync(trigger, opts) // la sync precedente a echoue: on demarre quand meme celle-ci
  );
  // Ne jamais laisser une rejection casser le chainage pour les appels suivants;
  // l'appelant de runSync() recoit lui, sans transformation, `scheduled` (qui peut
  // toujours rejeter/etre inspecte normalement).
  queue = scheduled.catch(() => {});

  return scheduled;
}

function start() {
  // Premiere synchronisation immediate au demarrage du serveur.
  runSync('startup').catch((err) => console.error('[sync] erreur inattendue', err));

  cron.schedule(config.syncCron, () => {
    runSync('cron').catch((err) => console.error('[sync] erreur inattendue', err));
  });

  console.log(`[sync] planifie avec le cron "${config.syncCron}"`);
}

module.exports = { start, runSync };
