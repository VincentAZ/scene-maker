import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as T from "three";
import { applyConversationPerformance } from "./conversationPerformance";
import { dialogueAt } from "../shared/conversation";
import { sceneDragging } from "./sceneDragging";
import { movedBasePosition, visibleEntity, type Position } from "./placement";
import type { Asset, Entity } from "../shared/scene";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { exportSnapshot } from "./exportSnapshot";
import type { RecordingSurface } from "./sceneRecorder";
import { bakeAnimation } from "./bakeAnimation";
import { applyInteractions } from "./interactions";
import { configureRigContacts } from "./ik";
import { setMotionSources } from "./rig";
import { loadImportedAsset, requiredMotionSources } from "./importedAsset";
import { EnvironmentModel, environmentModelKey } from "./environmentModel";
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
  /** The live canvas and dialogue overlay, for recording the view. */
  recordingSurface: () => RecordingSurface | null;
  /** Called after every rendered frame while set (for recordings). */
  onFrame: (listener: (() => void) | null) => void;
  exportGLB: () => Promise<ArrayBuffer>;
  reset: () => void;
  frame: (
    view: "default" | "front" | "side" | "top" | "conversation",
    focusId?: string,
    atTime?: number,
  ) => void;
  waitForScene: (scene: Scene, signal?: AbortSignal) => Promise<void>;
  sequenceOrigin: (actorId: string, beforeClipId?: string) => PathFrame;
  routeContext: (actorId: string, beforeClipId?: string) => RouteContext;
  planRoute: (
    actorId: string,
    targetId: string,
    kind: "walk" | "run",
    beforeClipId?: string,
  ) => Motion;
};
type Props = {
  scene: Scene;
  selected: string | null;
  onSelect: (id: string | null) => void;
  time: number;
  playing: boolean;
  onTime: (t: number) => void;
  onMove: (id: string, position: [number, number, number]) => void;
  onAdd?: (assetId: string, position: Position) => void;
  onEditStart?: () => void;
  onError: (text: string) => void;
  onInteractionWarning: (text: string) => void;
  move: boolean;
  loopDuration?: number;
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
    requiredMotionSources(scene, entity),
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
export const Viewport = forwardRef<ViewportHandle, Props>(
  function Viewport(props, ref) {
    const host = useRef<HTMLDivElement>(null),
      live = useRef(props);
    live.current = props;
    const readyKey = useRef("");
    const frameListener = useRef<(() => void) | null>(null);
    const bubbleOverlay = useRef<HTMLElement | null>(null);
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
      dragging: ReturnType<typeof sceneDragging>;
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
      bubbleOverlay.current = bubbleLayer;
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
      controls.maxPolarAngle = Math.PI * 0.49;
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
      let gizmoStart: {
        id: string;
        base: Position;
        position: T.Vector3;
      } | null = null;
      transform.addEventListener("dragging-changed", (e) => {
        controls.enabled = !e.value;
        const o = transform.object;
        if (e.value && o) {
          const entity = live.current.scene.entities.find(
            (item) => item.id === o.userData.entityId,
          );
          if (entity)
            gizmoStart = {
              id: entity.id,
              base: [...entity.position],
              position: o.position.clone(),
            };
          live.current.onEditStart?.();
        } else if (o && gizmoStart) {
          if (o.position.distanceTo(gizmoStart.position) > 0.0001)
            live.current.onMove(
              gizmoStart.id,
              movedBasePosition(
                gizmoStart.base,
                gizmoStart.position,
                o.position,
              ),
            );
          gizmoStart = null;
        }
      });
      const cancelGizmo = (event: Event) => {
        if (
          transform.dragging &&
          (event.type !== "keydown" ||
            (event as KeyboardEvent).key === "Escape")
        ) {
          transform.reset();
          transform.pointerUp(null);
          gizmoStart = null;
          controls.enabled = true;
        }
      };
      window.addEventListener("keydown", cancelGizmo);
      renderer.domElement.addEventListener("pointercancel", cancelGizmo, true);
      const objects = new Map<string, T.Group>();
      const status = document.createElement("div");
      status.className = "placement-status";
      status.setAttribute("role", "status");
      status.hidden = true;
      host.current.appendChild(status);
      const dragging = sceneDragging({
        canvas: renderer.domElement,
        camera,
        world,
        objects,
        current: () => live.current,
        orbit: controls,
        gizmo: transform,
        status,
      });
      let sessionScene: Scene | null = null,
        sessions: HoldSession[] = [],
        interactionWarning = "",
        lastWarning = "";
      const renderAt = (time: number) => {
        if (sessionScene !== live.current.scene) {
          sessionScene = live.current.scene;
          sessions = interactionSessions(
            sessionScene,
            allMotions(sessionScene),
          );
        }
        for (const e of live.current.scene.entities) {
          const obj = objects.get(e.id);
          if (obj && !(transform.dragging && transform.object === obj)) {
            applyAnimatedEntityPose(obj, e, live.current.scene, time);
          }
        }
        applyConversationPerformance(live.current.scene, time, objects);
        content.updateMatrixWorld(true);
        const interactionMessages = applyInteractions(
          live.current.scene,
          time,
          objects,
          sessions,
        ).map((w) => w.message);
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
        interactionWarning = [
          ...interactionMessages,
          ...Array.from(
            objects.values(),
            (object) => (object.userData.motionWarning as string) || "",
          ),
        ]
          .filter(Boolean)
          .slice(0, 2)
          .join(" ");
      };
      context.current = {
        renderer,
        world,
        camera,
        controls,
        objects,
        content,
        transform,
        renderAt,
        dragging,
        environment: new EnvironmentModel(content),
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
      let frame = 0,
        previous = performance.now(),
        elapsed = live.current.time,
        wasPlaying = false,
        lastSent = 0,
        ended = false;
      // Times published to React recently. The parent may lag several frames
      // behind, so a prop that matches any of them is an echo, not a seek.
      const published: number[] = [live.current.time];
      const remember = (t: number) => {
        published.push(t);
        if (published.length > 12) published.shift();
      };
      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        const dt = Math.min((now - previous) / 1000, 0.1);
        previous = now;
        if (!published.some((t) => Math.abs(live.current.time - t) <= 0.001)) {
          elapsed = live.current.time;
          published.length = 0;
          remember(elapsed);
          ended = false;
          live.current.onPlaybackState?.("seek");
        }
        if (live.current.playing !== wasPlaying)
          live.current.onPlaybackState?.(
            live.current.playing ? "play" : "pause",
          );
        if (live.current.playing && !dragging.active() && !transform.dragging) {
          if (!wasPlaying) elapsed = live.current.time;
          elapsed = live.current.advanceTime?.(elapsed, dt) ?? elapsed + dt;
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
          if (elapsed >= total && live.current.stopAtEnd) {
            elapsed = total;
            if (!ended) {
              ended = true;
              live.current.onEnded?.();
            }
          } else {
            ended = false;
            if (elapsed > total) elapsed = 0;
          }
          if (now - lastSent > 40) {
            remember(elapsed);
            live.current.onTime(elapsed);
            lastSent = now;
          }
        } else elapsed = live.current.time;
        wasPlaying = live.current.playing;
        renderAt(elapsed);
        if (interactionWarning !== lastWarning) {
          lastWarning = interactionWarning;
          live.current.onInteractionWarning(interactionWarning);
        }
        if (controls.enabled) controls.update();
        renderer.render(world, camera);
        projectBubbles(elapsed);
        frameListener.current?.();
      };
      frame = requestAnimationFrame(loop);
      return () => {
        cancelAnimationFrame(frame);
        bubbleLayer.remove();
        bubbleOverlay.current = null;
        resize.disconnect();
        window.removeEventListener("keydown", cancelGizmo);
        renderer.domElement.removeEventListener(
          "pointercancel",
          cancelGizmo,
          true,
        );
        dragging.dispose();
        status.remove();
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
        const key = `${asset.id}\u0000${asset.url}`;
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
      const color =
        props.scene.lighting === "moonlight"
          ? "#8c9eae"
          : props.scene.lighting === "daylight"
            ? "#dce1dc"
            : "#d8d4c7";
      ctx.world.background = new T.Color(color);
      ctx.world.fog = new T.Fog(color, 19, 38);
      const sun = ctx.world.children.find(
        (o) => o instanceof T.DirectionalLight,
      ) as T.DirectionalLight;
      sun.color.set(
        props.scene.lighting === "moonlight"
          ? "#a6c5ef"
          : props.scene.lighting === "daylight"
            ? "#ffffff"
            : "#fff0ce",
      );
      sun.intensity = props.scene.lighting === "moonlight" ? 1.2 : 4;
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
          const loaded = await Promise.all(
            requiredMotionSources(scene, entity).map(
              async (asset) => [asset.id, await original(asset)] as const,
            ),
          );
          setMotionSources(obj, new Map(loaded));
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
      if (props.move && props.selected && c.objects.has(props.selected))
        c.transform.attach(c.objects.get(props.selected)!);
      else c.transform.detach();
    }, [props.selected, props.move]);
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
            );
          } finally {
            c.renderAt(live.current.time);
          }
        },
        planRoute(actorId, targetId, kind, beforeClipId) {
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
          while (performance.now() - start < 30000) {
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
              stateKey(live.current.scene) === desired
            )
              return;
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
        reset() {
          const c = context.current;
          if (c) {
            c.camera.position.set(8, 6.5, 10);
            c.controls.target.set(0, 0.85, -0.5);
          }
        },
        recordingSurface() {
          const c = context.current;
          if (!c || !bubbleOverlay.current) return null;
          return {
            canvas: c.renderer.domElement,
            overlay: bubbleOverlay.current,
          };
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
          const animation = bakeAnimation(
            [
              ...c.objects.values(),
              ...(c.environment.root ? [c.environment.root] : []),
            ],
            duration(live.current.scene),
            c.renderAt,
            live.current.scene.entities.flatMap((entity) => {
              let time = 0;
              return entity.clips.map((clip) => (time += clip.duration));
            }),
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
      }),
      [],
    );
    return <div className="viewport-canvas" ref={host} />;
  },
);
