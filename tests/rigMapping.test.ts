import { describe, expect, it } from "vitest";
import * as T from "three";
import { characters, assetSchema } from "../shared/scene";
import { rigMappingSchema, type RigMapping } from "../shared/rigMapping";
import { rigBoneInventory } from "../src/rigMapping";
import { createCharacter } from "../src/world";
import { prepareImportedAsset } from "../src/importedAsset";
import {
  applyHumanoidPose,
  applyTransferredClip,
  humanoidWarning,
} from "../src/rig";

function rig(prefix: string) {
  const body = createCharacter(characters[0]);
  const bones = body.userData.bones as Record<string, T.Bone>;
  const twist = new T.Bone();
  twist.position.y = -0.1;
  bones.leftForearm.add(twist);
  const roles: Record<string, T.Bone> = { ...bones, leftForearmTwist: twist };
  const mapping: RigMapping = {};
  for (const [index, [role, bone]] of Object.entries(roles).entries()) {
    bone.name = `${prefix}_${index}`;
    mapping[role] = rigBoneInventory(body).find(
      (entry) => entry.bone === bone,
    )!.path;
  }
  return { body, roles, mapping };
}
describe("provider-independent explicit rig maps", () => {
  it("preserves mapped body and auxiliary-joint motion between unrelated naming schemes", () => {
    const a = rig("OpaqueA"),
      b = rig("DifferentB");
    const q = new T.Quaternion().setFromEuler(new T.Euler(0.6, 0.2, -0.1));
    const clip = new T.AnimationClip("Take", 1, [
      new T.QuaternionKeyframeTrack(
        a.roles.leftForearmTwist.name + ".quaternion",
        [0, 1],
        [0, 0, 0, 1, ...q.toArray()],
      ),
    ]);
    const source = prepareImportedAsset(
      { ...characters[0], rigMapping: a.mapping },
      { scene: a.body, animations: [clip] },
    );
    const target = prepareImportedAsset(
      { ...characters[0], rigMapping: b.mapping },
      { scene: b.body, animations: [] },
    );
    expect(humanoidWarning(source, "Source", false)).toBe("");
    expect(humanoidWarning(target, "Target", false)).toBe("");
    applyHumanoidPose(target, {}, true);
    expect(applyTransferredClip(source, target, clip, 0.8)).toBe("");
    expect(
      b.roles.leftForearmTwist.quaternion.angleTo(
        a.roles.leftForearmTwist.quaternion,
      ),
    ).toBeLessThan(1e-6);
    expect(target.userData.retargetReport.unsupported).toEqual([]);
    expect(
      assetSchema.parse(
        JSON.parse(JSON.stringify({ ...characters[0], rigMapping: b.mapping })),
      ).rigMapping,
    ).toEqual(b.mapping);
  });
  it("keeps paths stable across fresh parses and distinguishes duplicate names", () => {
    const a = rig("Same"),
      b = rig("Same");
    for (const bone of Object.values(a.roles)) bone.name = "Duplicate";
    for (const bone of Object.values(b.roles)) bone.name = "Duplicate";
    const loaded = prepareImportedAsset(
      { ...characters[0], rigMapping: a.mapping },
      { scene: b.body, animations: [] },
    );
    expect(loaded.userData.bones.leftForearm).toBe(b.roles.leftForearm);
    expect(humanoidWarning(loaded, "Actor", false)).toBe("");
  });
  it("does not silently fall back from a disabled or stale explicit assignment", () => {
    const a = rig("Source");
    a.roles.leftArm.name = "leftArm";
    const loaded = prepareImportedAsset(
      {
        ...characters[0],
        rigMapping: { ...a.mapping, leftArm: [999], rightArm: null },
      },
      { scene: a.body, animations: [] },
    );
    expect(loaded.userData.bones.leftArm).toBeUndefined();
    expect(loaded.userData.bones.rightArm).toBeUndefined();
    expect(humanoidWarning(loaded, "Actor", false)).toContain(
      "Invalid bone paths: leftArm",
    );
  });
  it("rejects duplicate roles, duplicate assignments and invalid hierarchy indices", () => {
    for (const map of [
      { leftArm: [1], rightArm: [1] },
      { leftArm: [1], LeftArm: [2] },
      { hips: [-1] },
      { hips: [0.5] },
    ])
      expect(rigMappingSchema.safeParse(map).success).toBe(false);
  });
});
