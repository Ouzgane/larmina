# Pilotage des projets

Version en ligne du tableau de pilotage du portefeuille de projets : revenus, briefing du jour, matrice d'arbitrage en 3D, fiches projets et trajectoires.

## Confidentialité

- Ce dépôt est public, mais il ne contient **aucune donnée lisible**. Les données sont dans `donnees/pilotage.chiffre.json`, chiffrées en AES-GCM 256 bits avec une clé dérivée du mot de passe (PBKDF2-SHA256, 310 000 itérations, sel et vecteur aléatoires à chaque publication).
- La page les déchiffre dans le navigateur. Le mot de passe n'est ni dans ce dépôt ni envoyé à un serveur. S'il est mémorisé (« Se souvenir sur cet appareil »), il reste dans ce navigateur, et le bouton « Verrouiller » l'efface.
- Le site demande aux moteurs de recherche de ne pas l'indexer (`robots.txt` et balise `noindex`).

## Mise à jour

Chaque matin, la tâche planifiée « Pilotage des projets : rapport quotidien » met à jour le tableau de bord dans Claude, puis publie ici une nouvelle version chiffrée de ses données.

Publication manuelle, à partir des quatre fichiers du tableau de bord (`projets.json`, `rapports.json`, `syntheses.json`, `revenus.csv`) copiés dans `clair/`, un dossier ignoré par Git :

```sh
PILOTAGE_MDP='…' node outils/publier.mjs clair
PILOTAGE_MDP='…' node outils/verifier.mjs
```

Pour changer de mot de passe : republier avec le nouveau, puis mettre à jour la tâche planifiée.

## Fichiers

- `index.html` : la page et son écran d'accès.
- `app.js` : calculs et dessins, repris du tableau de bord Claude.
- `dash-shim.js` : fournit les données déchiffrées à `app.js`.
- `acces.js` : téléchargement, déchiffrement et mémorisation du mot de passe.
- `vendor/d3.min.js` : D3 v7.9 (licence ISC).
- `outils/` : publication et vérification du fichier chiffré (Node 20 ou plus, sans dépendance).
