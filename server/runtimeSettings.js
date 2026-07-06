const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');
const VALID_MODES = ['demo', 'real'];

// Reglages modifiables au runtime (via l'API), persistes sur disque pour
// survivre a un redemarrage du serveur - sans avoir a changer de variables
// d'environnement ni a redeployer. Prend le pas sur IO_FORCE_DEMO une fois
// defini (voir config.js: io.configured).

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
}

// 'demo' | 'real' | null (null = pas d'override, se rabat sur IO_FORCE_DEMO).
function getIoModeOverride() {
  const mode = readSettings().ioMode;
  return VALID_MODES.includes(mode) ? mode : null;
}

function setIoModeOverride(mode) {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Mode IO invalide: "${mode}". Attendu: "demo" ou "real".`);
  }
  const settings = readSettings();
  settings.ioMode = mode;
  writeSettings(settings);
}

module.exports = { getIoModeOverride, setIoModeOverride };
