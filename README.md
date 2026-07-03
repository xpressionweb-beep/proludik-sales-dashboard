# Proludik Sales Dashboard

Petit serveur Node.js qui synchronise les ventes **InflatableOffice (IO)** et
**Shopify** toutes les 30 minutes, et sert un dashboard web pour les
consulter.

## Fonctionnalités

- Synchronisation automatique (cron, par défaut `*/30 * * * *`) + bouton
  "Synchroniser maintenant" dans le dashboard.
- Stockage local simple (fichiers JSON dans `data/`), aucune base de données
  externe requise.
- Dashboard web :
  - Totaux par statut IO (**Confirmé**, **Soumission**, **Contrat/VFR**) et
    pour Shopify.
  - Comparatif semaine / mois / année financière (actuelle vs précédente).
    Année financière = **1er octobre → 30 septembre**.
  - Ventes par représentant avec % vs objectif (voir `config/objectifs.json`).
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
  format `{ offset, limit, next, items: [...] }`, géré automatiquement.
  **Point non résolu** : la doc publique ne documente que l'endpoint
  `/rentals`, qui est le **catalogue d'inventaire** (les structures
  gonflables), **pas les ventes/réservations**. Le vrai nom de l'endpoint des
  ventes (`/bookings`, `/orders`, `/reservations`, ...) et les noms exacts des
  champs (statut, montant, représentant, date) n'ont pas pu être confirmés
  sans accès au compte réel.

  **Pour finaliser `IO_SALES_ENDPOINT` et les `IO_FIELD_*`** : le plus simple
  est de lancer une requête manuelle contre votre compte et de partager la
  réponse JSON (avec les données clients sensibles masquées si besoin), ex. :
  ```bash
  curl "https://rental.software/api6/<endpoint-a-confirmer>?apiKey=VOTRE_CLE"
  ```
  Sinon, dans l'admin rental.software, la section "API Keys" (Settings) ou le
  centre d'aide (support.rental.software, recherche "API") devrait lister
  l'endpoint exact utilisé pour les réservations/ventes. Une fois confirmé,
  ajuster `IO_SALES_ENDPOINT` et les `IO_FIELD_*` dans `.env` — aucun
  changement de code n'est nécessaire si la forme générale (JSON, champs à
  plat) reste similaire.

Tant qu'un des deux connecteurs n'est pas configuré, il tourne en mode démo
(données d'exemple) — un badge "mode démo" apparaît dans le dashboard pour
cette source.

## Objectifs de vente par représentant

Fichier `config/objectifs.json` : objectif annuel par représentant et par
année financière (ex. `"2025-2026": 500000`). Le mensuel et l'hebdomadaire
sont calculés automatiquement (annuel / 12 et annuel / 52). Ce fichier est
relu à chaque requête — pas besoin de redémarrer le serveur après une
modification.

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
config/
  objectifs.json          objectifs de vente par représentant
```

## API

- `GET /api/overview` — totaux par statut/source pour semaine, mois, année
  fiscale (actuel + précédent + variation %).
- `GET /api/reps?period=week|month|year&offset=0` — ventes par représentant
  sur la période, avec objectif proratisé et %.
- `GET /api/meta` — état de la dernière synchronisation par source (dernier
  succès, erreurs, mode démo).
- `POST /api/sync` — déclenche une synchronisation manuelle immédiate.
