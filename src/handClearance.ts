import * as T from "three";
import { solveLimb } from "./ik";

type Side = "left" | "right";
type Surface = {
  mesh: T.SkinnedMesh;
  /** Vertices independent of both arms, with their per-leg skin weights. */
  body: number[];
  legs: Float32Array;
  hands: Record<Side, number[]>;
};
const surfaces = new WeakMap<T.Group, Surface[]>();
const PROBES = 40;
function below(node: T.Object3D | undefined, root: T.Object3D | undefined) {
  if (!root) return false;
  for (; node; node = node.parent ?? undefined) if (node === root) return true;
  return false;
}
const point = (node: T.Object3D) => node.getWorldPosition(new T.Vector3());
const smooth = (a: number, b: number, x: number) => {
  const t = T.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Spread a bounded number of probes over the hand by farthest-point sampling in
 * the bind pose. Deterministic, so every sampled time uses the same probes. */
function spread(mesh: T.SkinnedMesh, ids: number[]) {
  if (ids.length <= PROBES) return ids;
  const position = mesh.geometry.attributes.position;
  const p = ids.map((i) => new T.Vector3().fromBufferAttribute(position, i));
  const chosen = [0],
    gap = p.map((v) => v.distanceToSquared(p[0]));
  while (chosen.length < PROBES) {
    let best = 0;
    for (let i = 1; i < gap.length; i++) if (gap[i] > gap[best]) best = i;
    chosen.push(best);
    for (let i = 0; i < gap.length; i++)
      gap[i] = Math.min(gap[i], p[i].distanceToSquared(p[best]));
  }
  return chosen.map((i) => ids[i]);
}

/** Skin membership, not mesh names or provider identity, separates hands from
 * the receiving body and clothing. Capture once in the original hierarchy. */
export function captureHandClearance(group: T.Group) {
  surfaces.delete(group);
  const bones = group.userData.bones as Record<string, T.Bone> | undefined;
  if (!bones?.hips || !bones.leftArm || !bones.rightArm) return;
  const result: Surface[] = [];
  group.traverse((mesh) => {
    if (!(mesh instanceof T.SkinnedMesh)) return;
    const { skinIndex: indices, skinWeight: weights } =
      mesh.geometry.attributes;
    if (!indices || !weights) return;
    const labels = mesh.skeleton.bones.map((bone) => ({
      arm: below(bone, bones.leftArm) || below(bone, bones.rightArm),
      left: below(bone, bones.leftHand),
      right: below(bone, bones.rightHand),
      leftLeg: below(bone, bones.leftLeg),
      rightLeg: below(bone, bones.rightLeg),
    }));
    const body: number[] = [],
      legs: number[] = [];
    const hands: Record<Side, number[]> = { left: [], right: [] };
    for (let i = 0; i < indices.count; i++) {
      let arm = 0,
        left = 0,
        right = 0,
        leftLeg = 0,
        rightLeg = 0,
        total = 0;
      for (let j = 0; j < weights.itemSize; j++) {
        const weight = weights.getComponent(i, j);
        const label = labels[indices.getComponent(i, j)];
        total += weight;
        if (label?.arm) arm += weight;
        if (label?.left) left += weight;
        if (label?.right) right += weight;
        if (label?.leftLeg) leftLeg += weight;
        if (label?.rightLeg) rightLeg += weight;
      }
      // The body must not move with the corrected arm. Mixed cuff vertices are
      // not hand probes: they do not follow the hand rigidly.
      if (total > 0.99 && arm < 1e-3) {
        body.push(i);
        legs.push(leftLeg / total, rightLeg / total);
      }
      if (left > 0.999) hands.left.push(i);
      if (right > 0.999) hands.right.push(i);
    }
    hands.left = spread(mesh, hands.left);
    hands.right = spread(mesh, hands.right);
    if (body.length || hands.left.length || hands.right.length)
      result.push({ mesh, body, legs: new Float32Array(legs), hands });
  });
  if (result.some((s) => s.body.length)) surfaces.set(group, result);
}

/** World positions of selected skinned vertices. Matches
 * `SkinnedMesh.getVertexPosition` (linear blend skinning) but forms each bone's
 * skinning matrix once instead of once per vertex and influence. Meshes with
 * active morph targets use the generic path. */
function skinnedPositions(
  mesh: T.SkinnedMesh,
  ids: number[],
  visit: (p: T.Vector3, k: number) => void,
) {
  const v = new T.Vector3();
  if (mesh.morphTargetInfluences?.some((x) => x !== 0)) {
    ids.forEach((i, k) =>
      visit(mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld), k),
    );
    return;
  }
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
  const { bones, boneInverses } = mesh.skeleton;
  const matrices: (T.Matrix4 | undefined)[] = [];
  const prefix = new T.Matrix4().multiplyMatrices(
    mesh.matrixWorld,
    mesh.bindMatrixInverse,
  );
  const matrix = (b: number) =>
    (matrices[b] ??= new T.Matrix4()
      .multiplyMatrices(bones[b].matrixWorld, boneInverses[b])
      .premultiply(prefix)
      .multiply(mesh.bindMatrix));
  const direct = [position, skinIndex, skinWeight].every(
    (a) => a instanceof T.BufferAttribute && !a.normalized,
  );
  const base = new T.Vector3(),
    part = new T.Vector3();
  if (!direct) {
    ids.forEach((i, k) => {
      base.fromBufferAttribute(position, i);
      v.set(0, 0, 0);
      for (let j = 0; j < skinWeight.itemSize; j++) {
        const weight = skinWeight.getComponent(i, j);
        if (weight !== 0)
          v.addScaledVector(
            part.copy(base).applyMatrix4(matrix(skinIndex.getComponent(i, j))),
            weight,
          );
      }
      visit(v, k);
    });
    return;
  }
  // Same arithmetic on the raw arrays: the generic accessors dominate cost.
  const xyz = position.array,
    stride = position.itemSize,
    index = skinIndex.array,
    weights = skinWeight.array,
    n = skinWeight.itemSize;
  ids.forEach((i, k) => {
    const px = xyz[i * stride],
      py = xyz[i * stride + 1],
      pz = xyz[i * stride + 2];
    let x = 0,
      y = 0,
      z = 0;
    for (let j = 0; j < n; j++) {
      const weight = weights[i * n + j];
      if (weight === 0) continue;
      const e = matrix(index[i * n + j]).elements;
      x += weight * (e[0] * px + e[4] * py + e[8] * pz + e[12]);
      y += weight * (e[1] * px + e[5] * py + e[9] * pz + e[13]);
      z += weight * (e[2] * px + e[6] * py + e[10] * pz + e[14]);
    }
    visit(v.set(x, y, z), k);
  });
}

/** The receiving body around one pose: torso frame and a radial surface model.
 * Returns undefined when the rig lacks the joints or skin it needs. */
function bodyModel(group: T.Group) {
  const bones = group.userData.bones as Record<string, T.Bone> | undefined;
  if (!bones?.leftLeg || !bones.rightLeg) return undefined;
  const saved = surfaces.get(group);
  if (!saved) return undefined;
  group.updateMatrixWorld(true);
  const origin = point(bones.leftLeg)
    .add(point(bones.rightLeg))
    .multiplyScalar(0.5);
  const up = point(bones.leftArm)
    .add(point(bones.rightArm))
    .multiplyScalar(0.5)
    .sub(origin);
  const torso = up.length();
  if (!Number.isFinite(torso) || torso < 1e-6) return undefined;
  up.normalize();
  const lateral = point(bones.leftArm).sub(point(bones.rightArm));
  lateral.addScaledVector(up, -lateral.dot(up));
  if (lateral.lengthSq() < 1e-12) return undefined;
  lateral.normalize();
  const forward = new T.Vector3().crossVectors(lateral, up);
  // Cylindrical coordinates about the torso axis, in torso-length units.
  const offset = new T.Vector3();
  const cylinder = (p: T.Vector3) => {
    offset.copy(p).sub(origin);
    const y = offset.dot(up),
      x = offset.dot(lateral),
      z = offset.dot(forward);
    return {
      y: y / torso,
      r: Math.hypot(x, z) / torso,
      theta: Math.atan2(z, x),
    };
  };
  const legFade = (["left", "right"] as const).map((side) => {
    const knee = bones[side + "Shin"];
    if (!knee || !below(knee, bones[side + "Leg"])) return 1;
    const thigh = point(knee)
      .sub(point(bones[side + "Leg"]))
      .normalize();
    return smooth(
      Math.cos((50 * Math.PI) / 180),
      Math.cos((30 * Math.PI) / 180),
      -thigh.dot(up),
    );
  });
  // Surface model parameters, in torso units: kernel width, outer-layer bias
  // and clearance margin.
  const sigma = 0.06,
    layer = 200,
    margin = 0.006;
  const cell = sigma * 3,
    arcs = Math.max(8, Math.floor((2 * Math.PI * 0.35) / cell));
  // Only heights a candidate hand (with fingers, push and kernel) can reach.
  const low = -1.9,
    rows = Math.ceil(3 / cell);
  const sector = (theta: number) =>
    Math.floor(((theta + Math.PI) / (2 * Math.PI)) * arcs);
  let grid:
    | {
        y: Float64Array;
        r: Float64Array;
        theta: Float64Array;
        start: Int32Array;
        order: Int32Array;
      }
    | undefined;
  // Regions that queries can reach, registered before the body is built.
  // Vertices outside every region are beyond the kernel of any query point, so
  // skipping them leaves the surface unchanged and saves most of the work.
  const regions: { y0: number; y1: number; t0: number; t1: number }[] = [];
  const focus = (points: T.Vector3[], travel: number) => {
    if (!points.length) return;
    let y0 = Infinity,
      y1 = -Infinity,
      r0 = Infinity,
      a = 0,
      b = 0;
    const c0 = cylinder(points[0]).theta;
    for (const p of points) {
      const c = cylinder(p);
      let d = c.theta - c0;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      a = Math.min(a, d);
      b = Math.max(b, d);
      y0 = Math.min(y0, c.y);
      y1 = Math.max(y1, c.y);
      r0 = Math.min(r0, c.r);
    }
    // A push along a direction inside the probes' own angular range keeps
    // them inside it; 0.3 rad covers the arc an arm-reach limit adds.
    const turn = Math.min(Math.PI, (sigma * 3) / Math.max(r0, 0.05)) + 0.3;
    regions.push({
      y0: y0 - sigma * 3 - travel,
      y1: y1 + sigma * 3 + travel,
      t0: c0 + a - turn,
      t1: c0 + b + turn,
    });
  };
  const wanted = (height: number, angle: number) =>
    !regions.length ||
    regions.some((g) => {
      if (height < g.y0 || height > g.y1) return false;
      if (g.t1 - g.t0 >= 2 * Math.PI) return true;
      const d = angle - g.t0;
      return d - 2 * Math.PI * Math.floor(d / (2 * Math.PI)) <= g.t1 - g.t0;
    });
  /** Body vertex cylindrical coordinates, indexed by (height row, arc sector). */
  const build = () => {
    const count = saved.reduce((n, s) => n + s.body.length, 0);
    const y = new Float64Array(count),
      r = new Float64Array(count),
      theta = new Float64Array(count),
      cellOf = new Int32Array(count).fill(-1),
      start = new Int32Array(rows * arcs + 1);
    let n = 0;
    for (const surface of saved)
      skinnedPositions(surface.mesh, surface.body, (v, k) => {
        offset.copy(v).sub(origin);
        const height = offset.dot(up) / torso;
        if (!(height >= low && height < low + rows * cell)) return;
        const x = offset.dot(lateral),
          z = offset.dot(forward);
        // Fading a swung thigh shrinks its radius toward the axis continuously.
        const radius =
          (Math.hypot(x, z) / torso) *
          (1 -
            surface.legs[2 * k] * (1 - legFade[0]) -
            surface.legs[2 * k + 1] * (1 - legFade[1]));
        if (!(radius > 0) || !Number.isFinite(radius)) return;
        const angle = Math.atan2(z, x);
        if (!wanted(height, angle)) return;
        y[n] = height;
        r[n] = radius;
        theta[n] = angle;
        const id =
          Math.floor((height - low) / cell) * arcs +
          Math.min(arcs - 1, sector(angle));
        cellOf[n++] = id;
        start[id + 1]++;
      });
    for (let i = 0; i < rows * arcs; i++) start[i + 1] += start[i];
    const fill = start.slice(0, -1),
      order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[fill[cellOf[i]]++] = i;
    return (grid = { y, r, theta, start, order });
  };
  /** Surface radius at (height, arc), already blended toward "no body" where
   * the kernel finds almost nothing (hems, openings, sparse meshes). The probe
   * radius only offsets the exponentials for numerical range. */
  const surfaceAt = (y: number, r: number, theta: number) => {
    const reach = sigma * 3,
      turn = Math.min(Math.PI, reach / Math.max(r, 0.05));
    const row = Math.floor((y - low) / cell),
      first = sector(theta - turn),
      last = Math.min(sector(theta + turn), first + arcs - 1);
    const g = grid ?? build();
    let weight = 0,
      coverage = 0,
      sum = 0;
    for (let yy = Math.max(0, row - 1); yy <= Math.min(rows - 1, row + 1); yy++)
      for (let a = first; a <= last; a++) {
        const id = yy * arcs + (((a % arcs) + arcs) % arcs);
        for (let o = g.start[id]; o < g.start[id + 1]; o++) {
          const i = g.order[o];
          let d = Math.abs(theta - g.theta[i]);
          if (d > Math.PI) d = 2 * Math.PI - d;
          const dy = y - g.y[i],
            arc = r * d;
          const q = (dy * dy + arc * arc) / (sigma * sigma);
          if (q > 9) continue;
          // Compact taper for strict continuity at the window edge, plus a
          // Gaussian falloff steep enough relative to the outer-layer bias that
          // each vertex acts as a smooth cap (gentle, bounded slope)
          // rather than a plateau ending in a cliff at the window edge.
          const taper = (1 - q / 9) ** 3,
            w = taper * Math.exp(-3.5 * q);
          coverage += taper;
          weight += w;
          sum += w * Math.exp(layer * (g.r[i] - r));
        }
      }
    if (!(weight > 0)) return -Infinity;
    return (r + Math.log(sum / weight) / layer) * smooth(0, 1.5, coverage);
  };
  /** Radial penetration of a point below the surface (positive inside). */
  const inside = (p: T.Vector3) => {
    const { y, r, theta } = cylinder(p);
    if (!Number.isFinite(y + r + theta)) return -Infinity;
    return surfaceAt(y, r, theta) + margin - r;
  };
  const probes = (side: Side) => {
    const result: T.Vector3[] = [];
    for (const surface of saved)
      skinnedPositions(surface.mesh, surface.hands[side], (p) =>
        result.push(p.clone()),
      );
    return result;
  };
  return {
    bones,
    saved,
    origin,
    up,
    lateral,
    forward,
    torso,
    inside,
    probes,
    focus,
  };
}
// Smooth maximum: no kinks where the deepest probe changes.
const sharp = 400;
function softTop(values: number[]) {
  const top = Math.max(...values);
  if (!Number.isFinite(top)) return top;
  let total = 0;
  for (const x of values) total += Math.exp(sharp * (x - top));
  return top + Math.log(total) / sharp;
}

/** Resolve hands that a transferred pose embeds in the RECEIVING body/clothing.
 *
 * Different proportions (arm length, shoulder width, hip/clothing volume) move
 * transferred hands relative to the receiving surface. The body is described
 * radially around the torso axis: at each (height, arc) the surface radius is a
 * kernel-weighted soft maximum of nearby body vertex radii. It favours the outer
 * layer (clothing over skin), does not grow with mesh density, fades to nothing
 * past hems/openings, and is smooth, so a moving hand does not pick up jitter.
 * A hand in front of the belly is compared with the belly, not the hips, and is
 * moved out through the side it is actually in. Thighs that swing far from the
 * torso axis (sitting, kicking) fade out, since a radial description would
 * otherwise swallow a hand resting on the lap.
 *
 * The push follows the penetrating probes' outward directions, weighted by
 * depth; its distance is the length of the push path still inside the body.
 * The wrist moves by two-bone IK with the recorded elbow direction as the
 * pole, and the hand keeps its world rotation, so wrist and finger
 * articulation are unchanged. When the source rig has skin, the source hand's
 * own penetration at the same instant is allowed, so contact that belongs to
 * the performance is kept. Pure pose solve (no temporal state); only
 * transferred playback calls it. Raised hands, detached chains and hands
 * without skin are left unchanged, as are crossed-arm, chest-height and
 * behind-the-back contacts; hands buried deeper than the bounded correction
 * are listed in `handClearance.unresolved`. */
export function supportTransferredHands(group: T.Group, source?: T.Group) {
  group.userData.handClearance = {};
  const model = bodyModel(group);
  if (!model) return;
  const { bones, saved, origin, up, lateral, forward, torso } = model;
  const candidates = (["left", "right"] as const).flatMap((side) => {
    const upper = bones[side + "Arm"],
      lower = bones[side + "Forearm"],
      hand = bones[side + "Hand"];
    if (!lower || !hand || !below(lower, upper) || !below(hand, lower))
      return [];
    if (!saved.some((s) => s.hands[side].length)) return [];
    const shoulder = point(upper),
      elbow = point(lower),
      wrist = point(hand);
    const length =
      (shoulder.distanceTo(elbow) + elbow.distanceTo(wrist)) / torso;
    const local = wrist.clone().sub(origin).divideScalar(torso);
    const y = local.dot(up),
      across = local.dot(lateral) * (side === "left" ? 1 : -1),
      depth = local.dot(forward);
    // Only where a push away from the body is unambiguous: a hand at its own
    // side of the hips, thighs or lower torso. Crossed arms, hands at the chest
    // and hands behind the back are deliberate contacts or occlusions (a hand
    // tucked under the other arm is meant to be hidden); pushing them out
    // rewrites the gesture, so they keep the transferred pose.
    const activation =
      smooth(-1.1, -0.9, y) *
      (1 - smooth(0.4, 0.55, y)) *
      smooth(0, 0.12, across) *
      smooth(-0.3, -0.18, depth);
    if (!(activation > 0) || !Number.isFinite(length) || length < 1e-6)
      return [];
    return [
      { side, upper, lower, hand, shoulder, elbow, wrist, length, activation },
    ];
  });
  if (!candidates.length) return;

  // Contact that the SOURCE performance itself makes with its own body (a hand
  // resting on a thigh while seated) is performance, not a transfer artefact.
  // When the source has skin, its own penetration at this instant is allowed
  // on the receiver; identical bodies are therefore left exactly unchanged.
  // Skeleton-only sources allow nothing.
  // Measured lazily: only when the receiver hand penetrates at all.
  let sourceModel: ReturnType<typeof bodyModel> | null = null;
  const sourceProbes: Partial<Record<Side, T.Vector3[]>> = {};
  const allowance = (side: Side) => {
    if (source === group) return Infinity;
    if (!source) return 0;
    if (sourceModel === null) {
      sourceModel = bodyModel(source);
      for (const c of candidates) {
        sourceProbes[c.side] = sourceModel?.probes(c.side) ?? [];
        sourceModel?.focus(sourceProbes[c.side]!, 0);
      }
    }
    const p = sourceProbes[side];
    if (!sourceModel || !p?.length) return 0;
    const depth = softTop(p.map(sourceModel.inside));
    return depth > 0 ? depth : 0;
  };
  const handProbes = Object.fromEntries(
    candidates.map((c) => {
      const probes = model.probes(c.side);
      model.focus(probes, c.length * 0.15 * 1.4);
      return [c.side, probes];
    }),
  ) as Partial<Record<Side, T.Vector3[]>>;
  const changes: Partial<Record<Side, number>> = {};
  const unresolved: Side[] = [];
  const moved = new T.Vector3();
  for (const c of candidates) {
    const probes = handProbes[c.side]!;
    if (!(softTop(probes.map(model.inside)) > 0)) continue;
    const allowed = allowance(c.side);
    if (allowed === Infinity) continue;
    const inside = (p: T.Vector3) => model.inside(p) - allowed;
    // Push along the penetrating probes' own outward (radial) directions,
    // weighted smoothly by depth. Using only the wrist's direction stalls when
    // curled fingers are embedded around a different side of the body.
    // (Numerically differentiated surface normals were tried: noisier, and
    // they did not change the deeply embedded cases they were meant for.)
    const directions = probes.map((p) => {
      const r = p.clone().sub(origin);
      r.addScaledVector(up, -r.dot(up));
      return r.lengthSq() > 1e-12 ? r.normalize() : r;
    });
    // Depth-proportional (not soft-max) weights: a soft-max switches between
    // clusters such as palm and curled fingers within a millimetre of motion,
    // swinging the push direction between frames.
    const weights = probes.map((p) => Math.max(0, inside(p)) ** 2);
    const outward = new T.Vector3();
    directions.forEach((d, i) => outward.addScaledVector(d, weights[i]));
    if (!(outward.lengthSq() > 1e-12)) continue;
    outward.normalize();
    // Two-bone reach: a shoulder swing alone cannot move a hand held in front
    // of the body further from the shoulder; the elbow must open or close.
    const reach =
      (c.shoulder.distanceTo(c.elbow) + c.elbow.distanceTo(c.wrist)) *
      (1 - 1e-4);
    // Restoring the hand's world rotation makes the hand a rigid translation of
    // the wrist, so probe positions follow exactly from the moved wrist.
    const displaced = (d: number) => {
      moved
        .copy(c.wrist)
        .addScaledVector(outward, d * torso)
        .sub(c.shoulder);
      if (moved.length() > reach) moved.setLength(reach);
      return moved.add(c.shoulder).sub(c.wrist);
    };
    // Push distance = length of the push path along which the hand is still
    // inside the body (penetration sampled along the path, interpolated
    // linearly). For a surface the hand leaves monotonically this is the exit
    // distance; unlike a root or linearized-step search it cannot jump between
    // separate exits of a bumpy surface, because it is continuous in the
    // sampled penetrations and therefore in the pose.
    const cap = c.length * 0.15,
      limit = cap * 1.4,
      samples = 12;
    const depthAt = (d: number) => {
      const shift = displaced(d);
      return softTop(probes.map((p) => inside(p.clone().add(shift))));
    };
    let root = 0,
      previous = depthAt(0);
    if (!(previous > 0)) continue;
    for (let i = 1; i <= samples; i++) {
      const next = depthAt((limit * i) / samples),
        step = limit / samples;
      if (previous > 0 && next > 0) root += step;
      else if (previous > 0) root += (step * previous) / (previous - next);
      else if (next > 0) root += (step * next) / (next - previous);
      previous = next;
    }
    // C1 onset and a soft cap: no snap at the margin, bounded mismatch. A
    // hand buried by much larger proportion differences (e.g. clasped behind
    // a far wider stylized body) cannot be cleared locally; it is moved at
    // most to the cap and reported, rather than relocated around the body.
    // (A depth fade-out was tried instead and flipped between states.)
    const ease = c.length * 0.004;
    let distance = root < ease ? (root * root) / (2 * ease) : root - ease / 2;
    if (distance > cap * 0.8) {
      const t = T.MathUtils.clamp((distance - cap * 0.8) / (cap * 0.4), 0, 1);
      distance = cap * 0.8 + cap * 0.2 * (2 * t - t * t);
    }
    if (root > cap) unresolved.push(c.side);
    distance *= c.activation;
    if (!(distance > 1e-9)) continue;
    const orientation = c.hand.getWorldQuaternion(new T.Quaternion());
    // The recorded elbow direction is the bend pole, so a zero push reproduces
    // the recorded arm exactly (no jump when the correction engages). Only an
    // almost straight arm, whose recorded offset vanishes, receives a small
    // backward default; its bend height is then too small for the default to
    // move the elbow visibly.
    const line = c.wrist.clone().sub(c.shoulder).normalize();
    const bend = c.elbow
      .clone()
      .sub(c.shoulder)
      .addScaledVector(line, -c.elbow.clone().sub(c.shoulder).dot(line));
    const pole = bend.addScaledVector(
      forward,
      -0.005 *
        c.length *
        torso *
        (1 - smooth(0, 0.005 * c.length * torso, bend.length())),
    );
    solveLimb(
      c.upper,
      c.lower,
      c.lower.worldToLocal(c.wrist.clone()),
      displaced(distance).add(c.wrist),
      pole,
    );
    c.hand.quaternion
      .copy(
        c.hand
          .parent!.getWorldQuaternion(new T.Quaternion())
          .invert()
          .multiply(orientation),
      )
      .normalize();
    c.hand.updateWorldMatrix(true, true);
    changes[c.side] = point(c.hand).distanceTo(c.wrist);
  }
  group.userData.handClearance = unresolved.length
    ? { ...changes, unresolved }
    : changes;
  // Disclosed, not hidden: only the bounded part of the correction applies.
  if (unresolved.length) {
    const [hands, they] =
      unresolved.length > 1
        ? ["Both hands reach", "they are"]
        : [`The ${unresolved[0]} hand reaches`, "it is"];
    group.userData.motionNotice = [
      group.userData.motionNotice,
      `${hands} into this character's body here; ${they} moved out only as far as the arm allows.`,
    ]
      .filter(Boolean)
      .join(" ");
  }
}
