import * as T from "three";
import type { RigMapping } from "../shared/rigMapping";

type Parser = {
  json?: {
    extensions?: {
      VRMC_vrm?: {
        humanoid?: { humanBones?: Record<string, { node: number }> };
      };
      VRM?: { humanoid?: { humanBones?: { bone: string; node: number }[] } };
    };
  };
  associations?: Map<unknown, { nodes?: number }>;
};

const body: Record<string, string> = {
  hips: "hips",
  spine: "spine",
  chest: "chest",
  upperChest: "upperChest",
  neck: "neck",
  head: "head",
};
for (const side of ["left", "right"]) {
  Object.assign(body, {
    [`${side}Shoulder`]: `${side}Shoulder`,
    [`${side}UpperArm`]: `${side}Arm`,
    [`${side}LowerArm`]: `${side}Forearm`,
    [`${side}Hand`]: `${side}Hand`,
    [`${side}UpperLeg`]: `${side}Leg`,
    [`${side}LowerLeg`]: `${side}Shin`,
    [`${side}Foot`]: `${side}Foot`,
    [`${side}Toes`]: `${side}ToeBase`,
  });
}

/** Role for a VRM human bone name. Finger segments count from the palm; VRM
 * 1.0 thumbs start at the metacarpal, VRM 0.x thumbs at the proximal. */
function roleOf(name: string, version: 0 | 1) {
  if (body[name]) return body[name];
  const finger = name.match(
    /^(left|right)(Thumb|Index|Middle|Ring|Little)(Metacarpal|Proximal|Intermediate|Distal)$/,
  );
  if (!finger) return;
  const order =
    finger[2] === "Thumb" && version === 1
      ? ["Metacarpal", "Proximal", "Distal"]
      : ["Proximal", "Intermediate", "Distal"];
  const segment = order.indexOf(finger[3]) + 1;
  if (!segment) return;
  const digit = finger[2] === "Little" ? "Pinky" : finger[2];
  return `${finger[1]}Hand${digit}${segment}`;
}

/** The humanoid bone map a VRM file declares (VRMC_vrm for 1.0, VRM for 0.x),
 * as a rig mapping of child-index paths below the imported scene. The file's
 * own declaration identifies its joints whatever they are named. Undefined
 * for files without one. */
export function embeddedHumanoidMapping(gltf: {
  scene: T.Object3D;
  parser?: unknown;
}): RigMapping | undefined {
  const parser = gltf.parser as Parser | undefined;
  const extensions = parser?.json?.extensions;
  const declared: [string, number, 0 | 1][] = extensions?.VRMC_vrm?.humanoid
    ?.humanBones
    ? Object.entries(extensions.VRMC_vrm.humanoid.humanBones).map(
        ([bone, { node }]) => [bone, node, 1],
      )
    : (extensions?.VRM?.humanoid?.humanBones ?? []).map(({ bone, node }) => [
        bone,
        node,
        0,
      ]);
  if (!declared.length || !parser?.associations) return;
  const byNode = new Map<number, T.Object3D>();
  for (const [object, association] of parser.associations)
    if (object instanceof T.Object3D && association.nodes !== undefined)
      byNode.set(association.nodes, object);
  const pathTo = (object: T.Object3D) => {
    const path: number[] = [];
    for (let node = object; node !== gltf.scene; node = node.parent!) {
      if (!node.parent) return;
      path.unshift(node.parent.children.indexOf(node));
    }
    return path;
  };
  const mapping: RigMapping = {};
  for (const [bone, node, version] of declared) {
    const role = roleOf(bone, version),
      object = byNode.get(node);
    const path = object && pathTo(object);
    if (role && path) mapping[role] = path;
  }
  return Object.keys(mapping).length ? mapping : undefined;
}
