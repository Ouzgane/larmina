// Fournisseurs de modèles. Le reste du relais ne connaît que `appeler()` :
// il lui donne des consignes et un fil de messages, il reçoit du texte.
// Ajouter un fournisseur = ajouter une ligne dans PRESETS (et un adaptateur si son API est exotique).

export class ErreurConfig extends Error {}
export class ErreurQuota extends Error {}
export class ErreurFournisseur extends Error {
  constructor(message, statut) { super(message); this.statut = statut; }
}

// adaptateur : forme de l'API ; url et modele : valeurs par défaut, remplaçables par IA_URL et IA_MODELE.
export const PRESETS = {
  cloudflare: { adaptateur: 'cloudflare', modele: '@cf/openai/gpt-oss-120b' },
  anthropic: { adaptateur: 'anthropic', url: 'https://api.anthropic.com/v1/messages', modele: 'claude-haiku-5-5' },
  openai: {
    adaptateur: 'openai', url: 'https://api.openai.com/v1/chat/completions', modele: 'gpt-5-mini',
    // Les modèles de raisonnement d'OpenAI refusent max_tokens et toute température autre que 1.
    corps: (r) => ({ max_completion_tokens: r.maxTokens * 3 }),
  },
  mistral: { adaptateur: 'openai', url: 'https://api.mistral.ai/v1/chat/completions', modele: 'mistral-small-latest' },
  groq: { adaptateur: 'openai', url: 'https://api.groq.com/openai/v1/chat/completions', modele: 'openai/gpt-oss-120b', corps: (r) => ({ max_tokens: r.maxTokens * 3 }) },
  gemini: { adaptateur: 'openai', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', modele: 'gemini-flash-latest', corps: (r) => ({ max_tokens: r.maxTokens * 3 }) },
  openrouter: { adaptateur: 'openai', url: 'https://openrouter.ai/api/v1/chat/completions', modele: 'openai/gpt-oss-120b', corps: (r) => ({ max_tokens: r.maxTokens * 3 }) },
  // N'importe quelle API compatible OpenAI (DeepSeek, Together, Fireworks, vLLM…) : IA_URL et IA_MODELE obligatoires.
  compatible: { adaptateur: 'openai' },
};

export function decrireFournisseur(env) {
  const nom = String(env.IA_FOURNISSEUR || 'cloudflare').trim().toLowerCase();
  const preset = PRESETS[nom];
  if (!preset) throw new ErreurConfig(`Fournisseur inconnu : « ${nom} ». Choix possibles : ${Object.keys(PRESETS).join(', ')}.`);
  const cfg = {
    nom,
    adaptateur: preset.adaptateur,
    modele: String(env.IA_MODELE || '').trim() || preset.modele,
    url: String(env.IA_URL || '').trim() || preset.url,
    cle: env.IA_CLE ? String(env.IA_CLE).trim() : '',
    corps: preset.corps,
  };
  if (!cfg.modele) throw new ErreurConfig(`IA_MODELE est obligatoire pour « ${nom} ».`);
  if (cfg.adaptateur !== 'cloudflare' && !cfg.url) throw new ErreurConfig(`IA_URL est obligatoire pour « ${nom} ».`);
  if (cfg.adaptateur !== 'cloudflare' && nom !== 'compatible' && !cfg.cle) {
    throw new ErreurConfig(`La clé du fournisseur « ${nom} » manque : ajoute le secret IA_CLE.`);
  }
  return cfg;
}

// requete : { systeme, messages: [{ role: 'user'|'assistant', content }], maxTokens }
export async function appeler(cfg, requete, env) {
  const adaptateur = ADAPTATEURS[cfg.adaptateur];
  if (!adaptateur) throw new ErreurConfig(`Adaptateur inconnu : ${cfg.adaptateur}.`);
  const texte = nettoyer(await adaptateur(cfg, requete, env));
  if (!texte) throw new ErreurFournisseur('Le modèle a renvoyé une réponse vide.', 502);
  return texte;
}

const ADAPTATEURS = {
  // Workers AI, par la liaison env.AI : ni clé ni réseau sortant.
  async cloudflare(cfg, r, env) {
    if (!env.AI || typeof env.AI.run !== 'function') throw new ErreurConfig('Liaison Workers AI absente : vérifie la section [ai] de wrangler.toml.');
    const messages = [{ role: 'system', content: r.systeme }, ...r.messages];
    const formats = {
      // Format « Responses » d'OpenAI, celui des modèles gpt-oss.
      responses: () => env.AI.run(cfg.modele, { instructions: r.systeme, input: r.messages, reasoning: { effort: 'low' } }),
      // Format « messages », celui de la plupart des modèles de chat.
      messages: () => env.AI.run(cfg.modele, { messages, max_tokens: r.maxTokens, temperature: 0.4 }),
    };
    const ordre = /gpt-oss/i.test(cfg.modele) ? ['responses', 'messages'] : ['messages'];
    let derniere;
    for (const f of ordre) {
      try {
        const texte = texteDe(await formats[f]());
        if (texte) return texte;
        derniere = new ErreurFournisseur('Réponse vide de Workers AI.', 502);
      } catch (e) {
        if (estQuota(e)) throw new ErreurQuota('Le quota gratuit du jour de Workers AI est atteint. Il se renouvelle à 0 h UTC.');
        derniere = e;
      }
    }
    throw derniere;
  },

  // API « chat completions » d'OpenAI et de tous les compatibles.
  async openai(cfg, r) {
    const entetes = { 'content-type': 'application/json' };
    if (cfg.cle) entetes.authorization = `Bearer ${cfg.cle}`;
    if (cfg.nom === 'openrouter') { entetes['x-title'] = 'Pilotage des projets'; }
    const corps = {
      model: cfg.modele,
      messages: [{ role: 'system', content: r.systeme }, ...r.messages],
      ...(cfg.corps ? cfg.corps(r) : { max_tokens: r.maxTokens, temperature: 0.4 }),
    };
    return texteDe(await envoyer(cfg, entetes, corps));
  },

  // API « messages » d'Anthropic (Claude).
  async anthropic(cfg, r) {
    const entetes = { 'content-type': 'application/json', 'x-api-key': cfg.cle, 'anthropic-version': '2023-06-01' };
    const corps = { model: cfg.modele, system: r.systeme, messages: r.messages, max_tokens: r.maxTokens, temperature: 0.4 };
    return texteDe(await envoyer(cfg, entetes, corps));
  },
};

async function envoyer(cfg, entetes, corps) {
  let rep;
  try {
    rep = await fetch(cfg.url, { method: 'POST', headers: entetes, body: JSON.stringify(corps), signal: AbortSignal.timeout(45000) });
  } catch (e) {
    throw new ErreurFournisseur(`Fournisseur « ${cfg.nom} » injoignable : ${e.message}`, 504);
  }
  const brut = await rep.text();
  if (!rep.ok) {
    const detail = brut.slice(0, 300);
    if (rep.status === 429 || estQuota(detail)) throw new ErreurQuota(`Limite atteinte chez « ${cfg.nom} ». Réessaie dans un moment.`);
    throw new ErreurFournisseur(`« ${cfg.nom} » a répondu ${rep.status} : ${detail}`, 502);
  }
  try { return JSON.parse(brut); } catch (e) { return brut; }
}

function estQuota(e) {
  const m = String((e && e.message) || e || '');
  return /\b4006\b|daily free allocation|neurons|quota|rate.?limit|too many requests/i.test(m);
}

// Extrait le texte quelle que soit la forme de la réponse.
export function texteDe(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return x.map(texteDe).filter(Boolean).join('\n');
  if (typeof x !== 'object') return '';
  if (typeof x.response === 'string') return x.response;
  if (typeof x.output_text === 'string' && x.output_text) return x.output_text;
  if (Array.isArray(x.choices) && x.choices.length) {
    const c = x.choices[0];
    return texteDe((c.message && c.message.content) ?? c.text ?? '');
  }
  if (Array.isArray(x.output)) {
    // Format Responses : on garde les messages, pas le raisonnement.
    return x.output.filter((o) => o && o.type === 'message').map((o) => texteDe(o.content)).filter(Boolean).join('\n');
  }
  if (Array.isArray(x.content)) return x.content.filter((c) => !c.type || c.type === 'text' || c.type === 'output_text').map((c) => c.text || '').join('');
  if (typeof x.text === 'string' && (!x.type || x.type === 'text' || x.type === 'output_text')) return x.text;
  if (x.result) return texteDe(x.result);
  return '';
}

function nettoyer(t) {
  return String(t || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .trim();
}
