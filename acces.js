// Écran d'accès : déchiffre les données dans le navigateur avec le mot de passe.
// Le mot de passe ne quitte jamais l'appareil ; s'il est mémorisé, c'est dans ce navigateur seulement.
(function () {
  const FICHIER = 'donnees/pilotage.chiffre.json';
  const MEMO = 'pilotage.mdp';
  const ecran = document.getElementById('acces');
  const form = document.getElementById('acces-form');
  const champ = document.getElementById('acces-mdp');
  const memo = document.getElementById('acces-memo');
  const msg = document.getElementById('acces-msg');
  const btn = document.getElementById('acces-btn');
  const verrou = document.getElementById('verrouiller');
  const publie = document.getElementById('publie-le');
  const u8 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const lire = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const ecrire = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } };

  async function telecharger() {
    const r = await fetch(FICHIER + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('Fichier de données introuvable (' + r.status + ').');
    return r.json();
  }

  async function dechiffrer(env, mdp) {
    if (!window.crypto || !crypto.subtle) throw new Error('Ce navigateur ne sait pas déchiffrer (page à ouvrir en https).');
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(mdp), 'PBKDF2', false, ['deriveKey']);
    const cle = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: u8(env.derivation.sel), iterations: env.derivation.iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8(env.iv) }, cle, u8(env.donnees));
    return JSON.parse(new TextDecoder().decode(clair));
  }

  function ouvrir(paquet, env) {
    if (publie && env.publie_le) {
      const d = new Date(env.publie_le);
      publie.textContent = d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    }
    window.PILOTAGE.charger(paquet);
    ecran.classList.add('acces-ouvert');
    setTimeout(() => { ecran.hidden = true; }, 700);
    document.body.classList.remove('verrouille');
  }

  async function tenter(mdp, auto) {
    btn.disabled = true;
    msg.textContent = 'Déchiffrement…';
    msg.className = 'acces-msg';
    try {
      const env = await telecharger();
      let paquet;
      try { paquet = await dechiffrer(env, mdp); } catch (e) {
        if (auto) ecrire(MEMO, null);
        throw new Error(auto ? 'Le mot de passe mémorisé ne fonctionne plus : saisis-le à nouveau.' : 'Mot de passe incorrect.');
      }
      if (memo.checked) ecrire(MEMO, mdp); else if (!auto) ecrire(MEMO, null);
      ouvrir(paquet, env);
    } catch (e) {
      msg.textContent = e.message;
      msg.className = 'acces-msg acces-erreur';
      ecran.classList.remove('acces-secoue');
      void ecran.offsetWidth;
      ecran.classList.add('acces-secoue');
      champ.value = '';
      champ.focus();
    } finally {
      btn.disabled = false;
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); if (champ.value) tenter(champ.value, false); });
  if (verrou) verrou.addEventListener('click', () => { ecrire(MEMO, null); location.reload(); });

  window.PILOTAGE.toutDessiner();
  const memorise = lire(MEMO);
  if (memorise) { memo.checked = true; tenter(memorise, true); } else champ.focus();
})();
