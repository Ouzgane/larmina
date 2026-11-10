// Relais IA du tableau de pilotage.
// POST /discuter  { messages: [{ role, content }], contexte, nom }  →  { reponse, suggestions, fournisseur, modele }
// GET  /          état du relais (fournisseur et modèle actifs), sans aucune donnée.
// GET  /projets   fiches Notion et rapports du matin, lus en direct (jeton requis).
// POST /notion    mise à jour d'une fiche, confirmée par l'utilisateur (jeton requis).

import { appeler, decrireFournisseur, ErreurConfig, ErreurQuota } from './fournisseurs.js';
import { consignes, analyser, validerNotion } from './consignes.js';
import { ecrireNotion, lireProjets, lireRapports, ErreurNotion } from './notion.js';

const LIMITES = { corps: 96000, historique: 14, message: 2000, contexte: 30000 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origine = request.headers.get('Origin');
    const cors = entetesCors(origine, env);

    if (request.method === 'OPTIONS') {
      return cors ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 });
    }
    if (origine && !cors) return json({ erreur: 'Origine non autorisée.' }, 403);

    if (request.method === 'GET' && url.pathname === '/') {
      try {
        const cfg = decrireFournisseur(env);
        return json({ service: 'Relais IA du pilotage', fournisseur: cfg.nom, modele: cfg.modele, notion: !!(env.NOTION_CLE && env.NOTION_SOURCE), pret: true }, 200, cors);
      } catch (e) {
        return json({ service: 'Relais IA du pilotage', pret: false, erreur: e.message }, 200, cors);
      }
    }
    if (url.pathname === '/projets' && request.method === 'GET') {
      if (!(await jetonValide(request, env))) return json({ erreur: 'Accès refusé.' }, 401, cors);
      if (!env.NOTION_CLE || !env.NOTION_SOURCE) return json({ erreur: 'Notion n’est pas encore branché.' }, 501, cors);
      try {
        const [projets, rapports] = await Promise.all([
          lireProjets(env),
          // Les rapports du matin sont un plus : s'ils sont illisibles, les fiches restent servies.
          env.NOTION_RAPPORTS ? lireRapports(env).catch((e) => { console.error('notion rapports', e && e.message); return null; }) : Promise.resolve([]),
        ]);
        return json({ projets, rapports: rapports || [], rapports_ok: rapports !== null, lu_le: new Date().toISOString() }, 200, cors);
      } catch (e) {
        console.error('notion', e && (e.stack || e.message || e));
        if (e instanceof ErreurNotion) return json({ erreur: e.message }, e.statut || 502, cors);
        return json({ erreur: 'Notion n’a pas répondu.' }, 502, cors);
      }
    }
    if (url.pathname === '/notion' && request.method === 'POST') {
      if (!(await jetonValide(request, env))) return json({ erreur: 'Accès refusé.' }, 401, cors);
      return enregistrerNotion(request, env, cors);
    }
    if (url.pathname !== '/discuter') return json({ erreur: 'Adresse inconnue.' }, 404, cors);
    if (request.method !== 'POST') return json({ erreur: 'Méthode non autorisée.' }, 405, cors);

    if (!(await jetonValide(request, env))) return json({ erreur: 'Accès refusé.' }, 401, cors);

    let corps;
    try {
      const brut = await request.text();
      if (brut.length > LIMITES.corps) return json({ erreur: 'Message trop long.' }, 413, cors);
      corps = JSON.parse(brut);
    } catch (e) {
      return json({ erreur: 'Requête illisible.' }, 400, cors);
    }

    const messages = normaliser(corps && corps.messages);
    if (!messages.length || messages[messages.length - 1].role !== 'user') return json({ erreur: 'Aucune question à traiter.' }, 400, cors);
    if (messages.some((m) => m.role === 'user' && m.content.length > LIMITES.message)) return json({ erreur: `Un message dépasse ${LIMITES.message} caractères.` }, 413, cors);

    const contexte = typeof corps.contexte === 'string' ? corps.contexte.slice(0, LIMITES.contexte) : '';
    const nom = typeof corps.nom === 'string' && /^[\p{L}][\p{L}\p{N} .'-]{0,23}$/u.test(corps.nom.trim()) ? corps.nom.trim() : 'Geri';
    const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

    let cfg;
    try {
      cfg = decrireFournisseur(env);
      const maxTokens = Math.min(Math.max(parseInt(env.MAX_TOKENS, 10) || 1200, 200), 4000);
      const playlists = Array.isArray(corps.playlists) ? corps.playlists.slice(0, 20).filter((p) => p && /^[a-z0-9-]{1,30}$/.test(p.cle)).map((p) => ({ cle: p.cle, nom: String(p.nom || p.cle).slice(0, 40) })) : [];
      const notion = !!(env.NOTION_CLE && env.NOTION_SOURCE);
      const requete = { systeme: consignes({ nom, date, contexte, playlists, notion }), messages, maxTokens };
      const brut = await appeler(cfg, requete, env);
      const { texte, suggestions, musique, actions } = analyser(brut);
      const cles = new Set(playlists.map((p) => p.cle));
      return json({
        reponse: texte || (notion && actions.length ? 'Voici ce que je te propose d’enregistrer dans Notion. Confirme pour que je l’écrive.' : 'C’est noté.'),
        suggestions,
        musique: musique && (musique === 'stop' || cles.has(musique)) ? musique : null,
        actions: notion ? actions : [],
        fournisseur: cfg.nom,
        modele: requete.modeleUtilise || cfg.modele,
      }, 200, cors);
    } catch (e) {
      console.error('relais', cfg && cfg.nom, e && (e.stack || e.message || e));
      if (e instanceof ErreurQuota) return json({ erreur: e.message, code: 'quota' }, 429, cors);
      if (e instanceof ErreurConfig) return json({ erreur: e.message, code: 'config' }, 500, cors);
      return json({ erreur: 'Le modèle n’a pas répondu. Réessaie dans un instant.', code: 'fournisseur' }, 502, cors);
    }
  },
};

// Enregistre dans Notion une mise à jour confirmée par l'utilisateur.
async function enregistrerNotion(request, env, cors) {
  if (!env.NOTION_CLE || !env.NOTION_SOURCE) return json({ erreur: 'Notion n’est pas encore branché : ajoute le secret NOTION_CLE.' }, 501, cors);
  let corps;
  try { corps = JSON.parse((await request.text()).slice(0, 20000)); } catch (e) { return json({ erreur: 'Requête illisible.' }, 400, cors); }
  const action = validerNotion({ projet: corps && corps.projet, ...((corps && corps.champs) || {}) });
  const nomProjet = typeof corps.projet_nom === 'string' ? corps.projet_nom.trim().slice(0, 200) : '';
  if (!action || !nomProjet) return json({ erreur: 'Mise à jour incomplète.' }, 400, cors);
  try {
    const page = await ecrireNotion(env, nomProjet, action.champs);
    return json({ ok: true, url: page.url, champs: action.champs }, 200, cors);
  } catch (e) {
    console.error('notion', e && (e.stack || e.message || e));
    if (e instanceof ErreurNotion) return json({ erreur: e.message }, e.statut || 502, cors);
    return json({ erreur: 'Notion n’a pas répondu. Réessaie dans un instant.' }, 502, cors);
  }
}

// Garde les rôles utiles, fusionne les tours consécutifs du même rôle, commence par une question.
export function normaliser(liste) {
  if (!Array.isArray(liste)) return [];
  const sortie = [];
  for (const m of liste.slice(-LIMITES.historique * 2)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = m.content.trim();
    if (!content) continue;
    const dernier = sortie[sortie.length - 1];
    if (dernier && dernier.role === m.role) dernier.content += '\n\n' + content;
    else sortie.push({ role: m.role, content });
  }
  while (sortie.length && sortie[0].role !== 'user') sortie.shift();
  // Une longue réponse passée de l'assistant ne doit pas bloquer la suite : on l'abrège.
  for (const m of sortie) if (m.role === 'assistant' && m.content.length > LIMITES.message) m.content = m.content.slice(0, LIMITES.message - 1) + '…';
  return sortie.slice(-LIMITES.historique);
}

function entetesCors(origine, env) {
  if (!origine) return null;
  const permises = String(env.ORIGINES || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  if (!permises.includes(origine)) return null;
  return {
    'Access-Control-Allow-Origin': origine,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function jetonValide(request, env) {
  const attendu = String(env.JETON_EMPREINTE || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(attendu)) return false; // pas d'empreinte configurée : tout est refusé
  const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(request.headers.get('Authorization') || '');
  if (!m) return false;
  const empreinte = await sha256(m[1].toLowerCase());
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= empreinte.charCodeAt(i) ^ attendu.charCodeAt(i);
  return diff === 0;
}

async function sha256(texte) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(objet, statut, cors) {
  return new Response(JSON.stringify(objet), {
    status: statut,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(cors || {}) },
  });
}
