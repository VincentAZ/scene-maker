import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { exportSnapshot } from "./exportSnapshot";
import {
  type Scene,
  allAssets,
  allMotions,
  duration,
  boneNames,
} from "../shared/scene";
import {
  createCharacter,
  createProp,
  createEnvironment,
  applyEntityPose,
  activeTarget,
  disposeObject,
} from "./world";
export type ViewportHandle = {
  screenshot: () => void;
  exportGLB: () => Promise<ArrayBuffer>;
  reset: () => void;
  frame: (view: "default" | "front" | "side" | "top", focusId?: string) => void;
  waitForScene: (scene: Scene) => Promise<void>;
};
type Props = {
  scene: Scene;
  selected: string | null;
  onSelect: (id: string | null) => void;
  time: number;
  playing: boolean;
  onTime: (t: number) => void;
  onMove: (id: string, position: [number, number, number]) => void;
  onError: (text: string) => void;
  move: boolean;
};
const modelKey = (scene: Scene) =>
  JSON.stringify([
    scene.environment,
    scene.lighting,
    scene.entities.map((e) => [
      e.id,
      e.assetId,
      e.color,
      allAssets(scene).find((a) => a.id === e.assetId),
    ]),
  ]);
const stateKey = (scene: Scene) => JSON.stringify({ ...scene, revision: 0 });
export const Viewport = forwardRef<ViewportHandle, Props>(
  function Viewport(props, ref) {
    const host = useRef<HTMLDivElement>(null),
      live = useRef(props);
    live.current = props;
    const readyKey = useRef("");
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
      transform.addEventListener("dragging-changed", (e) => {
        controls.enabled = !e.value;
        if (!e.value && transform.object) {
          const o = transform.object;
          live.current.onMove(
            o.userData.entityId,
            o.position.toArray() as [number, number, number],
          );
        }
      });
      const objects = new Map<string, T.Group>();
      const renderAt = (time: number) => {
        for (const e of live.current.scene.entities) {
          const obj = objects.get(e.id);
          if (obj && !(transform.dragging && transform.object === obj)) {
            applyEntityPose(obj, e, live.current.scene, time);
            const mixer = obj.userData.mixer as T.AnimationMixer | undefined;
            if (mixer) {
              mixer.stopAllAction();
              applyEntityPose(obj, e, live.current.scene, time);
              let start = 0;
              for (const clip of e.clips) {
                const motion = allMotions(live.current.scene).find(
                  (m) => m.id === clip.motionId,
                );
                if (
                  time >= start &&
                  time < start + clip.duration &&
                  motion?.kind === "imported" &&
                  motion.sourceAssetId === e.assetId
                ) {
                  const native = T.AnimationClip.findByName(
                    obj.userData.animations,
                    motion.animationName || "",
                  );
                  if (native) {
                    const action = mixer.clipAction(native);
                    action.reset().play();
                    mixer.setTime(
                      ((time - start) * native.duration) / clip.duration,
                    );
                  }
                  break;
                }
                start += clip.duration;
              }
            }
          }
        }
        content.updateMatrixWorld(true);
        for (const e of live.current.scene.entities) {
          const actor = activeTarget(live.current.scene, time, e.id);
          if (actor) {
            const obj = objects.get(e.id),
              rig = objects.get(actor.id);
            const hand = rig?.userData.bones?.rightForearm as
              T.Bone | undefined;
            if (obj && hand) {
              obj.position.copy(
                hand.localToWorld(new T.Vector3(0, -0.3, 0.04)),
              );
              obj.quaternion.copy(hand.getWorldQuaternion(new T.Quaternion()));
            }
          }
        }
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
          transform.axis
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
        const hits = ray.intersectObjects([...objects.values()], true);
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
        lastSent = 0;
      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        const dt = Math.min((now - previous) / 1000, 0.1);
        previous = now;
        if (live.current.playing) {
          if (!wasPlaying) elapsed = live.current.time;
          elapsed += dt;
          const total = duration(live.current.scene);
          if (elapsed > total) elapsed = 0;
          if (now - lastSent > 40) {
            live.current.onTime(elapsed);
            lastSent = now;
          }
        } else elapsed = live.current.time;
        wasPlaying = live.current.playing;
        renderAt(elapsed);
        controls.update();
        renderer.render(world, camera);
      };
      frame = requestAnimationFrame(loop);
      return () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        transform.dispose();
        controls.dispose();
        disposeObject(content);
        renderer.dispose();
        renderer.domElement.remove();
        context.current = null;
      };
    }, []);
    useEffect(() => {
      const ctx = context.current;
      if (!ctx) return;
      let cancelled = false;
      readyKey.current = "";
      ctx.transform.detach();
      for (const c of [...ctx.content.children]) {
        ctx.content.remove(c);
        disposeObject(c);
      }
      ctx.objects.clear();
      ctx.content.add(createEnvironment(props.scene.environment));
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
      const setup = (obj: T.Group, id: string) => {
        if (cancelled) {
          disposeObject(obj);
          return;
        }
        obj.name = "entity_" + id;
        obj.userData.entityId = id;
        obj.traverse((o) => {
          if (o instanceof T.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        ctx.objects.set(id, obj);
        ctx.content.add(obj);
        if (ctx.objects.size === props.scene.entities.length)
          readyKey.current = requestedModelKey;
        if (live.current.move && live.current.selected === id)
          ctx.transform.attach(obj);
      };
      for (const e of props.scene.entities) {
        const a = allAssets(props.scene).find((a) => a.id === e.assetId);
        if (!a) continue;
        if (a.url) {
          new GLTFLoader().load(
            a.url,
            (gltf) => {
              const obj = new T.Group();
              const imported = clone(gltf.scene);
              const bounds = new T.Box3().setFromObject(imported);
              const height = bounds.max.y - bounds.min.y;
              imported.scale.setScalar(
                a.category === "characters" ? 1.85 / (height || 1) : 1,
              );
              imported.position.y = -bounds.min.y * imported.scale.y;
              obj.add(imported);
              const bones: Record<string, T.Bone> = {};
              const aliases: Record<string, string> = {
                hips: "hips",
                spine: "spine",
                head: "head",
                leftarm: "leftArm",
                leftforearm: "leftForearm",
                rightarm: "rightArm",
                rightforearm: "rightForearm",
                leftupleg: "leftLeg",
                leftleg: "leftShin",
                rightupleg: "rightLeg",
                rightleg: "rightShin",
              };
              imported.traverse((o) => {
                if (o instanceof T.Bone) {
                  const key = o.name
                    .replace(/mixamorig[:_]?/i, "")
                    .toLowerCase();
                  if (boneNames.includes(o.name as (typeof boneNames)[number]))
                    bones[o.name] = o;
                  else if (aliases[key]) bones[aliases[key]] = o;
                }
              });
              obj.userData.bones = bones;
              obj.userData.rest = Object.fromEntries(
                Object.entries(bones).map(([name, bone]) => [
                  name,
                  bone.quaternion.clone(),
                ]),
              );
              obj.userData.mixer = new T.AnimationMixer(imported);
              obj.userData.animations = gltf.animations;
              setup(obj, e.id);
            },
            undefined,
            () =>
              live.current.onError(
                `Could not load ${e.name}. Reimport the character from your files.`,
              ),
          );
        } else
          setup(
            a.category === "characters"
              ? createCharacter(a, e.color)
              : createProp(a.style, e.color, a.parts),
            e.id,
          );
      }
      if (!props.scene.entities.length) readyKey.current = requestedModelKey;
      return () => {
        cancelled = true;
      };
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
        async waitForScene(scene) {
          const desired = stateKey(scene),
            models = modelKey(scene),
            start = performance.now();
          while (performance.now() - start < 30000) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
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
        frame(view, focusId) {
          const c = context.current;
          if (!c) throw Error("The view is not ready.");
          c.renderAt(live.current.time);
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
          if (c.objects.size !== live.current.scene.entities.length)
            throw Error("Wait for imported assets to finish loading.");
          const tracks: T.KeyframeTrack[] = [];
          const total = duration(live.current.scene),
            times = Array.from({ length: Math.ceil(total * 24) + 1 }, (_, i) =>
              Math.min(i / 24, total),
            );
          const sampled = new Map<
            T.Object3D,
            { positions: number[]; rotations: number[] }
          >();
          for (const obj of c.objects.values()) {
            sampled.set(obj, { positions: [], rotations: [] });
            obj.traverse((b) => {
              if (b instanceof T.Bone)
                sampled.set(b, { positions: [], rotations: [] });
            });
          }
          for (const time of times) {
            c.renderAt(time);
            for (const [o, data] of sampled) {
              data.positions.push(...o.position.toArray());
              data.rotations.push(...o.quaternion.toArray());
            }
          }
          for (const [o, data] of sampled) {
            tracks.push(
              new T.VectorKeyframeTrack(
                `${o.uuid}.position`,
                times,
                data.positions,
              ),
            );
            tracks.push(
              new T.QuaternionKeyframeTrack(
                `${o.uuid}.quaternion`,
                times,
                data.rotations,
              ),
            );
          }
          c.renderAt(0);
          const snapshot = exportSnapshot(c.content);
          c.renderAt(live.current.time);
          try {
            return (await new GLTFExporter().parseAsync(snapshot, {
              binary: true,
              animations: [
                new T.AnimationClip("Scene Maker sequence", total, tracks),
              ],
              onlyVisible: true,
            })) as ArrayBuffer;
          } finally {
            disposeObject(snapshot);
          }
        },
      }),
      [],
    );
    return <div className="viewport-canvas" ref={host} />;
  },
);
