# Proludik Sales Dashboard

Petit serveur Node.js qui synchronise les ventes **InflatableOffice (IO)** et
**Shopify** toutes les 30 minutes, et sert un dashboard web pour les
consulter.

## Fonctionnalités

- Synchronisation automatique (cron, par défaut `*/30 * * * *`) + bouton
  "Synchroniser maintenant" dans le dashboard. Chaque requête HTTP a un
  timeout (`HTTP_TIMEOUT_MS`, 20s par défaut) + garde-fou global par source
  (`SYNC_WATCHDOG_MS`, 120s) pour qu'une connexion accrochée (réseau, rate-limit)
  échoue proprement au lieu de bloquer indéfiniment la sync et les cycles
  cron suivants.
- Stockage local simple (fichiers JSON dans `data/`), aucune base de données
  externe requise.
- Dashboard web (thème sombre navy/rouge, police Barlow) :
  - Bandeau de métriques rapides (contrats/ventes du jour, % vs hier).
  - 4 grandes cartes avec sparkline : Cette semaine / Ce mois / Année
    financière (comparées à **la même période l'an dernier**, pas la
    période précédente) + Objectif annuel (chiffre réel, config/objectifs.json).
  - 3 compteurs de statut IO (Confirmés / Soumissions / VRF-Contrats) vs
    année fiscale précédente.
  - Tableau "Performance des représentants" (par statut, conversion,
    objectif, progression, score) + ligne "Boutique Shopify" distincte.
  - Panneau "Activité récente" — dernières ventes réelles synchronisées.
  - Section "Réseaux sociaux" (Facebook / Instagram) — abonnés, croissance,
    engagement (voir section dédiée plus bas).
  - Année financière = **1er octobre → 30 septembre**.
- **Mode démo (mock)** : si les identifiants Shopify, InflatableOffice,
  Facebook ou Instagram ne sont pas configurés, le connecteur correspondant
  génère des données d'exemple, pour pouvoir tester le serveur et le
  dashboard immédiatement.
- **Protection par mot de passe** (optionnelle) : `DASHBOARD_USER` /
  `DASHBOARD_PASSWORD` (voir section dédiée).

## Installation

```bash
npm install
cp .env.example .env
# éditez .env avec vos identifiants Shopify / InflatableOffice
npm start
```

Le dashboard est servi sur `http://localhost:3000` (port configurable via
`PORT` dans `.env`).

## Protection par mot de passe

Le dashboard n'a **aucune authentification par défaut** (pratique pour le
développement local). Pour le protéger (recommandé avant tout déploiement
public, ex. Render) : renseignez **les deux** variables suivantes dans
`.env` (ou dans les variables d'environnement Render) :

```
DASHBOARD_USER=un_nom_utilisateur
DASHBOARD_PASSWORD=un_mot_de_passe_solide
```

Une fois les deux configurées, **tout** le dashboard (les pages ET les
routes API `/api/*`) exige une authentification HTTP Basic — le
navigateur affiche une boîte de dialogue standard nom d'utilisateur/mot
de passe. Tant qu'une des deux variables est vide/absente, aucune
authentification n'est demandée (comportement inchangé). Voir
`server/basicAuth.js` (comparaison à temps constant, pour éviter qu'un
attaquant devine le mot de passe via le temps de réponse) et
`server/index.js` (monté avant toute autre route, pour que **rien** ne
soit accessible sans authentification une fois activée).

**Limite** : HTTP Basic Auth n'est sécuritaire que par-dessus HTTPS
(les identifiants sont encodés en base64, pas chiffrés) — Render fournit
HTTPS automatiquement, donc c'est couvert en production, mais évitez d'y
accéder en HTTP simple (ex. réseau local non chiffré).

## Configuration des identifiants

Voir `.env.example` pour la liste complète. En résumé :

- **Shopify** : `SHOPIFY_SHOP` (ex: `my-shop.myshopify.com`), puis :
  - App legacy (créée avant le Dev Dashboard, avant janvier 2026) :
    `SHOPIFY_ACCESS_TOKEN` (token Admin API statique).
  - App créée via le **Dev Dashboard** Shopify (depuis janvier 2026) : ces
    apps n'ont plus de token statique — le serveur utilise automatiquement
    le flux OAuth **client credentials grant**
    (`POST /admin/oauth/access_token`) avec `SHOPIFY_CLIENT_ID` et
    `SHOPIFY_CLIENT_SECRET`. Le token obtenu est mis en cache en mémoire et
    rafraîchi automatiquement (il expire après ~24h). Voir
    `server/connectors/shopify.js` (`getAccessToken`).
- **InflatableOffice** (= plateforme **rental.software**, API6) :
  `IO_API_BASE_URL` (ex: `https://rental.software/api6`) et `IO_API_KEY`.
  D'après la documentation publique de rental.software, l'authentification se
  fait par paramètre de requête `?apiKey=...` (pas un header
  `Authorization: Bearer`) — c'est ce que fait
  `server/connectors/inflatableOffice.js`. Les listes paginées suivent le
  format `{ offset, limit, next, items: [...] }`, géré automatiquement — le
  lien `next` est construit par le serveur rental.software et ne reprend
  pas notre `apiKey` : `withApiKey()` le réinjecte avant chaque page
  suivante (bug corrigé qui causait un 401 "No API Key provided" dès qu'il
  y avait plus d'une page de résultats).
  **Endpoint des ventes** : ce compte IO n'a pas de module "sales"/"orders"
  séparé — c'est le module **Leads** (contrats + paiements, confirmé via la
  permission "Lead Payments") qui en tient lieu. `IO_SALES_ENDPOINT` pointe
  donc par défaut vers `/leads`. `IO_API_BASE_URL` et `IO_SALES_ENDPOINT`
  sont joints via `buildEndpointUrl()` (pas `new URL(endpoint, baseUrl)`, qui
  supprime silencieusement tout segment de chemin de `baseUrl` si `endpoint`
  commence par `/` — bug corrigé qui causait un 404 en prod, ex:
  `https://host/api6` + `/leads` devenait `https://host/leads`).

  **Noms des champs confirmés** contre un extrait réel de `/leads` :
  `IO_FIELD_ID=id`, `IO_FIELD_STATUS=statusid`, `IO_FIELD_AMOUNT=total`,
  `IO_FIELD_REP=salesrep`, `IO_FIELD_DATE=createtime`.

  **Mapping des statuts** (`STATUS_LABELS` dans
  `server/connectors/inflatableOffice.js`) — table partielle confirmée par
  le client :
  | `statusid` | Libellé affiché |
  |---|---|
  | `40213` | Soumission |
  | `40215` | Contrat/VFR |
  | `40217` | Confirmé |
  | `127955` | Contrat/VFR |

  `40215` ("Contrat") et `127955` ("VFR/Cont.") sont deux codes IO distincts
  qui se regroupent tous les deux sous le bucket dashboard "Contrat/VFR".
  Tout `statusid` absent de cette table est affiché tel quel (code brut) et
  tombe donc dans le seau **"Autre"** du dashboard — à compléter dans
  `STATUS_LABELS` au fur et à mesure que d'autres codes sont identifiés.

  **Mapping des représentants** (`REP_LABELS` dans
  `server/connectors/inflatableOffice.js`) — table partielle confirmée par
  le client :
  | `salesrep` | Nom affiché |
  |---|---|
  | `80769` | Mathis Beaupré |
  | `80773` | Cedric Paré |
  | `81675` | Jerome Goulet |
  | `171955` | Didier Paradis |

  Ces noms correspondent exactement aux clés de `config/objectifs.json`
  (vérifié : les 4 représentants ont un objectif non-`null` dans
  `/api/reps`). Tout `salesrep` absent de cette table est affiché tel quel
  (ID brut) — son objectif restera `null`/`—` tant qu'il n'est pas ajouté
  aux deux fichiers (`REP_LABELS` et `config/objectifs.json`).

  Les deux mappings (statut et représentant) sont vérifiés avec un serveur
  fixture local reproduisant la forme réelle de `/leads` (auth réelle
  bloquée depuis cet environnement de développement) — à compléter au fur
  et à mesure que d'autres codes/ID sont identifiés.

Tant qu'un des deux connecteurs n'est pas configuré, il tourne en mode démo
(données d'exemple) — un badge "mode démo" apparaît dans le dashboard pour
cette source.

## Fiabilité de la synchronisation (timeouts)

Le `fetch()` natif de Node n'a **pas de timeout par défaut** : si une
connexion reste ouverte sans jamais répondre (blip réseau, rate-limit qui
ne ferme pas la socket), l'appel restait bloqué indéfiniment — ce qui
gelait le flag `running` du scheduler et faisait sauter tous les cycles
cron suivants ("déjà en cours"). Deux niveaux de protection :

1. **Timeout par requête** (`HTTP_TIMEOUT_MS`, 20s par défaut) via
   `AbortSignal.timeout()` sur chaque appel `fetch()` (Shopify et IO,
   y compris l'obtention du token OAuth).
2. **Garde-fou global par source** (`SYNC_WATCHDOG_MS`, 120s) dans
   `server/services/sync.js` (`withWatchdog`) : même en cas de blocage
   imprévu ailleurs (ex. pagination qui boucle sans jamais lever
   d'erreur), la sync de cette source échoue proprement après ce délai au
   lieu de bloquer indéfiniment. Un plafond de 500 pages
   (`MAX_PAGES`) protège aussi contre une pagination "next" qui
   bouclerait sur elle-même.

Vérifié avec un serveur fixture qui accepte la connexion mais ne répond
jamais : la sync échoue proprement après le timeout (au lieu de bloquer),
et le cycle suivant s'exécute normalement (pas de "déjà en cours").

### Diagnostic : IP sortante du serveur

Si l'API IO fonctionne depuis un navigateur normal mais échoue
systématiquement en timeout depuis Render, ça peut indiquer un blocage par
IP côté rental.software (leur pare-feu n'autorise pas l'IP sortante de
Render). Pour vérifier/fournir cette IP :

- **Au démarrage** : loggée automatiquement (`server/diagnostics.js`,
  appelé dans `server/index.js`), ex. `[diagnostic] IP sortante du
  serveur: 34.XX.XX.XX` — visible dans les logs Render, y compris après
  chaque redéploiement (l'IP peut changer).
- **À la demande** : `GET /api/diagnostics/ip` — pratique pour vérifier
  sans fouiller les logs.

Cette IP est celle à fournir au support rental.software si le blocage est
confirmé de leur côté (allowlist IP à ajuster).

## Mode démo InflatableOffice (présentation)

Tant que `IO_API_BASE_URL`/`IO_API_KEY` ne sont pas configurés — **ou que
`IO_FORCE_DEMO=true`** (force le mode démo même si de vraies clés
fonctionnelles sont présentes, ex. sur Render pendant un blocage IP côté
IO — voir "Diagnostic : IP sortante du serveur" — pratique pour
activer/désactiver une présentation sans toucher aux vraies clés) — le
mode démo IO génère des **chiffres précis** pour l'année financière en
cours (pas des montants aléatoires), pour une présentation :

| Représentant | Confirmés | Soumissions | VRF/Contrats |
|---|---|---|---|
| Cedric Paré | 680 000 $ | 350 000 $ | 150 450 $ |
| Mathis Beaupré | 300 000 $ | 175 600 $ | 50 000 $ |
| Didier Paradis | 320 000 $ | 180 200 $ | 53 000 $ |
| Jerome Goulet | 110 000 $ | 60 054 $ | 23 000 $ |

(Total IO : 2 452 304 $ pour l'année financière en cours — voir
`PRESENTATION_TARGETS` dans `server/connectors/mockData.js`.) Ces montants
sont répartis sur plusieurs "ventes" individuelles réalistes entre le
début de l'année financière et aujourd'hui
(`generateIoPresentationSales()`), pour que les sparklines et l'activité
récente aient l'air normales. Les périodes **avant** le début de l'année
financière (utilisées pour les comparatifs "vs l'an dernier") utilisent
toujours l'ancien générateur aléatoire générique.

**Le badge "Activité récente" bascule automatiquement en "Mode démo"**
(couleur ambre) dès que la source IO tourne en mode démo — pour que ce
soit toujours visuellement évident que les données affichées ne sont pas
100% réelles. (Il suit spécifiquement l'état IO, pas Shopify — le statut
de Shopify reste visible séparément dans le pied de page du dashboard.)

### Bouton "Réel / Démo" (recommandé)

Un bouton dans le header (à côté du bouton clair/sombre) bascule entre les
deux modes **sans redéployer ni toucher aux variables d'environnement**.
Contrairement au thème (purement visuel, mémorisé côté navigateur), ce
bouton change un vrai comportement serveur :

- **Réel** : le connecteur IO utilise `IO_API_BASE_URL`/`IO_API_KEY`
  comme d'habitude.
- **Démo** : force les chiffres de présentation ci-dessus, peu importe si
  de vraies clés sont configurées.

L'état est géré côté serveur (`server/runtimeSettings.js`), persisté dans
`data/settings.json` (survit à un redémarrage du serveur), et **prend le
pas sur `IO_FORCE_DEMO`** dès qu'il a été utilisé une première fois. Un
clic déclenche aussi une resynchronisation immédiate (pas besoin d'attendre
le prochain cycle cron de 30 minutes). Endpoints : `GET /api/settings/io-mode`
(état actuel) et `POST /api/settings/io-mode` (`{ "mode": "demo" | "real" }`).

**Si une synchronisation précédente est bloquée** (ex: attend le timeout
d'une API IO injoignable, jusqu'à `SYNC_WATCHDOG_MS`) au moment du clic,
la nouvelle demande **n'est jamais ignorée** : elle est mise en file
d'attente (`server/scheduler.js`, chaînage de promesses — jamais de "déjà
en cours, on saute" silencieux) et se déclenche automatiquement dès que la
sync bloquée se termine. La requête HTTP elle-même n'attend pas plus de
4 secondes (`QUICK_SYNC_MS` dans `server/routes/api.js`) : au-delà, elle
répond immédiatement avec `queued: true` (le changement de mode est déjà
appliqué, mais les données affichées ne seront à jour qu'une fois la sync
en attente terminée) plutôt que de faire pendre le navigateur. Le
dashboard affiche alors un message temporaire dans le pied de page pour
prévenir que ce n'est pas encore appliqué aux données. Interruption
immédiate de la sync bloquée (plutôt que mise en file d'attente) a été
envisagée mais écartée pour l'instant — nécessiterait de faire circuler un
`AbortController` dans tous les connecteurs, plus risqué pour un gain
limité (l'attente est de toute façon bornée par `SYNC_WATCHDOG_MS`).

Si vous demandez le mode "Réel" mais qu'aucune vraie clé IO fonctionnelle
n'est configurée, le serveur reste honnêtement en "Démo" (impossible de
faire une vraie sync sans vraies clés) — le bouton et le badge reflètent
alors l'état réel, pas ce qui a été demandé.

`IO_FORCE_DEMO` (variable d'environnement, voir plus haut) reste utile
comme **valeur de démarrage par défaut** avant toute utilisation du
bouton, ou pour un contrôle par déploiement (ex. CI/CD) plutôt que manuel.

Pour revenir à l'ancien mock générique (aléatoire) plutôt qu'aux chiffres
de présentation : dans `server/connectors/inflatableOffice.js`
(`fetchSales`), retirer l'appel à `generateIoPresentationSales()` et
repasser `generateMockSales()` sur toute la période comme avant (voir
l'historique git de ce fichier).

Basculer entre Réel et Démo ne mélange pas les données : à chaque sync,
si la source (`shopify` ou `io`) est détectée en mode mock, ses
enregistrements sont entièrement remplacés (pas d'upsert) par le lot
généré — voir `db.replaceSourceSales()` et `services/sync.js`. Les
éventuels enregistrements laissés par une tentative réelle précédente (ou
par une ancienne génération de données de démo) sont donc purgés
automatiquement dès la prochaine sync en mode mock, sans intervention
manuelle. Seul le mode Réel continue d'utiliser un upsert incrémental
(`sinceIso`), pour ne jamais perdre l'historique des ventes déjà
récupérées.

## Objectifs de vente par représentant

Fichier `config/objectifs.json` : objectif annuel par représentant et par
année financière (ex. `"2025-2026": 673003`). Le mensuel et l'hebdomadaire
sont calculés automatiquement (annuel / 12 et annuel / 52). Ce fichier est
relu à chaque requête — pas besoin de redémarrer le serveur après une
modification.

Les noms des 4 représentants (`Mathis Beaupré`, `Cedric Paré`,
`Jerome Goulet`, `Didier Paradis`) correspondent aux vrais représentants IO
(voir `REP_LABELS` ci-dessus). Les objectifs annuels 2025-2026 sont les
vrais chiffres fournis par le client ; **2024-2025 reste un exemple
placeholder** (non fourni, non utilisé par le dashboard aujourd'hui — voir
plus bas).

### Objectif boutique Shopify

`config/objectifs.json` a aussi une clé `shopify` (annuel par année
financière, ex. `"2025-2026": 200000`), **distincte des représentants** :
les ventes Shopify ne sont pas attribuées à un représentant, donc cet
objectif compare le **total des ventes Shopify de la période** (pas une
somme par personne) à sa propre cible. Affiché comme dernière ligne
("Boutique Shopify") du tableau "Performance des représentants" — mêmes
colonnes Objectif/Progression/Score que les représentants, mais
Confirmés/Soumissions/VRF-Contrats/Conversion affichés en `—` (ces
statuts IO ne s'appliquent pas à une vente Shopify).

### Objectif annuel global (carte "Objectif annuel")

`config/objectifs.json` a une clé `global` (ex. `"2025-2026": 3200000`) —
**chiffre réel fourni par le client**, indépendant de la somme des
objectifs individuels ci-dessus (ce n'est pas un total calculé). Comparé
au total réel de vente de l'année financière en cours
(`getGlobalObjective()` dans `server/services/aggregate.js`).

## Formules utilisées dans le tableau des représentants

- **Conversion** = montant "Confirmé" du représentant ÷ montant total du
  représentant × 100. Définition maison (pas de standard fourni par le
  client) — à ajuster si une autre formule est souhaitée.
- **Score** (anneau coloré) = **même valeur** que la barre "Progression"
  (% de l'objectif annuel proratisé). Choix délibéré pour ne pas inventer
  une deuxième métrique sans définition — voir section suivante.

## Compteurs Confirmés / Soumissions / VRF-Contrats / Conversion moyenne

Les 4 cartes sous les grandes cartes (`/api/status-counts-7d` et
`/api/rep-conversion-summary`) :

- **Confirmés / Soumissions / VRF/Contrats** : comptes sur une **fenêtre
  glissante de 7 jours** (les 7 derniers jours, aujourd'hui inclus — PAS
  la semaine calendaire ISO utilisée ailleurs), comparés aux 7 jours
  précédents. `getBounds('rolling7', offset)` dans
  `server/services/aggregate.js`, distinct du type `'week'` (ancré au
  lundi).
- **Limite connue** : on ne trace pas l'historique des changements de
  statut — chaque vente IO n'a qu'une seule date (`orderDate`, mappée
  depuis le champ IO `createtime`, la date de création du lead) et un seul
  statut actuel (le dernier connu, mis à jour à chaque sync par upsert).
  "Confirmés passés au statut Confirmé dans les 7 derniers jours" est donc
  approximé par *statut = Confirmé ET créé dans les 7 derniers jours* —
  la meilleure approximation possible sans historique de statuts détaillé
  côté IO.
- **"Soumissions actuellement ouvertes"** ne nécessite **aucune logique
  de filtrage supplémentaire** pour exclure celles converties depuis :
  chaque sync écrase le statut d'un enregistrement par son statut ACTUEL
  (upsert par `externalId`) — si une soumission a été convertie en
  Confirmé/Contrat-VFR depuis sa création, son statut stocké est déjà
  passé à ce nouveau statut. Filtrer par `statut = Soumission` suffit donc
  à ne garder que celles encore ouvertes.
- **Conversion moyenne** : moyenne arithmétique simple (pas pondérée par
  volume) des taux de conversion individuels des **4 représentants IO
  connus** (`config/objectifs.json`), sur l'année financière en cours —
  même définition et mêmes chiffres que la colonne "Conversion" du
  tableau des représentants. Exclut la "Boutique Shopify" (pas de
  représentant) et tout ID de représentant non mappé.

## Comparaisons "année précédente" (grandes cartes)

Les 4 grandes cartes comparent **la même période l'an dernier**, pas la
période immédiatement précédente : semaine → 52 semaines en arrière, mois
→ même mois l'an dernier, année → année financière précédente
(`getYoY()` dans `server/services/aggregate.js`, endpoint `/api/yoy`).
Différent de `/api/overview` (`getOverview()`), qui compare toujours à la
période immédiatement précédente (utilisé pour le bandeau "vs hier" et
disponible pour d'éventuels futurs besoins).

## Sparklines (mini-graphiques des grandes cartes)

`getTrend(cardType)` (`/api/trend?card=week|month|year`) découpe la
période de chaque carte en sous-unités réelles, à partir des vraies ventes
stockées — aucune donnée simulée :

- **Cette semaine** : un point par jour de la semaine calendaire en cours
  (jusqu'à aujourd'hui).
- **Ce mois** : 5 semaines calendaires (lundi-dimanche) — les 2
  précédentes, la semaine en cours, et les 2 suivantes — avec le numéro de
  semaine ISO 8601 (`isoWeekNumber()`) affiché sous chaque barre. La
  semaine en cours est mise en évidence (`current: true`).
- **Année financière** : 13 mois civils — les 6 précédents, le mois en
  cours, et les 6 suivants — avec le mois affiché sous chaque barre. Peut
  donc déborder sur l'année financière adjacente aux deux bouts. Le mois
  en cours est mis en évidence.

Les semaines/mois futurs peuvent afficher 0 $ (aucune vente n'existe
encore pour cette période) — c'est honnête, pas un bug.

### Paliers de couleur (score, cartes compteurs)

Les 4 cartes compteurs (Confirmés/Soumissions/VRF-Contrats/Conversion
moyenne) affichent un point de couleur, et la colonne "Score" du tableau
des représentants (ainsi que sa barre de progression) est colorée selon
le même seuil : **vert** ≥ 100 %, **jaune** 75-99 %, **rouge** < 75 %,
**gris** si aucune comparaison n'est possible. Pour les 3 cartes de
statut, le pourcentage comparé est le ratio "7 derniers jours / 7 jours
précédents" (100 % = au moins autant que la période précédente) ; pour
"Conversion moyenne" et pour le Score, c'est directement le pourcentage
affiché. Voir `tierClass()` dans `public/dashboard.js`.

## Colonne de gauche (sidebar) et logo

La sidebar reste **toujours** en bleu Proludik (`--brand-navy`), peu
importe le thème clair/sombre choisi pour le reste du dashboard — ses
couleurs sont codées en dur dans `styles.css` plutôt que liées aux
variables de thème. Le logo utilisé (`assets/proludik_h_rouge_blanc.png`,
blanc/rouge, pensé pour un fond foncé) est donc lui aussi fixe et ne
bascule plus avec le thème (voir `initBrandLogo()` dans `dashboard.js`).

## Activité récente

Le panneau "Activité récente" (`/api/activity`) liste les ventes réelles
les plus récentes (toutes sources confondues), pas un flux d'événements
fabriqué — voir `getRecentActivity()`.

## Réseaux sociaux

Section "Réseaux sociaux" du dashboard (cartes Facebook / Instagram) :
abonnés, croissance (7 jours), engagement (7 jours). **Données de démo**
tant que les vraies clés API ne sont pas configurées (badge "Mode démo"
sur chaque carte, comme pour Shopify/IO) — voir `FACEBOOK_*`/`INSTAGRAM_*`
dans `.env.example`.

**Architecture pensée pour brancher les vraies API plus tard** :
`server/connectors/facebook.js` et `instagram.js` suivent exactement le
même patron que `shopify.js`/`inflatableOffice.js` — une fonction
`fetchStats()` qui retourne des données de démo (`socialMockData.js`) tant
que `config.social.<plateforme>.configured` est faux, sinon appelle
`fetchFromApi()`. `GET /api/social` combine les deux (indépendamment —
`Promise.allSettled`, une erreur sur l'une n'empêche pas l'affichage de
l'autre) et retourne aussi un flag `mock` par plateforme.

**`fetchFromApi()` est déjà écrit** (contre la documentation publique de
l'API Graph de Meta — Pages Facebook + comptes Instagram Business/Creator
liés), **mais n'a jamais été testé contre un vrai compte/token** — à
valider avant de faire confiance aux chiffres en production. Points les
plus susceptibles de nécessiter un ajustement (voir les commentaires
"ATTENTION" en tête de chaque fichier) :
- Le nom exact des métriques d'insights (`page_fan_adds`,
  `page_post_engagements`, `follower_count`, `reach`) change parfois de
  version d'API à l'autre chez Meta — l'API Insights Instagram en
  particulier est notoirement plus capricieuse que celle des Pages
  Facebook (contraintes `since`/`until` selon le type de compte).
- Nécessite un **Page Access Token longue durée** (pas un token
  utilisateur qui expire vite) — généré via Meta Business Suite ou le
  Graph API Explorer avec les permissions `pages_read_engagement` et
  `instagram_basic`/`instagram_manage_insights`.

Aucune synchronisation périodique ni stockage pour ces données — contrairement
aux ventes (Shopify/IO), `/api/social` interroge à chaque chargement du
dashboard (snapshot, pas des transactions à historiser).

## Métriques non disponibles (affichées honnêtement)

Ces éléments de la maquette originale n'ont pas de source de données
actuellement et sont affichés comme "Bientôt disponible" (bandeau du haut)
ou avec un message explicite (panneau "Alertes"), plutôt que d'inventer un
chiffre :
- Soumissions sans suivi, paiements en retard, % livraisons complétées
  (bandeau de métriques rapides).
- Alertes (soumissions sans suivi, contrats sans dépôt, retard
  installations) — nécessiteraient un suivi commercial, des dépôts et un
  calendrier d'installation qu'on ne synchronise pas aujourd'hui.

## Thème clair / sombre

Bouton de bascule dans le header (icône soleil/lune, à droite). Même
structure, mêmes composants, mêmes données dans les deux thèmes — seules
les couleurs changent (variables CSS dans `public/styles.css`, bloc
`:root[data-theme="light"]`). Le rouge de marque (`--brand-red`) et le
navy (`--brand-navy`) restent identiques dans les deux thèmes ; le thème
clair utilise en plus une légère ombre portée sur les cartes
(`--card-shadow`). Le choix est mémorisé dans `localStorage` (thème sombre
par défaut si jamais choisi).

## Logo

Le header référence deux fichiers, un par thème (`THEME_LOGO_PATHS` dans
`public/dashboard.js`) :
- `public/assets/proludik_h_rouge_blanc.png` — thème sombre (texte blanc)
- `public/assets/proludik_h_rouge_navy.png` — thème clair (texte navy/rouge)

**Aucun des deux fichiers n'est encore dans le dépôt** — déposez-les à ces
chemins exacts (voir `public/assets/README.md`). Tant qu'un fichier est
absent, un logo de repli ("P" + "PROLUDIK" en CSS, couleur adaptée au
thème actif) s'affiche automatiquement pour ce thème ; aucune modification
de code n'est nécessaire une fois les vrais fichiers commités.

La police **Barlow** est chargée depuis Google Fonts (`fonts.googleapis.com`)
— nécessite un accès réseau sortant vers ce domaine en production (normal
sur Render ; peut échouer dans un environnement de développement à accès
réseau restreint, avec repli sur la police système).

## Statuts InflatableOffice suivis

`Confirmé`, `Soumission`, `Contrat/VFR`. Tout autre statut retourné par l'API
est regroupé sous "Autre" dans le dashboard.

## Structure du projet

```
server/
  index.js            point d'entrée Express
  config.js           lecture des variables d'environnement
  db.js                stockage JSON (data/sales.json, data/meta.json)
  scheduler.js         cron (toutes les 30 min) + sync au démarrage
  diagnostics.js       IP sortante du serveur (voir section dédiée)
  runtimeSettings.js   override runtime du mode IO (data/settings.json)
  basicAuth.js         middleware HTTP Basic Auth (DASHBOARD_USER/PASSWORD)
  connectors/
    shopify.js          connecteur Shopify Admin API
    inflatableOffice.js  connecteur IO (générique, à ajuster selon la vraie API)
    mockData.js          générateur de données de démo (ventes)
    facebook.js           connecteur Facebook Graph API (non testé, voir README)
    instagram.js          connecteur Instagram Graph API (non testé, voir README)
    socialMockData.js     générateur de données de démo (réseaux sociaux)
  services/
    sync.js              orchestre les deux connecteurs + upsert en base
    aggregate.js          calcul des périodes (semaine/mois/année fiscale) et agrégats
  routes/
    api.js                endpoints REST (/api/overview, /api/reps, /api/meta, /api/sync)
public/
  index.html, styles.css, dashboard.js   dashboard web (vanilla JS, sans build)
  assets/               logo (voir section Logo ci-dessus)
config/
  objectifs.json          objectifs de vente (représentants, Shopify, global)
```

## API

- `GET /api/overview` — totaux par statut/source pour jour, semaine, mois,
  année fiscale (actuel vs période **immédiatement précédente** + variation %).
- `GET /api/yoy` — pareil, mais vs **la même période l'an dernier**
  (utilisé par les 4 grandes cartes du dashboard).
- `GET /api/reps?period=week|month|year&offset=0` — ventes par
  représentant sur la période (par statut IO, conversion, objectif
  proratisé, %) + ligne `shopify` distincte.
- `GET /api/objective` — objectif annuel global vs total réel de l'année
  financière en cours.
- `GET /api/status-counts-7d` — comptes Confirmés/Soumissions/VRF-Contrats
  sur 7 jours glissants vs les 7 jours précédents.
- `GET /api/rep-conversion-summary` — taux de conversion moyen des 4
  représentants IO connus.
- `GET /api/trend?card=week|month|year` — série de points réels pour la
  sparkline de la carte correspondante.
- `GET /api/activity?limit=8` — les N ventes réelles les plus récentes.
- `GET /api/meta` — état de la dernière synchronisation par source (dernier
  succès, erreurs, mode démo). Inclut aussi, par source, `requestedSinceIso`
  (depuis quand la sync a demandé des données), `oldestRecordDate` /
  `newestRecordDate` (l'étendue réelle des enregistrements reçus) et
  `lastRecordCount`. Utile pour diagnostiquer un écart entre les vraies
  données du fournisseur (ex: Shopify Analytics) et le dashboard : si
  `oldestRecordDate` est nettement plus récent que `requestedSinceIso`,
  l'API du fournisseur limite l'accès à l'historique (ex: Shopify sans le
  scope `read_all_orders` approuvé ne renvoie que les commandes des ~60
  derniers jours, peu importe la date demandée) — un avertissement est
  aussi loggé côté serveur (`[sync] shopify: donnees demandees depuis...`)
  dans ce cas. Voir `dateRange()` dans `server/services/sync.js`.
- `POST /api/sync` — déclenche une synchronisation manuelle immédiate.
- `POST /api/admin/reset-sync?source=shopify|io` — force une
  resynchronisation **complète** d'une source (efface `lastSuccessAt` de
  cette source dans `data/meta.json`, donc le prochain cycle repart de
  `initialSyncDays` au complet plutôt que de la dernière sync
  incrémentale), puis déclenche une sync immédiate. Utile après une
  correction d'accès côté fournisseur (ex: scope Shopify
  `read_all_orders` approuvé après coup — voir la section `/api/meta`
  ci-dessus). Ne supprime **pas** les ventes déjà stockées : le prochain
  sync les met à jour par upsert (même `externalId`), sans doublons.
  Protégé par la même auth Basic que le reste du dashboard.
- `GET /api/diagnostics/ip` — IP sortante du serveur (voir section
  "Diagnostic : IP sortante du serveur").
- `GET /api/settings/io-mode` — mode IO effectif actuel (`{ "mode":
  "demo" | "real" }`).
- `POST /api/settings/io-mode` (`{ "mode": "demo" | "real" }`) — bascule
  le mode IO au runtime et resynchronise immédiatement (voir "Bouton
  Réel / Démo").
- `GET /api/social` — statistiques Facebook/Instagram (voir section
  "Réseaux sociaux").

Toutes les routes ci-dessus (et les pages statiques) exigent une
authentification HTTP Basic si `DASHBOARD_USER`/`DASHBOARD_PASSWORD` sont
configurés (voir "Protection par mot de passe").
