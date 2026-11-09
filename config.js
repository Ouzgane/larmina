// Réglages de l'assistant du site.
// « relais » est renseigné automatiquement par le déploiement du relais (GitHub Actions → Cloudflare).
window.PILOTAGE_IA = {
  relais: 'https://larmina-ia.elmehdi-ouzgane.workers.dev',
  nom: 'Geri',
  // Comment la voix doit prononcer le nom.
  prononciation: 'Jéri',
  // Voix féminine choisie automatiquement ; mettre un nom (ex. 'Audrey') pour en imposer une.
  voixNom: '',
  voix: true,
  // Voix intégrée (Piper) : fr_FR-siwis-medium (meilleure, ~63 Mo) ou fr_FR-siwis-low (~28 Mo).
  voixPiper: 'fr_FR-siwis-medium',
  voixVitesse: 1,
  // Playlists que Geri peut lancer dans le lecteur Spotify (clé : { nom, uri }).
  // Pour en ajouter une : Spotify → Partager → Copier le lien, puis coller l'identifiant ici.
  playlists: {
    concentration: { nom: 'Concentration', uri: 'spotify:playlist:37i9dQZF1DWZeKCadgRdKQ' },
    piano: { nom: 'Piano calme', uri: 'spotify:playlist:37i9dQZF1DX4sWSpwq3LiO' },
    jazz: { nom: 'Jazz', uri: 'spotify:playlist:37i9dQZF1DX0SM0LYsmbMT' },
    lofi: { nom: 'Lo-fi', uri: 'spotify:playlist:37i9dQZF1DWWQRwui0ExPn' },
    energie: { nom: 'Énergie', uri: 'spotify:playlist:37i9dQZF1DX76Wlfdnj7AP' },
    hits: { nom: 'Hits du moment', uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' },
  },
};
