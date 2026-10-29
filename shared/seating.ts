import { interactionSessions } from "./interactions";
import type { Asset, Entity, Scene, Motion } from "./scene";
import { ease, mixPoint, turnPoint, type Point } from "./ladder";

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
export function nearestSeat(scene: Scene, assets: Asset[], actor: Entity) {
  return scene.entities
    .filter(
      (e) =>
        e.id !== actor.id &&
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
};
export function planSeat(
  from: Point,
  heading: number,
  actor: Entity,
  target: Entity,
  asset: Asset,
  supported = true,
  body?: SeatBody,
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
  else if (Math.abs(from[1] - target.position[1]) > 0.2 * actor.scale)
    warning = `Place ${actor.name} at the floor height of ${target.name}.`;
  else if (
    Math.hypot(from[0] - front[0], from[2] - front[2]) >
    1.5 * actor.scale
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
export function sampleSeat(plan: SeatPlan, progress: number, standing = false) {
  const u = Math.max(0, Math.min(1, progress));
  const amount = standing ? 1 - ease(u / 0.85) : ease((u - 0.3) / 0.6);
  const approach = ease(u / 0.3);
  const root = plan.warning
    ? ([...plan.from] as Point)
    : standing
      ? mixPoint(plan.centre, plan.front, ease(u / 0.85))
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
      occupied: (typeof uses)[number] | undefined;
    for (const clip of actor.clips) {
      const kind = motions.find((m) => m.id === clip.motionId)?.kind;
      if (kind === "sit" && clip.targetId) {
        if (occupied)
          throw Error(
            `${actor.name} is already seated. Add Stand up before sitting again.`,
          );
        occupied = {
          actorId: actor.id,
          targetId: clip.targetId,
          start: time,
          end: Infinity,
        };
        if (actor.visible) uses.push(occupied);
      } else if (kind === "stand") {
        if (!occupied)
          throw Error(
            `${actor.name} needs a targeted Sit down before Stand up.`,
          );
        occupied.end = time + clip.duration;
        occupied = undefined;
      } else if (
        occupied &&
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
