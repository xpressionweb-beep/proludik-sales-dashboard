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

// Repartit un montant total en `count` segments dont la somme est
// EXACTEMENT egale au total (methode "stick breaking": on tire des points
// de coupure aleatoires puis on prend les ecarts entre eux). Sert a
// simuler des ventes individuelles realistes qui s'additionnent
// precisement au chiffre voulu, sans arrondi qui derive.
function splitAmount(total, count, rng) {
  if (count <= 1) return [Math.round(total)];
  const cuts = Array.from({ length: count - 1 }, () => rng() * total).sort((a, b) => a - b);
  const points = [0, ...cuts, total];
  const amounts = points.slice(1).map((p, i) => Math.round(p - points[i]));
  // Corrige l'arrondi sur le dernier segment pour garantir une somme exacte.
  const sum = amounts.reduce((s, a) => s + a, 0);
  amounts[amounts.length - 1] += Math.round(total) - sum;
  return amounts;
}

function fiscalYearStart(referenceDate, fiscalYearStartMonth) {
  const ref = new Date(referenceDate);
  const y = ref.getMonth() >= fiscalYearStartMonth ? ref.getFullYear() : ref.getFullYear() - 1;
  return new Date(y, fiscalYearStartMonth, 1);
}

// Chiffres precis demandes pour une presentation (annee financiere en
// cours), plutot que des montants aleatoires. Noms alignes exactement sur
// REP_LABELS (inflatableOffice.js) / config/objectifs.json - NE PAS
// changer l'orthographe (ex: "Jerome Goulet" sans accent) sous peine de
// casser le calcul des % vs objectifs en mode demo.
const PRESENTATION_TARGETS = {
  'Cedric Paré': { Confirmé: 680000, Soumission: 350000, 'Contrat/VFR': 150450 },
  'Mathis Beaupré': { Confirmé: 300000, Soumission: 175600, 'Contrat/VFR': 50000 },
  'Didier Paradis': { Confirmé: 320000, Soumission: 180200, 'Contrat/VFR': 53000 },
  'Jerome Goulet': { Confirmé: 110000, Soumission: 60054, 'Contrat/VFR': 23000 },
};

// Genere des ventes IO dont la somme par (representant, statut) tombe
// EXACTEMENT sur les chiffres de PRESENTATION_TARGETS pour l'annee
// financiere en cours (reparties sur plusieurs "ventes" realistes entre
// le debut de l'annee financiere et aujourd'hui). Usage: presentation/demo
// uniquement - voir README section "Mode démo InflatableOffice".
function generateIoPresentationSales({ referenceDate = new Date(), fiscalYearStartMonth = 9, seed = 99 } = {}) {
  const rng = makeRng(seed);
  const fyStart = fiscalYearStart(referenceDate, fiscalYearStartMonth);
  const now = new Date(referenceDate);
  const spanMs = Math.max(1, now.getTime() - fyStart.getTime());

  const records = [];
  let counter = 0;

  for (const [rep, statuses] of Object.entries(PRESENTATION_TARGETS)) {
    for (const [status, total] of Object.entries(statuses)) {
      const count = Math.max(4, Math.min(35, Math.round(total / 12000)));
      for (const amount of splitAmount(total, count, rng)) {
        counter += 1;
        const date = new Date(fyStart.getTime() + rng() * spanMs);
        records.push({
          externalId: `mock-io-presentation-${counter}`,
          status,
          rep,
          amount,
          currency: 'CAD',
          orderDate: date.toISOString(),
        });
      }
    }
  }

  return records;
}

module.exports = {
  generateMockSales,
  generateIoPresentationSales,
  fiscalYearStart,
  PRESENTATION_TARGETS,
  SAMPLE_REPS,
};
