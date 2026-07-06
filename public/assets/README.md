# Assets

Le dashboard a un thème sombre et un thème clair (bouton de bascule dans
le header). Chaque thème utilise sa propre variante du logo, déposée ici :

```
proludik_h_rouge_blanc.png   -> thème sombre (texte blanc, fond sombre)
proludik_h_rouge_navy.png    -> thème clair (texte navy/rouge, fond clair)
```

`public/dashboard.js` (`THEME_LOGO_PATHS`) bascule automatiquement entre
les deux selon le thème actif — aucune modification de code nécessaire
une fois les fichiers commités à ces emplacements exacts.

Tant qu'un fichier est absent, un logo de repli (texte stylisé "PROLUDIK"
en CSS, couleur adaptée au thème) s'affiche automatiquement pour ce thème.
