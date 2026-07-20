const XLSX = require('xlsx');
const crypto = require('crypto');
const config = require('../config');

// Connecteur "de secours": au lieu d'appeler les APIs IO/Shopify en direct
// (bloquees cote Render pour IO, scope limite cote Shopify), on lit le
// fichier Excel que la collegue met a jour ~1x/semaine sur OneDrive.
// L'onglet "IO + Shopify" y contient deja les ventes ligne par ligne
// (pas des tableaux croises), colonnes confirmees sur un export reel:
//   No Contrat, Client, Date, Segmentation, Representant, Type,
//   Statut simplifie (Confirme/Realise/Soumission/Refuse), $ avec trsp
//
// On garde le meme schema normalise que les connecteurs io.js/shopify.js
// (source, externalId, status, rep, amount, currency, orderDate) pour que
// aggregate.js n'ait rien a savoir de ce changement de source.

const IO_SOURCE = 'io';
const SHOPIFY_SOURCE = 'shopify';
const SHEET_NAME = 'IO + Shopify';

// Le fichier melange representants IO reels et "Boutique"/"Web" (= ventes
// Shopify sans representant assigne, cf. Global (par rep) du fichier
// source). On les redirige vers le source 'shopify' pour que la carte
// "Boutique Shopify" du dashboard (aggregate.js: shopifyAmount, calcule
// sur sale.source === 'shopify') continue de fonctionner sans changement.
const SHOPIFY_REPS = new Set(['Boutique', 'Web']);

// Les prenoms courts du fichier -> noms complets utilises dans
// config/objectifs.json (sinon les % vs objectifs ne matchent plus).
const REP_MAP = {
  Cédric: 'Cedric Paré',
  Mathis: 'Mathis Beaupré',
  Jérôme: 'Jerome Goulet',
  Didier: 'Didier Paradis',
};

// Type de dossier (colonne "Type" du fichier) - les 4 vraies divisions de
// l'entreprise, confirmees sur le pivot complet de la collegue (onglets
// Fabrication / Location / Reparation / Vente, memes 4 categories partout
// dans le fichier): utilise pour le tableau "Ventes par mois" ET les
// fenetres par division. Normalise via startsWith plutot qu'une egalite
// stricte, pour rester robuste aux petites variations de texte du fichier
// source. Tout ce qui ne matche aucune des 4 categories connues tombe
// dans 'Autre' (inclus dans les sous-totaux mais pas affiche en colonne
// separee).
const IO_TYPES = ['Location', 'Fabrication', 'Réparation', 'Vente'];

function normalizeIoType(raw) {
  const v = (raw || '').toString().trim().toLowerCase();
  if (v.startsWith('location')) return 'Location';
  if (v.startsWith('fabrication')) return 'Fabrication';
  if (v.startsWith('réparation') || v.startsWith('reparation')) return 'Réparation';
  if (v.startsWith('vente')) return 'Vente';
  return 'Autre';
}

function buildDownloadUrl(shareUrl) {
  // Astuce lien de partage OneDrive/SharePoint: ajouter "download=1" force
  // le telechargement direct du binaire plutot que la page de previsualisation.
  // NE FONCTIONNE PAS pour un lien SharePoint "Personnes de l'organisation"
  // appele sans session navigateur (HTTP 403 confirme en prod le 20 juillet
  // 2026) - laisse en fallback seulement si Azure AD n'est pas configure,
  // pour ne pas casser un usage OneDrive personnel "Anyone with the link"
  // ou l'astuce fonctionne encore.
  const url = new URL(shareUrl);
  url.searchParams.set('download', '1');
  return url.toString();
}

// --- Auth applicative Microsoft Graph (client credentials) ---------------
// Voir README section "Import Excel (SharePoint via Graph API)" pour la
// creation de l'app registration Azure AD (permission Sites.Read.All,
// consentement admin) qui fournit AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET.
let tokenCache = null; // { token, expiresAt }

async function getGraphToken() {
  if (tokenCache && tokenCache.expiresAt - Date.now() > 60 * 1000) {
    return tokenCache.token;
  }
  const { tenantId, clientId, clientSecret } = config.excel.azure;
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(config.excel.httpTimeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Authentification Graph API (Azure AD): HTTP ${res.status} ${detail}`.trim());
  }
  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

// Un lien de partage classique (https://proludik.sharepoint.com/:x:/...) se
// convertit en "shareId" Graph via cet encodage documente par Microsoft:
// https://learn.microsoft.com/graph/api/shares-get
function encodeShareUrl(shareUrl) {
  const base64 = Buffer.from(shareUrl, 'utf8').toString('base64');
  const base64Url = base64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  return `u!${base64Url}`;
}

async function downloadBufferViaGraph(shareUrl) {
  const token = await getGraphToken();
  const shareId = encodeShareUrl(shareUrl);
  const res = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem/content`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
    signal: AbortSignal.timeout(config.excel.httpTimeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Téléchargement fichier Excel (Graph API): HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// --- Auth compte de service Google Drive (JWT signe maison, pas de lib) --
// Voir README section "Import Excel (Google Drive)". Alternative a Azure
// AD/Graph quand aucun admin Microsoft 365 n'est disponible pour le
// consentement admin: un compte de service Google n'a besoin d'aucune
// approbation d'organisation - il suffit de partager LE FICHIER (pas tout
// le Drive) avec l'adresse e-mail du compte de service, comme un partage
// normal avec un collegue.
function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildGoogleAssertion(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.private_key);
  const sig64 = signature.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${unsigned}.${sig64}`;
}

let driveTokenCache = null; // { token, expiresAt }

async function getGoogleDriveToken() {
  if (driveTokenCache && driveTokenCache.expiresAt - Date.now() > 60 * 1000) {
    return driveTokenCache.token;
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(config.excel.googleDrive.serviceAccountKey);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY invalide (doit être le contenu JSON complet du fichier de clé).');
  }
  const assertion = buildGoogleAssertion(serviceAccount);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(config.excel.httpTimeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Authentification Google Drive (compte de service): HTTP ${res.status} ${detail}`.trim());
  }
  const data = await res.json();
  driveTokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return driveTokenCache.token;
}

async function downloadBufferViaGoogleDrive() {
  const token = await getGoogleDriveToken();
  const { fileId } = config.excel.googleDrive;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
    signal: AbortSignal.timeout(config.excel.httpTimeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Téléchargement fichier Excel (Google Drive): HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function downloadBuffer(shareUrl) {
  if (config.excel.googleDrive.configured) {
    return downloadBufferViaGoogleDrive();
  }
  if (config.excel.azure.configured) {
    return downloadBufferViaGraph(shareUrl);
  }
  // Fallback: ancien comportement (fonctionne seulement pour un lien
  // OneDrive personnel public, pas pour un lien SharePoint organisationnel).
  const res = await fetch(buildDownloadUrl(shareUrl), {
    redirect: 'follow',
    signal: AbortSignal.timeout(config.excel.httpTimeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Téléchargement fichier Excel (OneDrive): HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function parseRowsFromBuffer(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) {
    throw new Error(
      `Onglet "${SHEET_NAME}" introuvable dans le fichier Excel (onglets trouvés: ${wb.SheetNames.join(', ')}).`
    );
  }
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

// Cache court en memoire (process): les connecteurs 'io' et 'shopify' sont
// synchronises l'un apres l'autre dans le meme cycle (voir sync.js) - sans
// ce cache, chaque cycle telechargerait et re-parserait le fichier deux fois.
let cache = null; // { at, rows }
const CACHE_MS = 60 * 1000;

async function loadRows() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  if (!config.excel.googleDrive.configured && !config.excel.azure.configured && !config.excel.shareUrl) {
    throw new Error(
      'Aucune source Excel configurée (GOOGLE_SERVICE_ACCOUNT_KEY+GOOGLE_DRIVE_FILE_ID, ou AZURE_*, ou EXCEL_SHARE_URL - voir .env.example).'
    );
  }
  const buf = await downloadBuffer(config.excel.shareUrl);
  const rows = parseRowsFromBuffer(buf);
  cache = { at: Date.now(), rows };
  return rows;
}

// "Réalisé" (facturé/payé) regroupé avec "Confirmé" - un contrat paye est
// au moins aussi "confirmé" qu'un contrat confirmé mais pas encore réalisé,
// et le dashboard n'a pas de 4e carte de statut. "Contrat/VFR" et "Refusé"
// sont maintenant reconnus explicitement (BUG CORRIGÉ: avant, tout statut
// autre que Confirmé/Réalisé/Soumission tombait dans le "return null" par
// défaut et était silencieusement exclu de l'import - "Contrat/VFR"
// affichait donc toujours 0$ partout, et "Refusé" étant totalement absent
// des données, le taux de conversion (Confirmé / total du représentant)
// ne comptait aucune soumission perdue au dénominateur, le gonflant
// artificiellement bien au-dessus de la réalité). "Refusé" n'est volontai-
// rement PAS dans config.io.statuses: il ne compte donc dans aucune carte
// de revenu (grandTotal, division, etc.), seulement dans le total brut du
// représentant (entry.amount) utilisé au dénominateur du taux de conversion.
function mapIoStatus(raw) {
  if (raw === 'Confirmé' || raw === 'Réalisé') return 'Confirmé';
  if (raw === 'Soumission') return 'Soumission';
  if (raw === 'Contrat/VFR') return 'Contrat/VFR';
  if (raw === 'Refusé') return 'Refusé';
  return null;
}

function toIso(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function buildRecords(rows, { sinceIso } = {}) {
  const since = sinceIso ? new Date(sinceIso) : null;
  const io = [];
  const shopify = [];

  for (const row of rows) {
    const orderDate = toIso(row['Date']);
    if (!orderDate) continue; // ligne sans date exploitable -> ignorée
    if (since && new Date(orderDate) < since) continue;

    const repRaw = (row['Représentant'] || '').toString().trim();
    const amount = Number(row['$ avec trsp']) || 0;
    // No Contrat manque parfois (ex: certaines lignes web/boutique) -> id
    // de secours base sur client+date pour rester stable d'une sync a l'autre.
    const externalId = String(row['No Contrat'] || `${row['Client'] || 'client'}-${orderDate}`);
    // "Date" = date de l'evenement/location (peut etre dans le futur pour
    // un dossier deja confirme). "Date création" = date a laquelle le
    // dossier a ete ouvert - utilisee pour la statistique "nouveaux
    // dossiers" (voir getNewDossiers7d), distincte de "Date" qui sert a
    // tout le reste du dashboard (chiffre d'affaires, cartes YoY, etc.).
    // Fallback sur orderDate si la colonne manque sur une ligne donnee.
    const createdDate = toIso(row['Date création']) || orderDate;

    const status = mapIoStatus(row['Statut simplifié']);

    if (SHOPIFY_REPS.has(repRaw)) {
      // Seul "Confirmé" compte comme vente Shopify reelle - maintenant que
      // mapIoStatus reconnait aussi Contrat/VFR et Refuse (voir plus haut),
      // un simple check "!== null" laisserait passer des soumissions/
      // refus Boutique/Web comme si c'etait du chiffre d'affaires realise.
      if (status !== 'Confirmé') continue;
      shopify.push({
        source: SHOPIFY_SOURCE,
        externalId,
        status: 'Shopify',
        rep: null,
        amount,
        currency: 'CAD',
        orderDate,
        createdDate,
      });
      continue;
    }

    if (status === null) continue; // Refusé / statut inconnu -> pas une vente

    io.push({
      source: IO_SOURCE,
      externalId,
      status,
      rep: REP_MAP[repRaw] || repRaw || 'Non assigné',
      amount,
      currency: 'CAD',
      orderDate,
      createdDate,
      type: normalizeIoType(row['Type']),
    });
  }

  return { io, shopify };
}

async function fetchIoSales({ sinceIso } = {}) {
  const rows = await loadRows();
  return buildRecords(rows, { sinceIso }).io;
}

async function fetchShopifySales({ sinceIso } = {}) {
  const rows = await loadRows();
  return buildRecords(rows, { sinceIso }).shopify;
}

// Utilisé par la route d'upload manuel (server/routes/api.js): parse un
// buffer .xlsx reçu directement (pas de téléchargement OneDrive), et
// retourne TOUT l'historique du fichier (pas de filtre sinceIso) - un
// upload manuel remplace entièrement les données existantes (voir
// db.replaceSourceSales), donc on veut la totalité du fichier à chaque fois.
function parseUploadedWorkbook(buf) {
  const rows = parseRowsFromBuffer(buf);
  return buildRecords(rows, {});
}

module.exports = {
  fetchIoSales,
  fetchShopifySales,
  parseUploadedWorkbook,
  IO_SOURCE,
  SHOPIFY_SOURCE,
  IO_TYPES,
};
