require('dotenv').config();
const runtimeSettings = require('./runtimeSettings');

const IO_STATUSES = ['Confirmé', 'Soumission', 'Contrat/VFR'];

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  syncCron: process.env.SYNC_CRON || '*/30 * * * *',
  // Timeout par requete HTTP individuelle (Shopify/IO). Sans ca, fetch()
  // peut rester accroche indefiniment si la connexion reste ouverte sans
  // reponse (pas de timeout par defaut sur le fetch natif de Node).
  httpTimeoutMs: parseInt(process.env.HTTP_TIMEOUT_MS, 10) || 20000,
  // Garde-fou global par source: meme si une requete individuelle ne
  // timeout pas correctement pour une raison imprevue, la sync de cette
  // source est forcee a echouer apres ce delai plutot que de bloquer
  // indefiniment le flag "running" du scheduler (et donc tous les cycles
  // cron suivants).
  syncWatchdogMs: parseInt(process.env.SYNC_WATCHDOG_MS, 10) || 120000,

  // Protection HTTP Basic Auth sur tout le dashboard (voir server/basicAuth.js).
  // Desactivee tant que les deux variables ne sont pas fournies, pour ne
  // pas bloquer le developpement local.
  auth: {
    user: process.env.DASHBOARD_USER || '',
    password: process.env.DASHBOARD_PASSWORD || '',
    get enabled() {
      return Boolean(this.user && this.password);
    },
  },

  shopify: {
    shop: process.env.SHOPIFY_SHOP || '',
    // Apps "legacy" (creees avant le Dev Dashboard, jan. 2026): token statique.
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN || '',
    // Apps creees via le Dev Dashboard (depuis jan. 2026): OAuth client credentials grant.
    clientId: process.env.SHOPIFY_CLIENT_ID || '',
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET || '',
    apiVersion: process.env.SHOPIFY_API_VERSION || '2024-10',
    initialSyncDays: parseInt(process.env.SHOPIFY_INITIAL_SYNC_DAYS, 10) || 400,
    get configured() {
      return Boolean(this.shop && (this.accessToken || (this.clientId && this.clientSecret)));
    },
  },

  io: {
    baseUrl: process.env.IO_API_BASE_URL || '',
    apiKey: process.env.IO_API_KEY || '',
    // Module "Leads" (contrats + paiements, cf. permission "Lead Payments")
    // confirme par le client comme etant l'equivalent ventes/contrats de son
    // compte IO - pas de module "sales"/"orders" separe.
    salesEndpoint: process.env.IO_SALES_ENDPOINT || '/leads',
    // Confirmes contre un extrait reel de /leads (statusid et salesrep sont
    // des codes/ID numeriques, affiches bruts pour l'instant - voir README).
    fieldId: process.env.IO_FIELD_ID || 'id',
    fieldStatus: process.env.IO_FIELD_STATUS || 'statusid',
    fieldAmount: process.env.IO_FIELD_AMOUNT || 'total',
    fieldRep: process.env.IO_FIELD_REP || 'salesrep',
    fieldDate: process.env.IO_FIELD_DATE || 'createtime',
    initialSyncDays: parseInt(process.env.IO_INITIAL_SYNC_DAYS, 10) || 400,
    statuses: IO_STATUSES,
    // Force le mode demo (chiffres de presentation) meme si de vraies cles
    // sont configurees - pratique pour activer/desactiver une presentation
    // sans toucher aux vraies cles (ex: pendant un blocage IP cote IO).
    // Valeur de secours au demarrage; le bouton "Réel/Démo" du dashboard
    // (via runtimeSettings, /api/settings/io-mode) prend le pas dessus une
    // fois utilise, sans avoir a changer de variable d'environnement.
    forceDemo: process.env.IO_FORCE_DEMO === 'true',
    get configured() {
      const override = runtimeSettings.getIoModeOverride();
      const forceDemo = override ? override === 'demo' : this.forceDemo;
      if (forceDemo) return false;
      return Boolean(this.baseUrl && this.apiKey && this.salesEndpoint);
    },
  },

  excel: {
    // Lien de partage OneDrive/SharePoint (vue) du fichier de stats de la
    // collègue - voir README section "Import Excel (OneDrive)" pour
    // comment l'obtenir.
    shareUrl: process.env.EXCEL_SHARE_URL || '',
    // Fenêtre de première synchro assez large pour couvrir les comparatifs
    // "vs l'an dernier" (2 ans).
    initialSyncDays: parseInt(process.env.EXCEL_INITIAL_SYNC_DAYS, 10) || 730,
    httpTimeoutMs: parseInt(process.env.EXCEL_HTTP_TIMEOUT_MS, 10) || 30000,
    get configured() {
      return Boolean(this.shareUrl);
    },
  },

  social: {
    facebook: {
      // Page Facebook: necessite un "Page Access Token" (longue duree) genere
      // via un compte Meta Business/Developer - voir README section "Réseaux
      // sociaux" pour la marche a suivre une fois pret a brancher le reel.
      pageId: process.env.FACEBOOK_PAGE_ID || '',
      accessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
      apiVersion: process.env.FACEBOOK_API_VERSION || 'v19.0',
      get configured() {
        return Boolean(this.pageId && this.accessToken);
      },
    },
    instagram: {
      // Compte Instagram Business/Creator relie a une Page Facebook -
      // l'API Instagram Graph (pas l'API "Basic Display", qui ne donne pas
      // les stats de followers) partage le meme token que la Page liee.
      businessAccountId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '',
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || '',
      apiVersion: process.env.INSTAGRAM_API_VERSION || 'v19.0',
      get configured() {
        return Boolean(this.businessAccountId && this.accessToken);
      },
    },
  },

  // Annee financiere: 1er octobre au 30 septembre.
  fiscalYearStartMonth: 9, // 0-indexed => octobre
};
