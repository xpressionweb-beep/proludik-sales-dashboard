const config = require('../config');
const { generateSocialStats } = require('./socialMockData');

const PLATFORM = 'facebook';

// ATTENTION: fetchFromApi() ci-dessous est ecrit contre la documentation
// publique de l'API Graph de Meta (Pages + Insights), mais N'A PAS ETE
// TESTE contre un vrai compte/token - a valider avant de faire confiance
// aux chiffres en prod. Points les plus susceptibles de nécessiter un
// ajustement:
//   - Le nom des metriques d'insights (page_fan_adds, page_post_engagements)
//     change parfois de version d'API a l'autre chez Meta.
//   - "period=week" doit renvoyer le dernier point complet - a verifier que
//     ca correspond bien a "les 7 derniers jours" plutot qu'"la semaine
//     civile en cours".
//   - Necessite un "Page Access Token" longue duree (pas juste un token
//     utilisateur qui expire vite) - voir README section "Réseaux sociaux".
async function fetchFromApi() {
  const { pageId, accessToken, apiVersion } = config.social.facebook;
  const base = `https://graph.facebook.com/${apiVersion}/${pageId}`;

  const statsUrl = `${base}?fields=followers_count&access_token=${encodeURIComponent(accessToken)}`;
  const insightsUrl = `${base}/insights?metric=page_fan_adds,page_post_engagements&period=week&access_token=${encodeURIComponent(accessToken)}`;

  const [statsRes, insightsRes] = await Promise.all([
    fetch(statsUrl, { signal: AbortSignal.timeout(config.httpTimeoutMs) }),
    fetch(insightsUrl, { signal: AbortSignal.timeout(config.httpTimeoutMs) }),
  ]);

  if (!statsRes.ok) {
    const body = await statsRes.text().catch(() => '');
    throw new Error(`Facebook Graph API (page) ${statsRes.status}: ${body.slice(0, 300)}`);
  }
  if (!insightsRes.ok) {
    const body = await insightsRes.text().catch(() => '');
    throw new Error(`Facebook Graph API (insights) ${insightsRes.status}: ${body.slice(0, 300)}`);
  }

  const stats = await statsRes.json();
  const insights = await insightsRes.json();

  const followers = stats.followers_count || 0;
  const fanAdds = (insights.data || []).find((m) => m.name === 'page_fan_adds');
  const engagements = (insights.data || []).find((m) => m.name === 'page_post_engagements');
  const followersGrowth7d = fanAdds && fanAdds.values ? fanAdds.values.reduce((s, v) => s + (v.value || 0), 0) : 0;
  const engagement7d = engagements && engagements.values ? engagements.values.reduce((s, v) => s + (v.value || 0), 0) : 0;

  return {
    followers,
    followersGrowth7d,
    followersGrowthPct7d: followers ? (followersGrowth7d / followers) * 100 : 0,
    engagement7d,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchStats() {
  if (!config.social.facebook.configured) {
    return generateSocialStats({ seed: 201, baseFollowers: 4820, weeklyGrowthPct: 1.4, engagementRate: 6.5 });
  }

  return fetchFromApi();
}

module.exports = { fetchStats, PLATFORM };
