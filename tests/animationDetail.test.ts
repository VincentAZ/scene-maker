import { describe, expect, it } from "vitest";
import * as T from "three";
import { characters, starterScene, type Entity } from "../shared/scene";
import { retargetReport } from "../src/detailedRetarget";
import type { RigMapping } from "../shared/rigMapping";
import {
  configureImportedRig,
  nativeRootMotion,
  setMotionSources,
  transferWarning,
} from "../src/rig";
import { applyAnimatedEntityPose, createCharacter } from "../src/world";

const duration = 2.4;
const point = (object: T.Object3D) => object.getWorldPosition(new T.Vector3());
const orientation = (object: T.Object3D) =>
  object.getWorldQuaternion(new T.Quaternion()).normalize();
const rotation = (x: number, y: number, z: number) =>
  new T.Quaternion().setFromEuler(new T.Euler(x, y, z));

// Synthetic CC hierarchy, following actorcoreRig.test.ts: Hip branches into
// Pelvis and Waist; twist/share/facial bones are separate from anatomical joints.
// Positions are in meters. Reframing bones preserves every bind joint position,
// so a different roll is an independent test of axes, not of body proportions.
function fixture(
  roll = 0,
  prefix = "",
  morphNames = ["Smile", "Blink", "Frown"],
  withAttachmentHelper = false,
) {
  const group = new T.Group();
  const imported = new T.Group();
  group.add(imported);
  const joints: Record<string, T.Bone> = {};
  const add = (
    name: string,
    parent: string | null,
    xyz: [number, number, number],
  ) => {
    const bone = new T.Bone();
    bone.name = prefix + name;
    const ancestor = parent ? joints[parent] : imported;
    bone.position.copy(ancestor.worldToLocal(new T.Vector3(...xyz)));
    ancestor.add(bone);
    joints[name] = bone;
    group.updateWorldMatrix(true, true);
  };
  add("root", null, [0, 0, 0]);
  add("CC_Base_Hip", "root", [0, 1, 0]);
  add("CC_Base_Pelvis", "CC_Base_Hip", [0, 1, 0]);
  if (withAttachmentHelper)
    add("TorsoAttachmentHelper", "CC_Base_Hip", [0.03, 1.04, 0.02]);
  add(
    "CC_Base_Waist",
    withAttachmentHelper ? "TorsoAttachmentHelper" : "CC_Base_Hip",
    [0, 1.08, 0],
  );
  add("CC_Base_Spine01", "CC_Base_Waist", [0, 1.15, 0]);
  add("CC_Base_Spine02", "CC_Base_Spine01", [0, 1.3, 0]);
  add("CC_Base_NeckTwist01", "CC_Base_Spine02", [0, 1.55, 0]);
  add("CC_Base_NeckTwist02", "CC_Base_NeckTwist01", [0, 1.59, 0]);
  add("CC_Base_Head", "CC_Base_NeckTwist02", [0, 1.65, 0]);
  add("CC_Base_FacialBone", "CC_Base_Head", [0, 1.65, 0.04]);
  add("CC_Base_JawRoot", "CC_Base_FacialBone", [0, 1.62, 0.07]);
  add("CC_Base_Tongue01", "CC_Base_JawRoot", [0, 1.62, 0.12]);
  for (const [side, sign] of [
    ["L", 1],
    ["R", -1],
  ] as const) {
    const name = (part: string) => `CC_Base_${side}_${part}`;
    add(name("Thigh"), "CC_Base_Pelvis", [sign * 0.1, 0.98, 0]);
    add(name("ThighTwist01"), name("Thigh"), [sign * 0.1, 0.78, 0]);
    add(name("Calf"), name("Thigh"), [sign * 0.1, 0.53, 0]);
    add(name("CalfTwist01"), name("Calf"), [sign * 0.1, 0.32, 0]);
    add(name("KneeShareBone"), name("Calf"), [sign * 0.1, 0.53, 0]);
    add(name("Foot"), name("Calf"), [sign * 0.1, 0.06, 0]);
    add(name("ToeBase"), name("Foot"), [sign * 0.1, 0.025, 0.15]);
    add(name("Clavicle"), "CC_Base_Spine02", [sign * 0.07, 1.5, 0]);
    add(name("Upperarm"), name("Clavicle"), [sign * 0.2, 1.5, 0]);
    add(name("UpperarmTwist01"), name("Upperarm"), [sign * 0.3, 1.44, 0]);
    add(name("Forearm"), name("Upperarm"), [sign * 0.43, 1.36, 0]);
    add(name("ForearmTwist01"), name("Forearm"), [sign * 0.54, 1.29, 0]);
    add(name("Hand"), name("Forearm"), [sign * 0.65, 1.22, 0]);
    for (const [index, finger] of [
      "Thumb",
      "Index",
      "Mid",
      "Ring",
      "Pinky",
    ].entries()) {
      for (const segment of [1, 2, 3]) {
        add(
          name(`${finger}${segment}`),
          segment === 1 ? name("Hand") : name(`${finger}${segment - 1}`),
          [
            sign * (0.68 + segment * 0.025),
            1.2 - segment * 0.015,
            (index - 2) * 0.018,
          ],
        );
      }
    }
    add(name("Eye"), "CC_Base_FacialBone", [sign * 0.035, 1.7, 0.08]);
  }
  // The outer root remains an ordinary identity frame for root-travel assertions.
  for (const [index, bone] of Object.values(joints).entries()) {
    if (bone === joints.root) continue;
    const frame = rotation(0.2 + roll + index * 0.017, -0.3, 0.4);
    bone.quaternion.multiply(frame);
    for (const child of bone.children) {
      child.position.applyQuaternion(frame.clone().invert());
      child.quaternion.premultiply(frame.clone().invert());
    }
  }
  const control = new T.Object3D();
  control.name = "IK_Target";
  imported.add(control);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute(
    "position",
    new T.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.morphAttributes.position = morphNames.map((name) => {
    const attribute = new T.Float32BufferAttribute(
      [0, 0, 0, 0, 0.1, 0, 0.1, 0, 0],
      3,
    );
    attribute.name = name;
    return attribute;
  });
  geometry.morphTargetsRelative = true;
  const face = new T.Mesh(geometry, new T.MeshBasicMaterial());
  face.name = prefix + "Face";
  face.morphTargetInfluences = morphNames.map((name) =>
    name === "Blink" ? 0.2 : name === "Frown" ? 0.15 : 0.05,
  );
  imported.add(face);
  group.updateWorldMatrix(true, true);
  const bind = Object.fromEntries(
    Object.entries(joints).map(([name, bone]) => [
      name,
      {
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        world: orientation(bone),
      },
    ]),
  );
  const skeleton = new T.Skeleton(Object.values(joints));
  const inverses = skeleton.boneInverses.map((matrix) =>
    matrix.elements.slice(),
  );
  const configure = (clips: T.AnimationClip[] = [], mapping?: RigMapping) =>
    configureImportedRig(group, imported, clips, imported, mapping);
  const scene = starterScene();
  const actor = scene.entities[0];
  scene.entities = [actor];
  actor.position = [0, 0, 0];
  actor.rotation = 0;
  actor.scale = 1;
  actor.clips = [];
  actor.ending = "rest";
  const sample = (time: number) => {
    applyAnimatedEntityPose(group, actor, scene, time);
    group.updateWorldMatrix(true, true);
  };
  return {
    group,
    joints,
    face,
    bind,
    skeleton,
    inverses,
    configure,
    scene,
    actor,
    sample,
  };
}
type Fixture = ReturnType<typeof fixture>;

const detailedNames = [
  "CC_Base_Waist",
  "CC_Base_Spine01",
  "CC_Base_Spine02",
  "CC_Base_NeckTwist02",
  "CC_Base_L_Hand",
  "CC_Base_R_Hand",
  "CC_Base_L_Index1",
  "CC_Base_L_Index2",
  "CC_Base_L_Index3",
  "CC_Base_R_Thumb1",
  "CC_Base_R_Mid2",
  "CC_Base_R_Pinky3",
  "CC_Base_L_Foot",
  "CC_Base_R_Foot",
  "CC_Base_L_ToeBase",
  "CC_Base_R_ToeBase",
  "CC_Base_L_UpperarmTwist01",
  "CC_Base_R_ForearmTwist01",
  "CC_Base_L_CalfTwist01",
  "CC_Base_R_KneeShareBone",
  "CC_Base_JawRoot",
  "CC_Base_Tongue01",
  "CC_Base_L_Eye",
];
function detailClip(f: Fixture) {
  return new T.AnimationClip(
    "Detailed take",
    duration,
    detailedNames.map((name, index) => {
      const bind = f.bind[name].quaternion;
      return new T.QuaternionKeyframeTrack(
        `${f.joints[name].name}.quaternion`,
        [0, duration / 2, duration],
        [
          ...bind.toArray(),
          ...bind
            .clone()
            .multiply(rotation(0.18 + index * 0.007, -0.1, 0.12))
            .toArray(),
          ...bind
            .clone()
            .multiply(rotation(-0.12, 0.15 + index * 0.006, 0.2))
            .toArray(),
        ],
      );
    }),
  );
}
function schedule(
  f: Fixture,
  source: Fixture,
  clips: T.AnimationClip[],
  shared: boolean,
) {
  const sourceAssetId = shared ? "detail-source" : f.actor.assetId;
  for (const [index, clip] of clips.entries()) {
    f.scene.customMotions.push({
      id: `detail-${index}`,
      name: clip.name,
      kind: "imported",
      duration: clip.duration,
      poses: [],
      distance: 0,
      sourceAssetId,
      animationName: clip.name,
    });
  }
  f.actor.clips = [
    {
      id: "take",
      motionId: "detail-0",
      duration: clips[0].duration,
      playbackRate: 1,
      transition: "cut",
    },
  ];
  if (shared)
    setMotionSources(f.group, new Map([[sourceAssetId, source.group]]));
}
function expectPoseEqual(
  actual: Fixture,
  expected: Fixture,
  localQuaternions = true,
) {
  for (const [name, bone] of Object.entries(actual.joints)) {
    if (name === "root") continue; // Travel is extracted onto the receiving group.
    expect(
      point(bone).distanceTo(point(expected.joints[name])),
      `${name} world position`,
    ).toBeLessThan(2e-6);
    if (localQuaternions)
      expect(
        bone.quaternion
          .clone()
          .normalize()
          .angleTo(expected.joints[name].quaternion.clone().normalize()),
        `${name} local quaternion`,
      ).toBeLessThan(2e-6);
  }
}
function snapshot(f: Fixture) {
  return Object.fromEntries(
    Object.entries(f.joints).map(([name, bone]) => [
      name,
      {
        position: point(bone),
        rotation: bone.quaternion.clone(),
      },
    ]),
  );
}
function expectSnapshot(f: Fixture, expected: ReturnType<typeof snapshot>) {
  for (const [name, bone] of Object.entries(f.joints)) {
    expect(point(bone).distanceTo(expected[name].position), name).toBeLessThan(
      1e-7,
    );
    expect(
      bone.quaternion
        .clone()
        .normalize()
        .angleTo(expected[name].rotation.clone().normalize()),
      name,
    ).toBeLessThan(1e-6);
  }
}

describe("detailed imported animation runtime", () => {
  it("preserves an additional upper chest without collapsing it into the lower chest", () => {
    const source = fixture(),
      native = fixture(),
      target = fixture();
    for (const [index, f] of [source, native, target].entries()) {
      const chest = f.joints.CC_Base_Spine02;
      const children = [...chest.children];
      const upper = new T.Bone();
      upper.name = index === 2 ? "ReceiverThorax" : "SourceThorax";
      upper.position.y = 0.05;
      chest.add(upper);
      f.group.updateWorldMatrix(true, true);
      for (const child of children) upper.attach(child);
      f.joints.UpperThorax = upper;
    }
    const q = rotation(0.4, -0.2, 0.3);
    const clip = new T.AnimationClip("Upper thorax", duration, [
      new T.QuaternionKeyframeTrack(
        "SourceThorax.quaternion",
        [0, duration],
        [0, 0, 0, 1, ...q.toArray()],
      ),
    ]);
    source.configure([clip]);
    native.configure([clip]);
    target.configure();
    schedule(native, native, [clip], false);
    schedule(target, source, [clip], true);
    for (const time of [0.4, 1.2, 2.1]) {
      native.sample(time);
      target.sample(time);
      expectPoseEqual(target, native);
      expect(target.group.userData.retargetReport.unsupported).toEqual([]);
      expect(
        target.joints.CC_Base_Spine02.quaternion.angleTo(
          target.bind.CC_Base_Spine02.quaternion,
        ),
      ).toBeLessThan(1e-6);
      expect(
        target.joints.UpperThorax.quaternion.angleTo(new T.Quaternion()),
      ).toBeGreaterThan(0.05);
    }
  });

  it.each(["combine", "disabled", "ambiguous"])(
    "handles a single receiving chest without overriding unavailable or ambiguous anatomy (%s)",
    (mode) => {
      const disabled = mode !== "combine";
      const source = fixture(),
        native = fixture(),
        target = fixture(0.7);
      const upperBind = new T.Quaternion();
      for (const f of [source, native]) {
        const chest = f.joints.CC_Base_Spine02;
        const children = [...chest.children];
        const upper = new T.Bone();
        upper.name = "SourceThorax";
        upper.position.y = 0.05;
        chest.add(upper);
        f.group.updateWorldMatrix(true, true);
        for (const child of children) upper.attach(child);
        f.joints.UpperThorax = upper;
        upperBind.copy(orientation(upper));
      }
      const lowerBind = source.bind.CC_Base_Spine02.quaternion;
      const clip = new T.AnimationClip("Complete chest bend", duration, [
        new T.QuaternionKeyframeTrack(
          "CC_Base_Spine02.quaternion",
          [0, duration],
          [
            ...lowerBind.toArray(),
            ...lowerBind
              .clone()
              .multiply(rotation(-0.15, 0.1, 0.2))
              .toArray(),
          ],
        ),
        new T.QuaternionKeyframeTrack(
          "SourceThorax.quaternion",
          [0, duration],
          [0, 0, 0, 1, ...rotation(0.4, -0.2, 0.3).toArray()],
        ),
      ]);
      source.configure([clip]);
      native.configure([clip]);
      if (mode === "ambiguous") {
        for (let i = 0; i < 2; i++) {
          const helper = new T.Bone();
          helper.name = "UpperChest";
          target.joints.CC_Base_Spine02.add(helper);
        }
      }
      target.configure(
        [],
        mode === "disabled" ? { upperChest: null } : undefined,
      );
      schedule(native, native, [clip], false);
      schedule(target, source, [clip], true);
      for (const time of [0.4, 1.2, 2.1, 0.4]) {
        native.sample(time);
        target.sample(time);
        const expected = orientation(
          disabled ? native.joints.CC_Base_Spine02 : native.joints.UpperThorax,
        )
          .multiply(upperBind.clone().invert())
          .multiply(target.bind.CC_Base_Spine02.world);
        expect(
          orientation(target.joints.CC_Base_Spine02).angleTo(expected),
        ).toBeLessThan(1e-6);
      }
      const report = retargetReport(source.group, target.group, clip)!;
      expect(report.composed).toEqual(
        disabled
          ? []
          : [
              {
                channel: "CC_Base_Spine02.quaternion",
                target: "CC_Base_Spine02",
              },
            ],
      );
      expect(report.unsupported.map((entry) => entry.channel)).toEqual(
        disabled ? ["SourceThorax.quaternion"] : [],
      );
    },
  );

  it("preserves chest and shoulder motion between unrelated names using anatomical hierarchy", () => {
    const source = fixture(),
      native = fixture(),
      target = fixture();
    const names = [
      "CC_Base_Spine02",
      "CC_Base_L_Clavicle",
      "CC_Base_R_Clavicle",
    ];
    for (const [index, name] of names.entries()) {
      source.joints[name].name = native.joints[name].name =
        `OpaqueSource${index}`;
      target.joints[name].name = `UnrelatedReceiver${index}`;
    }
    const clip = new T.AnimationClip(
      "Chest and shrugs",
      duration,
      names.map(
        (name, index) =>
          new T.QuaternionKeyframeTrack(
            source.joints[name].name + ".quaternion",
            [0, duration],
            [
              ...source.bind[name].quaternion.toArray(),
              ...source.bind[name].quaternion
                .clone()
                .multiply(rotation(0.25 + index * 0.1, 0.2, -0.15))
                .toArray(),
            ],
          ),
      ),
    );
    source.configure([clip]);
    native.configure([clip]);
    target.configure();
    schedule(native, native, [clip], false);
    schedule(target, source, [clip], true);
    for (const time of [0.2, 0.8, 2.1]) {
      native.sample(time);
      target.sample(time);
      expectPoseEqual(target, native);
      expect(target.group.userData.retargetReport.unsupported).toEqual([]);
    }
    expect(
      retargetReport(source.group, target.group, clip)?.transferred,
    ).toEqual(clip.tracks.map((t) => t.name));
  });

  it("respects disabled chest mapping rather than re-enabling it through topology", () => {
    const source = fixture(),
      target = fixture();
    const name = "CC_Base_Spine02";
    source.joints[name].name = "UnknownThorax";
    target.joints[name].name = "AnotherThorax";
    const clip = new T.AnimationClip("Chest", duration, [
      new T.QuaternionKeyframeTrack(
        source.joints[name].name + ".quaternion",
        [0, duration],
        [
          ...source.bind[name].quaternion.toArray(),
          ...source.bind[name].quaternion
            .clone()
            .multiply(rotation(0.5, 0.1, 0.2))
            .toArray(),
        ],
      ),
    ]);
    source.configure([clip]);
    target.configure([], { chest: null });
    schedule(target, source, [clip], true);
    target.sample(1);
    expect(
      retargetReport(source.group, target.group, clip)?.unsupported.map(
        (c) => c.channel,
      ),
    ).toContain("UnknownThorax.quaternion");
    expect(
      target.joints[name].quaternion.angleTo(target.bind[name].quaternion),
    ).toBeLessThan(1e-6);
  });

  it("leaves an unfamiliar multi-bone shoulder branch ambiguous", () => {
    const source = fixture(),
      target = fixture();
    const shoulder = source.joints.CC_Base_L_Clavicle;
    shoulder.name = "OpaqueShoulderA";
    const helper = new T.Bone();
    helper.name = "OpaqueShoulderB";
    shoulder.parent!.add(helper);
    helper.add(shoulder);
    const clip = new T.AnimationClip("Ambiguous shrug", duration, [
      new T.QuaternionKeyframeTrack(
        shoulder.name + ".quaternion",
        [0, duration],
        [
          ...shoulder.quaternion.toArray(),
          ...shoulder.quaternion
            .clone()
            .multiply(rotation(0.3, 0, 0.2))
            .toArray(),
        ],
      ),
    ]);
    source.configure([clip]);
    target.configure();
    expect(
      retargetReport(source.group, target.group, clip)?.unsupported.map(
        (c) => c.channel,
      ),
    ).toContain("OpaqueShoulderA.quaternion");
  });

  it("preserves finger, wrist, foot, toe, twist, spine and facial rotations at the original duration", () => {
    const source = fixture(),
      native = fixture(),
      target = fixture();
    const clip = detailClip(source);
    source.configure([clip]);
    native.configure([clip]);
    target.configure();
    schedule(native, native, [clip], false);
    schedule(target, source, [clip], true);
    for (const time of [0, 0.3, duration / 2, duration - 1e-6]) {
      native.sample(time);
      target.sample(time);
      expect(target.group.userData.motionWarning).toBe("");
      expect(target.group.userData.motionNotice).toBe("");
      expectPoseEqual(target, native);
      if (time === duration / 2)
        for (const name of detailedNames)
          expect(
            target.joints[name].quaternion.angleTo(
              target.bind[name].quaternion,
            ),
            `${name} must actually animate`,
          ).toBeGreaterThan(0.1);
    }
    expect(
      retargetReport(source.group, target.group, clip)?.transferred,
    ).toEqual(clip.tracks.map((track) => track.name));
    expect(
      target.skeleton.boneInverses.map((matrix) => matrix.elements),
    ).toEqual(target.inverses);
  });

  it("compensates different bone axes through the entire hierarchy and rescrubs deterministically", () => {
    const source = fixture(),
      native = fixture(),
      target = fixture(-0.75, "Receiver:");
    const clip = detailClip(source);
    clip.tracks.push(
      new T.VectorKeyframeTrack(
        "root.position",
        [0, duration],
        [0, 0, 0, 0, 0, 1.8],
      ),
    );
    source.configure([clip]);
    native.configure([clip]);
    target.configure();
    schedule(native, native, [clip], false);
    schedule(target, source, [clip], true);
    native.sample(1.2);
    target.sample(1.2);
    expectPoseEqual(target, native, false);
    for (const name of detailedNames) {
      const expected = orientation(native.joints[name])
        .multiply(native.bind[name].world.clone().invert())
        .multiply(target.bind[name].world);
      expect(
        orientation(target.joints[name]).angleTo(expected),
        name,
      ).toBeLessThan(2e-6);
    }
    const first = snapshot(target);
    for (const time of [2.1, 0, 1.8, 0.4, 1.2]) target.sample(time);
    expectSnapshot(target, first);
    expect(target.group.userData.motionWarning).toBe("");
  });

  it.each([
    ["position", false],
    ["quaternion", false],
    ["position", true],
    ["quaternion", true],
  ] as const)(
    "folds helper %s into the target attachment without doubling a matching helper (matched=%s)",
    (property, matchingHelper) => {
      const source = fixture(0, "", undefined, true),
        native = fixture(0, "", undefined, true),
        target = fixture(0, "", undefined, matchingHelper);
      const helper = source.joints.TorsoAttachmentHelper;
      const bind = source.bind.TorsoAttachmentHelper[property];
      const changed =
        property === "position"
          ? helper.position.clone().add(new T.Vector3(0.06, 0.08, -0.04))
          : helper.quaternion.clone().multiply(rotation(0.5, -0.3, 0.4));
      const Track =
        property === "position"
          ? T.VectorKeyframeTrack
          : T.QuaternionKeyframeTrack;
      const clip = new T.AnimationClip("Torso helper", duration, [
        new Track(
          `${helper.name}.${property}`,
          [0, duration / 2, duration],
          [...bind.toArray(), ...changed.toArray(), ...bind.toArray()],
        ),
      ]);
      source.configure([clip]);
      native.configure([clip]);
      target.configure();
      schedule(native, native, [clip], false);
      schedule(target, source, [clip], true);
      expect(transferWarning(source.group, target.group, clip)).toBe("");
      target.sample(0);
      const restWaist = point(target.joints.CC_Base_Waist);
      for (const time of [0, 0.3, duration / 2, duration - 1e-6]) {
        native.sample(time);
        target.sample(time);
        // Adding the helper changes the source's bind axes, but not joint
        // positions. Compare world orientations with those bind axes removed.
        expectPoseEqual(target, native, matchingHelper);
        for (const [name, bone] of Object.entries(target.joints)) {
          if (name === "root") continue;
          const expected = orientation(native.joints[name])
            .multiply(native.bind[name].world.clone().invert())
            .multiply(target.bind[name].world);
          expect(orientation(bone).angleTo(expected), name).toBeLessThan(2e-6);
        }
        expect(target.group.userData.motionWarning).toBe("");
        if (time === duration / 2)
          expect(
            point(target.joints.CC_Base_Waist).distanceTo(restWaist),
          ).toBeGreaterThan(0.01);
      }
      target.sample(duration / 2);
      const first = snapshot(target);
      for (const time of [2.1, 0, 0.4, duration / 2]) target.sample(time);
      expectSnapshot(target, first);
      expect(
        target.skeleton.boneInverses.map((matrix) => matrix.elements),
      ).toEqual(target.inverses);
    },
  );

  it.each([1, 2])(
    "reports constant non-bind detail channels with %i key(s), while leaving bind-default constants unchanged",
    (keyCount) => {
      const source = fixture(),
        target = fixture();
      target.joints.CC_Base_Tongue01.name = "DifferentTongue";
      target.joints.CC_Base_JawRoot.name = "DifferentJaw";
      const times = keyCount === 1 ? [0] : [0, duration];
      const repeated = (values: number[]) => times.flatMap(() => values);
      const tongue = source.bind.CC_Base_Tongue01.quaternion
        .clone()
        .multiply(rotation(0.5, 0, 0));
      const clip = new T.AnimationClip("Constant detail channels", duration, [
        new T.VectorKeyframeTrack(
          "CC_Base_L_Index1.scale",
          times,
          repeated([1.2, 1.2, 1.2]),
        ),
        new T.QuaternionKeyframeTrack(
          "CC_Base_Tongue01.quaternion",
          times,
          repeated(tongue.toArray()),
        ),
        new T.VectorKeyframeTrack(
          "CC_Base_L_Index2.scale",
          times,
          repeated([1, 1, 1]),
        ),
        new T.VectorKeyframeTrack(
          "CC_Base_Tongue01.position",
          times,
          repeated(source.bind.CC_Base_Tongue01.position.toArray()),
        ),
        new T.QuaternionKeyframeTrack(
          "CC_Base_JawRoot.quaternion",
          times,
          repeated(source.bind.CC_Base_JawRoot.quaternion.toArray()),
        ),
        new T.VectorKeyframeTrack(
          "IK_Target.position",
          times,
          repeated([0, 0, 0]),
        ),
        new T.VectorKeyframeTrack(
          "IK_Target.scale",
          times,
          repeated([1, 1, 1]),
        ),
      ]);
      source.configure([clip]);
      target.configure();
      schedule(target, source, [clip], true);
      expect(transferWarning(source.group, target.group, clip)).toBe("");
      target.sample(duration / 2);
      const report = retargetReport(source.group, target.group, clip)!;
      expect(report.unsupported.map(({ channel }) => channel)).toEqual([
        "CC_Base_L_Index1.scale",
        "CC_Base_Tongue01.quaternion",
      ]);
      expect(report.unsupported.every(({ reason }) => reason.length > 0)).toBe(
        true,
      );
      expect(report.transferred).toEqual([]);
      expect(report.unchanged).toEqual(
        clip.tracks.slice(2).map(({ name }) => name),
      );
      expect(target.group.userData.retargetReport).toBe(report);
      expect(target.group.userData.motionWarning).toBe("");
      expect(target.group.userData.motionNotice).toContain(
        "2 animation channels",
      );
      expect(target.joints.CC_Base_L_Index1.scale.toArray()).toEqual([1, 1, 1]);
      expect(
        target.joints.CC_Base_Tongue01.quaternion.angleTo(
          target.bind.CC_Base_Tongue01.quaternion,
        ),
      ).toBeLessThan(1e-6);
    },
  );

  it("reports missing animated details on an eleven-joint procedural target without flagging bind-default finger channels", () => {
    const source = fixture(),
      target = createCharacter(characters[0]);
    const missing = [
      "CC_Base_L_Index1",
      "CC_Base_L_Hand",
      "CC_Base_L_ToeBase",
      "CC_Base_L_UpperarmTwist01",
      "CC_Base_Tongue01",
    ];
    const clip = new T.AnimationClip("Detailed procedural transfer", duration, [
      ...["CC_Base_R_Forearm", ...missing].map((name) => {
        const bind = source.bind[name].quaternion;
        return new T.QuaternionKeyframeTrack(
          `${name}.quaternion`,
          [0, duration],
          [
            ...bind.toArray(),
            ...bind
              .clone()
              .multiply(rotation(0.5, -0.2, 0.3))
              .toArray(),
          ],
        );
      }),
      new T.NumberKeyframeTrack(
        "Face.morphTargetInfluences[Smile]",
        [0, duration],
        [0.05, 0.85],
      ),
    ]);
    const bindOnly = new T.AnimationClip("Bind-default finger", duration, [
      new T.QuaternionKeyframeTrack(
        "CC_Base_L_Index2.quaternion",
        [0, duration],
        [
          ...source.bind.CC_Base_L_Index2.quaternion.toArray(),
          ...source.bind.CC_Base_L_Index2.quaternion.toArray(),
        ],
      ),
    ]);
    clip.tracks.push(bindOnly.tracks[0].clone());
    source.configure([clip, bindOnly]);
    schedule(source, source, [clip, bindOnly], true);
    source.actor.clips.push({
      id: "bind-only",
      motionId: "detail-1",
      duration,
      playbackRate: 1,
      transition: "cut",
    });
    setMotionSources(target, new Map([["detail-source", source.group]]));
    expect(Object.keys(target.userData.bones)).toHaveLength(11);
    const sample = (time: number) =>
      applyAnimatedEntityPose(target, source.actor, source.scene, time);
    sample(0);
    const restForearm = (
      target.userData.bones.rightForearm as T.Bone
    ).quaternion.clone();
    sample(duration / 2);
    expect(
      (target.userData.bones.rightForearm as T.Bone).quaternion.angleTo(
        restForearm,
      ),
    ).toBeGreaterThan(0.1);
    const report = retargetReport(source.group, target, clip)!;
    expect(report.matchedJoints).toBe(11);
    expect(report.transferred).toEqual(["CC_Base_R_Forearm.quaternion"]);
    expect(report.unchanged).toEqual(["CC_Base_L_Index2.quaternion"]);
    expect(report.unsupported.map(({ channel }) => channel)).toEqual([
      ...missing.map((name) => `${name}.quaternion`),
      "Face.morphTargetInfluences[Smile][Smile]",
    ]);
    expect(target.userData.retargetReport).toBe(report);
    expect(target.userData.motionWarning).toBe("");
    expect(target.userData.motionNotice).toContain("6 animation channels");
    expect(target.userData.motionNotice).toContain(
      "CC_Base_L_Index1.quaternion",
    );
    expect(target.userData.motionNotice).toContain("original rig");
    sample(duration + 0.5);
    expect(target.userData.retargetReport).toBe(
      retargetReport(source.group, target, bindOnly),
    );
    expect(target.userData.retargetReport.unsupported).toEqual([]);
    expect(target.userData.motionNotice).toBe("");
    sample(duration / 2);
    expect(target.userData.retargetReport).toBe(report);
    expect(target.userData.motionNotice).toContain("6 animation channels");
  });

  it("reports unsupported animated controls, unmatched joints and detail scale without claiming transfer", () => {
    const source = fixture(),
      target = fixture();
    target.joints.CC_Base_Tongue01.name = "DifferentTongue";
    const clip = new T.AnimationClip("Unsupported channels", duration, [
      new T.VectorKeyframeTrack(
        "IK_Target.position",
        [0, duration],
        [0, 0, 0, 1, 0, 0],
      ),
      new T.VectorKeyframeTrack(
        "IK_Target.scale",
        [0, duration],
        [1, 1, 1, 1, 1, 1],
      ),
      new T.QuaternionKeyframeTrack(
        "CC_Base_Tongue01.quaternion",
        [0, duration],
        [
          ...source.bind.CC_Base_Tongue01.quaternion.toArray(),
          ...source.bind.CC_Base_Tongue01.quaternion
            .clone()
            .multiply(rotation(0.5, 0, 0))
            .toArray(),
        ],
      ),
      new T.VectorKeyframeTrack(
        "CC_Base_L_Index1.scale",
        [0, duration],
        [1, 1, 1, 1.2, 1.2, 1.2],
      ),
    ]);
    source.configure([clip]);
    target.configure();
    schedule(target, source, [clip], true);
    target.sample(1);
    const report = retargetReport(source.group, target.group, clip)!;
    expect(report.unsupported.map(({ channel }) => channel).sort()).toEqual([
      "CC_Base_L_Index1.scale",
      "CC_Base_Tongue01.quaternion",
      "IK_Target.position",
    ]);
    expect(report.transferred).not.toContain("CC_Base_L_Index1.scale");
    expect(report.unsupported.every(({ reason }) => reason.length > 0)).toBe(
      true,
    );
    expect(target.group.userData.retargetReport).toBe(report);
    expect(target.group.userData.motionNotice).toContain(
      "3 animation channels",
    );
    expect(target.group.userData.motionNotice).toContain("original rig");
    expect(target.joints.CC_Base_L_Index1.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("maps named morphs across reordered dictionaries and resets weights on clip switches and backwards scrubs", () => {
    const source = fixture(),
      target = fixture(0, "Receiver:", ["Frown", "Smile", "Blink"]);
    const clip = new T.AnimationClip("Face performance", duration, [
      new T.NumberKeyframeTrack(
        "Face.morphTargetInfluences[Smile]",
        [0, duration],
        [0.05, 0.85],
      ),
      new T.NumberKeyframeTrack(
        "Face.morphTargetInfluences[Blink]",
        [0, duration],
        [0.2, 0.8],
      ),
    ]);
    const bodyOnly = detailClip(source);
    source.configure([clip, bodyOnly]);
    target.configure();
    schedule(target, source, [clip, bodyOnly], true);
    target.actor.clips.push(
      {
        id: "body",
        motionId: "detail-1",
        duration,
        playbackRate: 1,
        transition: "cut",
      },
      { id: "idle", motionId: "idle", duration: 2, transition: "cut" },
    );
    const weight = (f: Fixture, name: string) =>
      f.face.morphTargetInfluences![f.face.morphTargetDictionary![name]];
    target.sample(duration / 2);
    expect(weight(target, "Smile")).toBeCloseTo(0.45, 6);
    expect(weight(target, "Blink")).toBeCloseTo(0.5, 6);
    expect(weight(target, "Frown")).toBeCloseTo(0.15, 6);
    expect(
      retargetReport(source.group, target.group, clip)?.unsupported,
    ).toEqual([]);
    target.sample(duration + 0.5);
    for (const f of [source, target]) {
      expect(weight(f, "Smile")).toBeCloseTo(0.05, 6);
      expect(weight(f, "Blink")).toBeCloseTo(0.2, 6);
    }
    target.sample(0.6);
    expect(weight(target, "Smile")).toBeCloseTo(0.25, 6);
    target.sample(duration * 2 + 0.5);
    expect(weight(target, "Smile")).toBeCloseTo(0.05, 6);
    expect(weight(target, "Blink")).toBeCloseTo(0.2, 6);
    target.sample(duration / 2);
    expect(weight(target, "Smile")).toBeCloseTo(0.45, 6);
    expect(weight(target, "Blink")).toBeCloseTo(0.5, 6);
  });

  it("reports an animated morph that has no named target instead of copying by index", () => {
    const source = fixture(),
      target = fixture(0, "", ["OtherExpression"]);
    const clip = new T.AnimationClip("Unmatched face", duration, [
      new T.NumberKeyframeTrack(
        "Face.morphTargetInfluences[Smile]",
        [0, duration],
        [0.05, 0.85],
      ),
    ]);
    source.configure([clip]);
    target.configure();
    schedule(target, source, [clip], true);
    target.sample(1.2);
    expect(target.face.morphTargetInfluences).toEqual([0.05]);
    expect(
      retargetReport(source.group, target.group, clip)?.unsupported,
    ).toEqual([
      {
        channel: "Face.morphTargetInfluences[Smile][Smile]",
        reason: "No unambiguous named target morph",
      },
    ]);
  });

  it.each(["length", "scale"] as const)(
    "warns and refuses unsupported animated %s on an anatomical chain",
    (kind) => {
      const source = fixture(),
        target = fixture();
      const bone = source.joints.CC_Base_L_Calf;
      const start =
        kind === "length" ? bone.position.clone() : new T.Vector3(1, 1, 1);
      const end = start.clone().multiplyScalar(1.2);
      const clip = new T.AnimationClip(`Changed ${kind}`, duration, [
        new T.VectorKeyframeTrack(
          `${bone.name}.${kind === "length" ? "position" : "scale"}`,
          [0, duration],
          [...start.toArray(), ...end.toArray()],
        ),
      ]);
      source.configure([clip]);
      target.configure();
      schedule(target, source, [clip], true);
      expect(transferWarning(source.group, target.group, clip)).toContain(
        "bone lengths or scale",
      );
      target.sample(1.2);
      expect(target.group.userData.motionWarning).toContain(
        "original character",
      );
      expect(
        target.joints.CC_Base_L_Calf.position.distanceTo(
          target.bind.CC_Base_L_Calf.position,
        ),
      ).toBeLessThan(1e-8);
      expect(target.joints.CC_Base_L_Calf.scale.toArray()).toEqual([1, 1, 1]);
      expect(target.group.userData.retargetReport).toBeUndefined();
    },
  );
});

describe("explicit 1x imported timing in the runtime", () => {
  it.each([
    ["native", false, "trim", 0.8],
    ["shared", true, "trim", 0.8],
    ["native", false, "hold", 3.6],
    ["shared", true, "hold", 3.6],
  ] as const)(
    "%s (shared=%s), %s: carries only the consumed travel and turn into the next clip",
    (_label, shared, _mode, slot) => {
      const source = fixture(),
        target = shared ? fixture() : source;
      const clip = detailClip(source);
      clip.tracks.push(
        new T.VectorKeyframeTrack(
          "root.position",
          [0, duration],
          [0, 0, 0, 0, 0, duration],
        ),
        new T.QuaternionKeyframeTrack(
          "root.quaternion",
          [0, duration],
          [0, 0, 0, 1, ...rotation(0, 0.6 * duration, 0).toArray()],
        ),
      );
      source.configure([clip]);
      if (shared) target.configure();
      schedule(target, source, [clip], shared);
      target.actor.position = [1, 0, -2];
      target.actor.rotation = 0.3;
      target.actor.scale = 1.25;
      const scheduled: Entity["clips"][number] = {
        id: "first",
        motionId: "detail-0",
        duration: slot,
        playbackRate: 1,
        transition: "cut",
      };
      target.actor.clips = [
        scheduled,
        { ...scheduled, id: "next", duration: 2 },
      ];
      // Warm the complete-take root cache first: a trimmed slot must not reuse it.
      expect(nativeRootMotion(source.group, clip)!.delta.z).toBeCloseTo(
        duration,
        6,
      );
      const consumed = Math.min(duration, slot);
      const expected = (first: number, second = 0) =>
        new T.Vector3(...target.actor.position)
          .add(
            new T.Vector3(0, 1, first)
              .multiplyScalar(target.actor.scale)
              .applyAxisAngle(new T.Vector3(0, 1, 0), target.actor.rotation),
          )
          .add(
            new T.Vector3(0, 0, second)
              .multiplyScalar(target.actor.scale)
              .applyAxisAngle(
                new T.Vector3(0, 1, 0),
                target.actor.rotation + 0.6 * first,
              ),
          );
      target.sample(0.4);
      expect(
        point(target.joints.CC_Base_Hip).distanceTo(expected(0.4)),
      ).toBeLessThan(2e-6);
      target.sample(slot - 1e-6);
      const before = point(target.joints.CC_Base_Hip);
      expect(before.distanceTo(expected(consumed))).toBeLessThan(3e-6);
      if (slot > duration) {
        const held = snapshot(target);
        target.sample(duration + 0.1);
        expectSnapshot(target, held);
      }
      target.sample(slot);
      expect(point(target.joints.CC_Base_Hip).distanceTo(before)).toBeLessThan(
        3e-6,
      );
      target.sample(slot + 0.5);
      expect(
        point(target.joints.CC_Base_Hip).distanceTo(expected(consumed, 0.5)),
      ).toBeLessThan(3e-6);
      const expectedHip = rotation(
        0,
        target.actor.rotation + 0.6 * (consumed + 0.5),
        0,
      ).multiply(target.bind.CC_Base_Hip.world);
      expect(
        orientation(target.joints.CC_Base_Hip).angleTo(expectedHip),
      ).toBeLessThan(2e-6);
      const continued = snapshot(target);
      for (const time of [0, slot - 0.1, 0.2, slot + 0.5]) target.sample(time);
      expectSnapshot(target, continued);
      expect(target.group.userData.motionWarning).toBe("");
    },
  );
});

it.each([false, true])(
  "rebases source-start travel and facing while preserving detailed poses (shared=%s)",
  (shared) => {
    const source = fixture(),
      target = shared ? fixture() : source,
      reference = fixture();
    const take = detailClip(source);
    take.tracks.push(
      new T.VectorKeyframeTrack(
        "root.position",
        [0, duration],
        [0, 0, 0, 0, 0, duration],
      ),
      new T.QuaternionKeyframeTrack(
        "root.quaternion",
        [0, duration],
        [0, 0, 0, 1, ...rotation(0, 0.6 * duration, 0).toArray()],
      ),
    );
    source.configure([take]);
    reference.configure([take]);
    if (shared) target.configure();
    schedule(target, source, [take], shared);
    schedule(reference, reference, [take], false);
    target.actor.position = [1, 0, -2];
    target.actor.rotation = 0.3;
    target.actor.scale = 1.25;
    const sourceStart = 0.6,
      slot = 0.8;
    const scheduled = {
      id: "range",
      motionId: "detail-0",
      duration: slot,
      playbackRate: 1,
      sourceStart,
      transition: "cut" as const,
    };
    target.actor.clips = [scheduled, { ...scheduled, id: "next" }];
    nativeRootMotion(source.group, take); // Warm full-take cache before the range.
    const rotationAtStart = rotation(
      0,
      target.actor.rotation - 0.6 * sourceStart,
      0,
    );
    for (const time of [0, 0.2, 0.7, 0.1, 0.7]) {
      reference.sample(sourceStart + time);
      target.sample(time);
      const expected = new T.Vector3(0, 1, time)
        .multiplyScalar(target.actor.scale)
        .applyQuaternion(rotationAtStart)
        .add(new T.Vector3(...target.actor.position));
      expect(
        point(target.joints.CC_Base_Hip).distanceTo(expected),
      ).toBeLessThan(3e-6);
      for (const name of detailedNames) {
        const expectedRotation = rotationAtStart
          .clone()
          .multiply(orientation(reference.joints[name]));
        expect(
          orientation(target.joints[name]).angleTo(expectedRotation),
          name,
        ).toBeLessThan(3e-6);
      }
    }
    target.sample(slot - 1e-7);
    const before = point(target.joints.CC_Base_Hip);
    target.sample(slot);
    expect(point(target.joints.CC_Base_Hip).distanceTo(before)).toBeLessThan(
      3e-6,
    );
    const secondTime = 0.25;
    target.sample(slot + secondTime);
    const expected = new T.Vector3(0, 1, slot)
      .multiplyScalar(target.actor.scale)
      .applyQuaternion(rotationAtStart)
      .add(new T.Vector3(...target.actor.position));
    expected.add(
      new T.Vector3(0, 0, secondTime)
        .multiplyScalar(target.actor.scale)
        .applyQuaternion(
          rotation(
            0,
            target.actor.rotation + 0.6 * slot - 0.6 * sourceStart,
            0,
          ),
        ),
    );
    expect(point(target.joints.CC_Base_Hip).distanceTo(expected)).toBeLessThan(
      3e-6,
    );
  },
);
