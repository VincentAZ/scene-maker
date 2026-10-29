import * as T from "three";
import {
  allAssets,
  allMotions,
  motionSchema,
  uid,
  type Scene,
  type Entity,
  type Motion,
} from "../shared/scene";
import { interactionSessions } from "../shared/interactions";
import { clearSegment, findRoute, type Footprint } from "../shared/navigation";
import {
  compilePath,
  worldToPath,
  pathToWorld,
  type PathFrame,
} from "../shared/path";
import type { Point } from "../shared/ladder";
import { applyAnimatedEntityPose } from "./world";
import { reachableGrip } from "./interactions";

export type RouteContext = {
  frame: PathFrame;
  footprints: Footprint[];
  time: number;
  radius: number;
};
function prefixOf(actor: Entity, beforeClipId?: string) {
  const index = beforeClipId
    ? actor.clips.findIndex((c) => c.id === beforeClipId)
    : actor.clips.length;
  if (index < 0) throw Error("This action is no longer in the sequence.");
  // The next action begins from the accumulated endpoint, not a held limb pose.
  return {
    ...actor,
    ending: "rest" as const,
    clips: actor.clips.slice(0, index),
  };
}
export function routeContext(
  scene: Scene,
  objects: Map<string, T.Group>,
  actorId: string,
  beforeClipId?: string,
): RouteContext {
  const actor = scene.entities.find((e) => e.id === actorId),
    rig = objects.get(actorId);
  if (
    !actor ||
    !rig ||
    !actor.visible ||
    allAssets(scene).find((a) => a.id === actor.assetId)?.category !==
      "characters"
  )
    throw Error("Choose a loaded character to plan a route.");
  const prefix = prefixOf(actor, beforeClipId),
    time = prefix.clips.reduce((sum, clip) => sum + clip.duration, 0);
  for (const entity of scene.entities) {
    const object = objects.get(entity.id);
    if (!object) throw Error("Wait for the scene objects to finish loading.");
    applyAnimatedEntityPose(
      object,
      entity.id === actorId ? prefix : entity,
      scene,
      time,
    );
    object.updateMatrixWorld(true);
  }
  const frame: PathFrame = {
    position: rig.position.toArray(),
    heading: rig.rotation.y,
    scale: actor.scale,
  };
  const footprints = scene.entities
    .filter((e) => e.id !== actorId && e.visible)
    .flatMap((entity) => {
      const object = objects.get(entity.id)!;
      const box = new T.Box3().setFromObject(object, true);
      if (
        box.isEmpty() ||
        box.max.y < frame.position[1] + 0.08 * actor.scale ||
        box.min.y > frame.position[1] + 1.9 * actor.scale
      )
        return [];
      return [
        {
          id: entity.id,
          name: entity.name,
          minX: box.min.x,
          maxX: box.max.x,
          minZ: box.min.z,
          maxZ: box.max.z,
        },
      ];
    });
  const bones = rig.userData.bones as Record<string, T.Bone> | undefined;
  const shoulderWidth =
    bones?.leftArm && bones.rightArm
      ? bones.leftArm
          .getWorldPosition(new T.Vector3())
          .distanceTo(bones.rightArm.getWorldPosition(new T.Vector3()))
      : 0.5 * actor.scale;
  return {
    frame,
    footprints,
    time,
    radius: Math.max(0.14 * actor.scale, shoulderWidth * 0.56),
  };
}
export function planObjectRoute(
  scene: Scene,
  objects: Map<string, T.Group>,
  actorId: string,
  targetId: string,
  kind: "walk" | "run",
  beforeClipId?: string,
): Motion {
  const target = scene.entities.find((e) => e.id === targetId),
    actor = scene.entities.find((e) => e.id === actorId);
  if (!actor || !target || actorId === targetId || !target.visible)
    throw Error("Choose another visible object as the destination.");
  if (target.clips.length)
    throw Error(
      `Finish staging ${target.name} as a still destination before planning a route.`,
    );
  const { frame, footprints, time, radius } = routeContext(
    scene,
    objects,
    actorId,
    beforeClipId,
  );
  const rig = objects.get(actorId)!,
    prop = objects.get(targetId)!;
  const asset = allAssets(scene).find((a) => a.id === target.assetId)!;
  const box = new T.Box3().setFromObject(prop, true),
    size = box.getSize(new T.Vector3());
  if (box.isEmpty()) throw Error("This destination has no visible geometry.");
  const smallProp =
    asset.category === "props" &&
    Math.max(size.x, size.z) < 0.7 * actor.scale &&
    size.y < 0.8 * actor.scale;
  const grip = new T.Vector3(
    ...(asset.grip ||
      ((asset.style === "cup" ? [0.13, 0.08, 0] : [0, 0.1, 0]) as Point)),
  );
  const destination = smallProp
    ? prop.localToWorld(grip)
    : box.getCenter(new T.Vector3());
  const clearance = radius + 0.04 * actor.scale;
  const obstacles = footprints.map((p) => ({
    ...p,
    minX: p.minX - clearance,
    maxX: p.maxX + clearance,
    minZ: p.minZ - clearance,
    maxZ: p.maxZ + clearance,
  }));
  const candidates: Point[] = [];
  const halfX = size.x / 2,
    halfZ = size.z / 2;
  for (let i = 0; i < 32; i++) {
    const angle = (i * Math.PI) / 16,
      dx = Math.sin(angle),
      dz = Math.cos(angle);
    const near =
      Math.min(
        Math.abs(dx) < 1e-8 ? Infinity : halfX / Math.abs(dx),
        Math.abs(dz) < 1e-8 ? Infinity : halfZ / Math.abs(dz),
      ) +
      clearance +
      0.06 * actor.scale;
    for (const distance of smallProp
      ? [0.22, 0.28, 0.34, 0.38, 0.5, 0.65, 0.8].map((n) => n * actor.scale)
      : [near]) {
      const point: Point = [
        destination.x + dx * distance,
        frame.position[1],
        destination.z + dz * distance,
      ];
      if (smallProp) {
        const neutral = {
          ...actor,
          position: point,
          rotation: Math.atan2(
            destination.x - point[0],
            destination.z - point[2],
          ),
          clips: [],
        };
        applyAnimatedEntityPose(rig, neutral, scene, 0);
        rig.updateMatrixWorld(true);
        if (!reachableGrip(rig, neutral, destination)) continue;
      }
      candidates.push(point);
    }
  }
  if (!candidates.length)
    throw Error(
      `${actor.name} cannot reach ${target.name} from this floor height. Lower the prop or resize the staging.`,
    );
  const route = findRoute(frame.position, candidates, obstacles);
  if (route.length > 32)
    throw Error(
      "This route has too many turns. Open a simpler passage and try again.",
    );
  if (
    Math.hypot(
      route.at(-1)![0] - frame.position[0],
      route.at(-1)![2] - frame.position[2],
    ) <
    0.05 * actor.scale
  )
    throw Error(
      `${actor.name} is already beside ${target.name}. Add the next action directly.`,
    );
  const points = route.map((point) => worldToPath(point, frame));
  const last = route.at(-1)!;
  const turn =
    Math.atan2(destination.x - last[0], destination.z - last[2]) -
    frame.heading;
  const endHeading = Math.atan2(Math.sin(turn), Math.cos(turn));
  let path = { points, smooth: true, endHeading };
  const samples = compilePath(path).samples.map((s) =>
    pathToWorld(s.point, frame),
  );
  if (
    samples.some(
      (point, i) => i > 0 && !clearSegment(samples[i - 1], point, obstacles),
    )
  )
    path = { ...path, smooth: false };
  const length = compilePath(path).length * frame.scale;
  const duration = Math.max(
    0.5,
    Math.round((length / (kind === "run" ? 2.6 : 1.1)) * 10) / 10,
  );
  if (duration > 60)
    throw Error(
      "This destination is too far for one action. Add an intermediate stop.",
    );
  if (
    interactionSessions(scene, allMotions(scene)).some(
      (session) =>
        session.targetId === targetId &&
        session.acquire.start <= time + duration &&
        session.end > time + duration,
    )
  )
    throw Error(`Put down ${target.name} before this character arrives.`);
  const parsed = motionSchema.safeParse({
    id: "route-" + uid(),
    name: `${kind === "run" ? "Run" : "Walk"} to ${target.name}`.slice(0, 100),
    kind,
    duration,
    distance: 0,
    poses: [],
    path,
  });
  if (!parsed.success)
    throw Error(
      "This route needs tighter turns or a longer distance than one action can handle. Move a prop or add an intermediate stop.",
    );
  return parsed.data;
}
