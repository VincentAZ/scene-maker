import { useEffect, useMemo, useState } from "react";
import * as T from "three";
import {
  allAssets,
  resolveMotionSource,
  type Asset,
  type Entity,
  type Motion,
  type Scene,
} from "../shared/scene";
import { loadImportedAsset } from "./importedAsset";
import { importedClip } from "./rig";
import {
  locomotionProfile,
  locomotionScale,
  routeEntryHeading,
} from "./locomotion";
import { createCharacter } from "./world";
import { routePace, type RouteGaitCycle } from "./routeLocomotion";

export type RouteGaitOverride = (motion: Motion) => RouteGaitCycle | undefined;
type GaitState = {
  status: "loading" | "ready" | "error";
  cycle?: RouteGaitCycle;
  error?: string;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Each measurement owns fresh parses, never viewport objects or clones. A
 * material/texture/geometry can be shared by many meshes within those parses;
 * release it once, including assets that finish loading after cancellation. */
function assetDisposer() {
  const objects = new Set<T.Group>();
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  const skeletons = new Set<T.Skeleton>();
  return (group: T.Group) => {
    if (objects.has(group)) return;
    objects.add(group);
    const mixer = group.userData.mixer as T.AnimationMixer | undefined;
    mixer?.stopAllAction();
    if (mixer) mixer.uncacheRoot(mixer.getRoot());
    const texture = (value: unknown) => {
      if (value instanceof T.Texture && !textures.has(value)) {
        textures.add(value);
        value.dispose();
      }
    };
    group.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      if (!geometries.has(node.geometry)) {
        geometries.add(node.geometry);
        node.geometry.dispose();
      }
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material]) {
        if (materials.has(material)) continue;
        materials.add(material);
        Object.values(material).forEach(texture);
        material.dispose();
      }
      if (node instanceof T.SkinnedMesh && !skeletons.has(node.skeleton)) {
        skeletons.add(node.skeleton);
        texture(node.skeleton.boneTexture);
        // Skeleton.dispose also disposes this texture; it is already released.
        node.skeleton.boneTexture = null;
        node.skeleton.dispose();
      }
    });
  };
}

/** Measure the selected source interval, never a route's movement duration. The
 * result is actor-local: PathEditor/planner apply the placed actor's scale once.
 * No scene or viewport pose is sampled or changed by this operation. */
export async function loadRouteGait(
  sourceAsset: Asset | undefined,
  actorAsset: Asset | undefined,
  animationName: string | undefined,
  signal?: AbortSignal,
  sourceRange?: { start: number; end: number },
  strideScale = 1,
): Promise<RouteGaitCycle> {
  if (!Number.isFinite(strideScale) || strideScale < 0.9 || strideScale > 1.1)
    throw Error("Captured step length must be between 90% and 110%.");
  if (!sourceAsset?.url || sourceAsset.category !== "characters")
    throw Error(
      "The original gait source is unavailable. Reimport it or choose another gait.",
    );
  if (!actorAsset || actorAsset.category !== "characters")
    throw Error(
      "The route character is unavailable. Reopen the route with a character.",
    );
  if (!animationName) throw Error("The original gait has no animation name.");
  signal?.throwIfAborted();
  const loaded = new Set<T.Group>();
  const dispose = assetDisposer();
  let closed = false;
  const cleanup = () => {
    closed = true;
    loaded.forEach(dispose);
    loaded.clear();
  };
  const own = (group: T.Group) => {
    if (closed) dispose(group);
    else loaded.add(group);
    signal?.throwIfAborted();
    return group;
  };
  signal?.addEventListener("abort", cleanup, { once: true });
  try {
    const sourcePending = loadImportedAsset(sourceAsset)
      .then(own)
      .catch((error) => {
        throw Error(
          `Could not load gait source “${sourceAsset.name}”: ${message(error)}`,
        );
      });
    const actorPending =
      sourceAsset.id === actorAsset.id
        ? sourcePending
        : (actorAsset.url
            ? loadImportedAsset(actorAsset)
            : Promise.resolve().then(() => createCharacter(actorAsset))
          )
            .then(own)
            .catch((error) => {
              throw Error(
                `Could not load route character “${actorAsset.name}”: ${message(error)}`,
              );
            });
    const [source, actor] = await Promise.all([sourcePending, actorPending]);
    signal?.throwIfAborted();
    const clip = importedClip(source.userData.animations || [], animationName);
    if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0)
      throw Error(
        `The original animation “${animationName}” is unavailable in ${sourceAsset.name}. Choose another gait or reimport its source.`,
      );
    const profile = locomotionProfile(source, clip, sourceRange);
    if (
      !profile ||
      !Number.isFinite(profile.distance) ||
      profile.distance < 0.15 ||
      profile.distance / profile.duration < 0.05
    )
      throw Error(
        "This take has no reliable locomotion stride. Choose a walking/running cycle; no procedural gait has been substituted.",
      );
    const ratio =
      (source === actor ? 1 : locomotionScale(source, actor)) * strideScale;
    if (!Number.isFinite(ratio) || ratio <= 0)
      throw Error(
        "The gait cannot be measured for this character's rig. Choose a compatible character or another gait.",
      );
    return {
      distance: profile.distance * ratio,
      duration: profile.duration,
      entryHeading: routeEntryHeading(profile),
      samples: profile.frames.map((frame) => ({
        time: frame.time,
        distance: frame.distance * ratio,
      })),
      ...((profile.loopProfile || profile).warning
        ? { warning: (profile.loopProfile || profile).warning }
        : {}),
    };
  } finally {
    signal?.removeEventListener("abort", cleanup);
    cleanup();
  }
}

/** An explicit override also disables loading (including when it returns no
 * cycle), so tests/embedders can supply measurements without network access. */
export function useRouteGait(
  scene: Scene,
  actor: Entity,
  motion: Motion,
  override?: RouteGaitOverride,
) {
  const sourceAsset = resolveMotionSource(scene, motion.sourceAssetId);
  const actorAsset = allAssets(scene).find(
    (asset) => asset.id === actor.assetId,
  );
  const imported = motion.kind === "imported";
  const animationName = motion.animationName;
  const sourceRange = motion.path?.sourceRange;
  const strideScale = motion.path?.strideScale;
  const [attempt, setAttempt] = useState(0);
  const enabled = imported && !override;
  const request = useMemo(
    () => ({
      sourceAsset,
      actorAsset,
      animationName,
      sourceRange,
      strideScale,
      enabled,
      attempt,
    }),
    [
      sourceAsset,
      actorAsset,
      animationName,
      sourceRange,
      strideScale,
      enabled,
      attempt,
    ],
  );
  const [result, setResult] = useState<{
    request: typeof request;
    state: GaitState;
  }>();
  useEffect(() => {
    if (!request.enabled) return;
    const controller = new AbortController();
    void loadRouteGait(
      request.sourceAsset,
      request.actorAsset,
      request.animationName,
      controller.signal,
      request.sourceRange,
      request.strideScale,
    ).then(
      (cycle) => {
        if (!controller.signal.aborted)
          setResult({ request, state: { status: "ready", cycle } });
      },
      (error) => {
        if (!controller.signal.aborted)
          setResult({
            request,
            state: { status: "error", error: message(error) },
          });
      },
    );
    return () => controller.abort();
  }, [request]);
  let state: GaitState;
  if (override) {
    try {
      const cycle = override(motion);
      // Validate the injected result just like production data. Never fall back
      // to a guessed imported pace when an override has no measurement.
      routePace(motion, 1, cycle);
      state = { status: "ready", cycle };
    } catch (error) {
      state = { status: "error", error: message(error) };
    }
  } else if (!imported) state = { status: "ready" };
  else
    state = result?.request === request ? result.state : { status: "loading" };
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}
