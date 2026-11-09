// Assemble et chiffre les données du tableau de pilotage.
// Usage : PILOTAGE_MDP='…' node outils/publier.mjs <dossier des fichiers en clair> [fichier de sortie]
// Le dossier doit contenir projets.json, rapports.json, syntheses.json et revenus.csv
// (copies des jeux de données du tableau de bord Claude). Rien en clair n'est écrit dans le dépôt.
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ITERATIONS = 310000;
const [, , dossier, sortie = 'donnees/pilotage.chiffre.json'] = process.argv;
const mdp = process.env.PILOTAGE_MDP;
if (!dossier) throw new Error('Indique le dossier des fichiers en clair.');
if (!mdp || mdp.length < 12) throw new Error('Variable PILOTAGE_MDP absente ou trop courte.');

const lireJson = (nom) => {
  const v = JSON.parse(readFileSync(join(dossier, nom), 'utf8'));
  if (!Array.isArray(v)) throw new Error(`${nom} doit contenir une liste.`);
  return v;
};

// Lecture CSV (virgules, guillemets doubles, retours à la ligne entre guillemets).
const lireCsv = (texte) => {
  const lignes = [];
  let champ = '', ligne = [], guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === ',') { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      if (ligne.some((x) => x !== '')) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); if (ligne.some((x) => x !== '')) lignes.push(ligne); }
  if (!lignes.length) return [];
  const [entete, ...corps] = lignes;
  return corps.map((l) => Object.fromEntries(entete.map((k, j) => [k.trim(), l[j] === undefined || l[j] === '' ? null : l[j]])));
};

const paquet = {
  genere_le: new Date().toISOString(),
  projets: lireJson('projets.json'),
  rapports: lireJson('rapports.json'),
  syntheses: lireJson('syntheses.json'),
  revenus: lireCsv(readFileSync(join(dossier, 'revenus.csv'), 'utf8')),
};
if (!paquet.projets.length) throw new Error('Aucun projet : publication annulée.');

const b64 = (u8) => Buffer.from(u8).toString('base64');
const sel = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(mdp), 'PBKDF2', false, ['deriveKey']);
const cle = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sel, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cle, new TextEncoder().encode(JSON.stringify(paquet)));

writeFileSync(sortie, JSON.stringify({
  version: 1,
  algorithme: 'AES-GCM-256',
  derivation: { nom: 'PBKDF2-SHA256', iterations: ITERATIONS, sel: b64(sel) },
  iv: b64(iv),
  publie_le: paquet.genere_le,
  donnees: b64(new Uint8Array(chiffre)),
}) + '\n');
console.log(`Publié dans ${sortie} : ${paquet.projets.length} projets, ${paquet.rapports.length} lignes de rapport, ${paquet.syntheses.length} synthèses, ${paquet.revenus.length} encaissements.`);
