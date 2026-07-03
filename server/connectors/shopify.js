const config = require('../config');
const { generateMockSales } = require('./mockData');

const SOURCE = 'shopify';

// Essaie d'extraire le nom du representant depuis les tags ou les
// note_attributes d'une commande Shopify (convention courante quand un champ
// personnalise ou une app tierce assigne un vendeur a la commande).
function extractRep(order) {
  const noteAttr = (order.note_attributes || []).find((a) =>
    /rep(resentative)?|vendeur|salesperson/i.test(a.name || '')
  );
  if (noteAttr && noteAttr.value) return noteAttr.value;

  const tags = (order.tags || '').split(',').map((t) => t.trim());
  const repTag = tags.find((t) => /^rep:/i.test(t));
  if (repTag) return repTag.split(':')[1].trim();

  return null;
}

function mapOrder(order) {
  return {
    source: SOURCE,
    externalId: String(order.id),
    status: 'Shopify',
    rep: extractRep(order),
    amount: parseFloat(order.total_price) || 0,
    currency: order.currency || 'CAD',
    orderDate: order.created_at,
  };
}

async function fetchFromApi(sinceIso) {
  const { shop, accessToken, apiVersion } = config.shopify;
  const baseUrl = `https://${shop}/admin/api/${apiVersion}/orders.json`;
  const results = [];

  let url = `${baseUrl}?status=any&limit=250&created_at_min=${encodeURIComponent(sinceIso)}`;

  while (url) {
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Shopify API ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = await res.json();
    results.push(...(json.orders || []));

    // Pagination via l'en-tete Link (cursor-based).
    const link = res.headers.get('link') || res.headers.get('Link');
    const next = link && link.split(',').find((part) => part.includes('rel="next"'));
    if (next) {
      const match = next.match(/<([^>]+)>/);
      url = match ? match[1] : null;
    } else {
      url = null;
    }
  }

  return results.map(mapOrder);
}

async function fetchSales({ sinceIso }) {
  if (!config.shopify.configured) {
    console.warn('[shopify] SHOPIFY_SHOP / SHOPIFY_ACCESS_TOKEN non configures - mode MOCK actif.');
    return generateMockSales({
      seed: 1,
      daysBack: config.shopify.initialSyncDays,
      perWeek: 8,
      statuses: ['Shopify'],
      minAmount: 40,
      maxAmount: 600,
    }).map((r) => ({ ...r, source: SOURCE }));
  }

  return fetchFromApi(sinceIso);
}

module.exports = { fetchSales, SOURCE };
