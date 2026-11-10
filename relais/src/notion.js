// Écriture dans la base Notion « Projets » (page « Pilotage des projets »).
// Seuls les champs que l'utilisateur pilote sont modifiables depuis Geri.

export class ErreurNotion extends Error {
  constructor(message, statut) { super(message); this.statut = statut; }
}

const VERSION = '2025-09-03';
const texte = (v) => ({ rich_text: [{ type: 'text', text: { content: v } }] });
const PROPRIETES = {
  decision: (v) => ['Décision', { select: { name: v } }],
  statut: (v) => ['Statut', { select: { name: v } }],
  prochaine_etape: (v) => ['Prochaine étape', texte(v)],
  blocages: (v) => ['Blocages', texte(v)],
  resume: (v) => ['Résumé', texte(v)],
  echeance: (v) => ['Échéance', { date: { start: v } }],
};

async function appel(env, chemin, methode, corps) {
  let rep;
  try {
    rep = await fetch('https://api.notion.com/v1' + chemin, {
      method: methode,
      headers: { Authorization: `Bearer ${env.NOTION_CLE}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
      body: corps ? JSON.stringify(corps) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new ErreurNotion('Notion est injoignable pour le moment.', 504);
  }
  const j = await rep.json().catch(() => ({}));
  if (rep.status === 401) throw new ErreurNotion('La clé Notion est refusée : vérifie le secret NOTION_CLE.', 502);
  if (rep.status === 404) throw new ErreurNotion('La base Projets n’est pas partagée avec l’intégration Notion de Geri.', 502);
  if (!rep.ok) throw new ErreurNotion('Notion a refusé la mise à jour : ' + String(j.message || rep.status).slice(0, 200), 502);
  return j;
}

export async function trouverPage(env, nomProjet) {
  const r = await appel(env, `/data_sources/${env.NOTION_SOURCE}/query`, 'POST', {
    filter: { property: 'Projet', title: { equals: nomProjet } },
    page_size: 2,
  });
  const page = (r.results || [])[0];
  if (!page) throw new ErreurNotion(`Le projet « ${nomProjet} » est introuvable dans Notion.`, 404);
  return page;
}

export async function ecrireNotion(env, nomProjet, champs) {
  const page = await trouverPage(env, nomProjet);
  const properties = {};
  for (const [cle, valeur] of Object.entries(champs)) {
    if (PROPRIETES[cle]) { const [nom, val] = PROPRIETES[cle](valeur); properties[nom] = val; }
  }
  const maj = await appel(env, `/pages/${page.id}`, 'PATCH', { properties });
  return { id: maj.id || page.id, url: maj.url || page.url };
}

// Lecture des fiches pour que le site affiche toujours les dernières décisions,
// qu'elles viennent de Geri ou d'une modification faite directement dans Notion.
const brut = (p) => (p ? (p.title || p.rich_text || []).map((t) => t.plain_text || '').join('').trim() : '');

export async function lireProjets(env) {
  const fiches = [];
  let curseur;
  for (let i = 0; i < 5; i++) {
    const r = await appel(env, `/data_sources/${env.NOTION_SOURCE}/query`, 'POST', { page_size: 100, ...(curseur ? { start_cursor: curseur } : {}) });
    for (const page of r.results || []) {
      if (!page || page.object !== 'page' || page.in_trash || page.archived) continue;
      const pr = page.properties || {};
      const nom = brut(pr.Projet);
      if (!nom) continue;
      const choix = (n) => (pr[n] && pr[n].select && pr[n].select.name) || null;
      const nombre = (n) => (pr[n] && typeof pr[n].number === 'number' ? pr[n].number : null);
      const date = (n) => (pr[n] && pr[n].date && pr[n].date.start ? String(pr[n].date.start).slice(0, 10) : null);
      const lien = ((pr.Sources && pr.Sources.rich_text) || []).map((t) => t.href || (t.text && t.text.link && t.text.link.url)).find((h) => /^https:\/\//.test(h || '')) || null;
      fiches.push({
        nom,
        url: page.url,
        modifie_le: page.last_edited_time || null,
        // Champs de l'utilisateur.
        decision: choix('Décision'),
        statut: choix('Statut'),
        objectif_mensuel: nombre('Objectif revenu mensuel (€)'),
        // Champs partagés.
        prochaine_etape: brut(pr['Prochaine étape']),
        echeance: date('Échéance'),
        blocages: brut(pr.Blocages),
        resume: brut(pr['Résumé']),
        // Champs tenus par le rapport du matin.
        avancement: nombre('Avancement (%)'),
        etape: choix('Étape'),
        dynamique: choix('Dynamique'),
        recommandation: choix('Recommandation'),
        potentiel: nombre('Potentiel'),
        effort: nombre('Effort restant'),
        automatisations: nombre('Automatisations'),
        derniere_activite: date('Dernière activité'),
        modele_revenu: brut(pr['Modèle de revenu']),
        pole: choix('Pôle'),
        lien,
      });
    }
    if (!r.has_more || !r.next_cursor) break;
    curseur = r.next_cursor;
  }
  return fiches;
}
