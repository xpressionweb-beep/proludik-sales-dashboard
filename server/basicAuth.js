const crypto = require('crypto');
const config = require('./config');

// Comparaison a temps constant pour eviter qu'un attaquant deduise le mot
// de passe correct par la difference de temps de reponse. Les deux
// entrees sont hachees d'abord: ca donne des buffers de meme longueur
// meme quand les chaines d'origine different en longueur (sinon la
// difference de longueur elle-meme fuiterait de l'info).
function safeEqual(a, b) {
  const hash = (v) => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

// Chemins publics: la page de confirmation (ouverte depuis un lien de
// notification Pushover sur le telephone du destinataire) et ses deux
// routes API ne doivent PAS exiger les identifiants du dashboard, sinon
// l'employe se retrouve avec une demande de login qu'il n'a pas.
const PUBLIC_PATHS = [/^\/confirm\.html$/, /^\/api\/notify\/[^/]+\/(status|ack)$/];

function isPublicPath(path) {
  return PUBLIC_PATHS.some((re) => re.test(path));
}

// Protection HTTP Basic Auth sur tout le dashboard (pages statiques +
// routes API), activee uniquement quand DASHBOARD_USER et
// DASHBOARD_PASSWORD sont tous les deux configures (config.auth.enabled) -
// pour ne jamais bloquer le developpement local par defaut.
function basicAuth(req, res, next) {
  if (!config.auth.enabled) return next();
  if (isPublicPath(req.path)) return next();

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sepIndex = decoded.indexOf(':');
    const user = sepIndex === -1 ? decoded : decoded.slice(0, sepIndex);
    const password = sepIndex === -1 ? '' : decoded.slice(sepIndex + 1);

    if (safeEqual(user, config.auth.user) && safeEqual(password, config.auth.password)) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Proludik Dashboard"');
  res.status(401).send('Authentification requise.');
}

module.exports = basicAuth;
