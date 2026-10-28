import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  type Asset,
  type Scene,
  type Entity,
  boneNames,
  allMotions,
} from "../shared/scene";
import { entityPose } from "../shared/animation";
const material = (color: string) =>
  new T.MeshStandardMaterial({ color, roughness: 0.85 });
export function box(
  w: number,
  h: number,
  d: number,
  color: string,
  x = 0,
  y = 0,
  z = 0,
) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), material(color));
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function sphere(
  r: number,
  color: string,
  x = 0,
  y = 0,
  z = 0,
  sx = 1,
  sy = 1,
  sz = 1,
) {
  const m = new T.Mesh(new T.SphereGeometry(r, 16, 12), material(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}
function cylinder(
  top: number,
  bottom: number,
  h: number,
  color: string,
  x = 0,
  y = 0,
  z = 0,
) {
  const m = new T.Mesh(
    new T.CylinderGeometry(top, bottom, h, 24),
    material(color),
  );
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
export function createCharacter(a: Asset, color = a.color) {
  const group = new T.Group();
  const bones: Record<string, T.Bone> = {};
  const specifications: [string, string | null, number, number, number][] = [
    ["hips", null, 0, 0.9, 0],
    ["spine", "hips", 0, 0.18, 0],
    ["head", "spine", 0, 0.53, 0],
    ["leftArm", "spine", 0.25, 0.3, 0],
    ["leftForearm", "leftArm", 0, -0.29, 0],
    ["rightArm", "spine", -0.25, 0.3, 0],
    ["rightForearm", "rightArm", 0, -0.29, 0],
    ["leftLeg", "hips", 0.13, -0.04, 0],
    ["leftShin", "leftLeg", 0, -0.4, 0],
    ["rightLeg", "hips", -0.13, -0.04, 0],
    ["rightShin", "rightLeg", 0, -0.4, 0],
  ];
  for (const [name, parent, x, y, z] of specifications) {
    const b = new T.Bone();
    b.name = name;
    b.position.set(x, y, z);
    bones[name] = b;
    if (parent) bones[parent].add(b);
    else group.add(b);
  }
  group.updateMatrixWorld(true);
  const geometries: T.BufferGeometry[] = [],
    materials: T.Material[] = [];
  const skin = a.body === "mannequin" ? color : a.skin;
  const pants =
    a.style === "Doctor" || a.style === "Chef" ? "#c3c9c5" : "#46534f";
  const part = (
    bone: string,
    geometry: T.BufferGeometry,
    c: string,
    pos: [number, number, number],
    scale: [number, number, number] = [1, 1, 1],
  ) => {
    geometry.scale(...scale);
    const world = new T.Vector3();
    bones[bone].getWorldPosition(world);
    geometry.translate(world.x + pos[0], world.y + pos[1], world.z + pos[2]);
    const count = geometry.attributes.position.count;
    const indices = new Uint16Array(count * 4),
      weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      indices[i * 4] = boneNames.indexOf(bone as (typeof boneNames)[number]);
      weights[i * 4] = 1;
    }
    geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute(
      "skinWeight",
      new T.Float32BufferAttribute(weights, 4),
    );
    geometries.push(geometry);
    materials.push(material(c));
  };
  const ball = (
    b: string,
    c: string,
    p: [number, number, number],
    s: [number, number, number],
  ) => part(b, new T.SphereGeometry(1, 16, 12), c, p, s);
  ball("hips", pants, [0, 0, 0], [0.22, 0.16, 0.14]);
  ball(
    "spine",
    color,
    [0, 0.15, 0],
    [a.body === "feminine" ? 0.23 : 0.26, 0.31, 0.15],
  );
  ball("head", skin, [0, 0.04, 0], [0.17, 0.22, 0.16]);
  if (a.body !== "mannequin") {
    ball(
      "head",
      a.body === "feminine" ? "#4a342c" : "#3b302c",
      [0, 0.16, -0.035],
      [0.176, 0.14, 0.15],
    );
    if (a.body === "feminine")
      ball("head", "#4a342c", [0, 0, -0.12], [0.18, 0.23, 0.08]);
    ball("head", "#343735", [-0.065, 0.05, 0.145], [0.015, 0.02, 0.012]);
    ball("head", "#343735", [0.065, 0.05, 0.145], [0.015, 0.02, 0.012]);
    ball("head", skin, [0, 0.005, 0.16], [0.035, 0.04, 0.04]);
  }
  for (const side of ["left", "right"]) {
    ball(side + "Arm", color, [0, -0.13, 0], [0.09, 0.2, 0.09]);
    ball(side + "Forearm", skin, [0, -0.13, 0], [0.065, 0.17, 0.065]);
    ball(side + "Forearm", skin, [0, -0.3, 0], [0.065, 0.075, 0.05]);
    ball(side + "Leg", pants, [0, -0.18, 0], [0.095, 0.25, 0.1]);
    ball(side + "Shin", pants, [0, -0.17, 0], [0.075, 0.23, 0.08]);
    ball(side + "Shin", "#353c39", [0, -0.35, 0.06], [0.09, 0.065, 0.15]);
  }
  if (["Barista", "Chef"].includes(a.style))
    part(
      "spine",
      new T.BoxGeometry(0.32, 0.5, 0.025),
      "#e4d8b8",
      [0, 0.03, 0.155],
    );
  if (["Doctor", "Scientist"].includes(a.style)) {
    part(
      "spine",
      new T.BoxGeometry(0.07, 0.34, 0.025),
      "#faf7e9",
      [-0.1, 0.13, 0.15],
    );
    part(
      "spine",
      new T.BoxGeometry(0.07, 0.34, 0.025),
      "#faf7e9",
      [0.1, 0.13, 0.15],
    );
  }
  if (["Builder", "Firefighter", "Astronaut", "Chef"].includes(a.style))
    ball(
      "head",
      a.style === "Chef" ? "#f6f1e4" : color,
      [0, 0.21, 0],
      [0.21, 0.13, 0.19],
    );
  const mesh = new T.SkinnedMesh(mergeGeometries(geometries, true), materials);
  mesh.name = "body";
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  group.updateMatrixWorld(true);
  mesh.bind(new T.Skeleton(boneNames.map((n) => bones[n])));
  group.userData.bones = bones;
  group.userData.rest = Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [
      name,
      bone.quaternion.clone(),
    ]),
  );
  return group;
}
export function createProp(
  style: string,
  color: string,
  parts?: Asset["parts"],
) {
  const g = new T.Group();
  const add = (m: T.Object3D) => g.add(m);
  if (parts?.length) {
    for (const part of parts) {
      const geometry =
        part.shape === "box"
          ? new T.BoxGeometry(1, 1, 1)
          : part.shape === "cylinder"
            ? new T.CylinderGeometry(0.5, 0.5, 1, 24)
            : part.shape === "cone"
              ? new T.ConeGeometry(0.5, 1, 24)
              : part.shape === "torus"
                ? new T.TorusGeometry(0.4, 0.1, 12, 24)
                : new T.SphereGeometry(0.5, 24, 16);
      const mesh = new T.Mesh(geometry, material(part.color));
      mesh.position.set(...part.position);
      mesh.scale.set(...part.scale);
      mesh.rotation.set(...part.rotation);
      mesh.castShadow = mesh.receiveShadow = true;
      add(mesh);
    }
    return g;
  }
  if (style === "cup") {
    add(cylinder(0.085, 0.065, 0.15, color, 0, 0.075));
    add(cylinder(0.073, 0.073, 0.005, "#59402d", 0, 0.152));
    const handle = new T.Mesh(
      new T.TorusGeometry(0.052, 0.016, 8, 16),
      material(color),
    );
    handle.position.set(0.09, 0.08, 0);
    add(handle);
  } else if (style === "table") {
    add(cylinder(0.68, 0.68, 0.09, color, 0, 0.94));
    add(cylinder(0.075, 0.1, 0.85, "#484d43", 0, 0.46));
    add(cylinder(0.35, 0.36, 0.055, "#484d43", 0, 0.04));
  } else if (style === "plant") {
    add(cylinder(0.26, 0.18, 0.42, "#c58d70", 0, 0.21));
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.4;
      const x = Math.sin(angle) * 0.35,
        z = Math.cos(angle) * 0.35;
      const stem = cylinder(0.018, 0.018, 0.8, "#627754", x / 2, 0.7, z / 2);
      stem.rotation.z = -x * 0.7;
      add(stem);
      const leaf = sphere(0.25, color, x, 1 + i * 0.035, z, 1, 0.25, 1.6);
      leaf.rotation.z = x;
      add(leaf);
    }
  } else if (style === "lamp") {
    add(cylinder(0.25, 0.27, 0.05, "#4b5148", 0, 0.03));
    add(cylinder(0.025, 0.025, 1.65, color, 0, 0.85));
    add(cylinder(0.18, 0.4, 0.4, color, 0, 1.7));
  } else if (style === "ladder") {
    for (const x of [-0.3, 0.3]) add(box(0.08, 2.5, 0.08, color, x, 1.25));
    for (let i = 0; i < 7; i++)
      add(box(0.6, 0.065, 0.065, color, 0, 0.2 + i * 0.35));
  } else if (style === "chair" || style === "bench") {
    const w = style === "bench" ? 1.8 : 0.5;
    add(box(w, 0.08, 0.48, color, 0, 0.5));
    add(box(w, 0.4, 0.06, color, 0, 0.85, -0.23));
    for (const x of [-w / 2 + 0.07, w / 2 - 0.07])
      for (const z of [-0.18, 0.18])
        add(box(0.05, 0.5, 0.05, "#525e51", x, 0.25, z));
  } else if (style === "sofa") {
    add(box(2.1, 0.45, 0.8, color, 0, 0.4));
    add(box(2.1, 0.5, 0.18, color, 0, 0.84, -0.36));
    for (const x of [-1, 1]) add(box(0.18, 0.4, 0.8, color, x, 0.65));
  } else if (style === "book") {
    add(box(0.25, 0.035, 0.35, color, 0, 0.02));
    add(box(0.235, 0.02, 0.33, "#e9e4d5", 0.005, 0.02));
  } else if (style === "camera") {
    add(box(0.28, 0.2, 0.12, color, 0, 0.15));
    const lens = cylinder(0.065, 0.065, 0.1, "#1c282b", 0, 0.15, 0.1);
    lens.rotation.x = Math.PI / 2;
    add(lens);
  } else if (style === "desk") {
    add(box(1.8, 0.08, 0.8, color, 0, 0.95));
    for (const x of [-0.8, 0.8])
      for (const z of [-0.3, 0.3])
        add(box(0.07, 0.9, 0.07, "#4f5b53", x, 0.45, z));
  } else {
    add(box(0.7, 0.7, 0.7, color, 0, 0.35));
    for (const y of [0.1, 0.6]) add(box(0.74, 0.065, 0.74, "#866947", 0, y));
  }
  return g;
}
export function createEnvironment(kind: Scene["environment"]) {
  const g = new T.Group();
  const floor =
    kind === "park" ? "#8e9c72" : kind === "studio" ? "#ddd9d1" : "#c3b39b";
  g.add(box(12, 0.18, 10, floor, 0, -0.13, 0));
  if (kind === "studio") return g;
  if (kind === "park") {
    for (const [x, z] of [
      [-4, -3],
      [3, -3],
      [-4, 2],
      [4, 2],
    ]) {
      g.add(cylinder(0.13, 0.22, 2.4, "#8e7152", x, 1.2, z));
      g.add(sphere(1.2, "#718568", x, 2.5, z, 1, 1.3, 1));
    }
    return g;
  }
  g.add(
    box(
      12,
      3.7,
      0.16,
      kind === "warehouse" ? "#99968c" : "#d9cfba",
      0,
      1.7,
      -3.8,
    ),
  );
  g.add(box(0.16, 3.7, 8, "#d1c7b2", -5, 1.7, 0.1));
  if (kind === "cafe" || kind === "office") {
    for (const x of [-3, -0.8, 1.4, 3.6]) {
      g.add(box(1.75, 2.2, 0.05, "#a7b7af", x, 1.9, -3.68));
      for (const dx of [-0.89, 0.89])
        g.add(box(0.07, 2.3, 0.12, "#665e4c", x + dx, 1.9, -3.6));
      g.add(box(1.8, 0.07, 0.12, "#665e4c", x, 1.8, -3.6));
    }
    g.add(box(3, 0.95, 0.8, "#7d8c72", -3.4, 0.475, -2.7));
    g.add(box(3.1, 0.08, 0.9, "#a47e56", -3.4, 0.99, -2.7));
    for (let i = 0; i < 6; i++)
      g.add(box(0.025, 0.8, 0.02, "#a8b598", -4.65 + i * 0.45, 0.48, -2.29));
    const table = createProp("table", "#a08059");
    table.position.set(3, 0, -2);
    g.add(table);
    for (const x of [2.2, 3.8]) {
      const chair = createProp("chair", "#7d8f76");
      chair.position.set(x, 0, -2);
      chair.rotation.y = x < 3 ? Math.PI / 2 : -Math.PI / 2;
      g.add(chair);
    }
    for (const x of [-3, 0, 3]) {
      g.add(cylinder(0.012, 0.012, 1, "#625b49", x, 3.3, -1.5));
      g.add(cylinder(0.13, 0.36, 0.3, "#c4a36a", x, 2.7, -1.5));
    }
  }
  if (kind === "warehouse") {
    for (const x of [-4, 4]) {
      g.add(box(0.15, 3.5, 0.15, "#676f6a", x, 1.75, -2));
      for (const y of [0.3, 1.3, 2.3])
        g.add(box(1.4, 0.1, 1, "#777c72", x, y, -2));
    }
    for (let i = 0; i < 5; i++) {
      const c = createProp("crate", "#b79b77");
      c.position.set(-3 + i * 1.4, 0, -2.8);
      g.add(c);
    }
  }
  if (kind === "street") {
    g.add(box(12, 0.07, 3, "#8a8c83", 0, -0.01, 2));
    for (let i = 0; i < 8; i++)
      g.add(box(0.6, 0.01, 0.05, "#e1d6b2", -5 + i * 1.5, 0.03, 2));
  }
  return g;
}
export function applyEntityPose(
  group: T.Group,
  e: Entity,
  scene: Scene,
  time: number,
) {
  const pose = entityPose(e, scene, time);
  group.position.set(...pose.root);
  group.rotation.set(0, e.rotation, 0);
  group.scale.setScalar(e.scale);
  group.visible = e.visible;
  const bones = group.userData.bones as Record<string, T.Bone> | undefined;
  if (bones)
    for (const [name, rot] of Object.entries(pose.rotations)) {
      const bone = bones[name];
      if (!bone) continue;
      const rest = group.userData.rest?.[name] as T.Quaternion | undefined;
      if (rest)
        bone.quaternion
          .copy(rest)
          .multiply(new T.Quaternion().setFromEuler(new T.Euler(...rot)));
      else bone.rotation.set(...rot);
    }
}
// Use one sampler for preview, interaction contact checks and export. Stopping a
// native clip first restores its animated translations as well as rotations.
export function applyAnimatedEntityPose(
  group: T.Group,
  entity: Entity,
  scene: Scene,
  time: number,
) {
  const mixer = group.userData.mixer as T.AnimationMixer | undefined;
  mixer?.stopAllAction();
  applyEntityPose(group, entity, scene, time);
  if (!mixer) return;
  let start = 0;
  for (const clip of entity.clips) {
    if (time >= start && time < start + clip.duration) {
      const motion = allMotions(scene).find((m) => m.id === clip.motionId);
      if (
        motion?.kind === "imported" &&
        motion.sourceAssetId === entity.assetId
      ) {
        const native = T.AnimationClip.findByName(
          group.userData.animations,
          motion.animationName || "",
        );
        if (native) {
          mixer.clipAction(native).reset().play();
          mixer.setTime(((time - start) * native.duration) / clip.duration);
        }
      }
      return;
    }
    start += clip.duration;
  }
}
export function disposeObject(root: T.Object3D) {
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
        m.dispose(),
      );
    }
  });
}
