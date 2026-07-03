const cron = require('node-cron');
const config = require('./config');
const { syncAll } = require('./services/sync');

let running = false;

async function runSync(trigger) {
  if (running) {
    console.log(`[sync] deja en cours, saut du declenchement (${trigger})`);
    return;
  }
  running = true;
  console.log(`[sync] demarrage (${trigger})`);
  try {
    const results = await syncAll();
    for (const r of results) {
      if (r.ok) {
        console.log(`[sync] ${r.source}: ok (${r.inserted} nouveaux, ${r.updated} mis a jour)`);
      } else {
        console.error(`[sync] ${r.source}: echec - ${r.error}`);
      }
    }
  } finally {
    running = false;
  }
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
