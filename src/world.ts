import { routeActiveDuration, routeStopTime } from "../shared/clipTiming";
import * as T from "three";
import { applyRouteFootPlanting } from "./routeFootPlanting";
import { closeRouteLoopPose } from "./routeLoopPose";
import { capturedRouteHeading } from "./routeTrajectoryHeading";
import { capturedRouteContactOffset } from "./routeContactWarp";
import { supportRouteFootContacts } from "./routeContacts";
import {
  sampleFootSurfaces,
  supportRouteGround,
  transferFootClearance,
} from "./footSurface";
import { samplePath, sourcePathProgress } from "../shared/path";
import {
  locomotionProfile,
  routeLocomotionProfile,
  sampleRouteLocomotion,
  routeSourceDuration,
  routeEntryHeading,
  locomotionScale,
  type LocomotionProfile,
} from "./locomotion";
import {
  sourceSecondsAt,
  clipSourceStart,
  clipSourceEnd,
} from "../shared/clipTiming";
import {
  applyHumanoidPose,
  standingHeight,
  nativeRootMotion,
  motionSource,
  transferredRootMotion,
  applyTransferredClip,
  sampleNativeClip,
  humanoidWarning,
  rigHeading,
  importedClip,
} from "./rig";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  type Asset,
  type Scene,
  type Motion,
  type Entity,
  boneNames,
  allMotions,
} from "../shared/scene";
import { entityPose, type Pose } from "../shared/animation";
import { defaultLadder, type Point } from "../shared/ladder";
import { measureSeatBody, applySeatSupport } from "./seating";
import { sampleWithTransitions } from "./transitions";
import { transitionAt } from "../shared/transitions";
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
  group.userData.bindPositions = Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [name, bone.position.clone()]),
  );
  group.userData.bindScales = Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [name, bone.scale.clone()]),
  );
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
  ladder?: Asset["ladder"],
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
  if (ladder) style = "ladder";
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
  } else if (style === "ladder" || ladder) {
    const profile = ladder || defaultLadder;
    for (const x of [-profile.width / 2, profile.width / 2])
      add(box(0.08, profile.height, 0.08, color, x, profile.height / 2));
    for (let i = 0; i < profile.rungs; i++)
      add(
        box(
          profile.width,
          0.065,
          0.065,
          color,
          0,
          profile.firstRung + i * profile.spacing,
        ),
      );
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
  native = false,
  evaluated?: Pose,
) {
  const pose = evaluated || entityPose(e, scene, time);
  group.position.set(...pose.root);
  group.rotation.set(0, pose.heading ?? e.rotation, 0);
  group.scale.setScalar(e.scale);
  group.visible = e.visible;
  group.userData.climb = pose.climb;
  group.userData.seat = pose.seat;
  group.userData.motionWarning =
    e.visible &&
    e.clips.some(
      (clip) =>
        allMotions(scene).find((m) => m.id === clip.motionId)?.kind !==
        "imported",
    )
      ? humanoidWarning(group, e.name, native)
      : "";
  if (applyHumanoidPose(group, pose.rotations, native)) return;
  const bones = group.userData.bones as Record<string, T.Bone> | undefined;
  if (bones)
    for (const [name, rot] of Object.entries(pose.rotations)) {
      const bone = bones[name];
      if (!bone) continue;
      const position = group.userData.bindPositions?.[name] as
        T.Vector3 | undefined;
      const scale = group.userData.bindScales?.[name] as T.Vector3 | undefined;
      if (position) bone.position.copy(position);
      if (scale) bone.scale.copy(scale);
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
  let floor: T.Vector3 | undefined;
  sampleWithTransitions(group, entity, scene, time, (sampleTime) => {
    floor = undefined;
    applyUnblendedEntityPose(
      group,
      entity,
      scene,
      sampleTime,
      true,
      true,
      (position) => {
        floor = position;
      },
    );
  });
  // Blended ankle rotations and contact corrections can lower the shoe below
  // two individually supported source poses. Recheck the final deformed sole.
  if (floor && !group.userData.motionWarning) supportRouteGround(group, floor);
  applySeatSupport(group, entity);
}
const routeEndHeadings = new WeakMap<
  T.Group,
  {
    scene: Scene;
    entity: Entity;
    entries: Map<
      string,
      {
        path: Motion["path"];
        end: number;
        base: number;
        heading: number;
        offset: Point;
      }
    >;
  }[]
>();

const resolvingRouteEnds = new Set<string>();
/** Resolve the actual outgoing body frame once per saved scene/actor/route.
 * Sampling just inside the route includes captured sideways/backward facing
 * and accepted loop closure. Earlier routes reuse this same cache recursively;
 * the current route is still active, so it never depends on its own result. */
function completedRouteHeading(
  group: T.Group,
  entity: Entity,
  scene: Scene,
  motion: Motion,
  clip: Entity["clips"][number],
  base: number,
) {
  if (motion.kind !== "imported" || !motion.path) return;
  const recent = routeEndHeadings.get(group) ?? [];
  let cache = recent.find(
    (entry) => entry.scene === scene && entry.entity === entity,
  );
  if (!cache) {
    cache = { scene, entity, entries: new Map() };
    // Renders and planning sweeps alternate scene objects for one body.
    routeEndHeadings.set(group, [cache, ...recent].slice(0, 4));
  }
  const index = entity.clips.indexOf(clip),
    end = entity.clips
      .slice(0, index + 1)
      .reduce((sum, item) => sum + item.duration, 0);
  const known = cache.entries.get(clip.id);
  if (
    known &&
    known.path === motion.path &&
    known.end === end &&
    known.base === base
  )
    return known;
  // Foot planting looks a little past the sampled end pose while this frame
  // is being resolved. Those lookahead samples must not ask for the frame
  // they are part of resolving.
  const resolving = `${group.uuid}:${clip.id}`;
  if (resolvingRouteEnds.has(resolving)) return;
  resolvingRouteEnds.add(resolving);
  const saved: {
    node: T.Object3D;
    position: T.Vector3;
    rotation: T.Quaternion;
    scale: T.Vector3;
    weights?: number[];
  }[] = [];
  group.traverse((node) =>
    saved.push({
      node,
      position: node.position.clone(),
      rotation: node.quaternion.clone(),
      scale: node.scale.clone(),
      weights:
        node instanceof T.Mesh
          ? node.morphTargetInfluences?.slice()
          : undefined,
    }),
  );
  const keys = [
    "motionNotice",
    "motionWarning",
    "retargetReport",
    "routeFootCorrection",
    "routeContactSupport",
    "footClearance",
    "routeGroundSupport",
  ];
  const metadata = keys.map((key) => group.userData[key]);
  const mixer = group.userData.mixer as T.AnimationMixer | undefined,
    previousTime = mixer?.time;
  try {
    const evaluated = applyUnblendedEntityPose(
      group,
      entity,
      scene,
      end - 1e-7,
    );
    if (group.userData.motionWarning) return;
    const actual = rigHeading(group);
    if (actual === undefined) return;
    // Where the body actually stands relative to its route root: a route
    // stopped mid-stride keeps the hip offset of that phase, and whatever
    // follows must start from the standing body, not from the route guide.
    const offset: Point = evaluated
      ? group.position.clone().sub(evaluated.root).toArray()
      : [0, 0, 0];
    const expected =
      base +
      samplePath(
        motion.path,
        clip.routeStop === undefined
          ? 1
          : Math.min(1, clip.routeStop / routeActiveDuration(clip)),
      ).heading;
    const heading =
      actual +
      Math.round((expected - actual) / (2 * Math.PI)) * 2 * Math.PI -
      base;
    const entry = { path: motion.path, end, base, heading, offset };
    cache.entries.set(clip.id, entry);
    return entry;
  } finally {
    resolvingRouteEnds.delete(resolving);
    mixer?.stopAllAction();
    if (mixer && previousTime !== undefined) mixer.time = previousTime;
    for (const { node, position, rotation, scale, weights } of saved) {
      node.position.copy(position);
      node.quaternion.copy(rotation);
      node.scale.copy(scale);
      if (weights && node instanceof T.Mesh)
        node.morphTargetInfluences!.splice(0, weights.length, ...weights);
    }
    keys.forEach((key, i) => {
      group.userData[key] = metadata[i];
    });
    group.updateMatrixWorld(true);
  }
}

function applyUnblendedEntityPose(
  group: T.Group,
  entity: Entity,
  scene: Scene,
  time: number,
  plantFeet = true,
  closeLoop = true,
  ground?: (floor: T.Vector3) => void,
):
  | {
      root: T.Vector3;
      heading: number;
      routeTime: number;
      routeCenter: T.Vector3;
      clearance: ReturnType<typeof sampleFootSurfaces>;
    }
  | undefined {
  // Freeze the same evaluated route endpoint through an authored hold. Clamp
  // before contacts/loop closure too, so their clocks cannot continue moving.
  time = routeStopTime(entity.clips, time);
  let holdStart = 0;
  for (const scheduled of entity.clips) {
    if (time < holdStart + scheduled.duration) {
      if (
        scheduled.routeHold &&
        time >= holdStart + routeActiveDuration(scheduled)
      )
        time = holdStart + routeActiveDuration(scheduled) - 1e-7;
      break;
    }
    holdStart += scheduled.duration;
  }
  const mixer = group.userData.mixer as T.AnimationMixer | undefined;
  mixer?.stopAllAction();
  group.userData.motionNotice = "";
  group.userData.retargetReport = undefined;
  group.userData.routeFootCorrection = undefined;
  group.userData.routeContactSupport = undefined;
  group.userData.footClearance = undefined;
  group.userData.routeGroundSupport = undefined;
  const bones = group.userData.bones as Record<string, T.Bone> | undefined;
  if (
    !group.userData.seatBody &&
    entity.clips.some(
      (c) =>
        allMotions(scene).find((m) => m.id === c.motionId)?.kind === "sit" &&
        c.targetId,
    )
  ) {
    applyEntityPose(group, entity, scene, 0, false, {
      root: [...entity.position],
      heading: entity.rotation,
      rotations: Object.fromEntries(boneNames.map((n) => [n, [0, 0, 0]])),
    });
    group.userData.seatBody = measureSeatBody(group);
  }
  let nativeStartY = 0;
  const pose = entityPose(entity, scene, time, {
    routeEndHeading: (motion, clip, base) =>
      completedRouteHeading(group, entity, scene, motion, clip, base)?.heading,
    routeEndOffset: (motion, clip, base) =>
      clip.routeStop === undefined
        ? undefined
        : completedRouteHeading(group, entity, scene, motion, clip, base)
            ?.offset,
    seatBody: group.userData.seatBody,
    canSit:
      !!group.userData.seatBody && !humanoidWarning(group, entity.name, false),
    canClimb:
      !!bones &&
      !humanoidWarning(group, entity.name, false) &&
      [
        "leftArm",
        "leftForearm",
        "rightArm",
        "rightForearm",
        "leftLeg",
        "leftShin",
        "rightLeg",
        "rightShin",
      ].every((name) => bones[name]),
    nativeRoot: (motion, scheduled) => {
      if (motion.sourceAssetId !== entity.assetId) {
        const source = motionSource(group, motion.sourceAssetId!);
        const clip =
          source &&
          importedClip(source.userData.animations, motion.animationName!);
        const root =
          source && clip
            ? transferredRootMotion(
                source,
                group,
                clip,
                clipSourceEnd(scheduled, clip.duration),
                clipSourceStart(scheduled, clip.duration),
              )
            : undefined;
        nativeStartY = root?.start[1] ?? 0;
        return root;
      }
      if (!mixer) return;
      const native = importedClip(
        group.userData.animations,
        motion.animationName || "",
      );
      const root =
        native &&
        nativeRootMotion(
          group,
          native,
          clipSourceEnd(scheduled, native.duration),
          clipSourceStart(scheduled, native.duration),
        );
      nativeStartY = root?.start.y ?? 0;
      return root
        ? {
            start: root.start
              .clone()
              .applyAxisAngle(new T.Vector3(0, 1, 0), -root.startHeading)
              .toArray(),
            delta: root.delta
              .clone()
              .applyAxisAngle(new T.Vector3(0, 1, 0), -root.startHeading)
              .toArray(),
            startHeading: root.startHeading,
            heading: root.heading,
          }
        : undefined;
    },
  });
  let start = 0;
  let current:
    | {
        clip: T.AnimationClip;
        time: number;
        sourceStart: number;
        stationary?: true;
        source?: T.Group;
        route?: {
          profile: LocomotionProfile;
          start: number;
          duration: number;
          sourceDuration: number;
          sample: ReturnType<typeof sampleRouteLocomotion>;
          ratio: number;
          heading: number;
        };
      }
    | undefined;
  let missing = false;
  for (const clip of entity.clips) {
    const motion = allMotions(scene).find((m) => m.id === clip.motionId);
    if (motion?.kind === "imported") {
      const source =
        motion.sourceAssetId === entity.assetId
          ? group
          : motionSource(group, motion.sourceAssetId!);
      const native = importedClip(
        source?.userData.animations || [],
        motion.animationName || "",
      );
      if (native) {
        if (time >= start && time < start + clip.duration) {
          current = {
            clip: native,
            time: sourceSecondsAt(clip, time - start, native.duration),
            sourceStart: clipSourceStart(clip, native.duration),
            stationary: clip.stationary,
            source: source === group ? undefined : source,
          };
          if (motion.path && source) {
            const measured = locomotionProfile(
              source,
              native,
              motion.path.sourceRange,
            );
            const ratio = source === group ? 1 : locomotionScale(source, group);
            const travelRatio = ratio * (motion.path.strideScale ?? 1);
            const profile =
              measured && ratio > 0
                ? routeLocomotionProfile(
                    measured,
                    samplePath(motion.path, 1).length / travelRatio,
                  )
                : measured;
            if (
              profile &&
              profile.distance >= 0.15 &&
              profile.distance / profile.duration >= 0.05 &&
              ratio > 0
            ) {
              const linearPath = samplePath(
                motion.path,
                (time - start) / routeActiveDuration(clip),
              );
              const sample = sampleRouteLocomotion(
                profile,
                linearPath.length / travelRatio,
                (time - start) / routeActiveDuration(clip),
              );
              const path = samplePath(
                motion.path,
                linearPath.length > 0
                  ? sourcePathProgress(
                      motion.path,
                      (sample.travelled * travelRatio) / linearPath.length,
                    )
                  : 0,
                routeEntryHeading(profile),
              );
              path.heading =
                capturedRouteHeading(
                  motion.path,
                  profile,
                  sample.time,
                  ratio,
                  standingHeight(source),
                  sample.heading,
                ) ?? path.heading;
              const baseHeading =
                (pose.heading ?? entity.rotation) - linearPath.heading;
              const contactOffset = capturedRouteContactOffset(
                motion.path,
                profile,
                sample.time,
                ratio,
                standingHeight(source),
              );
              const displacement = new T.Vector3(...path.point)
                .add(contactOffset ?? new T.Vector3())
                .sub(new T.Vector3(...linearPath.point))
                .multiplyScalar(entity.scale)
                .applyAxisAngle(new T.Vector3(0, 1, 0), baseHeading);
              pose.root = new T.Vector3(...pose.root)
                .add(displacement)
                .toArray();
              pose.heading = baseHeading + path.heading;
              current.time = sample.sourceTime;
              current.sourceStart = profile.sourceStart ?? 0;
              current.route = {
                profile,
                start,
                duration: routeActiveDuration(clip),
                sourceDuration: routeSourceDuration(
                  profile,
                  linearPath.length / travelRatio,
                ),
                sample,
                ratio,
                heading: pose.heading ?? entity.rotation,
              };
              pose.heading =
                current.route.heading -
                sample.heading +
                (source === group ? 0 : profile.startHeading);
            } else {
              missing = true;
              current = undefined;
            }
          }
        }
      } else if (time >= start && time < start + clip.duration) missing = true;
    }
    if (time < start + clip.duration) break;
    start += clip.duration;
  }
  applyEntityPose(
    group,
    entity,
    scene,
    time,
    !!current && !current.source,
    pose,
  );
  if (current?.source)
    group.userData.motionWarning = applyTransferredClip(
      current.source,
      group,
      current.clip,
      current.time,
      current.sourceStart,
    );
  else if (current) sampleNativeClip(group, current.clip, current.time);
  if (current?.route && !current.source)
    // Routes replace planar travel, but retain the same vertical reference as
    // native standalone playback. A capture's constant root offset is not a jump.
    group.position.y -=
      (current.route.profile.sourceOriginY ?? 0) * entity.scale;
  if (current?.route && !group.userData.motionWarning) {
    const { profile, sample, ratio, heading } = current.route;
    const original = current.source || group;
    original.updateWorldMatrix(true, true);
    const hip = original.worldToLocal(
      original.userData.bones.hips.getWorldPosition(new T.Vector3()),
    );
    const residual = hip.sub(sample.center);
    residual.y = 0;
    residual
      .applyAxisAngle(new T.Vector3(0, 1, 0), heading - sample.heading)
      .multiplyScalar(ratio * entity.scale);
    group.updateWorldMatrix(true, true);
    const actual = group.userData.bones.hips.getWorldPosition(new T.Vector3());
    group.position.x += pose.root[0] + residual.x - actual.x;
    group.position.z += pose.root[2] + residual.z - actual.z;
    if (profile.warning && sample.repeated)
      group.userData.motionNotice = [
        group.userData.motionNotice,
        profile.warning,
      ]
        .filter(Boolean)
        .join(" ");
  }
  const loopClearance =
    closeLoop && current?.route && !group.userData.motionWarning
      ? closeRouteLoopPose(
          group,
          entity,
          scene,
          time,
          current.route,
          { root: new T.Vector3(...pose.root), heading: current.route.heading },
          (sampleTime) =>
            applyUnblendedEntityPose(
              group,
              entity,
              scene,
              sampleTime,
              false,
              false,
            ),
        )
      : undefined;
  let routeClearance =
    current?.route && !group.userData.motionWarning
      ? sampleFootSurfaces(current.source || group)
      : undefined;
  if (current?.source && current.route && routeClearance) {
    const origin = current.route.profile.sourceOriginY ?? 0;
    const left = routeClearance.left + (loopClearance?.left ?? 0) - origin,
      right = routeClearance.right + (loopClearance?.right ?? 0) - origin;
    routeClearance = {
      ...routeClearance,
      left,
      right,
      lowest: Math.min(left, right),
    };
  } else if (current?.route && !current.source && routeClearance) {
    // Native loop closure can move the studio root vertically while retaining
    // the body's world pose. Surface samples are group-local: include that
    // offset so ground support does not undo the closure at the next cycle.
    const offset = group.position
      .clone()
      .sub(new T.Vector3(...pose.root))
      .applyQuaternion(group.quaternion.clone().invert())
      .divide(group.scale).y;
    routeClearance = {
      ...routeClearance,
      left: routeClearance.left + offset,
      right: routeClearance.right + offset,
      lowest: routeClearance.lowest + offset,
    };
  }
  if (plantFeet && current?.route && !group.userData.motionWarning)
    applyRouteFootPlanting(
      group,
      entity,
      scene,
      time,
      {
        ...current.route,
        root: new T.Vector3(...pose.root),
      },
      !!current.source,
      (sampleTime) =>
        applyUnblendedEntityPose(group, entity, scene, sampleTime, false),
    );
  // Terminal-shin rigs have no independently orientable ankle. Contact IK can
  // change their sole height, so restore source clearance after that correction.
  if (
    plantFeet &&
    current?.route &&
    current.source &&
    !group.userData.motionWarning
  )
    transferFootClearance(
      current.source,
      group,
      new T.Vector3(...pose.root),
      current.route.ratio,
      routeClearance,
    );
  if (plantFeet && current?.route && !group.userData.motionWarning) {
    supportRouteGround(
      group,
      new T.Vector3(...pose.root),
      routeClearance
        ? Math.max(
            0,
            routeClearance.lowest -
              routeClearance.bindFloor +
              current.route.sample.groundLift,
          ) * current.route.ratio
        : 0,
    );
    if (routeClearance) {
      supportRouteFootContacts(
        group,
        new T.Vector3(...pose.root),
        routeClearance,
        current.route.ratio,
        standingHeight(current.source || group),
      );
      supportRouteGround(group, new T.Vector3(...pose.root));
    }
  }
  if (missing)
    group.userData.motionWarning = `The original file or a measurable foot stride for ${entity.name}'s action is unavailable. Choose an imported walking/running cycle or reimport the source.`;
  if (
    ground &&
    (current?.stationary ||
      (current?.route && transitionAt(entity, scene, time, true)))
  ) {
    const floor = new T.Vector3(...pose.root);
    // Standalone imported playback subtracts its source's starting root
    // displacement. The floor stays at the incoming timeline origin.
    if (current.stationary) floor.y += nativeStartY * entity.scale;
    ground(floor);
  }
  return current?.route
    ? {
        root: new T.Vector3(...pose.root),
        heading: current.route.heading,
        routeTime: current.route.sample.time,
        routeCenter: current.route.sample.center,
        clearance: routeClearance,
      }
    : undefined;
}
// Frees GPU resources of every mesh under root. Material.dispose() does not
// release the textures a material references, so they are released here too;
// pass textures:false for clones that still share textures with a live object.
export function disposeObject(
  root: T.Object3D,
  options: { textures?: boolean } = {},
) {
  const textures = options.textures ?? true;
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (textures)
          for (const value of Object.values(m))
            if (value instanceof T.Texture) value.dispose();
        m.dispose();
      }
    }
  });
}
