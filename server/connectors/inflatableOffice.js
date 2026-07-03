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

// Mapping statusid -> libelle, confirme par le client (table partielle).
// "Contrat" et "VFR/Cont." sont deux codes distincts cote IO qui se
// regroupent tous les deux sous le bucket dashboard "Contrat/VFR".
// A completer au fur et a mesure que d'autres codes sont identifies.
const STATUS_LABELS = {
  40213: 'Soumission',
  40215: 'Contrat/VFR',
  40217: 'Confirmé',
  127955: 'Contrat/VFR',
};

// Traduit un statusid vers son libelle si connu; sinon retourne le code brut
// (qui tombera naturellement dans le bucket "Autre" du dashboard, voir
// aggregate.js).
function mapStatus(rawStatus) {
  const label = STATUS_LABELS[rawStatus];
  return label || String(rawStatus);
}

// Mapping salesrep -> nom, confirme par le client (table partielle). Doit
// correspondre aux noms utilises dans config/objectifs.json pour que le
// calcul des % vs objectifs fonctionne - voir README.
const REP_LABELS = {
  80769: 'Mathis Beaupré',
  80773: 'Cedric Paré',
  81675: 'Jerome Goulet',
  171955: 'Didier Paradis',
};

// Traduit un salesrep vers son nom si connu; sinon retourne l'ID brut.
function mapRep(rawRep) {
  return REP_LABELS[rawRep] || String(rawRep);
}

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
    status: raw[fieldStatus] != null ? mapStatus(raw[fieldStatus]) : 'Inconnu',
    rep: raw[fieldRep] != null ? mapRep(raw[fieldRep]) : null,
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

// Joint baseUrl + endpoint sans perdre un segment de chemin de baseUrl.
// ATTENTION: new URL(endpoint, baseUrl) ne fonctionne PAS ici - si endpoint
// commence par "/", il remplace tout le chemin de baseUrl au lieu de s'y
// ajouter (ex: new URL('/leads', 'https://host/api6') -> 'https://host/leads',
// le "/api6" est perdu). D'ou ce join explicite.
function buildEndpointUrl(baseUrl, endpoint) {
  const base = baseUrl.replace(/\/+$/, '');
  const path = endpoint.replace(/^\/+/, '');
  return new URL(`${base}/${path}`);
}

async function fetchFromApi(sinceIso) {
  const { baseUrl, apiKey, salesEndpoint } = config.io;
  const firstUrl = buildEndpointUrl(baseUrl, salesEndpoint);
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
