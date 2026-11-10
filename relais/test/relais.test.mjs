import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import relais, { normaliser } from '../src/index.js';
import { extraireSuggestions } from '../src/consignes.js';
import { texteDe, decrireFournisseur, PRESETS } from '../src/fournisseurs.js';

const JETON = 'a'.repeat(64);
const EMPREINTE = createHash('sha256').update(JETON).digest('hex');
const ORIGINE = 'https://ouzgane.github.io';

function envDe(extra = {}) {
  const appels = [];
  const env = {
    IA_FOURNISSEUR: 'cloudflare', IA_MODELE: '', IA_URL: '', MAX_TOKENS: '1200',
    ORIGINES: ORIGINE, JETON_EMPREINTE: EMPREINTE,
    AI: { run: async (modele, entree) => { appels.push({ modele, entree }); return env.reponseIA(modele, entree); } },
    reponseIA: () => ({ output: [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'je réfléchis' }] },
      { type: 'message', content: [{ type: 'output_text', text: 'KitVital est le seul projet monétisable.\nSUGGESTIONS: Que faire cette semaine ? | Et Growth Hiring ?' }] },
    ] }),
    ...extra,
  };
  return { env, appels };
}

function requete(corps, { jeton = JETON, origine = ORIGINE, methode = 'POST', chemin = '/discuter' } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (origine) h.Origin = origine;
  if (jeton) h.Authorization = 'Bearer ' + jeton;
  return new Request('https://larmina-ia.exemple.workers.dev' + chemin, { method: methode, headers: h, body: methode === 'POST' ? JSON.stringify(corps) : undefined });
}

const question = { messages: [{ role: 'user', content: 'Quel projet accélérer ?' }], contexte: 'PROJETS : KitVital…', nom: 'Geri' };

test('état du relais sans donnée', async () => {
  const { env } = envDe();
  const r = await relais.fetch(requete(null, { methode: 'GET', chemin: '/', jeton: null }), env);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.fournisseur, 'cloudflare');
  assert.equal(j.modele, '@cf/openai/gpt-oss-120b');
});

test('CORS : origine du site acceptée, autre origine refusée', async () => {
  const { env } = envDe();
  const ok = await relais.fetch(requete(null, { methode: 'OPTIONS' }), env);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGINE);
  const ko = await relais.fetch(requete(question, { origine: 'https://pirate.example' }), env);
  assert.equal(ko.status, 403);
});

test('jeton absent, faux ou empreinte non configurée : refus', async () => {
  const { env, appels } = envDe();
  assert.equal((await relais.fetch(requete(question, { jeton: null }), env)).status, 401);
  assert.equal((await relais.fetch(requete(question, { jeton: 'b'.repeat(64) }), env)).status, 401);
  const sans = envDe({ JETON_EMPREINTE: '' });
  assert.equal((await relais.fetch(requete(question), sans.env)).status, 401);
  assert.equal(appels.length, 0);
});

test('Cloudflare gpt-oss : format Responses, raisonnement ignoré, suggestions extraites', async () => {
  const { env, appels } = envDe();
  const r = await relais.fetch(requete(question), env);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.reponse, 'KitVital est le seul projet monétisable.');
  assert.deepEqual(j.suggestions, ['Que faire cette semaine ?', 'Et Growth Hiring ?']);
  assert.equal(appels.length, 1);
  assert.equal(appels[0].modele, '@cf/openai/gpt-oss-120b');
  assert.match(appels[0].entree.instructions, /Tu es Geri/);
  assert.match(appels[0].entree.instructions, /PROJETS : KitVital/);
  assert.deepEqual(appels[0].entree.input, [{ role: 'user', content: 'Quel projet accélérer ?' }]);
});

test('Cloudflare : si un format échoue, l’autre est essayé', async () => {
  const { env, appels } = envDe({ reponseIA: (m, e) => { if (e.instructions) throw new Error('5006: bad input'); return { response: 'Réponse.\nSUGGESTIONS: A ? | B ?' }; } });
  const j = await (await relais.fetch(requete(question), env)).json();
  assert.equal(j.reponse, 'Réponse.');
  assert.equal(appels.length, 2);
  assert.ok(appels[1].entree.messages[0].role === 'system');
});

test('Cloudflare autre modèle : format messages uniquement', async () => {
  const { env, appels } = envDe({ IA_MODELE: '@cf/google/gemma-4-26b-a4b-it', reponseIA: () => ({ choices: [{ message: { content: 'Ok.' } }] }) });
  const j = await (await relais.fetch(requete(question), env)).json();
  assert.equal(j.reponse, 'Ok.');
  assert.equal(j.modele, '@cf/google/gemma-4-26b-a4b-it');
  assert.equal(appels.length, 1);
  assert.equal(appels[0].entree.max_tokens, 1200);
});

test('quota gratuit épuisé : 429 et message clair, sans nouvel essai', async () => {
  const { env, appels } = envDe({ reponseIA: () => { throw new Error('4006: you have used up your daily free allocation of 10,000 neurons'); } });
  const r = await relais.fetch(requete(question), env);
  assert.equal(r.status, 429);
  assert.match((await r.json()).erreur, /quota gratuit/);
  assert.equal(appels.length, 1);
});

async function avecFetch(simul, fn) {
  const avant = globalThis.fetch;
  const vus = [];
  globalThis.fetch = async (url, init) => { vus.push({ url, init, corps: JSON.parse(init.body) }); return simul(url, init); };
  try { return await fn(vus); } finally { globalThis.fetch = avant; }
}
const repJson = (o, statut = 200) => new Response(JSON.stringify(o), { status: statut });

test('bascule vers Anthropic : une variable et une clé', async () => {
  const { env } = envDe({ IA_FOURNISSEUR: 'anthropic', IA_CLE: 'sk-ant-test' });
  await avecFetch(() => repJson({ content: [{ type: 'text', text: 'Claude répond.\nSUGGESTIONS: X ? | Y ?' }] }), async (vus) => {
    const j = await (await relais.fetch(requete(question), env)).json();
    assert.equal(j.reponse, 'Claude répond.');
    assert.equal(j.fournisseur, 'anthropic');
    assert.equal(vus[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(vus[0].init.headers['x-api-key'], 'sk-ant-test');
    assert.equal(vus[0].corps.model, 'claude-haiku-5-5');
    assert.match(vus[0].corps.system, /Tu es Geri/);
    assert.equal(vus[0].corps.messages[0].role, 'user');
  });
});

test('bascule vers OpenAI, Mistral, Gemini : format chat completions', async () => {
  for (const [nom, attendu] of [['openai', 'max_completion_tokens'], ['mistral', 'max_tokens'], ['gemini', 'max_tokens']]) {
    const { env } = envDe({ IA_FOURNISSEUR: nom, IA_CLE: 'cle-' + nom });
    await avecFetch(() => repJson({ choices: [{ message: { content: nom + ' répond.' } }] }), async (vus) => {
      const j = await (await relais.fetch(requete(question), env)).json();
      assert.equal(j.reponse, nom + ' répond.');
      assert.equal(vus[0].url, PRESETS[nom].url);
      assert.equal(vus[0].init.headers.authorization, 'Bearer cle-' + nom);
      assert.ok(attendu in vus[0].corps, nom + ' : ' + attendu);
      assert.equal(vus[0].corps.messages[0].role, 'system');
      if (nom === 'openai') assert.ok(!('temperature' in vus[0].corps));
    });
  }
});

test('fournisseur compatible : IA_URL et IA_MODELE pris tels quels', async () => {
  const { env } = envDe({ IA_FOURNISSEUR: 'compatible', IA_URL: 'https://api.deepseek.com/chat/completions', IA_MODELE: 'deepseek-chat', IA_CLE: 'k' });
  await avecFetch(() => repJson({ choices: [{ message: { content: '<think>hmm</think>Réponse propre.' } }] }), async (vus) => {
    const j = await (await relais.fetch(requete(question), env)).json();
    assert.equal(j.reponse, 'Réponse propre.');
    assert.equal(vus[0].url, 'https://api.deepseek.com/chat/completions');
    assert.equal(vus[0].corps.model, 'deepseek-chat');
  });
});

test('configuration incomplète : message explicite', async () => {
  const { env } = envDe({ IA_FOURNISSEUR: 'mistral' });
  const r = await relais.fetch(requete(question), env);
  assert.equal(r.status, 500);
  assert.match((await r.json()).erreur, /IA_CLE/);
  assert.throws(() => decrireFournisseur({ IA_FOURNISSEUR: 'inconnu' }), /Fournisseur inconnu/);
});

test('erreur du fournisseur : 502 sans détail technique pour le visiteur', async () => {
  const { env } = envDe({ IA_FOURNISSEUR: 'mistral', IA_CLE: 'k' });
  await avecFetch(() => repJson({ error: 'boom' }, 500), async () => {
    const r = await relais.fetch(requete(question), env);
    assert.equal(r.status, 502);
    assert.doesNotMatch((await r.json()).erreur, /boom/);
  });
});

test('validation des messages', async () => {
  const { env } = envDe();
  assert.equal((await relais.fetch(requete({ messages: [] }), env)).status, 400);
  assert.equal((await relais.fetch(requete({ messages: [{ role: 'user', content: 'x'.repeat(2001) }] }), env)).status, 413);
  assert.deepEqual(normaliser([{ role: 'assistant', content: 'Bonjour' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'system', content: 'pirate' }]),
    [{ role: 'user', content: 'a\n\nb' }]);
});

test('lecture des suggestions sous plusieurs formes', () => {
  assert.deepEqual(extraireSuggestions('Texte.\n\n**Suggestions :** « Un ? » | Deux ? | Trois ? | Quatre ?'), { texte: 'Texte.', suggestions: ['Un ?', 'Deux ?', 'Trois ?'] });
  assert.deepEqual(extraireSuggestions('Texte.\nSUGGESTIONS:\n- Un ?\n- Deux ?'), { texte: 'Texte.', suggestions: ['Un ?', 'Deux ?'] });
  assert.deepEqual(extraireSuggestions('Sans relance.'), { texte: 'Sans relance.', suggestions: [] });
});

test('texteDe accepte toutes les formes connues', () => {
  assert.equal(texteDe('brut'), 'brut');
  assert.equal(texteDe({ response: 'cf' }), 'cf');
  assert.equal(texteDe({ result: { response: 'rest' } }), 'rest');
  assert.equal(texteDe({ output_text: 'ot' }), 'ot');
  assert.equal(texteDe({ choices: [{ message: { content: [{ type: 'text', text: 'parts' }] } }] }), 'parts');
});

import { analyser, validerNotion, consignes } from '../src/consignes.js';

test('actions du modèle : musique et propositions Notion extraites et validées', () => {
  const r = analyser('Je lance de quoi te concentrer et je note la pause de Tablée.\nMUSIQUE: Concentration\nNOTION: {"projet":"tablee","decision":"Mettre en pause","statut":"En pause","prochaine_etape":"Rien avant janvier","hack":"x"}\nNOTION: {"projet":"kitvital","decision":"Tout donner"}\nSUGGESTIONS: Et ensuite ? | Autre chose ?');
  assert.equal(r.texte, 'Je lance de quoi te concentrer et je note la pause de Tablée.');
  assert.equal(r.musique, 'concentration');
  assert.deepEqual(r.actions, [{ projet: 'tablee', champs: { decision: 'Mettre en pause', statut: 'En pause', prochaine_etape: 'Rien avant janvier' } }]);
  assert.deepEqual(r.suggestions, ['Et ensuite ?', 'Autre chose ?']);
  assert.equal(validerNotion({ projet: '../x', decision: 'Accélérer' }), null);
  assert.equal(validerNotion({ projet: 'kitvital', echeance: '20/11' }), null);
});

test('consignes : musique et Notion seulement quand ils sont disponibles', () => {
  const sans = consignes({ nom: 'Geri', date: 'lundi', contexte: '' });
  assert.doesNotMatch(sans, /MUSIQUE:|NOTION:/);
  const avec = consignes({ nom: 'Geri', date: 'lundi', contexte: '', playlists: [{ cle: 'jazz', nom: 'Jazz' }], notion: true });
  assert.match(avec, /« jazz » \(Jazz\)/);
  assert.match(avec, /NOTION: \{"projet"/);
});

test('discuter : musique inconnue ignorée, actions Notion seulement si Notion est branché', async () => {
  const sortie = 'Ok.\nMUSIQUE: inconnue\nNOTION: {"projet":"tablee","statut":"En pause"}';
  const { env } = envDe({ reponseIA: () => ({ response: sortie }) });
  const q = { ...question, playlists: [{ cle: 'jazz', nom: 'Jazz' }] };
  let j = await (await relais.fetch(requete(q), env)).json();
  assert.equal(j.musique, null);
  assert.deepEqual(j.actions, []);
  const { env: env2 } = envDe({ NOTION_CLE: 'secret_x', NOTION_SOURCE: 'source-1', reponseIA: () => ({ response: sortie.replace('inconnue', 'jazz') }) });
  j = await (await relais.fetch(requete(q), env2)).json();
  assert.equal(j.musique, 'jazz');
  assert.deepEqual(j.actions, [{ projet: 'tablee', champs: { statut: 'En pause' } }]);
});

test('notion : la mise à jour confirmée est écrite sur la bonne page', async () => {
  const { env } = envDe({ NOTION_CLE: 'secret_x', NOTION_SOURCE: 'source-1' });
  const appels = [];
  const avant = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    appels.push({ url, init, corps: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/data_sources/source-1/query')) return repJson({ results: [{ id: 'page-tablee', url: 'https://notion.so/page-tablee' }] });
    if (url.endsWith('/pages/page-tablee')) return repJson({ id: 'page-tablee', url: 'https://notion.so/page-tablee' });
    return repJson({}, 404);
  };
  try {
    const r = await relais.fetch(requete({ projet: 'tablee', projet_nom: 'Tablée', champs: { decision: 'Mettre en pause', echeance: '2027-01-15', pirate: 'x' } }, { chemin: '/notion' }), env);
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.url, 'https://notion.so/page-tablee');
    assert.deepEqual(appels[0].corps.filter, { property: 'Projet', title: { equals: 'Tablée' } });
    assert.equal(appels[0].init.headers.Authorization, 'Bearer secret_x');
    assert.deepEqual(appels[1].corps.properties, { 'Décision': { select: { name: 'Mettre en pause' } }, 'Échéance': { date: { start: '2027-01-15' } } });
    assert.equal(appels[1].init.method, 'PATCH');
  } finally { globalThis.fetch = avant; }
  assert.equal((await relais.fetch(requete({ projet: 'tablee', projet_nom: 'Tablée', champs: {} }, { chemin: '/notion' }), env)).status, 400);
  assert.equal((await relais.fetch(requete({ projet: 'tablee', projet_nom: 'Tablée', champs: { decision: 'Accélérer' } }, { chemin: '/notion', jeton: 'c'.repeat(64) }), env)).status, 401);
  const sans = envDe();
  assert.equal((await relais.fetch(requete({ projet: 'tablee', projet_nom: 'Tablée', champs: { decision: 'Accélérer' } }, { chemin: '/notion' }), sans.env)).status, 501);
});

test('Cloudflare : raisonnement gpt-oss qui fuit → modèle de secours, en français', async () => {
  const fuite = 'analysis: summarize current situation.<|end|><|start|>assistantfinal: The projects must be paused until the revenue is there and it should be done.';
  const { env, appels } = envDe({ reponseIA: (m) => (/gpt-oss/.test(m)
    ? { output: [{ type: 'message', content: [{ type: 'output_text', text: fuite }] }] }
    : { response: 'Aucun revenu pour l’instant : KitVital est le plus proche.\nSUGGESTIONS: Que faire ? | Et ensuite ?' }) });
  const j = await (await relais.fetch(requete(question), env)).json();
  assert.equal(j.reponse, 'Aucun revenu pour l’instant : KitVital est le plus proche.');
  assert.equal(j.modele, '@cf/mistralai/mistral-small-3.1-24b-instruct');
  // Le principal n'est pas rappelé dans l'autre format : on passe directement au secours.
  assert.deepEqual(appels.map((a) => a.modele), ['@cf/openai/gpt-oss-120b', '@cf/mistralai/mistral-small-3.1-24b-instruct']);
});

test('Cloudflare : sans secours propre, la réponse est nettoyée plutôt que perdue', async () => {
  const { env } = envDe({ IA_MODELE_SECOURS: 'aucun', reponseIA: () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'analysis: court.<|end|><|start|>assistant<|channel|>final<|message|>KitVital passe en premier.\nSUGGESTIONS: Pourquoi ? | Et après ?' }] }] }) });
  const j = await (await relais.fetch(requete(question), env)).json();
  assert.equal(j.reponse, 'KitVital passe en premier.');
  assert.deepEqual(j.suggestions, ['Pourquoi ?', 'Et après ?']);
});

test('historique : une longue réponse passée est abrégée au lieu de bloquer', async () => {
  const { env, appels } = envDe();
  const long = { messages: [{ role: 'user', content: 'Résume.' }, { role: 'assistant', content: 'x'.repeat(5000) }, { role: 'user', content: 'Et ensuite ?' }], contexte: '', nom: 'Geri' };
  const r = await relais.fetch(requete(long), env);
  assert.equal(r.status, 200);
  assert.ok(appels[0].entree.input[1].content.length <= 2000);
  const tropLong = { messages: [{ role: 'user', content: 'y'.repeat(2500) }], contexte: '', nom: 'Geri' };
  assert.equal((await relais.fetch(requete(tropLong), env)).status, 413);
});

test('projets : lecture en direct des fiches Notion, jeton requis', async () => {
  const { env } = envDe({ NOTION_CLE: 'secret_x', NOTION_SOURCE: 'source-1' });
  const t = (s) => [{ plain_text: s }];
  const page = (id, props, extra = {}) => ({ object: 'page', id, url: 'https://www.notion.so/' + id, last_edited_time: '2026-11-10T08:06:57.000Z', properties: props, ...extra });
  const pages1 = [
    page('p1', { Projet: { title: t('Trader 5.0') }, 'Décision': { select: null }, Statut: { select: { name: 'En pause' } }, 'Prochaine étape': { rich_text: t('Décider ') .concat(t('de la suite')) }, 'Échéance': { date: null }, Blocages: { rich_text: [] }, 'Résumé': { rich_text: t('Plateforme') }, 'Objectif revenu mensuel (€)': { number: null }, 'Avancement (%)': { number: 35 }, 'Étape': { select: { name: 'Construction' } }, 'Dernière activité': { date: { start: '2026-09-29' } }, Sources: { rich_text: [{ plain_text: 'artefact', href: 'https://claude.ai/artifact/x' }] } }),
    page('p2', { Projet: { title: t('Corbeille') } }, { in_trash: true }),
  ];
  const pages2 = [page('p3', { Projet: { title: t('KitVital') }, 'Décision': { select: { name: 'Accélérer' } }, 'Échéance': { date: { start: '2026-11-20' } }, 'Objectif revenu mensuel (€)': { number: 300 } })];
  const appels = [];
  const avant = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const corps = JSON.parse(init.body);
    appels.push(corps);
    return corps.start_cursor ? repJson({ results: pages2, has_more: false }) : repJson({ results: pages1, has_more: true, next_cursor: 'c2' });
  };
  try {
    const r = await relais.fetch(requete(null, { methode: 'GET', chemin: '/projets' }), env);
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.equal(j.projets.length, 2);
    assert.deepEqual(j.projets[0], { nom: 'Trader 5.0', url: 'https://www.notion.so/p1', modifie_le: '2026-11-10T08:06:57.000Z', decision: null, statut: 'En pause', objectif_mensuel: null, prochaine_etape: 'Décider de la suite', echeance: null, blocages: '', resume: 'Plateforme',
      avancement: 35, etape: 'Construction', dynamique: null, recommandation: null, potentiel: null, effort: null, automatisations: null, derniere_activite: '2026-09-29', modele_revenu: '', pole: null, lien: 'https://claude.ai/artifact/x', fait: '', risques: '' });
    assert.deepEqual(j.rapports, []);
    assert.equal(j.projets[1].decision, 'Accélérer');
    assert.equal(j.projets[1].echeance, '2026-11-20');
    assert.equal(j.projets[1].objectif_mensuel, 300);
    assert.equal(appels[1].start_cursor, 'c2');
  } finally { globalThis.fetch = avant; }
  assert.equal((await relais.fetch(requete(null, { methode: 'GET', chemin: '/projets', jeton: 'c'.repeat(64) }), env)).status, 401);
  assert.equal((await relais.fetch(requete(null, { methode: 'GET', chemin: '/projets' }), envDe().env)).status, 501);
});

test('projets : rapports du matin lus dans Notion, sans bloquer les fiches s’ils sont illisibles', async () => {
  const { env } = envDe({ NOTION_CLE: 'secret_x', NOTION_SOURCE: 'source-1', NOTION_RAPPORTS: 'rapports-1' });
  const t = (s) => [{ plain_text: s }];
  let rapportsLisibles = true;
  const avant = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (url.includes('/data_sources/rapports-1/')) {
      if (!rapportsLisibles) return repJson({ message: 'Could not find' }, 404);
      assert.deepEqual(JSON.parse(init.body).sorts, [{ property: 'Date', direction: 'descending' }]);
      return repJson({ results: [
        { object: 'page', last_edited_time: '2026-11-10T13:40:00.000Z', properties: { Date: { date: { start: '2026-11-10' } }, Titre: { rich_text: t('Titre du jour') }, 'Synthèse': { rich_text: t('Synthèse') }, Arbitrages: { rich_text: t('Accélérer A\nPause B') }, Alertes: { rich_text: [] }, Avancements: { rich_text: t('kitvital=58; trader5 = 35 %; faux; x=abc') } } },
        { object: 'page', properties: { Date: { date: null } } },
      ] });
    }
    return repJson({ results: [{ object: 'page', url: 'u', properties: { Projet: { title: t('KitVital') }, 'Fait du jour': { rich_text: t('Fait') }, Risques: { rich_text: t('Risque') } } }] });
  };
  try {
    let j = await (await relais.fetch(requete(null, { methode: 'GET', chemin: '/projets' }), env)).json();
    assert.equal(j.projets[0].fait, 'Fait');
    assert.equal(j.projets[0].risques, 'Risque');
    assert.equal(j.rapports.length, 1);
    assert.deepEqual(j.rapports[0], { date: '2026-11-10', modifie_le: '2026-11-10T13:40:00.000Z', titre: 'Titre du jour', synthese: 'Synthèse', arbitrages: 'Accélérer A\nPause B', alertes: '', avancements: { kitvital: 58, trader5: 35 } });
    assert.equal(j.rapports_ok, true);
    rapportsLisibles = false;
    const r = await relais.fetch(requete(null, { methode: 'GET', chemin: '/projets' }), env);
    j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.projets.length, 1);
    assert.deepEqual(j.rapports, []);
    assert.equal(j.rapports_ok, false);
  } finally { globalThis.fetch = avant; }
});
