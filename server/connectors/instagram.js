const config = require('../config');
const { generateSocialStats } = require('./socialMockData');

const PLATFORM = 'instagram';

// ATTENTION: fetchFromApi() ci-dessous est ecrit contre la documentation
// publique de l'API Graph Instagram (comptes Business/Creator lies a une
// Page Facebook), mais N'A PAS ETE TESTE contre un vrai compte/token - a
// valider avant de faire confiance aux chiffres en prod. Points les plus
// susceptibles de nécessiter un ajustement (l'API Insights Instagram est
// notoirement plus capricieuse que celle des Pages Facebook):
//   - Les metriques disponibles et leurs contraintes (since/until,
//     period) different selon la version d'API et le type de compte.
//   - "follower_count" en period=day peut necessiter un since/until
//     explicite plutot qu'un simple "period=week".
//   - Necessite l'API Graph Instagram (pas l'API "Basic Display", qui ne
//     donne pas les stats de followers) - voir README section
//     "Réseaux sociaux".
async function fetchFromApi() {
  const { businessAccountId, accessToken, apiVersion } = config.social.instagram;
  const base = `https://graph.facebook.com/${apiVersion}/${businessAccountId}`;

  const statsUrl = `${base}?fields=followers_count&access_token=${encodeURIComponent(accessToken)}`;
  const insightsUrl = `${base}/insights?metric=follower_count,reach&period=week&access_token=${encodeURIComponent(accessToken)}`;

  const [statsRes, insightsRes] = await Promise.all([
    fetch(statsUrl, { signal: AbortSignal.timeout(config.httpTimeoutMs) }),
    fetch(insightsUrl, { signal: AbortSignal.timeout(config.httpTimeoutMs) }),
  ]);

  if (!statsRes.ok) {
    const body = await statsRes.text().catch(() => '');
    throw new Error(`Instagram Graph API (account) ${statsRes.status}: ${body.slice(0, 300)}`);
  }
  if (!insightsRes.ok) {
    const body = await insightsRes.text().catch(() => '');
    throw new Error(`Instagram Graph API (insights) ${insightsRes.status}: ${body.slice(0, 300)}`);
  }

  const stats = await statsRes.json();
  const insights = await insightsRes.json();

  const followers = stats.followers_count || 0;
  const followerGrowthMetric = (insights.data || []).find((m) => m.name === 'follower_count');
  const reachMetric = (insights.data || []).find((m) => m.name === 'reach');
  const followersGrowth7d = followerGrowthMetric && followerGrowthMetric.values
    ? followerGrowthMetric.values.reduce((s, v) => s + (v.value || 0), 0)
    : 0;
  const engagement7d = reachMetric && reachMetric.values ? reachMetric.values.reduce((s, v) => s + (v.value || 0), 0) : 0;

  return {
    followers,
    followersGrowth7d,
    followersGrowthPct7d: followers ? (followersGrowth7d / followers) * 100 : 0,
    engagement7d,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchStats() {
  if (!config.social.instagram.configured) {
    return generateSocialStats({ seed: 202, baseFollowers: 3190, weeklyGrowthPct: 2.1, engagementRate: 8.2 });
  }

  return fetchFromApi();
}

module.exports = { fetchStats, PLATFORM };
