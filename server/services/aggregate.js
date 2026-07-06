const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../db');

const OBJECTIFS_FILE = path.join(__dirname, '..', '..', 'config', 'objectifs.json');

function loadObjectifs() {
  try {
    return JSON.parse(fs.readFileSync(OBJECTIFS_FILE, 'utf8'));
  } catch {
    return { reps: {} };
  }
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Annee financiere: 1er octobre -> 30 septembre. Retourne "2025-2026".
function fiscalYearLabel(date) {
  const y = date.getMonth() >= config.fiscalYearStartMonth ? date.getFullYear() : date.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

function getBounds(type, offset, referenceDate = new Date()) {
  const ref = new Date(referenceDate);

  if (type === 'day') {
    const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + offset);
    const end = addDays(start, 1);
    return {
      start,
      end,
      label: start.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' }),
    };
  }

  if (type === 'rolling7') {
    // Fenetre glissante de 7 jours se terminant aujourd'hui inclus (PAS la
    // semaine calendaire ISO utilisee par le type "week" ci-dessous).
    // offset=-1 donne les 7 jours immediatement precedents (pour "vs 7
    // jours precedents"), pas les 7 jours de la semaine civile precedente.
    const todayStart = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    const end = addDays(todayStart, 1 + 7 * offset);
    const start = addDays(end, -7);
    return {
      start,
      end,
      label: `${start.toLocaleDateString('fr-CA')} → ${addDays(end, -1).toLocaleDateString('fr-CA')}`,
    };
  }

  if (type === 'week') {
    const day = ref.getDay(); // 0=dim..6=sam
    const diffToMonday = (day + 6) % 7;
    const monday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - diffToMonday);
    const start = addDays(monday, 7 * offset);
    const end = addDays(start, 7);
    return {
      start,
      end,
      label: `Semaine du ${start.toLocaleDateString('fr-CA')}`,
    };
  }

  if (type === 'month') {
    const start = new Date(ref.getFullYear(), ref.getMonth() + offset, 1);
    const end = new Date(ref.getFullYear(), ref.getMonth() + offset + 1, 1);
    return {
      start,
      end,
      label: start.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' }),
    };
  }

  if (type === 'year') {
    const fyStartYear =
      (ref.getMonth() >= config.fiscalYearStartMonth ? ref.getFullYear() : ref.getFullYear() - 1) + offset;
    const start = new Date(fyStartYear, config.fiscalYearStartMonth, 1);
    const end = new Date(fyStartYear + 1, config.fiscalYearStartMonth, 1);
    return {
      start,
      end,
      label: `${fyStartYear}-${fyStartYear + 1}`,
    };
  }

  throw new Error(`Type de periode inconnu: ${type}`);
}

function inRange(dateIso, start, end) {
  const t = new Date(dateIso).getTime();
  return t >= start.getTime() && t < end.getTime();
}

function computeTotals(sales, start, end) {
  const io = {};
  for (const status of config.io.statuses) io[status] = { amount: 0, count: 0 };
  io.Autre = { amount: 0, count: 0 };
  const shopify = { amount: 0, count: 0 };

  for (const sale of sales) {
    if (!inRange(sale.orderDate, start, end)) continue;
    if (sale.source === 'io') {
      const bucket = config.io.statuses.includes(sale.status) ? sale.status : 'Autre';
      io[bucket].amount += sale.amount;
      io[bucket].count += 1;
    } else if (sale.source === 'shopify') {
      shopify.amount += sale.amount;
      shopify.count += 1;
    }
  }

  const ioTotal = Object.values(io).reduce((s, b) => s + b.amount, 0);
  const grandTotal = ioTotal + shopify.amount;

  return { io, ioTotal, shopify, grandTotal };
}

function pctChange(current, previous) {
  if (!previous) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

// Comparaison "meme periode l'an dernier" (pas la periode precedente):
// semaine -> 52 semaines en arriere, mois -> meme mois l'an dernier,
// annee (fiscale) -> annee fiscale precedente (deja "l'an dernier" par
// definition). Utilise pour les 4 grandes cartes du dashboard.
const YOY_OFFSET = { week: -52, month: -12, year: -1 };

function getYoY(referenceDate = new Date()) {
  const sales = db.getAllSales();
  const result = {};

  for (const [type, offset] of Object.entries(YOY_OFFSET)) {
    const cur = getBounds(type, 0, referenceDate);
    const prevYear = getBounds(type, offset, referenceDate);
    const curTotals = computeTotals(sales, cur.start, cur.end);
    const prevYearTotals = computeTotals(sales, prevYear.start, prevYear.end);

    result[type] = {
      current: { label: cur.label, totals: curTotals },
      previousYear: { label: prevYear.label, totals: prevYearTotals },
      changePct: pctChange(curTotals.grandTotal, prevYearTotals.grandTotal),
    };
  }

  return result;
}

function getOverview(referenceDate = new Date()) {
  const sales = db.getAllSales();
  const types = ['day', 'week', 'month', 'year'];
  const overview = {};

  for (const type of types) {
    const cur = getBounds(type, 0, referenceDate);
    const prev = getBounds(type, -1, referenceDate);
    const curTotals = computeTotals(sales, cur.start, cur.end);
    const prevTotals = computeTotals(sales, prev.start, prev.end);

    overview[type] = {
      current: { label: cur.label, start: cur.start, end: cur.end, totals: curTotals },
      previous: { label: prev.label, start: prev.start, end: prev.end, totals: prevTotals },
      changePct: pctChange(curTotals.grandTotal, prevTotals.grandTotal),
    };
  }

  return overview;
}

function getRepBreakdown(type, offset = 0, referenceDate = new Date()) {
  const sales = db.getAllSales();
  const { start, end, label } = getBounds(type, offset, referenceDate);
  const objectifs = loadObjectifs();
  const fyLabel = fiscalYearLabel(start);
  const divisor = type === 'year' ? 1 : type === 'month' ? 12 : 52;

  const byRep = new Map();
  let shopifyAmount = 0;
  let shopifyCount = 0;

  for (const sale of sales) {
    if (!inRange(sale.orderDate, start, end)) continue;

    if (sale.source === 'shopify') {
      shopifyAmount += sale.amount;
      shopifyCount += 1;
    }

    const rep = sale.rep || 'Non assigné';
    if (!byRep.has(rep)) {
      const byStatus = {};
      for (const status of config.io.statuses) byStatus[status] = 0;
      byRep.set(rep, { rep, amount: 0, count: 0, byStatus });
    }
    const entry = byRep.get(rep);
    entry.amount += sale.amount;
    entry.count += 1;
    if (sale.source === 'io' && config.io.statuses.includes(sale.status)) {
      entry.byStatus[sale.status] += sale.amount;
    }
  }

  const rows = Array.from(byRep.values()).map((entry) => {
    const annualTarget = objectifs.reps && objectifs.reps[entry.rep] && objectifs.reps[entry.rep][fyLabel];
    const target = annualTarget ? annualTarget / divisor : null;
    const pct = target ? (entry.amount / target) * 100 : null;
    // Taux de conversion: part des ventes "Confirmé" dans le total du
    // representant (definition maison, pas de standard fourni par le
    // client - a ajuster si une autre formule est souhaitee).
    const conversion = entry.amount > 0 ? (entry.byStatus['Confirmé'] / entry.amount) * 100 : null;
    return { ...entry, target, pct, conversion };
  });

  rows.sort((a, b) => b.amount - a.amount);

  // Objectif "boutique Shopify": categorie distincte des representants IO
  // (le total de vente Shopify n'est pas attribue a un representant).
  const shopifyAnnualTarget = objectifs.shopify && objectifs.shopify[fyLabel];
  const shopifyTarget = shopifyAnnualTarget ? shopifyAnnualTarget / divisor : null;
  const shopifyPct = shopifyTarget ? (shopifyAmount / shopifyTarget) * 100 : null;

  return {
    type,
    offset,
    label,
    fiscalYear: fyLabel,
    reps: rows,
    shopify: { amount: shopifyAmount, count: shopifyCount, target: shopifyTarget, pct: shopifyPct },
  };
}

// Objectif annuel global de l'entreprise (carte "Objectif annuel"):
// chiffre reel fourni par le client dans config/objectifs.json (pas une
// somme calculee des objectifs individuels), compare au total reel de
// l'annee financiere en cours.
function getGlobalObjective(referenceDate = new Date()) {
  const sales = db.getAllSales();
  const objectifs = loadObjectifs();
  const { start, end } = getBounds('year', 0, referenceDate);
  const fyLabel = fiscalYearLabel(start);

  const amount = computeTotals(sales, start, end).grandTotal;
  const target = (objectifs.global && objectifs.global[fyLabel]) || null;
  const pct = target ? (amount / target) * 100 : null;

  return { fiscalYear: fyLabel, amount, target, pct };
}

// Serie de points reels pour la mini-sparkline de chaque grande carte:
// - "day"/"week": un point par jour de la semaine en cours (jusqu'a aujourd'hui)
// - "month": un point par jour du mois en cours (jusqu'a aujourd'hui)
// - "year": un point par mois de l'annee financiere en cours (jusqu'au mois en cours)
// Aucune donnee inventee: chaque point vient de computeTotals() sur les
// vraies ventes stockees.
function getTrend(cardType, referenceDate = new Date()) {
  const sales = db.getAllSales();
  const points = [];

  if (cardType === 'week') {
    const { start } = getBounds('week', 0, referenceDate);
    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);
    for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
      const dayEnd = addDays(d, 1);
      points.push({ label: d.toLocaleDateString('fr-CA', { weekday: 'short' }), amount: computeTotals(sales, d, dayEnd).grandTotal });
    }
  } else if (cardType === 'month') {
    const { start } = getBounds('month', 0, referenceDate);
    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);
    for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
      const dayEnd = addDays(d, 1);
      points.push({ label: String(d.getDate()), amount: computeTotals(sales, d, dayEnd).grandTotal });
    }
  } else if (cardType === 'year') {
    const { start } = getBounds('year', 0, referenceDate);
    const ref = new Date(referenceDate);
    for (let m = new Date(start); m <= ref; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const monthEnd = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      points.push({ label: m.toLocaleDateString('fr-CA', { month: 'short' }), amount: computeTotals(sales, m, monthEnd).grandTotal });
    }
  } else {
    throw new Error(`Type de tendance inconnu: ${cardType}`);
  }

  return points;
}

// Compteurs par statut IO sur une fenetre glissante de 7 jours (vs les 7
// jours precedents), pour les 3 cartes Confirmes/Soumissions/VRF-Contrats
// sous les grandes cartes.
//
// Limite connue: on ne trace pas l'historique des changements de statut -
// chaque enregistrement n'a qu'une seule date (`orderDate`, mappee depuis
// le champ IO "createtime") et un seul statut actuel (le dernier connu, mis
// a jour a chaque sync). Donc:
// - "Confirmes passes au statut Confirme dans les 7 derniers jours" est
//   approxime par "statut = Confirme ET createtime dans les 7 derniers
//   jours" - createtime est la date de creation du lead chez IO, pas
//   necessairement la date exacte du changement de statut. Meilleure
//   approximation possible sans historique de statuts.
// - "Soumissions actuellement ouvertes créées dans les 7 derniers jours"
//   n'a PAS besoin de logique supplementaire pour exclure les soumissions
//   converties: chaque sync ecrase le statut d'un enregistrement par son
//   statut ACTUEL (upsert par externalId) - si une soumission a ete
//   convertie en Confirme/Contrat-VFR depuis, son statut stocke est deja
//   passe a ce nouveau statut. Filtrer par statut = Soumission suffit donc
//   a ne garder que celles encore ouvertes.
function getStatusCounts7d(referenceDate = new Date()) {
  const sales = db.getAllSales();
  const cur = getBounds('rolling7', 0, referenceDate);
  const prev = getBounds('rolling7', -1, referenceDate);

  const countFor = (status, { start, end }) =>
    sales.filter((s) => s.source === 'io' && s.status === status && inRange(s.orderDate, start, end)).length;

  const statuses = {};
  for (const status of config.io.statuses) {
    const current = countFor(status, cur);
    const previous = countFor(status, prev);
    statuses[status] = { current, previous, changePct: pctChange(current, previous) };
  }

  return { current: { label: cur.label }, previous: { label: prev.label }, statuses };
}

// Taux de conversion moyen parmi les representants IO connus (config/
// objectifs.json) - PAS la boutique Shopify, qui n'a pas de representant.
// Simple moyenne arithmetique des taux individuels (pas ponderee par
// volume), meme definition de "conversion" que le tableau des
// representants (part des ventes Confirme dans le total du representant),
// sur l'annee financiere en cours - memes chiffres que le tableau.
function getRepConversionSummary(referenceDate = new Date()) {
  const objectifs = loadObjectifs();
  const knownReps = Object.keys(objectifs.reps || {});
  const { reps, fiscalYear, label } = getRepBreakdown('year', 0, referenceDate);

  const matched = reps.filter((r) => knownReps.includes(r.rep) && r.conversion !== null);
  const average = matched.length ? matched.reduce((s, r) => s + r.conversion, 0) / matched.length : null;

  return { average, repCount: matched.length, fiscalYear, label };
}

// Flux "activite en direct": les N ventes reelles les plus recentes (tous
// statuts/sources confondus), triees par date de vente. Pas d'evenements
// fabriques - juste une vue recente des vraies donnees synchronisees.
function getRecentActivity(limit = 8) {
  const sales = db.getAllSales();
  return [...sales]
    .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
    .slice(0, limit)
    .map((s) => ({
      source: s.source,
      status: s.source === 'io' ? s.status : 'Shopify',
      rep: s.rep,
      amount: s.amount,
      orderDate: s.orderDate,
    }));
}

module.exports = {
  getBounds,
  computeTotals,
  getOverview,
  getYoY,
  getRepBreakdown,
  getStatusCounts7d,
  getRepConversionSummary,
  getGlobalObjective,
  getTrend,
  getRecentActivity,
  fiscalYearLabel,
};
