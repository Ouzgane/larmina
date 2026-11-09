// Calcule l'empreinte du jeton d'accès à l'IA à partir du mot de passe du site.
// À relancer seulement si le mot de passe change, puis à recopier dans relais/wrangler.toml (JETON_EMPREINTE).
//   PILOTAGE_MDP='…' node outils/empreinte-ia.mjs
// Doit rester identique à la dérivation faite par assistant.js dans le navigateur.
import { webcrypto as c } from 'node:crypto';

const mdp = process.env.PILOTAGE_MDP;
if (!mdp) { console.error('Définis PILOTAGE_MDP.'); process.exit(1); }
const hex = (b) => Buffer.from(b).toString('hex');
const base = await c.subtle.importKey('raw', new TextEncoder().encode(mdp), 'PBKDF2', false, ['deriveBits']);
const bits = await c.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode('pilotage-ia-jeton-v1'), iterations: 310000, hash: 'SHA-256' }, base, 256);
const empreinte = hex(await c.subtle.digest('SHA-256', new TextEncoder().encode(hex(bits))));
console.log(`JETON_EMPREINTE = "${empreinte}"`);
