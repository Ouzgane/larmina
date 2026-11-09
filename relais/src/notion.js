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
