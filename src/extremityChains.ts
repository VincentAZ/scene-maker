import * as T from "three";

type Joint = { bone: T.Bone; key: string; bindPoint: T.Vector3 };

/** Bone chains starting at each bone child of `root` (first bone child on). */
function chains(root: T.Bone) {
  return root.children
    .filter((c): c is T.Bone => c instanceof T.Bone)
    .map((base) => {
      const chain = [base];
      for (
        let next = base.children.find((c) => c instanceof T.Bone) as
          T.Bone | undefined;
        next;
        next = next.children.find((c) => c instanceof T.Bone) as
          T.Bone | undefined
      )
        chain.push(next);
      return chain;
    });
}

/** Fingers in anatomical order (thumb, then across the palm from the thumb
 * side) with each finger's place across the palm (0 at the thumb side, 1 at
 * the far side), from bind positions only. Undefined unless a thumb stands
 * out clearly from at least two other fingers. */
function fingerOrder(
  hand: T.Bone,
  elbow: T.Vector3,
  at: (bone: T.Bone) => T.Vector3 | undefined,
) {
  const origin = at(hand);
  if (!origin) return;
  const axis = origin.clone().sub(elbow).normalize();
  const list = chains(hand).flatMap((chain) => {
    const base = chain.find((b) => {
      const p = at(b);
      return p && p.distanceTo(origin) > 1e-6;
    });
    const p = base && at(base);
    return p ? [{ chain, offset: p.clone().sub(origin) }] : [];
  });
  if (list.length < 3) return;
  const angle = (o: T.Vector3) =>
    Math.acos(T.MathUtils.clamp(o.clone().normalize().dot(axis), -1, 1));
  const sorted = [...list].sort((p, q) => angle(q.offset) - angle(p.offset));
  if (angle(sorted[0].offset) - angle(sorted[1].offset) < (10 * Math.PI) / 180)
    return;
  const thumb = sorted[0],
    fingers = sorted.slice(1);
  const mean = fingers
    .reduce((s, f) => s.add(f.offset), new T.Vector3())
    .divideScalar(fingers.length);
  const side = thumb.offset.clone().sub(mean);
  side.addScaledVector(axis, -side.dot(axis));
  if (side.lengthSq() < 1e-12) return;
  side.normalize();
  fingers.sort((p, q) => q.offset.dot(side) - p.offset.dot(side));
  // Distinct places across the palm, or the order is not measurable.
  for (let i = 1; i < fingers.length; i++)
    if (fingers[i - 1].offset.dot(side) - fingers[i].offset.dot(side) < 1e-6)
      return;
  const near = fingers[0].offset.dot(side),
    span = near - fingers.at(-1)!.offset.dot(side);
  return [
    { chain: thumb.chain, at: 0 },
    ...fingers.map((f) => ({
      chain: f.chain,
      at: (near - f.offset.dot(side)) / span,
    })),
  ];
}

/** The toe chain: the foot's forward child carrying the most bones (a toe
 * share bone at the ball has none), with reach deciding only clear ties. */
function toeChain(
  foot: T.Bone,
  forward: T.Vector3,
  at: (bone: T.Bone) => T.Vector3 | undefined,
) {
  const origin = at(foot);
  if (!origin) return;
  const size = (bone: T.Bone) => {
    let n = 0;
    bone.traverse((c) => {
      if (c instanceof T.Bone) n++;
    });
    return n;
  };
  const reach = (chain: T.Bone[]) =>
    Math.max(
      ...chain.map((b) => (at(b) ?? origin).clone().sub(origin).dot(forward)),
    );
  const list = chains(foot)
    .filter((chain) => reach(chain) > 0)
    .sort((p, q) => size(q[0]) - size(p[0]) || reach(q) - reach(p));
  if (!list.length) return;
  const [best, next] = list;
  if (
    next &&
    size(next[0]) === size(best[0]) &&
    reach(next) > 0.8 * reach(best)
  )
    return;
  return best;
}

/** Pair finger and toe joints across naming conventions by hand/foot layout
 * and segment order. Applies only where both rigs show the same layout (same
 * finger count); existing (name or explicit role) pairs and exclusions win;
 * ambiguous layouts are left unmatched. */
export function extremityPairs<J extends Joint>(
  source: T.Group,
  target: T.Group,
  a: { joints: J[] },
  b: { joints: J[] },
  existing: { source: J; target: J }[],
) {
  const result: { source: J; target: J }[] = [];
  const usedSource = new Set(existing.map((p) => p.source.bone)),
    usedTarget = new Set(existing.map((p) => p.target.bone));
  const lookup = (rig: { joints: J[] }) => {
    const map = new Map(rig.joints.map((j) => [j.bone, j]));
    return {
      joint: (bone: T.Bone) => map.get(bone),
      at: (bone: T.Bone) => map.get(bone)?.bindPoint,
    };
  };
  const s = lookup(a),
    t = lookup(b);
  const pairChains = (from: T.Bone[], to: T.Bone[]) => {
    for (let k = 0; k < Math.min(from.length, to.length); k++) {
      const x = s.joint(from[k]),
        y = t.joint(to[k]);
      if (
        !x ||
        !y ||
        usedSource.has(x.bone) ||
        usedTarget.has(y.bone) ||
        x.key.startsWith("unmapped:") ||
        y.key.startsWith("unmapped:")
      )
        continue;
      usedSource.add(x.bone);
      usedTarget.add(y.bone);
      result.push({ source: x, target: y });
    }
  };
  const forwardOf = (
    group: T.Group,
    at: (b: T.Bone) => T.Vector3 | undefined,
  ) => {
    const bones = group.userData.bones as Record<string, T.Bone>;
    const l = at(bones.leftArm),
      r = at(bones.rightArm),
      h = at(bones.hips),
      head = at(bones.head);
    if (!l || !r || !h || !head) return;
    const up = head.clone().sub(h).normalize();
    const across = l.clone().sub(r);
    across.addScaledVector(up, -across.dot(up));
    return across.cross(up).normalize();
  };
  const sourceForward = forwardOf(source, s.at),
    targetForward = forwardOf(target, t.at);
  for (const side of ["left", "right"]) {
    const sb = source.userData.bones as Record<string, T.Bone>,
      tb = target.userData.bones as Record<string, T.Bone>;
    const sHand = sb[side + "Hand"],
      tHand = tb[side + "Hand"];
    const sElbow = sb[side + "Forearm"] && s.at(sb[side + "Forearm"]),
      tElbow = tb[side + "Forearm"] && t.at(tb[side + "Forearm"]);
    if (sHand && tHand && sElbow && tElbow) {
      const from = fingerOrder(sHand, sElbow, s.at),
        to = fingerOrder(tHand, tElbow, t.at);
      if (from && to && from.length === to.length)
        from.forEach((finger, i) => pairChains(finger.chain, to[i].chain));
      else if (from && to) {
        // Different finger counts (a four-finger or reduced Mixamo hand):
        // thumbs pair, the others by mutual nearest place across the palm.
        // A finger without a counterpart keeps its rest; none is invented.
        pairChains(from[0].chain, to[0].chain);
        const a = from.slice(1),
          b = to.slice(1);
        const nearest = <F extends { at: number }>(at: number, list: F[]) => {
          const [best, next] = [...list].sort(
            (p, q) => Math.abs(p.at - at) - Math.abs(q.at - at),
          );
          return next && Math.abs(next.at - at) - Math.abs(best.at - at) < 1e-6
            ? undefined
            : best;
        };
        for (const t of b) {
          const s = nearest(t.at, a);
          if (s && nearest(s.at, b) === t) pairChains(s.chain, t.chain);
        }
      }
    }
    const sFoot = sb[side + "Foot"],
      tFoot = tb[side + "Foot"];
    if (sFoot && tFoot && sourceForward && targetForward) {
      const from = toeChain(sFoot, sourceForward, s.at),
        to = toeChain(tFoot, targetForward, t.at);
      if (from && to) pairChains(from, to);
    }
  }
  return result;
}
