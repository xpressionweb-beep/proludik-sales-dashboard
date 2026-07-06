// Donnees d'exemple pour les cartes "Reseaux sociaux", utilisees tant que
// les vraies cles API (Facebook/Instagram) ne sont pas configurees. Meme
// esprit que mockData.js (ventes): chiffres stables entre redemarrages
// (PRNG determinist a graine fixe), clairement marques "mode demo" par
// l'appelant (voir server/connectors/facebook.js / instagram.js).

function makeRng(seed) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Genere des statistiques normalisees pour une plateforme sociale. La
// forme du retour est celle que devra aussi produire fetchFromApi() dans
// facebook.js/instagram.js une fois les vraies API branchees.
function generateSocialStats({ seed, baseFollowers, weeklyGrowthPct, engagementRate }) {
  const rng = makeRng(seed);
  const followers = Math.round(baseFollowers * (0.97 + rng() * 0.06));
  const followersGrowth7d = Math.round(followers * (weeklyGrowthPct / 100) * (0.7 + rng() * 0.6));
  const followersGrowthPct7d = (followersGrowth7d / followers) * 100;
  const engagement7d = Math.round(followers * (engagementRate / 100) * (0.7 + rng() * 0.6));

  return {
    followers,
    followersGrowth7d,
    followersGrowthPct7d,
    engagement7d,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { generateSocialStats };
