require('dotenv').config();

const IO_STATUSES = ['Confirmé', 'Soumission', 'Contrat/VFR'];

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  syncCron: process.env.SYNC_CRON || '*/30 * * * *',

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
    salesEndpoint: process.env.IO_SALES_ENDPOINT || '/api/sales',
    fieldId: process.env.IO_FIELD_ID || 'id',
    fieldStatus: process.env.IO_FIELD_STATUS || 'status',
    fieldAmount: process.env.IO_FIELD_AMOUNT || 'total',
    fieldRep: process.env.IO_FIELD_REP || 'representative',
    fieldDate: process.env.IO_FIELD_DATE || 'date',
    initialSyncDays: parseInt(process.env.IO_INITIAL_SYNC_DAYS, 10) || 400,
    statuses: IO_STATUSES,
    get configured() {
      return Boolean(this.baseUrl && this.apiKey);
    },
  },

  // Annee financiere: 1er octobre au 30 septembre.
  fiscalYearStartMonth: 9, // 0-indexed => octobre
};
