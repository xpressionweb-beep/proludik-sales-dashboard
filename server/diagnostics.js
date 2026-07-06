const config = require('./config');

// Determine l'IP sortante du serveur via un service public d'echo IP.
// Utile pour verifier si l'IP de sortie a change apres un redeploiement
// (ex: Render), et pour la fournir a un fournisseur (rental.software) qui
// bloquerait l'acces par IP.
async function getOutboundIp() {
  const res = await fetch('https://api.ipify.org?format=json', {
    signal: AbortSignal.timeout(config.httpTimeoutMs),
  });
  if (!res.ok) throw new Error(`api.ipify.org a repondu ${res.status}`);
  const { ip } = await res.json();
  return ip;
}

async function logOutboundIp() {
  try {
    const ip = await getOutboundIp();
    console.log(`[diagnostic] IP sortante du serveur: ${ip}`);
  } catch (err) {
    console.warn(`[diagnostic] Impossible de determiner l'IP sortante: ${err.message}`);
  }
}

module.exports = { getOutboundIp, logOutboundIp };
