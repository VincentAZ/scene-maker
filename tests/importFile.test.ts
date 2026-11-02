import { expect, it, vi } from "vitest";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { characters, type Asset } from "../shared/scene";
import { prepareImportedAsset } from "../src/importedAsset";
import { applyTransferredClip } from "../src/rig";
import { bvhArmature, bvhToGlb, importableFile } from "../src/importFile";

/** A small CMU-style capture in centimetres: hips travel forward (+Z) and
 * the left arm lifts from the T-pose bind. */
function capture(rename: (name: string) => string = (n) => n, travel = 40) {
  const joint = (
    name: string,
    offset: number[],
    children: string,
    depth: number,
  ) => {
    const pad = "  ".repeat(depth);
    return `${pad}JOINT ${rename(name)}\n${pad}{\n${pad}  OFFSET ${offset.join(" ")}\n${pad}  CHANNELS 3 Zrotation Xrotation Yrotation\n${children}${pad}}\n`;
  };
  const end = (offset: number[], depth: number) => {
    const pad = "  ".repeat(depth);
    return `${pad}End Site\n${pad}{\n${pad}  OFFSET ${offset.join(" ")}\n${pad}}\n`;
  };
  const arm = (side: "Left" | "Right", s: number) =>
    joint(
      `${side}Shoulder`,
      [s * 4, 18, 0],
      joint(
        `${side}Arm`,
        [s * 12, 0, 0],
        joint(
          `${side}ForeArm`,
          [s * 28, 0, 0],
          joint(`${side}Hand`, [s * 25, 0, 0], end([s * 8, 0, 0], 6), 5),
          4,
        ),
        3,
      ),
      2,
    );
  const leg = (side: "Left" | "Right", s: number) =>
    joint(
      `${side}UpLeg`,
      [s * 9, -5, 0],
      joint(
        `${side}Leg`,
        [0, -42, 0],
        joint(`${side}Foot`, [0, -42, 0], end([0, -8, 12], 4), 3),
        2,
      ),
      1,
    );
  const torso = joint(
    "Spine",
    [0, 10, 0],
    joint(
      "Spine1",
      [0, 15, 0],
      joint(
        "Neck",
        [0, 22, 0],
        joint("Head", [0, 10, 0], end([0, 18, 0], 4), 3),
        2,
      ) +
        arm("Left", 1) +
        arm("Right", -1),
      1,
    ),
    1,
  );
  const hierarchy = `HIERARCHY\nROOT ${rename("Hips")}\n{\n  OFFSET 0 0 0\n  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation\n${torso}${leg("Left", 1)}${leg("Right", -1)}}\n`;
  // Channel order follows the hierarchy: Hips, Spine, Spine1, Neck, Head,
  // LeftShoulder, LeftArm, LeftForeArm, LeftHand, Right…, LeftUpLeg…
  const joints = 1 + 4 + 4 + 4 + 3 + 3;
  const frames = [0, 1, 2, 3].map((f) => {
    const values = [0, 100, (travel * f) / 3, 0, 0, 0];
    for (let j = 1; j < joints; j++) values.push(0, 0, 0);
    // LeftArm is joint 6 (Hips=0): lift it about Z by up to 60 degrees.
    values[6 + (6 - 1) * 3] = 20 * f;
    return values.join(" ");
  });
  return `${hierarchy}MOTION\nFrames: 4\nFrame Time: 0.25\n${frames.join("\n")}\n`;
}

const asset = (id: string) =>
  ({ ...characters[0], id, url: "/x.glb" }) as Asset;

it("imports a BVH capture as a recognised animated armature", () => {
  const { scene, clip } = bvhArmature(capture(), "walk.bvh");
  // Only the travelling root keeps a position track.
  expect(
    clip.tracks.filter((t) => t.name.endsWith(".position")).map((t) => t.name),
  ).toEqual(["Hips.position"]);
  let ends = 0;
  scene.traverse((n) => {
    if (n.name.endsWith("_End")) ends++;
  });
  expect(ends).toBe(5);
  const group = prepareImportedAsset(asset("bvh"), {
    scene,
    animations: [clip],
  });
  expect(group.userData.rigMappingReport.missing).toEqual([]);
  const bones = group.userData.bones as Record<string, T.Bone>;
  expect(bones.leftArm.name).toBe("LeftArm");
  const mixer = group.userData.mixer as T.AnimationMixer;
  mixer.clipAction(clip).play();
  mixer.setTime(0.5);
  expect(bones.hips.position.z).toBeCloseTo(26.667, 2);
  expect(bones.leftArm.quaternion.angleTo(new T.Quaternion())).toBeCloseTo(
    (40 * Math.PI) / 180,
    5,
  );
});

it("keeps a capture that never leaves its spot at its captured height", () => {
  const { scene, clip } = bvhArmature(capture(undefined, 0), "idle");
  expect(clip.tracks.some((t) => t.name.endsWith(".position"))).toBe(false);
  const hips = scene.getObjectByName("Hips")!;
  expect(hips.position.toArray()).toEqual([0, 100, 0]);
});

it("writes a self-contained GLB that loads back with its take", async () => {
  // Node has Blob but not FileReader; read the exporter's real payload.
  vi.stubGlobal(
    "FileReader",
    class {
      result: ArrayBuffer | null = null;
      onloadend?: () => void;
      readAsArrayBuffer(blob: Blob) {
        void blob.arrayBuffer().then((buffer) => {
          this.result = buffer;
          this.onloadend?.();
        });
      }
    },
  );
  try {
    const file = await bvhToGlb(capture(), "Jog 02.bvh");
    expect(file.name).toBe("Jog 02.glb");
    const gltf = await new GLTFLoader().parseAsync(
      await file.arrayBuffer(),
      "",
    );
    expect(gltf.animations.map((a) => a.name)).toEqual(["Jog 02"]);
    const group = prepareImportedAsset(asset("bvh-glb"), gltf);
    expect(group.userData.rigMappingReport.missing).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("drives a skeleton of another naming convention from a BVH take", () => {
  const source = bvhArmature(capture(), "walk");
  const vrm: Record<string, string> = {
    Hips: "J_Bip_C_Hips",
    Spine: "J_Bip_C_Spine",
    Spine1: "J_Bip_C_Chest",
    Neck: "J_Bip_C_Neck",
    Head: "J_Bip_C_Head",
  };
  const target = bvhArmature(
    capture((name) => {
      const side = name.match(/^(Left|Right)(.+)$/);
      const part: Record<string, string> = {
        Shoulder: "Shoulder",
        Arm: "UpperArm",
        ForeArm: "LowerArm",
        Hand: "Hand",
        UpLeg: "UpperLeg",
        Leg: "LowerLeg",
        Foot: "Foot",
      };
      return side
        ? `J_Bip_${side[1][0]}_${part[side[2]]}`
        : (vrm[name] ?? name);
    }),
    "rest",
  );
  const s = prepareImportedAsset(asset("bvh-source"), {
    scene: source.scene,
    animations: [source.clip],
  });
  const t = prepareImportedAsset(asset("bvh-target"), {
    scene: target.scene,
    animations: [],
  });
  expect(t.userData.rigMappingReport.missing).toEqual([]);
  const direction = (group: T.Group) => {
    const bones = group.userData.bones as Record<string, T.Bone>;
    group.updateMatrixWorld(true);
    return bones.leftForearm
      .getWorldPosition(new T.Vector3())
      .sub(bones.leftArm.getWorldPosition(new T.Vector3()))
      .normalize();
  };
  for (const time of [0, 0.5, 0.75]) {
    expect(applyTransferredClip(s, t, source.clip, time)).toBe("");
    const mixer = s.userData.mixer as T.AnimationMixer;
    mixer.stopAllAction();
    mixer.clipAction(source.clip).play();
    mixer.setTime(time);
    expect(direction(t).angleTo(direction(s))).toBeLessThan(1e-3);
  }
});

it("uploads a VRM character unchanged as its binary glTF", async () => {
  const bytes = new Uint8Array([
    0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0,
  ]);
  const vrm = new File([bytes], "Avatar.vrm");
  const file = await importableFile(vrm);
  expect(file.name).toBe("Avatar.glb");
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  const glb = new File([bytes], "Prop.glb");
  expect(await importableFile(glb)).toBe(glb);
});
