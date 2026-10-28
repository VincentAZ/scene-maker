import { it, expect } from "vitest";
import * as T from "three";
import { exportSnapshot } from "../src/exportSnapshot";
import { createCharacter, disposeObject } from "../src/world";
import { characters } from "../shared/scene";
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
