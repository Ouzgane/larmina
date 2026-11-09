// Petit moteur qui remplace celui du tableau de bord Claude : il fournit les données
// déchiffrées aux calculs et aux dessins de app.js, et redessine quand la fenêtre change de taille.
(function () {
  const sources = {};
  const calculs = {};
  const dessins = {};
  const montes = new Map();
  const etat = { statut: 'loading' };

  const dash = {
    colors: ['#4de3ff', '#ff5fd2', '#ffbe4d', '#3dffb0', '#b48cff', '#ff8a3d', '#38f0d0', '#ff6b8b'],
    data(id) {
      if (etat.statut !== 'ok') return { status: etat.statut, data: [] };
      if (Object.prototype.hasOwnProperty.call(sources, id)) return { status: 'ok', data: sources[id] };
      const c = calculs[id];
      if (c) {
        if (!('valeur' in c)) c.valeur = c.fn(...c.inputs.map((i) => dash.data(i).data));
        return { status: 'ok', data: c.valeur };
      }
      return { status: 'missing', data: [] };
    },
    calc(id, o) { calculs[id] = { inputs: o.inputs, fn: o.fn }; },
    loader() {},
    onData(fn) { fn(); },
    draw(nom, fn) {
      if (fn === undefined) { executer(nom); return; }
      dessins[nom] = fn;
    },
  };

  function executer(nom) {
    const fn = dessins[nom];
    if (!fn) return;
    document.querySelectorAll(`[data-draw="${nom}"]`).forEach((el) => {
      if (el.closest('[hidden]')) return;
      try {
        if (typeof fn === 'function') fn(el);
        else {
          if (!montes.has(el)) { el.replaceChildren(); montes.set(el, fn.mount(el)); }
          fn.update(el, montes.get(el));
        }
      } catch (e) {
        console.error('Dessin « ' + nom + ' » :', e);
      }
    });
  }
  const toutDessiner = () => { Object.keys(dessins).forEach(executer); Object.keys(dessins).forEach(executer); };

  window.dash = dash;
  window.PILOTAGE = {
    charger(paquet) {
      sources.projets = paquet.projets || [];
      sources.rapports = paquet.rapports || [];
      sources.syntheses = paquet.syntheses || [];
      sources.revenus = paquet.revenus || [];
      Object.values(calculs).forEach((c) => { delete c.valeur; });
      etat.statut = 'ok';
      toutDessiner();
    },
    erreur() { etat.statut = 'error'; toutDessiner(); },
    toutDessiner,
  };

  let minuterie = 0, largeur = window.innerWidth;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - largeur) < 4) return;
    largeur = window.innerWidth;
    clearTimeout(minuterie);
    minuterie = setTimeout(toutDessiner, 160);
  });
})();
