import { routeActiveDuration, routeStopTime } from "./clipTiming";
import {
  type Entity,
  type Motion,
  type Scene,
  allMotions,
  allAssets,
  boneNames,
} from "./scene";
import {
  ladderProfile,
  planLadder,
  sampleLadder,
  turnPoint,
  type LadderSample,
  type Point,
} from "./ladder";
import {
  planSeat,
  sampleSeat,
  seatProfile,
  type SeatSample,
  type SeatPlan,
  type SeatBody,
} from "./seating";
import { samplePath } from "./path";
import { seatTiming } from "./motionLibrary";
export type Pose = {
  root: [number, number, number];
  rotations: Record<string, [number, number, number]>;
  heading?: number;
  climb?: LadderSample;
  seat?: SeatSample;
};
/** Scene transforms carry no limb rotations: every body comes from a
 * recorded take, sampled on the rig after the transform is applied. */
const neutralRotations = (): Pose["rotations"] =>
  Object.fromEntries(boneNames.map((n) => [n, [0, 0, 0]]));
export function entityPose(
  e: Entity,
  scene: Scene,
  time: number,
  options: {
    nativeRoot?: (
      motion: Motion,
      clip: Entity["clips"][number],
    ) =>
      | { start: Point; delta: Point; heading?: number; startHeading?: number }
      | undefined;
    canClimb?: boolean;
    seatBody?: SeatBody;
    canSit?: boolean;
    /** Actual completed body facing can differ from an imported route's travel
     * frame. Loaded preview/export supplies the evaluated relative heading. */
    routeEndHeading?: (
      motion: Motion,
      clip: Entity["clips"][number],
      baseHeading: number,
    ) => number | undefined;
    /** World offset between the standing body and its route root at the
     * end of a completed route; later actions start from the body. */
    routeEndOffset?: (
      motion: Motion,
      clip: Entity["clips"][number],
      baseHeading: number,
    ) => Point | undefined;
  } = {},
): Pose {
  time = routeStopTime(e.clips, time);
  const p: Pose = {
    root: [...e.position],
    heading: e.rotation,
    rotations: Object.fromEntries(boneNames.map((n) => [n, [0, 0, 0]])),
  };
  let start = 0;
  let seated: SeatPlan | undefined;
  const library = allMotions(scene);
  const addRoot = (offset: Point) => {
    const world = turnPoint(
      offset.map((n) => n * e.scale) as Point,
      p.heading!,
    );
    p.root = p.root.map((n, i) => n + world[i]) as Point;
  };
  for (const clip of e.clips) {
    const m = library.find((m) => m.id === clip.motionId);
    if (!m) continue;
    const end = start + clip.duration;
    // Frozen wait chunks reuse an earlier stopped pose while active (above),
    // and contribute no additional travel or heading after they finish.
    if (clip.routeWait) {
      start = end;
      continue;
    }
    if (m.path) {
      p.climb = undefined;
      // A route stopped before an obstacle contributes only the travel it
      // completed before the stop, in this clip and to every later one.
      const local =
        clip.routeStop !== undefined
          ? Math.min(time - start, clip.routeStop - 1e-7)
          : time - start;
      const u = Math.max(0, Math.min(1, local / routeActiveDuration(clip)));
      const path = samplePath(m.path, u);
      addRoot(path.point);
      if (time >= end) {
        const offset = options.routeEndOffset?.(m, clip, p.heading!);
        if (offset) {
          // A standing take supplies its own floor calibration. Carry the
          // stopped body's horizontal location, but do not turn its gait's
          // vertical calibration into a new floor for every following wait.
          const standing = e.clips[e.clips.indexOf(clip) + 1]?.stationary;
          p.root = p.root.map((n, i) =>
            standing && i === 1 ? n : n + offset[i],
          ) as Point;
        }
      }
      p.heading! +=
        time >= end
          ? (options.routeEndHeading?.(m, clip, p.heading!) ?? path.heading)
          : path.heading;
      p.rotations = neutralRotations();
      if (time < end) return p;
      start = end;
      continue;
    }
    const target =
      clip.targetId &&
      scene.entities.find((entity) => entity.id === clip.targetId);
    const asset =
      target && allAssets(scene).find((asset) => asset.id === target.assetId);
    // Seats and ladders place the body and its contacts; the recording,
    // sampled on the rig afterwards, supplies every limb. Its turn in the
    // capture room is measured so the body keeps facing where it was at the
    // start and faces the placement's direction at the end.
    const recorded = () =>
      m.kind === "imported" ? options.nativeRoot?.(m, clip) : undefined;
    const arrive = (
      from: number,
      to: number,
      progress: number,
      native: ReturnType<typeof recorded>,
    ) => {
      if (!native) return to;
      // Measured turns are unwrapped; only the shortest remainder is blended.
      const rest = to - from - (native.heading ?? 0),
        remainder = Math.atan2(Math.sin(rest), Math.cos(rest));
      return (
        from +
        remainder * Math.max(0, Math.min(1, progress)) -
        (native.startHeading ?? 0)
      );
    };
    if (m.role === "sit" && target && asset && seatProfile(asset)) {
      seated = planSeat(
        p.root,
        p.heading!,
        e,
        target,
        asset,
        options.canSit !== false,
        options.seatBody,
      );
      const sample = sampleSeat(
        seated,
        (time - start) / clip.duration,
        false,
        seatTiming(m),
      );
      const native = recorded();
      p.root = sample.root;
      p.seat = sample.seat;
      p.climb = undefined;
      p.rotations = neutralRotations();
      if (time < end) {
        p.heading = arrive(
          seated.heading,
          seated.facing,
          sample.seat.amount,
          native,
        );
        return p;
      }
      p.heading = sample.heading;
      start = end;
      continue;
    }
    if (m.role === "stand" && seated) {
      const sample = sampleSeat(
        seated,
        (time - start) / clip.duration,
        true,
        seatTiming(m),
      );
      const native = recorded();
      p.root = sample.root;
      p.seat = sample.seat;
      p.climb = undefined;
      p.rotations = neutralRotations();
      // Rising keeps whatever turn the recording makes.
      if (time < end) {
        p.heading = sample.heading - (native?.startHeading ?? 0);
        return p;
      }
      p.heading = sample.heading + (native?.heading ?? 0);
      seated = undefined;
      p.seat = undefined;
      start = end;
      continue;
    }
    if (m.role === "climb" && target && asset && ladderProfile(asset)) {
      const plan = planLadder(
        p.root,
        p.heading!,
        e,
        target,
        asset,
        options.canClimb !== false,
      );
      const sample = sampleLadder(plan, (time - start) / clip.duration);
      const native = recorded();
      p.climb = sample;
      p.root = sample.root;
      p.heading = sample.heading;
      p.rotations = neutralRotations();
      if (time < end) {
        p.heading -= native?.startHeading ?? 0;
        return p;
      }
      start = end;
      continue;
    }
    p.climb = undefined;
    // An authored performance stopped part-way contributes only the travel
    // it completed before its stop.
    const native =
      m.kind === "imported"
        ? options.nativeRoot?.(
            m,
            clip.routeStop !== undefined
              ? { ...clip, duration: Math.min(clip.duration, clip.routeStop) }
              : clip,
          )
        : undefined;
    if (time >= end) {
      if (!seated && !clip.stationary && native) addRoot(native.delta);
      if (!clip.stationary) p.heading! += native?.heading || 0;
      start = end;
      continue;
    }
    if (!seated && native) addRoot(native.start.map((n) => -n) as Point);
    p.heading! -= native?.startHeading || 0;
    p.rotations = neutralRotations();
    return p;
  }
  return p;
}

/** The glTF loader names an untitled animation by its index. The import
 * service reports the same name so a saved motion finds its take later. */
export function untitledAnimationName(index: number) {
  return `animation_${index}`;
}

/** Display name for an imported take. Exporters name takes after the rig and
 * the tool ("Armature|mixamo.com|Layer0", "Take 001"), which says nothing
 * about the motion and repeats across files: such takes are listed under the
 * file's name. The take's own name stays the lookup key (`animationName`). */
export function importedTakeLabel(
  take: string,
  fileName: string,
  index: number,
  count: number,
) {
  const parts = take.split("|").map((part) => part.trim());
  // Blender prefixes the object ("Armature|…") and suffixes the FBX layer.
  if (parts.length > 1) parts.shift();
  if (parts.length > 1 && /^(base)?layer\s*\d*$/i.test(parts.at(-1)!))
    parts.pop();
  const label = parts.join(" ").trim();
  const generic =
    /^(|mixamo\.com|(default |unreal )?take\s*\d*|animation_\d+|anim(ation)?|action)$/i;
  if (!generic.test(label)) return label;
  return count > 1 ? `${fileName} ${index + 1}` : fileName;
}
