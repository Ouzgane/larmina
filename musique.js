// Lecteur Spotify sous la sphère, piloté par Geri.
// Utilise le lecteur intégré officiel de Spotify (iFrame API) : morceaux complets si tu es connecté
// à Spotify dans ce navigateur, extraits de 30 secondes sinon. Aucun compte développeur nécessaire.
(function () {
  const CFG = window.PILOTAGE_IA || {};
  const PLAYLISTS = CFG.playlists || {};
  const zone = document.getElementById('geri-musique');
  if (!zone) return;
  const titre = zone.querySelector('.geri-musique-titre');
  const fermer = zone.querySelector('.geri-musique-fermer');
  const hote = zone.querySelector('.geri-musique-lecteur');

  let api = null, chargement = null, controleur = null, enPause = true, pauseParGeri = false, attente = null;

  // Accepte une clé de playlist, une adresse open.spotify.com ou une URI spotify:…
  function versUri(x) {
    const s = String(x || '').trim();
    if (!s) return null;
    const cle = s.toLowerCase();
    if (PLAYLISTS[cle]) return { uri: PLAYLISTS[cle].uri, nom: PLAYLISTS[cle].nom };
    const m = s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track|artist|episode|show)\/([A-Za-z0-9]{22})/);
    if (m) return { uri: `spotify:${m[1]}:${m[2]}`, nom: 'Spotify' };
    if (/^spotify:(playlist|album|track|artist|episode|show):[A-Za-z0-9]{22}$/.test(s)) return { uri: s, nom: 'Spotify' };
    return null;
  }

  function chargerApi() {
    if (api) return Promise.resolve(api);
    if (!chargement) {
      chargement = new Promise((resolve, reject) => {
        window.onSpotifyIframeApiReady = (IFrameAPI) => { api = IFrameAPI; resolve(api); };
        const s = document.createElement('script');
        s.src = 'https://open.spotify.com/embed/iframe-api/v1';
        s.async = true;
        s.onerror = () => { chargement = null; reject(new Error('Spotify injoignable')); };
        document.head.appendChild(s);
      });
    }
    return chargement;
  }

  async function jouer(cible) {
    const choix = versUri(cible);
    if (!choix) return false;
    zone.hidden = false;
    titre.textContent = choix.nom;
    attente = choix.uri;
    try {
      await chargerApi();
    } catch (e) {
      titre.textContent = 'Spotify ne répond pas';
      return false;
    }
    if (controleur) {
      controleur.loadUri(choix.uri);
      controleur.play();
    } else {
      const el = document.createElement('div');
      hote.replaceChildren(el);
      api.createController(el, { uri: choix.uri, width: '100%', height: 152, theme: 'dark' }, (c) => {
        controleur = c;
        c.addListener('ready', () => { if (attente) { c.play(); attente = null; } });
        c.addListener('playback_update', (e) => { enPause = !!(e.data && e.data.isPaused); });
      });
    }
    return true;
  }

  function arreter() {
    if (controleur) { try { controleur.pause(); } catch (e) { /* rien */ } }
    pauseParGeri = false;
  }

  function masquer() {
    arreter();
    if (controleur) { try { controleur.destroy(); } catch (e) { /* rien */ } }
    controleur = null;
    hote.replaceChildren();
    zone.hidden = true;
  }

  // La musique s'efface quand Geri parle, puis reprend.
  document.addEventListener('geri:etat', (e) => {
    const etat = e.detail && e.detail.etat;
    if (!controleur) return;
    if (etat === 'parle' && !enPause) { pauseParGeri = true; try { controleur.pause(); } catch (x) { /* rien */ } }
    else if (etat === 'veille' && pauseParGeri) { pauseParGeri = false; try { controleur.resume(); } catch (x) { /* rien */ } }
  });

  fermer.addEventListener('click', masquer);

  window.GERI_MUSIQUE = {
    jouer,
    arreter,
    masquer,
    reconnait: (x) => !!versUri(x),
    playlists: () => Object.entries(PLAYLISTS).map(([cle, p]) => ({ cle, nom: p.nom })),
  };
})();
