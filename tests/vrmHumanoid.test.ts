import { expect, it } from "vitest";
import * as T from "three";
import { characters, type Asset } from "../shared/scene";
import { prepareImportedAsset } from "../src/importedAsset";
import { embeddedHumanoidMapping } from "../src/vrmHumanoid";

// VRM human bone -> [parent, offset]; bones get meaningless names, so only the
// file's humanoid declaration can identify them.
const LAYOUT: [string, string | null, number[]][] = [
  ["hips", null, [0, 100, 0]],
  ["spine", "hips", [0, 10, 0]],
  ["chest", "spine", [0, 25, 0]],
  ["neck", "chest", [0, 20, 0]],
  ["head", "neck", [0, 10, 0]],
  ...(["left", "right"] as const).flatMap((side) => {
    const s = side === "left" ? 1 : -1;
    return [
      [`${side}Shoulder`, "chest", [s * 6, 15, 0]],
      [`${side}UpperArm`, `${side}Shoulder`, [s * 12, 0, 0]],
      [`${side}LowerArm`, `${side}UpperArm`, [s * 28, 0, 0]],
      [`${side}Hand`, `${side}LowerArm`, [s * 25, 0, 0]],
      [`${side}ThumbMetacarpal`, `${side}Hand`, [s * 2, -1, 3]],
      [`${side}ThumbProximal`, `${side}ThumbMetacarpal`, [s * 2, -1, 2]],
      [`${side}IndexProximal`, `${side}Hand`, [s * 8, 0, 2]],
      [`${side}UpperLeg`, "hips", [s * 9, -5, 0]],
      [`${side}LowerLeg`, `${side}UpperLeg`, [0, -42, 0]],
      [`${side}Foot`, `${side}LowerLeg`, [0, -42, 0]],
      [`${side}Toes`, `${side}Foot`, [0, -8, 12]],
    ] as [string, string, number[]][];
  }),
];

function avatar(version: 0 | 1) {
  const scene = new T.Group();
  const associations = new Map<unknown, { nodes?: number }>();
  const bones: Record<string, T.Bone> = {};
  const nodes: Record<string, number> = {};
  LAYOUT.forEach(([human, parent, xyz], index) => {
    const bone = new T.Bone();
    bone.name = `node${index}`;
    bone.position.fromArray(xyz);
    (parent ? bones[parent] : scene).add(bone);
    bones[human] = bone;
    // glTF node indices need not follow traversal order.
    nodes[human] = 100 + index * 3;
    associations.set(bone, { nodes: nodes[human] });
  });
  const extensions =
    version === 1
      ? {
          VRMC_vrm: {
            humanoid: {
              humanBones: Object.fromEntries(
                Object.entries(nodes).map(([bone, node]) => [bone, { node }]),
              ),
            },
          },
        }
      : {
          VRM: {
            humanoid: {
              humanBones: Object.entries(nodes)
                // VRM 0.x thumbs start at the proximal joint.
                .map(([bone, node]) => ({
                  bone: bone
                    .replace("ThumbProximal", "ThumbIntermediate")
                    .replace("ThumbMetacarpal", "ThumbProximal"),
                  node,
                })),
            },
          },
        };
  return { scene, bones, parser: { json: { extensions }, associations } };
}

it.each([1, 0] as const)(
  "maps the joints a VRM %s.x file declares, whatever they are named",
  (version) => {
    const { scene, bones, parser } = avatar(version);
    const mapping = embeddedHumanoidMapping({ scene, parser })!;
    const at = (path: number[]) =>
      path.reduce<T.Object3D>((node, i) => node.children[i], scene);
    expect(at(mapping.hips!)).toBe(bones.hips);
    expect(at(mapping.leftArm!)).toBe(bones.leftUpperArm);
    expect(at(mapping.rightShin!)).toBe(bones.rightLowerLeg);
    expect(at(mapping.leftToeBase!)).toBe(bones.leftToes);
    expect(at(mapping.leftHandThumb1!)).toBe(bones.leftThumbMetacarpal);
    expect(at(mapping.leftHandThumb2!)).toBe(bones.leftThumbProximal);
    expect(at(mapping.leftHandIndex1!)).toBe(bones.leftIndexProximal);
  },
);

it("has no mapping for a file without a humanoid declaration", () => {
  const { scene } = avatar(1);
  expect(
    embeddedHumanoidMapping({
      scene,
      parser: { json: {}, associations: new Map() },
    }),
  ).toBeUndefined();
  expect(embeddedHumanoidMapping({ scene })).toBeUndefined();
});

it("recognises an avatar from its declaration; the user's own mapping wins", () => {
  const { scene, bones, parser } = avatar(1);
  const asset = { ...characters[0], id: "vrm", url: "/x.vrm" } as Asset;
  const group = prepareImportedAsset(asset, {
    scene,
    animations: [],
    parser,
  } as never);
  const roles = group.userData.bones as Record<string, T.Bone>;
  expect(group.userData.rigMappingReport.missing).toEqual([]);
  expect(roles.leftForearm).toBe(bones.leftLowerArm);
  expect(roles.rightLeg).toBe(bones.rightUpperLeg);
  // A user mapping (here: head moved to the neck joint) overrides the file.
  const second = avatar(1);
  const custom = prepareImportedAsset(
    { ...asset, rigMapping: { head: [0, 0, 0, 0] } },
    { scene: second.scene, animations: [], parser: second.parser },
  );
  expect((custom.userData.bones as Record<string, T.Bone>).head).toBe(
    second.bones.neck,
  );
});
