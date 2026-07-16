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
  // grandTotal = chiffre d'affaires REEL (Confirmé, qui inclut déjà les
  // dossiers "Réalisé"/payés côté import Excel - voir
  // connectors/excelStats.js) + Shopify. On exclut volontairement
  // Soumission/Contrat-VFR/Autre: ce sont des devis pas encore gagnés, les
  // compter dans le total afficherait du chiffre d'affaires qui n'existe
  // pas encore (confirmé par le client: le fichier de stats de référence
  // ne compte que "Conclu" = Confirmé+Réalisé dans son total annuel).
  const grandTotal = (io['Confirmé'] ? io['Confirmé'].amount : 0) + shopify.amount;
  // Total incluant le pipeline ouvert (Soumission etc.) - conservé pour un
  // usage futur éventuel (ex: carte "pipeline total"), pas utilisé pour
  // l'instant dans le calcul des grandes cartes.
  const pipelineTotal = ioTotal + shopify.amount;

  return { io, ioTotal, shopify, grandTotal, pipelineTotal };
}

function pctChange(current, previous) {
  if (!previous) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

// Repartition du $ Conclu par division reelle de l'entreprise (Location /
// Fabrication / Reparation / Vente - voir excelStats.normalizeIoType).
// 'Vente' regroupe les dossiers IO de type Vente (ventes fermes hors
// location/fabrication) ET les ventes Shopify (source='shopify', qui
// n'ont pas de 'type' IO mais representent le meme genre de vente directe
// - le fichier source de la collegue les fusionne deja dans sa propre
// categorie "Vente"). Les dossiers IO dont le type ne matche aucune des 4
// categories connues sont regroupes dans 'Autre': pas affiches en colonne
// separee, mais inclus dans le sous-total pour que la somme retombe juste.
const IO_TYPES = ['Location', 'Fabrication', 'Réparation', 'Vente'];

function computeIoTypeTotals(sales, start, end) {
  const totals = { Location: 0, Fabrication: 0, Réparation: 0, Vente: 0, Autre: 0 };
  for (const sale of sales) {
    if (!inRange(sale.orderDate, start, end)) continue;
    if (sale.source === 'shopify') {
      totals.Vente += sale.amount;
      continue;
    }
    if (sale.source !== 'io' || sale.status !== 'Confirmé') continue;
    const type = IO_TYPES.includes(sale.type) ? sale.type : 'Autre';
    totals[type] += sale.amount;
  }
  return totals;
}

// Comparaison "meme periode l'an dernier" (pas la periode precedente):
// semaine -> 52 semaines en arriere, mois -> meme mois l'an dernier,
// annee (fiscale) -> annee fiscale precedente (deja "l'an dernier" par
// definition). Utilise pour les 4 grandes cartes du dashboard.
const YOY_OFFSET = { week: -52, month: -12, year: -1 };

// Decalage de la periode "courante" avant application du YOY_OFFSET
// ci-dessus. Pour "week" on affiche la semaine derniere COMPLETE
// (lundi-dimanche) plutot que la semaine en cours (encore partielle la
// plupart du temps) - les rencontres d'equipe ayant lieu le mardi, la
// semaine en cours n'a presque jamais de chiffres complets a ce moment-la.
// month/year restent sur la periode en cours (0).
const CARD_BASE_OFFSET = { week: -1, month: 0, year: 0 };

function getYoY(referenceDate = new Date()) {
  const sales = db.getAllSales();
  const result = {};

  for (const [type, offset] of Object.entries(YOY_OFFSET)) {
    const base = CARD_BASE_OFFSET[type] || 0;
    const cur = getBounds(type, base, referenceDate);
    const prevYear = getBounds(type, base + offset, referenceDate);
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

  // Tableau "Performance des représentants": seulement l'équipe de vente
  // officielle (Cédric/Mathis/Didier/Jérôme - noms complets, voir
  // excelStats.REP_MAP). Exclut 'Gino', 'Non assigné', 'Autre' etc. -
  // dossiers IO attribués à d'autres personnes/erreurs de saisie, pas des
  // représentants à afficher dans ce tableau.
  const VISIBLE_REPS = ['Cedric Paré', 'Mathis Beaupré', 'Didier Paradis', 'Jerome Goulet'];

  const rows = Array.from(byRep.values())
    .filter((entry) => VISIBLE_REPS.includes(entry.rep))
    .map((entry) => {
    const annualTarget = objectifs.reps && objectifs.reps[entry.rep] && objectifs.reps[entry.rep][fyLabel];
    const confirmedAmount = entry.byStatus['Confirmé'] || 0;
    const target = annualTarget ? annualTarget / divisor : null;
    // % vs objectif calculé sur le Confirmé (ferme), pas sur entry.amount
    // (qui inclurait aussi les soumissions ouvertes - un devis pas encore
    // gagné ne doit pas compter dans l'atteinte d'un objectif de vente).
    const pct = target ? (confirmedAmount / target) * 100 : null;
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

// Numero de semaine ISO 8601 (1-53) de la semaine calendaire contenant `date`.
function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // dimanche (0) -> 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Serie de points reels pour la mini-sparkline de chaque grande carte:
// - "week": un point par jour de la semaine en cours (jusqu'a aujourd'hui)
// - "month": 5 semaines calendaires (lundi-dimanche) centrees sur la
//   semaine en cours - 2 precedentes, celle en cours, 2 suivantes -
//   plutot que les seuls jours ecoules du mois civil. Les semaines
//   futures peuvent avoir un total a 0 (aucune vente inventee).
// - "year": 13 mois civils centres sur le mois en cours - 6 precedents,
//   celui en cours, 6 suivants - plutot que les seuls mois ecoules de
//   l'annee financiere (peut donc deborder sur l'annee financiere
//   adjacente aux deux bouts).
// Aucune donnee inventee: chaque point vient de computeTotals() sur les
// vraies ventes stockees.
function getTrend(cardType, referenceDate = new Date()) {
  const sales = db.getAllSales();
  const points = [];

  if (cardType === 'week') {
    // Semaine derniere complete (lundi-dimanche) - voir CARD_BASE_OFFSET
    // dans getYoY() pour le meme choix applique a la grande carte.
    const { start, end } = getBounds('week', -1, referenceDate);
    for (let d = new Date(start); d < end; d = addDays(d, 1)) {
      const dayEnd = addDays(d, 1);
      points.push({ label: d.toLocaleDateString('fr-CA', { weekday: 'short' }), amount: computeTotals(sales, d, dayEnd).grandTotal });
    }
  } else if (cardType === 'month') {
    for (let offset = -2; offset <= 2; offset += 1) {
      const { start, end } = getBounds('week', offset, referenceDate);
      points.push({
        label: `S${isoWeekNumber(start)}`,
        amount: computeTotals(sales, start, end).grandTotal,
        current: offset === 0,
      });
    }
  } else if (cardType === 'year') {
    for (let offset = -6; offset <= 6; offset += 1) {
      const { start, end } = getBounds('month', offset, referenceDate);
      points.push({
        label: start.toLocaleDateString('fr-CA', { month: 'short', year: '2-digit' }),
        amount: computeTotals(sales, start, end).grandTotal,
        current: offset === 0,
      });
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

// Tableau "Ventes par mois" (reproduit le format du fichier de stats
// manuel d'Isabelle): pour chaque mois de l'annee financiere en cours (12
// mois, oct->sept) - $ Soumis (montant des soumissions IO ouvertes ce
// mois-la, statut 'Soumission'), $ Conclu (meme definition que grandTotal
// ailleurs dans le dashboard: Confirme + Shopify), % vs LY (variation de
// $ Conclu vs meme mois l'an dernier), $ Objectif (config/objectifs.json >
// monthly, annee courante seulement - le fichier source n'a pas de cible
// mensuelle pour l'annee precedente), % Atteinte Obj. Le code couleur du %
// Atteinte reutilise tierClass() cote client (vert >=100%, jaune >=75%,
// rouge <75%) - PAS forcement identique aux puces du fichier Excel source
// (dont la logique exacte n'est pas documentee), mais coherent avec le
// reste du dashboard.
function getMonthlySalesTable(referenceDate = new Date()) {
  const sales = db.getAllSales();
  const objectifs = loadObjectifs();
  const { start: fyStart } = getBounds('year', 0, referenceDate);
  const fyLabel = fiscalYearLabel(fyStart);
  const prevFyLabel = fiscalYearLabel(addDays(fyStart, -1));
  const monthlyTargets = (objectifs.monthly && objectifs.monthly[fyLabel]) || {};

  const rows = [];
  for (let i = 0; i < 12; i += 1) {
    const monthStart = new Date(fyStart.getFullYear(), fyStart.getMonth() + i, 1);
    const monthEnd = new Date(fyStart.getFullYear(), fyStart.getMonth() + i + 1, 1);
    const lyStart = new Date(monthStart.getFullYear() - 1, monthStart.getMonth(), 1);
    const lyEnd = new Date(monthStart.getFullYear() - 1, monthStart.getMonth() + 1, 1);

    const totals = computeTotals(sales, monthStart, monthEnd);
    const lyTotals = computeTotals(sales, lyStart, lyEnd);
    const submitted = totals.io['Soumission'] ? totals.io['Soumission'].amount : 0;
    const ioTypes = computeIoTypeTotals(sales, monthStart, monthEnd);

    const monthKey = String(monthStart.getMonth() + 1);
    const target = monthlyTargets[monthKey] != null ? monthlyTargets[monthKey] : null;
    const pct = target ? (totals.grandTotal / target) * 100 : null;

    rows.push({
      label: monthStart.toLocaleDateString('fr-CA', { month: 'short' }),
      month: monthKey,
      submitted,
      location: ioTypes.Location,
      fabrication: ioTypes.Fabrication,
      reparation: ioTypes.Réparation,
      vente: ioTypes.Vente,
      ioSubtotal: ioTypes.Location + ioTypes.Fabrication + ioTypes.Réparation + ioTypes.Vente + ioTypes.Autre,
      concluded: totals.grandTotal,
      lyConcluded: lyTotals.grandTotal,
      changePct: pctChange(totals.grandTotal, lyTotals.grandTotal),
      target,
      pct,
    });
  }

  const totalConcluded = rows.reduce((s, r) => s + r.concluded, 0);
  const totalLyConcluded = rows.reduce((s, r) => s + r.lyConcluded, 0);
  const totalSubmitted = rows.reduce((s, r) => s + r.submitted, 0);
  const totalLocation = rows.reduce((s, r) => s + r.location, 0);
  const totalFabrication = rows.reduce((s, r) => s + r.fabrication, 0);
  const totalReparation = rows.reduce((s, r) => s + r.reparation, 0);
  const totalVente = rows.reduce((s, r) => s + r.vente, 0);
  const totalIoSubtotal = rows.reduce((s, r) => s + r.ioSubtotal, 0);
  const targets = rows.map((r) => r.target).filter((t) => t !== null);
  const totalTarget = targets.length ? targets.reduce((s, t) => s + t, 0) : null;
  const totalPct = totalTarget ? (totalConcluded / totalTarget) * 100 : null;

  return {
    fiscalYear: fyLabel,
    previousFiscalYear: prevFyLabel,
    rows,
    total: {
      submitted: totalSubmitted,
      location: totalLocation,
      fabrication: totalFabrication,
      reparation: totalReparation,
      vente: totalVente,
      ioSubtotal: totalIoSubtotal,
      concluded: totalConcluded,
      lyConcluded: totalLyConcluded,
      changePct: pctChange(totalConcluded, totalLyConcluded),
      target: totalTarget,
      pct: totalPct,
    },
  };
}

// Fenetres "par division" (Location / Fabrication / Reparation / Vente +
// Global): pour chacune, Total = $ Conclu sur l'annee financiere AU
// COMPLET (memes bornes que la carte "Annee financiere" - PAS limite a
// aujourd'hui: un dossier deja Confirme compte des sa confirmation, meme
// si sa date d'evenement/livraison tombe plus tard dans l'annee - sinon
// les 4 fenetres ne totaliseraient pas la meme somme que la carte "Annee
// financiere", qui elle n'applique aucune limite de date du jour).
// Objectif = cible annuelle de la division (config/objectifs.json >
// divisions). Derniere semaine = $ Conclu de la semaine derniere complete
// pour cette division (meme semaine que la carte "Semaine derniere" - voir
// CARD_BASE_OFFSET plus haut). 'Global' additionne les 4 divisions plutot
// que de reutiliser grandTotal/objectif annuel directement: garantit que
// Global = somme exacte des 4 fenetres meme si Autre (dossiers IO au type
// non reconnu) existe.
function getDivisionBreakdown(referenceDate = new Date()) {
  const sales = db.getAllSales();
  const objectifs = loadObjectifs();
  const { start: fyStart, end: fyEnd } = getBounds('year', 0, referenceDate);
  const fyLabel = fiscalYearLabel(fyStart);
  const lastWeek = getBounds('week', -1, referenceDate);

  const ytdTotals = computeIoTypeTotals(sales, fyStart, fyEnd);
  const lastWeekTotals = computeIoTypeTotals(sales, lastWeek.start, lastWeek.end);
  const divisionTargets = (objectifs.divisions && objectifs.divisions[fyLabel]) || {};

  const divisions = IO_TYPES.map((name) => {
    const target = divisionTargets[name] != null ? divisionTargets[name] : null;
    const total = ytdTotals[name];
    return {
      name,
      total,
      target,
      pct: target ? (total / target) * 100 : null,
      lastWeek: lastWeekTotals[name],
    };
  });

  const globalTarget = divisions.every((d) => d.target !== null)
    ? divisions.reduce((s, d) => s + d.target, 0)
    : null;
  const globalTotal = divisions.reduce((s, d) => s + d.total, 0);
  const globalLastWeek = divisions.reduce((s, d) => s + d.lastWeek, 0);

  return {
    fiscalYear: fyLabel,
    divisions,
    global: {
      name: 'Global',
      total: globalTotal,
      target: globalTarget,
      pct: globalTarget ? (globalTotal / globalTarget) * 100 : null,
      lastWeek: globalLastWeek,
    },
  };
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
  getMonthlySalesTable,
  getDivisionBreakdown,
  fiscalYearLabel,
};
