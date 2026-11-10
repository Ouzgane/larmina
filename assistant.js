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
  let publieLe = 0, derniereSynchro = 0, synchroEnCours = null;
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
      L.push(`■ ${x.projet}${x.nom_court && x.nom_court !== x.projet ? ' (' + x.nom_court + ')' : ''} [id: ${x.id}]`);
      [
        ['Pôle', x.pole], ['Recommandation du rapport', x.recommandation], ['Décision de l’utilisateur', x.decision], ['Statut', x.statut],
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
    if (window.GERI_VOIX) window.GERI_VOIX.arreter();
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
    const lu = pourLaVoix(texte);
    if (!voixActive) { emettre('texte', { texte: lu }); return; }
    const V = window.GERI_VOIX;
    if (V && V.possible()) {
      if (V.etat() !== 'pret') {
        // Voix encore en téléchargement : sous-titres seuls pour cette réponse.
        V.prechauffer();
        emettre('texte', { texte: lu });
        return;
      }
      const morceaux = decouper(lu);
      if (!morceaux.length) return;
      taire();
      const g = generation;
      emettre('etat', { etat: 'parle' });
      racine.classList.add('ia-parle');
      V.dire(morceaux, {
        segment: (m, duree) => { if (g === generation) emettre('segment', { texte: m, duree }); },
        fin: () => { if (g !== generation) return; racine.classList.remove('ia-parle'); emettre('etat', { etat: 'veille' }); },
        echec: (raison) => {
          if (g !== generation) return;
          racine.classList.remove('ia-parle');
          if (raison === 'bloque' || raison === 'lent') emettre('texte', { texte: lu });
          else parlerSysteme(lu);
        },
      });
      return;
    }
    parlerSysteme(lu);
  }

  // Dernier recours : la synthèse vocale du système (qualité et disponibilité variables).
  function parlerSysteme(lu) {
    if (!synth) { emettre('texte', { texte: lu }); return; }
    const morceaux = decouper(lu);
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
      // La sphère s'anime dès que la réponse arrive, sans attendre le premier son.
      emettre('etat', { etat: 'parle' });
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
    if (parle) parler(texte); else emettre('texte', { texte: pourLaVoix(texte) });
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
    const lien = question.match(/https?:\/\/open\.spotify\.com\/\S+|spotify:[a-z]+:[A-Za-z0-9]{22}/);
    if (lien && window.GERI_MUSIQUE && window.GERI_MUSIQUE.reconnait(lien[0])) {
      window.GERI_MUSIQUE.jouer(lien[0]);
      ajouterAssistant('Je lance ça.');
      return;
    }
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
        body: JSON.stringify({ messages: historique.slice(-HISTORIQUE).map((m) => ({ role: m.role, content: m.content.length > 1900 ? m.content.slice(0, 1899) + '…' : m.content })), contexte: contexteTexte, nom: NOM, playlists: window.GERI_MUSIQUE ? window.GERI_MUSIQUE.playlists() : [] }) };
      if (window.AbortSignal && AbortSignal.timeout) options.signal = AbortSignal.timeout(60000);
      rep = await fetch(RELAIS + '/discuter', options);
      try { corps = await rep.json(); } catch (e) { corps = null; }
      if (!rep.ok) throw Object.assign(new Error(messageErreur(rep.status, corps)), { connue: true });
      const texte = String((corps && corps.reponse) || '').trim() || 'Je n’ai pas de réponse nette. Peux-tu reformuler ?';
      att.retirer();
      historique.push({ role: 'assistant', content: texte });
      historique = historique.slice(-HISTORIQUE * 2);
      ajouterAssistant(texte);
      if (corps && corps.musique && window.GERI_MUSIQUE) {
        if (corps.musique === 'stop') window.GERI_MUSIQUE.arreter(); else window.GERI_MUSIQUE.jouer(corps.musique);
      }
      ((corps && corps.actions) || []).forEach(proposerNotion);
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

  // ── Mises à jour Notion proposées par Geri, écrites seulement après confirmation ──
  const LIBELLES = { decision: 'Décision', statut: 'Statut', prochaine_etape: 'Prochaine étape', echeance: 'Échéance', blocages: 'Blocages', resume: 'Résumé' };
  function valeurLisible(cle, v) {
    if (cle === 'echeance' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [a, m, j] = v.split('-'); return `${+j} ${MOIS[+m - 1]} ${a}`; }
    return v;
  }
  function proposerNotion(action) {
    const projets = (donnees && donnees.projets) || [];
    const p = projets.find((x) => x.id === action.projet);
    if (!p || !action.champs) return;
    const { li, corps } = bulle('ia-msg-ia ia-msg-action', 'Notion');
    const t = document.createElement('b');
    t.textContent = p.projet;
    const ul = document.createElement('ul');
    Object.entries(action.champs).forEach(([cle, v]) => {
      const it = document.createElement('li');
      const l = document.createElement('span');
      l.className = 'ia-action-cle';
      l.textContent = (LIBELLES[cle] || cle) + ' → ';
      it.append(l, document.createTextNode(valeurLisible(cle, v)));
      ul.appendChild(it);
    });
    const boutons = document.createElement('div');
    boutons.className = 'ia-action-boutons';
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'ia-action-ok'; ok.textContent = 'Enregistrer dans Notion';
    const non = document.createElement('button');
    non.type = 'button'; non.className = 'ia-action-non'; non.textContent = 'Ignorer';
    boutons.append(ok, non);
    corps.append(t, ul, boutons);
    defiler();
    emettre('presente', { id: 'projet-' + p.id });
    non.addEventListener('click', () => {
      boutons.replaceChildren(document.createTextNode('Ignoré : rien n’a été écrit.'));
      li.classList.add('ia-action-fini');
    });
    ok.addEventListener('click', async () => {
      ok.disabled = non.disabled = true;
      ok.textContent = 'Enregistrement…';
      try {
        await jetonPret;
        const r = await fetch(RELAIS + '/notion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jeton },
          body: JSON.stringify({ projet: p.id, projet_nom: p.projet, champs: action.champs }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erreur || 'Erreur ' + r.status);
        // Le tableau reflète tout de suite la décision ; le rapport du matin la reprendra depuis Notion.
        Object.assign(p, action.champs);
        contexteTexte = construireContexte(donnees);
        if (window.PILOTAGE && window.PILOTAGE.charger) window.PILOTAGE.charger(donnees);
        synchroniserNotion(true);
        boutons.replaceChildren();
        const fait = document.createElement('span');
        fait.className = 'ia-action-ok-txt';
        fait.textContent = '✓ Enregistré dans Notion';
        boutons.appendChild(fait);
        if (j.url && /^https:\/\/([a-z]+\.)?notion\.(so|com)\//.test(j.url)) {
          const a = document.createElement('a');
          a.href = j.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Ouvrir la fiche';
          boutons.appendChild(a);
        }
        li.classList.add('ia-action-fini');
        emettre('presente', { id: 'projet-' + p.id });
      } catch (e) {
        ok.disabled = non.disabled = false;
        ok.textContent = 'Réessayer';
        let err = boutons.querySelector('.ia-action-err');
        if (!err) { err = document.createElement('span'); err.className = 'ia-action-err'; boutons.appendChild(err); }
        err.textContent = e.message === 'Failed to fetch' ? 'Relais injoignable.' : e.message;
      }
    });
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

  function saluer({ parle = true } = {}) {
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
    ajouterAssistant(texte, { parle });
    const premieres = ['Résume-moi la situation du jour', 'Quel projet accélérer en priorité ?'];
    if (arb.length >= 2) premieres.push(`${arb[0]} ou ${arb[1]} : que choisir ?`);
    else premieres.push('Qu’est-ce qui bloque en ce moment ?');
    puces(premieres);
  }
  const liste = (l) => (l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' et ' + l[l.length - 1]);

  // ── Ouverture, fermeture, saisie ─────────────────────────────────────────────
  // En haut de page (grand écran), le chat est posé à droite de la sphère.
  // Dès que cette zone sort de l'écran, il redevient une bulle en bas à droite.
  const place = document.getElementById('geri-chat');
  const grandEcran = window.matchMedia ? matchMedia('(min-width: 1180px)') : { matches: false };
  let integre = false, placeVisible = true;
  const autorise = () => !navigator.userActivation || navigator.userActivation.hasBeenActive;

  function positionner() {
    if (!integre || !place) return;
    const r = place.getBoundingClientRect();
    Object.assign(panneau.style, { top: (r.top + window.scrollY) + 'px', left: (r.left + window.scrollX) + 'px', width: r.width + 'px', height: r.height + 'px' });
  }

  function majMode() {
    const voulu = !!place && grandEcran.matches && placeVisible && !racine.hidden;
    if (voulu === integre) { positionner(); return; }
    integre = voulu;
    racine.classList.toggle('ia-integre', integre);
    if (integre) {
      amarrer(false);
      panneau.hidden = false;
      racine.classList.remove('ia-appel');
      racine.classList.add('ia-ouvert');
      orbe.setAttribute('aria-expanded', 'true');
      positionner();
      sonder();
      if (!salue) saluer({ parle: autorise() });
    } else {
      ['top', 'left', 'width', 'height'].forEach((k) => { panneau.style[k] = ''; });
      racine.classList.remove('ia-ouvert');
      orbe.setAttribute('aria-expanded', 'false');
      panneau.hidden = true;
    }
  }

  if (place && 'IntersectionObserver' in window) {
    new IntersectionObserver((es) => { placeVisible = es[0].intersectionRatio > 0.3; majMode(); }, { threshold: [0, 0.3, 0.6, 1] }).observe(place);
  }
  if (place && 'ResizeObserver' in window) new ResizeObserver(positionner).observe(place);
  window.addEventListener('resize', () => { majMode(); positionner(); });
  if (grandEcran.addEventListener) grandEcran.addEventListener('change', majMode);

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
  panneau.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !integre) { e.preventDefault(); fermer(); } });
  btnVoix.addEventListener('click', () => {
    voixActive = !voixActive;
    ecrire(CLE_VOIX, voixActive ? '1' : '0');
    majVoix();
    if (voixActive) { debloquerVoix(); if (window.GERI_VOIX) window.GERI_VOIX.prechauffer(); parler('Voix activée.'); } else taire();
  });
  // Avancement du premier téléchargement de la voix, affiché dans l'état du chat.
  document.addEventListener('voix:progres', (e) => { if (!enCours) statut('Voix : préparation ' + Math.round((e.detail.part || 0) * 100) + ' %', 'ia-etat-actif'); });
  document.addEventListener('voix:etat', (e) => {
    if (enCours) return;
    if (e.detail.etat === 'pret') statut('En ligne · voix prête', 'ia-etat-ok');
    else if (e.detail.etat === 'panne') statut('En ligne · voix du navigateur', 'ia-etat-ok');
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

  // Synchronisation avec Notion : le site reprend les décisions et les mises à jour
  // dès qu'elles y sont, qu'elles viennent de Geri ou d'une modification faite dans Notion.
  const normNom = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const CHAMPS_NOTION = ['prochaine_etape', 'echeance', 'blocages', 'resume', 'avancement', 'etape', 'dynamique', 'recommandation',
    'potentiel', 'effort', 'automatisations', 'derniere_activite', 'modele_revenu', 'pole'];
  const TEXTES_NOTION = new Set(['prochaine_etape', 'blocages', 'resume']);
  function appliquerNotion(fiches) {
    const projets = donnees.projets;
    const parNom = new Map(projets.map((p) => [normNom(p.projet), p]));
    let change = false;
    for (const f of fiches) {
      if (!f || !f.nom) continue;
      let p = parNom.get(normNom(f.nom));
      const nouveau = !p;
      if (!p) {
        // Projet ajouté dans Notion depuis le dernier rapport : il apparaît tout de suite.
        const base = normNom(f.nom).replace(/ /g, '-').slice(0, 40) || 'projet';
        let id = base, n = 2;
        while (projets.some((q) => q.id === id)) id = base + '-' + n++;
        p = { id, projet: f.nom, nom_court: f.nom.length > 22 ? f.nom.slice(0, 21) + '…' : f.nom, decision: 'À décider', statut: null, recommandation: 'À arbitrer',
          etape: 'Idée', avancement: 0, dynamique: 'Stable', potentiel: 1, effort: 3, objectif_mensuel: null, resume: '', modele_revenu: '', prochaine_etape: '',
          echeance: null, blocages: '', derniere_activite: null, automatisations: 0, lien: f.lien || f.url || null, lien_libelle: f.lien ? 'Source' : 'Fiche Notion', pole: f.pole || null };
        projets.push(p);
        parNom.set(normNom(f.nom), p);
        change = true;
      }
      // Décision, statut et objectif : toujours ceux de Notion (« À décider » si la décision est vide).
      const maj = { decision: f.decision || 'À décider', statut: f.statut || null, objectif_mensuel: typeof f.objectif_mensuel === 'number' ? f.objectif_mensuel : null };
      // Le reste : ce qu'il y a dans Notion si la fiche a été modifiée après la publication du rapport
      // (par toi, par Geri ou par le rapport du matin).
      if (nouveau || (Date.parse(f.modifie_le || '') || 0) > publieLe) {
        for (const k of CHAMPS_NOTION) {
          if (TEXTES_NOTION.has(k)) maj[k] = f[k] || '';
          else if (k === 'echeance') maj[k] = f[k] || null;
          else if (f[k] !== null && f[k] !== undefined && f[k] !== '') maj[k] = f[k];
        }
      }
      for (const [k, v] of Object.entries(maj)) if (p[k] !== v) { p[k] = v; change = true; }
    }
    return change;
  }
  // Rapports du matin écrits dans Notion : briefing du jour et ligne du jour de chaque projet,
  // pour que le site soit à jour même si la copie chiffrée du dépôt n'a pas été republiée.
  function appliquerRapports(rapports, fiches) {
    if (!rapports.length) return false;
    const syntheses = donnees.syntheses = Array.isArray(donnees.syntheses) ? donnees.syntheses : [];
    const lignes = donnees.rapports = Array.isArray(donnees.rapports) ? donnees.rapports : [];
    const revenus = Array.isArray(donnees.revenus) ? donnees.revenus : [];
    const cumul = (id) => revenus.filter((r) => r.projet_id === id).reduce((t, r) => t + (Number(String(r.montant).replace(',', '.')) || 0), 0);
    const parNom = new Map(fiches.map((f) => [normNom(f.nom), f]));
    const plusRecent = rapports.reduce((a, b) => (b.date > a.date ? b : a));
    let change = false;
    for (const r of rapports) {
      const recent = (Date.parse(r.modifie_le || '') || 0) > publieLe;
      const i = syntheses.findIndex((x) => x.date === r.date);
      if (i < 0 || recent) {
        const s = { date: r.date, titre: r.titre || '', synthese: r.synthese || '', arbitrages: r.arbitrages || '', alertes: r.alertes || '' };
        if (i < 0) { syntheses.push(s); change = true; }
        else if (JSON.stringify(syntheses[i]) !== JSON.stringify(s)) { syntheses[i] = s; change = true; }
      }
      for (const p of donnees.projets || []) {
        const av = r.avancements && r.avancements[p.id];
        let l = lignes.find((x) => x.date === r.date && x.projet_id === p.id);
        if (!l && typeof av !== 'number') continue;
        if (!l) { l = { date: r.date, projet_id: p.id, projet: p.projet }; lignes.push(l); change = true; }
        const maj = {};
        if (typeof av === 'number') maj.avancement = av;
        if (r === plusRecent) {
          // Ligne du jour : complétée par la fiche Notion du projet (fait, risques, étape…).
          const f = parNom.get(normNom(p.projet));
          Object.assign(maj, { etape: p.etape, dynamique: p.dynamique, recommandation: p.recommandation, prochaine_etape: p.prochaine_etape, revenu_cumule: cumul(p.id) });
          if (f && f.fait) maj.fait = f.fait;
          if (f && f.risques) maj.risques = f.risques;
        }
        for (const [k, v] of Object.entries(maj)) if (v !== undefined && l[k] !== v) { l[k] = v; change = true; }
      }
    }
    // Journal des revenus : celui du rapport le plus récent qui le donne (vide = « aucun »).
    const avecRevenus = rapports.filter((r) => Array.isArray(r.encaissements)).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (avecRevenus) {
      const noms = new Map((donnees.projets || []).map((p) => [p.id, p.projet]));
      const neufs = avecRevenus.encaissements.map((e) => ({ date: e.date, projet_id: e.projet_id, projet: noms.get(e.projet_id) || e.projet_id, montant: e.montant, type: e.type || '', note: e.note || '' }));
      if (JSON.stringify(neufs) !== JSON.stringify(donnees.revenus || [])) { donnees.revenus = neufs; change = true; }
    }
    if (change) {
      syntheses.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      lignes.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }
    return change;
  }
  function indiquerSynchro(etat) {
    const el = document.getElementById('notion-synchro');
    if (!el) return;
    if (!etat) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'hud-synchro hud-synchro-' + etat;
    el.textContent = etat === 'ok'
      ? 'Notion à jour à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : 'Notion injoignable : décisions du rapport';
  }
  function synchroniserNotion(force) {
    if (!RELAIS || !donnees || !Array.isArray(donnees.projets)) return Promise.resolve();
    if (synchroEnCours) return synchroEnCours;
    if (!force && Date.now() - derniereSynchro < 30000) return Promise.resolve();
    synchroEnCours = (async () => {
      try {
        await jetonPret;
        if (!jeton) return;
        const r = await fetch(RELAIS + '/projets', { headers: { Authorization: 'Bearer ' + jeton }, cache: 'no-store' });
        if (r.status === 501) { indiquerSynchro(null); return; }
        if (!r.ok) throw new Error('Erreur ' + r.status);
        const j = await r.json();
        derniereSynchro = Date.now();
        const fiches = Array.isArray(j.projets) ? j.projets : [];
        const changeFiches = appliquerNotion(fiches);
        const changeRapports = appliquerRapports(Array.isArray(j.rapports) ? j.rapports : [], fiches);
        if (changeFiches || changeRapports) {
          contexteTexte = construireContexte(donnees);
          if (window.PILOTAGE && window.PILOTAGE.charger) window.PILOTAGE.charger(donnees);
        }
        indiquerSynchro('ok');
      } catch (e) {
        indiquerSynchro('erreur');
      } finally {
        synchroEnCours = null;
      }
    })();
    return synchroEnCours;
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') synchroniserNotion(false); });
  setInterval(() => { if (document.visibilityState === 'visible') synchroniserNotion(true); }, 120000);

  // Appelé par acces.js une fois les données déchiffrées.
  window.ASSISTANT = {
    activer(mdp, paquet, publie) {
      donnees = paquet || {};
      publieLe = Date.parse(publie || '') || 0;
      contexteTexte = construireContexte(donnees);
      jetonPret = deriver(mdp).then((h) => { jeton = h; return h; }).catch(() => null);
      synchroniserNotion(true);
      racine.hidden = false;
      racine.classList.add('ia-appel');
      requestAnimationFrame(majMode);
      if (voixActive && window.GERI_VOIX) setTimeout(() => window.GERI_VOIX.prechauffer(), 1200);
    },
    contexte: () => contexteTexte,
    synchroniser: () => synchroniserNotion(true),
    pourLaVoix,
  };
})();
