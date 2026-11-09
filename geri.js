// Geri au centre de la page : une sphère de particules entourée d'ondes qui s'animent quand elle parle,
// et les indicateurs autour d'elle qui s'allument quand elle les évoque.
// Écoute les événements « geri:* » envoyés par assistant.js ; ne dépend d'aucun modèle.
(function () {
  const scene = document.getElementById('geri-scene');
  if (!scene) return;
  const canvas = scene.querySelector('canvas');
  const ctx = canvas.getContext && canvas.getContext('2d');
  const hero = document.getElementById('indicateurs');
  const liens = document.getElementById('geri-liens');
  const etatTxt = document.getElementById('geri-etat');
  const sujetTxt = document.getElementById('geri-sujet');
  const nomTxt = document.getElementById('geri-nom');
  const reduit = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const CFG = window.PILOTAGE_IA || {};
  const NOM = String(CFG.nom || 'Geri');
  if (nomTxt) nomTxt.textContent = NOM.toUpperCase();
  scene.setAttribute('aria-label', 'Parler à ' + NOM);

  // ── Indicateurs du tableau : valeurs propres à cette page ─────────────────────
  if (window.dash) {
    const eur = (v) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(v) || 0);
    window.dash.draw('k-total', (n) => {
      const k = window.dash.data('kpi');
      if (k.status !== 'ok' || !k.data.length) { n.textContent = '—'; return; }
      n.textContent = eur(k.data[0].total);
      n.classList.remove('dash-skeleton');
    });
  }

  // ── État et énergie de la voix ───────────────────────────────────────────────
  const ETATS = { veille: 'En veille · touche la sphère pour lui parler', reflexion: 'Analyse du tableau…', parle: 'Présentation en cours' };
  let etat = 'veille', energie = 0.04, impulsion = 0, simulationFin = 0;
  function changerEtat(e) {
    etat = e in ETATS ? e : 'veille';
    if (etatTxt) etatTxt.textContent = ETATS[etat];
    hero.classList.toggle('geri-parle', etat === 'parle');
    hero.classList.toggle('geri-reflechit', etat === 'reflexion');
    if (reduit) dessiner(performance.now());
  }

  // ── Sphère ───────────────────────────────────────────────────────────────────
  const N = 760, OR = Math.PI * (3 - Math.sqrt(5));
  const pts = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), phi = i * OR;
    pts.push({ x: Math.cos(phi) * r, y, z: Math.sin(phi) * r, s: Math.random() * Math.PI * 2 });
  }
  let W = 0, H = 0, R = 0, dpr = 1;
  function dimensionner() {
    const b = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, b.width); H = Math.max(1, b.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    R = Math.min(W, H) * 0.26;
  }

  const bruit = (a, t, k) => Math.sin(a * 6 + t * 3.1 + k) * 0.5 + Math.sin(a * 13 - t * 4.7 + k * 2.3) * 0.3 + Math.sin(a * 21 + t * 7.3 + k * 1.7) * 0.2;

  function dessiner(now) {
    if (!ctx || !W) return;
    const t = reduit ? 0 : now / 1000;
    // Énergie : ce que la voix « dégage », pour faire vivre les ondes.
    let cible = 0.05;
    if (etat === 'reflexion') cible = 0.2;
    if (etat === 'parle') cible = 0.42 + 0.38 * (0.5 + 0.5 * Math.sin(t * 16.3)) * (0.5 + 0.5 * Math.sin(t * 5.1 + 1.3)) + impulsion;
    energie += (cible - energie) * (reduit ? 1 : 0.14);
    impulsion *= 0.9;
    const e = Math.min(1.2, energie);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    ctx.globalCompositeOperation = 'lighter';

    // Halo
    const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.1);
    halo.addColorStop(0, `rgba(77,227,255,${0.16 + 0.22 * e})`);
    halo.addColorStop(0.45, `rgba(120,110,255,${0.05 + 0.08 * e})`);
    halo.addColorStop(1, 'rgba(3,9,17,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    // Graduations extérieures
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.05);
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2, long = i % 10 === 0;
      const r1 = R * 1.86, r2 = r1 + (long ? R * 0.07 : R * 0.03);
      ctx.strokeStyle = `rgba(155,239,255,${long ? 0.45 : 0.18})`;
      ctx.lineWidth = long ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); ctx.stroke();
    }
    ctx.restore();

    // Spectre radial : des rayons qui jaillissent quand elle parle
    if (e > 0.12) {
      ctx.save();
      ctx.translate(cx, cy);
      const nb = 96;
      for (let i = 0; i < nb; i++) {
        const a = (i / nb) * Math.PI * 2;
        const v = Math.abs(bruit(a * 2.3, t * 1.7, i * 0.37));
        const l = R * (0.04 + v * 0.34 * (e - 0.08));
        const r1 = R * 1.18;
        ctx.strokeStyle = `rgba(${i % 2 ? '180,140,255' : '77,227,255'},${0.25 + 0.5 * v * e})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.lineTo(Math.cos(a) * (r1 + l), Math.sin(a) * (r1 + l)); ctx.stroke();
      }
      ctx.restore();
    }

    // Ondes circulaires
    const couleurs = ['77,227,255', '180,140,255', '220,250,255'];
    for (let k = 0; k < 3; k++) {
      const base = R * (1.32 + k * 0.15);
      const amp = R * (0.012 + e * (0.15 - k * 0.035));
      for (const [larg, alpha] of [[6, 0.08], [1.6, 0.75]]) {
        ctx.strokeStyle = `rgba(${couleurs[k]},${alpha * (0.45 + 0.55 * Math.min(1, e + 0.3))})`;
        ctx.lineWidth = larg;
        ctx.beginPath();
        for (let i = 0; i <= 180; i++) {
          const a = (i / 180) * Math.PI * 2;
          const r = base + amp * bruit(a, t * (1.4 + k * 0.5), k * 2.1);
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Arcs de réflexion
    if (etat === 'reflexion') {
      for (let k = 0; k < 3; k++) {
        const r = R * (1.2 + k * 0.08), d = t * (2.2 - k * 0.5) * (k % 2 ? -1 : 1) + k * 2;
        ctx.strokeStyle = `rgba(155,239,255,${0.7 - k * 0.15})`;
        ctx.lineWidth = 2.4 - k * 0.5;
        ctx.beginPath(); ctx.arc(cx, cy, r, d, d + 0.9); ctx.stroke();
      }
    }

    // Anneaux orbitaux inclinés
    for (let k = 0; k < 2; k++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((k ? -0.55 : 0.35) + t * (k ? -0.12 : 0.09));
      ctx.scale(1, 0.32);
      ctx.setLineDash([R * 0.05, R * 0.07]);
      ctx.strokeStyle = `rgba(${k ? '180,140,255' : '77,227,255'},${0.32 + 0.3 * e})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, R * (1.12 + k * 0.1), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.setLineDash([]);

    // Particules de la sphère
    const vit = etat === 'parle' ? 0.55 : etat === 'reflexion' ? 0.9 : 0.22;
    const ya = t * vit, xa = 0.38;
    const cyA = Math.cos(ya), syA = Math.sin(ya), cxA = Math.cos(xa), sxA = Math.sin(xa);
    for (const p of pts) {
      const gonfle = 1 + e * 0.075 * Math.sin(p.s * 7 + t * 9) + (etat === 'parle' ? e * 0.03 : 0);
      let x = p.x * cyA + p.z * syA, z = -p.x * syA + p.z * cyA;
      const y = p.y * cxA - z * sxA; z = p.y * sxA + z * cxA;
      const f = 2.8 / (2.8 - z);
      const px = cx + x * R * gonfle * f, py = cy + y * R * gonfle * f;
      const prof = (z + 1) / 2;
      const m = (p.y + 1) / 2;
      const rC = Math.round(77 + (180 - 77) * m), gC = Math.round(227 + (140 - 227) * m);
      ctx.fillStyle = `rgba(${rC},${gC},255,${0.12 + prof * 0.75})`;
      const taille = 0.5 + prof * 1.5;
      ctx.beginPath(); ctx.arc(px, py, taille, 0, Math.PI * 2); ctx.fill();
    }

    // Cœur lumineux
    const coeur = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.75);
    coeur.addColorStop(0, `rgba(235,252,255,${0.55 + 0.4 * e})`);
    coeur.addColorStop(0.25, `rgba(77,227,255,${0.25 + 0.3 * e})`);
    coeur.addColorStop(1, 'rgba(77,227,255,0)');
    ctx.fillStyle = coeur;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.75, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Boucle d'animation, suspendue hors écran, onglet caché ou page verrouillée.
  let visible = true, boucle = 0;
  function tourner(now) {
    boucle = 0;
    if (simulationFin && now > simulationFin) { simulationFin = 0; changerEtat('veille'); }
    dessiner(now);
    planifier();
  }
  function planifier() {
    if (reduit || boucle || !visible || document.hidden) return;
    boucle = requestAnimationFrame(tourner);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; planifier(); }).observe(scene);
  }
  document.addEventListener('visibilitychange', planifier);
  let attente = 0;
  const redimensionner = () => { clearTimeout(attente); attente = setTimeout(() => { dimensionner(); dessiner(performance.now()); }, 60); };
  if ('ResizeObserver' in window) new ResizeObserver(redimensionner).observe(canvas);
  else window.addEventListener('resize', redimensionner);
  dimensionner();
  dessiner(performance.now());
  planifier();

  // ── Présentation des indicateurs ─────────────────────────────────────────────
  const CIBLES = [
    { id: 'kpi-total', motif: /revenus?|encaiss|chiffre d.affaires|\d[\d\s  .,]*(k\s?)?(€|euros?\b)|mille euros/gi },
    { id: 'kpi-30j', motif: /30 (derniers )?jours|ce mois|mensuel/gi },
    { id: 'kpi-decisions', motif: /d[ée]cision|arbitr|trancher|d[ée]cider/gi },
    { id: 'kpi-avancement', motif: /avancement|progress|\d+\s?%|pour ?cent/gi },
    { id: 'kpi-automatisations', motif: /automatis|t[âa]ches? planifi/gi },
    { id: 'kpi-proche', motif: /premier euro|plus proche/gi },
  ];
  const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function ciblesProjets() {
    const d = window.dash && window.dash.data('projets');
    const k = window.dash && window.dash.data('kpi');
    if (!d || d.status !== 'ok') return [];
    const proche = k && k.status === 'ok' && k.data.length ? k.data[0].proche_projet : null;
    return d.data.map((p) => {
      const noms = [...new Set([p.projet, p.nom_court].filter((n) => n && String(n).length > 2))].map((n) => echapper(String(n)));
      if (!noms.length) return null;
      return { id: 'projet-' + p.id, pod: p.projet === proche || p.nom_court === proche ? 'kpi-proche' : null, libelle: p.nom_court || p.projet, motif: new RegExp('(' + noms.join('|') + ')', 'gi') };
    }).filter(Boolean);
  }
  function mentions(texte) {
    const vues = [];
    for (const c of CIBLES.concat(ciblesProjets())) {
      c.motif.lastIndex = 0;
      const m = c.motif.exec(texte);
      if (m) vues.push({ index: m.index, cible: c });
    }
    return vues.sort((a, b) => a.index - b.index);
  }

  const minuteries = [];
  function arreterPresentations() { minuteries.splice(0).forEach(clearTimeout); }
  function programmer(texte, duree) {
    mentions(texte).forEach((m, i) => {
      const delai = Math.max(0, (m.index / Math.max(1, texte.length)) * duree) + i * 60;
      minuteries.push(setTimeout(() => presenter(m.cible), delai));
    });
  }

  function libelleDe(el, cible) {
    if (cible.libelle) return cible.libelle;
    const l = el && el.querySelector('.hud-pod-label');
    return l ? l.textContent : '';
  }

  function presenter(cible) {
    const ids = [cible.id, cible.pod].filter(Boolean);
    let premier = null;
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      premier = premier || el;
      el.classList.remove('geri-presente');
      void el.offsetWidth;
      el.classList.add('geri-presente');
      clearTimeout(el._geri);
      el._geri = setTimeout(() => el.classList.remove('geri-presente'), 2600);
      if (el.classList.contains('hud-pod')) relier(el);
    });
    impulsion = Math.min(0.5, impulsion + 0.25);
    if (sujetTxt && premier) {
      sujetTxt.textContent = libelleDe(premier, cible);
      sujetTxt.classList.add('geri-sujet-on');
      clearTimeout(sujetTxt._geri);
      sujetTxt._geri = setTimeout(() => sujetTxt.classList.remove('geri-sujet-on'), 2400);
    }
  }

  // Trait lumineux de la sphère vers l'indicateur présenté.
  const NS = 'http://www.w3.org/2000/svg';
  function relier(el) {
    if (!liens || !hero) return;
    const h = hero.getBoundingClientRect(), s = canvas.getBoundingClientRect(), b = el.getBoundingClientRect();
    if (!s.width || !b.width) return;
    const cx = s.left + s.width / 2 - h.left, cy = s.top + s.height / 2 - h.top;
    const bx = b.left + b.width / 2 - h.left, by = b.top + b.height / 2 - h.top;
    const ang = Math.atan2(by - cy, bx - cx), rS = Math.min(s.width, s.height) * 0.26 * 1.5;
    const sx = cx + Math.cos(ang) * rS, sy = cy + Math.sin(ang) * rS;
    // Point d'arrivée : le bord de la carte face à la sphère.
    const ex = Math.abs(bx - cx) > b.width / 2 ? (bx > cx ? b.left - h.left : b.right - h.left) : bx;
    const ey = Math.abs(bx - cx) > b.width / 2 ? by : (by > cy ? b.top - h.top : b.bottom - h.top);
    const mx = (sx + ex) / 2, my = sy + (ey - sy) * 0.15;
    liens.setAttribute('viewBox', `0 0 ${h.width} ${h.height}`);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'geri-lien');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', `M${sx.toFixed(1)},${sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`);
    const halo = p.cloneNode();
    halo.setAttribute('class', 'geri-lien-halo');
    const point = document.createElementNS(NS, 'circle');
    point.setAttribute('cx', ex.toFixed(1)); point.setAttribute('cy', ey.toFixed(1)); point.setAttribute('r', '4');
    g.append(halo, p, point);
    liens.appendChild(g);
    setTimeout(() => g.remove(), 2600);
  }

  // ── Événements envoyés par l'assistante ──────────────────────────────────────
  document.addEventListener('geri:etat', (e) => {
    if (e.detail && e.detail.etat !== 'parle') { arreterPresentations(); simulationFin = 0; }
    changerEtat(e.detail && e.detail.etat);
    planifier();
  });
  document.addEventListener('geri:mot', () => { impulsion = Math.min(0.55, impulsion + 0.18); });
  // Un morceau de phrase commence à être lu : on présente ce qu'il évoque au fil de la lecture.
  document.addEventListener('geri:segment', (e) => { if (e.detail) programmer(e.detail.texte, e.detail.duree); });
  // Réponse affichée sans voix : la sphère « parle » le temps de la lecture et présente quand même.
  document.addEventListener('geri:texte', (e) => {
    if (!e.detail || !e.detail.texte) return;
    arreterPresentations();
    const duree = Math.min(14000, Math.max(1800, e.detail.texte.length * 55));
    changerEtat('parle');
    simulationFin = performance.now() + duree;
    programmer(e.detail.texte, duree);
    planifier();
    if (reduit) setTimeout(() => changerEtat('veille'), duree);
  });

  // La sphère ouvre la conversation.
  scene.addEventListener('click', () => {
    const ia = document.getElementById('ia');
    const orbe = document.getElementById('ia-orbe');
    if (!ia || ia.hidden || !orbe) return;
    if (orbe.getAttribute('aria-expanded') !== 'true') orbe.click();
    else { const champ = document.getElementById('ia-champ'); if (champ) champ.focus(); }
  });

  changerEtat('veille');
  window.GERI = { presenter: (id) => presenter({ id }), mentions };
})();
