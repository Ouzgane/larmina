// Assistant du site : on lui écrit, il répond par écrit et à voix haute.
// Il n'utilise jamais le micro et n'écoute pas. La voix est celle du navigateur (synthèse vocale locale).
// Le modèle est derrière le relais (relais/) : changer de modèle ne touche pas à ce fichier.
(function () {
  const CFG = Object.assign({ relais: '', nom: 'Geri', prononciation: '', voixNom: '', voix: true }, window.PILOTAGE_IA || {});
  const RELAIS = String(CFG.relais || '').trim().replace(/\/+$/, '');
  const NOM = String(CFG.nom || 'Geri');
  const NOM_PRONONCE = String(CFG.prononciation || '').trim();
  const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const CLE_VOIX = 'pilotage.voix';
  const SEL_JETON = 'pilotage-ia-jeton-v1';
  const HISTORIQUE = 12;
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const FOURNISSEURS = { cloudflare: 'Cloudflare', anthropic: 'Anthropic', openai: 'OpenAI', mistral: 'Mistral', groq: 'Groq', gemini: 'Google', openrouter: 'OpenRouter', compatible: 'API compatible' };

  const $ = (id) => document.getElementById(id);
  // Signaux pour la sphère centrale (geri.js) : état, mots prononcés, passages lus.
  const emettre = (nom, detail) => document.dispatchEvent(new CustomEvent('geri:' + nom, { detail: detail || {} }));
  const racine = $('ia');
  if (!racine) return;
  const orbe = $('ia-orbe'), panneau = $('ia-panneau'), fil = $('ia-fil'), zonePuces = $('ia-suggestions');
  const form = $('ia-form'), champ = $('ia-champ'), envoyer = $('ia-envoyer');
  const btnVoix = $('ia-voix'), btnFermer = $('ia-fermer'), etat = $('ia-etat'), modele = $('ia-modele'), onde = $('ia-onde');
  const reduit = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const lire = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const ecrire = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } };

  let jeton = null, jetonPret = Promise.resolve(null), contexteTexte = '', donnees = null;
  let historique = [], enCours = false, salue = false, sonde = false;
  const synth = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window ? window.speechSynthesis : null;
  let voixActive = !!synth && CFG.voix !== false && lire(CLE_VOIX) !== '0';
  let voixChoisie = null, voixDebloquee = false, veille = 0, panneSignalee = false;

  $('ia-nom').textContent = NOM;
  orbe.setAttribute('aria-label', 'Ouvrir ' + NOM + ', l’assistante');
  const etiquette = racine.querySelector('.ia-orbe-etiquette');
  if (etiquette) etiquette.textContent = 'Demander à ' + NOM;
  for (let i = 0; i < 28; i++) {
    const b = document.createElement('i');
    b.style.setProperty('--i', i);
    b.style.setProperty('--j', String((i * 7) % 5));
    onde.appendChild(b);
  }

  // ── Jeton d'accès au relais : dérivé du mot de passe, jamais stocké ──────────
  async function deriver(mdp) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(mdp), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(SEL_JETON), iterations: 310000, hash: 'SHA-256' }, base, 256);
    return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Contexte transmis au modèle : un résumé lisible des données déchiffrées ──
  const eur = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €';
  const montant = (r) => { const n = parseFloat(String(r && r.montant != null ? r.montant : '').replace(/[\s  ]/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
  const court = (v, n) => { const s = String(v).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const parDate = (a, b) => String(a.date || '').localeCompare(String(b.date || ''));

  function construireContexte(p) {
    const projets = p.projets || [], rapports = (p.rapports || []).slice().sort(parDate);
    const syntheses = (p.syntheses || []).slice().sort(parDate), revenus = (p.revenus || []).slice().sort(parDate);
    const s = syntheses[syntheses.length - 1];
    const total = revenus.reduce((t, r) => t + montant(r), 0);
    const parProjet = {};
    revenus.forEach((r) => { parProjet[r.projet_id] = (parProjet[r.projet_id] || 0) + montant(r); });
    const L = [];
    L.push(`Dernier rapport : ${s ? s.date : (rapports.length ? rapports[rapports.length - 1].date : 'inconnu')}. ${projets.length} projets suivis.`);
    if (s) {
      L.push('', 'SYNTHÈSE DU RAPPORT', court(s.titre || '', 300), court(s.synthese || '', 1600));
      if (s.arbitrages) L.push('Arbitrages proposés :', ...String(s.arbitrages).split('\n').filter(Boolean).map((l) => '- ' + court(l, 500)));
      if (s.alertes) L.push('Alertes :', ...String(s.alertes).split('\n').filter(Boolean).map((l) => '- ' + court(l, 400)));
    }
    L.push('', 'REVENUS ENCAISSÉS', `Total : ${eur(total)}, ${revenus.length} encaissement${revenus.length > 1 ? 's' : ''}.`);
    revenus.slice(-10).reverse().forEach((r) => L.push(`- ${r.date} · ${r.projet || r.projet_id} · ${eur(montant(r))}${r.type ? ' · ' + r.type : ''}${r.note ? ' · ' + court(r.note, 120) : ''}`));
    L.push('', 'PROJETS');
    projets.forEach((x) => {
      const siens = rapports.filter((r) => r.projet_id === x.id);
      const dernier = siens[siens.length - 1];
      L.push(`■ ${x.projet}${x.nom_court && x.nom_court !== x.projet ? ' (' + x.nom_court + ')' : ''}`);
      [
        ['Pôle', x.pole], ['Recommandation du rapport', x.recommandation], ['Décision de l’utilisateur', x.decision],
        ['Étape', x.etape], ['Avancement', x.avancement != null ? x.avancement + ' %' : null], ['Dynamique', x.dynamique],
        ['Potentiel à 12 mois', x.potentiel != null ? x.potentiel + '/5' : null], ['Effort restant', x.effort != null ? x.effort + '/5' : null],
        ['Objectif mensuel', x.objectif_mensuel != null ? eur(x.objectif_mensuel) : 'non fixé'], ['Revenu encaissé', eur(parProjet[x.id] || 0)],
        ['Résumé', x.resume], ['Modèle de revenu', x.modele_revenu], ['Prochaine étape', x.prochaine_etape], ['Échéance', x.echeance],
        ['Blocages', x.blocages], ['Dernière activité', x.derniere_activite], ['Automatisations actives', x.automatisations], ['Site', x.lien_libelle],
      ].forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') L.push(`  ${k} : ${court(v, 480)}`); });
      if (dernier && dernier.fait) L.push(`  Fait (rapport du ${dernier.date}) : ${court(dernier.fait, 480)}`);
      if (dernier && dernier.risques && dernier.risques !== x.blocages) L.push(`  Risques : ${court(dernier.risques, 400)}`);
      if (siens.length > 1) L.push('  Trajectoire : ' + siens.slice(-6).map((r) => `${r.date} ${r.avancement} %`).join(' → '));
    });
    return L.join('\n').slice(0, 28000);
  }

  // ── Voix ─────────────────────────────────────────────────────────────────────
  // Voix féminine : les navigateurs n'indiquent pas le genre, on le déduit du nom de la voix.
  const FEMMES = /audrey|aur[ée]lie|marie|am[ée]lie|julie|denise|hortense|[ée]lo[iï]se|vivienne|brigitte|c[ée]leste|coralie|jacqueline|jos[ée]phine|yvette|charline|ariane|sylvie|chantal|caroline|virginie|fran[çc]oise|sophie|google fran[çc]ais/i;
  const FEMMES_FANTAISIE = /\b(flo|shelley|sandy|grandma)\b/i;
  const HOMMES = /thomas|jacques|eddy|grandpa|reed|rocko|henri|paul|r[ée]m[iy]|claude|daniel|nicolas|fabrice|g[ée]rard|alain|antoine|j[ée]r[ôo]me|maxime|yves|christophe|lucien|mathieu|guillaume|jean|louis|thierry|bruno|cl[ée]ment|f[ée]lix|hugo|lucas|olivier|pierre/i;
  function choisirVoix() {
    if (!synth) return;
    const fr = (synth.getVoices() || []).filter((v) => /^fr([-_]|$)/i.test(v.lang || ''));
    const impose = String(CFG.voixNom || '').trim().toLowerCase();
    const voulue = impose && fr.find((v) => v.name.toLowerCase().includes(impose));
    if (voulue) { voixChoisie = voulue; return; }
    const note = (v) => (HOMMES.test(v.name) ? -100 : FEMMES_FANTAISIE.test(v.name) ? 10 : FEMMES.test(v.name) ? 30 : 0)
      + (/natural|neural|online|premium|enhanced|wavenet/i.test(v.name) ? 8 : 0)
      + (/^fr[-_]fr/i.test(v.lang) ? 3 : 0) + (v.localService === false ? 1 : 0);
    voixChoisie = fr.sort((a, b) => note(b) - note(a))[0] || null;
  }
  if (synth) {
    choisirVoix();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', choisirVoix);
    else synth.onvoiceschanged = choisirVoix;
  }

  function pourLaVoix(t) {
    let s = String(t || '');
    if (NOM_PRONONCE) s = s.replace(new RegExp('(^|[^\\p{L}])' + echapper(NOM) + '(?![\\p{L}])', 'gu'), '$1' + NOM_PRONONCE);
    return s
      .replace(/\*\*|__|[*_`#>]/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, a, mo, j) => (MOIS[+mo - 1] ? `${+j} ${MOIS[+mo - 1]} ${a}` : m))
      .replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g, (m, j, mo, a) => (+mo >= 1 && +mo <= 12 && +j >= 1 && +j <= 31 ? `${+j} ${MOIS[+mo - 1]}${a ? ' ' + a : ''}` : m))
      .replace(/~\s*/g, 'environ ')
      .replace(/(\d+(?:[.,]\d+)?)[\s\u00a0\u202f]?k[\s\u00a0\u202f]?€/g, '$1 mille euros')
      .replace(/\s*[|•→·]\s*/g, ', ')
      .replace(/^\s*[-–]\s+/gm, '')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function decouper(t) {
    const phrases = t.match(/[^.!?…;:]+[.!?…;:]*\s*/g) || [t];
    const sortie = [];
    phrases.forEach((p) => {
      const d = sortie[sortie.length - 1];
      if (d && (d + p).length <= 220) sortie[sortie.length - 1] = d + p; else sortie.push(p);
    });
    return sortie.map((s) => s.trim()).filter(Boolean);
  }

  // Chrome perd les événements des énoncés non référencés et ignore parfois un speak()
  // lancé juste après cancel() : on garde les énoncés en mémoire et on laisse un court délai.
  let generation = 0;
  const enLecture = [];

  function taire() {
    generation++;
    clearTimeout(veille);
    if (synth) { try { synth.cancel(); } catch (e) { /* rien */ } }
    racine.classList.remove('ia-parle');
    emettre('etat', { etat: 'veille' });
  }

  function signaler(texte) {
    if (panneSignalee) return;
    panneSignalee = true;
    const { corps } = bulle('ia-msg-ia ia-msg-info', 'Voix');
    corps.textContent = texte;
    defiler();
  }

  function parler(texte) {
    if (!synth || !voixActive) { emettre('texte', { texte: pourLaVoix(texte) }); return; }
    const morceaux = decouper(pourLaVoix(texte));
    if (!morceaux.length) return;
    const occupe = synth.speaking || synth.pending;
    taire();
    const g = generation;
    const lancer = () => {
      if (g !== generation) return;
      try { if (synth.paused) synth.resume(); } catch (e) { /* rien */ }
      let demarre = false;
      enLecture.length = 0;
      morceaux.forEach((m, i) => {
        const u = new SpeechSynthesisUtterance(m);
        u.lang = voixChoisie ? voixChoisie.lang : 'fr-FR';
        if (voixChoisie) u.voice = voixChoisie;
        u.rate = 1.03;
        u.pitch = 1;
        u.onstart = () => {
          if (!demarre) emettre('etat', { etat: 'parle' });
          demarre = true; clearTimeout(veille); racine.classList.add('ia-parle');
          emettre('segment', { texte: m, duree: (m.length * 65) / u.rate });
        };
        u.onboundary = () => emettre('mot');
        u.onerror = (e) => {
          console.warn('[' + NOM + '] voix :', e && e.error);
          if (e && e.error === 'not-allowed') signaler('Le navigateur bloque la voix pour l\u2019instant. Clique sur le haut-parleur en haut du panneau pour l\u2019autoriser.');
          if (i === morceaux.length - 1) { racine.classList.remove('ia-parle'); emettre('etat', { etat: 'veille' }); }
        };
        if (i === morceaux.length - 1) u.onend = () => { racine.classList.remove('ia-parle'); emettre('etat', { etat: 'veille' }); };
        enLecture.push(u);
        synth.speak(u);
      });
      clearTimeout(veille);
      veille = setTimeout(() => {
        if (demarre || g !== generation) return;
        emettre('texte', { texte: morceaux.join(' ') });
        signaler('La voix ne démarre pas dans ce navigateur. Vérifie que le son de l\u2019onglet et de l\u2019ordinateur est activé, puis clique sur le haut-parleur pour un essai. Le navigateur intégré de l\u2019app Claude ne lit pas la voix.');
      }, 5000);
    };
    if (occupe) setTimeout(lancer, 200); else lancer();
  }

  function debloquerVoix() {
    if (!synth || !voixActive || voixDebloquee) return;
    voixDebloquee = true;
    try { if (synth.paused) synth.resume(); } catch (e) { /* rien */ }
  }

  function majVoix() {
    btnVoix.hidden = !synth;
    btnVoix.setAttribute('aria-pressed', String(voixActive));
    const l = voixActive ? 'Couper la voix' : 'Activer la voix';
    btnVoix.title = l;
    btnVoix.setAttribute('aria-label', l);
    racine.classList.toggle('ia-muet', !voixActive);
  }

  // ── Affichage ────────────────────────────────────────────────────────────────
  function enLigne(texte, parent) {
    String(texte).split(/(\*\*[^*\n]+\*\*)/).forEach((morceau) => {
      if (/^\*\*[^*]+\*\*$/.test(morceau)) { const b = document.createElement('b'); b.textContent = morceau.slice(2, -2); parent.appendChild(b); }
      else if (morceau) parent.appendChild(document.createTextNode(morceau));
    });
  }

  function rendu(texte) {
    const frag = document.createDocumentFragment();
    String(texte).split(/\n{2,}/).forEach((bloc) => {
      const lignes = bloc.split('\n').filter((l) => l.trim());
      if (!lignes.length) return;
      const puce = /^\s*([-*•]|\d+[.)])\s+/;
      if (lignes.length > 1 && lignes.every((l) => puce.test(l)) || (lignes.length === 1 && puce.test(lignes[0]) && /^\s*[-*•]/.test(lignes[0]))) {
        const ul = document.createElement('ul');
        lignes.forEach((l) => { const li = document.createElement('li'); enLigne(l.replace(puce, ''), li); ul.appendChild(li); });
        frag.appendChild(ul);
      } else {
        const p = document.createElement('p');
        lignes.forEach((l, i) => { if (i) p.appendChild(document.createElement('br')); enLigne(l, p); });
        frag.appendChild(p);
      }
    });
    return frag;
  }

  function defiler() { fil.scrollTop = fil.scrollHeight; }

  function bulle(classe, qui) {
    const li = document.createElement('li');
    li.className = 'ia-msg ' + classe;
    if (qui) {
      const tete = document.createElement('span');
      tete.className = 'ia-qui';
      tete.textContent = qui;
      li.appendChild(tete);
    }
    const corps = document.createElement('div');
    corps.className = 'ia-corps';
    li.appendChild(corps);
    fil.appendChild(li);
    return { li, corps, tete: li.firstChild };
  }

  function ajouterUtilisateur(texte) {
    const { corps } = bulle('ia-msg-moi');
    corps.textContent = texte;
    defiler();
  }

  function ajouterAssistant(texte, { parle = true } = {}) {
    const { li, corps, tete } = bulle('ia-msg-ia', NOM);
    if (synth) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ia-rejouer';
      b.title = 'Réécouter';
      b.setAttribute('aria-label', 'Réécouter cette réponse');
      b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
      b.addEventListener('click', () => { const avant = voixActive; voixActive = true; debloquerVoix(); parler(texte); voixActive = avant; });
      tete.appendChild(b);
    }
    if (reduit || texte.length < 12) { corps.appendChild(rendu(texte)); defiler(); }
    else {
      // Révélation progressive, puis mise en forme finale.
      li.classList.add('ia-ecrit');
      const duree = Math.min(1800, texte.length * 14), debut = performance.now();
      const pas = (t) => {
        const n = Math.ceil(texte.length * Math.min(1, (t - debut) / duree));
        corps.textContent = texte.slice(0, n).replace(/\*\*/g, '');
        defiler();
        if (n < texte.length) requestAnimationFrame(pas);
        else { corps.replaceChildren(rendu(texte)); li.classList.remove('ia-ecrit'); defiler(); }
      };
      requestAnimationFrame(pas);
    }
    if (parle) parler(texte);
  }

  function ajouterErreur(texte) {
    const { corps } = bulle('ia-msg-ia ia-msg-erreur', 'Incident');
    corps.textContent = texte;
    defiler();
  }

  function attente() {
    const { li, corps } = bulle('ia-msg-ia ia-attente', NOM);
    corps.innerHTML = '<span class="ia-points" aria-hidden="true"><i></i><i></i><i></i></span><span>Analyse du tableau…</span>';
    racine.classList.add('ia-reflechit');
    emettre('etat', { etat: 'reflexion' });
    defiler();
    return { retirer() { li.remove(); racine.classList.remove('ia-reflechit'); } };
  }

  function puces(liste) {
    zonePuces.replaceChildren();
    (liste || []).slice(0, 4).forEach((s) => {
      const p = typeof s === 'string' ? { libelle: s, texte: s } : s;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ia-puce' + (p.rejouer ? ' ia-puce-rejouer' : '');
      b.textContent = p.libelle.charAt(0).toUpperCase() + p.libelle.slice(1);
      b.addEventListener('click', () => demander(p.texte, { rejouer: !!p.rejouer }));
      zonePuces.appendChild(b);
    });
    zonePuces.hidden = !zonePuces.children.length;
  }

  function statut(texte, classe) {
    etat.textContent = texte;
    etat.className = 'ia-etat' + (classe ? ' ' + classe : '');
  }

  function libelleModele(f, m) {
    const nom = String(m || '').split('/').pop().replace(/-instruct.*$|-it$/i, '');
    return nom + (FOURNISSEURS[f] ? ' · ' + FOURNISSEURS[f] : '');
  }

  // ── Échange avec le relais ───────────────────────────────────────────────────
  function messageErreur(statutHttp, corps, e) {
    if (!statutHttp) return 'Je n’arrive pas à joindre mon relais. Vérifie ta connexion, ou le déploiement du relais sur Cloudflare.';
    if (statutHttp === 401) return 'Le relais refuse l’accès. Si le mot de passe du site a changé, son empreinte doit être mise à jour dans relais/wrangler.toml.';
    if (corps && corps.erreur) return corps.erreur;
    return 'Le relais a répondu une erreur ' + statutHttp + '.';
  }

  async function demander(question, { rejouer = false } = {}) {
    question = String(question || '').trim();
    if (!question || enCours) return;
    debloquerVoix();
    taire();
    puces([]);
    if (!rejouer) ajouterUtilisateur(question);
    historique.push({ role: 'user', content: question });
    if (!RELAIS) {
      historique.pop();
      ajouterErreur('Mon relais Cloudflare n’est pas encore déployé : je ne peux pas répondre. Le README explique comment faire en quelques minutes.');
      return;
    }
    enCours = true;
    envoyer.disabled = true;
    statut('Analyse en cours…', 'ia-etat-actif');
    const att = attente();
    let rep = null, corps = null;
    try {
      await jetonPret;
      if (!jeton) throw Object.assign(new Error('Impossible de préparer l’accès sécurisé dans ce navigateur.'), { connue: true });
      const options = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jeton },
        body: JSON.stringify({ messages: historique.slice(-HISTORIQUE), contexte: contexteTexte, nom: NOM }) };
      if (window.AbortSignal && AbortSignal.timeout) options.signal = AbortSignal.timeout(60000);
      rep = await fetch(RELAIS + '/discuter', options);
      try { corps = await rep.json(); } catch (e) { corps = null; }
      if (!rep.ok) throw Object.assign(new Error(messageErreur(rep.status, corps)), { connue: true });
      const texte = String((corps && corps.reponse) || '').trim() || 'Je n’ai pas de réponse nette. Peux-tu reformuler ?';
      att.retirer();
      historique.push({ role: 'assistant', content: texte });
      historique = historique.slice(-HISTORIQUE * 2);
      ajouterAssistant(texte);
      puces((corps && corps.suggestions) || []);
      if (corps && corps.modele) modele.textContent = libelleModele(corps.fournisseur, corps.modele);
      statut('En ligne', 'ia-etat-ok');
    } catch (e) {
      att.retirer();
      // La question sans réponse sort du fil envoyé au modèle ; « Réessayer » la renvoie.
      if (historique.length && historique[historique.length - 1].role === 'user') historique.pop();
      ajouterErreur(e.connue ? e.message : messageErreur(rep ? rep.status : 0, corps, e));
      puces([{ libelle: '↻ Réessayer', texte: question, rejouer: true }]);
      statut(rep && rep.status === 429 ? 'Limite atteinte' : 'Hors ligne', 'ia-etat-ko');
      emettre('etat', { etat: 'veille' });
    } finally {
      enCours = false;
      envoyer.disabled = false;
    }
  }

  // Vérifie que le relais répond et affiche le modèle actif (aucune donnée envoyée).
  async function sonder() {
    if (sonde) return;
    sonde = true;
    if (!RELAIS) { statut('Relais non déployé', 'ia-etat-ko'); modele.textContent = 'aucun modèle branché'; return; }
    statut('Connexion…');
    try {
      const r = await fetch(RELAIS + '/', { cache: 'no-store' });
      const j = await r.json();
      if (j && j.modele) modele.textContent = libelleModele(j.fournisseur, j.modele);
      statut(j && j.pret ? 'En ligne' : 'Relais mal configuré', j && j.pret ? 'ia-etat-ok' : 'ia-etat-ko');
    } catch (e) {
      statut('Hors ligne', 'ia-etat-ko');
      sonde = false;
    }
  }

  function saluer() {
    salue = true;
    const p = donnees || {};
    const projets = p.projets || [];
    const total = (p.revenus || []).reduce((t, r) => t + montant(r), 0);
    const syn = (p.syntheses || []).slice().sort(parDate).pop();
    let date = '';
    if (syn && /^\d{4}-\d{2}-\d{2}$/.test(syn.date)) { const [, mo, j] = syn.date.split('-'); date = ` du ${+j} ${MOIS[+mo - 1]}`; }
    const accel = projets.filter((x) => x.recommandation === 'Accélérer').map((x) => x.nom_court || x.projet);
    const arb = projets.filter((x) => x.recommandation === 'À arbitrer').map((x) => x.nom_court || x.projet);
    const h = new Date().getHours();
    const texte = `${h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour'}. J’ai lu le rapport${date} : ${projets.length} projets suivis, ${total > 0 ? eur(total) + ' encaissés' : 'aucun revenu encaissé pour l’instant'}.`
      + (accel.length ? ` Le rapport propose d’accélérer ${liste(accel)}.` : '')
      + (arb.length ? ` ${liste(arb)} ${arb.length > 1 ? 'attendent' : 'attend'} ton arbitrage.` : '')
      + ' Que veux-tu examiner ?';
    ajouterAssistant(texte);
    const premieres = ['Résume-moi la situation du jour', 'Quel projet accélérer en priorité ?'];
    if (arb.length >= 2) premieres.push(`${arb[0]} ou ${arb[1]} : que choisir ?`);
    else premieres.push('Qu’est-ce qui bloque en ce moment ?');
    puces(premieres);
  }
  const liste = (l) => (l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' et ' + l[l.length - 1]);

  // ── Ouverture, fermeture, saisie ─────────────────────────────────────────────
  // Sur grand écran, le contenu se décale pour que le panneau ne cache pas les indicateurs.
  function amarrer(oui) {
    document.body.classList.toggle('ia-amarre', oui);
    clearTimeout(amarrer.t);
    amarrer.t = setTimeout(() => { if (window.PILOTAGE && window.PILOTAGE.toutDessiner) window.PILOTAGE.toutDessiner(); }, 380);
  }

  function ouvrir() {
    panneau.hidden = false;
    racine.classList.remove('ia-appel');
    requestAnimationFrame(() => racine.classList.add('ia-ouvert'));
    amarrer(true);
    orbe.setAttribute('aria-expanded', 'true');
    debloquerVoix();
    sonder();
    if (!salue) saluer();
    setTimeout(() => champ.focus({ preventScroll: true }), reduit ? 0 : 120);
  }

  function fermer() {
    racine.classList.remove('ia-ouvert');
    amarrer(false);
    orbe.setAttribute('aria-expanded', 'false');
    taire();
    setTimeout(() => { if (!racine.classList.contains('ia-ouvert')) panneau.hidden = true; }, reduit ? 0 : 260);
    orbe.focus({ preventScroll: true });
  }

  orbe.addEventListener('click', () => (racine.classList.contains('ia-ouvert') ? fermer() : ouvrir()));
  btnFermer.addEventListener('click', fermer);
  panneau.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); fermer(); } });
  btnVoix.addEventListener('click', () => {
    voixActive = !voixActive;
    ecrire(CLE_VOIX, voixActive ? '1' : '0');
    majVoix();
    if (voixActive) { debloquerVoix(); parler('Voix activée.'); } else taire();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = champ.value;
    if (!q.trim() || enCours) return;
    champ.value = '';
    ajuster();
    demander(q);
  });
  champ.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); }
  });
  function ajuster() {
    champ.style.height = '42px';
    const h = Math.min(Math.max(champ.scrollHeight + 2, 42), 120);
    champ.style.height = h + 'px';
    champ.style.overflowY = champ.scrollHeight + 2 > 120 ? 'auto' : 'hidden';
  }
  champ.addEventListener('input', ajuster);
  majVoix();

  // Appelé par acces.js une fois les données déchiffrées.
  window.ASSISTANT = {
    activer(mdp, paquet) {
      donnees = paquet || {};
      contexteTexte = construireContexte(donnees);
      jetonPret = deriver(mdp).then((h) => { jeton = h; return h; }).catch(() => null);
      racine.hidden = false;
      racine.classList.add('ia-appel');
    },
    contexte: () => contexteTexte,
    pourLaVoix,
  };
})();
