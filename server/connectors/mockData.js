// Generateur de donnees d'exemple, utilise uniquement quand les identifiants
// d'un connecteur ne sont pas configures. Permet de demarrer le serveur et de
// voir le dashboard fonctionner avant d'avoir les vrais acces API.

// Alignes sur les vrais representants (REP_LABELS dans
// inflatableOffice.js) et config/objectifs.json, pour que le mode demo
// affiche des % vs objectifs coherents.
const SAMPLE_REPS = ['Mathis Beaupré', 'Cedric Paré', 'Jerome Goulet', 'Didier Paradis'];

// PRNG deterministe (mulberry32) pour des donnees stables entre redemarrages.
function makeRng(seed) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateMockSales({ seed, daysBack, perWeek, statuses, minAmount, maxAmount, reps = SAMPLE_REPS }) {
  const rng = makeRng(seed);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const totalWeeks = Math.ceil(daysBack / 7);
  const records = [];
  let counter = 0;

  for (let week = 0; week < totalWeeks; week += 1) {
    const countThisWeek = Math.max(1, Math.round(perWeek * (0.6 + rng() * 0.8)));
    for (let i = 0; i < countThisWeek; i += 1) {
      const offsetDays = week * 7 + Math.floor(rng() * 7);
      const date = new Date(now - offsetDays * dayMs);
      const status = statuses[Math.floor(rng() * statuses.length)];
      const rep = reps[Math.floor(rng() * reps.length)];
      const amount = Math.round(minAmount + rng() * (maxAmount - minAmount));
      counter += 1;
      records.push({
        externalId: `mock-${seed}-${counter}`,
        status,
        rep,
        amount,
        currency: 'CAD',
        orderDate: date.toISOString(),
      });
    }
  }

  return records;
}

module.exports = { generateMockSales, SAMPLE_REPS };
