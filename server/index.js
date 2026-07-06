const path = require('path');
const express = require('express');
const config = require('./config');
const apiRoutes = require('./routes/api');
const scheduler = require('./scheduler');
const { logOutboundIp } = require('./diagnostics');

const app = express();

app.use(express.json());
app.use('/api', apiRoutes);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(config.port, () => {
  console.log(`Dashboard disponible sur http://localhost:${config.port}`);
  scheduler.start();
  logOutboundIp();
});
