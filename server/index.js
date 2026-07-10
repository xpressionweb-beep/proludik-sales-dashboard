const path = require('path');
const express = require('express');
const config = require('./config');
const apiRoutes = require('./routes/api');
const notifyRoutes = require('./routes/notify');
const scheduler = require('./scheduler');
const { logOutboundIp } = require('./diagnostics');
const basicAuth = require('./basicAuth');

const app = express();

// En premier, avant tout le reste: si DASHBOARD_USER/DASHBOARD_PASSWORD
// sont configures, protege tout ce qui suit (API et fichiers statiques).
// No-op si les variables ne sont pas definies.
app.use(basicAuth);

app.use(express.json());
app.use('/api', apiRoutes);
app.use('/api/notify', notifyRoutes);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(config.port, () => {
  console.log(`Dashboard disponible sur http://localhost:${config.port}`);
  scheduler.start();
  logOutboundIp();
});
