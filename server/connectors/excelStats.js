const XLSX = require('xlsx');
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
  // le telechargement direct du binaire plutot que la page de previsualisation
  // - fonctionne avec un lien "personnes de Proludik" sans OAuth/app Azure,
  // tant que le serveur qui appelle est deja "connu" du tenant (sinon voir
  // README: passer par Microsoft Graph + app registration).
  const url = new URL(shareUrl);
  url.searchParams.set('download', '1');
  return url.toString();
}

async function downloadBuffer(shareUrl) {
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
  if (!config.excel.shareUrl) {
    throw new Error('EXCEL_SHARE_URL non configuré (voir .env.example).');
  }
  const buf = await downloadBuffer(config.excel.shareUrl);
  const rows = parseRowsFromBuffer(buf);
  cache = { at: Date.now(), rows };
  return rows;
}

// "Réalisé" (facturé/payé) regroupé avec "Confirmé" - un contrat paye est
// au moins aussi "confirmé" qu'un contrat confirmé mais pas encore réalisé,
// et le dashboard n'a pas de 4e carte de statut. "Refusé" -> exclu: une
// soumission refusée n'est pas une vente et ne doit pas compter dans le
// chiffre d'affaires.
function mapIoStatus(raw) {
  if (raw === 'Confirmé' || raw === 'Réalisé') return 'Confirmé';
  if (raw === 'Soumission') return 'Soumission';
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

    const status = mapIoStatus(row['Statut simplifié']);

    if (SHOPIFY_REPS.has(repRaw)) {
      // BUG corrigé: avant, TOUTES les lignes Boutique/Web étaient comptées
      // (y compris Soumission/Refusé), contrairement aux lignes des
      // représentants qui passaient déjà par mapIoStatus. Ça gonflait le
      // total Shopify d'environ 38 000 $ (soumissions Shopify non fermées
      // comptées comme des ventes). Même filtre appliqué ici désormais.
      if (status === null) continue;
      shopify.push({
        source: SHOPIFY_SOURCE,
        externalId,
        status: 'Shopify',
        rep: null,
        amount,
        currency: 'CAD',
        orderDate,
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
