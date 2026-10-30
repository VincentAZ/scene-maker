import { afterEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { repairOpaqueImportedMaterials } from "../src/importedMaterials";
import { prepareImportedAsset } from "../src/importedAsset";
import { characters } from "../shared/scene";

const texture = (alpha = 255) =>
  new T.DataTexture(
    new Uint8Array([20, 40, 60, 255, 80, 90, 100, alpha]),
    2,
    1,
  );
const material = (map: T.Texture | null = texture()) =>
  new T.MeshStandardMaterial({ transparent: true, depthWrite: false, map });
const mesh = (mat = material()) => new T.Mesh(new T.BoxGeometry(), mat);

afterEach(() => vi.unstubAllGlobals());

describe("opaque imported BLEND materials", () => {
  it("restores occlusion on existing imported characters without changing geometry or textures", () => {
    const mat = material(),
      object = mesh(mat),
      root = new T.Group();
    root.add(object);
    const positions = object.geometry.attributes.position.array.slice();
    const originalMap = mat.map;
    const prepared = prepareImportedAsset(characters[0], {
      scene: root,
      animations: [],
    });
    expect(prepared.children[0]).toBe(root);
    expect(mat.transparent).toBe(false);
    expect(mat.depthWrite).toBe(true);
    expect(mat.map).toBe(originalMap);
    expect(object.geometry.attributes.position.array).toEqual(positions);
    const version = mat.version;
    repairOpaqueImportedMaterials(prepared);
    expect(mat.version).toBe(version);
  });

  it("does not mistake dark RGB pixels for transparency and supports float RGBA data", () => {
    const mat = material(
      new T.DataTexture(
        new Float32Array([0, 0, 0, 1]),
        1,
        1,
        T.RGBAFormat,
        T.FloatType,
      ),
    );
    repairOpaqueImportedMaterials(mesh(mat));
    expect(mat.transparent).toBe(false);
  });

  it.each([0, 128, 254])(
    "preserves even one non-opaque texel (alpha %s)",
    (alpha) => {
      const mat = material(texture(alpha));
      repairOpaqueImportedMaterials(mesh(mat));
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
    },
  );

  it.each([
    "opacity",
    "alphaMap",
    "vertexColors",
    "alphaTest",
    "alphaHash",
    "blending",
  ] as const)("preserves another alpha/blending source: %s", (source) => {
    const mat = material();
    switch (source) {
      case "opacity":
        mat.opacity = 0.5;
        break;
      case "alphaMap":
        mat.alphaMap = texture();
        break;
      case "vertexColors":
        mat.vertexColors = true;
        break;
      case "alphaTest":
        mat.alphaTest = 0.5;
        break;
      case "alphaHash":
        mat.alphaHash = true;
        break;
      case "blending":
        mat.blending = T.AdditiveBlending;
        break;
    }
    repairOpaqueImportedMaterials(mesh(mat));
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
  });

  it("preserves physical transmission, shader materials, MASK and already-opaque settings", () => {
    const mats = [
      new T.MeshPhysicalMaterial({
        transparent: true,
        depthWrite: false,
        transmission: 1,
      }),
      new T.ShaderMaterial({ transparent: true, depthWrite: false }),
      new T.MeshStandardMaterial({ alphaTest: 0.5, depthWrite: false }),
      new T.MeshStandardMaterial({ depthWrite: false }),
    ];
    for (const mat of mats) {
      const before = [mat.transparent, mat.depthWrite, mat.version];
      repairOpaqueImportedMaterials(new T.Mesh(new T.BoxGeometry(), mat));
      expect([mat.transparent, mat.depthWrite, mat.version]).toEqual(before);
    }
  });

  it("leaves unreadable, oversized and unsupported texture data alone", () => {
    const unknown = new T.Texture();
    unknown.image = { width: 2, height: 1 };
    const large = new T.Texture();
    large.image = { width: 8192, height: 8192 };
    const truncated = texture();
    truncated.image.data = new Uint8Array([255, 255, 255, 255]);
    const unsupported = texture();
    unsupported.type = T.HalfFloatType;
    const customMipmaps = texture();
    customMipmaps.mipmaps = [
      { data: new Uint8Array([255, 255, 255, 128]), width: 1, height: 1 },
    ];
    for (const map of [unknown, large, truncated, unsupported, customMipmaps]) {
      const mat = material(map);
      repairOpaqueImportedMaterials(mesh(mat));
      expect(mat.transparent).toBe(true);
    }
  });

  it("reads full browser image alpha once per shared texture, including material arrays", () => {
    const getImageData = vi.fn(() => ({
      data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]),
    }));
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, getImageData }),
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    const map = new T.Texture();
    map.image = { width: 2, height: 1 };
    const a = material(map),
      b = material(map);
    const root = new T.Group();
    root.add(new T.Mesh(new T.BoxGeometry(), [a, b]), mesh(a));
    repairOpaqueImportedMaterials(root);
    expect(a.transparent).toBe(false);
    expect(b.transparent).toBe(false);
    expect(getImageData).toHaveBeenCalledExactlyOnceWith(0, 0, 2, 1);
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(map.image, 0, 0);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("retains transparency if browser alpha decoding fails", () => {
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({
          drawImage: () => {
            throw Error("Tainted canvas");
          },
        }),
      }),
    });
    const map = new T.Texture();
    map.image = { width: 1, height: 1 };
    const mat = material(map);
    expect(() => repairOpaqueImportedMaterials(mesh(mat))).not.toThrow();
    expect(mat.transparent).toBe(true);
  });

  it("repairs real GLTFLoader BLEND defaults and keeps the fix on GLTF export", async () => {
    vi.stubGlobal(
      "ProgressEvent",
      class extends Event {
        constructor(type: string, init: object) {
          super(type);
          Object.assign(this, init);
        }
      },
    );
    const gltf = await new GLTFLoader().parseAsync(
      JSON.stringify({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        buffers: [
          {
            byteLength: 36,
            uri: `data:application/octet-stream;base64,${Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer).toString("base64")}`,
          },
        ],
        bufferViews: [{ buffer: 0, byteLength: 36 }],
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: "VEC3",
            min: [0, 0, 0],
            max: [1, 1, 0],
          },
        ],
        meshes: [
          { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
        ],
        materials: [
          {
            alphaMode: "BLEND",
            pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] },
          },
        ],
      }),
      "",
    );
    const object = gltf.scene.children[0] as T.Mesh<
      T.BufferGeometry,
      T.MeshStandardMaterial
    >;
    expect(object.material.transparent).toBe(true);
    expect(object.material.depthWrite).toBe(false);
    repairOpaqueImportedMaterials(gltf.scene);
    expect(object.material.transparent).toBe(false);
    expect(object.material.depthWrite).toBe(true);
    // Node has Blob but not FileReader; read the exporter's real binary payload.
    vi.stubGlobal(
      "FileReader",
      class {
        result: string | ArrayBuffer | null = null;
        onloadend?: () => void;
        readAsArrayBuffer(blob: Blob) {
          void blob.arrayBuffer().then((result) => {
            this.result = result;
            this.onloadend?.();
          });
        }
        readAsDataURL(blob: Blob) {
          void blob.arrayBuffer().then((result) => {
            this.result = `data:${blob.type};base64,${Buffer.from(result).toString("base64")}`;
            this.onloadend?.();
          });
        }
      },
    );
    const exported = await new GLTFExporter().parseAsync(gltf.scene, {
      binary: false,
    });
    expect(exported).not.toBeInstanceOf(ArrayBuffer);
    const json = exported as { materials: { alphaMode?: string }[] };
    expect(json.materials[0].alphaMode ?? "OPAQUE").toBe("OPAQUE");
  });
});
