import * as T from "three";

// Some exporters emit BLEND just because an opacity image is linked, even when
// every alpha value is one. GLTFLoader then disables depthWrite, so triangles in
// a single character draw over its own face/clothing in index order. Repair only
// proven opaque materials, not all transparent characters (hair/glass need it).
function opaqueTexture(texture: T.Texture): boolean {
  if (
    texture.format !== T.RGBAFormat ||
    texture instanceof T.CompressedTexture ||
    texture instanceof T.VideoTexture ||
    texture.isRenderTargetTexture ||
    texture.mipmaps.length > 0
  )
    return false;
  const image = texture.image;
  if (!image) return false;
  const width = image.naturalWidth ?? image.width;
  const height = image.naturalHeight ?? image.height;
  // Never downsample: even a single transparent texel must preserve BLEND.
  // Bound the temporary canvas allocation for unusually large imports.
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 4096 * 4096
  )
    return false;
  let pixels: ArrayLike<number>, opaque: number;
  if (image.data) {
    if (
      texture.type === T.UnsignedByteType &&
      image.data instanceof Uint8Array
    ) {
      pixels = image.data;
      opaque = 255;
    } else if (
      texture.type === T.FloatType &&
      image.data instanceof Float32Array
    ) {
      pixels = image.data;
      opaque = 1;
    } else return false;
  } else {
    if (typeof document === "undefined" || texture.type !== T.UnsignedByteType)
      return false;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    try {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return false;
      context.drawImage(image, 0, 0);
      pixels = context.getImageData(0, 0, width, height).data;
      opaque = 255;
    } catch {
      // Unreadable/tainted images are not evidence of opacity. Loading the asset
      // must still work in restricted browsers or when a canvas is unavailable.
      return false;
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
  if (pixels.length !== width * height * 4) return false;
  for (let i = 3; i < pixels.length; i += 4)
    if (pixels[i] !== opaque) return false;
  return true;
}

export function repairOpaqueImportedMaterials(root: T.Object3D): void {
  const visited = new Set<T.Material>();
  const textures = new Map<T.Texture, boolean>();
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      if (visited.has(material)) continue;
      visited.add(material);
      if (
        !(
          material instanceof T.MeshStandardMaterial ||
          material instanceof T.MeshBasicMaterial
        ) ||
        !material.transparent ||
        material.opacity !== 1 ||
        material.alphaMap ||
        material.alphaTest !== 0 ||
        material.alphaHash ||
        material.vertexColors ||
        material.blending !== T.NormalBlending ||
        (material instanceof T.MeshPhysicalMaterial &&
          material.transmission > 0)
      )
        continue;
      if (material.map) {
        const map = material.map;
        if (!textures.has(map)) textures.set(map, opaqueTexture(map));
        if (!textures.get(map)) continue;
      }
      material.transparent = false;
      material.depthWrite = true;
      material.needsUpdate = true;
    }
  });
}
