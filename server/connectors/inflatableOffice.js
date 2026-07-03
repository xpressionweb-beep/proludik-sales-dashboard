const config = require('../config');
const { generateMockSales } = require('./mockData');

const SOURCE = 'io';

// ATTENTION: adaptateur generique en attendant la documentation officielle de
// l'API InflatableOffice. Il suppose une API REST classique:
//   GET {IO_API_BASE_URL}{IO_SALES_ENDPOINT}?since=<ISO date>
//   Authorization: Bearer {IO_API_KEY}
// et une reponse JSON soit sous forme de tableau, soit { data: [...] }.
// Les noms de champs sont mappes via les variables d'environnement
// IO_FIELD_* (voir .env.example) pour permettre un ajustement sans toucher au
// code une fois la vraie forme de l'API connue.

function extractArray(json) {
  if (Array.isArray(json)) return json;
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

async function fetchFromApi(sinceIso) {
  const { baseUrl, apiKey, salesEndpoint } = config.io;
  const url = new URL(salesEndpoint, baseUrl);
  url.searchParams.set('since', sinceIso);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`InflatableOffice API ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  return extractArray(json).map(mapRecord);
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
