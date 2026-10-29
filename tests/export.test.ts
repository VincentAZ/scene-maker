import { it, expect } from "vitest";
import * as T from "three";
import { exportSnapshot } from "../src/exportSnapshot";
import { createCharacter, disposeObject } from "../src/world";
import { characters } from "../shared/scene";
import { starterScene } from "../shared/scene";
import { configureImportedRig } from "../src/rig";
import { applyAnimatedEntityPose } from "../src/world";
import { bakeAnimation } from "../src/bakeAnimation";
it("keeps an export rig and its animation bindings independent of subsequent editor changes", () => {
  const source = new T.Group(),
    actor = createCharacter(characters[0]);
  source.add(actor);
  const snapshot = exportSnapshot(source);
  const originalMesh = actor.children.find(
    (o) => o instanceof T.SkinnedMesh,
  ) as T.SkinnedMesh;
  const exportedMesh = snapshot.children[0].children.find(
    (o) => o instanceof T.SkinnedMesh,
  ) as T.SkinnedMesh;
  expect(exportedMesh.uuid).toBe(originalMesh.uuid);
  expect(exportedMesh.geometry).not.toBe(originalMesh.geometry);
  expect(exportedMesh.material).not.toBe(originalMesh.material);
  expect(exportedMesh.skeleton.bones[0]).not.toBe(
    originalMesh.skeleton.bones[0],
  );
  expect(exportedMesh.skeleton.bones[0].uuid).toBe(
    originalMesh.skeleton.bones[0].uuid,
  );
  expect(snapshot.children[0].userData).toEqual({});
  expect(actor.userData.bones).toBeDefined();
  const x = exportedMesh.skeleton.bones[0].position.x;
  originalMesh.skeleton.bones[0].position.x += 5;
  disposeObject(source);
  expect(exportedMesh.skeleton.bones[0].position.x).toBe(x);
  expect(exportedMesh.geometry.getAttribute("position").count).toBeGreaterThan(
    0,
  );
  disposeObject(snapshot);
});
it("replays imported parent motion, scale and morph weights in the baked snapshot", () => {
  const scene = starterScene(),
    entity = scene.entities[0];
  entity.position = [0, 0, 0];
  entity.rotation = 0;
  const source = new T.Group(),
    actor = new T.Group(),
    imported = createCharacter(characters[0]);
  imported.name = "ImportedRoot";
  source.add(actor);
  actor.add(imported);
  const mesh = imported.children.find(
    (o) => o instanceof T.SkinnedMesh,
  ) as T.SkinnedMesh;
  mesh.name = "AnimatedBody";
  mesh.morphTargetInfluences = [0];
  const clip = new T.AnimationClip("Travel", 2, [
    new T.VectorKeyframeTrack(
      "ImportedRoot.position",
      [0, 2],
      [0, 0, 0, 0, 0, 2],
    ),
    new T.VectorKeyframeTrack(
      "AnimatedBody.scale",
      [0, 2],
      [1, 1, 1, 1.1, 1, 1],
    ),
    new T.NumberKeyframeTrack(
      "AnimatedBody.morphTargetInfluences",
      [0, 2],
      [0, 1],
    ),
  ]);
  configureImportedRig(actor, imported, [clip]);
  scene.customMotions.push({
    id: "travel",
    name: "Travel",
    kind: "imported",
    duration: 2,
    distance: 0,
    poses: [],
    sourceAssetId: entity.assetId,
    animationName: "Travel",
  });
  entity.clips = [
    { id: "a", motionId: "travel", duration: 2 },
    { id: "b", motionId: "walk", duration: 3 },
  ];
  const render = (time: number) => {
    applyAnimatedEntityPose(actor, entity, scene, time);
    source.updateMatrixWorld(true);
  };
  const animation = bakeAnimation([actor], 5, render);
  render(0);
  const snapshot = exportSnapshot(source);
  const exportedHip = snapshot.getObjectByProperty(
    "uuid",
    actor.userData.bones.hips.uuid,
  )!;
  const exportedMesh = snapshot.getObjectByProperty(
    "uuid",
    mesh.uuid,
  ) as T.Mesh;
  // Geometry without actual morph targets does not clone the influences array.
  exportedMesh.morphTargetInfluences = [0];
  const mixer = new T.AnimationMixer(snapshot);
  const action = mixer.clipAction(animation);
  action.setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  for (const time of [0, 0.5, 1, 1.5, 2, 4, 5, 1]) {
    render(time);
    action.reset().play();
    mixer.setTime(time);
    snapshot.updateMatrixWorld(true);
    expect(
      exportedHip
        .getWorldPosition(new T.Vector3())
        .distanceTo(
          actor.userData.bones.hips.getWorldPosition(new T.Vector3()),
        ),
      `at ${time}: baked ${exportedHip.getWorldPosition(new T.Vector3()).toArray()} preview ${actor.userData.bones.hips.getWorldPosition(new T.Vector3()).toArray()}`,
    ).toBeLessThan(1e-5);
    expect(exportedMesh.scale.x).toBeCloseTo(mesh.scale.x, 5);
    expect(exportedMesh.morphTargetInfluences[0]).toBeCloseTo(
      mesh.morphTargetInfluences![0],
      5,
    );
  }
});
it("releases material textures on dispose unless the object shares them with a live model", () => {
  const texture = new T.Texture(),
    material = new T.MeshStandardMaterial({ map: texture }),
    mesh = new T.Mesh(new T.BoxGeometry(), material),
    root = new T.Group();
  root.add(mesh);
  let released = 0;
  texture.addEventListener("dispose", () => released++);
  disposeObject(root, { textures: false });
  expect(released).toBe(0);
  disposeObject(root);
  expect(released).toBe(1);
});
