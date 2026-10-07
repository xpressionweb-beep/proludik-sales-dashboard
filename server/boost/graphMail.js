// Envoi de courriel via Microsoft Graph (Outlook / Microsoft 365).
//
// Utilise une app Entra ID en "client credentials" (aucun login interactif):
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET  -> l'app Entra
//   BOOST_MAIL_FROM                               -> la boîte qui envoie (ex: jerome@proludik.com)
// Permission requise sur l'app: Microsoft Graph > Application > Mail.Send,
// avec consentement administrateur. Voir README, section "Le Boost".

let cachedToken = null; // { value, expiresAt }

function isConfigured() {
  return !!(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.BOOST_MAIL_FROM);
}

async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Connexion Microsoft refusée: ${data.error_description || data.error || res.status}`);
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function sendMail({ to, subject, html }) {
  const token = await getToken();
  const from = encodeURIComponent(process.env.BOOST_MAIL_FROM);
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${from}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true, // le courriel apparaît dans "Éléments envoyés"
    }),
  });
  if (res.status !== 202) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch { /* corps vide */ }
    throw new Error(`Envoi refusé par Outlook (${res.status}) ${detail}`.trim());
  }
}

module.exports = { isConfigured, sendMail };
