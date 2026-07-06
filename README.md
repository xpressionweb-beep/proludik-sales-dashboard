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
  - Année financière = **1er octobre → 30 septembre**.
- **Mode démo (mock)** : si les identifiants Shopify ou InflatableOffice ne
  sont pas configurés, le connecteur correspondant génère des données
  d'exemple, pour pouvoir tester le serveur et le dashboard immédiatement.

## Installation

```bash
npm install
cp .env.example .env
# éditez .env avec vos identifiants Shopify / InflatableOffice
npm start
```

Le dashboard est servi sur `http://localhost:3000` (port configurable via
`PORT` dans `.env`).

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
période de chaque carte en sous-unités réelles (jour par jour pour
semaine/mois, mois par mois pour l'année financière), à partir des vraies
ventes stockées — aucune donnée simulée.

## Activité récente

Le panneau "Activité récente" (`/api/activity`) liste les ventes réelles
les plus récentes (toutes sources confondues), pas un flux d'événements
fabriqué — voir `getRecentActivity()`.

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
  connectors/
    shopify.js          connecteur Shopify Admin API
    inflatableOffice.js  connecteur IO (générique, à ajuster selon la vraie API)
    mockData.js          générateur de données de démo
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
- `GET /api/trend?card=week|month|year` — série de points réels pour la
  sparkline de la carte correspondante.
- `GET /api/activity?limit=8` — les N ventes réelles les plus récentes.
- `GET /api/meta` — état de la dernière synchronisation par source (dernier
  succès, erreurs, mode démo).
- `POST /api/sync` — déclenche une synchronisation manuelle immédiate.
- `GET /api/diagnostics/ip` — IP sortante du serveur (voir section
  "Diagnostic : IP sortante du serveur").
