const config = require('../config');
const { generateMockSales } = require('./mockData');

const SOURCE = 'io';

// InflatableOffice = plateforme "rental.software" (API6). D'apres leur
// documentation publique (support.rental.software) :
//   GET {IO_API_BASE_URL}{IO_SALES_ENDPOINT}?apiKey={IO_API_KEY}&...
// L'authentification se fait par parametre de requete "apiKey", PAS par
// header Authorization/Bearer. Les listes paginees renvoient une enveloppe
// { offset, limit, first, next, previous, items: [...] } - confirme pour
// l'endpoint /rentals (catalogue d'inventaire). On suit "next" tant qu'il
// est present.
//
// ATTENTION: /rentals (le defaut historique de IO_SALES_ENDPOINT) semble
// etre le catalogue d'inventaire (structures gonflables), pas les
// ventes/reservations - le vrai endpoint pour les ventes n'a pas pu etre
// confirme via la doc publique. A verifier/ajuster (IO_SALES_ENDPOINT et
// IO_FIELD_*) une fois l'acces reel au compte disponible - voir README.

function extractArray(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.results)) return json.results;
  if (Array.isArray(json.sales)) return json.sales;
  if (Array.isArray(json.orders)) return json.orders;
  throw new Error('Reponse IO inattendue: impossible de trouver un tableau de ventes.');
}

function mapRecord(raw) {
  const { fieldId, fieldStatus, fieldAmount, fieldRep, fieldDate } = config.io;
  return {
    source: SOURCE,
    externalId: String(raw[fieldId]),
    status: raw[fieldStatus] != null ? String(raw[fieldStatus]) : 'Inconnu',
    rep: raw[fieldRep] != null ? String(raw[fieldRep]) : null,
    amount: parseFloat(raw[fieldAmount]) || 0,
    currency: raw.currency || 'CAD',
    orderDate: raw[fieldDate],
  };
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`InflatableOffice API ${res.status}: ${body.slice(0, 300)}`);
  }

  return res.json();
}

async function fetchFromApi(sinceIso) {
  const { baseUrl, apiKey, salesEndpoint } = config.io;
  const firstUrl = new URL(salesEndpoint, baseUrl);
  firstUrl.searchParams.set('apiKey', apiKey);
  firstUrl.searchParams.set('since', sinceIso);

  const records = [];
  let url = firstUrl.toString();

  while (url) {
    const json = await fetchPage(url);
    records.push(...extractArray(json));

    // Pagination "offset/limit" documentee par rental.software: la reponse
    // contient une URL "next" tant qu'il reste des pages.
    url = json && typeof json.next === 'string' ? json.next : null;
  }

  return records.map(mapRecord);
}

async function fetchSales({ sinceIso }) {
  if (!config.io.configured) {
    console.warn('[io] IO_API_BASE_URL / IO_API_KEY non configures - mode MOCK actif.');
    return generateMockSales({
      seed: 2,
      daysBack: config.io.initialSyncDays,
      perWeek: 6,
      statuses: config.io.statuses,
      minAmount: 200,
      maxAmount: 4000,
    }).map((r) => ({ ...r, source: SOURCE }));
  }

  return fetchFromApi(sinceIso);
}

module.exports = { fetchSales, SOURCE };
