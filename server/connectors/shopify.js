const config = require('../config');
const { generateMockSales } = require('./mockData');

const SOURCE = 'shopify';

// Cache en memoire du token OAuth obtenu via client credentials grant
// (apps creees via le Dev Dashboard Shopify depuis janvier 2026). Le token
// expire apres ~24h; on le rafraichit un peu avant l'expiration.
let cachedToken = null; // { value, expiresAt }

async function requestAccessToken() {
  const { shop, clientId, clientSecret } = config.shopify;
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Shopify OAuth token ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const expiresInMs = (json.expires_in || 86400) * 1000;
  cachedToken = {
    value: json.access_token,
    // Marge de securite de 5 minutes avant l'expiration reelle.
    expiresAt: Date.now() + expiresInMs - 5 * 60 * 1000,
  };
  return cachedToken.value;
}

// Retourne un token Admin API valide: le token statique si configure
// (ancien flux "custom app"), sinon un token OAuth via client credentials
// grant, mis en cache et rafraichi automatiquement a l'expiration.
async function getAccessToken({ forceRefresh = false } = {}) {
  if (config.shopify.accessToken) return config.shopify.accessToken;

  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  return requestAccessToken();
}

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

async function requestPage(url, token) {
  return fetch(url, {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
  });
}

async function fetchFromApi(sinceIso) {
  const { shop, apiVersion } = config.shopify;
  const baseUrl = `https://${shop}/admin/api/${apiVersion}/orders.json`;
  const results = [];

  let url = `${baseUrl}?status=any&limit=250&created_at_min=${encodeURIComponent(sinceIso)}`;
  let token = await getAccessToken();

  while (url) {
    let res = await requestPage(url, token);

    // Token expire/invalide: on rafraichit une seule fois puis on reessaie.
    if (res.status === 401) {
      token = await getAccessToken({ forceRefresh: true });
      res = await requestPage(url, token);
    }

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
