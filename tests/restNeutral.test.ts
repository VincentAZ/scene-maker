import { describe, expect, it } from "vitest";
import * as T from "three";
import {
  captureArmRest,
  normalizeArmRest,
  normalizeFootRest,
} from "../src/restNeutral";

const point = (n: T.Object3D) => n.getWorldPosition(new T.Vector3());
function rotateWorld(bone: T.Object3D, q: T.Quaternion) {
  const world = bone.getWorldQuaternion(new T.Quaternion()).premultiply(q);
  bone.quaternion.copy(
    bone
      .parent!.getWorldQuaternion(new T.Quaternion())
      .invert()
      .multiply(world),
  );
  bone.updateWorldMatrix(true, true);
}
/** Left arm in a T-pose, palm down: +x out from the body, +z forward. Finger
 * bases spread across the palm (index forward, pinky back), thumb forward and
 * angled away. Optional bind variations: forearm roll, finger curl, local axes. */
function arm({ roll = 0, curl = 0, axes = false } = {}) {
  const root = new T.Group(),
    chest = new T.Bone();
  root.add(chest);
  const bone = (parent: T.Object3D, xyz: number[], name: string) => {
    const b = new T.Bone();
    b.name = name;
    b.position.fromArray(xyz);
    parent.add(b);
    return b;
  };
  const upper = bone(chest, [0.2, 1.4, 0], "a"),
    lower = bone(upper, [0.28, 0, 0], "b"),
    hand = bone(lower, [0.25, 0, 0], "c");
  const fingers = [0.03, 0.01, -0.01, -0.03].map((z, i) => {
    let parent = bone(hand, [0.09, 0, z], "f" + i + "0");
    const chain = [parent];
    for (let k = 1; k < 4; k++) {
      parent = bone(parent, [0.03, 0, 0], "f" + i + k);
      chain.push(parent);
    }
    return chain;
  });
  let t = bone(hand, [0.03, -0.01, 0.04], "t0");
  const thumb = [t];
  for (let k = 1; k < 4; k++) {
    t = bone(t, [0.02, 0, 0.02], "t" + k);
    thumb.push(t);
  }
  root.updateMatrixWorld(true);
  if (axes)
    root.traverse((b) => {
      if (!(b instanceof T.Bone) || b === chest) return;
      const q = new T.Quaternion().setFromEuler(new T.Euler(0.4, -0.7, 1.1));
      b.quaternion.multiply(q);
      for (const c of b.children) {
        c.position.applyQuaternion(q.clone().invert());
        c.quaternion.premultiply(q.clone().invert());
      }
    });
  root.updateMatrixWorld(true);
  const x = new T.Vector3(1, 0, 0);
  if (roll) rotateWorld(lower, new T.Quaternion().setFromAxisAngle(x, roll));
  if (curl)
    for (const chain of [...fingers, thumb])
      for (const b of chain.slice(0, -1)) {
        const axis = new T.Vector3()
          .crossVectors(
            point(b.children[0]).sub(point(b)),
            new T.Vector3(0, 1, 0),
          )
          .normalize();
        rotateWorld(b, new T.Quaternion().setFromAxisAngle(axis, curl));
      }
  return { root, upper, lower, hand, fingers, thumb };
}
const down = new T.Vector3(0, -1, 0),
  forward = new T.Vector3(0, 0, 1);
function neutral(a: ReturnType<typeof arm>) {
  const rest = captureArmRest(a.upper, a.lower, point(a.hand));
  const pointDown = (b: T.Bone, end: T.Vector3) =>
    rotateWorld(
      b,
      new T.Quaternion().setFromUnitVectors(
        end.sub(point(b)).normalize(),
        down,
      ),
    );
  pointDown(a.upper, point(a.lower));
  pointDown(a.lower, point(a.hand));
  normalizeArmRest(a.upper, a.lower, a.hand, rest, down, forward);
  const origin = point(a.hand);
  return [...a.fingers.flat(), ...a.thumb].map((b) => point(b).sub(origin));
}

describe("anatomical arm rest", () => {
  it("gives the same visible hand for differently authored binds", () => {
    const reference = neutral(arm());
    for (const variant of [
      { roll: 0.45 },
      { curl: 0.35 },
      { roll: -0.3, curl: 0.25, axes: true },
    ]) {
      const result = neutral(arm(variant));
      result.forEach((p, i) =>
        expect(p.distanceTo(reference[i])).toBeLessThan(1e-6),
      );
    }
  });
  it("turns the palm toward the body side and straightens the fingers", () => {
    const a = arm({ roll: 0.6, curl: 0.4 });
    neutral(a);
    // Index (first chain) is forward of the pinky (last chain).
    expect(point(a.fingers[0][0]).z).toBeGreaterThan(point(a.fingers[3][0]).z);
    for (const chain of a.fingers)
      for (let k = 0; k + 1 < chain.length; k++) {
        const segment = point(chain[k + 1])
          .sub(point(chain[k]))
          .normalize();
        expect(segment.dot(down)).toBeGreaterThan(1 - 1e-9);
      }
  });
  it("leaves hands without a recognisable palm untwisted", () => {
    const a = arm();
    // Only one finger chain: no palm line, no thumb.
    for (const chain of [...a.fingers.slice(1), a.thumb])
      chain[0].parent!.remove(chain[0]);
    a.root.updateMatrixWorld(true);
    const rest = captureArmRest(a.upper, a.lower, point(a.hand));
    // Point down as the importer does, then compare only the forearm's twist.
    rotateWorld(
      a.upper,
      new T.Quaternion().setFromUnitVectors(
        point(a.lower).sub(point(a.upper)).normalize(),
        down,
      ),
    );
    const pointed = a.lower.getWorldQuaternion(new T.Quaternion());
    normalizeArmRest(a.upper, a.lower, a.hand, rest, down, forward);
    expect(
      a.lower.getWorldQuaternion(new T.Quaternion()).angleTo(pointed),
    ).toBeLessThan(1e-9);
  });
});

/** A leg ending in a skinned foot box (sole from heel to toes) and a toe box. */
function leg(pitch = 0, toeBend = 0, capsule = false) {
  const group = new T.Group(),
    shin = new T.Bone(),
    foot = new T.Bone(),
    toe = new T.Bone();
  group.add(shin);
  shin.position.set(0, 0.5, 0);
  shin.add(foot);
  foot.position.set(0, -0.42, 0);
  foot.add(toe);
  toe.position.set(0, -0.06, 0.13);
  group.updateMatrixWorld(true);
  const skin = (bone: T.Bone, geometry: T.BufferGeometry) => {
    const count = geometry.attributes.position.count;
    geometry.setAttribute(
      "skinIndex",
      new T.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
    );
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = 1;
    geometry.setAttribute(
      "skinWeight",
      new T.Float32BufferAttribute(weights, 4),
    );
    const mesh = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
    group.add(mesh);
    group.updateMatrixWorld(true);
    mesh.bind(new T.Skeleton([bone]));
  };
  if (capsule) {
    // Visualization capsule along the ankle-to-toe bone: no sole below it.
    const from = point(foot),
      to = point(toe),
      direction = to.clone().sub(from);
    skin(
      foot,
      new T.CylinderGeometry(0.012, 0.012, direction.length(), 8, 8)
        .applyQuaternion(
          new T.Quaternion().setFromUnitVectors(
            new T.Vector3(0, 1, 0),
            direction.clone().normalize(),
          ),
        )
        .translate(...from.add(to).multiplyScalar(0.5).toArray()),
    );
  } else {
    skin(
      foot,
      new T.BoxGeometry(0.09, 0.06, 0.2, 3, 3, 8).translate(0, 0.05, 0.03),
    );
    skin(
      toe,
      new T.BoxGeometry(0.08, 0.03, 0.07, 3, 2, 4).translate(0, 0.015, 0.165),
    );
  }
  const across = new T.Vector3(1, 0, 0);
  if (pitch)
    rotateWorld(foot, new T.Quaternion().setFromAxisAngle(across, pitch));
  if (toeBend)
    rotateWorld(toe, new T.Quaternion().setFromAxisAngle(across, toeBend));
  // Re-bind in that pose, as an exporter with this bind would.
  group.updateMatrixWorld(true);
  group.traverse((m) => {
    if (!(m instanceof T.SkinnedMesh)) return;
    const p = m.geometry.attributes.position,
      v = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      m.getVertexPosition(i, v);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    m.skeleton.calculateInverses();
    m.bind(m.skeleton, m.matrixWorld);
  });
  return { group, foot, toe };
}
const soleHeights = (l: ReturnType<typeof leg>) => {
  l.group.updateMatrixWorld(true);
  const heel = point(l.foot).add(new T.Vector3(0, 0, -0.07)),
    ball = point(l.toe);
  return [heel, ball];
};

describe("anatomical foot rest", () => {
  it("levels a foot bound with a pitched sole, and its bent toes", () => {
    const flat = leg(),
      pitched = leg(0.35, -0.3);
    for (const l of [flat, pitched])
      normalizeFootRest(l.group, l.foot, down, forward);
    // Same foot and toe orientation as the flat bind once both are normalized.
    for (const name of ["foot", "toe"] as const)
      expect(
        flat[name]
          .getWorldQuaternion(new T.Quaternion())
          .angleTo(pitched[name].getWorldQuaternion(new T.Quaternion())),
      ).toBeLessThan(0.02);
    const [heel, ball] = soleHeights(flat);
    expect(Math.abs(heel.y - ball.y)).toBeLessThan(0.08);
  });
  it("keeps the bind when the skin gives no sole to stand on", () => {
    const l = leg(0.2, 0, true);
    const before = l.foot.getWorldQuaternion(new T.Quaternion());
    normalizeFootRest(l.group, l.foot, down, forward);
    expect(
      l.foot.getWorldQuaternion(new T.Quaternion()).angleTo(before),
    ).toBeLessThan(1e-6);
  });
});
