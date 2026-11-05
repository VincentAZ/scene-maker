// A dependency-free reader of the GLB container for tests and content checks:
// the JSON document, the binary chunk, embedded image sizes and the world-
// space extent of each mesh node from the accessors' min/max.
export interface GLB {
  json: GLTFDocument;
  bin: Uint8Array;
}

interface GLTFDocument {
  extensionsRequired?: string[];
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  accessors?: { min?: number[]; max?: number[]; bufferView?: number }[];
  meshes?: { primitives: { attributes: Record<string, number> }[] }[];
  nodes?: {
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    extras?: Record<string, unknown>;
    name?: string;
  }[];
  scenes?: { nodes: number[] }[];
  scene?: number;
  materials?: { alphaMode?: string; doubleSided?: boolean }[];
}

export function readGLB(bytes: Uint8Array): GLB {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw Error("Not a GLB file.");
  let offset = 12;
  let json: GLTFDocument | undefined;
  let bin: Uint8Array = new Uint8Array(0);
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a)
      json = JSON.parse(new TextDecoder().decode(chunk)) as GLTFDocument;
    else if (type === 0x004e4942) bin = chunk;
    offset += 8 + length;
  }
  if (!json) throw Error("The GLB has no JSON chunk.");
  return { json, bin };
}

/** True when every buffer and image lives inside the file. */
export function selfContained({ json }: GLB) {
  return (
    (json.buffers ?? []).every((buffer) => !buffer.uri) &&
    (json.images ?? []).every((image) => image.bufferView !== undefined)
  );
}

/** Pixel size of each embedded JPEG or PNG image. */
export function imageSizes({ json, bin }: GLB) {
  return (json.images ?? []).map((image) => {
    const view = json.bufferViews![image.bufferView!];
    const data = bin.subarray(
      view.byteOffset ?? 0,
      (view.byteOffset ?? 0) + view.byteLength,
    );
    return { ...imageSize(data), mimeType: image.mimeType };
  });
}

function imageSize(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data[0] === 0x89 && data[1] === 0x50)
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (data[0] === 0xff && data[1] === 0xd8) {
    // Walk the JPEG segments to the first frame header.
    let offset = 2;
    while (offset < data.length) {
      if (data[offset] !== 0xff) break;
      const marker = data[offset + 1];
      const length = view.getUint16(offset + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      )
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      offset += 2 + length;
    }
  }
  return { width: 0, height: 0 };
}

/** The world-space bounds of every mesh node, with its extras. */
export function meshBounds({ json }: GLB) {
  const results: {
    name?: string;
    role?: string;
    min: number[];
    max: number[];
  }[] = [];
  const scene = json.scenes?.[json.scene ?? 0];
  const visit = (index: number, parent: number[]) => {
    const node = json.nodes![index];
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = json.meshes![node.mesh];
      for (const primitive of mesh.primitives) {
        const accessor = json.accessors![primitive.attributes.POSITION];
        if (!accessor.min || !accessor.max) continue;
        const corners: number[][] = [];
        for (let i = 0; i < 8; i++)
          corners.push(
            transform(world, [
              i & 1 ? accessor.max[0] : accessor.min[0],
              i & 2 ? accessor.max[1] : accessor.min[1],
              i & 4 ? accessor.max[2] : accessor.min[2],
            ]),
          );
        results.push({
          name: node.name,
          role: (node.extras?.sceneMaker as { role?: string } | undefined)
            ?.role,
          min: [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k]))),
          max: [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k]))),
        });
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const index of scene?.nodes ?? []) visit(index, identity());
  return results;
}

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function nodeMatrix(node: NonNullable<GLTFDocument["nodes"]>[number]) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  // Column-major TRS, as glTF stores matrices.
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function multiply(a: number[], b: number[]) {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++)
        out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  return out;
}

function transform(m: number[], [x, y, z]: number[]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}
