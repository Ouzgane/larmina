// Voix de Geri : synthèse Piper dans un worker, lecture par Web Audio.
// Le niveau sonore réel alimente la sphère (window.GERI_NIVEAU). Si la voix ne peut pas se charger,
// assistant.js revient à la synthèse vocale du système.
(function () {
  const CFG = window.PILOTAGE_IA || {};
  const VOIX = String(CFG.voixPiper || 'fr_FR-siwis-medium');
  const BASE = CFG.voixSource || '';
  const AC = window.AudioContext || window.webkitAudioContext;
  const possible = !!(AC && window.Worker && typeof WebAssembly === 'object' && typeof BigInt64Array !== 'undefined');

  let worker = null, ctx = null, analyseur = null, tampon = null;
  let etat = possible ? 'inactif' : 'indisponible'; // inactif → chargement → pret | panne
  let lecture = null, numero = 0;
  const avis = (type, detail) => document.dispatchEvent(new CustomEvent('voix:' + type, { detail: detail || {} }));

  function demarrer() {
    if (worker || !possible) return;
    try {
      worker = new Worker('voix-worker.js?v=20261110c');
    } catch (e) { etat = 'panne'; return; }
    worker.onmessage = recevoir;
    worker.onerror = (e) => { etat = 'panne'; avis('etat', { etat }); if (lecture) echouer('panne', e.message); };
  }

  // À appeler pendant un geste de l'utilisateur : le navigateur n'autorise le son qu'après un clic.
  function debloquer() {
    if (!possible) return;
    try {
      if (!ctx) {
        ctx = new AC();
        analyseur = ctx.createAnalyser();
        analyseur.fftSize = 1024;
        analyseur.smoothingTimeConstant = 0.4;
        analyseur.connect(ctx.destination);
        tampon = new Float32Array(analyseur.fftSize);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { /* pas de son possible */ }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((t) => document.addEventListener(t, debloquer, { capture: true, passive: true }));

  function prechauffer() {
    if (!possible || etat === 'pret' || etat === 'chargement' || etat === 'panne') return;
    demarrer();
    if (!worker) return;
    etat = 'chargement';
    avis('etat', { etat });
    worker.postMessage({ type: 'preparer', voix: VOIX, base: BASE });
  }

  function recevoir(e) {
    const m = e.data || {};
    if (m.type === 'progres') { avis('progres', { part: m.part }); return; }
    if (m.type === 'pret') { etat = 'pret'; avis('etat', { etat }); return; }
    if (m.type === 'erreur') {
      if (etat !== 'pret') { etat = 'panne'; avis('etat', { etat, message: m.message }); }
      if (lecture && (!m.id || m.id === lecture.id)) echouer('panne', m.message);
      return;
    }
    if (!lecture || m.id !== lecture.id) return;
    if (m.type === 'audio') {
      lecture.audios[m.index] = m.vide ? { vide: true } : { data: m.audio, frequence: m.frequence };
      clearTimeout(lecture.minuterie);
      jouerSuivant();
    } else if (m.type === 'fin') {
      lecture.fini = true;
      jouerSuivant();
    }
  }

  function jouerSuivant() {
    const l = lecture;
    if (!l || l.enCours) return;
    if (l.prochain >= l.phrases.length) { if (l.fini || l.prochain >= l.phrases.length) terminer(); return; }
    const a = l.audios[l.prochain];
    if (!a) return;
    if (a.vide) { l.prochain++; jouerSuivant(); return; }
    const buf = ctx.createBuffer(1, a.data.length, a.frequence);
    buf.copyToChannel(a.data, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(analyseur);
    src.onended = () => {
      if (lecture !== l) return;
      l.enCours = false;
      l.source = null;
      l.prochain++;
      jouerSuivant();
    };
    l.enCours = true;
    l.source = src;
    src.start();
    if (l.rappels.segment) l.rappels.segment(l.phrases[l.prochain], buf.duration * 1000, l.prochain === 0);
  }

  function terminer() {
    const l = lecture;
    lecture = null;
    if (l && l.rappels.fin) l.rappels.fin();
  }

  function echouer(raison, message) {
    const l = lecture;
    lecture = null;
    if (l) { clearTimeout(l.minuterie); if (l.rappels.echec) l.rappels.echec(raison, message); }
  }

  // phrases : textes déjà préparés pour la lecture ; rappels : { segment, fin, echec }
  function dire(phrases, rappels) {
    arreter();
    if (!possible || etat === 'panne') { if (rappels.echec) rappels.echec('panne'); return; }
    if (!ctx || ctx.state !== 'running') { if (rappels.echec) rappels.echec('bloque'); return; }
    demarrer();
    if (etat === 'inactif') { etat = 'chargement'; avis('etat', { etat }); }
    const id = ++numero;
    lecture = { id, phrases, audios: [], prochain: 0, enCours: false, fini: false, source: null, rappels };
    // Premier chargement : jusqu'à ~90 Mo à télécharger ; ensuite quelques secondes au plus.
    lecture.minuterie = setTimeout(() => { if (lecture && lecture.id === id && !lecture.audios.length) echouer('lent'); }, etat === 'pret' ? 20000 : 180000);
    worker.postMessage({ type: 'dire', id, voix: VOIX, base: BASE, phrases, vitesse: Number(CFG.voixVitesse) || 1 });
  }

  function arreter() {
    if (!lecture) return;
    const l = lecture;
    lecture = null;
    clearTimeout(l.minuterie);
    if (l.source) { try { l.source.onended = null; l.source.stop(); } catch (e) { /* déjà arrêté */ } }
    if (worker) worker.postMessage({ type: 'annuler' });
  }

  // Niveau sonore instantané (0 à 1) de ce que Geri est en train de dire.
  function niveau() {
    if (!analyseur || !lecture || !lecture.enCours) return null;
    analyseur.getFloatTimeDomainData(tampon);
    let s = 0;
    for (let i = 0; i < tampon.length; i++) s += tampon[i] * tampon[i];
    return Math.sqrt(s / tampon.length);
  }

  window.GERI_VOIX = { possible: () => possible && etat !== 'panne', etat: () => etat, debloquer, prechauffer, dire, arreter, niveau };
  window.GERI_NIVEAU = niveau;
})();
