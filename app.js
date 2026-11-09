// Pilotage des projets : calculs et dessins.

dash.calc('revenu_par_projet', {
  title: 'Revenu par projet',
  description: 'Somme des encaissements du journal des revenus pour chaque projet : au total et sur les 30 derniers jours.',
  inputs: ['projets', 'revenus'],
  fn: (projets, revenus) => {
    const montant = (ligne) => {
      const n = Number(String(ligne.montant ?? '').replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : 0;
    };
    const depuis30j = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    return projets.map((projet) => {
      const lignes = revenus.filter((ligne) => ligne.projet_id === projet.id);
      return {
        id: projet.id,
        projet: projet.projet,
        revenu_cumule: lignes.reduce((total, ligne) => total + montant(ligne), 0),
        revenu_30j: lignes.filter((ligne) => String(ligne.date) >= depuis30j).reduce((total, ligne) => total + montant(ligne), 0),
        objectif_mensuel: projet.objectif_mensuel ?? null,
      };
    });
  },
});

dash.calc('kpi', {
  title: 'Indicateurs du portefeuille',
  description: 'Revenu total, revenu sur 30 jours et les 30 jours précédents, projets qui rapportent, décisions en attente et prises, projet le plus proche du premier euro, avancement moyen, tâches planifiées actives.',
  inputs: ['projets', 'revenus'],
  fn: (projets, revenus) => {
    const montant = (ligne) => {
      const n = Number(String(ligne.montant ?? '').replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : 0;
    };
    const jour = 86400000;
    const depuis30j = new Date(Date.now() - 30 * jour).toISOString().slice(0, 10);
    const depuis60j = new Date(Date.now() - 60 * jour).toISOString().slice(0, 10);
    const somme = (lignes) => lignes.reduce((total, ligne) => total + montant(ligne), 0);
    const avecRevenu = new Set(revenus.filter((ligne) => montant(ligne) > 0).map((ligne) => ligne.projet_id));
    const sansRevenu = projets
      .filter((projet) => !avecRevenu.has(projet.id) && projet.decision !== 'Arrêter')
      .sort((a, b) => Number(b.avancement) - Number(a.avancement));
    return [{
      total: somme(revenus),
      total_30j: somme(revenus.filter((ligne) => String(ligne.date) >= depuis30j)),
      total_30j_precedents: somme(revenus.filter((ligne) => String(ligne.date) >= depuis60j && String(ligne.date) < depuis30j)),
      nb_projets: projets.length,
      nb_avec_revenu: projets.filter((projet) => avecRevenu.has(projet.id)).length,
      nb_a_decider: projets.filter((projet) => projet.decision === 'À décider').length,
      proche_projet: sansRevenu.length ? sansRevenu[0].projet : null,
      proche_avancement: sansRevenu.length ? Number(sansRevenu[0].avancement) : null,
      avancement_moyen: projets.length ? Math.round(projets.reduce((t, projet) => t + (Number(projet.avancement) || 0), 0) / projets.length) : 0,
      nb_decides: projets.filter((projet) => projet.decision && projet.decision !== 'À décider').length,
      nb_automatisations: projets.reduce((t, projet) => t + (Number(projet.automatisations) || 0), 0),
    }];
  },
});

dash.calc('revenu_mensuel', {
  title: 'Encaissements par mois',
  description: 'Somme des encaissements du journal des revenus, mois par mois.',
  inputs: ['revenus'],
  fn: (revenus) => {
    const parMois = new Map();
    for (const ligne of revenus) {
      const mois = String(ligne.date ?? '').slice(0, 7);
      const n = Number(String(ligne.montant ?? '').replace(/\s/g, '').replace(',', '.'));
      if (!/^\d{4}-\d{2}$/.test(mois) || !Number.isFinite(n)) continue;
      parMois.set(mois, (parMois.get(mois) ?? 0) + n);
    }
    return [...parMois].sort((a, b) => a[0].localeCompare(b[0])).map(([mois, montant]) => ({ mois, montant }));
  },
});

// ---------- Outils partagés ----------
const PP = { pole: '', tri: 'potentiel', ouverts: new Set(), deja: new Set() };
const C = { cyan: '#4de3ff', cyan2: '#9befff', ok: '#3dffb0', warn: '#ffbe4d', bad: '#ff4f6e', pause: '#8b93b8', violet: '#b48cff', text: '#dcf6ff', muted: '#84a7bd' };
const SERIES = ['#4de3ff', '#ff5fd2', '#ffbe4d', '#3dffb0', '#b48cff', '#ff8a3d', '#38f0d0', '#ff6b8b', '#7aa7ff', '#e6ff5c'];
const mouvement = () => !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const survol = () => !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);
const premiereFois = (cle) => { if (PP.deja.has(cle)) return false; PP.deja.add(cle); return true; };
const frNum = d3.formatLocale({ decimal: ',', thousands: ' ', grouping: [3], currency: ['', ' €'] });
const frTemps = d3.timeFormatLocale({
  dateTime: '%A %e %B %Y à %X', date: '%d/%m/%Y', time: '%H:%M:%S', periods: ['', ''],
  days: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  shortDays: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
  months: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  shortMonths: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
});
const parseJour = d3.utcParse('%Y-%m-%d');
const fmtJourLong = frTemps.utcFormat('%A %-d %B %Y');
const fmtJour = frTemps.utcFormat('%-d %b %Y');
const fmtJourCourt = frTemps.utcFormat('%-d %b');
const fmtMois = frTemps.utcFormat('%b %Y');
const euros = (v) => {
  const n = Number(v) || 0;
  return frNum.format(Number.isInteger(n) ? '$,.0f' : '$,.2f')(n);
};
const jourLisible = (s, f = fmtJour) => { const d = parseJour(String(s ?? '')); return d ? f(d) : '—'; };
const RECO = { 'Accélérer': C.ok, 'Maintenir': C.cyan, 'À arbitrer': C.warn, 'Mettre en pause': C.pause, 'Arrêter': C.bad };
const DYN = { 'En hausse': C.ok, 'Stable': C.cyan, 'Au ralenti': C.warn, 'Au point mort': C.bad };
const recoCouleur = (r) => RECO[r] || C.pause;
const dynCouleur = (d) => DYN[d] || C.pause;
const statut = (...ids) => {
  for (const id of ids) { const s = dash.data(id).status; if (s !== 'ok') return s; }
  return 'ok';
};
const el = (tag, cls, texte) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (texte !== undefined && texte !== null) n.textContent = String(texte);
  return n;
};
const messageEtat = (s) => el('p', 'hud-empty', s === 'loading' ? 'Chargement des données…' : s === 'error' ? 'Échec du chargement' : s === 'connect' ? '' : '—');
const largeurTexte = (node, texte) => {
  let w = 0;
  try { w = node.getComputedTextLength ? node.getComputedTextLength() : 0; } catch (e) { w = 0; }
  return w || String(texte).length * 7;
};
const marquer = (n, source, champ, ou) => {
  n.setAttribute('data-source', source);
  n.setAttribute('data-field', champ);
  if (ou) n.setAttribute('data-where', ou);
  return n;
};
const ouId = (id) => 'id=' + encodeURIComponent(id);
const lignesTexte = (v) => String(v ?? '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
const derniersRapports = (rapports) => {
  const parProjet = new Map();
  for (const r of rapports) {
    const prev = parProjet.get(r.projet_id);
    if (!prev || String(r.date) > String(prev.date)) parProjet.set(r.projet_id, r);
  }
  return parProjet;
};
const infobulle = (conteneur) => {
  const tip = el('div', 'pp-tip');
  tip.hidden = true;
  conteneur.appendChild(tip);
  return {
    montrer(event, titre, lignes) {
      tip.replaceChildren(el('b', null, titre), ...lignes.map((l) => el('span', null, l)));
      tip.hidden = false;
      const [px, py] = d3.pointer(event, conteneur);
      const w = conteneur.clientWidth;
      const tw = tip.offsetWidth || 220;
      tip.style.left = Math.max(0, Math.min(w - tw, px + 14)) + 'px';
      tip.style.top = Math.max(0, py + 16) + 'px';
    },
    cacher() { tip.hidden = true; },
  };
};
const lueur = (svg, id, ecart = 3) => {
  const f = svg.append('defs').append('filter').attr('id', id).attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
  f.append('feGaussianBlur').attr('stdDeviation', ecart).attr('result', 'b');
  const m = f.append('feMerge');
  m.append('feMergeNode').attr('in', 'b');
  m.append('feMergeNode').attr('in', 'SourceGraphic');
  return `url(#${id})`;
};
const axeStyle = (g) => { g.selectAll('path,line').style('stroke', 'rgba(77,227,255,.28)'); g.selectAll('text').attr('font-size', null).attr('font-family', null); };
const TAPES = new WeakMap();
const taper = (n, texte, cle) => {
  const prev = TAPES.get(n);
  if (prev) { clearInterval(prev); TAPES.delete(n); }
  if (!mouvement() || !premiereFois(cle)) { n.textContent = texte; return; }
  let i = 0;
  const pas = Math.max(1, Math.ceil(texte.length / 110));
  n.textContent = '';
  const id = setInterval(() => {
    i += pas;
    n.textContent = texte.slice(0, i);
    if (i >= texte.length) { clearInterval(id); TAPES.delete(n); }
  }, 18);
  TAPES.set(n, id);
};

// Bascule hologramme / vue plane (contrôle fixe : attributs seulement).
document.querySelectorAll('[data-vue]').forEach((b) => {
  b.addEventListener('click', () => {
    const vue = b.getAttribute('data-vue');
    document.querySelectorAll('[data-vue]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('[data-vue-panel]').forEach((p) => { p.hidden = p.getAttribute('data-vue-panel') !== vue; });
    dash.draw(vue === 'plan' ? 'matrice' : 'holo');
  });
});

// Tri des fiches (contrôle fixe).
document.querySelectorAll('.pp-tri').forEach((sel) => {
  sel.addEventListener('change', () => { PP.tri = sel.value; dash.draw('cartes'); });
});

// ---------- Textes ----------
const texte = (nom, ids, valeur, tape) => {
  dash.draw(nom, (n) => {
    const s = statut(...ids);
    if (s === 'loading') { n.classList.add('dash-skeleton'); n.textContent = '—'; return; }
    n.classList.remove('dash-skeleton');
    if (s !== 'ok') { n.textContent = '—'; return; }
    const v = valeur(...ids.map((id) => dash.data(id).data));
    const t = v === null || v === undefined || v === '' ? '—' : String(v);
    if (tape) taper(n, t, nom); else n.textContent = t;
  });
};
const kpi0 = (k) => (Array.isArray(k) && k.length ? k[0] : {});
const synth0 = (s) => (Array.isArray(s) && s.length ? s[0] : {});

texte('date-rapport', ['syntheses'], (s) => jourLisible(synth0(s).date, fmtJourLong));
texte('lede-nbrev', ['kpi'], (k) => kpi0(k).nb_avec_revenu);
texte('lede-total', ['kpi'], (k) => euros(kpi0(k).total));
texte('lede-proche', ['kpi'], (k) => kpi0(k).proche_projet);
texte('lede-proche-av', ['kpi'], (k) => (kpi0(k).proche_avancement == null ? null : kpi0(k).proche_avancement + ' %'));
texte('lede-dec', ['kpi'], (k) => kpi0(k).nb_a_decider);
texte('k-30j', ['kpi'], (k) => euros(kpi0(k).total_30j));
texte('k-nbrev', ['kpi'], (k) => kpi0(k).nb_avec_revenu);
texte('k-nb', ['kpi'], (k) => kpi0(k).nb_projets);
texte('k-dec', ['kpi'], (k) => kpi0(k).nb_a_decider);
texte('k-decides', ['kpi'], (k) => kpi0(k).nb_decides);
texte('k-avmoy', ['kpi'], (k) => (kpi0(k).avancement_moyen == null ? null : kpi0(k).avancement_moyen + ' %'));
texte('k-auto', ['kpi'], (k) => kpi0(k).nb_automatisations);
texte('s-titre', ['syntheses'], (s) => synth0(s).titre);
texte('s-texte', ['syntheses'], (s) => synth0(s).synthese, true);

dash.draw('lede-switch', () => {
  if (statut('kpi') !== 'ok') return;
  const avec = Number(kpi0(dash.data('kpi').data).nb_avec_revenu) > 0;
  document.querySelectorAll('[data-lede]').forEach((n) => {
    n.hidden = n.getAttribute('data-lede') === 'zero' ? avec : !avec;
  });
});

dash.draw('k-30j-delta', (n) => {
  if (statut('kpi') !== 'ok') { n.textContent = '—'; return; }
  const k = kpi0(dash.data('kpi').data);
  const ecart = (Number(k.total_30j) || 0) - (Number(k.total_30j_precedents) || 0);
  n.replaceChildren();
  const v = el('b', null, ecart === 0 ? 'Stable' : (ecart > 0 ? '+' : '−') + euros(Math.abs(ecart)));
  v.style.color = ecart > 0 ? C.ok : ecart < 0 ? C.bad : C.muted;
  n.append(v, document.createTextNode(' par rapport aux 30 jours précédents'));
});

const liste = (nom, champ) => {
  dash.draw(nom, (n) => {
    if (statut('syntheses') !== 'ok') { n.replaceChildren(); return; }
    const items = lignesTexte(synth0(dash.data('syntheses').data)[champ]);
    const anim = mouvement() && premiereFois(nom);
    n.replaceChildren(...(items.length ? items : ['Rien à signaler.']).map((t, i) => {
      const li = el('li', anim ? 'hud-in' : null, t);
      if (anim) li.style.animationDelay = (0.25 + i * 0.12) + 's';
      return li;
    }));
  });
};
liste('s-arbitrages', 'arbitrages');
liste('s-alertes', 'alertes');

// ---------- Cœur : revenu cumulé et jauges ----------
dash.draw('reacteur', (n) => {
  const s = statut('kpi');
  if (s !== 'ok') { n.replaceChildren(messageEtat(s)); return; }
  const k = kpi0(dash.data('kpi').data);
  const nb = Math.max(1, Number(k.nb_projets) || 0);
  n.replaceChildren();
  const S = Math.max(240, Math.min(420, n.clientWidth || 360));
  const c = S / 2;
  const svg = d3.select(n).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${S} ${S}`).style('max-width', S + 'px').style('margin', '0 auto')
    .attr('role', 'img').attr('aria-label', `Revenu cumulé ${euros(k.total)}. Projets qui rapportent ${k.nb_avec_revenu} sur ${k.nb_projets}. Avancement moyen ${k.avancement_moyen} %. Décisions prises ${k.nb_decides} sur ${k.nb_projets}.`);
  const glow = lueur(svg, 'hud-glow-core', 4);
  const grad = svg.select('defs').append('radialGradient').attr('id', 'hud-core-grad');
  grad.append('stop').attr('offset', '0%').attr('stop-color', C.cyan).attr('stop-opacity', 0.45);
  grad.append('stop').attr('offset', '55%').attr('stop-color', C.cyan).attr('stop-opacity', 0.08);
  grad.append('stop').attr('offset', '100%').attr('stop-color', C.cyan).attr('stop-opacity', 0);
  const g = svg.append('g').attr('transform', `translate(${c},${c})`);
  // Anneaux décoratifs
  g.append('g').attr('class', 'hud-spin').append('circle').attr('r', S * 0.47).style('fill', 'none').style('stroke', C.cyan).style('stroke-opacity', 0.35).attr('stroke-dasharray', '2 7');
  g.append('circle').attr('r', S * 0.44).style('fill', 'none').style('stroke', C.cyan).style('stroke-opacity', 0.14);
  const ticks = g.append('g').attr('class', 'hud-spin-rev');
  ticks.append('circle').attr('r', S * 0.425).style('fill', 'none').style('stroke', 'none');
  d3.range(72).forEach((i) => {
    const a = (i / 72) * 2 * Math.PI, r1 = S * 0.405, r2 = S * (i % 6 === 0 ? 0.43 : 0.418);
    ticks.append('line').attr('x1', Math.cos(a) * r1).attr('y1', Math.sin(a) * r1).attr('x2', Math.cos(a) * r2).attr('y2', Math.sin(a) * r2)
      .style('stroke', C.cyan).style('stroke-opacity', i % 6 === 0 ? 0.7 : 0.3);
  });
  const fast = g.append('g').attr('class', 'hud-spin-fast');
  fast.append('circle').attr('r', S * 0.385).style('fill', 'none').style('stroke', 'none');
  fast.append('path').attr('d', d3.arc()({ innerRadius: S * 0.38, outerRadius: S * 0.385, startAngle: 0, endAngle: Math.PI / 3 })).style('fill', C.cyan2).style('opacity', 0.8).attr('filter', glow);
  fast.append('path').attr('d', d3.arc()({ innerRadius: S * 0.38, outerRadius: S * 0.385, startAngle: Math.PI, endAngle: Math.PI * 1.2 })).style('fill', C.cyan2).style('opacity', 0.5);
  // Jauges de données
  const jauges = [
    { r: S * 0.345, v: (Number(k.nb_avec_revenu) || 0) / nb, col: C.ok, champ: 'nb_avec_revenu' },
    { r: S * 0.295, v: (Number(k.avancement_moyen) || 0) / 100, col: C.cyan, champ: 'avancement_moyen' },
    { r: S * 0.245, v: (Number(k.nb_decides) || 0) / nb, col: C.violet, champ: 'nb_decides' },
  ];
  const ep = S * 0.026;
  const anim = mouvement() && premiereFois('reacteur');
  for (const j of jauges) {
    g.append('circle').attr('r', j.r).style('fill', 'none').style('stroke', j.col).style('stroke-opacity', 0.12).style('stroke-width', ep);
    const arc = d3.arc().innerRadius(j.r - ep / 2).outerRadius(j.r + ep / 2).cornerRadius(ep / 2).startAngle(0);
    const p = g.append('path').style('fill', j.col).attr('filter', glow);
    marquer(p.node(), 'kpi', j.champ, null);
    p.node().setAttribute('data-row', '0');
    const fin = Math.max(0.0001, Math.min(1, j.v)) * 2 * Math.PI;
    if (anim) {
      p.attr('d', arc({ endAngle: 0.0001 })).transition().delay(200).duration(1500).ease(d3.easeCubicOut)
        .attrTween('d', () => (t) => arc({ endAngle: 0.0001 + (fin - 0.0001) * t }));
    } else {
      p.attr('d', arc({ endAngle: fin }));
    }
    if (j.v <= 0) g.append('circle').attr('cx', 0).attr('cy', -j.r).attr('r', ep / 2).style('fill', j.col).attr('class', 'hud-glowdot');
  }
  // Noyau
  g.append('circle').attr('class', 'hud-breathe').attr('r', S * 0.2).style('fill', 'url(#hud-core-grad)');
  g.append('circle').attr('r', S * 0.19).style('fill', 'rgba(3,14,26,.7)').style('stroke', C.cyan).style('stroke-opacity', 0.5);
  g.append('text').attr('y', -S * 0.06).attr('text-anchor', 'middle').style('fill', C.muted).style('font-size', Math.round(S * 0.028) + 'px').style('letter-spacing', '.2em').text('REVENU CUMULÉ');
  const val = g.append('text').attr('y', S * 0.03).attr('text-anchor', 'middle').style('fill', '#ffffff').style('font-size', Math.round(S * 0.085) + 'px')
    .attr('filter', glow).text(euros(k.total));
  marquer(val.node(), 'kpi', 'total', null);
  val.node().setAttribute('data-row', '0');
  const sous = g.append('text').attr('y', S * 0.085).attr('text-anchor', 'middle').style('fill', C.cyan).style('font-size', Math.round(S * 0.03) + 'px').style('letter-spacing', '.08em');
  sous.text((Number(k.nb_avec_revenu) || 0) > 0 ? `${k.nb_avec_revenu} PROJET(S) EN REVENU` : 'EN ATTENTE DU 1ER EURO');
});

// ---------- Hologramme 3D ----------
dash.draw('holo', {
  mount(n) {
    const wrap = el('div', 'hud-holo-wrap');
    const cv = document.createElement('canvas');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'Hologramme : chaque projet est une colonne. Position au sol selon l\'avancement et l\'effort restant, hauteur selon le potentiel à 12 mois, couleur selon la recommandation.');
    wrap.appendChild(cv);
    const msg = el('div', 'hud-holo-msg');
    msg.hidden = true;
    n.append(wrap, msg);
    const st = { n, cv, msg, ctx: cv.getContext ? cv.getContext('2d') : null, tip: infobulle(n), angle: -0.55, pitch: 0.55,
      drag: null, hover: null, pts: [], projets: [], revenus: new Map(), w: 0, h: 0, dpr: 1, raf: 0, t0: 0, visible: true, anim: mouvement() };
    const touche = (e) => {
      if (!st.pts.length) return null;
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, dmin = 26;
      for (const p of st.pts) { const d = Math.hypot(p.sx - x, p.sy - y); if (d < dmin) { dmin = d; best = p; } }
      return best;
    };
    cv.addEventListener('pointerdown', (e) => { st.drag = { x: e.clientX, y: e.clientY, a: st.angle, p: st.pitch }; if (cv.setPointerCapture) cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (st.drag) {
        st.angle = st.drag.a + (e.clientX - st.drag.x) * 0.008;
        if (e.pointerType === 'mouse') st.pitch = Math.max(0.2, Math.min(1.15, st.drag.p + (e.clientY - st.drag.y) * 0.004));
        st.tip.cacher();
        if (!st.anim) rendreHolo(st, performance.now());
        return;
      }
      const p = touche(e);
      st.hover = p ? p.p.id : null;
      if (p) {
        const r = st.revenus.get(p.p.id);
        st.tip.montrer(e, p.p.projet, [
          `Recommandation : ${p.p.recommandation || '—'}`,
          `Ta décision : ${p.p.decision || '—'}`,
          `Avancement ${p.p.avancement} % · potentiel ${p.p.potentiel}/5 · effort ${p.p.effort}/5`,
          `Revenu cumulé : ${euros(r ? r.revenu_cumule : 0)}`,
        ]);
      } else st.tip.cacher();
      if (!st.anim) rendreHolo(st, performance.now());
    });
    const fin = () => { st.drag = null; };
    cv.addEventListener('pointerup', fin);
    cv.addEventListener('pointercancel', fin);
    cv.addEventListener('pointerleave', () => { st.hover = null; st.tip.cacher(); if (!st.anim) rendreHolo(st, performance.now()); });
    if (window.IntersectionObserver) {
      st.io = new IntersectionObserver((es) => { st.visible = es.some((x) => x.isIntersecting); });
      st.io.observe(cv);
    }
    if (st.ctx && st.anim) {
      const boucle = (t) => {
        if (!st.t0) st.t0 = t;
        if (st.visible && st.w) { if (!st.drag) st.angle += 0.0022; rendreHolo(st, t); }
        st.raf = requestAnimationFrame(boucle);
      };
      st.raf = requestAnimationFrame(boucle);
    }
    return st;
  },
  update(n, st) {
    const s = statut('projets', 'revenu_par_projet');
    st.projets = s === 'ok' ? dash.data('projets').data : [];
    st.revenus = s === 'ok' ? new Map((dash.data('revenu_par_projet').data || []).map((r) => [r.id, r])) : new Map();
    if (!st.ctx) { st.msg.hidden = false; st.msg.textContent = 'Affichage 3D indisponible sur cet appareil : passe en vue plane.'; return; }
    st.msg.hidden = s === 'ok';
    st.msg.textContent = s === 'loading' ? 'Chargement des données…' : s === 'error' ? 'Échec du chargement' : '';
    const w = n.clientWidth || 0;
    if (!w) return;
    const h = Math.round(Math.max(320, Math.min(500, w * 0.58)));
    st.dpr = Math.min(2, window.devicePixelRatio || 1);
    st.w = w; st.h = h;
    st.cv.width = Math.round(w * st.dpr); st.cv.height = Math.round(h * st.dpr);
    st.cv.style.height = h + 'px';
    rendreHolo(st, performance.now());
  },
  unmount(n, st) {
    if (st.raf) cancelAnimationFrame(st.raf);
    if (st.io) st.io.disconnect();
  },
});

function rendreHolo(st, t) {
  const { ctx, w, h, dpr } = st;
  if (!ctx || !w) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.6, f = Math.min(w * 1.05, h * 1.7);
  const ca = Math.cos(st.angle), sa = Math.sin(st.angle), cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
  const proj = (x, y, z) => {
    const X = x * ca - z * sa, Z = x * sa + z * ca;
    const Y2 = y * cp + Z * sp, Z2 = Z * cp - y * sp;
    const s = f / (3.4 + Z2);
    return { x: cx + X * s, y: cy - Y2 * s, s, d: Z2 };
  };
  const ligne = (a, b, couleur, largeur = 1) => { ctx.strokeStyle = couleur; ctx.lineWidth = largeur; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
  const sol = (r, x0 = 0, z0 = 0) => { ctx.beginPath(); for (let i = 0; i <= 48; i++) { const a = (i / 48) * 2 * Math.PI; const p = proj(x0 + Math.cos(a) * r, 0, z0 + Math.sin(a) * r); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); } };
  // Grille au sol
  for (let i = 0; i <= 8; i++) {
    const v = -1 + i * 0.25, fort = i % 4 === 0;
    ligne(proj(v, 0, -1), proj(v, 0, 1), `rgba(77,227,255,${fort ? 0.32 : 0.13})`);
    ligne(proj(-1, 0, v), proj(1, 0, v), `rgba(77,227,255,${fort ? 0.32 : 0.13})`);
  }
  // Onde au sol
  if (st.anim) {
    const k = ((t - st.t0) % 4200) / 4200;
    sol(0.15 + k * 1.3);
    ctx.strokeStyle = `rgba(77,227,255,${0.35 * (1 - k)})`; ctx.lineWidth = 1.5; ctx.stroke();
  }
  // Graduations et axes
  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = 'rgba(132,167,189,.95)';
  ctx.textAlign = 'center';
  [0, 50, 100].forEach((v) => { const p = proj(-1 + v / 50, 0, -1.13); ctx.fillText(v + ' %', p.x, p.y); });
  const ax = proj(0, 0, -1.3); ctx.fillStyle = C.cyan; ctx.fillText('AVANCEMENT →', ax.x, ax.y);
  const az = proj(-1.28, 0, 0); ctx.fillText('EFFORT ↗', az.x, az.y);
  // Colonnes
  const entree = st.anim ? Math.min(1, Math.max(0, (t - st.t0 - 150) / 1300)) : 1;
  const hauteur = 1 - Math.pow(1 - entree, 3);
  const vus = new Map();
  const items = st.projets.map((p) => {
    const cle = `${p.avancement}|${p.effort}`;
    const k = vus.get(cle) || 0; vus.set(cle, k + 1);
    const x = -1 + (Math.max(0, Math.min(100, Number(p.avancement) || 0)) / 50) + k * 0.07;
    const z = -1 + ((Math.max(1, Math.min(5, Number(p.effort) || 1)) - 1) / 2) + k * 0.07;
    const y = (0.12 + ((Math.max(1, Math.min(5, Number(p.potentiel) || 1)) - 1) / 4) * 0.95) * hauteur;
    const base = proj(x, 0, z), haut = proj(x, y, z);
    return { p, x, z, y, base, haut, d: base.d };
  }).sort((a, b) => b.d - a.d);
  st.pts = [];
  for (const it of items) {
    const col = recoCouleur(it.p.recommandation);
    const actif = st.hover === it.p.id;
    // anneau au sol
    sol(0.07, it.x, it.z);
    ctx.strokeStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.2; ctx.stroke(); ctx.globalAlpha = 1;
    // ombre projetée au sol (ligne vers l'axe)
    ligne(it.base, proj(it.x, 0, -1), 'rgba(77,227,255,.08)');
    // colonne
    const gr = ctx.createLinearGradient(it.base.x, it.base.y, it.haut.x, it.haut.y);
    gr.addColorStop(0, col + '10'); gr.addColorStop(1, col + 'ee');
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = actif ? 26 : 14;
    ctx.strokeStyle = gr; ctx.lineWidth = Math.max(2.5, it.base.s * (actif ? 0.05 : 0.034)); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(it.base.x, it.base.y); ctx.lineTo(it.haut.x, it.haut.y); ctx.stroke();
    // sphère au sommet
    const r = Math.max(4, it.haut.s * (actif ? 0.07 : 0.05));
    const rg = ctx.createRadialGradient(it.haut.x - r * 0.3, it.haut.y - r * 0.3, r * 0.1, it.haut.x, it.haut.y, r);
    rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.35, col); rg.addColorStop(1, col + '22');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(it.haut.x, it.haut.y, r, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
    // étiquette
    ctx.textAlign = 'left';
    ctx.font = `${actif ? 600 : 500} 12px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = actif ? '#ffffff' : 'rgba(220,246,255,.92)';
    ctx.fillText(it.p.nom_court || it.p.projet, it.haut.x + r + 6, it.haut.y - 2);
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = col;
    ctx.fillText(`${it.p.avancement}% · P${it.p.potentiel} · E${it.p.effort}`, it.haut.x + r + 6, it.haut.y + 11);
    st.pts.push({ p: it.p, sx: it.haut.x, sy: it.haut.y });
  }
}

// ---------- Vue plane ----------
dash.draw('matrice', (n) => {
  const s = statut('projets', 'revenu_par_projet');
  if (s !== 'ok') { n.replaceChildren(messageEtat(s)); return; }
  const projets = dash.data('projets').data;
  const revenus = new Map((dash.data('revenu_par_projet').data || []).map((r) => [r.id, r]));
  n.replaceChildren();
  const W = Math.max(280, n.clientWidth || 600);
  const H = Math.round(Math.max(300, Math.min(440, W * 0.62)));
  const m = { top: 14, right: 18, bottom: 46, left: 46 };
  const x = d3.scaleLinear([0, 100], [m.left, W - m.right]);
  const y = d3.scaleLinear([0.5, 5.5], [H - m.bottom, m.top]);
  const svg = d3.select(n).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
    .attr('role', 'img').attr('aria-label', 'Matrice d\'arbitrage : potentiel de revenu à 12 mois selon l\'avancement vers le premier euro, un point par projet');
  const glow = lueur(svg, 'hud-glow-plan', 3);
  const xm = x(50), ym = y(3);
  svg.append('g').selectAll('line').data([[xm, m.top, xm, H - m.bottom], [m.left, ym, W - m.right, ym]]).join('line')
    .attr('x1', (d) => d[0]).attr('y1', (d) => d[1]).attr('x2', (d) => d[2]).attr('y2', (d) => d[3])
    .style('stroke', 'rgba(77,227,255,.35)').attr('stroke-dasharray', '4 4');
  const quads = [
    { t: 'Pousser', x: W - m.right - 6, y: m.top + 14, a: 'end' },
    { t: 'Investir ou trancher', x: m.left + 6, y: m.top + 14, a: 'start' },
    { t: 'Entretenir', x: W - m.right - 6, y: H - m.bottom - 8, a: 'end' },
    { t: 'Mettre de côté', x: m.left + 6, y: H - m.bottom - 8, a: 'start' },
  ];
  svg.append('g').selectAll('text').data(quads).join('text').attr('class', 'pp-quad')
    .attr('x', (d) => d.x).attr('y', (d) => d.y).attr('text-anchor', (d) => d.a).text((d) => d.t);
  const ax = svg.append('g').attr('transform', `translate(0,${H - m.bottom})`)
    .call(d3.axisBottom(x).tickValues([0, 25, 50, 75, 100]).tickFormat((d) => d + ' %').tickSizeOuter(0));
  const ay = svg.append('g').attr('transform', `translate(${m.left},0)`)
    .call(d3.axisLeft(y).tickValues([1, 2, 3, 4, 5]).tickFormat(d3.format('d')).tickSizeOuter(0));
  [ax, ay].forEach(axeStyle);
  svg.append('text').attr('x', (m.left + W - m.right) / 2).attr('y', H - 8).attr('text-anchor', 'middle').text('AVANCEMENT VERS LE PREMIER EURO');
  svg.append('text').attr('transform', `translate(12,${(m.top + H - m.bottom) / 2}) rotate(-90)`).attr('text-anchor', 'middle').text('POTENTIEL À 12 MOIS (1 À 5)');
  const vus = new Map();
  const pts = projets.map((p) => {
    const cle = `${p.avancement}|${p.potentiel}`;
    const k = vus.get(cle) || 0; vus.set(cle, k + 1);
    return { p, cx: x(Number(p.avancement) || 0) + k * 9, cy: y(Number(p.potentiel) || 1) - k * 9 };
  });
  const tip = infobulle(n);
  const g = svg.append('g');
  const points = g.selectAll('circle').data(pts).join('circle')
    .attr('cx', (d) => d.cx).attr('cy', (d) => d.cy).attr('r', 7)
    .style('fill', (d) => recoCouleur(d.p.recommandation)).attr('filter', glow).style('cursor', 'pointer');
  points.each(function (d) { marquer(this, 'projets', 'avancement', ouId(d.p.id)); });
  const boites = pts.map((d) => ({ x0: d.cx - 8, x1: d.cx + 8, y0: d.cy - 8, y1: d.cy + 8 }));
  const chevauche = (b) => boites.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  for (const d of pts) {
    const t = g.append('text').attr('class', 'pp-lbl').text(d.p.nom_court || d.p.projet);
    const w = largeurTexte(t.node(), d.p.nom_court || d.p.projet);
    const essais = [[11, 4], [-11 - w, 4], [-w / 2, -12], [-w / 2, 20], [11, 18], [11, -10]];
    let choix = essais[0];
    for (const e of essais) {
      const bx = d.cx + e[0];
      if (bx + w > W - 2 || bx < 2) continue;
      const b = { x0: bx, x1: bx + w, y0: d.cy + e[1] - 11, y1: d.cy + e[1] + 3 };
      if (!chevauche(b)) { choix = e; break; }
    }
    const bx = Math.max(2, Math.min(W - w - 2, d.cx + choix[0]));
    t.attr('x', bx).attr('y', d.cy + choix[1]);
    boites.push({ x0: bx, x1: bx + w, y0: d.cy + choix[1] - 11, y1: d.cy + choix[1] + 3 });
  }
  points.on('pointerenter pointermove', (event, d) => {
    const r = revenus.get(d.p.id);
    tip.montrer(event, d.p.projet, [
      `Recommandation : ${d.p.recommandation || '—'}`,
      `Ta décision : ${d.p.decision || '—'}`,
      `Avancement ${d.p.avancement} % · potentiel ${d.p.potentiel}/5 · effort ${d.p.effort}/5`,
      `Revenu cumulé : ${euros(r ? r.revenu_cumule : 0)}`,
    ]);
  }).on('pointerleave', () => tip.cacher());
});

// ---------- Flux de revenus ----------
dash.draw('rev-projets', (n) => {
  const s = statut('projets', 'revenu_par_projet');
  if (s !== 'ok') { n.replaceChildren(messageEtat(s)); return; }
  const projets = new Map(dash.data('projets').data.map((p) => [p.id, p]));
  const rows = [...(dash.data('revenu_par_projet').data || [])].sort((a, b) =>
    (b.revenu_cumule - a.revenu_cumule) || ((projets.get(b.id)?.potentiel || 0) - (projets.get(a.id)?.potentiel || 0)));
  const max = Math.max(1, ...rows.map((r) => Number(r.revenu_cumule) || 0), ...rows.map((r) => Number(r.objectif_mensuel) || 0));
  n.replaceChildren();
  const box = el('div', 'hud-rows');
  n.appendChild(box);
  const tip = infobulle(n);
  rows.forEach((r, i) => {
    const p = projets.get(r.id) || {};
    const ligne = el('div', 'hud-rowbar');
    const piste = el('div', 'hud-track');
    const barre = el('i');
    barre.style.width = (100 * (Number(r.revenu_cumule) || 0) / max) + '%';
    piste.appendChild(barre);
    piste.style.setProperty('--d', (i * 0.3).toFixed(1) + 's');
    if (Number(r.objectif_mensuel) > 0) {
      const obj = el('em');
      obj.style.left = (100 * Number(r.objectif_mensuel) / max) + '%';
      piste.appendChild(obj);
    }
    const val = marquer(el('span', 'hud-num', euros(r.revenu_cumule)), 'revenu_par_projet', 'revenu_cumule', ouId(r.id));
    ligne.append(el('span', null, p.nom_court || r.projet), piste, val);
    ligne.addEventListener('pointermove', (event) => tip.montrer(event, r.projet, [
      `Revenu cumulé : ${euros(r.revenu_cumule)}`,
      `30 derniers jours : ${euros(r.revenu_30j)}`,
      `Objectif mensuel : ${Number(r.objectif_mensuel) > 0 ? euros(r.objectif_mensuel) : 'non fixé'}`,
    ]));
    ligne.addEventListener('pointerleave', () => tip.cacher());
    box.appendChild(ligne);
  });
});

dash.draw('rev-mois', (n) => {
  const s = statut('revenu_mensuel');
  if (s !== 'ok') { n.replaceChildren(messageEtat(s)); return; }
  const mois = dash.data('revenu_mensuel').data || [];
  if (!mois.length) {
    const vide = el('div', 'hud-flat');
    vide.append(el('i'), el('span', null, 'En attente du premier encaissement'));
    n.replaceChildren(vide);
    return;
  }
  n.replaceChildren();
  const W = Math.max(280, n.clientWidth || 600), H = 230;
  const m = { top: 12, right: 12, bottom: 28, left: 62 };
  const x = d3.scaleBand(mois.map((d) => d.mois), [m.left, W - m.right]).padding(0.3);
  const y = d3.scaleLinear([0, d3.max(mois, (d) => d.montant) || 1], [H - m.bottom, m.top]).nice();
  const svg = d3.select(n).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
    .attr('role', 'img').attr('aria-label', 'Encaissements par mois, en euros');
  const glow = lueur(svg, 'hud-glow-mois', 3);
  const grad = svg.select('defs').append('linearGradient').attr('id', 'hud-bar-grad').attr('x1', 0).attr('x2', 0).attr('y1', 1).attr('y2', 0);
  grad.append('stop').attr('offset', '0%').attr('stop-color', C.cyan).attr('stop-opacity', 0.25);
  grad.append('stop').attr('offset', '100%').attr('stop-color', C.ok).attr('stop-opacity', 0.95);
  svg.append('g').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(4).tickFormat((v) => euros(v)).tickSize(-(W - m.left - m.right)))
    .call((g) => { g.select('.domain').remove(); g.selectAll('line').style('stroke', 'rgba(77,227,255,.1)'); g.selectAll('text').attr('font-size', null).attr('font-family', null); });
  const pas = Math.ceil(mois.length / Math.max(1, Math.floor((W - m.left) / 70)));
  svg.append('g').attr('transform', `translate(0,${H - m.bottom})`)
    .call(d3.axisBottom(x).tickValues(mois.map((d) => d.mois).filter((_, i) => i % pas === 0)).tickFormat((v) => fmtMois(parseJour(v + '-01'))).tickSizeOuter(0))
    .call(axeStyle);
  const tip = infobulle(n);
  const anim = mouvement() && premiereFois('rev-mois');
  const bars = svg.append('g').selectAll('rect').data(mois).join('rect')
    .attr('x', (d) => x(d.mois)).attr('width', x.bandwidth()).attr('rx', 3)
    .style('fill', 'url(#hud-bar-grad)').attr('filter', glow)
    .each(function (d) { marquer(this, 'revenu_mensuel', 'montant', 'mois=' + encodeURIComponent(d.mois)); })
    .on('pointerenter pointermove', (event, d) => tip.montrer(event, fmtMois(parseJour(d.mois + '-01')), [euros(d.montant)]))
    .on('pointerleave', () => tip.cacher());
  if (anim) {
    bars.attr('y', y(0)).attr('height', 0).transition().duration(900).delay((d, i) => i * 80).ease(d3.easeCubicOut)
      .attr('y', (d) => y(Math.max(0, d.montant))).attr('height', (d) => Math.abs(y(0) - y(d.montant)));
  } else {
    bars.attr('y', (d) => y(Math.max(0, d.montant))).attr('height', (d) => Math.abs(y(0) - y(d.montant)));
  }
});

// ---------- Filtre par pôle ----------
dash.draw('filtre-pole', (sel) => {
  const d = dash.data('projets');
  const poles = d.status === 'ok' ? [...new Set(d.data.map((p) => p.pole).filter(Boolean))].sort() : [];
  sel.replaceChildren(new Option('Tous', ''), ...poles.map((p) => new Option(p, p)));
  sel.value = poles.includes(PP.pole) ? PP.pole : '';
  sel.onchange = () => { PP.pole = sel.value; dash.draw('cartes'); };
});

// ---------- Fiches projets ----------
dash.draw('cartes', (n) => {
  const s = statut('projets', 'rapports', 'revenu_par_projet');
  if (s !== 'ok') { n.replaceChildren(messageEtat(s)); return; }
  const revenus = new Map((dash.data('revenu_par_projet').data || []).map((r) => [r.id, r]));
  const derniers = derniersRapports(dash.data('rapports').data || []);
  let projets = dash.data('projets').data.filter((p) => !PP.pole || p.pole === PP.pole);
  const cle = {
    potentiel: (p) => [Number(p.potentiel) || 0, Number(p.avancement) || 0],
    avancement: (p) => [Number(p.avancement) || 0, Number(p.potentiel) || 0],
    revenu: (p) => [Number(revenus.get(p.id)?.revenu_cumule) || 0, Number(p.avancement) || 0],
    activite: (p) => [String(p.derniere_activite || ''), Number(p.potentiel) || 0],
  }[PP.tri] || ((p) => [0, 0]);
  projets = [...projets].sort((a, b) => {
    const ka = cle(a), kb = cle(b);
    return ka[0] < kb[0] ? 1 : ka[0] > kb[0] ? -1 : ka[1] < kb[1] ? 1 : ka[1] > kb[1] ? -1 : 0;
  });
  const anim = mouvement() && premiereFois('cartes');
  const incliner = mouvement() && survol();
  const pips = (v, cls) => { const b = el('span', 'hud-pips' + (cls ? ' ' + cls : '')); for (let i = 1; i <= 5; i++) b.appendChild(el('i', i <= (Number(v) || 0) ? 'on' : null)); return b; };
  const cartes = projets.map((p, idx) => {
    const ou = ouId(p.id);
    const col = recoCouleur(p.recommandation);
    const c = el('article', 'hud-card' + (anim ? ' hud-in' : ''));
    c.id = 'projet-' + p.id;
    c.style.setProperty('--c', col);
    if (anim) c.style.animationDelay = (idx * 0.07) + 's';
    if (incliner) {
      c.addEventListener('pointermove', (e) => {
        const r = c.getBoundingClientRect();
        const dx = (e.clientX - r.left) / r.width - 0.5, dy = (e.clientY - r.top) / r.height - 0.5;
        c.style.transform = `rotateX(${(-dy * 7).toFixed(2)}deg) rotateY(${(dx * 9).toFixed(2)}deg) translateZ(6px)`;
        c.style.setProperty('--mx', ((dx + 0.5) * 100).toFixed(1) + '%');
        c.style.setProperty('--my', ((dy + 0.5) * 100).toFixed(1) + '%');
      });
      c.addEventListener('pointerleave', () => { c.style.transform = ''; c.style.removeProperty('--mx'); c.style.removeProperty('--my'); });
    }
    const top = el('div', 'hud-card-top');
    top.append(marquer(el('h3', null, p.projet), 'projets', 'projet', ou), marquer(el('span', 'hud-tag', p.pole), 'projets', 'pole', ou));
    const chips = el('div', 'hud-chips');
    const reco = el('span', 'hud-chip hud-chip-reco');
    reco.append(el('i'), marquer(el('span', null, p.recommandation || '—'), 'projets', 'recommandation', ou));
    reco.firstChild.style.background = col;
    const dyn = el('span', 'hud-chip');
    const dd = el('i'); dd.style.background = dynCouleur(p.dynamique); dd.style.boxShadow = `0 0 6px ${dynCouleur(p.dynamique)}`;
    dyn.append(dd, marquer(el('span', null, p.dynamique || '—'), 'projets', 'dynamique', ou));
    chips.append(reco, marquer(el('span', 'hud-chip', p.etape || '—'), 'projets', 'etape', ou), dyn);
    const prog = el('div', 'hud-prog');
    const segs = el('div', 'hud-segs');
    const allumes = Math.round(Math.max(0, Math.min(100, Number(p.avancement) || 0)) / 5);
    for (let i = 0; i < 20; i++) {
      const sg = el('i', i < allumes ? 'on' : null);
      if (anim && i < allumes) sg.style.animationDelay = (0.3 + idx * 0.07 + i * 0.03) + 's';
      segs.appendChild(sg);
    }
    const pct = el('span', 'hud-pct');
    pct.append(marquer(el('span', null, p.avancement), 'projets', 'avancement', ou), document.createTextNode(' %'));
    prog.append(segs, pct);
    const kv = el('dl', 'hud-kv');
    const ligne = (label, valeur, cible = kv) => { cible.append(el('dt', null, label)); const d = el('dd'); d.append(valeur); cible.append(d); };
    ligne('Décision', marquer(el('span', null, p.decision || '—'), 'projets', 'decision', ou));
    ligne('Revenu', marquer(el('span', 'hud-num', euros(revenus.get(p.id)?.revenu_cumule)), 'revenu_par_projet', 'revenu_cumule', ou));
    const pot = el('span');
    pot.append(pips(p.potentiel), marquer(el('span', null, p.potentiel), 'projets', 'potentiel', ou), document.createTextNode('/5'));
    ligne('Potentiel', pot);
    const eff = el('span');
    eff.append(pips(p.effort, 'hud-pips-effort'), marquer(el('span', null, p.effort), 'projets', 'effort', ou), document.createTextNode('/5'));
    ligne('Effort', eff);
    ligne('Suite', marquer(el('span', null, p.prochaine_etape || '—'), 'projets', 'prochaine_etape', ou));
    if (p.blocages) ligne('Blocage', marquer(el('span', 'hud-blk', p.blocages), 'projets', 'blocages', ou));
    ligne('Activité', marquer(el('span', null, jourLisible(p.derniere_activite)), 'projets', 'derniere_activite', ou));
    const det = el('details');
    det.open = PP.ouverts.has(p.id);
    det.addEventListener('toggle', () => { if (det.open) PP.ouverts.add(p.id); else PP.ouverts.delete(p.id); });
    det.appendChild(el('summary', null, 'Détails'));
    const kv2 = el('dl', 'hud-kv');
    ligne('En bref', marquer(el('span', null, p.resume || '—'), 'projets', 'resume', ou), kv2);
    ligne('Revenu prévu', marquer(el('span', null, p.modele_revenu || '—'), 'projets', 'modele_revenu', ou), kv2);
    const r = derniers.get(p.id);
    if (r) {
      ligne('Rapport', document.createTextNode(jourLisible(r.date)), kv2);
      ligne('Récemment', el('span', null, r.fait || '—'), kv2);
    }
    if (p.echeance) ligne('Échéance', marquer(el('span', null, jourLisible(p.echeance)), 'projets', 'echeance', ou), kv2);
    ligne('Tâches', marquer(el('span', null, p.automatisations ?? 0), 'projets', 'automatisations', ou), kv2);
    if (/^https:\/\//.test(String(p.lien || ''))) {
      const a = el('a', null, p.lien_libelle || p.lien);
      a.href = p.lien; a.target = '_blank'; a.rel = 'noopener noreferrer';
      ligne('Lien', a, kv2);
    }
    det.appendChild(kv2);
    c.append(top, chips, prog, kv, det);
    return c;
  });
  n.replaceChildren(...(cartes.length ? cartes : [el('p', 'hud-empty', 'Aucun projet dans ce pôle.')]));
});

// ---------- Trajectoires ----------
dash.draw('evolution', (n) => {
  const s = statut('rapports', 'projets');
  if (s !== 'ok') { n.replaceChildren(messageEtat(s)); return; }
  const noms = new Map(dash.data('projets').data.map((p) => [p.id, p.nom_court || p.projet]));
  const rapports = (dash.data('rapports').data || [])
    .map((r) => ({ ...r, d: parseJour(String(r.date)), v: Number(r.avancement) }))
    .filter((r) => r.d && Number.isFinite(r.v));
  if (!rapports.length) { n.replaceChildren(el('p', 'hud-empty', 'Pas encore de rapport.')); return; }
  n.replaceChildren();
  const series = d3.groups(rapports, (r) => r.projet_id).map(([id, pts]) => ({ id, nom: noms.get(id) || pts[0].projet, pts: pts.sort((a, b) => a.d - b.d) }));
  const couleur = new Map(series.map((sr, i) => [sr.id, SERIES[i % SERIES.length]]));
  const W = Math.max(280, n.clientWidth || 600), H = Math.round(Math.max(260, Math.min(360, W * 0.5)));
  const m = { top: 12, right: 16, bottom: 30, left: 44 };
  let [d0, d1] = d3.extent(rapports, (r) => r.d);
  if (+d0 === +d1) { d0 = d3.utcDay.offset(d0, -3); d1 = d3.utcDay.offset(d1, 3); }
  const x = d3.scaleUtc([d0, d1], [m.left, W - m.right]);
  const y = d3.scaleLinear([0, 100], [H - m.bottom, m.top]);
  const svg = d3.select(n).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
    .attr('role', 'img').attr('aria-label', 'Avancement de chaque projet, rapport après rapport, en pourcentage');
  const glow = lueur(svg, 'hud-glow-evol', 2.5);
  svg.append('g').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).tickValues([0, 25, 50, 75, 100]).tickFormat((v) => v + ' %').tickSize(-(W - m.left - m.right)))
    .call((g) => { g.select('.domain').remove(); g.selectAll('line').style('stroke', 'rgba(77,227,255,.1)'); g.selectAll('text').attr('font-size', null).attr('font-family', null); });
  svg.append('g').attr('transform', `translate(0,${H - m.bottom})`)
    .call(d3.axisBottom(x).ticks(d3.utcDay.every(Math.max(1, Math.ceil(d3.utcDay.count(d0, d1) / Math.max(2, Math.floor((W - m.left) / 90)))))).tickFormat((v) => fmtJourCourt(v)).tickSizeOuter(0))
    .call(axeStyle);
  const trace = d3.line().x((r) => x(r.d)).y((r) => y(r.v));
  const tip = infobulle(n);
  const anim = mouvement() && premiereFois('evolution');
  for (const sr of series) {
    const col = couleur.get(sr.id);
    if (sr.pts.length > 1) {
      const p = svg.append('path').datum(sr.pts).attr('d', trace).style('fill', 'none').style('stroke', col).style('stroke-width', 2).attr('filter', glow);
      const L = p.node().getTotalLength ? p.node().getTotalLength() : 0;
      if (anim && L) p.attr('stroke-dasharray', `${L} ${L}`).attr('stroke-dashoffset', L).transition().duration(1400).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0);
    }
    const der = sr.pts[sr.pts.length - 1];
    svg.append('circle').attr('class', 'hud-glowdot').attr('cx', x(der.d)).attr('cy', y(der.v)).attr('r', 9).style('fill', col).style('opacity', 0.25);
    svg.append('g').selectAll('circle').data(sr.pts).join('circle')
      .attr('cx', (r) => x(r.d)).attr('cy', (r) => y(r.v)).attr('r', 4.5)
      .style('fill', col).attr('filter', glow)
      .each(function (r) { marquer(this, 'rapports', 'avancement', 'date=' + encodeURIComponent(r.date) + '&projet_id=' + encodeURIComponent(r.projet_id)); })
      .on('pointerenter pointermove', (event, r) => tip.montrer(event, sr.nom, [jourLisible(r.date), `Avancement : ${r.v} %`, `Recommandation : ${r.recommandation || '—'}`]))
      .on('pointerleave', () => tip.cacher());
  }
  const leg = el('div', 'hud-legend');
  leg.style.marginTop = '12px';
  for (const sr of series) {
    const sp = el('span');
    const d = el('i', 'hud-dot'); d.style.background = couleur.get(sr.id); d.style.boxShadow = `0 0 8px ${couleur.get(sr.id)}`;
    sp.append(d, document.createTextNode(sr.nom));
    leg.appendChild(sp);
  }
  n.appendChild(leg);
});
