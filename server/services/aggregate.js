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

function getOverview(referenceDate = new Date()) {
  const sales = db.getAllSales();
  const types = ['week', 'month', 'year'];
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
    if (!byRep.has(rep)) byRep.set(rep, { rep, amount: 0, count: 0 });
    const entry = byRep.get(rep);
    entry.amount += sale.amount;
    entry.count += 1;
  }

  const rows = Array.from(byRep.values()).map((entry) => {
    const annualTarget = objectifs.reps && objectifs.reps[entry.rep] && objectifs.reps[entry.rep][fyLabel];
    const target = annualTarget ? annualTarget / divisor : null;
    const pct = target ? (entry.amount / target) * 100 : null;
    return { ...entry, target, pct };
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

module.exports = { getBounds, computeTotals, getOverview, getRepBreakdown, fiscalYearLabel };
