# Composants tiers

| Dossier | Composant | Licence | Source |
|---|---|---|---|
| `vendor/d3.min.js` | D3 7.9 | ISC | https://github.com/d3/d3 |
| `vendor/ort/` | onnxruntime-web 1.18.0 (moteur WebAssembly) | MIT, © Microsoft | https://github.com/microsoft/onnxruntime |
| `vendor/piper/` | piper-phonemize compilé en WebAssembly (@diffusionstudio/piper-wasm 1.0.0) | MIT | https://github.com/rhasspy/piper-phonemize, https://github.com/diffusionstudio/piper-wasm |
| `vendor/piper/piper_phonemize.data` | Données de prononciation espeak-ng | GPL-3.0 ou ultérieure | https://github.com/espeak-ng/espeak-ng |

La voix elle-même (modèle Piper « Siwis », fr_FR) n'est pas dans ce dépôt : le navigateur la télécharge une fois depuis https://huggingface.co/rhasspy/piper-voices puis la garde en cache.
