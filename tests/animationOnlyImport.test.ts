import { expect, it } from "vitest";
import * as T from "three";
import { characters, type Asset } from "../shared/scene";
import { prepareImportedAsset } from "../src/importedAsset";
import { sampleSkeletonSoles } from "../src/footSurface";

/** An armature without any mesh, as an animation-only export loads: joints are
 * plain nodes because no skin marks them as bones. */
function armature() {
  const scene = new T.Group();
  const root = new T.Object3D();
  root.name = "Armature";
  scene.add(root);
  const nodes: Record<string, T.Object3D> = {};
  const add = (name: string, parent: T.Object3D, xyz: number[]) => {
    const node = new T.Object3D();
    node.name = name;
    node.position.fromArray(xyz);
    parent.add(node);
    nodes[name] = node;
    return node;
  };
  const hips = add("Hips", root, [0, 100, 0]);
  const spine = add("Spine", hips, [0, 10, 0]);
  const chest = add("Spine2", spine, [0, 25, 0]);
  add(
    "HeadTop_End",
    add("Head", add("Neck", chest, [0, 20, 0]), [0, 10, 0]),
    [0, 18, 0],
  );
  for (const [side, sign] of [
    ["Left", 1],
    ["Right", -1],
  ] as const) {
    const shoulder = add(`${side}Shoulder`, chest, [sign * 6, 15, 0]);
    add(
      `${side}Hand`,
      add(`${side}ForeArm`, add(`${side}Arm`, shoulder, [sign * 12, 0, 0]), [
        sign * 28,
        0,
        0,
      ]),
      [sign * 25, 0, 0],
    );
    add(
      `${side}ToeBase`,
      add(
        `${side}Foot`,
        add(
          `${side}Leg`,
          add(`${side}UpLeg`, hips, [sign * 9, -5, 0]),
          [0, -42, 0],
        ),
        [0, -42, 0],
      ),
      [0, -8, 12],
    );
  }
  const clip = new T.AnimationClip("walk", 1, [
    new T.QuaternionKeyframeTrack(
      "Hips.quaternion",
      [0, 1],
      [0, 0, 0, 1, 0, 0.1, 0, 0.995],
    ),
    new T.VectorKeyframeTrack("Hips.position", [0, 1], [0, 100, 0, 0, 100, 50]),
    new T.QuaternionKeyframeTrack(
      "LeftArm.quaternion",
      [0, 1],
      [0, 0, 0, 1, 0, 0, 0.2, 0.98],
    ),
  ]);
  return { scene, nodes, clip };
}

it("recognises a humanoid rig in an animation-only (mesh-less) file", () => {
  const { scene, nodes, clip } = armature();
  const asset = {
    ...characters[0],
    id: "animation-only",
    url: "/x.glb",
  } as Asset;
  const uuids = Object.fromEntries(
    Object.entries(nodes).map(([k, n]) => [k, n.uuid]),
  );
  const group = prepareImportedAsset(asset, { scene, animations: [clip] });
  const bones = group.userData.bones as Record<string, T.Object3D>;
  for (const role of [
    "hips",
    "spine",
    "head",
    "leftArm",
    "leftForearm",
    "rightArm",
    "rightForearm",
    "leftLeg",
    "leftShin",
    "rightLeg",
    "rightShin",
  ])
    expect(bones[role], role).toBeInstanceOf(T.Bone);
  expect(group.userData.rigMappingReport.missing).toEqual([]);
  // Identity, transforms and order survive the promotion; the armature node
  // itself (not animated) stays a plain node.
  expect(bones.hips.uuid).toBe(uuids.Hips);
  expect(bones.leftForearm.name).toBe("LeftForeArm");
  let armatureNode: T.Object3D | undefined;
  group.traverse((n) => {
    if (n.name === "Armature") armatureNode = n;
  });
  expect(armatureNode).toBeDefined();
  expect(armatureNode).not.toBeInstanceOf(T.Bone);
  // Size normalization comes from the joints when there is no mesh.
  group.updateMatrixWorld(true);
  const head = bones.head.getWorldPosition(new T.Vector3()),
    toe = new T.Vector3();
  group.traverse((n) => {
    if (n.name === "LeftToeBase") n.getWorldPosition(toe);
  });
  expect(Number.isFinite(head.y)).toBe(true);
  expect(head.y - toe.y).toBeGreaterThan(1);
  expect(head.y - toe.y).toBeLessThan(2);
  // The clip still drives the promoted joints.
  const mixer = group.userData.mixer as T.AnimationMixer;
  mixer.clipAction(clip).play();
  mixer.setTime(0.5);
  expect(bones.leftArm.quaternion.z).toBeGreaterThan(0.05);
});

const forwardOf = (group: T.Group) => {
  const bones = group.userData.bones as Record<string, T.Object3D>;
  group.updateMatrixWorld(true);
  const across = group
    .worldToLocal(bones.leftLeg.getWorldPosition(new T.Vector3()))
    .sub(group.worldToLocal(bones.rightLeg.getWorldPosition(new T.Vector3())));
  across.y = 0;
  return new T.Vector3().crossVectors(
    across.normalize(),
    new T.Vector3(0, 1, 0),
  );
};

it.each([0, Math.PI, Math.PI / 2, -Math.PI / 2, 0.3])(
  "turns a character authored facing another way (yaw %s) to face +Z",
  (yaw) => {
    const { scene, clip } = armature();
    scene.children[0].rotation.y = yaw;
    const asset = { ...characters[0], id: "facing", url: "/x.glb" } as Asset;
    const group = prepareImportedAsset(asset, { scene, animations: [clip] });
    const forward = forwardOf(group);
    // Quarter-turn conventions are corrected; small artistic yaw is kept.
    const expected = new T.Vector3(0, 0, 1).applyAxisAngle(
      new T.Vector3(0, 1, 0),
      Math.abs(yaw) > Math.PI / 4 ? 0 : yaw,
    );
    expect(forward.distanceTo(expected)).toBeLessThan(1e-6);
    // Track values are untouched: the turn is outside the animation hierarchy.
    const hips = (group.userData.bones as Record<string, T.Object3D>).hips;
    const mixer = group.userData.mixer as T.AnimationMixer;
    mixer.clipAction(clip).play();
    mixer.setTime(0.5);
    expect(hips.position.toArray()).toEqual([0, 100, 25]);
  },
);

it("keeps a detached (IK-style) foot of an armature exported without skin", () => {
  const { scene, nodes, clip } = armature();
  // Feet moved out of the leg chain, as IK rigs export them.
  for (const side of ["Left", "Right"]) {
    const foot = nodes[`${side}Foot`];
    nodes.Hips.attach(foot);
  }
  const asset = { ...characters[0], id: "ik-feet", url: "/x.glb" } as Asset;
  const group = prepareImportedAsset(asset, { scene, animations: [clip] });
  const bones = group.userData.bones as Record<string, T.Object3D>;
  expect(bones.leftFoot?.name).toBe("LeftFoot");
  expect(bones.rightFoot?.name).toBe("RightFoot");
  expect(
    (group.userData.detachedJointAnchors as Map<T.Object3D, T.Object3D>).get(
      bones.leftFoot,
    ),
  ).toBe(bones.leftShin);
});

it.each([
  ["Z-up", new T.Euler(Math.PI / 2, 0, 0)],
  ["lying face down", new T.Euler(-Math.PI / 2, 0, 0)],
  ["on its side", new T.Euler(0, 0, Math.PI / 2)],
])("stands up a character authored %s", (_, rotation) => {
  const { scene, clip } = armature();
  scene.children[0].rotation.copy(rotation);
  const asset = { ...characters[0], id: "upright", url: "/x.glb" } as Asset;
  const group = prepareImportedAsset(asset, { scene, animations: [clip] });
  const bones = group.userData.bones as Record<string, T.Object3D>;
  group.updateMatrixWorld(true);
  const at = (o: T.Object3D) =>
    group.worldToLocal(o.getWorldPosition(new T.Vector3()));
  const up = at(bones.head).sub(at(bones.hips)).normalize();
  expect(up.y).toBeGreaterThan(0.999);
  expect(forwardOf(group).distanceTo(new T.Vector3(0, 0, 1))).toBeLessThan(
    1e-6,
  );
  // Grounded and 1.85 tall from its joints; tracks keep their values.
  let low = Infinity,
    high = -Infinity;
  group.traverse((n) => {
    if (n instanceof T.Bone) {
      low = Math.min(low, at(n).y);
      high = Math.max(high, at(n).y);
    }
  });
  expect(low).toBeCloseTo(0, 6);
  expect(high - low).toBeCloseTo(1.85, 6);
  const mixer = group.userData.mixer as T.AnimationMixer;
  mixer.clipAction(clip).play();
  mixer.setTime(0.5);
  expect(bones.hips.position.toArray()).toEqual([0, 100, 25]);
});

it("gives a skeleton without any mesh soles that roll with heel and toe", () => {
  const { scene, clip } = armature();
  const asset = { ...characters[0], id: "soles", url: "/x.glb" } as Asset;
  const group = prepareImportedAsset(asset, { scene, animations: [clip] });
  const bones = group.userData.bones as Record<string, T.Object3D>;
  const rest = sampleSkeletonSoles(group)!;
  expect(rest.lowest).toBeCloseTo(rest.bindFloor, 9);
  // Heel strike: the foot pitches toes-up about its ankle. The heel point
  // stays on the floor (the ankle joint itself is far above it).
  const ankle = group.worldToLocal(
    bones.leftFoot.getWorldPosition(new T.Vector3()),
  ).y;
  bones.leftFoot.rotateX(-0.35);
  const heel = sampleSkeletonSoles(group)!;
  expect(heel.left - heel.bindFloor).toBeLessThan(0.02);
  expect(ankle - heel.bindFloor).toBeGreaterThan(0.05);
  // A lifted leg lifts that sole by the same amount.
  bones.leftFoot.rotation.set(0, 0, 0);
  bones.leftShin.position.y +=
    0.05 / bones.leftShin.parent!.getWorldScale(new T.Vector3()).x;
  expect(sampleSkeletonSoles(group)!.left - rest.bindFloor).toBeGreaterThan(
    0.01,
  );
  expect(sampleSkeletonSoles(group)!.right).toBeCloseTo(rest.right, 9);
});
