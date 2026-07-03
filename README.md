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
  **Endpoint des ventes** : ce compte IO n'a pas de module "sales"/"orders"
  séparé — c'est le module **Leads** (contrats + paiements, confirmé via la
  permission "Lead Payments") qui en tient lieu. `IO_SALES_ENDPOINT` pointe
  donc par défaut vers `/leads`.

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
  Vérifié avec un serveur fixture local reproduisant la forme réelle de
  `/leads` (auth réelle bloquée depuis cet environnement de développement).

  **Représentants non mappés** : `salesrep` est un **ID numérique**, affiché
  tel quel pour l'instant (pas de nom). La section "Ventes par
  représentant" ne matchera donc pas les noms utilisés dans
  `config/objectifs.json` tant qu'un mapping ID → nom n'est pas ajouté (les
  objectifs resteront à `—`).

  Ces deux mappings (statut et représentant) sont volontairement laissés
  pour plus tard — à ajouter dans `server/connectors/inflatableOffice.js`
  une fois la table de correspondance connue (ex. via l'admin IO ou un
  export de la liste des statuts/représentants et leurs ID).

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
