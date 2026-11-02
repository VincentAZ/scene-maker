import * as T from "three";

/** Anatomical rest for arm twist, wrist and fingers.
 *
 * Transfer compares each rig against its own neutral pose. Pointing limbs
 * straight down by a minimal rotation removes the bind's limb direction (A/T
 * pose) but keeps whatever twist and finger rest the bind happened to have, so
 * the same body bound with palms rolled or fingers relaxed received different
 * motion. These steps define those parts anatomically from measured geometry,
 * identically for source and receiver: elbow hinge across the body, thumb
 * forward (palms toward the thighs), wrist straight, finger chains straight.
 * No bone names are used. Rigs without the needed joints keep the old rest. */

const point = (node: T.Object3D) => node.getWorldPosition(new T.Vector3());
const smooth = (a: number, b: number, x: number) => {
  const t = T.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function below(node: T.Object3D | null, root: T.Object3D) {
  for (let n = node?.parent; n; n = n.parent) if (n === root) return true;
  return false;
}
function rotateWorld(bone: T.Object3D, rotation: T.Quaternion) {
  const world = bone
    .getWorldQuaternion(new T.Quaternion())
    .premultiply(rotation);
  bone.quaternion
    .copy(
      bone
        .parent!.getWorldQuaternion(new T.Quaternion())
        .invert()
        .multiply(world),
    )
    .normalize();
  bone.updateWorldMatrix(true, true);
}
/** Signed angle about `axis` from `from` to `to`, both projected off the axis. */
function twist(axis: T.Vector3, from: T.Vector3, to: T.Vector3) {
  const a = from.clone().addScaledVector(axis, -from.dot(axis)),
    b = to.clone().addScaledVector(axis, -to.dot(axis));
  if (a.lengthSq() < 1e-12 || b.lengthSq() < 1e-12) return undefined;
  return Math.atan2(new T.Vector3().crossVectors(a, b).dot(axis), a.dot(b));
}
/** Bone chains starting at each child of the hand (first bone child onward). */
function fingerChains(hand: T.Bone) {
  return hand.children
    .filter((c): c is T.Bone => c instanceof T.Bone)
    .map((base) => {
      const chain = [base];
      for (
        let next = base.children.find((c) => c instanceof T.Bone) as T.Bone;
        next;
        next = next.children.find((c) => c instanceof T.Bone) as T.Bone
      )
        chain.push(next);
      return chain;
    });
}

/** Shared reference only: any fixed value maps source and receiver alike. */
const THUMB_OPENING = (35 * Math.PI) / 180;

export type ArmRest = { hinge: T.Vector3; bend: number };

/** Capture the bind elbow hinge in the upper arm's frame, before limbs are
 * pointed down. A visibly bent bind elbow fixes the upper arm's twist. */
export function captureArmRest(upper: T.Bone, lower: T.Bone, wrist: T.Vector3) {
  const shoulder = point(upper),
    elbow = point(lower);
  const a = elbow.clone().sub(shoulder).normalize(),
    b = wrist.clone().sub(elbow).normalize();
  const hinge = new T.Vector3().crossVectors(a, b);
  const bend = Math.atan2(hinge.length(), a.dot(b));
  if (hinge.lengthSq() > 1e-16) hinge.normalize();
  hinge.applyQuaternion(upper.getWorldQuaternion(new T.Quaternion()).invert());
  return { hinge, bend } satisfies ArmRest;
}

/** Apply after both arm segments point along `down`. */
export function normalizeArmRest(
  upper: T.Bone,
  lower: T.Bone,
  hand: T.Bone | undefined,
  rest: ArmRest,
  down: T.Vector3,
  forward: T.Vector3,
) {
  if (!below(lower, upper)) return;
  const usable = hand && below(hand, lower);
  const chains = usable ? fingerChains(hand) : [];
  const bases = chains.map((chain) => {
    const base = chain.find(
      (b) =>
        point(b).distanceTo(point(hand!)) >
        1e-6 * point(lower).distanceTo(point(hand!)),
    );
    return base ? point(base).sub(point(hand!)).normalize() : undefined;
  });
  // The thumb leaves the hand at a clearly larger angle from the forearm than
  // every other chain; otherwise the hand gives no reliable palm reference.
  const angles = bases.map((b) =>
    b ? Math.acos(T.MathUtils.clamp(b.dot(down), -1, 1)) : -1,
  );
  const order = angles.map((_, i) => i).sort((i, j) => angles[j] - angles[i]);
  const thumb =
    bases.length >= 2 &&
    angles[order[0]] - angles[order[1]] > (10 * Math.PI) / 180
      ? order[0]
      : -1;
  const others = bases.filter((b, i) => b && i !== thumb) as T.Vector3[];
  // Wrist straight: the mean direction to the (non-thumb) finger bases follows
  // the forearm.
  if (usable && others.length) {
    const along = others
      .reduce((s, b) => s.add(b), new T.Vector3())
      .normalize();
    if (along.lengthSq() > 0.5)
      rotateWorld(hand!, new T.Quaternion().setFromUnitVectors(along, down));
  }
  // Palm reference: the line across the finger bases (index to pinky side),
  // which follows the palm itself. The thumb only says which end is which;
  // its own placement varies with hand proportions. Facing the thighs, that
  // line points backward.
  const palmAngle = () => {
    if (!usable || thumb < 0 || others.length < 3) return undefined;
    const origin = point(hand!);
    const flat = chains
      .filter((_, i) => i !== thumb)
      .map((chain) => {
        const p = point(chain[0]).sub(origin);
        return p.addScaledVector(down, -p.dot(down));
      });
    const mean = flat
      .reduce((s, p) => s.add(p), new T.Vector3())
      .divideScalar(flat.length);
    const e1 = forward
        .clone()
        .addScaledVector(down, -forward.dot(down))
        .normalize(),
      e2 = new T.Vector3().crossVectors(down, e1);
    let xx = 0,
      xy = 0,
      yy = 0;
    for (const p of flat) {
      const x = p.clone().sub(mean).dot(e1),
        y = p.clone().sub(mean).dot(e2);
      xx += x * x;
      xy += x * y;
      yy += y * y;
    }
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    const across = e1
      .clone()
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(e2, Math.sin(angle));
    const thumbSide = point(chains[thumb][0]).sub(origin).sub(mean);
    if (across.dot(thumbSide) > 0) across.negate();
    return twist(down, across, forward.clone().negate());
  };
  // Upper arm: hinge across the body (flexion brings the forearm forward).
  // Binds are usually almost straight at the elbow, where the hinge direction
  // is noise (a 1 degree bend flipped it on a measured rig); only a clearly
  // bent bind elbow sets the upper arm's twist. Palm rotation belongs to the
  // forearm (pronation/supination), so the palm never twists the upper arm.
  const hingeWorld = rest.hinge
    .clone()
    .applyQuaternion(upper.getWorldQuaternion(new T.Quaternion()));
  const hingeAngle = twist(
    down,
    hingeWorld,
    new T.Vector3().crossVectors(down, forward),
  );
  const upperRoll =
    (hingeAngle ?? 0) *
    smooth((15 * Math.PI) / 180, (25 * Math.PI) / 180, rest.bend);
  if (upperRoll)
    rotateWorld(upper, new T.Quaternion().setFromAxisAngle(down, upperRoll));
  // Forearm: palm toward the thigh.
  const forearmRoll = palmAngle();
  if (forearmRoll)
    rotateWorld(lower, new T.Quaternion().setFromAxisAngle(down, forearmRoll));
  if (!usable) return;
  // Finger chains straight along the hand; the thumb straight along a fixed
  // opening from the hand axis toward the front.
  chains.forEach((chain, i) => {
    // The palm reference above already turned the thumb forward; its first
    // segment opens from the hand axis toward that same forward direction.
    const reference =
      i === thumb
        ? down
            .clone()
            .multiplyScalar(Math.cos(THUMB_OPENING))
            .addScaledVector(forward, Math.sin(THUMB_OPENING))
        : down;
    for (let k = 0; k + 1 < chain.length; k++) {
      const segment = point(chain[k + 1]).sub(point(chain[k]));
      if (segment.lengthSq() < 1e-16) continue;
      rotateWorld(
        chain[k],
        new T.Quaternion().setFromUnitVectors(segment.normalize(), reference),
      );
    }
  });
}
