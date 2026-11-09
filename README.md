# Pilotage des projets

Version en ligne du tableau de pilotage du portefeuille de projets : revenus, briefing du jour, matrice d'arbitrage en 3D, fiches projets et trajectoires. Une assistante, Geri (prononcé « Jéri »), répond aux questions sur le tableau, par écrit et à voix haute.

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

Pour changer de mot de passe : republier avec le nouveau, mettre à jour la tâche planifiée, puis l'empreinte de l'assistant (voir plus bas).

## Assistant IA

On écrit à l'assistant, il répond par écrit et à voix haute, et propose des relances à cliquer. Il n'utilise jamais le micro. La voix est la synthèse vocale du navigateur, elle ne coûte rien ; le bouton haut-parleur la coupe. Une voix féminine française est choisie automatiquement parmi celles de l'appareil ; `voixNom` dans `config.js` en impose une. Sur Mac, la meilleure (Audrey ou Aurélie, en qualité Premium) s'installe dans Réglages Système → Accessibilité → Contenu énoncé → Voix du système → Gérer les voix.

```
navigateur ──(question + résumé des données)──▶ relais Cloudflare ──▶ modèle
```

- Le **relais** (`relais/`) est un petit Cloudflare Worker. Il garde les clés, choisit le modèle et lui donne ses consignes. Le site ne connaît que l'adresse du relais : **changer de modèle ne touche pas au site**.
- **Accès** : le navigateur dérive un jeton du mot de passe (PBKDF2, 310 000 itérations) ; le relais n'en connaît que l'empreinte (`JETON_EMPREINTE`). Sans le mot de passe, le relais refuse tout. Il n'accepte aussi que les appels venant de `ouzgane.github.io`.
- **Données** : à chaque question, le navigateur envoie un résumé des données déchiffrées (environ 11 000 caractères). Le relais ne stocke rien.

### Voix, sous-titres et sphère

- La voix est **Piper « Siwis »**, une voix féminine française générée directement dans le navigateur, sans compte ni coût. Au premier usage, le navigateur télécharge environ 90 Mo (voix 63 Mo, moteur et prononciation), puis les garde en cache. Si elle ne peut pas se charger, Geri utilise la voix du système. Réglages dans `config.js` : `voixPiper` (`fr_FR-siwis-low`, plus légère) et `voixVitesse`.
- Ce que Geri dit s'affiche aussi **sous la sphère, mot à mot**, comme des sous-titres, même voix coupée. Le texte reste dans le chat.
- La sphère suit le **vrai niveau sonore** de la voix ; les indicateurs évoqués s'allument au fil de la phrase.

### Musique (Spotify)

Demande « mets du jazz », « de quoi me concentrer » ou colle un lien Spotify : le lecteur Spotify s'ouvre sous la sphère. Morceaux complets si tu es connecté à Spotify dans ce navigateur, extraits de 30 secondes sinon. La musique se met en pause quand Geri parle. Les playlists proposées se règlent dans `config.js` (`playlists`).

### Notion

Quand tu annonces une décision ou un changement (« je mets Tablée en pause jusqu'en janvier »), Geri propose une carte **« Enregistrer dans Notion »** : rien n'est écrit sans ton clic. Champs modifiables : Décision, Statut, Prochaine étape, Échéance, Blocages, Résumé, dans la base **Projets** de la page « Pilotage des projets ». Le tableau se met à jour aussitôt ; le rapport du matin reprend ces valeurs depuis Notion.

Mise en service : créer une intégration Notion interne (notion.so/profile/integrations, droits « lire » et « modifier le contenu »), la connecter à la page « Pilotage des projets » (menu ••• → Connexions), mettre son secret dans le secret GitHub `NOTION_CLE`, puis relancer le workflow « Relais IA ».

### Modèle actuel

Cloudflare Workers AI, modèle `@cf/openai/gpt-oss-120b`. Gratuit dans la limite de 10 000 neurones par jour, soit environ 50 à 60 questions par jour avec ce modèle. Au-delà, l'assistant l'annonce et reprend le lendemain (0 h UTC) : aucun frais possible sur le plan gratuit. Cloudflare n'utilise pas les requêtes pour entraîner des modèles.

### Changer de modèle

Tout se règle dans `relais/wrangler.toml`. On pousse, le relais se redéploie seul.

1. Changer `IA_FOURNISSEUR` (et `IA_MODELE` pour un autre modèle que celui par défaut).
2. Hors Cloudflare : ajouter la clé du fournisseur dans le secret GitHub `IA_CLE`.

| `IA_FOURNISSEUR` | Modèle par défaut | Clé `IA_CLE` | Remarque |
|---|---|---|---|
| `cloudflare` | `@cf/openai/gpt-oss-120b` | aucune | Autre choix économique : `@cf/google/gemma-4-26b-a4b-it`, environ 3 fois plus de questions par jour. |
| `anthropic` | `claude-haiku-5-5` | console.anthropic.com | Payant à l'usage. |
| `openai` | `gpt-5-mini` | platform.openai.com | Payant à l'usage. |
| `mistral` | `mistral-small-latest` | console.mistral.ai | Payant à l'usage, hébergé en Europe. |
| `groq` | `openai/gpt-oss-120b` | console.groq.com | Gratuit avec limites. |
| `gemini` | `gemini-flash-latest` | aistudio.google.com | Offre gratuite : Google peut utiliser les échanges pour améliorer ses produits. |
| `openrouter` | `openai/gpt-oss-120b` | openrouter.ai | Des centaines de modèles avec une seule clé. |
| `compatible` | à indiquer | selon le service | Toute API compatible OpenAI : renseigner aussi `IA_URL` (…/chat/completions). |

Avec Cloudflare, si gpt-oss renvoie une réponse inutilisable (son raisonnement qui fuit, ou une réponse en anglais), le relais repose la question à un modèle de secours, `@cf/mistralai/mistral-small-3.1-24b-instruct` par défaut, réglable avec `IA_MODELE_SECOURS` (« aucun » pour le désactiver).

Les noms de modèles par défaut changent avec le temps : en cas d'erreur, vérifier le nom exact chez le fournisseur et le mettre dans `IA_MODELE`. Pour ajouter un fournisseur : une ligne dans `PRESETS` (`relais/src/fournisseurs.js`).

### Mise en service (une seule fois)

1. Compte Cloudflare gratuit sur dash.cloudflare.com. Ouvrir une fois **Workers & Pages** pour choisir le sous-domaine `….workers.dev`.
2. **Account ID** : visible dans **Workers & Pages**, colonne de droite.
3. **Jeton d'API** : My Profile → API Tokens → Create Token → modèle **Edit Cloudflare Workers**, puis ajouter la permission **Account · Workers AI · Read**.
4. Dans GitHub, dépôt larmina → Settings → Secrets and variables → Actions : créer `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`.
5. Onglet Actions → **Relais IA** → Run workflow. Le workflow teste le relais, le déploie, puis écrit son adresse dans `config.js` : le site est branché.

### Vérifier

```sh
cd relais && npm test                          # tests du relais, sans réseau
curl https://larmina-ia.<sous-domaine>.workers.dev/   # fournisseur et modèle actifs
```

Si le mot de passe du site change : `PILOTAGE_MDP='…' node outils/empreinte-ia.mjs`, recopier la valeur dans `JETON_EMPREINTE`, pousser.

## Fichiers

- `index.html` : la page, son écran d'accès et le panneau de l'assistant.
- `app.js` : calculs et dessins, repris du tableau de bord Claude.
- `dash-shim.js` : fournit les données déchiffrées à `app.js`.
- `acces.js` : téléchargement, déchiffrement et mémorisation du mot de passe.
- `geri.js` : la sphère de Geri au centre de la page, ses ondes quand elle parle, et la mise en lumière des indicateurs qu'elle évoque.
- `assistant.js` : le chat, les relances, les cartes Notion et le résumé des données envoyé au relais.
- `voix.js`, `voix-worker.js` : la voix Piper (synthèse hors de la page, lecture et niveau sonore).
- `musique.js` : le lecteur Spotify.
- `config.js` : adresse du relais, nom de l'assistante, sa prononciation et sa voix.
- `relais/` : le relais IA (Cloudflare Worker) et ses tests.
- `.github/workflows/relais.yml` : déploiement automatique du relais.
- `vendor/` : D3, onnxruntime-web et piper-phonemize (voir `vendor/LICENCES.md`).
- `outils/` : publication et vérification du fichier chiffré, empreinte de l'assistant (Node 20 ou plus, sans dépendance).
