# Model decoders

Served at `/engine/draco/` and `/engine/basis/` for compressed glTF files
(Draco meshes, KTX2/Basis textures), both in the Vite dev server (through the
API proxy) and in production. Copied unchanged from `three/examples/jsm/libs`
of the installed three.js release; copy them again after a three.js upgrade.

- `draco/` — Google Draco decoder (`draco_decoder.js`, `draco_decoder.wasm`,
  `draco_wasm_wrapper.js`), Apache License 2.0,
  https://github.com/google/draco
- `basis/` — Binomial Basis Universal transcoder (`basis_transcoder.js`,
  `basis_transcoder.wasm`), Apache License 2.0,
  https://github.com/BinomialLLC/basis_universal

Meshopt decoding uses `three/addons/libs/meshopt_decoder.module.js` from the
bundle and needs no served files.
