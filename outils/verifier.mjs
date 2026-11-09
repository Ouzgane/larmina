// Vérifie que le fichier chiffré se relit avec le mot de passe, comme le fera le navigateur.
// Usage : PILOTAGE_MDP='…' node outils/verifier.mjs [fichier chiffré]
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fichier = process.argv[2] || 'donnees/pilotage.chiffre.json';
const mdp = process.env.PILOTAGE_MDP;
if (!mdp) throw new Error('Variable PILOTAGE_MDP absente.');
const env = JSON.parse(readFileSync(fichier, 'utf8'));
const u8 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(mdp), 'PBKDF2', false, ['deriveKey']);
const cle = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: u8(env.derivation.sel), iterations: env.derivation.iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8(env.iv) }, cle, u8(env.donnees));
const p = JSON.parse(new TextDecoder().decode(clair));
const s = p.syntheses[0] || {};
console.log(`OK : publié le ${env.publie_le}, ${p.projets.length} projets, rapport du ${s.date || '?'} (« ${s.titre || ''} »), ${p.revenus.length} encaissements.`);
const contenu = readFileSync(fichier, 'utf8');
for (const p2 of p.projets) {
  if (contenu.includes(p2.projet)) throw new Error(`Le nom « ${p2.projet} » apparaît en clair dans le fichier chiffré.`);
}
