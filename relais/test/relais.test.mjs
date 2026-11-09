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

const question = { messages: [{ role: 'user', content: 'Quel projet accélérer ?' }], contexte: 'PROJETS : KitVital…', nom: 'Larmina' };

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
  assert.match(appels[0].entree.instructions, /Tu es Larmina/);
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
    assert.match(vus[0].corps.system, /Tu es Larmina/);
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
