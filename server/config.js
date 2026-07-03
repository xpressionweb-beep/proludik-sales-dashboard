require('dotenv').config();

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
    get configured() {
      return Boolean(this.baseUrl && this.apiKey && this.salesEndpoint);
    },
  },

  // Annee financiere: 1er octobre au 30 septembre.
  fiscalYearStartMonth: 9, // 0-indexed => octobre
};
