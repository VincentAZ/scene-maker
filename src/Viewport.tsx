import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as T from "three";
import { createPlaybackClock } from "./playbackClock";
import { applyConversationPerformance } from "./conversationPerformance";
import { dialogueAt } from "../shared/conversation";
import { sceneDragging } from "./sceneDragging";
import { gizmoEditing } from "./gizmoEditing";
import {
  sceneObstacles,
  sceneCollisionWarning,
  interactionPairs,
  type TransformMode,
} from "./assetManipulation";
import { visibleEntity, type Position } from "./placement";
import type { Asset, Entity } from "../shared/scene";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { exportSnapshot } from "./exportSnapshot";
import { cinemaFov, frameGuide } from "./sceneRecorder";
import { animationSampleBoundaries, bakeAnimation } from "./bakeAnimation";
import { applyInteractions } from "./interactions";
import {
  hasAutomaticRoutes,
  holdBlockedRoutes,
  prepareAutomaticRoutesAsync,
  type PreparedRoutes,
} from "./automaticRoutes";
import { configureRigContacts } from "./ik";
import { movingObstacleIds } from "./routeClearance";
import { setMotionSources } from "./rig";
import {
  loadImportedAsset,
  planningMotionSources,
  loadPlanningMotionSources,
  prepareLoaders,
} from "./importedAsset";
import { EnvironmentModel, environmentModelKey } from "./environmentModel";
import {
  backdropHome,
  keepInsideBackdrop,
  ORBIT_MAX_POLAR,
  loadPhotoSet,
  PhotoSet,
} from "./hdriBackdrop";
import { loadSetLight, ModelSet, setHome } from "./modelSet";
import { applyStageLighting, type StageView } from "./stageLighting";
import { libraryEntry } from "../shared/characterLibrary";
import type { SeatBody } from "../shared/seating";
import type { PathFrame } from "../shared/path";
import {
  routeContext,
  planObjectRoute,
  type RouteContext,
} from "./routePlanner";
import type { Motion } from "../shared/scene";
import { interactionSessions, type HoldSession } from "../shared/interactions";
import { type Scene, allAssets, allMotions, duration } from "../shared/scene";
import {
  createCharacter,
  createProp,
  applyAnimatedEntityPose,
  disposeObject,
} from "./world";
export type ViewportHandle = {
  startAssetDrag: (asset: Asset, event: PointerEvent) => void;
  suppressAssetClick: () => boolean;
  seatingBody: (actorId: string) => SeatBody | undefined;
  screenshot: () => void;
  /**
   * Start the film camera: a separate width × height render of the preview
   * view without editor helpers. Returns its canvas for recording.
   */
  startCinema: (width: number, height: number) => HTMLCanvasElement | null;
  stopCinema: () => void;
  /** Called after every rendered frame while set (for recordings). */
  onFrame: (listener: ((time: number) => void) | null) => void;
  exportGLB: () => Promise<ArrayBuffer>;
  prepareNavigation: () => Scene;
  reset: () => void;
  frame: (
    view: "default" | "front" | "side" | "top" | "conversation",
    focusId?: string,
    atTime?: number,
  ) => void;
  waitForScene: (scene: Scene, signal?: AbortSignal) => Promise<void>;
  sequenceOrigin: (actorId: string, beforeClipId?: string) => PathFrame;
  routeContext: (actorId: string, beforeClipId?: string) => RouteContext;
  /** Would a body standing here touch the loaded 3D set's furniture? */
  floorBlocked: (x: number, z: number) => boolean;
  planRoute: (
    actorId: string,
    targetId: string,
    kind: "walk" | "run",
    beforeClipId?: string,
    locomotion?: Motion,
    measuredCycle?: { distance: number; duration: number },
    automatic?: boolean,
  ) => Motion;
};
type Props = {
  scene: Scene;
  selected: string | null;
  onSelect: (id: string | null) => void;
  time: number;
  playing: boolean;
  seekVersion: number;
  onTime: (t: number, seekVersion: number) => void;
  onMove: (id: string, position: [number, number, number]) => void;
  onTransform?: (
    id: string,
    changes: Pick<Entity, "position" | "rotation" | "scale">,
  ) => void;
  transformMode?: TransformMode;
  onAdd?: (assetId: string, position: Position) => void;
  onEditStart?: () => void;
  onError: (text: string) => void;
  onInteractionWarning: (text: string) => void;
  onNavigationResolved?: (expected: Scene, next: Scene) => void;
  onNavigationPending?: () => void;
  /** Planning finished (with or without changes/issues) for the current scene. */
  onNavigationSettled?: () => void;
  move: boolean;
  loopDuration?: number;
  /** Keep a rehearsal actor in view while retaining the chosen orbit/zoom. */
  followActorId?: string;
  thinkingId?: string;
  advanceTime?: (time: number, delta: number) => number;
  onPlaybackState?: (state: "seek" | "pause" | "play") => void;
  stopAtEnd?: boolean;
  onEnded?: () => void;
};
// Identity of one entity's 3D model. Only these inputs rebuild its object;
// imported files ignore color because their materials come from the file.
const entityModelKey = (
  scene: Scene,
  entity: Entity,
  assets: Map<string, Asset>,
) => {
  const asset = assets.get(entity.assetId);
  return JSON.stringify([
    entity.assetId,
    asset?.url ? null : entity.color,
    asset,
    planningMotionSources(scene, entity),
  ]);
};
const assetIndex = (scene: Scene) =>
  new Map(allAssets(scene).map((a) => [a.id, a]));
const modelKey = (scene: Scene) => {
  const assets = assetIndex(scene);
  return JSON.stringify([
    environmentModelKey(scene),
    scene.lighting,
    scene.entities.map((e) => [e.id, entityModelKey(scene, e, assets)]),
  ]);
};
type PendingModel = { key: string };
const stateKey = (scene: Scene) => JSON.stringify({ ...scene, revision: 0 });
/** The home view of what is shown: the photographer's spot in a photographic
 * set, a 3D set's authored camera, or the studio's default. */
const stageHome = (view: StageView) =>
  view instanceof PhotoSet
    ? backdropHome(view.backdrop)
    : view instanceof ModelSet
      ? setHome(view.set)
      : {
          position: new T.Vector3(8, 6.5, 10),
          target: new T.Vector3(0, 0.85, -0.5),
          maxDistance: 25,
        };
export const Viewport = forwardRef<ViewportHandle, Props>(
  function Viewport(props, ref) {
    const host = useRef<HTMLDivElement>(null),
      live = useRef(props);
    live.current = props;
    const readyKey = useRef("");
    const frameListener = useRef<((time: number) => void) | null>(null);
    const requestedModelKey = modelKey(props.scene);
    const context = useRef<{
      renderer: T.WebGLRenderer;
      world: T.Scene;
      camera: T.PerspectiveCamera;
      controls: OrbitControls;
      objects: Map<string, T.Group>;
      content: T.Group;
      transform: TransformControls;
      renderAt: (t: number) => void;
      prepareNavigation: () => PreparedRoutes;
      navigationMatches: (scene: Scene) => boolean;
      navigationPending: () => boolean;
      startCinema: (width: number, height: number) => HTMLCanvasElement | null;
      stopCinema: () => void;
      dragging: ReturnType<typeof sceneDragging>;
      editing: ReturnType<typeof gizmoEditing>;
      // Incremental model state: what is placed, what is loading, and the
      // original imported files shared as motion sources.
      environment: EnvironmentModel;
      placedKeys: Map<string, string>;
      pending: Map<string, PendingModel>;
      sources: Map<string, Promise<T.Group>>;
      currentKey: string;
    } | null>(null);
    useEffect(() => {
      if (!host.current) return;
      const world = new T.Scene();
      world.background = new T.Color("#d8d4c7");
      world.fog = new T.Fog("#d8d4c7", 19, 38);
      let renderer: T.WebGLRenderer;
      try {
        renderer = new T.WebGLRenderer({
          antialias: true,
          preserveDrawingBuffer: true,
        });
      } catch {
        live.current.onError(
          "Your browser could not start the 3D view. Enable hardware acceleration and reload.",
        );
        return;
      }
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      prepareLoaders(renderer);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      host.current.appendChild(renderer.domElement);
      renderer.domElement.setAttribute("aria-label", "Interactive 3D scene");
      const bubbleLayer = document.createElement("div");
      bubbleLayer.className = "scene-bubble-layer";
      bubbleLayer.setAttribute("aria-label", "In-scene conversation");
      host.current.appendChild(bubbleLayer);
      const bubbles = new Map<string, HTMLDivElement>();
      const projectBubbles = (time: number) => {
        const lines = dialogueAt(live.current.scene, time).map((l) => ({
          id: l.characterId,
          name: l.name,
          text: l.text,
          thought: false,
        }));
        const thinker = live.current.scene.entities.find(
          (e) => e.id === live.current.thinkingId && e.visible,
        );
        if (thinker && !lines.some((l) => l.id === thinker.id))
          lines.push({
            id: thinker.id,
            name: thinker.name,
            text: "Thinking…",
            thought: true,
          });
        for (const [id, bubble] of bubbles)
          if (!lines.some((l) => l.id === id)) {
            bubble.remove();
            bubbles.delete(id);
          }
        for (const line of lines) {
          const object = objects.get(line.id);
          if (!object?.visible) continue;
          let bubble = bubbles.get(line.id);
          if (!bubble) {
            bubble = document.createElement("div");
            bubbleLayer.appendChild(bubble);
            bubbles.set(line.id, bubble);
          }
          const key = `${line.name}:${line.text}:${line.thought}`;
          if (bubble.dataset.content !== key) {
            bubble.dataset.content = key;
            bubble.className = `scene-bubble${line.thought ? " thought" : ""}`;
            const name = document.createElement("strong");
            name.textContent = line.name;
            const words = document.createElement("span");
            words.textContent = line.text;
            bubble.replaceChildren(name, words);
          }
          const head = object.userData.bones?.head as T.Object3D | undefined;
          const anchor = head
            ? head.getWorldPosition(new T.Vector3())
            : object
                .getWorldPosition(new T.Vector3())
                .add(new T.Vector3(0, 1.8, 0));
          anchor.y += 0.38;
          anchor.project(camera);
          const width = renderer.domElement.clientWidth,
            height = renderer.domElement.clientHeight;
          bubble.hidden =
            anchor.z < -1 ||
            anchor.z > 1 ||
            Math.abs(anchor.x) > 1.2 ||
            Math.abs(anchor.y) > 1.3;
          bubble.style.left = `${Math.max(bubble.offsetWidth / 2 + 8, Math.min(width - bubble.offsetWidth / 2 - 8, (anchor.x * 0.5 + 0.5) * width))}px`;
          bubble.style.top = `${Math.max(bubble.offsetHeight + 12, Math.min(height - 28, (-anchor.y * 0.5 + 0.5) * height))}px`;
        }
      };
      const camera = new T.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(8, 6.5, 10);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0.85, -0.5);
      controls.enableDamping = true;
      controls.maxPolarAngle = ORBIT_MAX_POLAR;
      controls.minDistance = 2;
      controls.maxDistance = 25;
      const content = new T.Group();
      content.name = "SceneMaker";
      world.add(content);
      world.add(new T.HemisphereLight("#fff4da", "#747e69", 2.4));
      const sun = new T.DirectionalLight("#fff0ce", 4);
      sun.position.set(-3, 8, 4);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, {
        left: -9,
        right: 9,
        top: 9,
        bottom: -9,
        near: 0.1,
        far: 30,
      });
      sun.shadow.bias = -0.001;
      world.add(sun);
      const transform = new TransformControls(camera, renderer.domElement);
      transform.setMode("translate");
      transform.setSize(0.7);
      world.add(transform.getHelper());
      // Keep selection visible even when the move tool is hidden.
      const selection = new T.BoxHelper(new T.Group(), 0xd9f279);
      selection.material.depthTest = false;
      selection.material.transparent = true;
      selection.material.opacity = 0.95;
      selection.renderOrder = 1000;
      selection.visible = false;
      world.add(selection);
      const objects = new Map<string, T.Group>();
      const status = document.createElement("div");
      status.className = "placement-status";
      status.setAttribute("role", "status");
      status.hidden = true;
      host.current.appendChild(status);
      const loading = document.createElement("div");
      loading.className = "set-loading";
      loading.setAttribute("role", "status");
      loading.hidden = true;
      host.current.appendChild(loading);
      const editing = gizmoEditing({
        transform,
        objects,
        current: () => live.current,
        orbit: controls,
        status,
        environment: () => context.current?.environment.root ?? null,
        canvas: renderer.domElement,
      });
      const dragging = sceneDragging({
        canvas: renderer.domElement,
        camera,
        world,
        objects,
        current: () => live.current,
        orbit: controls,
        gizmo: transform,
        status,
        environment: () => context.current?.environment.root ?? null,
      });
      let sessionScene: Scene | null = null,
        sessions: HoldSession[] = [],
        interactionWarning = "",
        lastWarning = "",
        collisionWarning = "",
        lastCollisionCheck = -Infinity;
      let navigationInput = "",
        navigationOutput = "",
        navigation: PreparedRoutes | undefined;
      let navigationJob: AbortController | undefined;
      const pendingNavigation = (
        scene: Scene,
        message: string,
      ): PreparedRoutes => {
        const issues = scene.entities
          .filter((e) => e.visible)
          .flatMap((e) =>
            e.clips
              .filter((c) => c.navigation)
              .slice(0, 1)
              .map((c) => ({
                actorId: e.id,
                clipId: c.id,
                message: `${e.name}: ${message}`,
              })),
          );
        return {
          scene,
          playbackScene: holdBlockedRoutes(scene, issues, live.current.time),
          issues,
        };
      };
      const prepareNavigation = (): PreparedRoutes => {
        const scene = live.current.scene;
        if (!hasAutomaticRoutes(scene)) {
          navigationJob?.abort();
          navigationJob = undefined;
          navigation = undefined;
          return { scene, playbackScene: scene, issues: [] };
        }
        const key = stateKey(scene);
        if (
          readyKey.current !== modelKey(scene) ||
          objects.size !== scene.entities.length
        ) {
          navigationJob?.abort();
          navigationJob = undefined;
          navigation = undefined;
          return pendingNavigation(
            scene,
            "Loading geometry to plan the route.",
          );
        }
        if (
          navigation &&
          (key === navigationInput || key === navigationOutput)
        ) {
          if (navigationJob && live.current.playing)
            live.current.onNavigationPending?.();
          return navigation;
        }
        navigationJob?.abort();
        const job = new AbortController();
        navigationJob = job;
        let yields = 0,
          yieldMs = 0;
        navigation = pendingNavigation(scene, "Planning a clear route…");
        navigationInput = key;
        navigationOutput = "";
        live.current.onNavigationPending?.();
        void prepareAutomaticRoutesAsync(
          scene,
          objects,
          context.current?.environment.root,
          {
            signal: job.signal,
            at: live.current.time,
            onYield: () => {
              if (!job.signal.aborted) {
                const t0 = performance.now();
                context.current?.renderAt(live.current.time);
                yieldMs += performance.now() - t0;
                if (++yields % 50 === 0)
                  console.log(
                    "NAVDBG yields",
                    yields,
                    "renderMs",
                    +yieldMs.toFixed(0),
                  );
              }
            },
          },
        )
          .then((result) => {
            if (
              job.signal.aborted ||
              navigationJob !== job ||
              stateKey(live.current.scene) !== key
            )
              return;
            navigationJob = undefined;
            navigation = result;
            navigationOutput = stateKey(result.scene);
            if (result.scene !== scene)
              live.current.onNavigationResolved?.(scene, result.scene);
            // A paused viewport renders nothing on its own: show the settled
            // plan (or an unchanged route) and its status now.
            context.current?.renderAt(live.current.time);
            live.current.onNavigationSettled?.();
          })
          .catch((error: unknown) => {
            if (
              job.signal.aborted ||
              navigationJob !== job ||
              stateKey(live.current.scene) !== key
            )
              return;
            navigationJob = undefined;
            navigation = pendingNavigation(
              scene,
              error instanceof Error ? error.message : String(error),
            );
            navigationOutput = key;
            context.current?.renderAt(live.current.time);
            live.current.onNavigationSettled?.();
          });
        return navigation;
      };
      const renderAt = (time: number) => {
        const prepared = prepareNavigation(),
          playbackScene = prepared.playbackScene;
        if (sessionScene !== playbackScene) {
          sessionScene = playbackScene;
          sessions = interactionSessions(
            sessionScene,
            allMotions(sessionScene),
          );
        }
        for (const e of playbackScene.entities) {
          const obj = objects.get(e.id);
          if (obj) {
            applyAnimatedEntityPose(obj, e, playbackScene, time);
          }
        }
        applyConversationPerformance(playbackScene, time, objects);
        content.updateMatrixWorld(true);
        const interactionMessages = applyInteractions(
          playbackScene,
          time,
          objects,
          sessions,
        ).map((w) => w.message);
        editing.render();
        dragging.render();
        const selectedObject = live.current.selected
          ? objects.get(live.current.selected)
          : undefined;
        selection.visible =
          !!selectedObject && selectedObject.visible && !live.current.playing;
        if (selection.visible && selectedObject) {
          selectedObject.updateWorldMatrix(true, true);
          selection.setFromObject(selectedObject);
        }
        transform.getHelper().visible =
          !!transform.object?.visible && !live.current.playing;
        // Geometry bounds for imported skins can be expensive; throttle diagnostics,
        // never the collision checks for active edit gestures.
        const now = performance.now();
        if (live.current.scene.animationCollisions === false) {
          collisionWarning = "";
          lastCollisionCheck = -Infinity;
        } else if (
          now - lastCollisionCheck > 180 &&
          !transform.dragging &&
          !dragging.active()
        ) {
          lastCollisionCheck = now;
          collisionWarning = sceneCollisionWarning(
            sceneObstacles(
              live.current.scene,
              objects,
              undefined,
              context.current?.environment.root,
            ),
            interactionPairs(live.current.scene),
          );
        }
        interactionWarning = [
          ...prepared.issues.map((issue) => issue.message),
          collisionWarning,
          ...interactionMessages,
          ...Array.from(objects.values(), (object) =>
            [object.userData.motionWarning, object.userData.motionNotice]
              .filter(Boolean)
              .join(" "),
          ),
        ]
          .filter(Boolean)
          .slice(0, 2)
          .join(" ");
      };
      // Film camera for recordings: its own renderer at a fixed 16:9 size,
      // following the preview camera, with editor helpers hidden.
      let cinema: {
        renderer: T.WebGLRenderer;
        camera: T.PerspectiveCamera;
      } | null = null;
      const guide = document.createElement("div");
      guide.className = "cinema-guide";
      guide.hidden = true;
      guide.setAttribute("aria-hidden", "true");
      host.current.appendChild(guide);
      const placeGuide = () => {
        if (!cinema) return;
        const box = frameGuide(
          renderer.domElement.clientWidth,
          renderer.domElement.clientHeight,
          cinema.camera.aspect,
        );
        Object.assign(guide.style, {
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
        });
      };
      const startCinema = (width: number, height: number) => {
        if (cinema) return cinema.renderer.domElement;
        let film: T.WebGLRenderer;
        try {
          film = new T.WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true,
          });
        } catch {
          return null;
        }
        film.setPixelRatio(1);
        film.setSize(width, height, false);
        film.shadowMap.enabled = true;
        film.shadowMap.type = T.PCFSoftShadowMap;
        film.outputColorSpace = T.SRGBColorSpace;
        film.toneMapping = T.ACESFilmicToneMapping;
        cinema = {
          renderer: film,
          camera: new T.PerspectiveCamera(camera.fov, width / height, 0.1, 100),
        };
        guide.hidden = false;
        placeGuide();
        return film.domElement;
      };
      const stopCinema = () => {
        if (!cinema) return;
        cinema.renderer.dispose();
        cinema.renderer.forceContextLoss();
        cinema = null;
        guide.hidden = true;
      };
      const renderCinema = () => {
        if (!cinema) return;
        const film = cinema.camera;
        film.position.copy(camera.position);
        film.quaternion.copy(camera.quaternion);
        film.near = camera.near;
        film.far = camera.far;
        film.fov = cinemaFov(camera.fov, camera.aspect, film.aspect);
        film.updateProjectionMatrix();
        // Only the scene content and its lights belong in the film.
        const hidden: T.Object3D[] = [];
        for (const child of world.children)
          if (
            child !== content &&
            !(child instanceof T.Light) &&
            !child.userData.film &&
            child.visible
          ) {
            child.visible = false;
            hidden.push(child);
          }
        cinema.renderer.toneMappingExposure = renderer.toneMappingExposure;
        try {
          cinema.renderer.render(world, film);
        } finally {
          for (const child of hidden) child.visible = true;
        }
      };
      context.current = {
        startCinema,
        stopCinema,
        renderer,
        world,
        camera,
        controls,
        objects,
        content,
        transform,
        renderAt,
        prepareNavigation,
        navigationMatches: (scene) =>
          stateKey(scene) === navigationInput &&
          stateKey(live.current.scene) === navigationOutput,
        navigationPending: () => !!navigationJob,
        dragging,
        editing,
        environment: new EnvironmentModel(content, undefined, {
          load: (asset) => loadPhotoSet(asset, renderer),
          light: loadSetLight,
          progress: (state) => {
            loading.hidden = !state;
            if (state)
              loading.textContent = state.total
                ? `Loading the set… ${Math.min(100, Math.round((state.received / state.total) * 100))} %`
                : `Loading the set… ${Math.round(state.received / 1048576)} MB`;
          },
          // A set replaces the stage around the cast and opens at its own
          // home view: eye level inside a photographed place, or where a 3D
          // set's author framed it.
          show: (view) => {
            const previous = world.getObjectByName("SceneMakerBackdrop");
            if (previous) world.remove(previous);
            if (view instanceof PhotoSet) world.add(view.group);
            applyStageLighting(
              world,
              renderer,
              live.current.scene.lighting,
              view,
            );
            // Spend any orbit inertia first so it cannot turn the new view.
            controls.enableDamping = false;
            controls.update();
            controls.enableDamping = true;
            const home = stageHome(view);
            camera.position.copy(home.position);
            controls.target.copy(home.target);
            controls.maxDistance = home.maxDistance;
            // Only a photo holds the camera near where it was taken; a 3D set
            // is seen from every side, down to the floor like the studio.
            const photo =
              view instanceof PhotoSet ? backdropHome(view.backdrop) : null;
            controls.minAzimuthAngle = photo ? -photo.azimuth : -Infinity;
            controls.maxAzimuthAngle = photo ? photo.azimuth : Infinity;
            controls.minPolarAngle = photo ? photo.minPolar : 0;
            controls.update();
          },
        }),
        placedKeys: new Map(),
        pending: new Map(),
        sources: new Map(),
        currentKey: "",
      };
      const resize = new ResizeObserver(() => {
        if (!host.current) return;
        const { width, height } = host.current.getBoundingClientRect();
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        placeGuide();
      });
      resize.observe(host.current);
      let pointer = [0, 0];
      const down = (e: PointerEvent) => {
        pointer = [e.clientX, e.clientY];
      };
      const up = (e: PointerEvent) => {
        if (
          Math.hypot(e.clientX - pointer[0], e.clientY - pointer[1]) > 5 ||
          transform.axis ||
          dragging.suppressClick()
        )
          return;
        const rect = renderer.domElement.getBoundingClientRect();
        const ray = new T.Raycaster();
        ray.setFromCamera(
          new T.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            (-(e.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        );
        const hits = ray
          .intersectObjects([...objects.values()], true)
          .filter((hit) => visibleEntity(hit.object));
        if (hits.length) {
          let o: T.Object3D | null = hits[0].object;
          while (o && !o.userData.entityId) o = o.parent;
          if (o) live.current.onSelect(o.userData.entityId);
        } else live.current.onSelect(null);
      };
      renderer.domElement.addEventListener("pointerdown", down);
      renderer.domElement.addEventListener("pointerup", up);
      let frame = 0;
      const clock = createPlaybackClock(
        live.current.time,
        performance.now(),
        live.current.seekVersion,
      );
      let paintedNavigation: AbortController | undefined,
        navigationView = "";
      let followedActor: T.Group | undefined;
      const followedPosition = new T.Vector3();
      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        const total =
          live.current.loopDuration ??
          (live.current.stopAtEnd
            ? Math.max(
                0,
                ...live.current.scene.entities.map((e) =>
                  e.clips.reduce((t, c) => t + c.duration, 0),
                ),
              )
            : duration(live.current.scene));
        const sample = clock.sample({
          now,
          time: live.current.time,
          seekVersion: live.current.seekVersion,
          playing: live.current.playing,
          blocked: dragging.active() || transform.dragging,
          duration: total,
          stopAtEnd: live.current.stopAtEnd,
          advance: live.current.advanceTime,
          onState: live.current.onPlaybackState,
          onEnded: live.current.onEnded,
        });
        const elapsed = sample.time;
        if (sample.publish) live.current.onTime(elapsed, sample.seekVersion);
        renderAt(elapsed);
        const following = live.current.followActorId
          ? objects.get(live.current.followActorId)
          : undefined;
        if (following) {
          const anchor = (
            following.userData.bones?.hips ?? following
          ).getWorldPosition(new T.Vector3());
          if (following === followedActor) {
            const delta = anchor.clone().sub(followedPosition);
            // Follow travel across the floor; keep the performance’s vertical
            // rise and fall visible rather than cancelling it with the camera.
            delta.y = 0;
            camera.position.add(delta);
            controls.target.add(delta);
          }
          followedPosition.copy(anchor);
        }
        followedActor = following;
        if (interactionWarning !== lastWarning) {
          lastWarning = interactionWarning;
          live.current.onInteractionWarning(interactionWarning);
        }
        if (controls.enabled) controls.update();
        const photo = context.current?.environment.photo;
        if (photo) {
          // The orbit limits keep the camera inside the photo by themselves;
          // should anything else have placed it outside, bring it back without
          // changing the distance to the cast or where it looks.
          const before = camera.position.clone();
          if (keepInsideBackdrop(camera.position, photo.backdrop)) {
            controls.target.add(camera.position.clone().sub(before));
            camera.lookAt(controls.target);
          }
        }
        // The paused preview stays identical between planning batches. Avoid
        // competing GPU draws while computing, but redraw staging, selection,
        // scrubbing, resizing and camera gestures immediately.
        const view = navigationJob
          ? JSON.stringify([
              elapsed,
              live.current.selected,
              live.current.move,
              live.current.transformMode,
              camera.position.toArray(),
              camera.quaternion.toArray(),
              camera.fov,
              camera.zoom,
              camera.aspect,
              renderer.domElement.width,
              renderer.domElement.height,
              transform.axis,
            ])
          : "";
        const draw =
          !navigationJob ||
          transform.dragging ||
          dragging.active() ||
          navigationJob !== paintedNavigation ||
          view !== navigationView;
        if (draw) {
          renderer.render(world, camera);
          renderCinema();
          paintedNavigation = navigationJob;
          navigationView = view;
        }
        projectBubbles(elapsed);
        frameListener.current?.(elapsed);
      };
      frame = requestAnimationFrame(loop);
      return () => {
        navigationJob?.abort();
        cancelAnimationFrame(frame);
        bubbleLayer.remove();
        stopCinema();
        guide.remove();
        resize.disconnect();
        dragging.dispose();
        editing.dispose();
        status.remove();
        loading.remove();
        renderer.domElement.removeEventListener("pointerdown", down);
        renderer.domElement.removeEventListener("pointerup", up);
        selection.geometry.dispose();
        selection.material.dispose();
        transform.dispose();
        controls.dispose();
        const ctx = context.current;
        if (ctx) {
          ctx.environment.dispose();
          ctx.pending.clear();
          for (const source of ctx.sources.values())
            source.then(disposeObject, () => {});
          ctx.sources.clear();
        }
        disposeObject(content);
        renderer.dispose();
        renderer.domElement.remove();
        context.current = null;
      };
    }, []);
    useEffect(() => {
      const ctx = context.current;
      if (!ctx) return;
      const scene = props.scene;
      const assets = assetIndex(scene);
      const wanted = new Map(
        scene.entities.map((e) => [e.id, entityModelKey(scene, e, assets)]),
      );
      ctx.currentKey = requestedModelKey;
      readyKey.current = "";
      // Original imported files used as shared motion sources live for the
      // viewport's lifetime; a failed load is forgotten so it can be retried.
      const original = (asset: Asset) => {
        const key = JSON.stringify([asset.id, asset.url, asset.rigMapping]);
        let pending = ctx.sources.get(key);
        if (!pending) {
          pending = loadImportedAsset(asset);
          pending.catch(() => {
            if (ctx.sources.get(key) === pending) ctx.sources.delete(key);
          });
          ctx.sources.set(key, pending);
        }
        return pending;
      };
      const settle = () => {
        if (
          context.current === ctx &&
          !ctx.pending.size &&
          ctx.environment.ready
        )
          readyKey.current = ctx.currentKey;
      };
      applyStageLighting(
        ctx.world,
        ctx.renderer,
        props.scene.lighting,
        ctx.environment.view,
      );
      // Remove objects whose entity left or whose model inputs changed; keep
      // the rest so a color or asset edit never rebuilds the whole cast.
      for (const [id, obj] of [...ctx.objects]) {
        if (wanted.get(id) === ctx.placedKeys.get(id)) continue;
        if (ctx.transform.object === obj) ctx.transform.detach();
        ctx.content.remove(obj);
        disposeObject(obj);
        ctx.objects.delete(id);
        ctx.placedKeys.delete(id);
      }
      for (const [id, job] of [...ctx.pending])
        if (wanted.get(id) !== job.key) ctx.pending.delete(id);
      const setup = async (obj: T.Group, entity: Entity, job: PendingModel) => {
        const stale = () => ctx.pending.get(entity.id) !== job;
        try {
          setMotionSources(
            obj,
            await loadPlanningMotionSources(scene, entity, original),
          );
        } catch (error) {
          disposeObject(obj);
          if (!stale()) {
            ctx.pending.delete(entity.id);
            live.current.onError(
              error instanceof Error
                ? error.message
                : "Could not load the original action.",
            );
            settle();
          }
          return;
        }
        if (stale()) {
          disposeObject(obj);
          return;
        }
        ctx.pending.delete(entity.id);
        obj.name = "entity_" + entity.id;
        configureRigContacts(obj);
        obj.userData.entityId = entity.id;
        obj.traverse((o) => {
          if (o instanceof T.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        ctx.objects.set(entity.id, obj);
        ctx.placedKeys.set(entity.id, job.key);
        ctx.content.add(obj);
        if (live.current.move && live.current.selected === entity.id)
          ctx.transform.attach(obj);
        settle();
      };
      for (const e of scene.entities) {
        if (ctx.objects.has(e.id) || ctx.pending.has(e.id)) continue;
        const a = assets.get(e.assetId);
        if (!a) continue;
        const job: PendingModel = { key: wanted.get(e.id)! };
        ctx.pending.set(e.id, job);
        if (a.url) {
          loadImportedAsset(a).then(
            (obj) => setup(obj, e, job),
            () => {
              if (ctx.pending.get(e.id) !== job) return;
              ctx.pending.delete(e.id);
              live.current.onError(
                libraryEntry(a)
                  ? `Could not load ${e.name}. Try reloading the studio.`
                  : `Could not load ${e.name}. Reload the studio or reimport the asset.`,
              );
              settle();
            },
          );
        } else
          void setup(
            a.category === "characters"
              ? createCharacter(a, e.color)
              : createProp(a.style, e.color, a.parts, a.ladder),
            e,
            job,
          );
      }
      // A built-in environment settles synchronously. Register all entity
      // loads first so it cannot publish readiness before they enter pending.
      ctx.environment.update(scene, settle, (message) =>
        live.current.onError(message),
      );
      settle();
    }, [requestedModelKey]);
    useEffect(() => {
      const c = context.current;
      if (!c) return;
      c.editing.cancel();
      c.transform.setMode(props.transformMode ?? "translate");
      c.transform.setSpace("world");
      c.transform.showX = c.transform.showZ = props.transformMode !== "rotate";
      c.transform.showY = true;
      if (props.move && props.selected && c.objects.has(props.selected))
        c.transform.attach(c.objects.get(props.selected)!);
      else c.transform.detach();
    }, [props.selected, props.move, props.transformMode]);
    useImperativeHandle(
      ref,
      () => ({
        startAssetDrag(asset, event) {
          context.current?.dragging.startAsset(asset, event);
        },
        suppressAssetClick() {
          return context.current?.dragging.suppressClick() ?? false;
        },
        seatingBody(actorId) {
          return context.current?.objects.get(actorId)?.userData.seatBody;
        },
        routeContext(actorId, beforeClipId) {
          const c = context.current;
          if (!c) throw Error("Wait for the scene to finish loading.");
          try {
            return routeContext(
              live.current.scene,
              c.objects,
              actorId,
              beforeClipId,
              c.environment.root,
            );
          } finally {
            c.renderAt(live.current.time);
          }
        },
        planRoute(
          actorId,
          targetId,
          kind,
          beforeClipId,
          locomotion,
          measuredCycle,
          automatic = false,
        ) {
          const c = context.current;
          if (!c) throw Error("Wait for the scene to finish loading.");
          try {
            return planObjectRoute(
              live.current.scene,
              c.objects,
              actorId,
              targetId,
              kind,
              beforeClipId,
              c.environment.root,
              locomotion,
              measuredCycle,
              0,
              automatic
                ? {
                    movingIds: movingObstacleIds(live.current.scene),
                    conflicts: [],
                  }
                : undefined,
            );
          } finally {
            c.renderAt(live.current.time);
          }
        },
        sequenceOrigin(actorId, beforeClipId) {
          const c = context.current,
            scene = live.current.scene;
          const actor = scene.entities.find((e) => e.id === actorId),
            object = c?.objects.get(actorId);
          if (!c || !actor || !object)
            throw Error("Wait for this character to finish loading.");
          const index = beforeClipId
            ? actor.clips.findIndex((clip) => clip.id === beforeClipId)
            : actor.clips.length;
          if (index < 0)
            throw Error("This action is no longer in the sequence.");
          const prefix = { ...actor, clips: actor.clips.slice(0, index) };
          applyAnimatedEntityPose(
            object,
            prefix,
            scene,
            prefix.clips.reduce((sum, clip) => sum + clip.duration, 0),
          );
          const frame = {
            position: object.position.toArray(),
            heading: object.rotation.y,
            scale: actor.scale,
          };
          c.renderAt(live.current.time);
          return frame;
        },
        async waitForScene(scene, signal) {
          const desired = stateKey(scene),
            models = modelKey(scene),
            start = performance.now();
          for (;;) {
            if (signal?.aborted)
              throw new DOMException("Rehearsal closed", "AbortError");
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            if (
              context.current?.currentKey === models &&
              context.current.environment.error
            )
              throw context.current.environment.error;
            if (
              context.current &&
              readyKey.current === models &&
              (stateKey(live.current.scene) === desired ||
                context.current.navigationMatches(scene))
            ) {
              context.current.prepareNavigation();
              if (!context.current.navigationPending()) return;
            }
            if (
              performance.now() - start >= 30000 &&
              !(
                context.current?.navigationPending() &&
                stateKey(live.current.scene) === desired
              )
            )
              break;
          }
          throw Error(
            "The requested scene is not ready to export. Wait for imported assets or retry after finishing your edits.",
          );
        },
        frame(view, focusId, atTime) {
          const c = context.current;
          if (!c) throw Error("The view is not ready.");
          c.renderAt(atTime ?? live.current.time);
          if (view === "conversation") {
            const bounds = new T.Box3();
            for (const actor of live.current.scene.entities) {
              const obj = c.objects.get(actor.id);
              if (
                actor.visible &&
                obj &&
                allAssets(live.current.scene).find(
                  (a) => a.id === actor.assetId,
                )?.category === "characters"
              )
                bounds.expandByObject(obj);
            }
            if (bounds.isEmpty()) return;
            const size = bounds.getSize(new T.Vector3()),
              target = bounds.getCenter(new T.Vector3());
            const fit = Math.max(size.y + 1.1, size.x / c.camera.aspect + 0.8);
            const distance = Math.max(
              3.8,
              (fit / (2 * Math.tan(T.MathUtils.degToRad(c.camera.fov / 2)))) *
                1.2 +
                size.z * 0.65,
            );
            target.y += 0.2;
            c.controls.target.copy(target);
            c.camera.position
              .copy(target)
              .add(
                new T.Vector3(0.15, 0.12, 1)
                  .normalize()
                  .multiplyScalar(distance),
              );
            c.controls.update();
            return;
          }
          const object = focusId ? c.objects.get(focusId) : undefined;
          if (focusId && !object)
            throw Error("The selected object is not loaded.");
          if (!object && view === "default" && c.environment.view) {
            // A set is framed the way its author meant it to be seen.
            const home = stageHome(c.environment.view);
            c.controls.target.copy(home.target);
            c.camera.position.copy(home.position);
            c.controls.update();
            c.renderer.render(c.world, c.camera);
            return;
          }
          const target = object
            ? new T.Box3().setFromObject(object).getCenter(new T.Vector3())
            : new T.Vector3(0, 0.85, -0.5);
          const distance = object
            ? Math.max(
                2,
                new T.Box3()
                  .setFromObject(object)
                  .getSize(new T.Vector3())
                  .length() * 1.5,
              )
            : 12;
          const direction = new T.Vector3(
            ...((view === "front"
              ? [0, 0.12, 1]
              : view === "side"
                ? [1, 0.12, 0]
                : view === "top"
                  ? [0.001, 1, 0.001]
                  : [0.8, 0.65, 1]) as [number, number, number]),
          ).normalize();
          c.controls.target.copy(target);
          c.camera.position.copy(target).addScaledVector(direction, distance);
          c.controls.update();
          c.renderer.render(c.world, c.camera);
        },
        floorBlocked(x, z) {
          return context.current?.environment.floorBlocked(x, z) ?? false;
        },
        reset() {
          const c = context.current;
          if (!c) return;
          const home = stageHome(c.environment.view);
          c.camera.position.copy(home.position);
          c.controls.target.copy(home.target);
        },
        startCinema(width, height) {
          return context.current?.startCinema(width, height) ?? null;
        },
        stopCinema() {
          context.current?.stopCinema();
        },
        onFrame(listener) {
          frameListener.current = listener;
        },
        screenshot() {
          const c = context.current;
          if (!c) return;
          c.renderAt(live.current.time);
          c.controls.update();
          c.renderer.render(c.world, c.camera);
          const a = document.createElement("a");
          a.href = c.renderer.domElement.toDataURL("image/png");
          a.download = "scene-maker.png";
          a.click();
        },
        async exportGLB() {
          const c = context.current;
          if (!c) throw Error("The scene is still loading.");
          if (c.environment.error) throw c.environment.error;
          if (
            readyKey.current !== modelKey(live.current.scene) ||
            !c.environment.ready ||
            c.objects.size !== live.current.scene.entities.length
          )
            throw Error("Wait for imported assets to finish loading.");
          const prepared = c.prepareNavigation();
          if (prepared.issues.length)
            throw Error(
              prepared.issues.map((issue) => issue.message).join(" "),
            );
          const animation = bakeAnimation(
            [
              ...c.objects.values(),
              ...(c.environment.root ? [c.environment.root] : []),
            ],
            duration(prepared.scene),
            c.renderAt,
            animationSampleBoundaries(prepared.scene, c.objects),
          );
          c.renderAt(0);
          const snapshot = exportSnapshot(c.content);
          c.renderAt(live.current.time);
          try {
            return (await new GLTFExporter().parseAsync(snapshot, {
              binary: true,
              animations: [animation],
              onlyVisible: true,
            })) as ArrayBuffer;
          } finally {
            // Cloned materials still reference the live objects' textures.
            disposeObject(snapshot, { textures: false });
          }
        },
        prepareNavigation() {
          const c = context.current;
          if (!c) throw Error("Wait for the scene to finish loading.");
          const prepared = c.prepareNavigation();
          if (prepared.issues.length)
            throw Error(
              prepared.issues.map((issue) => issue.message).join(" "),
            );
          return prepared.scene;
        },
      }),
      [],
    );
    return <div className="viewport-canvas" ref={host} />;
  },
);
