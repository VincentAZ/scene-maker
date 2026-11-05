import { interactionSessions } from "./interactions";
import type { Asset, Entity, Scene, Motion } from "./scene";
import { ease, mixPoint, turnPoint, type Point } from "./ladder";
import { seatedRecording } from "./motionLibrary";

export type SeatProfile = { position: Point; width: number; depth: number };
export function seatProfile(asset: Asset): SeatProfile | undefined {
  if (asset.category !== "props") return;
  if (asset.seat) return asset.seat;
  if (asset.url || asset.parts?.length) return;
  if (["chair", "bench"].includes(asset.style))
    return {
      position: [0, 0.54, 0],
      width: asset.style === "bench" ? 1.8 : 0.5,
      depth: 0.48,
    };
  if (asset.style === "sofa")
    return { position: [0, 0.625, 0.08], width: 1.8, depth: 0.6 };
}
/** The closest still, visible seat, leaving out the ids in `taken`. */
export function nearestSeat(
  scene: Scene,
  assets: Asset[],
  actor: Entity,
  taken?: Set<string>,
) {
  return scene.entities
    .filter(
      (e) =>
        e.id !== actor.id &&
        !taken?.has(e.id) &&
        e.visible &&
        !e.clips.length &&
        assets.some((a) => a.id === e.assetId && seatProfile(a)),
    )
    .sort(
      (a, b) =>
        Math.hypot(...a.position.map((n, i) => n - actor.position[i])) -
        Math.hypot(...b.position.map((n, i) => n - actor.position[i])),
    )[0];
}
export type SeatBody = {
  padding: number;
  hipToLeg: number;
  hipHeight: number;
  upperLength: number;
  lowerLength: number;
  footHeight: number;
  hipWidth: number;
  hipOffset: Point;
  feet: { left: Point; right: Point };
  soles: { left: number; right: number };
};
export type SeatPlan = {
  targetId: string;
  targetName: string;
  anchor: Point;
  floor: number;
  facing: number;
  from: Point;
  heading: number;
  centre: Point;
  front: Point;
  warning: string;
};
export type SeatSample = {
  plan: SeatPlan;
  amount: number;
  progress: number;
  standing: boolean;
  /** Staging advice that does not stop the seat from placing the body. */
  notice?: string;
};
/** `held`: a take performed seated has no approach. The body is already on
 * the seat wherever the actor stood, so only the seat itself is checked. */
export function planSeat(
  from: Point,
  heading: number,
  actor: Entity,
  target: Entity,
  asset: Asset,
  supported = true,
  body?: SeatBody,
  held = false,
): SeatPlan {
  const profile = seatProfile(asset)!;
  const offset = turnPoint(
    profile.position.map((n) => n * target.scale) as Point,
    target.rotation,
  );
  const anchor = target.position.map((n, i) => n + offset[i]) as Point;
  const centre: Point = [anchor[0], target.position[1], anchor[2]];
  const frontOffset = turnPoint(
    [
      0,
      0,
      Math.max(
        (profile.depth * target.scale) / 2 + 0.08 * actor.scale,
        (body?.upperLength || 0.4) * actor.scale * 0.95,
      ),
    ],
    target.rotation,
  );
  const front = centre.map((n, i) => n + frontOffset[i]) as Point;
  let warning = "";
  if (!supported)
    warning = `${actor.name} needs a recognizable hip and leg rig to sit here.`;
  else if (!target.visible || target.clips.length)
    warning = `Keep ${target.name} visible and still while it is occupied.`;
  else if (!held && Math.abs(from[1] - target.position[1]) > 0.2 * actor.scale)
    warning = `Place ${actor.name} at the floor height of ${target.name}.`;
  else if (
    !held &&
    Math.hypot(from[0] - front[0], from[2] - front[2]) > 1.5 * actor.scale
  )
    warning = `Move ${actor.name} near the front of ${target.name} before sitting.`;
  else if (
    profile.width * target.scale <
    Math.max(0.18, (body?.hipWidth || 0.26) * 1.15) * actor.scale
  )
    warning = `Widen ${target.name} or make ${actor.name} smaller before sitting.`;
  else if (
    body &&
    Math.hypot(
      anchor[1] -
        target.position[1] +
        (body.padding - body.hipToLeg) * actor.scale -
        (body.footHeight - Math.min(body.soles.left, body.soles.right)) *
          actor.scale,
      Math.hypot(frontOffset[0], frontOffset[2]),
    ) >
      (body.upperLength + body.lowerLength) * actor.scale * 0.98
  )
    warning = `Lower or shrink ${target.name} so ${actor.name}'s feet can reach the floor.`;
  return {
    targetId: target.id,
    targetName: target.name,
    anchor,
    floor: target.position[1],
    facing: target.rotation,
    from: [...from],
    heading,
    centre,
    front,
    warning,
  };
}
export function sampleSeat(
  plan: SeatPlan,
  progress: number,
  standing = false,
  timing?: [number, number],
) {
  const u = Math.max(0, Math.min(1, progress));
  // A recording lowers (or rises) between its own measured fractions.
  const [from, to] = timing ?? (standing ? [0, 0.85] : [0.3, 0.9]);
  const amount = standing
    ? 1 - ease((u - from) / (to - from))
    : ease((u - from) / (to - from));
  const approach = ease(u / Math.max(from, 0.05));
  const root = plan.warning
    ? ([...plan.from] as Point)
    : standing
      ? mixPoint(plan.centre, plan.front, ease((u - from) / (to - from)))
      : mixPoint(
          mixPoint(plan.from, plan.front, approach),
          plan.centre,
          amount,
        );
  const turn = Math.atan2(
    Math.sin(plan.facing - plan.heading),
    Math.cos(plan.facing - plan.heading),
  );
  return {
    root,
    heading: plan.warning
      ? plan.heading
      : standing
        ? plan.facing
        : plan.heading + turn * approach,
    seat: { plan, amount: plan.warning ? 0 : amount, progress: u, standing },
  };
}
/** Sitting owns a seat until Stand up, including gestures and the held ending. */
export function validateSeating(
  scene: Scene,
  motions: Motion[],
  deferTiming = false,
) {
  const uses: {
    actorId: string;
    targetId: string;
    start: number;
    end: number;
  }[] = [];
  for (const actor of scene.entities) {
    let time = 0,
      occupied: (typeof uses)[number] | undefined,
      // The seated take that opened the occupation when no Sit down did.
      snapped: string | undefined;
    for (const clip of actor.clips) {
      const motion = motions.find((m) => m.id === clip.motionId);
      const kind = motion?.role;
      // A take performed seated continues the occupation of its own seat,
      // or opens one when nobody sat down before it.
      const seatedTake = seatedRecording(motion);
      if ((kind === "sit" || seatedTake) && clip.targetId) {
        if (occupied && kind === "sit" && snapped)
          throw Error(`Move Sit down before ${snapped}.`);
        if (occupied && (kind === "sit" || occupied.targetId !== clip.targetId))
          throw Error(
            `${actor.name} is already seated. Add Stand up before sitting again.`,
          );
        if (!occupied) {
          occupied = {
            actorId: actor.id,
            targetId: clip.targetId,
            start: time,
            end: Infinity,
          };
          snapped = seatedTake ? motion!.name : undefined;
          if (actor.visible) uses.push(occupied);
        }
      } else if (kind === "stand") {
        if (!occupied)
          throw Error(
            `${actor.name} needs a targeted Sit down before Stand up.`,
          );
        occupied.end = time + clip.duration;
        occupied = undefined;
      } else if (
        occupied &&
        !seatedTake &&
        !["idle", "talk", "wave", "bow", "pick", "sip", "place"].includes(
          kind || "",
        )
      ) {
        throw Error(
          `Add Stand up before ${actor.name}'s next full-body action.`,
        );
      }
      time += clip.duration;
    }
  }
  if (!deferTiming)
    for (const [index, a] of uses.entries())
      for (const b of uses.slice(index + 1))
        if (
          a.actorId !== b.actorId &&
          a.targetId === b.targetId &&
          a.start < b.end &&
          b.start < a.end
        )
          throw Error(
            "This seat is occupied. Add Stand up before another character sits here.",
          );
  const held =
    !deferTiming && uses.length ? interactionSessions(scene, motions) : [];
  for (const seat of uses)
    for (const hold of held)
      if (
        seat.targetId === hold.targetId &&
        seat.start < hold.end &&
        hold.acquire.start < seat.end
      )
        throw Error(
          "Leave occupied seats in place. Put the seat down before anyone sits on it.",
        );
  return uses;
}
/** Where a seated recording added to the end of an actor's sequence sits: on
 * the seat the actor already sits on (the take continues it), else on the
 * nearest free seat after a Sit down onto it, or untargeted with advice when
 * no seat is free. */
export function seatedAddPlan(
  scene: Scene,
  assets: Asset[],
  motions: Motion[],
  actorId: string,
  motionId: string,
): { targetId?: string; leadIn?: boolean; notice?: string } {
  const actor = scene.entities.find((e) => e.id === actorId);
  if (!actor || !seatedRecording(motions.find((m) => m.id === motionId)))
    return {};
  let seat: string | undefined;
  for (const clip of actor.clips) {
    const motion = motions.find((m) => m.id === clip.motionId);
    if (clip.targetId && (motion?.role === "sit" || seatedRecording(motion)))
      seat = clip.targetId;
    else if (motion?.role === "stand") seat = undefined;
  }
  if (seat) return { targetId: seat };
  // Seats other characters still occupy when this sequence ends are taken.
  const end = actor.clips.reduce((sum, clip) => sum + clip.duration, 0);
  const taken = new Set(
    validateSeating(scene, motions)
      .filter((use) => use.actorId !== actor.id && use.end > end)
      .map((use) => use.targetId),
  );
  const free = nearestSeat(scene, assets, actor, taken);
  if (!free)
    return {
      notice: nearestSeat(scene, assets, actor)
        ? "Every seat is taken. Add a chair, then choose it in Details."
        : "Add a chair, then choose it in Details.",
    };
  return {
    targetId: free.id,
    leadIn: true,
    notice: `Sit down on ${free.name} comes first.`,
  };
}
/** The first take performed seated that nobody sat down on: where the
 * recorded Sit down belongs in the sequence, and on which seat. */
export function missingSitDown(
  clips: Entity["clips"],
  motions: Motion[],
): { index: number; targetId: string; name: string } | undefined {
  let seated = false;
  for (const [index, clip] of clips.entries()) {
    const motion = motions.find((m) => m.id === clip.motionId);
    if (motion?.role === "stand") seated = false;
    else if (
      motion &&
      clip.targetId &&
      (motion.role === "sit" || seatedRecording(motion))
    ) {
      if (!seated && motion.role !== "sit")
        return { index, targetId: clip.targetId, name: motion.name };
      seated = true;
    }
  }
}
/** Choosing another seat for one action of a seated stretch moves the whole
 * stretch with it: the Sit down that opened it and the seated takes up to its
 * Stand up, which all sat on the seat being replaced. Clearing a seat, or
 * choosing one for an action that had none, changes that action alone. */
export function reseat(
  clips: Entity["clips"],
  motions: Motion[],
  clipId: string,
  targetId: string | undefined,
): Entity["clips"] {
  const index = clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return clips;
  const previous = clips[index].targetId;
  const motionOf = (clip: Entity["clips"][number]) =>
    motions.find((m) => m.id === clip.motionId);
  let from = index,
    to = index;
  if (previous && targetId) {
    while (from > 0 && motionOf(clips[from - 1])?.role !== "stand") from--;
    while (to < clips.length - 1 && motionOf(clips[to + 1])?.role !== "stand")
      to++;
  }
  return clips.map((clip, i) => {
    const motion = motionOf(clip);
    return i === index ||
      (i >= from &&
        i <= to &&
        clip.targetId === previous &&
        (motion?.role === "sit" || seatedRecording(motion)))
      ? { ...clip, targetId }
      : clip;
  });
}
