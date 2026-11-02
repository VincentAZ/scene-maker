import { expect, it } from "vitest";
import * as T from "three";
import { prepareImportedAsset } from "../src/importedAsset";
import { characters } from "../shared/scene";

it("keeps a travelling skin drawable when its cached bounds leave the camera", () => {
  const scene = new T.Group();
  const bone = new T.Bone();
  bone.name = "travelling-root";
  const geometry = new T.BoxGeometry(1, 1, 1);
  const count = geometry.attributes.position.count;
  geometry.setAttribute(
    "skinIndex",
    new T.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(weights, 4));
  const skin = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
  skin.add(bone);
  skin.bind(new T.Skeleton([bone]));
  const staticMesh = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
  scene.add(skin, staticMesh);
  const clip = new T.AnimationClip("travel", 1, [
    new T.VectorKeyframeTrack(
      "travelling-root.position",
      [0, 1],
      [0, 0, 0, 10, 0, 0],
    ),
  ]);
  const prepared = prepareImportedAsset(
    { ...characters[0], category: "props" },
    { scene, animations: [clip] },
  );
  prepared.updateMatrixWorld(true);
  skin.computeBoundingSphere(); // What the renderer caches at the first pose.
  const mixer = prepared.userData.mixer as T.AnimationMixer;
  const action = mixer.clipAction(clip).setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const camera = new T.PerspectiveCamera(30, 1, 0.1, 100);
  for (const time of [1, 0.6, 1]) {
    action.reset().play();
    mixer.setTime(time);
    prepared.updateMatrixWorld(true);
    const center = bone.getWorldPosition(new T.Vector3());
    camera.position.copy(center).add(new T.Vector3(0, 0, 3));
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    const frustum = new T.Frustum().setFromProjectionMatrix(
      new T.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    );
    expect(frustum.intersectsObject(skin)).toBe(false);
    expect(frustum.intersectsBox(new T.Box3().setFromObject(skin, true))).toBe(
      true,
    );
    // Same visibility predicate used by WebGLRenderer for an individual mesh.
    expect(!skin.frustumCulled || frustum.intersectsObject(skin)).toBe(true);
  }
  expect(staticMesh.frustumCulled).toBe(true);
  geometry.dispose();
  skin.material.dispose();
  staticMesh.geometry.dispose();
  staticMesh.material.dispose();
});
