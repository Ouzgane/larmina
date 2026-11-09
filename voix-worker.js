// Synthèse vocale locale de Geri (Piper), exécutée hors de la page pour ne pas la figer.
// Phonèmes : espeak-ng (piper_phonemize). Voix : modèle Piper au format ONNX, lu par onnxruntime-web.
// Tout est téléchargé une seule fois puis conservé dans le cache du navigateur.
/* global ort, createPiperPhonemize */
importScripts('vendor/ort/ort.wasm.min.js', 'vendor/piper/piper_phonemize.js');

const ICI = new URL('./', self.location).href;
ort.env.wasm.wasmPaths = ICI + 'vendor/ort/';
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

const SOURCES = [
  'https://huggingface.co/rhasspy/piper-voices/resolve/main/',
  'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/',
];
const CHEMINS = {
  'fr_FR-siwis-medium': 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx',
  'fr_FR-siwis-low': 'fr/fr_FR/siwis/low/fr_FR-siwis-low.onnx',
  'fr_FR-upmc-medium': 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx',
};
const CACHE = 'geri-voix-v1';

let pret = null, session = null, config = null, wasmBinary = null, donnees = null, courant = 0;

async function lire(url, progres) {
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const r = await cache.match(url);
    if (r) return await r.arrayBuffer();
  } catch (e) { cache = null; }
  const rep = await fetch(url);
  if (!rep.ok) throw new Error('Téléchargement impossible (' + rep.status + ') : ' + url);
  const total = Number(rep.headers.get('Content-Length')) || 0;
  let buf;
  if (progres && rep.body && total) {
    const lecteur = rep.body.getReader();
    const morceaux = [];
    let recu = 0, dernier = 0;
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      morceaux.push(value);
      recu += value.length;
      if (recu - dernier > total / 50) { dernier = recu; progres(recu / total); }
    }
    const tout = new Uint8Array(recu);
    let o = 0;
    for (const m of morceaux) { tout.set(m, o); o += m.length; }
    buf = tout.buffer;
  } else {
    buf = await rep.arrayBuffer();
  }
  if (cache) { try { await cache.put(url, new Response(new Blob([buf]))); } catch (e) { /* cache plein : tant pis */ } }
  return buf;
}

async function lireVoix(id, base, progres) {
  const chemin = CHEMINS[id] || CHEMINS['fr_FR-siwis-medium'];
  const sources = base ? [base] : SOURCES;
  let erreur;
  for (const s of sources) {
    try {
      const cfg = JSON.parse(new TextDecoder().decode(await lire(s + chemin + '.json')));
      return { cfg, modele: await lire(s + chemin, progres) };
    } catch (e) { erreur = e; }
  }
  throw erreur;
}

function preparer(id, base) {
  if (!pret) {
    pret = (async () => {
      const progres = (p) => postMessage({ type: 'progres', part: p });
      const [w, d, v] = await Promise.all([
        lire(ICI + 'vendor/piper/piper_phonemize.wasm'),
        lire(ICI + 'vendor/piper/piper_phonemize.data'),
        lireVoix(id, base, progres),
      ]);
      wasmBinary = w; donnees = d; config = v.cfg;
      session = await ort.InferenceSession.create(v.modele, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      postMessage({ type: 'pret' });
    })().catch((e) => { pret = null; throw e; });
  }
  return pret;
}

async function phonemiser(phrases) {
  const lignes = [];
  const m = await createPiperPhonemize({ print: (l) => lignes.push(l), printErr: () => {}, wasmBinary, getPreloadedPackage: () => donnees });
  m.callMain(['-l', (config.espeak && config.espeak.voice) || 'fr', '--input', JSON.stringify(phrases.map((text) => ({ text }))), '--espeak_data', '/espeak-ng-data']);
  return lignes.map((l) => { try { return JSON.parse(l).phoneme_ids; } catch (e) { return null; } });
}

async function synthetiser(ids, vitesse) {
  const inf = config.inference || {};
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / (vitesse || 1), inf.noise_w ?? 0.8]), [3]),
  };
  if ((config.num_speakers || 1) > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const sortie = await session.run(feeds);
  return Float32Array.from((sortie.output || Object.values(sortie)[0]).data);
}

onmessage = async (e) => {
  const m = e.data || {};
  if (m.type === 'annuler') { courant = 0; return; }
  try {
    if (m.type === 'preparer') { await preparer(m.voix, m.base); return; }
    if (m.type === 'dire') {
      courant = m.id;
      await preparer(m.voix, m.base);
      if (courant !== m.id) return;
      const ids = await phonemiser(m.phrases);
      for (let i = 0; i < m.phrases.length; i++) {
        if (courant !== m.id) return;
        if (!ids[i] || !ids[i].length) { postMessage({ type: 'audio', id: m.id, index: i, vide: true }); continue; }
        const audio = await synthetiser(ids[i], m.vitesse);
        if (courant !== m.id) return;
        postMessage({ type: 'audio', id: m.id, index: i, audio, frequence: config.audio.sample_rate }, [audio.buffer]);
      }
      postMessage({ type: 'fin', id: m.id });
    }
  } catch (err) {
    postMessage({ type: 'erreur', id: m.id, message: String((err && err.message) || err) });
  }
};
