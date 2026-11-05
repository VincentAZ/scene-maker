/**
 * Decoders for compressed glTF files (Draco meshes, KTX2/Basis textures). The
 * server serves them straight from the installed three.js package
 * (examples/jsm/libs, Apache-2.0 files that stay in node_modules), so they
 * always match its loaders and this repository keeps no copies of them.
 * Meshopt decoding is bundled with the app and needs no served files.
 */
export const decoders = {
  draco: {
    url: "/engine/draco/",
    folder: "draco/gltf",
    files: ["draco_wasm_wrapper.js", "draco_decoder.wasm", "draco_decoder.js"],
  },
  basis: {
    url: "/engine/basis/",
    folder: "basis",
    files: ["basis_transcoder.js", "basis_transcoder.wasm"],
  },
};
